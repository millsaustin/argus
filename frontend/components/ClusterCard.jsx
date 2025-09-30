'use client';

import ErrorBanner from './ErrorBanner.jsx';

function formatPercent(value) {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return '—';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function safeDivide(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function computePercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value <= 1) return value * 100;
  return value;
}

function formatUptime(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return 'Unknown';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : `${seconds}s`;
}

export default function ClusterCard({ node }) {
  if (!node) {
    return <ErrorBanner title="Missing node" message="Node data is required." />;
  }

  const cpuUsage = node.cpu ?? 0;
  const ramUsage = safeDivide(node.mem, node.maxmem);
  const diskUsage = safeDivide(node.disk, node.maxdisk);

  const cpuPercent = computePercent(cpuUsage);
  const ramPercent = computePercent(ramUsage);
  const diskPercent = computePercent(diskUsage);

  return (
    <section style={styles.card}>
      <header style={styles.header}>
        <div>
          <h3 style={styles.title}>{node.node}</h3>
          <p style={styles.subtitle}>Uptime: {formatUptime(node.uptime)}</p>
        </div>
        <span style={{
          ...styles.status,
          ...statusStyles(node.status)
        }}>
          {node.status || 'unknown'}
        </span>
      </header>

      <dl style={styles.metrics}>
        <div style={styles.metricRow}>
          <dt style={styles.metricLabel}>CPU</dt>
          <dd style={{
            ...styles.metricValue,
            ...(cpuPercent > 85 ? styles.metricWarning : null)
          }}>
            {formatPercent(cpuUsage)}
          </dd>
        </div>
        <div style={styles.metricRow}>
          <dt style={styles.metricLabel}>RAM</dt>
          <dd style={{
            ...styles.metricValue,
            ...(ramPercent > 85 ? styles.metricWarning : null)
          }}>
            {formatPercent(ramUsage)}
          </dd>
        </div>
        <div style={styles.metricRow}>
          <dt style={styles.metricLabel}>Disk</dt>
          <dd style={{
            ...styles.metricValue,
            ...(diskPercent > 90 ? styles.metricWarning : null)
          }}>
            {formatPercent(diskUsage)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function statusStyles(status) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'online') {
    return {
      backgroundColor: 'rgba(34, 197, 94, 0.15)',
      color: '#4ade80',
      borderColor: 'rgba(34, 197, 94, 0.4)'
    };
  }

  return {
    backgroundColor: 'rgba(248, 113, 113, 0.18)',
    color: '#f87171',
    borderColor: 'rgba(248, 113, 113, 0.45)'
  };
}

const styles = {
  card: {
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '0.75rem',
    padding: '1.25rem',
    backgroundColor: '#10192c',
    minWidth: '250px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1rem'
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    color: '#e2e8f0'
  },
  subtitle: {
    margin: '0.4rem 0 0',
    color: '#94a3b8',
    fontSize: '0.9rem'
  },
  status: {
    border: '1px solid transparent',
    borderRadius: '999px',
    padding: '0.2rem 0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontSize: '0.7rem'
  },
  metrics: {
    display: 'grid',
    gap: '0.6rem',
    margin: 0
  },
  metricRow: {
    display: 'flex',
    justifyContent: 'space-between'
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: '0.85rem'
  },
  metricValue: {
    color: '#e2e8f0',
    fontWeight: 600,
    fontSize: '0.95rem'
  },
  metricWarning: {
    color: '#fb923c',
    fontWeight: 700
  }
};
