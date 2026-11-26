'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/navigation/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSkeleton,
  statusTone,
} from '@/components/ui/primitives';
import { transfersApi, walletsApi } from '@/lib/api/client';
import { formatInrMinor, formatUtcTimestamp, maskIdentifier } from '@/lib/utils/format';

export default function CustomerDashboardPage() {
  const walletsQuery = useQuery({ queryKey: ['wallets'], queryFn: () => walletsApi.list() });
  const transfersQuery = useQuery({ queryKey: ['transfers'], queryFn: () => transfersApi.list() });

  const wallets = walletsQuery.data?.data ?? [];
  const transfers = transfersQuery.data?.data ?? [];

  const totalAvailableMinor = wallets.reduce((acc, w) => acc + Number(w.available_balance_minor), 0);
  const totalLedgerMinor = wallets.reduce((acc, w) => acc + Number(w.ledger_balance_minor), 0);

  return (
    <AppShell allowedRoles={['CUSTOMER']}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Customer Overview</h1>
            <p className="text-sm text-slate-600">
              All figures below represent synthetic educational simulation records.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/transfers">
              <Button variant="secondary">Send Simulated Transfer</Button>
            </Link>
            <Link href="/payments">
              <Button variant="outline">Top Up via Sandbox</Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card title="SIMULATED AVAILABLE BALANCE" subtitle="Authoritative backend projection after active holds">
            <p className="text-3xl font-bold text-emerald-700">{formatInrMinor(totalAvailableMinor)}</p>
            <p className="mt-1 text-xs text-slate-500">Across {wallets.length} active wallet(s)</p>
          </Card>

          <Card title="SIMULATED LEDGER BALANCE" subtitle="Sum of posted double-entry postings">
            <p className="text-3xl font-bold text-slate-900">{formatInrMinor(totalLedgerMinor)}</p>
            <p className="mt-1 text-xs text-slate-500">
              Held funds: {formatInrMinor(totalLedgerMinor - totalAvailableMinor)}
            </p>
          </Card>

          <Card title="Quick Actions">
            <div className="flex flex-col gap-2 text-sm">
              <Link href="/wallets" className="text-fincore-navy underline">
                Inspect Wallets &amp; Ledger Entries
              </Link>
              <Link href="/beneficiaries" className="text-fincore-navy underline">
                Manage Beneficiaries
              </Link>
              <Link href="/statements" className="text-fincore-navy underline">
                Export Statement CSV
              </Link>
            </div>
          </Card>
        </div>

        {(walletsQuery.error || transfersQuery.error) && (
          <AlertBanner
            tone="error"
            message={
              (walletsQuery.error as Error | null)?.message ||
              (transfersQuery.error as Error | null)?.message ||
              'Failed to load customer overview'
            }
          />
        )}

        <Card title="Your Wallets" action={<Link href="/wallets"><Button size="sm" variant="outline">Manage Wallets</Button></Link>}>
          {walletsQuery.isLoading ? (
            <LoadingSkeleton rows={2} />
          ) : wallets.length === 0 ? (
            <EmptyState
              title="No wallets yet"
              description="Create your first simulated INR wallet to start."
              action={<Link href="/wallets"><Button size="sm">Create Wallet</Button></Link>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {wallets.map((w) => (
                <div key={w.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-900">{w.wallet_name}</div>
                    <Badge tone={statusTone(w.status)}>{w.status}</Badge>
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-500">{maskIdentifier(w.id)}</div>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="text-xs text-slate-500">SIMULATED AVAILABLE</span>
                    <span className="text-lg font-bold text-slate-900">
                      {formatInrMinor(w.available_balance_minor)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent Transfers" action={<Link href="/transfers"><Button size="sm" variant="outline">View All</Button></Link>}>
          {transfersQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : transfers.length === 0 ? (
            <EmptyState
              title="No transfer history"
              description="Once you execute a transfer, immutable ledger entries appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Transfer ID</th>
                    <th className="py-2 pr-4">Description</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transfers.slice(0, 6).map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 pr-4 font-mono text-xs text-slate-600">
                        {maskIdentifier(t.id)}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-800">{t.description || 'Simulated transfer'}</td>
                      <td className="py-2.5 pr-4 font-semibold text-slate-900">
                        {formatInrMinor(t.amountMinor)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      </td>
                      <td className="py-2.5 text-xs text-slate-500">{formatUtcTimestamp(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
