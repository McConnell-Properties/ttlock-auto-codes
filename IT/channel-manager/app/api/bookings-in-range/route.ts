import { NextRequest, NextResponse } from 'next/server';
import { bookingsInRange } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/bookings-in-range?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const start = searchParams.get('start') ?? '';
  const end = searchParams.get('end') ?? '';
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(start) || !dateRe.test(end) || end <= start) {
    return NextResponse.json({ error: 'start and end (YYYY-MM-DD, end after start) required' }, { status: 400 });
  }
  const bookings = await bookingsInRange(start, end);
  return NextResponse.json({ bookings });
}
