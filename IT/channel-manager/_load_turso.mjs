// One-time loader: pushes db/turso-import.json into the Turso cloud DB.
// Re-runnable (drops & recreates each table). Run from the channel-manager folder:
//   TURSO_URL="libsql://…" TURSO_TOKEN="…" node _load_turso.mjs
import { createClient } from '@libsql/client';
import fs from 'node:fs';

const url = process.env.TURSO_URL, authToken = process.env.TURSO_TOKEN;
if (!url || !authToken) { console.error('Set TURSO_URL and TURSO_TOKEN.'); process.exit(1); }
const db = createClient({ url, authToken });

const { schema, tables } = JSON.parse(fs.readFileSync('db/turso-import.json','utf8'));

// fresh slate so the script can be re-run safely
for (const t of Object.keys(tables)) await db.execute(`DROP TABLE IF EXISTS "${t}"`);
for (const sql of schema) { try { await db.execute(sql); } catch(e){ if(!/already exists/.test(e.message)) throw e; } }
console.log('schema created.');

let grand = 0;
for (const [t, { cols, rows }] of Object.entries(tables)) {
  if (!rows.length) { console.log(`  ${t}: 0`); continue; }
  const ph = '(' + cols.map(()=>'?').join(',') + ')';
  const sql = `INSERT INTO "${t}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES ${ph}`;
  const CHUNK = 500;
  for (let i=0;i<rows.length;i+=CHUNK){
    await db.batch(rows.slice(i,i+CHUNK).map(args=>({ sql, args })), 'write');
  }
  console.log(`  ${t}: ${rows.length}`);
  grand += rows.length;
}
console.log(`done — ${grand} rows loaded.`);
