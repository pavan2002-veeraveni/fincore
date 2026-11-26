import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { getDb } from '../infrastructure/database/connection.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/index.js';

interface AccessTokenPayload {
  sub: string;
  roles: string[];
  sessionId: string;
  purpose?: string;
  iat: number;
  exp: number;
}

/**
 * Verifies the Bearer access token from Authorization header (or access cookie),
 * and validates that the associated session is active and the user account is ACTIVE.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    const payload = jwt.verify(token, config.ACCESS_TOKEN_SECRET) as AccessTokenPayload;

    // Prevent step-up tokens from substituting for full access tokens
    if (payload.purpose === 'step_up') {
      throw new UnauthorizedError('Step-up tokens cannot be used as access tokens');
    }

    const db = getDb();
    const session = await db('sessions as s')
      .join('users as u', 's.user_id', 'u.id')
      .where({ 's.id': payload.sessionId, 's.user_id': payload.sub })
      .select('s.is_active', 's.expires_at', 'u.status as user_status')
      .first<{ is_active: boolean; expires_at: Date; user_status: string } | undefined>();

    if (!session || !session.is_active || new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedError('Session is inactive or has been revoked');
    }

    if (session.user_status !== 'ACTIVE') {
      throw new ForbiddenError(`Account is ${session.user_status.toLowerCase()}`);
    }

    // Fetch current roles from DB to ensure privilege revocations apply immediately
    const roles = await db('user_roles as ur')
      .join('roles as r', 'ur.role_id', 'r.id')
      .where('ur.user_id', payload.sub)
      .pluck<string[]>('r.name');

    req.userId = payload.sub;
    req.userRoles = roles.length > 0 ? roles : payload.roles;
    req.sessionId = payload.sessionId;

    next();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      next(err);
      return;
    }

    if (err instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Access token has expired'));
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid access token'));
      return;
    }
    if (err instanceof jwt.NotBeforeError) {
      next(new UnauthorizedError('Access token not yet active'));
      return;
    }

    next(new UnauthorizedError('Authentication failed'));
  }
}
