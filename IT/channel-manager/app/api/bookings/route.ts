import { NextRequest, NextResponse } from 'next/server';
import { createBookingWithSync, stayQuote, listBookings } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/bookings[?status=confirmed|cancelled|all] — list (admin/internal use)
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') || 'confirmed';
  return NextResponse.json({ bookings: await listBookings(status) });
}

// POST /api/bookings — create a booking (the direct booking site calls this
// after Stripe payment succeeds). Validates live availability, creates the
// booking and queues inventory pushes to the OTAs automatically.
//
// Body: { roomTypeId, guestName, checkIn, checkOut, adults?, children?, email?,
//         phone?, units?, totalPrice?, channelRef?, notes?, channel? (default 'direct') }
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const { roomTypeId, guestName, checkIn, checkOut } = body || {};
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!roomTypeId || !guestName || !dateRe.test(checkIn || '') || !dateRe.test(checkOut || '') || checkOut <= checkIn) {
    return NextResponse.json({ error: 'roomTypeId, guestName, checkIn, checkOut (YYYY-MM-DD, checkOut after checkIn) are required' }, { status: 400 });
  }

  const units = Number(body.units) || 1;
  const adults = Math.max(1, Number(body.adults) || 1);
  const children = Math.max(0, Number(body.children) || 0);
  const promoCode = body.promoCode ? String(body.promoCode) : null;
  const quote = await stayQuote(Number(roomTypeId), checkIn, checkOut, adults, children, promoCode);
  if (!quote) return NextResponse.json({ error: 'unknown roomTypeId' }, { status: 404 });
  if (promoCode && quote.promoValid === false) {
    return NextResponse.json({ error: 'invalid promo code' }, { status: 400 });
  }
  if (quote.available < units) {
    return NextResponse.json({ error: 'not enough availability', available: quote.available }, { status: 409 });
  }

  const id = await createBookingWithSync({
    roomTypeId: Number(roomTypeId),
    guestName: String(guestName),
    email: body.email || null,
    phone: body.phone || null,
    checkIn,
    checkOut,
    units,
    adults,
    children,
    channel: body.channel || 'direct',
    channelRef: body.channelRef || null,
    totalPrice: body.totalPrice != null ? Number(body.totalPrice) : quote.totalPrice,
    notes: [body.notes, quote.promoCode ? `promo:${quote.promoCode}` : null].filter(Boolean).join(' · ') || null,
  });

  return NextResponse.json({ ok: true, bookingId: id, quote }, { status: 201 });
}
