// Raid HUD and rectangular item grids share the same packing rules as gameplay.
import { setAssetIcon } from './assets.js';
import { itemCategory, itemRarity, RARITY_NAMES, medicineHealing } from './itemrules.js';
import { itemDimensions, packItems, inventoryUsage } from './inventory.js';
import { iconMarkup } from './icons.js';
import { getLootDef } from './lootdata.js';

let elements = {};
let selectedItemId = null;
let selectedProtected = false;
const byId = id => document.getElementById(id);
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
const countCells = items => inventoryUsage(items);
const displayName = item => item?.name || '未识别物品';
const dimensionsText = item => { const d = itemDimensions(item); return `${d.w} × ${d.h}`; };
const number = value => Math.max(0, Math.round(value || 0));
function durabilityText(item, player) {
  if (itemCategory(item) !== 'armor') return '';
  return `耐久 ${number(item.durability ?? player?.armor)} / ${number(item.maxDurability ?? player?.maxArmor)}`;
}

export function initHUD() {
  elements = {
    playerAvatar: byId('player-avatar'), hpText: byId('hp-text'), hpFill: byId('hp-fill'),
    armorText: byId('armor-text'), armorFill: byId('armor-fill'), staminaText: byId('stamina-text'),
    staminaFill: byId('stamina-fill'), ammoCurrent: byId('ammo-current'), ammoMax: byId('ammo-max'),
    reloadingMsg: byId('reloading-msg'), interactionPrompt: byId('interaction-prompt'),
    interactionText: byId('interaction-text'), extractionBanner: byId('extraction-banner'),
    extractProgressBar: byId('extract-progress-bar'), extractTimeText: byId('extract-time-text'),
    inventoryDrawer: byId('inventory-drawer'), lootGrid: byId('loot-grid'), lootCount: byId('loot-count'),
    notificationFeed: byId('notification-feed'),
  };
  byId('inventory-close')?.addEventListener('click', () => { elements.inventoryDrawer.classList.add('hidden'); emit('close-inventory'); });
  if (byId('organize-backpack')) byId('organize-backpack').onclick = () => emit('organize-inventory', 'backpack');
  if (byId('organize-secure')) byId('organize-secure').onclick = () => emit('organize-inventory', 'secure');
  return elements;
}
function setWeaponIcon(element, weapon) {
  if (!element) return;
  if (weapon && weapon.id !== 'unarmed') { setAssetIcon(element, weapon, { fallback: '' }); return; }
  if (element.dataset.assetSignature === 'empty/weapon') return;
  element.dataset.assetSignature = 'empty/weapon';
  element.innerHTML = iconMarkup('weapon');
}
function refreshEquippedDurability(player) {
  const label = byId('raid-armor-durability');
  if (label) label.textContent = player.maxArmor > 0 ? `耐久 ${number(player.armor)} / ${number(player.maxArmor)}` : '未装备';
  const fill = byId('raid-armor-durability-fill');
  if (fill) fill.style.transform = `scaleX(${player.maxArmor > 0 ? Math.max(0, player.armor / player.maxArmor) : 0})`;
}
export function updateHUD(player, nearestLoot, nearestContainer) {
  setAssetIcon(elements.playerAvatar, player, { kind: 'operator', fallback: '' });
  const pn = byId('player-name'), ac = byId('armor-class-text');
  if (pn) pn.textContent = player.opName || '特工';
  if (ac) ac.textContent = player.armorClass > 0 ? `${player.armorClass} 级护甲` : '未装备护甲';
  elements.hpText.textContent = `${number(player.hp)}/${player.maxHp}`;
  elements.hpFill.style.width = `${Math.max(0, player.hp / player.maxHp) * 100}%`;
  elements.armorText.textContent = `${number(player.armor)}/${number(player.maxArmor)}`;
  elements.armorFill.style.width = `${player.maxArmor > 0 ? Math.max(0, player.armor / player.maxArmor) * 100 : 0}%`;
  elements.staminaText.textContent = `${number(player.stamina / player.maxStamina * 100)}%`;
  elements.staminaFill.style.width = `${Math.max(0, player.stamina / player.maxStamina) * 100}%`;
  elements.ammoCurrent.textContent = `${player.gun.currentAmmo}`;
  elements.ammoMax.textContent = `${player.gun.maxAmmo}`;
  elements.reloadingMsg.classList.toggle('hidden', !player.gun.isReloading);
  if (nearestContainer && nearestContainer.isOpen && nearestContainer.spawnedLoot.length > 0) {
    elements.interactionPrompt.classList.remove('hidden'); elements.interactionText.textContent = `打开 ${nearestContainer.name}`;
  } else if (nearestContainer && !nearestContainer.isOpen && !nearestContainer.isSearching) {
    elements.interactionPrompt.classList.remove('hidden'); elements.interactionText.textContent = `搜索 ${nearestContainer.name}${nearestContainer.isLocked ? ' · 需要钥匙卡' : ''}`;
  } else if (nearestContainer?.isSearching) {
    elements.interactionPrompt.classList.remove('hidden'); elements.interactionText.textContent = `搜索中 · ${nearestContainer.searchTimer.toFixed(1)}s`;
  } else if (nearestLoot?.isSearching && nearestLoot.type === 'backpack') {
    elements.interactionPrompt.classList.remove('hidden'); elements.interactionText.textContent = `搜索背包 · ${nearestLoot.searchTimer.toFixed(1)}s`;
  } else if (nearestLoot?.type === 'backpack' && !nearestLoot.isSearched) {
    elements.interactionPrompt.classList.remove('hidden'); elements.interactionText.textContent = '搜索遗落背包';
  } else if (nearestLoot) {
    elements.interactionPrompt.classList.remove('hidden'); elements.interactionText.textContent = `拾取 ${nearestLoot.name} · ${dimensionsText(nearestLoot)} 格`;
  } else elements.interactionPrompt.classList.add('hidden');
  if (player.isExtracting) {
    elements.extractProgressBar.style.width = `${player.extractTimer / player.extractDuration * 100}%`;
    elements.extractTimeText.textContent = `${player.extractTimer.toFixed(1)}s`;
  }
  elements.lootCount.textContent = `${countCells(player.inventory)} / ${player.maxSlots} 格`;
  const coinEl = byId('top-coins'); if (coinEl) coinEl.textContent = `₡ ${(player.coins || 0).toLocaleString()}`;
  const w1 = byId('weapon-slot-1'), w2 = byId('weapon-slot-2');
  const slot1 = Array.isArray(player.weaponSlots) ? player.weaponSlots[0] : player.gun;
  const slot2 = player.weaponSlots?.[1];
  if (w1) {
    setWeaponIcon(w1, slot1);
    w1.classList.toggle('active', !!slot1 && player.selectedWeaponIdx === 0); w1.title = slot1?.name || '空主武器位';
  }
  if (w2) {
    setWeaponIcon(w2, slot2);
    w2.classList.toggle('active', !!slot2 && player.selectedWeaponIdx === 1); w2.title = slot2?.name || '空副武器位';
  }
  setWeaponIcon(byId('weapon-icon-emoji'), player.gun);
  if (byId('weapon-name-text')) byId('weapon-name-text').textContent = player.gun.name || 'TAC-SMG';
  if (byId('fire-mode')) byId('fire-mode').textContent = player.gun.fireMode === 'semi' ? '半自动' : '全自动';
  if (byId('mission-title')) byId('mission-title').textContent = `区域：${player.mapName || 'DELTA-01'}`;
  const remaining = Math.max(0, Math.ceil(player.raidTimeRemaining ?? 600));
  byId('raid-timer').textContent = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
  byId('raid-kills').textContent = `${player.kills || 0}`;
  byId('stamina-status').textContent = player.sprintExhausted ? '体力耗尽 · 恢复至 20% 后松开 Shift' : player.isSprinting ? '正在冲刺' : player.staminaRecoveryDelay > 0 ? '准备恢复' : player.stamina >= player.maxStamina ? '体力充足' : '体力恢复中';
  const action = byId('action-progress'); action.classList.toggle('hidden', !player.action);
  if (player.action) {
    byId('action-label').textContent = `${player.action.type === 'repair' ? '修复护甲 · ' : ''}${player.action.item.name} · ${Math.max(0, player.action.remaining).toFixed(1)}s`;
    byId('action-fill').style.width = `${(1 - player.action.remaining / player.action.duration) * 100}%`;
  }
  if (byId('grenade-count')) byId('grenade-count').textContent = `手雷 ${player.grenadeCount || 0}`;
  if (byId('medkit-count')) byId('medkit-count').textContent = `医疗 ${player.medkitCount || 0}`;
  refreshEquippedDurability(player);
}

