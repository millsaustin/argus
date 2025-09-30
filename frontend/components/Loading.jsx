'use client';

export default function Loading({ label = 'Loading…' }) {
  return (
    <div style={styles.wrapper} role="status" aria-live="polite">
      <div style={styles.spinner} />
      {label && <span style={styles.label}>{label}</span>}
      <style>{spinnerKeyframes}</style>
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.6rem',
    color: '#cbd5f5',
    fontSize: '0.95rem',
    margin: '0.75rem 0'
  },
  spinner: {
    width: '1rem',
    height: '1rem',
    borderRadius: '50%',
    border: '2px solid rgba(148, 163, 184, 0.3)',
    borderTopColor: '#a855f7',
    animation: 'argus-spin 0.9s linear infinite'
  },
  label: {}
};

const spinnerKeyframes = `
@keyframes argus-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;
