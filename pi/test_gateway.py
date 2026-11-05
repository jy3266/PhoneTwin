#!/usr/bin/env python3
"""Offline checks for phonetwin_gateway.py (no hardware): py test_gateway.py"""
import math
import random
import struct

import phonetwin_gateway as g

ok = True


def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(("PASS " if cond else "FAIL ") + name + (f"  {detail}" if detail else ""))


# 1. 3D solve with 4 anchors at different heights (the reference layout)
A = {1: (0, 0, 0.5), 2: (3, 0, 2.5), 3: (0, 3, 2.5), 4: (3, 3, 0.5)}
p = (1.2, 1.9, 1.1)
r = {i: math.dist(p, a) for i, a in A.items()}
q, res, n = g.solve_position(A, r, None, 1.0)
check("3D exact", math.dist(p, q) < 1e-3 and n == 4, f"{q}")

# 2. arbitrary flat layout (all anchors at 2.1 m, not a rectangle) -> z fixed at tag height
F = {1: (0.3, -0.2, 2.1), 2: (4.1, 0.4, 2.1), 3: (3.5, 3.8, 2.1), 4: (-0.5, 2.9, 2.1)}
p = (2.0, 1.4, 1.0)
r = {i: math.dist(p, a) for i, a in F.items()}
q, res, n = g.solve_position(F, r, None, 1.0)
check("flat layout x,y", math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3, f"{q}")

# 3. one anchor missing -> 3 anchors still solve
r3 = {i: v for i, v in r.items() if i != 3}
q, res, n = g.solve_position(F, r3, None, 1.0)
check("3 anchors", n == 3 and math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3, f"{q}")

# 4. noisy ranges: error stays small
random.seed(1)
errs = []
for _ in range(200):
    p = (random.uniform(0.5, 3.5), random.uniform(0.5, 3), 1.0)
    rn = {i: math.dist(p, a) + random.gauss(0, 0.05) for i, a in F.items()}
    q, _, _ = g.solve_position(F, rn, None, 1.0)
    errs.append(math.hypot(q[0] - p[0], q[1] - p[1]))
check("noise 5 cm -> median error < 8 cm", sorted(errs)[100] < 0.08, f"median {sorted(errs)[100]:.3f} m")

# 5. tape layout reproduces the geometry (up to rotation/translation: compare all pair distances)
T = {1: (0, 0, 0.4), 2: (3.6, 0, 2.2), 3: (2.9, 3.1, 0.9), 4: (-0.4, 2.7, 2.0)}
tape = {"heights": {str(i): a[2] for i, a in T.items()},
        "distances": {f"{i}-{j}": math.dist(T[i], T[j]) for i in T for j in T if i < j}}
L = g.layout_from_tape(tape)
worst = max(abs(math.dist(L[i], L[j]) - math.dist(T[i], T[j])) for i in T for j in T if i < j)
check("tape layout", worst < 1e-6, f"worst pair error {worst:.2e} m")

# 6. frame: A -> origin, B -> +X, left of A->B -> +Y
fr = g.Frame({"floor_a": [1, 1], "floor_b": [1, 3]})
a, b, left = fr.point((1, 1, 0)), fr.point((1, 2, 0)), fr.point((0, 1, 0))
check("frame A/B", abs(a[0]) < 1e-9 and abs(b[0] - 1) < 1e-9 and abs(b[1]) < 1e-9 and abs(left[1] - 1) < 1e-9, f"{a} {b} {left}")
check("frame yaw", abs(fr.yaw(90) - 0) < 1e-9)

# 7. tracker: sweeps with all anchors, and a sweep missing one anchor (flushed after the timeout)
tr = g.Tracker({"anchors": F, "tag_height": 1.0})
p = (2.0, 1.4, 1.0)
fixes = []
for s in range(5):
    for i, a in F.items():
        fixes += tr.add(s * 0.04, s, i, math.dist(p, a))
check("tracker full sweeps", len(fixes) == 5)
fixes = []
for i, a in F.items():
    if i != 2:
        fixes += tr.add(1.0, 9, i, math.dist(p, a))
fixes += tr.flush(1.0 + g.SWEEP_TIMEOUT_S + 0.01)
check("tracker 3-anchor sweep", len(fixes) == 1 and fixes[0][2] == 3)

# 8. OSC bytes
m = g.osc_message("/tag/position", 1.0, 2.0, 3.0)
check("osc encode", m[:16] == b"/tag/position\0\0\0" and m[16:24] == b",fff\0\0\0\0" and struct.unpack(">3f", m[24:]) == (1.0, 2.0, 3.0))

print("ALL PASS" if ok else "SOME FAILED")
raise SystemExit(0 if ok else 1)
