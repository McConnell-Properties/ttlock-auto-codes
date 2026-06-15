// Unit inventory for calendar extras.
// Vented AC: 5 units total, 3 permanently unavailable → 2 sellable ("2/5").
// Parking: PARKING_SPACES (default 1) space(s) per night.
import fs from 'node:fs';
import path from 'node:path';

const REQUESTS = path.join(process.cwd(), '.data', 'extras-requests.json');

export const AC_TOTAL_UNITS = 5;
export const AC_BLOCKED_UNITS = 3;
export const AC_SELLABLE = AC_TOTAL_UNITS - AC_BLOCKED_UNITS; // 2
export const PARKING_SPACES = Math.max(1, Number(process.env.PARKING_SPACES) || 1);

type Req = { extraId: string; date: string | null; nights: number | null; status: string };

function activeRequests(extraId: string): { start: string; end: string }[] {
  let all: Req[] = [];
  try { all = JSON.parse(fs.readFileSync(REQUESTS, 'utf8')); } catch { /* none */ }
  return all
    .filter((r) => r.extraId === extraId && r.date && r.status !== 'pending-payment')
    .map((r) => {
      const d = new Date(r.date + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + Math.max(1, r.nights || 1));
      return { start: r.date!, end: d.toISOString().slice(0, 10) }; // end exclusive
    });
}

// Units free on a given night.
export function unitsFree(extraId: 'aircon' | 'parking', date: string): number {
  const sellable = extraId === 'aircon' ? AC_SELLABLE : PARKING_SPACES;
  const booked = activeRequests(extraId).filter((b) => b.start <= date && date < b.end).length;
  return Math.max(0, sellable - booked);
}

// Free for every night of [startDate, startDate+nights)?
export function rangeAvailable(extraId: 'aircon' | 'parking', startDate: string, nights: number): boolean {
  const d = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < nights; i++) {
    if (unitsFree(extraId, d.toISOString().slice(0, 10)) < 1) return false;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return true;
}

// Display totals: AC shows "x/5" (3 permanently sold), parking "x/N".
export function displayTotal(extraId: 'aircon' | 'parking'): number {
  return extraId === 'aircon' ? AC_TOTAL_UNITS : PARKING_SPACES;
}
