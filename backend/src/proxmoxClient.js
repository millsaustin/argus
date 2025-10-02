import axios from 'axios';
import https from 'https';

const REQUIRED_ENV = ['PROXMOX_API_URL', 'PROXMOX_TOKEN_ID', 'PROXMOX_TOKEN_SECRET'];
const truthy = new Set(['1', 'true', 'yes', 'on']);
const mockMode = truthy.has(String(process.env.PROXMOX_MOCK_MODE || '').trim().toLowerCase());
const mockLatencyMs = Number(process.env.PROXMOX_MOCK_LATENCY_MS || 200);

function ensureEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required Proxmox environment variables: ${missing.join(', ')}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMockError(message, status = 404) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function buildMockState() {
  const now = Date.now();

  const nodes = [
    { node: 'alpha', startedAt: now - 3 * 86400 * 1000, status: 'online', pool: 'dev' },
    { node: 'beta', startedAt: now - 5 * 86400 * 1000, status: 'online', pool: 'prod' },
    { node: 'gamma', startedAt: now - 3600 * 1000, status: 'maintenance', pool: 'staging' }
  ];

  const qemu = {
    alpha: [
      {
        vmid: 100,
        name: 'alpha-build',
        status: 'running',
        startedAt: now - 6 * 3600 * 1000,
        cpuFraction: 0.22,
        memBytes: 5_368_709_120,
        maxmem: 8_589_934_592,
        diskBytes: 64_424_509_440,
        maxdisk: 107_374_182_400,
        pool: 'dev'
      },
      {
        vmid: 101,
        name: 'alpha-ci',
        status: 'running',
        startedAt: now - 90 * 60 * 1000,
        cpuFraction: 0.12,
        memBytes: 2_684_354_560,
        maxmem: 8_589_934_592,
        diskBytes: 21_474_836_480,
        maxdisk: 85_899_345_920,
        pool: 'dev'
      }
    ],
    beta: [
      {
        vmid: 200,
        name: 'beta-web-01',
        status: 'running',
        startedAt: now - 12 * 3600 * 1000,
        cpuFraction: 0.18,
        memBytes: 3_221_225_472,
        maxmem: 6_442_450_944,
        diskBytes: 48_318_382_080,
        maxdisk: 96_636_764_160,
        pool: 'prod'
      },
      {
        vmid: 201,
        name: 'beta-analytics',
        status: 'stopped',
        startedAt: null,
        cpuFraction: 0,
        memBytes: 0,
        maxmem: 12_884_901_888,
        diskBytes: 0,
        maxdisk: 171_798_691_840,
        pool: 'prod'
      }
    ],
    gamma: [
      {
        vmid: 300,
        name: 'gamma-staging',
        status: 'running',
        startedAt: now - 45 * 60 * 1000,
        cpuFraction: 0.08,
        memBytes: 1_610_612_736,
        maxmem: 4_294_967_296,
        diskBytes: 16_777_216_000,
        maxdisk: 85_899_345_920,
        pool: 'staging'
      }
    ]
  };

  const lxc = {
    alpha: [
      {
        vmid: 9000,
        name: 'alpha-agent',
        status: 'running',
        startedAt: now - 2 * 3600 * 1000,
        cpuFraction: 0.05,
        memBytes: 805_306_368,
        maxmem: 1_610_612_736,
        diskBytes: 10_737_418_240,
        maxdisk: 42_949_672_960,
        pool: 'dev'
      }
    ],
    beta: [
      {
        vmid: 9001,
        name: 'beta-sysmon',
        status: 'running',
        startedAt: now - 7 * 3600 * 1000,
        cpuFraction: 0.03,
        memBytes: 536_870_912,
        maxmem: 1_073_741_824,
        diskBytes: 8_589_934_592,
        maxdisk: 34_359_738_368,
        pool: 'prod'
      }
    ],
    gamma: []
  };

  const clusterStatus = [
    { type: 'node', id: 'alpha', status: 'online' },
    { type: 'node', id: 'beta', status: 'online' },
    { type: 'node', id: 'gamma', status: 'maintenance' },
    { type: 'quorum', node: 'quorum', status: 'ok' },
    { type: 'service', id: 'pve-cluster', status: 'running' }
  ];

  const clusterResources = [];
  for (const node of nodes) {
    clusterResources.push({ type: 'node', node: node.node, id: node.node, pool: node.pool });
  }
  for (const [nodeName, vms] of Object.entries(qemu)) {
    for (const vm of vms) {
      clusterResources.push({ type: 'qemu', node: nodeName, vmid: vm.vmid, pool: vm.pool });
    }
  }
  for (const [nodeName, containers] of Object.entries(lxc)) {
    for (const container of containers) {
      clusterResources.push({ type: 'lxc', node: nodeName, vmid: container.vmid, pool: container.pool });
    }
  }

  return { nodes, qemu, lxc, clusterStatus, clusterResources };
}

