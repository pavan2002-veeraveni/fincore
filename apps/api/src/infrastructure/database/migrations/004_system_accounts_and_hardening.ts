import type { Knex } from 'knex';

/**
 * Migration 004 — System Clearing Accounts, Ledger Trigger Hardening,
 * Nullable Standalone Reconciliation Exceptions
 *
 * Addresses:
 * 1. Wallet types (CUSTOMER vs SYSTEM_CLEARING / SYSTEM_FEE / SYSTEM_SUSPENSE)
 *    so external payment inflows/outflows maintain full double-entry balance
 *    without negative-balance constraint violations on clearing control accounts.
 * 2. Seeds deterministic synthetic system user/profile/clearing accounts so any
 *    migrated DB can post double-entry deposits/fees/adjustments immediately.
 * 3. Tightens check_journal_balance trigger to fire on AFTER INSERT OR UPDATE
 *    and verify currency homogeneity across all ledger lines + prevents modifying
 *    already-POSTED journal headers or deleting audit/journal history.
 * 4. Allows reconciliation_exceptions.run_id to be NULL when raised by realtime
 *    webhook amount/currency/state mismatches.
 */

export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
export const SYSTEM_CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
export const SYSTEM_CLEARING_WALLET_ID = '00000000-0000-4000-8000-000000000010';
export const SYSTEM_FEE_WALLET_ID = '00000000-0000-4000-8000-000000000011';
export const SYSTEM_SUSPENSE_WALLET_ID = '00000000-0000-4000-8000-000000000012';

