import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError, UnauthorizedError } from '../shared/errors/index.js';

export class StepUpRequiredError extends AppError {
  constructor(message = 'Recent reauthentication or simulated MFA step-up verification is required', details?: unknown) {
    super('STEP_UP_REQUIRED', message, 403, details);
  }
}

interface StepUpPayload {
  sub: string;
  sessionId: string;
  purpose: 'step_up';
  action: string;
  iat: number;
  exp: number;
}

/**
 * Middleware requiring a short-lived X-Step-Up-Token issued after password
 * reauthentication (POST /auth/step-up) or simulated MFA verification
 * (POST /auth/mfa/verify).
 */
export function requireStepUp(...allowedActions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.userId || !req.sessionId) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const tokenHeader = req.headers['x-step-up-token'];
    const rawToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;

    if (!rawToken) {
      next(
        new StepUpRequiredError(
          'Missing X-Step-Up-Token header. Complete POST /api/v1/auth/step-up or POST /api/v1/auth/mfa/verify first.',
          { requiredActions: allowedActions },
        ),
      );
      return;
    }

    try {
      const payload = jwt.verify(rawToken, config.ACCESS_TOKEN_SECRET) as StepUpPayload;

      if (payload.purpose !== 'step_up') {
        next(new StepUpRequiredError('Invalid step-up token purpose'));
        return;
      }

      if (payload.sub !== req.userId || payload.sessionId !== req.sessionId) {
        next(new StepUpRequiredError('Step-up token does not match current user session'));
        return;
      }

      if (
        allowedActions.length > 0 &&
        payload.action !== 'ALL' &&
        !allowedActions.includes(payload.action)
      ) {
        next(
          new StepUpRequiredError(`Step-up token scope "${payload.action}" does not cover this operation`, {
            requiredActions: allowedActions,
            tokenAction: payload.action,
          }),
        );
        return;
      }

      next();
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        next(new StepUpRequiredError('Step-up verification has expired; please reauthenticate'));
        return;
      }
      next(new StepUpRequiredError('Invalid step-up verification token'));
    }
  };
}
