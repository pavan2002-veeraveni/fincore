import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { getDb, closeDb } from '../../src/infrastructure/database/connection.js';
import {
  SYSTEM_USER_ID,
  SYSTEM_CUSTOMER_ID,
  SYSTEM_CLEARING_WALLET_ID,
} from '../../src/infrastructure/database/migrations/004_system_accounts_and_hardening.js';
import { ledgerService } from '../../src/modules/ledger/ledger.service.js';
import { app } from '../../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../src/infrastructure/database/migrations');

export async function initTestDb() {
  const db = getDb();
  await db.migrate.latest({
    directory: migrationsDir,
    extension: 'ts',
  });
  return db;
}

export async function resetTestDb() {
  const db = getDb();
  await db.raw(`
    ALTER TABLE ledger_entries DISABLE TRIGGER enforce_ledger_immutability;
    ALTER TABLE journal_transactions DISABLE TRIGGER enforce_posted_journal_immutability;
    ALTER TABLE audit_events DISABLE TRIGGER enforce_audit_immutability;

    TRUNCATE TABLE
      audit_events,
      notification_jobs,
      outbox_events,
      statements,
      risk_alerts,
      risk_assessments,
      reconciliation_exceptions,
      reconciliation_items,
      reconciliation_runs,
      dispute_events,
      disputes,
      refunds,
      provider_events,
      payment_intents,
      idempotency_records,
      transfers,
      holds,
      ledger_entries,
      journal_transactions,
      beneficiaries
    CASCADE;

    DELETE FROM wallets WHERE wallet_type = 'CUSTOMER';
    UPDATE wallets SET ledger_balance_minor = 0, available_balance_minor = 0 WHERE wallet_type != 'CUSTOMER';
    DELETE FROM mfa_challenges;
    DELETE FROM refresh_tokens;
    DELETE FROM sessions;
    DELETE FROM user_roles;
    DELETE FROM customer_profiles WHERE id != '${SYSTEM_CUSTOMER_ID}';
    DELETE FROM users WHERE id != '${SYSTEM_USER_ID}';

    ALTER TABLE audit_events ENABLE TRIGGER enforce_audit_immutability;
    ALTER TABLE journal_transactions ENABLE TRIGGER enforce_posted_journal_immutability;
    ALTER TABLE ledger_entries ENABLE TRIGGER enforce_ledger_immutability;
  `);
}

export async function teardownTestDb() {
  await closeDb();
}

export async function registerUser(opts: {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
}) {
  const password = opts.password ?? 'TestPass@2026!';
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email: opts.email,
      password,
      firstName: opts.firstName ?? 'Test',
      lastName: opts.lastName ?? 'User',
    });

  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  let { user, tokens } = res.body.data;

  if (opts.roles && opts.roles.length > 0) {
    const db = getDb();
    await db('user_roles').where({ user_id: user.id }).del();
    const roleRows = await db('roles').whereIn('name', opts.roles);
    await db('user_roles').insert(roleRows.map((r: { id: string }) => ({ user_id: user.id, role_id: r.id })));

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: opts.email, password });
    user = loginRes.body.data.user;
    tokens = loginRes.body.data.tokens;
  }

  return { user, tokens, password };
}

export async function obtainStepUpToken(accessToken: string, password: string, action = 'ALL'): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/step-up')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ password, action });

  if (res.status !== 200) {
    throw new Error(`step-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.stepUpToken as string;
}

export async function createFundedWallet(
  accessToken: string,
  userId: string,
  amountMinor: number,
  walletName = 'Primary INR Wallet',
) {
  const res = await request(app)
    .post('/api/v1/wallets')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ walletName, currency: 'INR' });

  if (res.status !== 201) {
    throw new Error(`createWallet failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const wallet = res.body.data;

  if (amountMinor > 0) {
    const db = getDb();
    await db.transaction(async (trx) => {
      await ledgerService.postBalancedJournal(trx, {
        type: 'DEPOSIT',
        currency: 'INR',
        description: `Test deposit for ${wallet.id}`,
        postedBy: userId,
        entries: [
          { walletId: SYSTEM_CLEARING_WALLET_ID, entryType: 'DEBIT', amountMinor },
          { walletId: wallet.id, entryType: 'CREDIT', amountMinor },
        ],
      });
    });
  }

  return wallet;
}
