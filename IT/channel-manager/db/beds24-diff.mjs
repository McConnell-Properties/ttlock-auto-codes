#!/usr/bin/env node
// T2 diff: compare Beds24BookingShadow vs live Booking table (14-day window).
// Scope: BDC bookings only (hub.channel = 'booking.com').
// Match key: shadow.channelRef = hub.channelRef  (both stored as 'BDC-<number>')
// Reports: matched / shadow-only / hub-only / mismatched-room counts.
// node db/beds24-diff.mjs

import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
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

const dbUrl = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url: dbUrl, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const WINDOW_DAYS = 14;
const since = (() => {
  const d = new Date();
  d.setDate(d.getDate() - WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
})();

console.log(`\nBeds24 T2 Diff — ${WINDOW_DAYS}-day window (checkIn >= ${since})\n`);

// ── Shadow rows in window ─────────────────────────────────────────────────────

const shadowRows = (await db.execute({
  sql: `SELECT beds24Id, propertyId, roomTypeId, channelRef, checkIn, checkOut, status, guestName, totalPrice
        FROM Beds24BookingShadow
        WHERE channel = 'booking.com'
          AND checkIn >= ?
          AND channelRef IS NOT NULL`,
  args: [since],
})).rows;

// ── Hub rows in window ────────────────────────────────────────────────────────

const hubRows = (await db.execute({
  sql: `SELECT id, propertyId, roomTypeId, channelRef, checkIn, checkOut, status, guestName, totalPrice
        FROM Booking
        WHERE channel = 'booking.com'
          AND checkIn >= ?
          AND channelRef IS NOT NULL`,
  args: [since],
})).rows;

// ── Build lookup maps ─────────────────────────────────────────────────────────

const hubByRef = new Map(hubRows.map(r => [r.channelRef, r]));
const shadowByRef = new Map(shadowRows.map(r => [r.channelRef, r]));

// ── Classify ──────────────────────────────────────────────────────────────────

const matched = [];
const mismatchedRoom = [];
const shadowOnly = [];
const hubOnly = [];

for (const s of shadowRows) {
  const h = hubByRef.get(s.channelRef);
  if (!h) {
    shadowOnly.push(s);
  } else if (String(s.roomTypeId) !== String(h.roomTypeId)) {
    mismatchedRoom.push({ shadow: s, hub: h });
  } else {
    matched.push({ shadow: s, hub: h });
  }
}

for (const h of hubRows) {
  if (!shadowByRef.has(h.channelRef)) {
    hubOnly.push(h);
  }
}

// ── Print summary ─────────────────────────────────────────────────────────────

console.log(`Shadow table (BDC, checkIn >= ${since}): ${shadowRows.length} rows`);
console.log(`Hub Booking  (BDC, checkIn >= ${since}): ${hubRows.length} rows`);
console.log('');
console.log(`  MATCHED          : ${matched.length}`);
console.log(`  MISMATCHED ROOM  : ${mismatchedRoom.length}`);
console.log(`  SHADOW-ONLY      : ${shadowOnly.length}  (in Beds24, not in hub)`);
console.log(`  HUB-ONLY         : ${hubOnly.length}   (in hub, not in Beds24)`);
console.log('');

// ── Per-property breakdown ────────────────────────────────────────────────────

const properties = [...new Set([...shadowRows.map(r => r.propertyId), ...hubRows.map(r => r.propertyId)])].sort();
console.log('Per-property (hub BDC bookings in window):');
for (const p of properties) {
  const hCount = hubRows.filter(r => r.propertyId === p).length;
  const sCount = shadowRows.filter(r => r.propertyId === p).length;
  console.log(`  ${String(p).padEnd(12)} hub=${hCount}  shadow=${sCount}`);
}
console.log('');

// ── Detail: mismatched rooms ──────────────────────────────────────────────────

if (mismatchedRoom.length > 0) {
  console.log('MISMATCHED ROOM details:');
  for (const { shadow: s, hub: h } of mismatchedRoom) {
    console.log(`  ${s.channelRef}  ${s.checkIn}  shadow.rtId=${s.roomTypeId} hub.rtId=${h.roomTypeId}`);
  }
  console.log('');
}

// ── Detail: shadow-only ───────────────────────────────────────────────────────

if (shadowOnly.length > 0) {
  console.log('SHADOW-ONLY (in Beds24 but not in hub — may appear after CC-B import):');
  for (const s of shadowOnly) {
    console.log(`  ${s.channelRef}  ${s.checkIn}→${s.checkOut}  ${s.guestName}  status=${s.status}`);
  }
  console.log('');
}

// ── Interpretation note ───────────────────────────────────────────────────────

console.log('NOTE: Hub-only count is expected to be high pre-activation.');
console.log('Beds24 currently holds only the bookings that were manually imported');
console.log('(CC-B initial load). The BDC channel connection is not yet live.');
console.log('Re-run after CC-B completes full import and BDC goes live for a true T2 gate.');
console.log('');
process.exit(0);
