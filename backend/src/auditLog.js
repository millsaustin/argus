const auditEntries = [];

export function recordAudit(entry) {
  const augmented = {
    ...entry,
    ts: entry?.ts ?? Date.now()
  };
  auditEntries.push(augmented);
  console.log('[audit]', JSON.stringify(augmented));
}

export function getAuditEntries() {
  return [...auditEntries];
}

export function getRecentAuditEntries({ limit = 100, offset = 0 } = {}) {
  const sanitizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const sanitizedOffset = Math.max(Number(offset) || 0, 0);
  const entries = getAuditEntries();
  return entries
    .slice(-sanitizedOffset - sanitizedLimit, entries.length - sanitizedOffset)
    .map((entry) => sanitizeAuditEntry(entry));
}

function sanitizeAuditEntry(entry) {
  const clone = { ...entry };
  if (clone.details && typeof clone.details === 'object') {
    clone.details = '[REDACTED]';
  }
  if (clone.message) {
    clone.message = redact(clone.message);
  }
  return clone;
}

function redact(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
}
