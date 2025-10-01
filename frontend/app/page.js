'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomeRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Redirecting…</h1>
      <p style={styles.subtitle}>Taking you to the Argus sign-in page.</p>
    </main>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    gap: '0.75rem'
  },
  title: {
    margin: 0,
    fontSize: '1.8rem',
    fontWeight: 600
  },
  subtitle: {
    margin: 0,
    color: '#94a3b8'
  }
};
