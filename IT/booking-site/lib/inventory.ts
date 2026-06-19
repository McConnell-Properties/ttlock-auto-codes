// Unit inventory for calendar extras.
// Vented AC: 5 units total, 3 permanently unavailable → 2 sellable ("2/5").
// Parking: PARKING_SPACES (default 1) space(s) per night.
// cooking-pack / extra-guest: capped via CAPACITIES (availability check only; price in extras/route.ts).
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const REQUESTS = path.join(process.cwd(), '.data', 'extras-requests.json');
const CM_DB = path.resolve(process.cwd(), process.env.CM_DB_PATH || '../channel-manager/db/dev.db');

export const AC_TOTAL_UNITS = 5;
export const AC_BLOCKED_UNITS = 3;
export const AC_SELLABLE = AC_TOTAL_UNITS - AC_BLOCKED_UNITS; // 2
export const PARKING_SPACES = Math.max(1, Number(process.env.PARKING_SPACES) || 1);

export const CAPACITIES: Record<string, number> = {
  aircon: AC_SELLABLE,
  parking: PARKING_SPACES,
  'cooking-pack': 5,
  'extra-guest-double': 2,
  'extra-guest-single': 2,
};

type ActiveRange = { start: string; end: string };

// Returns the date-range list for a given extra, from Turso if DATABASE_URL is set,
// or from the flat file otherwise (local dev).
export async function loadActiveRanges(extraId: string): Promise<ActiveRange[]> {
  if (process.env.DATABASE_URL) {
    try {
      const db = createClient({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN || '' });
      const rs = await db.execute({
        sql: `SELECT date, nights FROM GuestExtraRequest
              WHERE extraId = ? AND date IS NOT NULL AND status != 'pending-payment'`,
        args: [extraId],
      });
      db.close();
      return (rs.rows as any[]).map((r) => {
        const d = new Date(r.date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + Math.max(1, r.nights || 1));
        return { start: r.date as string, end: d.toISOString().slice(0, 10) };
      });
    } catch { /* fall through to flat file */ }
  }
  // flat-file fallback
  try {
    const all: Array<{ extraId: string; date: string | null; nights: number | null; status: string }> =
      JSON.parse(fs.readFileSync(REQUESTS, 'utf8'));
    return all
      .filter((r) => r.extraId === extraId && r.date && r.status !== 'pending-payment')
      .map((r) => {
        const d = new Date(r.date! + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + Math.max(1, r.nights || 1));
        return { start: r.date!, end: d.toISOString().slice(0, 10) };
      });
  } catch {
    return [];
  }
}

// Units free on a given night, given pre-loaded ranges.
export function unitsFree(extraId: string, date: string, preloaded: ActiveRange[]): number {
  const capacity = CAPACITIES[extraId] ?? 1;
  const booked = preloaded.filter((b) => b.start <= date && date < b.end).length;
  return Math.max(0, capacity - booked);
}

// Free for every night of [startDate, startDate+nights)? Async — loads ranges internally.
export async function rangeAvailable(extraId: string, startDate: string, nights: number): Promise<boolean> {
  const ranges = await loadActiveRanges(extraId);
  const d = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < nights; i++) {
    if (unitsFree(extraId, d.toISOString().slice(0, 10), ranges) < 1) return false;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return true;
}

// Display totals: AC shows "x/5" (3 permanently sold), parking "x/N".
export function displayTotal(extraId: string): number {
  if (extraId === 'aircon') return AC_TOTAL_UNITS;
  return CAPACITIES[extraId] ?? 1;
}
