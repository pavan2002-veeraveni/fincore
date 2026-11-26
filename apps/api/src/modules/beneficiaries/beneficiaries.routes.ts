import { Router } from 'express';
import { beneficiariesController } from './beneficiaries.controller.js';
import { requireStepUp } from '../../middleware/step-up.middleware.js';
import { sensitiveActionLimiter } from '../../middleware/rate-limit.middleware.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.post('/', sensitiveActionLimiter, requireStepUp('BENEFICIARY_CHANGE', 'ALL'), beneficiariesController.create);
router.get('/', beneficiariesController.list);
router.patch('/:id', validateParams(UuidParamSchema), sensitiveActionLimiter, requireStepUp('BENEFICIARY_CHANGE', 'ALL'), beneficiariesController.update);
router.delete('/:id', validateParams(UuidParamSchema), sensitiveActionLimiter, requireStepUp('BENEFICIARY_CHANGE', 'ALL'), beneficiariesController.deactivate);

export const beneficiariesRoutes = router;
