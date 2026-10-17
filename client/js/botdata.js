// botdata.js - Data-driven bot/enemy system
let bots = [];
let byId = {};
let spawnPool = [];
let bossPool = [];

export async function loadBotData(path = 'data/bots.json') {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    bots = await resp.json();
  } catch (e) {
    console.warn('bots.json load failed, using built-in fallback:', e.message);
    bots = getFallback();
  }
  byId = {};
  for (const b of bots) {
    byId[b.id] = b;
  }
  buildSpawnPools();
  console.log(`🧟 Loaded ${bots.length} bot types`);
  return bots;
}

function buildSpawnPools() {
  spawnPool = [];
  bossPool = [];
  for (const b of bots) {
    for (let i = 0; i < (b.weight || 10); i++) {
      if (b.category === 'boss') {
        bossPool.push(b.id);
      } else {
        spawnPool.push(b.id);
      }
    }
  }
}

function getFallback() {
  return [
    { id: 'zombie', emoji: '🧟', category: 'melee', size: 48, hp: 80, speed: 180, damage: 30, penetration: 15, attackRange: 60, fireRate: 1.0, visionRange: 350, reactionDelay: 0.4, weight: 30 },
    { id: 'scav_gunner', emoji: '👮', category: 'ranged', size: 48, hp: 80, speed: 140, damage: 20, penetration: 25, attackRange: 350, fireRate: 0.6, visionRange: 400, reactionDelay: 0.35, weight: 30 },
    { id: 'boss_ogre', emoji: '👹', category: 'boss', size: 56, hp: 300, speed: 120, damage: 50, penetration: 40, attackRange: 400, fireRate: 0.7, visionRange: 500, reactionDelay: 0.2, weight: 5 }
  ];
}

/** Weighted random bot ID from regular spawn pool */
export function randomBotType() {
  if (spawnPool.length === 0) buildSpawnPools();
  return spawnPool[Math.floor(Math.random() * spawnPool.length)];
}

/** Weighted random boss ID from boss pool */
export function randomBossType() {
  if (bossPool.length === 0) buildSpawnPools();
  return bossPool[Math.floor(Math.random() * bossPool.length)];
}

/** Get bot definition by ID */
export function getBotDef(id) {
  return byId[id] || bots[0] || getFallback()[0];
}

/** All loaded bot definitions */
export function allBots() {
  return bots;
}
