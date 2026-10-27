# Phone Twin — OSC in (Unreal PhoneTwinLink) -> audience / object tables -> motion signals -> OSC out
# This text lives in the 'phonetwin_core' DAT of Phone_Twin_Project.toe (built by build_phonetwin_td.py).
#
# In (PROTOCOL.md §4, Unreal sends at 30 Hz; room frame R: metres, origin = floor mark A, +X towards B, +Y left, +Z up)
#   /phonetwin/state    active walk source(0 phone, 1 ESP32) objectCount
#   /phonetwin/scan     scanId
#   /phonetwin/pos      x y z                                    (audience = tracked device)
#   /phonetwin/dir      fx fy fz yawDeg
#   /phonetwin/nearest  objectId distCm intensity01 contact name  (what the vibration uses; -1 cm = out of range)
#   /phonetwin/object   index id name label floorCm handCm cx cy cz radiusCm   (one per object, every frame)
# Out (to Outhost:Outport, at Outrate Hz)
#   /td/state      active live sim objectCount
#   /td/audience   x y z speed headingDeg
#   /td/velocity   vx vy vz accel
#   /td/energy     0..1 (walking speed, 1 = 1.2 m/s)
#   /td/nearest    index id proximity floorCm name
#   /td/object/<i> proximity floorCm approachCmPerS id name
#   /td/proximity  proximity of every object, in index order
import math

S = None
SIM_OBJECTS = [   # id, name, label, cx, cy, cz (m, R frame), radius (m)
	(1, '의자', 'chair', 1.2, 0.9, 0.45, 0.35),
	(2, '화분', 'potted plant', 2.7, -0.8, 0.4, 0.3),
	(3, '책상', 'desk', 0.4, -1.3, 0.7, 0.5),
	(101, '노트북', 'laptop', 3.3, 1.1, 0.8, 0.2),
]


def comp():
	return me.parent()


def reset():
	global S
	S = dict(last=-1e9, live=False, sim=False, msgs=0, active=0, walk=0, source=0, count=0, scan='',
	         pos=[0.0, 0.0, 0.0], dir=[1.0, 0.0, 0.0], yaw=0.0,
	         near_id=-1, near_cm=-1.0, near_int=0.0, near_contact=0, near_name='',
	         objects={}, vel=[0.0, 0.0, 0.0], speed=0.0, accel=0.0, prev=None, prevAt=0.0,
	         trail=[], sendAcc=0.0, lastTick=None)


reset()


def _alpha(dt):
	tau = max(1e-3, float(comp().par.Smoothing.eval()))
	return 1.0 - math.exp(-dt / tau)


def handle(address, args, fromSim=False):
	"""One OSC message (from the OSC In DAT callback or the simulator)."""
	if S is None:
		reset()
	now = absTime.seconds
	if not fromSim:
		if S['sim']:   # real data arrived: drop everything the simulator made up
			reset()
		S['last'] = now
		S['msgs'] += 1
	a = list(args)
	try:
		if address == '/phonetwin/state':
			S['active'], S['walk'], S['source'], S['count'] = int(a[0]), int(a[1]), int(a[2]), int(a[3])
			for k in [k for k in S['objects'] if k >= S['count']]:
				del S['objects'][k]
		elif address == '/phonetwin/pos':
			S['pos'] = [float(a[0]), float(a[1]), float(a[2])]
			_on_pos(now)
		elif address == '/phonetwin/dir':
			S['dir'] = [float(a[0]), float(a[1]), float(a[2])]
			if len(a) > 3:
				S['yaw'] = float(a[3])
		elif address == '/phonetwin/nearest':
			S['near_id'], S['near_cm'], S['near_int'], S['near_contact'] = int(a[0]), float(a[1]), float(a[2]), int(a[3])
			S['near_name'] = str(a[4]) if len(a) > 4 else ''
		elif address == '/phonetwin/object':
			i = int(a[0])
			o = S['objects'].get(i) or dict(approach=0.0, at=None, prevCm=None)
			cm = float(a[4])
			if o['at'] is not None and o['prevCm'] is not None:
				dt = now - o['at']
				if 1e-3 < dt < 0.5:
					o['approach'] += _alpha(dt) * (-(cm - o['prevCm']) / dt - o['approach'])
			o.update(id=int(a[1]), name=str(a[2]), label=str(a[3]), cm=cm, hand=float(a[5]),
			         c=[float(a[6]), float(a[7]), float(a[8])], r=float(a[9]), at=now, prevCm=cm)
			S['objects'][i] = o
		elif address == '/phonetwin/scan':
			S['scan'] = str(a[0]) if a else ''
	except (IndexError, ValueError, TypeError):
		pass


