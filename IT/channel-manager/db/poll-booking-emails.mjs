// Poll Gmail (IMAP) for Booking.com booking emails and react immediately:
//
//   Cancelled booking!  -> we already hold the booking (channelRef) — mark it
//                          cancelled and QUEUE the inventory restore for the
//                          other channels. Fully automatic.
//   New/Modified booking! -> BDC's email has NO stay details (no room type or
//                          checkout — just ref, hotel_id, check-in). We record
//                          an EmailBookingTask with the direct extranet link so
//                          a Claude in Chrome session can fetch the details and
//                          book it in (which queues inventory automatically).
//
// Dedupe: ProcessedEmail table by IMAP UID — re-running is always safe.
// Mail flags are never modified (your unread markers stay intact).
//
//   node db/poll-booking-emails.mjs            (or: npm run emails:poll)
//   Requires GMAIL_USER + GMAIL_APP_PASSWORD in .env (already set).
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { ImapFlow } from 'imapflow';

const here = dirname(fileURLToPath(import.meta.url));

// minimal .env loader (CLI runs outside Next)
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;
if (!user || !pass) { console.error('GMAIL_USER / GMAIL_APP_PASSWORD not set'); process.exit(1); }

const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const LOOKBACK_DAYS = Number(process.env.BOOKING_EMAIL_LOOKBACK_DAYS || 3);

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// "12 July 2026" -> "2026-07-12"
function isoFromLong(d) {
  const m = (d || '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// "Booking.com - New booking! (5591928297, Sunday, 12 July 2026)"
function parseSubject(subject) {
  const m = (subject || '').match(/Booking\.com\s*-\s*(New|Modified|Cancelled)\s+booking!\s*\((\d+),\s*[A-Za-z]+,\s*([\d]{1,2}\s+[A-Za-z]+\s+\d{4})\)/i);
  if (!m) return null;
  return { kind: m[1].toLowerCase(), ref: m[2], checkInHint: isoFromLong(m[3]) };
}

// ---------- inventory queueing (mirrors lib/data.ts) ----------
async function roomsToSell(roomTypeId, date) {
  const rt = (await db.execute({ sql: `SELECT totalUnits FROM RoomType WHERE id = ?`, args: [roomTypeId] })).rows[0];
  if (!rt) return 0;
  const booked = (await db.execute({
    sql: `SELECT COALESCE(SUM(units),0) n FROM Booking WHERE status='confirmed' AND roomTypeId=? AND checkIn<=? AND checkOut>?`,
    args: [roomTypeId, date, date],
  })).rows[0];
  const blocked = (await db.execute({
    sql: `SELECT COALESCE(SUM(units),0) n FROM Block WHERE roomTypeId=? AND date=?`,
    args: [roomTypeId, date],
  })).rows[0];
  return Math.max(0, Number(rt.totalUnits) - Number(booked?.n ?? 0) - Number(blocked?.n ?? 0));
}

async function channelsFor(roomTypeId, excludeChannel) {
  const rt = (await db.execute({
    sql: `SELECT rt.expediaName, p.bdcHotelId, p.expediaHotelId FROM RoomType rt JOIN Property p ON p.id = rt.propertyId WHERE rt.id = ?`,
    args: [roomTypeId],
  })).rows[0];
  if (!rt) return [];
  const out = [];
  if (rt.bdcHotelId && excludeChannel !== 'booking.com') out.push('booking.com');
  if (rt.expediaHotelId && rt.expediaName && excludeChannel !== 'expedia') out.push('expedia');
  return out;
}

function nightsBetween(ci, co) {
  const out = [];
  const d = new Date(ci + 'T00:00:00Z');
  while (d.toISOString().slice(0, 10) < co) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function queueInventory(roomTypeId, dates, excludeChannel) {
  const channels = await channelsFor(roomTypeId, excludeChannel);
  let n = 0;
  for (const date of dates) {
    const value = String(await roomsToSell(roomTypeId, date));
    for (const channel of channels) {
      await db.execute({
        sql: `DELETE FROM SyncJob WHERE roomTypeId=? AND date=? AND channel=? AND field='inventory' AND status='pending'`,
        args: [roomTypeId, date, channel],
      });
      await db.execute({
        sql: `INSERT INTO SyncJob (channel, roomTypeId, date, field, value) VALUES (?, ?, ?, 'inventory', ?)`,
        args: [channel, roomTypeId, date, value],
      });
      n++;
    }
  }
  return n;
}

// ---------- task + ledger helpers ----------
async function addTask(t) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO EmailBookingTask (kind, channelRef, propertyId, bdcHotelId, checkInHint, extranetUrl, note, emailDate)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [t.kind, t.ref, t.propertyId ?? null, t.bdcHotelId ?? null, t.checkInHint ?? null,
           t.extranetUrl ?? null, t.note ?? null, t.emailDate ?? null],
  });
}

async function alreadyProcessed(uid) {
  const r = await db.execute({ sql: `SELECT 1 FROM ProcessedEmail WHERE mailbox='INBOX' AND uid=?`, args: [uid] });
  return r.rows.length > 0;
}

