import { type Request, type Response, type NextFunction } from 'express';
import { PaginationQuery } from '@fincore/contracts';
import { disputesService } from './disputes.service.js';
import { CreateDisputeSchema, AddDisputeEventSchema } from './disputes.schema.js';
import { getParam } from '../../shared/utils/http.js';

export const disputesController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CreateDisputeSchema.parse(req.body);
      const dispute = await disputesService.create(req.userId!, data, req.requestId);
      res.status(201).json({ data: dispute, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const dispute = await disputesService.getDispute(req.userId!, id, req.userRoles ?? []);
      res.json({ data: dispute, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize } = PaginationQuery.parse(req.query);
      const { disputes, total } = await disputesService.listDisputes(
        req.userId!,
        req.userRoles ?? [],
        page,
        pageSize,
      );
      res.json({ data: disputes, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },

  async addEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const data = AddDisputeEventSchema.parse(req.body);
      const event = await disputesService.addEvent(req.userId!, req.userRoles ?? [], id, data, req.requestId);
      res.status(201).json({ data: event, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
};
