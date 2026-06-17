import { NextRequest, NextResponse } from 'next/server';
import { bookingsInWindowAll, ratesForWindow, dateRange } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const start = searchParams.get('start') ?? '';
  const days = Math.min(Math.max(1, Number(searchParams.get('days') || 14)), 60);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return NextResponse.json({ error: 'bad start' }, { status: 400 });
  }
  const end = dateRange(start, days + 1)[days];
  const [bookingRows, rateRows] = await Promise.all([
    bookingsInWindowAll(start, end),
    ratesForWindow(start, end),
  ]);
  const rates: Record<number, Record<string, number>> = {};
  for (const r of rateRows) {
    (rates[r.roomTypeId] = rates[r.roomTypeId] || {})[r.date] = r.price;
  }
  const bookings = bookingRows.map((b) => ({
    id: b.id,
    guestName: b.guestName,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    propertyId: b.propertyId,
    roomTypeId: b.roomTypeId,
    physicalRoom: b.physicalRoom,
    roomTypeName: b.roomTypeName,
    channel: b.channel,
    channelRef: b.channelRef,
    email: b.email,
    phone: b.phone,
    adults: b.adults,
    children: b.children,
    totalPrice: b.totalPrice,
    notes: b.notes,
    stripeStatus: b.stripeStatus,
    stripePaymentUrl: b.stripePaymentUrl,
  }));
  return NextResponse.json({ dates: dateRange(start, days), bookings, rates });
}
