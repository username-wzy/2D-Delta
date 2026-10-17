// economy.js - Money & persistent data layer (localStorage-backed)
import { equipmentError, loadoutCapacity } from './itemrules.js';
const STORAGE_KEY = 'emoji_delta_profile';

let profile = null;
let maxEquipSlots = 12; // operator base capacity; backpack is calculated from current gear

/** Set the operator's base capacity; backpack bonus is calculated on demand. */
export function setMaxEquipSlots(n) { maxEquipSlots = Math.max(1, n); }
export function getMaxEquipSlots() { return loadoutCapacity(maxEquipSlots, getEquipped()); }
export function getEquipError(item) {
  const equipped = getEquipped();
  return equipmentError(item, equipped) || (equipped.length + 1 > loadoutCapacity(maxEquipSlots, [...equipped, item]) ? '装备容量不足' : '');
}
export function getLoadoutError() {
  const equipped = getEquipped();
  const accepted = [];
  for (const item of equipped) {
    const error = equipmentError(item, accepted);
    if (error) return error;
    accepted.push(item);
  }
  return equipped.length > getMaxEquipSlots() ? '携带物品超过当前特工容量，请先卸下多余物品' : '';
}

/** Load profile from localStorage */
export function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      profile = JSON.parse(raw);
      profile.stash ||= [];
      profile.equipped ||= [];
      // Reloading an unfinished local raid forfeits its reserved equipment.
      if (profile.activeRaid) {
        profile.lastRaidResult = { id: profile.activeRaid.id, outcome: 'abandoned' };
        profile.activeRaid = null;
        saveProfile();
      }
    } else {
      profile = createDefault();
      saveProfile();
    }
  } catch (e) {
    console.warn('Failed to load profile, creating new:', e.message);
    profile = createDefault();
  }
  return profile;
}

function createDefault() {
  return {
    username: '',
    passHash: '',
    coins: 50000,
    stash: [],
    equipped: [],
    activeRaid: null,
    createdAt: Date.now()
  };
}

/** Persist to localStorage */
export function saveProfile() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.warn('Failed to save profile:', e.message);
  }
}

/** Get current coins */
export function getCoins() {
  return profile ? profile.coins : 50000;
}

/** Add coins (earning) */
export function addCoins(amount) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('无效金币数量');
  if (!profile) loadProfile();
  profile.coins += amount;
  saveProfile();
  return profile.coins;
}

/** Spend coins (buying) — returns false if insufficient */
export function spendCoins(amount) {
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (!profile) loadProfile();
  if (profile.coins < amount) return false;
  profile.coins -= amount;
  saveProfile();
  return true;
}

/** Get stash items */
export function getStash() {
  if (!profile) loadProfile();
  return profile.stash;
}

/** Add item to stash */
export function addToStash(item) {
  if (!profile) loadProfile();
  profile.stash.push(item);
  saveProfile();
}

/** Remove item from stash by index */
export function removeFromStash(index) {
  if (!profile) loadProfile();
  if (index >= 0 && index < profile.stash.length) {
    profile.stash.splice(index, 1);
    saveProfile();
    return true;
  }
  return false;
}

/** Get/set username & password */
export function getUsername() {
  if (!profile) loadProfile();
  return profile.username || '';
}

export function setUsername(name) {
  if (!profile) loadProfile();
  profile.username = name;
  saveProfile();
}

/** Simple hash for client-side credential storage */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

export function setPassword(pass) {
  if (!profile) loadProfile();
  profile.passHash = pass ? simpleHash(pass) : '';
  saveProfile();
}

export function checkPassword(pass) {
  if (!profile) loadProfile();
  if (!profile.passHash) return true; // no password set yet
  return simpleHash(pass) === profile.passHash;
}

export function hasPassword() {
  if (!profile) loadProfile();
  return !!profile.passHash;
}

/** Get full profile */
export function getProfile() {
  if (!profile) loadProfile();
  return profile;
}

/** Sell item from stash by index, returns coins gained */
export function sellStashItem(index) {
  if (!profile) loadProfile();
  if (index >= 0 && index < profile.stash.length) {
    const item = profile.stash[index];
    const sellPrice = Math.floor((item.value ?? 0) * 0.4); // 40% resale
    profile.stash.splice(index, 1);
    profile.coins += sellPrice;
    saveProfile();
    return sellPrice;
  }
  return 0;
}

