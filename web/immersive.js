// Phone Twin "몰입 보기": the scanned room appears as points around the audience and dissolves into drifting dust
// away from them. The audience comes from the relay (PTU1 from Unreal > PTP1 phone > PTE1 ESP32, PROTOCOL.md §3).
// While the system is connected only the real person moves it (it waits in place before the walking test);
// without a system a slow demo walk plays, and W A S D / arrow keys / a click or tap on the floor walk by hand.
// On phones the ✋ button turns the view with the hand holding the phone (deviceorientation); touch drags look around.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------------------------------------------------------------- renderer, camera, bloom
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));   // phones: fewer pixels, steadier frame rate
renderer.setClearColor(0x000000, 1);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.03, 200);
camera.position.set(3, 2.5, 3);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.enabled = false;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.55);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  uniforms.uScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

// ---------------------------------------------------------------- memory of where the audience has been (top-down, decays)
const MEM = 128;
const memF = new Float32Array(MEM * MEM), memB = new Uint8Array(MEM * MEM);
const memTex = new THREE.DataTexture(memB, MEM, MEM, THREE.RedFormat, THREE.UnsignedByteType);
memTex.magFilter = memTex.minFilter = THREE.LinearFilter; memTex.needsUpdate = true;
const memRect = new THREE.Vector4(-3, -3, 6, 6);   // min x, min z, size x, size z (scan frame, m)

function updateMemory(dt, p, radius, halfLife) {
  const decay = halfLife > 0 ? Math.pow(0.5, dt / halfLife) : 0;
  const cx = (p.x - memRect.x) / memRect.z * MEM, cz = (p.z - memRect.y) / memRect.w * MEM;
  const rc = radius * 0.7 / memRect.z * MEM, r2 = rc * rc;
  for (let j = 0; j < MEM; j++) {
    for (let i = 0; i < MEM; i++) {
      const k = j * MEM + i, dx = i + 0.5 - cx, dz = j + 0.5 - cz;
      let v = memF[k] * decay;
      if (halfLife > 0) { const q = (dx * dx + dz * dz) / r2; if (q < 4) v = Math.max(v, Math.exp(-q * 1.5)); }
      memF[k] = v; memB[k] = v * 255;
    }
  }
  memTex.needsUpdate = true;
}

// ---------------------------------------------------------------- the point shader
const uniforms = {
  uTime: { value: 0 }, uAud: { value: new THREE.Vector3() }, uRadius: { value: 1.6 }, uScatter: { value: 0.6 },
  uSize: { value: 0.014 }, uScale: { value: 500 }, uMode: { value: 1 }, uWaveT: { value: 99 }, uGain: { value: 1 },
  uMem: { value: memTex }, uMemRect: { value: memRect }, uFloor: { value: 0 },
};
const pointMat = new THREE.ShaderMaterial({
  uniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  vertexShader: /* glsl */`
    attribute vec3 aColor;
    attribute float aRand;
    uniform float uTime, uRadius, uScatter, uSize, uScale, uMode, uWaveT, uFloor;
    uniform vec3 uAud;
    uniform vec4 uMemRect;
    uniform sampler2D uMem;
    varying vec3 vCol;
    varying float vA;
    void main() {
      vec3 p = position;
      float d = length(p.xz - uAud.xz);
      float near = 1.0 - smoothstep(uRadius * 0.45, uRadius, d);
      float mem = texture2D(uMem, (p.xz - uMemRect.xy) / uMemRect.zw).r;
      float lit = max(near, mem * (uMode > 1.5 ? 0.9 : 0.7));
      float wave = 0.0;
      if (uMode > 0.5 && uMode < 1.5) {               // 물결: a ring of light sweeps out from the audience
        float wr = uWaveT * 2.4;
        wave = exp(-pow((d - wr) * 4.0, 2.0)) * exp(-uWaveT * 0.4);
        lit = max(lit, wave * 0.9);
      }
      float far = 1.0 - lit;
      // far points drift like dust and rise slowly; the closer the audience, the more they settle back into the room
      float t = uTime * 0.18 + aRand * 6.2832;
      vec3 drift = vec3(sin(t * 1.3 + p.y * 2.1 + p.z), 0.0, cos(t * 1.1 + p.x * 1.9 - p.y));
      drift.y = sin(t * 0.7 + p.x * 1.3) * 0.5 + (aRand - 0.25) * 0.9 + (p.y - uFloor) * 0.15;
      p += drift * uScatter * far * far * (0.3 + 0.7 * aRand);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float sz = uSize * mix(0.6, 1.0, lit) * (1.0 + wave * 1.2);
      gl_PointSize = clamp(sz * uScale / -mv.z, 1.0, 22.0);
      float grey = dot(aColor, vec3(0.299, 0.587, 0.114));
      vec3 ghost = vec3(0.45, 0.62, 1.0) * (0.35 + grey);
      vCol = mix(ghost, aColor * 1.1, lit) + vec3(0.55, 0.9, 1.0) * wave * 0.45;
      float tw = 0.65 + 0.35 * sin(uTime * (1.2 + aRand * 3.0) + aRand * 50.0);
      float farA = (uMode > 1.5 ? 0.30 : 0.10) * tw * (1.0 - smoothstep(uRadius, uRadius * 5.0, d) * 0.6);
      vA = mix(farA, 1.0, lit) * smoothstep(0.2, 0.7, -mv.z);   // no huge dots right against the lens
    }`,
  fragmentShader: /* glsl */`
    uniform float uGain;
    varying vec3 vCol;
    varying float vA;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5) discard;
      float s = smoothstep(0.5, 0.05, r);
      gl_FragColor = vec4(vCol, min(1.0, vA * s * uGain));
    }`,
});
let cloud = null;
let floorY = 0, bounds = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2.5, 2));
let meta = null;

