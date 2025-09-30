'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const REFRESH_INTERVAL_MS = 30000;

export default function Page() {
  const [nodes, setNodes] = useState(null);
  const [nodesError, setNodesError] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedNode, setSelectedNode] = useState('');
  const [vmList, setVmList] = useState(null);
  const [vmError, setVmError] = useState(null);

  const rows = useMemo(() => (Array.isArray(nodes?.data) ? nodes.data : []), [nodes]);
  const vmRows = useMemo(() => (Array.isArray(vmList?.data) ? vmList.data : []), [vmList]);
  const errorToasts = useMemo(() => {
    const messages = [];
    if (nodesError) messages.push({ id: 'nodes', message: nodesError });
    if (healthError) messages.push({ id: 'health', message: healthError });
    if (vmError) messages.push({ id: 'vm', message: vmError });
    return messages;
  }, [nodesError, healthError, vmError]);

  const loadNodes = useCallback(async () => {
    try {
      const response = await fetch('/api/proxmox/nodes');
      if (!response.ok) {
        const payload = await tryParseJson(response);
        const message = payload?.error || `Nodes request failed (${response.status})`;
        throw new Error(message);
      }
      const payload = await response.json();
      setNodes(payload);
      setNodesError(null);
    } catch (error) {
      setNodesError(error?.message || 'Unable to load nodes');
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`Health check failed (${response.status})`);
      }
      const payload = await response.json();
      setHealth(payload);
      setHealthError(null);
    } catch (error) {
      setHealthError(error?.message || 'Health check failed');
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([loadNodes(), loadHealth()]);
    setLoading(false);
  }, [loadHealth, loadNodes]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const id = setInterval(() => {
      refreshAll();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [autoRefresh, refreshAll]);

  useEffect(() => {
    if (!selectedNode) {
      setVmList(null);
      setVmError(null);
      return undefined;
    }

    let cancelled = false;
    const fetchNodeVms = async () => {
      setVmList(null);
      setVmError(null);
      try {
        const response = await fetch(`/api/proxmox/nodes/${encodeURIComponent(selectedNode)}/qemu`);
        if (!response.ok) {
          const payload = await tryParseJson(response);
          const message = payload?.error || `VM query failed (${response.status})`;
          throw new Error(message);
        }
        const payload = await response.json();
        if (!cancelled) {
          setVmList(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setVmError(error?.message || 'Unable to load VMs');
        }
      }
    };

    fetchNodeVms();

    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  return (
    <main style={styles.page}>
      <div style={styles.toastStack} aria-live="polite" aria-atomic="true">
        {errorToasts.map(({ id, message }) => (
          <div key={id} style={styles.toast}>{message}</div>
        ))}
      </div>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Argus Dashboard (Phase 1)</h1>
          <p style={styles.subtitle}>Live readings from Proxmox via the backend proxy.</p>
        </div>
        <div style={styles.controls}>
          <label style={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto-refresh (30s)
          </label>
          <button type="button" style={styles.button} onClick={refreshAll}>
            Refresh
          </button>
        </div>
      </header>

      <section style={styles.healthBanner}>
        <strong>Backend health:</strong>{' '}
        {healthError && <span style={styles.healthError}>{healthError}</span>}
        {!healthError && health && (
          <span style={styles.healthOk}>
            OK · {new Date(health.time).toLocaleString()}
          </span>
        )}
        {!health && !healthError && <span>Checking…</span>}
      </section>

      {loading && !nodes && !nodesError && (
        <section style={styles.statusBox}>Loading node data…</section>
      )}

      <section style={styles.card}>
        <header style={styles.cardHeader}>
          <h2 style={styles.cardTitle}>Cluster Nodes</h2>
          <span style={styles.badge}>{rows.length}</span>
        </header>

        {rows.length === 0 ? (
          <p style={styles.emptyState}>No nodes reported.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Node</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>SSL Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((node, index) => (
                <tr key={node.node || `node-${index}`}>
                  <td style={styles.td}>{node.node || '—'}</td>
                  <td style={styles.td}>{renderStatusChip(node.status)}</td>
                  <td style={styles.td}>{node.ssl_fingerprint || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {rows.length > 0 && (
          <div style={styles.nodeInspector}>
            <label style={styles.selectLabel} htmlFor="node-select">
              Inspect node:
            </label>
            <select
              id="node-select"
              value={selectedNode}
              onChange={(event) => setSelectedNode(event.target.value)}
              style={styles.select}
            >
              <option value="">Select a node…</option>
              {rows.map((node) => (
                <option key={node.node} value={node.node}>
                  {node.node}
                </option>
              ))}
            </select>

            {selectedNode && (
              <div style={styles.vmPanel}>
                <h3 style={styles.vmTitle}>VMs on {selectedNode}</h3>
                {!vmError && !vmList && <p style={styles.vmStatus}>Loading VMs…</p>}
                {!vmError && vmList && vmRows.length === 0 && (
                  <p style={styles.vmStatus}>No VMs reported.</p>
                )}
                {!vmError && vmList && vmRows.length > 0 && (
                  <ul style={styles.vmList}>
                    {vmRows.map((vm) => (
                      <li key={vm.vmid} style={styles.vmListItem}>
                        {vm.vmid}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <details style={styles.details}>
          <summary style={styles.summary}>Raw response</summary>
          <pre style={styles.pre}>{formatJson(nodes)}</pre>
        </details>
      </section>
    </main>
  );
}

async function tryParseJson(response) {
  try {
    return await response.clone().json();
  } catch (_err) {
    return null;
  }
}

function formatJson(value) {
  if (!value) return 'null';
  return JSON.stringify(value, null, 2);
}

function renderStatusChip(status) {
  const normalized = (status || '').toLowerCase();
  const isOnline = normalized === 'online';
  const label = isOnline ? 'online' : normalized || 'unknown';
  const chipStyle = isOnline ? styles.chipOnline : styles.chipUnknown;

  return (
    <span style={{ ...styles.chip, ...chipStyle }}>
      {label}
    </span>
  );
}

const styles = {
  page: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    padding: '2rem',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    minHeight: '100vh'
  },
  toastStack: {
    position: 'fixed',
    top: '1.5rem',
    right: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    zIndex: 10
  },
  toast: {
    backgroundColor: '#2d1f1f',
    border: '1px solid rgba(248, 113, 113, 0.6)',
    padding: '0.75rem 1rem',
    borderRadius: '0.6rem',
    minWidth: '12rem',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.4)'
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  title: {
    margin: 0,
    fontSize: '2rem'
  },
  subtitle: {
    margin: '0.25rem 0 0',
    color: '#94a3b8'
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    cursor: 'pointer'
  },
  button: {
    backgroundColor: '#1e293b',
    color: '#e2e8f0',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    padding: '0.45rem 0.9rem',
    borderRadius: '0.4rem',
    cursor: 'pointer'
  },
  healthBanner: {
    backgroundColor: '#111c30',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: '0.6rem',
    padding: '0.75rem 1rem',
    marginBottom: '1.5rem',
    fontSize: '0.95rem'
  },
  healthOk: {
    color: '#4ade80'
  },
  healthError: {
    color: '#f87171'
  },
  statusBox: {
    backgroundColor: '#1e293b',
    padding: '1rem',
    borderRadius: '0.6rem',
    marginBottom: '1.5rem'
  },
  card: {
    backgroundColor: '#10192c',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    borderRadius: '0.9rem',
    padding: '1.5rem'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1rem'
  },
  cardTitle: {
    margin: 0,
    fontSize: '1.25rem'
  },
  badge: {
    backgroundColor: '#1f2937',
    color: '#e2e8f0',
    borderRadius: '999px',
    minWidth: '2rem',
    textAlign: 'center',
    padding: '0.25rem 0.75rem',
    fontSize: '0.8rem'
  },
  emptyState: {
    margin: '0.5rem 0',
    color: '#94a3b8'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginBottom: '1rem'
  },
  th: {
    textAlign: 'left',
    padding: '0.75rem 0.5rem',
    fontSize: '0.8rem',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    borderBottom: '1px solid rgba(148, 163, 184, 0.25)',
    color: '#9ca3af'
  },
  td: {
    padding: '0.75rem 0.5rem',
    borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
    fontSize: '0.95rem'
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontSize: '0.68rem',
    borderRadius: '999px',
    padding: '0.2rem 0.6rem'
  },
  chipOnline: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    color: '#4ade80',
    border: '1px solid rgba(34, 197, 94, 0.4)'
  },
  chipUnknown: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    color: '#cbd5f5',
    border: '1px solid rgba(148, 163, 184, 0.3)'
  },
  nodeInspector: {
    marginTop: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  selectLabel: {
    fontSize: '0.9rem',
    color: '#cbd5f5'
  },
  select: {
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    borderRadius: '0.4rem',
    padding: '0.5rem 0.75rem',
    maxWidth: '16rem'
  },
  vmPanel: {
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '0.6rem',
    padding: '0.9rem 1rem',
    backgroundColor: '#0c1426'
  },
  vmTitle: {
    margin: '0 0 0.6rem',
    fontSize: '1rem'
  },
  vmStatus: {
    margin: 0,
    color: '#94a3b8'
  },
  vmList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem'
  },
  vmListItem: {
    backgroundColor: '#111c30',
    padding: '0.35rem 0.65rem',
    borderRadius: '0.4rem',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    fontSize: '0.85rem'
  },
  details: {
    backgroundColor: '#0c1426',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '0.6rem',
    padding: '0.75rem 1rem'
  },
  summary: {
    cursor: 'pointer',
    fontWeight: 600,
    marginBottom: '0.5rem'
  },
  pre: {
    margin: 0,
    overflowX: 'auto',
    padding: '0.5rem',
    backgroundColor: '#0a1221',
    borderRadius: '0.4rem',
    fontSize: '0.85rem'
  }
};