export async function up(knex: Knex): Promise<void> {
  // 1. Add wallet_type to wallets and allow system accounts to carry contra/clearing negative balances
  await knex.schema.alterTable('wallets', (t) => {
    t.text('wallet_type').notNullable().defaultTo('CUSTOMER');
  });

  await knex.raw(`
    ALTER TABLE wallets
      DROP CONSTRAINT IF EXISTS wallets_available_balance_minor_check,
      ADD CONSTRAINT wallets_wallet_type_check
        CHECK (wallet_type IN ('CUSTOMER', 'SYSTEM_CLEARING', 'SYSTEM_FEE', 'SYSTEM_SUSPENSE')),
      ADD CONSTRAINT wallets_customer_no_overdraft_check
        CHECK (wallet_type != 'CUSTOMER' OR available_balance_minor >= 0);
  `);

  // 2. Make reconciliation_exceptions.run_id nullable for real-time webhook mismatch exceptions
  await knex.raw(`
    ALTER TABLE reconciliation_exceptions
      ALTER COLUMN run_id DROP NOT NULL;
  `);

  // 3. Upgrade journal balance constraint trigger (INSERT or UPDATE + currency match)
  await knex.raw(`DROP TRIGGER IF EXISTS enforce_journal_balance ON journal_transactions;`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_journal_balance()
    RETURNS TRIGGER AS $$
    DECLARE
      debit_sum BIGINT;
      credit_sum BIGINT;
      entry_count INTEGER;
      distinct_currencies INTEGER;
      mismatched_currency_count INTEGER;
    BEGIN
      IF NEW.status = 'POSTED' THEN
        SELECT
          COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_minor ELSE 0 END), 0),
          COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_minor ELSE 0 END), 0),
          COUNT(*),
          COUNT(DISTINCT currency),
          COALESCE(SUM(CASE WHEN currency != NEW.currency THEN 1 ELSE 0 END), 0)
        INTO debit_sum, credit_sum, entry_count, distinct_currencies, mismatched_currency_count
        FROM ledger_entries
        WHERE journal_transaction_id = NEW.id;

        IF entry_count < 2 THEN
          RAISE EXCEPTION 'A posted journal transaction must have at least 2 entries, found %', entry_count;
        END IF;

        IF distinct_currencies != 1 OR mismatched_currency_count > 0 THEN
          RAISE EXCEPTION 'Journal transaction % entries must all share journal currency %', NEW.id, NEW.currency;
        END IF;

        IF debit_sum != credit_sum THEN
          RAISE EXCEPTION 'Journal transaction % does not balance: debits=% credits=%', NEW.id, debit_sum, credit_sum;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE CONSTRAINT TRIGGER enforce_journal_balance
    AFTER INSERT OR UPDATE ON journal_transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
  `);

  // 4. Prevent mutation/deletion of already POSTED journal headers and audit events
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_posted_journal_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Journal transactions cannot be deleted.';
      END IF;
      IF OLD.status = 'POSTED' THEN
        RAISE EXCEPTION 'Posted journal transaction % is immutable.', OLD.id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER enforce_posted_journal_immutability
    BEFORE UPDATE OR DELETE ON journal_transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_posted_journal_mutation();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_audit_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Audit events are append-only and immutable.';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER enforce_audit_immutability
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  `);

  // 5. Seed deterministic Roles (all 5 roles) & System Clearing Accounts idempotently
  await knex.raw(`
    INSERT INTO roles (name, description) VALUES
      ('CUSTOMER', 'End-user wallet holder'),
      ('SUPPORT_AGENT', 'Customer support and dispute triage'),
      ('OPERATIONS_ANALYST', 'Operations, risk alert review, and reconciliation'),
      ('FINANCE_ADMIN', 'Financial reporting, refunds, and adjustment governance'),
      ('PLATFORM_ADMIN', 'Platform administration, role assignment, and safe configuration')
    ON CONFLICT (name) DO NOTHING;
  `);

  // Password hash is an unusable placeholder ('!LOCKED_SYSTEM_ACCOUNT!') so system user cannot log in
  await knex.raw(
    `
    INSERT INTO users (id, email, password_hash, first_name, last_name, status)
    VALUES (?, 'system@fincore.internal', '!LOCKED_SYSTEM_ACCOUNT!', 'FinCore', 'System', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;
  `,
    [SYSTEM_USER_ID],
  );

  await knex.raw(
    `
    INSERT INTO customer_profiles (id, user_id, display_name, identity_status)
    VALUES (?, ?, 'FinCore Internal Clearing Entity', 'VERIFIED')
    ON CONFLICT (id) DO NOTHING;
  `,
    [SYSTEM_CUSTOMER_ID, SYSTEM_USER_ID],
  );

  await knex.raw(
    `
    INSERT INTO wallets (id, customer_id, wallet_name, currency, status, wallet_type, ledger_balance_minor, available_balance_minor)
    VALUES
      (?, ?, 'System Clearing (INR)', 'INR', 'ACTIVE', 'SYSTEM_CLEARING', 0, 0),
      (?, ?, 'System Fee Revenue (INR)', 'INR', 'ACTIVE', 'SYSTEM_FEE', 0, 0),
      (?, ?, 'System Suspense (INR)', 'INR', 'ACTIVE', 'SYSTEM_SUSPENSE', 0, 0)
    ON CONFLICT (id) DO NOTHING;
  `,
    [SYSTEM_CLEARING_WALLET_ID, SYSTEM_CUSTOMER_ID, SYSTEM_FEE_WALLET_ID, SYSTEM_CUSTOMER_ID, SYSTEM_SUSPENSE_WALLET_ID, SYSTEM_CUSTOMER_ID],
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TRIGGER IF EXISTS enforce_audit_immutability ON audit_events;`);
  await knex.raw(`DROP FUNCTION IF EXISTS prevent_audit_mutation() CASCADE;`);
  await knex.raw(`DROP TRIGGER IF EXISTS enforce_posted_journal_immutability ON journal_transactions;`);
  await knex.raw(`DROP FUNCTION IF EXISTS prevent_posted_journal_mutation() CASCADE;`);
  await knex.raw(`DROP TRIGGER IF EXISTS enforce_journal_balance ON journal_transactions;`);

  await knex('wallets')
    .whereIn('id', [SYSTEM_CLEARING_WALLET_ID, SYSTEM_FEE_WALLET_ID, SYSTEM_SUSPENSE_WALLET_ID])
    .del();
  await knex('customer_profiles').where({ id: SYSTEM_CUSTOMER_ID }).del();
  await knex('users').where({ id: SYSTEM_USER_ID }).del();

  await knex.raw(`
    ALTER TABLE reconciliation_exceptions
      ALTER COLUMN run_id SET NOT NULL;
  `);

  await knex.raw(`
    ALTER TABLE wallets
      DROP CONSTRAINT IF EXISTS wallets_customer_no_overdraft_check,
      DROP CONSTRAINT IF EXISTS wallets_wallet_type_check;
  `);

  await knex.schema.alterTable('wallets', (t) => {
    t.dropColumn('wallet_type');
  });

  await knex.raw(`ALTER TABLE wallets ADD CONSTRAINT wallets_available_balance_minor_check CHECK (available_balance_minor >= 0);`);
}
