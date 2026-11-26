import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authLimiter } from '../../middleware/rate-limit.middleware.js';
import { validate, validateParams } from '../../middleware/validate.middleware.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  mfaChallengeSchema,
  mfaVerifySchema,
  stepUpSchema,
  sessionIdParamSchema,
} from './auth.schema.js';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  createMfaChallengeHandler,
  verifyMfaChallengeHandler,
  stepUpHandler,
  getMeHandler,
  listSessionsHandler,
  revokeSessionHandler,
} from './auth.controller.js';

const router = Router();

// ── Public routes (rate-limited) ───────────────────────────────────────────

router.post('/register', authLimiter, validate(registerSchema), registerHandler);
router.post('/login', authLimiter, validate(loginSchema), loginHandler);
router.post('/refresh', authLimiter, validate(refreshSchema), refreshHandler);

// ── Authenticated routes ───────────────────────────────────────────────────

router.post('/logout', authenticate, validate(logoutSchema), logoutHandler);

router.post(
  '/step-up',
  authenticate,
  authLimiter,
  validate(stepUpSchema),
  stepUpHandler,
);

router.post(
  '/mfa/challenge',
  authenticate,
  authLimiter,
  validate(mfaChallengeSchema),
  createMfaChallengeHandler,
);

router.post(
  '/mfa/verify',
  authenticate,
  authLimiter,
  validate(mfaVerifySchema),
  verifyMfaChallengeHandler,
);

router.get('/me', authenticate, getMeHandler);

router.get('/sessions', authenticate, listSessionsHandler);

router.delete(
  '/sessions/:id',
  authenticate,
  validateParams(sessionIdParamSchema),
  revokeSessionHandler,
);

export { router as authRoutes };