/** Get equipped loadout items */
export function getEquipped() {
  if (!profile) loadProfile();
  if (!profile.equipped) profile.equipped = [];
  return profile.equipped;
}

/** Equip within the selected operator's capacity and gear limits. */
export function equipItem(stashIndex) {
  if (!profile) loadProfile();
  if (!profile.equipped) profile.equipped = [];
  if (stashIndex < 0 || stashIndex >= profile.stash.length) return false;
  const item = profile.stash[stashIndex];
  if (profile.activeRaid || getEquipError(item)) return false;
  profile.stash.splice(stashIndex, 1);
  profile.equipped.push(item);
  saveProfile();
  return true;
}

/** Unequip item back to stash */
export function unequipItem(equipIndex) {
  if (!profile) loadProfile();
  if (!profile.equipped) profile.equipped = [];
  if (equipIndex >= 0 && equipIndex < profile.equipped.length) {
    const item = profile.equipped.splice(equipIndex, 1)[0];
    profile.stash.push(item);
    saveProfile();
    return true;
  }
  return false;
}

/** Clear equipped loadout (items lost on death) */
export function clearEquipped() {
  if (!profile) loadProfile();
  profile.equipped = [];
  saveProfile();
}

/** Batch equip — returns count equipped */
export function equipItems(indices) {
  if (!profile) loadProfile();
  let count = 0;
  // Sort descending so we can splice safely
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  for (const idx of sorted) {
    if (equipItem(idx)) count++;
  }
  if (count > 0) saveProfile();
  return count;
}

/** Batch sell — returns total coins gained */
export function sellStashItems(indices) {
  if (!profile) loadProfile();
  let total = 0;
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  for (const idx of sorted) {
    if (idx < 0 || idx >= profile.stash.length) continue;
    const item = profile.stash[idx];
    total += Math.floor((item.value ?? 0) * 0.4);
    profile.stash.splice(idx, 1);
  }
  if (sorted.length > 0) { profile.coins += total; saveProfile(); }
  return total;
}

/** Sell entire stash — returns total coins */
export function sellAllStash() {
  if (!profile) loadProfile();
  let total = 0;
  for (const item of profile.stash) {
    total += Math.floor((item.value ?? 0) * 0.4);
  }
  profile.stash = [];
  profile.coins += total;
  saveProfile();
  return total;
}

/** Reset entire profile to defaults (clear account) */
export function resetProfile() {
  localStorage.removeItem(STORAGE_KEY);
  profile = createDefault();
  saveProfile();
}

// Reserve gear before the raid starts. A single persisted write commits each
// transition, and a matching active id is required for settlement.
export function beginRaid(id) {
  if (!profile) loadProfile();
  if (profile.activeRaid) throw new Error('已有行动尚未结束');
  const error = getLoadoutError();
  if (error) throw new Error(error);
  const equipped = profile.equipped.map(item => ({ ...item }));
  const next = { ...profile, equipped: [], activeRaid: { id, equipped } };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  profile = next;
  return equipped;
}

export function settleRaid(id, survived, gear = [], inventory = [], bonus = 5000) {
  if (!profile) loadProfile();
  if (!profile.activeRaid || profile.activeRaid.id !== id) return false;
  const next = {
    ...profile, activeRaid: null,
    equipped: survived ? [...gear, ...inventory.filter(item => item.broughtIn).map(item => ({ id: item.type, emoji: item.emoji, name: item.name, value: item.value ?? 0 }))] : [],
    stash: survived ? [...profile.stash, ...inventory.filter(item => !item.broughtIn).map(item => ({ id: item.type, emoji: item.emoji, name: item.name, value: item.value ?? 0 }))] : profile.stash,
    coins: profile.coins + (survived ? bonus : 0),
    lastRaidResult: { id, outcome: survived ? 'extracted' : 'dead' }
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  profile = next;
  return true;
}

/** Restore reserved gear only when deployment failed before gameplay started. */
export function cancelDeployment(id) {
  if (!profile?.activeRaid || profile.activeRaid.id !== id) return false;
  const next = { ...profile, equipped: profile.activeRaid.equipped, activeRaid: null };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  profile = next;
  return true;
}
