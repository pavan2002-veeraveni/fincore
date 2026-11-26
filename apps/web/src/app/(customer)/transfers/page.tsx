'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  StepUpDialog,
  formatErrorMessage,
  statusTone,
} from '@/components/ui/primitives';
import { beneficiariesApi, transfersApi, walletsApi } from '@/lib/api/client';
import { formatInrMinor, formatUtcTimestamp, maskIdentifier, parseMajorToMinor } from '@/lib/utils/format';

const TransferFormSchema = z.object({
  sourceWalletId: z.string().uuid('Select a valid source wallet'),
  destinationWalletId: z.string().uuid('Destination wallet ID must be a valid UUID'),
  amountRupees: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a positive INR amount with up to 2 decimals'),
});

export default function TransfersPage() {
  const qc = useQueryClient();
  const [sourceWalletId, setSourceWalletId] = useState('');
  const [destinationWalletId, setDestinationWalletId] = useState('');
  const [amountRupees, setAmountRupees] = useState('100.00');
  const [description, setDescription] = useState('');
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [stepUpTarget, setStepUpTarget] = useState<{ mode: 'create' } | { mode: 'confirm'; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const walletsQuery = useQuery({ queryKey: ['wallets'], queryFn: () => walletsApi.list() });
  const benefQuery = useQuery({ queryKey: ['beneficiaries'], queryFn: () => beneficiariesApi.list() });
  const transfersQuery = useQuery({ queryKey: ['transfers'], queryFn: () => transfersApi.list() });

  const wallets = walletsQuery.data?.data ?? [];
  const beneficiaries = benefQuery.data?.data ?? [];
  const transfers = transfersQuery.data?.data ?? [];

  const effectiveSource = sourceWalletId || wallets[0]?.id || '';

  async function handleStepUpVerified(stepUpToken: string) {
    if (!stepUpTarget) return;
    setError(null);
    setSuccess(null);
    try {
      if (stepUpTarget.mode === 'create') {
        const amountMinor = parseMajorToMinor(amountRupees);
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
          throw new Error('Enter a valid positive INR amount');
        }
        const res = await transfersApi.create(
          {
            sourceWalletId: effectiveSource,
            destinationWalletId: destinationWalletId.trim(),
            amountMinor,
            currency: 'INR',
            description: description.trim() || undefined,
            requireConfirmation,
          },
          idempotencyKey,
          stepUpToken,
        );
        setSuccess(
          `Transfer ${res.data.status}: ${formatInrMinor(res.data.amountMinor)} (ID: ${maskIdentifier(res.data.id)})`,
        );
        setIdempotencyKey(crypto.randomUUID());
        setDescription('');
      } else {
        const res = await transfersApi.confirm(stepUpTarget.id, stepUpToken);
        setSuccess(`Two-step hold captured and transfer ${res.data.status}.`);
      }
      setStepUpTarget(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['wallets'] }),
        qc.invalidateQueries({ queryKey: ['transfers'] }),
      ]);
    } catch (err) {
      setStepUpTarget(null);
      setError(formatErrorMessage(err, 'Transfer failed'));
    }
  }

  async function handleCancel(id: string) {
    setError(null);
    try {
      await transfersApi.cancel(id);
      setSuccess('Pending transfer cancelled and held funds released.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['wallets'] }),
        qc.invalidateQueries({ queryKey: ['transfers'] }),
      ]);
    } catch (err) {
      setError(formatErrorMessage(err, 'Cancel failed'));
    }
  }

  return (
    <AppShell allowedRoles={['CUSTOMER']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Transfers &amp; Idempotency Console</h1>
          <p className="text-sm text-slate-600">
            Executes atomic, row-locked double-entry postings protected by Idempotency-Key and Step-Up authorization.
          </p>
        </div>

        {(walletsQuery.error || transfersQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={
              error ||
              formatErrorMessage(walletsQuery.error || transfersQuery.error, 'Failed to load transfers')
            }
          />
        )}
        {success && <AlertBanner tone="success" message={success} />}

        <Card title="Initiate Simulated Transfer">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const parsed = TransferFormSchema.safeParse({
                sourceWalletId: effectiveSource,
                destinationWalletId: destinationWalletId.trim(),
                amountRupees: amountRupees.trim(),
              });
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message || 'Check transfer fields');
                return;
              }
              setStepUpTarget({ mode: 'create' });
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div>
              <Label htmlFor="tx-src">Source Wallet (SIMULATED BALANCE)</Label>
              <select
                id="tx-src"
                value={effectiveSource}
                onChange={(e) => setSourceWalletId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                required
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.wallet_name} — {formatInrMinor(w.available_balance_minor)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="tx-benef">Saved Beneficiary (Optional Quick-Fill)</Label>
              <select
                id="tx-benef"
                value=""
                onChange={(e) => {
                  if (e.target.value) setDestinationWalletId(e.target.value);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">-- Choose saved beneficiary --</option>
                {beneficiaries.map((b) => (
                  <option key={b.id} value={b.destination_wallet_id}>
                    {b.nickname} ({maskIdentifier(b.destination_wallet_id)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="tx-dst">Destination Wallet UUID</Label>
              <Input
                id="tx-dst"
                value={destinationWalletId}
                onChange={(e) => setDestinationWalletId(e.target.value)}
                placeholder="Target wallet UUID"
                required
              />
            </div>

            <div>
              <Label htmlFor="tx-amt">Amount (INR, e.g. 250.50)</Label>
              <Input
                id="tx-amt"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="tx-desc">Description</Label>
              <Input
                id="tx-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Simulated invoice or split"
              />
            </div>

            <div>
              <Label htmlFor="tx-idem">Idempotency-Key (Editable for Retry Testing)</Label>
              <Input
                id="tx-idem"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                required
              />
            </div>

            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={requireConfirmation}
                  onChange={(e) => setRequireConfirmation(e.target.checked)}
                />
                Two-step transfer (place active HOLD first, settle via Confirm)
              </label>

              <Button type="submit" disabled={!effectiveSource}>
                Review &amp; Step-Up Confirm
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Transfer History">
          {transfersQuery.isLoading ? (
            <LoadingSkeleton rows={4} />
          ) : transfers.length === 0 ? (
            <EmptyState title="No transfers found" description="Submit a transfer above to test atomic ledger settlement." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">From → To</th>
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transfers.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 pr-3 font-mono text-xs">{maskIdentifier(t.id)}</td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-slate-600">
                        {maskIdentifier(t.sourceWalletId)} → {maskIdentifier(t.destinationWalletId)}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-700">{t.description || '—'}</td>
                      <td className="py-2.5 pr-3 font-semibold">{formatInrMinor(t.amountMinor)}</td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-600">{formatUtcTimestamp(t.createdAt)}</td>
                      <td className="py-2.5">
                        {t.status === 'PENDING_CONFIRMATION' ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setStepUpTarget({ mode: 'confirm', id: t.id })}
                            >
                              Confirm
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleCancel(t.id)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <StepUpDialog
          open={Boolean(stepUpTarget)}
          action="TRANSFER"
          onClose={() => setStepUpTarget(null)}
          onVerified={handleStepUpVerified}
        />
      </div>
    </AppShell>
  );
}
