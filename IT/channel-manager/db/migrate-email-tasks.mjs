// Migration: tables for the booking-email poller. Safe to run repeatedly.
//   node db/migrate-email-tasks.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

// New/modified bookings spotted in email but whose details (room, dates) still
// need fetching from the extranet — worked off by a Claude in Chrome session.
await db.execute(`CREATE TABLE IF NOT EXISTS "EmailBookingTask" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "kind" TEXT NOT NULL,              -- new | modified | needs_review
  "channel" TEXT NOT NULL DEFAULT 'booking.com',
  "channelRef" TEXT NOT NULL,
  "propertyId" TEXT,                 -- mapped from hotel_id when possible
  "bdcHotelId" TEXT,
  "checkInHint" TEXT,                -- from the email subject
  "extranetUrl" TEXT,                -- direct reservation-details link
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',  -- pending | done | dismissed
  "emailDate" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "doneAt" DATETIME
)`);
await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "EmailTask_dedupe"
  ON "EmailBookingTask"("kind", "channelRef", COALESCE("emailDate",''))`);

// Processed-mail ledger (Gmail UIDs) so re-running never double-handles an email.
await db.execute(`CREATE TABLE IF NOT EXISTS "ProcessedEmail" (
  "uid" INTEGER NOT NULL,
  "mailbox" TEXT NOT NULL DEFAULT 'INBOX',
  "messageId" TEXT,
  "subject" TEXT,
  "handledAs" TEXT,
  "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("mailbox", "uid")
)`);

console.log('EmailBookingTask + ProcessedEmail tables ready.');
db.close();
