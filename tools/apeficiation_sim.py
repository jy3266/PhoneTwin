#!/usr/bin/env python3
"""
Hardware-free test bench for gwsylvia/Apeficiation (no XIAO, no DWM1000, no Raspberry Pi needed).

What is real and what is simulated
  real:      Apeficiation's own pi/pi_gateway.py, unmodified (cloned from GitHub): its serial-line regex,
             sweep grouping, median filter, solver, smoothing and OSC output to Unreal.
  simulated: the 4 anchors' USB serial lines "R,<sweep>,<anchor>,<range_m>,<rx_power_dbm>" exactly as
             arduino/4uwb_anchor prints them, produced by a virtual tag that sweeps anchors 1..4 like
             arduino/uwb_tag_motors (about 8 ms per anchor, 50 ms timeout when an anchor misses).

Run (Windows: py, Pi/Mac: python3) from PhoneTwin_v4:
  py tools/apeficiation_sim.py                         # walk a figure 8, OSC -> 127.0.0.1:8000 (Unreal Play)
  py tools/apeficiation_sim.py --walk ab               # stand on A 6 s, on B 6 s, then walk (press 7 / 8 in Unreal)
  py tools/apeficiation_sim.py --scenario noisy        # ideal | noisy | uncal | dropout | spikes | flat
  py tools/apeficiation_sim.py --dry-run               # no OSC, just accuracy numbers
  py tools/apeficiation_sim.py --selftest              # every scenario for a few seconds, OSC decoded back, table
Options: --osc-host/--osc-port, --duration s, --mark-a x,y --mark-b x,y (Apeficiation room metres),
         --anchors "x,y,z;x,y,z;x,y,z;x,y,z" (same as editing ANCHOR_POS in their files), --show-lines, --upstream path
python-osc is optional: without it a byte-identical minimal OSC sender is used.
"""

import argparse
import importlib.util
import math
import os
import queue
import random
import socket
import struct
import subprocess
import sys
import threading
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
UPSTREAM_DIR = os.path.join(HERE, ".apeficiation")          # git-ignored clone
UPSTREAM_URL = "https://github.com/gwsylvia/Apeficiation"

SCENARIOS = {
    #            noise sigma m, constant bias m, miss prob per anchor, spike prob, spike m, flat anchors
    "ideal":   dict(sigma=0.0,  bias=0.0,  miss=0.0,  spike=0.0,  spike_m=0.0, flat=False),
    "noisy":   dict(sigma=0.05, bias=0.0,  miss=0.0,  spike=0.0,  spike_m=0.0, flat=False),
    "uncal":   dict(sigma=0.05, bias=0.25, miss=0.0,  spike=0.0,  spike_m=0.0, flat=False),   # ANTENNA_DELAY 16384 not calibrated
    "dropout": dict(sigma=0.05, bias=0.0,  miss=0.10, spike=0.0,  spike_m=0.0, flat=False),   # a body blocks one anchor now and then
    "spikes":  dict(sigma=0.05, bias=0.0,  miss=0.0,  spike=0.05, spike_m=1.5, flat=False),   # non-line-of-sight reflections
    "flat":    dict(sigma=0.05, bias=0.0,  miss=0.0,  spike=0.0,  spike_m=0.0, flat=True),    # all anchors at the same height
}


# ------------------------------------------------------------------------------------------- upstream
def fetch_upstream(path):
    if path:
        return path
    target = os.path.join(UPSTREAM_DIR, "pi", "pi_gateway.py")
    if not os.path.exists(target):
        print(f"Apeficiation 원본을 받는 중: {UPSTREAM_URL}")
        subprocess.run(["git", "clone", "-q", "--depth", "1", UPSTREAM_URL, UPSTREAM_DIR], check=True)
    else:
        subprocess.run(["git", "-C", UPSTREAM_DIR, "pull", "-q", "--ff-only"], check=False)
    rev = subprocess.run(["git", "-C", UPSTREAM_DIR, "log", "-1", "--format=%h %ad %s", "--date=short"],
                         capture_output=True, text=True).stdout.strip()
    print(f"Apeficiation 원본: {rev}")
    return target


def osc_message(address, floats):
    def pad(b):
        return b + b"\0" * (4 - len(b) % 4)
    return pad(address.encode()) + pad(("," + "f" * len(floats)).encode()) + b"".join(struct.pack(">f", v) for v in floats)


