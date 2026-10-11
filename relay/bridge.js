// UDP <-> relay bridge. A UDP-only device (or tools/pose_sim.py) talks to this PC as if it were Unreal,
// and the bridge carries its lines over the internet relay with the given role.
//   node bridge.js --url wss://host --key K --room arko --role phone --listen 7787 --reply-port 4211
// Lines from the relay go back to the last UDP sender's IP at --reply-port (default: its source port).
'use strict';
const dgram = require('dgram');
const WebSocket = require('ws');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url', 'ws://127.0.0.1:8080'), key = arg('--key', ''), room = arg('--room', 'arko');
const role = arg('--role', 'phone'), listen = Number(arg('--listen', '7787')), replyPort = Number(arg('--reply-port', '0'));

const udp = dgram.createSocket('udp4');
let peer = null, ws = null, up = 0, down = 0;

function connect() {
  ws = new WebSocket(`${url}/ws?room=${encodeURIComponent(room)}&role=${role}&key=${encodeURIComponent(key)}`);
  ws.on('open', () => console.log(`relay connected as ${role} (${room})`));
  ws.on('message', (d) => {
    const s = d.toString();
    if (s.startsWith('PTR1') || !peer) return;
    udp.send(s, replyPort || peer.port, peer.address); down++;
  });
  ws.on('close', () => setTimeout(connect, 2000));
  ws.on('error', (e) => console.log('relay error:', e.message));
}
udp.on('message', (msg, rinfo) => {
  peer = rinfo;
  if (ws && ws.readyState === 1) { ws.send(msg.toString()); up++; }
});
udp.bind(listen, () => console.log(`UDP :${listen} -> ${url} as ${role}`));
setInterval(() => process.stdout.write(`\rup ${up}  down ${down}   `), 1000);
connect();
