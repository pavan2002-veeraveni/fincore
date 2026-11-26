import { Router } from 'express';
import { reconciliationController } from './reconciliation.controller.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.post('/runs', reconciliationController.createRun);
router.get('/runs', reconciliationController.listRuns);
router.get('/runs/:id', validateParams(UuidParamSchema), reconciliationController.getRun);
router.get('/exceptions', reconciliationController.getExceptions);
router.patch('/exceptions/:id/resolve', validateParams(UuidParamSchema), reconciliationController.resolveException);
export const reconciliationRoutes = router;
