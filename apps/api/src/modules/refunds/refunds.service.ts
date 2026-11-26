import { getDb } from '../../infrastructure/database/connection.js';
import { transfersRepository } from '../transfers/transfers.repository.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { ledgerService } from '../ledger/ledger.service.js';
import { parseCount } from '../../shared/utils/http.js';
import { computeRequestHash, checkIdempotency, lockIdempotencyScope, saveIdempotencyRecord } from '../../shared/security/idempotency.js';
import { assertValidTransition, TRANSFER_TRANSITIONS, PAYMENT_INTENT_TRANSITIONS } from '../../shared/state-machine.js';
import {
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';

const OPS_ROLES = ['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_AGENT'];

/**
 * Refund & Reversal Service (Workflow C) — creates compensating journal entries.
 * NEVER deletes or mutates original ledger entries.
 */
export const refundsService = {
  async createRefund(
    userId: string,
    roles: string[],
    data: { transferId?: string; paymentIntentId?: string; amountMinor: number; reason?: string },
    idempotencyKey?: string,
    requestId?: string,
  ) {
    const db = getDb();
    const isOps = roles.some((r) => OPS_ROLES.includes(r));
    const requestHash = computeRequestHash({
      transferId: data.transferId ?? null,
      paymentIntentId: data.paymentIntentId ?? null,
      amountMinor: data.amountMinor,
      reason: data.reason ?? null,
    });

    return db.transaction(async (trx) => {
      if (idempotencyKey) {
        await lockIdempotencyScope(trx, userId, idempotencyKey);
        const existing = await checkIdempotency(trx, userId, idempotencyKey);
        if (existing) {
          if (existing.request_hash === requestHash) {
            return { refund: existing.response_body, cached: true };
          }
          throw new IdempotencyConflictError();
        }
      }

      if (data.paymentIntentId) {
        const intent = await trx('payment_intents')
          .where({ id: data.paymentIntentId })
          .forUpdate()
          .first();
        if (!intent) throw new NotFoundError('Payment intent not found');

        if (!isOps) {
          const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
          if (!customerId || intent.customer_id !== customerId) {
            throw new ForbiddenError('You do not have permission to refund this payment intent');
          }
        }

        if (intent.status !== 'SUCCEEDED') {
          throw new ValidationError(`Payment intent in status ${intent.status} is not eligible for refund`);
        }

        const alreadyRefundedRow = await trx('refunds')
          .where({ original_payment_intent_id: intent.id, status: 'COMPLETED' })
          .sum('amount_minor as sum')
          .first<Record<string, unknown> | undefined>();
        const alreadyRefunded = Number(alreadyRefundedRow?.['sum'] ?? 0);
        const remaining = Number(intent.amount_minor) - alreadyRefunded;

        if (data.amountMinor > remaining) {
          throw new ValidationError(
            `Refund amount ${data.amountMinor} exceeds remaining refundable amount ${remaining}`,
          );
        }

        const clearingWalletId = await ledgerService.getSystemWalletId(trx, 'SYSTEM_CLEARING', intent.currency);

        const { journal } = await ledgerService.postBalancedJournal(trx, {
          type: 'REFUND',
          currency: intent.currency,
          description: `Refund for payment intent ${intent.id}: ${data.reason || 'Customer refund'}`,
          referenceId: intent.id,
          referenceType: 'PAYMENT_INTENT',
          postedBy: userId,
          entries: [
            { walletId: intent.wallet_id, entryType: 'DEBIT', amountMinor: data.amountMinor },
            { walletId: clearingWalletId, entryType: 'CREDIT', amountMinor: data.amountMinor },
          ],
        });

        const [refund] = await trx('refunds')
          .insert({
            original_payment_intent_id: intent.id,
            amount_minor: data.amountMinor,
            currency: intent.currency,
            status: 'COMPLETED',
            reason: data.reason || null,
            journal_transaction_id: journal.id,
            initiated_by: userId,
            completed_at: new Date(),
          })
          .returning('*');

        if (alreadyRefunded + data.amountMinor >= Number(intent.amount_minor)) {
          assertValidTransition('PaymentIntent', PAYMENT_INTENT_TRANSITIONS, intent.status, 'REFUNDED');
          await trx('payment_intents').where({ id: intent.id }).update({ status: 'REFUNDED' });
        }

        await trx('audit_events').insert({
          actor_id: userId,
          action: 'REFUND_COMPLETED',
          resource_type: 'REFUND',
          resource_id: refund.id,
          details: JSON.stringify({ paymentIntentId: intent.id, amountMinor: data.amountMinor, journalId: journal.id }),
          request_id: requestId ?? null,
        });

        await trx('outbox_events').insert({
          event_type: 'REFUND_COMPLETED',
          aggregate_type: 'PAYMENT_INTENT',
          aggregate_id: intent.id,
          payload: JSON.stringify({ refundId: refund.id, paymentIntentId: intent.id, amountMinor: data.amountMinor }),
          status: 'PENDING',
        });

        if (idempotencyKey) {
          await saveIdempotencyRecord(trx, {
            userId,
            idempotencyKey,
            requestHash,
            operation: 'CREATE_REFUND',
            resourceId: refund.id,
            resourceType: 'REFUND',
            statusCode: 201,
            responseBody: refund,
          });
        }

        return { refund, cached: false };
      }

      // Transfer refund path — lock transfer row inside transaction!
      const transfer = await transfersRepository.getByIdForUpdate(trx, data.transferId!);
      if (!transfer) throw new NotFoundError('Transfer not found');

      if (!isOps) {
        // Customer transfer refund is strictly limited to recipient returning funds to sender (prevents sender debit-pull IDOR)
        const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
        const destWallet = await walletsRepository.getWalletById(transfer.destination_wallet_id, trx);
        if (!customerId || destWallet?.customer_id !== customerId) {
          throw new ForbiddenError('Only the transfer recipient or operations staff may initiate a transfer refund');
        }
      }

      if (!['COMPLETED', 'PARTIALLY_REFUNDED'].includes(transfer.status)) {
        throw new ValidationError(`Transfer in status ${transfer.status} is not eligible for refund`);
      }

      const alreadyRefunded = Number(transfer.refunded_amount_minor);
      const originalAmount = Number(transfer.amount_minor);
      const remainingRefundable = originalAmount - alreadyRefunded;

      if (data.amountMinor > remainingRefundable) {
        throw new ValidationError(
          `Refund amount ${data.amountMinor} exceeds remaining refundable amount ${remainingRefundable}`,
        );
      }

      const isFullRefund = alreadyRefunded + data.amountMinor >= originalAmount;
      const targetStatus = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      assertValidTransition('Transfer', TRANSFER_TRANSITIONS, transfer.status, targetStatus);

      // Post compensating journal (postBalancedJournal locks sorted wallets & checks destination funds)
      const { journal } = await ledgerService.postBalancedJournal(trx, {
        type: 'REFUND',
        currency: transfer.currency,
        description: `Refund for transfer ${transfer.id}: ${data.reason || 'No reason'}`,
        referenceId: transfer.id,
        referenceType: 'TRANSFER',
        postedBy: userId,
        entries: [
          { walletId: transfer.source_wallet_id, entryType: 'CREDIT', amountMinor: data.amountMinor },
          { walletId: transfer.destination_wallet_id, entryType: 'DEBIT', amountMinor: data.amountMinor },
        ],
      });

      const [refund] = await trx('refunds')
        .insert({
          original_transfer_id: transfer.id,
          amount_minor: data.amountMinor,
          currency: transfer.currency,
          status: 'COMPLETED',
          reason: data.reason || null,
          journal_transaction_id: journal.id,
          initiated_by: userId,
          completed_at: new Date(),
        })
        .returning('*');

      await transfersRepository.updateRefundedAmount(trx, transfer.id, data.amountMinor, targetStatus);

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'REFUND_COMPLETED',
        resource_type: 'REFUND',
        resource_id: refund.id,
        details: JSON.stringify({ transferId: transfer.id, amountMinor: data.amountMinor, journalId: journal.id }),
        request_id: requestId ?? null,
      });

      await trx('outbox_events').insert({
        event_type: 'REFUND_COMPLETED',
        aggregate_type: 'TRANSFER',
        aggregate_id: transfer.id,
        payload: JSON.stringify({ refundId: refund.id, transferId: transfer.id, amountMinor: data.amountMinor }),
        status: 'PENDING',
      });

      if (idempotencyKey) {
        await saveIdempotencyRecord(trx, {
          userId,
          idempotencyKey,
          requestHash,
          operation: 'CREATE_REFUND',
          resourceId: refund.id,
          resourceType: 'REFUND',
          statusCode: 201,
          responseBody: refund,
        });
      }

      return { refund, cached: false };
    });
  },

  async createReversal(
    userId: string,
    data: { transferId: string; reason: string },
    idempotencyKey?: string,
    requestId?: string,
  ) {
    const db = getDb();
    const requestHash = computeRequestHash({ transferId: data.transferId, reason: data.reason });

    return db.transaction(async (trx) => {
      if (idempotencyKey) {
        await lockIdempotencyScope(trx, userId, idempotencyKey);
        const existing = await checkIdempotency(trx, userId, idempotencyKey);
        if (existing) {
          if (existing.request_hash === requestHash) {
            return { reversal: existing.response_body, cached: true };
          }
          throw new IdempotencyConflictError();
        }
      }

      const transfer = await transfersRepository.getByIdForUpdate(trx, data.transferId);
      if (!transfer) throw new NotFoundError('Transfer not found');

      if (Number(transfer.refunded_amount_minor) > 0) {
        throw new ValidationError('Cannot reverse a transfer that already has partial refunds');
      }

      assertValidTransition('Transfer', TRANSFER_TRANSITIONS, transfer.status, 'REVERSED');
      const fullAmount = Number(transfer.amount_minor);

      const { journal } = await ledgerService.postBalancedJournal(trx, {
        type: 'REVERSAL',
        currency: transfer.currency,
        description: `Reversal of transfer ${transfer.id}: ${data.reason}`,
        referenceId: transfer.id,
        referenceType: 'TRANSFER',
        postedBy: userId,
        entries: [
          { walletId: transfer.source_wallet_id, entryType: 'CREDIT', amountMinor: fullAmount },
          { walletId: transfer.destination_wallet_id, entryType: 'DEBIT', amountMinor: fullAmount },
        ],
      });

      await transfersRepository.updateRefundedAmount(trx, transfer.id, fullAmount, 'REVERSED');

      const [refund] = await trx('refunds')
        .insert({
          original_transfer_id: transfer.id,
          amount_minor: fullAmount,
          currency: transfer.currency,
          status: 'COMPLETED',
          reason: `[REVERSAL] ${data.reason}`,
          journal_transaction_id: journal.id,
          initiated_by: userId,
          completed_at: new Date(),
        })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'REVERSAL_CREATED',
        resource_type: 'TRANSFER',
        resource_id: transfer.id,
        details: JSON.stringify({ refundId: refund.id, journalId: journal.id, reason: data.reason }),
        request_id: requestId ?? null,
      });

      await trx('outbox_events').insert({
        event_type: 'REVERSAL_COMPLETED',
        aggregate_type: 'TRANSFER',
        aggregate_id: transfer.id,
        payload: JSON.stringify({ reversalId: refund.id, transferId: transfer.id, amountMinor: fullAmount }),
        status: 'PENDING',
      });

      const responseData = {
        reversalId: refund.id,
        transferId: transfer.id,
        amountMinor: fullAmount,
        currency: transfer.currency,
        status: 'REVERSED',
        journalTransactionId: journal.id,
      };

      if (idempotencyKey) {
        await saveIdempotencyRecord(trx, {
          userId,
          idempotencyKey,
          requestHash,
          operation: 'CREATE_REVERSAL',
          resourceId: refund.id,
          resourceType: 'TRANSFER',
          statusCode: 201,
          responseBody: responseData,
        });
      }

      return { reversal: responseData, cached: false };
    });
  },

  async getRefund(userId: string, refundId: string, roles: string[] = []) {
    const db = getDb();
    const refund = await db('refunds').where({ id: refundId }).first();
    if (!refund) throw new NotFoundError('Refund not found');

    const isOps = roles.some((r) => OPS_ROLES.includes(r));
    if (!isOps && refund.initiated_by !== userId) {
      throw new ForbiddenError('You do not have access to this refund');
    }
    return refund;
  },

  async listRefunds(userId: string, roles: string[], page = 1, pageSize = 25) {
    const db = getDb();
    const offset = (page - 1) * pageSize;
    const isOps = roles.some((r) => OPS_ROLES.includes(r));

    let query = db('refunds');
    if (!isOps) {
      query = query.where({ initiated_by: userId });
    }

    const [refunds, countRows] = await Promise.all([
      query.clone().orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      query.clone().count('id as count'),
    ]);
    return { refunds, total: parseCount(countRows) };
  },
};
