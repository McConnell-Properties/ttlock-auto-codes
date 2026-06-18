export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { beds24 } from '@/lib/beds24';
import { db, all, run } from '@/lib/db';
import { queueInventorySync, nightsBetween } from '@/lib/data';

const PAGE_SIZE = 100;
const NATIVE_CHANNELS = new Set(['booking.com', 'airbnb', 'expedia']);

type B24Booking = {
  id: number;
  propertyId: number;
  roomId: number;
  firstName?: string;
  lastName?: string;
  arrival?: string;
  departure?: string;
  channel?: string;
  apiSource?: string;
  apiReference?: string;
  status?: string;
  price?: number;
};

function mapChannel(b: B24Booking): string {
  if (b.channel === 'booking') return 'booking.com';
  if (b.channel === 'airbnb') return 'airbnb';
  if (b.channel === 'expedia') return 'expedia';
  if (b.channel === 'direct') return 'direct';
  return b.apiSource || b.channel || 'unknown';
}

async function assignRoom(roomTypeId: number, checkIn: string, checkOut: string): Promise<string | null> {
  const rt = (await all<{ propertyId: string; physicalRooms: string | null }>(
    'SELECT propertyId, physicalRooms FROM RoomType WHERE id = ?', [roomTypeId]
  ))[0];
  if (!rt?.physicalRooms) return null;

  const candidates = rt.physicalRooms
    .split(',').map(r => r.trim()).filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
  if (!candidates.length) return null;

  const occupied = await all<{ physicalRoom: string }>(
    `SELECT DISTINCT physicalRoom FROM Booking
     WHERE propertyId = ? AND status = 'confirmed'
       AND checkIn < ? AND checkOut > ? AND physicalRoom IS NOT NULL`,
    [rt.propertyId, checkOut, checkIn]
  );
  const occupiedSet = new Set(occupied.map(r => r.physicalRoom));
  return candidates.find(r => !occupiedSet.has(r)) ?? null;
}

