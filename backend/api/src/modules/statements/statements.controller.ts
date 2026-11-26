import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { PaginationQuery } from '@fincore/contracts';
import { statementsService } from './statements.service.js';
import { getParam } from '../../shared/utils/http.js';

const GenerateStatementSchema = z.object({
  walletId: z.string().uuid(),
  periodStart: z.string().min(10),
  periodEnd: z.string().min(10),
});

export const statementsController = {
  async generate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = GenerateStatementSchema.parse(req.body);
      const statement = await statementsService.generate(req.userId!, data, req.requestId);
      res.status(201).json({ data: statement, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize } = PaginationQuery.parse(req.query);
      const { statements, total } = await statementsService.list(req.userId!, page, pageSize);
      res.json({ data: statements, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },

  async exportCsv(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const { csv, statement } = await statementsService.exportCsv(req.userId!, id);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="statement-${statement.id}.csv"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
};
