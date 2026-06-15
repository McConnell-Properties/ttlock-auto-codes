// Seed: all 5 McConnell Enterprises properties, from IT/room-type-mapping.md
// Safe to run repeatedly (upserts).
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const properties = [
  {
    id: 'streatham',
    name: 'Streatham Rooms',
    bdcHotelId: '14715886',
    expediaHotelId: '124402141',
    sortOrder: 1,
    roomTypes: [
      { name: 'Triple Room with Private Bathroom', bdcRoomId: '1471588610', expediaName: 'Executive House, Accessible, Ensuite', physicalRooms: '1,4' },
      { name: 'Quad room, with Shared Bathroom', bdcRoomId: '1471588605', expediaName: 'Quadruple Room, Shared Bathroom', physicalRooms: '10,11' },
      { name: 'Superior King or Twin Room', bdcRoomId: '1471588612', expediaName: 'Executive House, Shared Bathroom', physicalRooms: '5,6' },
      { name: 'Double or Twin Room with Private Bathroom', bdcRoomId: '1471588611', expediaName: 'Comfort Twin Room, Ensuite', physicalRooms: '8' },
      { name: 'Double room-Ensuite', bdcRoomId: '1471588601', expediaName: 'Double Room, Ensuite', physicalRooms: '2,3' },
      { name: 'Twin Room, with full private kitchen and ensuite', bdcRoomId: '1471588604', expediaName: 'Luxury Apartment, Private Bathroom', physicalRooms: '9' },
      { name: 'Basic Single Room with Shared Bathroom', bdcRoomId: '1471588609', expediaName: 'Single Room, Shared Bathroom (Single Bed)', physicalRooms: '7' },
    ],
  },
  {
    id: 'gassiot',
    name: 'Gassiot House',
    bdcHotelId: '15676333',
    expediaHotelId: '124830615',
    sortOrder: 2,
    roomTypes: [
      { name: 'Superior King or Twin Room', bdcRoomId: '1567633306', expediaName: 'Superior Twin Room, Shared Bathroom', physicalRooms: '1' },
      { name: 'Double Room, Shared Bathroom', bdcRoomId: '1567633303', expediaName: 'Business Double Room, Shared Bathroom', physicalRooms: '7' },
      { name: 'Twin or Super King Bed in Cozy Room (Shared Bath)', bdcRoomId: '1567633305', expediaName: 'Business Twin Room, Shared Bathroom', physicalRooms: '3' },
      { name: 'Budget Double Room with Shared Bathroom', bdcRoomId: '1567633308', expediaName: 'Basic Double or Twin Room, Shared Bathroom', physicalRooms: '6' },
      { name: 'Basic Double Room with Shared Bathroom', bdcRoomId: '1567633307', expediaName: 'Basic Double Room, Shared Bathroom', physicalRooms: '5' },
      { name: 'Single Room, Shared bathroom', bdcRoomId: '1567633302', expediaName: 'Business Single Room, Shared Bathroom', physicalRooms: '4' },
      { name: 'Two Twin Beds or Super King, Vented, Shared bathroom', bdcRoomId: '1567633301', expediaName: 'Economy House, Shared Bathroom', physicalRooms: '2' },
    ],
  },
  {
    id: 'tooting',
    name: 'Tooting Stays',
    bdcHotelId: '13576893',
    expediaHotelId: '114536696',
    sortOrder: 3,
    roomTypes: [
      { name: 'Room 1', bdcRoomId: '1357689301', expediaName: 'Double Room, Shared Bathroom', physicalRooms: '1' },
      { name: 'Room 2', bdcRoomId: '1357689302', expediaName: 'Double Room, Shared Bathroom (1)', physicalRooms: '2' },
      { name: 'Room 3', bdcRoomId: '1357689304', expediaName: 'Double Room, Shared Bathroom (2)', physicalRooms: '3' },
      { name: 'Room 4', bdcRoomId: '1357689305', expediaName: 'Double Room, Shared Bathroom (3)', physicalRooms: '4' },
      { name: 'Room 5', bdcRoomId: '1357689306', expediaName: 'Double Room, Shared Bathroom (4)', physicalRooms: '5' },
      { name: 'Room 6', bdcRoomId: '1357689307', expediaName: 'Deluxe Double Room, Shared Bathroom', physicalRooms: '6' },
    ],
  },
  {
    id: 'valnay',
    name: 'Valnay Stays',
    bdcHotelId: '15779662',
    expediaHotelId: '124213592',
    sortOrder: 4,
    roomTypes: [
      { name: 'Twin Room/ Super King Bed, with Shared Bathroom', bdcRoomId: '1577966206', expediaName: 'Basic Twin Room, Shared Bathroom', physicalRooms: '4' },
      { name: 'Twin Room/ Super King Bed, with En-suite', bdcRoomId: '1577966204', expediaName: 'Basic Twin Room, Private Bathroom', physicalRooms: '5' },
      { name: 'Business, Double Room, Shared Bathroom', bdcRoomId: '1577966205', expediaName: 'Business Double Room, Shared Bathroom', physicalRooms: '1,3,6' },
      { name: 'Double Room, Shared Bathroom', bdcRoomId: '1577966203', expediaName: 'Basic Double Room, Shared Bathroom', physicalRooms: '2' },
    ],
  },
  {
    id: 'seamless',
    name: 'Seamless Stays',
    bdcHotelId: '12686318', // BDC only, not on Expedia
    expediaHotelId: null,
    sortOrder: 5,
    roomTypes: [
      // BDC has 5 single-room types; physical room numbers 2/3/4 are best guesses - confirm
      { name: 'Room 1', bdcRoomId: '1268631801', expediaName: null, physicalRooms: '1' },
      { name: 'Double Room with Shared Bathroom', bdcRoomId: '1268631802', expediaName: null, physicalRooms: '2' },
      { name: 'Large Double Room', bdcRoomId: '1268631803', expediaName: null, physicalRooms: '3' },
      { name: 'Deluxe Double Room', bdcRoomId: '1268631805', expediaName: null, physicalRooms: '4' },
      { name: 'Single Room with Shared Bathroom', bdcRoomId: '1268631804', expediaName: null, physicalRooms: '5' },
    ],
  },
];

for (const p of properties) {
  await db.execute({
    sql: `INSERT INTO Property (id, name, bdcHotelId, expediaHotelId, sortOrder) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, bdcHotelId = excluded.bdcHotelId,
          expediaHotelId = excluded.expediaHotelId, sortOrder = excluded.sortOrder`,
    args: [p.id, p.name, p.bdcHotelId, p.expediaHotelId, p.sortOrder],
  });
  for (const rt of p.roomTypes) {
    const totalUnits = rt.physicalRooms.split(',').length;
    const existing = await db.execute({
      sql: `SELECT id FROM RoomType WHERE propertyId = ? AND name = ?`,
      args: [p.id, rt.name],
    });
    if (existing.rows.length > 0) {
      await db.execute({
        sql: `UPDATE RoomType SET bdcRoomId = ?, expediaName = ?, physicalRooms = ?, totalUnits = ? WHERE id = ?`,
        args: [rt.bdcRoomId, rt.expediaName, rt.physicalRooms, totalUnits, existing.rows[0].id],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO RoomType (propertyId, name, bdcRoomId, expediaName, physicalRooms, totalUnits) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [p.id, rt.name, rt.bdcRoomId, rt.expediaName, rt.physicalRooms, totalUnits],
      });
    }
  }
}

const count = await db.execute(`SELECT COUNT(*) AS n FROM RoomType`);
console.log(`Seeded ${properties.length} properties, ${count.rows[0].n} room types.`);
db.close();
