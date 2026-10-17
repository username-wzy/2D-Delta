// main.js - Game entry point, world init, game loop (Phase 3)
import { WORLD_WIDTH, WORLD_HEIGHT, TILE_SIZE } from './constants.js';
import { Player, Loot, Particle, SoundBlip, applyLootData } from './entities.js';
import { keys, mouse, initInput, resetInput } from './input.js';
import { aabb, getPlayerBox, raycastHitscan, movePlayer, hasLineOfSight } from './physics.js';
import { updateBots } from './ai.js';
import { render } from './renderer.js';
import { initHUD, updateHUD, refreshInventoryGrid, pushNotification, getElements } from './hud.js';
import { showStartScreen, hideStartScreen, onDeploy, showGameOver, showVictory, onRestart, showLoginScreen, onLogin, initShopUI, refreshLobbyUI } from './ui.js';
import { loadShopData } from './shopdata.js';
import { loadMap, buildWorldFromMap } from './maploader.js';
import { playShootSound, playHitSound, playPickupSound, playExtractionBeep, playEnemyShootSound, playGrenadeSound } from './sound.js';
import { randomLootType, getLootDef, loadLootData } from './lootdata.js';
import { loadOperatorData, defaultOperator, getOperatorDef, allOperators } from './operatordata.js';
import { loadBotData } from './botdata.js';
import { getCoins, getEquipped, getLoadoutError, setMaxEquipSlots, beginRaid, settleRaid, cancelDeployment } from './economy.js';
import { itemId, itemCategory, isGear, medicineHealing, loadoutCapacity } from './itemrules.js';
import { loadWeaponData, getWeaponDef } from './weapondata.js';
import { assetMarkup, loadGameAssets } from './assets.js';

// Artwork is optional: loading or missing images never block login or deployment.
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

function isRaidActive() { return raidState === 'inRaid' && gameStarted && !isGameOver; }

function closeRaidPanels() {
  hideContainerLoot();
  nearbyItems = [];
  nearbySignature = '';
  nearestLoot = null; nearestContainer = null;
  for (const id of ['nearby-loot-panel', 'inventory-drawer', 'extraction-banner', 'interaction-prompt']) {
    document.getElementById(id)?.classList.add('hidden');
  }
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
    if (player.inventory.length >= player.maxSlots) { pushNotification('⚠️ 背包已满'); return false; }
    player.inventory.push(loot);
  }
  syncItemCounts(); refreshInventoryGrid(player);
  return true;
}

async function initWorld() {
  if (raidState === 'loading' || isRaidActive()) return false;
  raidState = 'loading'; gameStarted = false;
  closeRaidPanels();
  let deploymentId = null;
  try {
    const mapPath = document.getElementById('map-select')?.value || 'maps/factory_01.json';
    const mapData = importedMaps.get(mapPath) || await loadMap(mapPath);
    const world = buildWorldFromMap(mapData);
    const opDef = getOperatorDef(selectedOpId || defaultOperator().id);
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
        player.armor = player.maxArmor = Math.max(player.armor, heavy ? 220 : 120);
        player.armorClass = Math.max(player.armorClass, heavy ? 5 : 2);
      }
      if (!isGear(item)) {
        const loot = newLoot(player.x, player.y, itemId(item));
        loot.broughtIn = true;
        if (itemCategory(loot) === 'ammo') giveLoot(loot);
        else player.inventory.push(loot);
      }
    }
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
    if (deploymentId) cancelDeployment(deploymentId);
    activeRaidId = null;
    raidState = 'lobby'; gameStarted = false;
    pushNotification(`⚠️ ${error.message}`);
    return false;
  }
}

function finishRaid(survived) {
  if (!isRaidActive() && raidState !== 'settlementPending') return;
  try {
    if (!settleRaid(activeRaidId, survived, player.loadoutGear, player.inventory)) return;
  } catch (error) {
    raidState = 'settlementPending'; gameStarted = false; pendingSettlement = survived;
    closeRaidPanels();
    document.getElementById('result-modal').classList.remove('hidden');
    document.getElementById('result-title').innerText = '结算保存失败';
    document.getElementById('result-desc').innerText = '请保持页面开启，检查浏览器存储空间后点击重试。';
    document.getElementById('summary-loot-container').innerHTML = '';
    document.getElementById('restart-btn').innerText = '重试保存';
    return;
  }
  pendingSettlement = null;
  isGameOver = true; gameStarted = false; raidState = survived ? 'extracted' : 'dead';
  closeRaidPanels();
  player.isExtracting = false;
  player.coins = getCoins();
  syncItemCounts(); updateHUD(player, null, null);
  if (survived) {
    const value = player.inventory.filter(item => !item.broughtIn).reduce((sum, item) => sum + (item.value || 0), 0);
    showVictory(player, value, 5000);
  } else showGameOver(player.mapName);
}

