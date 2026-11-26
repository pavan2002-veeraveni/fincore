import type { Knex } from 'knex';

/**
 * Migration 003 — Payment, Dispute, Reconciliation, Risk, Statements, Notifications
 *
 * Creates: payment_intents, provider_events, refunds, disputes, dispute_events,
 * reconciliation_runs, reconciliation_items, reconciliation_exceptions,
 * risk_assessments, risk_alerts, statements, outbox_events, notification_jobs
 */
export async function up(knex: Knex): Promise<void> {

  // ── Payment Intents ──
  await knex.schema.createTable('payment_intents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').notNullable().references('id').inTable('customer_profiles');
    t.uuid('wallet_id').notNullable().references('id').inTable('wallets');
    t.bigint('amount_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.text('status').notNullable().defaultTo('CREATED');
    t.text('provider_name').nullable(); // 'sandbox', 'razorpay', etc.
    t.text('provider_reference').nullable(); // Provider's order/session ID
    t.text('description').nullable();
    t.uuid('journal_transaction_id').nullable().references('id').inTable('journal_transactions');
    t.jsonb('provider_metadata').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('CREATED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED')");
    t.check('amount_minor > 0');
    t.index(['customer_id', 'status']);
    t.index(['provider_name', 'provider_reference']);
  });

  // ── Provider Events (webhook inbox) ──
  await knex.schema.createTable('provider_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('provider_name').notNullable();
    t.text('provider_event_id').notNullable(); // Provider's unique event ID
    t.text('event_type').notNullable();
    t.text('status').notNullable().defaultTo('RECEIVED');
    t.uuid('payment_intent_id').nullable().references('id').inTable('payment_intents');
    t.jsonb('payload').nullable(); // Safe metadata only
    t.text('signature_valid').nullable();
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('processed_at', { useTz: true }).nullable();

    t.check("status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED')");
    t.unique(['provider_name', 'provider_event_id']); // Deduplication
    t.index(['payment_intent_id']);
  });

  // ── Refunds ──
  await knex.schema.createTable('refunds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('original_transfer_id').nullable().references('id').inTable('transfers');
    t.uuid('original_payment_intent_id').nullable().references('id').inTable('payment_intents');
    t.bigint('amount_minor').notNullable();
    t.string('currency', 3).notNullable();
    t.text('status').notNullable().defaultTo('CREATED');
    t.text('reason').nullable();
    t.uuid('journal_transaction_id').nullable().references('id').inTable('journal_transactions');
    t.uuid('initiated_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('completed_at', { useTz: true }).nullable();

    t.check("status IN ('CREATED', 'PROCESSING', 'COMPLETED', 'FAILED')");
    t.check('amount_minor > 0');
  });

  // ── Disputes ──
  await knex.schema.createTable('disputes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').notNullable().references('id').inTable('customer_profiles');
    t.uuid('transfer_id').nullable().references('id').inTable('transfers');
    t.uuid('payment_intent_id').nullable().references('id').inTable('payment_intents');
    t.text('reason').notNullable();
    t.text('description').nullable();
    t.text('status').notNullable().defaultTo('OPEN');
    t.uuid('assigned_to').nullable().references('id').inTable('users');
    t.text('resolution_notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('resolved_at', { useTz: true }).nullable();

    t.check("status IN ('OPEN', 'UNDER_REVIEW', 'INFORMATION_REQUESTED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED', 'CLOSED')");
    t.index(['customer_id', 'status']);
    t.index(['assigned_to', 'status']);
  });

  // ── Dispute Events (append-only history) ──
  await knex.schema.createTable('dispute_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dispute_id').notNullable().references('id').inTable('disputes');
    t.uuid('actor_id').nullable().references('id').inTable('users');
    t.text('event_type').notNullable(); // STATUS_CHANGE, COMMENT, EVIDENCE, ASSIGNMENT
    t.text('from_status').nullable();
    t.text('to_status').nullable();
    t.text('comment').nullable();
    t.jsonb('metadata').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['dispute_id', 'created_at']);
  });

  // ── Reconciliation Runs ──
  await knex.schema.createTable('reconciliation_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('provider_name').notNullable();
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.integer('total_items').notNullable().defaultTo(0);
    t.integer('matched_count').notNullable().defaultTo(0);
    t.integer('exception_count').notNullable().defaultTo(0);
    t.text('source_file_hash').nullable(); // Checksum of imported file
    t.uuid('initiated_by').notNullable().references('id').inTable('users');
    t.timestamp('started_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')");
  });

  // ── Reconciliation Items ──
  await knex.schema.createTable('reconciliation_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('run_id').notNullable().references('id').inTable('reconciliation_runs').onDelete('CASCADE');
    t.text('item_type').notNullable();
    t.text('provider_reference').nullable();
    t.bigint('provider_amount_minor').nullable();
    t.string('provider_currency', 3).nullable();
    t.timestamp('provider_timestamp', { useTz: true }).nullable();
    t.uuid('internal_reference_id').nullable(); // payment_intent or transfer ID
    t.text('internal_reference_type').nullable();
    t.bigint('internal_amount_minor').nullable();
    t.string('internal_currency', 3).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("item_type IN ('MATCHED', 'MISSING_INTERNAL', 'MISSING_PROVIDER', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE', 'UNKNOWN')");
    t.index(['run_id', 'item_type']);
  });

  // ── Reconciliation Exceptions ──
  await knex.schema.createTable('reconciliation_exceptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('run_id').notNullable().references('id').inTable('reconciliation_runs');
    t.uuid('item_id').nullable().references('id').inTable('reconciliation_items');
    t.text('exception_type').notNullable();
    t.text('description').nullable();
    t.text('status').notNullable().defaultTo('OPEN');
    t.uuid('resolved_by').nullable().references('id').inTable('users');
    t.text('resolution_notes').nullable();
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED')");
    t.index(['run_id', 'status']);
  });

  // ── Risk Assessments ──
  await knex.schema.createTable('risk_assessments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').nullable().references('id').inTable('customer_profiles');
    t.uuid('transaction_id').nullable(); // Generic reference
    t.text('transaction_type').nullable();
    t.integer('score').notNullable(); // 0-100
    t.text('risk_level').notNullable();
    t.jsonb('rule_hits').nullable();
    t.jsonb('explanations').nullable();
    t.text('ruleset_version').notNullable();
    t.timestamp('evaluated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')");
    t.check('score >= 0 AND score <= 100');
    t.index(['customer_id', 'created_at']);
    t.index(['risk_level', 'created_at']);
  });

  // ── Risk Alerts ──
  await knex.schema.createTable('risk_alerts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('assessment_id').notNullable().references('id').inTable('risk_assessments');
    t.uuid('customer_id').nullable().references('id').inTable('customer_profiles');
    t.text('alert_type').notNullable();
    t.text('severity').notNullable();
    t.text('description').notNullable();
    t.text('status').notNullable().defaultTo('OPEN');
    t.uuid('reviewed_by').nullable().references('id').inTable('users');
    t.text('review_notes').nullable();
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('OPEN', 'REVIEWING', 'DISMISSED', 'ESCALATED', 'RESOLVED')");
    t.index(['status', 'created_at']);
    t.index(['customer_id']);
  });

  // ── Statements ──
  await knex.schema.createTable('statements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').notNullable().references('id').inTable('customer_profiles');
    t.uuid('wallet_id').notNullable().references('id').inTable('wallets');
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    t.string('currency', 3).notNullable();
    t.bigint('opening_balance_minor').notNullable();
    t.bigint('closing_balance_minor').notNullable();
    t.integer('transaction_count').notNullable().defaultTo(0);
    t.text('export_format').notNullable().defaultTo('CSV');
    t.text('file_path').nullable();
    t.text('status').notNullable().defaultTo('GENERATING');
    t.timestamp('generated_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('GENERATING', 'READY', 'FAILED', 'EXPIRED')");
    t.index(['customer_id', 'wallet_id']);
  });

  // ── Outbox Events (transactional outbox pattern) ──
  await knex.schema.createTable('outbox_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('event_type').notNullable();
    t.text('aggregate_type').notNullable();
    t.uuid('aggregate_id').notNullable();
    t.jsonb('payload').notNullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.integer('retry_count').notNullable().defaultTo(0);
    t.integer('max_retries').notNullable().defaultTo(5);
    t.timestamp('next_retry_at', { useTz: true }).nullable();
    t.text('error').nullable();
    t.timestamp('processed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')");
    t.index(['status', 'created_at']);
    t.index(['aggregate_type', 'aggregate_id']);
  });

  // ── Notification Jobs ──
  await knex.schema.createTable('notification_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.uuid('outbox_event_id').nullable().references('id').inTable('outbox_events');
    t.text('channel').notNullable(); // EMAIL, SMS
    t.text('template').notNullable();
    t.jsonb('template_data').nullable();
    t.text('recipient').notNullable(); // email or phone
    t.text('status').notNullable().defaultTo('PENDING');
    t.integer('retry_count').notNullable().defaultTo(0);
    t.text('error').nullable();
    t.timestamp('sent_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')");
    t.check("channel IN ('EMAIL', 'SMS')");
    t.index(['status', 'created_at']);
  });

  // Apply updated_at triggers
  for (const table of ['payment_intents', 'disputes']) {
    await knex.raw(`
      CREATE TRIGGER update_${table}_updated_at
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  // ── Ledger entry immutability enforcement ──
  // This trigger prevents UPDATE or DELETE on posted ledger entries
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Ledger entries are immutable after creation. Use compensating transactions for corrections.';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER enforce_ledger_immutability
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();
  `);

  // ── Journal balance enforcement ──
  // Deferred constraint trigger that validates journal balance on posting
  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_journal_balance()
    RETURNS TRIGGER AS $$
    DECLARE
      debit_sum BIGINT;
      credit_sum BIGINT;
      entry_count INTEGER;
    BEGIN
      IF NEW.status = 'POSTED' AND (OLD.status IS NULL OR OLD.status != 'POSTED') THEN
        SELECT
          COALESCE(SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_minor ELSE 0 END), 0),
          COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_minor ELSE 0 END), 0),
          COUNT(*)
        INTO debit_sum, credit_sum, entry_count
        FROM ledger_entries
        WHERE journal_transaction_id = NEW.id;

        IF entry_count < 2 THEN
          RAISE EXCEPTION 'A posted journal transaction must have at least 2 entries, found %', entry_count;
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
    AFTER UPDATE ON journal_transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_journal_balance();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP FUNCTION IF EXISTS prevent_ledger_entry_mutation() CASCADE');
  await knex.raw('DROP FUNCTION IF EXISTS check_journal_balance() CASCADE');

  const tables = [
    'notification_jobs', 'outbox_events', 'statements',
    'risk_alerts', 'risk_assessments',
    'reconciliation_exceptions', 'reconciliation_items', 'reconciliation_runs',
    'dispute_events', 'disputes',
    'refunds', 'provider_events', 'payment_intents',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
