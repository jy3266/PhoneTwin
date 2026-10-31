# Builds the Phone Twin network inside /project1 of a running TouchDesigner, saves the .toe and quits.
# Run by make_toe.ps1: TouchDesigner opens a bootstrap .toe whose Execute DAT exec()s this file on start.
#   PT_TD_OUT = .toe to write,  PT_TD_LOG = log file,  PT_TD_CORE = td_core.py (the network's Python module)
import os
import traceback

OUT = os.environ.get('PT_TD_OUT', '')
LOG_PATH = os.environ.get('PT_TD_LOG', '')
CORE = os.environ.get('PT_TD_CORE', os.path.join(os.path.dirname(__file__), 'td_core.py'))
LOG = []


def log(*a):
	LOG.append(' '.join(str(x) for x in a))


def write_log():
	if LOG_PATH:
		with open(LOG_PATH, 'w', encoding='utf-8') as f:
			f.write('\n'.join(LOG) + '\n')


def setp(o, name, value, expr=False):
	try:
		p = getattr(o.par, name)
		if expr:
			p.expr = value
			p.mode = ParMode.EXPRESSION
		else:
			p.val = value
	except Exception as e:
		log('PAR FAIL', o.path, name, repr(e))


def make(root, typ, name, x, y, text=None):
	o = root.create(typ, name)
	o.nodeX, o.nodeY = x, y
	if text is not None:
		o.text = text
	return o


def callbacks_for(root, o, text, x, y):
	"""Script/OSC operators may auto-create a docked '<name>_callbacks' DAT; reuse it or make one."""
	cb = root.op(o.name + '_callbacks')
	if cb is None:
		cb = make(root, textDAT, o.name + '_callbacks', x, y)
	cb.text = text
	cb.nodeX, cb.nodeY = x, y
	setp(o, 'callbacks', cb.name)
	return cb


OSC_IN_CB = '''# 언리얼이 보낸 OSC 한 줄마다 호출 -> phonetwin_core.handle()
def onReceiveOSC(dat, rowIndex, message, byteData, timeStamp, address, args, peer):
	op('phonetwin_core').module.handle(address, args)
	return
'''

FRAME_EXEC = '''# 매 프레임: 시뮬레이터, 근접도, 표, 신호 CHOP, 지도, OSC 송신
def onStart():
	op('phonetwin_core').module.reset()
	return

def onFrameEnd(frame):
	op('phonetwin_core').module.tick()
	return
'''

SIGNALS_CB = '''# phonetwin_core.signals() -> 채널 (값 1개짜리 CHOP). 다른 CHOP/TOP에서 op('signals_out')['speed'] 처럼 씁니다.
def onCook(scriptOp):
	scriptOp.clear()
	scriptOp.numSamples = 1
	for name, value in op('phonetwin_core').module.signals().items():
		scriptOp.appendChan(name)[0] = value
	return
'''

TRAIL_CB = '''# 빛 흔적: 관객이 걸은 길이 빛으로 남았다가 천천히 사라짐 (Trailfade 초마다 반으로), 닿은 곳은 따뜻한 빛 물결
def onCook(scriptOp):
	scriptOp.copyNumpyArray(op('phonetwin_core').module.draw_trail())
	return
'''

MAP_CB = '''# 위에서 본 지도: 격자 1 m, 바닥 표시 A(초록), 사물(노랑, 가까울수록 진하게), 관객(하늘색)과 진행 방향
def onCook(scriptOp):
	scriptOp.copyNumpyArray(op('phonetwin_core').module.draw_map(512))
	return
'''

