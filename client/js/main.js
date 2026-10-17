// main.js - Game entry point, world init, game loop (Phase 3)
import { WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE } from './constants.js';
import { Player, Loot, Particle, SoundBlip, applyLootData } from './entities.js';
import { keys, mouse, initInput, resetInput } from './input.js';
import { aabb, getPlayerBox, raycastHitscan, movePlayer, hasLineOfSight } from './physics.js';
import { updateBots } from './ai.js';
import { render } from './renderer.js';
import { initHUD, updateHUD, refreshInventoryGrid, pushNotification, getElements } from './hud.js';
import { showStartScreen, hideStartScreen, onDeploy, showGameOver, showVictory, onRestart, initLobbyUI, initShopUI, refreshLobbyUI } from './ui.js';
import { loadShopData, getShopItems } from './shopdata.js';
import { loadMap, buildWorldFromMap } from './maploader.js';
import { playShootSound, playHitSound, playPickupSound, playExtractionBeep, playEnemyShootSound, playGrenadeSound } from './sound.js';
import { randomLootType, getLootDef, loadLootData } from './lootdata.js';
import { loadOperatorData, defaultOperator, getOperatorDef, allOperators } from './operatordata.js';
import { loadBotData } from './botdata.js';
import { loadProfile, updateSecureInventory, getCoins, getEquipped, getLoadoutError, setMaxEquipSlots, beginRaid, settleRaid, cancelDeployment } from './economy.js';
import { itemId, itemCategory, isGear, medicineHealing, loadoutCapacity } from './itemrules.js';
import { loadWeaponData, getWeaponDef } from './weapondata.js';
import { assetMarkup, loadGameAssets } from './assets.js';

import { applyDamage, resolveThrow } from './combat.js';
import { getSettings, loadSettings } from './settings.js';
import { confirmAction } from './ui-shell.js';

// Artwork is optional: missing images fall back to Emoji.
loadGameAssets();

// ---- Canvas setup ----
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gameCanvas'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

// ---- State ----
let selectedOpId = null;
let player = new Player(defaultOperator());
let walls = [];
let bots = [];
let loots = [];
let containers = [];
let particles = [];
let grenades = [];
let isPaused = false;
let currentExtraction = null;
let soundBlips = [];
let nearestLoot = null;
let nearestContainer = null;
let camera = { x: 0, y: 0 };
let isGameOver = false;
let gameStarted = false; // prevents update logic until deploy
let shakeAmount = 0;
let helipad = { x: WORLD_WIDTH - 400, y: 300, w: 220, h: 220, emoji: '🚁' };
let extractions = []; // multiple extraction points
let mapName = 'DELTA-01';
let extractionBeepTimer = 0;
let weaponSlots = [];  // weapons brought into raid
let selectedWeaponIdx = 0;
let raidState = 'lobby';
let activeRaidId = null;
let raidSequence = 0;
let pendingSettlement = null;
let worldWidth = WORLD_WIDTH, worldHeight = WORLD_HEIGHT, tileSize = TILE_SIZE;
const importedMaps = new Map();

function isRaidActive() { return raidState === 'inRaid' && gameStarted && !isGameOver && !isPaused; }

function closeRaidPanels() {
  hideContainerLoot();
  nearbyItems = [];
  nearbySignature = '';
  nearestLoot = null; nearestContainer = null;
  for (const id of ['nearby-loot-panel', 'inventory-drawer', 'extraction-banner', 'interaction-prompt', 'pause-panel', 'action-progress']) {
    document.getElementById(id)?.classList.add('hidden');
  }
  isPaused = false; player.action = null;
  resetInput();
}

function syncItemCounts() {
  player.grenadeCount = player.inventory.filter(item => item.type === 'grenade').length;
  player.medkitCount = player.inventory.filter(item => medicineHealing(item) > 0).length;
  player.gun.maxAmmo = player.ammoReserves[player.gun.ammoType] || 0;
}

function newLoot(x, y, type) {
  const loot = new Loot(x, y, type);
  applyLootData(loot, getLootDef(type));
  loot.raidId = activeRaidId;
  return loot;
}

function giveLoot(loot) {
  if (itemCategory(loot) === 'ammo') {
    const def = getLootDef(loot.type);
    const type = def.ammoType, amount = def.ammoAmount;
    if (!type || !Number.isFinite(amount) || amount <= 0) return false;
    player.ammoReserves[type] = (player.ammoReserves[type] || 0) + amount;
    pushNotification(`📦 弹药补给 +${amount} 发 (${type})`);
  } else {
    if (player.inventory.length + player.loadoutGear.length >= player.maxSlots) { pushNotification('⚠️ 背包已满'); return false; }
    player.inventory.push(loot);
  }
  syncItemCounts(); refreshInventoryGrid(player);
  return true;
}

