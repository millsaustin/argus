'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Info, SendHorizontal, X } from 'lucide-react';
import Link from 'next/link';

import ErrorBanner from '../components/ErrorBanner.jsx';
import GlobalAlert from '../components/GlobalAlert.jsx';
import Loading from '../components/Loading.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '../components/ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip.jsx';
import {
  getApiErrorMessage,
  getCurrentUser,
  getProposals,
  respondToProposal,
  submitAssistantPrompt
} from '../lib/api.js';

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

const PLACEHOLDER_REGEX = /\[REDACTED_[A-Z]+_\d+\]/g;

export default function AssistantPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);

  const [prompt, setPrompt] = useState('');
  const [promptError, setPromptError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [actionState, setActionState] = useState({ id: null, decision: null });

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const current = await getCurrentUser();
        if (!cancelled) {
          setUser(current);
        }
      } catch (err) {
        if (!cancelled) {
          if (err?.status === 401) {
            router.replace('/login');
            return;
          }
          setError({ title: 'Session error', message: getApiErrorMessage(err, 'Failed to load session.') });
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadProposals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getProposals();
      setProposals(data);
      setError(null);
    } catch (err) {
      setError({ title: 'Failed to load proposals', message: getApiErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    (async () => {
      await loadProposals();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loadProposals]);

  const role = useMemo(() => String(user?.role || 'viewer').toLowerCase(), [user]);
  const isOperator = role === 'operator' || role === 'admin';
  const isAdmin = role === 'admin';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!prompt || submitting) return;

    const trimmed = prompt.trim();
    if (!trimmed) {
      setPromptError('Prompt is required.');
      return;
    }
    if (trimmed.length > 1000) {
      setPromptError('Prompt must be 1000 characters or less.');
      return;
    }

    setSubmitting(true);
    setPromptError(null);
    setBanner(null);

    try {
      await submitAssistantPrompt(trimmed);
      setBanner({ type: 'success', message: 'Proposal submitted for analysis. Sanitized preview will refresh shortly.' });
      setPrompt('');
      await loadProposals();
    } catch (err) {
      setPromptError(getApiErrorMessage(err, 'Unable to submit prompt.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (proposal, decision) => {
    if (!isAdmin) return;
    setActionState({ id: proposal.id, decision });
    setBanner(null);
    try {
      const response = await respondToProposal(proposal.id, decision);
      if (response?.ok) {
        const status = response?.result?.status || response?.status || (decision === 'deny' ? 'DENIED' : 'COMPLETED');
        const results = response?.results || response?.result?.results || [];
        setProposals((prev) =>
          prev.map((item) =>
            item.id === proposal.id
              ? {
                  ...item,
                  status,
                  details: {
                    ...item.details,
                    results: results.length ? results : item.details?.results || []
                  }
                }
              : item
          )
        );
        setBanner({ type: 'info', message: `Proposal ${proposal.id} ${decision === 'deny' ? 'denied' : 'approved'}.` });
      } else {
        setBanner({ type: 'error', message: 'Proposal update failed.' });
      }
    } catch (err) {
      setBanner({ type: 'error', message: getApiErrorMessage(err, 'Proposal update failed.') });
    } finally {
      setActionState({ id: null, decision: null });
    }
  };

  const toggleExpanded = (id) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <Button asChild variant="ghost" className="mb-4 w-fit">
            <Link href="/dashboard" className="inline-flex items-center">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
            </Link>
          </Button>

          <header className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Assistant command center</h1>
            <p className="text-muted-foreground">
              Submit prompts to generate action plans and review sanitized proposals.
            </p>
          </header>

          {banner && <GlobalAlert type={banner.type === 'success' ? 'info' : banner.type} message={banner.message} />}
          {error && <ErrorBanner title={error.title} message={error.message} />}

          {isOperator && (
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Submit prompt</CardTitle>
                <CardDescription>
                  Sensitive values are automatically replaced with placeholders like <PlaceholderBadge value="[REDACTED_TOKEN_1]" /> before the assistant sees them.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                  <label htmlFor="assistantPrompt" className="text-sm font-medium text-muted-foreground">
                    Prompt <span className="text-xs text-muted-foreground">(max 1000 characters)</span>
                  </label>
                  <textarea
                    id="assistantPrompt"
                    name="assistantPrompt"
                    className="h-40 w-full rounded-lg border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground shadow-inner focus:outline-none focus:ring-2 focus:ring-primary"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Describe the action plan you need the assistant to prepare…"
                    maxLength={1000}
                    required
                  />
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5" />
                    Placeholders like <code>[REDACTED_*]</code> represent hidden secrets. Only the executor sees real values.
                  </p>
                  {promptError && <p className="text-sm text-destructive">{promptError}</p>}
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={submitting}>
                    <SendHorizontal className="mr-2 h-4 w-4" />
                    {submitting ? 'Submitting…' : 'Submit prompt'}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          )}

          {loading && <Loading label="Loading proposals…" />}

          {!loading && !error && (
            <Card className="bg-card/80">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold">Proposal queue</CardTitle>
                  <CardDescription>
                    {isAdmin ? 'Approve or deny pending proposals.' : 'Track the status of sanitized plans you submitted.'}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="uppercase tracking-wide text-xs">
                  {proposals.length} proposals
                </Badge>
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
                        const isExpanded = expandedId === proposal.id;

                        return (
                          <Fragment key={proposal.id}>
                            <TableRow key={proposal.id} className="cursor-pointer hover:bg-muted/20" onClick={() => toggleExpanded(proposal.id)}>
                              <TableCell className="whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground">
                                {new Date(proposal.createdAt).toLocaleString()}
                              </TableCell>
                              <TableCell className="font-mono text-sm text-foreground">{proposal.id}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{proposal.createdBy || '—'}</TableCell>
                              <TableCell>
                                <Badge variant={badgeVariant}>{statusLabel}</Badge>
                              </TableCell>
                              <TableCell className="text-sm text-foreground">
                                <SanitizedText text={summary} />
                              </TableCell>
                              {isAdmin && (
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={actionState.id === proposal.id && actionState.decision === 'approve'}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleExpanded(proposal.id);
                                      }}
                                    >
                                      Details
                                    </Button>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="outline"
                                      disabled={!isPending || actionState.id === proposal.id}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleDecision(proposal, 'approve');
                                      }}
                                    >
                                      {actionState.id === proposal.id && actionState.decision === 'approve' ? (
                                        <LoadingSpinner />
                                      ) : (
                                        <Check className="h-4 w-4" />
                                      )}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="outline"
                                      disabled={!isPending || actionState.id === proposal.id}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleDecision(proposal, 'deny');
                                      }}
                                    >
                                      {actionState.id === proposal.id && actionState.decision === 'deny' ? (
                                        <LoadingSpinner />
                                      ) : (
                                        <X className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                            {isExpanded && (
                              <TableRow key={`${proposal.id}-expanded`} className="bg-muted/10">
                                <TableCell colSpan={isAdmin ? 6 : 5} className="space-y-4 border-t border-border/60 px-6 py-5">
                                  <ExpandedProposalDetails proposal={proposal} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
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
    </TooltipProvider>
  );
}

function PlaceholderBadge({ value }) {
  if (!value) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center rounded-md bg-muted/40 px-2 py-0.5 font-mono text-[11px] tracking-tight text-primary">
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">
        Real value hidden for security. Only the executor sees the original string during run-time.
      </TooltipContent>
    </Tooltip>
  );
}

function SanitizedText({ text }) {
  if (text == null) return <span className="text-muted-foreground">—</span>;
  const value = String(text);
  const parts = value.split(PLACEHOLDER_REGEX);
  const matches = value.match(PLACEHOLDER_REGEX) || [];

  if (matches.length === 0) {
    return <span>{value}</span>;
  }

  const nodes = [];
  parts.forEach((part, index) => {
    if (part) {
      nodes.push(
        <span key={`segment-${index}`} className="text-foreground">
          {part}
        </span>
      );
    }
    const placeholder = matches[index];
    if (placeholder) {
      nodes.push(<PlaceholderBadge key={`placeholder-${index}`} value={placeholder} />);
    }
  });

  return <span className="inline-flex flex-wrap items-center gap-1 text-sm">{nodes}</span>;
}

function HighlightedPre({ value }) {
  if (value == null) return null;
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const parts = stringValue.split(PLACEHOLDER_REGEX);
  const matches = stringValue.match(PLACEHOLDER_REGEX) || [];
  const nodes = [];

  parts.forEach((part, index) => {
    if (part) {
      nodes.push(
        <span key={`pre-text-${index}`} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    }
    const placeholder = matches[index];
    if (placeholder) {
      nodes.push(
        <span key={`pre-placeholder-${index}`} className="inline-flex items-center">
          <PlaceholderBadge value={placeholder} />
        </span>
      );
    }
  });

  return <pre className="max-h-80 overflow-auto rounded-lg bg-muted/20 p-4 text-xs text-muted-foreground">{nodes}</pre>;
}

function ExpandedProposalDetails({ proposal }) {
  const sanitizedPrompt =
    proposal.details?.sanitizedPrompt ||
    proposal.details?.sanitizedPreview ||
    proposal.prompt ||
    '';
  const sanitizedProposal = proposal.details?.proposal || proposal.proposal || {};
  const steps = Array.isArray(sanitizedProposal?.steps) ? sanitizedProposal.steps : [];
  const results = Array.isArray(proposal.details?.results) ? proposal.details.results : [];

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Info className="h-4 w-4 text-primary" /> Prompt
        </h3>
        <HighlightedPre value={sanitizedPrompt} />
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Info className="h-4 w-4 text-primary" /> Proposed steps
        </h3>
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No steps returned.</p>
        ) : (
          <HighlightedPre value={steps} />
        )}
      </section>

      {results.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Info className="h-4 w-4 text-primary" /> Execution results
          </h3>
          <HighlightedPre value={results} />
        </section>
      )}
    </div>
  );
}

function LoadingSpinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-[2px] border-muted-foreground/70 border-t-transparent" />;
}
