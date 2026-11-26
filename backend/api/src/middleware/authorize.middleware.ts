// ---------------------------------------------------------------------------
// FinCore API – Role-Based Authorization Middleware
// ---------------------------------------------------------------------------

import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../shared/errors/index.js';

/**
 * Factory that returns Express middleware enforcing role-based access control.
 *
 * Usage:
 * ```ts
 * router.get('/admin/users', authenticate, authorize('PLATFORM_ADMIN', 'FINANCE_ADMIN'), handler);
 * ```
 *
 * The middleware checks whether `req.userRoles` (set by `authenticate`)
 * includes **at least one** of the required roles.
 *
 * @param roles - One or more role names that grant access to the route.
 */
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Guard: authenticate must run before authorize
    if (!req.userId || !req.userRoles) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const hasRole = req.userRoles.some((r) => roles.includes(r));

    if (!hasRole) {
      next(
        new ForbiddenError(
          'You do not have permission to access this resource',
        ),
      );
      return;
    }

    next();
  };
}