README = '''PHONE TWIN · TouchDesigner (OSC 입·출력)

[흐름]
 휴대폰(ARCore) / ESP32(UWB+IMU) → 언리얼 ARKO_PROJECT(거리 계산) → OSC :7000 → 이 TouchDesigner
 → 움직임 신호(속도·방향·사물별 근접도·다가오는 속도) → OSC :7001 (다른 프로그램/장치로)

[쓰는 법]
 1. 이 파일을 열고, 언리얼에서 Play. (언리얼 Details > Phone Twin|OSC: Send Osc 켬, 127.0.0.1:7000)
 2. 휴대폰에서 "걷기 테스트 시작" → 오른쪽 지도에 관객(하늘색)이 움직이고 표(audience, objects)가 바뀝니다.
 3. 신호는 signals_out CHOP(채널) 과 OSC 출력(/td/...) 두 가지로 씁니다.
 4. 설정은 project1의 PhoneTwin 파라미터 페이지: 입력 포트, 출력 주소·포트·속도, 근접 범위(cm), 부드럽게(초), 시뮬레이션.
    시뮬레이션이 켜져 있으면 언리얼 신호가 1초 이상 없을 때 가짜 관객이 걸어 다닙니다(전시 때는 끄세요).

[받는 OSC]  좌표: m, 원점 = 바닥 표시 A, +X = B 쪽, +Y = 왼쪽, +Z = 위
 /phonetwin/state    active walk source(0 휴대폰,1 ESP32) objectCount
 /phonetwin/scan     scanId
 /phonetwin/pos      x y z
 /phonetwin/dir      fx fy fz yaw
 /phonetwin/nearest  id distCm intensity contact name   (진동 기준, -1 = 범위 밖)
 /phonetwin/object   index id name label floorCm handCm cx cy cz radiusCm

[보내는 OSC]
 /td/state      active live sim objectCount
 /td/audience   x y z speed(m/s) heading(도)
 /td/velocity   vx vy vz accel
 /td/energy     0~1 (걷는 속도, 1.2 m/s = 1)
 /td/nearest    index id proximity floorCm name
 /td/object/<i> proximity(0~1) floorCm approach(cm/s, 다가오면 +) id name
 /td/proximity  모든 사물의 proximity (index 순서)
 /td/touch      index id name strength   (관객이 사물에 닿은 순간)

[빛 흔적]
 trail_out TOP = 관객이 걸어온 길이 빛으로 남는 영상(검은 배경). 프로젝터·화면에 그대로 내보내면 됩니다.
 오른쪽 지도(map_light)에도 겹쳐 보입니다. 설정: Trailfade(사라지는 속도), Trailwidth(굵기), Trailglow(밝기).
 색은 천천히 청록↔보라로 흐르고, 사물에 가까워질수록 따뜻한 금빛, 빨리 걸을수록 밝아집니다. 닿으면 금빛 물결.

[signals_out 채널]
 active live sim source tx ty tz heading vx vy vz speed accel energy moving haptic contact
 closest_index closest_prox closest_cm  obj<i>_prox  obj<i>_cm  obj<i>_approach
'''


