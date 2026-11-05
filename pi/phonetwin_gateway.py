#!/usr/bin/env python3
"""
Phone Twin UWB gateway for the Raspberry Pi (based on gwsylvia/Apeficiation pi/pi_gateway.py).

  4 UWB anchors (USB serial)  ->  this script solves the tag position  ->  OSC to Unreal
  Unreal vibration (PTH1, UDP 4210)  ->  this script  ->  anchors (USB serial)  ->  tag motors

Anchor line in:   R,<sweep>,<anchor>,<range_m>,<rx_power_dbm>
Haptics out:      H,<intensity 0-255>,<contact 0|1>          (to every anchor)
OSC out:          /tag/position  f x, f y, f z   (cm)        room frame R when floor A/B are set (see below)
                  /tag/heading   f yaw_deg                    walking direction, ccw from +X (only while moving)
                  /tag/quality   f residual_m, i anchors_used, i valid

Anchors go anywhere in the room. Describe where they are in pi/anchors.json, either
  "anchors": {"1": [x, y, z], ...}           metres, any frame you like, z = height above the floor
or
  "tape": {"heights": {"1": 0.5, ...}, "distances": {"1-2": 3.1, "1-3": ..., ...}}
                                            six tape-measured anchor-to-anchor distances; the script lays the
                                            anchors out itself (anchor 1 = origin, anchor 2 on +X).
To line the UWB room up with the phone scan, put the tag on the floor marks and record them once:
  python3 phonetwin_gateway.py --mark A      (tag lying on scan mark A)
  python3 phonetwin_gateway.py --mark B      (tag on mark B)
Then positions are sent in the scan's room frame R (origin A, +X toward B, +Y left, Z up) — the same frame
Unreal already uses for PTE1, so no offsets are needed in Unreal.

Install:  pip install pyserial          (python-osc is not needed, OSC is encoded here)
Run:      python3 phonetwin_gateway.py --osc-host <Unreal PC IP>
          python3 phonetwin_gateway.py --simulate --osc-host 127.0.0.1     (no hardware: a fake walk)
          python3 phonetwin_gateway.py --dry-run                           (print only)
"""

import argparse
import glob
import json
import math
import os
import queue
import random
import re
import socket
import statistics
import struct
import sys
import threading
import time
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "anchors.json")

DEFAULT_CONFIG = {
    "anchors": {"1": [0.0, 0.0, 0.5], "2": [3.0, 0.0, 2.5], "3": [0.0, 3.0, 2.5], "4": [3.0, 3.0, 0.5]},
    "tag_height": 1.0,
    "floor_a": None,
    "floor_b": None,
}

MAX_VALID_RANGE_M = 12.0
MEDIAN_WINDOW = 3        # ranges per anchor in the spike filter
POSITION_ALPHA = 0.45    # 1.0 = no smoothing, smaller = smoother but laggier
SWEEP_TIMEOUT_S = 0.25   # a sweep is solved once all anchors answered, or this long after its first range
RESET_AFTER_S = 1.0      # restart smoothing from a fresh fix after this long without one
FLAT_SPREAD_M = 0.3      # anchors whose heights differ less than this cannot give z -> use tag_height
HEADING_MIN_SPEED = 0.15 # m/s
BAUD = 115200
LINE = re.compile(r"^R,(\d+),(\d+),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")


# ---------------------------------------------------------------- config
def load_config(path):
    cfg = dict(DEFAULT_CONFIG)
    example = os.path.join(HERE, "anchors.example.json")
    if not os.path.exists(path) and os.path.exists(example):
        with open(example, encoding="utf-8") as f:
            cfg.update({k: v for k, v in json.load(f).items() if not k.startswith("_") and k != "tape_example"})
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cfg.update(json.load(f))
    if cfg.get("tape"):
        cfg["anchors"] = layout_from_tape(cfg["tape"])
    cfg["anchors"] = {int(k): tuple(float(c) for c in v) for k, v in cfg["anchors"].items()}
    return cfg