async function markProcessed(uid, messageId, subject, handledAs) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO ProcessedEmail (uid, mailbox, messageId, subject, handledAs) VALUES (?, 'INBOX', ?, ?, ?)`,
    args: [uid, messageId ?? null, subject ?? null, handledAs],
  });
}

// ---------- main ----------
const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user, pass }, logger: false,
});

const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
let stats = { seen: 0, cancelled: 0, queued: 0, tasks: 0, review: 0, skipped: 0 };
// properties whose Little Hotelier export should run NOW (instant door codes
// for same-day bookings instead of waiting for the daily pipeline)
const exportProps = new Set();

await client.connect();
try {
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ from: 'noreply@booking.com', since }, { uid: true });
    for (const uid of uids || []) {
      if (await alreadyProcessed(uid)) continue;
      const msg = await client.fetchOne(uid, { envelope: true, source: true }, { uid: true });
      const subject = msg?.envelope?.subject || '';
      const emailDate = msg?.envelope?.date ? new Date(msg.envelope.date).toISOString() : null;
      const messageId = msg?.envelope?.messageId || null;
      stats.seen++;

      const p = parseSubject(subject);
      if (!p) { await markProcessed(uid, messageId, subject, 'ignored'); stats.skipped++; continue; }

      const raw = msg.source ? msg.source.toString('utf8') : '';
      const hotelId = (raw.match(/hotel_id=(\d+)/) || [])[1] ?? null;
      const prop = hotelId
        ? (await db.execute({ sql: `SELECT id, name FROM Property WHERE bdcHotelId = ?`, args: [hotelId] })).rows[0]
        : null;
      // pipeline property key = first word of the name ("Streatham Rooms" → streatham)
      if (prop?.name) exportProps.add(String(prop.name).split(/\s+/)[0].toLowerCase());
      const extranetUrl = hotelId
        ? `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html?res_id=${p.ref}&hotel_id=${hotelId}&lang=en-gb`
        : null;

      if (p.kind === 'cancelled') {
        // a multi-room booking is several rows sharing one channelRef — handle all
        const rows = (await db.execute({
          sql: `SELECT id, roomTypeId, checkIn, checkOut FROM Booking WHERE channelRef = ? AND status = 'confirmed'`,
          args: [p.ref],
        })).rows;
        if (rows.length) {
          await db.execute({ sql: `UPDATE Booking SET status = 'cancelled' WHERE channelRef = ? AND status = 'confirmed'`, args: [p.ref] });
          for (const b of rows) {
            if (b.roomTypeId != null) {
              stats.queued += await queueInventory(Number(b.roomTypeId), nightsBetween(b.checkIn, b.checkOut), 'booking.com');
              console.log(`CANCELLED ${p.ref} — booking #${b.id} cancelled, inventory restore queued`);
            } else {
              await addTask({ kind: 'needs_review', ref: p.ref, propertyId: prop?.id, bdcHotelId: hotelId,
                checkInHint: p.checkInHint, extranetUrl, emailDate, note: `cancelled; booking #${b.id} had no room type — restore inventory manually` });
              stats.review++;
              console.log(`CANCELLED ${p.ref} — booking #${b.id} cancelled but unallocated, flagged for review`);
            }
          }
          stats.cancelled++;
        } else {
          await addTask({ kind: 'needs_review', ref: p.ref, propertyId: prop?.id, bdcHotelId: hotelId,
            checkInHint: p.checkInHint, extranetUrl, emailDate, note: 'cancellation email but no matching confirmed booking in DB' });
          stats.review++;
          console.log(`CANCELLED ${p.ref} — no matching booking, flagged for review`);
        }
        await markProcessed(uid, messageId, subject, 'cancelled');
      } else {
        // new | modified — details aren't in the email; queue a fetch task
        await addTask({ kind: p.kind, ref: p.ref, propertyId: prop?.id, bdcHotelId: hotelId,
          checkInHint: p.checkInHint, extranetUrl, emailDate });
        stats.tasks++;
        console.log(`${p.kind.toUpperCase()} ${p.ref} (${prop?.id ?? `hotel ${hotelId ?? '?'}`}, check-in ${p.checkInHint ?? '?'}) — detail-fetch task queued`);
        await markProcessed(uid, messageId, subject, p.kind);
      }
    }
  } finally {
    lock.release();
  }
} finally {
  await client.logout().catch(() => {});
}

const pending = (await db.execute(`SELECT COUNT(*) n FROM EmailBookingTask WHERE status = 'pending'`)).rows[0];
console.log(`Processed ${stats.seen} new emails: ${stats.cancelled} cancellations handled (${stats.queued} inventory jobs queued), ` +
  `${stats.tasks} new/modified awaiting detail-fetch, ${stats.review} flagged for review, ${stats.skipped} ignored. ` +
  `Pending email tasks: ${pending?.n ?? '?'}.`);
db.close();

// Kick the Little Hotelier export + TTLock pipeline for affected properties —
// fire-and-forget so the poller exits fast; trigger-export.sh serializes runs.
// Disable with EXPORT_TRIGGER=off in .env.
if (exportProps.size && (process.env.EXPORT_TRIGGER || 'on') !== 'off') {
  const script = join(here, '..', 'automation', 'jobs', 'trigger-export.sh');
  const props = [...exportProps];
  console.log(`Triggering instant LH export + pipeline for: ${props.join(', ')}`);
  spawn('/bin/bash', [script, ...props], { detached: true, stdio: 'ignore' }).unref();
}
