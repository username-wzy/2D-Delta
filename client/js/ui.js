// Lobby transactions and raid results. Authentication is deliberately absent.
import { getCoins, getStash, unequipItem, getEquipped, getMaxEquipSlots, getLoadoutError, getEquipError, equipItems, sellStashItems, sellAllStash, salePrice } from './economy.js';
import { assetMarkup, setAssetIcon } from './assets.js';
import { itemCategory, itemRarity, RARITY_NAMES } from './itemrules.js';
import { initShell, showLobbyShell, closeShellDialogs, confirmAction, refreshShell, getShopFilter, setLobbyView } from './ui-shell.js';
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
  title += ` · ${RARITY_NAMES[itemRarity(item)-1]}${item.durability !== undefined ? ' · 耐久 ' + item.durability + '/' + item.maxDurability : ''}`;
  setAssetIcon(button, item);
  button.title = title;
  button.setAttribute('aria-label', title);
  const label = document.createElement('span');
  label.className = 'item-label';
  label.textContent = item.name || '物品';
  button.appendChild(label);
  return button;
}
function refreshStashUI() {
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
  if (capText) capText.textContent = `容量 ${getMaxEquipSlots()}`;
  deployBtn.disabled = Boolean(loadoutError);
  deployBtn.title = loadoutError || '部署进入战区';
  const feedback = byId('lobby-feedback');
  if (feedback) {
    if (loadoutError) { feedback.textContent = loadoutError; feedback.dataset.loadoutError = 'true'; feedback.classList.add('error'); }
    else if (feedback.dataset.loadoutError) { feedback.textContent = ''; delete feedback.dataset.loadoutError; feedback.classList.remove('error'); }
  }
  if (coinsEl) coinsEl.textContent = `₡ ${getCoins().toLocaleString()}`;
  if (byId('stash-total')) byId('stash-total').textContent = String(stash.length);
  grid.innerHTML = '';
  selectedStashIndices.clear();
  if (selectAllCB) { selectAllCB.checked = false; selectAllCB.disabled = !stash.length; selectAllCB.indeterminate = false; }
  if (sellAllBtn) sellAllBtn.disabled = !stash.length;
  if (!stash.length) {
    const empty = document.createElement('div');
    empty.className = 'stash-empty';
    empty.innerHTML = '<b>仓库等待第一份战利品</b><span>行动撤离后带出的物资会保存在这里。<br>也可以先到军需采购准备装备。</span><br>';
    const go = document.createElement('button'); go.className = 'text-btn'; go.textContent = '前往军需采购 →';
    go.addEventListener('click', () => setLobbyView('supply'));
    empty.appendChild(go); grid.appendChild(empty);
  }
  stash.forEach((item, index) => {
    const title = `${item.name || '物品'} · 出售价 ₡${salePrice(item).toLocaleString()} · 点击选择`;
    const button = createItemButton(item, title);
    button.dataset.index = index;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      if (selectedStashIndices.has(index)) selectedStashIndices.delete(index); else selectedStashIndices.add(index);
      const selected = selectedStashIndices.has(index);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (selectAllCB) {
        selectAllCB.checked = selectedStashIndices.size === stash.length;
        selectAllCB.indeterminate = selectedStashIndices.size > 0 && selectedStashIndices.size < stash.length;
      }
      updateActionButtons();
    });
    grid.appendChild(button);
  });
  if (equipGrid) {
    equipGrid.innerHTML = '';
    if (!equipped.length) equipGrid.innerHTML = '<span class="stash-empty"><b>轻装出发</b>从仓库选择装备并点击“装备选中”。<br>也可直接使用特工的基础武器部署。</span>';
    equipped.forEach((item, index) => {
      const button = createItemButton(item, `${item.name || '物品'} · 点击卸下至仓库`);
      button.addEventListener('click', () => {
        try { unequipItem(index); refreshLobbyUI(); pushBatchNotify(`已卸下 ${item.name || '物品'}`); }
        catch (error) { reportError(error); }
      });
      equipGrid.appendChild(button);
    });
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
    selectedStashIndices.clear();
    grid.querySelectorAll('.stash-item').forEach(button => {
      const index = Number(button.dataset.index);
      if (selectAllCB.checked) selectedStashIndices.add(index);
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
    const art = document.createElement('span'); art.className = 'shop-emoji'; art.innerHTML = assetMarkup(item);
    const name = document.createElement('span'); name.className = 'shop-name'; name.textContent = item.name;
    const price = document.createElement('span'); price.className = 'shop-price'; price.textContent = `₡ ${item.price.toLocaleString()}`;
    const hint = document.createElement('span'); hint.className = 'shop-buy-label'; hint.textContent = canAfford ? '采购 +' : '资金不足';
    button.append(art, name, price, hint);
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
  startScreen.classList.add('hidden');
  byId('home-screen')?.classList.add('hidden');
  hudOverlay.classList.remove('hidden');
  const canvas = byId('gameCanvas'); if (canvas) { canvas.tabIndex = 0; canvas.focus({preventScroll:true}); }
}
export function onDeploy(callback) { deployBtn.addEventListener('click', callback); }
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
  resultModal.querySelector('.result-icon').textContent = '☠';
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
  resultModal.querySelector('.result-icon').textContent = '✓';
  resultTitle.textContent = '撤离成功';
  resultTitle.style.color = 'var(--accent)';
  resultDesc.textContent = `已将带出的物资安全存入仓库。本次战利品标价合计 ₡${totalValue.toLocaleString()}，可返回基地查看或出售。`;
  summaryLootContainer.innerHTML = '';
  appendRaidStats(player);
  if (!player.inventory.length && !player.secureInventory?.length) {
    const empty = document.createElement('p'); empty.className = 'dialog-note'; empty.textContent = '本次未携带额外战利品。'; summaryLootContainer.appendChild(empty);
  }
  for (const item of [...player.inventory, ...(player.secureInventory || [])]) {
    const slot = document.createElement('span'); setAssetIcon(slot, item); slot.title = item.name || '物资'; summaryLootContainer.appendChild(slot);
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
