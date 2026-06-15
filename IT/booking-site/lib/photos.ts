// Photo lookup: photos live in public/rooms/<slug>/ (populated by
// `npm run import-photos`). Falls back to empty list (UI shows placeholder).
import fs from 'node:fs';
import path from 'node:path';

const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export function roomPhotos(slug: string): string[] {
  try {
    const dir = path.join(process.cwd(), 'public', 'rooms', slug);
    return fs
      .readdirSync(dir)
      .filter((f) => EXT.has(path.extname(f).toLowerCase()))
      .sort()
      .slice(0, 10)
      .map((f) => `/rooms/${slug}/${encodeURIComponent(f)}`);
  } catch {
    return [];
  }
}
