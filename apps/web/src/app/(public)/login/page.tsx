'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { AlertBanner, Button, Card, Input, Label, formatErrorMessage } from '@/components/ui/primitives';

const DEMO_USERS = [
  { label: 'Customer 1 (Aarav)', email: 'customer1@fincore.test', dest: '/dashboard' },
  { label: 'Customer 2 (Priya)', email: 'customer2@fincore.test', dest: '/dashboard' },
  { label: 'Support Agent', email: 'support@fincore.test', dest: '/operations' },
  { label: 'Operations Analyst', email: 'analyst@fincore.test', dest: '/operations' },
  { label: 'Finance Admin', email: 'finance@fincore.test', dest: '/reconciliation' },
  { label: 'Platform Admin', email: 'admin@fincore.test', dest: '/admin' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      if (user.roles.includes('CUSTOMER')) {
        router.push('/dashboard');
      } else {
        router.push('/operations');
      }
    } catch (err) {
      setError(formatErrorMessage(err, 'Sign-in failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 p-4">
      <div className="mb-4 text-center">
        <Link href="/" className="text-2xl font-bold text-fincore-navy">
          FinCore <span className="text-xs font-medium text-emerald-700">SIMULATED</span>
        </Link>
      </div>

      <div className="w-full max-w-md space-y-4">
        <AlertBanner
          tone="warning"
          message="Educational sandbox only. Never enter real bank or personal passwords."
        />

        <Card title="Sign in to FinCore" subtitle="Sessions use short-lived memory tokens + HttpOnly refresh cookies.">
          {error && (
            <div className="mb-3">
              <AlertBanner tone="error" message={error} />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="login-email">Email Address</Label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer1@fincore.test"
                required
              />
            </div>

            <div>
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="text-xs font-medium text-slate-600">Synthetic Seed Accounts (Password: FinCore@2026!):</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DEMO_USERS.map((demo) => (
                <button
                  key={demo.email}
                  type="button"
                  onClick={() => {
                    setEmail(demo.email);
                    setPassword('FinCore@2026!');
                  }}
                  className="rounded border border-slate-200 px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                >
                  <div className="font-semibold text-slate-800">{demo.label}</div>
                  <div className="truncate text-[11px] text-slate-500">{demo.email}</div>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-slate-600">
            New learner?{' '}
            <Link href="/register" className="font-semibold text-fincore-navy underline">
              Register a synthetic customer
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
