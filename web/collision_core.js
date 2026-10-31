// Collision shapes made from the scan itself. Runs unchanged in the browser and in Node (no three.js here).
// A shape is a set of cubes (cells) on one grid shared by the whole scan, S frame (metres, Y up): cell (i,j,k) covers
// [i,i+1]*voxel on x, and so on. File format: PROTOCOL.md §5.

export const VOXEL = 0.04;
export const SOUND_DEFAULTS = { nearSound: '', touchSound: '', volume: 1, fullDistance: 0.5, maxDistance: 4, muted: false };

// how far (metres) a shape of this kind may reach from its centre; the phone's radius is often far too small for large things
const REACH = { bed: 1.4, couch: 1.3, sofa: 1.3, 'dining table': 1.2, table: 1.2, desk: 1.1, chair: 0.65, bench: 1, person: 0.6, refrigerator: 0.7,
  tv: 0.6, laptop: 0.3, keyboard: 0.3, backpack: 0.35, suitcase: 0.45, 'potted plant': 0.5, book: 0.2, mouse: 0.1, cup: 0.1, bottle: 0.14, remote: 0.13, 'cell phone': 0.1 };

const KEY = 1 << 16;   // ±32768 cells is over a kilometre; KEY^3 stays below 2^53, where every whole number is still exact
export const cellKey = (i, j, k) => (i + KEY / 2) * KEY * KEY + (j + KEY / 2) * KEY + (k + KEY / 2);
export const keyCell = (n) => { const k = n % KEY, r = (n - k) / KEY, j = r % KEY; return [(r - j) / KEY - KEY / 2, j - KEY / 2, k - KEY / 2]; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Occupied cells of a cloud: Map key -> point count. Cells with a single point are stray noise. */
export function occupancy(points, voxel = VOXEL) {
  const count = new Map();
  for (let p = 0; p + 2 < points.length; p += 3) {
    const key = cellKey(Math.floor(points[p] / voxel), Math.floor(points[p + 1] / voxel), Math.floor(points[p + 2] / voxel));
    count.set(key, (count.get(key) || 0) + 1);
  }
  const sum = [...count.values()].reduce((a, b) => a + b, 0), minHits = sum / Math.max(1, count.size) > 3 ? 2 : 1;
  for (const [k, n] of count) if (n < minHits) count.delete(k);
  return count;
}

const centre = (c, v) => [(c[0] + 0.5) * v, (c[1] + 0.5) * v, (c[2] + 0.5) * v];

/** Largest plane among pts (random sampling with a fixed seed, so a scan always gives the same result): {n, d, inliers} */
function largestPlane(pts, tolerance) {
  let best = null, seed = 12345;
  const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  for (let it = 0; it < 220; it++) {
    const a = pts[rnd(pts.length)], b = pts[rnd(pts.length)], c = pts[rnd(pts.length)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) continue;
    n[0] /= len; n[1] /= len; n[2] /= len;
    const d = -(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]);
    let hits = 0;
    for (const p of pts) if (Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] + d) < tolerance) hits++;
    if (!best || hits > best.hits) best = { n, d, hits };
  }
  return best;
}

/**
 * Cells of the thing at seed point c: takes the neighbourhood, removes the big planes it stands on or leans against
 * (floor, desk top, walls), then grows outward from the seed through touching cells.
 */
