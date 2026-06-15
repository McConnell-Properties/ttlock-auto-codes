import { NextRequest, NextResponse } from 'next/server';
import { acNightPrice, parkingNightPrice, AC_INSTALL_FEE, PARKING_PER_USE_FEE } from '@/lib/dynamicPricing';
import { unitsFree, displayTotal } from '@/lib/inventory';
import { discountTiers } from '@/lib/discounts';

export const dynamic = 'force-dynamic';

// GET /api/extras-calendar?extra=aircon|parking[&days=30]
// → { fee, feeLabel, total, days: [{date, price, free, weather?}] }
export async function GET(req: NextRequest) {
  const extra = req.nextUrl.searchParams.get('extra');
  if (extra !== 'aircon' && extra !== 'parking') {
    return NextResponse.json({ error: 'extra must be aircon or parking' }, { status: 400 });
  }
  const days = Math.min(60, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30));

  const out: { date: string; price: number; free: number; weather?: string }[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (extra === 'aircon') {
      const { price, weather } = await acNightPrice(iso);
      out.push({
        date: iso,
        price,
        free: unitsFree('aircon', iso),
        weather: `${Math.round(weather.temp)}°C ${weather.band}${weather.seasonal ? ' (est.)' : ''}`,
      });
    } else {
      out.push({ date: iso, price: await parkingNightPrice(iso), free: unitsFree('parking', iso) });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return NextResponse.json({
    extra,
    total: displayTotal(extra),
    fee: extra === 'aircon' ? AC_INSTALL_FEE : PARKING_PER_USE_FEE,
    feeLabel: extra === 'aircon' ? 'one-off installation' : 'per-use access fee',
    // parking gets the same length-of-stay discount as rooms
    tiers: extra === 'parking' ? discountTiers().map((t) => ({ nights: t.nights, rate: t.discount })) : [],
    days: out,
  });
}
