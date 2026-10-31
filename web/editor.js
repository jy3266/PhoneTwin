// Collision & sound editor. Served only by tools/editor_server.mjs; the page's data is the local collision file of a scan.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { SOUND_DEFAULTS, ballShape, boxShape, cellKey, distanceGain, flatten, growShape, occupancy, reachOf, shapeDistance, shiftCells, transformCells, unflatten } from './collision_core.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const COLORS = [0xfacc15, 0x67e8f9, 0xf472b6, 0x86efac, 0xfb923c, 0xa78bfa, 0xf87171, 0x5eead4];

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1016);
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
const pointMat = new THREE.PointsMaterial({ size: 2.5, sizeAttenuation: false, vertexColors: true });
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(2, 5, 3); scene.add(sun);
const shapes = new THREE.Group(); scene.add(shapes);
const gizmoTarget = new THREE.Object3D(); scene.add(gizmoTarget);
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.attach(gizmoTarget); gizmo.visible = false; gizmo.enabled = false; scene.add(gizmo);
const walker = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.5, 20), new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.8 }));
walker.visible = false; scene.add(walker);

let cloud = null, data = null, occ = null, floor = 0, bounds = new THREE.Box3();
let selected = null, tool = 'orbit', dirty = false, placing = null;
const undoStack = [];

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

const unit = new THREE.BoxGeometry(1, 1, 1);
const matrix = new THREE.Matrix4();
/** Cells drawn as instanced cubes: solid when selected, faint otherwise. */
function rebuildMesh(c) {
  if (c.mesh) { shapes.remove(c.mesh); c.mesh.dispose(); c.mesh.material.dispose(); }
  const n = c.cells.length / 3, v = data.voxel, on = c === selected, color = COLORS[data.collisions.indexOf(c) % COLORS.length];
  const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: on ? 0.85 : 0.32, depthWrite: on });
  const mesh = new THREE.InstancedMesh(unit, mat, n);
  for (let i = 0; i < n; i++) {
    matrix.makeScale(v * 0.96, v * 0.96, v * 0.96).setPosition((c.cells[i * 3] + 0.5) * v, (c.cells[i * 3 + 1] + 0.5) * v, (c.cells[i * 3 + 2] + 0.5) * v);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.userData.collision = c;
  mesh.visible = on || $('showAll').checked;
  shapes.add(mesh); c.mesh = mesh;
}
function refreshAll() { data.collisions.forEach(rebuildMesh); renderList(); }

// ---------------------------------------------------------------- undo / dirty
const snapshot = () => JSON.stringify(data.collisions.map(({ mesh, ...rest }) => rest));
function pushUndo() { undoStack.push({ state: snapshot(), id: selected?.id }); if (undoStack.length > 60) undoStack.shift(); markDirty(); }
function markDirty() { dirty = true; $('dirty').textContent = '저장 안 됨'; }
function undo() {
  const u = undoStack.pop(); if (!u) return;
  shapes.clear(); data.collisions = JSON.parse(u.state);
  selected = data.collisions.find((c) => c.id === u.id) || null;
  refreshAll(); showSelected(); markDirty();
}
function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(t.timer); t.timer = setTimeout(() => { t.hidden = true; }, 2600); }

