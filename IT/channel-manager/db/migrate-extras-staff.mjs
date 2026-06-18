// Migration: add billing + addedBy to ExtrasRequest. Safe to run repeatedly.
//   node db/migrate-extras-staff.mjs
import { createClient } from '@libsql/client';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

try { await db.execute(`ALTER TABLE ExtrasRequest ADD COLUMN "billing" TEXT NOT NULL DEFAULT 'charge'`); }
catch (e) { if (!String(e).includes('duplicate column')) throw e; }

try { await db.execute(`ALTER TABLE ExtrasRequest ADD COLUMN "addedBy" TEXT NOT NULL DEFAULT 'guest'`); }
catch (e) { if (!String(e).includes('duplicate column')) throw e; }

console.log('ExtrasRequest: billing + addedBy columns ready.');
db.close();
