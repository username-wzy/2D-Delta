// UI-only navigation, utility dialogs and operator presentation.
import { getCoins, getEquipped, getLoadoutError, resetProfile } from './economy.js';
import { getSettings, setSettings } from './settings.js';
import { getOperatorDef, defaultOperator } from './operatordata.js';
import { setAssetIcon, assetMarkup } from './assets.js';

const byId = id => document.getElementById(id);
let initialized = false;
let currentFilter = 'all';
let callbacks = {};
let confirmationPending = false;

function safeText(id, value) { const element = byId(id); if (element) element.textContent = value; }
function showDialog(id) {
  const dialog = byId(id);
  if (!dialog || dialog.open) return;
  if (id === 'settings-dialog') refreshSettings();
  dialog.showModal();
}
export function closeShellDialogs() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close('cancel'));
}
export function confirmAction({ title, description, note = '', action = '确认' }) {
  if (confirmationPending) return Promise.resolve(false);
  const dialog = byId('confirm-dialog');
  if (!dialog) return Promise.resolve(false);
  confirmationPending = true;
  safeText('confirm-title', title);
  safeText('confirm-description', description);
  safeText('confirm-note', note);
  const accept = dialog.querySelector('[data-confirm="accept"]');
  if (accept) accept.textContent = `${action} →`;
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      confirmationPending = false;
      resolve(dialog.returnValue === 'accept');
    }, { once: true });
    dialog.showModal();
  });
}
function refreshSettings() {
  const settings = getSettings();
  document.querySelectorAll('[data-setting]').forEach(input => { input.checked = Boolean(settings[input.dataset.setting]); });
}

// Utilities are bound at module evaluation so a failed data/save load still has
// working guidance, a retry and an explicit destructive-progress recovery flow.
byId('boot-retry-btn')?.addEventListener('click', () => location.reload());
byId('boot-reset-btn')?.addEventListener('click', async () => {
  const accepted = await confirmAction({
    title: '重置损坏的本地进度？',
    description: '这会删除当前浏览器中的游戏资金、仓库、携带装备和行动记录，并重新建立初始进度。',
    note: '无法撤销。只有确认不再需要现有进度时才继续。', action: '重置本地进度',
  });
  if (!accepted) return;
  try { resetProfile(); location.reload(); }
  catch (error) { safeText('boot-status', `重置失败：${error.message}`); byId('boot-status')?.classList.add('error'); }
});
document.querySelectorAll('[data-open-dialog]').forEach(button => button.addEventListener('click', () => showDialog(button.dataset.openDialog)));
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog')?.close()));
document.querySelectorAll('[data-confirm]').forEach(button => button.addEventListener('click', () => byId('confirm-dialog')?.close(button.dataset.confirm)));
document.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('change', () => {
  const feedback = byId('settings-feedback');
  try {
    setSettings({ [input.dataset.setting]: input.checked });
    if (feedback) { feedback.textContent = '设置已保存，立即生效。'; feedback.classList.remove('error'); }
  } catch (error) {
    refreshSettings();
    if (feedback) { feedback.textContent = `设置保存失败：${error.message}`; feedback.classList.add('error'); }
  }
}));

