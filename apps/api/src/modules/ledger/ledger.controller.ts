import { type Request, type Response, type NextFunction } from 'express';
import { ledgerService } from './ledger.service.js';
import { getParam } from '../../shared/utils/http.js';

export const ledgerController = {
  async getJournal(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const result = await ledgerService.getJournalWithEntries(id);
      if (!result) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Journal not found', requestId: req.requestId },
        });
      }
      res.json({ data: result, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async reconcileWallet(req: Request, res: Response, next: NextFunction) {
    try {
      const walletId = getParam(req, 'walletId');
      const result = await ledgerService.reconcileWalletBalance(walletId);
      if (!result) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Wallet not found', requestId: req.requestId },
        });
      }
      res.json({ data: result, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async verifyGlobalBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await ledgerService.getGlobalLedgerInvariantCheck();
      res.json({ data: result, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
};
