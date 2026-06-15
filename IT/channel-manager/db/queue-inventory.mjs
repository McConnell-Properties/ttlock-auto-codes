// Inventory reconcile: queue rooms-to-sell pushes for EVERY room type and date
// in a horizon, so the OTAs match the channel manager exactly — without
// touching prices. Use after booking imports, or property-by-property.
//
//   node db/queue-inventory.mjs               # all properties, next 90 days
//   node db/queue-inventory.mjs 180           # next 180 days
//   node db/queue-inventory.mjs 90 tooting    # one property
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

// Load .env so manual runs use Turso, not the local dev.db fallback
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const days = Number(process.argv[2]) || 90;
const onlyProperty = process.argv[3] || null;

const today = new Date().toISOString().slice(0, 10);
const dates = [];
{
  const d = new Date(today + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const roomTypes = (await db.execute({
  sql: `SELECT rt.id, rt.totalUnits, rt.bdcRoomId, rt.expediaName, rt.propertyId,
               p.bdcHotelId, p.expediaHotelId
        FROM RoomType rt JOIN Property p ON p.id = rt.propertyId
        ${onlyProperty ? 'WHERE rt.propertyId = ?' : ''}`,
  args: onlyProperty ? [onlyProperty] : [],
})).rows;

let queued = 0;
for (const rt of roomTypes) {
  const channels = [];
  if (rt.bdcHotelId && rt.bdcRoomId) channels.push('booking.com');
  if (rt.expediaHotelId && rt.expediaName) channels.push('expedia');
  if (channels.length === 0) continue;

  // per-date booked + blocked in one query each
  const booked = (await db.execute({
    sql: `SELECT checkIn, checkOut, units FROM Booking
          WHERE status = 'confirmed' AND roomTypeId = ? AND checkIn < ? AND checkOut > ?`,
    args: [rt.id, dates[dates.length - 1], today],
  })).rows;
  const blocks = (await db.execute({
    sql: `SELECT date, units FROM Block WHERE roomTypeId = ? AND date >= ? AND date <= ?`,
    args: [rt.id, today, dates[dates.length - 1]],
  })).rows;

  const stmts = [];
  for (const date of dates) {
    const b = booked.filter((x) => x.checkIn <= date && date < x.checkOut).reduce((s, x) => s + Number(x.units), 0);
    const bl = blocks.filter((x) => x.date === date).reduce((s, x) => s + Number(x.units), 0);
    const value = String(Math.max(0, Number(rt.totalUnits) - b - bl));
    for (const channel of channels) {
      stmts.push({
        sql: `DELETE FROM SyncJob WHERE roomTypeId = ? AND date = ? AND channel = ? AND field = 'inventory' AND status = 'pending'`,
        args: [rt.id, date, channel],
      });
      stmts.push({
        sql: `INSERT INTO SyncJob (channel, roomTypeId, date, field, value) VALUES (?, ?, ?, 'inventory', ?)`,
        args: [channel, rt.id, date, value],
      });
      queued++;
    }
  }
  for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), 'write');
}

console.log(`Queued ${queued} inventory jobs over ${days} days${onlyProperty ? ` for ${onlyProperty}` : ' (all properties)'}.`);
db.close();

// Touch sentinel so launchd WatchPaths fires sync-inventory immediately
if (queued > 0) {
  const sentinelDir = join(here, '..', 'automation', 'logs');
  mkdirSync(sentinelDir, { recursive: true });
  writeFileSync(join(sentinelDir, '.sync-inventory.trigger'), new Date().toISOString() + '\n');
}
