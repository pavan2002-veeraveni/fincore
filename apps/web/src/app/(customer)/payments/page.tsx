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
  StepUpDialog,
  formatErrorMessage,
  statusTone,
} from '@/components/ui/primitives';
import { operationsApi, paymentsApi, walletsApi } from '@/lib/api/client';
import { formatInrMinor, formatUtcTimestamp, maskIdentifier, parseMajorToMinor } from '@/lib/utils/format';

export default function PaymentsSandboxPage() {
  const qc = useQueryClient();
  const [walletId, setWalletId] = useState('');
  const [amountRupees, setAmountRupees] = useState('500.00');
  const [refundIntent, setRefundIntent] = useState<{ id: string; amountMinor: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const walletsQuery = useQuery({ queryKey: ['wallets'], queryFn: () => walletsApi.list() });
  const intentsQuery = useQuery({ queryKey: ['payment-intents'], queryFn: () => paymentsApi.list() });

  const wallets = walletsQuery.data?.data ?? [];
  const intents = intentsQuery.data?.data ?? [];
  const effectiveWalletId = walletId || wallets[0]?.id || '';

  const createMutation = useMutation({
    mutationFn: () =>
      paymentsApi.create(
        {
          walletId: effectiveWalletId,
          amountMinor: parseMajorToMinor(amountRupees),
          currency: 'INR',
          description: 'Sandbox deposit intent',
        },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setError(null);
      setNotice('Sandbox payment intent created in PENDING state. Trigger a simulated webhook below.');
      void qc.invalidateQueries({ queryKey: ['payment-intents'] });
    },
    onError: (err) => setError(formatErrorMessage(err, 'Failed to create intent')),
  });

  async function triggerWebhook(id: string, eventType: 'payment.captured' | 'payment.failed') {
    setError(null);
    setNotice(null);
    try {
      await paymentsApi.simulateWebhook(id, eventType);
      setNotice(`Signed sandbox webhook (${eventType}) processed.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['payment-intents'] }),
        qc.invalidateQueries({ queryKey: ['wallets'] }),
      ]);
    } catch (err) {
      setError(formatErrorMessage(err, 'Webhook simulation failed'));
    }
  }

  async function handleRefundIntent(stepUpToken: string) {
    if (!refundIntent) return;
    setError(null);
    setNotice(null);
    try {
      await operationsApi.createRefund(
        {
          paymentIntentId: refundIntent.id,
          amountMinor: refundIntent.amountMinor,
          reason: 'Customer requested sandbox deposit refund',
        },
        crypto.randomUUID(),
        stepUpToken,
      );
      setRefundIntent(null);
      setNotice('Compensating refund journal posted for payment intent.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['payment-intents'] }),
        qc.invalidateQueries({ queryKey: ['wallets'] }),
      ]);
    } catch (err) {
      setRefundIntent(null);
      setError(formatErrorMessage(err, 'Payment refund failed'));
    }
  }

  return (
    <AppShell allowedRoles={['CUSTOMER']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payment Intent Sandbox Demo</h1>
          <p className="text-sm text-slate-600">
            Demonstrates Workflow B: Payment Intent creation + HMAC-SHA256 signed sandbox webhook settlement.
          </p>
        </div>

        <AlertBanner
          tone="warning"
          title="SANDBOX ADAPTER ONLY"
          message="Never enter real card or UPI credentials. Webhook triggers verify HMAC signatures and deduplication server-side."
        />

        {(walletsQuery.error || intentsQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={
              error ||
              formatErrorMessage(walletsQuery.error || intentsQuery.error, 'Failed to load payment intents')
            }
          />
        )}
        {notice && <AlertBanner tone="success" message={notice} />}

        <Card title="Create Sandbox Deposit Payment Intent">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="pi-wallet">Destination Wallet</Label>
              <select
                id="pi-wallet"
                value={effectiveWalletId}
                onChange={(e) => setWalletId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                required
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.wallet_name} ({formatInrMinor(w.available_balance_minor)})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <Label htmlFor="pi-amount">Amount (INR)</Label>
              <Input
                id="pi-amount"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={!effectiveWalletId || createMutation.isPending}>
              Create Payment Intent
            </Button>
          </form>
        </Card>

        <Card title="Your Sandbox Payment Intents">
          {intentsQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : intents.length === 0 ? (
            <EmptyState title="No payment intents yet" description="Create one above and test webhook capture or failure." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Provider Ref</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2">Simulate Signed Webhook</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {intents.map((pi) => {
                    const id = String(pi.id);
                    const status = String(pi.status);
                    return (
                      <tr key={id}>
                        <td className="py-2.5 pr-3 font-mono text-xs">{String(pi.provider_reference || maskIdentifier(id))}</td>
                        <td className="py-2.5 pr-3 font-semibold">{formatInrMinor(Number(pi.amount_minor))}</td>
                        <td className="py-2.5 pr-3"><Badge tone={statusTone(status)}>{status}</Badge></td>
                        <td className="py-2.5 pr-3 text-xs text-slate-500">{formatUtcTimestamp(String(pi.created_at))}</td>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!['PENDING', 'CREATED'].includes(status)}
                              onClick={() => triggerWebhook(id, 'payment.captured')}
                            >
                              Simulate Capture
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!['PENDING', 'CREATED'].includes(status)}
                              onClick={() => triggerWebhook(id, 'payment.failed')}
                            >
                              Simulate Fail
                            </Button>
                            {status === 'SUCCEEDED' && (
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => setRefundIntent({ id, amountMinor: Number(pi.amount_minor) })}
                              >
                                Request Refund
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <StepUpDialog
          open={Boolean(refundIntent)}
          action="REFUND"
          onClose={() => setRefundIntent(null)}
          onVerified={handleRefundIntent}
        />
      </div>
    </AppShell>
  );
}