async function initWorld() {
  if (raidState !== 'lobby') return false;
  raidState = 'loading'; gameStarted = false;
  closeRaidPanels();
  let deploymentId = null;
  try {
    const mapPath = document.getElementById('map-select')?.value || 'maps/factory_01.json';
    const mapData = importedMaps.get(mapPath) || await loadMap(mapPath);
    const opDef = getOperatorDef(selectedOpId || defaultOperator().id);
    const world = buildWorldFromMap(mapData, opDef.size);
    for (const item of getEquipped()) {
      if (itemCategory(item) === 'weapon' && !getWeaponDef(itemId(item))) throw new Error(`武器配置缺失：${itemId(item)}`);
    }
    const nextPlayer = new Player(opDef);
    const id = `raid-${Date.now()}-${++raidSequence}`;
    const equipped = beginRaid(id);
    deploymentId = id;
    activeRaidId = id;
    player = nextPlayer;
    player.coins = getCoins(); player.mapName = world.mapName;
    worldWidth = world.worldWidth; worldHeight = world.worldHeight; tileSize = world.tileSize;
    walls = world.walls; bots = world.bots; loots = world.loots; containers = world.containers;
    grenades = []; isPaused = false; currentExtraction = null;
    particles = []; soundBlips = []; shakeAmount = 0; extractionBeepTimer = 0;
    extractions = world.extractions; helipad = world.helipad; mapName = world.mapName;
    player.x = world.spawnX; player.y = world.spawnY;
    player.maxSlots = loadoutCapacity(opDef.maxSlots || 12, equipped);
    camera.x = player.x - canvas.width / 2; camera.y = player.y - canvas.height / 2;
    weaponSlots = equipped.filter(item => itemCategory(item) === 'weapon').map(item => ({
      ...getWeaponDef(item.id), id: item.id, emoji: item.emoji, cooldown: 0,
      currentAmmo: getWeaponDef(item.id)?.magSize || 30, isReloading: false, reloadTimer: 0
    }));
    if (!weaponSlots.length) weaponSlots.push({ ...player.gun });
    player.ammoReserves = {};
    for (const gun of weaponSlots) player.ammoReserves[gun.ammoType] = (player.ammoReserves[gun.ammoType] || 0) + (gun.maxAmmo || 0);
    selectedWeaponIdx = 0; applyWeaponStats();
    player.loadoutGear = equipped.filter(isGear);
    for (const item of equipped) {
      if (item.id === 'armor_light' || item.id === 'armor_heavy') {
        const heavy = item.id === 'armor_heavy';
        player.maxArmor = heavy ? 220 : 120;
        player.armor = Math.max(0, Math.min(player.maxArmor, item.durability ?? player.maxArmor));
        player.armorClass = heavy ? 5 : 2;
      }
      if (!isGear(item)) {
        const loot = newLoot(player.x, player.y, itemId(item));
        loot.broughtIn = true;
        if (itemCategory(loot) === 'ammo') giveLoot(loot);
        else player.inventory.push(loot);
      }
    }
    for (const loot of loots) loot.raidId = id;
    for (const container of containers) {
      container.raidId = id;
      if (player.passive === 'fastSearch') container.searchDuration *= player.passiveValue;
    }
    isGameOver = false; gameStarted = true; raidState = 'inRaid';
    syncItemCounts();
    player.weaponSlots = weaponSlots; player.selectedWeaponIdx = selectedWeaponIdx;
    refreshInventoryGrid(player); updateHUD(player, null, null);
    pushNotification(`⚡ 成功部署至 ${mapName}。寻找物资并前往撤离点！`);
    return true;
  } catch (error) {
    if (deploymentId) {
      try { cancelDeployment(deploymentId); }
      catch (rollbackError) {
        raidState = 'deploymentPending'; pendingSettlement = deploymentId;
        document.getElementById('result-modal').classList.remove('hidden');
        document.getElementById('result-title').textContent = '部署装备恢复失败';
        document.getElementById('result-desc').textContent = rollbackError.message + ' 请保持页面开启并重试。';
        document.getElementById('restart-btn').textContent = '重试恢复装备';
        return false;
      }
    }
    activeRaidId = null;
    raidState = 'lobby'; gameStarted = false;
    pushNotification(`⚠️ ${error.message}`);
    return false;
  }
}

function finishRaid(survived, outcome = survived ? 'extracted' : 'dead') {
  if (raidState !== 'inRaid' && raidState !== 'settlementPending') return;
  player.raidOutcome ||= outcome;
  for (const item of player.loadoutGear) if (itemCategory(item) === 'armor') {
    item.durability = Math.max(0, Math.floor(player.armor));
    item.maxDurability = player.maxArmor;
  }
  try {
    if (!settleRaid(activeRaidId, survived, player.loadoutGear, player.inventory, 0, {
      kills: player.kills, duration: Math.floor(player.raidElapsed), outcome: player.raidOutcome,
      extractionCost: survived && currentExtraction?.condition === 'paid' ? currentExtraction.cost : 0,
      secureInventory: player.secureInventory
    })) return;
  } catch (error) {
    raidState = 'settlementPending'; gameStarted = false; pendingSettlement = survived;
    closeRaidPanels();
    document.getElementById('result-modal').classList.remove('hidden');
    document.getElementById('result-title').textContent = '结算保存失败';
    document.getElementById('result-desc').textContent = error.message + ' 请保持页面开启，修复存储后重试。';
    document.getElementById('summary-loot-container').innerHTML = '';
    document.getElementById('restart-btn').textContent = '重试保存';
    return;
  }
  pendingSettlement = null;
  isGameOver = true; gameStarted = false; raidState = survived ? 'extracted' : 'dead';
  closeRaidPanels(); player.isExtracting = false; player.coins = getCoins();
  syncItemCounts(); updateHUD(player, null, null);
  if (survived) {
    const value = [...player.inventory, ...player.secureInventory].filter(item => !item.broughtIn).reduce((sum, item) => sum + (item.value || 0), 0);
    showVictory(player, value);
  } else showGameOver(player.mapName, player);
}

