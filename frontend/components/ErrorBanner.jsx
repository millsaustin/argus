'use client';

export default function ErrorBanner({ title, message, hint }) {
  return (
    <div style={styles.container} role="alert">
      {title && <h3 style={styles.title}>{title}</h3>}
      {message && <p style={styles.message}>{message}</p>}
      {hint && <p style={styles.hint}>Hint: {hint}</p>}
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: '#2d1f1f',
    border: '1px solid rgba(248, 113, 113, 0.6)',
    color: '#fecaca',
    padding: '1rem',
    borderRadius: '0.6rem',
    margin: '1rem 0'
  },
  title: {
    margin: '0 0 0.5rem',
    fontSize: '1rem',
    color: '#f87171'
  },
  message: {
    margin: '0 0 0.5rem'
  },
  hint: {
    margin: 0,
    fontStyle: 'italic',
    color: '#fca5a5'
  }
};
