'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.jsx';
import { getRecentLogs, getApiErrorMessage, getLogUsers } from '../lib/api.js';

const DATE_RANGES = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' }
];

export default function LogsPage() {
  const router = useRouter();
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [availableActions, setAvailableActions] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [filters, setFilters] = useState({ user: 'all', action: 'all', range: '24h', from: '', to: '' });

  useEffect(() => {
    let cancelled = false;
    async function loadUsers() {
      try {
        const data = await getLogUsers();
        if (!cancelled) {
          setUsers(data);
        }
      } catch (err) {
        console.warn('Failed to load log users:', err);
      }
    }
    loadUsers();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveRange = useMemo(() => {
    const now = Date.now();
    switch (filters.range) {
      case '24h':
        return { from: new Date(now - 24 * 60 * 60 * 1000), to: new Date(now) };
      case '7d':
        return { from: new Date(now - 7 * 24 * 60 * 60 * 1000), to: new Date(now) };
      case 'custom':
        return {
          from: filters.from ? new Date(filters.from) : undefined,
          to: filters.to ? new Date(filters.to) : undefined
        };
      default:
        return { from: undefined, to: undefined };
    }
  }, [filters]);

  useEffect(() => {
    let cancelled = false;

    async function loadLogs() {
      try {
        setLoading(true);
        const params = {
          limit: 100,
          user: filters.user !== 'all' ? filters.user : undefined,
          action: filters.action !== 'all' ? filters.action : undefined,
          from: effectiveRange.from ? effectiveRange.from.toISOString() : undefined,
          to: effectiveRange.to ? effectiveRange.to.toISOString() : undefined
        };
        const data = await getRecentLogs(params);
        if (!cancelled) {
          setEntries(data);
          setError(null);
          const uniqueActions = Array.from(
            new Set(data.map((entry) => entry.action).filter(Boolean))
          ).sort();
          setAvailableActions(uniqueActions);
        }
      } catch (err) {
        if (!cancelled) {
          setError({
            title: err?.status === 401 || err?.status === 403 ? 'Access denied' : 'Failed to load logs',
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

    loadLogs();

    return () => {
      cancelled = true;
    };
  }, [router, filters, effectiveRange]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground">Most recent 100 entries. Use filters to refine results.</p>
      </header>

      {error && <ErrorBanner title={error.title} message={error.message} />}
      {loading && <Loading label="Loading audit log…" />}

      <Card className="bg-card/60">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Filters</CardTitle>
          <CardDescription>Adjust filters to narrow down audit events.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">User</label>
            <select
              className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
              value={filters.user}
              onChange={(event) => setFilters((prev) => ({ ...prev, user: event.target.value }))}
            >
              <option value="all">All users</option>
              {users.map((username) => (
                <option key={username} value={username}>
                  {username}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Action</label>
            <select
              className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
              value={filters.action}
              onChange={(event) => setFilters((prev) => ({ ...prev, action: event.target.value }))}
            >
              <option value="all">All actions</option>
              {availableActions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Date range</label>
            <select
              className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
              value={filters.range}
              onChange={(event) => setFilters((prev) => ({ ...prev, range: event.target.value }))}
            >
              {DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>
          </div>
          {filters.range === 'custom' && (
            <>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">From</label>
                <input
                  type="datetime-local"
                  className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  value={filters.from}
                  onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">To</label>
                <input
                  type="datetime-local"
                  className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  value={filters.to}
                  onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!loading && !error && (
        <Card className="bg-card/80">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">Cluster activity</CardTitle>
              <CardDescription>Latest actions, approvals, and audit trails.</CardDescription>
            </div>
            <Badge variant="outline" className="uppercase tracking-wide text-xs">{entries.length} records</Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No entries matching the filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => (
                    <TableRow
                      key={entry.id}
                      className="cursor-pointer transition-colors hover:bg-muted/20"
                      onClick={() => {
                        setSelectedEntry(entry);
                        setDialogOpen(true);
                      }}
                    >
                      <TableCell className="whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">
                        {new Date(entry.ts).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{entry.user || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entry.role || '—'}</TableCell>
                      <TableCell className="text-sm">{entry.action || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={entry.result === 'success' ? 'success' : entry.result === 'fail' ? 'destructive' : 'outline'}>
                          {entry.result || '—'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {dialogOpen && selectedEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8">
          <div className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl border border-border/60 bg-card p-6 shadow-soft">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="absolute right-4 top-4 text-lg text-muted-foreground transition hover:text-foreground"
            >
              ×
            </button>
            <header className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold">Audit entry details</h2>
              <p className="text-sm text-muted-foreground">Full metadata for the selected log entry.</p>
            </header>
            <div className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <LogField label="Timestamp" value={new Date(selectedEntry.ts).toLocaleString()} />
                <LogField label="User" value={`${selectedEntry.user || '—'} (${selectedEntry.role || '—'})`} />
                <LogField label="Action" value={selectedEntry.action || '—'} />
                <LogField label="Result" value={selectedEntry.result || '—'} badge />
                {selectedEntry.node && <LogField label="Node" value={selectedEntry.node} />}
                {selectedEntry.vmid && <LogField label="VMID" value={selectedEntry.vmid} />}
                {selectedEntry.correlationId && (
                  <LogField label="Correlation ID" value={selectedEntry.correlationId} mono full />
                )}
              </div>

              {selectedEntry.details && (
                <div className="space-y-4">
                  {renderJsonSection('Request payload', selectedEntry.details.request)}
                  {renderJsonSection('Response payload', selectedEntry.details.response)}
                  {renderJsonSection('Prompt', selectedEntry.details.prompt)}
                  {renderJsonSection('Proposal', selectedEntry.details.proposal)}
                  {renderJsonSection('Additional details', deriveAdditionalDetails(selectedEntry.details))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LogField({ label, value, badge = false, mono = false, full = false }) {
  if (!value) return null;
  if (badge) {
    return (
      <div className={full ? 'sm:col-span-2' : undefined}>
        <p className="text-muted-foreground">{label}</p>
        <Badge variant={value === 'success' ? 'success' : value === 'fail' ? 'destructive' : 'outline'}>{value}</Badge>
      </div>
    );
  }
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <p className="text-muted-foreground">{label}</p>
      <p className={mono ? 'font-mono text-xs text-foreground' : 'font-medium text-foreground'}>{value}</p>
    </div>
  );
}

function renderJsonSection(title, value) {
  if (value == null) return null;
  const formatted = formatJson(value);
  const isJson = typeof value === 'object';

  return (
    <section className="rounded-lg border border-border/40 bg-background/40 p-4">
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      {isJson ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
          {formatted}
        </pre>
      ) : (
        <p className="text-sm text-foreground">{formatted}</p>
      )}
    </section>
  );
}

function formatJson(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function deriveAdditionalDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const { request, response, prompt, proposal, ...rest } = details;
  if (Object.keys(rest).length === 0) return null;
  return rest;
}
