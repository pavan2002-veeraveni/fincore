import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';

function loadDbEnv(): void {
  if (process.env['DATABASE_URL']) return;
  for (const candidate of [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '..', '..', '.env'),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    for (const line of fs.readFileSync(candidate, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    break;
  }
}

loadDbEnv();

const config: Knex.Config = {
  client: 'pg',
  connection: process.env['DATABASE_URL'] || 'postgresql://fincore:fincore_dev@localhost:55432/fincore_dev',
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: './migrations',
    extension: 'ts',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './seeds',
  },
};

export default config;
