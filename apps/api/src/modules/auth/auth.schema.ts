// ---------------------------------------------------------------------------
// FinCore API – Auth Module – Zod Validation Schemas
// ---------------------------------------------------------------------------

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/,
      'Password must contain uppercase, lowercase, digit, and special character',
    ),
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().min(1).max(100).trim(),
  phoneNumber: z
    .string()
    .max(20)
    .regex(/^\+?[0-9\s\-()]+$/, 'Invalid phone number format')
    .optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Invalid email address')
    .max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export type LogoutInput = z.infer<typeof logoutSchema>;

// ---------------------------------------------------------------------------
// Step-Up Reauthentication (Password Confirmation)
// ---------------------------------------------------------------------------

export const stepUpSchema = z.object({
  password: z.string().min(1, 'Password is required').max(128),
  action: z
    .enum(['TRANSFER', 'BENEFICIARY_CHANGE', 'REFUND', 'REVERSAL', 'ROLE_CHANGE', 'ALL'])
    .default('ALL'),
});

export type StepUpInput = z.infer<typeof stepUpSchema>;

// ---------------------------------------------------------------------------
// MFA Challenge – Create
// ---------------------------------------------------------------------------

export const mfaChallengeSchema = z.object({
  action: z
    .string()
    .min(1)
    .max(100)
    .toUpperCase(),
});

export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;

// ---------------------------------------------------------------------------
// MFA Challenge – Verify
// ---------------------------------------------------------------------------

export const mfaVerifySchema = z.object({
  challengeId: z.string().uuid('Invalid challenge ID'),
  code: z
    .string()
    .length(6, 'MFA code must be 6 digits')
    .regex(/^\d{6}$/, 'MFA code must be 6 digits'),
});

export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

// ---------------------------------------------------------------------------
// Session revoke param
// ---------------------------------------------------------------------------

export const sessionIdParamSchema = z.object({
  id: z.string().uuid('Invalid session ID'),
});

export type SessionIdParam = z.infer<typeof sessionIdParamSchema>;
