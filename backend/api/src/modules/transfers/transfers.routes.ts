import { Router } from 'express';
import { transfersController } from './transfers.controller.js';
import { requireStepUp } from '../../middleware/step-up.middleware.js';
import { sensitiveActionLimiter } from '../../middleware/rate-limit.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.post('/', sensitiveActionLimiter, requireStepUp('TRANSFER', 'ALL'), transfersController.create);
router.post('/:id/confirm', validateParams(UuidParamSchema), sensitiveActionLimiter, requireStepUp('TRANSFER', 'ALL'), transfersController.confirm);
router.post('/:id/cancel', validateParams(UuidParamSchema), transfersController.cancel);
router.get('/', transfersController.list);
router.get('/:id', validateParams(UuidParamSchema), transfersController.getById);

export const transfersRoutes = router;
