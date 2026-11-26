'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RegisterRequest } from '@fincore/contracts';
import { useAuth } from '@/lib/auth/auth-context';
import { AlertBanner, Button, Card, Input, Label, formatErrorMessage } from '@/components/ui/primitives';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phoneNumber: '+919999990001',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = RegisterRequest.safeParse({
      ...form,
      phoneNumber: form.phoneNumber.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Check registration fields');
      return;
    }
    setSubmitting(true);
    try {
      await register(form);
      router.push('/dashboard');
    } catch (err) {
      setError(formatErrorMessage(err, 'Registration failed'));
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
          message="Create synthetic user data only. Do not enter real banking or personal details."
        />

        <Card title="Create Synthetic Account">
          {error && (
            <div className="mb-3">
              <AlertBanner tone="error" message={error} />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="reg-first">First Name</Label>
                <Input
                  id="reg-first"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="reg-last">Last Name</Label>
                <Input
                  id="reg-last"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="reg-email">Synthetic Email</Label>
              <Input
                id="reg-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="learner@fincore.test"
                required
              />
            </div>

            <div>
              <Label htmlFor="reg-phone">Synthetic Phone</Label>
              <Input
                id="reg-phone"
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="reg-pass">Password (8+ chars, upper, lower, digit, symbol)</Label>
              <Input
                id="reg-pass"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Create Account'}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-600">
            Already registered?{' '}
            <Link href="/login" className="font-semibold text-fincore-navy underline">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
