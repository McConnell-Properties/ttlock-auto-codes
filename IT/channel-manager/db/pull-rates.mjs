// Pull nightly rates straight from the Google Sheet (no manual CSV exports).
// Reads every tab whose name contains a property keyword (fountain/streatham/
// gassiot/valnay/tooting/seamless), writes db/pricing/*.csv, then runs the
// importer. Your dynamic-pricing rules can live in the Sheet — whatever the
// tabs say becomes the channel manager's rates on the next pull.
//
// Setup (same credentials as your existing pipeline):
//   GOOGLE_SERVICE_ACCOUNT_JSON  path to the service-account key file (or inline JSON)
//   RATES_SPREADSHEET_ID         the rates spreadsheet id (falls back to SPREADSHEET_ID)
//   The sheet must be shared (viewer) with the service account's client_email.
//
// Usage:
//   node db/pull-rates.mjs            # pull + import + queue price sync jobs
//   node db/pull-rates.mjs --no-sync  # pull + import only
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSign } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));

// --- service account auth (JWT -> access token, no SDK needed) ---
const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!saRaw) { console.error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set'); process.exit(1); }
const sa = saRaw.trim().startsWith('{') ? JSON.parse(saRaw) : JSON.parse(readFileSync(saRaw, 'utf8'));

const spreadsheetId = process.env.RATES_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
if (!spreadsheetId) { console.error('RATES_SPREADSHEET_ID (or SPREADSHEET_ID) env var not set'); process.exit(1); }

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) { console.error('auth failed:', JSON.stringify(j)); process.exit(1); }
  return j.access_token;
}

const KEYWORDS = ['fountain', 'streatham', 'gassiot', 'valnay', 'tooting', 'seamless'];

const token = await accessToken();
const api = (path) =>
  fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());

const meta = await api('?fields=sheets.properties.title');
if (meta.error) { console.error('sheets API error:', JSON.stringify(meta.error)); process.exit(1); }
const tabs = (meta.sheets || [])
  .map((s) => s.properties.title)
  .filter((t) => KEYWORDS.some((k) => t.toLowerCase().includes(k)));

if (tabs.length === 0) {
  console.error('No tabs matched property keywords. Tabs found:',
    (meta.sheets || []).map((s) => s.properties.title).join(' | '));
  process.exit(1);
}

const outDir = join(here, 'pricing');
mkdirSync(outDir, { recursive: true });

for (const tab of tabs) {
  const data = await api(`/values/${encodeURIComponent(`'${tab}'`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
  if (data.error) { console.warn(`SKIP tab '${tab}':`, data.error.message); continue; }
  const rows = data.values || [];
  const csv = rows
    .map((r) => r.map((c) => {
      const s = c === null || c === undefined ? '' : String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
  const safe = tab.replace(/[^\w\- ]+/g, '').trim();
  writeFileSync(join(outDir, `${safe}.csv`), csv);
  console.log(`pulled '${tab}' -> db/pricing/${safe}.csv (${rows.length} rows)`);
}

// run the importer with the same flags
const args = ['db/import-rates.mjs', outDir, ...process.argv.slice(2)];
console.log('\nimporting...');
const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: join(here, '..') });
process.exit(r.status ?? 0);
