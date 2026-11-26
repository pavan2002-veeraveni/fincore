import type { Knex } from 'knex';

/**
 * Migration 001 — Foundation Tables
 *
 * Creates: users, roles, user_roles, sessions, refresh_tokens,
 * mfa_challenges, customer_profiles, audit_events
 *
 * Design decisions:
 * - UUIDs for all primary keys (gen_random_uuid())
 * - Status columns as TEXT with CHECK constraints (enum-like but migration-friendly)
 * - Timestamps in UTC (timestamptz)
 * - Soft delete via status/deactivated_at, never hard delete for financial/audit records
 * - Password stored as bcrypt hash (60 chars)
 * - Refresh tokens stored as SHA-256 hash
 */
export async function up(knex: Knex): Promise<void> {
  // Enable UUID extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // ── Users ──
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('phone_number', 20).nullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deactivated_at', { useTz: true }).nullable();

    t.check("status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')");
  });

  // ── Roles ──
  await knex.schema.createTable('roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 50).notNullable().unique();
    t.string('description', 255).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("name IN ('CUSTOMER', 'SUPPORT_AGENT', 'OPERATIONS_ANALYST', 'FINANCE_ADMIN', 'PLATFORM_ADMIN')");
  });

  // ── User Roles (many-to-many) ──
  await knex.schema.createTable('user_roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.uuid('granted_by').nullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['user_id', 'role_id']);
  });

  // ── Sessions ──
  await knex.schema.createTable('sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('ip_address', 45).nullable();
    t.string('user_agent', 500).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  // ── Refresh Tokens ──
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('session_id').notNullable().references('id').inTable('sessions').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable().unique(); // SHA-256 hash of token
    t.string('family_id', 64).notNullable(); // For reuse detection
    t.integer('generation').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.boolean('is_used').notNullable().defaultTo(false);
  });

  // ── MFA Challenges (simulated) ──
  await knex.schema.createTable('mfa_challenges', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('action', 100).notNullable(); // e.g., 'TRANSFER', 'BENEFICIARY_CHANGE'
    t.string('code_hash', 128).notNullable(); // SHA-256 hash of simulated code
    t.boolean('verified').notNullable().defaultTo(false);
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('verified_at', { useTz: true }).nullable();
  });

  // ── Customer Profiles ──
  await knex.schema.createTable('customer_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().unique().references('id').inTable('users');
    t.string('display_name', 200).nullable();
    t.date('date_of_birth').nullable();
    t.text('address_line1').nullable();
    t.text('address_line2').nullable();
    t.string('city', 100).nullable();
    t.string('state', 100).nullable();
    t.string('postal_code', 20).nullable();
    t.string('country', 2).notNullable().defaultTo('IN');
    t.text('identity_status').notNullable().defaultTo('UNVERIFIED');
    t.timestamp('identity_verified_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check("identity_status IN ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED')");
  });

  // ── Audit Events (append-only) ──
  await knex.schema.createTable('audit_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('actor_id').nullable().references('id').inTable('users'); // null for system events
    t.text('action').notNullable();
    t.text('resource_type').notNullable();
    t.uuid('resource_id').nullable();
    t.jsonb('details').nullable(); // safe metadata only, no secrets
    t.string('ip_address', 45).nullable();
    t.string('user_agent', 500).nullable();
    t.uuid('request_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Index for querying audit trail
    t.index(['actor_id', 'created_at']);
    t.index(['resource_type', 'resource_id']);
    t.index(['action', 'created_at']);
  });

  // Create updated_at trigger function
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  // Apply updated_at triggers
  for (const table of ['users', 'customer_profiles']) {
    await knex.raw(`
      CREATE TRIGGER update_${table}_updated_at
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'audit_events', 'mfa_challenges', 'refresh_tokens',
    'sessions', 'customer_profiles', 'user_roles', 'roles', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE');
}
