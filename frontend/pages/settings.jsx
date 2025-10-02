'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button } from '../components/ui/button.jsx';

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Button asChild variant="ghost" className="mb-4 w-fit">
          <Link href="/dashboard" className="inline-flex items-center">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Link>
        </Button>

        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">Configuration options will appear here.</p>
        </header>

        <section className="rounded-xl border border-dashed border-border/60 bg-card/50 p-8 text-center text-sm text-muted-foreground">
          Settings management is coming soon.
        </section>
      </div>
    </main>
  );
}
