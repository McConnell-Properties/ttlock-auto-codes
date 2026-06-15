// Deterministic BDC inventory sync. Pulls pending jobs from the queue,
// pushes rooms-to-sell to Booking.com via Playwright (no LLM), marks done/failed.
//
// First-time setup — save browser session:
//   SYNC_INVENTORY_HEADED=1 node scripts/sync-inventory.mjs
//   Log in when the browser opens; session persists in .bdc-profile/ for future headless runs.
//
// Normal automated run:
//   node scripts/sync-inventory.mjs
//
// Deps: npm install playwright && npx playwright install chromium

import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const APP  = dirname(here);

// ─── Config ───────────────────────────────────────────────────────────────────
const PROFILE_DIR    = join(APP, '.bdc-profile');
const LOG_DIR        = join(APP, 'automation', 'logs');
const SCREENSHOT_DIR = join(LOG_DIR, 'screenshots');
const LOG_FILE       = join(LOG_DIR, 'sync-inventory.log'); // run-job.sh routes stdout here
const LOCK_FILE      = join(LOG_DIR, '.sync-inventory.lock');
const HEADED         = process.env.SYNC_INVENTORY_HEADED === '1';
const DRYRUN         = process.env.SYNC_INVENTORY_DRYRUN === '1';
const MAX_RUN_MS     = 45 * 60 * 1000; // 45 min stale-lock threshold

// Fallback hotel IDs — also present in queue data as j.bdcHotelId
const HOTEL_IDS = {
  'Streatham Rooms': '14715886',
  'Gassiot House':   '15676333',
  'Tooting Stays':   '13576893',
  'Valnay Stays':    '15779662',
  'Seamless Stays':  '12686318',
};

// ─── .env ─────────────────────────────────────────────────────────────────────
const envPath = join(APP, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─── Logging ──────────────────────────────────────────────────────────────────
const ts  = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (...a) => console.log(`[${ts()}]`, ...a);

// ─── Serialization lock ───────────────────────────────────────────────────────
function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age < MAX_RUN_MS) {
      log('another run in progress (lock age', Math.round(age / 1000), 's) — exiting');
      process.exit(0);
    }
    log('stale lock (', Math.round(age / 60000), 'min old) — removing and proceeding');
  }
  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch { /* already gone */ }
}

