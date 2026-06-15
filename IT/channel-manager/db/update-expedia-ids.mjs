// One-off: add Expedia room/rate-plan ID columns and fill in IDs scraped from
// EPC Rates & Availability pages (2026-06-12). Safe to run repeatedly.
// Streatham: rooms + rate plan IDs (with max occupancy). Tooting: rooms only
// (rate plan IDs to scrape during first push). Gassiot/Valnay: suspended on
// Expedia — scrape when reactivated.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

for (const col of ['expediaRoomId', 'expediaRatePlanId']) {
  try { await db.execute(`ALTER TABLE RoomType ADD COLUMN "${col}" TEXT`); }
  catch (e) { if (!String(e).includes('duplicate column')) throw e; }
}

// propertyId -> expediaName -> { roomId, ratePlanId ('a|b' if two plans) }
const ids = {
  streatham: {
    'Double Room, Ensuite': { roomId: '327910457', ratePlanId: '406745860' },
    'Quadruple Room, Shared Bathroom': { roomId: '327939022', ratePlanId: '406819859' },
    'Single Room, Shared Bathroom (Single Bed)': { roomId: '327940739', ratePlanId: '406826037' },
    'Luxury Apartment, Private Bathroom': { roomId: '327940744', ratePlanId: '406826041' },
    'Comfort Twin Room, Ensuite': { roomId: '327940745', ratePlanId: '406826051' },
    'Executive House, Accessible, Ensuite': { roomId: '328282146', ratePlanId: '408369639|408391232' },
    'Executive House, Shared Bathroom': { roomId: '328282162', ratePlanId: '408367499|408391299' },
  },
  tooting: {
    'Double Room, Shared Bathroom': { roomId: '326405063', ratePlanId: null },
    'Double Room, Shared Bathroom (1)': { roomId: '326405088', ratePlanId: null },
    'Double Room, Shared Bathroom (2)': { roomId: '326405102', ratePlanId: null },
    'Double Room, Shared Bathroom (3)': { roomId: '326405110', ratePlanId: null },
    'Double Room, Shared Bathroom (4)': { roomId: '326405142', ratePlanId: null },
    'Deluxe Double Room, Shared Bathroom': { roomId: '326405541', ratePlanId: null },
    // NOTE: EPC also lists 'Business Double Room, Shared Bathroom' (326... id 328083353)
    // which is NOT in our mapping — confirm with Charlie what it corresponds to.
  },
};

for (const [pid, map] of Object.entries(ids)) {
  for (const [expediaName, v] of Object.entries(map)) {
    const r = await db.execute({
      sql: `UPDATE RoomType SET expediaRoomId = ?, expediaRatePlanId = ? WHERE propertyId = ? AND expediaName = ?`,
      args: [v.roomId, v.ratePlanId, pid, expediaName],
    });
    if (r.rowsAffected === 0) console.warn(`WARN: no row matched ${pid} / ${expediaName}`);
  }
}

const check = await db.execute(
  `SELECT p.name, COUNT(*) AS types, SUM(CASE WHEN rt.expediaRoomId IS NOT NULL THEN 1 ELSE 0 END) AS withExpediaId
   FROM RoomType rt JOIN Property p ON p.id = rt.propertyId GROUP BY p.id ORDER BY p.sortOrder`
);
console.table(check.rows.map((r) => ({ ...r })));
db.close();
