// web_scans/ = byte-for-byte clones of scans/ for the web viewer, so nothing on the web ever reads the originals.
// Run by .github/workflows/web-scans.yml after each upload, and by editor_server.mjs.
//   node tools/make_web_copies.mjs [git ref, default origin/main]
import path from 'node:path';
import { blob, latestBlobs, WEB_SCANS, writeIfChanged } from './scan_lib.mjs';

export function makeWebCopies(ref = 'origin/main') {
  let changed = 0;
  for (const f of latestBlobs(ref)) {
    const bytes = blob(f.sha);
    if (f.name === 'index.json') {
      const index = JSON.parse(bytes.toString('utf8'));
      for (const s of index.scans || []) for (const key of ['ply', 'meta']) if (s[key]) s[key] = s[key].replace(/^scans\//, 'web_scans/');
      if (writeIfChanged(path.join(WEB_SCANS, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)) changed++;
    } else if (writeIfChanged(path.join(WEB_SCANS, f.name), bytes)) changed++;
  }
  return changed;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'make_web_copies.mjs') {
  console.log(`web_scans: ${makeWebCopies(process.argv[2] || 'origin/main')}개 갱신`);
}
