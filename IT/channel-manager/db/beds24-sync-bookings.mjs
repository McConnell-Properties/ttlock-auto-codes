#!/usr/bin/env node
// beds24-sync-bookings.mjs
// Bidirectional hub↔Beds24 booking sync.  Designed to run on a schedule AND
// as the event-driven retry fallback when the API route cannot reach Beds24.
//
// What it does in one run:
//   1. STAMP  — write beds24Id + synced-placement fields from
//               automation/logs/beds24-booking-load.json into DB rows still
//               missing them (idempotent; COALESCE never overwrites set values).
//   2. PUSH   — for every non-native confirmed hub booking still lacking a
//               beds24Id after step 1 → POST /bookings, store beds24Id + synced fields.
//   3. MODIFY — detect drift: non-native bookings where current roomId/dates differ
//               from beds24SyncedRoomId/beds24SyncedCheckIn/beds24SyncedCheckOut,
//               OR any booking with channelDiverged=1 (CMS-flagged native move).
//               Re-POSTs with {id, propertyId, roomId, arrival, departure}.
//               Clears channelDiverged after success.
//   4. CANCEL — for every non-native cancelled hub booking that has a beds24Id
//               → POST /bookings [{id, status:'cancelled'}]
//
// Origin rule (never push native Beds24-channel bookings back):
//   Native = (channel IN ('booking.com','bdc') AND channelRef LIKE 'BDC-%')
//         OR (channel = 'unknown' AND channelRef LIKE 'BDC-%')
//         OR channel = 'airbnb'
//   Non-native = everything else including booking.com with non-BDC- refs.
//   Exception: channelDiverged=1 overrides origin rule for MODIFY only.
//
// Usage:
//   node db/beds24-sync-bookings.mjs            # live
//   node db/beds24-sync-bookings.mjs --dry-run  # print payloads, no writes
//
// Requires: BEDS24_REFRESH_TOKEN, DATABASE_URL, DATABASE_AUTH_TOKEN in .env

import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const isDryRun = process.argv.includes('--dry-run');

// ── env loader ────────────────────────────────────────────────────────────────
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

// ── idempotency log (hubId → beds24Id) ────────────────────────────────────────
const LOG_DIR = join(here, '..', 'automation', 'logs');
const LOG_PATH = join(LOG_DIR, 'beds24-booking-load.json');

function loadLog() {
  if (!existsSync(LOG_PATH)) return {};
  try { return JSON.parse(readFileSync(LOG_PATH, 'utf8')); } catch { return {}; }
}
function saveLog(log) {
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

// ── Beds24 API client ─────────────────────────────────────────────────────────
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
  console.log(`  [b24] POST ${path} cost=${cost} remaining=${remaining}`);
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

// ── Unit auto-assignment ──────────────────────────────────────────────────────
const MULTI_UNIT_ROOMS = new Map([
  [693503, 2], // Streatham Triple (rooms 1,4)
  [693501, 2], // Streatham Quad (rooms 10,11)
  [693505, 2], // Streatham Super King/Twin (rooms 5,6)
  [693499, 2], // Streatham Double Ensuite (rooms 2,3)
  [693520, 3], // Valnay Business Double (rooms 1,3,6)
]);
const _unitCache = new Map();

async function fetchRoomBookings(roomId) {
  if (_unitCache.has(roomId)) return _unitCache.get(roomId);
  const token = await getB24Token();
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 366 * 86400_000).toISOString().slice(0, 10);
  const res = await fetch(
    `${B24_BASE}/bookings?roomId=${roomId}&arrivalFrom=${today}&arrivalTo=${nextYear}`,
    { headers: { token } },
  );
  if (!res.ok) { _unitCache.set(roomId, []); return []; }
  const d = await res.json();
  const bks = (d.data || [])
    .filter(b => b.status !== 'cancelled' && b.unitId)
    .map(b => ({ arrival: b.arrival, departure: b.departure, unitId: b.unitId }));
  _unitCache.set(roomId, bks);
  return bks;
}

