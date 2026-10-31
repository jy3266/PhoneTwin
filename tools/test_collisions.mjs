// node tools/test_collisions.mjs — the shape maths the editor depends on.
import assert from 'node:assert/strict';
import { boxShape, cellKey, flatten, keyCell, shiftCells, transformCells, unflatten } from '../web/collision_core.js';

const distinct = (flat) => new Set(unflatten(flat).map((c) => cellKey(...c))).size;

// every cell of a room has its own key, also next to each other and below zero
const box = boxShape([1, 1, 1], [0.4, 0.4, 0.4]);
assert.equal(new Set(box.map((c) => cellKey(...c))).size, box.length);
assert.notEqual(cellKey(1, 2, 3), cellKey(1, 2, 4));
for (const c of [[0, 0, 0], [-1, 2, -3], [400, -250, 7]]) assert.deepEqual(keyCell(cellKey(...c)), c);

// moving keeps every cell and the exact shape
const flat = flatten(box), moved = shiftCells(flat, [3, -2, 5]);
assert.equal(distinct(moved), box.length);
assert.deepEqual(shiftCells(moved, [-3, 2, -5]), flat);

// a turn of 90 degrees about Y swaps width and depth of a long box and leaves no holes
const long = flatten(boxShape([0, 1, 0], [1.2, 0.2, 0.4])), v = 0.04, c = [0, 1, 0];
const s = Math.SQRT1_2, turned = transformCells(long, v, c, c, [1, 1, 1], [0, s, 0, s]);
const size = (f) => [0, 1, 2].map((a) => { const r = f.filter((_, i) => i % 3 === a); return (Math.max(...r) - Math.min(...r) + 1) * v; });
const [x0, , z0] = size(long), [x1, , z1] = size(turned);
assert.ok(Math.abs(x1 - z0) <= 2 * v && Math.abs(z1 - x0) <= 2 * v, `size ${size(turned)}`);
const fill = distinct(turned) / size(turned).reduce((p, w) => p * Math.round(w / v), 1);
assert.ok(fill > 0.9, `filled ${fill}`);

// doubling closes up, no gaps between the old cells
const doubled = transformCells(long, v, c, c, [2, 2, 2], [0, 0, 0, 1]);
const dFill = distinct(doubled) / size(doubled).reduce((p, w) => p * Math.round(w / v), 1);
assert.ok(dFill > 0.9, `doubled ${dFill}`);
console.log('collision shape tests passed');
