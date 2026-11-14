// Trail checks (PROTOCOL.md §3-1): sign-in with id + 4-digit PIN, web walks, site walks from Unreal's PTU1,
// ids only on your own trails, a restart keeps everything, and the private-repo backup restores an empty server.
//   node trails_test.js
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const KEY = 'test-key', PORT = 18181, BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-trails-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && extra !== undefined ? ' · ' + JSON.stringify(extra) : ''}`); if (!ok) failed++; };

// a fake GitHub contents API: one file, sha changes on every PUT
const gh = { content: null, sha: null, puts: 0 };
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (!/\/repos\/me\/trails-private\/contents\/trails\.json/.test(req.url)) { res.writeHead(404); return res.end(); }
    if (req.method === 'GET') {
      if (!gh.content) { res.writeHead(404); return res.end('{}'); }
      if (/raw/.test(req.headers.accept || '')) { res.writeHead(200); return res.end(gh.content); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ sha: gh.sha }));
    }
    if (req.method === 'PUT') {
      const j = JSON.parse(b);
      if (gh.sha && j.sha !== gh.sha) { res.writeHead(409); return res.end('{}'); }
      gh.content = Buffer.from(j.content, 'base64').toString('utf8'); gh.sha = 'sha' + (++gh.puts);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ content: { sha: gh.sha } }));
    }
    res.writeHead(405); res.end();
  });
});

function server(file) {
  const env = { ...process.env, PORT: String(PORT), RELAY_KEY: KEY, TRAILS_FILE: file, TRAILS_BACKUP_S: '1',
    TRAILS_GITHUB_REPO: 'me/trails-private', TRAILS_GITHUB_TOKEN: 'fake', TRAILS_GITHUB_API: 'http://127.0.0.1:18182' };
  const c = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  c.log = ''; c.stdout.on('data', (d) => (c.log += d)); c.stderr.on('data', (d) => (c.log += d));
  return c;
}
async function up(c) { for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch (e) { /* not yet */ } await sleep(100); } throw new Error('server did not start:\n' + c.log); }
const post = async (op, body) => { const r = await fetch(`${BASE}/trails/${op}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); return { status: r.status, ...(await r.json()) }; };
const get = async (q) => (await fetch(`${BASE}/trails?${new URLSearchParams(q)}`)).json();
const stop = (c) => new Promise((r) => { c.on('exit', r); c.kill('SIGTERM'); });

