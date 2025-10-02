'use client';

import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.jsx';
import { Badge } from './ui/badge.jsx';
import { Progress } from './ui/progress.jsx';
import { cn } from '../lib/utils.js';

function formatPercent(value) {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(1)}%`;
}

function computeUsage(raw, max) {
  if (!max || typeof raw !== 'number') return 0;
  const percent = (raw / max) * 100;
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

function normalizeFraction(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

function formatUptime(seconds) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return 'Unknown';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(' ') : `${seconds}s`;
}

function statusMeta(status) {
  const normalized = (status || 'unknown').toLowerCase();
  if (normalized === 'online') {
    return { variant: 'success', label: 'Online', Icon: CheckCircle };
  }
  if (normalized === 'maintenance') {
    return { variant: 'warning', label: 'Maintenance', Icon: AlertTriangle };
  }
  return { variant: 'destructive', label: status || 'Offline', Icon: XCircle };
}

export default function ClusterCard({ node }) {
  if (!node) return null;

  const cpuPercent = normalizeFraction(node.cpu ?? 0);
  const ramPercent = computeUsage(node.mem, node.maxmem);
  const diskPercent = computeUsage(node.disk, node.maxdisk);

  const metrics = [
    { label: 'CPU', value: cpuPercent },
    { label: 'RAM', value: ramPercent },
    { label: 'Disk', value: diskPercent }
  ];

  const { variant, label, Icon } = statusMeta(node.status);

  return (
    <Card className="h-full bg-card/80 backdrop-blur">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-xl">{node.node}</CardTitle>
          <CardDescription>Uptime • {formatUptime(node.uptime)}</CardDescription>
        </div>
        <Badge variant={variant} className="flex items-center gap-1">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <dt className="text-muted-foreground">{metric.label}</dt>
                <dd className={cn('font-semibold', metric.value >= 85 ? 'text-amber-300' : 'text-foreground')}>
                  {formatPercent(metric.value)}
                </dd>
              </div>
              <Progress
                value={metric.value}
                indicatorClassName={cn(
                  metric.value >= 92 ? 'bg-destructive' : metric.value >= 85 ? 'bg-amber-400' : 'bg-primary'
                )}
              />
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
