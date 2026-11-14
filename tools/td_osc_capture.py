"""Listen on OSC :7000 like TouchDesigner, decode what Unreal sends, and run it through the real td_core.py
(the text of the phonetwin_core DAT) with small stand-ins for the TD globals. Prints a report."""
import socket, struct, sys, time, types, collections, traceback, json

TD_CORE = sys.argv[1]
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 20
PORT = 7000

# ---------------------------------------------------------------- OSC decode
def _str(b, i):
    j = b.index(b'\0', i)
    s = b[i:j].decode('utf-8', 'replace')
    return s, (j + 4) & ~3

def decode(b):
    if b.startswith(b'#bundle'):
        out, i = [], 16
        while i < len(b):
            n = struct.unpack('>i', b[i:i + 4])[0]
            out += decode(b[i + 4:i + 4 + n]); i += 4 + n
        return out
    addr, i = _str(b, 0)
    tags, i = _str(b, i)
    args = []
    for t in tags[1:]:
        if t == 'i': args.append(struct.unpack('>i', b[i:i + 4])[0]); i += 4
        elif t == 'f': args.append(struct.unpack('>f', b[i:i + 4])[0]); i += 4
        elif t == 's': s, i = _str(b, i); args.append(s)
        else: raise ValueError('tag ' + t)
    return [(addr, tags, args)]

# ---------------------------------------------------------------- td_core with stand-ins
class Par:
    def __init__(self, v): self.v = v
    def eval(self): return self.v
PARS = dict(Smoothing=0.15, Simulate=False, Proxrange=200, Outrate=30, Outactive=True, Inport=7000,
            Outhost='127.0.0.1', Outport=7001, Trailfade=6.0, Trailwidth=14.0, Trailglow=1.0)
comp = types.SimpleNamespace(par=types.SimpleNamespace(**{k: Par(v) for k, v in PARS.items()}))
me = types.SimpleNamespace(parent=lambda: comp)
clock = types.SimpleNamespace(seconds=0.0)
sent = collections.Counter(); sent_last = {}
class Out:
    def sendOSC(self, a, args): sent[a.split('/')[2] if a.startswith('/td/object/') and False else a] += 1; sent_last[a] = list(args)
def op(name):
    return Out() if name == 'osc_out' else None
g = {'me': me, 'absTime': clock, 'op': op, '__name__': 'phonetwin_core'}
exec(compile(open(TD_CORE, encoding='utf-8').read(), TD_CORE, 'exec'), g)

# what td_core.handle reads: address -> (min args, types it casts)
EXPECT = {'/phonetwin/state': 'iiii', '/phonetwin/scan': 's', '/phonetwin/pos': 'fff', '/phonetwin/dir': 'ffff',
          '/phonetwin/nearest': 'iffis', '/phonetwin/object': 'iissffffff', '/phonetwin/touch': 'iisf', '/phonetwin/input': 'isf', '/phonetwin/uwb': 'fii', '/phonetwin/look': 'iis', '/phonetwin/marks': 'ffffi', '/phonetwin/shape': 'iffffi'}

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('0.0.0.0', PORT)); sock.settimeout(0.01)
got = collections.Counter(); tagset = collections.defaultdict(set); sample = {}; bad = []; errors = []
touches = []; states = collections.Counter(); sources = collections.Counter(); scans = set(); maxobj = 0
t0 = time.monotonic(); last_tick = 0; first = None
print(f'listening OSC :{PORT} for {SECONDS:.0f}s', flush=True)
while time.monotonic() - t0 < SECONDS:
    clock.seconds = time.monotonic()
    try:
        data, _ = sock.recvfrom(65535)
        for addr, tags, args in decode(data):
            if first is None: first = time.monotonic() - t0
            got[addr] += 1; tagset[addr].add(tags); sample[addr] = args
            exp = EXPECT.get(addr)
            if exp is None: bad.append(('unknown address', addr, tags))
            elif tags[1:len(exp) + 1] != exp: bad.append(('types', addr, tags, exp))
            if addr == '/phonetwin/touch': touches.append(args + [args[2].encode('utf-8').hex()])
            if addr == '/phonetwin/nearest' and args[4] and 'name_hex' not in sample: sample['name_hex'] = [args[4], args[4].encode('utf-8').hex()]
            if addr == '/phonetwin/state': states[(args[0], args[1])] += 1; sources[args[2]] += 1; maxobj = max(maxobj, args[3])
            if addr == '/phonetwin/scan': scans.add(args[0])
            try: g['handle'](addr, args)
            except Exception: errors.append(traceback.format_exc())
    except socket.timeout:
        pass
    if clock.seconds - last_tick > 1 / 30:
        last_tick = clock.seconds
        try: g['tick']()
        except Exception: errors.append(traceback.format_exc())

S = g['S']
rep = dict(first_message_after_s=first, received=dict(got), type_tags={k: sorted(v) for k, v in tagset.items()},
           mismatches=bad[:10], td_errors=errors[:3], states_tracking_walk=dict((f'{a},{b}', n) for (a, b), n in states.items()),
           sources=dict(sources), scans=sorted(scans), object_count=maxobj, touches=touches[:8],
           td_state=dict(live=S['live'], active=S['active'], source=S['source'], scan=S['scan'], objects=len(S['objects']),
                         pos=[round(v, 3) for v in S['pos']], speed=round(S['speed'], 3), yaw=round(S['yaw'], 1),
                         near=[S['near_id'], round(S['near_cm'], 1), round(S['near_int'], 3), S['near_name']]),
           td_signals_sample={k: (round(v, 3) if isinstance(v, float) else v) for k, v in list(g['signals']().items())[:20]},
           td_sent={k: v for k, v in sent.items() if not k.startswith('/td/object/')}, td_object_addresses=len([k for k in sent if k.startswith('/td/object/')]),
           sample_args={k: v for k, v in sample.items()})
rep['td_extra'] = dict(input=g['source_name'](), look=S['look'], marks=S['marks'], uwb=S['uwb'], shapes=len(S['shapes']))
rep['monitor'] = None
import numpy as np
img = g['draw_map'](512)
from PIL import Image
Image.fromarray((np.clip(img[::-1, :, :3], 0, 1) * 255).astype('uint8')).save(sys.argv[3])
open(sys.argv[4], 'w', encoding='utf-8').write(json.dumps(rep, ensure_ascii=False, indent=1, default=str))
print('done')
