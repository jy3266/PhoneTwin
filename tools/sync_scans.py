"""Download the scans the phone uploaded to GitHub into the Unreal project's Content folder.
(The Unreal plugin does this by itself; this script is the manual / no-Unreal alternative.) stdlib only.

    python tools/sync_scans.py                          # once
    python tools/sync_scans.py --watch 60               # every 60 s
    set GITHUB_TOKEN=...   (optional: private repo or higher rate limit)

Reads scans/index.json from the repo and fetches every <id>.ply / <id>.json listed there that is not
already in --dest with the same size. Also writes index.json next to them.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_DEST = 'C:/Users/ujo21/OneDrive/Desktop/PhoneTwin/ARKO_PROJECT/PhoneTwinScans'


def api_get(repo, branch, path, token, want_json=False):
    url = f'https://api.github.com/repos/{repo}/contents/{path}?ref={branch}'
    req = urllib.request.Request(url, headers={'Accept': 'application/vnd.github.object' if want_json else 'application/vnd.github.raw',
                                               'User-Agent': 'PhoneTwin-sync'})
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return json.loads(data) if want_json else data


def sync_once(a, token):
    os.makedirs(a.dest, exist_ok=True)
    index = json.loads(api_get(a.repo, a.branch, 'scans/index.json', token))
    scans = index.get('scans', [])
    new = 0
    for s in scans:
        for key in ('ply', 'meta'):
            path = s.get(key)
            if not path:
                continue
            local = os.path.join(a.dest, os.path.basename(path))
            try:
                info = api_get(a.repo, a.branch, path, token, want_json=True)   # size without downloading
                size = info.get('size', -1)
            except urllib.error.HTTPError as e:
                print(f'  {path}: {e.code} 건너뜀')
                continue
            if os.path.exists(local) and os.path.getsize(local) == size:
                continue
            if a.dry_run:
                print(f'  (dry-run) 받을 파일: {path} ({size:,} B)')
                continue
            data = api_get(a.repo, a.branch, path, token)
            tmp = local + '.part'
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, local)
            new += 1
            print(f'  받음: {os.path.basename(path)} ({len(data):,} B)')
    if not a.dry_run:
        with open(os.path.join(a.dest, 'index.json'), 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
    print(f'{time.strftime("%H:%M:%S")} 스캔 {len(scans)}개 확인 · 새 파일 {new}개 → {a.dest}')


def main():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--repo', default='jy3266/PhoneTwin', help='owner/name')
    ap.add_argument('--branch', default='main')
    ap.add_argument('--dest', default=DEFAULT_DEST, help='folder to put PLY/JSON in')
    ap.add_argument('--watch', type=float, default=0, help='repeat every N seconds')
    ap.add_argument('--dry-run', action='store_true', help='only list what would be downloaded')
    a = ap.parse_args()
    token = os.environ.get('GITHUB_TOKEN', '')
    while True:
        try:
            sync_once(a, token)
        except urllib.error.HTTPError as e:
            print(f'GitHub 오류 {e.code}: {e.reason} (저장소 이름·공개 여부·토큰 확인)', file=sys.stderr)
        except (urllib.error.URLError, OSError, ValueError) as e:
            print(f'동기화 실패: {e}', file=sys.stderr)
        if not a.watch:
            break
        time.sleep(a.watch)


if __name__ == '__main__':
    main()
