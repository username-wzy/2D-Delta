// Shared local combat rules. This is a 2D MVP simplification, not the
// official Delta Force damage formula or ballistic/grenade simulation.
import { rayBoxIntersect } from './physics.js';

export const COMBAT_RULES = Object.freeze({
  penetrationPerArmorClass: 10,
  blockedAbsorptionFraction: 0.9,
  penetratingArmorWearFraction: 0.35,
  throwSurfacePadding: 0.01
});

const positiveFinite = value => Number.isFinite(value) ? Math.max(0, value) : 0;

export function applyDamage(target, damage, penetration = 0) {
  const result = { hpDamage: 0, armorDamage: 0, penetrated: false, killed: false };
  if (!target || typeof target !== 'object') return result;
  // Corrupt values cannot create infinite health/armor or propagate NaN.
  const hpLimit = Number.isFinite(target.maxHp) ? Math.max(0, target.maxHp) : Infinity;
  const armorLimit = Number.isFinite(target.maxArmor) ? Math.max(0, target.maxArmor) : Infinity;
  target.hp = Math.min(hpLimit, positiveFinite(target.hp));
  target.armor = Math.min(armorLimit, positiveFinite(target.armor));
  if (!Number.isFinite(damage) || damage <= 0 || target.hp <= 0) return result;

  const hpBefore = target.hp, armorBefore = target.armor;
  const threshold = positiveFinite(target.armorClass) * COMBAT_RULES.penetrationPerArmorClass;
  result.penetrated = armorBefore <= 0 || positiveFinite(penetration) >= threshold;
  const absorbed = result.penetrated ? 0 : Math.min(armorBefore, damage * COMBAT_RULES.blockedAbsorptionFraction);
  const armorWear = result.penetrated ? Math.min(armorBefore, damage * COMBAT_RULES.penetratingArmorWearFraction) : absorbed;
  target.hp = Math.max(0, hpBefore - (damage - absorbed));
  target.armor = Math.max(0, armorBefore - armorWear);
  result.hpDamage = hpBefore - target.hp;
  result.armorDamage = armorBefore - target.armor;
  result.killed = hpBefore > 0 && target.hp === 0;
  return result;
}

export function resolveThrow(origin, target, walls, maxDistance = 500, radius = 6) {
  const start = {
    x: Number.isFinite(origin?.x) ? origin.x : 0,
    y: Number.isFinite(origin?.y) ? origin.y : 0
  };
  const stopped = { ...start, distance: 0, blocked: false, wall: null };
  if (!Number.isFinite(origin?.x) || !Number.isFinite(origin?.y) ||
      !Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return stopped;
  const dx = target.x - start.x, dy = target.y - start.y;
  const aimedDistance = Math.hypot(dx, dy);
  const limit = positiveFinite(maxDistance), padding = positiveFinite(radius);
  if (!Number.isFinite(aimedDistance) || aimedDistance === 0 || limit === 0) return stopped;
  const dir = { x: dx / aimedDistance, y: dy / aimedDistance };
  let distance = Math.min(aimedDistance, limit), hitWall = null;
  // Sweep the grenade center through expanded physical walls. Unlike bullets,
  // both trees and masonry block this simple low throw; LoS flags do not matter.
  for (const wall of walls || []) {
    if (!wall || ![wall.x, wall.y, wall.w, wall.h].every(Number.isFinite) || wall.w < 0 || wall.h < 0) continue;
    const box = { x: wall.x - padding, y: wall.y - padding, w: wall.w + padding * 2, h: wall.h + padding * 2 };
    const t = rayBoxIntersect(start, dir, box);
    if (t === null || t > distance) continue;
    if (t === 0 && !(start.x > box.x && start.x < box.x + box.w && start.y > box.y && start.y < box.y + box.h)) {
      // A grenade exactly touching a wall can still be thrown away from it.
      const sample = { x: start.x + dir.x * 1e-5, y: start.y + dir.y * 1e-5 };
      if (sample.x <= box.x || sample.x >= box.x + box.w || sample.y <= box.y || sample.y >= box.y + box.h) continue;
    }
    distance = t;
    hitWall = wall;
  }
  if (hitWall) distance = Math.max(0, distance - COMBAT_RULES.throwSurfacePadding);
  return { x: start.x + dir.x * distance, y: start.y + dir.y * distance, distance, blocked: hitWall !== null, wall: hitWall };
}
