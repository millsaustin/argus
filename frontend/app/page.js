'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomeRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">Redirecting…</h1>
      <p className="max-w-md text-base text-muted-foreground">Taking you to the Argus sign-in page.</p>
    </main>
  );
}
