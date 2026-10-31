// Makes the first collision file of every scan that has none. Files already there (your edits) are never touched.
//   node tools/make_collisions.mjs          every scan
//   node tools/make_collisions.mjs <id>     one scan
//   --force                                 rebuild even if a file exists (the old one goes to collisions/history first)
import fs from 'node:fs';
import path from 'node:path';
import { COLLISIONS, UNREAL_SCANS, WEB_SCANS, readPlyPositions, writeIfChanged } from './scan_lib.mjs';
import { buildCollisions } from '../web/collision_core.js';

export function saveCollisions(id, data) {
  const file = path.join(COLLISIONS, `${id}.json`);
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    fs.mkdirSync(path.join(COLLISIONS, 'history'), { recursive: true });
    fs.copyFileSync(file, path.join(COLLISIONS, 'history', `${id}_${stamp}.json`));
  }
  const text = JSON.stringify(data);
  writeIfChanged(file, text);
  writeIfChanged(path.join(WEB_SCANS, `${id}.collision.json`), text);   // what the web viewer shows
}

export function makeFor(id) {
  const buf = fs.readFileSync(path.join(UNREAL_SCANS, `${id}.ply`));
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(UNREAL_SCANS, `${id}.json`), 'utf8')); } catch { /* scan without meta: no seeds */ }
  return buildCollisions(id, readPlyPositions(buf), meta);
}

export function makeMissing(force = false, only = null) {
  const made = [];
  for (const name of fs.readdirSync(UNREAL_SCANS)) {
    if (!name.endsWith('.ply')) continue;
    const id = name.slice(0, -4);
    if (only && id !== only) continue;
    if (!force && fs.existsSync(path.join(COLLISIONS, `${id}.json`))) continue;
    const data = makeFor(id);
    saveCollisions(id, data);
    made.push(data);
  }
  return made;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'make_collisions.mjs') {
  const args = process.argv.slice(2), only = args.find((a) => !a.startsWith('--')) || null;
  for (const d of makeMissing(args.includes('--force'), only)) {
    console.log(d.scan);
    for (const c of d.collisions) console.log(`  ${String(c.id).padStart(3)} ${c.label.padEnd(14)} ${String(c.cells.length / 3).padStart(5)} 칸${c.fallback ? '  (스캔에서 못 찾아 공 모양)' : ''}`);
  }
}