function cancelAction(message = '') {
  if (!player.action) return;
  player.action = null;
  if (message) pushNotification(message);
}
function cancelSearches() {
  for (const target of [...containers, ...loots]) if (target.isSearching) {
    target.isSearching = false; target.searchTimer = 0;
  }
}
function registerKill(bot) {
  const index = bots.indexOf(bot);
  if (index < 0 || bot.hp > 0) return;
  bots.splice(index, 1); player.kills++;
  loots.push(newLoot(bot.x, bot.y, randomLootType()));
  pushNotification(`击倒 ${bot.botName || '敌人'} · 本次 ${player.kills} 次击杀`);
}
function alertHit(bot) {
  bot.state = 'aggro'; bot.reactionDelay = 0; bot.aggroLossTimer = 6;
  bot.targetX = bot.lastKnownPlayerX = player.x;
  bot.targetY = bot.lastKnownPlayerY = player.y;
}
function fireWeapon() {
  if (!isRaidActive() || player.gun.isReloading || player.gun.cooldown > 0) return;
  cancelAction('治疗已中断'); cancelSearches();
  if (player.gun.currentAmmo <= 0) { reloadWeapon(); return; }
  const gun = player.gun;
  gun.currentAmmo--; gun.cooldown = gun.fireRate; shakeAmount = 4;
  playShootSound();
  const targetAngle = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);
  const centerAngle = targetAngle + (Math.random() - 0.5) * player.spread;
  const origin = { x: player.x, y: player.y };
  const pellets = gun.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const angle = centerAngle + (pellets > 1 ? (i / (pellets - 1) - 0.5) * (gun.pelletSpread || 0.14) : 0);
    const dir = {x: Math.cos(angle), y: Math.sin(angle)};
    const hit = raycastHitscan(origin, dir, gun.range || 800, walls, bots);
    particles.push(new Particle(player.x + dir.x * 30, player.y + dir.y * 30, dir.x * 400, dir.y * 400, '#d6e4a5', 0.12, 4));
    if (!hit) continue;
    playHitSound();
    for (let k = 0; k < 5; k++) particles.push(new Particle(hit.x, hit.y, (Math.random() - 0.5) * 250, (Math.random() - 0.5) * 250, hit.type === 'bot' ? '#d96656' : '#d7d9ce', 0.2, 4));
    if (hit.type === 'bot' && hit.entity) {
      applyDamage(hit.entity, gun.damage, gun.penetration);
      alertHit(hit.entity); registerKill(hit.entity);
    }
  }
  soundBlips.push(new SoundBlip(player.x, player.y, 600));
}

function reloadWeapon() {
  if (!isRaidActive()) return;
  syncItemCounts();
  if (player.gun.isReloading || player.gun.currentAmmo === player.gun.magSize || player.gun.maxAmmo <= 0) return;
  cancelAction('换弹中断治疗');
  player.gun.isReloading = true;
  player.gun.reloadTimer = player.gun.reloadTime;
}

// ---- Container loot view ----
const containerLootPanel = document.getElementById('container-loot-panel');
const containerLootTitle = document.getElementById('container-loot-title');
const containerLootGrid = document.getElementById('container-loot-grid');
const containerLootClose = document.getElementById('container-loot-close');
const containerLootAll = document.getElementById('container-loot-all');
const containerLootHint = document.getElementById('container-loot-hint');
let viewingContainer = null;

function showContainerLoot(c) {
  viewingContainer = c;
  containerLootTitle.innerText = `${c.emoji} ${c.name} 物品`;
  renderContainerLootGrid();
  containerLootPanel.classList.remove('hidden');
}

function hideContainerLoot() {
  containerLootPanel.classList.add('hidden');
  viewingContainer = null;
}

function renderContainerLootGrid() {
  if (!viewingContainer) return;
  containerLootGrid.innerHTML = '';
  if (viewingContainer.spawnedLoot.length === 0) {
    containerLootGrid.innerHTML = '<div class="container-loot-empty">物品已全部取走</div>';
    containerLootAll.disabled = true;
    containerLootHint.classList.add('hidden');
  } else {
    containerLootAll.disabled = false;
    containerLootHint.classList.remove('hidden');
    viewingContainer.spawnedLoot.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'container-loot-item';
      el.innerHTML = `
        <span class="container-loot-item-emoji">${assetMarkup(item)}</span>
        <div class="container-loot-item-info">
          <span class="container-loot-item-name">${item.name}</span>
          <span class="container-loot-item-value">$${(item.value || 0).toLocaleString()}</span>
        </div>
        <button class="container-loot-pick">拾取</button>
      `;
      el.querySelector('.container-loot-pick').addEventListener('click', (e) => {
        e.stopPropagation();
        pickFromContainer(i);
      });
      containerLootGrid.appendChild(el);
    });
  }
}

function validContainer(container) {
  return isRaidActive() && container && containers.includes(container) && container.raidId === activeRaidId &&
    container.isOpen && Math.hypot(player.x - container.x, player.y - container.y) <= 70 &&
    hasLineOfSight(player, container, walls);
}

function pickFromContainer(i) {
  if (!validContainer(viewingContainer)) { hideContainerLoot(); return; }
  const item = viewingContainer.spawnedLoot[i];
  if (!item) return;
  const loot = newLoot(viewingContainer.x, viewingContainer.y, item.type);
  loot.isSearched = true; // a backpack inside a container is an item, not another death bag
  if (!giveLoot(loot)) return;
  viewingContainer.spawnedLoot.splice(i, 1);
  pushNotification(`📥 拾取了 ${loot.name}`); playPickupSound();
  renderContainerLootGrid();
}

