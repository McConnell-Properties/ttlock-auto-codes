// Migration: add check-in ingest fields to CrmRecord. Safe to run repeatedly.
//   node db/migrate-checkin-fields.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

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

const cols = [
  [`ALTER TABLE CrmRecord ADD COLUMN "arrivalTime" TEXT`, 'arrivalTime'],
  [`ALTER TABLE CrmRecord ADD COLUMN "contactMethod" TEXT`, 'contactMethod'],
  [`ALTER TABLE CrmRecord ADD COLUMN "contactValue" TEXT`, 'contactValue'],
  [`ALTER TABLE CrmRecord ADD COLUMN "cardSaved" TEXT NOT NULL DEFAULT ''`, 'cardSaved'],
  [`ALTER TABLE CrmRecord ADD COLUMN "preArrivalCompletedAt" DATETIME`, 'preArrivalCompletedAt'],
  [`ALTER TABLE CrmRecord ADD COLUMN "confirmedAt" DATETIME`, 'confirmedAt'],
  [`ALTER TABLE CrmRecord ADD COLUMN "preArrivalNotes" TEXT`, 'preArrivalNotes'],
];

for (const [sql, name] of cols) {
  try {
    await db.execute(sql);
    console.log(`  + ${name}`);
  } catch (e) {
    if (String(e).includes('duplicate column')) console.log(`  = ${name} (already exists)`);
    else throw e;
  }
}

console.log('CrmRecord check-in fields ready.');
db.close();
