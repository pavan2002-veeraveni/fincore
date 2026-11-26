import knex, { type Knex } from 'knex';

let db: Knex | null = null;

export function getDb(): Knex {
  if (!db) {
    db = knex({
      client: 'pg',
      connection: process.env['DATABASE_URL'] || 'postgresql://fincore:fincore_dev@localhost:5432/fincore_dev',
      pool: { min: 2, max: 25, acquireTimeoutMillis: 15000 },
    });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
  }
}

export { Knex };