def install_osc_shim():
    """pythonosc.udp_client.SimpleUDPClient stand-in (same bytes for float arguments)."""
    try:
        import pythonosc.udp_client  # noqa: F401
        return "python-osc"
    except ImportError:
        pass

    class SimpleUDPClient:
        def __init__(self, host, port):
            self.addr = (host, port)
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

        def send_message(self, address, value):
            vals = value if isinstance(value, (list, tuple)) else [value]
            self.sock.sendto(osc_message(address, [float(v) for v in vals]), self.addr)

    pkg = types.ModuleType("pythonosc")
    mod = types.ModuleType("pythonosc.udp_client")
    mod.SimpleUDPClient = SimpleUDPClient
    pkg.udp_client = mod
    sys.modules["pythonosc"] = pkg
    sys.modules["pythonosc.udp_client"] = mod
    return "내장 OSC (python-osc 없음)"


def load_upstream(path):
    spec = importlib.util.spec_from_file_location("apeficiation_pi_gateway", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ------------------------------------------------------------------------------------------- the world
class Walk:
    """True tag position (Apeficiation room metres) over time."""

    def __init__(self, kind, anchors, a, b, height):
        xs = [p[0] for p in anchors.values()]
        ys = [p[1] for p in anchors.values()]
        self.cx, self.cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        self.r = max(0.3, min(max(xs) - min(xs), max(ys) - min(ys)) * 0.3)
        self.kind, self.a, self.b, self.z = kind, a, b, height

    def figure8(self, t):
        w = 2 * math.pi * t / 16.0
        return (self.cx + self.r * math.sin(w), self.cy + self.r * 0.6 * math.sin(2 * w), self.z + 0.05 * math.sin(3 * w))

    def at(self, t):
        if self.kind == "still":
            return (self.cx, self.cy, self.z)
        if self.kind == "ab":
            if t < 6:
                return (self.a[0], self.a[1], self.z)
            if t < 12:
                return (self.b[0], self.b[1], self.z)
            return self.figure8(t - 12)
        if self.kind == "line":
            s = (math.sin(2 * math.pi * t / 12.0) + 1) / 2
            return (self.a[0] + (self.b[0] - self.a[0]) * 3 * (s - .33), self.a[1] + (self.b[1] - self.a[1]) * 3 * (s - .33), self.z)
        return self.figure8(t)


class Air:
    """The virtual tag + anchors: emits one serial line per anchor per sweep, like the firmware."""

    def __init__(self, anchors, walk, sc, show_lines, t0):
        self.anchors, self.walk, self.sc, self.show = anchors, walk, sc, show_lines
        self.ports = {a: queue.Queue() for a in anchors}
        self.truth = {}           # sweep id (0..255) -> (time, true xyz)
        self.sent = self.dropped = 0
        self.t0 = t0
        self.stop = False

    def run(self):
        sweep = 0
        while not self.stop:
            now = time.monotonic()
            p = self.walk.at(now - self.t0)
            self.truth[sweep] = (now, p)
            complete = True
            for aid in sorted(self.anchors):
                if random.random() < self.sc["miss"]:
                    complete = False
                    time.sleep(0.050)          # TAG_TIMEOUT_MS: the tag waits, then skips this anchor
                    continue
                d = math.dist(p, self.anchors[aid]) + self.sc["bias"] + random.gauss(0, self.sc["sigma"])
                if random.random() < self.sc["spike"]:
                    d += self.sc["spike_m"]
                rx = -78.0 - 20 * math.log10(max(d, 0.1)) + random.gauss(0, 1.5)
                line = f"R,{sweep},{aid},{max(d, 0.0):.3f},{rx:.1f}"
                if self.show:
                    print("  " + line)
                self.ports[aid].put(line)
                time.sleep(0.008 + random.uniform(-0.001, 0.002))   # POLL -> POLL_ACK(3 ms) -> RANGE(3 ms) -> REPORT
            self.sent += 1
            self.dropped += 0 if complete else 1
            sweep = (sweep + 1) % 256   # uint8_t sweepId wraps like the firmware


# ------------------------------------------------------------------------------------------- OSC check
def decode_osc(data):
    def string(i):
        j = data.index(b"\0", i)
        return data[i:j].decode(), (j + 4) & ~3
    addr, i = string(0)
    tags, i = string(i)
    vals = []
    for t in tags[1:]:
        if t == "f":
            vals.append(struct.unpack(">f", data[i:i + 4])[0]); i += 4
        elif t == "i":
            vals.append(struct.unpack(">i", data[i:i + 4])[0]); i += 4
        elif t == "d":
            vals.append(struct.unpack(">d", data[i:i + 8])[0]); i += 8
    return addr, tags, vals


class OscListener:
    def __init__(self, port):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", port))
        self.sock.settimeout(0.5)
        self.msgs = []
        self.bad = 0
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        while True:
            try:
                data, _ = self.sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                self.msgs.append((time.monotonic(),) + decode_osc(data))
            except Exception:
                self.bad += 1


# ------------------------------------------------------------------------------------------- one run
def run_once(up, args, scenario, duration, osc_port, quiet=False):
    sc = SCENARIOS[scenario]
    anchors = dict(up.ANCHOR_POS_ORIGINAL)
    if args.anchors:
        pts = [tuple(float(v) for v in s.split(",")) for s in args.anchors.split(";")]
        anchors = {i + 1: p for i, p in enumerate(pts)}
    if sc["flat"]:
        anchors = {k: (v[0], v[1], 1.5) for k, v in anchors.items()}
    up.ANCHOR_POS.clear()
    up.ANCHOR_POS.update(anchors)          # what their firmware/gateway constants would say

    t0 = time.monotonic()
    walk = Walk(args.walk, anchors, args.mark_a, args.mark_b, args.height)
    air = Air(anchors, walk, sc, args.show_lines, t0)
    errors, residuals, outputs = [], [], []
    last_print = [0.0]

    class MeasuringTracker(up.Tracker):
        def add(self, now, sweep, anchor, rng):
            r = super().add(now, sweep, anchor, rng)
            if r is not None:
                tt, truth = air.truth.get(sweep, (now, None))
                if truth is not None:
                    errors.append(math.dist(r[:3], truth))
                residuals.append(r[3])
                outputs.append((now, r[:3]))
            return r

    def fake_read_port(path, out):
        aid = int(path.split(":")[1])
        q = air.ports[aid]
        while True:
            text = q.get().strip()
            m = up.LINE.match(text)              # their regex, their tuple
            if m:
                out.put((time.monotonic(), int(m.group(1)), int(m.group(2)), float(m.group(3))))

    def throttled_print(*a, **k):
        msg = " ".join(str(x) for x in a)
        if msg.startswith("x,y,z") and (quiet or time.monotonic() - last_print[0] < 0.5):
            return
        last_print[0] = time.monotonic()
        if not quiet:
            print("  [pi_gateway] " + msg)

    up.Tracker = MeasuringTracker
    up.read_port = fake_read_port
    up.print = throttled_print            # their per-sweep print, thinned to 2 lines/s

    argv = ["pi_gateway.py", "--ports"] + [f"sim:{a}" for a in sorted(anchors)]
    if args.dry_run:
        argv.append("--dry-run")
    else:
        argv += ["--osc-host", args.osc_host, "--osc-port", str(osc_port)]
    sys.argv = argv
    threading.Thread(target=up.main, daemon=True).start()
    threading.Thread(target=air.run, daemon=True).start()

    end = t0 + duration if duration > 0 else float("inf")
    next_report = t0 + 2
    try:
        while time.monotonic() < end:
            time.sleep(0.1)
            if not quiet and time.monotonic() >= next_report:
                next_report += 2
                recent = [e for (t, _), e in zip(outputs[-len(errors):], errors) if time.monotonic() - t < 2]
                rate = sum(1 for t, _ in outputs if time.monotonic() - t < 2) / 2
                tp = walk.at(time.monotonic() - t0)
                txt = f"  {time.monotonic() - t0:5.1f}s  실제 위치 ({tp[0]:.2f}, {tp[1]:.2f}, {tp[2]:.2f}) m · 출력 {rate:4.1f}/s"
                if recent:
                    txt += f" · 오차 평균 {100 * sum(recent) / len(recent):4.1f} cm"
                if air.sent:
                    txt += f" · 빠진 스윕 {100 * air.dropped / air.sent:.0f}%"
                print(txt)
    except KeyboardInterrupt:
        pass
    air.stop = True
    elapsed = time.monotonic() - t0
    errs = sorted(errors)
    return dict(
        scenario=scenario, seconds=elapsed, sweeps=air.sent, incomplete=air.dropped,
        outputs=len(outputs), rate=len(outputs) / elapsed if elapsed else 0,
        mean=sum(errs) / len(errs) if errs else None, p95=errs[int(len(errs) * .95)] if errs else None,
        maxe=errs[-1] if errs else None, residual=sum(residuals) / len(residuals) if residuals else None,
        positions=outputs)


def summary_line(r):
    def cm(v):
        return "   -  " if v is None else f"{100 * v:5.1f}"
    return (f"{r['scenario']:8s} 스윕 {r['sweeps']:4d} (불완전 {r['incomplete']:3d}) · 출력 {r['outputs']:4d} ({r['rate']:4.1f}/s)"
            f" · 오차 평균 {cm(r['mean'])} / 95% {cm(r['p95'])} / 최대 {cm(r['maxe'])} cm · 잔차 {cm(r['residual'])} cm")


def main():
    ap = argparse.ArgumentParser(description="Apeficiation 하드웨어 없는 시험 (원본 pi_gateway.py + 가상 앵커 4개)")
    ap.add_argument("--upstream", help="pi_gateway.py 경로 (기본: tools/.apeficiation 에 자동 clone)")
    ap.add_argument("--scenario", default="noisy", choices=sorted(SCENARIOS))
    ap.add_argument("--walk", default="figure8", choices=["figure8", "ab", "line", "still"])
    ap.add_argument("--mark-a", default="1.0,1.5", help="스캔 바닥 A 자리 (Apeficiation 방 좌표 m)")
    ap.add_argument("--mark-b", default="2.0,1.5", help="스캔 바닥 B 자리 (A에서 1 m)")
    ap.add_argument("--height", type=float, default=1.0, help="태그 높이 m")
    ap.add_argument("--anchors", help='"x,y,z;x,y,z;x,y,z;x,y,z" (앵커 1~4, m)')
    ap.add_argument("--osc-host", default="127.0.0.1")
    ap.add_argument("--osc-port", type=int, default=8000)
    ap.add_argument("--dry-run", action="store_true", help="OSC 안 보냄")
    ap.add_argument("--duration", type=float, default=0, help="초 (0 = Ctrl+C까지)")
    ap.add_argument("--show-lines", action="store_true", help="앵커가 USB로 내보내는 줄을 그대로 출력")
    ap.add_argument("--selftest", action="store_true", help="모든 상황을 짧게 돌리고 OSC를 다시 풀어 검사")
    args = ap.parse_args()
    args.mark_a = tuple(float(v) for v in args.mark_a.split(","))
    args.mark_b = tuple(float(v) for v in args.mark_b.split(","))

    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    random.seed(7)
    osc_impl = install_osc_shim()
    path = fetch_upstream(args.upstream)

    if not args.selftest:
        up = load_upstream(path)
        up.ANCHOR_POS_ORIGINAL = dict(up.ANCHOR_POS)
        dest = "OSC 안 보냄 (--dry-run)" if args.dry_run else f"OSC {args.osc_host}:{args.osc_port} {up.OSC_ADDRESS} (cm, {osc_impl})"
        print(f"상황 {args.scenario} · 걷기 {args.walk} · {dest}")
        print("앵커 (m): " + "  ".join(f"{k}={v}" for k, v in sorted(up.ANCHOR_POS.items())))
        if args.walk == "ab":
            print(f"0~6초 A {args.mark_a} 위에 서 있음 → 언리얼에서 7  ·  6~12초 B {args.mark_b} → 8  ·  그다음 걷기")
        r = run_once(up, args, args.scenario, args.duration, args.osc_port)
        print(summary_line(r))
        return

    # selftest: every scenario, OSC sent to a local listener and decoded back
    port = 18000 + random.randint(0, 999)
    listener = OscListener(port)
    args.dry_run = False
    args.osc_host = "127.0.0.1"
    print(f"자체 시험 · OSC는 127.0.0.1:{port} 로 받아서 다시 풀어 봄 ({osc_impl})")
    results, ok = [], True
    for name in ["ideal", "noisy", "uncal", "dropout", "spikes", "flat"]:
        up = load_upstream(path)                 # fresh module: no state carried between scenarios
        up.ANCHOR_POS_ORIGINAL = dict(up.ANCHOR_POS)
        start = len(listener.msgs)
        r = run_once(up, args, name, 4.0, port, quiet=True)
        time.sleep(0.2)
        got = listener.msgs[start:]
        r["osc"] = len(got)
        # every OSC message must be /tag/position ,fff in cm = the gateway's metres * 100
        pos = [m for m in got if m[1] == up.OSC_ADDRESS and m[2] == ",fff"]
        r["osc_ok"] = len(pos) == len(got) and listener.bad == 0
        if pos and r["positions"]:
            last_m = r["positions"][-1][1]
            last_c = pos[-1][3]
            r["osc_ok"] &= all(abs(c - 100 * m) < 0.01 + 1e-4 * abs(c) for c, m in zip(last_c, last_m))
        results.append(r)
        print(summary_line(r) + f" · OSC {r['osc']}개 {'OK' if r['osc_ok'] else '이상'}")
        expect = {
            "ideal":   r["outputs"] > 40 and r["p95"] is not None and r["p95"] < 0.08 and r["osc_ok"],   # only the smoothing lag (POSITION_ALPHA 0.4) while walking
            "noisy":   r["outputs"] > 40 and r["p95"] is not None and r["p95"] < 0.40 and r["osc_ok"],
            "uncal":   r["outputs"] > 40 and r["osc_ok"],
            "dropout": r["outputs"] > 10 and r["incomplete"] > 0 and r["osc_ok"],
            "spikes":  r["outputs"] > 40 and r["osc_ok"],
            "flat":    r["outputs"] == 0,       # their solver cannot work with all anchors at one height
        }[name]
        ok &= expect
    print("결과:", "통과" if ok else "실패")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