// ---- Actions ----
function fireWeapon() {
  if (!isRaidActive()) return;
  if (player.gun.currentAmmo <= 0) {
    if (!player.gun.isReloading && player.gun.maxAmmo > 0) reloadWeapon();
    return;
  }
  player.gun.currentAmmo--;
  player.gun.cooldown = player.gun.fireRate;
  shakeAmount = 4;

  // Play shoot sound (try-catch silent if unavailable)
  playShootSound();

  const targetAngle = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);
  const finalAngle = targetAngle + (Math.random() - 0.5) * player.spread;

  const rayOrigin = { x: player.x, y: player.y };
  const rayDir = { x: Math.cos(finalAngle), y: Math.sin(finalAngle) };
  const closestHit = raycastHitscan(rayOrigin, rayDir, 1200, walls, bots);

  // Muzzle flash
  for (let k = 0; k < 5; k++) {
    const pAngle = finalAngle + (Math.random() - 0.5) * 0.4;
    const pSpeed = 200 + Math.random() * 300;
    particles.push(new Particle(
      rayOrigin.x + rayDir.x * 30, rayOrigin.y + rayDir.y * 30,
      Math.cos(pAngle) * pSpeed, Math.sin(pAngle) * pSpeed,
      '#f59e0b', 0.1, 4
    ));
  }

  soundBlips.push(new SoundBlip(rayOrigin.x, rayOrigin.y, 600));

  if (closestHit) {
    playHitSound();

    for (let k = 0; k < 8; k++) {
      const sparkAngle = finalAngle + Math.PI + (Math.random() - 0.5) * 1.2;
      const sparkSpeed = 100 + Math.random() * 250;
      particles.push(new Particle(
        closestHit.x, closestHit.y,
        Math.cos(sparkAngle) * sparkSpeed, Math.sin(sparkAngle) * sparkSpeed,
        closestHit.type === 'bot' ? '#ef4444' : '#e2e8f0',
        0.2, closestHit.type === 'bot' ? 6 : 3
      ));
    }

    if (closestHit.type === 'bot' && closestHit.entity) {
      const bot = closestHit.entity;
      const isHeadshot = Math.random() < 0.25;
      const dmg = isHeadshot ? player.gun.damage * 2 : player.gun.damage;
      bot.hp -= dmg;
      bot.state = 'aggro';
      bot.targetX = player.x;
      bot.targetY = player.y;
      bot.reactionDelay = 0; // instantly react when hit

      if (bot.hp <= 0) {
        const idx = bots.indexOf(bot);
        if (idx !== -1) bots.splice(idx, 1);
        pushNotification(`💥 击杀 ${bot.emoji} (获得 150 EXP)`);
        const dropType = randomLootType();
        const dropLoot = newLoot(bot.x, bot.y, dropType);
        loots.push(dropLoot);
      }
    }
  }
}

