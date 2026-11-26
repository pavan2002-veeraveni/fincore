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
import { beneficiariesApi } from '@/lib/api/client';
import { maskIdentifier } from '@/lib/utils/format';

export default function BeneficiariesPage() {
  const qc = useQueryClient();
  const [destinationWalletId, setDestinationWalletId] = useState('');
  const [nickname, setNickname] = useState('');
  const [pendingAction, setPendingAction] = useState<
    | { type: 'create' }
    | { type: 'edit'; id: string; nickname: string }
    | { type: 'delete'; id: string }
    | null
  >(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const listQuery = useQuery({ queryKey: ['beneficiaries'], queryFn: () => beneficiariesApi.list() });
  const beneficiaries = listQuery.data?.data ?? [];

  async function executeWithStepUp(stepUpToken: string) {
    if (!pendingAction) return;
    setError(null);
    setSuccess(null);
    try {
      if (pendingAction.type === 'create') {
        await beneficiariesApi.create({ destinationWalletId: destinationWalletId.trim(), nickname: nickname.trim() }, stepUpToken);
        setDestinationWalletId('');
        setNickname('');
        setSuccess('Beneficiary added with step-up authorization.');
      } else if (pendingAction.type === 'edit') {
        await beneficiariesApi.update(pendingAction.id, { nickname: pendingAction.nickname }, stepUpToken);
        setEditingId(null);
        setEditNickname('');
        setSuccess('Beneficiary nickname updated.');
      } else {
        await beneficiariesApi.deactivate(pendingAction.id, stepUpToken);
        setSuccess('Beneficiary deactivated.');
      }
      setPendingAction(null);
      void qc.invalidateQueries({ queryKey: ['beneficiaries'] });
    } catch (err) {
      setPendingAction(null);
      setError(formatErrorMessage(err, 'Beneficiary operation failed'));
    }
  }

  return (
    <AppShell allowedRoles={['CUSTOMER']}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Beneficiaries</h1>
          <p className="text-sm text-slate-600">Adding or removing beneficiaries enforces server-side step-up confirmation.</p>
        </div>

        {(listQuery.error || error) && (
          <AlertBanner tone="error" message={error || formatErrorMessage(listQuery.error, 'Failed to load beneficiaries')} />
        )}
        {success && <AlertBanner tone="success" message={success} />}

        <Card title="Add Beneficiary">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPendingAction({ type: 'create' });
            }}
            className="grid gap-3 sm:grid-cols-3 sm:items-end"
          >
            <div>
              <Label htmlFor="benef-wallet">Destination Wallet UUID</Label>
              <Input
                id="benef-wallet"
                value={destinationWalletId}
                onChange={(e) => setDestinationWalletId(e.target.value)}
                placeholder="UUID of another customer wallet"
                required
              />
            </div>
            <div>
              <Label htmlFor="benef-nick">Nickname</Label>
              <Input
                id="benef-nick"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g., Priya Wallet"
                required
              />
            </div>
            <Button type="submit">Add Beneficiary (Step-Up)</Button>
          </form>
        </Card>

        <Card title="Active Beneficiaries">
          {listQuery.isLoading ? (
            <LoadingSkeleton rows={3} />
          ) : beneficiaries.length === 0 ? (
            <EmptyState title="No beneficiaries saved" description="Add a destination wallet UUID above to transfer quickly." />
          ) : (
            <div className="divide-y divide-slate-200">
              {beneficiaries.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-semibold text-slate-900">{b.nickname}</div>
                    <div className="font-mono text-xs text-slate-500">
                      Destination Wallet: {maskIdentifier(b.destination_wallet_id)} ({b.destination_currency || 'INR'})
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="success">{b.status}</Badge>
                    {editingId === b.id ? (
                      <>
                        <Input
                          aria-label={`Edit nickname for ${b.nickname}`}
                          value={editNickname}
                          onChange={(e) => setEditNickname(e.target.value)}
                          className="w-40 py-1 text-xs"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            editNickname.trim() &&
                            setPendingAction({ type: 'edit', id: b.id, nickname: editNickname.trim() })
                          }
                        >
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(b.id);
                          setEditNickname(b.nickname);
                        }}
                      >
                        Rename
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingAction({ type: 'delete', id: b.id })}
                    >
                      Deactivate
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <StepUpDialog
          open={Boolean(pendingAction)}
          action="BENEFICIARY_CHANGE"
          onClose={() => setPendingAction(null)}
          onVerified={executeWithStepUp}
        />
      </div>
    </AppShell>
  );
}
