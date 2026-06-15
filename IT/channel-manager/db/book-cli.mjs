// Record an OTA booking that ALREADY EXISTS on the channel (email/extranet
// import) — no availability gate (the OTA accepted it; we must mirror it even
// if it overbooks), queues inventory sync for the OTHER channels automatically.
//
//   node db/book-cli.mjs '{"roomTypeId":12,"guestName":"Jane Doe","checkIn":"2026-06-14","checkOut":"2026-06-16","channel":"booking.com","channelRef":"5591928297","totalPrice":180}'
//
// Optional fields: email, phone, units (1), adults (1), children (0), notes.
// Prints { bookingId, syncJobsQueued } as JSON.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

let b;
try { b = JSON.parse(process.argv[2] || ''); } catch { b = null; }
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
if (!b || !b.roomTypeId || !b.guestName || !dateRe.test(b.checkIn || '') || !dateRe.test(b.checkOut || '') || b.checkOut <= b.checkIn || !b.channel) {
  console.error('usage: node db/book-cli.mjs \'{"roomTypeId":N,"guestName":"…","checkIn":"YYYY-MM-DD","checkOut":"YYYY-MM-DD","channel":"booking.com","channelRef":"…",…}\'');
  process.exit(1);
}

const rt = (await db.execute({
  sql: `SELECT rt.id, rt.propertyId, rt.expediaName, p.bdcHotelId, p.expediaHotelId
        FROM RoomType rt JOIN Property p ON p.id = rt.propertyId WHERE rt.id = ?`,
  args: [Number(b.roomTypeId)],
})).rows[0];
if (!rt) { console.error(`roomTypeId ${b.roomTypeId} not found`); process.exit(1); }

// refuse exact duplicates (same ref + same dates + same room type, still confirmed)
if (b.channelRef) {
  const dup = (await db.execute({
    sql: `SELECT id FROM Booking WHERE channelRef = ? AND status = 'confirmed' AND checkIn = ? AND checkOut = ? AND roomTypeId = ?`,
    args: [b.channelRef, b.checkIn, b.checkOut, Number(b.roomTypeId)],
  })).rows[0];
  if (dup) { console.log(JSON.stringify({ bookingId: dup.id, syncJobsQueued: 0, duplicate: true })); db.close(); process.exit(0); }
}

const ins = await db.execute({
  sql: `INSERT INTO Booking (propertyId, roomTypeId, physicalRoom, guestName, email, phone, checkIn, checkOut, units, adults, children, channel, channelRef, totalPrice, status, notes)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
  args: [rt.propertyId, Number(b.roomTypeId), String(b.guestName), b.email || null, b.phone || null,
         b.checkIn, b.checkOut, Number(b.units) || 1, Math.max(1, Number(b.adults) || 1), Math.max(0, Number(b.children) || 0),
         String(b.channel), b.channelRef || null, b.totalPrice != null ? Number(b.totalPrice) : null,
         b.notes || '[email-import]'],
});
const bookingId = Number(ins.lastInsertRowid);

// queue inventory for the other channels (origin already knows)
const channels = [];
if (rt.bdcHotelId && b.channel !== 'booking.com') channels.push('booking.com');
if (rt.expediaHotelId && rt.expediaName && b.channel !== 'expedia') channels.push('expedia');

let queued = 0;
const d = new Date(b.checkIn + 'T00:00:00Z');
while (d.toISOString().slice(0, 10) < b.checkOut) {
  const date = d.toISOString().slice(0, 10);
  const totals = (await db.execute({
    sql: `SELECT (SELECT totalUnits FROM RoomType WHERE id = ?) -
                 COALESCE((SELECT SUM(units) FROM Booking WHERE status='confirmed' AND roomTypeId=? AND checkIn<=? AND checkOut>?), 0) -
                 COALESCE((SELECT SUM(units) FROM Block WHERE roomTypeId=? AND date=?), 0) AS n`,
    args: [rt.id, rt.id, date, date, rt.id, date],
  })).rows[0];
  const value = String(Math.max(0, Number(totals?.n ?? 0)));
  for (const channel of channels) {
    await db.execute({
      sql: `DELETE FROM SyncJob WHERE roomTypeId=? AND date=? AND channel=? AND field='inventory' AND status='pending'`,
      args: [rt.id, date, channel],
    });
    await db.execute({
      sql: `INSERT INTO SyncJob (channel, roomTypeId, date, field, value) VALUES (?, ?, ?, 'inventory', ?)`,
      args: [channel, rt.id, date, value],
    });
    queued++;
  }
  d.setUTCDate(d.getUTCDate() + 1);
}

console.log(JSON.stringify({ bookingId, syncJobsQueued: queued }));
db.close();
