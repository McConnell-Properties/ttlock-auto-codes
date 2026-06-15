// Migration: guest counts on bookings + pricing settings (LOS discounts, guest fees).
// Safe to run repeatedly:  node db/migrate-guests.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

for (const stmt of [
  `ALTER TABLE Booking ADD COLUMN "adults" INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE Booking ADD COLUMN "children" INTEGER NOT NULL DEFAULT 0`,
]) {
  try { await db.execute(stmt); } catch (e) { if (!String(e).includes('duplicate column')) throw e; }
}

await db.execute(`CREATE TABLE IF NOT EXISTS "Setting" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL
)`);

// Direct-booking pricing rules. OTAs are NOT touched by these — their rate
// plans/policies are configured on-platform; we only push base price + inventory.
const pricing = {
  baseOccupancy: 1,
  extraAdultPerNight: 5,
  extraChildPerNight: 2.5,
  // Highest matching tier applies; % off the nightly accommodation total.
  losTiers: [
    { minNights: 7, pct: 35 },
    { minNights: 5, pct: 32 },
    { minNights: 3, pct: 26 },
    { minNights: 2, pct: 20 },
  ],
};
await db.execute({
  sql: `INSERT INTO Setting (key, value) VALUES ('pricing', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  args: [JSON.stringify(pricing)],
});

console.log('Migrated: Booking.adults/children + Setting.pricing');
console.log(JSON.stringify(pricing, null, 1));
db.close();
