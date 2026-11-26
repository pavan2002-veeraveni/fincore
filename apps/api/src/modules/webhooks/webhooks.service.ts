import { getDb } from '../../infrastructure/database/connection.js';
import { SYSTEM_USER_ID } from '../../infrastructure/database/migrations/004_system_accounts_and_hardening.js';
import { sandboxProvider } from '../../infrastructure/providers/sandbox-provider.js';
import { ledgerService } from '../ledger/ledger.service.js';
import { WebhookPayloadSchema } from '../payments/payments.schema.js';
import { ValidationError } from '../../shared/errors/index.js';
import { config } from '../../config/index.js';
import { metrics } from '../../infrastructure/metrics/index.js';
import { assertValidTransition, PAYMENT_INTENT_TRANSITIONS } from '../../shared/state-machine.js';

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Webhook processing (Assessment 08):
 * 1. Signature verification over raw bytes (constant-time HMAC-SHA256)
 * 2. Timestamp tolerance check (5 minutes)
 * 3. Deduplication via unique(provider_name, provider_event_id) + Postgres 23505 handling
 * 4. Amount/currency validation against locked payment intent (persisting mismatch exception)
 * 5. Atomic state transition + balanced double-entry ledger posting (SYSTEM_CLEARING -> customer wallet)
 */