async function findFreeUnit(roomId, numUnits, arrival, departure) {
  const booked = await fetchRoomBookings(roomId);
  const taken = new Set(
    booked.filter(b => b.arrival < departure && b.departure > arrival).map(b => b.unitId),
  );
  for (let u = 1; u <= numUnits; u++) {
    if (!taken.has(u)) return u;
  }
  return null;
}

// ── Origin rule helpers ───────────────────────────────────────────────────────
function isNative(channel, channelRef) {
  const ch = (channel || '').toLowerCase();
  const ref = channelRef || '';
  if (ch === 'airbnb') return true;
  if ((ch === 'booking.com' || ch === 'bdc') && ref.startsWith('BDC-')) return true;
  if (ch === 'unknown' && ref.startsWith('BDC-')) return true;
  return false;
}

function mapChannel(channel, channelRef) {
  const ch = (channel || '').toLowerCase();
  const ref = (channelRef || '').toLowerCase();
  if (ch === 'expedia' || ref.startsWith('exp-')) return 'Expedia';
  if (ch === 'airbnb') return 'Airbnb';
  if (ch === 'direct') return 'Direct Booking';
  if (ch === 'extranet') return 'Little Hotelier';
  if (ch === 'import') return 'Channel Manager Import';
  if (ch === 'booking.com') return 'Booking.com (Legacy)';
  return 'Other';
}

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// ── Step 1: STAMP from load log ───────────────────────────────────────────────
async function stampFromLog(log) {
  const entries = Object.entries(log);
  if (entries.length === 0) { console.log('  (log empty, nothing to stamp)'); return 0; }

  // Batch-fetch current placement for all log entries to backfill synced fields.
  // These are all non-native bookings we pushed — safe to set synced fields.
  const hubIds = entries.map(([k]) => Number(k));
  const placeholders = hubIds.map(() => '?').join(',');
  const hubRows = (await db.execute({
    sql: `SELECT b.id, b.checkIn, b.checkOut,
                 CAST(rt.beds24RoomId AS INTEGER) AS beds24RoomId,
                 CAST(p.beds24PropId AS INTEGER) AS beds24PropId
          FROM Booking b
          LEFT JOIN RoomType rt ON rt.id = b.roomTypeId
          LEFT JOIN Property p  ON p.id  = b.propertyId
          WHERE b.id IN (${placeholders})`,
    args: hubIds,
  })).rows;
  const placementMap = Object.fromEntries(hubRows.map(r => [Number(r.id), r]));

  let stamped = 0;
  for (const [hubIdStr, beds24Id] of entries) {
    const hubId = Number(hubIdStr);
    const p = placementMap[hubId];
    if (!isDryRun) {
      // COALESCE preserves already-set values on re-runs
      await db.execute({
        sql: `UPDATE "Booking" SET
                "beds24Id"            = COALESCE("beds24Id", ?),
                "beds24SyncedRoomId"  = COALESCE("beds24SyncedRoomId", ?),
                "beds24SyncedPropId"  = COALESCE("beds24SyncedPropId", ?),
                "beds24SyncedCheckIn" = COALESCE("beds24SyncedCheckIn", ?),
                "beds24SyncedCheckOut"= COALESCE("beds24SyncedCheckOut", ?)
              WHERE id = ?`,
        args: [
          beds24Id,
          p?.beds24RoomId ?? null,
          p?.beds24PropId ?? null,
          p ? String(p.checkIn) : null,
          p ? String(p.checkOut) : null,
          hubId,
        ],
      });
    }
    stamped++;
    if (isDryRun) console.log(`  [DRY STAMP] hub#${hubId} → beds24Id=${beds24Id}`);
  }
  return stamped;
}

