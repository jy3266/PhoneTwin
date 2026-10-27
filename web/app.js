// Phone Twin scan viewer. Scans are in the S frame (metres, Y up, right-handed), which is three.js's own frame.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage'), labelsEl = $('labels'), listEl = $('list');

// ---------------------------------------------------------------- three.js scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1016);
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const grid = new THREE.GridHelper(20, 20, 0x2a3a4a, 0x16212c);
scene.add(grid);

const pointMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true });
let cloud = null;                 // THREE.Points
const marks = new THREE.Group();  // A/B, objects, AI rings
scene.add(marks);
let labels = [];                  // {pos: Vector3, el}
let currentMeta = null;          // meta of the shown scan (a/b used to place the ESP32)
let bounds = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2.5, 2));

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

const tmp = new THREE.Vector3();
function updateLabels() {
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const l of labels) {
    tmp.copy(l.pos).project(camera);
    const show = marks.visible && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    l.el.style.display = show ? '' : 'none';
    if (show) {
      l.el.style.left = `${(tmp.x * 0.5 + 0.5) * w}px`;
      l.el.style.top = `${(0.5 - tmp.y * 0.5) * h}px`;
    }
  }
}
renderer.setAnimationLoop(() => { updateAudience(); controls.update(); renderer.render(scene, camera); updateLabels(); });

// ---------------------------------------------------------------- camera presets
function setView(kind) {
  const c = bounds.getCenter(new THREE.Vector3()), s = bounds.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z, 1) * Math.max(1, 1.1 / camera.aspect);   // portrait screens: step back so the room fits the width
  controls.target.copy(c);
  if (kind === 'top') camera.position.set(c.x, c.y + r * 1.6, c.z + 0.001);
  else camera.position.set(c.x + r * 0.9, c.y + r * 0.8, c.z + r * 1.1);
  camera.near = r / 500; camera.far = r * 50; camera.updateProjectionMatrix();
  controls.update();
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view === 'top' ? 'top' : 'iso')));

const sizeIn = $('size');
sizeIn.addEventListener('input', () => { pointMat.size = +sizeIn.value; $('sizeOut').textContent = sizeIn.value; });
$('showMarks').addEventListener('change', (e) => { marks.visible = e.target.checked; });

// ---------------------------------------------------------------- markers from meta
function clearMarks() {
  marks.children.slice().forEach((o) => { marks.remove(o); o.geometry?.dispose(); o.material?.dispose(); });
  labels.forEach((l) => l.el.remove()); labels = [];
}
function label(text, pos, cls) {
  const el = document.createElement('div'); el.textContent = text; if (cls) el.className = cls;
  labelsEl.appendChild(el); labels.push({ pos: pos.clone(), el });
}
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function addMarks(meta) {
  clearMarks();
  if (!meta) return;
  const disc = (p, color, name) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(p); marks.add(m);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 40), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(p).y += 0.005; marks.add(ring);
    label(name, p.clone().add(new THREE.Vector3(0, 0.12, 0)), 'mark');
  };
  if (Array.isArray(meta.a)) disc(v3(meta.a), 0x34d466, 'A');
  if (Array.isArray(meta.b)) disc(v3(meta.b), 0x4d7cff, 'B');
  if (Array.isArray(meta.a) && Array.isArray(meta.b)) {
    const g = new THREE.BufferGeometry().setFromPoints([v3(meta.a).setY(meta.a[1] + 0.01), v3(meta.b).setY(meta.b[1] + 0.01)]);
    marks.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff })));
  }
  for (const o of meta.objects || []) {
    const p = v3(o.c), r = o.r || 0.25;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true, transparent: true, opacity: 0.6 }));
    m.position.copy(p); marks.add(m);
    label(o.name || `사물 ${o.id}`, p.clone().add(new THREE.Vector3(0, r, 0)), 'obj');
  }
  for (const it of meta.ai || []) {
    const p = v3(it.c), r = it.r || 0.4;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 48), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
    ring.rotation.x = Math.PI / 2; ring.position.copy(p); marks.add(ring);
    label(it.name || it.label, p.clone().add(new THREE.Vector3(0, r * 0.5 + 0.05, 0)));
  }
}