def save_config(path, cfg):
    out = {k: v for k, v in cfg.items() if k != "anchors" or not cfg.get("tape")}
    if "anchors" in out:
        out["anchors"] = {str(k): list(v) for k, v in out["anchors"].items()}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)


def layout_from_tape(tape):
    """Anchor positions from heights + six anchor-to-anchor distances (tape measure / laser)."""
    h = {int(k): float(v) for k, v in tape["heights"].items()}
    d = {}
    for k, v in tape["distances"].items():
        i, j = (int(s) for s in k.split("-"))
        d[(i, j)] = d[(j, i)] = float(v)

    def flat(i, j):  # horizontal distance between anchors i and j
        return math.sqrt(max(0.0, d[(i, j)] ** 2 - (h[i] - h[j]) ** 2))

    p = {1: (0.0, 0.0), 2: (flat(1, 2), 0.0)}
    for k in (3, 4):
        a, b = flat(1, k), flat(2, k)
        x = (a * a - b * b + p[2][0] ** 2) / (2 * p[2][0])
        y = math.sqrt(max(0.0, a * a - x * x))
        p[k] = (x, y)
    # anchor 3 is placed on the left (+Y) of 1->2; anchor 4 takes the side that matches the 3-4 distance
    if (3, 4) in d:
        x4, y4 = p[4]
        best = min((abs(math.hypot(x4 - p[3][0], s * y4 - p[3][1]) - flat(3, 4)), s) for s in (1, -1))
        p[4] = (x4, best[1] * y4)
    return {k: (p[k][0], p[k][1], h[k]) for k in (1, 2, 3, 4)}


# ---------------------------------------------------------------- solving
def solve3(A, b):
    """3x3 linear solve (Cramer); None when singular."""
    def det(m):
        return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
    D = det(A)
    if abs(D) < 1e-12:
        return None
    return [det([[b[r] if k == c else A[r][k] for k in range(3)] for r in range(3)]) / D for c in range(3)]


def solve_position(anchors, ranges, guess, tag_height):
    """Least squares (Gauss-Newton) over every anchor that answered, 3 or more.
    Flat anchor layouts (or only 3 anchors) solve x, y with z fixed at tag_height."""
    ids = [i for i in ranges if i in anchors]
    if len(ids) < 3:
        return None
    zs = [anchors[i][2] for i in ids]
    use_z = len(ids) >= 4 and max(zs) - min(zs) >= FLAT_SPREAD_M
    p = list(guess) if guess else [sum(anchors[i][0] for i in ids) / len(ids), sum(anchors[i][1] for i in ids) / len(ids), tag_height]
    if not use_z:
        p[2] = tag_height
    n = 3 if use_z else 2
    for _ in range(12):
        JTJ = [[0.0] * 3 for _ in range(3)]
        JTr = [0.0] * 3
        for i in ids:
            a = anchors[i]
            diff = [p[k] - a[k] for k in range(3)]
            dist = math.sqrt(sum(c * c for c in diff)) or 1e-6
            J = [diff[k] / dist for k in range(3)]
            r = dist - ranges[i]
            for u in range(n):
                JTr[u] += J[u] * r
                for v in range(n):
                    JTJ[u][v] += J[u] * J[v]
        if n == 2:
            JTJ[2][2] = 1.0
        for u in range(3):
            JTJ[u][u] += 1e-6           # keeps the step defined on near-degenerate layouts
        step = solve3(JTJ, JTr)
        if step is None:
            return None
        for k in range(n):
            p[k] -= step[k]
        if math.sqrt(sum(s * s for s in step[:n])) < 1e-4:
            break
    if not all(math.isfinite(c) for c in p):
        return None
    res = math.sqrt(sum((math.dist(p, anchors[i]) - ranges[i]) ** 2 for i in ids) / len(ids))
    return tuple(p), res, len(ids)