export async function POST(req: Request) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  try {
    // Load ID maps
    const propRows = await all<{ beds24PropId: string; id: string }>(
      'SELECT beds24PropId, id FROM Property WHERE beds24PropId IS NOT NULL'
    );
    const propMap = new Map(propRows.map(r => [String(r.beds24PropId), r.id]));

    const rtRows = await all<{ beds24RoomId: string; id: number }>(
      'SELECT beds24RoomId, id FROM RoomType WHERE beds24RoomId IS NOT NULL'
    );
    const roomMap = new Map(rtRows.map(r => [String(r.beds24RoomId), r.id]));

    // Last-run timestamp from Setting table (replaces filesystem .beds24-pull.last)
    const lastRunRow = (await db.execute({
      sql: `SELECT value FROM Setting WHERE key = 'beds24_pull_last'`,
      args: [],
    })).rows[0];

    let lastRun: string;
    if (lastRunRow?.value) {
      lastRun = String(lastRunRow.value);
    } else {
      // First Vercel run: Mac launchd already did historical backfill — start from 24h ago
      const d = new Date();
      d.setHours(d.getHours() - 24);
      lastRun = d.toISOString();
      console.log('[cron/pull] No prior run — defaulting to 24h ago');
    }
    const runStart = new Date().toISOString();
    console.log(`[cron/pull] Polling since: ${lastRun}`);

    let totalFetched = 0, stamped = 0, created = 0, cancelled = 0, skipped = 0;
    let firstId: number | undefined;

    while (true) {
      const query: Record<string, string | number | boolean | undefined> = {
        modifiedFrom: lastRun,
        count: PAGE_SIZE,
        firstId,
      };

      const resp = await beds24<{ data?: B24Booking[] }>('GET', '/bookings', { query });
      const bookings = resp.data ?? [];
      if (bookings.length === 0) break;

      totalFetched += bookings.length;

      for (const b of bookings) {
        const channel = mapChannel(b);
        const channelRef =
          channel === 'booking.com' && b.apiReference ? 'BDC-' + b.apiReference : (b.apiReference ?? null);
        const propId = propMap.get(String(b.propertyId)) ?? null;
        const rtId = roomMap.get(String(b.roomId)) ?? null;
        const guestName = [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || null;
        const status = b.status ?? null;
        const totalPrice = typeof b.price === 'number' ? b.price : null;
        const beds24IdStr = String(b.id);
        const raw = JSON.stringify(b);

        // Shadow table always gets the record (diff tool depends on it)
        await db.execute({
          sql: `INSERT INTO Beds24BookingShadow
                  (beds24Id, propertyId, roomTypeId, guestName, checkIn, checkOut,
                   channel, channelRef, status, totalPrice, raw, seenAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(beds24Id) DO UPDATE SET
                  propertyId = excluded.propertyId,
                  roomTypeId = excluded.roomTypeId,
                  guestName  = excluded.guestName,
                  checkIn    = excluded.checkIn,
                  checkOut   = excluded.checkOut,
                  channel    = excluded.channel,
                  channelRef = excluded.channelRef,
                  status     = excluded.status,
                  totalPrice = excluded.totalPrice,
                  raw        = excluded.raw,
                  seenAt     = CURRENT_TIMESTAMP`,
          args: [
            beds24IdStr, propId, rtId, guestName,
            b.arrival ?? null, b.departure ?? null,
            channel, channelRef, status, totalPrice, raw,
          ],
        });

        // Only ingest native Beds24-channel bookings into the live hub
        if (!NATIVE_CHANNELS.has(channel)) { skipped++; continue; }
        if (!propId) { skipped++; continue; }

        // Find existing hub booking by channelRef
        let hubRow: { id: number; status: string; beds24Id: string | null } | null = null;
        if (channelRef) {
          const rows = await all<{ id: number; status: string; beds24Id: string | null }>(
            `SELECT id, status, beds24Id FROM Booking WHERE channelRef = ? LIMIT 1`, [channelRef]
          );
          hubRow = rows[0] ?? null;
        }

        if (status === 'cancelled') {
          if (!hubRow || (hubRow.beds24Id && hubRow.status === 'cancelled')) { skipped++; continue; }
          await run(
            `UPDATE Booking SET status = 'cancelled', beds24Id = ? WHERE id = ?`,
            [beds24IdStr, hubRow.id]
          );
          cancelled++;
          console.log(`[cron/pull] CANCELLED hub id=${hubRow.id} channelRef=${channelRef}`);
          continue;
        }

        if (hubRow) {
          if (hubRow.beds24Id) { skipped++; continue; }
          await run(`UPDATE Booking SET beds24Id = ? WHERE id = ?`, [beds24IdStr, hubRow.id]);
          stamped++;
          continue;
        }

        // Genuinely new booking — create with auto-assigned room
        let physicalRoom: string | null = null;
        if (rtId) physicalRoom = await assignRoom(rtId, b.arrival ?? '', b.departure ?? '');

        await run(
          `INSERT INTO Booking
             (propertyId, roomTypeId, physicalRoom, guestName, checkIn, checkOut,
              units, channel, channelRef, totalPrice, status, notes, beds24Id)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'confirmed', '[beds24]', ?)`,
          [
            propId, rtId, physicalRoom, guestName,
            b.arrival ?? null, b.departure ?? null,
            channel, channelRef, totalPrice, beds24IdStr,
          ]
        );
        created++;
        console.log(`[cron/pull] CREATED hub booking beds24Id=${beds24IdStr} channelRef=${channelRef}`);
        // Queue inventory push for all dates of this booking so BDC gets updated counts
        if (rtId && b.arrival && b.departure) {
          await queueInventorySync(rtId, nightsBetween(b.arrival, b.departure));
        }
      }

      console.log(`[cron/pull] page processed: ${bookings.length} bookings (total: ${totalFetched})`);
      if (bookings.length < PAGE_SIZE) break;
      firstId = bookings[bookings.length - 1].id;

      // Checkpoint: save progress after each full page so a timeout doesn't lose the run
      await db.execute({
        sql: `INSERT INTO Setting (key, value) VALUES ('beds24_pull_last', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [runStart],
      });
    }

    // Final persist (also covers single-page runs)
    await db.execute({
      sql: `INSERT INTO Setting (key, value) VALUES ('beds24_pull_last', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [runStart],
    });

    console.log(`[cron/pull] done fetched=${totalFetched} stamped=${stamped} created=${created} cancelled=${cancelled} skipped=${skipped}`);
    return NextResponse.json({ ok: true, fetched: totalFetched, stamped, created, cancelled, skipped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/pull]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
