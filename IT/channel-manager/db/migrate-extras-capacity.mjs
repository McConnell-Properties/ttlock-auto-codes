#!/usr/bin/env node
// migrate-extras-capacity.mjs
// Creates ExtraCapacity table and seeds the three global resource pools.
//
//   ExtraCapacity(extraId TEXT PRIMARY KEY, capacity INTEGER)
//   Seed: parking=1, vented-ac=2, cooking-pack=5
//
// Idempotent — skips table creation if it exists; uses INSERT OR IGNORE for seeds.
//
// ⚠️  STOP-LIST — prod schema write. Dry-run by default; pass --live to apply.
//
// Usage:
//   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node db/migrate-extras-capacity.mjs
//   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... node db/migrate-extras-capacity.mjs --live

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

const tables = (await db.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='ExtraCapacity'`
)).rows;

const tableExists = tables.length > 0;

const seeds = [
  { extraId: 'parking',      capacity: 1 },
  { extraId: 'vented-ac',    capacity: 2 },
  { extraId: 'cooking-pack', capacity: 5 },
];

if (DRY_RUN) {
  console.log('-- DRY RUN --');
  if (!tableExists) {
    console.log('  CREATE TABLE ExtraCapacity (extraId TEXT PRIMARY KEY, capacity INTEGER NOT NULL)');
  } else {
    console.log('  ExtraCapacity table already exists — skipping CREATE');
  }
  for (const s of seeds) {
    console.log(`  INSERT OR IGNORE INTO ExtraCapacity VALUES ('${s.extraId}', ${s.capacity})`);
  }
  console.log('\nRun with --live to apply. NEEDS-PM sign-off required for prod.');
  db.close();
  process.exit(0);
}

if (!tableExists) {
  await db.execute(
    `CREATE TABLE "ExtraCapacity" (
       "extraId"  TEXT NOT NULL PRIMARY KEY,
       "capacity" INTEGER NOT NULL
     )`
  );
  console.log('Created ExtraCapacity table.');
} else {
  console.log('ExtraCapacity table already exists — skipping CREATE.');
}

for (const s of seeds) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO ExtraCapacity (extraId, capacity) VALUES (?, ?)`,
    args: [s.extraId, s.capacity],
  });
  console.log(`  Seeded ${s.extraId} = ${s.capacity}`);
}

console.log('Migration complete.');
db.close();
