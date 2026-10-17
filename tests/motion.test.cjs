const test = require('node:test');
const assert = require('node:assert/strict');
const physics = import('../client/js/physics.js');
const fresh = (extra = {}) => ({ x: 100, y: 100, size: 20, stamina: 100, maxStamina: 100, baseSpeed: 100, sprintMultiplier: 2, ...extra });
const near = (actual, expected, tolerance = 1e-6) => assert(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
async function move(p, dt, keys = {}, walls = [], width = 10000, height = 10000) { (await physics).movePlayer(p, dt, keys, walls, width, height); }

test('exhaustion cannot oscillate between running and walking while Shift is held', async () => {
  const p = fresh({ stamina: 1 });
  await move(p, 0.1, { d: true, shift: true });
  assert.equal(p.sprintExhausted, true);
  for (let i = 0; i < 180; i++) { await move(p, 1 / 60, { d: true, shift: true }); assert.equal(p.isSprinting, false); }
  assert(p.stamina >= 20, 'walking should eventually recover stamina');
  assert.equal(p.sprintExhausted, true, 'holding Shift must not auto restart');
});

test('a brief Shift release below the restart threshold does not clear exhaustion', async () => {
  const p = fresh({ stamina: 0 });
  await move(p, 0.1, { d: true, shift: true });
  await move(p, 0.1, {});
  assert.equal(p.sprintExhausted, true);
  await move(p, 0.1, { d: true, shift: true });
  assert.equal(p.isSprinting, false);
});

test('release Shift and recover at least 20 percent before a new sprint', async () => {
  const p = fresh({ stamina: 0 });
  await move(p, 1, {});
  assert.equal(p.sprintExhausted, false);
  assert(p.stamina >= 20);
  const before = p.stamina;
  await move(p, 0.1, { d: true, shift: true });
  assert.equal(p.isSprinting, true);
  near(p.stamina, before - 3.5);
});

test('running consumes 35 per second; recovery begins after 0.8 seconds', async () => {
  const p = fresh();
  await move(p, 1, { d: true, shift: true });
  near(p.stamina, 65);
  await move(p, 0.4, {}); near(p.stamina, 65);
  await move(p, 0.4, {}); near(p.stamina, 65);
  await move(p, 0.2, {}); near(p.stamina, 72);
});

test('walking recovers at 15 per second and resting at 35, capped by max', async () => {
  const walking = fresh({ stamina: 30 });
  await move(walking, 1, { d: true }); near(walking.stamina, 45);
  const resting = fresh({ stamina: 30 });
  await move(resting, 1, {}); near(resting.stamina, 65);
  await move(resting, 10, {}); near(resting.stamina, 100);
});

test('stationary Shift and contradictory directions do not consume stamina', async () => {
  for (const keys of [{ shift: true }, { shift: true, a: true, d: true, w: true, s: true }]) {
    const p = fresh({ stamina: 50 });
    await move(p, 0.5, keys);
    near(p.stamina, 67.5); near(p.x, 100); near(p.y, 100);
    assert.equal(p.isSprinting, false); assert.equal(p.isMoving, false);
  }
});

test('pressing into a wall does not consume stamina or report moving/sprinting', async () => {
  const p = fresh({ stamina: 60 });
  await move(p, 1, { d: true, shift: true }, [{ x: 108, y: 0, w: 50, h: 500 }]);
  near(p.x, 100); near(p.stamina, 95);
  assert.equal(p.isMoving, false); assert.equal(p.isSprinting, false); near(p.spread, 0.02);
});

test('pressing out of map bounds does not consume stamina', async () => {
  const p = fresh({ x: 190, stamina: 60 });
  await move(p, 1, { d: true, shift: true }, [], 200, 200);
  near(p.x, 190); near(p.stamina, 95); assert.equal(p.isSprinting, false);
});

test('diagonal movement and drain match cardinal movement', async () => {
  const cardinal = fresh(), diagonal = fresh();
  await move(cardinal, 0.5, { d: true, shift: true });
  await move(diagonal, 0.5, { d: true, s: true, shift: true });
  near(Math.hypot(diagonal.x - 100, diagonal.y - 100), cardinal.x - 100);
  near(diagonal.stamina, cardinal.stamina);
});

test('a wall blocks its normal axis while allowing sliding, with proportional drain', async () => {
  const p = fresh();
  await move(p, 0.5, { d: true, s: true, shift: true }, [{ x: 108, y: 0, w: 50, h: 1000 }]);
  near(p.x, 100); assert(p.y > 100);
  near(p.stamina, 100 - 35 * 0.5 / Math.SQRT2);
});

test('swept movement cannot tunnel through thin walls during a long frame', async () => {
  const p = fresh({ baseSpeed: 1200 });
  await move(p, 0.25, { d: true, shift: true }, [{ x: 150, y: 0, w: 2, h: 300 }]);
  near(p.x, 142); assert(p.stamina > 90, 'only actual travel consumes stamina');
});

test('current map dimensions constrain both axes and a corner does not drain stamina', async () => {
  const p = fresh({ x: 630, y: 310 });
  await move(p, 0.5, { d: true, s: true, shift: true }, [], 640, 320);
  near(p.x, 630); near(p.y, 310); near(p.stamina, 100);
  const wide = fresh(); await move(wide, 1, { d: true }, [], 6400, 2000); near(wide.x, 200);
});

test('invalid or zero elapsed time cannot move or alter stamina', async () => {
  for (const dt of [0, -1, NaN, Infinity]) {
    const p = fresh(); await move(p, dt, { d: true, shift: true });
    near(p.x, 100); near(p.stamina, 100); assert.equal(p.isSprinting, false);
  }
});

test('stamina state is finite and clamped; operator maxima define restart threshold', async () => {
  for (const maxStamina of [70, 100, 120]) {
    const p = fresh({ maxStamina, stamina: maxStamina * 0.19, sprintExhausted: true });
    await move(p, 0.001, {}); assert.equal(p.sprintExhausted, true);
    await move(p, 0.1, {}); assert.equal(p.sprintExhausted, false);
    await move(p, 0.01, { d: true, shift: true }); assert.equal(p.isSprinting, true);
  }
  const p = fresh({ stamina: NaN }); await move(p, 0.1, {}); assert(Number.isFinite(p.stamina));
});

test('30/60/144 FPS produce the same exhausted distance and recovery', async () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const p = fresh({ stamina: 35 });
    for (let i = 0; i < fps * 3; i++) await move(p, 1 / fps, { d: true, shift: true });
    results.push(p);
    assert.equal(p.isSprinting, false); assert.equal(p.sprintExhausted, true);
  }
  for (const p of results) { near(p.x, 500, 0.001); near(p.stamina, 18, 0.001); }
});

