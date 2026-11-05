// Local collision & sound editor: http://127.0.0.1:8765/editor.html (the editor itself is reachable from this PC only).
// Start: 콜리전_편집기.bat, or node tools/editor_server.mjs [--no-open]
// On start it backs up new scans, refreshes Unreal's copies and the web clones, and makes missing collision files.
// Saves go to ARKO_PROJECT/PhoneTwinScans/collisions (Unreal reloads them and switches to that scan while playing) and
// web_scans (the web viewer); 15 s after the last save the web_scans files are committed and pushed to GitHub (Pages).
// --no-publish keeps saves on this PC.
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { REPO, COLLISIONS, SOUNDS, UNREAL_SCANS, writeIfChanged } from './scan_lib.mjs';
import { archive, refreshUnrealCopies, verify } from './archive_scans.mjs';
import { makeWebCopies } from './make_web_copies.mjs';
import { makeFor, makeMissing, markEdited, saveCollisions } from './make_collisions.mjs';

const PORT = 8765;
const PUBLISH = !process.argv.includes('--no-publish');   // saves also go to GitHub (the public web viewer)
const PUBLISH_DELAY_MS = 15000;                            // several saves in a row become one upload

// ---------------------------------------------------------------- upload edited collisions to GitHub Pages
const publish = { state: PUBLISH ? 'idle' : 'off', text: PUBLISH ? '' : '웹 업로드 꺼짐 (--no-publish)', pending: new Set(), timer: null, at: 0 };
function run(args) {
  return new Promise((ok, fail) => execFile('git', ['-C', REPO, ...args], { maxBuffer: 1 << 26 }, (err, out, errOut) => (err ? fail(new Error((errOut || err.message).trim().split(/\r?\n/).slice(-2).join(' '))) : ok(out))));
}
function schedulePublish(id) {
  if (!PUBLISH) return;
  publish.pending.add(id);
  publish.state = 'waiting'; publish.text = `${Math.round(PUBLISH_DELAY_MS / 1000)}초 뒤 웹 사이트(GitHub)에 올립니다`;
  clearTimeout(publish.timer);
  publish.timer = setTimeout(doPublish, PUBLISH_DELAY_MS);
}
async function doPublish() {
  if (publish.state === 'running') { publish.timer = setTimeout(doPublish, 3000); return; }
  const ids = [...publish.pending]; publish.pending.clear();
  const files = [...ids.map((id) => `web_scans/${id}.collision.json`), 'web_scans/edited.json'];
  publish.state = 'running'; publish.text = '웹 사이트(GitHub)에 올리는 중…';
  try {
    await run(['add', '--', ...files]);
    const staged = (await run(['diff', '--cached', '--name-only', '--', ...files])).trim();
    if (staged) await run(['commit', '-m', `Edited collisions: ${ids.join(', ')}`, '--', ...files]);
    await run(['pull', '--rebase', '--autostash']);
    await run(['push']);
    publish.state = 'done'; publish.at = Date.now();
    publish.text = staged ? '웹 사이트에 올렸습니다 · 1~2분 뒤 새로고침하면 보입니다' : '웹 사이트와 이미 같습니다';
    console.log(`웹 업로드: ${ids.join(', ')} ${staged ? '완료' : '(변경 없음)'}`);
  } catch (e) {
    ids.forEach((id) => publish.pending.add(id));   // try again with the next save
    publish.state = 'error'; publish.text = `웹 업로드 실패: ${e.message}`;
    console.error(`⚠ ${publish.text}`);
  }
}
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
  if (what === 'publish' && req.method === 'GET') return send(res, 200, { state: publish.state, text: publish.text, pending: [...publish.pending] });
  if (what === 'publish' && req.method === 'POST') { if (PUBLISH) { clearTimeout(publish.timer); doPublish(); } return send(res, 200, { state: publish.state }); }
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
    markEdited(arg);   // Unreal and the web viewer switch to this scan
    schedulePublish(arg);
    return send(res, 200, { saved: data.collisions.length, publish: publish.state });
  }
  return send(res, 404, { error: 'unknown' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/sounds/')) return serveFile(res, path.join(SOUNDS, safeName(decodeURIComponent(url.pathname.slice(8)))));
    const rel = path.normalize(decodeURIComponent(url.pathname === '/' ? '/editor.html' : url.pathname)).replace(/^[\\/]+/, '');
    if (rel.startsWith('..') || !/^(editor\.html|index\.html|immersive\.html|web[\\/]|web_scans[\\/])/.test(rel)) return send(res, 404, { error: 'not found' });
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
