// Collision & sound editor. Served only by tools/editor_server.mjs; the page's data is the local collision file of a scan.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { SOUND_DEFAULTS, ballShape, boxShape, cellKey, distanceGain, flatten, growShape, occupancy, reachOf, shapeDistance, shiftCells, transformCells, unflatten,
  MAX_CELLS, voxelOf, HAPTICS, HAPTIC_RANGE, objectIntensity, hapticRate, hapticShape, resampleCells, dilate } from './collision_core.js';

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
const vox = (c) => voxelOf(data, c);   // every shape may have its own grid (세밀도)
const occCache = new Map();             // scan occupancy per grid size
function occAt(v) {
  if (!occCache.has(v)) occCache.set(v, occupancy(cloud.geometry.getAttribute('position').array, v));
  return occCache.get(v);
}
const cm = (v) => `${Math.round(v * 100)} cm`;
/** Cells that lie on the scan surface at grid v. Below the phone's 1.5 cm point spacing a cell next to a point counts too (no holes). */
const surfaceAt = (v) => (v <= 0.012 ? dilate(occAt(v), 1) : new Set(occAt(v).keys()));
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
  const n = c.cells.length / 3, v = vox(c), on = c === selected, color = COLORS[data.collisions.indexOf(c) % COLORS.length];
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
    if (Math.abs(vox(c) - data.voxel) > 1e-6) parts.push(`세밀 ${cm(vox(c))}`);
    if (c.parent) parts.push('부위');
    if (c.nearSound || c.touchSound) parts.push('♪');
    if (c.haptic && c.haptic !== 'steady') parts.push(`〰 ${HAPTICS.find((h) => h[0] === c.haptic)?.[1].split(' ')[0] || ''}`);
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
  $('shapeInfo').textContent = `${c.label} · ${c.cells.length / 3}칸(${cm(vox(c))}) · ${s.x.toFixed(2)} × ${s.z.toFixed(2)} × ${s.y.toFixed(2)}(높이) m`;
  $('detail').value = String(vox(c)); if (!$('detail').value) $('detail').value = '0.04';
  $('brushOut').textContent = brushText();
  $('haptic').value = c.haptic || 'steady';
  $('hapticRange').value = c.hapticRange ?? HAPTIC_RANGE; $('hapticRangeOut').textContent = fmtM($('hapticRange').value);
  $('hapticGain').value = c.hapticGain ?? 1; $('hapticGainOut').textContent = `${Math.round($('hapticGain').value * 100)}%`;
  $('hapticAt').max = Math.max(0.1, +$('hapticRange').value + 0.1);
  fillSounds();
  const isAsset = (c.nearSound || '').startsWith('/Game');
  $('assetPath').value = isAsset ? c.nearSound : '';
  for (const [id, out, f] of [['volume', 'volumeOut', (v) => `${Math.round(v * 100)}%`], ['fullDistance', 'fullOut', fmtM], ['maxDistance', 'maxOut', fmtM]]) { $(id).value = c[id]; $(out).textContent = f(c[id]); }
  $('muted').checked = !!c.muted;
  $('reach').value = reachOf(c.label, 0.3); $('reachOut').textContent = fmtM($('reach').value);
  updateWalk();
}
function cellBox(c) {
  const b = new THREE.Box3(), v = vox(c);
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
  controls.mouseButtons.LEFT = t === 'erase' || t === 'paint' || t === 'split' ? null : THREE.MOUSE.ROTATE;
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
  const c = selected, v = vox(c), from = gizmo.start.toArray(), to = gizmoTarget.position.toArray();
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
const brushText = () => `${$('brush').value}칸${selected ? ` (${cm((2 * +$('brush').value + 1) * vox(selected))} 폭)` : ''}`;
function brushAt(fn, centre, v) {
  const r = +$('brush').value;
  const ci = Math.floor(centre.x / v), cj = Math.floor(centre.y / v), ck = Math.floor(centre.z / v);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) if (i * i + j * j + k * k <= r * r) fn(ci + i, cj + j, ck + k);
}
let splitCells = [];   // cells taken off the selected shape while dragging with 부위 떼기
function strokeErase(keepTaken) {
  const c = selected, h = ray.intersectObject(c.mesh)[0]; if (!h) return false;
  const gone = new Set(), v = vox(c);
  brushAt((i, j, k) => gone.add(cellKey(i, j, k)), h.point.clone().addScaledVector(h.face.normal, -v / 2), v);
  const out = [];
  for (const x of unflatten(c.cells)) { if (gone.has(cellKey(...x))) { if (keepTaken) splitCells.push(x); } else out.push(x); }
  if (out.length * 3 === c.cells.length) return false;
  if (!out.length) { if (keepTaken) splitCells.length = 0; toast('사물 전체는 뗄 수 없습니다'); return false; }
  c.cells = flatten(out); return true;
}
function strokePaint() {
  const c = selected, p = pickPoint(); if (!p) return false;
  const have = new Set(unflatten(c.cells).map((x) => cellKey(...x))), add = [], v = vox(c), o = occAt(v);
  brushAt((i, j, k) => { const key = cellKey(i, j, k); if (!have.has(key) && (o.has(key) || $('brush').value === '0')) add.push(i, j, k); }, p, v);
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
  if ((tool === 'erase' || tool === 'paint' || tool === 'split') && selected) { pushUndo(); painting = true; splitCells = []; stroke(); return; }
  if (tool === 'orbit') {
    const hit = ray.intersectObjects(shapes.children.filter((m) => m.visible))[0];
    canvas.downAt = [e.clientX, e.clientY, hit?.object.userData.collision];
  }
});
function stroke() {
  const changed = tool === 'paint' ? strokePaint() : strokeErase(tool === 'split');
  if (changed) { selected.fallback = false; rebuildMesh(selected); }
}
canvas.addEventListener('pointermove', (e) => { if (painting) { setRay(e); stroke(); } });
addEventListener('pointerup', (e) => {
  if (painting) {
    painting = false;
    if (tool === 'split' && splitCells.length) {   // the taken cells become a part with its own name, sound and vibration
      const parent = selected, { mesh, id, ...rest } = parent;
      const part = { ...rest, id: nextId(), name: `${parent.name} · 부위`, label: parent.label, source: 'user', parent: parent.id, cells: flatten(splitCells), fallback: false };
      splitCells = []; data.collisions.push(part); rebuildMesh(parent); select(part); toast('부위를 떼어 냈습니다. 이름·소리·진동을 따로 정해 주세요');
    }
    renderList(); showSelected();
  }
  if (canvas.downAt && Math.hypot(e.clientX - canvas.downAt[0], e.clientY - canvas.downAt[1]) < 5 && canvas.downAt[2]) select(canvas.downAt[2]);
  canvas.downAt = null;
});

