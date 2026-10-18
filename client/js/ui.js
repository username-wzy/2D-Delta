// Lobby transactions and raid results. Authentication is deliberately absent.
import { getCoins, getStash, unequipItem, getEquipped, getMaxEquipSlots, getLoadoutError, getEquipError, equipItems, sellStashItems, sellAllStash, salePrice } from './economy.js';
import { assetMarkup, setAssetIcon } from './assets.js';
import { itemCategory, itemRarity, RARITY_NAMES, isGear } from './itemrules.js';
import { itemDimensions, packItems, inventoryUsage } from './inventory.js';
import { iconMarkup } from './icons.js';
import { getLootDef } from './lootdata.js';
import { initShell, showLobbyShell, closeShellDialogs, confirmAction, refreshShell, getShopFilter, setLobbyView, beginDeployment, endDeployment, hideShellScreens } from './ui-shell.js';
export { beginDeployment, endDeployment } from './ui-shell.js';
export { showHomeScreen } from './ui-shell.js';

const byId = id => document.getElementById(id);
const resultModal = byId('result-modal');
const resultTitle = byId('result-title');
const resultDesc = byId('result-desc');
const summaryLootContainer = byId('summary-loot-container');
const restartBtn = byId('restart-btn');
const startScreen = byId('start-screen');
const deployBtn = byId('deploy-btn');
const hudOverlay = byId('hud');
let selectedStashIndices = new Set();
let shopItems = [];
let stashPage = 0;
const STASH_PAGE_SIZE = 16;

export function initLobbyUI() {
  initShell({ onEnter: showStartScreen, refresh: refreshLobbyUI, refreshShop: refreshShopUI });
}
export function showStartScreen() {
  closeShellDialogs();
  showLobbyShell();
  refreshLobbyUI();
}
function pushBatchNotify(text, isError = false) {
  const feedback = byId('lobby-feedback');
  if (feedback && !startScreen.classList.contains('hidden')) {
    feedback.textContent = text;
    feedback.classList.toggle('error', isError);
    return;
  }
  const feed = byId('notification-feed');
  if (!feed) return;
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.textContent = text;
  feed.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}
