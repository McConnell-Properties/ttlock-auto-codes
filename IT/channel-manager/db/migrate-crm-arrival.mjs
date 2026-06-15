// Idempotent migration: add TTLock arrival-detection columns to CrmRecord.
// Run once vs cloud:  node db/migrate-crm-arrival.mjs
// Run once vs local:  DATABASE_URL=file:./dev.db node db/migrate-crm-arrival.mjs
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

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const alters = [
  `ALTER TABLE CrmRecord ADD COLUMN "arrivedDetected" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE CrmRecord ADD COLUMN "arrivedAt" DATETIME`,
  `ALTER TABLE CrmRecord ADD COLUMN "arrivedSource" TEXT NOT NULL DEFAULT ''`,
];

for (const sql of alters) {
  const col = sql.match(/"(\w+)"/)[1];
  try {
    await db.execute(sql);
    console.log(`  added: ${col}`);
  } catch (e) {
    if (String(e.message).toLowerCase().includes('duplicate column name')) {
      console.log(`  exists (ok): ${col}`);
    } else {
      throw e;
    }
  }
}

const r = await db.execute("SELECT count(*) AS n FROM CrmRecord");
console.log(`\nDone. CrmRecord rows: ${r.rows[0].n}`);
