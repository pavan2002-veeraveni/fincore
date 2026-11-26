// ---------------------------------------------------------------------------
// FinCore API – Auth Module – Repository (Database Access)
// ---------------------------------------------------------------------------

import { type Knex } from 'knex';
import { getDb } from '../../infrastructure/database/connection.js';

// ---------------------------------------------------------------------------
// Row types (mirror database columns)
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  deactivated_at: Date | null;
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

export interface UserRoleRow {
  id: string;
  user_id: string;
  role_id: string;
  granted_by: string | null;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  is_active: boolean;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  session_id: string;
  token_hash: string;
  family_id: string;
  generation: number;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  is_used: boolean;
}

export interface MfaChallengeRow {
  id: string;
  user_id: string;
  action: string;
  code_hash: string;
  verified: boolean;
  attempts: number;
  created_at: Date;
  expires_at: Date;
  verified_at: Date | null;
}

export interface AuditEventRow {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AuthRepository {
  private db: Knex;

  constructor(trx?: Knex) {
    this.db = trx ?? getDb();
  }

  /** Create a repository that participates in an existing transaction. */
  withTransaction(trx: Knex.Transaction): AuthRepository {
    return new AuthRepository(trx);
  }

  // ── Users ────────────────────────────────────────────────────────────────

  async findUserByEmail(email: string): Promise<UserRow | undefined> {
    return this.db<UserRow>('users').where({ email }).first();
  }

  async findUserById(id: string): Promise<UserRow | undefined> {
    return this.db<UserRow>('users').where({ id }).first();
  }

  async createUser(data: {
    email: string;
    password_hash: string;
    first_name: string;
    last_name: string;
    phone_number?: string | null;
  }): Promise<UserRow> {
    const [user] = await this.db<UserRow>('users')
      .insert({
        email: data.email,
        password_hash: data.password_hash,
        first_name: data.first_name,
        last_name: data.last_name,
        phone_number: data.phone_number ?? null,
      })
      .returning('*');
    return user!;
  }

  // ── Roles ────────────────────────────────────────────────────────────────

  async findRoleByName(name: string): Promise<RoleRow | undefined> {
    return this.db<RoleRow>('roles').where({ name }).first();
  }

  async createRole(data: {
    name: string;
    description?: string | null;
  }): Promise<RoleRow> {
    const [role] = await this.db<RoleRow>('roles')
      .insert({
        name: data.name,
        description: data.description ?? null,
      })
      .returning('*');
    return role!;
  }

  // ── User Roles ───────────────────────────────────────────────────────────

  async assignRole(data: {
    user_id: string;
    role_id: string;
    granted_by?: string | null;
  }): Promise<UserRoleRow> {
    const [row] = await this.db<UserRoleRow>('user_roles')
      .insert({
        user_id: data.user_id,
        role_id: data.role_id,
        granted_by: data.granted_by ?? null,
      })
      .returning('*');
    return row!;
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const rows = await this.db('user_roles')
      .join('roles', 'user_roles.role_id', 'roles.id')
      .where('user_roles.user_id', userId)
      .select<{ name: string }[]>('roles.name');
    return rows.map((r) => r.name);
  }

  // ── Customer Profiles ────────────────────────────────────────────────────

  async createCustomerProfile(data: {
    user_id: string;
    display_name?: string | null;
  }): Promise<void> {
    await this.db('customer_profiles').insert({
      user_id: data.user_id,
      display_name: data.display_name ?? null,
    });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  async createSession(data: {
    user_id: string;
    ip_address?: string | null;
    user_agent?: string | null;
    expires_at: Date;
  }): Promise<SessionRow> {
    const [session] = await this.db<SessionRow>('sessions')
      .insert({
        user_id: data.user_id,
        ip_address: data.ip_address ?? null,
        user_agent: data.user_agent ?? null,
        expires_at: data.expires_at,
      })
      .returning('*');
    return session!;
  }

  async findSessionById(id: string): Promise<SessionRow | undefined> {
    return this.db<SessionRow>('sessions').where({ id }).first();
  }

  async listActiveSessions(userId: string): Promise<SessionRow[]> {
    return this.db<SessionRow>('sessions')
      .where({ user_id: userId, is_active: true })
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc');
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = new Date();
    await this.db('sessions')
      .where({ id: sessionId })
      .update({ is_active: false, revoked_at: now });
    await this.db('refresh_tokens')
      .where({ session_id: sessionId })
      .whereNull('revoked_at')
      .update({ revoked_at: now });
  }

  // ── Refresh Tokens ───────────────────────────────────────────────────────

  async createRefreshToken(data: {
    user_id: string;
    session_id: string;
    token_hash: string;
    family_id: string;
    generation: number;
    expires_at: Date;
  }): Promise<RefreshTokenRow> {
    const [token] = await this.db<RefreshTokenRow>('refresh_tokens')
      .insert({
        user_id: data.user_id,
        session_id: data.session_id,
        token_hash: data.token_hash,
        family_id: data.family_id,
        generation: data.generation,
        expires_at: data.expires_at,
      })
      .returning('*');
    return token!;
  }

  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | undefined> {
    return this.db<RefreshTokenRow>('refresh_tokens')
      .where({ token_hash: tokenHash })
      .first();
  }

  async markRefreshTokenUsed(id: string): Promise<void> {
    await this.db('refresh_tokens')
      .where({ id })
      .update({ is_used: true });
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.db('refresh_tokens')
      .where({ id })
      .update({ revoked_at: new Date() });
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await this.db('refresh_tokens')
      .where({ family_id: familyId })
      .whereNull('revoked_at')
      .update({ revoked_at: new Date() });
  }

  // ── MFA Challenges ──────────────────────────────────────────────────────

  async createMfaChallenge(data: {
    user_id: string;
    action: string;
    code_hash: string;
    expires_at: Date;
  }): Promise<MfaChallengeRow> {
    const [challenge] = await this.db<MfaChallengeRow>('mfa_challenges')
      .insert({
        user_id: data.user_id,
        action: data.action,
        code_hash: data.code_hash,
        expires_at: data.expires_at,
      })
      .returning('*');
    return challenge!;
  }

  async findMfaChallengeByIdForUpdate(id: string): Promise<MfaChallengeRow | undefined> {
    return this.db<MfaChallengeRow>('mfa_challenges').where({ id }).forUpdate().first();
  }

  async findMfaChallengeById(id: string): Promise<MfaChallengeRow | undefined> {
    return this.db<MfaChallengeRow>('mfa_challenges').where({ id }).first();
  }

  async incrementMfaAttempts(id: string): Promise<void> {
    await this.db('mfa_challenges')
      .where({ id })
      .increment('attempts', 1);
  }

  async markMfaChallengeVerified(id: string): Promise<void> {
    await this.db('mfa_challenges')
      .where({ id })
      .update({ verified: true, verified_at: new Date() });
  }

  // ── Audit Events ────────────────────────────────────────────────────────

  async createAuditEvent(data: {
    actor_id?: string | null;
    action: string;
    resource_type: string;
    resource_id?: string | null;
    details?: Record<string, unknown> | null;
    ip_address?: string | null;
    user_agent?: string | null;
    request_id?: string | null;
  }): Promise<void> {
    await this.db('audit_events').insert({
      actor_id: data.actor_id ?? null,
      action: data.action,
      resource_type: data.resource_type,
      resource_id: data.resource_id ?? null,
      details: data.details ? JSON.stringify(data.details) : null,
      ip_address: data.ip_address ?? null,
      user_agent: data.user_agent ?? null,
      request_id: data.request_id ?? null,
    });
  }
}

export const authRepository = new AuthRepository();