def _on_pos(now):
	p, prev = S['pos'], S['prev']
	if prev is not None:
		dt = now - S['prevAt']
		if dt > 0.5:   # a gap: do not turn it into a jump in speed
			S['vel'], S['speed'], S['accel'] = [0.0, 0.0, 0.0], 0.0, 0.0
		elif dt > 1e-3:
			al = _alpha(dt)
			v = [(p[k] - prev[k]) / dt for k in range(3)]
			S['vel'] = [S['vel'][k] + al * (v[k] - S['vel'][k]) for k in range(3)]
			sp = math.hypot(S['vel'][0], S['vel'][1])
			S['accel'] += al * ((sp - S['speed']) / dt - S['accel'])
			S['speed'] = sp
	S['prev'], S['prevAt'] = list(p), now
	tr = S['trail']
	if not tr or math.hypot(p[0] - tr[-1][0], p[1] - tr[-1][1]) > 0.02:
		tr.append((p[0], p[1]))
		del tr[:-400]


def simulate(now):
	"""Walks a figure eight between made-up objects, so the network can be tried without Unreal."""
	t = now * 0.3
	x, y = 1.8 + 1.6 * math.sin(t), 1.0 * math.sin(2 * t)
	dx, dy = 1.6 * math.cos(t), 2.0 * math.cos(2 * t)
	yaw = math.degrees(math.atan2(dy, dx))
	handle('/phonetwin/state', [1, 1, 0, len(SIM_OBJECTS)], True)
	handle('/phonetwin/scan', ['simulation'], True)
	handle('/phonetwin/pos', [x, y, 1.2], True)
	handle('/phonetwin/dir', [math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0.0, yaw], True)
	best = (1e9, -1, '')
	for i, (oid, name, label, cx, cy, cz, r) in enumerate(SIM_OBJECTS):
		floor = max(0.0, math.hypot(x - cx, y - cy) - r) * 100
		hand = max(0.0, math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (1.2 - cz) ** 2) - r) * 100
		handle('/phonetwin/object', [i, oid, name, label, floor, hand, cx, cy, cz, r * 100], True)
		if hand < best[0]:
			best = (hand, oid, name)
	d = best[0]
	inten = 0.0 if d >= 30 else min(1.0, (30 - d) / 27)
	handle('/phonetwin/nearest', [best[1] if d < 30 else -1, d if d < 30 else -1, inten, 1 if d <= 3 else 0, best[2] if d < 30 else ''], True)


def _clamp01(v):
	return 0.0 if v < 0 else 1.0 if v > 1 else v


def tick():
	"""Every frame (frame_exec): simulator, proximity, tables, signals CHOP, map, OSC out."""
	if S is None:
		reset()
	c = comp()
	now = absTime.seconds
	dt = 0.0 if S['lastTick'] is None else max(0.0, min(0.25, now - S['lastTick']))
	S['lastTick'] = now
	S['live'] = now - S['last'] < 1.0
	if not S['live']:
		if c.par.Simulate.eval():
			S['sim'] = True
			simulate(now)
		elif S['sim'] or S['active']:
			last, msgs = S['last'], S['msgs']
			reset()
			S['last'], S['msgs'] = last, msgs

	rng = max(1.0, float(c.par.Proxrange.eval()))
	for o in S['objects'].values():
		o['prox'] = _clamp01(1.0 - o['cm'] / rng) if S['active'] else 0.0

	_tables()
	_monitor()
	for name in ('signals', 'map'):
		o = op(name)
		if o is not None:
			o.cook(force=True)

	S['sendAcc'] += dt
	rate = max(1.0, float(c.par.Outrate.eval()))
	if S['sendAcc'] >= 1.0 / rate:
		S['sendAcc'] %= 1.0 / rate
		if c.par.Outactive.eval():
			_send()


