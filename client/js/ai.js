// Bots react to observed positions and sound, not the player's hidden coordinates.
import { hasLineOfSight } from './physics.js';
import { applyDamage } from './combat.js';

const VISION_CONE = Math.PI * 0.56;
const AGGRO_LOSS_TIME = 6;
const AI_TICK_INTERVAL = 0.25;
const INVESTIGATE_TIME = 4;
const SCAN_SPEED = 1.5;

export function updateBots(dt, bots, player, soundBlips, walls, worldWidth = Infinity, worldHeight = Infinity) {
  if (!Number.isFinite(dt) || dt <= 0) return { hit: false, fired: false, bot: null };
  const liveBots = bots.filter(bot => bot.hp > 0);
  // Observe first, then share alerts, so array order cannot change who is warned.
  for (const bot of liveBots) {
    bot.aiTickTimer -= dt;
    if (bot.aiTickTimer > 0) continue;
    bot.aiTickTimer = AI_TICK_INTERVAL;
    const seesPlayer = inVisionCone(bot, player.x, player.y) && hasLineOfSight(bot, player, walls);
    bot.hasVisualContact = seesPlayer;
    if (seesPlayer) {
      // Reaction delay belongs to acquiring a target, not every decision tick.
      if (bot.state !== 'aggro') bot.reactionDelay = bot.reactionDelayCfg;
      bot.state = 'aggro';
      bot.targetX = bot.lastKnownPlayerX = player.x;
      bot.targetY = bot.lastKnownPlayerY = player.y;
      bot.aggroLossTimer = AGGRO_LOSS_TIME;
    } else if (bot.state === 'aggro') {
      // Keep the last seen/hit position. Do not turn or walk toward a hidden player.
      bot.aggroLossTimer -= AI_TICK_INTERVAL;
      if (bot.aggroLossTimer <= 0) {
        bot.state = 'patrol';
        bot.reactionDelay = 0;
      }
    }
    if (bot.state === 'patrol') {
      const sound = [...soundBlips].reverse().find(blip => Math.hypot(blip.x - bot.x, blip.y - bot.y) <= blip.radius);
      if (sound) investigate(bot, sound.x, sound.y, INVESTIGATE_TIME);
      // Stationary players behind a guard do not emit perpetual footsteps.
      else if (player.isMoving && Math.hypot(player.x - bot.x, player.y - bot.y) < 120) {
        investigate(bot, player.x, player.y, 2);
      }
    }
  }
  const observers = liveBots.filter(bot => bot.state === 'aggro' && bot.hasVisualContact);
  for (const bot of liveBots) {
    if (bot.state !== 'patrol') continue;
    const observer = observers.find(other => other !== bot && Math.hypot(other.x - bot.x, other.y - bot.y) < 350);
    if (observer) investigate(bot, observer.lastKnownPlayerX, observer.lastKnownPlayerY, INVESTIGATE_TIME);
  }

  let anyFired = false, anyHit = false, hitBot = null;
  for (const bot of liveBots) {
    bot.reactionDelay = Math.max(0, bot.reactionDelay - dt);
    if (bot.state === 'patrol') {
      bot.facingAngle += SCAN_SPEED * dt * (Math.random() > 0.5 ? 1 : -1);
      bot.patrolTimer -= dt;
      if (bot.patrolTimer <= 0) {
        const origin = bot.patrolOrigin || bot;
        const radius = bot.patrolOrigin ? bot.patrolRadius || 200 : 250;
        bot.targetX = origin.x + (Math.random() - 0.5) * radius * 2;
        bot.targetY = origin.y + (Math.random() - 0.5) * radius * 2;
        bot.patrolTimer = 1.5 + Math.random() * 2.5;
      }
    } else if (bot.state === 'investigate') {
      bot.investigateTimer -= dt;
      if (bot.investigateTimer <= 0) bot.state = 'patrol';
    }
    const radius = bot.size / 2;
    bot.targetX = clampCoordinate(bot.targetX, radius, worldWidth);
    bot.targetY = clampCoordinate(bot.targetY, radius, worldHeight);
    const dx = bot.targetX - bot.x, dy = bot.targetY - bot.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 20 || (bot.state === 'aggro' && distance > 0)) bot.facingAngle = Math.atan2(dy, dx);
    if (distance > 20) {
      const step = Math.min(bot.speed * dt, distance);
      const previousX = bot.x, previousY = bot.y;
      moveAxis(bot, dx / distance * step, 'x', walls, worldWidth);
      moveAxis(bot, dy / distance * step, 'y', walls, worldHeight);
      if (bot.state === 'patrol' && bot.x === previousX && bot.y === previousY) bot.patrolTimer = 0;
    } else {
      // Clamp even idle guards if a caller supplies a smaller custom world.
      bot.x = clampCoordinate(bot.x, radius, worldWidth);
      bot.y = clampCoordinate(bot.y, radius, worldHeight);
    }
    bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
    const playerDistance = Math.hypot(player.x - bot.x, player.y - bot.y);
    if (bot.state === 'aggro' && bot.hasVisualContact !== false && bot.reactionDelay <= 0 &&
        playerDistance < Math.min(bot.attackRange, bot.visionRange) && bot.fireCooldown <= 0 &&
        hasLineOfSight(bot, player, walls)) {
      bot.fireCooldown = bot.fireRate;
      applyDamage(player, bot.damage, bot.penetration);
      anyFired = true; anyHit = true; hitBot = bot;
    }
  }
  return { hit: anyHit, fired: anyFired, bot: hitBot };
}

function investigate(bot, x, y, duration) {
  bot.state = 'investigate';
  bot.targetX = x;
  bot.targetY = y;
  bot.investigateTimer = duration;
}

function clampCoordinate(value, radius, limit) {
  return Math.max(radius, Math.min(Math.max(radius, limit - radius), Number.isFinite(value) ? value : radius));
}

// Both brick walls and trees block movement. Sweep each axis to stop tunneling,
// while allowing a guard to slide along a wall toward its remembered target.
function moveAxis(bot, amount, axis, walls, limit) {
  const other = axis === 'x' ? 'y' : 'x';
  const axisSize = axis === 'x' ? 'w' : 'h', otherSize = axis === 'x' ? 'h' : 'w';
  const half = bot.size * 0.4;
  let allowed = amount;
  for (const wall of walls) {
    if (bot[other] + half <= wall[other] || bot[other] - half >= wall[other] + wall[otherSize]) continue;
    if (amount > 0 && bot[axis] + half <= wall[axis] + 1e-7) {
      allowed = Math.min(allowed, Math.max(0, wall[axis] - bot[axis] - half));
    } else if (amount < 0 && bot[axis] - half >= wall[axis] + wall[axisSize] - 1e-7) {
      allowed = Math.max(allowed, Math.min(0, wall[axis] + wall[axisSize] - bot[axis] + half));
    }
  }
  bot[axis] = clampCoordinate(bot[axis] + allowed, bot.size / 2, limit);
}

function inVisionCone(bot, targetX, targetY) {
  const dx = targetX - bot.x, dy = targetY - bot.y;
  if (Math.hypot(dx, dy) > bot.visionRange) return false;
  let difference = Math.atan2(dy, dx) - bot.facingAngle;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return Math.abs(difference) <= VISION_CONE / 2;
}
