// Shared item rules for the lobby, deployment and every pickup path.
import { getLootDef } from './lootdata.js';
import { packItems } from './inventory.js';

export function itemId(item) { return item.type || item.id; }

export function itemCategory(item) {
  const id = itemId(item) || '';
  if (id.startsWith('weapon_') || ['tac_smg', 'm249_saw'].includes(id)) return 'weapon';
  if (id.startsWith('armor_')) return 'armor';
  if (id === 'backpack') return 'backpack';
  if (id.startsWith('ammo_')) return 'ammo';
  if (id.startsWith('keycard_')) return 'key';
  if (['medkit', 'medkit_large', 'injector'].includes(id)) return 'medicine';
  if (id.startsWith('repair_')) return 'repair';
  if (id === 'grenade') return 'grenade';
  return 'valuable';
}

export const RARITY_NAMES = ['普通', '优良', '稀有', '史诗', '传说', '至臻'];
export function itemRarity(item) {
  if (Number.isInteger(item.rarity)) return Math.max(1, Math.min(6, item.rarity));
  const defined = getLootDef(itemId(item)).rarity;
  if (defined) return defined;
  const value = item.value ?? item.price ?? 0;
  return value >= 35000 ? 6 : value >= 25000 ? 5 : value >= 15000 ? 4 : value >= 7000 ? 3 : value >= 2000 ? 2 : 1;
}

export function isGear(item) { return ['weapon', 'armor', 'backpack'].includes(itemCategory(item)); }

export function equipmentError(item, equipped) {
  const category = itemCategory(item);
  if (category === 'valuable') return '贵重物品只能存放或出售';
  const count = equipped.filter(e => itemCategory(e) === category).length;
  if (category === 'weapon' && count >= 2) return '最多携带两把武器';
  if (category === 'armor' && count >= 1) return '只能装备一件护甲';
  if (category === 'backpack' && count >= 1) return '只能装备一个背包';
  return '';
}

export function loadoutCapacity(baseSlots, equipped) {
  return baseSlots + (equipped.some(e => itemCategory(e) === 'backpack') ? 12 : 0);
}

export function medicineHealing(item) {
  const effect = item.onPickup || getLootDef(itemId(item)).onPickup;
  const match = /^heal_(\d+)$/.exec(effect || '');
  return match ? Number(match[1]) : 0;
}

export const BAG_COLUMNS = 6;
export function loadoutGridError(baseCells, equipped) {
  const carried = equipped.filter(item => !isGear(item) && itemCategory(item) !== 'ammo');
  const capacity = loadoutCapacity(baseCells, equipped);
  return packItems(carried, BAG_COLUMNS, Math.floor(capacity / BAG_COLUMNS), {allowRotation:true}).ok ? '' : '背包格位不足，请调整物品尺寸或卸下物品';
}
export function armorSpec(item) {
  const def = getLootDef(itemId(item));
  const heavy = itemId(item) === 'armor_heavy';
  return {maxDurability:def.maxDurability ?? (heavy ? 220 : 120), armorClass:def.armorClass ?? (heavy ? 5 : 2)};
}
export function repairValue(item) { return item.repairAmount ?? getLootDef(itemId(item)).repairAmount ?? 0; }
