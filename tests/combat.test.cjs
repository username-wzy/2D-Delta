const test = require('node:test');
const assert = require('node:assert/strict');
const combat = import('../client/js/combat.js');
const fresh = (extra = {}) => ({ hp: 100, maxHp: 100, armor: 100, maxArmor: 100, armorClass: 4, ...extra });
const near = (actual, expected, tolerance = 1e-8) => assert(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const from = { x: 0, y: 100 }, to = { x: 1000, y: 100 };

test('unarmored damage affects HP in full and reports actual loss', async () => {
  const { applyDamage } = await combat, p = fresh({ armor: 0 });
  assert.deepEqual(applyDamage(p, 30, 0), { hpDamage: 30, armorDamage: 0, penetrated: true, killed: false });
  assert.equal(p.hp, 70); assert.equal(p.armor, 0);
});

test('unpenetrated armor absorbs 90 percent and HP takes the remainder', async () => {
  const { applyDamage } = await combat, p = fresh();
  assert.deepEqual(applyDamage(p, 40, 39), { hpDamage: 4, armorDamage: 36, penetrated: false, killed: false });
  assert.equal(p.hp, 96); assert.equal(p.armor, 64);
});

test('penetration equal to armorClass times ten passes the threshold', async () => {
  const { applyDamage } = await combat, p = fresh();
  const result = applyDamage(p, 40, 40);
  assert.equal(result.penetrated, true); assert.equal(result.hpDamage, 40); assert.equal(result.armorDamage, 14);
  assert.equal(p.hp, 60); assert.equal(p.armor, 86);
});

test('one armor durability cannot absorb an entire unpenetrated hit', async () => {
  const { applyDamage } = await combat, p = fresh({ armor: 1 });
  const result = applyDamage(p, 40, 0);
  assert.equal(result.armorDamage, 1); assert.equal(result.hpDamage, 39);
  assert.equal(p.armor, 0); assert.equal(p.hp, 61);
});

test('a broken vest does not keep blocking subsequent damage', async () => {
  const { applyDamage } = await combat, p = fresh({ armor: 40 });
  assert.equal(applyDamage(p, 50, 0).hpDamage, 10);
  assert.equal(p.hp, 90); assert.equal(p.armor, 0);
  assert.equal(applyDamage(p, 50, 0).hpDamage, 50); assert.equal(p.hp, 40);
});

test('the same penetration succeeds against light armor and fails against heavy armor', async () => {
  const { applyDamage } = await combat;
  const light = fresh({ armorClass: 2 }), heavy = fresh({ armorClass: 5 });
  assert.equal(applyDamage(light, 20, 30).penetrated, true);
  assert.equal(applyDamage(heavy, 20, 30).penetrated, false);
  assert(light.hp < heavy.hp);
});

test('penetrating armor wear cannot exceed remaining durability', async () => {
  const { applyDamage } = await combat, p = fresh({ armor: 1 });
  const result = applyDamage(p, 50, 100);
  assert.equal(result.armorDamage, 1); assert.equal(p.armor, 0); assert.equal(p.hp, 50);
});

test('overkill clamps HP and reports death only once', async () => {
  const { applyDamage } = await combat, p = fresh({ hp: 5 });
  const result = applyDamage(p, 200, 100);
  assert.equal(p.hp, 0); assert.equal(result.hpDamage, 5); assert.equal(result.killed, true);
  const remainingArmor = p.armor;
  assert.deepEqual(applyDamage(p, 20, 100), { hpDamage: 0, armorDamage: 0, penetrated: false, killed: false });
  assert.equal(p.armor, remainingArmor);
});

test('negative, nonfinite and zero damage cannot heal or damage a valid target', async () => {
  const { applyDamage } = await combat;
  for (const damage of [-1, -Infinity, Infinity, NaN, 0, undefined, '50']) {
    const p = fresh({ hp: 50, armor: 30 });
    assert.deepEqual(applyDamage(p, damage, 100), { hpDamage: 0, armorDamage: 0, penetrated: false, killed: false });
    assert.equal(p.hp, 50); assert.equal(p.armor, 30);
  }
});

test('invalid penetration is treated as zero instead of bypassing armor', async () => {
  const { applyDamage } = await combat;
  for (const penetration of [-1, NaN, Infinity, -Infinity]) {
    const p = fresh(); const result = applyDamage(p, 20, penetration);
    assert.equal(result.penetrated, false); assert.equal(p.hp, 98); assert.equal(p.armor, 82);
  }
});

test('invalid or out of bounds target values never produce NaN or revive the dead', async () => {
  const { applyDamage } = await combat;
  for (const hp of [NaN, Infinity, -100, 0]) {
    const p = fresh({ hp }); const result = applyDamage(p, 30, 100);
    assert.equal(p.hp, 0); assert.equal(result.killed, false); assert.equal(p.armor, 100);
  }
  const p = fresh({ hp: 200, armor: 200 }); applyDamage(p, 10, 100);
  assert.equal(p.hp, 90); near(p.armor, 96.5);
  const badArmor = fresh({ armor: NaN }); applyDamage(badArmor, 10, 0); assert.equal(badArmor.hp, 90); assert.equal(badArmor.armor, 0);
  assert.equal(applyDamage(null, 20, 10).hpDamage, 0);
});

test('bare target objects and fractional damage stay finite through repeated hits', async () => {
  const { applyDamage } = await combat;
  const bare = { hp: 10 }; applyDamage(bare, 1); assert.equal(bare.hp, 9); assert.equal(bare.armor, 0);
  const p = fresh();
  for (let i = 0; i < 2000; i++) applyDamage(p, 0.13, 0);
  assert(Number.isFinite(p.hp) && p.hp >= 0 && p.hp <= 100);
  assert(Number.isFinite(p.armor) && p.armor >= 0 && p.armor <= 100);
});

test('free throws obey aim distance and maximum range', async () => {
  const { resolveThrow } = await combat;
  const far = resolveThrow(from, to, []);
  near(far.x, 500); near(far.y, 100); near(far.distance, 500); assert.equal(far.blocked, false);
  const close = resolveThrow(from, { x: 30, y: 140 }, []);
  near(close.x, 30); near(close.y, 140); near(close.distance, 50);
  const custom = resolveThrow(from, to, [], 200); near(custom.x, 200);
});

test('a throw stops radius plus surface padding before a solid wall', async () => {
  const { resolveThrow } = await combat, wall = { x: 200, y: 0, w: 20, h: 200 };
  const hit = resolveThrow(from, to, [wall]);
  near(hit.x, 193.99); near(hit.y, 100); near(hit.distance, 193.99);
  assert.equal(hit.blocked, true); assert.equal(hit.wall, wall); assert(hit.x + 6 < wall.x);
});

test('trees and walls marked nonblocking for LoS still block low grenade throws', async () => {
  const { resolveThrow } = await combat;
  const tree = { x: 100, y: 0, w: 20, h: 200, emoji: String.fromCodePoint(0x1F332), isBlockingLoS: false };
  const hit = resolveThrow(from, to, [tree]);
  assert.equal(hit.blocked, true); assert.equal(hit.wall, tree); near(hit.x, 93.99);
});

test('nearest wall is chosen independently of wall iteration order', async () => {
  const { resolveThrow } = await combat;
  const close = { x: 100, y: 0, w: 5, h: 200 }, far = { x: 300, y: 0, w: 5, h: 200 };
  for (const walls of [[far, close], [close, far]]) {
    const hit = resolveThrow(from, to, walls); assert.equal(hit.wall, close); near(hit.x, 93.99);
  }
});

test('walls after the target or maximum range cannot block a throw', async () => {
  const { resolveThrow } = await combat;
  const hit = resolveThrow(from, { x: 100, y: 100 }, [{ x: 120, y: 0, w: 5, h: 200 }]);
  near(hit.x, 100); assert.equal(hit.blocked, false);
  const far = resolveThrow(from, to, [{ x: 520, y: 0, w: 5, h: 200 }]);
  near(far.x, 500); assert.equal(far.blocked, false);
});

test('vertical, reverse and diagonal throws collide on the correct wall face', async () => {
  const { resolveThrow } = await combat;
  const vertical = resolveThrow({ x: 100, y: 0 }, { x: 100, y: 500 }, [{ x: 0, y: 200, w: 200, h: 10 }]);
  near(vertical.y, 193.99); near(vertical.x, 100);
  const reverse = resolveThrow({ x: 500, y: 100 }, { x: 0, y: 100 }, [{ x: 200, y: 0, w: 10, h: 200 }]);
  near(reverse.x, 216.01); assert.equal(reverse.blocked, true);
  const diagonal = resolveThrow({ x: 0, y: 0 }, { x: 400, y: 400 }, [{ x: 100, y: 0, w: 10, h: 200 }]);
  near(diagonal.x, diagonal.y); assert(diagonal.x < 94 && diagonal.x > 93.9);
});

test('parallel off-axis walls do not block a grenade path', async () => {
  const { resolveThrow } = await combat;
  const hit = resolveThrow(from, to, [{ x: 100, y: 120, w: 20, h: 20 }]);
  near(hit.x, 500); assert.equal(hit.blocked, false);
});

test('a larger grenade radius catches a path that a point can pass', async () => {
  const { resolveThrow } = await combat, wall = { x: 100, y: 104, w: 20, h: 20 };
  assert.equal(resolveThrow(from, to, [wall], 500, 0).blocked, false);
  assert.equal(resolveThrow(from, to, [wall], 500, 6).blocked, true);
});

test('throws starting inside an obstacle stop immediately; touching can move away', async () => {
  const { resolveThrow } = await combat, wall = { x: 0, y: 0, w: 100, h: 100 };
  const inside = resolveThrow({ x: 50, y: 50 }, { x: 500, y: 50 }, [wall]);
  near(inside.x, 50); near(inside.distance, 0); assert.equal(inside.blocked, true);
  const away = resolveThrow({ x: 106, y: 50 }, { x: 200, y: 50 }, [wall]);
  near(away.x, 200); assert.equal(away.blocked, false);
  const into = resolveThrow({ x: 106, y: 50 }, { x: 50, y: 50 }, [wall]);
  near(into.x, 106); assert.equal(into.blocked, true);
});

test('zero-length, zero-range and invalid throws return a finite stationary point', async () => {
  const { resolveThrow } = await combat;
  for (const result of [resolveThrow(from, from, []), resolveThrow(from, to, [], 0), resolveThrow(from, to, [], -10),
    resolveThrow(from, { x: NaN, y: 50 }, []), resolveThrow(null, to, []), resolveThrow(from, to, [], Infinity)]) {
    assert(Number.isFinite(result.x) && Number.isFinite(result.y)); near(result.distance, 0);
  }
});

test('invalid walls are ignored without corrupting a valid throw', async () => {
  const { resolveThrow } = await combat;
  const hit = resolveThrow(from, to, [null, { x: NaN, y: 0, w: 5, h: 100 }, { x: 100, y: 0, w: -1, h: 200 }]);
  near(hit.x, 500); assert.equal(hit.blocked, false);
});

test('nearby wall faces still choose the physically nearest wall before padding', async () => {
  const { resolveThrow } = await combat;
  const far = { x: 100, y: 0, w: 1, h: 200 }, nearWall = { x: 99.995, y: 0, w: 1, h: 200 };
  const hit = resolveThrow(from, to, [far, nearWall]);
  assert.equal(hit.wall, nearWall); near(hit.x, 93.985);
});

test('a point just inside a wall cannot escape detection through a sample epsilon', async () => {
  const { resolveThrow } = await combat, wall = { x: 0, y: 0, w: 100, h: 100 };
  const hit = resolveThrow({ x: 105.999999, y: 50 }, { x: 200, y: 50 }, [wall]);
  assert.equal(hit.blocked, true); near(hit.distance, 0);
});
