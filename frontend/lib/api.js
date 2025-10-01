const DEFAULT_PROXMOX_BASE = 'http://localhost:3001/api/proxmox';
const API_ROOT = '/api';

let csrfToken = null;

function buildApiError(response, payload, fallbackMessage) {
  const error = new Error(payload?.message || fallbackMessage);
  error.status = response?.status;
  if (payload?.code) {
    error.code = payload.code;
  }
  if (payload?.hint) {
    error.hint = payload.hint;
  }
  return error;
}

export function getApiErrorMessage(error, fallback = 'Unexpected error') {
  if (!error) return fallback;
  if (error.code === 'CSRF_ERROR') {
    return 'Session expired, please log in again.';
  }
  if (error.code === 'FORBIDDEN' || error.status === 403) {
    return 'You don’t have permission for this action.';
  }
  return error.message || fallback;
}

function getProxmoxBaseUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
  const trimmed = fromEnv ? fromEnv.trim() : '';
  const base = trimmed || DEFAULT_PROXMOX_BASE;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
}

function resetCsrfToken() {
  csrfToken = null;
}

async function fetchCsrfToken(force = false) {
  if (!force && csrfToken) {
    return csrfToken;
  }

  const response = await fetch(`${API_ROOT}/csrf-token`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to obtain CSRF token');
  }

  const payload = await safeJson(response);
  if (!payload?.csrfToken) {
    throw new Error('Invalid CSRF token response');
  }

  csrfToken = payload.csrfToken;
  return csrfToken;
}

async function apiFetch(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    requireCsrf
  } = options;

  const upperMethod = method.toUpperCase();
  const finalHeaders = {
    Accept: 'application/json',
    ...headers
  };

  const init = {
    method: upperMethod,
    credentials: 'include',
    headers: finalHeaders
  };

  if (body !== undefined) {
    init.body = body;
  }

  const needsCsrf = requireCsrf ?? ['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod);
  if (needsCsrf) {
    const token = await fetchCsrfToken();
    finalHeaders['x-csrf-token'] = token;
  }

  const response = await fetch(url, init);
  if (response.status === 403) {
    resetCsrfToken();
  }

  return response;
}

async function request(path) {
  const baseUrl = getProxmoxBaseUrl();
  const url = path.startsWith('/') ? `${baseUrl}${path}` : `${baseUrl}/${path}`;
  const response = await apiFetch(url, { method: 'GET', requireCsrf: false });
  const payload = await safeJson(response);

  if (response.ok && payload?.ok) {
    return payload.data;
  }

  const error = buildApiError(response, payload || {}, 'Proxmox request failed');
  throw error;
}

export async function login(username, password) {
  await fetchCsrfToken(true);

  const response = await apiFetch(`${API_ROOT}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    resetCsrfToken();
    const error = buildApiError(response, payload, 'Login failed');
    throw error;
  }

  await fetchCsrfToken(true);
  return payload.user;
}

export async function logout() {
  try {
    const response = await apiFetch(`${API_ROOT}/logout`, {
      method: 'POST'
    });

  if (!response.ok) {
    const payload = await safeJson(response);
    const error = buildApiError(response, payload, 'Logout failed');
    throw error;
  }
  } finally {
    resetCsrfToken();
  }
}

export async function postJson(path, body = {}) {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const payload = await safeJson(response);
  if (!response.ok) {
    const error = buildApiError(response, payload, 'Request failed');
    throw error;
  }

  return payload;
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

export async function getRecentLogs({ limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await apiFetch(`${API_ROOT}/logs/recent?${params.toString()}`, {
    method: 'GET',
    requireCsrf: false
  });
  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Failed to fetch logs');
    throw error;
  }

  return payload.entries || [];
}

export async function getAlerts() {
  const response = await apiFetch(`${API_ROOT}/alerts`, {
    method: 'GET',
    requireCsrf: false
  });
  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Failed to fetch alerts');
    throw error;
  }

  return payload.alerts || [];
}

export async function getMetricsHistory({ node, vmid, hours = 24 }) {
  const params = new URLSearchParams({
    node,
    vmid: String(vmid),
    hours: String(hours)
  });

  const response = await apiFetch(`${API_ROOT}/metrics/history?${params.toString()}`, {
    method: 'GET',
    requireCsrf: false
  });

  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Failed to load metrics history');
    throw error;
  }

  return payload.metrics || [];
}
