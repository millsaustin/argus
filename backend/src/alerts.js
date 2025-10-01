import { getAuditEntries } from './auditLog.js';

export function generateAlerts() {
  const entries = getAuditEntries();
  const alerts = [];

  const offlineNodes = detectOfflineNodes(entries);
  alerts.push(...offlineNodes);

  const failedTasks = detectFailedTasks(entries);
  alerts.push(...failedTasks);

  const loginFailures = detectLoginFailures(entries);
  alerts.push(...loginFailures);

  return alerts;
}

function detectOfflineNodes(entries) {
  const alerts = [];
  const recent = entries.slice(-500);
  recent.forEach((entry) => {
    if (entry.code === 'NODE_OFFLINE') {
      alerts.push({
        id: `offline-${entry.node}-${entry.ts}`,
        severity: 'critical',
        message: `Node ${entry.node} reported offline`,
        ts: entry.ts
      });
    }
  });
  return alerts;
}

function detectFailedTasks(entries) {
  const alerts = [];
  const failures = entries.filter((entry) => entry.result === 'fail');
  if (failures.length >= 3) {
    alerts.push({
      id: `failures-${Date.now()}`,
      severity: 'warning',
      message: `${failures.length} failures recorded recently`,
      ts: Date.now()
    });
  }
  return alerts;
}

function detectLoginFailures(entries) {
  const alerts = [];
  const failures = entries.filter((entry) => entry.action === 'login-failed');
  if (failures.length >= 5) {
    alerts.push({
      id: `login-failures-${Date.now()}`,
      severity: 'warning',
      message: 'Repeated login failures detected',
      ts: Date.now()
    });
  }
  return alerts;
}
