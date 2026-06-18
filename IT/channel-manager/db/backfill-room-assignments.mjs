// Backfill physicalRoom on confirmed bookings where it is NULL.
// Processes oldest checkIn first; skips already-assigned rows.
// Never reassigns a booking that already has a physical room.
//
//   node db/backfill-room-assignments.mjs --dry-run   # print proposals only
//   node db/backfill-room-assignments.mjs              # write to DB
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
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

const dryRun = process.argv.includes('--dry-run');
if (dryRun) console.log('[dry-run] No changes will be written.\n');

// All confirmed bookings with physicalRoom IS NULL and not manually locked, oldest first
const unassigned = (await db.execute({
  sql: `SELECT b.id, b.roomTypeId, b.propertyId, b.checkIn, b.checkOut, b.guestName, b.channelRef
        FROM Booking b
        WHERE b.status = 'confirmed' AND b.physicalRoom IS NULL AND b.roomTypeId IS NOT NULL AND b.roomLocked = 0
        ORDER BY b.checkIn ASC`,
  args: [],
})).rows;

if (unassigned.length === 0) {
  console.log('No unassigned confirmed bookings found.');
  db.close();
  process.exit(0);
}

console.log(`Found ${unassigned.length} booking(s) with physicalRoom IS NULL.\n`);

let assigned = 0;
let skipped = 0;

for (const booking of unassigned) {
  const rt = (await db.execute({
    sql: `SELECT propertyId, physicalRooms FROM RoomType WHERE id = ?`,
    args: [booking.roomTypeId],
  })).rows[0];

  if (!rt || !rt.physicalRooms) {
    console.log(`  SKIP  booking ${booking.id} (${booking.channelRef ?? 'no-ref'}) — roomType ${booking.roomTypeId} has no physicalRooms`);
    skipped++;
    continue;
  }

  const candidates = String(rt.physicalRooms)
    .split(',').map(r => r.trim()).filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));

  if (candidates.length === 0) {
    console.log(`  SKIP  booking ${booking.id} — no candidates in physicalRooms field`);
    skipped++;
    continue;
  }

  // Occupied rooms for this property/window, excluding this booking itself
  const occupied = (await db.execute({
    sql: `SELECT DISTINCT physicalRoom FROM Booking
          WHERE propertyId = ? AND status = 'confirmed'
            AND checkIn < ? AND checkOut > ?
            AND physicalRoom IS NOT NULL
            AND id != ?`,
    args: [rt.propertyId, booking.checkOut, booking.checkIn, booking.id],
  })).rows.map(r => String(r.physicalRoom));

  const occupiedSet = new Set(occupied);
  const room = candidates.find(r => !occupiedSet.has(r)) ?? null;

  const ref = booking.channelRef ?? `id:${booking.id}`;
  const guest = booking.guestName;
  const dates = `${booking.checkIn}→${booking.checkOut}`;

  if (room === null) {
    console.log(`  FLAG  booking ${booking.id} (${ref}) ${guest} ${dates} — all rooms occupied (overbooking)`);
    skipped++;
    continue;
  }

  console.log(`  ${dryRun ? 'WOULD ASSIGN' : 'ASSIGN'}  booking ${booking.id} (${ref}) ${guest} ${dates} → room ${room}`);

  if (!dryRun) {
    await db.execute({
      sql: `UPDATE Booking SET physicalRoom = ? WHERE id = ? AND physicalRoom IS NULL AND roomLocked = 0`,
      args: [room, booking.id],
    });
  }
  assigned++;
}

console.log(`\nDone. ${assigned} assigned, ${skipped} skipped/flagged.`);
if (dryRun) console.log('Re-run without --dry-run to apply.');
db.close();