def closest():
	"""(index, object) with the smallest floor distance, or (-1, None)."""
	best = (-1, None)
	for i, o in sorted(S['objects'].items()):
		if best[1] is None or o['cm'] < best[1]['cm']:
			best = (i, o)
	return best


def signals():
	"""Numbers for the 'signals' Script CHOP (one channel each)."""
	sig = {}
	sig['active'] = S['active']
	sig['live'] = 1 if S['live'] else 0
	sig['sim'] = 1 if S['sim'] and not S['live'] else 0
	sig['source'] = S['source']
	sig['tx'], sig['ty'], sig['tz'] = S['pos']
	sig['heading'] = S['yaw']
	sig['vx'], sig['vy'], sig['vz'] = S['vel']
	sig['speed'] = S['speed']
	sig['accel'] = S['accel']
	sig['energy'] = _clamp01(S['speed'] / 1.2) if S['active'] else 0.0
	sig['moving'] = 1 if S['active'] and S['speed'] > 0.15 else 0
	sig['haptic'] = S['near_int'] if S['active'] else 0.0
	sig['contact'] = S['near_contact'] if S['active'] else 0
	i, o = closest()
	sig['closest_index'] = i
	sig['closest_prox'] = o['prox'] if o else 0.0
	sig['closest_cm'] = o['cm'] if o else -1.0
	for k, o in sorted(S['objects'].items()):
		sig['obj%d_prox' % k] = o['prox']
		sig['obj%d_cm' % k] = o['cm']
		sig['obj%d_approach' % k] = o['approach'] if S['active'] else 0.0
	return sig


def _tables():
	t = op('audience')
	if t is not None:
		src = '휴대폰' if S['source'] == 0 else 'ESP32'
		mode = '실시간' if S['live'] else ('시뮬레이션' if S['sim'] else '신호 없음')
		rows = [['name', 'value'], ['mode', mode], ['active', S['active']], ['walk', S['walk']], ['source', src], ['scan', S['scan']],
		        ['x_m', '%.3f' % S['pos'][0]], ['y_m', '%.3f' % S['pos'][1]], ['z_m', '%.3f' % S['pos'][2]],
		        ['heading_deg', '%.1f' % S['yaw']], ['speed_mps', '%.3f' % S['speed']],
		        ['nearest_id', S['near_id']], ['nearest_name', S['near_name']], ['nearest_cm', '%.1f' % S['near_cm']],
		        ['haptic', '%.3f' % S['near_int']], ['contact', S['near_contact']], ['osc_messages', S['msgs']]]
		t.clear()
		for r in rows:
			t.appendRow(r)
	t = op('objects')
	if t is not None:
		t.clear()
		t.appendRow(['index', 'id', 'name', 'label', 'floor_cm', 'hand_cm', 'proximity', 'approach_cmps', 'cx', 'cy', 'cz', 'radius_cm'])
		for k, o in sorted(S['objects'].items()):
			t.appendRow([k, o['id'], o['name'], o['label'], '%.1f' % o['cm'], '%.1f' % o['hand'], '%.3f' % o.get('prox', 0.0),
			             '%.1f' % o['approach'], '%.2f' % o['c'][0], '%.2f' % o['c'][1], '%.2f' % o['c'][2], '%.0f' % o['r']])