test('axis-parallel rays never enter an off-axis box', async () => {
  const { rayBoxIntersect } = await physics;
  assert.equal(rayBoxIntersect({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 100000, w: 1, h: 100000 }), null);
  assert.equal(rayBoxIntersect({ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 100000, y: 2, w: 100000, h: 1 }), null);
  near(rayBoxIntersect({ x: 10, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 20, w: 20, h: 20 }), 20);
});

test('a ray starting on or inside a wall hits at zero and occludes enemies', async () => {
  const { rayBoxIntersect, raycastHitscan } = await physics;
  const wall = { x: 10, y: 0, w: 10, h: 20 };
  near(rayBoxIntersect({ x: 15, y: 10 }, { x: 1, y: 0 }, wall), 0);
  const hit = raycastHitscan({ x: 10, y: 10 }, { x: 1, y: 0 }, 100, [wall], [{ x: 50, y: 10, size: 10 }]);
  assert.equal(hit?.type, 'wall'); near(hit.x, 10);
});

test('wall hit wins a tie, exact maximum range is included, trees remain penetrable', async () => {
  const { raycastHitscan } = await physics;
  const origin = { x: 0, y: 10 }, dir = { x: 1, y: 0 };
  const wall = { x: 100, y: 0, w: 10, h: 20 }, bot = { x: 105, y: 10, size: 10 };
  assert.equal(raycastHitscan(origin, dir, 100, [wall], [bot])?.type, 'wall');
  assert.equal(raycastHitscan(origin, dir, 99, [wall], [bot]), null);
  const tree = { x: 20, y: 0, w: 10, h: 20, emoji: String.fromCodePoint(0x1F332) };
  assert.equal(raycastHitscan(origin, dir, 110, [tree], [bot])?.type, 'bot');
});

test('line of sight handles identical points, parallel walls and actual occlusion', async () => {
  const { hasLineOfSight, rayBoxIntersect } = await physics;
  assert.equal(hasLineOfSight({ x: 10, y: 10 }, { x: 10, y: 10 }, []), true);
  const walls = [{ x: 20, y: 0, w: 10, h: 20, isBlockingLoS: true }];
  assert.equal(hasLineOfSight({ x: 0, y: 10 }, { x: 50, y: 10 }, walls), false);
  assert.equal(hasLineOfSight({ x: 0, y: 30 }, { x: 50, y: 30 }, walls), true);
  assert.equal(rayBoxIntersect({ x: 0, y: 0 }, { x: 0, y: 0 }, walls[0]), null);
});
