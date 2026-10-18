const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const inventory = import('../client/js/inventory.js');
const item = (gridW, gridH, extra = {}) => ({ gridW, gridH, ...extra });

function assertLayout(result, cols, rows) {
  const cells = new Set();
  for (const p of result.placements) {
    assert(Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y));
    assert(p.x >= 0 && p.y >= 0 && p.x + p.w <= cols && p.y + p.h <= rows);
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        const key = x + ',' + y;
        assert(!cells.has(key), 'overlap at ' + key);
        cells.add(key);
      }
    }
  }
  return cells.size;
}

test('instance dimensions support all requested footprints and manual rotation', async () => {
  const { itemDimensions } = await inventory;
  for (const [w, h] of [[1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [3, 4]]) {
    assert.deepEqual(itemDimensions(item(w, h)), { w, h });
    assert.deepEqual(itemDimensions(item(w, h, { rotated: true })), { w: h, h: w });
  }
});

test('loaded loot definitions provide dimensions but explicit instance dimensions win', async () => {
  const { itemDimensions } = await inventory;
  const { loadLootData, allItems } = await import('../client/js/lootdata.js');
  const definitions = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../client/data/loot.json'), 'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => definitions });
  try { await loadLootData(); } finally { globalThis.fetch = originalFetch; }
  const actual = allItems()[0];
  const originalDimensions = { gridW: actual.gridW, gridH: actual.gridH };
  actual.gridW = 2; actual.gridH = 3;
  try {
    assert.deepEqual(itemDimensions({ id: actual.id }), { w: 2, h: 3 });
    assert.deepEqual(itemDimensions({ type: actual.id, id: 'runtime-instance', rotated: true }), { w: 3, h: 2 });
    assert.deepEqual(itemDimensions({ id: actual.id, gridW: 4, gridH: 1 }), { w: 4, h: 1 });
  } finally {
    const source = originalDimensions;
    delete actual.gridW; delete actual.gridH;
    if (source.gridW !== undefined) actual.gridW = source.gridW;
    if (source.gridH !== undefined) actual.gridH = source.gridH;
  }
});

test('legacy, missing and malformed dimensions have finite one-cell fallbacks', async () => {
  const { itemDimensions } = await inventory;
  for (const value of [null, undefined, {}, { id: 'old-save-unknown' }, item(0, -1), item(NaN, Infinity), item(1.5, '2')]) {
    assert.deepEqual(itemDimensions(value), { w: 1, h: 1 });
  }
  assert.deepEqual(itemDimensions(item(2, NaN)), { w: 2, h: 1 });
  assert.deepEqual(itemDimensions(item(Number.MAX_SAFE_INTEGER, 1)), { w: Number.MAX_SAFE_INTEGER, h: 1 });
});

test('first-fit packs different footprints without overlap and accounts actual cells', async () => {
  const { packItems, inventoryUsage } = await inventory;
  const items = [item(2, 3), item(1, 2), item(3, 1), item(1, 1)];
  const result = packItems(items, 4, 4);
  assert(result.ok);
  assert.equal(assertLayout(result, 4, 4), 12);
  assert.equal(inventoryUsage(items), 12);
  assert.deepEqual(result.placements.map(p => [p.x, p.y]), [[0, 0], [2, 0], [0, 3], [3, 0]]);
});

test('saved valid positions are reserved before earlier unpositioned items are placed', async () => {
  const { packItems } = await inventory;
  const saved = item(2, 2, { gridX: 0, gridY: 0 });
  const result = packItems([item(1, 1), saved], 3, 2);
  assert(result.ok); assertLayout(result, 3, 2);
  assert.deepEqual(result.placements.map(p => [p.x, p.y]), [[2, 0], [0, 0]]);
  assert.equal(result.placements[1].item, saved);
});

test('overlapping and out-of-range saved coordinates are relocated deterministically', async () => {
  const { packItems } = await inventory;
  const items = [
    item(2, 2, { gridX: 0, gridY: 0 }),
    item(2, 2, { gridX: 1, gridY: 0 }),
    item(1, 1, { gridX: 99, gridY: -1 }),
    item(1, 1, { gridX: 0.5, gridY: 1 }),
  ];
  const result = packItems(items, 5, 2);
  assert(result.ok); assert.equal(assertLayout(result, 5, 2), 10);
  assert.deepEqual(result.placements.map(p => [p.x, p.y]), [[0, 0], [2, 0], [4, 0], [4, 1]]);
  assert.deepEqual(packItems(items, 5, 2), result);
});

test('equal-looking item instances and repeated references each occupy their own cells', async () => {
  const { packItems } = await inventory;
  const shared = item(1, 1, { id: 'same', gridX: 0, gridY: 0 });
  const result = packItems([shared, shared, { ...shared }], 3, 1);
  assert(result.ok); assert.equal(assertLayout(result, 3, 1), 3);
  assert.deepEqual(result.placements.map(p => p.index), [0, 1, 2]);
  assert.deepEqual(result.placements.map(p => p.x), [0, 1, 2]);
});