// ─── Failure support ──────────────────────────────────────────────────────────
function writeFailLog(entry) {
  const name = `sync-failure-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  const path = join(LOG_DIR, name);
  writeFileSync(path, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }, null, 2));
  return path;
}

async function notify(summary, logPath) {
  const msg = summary.replace(/"/g, '\\"');
  spawnSync('osascript', ['-e',
    `display notification "${msg}" with title "BDC Sync" subtitle "Log: ${logPath}"`
  ], { stdio: 'ignore' });

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      const { createTransport } = await import('nodemailer');
      const t = createTransport({ service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
      await t.sendMail({
        from: process.env.GMAIL_USER,
        to:   process.env.GMAIL_USER,
        subject: `BDC Sync — ${summary}`,
        text: `${summary}\n\nLog:         ${logPath}\nScreenshots: ${SCREENSHOT_DIR}`,
      });
      log('failure email sent');
    } catch (e) {
      log('email notification error:', e.message);
    }
  }
}

// ─── Queue helpers ────────────────────────────────────────────────────────────
function runCli(...args) {
  const r = spawnSync(process.execPath,
    [join(APP, 'db', 'sync-cli.mjs'), ...args],
    { encoding: 'utf8', cwd: APP });
  if (r.status !== 0) throw new Error(`sync-cli ${args[0]} failed: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

const pullQueue = () =>
  JSON.parse(runCli('list', 'booking.com', '--type', 'inventory')).inventoryJobs ?? [];

function markDone(ids) {
  if (!ids.length) return;
  log('marking done:', ids.length, 'jobs');
  runCli('done', ids.join(','));
}

function markFailed(id, reason) {
  log(`marking failed #${id}:`, reason.slice(0, 80));
  runCli('failed', String(id), reason.slice(0, 200));
}

// ─── Date utils ───────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Split a sorted job list into ≤windowDays-wide calendar windows
function splitIntoWindows(jobs, windowDays) {
  const sorted = [...jobs].sort((a, b) => a.date.localeCompare(b.date));
  const windows = [];
  let i = 0;
  while (i < sorted.length) {
    const winEnd = addDays(sorted[i].date, windowDays - 1);
    const win = [];
    while (i < sorted.length && sorted[i].date <= winEnd) win.push(sorted[i++]);
    windows.push(win);
  }
  return windows;
}

// ─── Browser helpers ──────────────────────────────────────────────────────────
// Helpers injected into each BDC calendar page (from bdc-extranet-recipes.md).
const HELPER_JS = String.raw`
window.__bdc = {};
window.__bdc.setCalendarCell = async function(roomId, rowTestId, date, value) {
  const room = document.querySelector('[data-test-id="room-' + roomId + '"]');
  if (!room) return { error: 'room element not found: room-' + roomId };
  const row = room.querySelector('[data-test-id="' + rowTestId + '"]');
  if (!row) return { error: 'row not found: ' + rowTestId + ' in room ' + roomId };
  const cell = row.querySelector('[data-test-id="cell-' + date + '"]');
  if (!cell) return { error: 'cell not found: ' + date + ' (outside loaded window)' };
  const ph = cell.querySelector('[data-test-id="placeholder"]');
  if (!ph) return { error: 'placeholder missing in cell ' + date };
  const before = ph.textContent.trim();
  const fireClick = (el) => {
    const r = el.getBoundingClientRect();
    const o = { bubbles:true, cancelable:true, view:window, clientX:r.x+r.width/2, clientY:r.y+r.height/2 };
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t,o)));
  };
  fireClick(ph);
  await new Promise(r => setTimeout(r, 400));
  const input = cell.querySelector('input[data-test-id="editable"]');
  if (!input) return { error: 'input did not appear after click', before };
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles:true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true, cancelable:true }));
  input.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', code:'Enter', bubbles:true, cancelable:true }));
  await new Promise(r => setTimeout(r, 700));
  const after = cell.querySelector('[data-test-id="placeholder"]');
  return { before, after: after ? after.textContent.trim() : null };
};
window.__bdc.setRoomInventory = (rid, date, v) =>
  window.__bdc.setCalendarCell(rid, 'rooms-to-sell-row', date, v);
window.__bdc.readCell = (rid, date) => {
  const row = document.querySelector('[data-test-id="room-' + rid + '"] [data-test-id="rooms-to-sell-row"]');
  if (!row) return null;
  const cell = row.querySelector('[data-test-id="cell-' + date + '"]');
  if (!cell) return null;
  const ph = cell.querySelector('[data-test-id="placeholder"]');
  return ph ? ph.textContent.trim() : null;
};
window.__bdc.countRoomPlaceholders = (rid) => {
  const room = document.querySelector('[data-test-id="room-' + rid + '"]');
  if (!room) return -1;
  return room.querySelectorAll('[data-test-id="placeholder"]').length;
};
`;

async function injectHelpers(page) {
  await page.evaluate(HELPER_JS);
}

// Open + close the date-range picker to force a re-render of visible cells.
// First Escape often no-ops (as per runbook), so we press it twice.
async function nudgeRender(page) {
  await page.evaluate(() => {
    const candidates = [
      'input.av-date-field',
      '[data-test-id="date-from"]',
      '[class*="DateRange"] input',
      '[class*="daterange"] input',
      'input[class*="date" i]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return; }
    }
    document.body.click(); // fallback to give focus somewhere
  });
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

async function waitForGlobalPlaceholders(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('[data-test-id="placeholder"]').length);
    if (n > 0) return n;
    await page.waitForTimeout(500);
  }
  return 0;
}

async function waitForRoomPlaceholders(page, rid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await page.evaluate(
      (r) => (window.__bdc ? window.__bdc.countRoomPlaceholders(r) : -2), rid);
    if (n > 0) return n;
    if (n === -1) throw new Error(`room element missing: room-${rid}`);
    await page.waitForTimeout(500);
  }
  return 0;
}

