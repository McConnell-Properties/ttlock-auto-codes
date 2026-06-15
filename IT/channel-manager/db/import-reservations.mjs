// Import reservations from a "Room, Check in, Check out" CSV (physical-room based).
// Multi-room rows split into one booking per room; UNALLOCATED kept with null room.
// Does NOT queue sync jobs — these bookings are already reflected on the OTAs.
//
//   node db/import-reservations.mjs [csvPath] [propertyId]
//   defaults: db/reservations-streatham.csv, streatham
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const csvPath = process.argv[2] || join(here, 'reservations-streatham.csv');
const propertyId = process.argv[3] || 'streatham';
const CHANNEL = 'import';

const roomTypes = (await db.execute({
  sql: `SELECT id, name, physicalRooms FROM RoomType WHERE propertyId = ?`, args: [propertyId],
})).rows;
const roomToType = new Map();
for (const rt of roomTypes) {
  for (const r of String(rt.physicalRooms).split(',')) roomToType.set(r.trim(), rt);
}

// Idempotency: clear previous imports for this property before re-importing
await db.execute({
  sql: `DELETE FROM Booking WHERE propertyId = ? AND channel = ?`, args: [propertyId, CHANNEL],
});

const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/);
let imported = 0, unallocated = 0, skipped = 0;
const stays = []; // for overlap report: {room, ci, co}

for (const line of lines.slice(1)) {
  // The room field may itself contain commas ("Room 2, Room 3") — dates are the last 2 columns
  const parts = line.split(',').map((s) => s.trim());
  if (parts.filter(Boolean).length < 3) continue;
  const co = parts.pop();
  const ci = parts.pop();
  const roomField = parts.join(',').replace(/^"|"$/g, '');

  if (!roomField || !/^\d{4}-\d{2}-\d{2}$/.test(ci) || !/^\d{4}-\d{2}-\d{2}$/.test(co) || co <= ci) {
    if (roomField) skipped++;
    continue;
  }

  const roomNames = roomField === 'UNALLOCATED'
    ? [null]
    : roomField.split(',').map((s) => s.trim().replace(/^Room\s+/i, ''));

  for (const room of roomNames) {
    const rt = room ? roomToType.get(room) : null;
    if (room && !rt) { console.warn(`WARN: unknown room '${room}' (${ci})`); skipped++; continue; }
    await db.execute({
      sql: `INSERT INTO Booking (propertyId, roomTypeId, physicalRoom, guestName, checkIn, checkOut, units, channel, notes)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [propertyId, rt ? rt.id : null, room, room ? `Imported — Room ${room}` : 'Imported — UNALLOCATED',
             ci, co, CHANNEL, room ? null : 'UNALLOCATED — needs a room assigned'],
    });
    imported++;
    if (room) stays.push({ room, ci, co }); else unallocated++;
  }
}

// Overlap report (same physical room, overlapping nights)
const overlaps = [];
for (let i = 0; i < stays.length; i++) {
  for (let j = i + 1; j < stays.length; j++) {
    const a = stays[i], b = stays[j];
    if (a.room === b.room && a.ci < b.co && b.ci < a.co) {
      overlaps.push(`Room ${a.room}: ${a.ci}→${a.co} overlaps ${b.ci}→${b.co}`);
    }
  }
}

console.log(`Imported ${imported} bookings (${unallocated} unallocated, ${skipped} skipped).`);
if (overlaps.length) {
  console.log(`\nOVERLAPS to resolve (${overlaps.length}):`);
  overlaps.forEach((o) => console.log(' -', o));
}
db.close();
