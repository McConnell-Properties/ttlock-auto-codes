// Auto-release/refund eligible deposits at checkout+2 days. Skips flagged (damage/review) deposits.
// hold mode  → cancel PI  → depositStatus='released'
// charge mode → refund PI → depositStatus='refunded'
// Run ~every 30 min via launchd:  node db/sync-deposits.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

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

// Match by mode: hold deposits that are still held; charge deposits that are captured (succeeded).
const eligible = (await db.execute(`
  SELECT cr.bookingId, cr.depositPaymentIntent, cr.depositMode, b.guestName, b.checkOut
  FROM CrmRecord cr
  JOIN Booking b ON b.id = cr.bookingId
  WHERE (
    (cr.depositMode = 'hold'   AND cr.depositStatus = 'held')
    OR
    (cr.depositMode = 'charge' AND cr.depositStatus = 'captured')
  )
    AND cr.depositHoldFlag = ''
    AND date(b.checkOut, '+2 days') <= date('now')
`)).rows;

console.log(`Found ${eligible.length} eligible deposit(s).`);

let released = 0, skipped = 0, errors = 0;
for (const r of eligible) {
  if (!r.depositPaymentIntent) {
    console.warn(`  SKIP #${r.bookingId} ${r.guestName}: no PI id stored`);
    skipped++;
    continue;
  }

  const isCharge = r.depositMode === 'charge';
  const endpoint = isCharge
    ? `https://api.stripe.com/v1/refunds`
    : `https://api.stripe.com/v1/payment_intents/${r.depositPaymentIntent}/cancel`;
  const body = isCharge
    ? new URLSearchParams({ payment_intent: String(r.depositPaymentIntent) }).toString()
    : '';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const j = await res.json();

    // Treat already-terminal Stripe states as done — not an error.
    const alreadyTerminal = isCharge
      ? (j.status === 'succeeded' || j.error?.code === 'charge_already_refunded')
      : (j.status === 'canceled' || j.status === 'succeeded' || j.error?.code === 'payment_intent_unexpected_state');

    if (j.error && !alreadyTerminal) {
      console.warn(`  STRIPE_ERR #${r.bookingId} ${r.guestName}: ${j.error.message}`);
      errors++;
      continue;
    }

    const newStatus = isCharge ? 'refunded' : 'released';
    const guardStatus = isCharge ? 'captured' : 'held';

    // Guard: only update if still in the expected status (webhook may have already written the terminal state)
    await db.execute({
      sql: `UPDATE CrmRecord SET depositStatus = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE bookingId = ? AND depositStatus = ?`,
      args: [newStatus, r.bookingId, guardStatus],
    });
    console.log(`  ${newStatus.toUpperCase()} #${r.bookingId} ${r.guestName} (checkout: ${r.checkOut}, mode: ${r.depositMode})`);
    released++;
  } catch (e) {
    console.warn(`  ERROR #${r.bookingId} ${r.guestName}: ${e}`);
    errors++;
  }
}

console.log(`Done: ${released} released/refunded, ${skipped} skipped, ${errors} errors.`);
db.close();
