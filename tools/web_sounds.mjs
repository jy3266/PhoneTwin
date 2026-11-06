// Copies the sound files that collision files use into web_scans/sounds, so the phone app (and the web) can
// download them from GitHub. Unreal keeps reading ARKO_PROJECT/PhoneTwinScans/sounds.
// node tools/web_sounds.mjs            → every collision file in web_scans
// (the collision editor calls copyScanSounds() before it publishes a save)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS, WEB_SCANS, writeIfChanged } from './scan_lib.mjs';

export const WEB_SOUNDS = path.join(WEB_SCANS, 'sounds');

/** Sound file names a collision file refers to (Unreal asset paths like /Game/… are skipped). */
export function soundsOf(collisionJson) {
  const names = new Set();
  for (const c of collisionJson.collisions || [])
    for (const s of [c.nearSound, c.touchSound]) if (s && !s.startsWith('/')) names.add(path.basename(s));
  return [...names];
}

/** Copies the sounds of these scans; returns the repository paths of the copies (for git add) and the missing names. */
export function copyScanSounds(ids) {
  fs.mkdirSync(WEB_SOUNDS, { recursive: true });
  const files = [], missing = [];
  for (const id of ids) {
    const file = path.join(WEB_SCANS, `${id}.collision.json`);
    if (!fs.existsSync(file)) continue;
    for (const name of soundsOf(JSON.parse(fs.readFileSync(file, 'utf8')))) {
      const src = path.join(SOUNDS, name);
      if (!fs.existsSync(src)) { missing.push(name); continue; }
      writeIfChanged(path.join(WEB_SOUNDS, name), fs.readFileSync(src));
      files.push(`web_scans/sounds/${name}`);
    }
  }
  return { files: [...new Set(files)], missing: [...new Set(missing)] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = fs.readdirSync(WEB_SCANS).filter((f) => f.endsWith('.collision.json')).map((f) => f.slice(0, -'.collision.json'.length));
  const r = copyScanSounds(ids);
  console.log(`소리 ${r.files.length}개 → web_scans/sounds${r.missing.length ? ` · 없는 파일 ${r.missing.length}개: ${r.missing.join(', ')}` : ''}`);
}
