// physics.js - AABB collision, raycasting, movement
export function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function getPlayerBox(player, px, py) {
  return {
    x: px - player.size * 0.4,
    y: py - player.size * 0.4,
    w: player.size * 0.8,
    h: player.size * 0.8
  };
}

export function rayBoxIntersect(o, d, box) {
  const invDx = 1.0 / (d.x === 0 ? 0.00001 : d.x);
  const invDy = 1.0 / (d.y === 0 ? 0.00001 : d.y);

  const t1 = (box.x - o.x) * invDx;
  const t2 = (box.x + box.w - o.x) * invDx;
  const t3 = (box.y - o.y) * invDy;
  const t4 = (box.y + box.h - o.y) * invDy;

  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));

  if (tmax < 0 || tmin > tmax) return null;
  return tmin < 0 ? tmax : tmin;
}

export function raycastHitscan(origin, dir, maxDist, walls, bots) {
  let minT = maxDist;
  let hitInfo = null;

  for (const wall of walls) {
    if (wall.emoji === '🌲') continue;
    const res = rayBoxIntersect(origin, dir, wall);
    if (res && res < minT) {
      minT = res;
      hitInfo = { x: origin.x + dir.x * minT, y: origin.y + dir.y * minT, type: 'wall', entity: wall };
    }
  }

  for (const bot of bots) {
    const bBox = { x: bot.x - bot.size / 2, y: bot.y - bot.size / 2, w: bot.size, h: bot.size };
    const res = rayBoxIntersect(origin, dir, bBox);
    if (res && res < minT) {
      minT = res;
      hitInfo = { x: origin.x + dir.x * minT, y: origin.y + dir.y * minT, type: 'bot', entity: bot };
    }
  }
  return hitInfo;
}

export function hasLineOfSight(p1, p2, walls) {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const dir = { x: (p2.x - p1.x) / dist, y: (p2.y - p1.y) / dist };
  for (const wall of walls) {
    if (!wall.isBlockingLoS) continue;
    const hitT = rayBoxIntersect(p1, dir, wall);
    if (hitT !== null && hitT < dist) return false;
  }
  return true;
}

export function movePlayer(player, dt, keys, walls, WORLD_WIDTH, WORLD_HEIGHT) {
  let moveX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  let moveY = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
  const moveLen = Math.hypot(moveX, moveY);

  player.isSprinting = keys.shift && moveLen > 0 && player.stamina > 0;
  let speed = player.baseSpeed;

  if (player.isSprinting) {
    speed *= player.sprintMultiplier;
    player.stamina = Math.max(0, player.stamina - dt * 35);
  } else {
    const regenRate = moveLen > 0 ? 15 : 35;
    player.stamina = Math.min(player.maxStamina, player.stamina + dt * regenRate);
  }

  if (player.isSprinting) player.spread = 0.16;
  else if (moveLen > 0) player.spread = 0.08;
  else player.spread = 0.02;

  if (moveLen > 0) {
    const normX = moveX / moveLen;
    const normY = moveY / moveLen;
    const vx = normX * speed * dt;
    const vy = normY * speed * dt;

    const boxX = getPlayerBox(player, player.x + vx, player.y);
    let collideX = false;
    for (const wall of walls) {
      if (aabb(boxX.x, boxX.y, boxX.w, boxX.h, wall.x, wall.y, wall.w, wall.h)) {
        collideX = true; break;
      }
    }
    if (!collideX) player.x += vx;

    const boxY = getPlayerBox(player, player.x, player.y + vy);
    let collideY = false;
    for (const wall of walls) {
      if (aabb(boxY.x, boxY.y, boxY.w, boxY.h, wall.x, wall.y, wall.w, wall.h)) {
        collideY = true; break;
      }
    }
    if (!collideY) player.y += vy;

    player.x = Math.max(player.size / 2, Math.min(WORLD_WIDTH - player.size / 2, player.x));
    player.y = Math.max(player.size / 2, Math.min(WORLD_HEIGHT - player.size / 2, player.y));
  }
}
