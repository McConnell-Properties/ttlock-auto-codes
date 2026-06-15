import { NextRequest, NextResponse } from 'next/server';
import { findGuestBookingByDetails, makeToken, PORTAL_COOKIE } from '@/lib/portal';
import { postCheckinUpsert } from '@/lib/cm';

export const dynamic = 'force-dynamic';

function siteUrl(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:4100';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const SITE = siteUrl(req);
  const form = await req.formData();
  const firstName = String(form.get('firstName') ?? '').trim();
  const lastName = String(form.get('lastName') ?? '').trim();
  const checkIn = String(form.get('checkIn') ?? '').trim();
  const checkOut = String(form.get('checkOut') ?? '').trim();

  if (!firstName || !lastName || !checkIn || !checkOut) {
    return NextResponse.redirect(`${SITE}/checkin?error=missing`, 303);
  }

  const booking = await findGuestBookingByDetails(firstName, lastName, checkIn, checkOut);
  if (!booking) {
    return NextResponse.redirect(`${SITE}/checkin?error=notfound`, 303);
  }

  const res = NextResponse.redirect(`${SITE}/checkin?step=2`, 303);
  res.cookies.set(PORTAL_COOKIE, makeToken(booking.ref), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600,
    path: '/',
  });

  // Best-effort Step 1 confirmation push — fire-and-forget.
  void postCheckinUpsert({ ref: booking.ref, confirmedAt: new Date().toISOString() });

  return res;
}
