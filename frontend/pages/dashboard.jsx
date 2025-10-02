'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { PauseCircle, PlayCircle, RefreshCw } from 'lucide-react';

import ClusterCard from '../components/ClusterCard.jsx';
import Loading from '../components/Loading.jsx';
import GlobalAlert from '../components/GlobalAlert.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import VmListTable from '../components/VmListTable.jsx';
import LxcListTable from '../components/LxcListTable.jsx';
import VmMetricsModal from '../components/VmMetricsModal.jsx';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import {
  getNodes,
  getClusterStatus,
  getQemuForNode,
  getLxcForNode,
  getMetricsHistory,
  getApiErrorMessage,
  getCurrentUser,
  performVmAction
} from '../lib/api.js';
import MetricsChart from '../components/MetricsChart.jsx';
import { Progress } from '../components/ui/progress.jsx';
import { cn } from '../lib/utils.js';

function formatNodeUptime(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return 'Unknown';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.length ? parts.join(' ') : `${seconds}s`;
}

function computeCpuPercent(cpuFraction) {
  if (typeof cpuFraction !== 'number' || Number.isNaN(cpuFraction)) return 0;
  return cpuFraction <= 1 ? cpuFraction * 100 : cpuFraction;
}

function computeMemPercent(mem, maxmem) {
  if (typeof mem !== 'number' || typeof maxmem !== 'number' || maxmem <= 0) return 0;
  return (mem / maxmem) * 100;
}

const REFRESH_INTERVAL_MS = 10000;

function statusBadgeVariant(status) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'online' || normalized === 'running') return 'success';
  if (normalized === 'maintenance') return 'warning';
  if (normalized === 'offline' || normalized === 'stopped') return 'destructive';
  return 'outline';
}

