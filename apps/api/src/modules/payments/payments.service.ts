import { getDb } from '../../infrastructure/database/connection.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { sandboxProvider } from '../../infrastructure/providers/sandbox-provider.js';
import { webhooksService } from '../webhooks/webhooks.service.js';
import { config } from '../../config/index.js';
import { parseCount } from '../../shared/utils/http.js';
import { computeRequestHash, checkIdempotency, lockIdempotencyScope, saveIdempotencyRecord } from '../../shared/security/idempotency.js';
import {
  IdempotencyConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';

export const paymentsService = {
  async createPaymentIntent(
    userId: string,
    data: { walletId: string; amountMinor: number; currency: string; description?: string },
    idempotencyKey?: string,
    requestId?: string,
  ) {
    const db = getDb();
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer not found');

    const wallet = await walletsRepository.getWalletWithOwnership(data.walletId, customerId);
    if (!wallet) throw new NotFoundError('Wallet not found');
    if (wallet.status !== 'ACTIVE') throw new ValidationError('Wallet is not active');
    if (wallet.currency !== data.currency) {
      throw new ValidationError(`Currency mismatch: wallet uses ${wallet.currency}`);
    }

    const requestHash = computeRequestHash({
      walletId: data.walletId,
      amountMinor: data.amountMinor,
      currency: data.currency,
      description: data.description ?? null,
    });

    // Reserve/check idempotency if provided
    if (idempotencyKey) {
      const existing = await db.transaction((trx) => checkIdempotency(trx, userId, idempotencyKey));
      if (existing) {
        if (existing.request_hash === requestHash) {
          return { intent: existing.response_body, cached: true };
        }
        throw new IdempotencyConflictError();
      }
    }

    // Create sandbox order outside DB transaction (per CODEBASE.md §8)
    const order = sandboxProvider.createOrder(data.amountMinor, data.currency);

    const intent = await db.transaction(async (trx) => {
      if (idempotencyKey) {
        await lockIdempotencyScope(trx, userId, idempotencyKey);
        const existing = await checkIdempotency(trx, userId, idempotencyKey);
        if (existing) {
          if (existing.request_hash === requestHash) {
            return existing.response_body;
          }
          throw new IdempotencyConflictError();
        }
      }

      const [created] = await trx('payment_intents')
        .insert({
          customer_id: customerId,
          wallet_id: data.walletId,
          amount_minor: data.amountMinor,
          currency: data.currency,
          status: 'PENDING',
          provider_name: 'sandbox',
          provider_reference: order.orderId,
          description: data.description || null,
          provider_metadata: JSON.stringify(order),
        })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'PAYMENT_INTENT_CREATED',
        resource_type: 'PAYMENT_INTENT',
        resource_id: created.id,
        details: JSON.stringify({ walletId: data.walletId, amountMinor: data.amountMinor, providerReference: order.orderId }),
        request_id: requestId ?? null,
      });

      const responseData = {
        ...created,
        amount_minor: Number(created.amount_minor),
        sessionUrl: order.sessionUrl,
        simulatedNote: 'SIMULATED SANDBOX — No real payment is processed',
      };

      if (idempotencyKey) {
        await saveIdempotencyRecord(trx, {
          userId,
          idempotencyKey,
          requestHash,
          operation: 'CREATE_PAYMENT_INTENT',
          resourceId: created.id,
          resourceType: 'PAYMENT_INTENT',
          statusCode: 201,
          responseBody: responseData,
        });
      }

      return responseData;
    });

    return { intent, cached: false };
  },

  async simulateSandboxWebhook(
    userId: string,
    intentId: string,
    opts: { eventType: 'payment.captured' | 'payment.failed'; overrideAmountMinor?: number },
  ) {
    const intent = await this.getPaymentIntent(userId, intentId);
    if (!intent.provider_reference) {
      throw new ValidationError('Payment intent has no sandbox provider reference');
    }

    const amountMinor = opts.overrideAmountMinor ?? Number(intent.amount_minor);
    const { body, signature, eventId } = sandboxProvider.generateWebhookPayload(
      intent.provider_reference,
      opts.eventType,
      amountMinor,
      intent.currency,
      config.SANDBOX_WEBHOOK_SECRET,
    );

    const webhookResult = await webhooksService.processWebhook(
      'sandbox',
      Buffer.from(body, 'utf-8'),
      signature,
    );

    return {
      simulated: true,
      note: 'SIMULATED SANDBOX WEBHOOK — Processed through real HMAC-SHA256 verification and deduplication',
      eventId,
      webhookResult,
    };
  },

  async getPaymentIntent(userId: string, intentId: string, roles: string[] = []) {
    const db = getDb();
    const isOps = roles.some((r) =>
      ['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'].includes(r),
    );
    const query = db('payment_intents').where({ id: intentId });
    if (!isOps) {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId);
      if (!customerId) throw new NotFoundError('Customer not found');
      query.andWhere({ customer_id: customerId });
    }
    const intent = await query.first();
    if (!intent) throw new NotFoundError('Payment intent not found');
    return intent;
  },

  async listPaymentIntents(userId: string, roles: string[] = [], page = 1, pageSize = 25) {
    const db = getDb();
    const isOps = roles.some((r) =>
      ['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'].includes(r),
    );
    const offset = (page - 1) * pageSize;

    let query = db('payment_intents');
    if (!isOps) {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId);
      if (!customerId) throw new NotFoundError('Customer not found');
      query = query.where({ customer_id: customerId });
    }

    const [intents, countRows] = await Promise.all([
      query.clone().orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      query.clone().count('id as count'),
    ]);
    return { intents, total: parseCount(countRows) };
  },
};
