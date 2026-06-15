// Step 2 contact data collected during online check-in.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), '.data', 'checkin-contacts.json');

export type ContactMethod = {
  method: 'phone' | 'email' | 'whatsapp';
  value: string;
};

export type LuggageWanted = { date: string; nights: number; time: string };

export type CheckinContact = {
  ref: string;
  contactMethods: ContactMethod[];
  earlyCheckin: null | '1pm' | '2pm';
  earlyCheckinPrice: number | null; // price shown at Step 2 (display only; /api/extras recomputes)
  parking: boolean;
  luggage: LuggageWanted | null;
  cardSaved: boolean; // true once guest pays checkin extras via off_session checkout
  savedAt: string;
};

export function saveCheckinContact(data: Omit<CheckinContact, 'savedAt' | 'cardSaved'>): void {
  let all: Record<string, CheckinContact> = {};
  try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  all[data.ref] = { ...data, cardSaved: false, savedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function getCheckinContact(ref: string): CheckinContact | null {
  try {
    const all = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const rec = all[ref];
    if (!rec) return null;
    return { luggage: null, ...rec }; // backfill luggage for records saved before this field was added
  } catch { return null; }
}

export function markCardSaved(ref: string): void {
  let all: Record<string, CheckinContact> = {};
  try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  if (all[ref]) { all[ref] = { ...all[ref], cardSaved: true }; }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}
