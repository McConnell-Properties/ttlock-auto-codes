import { NextRequest, NextResponse } from 'next/server';
import { upcomingBookingsWithDeposit } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/portal/upcoming
// Returns upcoming confirmed bookings with deposit status.
// Used by the booking-site's process-due-deposits scheduler.
// Requires Bearer CM_API_KEY (enforced by middleware).
export async function GET(_req: NextRequest) {
  const bookings = await upcomingBookingsWithDeposit();
  return NextResponse.json({ bookings });
}