function reportError(error) { pushBatchNotify(`操作未完成：${error.message || '请检查浏览器存储后重试'}`, true); }
function getSelectedStash() { return [...selectedStashIndices].sort((a, b) => a - b); }
function createItemButton(item, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'stash-item';
  button.dataset.rarity = itemRarity(item);
  const footprint = itemDimensions(item);
  title += ` · ${footprint.w} × ${footprint.h} 格 · ${RARITY_NAMES[itemRarity(item)-1]}${item.durability !== undefined ? ' · 耐久 ' + item.durability + '/' + item.maxDurability : ''}`;
  const art = document.createElement('span'); art.className = 'loot-item-art';
  setAssetIcon(art, item, { fallback: '' }); button.appendChild(art);
  button.title = title;
  button.setAttribute('aria-label', title);
  const label = document.createElement('span');
  label.className = 'item-label';
  label.textContent = item.name || '物品';
  button.appendChild(label);
  const size = document.createElement('span'); size.className = 'item-footprint'; size.textContent = `${footprint.w}×${footprint.h}`; button.appendChild(size);
  return button;
}
function positionStorageItem(button, placement) {
  button.classList.add('item-tile');
  button.style.gridColumn = `${placement.x + 1} / span ${placement.w}`;
  button.style.gridRow = `${placement.y + 1} / span ${placement.h}`;
  button.dataset.footprint = `${placement.w}x${placement.h}`;
  button.dataset.verticalWeapon = String(itemCategory(placement.item) === 'weapon' && placement.h > placement.w);
}
function prepareStorageGrid(grid, items, cols, fixedRows = null) {
  grid.innerHTML = ''; grid.classList.add('item-grid');
  let rows = fixedRows || Math.max(6, Math.ceil(inventoryUsage(items) / cols));
  let result = packItems(items, cols, rows, {allowRotation:true});
  if (!fixedRows) while (!result.ok && rows < 64) { rows++; result = packItems(items, cols, rows, {allowRotation:true}); }
  grid.style.setProperty('--grid-cols', cols); grid.style.setProperty('--grid-rows', rows);
  grid.setAttribute('aria-label', `${cols} 列 · ${rows} 行物品网格`);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const cell = document.createElement('span'); cell.className = 'inventory-cell';
    cell.style.gridColumn = String(x + 1); cell.style.gridRow = String(y + 1); cell.setAttribute('aria-hidden','true'); grid.appendChild(cell);
  }
  return result;
}
function refreshStashUI({ preserveSelection = false } = {}) {
  const grid = byId('stash-grid');
  if (!grid) return;
  const coinsEl = byId('stash-coins');
  const equipGrid = byId('equipped-grid');
  const equipBtn = byId('stash-equip-selected');
  const sellBtn = byId('stash-sell-selected');
  const sellAllBtn = byId('sell-all-btn');
  const selectAllCB = byId('stash-select-all');
  const capText = byId('equip-capacity-text');
  const stash = getStash();
  const equipped = getEquipped();
  const loadoutError = getLoadoutError();
  if (capText) capText.textContent = `${inventoryUsage(equipped.filter(item => !isGear(item)))} / ${getMaxEquipSlots()} 格`;
  deployBtn.disabled = Boolean(loadoutError);
  deployBtn.title = loadoutError || '部署进入战区';
  const feedback = byId('lobby-feedback');
  if (feedback) {
    if (loadoutError) { feedback.textContent = loadoutError; feedback.dataset.loadoutError = 'true'; feedback.classList.add('error'); }
    else if (feedback.dataset.loadoutError) { feedback.textContent = ''; delete feedback.dataset.loadoutError; feedback.classList.remove('error'); }
  }
  if (coinsEl) coinsEl.textContent = `₡ ${getCoins().toLocaleString()}`;
  if (byId('stash-total')) byId('stash-total').textContent = String(stash.length);
  const pageCount = Math.max(1, Math.ceil(stash.length / STASH_PAGE_SIZE));
  stashPage = Math.min(stashPage, pageCount - 1);
  const pageStart = stashPage * STASH_PAGE_SIZE;
  const pageItems = stash.slice(pageStart, pageStart + STASH_PAGE_SIZE);
  const stashLayout = prepareStorageGrid(grid, pageItems, 8);
  if (!preserveSelection) selectedStashIndices.clear();
  const pager = byId('stash-page-controls');
  if (pager) {
    pager.innerHTML = '';
    const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'text-btn'; previous.textContent = '上一页'; previous.disabled = stashPage === 0;
    const next = document.createElement('button'); next.type = 'button'; next.className = 'text-btn'; next.textContent = '下一页'; next.disabled = stashPage >= pageCount - 1;
    const label = document.createElement('span'); label.textContent = `${stashPage + 1} / ${pageCount} 页 · 每页最多 ${STASH_PAGE_SIZE} 件`;
    previous.addEventListener('click', () => { stashPage--; refreshStashUI({preserveSelection:true}); }); next.addEventListener('click', () => { stashPage++; refreshStashUI({preserveSelection:true}); }); pager.append(previous,label,next);
  }
  if (selectAllCB) { selectAllCB.checked = pageItems.length > 0 && pageItems.every((_, i) => selectedStashIndices.has(pageStart + i)); selectAllCB.disabled = !pageItems.length; selectAllCB.indeterminate = !selectAllCB.checked && pageItems.some((_, i) => selectedStashIndices.has(pageStart + i)); }
  if (sellAllBtn) sellAllBtn.disabled = !stash.length;
  if (!stash.length) {
    const empty = document.createElement('div');
    empty.className = 'stash-empty';
    empty.innerHTML = '<b>仓库等待第一份战利品</b><span>行动撤离后带出的物资会保存在这里。<br>也可以先到军需采购准备装备。</span><br>';
    const go = document.createElement('button'); go.className = 'text-btn'; go.textContent = '前往军需采购 →';
    go.addEventListener('click', () => setLobbyView('supply'));
    empty.appendChild(go); grid.appendChild(empty);
  }
  pageItems.forEach((item, localIndex) => {
    const index = pageStart + localIndex;
    const title = `${item.name || '物品'} · 出售价 ₡${salePrice(item).toLocaleString()} · 点击选择`;
    const button = createItemButton(item, title);
    button.dataset.index = index;
    button.classList.toggle('selected', selectedStashIndices.has(index));
    button.setAttribute('aria-pressed', String(selectedStashIndices.has(index)));
    button.addEventListener('click', () => {
      if (selectedStashIndices.has(index)) selectedStashIndices.delete(index); else selectedStashIndices.add(index);
      const selected = selectedStashIndices.has(index);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (selectAllCB) {
        selectAllCB.checked = pageItems.every((_, i) => selectedStashIndices.has(pageStart + i));
        selectAllCB.indeterminate = !selectAllCB.checked && pageItems.some((_, i) => selectedStashIndices.has(pageStart + i));
      }
      updateActionButtons();
    });
    const placement = stashLayout.placements.find(value => value.index === localIndex);
    if (placement) positionStorageItem(button, placement);
    grid.appendChild(button);
  });
  if (equipGrid) {
    const carried = equipped.filter(item => !isGear(item));
    const rows = Math.max(1, Math.floor(getMaxEquipSlots() / 6));
    const layout = prepareStorageGrid(equipGrid, carried, 6, rows);
    const createCarried = (item, index) => {
      const button = createItemButton(item, `${item.name || '物品'} · 点击卸下至仓库`);
      button.addEventListener('click', () => {
        try { unequipItem(index); refreshLobbyUI(); pushBatchNotify(`已卸下 ${item.name || '物品'}`); }
        catch (error) { reportError(error); }
      }); return button;
    };
    layout.placements.forEach(placement => {
      const index = equipped.indexOf(placement.item);
      const button = createCarried(placement.item, index); positionStorageItem(button, placement); equipGrid.appendChild(button);
    });
    if (layout.overflow.length) {
      const overflow = document.createElement('div'); overflow.className = 'grid-overflow'; overflow.style.gridColumn = '1 / span 6'; overflow.style.gridRow = String(rows + 1);
      const note = document.createElement('span'); note.textContent = '容量超出，请卸下多余物品：'; overflow.appendChild(note);
      layout.overflow.forEach(({item}) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = item.name || '卸下物品';
        button.addEventListener('click', () => { try { unequipItem(equipped.indexOf(item)); refreshLobbyUI(); } catch (error) { reportError(error); } }); overflow.appendChild(button);
      }); equipGrid.appendChild(overflow);
    }
    const gearGrid = byId('lobby-gear-grid');
    if (gearGrid) {
      gearGrid.innerHTML = '';
      const descriptors = [
        { label: '主武器', icon: 'weapon', item: equipped.filter(item => itemCategory(item) === 'weapon')[0] },
        { label: '副武器', icon: 'weapon', item: equipped.filter(item => itemCategory(item) === 'weapon')[1] },
        { label: '护甲', icon: 'armor', item: equipped.find(item => itemCategory(item) === 'armor') },
        { label: '背包', icon: 'backpack', item: equipped.find(item => itemCategory(item) === 'backpack') },
      ];
      descriptors.forEach(({label, icon, item}) => {
        const card = document.createElement('div'); card.className = 'lobby-gear-slot';
        const caption = document.createElement('span'); caption.className = 'gear-label'; caption.textContent = label; card.appendChild(caption);
        if (item) {
          const button = createCarried(item, equipped.indexOf(item)); button.classList.add('gear-equipped-item'); card.appendChild(button);
        } else {
          const empty = document.createElement('span'); empty.className = 'gear-empty-art'; empty.innerHTML = iconMarkup(icon);
          const hint = document.createElement('span'); hint.className = 'gear-name'; hint.textContent = '未装备'; card.append(empty, hint);
        }
        gearGrid.appendChild(card);
      });
    }
  }
  function updateActionButtons() {
    const selected = getSelectedStash();
    const hasSelection = selected.length > 0;
    const canEquip = selected.some(index => !getEquipError(stash[index]));
    if (equipBtn) { equipBtn.disabled = !hasSelection || !canEquip; equipBtn.textContent = `装备选中${hasSelection ? ` (${selected.length})` : ''}`; }
    if (sellBtn) {
      sellBtn.disabled = !hasSelection;
      const total = selected.reduce((sum, index) => sum + salePrice(stash[index]), 0);
      sellBtn.textContent = hasSelection ? `出售 ₡${total.toLocaleString()}` : '出售选中';
    }
    if (byId('selection-count')) byId('selection-count').textContent = `已选 ${selected.length} 件`;
  }
  updateActionButtons();
  if (selectAllCB) selectAllCB.onchange = () => {
    grid.querySelectorAll('.stash-item').forEach(button => {
      const index = Number(button.dataset.index);
      if (selectAllCB.checked) selectedStashIndices.add(index); else selectedStashIndices.delete(index);
      button.classList.toggle('selected', selectAllCB.checked);
      button.setAttribute('aria-pressed', String(selectAllCB.checked));
    });
    selectAllCB.indeterminate = false;
    updateActionButtons();
  };
  if (equipBtn) equipBtn.onclick = () => {
    const selected = getSelectedStash();
    if (!selected.length) return;
    try {
      const count = equipItems(selected);
      if (count > 0) refreshLobbyUI();
      pushBatchNotify(count === selected.length ? `已装备 ${count} 件物品` : `已装备 ${count} 件；其余物品受类型、槽位或容量限制`);
    } catch (error) { reportError(error); }
  };
  if (sellBtn) sellBtn.onclick = () => {
    const selected = getSelectedStash();
    if (!selected.length) return;
    try {
      const total = sellStashItems(selected);
      refreshLobbyUI(); pushBatchNotify(`已出售 ${selected.length} 件物品，获得 ₡${total.toLocaleString()}`);
    } catch (error) { reportError(error); }
  };
  if (sellAllBtn) sellAllBtn.onclick = async () => {
    const currentStash = getStash();
    if (!currentStash.length) return;
    const total = currentStash.reduce((sum, item) => sum + salePrice(item), 0);
    const accepted = await confirmAction({ title: '出售全部仓库物资？', description: `将出售仓库中 ${currentStash.length} 件物品，获得 ₡${total.toLocaleString()}。`, note: '不会出售已携带的装备。出售完成后无法撤销。', action: '确认出售' });
    if (!accepted) return;
    try {
      const earned = sellAllStash();
      refreshLobbyUI(); pushBatchNotify(`仓库物资已全部出售，获得 ₡${earned.toLocaleString()}`);
    } catch (error) { reportError(error); }
  };
}
export function initShopUI(items) {
  shopItems = Array.isArray(items) ? items : [];
  refreshShopUI();
}
function matchesFilter(item, filter) {
  const category = itemCategory(item);
  if (filter === 'all') return true;
  if (filter === 'armor') return ['armor', 'backpack'].includes(category);
  if (filter === 'supply') return ['ammo', 'grenade', 'key'].includes(category);
  if (filter === 'repair') return category === 'repair';
  return category === filter;
}
function refreshShopUI() {
  const grid = byId('shop-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const filter = getShopFilter();
  const displayed = shopItems.map((item, index) => ({ item, index })).filter(({ item }) => matchesFilter(item, filter));
  if (byId('shop-item-count')) byId('shop-item-count').textContent = `${displayed.length} 件物资`;
  if (!displayed.length) { grid.innerHTML = '<span class="stash-empty">此分类暂无可采购物资。</span>'; return; }
  for (const { item, index } of displayed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shop-item';
    button.dataset.rarity = itemRarity(item);
    const canAfford = getCoins() >= item.price;
    button.disabled = !canAfford;
    const art = document.createElement('span'); art.className = 'shop-emoji'; art.innerHTML = assetMarkup(item, { fallback: '' });
    const name = document.createElement('span'); name.className = 'shop-name'; name.textContent = item.name;
    const price = document.createElement('span'); price.className = 'shop-price'; price.textContent = `₡ ${item.price.toLocaleString()}`;
    const size = itemDimensions(item);
    const definition = getLootDef(item.type || item.id);
    const repairInfo = itemCategory(item) === 'repair' ? ` · 修复 ${item.repairAmount ?? definition.repairAmount ?? 0} / ${item.useTime ?? definition.useTime ?? 0}s` : '';
    const dimensions = document.createElement('span'); dimensions.className = 'shop-footprint'; dimensions.textContent = `${size.w} × ${size.h} 格${repairInfo}`;
    const hint = document.createElement('span'); hint.className = 'shop-buy-label'; hint.textContent = canAfford ? '采购 +' : '资金不足';
    button.append(art, name, dimensions, price, hint);
    button.title = canAfford ? `采购 ${item.name}，存入仓库` : `资金不足，还差 ₡${(item.price - getCoins()).toLocaleString()}`;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { buyItem } = await import('./shopdata.js');
        const result = buyItem(index);
        if (result.success) refreshLobbyUI(); else button.disabled = getCoins() < item.price;
        pushBatchNotify(result.message, !result.success);
      } catch (error) { button.disabled = getCoins() < item.price; reportError(error); }
    });
    grid.appendChild(button);
  }
}
export function hideStartScreen() {
  closeShellDialogs();
  hideShellScreens();
  hudOverlay.classList.remove('hidden');
  const canvas = byId('gameCanvas'); if (canvas) { canvas.tabIndex = 0; canvas.focus({preventScroll:true}); }
}
let deploying = false;
export function onDeploy(callback) {
  deployBtn.addEventListener('click', async event => {
    if (deploying || deployBtn.disabled) return;
    deploying = true; beginDeployment();
    try { await callback(event); }
    catch (error) { reportError(error); }
    finally { deploying = false; endDeployment(); }
  });
}

