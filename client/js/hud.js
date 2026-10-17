// hud.js - HUD DOM element management
import { setAssetIcon } from './assets.js';
import { itemCategory, itemRarity, RARITY_NAMES, medicineHealing } from './itemrules.js';

let elements = {};

export function initHUD() {
  elements = {
    playerAvatar: document.getElementById('player-avatar'),
    hpText: document.getElementById('hp-text'),
    hpFill: document.getElementById('hp-fill'),
    armorText: document.getElementById('armor-text'),
    armorFill: document.getElementById('armor-fill'),
    staminaText: document.getElementById('stamina-text'),
    staminaFill: document.getElementById('stamina-fill'),
    ammoCurrent: document.getElementById('ammo-current'),
    ammoMax: document.getElementById('ammo-max'),
    reloadingMsg: document.getElementById('reloading-msg'),
    interactionPrompt: document.getElementById('interaction-prompt'),
    interactionText: document.getElementById('interaction-text'),
    extractionBanner: document.getElementById('extraction-banner'),
    extractProgressBar: document.getElementById('extract-progress-bar'),
    extractTimeText: document.getElementById('extract-time-text'),
    inventoryDrawer: document.getElementById('inventory-drawer'),
    lootGrid: document.getElementById('loot-grid'),
    lootCount: document.getElementById('loot-count'),
    notificationFeed: document.getElementById('notification-feed'),
  };
  return elements;
}

export function updateHUD(player, nearestLoot, nearestContainer) {
  setAssetIcon(elements.playerAvatar, player, { kind: 'operator' });
  const pn = document.getElementById('player-name');
  const ac = document.getElementById('armor-class-text');
  if (pn) pn.innerText = player.opName || '特工';
  if (ac) ac.innerText = player.armorClass > 0 ? `${player.armorClass} 级护甲` : '未装备护甲';

  elements.hpText.innerText = `${Math.round(player.hp)}/${player.maxHp}`;
  elements.hpFill.style.width = `${(player.hp / player.maxHp) * 100}%`;
  elements.armorText.innerText = `${Math.round(player.armor)}/${player.maxArmor}`;
  elements.armorFill.style.width = `${player.maxArmor > 0 ? (player.armor / player.maxArmor) * 100 : 0}%`;
  elements.staminaText.innerText = `${Math.round(player.stamina / player.maxStamina * 100)}%`;
  elements.staminaFill.style.width = `${(player.stamina / player.maxStamina) * 100}%`;
  elements.ammoCurrent.innerText = `${player.gun.currentAmmo}`;
  elements.ammoMax.innerText = `${player.gun.maxAmmo}`;

  if (player.gun.isReloading) elements.reloadingMsg.classList.remove('hidden');
  else elements.reloadingMsg.classList.add('hidden');

  if (nearestContainer && nearestContainer.isOpen && nearestContainer.spawnedLoot.length > 0) {
    elements.interactionPrompt.classList.remove('hidden');
    elements.interactionText.innerText = `打开 ${nearestContainer.name}`;
  } else if (nearestContainer && !nearestContainer.isOpen && !nearestContainer.isSearching) {
    elements.interactionPrompt.classList.remove('hidden');
    const keyHint = nearestContainer.isLocked ? ' (需要钥匙卡)' : '';
    elements.interactionText.innerText = `搜索 ${nearestContainer.name}${keyHint}`;
  } else if (nearestContainer && nearestContainer.isSearching) {
    elements.interactionPrompt.classList.remove('hidden');
    elements.interactionText.innerText = `搜索中... ${nearestContainer.searchTimer.toFixed(1)}s`;
  } else if (nearestLoot && nearestLoot.isSearching && nearestLoot.type === 'backpack') {
    elements.interactionPrompt.classList.remove('hidden');
    elements.interactionText.innerText = `搜索背包... ${nearestLoot.searchTimer.toFixed(1)}s`;
  } else if (nearestLoot && nearestLoot.type === 'backpack' && !nearestLoot.isSearched) {
    elements.interactionPrompt.classList.remove('hidden');
    elements.interactionText.innerText = '搜索 遗落背包';
  } else if (nearestLoot) {
    elements.interactionPrompt.classList.remove('hidden');
    elements.interactionText.innerText = `拾取 ${nearestLoot.name}`;
  } else {
    elements.interactionPrompt.classList.add('hidden');
  }

  if (player.isExtracting) {
    elements.extractProgressBar.style.width = `${(player.extractTimer / player.extractDuration) * 100}%`;
    elements.extractTimeText.innerText = `${player.extractTimer.toFixed(1)}s`;
  }

  elements.lootCount.innerText = `${player.inventory.length + (player.loadoutGear?.length || 0)} / ${player.maxSlots}`;

  const coinEl = document.getElementById('top-coins');
  if (coinEl) coinEl.innerText = `💰 ${(player.coins || 0).toLocaleString()}`;

  // Weapon slots with active highlighting
  const w1 = document.getElementById('weapon-slot-1');
  const w2 = document.getElementById('weapon-slot-2');
  const wicon = document.getElementById('weapon-icon-emoji');
  const wname = document.getElementById('weapon-name-text');
  if (w1) {
    setAssetIcon(w1, player.weaponSlots?.[0] || player.gun, { fallback: '🔫' });
    w1.classList.toggle('active', player.selectedWeaponIdx === 0);
    w1.title = player.weaponSlots?.[0]?.name || '默认武器';
  }
  if (w2) {
    setAssetIcon(w2, player.weaponSlots?.[1], { fallback: '—' });
    w2.classList.toggle('active', player.selectedWeaponIdx === 1);
    w2.title = player.weaponSlots?.[1]?.name || '';
  }
  setAssetIcon(wicon, player.weaponSlots?.[player.selectedWeaponIdx] || player.gun, { fallback: '🔫' });
  if (wname) wname.innerText = player.gun.name || 'TAC-SMG';
  const fireMode = document.getElementById('fire-mode');
  if (fireMode) fireMode.innerText = player.gun.fireMode === 'semi' ? '半自动' : '全自动';
  const mission = document.getElementById('mission-title');
  if (mission) mission.innerText = `区域：${player.mapName || 'DELTA-01'}`;

  const remaining = Math.max(0, Math.ceil(player.raidTimeRemaining ?? 600));
  document.getElementById('raid-timer').textContent = `${Math.floor(remaining / 60).toString().padStart(2,'0')}:${(remaining % 60).toString().padStart(2,'0')}`;
  document.getElementById('raid-kills').textContent = `${player.kills || 0}`;
  document.getElementById('stamina-status').textContent = player.sprintExhausted ? '体力耗尽 · 恢复至 20% 后松开 Shift' : player.isSprinting ? '正在冲刺' : player.staminaRecoveryDelay > 0 ? '准备恢复' : player.stamina >= player.maxStamina ? '体力充足' : '体力恢复中';
  const action = document.getElementById('action-progress');
  action.classList.toggle('hidden', !player.action);
  if (player.action) {
    document.getElementById('action-label').textContent = `${player.action.item.name} · ${Math.max(0,player.action.remaining).toFixed(1)}s`;
    document.getElementById('action-fill').style.width = `${(1 - player.action.remaining / player.action.duration) * 100}%`;
  }

  // Grenade/Med counts
  const gCount = document.getElementById('grenade-count');
  const mCount = document.getElementById('medkit-count');
  if (gCount) gCount.innerText = `🧨 ${player.grenadeCount || 0}`;
  if (mCount) mCount.innerText = `💊 ${player.medkitCount || 0}`;
}

