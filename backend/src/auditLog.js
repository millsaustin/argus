const auditEntries = [];
let auditCounter = 0;

export function recordAudit(entry) {
  const augmented = {
    ...entry,
    id: entry?.id ?? `audit-${++auditCounter}`,
    ts: entry?.ts ?? Date.now()
  };
  auditEntries.push(augmented);
  console.log('[audit]', JSON.stringify(augmented));
}

export function getAuditEntries() {
  return [...auditEntries];
}

export function getRecentAuditEntries({
  limit = 100,
  offset = 0,
  includeDetails = false,
  includeSensitive = false,
  filters = {}
} = {}) {
  const sanitizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const sanitizedOffset = Math.max(Number(offset) || 0, 0);
  const entries = applyFilters(getAuditEntries(), filters);
  return entries
    .slice(-sanitizedOffset - sanitizedLimit, entries.length - sanitizedOffset)
    .map((entry) => buildAuditResponse(entry, { includeDetails, includeSensitive }));
}

const ALWAYS_REMOVE_FIELDS = new Set(['details']);
const ADMIN_ONLY_FIELDS = new Set([
  'request',
  'response',
  'rawRequest',
  'rawResponse',
  'headers',
  'prompt',
  'proposal',
  'payload'
]);

function buildAuditResponse(entry, { includeDetails, includeSensitive }) {
  const summary = {
    id: entry.id,
    ts: entry.ts,
    user: entry.user,
    role: entry.role,
    action: entry.action,
    result: entry.result,
    node: entry.node,
    vmid: entry.vmid,
    correlationId: entry.correlationId,
    message: entry.message ? redactString(entry.message) : undefined
  };

  if (includeDetails) {
    summary.details = sanitizeDetails(entry, includeSensitive);
  }

  return summary;
}

function sanitizeDetails(entry, includeSensitive) {
  const clone = safeClone(entry);
  delete clone.details;
  delete clone.id;
  delete clone.ts;
  delete clone.user;
  delete clone.role;
  delete clone.action;
  delete clone.result;
  delete clone.node;
  delete clone.vmid;
  delete clone.correlationId;
  delete clone.message;

  return scrubObject(clone, includeSensitive);
}

function scrubObject(value, includeSensitive) {
  if (Array.isArray(value)) {
    return value.map((item) => scrubObject(item, includeSensitive));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, inner] of Object.entries(value)) {
      if (ALWAYS_REMOVE_FIELDS.has(key)) {
        continue;
      }
      if (!includeSensitive && ADMIN_ONLY_FIELDS.has(key)) {
        continue;
      }
      result[key] = scrubObject(inner, includeSensitive);
    }
    return result;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  return value;
}

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return { value: '[UNSERIALIZABLE]' };
  }
}

function redactString(value) {
  return String(value ?? '')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]');
}

function applyFilters(entries, filters) {
  if (!filters) return entries;
  const { user, action, from, to } = filters;
  const fromTs = from ? Number(new Date(from)) : null;
  const toTs = to ? Number(new Date(to)) : null;

  return entries.filter((entry) => {
    if (user && entry.user !== user) return false;
    if (action && entry.action !== action) return false;
    if (fromTs && Number(entry.ts) < fromTs) return false;
    if (toTs && Number(entry.ts) > toTs) return false;
    return true;
  });
}

export function listAuditUsers() {
  const seen = new Set();
  for (const entry of auditEntries) {
    if (entry.user) {
      seen.add(entry.user);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function pruneAuditEntriesOlderThan(cutoffTs) {
  const cutoff = Number(cutoffTs);
  if (!Number.isFinite(cutoff)) {
    return 0;
  }

  const before = auditEntries.length;
  if (before === 0) return 0;

  for (let index = auditEntries.length - 1; index >= 0; index -= 1) {
    const entry = auditEntries[index];
    if (Number(entry?.ts) < cutoff) {
      auditEntries.splice(index, 1);
    }
  }

  return before - auditEntries.length;
}
