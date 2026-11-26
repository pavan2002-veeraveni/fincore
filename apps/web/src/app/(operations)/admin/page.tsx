'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/navigation/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSkeleton,
  StepUpDialog,
  formatErrorMessage,
  statusTone,
} from '@/components/ui/primitives';
import { adminApi } from '@/lib/api/client';
import { formatUtcTimestamp, maskIdentifier } from '@/lib/utils/format';

const ALL_ROLES = ['CUSTOMER', 'SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'];

type PendingAdminAction =
  | { type: 'ROLE'; userId: string; role: string }
  | { type: 'STATUS'; userId: string; status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' };

export default function AdminPage() {
  const qc = useQueryClient();
  const usersQuery = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users() });
  const auditQuery = useQuery({ queryKey: ['admin-audit'], queryFn: () => adminApi.auditEvents() });
  const cfgQuery = useQuery({ queryKey: ['admin-config'], queryFn: () => adminApi.config() });
  const outboxQuery = useQuery({ queryKey: ['admin-outbox-failed'], queryFn: () => adminApi.failedOutbox() });

  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<PendingAdminAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function applyStepUpAction(stepUpToken: string) {
    if (!pendingAction) return;
    setError(null);
    setNotice(null);
    try {
      if (pendingAction.type === 'ROLE') {
        await adminApi.updateRoles(pendingAction.userId, [pendingAction.role], stepUpToken);
        setNotice(`User role updated to ${pendingAction.role} and recorded in audit trail.`);
      } else {
        await adminApi.updateUserStatus(
          pendingAction.userId,
          pendingAction.status,
          stepUpToken,
          `Platform admin updated user status to ${pendingAction.status}`,
        );
        setNotice(`User status set to ${pendingAction.status}.`);
      }
      setPendingAction(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-users'] }),
        qc.invalidateQueries({ queryKey: ['admin-audit'] }),
      ]);
    } catch (err) {
      setPendingAction(null);
      setError(formatErrorMessage(err, 'Administrative update failed'));
    }
  }

  async function handleReplayOutbox(outboxId: string) {
    setError(null);
    setNotice(null);
    try {
      await adminApi.replayOutbox(outboxId);
      setNotice(`Replayed dead-letter outbox event ${maskIdentifier(outboxId)}.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-outbox-failed'] }),
        qc.invalidateQueries({ queryKey: ['admin-audit'] }),
      ]);
    } catch (err) {
      setError(formatErrorMessage(err, 'Failed to replay DLQ event'));
    }
  }

  const users = usersQuery.data?.data ?? [];
  const audits = auditQuery.data?.data ?? [];
  const failedOutbox = outboxQuery.data?.data ?? [];
  const cfg = (cfgQuery.data?.data ?? {}) as Record<string, unknown>;

  return (
    <AppShell allowedRoles={['FINANCE_ADMIN', 'PLATFORM_ADMIN']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Administration &amp; Audit Trail</h1>
          <p className="text-sm text-slate-600">
            Role and account status governance require PLATFORM_ADMIN step-up confirmation and immutable audit logging.
          </p>
        </div>

        {(usersQuery.error || auditQuery.error || cfgQuery.error || outboxQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={
              error ||
              formatErrorMessage(
                usersQuery.error || auditQuery.error || cfgQuery.error || outboxQuery.error,
                'Admin workspace error',
              )
            }
          />
        )}
        {notice && <AlertBanner tone="success" message={notice} />}

        <Card title="Safe Platform Configuration (Non-Secret Runtime Flags)">
          {cfgQuery.isLoading ? (
            <LoadingSkeleton rows={1} />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              {Object.entries(cfg).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs font-medium text-slate-600">{k}</dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-900">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        <Card title="Synthetic Users &amp; RBAC Assignments">
          {usersQuery.isLoading ? (
            <LoadingSkeleton rows={4} />
          ) : users.length === 0 ? (
            <EmptyState title="No users found" description="Synthetic users appear here." />
          ) : (
            <div className="divide-y divide-slate-200 text-sm">
              {users.map((u) => {
                const uid = String(u.id);
                const roles = (u.roles as string[]) ?? [];
                const status = String(u.status);
                const currentSelection = selectedRoles[uid] ?? roles[0] ?? 'CUSTOMER';
                return (
                  <div key={uid} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {String(u.first_name)} {String(u.last_name)} ({String(u.email)})
                      </div>
                      <div className="mt-1 flex gap-1.5">
                        <Badge tone={statusTone(status)}>{status}</Badge>
                        {roles.map((r) => (
                          <Badge key={r} tone="info">{r}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Change role for ${String(u.email)}`}
                        value={currentSelection}
                        onChange={(e) => setSelectedRoles((prev) => ({ ...prev, [uid]: e.target.value }))}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingAction({ type: 'ROLE', userId: uid, role: currentSelection })}
                      >
                        Apply Role
                      </Button>
                      {status === 'ACTIVE' ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setPendingAction({ type: 'STATUS', userId: uid, status: 'SUSPENDED' })}
                        >
                          Suspend
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPendingAction({ type: 'STATUS', userId: uid, status: 'ACTIVE' })}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Dead-Letter Outbox Queue (DLQ Recovery)">
          {outboxQuery.isLoading ? (
            <LoadingSkeleton rows={2} />
          ) : failedOutbox.length === 0 ? (
            <EmptyState
              title="No dead-letter events"
              description="Failed outbox notification jobs that exhaust retries appear here for controlled replay."
            />
          ) : (
            <div className="divide-y divide-slate-200 text-sm">
              {failedOutbox.map((evt) => {
                const oid = String(evt.id);
                return (
                  <div key={oid} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {String(evt.event_type)} ({String(evt.aggregate_type)} {maskIdentifier(String(evt.aggregate_id))})
                      </div>
                      <div className="text-xs text-red-700">Error: {String(evt.error || 'Unknown failure')}</div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => handleReplayOutbox(oid)}>
                      Replay Outbox Job
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Immutable Security &amp; Financial Audit Trail">
          {auditQuery.isLoading ? (
            <LoadingSkeleton rows={4} />
          ) : audits.length === 0 ? (
            <EmptyState title="No audit events" description="Security and financial actions appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 uppercase text-slate-600">
                  <tr>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Resource</th>
                    <th className="py-2 pr-3">Actor</th>
                    <th className="py-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {audits.map((a) => (
                    <tr key={String(a.id)}>
                      <td className="py-2 pr-3 font-semibold text-slate-900">{String(a.action)}</td>
                      <td className="py-2 pr-3 font-mono text-slate-600">
                        {String(a.resource_type)} {maskIdentifier(String(a.resource_id ?? ''))}
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-600">{maskIdentifier(String(a.actor_id ?? 'SYSTEM'))}</td>
                      <td className="py-2 text-slate-600">{formatUtcTimestamp(String(a.created_at))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <StepUpDialog
          open={Boolean(pendingAction)}
          action="ROLE_CHANGE"
          onClose={() => setPendingAction(null)}
          onVerified={applyStepUpAction}
        />
      </div>
    </AppShell>
  );
}