class Tracker:
    """Collects anchor ranges into sweeps and turns them into smoothed positions."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.anchors = cfg["anchors"]
        self.sweeps = {}      # sweep id -> {"t": first-seen time, "ranges": {anchor: m}}
        self.history = {a: deque(maxlen=MEDIAN_WINDOW) for a in self.anchors}
        self.position = None
        self.position_time = 0.0
        self.trail = deque(maxlen=20)   # (t, x, y) for the walking direction
        self.heading = None

    def add(self, now, sweep, anchor, rng):
        """One anchor line in. Returns a list of finished fixes (usually 0 or 1)."""
        if anchor not in self.anchors or not 0.0 <= rng <= MAX_VALID_RANGE_M:
            return self.flush(now)
        entry = self.sweeps.setdefault(sweep, {"t": now, "ranges": {}})
        entry["ranges"][anchor] = rng
        out = []
        if len(entry["ranges"]) == len(self.anchors):
            del self.sweeps[sweep]
            out.append(self.solve(now, entry["ranges"]))
        return [r for r in out + self.flush(now) if r]

    def flush(self, now):
        """Sweeps where one anchor never answered: solve with the other three after SWEEP_TIMEOUT_S."""
        out = []
        for s in [s for s, e in self.sweeps.items() if now - e["t"] > SWEEP_TIMEOUT_S]:
            e = self.sweeps.pop(s)
            if len(e["ranges"]) >= 3:
                out.append(self.solve(now, e["ranges"]))
        return [r for r in out if r]

    def solve(self, now, raw):
        filtered = {}
        for a, r in raw.items():
            self.history[a].append(r)
            filtered[a] = statistics.median(self.history[a])
        fresh = self.position is not None and now - self.position_time <= RESET_AFTER_S
        got = solve_position(self.anchors, filtered, self.position if fresh else None, self.cfg["tag_height"])
        if got is None:
            return None
        p, res, used = got
        if not fresh:
            self.position = p
            self.trail.clear()
        else:
            self.position = tuple(POSITION_ALPHA * n + (1 - POSITION_ALPHA) * o for n, o in zip(p, self.position))
        self.position_time = now
        self.trail.append((now, self.position[0], self.position[1]))
        old = next((t for t in self.trail if now - t[0] <= 0.5), None)
        if old and now - old[0] > 0.2:
            vx, vy = (self.position[0] - old[1]) / (now - old[0]), (self.position[1] - old[2]) / (now - old[0])
            if math.hypot(vx, vy) > HEADING_MIN_SPEED:
                self.heading = math.degrees(math.atan2(vy, vx))
        return self.position, res, used


# ---------------------------------------------------------------- anchor frame -> scan room frame R
class Frame:
    """Origin = floor mark A, +X toward B, +Y left, Z up (= Unreal's PTE1 frame). Identity when A/B are not set."""

    def __init__(self, cfg):
        a, b = cfg.get("floor_a"), cfg.get("floor_b")
        self.ok = bool(a and b and math.hypot(b[0] - a[0], b[1] - a[1]) > 0.1)
        if self.ok:
            self.ax, self.ay = a[0], a[1]
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            self.c, self.s, self.ang = math.cos(ang), math.sin(ang), math.degrees(ang)

    def point(self, p):
        if not self.ok:
            return p
        dx, dy = p[0] - self.ax, p[1] - self.ay
        return (dx * self.c + dy * self.s, -dx * self.s + dy * self.c, p[2])

    def yaw(self, deg):
        return deg - self.ang if self.ok else deg


# ---------------------------------------------------------------- OSC (encoded by hand, no python-osc needed)
def _osc_str(s):
    b = s.encode("utf-8") + b"\0"
    return b + b"\0" * (-len(b) % 4)


def osc_message(address, *args):
    tags, body = ",", b""
    for a in args:
        if isinstance(a, bool) or isinstance(a, int):
            tags += "i"; body += struct.pack(">i", int(a))
        elif isinstance(a, float):
            tags += "f"; body += struct.pack(">f", a)
        else:
            tags += "s"; body += _osc_str(str(a))
    return _osc_str(address) + _osc_str(tags) + body


# ---------------------------------------------------------------- serial ports (anchors)
class Anchors:
    def __init__(self, paths, lines):
        import serial  # pyserial
        self.ports = []
        for path in paths:
            try:
                port = serial.Serial(path, BAUD, timeout=1, write_timeout=0.05)
            except Exception as e:
                print(f"[{path}] cannot open: {e}")
                continue
            self.ports.append(port)
            threading.Thread(target=self._read, args=(path, port, lines), daemon=True).start()

    @staticmethod
    def _read(path, port, out):
        try:
            while True:
                text = port.readline().decode(errors="ignore").strip()
                m = LINE.match(text)
                if m:
                    out.put((time.monotonic(), int(m.group(1)), int(m.group(2)), float(m.group(3))))
        except Exception as e:  # unplugged cable, permissions
            print(f"[{path}] reader stopped: {e}")

    def haptic(self, level, contact):
        line = f"H,{level},{1 if contact else 0}\n".encode()
        for p in self.ports:
            try:
                p.write(line)
            except Exception:
                pass


def default_ports():
    if sys.platform.startswith("linux"):
        return sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    try:
        from serial.tools import list_ports
        return [p.device for p in list_ports.comports()]
    except Exception:
        return []


# ---------------------------------------------------------------- simulation (no hardware)
def simulate(anchors, tag_height, out, stop):
    """A fake tag walking a slow figure-eight inside the anchors, 4 noisy ranges per sweep at ~25 Hz."""
    xs = [a[0] for a in anchors.values()]; ys = [a[1] for a in anchors.values()]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    rx, ry = (max(xs) - min(xs)) * 0.32, (max(ys) - min(ys)) * 0.32
    sweep, t0 = 0, time.monotonic()
    while not stop.is_set():
        t = (time.monotonic() - t0) * 0.25
        p = (cx + rx * math.sin(t), cy + ry * math.sin(2 * t) / 1.5, tag_height + 0.03 * math.sin(t * 7))
        for i, a in anchors.items():
            if random.random() < 0.05:
                continue                                   # a dropped anchor now and then
            out.put((time.monotonic(), sweep % 256, i, math.dist(p, a) + random.gauss(0, 0.04)))
            time.sleep(0.01)
        sweep += 1


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Phone Twin UWB -> OSC gateway")
    ap.add_argument("--config", default=CONFIG)
    ap.add_argument("--ports", nargs="*", default=None, help="anchor serial ports (default: all /dev/ttyACM*)")
    ap.add_argument("--osc-host", default=None, help="Unreal PC address (default from config or 127.0.0.1)")
    ap.add_argument("--osc-port", type=int, default=None, help="Unreal OSC port (default 8000)")
    ap.add_argument("--haptic-port", type=int, default=4210, help="UDP port for Unreal's PTH1 vibration (0 = off)")
    ap.add_argument("--rate", type=float, default=30.0, help="max OSC sends per second")
    ap.add_argument("--simulate", action="store_true", help="no anchors: send a fake walk")
    ap.add_argument("--dry-run", action="store_true", help="print positions, send no OSC")
    ap.add_argument("--mark", choices=["A", "B"], help="record the tag's current spot as floor mark A or B, then exit")
    ap.add_argument("--show-layout", action="store_true", help="print the anchor positions and exit")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if not os.path.exists(args.config):
        save_config(args.config, cfg)
        print(f"Wrote {args.config} with placeholder anchor positions - edit it to match the room.")
    anchors = cfg["anchors"]
    print("Anchors (m):", ", ".join(f"{i}=({a[0]:.2f}, {a[1]:.2f}, {a[2]:.2f})" for i, a in sorted(anchors.items())))
    if args.show_layout:
        return

    host = args.osc_host or cfg.get("osc_host") or "127.0.0.1"
    port = args.osc_port or int(cfg.get("osc_port") or 8000)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    lines = queue.Queue()
    stop = threading.Event()
    hw = None
    if args.simulate:
        threading.Thread(target=simulate, args=(anchors, cfg["tag_height"], lines, stop), daemon=True).start()
        print("Simulating a walking tag (no hardware).")
    else:
        ports = args.ports or default_ports()
        if not ports:
            raise SystemExit("No serial ports found. Plug in the anchors or pass --ports.")
        hw = Anchors(ports, lines)
        print(f"Reading {len(hw.ports)} anchor port(s): {', '.join(p.port for p in hw.ports)}")

    # vibration from Unreal (PTH1) -> anchors -> tag
    hap = {"seq": 0, "level": 0, "at": 0.0, "peer": None}
    if args.haptic_port and not args.mark:
        hsock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        hsock.bind(("0.0.0.0", args.haptic_port))

        def haptics():
            while True:
                data, peer = hsock.recvfrom(512)
                for ln in data.decode(errors="ignore").splitlines():
                    f = ln.strip().split(",")
                    if f[0] != "PTH1" or len(f) < 5:
                        continue
                    try:
                        seq, valid, level, contact = int(f[1]), int(f[2]), int(f[3]), int(f[4])
                    except ValueError:
                        continue
                    level = max(0, min(255, level)) if valid else 0
                    if hw:
                        hw.haptic(level, contact and valid)
                    hap.update(seq=seq, level=level, at=time.monotonic(), peer=peer[0])
                    hsock.sendto(f"PTA1,{seq},0\n".encode(), peer)   # Unreal shows "진동 응답 OK"
        threading.Thread(target=haptics, daemon=True).start()
        print(f"Vibration: listening for Unreal PTH1 on UDP {args.haptic_port} (set Unreal Esp Address to this Pi, or leave it empty)")

    frame = Frame(cfg)
    print("Output frame:", "scan room frame R (floor marks A/B set)" if frame.ok else "anchor frame (run --mark A and --mark B to match the scan)")
    if not args.dry_run and not args.mark:
        print(f"OSC -> {host}:{port}  /tag/position (cm), /tag/heading, /tag/quality")

    tracker = Tracker(cfg)
    marks, mark_until = [], time.monotonic() + 4.0
    last_send, last_print = 0.0, 0.0
    while True:
        try:
            now, sweep, anchor, rng = lines.get(timeout=0.1)
            fixes = tracker.add(now, sweep, anchor, rng)
        except queue.Empty:
            now = time.monotonic()
            fixes = tracker.flush(now)
        for p, res, used in fixes:
            if args.mark:
                marks.append(p)
                continue
            q = frame.point(p)
            if now - last_print > 0.5:
                last_print = now
                vib = f"  vib {hap['level']}" if now - hap["at"] < 1 else ""
                print(f"x,y,z (m): {q[0]:7.3f} {q[1]:7.3f} {q[2]:6.3f}   anchors {used}  residual {res:.3f}{vib}")
            if args.dry_run or now - last_send < 1.0 / args.rate:
                continue
            last_send = now
            msgs = [osc_message("/tag/position", q[0] * 100.0, q[1] * 100.0, q[2] * 100.0),
                    osc_message("/tag/quality", float(res), int(used), 1)]
            if tracker.heading is not None:
                msgs.append(osc_message("/tag/heading", float(frame.yaw(tracker.heading))))
            for m in msgs:
                sock.sendto(m, (host, port))
        if args.mark and time.monotonic() > mark_until:
            if len(marks) < 5:
                raise SystemExit("Too few positions to record the mark - is the tag ranging? (try --dry-run)")
            x = statistics.median(m[0] for m in marks)
            y = statistics.median(m[1] for m in marks)
            cfg["floor_" + args.mark.lower()] = [round(x, 3), round(y, 3)]
            save_config(args.config, cfg)
            print(f"Floor mark {args.mark} = ({x:.3f}, {y:.3f}) from {len(marks)} fixes, saved to {args.config}")
            stop.set()
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
