'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Edit, Plus, ShieldOff } from 'lucide-react';

import ErrorBanner from '../components/ErrorBanner.jsx';
import Loading from '../components/Loading.jsx';
import GlobalAlert from '../components/GlobalAlert.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Label } from '../components/ui/label.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.jsx';
import {
  getApiErrorMessage,
  getCurrentUser,
  getUsers,
  createUserAccount,
  updateUserAccount,
  deactivateUserAccount
} from '../lib/api.js';

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'operator', label: 'Operator' },
  { value: 'admin', label: 'Admin' }
];

export default function UsersPage() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [forbidden, setForbidden] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ username: '', password: '', role: 'viewer' });
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState(null);

  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState('viewer');
  const [forceReset, setForceReset] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);

  const [deactivateUser, setDeactivateUser] = useState(null);
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);
  const [deactivateError, setDeactivateError] = useState(null);

  const isAdmin = useMemo(() => (sessionUser?.role || '').toLowerCase() === 'admin', [sessionUser]);

  const resetAddForm = useCallback(() => {
    setAddForm({ username: '', password: '', role: 'viewer' });
    setAddError(null);
    setAddSubmitting(false);
  }, []);

  const closeAddModal = useCallback(() => {
    setAddOpen(false);
    resetAddForm();
  }, [resetAddForm]);

  const closeEditModal = useCallback(() => {
    setEditUser(null);
    setEditSubmitting(false);
    setEditError(null);
    setForceReset(false);
  }, []);

  const closeDeactivateModal = useCallback(() => {
    setDeactivateUser(null);
    setDeactivateSubmitting(false);
    setDeactivateError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const current = await getCurrentUser();
        if (cancelled) return;
        setSessionUser(current);
        const role = (current?.role || '').toLowerCase();
        if (role !== 'admin') {
          setForbidden(true);
          setPageError({ title: 'Access denied', message: 'Admin role required to manage users.' });
        }
      } catch (err) {
        if (cancelled) return;
        if (err?.status === 401) {
          router.replace('/login');
          return;
        }
        setPageError({ title: 'Session error', message: getApiErrorMessage(err, 'Failed to load session.') });
      } finally {
        if (!cancelled) {
          setLoadingSession(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const list = await getUsers();
      setUsers(list);
      setPageError(null);
      setForbidden(false);
    } catch (err) {
      if (err?.status === 401) {
        router.replace('/login');
        return;
      }
      const title = err?.status === 403 ? 'Access denied' : 'Failed to load users';
      setPageError({ title, message: getApiErrorMessage(err, 'Unable to load users.') });
      if (err?.status === 403) {
        setForbidden(true);
      }
    } finally {
      setLoadingUsers(false);
    }
  }, [router]);

  useEffect(() => {
    if (loadingSession) return;
    if (!isAdmin) return;

    let cancelled = false;
    (async () => {
      await loadUsers();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, loadingSession, loadUsers]);

  useEffect(() => {
    if (editUser) {
      setEditRole(editUser.role || 'viewer');
      setForceReset(false);
      setEditError(null);
    }
  }, [editUser]);

  useEffect(() => {
    if (addOpen) {
      setAddError(null);
    }
  }, [addOpen]);

  useEffect(() => {
    if (deactivateUser) {
      setDeactivateError(null);
    }
  }, [deactivateUser]);

  const handleAddSubmit = async (event) => {
    event.preventDefault();
    if (!isAdmin) return;

    const username = addForm.username.trim();
    const password = addForm.password;
    if (!username || !password) {
      setAddError('Username and password are required.');
      return;
    }

    setAddSubmitting(true);
    setAddError(null);

    try {
      await createUserAccount({ username, password, role: addForm.role });
      setBanner({ type: 'info', message: `User "${username}" created.` });
      closeAddModal();
      await loadUsers();
    } catch (err) {
      if (err?.status === 401) {
        router.replace('/login');
        return;
      }
      if (err?.status === 403) {
        setPageError({ title: 'Access denied', message: getApiErrorMessage(err) });
        setForbidden(true);
        closeAddModal();
        return;
      }
      setAddError(getApiErrorMessage(err, 'Failed to create user.'));
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!editUser || !isAdmin) return;

    const payload = {};
    if (editRole !== (editUser.role || 'viewer')) {
      payload.role = editRole;
    }
    if (forceReset) {
      payload.forcePasswordReset = true;
    }

    if (Object.keys(payload).length === 0) {
      setEditError('Update the role or enable password reset before saving.');
      return;
    }

    setEditSubmitting(true);
    setEditError(null);

    try {
      const result = await updateUserAccount(editUser.id, payload);
      const tempPassword = result?.temporaryPassword;
      await loadUsers();
      const message = tempPassword
        ? `Temporary password for ${editUser.username}: ${tempPassword}`
        : `Updated ${editUser.username}.`;
      setBanner({ type: 'info', message });
      closeEditModal();
    } catch (err) {
      if (err?.status === 401) {
        router.replace('/login');
        return;
      }
      if (err?.status === 403) {
        setPageError({ title: 'Access denied', message: getApiErrorMessage(err) });
        setForbidden(true);
        closeEditModal();
        return;
      }
      setEditError(getApiErrorMessage(err, 'Failed to update user.'));
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateUser || !isAdmin) return;

    setDeactivateSubmitting(true);
    setDeactivateError(null);

    try {
      await deactivateUserAccount(deactivateUser.id);
      await loadUsers();
      setBanner({ type: 'info', message: `Deactivated ${deactivateUser.username}.` });
      closeDeactivateModal();
    } catch (err) {
      if (err?.status === 401) {
        router.replace('/login');
        return;
      }
      if (err?.status === 403) {
        setPageError({ title: 'Access denied', message: getApiErrorMessage(err) });
        setForbidden(true);
        closeDeactivateModal();
        return;
      }
      setDeactivateError(getApiErrorMessage(err, 'Failed to deactivate user.'));
    } finally {
      setDeactivateSubmitting(false);
    }
  };

  if (loadingSession) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loading label="Loading session…" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">User management</h1>
        <p className="text-muted-foreground">
          Create, update, or deactivate Argus accounts. Only administrators can perform these actions.
        </p>
      </header>

      {pageError && <ErrorBanner title={pageError.title} message={pageError.message} />}
      {banner && <GlobalAlert type="info" message={banner.message} />}

      <div className="relative">
        <div className={isAdmin ? '' : 'pointer-events-none opacity-50'}>
          <Card className="bg-card/80">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">Existing users</CardTitle>
                <CardDescription>Active and inactive accounts currently configured for Argus.</CardDescription>
              </div>
              <Button
                onClick={() => {
                  resetAddForm();
                  setAddOpen(true);
                }}
                disabled={!isAdmin}
              >
                <Plus className="mr-2 h-4 w-4" /> Add user
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loadingUsers ? (
                <div className="py-10">
                  <Loading label="Loading users…" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[180px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                          No users found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((user) => {
                        const active = user.active !== false;
                        const selfAccount = sessionUser && sessionUser.username === user.username;
                        return (
                          <TableRow key={user.id || user.username} className="hover:bg-muted/20">
                            <TableCell className="font-medium">{user.username}</TableCell>
                            <TableCell className="capitalize">{user.role}</TableCell>
                            <TableCell>
                              <Badge variant={active ? 'success' : 'outline'}>{active ? 'Active' : 'Inactive'}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setEditUser(user)}
                                  disabled={!isAdmin}
                                >
                                  <Edit className="mr-1 h-4 w-4" /> Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => setDeactivateUser(user)}
                                  disabled={!isAdmin || !active || selfAccount}
                                >
                                  <ShieldOff className="mr-1 h-4 w-4" /> Deactivate
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {!isAdmin && !loadingSession && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-xl border border-border/60 bg-card/90 px-6 py-4 text-center shadow-soft">
              <p className="text-sm font-semibold text-muted-foreground">
                Admin role required to manage users.
              </p>
            </div>
          </div>
        )}
      </div>

      {addOpen && (
        <Modal title="Add user" description="Provide username, password, and role for the new account." onClose={closeAddModal}>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                value={addForm.username}
                onChange={(event) => setAddForm((prev) => ({ ...prev, username: event.target.value }))}
                placeholder="operator01"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                type="password"
                value={addForm.password}
                onChange={(event) => setAddForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="••••••••"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-role">Role</Label>
              <select
                id="new-role"
                className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                value={addForm.role}
                onChange={(event) => setAddForm((prev) => ({ ...prev, role: event.target.value }))}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={closeAddModal} disabled={addSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={addSubmitting}>
                {addSubmitting ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && (
        <Modal
          title={`Edit ${editUser.username}`}
          description="Update the user role or issue a password reset."
          onClose={closeEditModal}
        >
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <select
                id="edit-role"
                className="h-10 w-full rounded-md border border-border/60 bg-background px-3 text-sm capitalize"
                value={editRole}
                onChange={(event) => setEditRole(event.target.value)}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="force-reset"
                type="checkbox"
                className="h-4 w-4"
                checked={forceReset}
                onChange={(event) => setForceReset(event.target.checked)}
              />
              <Label htmlFor="force-reset" className="text-sm text-muted-foreground">
                Force password reset
              </Label>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={closeEditModal} disabled={editSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {deactivateUser && (
        <Modal
          title={`Deactivate ${deactivateUser.username}?`}
          description="The user will be unable to sign in until reactivated."
          onClose={closeDeactivateModal}
        >
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>Confirm deactivation of this account. You can recreate it later with the same username if needed.</p>
            {deactivateError && <p className="text-destructive">{deactivateError}</p>}
            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={closeDeactivateModal} disabled={deactivateSubmitting}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeactivate}
                disabled={deactivateSubmitting}
              >
                {deactivateSubmitting ? 'Deactivating…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function Modal({ title, description, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8">
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-lg text-muted-foreground transition hover:text-foreground"
          aria-label="Close dialog"
        >
          ×
        </button>
        <div className="border-b border-border/40 px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
