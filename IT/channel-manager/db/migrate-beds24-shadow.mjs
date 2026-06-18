#!/usr/bin/env node
// Creates Beds24BookingShadow table. Idempotent — safe to re-run.
// node db/migrate-beds24-shadow.mjs  (run from project root, or it loads .env itself)

import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

await db.execute(`
  CREATE TABLE IF NOT EXISTS "Beds24BookingShadow" (
    "beds24Id"   TEXT PRIMARY KEY,
    "propertyId" TEXT,
    "roomTypeId" INTEGER,
    "guestName"  TEXT,
    "checkIn"    TEXT,
    "checkOut"   TEXT,
    "channel"    TEXT,
    "channelRef" TEXT,
    "status"     TEXT,
    "totalPrice" REAL,
    "raw"        TEXT,
    "seenAt"     DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log('OK: Beds24BookingShadow table ready');
process.exit(0);
