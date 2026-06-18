import { NextRequest, NextResponse } from 'next/server';
import { acNightPrice, parkingNightPrice, acInstallFee, PARKING_PER_USE_FEE } from '@/lib/dynamicPricing';
import { loadActiveRanges, unitsFree, displayTotal } from '@/lib/inventory';
import { discountTiers } from '@/lib/discounts';
import { propertyForRequest } from '@/lib/properties';

export const dynamic = 'force-dynamic';

const CALENDAR_EXTRAS = new Set(['aircon', 'parking', 'cooking-pack', 'extra-guest-double', 'extra-guest-single']);

// Flat nightly rate for fixed-price calendar extras.
const EXTRA_GUEST_NIGHT = 5;     // adult rate; child is half, applied client-side
const COOKING_PACK_HIRE = 15;    // one-off fee shown in the fee slot; no nightly cost
const EXTRA_GUEST_SETUP = 10;    // one-off setup fee

// GET /api/extras-calendar?extra=<id>[&days=30]
// → { fee, feeLabel, total, tiers, days: [{date, price, free, weather?}] }
export async function GET(req: NextRequest) {
  const property = propertyForRequest(req);
  const extra = req.nextUrl.searchParams.get('extra');
  if (!extra || !CALENDAR_EXTRAS.has(extra)) {
    return NextResponse.json({ error: 'unknown calendar extra' }, { status: 400 });
  }
  const days = Math.min(60, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30));

  const out: { date: string; price: number; free: number; weather?: string }[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);

  // Pre-fetch once; unitsFree() is then synchronous for each day in the loop.
  const activeRanges = await loadActiveRanges(extra);

  for (let i = 0; i < days; i++) {
    const iso = d.toISOString().slice(0, 10);

    if (extra === 'aircon') {
      const { price, weather } = await acNightPrice(iso);
      out.push({
        date: iso,
        price,
        free: unitsFree('aircon', iso, activeRanges),
        weather: `${Math.round(weather.temp)}°C ${weather.band}${weather.seasonal ? ' (est.)' : ''}`,
      });
    } else if (extra === 'parking') {
      out.push({ date: iso, price: await parkingNightPrice(iso), free: unitsFree('parking', iso, activeRanges) });
    } else if (extra === 'cooking-pack') {
      // No per-night cost — price is the flat hire fee shown once via the `fee` field.
      out.push({ date: iso, price: 0, free: unitsFree('cooking-pack', iso, activeRanges) });
    } else {
      // extra-guest-double / extra-guest-single — adult rate; child half-price shown client-side.
      out.push({ date: iso, price: EXTRA_GUEST_NIGHT, free: unitsFree(extra, iso, activeRanges) });
    }

    d.setUTCDate(d.getUTCDate() + 1);
  }

  let fee = 0;
  let feeLabel = '';
  if (extra === 'aircon')               { fee = acInstallFee(property.id); feeLabel = 'one-off installation'; }
  else if (extra === 'parking')         { fee = PARKING_PER_USE_FEE;       feeLabel = 'per-use access fee'; }
  else if (extra === 'cooking-pack')    { fee = COOKING_PACK_HIRE;          feeLabel = 'pack hire'; }
  else                                  { fee = EXTRA_GUEST_SETUP;          feeLabel = 'one-off setup fee'; }

  return NextResponse.json({
    extra,
    total: displayTotal(extra),
    fee,
    feeLabel,
    tiers: extra === 'parking' ? discountTiers().map((t) => ({ nights: t.nights, rate: t.discount })) : [],
    days: out,
  });
}
