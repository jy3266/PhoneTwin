// Phone Twin 몰입 보기 — visitors' walks kept as small trails of light (PROTOCOL.md §3-1).
//   site (푸른 빛): every walking test Unreal reports (PTU1 valid=1 ... valid=0); a signed-in viewer watching it claims it
//   web  (보라 빛): a signed-in visitor walking the room in the browser, sent by the page in chunks
// A visitor signs in with an id and a 4-digit PIN (scrypt hash kept, never the PIN). Trails come back without ids,
// except the asker's own (token). Everything sits in one JSON document: a local file plus, when
// TRAILS_GITHUB_REPO + TRAILS_GITHUB_TOKEN are set, a copy in that (private) repository, so a restart keeps it.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = process.env.TRAILS_FILE || path.join(__dirname, 'data', 'trails.json');
const GH_REPO = process.env.TRAILS_GITHUB_REPO || '';          // "owner/name" (private)
const GH_TOKEN = process.env.TRAILS_GITHUB_TOKEN || '';        // fine-grained token: Contents read/write on that repo only
const GH_PATH = process.env.TRAILS_GITHUB_PATH || 'trails.json';
const GH_BRANCH = process.env.TRAILS_GITHUB_BRANCH || 'main';
const BACKUP_S = Number(process.env.TRAILS_BACKUP_S) || 120;
const GH_API = (process.env.TRAILS_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');   // tests point this at a fake

const MAX_TRAILS = 3000, MAX_POINTS = 4000, MIN_POINTS = 5, MIN_PATH_M = 0.5;
const STEP_M = 0.04, STEP_S = 1.0;                 // keep a point when moved 4 cm, or once a second while standing
const SITE_GAP_S = 5, WEB_IDLE_S = 120, TOKEN_S = 12 * 3600;
const ID_RE = /^[\p{L}\p{N}_.\-]{1,20}$/u, PIN_RE = /^\d{4}$/;
const USED_MSG = '이 아이디는 이미 체험을 마쳤습니다. 다시 체험하려면 새 아이디를 만들어 주세요';
const ADMIN_KEY = process.env.TRAILS_ADMIN_KEY || process.env.RELAY_KEY || '';   // POST /trails/admin (delete records)

let db = { v: 1, accounts: {}, trails: [] };
let dirty = false, saveTimer = null, ghSha = null, ghDirty = false, ghBusy = false;
const backup = { configured: !!(GH_REPO && GH_TOKEN), last: null, error: '' };
const tokens = new Map();      // token -> { id, at }
const sessions = new Map();    // sid -> { sid, kind, owner, scan, room, pts, t0, last }
const siteWalks = new Map();   // room -> { sid, scan, pts, t0, last, owners:Set }
const failures = new Map();    // id -> { n, until }
const hits = new Map();        // ip:bucket -> { n, reset }

const now = () => Date.now();
const r2 = (v) => Math.round(v * 100) / 100;
const keyOf = (id) => id.normalize('NFC').toLowerCase();
const newId = (n = 12) => crypto.randomBytes(n).toString('hex');

// ---------------------------------------------------------------- storage
function load() {
  try { db = normalise(JSON.parse(fs.readFileSync(FILE, 'utf8'))); console.log(`trails: ${db.trails.length} trails, ${Object.keys(db.accounts).length} visitors (${FILE})`); return true; }
  catch (e) { if (e.code !== 'ENOENT') console.log('trails: local file unreadable:', e.message); return false; }
}
function normalise(d) { return { v: 1, accounts: (d && d.accounts) || {}, trails: Array.isArray(d && d.trails) ? d.trails : [] }; }
function markDirty() {
  dirty = true; ghDirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 3000);
}
function saveLocal() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.log('trails: save failed', e.message); }
}

