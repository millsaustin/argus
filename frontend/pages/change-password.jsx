'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';

import ErrorBanner from '../components/ErrorBanner.jsx';
import GlobalAlert from '../components/GlobalAlert.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Label } from '../components/ui/label.jsx';
import { changePassword, getApiErrorMessage } from '../lib/api.js';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    const initialUsername = typeof router.query.username === 'string' ? router.query.username : '';
    if (initialUsername) {
      setUsername(initialUsername);
    }
  }, [router.isReady, router.query.username]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setSuccess(null);

    if (!username || !oldPassword || !newPassword) {
      setError('Username, current password, and new password are required.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation must match.');
      return;
    }

    setIsSubmitting(true);

    try {
      await changePassword({ username, oldPassword, newPassword });
      setSuccess('Password updated successfully. You can now sign in with your new password.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        router.replace('/login');
      }, 2000);
    } catch (err) {
      console.error('Password change failed:', err);
      setError(getApiErrorMessage(err, 'Unable to change password.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-foreground">
      <Card className="w-full max-w-lg bg-card/90 backdrop-blur">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-semibold">Change password</CardTitle>
          <CardDescription>Update your credentials before continuing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <ErrorBanner title="Password update failed" message={error} />}
          {success && <GlobalAlert type="info" message={success} />}

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
              <Label htmlFor="oldPassword">Current password</Label>
              <Input
                id="oldPassword"
                type="password"
                name="oldPassword"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                name="newPassword"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
                placeholder="••••••••"
              />
              <p className="text-xs text-muted-foreground">
                Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Updating…' : 'Change password'}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
