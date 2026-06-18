#!/usr/bin/env node
// Additive migration: adds drift-tracking + manual-diverge columns to Booking.
// Required by beds24-sync-bookings.mjs MODIFY step.
// Idempotent — safe to re-run.
// Run: node db/migrate-beds24-sync-fields.mjs

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

const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

// beds24SyncedRoomId / beds24SyncedPropId: last roomId/propertyId we sent to Beds24
// beds24SyncedCheckIn / beds24SyncedCheckOut: last dates we sent to Beds24
//   NULL = this booking was not pushed by us (native BDC/Airbnb — Beds24 owns it)
// channelDiverged: CMS sets to 1 when a native booking is manually moved;
//   sync script propagates the move then clears to 0
const migrations = [
  `ALTER TABLE "Booking" ADD COLUMN "beds24SyncedRoomId" INTEGER`,
  `ALTER TABLE "Booking" ADD COLUMN "beds24SyncedPropId" INTEGER`,
  `ALTER TABLE "Booking" ADD COLUMN "beds24SyncedCheckIn" TEXT`,
  `ALTER TABLE "Booking" ADD COLUMN "beds24SyncedCheckOut" TEXT`,
  `ALTER TABLE "Booking" ADD COLUMN "channelDiverged" INTEGER NOT NULL DEFAULT 0`,
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
