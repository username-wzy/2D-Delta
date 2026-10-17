// lootdata.js - Data-driven loot system. Loads definitions from JSON.
let items = [];
let byId = {};
let spawnPool = [];

export async function loadLootData(path = 'data/loot.json') {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    items = await resp.json();
  } catch (e) {
    console.warn('loot.json load failed, using built-in fallback:', e.message);
    items = getFallback();
  }
  // Build lookup map
  byId = {};
  for (const item of items) {
    byId[item.id] = item;
  }
  // Build weighted spawn pool
  buildSpawnPool();
  console.log(`📦 Loaded ${items.length} loot types`);
  return items;
}

function buildSpawnPool() {
  spawnPool = [];
  for (const item of items) {
    for (let i = 0; i < (item.weight || 10); i++) {
      spawnPool.push(item.id);
    }
  }
}

function getFallback() {
  return [
    { id: 'cash', emoji: '💵', name: '大捆现金 ($5,000)', value: 5000, weight: 20, onPickup: null },
    { id: 'gem', emoji: '💎', name: '高价值蓝钻 ($35,000)', value: 35000, weight: 5, onPickup: null },
    { id: 'box', emoji: '📦', name: '军用物资箱', value: 8000, weight: 10, onPickup: null },
    { id: 'weapon_ak47', emoji: '🔫', name: '突击步枪 (AK-47)', value: 12000, weight: 5, onPickup: null },
    { id: 'armor_heavy', emoji: '🛡️', name: '重型防弹护甲 (Class 5)', value: 15000, weight: 4, onPickup: null },
    { id: 'medkit', emoji: '💊', name: '军用医疗包 (+50 HP)', value: 2000, weight: 10, onPickup: 'heal_50' },
    { id: 'grenade', emoji: '🧨', name: '破片手榴弹', value: 3000, weight: 5, onPickup: null },
    { id: 'ammo_9mm', emoji: '📦', name: '9mm 弹药箱 (120发)', value: 1500, weight: 12, onPickup: null, ammoType: '9mm', ammoAmount: 120 },
    { id: 'keycard_red', emoji: '🔑', name: '红色钥匙卡', value: 50000, weight: 1, onPickup: null },
    { id: 'dogtag', emoji: '🏷️', name: '特工身份牌 ($2,000)', value: 2000, weight: 15, onPickup: null },
  ];
}

/** Get a random loot type ID weighted by spawn probability */
export function randomLootType() {
  if (spawnPool.length === 0) buildSpawnPool();
  return spawnPool[Math.floor(Math.random() * spawnPool.length)];
}

/** Get loot definition by ID */
export function getLootDef(id) {
  return byId[id] || { emoji: '📦', name: '未知物品', value: 0, onPickup: null };
}

/** Get emoji for a loot type ID */
export function lootEmoji(id) {
  return getLootDef(id).emoji;
}

/** Get display name for a loot type ID */
export function lootName(id) {
  return getLootDef(id).name;
}

/** Get onPickup effect for a loot type ID */
export function lootEffect(id) {
  return getLootDef(id).onPickup;
}

/** All loaded item definitions */
export function allItems() {
  return items;
}
