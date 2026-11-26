import { type Knex } from 'knex';
import { getDb } from '../../infrastructure/database/connection.js';
import { parseCount } from '../../shared/utils/http.js';

export interface WalletRow {
  id: string;
  customer_id: string;
  wallet_name: string;
  currency: string;
  status: string;
  wallet_type: string;
  ledger_balance_minor: string;
  available_balance_minor: string;
  created_at: Date;
  updated_at: Date;
}

export const walletsRepository = {
  async createWallet(trx: Knex, data: { customerId: string; walletName: string; currency: string }): Promise<WalletRow> {
    const [row] = await trx('wallets').insert({
      customer_id: data.customerId,
      wallet_name: data.walletName,
      currency: data.currency,
      status: 'ACTIVE',
      wallet_type: 'CUSTOMER',
      ledger_balance_minor: 0,
      available_balance_minor: 0,
    }).returning('*');
    return row as WalletRow;
  },

  async getWalletById(id: string, conn: Knex = getDb()): Promise<WalletRow | undefined> {
    return conn('wallets').where({ id }).first() as Promise<WalletRow | undefined>;
  },

  async getWalletsByCustomerId(customerId: string, page: number, pageSize: number, status?: string) {
    const db = getDb();
    const offset = (page - 1) * pageSize;
    const whereClause: Record<string, unknown> = { customer_id: customerId, wallet_type: 'CUSTOMER' };
    if (status) whereClause['status'] = status;

    const [wallets, countRows] = await Promise.all([
      db('wallets').where(whereClause).orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      db('wallets').where(whereClause).count('id as count'),
    ]);
    return { wallets: wallets as WalletRow[], total: parseCount(countRows) };
  },

  async listCustomerWalletsForOps(page: number, pageSize: number, opts?: { status?: string; customerId?: string }) {
    const db = getDb();
    const offset = (page - 1) * pageSize;
    const whereClause: Record<string, unknown> = { wallet_type: 'CUSTOMER' };
    if (opts?.status) whereClause['status'] = opts.status;
    if (opts?.customerId) whereClause['customer_id'] = opts.customerId;

    const [wallets, countRows] = await Promise.all([
      db('wallets').where(whereClause).orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      db('wallets').where(whereClause).count('id as count'),
    ]);
    return { wallets: wallets as WalletRow[], total: parseCount(countRows) };
  },

  async lockWalletsForUpdate(trx: Knex, walletIds: string[]): Promise<WalletRow[]> {
    // CRITICAL: Lock in sorted order to prevent deadlocks
    const sorted = [...walletIds].sort();
    return trx('wallets').whereIn('id', sorted).orderBy('id').forUpdate() as Promise<WalletRow[]>;
  },

  async getWalletWithOwnership(walletId: string, customerId: string, conn: Knex = getDb()): Promise<WalletRow | undefined> {
    return conn('wallets').where({ id: walletId, customer_id: customerId }).first() as Promise<WalletRow | undefined>;
  },

  async getCustomerIdByUserId(userId: string, conn: Knex = getDb()): Promise<string | undefined> {
    const profile = await conn('customer_profiles').where({ user_id: userId }).select('id').first();
    return profile?.id;
  },
};
