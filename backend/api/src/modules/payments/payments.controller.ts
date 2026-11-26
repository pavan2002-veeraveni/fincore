import { type Request, type Response, type NextFunction } from 'express';
import { PaginationQuery } from '@fincore/contracts';
import { paymentsService } from './payments.service.js';
import { CreatePaymentIntentSchema, SimulatePaymentWebhookSchema } from './payments.schema.js';
import { getParam } from '../../shared/utils/http.js';
import { ValidationError } from '../../shared/errors/index.js';

export const paymentsController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const keyHeader = req.headers['idempotency-key'];
      const idempotencyKey = (Array.isArray(keyHeader) ? keyHeader[0] : keyHeader)?.trim();
      if (!idempotencyKey) {
        throw new ValidationError('Idempotency-Key header is required for payment intent creation');
      }
      const data = CreatePaymentIntentSchema.parse(req.body);

      const result = await paymentsService.createPaymentIntent(
        req.userId!,
        data,
        idempotencyKey,
        req.requestId,
      );

      if (result.cached) {
        return res.status(200).json({ data: result.intent, meta: { requestId: req.requestId, cached: true } });
      }
      res.status(201).json({ data: result.intent, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async simulateWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const data = SimulatePaymentWebhookSchema.parse(req.body ?? {});
      const result = await paymentsService.simulateSandboxWebhook(req.userId!, id, data);
      res.status(200).json({ data: result, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const intent = await paymentsService.getPaymentIntent(req.userId!, id, req.userRoles ?? []);
      res.json({ data: intent, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize } = PaginationQuery.parse(req.query);
      const { intents, total } = await paymentsService.listPaymentIntents(
        req.userId!,
        req.userRoles ?? [],
        page,
        pageSize,
      );
      res.json({ data: intents, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },
};
