// READ-ONLY. Baseline of booking.com state in Turso, for the additive BDC
// reconcile. Prints counts + every confirmed booking.com channelRef so the
// sync agent can diff against the new email bookings. Writes nothing.
//   node db/_bdc-baseline.mjs
import { createClient } from '@libsql/client';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

console.log('DB target:', url.startsWith('libsql') ? 'TURSO (cloud)' : url);

const total = (await db.execute("SELECT COUNT(*) n FROM Booking")).rows[0].n;
const conf  = (await db.execute("SELECT COUNT(*) n FROM Booking WHERE status='confirmed'")).rows[0].n;
const bdc   = (await db.execute("SELECT COUNT(*) n FROM Booking WHERE channel='booking.com' AND status='confirmed'")).rows[0].n;
console.log(`Booking rows: total=${total}  confirmed=${conf}  booking.com-confirmed=${bdc}\n`);

const rows = (await db.execute(
  `SELECT channelRef, roomTypeId, checkIn, checkOut, guestName
   FROM Booking WHERE channel='booking.com' AND status='confirmed'
   ORDER BY checkIn`
)).rows;

console.log('--- booking.com confirmed refs (channelRef | roomTypeId | checkIn -> checkOut | guest) ---');
for (const r of rows) {
  console.log(`${r.channelRef ?? '(no ref)'} | rt${r.roomTypeId} | ${r.checkIn} -> ${r.checkOut} | ${r.guestName}`);
}
console.log(`\nTotal booking.com confirmed refs: ${rows.length}`);
db.close();
