// entities.js - All entity class definitions
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import { getWeaponDef } from './weapondata.js';

export class Player {
  /**
   * @param {Object} [op] Operator config from operatordata.js
   */
  constructor(op) {
    op = op || {};

    this.x = WORLD_WIDTH / 2;
    this.y = WORLD_HEIGHT / 2;
    this.size = op.size || 48;
    this.emoji = op.emoji || '⚔️';
    this.opName = op.name || '特工';
    this.opId = op.id || 'tactical';

    this.maxHp = op.maxHp ?? 100;
    this.hp = this.maxHp;
    this.maxArmor = op.maxArmor ?? 0;
    this.armor = this.maxArmor;
    this.armorClass = op.armorClass ?? 0;

    this.maxStamina = op.maxStamina || 100;
    this.stamina = this.maxStamina;

    this.baseSpeed = op.baseSpeed || 300;
    this.sprintMultiplier = op.sprintMultiplier || 1.6;
    this.isSprinting = false;

    const g = getWeaponDef(op.weaponId) || op.gun || {};
    this.gun = {
      id: g.id || op.weaponId || 'tac_smg',
      emoji: g.emoji || '🔫',
      name: g.name || 'TAC-SMG',
      damage: g.damage || 28,
      penetration: g.penetration || 35,
      fireRate: g.fireRate || 0.08,
      cooldown: 0,
      magSize: g.magSize || 30,
      currentAmmo: g.magSize || 30,
      maxAmmo: g.maxAmmo || 120,
      isReloading: false,
      reloadTime: g.reloadTime || 1.8,
      reloadTimer: 0
    };
    this.gun.range = g.range ?? 800;
    this.gun.pellets = g.pellets ?? 1;
    this.gun.pelletSpread = g.pelletSpread ?? 0;
    this.gun.ammoType = g.ammoType || '9mm';
    this.gun.fireMode = g.fireMode || 'auto';
    this.passive = op.passive || null;
    this.passiveValue = op.passiveValue ?? 0;
    this.damageFreeTime = 0;
    this.ammoReserves = {};
    this.loadoutGear = [];
    this.mapName = '';

    this.spread = 0.02;
    this.isExtracting = false;
    this.extractTimer = 0;
    this.extractDuration = 10.0;
    this.inventory = [];
    this.secureInventory = [];
    this.kills = 0;
    this.raidElapsed = 0;
    this.raidTimeRemaining = 600;
    this.raidOutcome = '';
    this.action = null;
    this.maxSlots = op.maxSlots || 12;
  }
}

export class Wall {
  constructor(x, y, w, h, emoji = '🧱', isBlockingLoS = true) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.emoji = emoji;
    this.isBlockingLoS = isBlockingLoS;
  }
}

export class Bot {
  /**
   * @param {number} x
   * @param {number} y
   * @param {Object} [cfg] Bot config from botdata.js
   */
  constructor(x, y, cfg) {
    cfg = cfg || {};
    this.id = Math.random().toString();
    this.x = x;
    this.y = y;
    this.botId = cfg.id || 'zombie';
    this.botName = cfg.name || '敌人';
    this.category = cfg.category || 'melee';
    this.size = cfg.size || 48;
    this.emoji = cfg.emoji || '🧟';
    this.hp = cfg.hp || 80;
    this.maxHp = this.hp;
    this.armor = this.maxArmor = cfg.armor ?? 0;
    this.armorClass = cfg.armorClass ?? 0;
    this.speed = cfg.speed || 140;
    this.damage = cfg.damage || 20;
    this.penetration = cfg.penetration || 15;
    this.attackRange = cfg.attackRange || 60;
    this.fireRate = cfg.fireRate || 1.0;
    this.visionRange = cfg.visionRange || 350;
    this.reactionDelayCfg = cfg.reactionDelay || 0.3;
    this.state = 'patrol';
    this.targetX = x + (Math.random() - 0.5) * 300;
    this.targetY = y + (Math.random() - 0.5) * 300;
    this.patrolTimer = 0;
    this.fireCooldown = 0;
    // Phase 3: enhanced AI fields
    this.facingAngle = Math.random() * Math.PI * 2;
    this.reactionDelay = 0;
    this.aggroLossTimer = 0;
    this.aiTickTimer = 0;
    this.nextPathTarget = null;
    this.patrolOrigin = null;
    this.patrolRadius = 200;
    this.investigateTimer = 0;
  }
}

export class Loot {
  constructor(x, y, type) {
    this.id = Math.random().toString();
    this.x = x;
    this.y = y;
    this.size = 36;
    this.type = type;
    // Set by caller after construction, or use defaults
    this.emoji = '📦';
    this.name = '未知物品';
    this.value = 0;
    this.onPickup = null;
    // Backpack search state
    this.isSearching = false;
    this.searchTimer = 0;
    this.searchDuration = 1.5;
    this.isSearched = false;
    this.raidId = null;
  }
}

/** Apply loot data to a Loot instance (resolved from lootdata.js) */
export function applyLootData(loot, def) {
  loot.emoji = def.emoji;
  loot.name = def.name;
  loot.value = def.value || 0;
  loot.onPickup = def.onPickup || null;
  loot.rarity = def.rarity ?? 1;
  loot.useTime = def.useTime ?? 3;
  loot.ammoType = def.ammoType || null;
  loot.ammoAmount = def.ammoAmount || 0;
}

export class LootContainer {
  constructor(x, y, containerType, config = {}) {
    this.id = Math.random().toString();
    this.x = x;
    this.y = y;
    this.type = containerType; // 'safe', 'filing_cabinet', 'wardrobe'
    this.size = 48;
    this.isOpen = false;
    this.isSearching = false;
    this.searchTimer = 0;
    this.searchDuration = containerType === 'safe' ? 5.0 : 3.0;
    this.isLocked = containerType === 'safe';
    this.emoji = { safe: '🔐', filing_cabinet: '🗄️', wardrobe: '🚪' }[containerType] || '📦';
    this.name = { safe: '保险柜', filing_cabinet: '文件柜', wardrobe: '衣柜' }[containerType] || '容器';
    this.requiredKey = config.requiredKey ?? (containerType === 'safe' ? 'keycard_red' : null);
    this.isLocked = Boolean(this.requiredKey);
    this.searchDuration = config.searchDuration ?? this.searchDuration;
    this.baseSearchDuration = this.searchDuration;
    this.raidId = null;
    this.spawnedLoot = [];
  }
}

export class Particle {
  constructor(x, y, vx, vy, color, life, size) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.life = life; this.maxLife = life;
    this.size = size;
  }
}

export class SoundBlip {
  constructor(x, y, radius = 500) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.life = 0.5; this.maxLife = 0.5;
  }
}
