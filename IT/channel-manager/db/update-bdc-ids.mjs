// One-off: fill in BDC hotel/room IDs scraped from the extranet Property Layout pages (2026-06-12).
// Also restructures Seamless to match BDC's 5 room types. Safe to run repeatedly.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const hotelIds = { tooting: '13576893', gassiot: '15676333', valnay: '15779662', seamless: '12686318' };
for (const [pid, hid] of Object.entries(hotelIds)) {
  await db.execute({ sql: `UPDATE Property SET bdcHotelId = ? WHERE id = ?`, args: [hid, pid] });
}

const roomIds = {
  tooting: {
    'Room 1': '1357689301', 'Room 2': '1357689302', 'Room 3': '1357689304', // note: 03 skipped on BDC
    'Room 4': '1357689305', 'Room 5': '1357689306', 'Room 6': '1357689307',
  },
  gassiot: {
    'Two Twin Beds or Super King, Vented, Shared bathroom': '1567633301',
    'Single Room, Shared bathroom': '1567633302',
    'Double Room, Shared Bathroom': '1567633303',
    'Twin or Super King Bed in Cozy Room (Shared Bath)': '1567633305',
    'Superior King or Twin Room': '1567633306',
    'Basic Double Room with Shared Bathroom': '1567633307',
    'Budget Double Room with Shared Bathroom': '1567633308',
  },
  valnay: {
    'Double Room, Shared Bathroom': '1577966203',
    'Twin Room/ Super King Bed, with En-suite': '1577966204',
    'Business, Double Room, Shared Bathroom': '1577966205',
    'Twin Room/ Super King Bed, with Shared Bathroom': '1577966206',
  },
};
for (const [pid, map] of Object.entries(roomIds)) {
  for (const [name, id] of Object.entries(map)) {
    const r = await db.execute({
      sql: `UPDATE RoomType SET bdcRoomId = ? WHERE propertyId = ? AND name = ?`,
      args: [id, pid, name],
    });
    if (r.rowsAffected === 0) console.warn(`WARN: no row for ${pid} / ${name}`);
  }
}

// Seamless: BDC has 5 room types (one room each) — restructure from the old 3-type layout.
// Physical room assignments marked (?) are best guesses — confirm with Charlie.
const seamless = [
  { name: 'Room 1', bdcRoomId: '1268631801', physicalRooms: '1' },
  { name: 'Double Room with Shared Bathroom', bdcRoomId: '1268631802', physicalRooms: '2' }, // (?)
  { name: 'Large Double Room', bdcRoomId: '1268631803', physicalRooms: '3' }, // (?) was "2,3,4"
  { name: 'Deluxe Double Room', bdcRoomId: '1268631805', physicalRooms: '4' }, // (?)
  { name: 'Single Room with Shared Bathroom', bdcRoomId: '1268631804', physicalRooms: '5' },
];
for (const rt of seamless) {
  const existing = await db.execute({
    sql: `SELECT id FROM RoomType WHERE propertyId = 'seamless' AND name = ?`, args: [rt.name],
  });
  if (existing.rows.length > 0) {
    await db.execute({
      sql: `UPDATE RoomType SET bdcRoomId = ?, physicalRooms = ?, totalUnits = 1 WHERE id = ?`,
      args: [rt.bdcRoomId, rt.physicalRooms, existing.rows[0].id],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO RoomType (propertyId, name, bdcRoomId, expediaName, physicalRooms, totalUnits) VALUES ('seamless', ?, ?, NULL, ?, 1)`,
      args: [rt.name, rt.bdcRoomId, rt.physicalRooms],
    });
  }
}

const check = await db.execute(
  `SELECT p.name, COUNT(*) AS types, SUM(CASE WHEN rt.bdcRoomId IS NULL THEN 1 ELSE 0 END) AS missingIds
   FROM RoomType rt JOIN Property p ON p.id = rt.propertyId GROUP BY p.id ORDER BY p.sortOrder`
);
console.table(check.rows.map((r) => ({ ...r })));
db.close();
