'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getNodes, getClusterStatus, getQemuForNode, getLxcForNode } from '../lib/api.js';
import ClusterCard from '../components/ClusterCard.jsx';
import VmListTable from '../components/VmListTable.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import GlobalAlert from '../components/GlobalAlert.jsx';
import { canOperate } from '../lib/role.js';

const REFRESH_INTERVAL_MS = 10000;

function isForbidden(error) {
  return error?.code === 'FORBIDDEN' || error?.status === 403;
}

export default function DashboardPage() {
  const [nodes, setNodes] = useState(null);
  const [selectedNode, setSelectedNode] = useState('');
  const [clusterStatus, setClusterStatus] = useState([]);
  const [qemuItems, setQemuItems] = useState(null);
  const [lxcItems, setLxcItems] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [nodesError, setNodesError] = useState(null);
  const [clusterError, setClusterError] = useState(null);
  const [qemuError, setQemuError] = useState(null);
  const [lxcError, setLxcError] = useState(null);

  const currentNode = useMemo(() => {
    if (!Array.isArray(nodes)) return null;
    return nodes.find((node) => node.node === selectedNode) || nodes[0] || null;
  }, [nodes, selectedNode]);

  const loadNodes = useCallback(async () => {
    try {
      const data = await getNodes();
      setNodes(data);
      setNodesError(null);

      if (data?.length) {
        const first = data[0].node;
        setSelectedNode((prev) => (prev || first));
      }
    } catch (error) {
      setNodesError(error);
      setNodes((prev) => (prev === null ? [] : prev));
    }
  }, []);

  const loadCluster = useCallback(async () => {
    try {
      const data = await getClusterStatus();
      setClusterStatus(Array.isArray(data) ? data : []);
      setClusterError(null);
    } catch (error) {
      setClusterError(error);
      setClusterStatus((prev) => prev);
    }
  }, []);

  const loadNodeResources = useCallback(async (nodeName) => {
    if (!nodeName) {
      setQemuItems([]);
      setLxcItems([]);
      return;
    }

    try {
      const data = await getQemuForNode(nodeName);
      setQemuItems(Array.isArray(data) ? data : []);
      setQemuError(null);
    } catch (error) {
      setQemuError(error);
      setQemuItems((prev) => (prev === null ? [] : prev));
    }

    try {
      const data = await getLxcForNode(nodeName);
      setLxcItems(Array.isArray(data) ? data : []);
      setLxcError(null);
    } catch (error) {
      setLxcError(error);
      setLxcItems((prev) => (prev === null ? [] : prev));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([
      loadNodes(),
      loadCluster(),
      selectedNode ? loadNodeResources(selectedNode) : Promise.resolve()
    ]);
    setLastUpdated(Date.now());
  }, [loadNodes, loadCluster, loadNodeResources, selectedNode]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!selectedNode) return undefined;

    loadNodeResources(selectedNode).then(() => setLastUpdated(Date.now()));

    if (!autoRefresh) return undefined;

    const interval = setInterval(() => {
      refreshAll();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [selectedNode, autoRefresh, refreshAll, loadNodeResources]);

  const handleNodeChange = (event) => {
    const nodeName = event.target.value;
    setSelectedNode(nodeName);
    loadNodeResources(nodeName);
  };

  const anyOffline = Array.isArray(nodes) && nodes.some((node) => (node.status || '').toLowerCase() !== 'online');
  const hasNodes = Array.isArray(nodes) && nodes.length > 0;

  const triggerProtected = async () => {
    try {
      const response = await fetch('/api/protected');
      const payload = await response.json();
      console.log('Protected response:', payload);
    } catch (error) {
      console.error('Protected request failed:', error);
    }
  };

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Argus Dashboard</h1>
        <p style={styles.subtitle}>Cluster overview with live Proxmox data.</p>
        {lastUpdated && (
          <p style={styles.updated}>Last updated: {new Date(lastUpdated).toLocaleTimeString()}</p>
        )}
      </header>

      {clusterError && (
        <GlobalAlert type="error" message="Cluster communication problem" />
      )}

      {!clusterError && anyOffline && (
        <GlobalAlert type="warning" message="One or more nodes are offline" />
      )}

      <section style={styles.controlsRow}>
        <label style={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          Auto-refresh every 10s
        </label>
      </section>

      {nodesError && (
        <ErrorBanner
          title="Failed to load nodes"
          message={nodesError.message}
          hint={nodesError.hint}
        />
      )}

      {clusterError && (
        <ErrorBanner
          title="Cluster status unavailable"
          message={isForbidden(clusterError)
            ? "Cluster status requires Sys.Audit permissions at '/'"
            : clusterError.message}
          hint={clusterError.hint}
        />
      )}

      {!nodes && !nodesError && <Loading label="Loading nodes…" />}

      {Array.isArray(nodes) && nodes.length === 0 && !nodesError && (
        <GlobalAlert type="info" message="No nodes available" />
      )}

      {hasNodes && (
        <>
          <section style={styles.selectorRow}>
            <label htmlFor="node-select" style={styles.selectLabel}>
              Select node:
            </label>
            <select
              id="node-select"
              value={selectedNode}
              onChange={handleNodeChange}
              style={styles.select}
            >
              {nodes.map((node) => (
                <option key={node.node} value={node.node}>
                  {node.node}
                </option>
              ))}
            </select>
          </section>

          <section style={styles.nodeGrid}>
            {nodes.map((node) => {
              const normalized = (node.status || '').toLowerCase();
              const isOnline = normalized === 'online';
              const isSelected = node.node === selectedNode;

              return (
                <button
                  key={`mini-${node.node}`}
                  type="button"
                  style={{
                    ...styles.nodeCard,
                    ...(isSelected ? styles.nodeCardSelected : null)
                  }}
                  onClick={() => setSelectedNode(node.node)}
                >
                  <span>{node.node}</span>
                  <span style={{
                    ...styles.nodeStatus,
                    color: isOnline ? '#4ade80' : '#f87171'
                  }}>
                    {node.status || 'unknown'}
                  </span>
                </button>
              );
            })}
          </section>

          {canOperate() && (
            <button type="button" style={styles.operatorButton} onClick={triggerProtected}>
              Dummy Operator Button
            </button>
          )}
        </>
      )}

      {hasNodes && currentNode ? (
        <ClusterCard node={currentNode} />
      ) : hasNodes ? (
        <Loading label="Waiting for node details…" />
      ) : null}

      {clusterStatus.length > 0 && (
        <section style={styles.clusterStatus}>
          <h3 style={styles.clusterTitle}>Cluster Status</h3>
          <ul style={styles.clusterList}>
            {clusterStatus.map((entry) => (
              <li key={`${entry.type}-${entry.id || entry.node || entry.name}`} style={styles.clusterItem}>
                <span>{entry.type}</span>
                <span>{entry.id || entry.node || entry.name || '—'}</span>
                <span>{entry.status || entry.state || entry.health || 'unknown'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasNodes && (
        <section style={styles.tablesWrapper}>
          <div style={styles.tableColumn}>
            {qemuError && (
              <ErrorBanner
                title="Unable to load QEMU VMs"
                message={qemuError.message}
                hint={qemuError.hint}
              />
            )}
            <VmListTable title="Virtual Machines (QEMU)" items={qemuItems} />
          </div>
          <div style={styles.tableColumn}>
            {lxcError && (
              <ErrorBanner
                title="Unable to load LXC containers"
                message={lxcError.message}
                hint={lxcError.hint}
              />
            )}
            <VmListTable title="Containers (LXC)" items={lxcItems} />
          </div>
        </section>
      )}
    </main>
  );
}

const styles = {
  page: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    padding: '2rem',
    backgroundColor: '#0f172a',
    minHeight: '100vh',
    color: '#e2e8f0'
  },
  header: {
    marginBottom: '2rem'
  },
  title: {
    margin: 0,
    fontSize: '2rem'
  },
  subtitle: {
    marginTop: '0.5rem',
    color: '#94a3b8'
  },
  selectorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  controlsRow: {
    marginBottom: '1.5rem'
  },
  toggleLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    color: '#cbd5f5'
  },
  nodeGrid: {
    display: 'grid',
    gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    marginBottom: '1.5rem'
  },
  nodeCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '0.65rem',
    padding: '0.65rem 0.75rem',
    backgroundColor: '#111c30',
    color: '#e2e8f0',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease, background-color 0.2s ease'
  },
  nodeCardSelected: {
    borderColor: '#a855f7',
    backgroundColor: '#171f36'
  },
  nodeStatus: {
    fontWeight: 600
  },
  operatorButton: {
    marginTop: '1rem',
    padding: '0.6rem 1rem',
    borderRadius: '0.5rem',
    border: '1px solid rgba(168, 85, 247, 0.6)',
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    color: '#f3e8ff',
    cursor: 'pointer',
    fontWeight: 600
  },
  selectLabel: {
    color: '#cbd5f5'
  },
  select: {
    backgroundColor: '#10192c',
    color: '#e2e8f0',
    borderRadius: '0.4rem',
    border: '1px solid rgba(148, 163, 184, 0.35)',
    padding: '0.5rem 0.75rem'
  },
  tablesWrapper: {
    display: 'grid',
    gap: '1.5rem',
    marginTop: '2rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))'
  },
  clusterStatus: {
    marginTop: '1.5rem',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    borderRadius: '0.75rem',
    padding: '1rem',
    backgroundColor: '#111c30'
  },
  clusterTitle: {
    margin: '0 0 0.75rem'
  },
  clusterList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'grid',
    gap: '0.5rem'
  },
  clusterItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    fontSize: '0.9rem',
    color: '#cbd5f5'
  },
  tableColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  }
};
