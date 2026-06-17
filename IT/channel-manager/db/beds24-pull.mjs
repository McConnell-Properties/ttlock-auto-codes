#!/usr/bin/env node
// Poll Beds24 GET /bookings?modifiedFrom=<lastRun>, write to live Booking table.
// Match existing hub bookings by channelRef → stamp beds24Id (no dup).
// New native-channel bookings → INSERT with auto-assigned physical room.
// Cancelled Beds24 bookings → cancel matching hub booking.
// Also dual-writes to Beds24BookingShadow for the diff tool.
// State: automation/logs/.beds24-pull.last  (ISO-8601 datetime, no ms, no Z)
// node db/beds24-pull.mjs

import { createClient } from '@libsql/client';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const REFRESH_TOKEN = process.env.BEDS24_REFRESH_TOKEN;
if (!REFRESH_TOKEN) { console.error('BEDS24_REFRESH_TOKEN not set'); process.exit(1); }

const dbUrl = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url: dbUrl, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const BASE = 'https://api.beds24.com/v2';
const GRACE_MS = 5 * 60 * 1000;
const LAST_RUN_PATH = join(here, '..', 'automation', 'logs', '.beds24-pull.last');
const PAGE_SIZE = 100;

// Beds24 channels that originate IN Beds24 (inbound-only, never re-mirror out)
const NATIVE_CHANNELS = new Set(['booking.com', 'airbnb', 'expedia']);

// ── beds24Id migration (idempotent) ───────────────────────────────────────────

try {
  await db.execute(`ALTER TABLE "Booking" ADD COLUMN "beds24Id" TEXT`);
  console.log('Migration: beds24Id column added to Booking table.');
} catch (e) {
  if (!String(e).includes('duplicate column name')) throw e;
}

// ── Token management ──────────────────────────────────────────────────────────

