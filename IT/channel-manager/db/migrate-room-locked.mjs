// Migration: add roomLocked column to Booking.
// roomLocked = 1 means a staff member manually set this room — automation must not overwrite it.
// Safe to run repeatedly.
import { createClient } from '@libsql/client';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

const cols = (await db.execute(`PRAGMA table_info("Booking")`)).rows.map((r) => r.name);
if (cols.includes('roomLocked')) {
  console.log('Already migrated — roomLocked column exists.');
} else {
  await db.execute(`ALTER TABLE Booking ADD COLUMN roomLocked INTEGER NOT NULL DEFAULT 0`);
  console.log('Added roomLocked column (all existing rows default to 0).');
}
db.close();
