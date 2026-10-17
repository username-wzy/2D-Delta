// Map geometry and metadata are validated before any gear is reserved.
import { TILE_SIZE } from './constants.js';
import { Wall, Bot, LootContainer, Loot, applyLootData } from './entities.js';
import { randomBotType, randomBossType, getBotDef } from './botdata.js';
import { allOperators } from './operatordata.js';
import { randomLootType, getLootDef } from './lootdata.js';

export async function loadMap(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`地图加载失败 (HTTP ${response.status})`);
  return response.json();
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function optionalText(value, label, limit) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > limit)) throw new Error(`${label}无效`);
}
function list(data, name) {
  if (data[name] === undefined) return [];
  if (!Array.isArray(data[name]) || data[name].some(value => !isRecord(value))) throw new Error(`地图 ${name} 必须为对象数组`);
  return data[name];
}

// An optional selected size permits validating narrower routes for that operator.
// Import preview uses the largest configured operator, so every lobby choice works.
export function buildWorldFromMap(data, selectedSize = Math.max(48, ...allOperators().map(op => op.size || 48))) {
  if (!isRecord(data) || !Array.isArray(data.tiles) || !data.tiles.length) throw new Error('地图缺少图块数据');
  optionalText(data.name, '地图名称', 120);
  if (!Number.isFinite(selectedSize) || selectedSize <= 0 || selectedSize > 128) throw new Error('角色尺寸无效');
  const ts = data.tileSize ?? TILE_SIZE;
  if ((data.tileSize !== undefined && !Number.isInteger(data.tileSize)) || !Number.isInteger(ts) || ts < 32 || ts > 128) throw new Error('地图图块大小必须在 32～128 之间');
  const grid = data.tiles.map(row => {
    if (Array.isArray(row)) return row.slice();
    if (typeof row !== 'string' || row.split(',').some(cell => !/^[012]$/.test(cell.trim()))) throw new Error('地图图块内容无效');
    return row.split(',').map(cell => Number(cell.trim()));
  });
  const rows = grid.length, cols = grid[0].length;
  if (rows < 2 || cols < 2 || rows > 256 || cols > 256 || grid.some(row => row.length !== cols || row.some(tile => ![0, 1, 2].includes(tile)))) throw new Error('地图图块尺寸或内容无效');
  if ((data.width !== undefined && data.width !== cols) || (data.height !== undefined && data.height !== rows)) throw new Error('地图声明尺寸与图块数量不一致');
  const worldWidth = cols * ts, worldHeight = rows * ts;
  if ((data.worldWidth !== undefined && data.worldWidth !== worldWidth) || (data.worldHeight !== undefined && data.worldHeight !== worldHeight)) throw new Error('地图世界尺寸与图块数量不一致');
  const validTile = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < cols && y >= 0 && y < rows;
  const openTile = (x, y) => validTile(x, y) && grid[y][x] === 0;
  const center = value => (value + 0.5) * ts;
  const canFit = (x, y, size = selectedSize) => {
    // The sprite stays in bounds; the collision box matches physics.getPlayerBox.
    if (x < size / 2 || y < size / 2 || x > worldWidth - size / 2 || y > worldHeight - size / 2) return false;
    const radius = size * 0.4;
    for (let r = Math.floor((y - radius + 1e-7) / ts); r <= Math.floor((y + radius - 1e-7) / ts); r++) {
      for (let c = Math.floor((x - radius + 1e-7) / ts); c <= Math.floor((x + radius - 1e-7) / ts); c++) {
        if (!openTile(c, r)) return false;
      }
    }
    return true;
  };
  const spawns = list(data, 'spawns');
  for (const spawn of spawns) {
    if (!['pmc', 'scav'].includes(spawn.team) || !openTile(spawn.x, spawn.y)) throw new Error('出生点类型或位置无效，出生点需要位于空地');
  }
  const playerSpawns = spawns.filter(spawn => spawn.team === 'pmc');
  if (!playerSpawns.length) throw new Error('地图需要一个位于空地的特工出生点');
  if (playerSpawns.some(spawn => !canFit(center(spawn.x), center(spawn.y)))) throw new Error('特工出生点空间不足，角色会与障碍或边界重叠');
  const spawn = playerSpawns[0], spawnX = center(spawn.x), spawnY = center(spawn.y);
  const nodes = list(data, 'patrolNodes');
  for (const node of nodes) {
    if (!openTile(node.x, node.y) || (node.radius !== undefined && (!Number.isFinite(node.radius) || node.radius <= 0 || node.radius > 32768))) throw new Error('巡逻节点位置或半径无效');
  }
  const lootPoints = list(data, 'lootPoints');
  for (const point of lootPoints) {
    if (!openTile(point.x, point.y)) throw new Error('物资点需要位于地图空地');
    if (point.type !== undefined && (typeof point.type !== 'string' || !getLootDef(point.type).id)) throw new Error('物资点类型无效');
  }
  const botCount = data.botCount ?? 10;
  if (!Number.isInteger(botCount) || botCount < 0 || botCount > 64) throw new Error('敌人数量必须为 0～64 的整数');
  const containerPoints = list(data, 'containers');
  for (const point of containerPoints) {
    if (!openTile(point.x, point.y)) throw new Error('容器需要放置在地图内的空地上');
    if (!['safe', 'filing_cabinet', 'wardrobe'].includes(point.type)) throw new Error('容器类型无效');
    if (point.requiredKey != null && !['keycard_red', 'keycard_blue', 'keycard_green'].includes(point.requiredKey)) throw new Error('容器钥匙类型无效');
    if (point.searchDuration !== undefined && (!Number.isFinite(point.searchDuration) || point.searchDuration <= 0 || point.searchDuration > 60)) throw new Error('容器搜索时间无效');
  }
  if (data.extraction !== undefined && !isRecord(data.extraction)) throw new Error('撤离点元数据无效');
  const extList = data.extractions === undefined ? (data.extraction ? [data.extraction] : []) : list(data, 'extractions');
  if (!extList.length) throw new Error('地图至少需要一个撤离点');
  const extractions = extList.map(ext => {
    const w = ext.w ?? 3, h = ext.h ?? 3;
    if (!validTile(ext.x, ext.y) || !Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || ext.x + w > cols || ext.y + h > rows) throw new Error('撤离点范围超出地图');
    optionalText(ext.name, '撤离点名称', 120); optionalText(ext.emoji, '撤离点标记', 32);
    if (ext.condition !== undefined && typeof ext.condition !== 'string') throw new Error('撤离点条件无效');
    if (ext.cost !== undefined && !Number.isInteger(ext.cost)) throw new Error('撤离点费用无效');
    if (ext.duration !== undefined && !Number.isFinite(ext.duration)) throw new Error('撤离点倒计时无效');
    const condition = ext.condition ?? 'standard', cost = ext.cost ?? 0, duration = ext.duration ?? 10;
    if (!['standard', 'paid'].includes(condition)) throw new Error('撤离点条件无效');
    if (!Number.isInteger(cost) || (condition === 'paid' ? cost < 1 || cost > 100000 : cost !== 0)) throw new Error('撤离点费用无效');
    if (!Number.isFinite(duration) || duration < 1 || duration > 60) throw new Error('撤离点倒计时无效');
    return { x: ext.x * ts, y: ext.y * ts, w: w * ts, h: h * ts, emoji: ext.emoji || '🚁', name: ext.name || '撤离点', condition, cost, duration };
  });

  // Flood from all usable extraction tiles once, then check every player spawn.
  // Clearance prevents a 32px one-cell corridor passing validation for 52px actors.
  const traversable = new Uint8Array(rows * cols), reachable = new Uint8Array(rows * cols);
  const queue = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const index = r * cols + c;
    if (openTile(c, r) && canFit(center(c), center(r))) traversable[index] = 1;
  }
  for (let i = 0; i < extList.length; i++) {
    const ext = extList[i];
    for (let r = ext.y; r < ext.y + (ext.h ?? 3); r++) for (let c = ext.x; c < ext.x + (ext.w ?? 3); c++) {
      const index = r * cols + c;
      if (traversable[index] && !reachable[index]) { reachable[index] = 1; queue.push(index); }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], c = index % cols, r = Math.floor(index / cols);
    for (const [nc, nr] of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
      if (!validTile(nc, nr)) continue;
      const next = nr * cols + nc;
      if (!traversable[next] || reachable[next]) continue;
      // Check the swept path as well as the cell endpoints.
      if (!canFit((center(c) + center(nc)) / 2, (center(r) + center(nr)) / 2)) continue;
      reachable[next] = 1; queue.push(next);
    }
  }
  if (playerSpawns.some(point => !reachable[point.y * cols + point.x])) throw new Error('出生点无法到达任何撤离点，或通道宽度不足');

  const walls = [], bots = [], loots = [], containers = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (grid[r][c]) walls.push(new Wall(c * ts, r * ts, ts, ts, grid[r][c] === 1 ? '🧱' : '🌲', true));
  }
  for (const point of spawns.filter(point => point.team === 'scav')) {
    const def = getBotDef(Math.random() < 0.15 ? randomBossType() : randomBotType());
    const bot = new Bot(center(point.x), center(point.y), def);
    if (!canFit(bot.x, bot.y, bot.size)) continue;
    bot.patrolOrigin = { x: bot.x, y: bot.y }; bot.patrolRadius = 200;
    bots.push(bot);
  }
  for (let i = bots.length; i < botCount; i++) for (let attempt = 0; attempt < 50; attempt++) {
    const c = Math.floor(Math.random() * cols), r = Math.floor(Math.random() * rows);
    if (!openTile(c, r) || Math.hypot(c - spawn.x, r - spawn.y) < 4) continue;
    const bot = new Bot(center(c), center(r), getBotDef(randomBotType()));
    if (!canFit(bot.x, bot.y, bot.size)) continue;
    bots.push(bot); break;
  }
  bots.forEach((bot, i) => {
    if (!bot.patrolOrigin && nodes[i]) {
      bot.patrolOrigin = { x: center(nodes[i].x), y: center(nodes[i].y) }; bot.patrolRadius = nodes[i].radius || 200;
    }
  });
  for (const point of lootPoints) {
    const type = point.type || randomLootType();
    const loot = new Loot(center(point.x), center(point.y), type); applyLootData(loot, getLootDef(type)); loots.push(loot);
  }
  for (const point of containerPoints) containers.push(new LootContainer(center(point.x), center(point.y), point.type, point));
  return { walls, bots, loots, containers, extractions, helipad: extractions[0], spawnX, spawnY, worldWidth, worldHeight, tileSize: ts, mapName: data.name || '自制地图' };
}
