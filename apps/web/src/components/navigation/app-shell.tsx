'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Wallet,
  Users,
  ArrowLeftRight,
  CreditCard,
  FileText,
  ShieldAlert,
  Scale,
  UserCog,
  UserCheck,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/utils/format';
import { AlertBanner, Badge, Button, LoadingSkeleton } from '@/components/ui/primitives';

export function AppShell({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: string[];
}) {
  const { user, loading, logout, hasRole } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold text-slate-900">Authentication Required</h1>
        <p className="mt-2 text-sm text-slate-600">
          Please sign in to access FinCore wallet and operations workspaces.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link href="/login">
            <Button>Sign In</Button>
          </Link>
          <Link href="/register">
            <Button variant="outline">Create Synthetic Account</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isStaff = hasRole('SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN');
  const isOpsOrFinance = hasRole('OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN');
  const isAdmin = hasRole('PLATFORM_ADMIN', 'FINANCE_ADMIN');

  const navItems = [
    ...(hasRole('CUSTOMER')
      ? [
          { href: '/dashboard', label: 'Customer Overview', icon: LayoutDashboard },
          { href: '/wallets', label: 'Wallets & Ledger', icon: Wallet },
          { href: '/beneficiaries', label: 'Beneficiaries', icon: Users },
          { href: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
          { href: '/payments', label: 'Payment Sandbox', icon: CreditCard },
          { href: '/statements', label: 'Statements', icon: FileText },
        ]
      : []),
    { href: '/disputes', label: 'Disputes', icon: AlertTriangle },
    { href: '/profile', label: 'Profile & Sessions', icon: UserCheck },
    ...(isStaff
      ? [{ href: '/operations', label: 'Operations Queue', icon: LayoutDashboard }]
      : []),
    ...(isOpsOrFinance
      ? [
          { href: '/risk-alerts', label: 'Risk Analytics', icon: ShieldAlert },
          { href: '/reconciliation', label: 'Reconciliation', icon: Scale },
        ]
      : []),
    ...(isAdmin
      ? [{ href: '/admin', label: 'Admin & Audit', icon: UserCog }]
      : []),
  ];

  const isAuthorized = !allowedRoles || allowedRoles.length === 0 || hasRole(...allowedRoles);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to main content
      </a>
      {/* Mandatory Educational Disclaimer Banner */}
      <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-slate-950">
        EDUCATIONAL SIMULATION PLATFORM — SIMULATED BALANCES &amp; SANDBOX INTEGRATIONS ONLY — NO REAL FUNDS
      </div>

      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        {/* Sidebar Navigation */}
        <aside className="w-full border-b border-slate-200 bg-white md:min-h-[calc(100vh-28px)] md:w-64 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight text-fincore-navy">
              FinCore <span className="text-xs font-medium text-emerald-700">SIM</span>
            </Link>
            <Badge tone="info">{user.roles[0]}</Badge>
          </div>

          <nav aria-label="Primary navigation" className="space-y-1 p-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-fincore-navy text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-200 p-4">
            <div className="text-xs font-medium text-slate-900">
              {user.firstName} {user.lastName}
            </div>
            <div className="truncate text-xs text-slate-500">{user.email}</div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign Out
            </Button>
          </div>
        </aside>

        {/* Main Workspace */}
        <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8">
          {isAuthorized ? (
            children
          ) : (
            <AlertBanner
              tone="error"
              title="Access Denied (403)"
              message="Your active role does not permit access to this workspace section."
            />
          )}
        </main>
      </div>
    </div>
  );
}
