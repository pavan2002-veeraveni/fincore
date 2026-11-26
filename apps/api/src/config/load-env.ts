import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

/**
 * Load key=value pairs from nearest `.env` file when not in test mode,
 * without overriding already-set process environment variables.
 */
export function loadLocalEnvFile(): void {
  if (loaded || process.env['NODE_ENV'] === 'test' || process.env['VITEST']) {
    return;
  }
  loaded = true;

  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
  ];

  const envPath = candidates.find((p) => fs.existsSync(p));
  if (!envPath) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
