"""Pretend to be the phone (PTP1) or the ESP32 (PTE1) and walk around inside a scan, so the Unreal
side can be tested without devices. Prints the PTH1 haptic replies Unreal sends back. stdlib only.

    python tools/pose_sim.py --target 127.0.0.1                       # phone, walks the sample scan
    python tools/pose_sim.py --target 192.168.0.100 --mode esp32      # ESP32 (R frame)
    python tools/pose_sim.py --meta scans/my_scan.json --hz 60

Packets (PROTOCOL.md):
  PTP1,seq,valid,x,y,z,fx,fy,fz,ux,uy,uz,scanId      S frame: metres, Y up
  PTE1,seq,valid,x,y,z,yaw,pitch,roll                 R frame: metres, Z up, origin A, +X towards B
Replies expected on --listen-port:  PTH1,seq,valid,intensity,contact,objectId,distanceMm
"""
import argparse
import json
import math
import os
import socket
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_meta(path):
    if path and os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    return None


def s_to_r(meta):
    """Returns f(p_S) -> p_R using meta a/b (A origin, A->B = +X, Y_S up -> Z_R up), or None."""
    a, b = (meta or {}).get('a'), (meta or {}).get('b')
    if not a or not b:
        return None
    dx, dz = b[0] - a[0], b[2] - a[2]
    L = math.hypot(dx, dz) or 1.0
    ex = (dx / L, dz / L)                       # +X_R in the S floor plane (x,z)
    # S is right-handed with Y up; looking down from +Y, the left of ex (counter-clockwise) in (x,z) is (ex.z, -ex.x).
    ey = (ex[1], -ex[0])

    def f(p):
        vx, vz = p[0] - a[0], p[2] - a[2]
        return (vx * ex[0] + vz * ex[1], vx * ey[0] + vz * ey[1], p[1] - a[1])
    return f


def path_point(meta, t, radius):
    """A slow loop around the middle of the scan at hand height (S frame), plus the walking direction."""
    if meta and 'bounds' in meta:
        mn, mx = meta['bounds']['min'], meta['bounds']['max']
        cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
        floor = meta['a'][1] if meta.get('a') else mn[1]
        r = radius or 0.35 * min(mx[0] - mn[0], mx[2] - mn[2])
    else:
        cx, cz, floor, r = 0.0, 0.0, 0.0, radius or 1.0
    ang = t * 0.35
    p = (cx + r * math.cos(ang), floor + 1.2, cz + r * math.sin(ang))
    f = (-math.sin(ang), -0.15, math.cos(ang))
    n = math.sqrt(sum(c * c for c in f))
    return p, tuple(c / n for c in f)


def bar(i):
    n = round(i / 255 * 20)
    return '█' * n + '·' * (20 - n)


def main():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--target', default='127.0.0.1', help='Unreal PC IP')
    ap.add_argument('--port', type=int, default=7777)
    ap.add_argument('--mode', choices=['phone', 'esp32'], default='phone')
    ap.add_argument('--hz', type=float, default=30)
    ap.add_argument('--listen-port', type=int, default=None, help='PTH1 reply port (default 4211 phone / 4210 esp32)')
    ap.add_argument('--meta', default=os.path.join(ROOT, 'scans', 'sample_test_room.json'), help='scan meta json (bounds, a/b)')
    ap.add_argument('--radius', type=float, default=0, help='loop radius m (0 = from bounds)')
    ap.add_argument('--seconds', type=float, default=0, help='stop after N seconds (0 = forever)')
    a = ap.parse_args()

    meta = load_meta(a.meta)
    scan_id = (meta or {}).get('id', 'none')
    to_r = s_to_r(meta)
    if a.mode == 'esp32' and not to_r:
        print('경고: meta에 a/b가 없어 R 좌표 = S 좌표(Y↔Z 교체)로 보냅니다', file=sys.stderr)
    listen = a.listen_port or (4211 if a.mode == 'phone' else 4210)

    tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tx.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(('0.0.0.0', listen))
    rx.setblocking(False)
    print(f'{a.mode} → {a.target}:{a.port} at {a.hz:g} Hz · scan {scan_id} · PTH1 replies on :{listen}  (Ctrl+C to stop)')

    seq, t0, last_print, last_reply = 0, time.time(), 0.0, '응답 없음'
    period = 1.0 / a.hz
    try:
        while True:
            now = time.time()
            t = now - t0
            if a.seconds and t > a.seconds:
                break
            p, f = path_point(meta, t, a.radius)
            seq += 1
            if a.mode == 'phone':
                msg = f'PTP1,{seq},1,{p[0]:.4f},{p[1]:.4f},{p[2]:.4f},{f[0]:.4f},{f[1]:.4f},{f[2]:.4f},0.0000,1.0000,0.0000,{scan_id}\n'
            else:
                if to_r:
                    r = to_r(p)
                    fr = to_r((p[0] + f[0], p[1] + f[1], p[2] + f[2]))
                    yaw = math.degrees(math.atan2(fr[1] - r[1], fr[0] - r[0]))
                else:
                    r, yaw = (p[0], p[2], p[1]), math.degrees(math.atan2(f[2], f[0]))
                pitch = math.degrees(math.asin(max(-1, min(1, f[1]))))
                msg = f'PTE1,{seq},1,{r[0]:.3f},{r[1]:.3f},{r[2]:.3f},{yaw:.1f},{pitch:.1f},0.0\n'
            tx.sendto(msg.encode('ascii'), (a.target, a.port))
            while True:
                try:
                    data, src = rx.recvfrom(256)
                except (BlockingIOError, ConnectionResetError):
                    break
                parts = data.decode('ascii', 'replace').strip().split(',')
                if parts[0] == 'PTH1' and len(parts) >= 7:
                    i, c, obj, mm = int(parts[3]), parts[4] == '1', int(parts[5]), int(parts[6])
                    last_reply = f'{bar(i)} {i:3d} {"▶접촉" if c else "     "} obj {obj:4d} {"" if mm < 0 else f"{mm / 1000:.2f}m"}  ← {src[0]}'
            if now - last_print > 0.2:
                last_print = now
                sys.stdout.write(f'\rseq {seq:6d}  pos {p[0]:+.2f} {p[1]:+.2f} {p[2]:+.2f}  |  {last_reply}   ')
                sys.stdout.flush()
            time.sleep(max(0.0, period - (time.time() - now)))
    except KeyboardInterrupt:
        pass
    print(f'\n보낸 패킷 {seq}개')


if __name__ == '__main__':
    main()
