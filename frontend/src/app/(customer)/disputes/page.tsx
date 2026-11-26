'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  statusTone,
} from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { disputesApi } from '@/lib/api/client';
import { formatUtcTimestamp, maskIdentifier } from '@/lib/utils/format';

export default function DisputesPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const isStaff = hasRole('SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN');

  const [targetType, setTargetType] = useState<'TRANSFER' | 'PAYMENT_INTENT'>('TRANSFER');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDisputeId, setSelectedDisputeId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const disputesQuery = useQuery({ queryKey: ['disputes'], queryFn: () => disputesApi.list() });
  const detailQuery = useQuery({
    queryKey: ['dispute-detail', selectedDisputeId],
    queryFn: () => disputesApi.getById(selectedDisputeId!),
    enabled: Boolean(selectedDisputeId),
  });

  const disputes = disputesQuery.data?.data ?? [];
  const detail = detailQuery.data?.data as (Record<string, unknown> & { events?: Array<Record<string, unknown>> }) | undefined;

  const createMutation = useMutation({
    mutationFn: () =>
      disputesApi.create({
        ...(targetType === 'PAYMENT_INTENT'
          ? { paymentIntentId: targetId.trim() }
          : { transferId: targetId.trim() }),
        reason: reason.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (res) => {
      setTargetId('');
      setReason('');
      setDescription('');
      setError(null);
      setSelectedDisputeId(String((res.data as { id?: string }).id ?? '') || null);
      void qc.invalidateQueries({ queryKey: ['disputes'] });
    },
    onError: (err) => setError(formatErrorMessage(err, 'Failed to open dispute')),
  });

  async function transitionDispute(id: string, toStatus: string) {
    setError(null);
    try {
      await disputesApi.addEvent(id, {
        eventType: 'STATUS_CHANGE',
        toStatus,
        comment: commentText.trim() || `Updated status to ${toStatus}`,
      });
      setCommentText('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['disputes'] }),
        qc.invalidateQueries({ queryKey: ['dispute-detail', id] }),
      ]);
    } catch (err) {
      setError(formatErrorMessage(err, 'Could not update dispute'));
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDisputeId || !commentText.trim()) return;
    setError(null);
    try {
      await disputesApi.addEvent(selectedDisputeId, {
        eventType: 'COMMENT',
        comment: commentText.trim(),
      });
      setCommentText('');
      void qc.invalidateQueries({ queryKey: ['dispute-detail', selectedDisputeId] });
    } catch (err) {
      setError(formatErrorMessage(err, 'Could not post comment'));
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dispute Case Management</h1>
          <p className="text-sm text-slate-600">
            Append-only dispute history. Financial adjustments must be issued separately via authorized refund/reversal.
          </p>
        </div>

        {(disputesQuery.error || detailQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={
              error ||
              formatErrorMessage(disputesQuery.error || detailQuery.error, 'Failed to load disputes')
            }
          />
        )}

        {hasRole('CUSTOMER') && (
          <Card title="Open Synthetic Dispute">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="grid gap-3 sm:grid-cols-3"
            >
              <div>
                <Label htmlFor="disp-target-type">Record Type</Label>
                <select
                  id="disp-target-type"
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as 'TRANSFER' | 'PAYMENT_INTENT')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="TRANSFER">Transfer</option>
                  <option value="PAYMENT_INTENT">Payment Intent</option>
                </select>
              </div>
              <div>
                <Label htmlFor="disp-tx">
                  {targetType === 'PAYMENT_INTENT' ? 'Payment Intent UUID' : 'Transfer UUID'}
                </Label>
                <Input
                  id="disp-tx"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="UUID of disputed transaction"
                  required
                />
              </div>
              <div>
                <Label htmlFor="disp-reason">Dispute Reason</Label>
                <Input
                  id="disp-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Simulated incorrect settlement"
                  required
                />
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor="disp-desc">Notes (Synthetic Information Only)</Label>
                <Input
                  id="disp-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="sm:col-span-3">
                <Button type="submit" disabled={createMutation.isPending}>
                  Submit Dispute
                </Button>
              </div>
            </form>
          </Card>
        )}

        <Card title="Disputes">
          {disputesQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : disputes.length === 0 ? (
            <EmptyState title="No disputes recorded" description="Disputes submitted by customers appear here." />
          ) : (
            <div className="divide-y divide-slate-200">
              {disputes.map((d) => {
                const id = String(d.id);
                const status = String(d.status);
                return (
                  <div key={id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-semibold text-slate-900">{String(d.reason)}</div>
                      <div className="text-xs text-slate-600">
                        Dispute {maskIdentifier(id)} • Created {formatUtcTimestamp(String(d.created_at))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(status)}>{status}</Badge>
                      <Button size="sm" variant="outline" onClick={() => setSelectedDisputeId(id)}>
                        Timeline
                      </Button>
                      {isStaff && (status === 'OPEN' || status === 'INFORMATION_REQUESTED') && (
                        <Button size="sm" variant="outline" onClick={() => transitionDispute(id, 'UNDER_REVIEW')}>
                          Start Review
                        </Button>
                      )}
                      {isStaff && status === 'UNDER_REVIEW' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => transitionDispute(id, 'INFORMATION_REQUESTED')}>
                            Request Info
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => transitionDispute(id, 'RESOLVED_ACCEPTED')}>
                            Accept
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => transitionDispute(id, 'RESOLVED_REJECTED')}>
                            Reject
                          </Button>
                        </>
                      )}
                      {isStaff && (status === 'RESOLVED_ACCEPTED' || status === 'RESOLVED_REJECTED') && (
                        <Button size="sm" variant="outline" onClick={() => transitionDispute(id, 'CLOSED')}>
                          Close Case
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {selectedDisputeId && (
          <Card
            title={`Dispute Timeline (${maskIdentifier(selectedDisputeId)})`}
            action={
              <Button size="sm" variant="outline" onClick={() => setSelectedDisputeId(null)}>
                Close Panel
              </Button>
            }
          >
            {detailQuery.isLoading ? (
              <LoadingSkeleton rows={2} />
            ) : (
              <div className="space-y-4">
                <div className="divide-y divide-slate-100 text-xs">
                  {(detail?.events ?? []).map((ev) => (
                    <div key={String(ev.id)} className="py-2">
                      <div className="flex items-center justify-between font-semibold text-slate-800">
                        <span>
                          {String(ev.event_type)}
                          {ev.to_status ? ` → ${String(ev.to_status)}` : ''}
                        </span>
                        <span className="text-slate-600">{formatUtcTimestamp(String(ev.created_at))}</span>
                      </div>
                      {Boolean(ev.comment) && <p className="mt-1 text-slate-700">{String(ev.comment)}</p>}
                    </div>
                  ))}
                </div>
                <form onSubmit={addComment} className="flex flex-wrap gap-2">
                  <Input
                    aria-label="Add dispute comment or synthetic evidence note"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add note or comment..."
                    className="flex-1"
                    required
                  />
                  <Button type="submit" size="sm">
                    Post Comment
                  </Button>
                </form>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
