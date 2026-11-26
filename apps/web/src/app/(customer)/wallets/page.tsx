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
import { walletsApi } from '@/lib/api/client';
import { formatInrMinor, formatUtcTimestamp, maskIdentifier } from '@/lib/utils/format';

export default function WalletsPage() {
  const qc = useQueryClient();
  const [walletName, setWalletName] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const walletsQuery = useQuery({ queryKey: ['wallets'], queryFn: () => walletsApi.list() });
  const wallets = walletsQuery.data?.data ?? [];
  const activeWalletId = selectedWalletId ?? wallets[0]?.id ?? null;

  const txQuery = useQuery({
    queryKey: ['wallet-tx', activeWalletId],
    queryFn: () => walletsApi.getTransactions(activeWalletId!),
    enabled: Boolean(activeWalletId),
  });

  const createMutation = useMutation({
    mutationFn: () => walletsApi.create({ walletName: walletName.trim(), currency: 'INR' }),
    onSuccess: (res) => {
      setWalletName('');
      setFormError(null);
      setSelectedWalletId(res.data.id);
      void qc.invalidateQueries({ queryKey: ['wallets'] });
    },
    onError: (err) => setFormError(formatErrorMessage(err, 'Failed to create wallet')),
  });

  return (
    <AppShell allowedRoles={['CUSTOMER']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Simulated Wallets &amp; Ledger Entries</h1>
          <p className="text-sm text-slate-600">
            Balances reflect transactional ledger projections and active holds. Copy full Wallet IDs to add beneficiaries.
          </p>
        </div>

        {(walletsQuery.error || txQuery.error) && (
          <AlertBanner
            tone="error"
            message={formatErrorMessage(walletsQuery.error || txQuery.error, 'Failed to load wallet data')}
          />
        )}

        <Card title="Create New INR Wallet">
          {formError && <div className="mb-3"><AlertBanner tone="error" message={formError} /></div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-[240px] flex-1">
              <Label htmlFor="wallet-name">Wallet Nickname</Label>
              <Input
                id="wallet-name"
                value={walletName}
                onChange={(e) => setWalletName(e.target.value)}
                placeholder="e.g., Operating Expenses INR"
                required
              />
            </div>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Simulated Wallet'}
            </Button>
          </form>
        </Card>

        <Card title="Your Simulated Wallets">
          {walletsQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : wallets.length === 0 ? (
            <EmptyState title="No wallets found" description="Create a wallet above to get started." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {wallets.map((w) => {
                const isSelected = w.id === activeWalletId;
                return (
                  <div
                    key={w.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      isSelected ? 'border-fincore-navy bg-slate-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-slate-900">{w.wallet_name}</h3>
                      <Badge tone={statusTone(w.status)}>{w.status}</Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-mono" title={w.id}>{maskIdentifier(w.id)}</span>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(w.id)}
                        className="text-fincore-navy underline"
                      >
                        Copy Full ID
                      </button>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                      <div>
                        <div className="text-[11px] uppercase text-slate-500">SIMULATED AVAILABLE</div>
                        <div className="text-lg font-bold text-emerald-700">
                          {formatInrMinor(w.available_balance_minor)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase text-slate-500">LEDGER BALANCE</div>
                        <div className="text-lg font-bold text-slate-900">
                          {formatInrMinor(w.ledger_balance_minor)}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isSelected ? 'primary' : 'outline'}
                      className="mt-3 w-full"
                      onClick={() => setSelectedWalletId(w.id)}
                    >
                      {isSelected ? 'Viewing Ledger Below' : 'Inspect Ledger Entries'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {activeWalletId && (
          <Card
            title="Immutable Ledger Entries"
            subtitle={`Showing posted double-entry lines for wallet ${maskIdentifier(activeWalletId)}`}
          >
            {txQuery.isLoading ? (
              <LoadingSkeleton rows={4} />
            ) : (txQuery.data?.data ?? []).length === 0 ? (
              <EmptyState title="No ledger postings yet" description="Fund or transfer using this wallet to see immutable entries." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">Journal Type</th>
                      <th className="py-2 pr-4">Direction</th>
                      <th className="py-2 pr-4">Amount</th>
                      <th className="py-2 pr-4">Description</th>
                      <th className="py-2">Posted At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(txQuery.data?.data ?? []).map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-2.5 pr-4 font-medium text-slate-800">{entry.journal_type}</td>
                        <td className="py-2.5 pr-4">
                          <Badge tone={entry.entry_type === 'CREDIT' ? 'success' : 'warning'}>
                            {entry.entry_type}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 font-semibold text-slate-900">
                          {entry.entry_type === 'CREDIT' ? '+' : '-'}
                          {formatInrMinor(entry.amount_minor)}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">{entry.description || '—'}</td>
                        <td className="py-2.5 text-xs text-slate-500">{formatUtcTimestamp(entry.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
