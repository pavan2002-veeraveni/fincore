import { getDb } from '../../infrastructure/database/connection.js';
import { parseCount } from '../../shared/utils/http.js';

export interface BeneficiaryRow {
  id: string;
  owner_customer_id: string;
  destination_wallet_id: string;
  nickname: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  deactivated_at: Date | null;
}

export const beneficiariesRepository = {
  async create(data: { ownerCustomerId: string; destinationWalletId: string; nickname: string }): Promise<BeneficiaryRow> {
    const [row] = await getDb()('beneficiaries').insert({
      owner_customer_id: data.ownerCustomerId,
      destination_wallet_id: data.destinationWalletId,
      nickname: data.nickname,
      status: 'ACTIVE',
    }).returning('*');
    return row as BeneficiaryRow;
  },

  async reactivate(id: string, nickname: string): Promise<BeneficiaryRow> {
    const [row] = await getDb()('beneficiaries')
      .where({ id })
      .update({ status: 'ACTIVE', nickname, deactivated_at: null })
      .returning('*');
    return row as BeneficiaryRow;
  },

  async getByOwner(customerId: string, page: number, pageSize: number) {
    const db = getDb();
    const offset = (page - 1) * pageSize;
    const [rows, countRows] = await Promise.all([
      db('beneficiaries as b')
        .leftJoin('wallets as w', 'b.destination_wallet_id', 'w.id')
        .where({ 'b.owner_customer_id': customerId, 'b.status': 'ACTIVE' })
        .select('b.*', 'w.wallet_name as destination_wallet_name', 'w.currency as destination_currency')
        .orderBy('b.created_at', 'desc')
        .offset(offset)
        .limit(pageSize),
      db('beneficiaries').where({ owner_customer_id: customerId, status: 'ACTIVE' }).count('id as count'),
    ]);
    return { beneficiaries: rows as BeneficiaryRow[], total: parseCount(countRows) };
  },

  async getById(id: string): Promise<BeneficiaryRow | undefined> {
    return getDb()('beneficiaries').where({ id }).first() as Promise<BeneficiaryRow | undefined>;
  },

  async getByOwnerAndDestination(customerId: string, walletId: string): Promise<BeneficiaryRow | undefined> {
    return getDb()('beneficiaries').where({
      owner_customer_id: customerId,
      destination_wallet_id: walletId,
    }).first() as Promise<BeneficiaryRow | undefined>;
  },

  async update(id: string, data: Partial<{ nickname: string }>): Promise<BeneficiaryRow> {
    const [row] = await getDb()('beneficiaries').where({ id }).update(data).returning('*');
    return row as BeneficiaryRow;
  },

  async deactivate(id: string): Promise<BeneficiaryRow> {
    const [row] = await getDb()('beneficiaries')
      .where({ id })
      .update({ status: 'INACTIVE', deactivated_at: new Date() })
      .returning('*');
    return row as BeneficiaryRow;
  },
};
