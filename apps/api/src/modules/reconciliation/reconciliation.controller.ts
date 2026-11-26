import { type Request, type Response, type NextFunction } from 'express';
import { PaginationQuery } from '@fincore/contracts';
import { reconciliationService } from './reconciliation.service.js';
import {
  CreateReconciliationRunSchema,
  ReconciliationExceptionQuerySchema,
  ResolveExceptionSchema,
} from './reconciliation.schema.js';
import { getParam } from '../../shared/utils/http.js';

export const reconciliationController = {
  async createRun(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CreateReconciliationRunSchema.parse(req.body);
      const run = await reconciliationService.createRun(req.userId!, data, req.requestId);
      res.status(201).json({ data: run, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getRun(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const run = await reconciliationService.getRun(id);
      res.json({ data: run, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async listRuns(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize } = PaginationQuery.parse(req.query);
      const { runs, total } = await reconciliationService.listRuns(page, pageSize);
      res.json({ data: runs, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },

  async getExceptions(req: Request, res: Response, next: NextFunction) {
    try {
      const opts = ReconciliationExceptionQuerySchema.parse(req.query);
      const { exceptions, total } = await reconciliationService.getExceptions(opts);
      res.json({
        data: exceptions,
        meta: { requestId: req.requestId, page: opts.page, pageSize: opts.pageSize, total },
      });
    } catch (err) {
      next(err);
    }
  },

  async resolveException(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const { notes, status } = ResolveExceptionSchema.parse(req.body);
      const exception = await reconciliationService.resolveException(
        req.userId!,
        id,
        notes,
        status,
        req.requestId,
      );
      res.json({ data: exception, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
};
