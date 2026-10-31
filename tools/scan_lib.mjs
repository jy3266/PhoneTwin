// Shared by archive_scans.mjs, make_web_copies.mjs, make_collisions.mjs and editor_server.mjs. Node only, no packages.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(REPO, '..');                                    // PhoneTwin/
export const UNREAL_SCANS = path.join(ROOT, 'ARKO_PROJECT', 'PhoneTwinScans');   // Unreal's working copies
export const COLLISIONS = path.join(UNREAL_SCANS, 'collisions');                 // master collision files
export const SOUNDS = path.join(UNREAL_SCANS, 'sounds');
export const WEB_SCANS = path.join(REPO, 'web_scans');                           // clones the web viewer uses

export function git(...args) {
  return execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 1 << 30 });
}
export const gitText = (...args) => git(...args).toString('utf8');
export const blob = (sha) => git('cat-file', 'blob', sha);

/** Newest version of every file under scans/ at a ref: [{name, sha, size}]. */
export function latestBlobs(ref) {
  return gitText('ls-tree', '-l', ref, 'scans/').trim().split('\n').filter(Boolean).map((l) => {
    const [info, file] = l.split('\t'), f = info.trim().split(/\s+/);
    return { name: path.basename(file), sha: f[2], size: +f[3] };
  });
}

/** PLY (binary little endian, or ascii) -> Float32Array x,y,z,x,y,z,… in the S frame. */
export function readPlyPositions(buf) {
  const end = buf.indexOf('end_header');
  if (end < 0) throw new Error('PLY header not found');
  const headerEnd = buf.indexOf(10, end) + 1;
  const lines = buf.subarray(0, headerEnd).toString('latin1').split(/\r?\n/);
  const format = lines.find((l) => l.startsWith('format')) || '';
  let count = 0, inVertex = false;
  const props = [];
  for (const l of lines) {
    const t = l.trim().split(/\s+/);
    if (t[0] === 'element') { inVertex = t[1] === 'vertex'; if (inVertex) count = +t[2]; }
    else if (t[0] === 'property' && inVertex) props.push({ type: t[1], name: t[2] });
  }
  const SIZE = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const idx = ['x', 'y', 'z'].map((n) => props.findIndex((p) => p.name === n));
  if (idx.some((i) => i < 0)) throw new Error('PLY has no x y z');
  const out = new Float32Array(count * 3);
  if (format.includes('ascii')) {
    const rows = buf.subarray(headerEnd).toString('latin1').split(/\r?\n/);
    for (let i = 0; i < count; i++) { const f = rows[i].trim().split(/\s+/); for (let k = 0; k < 3; k++) out[i * 3 + k] = +f[idx[k]]; }
    return out;
  }
  if (!format.includes('binary_little_endian')) throw new Error(`unsupported PLY: ${format}`);
  let stride = 0; const offset = props.map((p) => { const o = stride; stride += SIZE[p.type]; return o; });
  for (let i = 0; i < count; i++) {
    const at = headerEnd + i * stride;
    for (let k = 0; k < 3; k++) {
      const p = props[idx[k]], o = at + offset[idx[k]];
      out[i * 3 + k] = p.type === 'double' || p.type === 'float64' ? buf.readDoubleLE(o) : buf.readFloatLE(o);
    }
  }
  return out;
}

export function writeIfChanged(file, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file);
  return true;
}
