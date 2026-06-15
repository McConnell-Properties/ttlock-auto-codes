// Migration: Stripe payment-link fields on Booking. Safe to run repeatedly.
//   node db/migrate-stripe.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

for (const stmt of [
  `ALTER TABLE Booking ADD COLUMN "stripeSessionId" TEXT`,
  `ALTER TABLE Booking ADD COLUMN "stripePaymentUrl" TEXT`,
  `ALTER TABLE Booking ADD COLUMN "stripeStatus" TEXT`, // link_sent | paid | expired
  `ALTER TABLE Booking ADD COLUMN "paidAt" TEXT`,
]) {
  try { await db.execute(stmt); } catch (e) { if (!String(e).includes('duplicate column')) throw e; }
}

await db.execute(`CREATE TABLE IF NOT EXISTS "Setting" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL
)`);

// Per-property guest-portal success pages (from the check-in portals).
// Guests land here after paying. CONFIRM these with Charlie.
const stripeCfg = {
  successUrls: {
    streatham: 'https://streathamrooms.co.uk/check-in.html?payment=success',
    tooting: 'https://tooting-stays.com/check-in.html?payment=success',
    gassiot: 'https://gassiothouse.co.uk/check-in.html?payment=success',
    valnay: 'https://guestonlyhotels.co.uk/check-in.html?payment=success',
    default: 'https://streathamrooms.co.uk/check-in.html?payment=success',
  },
  linkExpiryHours: 24,
};
await db.execute({
  sql: `INSERT INTO Setting (key, value) VALUES ('stripe', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  args: [JSON.stringify(stripeCfg)],
});

console.log('Migrated: Booking stripe columns + Setting.stripe');
console.log('Required env vars (add to .env): STRIPE_SECRET_KEY, GMAIL_USER, GMAIL_APP_PASSWORD');
db.close();
