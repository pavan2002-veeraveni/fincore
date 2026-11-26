import { Router } from 'express';
import { disputesController } from './disputes.controller.js';
import { sensitiveActionLimiter } from '../../middleware/rate-limit.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.post('/', sensitiveActionLimiter, disputesController.create);
router.get('/', disputesController.list);
router.get('/:id', validateParams(UuidParamSchema), disputesController.getById);
router.post('/:id/events', validateParams(UuidParamSchema), disputesController.addEvent);
export const disputesRoutes = router;
