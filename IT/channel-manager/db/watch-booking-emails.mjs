// Always-on IMAP IDLE watcher — the instant front end of the booking-emails
// chain. Sits on the INBOX and the moment ANY new mail arrives, runs
// poll-booking-emails.mjs (which is idempotent, filters to booking.com, and
// triggers the Little Hotelier export + TTLock pipeline for affected
// properties). The every-5-min poll job stays installed as a safety net.
//
// Run by launchd with KeepAlive (com.mcconnell.cm.email-watch) — on any
// connection drop we exit and launchd restarts us.
//
//   node db/watch-booking-emails.mjs
//   Requires GMAIL_USER + GMAIL_APP_PASSWORD in .env (already set).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { ImapFlow } from 'imapflow';

const here = dirname(fileURLToPath(import.meta.url));

// minimal .env loader (CLI runs outside Next)
const envPath = join(here, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;
if (!user || !pass) { console.error('GMAIL_USER / GMAIL_APP_PASSWORD not set'); process.exit(1); }

const POLLER = join(here, 'poll-booking-emails.mjs');
const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// serialize poller runs: if one is in flight when new mail lands, queue ONE more
let running = false;
let pending = false;
function runPoller(reason) {
  if (running) { pending = true; return; }
  running = true;
  console.log(`${ts()} new mail (${reason}) — running poller`);
  const child = spawn(process.execPath, [POLLER], { stdio: 'inherit' });
  child.on('exit', (code) => {
    running = false;
    if (code !== 0) console.error(`${ts()} poller exited ${code}`);
    if (pending) { pending = false; runPoller('queued'); }
  });
}

const client = new ImapFlow({
  host: 'imap.gmail.com', port: 993, secure: true,
  auth: { user, pass }, logger: false,
});

client.on('error', (err) => { console.error(`${ts()} IMAP error: ${err.message}`); process.exit(1); });
client.on('close', () => { console.error(`${ts()} IMAP connection closed`); process.exit(1); });

await client.connect();
await client.mailboxOpen('INBOX');
console.log(`${ts()} watching INBOX via IMAP IDLE (instant booking-email reaction)`);

// 'exists' fires when the INBOX message count grows — i.e. new mail
client.on('exists', () => runPoller('IDLE'));

// catch anything that arrived while we were down
runPoller('startup');

// keep the IDLE alive forever; ImapFlow re-issues IDLE internally.
// Belt-and-braces: nudge the connection every 5 min so a silently dead
// socket is detected promptly (Gmail drops idle connections ~10 min).
setInterval(async () => {
  try { await client.noop(); } catch { process.exit(1); }
}, 5 * 60 * 1000);