// ---------------------------------------------------------------- list + selection
function renderList() {
  $('count').textContent = `${data.collisions.length}개`;
  const ul = $('list'); ul.innerHTML = '';
  for (const c of data.collisions) {
    const li = document.createElement('li'); li.className = c === selected ? 'on' : '';
    li.innerHTML = '<div class="name"></div><div class="meta"></div>';
    li.querySelector('.name').textContent = c.name;
    const parts = [`${c.cells.length / 3}칸`];
    if (c.nearSound || c.touchSound) parts.push('♪');
    if (c.fallback) parts.push('자동 구분 실패: 손봐 주세요');
    li.querySelector('.meta').textContent = parts.join(' · ');
    li.onclick = () => select(c); ul.appendChild(li);
  }
}
function select(c) {
  const old = selected; selected = c;
  if (old && old !== c) rebuildMesh(old);
  if (c) rebuildMesh(c);
  renderList(); showSelected(); placeGizmo();
}
const fmtM = (v) => `${(+v).toFixed(2)} m`;
function showSelected() {
  const c = selected;
  $('sel').hidden = !c; $('noSel').hidden = !!c;
  if (!c) return;
  $('name').value = c.name;
  const b = cellBox(c), s = b.getSize(new THREE.Vector3());
  $('shapeInfo').textContent = `${c.label} · ${c.cells.length / 3}칸 · ${s.x.toFixed(2)} × ${s.z.toFixed(2)} × ${s.y.toFixed(2)}(높이) m`;
  fillSounds();
  const isAsset = (c.nearSound || '').startsWith('/Game');
  $('assetPath').value = isAsset ? c.nearSound : '';
  for (const [id, out, f] of [['volume', 'volumeOut', (v) => `${Math.round(v * 100)}%`], ['fullDistance', 'fullOut', fmtM], ['maxDistance', 'maxOut', fmtM]]) { $(id).value = c[id]; $(out).textContent = f(c[id]); }
  $('muted').checked = !!c.muted;
  $('reach').value = reachOf(c.label, 0.3); $('reachOut').textContent = fmtM($('reach').value);
  updateWalk();
}
function cellBox(c) {
  const b = new THREE.Box3(), v = data.voxel;
  for (let i = 0; i + 2 < c.cells.length; i += 3) b.expandByPoint(new THREE.Vector3(c.cells[i], c.cells[i + 1], c.cells[i + 2]).multiplyScalar(v)).expandByPoint(new THREE.Vector3(c.cells[i] + 1, c.cells[i + 1] + 1, c.cells[i + 2] + 1).multiplyScalar(v));
  return b;
}
function placeGizmo() {
  const mode = { move: 'translate', rotate: 'rotate', scale: 'scale' }[tool], on = selected && mode;
  gizmo.visible = gizmo.enabled = !!on;
  if (!on) return;
  gizmo.setMode(mode);
  cellBox(selected).getCenter(gizmoTarget.position); gizmoTarget.scale.set(1, 1, 1); gizmoTarget.rotation.set(0, 0, 0);
}
function setTool(t) {
  tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  controls.mouseButtons.LEFT = t === 'erase' || t === 'paint' ? null : THREE.MOUSE.ROTATE;
  placeGizmo();
}
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

