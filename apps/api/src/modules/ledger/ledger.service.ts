import { type Knex } from 'knex';
import { ledgerRepository } from './ledger.repository.js';
import { getDb } from '../../infrastructure/database/connection.js';
import { InsufficientFundsError, NotFoundError, ValidationError } from '../../shared/errors/index.js';
import type { CreateJournalInput } from './ledger.schema.js';

/**
 * Ledger Service — enforces double-entry invariants.
 *
 * Design decisions (see docs/ASSUMPTIONS.md A3):
 * - Balance projection: wallets.ledger_balance_minor and available_balance_minor
 *   are updated in the SAME transaction as ledger postings.
 * - Projection can be rebuilt from ledger entries + holds using reconcileWalletBalance().
 * - Money is stored as BIGINT (integer minor units — paise for INR).
 */
export const ledgerService = {
  /**
   * Post a balanced journal transaction within an existing DB transaction.
   *
   * CRITICAL INVARIANTS ENFORCED:
   * 1. At least 2 ledger entries
   * 2. Sum of DEBIT amounts === Sum of CREDIT amounts (same currency)
   * 3. All amounts positive safe integers
   * 4. Deterministic wallet row locking (FOR UPDATE ORDER BY id)
   * 5. Customer wallets never drop below 0 available balance
   * 6. Wallet balance projections updated atomically
   */
  async postBalancedJournal(
    trx: Knex,
    input: CreateJournalInput & { postedBy: string },
  ) {
    const { entries, postedBy, ...journalData } = input;

    if (entries.length < 2) {
      throw new ValidationError('A journal transaction must have at least 2 entries');
    }

    let totalDebits = 0;
    let totalCredits = 0;
    for (const entry of entries) {
      if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0) {
        throw new ValidationError('All entry amounts must be positive integers');
      }
      if (entry.entryType === 'DEBIT') {
        totalDebits += entry.amountMinor;
      } else {
        totalCredits += entry.amountMinor;
      }
    }

    if (totalDebits !== totalCredits) {
      throw new ValidationError(
        `Journal does not balance: debits=${totalDebits}, credits=${totalCredits}`,
      );
    }

    // Lock all involved wallets in deterministic ID order
    const distinctWalletIds = [...new Set(entries.map((e) => e.walletId))].sort();
    const lockedWallets = await trx('wallets')
      .whereIn('id', distinctWalletIds)
      .orderBy('id')
      .forUpdate();

    if (lockedWallets.length !== distinctWalletIds.length) {
      throw new NotFoundError('One or more ledger wallets do not exist');
    }

    // Aggregate per-wallet net delta and verify currency & no-overdraft under lock
    const netDeltaByWallet = new Map<string, number>();
    for (const entry of entries) {
      const prev = netDeltaByWallet.get(entry.walletId) ?? 0;
      const signed = entry.entryType === 'CREDIT' ? entry.amountMinor : -entry.amountMinor;
      netDeltaByWallet.set(entry.walletId, prev + signed);
    }

    for (const wallet of lockedWallets) {
      if (wallet.currency !== journalData.currency) {
        throw new ValidationError(
          `Currency mismatch for wallet ${wallet.id}: expected ${journalData.currency}, got ${wallet.currency}`,
        );
      }
      const delta = netDeltaByWallet.get(wallet.id) ?? 0;
      const walletType = (wallet as Record<string, unknown>)['wallet_type'] as string | undefined;
      if ((walletType ?? 'CUSTOMER') === 'CUSTOMER') {
        const nextAvailable = Number(wallet.available_balance_minor) + delta;
        if (nextAvailable < 0) {
          throw new InsufficientFundsError(
            `Insufficient available balance in wallet ${wallet.id}: available ${wallet.available_balance_minor}, change ${delta}`,
          );
        }
      }
    }

    // Create journal header, immutable entries, mark POSTED
    const journal = await ledgerRepository.createJournalTransaction(trx, journalData);

    const ledgerEntries = await ledgerRepository.createLedgerEntries(
      trx,
      journal.id,
      entries.map((e) => ({ ...e, currency: journalData.currency })),
    );

    const posted = await ledgerRepository.postJournal(trx, journal.id, postedBy);

    // Update wallet balance projections atomically
    for (const walletId of distinctWalletIds) {
      const delta = netDeltaByWallet.get(walletId) ?? 0;
      if (delta !== 0) {
        await trx('wallets')
          .where({ id: walletId })
          .update({
            ledger_balance_minor: trx.raw('ledger_balance_minor + ?', [delta]),
            available_balance_minor: trx.raw('available_balance_minor + ?', [delta]),
          });
      }
    }

    return { journal: posted, entries: ledgerEntries };
  },

  /** Reserve funds via a hold, reducing available_balance_minor while preserving ledger_balance_minor. */
  async placeHold(
    trx: Knex,
    input: {
      walletId: string;
      amountMinor: number;
      currency: string;
      reason?: string;
      referenceId?: string;
      referenceType?: string;
      expiresAt?: Date;
    },
  ) {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new ValidationError('Hold amount must be a positive integer');
    }

    const wallet = await trx('wallets').where({ id: input.walletId }).forUpdate().first();
    if (!wallet) throw new NotFoundError('Wallet not found');
    if (wallet.status !== 'ACTIVE') throw new ValidationError('Wallet is not active');
    if (wallet.currency !== input.currency) {
      throw new ValidationError(`Currency mismatch for hold: wallet=${wallet.currency}, hold=${input.currency}`);
    }
    if (Number(wallet.available_balance_minor) < input.amountMinor) {
      throw new InsufficientFundsError(
        `Insufficient available balance for hold: available ${wallet.available_balance_minor}, requested ${input.amountMinor}`,
      );
    }

    const hold = await ledgerRepository.createHold(trx, input);

    await trx('wallets')
      .where({ id: input.walletId })
      .update({
        available_balance_minor: trx.raw('available_balance_minor - ?', [input.amountMinor]),
      });

    return hold;
  },

  /** Release an active hold, restoring available_balance_minor. */
  async releaseHold(trx: Knex, holdId: string) {
    const hold = await trx('holds').where({ id: holdId }).forUpdate().first();
    if (!hold) throw new NotFoundError('Hold not found');
    if (hold.status !== 'ACTIVE') {
      throw new ValidationError(`Hold is already ${hold.status}`);
    }

    await trx('wallets').where({ id: hold.wallet_id }).forUpdate().first();
    const released = await ledgerRepository.updateHoldStatus(trx, holdId, 'RELEASED');

    await trx('wallets')
      .where({ id: hold.wallet_id })
      .update({
        available_balance_minor: trx.raw('available_balance_minor + ?', [Number(hold.amount_minor)]),
      });

    return released;
  },

  /**
   * Capture an active hold and post the settlement journal atomically.
   * Restores available_balance_minor for the captured hold before posting so the
   * balanced journal debit leaves both ledger_balance_minor and available_balance_minor
   * reconciled with active holds.
   */
  async captureHoldAndPost(
    trx: Knex,
    params: {
      holdId: string;
      destinationWalletId: string;
      type: CreateJournalInput['type'];
      description?: string;
      referenceId?: string;
      referenceType?: string;
      postedBy: string;
    },
  ) {
    const hold = await trx('holds').where({ id: params.holdId }).forUpdate().first();
    if (!hold) throw new NotFoundError('Hold not found');
    if (hold.status !== 'ACTIVE') {
      throw new ValidationError(`Cannot capture hold in status ${hold.status}`);
    }

    const amountMinor = Number(hold.amount_minor);
    const walletIds = [hold.wallet_id, params.destinationWalletId].sort();
    await trx('wallets').whereIn('id', walletIds).orderBy('id').forUpdate();

    await ledgerRepository.updateHoldStatus(trx, params.holdId, 'CAPTURED');
    await trx('wallets')
      .where({ id: hold.wallet_id })
      .update({
        available_balance_minor: trx.raw('available_balance_minor + ?', [amountMinor]),
      });

    return this.postBalancedJournal(trx, {
      type: params.type,
      currency: hold.currency,
      description: params.description,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      postedBy: params.postedBy,
      entries: [
        { walletId: hold.wallet_id, entryType: 'DEBIT', amountMinor },
        { walletId: params.destinationWalletId, entryType: 'CREDIT', amountMinor },
      ],
    });
  },

  async getSystemWalletId(
    trx: Knex,
    walletType: 'SYSTEM_CLEARING' | 'SYSTEM_FEE' | 'SYSTEM_SUSPENSE',
    currency: string,
  ): Promise<string> {
    const wallet = await ledgerRepository.getSystemWallet(trx, walletType, currency);
    if (!wallet) {
      throw new NotFoundError(`System wallet ${walletType} (${currency}) not configured`);
    }
    return wallet.id;
  },

  async getJournalWithEntries(journalId: string) {
    const journal = await ledgerRepository.getJournalById(journalId);
    if (!journal) return null;
    const entries = await ledgerRepository.getEntriesForJournal(journalId);
    return { journal, entries };
  },

  async getWalletTransactions(walletId: string, page: number, pageSize: number) {
    return ledgerRepository.getEntriesForWallet(walletId, page, pageSize);
  },

  async reconcileWalletBalance(walletId: string) {
    const db = getDb();
    const wallet = await db('wallets').where({ id: walletId }).first();
    if (!wallet) return null;

    const derived = await ledgerRepository.getDerivedBalance(walletId);
    const holdsTotal = await ledgerRepository.getActiveHoldsTotal(db, walletId);

    const projectedLedger = Number(wallet.ledger_balance_minor);
    const projectedAvailable = Number(wallet.available_balance_minor);
    const derivedAvailable = derived.balance - holdsTotal;

    return {
      walletId,
      currency: wallet.currency,
      projection: {
        ledgerBalance: projectedLedger,
        availableBalance: projectedAvailable,
      },
      derived: {
        totalCredits: derived.credits,
        totalDebits: derived.debits,
        ledgerBalance: derived.balance,
        activeHolds: holdsTotal,
        availableBalance: derivedAvailable,
      },
      ledgerMatch: projectedLedger === derived.balance,
      availableMatch: projectedAvailable === derivedAvailable,
    };
  },

  async getGlobalLedgerInvariantCheck() {
    const db = getDb();
    const [totalsRow, unbalancedRows] = await Promise.all([
      db('ledger_entries as le')
        .join('journal_transactions as jt', 'le.journal_transaction_id', 'jt.id')
        .where({ 'jt.status': 'POSTED' })
        .select(
          db.raw("COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount_minor ELSE 0 END), 0)::bigint as total_debits"),
          db.raw("COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_minor ELSE 0 END), 0)::bigint as total_credits"),
        )
        .first<Record<string, unknown> | undefined>(),
      db.raw(`
        SELECT jt.id
        FROM journal_transactions jt
        LEFT JOIN ledger_entries le ON le.journal_transaction_id = jt.id
        WHERE jt.status = 'POSTED'
        GROUP BY jt.id
        HAVING
          COUNT(le.id) < 2 OR
          COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount_minor ELSE 0 END), 0)
          != COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_minor ELSE 0 END), 0)
      `),
    ]);

    const totalDebits = Number(totalsRow?.['total_debits'] ?? 0);
    const totalCredits = Number(totalsRow?.['total_credits'] ?? 0);
    const unbalancedJournals = (unbalancedRows.rows as Array<{ id: string }>).map((r) => r.id);

    return {
      totalDebits,
      totalCredits,
      balanced: totalDebits === totalCredits && unbalancedJournals.length === 0,
      unbalancedJournals,
    };
  },
};