// ---------------------------------------------------------------- audience glow
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(180,235,255,.55)'); grd.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowTex = glowTexture();
// the audience is a butterfly made of light: glowing wings that beat faster as the person walks, a soft body glow,
// and a trail of light dust falling behind it
const me = new THREE.Group(); scene.add(me);
function wingTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  // u = out along the wing (0 = body), v = front-back; light pours out from the body
  const grd = g.createRadialGradient(0, 128, 6, 0, 128, 270);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.22, 'rgba(190,245,255,.95)');
  grd.addColorStop(0.55, 'rgba(120,170,255,.75)'); grd.addColorStop(0.85, 'rgba(170,110,255,.6)'); grd.addColorStop(1, 'rgba(255,200,120,.7)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(10,20,50,.45)'; g.lineWidth = 3;   // veins
  for (let i = 0; i < 7; i++) { const a = -1.1 + i * 0.36; g.beginPath(); g.moveTo(0, 128); g.quadraticCurveTo(110 * Math.cos(a), 128 + 90 * Math.sin(a), 260 * Math.cos(a), 128 + 260 * Math.sin(a)); g.stroke(); }
  g.fillStyle = 'rgba(255,240,200,.9)';   // bright spots near the rim
  for (const [x, y, r] of [[190, 70, 9], [215, 120, 6], [170, 190, 8], [120, 222, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function wingGeometry(points) {
  const s = new THREE.Shape(); s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 3) s.bezierCurveTo(...points[i], ...points[i + 1], ...points[i + 2]);
  const geo = new THREE.ShapeGeometry(s, 16);
  const pos = geo.getAttribute('position'), uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 0.19, 0.5 + pos.getY(i) / 0.26);
  geo.rotateX(Math.PI / 2);   // shape (x out, y forward) -> wing lying flat: x out, z forward
  return geo;
}
// right wings (x > 0); the left ones are mirrored. Units: metres, about 36 cm wingspan.
const foreGeo = wingGeometry([[0, 0.015], [0.05, 0.06], [0.13, 0.13], [0.18, 0.11], [0.2, 0.06], [0.15, 0.0], [0.1, -0.01], [0.06, -0.015], [0.02, -0.01], [0, -0.005]]);
const hindGeo = wingGeometry([[0, -0.005], [0.05, -0.01], [0.12, -0.03], [0.12, -0.08], [0.11, -0.13], [0.05, -0.14], [0.03, -0.1], [0.015, -0.07], [0.005, -0.04], [0, -0.02]]);
const wingMat = new THREE.MeshBasicMaterial({ map: wingTexture(), transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
const butterfly = new THREE.Group(); butterfly.scale.setScalar(1.5); me.add(butterfly);
const wings = [];
for (const side of [1, -1]) {
  const pivot = new THREE.Group(); pivot.scale.x = side; butterfly.add(pivot);
  const fore = new THREE.Mesh(foreGeo, wingMat), hind = new THREE.Mesh(hindGeo, wingMat);
  pivot.add(fore, hind); wings.push({ pivot, hind, side });
}
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.075, 4, 8), new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
body.rotation.x = Math.PI / 2; butterfly.add(body);
const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xcfefff }));
orb.scale.setScalar(0.22); butterfly.add(orb);
// light dust: a ring buffer of glowing specks dropped behind the butterfly, sinking and fading
const DUST = 90, dustPos = new Float32Array(DUST * 3), dustCol = new Float32Array(DUST * 3), dustAge = new Float32Array(DUST).fill(99), dustVel = new Float32Array(DUST * 3);
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3)); dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTex, size: 0.045, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
dust.frustumCulled = false; scene.add(dust);
let dustNext = 0, dustAcc = 0;
const fly = { phase: 0, prev: new THREE.Vector3(), speed: 0, bank: 0 };
function animateButterfly(dt, t, p, dir) {
  const v = fly.prev.lengthSq() ? p.distanceTo(fly.prev) / Math.max(dt, 1e-3) : 0; fly.prev.copy(p);
  fly.speed += (Math.min(v, 2) - fly.speed) * Math.min(1, dt * 3);
  fly.phase += dt * Math.PI * 2 * (2.2 + fly.speed * 3.5);   // beats faster while walking
  const amp = 0.55 + 0.35 * Math.min(1, fly.speed);
  const flap = Math.sin(fly.phase) * amp + 0.25;
  for (const w of wings) { w.pivot.rotation.z = flap * w.side; w.hind.rotation.z = Math.sin(fly.phase - 0.5) * 0.12; }
  const yaw = Math.atan2(dir.x, dir.z);
  let dy = yaw - butterfly.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  fly.bank += (THREE.MathUtils.clamp(-dy * 2, -0.5, 0.5) - fly.bank) * Math.min(1, dt * 4);
  butterfly.rotation.set(-0.15 - 0.1 * Math.sin(fly.phase), butterfly.rotation.y + dy * Math.min(1, dt * 5), fly.bank, 'YXZ');
  butterfly.position.set(Math.sin(t * 0.9) * 0.03, Math.sin(fly.phase) * -0.012 + Math.sin(t * 1.3) * 0.04, 0);   // gentle hover
  orb.material.opacity = 0.55 + 0.25 * Math.sin(t * 2.5);
  // dust: more when moving
  dustAcc += dt * (8 + fly.speed * 40);
  const at = new THREE.Vector3(); butterfly.getWorldPosition(at);
  while (dustAcc > 1) {
    dustAcc -= 1; const i = dustNext; dustNext = (dustNext + 1) % DUST;
    dustAge[i] = 0;
    dustPos[i * 3] = at.x + (Math.random() - 0.5) * 0.12; dustPos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.05; dustPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.12;
    dustVel[i * 3] = (Math.random() - 0.5) * 0.06; dustVel[i * 3 + 1] = -0.05 - Math.random() * 0.08; dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
  }
  for (let i = 0; i < DUST; i++) {
    dustAge[i] += dt;
    const k = Math.max(0, 1 - dustAge[i] / 2.4);
    for (let a = 0; a < 3; a++) dustPos[i * 3 + a] += dustVel[i * 3 + a] * dt;
    dustCol[i * 3] = k * (0.7 + 0.3 * k); dustCol[i * 3 + 1] = k * 0.9; dustCol[i * 3 + 2] = k;   // white-gold to blue, then gone
  }
  dustGeo.attributes.position.needsUpdate = true; dustGeo.attributes.color.needsUpdate = true;
}
const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.18, color: 0x88ccff }));
pool.rotation.x = -Math.PI / 2; scene.add(pool);

