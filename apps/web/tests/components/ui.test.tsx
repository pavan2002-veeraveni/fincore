import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatInrMinor, maskIdentifier } from '@/lib/utils/format';
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  StepUpDialog,
  formatErrorMessage,
} from '@/components/ui/primitives';
import { ApiClientError, walletsApi, adminApi } from '@/lib/api/client';
import { AppShell } from '@/components/navigation/app-shell';
import WalletsPage from '@/app/(customer)/wallets/page';
import AdminPage from '@/app/(operations)/admin/page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/wallets',
  useRouter: () => ({ push: vi.fn() }),
}));

let mockAuthState = {
  user: {
    id: 'u-1',
    email: 'customer1@fincore.test',
    firstName: 'Aarav',
    lastName: 'Sharma',
    phoneNumber: null,
    status: 'ACTIVE',
    roles: ['CUSTOMER'],
    createdAt: '2026-01-01T00:00:00Z',
  },
  loading: false,
  hasRole: (...roles: string[]) => roles.some((r) => mockAuthState.user.roles.includes(r)),
  logout: vi.fn(async () => undefined),
  login: vi.fn(),
  register: vi.fn(),
  refreshUser: vi.fn(),
};

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockAuthState,
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('FinCore Frontend UI, Accessibility & Workspace Components', () => {
  beforeEach(() => {
    mockAuthState.user.roles = ['CUSTOMER'];
  });

  it('formats INR minor units, masks account identifiers, and formats validation field details', () => {
    expect(formatInrMinor(5000075)).toBe('₹50,000.75');
    expect(maskIdentifier('12345678-1234-4123-8123-1234567890ab')).toBe('1234••••7890ab');
    expect(maskIdentifier(null)).toBe('—');

    const err = new ApiClientError('VALIDATION_ERROR', 'Validation failed', 400, [
      { field: 'password', message: 'Must contain uppercase letter' },
    ]);
    expect(formatErrorMessage(err)).toContain('password: Must contain uppercase letter');
  });

  it('renders accessible alerts, cards, badges, empty states, and visible focus rings on buttons', () => {
    render(
      <Card title="SIMULATED BALANCE" subtitle="Educational only">
        <Badge tone="success">ACTIVE</Badge>
        <AlertBanner tone="warning" title="Simulated" message="No real money moves" />
        <EmptyState title="Nothing here" description="No items yet" />
        <Button>Action</Button>
      </Card>,
    );

    expect(screen.getByText('SIMULATED BALANCE')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No real money moves');
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action' }).className).toContain('focus-visible:ring-2');
  });

  it('renders StepUpDialog tabs, handles Escape key, and resets state across reopen', () => {
    const onClose = vi.fn();
    const onVerified = vi.fn();
    const { rerender } = render(
      <StepUpDialog open={true} action="TRANSFER" onClose={onClose} onVerified={onVerified} />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Simulated MFA Code' }));
    expect(screen.getByText(/SIMULATED MFA — Educational Only/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<StepUpDialog open={false} action="TRANSFER" onClose={onClose} onVerified={onVerified} />);
    rerender(<StepUpDialog open={true} action="TRANSFER" onClose={onClose} onVerified={onVerified} />);
    expect(screen.getByLabelText('Confirm Account Password')).toBeInTheDocument();
  });

  it('enforces client-side route role guard in AppShell', () => {
    render(
      <AppShell allowedRoles={['PLATFORM_ADMIN']}>
        <div>Secret Admin Workspace</div>
      </AppShell>,
    );
    expect(screen.queryByText('Secret Admin Workspace')).not.toBeInTheDocument();
    expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
  });

  it('automatically loads initial ledger entries for the first active wallet on WalletsPage', async () => {
    const listSpy = vi.spyOn(walletsApi, 'list').mockResolvedValue({
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          customer_id: 'c-1',
          wallet_name: 'Primary Simulated Wallet',
          currency: 'INR',
          status: 'ACTIVE',
          ledger_balance_minor: 5000000,
          available_balance_minor: 5000000,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      meta: { requestId: 'req-1' },
    });
    const txSpy = vi.spyOn(walletsApi, 'getTransactions').mockResolvedValue({
      data: [
        {
          id: 'le-1',
          journal_transaction_id: 'jt-1',
          line_number: 1,
          wallet_id: '11111111-1111-4111-8111-111111111111',
          entry_type: 'CREDIT',
          amount_minor: 5000000,
          currency: 'INR',
          description: 'Initial synthetic seed deposit',
          journal_type: 'DEPOSIT',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      meta: { requestId: 'req-2' },
    });

    renderWithQuery(<WalletsPage />);

    await waitFor(() => {
      expect(txSpy).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
      expect(screen.getByText('Initial synthetic seed deposit')).toBeInTheDocument();
    });
    listSpy.mockRestore();
    txSpy.mockRestore();
  });

  it('keeps AdminPage role selection controlled until Apply Role is clicked and loads DLQ outbox', async () => {
    mockAuthState.user.roles = ['PLATFORM_ADMIN'];
    vi.spyOn(adminApi, 'users').mockResolvedValue({
      data: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'learner@fincore.test',
          first_name: 'Test',
          last_name: 'Learner',
          status: 'ACTIVE',
          roles: ['CUSTOMER'],
        },
      ],
      meta: { requestId: 'req-1' },
    });
    vi.spyOn(adminApi, 'auditEvents').mockResolvedValue({ data: [], meta: { requestId: 'req-2' } });
    vi.spyOn(adminApi, 'config').mockResolvedValue({ data: { simulatedMode: true }, meta: { requestId: 'req-3' } });
    vi.spyOn(adminApi, 'failedOutbox').mockResolvedValue({
      data: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          event_type: 'TRANSFER_COMPLETED',
          aggregate_type: 'TRANSFER',
          aggregate_id: '44444444-4444-4444-8444-444444444444',
          error: 'Simulated delivery timeout',
        },
      ],
      meta: { requestId: 'req-4' },
    });

    renderWithQuery(<AdminPage />);

    const select = await screen.findByLabelText('Change role for learner@fincore.test');
    fireEvent.change(select, { target: { value: 'OPERATIONS_ANALYST' } });

    // Dialog should NOT open prematurely on dropdown change
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Role' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Replay Outbox Job')).toBeInTheDocument();
  });
});
