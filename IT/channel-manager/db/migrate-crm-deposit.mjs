// Migration: add deposit management fields to CrmRecord. Safe to run repeatedly.
//   node db/migrate-crm-deposit.mjs
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
  [`ALTER TABLE CrmRecord ADD COLUMN "depositStatus" TEXT NOT NULL DEFAULT 'none'`, 'depositStatus'],
  [`ALTER TABLE CrmRecord ADD COLUMN "depositPaymentIntent" TEXT`, 'depositPaymentIntent'],
  [`ALTER TABLE CrmRecord ADD COLUMN "depositAmount" REAL`, 'depositAmount'],
  [`ALTER TABLE CrmRecord ADD COLUMN "depositHoldFlag" TEXT NOT NULL DEFAULT ''`, 'depositHoldFlag'],
  [`ALTER TABLE CrmRecord ADD COLUMN "depositMode" TEXT NOT NULL DEFAULT 'hold'`, 'depositMode'],
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

console.log('CrmRecord deposit fields ready.');
db.close();
