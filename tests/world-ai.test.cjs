// Real world/AI modules; no HTTP listener, browser, or writes are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const client = path.resolve(__dirname, '../client');
const modules = Promise.all([import('../client/js/ai.js'), import('../client/js/entities.js'), import('../client/js/maploader.js')]);
const freshMap = () => ({ name: '地图回归', width: 10, height: 8, tileSize: 64,
  tiles: Array.from({ length: 8 }, (_, r) => Array.from({ length: 10 }, (_, c) => r === 0 || r === 7 || c === 0 || c === 9 ? 1 : 0)),
  spawns: [{ x: 1, y: 1, team: 'pmc' }], containers: [{ x: 2, y: 2, type: 'wardrobe' }],
  extractions: [{ x: 7, y: 5, w: 1, h: 1 }] });
const player = (extra = {}) => ({ x: 200, y: 100, hp: 1000, maxHp: 1000, armor: 0, armorClass: 0, isMoving: false, ...extra });
async function guard(extra = {}) {
  const [, { Bot }] = await modules;
  return Object.assign(new Bot(100, 100, { visionRange: 500, attackRange: 500, reactionDelay: 0.3, fireRate: 0.6, damage: 20 }),
    { speed: 0, facingAngle: 0, aiTickTimer: 0 }, extra);
}

test.before(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async name => {
    try { return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.resolve(client, name), 'utf8')) }; }
    catch { return { ok: false, status: 404 }; }
  };
  try {
    const botData = await import('../client/js/botdata.js'), operatorData = await import('../client/js/operatordata.js');
    await botData.loadBotData(); await operatorData.loadOperatorData();
  } finally { globalThis.fetch = originalFetch; }
});

test('the shipped factory remains valid and all three extraction definitions survive loading', async () => {
  const [, , { buildWorldFromMap }] = await modules;
  const map = JSON.parse(fs.readFileSync(path.join(client, 'maps/factory_01.json'), 'utf8'));
  const world = buildWorldFromMap(map);
  assert.equal(world.worldWidth, 3200); assert.equal(world.worldHeight, 2432);
  assert.equal(world.containers.length, 18); assert.equal(world.extractions.length, 3);
  assert(world.bots.every(bot => bot.x >= bot.size / 2 && bot.y >= bot.size / 2));
});

test('disconnected or entirely blocked exits are rejected before deployment', async () => {
  const [, , { buildWorldFromMap }] = await modules;
  const map = { width: 5, height: 5, tileSize: 64, tiles: ['0,0,1,1,1','0,0,1,1,1','1,1,1,1,1','1,1,1,0,0','1,1,1,0,0'],
    spawns: [{ x: 0, y: 0, team: 'pmc' }], extractions: [{ x: 3, y: 3, w: 1, h: 1 }] };
  assert.throws(() => buildWorldFromMap(map), /无法到达/);
  const blocked = freshMap(); blocked.tiles[5][7] = 1;
  assert.throws(() => buildWorldFromMap(blocked), /无法到达/);
});

test('one reachable exit is sufficient and legacy extraction format still loads', async () => {
  const [, , { buildWorldFromMap }] = await modules;
  const map = freshMap(); map.tiles[5][7] = 1;
  map.extractions.push({ x: 2, y: 5, w: 1, h: 1 });
  assert.equal(buildWorldFromMap(map).extractions.length, 2);
  const legacy = freshMap(); legacy.extraction = legacy.extractions[0]; delete legacy.extractions;
  assert.equal(buildWorldFromMap(legacy).extractions[0].condition, 'standard');
});

test('every player spawn must have a route, and trees obstruct that route', async () => {
  const [, , { buildWorldFromMap }] = await modules;
  const map = freshMap();
  for (let r = 1; r < 7; r++) map.tiles[r][4] = 2;
  assert.throws(() => buildWorldFromMap(map), /无法到达/);
  map.extractions.push({ x: 2, y: 5, w: 1, h: 1 });
  assert.doesNotThrow(() => buildWorldFromMap(map));
  map.spawns.push({ x: 7, y: 2, team: 'pmc' });
  map.extractions = [map.extractions[1]];
  assert.throws(() => buildWorldFromMap(map), /无法到达/);
});

test('32px narrow corridors are checked against actual operator clearance', async () => {
  const [, , { buildWorldFromMap }] = await modules;
  const map = { width: 12, height: 9, tileSize: 32,
    tiles: Array.from({ length: 9 }, (_, r) => Array.from({ length: 12 }, (_, c) => r === 0 || r === 8 || c === 0 || c === 11 || (c === 5 && r !== 4) ? 1 : 0)),
    spawns: [{ x: 2, y: 4, team: 'pmc' }], extractions: [{ x: 8, y: 4, w: 1, h: 1 }] };
  assert.throws(() => buildWorldFromMap(map), /无法到达|空间不足/);
  assert.doesNotThrow(() => buildWorldFromMap(map, 32));
});

test('paid extraction metadata is validated and preserved without pixel/unit confusion', async () => {
  const [, , { buildWorldFromMap }] = await modules;
  const map = freshMap(); Object.assign(map.extractions[0], { condition: 'paid', cost: 3000, duration: 8 });
  const ext = buildWorldFromMap(map).extractions[0];
  assert.deepEqual({ condition: ext.condition, cost: ext.cost, duration: ext.duration, x: ext.x }, { condition: 'paid', cost: 3000, duration: 8, x: 448 });
  for (const change of [{ condition: 'random' }, { cost: 0 }, { cost: 100001 }, { cost: 1.1 }, { duration: 0 }, { duration: 61 }, { duration: '10' }, { duration: null }, { condition: null }, { cost: null }]) {
    const invalid = structuredClone(map); Object.assign(invalid.extractions[0], change);
    assert.throws(() => buildWorldFromMap(invalid), /撤离点/);
  }
});

