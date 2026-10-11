"""Write the sample scan for the web viewer / Unreal: scans/sample_test_room.ply + .json + index.json entry.

Reuses the synthetic room of windows/make_test_scan.py (Y up, metres = S frame, see PROTOCOL.md),
with a coarser point spacing so the file stays small (~60k points).

    python tools/make_sample_scan.py            (run from PhoneTwin_v4)
"""
import argparse
import json
import os
import random
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'windows'))
import make_test_scan as room_gen  # noqa: E402

SCAN_ID = 'sample_test_room'


def write_ply(path, pts):
    with open(path, 'wb') as f:
        f.write(('ply\nformat binary_little_endian 1.0\ncomment PhoneTwin sample room, Y up, metres\n'
                 f'element vertex {len(pts)}\nproperty float x\nproperty float y\nproperty float z\n'
                 'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n').encode('ascii'))
        buf = bytearray()
        for x, y, z, (r, g, b) in pts:
            buf += struct.pack('<fffBBB', x, y, z, r, g, b)
        f.write(buf)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scans', default=os.path.join(ROOT, 'scans'))
    ap.add_argument('--step', type=float, default=.036, help='point spacing in metres')
    a = ap.parse_args()
    random.seed(1)
    pts = room_gen.room(a.step)
    os.makedirs(a.scans, exist_ok=True)
    write_ply(os.path.join(a.scans, SCAN_ID + '.ply'), pts)

    xs, ys, zs = zip(*[(p[0], p[1], p[2]) for p in pts])
    created = '2026-10-11T12:00:00+09:00'
    meta = {
        'version': 1, 'id': SCAN_ID, 'created': created,
        'frame': 'S: metres, Y up, right-handed', 'points': len(pts),
        'bounds': {'min': [round(min(xs), 4), round(min(ys), 4), round(min(zs), 4)],
                   'max': [round(max(xs), 4), round(max(ys), 4), round(max(zs), 4)]},
        'a': [room_gen.A[0], 0.0, room_gen.A[1]], 'b': [room_gen.B[0], 0.0, room_gen.B[1]],
        'objects': [{'id': 1, 'name': '사물 1 (빨간 구)', 'c': [1.0, 1.0, 2.6], 'r': 0.35}],
        'ai': [{'label': 'chair', 'name': '의자', 'c': [2.2, 0.75, 2.0], 'r': 0.6}],
    }
    with open(os.path.join(a.scans, SCAN_ID + '.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    idx_path = os.path.join(a.scans, 'index.json')
    try:
        with open(idx_path, encoding='utf-8') as f:
            index = json.load(f)
    except (OSError, ValueError):
        index = {'version': 1, 'scans': []}
    index['scans'] = [s for s in index.get('scans', []) if s.get('id') != SCAN_ID]
    index['scans'].append({'id': SCAN_ID, 'ply': f'scans/{SCAN_ID}.ply', 'meta': f'scans/{SCAN_ID}.json',
                           'points': len(pts), 'created': created, 'device': 'PC 시험용'})
    with open(idx_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f'{SCAN_ID}: {len(pts):,} points -> {a.scans}')


if __name__ == '__main__':
    main()
