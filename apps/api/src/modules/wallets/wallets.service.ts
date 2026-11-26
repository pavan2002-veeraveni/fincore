import { getDb } from '../../infrastructure/database/connection.js';
import { walletsRepository } from './wallets.repository.js';
import { ledgerService } from '../ledger/ledger.service.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../../shared/errors/index.js';

export const walletsService = {
  async createWallet(userId: string, data: { walletName: string; currency: string }) {
    const db = getDb();
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer profile not found');

    return db.transaction(async (trx) => {
      const wallet = await walletsRepository.createWallet(trx, {
        customerId,
        walletName: data.walletName,
        currency: data.currency,
      });

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'WALLET_CREATED',
        resource_type: 'WALLET',
        resource_id: wallet.id,
        details: JSON.stringify({ currency: data.currency }),
      });

      return wallet;
    });
  },

  async listWallets(
    userId: string,
    roles: string[],
    page = 1,
    pageSize = 25,
    status?: string,
    customerIdFilter?: string,
  ) {
    const isOps = roles.some((r) =>
      ['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'].includes(r),
    );
    if (isOps) {
      return walletsRepository.listCustomerWalletsForOps(page, pageSize, {
        status,
        customerId: customerIdFilter,
      });
    }
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer profile not found');
    return walletsRepository.getWalletsByCustomerId(customerId, page, pageSize, status);
  },

  async updateWalletStatus(
    actorUserId: string,
    walletId: string,
    newStatus: 'ACTIVE' | 'FROZEN' | 'CLOSED',
    reason?: string,
    requestId?: string,
  ) {
    const db = getDb();
    return db.transaction(async (trx) => {
      const wallet = await trx('wallets').where({ id: walletId }).forUpdate().first();
      if (!wallet) throw new NotFoundError('Wallet not found');
      if (wallet.wallet_type !== 'CUSTOMER') {
        throw new ValidationError('System control wallet status cannot be changed');
      }
      if (newStatus === 'CLOSED' && (Number(wallet.available_balance_minor) !== 0 || Number(wallet.ledger_balance_minor) !== 0)) {
        throw new ValidationError('Cannot close a wallet with non-zero available or ledger balance');
      }

      const [updated] = await trx('wallets')
        .where({ id: walletId })
        .update({ status: newStatus, updated_at: new Date() })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: actorUserId,
        action: 'WALLET_STATUS_CHANGED',
        resource_type: 'WALLET',
        resource_id: walletId,
        details: JSON.stringify({ fromStatus: wallet.status, toStatus: newStatus, reason: reason ?? null }),
        request_id: requestId ?? null,
      });

      return updated;
    });
  },

  async getWalletDetail(userId: string, walletId: string, roles: string[] = []) {
    const wallet = await walletsRepository.getWalletById(walletId);
    if (!wallet) throw new NotFoundError('Wallet not found');

    const isPrivileged = roles.some((r) =>
      ['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'].includes(r),
    );
    if (!isPrivileged) {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId);
      if (!customerId || wallet.customer_id !== customerId) {
        throw new ForbiddenError('You do not have access to this wallet');
      }
    }
    return wallet;
  },

  async getWalletBalance(userId: string, walletId: string, roles: string[] = []) {
    const wallet = await this.getWalletDetail(userId, walletId, roles);
    return {
      walletId: wallet.id,
      currency: wallet.currency,
      ledgerBalanceMinor: Number(wallet.ledger_balance_minor),
      availableBalanceMinor: Number(wallet.available_balance_minor),
      simulatedLabel: 'SIMULATED BALANCE — Educational Platform Only',
    };
  },

  async getWalletTransactions(
    userId: string,
    walletId: string,
    page = 1,
    pageSize = 25,
    roles: string[] = [],
  ) {
    await this.getWalletDetail(userId, walletId, roles);
    return ledgerService.getWalletTransactions(walletId, page, pageSize);
  },
};