// Empty cells and item rectangles occupy the same explicit CSS grid coordinates.
function prepareGrid(grid, cols, rows) {
  grid.innerHTML = '';
  grid.classList.add('item-grid');
  grid.style.setProperty('--grid-cols', cols); grid.style.setProperty('--grid-rows', rows);
  grid.setAttribute('role', 'group');
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const cell = document.createElement('span'); cell.className = 'inventory-cell'; cell.setAttribute('aria-hidden', 'true');
    cell.style.gridColumn = String(x + 1); cell.style.gridRow = String(y + 1); grid.appendChild(cell);
  }
}
function itemTile(placement, { title, onSelect, selected = false, container = false } = {}) {
  const { item, x, y, w, h } = placement;
  const tile = document.createElement('button'); tile.type = 'button'; tile.className = container ? 'loot-slot container-loot-item item-tile' : 'loot-slot item-tile';
  tile.dataset.itemId = item.id; tile.dataset.rarity = itemRarity(item); tile.dataset.footprint = `${w}x${h}`; tile.dataset.verticalWeapon = String(itemCategory(item) === 'weapon' && h > w);
  tile.style.gridColumn = `${x + 1} / span ${w}`; tile.style.gridRow = `${y + 1} / span ${h}`;
  tile.classList.toggle('selected', selected); tile.setAttribute('aria-pressed', String(selected));
  tile.title = title || `${displayName(item)} · ${RARITY_NAMES[itemRarity(item) - 1]} · ${w} × ${h} 格 · ₡${(item.value || 0).toLocaleString()}`;
  tile.setAttribute('aria-label', tile.title);
  const art = document.createElement('span'); art.className = 'loot-item-art'; setAssetIcon(art, item, { fallback: '' });
  const name = document.createElement('span'); name.className = 'loot-item-name'; name.textContent = displayName(item);
  const size = document.createElement('span'); size.className = 'item-footprint'; size.textContent = `${w}×${h}`;
  tile.append(art, name, size);
  if (container) { const hint = document.createElement('span'); hint.className = 'container-loot-pick'; hint.textContent = '拾取'; tile.appendChild(hint); }
  tile.addEventListener('click', event => { event.stopPropagation(); onSelect?.(item); });
  return tile;
}
function renderPackedItems(grid, items, cols, rows, options) {
  if (!grid) return { ok: true, placements: [], overflow: [] };
  prepareGrid(grid, cols, rows);
  const packed = packItems(items, cols, rows, { allowRotation: true });
  packed.placements.forEach(placement => grid.appendChild(itemTile(placement, options)));
  if (packed.overflow.length) {
    // Preserve access if an imported/older container has more content than its geometry.
    const fallback = document.createElement('div'); fallback.className = 'grid-overflow';
    fallback.style.gridColumn = `1 / span ${cols}`; fallback.style.gridRow = String(rows + 1);
    const heading = document.createElement('span'); heading.textContent = '额外物品'; fallback.appendChild(heading);
    packed.overflow.forEach(({ item }) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `${displayName(item)} · ${dimensionsText(item)}`;
      button.addEventListener('click', () => options.onSelect?.(item)); fallback.appendChild(button);
    }); grid.appendChild(fallback);
  }
  return packed;
}
function addAction(parent, label, name, detail, { disabled = false, title = '' } = {}) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'loot-action';
  button.textContent = label; button.dataset.action = name; button.disabled = disabled; button.title = title;
  button.addEventListener('click', event => { event.stopPropagation(); emit(name, detail); }); parent.appendChild(button);
}
function refreshItemInspector(player) {
  const inspector = byId('inventory-inspector'); if (!inspector) return;
  inspector.innerHTML = '';
  const source = selectedProtected ? (player.secureInventory || []) : player.inventory;
  const item = source.find(value => value.id === selectedItemId);
  if (!item) {
    selectedItemId = null; inspector.classList.add('is-empty');
    const hint = document.createElement('p'); hint.textContent = '选择一件物品，查看详情并装备、使用或保护。'; inspector.appendChild(hint); return;
  }
  inspector.classList.remove('is-empty'); inspector.dataset.itemId = item.id;
  const heading = document.createElement('div'); heading.className = 'inspector-heading';
  const title = document.createElement('b'); title.textContent = displayName(item);
  const dimensions = document.createElement('span'); dimensions.textContent = `${dimensionsText(item)} 格 · ${RARITY_NAMES[itemRarity(item) - 1]}`; heading.append(title, dimensions);
  const definition = getLootDef(item.type || item.id);
  const repairInfo = itemCategory(item) === 'repair' ? ` · 修复 ${item.repairAmount ?? definition.repairAmount ?? 0} 耐久 · ${item.useTime ?? definition.useTime ?? 0} 秒` : '';
  const meta = document.createElement('p'); meta.className = 'inspector-meta';
  meta.textContent = `₡ ${(item.value || 0).toLocaleString()}${durabilityText(item) ? ' · ' + durabilityText(item) : ''}${repairInfo}`;
  const actions = document.createElement('div'); actions.className = 'inspector-actions';
  if (selectedProtected) addAction(actions, '取出至背包', 'unsecure-item', item.id);
  else {
    const category = itemCategory(item);
    if (category === 'weapon') {
      addAction(actions, '装备主武器', 'equip-raid-item', { id: item.id, slot: 0 });
      addAction(actions, '装备副武器', 'equip-raid-item', { id: item.id, slot: 1 });
    }
    if (category === 'armor') addAction(actions, '装备护甲', 'equip-raid-item', { id: item.id, slot: 'armor' });
    if (category === 'backpack') addAction(actions, '穿戴背包', 'equip-raid-item', { id: item.id, slot: 'backpack' });
    if (medicineHealing(item)) addAction(actions, '使用药品', 'use-medicine', item.id);
    if (category === 'repair') addAction(actions, '修复护甲', 'use-repair', item.id, {
      disabled: player.maxArmor <= 0 || player.armor >= player.maxArmor,
      title: player.maxArmor <= 0 ? '请先装备护甲' : player.armor >= player.maxArmor ? '护甲耐久已满' : '读条完成后修复当前护甲',
    });
    if (['valuable', 'key', 'medicine', 'repair'].includes(category)) addAction(actions, '放入保护栏', 'secure-item', item.id);
  }
  const size = itemDimensions(item);
  if (size.w !== size.h) addAction(actions, '旋转 90°', 'rotate-item', item.id);
  inspector.append(heading, meta, actions);
}
function renderGearSlots(player) {
  const grid = byId('raid-equipment'); if (!grid) return; grid.innerHTML = '';
  const gear = player.loadoutGear || [];
  const armor = gear.find(item => itemCategory(item) === 'armor'), backpack = gear.find(item => itemCategory(item) === 'backpack');
  const descriptors = [
    { slot: 0, label: '主武器', icon: 'weapon', item: player.weaponSlots?.[0] },
    { slot: 1, label: '副武器', icon: 'weapon', item: player.weaponSlots?.[1] },
    { slot: 'armor', label: '护甲', icon: 'armor', item: armor },
    { slot: 'backpack', label: '背包', icon: 'backpack', item: backpack },
  ];
  for (const entry of descriptors) {
    const card = document.createElement('div'); card.className = `raid-gear-slot raid-gear-${entry.slot}`; card.dataset.slot = entry.slot;
    const label = document.createElement('span'); label.className = 'gear-label'; label.textContent = entry.label;
    const art = document.createElement('span'); art.className = 'gear-art';
    if (entry.item) setAssetIcon(art, entry.item, { fallback: '' }); else art.innerHTML = iconMarkup(entry.icon);
    const name = document.createElement('span'); name.className = 'gear-name'; name.textContent = entry.item ? displayName(entry.item) : '未装备'; name.title = name.textContent;
    card.append(label, art, name);
    if (entry.slot === 'armor') {
      const durability = document.createElement('span'); durability.id = 'raid-armor-durability'; durability.className = 'gear-durability'; card.appendChild(durability);
      const track = document.createElement('div'); track.className = 'gear-durability-track';
      const fill = document.createElement('div'); fill.id = 'raid-armor-durability-fill'; track.appendChild(fill); card.appendChild(track);
    }
    if (entry.item) addAction(card, entry.item.isDefault ? '基础武器' : '卸下', 'unequip-raid-item', { slot: entry.slot }, { disabled: !!entry.item.isDefault, title: entry.item.isDefault ? '基础武器不属于携带物资；装备拾取武器即可替换' : '' });
    grid.appendChild(card);
  }
  refreshEquippedDurability(player);
}
export function refreshInventoryGrid(player) {
  const secured = player.secureInventory || [];
  const normalCols = 6, normalRows = Math.max(1, Math.floor(player.maxSlots / normalCols));
  const select = protectedItem => item => {
    selectedItemId = item.id; selectedProtected = protectedItem; refreshInventoryGrid(player);
  };
  renderPackedItems(elements.lootGrid, player.inventory, normalCols, normalRows, { onSelect: select(false), selected: false });
  renderPackedItems(byId('secure-grid'), secured, 2, 2, { onSelect: select(true), selected: false });
  document.querySelectorAll('#loot-grid .item-tile, #secure-grid .item-tile').forEach(tile => {
    const selected = tile.dataset.itemId === selectedItemId && (tile.parentElement.id === 'secure-grid') === selectedProtected;
    tile.classList.toggle('selected', selected); tile.setAttribute('aria-pressed', String(selected));
  });
  elements.lootCount.textContent = `${countCells(player.inventory)} / ${player.maxSlots} 格`;
  if (byId('secure-count')) byId('secure-count').textContent = `${countCells(secured)} / 4 格`;
  renderGearSlots(player); refreshItemInspector(player);
}
export function renderContainerGrid(container, onPick) {
  const grid = byId('container-loot-grid'); if (!grid) return null;
  const type = container.type || container.containerType || '';
  const fallback = type === 'safe' ? { cols: 4, rows: 4 } : type === 'filing_cabinet' ? { cols: 6, rows: 4 } : type === 'wardrobe' ? { cols: 6, rows: 6 } : { cols: 6, rows: 5 };
  const cols = Number.isInteger(container.gridCols) ? container.gridCols : fallback.cols;
  const rows = Number.isInteger(container.gridRows) ? container.gridRows : fallback.rows;
  const items = container.spawnedLoot || [];
  const result = renderPackedItems(grid, items, cols, rows, { container: true, onSelect: onPick });
  grid.setAttribute('aria-label', `${container.name || '容器'} · ${cols} 列 ${rows} 行`);
  if (byId('container-grid-info')) byId('container-grid-info').textContent = `${countCells(items)} / ${cols * rows} 格 · ${items.length} 件`;
  if (byId('container-loot-all')) byId('container-loot-all').disabled = !items.length;
  return result;
}
export function pushNotification(text) {
  const start = byId('start-screen'), feedback = byId('lobby-feedback');
  if (start && feedback && !start.classList.contains('hidden')) { feedback.textContent = text; return; }
  const item = document.createElement('div'); item.className = 'feed-item'; item.textContent = text;
  elements.notificationFeed?.appendChild(item);
  setTimeout(() => { if (item.parentElement) item.parentElement.removeChild(item); }, 4000);
}
export function getElements() { return elements; }
