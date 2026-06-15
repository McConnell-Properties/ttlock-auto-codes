import { NextResponse } from 'next/server';
import { listProperties, listRoomTypes } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/properties — properties with their room types (public info)
export async function GET() {
  const [properties, roomTypes] = await Promise.all([listProperties(), listRoomTypes()]);
  return NextResponse.json({
    properties: properties.map((p) => ({
      id: p.id,
      name: p.name,
      roomTypes: roomTypes
        .filter((rt) => rt.propertyId === p.id)
        .map((rt) => ({
          id: rt.id,
          name: rt.name,
          totalUnits: rt.totalUnits,
          basePrice: rt.basePrice,
        })),
    })),
  });
}
