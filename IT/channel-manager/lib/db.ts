import { createClient, type Client, type InValue } from '@libsql/client';
import path from 'node:path';

const globalForDb = globalThis as unknown as { db?: Client };

function makeClient(): Client {
  // Default: SQLite file at db/dev.db in the project.
  // Override with DATABASE_URL (absolute file: URL, or libsql:// for Turso —
  // set DATABASE_AUTH_TOKEN alongside it).
  const raw = process.env.DATABASE_URL || 'file:./dev.db';
  const url = raw.startsWith('file:./')
    ? 'file:' + path.join(process.cwd(), 'db', raw.slice('file:./'.length))
    : raw;
  const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;
  return createClient(authToken ? { url, authToken } : { url });
}

export const db = globalForDb.db ?? makeClient();
if (process.env.NODE_ENV !== 'production') globalForDb.db = db;

// Small helpers
export async function all<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
  const rs = await db.execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  const rows = await all<T>(sql, args);
  return rows[0];
}

export async function run(sql: string, args: InValue[] = []) {
  return db.execute({ sql, args });
}
