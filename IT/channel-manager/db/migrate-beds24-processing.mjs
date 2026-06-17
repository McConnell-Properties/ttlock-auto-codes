#!/usr/bin/env node
// Additive migration: adds processingAt to SyncJob for atomic drainer claim/recovery.
// Idempotent — safe to re-run.
// Run: node db/migrate-beds24-processing.mjs

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

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

// processingAt: timestamp set when a drainer claims a SyncJob row (status → processing).
// Used to detect stale in-flight rows from crashed drainer runs (>10 min → reset to pending).
const migrations = [
  `ALTER TABLE "SyncJob" ADD COLUMN "processingAt" DATETIME`,
];

for (const sql of migrations) {
  try {
    await db.execute(sql);
    console.log('OK:', sql);
  } catch (err) {
    if (err.message?.includes('duplicate column name') || err.message?.includes('already exists')) {
      console.log('SKIP (already exists):', sql);
    } else {
      console.error('FAIL:', sql, '\n', err.message);
      process.exit(1);
    }
  }
}

console.log('\nMigration complete.');
db.close();
process.exit(0);
