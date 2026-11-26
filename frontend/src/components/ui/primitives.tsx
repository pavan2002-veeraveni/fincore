'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/format';
import { ApiClientError, authApi } from '@/lib/api/client';

export function formatErrorMessage(err: unknown, fallback = 'Action failed'): string {
  if (err instanceof ApiClientError && Array.isArray(err.details) && err.details.length > 0) {
    const fieldMsgs = err.details
      .map((d) => {
        if (d && typeof d === 'object' && 'message' in d) {
          const item = d as { field?: string; message?: string };
          return item.field ? `${item.field}: ${item.message}` : String(item.message);
        }
        return '';
      })
      .filter(Boolean);
    if (fieldMsgs.length > 0) {
      return `${err.message} (${fieldMsgs.join('; ')})`;
    }
  }
  return err instanceof Error ? err.message : fallback;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'sm' | 'md';
}) {
  const styles = {
    primary: 'bg-fincore-navy text-white hover:bg-fincore-slate disabled:bg-slate-400',
    secondary: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
    outline: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };
  return (
    <button
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2',
        styles[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}
    >
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const map = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-sky-50 text-sky-800 border-sky-200',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', map[tone])}>
      {children}
    </span>
  );
}

export function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
    case 'SUCCEEDED':
    case 'ACTIVE':
    case 'PROCESSED':
    case 'RESOLVED':
    case 'RESOLVED_ACCEPTED':
    case 'READY':
    case 'LOW':
      return 'success';
    case 'PENDING':
    case 'PENDING_CONFIRMATION':
    case 'PROCESSING':
    case 'UNDER_REVIEW':
    case 'REVIEWING':
    case 'MEDIUM':
      return 'warning';
    case 'FAILED':
    case 'REVERSED':
    case 'CRITICAL':
    case 'HIGH':
    case 'SUSPENDED':
    case 'OPEN':
    case 'ESCALATED':
      return 'danger';
    default:
      return 'info';
  }
}

export function AlertBanner({
  tone = 'info',
  title,
  message,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  message: string;
}) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div role="alert" className={cn('rounded-lg border p-3.5 text-sm', styles[tone])}>
      {title && <div className="font-semibold">{title}</div>}
      <div>{message}</div>
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-700">
      {children}
    </label>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-200/80" />
      ))}
    </div>
  );
}

export function StepUpDialog({
  open,
  action,
  onClose,
  onVerified,
}: {
  open: boolean;
  action: 'TRANSFER' | 'BENEFICIARY_CHANGE' | 'REFUND' | 'REVERSAL' | 'ROLE_CHANGE' | 'ALL';
  onClose: () => void;
  onVerified: (stepUpToken: string) => void;
}) {
  const [mode, setMode] = useState<'PASSWORD' | 'MFA'>('PASSWORD');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [simulatedCode, setSimulatedCode] = useState<string | undefined>();
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset modal internal state on open/close so reused dialogs never hold stale MFA challenges
  useEffect(() => {
    if (!open) {
      setMode('PASSWORD');
      setPassword('');
      setChallengeId(null);
      setSimulatedCode(undefined);
      setMfaCode('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handlePasswordStepUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.stepUpPassword({ password, action });
      setPassword('');
      onVerified(res.data.stepUpToken);
    } catch (err) {
      setError(formatErrorMessage(err, 'Step-up reauthentication failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function requestMfa() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.createMfaChallenge(action);
      setChallengeId(res.data.challengeId);
      setSimulatedCode(res.data.simulatedCode);
      if (res.data.simulatedCode) {
        setMfaCode(res.data.simulatedCode);
      }
    } catch (err) {
      setError(formatErrorMessage(err, 'Could not initiate simulated MFA'));
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.verifyMfaChallenge(challengeId, mfaCode);
      setChallengeId(null);
      setSimulatedCode(undefined);
      setMfaCode('');
      onVerified(res.data.stepUpToken);
    } catch (err) {
      setError(formatErrorMessage(err, 'MFA verification failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stepup-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 id="stepup-title" className="text-lg font-semibold text-slate-900">
          Step-Up Security Confirmation
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          Required for sensitive action: <span className="font-semibold">{action}</span>. Choose password
          reauthentication or SIMULATED MFA.
        </p>

        <div role="tablist" aria-label="Step-up verification method" className="mt-4 flex gap-2 border-b border-slate-200 pb-3">
          <Button
            type="button"
            role="tab"
            aria-selected={mode === 'PASSWORD'}
            size="sm"
            variant={mode === 'PASSWORD' ? 'primary' : 'outline'}
            onClick={() => setMode('PASSWORD')}
          >
            Password Re-auth
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={mode === 'MFA'}
            size="sm"
            variant={mode === 'MFA' ? 'primary' : 'outline'}
            onClick={() => setMode('MFA')}
          >
            Simulated MFA Code
          </Button>
        </div>

        {error && (
          <div className="mt-3">
            <AlertBanner tone="error" message={error} />
          </div>
        )}

        {mode === 'PASSWORD' ? (
          <form onSubmit={handlePasswordStepUp} className="mt-4 space-y-3">
            <div>
              <Label htmlFor="stepup-password">Confirm Account Password</Label>
              <Input
                id="stepup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Verifying...' : 'Confirm & Continue'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <AlertBanner
              tone="warning"
              title="SIMULATED MFA — Educational Only"
              message="In development/learning mode, the 6-digit challenge code is generated synthetically."
            />
            {!challengeId ? (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="button" onClick={requestMfa} disabled={submitting}>
                  {submitting ? 'Sending...' : 'Generate Simulated MFA Code'}
                </Button>
              </div>
            ) : (
              <form onSubmit={verifyMfa} className="space-y-3">
                {simulatedCode && (
                  <p className="rounded bg-slate-100 p-2 text-center font-mono text-sm">
                    Simulated Code: <strong>{simulatedCode}</strong>
                  </p>
                )}
                <div>
                  <Label htmlFor="mfa-code">6-Digit Code</Label>
                  <Input
                    id="mfa-code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    maxLength={6}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    Verify Code
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
