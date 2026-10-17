// hud.js - HUD DOM element management
import { setAssetIcon } from './assets.js';

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
  if (ac) ac.innerText = `${player.armorClass}级护甲`;

  elements.hpText.innerText = `${Math.round(player.hp)}/${player.maxHp}`;
  elements.hpFill.style.width = `${(player.hp / player.maxHp) * 100}%`;
  elements.armorText.innerText = `${Math.round(player.armor)}/${player.maxArmor}`;
  elements.armorFill.style.width = `${(player.armor / player.maxArmor) * 100}%`;
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

  elements.lootCount.innerText = `${player.inventory.length} / ${player.maxSlots}`;

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

  // Grenade/Med counts
  const gCount = document.getElementById('grenade-count');
  const mCount = document.getElementById('medkit-count');
  if (gCount) gCount.innerText = `🧨 ${player.grenadeCount || 0}`;
  if (mCount) mCount.innerText = `💊 ${player.medkitCount || 0}`;
}

export function refreshInventoryGrid(player) {
  elements.lootGrid.innerHTML = '';
  for (const loot of player.inventory) {
    const slot = document.createElement('div');
    slot.className = 'loot-slot';
    setAssetIcon(slot, loot);
    slot.title = loot.name;
    slot.addEventListener('click', () => {
      if (loot.onPickup?.startsWith('heal_')) document.dispatchEvent(new CustomEvent('use-medicine', { detail: loot.id }));
    });
    elements.lootGrid.appendChild(slot);
  }
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
  item.innerHTML = `<span>💬</span><span>${text}</span>`;
  elements.notificationFeed.appendChild(item);
  setTimeout(() => {
    if (item.parentElement) item.parentElement.removeChild(item);
  }, 4000);
}

export function getElements() { return elements; }
