// Protected POST endpoint for the deposit scheduler.
// Returns all bookings whose deposit is due today and not yet secured.
// Call daily at 15:00 Europe/London (the timing rules are all "at 3pm").
//
// @CHARLIE — TRIGGER NEEDED (pick one):
//   (a) Mac launchd/cron at 15:00 daily:
//       curl -X POST -H "Authorization: Bearer $PROCESS_DEPOSITS_SECRET" \
//            https://www.streathamrooms.co.uk/api/checkin/process-due-deposits
//   (b) CM Vercel Cron (vercel.json) calling the same URL over HTTPS.
//
// Set PROCESS_DEPOSITS_SECRET in .env to protect the endpoint.
// Future: extend to send email/SMS to guests with deposit links.
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { getDepositRecord, isDepositSecured } from '@/lib/depositRecord';

export const dynamic = 'force-dynamic';

const CHECKIN_DATA =
  process.env.CHECKIN_DATA_PATH ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/IT/ttlock-auto-codes/automation-data/checkin_data.json';

function depositDueDate(checkIn: string, checkOut: string): string {
  const ci = new Date(checkIn + 'T00:00:00Z');
  const co = new Date(checkOut + 'T00:00:00Z');
  const nights = Math.round((co.getTime() - ci.getTime()) / 86400000);
  let due: Date;
  if (nights <= 1)    { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 4); }
  else if (nights === 2) { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 3); }
  else if (nights === 3) { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 2); }
  else if (nights === 4) { due = new Date(ci); due.setUTCDate(due.getUTCDate() - 1); }
  else if (nights === 5) { due = new Date(ci); }
  else { due = new Date(co); due.setUTCDate(due.getUTCDate() - 5); }
  return due.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const secret = process.env.PROCESS_DEPOSITS_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const due: {
    ref: string;
    checkIn: string;
    checkOut: string;
    guestName: string;
    dueDate: string;
    depositStatus: string;
  }[] = [];

  try {
    const data = JSON.parse(fs.readFileSync(CHECKIN_DATA, 'utf8'));
    for (const [ref, r] of Object.entries<any>(data)) {
      if (!r.checkIn || !r.checkOut) continue;
      const dueDate = depositDueDate(r.checkIn, r.checkOut);
      if (dueDate !== today) continue;
      const depositRecord = getDepositRecord(ref);
      const status = depositRecord?.status ?? r.stripeStatus ?? 'none';
      if (isDepositSecured(status)) continue;
      due.push({
        ref,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        guestName: r.guestName ?? '',
        dueDate,
        depositStatus: status,
      });
    }
  } catch (e) {
    return NextResponse.json({ error: 'failed to read bookings', detail: String(e) }, { status: 500 });
  }

  console.log(`process-due-deposits: ${today} → ${due.length} deposit(s) due`);
  return NextResponse.json({ date: today, due });
}
