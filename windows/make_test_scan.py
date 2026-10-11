"""Write a synthetic ~5-pyeong room as a binary PLY point cloud (Y up, metres) to try the phone app
without a real scan.  Floor 4.5 x 3.6 m, walls 2.4 m, a table, a pillar, a sphere sculpture,
and coloured floor marks A (green) and B (blue) 3 m apart for the alignment step.

    python make_test_scan.py            -> test_room.ply
"""
import argparse
import math
import random
import struct

W, D, H = 4.5, 3.6, 2.4
A, B = (0.6, 0.6), (3.6, 0.6)          # floor marks (x, z)


def room(step):
    pts = []

    def add(x, y, z, c):
        pts.append((x + random.uniform(-.003, .003), y + random.uniform(-.003, .003), z + random.uniform(-.003, .003), c))

    def grid(a0, a1, b0, b1):
        a = a0
        while a <= a1:
            b = b0
            while b <= b1:
                yield a, b
                b += step
            a += step

    for x, z in grid(0, W, 0, D):                                   # floor + marks
        c = (150, 140, 125)
        if math.dist((x, z), A) < .08: c = (40, 220, 90)
        if math.dist((x, z), B) < .08: c = (60, 120, 255)
        add(x, 0, z, c)
    for x, y in grid(0, W, 0, H):                                   # walls
        add(x, y, 0, (205, 205, 200)); add(x, y, D, (200, 200, 195))
    for z, y in grid(0, D, 0, H):
        add(0, y, z, (195, 200, 205)); add(W, y, z, (200, 195, 190))
    for x, z in grid(1.6, 2.8, 1.6, 2.4):                          # table top 0.75 m
        add(x, .75, z, (140, 90, 50))
    for x, y in grid(1.6, 2.8, 0, .75):
        add(x, y, 1.6, (120, 75, 40)); add(x, y, 2.4, (120, 75, 40))
    for a, y in grid(0, 2*math.pi, 0, H):                           # pillar r=0.2 at (3.8, 2.8), angle step = step rad
        add(3.8 + .2*math.cos(a), y, 2.8 + .2*math.sin(a), (90, 90, 100))
    n = int(4*math.pi*.35**2/step**2)                               # sculpture sphere r=0.35, centre 1.0 m high
    for i in range(n):
        u, v = random.random()*2 - 1, random.random()*2*math.pi
        s = math.sqrt(1 - u*u)
        add(1.0 + .35*s*math.cos(v), 1.0 + .35*u, 2.6 + .35*s*math.sin(v), (220, 60, 60))
    return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='test_room.ply')
    ap.add_argument('--step', type=float, default=.02, help='point spacing in metres')
    a = ap.parse_args()
    random.seed(1)
    pts = room(a.step)
    with open(a.out, 'wb') as f:
        f.write(('ply\nformat binary_little_endian 1.0\ncomment PhoneTwin synthetic room\n'
                 f'element vertex {len(pts)}\nproperty float x\nproperty float y\nproperty float z\n'
                 'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n').encode('ascii'))
        for x, y, z, (r, g, b) in pts:
            f.write(struct.pack('<fffBBB', x, y, z, r, g, b))
    print(f'{a.out}: {len(pts):,} points / A{A} B{B} (x,z, 3.00 m apart) / table top 0.75 m / red sphere at (1.0,1.0,2.6)')


if __name__ == '__main__':
    main()
