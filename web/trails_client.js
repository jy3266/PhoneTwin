// 몰입 보기: sign in (id + 4-digit PIN) to start an experience, walk, press 끝내기 to end it.
// Every walk stays as a small trail of light: on-site walks (the real person Unreal tracks) in blue, web walks in purple.
// Only your own trails carry your id. Server: the relay's /trails API (relay/trails.js, PROTOCOL.md §3-1).
import * as THREE from 'three';

const COLORS = { site: new THREE.Color(0x4fa9ff), web: new THREE.Color(0xb36dff) };
const MAX_DRAW_POINTS = 160000, STEP_M = 0.05;

export function createTrails(o) {
  // o: { scene, $, toast, roomToScan, getMeta, getFloorY, getScan, isSite, apiBase }
  const { $ } = o;
  const st = { api: o.apiBase(), ready: false, token: null, id: null, sid: null, kind: null, scan: null, t0: 0,
    buf: [], last: null, lastSend: 0, lastRec: 0, kindSince: 0, kindWant: null, trails: [], myLocal: [], show: true, fetching: false, ended: null };
  try { st.token = sessionStorage.getItem('ptTrailToken'); st.id = sessionStorage.getItem('ptTrailUser'); } catch (e) { /* storage blocked */ }

  // ------------------------------------------------------------ server calls
  async function call(op, body) {
    const r = await fetch(`${st.api}/trails/${op}`, { method: 'POST', body: JSON.stringify({ token: st.token, ...body }), headers: { 'Content-Type': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && op !== 'login') { signedOut('다시 로그인해 주세요 (서버가 다시 시작되었습니다)'); throw new Error('401'); }
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }
  function beacon(op, body) {
    try { navigator.sendBeacon(`${st.api}/trails/${op}`, new Blob([JSON.stringify({ token: st.token, ...body })], { type: 'text/plain' })); } catch (e) { /* page closing */ }
  }

  // ------------------------------------------------------------ the sign-in gate
  const gate = $('gate'), form = $('gateForm'), msg = $('gateMsg');
  try { $('gateId').value = localStorage.getItem('ptTrailId') || ''; } catch (e) { /* storage blocked */ }
  function showGate(mode, text) {
    gate.classList.remove('hidden'); document.body.classList.add('gated');
    gate.dataset.mode = mode;   // login | again | offline
    msg.textContent = text || '';
    $('gateAgainName').textContent = st.id || '';
    $('gateAgain').hidden = !!st.done;   // one experience per id
    $('gateSwitch').classList.toggle('primary', !!st.done);
    if (mode === 'login') setTimeout(() => ($('gateId').value ? $('gatePin') : $('gateId')).focus(), 50);
  }
  function hideGate() { gate.classList.add('hidden'); document.body.classList.remove('gated'); }
  function signedOut(text) {
    st.token = null; st.sid = null; st.done = false;
    try { sessionStorage.removeItem('ptTrailToken'); } catch (e) { /* storage blocked */ }
    updateChip(); showGate('login', text);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('gateId').value.trim(), pin = $('gatePin').value.trim();
    if (!/^\d{4}$/.test(pin)) { msg.textContent = '비밀번호는 숫자 4개입니다'; return; }
    msg.textContent = '확인 중…';
    try {
      const j = await call('login', { id, pin });
      st.token = j.token; st.id = j.id; st.done = false;
      try { sessionStorage.setItem('ptTrailToken', j.token); sessionStorage.setItem('ptTrailUser', j.id); localStorage.setItem('ptTrailId', j.id); } catch (err) { /* storage blocked */ }
      $('gatePin').value = '';
      o.toast(j.created ? `반갑습니다, ${j.id} 님 · 새 아이디가 만들어졌습니다` : `${j.id} 님, 체험을 시작합니다`);
      await startExperience();
    } catch (err) { msg.textContent = err.message === '401' ? '' : err.message; }
  });
  $('gatePin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  $('gateAgain').addEventListener('click', () => startExperience());
  $('gateSwitch').addEventListener('click', () => { $('gateId').value = ''; $('gatePin').value = ''; signedOut('새 아이디와 비밀번호(숫자 4개)를 정해 주세요'); });
  $('gateLook').addEventListener('click', () => { hideGate(); st.ended = 'look'; updateChip(); });
  $('gateOffline').addEventListener('click', () => { hideGate(); st.ended = 'offline'; updateChip(); });
  $('endBtn').addEventListener('click', () => endExperience(true));
  $('chipStart').addEventListener('click', () => (st.done ? showGate('again', '이 아이디의 체험은 끝났습니다. 다시 하려면 새 아이디를 만들어 주세요.') : st.token ? startExperience() : showGate('login')));

  // ------------------------------------------------------------ an experience: start, record, end
  async function startExperience() {
    const kind = o.isSite() ? 'site' : 'web', scan = o.getScan();
    try {
      const j = await call('start', { scan, kind, room: o.room || 'arko' });
      Object.assign(st, { sid: j.sid, kind, scan, t0: performance.now(), buf: [], last: null, lastSend: performance.now(), myLocal: [], kindWant: null, ended: null });
      hideGate(); updateChip();
      o.toast(kind === 'site' ? '체험 시작 · 현장의 실제 움직임이 푸른 빛으로 남습니다' : '체험 시작 · 걷는 길이 보라 빛으로 남습니다');
    } catch (err) {
      if (err.message === '401') return;
      if (err.status === 409) { markDone(); showGate('again', err.message); } else showGate('login', `시작하지 못했습니다: ${err.message}`);
    }
  }
  function markDone() {
    st.done = true;
    try { localStorage.removeItem('ptTrailId'); } catch (e) { /* storage blocked */ }
    $('gateId').value = '';
  }
  async function endExperience(byUser) {
    if (!st.sid) return;
    const sid = st.sid, secs = (performance.now() - st.t0) / 1000, kind = st.kind;
    await flush();
    st.sid = null; updateChip();
    try {
      const j = await call('end', { sid, final: !!byUser });
      if (byUser) {
        markDone();
        showGate('again', `${kind === 'site' ? '현장' : '웹'} 체험 ${fmt(secs)} · ${j.kept ? '흔적이 남았습니다' : '너무 짧아 흔적이 남지 않았습니다'}. 체험은 아이디 하나에 한 번입니다 — 다시 하려면 새 아이디를 만들어 주세요.`);
      }
    } catch (err) { if (byUser && err.message !== '401') showGate('again', `끝내기 실패: ${err.message}`); }
    st.myLocal = []; refresh();
  }
  async function flush() {
    if (!st.sid) return;
    const pts = st.buf.splice(0);
    st.lastSend = performance.now();
    try { await call('add', { sid: st.sid, pts }); } catch (err) { if (err.message !== '401') st.buf.unshift(...pts.slice(-600)); }
  }
  addEventListener('pagehide', () => {
    if (!st.sid) return;
    if (st.buf.length) beacon('add', { sid: st.sid, pts: st.buf.splice(0) });
    beacon('end', { sid: st.sid });
  });

  function scanToRoom(p) {
    const m = o.getMeta();
    if (m && Array.isArray(m.a) && Array.isArray(m.b)) {
      const r = o.roomToScan(m, 0, 0, 0), rel = p.clone().sub(r.p);
      return [rel.dot(r.d), rel.dot(r.left), rel.y];
    }
    return [p.x, -p.z, p.y];
  }
  /** Every frame, with the audience position the page shows (scan frame). */
  function tick(p, now) {
    if (!st.sid) return;
    // the experience follows where it happens: a web walk becomes an on-site one when the real system appears (and back)
    const want = o.isSite() ? 'site' : 'web';
    if (want !== st.kind) {
      if (st.kindWant !== want) { st.kindWant = want; st.kindSince = now; }
      else if (now - st.kindSince > 3000) { st.kindWant = null; endExperience(false).then(startExperience); return; }
    } else st.kindWant = null;
    if (o.getScan() !== st.scan) { endExperience(false).then(startExperience); return; }
    if (st.kind === 'web' && now - st.lastRec > 200) {
      st.lastRec = now;
      if (!st.last || st.last.distanceTo(p) > 0.04) {
        st.last = p.clone();
        st.buf.push(scanToRoom(p).map((v) => Math.round(v * 100) / 100));
        st.myLocal.push(p.clone());
      }
    }
    if (now - st.lastSend > (st.kind === 'web' ? 3000 : 10000)) flush();   // site: a keep-alive that also claims the walk
    if (now - drawn > 1000 && st.kind === 'web') { drawn = now; draw(); }
  }

  // ------------------------------------------------------------ chip: who, what kind, how long, end
  function fmt(s) { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`; }
  function updateChip() {
    const chip = $('expChip');
    chip.dataset.state = st.sid ? st.kind : 'idle';
    $('chipText').textContent = st.sid ? `${st.id} · ${st.kind === 'site' ? '현장 체험 중 (푸른 빛)' : '웹 체험 중 (보라 빛)'}` :
      st.ended === 'offline' ? '기록 없이 보는 중' : st.token ? `${st.id} · ${st.done ? '체험 끝' : '체험 전'}` : '로그인 전';
    $('endBtn').hidden = !st.sid; $('chipStart').hidden = !!st.sid || st.ended === 'offline';
  }
  setInterval(() => { if (st.sid) $('chipTime').textContent = fmt((performance.now() - st.t0) / 1000); else $('chipTime').textContent = ''; }, 500);

  // ------------------------------------------------------------ drawing: small lights along every walk
  const group = new THREE.Group(); o.scene.add(group);
  const uni = { uTime: { value: 0 }, uScale: { value: 500 } };
  function material(color, alpha, size) {
    return new THREE.ShaderMaterial({
      uniforms: { ...uni, uColor: { value: color }, uAlpha: { value: alpha }, uSize: { value: size } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float aPhase; attribute float aFresh;
        uniform float uTime, uScale, uSize, uAlpha;
        varying float vA;
        void main() {
          vec3 p = position; p.y += 0.02 * sin(uTime * 0.8 + aPhase * 6.2832);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.6 + 0.4 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 40.0);
          gl_PointSize = clamp(uSize * (1.0 + 0.6 * aFresh) * uScale / -mv.z, 1.0, 14.0);
          vA = uAlpha * tw * (0.55 + 0.45 * aFresh);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
          float s = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(uColor * (0.6 + 0.8 * s * s), vA * s);
        }`,
    });
  }
  const layers = {
    site: new THREE.Points(new THREE.BufferGeometry(), material(COLORS.site, 0.5, 0.022)),
    web: new THREE.Points(new THREE.BufferGeometry(), material(COLORS.web, 0.5, 0.022)),
    siteMine: new THREE.Points(new THREE.BufferGeometry(), material(COLORS.site.clone().lerp(new THREE.Color(1, 1, 1), 0.25), 1.0, 0.04)),
    webMine: new THREE.Points(new THREE.BufferGeometry(), material(COLORS.web.clone().lerp(new THREE.Color(1, 1, 1), 0.25), 1.0, 0.04)),
  };
  for (const l of Object.values(layers)) { l.frustumCulled = false; group.add(l); }
  const label = makeLabel(); group.add(label);
  let drawn = 0;

  function makeLabel() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
    s.scale.set(1.2, 0.3, 1); s.visible = false; s.userData = { c, t, text: '' };
    return s;
  }
  function setLabel(text, color, at) {
    const u = label.userData;
    if (u.text !== text + color.getHexString()) {
      u.text = text + color.getHexString();
      const g = u.c.getContext('2d'); g.clearRect(0, 0, 512, 128);
      g.font = '600 52px system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = `#${color.getHexString()}`; g.shadowBlur = 18; g.fillStyle = '#fff'; g.fillText(text, 256, 64);
      u.t.needsUpdate = true;
    }
    label.position.copy(at).add(new THREE.Vector3(0, 0.35, 0)); label.visible = true;
  }

  function toScan(q) {
    const r = o.roomToScan(o.getMeta(), q[0], q[1], 0).p;
    r.y = o.getFloorY() + 0.03;
    return r;
  }
  function resample(path, out, phases, fresh, f) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / STEP_M));
      if (L > 3) continue;   // a tracking jump is not a walk
      for (let k = 0; k < n; k++) {
        const p = a.clone().lerp(b, k / n);
        out.push(p.x, p.y, p.z); phases.push(Math.random()); fresh.push(f);
      }
    }
  }
  function draw() {
    const buckets = { site: [[], [], []], web: [[], [], []], siteMine: [[], [], []], webMine: [[], [], []] };
    let total = 0, lastMine = null, lastMineKind = 'web';
    const list = st.trails.slice(-500);
    const counts = { site: 0, web: 0, mine: 0 };
    for (const t of list) {
      counts[t.kind]++; if (t.mine) counts.mine++;
      if (total > MAX_DRAW_POINTS) continue;
      const path = t.pts.map(toScan), key = t.kind + (t.mine ? 'Mine' : '');
      const b = buckets[key]; const before = b[0].length;
      resample(path, b[0], b[1], b[2], t.live ? 1 : 0);
      total += (b[0].length - before) / 3;
      if (t.mine && path.length) { lastMine = path[path.length - 1]; lastMineKind = t.kind; }
    }
    if (st.myLocal.length > 1) {   // my web walk right now, before the server has it
      const b = buckets.webMine; resample(st.myLocal.map((p) => { const q = p.clone(); q.y = o.getFloorY() + 0.03; return q; }), b[0], b[1], b[2], 1);
      lastMine = st.myLocal[st.myLocal.length - 1].clone().setY(o.getFloorY() + 0.03); lastMineKind = 'web';
    }
    for (const [k, [pos, ph, fr]] of Object.entries(buckets)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aPhase', new THREE.Float32BufferAttribute(ph, 1));
      g.setAttribute('aFresh', new THREE.Float32BufferAttribute(fr, 1));
      layers[k].geometry.dispose(); layers[k].geometry = g;
    }
    if (lastMine && st.id) setLabel(`${st.id} (나)`, COLORS[lastMineKind], lastMine); else label.visible = false;
    $('trailCount').textContent = `현장 ${counts.site} · 웹 ${counts.web}${st.id ? ` · 내 흔적 ${counts.mine}` : ''}`;
  }
  async function refresh() {
    if (!st.ready || st.fetching) return;
    st.fetching = true;
    try {
      const q = new URLSearchParams({ scan: o.getScan() || '' }); if (st.token) q.set('token', st.token);
      const r = await fetch(`${st.api}/trails?${q}`, { cache: 'no-store' });
      if (r.ok) { st.trails = (await r.json()).trails || []; draw(); }
    } catch (e) { /* offline: keep what we have */ }
    st.fetching = false;
  }
  setInterval(refresh, 8000);
  $('showTrails').addEventListener('change', (e) => { group.visible = e.target.checked; });

  // ------------------------------------------------------------ start: is the trail server there?
  async function boot() {
    let ok = false;
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
      ok = !!st.api && (await fetch(`${st.api}/trails/status`, { cache: 'no-store', signal: ctl.signal })).ok;
    } catch (e) { ok = false; }
    st.ready = ok;
    if (!ok) { showGate('offline', '흔적 서버(릴레이)가 아직 이 기능을 지원하지 않거나 연결되지 않았습니다.'); updateChip(); return; }
    refresh();
    if (st.token) {   // same tab, still signed in: go on only if this id has not finished its one experience
      let me = null;
      try { me = await call('me', {}); } catch (e) { if (e.message === '401') return; }
      if (me && me.done) { markDone(); showGate('again', `${st.id} 님의 체험은 끝났습니다. 다시 하려면 새 아이디를 만들어 주세요.`); }
      else showGate('again', `${st.id} 님, 체험을 시작할까요?`);
    } else showGate('login');
    updateChip();
  }

  return {
    tick, boot, refresh, get state() { return st; }, layers, label,
    frame(dt, scale) { uni.uTime.value += dt; uni.uScale.value = scale; },
  };
}
