import { type Knex } from 'knex';
import { getDb } from '../../infrastructure/database/connection.js';
import { parseCount } from '../../shared/utils/http.js';

export interface TransferRow {
  id: string;
  source_wallet_id: string;
  destination_wallet_id: string;
  amount_minor: string;
  currency: string;
  status: string;
  description: string | null;
  journal_transaction_id: string | null;
  initiated_by: string;
  refunded_amount_minor: string;
  confirmed_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  amount_minor: 'amount_minor',
  status: 'status',
};

export const transfersRepository = {
  async create(
    trx: Knex,
    data: {
      sourceWalletId: string;
      destinationWalletId: string;
      amountMinor: number;
      currency: string;
      description?: string;
      initiatedBy: string;
      status?: string;
    },
  ): Promise<TransferRow> {
    const [row] = await trx('transfers')
      .insert({
        source_wallet_id: data.sourceWalletId,
        destination_wallet_id: data.destinationWalletId,
        amount_minor: data.amountMinor,
        currency: data.currency,
        description: data.description || null,
        initiated_by: data.initiatedBy,
        status: data.status || 'PROCESSING',
      })
      .returning('*');
    return row as TransferRow;
  },

  async getById(id: string): Promise<TransferRow | undefined> {
    return getDb()('transfers').where({ id }).first() as Promise<TransferRow | undefined>;
  },

  async getByIdForUpdate(trx: Knex, id: string): Promise<TransferRow | undefined> {
    return trx('transfers').where({ id }).forUpdate().first() as Promise<TransferRow | undefined>;
  },

  async updateStatus(
    trx: Knex,
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<TransferRow> {
    const update: Record<string, unknown> = { status, ...extra };
    if (status === 'COMPLETED') update['completed_at'] = new Date();
    if (status === 'FAILED') update['failed_at'] = new Date();
    const [row] = await trx('transfers').where({ id }).update(update).returning('*');
    return row as TransferRow;
  },

  async getByUser(
    userId: string,
    roles: string[],
    opts: { page: number; pageSize: number; status?: string; sortBy?: string; sortDir?: 'asc' | 'desc' },
  ) {
    const db = getDb();
    const offset = (opts.page - 1) * opts.pageSize;
    const isOps = roles.some((r) =>
      ['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'].includes(r),
    );

    const sortCol = SORT_COLUMNS[opts.sortBy ?? 'created_at'] ?? 'created_at';
    const sortDir = opts.sortDir === 'asc' ? 'asc' : 'desc';

    let baseQuery = db('transfers');

    if (!isOps) {
      const profile = await db('customer_profiles').where({ user_id: userId }).first();
      if (!profile) return { transfers: [] as TransferRow[], total: 0 };

      const walletIds = await db('wallets').where({ customer_id: profile.id }).pluck<string[]>('id');
      if (walletIds.length === 0) return { transfers: [] as TransferRow[], total: 0 };

      baseQuery = baseQuery.where(function () {
        this.whereIn('source_wallet_id', walletIds).orWhereIn('destination_wallet_id', walletIds);
      });
    }

    if (opts.status) {
      baseQuery = baseQuery.where({ status: opts.status });
    }

    const [transfers, countRows] = await Promise.all([
      baseQuery.clone().orderBy(sortCol, sortDir).offset(offset).limit(opts.pageSize),
      baseQuery.clone().count('id as count'),
    ]);
    return { transfers: transfers as TransferRow[], total: parseCount(countRows) };
  },

  async updateRefundedAmount(
    trx: Knex,
    id: string,
    additionalRefund: number,
    newStatus: string,
  ): Promise<TransferRow> {
    const [row] = await trx('transfers')
      .where({ id })
      .update({
        refunded_amount_minor: trx.raw('refunded_amount_minor + ?', [additionalRefund]),
        status: newStatus,
      })
      .returning('*');
    return row as TransferRow;
  },
};
