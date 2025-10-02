'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/router';

import ErrorBanner from '../components/ErrorBanner.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Label } from '../components/ui/label.jsx';
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
      if (err?.code === 'PASSWORD_CHANGE_REQUIRED') {
        const target = `/change-password?username=${encodeURIComponent(username)}`;
        router.replace(target);
        return;
      }
      setError(getApiErrorMessage(err, 'Login failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-foreground">
      <Image src="/argus-logo.png" alt="Argus" width={180} height={56} priority className="mb-6 h-auto w-[180px]" />
      <Card className="w-full max-w-md bg-card/90 backdrop-blur">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-semibold">Sign in</CardTitle>
          <CardDescription>Use your operator or admin credentials.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <ErrorBanner title="Login failed" message={error} />}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
                placeholder="admin"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