def _monitor():
	c = comp()
	mode = '실시간 (언리얼 OSC)' if S['live'] else ('시뮬레이션 — 언리얼 신호 없음' if S['sim'] else '신호 없음 — 언리얼 Play를 누르세요')
	lines = ['PHONE TWIN · TouchDesigner',
	         '입력: OSC :%d  ·  %s' % (int(c.par.Inport.eval()), mode),
	         '출력: OSC → %s:%d %s' % (c.par.Outhost.eval(), int(c.par.Outport.eval()), '' if c.par.Outactive.eval() else '(꺼짐)')]
	if not S['active']:
		lines.append('대기 중 — 휴대폰에서 "걷기 테스트 시작"을 누르면 시작합니다')
	else:
		lines.append('관객 (%s)  x %.2f  y %.2f  z %.2f m  ·  %.2f m/s' % ('휴대폰' if S['source'] == 0 else 'ESP32', S['pos'][0], S['pos'][1], S['pos'][2], S['speed']))
		if S['near_cm'] >= 0:
			lines.append('진동: %s %.1f cm · 세기 %d%%%s' % (S['near_name'], S['near_cm'], round(S['near_int'] * 100), ' · 접촉' if S['near_contact'] else ''))
		for k, o in sorted(S['objects'].items()):
			bar = '█' * int(round(o['prox'] * 10))
			lines.append('%2d %-10s %6.0f cm  %-10s %+6.0f cm/s' % (k, o['name'][:10], o['cm'], bar, o['approach']))
	text = '\n'.join(lines)
	m = op('monitor')
	if m is not None and m.text != text:
		m.text = text
	v = op('status_view')
	if v is not None:
		try:
			v.par.text = text
		except Exception:
			pass


def _send():
	out = op('osc_out')
	if out is None:
		return
	send = out.sendOSC
	act = 1 if S['active'] else 0
	send('/td/state', [act, 1 if S['live'] else 0, 1 if (S['sim'] and not S['live']) else 0, len(S['objects'])])
	if not act:
		return
	p, v = S['pos'], S['vel']
	send('/td/audience', [p[0], p[1], p[2], S['speed'], S['yaw']])
	send('/td/velocity', [v[0], v[1], v[2], S['accel']])
	send('/td/energy', [_clamp01(S['speed'] / 1.2)])
	i, o = closest()
	if o:
		send('/td/nearest', [i, o['id'], o['prox'], o['cm'], o['name']])
	prox = []
	for k, o in sorted(S['objects'].items()):
		send('/td/object/%d' % k, [o['prox'], o['cm'], o['approach'], o['id'], o['name']])
		prox.append(o['prox'])
	if prox:
		send('/td/proximity', prox)


