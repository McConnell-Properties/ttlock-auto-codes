// Creates channel-manager bookings from a booking "intent" (single room or
// a room-switch plan). Idempotent per channelRef via a small local ledger.
import fs from 'node:fs';
import path from 'node:path';
import { cm, createBooking } from './cm';
import { contentByPhysicalRoom } from './content';

const LEDGER = path.join(process.cwd(), '.data', 'processed-payments.json');

export type Intent = {
  kind: 'single' | 'plan';
  checkIn: string;
  checkOut: string;
  guests: number;
  guestName: string;
  email: string;
  phone: string;
  notes: string;
  price: number; // charged total (discounted)
  roomTypeId?: number; // single
  plan?: string; // plan: "room:start:end:price|room:start:end:price"
  planLabel?: string;
};

function ledgerRead(): Record<string, number[]> {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; }
}
function ledgerWrite(ref: string, bookingIds: number[]) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  const all = ledgerRead();
  all[ref] = bookingIds;
  fs.writeFileSync(LEDGER, JSON.stringify(all, null, 2));
}
export function alreadyProcessed(ref: string): number[] | null {
  return ledgerRead()[ref] ?? null;
}

async function roomTypeIdByName(name: string): Promise<number | null> {
  const res = await fetch(`${await cm()}/api/properties`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  for (const p of data.properties || []) {
    for (const rt of p.roomTypes || []) if (rt.name === name) return rt.id;
  }
  return null;
}

export type CreateResult =
  | { ok: true; bookingIds: number[] }
  | { ok: false; soldOut: boolean; error: string; createdIds: number[] };

export async function createBookingsFromIntent(intent: Intent, channelRef: string): Promise<CreateResult> {
  const existing = alreadyProcessed(channelRef);
  if (existing) return { ok: true, bookingIds: existing };

  const guestSuffix = intent.guests > 1 ? ` (${intent.guests} guests)` : '';

  if (intent.kind === 'single' && intent.roomTypeId) {
    const r = await createBooking({
      roomTypeId: intent.roomTypeId,
      guestName: intent.guestName,
      checkIn: intent.checkIn,
      checkOut: intent.checkOut,
      email: intent.email || undefined,
      phone: intent.phone || undefined,
      totalPrice: intent.price,
      channelRef,
      notes: [intent.notes, `Booked on direct site${guestSuffix}.`].filter(Boolean).join(' | '),
    });
    if (!r.ok) return { ok: false, soldOut: !!(r as any).soldOut, error: (r as any).error, createdIds: [] };
    ledgerWrite(channelRef, [r.bookingId]);
    return { ok: true, bookingIds: [r.bookingId] };
  }

  // Room-switch plan: one booking per segment, linked via notes + channelRef.
  const segs = (intent.plan || '')
    .split('|')
    .map((s) => s.split(':'))
    .filter((p) => p.length === 4)
    .map(([room, start, end, price]) => ({ room, start, end, price: parseFloat(price) || 0 }));
  if (!segs.length) return { ok: false, soldOut: false, error: 'invalid plan', createdIds: [] };

  const createdIds: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const content = contentByPhysicalRoom(s.room);
    const rtId = content ? await roomTypeIdByName(content.name) : null;
    if (!rtId) return { ok: false, soldOut: false, error: `unknown room ${s.room}`, createdIds };
    const r = await createBooking({
      roomTypeId: rtId,
      guestName: intent.guestName,
      checkIn: s.start,
      checkOut: s.end,
      email: intent.email || undefined,
      phone: intent.phone || undefined,
      totalPrice: s.price,
      channelRef,
      notes: [
        `ROOM-SWITCH PLAN part ${i + 1}/${segs.length} — allocate Room ${s.room}.`,
        `Full plan: ${intent.planLabel || intent.plan}.`,
        intent.notes,
        `Booked on direct site${guestSuffix}.`,
      ].filter(Boolean).join(' | '),
    });
    if (!r.ok) {
      return {
        ok: false,
        soldOut: !!(r as any).soldOut,
        error: `${(r as any).error} (segment ${i + 1}: Room ${s.room} ${s.start}→${s.end}). ` +
          (createdIds.length ? `Already-created segment bookings: ${createdIds.join(', ')} — cancel them in the channel manager.` : ''),
        createdIds,
      };
    }
    createdIds.push(r.bookingId);
  }
  ledgerWrite(channelRef, createdIds);
  return { ok: true, bookingIds: createdIds };
}
