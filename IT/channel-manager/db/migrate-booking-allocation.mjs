// Migration: add propertyId + physicalRoom to Booking, make roomTypeId nullable.
// SQLite can't alter constraints, so rebuild the table preserving rows. Safe to run repeatedly.
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const cols = (await db.execute(`PRAGMA table_info("Booking")`)).rows.map((r) => r.name);
if (cols.includes('physicalRoom')) {
  console.log('Already migrated.');
} else {
  await db.executeMultiple(`
    BEGIN;
    CREATE TABLE "Booking_new" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "propertyId" TEXT NOT NULL DEFAULT 'streatham',
      "roomTypeId" INTEGER,
      "physicalRoom" TEXT,
      "guestName" TEXT NOT NULL,
      "email" TEXT,
      "phone" TEXT,
      "checkIn" TEXT NOT NULL,
      "checkOut" TEXT NOT NULL,
      "units" INTEGER NOT NULL DEFAULT 1,
      "channel" TEXT NOT NULL,
      "channelRef" TEXT,
      "totalPrice" REAL,
      "status" TEXT NOT NULL DEFAULT 'confirmed',
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Booking_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    );
    INSERT INTO "Booking_new" (id, propertyId, roomTypeId, guestName, email, phone, checkIn, checkOut, units, channel, channelRef, totalPrice, status, notes, createdAt)
      SELECT b.id, COALESCE(rt.propertyId, 'streatham'), b.roomTypeId, b.guestName, b.email, b.phone, b.checkIn, b.checkOut, b.units, b.channel, b.channelRef, b.totalPrice, b.status, b.notes, b.createdAt
      FROM "Booking" b LEFT JOIN "RoomType" rt ON rt.id = b.roomTypeId;
    DROP TABLE "Booking";
    ALTER TABLE "Booking_new" RENAME TO "Booking";
    COMMIT;
  `);
  console.log('Booking table migrated.');
}
db.close();
