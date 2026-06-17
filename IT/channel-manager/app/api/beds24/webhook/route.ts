// Beds24 booking webhook — writes inbound booking events to live Booking table.
// Configure in Beds24: Settings → Properties → Access → Booking Webhook
//   URL: https://<your-domain>/api/beds24/webhook?secret=<BEDS24_WEBHOOK_SECRET>
// Set BEDS24_WEBHOOK_SECRET in .env and paste the same value into Beds24.
// Returns 503 if secret is not configured; 401 if secret doesn't match.
// Also dual-writes to Beds24BookingShadow for the diff tool.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Beds24 channels that originate IN Beds24 — only these flow inbound to the hub.
const NATIVE_CHANNELS = new Set(['booking.com', 'airbnb', 'expedia']);

// ── ID maps (module-level cache, populated on first request) ──────────────────

type PropMap = Map<string, string>;
type RoomMap = Map<string, number>;

let propMap: PropMap | null = null;
let roomMap: RoomMap | null = null;

async function getIdMaps(): Promise<{ propMap: PropMap; roomMap: RoomMap }> {
  if (!propMap || !roomMap) {
    const props = await db.execute(`SELECT beds24PropId, id FROM Property WHERE beds24PropId IS NOT NULL`);
    propMap = new Map(props.rows.map(r => [String(r.beds24PropId), r.id as string]));

    const rooms = await db.execute(`SELECT beds24RoomId, id FROM RoomType WHERE beds24RoomId IS NOT NULL`);
    roomMap = new Map(rooms.rows.map(r => [String(r.beds24RoomId), r.id as number]));
  }
  return { propMap, roomMap };
}

// ── Field mapping ─────────────────────────────────────────────────────────────

type RawBooking = Record<string, unknown>;

function mapChannel(b: RawBooking): string {
  const ch = b.channel as string;
  if (ch === 'booking') return 'booking.com';
  if (ch === 'airbnb') return 'airbnb';
  if (ch === 'expedia') return 'expedia';
  if (ch === 'direct') return 'direct';
  return (b.apiSource as string) || ch || 'unknown';
}

function mapRow(b: RawBooking, pm: PropMap, rm: RoomMap) {
  const channel = mapChannel(b);
  const apiRef = b.apiReference as string | undefined;
  const channelRef = channel === 'booking.com' && apiRef ? 'BDC-' + apiRef : (apiRef ?? null);
  const guestName = [b.firstName, b.lastName].filter(Boolean).join(' ').trim() || null;
  return {
    beds24Id: String(b.id),
    propertyId: pm.get(String(b.propertyId)) ?? null,
    roomTypeId: rm.get(String(b.roomId)) ?? null,
    guestName: guestName as string | null,
    checkIn: (b.arrival as string) ?? null,
    checkOut: (b.departure as string) ?? null,
    channel,
    channelRef: channelRef as string | null,
    status: (b.status as string) ?? null,
    totalPrice: typeof b.price === 'number' ? b.price : null,
    raw: JSON.stringify(b),
  };
}

// ── Room auto-assignment (mirrors lib/allocate.ts) ────────────────────────────

async function assignRoom(roomTypeId: number, checkIn: string, checkOut: string): Promise<string | null> {
  const rt = (await db.execute({
    sql: `SELECT propertyId, physicalRooms FROM RoomType WHERE id = ?`,
    args: [roomTypeId],
  })).rows[0];
  if (!rt || !rt.physicalRooms) return null;

  const candidates = String(rt.physicalRooms)
    .split(',').map((r: string) => r.trim()).filter(Boolean)
    .sort((a: string, b: string) => Number(a) - Number(b));
  if (!candidates.length) return null;

  const occupied = (await db.execute({
    sql: `SELECT DISTINCT physicalRoom FROM Booking
          WHERE propertyId = ? AND status = 'confirmed'
            AND checkIn < ? AND checkOut > ?
            AND physicalRoom IS NOT NULL`,
    args: [rt.propertyId, checkOut, checkIn],
  })).rows.map(r => String(r.physicalRoom));

  const occupiedSet = new Set(occupied);
  return candidates.find((r: string) => !occupiedSet.has(r)) ?? null;
}

// ── Shadow table upsert SQL ───────────────────────────────────────────────────

const SHADOW_UPSERT = `
  INSERT INTO Beds24BookingShadow
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
    seenAt     = CURRENT_TIMESTAMP
`.trim();

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const secret = process.env.BEDS24_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 503 });

  const provided = req.nextUrl.searchParams.get('secret');
  if (!provided || provided !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const bookings: RawBooking[] = Array.isArray(payload)
    ? (payload as RawBooking[])
    : payload && typeof payload === 'object' && 'id' in (payload as object)
      ? [payload as RawBooking]
      : (payload as { data?: RawBooking[] })?.data ?? [];

  if (bookings.length === 0) {
    return NextResponse.json({ received: true, processed: 0 });
  }

  const { propMap: pm, roomMap: rm } = await getIdMaps();
  let stamped = 0, created = 0, cancelled = 0, skipped = 0;

  for (const b of bookings) {
    if (!b.id) continue;
    const row = mapRow(b, pm, rm);

    // Always dual-write to shadow table
    await db.execute({
      sql: SHADOW_UPSERT,
      args: [row.beds24Id, row.propertyId, row.roomTypeId, row.guestName,
             row.checkIn, row.checkOut, row.channel, row.channelRef,
             row.status, row.totalPrice, row.raw],
    });

    if (!NATIVE_CHANNELS.has(row.channel) || !row.propertyId) {
      skipped++;
      continue;
    }

    // Try to find existing hub booking by channelRef
    let hubRow: { id: number; status: string; beds24Id: string | null } | null = null;
    if (row.channelRef) {
      const rows = (await db.execute({
        sql: `SELECT id, status, beds24Id FROM Booking WHERE channelRef = ? LIMIT 1`,
        args: [row.channelRef],
      })).rows;
      if (rows[0]) {
        hubRow = { id: rows[0].id as number, status: rows[0].status as string, beds24Id: rows[0].beds24Id as string | null };
      }
    }

    if (row.status === 'cancelled') {
      if (!hubRow || (hubRow.beds24Id && hubRow.status === 'cancelled')) { skipped++; continue; }
      await db.execute({
        sql: `UPDATE Booking SET status = 'cancelled', beds24Id = ? WHERE id = ?`,
        args: [row.beds24Id, hubRow.id],
      });
      cancelled++;
      continue;
    }

    // confirmed
    if (hubRow) {
      if (hubRow.beds24Id) { skipped++; continue; }
      await db.execute({
        sql: `UPDATE Booking SET beds24Id = ? WHERE id = ?`,
        args: [row.beds24Id, hubRow.id],
      });
      stamped++;
      continue;
    }

    // New booking — insert with auto-assigned room
    const physicalRoom = row.roomTypeId ? await assignRoom(row.roomTypeId, row.checkIn!, row.checkOut!) : null;
    await db.execute({
      sql: `INSERT INTO Booking
              (propertyId, roomTypeId, physicalRoom, guestName, checkIn, checkOut,
               units, channel, channelRef, totalPrice, status, notes, beds24Id)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'confirmed', '[beds24]', ?)`,
      args: [row.propertyId, row.roomTypeId, physicalRoom, row.guestName,
             row.checkIn, row.checkOut, row.channel, row.channelRef, row.totalPrice, row.beds24Id],
    });
    created++;
  }

  return NextResponse.json({ received: true, stamped, created, cancelled, skipped });
}
