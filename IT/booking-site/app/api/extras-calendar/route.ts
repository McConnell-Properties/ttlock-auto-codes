import { NextRequest, NextResponse } from 'next/server';
import { acNightPrice, parkingNightPrice, acInstallFee, PARKING_PER_USE_FEE } from '@/lib/dynamicPricing';
import { loadActiveRanges, unitsFree, displayTotal, CAPACITIES } from '@/lib/inventory';
import { discountTiers } from '@/lib/discounts';
import { propertyForRequest } from '@/lib/properties';

export const dynamic = 'force-dynamic';

const CALENDAR_EXTRAS = new Set(Object.keys(CAPACITIES));

// GET /api/extras-calendar?extra=aircon|parking|cooking-pack|extra-guest-double|extra-guest-single[&days=30]
// → { fee, feeLabel, total, tiers, days: [{date, price, free, weather?}] }
export async function GET(req: NextRequest) {
  const extra = req.nextUrl.searchParams.get('extra') ?? '';
  if (!CALENDAR_EXTRAS.has(extra)) {
    return NextResponse.json({ error: `extra must be one of: ${Array.from(CALENDAR_EXTRAS).join(', ')}` }, { status: 400 });
  }
  const days = Math.min(60, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30));
  const prop = propertyForRequest(req);

  const preloaded = await loadActiveRanges(extra);

  const out: { date: string; price: number; free: number; weather?: string }[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < days; i++) {
    const iso = d.toISOString().slice(0, 10);
    const free = unitsFree(extra, iso, preloaded);

    if (extra === 'aircon') {
      const { price, weather } = await acNightPrice(iso);
      out.push({
        date: iso, price, free,
        weather: `${Math.round(weather.temp)}°C ${weather.band}${weather.seasonal ? ' (est.)' : ''}`,
      });
    } else if (extra === 'parking') {
      out.push({ date: iso, price: await parkingNightPrice(iso), free });
    } else if (extra === 'cooking-pack') {
      out.push({ date: iso, price: 15, free });
    } else {
      // extra-guest-double / extra-guest-single: show adult nightly rate as guide
      out.push({ date: iso, price: 5, free });
    }

    d.setUTCDate(d.getUTCDate() + 1);
  }

  let fee: number;
  let feeLabel: string;
  let tiers: { nights: number; rate: number }[] = [];

  if (extra === 'aircon') {
    fee = acInstallFee(prop.id);
    feeLabel = 'one-off installation';
  } else if (extra === 'parking') {
    fee = PARKING_PER_USE_FEE;
    feeLabel = 'per-use access fee';
    tiers = discountTiers().map((t) => ({ nights: t.nights, rate: t.discount }));
  } else if (extra === 'cooking-pack') {
    fee = 0;
    feeLabel = 'flat hire fee';
  } else {
    // extra-guest-double / extra-guest-single
    fee = 10;
    feeLabel = 'per-guest setup fee';
  }

  return NextResponse.json({
    extra,
    total: displayTotal(extra),
    fee,
    feeLabel,
    tiers,
    days: out,
  });
}
