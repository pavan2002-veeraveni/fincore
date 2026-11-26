// ---------------------------------------------------------------------------
// FinCore API – Auth Module – Service (Business Logic)
// ---------------------------------------------------------------------------

import { randomBytes, randomInt, randomUUID, createHash, createHmac } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDb } from '../../infrastructure/database/connection.js';
import { logger } from '../../infrastructure/logger/index.js';
import { config } from '../../config/index.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '../../shared/errors/index.js';
import { AuthRepository } from './auth.repository.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 64;
const MFA_CODE_LENGTH = 6;
const MFA_EXPIRY_MINUTES = 10;
const MAX_MFA_ATTEMPTS = 5;
const SESSION_DURATION_DAYS = 30;
const STEP_UP_EXPIRY = '5m';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashRefreshToken(value: string): string {
  return createHmac('sha256', config.REFRESH_TOKEN_SECRET).update(value).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}

function generateMfaCode(): string {
  // Cryptographically strong 6-digit numeric code (for simulated MFA only)
  const num = randomInt(0, 1_000_000);
  return num.toString().padStart(MFA_CODE_LENGTH, '0');
}

function parseExpiryToMs(expiry: string): number {
  const match = expiry.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match || !match[1] || !match[2]) {
    // Default fallback for formats like "15m"
    return 15 * 60 * 1000;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default:  return 15 * 60 * 1000;
  }
}

function signAccessToken(payload: {
  userId: string;
  roles: string[];
  sessionId: string;
}): string {
  return jwt.sign(
    {
      sub: payload.userId,
      roles: payload.roles,
      sessionId: payload.sessionId,
    },
    config.ACCESS_TOKEN_SECRET,
    { expiresIn: config.ACCESS_TOKEN_EXPIRY as jwt.SignOptions['expiresIn'] },
  );
}

function signStepUpToken(payload: {
  userId: string;
  sessionId: string;
  action: string;
}): string {
  return jwt.sign(
    {
      sub: payload.userId,
      sessionId: payload.sessionId,
      purpose: 'step_up',
      action: payload.action,
    },
    config.ACCESS_TOKEN_SECRET,
    { expiresIn: STEP_UP_EXPIRY as jwt.SignOptions['expiresIn'] },
  );
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface UserInfo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  status: string;
  roles: string[];
  createdAt: Date;
}

export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export interface MfaChallengeResult {
  challengeId: string;
  expiresAt: Date;
  simulatedNotice: string;
  /** Only returned in non-production educational simulation environments. */
  simulatedCode?: string;
}

export interface StepUpResult {
  verified: true;
  stepUpToken: string;
  expiresIn: string;
  method: 'PASSWORD_REAUTH' | 'SIMULATED_MFA';
  simulatedNotice?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuthService {
  private repo: AuthRepository;

  constructor() {
    this.repo = new AuthRepository();
  }

  // ── Register ─────────────────────────────────────────────────────────────

  async register(
    input: RegisterInput,
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<{ user: UserInfo; tokens: AuthTokens }> {
    const db = getDb();

    return db.transaction(async (trx) => {
      const repo = this.repo.withTransaction(trx);

      // 1. Check unique email
      const existing = await repo.findUserByEmail(input.email);
      if (existing) {
        throw new ConflictError('An account with this email already exists');
      }

      // 2. Hash password
      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      // 3. Create user
      const user = await repo.createUser({
        email: input.email,
        password_hash: passwordHash,
        first_name: input.firstName,
        last_name: input.lastName,
        phone_number: input.phoneNumber ?? null,
      });

      // 4. Find or create CUSTOMER role, then assign
      let role = await repo.findRoleByName('CUSTOMER');
      if (!role) {
        role = await repo.createRole({
          name: 'CUSTOMER',
          description: 'Default customer role',
        });
      }
      await repo.assignRole({ user_id: user.id, role_id: role.id });

      // 5. Create customer profile
      await repo.createCustomerProfile({
        user_id: user.id,
        display_name: `${input.firstName} ${input.lastName}`,
      });

      // 6. Create session
      const sessionExpiresAt = new Date(
        Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
      );
      const session = await repo.createSession({
        user_id: user.id,
        ip_address: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
        expires_at: sessionExpiresAt,
      });

      // 7. Create refresh token
      const rawRefreshToken = generateRefreshToken();
      const tokenHash = hashRefreshToken(rawRefreshToken);
      const familyId = randomUUID();
      const refreshExpiresAt = new Date(
        Date.now() + parseExpiryToMs(config.REFRESH_TOKEN_EXPIRY),
      );

      await repo.createRefreshToken({
        user_id: user.id,
        session_id: session.id,
        token_hash: tokenHash,
        family_id: familyId,
        generation: 0,
        expires_at: refreshExpiresAt,
      });

      // 8. Sign access token
      const roles = ['CUSTOMER'];
      const accessToken = signAccessToken({
        userId: user.id,
        roles,
        sessionId: session.id,
      });

      // 9. Audit
      await repo.createAuditEvent({
        actor_id: user.id,
        action: 'USER_REGISTERED',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
        request_id: meta.requestId ?? null,
      });

      logger.info({ userId: user.id }, 'user registered');

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          phoneNumber: user.phone_number,
          status: user.status,
          roles,
          createdAt: user.created_at,
        },
        tokens: {
          accessToken,
          refreshToken: rawRefreshToken,
          expiresIn: config.ACCESS_TOKEN_EXPIRY,
        },
      };
    });
  }

