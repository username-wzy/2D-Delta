// weapondata.js - Weapon definitions loaded from JSON
let weapons = [];
let byId = {};

export async function loadWeaponData(path = 'data/weapons.json') {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    weapons = await resp.json();
  } catch (e) {
    console.warn('weapons.json load failed, using built-in fallback:', e.message);
    weapons = getFallback();
  }
  byId = {};
  for (const w of weapons) {
    byId[w.id] = w;
  }
  console.log(`🔫 Loaded ${weapons.length} weapons`);
  return weapons;
}

function getFallback() {
  return [
    { id: 'tac_smg', emoji: '🔫', name: 'TAC-SMG (9x19mm)', damage: 28, penetration: 35, fireRate: 0.08, magSize: 30, maxAmmo: 120, reloadTime: 1.8, ammoType: '9mm' },
    { id: 'weapon_ak47', emoji: '🔫', name: 'AK-47 突击步枪', damage: 32, penetration: 40, fireRate: 0.1, magSize: 30, maxAmmo: 90, reloadTime: 2.0, ammoType: 'rifle' },
    { id: 'weapon_mp5', emoji: '🔫', name: 'MP5-SD 冲锋枪', damage: 22, penetration: 25, fireRate: 0.06, magSize: 30, maxAmmo: 150, reloadTime: 1.5, ammoType: '9mm' },
    { id: 'weapon_shotgun', emoji: '🔫', name: 'M870 霰弹枪', damage: 45, penetration: 20, fireRate: 0.5, magSize: 6, maxAmmo: 24, reloadTime: 2.5, ammoType: 'shell' },
  ];
}

/** Get full weapon definition by ID */
export function getWeaponDef(id) {
  return byId[id] || null;
}

/** All loaded weapons */
export function allWeapons() {
  return weapons;
}