(async () => {
  await new Promise((r) => fake.listen(18182, r));
  const file = path.join(tmp, 'trails.json');
  let c = server(file);
  try {
    await up(c);
    // sign-in
    const a = await post('login', { id: '하늘', pin: '1234' });
    check('new id is created', a.status === 200 && a.created && a.token, a);
    const a2 = await post('login', { id: '하늘', pin: '1234' });
    check('same id + PIN signs in again', a2.status === 200 && !a2.created);
    check('wrong PIN is refused', (await post('login', { id: '하늘', pin: '0000' })).status === 401);
    check('PIN must be 4 digits', (await post('login', { id: 'x', pin: '12a4' })).status === 400);
    check('id rule (no spaces)', (await post('login', { id: 'a b', pin: '1234' })).status === 400);
    for (let i = 0; i < 4; i++) await post('login', { id: 'lock', pin: '1111' });
    await post('login', { id: 'lock', pin: '1111' });   // creates on the first call: 1111 is the PIN now
    for (let i = 0; i < 5; i++) await post('login', { id: 'lock', pin: '2222' });
    check('5 wrong PINs lock the id', (await post('login', { id: 'lock', pin: '1111' })).status === 429);
    const b = await post('login', { id: 'other', pin: '9999' });

    // a web walk
    const s = await post('start', { token: a.token, scan: 'scanA', kind: 'web' });
    check('web session starts', s.ok && s.kind === 'web', s);
    const pts = []; for (let i = 0; i < 30; i++) pts.push([i * 0.1, Math.sin(i / 5), 1.4]);
    check('points accepted', (await post('add', { token: a.token, sid: s.sid, pts })).n > 20);
    check('someone else cannot write to it', (await post('add', { token: b.token, sid: s.sid, pts })).status === 404);
    let v = await get({ scan: 'scanA', token: a.token });
    check('live web walk is visible while walking', v.trails.some((t) => t.kind === 'web' && t.live && t.mine));
    check('end keeps it', (await post('end', { token: a.token, sid: s.sid })).kept === true);
    check('a 10 cm wiggle is not kept', await (async () => { const s2 = await post('start', { token: a.token, scan: 'scanA', kind: 'web' }); await post('add', { token: a.token, sid: s2.sid, pts: [[0, 0, 1], [0.05, 0, 1], [0.1, 0, 1]] }); return (await post('end', { token: a.token, sid: s2.sid })).kept === false; })());

    // a site walk reported by Unreal, claimed by a signed-in viewer
    const site = await post('start', { token: b.token, scan: 'scanA', kind: 'site' });
    const ue = new WebSocket(`ws://127.0.0.1:${PORT}/ws?room=arko&role=unreal&key=${KEY}`);
    await new Promise((r) => ue.on('open', r));
    for (let i = 0; i < 40; i++) { ue.send(`PTU1,${i},1,phone,${(i * 0.08).toFixed(3)},0.500,1.200,0.0,-1,-1,0,scanA\n`); await sleep(15); }
    await sleep(100);
    v = await get({ scan: 'scanA', token: b.token });
    check('site walk shows live', v.trails.some((t) => t.kind === 'site' && t.live && t.mine));
    ue.send('PTU1,99,0,phone,0,0,0,0.0,-1,-1,0,scanA\n'); await sleep(200);
    await post('end', { token: b.token, sid: site.sid });
    // an unclaimed walk on another scan, from an Unreal without the scan field
    for (let i = 0; i < 30; i++) { ue.send(`PTU1,${200 + i},1,esp32,${(i * 0.1).toFixed(3)},1.000,1.000,0.0,-1,-1,0,scanB\n`); await sleep(10); }
    ue.send('PTU1,300,0,esp32,0,0,0,0.0,-1,-1,0,scanB\n'); await sleep(200);
    ue.close();

    v = await get({ scan: 'scanA', token: a.token });
    const web = v.trails.filter((t) => t.kind === 'web'), siteT = v.trails.filter((t) => t.kind === 'site');
    check('scan A: 1 web + 1 site trail', web.length === 1 && siteT.length === 1, v.trails.map((t) => t.kind));
    check('my web trail is marked mine, the site one is not', web[0].mine && !siteT[0].mine);
    check('the reply carries only my own id', v.id === '하늘' && !JSON.stringify(v.trails).includes('other'));
    check('anonymous view has no ids and no "mine"', (await get({ scan: 'scanA' })).trails.every((t) => !t.mine));
    check('scan B keeps the anonymous site walk', (await get({ scan: 'scanB' })).trails.filter((t) => t.kind === 'site').length === 1);
    check('points are rounded to cm', siteT[0].pts.every((p) => p.every((x) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6)));
    check('PINs are not stored', !fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes('"1234"'));

    await sleep(1500);   // backup interval 1 s
    check('backup pushed to the private repo', gh.puts >= 1 && gh.content.includes('scanA'), gh.puts);
    await sleep(3500);   // local file is written 3 s after the last change (SIGTERM also flushes it on Linux; Windows kills at once)
    check('local file holds all 3 trails', fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).trails.length === 3);
    await stop(c);

    // restart with the same file: still there, old sign-ins need a new login, the PIN still works
    c = server(file); await up(c);
    check('restart keeps trails', (await get({ scan: 'scanA' })).trails.length === 2);
    check('old token is gone after a restart', (await post('start', { token: a.token, scan: 'scanA', kind: 'web' })).status === 401);
    check('PIN still works after a restart', (await post('login', { id: '하늘', pin: '1234' })).status === 200);
    await stop(c);

    // a new, empty container (App Platform redeploy): restores from the private repo
    c = server(path.join(tmp, 'fresh', 'trails.json')); await up(c); await sleep(300);
    check('empty server restores from the backup', (await get({ scan: 'scanA' })).trails.length === 2);
    check('restored accounts keep their PIN', (await post('login', { id: '하늘', pin: '1234' })).status === 200 && (await post('login', { id: '하늘', pin: '4321' })).status === 401);
  } catch (e) { console.log('FAIL', e.stack || e.message); failed++; }
  try { await stop(c); } catch (e) { /* gone */ }
  fake.close();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