// ---------------------------------------------------------------- loading scans
const loader = new PLYLoader();
function showCloud(buffer, m) {
  const geom = loader.parse(buffer);
  const pos = geom.getAttribute('position');
  if (!pos || pos.count === 0) throw new Error('점이 없는 PLY입니다');
  const n = pos.count;
  geom.computeBoundingBox(); bounds = geom.boundingBox.clone();
  let col = geom.getAttribute('color');
  if (!col) {
    const c = new Float32Array(n * 3), cc = new THREE.Color();
    for (let i = 0; i < n; i++) { cc.setHSL(0.58 - 0.4 * (pos.getY(i) - bounds.min.y) / Math.max(1e-6, bounds.max.y - bounds.min.y), 0.6, 0.6); cc.toArray(c, i * 3); }
    col = new THREE.BufferAttribute(c, 3);
  }
  const rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = Math.sin(i * 12.9898) * 43758.5453; rnd[i] = x - Math.floor(x); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', pos); g.setAttribute('aColor', col); g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  g.boundingSphere = new THREE.Sphere(bounds.getCenter(new THREE.Vector3()), bounds.getSize(new THREE.Vector3()).length());
  geom.dispose();
  if (cloud) { scene.remove(cloud); cloud.geometry.dispose(); }
  cloud = new THREE.Points(g, pointMat); cloud.frustumCulled = false; scene.add(cloud);

  meta = m;
  floorY = m && Array.isArray(m.a) ? m.a[1] : bounds.min.y;
  uniforms.uFloor.value = floorY;
  // dense scans pile up into a solid wall: lower the opacity with points per square metre
  const s = bounds.getSize(new THREE.Vector3()), area = Math.max(1, s.x * s.z);
  uniforms.uGain.value = THREE.MathUtils.clamp(Math.sqrt(20000 / (n / area)), 0.45, 1);
  memRect.set(bounds.min.x - 1, bounds.min.z - 1, s.x + 2, s.z + 2);
  memF.fill(0); memB.fill(0); memTex.needsUpdate = true;
  demo.centre = bounds.getCenter(new THREE.Vector3()); demo.rx = Math.max(0.4, s.x * 0.32); demo.rz = Math.max(0.4, s.z * 0.32);
  aud.pos = null; walker.pos.set(demo.centre.x, floorY + 1.4, demo.centre.z);
  controls.target.copy(demo.centre);
  camera.near = 0.03; camera.far = Math.max(50, s.length() * 6); camera.updateProjectionMatrix();
  info.points = n;
}

