// Collision editor: 세밀도 (a finer grid per shape, fitted to the scan), 부위 떼기 (a part with its own sound/vibration),
// 진동 느낌 (character, start distance, strength) and the live preview. Nothing is saved (the real collision files stay as they are).
//   node tools/test_editor_detail.mjs <PhoneTwin_v4> <screenshot folder>      (needs puppeteer-core; the editor server must be free on 8765)
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import path from 'path';

const ROOT = path.resolve(process.argv[2]), OUT = process.argv[3];
const SCAN = 'sample_test_room';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (n, ok, x) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${!ok && x !== undefined ? ' · ' + JSON.stringify(x) : ''}`); if (!ok) failed++; };

const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'editor_server.mjs'), '--no-publish', '--no-open'], { stdio: 'ignore' });
for (let i = 0; i < 400; i++) { try { if ((await fetch("http://127.0.0.1:8765/api/ping")).ok) break; } catch { /* not yet */ } await sleep(200); }
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`http://127.0.0.1:8765/editor.html#${SCAN}`);
  await page.waitForFunction(() => window.__editor && window.__editor.data && window.__editor.data.collisions.length, { timeout: 30000 });
  const st = () => page.evaluate(() => { const e = window.__editor, c = e.selected; return c ? { id: c.id, n: c.cells.length / 3, voxel: c.voxel, name: c.name, haptic: c.haptic, range: c.hapticRange, gain: c.hapticGain, parent: c.parent, total: e.data.collisions.length } : null; });

  // pick the biggest shape
  await page.evaluate(() => { const e = window.__editor; e.select(e.data.collisions.slice().sort((a, b) => b.cells.length - a.cells.length)[0]); e.setView('focus'); });
  let s = await st(); const before = s;
  check('a shape is selected, on the file grid', s && s.voxel === undefined && s.n > 10, s);

  // 세밀도 2 cm: more, smaller cells, fitted to the scan surface (not simply 8x)
  await page.select('#detail', '0.02'); await sleep(300);
  s = await st();
  check('2 cm: own grid, more cells', s.voxel === 0.02 && s.n > before.n, s);
  check('fitted to the scan (fewer than every cell split in 8)', s.n < before.n * 8, { before: before.n, after: s.n });
  const box2 = await page.evaluate(() => document.getElementById('shapeInfo').textContent);
  check('info shows the cell size', /2 cm/.test(box2), box2);
  // back to 4 cm: merged again
  await page.select('#detail', '0.04'); await sleep(200);
  s = await st();
  check('4 cm again: back on the file grid', s.voxel === undefined && s.n <= before.n + 2 && s.n >= before.n * 0.8, { before: before.n, after: s.n });
  await page.select('#detail', '0.02'); await sleep(200);

  // 부위 떼기: drag over the shape -> a new shape that is a part of it, with the same grid
  await page.click('[data-tool="split"]');
  const pts = await page.evaluate(() => {
    const e = window.__editor, c = e.selected, r = document.querySelector('#stage canvas').getBoundingClientRect();
    return [0.42, 0.5, 0.58].map((f) => [r.left + r.width * f, r.top + r.height * 0.5]);
  });
  const parentId = (await st()).id, parentN = (await st()).n;
  await page.mouse.move(...pts[0]); await page.mouse.down();
  for (const p of pts) { await page.mouse.move(...p, { steps: 6 }); }
  await page.mouse.up(); await sleep(400);
  s = await st();
  if (s.parent === parentId) {
    check('part taken off: own shape, linked to its object, same fine grid', s.voxel === 0.02 && s.n > 0 && / · 부위$/.test(s.name), s);
    const p = await page.evaluate((id) => window.__editor.data.collisions.find((c) => c.id === id).cells.length / 3, parentId);
    check('the object lost exactly those cells', p + s.n === parentN, { parent: p, part: s.n, before: parentN });
  } else check('part taken off (drag hit the shape)', false, s);

  // 진동: character, start distance, strength
  await page.select('#haptic', 'tick');
  await page.$eval('#hapticRange', (el) => { el.value = '0.12'; el.dispatchEvent(new Event('input')); });
  await page.$eval('#hapticGain', (el) => { el.value = '0.6'; el.dispatchEvent(new Event('input')); });
  s = await st();
  check('vibration settings stored on the shape', s.haptic === 'tick' && s.range === 0.12 && s.gain === 0.6, s);
  // preview: far = nothing, close = strong; the tick pattern makes it come and go
  const sample = async (d) => { await page.$eval('#hapticAt', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); }, d); await sleep(700);
    return page.evaluate(() => { const g = document.getElementById('hapticCanvas').getContext('2d'); const x = 10 + 2, w = 600 - 24; let lit = 0; const px = g.getImageData(x, 160, w, 1).data; for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 90 && px[i + 1] < 140) lit++; return lit / w; }); };
  const far = await sample(0.2);
  const nearSamples = []; for (let i = 0; i < 6; i++) nearSamples.push(await sample(0.02));
  check('preview: nothing beyond the start distance', far < 0.02, far);
  check('preview: close = strong (about 55 % at strength 60 %)', Math.max(...nearSamples) > 0.4, nearSamples);
  check('preview: tick comes and goes', Math.min(...nearSamples) < 0.05, nearSamples);
  await page.screenshot({ path: path.join(OUT, 'editor_detail.png') });
  const canvas = await page.$('#hapticCanvas'); await canvas.screenshot({ path: path.join(OUT, 'editor_haptic_preview.png') });

  // the list shows it, and the file the editor would save carries the new fields
  const listText = await page.evaluate(() => document.getElementById('list').textContent);
  check('list marks fine grid, part and vibration', /세밀 2 cm/.test(listText) && /부위/.test(listText) && /〰/.test(listText), listText.slice(0, 200));
  const saved = await page.evaluate(() => { const d = window.__editor.data; return JSON.parse(JSON.stringify({ voxel: d.voxel, collisions: d.collisions.map(({ mesh, ...r }) => r) })); });
  const part = saved.collisions.find((c) => c.parent);
  check('saved form: per-shape voxel, parent, haptic fields', part && part.voxel === 0.02 && part.haptic === 'tick' && part.hapticRange === 0.12, part && { voxel: part.voxel, haptic: part.haptic });
  check('undo works across these steps', await page.evaluate(() => { for (let i = 0; i < 20; i++) document.getElementById('undo').click(); return window.__editor.data.collisions.every((c) => !c.parent); }));
} catch (e) { console.log('FAIL', e.stack); failed++; }
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close(); server.kill();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
