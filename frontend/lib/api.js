const DEFAULT_BASE = 'http://localhost:3001/api/proxmox';

function getBaseUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
  const trimmed = fromEnv ? fromEnv.trim() : '';
  const base = trimmed || DEFAULT_BASE;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

async function request(path) {
  const baseUrl = getBaseUrl();
  const url = path.startsWith('/') ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const payload = await safeJson(response);

  if (response.ok && payload?.ok) {
    return payload.data;
  }

  const error = new Error(payload?.message || 'Proxmox request failed');
  error.status = payload?.status ?? response.status;
  error.code = payload?.code;
  if (payload?.hint) error.hint = payload.hint;
  error.payload = payload;
  throw error;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
}

export function getNodes() {
  return request('/nodes');
}

export function getClusterStatus() {
  return request('/cluster/status');
}

export function getQemuForNode(node) {
  const encoded = encodeURIComponent(node);
  return request(`/nodes/${encoded}/qemu`);
}

export function getLxcForNode(node) {
  const encoded = encodeURIComponent(node);
  return request(`/nodes/${encoded}/lxc`);
}