export default function DashboardPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState(null);
  const [selectedNode, setSelectedNode] = useState('');
  const [clusterStatus, setClusterStatus] = useState([]);
  const [qemuItems, setQemuItems] = useState(null);
  const [lxcItems, setLxcItems] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [userRole, setUserRole] = useState('viewer');

  const [nodesError, setNodesError] = useState(null);
  const [clusterError, setClusterError] = useState(null);
  const [qemuError, setQemuError] = useState(null);
  const [lxcError, setLxcError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [metricsVm, setMetricsVm] = useState(null);
  const [previewVm, setPreviewVm] = useState(null);
  const [nodeMetrics, setNodeMetrics] = useState({ vm: null, data: [], loading: false, error: null });
  const [actionState, setActionState] = useState({ busyKey: null, message: null, type: null });

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
        setSelectedNode((prev) => prev || first);
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

    setQemuItems(null);
    setLxcItems(null);
    setQemuError(null);
    setLxcError(null);

    try {
      const data = await getQemuForNode(nodeName);
      setQemuItems(Array.isArray(data) ? data : []);
    } catch (error) {
      setQemuError(error);
      setQemuItems([]);
    }

    try {
      const data = await getLxcForNode(nodeName);
      setLxcItems(Array.isArray(data) ? data : []);
    } catch (error) {
      setLxcError(error);
      setLxcItems([]);
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
    let cancelled = false;

    async function bootstrap() {
      try {
        const user = await getCurrentUser();
        if (!cancelled) {
          const normalized = String(user?.role || 'viewer').toLowerCase();
          setUserRole(normalized);
          setAuthChecked(true);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthChecked(true);
          if (error?.status === 401) {
            router.replace('/login');
          }
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!authChecked) return undefined;

    refreshAll();
  }, [authChecked, refreshAll]);

  useEffect(() => {
    if (!authChecked || !selectedNode) return undefined;

    loadNodeResources(selectedNode).then(() => setLastUpdated(Date.now()));

    if (!autoRefresh) return undefined;

    const interval = setInterval(() => {
      refreshAll();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [selectedNode, autoRefresh, refreshAll, loadNodeResources, authChecked]);

  useEffect(() => {
    setPreviewVm(null);
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedNode) {
      setNodeMetrics({ vm: null, data: [], loading: false, error: null });
      return;
    }

    if (qemuItems === null) {
      setNodeMetrics((prev) => ({ ...prev, vm: null, data: [], loading: true, error: null }));
      return;
    }

    if (!Array.isArray(qemuItems) || qemuItems.length === 0) {
      setNodeMetrics({ vm: null, data: [], loading: false, error: null });
      return;
    }

    const targetVm = (() => {
      if (previewVm && previewVm.node === selectedNode) {
        return previewVm;
      }
      return qemuItems[0];
    })();

    if (!targetVm?.vmid) {
      setNodeMetrics({ vm: null, data: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setNodeMetrics({ vm: targetVm, data: [], loading: true, error: null });

    getMetricsHistory({ node: selectedNode, vmid: targetVm.vmid, hours: 24 })
      .then((metrics) => {
        if (cancelled) return;
        setNodeMetrics({ vm: targetVm, data: metrics, loading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setNodeMetrics({
          vm: targetVm,
          data: [],
          loading: false,
          error: getApiErrorMessage(error, 'Metrics history unavailable')
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNode, qemuItems, previewVm]);

  const handleVmSelect = useCallback((vm) => {
    if (!vm?.vmid) return;
    setPreviewVm({ ...vm, node: selectedNode });
    setMetricsVm({ vmid: vm.vmid, node: selectedNode });
  }, [selectedNode]);

  const handleNodeSelect = useCallback((nodeName) => {
    setSelectedNode(nodeName);
    loadNodeResources(nodeName);
  }, [loadNodeResources]);

  const handleVmAction = useCallback(
    async (action, vm) => {
      if (!selectedNode || !vm?.vmid || actionState.busyKey) return;
      const key = `${action}-${vm.vmid}`;
      setActionState({ busyKey: key, message: null, type: null });
      try {
        await performVmAction(action, { node: selectedNode, vmid: vm.vmid });
        setActionState({ busyKey: null, message: `${action.toUpperCase()} request sent for VM ${vm.vmid}.`, type: 'info' });
        await refreshAll();
      } catch (error) {
        setActionState({
          busyKey: null,
          message: getApiErrorMessage(error, `Failed to ${action} VM ${vm.vmid}`),
          type: 'error'
        });
        if (error?.code === 'CSRF_ERROR' || error?.status === 401) {
          router.replace('/login');
        }
      }
    },
    [actionState.busyKey, refreshAll, selectedNode, router]
  );

  const anyOffline = Array.isArray(nodes) && nodes.some((node) => (node.status || '').toLowerCase() !== 'online');

  const clusterSummary = useMemo(() => {
    const summary = {
      quorum: null,
      services: [],
      nodeOnline: 0,
      nodeOffline: 0,
      totalNodes: 0
    };

    for (const entry of clusterStatus) {
      if (entry.type === 'quorum') {
        summary.quorum = entry;
      }
      if (entry.type === 'service') {
        summary.services.push({ name: entry.id || entry.name || 'service', status: entry.status || entry.state });
      }
      if (entry.type === 'node') {
        summary.totalNodes += 1;
        const isOnline = (entry.status || entry.state || entry.health || '').toLowerCase() === 'online';
        if (isOnline) {
          summary.nodeOnline += 1;
        } else {
          summary.nodeOffline += 1;
        }
      }
    }

    return summary;
  }, [clusterStatus]);

  return (
    <div className="space-y-6">
      {actionState.message && (
        <GlobalAlert type={actionState.type === 'error' ? 'error' : 'info'} message={actionState.message} />
      )}

      <Card className="bg-card/80 shadow-soft">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Cluster controls</CardTitle>
            <CardDescription>Manage refresh cadence and keep-togethers.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={autoRefresh ? 'secondary' : 'outline'}
              className="min-w-[160px] justify-center"
              onClick={() => setAutoRefresh((value) => !value)}
              disabled={Boolean(actionState.busyKey)}
            >
              {autoRefresh ? (
                <>
                  <PauseCircle className="mr-2 h-4 w-4" />
                  Auto-refresh on
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Auto-refresh off
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={refreshAll} className="justify-center" disabled={Boolean(actionState.busyKey)}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh now
            </Button>
            {lastUpdated && (
              <Badge variant="outline" className="text-xs uppercase tracking-wide">
                Updated {new Date(lastUpdated).toLocaleTimeString()}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {clusterError && (
            <ErrorBanner
              title="Cluster status unavailable"
              message={clusterError.message}
              hint={clusterError.hint}
            />
          )}
          {nodesError && (
            <ErrorBanner title="Failed to load nodes" message={nodesError.message} hint={nodesError.hint} />
          )}
          {anyOffline && !clusterError && (
            <GlobalAlert type="warning" message="One or more nodes are offline." />
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/80 shadow-soft">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Node grid</CardTitle>
            <CardDescription>Select a node to focus workloads and metrics.</CardDescription>
          </div>
          <Badge variant="outline" className="text-xs uppercase tracking-wide">
            {selectedNode ? `Selected: ${selectedNode}` : 'Select a node'}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.isArray(nodes) && nodes.length > 0 ? (
              nodes.map((node) => {
                const normalizedStatus = (node.status || '').toLowerCase();
                const isActive = node.node === selectedNode;
                const cpuPercent = computeCpuPercent(node.cpu ?? 0);
                const memPercent = computeMemPercent(node.mem, node.maxmem);

                return (
                  <button
                    key={node.node}
                    type="button"
                    onClick={() => handleNodeSelect(node.node)}
                    className={cn(
                      'flex h-full flex-col gap-4 rounded-xl border border-border/60 bg-background/60 p-4 text-left transition-colors duration-200 hover:border-primary/60 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      isActive && 'border-primary shadow-lg shadow-primary/30'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold text-foreground">{node.node}</p>
                        <p className="text-muted-foreground">Uptime: {formatNodeUptime(node.uptime)}</p>
                      </div>
                      <Badge variant={statusBadgeVariant(node.status)}>{node.status || 'unknown'}</Badge>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>CPU</span>
                          <span className="font-semibold text-foreground">{cpuPercent.toFixed(1)}%</span>
                        </div>
                        <Progress
                          value={cpuPercent}
                          indicatorClassName={cn(
                            cpuPercent >= 92 ? 'bg-destructive' : cpuPercent >= 75 ? 'bg-amber-400' : 'bg-primary'
                          )}
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>RAM</span>
                          <span className="font-semibold text-foreground">{memPercent ? memPercent.toFixed(1) : '—'}%</span>
                        </div>
                        <Progress
                          value={memPercent}
                          indicatorClassName={cn(
                            memPercent >= 92 ? 'bg-destructive' : memPercent >= 75 ? 'bg-amber-400' : 'bg-primary'
                          )}
                        />
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="rounded-lg border border-dashed border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
                No nodes available.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/80 shadow-soft">
        <CardHeader>
          <CardTitle>Node details</CardTitle>
          <CardDescription>Expanded metrics, workloads, and history for the selected node.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {currentNode ? (
            <ClusterCard node={currentNode} />
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
              Select a node to view details.
            </div>
          )}

          {nodeMetrics.vm && (
            <div className="space-y-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Metrics preview • {nodeMetrics.vm.name || `VM ${nodeMetrics.vm.vmid}`}
                </p>
                <Badge variant="outline" className="text-xs uppercase tracking-wide">
                  Last 24 hours
                </Badge>
              </div>
              {nodeMetrics.loading ? (
                <Loading label="Loading metrics…" />
              ) : nodeMetrics.error ? (
                <ErrorBanner title="Unable to load metrics" message={nodeMetrics.error} />
              ) : (
                <MetricsChart data={nodeMetrics.data} />
              )}
            </div>
          )}

          {qemuError && (
            <ErrorBanner title="Unable to load VMs" message={qemuError.message} hint={qemuError.hint} />
          )}
          {lxcError && (
            <ErrorBanner title="Unable to load containers" message={lxcError.message} hint={lxcError.hint} />
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            <VmListTable
              title="Virtual Machines (QEMU)"
              items={qemuItems}
              onVmSelect={handleVmSelect}
              onVmAction={handleVmAction}
              role={userRole}
              actionBusyKey={actionState.busyKey}
            />
            <LxcListTable title="Containers (LXC)" items={lxcItems} />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/80 shadow-soft">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>Cluster status</CardTitle>
            <CardDescription>Quorum, services, and node availability.</CardDescription>
          </div>
          <Badge variant="outline" className="uppercase tracking-wide text-xs">
            {clusterSummary.nodeOnline}/{clusterSummary.totalNodes} online
          </Badge>
        </CardHeader>
        <CardContent>
          {clusterStatus.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-border/40 bg-background/40 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Quorum</p>
                <p className="mt-2 text-sm font-semibold text-foreground">Cluster Quorum</p>
                <Badge
                  variant={statusBadgeVariant(
                    clusterSummary.quorum?.status || clusterSummary.quorum?.state || clusterSummary.quorum?.health
                  )}
                  className="mt-3"
                >
                  {clusterSummary.quorum?.status || clusterSummary.quorum?.state || clusterSummary.quorum?.health || 'unknown'}
                </Badge>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Core services</p>
                <ul className="mt-3 space-y-2 text-sm">
                  {clusterSummary.services.map((service) => (
                    <li key={service.name} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{service.name}</span>
                      <Badge variant={statusBadgeVariant(service.status)}>{service.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/40 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Node availability</p>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Online</span>
                  <Badge variant="success">{clusterSummary.nodeOnline}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Offline</span>
                  <Badge variant={clusterSummary.nodeOffline > 0 ? 'destructive' : 'outline'}>
                    {clusterSummary.nodeOffline}
                  </Badge>
                </div>
                <div className="mt-4 text-xs text-muted-foreground">
                  {clusterSummary.totalNodes} nodes total
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
              No cluster status information available.
            </p>
          )}
        </CardContent>
      </Card>

      <VmMetricsModal
        visible={Boolean(metricsVm)}
        onClose={() => setMetricsVm(null)}
        node={metricsVm?.node}
        vmid={metricsVm?.vmid}
      />
    </div>
  );
}