function reloadWeapon() {
  if (!isRaidActive()) return;
  syncItemCounts();
  if (player.gun.isReloading || player.gun.currentAmmo === player.gun.magSize || player.gun.maxAmmo <= 0) return;
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
    if (player.inventory.length >= player.maxSlots && itemCategory(items[i]) !== 'ammo') continue;
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
    if (container.requiredKey && !player.inventory.some(item => item.type === container.requiredKey)) {
      pushNotification(`🔒 需要${getLootDef(container.requiredKey).name}才能打开${container.name}`); return;
    }
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
  if (index < 0) { pushNotification('⚠️ 没有手榴弹！'); return; }
  player.inventory.splice(index, 1); syncItemCounts(); refreshInventoryGrid(player);
  playGrenadeSound(); pushNotification('💥 手榴弹投出！');
  const angle = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);
  const distance = Math.min(500, Math.hypot(mouse.worldX - player.x, mouse.worldY - player.y));
  const gx = Math.max(0, Math.min(worldWidth, player.x + Math.cos(angle) * distance));
  const gy = Math.max(0, Math.min(worldHeight, player.y + Math.sin(angle) * distance));
  for (const bot of bots) {
    const dist = Math.hypot(bot.x - gx, bot.y - gy);
    if (dist <= 150 && hasLineOfSight({x:gx,y:gy}, bot, walls)) {
      bot.hp -= 80 * (1 - dist / 150); bot.state = 'aggro'; bot.targetX = player.x; bot.targetY = player.y; bot.reactionDelay = 0;
    }
  }
  for (let k = 0; k < 30; k++) {
    const a = Math.random() * Math.PI * 2, speed = 100 + Math.random() * 300;
    particles.push(new Particle(gx, gy, Math.cos(a) * speed, Math.sin(a) * speed, '#f59e0b', 0.3 + Math.random() * 0.3, 5 + Math.random() * 8));
  }
  for (let i = bots.length - 1; i >= 0; i--) if (bots[i].hp <= 0) {
    pushNotification(`💥 击杀 ${bots[i].emoji}`);
    loots.push(newLoot(bots[i].x, bots[i].y, randomLootType())); bots.splice(i, 1);
  }
  soundBlips.push(new SoundBlip(gx, gy, 600)); shakeAmount = 15;
}

function useMedkit(itemInstanceId = null) {
  if (!isRaidActive()) return;
  if (player.hp >= player.maxHp) { pushNotification('⚠️ 生命值已满！'); return; }
  // Use the smallest medicine that covers the missing health, or the strongest available.
  const medicines = player.inventory.map((item, index) => ({item, index, heal: medicineHealing(item)})).filter(x => x.heal > 0).sort((a,b) => a.heal - b.heal);
  if (!medicines.length) { pushNotification('⚠️ 没有医疗用品！'); return; }
  const chosen = itemInstanceId ? medicines.find(x => x.item.id === itemInstanceId) : (medicines.find(x => x.heal >= player.maxHp - player.hp) || medicines.at(-1));
  if (!chosen) return;
  const healed = Math.min(chosen.heal, player.maxHp - player.hp);
  player.hp += healed; player.inventory.splice(chosen.index, 1);
  syncItemCounts(); refreshInventoryGrid(player);
  pushNotification(`❤️ 使用${chosen.item.name} +${healed} HP`);
}

