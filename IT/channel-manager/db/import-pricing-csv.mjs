#!/usr/bin/env node
// import-pricing-csv.mjs — load the Beds24 pricing CSV into RateOverride
//
// Dry-run by default. Pass --live to write.
// Prices already exist in Beds24 from the direct API upload, so SyncJobs are
// skipped (no re-push needed). Only populates the CMS database so the UI
// shows the correct rates.
//
// Usage:
//   node db/import-pricing-csv.mjs [--live] [--csv <path>]

import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { parse } from 'path';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--live');
const csvArg  = args.indexOf('--csv');
const CSV_PATH = csvArg !== -1
  ? args[csvArg + 1]
  : new URL('../../../../../../Downloads/Copy of Pull pricing data - June 10, 10_53 PM - Combined.csv', import.meta.url).pathname;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set. Refusing to run without it.');
  process.exit(1);
}

const db = createClient({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN });

// ── Parse CSV ────────────────────────────────────────────────────────────────

const raw = readFileSync(CSV_PATH, 'utf8');
const rows = raw.split('\n').map(line => line.split(','));

// Header row: col 0 empty, cols 1-N = room name │ beds24RoomId
const headerRow = rows[0];
// beds24 IDs are the last │-separated token in each header cell
const beds24Ids = headerRow.slice(1).map(h => {
  const parts = h.split(/[│|]/).map(s => s.trim());
  return parts[parts.length - 1].replace(/\D/g, '');  // digits only
}).filter(Boolean);

// ── Map beds24RoomId → CMS roomTypeId ───────────────────────────────────────

const rtRows = (await db.execute(
  `SELECT id, beds24RoomId, name FROM RoomType WHERE beds24RoomId IS NOT NULL`
)).rows;

const rtMap = new Map(rtRows.map(r => [String(r.beds24RoomId), { id: Number(r.id), name: String(r.name) }]));

const colToRt = beds24Ids.map(bid => rtMap.get(bid) ?? null);

const unmapped = beds24Ids.filter(bid => !rtMap.has(bid));
if (unmapped.length) {
  console.warn(`WARNING: ${unmapped.length} beds24 room IDs not found in CMS: ${unmapped.join(', ')}`);
}

// ── Build entries ─────────────────────────────────────────────────────────────

const entries = [];
for (const row of rows.slice(1)) {
  const date = row[0]?.trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

  for (let col = 0; col < colToRt.length; col++) {
    const rt = colToRt[col];
    if (!rt) continue;
    const priceStr = row[col + 1]?.trim();
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) continue;
    entries.push({ roomTypeId: rt.id, roomName: rt.name, date, price });
  }
}

console.log(`CSV: ${rows.length - 1} data rows, ${beds24Ids.length} room columns`);
console.log(`Mapped: ${colToRt.filter(Boolean).length}/${beds24Ids.length} rooms`);
console.log(`Entries to upsert: ${entries.length}`);

if (DRY_RUN) {
  console.log('\n-- DRY RUN (first 10 entries) --');
  for (const e of entries.slice(0, 10)) {
    console.log(`  roomTypeId=${e.roomTypeId} (${e.roomName})  date=${e.date}  price=${e.price}`);
  }
  if (entries.length > 10) console.log(`  ... and ${entries.length - 10} more`);
  console.log('\nRun with --live to write to Turso.');
  process.exit(0);
}

// ── Live write ────────────────────────────────────────────────────────────────

console.log('\nWriting to Turso...');
let done = 0;
const CHUNK = 50;
for (let i = 0; i < entries.length; i += CHUNK) {
  const chunk = entries.slice(i, i + CHUNK);
  const stmts = chunk.map(e => ({
    sql: `INSERT INTO RateOverride (roomTypeId, date, price) VALUES (?, ?, ?)
          ON CONFLICT(roomTypeId, date) DO UPDATE SET price = excluded.price`,
    args: [e.roomTypeId, e.date, e.price],
  }));
  await db.batch(stmts, 'write');
  done += chunk.length;
  process.stdout.write(`\r  ${done}/${entries.length}`);
}

console.log(`\nDone. ${done} RateOverride rows upserted.`);
