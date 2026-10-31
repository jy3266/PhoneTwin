// Local collision & sound editor: http://127.0.0.1:8765/editor.html (this PC only, nothing goes to the internet).
// Start: 콜리전_편집기.bat, or node tools/editor_server.mjs [--no-open]
// On start it backs up new scans, refreshes Unreal's copies and the web clones, and makes missing collision files.
// Saves go to ARKO_PROJECT/PhoneTwinScans/collisions (Unreal reloads them while playing) and web_scans (the web viewer).
import { exec } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { REPO, COLLISIONS, SOUNDS, UNREAL_SCANS, writeIfChanged } from './scan_lib.mjs';
import { archive, refreshUnrealCopies, verify } from './archive_scans.mjs';
import { makeWebCopies } from './make_web_copies.mjs';
import { makeFor, makeMissing, saveCollisions } from './make_collisions.mjs';

const PORT = 8765;
const ID = /^[\w-]+$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ply': 'application/octet-stream', '.wav': 'audio/wav' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, fail) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => ok(Buffer.concat(parts))); req.on('error', fail); });
}
function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
}
/** Keeps letters of any language; nothing that could leave the sounds folder. */
const safeName = (n) => path.basename(n).replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '') || 'sound.wav';
function soundList() {
  fs.mkdirSync(SOUNDS, { recursive: true });
  return fs.readdirSync(SOUNDS).filter((f) => /\.wav$/i.test(f)).sort();
}

async function api(req, res, url) {
  const [, , what, arg] = url.pathname.split('/').map(decodeURIComponent);
  if (what === 'ping') return send(res, 200, { ok: true });
  if (what === 'sounds' && req.method === 'GET') return send(res, 200, { sounds: soundList() });
  if (what === 'sounds' && req.method === 'POST') {
    const name = safeName(arg);
    if (!/\.wav$/i.test(name)) return send(res, 400, { error: 'wav only' });
    writeIfChanged(path.join(SOUNDS, name), await readBody(req));
    return send(res, 200, { name });
  }
  if (!ID.test(arg || '')) return send(res, 400, { error: 'bad id' });
  if (what === 'collisions' && req.method === 'GET') {
    const file = path.join(COLLISIONS, `${arg}.json`);
    if (fs.existsSync(file)) return serveFile(res, file);
    if (!fs.existsSync(path.join(UNREAL_SCANS, `${arg}.ply`))) return send(res, 404, { error: 'no scan' });
    const data = makeFor(arg); saveCollisions(arg, data);
    return send(res, 200, data);
  }
  if (what === 'collisions' && req.method === 'POST') {
    const data = JSON.parse((await readBody(req)).toString('utf8'));
    if (data.scan !== arg || !Array.isArray(data.collisions)) return send(res, 400, { error: 'bad file' });
    saveCollisions(arg, data);
    return send(res, 200, { saved: data.collisions.length });
  }
  return send(res, 404, { error: 'unknown' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/sounds/')) return serveFile(res, path.join(SOUNDS, safeName(decodeURIComponent(url.pathname.slice(8)))));
    const rel = path.normalize(decodeURIComponent(url.pathname === '/' ? '/editor.html' : url.pathname)).replace(/^[\\/]+/, '');
    if (rel.startsWith('..') || !/^(editor\.html|index\.html|web[\\/]|web_scans[\\/])/.test(rel)) return send(res, 404, { error: 'not found' });
    return serveFile(res, path.join(REPO, rel));
  } catch (e) { console.error(e); send(res, 500, { error: e.message }); }
});

console.log('스캔 원본 보관 중…');
try {
  for (const r of archive()) console.log(`  ${r.dir}: 새로 ${r.added}개, 전체 ${r.files}개`);
  for (const r of verify()) if (r.bad.length) console.error(`  ⚠ ${r.dir}: 이상 ${r.bad.length}개 — ${r.bad.join(', ')}`);
  refreshUnrealCopies();
  makeWebCopies('origin/main');
} catch (e) { console.error(`  ⚠ 보관 실패: ${e.message}`); }
console.log('콜리전 만드는 중…');
for (const d of makeMissing()) console.log(`  ${d.scan}: ${d.collisions.length}개`);

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/editor.html`;
  console.log(`\n편집기: ${url}\n이 창을 닫으면 편집기가 꺼집니다.`);
  if (!process.argv.includes('--no-open')) exec(`start "" "${url}"`);
});
