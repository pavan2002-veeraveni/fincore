import { type Request, type Response, type NextFunction } from 'express';
import { walletsService } from './wallets.service.js';
import { CreateWalletSchema, WalletQuerySchema, UpdateWalletStatusSchema } from './wallets.schema.js';
import { getParam } from '../../shared/utils/http.js';

export const walletsController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = CreateWalletSchema.parse(req.body);
      const wallet = await walletsService.createWallet(req.userId!, data);
      res.status(201).json({ data: wallet, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, pageSize, status, customerId } = WalletQuerySchema.parse(req.query);
      const { wallets, total } = await walletsService.listWallets(
        req.userId!,
        req.userRoles ?? [],
        page,
        pageSize,
        status,
        customerId,
      );
      res.json({ data: wallets, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const { status, reason } = UpdateWalletStatusSchema.parse(req.body);
      const wallet = await walletsService.updateWalletStatus(
        req.userId!,
        id,
        status,
        reason,
        req.requestId,
      );
      res.json({ data: wallet, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const wallet = await walletsService.getWalletDetail(req.userId!, id, req.userRoles);
      res.json({ data: wallet, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const balance = await walletsService.getWalletBalance(req.userId!, id, req.userRoles);
      res.json({ data: balance, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  },

  async getTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const id = getParam(req, 'id');
      const { page, pageSize } = WalletQuerySchema.parse(req.query);
      const { entries, total } = await walletsService.getWalletTransactions(req.userId!, id, page, pageSize, req.userRoles);
      res.json({ data: entries, meta: { requestId: req.requestId, page, pageSize, total } });
    } catch (err) {
      next(err);
    }
  },
};
