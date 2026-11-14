// End-to-end: local relay (with trails) + static site + headless Chrome.
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(path.join(process.argv[2], 'relay', 'x.js'));
const WebSocket = require('ws');

const ROOT = path.resolve(process.argv[2]);   // PhoneTwin_v4
const OUT = process.argv[3];             // screenshots folder
const SCAN = 'sample_test_room', ROOM = 'webtest', KEY = 'k';
const RELAY = 18281, WEB = 18290;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (n, ok, x) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${!ok && x !== undefined ? ' · ' + JSON.stringify(x) : ''}`); if (!ok) failed++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-web-'));
const relay = spawn(process.execPath, [path.join(ROOT, 'relay', 'server.js')], { env: { ...process.env, PORT: String(RELAY), RELAY_KEY: KEY, TRAILS_FILE: path.join(tmp, 't.json') }, stdio: 'ignore' });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ply': 'application/octet-stream' };
const web = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(WEB);
await sleep(800);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'] });
const errors = [];
async function openPage(ctx, mobile) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e))); if (process.env.DBG) page.on('console', (m) => console.log('  console', m.type(), m.text().slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_CONNECTION_REFUSED|404|401|409/.test(m.text())) errors.push(m.text()); });
  if (mobile) await page.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, userAgent: 'Mozilla/5.0 (iPhone) Mobile' });
  else await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${WEB}/immersive.html?relay=ws://127.0.0.1:${RELAY}&room=${ROOM}#${SCAN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__immersive && window.__immersive.info.points > 0, { timeout: 60000 });
  return page;
}
const st = (page) => page.evaluate(() => { const t = window.__immersive.trails.state; return { sid: t.sid, kind: t.kind, id: t.id, ready: t.ready, n: t.trails.length,
  phase: window.__immersive.trails.phase, shown: window.__immersive.trails.layers.web.parent.visible, dim: window.__immersive.uniforms.uDim.value,
  mode: document.getElementById('gate').dataset.mode, gate: !document.getElementById('gate').classList.contains('hidden'),
  chip: document.getElementById('chipText').textContent, msg: document.getElementById('gateMsg').textContent, count: document.getElementById('trailCount').textContent,
  layers: Object.fromEntries(Object.entries(window.__immersive.trails.layers).map(([k, l]) => [k, l.geometry.getAttribute('position') ? l.geometry.getAttribute('position').count : 0])) }; });

try {
  // ---------------- visitor A on the web
  const ctxA = await browser.createBrowserContext();
  const A = await openPage(ctxA);
  await A.waitForFunction(() => window.__immersive.trails.state.ready, { timeout: 10000 });
  let s = await st(A);
  check('gate shows the sign-in on entering', s.gate && s.mode === 'login', s);
  await A.screenshot({ path: path.join(OUT, '1_gate.png') });
  await A.type('#gateId', '별빛'); await A.type('#gatePin', '12ab34');   // letters are dropped
  check('PIN box keeps digits only', (await A.$eval('#gatePin', (e) => e.value)) === '1234');
  await A.click('#gateForm button[type=submit]');
  await A.waitForFunction(() => window.__immersive.trails.state.sid, { timeout: 8000 });
  s = await st(A);
  check('signed in: web experience started', !s.gate && s.kind === 'web' && /웹 체험 중/.test(s.chip), s);
  // walk with the keyboard for 5 s (forward, then turn)
  await A.keyboard.down('w'); await sleep(2500); await A.keyboard.down('d'); await sleep(1500); await A.keyboard.up('d'); await sleep(1000); await A.keyboard.up('w');
  await sleep(1500);
  s = await st(A);
  check('while exploring no trails are drawn (the space only)', s.phase === 'explore' && !s.shown && s.layers.webMine === 0 && s.dim === 1, s);
  check('exploring: a short fading tail of light right behind the butterfly', await A.evaluate(() => { const t = window.__immersive.trails.tail, g = t.geometry.getAttribute('position'), f = t.geometry.getAttribute('aFresh');
    if (!t.visible || !g || g.count < 10) return false;
    const end = new window.__immersive.me.position.constructor(g.getX(g.count - 1), g.getY(g.count - 1), g.getZ(g.count - 1));
    return end.distanceTo(window.__immersive.me.position) < 0.05 && f.getX(0) < 0.6 && f.getX(f.count - 1) === 1; }));
  check('exploring folds the settings away', await A.evaluate(() => document.getElementById('panel').classList.contains('hidden')));
  await A.screenshot({ path: path.join(OUT, '2_walking.png') });
  await A.click('#endBtn');
  await A.waitForFunction(() => document.getElementById('gate').dataset.mode === 'again' && !document.getElementById('gate').classList.contains('hidden'), { timeout: 8000 });
  s = await st(A);
  check('ending shows the summary', /흔적이 남았습니다/.test(s.msg), s.msg);
  check('finished: review = trails shown, space dimmed, whole-room view', s.phase === 'review' && s.shown && s.dim < 0.5 && await A.evaluate(() => document.querySelector('#cam .on').dataset.v === 'orbit'), s);
  check('after ending: no "start again", only a new id or browsing', await A.evaluate(() => document.getElementById('gateAgain').hidden && !document.getElementById('gateSwitch').hidden && document.getElementById('gateSwitch').classList.contains('primary')));
  await A.click('#gateLook'); await sleep(1500);
  s = await st(A);
  check('saved web trail comes back from the server as mine', s.n === 1 && s.layers.webMine > 20 && s.layers.web === 0, s);
  check('my id label sits on my trail', await A.evaluate(() => window.__immersive.trails.label.visible && window.__immersive.trails.label.userData.text.startsWith('별빛 (나)')));

  // ---------------- the real system appears: Unreal walks a person through the room
  const ue = new WebSocket(`ws://127.0.0.1:${RELAY}/ws?room=${ROOM}&role=unreal&key=${KEY}`);
  await new Promise((r) => ue.on('open', r));
  let seq = 0;
  const walk = setInterval(() => { const t = seq / 15; ue.send(`PTU1,${++seq},1,phone,${(Math.sin(t * 0.5) * 1.2).toFixed(3)},${(Math.sin(t) * 0.8).toFixed(3)},1.200,0.0,-1,-1,0,${SCAN}\n`); }, 66);
  // visitor B signs in on site (the page follows the real person, so the experience is 현장)
  const ctxB = await browser.createBrowserContext();
  const B = await openPage(ctxB, true);
  await B.waitForFunction(() => window.__immersive.trails.state.ready, { timeout: 10000 });
  await B.screenshot({ path: path.join(OUT, '3_gate_mobile.png') });
  await B.type('#gateId', '하늘'); await B.type('#gatePin', '4321');
  await sleep(1500);   // let the page see the system
  await B.click('#gateForm button[type=submit]');
  await B.waitForFunction(() => window.__immersive.trails.state.sid, { timeout: 8000 });
  s = await st(B);
  check('with the system on, the experience is on-site', s.kind === 'site' && /현장 체험 중/.test(s.chip), s);
  await sleep(6000);
  await B.evaluate(() => window.__immersive.trails.refresh()); await sleep(800);
  s = await st(B);
  check('on-site experience: the live walk is recorded but not drawn', s.phase === 'explore' && !s.shown && s.layers.siteMine === 0 && (await (await fetch(`http://127.0.0.1:${RELAY}/trails?scan=${SCAN}`)).json()).trails.some((t) => t.kind === 'site' && t.live), s);
  await B.screenshot({ path: path.join(OUT, '4_site_mobile.png') });
  clearInterval(walk); ue.send(`PTU1,${++seq},0,phone,0,0,0,0.0,-1,-1,0,${SCAN}\n`); await sleep(300);
  await B.click('#endBtn'); await B.waitForFunction(() => document.getElementById('gate').dataset.mode === 'again', { timeout: 8000 });
  await B.click('#gateLook'); await sleep(1200);
  s = await st(B);
  check('earlier visitors are barely there, mine is bright', await B.evaluate(() => { const L = window.__immersive.trails.layers; return L.web.material.uniforms.uAlpha.value < 0.2 && L.web.material.uniforms.uWidth.value < L.siteMine.material.uniforms.uWidth.value && L.siteMine.material.uniforms.uAlpha.value > 0.8; }));
  check('B sees A\'s web trail (purple, no id) and own site trail (blue, mine)', s.layers.web > 20 && s.layers.siteMine > 20 && s.layers.webMine === 0, s.layers);
  check('legend counts', /현장 1 · 웹 1 · 내 흔적 1/.test(s.count), s.count);
  ue.close();

  // ---------------- A refreshes: sees B's site trail without B's id
  await A.evaluate(() => window.__immersive.trails.refresh()); await sleep(800);
  s = await st(A);
  check('A sees the site trail in blue, not as mine', s.layers.site > 20 && s.layers.siteMine === 0, s.layers);
  const body = await (await fetch(`http://127.0.0.1:${RELAY}/trails?scan=${SCAN}`)).text();
  check('anonymous API reply has no ids', !body.includes('하늘') && !body.includes('별빛'));
  await sleep(4000);   // the page is back on the demo walk; let the camera settle
  await A.click('#panelBtn').catch(() => {});
  await A.screenshot({ path: path.join(OUT, '5_both.png') });

  // ---------------- wrong PIN
  const ctxC = await browser.createBrowserContext();
  const C = await openPage(ctxC);
  await C.waitForFunction(() => window.__immersive.trails.state.ready, { timeout: 10000 });
  await C.type('#gateId', '하늘'); await C.type('#gatePin', '0000'); await C.click('#gateForm button[type=submit]'); await sleep(1200);
  s = await st(C);
  check('wrong PIN for an existing id is refused with a message', s.gate && !s.sid && /비밀번호가 맞지 않습니다/.test(s.msg), s.msg);
  await C.$eval('#gatePin', (e) => { e.value = ''; }); await C.type('#gatePin', '4321'); await C.click('#gateForm button[type=submit]'); await sleep(1200);
  s = await st(C);
  check('a finished id cannot sign in again (right PIN too)', s.gate && !s.sid && /이미 체험을 마쳤습니다/.test(s.msg), s.msg);
  // A (finished, still in the tab) presses the chip's start: told to make a new id; that button opens an empty sign-in
  await A.click('#chipStart'); await sleep(300);
  s = await st(A);
  check('finished visitor pressing start is told to make a new id', s.gate && s.mode === 'again' && /새 아이디/.test(s.msg) && !s.sid, s);
  await A.click('#gateSwitch'); await sleep(200);
  s = await st(A);
  check('"새 아이디로 체험하기" opens an empty sign-in', s.mode === 'login' && (await A.$eval('#gateId', (e) => e.value)) === '', s);
  await A.type('#gateId', '별빛2'); await A.type('#gatePin', '1111'); await A.click('#gateForm button[type=submit]');
  await A.waitForFunction(() => window.__immersive.trails.state.sid, { timeout: 8000 });
  s = await st(A);
  check('a new id starts a new experience, back to exploring', s.id === '별빛2' && s.phase === 'explore' && !s.shown && s.dim === 1 && await A.evaluate(() => document.querySelector('#cam .on').dataset.v === 'follow'), s);

  // ---------------- a visitor who only looks: "흔적 보기" without signing in
  const before = await (await fetch(`http://127.0.0.1:${RELAY}/trails/status`)).json();
  const E = await openPage(await browser.createBrowserContext());
  await E.waitForFunction(() => window.__immersive.trails.state.ready, { timeout: 10000 });
  check('the first screen offers "흔적 보기" under "체험 시작"', await E.evaluate(() => { const b = document.getElementById('gateBrowse'), sub = document.querySelector('#gateForm button[type=submit]');
    return b && b.offsetParent !== null && b.getBoundingClientRect().top > sub.getBoundingClientRect().top; }));
  await E.click('#gateBrowse'); await sleep(1500);
  s = await st(E);
  check('without signing in: every trail shown, the latest bright, earlier faint, no id, no tail', !s.gate && s.phase === 'review' && s.shown && s.dim < 0.5 && s.layers.webMine + s.layers.siteMine > 20 && s.layers.web + s.layers.site > 20 && !s.id
    && await E.evaluate(() => !window.__immersive.trails.label.visible && !window.__immersive.trails.tail.visible) && /로그인 없이/.test(s.chip), s);
  const after = await (await fetch(`http://127.0.0.1:${RELAY}/trails/status`)).json();
  check('looking records nothing', after.visitors === before.visitors && after.sessions === before.sessions && after.trails === before.trails, { before, after });
  await E.screenshot({ path: path.join(OUT, '6_guest.png') });
  // ---------------- "흔적 없이 둘러보기": the space only
  const F = await openPage(await browser.createBrowserContext());
  await F.waitForFunction(() => window.__immersive.trails.state.ready, { timeout: 10000 });
  await F.click('#gateFree'); await sleep(1200);
  s = await st(F);
  check('"흔적 없이 둘러보기": the space only, no trails, no tail, nothing recorded', !s.gate && s.phase === 'idle' && !s.shown && s.dim === 1 && /흔적 없이/.test(s.chip)
    && await F.evaluate(() => !window.__immersive.trails.tail.visible) && (await (await fetch(`http://127.0.0.1:${RELAY}/trails/status`)).json()).visitors === before.visitors, s);
  await F.close();
  await E.click('#chipStart'); await sleep(300);
  check('"체험 시작" from looking opens the sign-in', (await st(E)).mode === 'login' && (await st(E)).gate);

  for (const pg of [A, B, C, E]) await pg.close().catch(() => {});   // software GL: five live 3D pages slow the next one down
  // ---------------- relay without the trail API: browse without recording
  const D = await (await browser.createBrowserContext()).newPage();
  D.on('pageerror', (e) => errors.push(String(e)));
  await D.setViewport({ width: 1280, height: 800 });
  await D.goto(`http://127.0.0.1:${WEB}/immersive.html?relay=ws://127.0.0.1:18299&room=x#${SCAN}`);
  await D.waitForFunction(() => document.getElementById('gate').dataset.mode === 'offline', { timeout: 15000 });
  await D.click('#gateOffline'); await sleep(300);
  check('no trail server: "기록 없이 둘러보기" opens the view', (await st(D)).gate === false);
} catch (e) { console.log('FAIL', e.stack); failed++; }
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close(); relay.kill(); web.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
