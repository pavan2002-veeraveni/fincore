import type { Knex } from 'knex';

/**
 * Migration 002 — Financial Core Tables
 *
 * Creates: wallets, beneficiaries, journal_transactions, ledger_entries,
 * holds, transfers, idempotency_records
 *
 * Design decisions:
 * - Money stored as BIGINT (integer minor units — paise for INR)
 * - Currency is mandatory on every monetary field
 * - Ledger entries are append-only (no UPDATE/DELETE from application)
 * - Journal transactions must balance: sum(debits) = sum(credits) per currency
 * - Wallets maintain a transactional balance projection updated atomically with ledger postings
 * - Deterministic row locking order by wallet ID prevents deadlocks
 * - Idempotency keys prevent duplicate financial operations
 */
export async function up(knex: Knex): Promise<void> {

  // ── Wallets / Financial Accounts ──
  await knex.schema.createTable('wallets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').notNullable().references('id').inTable('customer_profiles');
    t.string('wallet_name', 100).notNullable().defaultTo('Primary Wallet');
    t.string('currency', 3).notNullable().defaultTo('INR');
    t.text('status').notNullable().defaultTo('ACTIVE');
    // Balance projection — updated transactionally with ledger postings
    // ledger_balance = sum of all posted debit - credit entries
    // available_balance = ledger_balance - sum of active holds
    t.bigint('ledger_balance_minor').notNullable().defaultTo(0);
    t.bigint('available_balance_minor').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('closed_at', { useTz: true }).nullable();

    t.check("status IN ('ACTIVE', 'FROZEN', 'CLOSED')");
    t.check('available_balance_minor >= 0'); // No overdraft by default
    t.check("currency IN ('INR')"); // Supported currencies

    t.index(['customer_id', 'status']);
  });

  // ── Beneficiaries ──
  await knex.schema.createTable('beneficiaries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('owner_customer_id').notNullable().references('id').inTable('customer_profiles');
    t.uuid('destination_wallet_id').notNullable().references('id').inTable('wallets');
    t.string('nickname', 100).notNullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deactivated_at', { useTz: true }).nullable();

    t.check("status IN ('ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION')");
    t.index(['owner_customer_id', 'status']);
    t.unique(['owner_customer_id', 'destination_wallet_id']); // One beneficiary per destination per customer
  });

  // ── Journal Transactions ──
  await knex.schema.createTable('journal_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('type').notNullable(); // TRANSFER, PAYMENT, REFUND, REVERSAL, ADJUSTMENT, DEPOSIT
    t.text('status').notNullable().defaultTo('PENDING');
    t.string('currency', 3).notNullable();
    t.text('description').nullable();
    t.uuid('reference_id').nullable(); // Link to transfer/payment/refund
    t.text('reference_type').nullable(); // 'TRANSFER', 'PAYMENT_INTENT', 'REFUND'
    t.uuid('posted_by').nullable().references('id').inTable('users');
    t.timestamp('posted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('PENDING', 'POSTED', 'VOID')");
    t.check("type IN ('TRANSFER', 'PAYMENT', 'REFUND', 'REVERSAL', 'ADJUSTMENT', 'DEPOSIT', 'WITHDRAWAL', 'FEE')");
    t.index(['reference_type', 'reference_id']);
    t.index(['status', 'created_at']);
  });

  // ── Ledger Entries (immutable after posting) ──
  await knex.schema.createTable('ledger_entries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('journal_transaction_id').notNullable().references('id').inTable('journal_transactions');
    t.integer('line_number').notNullable();
    t.uuid('wallet_id').notNullable().references('id').inTable('wallets');
    t.text('entry_type').notNullable(); // DEBIT or CREDIT
    t.bigint('amount_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.text('description').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("entry_type IN ('DEBIT', 'CREDIT')");
    t.check('amount_minor > 0'); // Amounts are always positive; direction from entry_type
    t.unique(['journal_transaction_id', 'line_number']);
    t.index(['wallet_id', 'created_at']);
  });

  // ── Holds ──
  await knex.schema.createTable('holds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('wallet_id').notNullable().references('id').inTable('wallets');
    t.bigint('amount_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('reason').nullable();
    t.uuid('reference_id').nullable(); // transfer or payment intent
    t.text('reference_type').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('captured_at', { useTz: true }).nullable();
    t.timestamp('released_at', { useTz: true }).nullable();
    t.timestamp('expires_at', { useTz: true }).nullable();

    t.check("status IN ('ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED')");
    t.check('amount_minor > 0');
    t.index(['wallet_id', 'status']);
  });

  // ── Transfers ──
  await knex.schema.createTable('transfers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('source_wallet_id').notNullable().references('id').inTable('wallets');
    t.uuid('destination_wallet_id').notNullable().references('id').inTable('wallets');
    t.bigint('amount_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.text('status').notNullable().defaultTo('CREATED');
    t.text('description').nullable();
    t.uuid('journal_transaction_id').nullable().references('id').inTable('journal_transactions');
    t.uuid('initiated_by').notNullable().references('id').inTable('users');
    t.bigint('refunded_amount_minor').notNullable().defaultTo(0);
    t.timestamp('confirmed_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('failed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('CREATED', 'PENDING_CONFIRMATION', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REVERSED')");
    t.check('amount_minor > 0');
    t.check('refunded_amount_minor >= 0');
    t.check('refunded_amount_minor <= amount_minor');

    t.index(['source_wallet_id', 'created_at']);
    t.index(['destination_wallet_id', 'created_at']);
    t.index(['status', 'created_at']);
    t.index(['initiated_by']);
  });

  // ── Idempotency Records ──
  await knex.schema.createTable('idempotency_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.string('idempotency_key', 255).notNullable();
    t.string('request_hash', 128).notNullable(); // SHA-256 of canonical request body
    t.text('operation').notNullable(); // e.g., 'CREATE_TRANSFER', 'CREATE_PAYMENT_INTENT'
    t.uuid('resource_id').nullable(); // ID of created resource
    t.text('resource_type').nullable();
    t.integer('status_code').nullable();
    t.jsonb('response_body').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();

    t.unique(['user_id', 'idempotency_key']);
    t.index(['expires_at']); // For cleanup
  });

  // Apply updated_at triggers
  for (const table of ['wallets', 'beneficiaries', 'transfers']) {
    await knex.raw(`
      CREATE TRIGGER update_${table}_updated_at
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'idempotency_records', 'transfers', 'holds',
    'ledger_entries', 'journal_transactions',
    'beneficiaries', 'wallets',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