// ---------------------------------------------------------------- loading
const loader = new PLYLoader();
function showCloud(buffer, meta, name) {
  const geom = loader.parse(buffer);
  if (!geom.getAttribute('position') || geom.getAttribute('position').count === 0) throw new Error('점이 없는 PLY입니다');
  if (!geom.getAttribute('color')) {
    // no colours: shade by height
    const p = geom.getAttribute('position'); geom.computeBoundingBox();
    const { min, max } = geom.boundingBox, c = new Float32Array(p.count * 3), col = new THREE.Color();
    for (let i = 0; i < p.count; i++) { col.setHSL(0.6 - 0.6 * (p.getY(i) - min.y) / Math.max(1e-6, max.y - min.y), 0.7, 0.55); col.toArray(c, i * 3); }
    geom.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (cloud) { scene.remove(cloud); cloud.geometry.dispose(); }
  cloud = new THREE.Points(geom, pointMat); scene.add(cloud);
  geom.computeBoundingBox(); bounds = geom.boundingBox.clone();
  grid.position.set(bounds.getCenter(tmp).x, meta?.a ? meta.a[1] : bounds.min.y, bounds.getCenter(tmp).z);
  addMarks(meta); currentMeta = meta || null;
  trailN = 0; trail.geometry.setDrawRange(0, 0); audience.pos = null;
  setView('iso');
  $('title').textContent = name;
  const s = bounds.getSize(new THREE.Vector3());
  const n = geom.getAttribute('position').count;
  $('info').textContent = `${n.toLocaleString('ko-KR')}점 · 크기 ${s.x.toFixed(2)} × ${s.z.toFixed(2)} × ${s.y.toFixed(2)}(높이) m`
    + (meta ? `\nA·B ${meta.a && meta.b ? '있음' : '없음'} · 사물 ${(meta.objects || []).length} · AI 사물 ${(meta.ai || []).length}` : '');
  $('empty').hidden = true;
}

async function busy(fn) {
  $('busy').hidden = false;
  try { await fn(); } catch (e) { console.error(e); showEmpty(`불러오지 못했습니다: ${e.message}`); } finally { $('busy').hidden = true; }
}
function showEmpty(text) { const e = $('empty'); e.textContent = text; e.hidden = false; }

async function openScan(entry, li) {
  listEl.querySelectorAll('li').forEach((x) => x.classList.remove('on')); li?.classList.add('on');
  $('side').classList.remove('open');
  await busy(async () => {
    const [ply, meta] = await Promise.all([
      fetch(entry.ply).then((r) => { if (!r.ok) throw new Error(`${entry.ply} ${r.status}`); return r.arrayBuffer(); }),
      entry.meta ? fetch(entry.meta).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
    ]);
    showCloud(ply, meta, entry.id);
    const dl = $('download'); dl.href = entry.ply; dl.download = `${entry.id}.ply`; dl.hidden = false;
    history.replaceState(null, '', `#${encodeURIComponent(entry.id)}`);
  });
}

function fmtDate(s) {
  const d = new Date(s);
  return isNaN(d) ? (s || '') : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadIndex() {
  let scans = [];
  try {
    const r = await fetch(`scans/index.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) scans = (await r.json()).scans || [];
  } catch (e) { console.warn('index.json', e); }
  listEl.innerHTML = '';
  if (!scans.length) {
    listEl.innerHTML = '<li class="muted">스캔 없음</li>';
    showEmpty('아직 업로드된 스캔이 없습니다 — 앱 설정 8번에서 업로드');
    return;
  }
  const want = decodeURIComponent(location.hash.slice(1));
  let first = null;
  for (const s of scans) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="name"></div><div class="meta"></div>';
    li.querySelector('.name').textContent = s.id;
    li.querySelector('.meta').textContent = `${fmtDate(s.created)} · ${(s.points || 0).toLocaleString('ko-KR')}점${s.device ? ' · ' + s.device : ''}`;
    li.addEventListener('click', () => openScan(s, li));
    listEl.appendChild(li);
    if (!first || s.id === want) first = [s, li];
  }
  openScan(...first);
}

// ---------------------------------------------------------------- local files
function openLocal(file) {
  if (!file || !/\.ply$/i.test(file.name)) { showEmpty('.ply 파일만 열 수 있습니다'); return; }
  listEl.querySelectorAll('li').forEach((x) => x.classList.remove('on'));
  $('download').hidden = true;
  busy(async () => showCloud(await file.arrayBuffer(), null, `${file.name} (로컬)`));
}
$('file').addEventListener('change', (e) => openLocal(e.target.files[0]));
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; openLocal(e.dataTransfer.files[0]); });

$('menu').addEventListener('click', () => $('side').classList.toggle('open'));

resize();
setView('iso');
loadIndex();

// ---------------------------------------------------------------- live positions through the DigitalOcean relay (PROTOCOL.md §3)
const live = new THREE.Group(); scene.add(live);
function tracker(color) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color })));
  g.add(new THREE.Mesh(new THREE.RingGeometry(0.13, 0.16, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
  g.children[1].rotation.x = -Math.PI / 2;
  g.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 0.5, color, 0.14, 0.08);
  g.add(g.arrow); g.visible = false; live.add(g);
  // always visible, even inside the point cloud
  g.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } o.renderOrder = 10; });
  return g;
}
const phoneMark = tracker(0x22d3ee), espMark = tracker(0xe879f9);
const state = { phoneAt: 0, espAt: 0, hapAt: 0, audAt: 0, audValid: false, audSource: '', peers: '', espNote: '' };

// ---------------------------------------------------------------- audience: PTU1 from Unreal, else the phone / ESP32 marker
const AUD = 0xfb923c;
const audience = { group: tracker(AUD), target: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0), pos: null, from: '' };
audience.group.children[0].scale.setScalar(1.5);
const onTop = (m) => { m.depthTest = false; m.transparent = true; return m; };
const audPole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), onTop(new THREE.LineBasicMaterial({ color: AUD })));
const TRAIL = 400, trailPos = new Float32Array(TRAIL * 3);
const trail = new THREE.Line(new THREE.BufferGeometry(), onTop(new THREE.LineBasicMaterial({ color: AUD, opacity: 0.55 })));
trail.geometry.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trail.geometry.setDrawRange(0, 0);
const distLines = new THREE.LineSegments(new THREE.BufferGeometry(), onTop(new THREE.LineBasicMaterial({ vertexColors: true, opacity: 0.9 })));
[audPole, trail, distLines].forEach((o) => { o.renderOrder = 9; o.frustumCulled = false; live.add(o); });
let trailN = 0, distLabels = [], lastList = 0;

function floorY() { return currentMeta && Array.isArray(currentMeta.a) ? currentMeta.a[1] : bounds.min.y; }
function sceneObjects() {
  const m = currentMeta || {};
  return [...(m.objects || []).map((o) => ({ name: o.name || `사물 ${o.id}`, c: v3(o.c), r: o.r || 0.25 })),
    ...(m.ai || []).map((it) => ({ name: it.name || it.label, c: v3(it.c), r: it.r || 0.4 }))];
}

function updateAudience() {
  const now = performance.now();
  let src = null;
  if (state.audValid && now - state.audAt < 1500) src = { p: audience.target, d: audience.dir, from: state.audSource === 'esp32' ? 'ESP32' : '휴대폰', unreal: true };
  else if (phoneMark.visible && phoneMark.valid) src = { p: phoneMark.position, d: phoneMark.dir, from: '휴대폰' };
  else if (espMark.visible) src = { p: espMark.position, from: 'ESP32' };
  const g = audience.group;
  g.visible = audPole.visible = distLines.visible = trail.visible = !!src;
  $('distPanel').hidden = !src;
  if (!src) { distLabels.forEach((l) => { l.style.display = 'none'; }); return; }

  // smooth 15 Hz updates into 60 fps motion
  if (!audience.pos || audience.pos.distanceTo(src.p) > 2) audience.pos = src.p.clone(); else audience.pos.lerp(src.p, 0.25);
  const p = audience.pos, fy = floorY();
  g.position.copy(p);
  if (src.d) g.arrow.setDirection(src.d);
  const pole = audPole.geometry.attributes.position;
  pole.setXYZ(0, p.x, fy, p.z); pole.setXYZ(1, p.x, p.y, p.z); pole.needsUpdate = true;
  audPole.geometry.computeBoundingSphere();

  // trail on the floor
  const k = (trailN - 1) * 3;
  if (trailN === 0 || Math.hypot(trailPos[k] - p.x, trailPos[k + 2] - p.z) > 0.02) {
    if (trailN === TRAIL) { trailPos.copyWithin(0, 3); trailN--; }
    trailPos.set([p.x, fy + 0.01, p.z], trailN * 3); trailN++;
    trail.geometry.attributes.position.needsUpdate = true; trail.geometry.setDrawRange(0, trailN);
  }

  // a floor line and a distance (to the object's surface, on the floor) for every object
  const objs = sceneObjects();
  const pos = new Float32Array(objs.length * 6), col = new Float32Array(objs.length * 6), c = new THREE.Color();
  const w = stage.clientWidth, h = stage.clientHeight, rows = [];
  while (distLabels.length < objs.length) { const el = document.createElement('div'); el.className = 'dist-label'; labelsEl.appendChild(el); distLabels.push(el); }
  objs.forEach((o, i) => {
    const d = Math.max(0, Math.hypot(o.c.x - p.x, o.c.z - p.z) - o.r);
    const prox = Math.max(0, 1 - d / 2);   // 1 at the object, 0 from 2 m
    pos.set([p.x, fy + 0.02, p.z, o.c.x, fy + 0.02, o.c.z], i * 6);
    c.setRGB(1, 0.85 - 0.6 * prox, 0.25 - 0.15 * prox).toArray(col, i * 6); c.toArray(col, i * 6 + 3);
    tmp.set((p.x + o.c.x) / 2, fy + 0.05, (p.z + o.c.z) / 2).project(camera);
    const el = distLabels[i], show = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    el.style.display = show ? '' : 'none';
    if (show) { el.style.left = `${(tmp.x * 0.5 + 0.5) * w}px`; el.style.top = `${(0.5 - tmp.y * 0.5) * h}px`; el.textContent = `${Math.round(d * 100)} cm`; }
    rows.push({ name: o.name, d, prox });
  });
  distLabels.slice(objs.length).forEach((l) => { l.style.display = 'none'; });
  distLines.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  distLines.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));

  if ($('followAud').checked) {   // keep the camera's offset, move its target with the audience
    const delta = tmp.copy(p).sub(controls.target).multiplyScalar(0.08);
    controls.target.add(delta); camera.position.add(delta);
  }
  if (now - lastList > 200) {
    lastList = now;
    rows.sort((a, b) => a.d - b.d);
    $('distTitle').textContent = `관객 (${src.from}${src.unreal ? ' · 언리얼' : ''})  ·  높이 ${(p.y - fy).toFixed(2)} m`;
    $('distList').innerHTML = rows.length ? '' : '<li class="muted">스캔에 사물이 없습니다</li>';
    for (const r of rows) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="n"></span><span class="b"><i></i></span><span class="v"></span>';
      li.querySelector('.n').textContent = r.name;
      li.querySelector('i').style.width = `${Math.round(r.prox * 100)}%`;
      li.querySelector('.v').textContent = `${(r.d * 100).toFixed(0)} cm`;
      $('distList').appendChild(li);
    }
  }
}

/** ESP32 room frame R (m, Z up, +Y left of +X, origin A, +X toward B) -> scan frame S (Y up). */
export function roomToScan(meta, x, y, z) {
  const up = new THREE.Vector3(0, 1, 0);
  if (meta && Array.isArray(meta.a) && Array.isArray(meta.b)) {
    const a = v3(meta.a), d = v3(meta.b).sub(a); d.y = 0;
    if (d.lengthSq() > 1e-6) {
      d.normalize();
      const left = new THREE.Vector3(d.z, 0, -d.x);   // +90° about +Y
      return { p: a.clone().addScaledVector(d, x).addScaledVector(left, y).addScaledVector(up, z), d, left, up, aligned: true };
    }
  }
  return { p: new THREE.Vector3(x, z, -y), d: new THREE.Vector3(1, 0, 0), left: new THREE.Vector3(0, 0, -1), up, aligned: false };
}

function onLine(line) {
  const f = line.split(',');
  const now = performance.now();
  if (f[0] === 'PTP1' && f.length >= 12) {
    const n = f.slice(3, 9).map(Number);
    if (n.some((v) => !isFinite(v))) return;
    phoneMark.position.set(n[0], n[1], n[2]);
    const dir = new THREE.Vector3(n[3], n[4], n[5]);
    if (dir.lengthSq() > 1e-6) { phoneMark.arrow.setDirection(dir.normalize()); phoneMark.dir = dir; }
    phoneMark.visible = true; phoneMark.valid = f[2] === '1'; state.phoneAt = now;
  } else if (f[0] === 'PTE1' && f.length >= 9) {
    const [x, y, z, yaw, pitch] = f.slice(3, 8).map(Number);
    if (![x, y, z].every(isFinite)) return;
    const r = roomToScan(currentMeta, x, y, z);
    espMark.position.copy(r.p);
    const yr = (yaw || 0) * Math.PI / 180, pr = (pitch || 0) * Math.PI / 180;
    const fw = r.d.clone().multiplyScalar(Math.cos(yr)).addScaledVector(r.left, Math.sin(yr)).multiplyScalar(Math.cos(pr)).addScaledVector(r.up, Math.sin(pr));
    espMark.arrow.setDirection(fw.normalize());
    espMark.visible = true; state.espAt = now;
    state.espNote = r.aligned ? '' : ' (스캔에 A·B가 없어 ESP32 좌표를 그대로 표시)';
  } else if (f[0] === 'PTU1' && f.length >= 11) {
    // audience as Unreal sees it (whichever device drives it): R frame, metres
    const [x, y, z, yaw] = f.slice(4, 8).map(Number);
    if (![x, y, z].every(isFinite)) return;
    state.audValid = f[2] === '1'; state.audSource = f[3]; state.audAt = now;
    if (!state.audValid) return;
    const r = roomToScan(currentMeta, x, y, z), yr = (yaw || 0) * Math.PI / 180;
    audience.target.copy(r.p);
    audience.dir.copy(r.d).multiplyScalar(Math.cos(yr)).addScaledVector(r.left, Math.sin(yr)).normalize();
  } else if (f[0] === 'PTH1' && f.length >= 7) {
    const i = Math.max(0, Math.min(255, +f[3])) / 255, contact = f[4] === '1', obj = +f[5], mm = +f[6];
    $('liveHud').hidden = false;
    const bar = $('liveBar'); bar.style.width = `${Math.round(i * 100)}%`; bar.classList.toggle('contact', contact);
    $('liveText').textContent = `${contact ? '▶ 접촉' : '근접'} · 세기 ${Math.round(i * 100)}% · ${mm < 0 ? '범위 밖' : (mm / 10).toFixed(1) + ' cm'}${obj > 0 ? ' · 사물 ' + obj : obj === 0 ? ' · 스캔 표면' : ''}`;
    state.hapAt = now;
  } else if (line.startsWith('PTR1,peers,')) state.peers = line.slice(11);
}

let ws = null, wantLive = false, retry = null, wsState = '연결 안 됨';
function relayUrl(base, room) {
  let b = base.trim().replace(/\/+$/, '').replace(/\/ws$/, '');
  if (b.startsWith('https://')) b = 'wss://' + b.slice(8); else if (b.startsWith('http://')) b = 'ws://' + b.slice(7);
  else if (!/^wss?:\/\//.test(b)) b = 'wss://' + b;
  return `${b}/ws?room=${encodeURIComponent(room.trim() || 'arko')}&role=viewer`;
}
function connect() {
  clearTimeout(retry);
  const base = $('relayUrl').value;
  if (!base.trim()) { wsState = '릴레이 주소를 넣으세요'; return; }
  try { ws = new WebSocket(relayUrl(base, $('relayRoom').value)); } catch (e) { wsState = '주소 오류: ' + e.message; return; }
  wsState = '접속 중…';
  const me = ws;
  ws.onopen = () => { if (me === ws) wsState = '연결됨'; };
  ws.onmessage = (e) => { if (me === ws) String(e.data).split('\n').forEach((l) => l && onLine(l)); };
  ws.onclose = () => {
    if (me !== ws) return;
    ws = null; wsState = wantLive ? '끊김 · 2초 뒤 재접속' : '연결 안 됨';
    if (wantLive) retry = setTimeout(connect, 2000);
  };
}
function save() { try { localStorage.setItem('ptRelay', JSON.stringify({ url: $('relayUrl').value, room: $('relayRoom').value })); } catch (e) { /* storage blocked */ } }
{
  const cfg = window.PHONETWIN_RELAY || {};
  let saved = null; try { saved = JSON.parse(localStorage.getItem('ptRelay') || 'null'); } catch (e) { saved = null; }
  const q = new URLSearchParams(location.search);   // ?relay=ws://…&room=… overrides (testing, another venue)
  $('relayUrl').value = q.get('relay') || (saved && saved.url) || cfg.url || '';
  $('relayRoom').value = q.get('room') || (saved && saved.room) || cfg.room || 'arko';
}
$('relayGo').addEventListener('click', () => { save(); wantLive = true; if (ws) { const o = ws; ws = null; o.close(); } connect(); });
$('relayStop').addEventListener('click', () => { wantLive = false; clearTimeout(retry); if (ws) { const o = ws; ws = null; o.close(); } wsState = '연결 안 됨'; });
// open the page = watch live (config.js auto: true); 끊기 stops it for this visit
if ((window.PHONETWIN_RELAY || {}).auto && $('relayUrl').value.trim()) { wantLive = true; connect(); }

setInterval(() => {
  const now = performance.now(), age = (t) => (t ? `${Math.round(now - t)} ms 전` : '없음');
  if (now - state.phoneAt > 3000) phoneMark.visible = false;
  if (now - state.espAt > 3000) espMark.visible = false;
  if (now - state.hapAt > 3000) $('liveHud').hidden = true;
  $('relayState').textContent = `${wsState}${state.peers ? '\n접속: ' + state.peers : ''}\n휴대폰 ${age(state.phoneAt)} · ESP32 ${age(state.espAt)}${state.espNote}\n관객(언리얼) ${age(state.audAt)}${state.audAt && !state.audValid ? ' · 대기(걷기 테스트 전)' : ''}\n진동 세기 ${age(state.hapAt)}`;
  $('liveDot').className = `live-dot ${ws && wsState === '연결됨' ? (now - Math.max(state.audAt, state.phoneAt, state.espAt) < 1500 ? 'on' : 'idle') : 'off'}`;
}, 250);
