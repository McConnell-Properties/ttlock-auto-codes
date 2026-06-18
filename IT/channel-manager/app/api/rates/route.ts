export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { all, one } from '@/lib/db';
import { upsertRate, deleteRate, queuePriceSync, nightsBetween } from '@/lib/data';

// GET /api/rates?start=YYYY-MM-DD&end=YYYY-MM-DD
// Returns all room types with their effective price for each date in the window.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const start = searchParams.get('start');
  const end   = searchParams.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end required' }, { status: 400 });

  const roomTypes = await all<{ id: number; name: string; propertyName: string; basePrice: number }>(
    `SELECT rt.id, rt.name, p.name AS propertyName, rt.basePrice
     FROM RoomType rt JOIN Property p ON p.id = rt.propertyId
     ORDER BY p.name, rt.name`
  );
  const rtIds = roomTypes.map(r => r.id);
  if (!rtIds.length) return NextResponse.json({ roomTypes: [], overrides: [] });

  const ph = rtIds.map(() => '?').join(',');
  const overrides = await all<{ roomTypeId: number; date: string; price: number }>(
    `SELECT roomTypeId, date, price FROM RateOverride
     WHERE roomTypeId IN (${ph}) AND date >= ? AND date < ?
     ORDER BY date`,
    [...rtIds, start, end]
  );

  return NextResponse.json({ roomTypes, overrides });
}

// POST /api/rates
// Upsert price overrides and queue BDC sync.
//
// Two forms:
//   { entries: [{ roomTypeId, date, price }] }        — explicit per-date list
//   { roomTypeId, start, end, price }                 — fill a date range with one price
export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const entries = normaliseEntries(body);
  if (!entries.length) return NextResponse.json({ error: 'no entries' }, { status: 400 });

  for (const e of entries) {
    if (!e.roomTypeId || !e.date || e.price == null)
      return NextResponse.json({ error: 'each entry needs roomTypeId, date, price' }, { status: 400 });
  }

  // Group by roomTypeId for efficient sync queuing
  const byRoom = new Map<number, { dates: string[]; price: number }>();
  for (const e of entries) {
    await upsertRate(e.roomTypeId, e.date, e.price);
    if (!byRoom.has(e.roomTypeId)) byRoom.set(e.roomTypeId, { dates: [], price: e.price });
    byRoom.get(e.roomTypeId)!.dates.push(e.date);
  }

  for (const [roomTypeId, { dates, price }] of byRoom) {
    await queuePriceSync(roomTypeId, dates, price);
  }

  return NextResponse.json({ ok: true, upserted: entries.length });
}

// DELETE /api/rates
// Remove overrides (reverts to basePrice). Two forms:
//   { roomTypeId, date }
//   { roomTypeId, start, end }   — clear a date range
export async function DELETE(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const b = body as Record<string, unknown>;
  if (!b.roomTypeId) return NextResponse.json({ error: 'roomTypeId required' }, { status: 400 });

  const roomTypeId = Number(b.roomTypeId);
  let dates: string[];

  if (b.date) {
    dates = [String(b.date)];
  } else if (b.start && b.end) {
    dates = nightsBetween(String(b.start), String(b.end));
  } else {
    return NextResponse.json({ error: 'date or start+end required' }, { status: 400 });
  }

  for (const date of dates) {
    await deleteRate(roomTypeId, date);
  }

  // Re-queue inventory sync so BDC gets updated with the base price
  const rt = await one<{ basePrice: number }>(`SELECT basePrice FROM RoomType WHERE id = ?`, [roomTypeId]);
  if (rt) await queuePriceSync(roomTypeId, dates, rt.basePrice);

  return NextResponse.json({ ok: true, deleted: dates.length });
}

type Entry = { roomTypeId: number; date: string; price: number };

function normaliseEntries(body: unknown): Entry[] {
  const b = body as Record<string, unknown>;

  // Explicit list
  if (Array.isArray(b.entries)) {
    return (b.entries as Record<string, unknown>[]).map(e => ({
      roomTypeId: Number(e.roomTypeId),
      date: String(e.date),
      price: Number(e.price),
    }));
  }

  // Range form
  if (b.roomTypeId && b.start && b.end && b.price != null) {
    const dates = nightsBetween(String(b.start), String(b.end));
    return dates.map(date => ({
      roomTypeId: Number(b.roomTypeId),
      date,
      price: Number(b.price),
    }));
  }

  return [];
}
