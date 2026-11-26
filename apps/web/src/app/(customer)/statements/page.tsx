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
import { statementsApi, walletsApi } from '@/lib/api/client';
import { formatInrMinor, maskIdentifier } from '@/lib/utils/format';

export default function StatementsPage() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 8)}01`;

  const [walletId, setWalletId] = useState('');
  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [error, setError] = useState<string | null>(null);

  const walletsQuery = useQuery({ queryKey: ['wallets'], queryFn: () => walletsApi.list() });
  const stmtQuery = useQuery({ queryKey: ['statements'], queryFn: () => statementsApi.list() });

  const wallets = walletsQuery.data?.data ?? [];
  const statements = stmtQuery.data?.data ?? [];
  const effectiveWalletId = walletId || wallets[0]?.id || '';

  const genMutation = useMutation({
    mutationFn: () => {
      if (periodStart > periodEnd) {
        throw new Error('Period start date must be on or before end date');
      }
      return statementsApi.generate({ walletId: effectiveWalletId, periodStart, periodEnd });
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['statements'] });
    },
    onError: (err) => setError(formatErrorMessage(err, 'Statement generation failed')),
  });

  async function handleExport(id: string) {
    try {
      const csv = await statementsApi.downloadCsv(id);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fincore-statement-${id.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(formatErrorMessage(err, 'Export failed'));
    }
  }

  return (
    <AppShell allowedRoles={['CUSTOMER']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Account Statements &amp; CSV Export</h1>
          <p className="text-sm text-slate-600">
            Generated deterministically from immutable posted ledger entries with CSV formula sanitization.
          </p>
        </div>

        {(walletsQuery.error || stmtQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={
              error ||
              formatErrorMessage(walletsQuery.error || stmtQuery.error, 'Failed to load statements')
            }
          />
        )}

        <Card title="Generate Statement Snapshot">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              genMutation.mutate();
            }}
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
          >
            <div>
              <Label htmlFor="st-wallet">Wallet</Label>
              <select
                id="st-wallet"
                value={effectiveWalletId}
                onChange={(e) => setWalletId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                required
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>{w.wallet_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="st-start">Period Start</Label>
              <Input id="st-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="st-end">Period End</Label>
              <Input id="st-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
            </div>
            <Button type="submit" disabled={!effectiveWalletId || genMutation.isPending}>
              {genMutation.isPending ? 'Generating...' : 'Generate Statement'}
            </Button>
          </form>
        </Card>

        <Card title="Generated Statements">
          {stmtQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : statements.length === 0 ? (
            <EmptyState title="No statements generated yet" description="Choose a period above to generate a statement." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">Period</th>
                    <th className="py-2 pr-3">Opening</th>
                    <th className="py-2 pr-3">Closing</th>
                    <th className="py-2 pr-3">Entries</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Export</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statements.map((s) => {
                    const id = String(s.id);
                    return (
                      <tr key={id}>
                        <td className="py-2.5 pr-3 font-mono text-xs">{maskIdentifier(id)}</td>
                        <td className="py-2.5 pr-3 text-xs">
                          {String(s.period_start).slice(0, 10)} → {String(s.period_end).slice(0, 10)}
                        </td>
                        <td className="py-2.5 pr-3">{formatInrMinor(Number(s.opening_balance_minor))}</td>
                        <td className="py-2.5 pr-3 font-semibold">{formatInrMinor(Number(s.closing_balance_minor))}</td>
                        <td className="py-2.5 pr-3">{String(s.transaction_count)}</td>
                        <td className="py-2.5 pr-3"><Badge tone={statusTone(String(s.status))}>{String(s.status)}</Badge></td>
                        <td className="py-2.5">
                          <Button size="sm" variant="outline" onClick={() => handleExport(id)}>
                            Download CSV
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
