'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';

import ErrorBanner from '../components/ErrorBanner.jsx';
import { login, getApiErrorMessage } from '../lib/api.js';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    try {
      await login(username, password);
      router.replace('/dashboard');
    } catch (err) {
      console.error('Login request failed:', err);
      setError(getApiErrorMessage(err, 'Login failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1 style={styles.title}>Sign in to Argus</h1>
        <p style={styles.subtitle}>Use your operator or admin credentials.</p>

        {error && (
          <ErrorBanner title="Login failed" message={error} />
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Username
            <input
              style={styles.input}
              type="text"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label style={styles.label}>
            Password
            <input
              style={styles.input}
              type="password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button
            type="submit"
            style={{ ...styles.button, opacity: isSubmitting ? 0.7 : 1 }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
    color: '#f8fafc',
    padding: '2rem'
  },
  card: {
    width: '100%',
    maxWidth: '360px',
    background: '#111827',
    borderRadius: '0.75rem',
    padding: '2rem',
    boxShadow: '0 20px 45px rgba(15, 23, 42, 0.45)'
  },
  title: {
    margin: 0,
    fontSize: '1.6rem',
    fontWeight: 600
  },
  subtitle: {
    marginTop: '0.4rem',
    marginBottom: '1.5rem',
    color: '#94a3b8'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    fontSize: '0.95rem'
  },
  input: {
    padding: '0.65rem 0.75rem',
    borderRadius: '0.5rem',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    background: '#0f172a',
    color: '#f1f5f9',
    fontSize: '1rem'
  },
  button: {
    marginTop: '0.5rem',
    padding: '0.75rem',
    borderRadius: '0.6rem',
    background: '#2563eb',
    color: '#f8fafc',
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer'
  }
};