export function setLobbyView(view, focus = true) {
  if (!['operations', 'loadout', 'supply'].includes(view)) return;
  const screen = byId('start-screen');
  screen.dataset.view = view;
  document.querySelectorAll('[data-view-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.viewPanel !== view));
  document.querySelectorAll('.nav-tab[data-lobby-view]').forEach(button => {
    const selected = button.dataset.lobbyView === view;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const scroller = screen.querySelector('.lobby-body');
  if (scroller) scroller.scrollTop = 0;
  callbacks.refresh?.();
  if (focus) {
    const heading = byId(`view-${view}`)?.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
}
export function showHomeScreen() {
  closeShellDialogs();
  byId('start-screen')?.classList.add('hidden');
  byId('hud')?.classList.add('hidden');
  byId('home-screen')?.classList.remove('hidden');
  byId('enter-lobby-btn')?.focus({ preventScroll: true });
}
export function showLobbyShell() {
  byId('home-screen')?.classList.add('hidden');
  byId('start-screen')?.classList.remove('hidden');
  byId('hud')?.classList.add('hidden');
  setLobbyView('operations', false);
}
function syncOperatorStage() {
  const selected = byId('operator-cards')?.querySelector('.op-card.selected');
  const assetKey = selected?.querySelector('[data-asset]')?.dataset.asset;
  const id = selected?.dataset.operatorId || assetKey?.replace('operator/', '') || defaultOperator().id;
  const operator = getOperatorDef(id);
  setAssetIcon(byId('selected-operator-art'), operator, { kind: 'operator' });
  safeText('selected-operator-name', operator.name);
  safeText('selected-operator-desc', operator.description || '保持警惕，完成撤离。');
  safeText('selected-operator-code', operator.id.toUpperCase());
}
function syncMap() {
  const select = byId('map-select');
  const option = select?.selectedOptions?.[0];
  safeText('deployment-map-name', (option?.textContent || '废弃工厂').replace(/^[^\p{L}\p{N}]+/u, '').replace(' Factory-01', ''));
  const standard = select?.value === 'maps/factory_01.json';
  safeText('map-size-label', standard ? '50 × 38' : '自定义地图');
  safeText('map-extract-label', standard ? '3 个撤离区域' : '按导入配置');
}
export function refreshShell() {
  safeText('header-coins', getCoins().toLocaleString());
  const equipped = getEquipped();
  const error = getLoadoutError();
  safeText('loadout-status', error ? '需要调整配装' : equipped.length ? `已整备 ${equipped.length} 件物品` : '轻装待命');
  const quick = byId('quick-loadout');
  if (quick) {
    quick.innerHTML = '';
    if (!equipped.length) quick.innerHTML = '<span class="empty-loadout">建议携带护甲和医疗物资。</span>';
    for (const item of equipped.slice(0, 8)) {
      const slot = document.createElement('span');
      slot.className = 'quick-item'; slot.title = item.name || '携带物品';
      slot.innerHTML = assetMarkup(item); quick.appendChild(slot);
    }
  }
  syncOperatorStage(); syncMap();
}
export function getShopFilter() { return currentFilter; }
export function initShell(options) {
  callbacks = options;
  if (initialized) return;
  initialized = true;
  byId('enter-lobby-btn')?.addEventListener('click', () => callbacks.onEnter?.());
  byId('back-home-btn')?.addEventListener('click', showHomeScreen);
  document.querySelectorAll('[data-lobby-view]').forEach(button => button.addEventListener('click', () => setLobbyView(button.dataset.lobbyView)));
  document.querySelectorAll('[data-shop-filter]').forEach(button => button.addEventListener('click', () => {
    currentFilter = button.dataset.shopFilter;
    document.querySelectorAll('[data-shop-filter]').forEach(filter => {
      const active = filter === button;
      filter.classList.toggle('active', active); filter.setAttribute('aria-pressed', String(active));
    });
    safeText('shop-category-title', button.textContent.replace('↗', '').trim());
    callbacks.refreshShop?.();
  }));
  byId('map-select')?.addEventListener('change', syncMap);
  const importLabel = byId('map-import')?.closest('label');
  importLabel?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); byId('map-import').click(); }
  });
  const cards = byId('operator-cards');
  cards?.addEventListener('click', () => queueMicrotask(syncOperatorStage));
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(syncOperatorStage);
    if (cards) observer.observe(cards, { childList: true, attributes: true, attributeFilter: ['class'], subtree: true });
    if (byId('map-select')) new MutationObserver(syncMap).observe(byId('map-select'), { childList: true });
  }
  setAssetIcon(byId('home-operator'), getOperatorDef('tactical'), { kind: 'operator' });
  setAssetIcon(byId('home-operator-back'), getOperatorDef('heavy'), { kind: 'operator' });
  safeText('boot-status', '行动配置已就绪 · 本地进度自动保存');
  byId('boot-status')?.classList.remove('error');
  if (byId('enter-lobby-btn')) byId('enter-lobby-btn').disabled = false;
  refreshShell();
  showHomeScreen();
}
