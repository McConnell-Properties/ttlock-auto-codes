import { createClient } from '@libsql/client';
import { existsSync, readFileSync } from 'node:fs';
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

const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const checks = [
  { label: 'CrmRecord.updatedAt',      sql: 'SELECT max("updatedAt")  AS ts FROM "CrmRecord"'  },
  { label: 'ExtrasRequest.importedAt', sql: 'SELECT max("importedAt") AS ts FROM "ExtrasRequest"' },
  { label: 'Booking.paidAt',           sql: 'SELECT max("paidAt")     AS ts FROM "Booking"'    },
  { label: 'Booking.createdAt',        sql: 'SELECT max("createdAt")  AS ts FROM "Booking"'    },
  { label: 'SyncJob.doneAt',           sql: 'SELECT max("doneAt")     AS ts FROM "SyncJob"'    },
];

const results = [];
for (const { label, sql } of checks) {
  const rs = await db.execute(sql);
  results.push({ label, ts: rs.rows[0]?.ts ?? null });
}

const width = Math.max(...results.map(r => r.label.length));
for (const { label, ts } of results) {
  console.log(`  ${label.padEnd(width)}  ${ts ?? '(null)'}`);
}

const latest = results.map(r => r.ts).filter(Boolean).sort().at(-1);
console.log(`\nMost recent write across all: ${latest ?? '(none)'}`);
