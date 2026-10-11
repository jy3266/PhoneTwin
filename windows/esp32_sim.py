"""Pretend to be the ESP32 wristband: listen for the phone's UDP haptic packets, print them as a bar,
and answer with PTA1 so the app shows "ESP32 응답 OK".  Type this PC's IPv4 into the app's ESP32 field.

    python esp32_sim.py [--port 4210]
"""
import argparse
import socket
import time


def parse(line):
    t = line.strip().split(',')
    if len(t) != 7 or t[0] != 'PTH1':
        raise ValueError('not a PTH1 packet')
    seq, valid, level, contact, obj, mm = (int(x) for x in t[1:])
    if not 0 <= level <= 255 or valid not in (0, 1) or contact not in (0, 1):
        raise ValueError('out of range')
    return dict(seq=seq, valid=valid, level=level, contact=contact, obj=obj, mm=mm)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=4210)
    ap.add_argument('--once', action='store_true', help='exit after the first valid packet (for tests)')
    a = ap.parse_args()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(('0.0.0.0', a.port))
    s.settimeout(.3)
    print(f'UDP {a.port} 대기 중 / Ctrl+C 종료')
    last_reply = 0
    while True:
        try:
            raw, addr = s.recvfrom(128)
        except socket.timeout:
            print('\r(패킷 없음 → 실제 ESP32라면 모터 정지)'.ljust(78), end='', flush=True)
            continue
        try:
            p = parse(raw.decode('ascii'))
        except ValueError as e:
            print(f'\n잘못된 패킷 {raw!r}: {e}')
            continue
        bar = '#'*round(p['level']/255*20)
        what = '없음' if p['obj'] < 0 else '스캔 표면' if p['obj'] == 0 else f"사물 {p['obj']}"
        dist = '-' if p['mm'] < 0 else f"{p['mm']/1000:.2f}m"
        print(f"\r#{p['seq']:<6} {'접촉' if p['contact'] else '    '} {bar:<20} {p['level']:>3} {what:<8} {dist:<7} from {addr[0]}".ljust(78), end='', flush=True)
        now = time.time()
        if now - last_reply > .5:
            last_reply = now
            s.sendto(f"PTA1,{p['seq']},-40\n".encode('ascii'), addr)
        if a.once:
            print()
            return


if __name__ == '__main__':
    main()
