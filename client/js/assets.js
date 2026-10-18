// Shared sprite atlas lookup for Canvas, lobby, inventory and the asset preview.
// Stable IDs resolve generated graphics; legacy visual fields are never rendered.
const assetBase = typeof import.meta.url === 'string'
  ? new URL('../assets/', import.meta.url).href : 'assets/';

export const atlasDefinitions = Object.freeze({
  operators: { src: `${assetBase}operators.png`, columns: 3, rows: 2, width: 1536, height: 1024 },
  enemies: { src: `${assetBase}enemies.png`, columns: 4, rows: 2, width: 1774, height: 887 },
  weapons: { src: `${assetBase}weapons.png`, columns: 2, rows: 4, width: 1254, height: 1254 },
  equipment: { src: `${assetBase}equipment.png`, columns: 4, rows: 4, width: 1254, height: 1254 },
  inventory: { src: `${assetBase}inventory.png`, columns: 4, rows: 4, width: 1280, height: 1280 },
  valuables: { src: `${assetBase}valuables.png`, columns: 4, rows: 4, width: 1280, height: 1280 },
  world: { src: `${assetBase}world.png`, columns: 2, rows: 2, width: 1024, height: 1024 },
});

const sprites = new Map();
function register(sheet, entries, prefix = '') {
  entries.forEach(([id, label, tag = ''], index) => {
    const { columns, rows } = atlasDefinitions[sheet];
    let frame = { x: index % columns / columns, y: Math.floor(index / columns) / rows,
      width: 1 / columns, height: 1 / rows };
    // The generated SVD stock crosses the nominal center by six pixels.
    // Sample the transparent gutter between the two bottom-row guns instead.
    if (sheet === 'weapons' && index >= 6) {
      const divider = 603 / 1254;
      frame = { x: index === 6 ? 0 : divider, y: 0.75,
        width: index === 6 ? divider : 1 - divider, height: 0.25 };
    }
    // Sample actual transparent gutters where generated subjects are off-grid.
    if (sheet === 'operators') {
      const divider = 503 / 1024;
      frame.y = index < 3 ? 0 : divider;
      frame.height = index < 3 ? divider : 1 - divider;
    }
    if (sheet === 'equipment' && [10, 11, 14, 15].includes(index)) {
      const divider = 906 / 1254;
      frame.y = index < 12 ? 0.5 : divider;
      frame.height = index < 12 ? divider - 0.5 : 1 - divider;
    }
    sprites.set(prefix + id, Object.freeze({ key: prefix + id, sheet, index, label, tag,
      ...atlasDefinitions[sheet], frame: Object.freeze(frame) }));
  });
}
register('operators', [
  ['scout', '侦察兵'], ['tactical', '战术特工'], ['heavy', '重装兵'],
  ['medic', '战地医生'], ['sniper', '狙击手'], ['engineer', '工程师'],
], 'operator/');
register('enemies', [
  ['zombie', '丧尸'], ['scav_gunner', '拾荒者枪手'], ['boss_ogre', '食人魔头目'],
  ['scav_sniper', '拾荒者狙击手'], ['runner', '狂奔者'],
  ['boss_commander', '指挥官头目'], ['heavy_gunner', '重装枪手'],
], 'bot/');
register('weapons', [
  ['tac_smg', 'TAC-SMG', 'TAC'], ['m249_saw', 'M249 SAW', 'M249'],
  ['weapon_ak47', 'AK-47', 'AK'], ['weapon_mp5', 'MP5-SD', 'MP5'],
  ['weapon_shotgun', 'M870', 'M870'], ['weapon_m4', 'M4A1', 'M4'],
  ['weapon_p90', 'P90', 'P90'], ['weapon_sniper', 'SVD', 'SVD'],
]);
register('equipment', [
  ['armor_light', '轻型防弹衣', 'II'], ['armor_heavy', '重型防弹护甲', 'V'],
  ['medkit', '军用医疗包', '+50'], ['medkit_large', '外科手术包', '+100'],
  ['injector', '肾上腺素注射器', '+30'], ['grenade', '破片手榴弹'],
  ['ammo_9mm', '9mm 弹药箱', '9mm'], ['ammo_rifle', '步枪弹药箱', 'RFL'],
  ['ammo_shell', '霰弹弹药', '12GA'], ['backpack', '战术背包'],
  ['keycard_red', '红色钥匙卡', '红'], ['keycard_blue', '蓝色钥匙卡', '蓝'],
  ['keycard_green', '绿色钥匙卡', '绿'], ['safe', '保险柜'],
  ['filing_cabinet', '文件柜'], ['wardrobe', '衣柜'],
]);


register('inventory', [
  ['cash', '大捆现金'], ['gem', '高价值蓝钻'], ['box', '军用物资箱'], ['gold_chain', '金项链'],
  ['flash_drive', '加密U盘'], ['dogtag', '特工身份牌'], ['gold_watch', '高级金表'], ['night_vision', '夜视仪'],
  ['repair_improvised', '自制维修包', '+40'], ['repair_standard', '标准维修包', '+80'],
  ['repair_precision', '精密维修包', '+120'], ['repair_advanced', '高级维修包', '+180'],
  ['circuit_board', '精密电路板'], ['hard_drive', '数据硬盘'], ['copper_wire', '铜线线圈'], ['reagent', '科研试剂'],
]);
register('valuables', [
  ['radio_transceiver', '军用无线电'], ['motor_pump', '高压泵电机'], ['industrial_battery', '工业蓄电池'], ['portable_generator', '便携发电机'],
  ['graphics_card', '高性能显卡'], ['cpu', '处理器芯片'], ['spectrum_analyzer', '频谱分析仪'], ['military_laptop', '军用加固电脑'],
  ['oxygen_cylinder', '医用氧气瓶'], ['sealant', '工业密封胶'], ['wrench', '活动扳手'], ['intelligence_docs', '机密情报文件'],
  ['gold_bar', '投资金条'], ['amber_statuette', '琥珀雕像'], ['camera', '专业数码相机'], ['microscope', '实验室显微镜'],
]);
register('world', [
  ['wall', '工业墙体'], ['tree', '松树'], ['helipad', '撤离停机坪'], ['beacon', '撤离信标'],
], 'world/');

