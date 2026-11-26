import { getDb } from '../../infrastructure/database/connection.js';
import { transfersRepository } from './transfers.repository.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { ledgerService } from '../ledger/ledger.service.js';
import { ledgerRepository } from '../ledger/ledger.repository.js';
import { metrics } from '../../infrastructure/metrics/index.js';
import { assertValidTransition, TRANSFER_TRANSITIONS } from '../../shared/state-machine.js';
import {
  NotFoundError,
  ValidationError,
  InsufficientFundsError,
  IdempotencyConflictError,
  ForbiddenError,
} from '../../shared/errors/index.js';
import { computeRequestHash, checkIdempotency, lockIdempotencyScope, saveIdempotencyRecord } from '../../shared/security/idempotency.js';
import { config } from '../../config/index.js';
import { riskService } from '../risk/risk.service.js';
import type { CreateTransferInput } from './transfers.schema.js';

function formatTransferResponse(row: Awaited<ReturnType<typeof transfersRepository.create>>) {
  return {
    id: row.id,
    sourceWalletId: row.source_wallet_id,
    destinationWalletId: row.destination_wallet_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    status: row.status,
    description: row.description,
    journalTransactionId: row.journal_transaction_id,
    refundedAmountMinor: Number(row.refunded_amount_minor),
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * Transfer Consistency Engine (Assessment 07)
 *
 * Enforces:
 * 1. Idempotency key + request fingerprint validation (409 on mismatched payload)
 * 2. Deterministic row locking (sorted wallet IDs) to prevent deadlocks
 * 3. Available balance check under lock (accounting for active holds)
 * 4. Atomic journal posting + balance projection update OR two-step Hold reservation
 * 5. Server-side state machine transitions + audit + transactional outbox
 */
export const transfersService = {
  async createTransfer(
    userId: string,
    input: CreateTransferInput,
    idempotencyKey: string,
    requestId?: string,
  ) {
    const db = getDb();

    const requestHash = computeRequestHash({
      sourceWalletId: input.sourceWalletId,
      destinationWalletId: input.destinationWalletId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description ?? null,
      requireConfirmation: input.requireConfirmation ?? false,
    });

    if (input.sourceWalletId === input.destinationWalletId) {
      throw new ValidationError('Source and destination wallets must be different');
    }

    let transferCustomerId: string | undefined;
    const outcome = await db.transaction(async (trx) => {
      // 1. Serialize same-key concurrent retries and check idempotency record
      await lockIdempotencyScope(trx, userId, idempotencyKey);
      const existingRecord = await checkIdempotency(trx, userId, idempotencyKey);
      if (existingRecord) {
        if (existingRecord.request_hash === requestHash) {
          return { transfer: existingRecord.response_body, cached: true };
        }
        throw new IdempotencyConflictError();
      }

      // 2. Lock wallets in deterministic sorted UUID order
      const walletIds = [input.sourceWalletId, input.destinationWalletId].sort();
      const lockedWallets = await walletsRepository.lockWalletsForUpdate(trx, walletIds);

      if (lockedWallets.length !== 2) {
        throw new NotFoundError('One or both wallets not found');
      }

      const sourceWallet = lockedWallets.find((w) => w.id === input.sourceWalletId)!;
      const destWallet = lockedWallets.find((w) => w.id === input.destinationWalletId)!;

      // 3. Validate customer ownership, wallet type, status, currency
      const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
      if (!customerId) throw new NotFoundError('Customer profile not found');
      transferCustomerId = customerId;

      if (sourceWallet.customer_id !== customerId) {
        throw new ForbiddenError('You do not own the source wallet');
      }
      if (destWallet.wallet_type !== 'CUSTOMER') {
        throw new ValidationError('Cannot transfer directly to system control accounts');
      }
      if (sourceWallet.status !== 'ACTIVE') {
        throw new ValidationError('Source wallet is not active');
      }
      if (destWallet.status !== 'ACTIVE') {
        throw new ValidationError('Destination wallet is not active');
      }
      if (sourceWallet.currency !== input.currency || destWallet.currency !== input.currency) {
        throw new ValidationError(
          `Currency mismatch: wallets use ${sourceWallet.currency}/${destWallet.currency}, transfer specifies ${input.currency}`,
        );
      }

      const availableBalance = Number(sourceWallet.available_balance_minor);
      if (availableBalance < input.amountMinor) {
        throw new InsufficientFundsError(
          `Insufficient funds: available ${availableBalance}, requested ${input.amountMinor}`,
        );
      }

      // Two-step confirmation flow: place hold + leave transfer in PENDING_CONFIRMATION
      if (input.requireConfirmation) {
        const pendingTransfer = await transfersRepository.create(trx, {
          sourceWalletId: input.sourceWalletId,
          destinationWalletId: input.destinationWalletId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          description: input.description,
          initiatedBy: userId,
          status: 'PENDING_CONFIRMATION',
        });

        await ledgerService.placeHold(trx, {
          walletId: input.sourceWalletId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          reason: `Pending confirmation for transfer ${pendingTransfer.id}`,
          referenceId: pendingTransfer.id,
          referenceType: 'TRANSFER',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });

        await trx('audit_events').insert({
          actor_id: userId,
          action: 'TRANSFER_CREATED',
          resource_type: 'TRANSFER',
          resource_id: pendingTransfer.id,
          details: JSON.stringify({
            sourceWalletId: input.sourceWalletId,
            destinationWalletId: input.destinationWalletId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            mode: 'TWO_STEP_HOLD',
          }),
          request_id: requestId ?? null,
        });

        metrics.counters.transfersPending += 1;
        const responseData = formatTransferResponse(pendingTransfer);

        await saveIdempotencyRecord(trx, {
          userId,
          idempotencyKey,
          requestHash,
          operation: 'CREATE_TRANSFER',
          resourceId: pendingTransfer.id,
          resourceType: 'TRANSFER',
          statusCode: 201,
          responseBody: responseData,
        });

        return { transfer: responseData, cached: false };
      }

      // Immediate atomic transfer flow
      const transfer = await transfersRepository.create(trx, {
        sourceWalletId: input.sourceWalletId,
        destinationWalletId: input.destinationWalletId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        description: input.description,
        initiatedBy: userId,
        status: 'PROCESSING',
      });

      const { journal } = await ledgerService.postBalancedJournal(trx, {
        type: 'TRANSFER',
        currency: input.currency,
        description: input.description || `Transfer ${transfer.id}`,
        referenceId: transfer.id,
        referenceType: 'TRANSFER',
        postedBy: userId,
        entries: [
          { walletId: input.sourceWalletId, entryType: 'DEBIT', amountMinor: input.amountMinor },
          { walletId: input.destinationWalletId, entryType: 'CREDIT', amountMinor: input.amountMinor },
        ],
      });

      assertValidTransition('Transfer', TRANSFER_TRANSITIONS, transfer.status, 'COMPLETED');
      const completedTransfer = await transfersRepository.updateStatus(trx, transfer.id, 'COMPLETED', {
        journal_transaction_id: journal.id,
        confirmed_at: new Date(),
      });

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'TRANSFER_COMPLETED',
        resource_type: 'TRANSFER',
        resource_id: transfer.id,
        details: JSON.stringify({
          sourceWalletId: input.sourceWalletId,
          destinationWalletId: input.destinationWalletId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          journalId: journal.id,
        }),
        request_id: requestId ?? null,
      });

      await trx('outbox_events').insert({
        event_type: 'TRANSFER_COMPLETED',
        aggregate_type: 'TRANSFER',
        aggregate_id: transfer.id,
        payload: JSON.stringify({
          userId,
          transferId: transfer.id,
          sourceWalletId: input.sourceWalletId,
          destinationWalletId: input.destinationWalletId,
          amountMinor: input.amountMinor,
          currency: input.currency,
        }),
        status: 'PENDING',
      });

      metrics.counters.transfersCompleted += 1;
      const responseData = formatTransferResponse(completedTransfer);

      await saveIdempotencyRecord(trx, {
        userId,
        idempotencyKey,
        requestHash,
        operation: 'CREATE_TRANSFER',
        resourceId: transfer.id,
        resourceType: 'TRANSFER',
        statusCode: 201,
        responseBody: responseData,
      });

      return { transfer: responseData, cached: false };
    });

    if (
      !outcome.cached &&
      !input.requireConfirmation &&
      (config.NODE_ENV !== 'test' || process.env['ENABLE_RISK_HOOK_IN_TEST'] === 'true')
    ) {
      try {
        await riskService.assessTransaction({
          customerId: transferCustomerId,
          transactionAmountMinor: input.amountMinor,
          currency: 'INR',
          transactionType: 'TRANSFER',
          failMode: 'FAIL_OPEN',
          actorUserId: userId,
          requestId,
          timeoutMs: 1500,
        });
      } catch {
        // Non-blocking fail-open risk policy for customer transfers (ASSUMPTIONS.md A10)
      }
    }

    return outcome;
  },

  async confirmTransfer(userId: string, transferId: string, requestId?: string) {
    const db = getDb();
    let holdExpired = false;

    const result = await db.transaction(async (trx) => {
      const transfer = await transfersRepository.getByIdForUpdate(trx, transferId);
      if (!transfer) throw new NotFoundError('Transfer not found');

      assertValidTransition('Transfer', TRANSFER_TRANSITIONS, transfer.status, 'PROCESSING');

      const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
      if (!customerId) throw new NotFoundError('Customer profile not found');

      const walletIds = [transfer.source_wallet_id, transfer.destination_wallet_id].sort();
      const lockedWallets = await walletsRepository.lockWalletsForUpdate(trx, walletIds);
      const sourceWallet = lockedWallets.find((w) => w.id === transfer.source_wallet_id);
      const destWallet = lockedWallets.find((w) => w.id === transfer.destination_wallet_id);

      if (!sourceWallet || !destWallet) throw new NotFoundError('Transfer wallet not found');
      if (sourceWallet.customer_id !== customerId) {
        throw new ForbiddenError('You do not own the source wallet for this transfer');
      }
      if (sourceWallet.status !== 'ACTIVE' || destWallet.status !== 'ACTIVE') {
        throw new ValidationError('Both wallets must remain ACTIVE to confirm transfer');
      }

      const hold = await ledgerRepository.getActiveHoldByReference(trx, 'TRANSFER', transfer.id);
      if (hold && hold.expires_at && new Date(hold.expires_at) < new Date()) {
        await ledgerService.releaseHold(trx, hold.id);
        await transfersRepository.updateStatus(trx, transfer.id, 'FAILED');
        await trx('audit_events').insert({
          actor_id: userId,
          action: 'TRANSFER_FAILED',
          resource_type: 'TRANSFER',
          resource_id: transfer.id,
          details: JSON.stringify({ reason: 'Confirmation hold expired' }),
          request_id: requestId ?? null,
        });
        holdExpired = true;
        return null;
      }

      let journalId: string;

      if (hold) {
        const { journal } = await ledgerService.captureHoldAndPost(trx, {
          holdId: hold.id,
          destinationWalletId: transfer.destination_wallet_id,
          type: 'TRANSFER',
          description: transfer.description || `Confirmed transfer ${transfer.id}`,
          referenceId: transfer.id,
          referenceType: 'TRANSFER',
          postedBy: userId,
        });
        journalId = journal.id;
      } else {
        const { journal } = await ledgerService.postBalancedJournal(trx, {
          type: 'TRANSFER',
          currency: transfer.currency,
          description: transfer.description || `Confirmed transfer ${transfer.id}`,
          referenceId: transfer.id,
          referenceType: 'TRANSFER',
          postedBy: userId,
          entries: [
            { walletId: transfer.source_wallet_id, entryType: 'DEBIT', amountMinor: Number(transfer.amount_minor) },
            { walletId: transfer.destination_wallet_id, entryType: 'CREDIT', amountMinor: Number(transfer.amount_minor) },
          ],
        });
        journalId = journal.id;
      }

      const completed = await transfersRepository.updateStatus(trx, transfer.id, 'COMPLETED', {
        journal_transaction_id: journalId,
        confirmed_at: new Date(),
      });

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'TRANSFER_CONFIRMED',
        resource_type: 'TRANSFER',
        resource_id: transfer.id,
        details: JSON.stringify({ journalId }),
        request_id: requestId ?? null,
      });

      await trx('outbox_events').insert({
        event_type: 'TRANSFER_COMPLETED',
        aggregate_type: 'TRANSFER',
        aggregate_id: transfer.id,
        payload: JSON.stringify({
          userId,
          transferId: transfer.id,
          amountMinor: Number(transfer.amount_minor),
          currency: transfer.currency,
        }),
        status: 'PENDING',
      });

      metrics.counters.transfersCompleted += 1;
      return formatTransferResponse(completed);
    });

    if (holdExpired || !result) {
      throw new ValidationError('Transfer confirmation hold has expired');
    }
    return result;
  },

  async cancelTransfer(userId: string, transferId: string, requestId?: string) {
    const db = getDb();

    return db.transaction(async (trx) => {
      const transfer = await transfersRepository.getByIdForUpdate(trx, transferId);
      if (!transfer) throw new NotFoundError('Transfer not found');

      assertValidTransition('Transfer', TRANSFER_TRANSITIONS, transfer.status, 'CANCELLED');

      const customerId = await walletsRepository.getCustomerIdByUserId(userId, trx);
      const sourceWallet = await walletsRepository.getWalletById(transfer.source_wallet_id, trx);
      if (!customerId || sourceWallet?.customer_id !== customerId) {
        throw new ForbiddenError('You do not own the source wallet for this transfer');
      }

      const hold = await ledgerRepository.getActiveHoldByReference(trx, 'TRANSFER', transfer.id);
      if (hold) {
        await ledgerService.releaseHold(trx, hold.id);
      }

      const cancelled = await transfersRepository.updateStatus(trx, transfer.id, 'CANCELLED');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'TRANSFER_FAILED',
        resource_type: 'TRANSFER',
        resource_id: transfer.id,
        details: JSON.stringify({ reason: 'Cancelled before settlement', fromStatus: transfer.status }),
        request_id: requestId ?? null,
      });

      return formatTransferResponse(cancelled);
    });
  },

  async getTransfer(userId: string, transferId: string, roles: string[] = []) {
    const transfer = await transfersRepository.getById(transferId);
    if (!transfer) throw new NotFoundError('Transfer not found');

    const isOps = roles.some((r) =>
      ['OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'].includes(r),
    );
    if (!isOps) {
      const customerId = await walletsRepository.getCustomerIdByUserId(userId);
      if (!customerId) throw new NotFoundError('Customer not found');

      const [sourceWallet, destWallet] = await Promise.all([
        walletsRepository.getWalletById(transfer.source_wallet_id),
        walletsRepository.getWalletById(transfer.destination_wallet_id),
      ]);

      if (sourceWallet?.customer_id !== customerId && destWallet?.customer_id !== customerId) {
        throw new ForbiddenError('You do not have access to this transfer');
      }
    }

    return formatTransferResponse(transfer);
  },

  async listTransfers(
    userId: string,
    roles: string[],
    opts: { page: number; pageSize: number; status?: string; sortBy?: string; sortDir?: 'asc' | 'desc' },
  ) {
    const result = await transfersRepository.getByUser(userId, roles, opts);
    return {
      transfers: result.transfers.map(formatTransferResponse),
      total: result.total,
    };
  },
};
