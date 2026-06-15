// Poll the booking-site agent's extras file and turn rows into CRM ops tasks.
// Contract: .data/extras-requests.csv with headers including
//   booking_reference, extra, date, time, nights, price, status
// Rows attach to reservations via Booking.channelRef = booking_reference.
// Dedupe key: (booking_reference, extra, date, time) — re-running is safe.
//
//   node db/import-extras.mjs [csvPath]     (or set EXTRAS_CSV)
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const candidates = [
  process.argv[2],
  process.env.EXTRAS_CSV,
  join(here, '..', '.data', 'extras-requests.csv'),
  join(here, '..', '..', 'booking-site', '.data', 'extras-requests.csv'), // booking-site
  join(here, '..', '..', '..', '.data', 'extras-requests.csv'), // ttlock root
  join(here, '..', '..', '..', 'special quote', '.data', 'extras-requests.csv'),
].filter(Boolean);
const csvPath = candidates.find((p) => existsSync(p));
if (!csvPath) {
  console.log('extras-requests.csv not found (no extras submitted yet). Looked in:\n  ' + candidates.join('\n  '));
  process.exit(0);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const records = parseCsv(readFileSync(csvPath, 'utf8'));
console.log(`read ${records.length} rows from ${csvPath}`);

let added = 0, matched = 0, unmatched = 0, dup = 0;
for (const r of records) {
  const ref = r.booking_reference || r.bookingreference || r.ref;
  const extra = r.extra || r.extras || r.item;
  if (!ref || !extra) continue;

  const booking = (await db.execute({
    sql: `SELECT id FROM Booking WHERE channelRef = ?`, args: [ref],
  })).rows[0];

  try {
    await db.execute({
      sql: `INSERT INTO ExtrasRequest (bookingReference, bookingId, extra, date, time, nights, price, sourceStatus, raw)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        ref,
        booking ? booking.id : null,
        extra,
        r.date || null,
        r.time || null,
        r.nights ? Number(r.nights) : null,
        r.price ? Number(String(r.price).replace(/[£$]/g, '')) : null,
        r.status || null,
        JSON.stringify(r),
      ],
    });
    added++;
    if (booking) matched++; else unmatched++;
  } catch (e) {
    if (String(e).includes('UNIQUE')) dup++; else throw e;
  }
}

// late-match: attach previously unmatched rows if their booking has since arrived
const fixed = await db.execute(
  `UPDATE ExtrasRequest SET bookingId = (SELECT id FROM Booking WHERE Booking.channelRef = ExtrasRequest.bookingReference)
   WHERE bookingId IS NULL AND EXISTS (SELECT 1 FROM Booking WHERE Booking.channelRef = ExtrasRequest.bookingReference)`
);

console.log(`added ${added} (${matched} matched, ${unmatched} unmatched), ${dup} already imported, ${fixed.rowsAffected} late-matched`);
db.close();
