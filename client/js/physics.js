// physics.js - swept AABB collision, raycasting and deterministic stamina.
export function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function getPlayerBox(player, px, py) {
  return { x: px - player.size * 0.4, y: py - player.size * 0.4, w: player.size * 0.8, h: player.size * 0.8 };
}

export function rayBoxIntersect(o, d, box) {
  if (![o.x, o.y, d.x, d.y, box.x, box.y, box.w, box.h].every(Number.isFinite) ||
      box.w < 0 || box.h < 0 || (d.x === 0 && d.y === 0)) return null;
  let entry = -Infinity, exit = Infinity;
  // A parallel ray stays in the same slab. Replacing zero with an epsilon
  // tilts the ray and creates false hits at a distance.
  for (const [position, direction, low, high] of [
    [o.x, d.x, box.x, box.x + box.w], [o.y, d.y, box.y, box.y + box.h]
  ]) {
    if (direction === 0) {
      if (position < low || position > high) return null;
      continue;
    }
    const a = (low - position) / direction, b = (high - position) / direction;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return null;
  }
  return exit < 0 ? null : Math.max(0, entry);
}

export function raycastHitscan(origin, dir, maxDist, walls, bots) {
  if (!Number.isFinite(maxDist) || maxDist < 0) return null;
  let minT = maxDist, hitInfo = null;
  const consider = (box, type, entity) => {
    const t = rayBoxIntersect(origin, dir, box);
    if (t !== null && t <= maxDist && (!hitInfo || t < minT)) {
      minT = t;
      hitInfo = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, type, entity };
    }
  };
  // Walls are considered first so an enemy touching a wall cannot win a tie.
  for (const wall of walls) {
    if (wall.emoji === '\u{1F332}') continue;
    consider(wall, 'wall', wall);
  }
  for (const bot of bots) consider({ x: bot.x - bot.size / 2, y: bot.y - bot.size / 2, w: bot.size, h: bot.size }, 'bot', bot);
  return hitInfo;
}

export function hasLineOfSight(p1, p2, walls) {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!Number.isFinite(dist)) return false;
  if (dist === 0) return true;
  const dir = { x: (p2.x - p1.x) / dist, y: (p2.y - p1.y) / dist };
  for (const wall of walls) {
    if (!wall.isBlockingLoS) continue;
    const t = rayBoxIntersect(p1, dir, wall);
    if (t !== null && t < dist) return false;
  }
  return true;
}

// MVP tuning, not official Delta Force numeric values. Shared with HUD/tests.
export const STAMINA_RULES = Object.freeze({
  drainPerSecond: 35,
  walkingRegenPerSecond: 15,
  restingRegenPerSecond: 35,
  recoveryDelaySeconds: 0.8,
  restartFraction: 0.2
});
const EPSILON = 1e-7;

// Sweep an axis rather than just checking the destination, so a thin wall
// cannot be skipped by a fast operator or a delayed animation frame.
function moveAxis(player, amount, axis, walls, worldLimit) {
  if (amount === 0) return;
  const other = axis === 'x' ? 'y' : 'x';
  const sizeKey = axis === 'x' ? 'w' : 'h', otherSizeKey = axis === 'x' ? 'h' : 'w';
  const half = player.size * 0.4;
  let allowed = amount;
  for (const wall of walls) {
    if (player[other] + half <= wall[other] || player[other] - half >= wall[other] + wall[otherSizeKey]) continue;
    if (amount > 0 && player[axis] + half <= wall[axis] + EPSILON) {
      allowed = Math.min(allowed, Math.max(0, wall[axis] - player[axis] - half));
    } else if (amount < 0 && player[axis] - half >= wall[axis] + wall[sizeKey] - EPSILON) {
      allowed = Math.max(allowed, Math.min(0, wall[axis] + wall[sizeKey] - player[axis] + half));
    }
  }
  // Keep the whole sprite on the map while using its smaller collision box.
  const radius = player.size / 2;
  player[axis] = Math.max(radius, Math.min(Math.max(radius, worldLimit - radius), player[axis] + allowed));
}

