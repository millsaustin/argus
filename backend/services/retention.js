import { isDatabaseEnabled, withDb } from '../src/db.js';
import { recordAudit, pruneAuditEntriesOlderThan } from '../src/auditLog.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function coerceRetentionDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 90;
  }
  return Math.floor(parsed);
}

function coerceAuditRetentionDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 365;
  }
  return Math.floor(parsed);
}

export async function pruneOldMetrics(maxDays = 90) {
  const retentionDays = coerceRetentionDays(maxDays);
  const auditBase = {
    user: 'system',
    role: 'system',
    action: 'metrics_retention',
    job: 'metrics-prune',
    retentionDays,
    ts: Date.now()
  };

  if (!isDatabaseEnabled()) {
    recordAudit({
      ...auditBase,
      result: 'skipped',
      deleted: 0,
      message: 'Skipped metrics pruning because POSTGRES_URL is not configured.'
    });
    return { deleted: 0, skipped: true };
  }

  try {
    const deleted = await withDb(async (client) => {
      const result = await client.query(
        'DELETE FROM vm_metrics WHERE ts < NOW() - $1::interval',
        [`${retentionDays} days`]
      );
      return result.rowCount || 0;
    });

    recordAudit({
      ...auditBase,
      result: 'success',
      deleted
    });

    return { deleted };
  } catch (error) {
    recordAudit({
      ...auditBase,
      result: 'fail',
      deleted: 0,
      error: error.message
    });
    throw error;
  }
}

export function pruneOldAuditLog(maxDays = 365) {
  const retentionDays = coerceAuditRetentionDays(maxDays);
  const cutoff = Date.now() - retentionDays * ONE_DAY_MS;
  const deleted = pruneAuditEntriesOlderThan(cutoff);

  recordAudit({
    user: 'system',
    role: 'system',
    action: 'audit_retention',
    job: 'audit-prune',
    retentionDays,
    deleted,
    ts: Date.now(),
    result: 'success'
  });

  return { deleted };
}

export function scheduleMetricsRetention(maxMetricsDays = 90, maxAuditDays = 365) {
  const retentionDays = coerceRetentionDays(maxMetricsDays);
  const auditRetentionDays = coerceAuditRetentionDays(maxAuditDays);

  const run = () => {
    pruneOldMetrics(retentionDays).catch((error) => {
      console.error('Metrics retention job failed:', error);
    });

    try {
      pruneOldAuditLog(auditRetentionDays);
    } catch (error) {
      console.error('Audit retention job failed:', error);
    }
  };

  // Run once on schedule start, then every 24 hours.
  run();
  return setInterval(run, ONE_DAY_MS);
}
