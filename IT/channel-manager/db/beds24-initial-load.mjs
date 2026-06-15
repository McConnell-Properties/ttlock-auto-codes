// Initial one-time bulk-load of rates + availability into Beds24.
// Reads RateOverride (falling back to RoomType.basePrice) and computes
// availability (totalUnits − active bookings − Blocks) per date, then POSTs
// to POST /inventory/rooms/calendar.
//
// Usage:
//   node db/beds24-initial-load.mjs           # live run — posts to Beds24
//   node db/beds24-initial-load.mjs --dry-run # print payloads, no POST
//
// ⚠️  ONE-SHOT SCRIPT. Re-running overwrites existing Beds24 calendar data.
//     Run once, then verify with Beds24 Price Check before activating BDC.
//
// Requires: BEDS24_REFRESH_TOKEN, DATABASE_URL, DATABASE_AUTH_TOKEN in .env

import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');

// ── .env loader ───────────────────────────────────────────────────────────────
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const db = createClient({
  url: (process.env.DATABASE_URL || `file:${join(here, 'dev.db')}`),
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

// ── Beds24 client (inline — no TS import possible from .mjs) ──────────────────
const B24_BASE = 'https://api.beds24.com/v2';
let _b24Token = null;
let _b24TokenExp = 0;

async function getB24Token() {
  if (_b24Token && _b24TokenExp - Date.now() > 5 * 60 * 1000) return _b24Token;
  const refreshTok = process.env.BEDS24_REFRESH_TOKEN;
  if (!refreshTok) throw new Error('BEDS24_REFRESH_TOKEN not set');
  const res = await fetch(`${B24_BASE}/authentication/token`, {
    headers: { refreshToken: refreshTok },
  });
  if (!res.ok) throw new Error(`Beds24 token refresh failed: HTTP ${res.status}`);
  const data = await res.json();
  _b24Token = data.token;
  _b24TokenExp = Date.now() + data.expiresIn * 1000;
  return _b24Token;
}

async function b24Post(path, body) {
  const token = await getB24Token();
  const res = await fetch(`${B24_BASE}${path}`, {
    method: 'POST',
    headers: { token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const remaining = Number(res.headers.get('x-five-min-limit-remaining') ?? 100);
  const cost = res.headers.get('x-request-cost') ?? '?';
  const tag = remaining < 20 ? '[BEDS24 RATE LOW]' : '[beds24]';
  console.log(`  ${tag} POST ${path} cost=${cost} remaining=${remaining}`);

  if (remaining < 20) {
    console.log('  Rate limit low — backing off 90s...');
    await new Promise(r => setTimeout(r, 90_000));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beds24 POST ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function isoDate(d) { return d.toISOString().slice(0, 10); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function buildDateList(start, end) {
  const dates = [];
  const d = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  while (d <= e) { dates.push(isoDate(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return dates;
}

// Merge consecutive dates with identical price+numAvail into {from, to} ranges.
function compressToRanges(dates, priceByDate, availByDate) {
  if (dates.length === 0) return [];
  const ranges = [];
  let from = dates[0];
  let price = priceByDate[from];
  let avail = availByDate[from];

  for (let i = 1; i <= dates.length; i++) {
    const d = dates[i];
    const p = priceByDate[d];
    const a = availByDate[d];
    if (d && p === price && a === avail && d === addDays(dates[i - 1], 1)) continue;
    ranges.push({ from, to: dates[i - 1], price1: price, numAvail: avail });
    from = d; price = p; avail = a;
  }
  return ranges;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TODAY = isoDate(new Date());
const HORIZON = addDays(TODAY, 365);

console.log(`=== beds24-initial-load${isDryRun ? ' (DRY RUN)' : ''} — ${TODAY} → ${HORIZON} ===\n`);

// All room types with Beds24 mapping
const roomTypes = (await db.execute(`
  SELECT rt.id, rt.propertyId, rt.name, rt.totalUnits, rt.basePrice,
         CAST(rt.beds24RoomId AS INTEGER) AS beds24RoomId,
         p.beds24PropId
  FROM RoomType rt
  JOIN Property p ON p.id = rt.propertyId
  WHERE rt.beds24RoomId IS NOT NULL AND p.beds24PropId IS NOT NULL
  ORDER BY rt.propertyId, rt.id
`)).rows;

console.log(`Rooms to process: ${roomTypes.length}\n`);

let loaded = 0, errors = 0;

for (const rt of roomTypes) {
  try {
    // All rate overrides for this room in the horizon
    const overrides = (await db.execute({
      sql: `SELECT date, price FROM RateOverride
            WHERE roomTypeId = ? AND date >= ? AND date <= ?`,
      args: [rt.id, TODAY, HORIZON],
    })).rows;
    const priceOverride = Object.fromEntries(overrides.map(r => [r.date, Number(r.price)]));

    // Confirmed bookings that overlap the horizon (to compute availability)
    const bookings = (await db.execute({
      sql: `SELECT checkIn, checkOut, COALESCE(units, 1) AS units FROM Booking
            WHERE status = 'confirmed' AND roomTypeId = ?
              AND checkIn < ? AND checkOut > ?`,
      args: [rt.id, HORIZON, TODAY],
    })).rows;

    // Blocks in the horizon
    const blocks = (await db.execute({
      sql: `SELECT date, COALESCE(units, 1) AS units FROM Block
            WHERE roomTypeId = ? AND date >= ? AND date <= ?`,
      args: [rt.id, TODAY, HORIZON],
    })).rows;
    const blockUnits = {};
    for (const b of blocks) blockUnits[b.date] = (blockUnits[b.date] ?? 0) + Number(b.units);

    // Build per-date price + availability
    const dates = buildDateList(TODAY, HORIZON);
    const priceByDate = {};
    const availByDate = {};

    for (const date of dates) {
      const booked = bookings
        .filter(b => String(b.checkIn) <= date && date < String(b.checkOut))
        .reduce((s, b) => s + Number(b.units), 0);
      const blocked = blockUnits[date] ?? 0;
      priceByDate[date] = priceOverride[date] ?? Number(rt.basePrice);
      availByDate[date] = Math.max(0, Number(rt.totalUnits) - booked - blocked);
    }

    const ranges = compressToRanges(dates, priceByDate, availByDate);
    const payload = [{ roomId: Number(rt.beds24RoomId), calendar: ranges }];

    console.log(`  ${rt.propertyId} rt=${rt.id} beds24=${rt.beds24RoomId} "${rt.name}"`);
    console.log(`    ${dates.length} days → ${ranges.length} ranges | base=${rt.basePrice} | overrides=${overrides.length} | bookings=${bookings.length}`);

    if (isDryRun) {
      // Show up to 4 sample ranges
      for (const r of ranges.slice(0, 4)) {
        console.log(`    [DRY] ${r.from}..${r.to} price1=${r.price1} numAvail=${r.numAvail}`);
      }
      if (ranges.length > 4) console.log(`    [DRY] ... and ${ranges.length - 4} more ranges`);
      loaded++;
    } else {
      await b24Post('/inventory/rooms/calendar', payload);
      loaded++;
      // Small inter-room delay to be gentle on the rate limit
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (err) {
    console.error(`  ERROR ${rt.propertyId} rt=${rt.id}: ${err.message}`);
    errors++;
  }
}

console.log(`\nDone: ${loaded} rooms loaded${isDryRun ? ' (dry-run)' : ''}, ${errors} errors.`);
if (!isDryRun && errors === 0) console.log('✓ All rooms posted. Run Beds24 Price Check to verify before activating BDC.');
db.close();
