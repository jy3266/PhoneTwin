// Keeps every scan original twice on this PC. Files are only ever added, never changed or deleted.
//
//   node tools/archive_scans.mjs            fetch GitHub, add anything new to both archives, verify them
//   node tools/archive_scans.mjs --verify   only check every archived file against its SHA-256
//   node tools/archive_scans.mjs --offline  skip git fetch
//
// Sources: every version of scans/* in the git history (a scan uploaded twice has two versions), plus files that exist
// only in ARKO_PROJECT/PhoneTwinScans. Layout of each archive:
//   <id>/<id>.ply, <id>.json            newest version on GitHub at the first time it was archived
//   <id>/older/<date>_<sha8>_<file>     every other version
//   manifest.json                       file -> sha256, size, source
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { git, gitText, blob, ROOT, UNREAL_SCANS, writeIfChanged } from './scan_lib.mjs';

export const ARCHIVES = [path.join(ROOT, 'ScanArchive'), 'D:/PhoneTwin_ScanArchive'];
const REF = 'origin/main';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const scanId = (name) => name.replace(/\.[^.]+$/, '');

/** Every distinct (file name, content) that ever existed under scans/, oldest first. */
function historyVersions() {
  const seen = new Map();
  const log = gitText('log', '--reverse', '--format=%H %cI', REF, '--', 'scans/').trim().split('\n').filter(Boolean);
  for (const line of log) {
    const [commit, date] = line.split(' ');
    for (const row of gitText('ls-tree', commit, 'scans/').trim().split('\n').filter(Boolean)) {
      const [info, file] = row.split('\t'), sha = info.split(/\s+/)[2], name = path.basename(file);
      const key = `${name}:${sha}`;
      if (!seen.has(key)) seen.set(key, { name, gitSha: sha, date, source: `github ${commit.slice(0, 8)}` });
    }
  }
  return [...seen.values()];
}

function loadManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return { files: {} }; }
}

function addFile(dir, manifest, rel, bytes, source, date) {
  const full = path.join(dir, rel), hash = sha256(bytes);
  if (fs.existsSync(full)) {
    if (sha256(fs.readFileSync(full)) !== hash) throw new Error(`보관본이 다릅니다, 덮어쓰지 않음: ${full}`);
    return false;
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  fs.chmodSync(full, 0o444);   // read-only
  manifest.files[rel.replaceAll('\\', '/')] = { sha256: hash, size: bytes.length, source, date };
  return true;
}

function versionPath(v, hash, newestHash) {
  const id = scanId(v.name);
  if (v.name === 'index.json') return null;   // rebuilt on every upload, not scan data
  return hash === newestHash.get(v.name) ? path.join(id, v.name)
    : path.join(id, 'older', `${v.date.slice(0, 19).replace(/[:T]/g, '-')}_${hash.slice(0, 8)}_${v.name}`);
}

export function archive({ offline = false } = {}) {
  if (!offline) try { git('fetch', 'origin'); } catch (e) { console.warn(`GitHub에 연결하지 못해 받아 둔 기록으로 진행합니다: ${e.message}`); }
  const versions = historyVersions();
  const items = versions.map((v) => { const bytes = blob(v.gitSha); return { ...v, bytes, hash: sha256(bytes) }; });
  const newest = new Map(items.map((v) => [v.name, v.hash]));   // oldest first, so the last write is the newest

  // files in Unreal's folder that GitHub never had
  const known = new Set(items.map((v) => v.hash));
  for (const name of fs.existsSync(UNREAL_SCANS) ? fs.readdirSync(UNREAL_SCANS) : []) {
    if (!/\.(ply|json)$/i.test(name) || name === 'index.json') continue;
    const file = path.join(UNREAL_SCANS, name), bytes = fs.readFileSync(file), hash = sha256(bytes);
    if (known.has(hash)) continue;
    items.push({ name, bytes, hash, date: fs.statSync(file).mtime.toISOString(), source: 'ARKO_PROJECT/PhoneTwinScans (로컬 사본)' });
    if (!newest.has(name)) newest.set(name, hash);
  }

  const report = [];
  for (const dir of ARCHIVES) {
    fs.mkdirSync(dir, { recursive: true });
    const manifest = loadManifest(dir);
    let added = 0;
    for (const v of items) {
      const rel = versionPath(v, v.hash, newest);
      if (!rel) continue;
      // the slot for "newest" may already hold an earlier version: this one then goes to older/
      const full = path.join(dir, rel);
      const taken = fs.existsSync(full) && sha256(fs.readFileSync(full)) !== v.hash;
      const target = taken ? path.join(scanId(v.name), 'older', `${v.date.slice(0, 19).replace(/[:T]/g, '-')}_${v.hash.slice(0, 8)}_${v.name}`) : rel;
      if (addFile(dir, manifest, target, v.bytes, v.source, v.date)) added++;
    }
    writeIfChanged(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
    writeIfChanged(path.join(dir, 'README.txt'), '\ufeffPhone Twin 스캔 원본 보관소\r\n\r\n이 폴더의 파일은 읽기 전용이며 수정하지 않습니다.\r\nmanifest.json에 파일마다 SHA-256이 적혀 있습니다.\r\n검사: PhoneTwin_v4 폴더에서 node tools/archive_scans.mjs --verify\r\n');
    report.push({ dir, added, files: Object.keys(manifest.files).length });
  }
  return report;
}

export function verify() {
  const result = [];
  for (const dir of ARCHIVES) {
    const manifest = loadManifest(dir), bad = [];
    let ok = 0, bytes = 0;
    for (const [rel, f] of Object.entries(manifest.files)) {
      const full = path.join(dir, rel);
      if (fs.existsSync(full) && sha256(fs.readFileSync(full)) === f.sha256) { ok++; bytes += f.size; } else bad.push(rel);
    }
    result.push({ dir, ok, bad, bytes });
  }
  return result;
}

/** Unreal's folder gets the newest version of every file (the archive already holds whatever it replaces). */
export function refreshUnrealCopies(ref = REF) {
  let changed = 0;
  for (const row of gitText('ls-tree', ref, 'scans/').trim().split('\n').filter(Boolean)) {
    const [info, file] = row.split('\t');
    if (writeIfChanged(path.join(UNREAL_SCANS, path.basename(file)), blob(info.split(/\s+/)[2]))) changed++;
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  const args = process.argv.slice(2);
  if (!args.includes('--verify')) {
    for (const r of archive({ offline: args.includes('--offline') })) console.log(`${r.dir}: 새로 ${r.added}개, 전체 ${r.files}개`);
    console.log(`언리얼 폴더 갱신: ${refreshUnrealCopies()}개`);
  }
  let failed = false;
  for (const r of verify()) {
    console.log(`검사 ${r.dir}: 정상 ${r.ok}개 (${(r.bytes / 1e6).toFixed(1)} MB), 이상 ${r.bad.length}개`);
    for (const b of r.bad) { console.log(`  이상: ${b}`); failed = true; }
  }
  process.exitCode = failed ? 1 : 0;
}