function takeAllFromContainer() {
  if (!validContainer(viewingContainer)) { hideContainerLoot(); return; }
  const items = [...viewingContainer.spawnedLoot];
  let taken = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (player.inventory.length + player.loadoutGear.length >= player.maxSlots && itemCategory(items[i]) !== 'ammo') continue;
    const before = viewingContainer.spawnedLoot.length;
    pickFromContainer(i);
    taken += before - viewingContainer.spawnedLoot.length;
  }
  if (taken > 0) pushNotification(`📥 全部拾取，获得 ${taken} 件物品`);
  else if (viewingContainer.spawnedLoot.length > 0) pushNotification('⚠️ 背包已满');
}

if (containerLootClose) containerLootClose.addEventListener('click', hideContainerLoot);
if (containerLootAll) containerLootAll.addEventListener('click', takeAllFromContainer);

function startBackpackSearch(loot) {
  if (loot.isSearching || loot.isSearched) return;
  cancelAction('搜索中断治疗'); cancelSearches();
  loot.isSearching = true;
  loot.searchDuration = 1.5 * (player.passive === 'fastSearch' ? player.passiveValue : 1);
  loot.searchTimer = loot.searchDuration;
  pushNotification(`🎒 正在搜索遗落背包... (${loot.searchDuration.toFixed(1)}秒)`);
}

function takeGroundLoot(loot, range = 60) {
  if (!isRaidActive() || !loots.includes(loot) || loot.raidId !== activeRaidId) return;
  const distance = Math.hypot(player.x - loot.x, player.y - loot.y);
  if (distance > range || !hasLineOfSight(player, loot, walls)) { pushNotification('⚠️ 距离太远或有障碍阻挡'); return; }
  if (loot.type === 'backpack' && !loot.isSearched) {
    if (distance > 60) { pushNotification('🎒 请靠近背包后搜索'); return; }
    startBackpackSearch(loot); return;
  }
  if (loot.isSearching || !giveLoot(loot)) return;
  loots.splice(loots.indexOf(loot), 1);
  if (nearestLoot === loot) nearestLoot = null;
  pushNotification(`📥 拾取了 ${loot.name}`); playPickupSound();
}

function interactTarget() {
  if (!isRaidActive()) return;
  const container = nearestContainer;
  if (container && containers.includes(container) && container.raidId === activeRaidId &&
      Math.hypot(player.x - container.x, player.y - container.y) <= 70 && hasLineOfSight(player, container, walls)) {
    if (container.isOpen) { if (container.spawnedLoot.length) showContainerLoot(container); return; }
    if (container.isSearching) return;
    if (container.requiredKey && ![...player.inventory, ...player.secureInventory].some(item => item.type === container.requiredKey)) {
      pushNotification(`🔒 需要${getLootDef(container.requiredKey).name}才能打开${container.name}`); return;
    }
    cancelAction('搜索中断治疗'); cancelSearches();
    container.isSearching = true; container.searchTimer = container.searchDuration;
    pushNotification(`🔍 正在搜索 ${container.name}... (${container.searchDuration.toFixed(1)}秒)`);
    return;
  }
  if (nearestLoot) takeGroundLoot(nearestLoot);
}

function toggleInventory() {
  if (!isRaidActive()) return;
  getElements().inventoryDrawer.classList.toggle('hidden');
}

