'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import { getAlerts, getApiErrorMessage } from '../lib/api.js';

const REFRESH_INTERVAL_MS = 30000;

export default function AlertsPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAlerts() {
      try {
        setLoading(true);
        const data = await getAlerts();
        if (!cancelled) {
          setAlerts(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError({
            title: err?.status === 401 || err?.status === 403 ? 'Access denied' : 'Failed to load alerts',
            message: getApiErrorMessage(err, 'Unexpected error')
          });
          if (err?.code === 'CSRF_ERROR' || err?.status === 401) {
            router.replace('/login');
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAlerts();
    const id = setInterval(loadAlerts, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Alerts</h1>
      <p style={styles.subtitle}>Synthetic alerts (refreshing every 30 seconds).</p>

      {error && (
        <ErrorBanner title={error.title} message={error.message} />
      )}

      {loading && <Loading label="Loading alerts…" />}

      {!loading && !error && (
        <ul style={styles.list}>
          {alerts.length === 0 ? (
            <li style={styles.empty}>No alerts at the moment.</li>
          ) : (
            alerts.map((alert) => (
              <li key={alert.id} style={{ ...styles.alert, ...severityStyles(alert.severity) }}>
                <strong>{alert.severity?.toUpperCase()}</strong>
                <span>{alert.message}</span>
                <time>{new Date(alert.ts).toLocaleString()}</time>
              </li>
            ))
          )}
        </ul>
      )}
    </main>
  );
}

function severityStyles(severity) {
  switch (severity) {
    case 'critical':
      return { borderLeft: '6px solid #f87171', backgroundColor: 'rgba(248, 113, 113, 0.1)' };
    case 'warning':
      return { borderLeft: '6px solid #facc15', backgroundColor: 'rgba(250, 204, 21, 0.1)' };
    case 'info':
    default:
      return { borderLeft: '6px solid #38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)' };
  }
}

const styles = {
  page: {
    padding: '2rem',
    minHeight: '100vh',
    background: '#0f172a',
    color: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
  },
  title: {
    margin: 0,
    fontSize: '2rem',
    fontWeight: 600
  },
  subtitle: {
    marginTop: '0.25rem',
    marginBottom: '1.5rem',
    color: '#94a3b8'
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  alert: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    padding: '1rem',
    borderRadius: '0.75rem'
  },
  empty: {
    textAlign: 'center',
    padding: '2rem',
    borderRadius: '0.75rem',
    background: 'rgba(255,255,255,0.05)',
    color: '#94a3b8'
  }
};