test('invalid metadata is rejected explicitly, including unknown container types', async () => {
  const [, , { buildWorldFromMap }] = await modules;
  const mutate = [m => { m.containers[0].type = 'teleport'; }, m => { m.containers = {}; }, m => { m.spawns = [null]; },
    m => { m.spawns[0].x = 1.5; }, m => { m.spawns[0].team = 'other'; }, m => { m.extractions = [null]; },
    m => { m.name = {}; }, m => { m.tileSize = null; }, m => { m.worldWidth = 123; }, m => { m.patrolNodes = [{ x: 2, y: 2, radius: -1 }]; },
    m => { m.containers[0].searchDuration = Infinity; }, m => { m.containers[0].requiredKey = 'unknown'; },
    m => { m.tiles[1] = '1,0,,0,0,0,0,0,0,1'; }, m => { m.extractions[0].name = 15; }];
  for (const change of mutate) { const map = freshMap(); change(map); assert.throws(() => buildWorldFromMap(map)); }
});

test('guards retain the last seen target and direction when the player moves behind cover', async () => {
  const [{ updateBots }, { Wall }] = await modules;
  const bot = await guard(), target = player();
  updateBots(0.01, [bot], target, [], []);
  assert.equal(bot.targetX, 200); assert.equal(bot.hasVisualContact, true);
  target.x = 450; target.y = 350;
  const wall = new Wall(250, 0, 32, 1000);
  updateBots(0.3, [bot], target, [], [wall]);
  assert.equal(bot.hasVisualContact, false); assert.equal(bot.targetX, 200); assert.equal(bot.targetY, 100);
  assert.equal(bot.facingAngle, 0);
  target.x = 700; target.y = 500;
  updateBots(0.3, [bot], target, [], [wall]);
  assert.equal(bot.targetX, 200); assert.equal(bot.lastKnownPlayerY, 100);
});

test('reaction delay expires once during sustained contact instead of restarting every AI tick', async () => {
  const [{ updateBots }] = await modules;
  const bot = await guard(), target = player();
  updateBots(0.01, [bot], target, [], []);
  assert(bot.reactionDelay > 0); assert.equal(target.hp, 1000);
  for (let i = 0; i < 10; i++) updateBots(0.05, [bot], target, [], []);
  assert.equal(bot.reactionDelay, 0); assert(target.hp < 1000);
  assert.equal(bot.state, 'aggro');
});

test('new walls and distance changes stop attacks even before the next decision tick', async () => {
  const [{ updateBots }, { Wall }] = await modules;
  const bot = await guard({ reactionDelayCfg: 0 }), target = player();
  updateBots(0.01, [bot], target, [], []); bot.fireCooldown = 0;
  const health = target.hp;
  assert.equal(updateBots(0.01, [bot], target, [], [new Wall(140, 0, 32, 300)]).hit, false);
  target.x = 900; bot.fireCooldown = 0;
  assert.equal(updateBots(0.01, [bot], target, [], []).hit, false);
  assert.equal(target.hp, health);
});

test('tree and thin-wall movement collisions stop fast guards without tunneling', async () => {
  const [{ updateBots }, { Wall }] = await modules;
  for (const emoji of ['🌲', '🧱']) {
    const bot = await guard({ state: 'investigate', size: 20, speed: 2000, targetX: 400, targetY: 100, aiTickTimer: 10, investigateTimer: 10 });
    updateBots(0.1, [bot], player({ x: 800 }), [], [new Wall(150, 0, 1, 300, emoji)], 1000, 1000);
    assert(bot.x <= 142 + 1e-6, emoji + ': guard crossed obstacle');
  }
});

test('guards and their patrol targets remain inside supplied custom world dimensions', async () => {
  const [{ updateBots }] = await modules;
  const bot = await guard({ x: 200, y: 500, size: 20, state: 'investigate', targetX: 1000, targetY: -1000, speed: 1000, aiTickTimer: 10, investigateTimer: 10 });
  updateBots(0.1, [bot], player({ x: 5000 }), [], [], 100, 100);
  assert(bot.x >= 10 && bot.x <= 90); assert(bot.y >= 10 && bot.y <= 90);
  assert(bot.targetX >= 10 && bot.targetX <= 90); assert(bot.targetY >= 10 && bot.targetY <= 90);
});

test('nearby allies share observed positions regardless of bot array order', async () => {
  const [{ updateBots }] = await modules;
  for (const reverse of [false, true]) {
    const observer = await guard(), follower = await guard({ y: 200, visionRange: 20 });
    const bots = reverse ? [follower, observer] : [observer, follower];
    updateBots(0.01, bots, player({ x: 300 }), [], []);
    assert.equal(follower.state, 'investigate'); assert.equal(follower.targetX, 300); assert.equal(follower.targetY, 100);
  }
});

test('stationary hidden players do not create footsteps, but movement and real sound do', async () => {
  const [{ updateBots }] = await modules;
  const bot = await guard(), target = player({ x: 50 });
  updateBots(0.01, [bot], target, [], []); assert.equal(bot.state, 'patrol');
  bot.facingAngle = 0; target.isMoving = true;
  updateBots(0.3, [bot], target, [], []); assert.equal(bot.state, 'investigate');
  const listener = await guard();
  updateBots(0.01, [listener], player({ x: 900 }), [{ x: 150, y: 300, radius: 500 }], []);
  assert.equal(listener.state, 'investigate'); assert.equal(listener.targetX, 150); assert.equal(listener.targetY, 300);
});
