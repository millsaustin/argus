function getBackendBase() {
  const fromEnv = process.env.NEXT_PUBLIC_BACKEND_BASE;
  const trimmed = fromEnv ? fromEnv.trim() : '';
  if (trimmed) {
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3001';
  }

  return '';
}

const BACKEND_BASE = getBackendBase();
const DEFAULT_PROXMOX_BASE = BACKEND_BASE
  ? `${BACKEND_BASE}/api/proxmox`
  : process.env.NODE_ENV !== 'production'
    ? 'http://localhost:3001/api/proxmox'
    : '/api/proxmox';
const API_ROOT = BACKEND_BASE ? `${BACKEND_BASE}/api` : '/api';
export const apiRoot = API_ROOT;

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

export async function putJson(path, body = {}) {
  const response = await apiFetch(path, {
    method: 'PUT',
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

export async function deleteJson(path) {
  const response = await apiFetch(path, {
    method: 'DELETE'
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

export async function getRecentLogs({ limit = 100, offset = 0, user, action, from, to } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (user) params.set('user', user);
  if (action) params.set('action', action);
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(to).toISOString());
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

export async function getCurrentUser() {
  const response = await apiFetch(`${API_ROOT}/me`, {
    method: 'GET',
    requireCsrf: false
  });
  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Failed to fetch session');
    throw error;
  }

  return payload.user;
}

export async function submitAssistantPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt is required');
  }

  const response = await postJson(`${API_ROOT}/assistant/propose`, {
    prompt
  });

  if (!response?.ok) {
    const error = buildApiError(null, response, 'Failed to submit prompt');
    throw error;
  }

  return response;
}

export async function getProposals() {
  const response = await apiFetch(`${API_ROOT}/assistant/proposals`, {
    method: 'GET',
    requireCsrf: false
  });
  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Failed to fetch proposals');
    throw error;
  }

  return payload.proposals || [];
}

export async function respondToProposal(id, decision = 'approve') {
  const response = await postJson(`${API_ROOT}/assistant/confirm/${encodeURIComponent(id)}`, {
    decision
  });
  return response;
}

export async function getLogUsers() {
  const response = await apiFetch(`${API_ROOT}/logs/users`, {
    method: 'GET',
    requireCsrf: false
  });
  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Failed to fetch log users');
    throw error;
  }

  return payload.users || [];
}

export async function getUsers() {
  const response = await apiFetch(`${API_ROOT}/users`, {
    method: 'GET',
    requireCsrf: true
  });
  const payload = await safeJson(response);

  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Failed to fetch users');
    throw error;
  }

  return payload.users || [];
}

export async function createUserAccount({ username, password, role }) {
  const payload = await postJson(`${API_ROOT}/users`, {
    username,
    password,
    role
  });

  if (!payload?.ok) {
    const error = buildApiError(null, payload, 'Failed to create user');
    throw error;
  }

  return payload.user;
}

export async function updateUserAccount(id, body) {
  const payload = await putJson(`${API_ROOT}/users/${encodeURIComponent(id)}`, body);
  if (!payload?.ok) {
    const error = buildApiError(null, payload, 'Failed to update user');
    throw error;
  }

  return payload;
}

export async function deactivateUserAccount(id) {
  const payload = await deleteJson(`${API_ROOT}/users/${encodeURIComponent(id)}`);
  if (!payload?.ok) {
    const error = buildApiError(null, payload, 'Failed to deactivate user');
    throw error;
  }

  return payload.user;
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

function buildIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idemp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function postProxmoxAction(action, { node, vmid }) {
  const url = `${API_ROOT}/proxmox/actions/${encodeURIComponent(action)}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-idempotency-key': buildIdempotencyKey()
  };

  const response = await apiFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ node, vmid })
  });

  const payload = await safeJson(response);
  if (!response.ok || !payload?.ok) {
    const error = buildApiError(response, payload, 'Proxmox action failed');
    throw error;
  }

  return payload.result;
}

export async function performVmAction(action, { node, vmid }) {
  if (!action || !node || vmid == null) {
    throw new Error('action, node, and vmid are required');
  }
  return postProxmoxAction(action, { node, vmid });
}

export async function changePassword({ username, oldPassword, newPassword }) {
  const payload = await postJson(`${API_ROOT}/change-password`, {
    username,
    oldPassword,
    newPassword
  });

  if (!payload?.ok) {
    const error = buildApiError(null, payload, 'Failed to change password');
    throw error;
  }

  return payload;
}
