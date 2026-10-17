// operatordata.js - Data-driven operator/character system
let operators = [];
let byId = {};

export async function loadOperatorData(path = 'data/operators.json') {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    operators = await resp.json();
  } catch (e) {
    console.warn('operators.json load failed, using built-in fallback:', e.message);
    operators = getFallback();
  }
  byId = {};
  for (const op of operators) {
    byId[op.id] = op;
  }
  console.log(`🫡 Loaded ${operators.length} operators`);
  return operators;
}

function getFallback() {
  return [
    {
      id: 'tactical', name: '战术特工', emoji: '🥷', description: '均衡型',
      size: 48, maxHp: 100, maxArmor: 80, armorClass: 4,
      maxStamina: 100, baseSpeed: 300, sprintMultiplier: 1.6, maxSlots: 12,
      gun: { name: 'TAC-SMG', damage: 28, penetration: 35, fireRate: 0.08, magSize: 30, maxAmmo: 120, reloadTime: 1.8 }
    }
  ];
}

/** Get operator definition by ID */
export function getOperatorDef(id) {
  return byId[id] || operators[0] || getFallback()[0];
}

/** All loaded operator definitions */
export function allOperators() {
  return operators;
}

/** Get the default (first) operator */
export function defaultOperator() {
  return operators[0] || getFallback()[0];
}