function throwGrenade() {
  if (!isRaidActive()) return;
  const index = player.inventory.findIndex(item => item.type === 'grenade');
  if (index < 0) { pushNotification('没有手榴弹'); return; }
  cancelAction('治疗已中断'); cancelSearches();
  const landing = resolveThrow(player, {
    x: Math.max(6, Math.min(worldWidth - 6, mouse.worldX)),
    y: Math.max(6, Math.min(worldHeight - 6, mouse.worldY))
  }, walls);
  player.inventory.splice(index, 1);
  grenades.push({x:player.x,y:player.y,startX:player.x,startY:player.y,targetX:landing.x,targetY:landing.y,age:0,flightTime:0.45,fuse:1.6});
  syncItemCounts(); refreshInventoryGrid(player);
  pushNotification('手榴弹已投出 · 1.6 秒后爆炸');
}
function updateGrenades(dt) {
  for (const grenade of [...grenades]) {
    grenade.age += dt;
    const t = Math.min(1, grenade.age / grenade.flightTime);
    grenade.x = grenade.startX + (grenade.targetX - grenade.startX) * t;
    grenade.y = grenade.startY + (grenade.targetY - grenade.startY) * t;
    if (grenade.age < grenade.fuse) continue;
    grenades.splice(grenades.indexOf(grenade), 1);
    playGrenadeSound(); soundBlips.push(new SoundBlip(grenade.x, grenade.y, 700)); shakeAmount = 15;
    for (const target of [...bots, player]) {
      const distance = Math.hypot(target.x - grenade.x, target.y - grenade.y);
      if (distance >= 150 || !hasLineOfSight(grenade, target, walls)) continue;
      const hit = applyDamage(target, 100 * (1 - distance / 150), 45);
      if (target === player && (hit.hpDamage || hit.armorDamage)) {
        cancelAction('受到爆炸伤害，治疗已中断'); player.damageFreeTime = 0;
        if (player.isExtracting) player.extractTimer = player.extractDuration;
      } else if (target !== player) { alertHit(target); registerKill(target); }
    }
    for (let k = 0; k < 24; k++) particles.push(new Particle(grenade.x, grenade.y, (Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600, '#d9a35e', 0.45, 7));
  }
}

function useMedkit(itemInstanceId = null) {
  if (!isRaidActive() || player.action || player.gun.isReloading) return;
  if (player.hp >= player.maxHp) { pushNotification('生命值已满'); return; }
  const medicines = player.inventory.map(item => ({item, heal: medicineHealing(item)})).filter(x => x.heal > 0).sort((a,b) => a.heal - b.heal);
  const chosen = itemInstanceId ? medicines.find(x => x.item.id === itemInstanceId) : (medicines.find(x => x.heal >= player.maxHp - player.hp) || medicines.at(-1));
  if (!chosen) { pushNotification('没有可用的医疗用品'); return; }
  cancelSearches();
  const duration = chosen.item.useTime || getLootDef(chosen.item.type).useTime || 3;
  player.action = {type:'heal',item:chosen.item,heal:chosen.heal,duration,remaining:duration};
  pushNotification(`正在使用 ${chosen.item.name} · ${duration} 秒，移动、开火或受击会中断`);
}
function updateAction(dt) {
  const action = player.action;
  if (!action) return;
  action.remaining -= dt;
  if (action.remaining > 0) return;
  player.action = null;
  const index = player.inventory.indexOf(action.item);
  if (index < 0) return;
  const healed = Math.min(action.heal, player.maxHp - player.hp);
  player.hp += healed; player.inventory.splice(index, 1);
  syncItemCounts(); refreshInventoryGrid(player);
  pushNotification(`治疗完成 +${healed} HP`);
}
function secureLoot(instanceId, remove = false) {
  if (!isRaidActive()) return;
  const source = remove ? player.secureInventory : player.inventory;
  const destination = remove ? player.inventory : player.secureInventory;
  const index = source.findIndex(item => item.id === instanceId);
  if (index < 0) return;
  const item = source[index];
  if (!remove && !['valuable', 'key', 'medicine'].includes(itemCategory(item))) return;
  if (destination.length >= (remove ? player.maxSlots - player.loadoutGear.length : 2)) { pushNotification(remove ? '背包已满' : '保护栏已满（2 格）'); return; }
  const secured = remove ? player.secureInventory.filter(x => x !== item) : [...player.secureInventory, item];
  try { updateSecureInventory(activeRaidId, secured); }
  catch (error) { pushNotification(error.message); return; }
  if (player.action?.item === item) cancelAction('物品已移动，治疗已中断');
  source.splice(index, 1); destination.push(item);
  syncItemCounts(); refreshInventoryGrid(player);
}

function switchWeapon(idx) {
  if (!isRaidActive() || idx < 0 || idx >= weaponSlots.length || idx === selectedWeaponIdx) return;
  cancelAction('切枪中断治疗');
  selectedWeaponIdx = idx; applyWeaponStats();
  pushNotification(`🔫 切换至 ${player.gun.name}`);
}

function applyWeaponStats() {
  const gun = weaponSlots[selectedWeaponIdx];
  if (!gun) return;
  player.gun = gun;
  gun.maxAmmo = player.ammoReserves[gun.ammoType] || 0;
}

// ---- Update loop ----
function update(dt) {
  if (!isRaidActive()) return;
  if (player.hp <= 0) { finishRaid(false); return; }
  if (shakeAmount > 0) shakeAmount = Math.max(0, shakeAmount - dt * 20);

  mouse.worldX = mouse.x + camera.x;
  mouse.worldY = mouse.y + camera.y;

  // Run stamina every frame, including stationary searches and medical actions.
  const wantsMove = keys.w || keys.a || keys.s || keys.d;
  if (wantsMove) { cancelSearches(); cancelAction('移动中断治疗'); }
  for (const target of [...containers, ...loots]) {
    const range = containers.includes(target) ? 70 : 60;
    if (target.isSearching && (Math.hypot(player.x - target.x, player.y - target.y) > range || !hasLineOfSight(player, target, walls))) {
      target.isSearching = false; target.searchTimer = 0;
    }
  }
  const isSearching = containers.some(c => c.isSearching) || loots.some(l => l.isSearching);
  movePlayer(player, dt, isSearching || player.action ? {w:false,a:false,s:false,d:false,shift:keys.shift} : keys, walls, worldWidth, worldHeight);
  if (player.passive === 'precision') player.spread *= player.passiveValue;

  // Each weapon owns its timers; reserve ammo is shared by ammunition type.
  for (const gun of weaponSlots) {
    gun.cooldown = Math.max(0, gun.cooldown - dt);
    if (!gun.isReloading) continue;
    gun.reloadTimer -= dt;
    if (gun.reloadTimer <= 0) {
      gun.isReloading = false; gun.reloadTimer = 0;
      const available = Math.min(gun.magSize - gun.currentAmmo, player.ammoReserves[gun.ammoType] || 0);
      gun.currentAmmo += available; player.ammoReserves[gun.ammoType] -= available;
      pushNotification(`🔄 ${gun.name} 装弹完毕。`);
    }
  }
  syncItemCounts();
  const wantsFire = player.gun.fireMode === 'semi' ? mouse.justPressed : mouse.isDown;
  if (!player.gun.isReloading && wantsFire && player.gun.cooldown <= 0) fireWeapon();
  mouse.justPressed = false;

  // Bots (Phase 3: enhanced AI)
  const botResult = updateBots(dt, bots, player, soundBlips, walls, worldWidth, worldHeight);
  if (botResult.fired) {
    playEnemyShootSound(); // enemy gunshot sound
  }
  if (botResult.hit) {
    cancelAction('受击中断治疗');
    shakeAmount = 10;
    playHitSound();
    pushNotification(`⚠️ 遭到 ${botResult.bot?.emoji || '🧟'} 攻击！`);
    player.damageFreeTime = 0;
    if (player.isExtracting) player.extractTimer = player.extractDuration;
    if (player.hp <= 0) {
      finishRaid(false);
      return;
    }
  }

  player.damageFreeTime += dt;
  if (player.passive === 'regen' && !botResult.hit && player.damageFreeTime >= 3) {
    player.hp = Math.min(player.maxHp, player.hp + player.passiveValue * dt);
  }
  if (viewingContainer && !validContainer(viewingContainer)) hideContainerLoot();

  // Fatal damage and the raid deadline take priority over extraction completion.
  const beforeExplosionHp = player.hp, beforeExplosionArmor = player.armor;
  updateGrenades(dt);
  if (player.hp <= 0) { finishRaid(false); return; }
  const wasHit = botResult.hit || player.hp < beforeExplosionHp || player.armor < beforeExplosionArmor;
  if (wasHit) cancelAction('受击中断治疗');
  updateAction(dt);
  player.raidElapsed += dt;
  player.raidTimeRemaining = Math.max(0, 600 - player.raidElapsed);
  if (player.raidTimeRemaining <= 0) { finishRaid(false, 'timeout'); return; }
  const pBox = getPlayerBox(player, player.x, player.y);
  const overlapping = extractions.filter(ext => aabb(pBox.x, pBox.y, pBox.w, pBox.h, ext.x, ext.y, ext.w, ext.h));
  const eligible = overlapping.find(ext => ext.condition !== 'paid' || getCoins() >= ext.cost);
  const ext = eligible || overlapping[0] || null;
  if (ext && ext.condition === 'paid' && getCoins() < ext.cost) {
    if (currentExtraction !== ext) pushNotification(`付费撤离需要 ₡${ext.cost.toLocaleString()}，当前资金不足，请前往其他撤离点`);
    currentExtraction = ext; player.isExtracting = false;
    getElements().extractionBanner.classList.add('hidden');
  } else if (ext) {
    if (!player.isExtracting || currentExtraction !== ext) {
      currentExtraction = ext; player.isExtracting = true;
      player.extractDuration = ext.duration || 10; player.extractTimer = player.extractDuration;
      extractionBeepTimer = 0;
      document.getElementById('extract-title').textContent = `${ext.name || '撤离点'} · ${ext.condition === 'paid' ? '₡' + ext.cost.toLocaleString() : '免费'}`;
      getElements().extractionBanner.classList.remove('hidden');
      pushNotification(`${ext.name || '撤离点'} · 保持存活 ${player.extractDuration} 秒${ext.condition === 'paid' ? ' · 费用 ₡' + ext.cost.toLocaleString() : ' · 免费撤离'}`);
    }
    if (wasHit) player.extractTimer = player.extractDuration;
    else player.extractTimer -= dt;
    extractionBeepTimer -= dt;
    if (extractionBeepTimer <= 0) { extractionBeepTimer = 1; playExtractionBeep(1 - player.extractTimer / player.extractDuration); }
    if (player.extractTimer <= 0) { finishRaid(true); return; }
  } else {
    if (player.isExtracting) pushNotification('离开撤离区，计时已取消');
    player.isExtracting = false; currentExtraction = null;
    getElements().extractionBanner.classList.add('hidden');
  }

  nearestLoot = null;
  let minDist = 60;
  for (const loot of [...loots]) {
    const dist = Math.hypot(player.x - loot.x, player.y - loot.y);
    if (dist < minDist && hasLineOfSight(player, loot, walls)) { minDist = dist; nearestLoot = loot; }
    if (!loot.isSearching || loot.type !== 'backpack') continue;
    if (dist > 60 || !hasLineOfSight(player, loot, walls) || keys.w || keys.a || keys.s || keys.d) { loot.isSearching = false; loot.searchTimer = 0; continue; }
    loot.searchTimer -= dt;
    if (loot.searchTimer > 0) continue;
    loot.isSearching = false; loot.isSearched = true;
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const item = newLoot(loot.x, loot.y, randomLootType());
      item.isSearched = true; loots.push(item);
    }
    pushNotification(`🎒 背包搜索完成，发现 ${count} 件物品`);
    takeGroundLoot(loot);
  }

  // Nearest container & search timer
  nearestContainer = null;
  let minContainerDist = 70;
  for (const c of containers) {
    // Only skip empty opened containers; keep open ones with loot for re-open
    if (c.isOpen && c.spawnedLoot.length === 0) continue;
    const dist = Math.hypot(player.x - c.x, player.y - c.y);
    if (dist < minContainerDist && hasLineOfSight(player, c, walls)) { minContainerDist = dist; nearestContainer = c; }
    // Tick search timer
    if (c.isSearching) {
      if (dist > 70 || !hasLineOfSight(player, c, walls) || keys.w || keys.a || keys.s || keys.d) { c.isSearching = false; c.searchTimer = 0; continue; }
      c.searchTimer -= dt;
      if (c.searchTimer <= 0) {
        c.isSearching = false;
        c.isOpen = true;
        // Generate loot into container's spawnedLoot
        const lootCount = 2 + Math.floor(Math.random() * 3); // 2-4 items
        for (let li = 0; li < lootCount; li++) {
          const lt = randomLootType();
          const def = getLootDef(lt);
          c.spawnedLoot.push({ type: lt, emoji: def.emoji, name: def.name, value: def.value || 0, rarity: def.rarity || 1, onPickup: def.onPickup, ammoType: def.ammoType, ammoAmount: def.ammoAmount });
        }
        pushNotification(`🔓 ${c.name} 已打开，获得 ${lootCount} 件物品`);
        showContainerLoot(c);
      }
    }
  }

  // Particles & sound blips
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].x += particles[i].vx * dt;
    particles[i].y += particles[i].vy * dt;
    particles[i].life -= dt;
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
  for (let i = soundBlips.length - 1; i >= 0; i--) {
    soundBlips[i].life -= dt;
    if (soundBlips[i].life <= 0) soundBlips.splice(i, 1);
  }

  // Camera
  const targetCamX = player.x - canvas.width / 2;
  const targetCamY = player.y - canvas.height / 2;
  camera.x += (targetCamX - camera.x) * 10 * dt;
  camera.y += (targetCamY - camera.y) * 10 * dt;

  if (nearbyPanel && !nearbyPanel.classList.contains('hidden')) refreshNearbyPanel();

  // Sync weapon/grenade/med state to player for HUD
  player.weaponSlots = weaponSlots;
  player.selectedWeaponIdx = selectedWeaponIdx;
  updateHUD(player, nearestLoot, nearestContainer);
}

