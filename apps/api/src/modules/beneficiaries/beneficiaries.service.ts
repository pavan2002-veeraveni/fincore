import { getDb } from '../../infrastructure/database/connection.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { beneficiariesRepository } from './beneficiaries.repository.js';
import { NotFoundError, ConflictError, ValidationError } from '../../shared/errors/index.js';

export const beneficiariesService = {
  async create(userId: string, data: { destinationWalletId: string; nickname: string }) {
    const db = getDb();

    return db.transaction(async (trx) => {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
      if (!customerId) throw new NotFoundError('Customer profile not found');

      const destWallet = await walletsRepository.getWalletById(data.destinationWalletId, trx);
      if (!destWallet) throw new NotFoundError('Destination wallet not found');
      if (destWallet.wallet_type !== 'CUSTOMER') {
        throw new ValidationError('System control wallets cannot be added as beneficiaries');
      }
      if (destWallet.status !== 'ACTIVE') {
        throw new ValidationError('Destination wallet is not active');
      }

      if (destWallet.customer_id === customerId) {
        throw new ValidationError('Cannot add your own wallet as a beneficiary');
      }

      const existing = await trx('beneficiaries')
        .where({ owner_customer_id: customerId, destination_wallet_id: data.destinationWalletId })
        .first();
      if (existing && existing.status === 'ACTIVE') {
        throw new ConflictError('Beneficiary already exists for this destination');
      }

      const beneficiary = existing
        ? (
            await trx('beneficiaries')
              .where({ id: existing.id })
              .update({ status: 'ACTIVE', nickname: data.nickname })
              .returning('*')
          )[0]
        : (
            await trx('beneficiaries')
              .insert({
                owner_customer_id: customerId,
                destination_wallet_id: data.destinationWalletId,
                nickname: data.nickname,
                status: 'ACTIVE',
              })
              .returning('*')
          )[0];

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'BENEFICIARY_CREATED',
        resource_type: 'BENEFICIARY',
        resource_id: beneficiary.id,
        details: JSON.stringify({ destinationWalletId: data.destinationWalletId }),
      });

      return beneficiary;
    });
  },

  async list(userId: string, page = 1, pageSize = 25) {
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer profile not found');
    return beneficiariesRepository.getByOwner(customerId, page, pageSize);
  },

  async update(userId: string, beneficiaryId: string, data: { nickname?: string }) {
    const db = getDb();

    return db.transaction(async (trx) => {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
      if (!customerId) throw new NotFoundError('Customer profile not found');

      const benef = await trx('beneficiaries').where({ id: beneficiaryId }).first();
      if (!benef || benef.owner_customer_id !== customerId) {
        throw new NotFoundError('Beneficiary not found');
      }

      const [updated] = await trx('beneficiaries')
        .where({ id: beneficiaryId })
        .update({ nickname: data.nickname ?? null })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'BENEFICIARY_UPDATED',
        resource_type: 'BENEFICIARY',
        resource_id: beneficiaryId,
      });

      return updated;
    });
  },

  async deactivate(userId: string, beneficiaryId: string) {
    const db = getDb();

    return db.transaction(async (trx) => {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
      if (!customerId) throw new NotFoundError('Customer profile not found');

      const benef = await trx('beneficiaries').where({ id: beneficiaryId }).first();
      if (!benef || benef.owner_customer_id !== customerId) {
        throw new NotFoundError('Beneficiary not found');
      }

      const [deactivated] = await trx('beneficiaries')
        .where({ id: beneficiaryId })
        .update({ status: 'DEACTIVATED' })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'BENEFICIARY_DEACTIVATED',
        resource_type: 'BENEFICIARY',
        resource_id: beneficiaryId,
      });

      return deactivated;
    });
  },
};