let cachedToken = null;
let cachedExpiresAt = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && cachedExpiresAt - now > GRACE_MS) return cachedToken;

  const row = (await db.execute(`SELECT value FROM Setting WHERE key = 'beds24_token'`)).rows[0];
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed.expiresAt - now > GRACE_MS) {
        cachedToken = parsed.token;
        cachedExpiresAt = parsed.expiresAt;
        return cachedToken;
      }
    } catch {}
  }

  const res = await fetch(`${BASE}/authentication/token`, { headers: { refreshToken: REFRESH_TOKEN } });
  if (!res.ok) throw new Error(`Beds24 token refresh: HTTP ${res.status}`);
  const data = await res.json();
  cachedToken = data.token;
  cachedExpiresAt = now + data.expiresIn * 1000;
  await db.execute({
    sql: `INSERT INTO Setting (key, value) VALUES ('beds24_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [JSON.stringify({ token: cachedToken, expiresAt: cachedExpiresAt })],
  });
  return cachedToken;
}

// ── API helper ────────────────────────────────────────────────────────────────

async function b24Get(path, params) {
  const token = await getToken();
  const defined = Object.entries(params).filter(([, v]) => v !== undefined);
  const qs = defined.length ? '?' + new URLSearchParams(defined.map(([k, v]) => [k, String(v)])).toString() : '';
  const res = await fetch(`${BASE}${path}${qs}`, { headers: { token } });

  const remaining = res.headers.get('x-five-min-limit-remaining');
  const cost = res.headers.get('x-request-cost');
  const tag = remaining !== null && Number(remaining) < 20 ? '[BEDS24 RATE LOW]' : '[beds24]';
  console.log(`${tag} GET ${path} cost=${cost ?? '?'} remaining=${remaining ?? '?'}`);
  if (remaining !== null && Number(remaining) < 20) {
    console.warn('Rate limit low — stopping pagination early to preserve credits');
    return null;
  }

  if (res.status === 401) { cachedToken = null; cachedExpiresAt = 0; throw new Error('Beds24 401: token rejected'); }
  if (!res.ok) throw new Error(`Beds24 GET ${path}: HTTP ${res.status}`);
  return res.json();
}

// ── Field mapping ─────────────────────────────────────────────────────────────

function mapChannel(b) {
  if (b.channel === 'booking') return 'booking.com';
  if (b.channel === 'airbnb') return 'airbnb';
  if (b.channel === 'expedia') return 'expedia';
  if (b.channel === 'direct') return 'direct';
  return b.apiSource || b.channel || 'unknown';
}

function mapBooking(b, propMap, roomMap) {
  const channel = mapChannel(b);
  const channelRef = channel === 'booking.com' && b.apiReference ? 'BDC-' + b.apiReference : (b.apiReference || null);
  const propId = propMap.get(String(b.propertyId)) ?? null;
  const rtId = roomMap.get(String(b.roomId)) ?? null;
  const guestName = [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || null;
  return {
    beds24Id: String(b.id),
    propertyId: propId,
    roomTypeId: rtId,
    guestName,
    checkIn: b.arrival ?? null,
    checkOut: b.departure ?? null,
    channel,
    channelRef,
    status: b.status ?? null,
    totalPrice: typeof b.price === 'number' ? b.price : null,
    raw: JSON.stringify(b),
  };
}

// ── Room auto-assignment (mirrors lib/allocate.ts) ────────────────────────────

async function assignRoom(roomTypeId, checkIn, checkOut) {
  const rt = (await db.execute({
    sql: `SELECT propertyId, physicalRooms FROM RoomType WHERE id = ?`,
    args: [roomTypeId],
  })).rows[0];
  if (!rt || !rt.physicalRooms) return null;

  const candidates = String(rt.physicalRooms)
    .split(',').map(r => r.trim()).filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
  if (!candidates.length) return null;

  // Query by propertyId so cross-room-type occupancy is detected correctly
  const occupied = (await db.execute({
    sql: `SELECT DISTINCT physicalRoom FROM Booking
          WHERE propertyId = ? AND status = 'confirmed'
            AND checkIn < ? AND checkOut > ?
            AND physicalRoom IS NOT NULL`,
    args: [rt.propertyId, checkOut, checkIn],
  })).rows.map(r => String(r.physicalRoom));

  const occupiedSet = new Set(occupied);
  return candidates.find(r => !occupiedSet.has(r)) ?? null;
}

// ── ID maps ───────────────────────────────────────────────────────────────────

const propRows = (await db.execute(`SELECT beds24PropId, id FROM Property WHERE beds24PropId IS NOT NULL`)).rows;
const propMap = new Map(propRows.map(r => [String(r.beds24PropId), r.id]));

const rtRows = (await db.execute(`SELECT beds24RoomId, id FROM RoomType WHERE beds24RoomId IS NOT NULL`)).rows;
const roomMap = new Map(rtRows.map(r => [String(r.beds24RoomId), r.id]));

console.log(`ID maps loaded: ${propMap.size} properties, ${roomMap.size} room types`);

// ── Last-run timestamp ────────────────────────────────────────────────────────

let lastRun = null;
if (existsSync(LAST_RUN_PATH)) {
  try { lastRun = readFileSync(LAST_RUN_PATH, 'utf8').trim() || null; } catch {}
}
if (!lastRun) {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  lastRun = d.toISOString(); // full ISO-8601 UTC with Z — Beds24 requires the Z to honour the filter
  console.log('No prior run found — defaulting to 90 days ago');
}
console.log(`Polling bookings modified since: ${lastRun}`);

// ── Pull, process, dual-write ─────────────────────────────────────────────────

const SHADOW_UPSERT = `
  INSERT INTO Beds24BookingShadow
    (beds24Id, propertyId, roomTypeId, guestName, checkIn, checkOut,
     channel, channelRef, status, totalPrice, raw, seenAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(beds24Id) DO UPDATE SET
    propertyId = excluded.propertyId,
    roomTypeId = excluded.roomTypeId,
    guestName  = excluded.guestName,
    checkIn    = excluded.checkIn,
    checkOut   = excluded.checkOut,
    channel    = excluded.channel,
    channelRef = excluded.channelRef,
    status     = excluded.status,
    totalPrice = excluded.totalPrice,
    raw        = excluded.raw,
    seenAt     = CURRENT_TIMESTAMP
`.trim();

const runStart = new Date().toISOString(); // full ISO-8601 UTC with Z
let totalFetched = 0;
let stamped = 0;    // existing hub booking → beds24Id set
let created = 0;    // new booking created in hub
let cancelled = 0;  // hub booking cancelled because Beds24 says cancelled
let skipped = 0;    // non-native or already processed
let warnCount = 0;
let firstId = undefined;

async function processBooking(m) {
  // Shadow table always gets the record (diff tool depends on it)
  await db.execute({
    sql: SHADOW_UPSERT,
    args: [m.beds24Id, m.propertyId, m.roomTypeId, m.guestName, m.checkIn,
           m.checkOut, m.channel, m.channelRef, m.status, m.totalPrice, m.raw],
  });

  // Only ingest native Beds24-channel bookings into the live hub
  if (!NATIVE_CHANNELS.has(m.channel)) {
    skipped++;
    return;
  }

  if (!m.propertyId) {
    console.warn(`  WARN: beds24Id=${m.beds24Id} propId not in propMap — skipping live write`);
    warnCount++;
    return;
  }

  // Try to find existing hub booking by channelRef
  let hubRow = null;
  if (m.channelRef) {
    const rows = (await db.execute({
      sql: `SELECT id, status, beds24Id FROM Booking WHERE channelRef = ? LIMIT 1`,
      args: [m.channelRef],
    })).rows;
    hubRow = rows[0] ?? null;
  }

  if (m.status === 'cancelled') {
    if (!hubRow) { skipped++; return; }  // never in hub, nothing to cancel
    if (hubRow.beds24Id && hubRow.status === 'cancelled') { skipped++; return; }  // already done
    await db.execute({
      sql: `UPDATE Booking SET status = 'cancelled', beds24Id = ? WHERE id = ?`,
      args: [m.beds24Id, hubRow.id],
    });
    cancelled++;
    console.log(`  CANCELLED hub booking id=${hubRow.id} channelRef=${m.channelRef}`);
    return;
  }

  // confirmed booking
  if (hubRow) {
    if (hubRow.beds24Id) { skipped++; return; }  // already stamped
    await db.execute({
      sql: `UPDATE Booking SET beds24Id = ? WHERE id = ?`,
      args: [m.beds24Id, hubRow.id],
    });
    stamped++;
    return;
  }

  // Genuinely new booking — create in hub with auto-assigned room
  let physicalRoom = null;
  if (m.roomTypeId) {
    physicalRoom = await assignRoom(m.roomTypeId, m.checkIn, m.checkOut);
  } else {
    console.warn(`  WARN: beds24Id=${m.beds24Id} roomId not in roomMap — inserting unassigned`);
    warnCount++;
  }

  await db.execute({
    sql: `INSERT INTO Booking
            (propertyId, roomTypeId, physicalRoom, guestName, checkIn, checkOut,
             units, channel, channelRef, totalPrice, status, notes, beds24Id)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'confirmed', '[beds24]', ?)`,
    args: [m.propertyId, m.roomTypeId, physicalRoom, m.guestName,
           m.checkIn, m.checkOut, m.channel, m.channelRef, m.totalPrice, m.beds24Id],
  });
  created++;
  console.log(`  CREATED hub booking beds24Id=${m.beds24Id} channelRef=${m.channelRef} room=${physicalRoom ?? 'unassigned'}`);
}

while (true) {
  const params = { modifiedFrom: lastRun, count: PAGE_SIZE };
  if (firstId !== undefined) params.firstId = firstId;

  const resp = await b24Get('/bookings', params);
  if (!resp) break;

  const bookings = resp.data ?? [];
  if (bookings.length === 0) { console.log('No (more) bookings returned — done.'); break; }
  totalFetched += bookings.length;

  for (const b of bookings) {
    const m = mapBooking(b, propMap, roomMap);
    await processBooking(m);
  }

  console.log(`  Page ${Math.ceil(totalFetched / PAGE_SIZE)}: ${bookings.length} rows (total fetched: ${totalFetched})`);

  if (bookings.length < PAGE_SIZE) break;
  firstId = bookings[bookings.length - 1].id;
}

writeFileSync(LAST_RUN_PATH, runStart);
console.log(`\nDone: fetched ${totalFetched} | stamped=${stamped} created=${created} cancelled=${cancelled} skipped=${skipped} warnings=${warnCount}`);
console.log(`Next run will poll from: ${runStart}`);
process.exit(0);
