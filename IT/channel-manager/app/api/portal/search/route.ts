import { NextRequest, NextResponse } from 'next/server';
import { findBookingByGuestDetails } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/portal/search?firstName=&lastName=&checkIn=&checkOut=
// Returns the channelRef for a booking matching guest name + dates (portal step-1 login).
// Requires Bearer CM_API_KEY (enforced by middleware).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const firstName = p.get('firstName')?.trim() ?? '';
  const lastName = p.get('lastName')?.trim() ?? '';
  const checkIn = p.get('checkIn')?.trim() ?? '';
  const checkOut = p.get('checkOut')?.trim() ?? '';

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!firstName || !lastName || !dateRe.test(checkIn) || !dateRe.test(checkOut)) {
    return NextResponse.json({ error: 'firstName, lastName, checkIn, checkOut are required' }, { status: 400 });
  }

  const result = await findBookingByGuestDetails(firstName, lastName, checkIn, checkOut);
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ ref: result.channelRef });
}
