// Creates the SQLite tables. Safe to run repeatedly.
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const url = (process.env.DATABASE_URL || 'file:./dev.db').replace('file:./', `file:${here}/`);
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

await db.executeMultiple(readFileSync(join(here, 'schema.sql'), 'utf8'));
console.log('Database schema ready at', url);
db.close();
