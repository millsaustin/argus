'use client';

import { Loader2, Play, RotateCcw, Square } from 'lucide-react';

import Loading from './Loading.jsx';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx';
import { Badge } from './ui/badge.jsx';
import { Button } from './ui/button.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.jsx';
import { cn } from '../lib/utils.js';

function formatPercent(value, total) {
  if (typeof value !== 'number') return '—';
  let percent = value;
  if (typeof total === 'number' && total > 0) {
    percent = (value / total) * 100;
  } else if (value <= 1) {
    percent = value * 100;
  }
  if (!Number.isFinite(percent)) return '—';
  return `${percent.toFixed(1)}%`;
}

function formatUptime(seconds) {
  if (typeof seconds !== 'number') return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.length ? parts.join(' ') : `${seconds}s`;
}

function statusVariant(status) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'running' || normalized === 'online') return 'success';
  if (normalized === 'stopped' || normalized === 'stopped (disabled)') return 'outline';
  if (normalized === 'paused') return 'warning';
  if (normalized === 'maintenance' || normalized === 'offline') return 'destructive';
  return 'default';
}

function computeStartTime(uptimeSeconds) {
  if (typeof uptimeSeconds !== 'number' || uptimeSeconds <= 0) return null;
  return new Date(Date.now() - uptimeSeconds * 1000);
}

export default function VmListTable({ title, items, onVmSelect, onVmAction, role = 'viewer', actionBusyKey }) {
  const normalizedRole = String(role || 'viewer').toLowerCase();
  const canOperateRole = normalizedRole === 'operator' || normalizedRole === 'admin';
  const hasActionHandler = typeof onVmAction === 'function';
  const canOperate = canOperateRole && hasActionHandler;

  if (items == null) {
    return (
      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Loading label="Loading resources…" />
        </CardContent>
      </Card>
    );
  }

  if (!Array.isArray(items) || items.length === 0) {
    return (
      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No items to display.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/80">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-hidden">
        <TooltipProvider>
          <div className="overflow-x-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow className="bg-muted/20">
                  <TableHead className="w-[70px]">VMID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uptime</TableHead>
                  <TableHead className="text-right">CPU</TableHead>
                  <TableHead className="text-right">Mem</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => {
                  const key = item.vmid ?? item.id;
                  const name = item.name || item.node || item.hostname || '—';
                  const status = item.status || item.state || '—';
                  const uptimeLabel = formatUptime(item.uptime);
                  const startTime = computeStartTime(item.uptime);
                  const tooltipTitle = startTime
                    ? `Started ${startTime.toLocaleString()}`
                    : 'No start time available';
                  const statusLower = (status || '').toLowerCase();
                  const canStart = statusLower !== 'running';
                  const canStop = statusLower === 'running';
                  const canReboot = statusLower === 'running';
                  const hasGlobalBusy = Boolean(actionBusyKey);
                  const actions = [
                    { key: 'start', icon: Play, label: 'Start', disabledByState: !canStart },
                    { key: 'stop', icon: Square, label: 'Stop', disabledByState: !canStop },
                    { key: 'reboot', icon: RotateCcw, label: 'Reboot', disabledByState: !canReboot }
                  ];

                  return (
                    <TableRow
                      key={key}
                      className={cn(
                        'transition-colors hover:bg-muted/30',
                        index % 2 === 0 ? 'bg-transparent' : 'bg-muted/10',
                        onVmSelect && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      )}
                      onClick={() => onVmSelect?.(item)}
                    >
                      <TableCell className="font-mono text-sm text-foreground/80">{item.vmid ?? '—'}</TableCell>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(status)}>{status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help text-sm text-muted-foreground" title={tooltipTitle}>
                              {uptimeLabel}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{tooltipTitle}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatPercent(item.cpu)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatPercent(item.mem, item.maxmem)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {actions.map((action) => {
                            const ActionIcon = action.icon;
                            const actionKey = `${action.key}-${item.vmid}`;
                            const isBusy = actionBusyKey === actionKey;
                            const disabledByRole = !canOperateRole;
                            const disabledNoHandler = !hasActionHandler;
                            const disabled = disabledByRole || disabledNoHandler || action.disabledByState || hasGlobalBusy;
                            const tooltipLabel = disabledByRole
                              ? 'Requires Operator'
                              : disabledNoHandler
                                ? 'Unavailable'
                                : action.disabledByState
                                  ? 'Unavailable for current state'
                                  : isBusy
                                    ? 'Working…'
                                    : hasGlobalBusy
                                      ? 'Another action is already running'
                                      : action.label;

                            const button = (
                              <Button
                                key={action.key}
                                type="button"
                                size="icon"
                                variant="outline"
                                disabled={disabled}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (disabled || !onVmAction) return;
                                  onVmAction(action.key, item);
                                }}
                                className="h-8 w-8"
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ActionIcon className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            );

                            return (
                              <Tooltip key={action.key}>
                                <TooltipTrigger asChild>{button}</TooltipTrigger>
                                <TooltipContent>{tooltipLabel}</TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
