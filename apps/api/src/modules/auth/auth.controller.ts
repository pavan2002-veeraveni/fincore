import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { authService } from './auth.service.js';
import { config } from '../../config/index.js';
import { getParam } from '../../shared/utils/http.js';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/index.js';
import type {
  RegisterInput,
  LoginInput,
  RefreshInput,
  LogoutInput,
  MfaChallengeInput,
  MfaVerifyInput,
  StepUpInput,
} from './auth.schema.js';

const REFRESH_COOKIE_NAME = 'fincore_refresh';
const CSRF_COOKIE_NAME = 'fincore_csrf';

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim();
  }
  return req.socket.remoteAddress;
}

function envelope(data: unknown, requestId: string) {
  return { data, meta: { requestId } };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) out[key] = val;
  }
  return out;
}

function setAuthCookies(res: Response, refreshToken: string): void {
  const isSecure = config.COOKIE_SECURE !== undefined
    ? config.COOKIE_SECURE === 'true'
    : config.NODE_ENV === 'production';
  const csrfToken = randomBytes(24).toString('hex');

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // Readable double-submit CSRF token cookie for browser cookie-based refresh/logout
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as RegisterInput;
    const result = await authService.register(input, {
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });

    setAuthCookies(res, result.tokens.refreshToken);
    res.status(201).json(envelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as LoginInput;
    const result = await authService.login(input, {
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });

    setAuthCookies(res, result.tokens.refreshToken);
    res.status(200).json(envelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as RefreshInput;
    let refreshToken = body.refreshToken;

    if (!refreshToken) {
      const cookies = parseCookies(req.headers.cookie);
      refreshToken = cookies[REFRESH_COOKIE_NAME];
      // Enforce double-submit CSRF header when authenticating via HttpOnly cookie
      const csrfCookie = cookies[CSRF_COOKIE_NAME];
      const csrfHeader = req.headers['x-csrf-token'];
      if (refreshToken && (!csrfCookie || csrfHeader !== csrfCookie)) {
        throw new ForbiddenError('Invalid or missing CSRF token for cookie refresh');
      }
    }

    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required');
    }

    const tokens = await authService.refresh(refreshToken, {
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });

    setAuthCookies(res, tokens.refreshToken);
    res.status(200).json(envelope(tokens, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as LogoutInput;
    let refreshToken = body.refreshToken;

    if (!refreshToken) {
      const cookies = parseCookies(req.headers.cookie);
      refreshToken = cookies[REFRESH_COOKIE_NAME];
    }

    if (refreshToken) {
      await authService.logout(refreshToken, {
        userId: req.userId!,
        requestId: req.requestId,
      });
    } else if (req.sessionId) {
      await authService.revokeSession(req.userId!, req.sessionId, {
        requestId: req.requestId,
      });
    }

    clearAuthCookies(res);
    res.status(200).json(envelope({ message: 'Logged out successfully' }, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function createMfaChallengeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { action } = req.body as MfaChallengeInput;
    const result = await authService.createMfaChallenge(
      req.userId!,
      action,
      { requestId: req.requestId },
    );

    res.status(201).json(envelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function verifyMfaChallengeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { challengeId, code } = req.body as MfaVerifyInput;
    const result = await authService.verifyMfaChallenge(
      req.userId!,
      req.sessionId!,
      challengeId,
      code,
      { requestId: req.requestId },
    );

    res.status(200).json(envelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function stepUpHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { password, action } = req.body as StepUpInput;
    const result = await authService.verifyStepUpPassword(
      req.userId!,
      req.sessionId!,
      password,
      action,
      { requestId: req.requestId },
    );

    res.status(200).json(envelope(result, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function getMeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await authService.getUserById(req.userId!);
    res.status(200).json(envelope(user, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function listSessionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sessions = await authService.listSessions(req.userId!);
    res.status(200).json(envelope(sessions, req.requestId));
  } catch (err) {
    next(err);
  }
}

export async function revokeSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = getParam(req, 'id');
    await authService.revokeSession(req.userId!, id, {
      requestId: req.requestId,
    });

    res.status(200).json(
      envelope({ message: 'Session revoked successfully' }, req.requestId),
    );
  } catch (err) {
    next(err);
  }
}
