import { type Request, type Response, type NextFunction } from 'express';
import { beneficiariesService } from './beneficiaries.service.js';
import { CreateBeneficiarySchema, UpdateBeneficiarySchema } from './beneficiaries.schema.js';
import { PaginationQuery } from '@fincore/contracts';
import { getParam } from '../../shared/utils/http.js';

export const beneficiariesController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CreateBeneficiarySchema.parse(req.body);
      const benef = await beneficiariesService.create(req.userId!, data);
      res.status(201).json({ data: benef, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize } = PaginationQuery.parse(req.query);
      const { beneficiaries, total } = await beneficiariesService.list(req.userId!, page, pageSize);
      res.json({ data: beneficiaries, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const data = UpdateBeneficiarySchema.parse(req.body);
      const benef = await beneficiariesService.update(req.userId!, id, data);
      res.json({ data: benef, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const benef = await beneficiariesService.deactivate(req.userId!, id);
      res.json({ data: benef, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },
};
