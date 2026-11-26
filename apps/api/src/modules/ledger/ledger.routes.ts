import { Router } from 'express';
import { ledgerController } from './ledger.controller.js';
import { validateParams, UuidParamSchema, WalletIdParamSchema } from '../../middleware/validate.middleware.js';

const router = Router();
router.get('/invariant-check', ledgerController.verifyGlobalBalance);
router.get('/journals/:id', validateParams(UuidParamSchema), ledgerController.getJournal);
router.get('/reconcile/:walletId', validateParams(WalletIdParamSchema), ledgerController.reconcileWallet);

export const ledgerRoutes = router;
