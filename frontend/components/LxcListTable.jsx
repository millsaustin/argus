'use client';

import Loading from './Loading.jsx';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx';
import { Badge } from './ui/badge.jsx';
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
  const hours = seconds / 3600;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.floor(hours % 24);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (remainingHours) parts.push(`${remainingHours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.length ? parts.join(' ') : `${seconds}s`;
}

function statusVariant(status) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'running' || normalized === 'online') return 'success';
  if (normalized === 'stopped') return 'outline';
  if (normalized === 'paused') return 'warning';
  if (normalized === 'maintenance' || normalized === 'offline') return 'destructive';
  return 'default';
}

function computeStartTime(uptimeSeconds) {
  if (typeof uptimeSeconds !== 'number' || uptimeSeconds <= 0) return null;
  const start = new Date(Date.now() - uptimeSeconds * 1000);
  return start;
}

export default function LxcListTable({ title, items }) {
  if (items == null) {
    return (
      <Card className="bg-card/80">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Loading label="Loading containers…" />
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
      <CardHeader>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => {
                  const key = item.vmid ?? item.id;
                  const name = item.name || item.node || item.hostname || '—';
                  const status = item.status || item.state || '—';
                  const startTime = computeStartTime(item.uptime);
                  const tooltipTitle = startTime
                    ? `Started ${startTime.toLocaleString()}`
                    : 'No start time available';
                  const uptimeLabel = formatUptime(item.uptime);

                  return (
                    <TableRow
                      key={key}
                      className={cn(
                        'transition-colors hover:bg-muted/30',
                        index % 2 === 0 ? 'bg-transparent' : 'bg-muted/10'
                      )}
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
