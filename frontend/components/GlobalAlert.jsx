'use client';

const palette = {
  error: {
    background: 'rgba(248, 113, 113, 0.18)',
    border: 'rgba(248, 113, 113, 0.45)',
    color: '#fee2e2'
  },
  warning: {
    background: 'rgba(251, 191, 36, 0.18)',
    border: 'rgba(251, 191, 36, 0.4)',
    color: '#fef3c7'
  },
  info: {
    background: 'rgba(59, 130, 246, 0.18)',
    border: 'rgba(59, 130, 246, 0.4)',
    color: '#dbeafe'
  }
};

export default function GlobalAlert({ type = 'info', message }) {
  if (!message) return null;

  const colors = palette[type] || palette.info;

  return (
    <div style={{
      ...styles.container,
      backgroundColor: colors.background,
      borderColor: colors.border,
      color: colors.color
    }} role="status">
      {message}
    </div>
  );
}

const styles = {
  container: {
    border: '1px solid transparent',
    borderRadius: '0.75rem',
    padding: '0.85rem 1rem',
    marginBottom: '1rem',
    fontWeight: 600
  }
};
