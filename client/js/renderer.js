// Generated world and inventory sprites share the lobby atlas mapping.
import { TILE_SIZE, BG_COLOR_DARK, BG_COLOR_LIGHT } from './constants.js';
import { drawAsset, getAsset } from './assets.js';

const rarityColors = ['#97a38f', '#dce3d4', '#85ad79', '#73a2cc', '#af83d1', '#dfbd68', '#d47a70'];
const visible = (x, y, w, h, camera, canvas) =>
  x + w >= camera.x - 100 && y + h >= camera.y - 100 &&
  x <= camera.x + canvas.width + 100 && y <= camera.y + canvas.height + 100;

export function render(ctx, canvas, camera, state) {
  const { player, walls, bots, loots, containers, particles, soundBlips, mouse, shakeAmount } = state;
  const tileSize = state.tileSize || TILE_SIZE;
  ctx.save();
  if (shakeAmount > 0) ctx.translate((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount);
  drawGround(ctx, canvas, camera, tileSize);
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  for (const ext of (state.extractions || (state.helipad ? [state.helipad] : []))) {
    if (visible(ext.x, ext.y, ext.w, ext.h, camera, canvas)) drawExtraction(ctx, ext);
  }
  for (const wall of walls) {
    if (!visible(wall.x, wall.y, wall.w, wall.h, camera, canvas)) continue;
    // Old maps encode terrain using a legacy symbol; it only selects a bitmap.
    const isTree = wall.kind === 'tree' || wall.tileType === 2 || wall.emoji?.codePointAt(0) === 0x1f332;
    ctx.fillStyle = isTree ? '#263523' : '#333b32';
    ctx.fillRect(wall.x + 1, wall.y + 1, wall.w - 2, wall.h - 2);
    const scale = isTree ? 1.28 : 1.13;
    const w = wall.w * scale, h = wall.h * scale;
    const x = wall.x + (wall.w - w) / 2, y = wall.y + (wall.h - h) / 2;
    if (!drawAsset(ctx, isTree ? 'world/tree' : 'world/wall', x, y, w, h)) drawTerrainFallback(ctx, wall, isTree);
  }

  for (const loot of loots) {
    if (!visible(loot.x - 45, loot.y - 45, 90, 90, camera, canvas)) continue;
    const color = rarityColors[Math.max(1, Math.min(6, loot.rarity || 1))];
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.65; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(loot.x, loot.y + 15, 23, 9, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.16; ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    const weapon = getAsset(loot)?.sheet === 'weapons';
    const width = loot.size * (weapon ? 1.9 : 1.5);
    const height = weapon ? width / 2 : width;
    if (!drawAsset(ctx, loot, loot.x - width / 2, loot.y - height / 2, width, height)) {
      drawItemFallback(ctx, loot.x - 13, loot.y - 13, 26, color);
    }
    if (loot.isSearching && loot.type === 'backpack') drawSearchBar(ctx, loot, loot.size * 0.8, 5);
  }

  for (const grenade of state.grenades || []) {
    const t = Math.min(1, grenade.age / grenade.flightTime), lift = Math.sin(t * Math.PI) * 40;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(grenade.x, grenade.y + 3, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
    if (!drawAsset(ctx, 'grenade', grenade.x - 14, grenade.y - lift - 14, 28, 28)) {
      ctx.fillStyle = '#737c46'; ctx.beginPath(); ctx.arc(grenade.x, grenade.y - lift, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(grenade.x, grenade.y, 12, 0, Math.PI * 2 * grenade.age / grenade.fuse);
    ctx.strokeStyle = '#d87558'; ctx.lineWidth = 2; ctx.stroke();
  }

  for (const container of containers) {
    if (!visible(container.x - 60, container.y - 60, 120, 120, camera, canvas)) continue;
    const size = container.size;
    ctx.fillStyle = container.isOpen ? 'rgba(113,149,104,.08)' : 'rgba(184,158,98,.1)';
    ctx.strokeStyle = container.isOpen ? '#53644b' : '#aa9467'; ctx.lineWidth = 1;
    ctx.fillRect(container.x - size / 2, container.y - size / 2, size, size);
    ctx.strokeRect(container.x - size / 2, container.y - size / 2, size, size);
    ctx.save();
    if (container.isOpen) ctx.globalAlpha = 0.45;
    if (!drawAsset(ctx, container, container.x - size * 0.7, container.y - size * 0.7, size * 1.4, size * 1.4)) {
      drawItemFallback(ctx, container.x - size * 0.35, container.y - size * 0.35, size * 0.7, '#b4bca7');
    }
    ctx.restore();
    if (container.isOpen) {
      ctx.font = '9px monospace'; ctx.fillStyle = '#a5b894'; ctx.fillText('OPEN', container.x - 12, container.y + size * 0.65);
    }
    if (container.isSearching) drawSearchBar(ctx, container, size * 0.8, 6);
  }

  for (const bot of bots) {
    if (!visible(bot.x - bot.size, bot.y - bot.size, bot.size * 2, bot.size * 2, camera, canvas)) continue;
    ctx.beginPath(); ctx.arc(bot.x, bot.y, bot.size * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(170,63,54,.12)'; ctx.fill();
    drawActor(ctx, bot, 'bot', Math.cos(bot.facingAngle) < 0);
    const barW = bot.size * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(bot.x - barW / 2, bot.y - bot.size / 2 - 12, barW, 4);
    ctx.fillStyle = '#bc6a5b'; ctx.fillRect(bot.x - barW / 2, bot.y - bot.size / 2 - 12, barW * Math.max(0, bot.hp / bot.maxHp), 4);
  }

  const targetAngle = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);
  drawActor(ctx, player, 'operator', Math.cos(targetAngle) < 0);
  if (getAsset(player.gun)) {
    ctx.save(); ctx.translate(player.x, player.y + player.size * 0.08); ctx.rotate(targetAngle);
    if (Math.cos(targetAngle) < 0) ctx.scale(1, -1);
    const gunWidth = player.size * 1.05;
    drawAsset(ctx, player.gun, -player.size * 0.12, -gunWidth / 4, gunWidth, gunWidth / 2); ctx.restore();
  }
  const searchTarget = [...containers, ...loots.filter(item => item.type === 'backpack')].find(item =>
    item.isSearching && Math.hypot(player.x - item.x, player.y - item.y) < 70);
  if (searchTarget) {
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#d9be79';
    ctx.fillText('搜索 ' + Math.round((1 - searchTarget.searchTimer / searchTarget.searchDuration) * 100) + '%', player.x - 25, player.y - player.size / 2 - 8);
  }

  ctx.strokeStyle = 'rgba(196,227,141,.17)'; ctx.lineWidth = 1; ctx.setLineDash([5, 7]);
  ctx.beginPath(); ctx.moveTo(player.x, player.y);
  ctx.lineTo(player.x + Math.cos(targetAngle) * 400, player.y + Math.sin(targetAngle) * 400);
  ctx.stroke(); ctx.setLineDash([]);
  for (const p of particles) {
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.size * (p.life / p.maxLife)), 0, Math.PI * 2); ctx.fill();
  }
  for (const blip of soundBlips) {
    ctx.strokeStyle = `rgba(202,138,100,${blip.life / blip.maxLife * 0.5})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(blip.x, blip.y, blip.radius * (1 - blip.life / blip.maxLife), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  drawCrosshair(ctx, mouse, player);
  drawMinimap(ctx, canvas, state);
  ctx.restore();
}

function drawItemFallback(ctx, x, y, size, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y + size * 0.15, size, size * 0.7);
  ctx.beginPath(); ctx.moveTo(x, y + size * 0.35); ctx.lineTo(x + size, y + size * 0.35);
  ctx.moveTo(x + size * 0.5, y + size * 0.15); ctx.lineTo(x + size * 0.5, y + size * 0.85); ctx.stroke(); ctx.restore();
}

function drawTerrainFallback(ctx, wall, isTree) {
  ctx.save();
  if (isTree) {
    ctx.fillStyle = '#45603c'; ctx.beginPath(); ctx.moveTo(wall.x + wall.w / 2, wall.y + 3);
    ctx.lineTo(wall.x + wall.w - 3, wall.y + wall.h - 8); ctx.lineTo(wall.x + 3, wall.y + wall.h - 8); ctx.closePath(); ctx.fill();
  } else {
    ctx.strokeStyle = '#5f6859'; ctx.lineWidth = 2;
    ctx.strokeRect(wall.x + 3, wall.y + 3, wall.w - 6, wall.h - 6);
    ctx.beginPath(); ctx.moveTo(wall.x + 3, wall.y + wall.h / 2); ctx.lineTo(wall.x + wall.w - 3, wall.y + wall.h / 2); ctx.stroke();
  }
  ctx.restore();
}

function drawSearchBar(ctx, target, width, height) {
  const progress = Math.max(0, Math.min(1, 1 - target.searchTimer / target.searchDuration));
  ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillRect(target.x - width / 2, target.y - target.size / 2 - 14, width, height);
  ctx.fillStyle = '#d9be79'; ctx.fillRect(target.x - width / 2, target.y - target.size / 2 - 14, width * progress, height);
}

function drawActor(ctx, actor, kind, flip) {
  ctx.save(); ctx.translate(actor.x, actor.y); ctx.fillStyle = 'rgba(0,0,0,.32)';
  ctx.beginPath(); ctx.ellipse(0, actor.size * 0.43, actor.size * 0.36, actor.size * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  if (flip) ctx.scale(-1, 1);
  const size = actor.size * 1.5;
  if (!drawAsset(ctx, actor, -size / 2, -size / 2, size, size, kind)) {
    ctx.fillStyle = kind === 'operator' ? '#879b69' : '#96715c';
    ctx.fillRect(-actor.size * 0.28, -actor.size * 0.12, actor.size * 0.56, actor.size * 0.65);
    ctx.beginPath(); ctx.arc(0, -actor.size * 0.23, actor.size * 0.23, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d7dbbc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-actor.size * 0.14, -actor.size * 0.24); ctx.lineTo(actor.size * 0.14, -actor.size * 0.24); ctx.stroke();
  }
  ctx.restore();
}

function drawGround(ctx, canvas, camera, ts) {
  const startCol = Math.floor(camera.x / ts), startRow = Math.floor(camera.y / ts);
  const endCol = startCol + Math.ceil(canvas.width / ts) + 1, endRow = startRow + Math.ceil(canvas.height / ts) + 1;
  for (let r = startRow; r < endRow; r++) for (let c = startCol; c < endCol; c++) {
    const x = c * ts - camera.x, y = r * ts - camera.y;
    ctx.fillStyle = (c + r) % 2 === 0 ? BG_COLOR_DARK : BG_COLOR_LIGHT; ctx.fillRect(x, y, ts, ts);
    ctx.fillStyle = 'rgba(150,167,133,.045)';
    if ((c * 13 + r * 7) % 9 === 0) ctx.fillRect(x + ts * 0.21, y + ts * 0.62, ts * 0.22, 1);
  }
}

function drawExtraction(ctx, ext) {
  const paid = ext.condition === 'paid';
  ctx.fillStyle = paid ? 'rgba(217,182,110,.09)' : 'rgba(193,233,129,.08)';
  ctx.strokeStyle = paid ? '#d9b66e' : '#c1e981'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
  ctx.fillRect(ext.x, ext.y, ext.w, ext.h); ctx.strokeRect(ext.x, ext.y, ext.w, ext.h); ctx.setLineDash([]);
  const size = Math.min(ext.w, ext.h) * 0.82, x = ext.x + (ext.w - size) / 2, y = ext.y + (ext.h - size) / 2;
  if (!drawAsset(ctx, paid ? 'world/beacon' : 'world/helipad', x, y, size, size)) {
    ctx.save(); ctx.font = `bold ${Math.round(size * 0.42)}px sans-serif`; ctx.fillStyle = '#b7c99e'; ctx.textAlign = 'center';
    ctx.fillText(paid ? 'R' : 'H', ext.x + ext.w / 2, ext.y + ext.h * 0.65); ctx.restore();
  }
  ctx.fillStyle = '#d7e0ca'; ctx.font = '12px sans-serif';
  ctx.fillText(`${ext.name || '撤离点'} · ${paid ? '₡' + ext.cost.toLocaleString() : '免费'} · ${ext.duration || 10}s`, ext.x, ext.y - 10);
}

function drawCrosshair(ctx, mouse, player) {
  ctx.strokeStyle = 'rgba(201,245,104,.8)'; ctx.lineWidth = 1;
  const dist = Math.hypot(mouse.worldX - player.x, mouse.worldY - player.y), radius = Math.max(12, dist * Math.tan(player.spread));
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#c9f568'; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 2, 0, Math.PI * 2); ctx.fill();
}

function drawMinimap(ctx, canvas, state) {
  const { player, walls, extractions = [], worldWidth = 3200, worldHeight = 2400 } = state;
  const w = Math.min(190, canvas.width * 0.18), h = Math.min(180, w * worldHeight / worldWidth);
  const x = canvas.width - w - 24, y = 110;
  ctx.save(); ctx.fillStyle = 'rgba(16,22,18,.93)'; ctx.fillRect(x - 8, y - 24, w + 16, h + 48);
  ctx.strokeStyle = '#48513e'; ctx.strokeRect(x - 8, y - 24, w + 16, h + 48);
  ctx.fillStyle = '#b4bcab'; ctx.font = '10px sans-serif'; ctx.fillText('区域导览  /  N', x, y - 9);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.translate(x, y); ctx.scale(w / worldWidth, h / worldHeight);
  ctx.fillStyle = '#444d40'; for (const wall of walls) ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
  for (const exit of extractions) { ctx.fillStyle = exit.condition === 'paid' ? '#d9b66e' : '#c1e981'; ctx.fillRect(exit.x, exit.y, exit.w, exit.h); }
  ctx.fillStyle = '#f4f5ec'; ctx.beginPath(); ctx.arc(player.x, player.y, worldWidth / w * 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#bbc7a5'; ctx.fillText('自身白点   绿色免费   金色付费', x, y + h + 16); ctx.restore();
}