def build():
	root = op('/project1')
	for c in list(root.children):
		if c.valid and c.name != 'bootstrap':   # destroying an operator also removes its docked callbacks DAT
			c.destroy()

	# ---- settings as custom parameters on /project1
	for p in list(root.customPages):
		if p.name == 'PhoneTwin':
			p.destroy()
	page = root.appendCustomPage('PhoneTwin')
	def par(kind, name, label, default, **kw):
		p = getattr(page, 'append' + kind)(name, label=label)[0]
		if default is not None:
			p.default = default
			p.val = default
		for k, v in kw.items():
			setattr(p, k, v)
		return p
	par('Int', 'Inport', 'OSC 입력 포트 (언리얼 → TD)', 7000)
	par('Str', 'Outhost', 'OSC 출력 주소', '127.0.0.1')
	par('Int', 'Outport', 'OSC 출력 포트', 7001)
	par('Toggle', 'Outactive', 'OSC 출력 켜기', True)
	par('Float', 'Outrate', 'OSC 출력 속도 (Hz)', 30.0, normMin=1, normMax=60, min=1, clampMin=True)
	par('Float', 'Proxrange', '근접 범위 (cm, 이 거리에서 0 → 붙으면 1)', 200.0, normMin=20, normMax=600, min=1, clampMin=True)
	par('Float', 'Smoothing', '부드럽게 (초)', 0.15, normMin=0, normMax=1, min=0, clampMin=True)
	par('Toggle', 'Simulate', '신호 없을 때 시뮬레이션', True)
	par('Float', 'Trailfade', '빛 흔적: 반으로 어두워지는 시간 (초)', 6.0, normMin=0.5, normMax=60, min=0.2, clampMin=True)
	par('Float', 'Trailwidth', '빛 흔적: 굵기 (cm)', 14.0, normMin=2, normMax=60, min=1, clampMin=True)
	par('Float', 'Trailglow', '빛 흔적: 밝기', 1.0, normMin=0, normMax=3, min=0, clampMin=True)

	core_text = open(CORE, encoding='utf-8').read()

	make(root, textDAT, 'README', -600, 300, README)
	core = make(root, textDAT, 'phonetwin_core', -400, 300, core_text)

	osc_in = make(root, oscinDAT, 'osc_in', -600, 100)
	setp(osc_in, 'port', 'parent().par.Inport', expr=True)
	setp(osc_in, 'maxlines', 30)
	callbacks_for(root, osc_in, OSC_IN_CB, -600, -60)

	fx = make(root, executeDAT, 'frame_exec', -400, 100, FRAME_EXEC)
	setp(fx, 'start', True)
	setp(fx, 'frameend', True)
	setp(fx, 'active', True)

	make(root, tableDAT, 'audience', -200, 300)
	make(root, tableDAT, 'objects', -200, 100)
	make(root, textDAT, 'monitor', -200, -100)

	sig = make(root, scriptCHOP, 'signals', 0, 300)
	callbacks_for(root, sig, SIGNALS_CB, 0, 460)
	sig_out = make(root, nullCHOP, 'signals_out', 200, 300)
	sig_out.inputConnectors[0].connect(sig)

	mp = make(root, scriptTOP, 'map', 0, 100)
	callbacks_for(root, mp, MAP_CB, 0, -60)

	sv = make(root, textTOP, 'status_view', 0, -220)
	setp(sv, 'resolutionw', 640)
	setp(sv, 'resolutionh', 512)
	setp(sv, 'outputresolution', 'custom')
	setp(sv, 'font', 'Malgun Gothic')
	setp(sv, 'fontsizex', 17)
	setp(sv, 'alignx', 'left')
	setp(sv, 'aligny', 'top')
	setp(sv, 'bgcolorr', 0.035)
	setp(sv, 'bgcolorg', 0.05)
	setp(sv, 'bgcolorb', 0.075)
	setp(sv, 'bgalpha', 1)
	setp(sv, 'positionx', 16)
	setp(sv, 'positiony', -16)

	lay = make(root, layoutTOP, 'layout', 200, 0)
	# light trail: numpy trace (light_trail) -> blur halo -> added together = glow; the map view gets the glow on top
	lt = make(root, scriptTOP, 'light_trail', 0, -400)
	callbacks_for(root, lt, TRAIL_CB, 0, -560)
	blur = make(root, blurTOP, 'trail_blur', 200, -480)
	blur.inputConnectors[0].connect(lt)
	setp(blur, 'size', 24)
	glow = make(root, compositeTOP, 'trail_glow', 400, -400)
	glow.inputConnectors[0].connect(lt)
	glow.inputConnectors[1].connect(blur)
	setp(glow, 'operand', 'add')
	trail_out = make(root, nullTOP, 'trail_out', 600, -400)
	trail_out.inputConnectors[0].connect(glow)
	ml = make(root, compositeTOP, 'map_light', 200, 160)
	ml.inputConnectors[0].connect(mp)
	ml.inputConnectors[1].connect(glow)
	setp(ml, 'operand', 'add')
	lay.inputConnectors[0].connect(ml)
	lay.inputConnectors[1].connect(sv)
	setp(lay, 'outputresolution', 'custom')
	setp(lay, 'resolutionw', 1152)
	setp(lay, 'resolutionh', 512)
	out1 = make(root, nullTOP, 'out1', 400, 0)
	out1.inputConnectors[0].connect(lay)
	setp(root, 'top', 'out1')

	osc_out = make(root, oscoutDAT, 'osc_out', 200, 100)
	setp(osc_out, 'address', 'parent().par.Outhost', expr=True)
	setp(osc_out, 'port', 'parent().par.Outport', expr=True)

	out1.viewer = True
	mp.viewer = True
	for o in (core, osc_in, fx):
		o.viewer = False

	# record parameter names so a wrong name above shows up in the log
	for o in (osc_in, osc_out, fx, sig, mp, sv, lay, lt, blur, glow, ml):
		log('PARS', o.path, o.OPType, ' '.join(p.name for p in o.pars()))
	for o in root.children:
		log('OP', o.path, o.OPType, 'errors=' + repr(o.errors()), 'warnings=' + repr(o.warnings()))


def finish_check():
	# after a few frames: did the network cook without errors?
	root = op('/project1')
	for o in root.children:
		e = o.errors(recurse=False) if hasattr(o, 'errors') else ''
		if e:
			log('COOK ERROR', o.path, e)
	m = root.op('monitor')
	log('MONITOR', m.text if m else '(none)')
	s = root.op('signals_out')
	if s is not None:
		log('CHANNELS', ' '.join('%s=%.3g' % (c.name, c[0]) for c in s.chans()))
	t = root.op('objects')
	if t is not None:
		log('OBJECTS rows', t.numRows)
	snap = os.environ.get('PT_TD_SNAP', '')
	if snap and root.op('out1') is not None:
		root.op('out1').save(snap)
		log('SNAPSHOT', snap)


def save_and_quit():
	try:
		op('/').unstore('pt_finish')
		finish_check()
		b = op('/project1/bootstrap')
		if b is not None:
			b.destroy()
		if OUT:
			project.save(OUT)
			log('SAVED', OUT)
	except Exception:
		log('SAVE ERROR', traceback.format_exc())
	write_log()
	project.quit(force=True)


try:
	build()
	log('BUILD OK')
except Exception:
	log('BUILD ERROR', traceback.format_exc())
write_log()
# let the network run ~1.5 s (simulator on), then check, save and quit
op('/').store('pt_finish', save_and_quit)
run("op('/').fetch('pt_finish')()", delayFrames=90)
