#!/usr/bin/env node
// migrate-booking-origin.mjs
// Adds three columns to Booking to track where a booking was before its first move:
//   originPropertyId    TEXT
//   originRoomTypeId    INTEGER
//   originPhysicalRoom  TEXT
//
// Additive + idempotent — uses PRAGMA table_info to skip columns that already exist.
// Does NOT touch channelDiverged (already added by migrate-beds24-sync-fields.mjs).
//
// ⚠️  STOP-LIST — prod schema write. Dry-run by default; pass --live to apply.
//
// Usage:
//   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node db/migrate-booking-origin.mjs
//   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node db/migrate-booking-origin.mjs --live

import { createClient } from '@libsql/client';

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set. Refusing to run without it.');
  process.exit(1);
}

const DRY_RUN = !process.argv.includes('--live');

const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

const existing = new Set(
  (await db.execute(`PRAGMA table_info("Booking")`)).rows.map((r) => String(r.name))
);

const toAdd = [
  { col: 'originPropertyId',   sql: 'ALTER TABLE "Booking" ADD COLUMN "originPropertyId"   TEXT' },
  { col: 'originRoomTypeId',   sql: 'ALTER TABLE "Booking" ADD COLUMN "originRoomTypeId"   INTEGER' },
  { col: 'originPhysicalRoom', sql: 'ALTER TABLE "Booking" ADD COLUMN "originPhysicalRoom" TEXT' },
].filter(({ col }) => !existing.has(col));

if (toAdd.length === 0) {
  console.log('Already migrated — all three origin columns present.');
  db.close();
  process.exit(0);
}

console.log(`Columns to add: ${toAdd.map((x) => x.col).join(', ')}`);

if (DRY_RUN) {
  console.log('\n-- DRY RUN --');
  for (const { sql } of toAdd) console.log(' ', sql);
  console.log('\nRun with --live to apply. NEEDS-PM sign-off required for prod.');
  db.close();
  process.exit(0);
}

for (const { col, sql } of toAdd) {
  await db.execute(sql);
  console.log(`  Added column: ${col}`);
}

console.log('Migration complete.');
db.close();
