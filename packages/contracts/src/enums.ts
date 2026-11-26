// Stable enum values used across the platform.
// Database stores these as TEXT; application validates membership.

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const Role = {
  CUSTOMER: 'CUSTOMER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  OPERATIONS_ANALYST: 'OPERATIONS_ANALYST',
  FINANCE_ADMIN: 'FINANCE_ADMIN',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const WalletStatus = {
  ACTIVE: 'ACTIVE',
  FROZEN: 'FROZEN',
  CLOSED: 'CLOSED',
} as const;
export type WalletStatus = (typeof WalletStatus)[keyof typeof WalletStatus];

export const WalletType = {
  CUSTOMER: 'CUSTOMER',
  SYSTEM_CLEARING: 'SYSTEM_CLEARING',
  SYSTEM_FEE: 'SYSTEM_FEE',
  SYSTEM_SUSPENSE: 'SYSTEM_SUSPENSE',
} as const;
export type WalletType = (typeof WalletType)[keyof typeof WalletType];

export const BeneficiaryStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
} as const;
export type BeneficiaryStatus = (typeof BeneficiaryStatus)[keyof typeof BeneficiaryStatus];

export const TransferStatus = {
  CREATED: 'CREATED',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  REVERSED: 'REVERSED',
} as const;
export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];

export const JournalStatus = {
  PENDING: 'PENDING',
  POSTED: 'POSTED',
  VOID: 'VOID',
} as const;
export type JournalStatus = (typeof JournalStatus)[keyof typeof JournalStatus];

export const EntryType = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;
export type EntryType = (typeof EntryType)[keyof typeof EntryType];

export const HoldStatus = {
  ACTIVE: 'ACTIVE',
  CAPTURED: 'CAPTURED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
} as const;
export type HoldStatus = (typeof HoldStatus)[keyof typeof HoldStatus];

export const PaymentIntentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentIntentStatus = (typeof PaymentIntentStatus)[keyof typeof PaymentIntentStatus];

export const ProviderEventStatus = {
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
  IGNORED: 'IGNORED',
} as const;
export type ProviderEventStatus = (typeof ProviderEventStatus)[keyof typeof ProviderEventStatus];

export const RefundStatus = {
  CREATED: 'CREATED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const DisputeStatus = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  INFORMATION_REQUESTED: 'INFORMATION_REQUESTED',
  RESOLVED_ACCEPTED: 'RESOLVED_ACCEPTED',
  RESOLVED_REJECTED: 'RESOLVED_REJECTED',
  CLOSED: 'CLOSED',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export const ReconciliationStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type ReconciliationStatus = (typeof ReconciliationStatus)[keyof typeof ReconciliationStatus];

export const ReconciliationItemType = {
  MATCHED: 'MATCHED',
  MISSING_INTERNAL: 'MISSING_INTERNAL',
  MISSING_PROVIDER: 'MISSING_PROVIDER',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  DUPLICATE: 'DUPLICATE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ReconciliationItemType = (typeof ReconciliationItemType)[keyof typeof ReconciliationItemType];

export const RiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const NotificationChannel = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

export const AuditAction = {
  USER_REGISTERED: 'USER_REGISTERED',
  USER_LOGIN: 'USER_LOGIN',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  USER_LOGOUT: 'USER_LOGOUT',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  MFA_CHALLENGE_CREATED: 'MFA_CHALLENGE_CREATED',
  MFA_CHALLENGE_VERIFIED: 'MFA_CHALLENGE_VERIFIED',
  MFA_VERIFY_SUCCESS: 'MFA_VERIFY_SUCCESS',
  MFA_VERIFY_FAILED: 'MFA_VERIFY_FAILED',
  STEP_UP_VERIFIED: 'STEP_UP_VERIFIED',
  STEP_UP_FAILED: 'STEP_UP_FAILED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  WALLET_CREATED: 'WALLET_CREATED',
  WALLET_STATUS_CHANGED: 'WALLET_STATUS_CHANGED',
  BENEFICIARY_CREATED: 'BENEFICIARY_CREATED',
  BENEFICIARY_UPDATED: 'BENEFICIARY_UPDATED',
  BENEFICIARY_DEACTIVATED: 'BENEFICIARY_DEACTIVATED',
  TRANSFER_CREATED: 'TRANSFER_CREATED',
  TRANSFER_CONFIRMED: 'TRANSFER_CONFIRMED',
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  TRANSFER_FAILED: 'TRANSFER_FAILED',
  PAYMENT_INTENT_CREATED: 'PAYMENT_INTENT_CREATED',
  PAYMENT_INTENT_UPDATED: 'PAYMENT_INTENT_UPDATED',
  WEBHOOK_RECEIVED: 'WEBHOOK_RECEIVED',
  WEBHOOK_PROCESSED: 'WEBHOOK_PROCESSED',
  REFUND_CREATED: 'REFUND_CREATED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  REVERSAL_CREATED: 'REVERSAL_CREATED',
  DISPUTE_CREATED: 'DISPUTE_CREATED',
  DISPUTE_UPDATED: 'DISPUTE_UPDATED',
  RECONCILIATION_RUN: 'RECONCILIATION_RUN',
  RISK_ALERT_CREATED: 'RISK_ALERT_CREATED',
  RISK_ASSESSMENT_CREATED: 'RISK_ASSESSMENT_CREATED',
  STATEMENT_GENERATED: 'STATEMENT_GENERATED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  USER_STATUS_UPDATED: 'USER_STATUS_UPDATED',
  ADMIN_ACTION: 'ADMIN_ACTION',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const Currency = {
  INR: 'INR',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

// Currency metadata
export const CURRENCY_CONFIG: Record<Currency, { code: Currency; minorDigits: number; symbol: string }> = {
  INR: { code: 'INR', minorDigits: 2, symbol: '₹' },
};

export const OutboxStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];
