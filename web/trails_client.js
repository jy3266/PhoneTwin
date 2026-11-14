// 몰입 보기: sign in (id + 4-digit PIN) to start an experience, walk, press 끝내기 to end it.
// Every walk stays as a small trail of light: on-site walks (the real person Unreal tracks) in blue, web walks in purple.
// Only your own trails carry your id. Server: the relay's /trails API (relay/trails.js, PROTOCOL.md §3-1).
import * as THREE from 'three';

const COLORS = { site: new THREE.Color(0x4fa9ff), web: new THREE.Color(0xb36dff) };
const MAX_DRAW_POINTS = 120000, JUMP_M = 3;   // a jump longer than 3 m is tracking, not flight

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
    $('gateLook').hidden = !st.done;      // trails are for those who finished
    $('gateSwitch').classList.toggle('primary', !!st.done);
    if (mode === 'login') setTimeout(() => ($('gateId').value ? $('gatePin') : $('gateId')).focus(), 50);
  }
  function hideGate() { gate.classList.add('hidden'); document.body.classList.remove('gated'); }
  function signedOut(text) {
    st.token = null; st.sid = null; st.done = false; st.guest = false;
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
      st.token = j.token; st.id = j.id; st.done = false; st.guest = false;
      try { sessionStorage.setItem('ptTrailToken', j.token); sessionStorage.setItem('ptTrailUser', j.id); localStorage.setItem('ptTrailId', j.id); } catch (err) { /* storage blocked */ }
      $('gatePin').value = '';
      o.toast(j.created ? `반갑습니다, ${j.id} 님 · 새 아이디가 만들어졌습니다` : `${j.id} 님, 체험을 시작합니다`);
      await startExperience();
    } catch (err) { msg.textContent = err.message === '401' ? '' : err.message; }
  });
  $('gatePin').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  $('gateAgain').addEventListener('click', () => startExperience());
  $('gateSwitch').addEventListener('click', () => { $('gateId').value = ''; $('gatePin').value = ''; signedOut('새 아이디와 비밀번호(숫자 4개)를 정해 주세요'); });
  $('gateFree').addEventListener('click', () => { hideGate(); st.guest = false; st.ended = 'free'; updateChip(); o.toast('흔적 없이 공간만 둘러보기 · 아무것도 기록되지 않습니다'); });
  $('gateBrowse').addEventListener('click', () => { hideGate(); st.guest = true; st.ended = null; updateChip(); o.toast('로그인 없이 흔적 보기 · 아무것도 기록되지 않습니다'); });
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
      o.toast('체험 시작 · 공간을 천천히 탐험해 보세요. 걸은 길은 체험이 끝나면 빛의 흔적으로 보입니다');
    } catch (err) {
      if (err.message === '401') return;
      if (err.status === 409) { markDone(); showGate('again', err.message); } else showGate('login', `시작하지 못했습니다: ${err.message}`);
    }
  }
  function markDone() {
    st.done = true;
    try { localStorage.removeItem('ptTrailId'); } catch (e) { /* storage blocked */ }
    $('gateId').value = '';
    updateChip();
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
    updateTail(p, now);
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
  }

  // ------------------------------------------------------------ chip: who, what kind, how long, end
  function fmt(s) { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`; }
  function updateChip() {
    setPhase();
    const chip = $('expChip');
    chip.dataset.state = st.sid ? st.kind : 'idle';
    $('chipText').textContent = st.sid ? `${st.id} · ${st.kind === 'site' ? '현장 체험 중 (푸른 빛)' : '웹 체험 중 (보라 빛)'}` :
      st.ended === 'offline' ? '기록 없이 보는 중' : st.ended === 'free' ? '흔적 없이 둘러보는 중' : st.guest ? '로그인 없이 흔적 보기' : st.token ? `${st.id} · ${st.done ? '체험 끝 · 모든 흔적 보기' : '체험 전'}` : '로그인 전';
    $('endBtn').hidden = !st.sid; $('chipStart').hidden = !!st.sid || st.ended === 'offline';
  }
  setInterval(() => { if (st.sid) $('chipTime').textContent = fmt((performance.now() - st.t0) / 1000); else $('chipTime').textContent = ''; }, 500);

  // ------------------------------------------------------------ drawing: a line of light along the butterfly's flight (3D, not the floor)
  const group = new THREE.Group(); o.scene.add(group);
  const uni = { uTime: { value: 0 }, uScale: { value: 500 }, uRes: { value: new THREE.Vector2(1280, 800) } };
  /** A camera-facing ribbon: every path point is two vertices pushed apart on screen; the fragment is a soft glow across it. */
  function material(color, alpha, width, taper = 0) {
    return new THREE.ShaderMaterial({
      uniforms: { ...uni, uColor: { value: color }, uAlpha: { value: alpha }, uWidth: { value: width }, uTaper: { value: taper } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute float aU; attribute float aFresh;
        uniform float uTime, uScale, uWidth, uAlpha, uTaper; uniform vec2 uRes;
        varying float vEdge; varying float vA;
        void main() {
          mat4 m = projectionMatrix * modelViewMatrix;
          vec4 c = m * vec4(position, 1.0), p = m * vec4(aPrev, 1.0), n = m * vec4(aNext, 1.0);
          vec2 asp = vec2(uRes.x / uRes.y, 1.0);
          vec2 dir = n.xy / max(n.w, 1e-3) * asp - p.xy / max(p.w, 1e-3) * asp;
          dir = dot(dir, dir) < 1e-12 ? vec2(1.0, 0.0) : normalize(dir);
          float px = clamp(uWidth * uScale / max(c.w, 0.05), 2.5, 28.0);         // full width in pixels, thinner far away
          px *= mix(1.0, 0.2 + 0.8 * aFresh, uTaper);                            // a tail narrows towards its old end
          c.xy += vec2(-dir.y, dir.x) / asp * (px / uRes.y) * aSide * c.w;
          gl_Position = c;
          vEdge = aSide;
          float flow = 0.7 + 0.3 * sin(aU * 7.0 - uTime * 1.8);                  // light running along the line
          vA = uAlpha * flow * mix(0.65 + 0.35 * aFresh, aFresh * aFresh, uTaper);   // and fades out
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vEdge; varying float vA;
        void main() {
          float e = abs(vEdge), core = exp(-e * e * 30.0), halo = exp(-e * e * 3.5);
          gl_FragColor = vec4(uColor * (0.45 * halo + 1.2 * core) + vec3(0.55 * core), vA * (0.3 * halo + core));
        }`,
    });
  }
  const white = new THREE.Color(1, 1, 1);
  const layers = {
    site: new THREE.Mesh(new THREE.BufferGeometry(), material(COLORS.site, 0.11, 0.03)),   // earlier visitors: barely there
    web: new THREE.Mesh(new THREE.BufferGeometry(), material(COLORS.web, 0.11, 0.03)),
    siteMine: new THREE.Mesh(new THREE.BufferGeometry(), material(COLORS.site.clone().lerp(white, 0.3), 0.95, 0.09)),
    webMine: new THREE.Mesh(new THREE.BufferGeometry(), material(COLORS.web.clone().lerp(white, 0.3), 0.95, 0.09)),
  };
  for (const l of Object.values(layers)) { l.frustumCulled = false; group.add(l); }
  const label = makeLabel(); group.add(label);

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
    label.position.copy(at).add(new THREE.Vector3(0, 0.3, 0)); label.visible = true;
  }

  /** Room point (m) -> scene, at the height it was recorded: where the butterfly flew. */
  function toScan(q) { return o.roomToScan(o.getMeta(), q[0], q[1], q[2] || 0).p; }
  /** Break at tracking jumps, then round the corners (Chaikin, twice) so the line flows like the flight did. */
  function strokes(path) {
    const out = []; let cur = [];
    for (const p of path) {
      if (cur.length && cur[cur.length - 1].distanceTo(p) > JUMP_M) { if (cur.length > 1) out.push(cur); cur = []; }
      cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
    return out.map((s) => {
      for (let it = 0; it < 2 && s.length > 2; it++) {
        const n = [s[0]];
        for (let i = 0; i < s.length - 1; i++) n.push(s[i].clone().lerp(s[i + 1], 0.25), s[i].clone().lerp(s[i + 1], 0.75));
        n.push(s[s.length - 1]); s = n;
      }
      return s;
    });
  }
  function addRibbon(b, s, fresh) {   // fresh: one value, or one per point
    const n = s.length, base = b.pos.length / 3;
    let u = 0;
    for (let i = 0; i < n; i++) {
      if (i) u += s[i].distanceTo(s[i - 1]);
      const p = s[i], a = s[Math.max(0, i - 1)], c = s[Math.min(n - 1, i + 1)];
      for (const side of [-1, 1]) { b.pos.push(p.x, p.y, p.z); b.prev.push(a.x, a.y, a.z); b.next.push(c.x, c.y, c.z); b.side.push(side); b.u.push(u); b.fresh.push(Array.isArray(fresh) ? fresh[i] : fresh); }
      if (i < n - 1) { const k = base + i * 2; b.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const empty = () => ({ pos: [], prev: [], next: [], side: [], u: [], fresh: [], idx: [] });
  function geometry(b) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('aPrev', new THREE.Float32BufferAttribute(b.prev, 3));
    g.setAttribute('aNext', new THREE.Float32BufferAttribute(b.next, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(b.side, 1));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(b.u, 1));
    g.setAttribute('aFresh', new THREE.Float32BufferAttribute(b.fresh, 1));
    g.setIndex(b.idx);
    return g;
  }
  // while exploring: a few seconds of light right behind the butterfly, narrowing and fading (not the saved trail)
  const TAIL_MS = 3000;
  const tail = new THREE.Mesh(new THREE.BufferGeometry(), material(COLORS.web.clone().lerp(white, 0.2), 1.1, 0.12, 1));
  tail.frustumCulled = false; tail.visible = false; tail.userData.pts = []; o.scene.add(tail);
  function updateTail(p, now) {
    const pts = tail.userData.pts;
    tail.visible = phase === 'explore';
    if (!tail.visible) { pts.length = 0; return; }
    tail.material.uniforms.uColor.value.copy(COLORS[st.kind] || COLORS.web).lerp(white, 0.2);
    const last = pts[pts.length - 1];
    if (last && last.p.distanceTo(p) > JUMP_M) pts.length = 0;   // a tracking jump starts a new tail
    if (!last || last.p.distanceTo(p) > 0.01 || now - last.t > 100) pts.push({ p: p.clone(), t: now });
    while (pts.length && now - pts[0].t > TAIL_MS) pts.shift();
    const s = pts.map((q) => q.p).concat([p.clone()]), fr = pts.map((q) => 1 - (now - q.t) / TAIL_MS).concat([1]);
    const b = empty();
    if (s.length > 1) addRibbon(b, s, fr);
    tail.geometry.dispose(); tail.geometry = geometry(b);
  }
  function draw() {
    const buckets = { site: empty(), web: empty(), siteMine: empty(), webMine: empty() };
    let total = 0, lastMine = null, lastMineKind = 'web';
    const counts = { site: 0, web: 0, mine: 0 };
    const list = st.trails.slice(-500);
    // bright = the one who just finished: my own walk, or (looking without an id) the most recent experience
    const latest = list.some((t) => t.mine) ? null : list.reduce((a, t) => (!a || (t.t1 || 0) > (a.t1 || 0) ? t : a), null);
    for (const t of list) {
      counts[t.kind]++; if (t.mine) counts.mine++;
      if (total > MAX_DRAW_POINTS) continue;
      const b = buckets[t.kind + (t.mine || t === latest ? 'Mine' : '')];
      for (const s of strokes(t.pts.map(toScan))) { addRibbon(b, s, t.live ? 1 : 0); total += s.length; }
      if (t.mine && t.pts.length) { lastMine = toScan(t.pts[t.pts.length - 1]); lastMineKind = t.kind; }
    }
    for (const [k, b] of Object.entries(buckets)) { layers[k].geometry.dispose(); layers[k].geometry = geometry(b); }
    if (lastMine && st.id) setLabel(`${st.id} (나)`, COLORS[lastMineKind], lastMine); else label.visible = false;
    $('trailCount').textContent = `현장 ${counts.site} · 웹 ${counts.web}${st.id ? ` · 내 흔적 ${counts.mine}` : ''}`;
  }
  async function refresh() {
    if (!st.ready || st.fetching) return;
    st.fetching = true;
    try {
      const q = new URLSearchParams({ scan: o.getScan() || '' }); if (st.token) q.set('token', st.token);
      const r = await fetch(`${st.api}/trails?${q}`, { cache: 'no-store' });
      if (r.ok) { st.trails = (await r.json()).trails || []; if (phase === 'review') draw(); }
    } catch (e) { /* offline: keep what we have */ }
    st.fetching = false;
  }
  setInterval(() => { if (phase === 'review') refresh(); }, 8000);
  $('showTrails').addEventListener('change', (e) => { st.show = e.target.checked; group.visible = phase === 'review' && st.show; });

  // ------------------------------------------------------------ phases: explore (in an experience, no trails drawn) / review (finished: every trail)
  let phase = null;
  function setPhase() {
    const p = st.sid ? 'explore' : st.done || st.guest ? 'review' : 'idle';
    if (p === phase) return;
    phase = p;
    group.visible = p === 'review' && st.show;
    if (p === 'review') refresh();
    if (o.onPhase) o.onPhase(p);
  }

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
    tick, boot, refresh, get state() { return st; }, get phase() { return phase; }, layers, label, tail,
    frame(dt, scale, w, h) { uni.uTime.value += dt; uni.uScale.value = scale; if (w && h) uni.uRes.value.set(w, h); },
  };
}
