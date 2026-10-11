// Phone Twin relay — WebSocket hub for when the phone, ESP32 and Unreal PC cannot share one Wi-Fi.
// Runs on DigitalOcean App Platform (HTTP/WebSocket only, no UDP). See PROTOCOL.md §3.
//   wss://<host>/ws?room=<room>&role=<phone|esp32|unreal|viewer>&key=<RELAY_KEY>
// Lines are forwarded unchanged: phone/esp32 -> unreal + viewer, unreal -> phone + esp32 + viewer.
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const RELAY_KEY = process.env.RELAY_KEY || '';
const VIEW_KEY = process.env.VIEW_KEY || '';
const ROLES = ['phone', 'esp32', 'unreal', 'viewer'];
const ROUTES = { phone: ['unreal', 'viewer'], esp32: ['unreal', 'viewer'], unreal: ['phone', 'esp32', 'viewer'], viewer: [] };

const rooms = new Map();   // room -> Set<ws>
const started = Date.now();
let forwarded = 0;

function peers(room) {
  const n = { phone: 0, esp32: 0, unreal: 0, viewer: 0 };
  for (const c of rooms.get(room) || []) n[c.role]++;
  return n;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/health') {
    const list = {};
    for (const r of rooms.keys()) list[r] = peers(r);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, service: 'phonetwin-relay', uptime_s: Math.round((Date.now() - started) / 1000), forwarded, keyRequired: !!RELAY_KEY, rooms: list }));
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || 'default').slice(0, 64);
  const role = url.searchParams.get('role') || '';
  const key = url.searchParams.get('key') || '';
  const need = role === 'viewer' ? VIEW_KEY : RELAY_KEY;
  if (url.pathname !== '/ws' || !ROLES.includes(role) || (need && key !== need)) {
    socket.write(`HTTP/1.1 ${need && key !== need ? '401 Unauthorized' : '400 Bad Request'}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.room = room; ws.role = role; ws.alive = true;
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(ws);
    ws.send(`PTR1,welcome,${room},${role}\n`);
    console.log(`+ ${role} ${room} (${req.headers['x-forwarded-for'] || req.socket.remoteAddress})`);

    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      if (text.startsWith('PTR1,ping,')) { ws.send(text.replace('PTR1,ping,', 'PTR1,pong,')); return; }
      const to = ROUTES[role];
      if (!to.length) return;
      for (const c of rooms.get(room)) {
        if (c !== ws && to.includes(c.role) && c.readyState === 1 && c.bufferedAmount < 256 * 1024) { c.send(text); forwarded++; }
      }
    });
    ws.on('close', () => {
      const set = rooms.get(room);
      if (set) { set.delete(ws); if (!set.size) rooms.delete(room); }
      console.log(`- ${role} ${room}`);
    });
  });
});

// liveness + peer counts
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 15000);
setInterval(() => {
  for (const [room, set] of rooms) {
    const n = peers(room);
    const line = `PTR1,peers,phone=${n.phone},esp32=${n.esp32},unreal=${n.unreal},viewer=${n.viewer}\n`;
    for (const c of set) if (c.readyState === 1) c.send(line);
  }
}, 2000);

server.listen(PORT, () => console.log(`phonetwin relay on :${PORT}${RELAY_KEY ? ' (key required)' : ' (no key!)'}`));
