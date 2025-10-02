import { recordAudit } from '../src/auditLog.js';

const STORE = new Map();
const PLACEHOLDER_PREFIX = '[REDACTED_';
const DEFAULT_TTL_MS = Number(process.env.LLM_SANITIZE_TTL_MS || 10 * 60 * 1000);

const GC_INTERVAL_MS = 5 * 60 * 1000;

const PATTERNS = [
  { type: 'TOKEN', regex: /sk-[A-Za-z0-9]{20,}/g },
  { type: 'TOKEN', regex: /(?<=Bearer\s+)[A-Za-z0-9._-]{10,}/gi },
  { type: 'TOKEN', regex: /(?<=\b(?:api|secret|access|refresh|session)_?token\s*[:=]\s*['\"]?)[A-Za-z0-9._-]{8,}/gi },
  { type: 'PASSWORD', regex: /(?<=\b(?:password|passphrase|secret)\s*[:=]\s*['\"]?)[^'"\s,}]+/gi },
  { type: 'EMAIL', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'IP', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { type: 'IP', regex: /\b(?:[A-F0-9]{1,4}:){1,7}[A-F0-9]{1,4}\b/gi },
  { type: 'UUID', regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g },
  { type: 'MAC', regex: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g }
];

function pruneExpiredMappings() {
  const now = Date.now();
  for (const [proposalId, record] of STORE.entries()) {
    if (!record || (record.expiresAt && record.expiresAt <= now)) {
      STORE.delete(proposalId);
    }
  }
}

function ensureRecord(proposalId) {
  pruneExpiredMappings();
  let record = STORE.get(proposalId);
  if (!record) {
    record = {
      mappings: new Map(),
      counters: {},
      expiresAt: Date.now() + DEFAULT_TTL_MS
    };
    STORE.set(proposalId, record);
  } else {
    record.expiresAt = Date.now() + DEFAULT_TTL_MS;
  }
  return record;
}

function buildPlaceholder(record, type) {
  record.counters[type] = (record.counters[type] || 0) + 1;
  return `${PLACEHOLDER_PREFIX}${type}_${record.counters[type]}]`;
}

function isAlreadyPlaceholder(value) {
  return typeof value === 'string' && value.startsWith(PLACEHOLDER_PREFIX) && value.endsWith(']');
}

export function sanitizeForLLM(input, proposalId) {
  if (!proposalId) {
    throw new Error('proposalId is required for sanitization');
  }

  if (input == null) {
    return {
      text: '',
      redactionsApplied: 0,
      sanitizedPreview: ''
    };
  }

  const originalText = typeof input === 'string' ? input : JSON.stringify(input);
  let workingText = originalText;
  const record = ensureRecord(proposalId);
  let redactions = 0;

  try {
    for (const { type, regex } of PATTERNS) {
      workingText = workingText.replace(regex, (match) => {
        if (isAlreadyPlaceholder(match)) {
          return match;
        }
        const placeholder = buildPlaceholder(record, type);
        record.mappings.set(placeholder, match);
        redactions += 1;
        return placeholder;
      });
    }
  } catch (error) {
    STORE.delete(proposalId);
    throw new Error(`Sanitization failed: ${error.message}`);
  }

  record.expiresAt = Date.now() + DEFAULT_TTL_MS;

  const sanitizedPreview = buildPreview(workingText);

  recordAudit({
    user: 'system',
    role: 'system',
    action: 'llm_sanitize',
    proposalId,
    result: redactions > 0 ? 'redacted' : 'no_redactions',
    redactionsApplied: redactions,
    redactions,
    sanitizedPreview
  });

  return {
    text: workingText,
    redactionsApplied: redactions,
    sanitizedPreview
  };
}

export function rehydrateFromLLM(output, proposalId) {
  if (!proposalId) {
    return output;
  }

  pruneExpiredMappings();
  const record = STORE.get(proposalId);
  if (!record) {
    return output;
  }

  const text = typeof output === 'string' ? output : JSON.stringify(output);
  let hydrated = text;

  for (const [placeholder, value] of record.mappings.entries()) {
    hydrated = hydrated.split(placeholder).join(value);
  }

  if (hydrated.includes(PLACEHOLDER_PREFIX)) {
    STORE.delete(proposalId);
    throw new Error('Unresolved placeholders detected during rehydration');
  }

  STORE.delete(proposalId);
  return hydrated;
}

function buildPreview(value) {
  if (!value) return '';
  const normalized = String(value).trim();
  if (normalized.length <= 400) {
    return normalized;
  }
  return `${normalized.slice(0, 400)}…`;
}

let gcTimer = setInterval(pruneExpiredMappings, GC_INTERVAL_MS);
if (gcTimer?.unref) {
  gcTimer.unref();
}