function appendRaidStats(player) {
  if (!player) return;
  const row = document.createElement('div'); row.className = 'result-stats';
  const elapsed = Math.max(0, Math.floor(player.raidElapsed || 0));
  const minutes = Math.floor(elapsed / 60), seconds = String(elapsed % 60).padStart(2, '0');
  row.textContent = `行动时长 ${minutes}:${seconds}  /  击杀 ${player.kills || 0}`;
  summaryLootContainer.appendChild(row);
}
export function showGameOver(mapName = '当前战区', player = null) {
  resultModal.classList.remove('hidden');
  resultModal.dataset.outcome = 'failure';
  resultModal.querySelector('.result-icon').innerHTML = iconMarkup('failure');
  const timeout = player?.raidOutcome === 'timeout', abandoned = player?.raidOutcome === 'abandoned';
  resultTitle.textContent = timeout ? '未能及时撤离' : abandoned ? '已放弃行动' : '行动失败';
  resultTitle.style.color = 'var(--danger)';
  resultDesc.textContent = `${timeout ? '行动时间耗尽' : abandoned ? '你已放弃本次行动' : '你在 ' + mapName + ' 阵亡'}。未保护的携带物资已遗失，仓库物资保留。保护栏 ${player?.secureInventory?.length || 0} 件物品已存入仓库。`;
  summaryLootContainer.innerHTML = '';
  appendRaidStats(player);
  restartBtn.textContent = '返回作战基地';
}
export function showVictory(player, totalValue = 0) {
  resultModal.classList.remove('hidden');
  resultModal.dataset.outcome = 'success';
  resultModal.querySelector('.result-icon').innerHTML = iconMarkup('check');
  resultTitle.textContent = '撤离成功';
  resultTitle.style.color = 'var(--accent)';
  resultDesc.textContent = `已将带出的物资安全存入仓库。本次战利品标价合计 ₡${totalValue.toLocaleString()}，可返回基地查看或出售。`;
  summaryLootContainer.innerHTML = '';
  appendRaidStats(player);
  const recovered = [...player.inventory, ...(player.secureInventory || []), ...(player.loadoutGear || []).filter(item => !item.broughtIn)];
  if (!recovered.length) {
    const empty = document.createElement('p'); empty.className = 'dialog-note'; empty.textContent = '本次未携带额外战利品。'; summaryLootContainer.appendChild(empty);
  }
  for (const item of recovered) {
    const slot = document.createElement('span'); setAssetIcon(slot, item, { fallback: '' }); slot.title = item.name || '物资'; summaryLootContainer.appendChild(slot);
  }
  const info = document.createElement('div'); info.className = 'summary-note';
  info.textContent = `当前资金 ₡${getCoins().toLocaleString()} · 带出物资出售后获得资金`;
  summaryLootContainer.appendChild(info);
  restartBtn.textContent = '返回作战基地';
}
export function onRestart(callback) {
  restartBtn.addEventListener('click', () => { resultModal.classList.add('hidden'); callback(); });
}
export function refreshLobbyUI() { refreshStashUI(); refreshShopUI(); refreshShell(); }
