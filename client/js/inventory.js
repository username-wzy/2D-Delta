// Deterministic rectangular inventory layout. Coordinates are measured in cells.
import { getLootDef } from './lootdata.js';

const MAX_GRID_SIDE = 64;
const MAX_GRID_CELLS = 4096;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const coordinate = value => Number.isSafeInteger(value) && value >= 0;

/** Explicit instance dimensions override definitions; rotated instances swap axes. */
export function itemDimensions(item) {
  const value = item && typeof item === 'object' ? item : {};
  const definition = getLootDef(value.type || value.id) || {};
  const w = positiveInteger(value.gridW) ? value.gridW : positiveInteger(definition.gridW) ? definition.gridW : 1;
  const h = positiveInteger(value.gridH) ? value.gridH : positiveInteger(definition.gridH) ? definition.gridH : 1;
  return value.rotated === true ? { w: h, h: w } : { w, h };
}

/** Actual occupied area, including overflowing objects; never reports NaN/Infinity. */
export function inventoryUsage(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((total, item) => {
    const { w, h } = itemDimensions(item);
    const area = w * h;
    return Math.min(Number.MAX_SAFE_INTEGER, total + area);
  }, 0);
}

/**
 * Keep non-overlapping saved positions, then fill remaining items in row order.
 * This is deterministic first-fit, not an exhaustive bin-packing optimizer.
 * No source object or array is changed. Each occurrence is identified by index.
 */
export function packItems(items, cols, rows, options = {}) {
  const source = Array.isArray(items) ? items : [];
  const validGrid = positiveInteger(cols) && positiveInteger(rows)
    && cols <= MAX_GRID_SIDE && rows <= MAX_GRID_SIDE && cols * rows <= MAX_GRID_CELLS;
  if (!Array.isArray(items) || !validGrid) {
    return { ok: false, placements: [], overflow: source.map((item, index) => ({ item, index })) };
  }
  const occupied = new Uint8Array(cols * rows);
  const placements = [];
  const pending = [];
  const fits = (x, y, w, h) => {
    if (!coordinate(x) || !coordinate(y) || w > cols || h > rows || x > cols - w || y > rows - h) return false;
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) if (occupied[row * cols + col]) return false;
    }
    return true;
  };
  const place = (item, index, x, y, w, h, rotated) => {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) occupied[row * cols + col] = 1;
    }
    placements.push({ item, index, x, y, w, h, rotated });
  };
  for (let index = 0; index < source.length; index++) {
    const item = source[index];
    const { w, h } = itemDimensions(item);
    const rotated = item?.rotated === true;
    if (fits(item?.gridX, item?.gridY, w, h)) place(item, index, item.gridX, item.gridY, w, h, rotated);
    else pending.push({ item, index, w, h, rotated });
  }
  const overflow = [];
  for (const entry of pending) {
    const orientations = [{ w: entry.w, h: entry.h, rotated: entry.rotated }];
    if (options?.allowRotation === true && entry.w !== entry.h) {
      orientations.push({ w: entry.h, h: entry.w, rotated: !entry.rotated });
    }
    let found = false;
    for (const { w, h, rotated } of orientations) {
      if (w > cols || h > rows) continue;
      for (let y = 0; y <= rows - h && !found; y++) {
        for (let x = 0; x <= cols - w; x++) {
          if (!fits(x, y, w, h)) continue;
          place(entry.item, entry.index, x, y, w, h, rotated);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) overflow.push({ item: entry.item, index: entry.index });
  }
  placements.sort((a, b) => a.index - b.index);
  return { ok: overflow.length === 0, placements, overflow };
}

/** Placement of an additional item when the entire resulting bag remains valid. */
export function findPlacement(items, item, cols, rows, options = {}) {
  if (!Array.isArray(items)) return null;
  const result = packItems([...items, item], cols, rows, options);
  return result.ok ? result.placements.find(placement => placement.index === items.length) || null : null;
}

export function canFitItem(items, item, cols, rows, options = {}) {
  return findPlacement(items, item, cols, rows, options) !== null;
}