export function growShape(occ, c, reach, voxel = VOXEL) {
  const R = Math.ceil((reach * 2) / voxel), ci = Math.floor(c[0] / voxel), cj = Math.floor(c[1] / voxel), ck = Math.floor(c[2] / voxel);
  const near = [];   // [cell, centre]
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
    const cell = [ci + i, cj + j, ck + k];
    if (i * i + j * j + k * k <= R * R && occ.has(cellKey(...cell))) near.push({ cell, at: centre(cell, voxel) });
  }
  if (near.length < 3) return [];

  // a plane is "the room" when it covers much more than the object could: compare with the disc of radius 2*reach
  const planeArea = Math.PI * (reach * 2) ** 2 * 0.3 / (voxel * voxel);
  const minPlane = Math.max(60, planeArea);
  const removed = new Set();
  for (let round = 0; round < 5; round++) {
    const rest = near.filter((p) => !removed.has(p)).map((p) => p.at);
    if (rest.length < minPlane) break;
    const plane = largestPlane(rest, voxel * 0.9);
    if (!plane || plane.hits < minPlane) break;
    for (const p of near) if (Math.abs(plane.n[0] * p.at[0] + plane.n[1] * p.at[1] + plane.n[2] * p.at[2] + plane.d) < voxel * 1.7) removed.add(p);
  }
  const left = new Map(near.filter((p) => !removed.has(p)).map((p) => [cellKey(...p.cell), p]));
  // what planes leave behind are thin strands along their edges: only cells with solid surroundings may start or carry the growth
  const free = new Map(left);
  const neighbours = (cell, set) => {
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) if ((i || j || k) && set.has(cellKey(cell[0] + i, cell[1] + j, cell[2] + k))) n++;
    return n;
  };
  for (let pass = 0; pass < 2; pass++) for (const [key, p] of [...free]) if (neighbours(p.cell, free) < 5) free.delete(key);
  if (!free.size) return [];

  // start from the free cell closest to the seed, then touching neighbours inside the reach
  let start = null, bestD = Infinity;
  for (const p of free.values()) { const d = Math.hypot(p.at[0] - c[0], p.at[1] - c[1], p.at[2] - c[2]); if (d < bestD) { bestD = d; start = p; } }
  if (bestD > reach + 0.2) return [];   // the phone's seed is often a little off the object
  const seen = new Set([cellKey(...start.cell)]), stack = [start.cell], out = [];
  while (stack.length) {
    const cell = stack.pop(); out.push(cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const n = [cell[0] + i, cell[1] + j, cell[2] + k], key = cellKey(...n), p = free.get(key);
      if (!p || seen.has(key)) continue;
      if (Math.hypot(p.at[0] - c[0], p.at[1] - c[1], p.at[2] - c[2]) > reach * 1.15) continue;
      seen.add(key); stack.push(n);
    }
  }
  // give the grown body back its outer skin
  for (const cell of [...out]) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const n = [cell[0] + i, cell[1] + j, cell[2] + k], key = cellKey(...n);
    if (left.has(key) && !seen.has(key)) { seen.add(key); out.push(n); }
  }
  return out;
}

/** The scan's own surface around the seed: for things too flat to stand out from the desk or wall they lie on. */
export function patchShape(occ, c, r, voxel = VOXEL) {
  const out = [], R = Math.ceil(r / voxel), ci = Math.floor(c[0] / voxel), cj = Math.floor(c[1] / voxel), ck = Math.floor(c[2] / voxel);
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
    const cell = [ci + i, cj + j, ck + k];
    if (occ.has(cellKey(...cell)) && Math.hypot(...centre(cell, voxel).map((v, a) => v - c[a])) <= r) out.push(cell);
  }
  return out;
}

/** Hollow ball of cells: the last resort when the scan has nothing at the seed. */
export function ballShape(c, r, voxel = VOXEL) {
  const out = [], R = Math.ceil(r / voxel) + 1, ci = Math.floor(c[0] / voxel), cj = Math.floor(c[1] / voxel), ck = Math.floor(c[2] / voxel);
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
    const cell = [ci + i, cj + j, ck + k], p = centre(cell, voxel);
    if (Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r) < voxel * 0.75) out.push(cell);
  }
  return out;
}

export function boxShape(c, size, voxel = VOXEL) {
  const out = [], lo = c.map((v, a) => Math.floor((v - size[a] / 2) / voxel)), hi = c.map((v, a) => Math.floor((v + size[a] / 2) / voxel));
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) out.push([i, j, k]);
  return out;
}

/** Rigid move by whole cells: nothing is resampled, so the shape cannot change. */
export function shiftCells(flat, d) { return flat.map((v, i) => v + d[i % 3]); }

const rotate = ([x, y, z], [qx, qy, qz, qw]) => {
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
};

/**
 * Rotates and scales a shape around `from`, then puts that point at `to`: p' = to + R(S(p - from)).
 * Works backwards from every target cell, so turning or enlarging leaves no holes. A few samples per cell keep one-cell-thin shells closed.
 */
