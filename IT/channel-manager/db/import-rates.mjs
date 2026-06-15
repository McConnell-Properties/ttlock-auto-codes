// Import nightly rates from "Pull pricing data - <Property>.csv" files.
//
// CSV format:
//   row 1: ,1,2,3,...            (physical room numbers)
//   row 2: multipliers           (informational — prices below are final)
//   rows:  YYYY-MM-DD,price,...  (one row per date)
//
// Usage:
//   node db/import-rates.mjs [csvDir] [--no-sync]
//     csvDir    directory containing the CSVs (default: db/pricing)
//     --no-sync import rates only, don't queue price push jobs
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const args = process.argv.slice(2).filter((a) => a !== '--no-sync');
const noSync = process.argv.includes('--no-sync');
const csvDir = args[0] || join(here, 'pricing');

// CSV file name keyword -> property id
const PROPERTY_MAP = {
  fountain: 'tooting', // Fountain = Tooting Stays
  gassiot: 'gassiot',
  streatham: 'streatham',
  valnay: 'valnay',
  tooting: 'tooting',
  seamless: 'seamless',
};

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(',').map((c) => c.trim()));
}

const files = readdirSync(csvDir).filter((f) => f.toLowerCase().endsWith('.csv'));
if (files.length === 0) {
  console.error(`No CSV files found in ${csvDir}`);
  process.exit(1);
}

let totalRates = 0;
let totalJobs = 0;

for (const file of files) {
  const key = Object.keys(PROPERTY_MAP).find((k) => file.toLowerCase().includes(k));
  if (!key) {
    console.warn(`SKIP ${file}: can't match to a property`);
    continue;
  }
  const propertyId = PROPERTY_MAP[key];
  const prop = (await db.execute({ sql: `SELECT * FROM Property WHERE id = ?`, args: [propertyId] })).rows[0];
  if (!prop) {
    console.warn(`SKIP ${file}: property '${propertyId}' not in DB`);
    continue;
  }
  const roomTypes = (await db.execute({
    sql: `SELECT id, name, physicalRooms, expediaName FROM RoomType WHERE propertyId = ?`,
    args: [propertyId],
  })).rows;

  // physical room number -> room type
  const roomToType = new Map();
  for (const rt of roomTypes) {
    for (const r of String(rt.physicalRooms).split(',')) roomToType.set(r.trim(), rt);
  }

  const rows = parseCsv(readFileSync(join(csvDir, file), 'utf8'));
  const header = rows[0]; // ['', '1', '2', ...]

  // column index -> room type (first column of each type wins; prices verified equal within type)
  const colToType = new Map();
  const seenTypes = new Set();
  const unmappedRooms = [];
  for (let c = 1; c < header.length; c++) {
    const roomNo = header[c];
    if (!roomNo) continue;
    const rt = roomToType.get(roomNo);
    if (!rt) {
      if (/^\d+$/.test(roomNo)) unmappedRooms.push(roomNo);
      continue;
    }
    if (!seenTypes.has(rt.id)) {
      colToType.set(c, rt);
      seenTypes.add(rt.id);
    }
  }
  if (unmappedRooms.length) {
    console.warn(`  WARN ${file}: rooms not in mapping: ${unmappedRooms.join(', ')}`);
  }

  const channels = [];
  if (prop.bdcHotelId) channels.push('booking.com');
  if (prop.expediaHotelId) channels.push('expedia');

  const rateStmts = [];
  const jobStmts = [];
  let dates = 0;

  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const date = r[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let rowHadPrice = false;
    for (const [c, rt] of colToType) {
      const raw = r[c];
      if (raw === undefined || raw === '' || raw === '#REF!') continue;
      const price = Number(raw);
      if (!Number.isFinite(price) || price <= 0) continue;
      rowHadPrice = true;
      rateStmts.push({
        sql: `INSERT INTO RateOverride (roomTypeId, date, price) VALUES (?, ?, ?)
              ON CONFLICT(roomTypeId, date) DO UPDATE SET price = excluded.price`,
        args: [rt.id, date, price],
      });
      if (!noSync) {
        for (const channel of channels) {
          if (channel === 'expedia' && !rt.expediaName) continue;
          jobStmts.push({
            sql: `DELETE FROM SyncJob WHERE roomTypeId = ? AND date = ? AND channel = ? AND field = 'price' AND status = 'pending'`,
            args: [rt.id, date, channel],
          });
          jobStmts.push({
            sql: `INSERT INTO SyncJob (channel, roomTypeId, date, field, value) VALUES (?, ?, ?, 'price', ?)`,
            args: [channel, rt.id, date, String(price)],
          });
        }
      }
    }
    if (rowHadPrice) dates++;
  }

  for (const stmts of [rateStmts, jobStmts]) {
    for (let i = 0; i < stmts.length; i += 500) {
      await db.batch(stmts.slice(i, i + 500), 'write');
    }
  }

  totalRates += rateStmts.length;
  totalJobs += jobStmts.length / 2;
  console.log(
    `${file} -> ${prop.name}: ${dates} dates, ${colToType.size} room types, ` +
    `${rateStmts.length} rates${noSync ? '' : `, ${jobStmts.length / 2} price jobs queued`}`
  );
}

console.log(`\nDone. ${totalRates} rates imported${noSync ? '' : `, ${totalJobs} sync jobs queued`}.`);
db.close();
