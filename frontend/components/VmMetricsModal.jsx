'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import Loading from './Loading.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import MetricsChart from './MetricsChart.jsx';
import { Button } from './ui/button.jsx';
import { getMetricsHistory, getApiErrorMessage } from '../lib/api.js';

const DEFAULT_HOURS = 24;

export default function VmMetricsModal({ visible, onClose, node, vmid }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !node || !vmid) return undefined;

    let cancelled = false;

    async function loadMetrics() {
      setLoading(true);
      setError(null);
      try {
        const metrics = await getMetricsHistory({ node, vmid, hours: DEFAULT_HOURS });
        if (!cancelled) {
          setData(metrics);
        }
      } catch (err) {
        if (!cancelled) {
          const title = err?.status === 401 || err?.status === 403 ? 'Insufficient permissions' : 'Failed to load metrics';
          setError({ title, message: getApiErrorMessage(err, 'Unexpected error') });
        }
        if (err?.code === 'CSRF_ERROR') {
          setTimeout(() => window.location.assign('/login'), 0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [visible, node, vmid]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl border border-border/60 bg-card p-6 shadow-soft">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-foreground">Metrics for VM {vmid}</h2>
            <p className="text-sm text-muted-foreground">Node {node}. Showing last {DEFAULT_HOURS} hours.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close metrics modal">
            <X className="h-5 w-5" />
          </Button>
        </header>

        <div className="min-h-[22rem] space-y-4">
          {loading && <Loading label="Loading metrics…" />}
          {error && <ErrorBanner title={error.title} message={error.message} />}
          {!loading && !error && <MetricsChart data={data} />}
        </div>
      </div>
    </div>
  );
}
