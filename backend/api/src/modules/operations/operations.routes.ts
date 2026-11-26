import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../../infrastructure/database/connection.js';
import { ledgerService } from '../ledger/ledger.service.js';
import { parseCount } from '../../shared/utils/http.js';

const router = Router();

router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const [
      pendingRows,
      disputeRows,
      alertRows,
      exceptionRows,
      failedOutboxRows,
      recentAudit,
      ledgerInvariant,
    ] = await Promise.all([
      db('transfers').whereIn('status', ['PROCESSING', 'PENDING_CONFIRMATION']).count('id as count'),
      db('disputes').whereIn('status', ['OPEN', 'UNDER_REVIEW', 'INFORMATION_REQUESTED']).count('id as count'),
      db('risk_alerts').whereIn('status', ['OPEN', 'ESCALATED']).count('id as count'),
      db('reconciliation_exceptions').where({ status: 'OPEN' }).count('id as count'),
      db('outbox_events').where({ status: 'FAILED' }).count('id as count'),
      db('audit_events').orderBy('created_at', 'desc').limit(10),
      ledgerService.getGlobalLedgerInvariantCheck(),
    ]);

    res.json({
      data: {
        pendingTransfers: parseCount(pendingRows),
        openDisputes: parseCount(disputeRows),
        openRiskAlerts: parseCount(alertRows),
        openReconciliationExceptions: parseCount(exceptionRows),
        failedOutboxJobs: parseCount(failedOutboxRows),
        ledgerIntegrity: ledgerInvariant,
        recentAuditEvents: recentAudit,
      },
      meta: { requestId: req.requestId },
    });
  } catch (err) {
    next(err);
  }
});

export const operationsRoutes = router;
