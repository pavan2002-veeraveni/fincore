import { Router } from 'express';
import { paymentsController } from './payments.controller.js';
import { sensitiveActionLimiter } from '../../middleware/rate-limit.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.post('/', sensitiveActionLimiter, paymentsController.create);
router.post('/:id/simulate-webhook', validateParams(UuidParamSchema), sensitiveActionLimiter, paymentsController.simulateWebhook);
router.get('/', paymentsController.list);
router.get('/:id', validateParams(UuidParamSchema), paymentsController.getById);

export const paymentsRoutes = router;
