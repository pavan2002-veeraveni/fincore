import type { Knex } from 'knex';

/**
 * Migration 005 — Additional Ledger & Security Hardening
 *
 * 1. Block raw INSERT into `ledger_entries` referencing an already-POSTED journal header.
 * 2. Enforce append-only immutability on `dispute_events`.
 * 3. Enforce unique idempotent notification dispatch per `(outbox_event_id, channel)`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_post_posting_ledger_insert()
    RETURNS TRIGGER AS $$
    DECLARE
      journal_status TEXT;
    BEGIN
      SELECT status INTO journal_status
      FROM journal_transactions
      WHERE id = NEW.journal_transaction_id;

      IF journal_status = 'POSTED' THEN
        RAISE EXCEPTION 'Cannot insert entries into already POSTED journal transaction %', NEW.journal_transaction_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER enforce_ledger_entry_not_posted
    BEFORE INSERT ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_post_posting_ledger_insert();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_dispute_event_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Dispute events are append-only and immutable.';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER enforce_dispute_event_immutability
    BEFORE UPDATE OR DELETE ON dispute_events
    FOR EACH ROW EXECUTE FUNCTION prevent_dispute_event_mutation();
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_jobs_outbox_channel_unique
    ON notification_jobs (outbox_event_id, channel)
    WHERE outbox_event_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_notification_jobs_outbox_channel_unique;`);
  await knex.raw(`DROP TRIGGER IF EXISTS enforce_dispute_event_immutability ON dispute_events;`);
  await knex.raw(`DROP FUNCTION IF EXISTS prevent_dispute_event_mutation();`);
  await knex.raw(`DROP TRIGGER IF EXISTS enforce_ledger_entry_not_posted ON ledger_entries;`);
  await knex.raw(`DROP FUNCTION IF EXISTS prevent_post_posting_ledger_insert();`);
}