test('fragmented free area cannot accept a rectangle despite enough total empty cells', async () => {
  const { packItems, canFitItem, inventoryUsage } = await inventory;
  const blockers = [item(1, 1, { gridX: 1, gridY: 0 }), item(1, 1, { gridX: 0, gridY: 1 }), item(1, 1, { gridX: 2, gridY: 2 })];
  const rectangle = item(2, 2);
  assert.equal(inventoryUsage(blockers) + inventoryUsage([rectangle]), 7);
  assert.equal(canFitItem(blockers, rectangle, 3, 3), false);
  const result = packItems([...blockers, rectangle], 3, 3);
  assert.equal(result.ok, false);
  assert.deepEqual(result.overflow.map(p => p.index), [3]);
  assert.equal(assertLayout(result, 3, 3), 3);
});

test('automatic rotation is opt-in and reports the resulting orientation', async () => {
  const { packItems, canFitItem, findPlacement } = await inventory;
  const rifle = item(3, 1);
  assert.equal(canFitItem([], rifle, 1, 3), false);
  const placement = findPlacement([], rifle, 1, 3, { allowRotation: true });
  assert.deepEqual([placement.x, placement.y, placement.w, placement.h, placement.rotated], [0, 0, 1, 3, true]);
  const turned = item(1, 3, { rotated: true });
  const result = packItems([turned], 1, 3, { allowRotation: true });
  assert.equal(result.placements[0].rotated, false);
  assertLayout(result, 1, 3);
});

test('manual orientation is honored when its saved coordinates already fit', async () => {
  const { packItems } = await inventory;
  const result = packItems([item(3, 1, { rotated: true, gridX: 1, gridY: 0 })], 2, 3);
  assert(result.ok);
  assert.deepEqual(result.placements.map(p => [p.x, p.y, p.w, p.h, p.rotated]), [[1, 0, 1, 3, true]]);
});

test('oversized items overflow while smaller later objects still fill valid space', async () => {
  const { packItems, canFitItem } = await inventory;
  const huge = item(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const result = packItems([huge, item(1, 1), item(3, 4)], 2, 2);
  assert.equal(result.ok, false);
  assert.deepEqual(result.overflow.map(p => p.index), [0, 2]);
  assert.equal(result.placements[0].index, 1);
  assert.equal(assertLayout(result, 2, 2), 1);
  assert.equal(canFitItem([huge], item(1, 1), 2, 2), false);
});

test('invalid and enormous grid dimensions fail without allocating huge matrices', async () => {
  const { packItems, canFitItem } = await inventory;
  for (const [cols, rows] of [[0, 2], [-1, 2], [2.5, 2], [NaN, 2], [Infinity, 2], ['4', 2], [2, 1e12], [65, 1], [1, 65]]) {
    const one = item(1, 1);
    const result = packItems([one], cols, rows);
    assert.equal(result.ok, false); assert.deepEqual(result.placements, []);
    assert.deepEqual(result.overflow, [{ item: one, index: 0 }]);
    assert.equal(canFitItem([], one, cols, rows), false);
  }
});

test('empty valid grids succeed, invalid collections fail, and usage stays finite', async () => {
  const { packItems, inventoryUsage, findPlacement } = await inventory;
  assert.deepEqual(packItems([], 4, 5), { ok: true, placements: [], overflow: [] });
  assert.equal(packItems(null, 4, 5).ok, false);
  assert.equal(findPlacement(null, {}, 4, 5), null);
  assert.equal(inventoryUsage(null), 0);
  assert.equal(inventoryUsage([item(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)]), Number.MAX_SAFE_INTEGER);
});

test('packing frozen source objects never writes positions, dimensions or rotation', async () => {
  const { packItems } = await inventory;
  const value = Object.freeze(item(3, 1, { gridX: 100, gridY: 100 }));
  const values = Object.freeze([value, Object.freeze(item(1, 1))]);
  const before = JSON.stringify(values);
  const result = packItems(values, 2, 3, { allowRotation: true });
  assert(result.ok); assertLayout(result, 2, 3);
  assert.equal(JSON.stringify(values), before); assert.equal(value.rotated, undefined);
});

test('deterministic stress layouts remain collision-free and include every index exactly once', async () => {
  const { packItems } = await inventory;
  let seed = 74123;
  const next = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let trial = 0; trial < 250; trial++) {
    const cols = 1 + next(8), rows = 1 + next(10);
    const items = Array.from({ length: next(24) }, () => item(1 + next(4), 1 + next(4),
      { gridX: next(cols + 3) - 1, gridY: next(rows + 3) - 1, rotated: next(2) === 1 }));
    const result = packItems(items, cols, rows, { allowRotation: true });
    assertLayout(result, cols, rows);
    const indices = [...result.placements, ...result.overflow].map(p => p.index).sort((a, b) => a - b);
    assert.deepEqual(indices, items.map((_, i) => i));
    assert.equal(result.ok, result.overflow.length === 0);
    assert.deepEqual(packItems(items, cols, rows, { allowRotation: true }), result);
  }
});
