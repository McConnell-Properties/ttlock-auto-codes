import { NextRequest, NextResponse } from 'next/server';
import { findGuestBookingByDetails, makeToken, PORTAL_COOKIE } from '@/lib/portal';

export const dynamic = 'force-dynamic';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4100';

export async function POST(req: NextRequest) {
  const form = await req.formData();

  if (form.get('logout')) {
    const res = NextResponse.redirect(`${SITE}/portal`, 303);
    res.cookies.delete(PORTAL_COOKIE);
    return res;
  }

  const firstName = String(form.get('firstName') ?? '').trim();
  const lastName = String(form.get('lastName') ?? '').trim();
  const checkIn = String(form.get('checkIn') ?? '').trim();
  const checkOut = String(form.get('checkOut') ?? '').trim();

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const booking =
    firstName && lastName && dateRe.test(checkIn) && dateRe.test(checkOut)
      ? await findGuestBookingByDetails(firstName, lastName, checkIn, checkOut)
      : null;

  if (!booking) {
    return NextResponse.redirect(`${SITE}/portal?error=1`, 303);
  }

  const res = NextResponse.redirect(`${SITE}/portal`, 303);
  res.cookies.set(PORTAL_COOKIE, makeToken(booking.ref), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600,
    path: '/',
  });
  return res;
}
