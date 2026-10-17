// ai.js - Aggressive Bot AI FSM (wide vision, active scanning, alert spread)
import { hasLineOfSight } from './physics.js';

const VISION_CONE = Math.PI * 0.56;     // 100° wide vision
const AGGRO_LOSS_TIME = 6.0;
const AI_TICK_INTERVAL = 0.25;          // faster checks
const INVESTIGATE_TIME = 4.0;
const SCAN_SPEED = 1.5;                 // radians/sec scanning when idle

export function updateBots(dt, bots, player, soundBlips, walls) {
  let anyFired = false;
  let anyHit = false;
  let hitBot = null;
  const nowAggroBots = []; // track aggro bots for alert spread

  for (const bot of bots) {
    if (bot.hp <= 0) continue;

    const distToPlayer = Math.hypot(player.x - bot.x, player.y - bot.y);

    // Tick-throttled AI decisions
    bot.aiTickTimer -= dt;
    if (bot.aiTickTimer <= 0) {
      bot.aiTickTimer = AI_TICK_INTERVAL;

      // Does bot see the player? (vision cone + LoS)
      const seesPlayer = inVisionCone(bot, player.x, player.y) &&
        hasLineOfSight({ x: bot.x, y: bot.y }, { x: player.x, y: player.y }, walls);

      if (seesPlayer) {
        bot.state = 'aggro';
        bot.targetX = player.x;
        bot.targetY = player.y;
        bot.aggroLossTimer = AGGRO_LOSS_TIME;
        if (bot.reactionDelay <= 0) bot.reactionDelay = bot.reactionDelayCfg;
        nowAggroBots.push(bot);
      } else if (bot.state === 'aggro') {
        // Track last known player position even when out of sight
        bot.targetX = player.x;
        bot.targetY = player.y;
        bot.aggroLossTimer -= AI_TICK_INTERVAL;
        if (bot.aggroLossTimer <= 0) {
          bot.state = 'patrol';
          bot.reactionDelay = 0;
        }
      }

      // Sound investigation (gunshots attract attention)
      if (soundBlips.length > 0 && bot.state === 'patrol') {
        for (let i = soundBlips.length - 1; i >= 0; i--) {
          const blip = soundBlips[i];
          const blipDist = Math.hypot(blip.x - bot.x, blip.y - bot.y);
          if (blipDist <= blip.radius) {
            bot.state = 'investigate';
            bot.targetX = blip.x + (Math.random() - 0.5) * 80;
            bot.targetY = blip.y + (Math.random() - 0.5) * 80;
            bot.investigateTimer = INVESTIGATE_TIME;
            break;
          }
        }
      }

      // Proximity alert: if player is very close, detect even without vision cone
      if (bot.state === 'patrol' && distToPlayer < 120) {
        // Player is very close - "hear" footsteps
        bot.state = 'investigate';
        bot.targetX = player.x + (Math.random() - 0.5) * 60;
        bot.targetY = player.y + (Math.random() - 0.5) * 60;
        bot.investigateTimer = 2.0;
      }
    }

    // Alert spread: if any bot is aggro, nearby patrol bots investigate
    if (bot.state === 'patrol') {
      for (const aggroBot of nowAggroBots) {
        const alertDist = Math.hypot(aggroBot.x - bot.x, aggroBot.y - bot.y);
        if (alertDist < 350) {
          bot.state = 'investigate';
          bot.targetX = player.x + (Math.random() - 0.5) * 120;
          bot.targetY = player.y + (Math.random() - 0.5) * 120;
          bot.investigateTimer = INVESTIGATE_TIME;
          break;
        }
      }
    }

    // Reaction delay
    if (bot.reactionDelay > 0) {
      bot.reactionDelay -= dt;
    }

    // Patrol: scan environment by rotating facing angle
    if (bot.state === 'patrol') {
      bot.facingAngle += SCAN_SPEED * dt * (Math.random() > 0.5 ? 1 : -1);
      bot.patrolTimer -= dt;
      if (bot.patrolTimer <= 0) {
        if (bot.patrolOrigin) {
          bot.targetX = bot.patrolOrigin.x + (Math.random() - 0.5) * (bot.patrolRadius || 200) * 2;
          bot.targetY = bot.patrolOrigin.y + (Math.random() - 0.5) * (bot.patrolRadius || 200) * 2;
        } else {
          bot.targetX = bot.x + (Math.random() - 0.5) * 500;
          bot.targetY = bot.y + (Math.random() - 0.5) * 500;
        }
        bot.patrolTimer = 1.5 + Math.random() * 2.5;
      }
    }

    // Investigate: move to sound source, then return to patrol
    if (bot.state === 'investigate') {
      bot.investigateTimer -= dt;
      if (bot.investigateTimer <= 0) {
        bot.state = 'patrol';
      }
    }

    // Aggro: update facing toward player
    if (bot.state === 'aggro') {
      bot.facingAngle = Math.atan2(player.y - bot.y, player.x - bot.x);
    }

    // Movement towards target
    const moveDist = Math.hypot(bot.targetX - bot.x, bot.targetY - bot.y);
    if (moveDist > 20) {
      const angle = Math.atan2(bot.targetY - bot.y, bot.targetX - bot.x);
      if (bot.state !== 'aggro') bot.facingAngle = angle;
      let nextX = bot.x + Math.cos(angle) * bot.speed * dt;
      let nextY = bot.y + Math.sin(angle) * bot.speed * dt;

      let collides = false;
      for (const wall of walls) {
        if (wall.emoji === '🧱') {
          const bBox = { x: nextX - bot.size / 2, y: nextY - bot.size / 2, w: bot.size, h: bot.size };
          if (bBox.x < wall.x + wall.w && bBox.x + bBox.w > wall.x &&
              bBox.y < wall.y + wall.h && bBox.y + bBox.h > wall.y) {
            collides = true; break;
          }
        }
      }
      if (!collides) { bot.x = nextX; bot.y = nextY; }
      else { bot.targetX = bot.x + (Math.random() - 0.5) * 200; bot.targetY = bot.y + (Math.random() - 0.5) * 200; }
    }

    // Combat
    if (bot.fireCooldown > 0) bot.fireCooldown -= dt;
    if (bot.state === 'aggro' && bot.reactionDelay <= 0 &&
        distToPlayer < bot.attackRange && bot.fireCooldown <= 0) {
      if (hasLineOfSight({ x: bot.x, y: bot.y }, { x: player.x, y: player.y }, walls)) {
        bot.fireCooldown = bot.fireRate;

        if (player.armor > 0) {
          if (bot.penetration >= player.armorClass * 10) {
            player.hp -= bot.damage * 0.8;
            player.armor -= bot.damage * 0.3;
          } else {
            player.armor -= bot.damage * 0.6;
            player.hp -= bot.damage * 0.15;
          }
        } else {
          player.hp -= bot.damage;
        }
        player.armor = Math.max(0, player.armor);
        player.hp = Math.max(0, player.hp);
        anyFired = true;
        anyHit = true;
        hitBot = bot;
      }
    }
  }
  return { hit: anyHit, fired: anyFired, bot: hitBot };
}

function inVisionCone(bot, targetX, targetY) {
  const dx = targetX - bot.x;
  const dy = targetY - bot.y;
  const dist = Math.hypot(dx, dy);
  if (dist > bot.visionRange) return false;
  const angleToTarget = Math.atan2(dy, dx);
  let diff = angleToTarget - bot.facingAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= VISION_CONE / 2;
}
