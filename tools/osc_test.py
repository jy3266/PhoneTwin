"""Phone Twin OSC tester — no extra packages.

  py tools/osc_test.py send   [--target 127.0.0.1:7000] [--seconds 10]   act like Unreal: walk an audience past 3 objects
  py tools/osc_test.py listen [--port 7001] [--seconds 10]                print what TouchDesigner sends (/td/...)
  py tools/osc_test.py both   [--seconds 6]                               send to :7000 and listen on :7001 at once

The addresses are the ones in PROTOCOL.md §4 (Unreal -> TouchDesigner) and touchdesigner/README.md (TouchDesigner -> out).
"""
import argparse
import math
import socket
import struct
import threading
import time

OBJECTS = [(1, '의자', 'chair', 1.0, 0.8, 0.45, 35.0), (2, '화분', 'potted plant', 2.5, -0.7, 0.4, 30.0), (100, '노트북', 'laptop', 3.0, 1.0, 0.8, 20.0)]


def _pad(b):
	return b + b'\0' * (4 - len(b) % 4)


def encode(address, *args):
	tags, data = ',', b''
	for a in args:
		if isinstance(a, bool) or isinstance(a, int):
			tags += 'i'
			data += struct.pack('>i', int(a))
		elif isinstance(a, float):
			tags += 'f'
			data += struct.pack('>f', a)
		else:
			tags += 's'
			data += _pad(str(a).encode('utf-8'))
	return _pad(address.encode()) + _pad(tags.encode()) + data


def _string(b, i):
	j = b.index(b'\0', i)
	return b[i:j].decode('utf-8', 'replace'), (j // 4 + 1) * 4


def decode(b):
	"""-> list of (address, args); bundles are flattened."""
	if b.startswith(b'#bundle\0'):
		out, i = [], 16
		while i + 4 <= len(b):
			n = struct.unpack('>i', b[i:i + 4])[0]
			out += decode(b[i + 4:i + 4 + n])
			i += 4 + n
		return out
	addr, i = _string(b, 0)
	tags, i = _string(b, i)
	args = []
	for t in tags[1:]:
		if t == 'i':
			args.append(struct.unpack('>i', b[i:i + 4])[0]); i += 4
		elif t == 'f':
			args.append(round(struct.unpack('>f', b[i:i + 4])[0], 3)); i += 4
		elif t == 'd':
			args.append(round(struct.unpack('>d', b[i:i + 8])[0], 3)); i += 8
		elif t == 'h':
			args.append(struct.unpack('>q', b[i:i + 8])[0]); i += 8
		elif t == 's':
			s, i = _string(b, i); args.append(s)
		elif t in 'TF':
			args.append(t == 'T')
	return [(addr, args)]


def send(target, seconds, verbose=True):
	host, port = target.split(':')
	s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
	t0 = time.time()
	n = 0
	while time.time() - t0 < seconds:
		t = (time.time() - t0) * 0.5
		x, y = 1.8 + 1.4 * math.sin(t), 0.9 * math.sin(2 * t)
		msgs = [encode('/phonetwin/state', 1, 1, 0, len(OBJECTS)), encode('/phonetwin/scan', 'osc_test'),
		        encode('/phonetwin/pos', x, y, 1.25), encode('/phonetwin/dir', 1.0, 0.0, 0.0, 0.0)]
		best = (1e9, -1, '')
		for i, (oid, name, label, cx, cy, cz, r) in enumerate(OBJECTS):
			floor = max(0.0, math.hypot(x - cx, y - cy) * 100 - r)
			msgs.append(encode('/phonetwin/object', i, oid, name, label, floor, floor, cx, cy, cz, r))
			best = min(best, (floor, oid, name))
		msgs.append(encode('/phonetwin/nearest', best[1] if best[0] < 30 else -1, best[0] if best[0] < 30 else -1.0, max(0.0, 1 - best[0] / 30), 0, best[2]))
		for m in msgs:
			s.sendto(m, (host, int(port)))
		n += 1
		if verbose and n % 30 == 0:
			print('sent frame %d  pos %.2f %.2f' % (n, x, y))
		time.sleep(1 / 30)
	for _ in range(3):   # stop: inactive
		s.sendto(encode('/phonetwin/state', 0, 0, 0, len(OBJECTS)), (host, int(port)))
	return n


def listen(port, seconds, quiet=False):
	s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
	s.bind(('0.0.0.0', port))
	s.settimeout(0.5)
	t0, seen, last = time.time(), {}, {}
	while time.time() - t0 < seconds:
		try:
			data, _ = s.recvfrom(65536)
		except socket.timeout:
			continue
		for addr, args in decode(data):
			seen[addr] = seen.get(addr, 0) + 1
			last[addr] = args
			if not quiet and seen[addr] % 30 == 1:
				print(addr, args)
	print('--- received (address: count, last value)')
	for a in sorted(seen):
		print('%-16s %5d  %s' % (a, seen[a], last[a]))
	return seen, last


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument('mode', choices=['send', 'listen', 'both'])
	ap.add_argument('--target', default='127.0.0.1:7000')
	ap.add_argument('--port', type=int, default=7001)
	ap.add_argument('--seconds', type=float, default=10)
	a = ap.parse_args()
	if a.mode == 'send':
		send(a.target, a.seconds)
	elif a.mode == 'listen':
		listen(a.port, a.seconds)
	else:
		th = threading.Thread(target=send, args=(a.target, a.seconds, False), daemon=True)
		th.start()
		listen(a.port, a.seconds + 1, quiet=True)


if __name__ == '__main__':
	main()
