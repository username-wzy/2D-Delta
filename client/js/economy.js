// Anonymous, transactional single-player progression. No account or password state.
import { equipmentError, loadoutCapacity, itemCategory } from './itemrules.js';
export const STORAGE_KEY = '2d_delta_save_v1';
const LEGACY_KEY = 'emoji_delta_profile';
let profile = null;
let maxEquipSlots = 12;

function saveError(message, code = 'SAVE_FAILED') {
  const error = new Error(message); error.code = code; return error;
}
function createDefault() {
  return { version: 1, coins: 50000, stash: [], equipped: [], activeRaid: null,
    stats: { raids: 0, extracts: 0, deaths: 0, earnings: 0, bestHaul: 0, kills: 0 }, createdAt: Date.now() };
}
function number(value, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw saveError('本地进度损坏：数值无效', 'CORRUPT_SAVE');
  return Math.floor(value);
}
function items(value = []) {
  if (!Array.isArray(value) || value.length > 10000) throw saveError('本地进度损坏：物品列表无效', 'CORRUPT_SAVE');
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100) throw saveError('本地进度损坏：物品无效', 'CORRUPT_SAVE');
    return { ...(Number.isInteger(item.rarity) ? { rarity: Math.max(1, Math.min(6, item.rarity)) } : {}),
      ...(item.durability !== undefined ? { durability: number(item.durability), maxDurability: number(item.maxDurability, item.durability) } : {}),
      id: item.id, emoji: typeof item.emoji === 'string' ? item.emoji.slice(0, 24) : '📦',
      name: typeof item.name === 'string' ? item.name.slice(0, 160) : item.id, value: number(item.value) };
  });
}
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw saveError('本地进度损坏', 'CORRUPT_SAVE');
  const next = createDefault();
  next.coins = number(raw.coins, 50000); next.stash = items(raw.stash); next.equipped = items(raw.equipped);
  next.createdAt = number(raw.createdAt, Date.now());
  for (const key of Object.keys(next.stats)) next.stats[key] = number(raw.stats?.[key]);
  if (raw.lastRaidResult && typeof raw.lastRaidResult.id === 'string') next.lastRaidResult = { ...raw.lastRaidResult };
  if (raw.activeRaid) {
    if (typeof raw.activeRaid.id !== 'string' || !raw.activeRaid.id) throw saveError('本地进度损坏：行动记录无效', 'CORRUPT_SAVE');
    next.activeRaid = { id: raw.activeRaid.id, equipped: items(raw.activeRaid.equipped), secureInventory: items(raw.activeRaid.secureInventory) };
    if (next.activeRaid.secureInventory.length > 2 || next.activeRaid.secureInventory.some(item => !['valuable', 'key', 'medicine'].includes(itemCategory(item)))) throw saveError('本地进度损坏：保护栏无效', 'CORRUPT_SAVE');
  }
  return next;
}
function persist(next) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch { throw saveError('本地进度保存失败，操作未生效。请允许站点存储或释放空间后重试。'); }
  profile = next;
  return profile;
}
function ensure() { if (!profile) loadProfile(); return profile; }
function clone() { return JSON.parse(JSON.stringify(ensure())); }
function lobbyOnly() { if (ensure().activeRaid) throw new Error('行动期间不能修改仓库或携带装备'); }
function transact(change) { const next = clone(); const result = change(next); persist(next); return result; }
const validIndex = (index, array) => Number.isInteger(index) && index >= 0 && index < array.length;
const uniqueIndices = (indices, array) => [...new Set(indices)].filter(i => validIndex(i, array)).sort((a,b) => b-a);

