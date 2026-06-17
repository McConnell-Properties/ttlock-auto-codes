export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { beds24 } from '@/lib/beds24';
import { db, all } from '@/lib/db';

// Rooms with multiple Beds24 units that require explicit unitId assignment
const MULTI_UNIT_ROOMS = new Map<number, number>([
  [693503, 2], // Streatham Triple
  [693501, 2], // Streatham Quad
  [693505, 2], // Streatham Super King/Twin
  [693499, 2], // Streatham Double Ensuite
  [693520, 3], // Valnay Business Double
]);

type B24PostResult = Array<{ new?: { id: number }; success?: boolean }>;

function isNative(channel: string, channelRef: string): boolean {
  const ch = channel.toLowerCase();
  if (ch === 'airbnb') return true;
  if ((ch === 'booking.com' || ch === 'bdc') && channelRef.startsWith('BDC-')) return true;
  if (ch === 'unknown' && channelRef.startsWith('BDC-')) return true;
  return false;
}

function mapChannel(channel: string, channelRef: string): string {
  const ch = channel.toLowerCase();
  const ref = channelRef.toLowerCase();
  if (ch === 'expedia' || ref.startsWith('exp-')) return 'Expedia';
  if (ch === 'airbnb') return 'Airbnb';
  if (ch === 'direct') return 'Direct Booking';
  if (ch === 'extranet') return 'Little Hotelier';
  if (ch === 'import') return 'Channel Manager Import';
  if (ch === 'booking.com') return 'Booking.com (Legacy)';
  return 'Other';
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// Per-invocation unit cache: roomId → occupied slots fetched from Beds24
const unitCache = new Map<number, Array<{ arrival: string; departure: string; unitId: number }>>();

async function fetchRoomBookings(
  roomId: number
): Promise<Array<{ arrival: string; departure: string; unitId: number }>> {
  if (unitCache.has(roomId)) return unitCache.get(roomId)!;
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = new Date(Date.now() + 366 * 86400_000).toISOString().slice(0, 10);
  try {
    const resp = await beds24<{
      data?: Array<{ arrival: string; departure: string; unitId?: number; status?: string }>;
    }>('GET', '/bookings', { query: { roomId, arrivalFrom: today, arrivalTo: nextYear } });
    const bks = (resp.data ?? [])
      .filter(b => b.status !== 'cancelled' && b.unitId)
      .map(b => ({ arrival: b.arrival, departure: b.departure, unitId: b.unitId! }));
    unitCache.set(roomId, bks);
    return bks;
  } catch {
    unitCache.set(roomId, []);
    return [];
  }
}

async function findFreeUnit(
  roomId: number,
  numUnits: number,
  arrival: string,
  departure: string
): Promise<number | null> {
  const booked = await fetchRoomBookings(roomId);
  const taken = new Set(
    booked.filter(b => b.arrival < departure && b.departure > arrival).map(b => b.unitId)
  );
  for (let u = 1; u <= numUnits; u++) {
    if (!taken.has(u)) return u;
  }
  return null;
}

// ── Step 2: Push new non-native confirmed bookings missing beds24Id ───────────
async function pushNewBookings(): Promise<number> {
  const rows = await all<{
    id: number; beds24RoomId: number; beds24PropId: number;
    guestName: string; email: string | null; phone: string | null;
    checkIn: string; checkOut: string; adults: number; children: number;
    totalPrice: number | null; channel: string; channelRef: string | null; notes: string | null;
  }>(`
    SELECT b.id, b.guestName, b.email, b.phone,
           b.checkIn, b.checkOut, b.adults, b.children, b.totalPrice,
           b.channel, b.channelRef, b.notes,
           CAST(rt.beds24RoomId AS INTEGER) AS beds24RoomId,
           CAST(p.beds24PropId  AS INTEGER) AS beds24PropId
    FROM Booking b
    JOIN RoomType rt ON rt.id = b.roomTypeId
    JOIN Property p  ON p.id  = b.propertyId
    WHERE b.status = 'confirmed'
      AND b.checkOut > date('now')
      AND b."beds24Id" IS NULL
      AND rt.beds24RoomId IS NOT NULL
      AND p.beds24PropId  IS NOT NULL
    ORDER BY b.checkIn
  `);

  const toSync = rows.filter(r => !isNative(String(r.channel), String(r.channelRef ?? '')));
  if (toSync.length === 0) {
    console.log('[cron/sync-bookings] step2: no new bookings to push');
    return 0;
  }

  let pushed = 0;
  for (const bk of toSync) {
    const { firstName, lastName } = splitName(String(bk.guestName));
    const referer = mapChannel(String(bk.channel), String(bk.channelRef ?? ''));
    const notes = [
      `Hub booking #${bk.id}`,
      bk.channelRef ? `Ref: ${bk.channelRef}` : null,
      bk.notes ? String(bk.notes).slice(0, 120) : null,
    ].filter(Boolean).join(' | ');

    const roomId = Number(bk.beds24RoomId);
    const numUnits = MULTI_UNIT_ROOMS.get(roomId);
    let unitId: number | undefined;
    if (numUnits) {
      const free = await findFreeUnit(roomId, numUnits, String(bk.checkIn), String(bk.checkOut));
      if (free) {
        unitId = free;
        const cached = unitCache.get(roomId) ?? [];
        cached.push({ arrival: String(bk.checkIn), departure: String(bk.checkOut), unitId });
        unitCache.set(roomId, cached);
      }
    }

    const payload = [{
      propertyId: Number(bk.beds24PropId),
      roomId,
      arrival: String(bk.checkIn),
      departure: String(bk.checkOut),
      firstName,
      lastName,
      email: bk.email ?? '',
      phone: bk.phone ?? '',
      numAdult: Number(bk.adults) || 1,
      numChild: Number(bk.children) || 0,
      price: bk.totalPrice != null ? Number(bk.totalPrice) : 0,
      status: 'confirmed',
      referer,
      notes,
      ...(unitId ? { unitId } : {}),
    }];

    try {
      const result = await beds24<B24PostResult>('POST', '/bookings', { body: payload });
      const entry = result[0];
      if (entry?.new?.id) {
        const beds24Id = entry.new.id;
        await db.execute({
          sql: `UPDATE "Booking" SET
                  "beds24Id"            = ?,
                  "beds24SyncedRoomId"  = ?,
                  "beds24SyncedPropId"  = ?,
                  "beds24SyncedCheckIn" = ?,
                  "beds24SyncedCheckOut"= ?
                WHERE id = ?`,
          args: [beds24Id, Number(bk.beds24RoomId), Number(bk.beds24PropId),
                 String(bk.checkIn), String(bk.checkOut), bk.id],
        });
        console.log(`[cron/sync-bookings] PUSH #${bk.id} → beds24Id=${beds24Id}`);
        pushed++;
      } else {
        console.error(`[cron/sync-bookings] PUSH #${bk.id} unexpected: ${JSON.stringify(result).slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[cron/sync-bookings] PUSH #${bk.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return pushed;
}

// ── Step 3: Modify bookings where hub placement/dates have drifted ─────────────
async function modifyDrifted(): Promise<number> {
  const rows = await all<{
    id: number; beds24Id: string; channelDiverged: number;
    checkIn: string; checkOut: string; guestName: string;
    beds24RoomId: number; beds24PropId: number;
  }>(`
    SELECT b.id, b."beds24Id", b.channelDiverged,
           b.checkIn, b.checkOut, b.guestName,
           CAST(rt.beds24RoomId AS INTEGER) AS beds24RoomId,
           CAST(p.beds24PropId  AS INTEGER) AS beds24PropId
    FROM Booking b
    JOIN RoomType rt ON rt.id = b.roomTypeId
    JOIN Property p  ON p.id  = b.propertyId
    WHERE b."beds24Id" IS NOT NULL
      AND b.status = 'confirmed'
      AND (
        b.channelDiverged = 1
        OR (
          b."beds24SyncedRoomId" IS NOT NULL
          AND (
            b."beds24SyncedRoomId" != CAST(rt.beds24RoomId AS INTEGER)
            OR b."beds24SyncedCheckIn"  != b.checkIn
            OR b."beds24SyncedCheckOut" != b.checkOut
          )
        )
      )
  `);

  if (rows.length === 0) {
    console.log('[cron/sync-bookings] step3: no drift detected');
    return 0;
  }

  let modified = 0;
  for (const bk of rows) {
    const beds24Id = Number(bk.beds24Id);
    const beds24RoomId = Number(bk.beds24RoomId);
    const beds24PropId = Number(bk.beds24PropId);

    try {
      const result = await beds24<B24PostResult>('POST', '/bookings', {
        body: [{
          id: beds24Id,
          propertyId: beds24PropId,
          roomId: beds24RoomId,
          arrival: String(bk.checkIn),
          departure: String(bk.checkOut),
        }],
      });
      const entry = result[0];
      if (entry?.success) {
        await db.execute({
          sql: `UPDATE "Booking" SET
                  "beds24SyncedRoomId"  = ?,
                  "beds24SyncedPropId"  = ?,
                  "beds24SyncedCheckIn" = ?,
                  "beds24SyncedCheckOut"= ?,
                  "channelDiverged"     = 0
                WHERE id = ?`,
          args: [beds24RoomId, beds24PropId, String(bk.checkIn), String(bk.checkOut), bk.id],
        });
        console.log(`[cron/sync-bookings] MODIFY hub#${bk.id} beds24Id=${beds24Id}`);
        modified++;
      } else {
        console.error(`[cron/sync-bookings] MODIFY hub#${bk.id}: ${JSON.stringify(result).slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[cron/sync-bookings] MODIFY hub#${bk.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return modified;
}

// ── Step 4: Cancel in Beds24 for hub-cancelled non-native bookings ────────────
// Known: retries on every run for already-cancelled bookings (Beds24 handles idempotently).
// Fix when quota is a concern: null beds24Id after cancel, or add beds24CancelledAt.
async function cancelInBeds24(): Promise<number> {
  const rows = await all<{
    id: number; beds24Id: string; channel: string; channelRef: string | null;
    guestName: string; checkIn: string; checkOut: string;
  }>(`
    SELECT b.id, b."beds24Id", b.channel, b.channelRef, b.guestName, b.checkIn, b.checkOut
    FROM Booking b
    WHERE b.status = 'cancelled'
      AND b."beds24Id" IS NOT NULL
    ORDER BY b.checkIn
  `);

  const toCancel = rows.filter(r => !isNative(String(r.channel), String(r.channelRef ?? '')));
  if (toCancel.length === 0) {
    console.log('[cron/sync-bookings] step4: no cancelled bookings to mirror');
    return 0;
  }

  let cancelled = 0;
  for (const bk of toCancel) {
    const beds24Id = Number(bk.beds24Id);
    try {
      const result = await beds24<B24PostResult>('POST', '/bookings', {
        body: [{ id: beds24Id, status: 'cancelled' }],
      });
      const entry = result[0];
      if (entry?.success) {
        console.log(`[cron/sync-bookings] CANCEL hub#${bk.id} → beds24Id=${beds24Id}`);
        cancelled++;
      } else {
        console.error(`[cron/sync-bookings] CANCEL hub#${bk.id}: ${JSON.stringify(result).slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[cron/sync-bookings] CANCEL hub#${bk.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return cancelled;
}

export async function POST(req: Request) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  try {
    console.log(`[cron/sync-bookings] started ${new Date().toISOString()}`);
    const pushed = await pushNewBookings();
    const modified = await modifyDrifted();
    const cancelled = await cancelInBeds24();
    console.log(`[cron/sync-bookings] done pushed=${pushed} modified=${modified} cancelled=${cancelled}`);
    return NextResponse.json({ ok: true, pushed, modified, cancelled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/sync-bookings]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
