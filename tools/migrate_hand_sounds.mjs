// 2026-11-14: sounds follow the hand. Every collision file's sound distances move to the hand rule
// (fullDistance 0.06 m, maxDistance 0.35 m); the previous file goes to collisions/history first (saveCollisions).
// Detail (voxel), parts, names, sounds, volume and vibration settings are kept.
//   node tools/migrate_hand_sounds.mjs [--dry]
import fs from 'fs';
import path from 'path';
import { COLLISIONS } from './scan_lib.mjs';
import { saveCollisions } from './make_collisions.mjs';
import { SOUND_DEFAULTS } from '../web/collision_core.js';

const dry = process.argv.includes('--dry');
for (const f of fs.readdirSync(COLLISIONS).filter((n) => n.endsWith('.json')).sort()) {
  const id = f.replace(/\.json$/, ''), data = JSON.parse(fs.readFileSync(path.join(COLLISIONS, f), 'utf8'));
  const changed = [];
  for (const c of data.collisions) {
    if (c.fullDistance === SOUND_DEFAULTS.fullDistance && c.maxDistance === SOUND_DEFAULTS.maxDistance) continue;
    changed.push(`${c.name} ${c.fullDistance}/${c.maxDistance}`);
    c.fullDistance = SOUND_DEFAULTS.fullDistance; c.maxDistance = SOUND_DEFAULTS.maxDistance;
  }
  if (changed.length && !dry) saveCollisions(id, data);
  const custom = changed.filter((s) => !s.endsWith(' 0.5/4'));
  console.log(`${id}: ${changed.length} shapes → ${SOUND_DEFAULTS.fullDistance}/${SOUND_DEFAULTS.maxDistance} m${custom.length ? ` (custom before: ${custom.join(', ')})` : ''}${dry ? ' [dry]' : ''}`);
}
