'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Bell, Info } from 'lucide-react';

import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.jsx';
import { getAlerts, getApiErrorMessage } from '../lib/api.js';

const REFRESH_INTERVAL_MS = 30000;

function alertConfig(severity) {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
      return { variant: 'destructive', Icon: AlertCircle };
    case 'warning':
      return { variant: 'warning', Icon: Bell };
    default:
      return { variant: 'info', Icon: Info };
  }
}

export default function AlertsPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState(new Set());

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
        <p className="text-muted-foreground">Synthetic alerts refreshing every 30 seconds.</p>
      </header>

      {error && <ErrorBanner title={error.title} message={error.message} />}

      {loading && <Loading label="Loading alerts…" />}

      {!loading && !error && (
        <div className="grid gap-4">
          {alerts.length === 0 ? (
            <Card className="border-dashed border-border/60 bg-card/60 p-8 text-center text-sm text-muted-foreground">
              No alerts at the moment.
            </Card>
          ) : (
            alerts
              .filter((alert) => !dismissedIds.has(alert.id))
              .map((alert) => {
                const { variant, Icon } = alertConfig(alert.severity);
                const timestamp = new Date(alert.ts).toLocaleString();

                return (
                  <Alert key={alert.id} variant={variant} className="relative border border-border/50 bg-card/90">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-foreground">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="flex-1 space-y-2">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <AlertTitle className="text-base font-semibold text-foreground">
                            {alert.message}
                          </AlertTitle>
                          <Badge variant="outline" className="uppercase tracking-wide text-xs">
                            {alert.severity || 'info'}
                          </Badge>
                        </div>
                        <AlertDescription className="space-y-2 text-sm text-muted-foreground">
                          <p>{timestamp}</p>
                          {alert.details && <p>{alert.details}</p>}
                        </AlertDescription>
                      </div>
                      <button
                        type="button"
                        className="ml-3 text-xs uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
                        onClick={() => {
                          setDismissedIds((prev) => new Set(prev).add(alert.id));
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </Alert>
                );
              })
          )}
        </div>
      )}
    </div>
  );
}