function switchWeapon(idx) {
  if (!isRaidActive() || idx < 0 || idx >= weaponSlots.length || idx === selectedWeaponIdx) return;
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

  // Search immobilization: check if player is searching a container or backpack
  let isSearching = false;
  for (const c of containers) {
    if (c.isSearching) {
      const d = Math.hypot(player.x - c.x, player.y - c.y);
      if (d < 70) {
        isSearching = true;
        if (keys.w || keys.a || keys.s || keys.d) {
          c.isSearching = false;
          c.searchTimer = 0;
          pushNotification('⚠️ 搜索中断 — 请保持静止');
        }
        break;
      }
    }
  }
  // Check backpack search
  if (!isSearching) {
    for (const loot of loots) {
      if (loot.isSearching && loot.type === 'backpack') {
        const d = Math.hypot(player.x - loot.x, player.y - loot.y);
        if (d < 60) {
          isSearching = true;
          if (keys.w || keys.a || keys.s || keys.d) {
            loot.isSearching = false;
            loot.searchTimer = 0;
            pushNotification('⚠️ 搜索中断 — 请保持静止');
          }
          break;
        }
      }
    }
  }

  if (!isSearching) {
    movePlayer(player, dt, keys, walls, worldWidth, worldHeight);
    if (player.passive === 'precision') player.spread *= player.passiveValue;
  }

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
  const botResult = updateBots(dt, bots, player, soundBlips, walls);
  if (botResult.fired) {
    playEnemyShootSound(); // enemy gunshot sound
  }
  if (botResult.hit) {
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

  // Extraction — check all points
  const pBox = getPlayerBox(player, player.x, player.y);
  let inExtraction = false;
  for (const ext of extractions) {
    if (aabb(pBox.x, pBox.y, pBox.w, pBox.h, ext.x, ext.y, ext.w, ext.h)) {
      inExtraction = true;
      break;
    }
  }
  if (inExtraction) {
    if (!player.isExtracting) {
      player.isExtracting = true;
      player.extractTimer = player.extractDuration;
      getElements().extractionBanner.classList.remove('hidden');
      pushNotification('🚁 进入撤离区！保持存活 10 秒钟...');
    }
    player.extractTimer -= dt;
    // Extraction beep every second
    extractionBeepTimer -= dt;
    if (extractionBeepTimer <= 0) {
      extractionBeepTimer = 1.0;
      playExtractionBeep(1 - player.extractTimer / player.extractDuration);
    }
    if (player.extractTimer <= 0) {
      finishRaid(true);
      return;

    }
  } else if (player.isExtracting) {
    player.isExtracting = false;
    getElements().extractionBanner.classList.add('hidden');
    pushNotification('⚠️ 离开撤离区，撤离流程中断！');
  }

  nearestLoot = null;
  let minDist = 60;
  for (const loot of [...loots]) {
    const dist = Math.hypot(player.x - loot.x, player.y - loot.y);
    if (dist < minDist && hasLineOfSight(player, loot, walls)) { minDist = dist; nearestLoot = loot; }
    if (!loot.isSearching || loot.type !== 'backpack') continue;
    if (dist > 60 || keys.w || keys.a || keys.s || keys.d) { loot.isSearching = false; loot.searchTimer = 0; continue; }
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
      if (dist > 70 || keys.w || keys.a || keys.s || keys.d) { c.isSearching = false; c.searchTimer = 0; continue; }
      c.searchTimer -= dt;
      if (c.searchTimer <= 0) {
        c.isSearching = false;
        c.isOpen = true;
        // Generate loot into container's spawnedLoot
        const lootCount = 2 + Math.floor(Math.random() * 3); // 2-4 items
        for (let li = 0; li < lootCount; li++) {
          const lt = randomLootType();
          const def = getLootDef(lt);
          c.spawnedLoot.push({ type: lt, emoji: def.emoji, name: def.name, value: def.value || 0, onPickup: def.onPickup, ammoType: def.ammoType, ammoAmount: def.ammoAmount });
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
  render(ctx, canvas, camera, { player, walls, bots, loots, containers, particles, soundBlips, helipad, extractions, mouse, shakeAmount, tileSize });
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

// ---- Operator picker on start screen ----
function initOperatorPicker() {
  const ops = allOperators();
  const container = document.getElementById('operator-cards');
  if (!container) return;
  container.innerHTML = '';

  const maxHp = Math.max(...ops.map(o => o.maxHp || 100));
  const maxArmor = Math.max(...ops.map(o => o.maxArmor || 80));
  const maxSpeed = Math.max(...ops.map(o => o.baseSpeed || 300));
  const maxSlots = Math.max(...ops.map(o => o.maxSlots || 12));

  ops.forEach((op, i) => {
    const hpPct = Math.round(((op.maxHp || 100) / maxHp) * 100);
    const armorPct = Math.round(((op.maxArmor || 80) / maxArmor) * 100);
    const speedPct = Math.round(((op.baseSpeed || 300) / maxSpeed) * 100);
    const slotsPct = Math.round(((op.maxSlots || 12) / maxSlots) * 100);

    const card = document.createElement('div');
    card.className = 'op-card' + (i === 0 ? ' selected' : '');
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
      container.querySelectorAll('.op-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedOpId = op.id;
      // Update equip capacity from operator + any backpack bonus
      setMaxEquipSlots(op.maxSlots || 12);
      refreshLobbyUI();
    });
    container.appendChild(card);
  });

  if (ops.length > 0) {
    selectedOpId = ops[0].id;
    setMaxEquipSlots(ops[0].maxSlots || 12);
  }
}

// Login → Start screen flow
Promise.all([loadLootData(), loadOperatorData(), loadBotData(), loadShopData(), loadWeaponData()]).then(() => {
  initOperatorPicker();
  showLoginScreen();
  onLogin((name) => {
    initShopUI([]);
    import('./shopdata.js').then(m => initShopUI(m.getShopItems()));
    showStartScreen();
  });
});

onDeploy(async () => {
  if (raidState !== 'lobby') return;
  const button = document.getElementById('deploy-btn');
  if (button) button.disabled = true;
  if (await initWorld()) hideStartScreen();
  else showStartScreen();
  if (button) button.disabled = Boolean(getLoadoutError());
});

onRestart(() => {
  if (raidState === 'settlementPending') { finishRaid(pendingSettlement); return; }
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