def draw_map(size=512):
	"""Top view (Script TOP): grid 1 m, A, objects (filled by proximity), lines to the audience, trail, audience + heading."""
	import numpy as np
	W = H = int(size)
	img = np.zeros((H, W, 4), np.float32)
	img[..., 0], img[..., 1], img[..., 2], img[..., 3] = 0.035, 0.05, 0.075, 1.0
	objs = [o for _, o in sorted(S['objects'].items())]
	act = S['active']
	xs, ys = [0.0], [0.0]
	for o in objs:
		r = o['r'] / 100
		xs += [o['c'][0] - r, o['c'][0] + r]
		ys += [o['c'][1] - r, o['c'][1] + r]
	if act:
		xs.append(S['pos'][0])
		ys.append(S['pos'][1])
	cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
	ext = max(max(xs) - min(xs), max(ys) - min(ys), 3.0) * 1.2
	sc = W / ext

	def px(x, y):
		return (x - cx) * sc + W / 2, (y - cy) * sc + H / 2   # row 0 is the bottom in TouchDesigner: +Y is up

	def blend(x0, x1, y0, y1, mask_fn, color, alpha):
		x0, x1, y0, y1 = max(0, int(x0)), min(W, int(x1) + 1), max(0, int(y0)), min(H, int(y1) + 1)
		if x0 >= x1 or y0 >= y1:
			return
		yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
		m = mask_fn(xx, yy)
		sub = img[y0:y1, x0:x1, :3]
		sub[m] = sub[m] * (1 - alpha) + np.array(color, np.float32) * alpha

	def disc(x, y, rp, color, alpha=1.0):
		X, Y = px(x, y)
		blend(X - rp, X + rp, Y - rp, Y + rp, lambda xx, yy: (xx - X) ** 2 + (yy - Y) ** 2 <= rp * rp, color, alpha)

	def ring(x, y, rp, w, color, alpha=1.0):
		X, Y = px(x, y)
		blend(X - rp - w, X + rp + w, Y - rp - w, Y + rp + w, lambda xx, yy: np.abs(np.sqrt((xx - X) ** 2 + (yy - Y) ** 2) - rp) <= w, color, alpha)

	def line(x0, y0, x1, y1, color, alpha=1.0, w=1):
		X0, Y0 = px(x0, y0)
		X1, Y1 = px(x1, y1)
		n = int(max(abs(X1 - X0), abs(Y1 - Y0))) + 1
		xs_ = np.clip(np.linspace(X0, X1, n).astype(int), 0, W - 1)
		ys_ = np.clip(np.linspace(Y0, Y1, n).astype(int), 0, H - 1)
		for d in range(-(w // 2), w // 2 + 1):
			yy = np.clip(ys_ + d, 0, H - 1)
			img[yy, xs_, :3] = img[yy, xs_, :3] * (1 - alpha) + np.array(color, np.float32) * alpha

	# 1 m grid
	for gx in range(int(math.floor(cx - ext / 2)), int(math.ceil(cx + ext / 2)) + 1):
		X = int(px(gx, 0)[0])
		if 0 <= X < W:
			img[:, X, :3] = (0.09, 0.13, 0.17) if gx else (0.15, 0.3, 0.2)
	for gy in range(int(math.floor(cy - ext / 2)), int(math.ceil(cy + ext / 2)) + 1):
		Y = int(px(0, gy)[1])
		if 0 <= Y < H:
			img[Y, :, :3] = (0.09, 0.13, 0.17) if gy else (0.15, 0.3, 0.2)
	disc(0, 0, 5, (0.2, 0.83, 0.4))   # floor mark A

	rng = max(1.0, float(comp().par.Proxrange.eval())) / 100
	near_id = S['near_id'] if act else None
	for o in objs:
		r = max(3.0, o['r'] / 100 * sc)
		pr = o.get('prox', 0.0)
		hot = o['id'] == near_id
		disc(o['c'][0], o['c'][1], r, (0.98, 0.8, 0.08), 0.12 + 0.6 * pr)
		ring(o['c'][0], o['c'][1], r, 1.2, (1.0, 0.25, 0.15) if hot else (0.98, 0.8, 0.08))
		if act and pr > 0:
			line(S['pos'][0], S['pos'][1], o['c'][0], o['c'][1], (1.0, 0.75 - 0.5 * pr, 0.2), 0.35 + 0.65 * pr, 1 + int(pr * 3))
	if act:
		tr = S['trail']
		for j in range(1, len(tr)):
			line(tr[j - 1][0], tr[j - 1][1], tr[j][0], tr[j][1], (0.13, 0.83, 0.93), 0.15 + 0.5 * j / len(tr))
		x, y = S['pos'][0], S['pos'][1]
		ring(x, y, rng * sc, 1.0, (0.13, 0.83, 0.93), 0.25)   # Proxrange
		h = math.radians(S['yaw'])
		line(x, y, x + 0.45 * math.cos(h), y + 0.45 * math.sin(h), (1, 1, 1), 1.0, 2)
		disc(x, y, 9, (0.13, 0.83, 0.93))
		if S['near_contact']:
			ring(x, y, 14, 2, (1.0, 0.2, 0.15))
	return img
