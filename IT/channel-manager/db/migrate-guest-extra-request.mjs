// Idempotent migration: create GuestExtraRequest table in Turso (and local dev.db).
// The portal writes guest extras directly to this table on Vercel, replacing the
// flat .data/extras-requests.json + CSV approach.
//
//   Cloud:  node db/migrate-guest-extra-request.mjs
//   Local:  node db/migrate-guest-extra-request.mjs --local
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

console.log(`\nmigrate-guest-extra-request → ${useLocal ? 'local dev.db' : url}\n`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS "GuestExtraRequest" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "ref"           TEXT NOT NULL,
    "guestName"     TEXT NOT NULL,
    "extraId"       TEXT NOT NULL,
    "extraName"     TEXT NOT NULL,
    "date"          TEXT,
    "time"          TEXT,
    "nights"        INTEGER,
    "price"         REAL NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'confirmed',
    "stripeSession" TEXT,
    "createdAt"     TEXT NOT NULL
  )
`);
console.log('  table: GuestExtraRequest ready');

await db.execute(`
  CREATE INDEX IF NOT EXISTS "GEReq_ref_idx" ON "GuestExtraRequest"("ref")
`);
console.log('  index: GEReq_ref_idx ready');

const r = await db.execute(`SELECT count(*) AS n FROM GuestExtraRequest`);
console.log(`\nDone. GuestExtraRequest rows: ${r.rows[0].n}`);
db.close();
