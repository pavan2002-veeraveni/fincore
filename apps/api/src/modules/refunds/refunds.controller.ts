import { type Request, type Response, type NextFunction } from 'express';
import { PaginationQuery } from '@fincore/contracts';
import { refundsService } from './refunds.service.js';
import { CreateRefundSchema, CreateReversalSchema } from './refunds.schema.js';
import { getParam } from '../../shared/utils/http.js';
import { ValidationError } from '../../shared/errors/index.js';

export const refundsController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const keyHeader = req.headers['idempotency-key'];
      const idempotencyKey = (Array.isArray(keyHeader) ? keyHeader[0] : keyHeader)?.trim();
      if (!idempotencyKey) {
        throw new ValidationError('Idempotency-Key header is required for refunds');
      }
      const data = CreateRefundSchema.parse(req.body);

      const result = await refundsService.createRefund(
        req.userId!,
        req.userRoles ?? [],
        data,
        idempotencyKey,
        req.requestId,
      );

      if (result.cached) {
        return res.status(200).json({ data: result.refund, meta: { requestId: req.requestId, cached: true } });
      }
      res.status(201).json({ data: result.refund, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async reverse(req: Request, res: Response, next: NextFunction) {
    try {
      const keyHeader = req.headers['idempotency-key'];
      const idempotencyKey = (Array.isArray(keyHeader) ? keyHeader[0] : keyHeader)?.trim();
      if (!idempotencyKey) {
        throw new ValidationError('Idempotency-Key header is required for reversals');
      }
      const data = CreateReversalSchema.parse(req.body);

      const result = await refundsService.createReversal(
        req.userId!,
        data,
        idempotencyKey,
        req.requestId,
      );

      if (result.cached) {
        return res.status(200).json({ data: result.reversal, meta: { requestId: req.requestId, cached: true } });
      }
      res.status(201).json({ data: result.reversal, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const refund = await refundsService.getRefund(req.userId!, id, req.userRoles ?? []);
      res.json({ data: refund, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize } = PaginationQuery.parse(req.query);
      const { refunds, total } = await refundsService.listRefunds(
        req.userId!,
        req.userRoles ?? [],
        page,
        pageSize,
      );
      res.json({ data: refunds, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },
};
