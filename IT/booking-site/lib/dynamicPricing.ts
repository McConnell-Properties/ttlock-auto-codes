// Dynamic pricing for Vented AC and Parking — mirrors the Apps Script
// "ADD-ON PRICING SCRIPT" exactly, so the website and the Google Sheet agree.
//
// AC:      price = 10 + 20·(0.8·heatScore + 0.2·demandScore), clamped £10–£30
//          heatScore  = (maxTemp − 16) / (25 − 16), clamped 0–1
//          demandScore = (roomRate − 40) / (110 − 40), clamped 0–1
//          + £20 one-off installation per booking
// Parking: min(£25, max(£8, roomRate × 12%)) − £2 per night, + £5 per use
import { createClient } from '@libsql/client';
import path from 'node:path';
import { stayDiscount } from './discounts';

const CM_DB = path.resolve(process.cwd(), process.env.CM_DB_PATH || '../channel-manager/db/dev.db');
const WEATHER_KEY = process.env.GOOGLE_WEATHER_API_KEY || '';
const WEATHER_LAT = 51.43;
const WEATHER_LON = -0.16;

export const AC_INSTALL_FEE = 20;
export const PARKING_PER_USE_FEE = 5;

const SEASONAL_AVG_TEMPS: Record<number, number> = {
  1: 9, 2: 9, 3: 12, 4: 15, 5: 18, 6: 21, 7: 24, 8: 23, 9: 20, 10: 16, 11: 12, 12: 9,
};

// ---------- weather (cached ~6h) ----------

let weatherCache: { at: number; map: Record<string, number> } | null = null;

async function forecastMap(): Promise<Record<string, number>> {
  if (weatherCache && Date.now() - weatherCache.at < 6 * 3600 * 1000) return weatherCache.map;
  const map: Record<string, number> = {};
  if (WEATHER_KEY) {
    try {
      const url =
        `https://weather.googleapis.com/v1/forecast/days:lookup?key=${WEATHER_KEY}` +
        `&location.latitude=${WEATHER_LAT}&location.longitude=${WEATHER_LON}` +
        `&days=10&pageSize=10&unitsSystem=METRIC`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json: any = await res.json();
        const pad = (n: number) => String(n).padStart(2, '0');
        for (const d of json.forecastDays || []) {
          let key: string | null = null;
          if (d.displayDate?.year) key = `${d.displayDate.year}-${pad(d.displayDate.month)}-${pad(d.displayDate.day)}`;
          else if (d.interval?.startTime) key = d.interval.startTime.slice(0, 10);
          const t = d.maxTemperature?.degrees;
          if (key && typeof t === 'number') map[key] = t;
        }
      }
    } catch { /* fall back to seasonal */ }
  }
  weatherCache = { at: Date.now(), map };
  return map;
}

export type DayWeather = { temp: number; band: string; seasonal: boolean };

export async function weatherFor(date: string): Promise<DayWeather> {
  const map = await forecastMap();
  const seasonal = map[date] === undefined;
  const temp = seasonal ? SEASONAL_AVG_TEMPS[Number(date.slice(5, 7))] ?? 15 : map[date];
  let band = 'Cool';
  if (temp >= 29) band = 'Heatwave';
  else if (temp >= 26) band = 'Hot';
  else if (temp >= 22) band = 'Warm';
  else if (temp >= 18) band = 'Mild';
  return { temp, band, seasonal };
}

// ---------- average nightly room rate per date (demand proxy) ----------

const rateCache = new Map<string, { at: number; rates: Map<string, number>; base: number }>();

async function avgRates(propertyId = 'streatham'): Promise<{ rates: Map<string, number>; base: number }> {
  const cached = rateCache.get(propertyId);
  if (cached && Date.now() - cached.at < 3600 * 1000) return cached;
  const db = createClient({ url: `file:${CM_DB}` });
  const base = await db.execute({
    sql: 'SELECT AVG(basePrice) AS p FROM RoomType WHERE propertyId = ?',
    args: [propertyId],
  });
  const rows = await db.execute({
    sql: `SELECT r.date AS date, AVG(r.price) AS p FROM RateOverride r
          JOIN RoomType rt ON rt.id = r.roomTypeId
          WHERE rt.propertyId = ? AND r.date >= date('now')
          GROUP BY r.date`,
    args: [propertyId],
  });
  const rates = new Map<string, number>();
  for (const r of rows.rows as any[]) rates.set(String(r.date), Number(r.p));
  const entry = { at: Date.now(), rates, base: Number((base.rows[0] as any)?.p ?? 80) };
  rateCache.set(propertyId, entry);
  return entry;
}

async function roomRateFor(date: string, propertyId = 'streatham'): Promise<number> {
  const { rates, base } = await avgRates(propertyId);
  return rates.get(date) ?? base;
}

// ---------- per-night prices (identical maths to the GAS script) ----------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export async function acNightPrice(date: string, propertyId = 'streatham'): Promise<{ price: number; weather: DayWeather }> {
  const weather = await weatherFor(date);
  const roomRate = await roomRateFor(date, propertyId);
  const heat = clamp01((weather.temp - 16) / (25 - 16));
  const demand = clamp01((roomRate - 40) / (110 - 40));
  const price = Math.max(10, Math.min(30, Math.round(10 + 20 * (heat * 0.8 + demand * 0.2))));
  return { price, weather };
}

export async function parkingNightPrice(date: string, propertyId = 'streatham'): Promise<number> {
  const roomRate = await roomRateFor(date, propertyId);
  const base = Math.min(25, Math.max(8, roomRate * 0.12));
  return Math.round(Math.max(0, base - 2) * 100) / 100;
}

// Total for a stay of `nights` starting `startDate` (inclusive), + one-off fee.
// Parking gets the same length-of-stay discount tiers as rooms (on the nightly
// total only — the per-use fee is never discounted).
export async function calendarExtraTotal(
  extraId: 'aircon' | 'parking',
  startDate: string,
  nights: number,
  propertyId = 'streatham'
): Promise<number> {
  let nightly = 0;
  const d = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < nights; i++) {
    const iso = d.toISOString().slice(0, 10);
    nightly += extraId === 'aircon'
      ? (await acNightPrice(iso, propertyId)).price
      : await parkingNightPrice(iso, propertyId);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  if (extraId === 'parking') nightly *= 1 - stayDiscount(nights);
  const fee = extraId === 'aircon' ? AC_INSTALL_FEE : PARKING_PER_USE_FEE;
  return Math.round((nightly + fee) * 100) / 100;
}
