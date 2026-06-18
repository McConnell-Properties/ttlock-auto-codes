// Idempotent migration: add lockCode column to Booking table.
// Run once vs cloud:  node db/migrate-booking-lockcode.mjs
// Run once vs local:  node db/migrate-booking-lockcode.mjs --local
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const useLocal = process.argv.includes('--local');
const url = useLocal ? `file:${join(here, 'dev.db')}` : process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const db = createClient({ url, authToken: useLocal ? undefined : process.env.DATABASE_AUTH_TOKEN });

async function migrate() {
  console.log(`\nmigrate-booking-lockcode → ${useLocal ? 'local dev.db' : url}\n`);

  try {
    await db.execute(`ALTER TABLE Booking ADD COLUMN lockCode TEXT`);
    console.log('  added: lockCode');
  } catch (e) {
    if (String(e).includes('duplicate column name')) {
      console.log('  exists (ok): lockCode');
    } else {
      throw e;
    }
  }

  const r = await db.execute(`SELECT count(*) AS n FROM Booking`);
  console.log(`\nDone. Booking rows: ${r.rows[0].n}`);
}

migrate().catch((e) => { console.error(e); process.exit(1); });