  // ── Login ────────────────────────────────────────────────────────────────

  async login(
    input: LoginInput,
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<{ user: UserInfo; tokens: AuthTokens }> {
    const db = getDb();

    const result = await db.transaction(async (trx) => {
      const repo = this.repo.withTransaction(trx);

      // 1. Find user
      const user = await repo.findUserByEmail(input.email);
      if (!user) {
        return { error: 'INVALID_CREDENTIALS' as const };
      }

      // 2. Verify password
      const isMatch = await bcrypt.compare(input.password, user.password_hash);
      if (!isMatch) {
        await repo.createAuditEvent({
          actor_id: user.id,
          action: 'LOGIN_FAILED',
          resource_type: 'user',
          resource_id: user.id,
          details: { reason: 'invalid_password' },
          ip_address: meta.ip ?? null,
          user_agent: meta.userAgent ?? null,
          request_id: meta.requestId ?? null,
        });
        return { error: 'INVALID_CREDENTIALS' as const };
      }

      // 3. Check status
      if (user.status !== 'ACTIVE') {
        return { error: 'INACTIVE_ACCOUNT' as const, status: user.status };
      }

      // 4. Get roles
      const roles = await repo.getUserRoles(user.id);

      // 5. Create session
      const sessionExpiresAt = new Date(
        Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
      );
      const session = await repo.createSession({
        user_id: user.id,
        ip_address: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
        expires_at: sessionExpiresAt,
      });

      // 6. Create refresh token
      const rawRefreshToken = generateRefreshToken();
      const tokenHash = hashRefreshToken(rawRefreshToken);
      const familyId = randomUUID();
      const refreshExpiresAt = new Date(
        Date.now() + parseExpiryToMs(config.REFRESH_TOKEN_EXPIRY),
      );

      await repo.createRefreshToken({
        user_id: user.id,
        session_id: session.id,
        token_hash: tokenHash,
        family_id: familyId,
        generation: 0,
        expires_at: refreshExpiresAt,
      });

      // 7. Sign access token
      const accessToken = signAccessToken({
        userId: user.id,
        roles,
        sessionId: session.id,
      });

      // 8. Audit
      await repo.createAuditEvent({
        actor_id: user.id,
        action: 'LOGIN_SUCCESS',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
        request_id: meta.requestId ?? null,
      });

      logger.info({ userId: user.id }, 'user logged in');

      return {
        error: null,
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            phoneNumber: user.phone_number,
            status: user.status,
            roles,
            createdAt: user.created_at,
          },
          tokens: {
            accessToken,
            refreshToken: rawRefreshToken,
            expiresIn: config.ACCESS_TOKEN_EXPIRY,
          },
        },
      };
    });