function recoverStamina(player, dt, moving) {
  const recoveringTime = Math.max(0, dt - player.staminaRecoveryDelay);
  player.staminaRecoveryDelay = Math.max(0, player.staminaRecoveryDelay - dt);
  const rate = moving ? STAMINA_RULES.walkingRegenPerSecond : STAMINA_RULES.restingRegenPerSecond;
  player.stamina = Math.min(player.maxStamina, player.stamina + recoveringTime * rate);
}

export function movePlayer(player, dt, keys, walls, WORLD_WIDTH, WORLD_HEIGHT) {
  player.maxStamina = Number.isFinite(player.maxStamina) && player.maxStamina > 0 ? player.maxStamina : 100;
  player.stamina = Math.min(player.maxStamina, Math.max(0, Number.isFinite(player.stamina) ? player.stamina : player.maxStamina));
  player.staminaRecoveryDelay = Number.isFinite(player.staminaRecoveryDelay) ? Math.max(0, player.staminaRecoveryDelay) : 0;
  player.sprintExhausted = Boolean(player.sprintExhausted || player.stamina <= EPSILON);
  player.isSprinting = false;
  player.isMoving = false;
  if (!Number.isFinite(dt) || dt <= 0) return;

  const moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const moveY = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
  const moveLen = Math.hypot(moveX, moveY);
  const startX = player.x, startY = player.y;
  let remaining = dt;
  while (remaining > EPSILON) {
    // Exhaustion is a latch. Holding Shift through recovery cannot restart;
    // release it at/above 20% and press again for the next sprint.
    if (!keys.shift && player.stamina >= player.maxStamina * STAMINA_RULES.restartFraction) player.sprintExhausted = false;
    const sprintRequested = Boolean(keys.shift && moveLen > 0 && !player.sprintExhausted && player.stamina > EPSILON);
    const fullStep = Math.min(remaining, 1 / 60);
    let step = sprintRequested ? Math.min(fullStep, player.stamina / STAMINA_RULES.drainPerSecond) : fullStep;
    const speed = player.baseSpeed * (sprintRequested ? player.sprintMultiplier : 1);
    const oldX = player.x, oldY = player.y;
    if (moveLen > 0) {
      moveAxis(player, moveX / moveLen * speed * step, 'x', walls, WORLD_WIDTH);
      moveAxis(player, moveY / moveLen * speed * step, 'y', walls, WORLD_HEIGHT);
    }
    const distance = Math.hypot(player.x - oldX, player.y - oldY);
    const moving = distance > EPSILON;
    const sprinting = sprintRequested && moving;
    if (sprinting) {
      // Sliding along a wall spends stamina only for actual ground covered.
      const travelFraction = Math.min(1, distance / (speed * step));
      player.stamina = Math.max(0, player.stamina - STAMINA_RULES.drainPerSecond * step * travelFraction);
      player.staminaRecoveryDelay = STAMINA_RULES.recoveryDelaySeconds;
      if (player.stamina <= EPSILON) { player.stamina = 0; player.sprintExhausted = true; }
    } else {
      // When a near-empty player is blocked, process the full stationary step
      // rather than repeating tiny stamina-limited steps against the same wall.
      if (!moving) step = fullStep;
      recoverStamina(player, step, moving);
    }
    player.isSprinting = sprinting && !player.sprintExhausted;
    remaining -= step;
  }
  if (!keys.shift && player.stamina >= player.maxStamina * STAMINA_RULES.restartFraction) player.sprintExhausted = false;
  player.isMoving = Math.hypot(player.x - startX, player.y - startY) > EPSILON;
  player.spread = player.isSprinting ? 0.16 : player.isMoving ? 0.08 : 0.02;
}
