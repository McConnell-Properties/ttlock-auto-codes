import { NextRequest, NextResponse } from 'next/server';
import { extrasForBooking } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const extras = await extrasForBooking(id);
  return NextResponse.json(extras);
}
