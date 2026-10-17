// Shared item rules for the lobby, deployment and every pickup path.
import { getLootDef } from './lootdata.js';

export function itemId(item) { return item.type || item.id; }

export function itemCategory(item) {
  const id = itemId(item) || '';
  if (id.startsWith('weapon_')) return 'weapon';
  if (id.startsWith('armor_')) return 'armor';
  if (id === 'backpack') return 'backpack';
  if (id.startsWith('ammo_')) return 'ammo';
  if (id.startsWith('keycard_')) return 'key';
  if (['medkit', 'medkit_large', 'injector'].includes(id)) return 'medicine';
  if (id === 'grenade') return 'grenade';
  return 'valuable';
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
  return baseSlots + (equipped.some(e => itemCategory(e) === 'backpack') ? 4 : 0);
}

export function medicineHealing(item) {
  const effect = item.onPickup || getLootDef(itemId(item)).onPickup;
  const match = /^heal_(\d+)$/.exec(effect || '');
  return match ? Number(match[1]) : 0;
}
