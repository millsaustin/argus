'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import { getRecentLogs, getApiErrorMessage } from '../lib/api.js';

export default function LogsPage() {
  const router = useRouter();
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLogs() {
      try {
        setLoading(true);
        const data = await getRecentLogs({ limit: 100 });
        setEntries(data);
        setError(null);
      } catch (err) {
        setError({
          title: err?.status === 401 || err?.status === 403 ? 'Access denied' : 'Failed to load logs',
          message: getApiErrorMessage(err, 'Unexpected error')
        });
        if (err?.code === 'CSRF_ERROR' || err?.status === 401) {
          router.replace('/login');
        }
      } finally {
        setLoading(false);
      }
    }

    loadLogs();
  }, [router]);

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Audit Log</h1>
      <p style={styles.subtitle}>Most recent 100 entries.</p>

      {error && (
        <ErrorBanner title={error.title} message={error.message} />
      )}

      {loading && <Loading label="Loading audit log…" />}

      {!loading && !error && (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan="5" style={styles.empty}>No recent entries.</td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={`${entry.ts}-${entry.action}-${entry.user}`}>
                    <td>{new Date(entry.ts).toLocaleString()}</td>
                    <td>{entry.user || '—'}</td>
                    <td>{entry.role || '—'}</td>
                    <td>{entry.action || '—'}</td>
                    <td>{entry.result || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
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
  tableWrapper: {
    overflowX: 'auto',
    borderRadius: '0.75rem',
    background: '#111c30',
    padding: '1rem'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  empty: {
    textAlign: 'center',
    padding: '1rem',
    color: '#94a3b8'
  }
};