// ─── Per-room push ────────────────────────────────────────────────────────────
// Returns { done: id[], failed: {j, reason}[] }.
// Never scrolls between cells within the same room (scrolling un-renders cells).
async function pushRoom(page, roomId, jobs) {
  const rid  = String(roomId);
  const done = [], failed = [];

  // Scroll this room into the viewport so its cells render (from bdc-extranet-recipes.md)
  await page.evaluate((r) => {
    const el = document.querySelector('[data-test-id="room-' + r + '"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, rid);
  await page.waitForTimeout(1200);

  // If cells still blank, nudge the render and wait again
  let phCount = await waitForRoomPlaceholders(page, rid, 6000);
  if (phCount === 0) {
    await nudgeRender(page);
    phCount = await waitForRoomPlaceholders(page, rid, 6000);
  }
  if (phCount === 0) {
    const reason = `placeholders=0 after nudge for room ${rid}`;
    for (const j of jobs) failed.push({ j, reason });
    return { done, failed };
  }

  // Edit each date cell; do NOT scroll between cells for the same room
  for (const j of jobs) {
    const target = String(j.value);
    try {
      const result = await page.evaluate(
        ([r, date, val]) => window.__bdc.setRoomInventory(r, date, val),
        [rid, j.date, target],
      );

      if (result.error) {
        failed.push({ j, reason: result.error });
        log(`  FAIL [${j.property}] room ${rid} ${j.date}: ${result.error}`);
        continue;
      }

      // Re-read placeholder as source of truth; immediate after:null can still mean committed
      let finalVal = result.after;
      if (finalVal === null || finalVal === '') {
        await page.waitForTimeout(900);
        finalVal = await page.evaluate(
          ([r, date]) => window.__bdc.readCell(r, date), [rid, j.date]);
      }

      if (String(finalVal) === target) {
        done.push(j.id);
        log(`  OK  [${j.property}] room ${rid} ${j.date}: ${result.before} → ${finalVal}`);
      } else if (String(result.before) === target) {
        // Already at target before our write — still mark done
        done.push(j.id);
        log(`  OK= [${j.property}] room ${rid} ${j.date}: already ${target}`);
      } else {
        failed.push({ j, reason: `wrote ${target}, read back ${String(finalVal)}` });
        log(`  MISMATCH [${j.property}] room ${rid} ${j.date}: target=${target} got=${finalVal}`);
      }
    } catch (e) {
      failed.push({ j, reason: e.message.slice(0, 200) });
      log(`  ERR [${j.property}] room ${rid} ${j.date}: ${e.message}`);
    }
  }

  return { done, failed };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  acquireLock();
  log('=== sync-inventory start ===');

  // Pull queue
  let allJobs;
  try {
    allJobs = pullQueue();
  } catch (e) {
    log('ERROR pulling queue:', e.message);
    const lp = writeFailLog({ step: 'pull-queue', error: e.message });
    await notify(`Failed to pull sync queue: ${e.message}`, lp);
    releaseLock();
    process.exit(1);
  }
  log(`queue: ${allJobs.length} pending inventory jobs`);

  // Split editable (date > today) vs past-dated (BDC blocks dates ≤ today)
  const today    = new Date().toISOString().slice(0, 10);
  const editable  = allJobs.filter(j => j.date > today);
  const pastDated = allJobs.filter(j => j.date <= today);
  log(`editable: ${editable.length}, past-dated (no-push): ${pastDated.length}`);

  // Dry-run: log intended writes and exit without touching BDC or marking the queue
  if (DRYRUN) {
    log('--- DRY RUN: intended writes ---');
    log(`past-dated (would mark done, not pushed): ${pastDated.length} jobs`);
    for (const j of pastDated) {
      log(`  [SKIP-PAST] ${j.property} / room ${j.bdcRoomId} / ${j.date} → ${j.value}`);
    }
    log(`editable (would push to BDC): ${editable.length} jobs`);
    for (const j of editable) {
      if (j.field && j.field !== 'inventory') {
        log(`  [REFUSE-NON-INVENTORY] ${j.property} / room ${j.bdcRoomId} / ${j.date} field=${j.field}`);
        continue;
      }
      log(`  [PUSH] ${j.property} / room ${j.bdcRoomId} / ${j.date} → ${j.value} (rooms-to-sell)`);
    }
    log('--- DRY RUN end — no writes made ---');
    log('=== sync-inventory end (dry-run) ===');
    return;
  }

  if (pastDated.length) markDone(pastDated.map(j => j.id));

  if (!editable.length) {
    log('nothing to push');
    log('=== sync-inventory end ===');
    releaseLock();
    return;
  }

  // Launch persistent browser (session lives in .bdc-profile/)
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !HEADED,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
  });

  const allDone = [], allFailed = [];

  try {
    const page = await context.newPage();

    // Navigate to BDC group homepage — the redirected URL contains a fresh ses= token
    log('obtaining ses token…');
    await page.goto('https://admin.booking.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const sesMatch = page.url().match(/[?&]ses=([^&]+)/);

    if (!sesMatch) {
      const spPath = join(SCREENSHOT_DIR, `session-expired-${Date.now()}.png`);
      await page.screenshot({ path: spPath, fullPage: true }).catch(() => {});
      const reason = 'BDC session expired — run: SYNC_INVENTORY_HEADED=1 node scripts/sync-inventory.mjs to log in';
      log('ERROR:', reason);
      const lp = writeFailLog({ step: 'session-check', error: reason, screenshotPath: spPath });
      for (const j of editable) markFailed(j.id, 'session expired');
      await notify(reason, lp);
      return; // finally still runs
    }

    const ses = sesMatch[1];
    log(`ses: ${ses.slice(0, 8)}…`);

    // Group by property
    const byProperty = {};
    for (const j of editable) (byProperty[j.property] = byProperty[j.property] || []).push(j);

    for (const [property, propJobs] of Object.entries(byProperty)) {
      const hotelId = propJobs[0].bdcHotelId || HOTEL_IDS[property];
      if (!hotelId) {
        log(`WARN: no hotel ID for "${property}" — skipping ${propJobs.length} jobs`);
        for (const j of propJobs) allFailed.push({ j, reason: 'unknown property/hotel ID' });
        continue;
      }
      log(`[${property}] hotel ${hotelId} — ${propJobs.length} jobs`);

      // Split into ≤30-day windows (BDC calendar max ~31 days per view)
      const windows = splitIntoWindows(propJobs, 30);

      for (const windowJobs of windows) {
        const fromDate  = windowJobs[0].date;
        const untilDate = windowJobs[windowJobs.length - 1].date;
        log(`  window ${fromDate} → ${untilDate} (${windowJobs.length} jobs)`);

        const calUrl = 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html' +
          `?hotel_id=${hotelId}&lang=en&ses=${ses}&view_mode=LIST&from=${fromDate}&until=${untilDate}`;

        try {
          await page.goto(calUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await injectHelpers(page);

          // Wait for initial render; nudge if cells are still blank
          const initialPH = await waitForGlobalPlaceholders(page, 10000);
          if (initialPH === 0) await nudgeRender(page);

          // Group by room; skip jobs with no bdcRoomId
          const byRoom = {};
          for (const j of windowJobs) {
            if (!j.bdcRoomId) {
              allFailed.push({ j, reason: 'null bdcRoomId — room type not mapped to BDC' });
              continue;
            }
            const rid = String(j.bdcRoomId);
            (byRoom[rid] = byRoom[rid] || []).push(j);
          }

          for (const [roomId, roomJobs] of Object.entries(byRoom)) {
            const { done, failed } = await pushRoom(page, roomId, roomJobs);
            allDone.push(...done);
            allFailed.push(...failed);
          }

          // Spot-check (Step 6 of runbook): reload and verify one successful cell per window
          const sample = windowJobs.find(j => j.bdcRoomId && allDone.includes(j.id));
          if (sample) {
            await page.goto(calUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await injectHelpers(page);
            const spPH = await waitForGlobalPlaceholders(page, 8000);
            if (spPH === 0) await nudgeRender(page);
            await page.evaluate((r) => {
              const el = document.querySelector('[data-test-id="room-' + r + '"]');
              if (el) el.scrollIntoView({ block: 'center' });
            }, String(sample.bdcRoomId));
            await page.waitForTimeout(1200);
            const spotVal = await page.evaluate(
              ([r, d]) => window.__bdc.readCell(r, d), [String(sample.bdcRoomId), sample.date]);
            const ok = String(spotVal) === String(sample.value);
            log(`  spot-check [${property}] room ${sample.bdcRoomId} ${sample.date}: ${spotVal} (want ${sample.value}) ${ok ? '✓' : '✗ MISMATCH'}`);
          }

        } catch (e) {
          const spPath = join(SCREENSHOT_DIR, `error-${property.replace(/\s+/g, '-')}-${Date.now()}.png`);
          await page.screenshot({ path: spPath, fullPage: true }).catch(() => {});
          log(`  ERROR [${property}] ${fromDate}→${untilDate}: ${e.message}`);
          writeFailLog({ step: 'push-window', property, hotelId, fromDate, untilDate,
            error: e.message, screenshotPath: spPath, jobIds: windowJobs.map(j => j.id) });
          for (const j of windowJobs) {
            if (!allDone.includes(j.id)) allFailed.push({ j, reason: e.message.slice(0, 200) });
          }
        }
      }
    }
  } finally {
    await context.close();
    releaseLock();
  }

  // Mark queue — must run on the Mac (satisfied: this script runs on the Mac)
  markDone(allDone);
  for (const { j, reason } of allFailed) markFailed(j.id, reason);

  log(`=== done: ${allDone.length}, failed: ${allFailed.length} ===`);

  if (allFailed.length) {
    const lp = writeFailLog({
      summary: `${allFailed.length} jobs failed`,
      failures: allFailed.map(({ j, reason }) =>
        ({ id: j.id, property: j.property, date: j.date, bdcRoomId: j.bdcRoomId, reason })),
    });
    await notify(`${allFailed.length} inventory job(s) failed`, lp);
  }
}

run().catch(async (e) => {
  log('FATAL:', e.message);
  const lp = writeFailLog({ step: 'fatal', error: e.message, stack: e.stack });
  await notify(`sync-inventory fatal: ${e.message}`, lp);
  releaseLock();
  process.exit(1);
});
