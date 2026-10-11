"""PhoneTwin v1: metres in a calibrated UE-aligned frame; OSC output in cm."""
import json
import math
import struct


def vector(value, limit):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError('vector must contain three numbers')
    if any(type(x) not in (int, float) or not math.isfinite(x) or abs(x) > limit for x in value):
        raise ValueError('invalid vector')
    return [float(x) for x in value]


def decode(raw):
    if not isinstance(raw, str) or len(raw) > 4096:
        raise ValueError('text pose required')
    d = json.loads(raw)
    if not isinstance(d, dict) or d.get('v') != 1 or d.get('type') != 'pose':
        raise ValueError('wrong protocol')
    for k in ('seq', 'epoch', 't_ns'):
        if type(d.get(k)) is not int or d[k] < 0 or d[k] > 2**63-1:
            raise ValueError('invalid counter')
    if type(d.get('valid')) is not bool:
        raise ValueError('valid must be boolean')
    if not isinstance(d.get('session'), str) or not 1 <= len(d['session']) <= 64:
        raise ValueError('invalid session')
    p, f, u = vector(d.get('p'), 100), vector(d.get('forward'), 1.01), vector(d.get('up'), 1.01)
    if abs(sum(x*x for x in f)-1) > .03 or abs(sum(x*x for x in u)-1) > .03 or abs(sum(x*y for x, y in zip(f, u))) > .03:
        raise ValueError('invalid orientation basis')
    return dict(v=1, type='pose', session=d['session'], epoch=d['epoch'], seq=d['seq'],
                t_ns=d['t_ns'], valid=d['valid'], reason=str(d.get('reason', ''))[:80], p=p, forward=f, up=u)


def osc_string(s):
    b = s.encode('ascii') + b'\0'
    return b + b'\0' * ((-len(b)) % 4)


def osc_pose(pose, valid):
    # ALL arguments are OSC float32, including tracking_valid.
    values = [v*100 for v in pose['p']] + [1.0 if valid else 0.0] + pose['forward'] + pose['up']
    return osc_string('/phone/pose') + osc_string(','+'f'*10) + struct.pack('>10f', *values)


def empty_pose():
    return dict(v=1, type='pose', session='', epoch=0, seq=0, t_ns=0, valid=False,
                reason='WAITING', p=[0., 0., 0.], forward=[1., 0., 0.], up=[0., 0., 1.])
