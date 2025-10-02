'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, X } from 'lucide-react';

import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import GlobalAlert from '../components/GlobalAlert.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.jsx';
import { getCurrentUser, getProposals, respondToProposal, getApiErrorMessage } from '../lib/api.js';

const STATUS_LABELS = {
  PENDING: 'Pending',
  PENDING_SECOND_APPROVAL: 'Pending second approval',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  DENIED: 'Denied'
};

const STATUS_VARIANTS = {
  PENDING: 'warning',
  PENDING_SECOND_APPROVAL: 'warning',
  COMPLETED: 'success',
  FAILED: 'destructive',
  DENIED: 'destructive'
};

export default function ProposalsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [actionState, setActionState] = useState({ id: null, decision: null });

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const currentUser = await getCurrentUser();
        if (!cancelled) {
          setUser(currentUser);
        }
      } catch (err) {
        if (err?.status === 401) {
          router.replace('/login');
          return;
        }
        setError({ title: 'Session error', message: getApiErrorMessage(err, 'Failed to load session') });
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!user) return undefined;

    let cancelled = false;

    async function loadProposals() {
      try {
        setLoading(true);
        const data = await getProposals();
        if (!cancelled) {
          setProposals(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError({ title: 'Failed to load proposals', message: getApiErrorMessage(err) });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProposals();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const isAdmin = useMemo(() => (user?.role || '').toLowerCase() === 'admin', [user]);

  const handleDecision = async (proposal, decision) => {
    if (!isAdmin) return;
    setActionState({ id: proposal.id, decision });
    setBanner(null);
    try {
      const response = await respondToProposal(proposal.id, decision);
      if (response?.ok) {
        const resolvedStatus = response?.result?.status || (response?.results ? 'COMPLETED' : decision === 'deny' ? 'DENIED' : 'COMPLETED');
        const resolvedResults = response?.results || response?.result?.results || [];
        setProposals((prev) =>
          prev.map((item) =>
            item.id === proposal.id
              ? {
                  ...item,
                  status: resolvedStatus,
                  details: {
                    ...item.details,
                    results: resolvedResults.length ? resolvedResults : item.details?.results || []
                  }
                }
              : item
          )
        );
        setBanner({ type: 'success', message: `Proposal ${proposal.id} ${decision === 'deny' ? 'denied' : 'approved'} successfully.` });
      } else {
        setBanner({ type: 'error', message: getApiErrorMessage(new Error('Proposal update failed')) });
      }
    } catch (err) {
      setBanner({ type: 'error', message: getApiErrorMessage(err, 'Proposal update failed') });
    } finally {
      setActionState({ id: null, decision: null });
    }
  };

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Button asChild variant="ghost" className="mb-4 w-fit">
          <Link href="/dashboard" className="inline-flex items-center">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Link>
        </Button>

        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Assistant proposals</h1>
          <p className="text-muted-foreground">Review and manage assistant-generated action plans.</p>
        </header>

        {banner && <GlobalAlert type={banner.type === 'success' ? 'info' : 'error'} message={banner.message} />}
        {error && <ErrorBanner title={error.title} message={error.message} />}
        {loading && <Loading label="Loading proposals…" />}

        {!loading && !error && (
          <Card className="bg-card/80">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">Proposal queue</CardTitle>
                <CardDescription>
                  {isAdmin ? 'Approve or deny pending proposals.' : 'Monitor the status of your submitted proposals.'}
                </CardDescription>
              </div>
              <Badge variant="outline" className="uppercase tracking-wide text-xs">{proposals.length} proposals</Badge>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Timestamp</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Summary</TableHead>
                    {isAdmin && <TableHead className="w-[160px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 6 : 5} className="py-10 text-center text-sm text-muted-foreground">
                        No proposals yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    proposals.map((proposal) => {
                      const statusLabel = STATUS_LABELS[proposal.status] || proposal.status;
                      const badgeVariant = STATUS_VARIANTS[proposal.status] || 'outline';
                      const summary = proposal.summary || 'No summary provided';
                      const isPending = proposal.status === 'PENDING' || proposal.status === 'PENDING_SECOND_APPROVAL';

                      return (
                        <TableRow key={proposal.id} className="hover:bg-muted/20">
                          <TableCell className="whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">
                            {new Date(proposal.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-foreground">{proposal.id}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{proposal.createdBy || '—'}</TableCell>
                          <TableCell>
                            <Badge variant={badgeVariant}>{statusLabel}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-foreground">{summary}</TableCell>
                          {isAdmin && (
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={!isPending || actionState.id === proposal.id}
                                  onClick={() => handleDecision(proposal, 'approve')}
                                >
                                  <Check className="mr-1 h-4 w-4" /> Approve
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={!isPending || actionState.id === proposal.id}
                                  onClick={() => handleDecision(proposal, 'deny')}
                                >
                                  <X className="mr-1 h-4 w-4" /> Deny
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
