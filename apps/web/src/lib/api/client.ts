import { webEnv } from '@/lib/env';

export interface ApiMeta {
  requestId: string;
  page?: number;
  pageSize?: number;
  total?: number;
  cached?: boolean;
  warning?: string;
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(code: string, message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

/**
 * In-memory token store ONLY.
 * Avoids persistent localStorage XSS exposure; silent refresh relies on
 * the API's HttpOnly fincore_refresh cookie + double-submit CSRF header.
 */
let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setMemoryAccessToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getMemoryAccessToken(): string | null {
  return inMemoryAccessToken;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function tryCookieRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const csrf = readCookie('fincore_csrf');
      const res = await fetch(`${webEnv.apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        inMemoryAccessToken = null;
        return null;
      }
      const json = (await res.json()) as ApiResponse<{ accessToken: string }>;
      inMemoryAccessToken = json.data.accessToken;
      return inMemoryAccessToken;
    } catch {
      inMemoryAccessToken = null;
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { skipAuthRefresh?: boolean } = {},
): Promise<ApiResponse<T>> {
  const { skipAuthRefresh, headers: customHeaders, ...rest } = options;

  const buildHeaders = (token: string | null): Record<string, string> => {
    const base: Record<string, string> = {};
    if (!(rest.body instanceof FormData)) {
      base['Content-Type'] = 'application/json';
    }
    if (token) {
      base['Authorization'] = `Bearer ${token}`;
    }
    if (customHeaders && typeof customHeaders === 'object' && !Array.isArray(customHeaders)) {
      Object.assign(base, customHeaders as Record<string, string>);
    }
    return base;
  };

  let response = await fetch(`${webEnv.apiBaseUrl}${path}`, {
    ...rest,
    credentials: 'include',
    headers: buildHeaders(inMemoryAccessToken),
  });

  if (response.status === 401 && !skipAuthRefresh && !path.startsWith('/auth/')) {
    const refreshed = await tryCookieRefresh();
    if (refreshed) {
      response = await fetch(`${webEnv.apiBaseUrl}${path}`, {
        ...rest,
        credentials: 'include',
        headers: buildHeaders(refreshed),
      });
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    if (contentType.includes('application/json')) {
      const errBody = await response.json().catch(() => null);
      const e = errBody?.error;
      throw new ApiClientError(
        e?.code || 'API_ERROR',
        e?.message || `Request failed (${response.status})`,
        response.status,
        e?.details,
        e?.requestId,
      );
    }
    throw new ApiClientError('HTTP_ERROR', `HTTP ${response.status}`, response.status);
  }

  return (await response.json()) as ApiResponse<T>;
}

// ── Domain API wrappers ──

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  status: string;
  roles: string[];
  createdAt: string;
}

export interface WalletRecord {
  id: string;
  customer_id: string;
  wallet_name: string;
  currency: 'INR';
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  ledger_balance_minor: string | number;
  available_balance_minor: string | number;
  created_at: string;
}

export interface LedgerEntryRecord {
  id: string;
  journal_transaction_id: string;
  line_number: number;
  wallet_id: string;
  entry_type: 'DEBIT' | 'CREDIT';
  amount_minor: string | number;
  currency: string;
  description: string | null;
  journal_type: string;
  created_at: string;
}

export interface BeneficiaryRecord {
  id: string;
  owner_customer_id: string;
  destination_wallet_id: string;
  destination_wallet_name?: string;
  destination_currency?: string;
  nickname: string;
  status: string;
  created_at: string;
}

export interface TransferRecord {
  id: string;
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: number;
  currency: string;
  status: string;
  description: string | null;
  journalTransactionId: string | null;
  refundedAmountMinor?: number;
  createdAt: string;
  completedAt: string | null;
}

export const authApi = {
  register: (body: { email: string; password: string; firstName: string; lastName: string; phoneNumber?: string }) =>
    apiRequest<{ user: UserSummary; tokens: { accessToken: string; refreshToken: string; expiresIn: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuthRefresh: true,
    }),
  login: (body: { email: string; password: string }) =>
    apiRequest<{ user: UserSummary; tokens: { accessToken: string; refreshToken: string; expiresIn: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuthRefresh: true,
    }),
  me: () => apiRequest<UserSummary>('/auth/me'),
  logout: () => apiRequest<{ message: string }>('/auth/logout', { method: 'POST', body: JSON.stringify({}) }),
  refreshWithCookie: () => tryCookieRefresh(),
  stepUpPassword: (body: { password: string; action: string }) =>
    apiRequest<{ verified: true; stepUpToken: string; expiresIn: string; method: string }>('/auth/step-up', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createMfaChallenge: (action: string) =>
    apiRequest<{ challengeId: string; expiresAt: string; simulatedNotice: string; simulatedCode?: string }>('/auth/mfa/challenge', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  verifyMfaChallenge: (challengeId: string, code: string) =>
    apiRequest<{ verified: true; stepUpToken: string; expiresIn: string; method: string; simulatedNotice?: string }>('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ challengeId, code }),
    }),
  listSessions: () => apiRequest<Array<{ id: string; ipAddress: string | null; userAgent: string | null; createdAt: string; isActive: boolean }>>('/auth/sessions'),
  revokeSession: (id: string) => apiRequest<{ revoked: boolean }>(`/auth/sessions/${id}`, { method: 'DELETE' }),
};

export const customersApi = {
  me: () => apiRequest<Record<string, unknown>>('/customers/me'),
  updateMe: (body: { displayName?: string; phoneNumber?: string; addressLine1?: string; city?: string; state?: string; postalCode?: string }) =>
    apiRequest<Record<string, unknown>>('/customers/me', { method: 'PATCH', body: JSON.stringify(body) }),
};

export const walletsApi = {
  list: (page = 1, pageSize = 25) => apiRequest<WalletRecord[]>(`/wallets?page=${page}&pageSize=${pageSize}`),
  create: (body: { walletName: string; currency: 'INR' }) =>
    apiRequest<WalletRecord>('/wallets', { method: 'POST', body: JSON.stringify(body) }),
  getBalance: (id: string) =>
    apiRequest<{ walletId: string; currency: string; ledgerBalanceMinor: number; availableBalanceMinor: number; simulatedLabel: string }>(`/wallets/${id}/balance`),
  getTransactions: (id: string, page = 1) => apiRequest<LedgerEntryRecord[]>(`/wallets/${id}/transactions?page=${page}&pageSize=25`),
  updateStatus: (id: string, body: { status: 'ACTIVE' | 'FROZEN' | 'CLOSED'; reason?: string }, stepUpToken: string) =>
    apiRequest<WalletRecord>(`/wallets/${id}/status`, {
      method: 'PATCH',
      headers: { 'X-Step-Up-Token': stepUpToken },
      body: JSON.stringify(body),
    }),
};

export const beneficiariesApi = {
  list: () => apiRequest<BeneficiaryRecord[]>('/beneficiaries?page=1&pageSize=50'),
  create: (body: { destinationWalletId: string; nickname: string }, stepUpToken: string) =>
    apiRequest<BeneficiaryRecord>('/beneficiaries', {
      method: 'POST',
      headers: { 'X-Step-Up-Token': stepUpToken },
      body: JSON.stringify(body),
    }),
  update: (id: string, body: { nickname: string }, stepUpToken: string) =>
    apiRequest<BeneficiaryRecord>(`/beneficiaries/${id}`, {
      method: 'PATCH',
      headers: { 'X-Step-Up-Token': stepUpToken },
      body: JSON.stringify(body),
    }),
  deactivate: (id: string, stepUpToken: string) =>
    apiRequest<BeneficiaryRecord>(`/beneficiaries/${id}`, {
      method: 'DELETE',
      headers: { 'X-Step-Up-Token': stepUpToken },
    }),
};

export const transfersApi = {
  list: (page = 1) => apiRequest<TransferRecord[]>(`/transfers?page=${page}&pageSize=25`),
  create: (
    body: {
      sourceWalletId: string;
      destinationWalletId: string;
      amountMinor: number;
      currency: 'INR';
      description?: string;
      requireConfirmation?: boolean;
    },
    idempotencyKey: string,
    stepUpToken: string,
  ) =>
    apiRequest<TransferRecord>('/transfers', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Step-Up-Token': stepUpToken,
      },
      body: JSON.stringify(body),
    }),
  confirm: (id: string, stepUpToken: string) =>
    apiRequest<TransferRecord>(`/transfers/${id}/confirm`, {
      method: 'POST',
      headers: { 'X-Step-Up-Token': stepUpToken },
    }),
  cancel: (id: string) =>
    apiRequest<TransferRecord>(`/transfers/${id}/cancel`, { method: 'POST' }),
};

export const paymentsApi = {
  list: () => apiRequest<Array<Record<string, unknown>>>('/payment-intents?page=1&pageSize=25'),
  create: (body: { walletId: string; amountMinor: number; currency: 'INR'; description?: string }, idempotencyKey: string) =>
    apiRequest<Record<string, unknown>>('/payment-intents', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }),
  simulateWebhook: (id: string, eventType: 'payment.captured' | 'payment.failed') =>
    apiRequest<Record<string, unknown>>(`/payment-intents/${id}/simulate-webhook`, {
      method: 'POST',
      body: JSON.stringify({ eventType }),
    }),
};

export const statementsApi = {
  list: () => apiRequest<Array<Record<string, unknown>>>('/statements?page=1&pageSize=25'),
  generate: (body: { walletId: string; periodStart: string; periodEnd: string }) =>
    apiRequest<Record<string, unknown>>('/statements', { method: 'POST', body: JSON.stringify(body) }),
  downloadCsv: async (id: string) => {
    const requestCsv = (token: string | null) =>
      fetch(`${webEnv.apiBaseUrl}/statements/${id}/export`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

    let res = await requestCsv(getMemoryAccessToken());
    if (res.status === 401) {
      const refreshed = await tryCookieRefresh();
      if (refreshed) {
        res = await requestCsv(refreshed);
      }
    }
    if (!res.ok) throw new Error('Failed to export statement CSV');
    return res.text();
  },
};

export const disputesApi = {
  list: () => apiRequest<Array<Record<string, unknown>>>('/disputes?page=1&pageSize=25'),
  getById: (id: string) => apiRequest<Record<string, unknown>>(`/disputes/${id}`),
  create: (body: { transferId?: string; paymentIntentId?: string; reason: string; description?: string }) =>
    apiRequest<Record<string, unknown>>('/disputes', { method: 'POST', body: JSON.stringify(body) }),
  addEvent: (id: string, body: { eventType: string; comment?: string; toStatus?: string }) =>
    apiRequest<Record<string, unknown>>(`/disputes/${id}/events`, { method: 'POST', body: JSON.stringify(body) }),
};

export const operationsApi = {
  dashboard: () => apiRequest<Record<string, unknown>>('/operations/dashboard'),
  riskAlerts: (page = 1) => apiRequest<Array<Record<string, unknown>>>(`/risk/alerts?page=${page}&pageSize=25`),
  reviewRiskAlert: (id: string, body: { status: string; reviewNotes?: string }) =>
    apiRequest<Record<string, unknown>>(`/risk/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  assessRisk: (body: Record<string, unknown>) =>
    apiRequest<Record<string, unknown>>('/risk/assess', { method: 'POST', body: JSON.stringify(body) }),
  reconciliationRuns: () => apiRequest<Array<Record<string, unknown>>>('/reconciliation/runs?page=1&pageSize=25'),
  reconciliationExceptions: () => apiRequest<Array<Record<string, unknown>>>('/reconciliation/exceptions?page=1&pageSize=25'),
  createReconciliationRun: (body: Record<string, unknown>) =>
    apiRequest<Record<string, unknown>>('/reconciliation/runs', { method: 'POST', body: JSON.stringify(body) }),
  resolveException: (id: string, body: { notes: string; status: 'RESOLVED' | 'DISMISSED' }) =>
    apiRequest<Record<string, unknown>>(`/reconciliation/exceptions/${id}/resolve`, { method: 'PATCH', body: JSON.stringify(body) }),
  createRefund: (body: { transferId?: string; paymentIntentId?: string; amountMinor: number; reason?: string }, idempotencyKey: string, stepUpToken: string) =>
    apiRequest<Record<string, unknown>>('/refunds', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey, 'X-Step-Up-Token': stepUpToken },
      body: JSON.stringify(body),
    }),
  createReversal: (body: { transferId: string; reason: string }, idempotencyKey: string, stepUpToken: string) =>
    apiRequest<Record<string, unknown>>('/reversals', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey, 'X-Step-Up-Token': stepUpToken },
      body: JSON.stringify(body),
    }),
};

export const adminApi = {
  users: () => apiRequest<Array<Record<string, unknown>>>('/admin/users?page=1&pageSize=50'),
  updateRoles: (id: string, roles: string[], stepUpToken: string) =>
    apiRequest<Record<string, unknown>>(`/admin/users/${id}/roles`, {
      method: 'PATCH',
      headers: { 'X-Step-Up-Token': stepUpToken },
      body: JSON.stringify({ roles }),
    }),
  updateUserStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED', stepUpToken: string, reason?: string) =>
    apiRequest<Record<string, unknown>>(`/admin/users/${id}/status`, {
      method: 'PATCH',
      headers: { 'X-Step-Up-Token': stepUpToken },
      body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
    }),
  auditEvents: (page = 1) => apiRequest<Array<Record<string, unknown>>>(`/admin/audit-events?page=${page}&pageSize=30`),
  config: () => apiRequest<Record<string, unknown>>('/admin/config'),
  failedOutbox: () => apiRequest<Array<Record<string, unknown>>>('/admin/outbox/failed'),
  replayOutbox: (id: string) => apiRequest<Record<string, unknown>>(`/admin/outbox/${id}/replay`, { method: 'POST' }),
};
