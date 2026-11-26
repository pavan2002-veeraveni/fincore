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

export default function RiskAlertsPage() {
  const qc = useQueryClient();
  const alertsQuery = useQuery({ queryKey: ['risk-alerts'], queryFn: () => operationsApi.riskAlerts() });

  const [amountMinor, setAmountMinor] = useState('6500000'); // ₹65,000.00
  const [recentTxCount, setRecentTxCount] = useState('12');
  const [recentTotalMinor, setRecentTotalMinor] = useState('1500000');
  const [recentFailures, setRecentFailures] = useState('2');
  const [accountAgeDays, setAccountAgeDays] = useState('4');
  const [txType, setTxType] = useState<'TRANSFER' | 'PAYMENT' | 'WITHDRAWAL'>('TRANSFER');
  const [beneficiaryIsNew, setBeneficiaryIsNew] = useState(true);
  const [reviewNotes, setReviewNotes] = useState('Reviewed in Operations Console');
  const [assessmentResult, setAssessmentResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assessMutation = useMutation({
    mutationFn: () =>
      operationsApi.assessRisk({
        transactionAmountMinor: Number(amountMinor),
        currency: 'INR',
        transactionType: txType,
        beneficiaryIsNew,
        recentTransactionCount: Number(recentTxCount),
        recentTotalAmountMinor: Number(recentTotalMinor),
        recentFailureCount: Number(recentFailures),
        customerAccountAgeDays: Number(accountAgeDays),
      }),
    onSuccess: (res) => {
      setError(null);
      setAssessmentResult(res.data);
      void qc.invalidateQueries({ queryKey: ['risk-alerts'] });
    },
    onError: (err) => setError(formatErrorMessage(err, 'Risk assessment failed')),
  });

  async function updateAlert(id: string, status: string) {
    setError(null);
    try {
      await operationsApi.reviewRiskAlert(id, {
        status,
        reviewNotes: reviewNotes.trim() || `Analyst set ${status}`,
      });
      void qc.invalidateQueries({ queryKey: ['risk-alerts'] });
    } catch (err) {
      setError(formatErrorMessage(err, 'Failed to update alert'));
    }
  }

  const alerts = alertsQuery.data?.data ?? [];

  return (
    <AppShell allowedRoles={['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">FastAPI Risk Analytics &amp; Alerts</h1>
          <p className="text-sm text-slate-600">
            Decision-support scores only — never proof of fraud or silent automatic blocking.
          </p>
        </div>

        {(alertsQuery.error || error) && (
          <AlertBanner
            tone="error"
            message={error || formatErrorMessage(alertsQuery.error, 'Failed to load risk alerts')}
          />
        )}

        <Card title="Run Synthetic FastAPI Risk Evaluation">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              assessMutation.mutate();
            }}
            className="grid gap-3 sm:grid-cols-4 sm:items-end"
          >
            <div>
              <Label htmlFor="rk-type">Transaction Type</Label>
              <select
                id="rk-type"
                value={txType}
                onChange={(e) => setTxType(e.target.value as 'TRANSFER' | 'PAYMENT' | 'WITHDRAWAL')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="TRANSFER">TRANSFER</option>
                <option value="PAYMENT">PAYMENT</option>
                <option value="WITHDRAWAL">WITHDRAWAL</option>
              </select>
            </div>
            <div>
              <Label htmlFor="rk-amt">Amount (Paise)</Label>
              <Input id="rk-amt" type="number" value={amountMinor} onChange={(e) => setAmountMinor(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="rk-cnt">Recent Tx Count</Label>
              <Input id="rk-cnt" type="number" value={recentTxCount} onChange={(e) => setRecentTxCount(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="rk-tot">Recent Total (Paise)</Label>
              <Input id="rk-tot" type="number" value={recentTotalMinor} onChange={(e) => setRecentTotalMinor(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="rk-fail">Recent Failures</Label>
              <Input id="rk-fail" type="number" value={recentFailures} onChange={(e) => setRecentFailures(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="rk-age">Account Age (Days)</Label>
              <Input id="rk-age" type="number" value={accountAgeDays} onChange={(e) => setAccountAgeDays(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={beneficiaryIsNew}
                onChange={(e) => setBeneficiaryIsNew(e.target.checked)}
              />
              New Beneficiary
            </label>
            <Button type="submit" disabled={assessMutation.isPending}>
              {assessMutation.isPending ? 'Evaluating...' : 'Evaluate via FastAPI'}
            </Button>
          </form>

          {assessmentResult && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Score: <strong>{String(assessmentResult.score)} / 100</strong> • Ruleset{' '}
                  <span className="font-mono text-xs">{String(assessmentResult.ruleset_version ?? '1.1.0')}</span>
                </span>
                <Badge tone={statusTone(String(assessmentResult.risk_level))}>
                  {String(assessmentResult.risk_level)}
                </Badge>
              </div>
              {Boolean(assessmentResult.assessment_id) && (
                <p className="mt-1 font-mono text-xs text-slate-600">
                  Assessment ID: {String(assessmentResult.assessment_id)}
                </p>
              )}
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">
                {((assessmentResult.explanations as string[]) ?? []).map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Risk Alerts Queue">
          <div className="mb-3">
            <Label htmlFor="rk-notes">Analyst Review Notes</Label>
            <Input id="rk-notes" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
          </div>
          {alertsQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : alerts.length === 0 ? (
            <EmptyState title="No risk alerts" description="High or critical evaluations appear here for analyst review." />
          ) : (
            <div className="divide-y divide-slate-200">
              {alerts.map((a) => {
                const id = String(a.id);
                return (
                  <div key={id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2">
                        <Badge tone={statusTone(String(a.severity))}>{String(a.severity)}</Badge>
                        <Badge tone={statusTone(String(a.status))}>{String(a.status)}</Badge>
                        <span className="font-mono text-xs text-slate-600">{maskIdentifier(id)}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-800">{String(a.description)}</p>
                      <p className="text-xs text-slate-600">{formatUtcTimestamp(String(a.created_at))}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => updateAlert(id, 'REVIEWING')}>Review</Button>
                      <Button size="sm" variant="danger" onClick={() => updateAlert(id, 'ESCALATED')}>Escalate</Button>
                      <Button size="sm" variant="secondary" onClick={() => updateAlert(id, 'RESOLVED')}>Resolve</Button>
                      <Button size="sm" variant="outline" onClick={() => updateAlert(id, 'DISMISSED')}>Dismiss</Button>
                    </div>
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