// ---- Game loop ----
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  update(dt);
  render(ctx, canvas, camera, { player, walls, bots, loots, containers, particles, soundBlips, helipad, extractions, mouse, grenades, shakeAmount: getSettings().screenShake ? shakeAmount : 0, tileSize, worldWidth, worldHeight });
  requestAnimationFrame(loop);
}

// ---- Init ----
initHUD();
// ---- Nearby loot panel (H key) ----
const nearbyListEl = document.getElementById('nearby-loot-list');
const nearbyCountEl = document.getElementById('nearby-count');
const nearbyPanel = document.getElementById('nearby-loot-panel');
let nearbyItems = []; // snapshot of loot within range
let nearbySignature = '';

function toggleNearbyLoot() {
  if (!isRaidActive()) return;
  if (!nearbyPanel) return;
  if (nearbyPanel.classList.contains('hidden')) {
    refreshNearbyPanel();
    nearbyPanel.classList.remove('hidden');
  } else {
    nearbyPanel.classList.add('hidden');
    nearbyItems = [];
  }
}

function refreshNearbyPanel() {
  if (!nearbyListEl || !nearbyCountEl) return;
  nearbyItems = [];
  for (const loot of loots) {
    const dist = Math.hypot(player.x - loot.x, player.y - loot.y);
    if (dist <= 250) {
      nearbyItems.push({ loot, dist: Math.round(dist) });
    }
  }
  nearbyItems.sort((a, b) => a.dist - b.dist);
  nearbyCountEl.innerText = `${nearbyItems.length} 件`;
  const signature = nearbyItems.map(entry => entry.loot.id).join('|');
  if (signature === nearbySignature && nearbyListEl.children.length === nearbyItems.length && nearbyItems.length) {
    nearbyItems.forEach((entry, i) => {
      nearbyListEl.children[i].querySelector('.nearby-item-dist').innerText = `${entry.dist}px`;
    });
    return;
  }
  nearbySignature = signature;
  nearbyListEl.innerHTML = '';
  if (nearbyItems.length === 0) {
    nearbyListEl.innerHTML = '<div class="nearby-empty">附近没有物品</div>';
    return;
  }
  nearbyItems.forEach((entry, i) => {
    const item = entry.loot;
    const el = document.createElement('div');
    el.className = 'nearby-item';
    el.innerHTML = `
      <span class="nearby-item-emoji">${assetMarkup(item)}</span>
      <div class="nearby-item-info">
        <span class="nearby-item-name">${item.name}</span>
        <span class="nearby-item-value">$${(item.value || 0).toLocaleString()}</span>
      </div>
      <span class="nearby-item-dist">${entry.dist}px</span>
    `;
    el.addEventListener('click', () => { takeGroundLoot(item, 250); refreshNearbyPanel(); });
    nearbyListEl.appendChild(el);
  });
}