// moving, turning, scaling: the shape follows the handle as a picture, the cells change when the handle is released
const liveMatrix = new THREE.Matrix4(), pivotBack = new THREE.Matrix4();
gizmo.addEventListener('objectChange', () => {
  if (!gizmo.start || !selected) return;
  liveMatrix.compose(gizmoTarget.position, gizmoTarget.quaternion, gizmoTarget.scale).multiply(pivotBack.makeTranslation(-gizmo.start.x, -gizmo.start.y, -gizmo.start.z));
  selected.mesh.matrixAutoUpdate = false; selected.mesh.matrix.copy(liveMatrix); selected.mesh.matrixWorldNeedsUpdate = true;
});
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (e.value) { pushUndo(); gizmo.start = cellBox(selected).getCenter(new THREE.Vector3()); return; }
  const c = selected, v = data.voxel, from = gizmo.start.toArray(), to = gizmoTarget.position.toArray();
  gizmo.start = null;
  if (tool === 'move') c.cells = shiftCells(c.cells, to.map((p, a) => Math.round((p - from[a]) / v)));
  else {
    const out = transformCells(c.cells, v, from, to, gizmoTarget.scale.toArray(), gizmoTarget.quaternion.toArray());
    if (out.length) c.cells = out; else toast('너무 작아져서 되돌렸습니다');
  }
  c.fallback = false;
  rebuildMesh(c); renderList(); showSelected(); placeGizmo();
});

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function setRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
}
/** Scan point under the cursor: the closest to the camera within a few pixels of the ray. */
function pickPoint() {
  if (!cloud) return null;
  ray.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.012;
  const h = ray.intersectObject(cloud)[0];
  return h ? h.point.clone() : null;
}
function floorPoint() {
  const t = (floor - ray.ray.origin.y) / ray.ray.direction.y;
  return t > 0 ? ray.ray.at(t, new THREE.Vector3()) : null;
}
function brushAt(fn, centre) {
  const r = +$('brush').value, v = data.voxel;
  const ci = Math.floor(centre.x / v), cj = Math.floor(centre.y / v), ck = Math.floor(centre.z / v);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) if (i * i + j * j + k * k <= r * r) fn(ci + i, cj + j, ck + k);
}
function strokeErase() {
  const c = selected, h = ray.intersectObject(c.mesh)[0]; if (!h) return false;
  const gone = new Set();
  brushAt((i, j, k) => gone.add(cellKey(i, j, k)), h.point.clone().addScaledVector(h.face.normal, -data.voxel / 2));
  const out = unflatten(c.cells).filter((x) => !gone.has(cellKey(...x)));
  if (out.length * 3 === c.cells.length) return false;
  c.cells = flatten(out); return true;
}
function strokePaint() {
  const c = selected, p = pickPoint(); if (!p) return false;
  const have = new Set(unflatten(c.cells).map((x) => cellKey(...x))), add = [];
  brushAt((i, j, k) => { const key = cellKey(i, j, k); if (!have.has(key) && (occ.has(key) || $('brush').value === '0')) add.push(i, j, k); }, p);
  if (!add.length) return false;
  c.cells = c.cells.concat(add); return true;
}
let painting = false;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !data) return;
  setRay(e);
  if (placing) { finishPlacing(); return; }
  if ($('walk').checked) { moveWalker(); return; }
  if ((tool === 'erase' || tool === 'paint') && selected) { pushUndo(); painting = true; stroke(); return; }
  if (tool === 'orbit') {
    const hit = ray.intersectObjects(shapes.children.filter((m) => m.visible))[0];
    canvas.downAt = [e.clientX, e.clientY, hit?.object.userData.collision];
  }
});
function stroke() {
  const changed = tool === 'erase' ? strokeErase() : strokePaint();
  if (changed) { selected.fallback = false; rebuildMesh(selected); }
}
canvas.addEventListener('pointermove', (e) => { if (painting) { setRay(e); stroke(); } });
addEventListener('pointerup', (e) => {
  if (painting) { painting = false; renderList(); showSelected(); }
  if (canvas.downAt && Math.hypot(e.clientX - canvas.downAt[0], e.clientY - canvas.downAt[1]) < 5 && canvas.downAt[2]) select(canvas.downAt[2]);
  canvas.downAt = null;
});

// ---------------------------------------------------------------- add / regrow / delete
const nextId = () => Math.max(199, ...data.collisions.map((c) => c.id)) + 1;
function newCollision(cells, label) {
  const c = { id: nextId(), label, name: label, source: 'user', fallback: false, cells: flatten(cells), ...SOUND_DEFAULTS };
  data.collisions.push(c); select(c); return c;
}
function startPlacing(kind) { placing = kind; const m = $('mode'); m.textContent = '스캔에서 사물을 클릭하세요'; m.hidden = false; }
function finishPlacing() {
  const p = pickPoint(), kind = placing; placing = null; $('mode').hidden = true;
  if (!p) { toast('스캔 점을 찾지 못했습니다'); return; }
  pushUndo();
  const at = [p.x, p.y, p.z];
  if (kind === 'box') newCollision(boxShape(at, [0.4, 0.4, 0.4], data.voxel), '상자');
  else {
    const cells = growShape(occ, at, 0.6, data.voxel);
    if (cells.length < 6) toast('사물을 구분하지 못해 공 모양으로 넣었습니다. 지우기·칠하기로 고쳐 주세요');
    newCollision(cells.length >= 6 ? cells : ballShape(at, 0.2, data.voxel), '새 사물');
  }
}
$('addGrow').onclick = () => startPlacing('grow');
$('addBox').onclick = () => startPlacing('box');
$('remove').onclick = () => {
  pushUndo(); shapes.remove(selected.mesh);
  data.collisions.splice(data.collisions.indexOf(selected), 1); selected = null;
  renderList(); showSelected(); placeGizmo();
};
$('regrow').onclick = () => {
  const c = selected, centre = cellBox(c).getCenter(new THREE.Vector3());
  const cells = growShape(occ, [centre.x, centre.y, centre.z], +$('reach').value, data.voxel);
  if (cells.length < 6) { toast('이 자리에서 사물을 찾지 못했습니다'); return; }
  pushUndo(); c.cells = flatten(cells); c.fallback = false; rebuildMesh(c); renderList(); showSelected();
};
$('reach').oninput = () => { $('reachOut').textContent = fmtM($('reach').value); };
$('brush').oninput = () => { $('brushOut').textContent = $('brush').value; };