const sel = $('scan');
let scans = [];
async function openScan(id) {
  const e = scans.find((s) => s.id === id); if (!e) return;
  info.scan = e.id; info.loading = true;
  try {
    const [ply, m] = await Promise.all([
      fetch(e.ply).then((r) => { if (!r.ok) throw new Error(`${e.ply} ${r.status}`); return r.arrayBuffer(); }),
      e.meta ? fetch(e.meta).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
    ]);
    showCloud(ply, m); info.error = '';
    try { localStorage.setItem('ptImmersiveScan', id); } catch (err) { /* storage blocked */ }
    history.replaceState(null, '', `${location.search}#${encodeURIComponent(id)}`);
  } catch (err) { console.error(err); info.error = `불러오지 못했습니다: ${err.message}`; }
  info.loading = false;
}
async function loadIndex() {
  try {
    const r = await fetch(`web_scans/index.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) scans = (await r.json()).scans || [];
  } catch (err) { console.warn('index.json', err); }
  if (!scans.length) { info.error = '스캔이 없습니다'; return; }
  for (const s of scans) {
    const o = document.createElement('option'); o.value = s.id;
    o.textContent = `${s.id.replace(/^phone_scan_/, '')} · ${Math.round((s.points || 0) / 1000)}천 점`;
    sel.appendChild(o);
  }
  let saved = null; try { saved = localStorage.getItem('ptImmersiveScan'); } catch (err) { saved = null; }
  const want = decodeURIComponent(location.hash.slice(1)) || saved;
  // otherwise the scan with the most points: sparse scans hardly show the effect
  const pick = scans.find((s) => s.id === want) || scans.reduce((a, b) => ((b.points || 0) > (a.points || 0) ? b : a));
  sel.value = pick.id; openScan(pick.id);
}
sel.addEventListener('change', () => openScan(sel.value));

// ---------------------------------------------------------------- audience: relay > hand walking > demo walk
const live = { unrealAt: 0, unrealValid: false, unrealSrc: '', unreal: new THREE.Vector3(), unrealDir: new THREE.Vector3(1, 0, 0),
  phoneAt: 0, phoneValid: false, phone: new THREE.Vector3(), phoneDir: new THREE.Vector3(0, 0, -1),
  espAt: 0, esp: new THREE.Vector3(), espDir: new THREE.Vector3(1, 0, 0), peers: '' };
const aud = { pos: null, dir: new THREE.Vector3(0, 0, -1), from: '', lastWave: new THREE.Vector3(), waveAt: 0 };
const walker = { pos: new THREE.Vector3(0, 1.4, 0), yaw: 0, target: null, until: 0 };
const demo = { centre: new THREE.Vector3(), rx: 1, rz: 1 };
const keys = new Set();

function roomToScan(m, x, y, z) {   // same as app.js: R (m, Z up, +Y left, origin A, +X toward B) -> S (Y up)
  const up = new THREE.Vector3(0, 1, 0);
  if (m && Array.isArray(m.a) && Array.isArray(m.b)) {
    const a = new THREE.Vector3(...m.a), d = new THREE.Vector3(...m.b).sub(a); d.y = 0;
    if (d.lengthSq() > 1e-6) {
      d.normalize();
      const left = new THREE.Vector3(d.z, 0, -d.x);
      return { p: a.clone().addScaledVector(d, x).addScaledVector(left, y).addScaledVector(up, z), d, left };
    }
  }
  return { p: new THREE.Vector3(x, z, -y), d: new THREE.Vector3(1, 0, 0), left: new THREE.Vector3(0, 0, -1) };
}
function onLine(line) {
  const f = line.split(','), now = performance.now();
  if (f[0] === 'PTU1' && f.length >= 11) {
    const [x, y, z, yaw] = f.slice(4, 8).map(Number);
    if (![x, y, z].every(isFinite)) return;
    live.unrealValid = f[2] === '1'; live.unrealSrc = f[3]; live.unrealAt = now;
    if (!live.unrealValid) return;
    const r = roomToScan(meta, x, y, z), yr = (yaw || 0) * Math.PI / 180;
    live.unreal.copy(r.p);
    live.unrealDir.copy(r.d).multiplyScalar(Math.cos(yr)).addScaledVector(r.left, Math.sin(yr)).normalize();
  } else if (f[0] === 'PTP1' && f.length >= 12) {
    const n = f.slice(3, 9).map(Number);
    if (n.some((v) => !isFinite(v))) return;
    live.phone.set(n[0], n[1], n[2]); live.phoneValid = f[2] === '1'; live.phoneAt = now;
    const d = new THREE.Vector3(n[3], 0, n[5]); if (d.lengthSq() > 1e-6) live.phoneDir.copy(d.normalize());
  } else if (f[0] === 'PTE1' && f.length >= 9) {
    const [x, y, z, yaw] = f.slice(3, 7).map(Number);
    if (![x, y, z].every(isFinite)) return;
    const r = roomToScan(meta, x, y, z), yr = (yaw || 0) * Math.PI / 180;
    live.esp.copy(r.p); live.espAt = now;
    live.espDir.copy(r.d).multiplyScalar(Math.cos(yr)).addScaledVector(r.left, Math.sin(yr)).normalize();
  } else if (line.startsWith('PTR1,peers,')) live.peers = line.slice(11);
}

let ws = null, wsState = '연결 안 됨';
function connect() {
  const cfg = window.PHONETWIN_RELAY || {}, q = new URLSearchParams(location.search);
  let saved = null; try { saved = JSON.parse(localStorage.getItem('ptRelay') || 'null'); } catch (err) { saved = null; }
  let base = (q.get('relay') || (saved && saved.url) || cfg.url || '').trim();
  const room = q.get('room') || (saved && saved.room) || cfg.room || 'arko';
  if (!base) { wsState = '릴레이 주소 없음'; return; }
  base = base.replace(/\/+$/, '').replace(/\/ws$/, '').replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
  if (!/^wss?:\/\//.test(base)) base = 'wss://' + base;
  try { ws = new WebSocket(`${base}/ws?room=${encodeURIComponent(room)}&role=viewer`); } catch (err) { wsState = '주소 오류'; return; }
  wsState = '접속 중…';
  const mine = ws;
  ws.onopen = () => { if (mine === ws) wsState = '연결됨'; };
  ws.onmessage = (e) => { if (mine === ws) String(e.data).split('\n').forEach((l) => l && onLine(l)); };
  ws.onclose = () => { if (mine !== ws) return; ws = null; wsState = '끊김 · 재접속 중'; setTimeout(connect, 2000); };
}

function liveSource(now) {
  if (live.unrealAt && live.unrealValid && now - live.unrealAt < 1500) return { p: live.unreal, d: live.unrealDir, from: `실제 관객 · 언리얼 (${live.unrealSrc === 'esp32' ? 'UWB 태그' : '휴대폰'})` };
  if (live.phoneAt && live.phoneValid && now - live.phoneAt < 1500) return { p: live.phone, d: live.phoneDir, from: '실제 관객 · 휴대폰' };
  if (live.espAt && now - live.espAt < 1500) return { p: live.esp, d: live.espDir, from: '실제 관객 · UWB 태그' };
  return null;
}

// "the system is connected": the relay is open and a phone, UWB tag or Unreal is in the room (or spoke lately).
// Then only the real person moves the audience — keyboard, click and touch walking are off, and while the
// walking test has not started (or the signal drops for a moment) the audience waits where it was last seen.
function peerCount(name) { const m = live.peers.match(new RegExp(`${name}=(\\d+)`)); return m ? +m[1] : 0; }
function systemOn(now) {
  if (!ws || ws.readyState !== 1) return false;
  if (peerCount('unreal') + peerCount('phone') + peerCount('esp32') > 0) return true;
  return [live.unrealAt, live.phoneAt, live.espAt].some((t) => t && now - t < 5000);
}
const lastReal = { p: null, d: new THREE.Vector3(0, 0, -1) };
function heldSource(now) {
  const why = live.unrealAt && !live.unrealValid && now - live.unrealAt < 3000 ? '걷기 테스트 시작 전' : '실제 관객 신호 기다리는 중';
  if (lastReal.p) return { p: lastReal.p, d: lastReal.d, from: `${why} — 마지막 자리에서 대기`, held: true };
  return { p: new THREE.Vector3(demo.centre.x, floorY + 1.4, demo.centre.z), d: lastReal.d, from: `${why} — 방 가운데에서 대기`, held: true };
}

function stepWalker(dt, now) {
  // keys move relative to where the camera looks
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x), mv = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup') || touch.walking) mv.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) mv.sub(fwd);
  if (keys.has('d') || keys.has('arrowright')) mv.add(right);
  if (keys.has('a') || keys.has('arrowleft')) mv.sub(right);
  const up = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0);   // Q = up, E = down
  if (up) {
    walker.pos.y = THREE.MathUtils.clamp(walker.pos.y + up * 0.8 * dt, floorY + 0.15, floorY + Math.max(2.4, bounds.max.y - floorY + 0.5));
    if (opts.camMode === 'orbit') { camera.position.y += up * 0.8 * dt; controls.target.y += up * 0.8 * dt; }
    walker.until = now + 15000;
  }
  if (mv.lengthSq() > 0) { walker.target = null; walker.until = now + 15000; }
  else if (walker.target) {
    mv.subVectors(walker.target, walker.pos); mv.y = 0;
    if (mv.length() < 0.05) walker.target = null;
  }
  if (mv.lengthSq() > 0) {
    mv.normalize();
    walker.pos.addScaledVector(mv, 1.0 * dt);
    walker.yaw = Math.atan2(mv.x, mv.z);
  }
  if (now < walker.until) return { p: walker.pos, d: new THREE.Vector3(Math.sin(walker.yaw), 0, Math.cos(walker.yaw)), from: isTouch ? '직접 걷기 (터치)' : '직접 걷기 (키보드·클릭)' };
  // demo: a slow wandering loop through the middle of the room
  const t = now / 1000 * 0.11;
  const p = new THREE.Vector3(demo.centre.x + demo.rx * Math.sin(t * 1.0) * Math.cos(t * 0.37),
    floorY + 1.4 + Math.sin(t * 9) * 0.02, demo.centre.z + demo.rz * Math.sin(t * 1.6 + 0.6));
  const p2 = new THREE.Vector3(demo.centre.x + demo.rx * Math.sin((t + 0.01) * 1.0) * Math.cos((t + 0.01) * 0.37),
    0, demo.centre.z + demo.rz * Math.sin((t + 0.01) * 1.6 + 0.6));
  const d = p2.sub(p).setY(0); d.lengthSq() > 1e-9 ? d.normalize() : d.set(0, 0, -1);
  walker.pos.copy(p); walker.yaw = Math.atan2(d.x, d.z);
  return { p, d, from: '시연 (신호 없음)' };
}

// ---------------------------------------------------------------- looking: hand (phone gyro), touch drag, pinch
// look.yawOff / pitchOff turn the view away from the audience's walking direction; with the hand on, the phone's
// own orientation decides where the camera looks (turning relative to the moment it was switched on, tilt absolute).
const look = { yawOff: 0, pitchOff: 0, zoom: 1 };
const gyro = { on: false, has: false, yaw: 0, pitch: 0, yaw0: 0, base: 0, needCal: true };
const touch = { pts: new Map(), pinch: 0, walking: false, holdTimer: 0, lastTap: 0, moved: false };
const devEuler = new THREE.Euler(), devQ = new THREE.Quaternion(), zee = new THREE.Vector3(0, 0, 1);
const qFix = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), qScreen = new THREE.Quaternion(), devFwd = new THREE.Vector3();
const D2R = Math.PI / 180;

function onOrientation(e) {
  if (e.alpha == null && e.beta == null) return;
  const orient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  devEuler.set((e.beta || 0) * D2R, (e.alpha || 0) * D2R, -(e.gamma || 0) * D2R, 'YXZ');
  devQ.setFromEuler(devEuler).multiply(qFix).multiply(qScreen.setFromAxisAngle(zee, -orient * D2R));
  devFwd.set(0, 0, -1).applyQuaternion(devQ);
  gyro.yaw = Math.atan2(devFwd.x, devFwd.z);
  gyro.pitch = Math.asin(THREE.MathUtils.clamp(devFwd.y, -1, 1));
  gyro.has = true;
}
let toastTimer = 0;
function toast(text, ms = 2600) {
  const t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
async function setHand(on) {
  if (on && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {   // iPhone: must be asked from the button press itself
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') { toast('동작·방향 접근이 허용되지 않았습니다 (설정 > Safari > 동작 및 방향)'); return; }
    } catch (err) { toast('동작 센서를 켤 수 없습니다'); return; }
  }
  if (on && !window.isSecureContext) toast('센서는 https 주소에서만 동작합니다');
  gyro.on = on; gyro.needCal = true;
  $('handBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) {
    addEventListener('deviceorientation', onOrientation);
    look.yawOff = 0; look.pitchOff = 0;
    toast('✋ 휴대폰을 돌리고 기울이는 대로 봅니다 · 두 번 탭 = 정면');
    setTimeout(() => { if (gyro.on && !gyro.has) toast('이 기기에서는 방향 센서 값이 오지 않습니다'); }, 1500);
  } else {
    removeEventListener('deviceorientation', onOrientation);
    toast('손 움직임 끔 · 손가락으로 끌어서 둘러보기');
  }
  controls.enableRotate = !on;
}
$('handBtn').addEventListener('click', () => setHand(!gyro.on));

/** Where the camera looks: yaw (0 = +Z, same as walker.yaw) and pitch (+ up), around the audience's direction. */
function lookAngles(baseYaw, defaultPitch) {
  if (gyro.on && gyro.has) {
    if (gyro.needCal) { gyro.yaw0 = gyro.yaw; gyro.base = baseYaw; gyro.needCal = false; }
    return { yaw: gyro.base + (gyro.yaw - gyro.yaw0) + look.yawOff, pitch: gyro.pitch };
  }
  return { yaw: baseYaw + look.yawOff, pitch: THREE.MathUtils.clamp(defaultPitch + look.pitchOff, -1.35, 1.2) };
}
function dirFrom(a) { return new THREE.Vector3(Math.sin(a.yaw) * Math.cos(a.pitch), Math.sin(a.pitch), Math.cos(a.yaw) * Math.cos(a.pitch)); }
function recentre() {
  look.yawOff = 0; look.pitchOff = 0; look.zoom = 1; gyro.needCal = true;
  toast(gyro.on ? '정면을 다시 맞췄습니다' : '시선을 처음으로 되돌렸습니다', 1400);
}

// touch on the canvas (first-person and follow; the free camera keeps OrbitControls' own touch handling)
const cv = renderer.domElement;
function pinchDist() { const p = [...touch.pts.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
cv.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touch.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
  touch.moved = false;
  clearTimeout(touch.holdTimer);
  if (touch.pts.size === 1) {
    touch.holdTimer = setTimeout(() => {   // press and hold = walk where you look (only without a live system)
      if (touch.pts.size !== 1 || touch.moved) return;
      if (systemOn(performance.now())) { toast('시스템 연결 중: 실제 사람의 움직임을 따릅니다'); return; }
      touch.walking = true;
    }, 380);
  } else touch.pinch = pinchDist();
});
cv.addEventListener('pointermove', (e) => {
  const t = touch.pts.get(e.pointerId); if (!t) return;
  const dx = e.clientX - t.x, dy = e.clientY - t.y; t.x = e.clientX; t.y = e.clientY;
  if (Math.hypot(t.x - t.x0, t.y - t.y0) > 10) touch.moved = true;
  if (opts.camMode === 'orbit') return;
  if (touch.pts.size === 1 && touch.moved && !touch.walking) {
    look.yawOff -= dx * 0.006;
    if (!gyro.on) look.pitchOff = THREE.MathUtils.clamp(look.pitchOff + dy * 0.004, -1.2, 1.2);
  } else if (touch.pts.size === 2) {
    const d = pinchDist();
    if (touch.pinch > 0 && d > 0) look.zoom = THREE.MathUtils.clamp(look.zoom * touch.pinch / d, 0.35, 3);
    touch.pinch = d;
  }
});
function touchEnd(e) {
  if (!touch.pts.has(e.pointerId)) return;
  touch.pts.delete(e.pointerId);
  clearTimeout(touch.holdTimer);
  if (touch.walking) { touch.walking = false; touch.moved = true; }
  touch.pinch = pinchDist();
  if (e.type === 'pointerup' && touch.pts.size === 0 && !touch.moved) {
    const now = performance.now();
    if (now - touch.lastTap < 320) { recentre(); touch.lastTap = 0; touch.moved = true; }
    else touch.lastTap = now;
  }
}
cv.addEventListener('pointerup', touchEnd);
cv.addEventListener('pointercancel', touchEnd);
cv.addEventListener('wheel', (e) => {
  if (opts.camMode === 'orbit') return;
  look.zoom = THREE.MathUtils.clamp(look.zoom * Math.exp(e.deltaY * 0.001), 0.35, 3); e.preventDefault();
}, { passive: false });

// click / tap on the floor = walk there (not while the real person is driving)
const ray = new THREE.Raycaster(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let down = null;
cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
cv.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  if (e.pointerType === 'touch' && touch.moved) return;
  if (systemOn(performance.now())) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
  floorPlane.constant = -floorY;
  const hit = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
  if (hit) { walker.target = hit.setY(walker.pos.y); walker.until = performance.now() + 15000; }
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); return; }
  if (k === 'h') { document.body.classList.toggle('hide-ui'); return; }
  if (/^(w|a|s|d|q|e|arrow.*)$/.test(k) && systemOn(performance.now())) toast('시스템 연결 중: 키보드 대신 실제 사람의 움직임을 따릅니다', 1800);
  keys.add(k);
  if (k.startsWith('arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ---------------------------------------------------------------- UI
const opts = { camMode: 'follow', memory: 8, bloom: true, showMe: true };
function seg(id, fn) {
  const el = $(id);
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v);
  }));
}
seg('look', (v) => { uniforms.uMode.value = +v; });
seg('cam', (v) => {
  opts.camMode = v; controls.enabled = v === 'orbit';
  if (v === 'orbit') {   // start from a view of the whole room
    const c = bounds.getCenter(new THREE.Vector3()), r = Math.max(2, bounds.getSize(new THREE.Vector3()).length());
    controls.target.copy(c); camera.position.set(c.x + r * 0.6, c.y + r * 0.55, c.z + r * 0.7);
  }
});
function slider(id, fn, fmt = (v) => v) {
  const el = $(id), out = el.nextElementSibling;
  const set = () => { fn(+el.value); out.textContent = fmt(+el.value); };
  el.addEventListener('input', set); set();
}
slider('radius', (v) => { uniforms.uRadius.value = v; }, (v) => `${v.toFixed(1)} m`);
slider('scatter', (v) => { uniforms.uScatter.value = v; }, (v) => v.toFixed(2));
slider('memory', (v) => { opts.memory = v; }, (v) => (v ? `${v}초` : '없음'));
slider('size', (v) => { uniforms.uSize.value = v * 0.01; }, (v) => `${v.toFixed(1)} cm`);
$('bloom').addEventListener('change', (e) => { opts.bloom = e.target.checked; });
$('showMe').addEventListener('change', (e) => { opts.showMe = e.target.checked; });
$('panelBtn').addEventListener('click', () => $('panel').classList.toggle('hidden'));
if (innerWidth < 560) $('panel').classList.add('hidden');
{ // ?look=0|1|2 &cam=follow|first|orbit &ui=0 : open straight into a look (exhibition screens)
  const q = new URLSearchParams(location.search);
  if (q.has('look')) $('look').querySelector(`[data-v="${q.get('look')}"]`)?.click();
  if (q.has('cam')) $('cam').querySelector(`[data-v="${q.get('cam')}"]`)?.click();
  if (q.get('ui') === '0') document.body.classList.add('hide-ui');
}

// ---------------------------------------------------------------- frame loop
const info = { scan: '', points: 0, error: '', loading: true, from: '' };
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), smDir = new THREE.Vector3(0, 0, -1);
let camInit = false, fpsAcc = 0, fpsN = 0, fps = 0;

function frame() {
  const dt = Math.min(0.1, clock.getDelta()), now = performance.now();
  uniforms.uTime.value += dt;
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  // real person first; with the system connected but no live pose, wait in place instead of the demo / keyboard
  const real = liveSource(now);
  if (real) { lastReal.p = real.p.clone(); lastReal.d.copy(real.d); }
  const src = real || (systemOn(now) ? heldSource(now) : stepWalker(dt, now));
  info.from = src.from; info.real = !!real; info.held = !!src.held;
  if (!aud.pos || aud.pos.distanceTo(src.p) > 2) aud.pos = src.p.clone();
  else aud.pos.lerp(src.p, 1 - Math.pow(real ? 0.0004 : 0.002, dt));   // smooth 15-30 Hz into 60 fps; real moves follow tightly
  if (src.d && src.d.lengthSq() > 1e-6) smDir.lerp(src.d, 1 - Math.pow(0.05, dt)).setY(0).normalize();
  const p = aud.pos;
  uniforms.uAud.value.copy(p);
  updateMemory(dt, p, uniforms.uRadius.value, opts.memory);

  // 물결: a new ring every 0.7 m walked, or every 3 s standing still
  uniforms.uWaveT.value = (now - aud.waveAt) / 1000;
  if (p.distanceTo(aud.lastWave) > 0.7 || uniforms.uWaveT.value > 3) { aud.lastWave.copy(p); aud.waveAt = now; }

  me.position.copy(p); pool.position.set(p.x, floorY + 0.01, p.z);
  pool.scale.setScalar(uniforms.uRadius.value * 1.4);
  me.visible = opts.showMe && opts.camMode !== 'first'; pool.visible = opts.showMe; dust.visible = opts.showMe;
  if (opts.showMe) animateButterfly(dt, uniforms.uTime.value, p, smDir);

  const baseYaw = Math.atan2(smDir.x, smDir.z);
  if (opts.camMode === 'first') {
    const eye = p.clone(); if (info.real) eye.y = Math.max(p.y, floorY + 1.2);   // a tag or phone held low still sees from eye height; Q/E walking keeps its height
    const a = lookAngles(baseYaw, -0.124);   // a little below the horizon, like the old 2 m ahead / 25 cm down
    camPos.copy(eye); camLook.copy(eye).addScaledVector(dirFrom(a), 2);
    camera.position.lerp(camPos, camInit ? 1 - Math.pow(0.001, dt) : 1);
    camera.lookAt(camLook);
  } else if (opts.camMode === 'follow') {
    const r = uniforms.uRadius.value, a = lookAngles(baseYaw, -0.41);
    if (gyro.on && gyro.has) a.pitch -= 0.3;   // phone held upright = the usual look down over the shoulder
    a.pitch = THREE.MathUtils.clamp(a.pitch, -1.35, -0.03);   // stay above the floor, looking down at the audience
    const h = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    camLook.copy(p).addScaledVector(h, 0.8).setY(floorY + 0.9);
    camPos.copy(camLook).addScaledVector(dirFrom(a), -(2.6 + r * 1.1) * look.zoom);
    camera.position.lerp(camPos, camInit ? 1 - Math.pow(gyro.on || touch.pts.size ? 1e-4 : 0.05, dt) : 1);
    camera.lookAt(camLook);
  } else {
    if (gyro.on && gyro.has) {   // free camera: the phone turns the view around the target
      const a = lookAngles(0, 0), dist = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).addScaledVector(dirFrom(a), -dist);
      camera.lookAt(controls.target);
    } else controls.update();
  }
  camInit = true;

  if (opts.bloom) composer.render(); else renderer.render(scene, camera);
}

setInterval(() => {
  const age = (t) => (t ? `${((performance.now() - t) / 1000).toFixed(1)}초 전` : '없음');
  $('status').textContent = info.error || `${info.loading ? '불러오는 중… ' : ''}${info.scan} · ${info.points.toLocaleString('ko-KR')}점 · ${fps} fps
관객: ${info.from}${gyro.on ? ' · ✋ 손으로 보기' : ''}
릴레이: ${wsState}${live.peers ? ' · ' + live.peers : ''} · 언리얼 ${age(live.unrealAt)}${live.unrealAt && !live.unrealValid ? '(걷기 테스트 전)' : ''} · 휴대폰 ${age(live.phoneAt)} · UWB ${age(live.espAt)}`;
}, 300);

new ResizeObserver(resize).observe(stage);
resize();
renderer.setAnimationLoop(frame);
window.__immersive = { camera, gyro, look, info, touch, get systemOn() { return systemOn(performance.now()); }, onLine, setHand, uniforms, butterfly, wings, walker, me };   // for automated checks
loadIndex();
if ((window.PHONETWIN_RELAY || {}).auto !== false) connect();
