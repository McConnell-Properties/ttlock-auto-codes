// Unit inventory for extras.
// Capacities are hardcoded here as fallbacks; Turso ExtraCapacity overrides them
// once that migration runs on prod (see ledger NEEDS-PM entry).
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const REQUESTS = path.join(process.cwd(), '.data', 'extras-requests.json');

export const AC_TOTAL_UNITS = 5;
export const AC_BLOCKED_UNITS = 3;
export const AC_SELLABLE = AC_TOTAL_UNITS - AC_BLOCKED_UNITS; // 2
export const PARKING_SPACES = Math.max(1, Number(process.env.PARKING_SPACES) || 1);

// Sellable capacity per extra type.
export const CAPACITIES: Record<string, number> = {
  aircon:              AC_SELLABLE,
  parking:             PARKING_SPACES,
  'cooking-pack':      5,
  'extra-guest-double': 2,
  'extra-guest-single': 2,
};

type ActiveRange = { start: string; end: string };

function toRanges(rows: { date: string | null; nights: number | null; status: string }[]): ActiveRange[] {
  return rows
    .filter((r) => r.date && r.status !== 'pending-payment')
    .map((r) => {
      const d = new Date(r.date! + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + Math.max(1, r.nights || 1));
      return { start: r.date!, end: d.toISOString().slice(0, 10) };
    });
}

// Pre-fetch active date ranges for a given extra — call once per request, then
// pass the result to unitsFree() to avoid per-day DB queries in calendar loops.
export async function loadActiveRanges(extraId: string): Promise<ActiveRange[]> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || '' });
    try {
      const rs = await db.execute({
        sql: `SELECT date, nights, status FROM GuestExtraRequest WHERE extraId = ? AND date IS NOT NULL`,
        args: [extraId],
      });
      return toRanges(rs.rows as any[]);
    } finally {
      db.close();
    }
  }
  // local dev fallback: flat JSON file
  try {
    const all: { extraId: string; date: string | null; nights: number | null; status: string }[] =
      JSON.parse(fs.readFileSync(REQUESTS, 'utf8'));
    return toRanges(all.filter((r) => r.extraId === extraId));
  } catch { return []; }
}

// Units free on a given night. Requires pre-loaded ranges from loadActiveRanges().
export function unitsFree(extraId: string, date: string, preloaded: ActiveRange[]): number {
  const sellable = CAPACITIES[extraId] ?? 1;
  const booked = preloaded.filter((b) => b.start <= date && date < b.end).length;
  return Math.max(0, sellable - booked);
}

// Free for every night of [startDate, startDate+nights)?
export async function rangeAvailable(extraId: string, startDate: string, nights: number): Promise<boolean> {
  const ranges = await loadActiveRanges(extraId);
  const d = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < nights; i++) {
    if (unitsFree(extraId, d.toISOString().slice(0, 10), ranges) < 1) return false;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return true;
}

// Display total (shown as denominator in "x/N left").
// AC shows x/5 even though only 2 are sellable (3 are permanently blocked).
export function displayTotal(extraId: string): number {
  if (extraId === 'aircon') return AC_TOTAL_UNITS;
  return CAPACITIES[extraId] ?? 1;
}
