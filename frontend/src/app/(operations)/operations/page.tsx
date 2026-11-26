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
  Input,
  Label,
  LoadingSkeleton,
  StepUpDialog,
  formatErrorMessage,
} from '@/components/ui/primitives';
import { operationsApi } from '@/lib/api/client';
import { formatUtcTimestamp, maskIdentifier, parseMajorToMinor } from '@/lib/utils/format';

export default function OperationsDashboardPage() {
  const qc = useQueryClient();
  const dashQuery = useQuery({ queryKey: ['ops-dashboard'], queryFn: () => operationsApi.dashboard() });

  const [targetType, setTargetType] = useState<'TRANSFER' | 'PAYMENT_INTENT'>('TRANSFER');
  const [targetId, setTargetId] = useState('');
  const [refundRupees, setRefundRupees] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'REFUND' | 'REVERSAL'>('REFUND');
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const d = (dashQuery.data?.data ?? {}) as Record<string, unknown>;
  const ledger = (d.ledgerIntegrity ?? {}) as { totalDebits?: number; totalCredits?: number; balanced?: boolean };
  const auditEvents = (d.recentAuditEvents ?? []) as Array<Record<string, unknown>>;

  async function executeFinancialAdjustment(stepUpToken: string) {
    setError(null);
    setSuccess(null);
    try {
      if (mode === 'REVERSAL') {
        await operationsApi.createReversal(
          { transferId: targetId.trim(), reason: reason.trim() || 'Operations reversal' },
          crypto.randomUUID(),
          stepUpToken,
        );
        setSuccess('Compensating full reversal posted cleanly.');
      } else {
        await operationsApi.createRefund(
          {
            ...(targetType === 'PAYMENT_INTENT'
              ? { paymentIntentId: targetId.trim() }
              : { transferId: targetId.trim() }),
            amountMinor: parseMajorToMinor(refundRupees),
            reason: reason.trim() || 'Operations partial refund',
          },
          crypto.randomUUID(),
          stepUpToken,
        );
        setSuccess('Compensating refund journal posted cleanly.');
      }
      setStepUpOpen(false);
      setTargetId('');
      setRefundRupees('');
      setReason('');
      void qc.invalidateQueries({ queryKey: ['ops-dashboard'] });
    } catch (err) {
      setStepUpOpen(false);
      setError(formatErrorMessage(err, 'Adjustment failed'));
    }
  }

  return (
    <AppShell allowedRoles={['SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operations &amp; Finance Dashboard</h1>
          <p className="text-sm text-slate-600">
            Real-time queue counters, ledger invariant verification, and authorized compensating adjustments.
          </p>
        </div>

        {dashQuery.error && <AlertBanner tone="error" message={formatErrorMessage(dashQuery.error, 'Dashboard load failed')} />}
        {error && <AlertBanner tone="error" message={error} />}
        {success && <AlertBanner tone="success" message={success} />}

        {dashQuery.isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card title="Pending Transfers"><p className="text-2xl font-bold">{String(d.pendingTransfers ?? 0)}</p></Card>
            <Card title="Open Disputes"><p className="text-2xl font-bold">{String(d.openDisputes ?? 0)}</p></Card>
            <Card title="Open Risk Alerts"><p className="text-2xl font-bold text-amber-700">{String(d.openRiskAlerts ?? 0)}</p></Card>
            <Card title="Recon Exceptions"><p className="text-2xl font-bold text-red-700">{String(d.openReconciliationExceptions ?? 0)}</p></Card>
            <Card title="DLQ Outbox Jobs"><p className="text-2xl font-bold">{String(d.failedOutboxJobs ?? 0)}</p></Card>
          </div>
        )}

        <Card title="Global Double-Entry Ledger Integrity Check">
          {dashQuery.isLoading ? (
            <LoadingSkeleton rows={1} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-700">
                Posted Debits: <strong>{String(ledger.totalDebits ?? 0)} paise</strong> • Posted Credits:{' '}
                <strong>{String(ledger.totalCredits ?? 0)} paise</strong>
              </div>
              <Badge tone={ledger.balanced ? 'success' : 'danger'}>
                {ledger.balanced ? 'BALANCED (SUM DEBITS == SUM CREDITS)' : 'IMBALANCE DETECTED'}
              </Badge>
            </div>
          )}
        </Card>

        <Card
          title="Authorized Compensating Refund / Reversal"
          subtitle="Creates opposite-effect compensating journals. Never mutates historical ledger entries."
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStepUpOpen(true);
            }}
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
          >
            <div>
              <Label htmlFor="adj-mode">Action Type</Label>
              <select
                id="adj-mode"
                value={mode}
                onChange={(e) => {
                  const val = e.target.value as 'REFUND' | 'REVERSAL';
                  setMode(val);
                  if (val === 'REVERSAL') setTargetType('TRANSFER');
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="REFUND">Partial / Full Refund</option>
                <option value="REVERSAL">Full Transfer Reversal</option>
              </select>
            </div>
            {mode === 'REFUND' && (
              <div>
                <Label htmlFor="adj-target-type">Record Type</Label>
                <select
                  id="adj-target-type"
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as 'TRANSFER' | 'PAYMENT_INTENT')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="TRANSFER">Transfer</option>
                  <option value="PAYMENT_INTENT">Payment Intent</option>
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="adj-tx">
                {targetType === 'PAYMENT_INTENT' ? 'Payment Intent UUID' : 'Transfer UUID'}
              </Label>
              <Input id="adj-tx" value={targetId} onChange={(e) => setTargetId(e.target.value)} required />
            </div>
            {mode === 'REFUND' && (
              <div>
                <Label htmlFor="adj-amt">Amount (INR)</Label>
                <Input id="adj-amt" value={refundRupees} onChange={(e) => setRefundRupees(e.target.value)} required />
              </div>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="adj-reason">Reason</Label>
              <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <div className="sm:col-span-4">
              <Button type="submit">Execute Compensating Journal (Step-Up)</Button>
            </div>
          </form>
        </Card>

        <Card title="Recent Immutable Audit Events">
          {auditEvents.length === 0 ? (
            <EmptyState title="No audit events" description="Actions recorded across API modules appear here." />
          ) : (
            <div className="divide-y divide-slate-100 text-sm">
              {auditEvents.map((ev) => (
                <div key={String(ev.id)} className="flex flex-wrap justify-between gap-2 py-2">
                  <div>
                    <span className="font-semibold text-slate-900">{String(ev.action)}</span>{' '}
                    <span className="text-xs text-slate-500">
                      ({String(ev.resource_type)} {maskIdentifier(String(ev.resource_id ?? ''))})
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">{formatUtcTimestamp(String(ev.created_at))}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <StepUpDialog
          open={stepUpOpen}
          action={mode}
          onClose={() => setStepUpOpen(false)}
          onVerified={executeFinancialAdjustment}
        />
      </div>
    </AppShell>
  );
}
