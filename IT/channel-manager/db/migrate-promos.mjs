// Migration: pricing config v2 — direct-booking discount + promo codes.
// Safe to run repeatedly:  node db/migrate-promos.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

await db.execute(`CREATE TABLE IF NOT EXISTS "Setting" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL
)`);

const pricing = {
  baseOccupancy: 1,
  extraAdultPerNight: 5,
  extraChildPerNight: 2.5,
  // Direct bookings are 5% cheaper than OTA prices (applied to nightly rates,
  // before LOS). OTA pushes always use the raw sheet price — this only affects
  // direct quotes/bookings.
  directDiscountPct: 5,
  // Highest matching tier applies; % off after the direct discount.
  losTiers: [
    { minNights: 7, pct: 35 },
    { minNights: 5, pct: 32 },
    { minNights: 3, pct: 26 },
    { minNights: 2, pct: 20 },
  ],
  // Promo codes stack ON TOP of direct + LOS discounts.
  // kinds: amount_off (subtract £value) | set_total (final price = £value)
  promoCodes: {
    test: { kind: 'set_total', value: 1, note: 'website testing only — REMOVE before launch' },
    extend: { kind: 'amount_off', value: 5 },
  },
};
await db.execute({
  sql: `INSERT INTO Setting (key, value) VALUES ('pricing', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  args: [JSON.stringify(pricing)],
});

console.log('pricing config v2 written:');
console.log(JSON.stringify(pricing, null, 1));
db.close();
