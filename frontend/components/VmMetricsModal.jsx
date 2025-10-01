'use client';

import { useEffect, useState } from 'react';

import Loading from './Loading.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import MetricsChart from './MetricsChart.jsx';
import { getMetricsHistory, getApiErrorMessage } from '../lib/api.js';

const DEFAULT_HOURS = 24;

export default function VmMetricsModal({ visible, onClose, node, vmid }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return undefined;
    if (!node || !vmid) return undefined;

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
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <header style={styles.header}>
          <div>
            <h2 style={styles.title}>Metrics for VM {vmid}</h2>
            <p style={styles.subtitle}>Node: {node}. Showing last {DEFAULT_HOURS} hours.</p>
          </div>
          <button type="button" style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </header>

        <div style={styles.body}>
          {loading && <Loading label="Loading metrics…" />}
          {error && <ErrorBanner title={error.title} message={error.message} />}
          {!loading && !error && <MetricsChart data={data} />}
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '2rem'
  },
  modal: {
    width: 'min(900px, 100%)',
    backgroundColor: '#0b1220',
    borderRadius: '1rem',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    padding: '1.5rem',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.35)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem'
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    color: '#e2e8f0'
  },
  subtitle: {
    margin: '0.25rem 0 0',
    color: '#94a3b8'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: '1.5rem',
    cursor: 'pointer'
  },
  body: {
    minHeight: '360px'
  }
};