function hydrateVm(vm) {
  const result = { ...vm };
  result.uptime = vm.status === 'running' && vm.startedAt ? Math.floor((Date.now() - vm.startedAt) / 1000) : 0;
  result.cpu = vm.cpuFraction;
  result.mem = vm.memBytes;
  result.disk = vm.diskBytes;
  result.pool = vm.pool;
  return result;
}

const mockState = mockMode ? buildMockState() : null;

if (mockMode) {
  console.warn('Proxmox client is running in MOCK mode. Real API calls are disabled.');
}

let client = null;

if (!mockMode) {
  ensureEnv();

  const baseURL = process.env.PROXMOX_API_URL.replace(/\/$/, '');
  const tokenId = process.env.PROXMOX_TOKEN_ID;
  const tokenSecret = process.env.PROXMOX_TOKEN_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  const allowInsecureEnv = String(process.env.PROXMOX_INSECURE_TLS).toLowerCase() === 'true';
  const allowInsecure = !isProduction && allowInsecureEnv;

  const axiosConfig = {
    baseURL,
    headers: {
      Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: !allowInsecure })
  };

  client = axios.create(axiosConfig);
}

async function mockGet(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (mockLatencyMs > 0) {
    await sleep(mockLatencyMs);
  }

  if (normalizedPath === '/nodes') {
    const nodes = mockState.nodes.map((node) => ({
      node: node.node,
      status: node.status,
      uptime: Math.floor((Date.now() - node.startedAt) / 1000)
    }));
    return deepClone(nodes);
  }

  if (normalizedPath === '/cluster/status') {
    return deepClone(mockState.clusterStatus);
  }

  if (normalizedPath === '/cluster/resources') {
    return deepClone(mockState.clusterResources);
  }

  const qemuMatch = normalizedPath.match(/^\/nodes\/([^/]+)\/qemu$/);
  if (qemuMatch) {
    const node = decodeURIComponent(qemuMatch[1]);
    const items = mockState.qemu[node];
    if (!items) {
      throw createMockError(`Node "${node}" not found`, 404);
    }
    const hydrated = items.map((vm) => hydrateVm(vm));
    return deepClone(hydrated);
  }

  const lxcMatch = normalizedPath.match(/^\/nodes\/([^/]+)\/lxc$/);
  if (lxcMatch) {
    const node = decodeURIComponent(lxcMatch[1]);
    const items = mockState.lxc[node];
    if (!items) {
      throw createMockError(`Node "${node}" not found`, 404);
    }
    const hydrated = items.map((vm) => hydrateVm(vm));
    return deepClone(hydrated);
  }

  throw createMockError(`No mock response defined for ${normalizedPath}`, 404);
}

async function mockPost(path, _body = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (mockLatencyMs > 0) {
    await sleep(mockLatencyMs);
  }

  const actionMatch = normalizedPath.match(/^\/nodes\/([^/]+)\/qemu\/([^/]+)\/status\/([^/]+)$/);
  if (actionMatch) {
    const node = decodeURIComponent(actionMatch[1]);
    const vmid = Number(actionMatch[2]);
    const action = actionMatch[3].toLowerCase();

    const vms = mockState.qemu[node];
    if (!Array.isArray(vms)) {
      throw createMockError(`Node "${node}" not found`, 404);
    }

    const vm = vms.find((item) => Number(item.vmid) === vmid);
    if (!vm) {
      throw createMockError(`VM ${vmid} not found on node ${node}`, 404);
    }

    if (!['start', 'stop', 'reboot'].includes(action)) {
      throw createMockError(`Unsupported action "${action}"`, 400);
    }

    if (action === 'start') {
      vm.status = 'running';
      vm.startedAt = Date.now();
      vm.cpuFraction = 0.1;
      vm.memBytes = Math.min(vm.maxmem * 0.35, vm.maxmem);
      vm.diskBytes = Math.min(vm.maxdisk * 0.6, vm.maxdisk);
    }

    if (action === 'stop') {
      vm.status = 'stopped';
      vm.startedAt = null;
      vm.cpuFraction = 0;
      vm.memBytes = 0;
    }

    if (action === 'reboot') {
      vm.status = 'running';
      vm.startedAt = Date.now();
      vm.cpuFraction = 0.15;
      vm.memBytes = Math.min(vm.maxmem * 0.4, vm.maxmem);
    }

    return {
      id: `UPID:MOCK:${Date.now()}`,
      node,
      vmid,
      status: 'mocked',
      action
    };
  }

  throw createMockError(`No mock handler for ${normalizedPath}`, 404);
}

