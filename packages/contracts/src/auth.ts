import { z } from 'zod';
import { Role } from './enums.js';

// Auth-related schemas shared between API and web

export const RegisterRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$/,
      'Password must contain uppercase, lowercase, digit, and special character',
    ),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phoneNumber: z.string().max(20).regex(/^\+?[0-9\s\-()]+$/).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.union([z.number(), z.string()]),
});
export type AuthTokens = z.infer<typeof AuthTokens>;

export const AuthUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  roles: z.array(z.nativeEnum(Role)),
  status: z.string(),
});
export type AuthUser = z.infer<typeof AuthUser>;

export const MfaChallengeRequest = z.object({
  action: z.string().min(1),
});

export const MfaVerifyRequest = z.object({
  challengeId: z.string().uuid(),
  code: z.string().length(6),
});
