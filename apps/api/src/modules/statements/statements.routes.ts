import { Router } from 'express';
import { statementsController } from './statements.controller.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.post('/', statementsController.generate);
router.get('/', statementsController.list);
router.get('/:id/export', validateParams(UuidParamSchema), statementsController.exportCsv);
export const statementsRoutes = router;