// ── Step 2: PUSH new non-native confirmed bookings ────────────────────────────
async function pushNewBookings(log) {
  const rows = (await db.execute(`
    SELECT b.id, b.propertyId, b.roomTypeId, b.guestName, b.email, b.phone,
           b.checkIn, b.checkOut, b.adults, b.children, b.totalPrice,
           b.channel, b.channelRef, b.notes,
           CAST(rt.beds24RoomId AS INTEGER) AS beds24RoomId,
           CAST(p.beds24PropId AS INTEGER) AS beds24PropId
    FROM Booking b
    JOIN RoomType rt ON rt.id = b.roomTypeId
    JOIN Property p  ON p.id  = b.propertyId
    WHERE b.status = 'confirmed'
      AND b.checkOut > date('now')
      AND b."beds24Id" IS NULL
      AND rt.beds24RoomId IS NOT NULL
      AND p.beds24PropId  IS NOT NULL
    ORDER BY b.checkIn
  `)).rows;

  // Apply origin rule in application code (more readable than complex SQL)
  const toSync = rows.filter(r => !isNative(String(r.channel), String(r.channelRef ?? '')));

  if (toSync.length === 0) { console.log('  (no new non-native bookings to push)'); return 0; }

  let pushed = 0, errors = 0;
  for (const bk of toSync) {
    const hubId = Number(bk.id);
    if (log[hubId]) {
      // Already in log but not yet stamped in DB — stamp now, skip POST
      if (!isDryRun) {
        await db.execute({
          sql: `UPDATE "Booking" SET "beds24Id" = ? WHERE id = ?`,
          args: [log[hubId], hubId],
        });
        console.log(`  STAMP (from log) #${hubId} → beds24Id=${log[hubId]}`);
      } else {
        console.log(`  [DRY STAMP-PUSH] #${hubId} → beds24Id=${log[hubId]}`);
      }
      pushed++;
      continue;
    }

    const { firstName, lastName } = splitName(String(bk.guestName));
    const referer = mapChannel(String(bk.channel), String(bk.channelRef ?? ''));
    const notes = [
      `Hub booking #${hubId}`,
      bk.channelRef ? `Ref: ${bk.channelRef}` : null,
      bk.notes ? String(bk.notes).slice(0, 120) : null,
    ].filter(Boolean).join(' | ');

    const roomId = Number(bk.beds24RoomId);
    const numUnits = MULTI_UNIT_ROOMS.get(roomId);
    let unitId;
    if (numUnits) {
      unitId = isDryRun ? 1 : await findFreeUnit(roomId, numUnits, String(bk.checkIn), String(bk.checkOut));
      if (!unitId && !isDryRun) {
        console.warn(`    ⚠ All ${numUnits} units taken for roomId=${roomId} ${bk.checkIn}..${bk.checkOut} — pushing without unitId`);
      }
      if (unitId && !isDryRun) {
        const cached = _unitCache.get(roomId) || [];
        cached.push({ arrival: String(bk.checkIn), departure: String(bk.checkOut), unitId });
        _unitCache.set(roomId, cached);
      }
    }

    const payload = [{
      propertyId: Number(bk.beds24PropId),
      roomId,
      arrival: String(bk.checkIn),
      departure: String(bk.checkOut),
      firstName,
      lastName,
      email: bk.email ? String(bk.email) : '',
      phone: bk.phone ? String(bk.phone) : '',
      numAdult: Number(bk.adults) || 1,
      numChild: Number(bk.children) || 0,
      price: bk.totalPrice != null ? Number(bk.totalPrice) : 0,
      status: 'confirmed',
      referer,
      notes,
      ...(unitId ? { unitId } : {}),
    }];

    console.log(`  PUSH #${hubId} ${bk.channel} ${bk.checkIn}..${bk.checkOut} "${bk.guestName}" → ${referer}${unitId ? ` unit=${unitId}` : ''}`);

    if (isDryRun) {
      console.log(`    [DRY] payload: ${JSON.stringify(payload[0])}`);
      pushed++;
      continue;
    }

    try {
      const result = await b24Post('/bookings', payload);
      const entry = result[0];
      if (entry?.new?.id) {
        const beds24Id = entry.new.id;
        log[hubId] = beds24Id;
        saveLog(log);
        await db.execute({
          sql: `UPDATE "Booking" SET
                  "beds24Id"            = ?,
                  "beds24SyncedRoomId"  = ?,
                  "beds24SyncedPropId"  = ?,
                  "beds24SyncedCheckIn" = ?,
                  "beds24SyncedCheckOut"= ?
                WHERE id = ?`,
          args: [beds24Id, Number(bk.beds24RoomId), Number(bk.beds24PropId), String(bk.checkIn), String(bk.checkOut), hubId],
        });
        console.log(`    → beds24Id=${beds24Id}`);
        pushed++;
      } else {
        console.error(`    ERROR: unexpected response: ${JSON.stringify(result).slice(0, 200)}`);
        errors++;
      }
    } catch (err) {
      console.error(`    ERROR #${hubId}: ${err.message}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, 800));
  }
  return pushed;
}

// ── Step 3: MODIFY in Beds24 when hub booking placement/dates have drifted ────
// Triggers on:
//   (a) non-native bookings where current roomId or dates differ from last-synced state
//   (b) any booking (including native BDC) with channelDiverged=1 — CMS sets this
//       when a manual move must be propagated even for native bookings
// After a successful re-POST, synced fields are updated and channelDiverged cleared.
async function modifyInBeds24() {
  const rows = (await db.execute(`
    SELECT b.id, b."beds24Id", b.channelDiverged, b.channel, b.channelRef,
           b.checkIn, b.checkOut, b.guestName,
           b."beds24SyncedRoomId", b."beds24SyncedCheckIn", b."beds24SyncedCheckOut",
           CAST(rt.beds24RoomId AS INTEGER) AS beds24RoomId,
           CAST(p.beds24PropId AS INTEGER) AS beds24PropId
    FROM Booking b
    JOIN RoomType rt ON rt.id = b.roomTypeId
    JOIN Property p  ON p.id  = b.propertyId
    WHERE b."beds24Id" IS NOT NULL
      AND b.status = 'confirmed'
      AND (
        b.channelDiverged = 1
        OR (
          b."beds24SyncedRoomId" IS NOT NULL
          AND (
            b."beds24SyncedRoomId" != CAST(rt.beds24RoomId AS INTEGER)
            OR b."beds24SyncedCheckIn"  != b.checkIn
            OR b."beds24SyncedCheckOut" != b.checkOut
          )
        )
      )
  `)).rows;

  if (rows.length === 0) { console.log('  (no drift detected, nothing to modify)'); return 0; }

  let modified = 0, errors = 0;
  for (const bk of rows) {
    const beds24Id = Number(bk.beds24Id);
    const beds24RoomId = Number(bk.beds24RoomId);
    const beds24PropId = Number(bk.beds24PropId);
    const isDiverged = Number(bk.channelDiverged) === 1;

    console.log(`  MODIFY hub#${bk.id} beds24Id=${beds24Id} "${bk.guestName}" ${bk.checkIn}..${bk.checkOut}${isDiverged ? ' [channelDiverged]' : ''}`);

    if (isDryRun) {
      console.log(`    [DRY] POST /bookings [{id:${beds24Id}, propertyId:${beds24PropId}, roomId:${beds24RoomId}, arrival:${bk.checkIn}, departure:${bk.checkOut}}]`);
      modified++;
      continue;
    }

    try {
      const result = await b24Post('/bookings', [{
        id: beds24Id,
        propertyId: beds24PropId,
        roomId: beds24RoomId,
        arrival: String(bk.checkIn),
        departure: String(bk.checkOut),
      }]);
      const entry = result[0];
      if (entry?.success) {
        await db.execute({
          sql: `UPDATE "Booking" SET
                  "beds24SyncedRoomId"  = ?,
                  "beds24SyncedPropId"  = ?,
                  "beds24SyncedCheckIn" = ?,
                  "beds24SyncedCheckOut"= ?,
                  "channelDiverged"     = 0
                WHERE id = ?`,
          args: [beds24RoomId, beds24PropId, String(bk.checkIn), String(bk.checkOut), Number(bk.id)],
        });
        console.log(`    → modified in Beds24`);
        modified++;
      } else {
        console.error(`    ERROR: ${JSON.stringify(result).slice(0, 200)}`);
        errors++;
      }
    } catch (err) {
      console.error(`    ERROR hub#${bk.id}: ${err.message}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, 800));
  }
  return modified;
}

// ── Step 4: CANCEL in Beds24 when hub booking is cancelled ───────────────────
async function cancelInBeds24() {
  const rows = (await db.execute(`
    SELECT b.id, b."beds24Id", b.channel, b.channelRef, b.guestName, b.checkIn, b.checkOut
    FROM Booking b
    WHERE b.status = 'cancelled'
      AND b."beds24Id" IS NOT NULL
    ORDER BY b.checkIn
  `)).rows;

  // Only cancel non-native bookings we pushed (native BDC bookings are managed by Beds24)
  const toCancel = rows.filter(r => !isNative(String(r.channel), String(r.channelRef ?? '')));

  if (toCancel.length === 0) { console.log('  (no cancelled bookings to mirror)'); return 0; }

  let cancelled = 0, errors = 0;
  for (const bk of toCancel) {
    const beds24Id = Number(bk.beds24Id);
    console.log(`  CANCEL hub#${bk.id} → beds24Id=${beds24Id} "${bk.guestName}" ${bk.checkIn}..${bk.checkOut}`);

    if (isDryRun) {
      console.log(`    [DRY] POST /bookings [{id: ${beds24Id}, status: 'cancelled'}]`);
      cancelled++;
      continue;
    }

    try {
      const result = await b24Post('/bookings', [{ id: beds24Id, status: 'cancelled' }]);
      const entry = result[0];
      if (entry?.success) {
        console.log(`    → cancelled in Beds24`);
        cancelled++;
      } else {
        console.error(`    ERROR: ${JSON.stringify(result).slice(0, 200)}`);
        errors++;
      }
    } catch (err) {
      console.error(`    ERROR hub#${bk.id}: ${err.message}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, 800));
  }
  return cancelled;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n=== beds24-sync-bookings${isDryRun ? ' (DRY RUN)' : ''} — ${new Date().toISOString()} ===\n`);

const log = loadLog();

// Step 1: Stamp known beds24Ids from load log into DB
console.log('--- Step 1: Stamp from load log ---');
const stamped = await stampFromLog(log);
console.log(`  ${stamped} rows processed from log\n`);

// Re-read DB after stamp so step 2 doesn't double-push
// (the SELECT in pushNewBookings checks beds24Id IS NULL, which is now updated)

// Step 2: Push non-native bookings lacking beds24Id
console.log('--- Step 2: Push new non-native bookings ---');
const pushed = await pushNewBookings(log);
console.log(`  ${pushed} pushed/stamped\n`);

// Step 3: Modify bookings in Beds24 where hub placement/dates have drifted
console.log('--- Step 3: Modify drifted bookings ---');
const modified = await modifyInBeds24();
console.log(`  ${modified} modified\n`);

// Step 4: Cancel bookings in Beds24 that were cancelled in hub
console.log('--- Step 4: Cancel mirrored bookings ---');
const cancelled = await cancelInBeds24();
console.log(`  ${cancelled} cancelled\n`);

console.log(`=== Done: stamped=${stamped}, pushed=${pushed}, modified=${modified}, cancelled=${cancelled} ===`);

db.close();
process.exit(0);
