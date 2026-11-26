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
import { operationsApi } from '@/lib/api/client';
import { formatUtcTimestamp, maskIdentifier } from '@/lib/utils/format';

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [sampleJson, setSampleJson] = useState(
    JSON.stringify([{ reference: 'sandbox_order_demo', amount_minor: 25000, currency: 'INR', timestamp: new Date().toISOString() }]),
  );
  const [resolutionNotes, setResolutionNotes] = useState('Reviewed and verified via Operations Console');
  const [error, setError] = useState<string | null>(null);

  const runsQuery = useQuery({ queryKey: ['recon-runs'], queryFn: () => operationsApi.reconciliationRuns() });
  const excQuery = useQuery({ queryKey: ['recon-exceptions'], queryFn: () => operationsApi.reconciliationExceptions() });

  const runMutation = useMutation({
    mutationFn: () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(sampleJson);
      } catch {
        throw new Error('Provider settlement batch must be a valid JSON array');
      }
      if (!Array.isArray(parsed)) {
        throw new Error('Provider settlement batch JSON must be an array');
      }
      if (periodStart > periodEnd) {
        throw new Error('Period start must be on or before period end');
      }
      return operationsApi.createReconciliationRun({
        providerName: 'sandbox',
        periodStart,
        periodEnd,
        providerData: parsed,
      });
    },
    onSuccess: () => {
      setError(null);
      void Promise.all([
        qc.invalidateQueries({ queryKey: ['recon-runs'] }),
        qc.invalidateQueries({ queryKey: ['recon-exceptions'] }),
      ]);
    },
    onError: (err) => setError(formatErrorMessage(err, 'Reconciliation failed')),
  });

  async function resolve(id: string, status: 'RESOLVED' | 'DISMISSED') {
    setError(null);
    try {
      await operationsApi.resolveException(id, {
        status,
        notes: resolutionNotes.trim() || `${status} via Operations Console`,
      });
      void qc.invalidateQueries({ queryKey: ['recon-exceptions'] });
    } catch (err) {
      setError(formatErrorMessage(err, 'Failed to resolve exception'));
    }
  }

  const runs = runsQuery.data?.data ?? [];
  const exceptions = excQuery.data?.data ?? [];

  return (
    <AppShell allowedRoles={['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settlement Reconciliation &amp; Exceptions</h1>
          <p className="text-sm text-slate-600">
            Compares internal payment intents against provider export records. Never auto-corrects ledger balances.
          </p>
        </div>

        {(runsQuery.error || excQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={
              error ||
              formatErrorMessage(runsQuery.error || excQuery.error, 'Failed to load reconciliation data')
            }
          />
        )}

        <Card title="Import Synthetic Provider Settlement Batch">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runMutation.mutate();
            }}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="recon-start">Period Start</Label>
                <Input id="recon-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="recon-end">Period End</Label>
                <Input id="recon-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="recon-json">Provider Settlement Records (JSON Array)</Label>
              <Input id="recon-json" value={sampleJson} onChange={(e) => setSampleJson(e.target.value)} required />
            </div>
            <Button type="submit" disabled={runMutation.isPending}>
              {runMutation.isPending ? 'Running Reconciliation...' : 'Run Reconciliation'}
            </Button>
          </form>
        </Card>

        <Card title="Reconciliation Runs">
          {runsQuery.isLoading ? (
            <LoadingSkeleton rows={2} />
          ) : runs.length === 0 ? (
            <EmptyState title="No runs executed yet" description="Run a batch comparison above." />
          ) : (
            <div className="divide-y divide-slate-200 text-sm">
              {runs.map((r) => (
                <div key={String(r.id)} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <span className="font-mono text-xs">{maskIdentifier(String(r.id))}</span> —{' '}
                    <strong>{String(r.provider_name)}</strong> ({String(r.period_start).slice(0, 10)})
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span>Matched: <strong>{String(r.matched_count)}</strong></span>
                    <span>Exceptions: <strong className="text-red-700">{String(r.exception_count)}</strong></span>
                    <Badge tone={statusTone(String(r.status))}>{String(r.status)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Reconciliation Exceptions">
          <div className="mb-3">
            <Label htmlFor="recon-notes">Operator Resolution Notes</Label>
            <Input
              id="recon-notes"
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
            />
          </div>
          {excQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : exceptions.length === 0 ? (
            <EmptyState title="No exceptions open" description="Mismatched or missing items appear here for operator review." />
          ) : (
            <div className="divide-y divide-slate-200 text-sm">
              {exceptions.map((ex) => {
                const id = String(ex.id);
                const status = String(ex.status);
                return (
                  <div key={id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="warning">{String(ex.exception_type)}</Badge>
                        <Badge tone={statusTone(status)}>{status}</Badge>
                      </div>
                      <p className="mt-1 text-slate-800">{String(ex.description)}</p>
                      <p className="text-xs text-slate-600">{formatUtcTimestamp(String(ex.created_at))}</p>
                    </div>
                    {status === 'OPEN' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => resolve(id, 'RESOLVED')}>
                          Mark Resolved
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => resolve(id, 'DISMISSED')}>
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
