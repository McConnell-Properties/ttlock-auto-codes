// Length-of-stay discounts — read from the same discounts.csv that quote.py
// uses, so direct-site prices and room-switch quotes always match.
import fs from 'node:fs';
import path from 'node:path';

const QUOTE_DIR = process.env.QUOTE_DIR || '../../special quote';

let cache: { nights: number; discount: number }[] | null = null;

export function discountTiers() {
  if (cache) return cache;
  const file = path.resolve(process.cwd(), QUOTE_DIR, 'data', 'discounts.csv');
  const tiers: { nights: number; discount: number }[] = [];
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1);
    for (const line of lines) {
      const [n, d] = line.split(',');
      if (!n || !d) continue;
      tiers.push({ nights: Number(n), discount: parseFloat(d) / (parseFloat(d) > 1 ? 100 : 1) });
    }
  } catch {
    // fallback to known tiers if file unreadable
    tiers.push({ nights: 2, discount: 0.2 }, { nights: 3, discount: 0.26 }, { nights: 5, discount: 0.32 }, { nights: 7, discount: 0.35 });
  }
  tiers.sort((a, b) => a.nights - b.nights);
  cache = tiers;
  return tiers;
}

// Nearest tier at or below the stay length; 1 night = 0%.
export function stayDiscount(nights: number): number {
  let best = 0;
  for (const t of discountTiers()) if (nights >= t.nights) best = t.discount;
  return best;
}

export function discounted(total: number, nights: number) {
  const rate = stayDiscount(nights);
  return { rate, total: Math.round(total * (1 - rate) * 100) / 100 };
}