async function gh(method, body) {
  const url = `${GH_API}/repos/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}` + (method === 'GET' ? `?ref=${GH_BRANCH}` : '');
  return fetch(url, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': 'phonetwin-relay', 'X-GitHub-Api-Version': '2022-11-28',
      Accept: method === 'GET' ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' },
  });
}
async function restoreFromGitHub() {
  if (!backup.configured) return;
  try {
    const meta = await fetch(`${GH_API}/repos/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}?ref=${GH_BRANCH}`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': 'phonetwin-relay', Accept: 'application/vnd.github.object+json' } });
    if (meta.status === 404) { console.log('trails: no backup yet in', GH_REPO); return; }
    if (!meta.ok) throw new Error('HTTP ' + meta.status);
    ghSha = (await meta.json()).sha;
    const r = await gh('GET');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const got = normalise(JSON.parse(await r.text()));
    if (!db.trails.length && !Object.keys(db.accounts).length) {
      db = got; dirty = true; saveLocal();
      console.log(`trails: restored ${db.trails.length} trails from ${GH_REPO}`);
    }
  } catch (e) { backup.error = e.message; console.log('trails: restore failed', e.message); }
}
async function backupToGitHub() {
  if (!backup.configured || !ghDirty || ghBusy) return;
  ghBusy = true; ghDirty = false;
  try {
    const body = { message: `trails ${new Date().toISOString()}`, branch: GH_BRANCH, content: Buffer.from(JSON.stringify(db)).toString('base64') };
    if (ghSha) body.sha = ghSha;
    let r = await gh('PUT', body);
    if (r.status === 409 || r.status === 422) {   // someone else's sha: fetch it once and retry
      const m = await fetch(`${GH_API}/repos/${GH_REPO}/contents/${encodeURIComponent(GH_PATH)}?ref=${GH_BRANCH}`,
        { headers: { Authorization: `Bearer ${GH_TOKEN}`, 'User-Agent': 'phonetwin-relay', Accept: 'application/vnd.github.object+json' } });
      if (m.ok) { body.sha = (await m.json()).sha; r = await gh('PUT', body); }
    }
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
    ghSha = (await r.json()).content.sha;
    backup.last = new Date().toISOString(); backup.error = '';
  } catch (e) { ghDirty = true; backup.error = e.message; console.log('trails: backup failed', e.message); }
  ghBusy = false;
}

// ---------------------------------------------------------------- accounts
function limited(ip, bucket, max, perS) {
  const k = ip + ':' + bucket, t = now(), h = hits.get(k);
  if (!h || t > h.reset) { hits.set(k, { n: 1, reset: t + perS * 1000 }); return false; }
  return ++h.n > max;
}
function hashPin(pin, salt) { return crypto.scryptSync(pin, salt, 32).toString('hex'); }
function login(id, pin) {
  if (typeof id !== 'string' || !ID_RE.test(id.trim())) return { status: 400, error: '아이디는 글자·숫자 1~20자입니다' };
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) return { status: 400, error: '비밀번호는 숫자 4개입니다' };
  id = id.trim();
  const k = keyOf(id), f = failures.get(k);
  if (f && f.until > now()) return { status: 429, error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil((f.until - now()) / 60000)}분 뒤에 다시 해 주세요` };
  let acc = db.accounts[k], created = false;
  if (!acc) {
    const salt = newId(8);
    acc = db.accounts[k] = { id, salt, hash: hashPin(pin, salt), created: new Date().toISOString() };
    created = true; markDirty();
  } else if (!crypto.timingSafeEqual(Buffer.from(hashPin(pin, acc.salt), 'hex'), Buffer.from(acc.hash, 'hex'))) {
    const n = (!f || (f.until && f.until <= now()) ? 0 : f.n) + 1;   // a lock that ran out starts the count again
    failures.set(k, { n, until: n >= 5 ? now() + 10 * 60000 : 0 });
    return { status: 401, error: n >= 5 ? '비밀번호를 5번 틀려 10분 동안 잠겼습니다' : `이미 있는 아이디입니다. 비밀번호가 맞지 않습니다 (${n}/5)` };
  }
  failures.delete(k);
  if (!created && acc.used) return { status: 409, error: USED_MSG };   // one experience per id: a new visit needs a new id
  const token = newId(24);
  tokens.set(token, { id: acc.id, k, at: now() });
  return { status: 200, body: { ok: true, token, id: acc.id, created } };
}
function who(token) {
  const t = typeof token === 'string' && tokens.get(token);
  if (!t || now() - t.at > TOKEN_S) return null;
  t.at = now();
  return t;
}

// ---------------------------------------------------------------- trails
function pathLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function keep(t) {
  if (t.pts.length < MIN_POINTS || pathLength(t.pts) < MIN_PATH_M) return false;
  db.trails.push({ sid: t.sid, kind: t.kind, scan: t.scan || '', room: t.room, owners: t.owners ? [...t.owners] : t.owner ? [t.owner] : [], t0: t.t0, t1: t.last, pts: t.pts });
  if (db.trails.length > MAX_TRAILS) db.trails.splice(0, db.trails.length - MAX_TRAILS);
  markDirty();
  return true;
}
function addPoint(t, x, y, z, at) {
  if (![x, y, z].every(Number.isFinite) || Math.abs(x) > 100 || Math.abs(y) > 100 || Math.abs(z) > 20) return;
  const p = t.pts[t.pts.length - 1];
  if (p && Math.hypot(x - p[0], y - p[1], z - p[2]) < STEP_M && at - t.lastPt < STEP_S * 1000) return;   // 3D: rising and sinking count too
  if (t.pts.length >= MAX_POINTS) return;
  t.pts.push([r2(x), r2(y), r2(z)]); t.lastPt = at;
}

/** Called for every PTU1 line Unreal sends through the relay. */
function onUnrealLine(room, line) {
  const f = line.split(',');
  if (f[0] !== 'PTU1' || f.length < 11) return;
  const valid = f[2] === '1', at = now();
  let w = siteWalks.get(room);
  if (!valid) { if (w) endSite(room); return; }
  const x = +f[4], y = +f[5], z = +f[6], scan = (f[11] || '').trim();
  if (w && scan && w.scan && scan !== w.scan) { endSite(room); w = null; }
  if (!w) {
    w = { sid: newId(8), kind: 'site', room, scan, pts: [], t0: at, last: at, lastPt: 0, owners: new Set() };
    siteWalks.set(room, w);
    for (const s of sessions.values()) if (s.kind === 'site' && s.room === room) w.owners.add(s.owner);   // signed in before the walk began
  }
  if (!w.scan && scan) w.scan = scan;
  if (!w.scan) for (const s of sessions.values()) if (s.kind === 'site' && s.room === room && s.scan) w.scan = s.scan;   // old Unreal without the scan field
  w.last = at;
  addPoint(w, x, y, z, at);
}
function endSite(room) { const w = siteWalks.get(room); if (!w) return; siteWalks.delete(room); keep(w); }

/** An id's one experience is over: it can neither start again nor sign in again. */
function finish(k) {
  const acc = db.accounts[k];
  if (acc && !acc.done) { acc.done = new Date().toISOString(); markDirty(); }
}
function start(tok, body) {
  const acc = db.accounts[tok.k];
  if (!acc) return { status: 401, error: '다시 로그인해 주세요' };
  if (acc.done) return { status: 409, error: USED_MSG };
  if (!acc.used) { acc.used = new Date().toISOString(); markDirty(); }
  const kind = body.kind === 'site' ? 'site' : 'web';
  const scan = String(body.scan || '').slice(0, 80), room = String(body.room || 'arko').slice(0, 64);
  const s = { sid: newId(8), kind, owner: tok.k, scan, room, pts: [], t0: now(), last: now(), lastPt: 0 };
  sessions.set(s.sid, s);
  if (kind === 'site') { const w = siteWalks.get(room); if (w) { w.owners.add(tok.k); if (!w.scan) w.scan = scan; } }
  return { ok: true, sid: s.sid, kind };
}
function add(tok, body) {
  const s = sessions.get(body.sid);
  if (!s || s.owner !== tok.k) return { status: 404, error: '체험이 없습니다' };
  s.last = now();
  if (s.kind === 'web' && Array.isArray(body.pts)) for (const p of body.pts.slice(0, 600)) if (Array.isArray(p)) addPoint(s, +p[0], +p[1], +p[2], s.last);
  if (s.kind === 'site') { const w = siteWalks.get(s.room); if (w) w.owners.add(tok.k); }
  return { ok: true, n: s.pts.length };
}
function end(tok, body) {
  const s = sessions.get(body.sid);
  if (!s || s.owner !== tok.k) return { status: 404, error: '체험이 없습니다' };
  sessions.delete(s.sid);
  if (body.final !== false) finish(tok.k);   // final:false = the page goes on with the same visit (site ↔ web, another scan)
  if (s.kind === 'web') return { ok: true, kept: keep(s) };
  return { ok: true, kept: true };   // site points belong to the walk Unreal reports; the claim stays on it
}
function view(tok, scan) {
  const mine = tok && tok.k;
  const out = (t, live) => ({ kind: t.kind, live, mine: !!(mine && (t.owners ? [...t.owners].includes(mine) : t.owner === mine)) || undefined, t0: t.t0, t1: t.t1 || t.last, pts: t.pts });
  const list = db.trails.filter((t) => !scan || t.scan === scan).map((t) => out(t, false));
  for (const w of siteWalks.values()) if ((!scan || w.scan === scan) && w.pts.length > 1) list.push(out(w, true));
  for (const s of sessions.values()) if (s.kind === 'web' && (!scan || s.scan === scan) && s.pts.length > 1) list.push(out(s, true));
  return { ok: true, id: tok ? tok.id : null, trails: list };
}

// ---------------------------------------------------------------- admin: delete records (key = TRAILS_ADMIN_KEY or RELAY_KEY)
function sameSecret(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}
/** {key, action:'reset'} forgets every visitor and trail; {key, action:'delete', ids:[...]} removes those visitors
 *  and every trail only they owned (a site walk someone else also claimed stays, without them). */
function admin(body) {
  if (!ADMIN_KEY || typeof body.key !== 'string' || !sameSecret(body.key, ADMIN_KEY)) return { status: 403, error: 'forbidden' };
  if (body.action === 'reset') {
    const out = { ok: true, accounts: Object.keys(db.accounts).length, trails: db.trails.length + siteWalks.size };
    db = { v: 1, accounts: {}, trails: [] };
    tokens.clear(); sessions.clear(); siteWalks.clear(); failures.clear();
    markDirty(); console.log('trails: admin reset', out);
    return out;
  }
  if (body.action === 'delete' && Array.isArray(body.ids)) {
    const set = new Set(body.ids.filter((x) => typeof x === 'string').map((x) => keyOf(x.trim())));
    let accounts = 0;
    for (const k of set) if (db.accounts[k]) { delete db.accounts[k]; accounts++; }
    for (const [t, v] of tokens) if (set.has(v.k)) tokens.delete(t);
    for (const [sid, s] of sessions) if (set.has(s.owner)) sessions.delete(sid);
    for (const w of siteWalks.values()) for (const k of set) w.owners.delete(k);
    const before = db.trails.length;
    db.trails = db.trails.filter((t) => {
      const owners = t.owners || [], left = owners.filter((k) => !set.has(k));
      t.owners = left;
      return !(owners.length && !left.length);
    });
    markDirty(); console.log('trails: admin delete', accounts, 'visitors');
    return { ok: true, accounts, trails: before - db.trails.length };
  }
  return { status: 400, error: 'action: reset | delete' };
}

// ---------------------------------------------------------------- HTTP
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 256 * 1024) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
/** Returns true when the request was a /trails one. */
function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/trails')) return false;
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); res.end(); return true; }
  (async () => {
    const op = url.pathname.replace(/^\/trails\/?/, '');
    if (req.method === 'GET' && op === '') {
      if (limited(ip, 'get', 120, 60)) return send(res, 429, { error: '잠시 뒤에 다시' });
      return send(res, 200, view(who(url.searchParams.get('token')), url.searchParams.get('scan') || ''));
    }
    if (req.method === 'GET' && op === 'status') return send(res, 200, { ok: true, trails: db.trails.length, visitors: Object.keys(db.accounts).length, sessions: sessions.size, siteWalks: siteWalks.size, backup });
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    if (!body) return send(res, 400, { error: '잘못된 요청' });
    if (op === 'login') {
      if (limited(ip, 'login', 20, 60)) return send(res, 429, { error: '너무 자주 시도했습니다. 1분 뒤에 다시 해 주세요' });
      const r = login(body.id, body.pin);
      return send(res, r.status, r.body || { error: r.error });
    }
    if (op === 'admin') {
      if (limited(ip, 'admin', 10, 60)) return send(res, 429, { error: '잠시 뒤에 다시' });
      const r = admin(body);
      return send(res, r.status || 200, r.status ? { error: r.error } : r);
    }
    const tok = who(body.token);
    if (!tok) return send(res, 401, { error: '다시 로그인해 주세요' });
    if (op === 'me') { const acc = db.accounts[tok.k] || {}; return send(res, 200, { ok: true, id: tok.id, used: !!acc.used, done: !!acc.done }); }
    if (limited(ip, 'write', 300, 60)) return send(res, 429, { error: '잠시 뒤에 다시' });
    const r = op === 'start' ? start(tok, body) : op === 'add' ? add(tok, body) : op === 'end' ? end(tok, body) : { status: 404, error: 'not found' };
    return send(res, r.status || 200, r.status ? { error: r.error } : r);
  })().catch((e) => { console.log('trails error', e); try { send(res, 500, { error: 'server' }); } catch (_) { /* already sent */ } });
  return true;
}

// ---------------------------------------------------------------- housekeeping
function tick() {
  const t = now();
  for (const [room, w] of siteWalks) if (t - w.last > SITE_GAP_S * 1000) endSite(room);
  for (const s of sessions.values()) if (t - s.last > WEB_IDLE_S * 1000) { sessions.delete(s.sid); finish(s.owner); if (s.kind === 'web') keep(s); }
  for (const [k, v] of tokens) if (t - v.at > TOKEN_S * 1000) tokens.delete(k);
  for (const [k, v] of hits) if (t > v.reset) hits.delete(k);
}
let started = false;
async function init() {
  if (started) return; started = true;
  const had = load();
  if (!had) await restoreFromGitHub();
  else if (backup.configured) restoreFromGitHub().catch(() => {});   // only fetches the sha when the local file already has data
  setInterval(tick, 1000).unref();
  setInterval(() => { backupToGitHub(); }, BACKUP_S * 1000).unref();
  console.log(`trails: ready · backup ${backup.configured ? 'to ' + GH_REPO : 'off (set TRAILS_GITHUB_REPO and TRAILS_GITHUB_TOKEN)'}`);
}
async function flush() { tick(); for (const room of [...siteWalks.keys()]) endSite(room); saveLocal(); await backupToGitHub(); }

module.exports = { init, handle, onUnrealLine, flush, _db: () => db, _login: login };
