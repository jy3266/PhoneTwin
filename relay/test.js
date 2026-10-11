// Relay checks: auth, routing, read-only viewer, ping/pong round-trip time.
//   node test.js                      -> starts a local server with a key and tests it
//   node test.js --url wss://host --key K [--room R]   -> tests a deployed relay and prints RTT
'use strict';
const { spawn } = require('child_process');
const WebSocket = require('ws');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
let URL_ = arg('--url', ''), KEY = arg('--key', 'test-key');
const ROOM = arg('--room', 'test-' + Math.random().toString(36).slice(2, 8));
let child = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function open(role, key = KEY) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL_}/ws?room=${ROOM}&role=${role}&key=${encodeURIComponent(key)}`);
    ws.got = [];
    ws.on('message', (d) => ws.got.push(...d.toString().split('\n').filter((l) => l && !l.startsWith('PTR1,peers'))));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (_, res) => reject(new Error('HTTP ' + res.statusCode)));
  });
}
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

(async () => {
  if (!URL_) {
    URL_ = 'ws://127.0.0.1:18080';
    child = spawn(process.execPath, [__dirname + '/server.js'], { env: { ...process.env, PORT: '18080', RELAY_KEY: KEY }, stdio: 'ignore' });
    await sleep(600);
  }
  try {
    let rejected = false;
    try { await open('phone', 'wrong-key'); } catch (e) { rejected = /401/.test(e.message); }
    check('wrong key is refused (401)', rejected);

    const phone = await open('phone'), esp = await open('esp32'), unreal = await open('unreal'), viewer = await open('viewer', '');
    await sleep(200);
    check('welcome line', phone.got.some((l) => l.startsWith('PTR1,welcome,' + ROOM + ',phone')));
    [phone, esp, unreal, viewer].forEach((w) => (w.got.length = 0));

    phone.send('PTP1,1,1,0.5,1.2,-3,0,0,-1,0,1,0,scan\n');
    esp.send('PTE1,1,1,1,2,1,90,0,0\n');
    unreal.send('PTH1,9,1,128,0,0,123\n');
    viewer.send('PTH1,1,1,255,1,0,0\n');   // must be dropped
    await sleep(300);
    check('phone -> unreal', unreal.got.includes('PTP1,1,1,0.5,1.2,-3,0,0,-1,0,1,0,scan'));
    check('esp32 -> unreal', unreal.got.includes('PTE1,1,1,1,2,1,90,0,0'));
    check('unreal -> phone', phone.got.includes('PTH1,9,1,128,0,0,123'));
    check('unreal -> esp32', esp.got.includes('PTH1,9,1,128,0,0,123'));
    check('viewer sees all three', viewer.got.length === 3);
    check('phone does not see esp32', !phone.got.some((l) => l.startsWith('PTE1')));
    check('viewer is read-only', !phone.got.includes('PTH1,1,1,255,1,0,0') && !esp.got.includes('PTH1,1,1,255,1,0,0'));

    // round trip: client -> server -> client, and phone -> unreal -> phone through the relay
    const rtt = [], loop = [];
    unreal.on('message', (d) => { const s = d.toString(); if (s.startsWith('PTP1,loop,')) unreal.send(s.replace('PTP1', 'PTH1')); });
    for (let i = 0; i < 20; i++) {
      const t = process.hrtime.bigint();
      await new Promise((r) => { phone.once('message', function h(d) { if (d.toString().startsWith('PTR1,pong')) r(); else phone.once('message', h); }); phone.send(`PTR1,ping,${i}`); });
      rtt.push(Number(process.hrtime.bigint() - t) / 1e6);
      const t2 = process.hrtime.bigint();
      await new Promise((r) => { phone.once('message', function h(d) { if (d.toString().startsWith('PTH1,loop')) r(); else phone.once('message', h); }); phone.send(`PTP1,loop,${i}`); });
      loop.push(Number(process.hrtime.bigint() - t2) / 1e6);
    }
    const stat = (a) => { a.sort((x, y) => x - y); return `median ${a[a.length >> 1].toFixed(1)} ms, max ${a[a.length - 1].toFixed(1)} ms`; };
    console.log(`client <-> relay round trip: ${stat(rtt)}`);
    console.log(`phone -> relay -> unreal -> relay -> phone: ${stat(loop)}`);
    [phone, esp, unreal, viewer].forEach((w) => w.close());
  } catch (e) { console.log('FAIL', e.message); failed++; }
  if (child) child.kill();
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