// ---------------------------------------------------------------- add / regrow / delete
const nextId = () => Math.max(199, ...data.collisions.map((c) => c.id)) + 1;
function newCollision(cells, label) {
  const c = { id: nextId(), label, name: label, source: 'user', fallback: false, cells: flatten(cells), ...SOUND_DEFAULTS };   // the file's grid; 세밀도 refines it
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
  const c = selected, centre = cellBox(c).getCenter(new THREE.Vector3()), v = vox(c);
  const cells = growShape(occAt(v), [centre.x, centre.y, centre.z], +$('reach').value, v);
  if (cells.length < 6) { toast('이 자리에서 사물을 찾지 못했습니다'); return; }
  pushUndo(); c.cells = flatten(cells); c.fallback = false; rebuildMesh(c); renderList(); showSelected();
};
$('reach').oninput = () => { $('reachOut').textContent = fmtM($('reach').value); };
$('brush').oninput = () => { $('brushOut').textContent = brushText(); };

// ---------------------------------------------------------------- 세밀도: a finer grid for this shape, fitted to the scan surface
function setCells(c, cells, v) {
  if (cells.length / 3 > MAX_CELLS) { toast(`칸이 너무 많습니다 (${(cells.length / 3).toLocaleString('ko-KR')}칸). 부위를 떼어 그 부분만 세밀하게 해 주세요`); return false; }
  pushUndo(); c.cells = cells; c.fallback = false;
  if (Math.abs(v - data.voxel) < 1e-6) delete c.voxel; else c.voxel = v;
  rebuildMesh(c); renderList(); showSelected(); placeGizmo(); return true;
}
$('detail').onchange = () => {
  const c = selected, from = vox(c), to = +$('detail').value;
  let cells = resampleCells(c.cells, from, to, to < from ? surfaceAt(to) : null);
  if (to < from && cells.length < 9) { cells = resampleCells(c.cells, from, to, null); toast('이 자리에 스캔 점이 거의 없어 칸만 나눴습니다'); }
  if (!setCells(c, cells, to)) $('detail').value = String(from);
  else toast(to < from ? `${cm(to)} 칸으로 나누고 스캔 표면에 맞췄습니다` : `${cm(to)} 칸으로 합쳤습니다`);
};
$('fitScan').onclick = () => {
  const c = selected, v = vox(c), keep = surfaceAt(v);
  const out = unflatten(c.cells).filter((x) => keep.has(cellKey(...x)));
  if (out.length < 3) { toast('스캔 표면과 겹치는 칸이 없습니다'); return; }
  if (out.length * 3 === c.cells.length) { toast('이미 스캔 표면에 맞춰져 있습니다'); return; }
  const removed = c.cells.length / 3 - out.length;
  if (setCells(c, flatten(out), v)) toast(`스캔 표면 밖의 칸 ${removed}개를 지웠습니다`);
};

