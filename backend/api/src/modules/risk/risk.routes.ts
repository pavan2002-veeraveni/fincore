import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { PaginationQuery } from '@fincore/contracts';
import { getDb } from '../../infrastructure/database/connection.js';
import { getParam, parseCount } from '../../shared/utils/http.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { validateParams, UuidParamSchema } from '../../middleware/validate.middleware.js';
import {
  riskService,
  RiskServiceUnavailableError,
  RiskServiceUpstreamError,
} from './risk.service.js';

const router = Router();

const AssessRiskBodySchema = z.object({
  customerId: z.string().uuid().optional(),
  transactionAmountMinor: z.number().int().positive(),
  currency: z.enum(['INR']).default('INR'),
  transactionType: z.enum(['TRANSFER', 'PAYMENT', 'WITHDRAWAL']).default('TRANSFER'),
  beneficiaryIsNew: z.boolean().default(false),
  recentTransactionCount: z.number().int().min(0).default(0),
  recentTotalAmountMinor: z.number().int().min(0).default(0),
  recentFailureCount: z.number().int().min(0).default(0),
  customerAccountAgeDays: z.number().int().min(0).default(365),
  failMode: z.enum(['FAIL_OPEN', 'FAIL_CLOSED']).default('FAIL_OPEN'),
});

const AlertQuerySchema = PaginationQuery.extend({
  status: z.enum(['OPEN', 'REVIEWING', 'DISMISSED', 'ESCALATED', 'RESOLVED']).optional(),
});

const UpdateAlertSchema = z.object({
  status: z.enum(['REVIEWING', 'DISMISSED', 'ESCALATED', 'RESOLVED']),
  reviewNotes: z.string().min(2).max(1000).optional(),
});

interface RiskServiceResponse {
  assessment_id: string;
  score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  rule_hits: Array<{
    rule_id: string;
    rule_name: string;
    severity: string;
    explanation: string;
  }>;
  explanations: string[];
  ruleset_version: string;
  evaluated_at: string;
}

router.get('/alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { page, pageSize, status } = AlertQuerySchema.parse(req.query);
    const offset = (page - 1) * pageSize;

    let base = db('risk_alerts');
    if (status) base = base.where({ status });

    const [alerts, countRows] = await Promise.all([
      base.clone().orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      base.clone().count('id as count'),
    ]);

    res.json({
      data: alerts,
      meta: { requestId: req.requestId, page, pageSize, total: parseCount(countRows) },
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/alerts/:id', validateParams(UuidParamSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const id = getParam(req, 'id');
    const body = UpdateAlertSchema.parse(req.body);

    const updated = await db.transaction(async (trx) => {
      const [row] = await trx('risk_alerts')
        .where({ id })
        .update({
          status: body.status,
          reviewed_by: req.userId,
          review_notes: body.reviewNotes ?? null,
          reviewed_at: new Date(),
        })
        .returning('*');

      if (!row) throw new NotFoundError('Risk alert not found');

      await trx('audit_events').insert({
        actor_id: req.userId,
        action: 'ADMIN_ACTION',
        resource_type: 'RISK_ALERT',
        resource_id: id,
        details: JSON.stringify({ status: body.status, reviewNotes: body.reviewNotes }),
        request_id: req.requestId,
      });

      return row;
    });

    res.json({ data: updated, meta: { requestId: req.requestId } });
  } catch (err) {
    next(err);
  }
});

router.get('/assessments/:id', validateParams(UuidParamSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const id = getParam(req, 'id');
    const assessment = await db('risk_assessments').where({ id }).first();
    if (!assessment) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Assessment not found', requestId: req.requestId },
      });
    }
    res.json({ data: assessment, meta: { requestId: req.requestId } });
  } catch (err) {
    next(err);
  }
});

router.post('/assess', async (req: Request, res: Response, next: NextFunction) => {
  const input = AssessRiskBodySchema.safeParse(req.body);
  if (!input.success) {
    next(input.error);
    return;
  }

  try {
    const { result, warning } = await riskService.assessTransaction({
      ...input.data,
      actorUserId: req.userId,
      requestId: req.requestId,
    });
    res.json({
      data: result,
      meta: {
        requestId: req.requestId,
        ...(warning ? { warning } : {}),
      },
    });
  } catch (err: unknown) {
    if (err instanceof RiskServiceUpstreamError) {
      res.status(502).json({
        error: {
          code: 'RISK_SERVICE_ERROR',
          message: err.message,
          requestId: req.requestId,
        },
      });
      return;
    }
    if (err instanceof RiskServiceUnavailableError) {
      res.status(503).json({
        error: {
          code: 'RISK_SERVICE_UNAVAILABLE',
          message: err.message,
          requestId: req.requestId,
        },
      });
      return;
    }
    next(err);
  }
});

export const riskRoutes = router;