export function transformCells(flat, voxel, from, to, scale, quat) {
  const have = new Set(), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < flat.length; i += 3) have.add(cellKey(flat[i], flat[i + 1], flat[i + 2]));
  const sMin = [0, 1, 2].map((a) => Math.max(0.05, scale[a])), inverse = [-quat[0], -quat[1], -quat[2], quat[3]];
  const srcLo = [0, 1, 2].map((a) => { let m = Infinity; for (let i = a; i < flat.length; i += 3) m = Math.min(m, flat[i]); return m * voxel; });
  const srcHi = [0, 1, 2].map((a) => { let m = -Infinity; for (let i = a; i < flat.length; i += 3) m = Math.max(m, flat[i] + 1); return m * voxel; });
  for (let c = 0; c < 8; c++) {
    const corner = [0, 1, 2].map((a) => ((c >> a) & 1 ? srcHi[a] : srcLo[a]) - from[a]);
    const p = rotate(corner.map((v, a) => v * sMin[a]), quat);
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a] + to[a]); hi[a] = Math.max(hi[a], p[a] + to[a]); }
  }
  const SAMPLES = [[0, 0, 0], [0.3, 0, 0], [-0.3, 0, 0], [0, 0.3, 0], [0, -0.3, 0], [0, 0, 0.3], [0, 0, -0.3]], out = [];
  const a0 = lo.map((v) => Math.floor(v / voxel) - 1), a1 = hi.map((v) => Math.floor(v / voxel) + 1);
  for (let i = a0[0]; i <= a1[0]; i++) for (let j = a0[1]; j <= a1[1]; j++) for (let k = a0[2]; k <= a1[2]; k++) {
    for (const s of SAMPLES) {
      const p = rotate([(i + 0.5 + s[0]) * voxel - to[0], (j + 0.5 + s[1]) * voxel - to[1], (k + 0.5 + s[2]) * voxel - to[2]], inverse);
      if (have.has(cellKey(Math.floor((p[0] / sMin[0] + from[0]) / voxel), Math.floor((p[1] / sMin[1] + from[1]) / voxel), Math.floor((p[2] / sMin[2] + from[2]) / voxel)))) { out.push(i, j, k); break; }
    }
  }
  return out;
}

export const flatten = (cells) => cells.flat();
export const unflatten = (flat) => { const out = []; for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]); return out; };

export function reachOf(label, r) { return REACH[label] ? Math.max(REACH[label], r) : clamp(r * 1.6, 0.15, 1.2); }

/** The phone's AI often reports one thing several times: keep the widest report of each. */
function mergeSeeds(seeds) {
  const out = [];
  for (const s of [...seeds].sort((a, b) => b.r - a.r)) {
    const twin = out.find((o) => o.label === s.label && Math.hypot(o.c[0] - s.c[0], o.c[1] - s.c[1], o.c[2] - s.c[2]) < Math.max(o.r, s.r));
    if (!twin) out.push(s);
  }
  return out;
}

/** First collision file of a scan, from its cloud and meta. */
export function buildCollisions(id, points, meta, voxel = VOXEL) {
  const occ = occupancy(points, voxel), collisions = [];
  const seeds = [];
  (meta?.objects || []).forEach((o, i) => seeds.push({ id: o.id ?? i + 1, label: o.name || `사물 ${i + 1}`, name: o.name || `사물 ${i + 1}`, c: o.c, r: o.r || 0.25, source: 'placed' }));
  (meta?.ai || []).forEach((o, i) => seeds.push({ id: 100 + i, label: o.label, name: o.name || o.label, c: o.c, r: o.r || 0.4, source: 'ai' }));
  for (const s of mergeSeeds(seeds)) {
    let cells = growShape(occ, s.c, reachOf(s.label, s.r), voxel), fallback = false;
    if (cells.length < 6) { cells = patchShape(occ, s.c, clamp(s.r, 0.08, 0.2), voxel); fallback = true; }
    if (cells.length < 6) cells = ballShape(s.c, s.r, voxel);
    if (cells.length * voxel * voxel < 0.4 * s.r * s.r) fallback = true;   // far less surface than the object should have
    collisions.push({ id: s.id, label: s.label, name: s.name, source: s.source, fallback, cells: flatten(cells), ...SOUND_DEFAULTS });
  }
  collisions.sort((a, b) => a.id - b.id);
  return { version: 1, scan: id, voxel, collisions };
}

/** Shortest distance from (x,y,z) to the shape's surface. floorOnly: measured on the floor plan, ignoring height. */
export function shapeDistance(cells, voxel, x, y, z, floorOnly = false) {
  let best = Infinity;
  for (let i = 0; i + 2 < cells.length; i += 3) {
    const dx = (cells[i] + 0.5) * voxel - x, dy = floorOnly ? 0 : (cells[i + 1] + 0.5) * voxel - y, dz = (cells[i + 2] + 0.5) * voxel - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) best = d;
  }
  return Math.max(0, Math.sqrt(best) - voxel / 2);
}

/** Loudness at a distance. The same formula as APhoneTwinScanActor::UpdateSounds in Unreal. */
export function distanceGain(c, d) {
  if (c.muted) return 0;
  const g = d <= c.fullDistance ? 1 : clamp((c.maxDistance - d) / Math.max(0.01, c.maxDistance - c.fullDistance), 0, 1);
  return g * g * c.volume;
}
