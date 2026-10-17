// Map dimensions and collision data belong to the current map, not global constants.
import { TILE_SIZE } from './constants.js';
import { Wall, Bot, LootContainer } from './entities.js';
import { randomBotType, randomBossType, getBotDef } from './botdata.js';

export async function loadMap(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`地图加载失败 (HTTP ${response.status})`);
  return response.json();
}

export function buildWorldFromMap(data) {
  if (!data || !Array.isArray(data.tiles) || !data.tiles.length) throw new Error('地图缺少图块数据');
  const ts = data.tileSize ?? TILE_SIZE;
  if (!Number.isInteger(ts) || ts < 32 || ts > 128) throw new Error('地图图块大小必须在 32～128 之间');
  const grid = data.tiles.map(row => Array.isArray(row) ? row.slice() : String(row).split(',').map(x => Number(x.trim())));
  const rows = grid.length, cols = grid[0].length;
  if (rows < 2 || cols < 2 || rows > 256 || cols > 256 || grid.some(row => row.length !== cols || row.some(x => ![0, 1, 2].includes(x)))) throw new Error('地图图块尺寸或内容无效');
  if ((data.width != null && data.width !== cols) || (data.height != null && data.height !== rows)) throw new Error('地图声明尺寸与图块数量不一致');
  const worldWidth = cols * ts, worldHeight = rows * ts;
  const validTile = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < cols && y >= 0 && y < rows;
  const openTile = (x, y) => validTile(x, y) && grid[y][x] === 0;
  const spawn = (data.spawns || []).find(s => s.team === 'pmc' && openTile(s.x, s.y));
  if (!spawn) throw new Error('地图需要一个位于空地的特工出生点');
  const spawnX = (spawn.x + 0.5) * ts, spawnY = (spawn.y + 0.5) * ts;
  const walls = [], bots = [], loots = [], containers = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (grid[r][c]) walls.push(new Wall(c * ts, r * ts, ts, ts, grid[r][c] === 1 ? '🧱' : '🌲', true));
  }
  for (const sp of data.spawns || []) {
    if (sp.team !== 'scav' || !openTile(sp.x, sp.y)) continue;
    const def = getBotDef(Math.random() < 0.15 ? randomBossType() : randomBotType());
    const bot = new Bot((sp.x + 0.5) * ts, (sp.y + 0.5) * ts, def);
    bot.patrolOrigin = { x: bot.x, y: bot.y }; bot.patrolRadius = 200;
    bots.push(bot);
  }
  for (let i = bots.length; i < 10; i++) for (let attempt = 0; attempt < 50; attempt++) {
    const c = Math.floor(Math.random() * cols), r = Math.floor(Math.random() * rows);
    if (!openTile(c, r) || Math.hypot(c - spawn.x, r - spawn.y) < 4) continue;
    bots.push(new Bot((c + 0.5) * ts, (r + 0.5) * ts, getBotDef(randomBotType()))); break;
  }
  const nodes = data.patrolNodes || [];
  bots.forEach((bot, i) => {
    if (!bot.patrolOrigin && nodes[i] && validTile(nodes[i].x, nodes[i].y)) {
      bot.patrolOrigin = { x: nodes[i].x * ts, y: nodes[i].y * ts }; bot.patrolRadius = nodes[i].radius || 200;
    }
  });
  for (const cp of data.containers || []) {
    if (!openTile(cp.x, cp.y)) throw new Error('容器需要放置在地图内的空地上');
    if (cp.requiredKey != null && !['keycard_red', 'keycard_blue', 'keycard_green'].includes(cp.requiredKey)) throw new Error('容器钥匙类型无效');
    if (cp.searchDuration != null && (!Number.isFinite(cp.searchDuration) || cp.searchDuration <= 0 || cp.searchDuration > 60)) throw new Error('容器搜索时间无效');
    containers.push(new LootContainer((cp.x + 0.5) * ts, (cp.y + 0.5) * ts, cp.type, cp));
  }
  const extList = data.extractions || (data.extraction ? [data.extraction] : []);
  if (!extList.length) throw new Error('地图至少需要一个撤离点');
  const extractions = extList.map(ext => {
    const w = ext.w ?? 3, h = ext.h ?? 3;
    if (!validTile(ext.x, ext.y) || !Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || ext.x + w > cols || ext.y + h > rows) throw new Error('撤离点范围超出地图');
    return { x: ext.x * ts, y: ext.y * ts, w: w * ts, h: h * ts, emoji: ext.emoji || '🚁', name: ext.name || '撤离点' };
  });
  return { walls, bots, loots, containers, extractions, helipad: extractions[0], spawnX, spawnY, worldWidth, worldHeight, tileSize: ts, mapName: data.name || '自制地图' };
}
