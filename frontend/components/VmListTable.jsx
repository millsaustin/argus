'use client';

import ErrorBanner from './ErrorBanner.jsx';
import Loading from './Loading.jsx';

function formatPercent(value, total) {
  if (typeof value !== 'number') return '—';
  if (typeof total === 'number' && total > 0) {
    return `${((value / total) * 100).toFixed(1)}%`;
  }
  if (value >= 0 && value <= 1) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return `${value.toFixed(1)}%`;
}

function formatUptime(seconds) {
  if (typeof seconds !== 'number') return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.length ? parts.join(' ') : `${seconds}s`;
}

export default function VmListTable({ title, items }) {
  if (items == null) {
    return <Loading label="Loading VM list..." />;
  }

  if (Array.isArray(items) && items.length === 0) {
    return (
      <section style={styles.emptyBox}>
        <h3 style={styles.emptyTitle}>{title}</h3>
        <p style={styles.emptyText}>No items to display.</p>
      </section>
    );
  }

  if (!Array.isArray(items)) {
    return <ErrorBanner title={title} message="Unexpected data format." />;
  }

  return (
    <section style={styles.container}>
      {title && <h3 style={styles.title}>{title}</h3>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th>VMID</th>
            <th>Name</th>
            <th>Status</th>
            <th>Uptime</th>
            <th>CPU</th>
            <th>Mem</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.vmid ?? item.id}
                style={styles.row}
            >
              <td>{item.vmid ?? '—'}</td>
              <td>{item.name || item.node || item.hostname || '—'}</td>
              <td>{item.status || item.state || '—'}</td>
              <td>{formatUptime(item.uptime)}</td>
              <td>{formatPercent(item.cpu)}</td>
              <td>{formatPercent(item.mem, item.maxmem)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const styles = {
  container: {
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '0.75rem',
    padding: '1.25rem',
    backgroundColor: '#0c1426'
  },
  title: {
    margin: '0 0 0.75rem',
    color: '#e2e8f0'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    color: '#e2e8f0'
  },
  row: {
    borderBottom: '1px solid rgba(148, 163, 184, 0.12)'
  },
  emptyBox: {
    border: '1px solid rgba(148, 163, 184, 0.15)',
    borderRadius: '0.75rem',
    padding: '1.25rem',
    backgroundColor: '#10192c',
    color: '#94a3b8'
  },
  emptyTitle: {
    margin: '0 0 0.5rem',
    color: '#e2e8f0'
  },
  emptyText: {
    margin: 0
  }
};
