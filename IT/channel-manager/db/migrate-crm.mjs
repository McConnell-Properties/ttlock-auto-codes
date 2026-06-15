// Migration: CRM tracking table (1:1 with Booking). Safe to run repeatedly.
//   node db/migrate-crm.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

await db.execute(`CREATE TABLE IF NOT EXISTS "CrmRecord" (
  "bookingId" INTEGER NOT NULL PRIMARY KEY,
  -- pre-stay
  "preStayCall" TEXT NOT NULL DEFAULT '',      -- '' | done | no_answer | not_reachable | message_sent | na
  "preStayDate" TEXT,
  "formSent" TEXT NOT NULL DEFAULT '',         -- '' | yes | no | na
  "formCompleted" TEXT NOT NULL DEFAULT '',
  -- in-stay (day after arrival)
  "midStayCall" TEXT NOT NULL DEFAULT '',
  "msDate" TEXT,
  "checkinRating" INTEGER,
  "cleanlinessRating" INTEGER,
  "issueFlagged" TEXT,
  "taskGiven" TEXT,
  -- post-stay
  "firstContact" TEXT NOT NULL DEFAULT '',
  "fcDate" TEXT,
  "feedback" TEXT,
  "rebookingInterest" TEXT NOT NULL DEFAULT '', -- '' | yes | maybe | no
  "directBookingOffered" TEXT NOT NULL DEFAULT '',
  "promoCodeGiven" TEXT,
  -- review chase
  "secondContact" TEXT NOT NULL DEFAULT '',
  "scDate" TEXT,
  "review" TEXT NOT NULL DEFAULT '',            -- '' | received | declined | chased
  "reviewDate" TEXT,
  "reviewScore" REAL,
  -- misc
  "issueReport" TEXT,
  "guestSentiment" TEXT NOT NULL DEFAULT '', -- '' | positive | neutral | negative
  "updatedAt" DATETIME,
  CONSTRAINT "Crm_booking_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE
)`);

// in case the table pre-dates the sentiment column
try { await db.execute(`ALTER TABLE CrmRecord ADD COLUMN "guestSentiment" TEXT NOT NULL DEFAULT ''`); }
catch (e) { if (!String(e).includes('duplicate column')) throw e; }

// Optional-extras requests (written by the booking-site agent into
// .data/extras-requests.csv; imported by db/import-extras.mjs). Each open row
// is an operational task on the CRM page.
await db.execute(`CREATE TABLE IF NOT EXISTS "ExtrasRequest" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bookingReference" TEXT NOT NULL,
  "bookingId" INTEGER, -- matched via Booking.channelRef; null = unmatched
  "extra" TEXT NOT NULL,
  "date" TEXT,
  "time" TEXT,
  "nights" INTEGER,
  "price" REAL,
  "sourceStatus" TEXT, -- status column from the CSV
  "taskStatus" TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | done | cancelled
  "raw" TEXT,
  "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "Extras_dedupe"
  ON "ExtrasRequest"("bookingReference", "extra", COALESCE("date",''), COALESCE("time",''))`);

console.log('CrmRecord + ExtrasRequest tables ready.');
db.close();