export function refreshInventoryGrid(player) {
  const secured = player.secureInventory || [];
  const secureGrid = document.getElementById('secure-grid');
  elements.lootGrid.innerHTML = '';
  if (secureGrid) secureGrid.innerHTML = '';
  const add = (loot, grid, protectedItem) => {
    if (!grid) return;
    const slot = document.createElement('div'); slot.className = 'loot-slot';
    slot.dataset.rarity = itemRarity(loot);
    const icon = document.createElement('span'); icon.className = 'loot-item-art'; setAssetIcon(icon, loot); slot.appendChild(icon);
    const name = document.createElement('span'); name.className = 'loot-item-name'; name.textContent = loot.name; slot.appendChild(name);
    slot.title = `${loot.name} · ${RARITY_NAMES[itemRarity(loot)-1]} · ₡${loot.value || 0}`;
    const button = (text, event) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'loot-action'; b.textContent = text;
      b.addEventListener('click', e => { e.stopPropagation(); document.dispatchEvent(new CustomEvent(event, {detail:loot.id})); });
      slot.appendChild(b);
    };
    if (protectedItem) button('取出', 'unsecure-item');
    else {
      if (medicineHealing(loot)) button('使用', 'use-medicine');
      if (['valuable', 'key', 'medicine'].includes(itemCategory(loot))) button('保护', 'secure-item');
    }
    grid.appendChild(slot);
  };
  for (const loot of player.inventory) add(loot, elements.lootGrid, false);
  for (const loot of secured) add(loot, secureGrid, true);
  for (let i = secured.length; i < 2; i++) {
    if (!secureGrid) break;
    const empty = document.createElement('span'); empty.className = 'loot-slot secure-empty'; empty.textContent = '空保护格'; secureGrid.appendChild(empty);
  }
  if (document.getElementById('secure-count')) document.getElementById('secure-count').textContent = `${secured.length} / 2`;
}

export function pushNotification(text) {
  const start = document.getElementById('start-screen');
  const feedback = document.getElementById('lobby-feedback');
  if (start && feedback && !start.classList.contains('hidden')) {
    feedback.textContent = text;
    return;
  }
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.textContent = text;
  elements.notificationFeed.appendChild(item);
  setTimeout(() => {
    if (item.parentElement) item.parentElement.removeChild(item);
  }, 4000);
}

export function getElements() { return elements; }
