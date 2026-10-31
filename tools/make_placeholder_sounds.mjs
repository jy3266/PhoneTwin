// Placeholder sounds, made entirely here (nothing downloaded, no licence questions), one pair per collision name:
//   임시_<이름>_다가감.wav  seamless 6 s loop   ·   임시_<이름>_닿음.wav  one short hit
// Collisions that already have a sound keep it; replace these any time in the editor.
//   node tools/make_placeholder_sounds.mjs
import fs from 'node:fs';
import path from 'node:path';
import { COLLISIONS, SOUNDS } from './scan_lib.mjs';
import { saveCollisions } from './make_collisions.mjs';

const RATE = 48000, LOOP = 6;
const D = 146.83, E = 164.81, Fs = 185, A = 220, B = 246.94;   // D major pentatonic, so several sounds together never clash

// pad: [Hz, amp]; air: noise {amp, lp, hp}; breath: swells per loop; events: {rate, hz, decay, amp, noise}; hit: touch sound
const VOICES = {
  screen: { pad: [[A / 2, 1], [A, .3], [E * 8, .025]], air: { amp: .03, lp: 9000, hp: 3000 }, hit: { bell: [A * 2, A * 4.01], decay: 1.2 } },
  laptop: { pad: [[D, .35], [A, .2]], air: { amp: .3, lp: 900, hp: 150 }, breath: 1, hit: { bell: [D * 4], decay: .8, click: .4 } },
  keyboard: { pad: [[D, .15]], air: { amp: .1, lp: 3000, hp: 400 }, events: { rate: 7, hz: 1800, decay: .025, amp: .5, noise: 1 }, hit: { click: 1, bell: [A * 4], decay: .3 } },
  mouse: { pad: [[A / 2, .15]], events: { rate: 1.5, hz: 2600, decay: .012, amp: .7, noise: 1 }, hit: { click: 1, decay: .1 } },
  chair: { pad: [[D / 2, .8], [D, .3]], events: { rate: .5, hz: 240, decay: .35, amp: .5, noise: .4 }, hit: { knock: 180, decay: .35 } },
  bed: { pad: [[D / 2, .4]], air: { amp: .5, lp: 500, hp: 40 }, breath: 2, hit: { thump: 80, decay: .5 } },
  pillow: { air: { amp: .6, lp: 700, hp: 60 }, breath: 3, hit: { thump: 110, decay: .3 } },
  book: { pad: [[B, .1]], air: { amp: .3, lp: 5000, hp: 900 }, breath: 3, hit: { paper: 1, decay: .22 } },
  bible: { pad: [[D, .7], [A, .5], [D * 2, .35], [Fs * 2, .2]], air: { amp: .1, lp: 3000, hp: 600 }, breath: 1, hit: { paper: .6, bell: [D * 4, A * 4], decay: 2.2 } },
  glass: { pad: [[D * 4, .35], [A * 4, .18]], breath: 2, events: { rate: .4, hz: 3500, decay: .25, amp: .25 }, hit: { bell: [D * 8, D * 13.2, D * 19.4], decay: 1 } },
  cosmetic: { pad: [[Fs * 4, .25], [B * 4, .15]], air: { amp: .05, lp: 9000, hp: 4000 }, breath: 3, hit: { bell: [B * 8, B * 13], decay: .6 } },
  bowl: { pad: [[A * 2, .7], [A * 2.003, .7], [A * 5.4, .1]], breath: 1, hit: { bell: [A * 2, A * 5.4, A * 8.9], decay: 3 } },
  dish: { pad: [[E * 2, .7], [E * 2.004, .6]], breath: 2, hit: { bell: [E * 4, E * 10.2], decay: 1.4 } },
  clock: { pad: [[D, .15]], events: { rate: 1, hz: 2100, decay: .018, amp: .9, regular: 1 }, hit: { bell: [D * 4, A * 4], decay: 2 } },
  bag: { air: { amp: .35, lp: 2200, hp: 300 }, breath: 3, events: { rate: 1, hz: 700, decay: .06, amp: .3, noise: 1 }, hit: { thump: 140, paper: .3, decay: .25 } },
  remote: { pad: [[A, .12]], events: { rate: .8, hz: 1500, decay: .02, amp: .5 }, hit: { click: .8, bell: [A * 8], decay: .25 } },
  phone: { pad: [[A * 4, .22]], breath: 2, hit: { bell: [A * 4, A * 6], decay: .5 } },
  cloth: { air: { amp: .45, lp: 1800, hp: 200 }, breath: 2, hit: { paper: .5, thump: 120, decay: .2 } },
  tissue: { air: { amp: .3, lp: 7000, hp: 1500 }, breath: 3, hit: { paper: 1, decay: .15 } },
  calendar: { pad: [[E, .1]], air: { amp: .15, lp: 5000, hp: 1200 }, events: { rate: .5, hz: 3000, decay: .1, amp: .5, noise: 1 }, hit: { paper: 1, decay: .3 } },
  award: { pad: [[D, .7], [A, .55], [D * 2, .4], [A * 2, .15]], breath: 1, hit: { bell: [D * 2, A * 2, D * 4, Fs * 4], decay: 2.5 } },
  photo: { pad: [[D, .2]], box: [D * 4, Fs * 4, A * 4, B * 4, D * 8, B * 4, A * 4, Fs * 4], hit: { bell: [A * 4, D * 8], decay: 1.8 } },
  mirror: { pad: [[A * 4, .2], [A * 4.006, .2], [E * 8, .12]], breath: 1, hit: { bell: [E * 8, E * 8.02], decay: 2 } },
  wardrobe: { pad: [[D / 2, 1], [A / 2, .4]], air: { amp: .1, lp: 400, hp: 40 }, breath: 1, events: { rate: .3, hz: 160, decay: .6, amp: .4, noise: .5 }, hit: { knock: 95, decay: .7 } },
  door: { pad: [[A / 2, .2]], air: { amp: .4, lp: 650, hp: 120 }, breath: 1, events: { rate: .35, hz: 420, decay: .5, amp: .25, noise: .7 }, hit: { knock: 130, decay: .5 } },
  charcoal: { pad: [[D / 2, .25]], air: { amp: .08, lp: 500, hp: 40 }, events: { rate: 5, hz: 2400, decay: .01, amp: .8, noise: 1 }, hit: { click: .6, thump: 90, decay: .25 } },
  bin: { pad: [[E / 2, .5], [E * 1.5, .12]], breath: 2, hit: { knock: 210, decay: .45 } },
  stand: { pad: [[D / 2, .9], [D * .75, .3]], breath: 1, hit: { knock: 70, decay: .9 } },
  vanity: { pad: [[D / 2, .4], [A * 4, .1]], air: { amp: .04, lp: 8000, hp: 3000 }, breath: 2, hit: { knock: 170, bell: [A * 4], decay: .7 } },
  wall: { pad: [[D / 2, .35]], air: { amp: .4, lp: 350, hp: 40 }, breath: 1, hit: { thump: 75, knock: 120, decay: .4 } },
  plain: { pad: [[A, .5], [A * 1.003, .5], [A * 2, .15]], breath: 1, hit: { bell: [A * 2, A * 5.4], decay: 2 } },
};
const BY_NAME = { 'TV·모니터': 'screen', 노트북: 'laptop', 키보드: 'keyboard', 마우스: 'mouse', 의자: 'chair', 침대: 'bed', 배개: 'pillow', 베개: 'pillow', 책: 'book', 성경책: 'bible', 병: 'glass', 화장품: 'cosmetic', 컵: 'bowl', 그릇: 'dish', 시계: 'clock', 핸드백: 'bag', 배낭: 'bag', 여행가방: 'bag', 리모컨: 'remote', 휴대폰: 'phone', 넥타이: 'cloth', 옷: 'cloth', 휴지: 'tissue', 달력: 'calendar', 표창장: 'award', '할머니 사진': 'photo', '아이들 사진': 'photo', 거울: 'mirror', 장롱: 'wardrobe', 문: 'door', 숯: 'charcoal', 휴지통: 'bin', 좌대: 'stand', 화장대: 'vanity', 벽: 'wall' };