$('name').oninput = () => { selected.name = $('name').value; markDirty(); renderList(); };
function bindNum(id, out, f) {
  $(id).onchange = () => markDirty();
  $(id).oninput = () => {
    selected[id] = +$(id).value;
    if (selected.maxDistance <= selected.fullDistance) { selected.maxDistance = selected.fullDistance + 0.1; $('maxDistance').value = selected.maxDistance; $('maxOut').textContent = fmtM(selected.maxDistance); }
    $(out).textContent = f(selected[id]); updateWalk(); markDirty();
  };
}
bindNum('volume', 'volumeOut', (v) => `${Math.round(v * 100)}%`); bindNum('fullDistance', 'fullOut', fmtM); bindNum('maxDistance', 'maxOut', fmtM);
$('muted').onchange = () => { selected.muted = $('muted').checked; updateWalk(); markDirty(); };

// ---------------------------------------------------------------- sounds
let soundFiles = [];
const audio = new AudioContext({ sampleRate: 48000 });
const buffers = new Map();   // file -> AudioBuffer
const voices = new Map();    // collision id -> {src, gain, file}
async function loadSoundList() { soundFiles = (await (await fetch('/api/sounds')).json()).sounds; }
function fillSounds() {
  for (const key of ['nearSound', 'touchSound']) {
    const sel = $(key), cur = selected[key] || '';
    sel.innerHTML = ''; sel.add(new Option('내장 소리 (사물에 맞춰 자동)', ''));
    for (const f of soundFiles) sel.add(new Option(f, f));
    if (cur.startsWith('/Game')) sel.add(new Option(cur, cur));
    sel.value = cur;
  }
}
for (const key of ['nearSound', 'touchSound']) $(key).onchange = () => { selected[key] = $(key).value; markDirty(); restartVoice(selected); renderList(); };
$('assetPath').onchange = () => {
  const v = $('assetPath').value.trim();
  if (v && !v.startsWith('/Game')) { toast('/Game/ 으로 시작하는 언리얼 경로를 넣어 주세요'); return; }
  selected.nearSound = v; markDirty(); fillSounds(); renderList();
};

/** Any format the browser can decode becomes 48 kHz 16-bit WAV, the one format Unreal reads at run time. */
function encodeWav(buf) {
  const ch = Math.min(2, buf.numberOfChannels), n = buf.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const tag = (o, s) => { for (let i = 0; i < 4; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); tag(8, 'WAVE'); tag(12, 'fmt '); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); tag(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data0 = buf.getChannelData(0), data1 = buf.getChannelData(ch - 1);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, (c ? data1 : data0)[i])) * 32767, true);
  return out.buffer;
}
async function addSound(file, key) {
  try {
    const decoded = await audio.decodeAudioData(await file.arrayBuffer());
    const name = `${file.name.replace(/\.[^.]+$/, '')}.wav`;
    const r = await (await fetch(`/api/sounds/${encodeURIComponent(name)}`, { method: 'POST', body: encodeWav(decoded) })).json();
    buffers.set(r.name, decoded);
    await loadSoundList();
    selected[key] = r.name; fillSounds(); markDirty(); renderList(); restartVoice(selected); toast(`${r.name} 추가`);
  } catch (e) { console.error(e); toast(`소리 파일을 읽지 못했습니다: ${e.message}`); }
}
$('nearFile').onchange = (e) => { if (e.target.files[0]) addSound(e.target.files[0], 'nearSound'); e.target.value = ''; };
$('touchFile').onchange = (e) => { if (e.target.files[0]) addSound(e.target.files[0], 'touchSound'); e.target.value = ''; };

