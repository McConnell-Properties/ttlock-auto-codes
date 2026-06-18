export const dynamic = 'force-dynamic';

// GET /api/extras/availability?extra=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// P3 (booking-site / portal) gate contract:
//   Returns per-day availability for a single extra across a stay span.
//   The portal should call this at the payment step for the full stay [from, to).
//   "available" = remaining capacity after paid extras; unpaid quotes do NOT
//   consume capacity and are ignored here.
//   Response: { extra, from, to, capacity, days: [{ date, available }] }
//   A day with available=0 means the extra is fully booked for that night.

import { NextRequest, NextResponse } from 'next/server';
import { extraAvailable, dateRange } from '@/lib/data';
import { EXTRA_CAPACITY } from '@/lib/extras';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const extraId = searchParams.get('extra');
  const from    = searchParams.get('from');
  const to      = searchParams.get('to');

  if (!extraId || !from || !to)
    return NextResponse.json({ error: 'extra, from, to required' }, { status: 400 });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to <= from)
    return NextResponse.json({ error: 'invalid dates' }, { status: 400 });

  const capacity = EXTRA_CAPACITY[extraId];
  if (capacity === undefined)
    return NextResponse.json({ error: `unknown extra: ${extraId}` }, { status: 404 });

  const nights = dateRange(from, Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000));

  const days = await Promise.all(
    nights.map(async (date) => ({ date, available: await extraAvailable(extraId, date) }))
  );

  return NextResponse.json({ extra: extraId, from, to, capacity, days });
}
