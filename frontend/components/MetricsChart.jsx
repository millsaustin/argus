'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';

function formatTimestamp(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch (error) {
    return ts;
  }
}

export default function MetricsChart({ data }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <p className="rounded-lg border border-dashed border-border/60 bg-card/50 p-6 text-center text-sm text-muted-foreground">No metrics captured for this VM yet.</p>;
  }

  const chartData = data.map((point) => ({
    ...point,
    cpu: point.cpu_pct,
    mem: point.mem_pct,
    disk: point.disk_pct,
    tsLabel: formatTimestamp(point.ts)
  }));

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
          <XAxis dataKey="tsLabel" stroke="#94a3b8" tick={{ fontSize: 12 }} minTickGap={24} />
          <YAxis unit="%" domain={[0, 100]} stroke="#94a3b8" tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} />
          <Legend />
          <Line type="monotone" dataKey="cpu" name="CPU %" stroke="#60a5fa" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="mem" name="RAM %" stroke="#34d399" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  color: '#f8fafc'
};

const tooltipLabelStyle = {
  color: '#f8fafc'
};
