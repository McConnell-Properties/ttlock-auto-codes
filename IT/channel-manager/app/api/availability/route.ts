import { NextRequest, NextResponse } from 'next/server';
import { listProperties, listRoomTypes, stayQuote } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD[&property=id][&adults=2][&children=1]
// Room types available for the stay, with live availability and a full quote
// breakdown (LOS discount + extra-guest fees applied — direct-booking pricing).
export async function GET(req: NextRequest) {
  const checkIn = req.nextUrl.searchParams.get('checkIn') || '';
  const checkOut = req.nextUrl.searchParams.get('checkOut') || '';
  const property = req.nextUrl.searchParams.get('property');
  const adults = Math.max(1, Number(req.nextUrl.searchParams.get('adults')) || 1);
  const children = Math.max(0, Number(req.nextUrl.searchParams.get('children')) || 0);
  const promo = req.nextUrl.searchParams.get('promo');
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(checkIn) || !dateRe.test(checkOut) || checkOut <= checkIn) {
    return NextResponse.json({ error: 'checkIn/checkOut must be YYYY-MM-DD with checkOut after checkIn' }, { status: 400 });
  }

  const [properties, roomTypes] = await Promise.all([listProperties(), listRoomTypes(property ?? undefined)]);
  const out = [];
  for (const rt of roomTypes) {
    const q = await stayQuote(rt.id, checkIn, checkOut, adults, children, promo);
    if (!q) continue;
    out.push({
      propertyId: rt.propertyId,
      propertyName: properties.find((p) => p.id === rt.propertyId)?.name,
      roomTypeId: rt.id,
      roomTypeName: rt.name,
      available: q.available,
      nights: q.nights,
      baseTotal: q.baseTotal,
      directPct: q.directPct,
      directDiscount: q.directDiscount,
      losPct: q.losPct,
      losDiscount: q.losDiscount,
      guestFees: q.guestFees,
      promoCode: q.promoCode,
      promoValid: q.promoValid,
      promoDiscount: q.promoDiscount,
      totalPrice: q.totalPrice,
    });
  }
  return NextResponse.json({ checkIn, checkOut, adults, children, promo: promo || null, results: out });
}
