'use client';

export default function Loading({ label = 'Loading…' }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
      {label && <span>{label}</span>}
    </div>
  );
}
