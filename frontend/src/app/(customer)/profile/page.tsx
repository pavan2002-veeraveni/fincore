'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { AppShell } from '@/components/navigation/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  LoadingSkeleton,
  formatErrorMessage,
} from '@/components/ui/primitives';
import { authApi, customersApi } from '@/lib/api/client';
import { formatUtcTimestamp, maskIdentifier } from '@/lib/utils/format';

const ProfileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required').max(200),
  phoneNumber: z.string().regex(/^\+?[0-9\s\-()]+$/, 'Invalid synthetic phone format').optional().or(z.literal('')),
  addressLine1: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
});

export default function ProfileAndSessionsPage() {
  const qc = useQueryClient();
  const meQuery = useQuery({ queryKey: ['customer-profile-me'], queryFn: () => customersApi.me() });
  const sessionsQuery = useQuery({ queryKey: ['auth-sessions'], queryFn: () => authApi.listSessions() });

  const [displayName, setDisplayName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const data = meQuery.data?.data;
    if (!data) return;
    const profile = (data.profile as Record<string, unknown> | undefined) ?? {};
    setDisplayName(String(profile.display_name ?? `${data.first_name ?? ''} ${data.last_name ?? ''}`).trim());
    setPhoneNumber(String(data.phone_number ?? ''));
    setCity(String(profile.city ?? ''));
    setState(String(profile.state ?? ''));
  }, [meQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const parsed = ProfileSchema.safeParse({
        displayName: displayName.trim(),
        phoneNumber: phoneNumber.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'Invalid profile details');
      }
      return customersApi.updateMe(parsed.data);
    },
    onSuccess: () => {
      setError(null);
      setSuccess('Synthetic profile saved cleanly.');
      void qc.invalidateQueries({ queryKey: ['customer-profile-me'] });
    },
    onError: (err) => setError(formatErrorMessage(err, 'Failed to update profile')),
  });

  async function handleRevoke(id: string) {
    setError(null);
    setSuccess(null);
    try {
      await authApi.revokeSession(id);
      setSuccess('Session and associated refresh tokens revoked.');
      void qc.invalidateQueries({ queryKey: ['auth-sessions'] });
    } catch (err) {
      setError(formatErrorMessage(err, 'Could not revoke session'));
    }
  }

  const sessions = sessionsQuery.data?.data ?? [];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Profile &amp; Active Sessions</h1>
          <p className="text-sm text-slate-600">
            Manage synthetic identity profile attributes and inspect or revoke active refresh-token sessions.
          </p>
        </div>

        {(meQuery.error || sessionsQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={
              error ||
              formatErrorMessage(meQuery.error || sessionsQuery.error, 'Failed to load account settings')
            }
          />
        )}
        {success && <AlertBanner tone="success" message={success} />}

        <Card title="Synthetic Identity Profile">
          {meQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateMutation.mutate();
              }}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div>
                <Label htmlFor="prof-name">Display Name</Label>
                <Input id="prof-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="prof-phone">Synthetic Phone</Label>
                <Input id="prof-phone" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="prof-city">City</Label>
                <Input id="prof-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="prof-state">State</Label>
                <Input id="prof-state" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save Synthetic Profile'}
                </Button>
              </div>
            </form>
          )}
        </Card>

        <Card title="Active Sessions">
          {sessionsQuery.isLoading ? (
            <LoadingSkeleton rows={2} />
          ) : sessions.length === 0 ? (
            <EmptyState title="No active sessions" description="Active refresh sessions appear here." />
          ) : (
            <div className="divide-y divide-slate-200 text-sm">
              {sessions.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <div className="font-mono text-xs text-slate-800">
                      Session {maskIdentifier(s.id)} • {s.ipAddress || 'local'}
                    </div>
                    <div className="text-xs text-slate-600">
                      {s.userAgent ? s.userAgent.slice(0, 72) : 'Browser session'} • Created{' '}
                      {formatUtcTimestamp(s.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'ACTIVE' : 'REVOKED'}</Badge>
                    {s.isActive && (
                      <Button size="sm" variant="outline" onClick={() => handleRevoke(s.id)}>
                        Revoke Session
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