function rng(text) { let s = 2166136261; for (const ch of text) s = Math.imul(s ^ ch.codePointAt(0), 16777619) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const lowpass = (hz) => 1 - Math.exp(-2 * Math.PI * hz / RATE);

/** Band-limited noise that joins up at the loop point: the filter runs twice around the ring and the second round is kept. */
function ringNoise(n, lp, hp, rnd) {
  const src = Float32Array.from({ length: n }, () => rnd() * 2 - 1), out = new Float32Array(n), a = lowpass(lp), b = lowpass(hp);
  let l1 = 0, l2 = 0, h = 0;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { l1 += a * (src[i] - l1); l2 += a * (l1 - l2); h += b * (l2 - h); out[i] = l2 - h; }
  return out;
}
function normalise(x, peak) { let m = 1e-9; for (const v of x) m = Math.max(m, Math.abs(v)); for (let i = 0; i < x.length; i++) x[i] *= peak / m; return x; }

function makeLoop(v, seed) {
  const n = RATE * LOOP, out = new Float32Array(n), rnd = rng(seed);
  const swell = (i) => (v.breath ? 0.6 + 0.4 * Math.sin(2 * Math.PI * v.breath * i / n) : 1);
  for (const [hz, amp] of v.pad || []) {
    const cycles = Math.round(hz * LOOP), phase = rnd() * 6.28;   // whole cycles per loop: no click at the join
    for (let i = 0; i < n; i++) out[i] += amp * .3 * Math.sin(2 * Math.PI * cycles * i / n + phase);
  }
  if (v.air) { const a = ringNoise(n, v.air.lp, v.air.hp, rnd); normalise(a, 1); for (let i = 0; i < n; i++) out[i] += a[i] * v.air.amp; }
  for (let i = 0; i < n; i++) out[i] *= swell(i);
  const strike = (at, hz, decay, amp, noise) => {
    const len = Math.floor(decay * 6 * RATE), wet = noise || 0;
    let lp = 0; const f = lowpass(hz);
    for (let t = 0; t < len; t++) {
      const e = amp * Math.exp(-t / (decay * RATE)) * Math.min(1, t / 40);
      lp += f * ((rnd() * 2 - 1) - lp);
      out[(at + t) % n] += e * ((1 - wet) * Math.sin(2 * Math.PI * hz * t / RATE) + wet * lp * 4);
    }
  };
  if (v.events) {
    const count = Math.max(1, Math.round(v.events.rate * LOOP));
    for (let k = 0; k < count; k++) {
      const at = v.events.regular ? Math.floor(k * n / count) : Math.floor(rnd() * n);
      strike(at, v.events.hz * (v.events.regular ? 1 : .8 + rnd() * .4), v.events.decay, v.events.amp * (v.events.regular ? 1 : .5 + rnd() * .5), v.events.noise);
    }
  }
  if (v.box) v.box.forEach((hz, k) => strike(Math.floor(k * n / v.box.length), hz, .5, .55));
  return normalise(out, .35);
}

function makeHit(h, seed) {
  const n = Math.floor(RATE * Math.min(4, h.decay * 2.2 + .15)), out = new Float32Array(n), rnd = rng(seed);
  (h.bell || []).forEach((hz, k) => { for (let t = 0; t < n; t++) out[t] += Math.exp(-t / (h.decay * RATE * (1 - k * .12) * .35)) * Math.sin(2 * Math.PI * hz * t / RATE) / (k + 1); });
  if (h.knock) { for (let t = 0; t < n; t++) out[t] += Math.exp(-t / (h.decay * RATE * .2)) * (Math.sin(2 * Math.PI * h.knock * t / RATE) + .4 * Math.sin(2 * Math.PI * h.knock * 2.3 * t / RATE)); }
  if (h.thump) { for (let t = 0; t < n; t++) out[t] += Math.exp(-t / (h.decay * RATE * .25)) * Math.sin(2 * Math.PI * h.thump * Math.exp(-t / 12000) * t / RATE); }
  if (h.paper) { const a = ringNoise(n, 7000, 1000, rnd); normalise(a, 1); for (let t = 0; t < n; t++) out[t] += h.paper * a[t] * Math.exp(-t / (h.decay * RATE * .4)); }
  if (h.click) { const len = Math.floor(.012 * RATE); for (let t = 0; t < len && t < n; t++) out[t] += h.click * (rnd() * 2 - 1) * (1 - t / len); }
  for (let t = 0; t < 30 && t < n; t++) out[t] *= t / 30;
  for (let t = 0; t < 400 && t < n; t++) out[n - 1 - t] *= t / 400;
  return normalise(out, .5);
}

function wav(x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}

fs.mkdirSync(SOUNDS, { recursive: true });
const made = new Map();
function soundsFor(name) {
  const safe = name.replace(/[^\p{L}\p{N} _-]/gu, '_').trim();
  if (!made.has(safe)) {
    const key = BY_NAME[name] || BY_NAME[name.replace(/_\d+$/, '')] || 'plain', v = VOICES[key], near = `임시_${safe}_다가감.wav`, touch = `임시_${safe}_닿음.wav`;
    fs.writeFileSync(path.join(SOUNDS, near), wav(makeLoop(v, name)));
    fs.writeFileSync(path.join(SOUNDS, touch), wav(makeHit(v.hit, name)));
    made.set(safe, { near, touch, key });
  }
  return made.get(safe);
}

let assigned = 0;
for (const f of fs.readdirSync(COLLISIONS).filter((x) => x.endsWith('.json'))) {
  const id = f.slice(0, -5), data = JSON.parse(fs.readFileSync(path.join(COLLISIONS, f), 'utf8'));
  let changed = false;
  for (const c of data.collisions) {
    const s = soundsFor(c.name);
    if (!c.nearSound) { c.nearSound = s.near; changed = true; assigned++; }
    if (!c.touchSound) { c.touchSound = s.touch; changed = true; }
  }
  if (changed) saveCollisions(id, data);
}
console.log(`소리 ${made.size}쌍, 콜리전 ${assigned}개에 지정`);
for (const [name, s] of made) console.log(`  ${name}: ${s.key}`);