// ---------------------------------------------------------------- 진동: character, start distance, strength (+ a live preview)
for (const [v, t] of HAPTICS) $('haptic').add(new Option(t, v));
$('haptic').onchange = () => { if ($('haptic').value === 'steady') delete selected.haptic; else selected.haptic = $('haptic').value; markDirty(); renderList(); };
$('hapticRange').oninput = () => { selected.hapticRange = +$('hapticRange').value; $('hapticRangeOut').textContent = fmtM(selected.hapticRange); $('hapticAt').max = selected.hapticRange + 0.1; markDirty(); };
$('hapticGain').oninput = () => { selected.hapticGain = +$('hapticGain').value; $('hapticGainOut').textContent = `${Math.round(selected.hapticGain * 100)}%`; markDirty(); };
$('hapticAt').oninput = () => { $('hapticAtOut').textContent = fmtM($('hapticAt').value); };
let hapticPhase = 0, hapticLast = performance.now(), walkHand = null;
function drawHaptic(now) {
  requestAnimationFrame(drawHaptic);
  const dt = Math.min(0.1, (now - hapticLast) / 1000); hapticLast = now;
  const cv = $('hapticCanvas'); if (!cv || !selected || $('sel').hidden) return;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, c = selected, range = c.hapticRange ?? HAPTIC_RANGE, gain = c.hapticGain ?? 1, kind = c.haptic || 'steady';
  const d = walker.visible && walkHand != null ? walkHand : +$('hapticAt').value;
  let i = Math.min(1, objectIntensity(d, range) * gain);
  hapticPhase += dt * hapticRate(kind, i); const live = i * hapticShape(kind, hapticPhase);
  g.clearRect(0, 0, W, H); g.fillStyle = '#0b1016'; g.fillRect(0, 0, W, H);
  const top = 12, bot = 120, x0 = 10, x1 = W - 10, xs = (dd) => x0 + (1 - dd / Math.max(range, 0.01)) * (x1 - x0);
  g.strokeStyle = '#334155'; g.beginPath(); g.moveTo(x0, bot); g.lineTo(x1, bot); g.stroke();
  g.strokeStyle = '#facc15'; g.lineWidth = 2; g.beginPath();
  for (let k = 0; k <= 100; k++) { const dd = range * (1 - k / 100), y = bot - Math.min(1, objectIntensity(dd, range) * gain) * (bot - top); k ? g.lineTo(xs(dd), y) : g.moveTo(xs(dd), y); }
  g.stroke(); g.lineWidth = 1;
  if (d < range) { g.fillStyle = '#fb923c'; g.beginPath(); g.arc(xs(d), bot - i * (bot - top), 5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#94a3b8'; g.font = '12px system-ui, sans-serif'; g.fillText(`${fmtM(range)} 시작`, x0, bot + 16); g.textAlign = 'right'; g.fillText('닿음', x1, bot + 16); g.textAlign = 'left';
  g.fillStyle = '#1e293b'; g.fillRect(x0, 150, x1 - x0, 26);
  g.fillStyle = live > 0.02 ? '#f97316' : '#334155'; g.fillRect(x0, 150, (x1 - x0) * live, 26);
  g.fillStyle = '#e2e8f0'; g.fillText(`${walker.visible && walkHand != null ? '관객 손' : '미리보기'} ${(d * 100).toFixed(0)} cm · 진동 ${Math.round(live * 255)}/255`, x0 + 6, 168);
}
requestAnimationFrame(drawHaptic);

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
    // the audience's hand at 1 m: sound and vibration both follow the hand, like Unreal (bSoundsFromHand)
    const hand = shapeDistance(c.cells, vox(c), p.x, floor + 1.0, p.z), d = hand, g = distanceGain(c, d);
    const vib = Math.min(1, objectIntensity(hand, c.hapticRange ?? HAPTIC_RANGE) * (c.hapticGain ?? 1));
    if (c === selected) walkHand = hand;
    const v = voices.get(c.id); if (v) v.gain.gain.setTargetAtTime(Math.min(1.5, g), audio.currentTime, 0.05);
    rows.push({ c, d, g, vib });
  }
  rows.sort((a, b) => a.d - b.d);
  $('walkInfo').textContent = rows.slice(0, 5).map((r) => `${r.c.name}: 손에서 ${(r.d * 100).toFixed(0)} cm · 소리 ${Math.round(r.g * 100)}% · 진동 ${Math.round(r.vib * 100)}%`).join('\n');
}
$('walk').onchange = async () => {
  await audio.resume();
  if ($('walk').checked) data.collisions.forEach(restartVoice);
  else { [...voices.keys()].forEach(stopVoice); walker.visible = false; walkHand = null; }
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
  occCache.clear(); occ = occAt(data.voxel);
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
  dirty = false; $('dirty').textContent = '저장됨'; toast('저장했습니다. 켜 있는 언리얼은 1초 안에 이 스캔으로 바뀌어 반영됩니다');
  watchPublish();
}
// upload of the saved file to GitHub (the public web viewer), done by the editor server 15 s after the last save
let publishWatch = 0;
function watchPublish() {
  clearInterval(publishWatch);
  const started = Date.now();
  publishWatch = setInterval(async () => {
    let p = null;
    try { p = await (await fetch('/api/publish', { cache: 'no-store' })).json(); } catch { return; }
    if (dirty) return;
    $('dirty').textContent = p.text ? `저장됨 · ${p.text}` : '저장됨';
    if (p.state === 'done' || p.state === 'error' || p.state === 'off' || Date.now() - started > 180000) {
      clearInterval(publishWatch);
      if (p.state === 'done' || p.state === 'error') toast(p.text);
    }
  }, 1000);
}
$('save').onclick = save; $('undo').onclick = undo;
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (e.target.matches('input[type=text]') || e.ctrlKey) return;
  const t = { 1: 'orbit', 2: 'erase', 3: 'paint', 4: 'move', 5: 'rotate', 6: 'scale', 7: 'split' }[e.key];
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
  const edited = await fetch('web_scans/edited.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const want = decodeURIComponent(location.hash.slice(1)) || edited?.scan;   // else the scan saved last
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