async function bufferOf(file) {
  if (!file || file.startsWith('/Game')) return null;
  if (!buffers.has(file)) buffers.set(file, await audio.decodeAudioData(await (await fetch(`/sounds/${encodeURIComponent(file)}`)).arrayBuffer()));
  return buffers.get(file);
}
async function playOnce(file) {
  await audio.resume();
  const b = await bufferOf(file);
  if (!b) { toast(file ? '언리얼 에셋은 언리얼에서만 들립니다' : '내장 소리는 언리얼에서 들을 수 있습니다'); return; }
  const s = audio.createBufferSource(); s.buffer = b; s.connect(audio.destination); s.start();
}
$('playNear').onclick = () => playOnce(selected.nearSound);
$('playTouch').onclick = () => playOnce(selected.touchSound);

function stopVoice(id) { const v = voices.get(id); if (v) { v.src.stop(); v.src.disconnect(); voices.delete(id); } }
async function restartVoice(c) {
  stopVoice(c.id);
  if (!$('walk').checked) return;
  const b = await bufferOf(c.nearSound); if (!b) return;
  const src = audio.createBufferSource(), gain = audio.createGain();
  src.buffer = b; src.loop = true; gain.gain.value = 0; src.connect(gain).connect(audio.destination); src.start();
  voices.set(c.id, { src, gain });
  updateWalk();
}
function moveWalker() {
  const p = floorPoint(); if (!p) return;
  walker.position.set(p.x, floor + 0.75, p.z); walker.visible = true; updateWalk();
}
/** The same distance and loudness Unreal computes for the audience standing here. */
function updateWalk() {
  if (!walker.visible || !data) return;
  const p = walker.position, rows = [];
  for (const c of data.collisions) {
    const d = shapeDistance(c.cells, data.voxel, p.x, 0, p.z, true), g = distanceGain(c, d);
    const v = voices.get(c.id); if (v) v.gain.gain.setTargetAtTime(Math.min(1.5, g), audio.currentTime, 0.05);
    rows.push({ c, d, g });
  }
  rows.sort((a, b) => a.d - b.d);
  $('walkInfo').textContent = rows.slice(0, 5).map((r) => `${r.c.name}: ${(r.d * 100).toFixed(0)} cm · ${Math.round(r.g * 100)}%`).join('\n');
}
$('walk').onchange = async () => {
  await audio.resume();
  if ($('walk').checked) data.collisions.forEach(restartVoice);
  else { [...voices.keys()].forEach(stopVoice); walker.visible = false; }
};

// ---------------------------------------------------------------- views + load / save
$('size').oninput = () => { pointMat.size = +$('size').value; $('sizeOut').textContent = $('size').value; };
$('showAll').onchange = () => data.collisions.forEach((c) => { c.mesh.visible = c === selected || $('showAll').checked; });
function setView(kind) {
  const focus = kind === 'focus' && selected, box = focus ? cellBox(selected) : bounds;
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), r = Math.max(s.x, s.y, s.z, focus ? 0.4 : 1);
  controls.target.copy(c);
  if (kind === 'top') camera.position.set(c.x, c.y + r * 1.6, c.z + 0.001);
  else camera.position.set(c.x + r * 0.9, c.y + r * 0.8, c.z + r * 1.1);
  camera.near = r / 500; camera.far = r * 60; camera.updateProjectionMatrix();
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