export async function pveGet(path) {
  if (mockMode) {
    return mockGet(path);
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  try {
    const response = await client.get(normalizedPath);
    return response.data?.data;
  } catch (error) {
    if (error.response) {
      const proxmoxError = new Error('Proxmox request failed');
      proxmoxError.status = error.response.status;
      proxmoxError.payload = error.response.data;
      if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        proxmoxError.message = 'TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.';
      }
      throw proxmoxError;
    }

    if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      const tlsError = new Error('TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.');
      tlsError.status = 502;
      throw tlsError;
    }

    throw error;
  }
}

export async function pvePost(path, body = {}) {
  if (mockMode) {
    return mockPost(path, body);
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  try {
    const response = await client.post(normalizedPath, body);
    return response.data?.data;
  } catch (error) {
    if (error.response) {
      const proxmoxError = new Error('Proxmox request failed');
      proxmoxError.status = error.response.status;
      proxmoxError.payload = error.response.data;
      if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        proxmoxError.message = 'TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.';
      }
      throw proxmoxError;
    }

    if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      const tlsError = new Error('TLS verification failed. Import the Proxmox CA certificate instead of disabling verification.');
      tlsError.status = 502;
      throw tlsError;
    }

    throw error;
  }
}

const RESOURCE_CACHE_TTL_MS = 5000;
let cachedResources = null;
let cachedResourcesAt = 0;

function buildResourceIndex(resources) {
  const nodePools = new Map();
  const vmPools = new Map();
  if (Array.isArray(resources)) {
    for (const item of resources) {
      const pool = item?.pool ? String(item.pool).toLowerCase() : null;
      if (item?.type === 'node') {
        const key = item.node || item.id || item.name;
        if (key) {
          nodePools.set(String(key), pool);
        }
      }
      if (item?.type === 'qemu' || item?.type === 'lxc' || item?.type === 'openvz') {
        if (item?.node != null && item?.vmid != null) {
          const key = `${item.node}:${item.vmid}`;
          vmPools.set(key, pool);
        }
      }
    }
  }
  return { nodePools, vmPools };
}

async function fetchClusterResources() {
  if (mockMode) {
    return deepClone(mockState.clusterResources);
  }
  const resources = await pveGet('/cluster/resources');
  return Array.isArray(resources) ? resources : [];
}

async function getClusterResourceIndex({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedResources && now - cachedResourcesAt < RESOURCE_CACHE_TTL_MS) {
    return cachedResources;
  }

  const resources = await fetchClusterResources();
  cachedResources = buildResourceIndex(resources);
  cachedResourcesAt = Date.now();
  return cachedResources;
}

export async function getNodePool(node) {
  if (!node) return null;
  const index = await getClusterResourceIndex();
  return index.nodePools.get(String(node)) || null;
}

export async function getVmPool(node, vmid) {
  if (!node || vmid == null) return null;
  const index = await getClusterResourceIndex();
  const key = `${node}:${vmid}`;
  return index.vmPools.get(key) || null;
}

export async function getVmPoolMapForNode(node) {
  const index = await getClusterResourceIndex();
  const entries = new Map();
  if (!node) return entries;
  const prefix = `${node}:`;
  for (const [key, pool] of index.vmPools.entries()) {
    if (key.startsWith(prefix)) {
      const vmid = Number(key.slice(prefix.length));
      entries.set(vmid, pool);
    }
  }
  return entries;
}

export function clearResourceCache() {
  cachedResources = null;
  cachedResourcesAt = 0;
}

export async function getResourcePoolIndex() {
  return getClusterResourceIndex();
}
