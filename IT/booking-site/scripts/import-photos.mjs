// Copy room photos from Operations/Properties into public/rooms/<property>/<slug>/
// with web-safe names.  Run with: npm run import-photos
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.env.PHOTOS_DIR ||
  '/Users/charliemcconnell/Documents/Career/McConnell Enterprises/Operations/Properties';

const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const outRoot = path.join(process.cwd(), 'public', 'rooms');
fs.mkdirSync(outRoot, { recursive: true });

// Smart-lock how-to image for the portal check-in instructions.
const LOCK_IMG = path.join(SRC, 'Tooting Broadway', 'Photos', 'Jpg',
  'Interior-door-lock-Wifi-Fingerprint-Smart-Door-Lock-for-Home-Apartment1-500x500.jpg');
if (fs.existsSync(LOCK_IMG)) {
  fs.copyFileSync(LOCK_IMG, path.join(process.cwd(), 'public', 'smart-lock.jpg'));
  console.log('- smart lock image → public/smart-lock.jpg');
}

// ── Streatham ──────────────────────────────────────────────────────────────
// photo folder → site slug (flat layout: public/rooms/<slug>/)
const STREATHAM_SRC = path.join(SRC, 'Streatham Road', 'Photos');
const STREATHAM_MAP = {
  '1:4':    'triple-private',
  '2:3':    'double-ensuite',
  '5:6':    'superior-king-twin',
  '10:11':  'quad-shared',
  'Room 9': 'luxury-apartment',
  '8':      'comfort-twin-ensuite',
  '7':      'single-shared',
};

// ── Gassiot ────────────────────────────────────────────────────────────────
// photo folder → site slug (property-scoped: public/rooms/gassiot/<slug>/)
const GASSIOT_SRC = path.join(SRC, 'Gassiot Road');
const GASSIOT_MAP = {
  'G1': 'gassiot/g1',
  'G2': 'gassiot/g2',
  'G3': 'gassiot/g3',
  'G4': 'gassiot/g4',
  // G5 folder not found — skipped
  'G6': 'gassiot/g6',
  'G7': 'gassiot/g7',
};

// ── Tooting ────────────────────────────────────────────────────────────────
// Flat UUID-named photo folder — all rooms share one generic slug.
const TOOTING_SRC = path.join(SRC, 'Tooting Broadway', 'Photos', 'Jpg');
const TOOTING_SLUG = 'tooting/room';

function copyFolder(srcDir, slug, limit = 10) {
  const outDir = path.join(outRoot, slug);
  fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(srcDir)) {
    console.log(`  - ${srcDir}: source folder missing, skipped`);
    return 0;
  }
  const seen = new Set();
  let n = 0;
  for (const f of fs.readdirSync(srcDir).sort()) {
    const ext = path.extname(f).toLowerCase();
    if (!EXT.has(ext) || f.startsWith('.')) continue;
    const stem = path.basename(f, path.extname(f));
    const size = fs.statSync(path.join(srcDir, f)).size;
    const key = `${stem}:${size}`;
    if (seen.has(stem) || seen.has(key)) continue;
    seen.add(stem); seen.add(key);
    n++;
    const safe = `${String(n).padStart(2, '0')}${ext}`;
    fs.copyFileSync(path.join(srcDir, f), path.join(outDir, safe));
    if (n >= limit) break;
  }
  return n;
}

let total = 0;

console.log('\nStreatham:');
for (const [folder, slug] of Object.entries(STREATHAM_MAP)) {
  const n = copyFolder(path.join(STREATHAM_SRC, folder), slug);
  console.log(`  ${folder} → public/rooms/${slug}: ${n} photo(s)`);
  total += n;
}

console.log('\nGassiot:');
for (const [folder, slug] of Object.entries(GASSIOT_MAP)) {
  const n = copyFolder(path.join(GASSIOT_SRC, folder), slug);
  console.log(`  ${folder} → public/rooms/${slug}: ${n} photo(s)`);
  total += n;
}

console.log('\nTooting (shared generic photos):');
const n = copyFolder(TOOTING_SRC, TOOTING_SLUG, 6);
console.log(`  Photos/Jpg → public/rooms/${TOOTING_SLUG}: ${n} photo(s)`);
total += n;

console.log(`\nDone — ${total} photos imported.`);