async function openScan(id) {
  if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 다른 스캔을 열까요?')) { $('scan').value = data.scan; return; }
  [...voices.keys()].forEach(stopVoice);
  $('empty').textContent = '불러오는 중…'; $('empty').hidden = false;
  const [ply, col, meta] = await Promise.all([
    fetch(`web_scans/${id}.ply`).then((r) => { if (!r.ok) throw new Error(`복제본 없음: ${id}`); return r.arrayBuffer(); }),
    fetch(`/api/collisions/${id}`).then((r) => r.json()),
    fetch(`web_scans/${id}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const geom = new PLYLoader().parse(ply);
  if (cloud) { scene.remove(cloud); cloud.geometry.dispose(); }
  cloud = new THREE.Points(geom, pointMat); scene.add(cloud);
  geom.computeBoundingBox(); bounds = geom.boundingBox.clone();
  shapes.clear(); selected = null; undoStack.length = 0; dirty = false; $('dirty').textContent = '';
  data = col;
  for (const c of data.collisions) for (const k of Object.keys(SOUND_DEFAULTS)) if (c[k] === undefined) c[k] = SOUND_DEFAULTS[k];
  occ = occupancy(geom.getAttribute('position').array, data.voxel);
  floor = Array.isArray(meta?.a) ? meta.a[1] : estimateFloor(geom);
  refreshAll(); showSelected(); setView('iso'); $('empty').hidden = true;
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
}
function estimateFloor(geom) {
  const y = geom.getAttribute('position'), lo = bounds.min.y, hist = new Map();
  for (let i = 0; i < y.count; i++) { const v = y.getY(i); if (v < lo + (bounds.max.y - lo) * 0.35) { const k = Math.round(v / 0.02); hist.set(k, (hist.get(k) || 0) + 1); } }
  let best = lo, top = 0; for (const [k, n] of hist) if (n > top) { top = n; best = k * 0.02; }
  return best;
}
async function save() {
  const body = JSON.stringify({ version: data.version, scan: data.scan, voxel: data.voxel, collisions: data.collisions.map(({ mesh, ...rest }) => rest) });
  const r = await fetch(`/api/collisions/${data.scan}`, { method: 'POST', body });
  if (!r.ok) { toast('저장 실패'); return; }
  dirty = false; $('dirty').textContent = '저장됨'; toast('저장했습니다. 켜 있는 언리얼에도 1초 안에 반영됩니다');
}
$('save').onclick = save; $('undo').onclick = undo;
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (e.target.matches('input[type=text]') || e.ctrlKey) return;
  const t = { 1: 'orbit', 2: 'erase', 3: 'paint', 4: 'move', 5: 'rotate', 6: 'scale' }[e.key];
  if (t) setTool(t);
  if (e.key === 'Escape' && placing) { placing = null; $('mode').hidden = true; }
});
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

// ---------------------------------------------------------------- start
resize(); setTool('orbit');
(async () => {
  try {
    await fetch('/api/ping').then((r) => { if (!r.ok) throw new Error(); });
  } catch {
    $('empty').textContent = '편집기는 이 PC에서 콜리전_편집기.bat 으로 실행해야 저장할 수 있습니다.'; $('empty').hidden = false; return;
  }
  await loadSoundList();
  const index = await (await fetch('web_scans/index.json', { cache: 'no-store' })).json();
  for (const s of index.scans) $('scan').add(new Option(`${s.id} (${(s.points || 0).toLocaleString('ko-KR')}점)`, s.id));
  const want = decodeURIComponent(location.hash.slice(1));
  if (index.scans.some((s) => s.id === want)) $('scan').value = want;
  $('scan').onchange = () => openScan($('scan').value).catch((e) => { $('empty').textContent = e.message; $('empty').hidden = false; });
  openScan($('scan').value).catch((e) => { $('empty').textContent = e.message; $('empty').hidden = false; });
})();
window.__editor = { get data() { return data; }, select, setView, get selected() { return selected; },
  handle(axis, f) {   // screen position on a gizmo handle, for automated checks
    const size = gizmoTarget.position.distanceTo(camera.position) * Math.tan(camera.fov * Math.PI / 360) * 2 / 7 * 1.0;
    const p = gizmoTarget.position.clone().add(new THREE.Vector3(...axis).multiplyScalar(size * f)).project(camera), b = canvas.getBoundingClientRect();
    return [b.left + (p.x + 1) / 2 * b.width, b.top + (1 - p.y) / 2 * b.height];
  } };