    if (result.error === 'INVALID_CREDENTIALS') {
      throw new UnauthorizedError('Invalid email or password');
    }
    if (result.error === 'INACTIVE_ACCOUNT') {
      throw new ForbiddenError(
        `Account is ${result.status.toLowerCase()}. Please contact support.`,
      );
    }
    return result.data;
  }

  // ── Refresh ──────────────────────────────────────────────────────────────

  async refresh(
    rawRefreshToken: string,
    meta: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<AuthTokens> {
    const db = getDb();

    const outcome = await db.transaction(async (trx) => {
      const repo = this.repo.withTransaction(trx);

      const tokenHash = hashRefreshToken(rawRefreshToken);
      const storedToken = await repo.findRefreshTokenByHash(tokenHash);

      // Token not found
      if (!storedToken) {
        return { error: 'INVALID_TOKEN' as const };
      }

      // Token was revoked
      if (storedToken.revoked_at) {
        return { error: 'REVOKED_TOKEN' as const };
      }

      // Token expired
      if (new Date(storedToken.expires_at) < new Date()) {
        return { error: 'EXPIRED_TOKEN' as const };
      }

      // Associated session must still be active
      const session = await repo.findSessionById(storedToken.session_id);
      if (!session || !session.is_active || new Date(session.expires_at) < new Date()) {
        return { error: 'SESSION_INACTIVE' as const };
      }

      // ── Reuse detection ──────────────────────────────────────────────
      // Commit family revocation + session revocation + security audit BEFORE throwing 401!
      if (storedToken.is_used) {
        logger.warn(
          { familyId: storedToken.family_id, userId: storedToken.user_id },
          'refresh token reuse detected – revoking entire family',
        );

        await repo.revokeRefreshTokenFamily(storedToken.family_id);
        await repo.revokeSession(storedToken.session_id);
        await repo.createAuditEvent({
          actor_id: storedToken.user_id,
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          resource_type: 'refresh_token',
          resource_id: storedToken.id,
          details: { familyId: storedToken.family_id },
          ip_address: meta.ip ?? null,
          user_agent: meta.userAgent ?? null,
          request_id: meta.requestId ?? null,
        });

        return { error: 'REUSE_DETECTED' as const };
      }

      // ── Rotate ───────────────────────────────────────────────────────
      await repo.markRefreshTokenUsed(storedToken.id);

      const newRawToken = generateRefreshToken();
      const newTokenHash = hashRefreshToken(newRawToken);
      const refreshExpiresAt = new Date(
        Date.now() + parseExpiryToMs(config.REFRESH_TOKEN_EXPIRY),
      );

      await repo.createRefreshToken({
        user_id: storedToken.user_id,
        session_id: storedToken.session_id,
        token_hash: newTokenHash,
        family_id: storedToken.family_id,
        generation: storedToken.generation + 1,
        expires_at: refreshExpiresAt,
      });

      const roles = await repo.getUserRoles(storedToken.user_id);

      const accessToken = signAccessToken({
        userId: storedToken.user_id,
        roles,
        sessionId: storedToken.session_id,
      });

      logger.info(
        { userId: storedToken.user_id, generation: storedToken.generation + 1 },
        'refresh token rotated',
      );

      return {
        error: null,
        tokens: {
          accessToken,
          refreshToken: newRawToken,
          expiresIn: config.ACCESS_TOKEN_EXPIRY,
        },
      };
    });

    if (outcome.error === 'INVALID_TOKEN') {
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (outcome.error === 'REVOKED_TOKEN') {
      throw new UnauthorizedError('Refresh token has been revoked');
    }
    if (outcome.error === 'EXPIRED_TOKEN') {
      throw new UnauthorizedError('Refresh token has expired');
    }
    if (outcome.error === 'SESSION_INACTIVE') {
      throw new UnauthorizedError('Session has been revoked or expired');
    }
    if (outcome.error === 'REUSE_DETECTED') {
      throw new UnauthorizedError(
        'Refresh token reuse detected. All sessions in this family have been revoked.',
      );
    }

    return outcome.tokens;
  }

  // ── Logout ───────────────────────────────────────────────────────────────

  async logout(
    rawRefreshToken: string,
    meta: { userId: string; requestId?: string },
  ): Promise<void> {
    const db = getDb();

    await db.transaction(async (trx) => {
      const repo = this.repo.withTransaction(trx);

      const tokenHash = hashRefreshToken(rawRefreshToken);
      const storedToken = await repo.findRefreshTokenByHash(tokenHash);

      if (storedToken) {
        if (storedToken.user_id !== meta.userId) {
          throw new ForbiddenError('Refresh token does not belong to current user');
        }

        // Revoke the refresh token
        await repo.revokeRefreshToken(storedToken.id);

        // Revoke the associated session
        await repo.revokeSession(storedToken.session_id);

        await repo.createAuditEvent({
          actor_id: meta.userId,
          action: 'LOGOUT',
          resource_type: 'session',
          resource_id: storedToken.session_id,
          request_id: meta.requestId ?? null,
        });
      }

      logger.info({ userId: meta.userId }, 'user logged out');
    });
  }

  // ── MFA Challenge – Create ───────────────────────────────────────────────

  async createMfaChallenge(
    userId: string,
    action: string,
    meta: { requestId?: string },
  ): Promise<MfaChallengeResult> {
    const repo = this.repo;

    const code = generateMfaCode();
    const codeHash = hashSha256(code);
    const expiresAt = new Date(Date.now() + MFA_EXPIRY_MINUTES * 60 * 1000);

    const challenge = await repo.createMfaChallenge({
      user_id: userId,
      action,
      code_hash: codeHash,
      expires_at: expiresAt,
    });

    await repo.createAuditEvent({
      actor_id: userId,
      action: 'MFA_CHALLENGE_CREATED',
      resource_type: 'mfa_challenge',
      resource_id: challenge.id,
      details: { mfaAction: action },
      request_id: meta.requestId ?? null,
    });

    logger.info(
      { userId, challengeId: challenge.id, action },
      'MFA challenge created',
    );

    const result: MfaChallengeResult = {
      challengeId: challenge.id,
      expiresAt,
      simulatedNotice: 'SIMULATED MFA — Educational simulation only, NOT production identity proofing.',
    };

    // In non-production environments, return the simulated code for local/test flows
    if (config.NODE_ENV !== 'production') {
      result.simulatedCode = code;
    }

    return result;
  }

  // ── MFA Challenge – Verify ──────────────────────────────────────────────

  async verifyMfaChallenge(
    userId: string,
    sessionId: string,
    challengeId: string,
    code: string,
    meta: { requestId?: string },
  ): Promise<StepUpResult> {
    const db = getDb();

    const outcome = await db.transaction(async (trx) => {
      const repo = this.repo.withTransaction(trx);
      const challenge = await repo.findMfaChallengeByIdForUpdate(challengeId);
      if (!challenge) {
        return { error: 'NOT_FOUND' as const };
      }

      // Must belong to the requesting user
      if (challenge.user_id !== userId) {
        return { error: 'FORBIDDEN' as const };
      }

      // Already verified
      if (challenge.verified) {
        return { error: 'ALREADY_VERIFIED' as const };
      }

      // Expired
      if (new Date(challenge.expires_at) < new Date()) {
        return { error: 'EXPIRED' as const };
      }

      // Max attempts
      if (challenge.attempts >= MAX_MFA_ATTEMPTS) {
        return { error: 'MAX_ATTEMPTS' as const };
      }

      // Increment attempts under row lock and persist even if verification fails
      await repo.incrementMfaAttempts(challengeId);

      const codeHash = hashSha256(code);
      if (codeHash !== challenge.code_hash) {
        await repo.createAuditEvent({
          actor_id: userId,
          action: 'MFA_VERIFY_FAILED',
          resource_type: 'mfa_challenge',
          resource_id: challengeId,
          details: { attempts: challenge.attempts + 1 },
          request_id: meta.requestId ?? null,
        });
        return { error: 'INVALID_CODE' as const };
      }

      await repo.markMfaChallengeVerified(challengeId);

      const stepUpToken = signStepUpToken({
        userId,
        sessionId,
        action: challenge.action || 'ALL',
      });

      await repo.createAuditEvent({
        actor_id: userId,
        action: 'MFA_VERIFY_SUCCESS',
        resource_type: 'mfa_challenge',
        resource_id: challengeId,
        details: { action: challenge.action, method: 'SIMULATED_MFA' },
        request_id: meta.requestId ?? null,
      });

      logger.info({ userId, challengeId }, 'MFA challenge verified');
      return { error: null, stepUpToken };
    });

    if (outcome.error === 'NOT_FOUND') throw new NotFoundError('MFA challenge not found');
    if (outcome.error === 'FORBIDDEN') throw new ForbiddenError('MFA challenge does not belong to this user');
    if (outcome.error === 'ALREADY_VERIFIED') throw new ValidationError('MFA challenge has already been verified');
    if (outcome.error === 'EXPIRED') throw new ValidationError('MFA challenge has expired');
    if (outcome.error === 'MAX_ATTEMPTS') {
      throw new ValidationError('Maximum MFA verification attempts exceeded. Please request a new challenge.');
    }
    if (outcome.error === 'INVALID_CODE') throw new ValidationError('Invalid MFA code');

    return {
      verified: true,
      stepUpToken: outcome.stepUpToken,
      expiresIn: STEP_UP_EXPIRY,
      method: 'SIMULATED_MFA',
      simulatedNotice: 'SIMULATED MFA — NOT FOR PRODUCTION.',
    };
  }

  // ── Step-Up Reauthentication (Password) ──────────────────────────────────

  async verifyStepUpPassword(
    userId: string,
    sessionId: string,
    password: string,
    action: string,
    meta: { requestId?: string },
  ): Promise<StepUpResult> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await this.repo.createAuditEvent({
        actor_id: userId,
        action: 'STEP_UP_FAILED',
        resource_type: 'session',
        resource_id: sessionId,
        details: { action },
        request_id: meta.requestId ?? null,
      });
      throw new UnauthorizedError('Invalid password for step-up reauthentication');
    }

    const stepUpToken = signStepUpToken({ userId, sessionId, action });

    await this.repo.createAuditEvent({
      actor_id: userId,
      action: 'STEP_UP_VERIFIED',
      resource_type: 'session',
      resource_id: sessionId,
      details: { action, method: 'PASSWORD_REAUTH' },
      request_id: meta.requestId ?? null,
    });

    return {
      verified: true,
      stepUpToken,
      expiresIn: STEP_UP_EXPIRY,
      method: 'PASSWORD_REAUTH',
    };
  }

  // ── Get User By ID ──────────────────────────────────────────────────────

  async getUserById(userId: string): Promise<UserInfo> {
    const repo = this.repo;

    const user = await repo.findUserById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const roles = await repo.getUserRoles(userId);

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phoneNumber: user.phone_number,
      status: user.status,
      roles,
      createdAt: user.created_at,
    };
  }

  // ── List Sessions ───────────────────────────────────────────────────────

  async listSessions(userId: string): Promise<SessionInfo[]> {
    const sessions = await this.repo.listActiveSessions(userId);

    return sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ip_address,
      userAgent: s.user_agent,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      isActive: s.is_active,
    }));
  }

  // ── Revoke Session ──────────────────────────────────────────────────────

  async revokeSession(
    userId: string,
    sessionId: string,
    meta: { requestId?: string },
  ): Promise<void> {
    const repo = this.repo;

    const session = await repo.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundError('Session not found');
    }

    // Users can only revoke their own sessions
    if (session.user_id !== userId) {
      throw new ForbiddenError('Cannot revoke another user\'s session');
    }

    if (!session.is_active) {
      throw new ValidationError('Session is already revoked');
    }

    await repo.revokeSession(sessionId);

    await repo.createAuditEvent({
      actor_id: userId,
      action: 'SESSION_REVOKED',
      resource_type: 'session',
      resource_id: sessionId,
      request_id: meta.requestId ?? null,
    });

    logger.info({ userId, sessionId }, 'session revoked');
  }
}

export const authService = new AuthService();