const images = new Map();
const states = new Map();
let loading;

/** Images load independently of gameplay. A failed sheet uses a neutral line silhouette. */
export function loadGameAssets() {
  if (loading) return loading;
  if (typeof Image === 'undefined') return Promise.resolve([]);
  loading = Promise.all(Object.entries(atlasDefinitions).map(([sheet, definition]) =>
    new Promise(resolve => {
      const image = new Image();
      states.set(sheet, 'loading');
      image.decoding = 'async';
      const finish = ready => {
        image.onload = image.onerror = null;
        states.set(sheet, ready ? 'ready' : 'failed');
        if (ready) {
          images.set(sheet, image);
          document.documentElement?.classList.add(`assets-${sheet}-ready`);
        }
        resolve({ sheet, ready });
      };
      image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
      image.onerror = () => finish(false);
      image.src = definition.src;
    })
  ));
  return loading;
}

export function getAsset(subject, kind = 'item') {
  if (!subject) return null;
  if (typeof subject === 'string') {
    return sprites.get((kind === 'operator' ? 'operator/' : kind === 'bot' ? 'bot/' : '') + subject) || null;
  }
  if (kind === 'operator') return sprites.get(`operator/${subject.opId || subject.id}`) || null;
  if (kind === 'bot') return sprites.get(`bot/${subject.botId || subject.id}`) || null;
  // Loot.id identifies a particular instance, while Loot.type identifies its definition.
  for (const id of [subject.type, subject.id, subject.weaponId]) {
    if (sprites.has(id)) return sprites.get(id);
  }
  return null;
}

export function getAssetState(sheet) { return states.get(sheet) || 'idle'; }
export function allAssets() { return [...sprites.values()]; }

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** Neutral line silhouette also works while a sheet is unavailable. */
function placeholderMarkup() {
  return '<svg class="asset-placeholder" viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 15 24 7l15 8v19l-15 8-15-8V15Zm0 0 15 8 15-8M24 23v19M16 11l15 8v9"/><path d="m15 30 4 2m-4 2 4 2"/></svg>';
}

/** CSS samples a cell directly from the same original PNG used by Canvas. */
export function assetMarkup(subject, { kind = 'item', label } = {}) {
  const asset = getAsset(subject, kind);
  const fallback = placeholderMarkup();
  if (!asset) return `<span class="asset-icon asset-generic" role="img" aria-label="${escapeHTML(label || (typeof subject === 'object' ? subject?.name : '') || '未识别物品')}"><span class="asset-fallback" aria-hidden="true">${fallback}</span></span>`;
  const frame = asset.frame;
  const x = frame.width < 1 ? frame.x / (1 - frame.width) * 100 : 0;
  const y = frame.height < 1 ? frame.y / (1 - frame.height) * 100 : 0;
  const ratio = frame.width * asset.width / (frame.height * asset.height);
  const slotRatio = asset.sheet === 'weapons' ? 2 : 1;
  const contentWidth = Math.min(1, ratio / slotRatio) * 100;
  const contentHeight = Math.min(1, slotRatio / ratio) * 100;
  return `<span class="asset-icon asset-${asset.sheet}" data-asset="${asset.key}" role="img" aria-label="${escapeHTML(label || asset.label)}" style="--atlas:url('${asset.src}');--atlas-size:${100 / frame.width}% ${100 / frame.height}%;--atlas-position:${x}% ${y}%;--asset-width:${contentWidth}%;--asset-height:${contentHeight}%"><span class="asset-art" aria-hidden="true"></span><span class="asset-fallback" aria-hidden="true">${fallback}</span>${asset.tag ? `<span class="asset-tag" aria-hidden="true">${asset.tag}</span>` : ''}</span>`;
}

/** HUD calls this every frame; only a changed icon rewrites its DOM. */
export function setAssetIcon(element, subject, options = {}) {
  if (!element) return;
  const asset = getAsset(subject, options.kind);
  const signature = `${asset?.key || ''}|${options.label || ''}|${typeof subject === 'object' ? subject?.name || '' : ''}`;
  if (element.dataset.assetSignature === signature) return;
  element.dataset.assetSignature = signature;
  element.innerHTML = assetMarkup(subject, options);
}

/** Returns false while unavailable, allowing a neutral geometry fallback. */
export function drawAsset(ctx, subject, x, y, width, height, kind = 'item') {
  const asset = getAsset(subject, kind);
  const image = asset && images.get(asset.sheet);
  if (!image) return false;
  const frame = asset.frame;
  const sourceWidth = frame.width * image.naturalWidth;
  const sourceHeight = frame.height * image.naturalHeight;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawnWidth = sourceWidth * scale, drawnHeight = sourceHeight * scale;
  ctx.drawImage(image, frame.x * image.naturalWidth, frame.y * image.naturalHeight,
    sourceWidth, sourceHeight,
    x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  return true;
}
