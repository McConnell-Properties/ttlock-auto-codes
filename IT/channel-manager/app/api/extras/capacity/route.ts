export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { listExtraCapacities, setExtraCapacity } from '@/lib/data';
import { EXTRAS } from '@/lib/extras';

const KNOWN_IDS = new Set(EXTRAS.map((e) => e.id));

export async function GET() {
  const capacities = await listExtraCapacities();
  return NextResponse.json({ capacities });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { extraId, capacity } = body ?? {};
  if (!extraId || !KNOWN_IDS.has(extraId))
    return NextResponse.json({ error: 'unknown extraId' }, { status: 400 });
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1)
    return NextResponse.json({ error: 'capacity must be a positive integer' }, { status: 400 });
  await setExtraCapacity(extraId, capacity);
  return NextResponse.json({ ok: true, extraId, capacity });
}
