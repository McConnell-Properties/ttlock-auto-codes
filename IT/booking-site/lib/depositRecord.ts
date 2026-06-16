import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), '.data', 'deposits.json');

export type DepositRecord = {
  ref: string;
  paymentIntent: string | null;   // Stripe PI id (null until webhook fires)
  checkoutSession: string | null; // Stripe Checkout Session id
  status: string;                 // 'pending' | 'hold_active' | 'captured' | 'cancelled' | 'failed'
  amount: number;                 // GBP face value (80)
  mode: 'hold' | 'charge' | 'prepaid' | null; // set on webhook
  property: string;
  createdAt: string;
  updatedAt: string;
};

const SECURED = new Set(['hold_active', 'captured', 'paid', 'succeeded']);

export function isDepositSecured(status: string): boolean {
  return SECURED.has(status);
}

function read(): Record<string, DepositRecord> {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function write(all: Record<string, DepositRecord>) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function getDepositRecord(ref: string): DepositRecord | null {
  return read()[ref] ?? null;
}

export function saveDepositRecord(record: DepositRecord): void {
  const all = read();
  all[record.ref] = record;
  write(all);
}

export function updateDepositStatus(
  ref: string,
  updates: Partial<Pick<DepositRecord, 'paymentIntent' | 'status' | 'mode' | 'updatedAt'>>
): DepositRecord | null {
  const all = read();
  const rec = all[ref];
  if (!rec) return null;
  all[ref] = { ...rec, ...updates, updatedAt: updates.updatedAt ?? new Date().toISOString() };
  write(all);
  return all[ref];
}

export function getAllDepositRecords(): DepositRecord[] {
  return Object.values(read());
}