function pickNearbyItem(i) {
  const entry = nearbyItems[i];
  if (!entry) return;
  takeGroundLoot(entry.loot, 250);
  refreshNearbyPanel();
}

initInput(canvas, camera, interactTarget, reloadWeapon, toggleInventory, throwGrenade, useMedkit, switchWeapon, toggleNearbyLoot, isRaidActive);
document.addEventListener('use-medicine', event => useMedkit(event.detail));

function togglePause(force = !isPaused) {
  if (raidState !== 'inRaid') return;
  isPaused = force; resetInput();
  document.getElementById('pause-panel')?.classList.toggle('hidden', !isPaused);
  if (isPaused) document.getElementById('resume-btn')?.focus();
}
window.addEventListener('keydown', event => {
  if (event.code !== 'Escape' || event.repeat || document.querySelector('dialog[open]')) return;
  if (raidState === 'inRaid') { event.preventDefault(); togglePause(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) togglePause(true); });
document.getElementById('resume-btn')?.addEventListener('click', () => togglePause(false));
document.getElementById('abandon-btn')?.addEventListener('click', async () => {
  const accepted = await confirmAction({title:'放弃本次行动？', description:'将失去未放入保护栏的携带物资，保护栏中的物品会返回仓库。', action:'放弃行动'});
  if (accepted && raidState === 'inRaid') finishRaid(false, 'abandoned');
});
document.addEventListener('secure-item', event => secureLoot(event.detail));
document.addEventListener('unsecure-item', event => secureLoot(event.detail, true));

// ---- Operator picker on start screen ----
function initOperatorPicker() {
  const ops = allOperators();
  const container = document.getElementById('operator-cards');
  if (!container) return;
  container.innerHTML = '';

  const maxHp = Math.max(...ops.map(o => o.maxHp || 100));
  const maxArmor = 1;
  if (!ops.some(op => op.id === selectedOpId)) selectedOpId = ops[0]?.id;
  const maxSpeed = Math.max(...ops.map(o => o.baseSpeed || 300));
  const maxSlots = Math.max(...ops.map(o => o.maxSlots || 12));

  ops.forEach((op, i) => {
    const hpPct = Math.round(((op.maxHp || 100) / maxHp) * 100);
    const armorPct = Math.round(((op.maxArmor ?? 0) / maxArmor) * 100);
    const speedPct = Math.round(((op.baseSpeed || 300) / maxSpeed) * 100);
    const slotsPct = Math.round(((op.maxSlots || 12) / maxSlots) * 100);

    const card = document.createElement('button');
    card.type = 'button'; card.dataset.operatorId = op.id;
    card.setAttribute('aria-pressed', String(op.id === selectedOpId));
    card.className = 'op-card' + (op.id === selectedOpId ? ' selected' : '');
    card.innerHTML = `
      <span class="op-emoji">${assetMarkup(op, { kind: 'operator' })}</span>
      <span class="op-name">${op.name}</span>
      <span class="op-desc">${op.description}</span>
      <div class="op-stats">
        <div class="op-stat-row"><span>❤️</span><div class="op-stat-bar"><div class="op-stat-fill hp" style="width:${hpPct}%"></div></div><span class="op-stat-val">${op.maxHp}</span></div>
        <div class="op-stat-row"><span>🛡️</span><div class="op-stat-bar"><div class="op-stat-fill armor" style="width:${armorPct}%"></div></div><span class="op-stat-val">${op.maxArmor}</span></div>
        <div class="op-stat-row"><span>🏃</span><div class="op-stat-bar"><div class="op-stat-fill speed" style="width:${speedPct}%"></div></div><span class="op-stat-val">${op.baseSpeed}</span></div>
        <div class="op-stat-row"><span>🎒</span><div class="op-stat-bar"><div class="op-stat-fill slots" style="width:${slotsPct}%"></div></div><span class="op-stat-val">${op.maxSlots}</span></div>
      </div>
      ${op.passive ? `<span class="op-passive">${{regen:'脱离伤害 3 秒后回血',precision:'射击散布降低 70%',fastSearch:'搜索耗时减半'}[op.passive] || op.passive}</span>` : ''}
    `;
    card.addEventListener('click', () => {
      container.querySelectorAll('.op-card').forEach(c => { c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false'); });
      card.classList.add('selected'); card.setAttribute('aria-pressed', 'true');
      selectedOpId = op.id;
      // Update equip capacity from operator + any backpack bonus
      setMaxEquipSlots(op.maxSlots || 12);
      refreshLobbyUI();
    });
    container.appendChild(card);
  });

  if (ops.length > 0) {
    setMaxEquipSlots(getOperatorDef(selectedOpId).maxSlots || 12);
  }
}

// Anonymous local progression is ready before enabling the home action.
Promise.all([loadLootData(), loadOperatorData(), loadBotData(), loadShopData(), loadWeaponData()]).then(() => {
  loadSettings(); loadProfile();
  initOperatorPicker(); initShopUI(getShopItems()); initLobbyUI();
}).catch(error => {
  const status = document.getElementById('boot-status');
  if (status) { status.textContent = error.message || '启动失败，请重试'; status.classList.add('error'); }
  document.getElementById('boot-retry-btn')?.classList.remove('hidden');
  if (error.code === 'CORRUPT_SAVE') document.getElementById('boot-reset-btn')?.classList.remove('hidden');
});

onDeploy(async () => {
  if (raidState !== 'lobby') return;
  const button = document.getElementById('deploy-btn');
  if (button) button.disabled = true;
  if (await initWorld()) hideStartScreen();
  else if (raidState === 'lobby') showStartScreen();
  if (button) button.disabled = Boolean(getLoadoutError());
});

onRestart(() => {
  if (raidState === 'settlementPending') { finishRaid(pendingSettlement, player.raidOutcome); return; }
  if (raidState === 'deploymentPending') {
    try { cancelDeployment(pendingSettlement); pendingSettlement = null; }
    catch (error) { pushNotification(error.message); document.getElementById('result-modal').classList.remove('hidden'); return; }
  }
  closeRaidPanels();
  gameStarted = false; isGameOver = false; raidState = 'lobby'; activeRaidId = null;
  initOperatorPicker(); showStartScreen();
});

document.getElementById('map-import')?.addEventListener('change', async event => {
  if (raidState !== 'lobby') return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('地图文件不能超过 4 MB');
    const data = JSON.parse(await file.text());
    buildWorldFromMap(data);
    const id = `imported-${importedMaps.size + 1}`;
    importedMaps.set(id, data);
    const option = document.createElement('option'); option.value = id; option.textContent = `🗺️ ${data.name || file.name}`;
    const select = document.getElementById('map-select'); select.appendChild(option); select.value = id;
    pushNotification('🗺️ 地图导入成功');
  } catch (error) { pushNotification(`⚠️ ${error.message}`); }
  event.target.value = '';
});

// Start rendering
requestAnimationFrame(loop);
