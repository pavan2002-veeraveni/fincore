import { Router } from 'express';
import { refundsController } from './refunds.controller.js';
import { requireStepUp } from '../../middleware/step-up.middleware.js';
import { sensitiveActionLimiter } from '../../middleware/rate-limit.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.post('/', sensitiveActionLimiter, requireStepUp('REFUND', 'ALL'), refundsController.create);
router.get('/:id', validateParams(UuidParamSchema), refundsController.getById);
router.get('/', refundsController.list);

export const refundsRoutes = router;

const reversalsRouter = Router();
reversalsRouter.post('/', sensitiveActionLimiter, requireStepUp('REVERSAL', 'ALL'), refundsController.reverse);

export const reversalsRoutes = reversalsRouter;
