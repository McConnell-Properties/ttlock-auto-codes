#!/usr/bin/env node
// Additive migration: adds beds24PropId to Property and beds24RoomId to RoomType.
// Idempotent — safe to re-run; duplicate-column errors are caught and ignored.
// Run: node --env-file=.env db/migrate-beds24-ids.mjs
// Does NOT run any UPDATE statements — the ID map must be signed off first.

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

const migrations = [
  `ALTER TABLE "Property" ADD COLUMN "beds24PropId" TEXT`,
  `ALTER TABLE "RoomType"  ADD COLUMN "beds24RoomId" TEXT`,
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

console.log('\nMigration complete. Run UPDATE statements only after Charlie signs off the ID map.');
process.exit(0);
