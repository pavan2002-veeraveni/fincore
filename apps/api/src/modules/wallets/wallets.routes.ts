import { Router } from 'express';
import { walletsController } from './wallets.controller.js';
import { authorize } from '../../middleware/authorize.middleware.js';
import { requireStepUp } from '../../middleware/step-up.middleware.js';
import { sensitiveActionLimiter } from '../../middleware/rate-limit.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();

router.post('/', sensitiveActionLimiter, walletsController.create);
router.get('/', walletsController.list);
router.get('/:id', validateParams(UuidParamSchema), walletsController.getById);
router.get('/:id/balance', validateParams(UuidParamSchema), walletsController.getBalance);
router.get('/:id/transactions', validateParams(UuidParamSchema), walletsController.getTransactions);
router.patch(
  '/:id/status',
  authorize('FINANCE_ADMIN', 'PLATFORM_ADMIN'),
  validateParams(UuidParamSchema),
  sensitiveActionLimiter,
  requireStepUp('ROLE_CHANGE', 'ALL'),
  walletsController.updateStatus,
);

export const walletsRoutes = router;
