import { NextRequest, NextResponse } from 'next/server';
import { findBookingFullByRef } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/portal/booking?ref=<channelRef>
// Returns full booking + CRM data for the guest portal and check-in page.
// Requires Bearer CM_API_KEY (enforced by middleware).
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')?.trim();
  if (!ref) return NextResponse.json({ error: 'ref is required' }, { status: 400 });

  const booking = await findBookingFullByRef(ref);
  if (!booking) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ booking });
}
