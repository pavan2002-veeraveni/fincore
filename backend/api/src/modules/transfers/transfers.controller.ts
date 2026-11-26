import { type Request, type Response, type NextFunction } from 'express';
import { transfersService } from './transfers.service.js';
import { CreateTransferSchema, TransferQuerySchema } from './transfers.schema.js';
import { ValidationError } from '../../shared/errors/index.js';
import { getParam } from '../../shared/utils/http.js';

export const transfersController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const idempotencyHeader = req.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new ValidationError('Idempotency-Key header is required for transfer creation');
      }

      const data = CreateTransferSchema.parse(req.body);
      const result = await transfersService.createTransfer(
        req.userId!,
        data,
        idempotencyKey.trim(),
        req.requestId,
      );

      if (result.cached) {
        return res.status(200).json({ data: result.transfer, meta: { requestId: req.requestId, cached: true } });
      }

      res.status(201).json({ data: result.transfer, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const transfer = await transfersService.confirmTransfer(req.userId!, id, req.requestId);
      res.json({ data: transfer, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const transfer = await transfersService.cancelTransfer(req.userId!, id, req.requestId);
      res.json({ data: transfer, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const transfer = await transfersService.getTransfer(req.userId!, id, req.userRoles ?? []);
      res.json({ data: transfer, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize, status, sortBy, sortDir } = TransferQuerySchema.parse(req.query);
      const { transfers, total } = await transfersService.listTransfers(req.userId!, req.userRoles ?? [], {
        page,
        pageSize,
        status,
        sortBy,
        sortDir,
      });
      res.json({ data: transfers, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },
};