export const webhooksService = {
  async processWebhook(providerName: string, rawBody: Buffer, signature: string) {
    if (providerName !== 'sandbox') {
      throw new ValidationError(`Unsupported webhook provider: ${providerName}`);
    }

    const db = getDb();

    // 1. Verify signature before parsing body
    const isValid = sandboxProvider.verifySignature(rawBody, signature, config.SANDBOX_WEBHOOK_SECRET);
    if (!isValid) {
      metrics.counters.webhooksRejected += 1;
      throw new ValidationError('Invalid webhook signature');
    }

    // 2. Parse & schema-validate payload
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      metrics.counters.webhooksRejected += 1;
      throw new ValidationError('Invalid JSON in webhook payload');
    }

    const parsed = WebhookPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) {
      metrics.counters.webhooksRejected += 1;
      throw new ValidationError('Malformed webhook payload', parsed.error.issues);
    }

    const { event_id, event_type, created_at, data } = parsed.data;

    // 3. Enforce timestamp tolerance window
    const eventTime = new Date(created_at).getTime();
    if (Number.isNaN(eventTime) || Math.abs(Date.now() - eventTime) > TIMESTAMP_TOLERANCE_MS) {
      metrics.counters.webhooksRejected += 1;
      throw new ValidationError('Webhook timestamp outside tolerance window');
    }

    // 4. Transactional deduplication + atomic processing
    const outcome = await db.transaction(async (trx) => {
      const existing = await trx('provider_events')
        .where({ provider_name: providerName, provider_event_id: event_id })
        .first();

      if (existing) {
        metrics.counters.webhooksDeduplicated += 1;
        return { status: 'duplicate' as const, eventId: event_id, message: 'Event already processed' };
      }

      let providerEvent: { id: string } | undefined;
      try {
        // Use SAVEPOINT / catch 23505 under concurrent webhook bursts
        const [inserted] = await trx.raw(
          `INSERT INTO provider_events
            (provider_name, provider_event_id, event_type, status, payload, signature_valid)
           VALUES (?, ?, ?, 'PROCESSING', ?::jsonb, 'true')
           ON CONFLICT (provider_name, provider_event_id) DO NOTHING
           RETURNING id`,
          [providerName, event_id, event_type, JSON.stringify({ order_id: data.order_id, amount_minor: data.amount_minor, currency: data.currency, status: data.status })],
        ).then((r) => r.rows as Array<{ id: string }>);
        providerEvent = inserted;
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === '23505') {
          metrics.counters.webhooksDeduplicated += 1;
          return { status: 'duplicate' as const, eventId: event_id, message: 'Concurrent duplicate event suppressed' };
        }
        throw err;
      }

      if (!providerEvent) {
        metrics.counters.webhooksDeduplicated += 1;
        return { status: 'duplicate' as const, eventId: event_id, message: 'Event already processed' };
      }

      // Lock payment intent row
      const intent = await trx('payment_intents')
        .where({ provider_name: providerName, provider_reference: data.order_id })
        .forUpdate()
        .first();

      if (!intent) {
        await trx('provider_events').where({ id: providerEvent.id }).update({
          status: 'IGNORED',
          processed_at: new Date(),
        });
        await trx('reconciliation_exceptions').insert({
          run_id: null,
          item_id: null,
          exception_type: 'MISSING_INTERNAL',
          description: `Webhook ${event_id} for unknown provider_reference ${data.order_id}`,
          status: 'OPEN',
        });
        return { status: 'ignored' as const, eventId: event_id, message: 'No matching payment intent' };
      }

      // Amount / currency validation
      if (Number(intent.amount_minor) !== data.amount_minor || intent.currency !== data.currency) {
        const mismatchType = intent.currency !== data.currency ? 'CURRENCY_MISMATCH' : 'AMOUNT_MISMATCH';
        await trx('provider_events').where({ id: providerEvent.id }).update({
          status: 'FAILED',
          payment_intent_id: intent.id,
          processed_at: new Date(),
        });
        await trx('reconciliation_exceptions').insert({
          run_id: null,
          item_id: null,
          exception_type: mismatchType,
          description: `Webhook ${event_id} mismatch on intent ${intent.id}: expected ${intent.amount_minor} ${intent.currency}, received ${data.amount_minor} ${data.currency}`,
          status: 'OPEN',
        });
        await trx('audit_events').insert({
          action: 'WEBHOOK_RECEIVED',
          resource_type: 'PAYMENT_INTENT',
          resource_id: intent.id,
          details: JSON.stringify({ eventId: event_id, mismatchType, expected: intent.amount_minor, got: data.amount_minor }),
        });
        return {
          status: 'mismatch' as const,
          eventId: event_id,
          errorMessage: `Amount/currency mismatch: expected ${intent.amount_minor} ${intent.currency}, got ${data.amount_minor} ${data.currency}`,
        };
      }

      if (event_type === 'payment.captured' || event_type === 'payment.success') {
        if (intent.status === 'SUCCEEDED' || intent.status === 'REFUNDED') {
          await trx('provider_events').where({ id: providerEvent.id }).update({
            status: 'IGNORED',
            payment_intent_id: intent.id,
            processed_at: new Date(),
          });
          metrics.counters.webhooksDeduplicated += 1;
          return { status: 'duplicate_state' as const, eventId: event_id, intentId: intent.id };
        }

        assertValidTransition('PaymentIntent', PAYMENT_INTENT_TRANSITIONS, intent.status, 'SUCCEEDED');

        const clearingWalletId = await ledgerService.getSystemWalletId(trx, 'SYSTEM_CLEARING', intent.currency);

        const { journal } = await ledgerService.postBalancedJournal(trx, {
          type: 'PAYMENT',
          currency: intent.currency,
          description: `Sandbox payment deposit ${intent.provider_reference}`,
          referenceId: intent.id,
          referenceType: 'PAYMENT_INTENT',
          postedBy: SYSTEM_USER_ID,
          entries: [
            { walletId: clearingWalletId, entryType: 'DEBIT', amountMinor: Number(intent.amount_minor) },
            { walletId: intent.wallet_id, entryType: 'CREDIT', amountMinor: Number(intent.amount_minor) },
          ],
        });

        await trx('payment_intents').where({ id: intent.id }).update({
          status: 'SUCCEEDED',
          journal_transaction_id: journal.id,
        });

        await trx('provider_events').where({ id: providerEvent.id }).update({
          status: 'PROCESSED',
          payment_intent_id: intent.id,
          processed_at: new Date(),
        });

        await trx('audit_events').insert({
          action: 'WEBHOOK_PROCESSED',
          resource_type: 'PAYMENT_INTENT',
          resource_id: intent.id,
          details: JSON.stringify({ eventId: event_id, eventType: event_type, providerName, journalId: journal.id }),
        });

        await trx('outbox_events').insert({
          event_type: 'PAYMENT_SUCCEEDED',
          aggregate_type: 'PAYMENT_INTENT',
          aggregate_id: intent.id,
          payload: JSON.stringify({ intentId: intent.id, amountMinor: Number(intent.amount_minor), currency: intent.currency }),
          status: 'PENDING',
        });

        metrics.counters.webhooksProcessed += 1;
        return { status: 'processed' as const, eventId: event_id, intentId: intent.id, journalId: journal.id };
      }

      if (event_type === 'payment.failed' || event_type === 'settlement.failed') {
        if (intent.status === 'SUCCEEDED') {
          // Do not mutate posted credits silently — raise a reviewable reconciliation exception
          await trx('provider_events').where({ id: providerEvent.id }).update({
            status: 'FAILED',
            payment_intent_id: intent.id,
            processed_at: new Date(),
          });
          await trx('reconciliation_exceptions').insert({
            run_id: null,
            item_id: null,
            exception_type: 'FAILED_SETTLEMENT_CONFLICT',
            description: `Received ${event_type} for already SUCCEEDED payment intent ${intent.id}; requires operator review/reversal.`,
            status: 'OPEN',
          });
          return { status: 'exception' as const, eventId: event_id, intentId: intent.id };
        }

        assertValidTransition('PaymentIntent', PAYMENT_INTENT_TRANSITIONS, intent.status, 'FAILED');
        await trx('payment_intents').where({ id: intent.id }).update({ status: 'FAILED' });
        await trx('provider_events').where({ id: providerEvent.id }).update({
          status: 'PROCESSED',
          payment_intent_id: intent.id,
          processed_at: new Date(),
        });
        await trx('audit_events').insert({
          action: 'PAYMENT_INTENT_UPDATED',
          resource_type: 'PAYMENT_INTENT',
          resource_id: intent.id,
          details: JSON.stringify({ eventId: event_id, eventType: event_type, newStatus: 'FAILED' }),
        });
        await trx('outbox_events').insert({
          event_type: 'PAYMENT_FAILED',
          aggregate_type: 'PAYMENT_INTENT',
          aggregate_id: intent.id,
          payload: JSON.stringify({ intentId: intent.id, amountMinor: Number(intent.amount_minor), currency: intent.currency }),
          status: 'PENDING',
        });
        metrics.counters.webhooksProcessed += 1;
        return { status: 'failed_recorded' as const, eventId: event_id, intentId: intent.id };
      }

      await trx('provider_events').where({ id: providerEvent.id }).update({
        status: 'PROCESSED',
        payment_intent_id: intent.id,
        processed_at: new Date(),
      });
      return { status: 'processed' as const, eventId: event_id };
    });

    if (outcome.status === 'mismatch') {
      throw new ValidationError(outcome.errorMessage);
    }

    return outcome;
  },
};
