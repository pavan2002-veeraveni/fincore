import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initTestDb, resetTestDb, teardownTestDb, registerUser, createFundedWallet } from './setup.js';
import { getDb } from '../../src/infrastructure/database/connection.js';
import { ledgerService } from '../../src/modules/ledger/ledger.service.js';
import { SYSTEM_CLEARING_WALLET_ID } from '../../src/infrastructure/database/migrations/004_system_accounts_and_hardening.js';
import { ValidationError, InsufficientFundsError } from '../../src/shared/errors/index.js';

describe('Double-Entry Ledger Invariants & PostgreSQL Constraints (Assessment 03)', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('posts a balanced journal transaction and reconciles projection vs derived ledger', async () => {
    const db = getDb();
    const { user, tokens } = await registerUser({ email: 'ledger1@fincore.test' });
    const w1 = await createFundedWallet(tokens.accessToken, user.id, 100_000);
    const w2 = await createFundedWallet(tokens.accessToken, user.id, 0, 'Savings Wallet');

    await db.transaction(async (trx) => {
      await ledgerService.postBalancedJournal(trx, {
        type: 'TRANSFER',
        currency: 'INR',
        description: 'Balanced transfer posting',
        postedBy: user.id,
        entries: [
          { walletId: w1.id, entryType: 'DEBIT', amountMinor: 40_000 },
          { walletId: w2.id, entryType: 'CREDIT', amountMinor: 40_000 },
        ],
      });
    });

    const recon1 = await ledgerService.reconcileWalletBalance(w1.id);
    const recon2 = await ledgerService.reconcileWalletBalance(w2.id);
    expect(recon1?.ledgerMatch).toBe(true);
    expect(recon1?.availableMatch).toBe(true);
    expect(recon1?.derived.ledgerBalance).toBe(60_000);
    expect(recon2?.derived.ledgerBalance).toBe(40_000);

    const global = await ledgerService.getGlobalLedgerInvariantCheck();
    expect(global.balanced).toBe(true);
    expect(global.totalDebits).toBe(global.totalCredits);
  });

  it('rejects unbalanced journals at both application layer and PostgreSQL deferred trigger layer', async () => {
    const db = getDb();
    const { user, tokens } = await registerUser({ email: 'ledger2@fincore.test' });
    const w1 = await createFundedWallet(tokens.accessToken, user.id, 50_000);

    // 1. Service layer rejects unbalanced amounts
    await expect(
      db.transaction(async (trx) => {
        await ledgerService.postBalancedJournal(trx, {
          type: 'ADJUSTMENT',
          currency: 'INR',
          postedBy: user.id,
          entries: [
            { walletId: SYSTEM_CLEARING_WALLET_ID, entryType: 'DEBIT', amountMinor: 5000 },
            { walletId: w1.id, entryType: 'CREDIT', amountMinor: 4000 },
          ],
        });
      }),
    ).rejects.toThrow(ValidationError);

    // 2. Database constraint trigger rejects direct unbalanced SQL insert/post
    await expect(
      db.transaction(async (trx) => {
        const [jt] = await trx('journal_transactions')
          .insert({ type: 'ADJUSTMENT', status: 'PENDING', currency: 'INR' })
          .returning('*');
        await trx('ledger_entries').insert([
          { journal_transaction_id: jt.id, line_number: 1, wallet_id: SYSTEM_CLEARING_WALLET_ID, entry_type: 'DEBIT', amount_minor: 5000, currency: 'INR' },
          { journal_transaction_id: jt.id, line_number: 2, wallet_id: w1.id, entry_type: 'CREDIT', amount_minor: 3000, currency: 'INR' },
        ]);
        await trx('journal_transactions').where({ id: jt.id }).update({ status: 'POSTED' });
      }),
    ).rejects.toThrow(/does not balance/i);

    // 3. Database constraint trigger rejects single-entry POSTED journal
    await expect(
      db.transaction(async (trx) => {
        const [jt] = await trx('journal_transactions')
          .insert({ type: 'DEPOSIT', status: 'PENDING', currency: 'INR' })
          .returning('*');
        await trx('ledger_entries').insert([
          { journal_transaction_id: jt.id, line_number: 1, wallet_id: w1.id, entry_type: 'CREDIT', amount_minor: 5000, currency: 'INR' },
        ]);
        await trx('journal_transactions').where({ id: jt.id }).update({ status: 'POSTED' });
      }),
    ).rejects.toThrow(/at least 2 entries/i);
  });

  it('enforces ledger_entries, posted journal_transactions, and audit_events immutability at DB level', async () => {
    const db = getDb();
    const { user, tokens } = await registerUser({ email: 'immutable@fincore.test' });
    const w1 = await createFundedWallet(tokens.accessToken, user.id, 10_000);

    const entry = await db('ledger_entries').where({ wallet_id: w1.id }).first();
    expect(entry).toBeDefined();

    await expect(db('ledger_entries').where({ id: entry.id }).update({ amount_minor: 99_999 }))
      .rejects.toThrow(/immutable/i);
    await expect(db('ledger_entries').where({ id: entry.id }).del())
      .rejects.toThrow(/immutable/i);
    await expect(db('journal_transactions').where({ id: entry.journal_transaction_id }).update({ description: 'tampered' }))
      .rejects.toThrow(/immutable/i);
    await expect(db('audit_events').del())
      .rejects.toThrow(/immutable/i);
  });

  it('enforces holds reserving available balance while preserving ledger balance, and prevents overdraft', async () => {
    const db = getDb();
    const { user, tokens } = await registerUser({ email: 'holds@fincore.test' });
    const w1 = await createFundedWallet(tokens.accessToken, user.id, 20_000);
    const w2 = await createFundedWallet(tokens.accessToken, user.id, 0, 'Target');

    const hold = await db.transaction((trx) =>
      ledgerService.placeHold(trx, {
        walletId: w1.id,
        amountMinor: 15_000,
        currency: 'INR',
        reason: 'Two-step reservation',
      }),
    );

    const midRecon = await ledgerService.reconcileWalletBalance(w1.id);
    expect(midRecon?.projection.ledgerBalance).toBe(20_000);
    expect(midRecon?.projection.availableBalance).toBe(5_000);
    expect(midRecon?.availableMatch).toBe(true);

    // Attempting to spend 10,000 against available 5,000 fails
    await expect(
      db.transaction((trx) =>
        ledgerService.postBalancedJournal(trx, {
          type: 'TRANSFER',
          currency: 'INR',
          postedBy: user.id,
          entries: [
            { walletId: w1.id, entryType: 'DEBIT', amountMinor: 10_000 },
            { walletId: w2.id, entryType: 'CREDIT', amountMinor: 10_000 },
          ],
        }),
      ),
    ).rejects.toThrow(InsufficientFundsError);

    // Capturing the hold settles cleanly
    await db.transaction((trx) =>
      ledgerService.captureHoldAndPost(trx, {
        holdId: hold.id,
        destinationWalletId: w2.id,
        type: 'TRANSFER',
        postedBy: user.id,
      }),
    );

    const finalRecon = await ledgerService.reconcileWalletBalance(w1.id);
    expect(finalRecon?.projection.ledgerBalance).toBe(5_000);
    expect(finalRecon?.projection.availableBalance).toBe(5_000);
    expect(finalRecon?.ledgerMatch).toBe(true);
    expect(finalRecon?.availableMatch).toBe(true);
  });

  it('blocks post-posting inserts into ledger_entries and updates/deletes on dispute_events (Migration 005)', async () => {
    const db = getDb();
    const { user, tokens } = await registerUser({ email: 'mig005@fincore.test' });
    const w1 = await createFundedWallet(tokens.accessToken, user.id, 10_000);
    const entry = await db('ledger_entries').where({ wallet_id: w1.id }).first();

    // Direct INSERT referencing an already POSTED journal header fails
    await expect(
      db('ledger_entries').insert({
        journal_transaction_id: entry.journal_transaction_id,
        line_number: 99,
        wallet_id: w1.id,
        entry_type: 'CREDIT',
        amount_minor: 5_000,
        currency: 'INR',
      }),
    ).rejects.toThrow(/already POSTED/i);

    // Dispute events cannot be updated or deleted once inserted
    const [custProfile] = await db('customer_profiles').where({ user_id: user.id }).select('id');
    const [dispute] = await db('disputes')
      .insert({
        customer_id: custProfile.id,
        reason: 'Trigger check',
        status: 'OPEN',
      })
      .returning('id');
    const [dEvt] = await db('dispute_events')
      .insert({
        dispute_id: dispute.id,
        actor_id: user.id,
        event_type: 'CREATED',
        comment: 'Initial immutable event',
      })
      .returning('id');

    await expect(db('dispute_events').where({ id: dEvt.id }).update({ comment: 'tampered' }))
      .rejects.toThrow(/immutable/i);
    await expect(db('dispute_events').where({ id: dEvt.id }).del())
      .rejects.toThrow(/immutable/i);
  });
});