export function loadProfile() {
  let raw, legacy;
  try { raw = localStorage.getItem(STORAGE_KEY); legacy = raw ? null : localStorage.getItem(LEGACY_KEY); }
  catch { throw saveError('无法读取本地进度，请允许站点存储后重试。'); }
  let next;
  try { next = raw || legacy ? normalize(JSON.parse(raw || legacy)) : createDefault(); }
  catch (error) { if (error.code === 'CORRUPT_SAVE') throw error; throw saveError('本地进度损坏，可选择重置后开始。', 'CORRUPT_SAVE'); }
  if (next.activeRaid) {
    next.stash.push(...next.activeRaid.secureInventory);
    next.lastRaidResult = { id: next.activeRaid.id, outcome: 'abandoned' };
    next.activeRaid = null; next.equipped = [];
    next.stats.raids++; next.stats.deaths++;
  }
  // Write migration/abandonment once, then discard obsolete identity data.
  if (!raw || JSON.stringify(next) !== raw) persist(next); else profile = next;
  if (legacy) { try { localStorage.removeItem(LEGACY_KEY); } catch { /* New anonymous save is already durable. */ } }
  return profile;
}
export function saveProfile() { return persist(clone()); }
export function getProfile() { return ensure(); }
export function getCoins() { return ensure().coins; }
export function getStash() { return ensure().stash; }
export function getEquipped() { return ensure().equipped; }
export function setMaxEquipSlots(n) { maxEquipSlots = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 12; }
export function getMaxEquipSlots() { return loadoutCapacity(maxEquipSlots, getEquipped()); }
export function getEquipError(item) {
  const equipped = getEquipped();
  return equipmentError(item, equipped) || (equipped.length + 1 > loadoutCapacity(maxEquipSlots, [...equipped, item]) ? '携带容量不足' : '');
}
export function getLoadoutError() {
  const accepted = [];
  for (const item of getEquipped()) {
    const error = equipmentError(item, accepted); if (error) return error; accepted.push(item);
  }
  return accepted.length > getMaxEquipSlots() ? '携带物品超过当前特工容量，请先卸下多余物品' : '';
}
export function addCoins(amount) {
  lobbyOnly(); if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('无效金币数量');
  return transact(next => next.coins += amount);
}
export function spendCoins(amount) {
  lobbyOnly(); if (!Number.isSafeInteger(amount) || amount < 0) return false;
  if (getCoins() < amount) return false;
  return transact(next => { next.coins -= amount; return true; });
}
export function addToStash(item) { lobbyOnly(); const itemCopy = items([item])[0]; return transact(next => next.stash.push(itemCopy)); }
export function purchaseItem(item) {
  lobbyOnly();
  if (!item || !Number.isSafeInteger(item.price) || item.price <= 0) throw new Error('商品价格无效');
  if (getCoins() < item.price) return false;
  const itemCopy = items([{ ...item, value: item.price }])[0];
  return transact(next => { next.coins -= item.price; next.stash.push(itemCopy); return true; });
}
export function removeFromStash(index) {
  lobbyOnly(); if (!validIndex(index, getStash())) return false;
  return transact(next => { next.stash.splice(index,1); return true; });
}
export function equipItem(index) { return equipItems([index]) === 1; }
export function equipItems(indices) {
  lobbyOnly();
  const selected = uniqueIndices(indices, getStash()); if (!selected.length) return 0;
  const next = clone(); let count = 0;
  for (const index of selected) {
    const item = next.stash[index];
    if (equipmentError(item, next.equipped) || next.equipped.length + 1 > loadoutCapacity(maxEquipSlots, [...next.equipped,item])) continue;
    next.equipped.push(next.stash.splice(index,1)[0]); count++;
  }
  if (count) persist(next);
  return count;
}
export function unequipItem(index) {
  lobbyOnly(); if (!validIndex(index, getEquipped())) return false;
  return transact(next => { next.stash.push(next.equipped.splice(index,1)[0]); return true; });
}
export function clearEquipped() { lobbyOnly(); return transact(next => { next.equipped = []; }); }
export function salePrice(item) {
  const value = Number.isFinite(item?.value) ? Math.max(0,item.value) : 0;
  return Math.floor(value * (itemCategory(item) === 'valuable' ? 1 : 0.4));
}
export function sellStashItem(index) { return sellStashItems([index]); }
export function sellStashItems(indices) {
  lobbyOnly(); const selected = uniqueIndices(indices, getStash()); if (!selected.length) return 0;
  return transact(next => {
    let total = 0;
    for (const index of selected) total += salePrice(next.stash.splice(index,1)[0]);
    next.coins += total; next.stats.earnings += total; return total;
  });
}
export function sellAllStash() { return sellStashItems(getStash().map((_, index) => index)); }
export function resetProfile() {
  persist(createDefault());
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* No account data is read by this game. */ }
}
export function beginRaid(id) {
  ensure(); if (profile.activeRaid) throw new Error('已有行动尚未结束');
  if (typeof id !== 'string' || !id) throw new Error('行动标识无效');
  const error = getLoadoutError(); if (error) throw new Error(error);
  const equipped = profile.equipped.map(item => ({...item}));
  persist({ ...profile, equipped: [], activeRaid: { id, equipped, secureInventory: [] } });
  return equipped;
}
export function updateSecureInventory(id, inventory) {
  ensure();
  if (profile.activeRaid?.id !== id) throw new Error('行动已结束');
  const secured = items(inventory.map(item => ({ ...item, id: item.type || item.id })));
  if (secured.length > 2 || secured.some(item => !['valuable', 'key', 'medicine'].includes(itemCategory(item)))) throw new Error('保护栏仅允许两件贵重品、钥匙或药品');
  return transact(next => { next.activeRaid.secureInventory = secured; });
}
export function settleRaid(id, survived, gear = [], inventory = [], bonus = 0, summary = {}) {
  ensure(); if (!profile.activeRaid || profile.activeRaid.id !== id) return false;
  const cost = survived ? number(summary.extractionCost) : 0;
  if (cost > profile.coins) throw new Error('余额不足，无法支付撤离费用');
  const carried = list => list.map(item => ({ ...item, id: item.type || item.id, value: item.value ?? 0 }));
  const secured = summary.secureInventory || [];
  const recovered = survived ? [...inventory, ...secured] : secured;
  const newLoot = recovered.filter(item => !item.broughtIn);
  const value = newLoot.reduce((sum,item) => sum + (item.value || 0),0);
  const next = clone();
  next.activeRaid = null;
  next.equipped = survived ? items([...gear, ...carried(recovered.filter(item => item.broughtIn))]) : [];
  next.stash.push(...items(carried(survived ? newLoot : recovered)));
  next.coins += (survived ? number(bonus) - cost : 0);
  next.stats.raids++; next.stats[survived ? 'extracts' : 'deaths']++;
  next.stats.kills += number(summary.kills);
  if (survived) next.stats.bestHaul = Math.max(next.stats.bestHaul, value);
  next.lastRaidResult = { id, outcome: summary.outcome || (survived ? 'extracted' : 'dead'), value: recovered.reduce((sum, item) => sum + (item.value || 0), 0),
    kills: number(summary.kills), duration: number(summary.duration), extractionCost: cost };
  persist(next); return true;
}
export function cancelDeployment(id) {
  if (!profile?.activeRaid || profile.activeRaid.id !== id) return false;
  persist({ ...profile, equipped: profile.activeRaid.equipped, activeRaid: null }); return true;
}
