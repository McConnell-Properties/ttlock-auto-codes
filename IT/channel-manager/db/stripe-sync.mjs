// Poll Stripe for outstanding payment links; mark bookings paid/expired.
// For manual runs or a scheduled task:  node db/stripe-sync.mjs
// Requires STRIPE_SECRET_KEY (reads .env automatically).
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// minimal .env loader (Next loads it for the app; this CLI loads it itself)
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('STRIPE_SECRET_KEY not set'); process.exit(1); }

const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const pending = (await db.execute(
  `SELECT id, guestName, stripeSessionId FROM Booking WHERE stripeSessionId IS NOT NULL AND stripeStatus = 'link_sent'`
)).rows;

let paid = 0, expired = 0;
for (const b of pending) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${b.stripeSessionId}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const s = await res.json();
  if (s.error) { console.warn(`#${b.id} ${b.guestName}: ${s.error.message}`); continue; }
  if (s.payment_status === 'paid') {
    await db.execute({
      sql: `UPDATE Booking SET stripeStatus = 'paid', paidAt = ? WHERE id = ?`,
      args: [new Date().toISOString(), b.id],
    });
    console.log(`PAID    #${b.id} ${b.guestName}`);
    paid++;
  } else if (s.status === 'expired') {
    await db.execute({ sql: `UPDATE Booking SET stripeStatus = 'expired' WHERE id = ?`, args: [b.id] });
    console.log(`EXPIRED #${b.id} ${b.guestName}`);
    expired++;
  }
}
console.log(`Checked ${pending.length}: ${paid} paid, ${expired} expired, ${pending.length - paid - expired} still open.`);
db.close();
