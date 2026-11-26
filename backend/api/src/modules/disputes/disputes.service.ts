import { getDb } from '../../infrastructure/database/connection.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { parseCount } from '../../shared/utils/http.js';
import { assertValidTransition, DISPUTE_TRANSITIONS } from '../../shared/state-machine.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../../shared/errors/index.js';

const OPS_ROLES = ['OPERATIONS_ANALYST', 'SUPPORT_AGENT', 'PLATFORM_ADMIN', 'FINANCE_ADMIN'];

export const disputesService = {
  async create(
    userId: string,
    data: { transferId?: string; paymentIntentId?: string; reason: string; description?: string },
    requestId?: string,
  ) {
    const db = getDb();
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer not found');

    if (!data.transferId && !data.paymentIntentId) {
      throw new ValidationError('Either transferId or paymentIntentId is required');
    }

    // Verify customer actually owns/participates in the referenced transaction (IDOR protection)
    if (data.transferId) {
      const transfer = await db('transfers').where({ id: data.transferId }).first();
      if (!transfer) throw new NotFoundError('Referenced transfer not found');
      const [src, dst] = await Promise.all([
        walletsRepository.getWalletById(transfer.source_wallet_id),
        walletsRepository.getWalletById(transfer.destination_wallet_id),
      ]);
      if (src?.customer_id !== customerId && dst?.customer_id !== customerId) {
        throw new ForbiddenError('You can only dispute transfers involving your wallets');
      }
    }

    if (data.paymentIntentId) {
      const intent = await db('payment_intents')
        .where({ id: data.paymentIntentId, customer_id: customerId })
        .first();
      if (!intent) throw new ForbiddenError('Referenced payment intent not found for this customer');
    }

    return db.transaction(async (trx) => {
      const [dispute] = await trx('disputes')
        .insert({
          customer_id: customerId,
          transfer_id: data.transferId || null,
          payment_intent_id: data.paymentIntentId || null,
          reason: data.reason,
          description: data.description || null,
          status: 'OPEN',
        })
        .returning('*');

      await trx('dispute_events').insert({
        dispute_id: dispute.id,
        actor_id: userId,
        event_type: 'STATUS_CHANGE',
        from_status: null,
        to_status: 'OPEN',
        comment: 'Dispute created',
      });

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'DISPUTE_CREATED',
        resource_type: 'DISPUTE',
        resource_id: dispute.id,
        details: JSON.stringify({ reason: data.reason }),
        request_id: requestId ?? null,
      });

      return dispute;
    });
  },

  async getDispute(userId: string, disputeId: string, roles: string[] = []) {
    const db = getDb();
    const dispute = await db('disputes').where({ id: disputeId }).first();
    if (!dispute) throw new NotFoundError('Dispute not found');

    const isOps = roles.some((r) => OPS_ROLES.includes(r));
    if (!isOps) {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId);
      if (dispute.customer_id !== customerId) throw new ForbiddenError('Not your dispute');
    }

    const events = await db('dispute_events').where({ dispute_id: disputeId }).orderBy('created_at', 'asc');
    return { ...dispute, events };
  },

  async listDisputes(userId: string, roles: string[], page = 1, pageSize = 25) {
    const db = getDb();
    const offset = (page - 1) * pageSize;
    const isOps = roles.some((r) => OPS_ROLES.includes(r));

    let query = db('disputes');
    if (!isOps) {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId);
      query = query.where({ customer_id: customerId ?? null });
    }

    const [disputes, countRows] = await Promise.all([
      query.clone().orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      query.clone().count('id as count'),
    ]);
    return { disputes, total: parseCount(countRows) };
  },

  async addEvent(
    userId: string,
    roles: string[],
    disputeId: string,
    data: { eventType: string; comment?: string; toStatus?: string; assignedTo?: string },
    requestId?: string,
  ) {
    const db = getDb();
    const isOps = roles.some((r) => OPS_ROLES.includes(r));

    return db.transaction(async (trx) => {
      const dispute = await trx('disputes').where({ id: disputeId }).forUpdate().first();
      if (!dispute) throw new NotFoundError('Dispute not found');

      if (!isOps) {
        const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
        if (dispute.customer_id !== customerId) {
          throw new ForbiddenError('You do not have access to this dispute');
        }
        if (data.toStatus || data.assignedTo) {
          throw new ForbiddenError('Only support or operations staff can transition dispute status or assign owners');
        }
      }

      const updates: Record<string, unknown> = {};
      if (data.toStatus) {
        assertValidTransition('Dispute', DISPUTE_TRANSITIONS, dispute.status, data.toStatus);
        updates['status'] = data.toStatus;
        if (data.toStatus.startsWith('RESOLVED')) {
          updates['resolved_at'] = new Date();
          updates['resolution_notes'] = data.comment ?? null;
        }
      }
      if (data.assignedTo && isOps) {
        updates['assigned_to'] = data.assignedTo;
      }

      if (Object.keys(updates).length > 0) {
        await trx('disputes').where({ id: disputeId }).update(updates);
      }

      const [event] = await trx('dispute_events')
        .insert({
          dispute_id: disputeId,
          actor_id: userId,
          event_type: data.eventType,
          from_status: data.toStatus ? dispute.status : null,
          to_status: data.toStatus || null,
          comment: data.comment || null,
          metadata: data.assignedTo ? JSON.stringify({ assignedTo: data.assignedTo }) : null,
        })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'DISPUTE_UPDATED',
        resource_type: 'DISPUTE',
        resource_id: disputeId,
        details: JSON.stringify(data),
        request_id: requestId ?? null,
      });

      return event;
    });
  },
};
