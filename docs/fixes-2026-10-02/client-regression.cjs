// Execute real game, economy, HUD and lobby modules. Only Canvas rendering,
// sound, browser DOM/storage and the animation scheduler are test doubles.
// No production exports are added: state access exists in this VM copy only.
// Run from the repository root:
// node --experimental-vm-modules docs/fixes-2026-10-02/client-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const client = path.join(root, 'client');
const elements = new Map(), storage = new Map(), timers = [];
let storageFails = false;
const fixtureMaps = new Map();
function surface(base = {}) {
  const handlers = new Map();
  return Object.assign(base, {
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    dispatchEvent(event) {
      event.target ||= this;
      for (const fn of handlers.get(event.type) || []) fn(event);
      this['on' + event.type]?.(event);
    }
  });
}
function element(id = '') {
  const classes = new Set(['hidden']);
  const el = surface({id, tagName: 'DIV', style: {}, dataset: {}, children: [],
    value: id === 'map-select' ? 'maps/factory_01.json' : '', width: 1280, height: 720,
    disabled: false, className: '', innerText: '', textContent: '',
    classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      toggle(x, force) { const yes = force ?? !classes.has(x); if (yes) classes.add(x); else classes.delete(x); return yes; }},
    appendChild(x) { x.parentElement = this; this.children.push(x); return x; },
    removeChild(x) { this.children.splice(this.children.indexOf(x), 1); x.parentElement = null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || element(selector); },
    querySelectorAll(selector) { return this.children.filter(x => selector.startsWith('.') && x.className.split(' ').includes(selector.slice(1))); },
    getContext() { return {}; }, focus() {}, closest() { return null; }
  });
  let markup = '';
  Object.defineProperty(el, 'innerHTML', {get: () => markup, set(value) { markup = value; this.children = []; }});
  return el;
}
function getElement(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); }
const document = surface({getElementById: getElement, createElement: () => element(), hidden: false});
const window = surface({innerWidth: 1280, innerHeight: 720});
const context = vm.createContext({console, Math, Date, performance: {now: () => 0},
  setTimeout: fn => {timers.push(fn); return timers.length;}, requestAnimationFrame: () => 0,
  confirm: () => true, localStorage: {getItem: key => storage.get(key) ?? null,
    setItem(key, value) { if (storageFails) throw new Error('QuotaExceededError'); storage.set(key, value); },
    removeItem: key => storage.delete(key)}, document, window,
  Event: class {constructor(type) {this.type = type;}},
  CustomEvent: class {constructor(type, data) {this.type = type; this.detail = data.detail;}},
  fetch: async file => {
    if (fixtureMaps.has(file)) return {ok: true, json: async () => fixtureMaps.get(file)};
    const filename = path.resolve(client, file), ok = fs.existsSync(filename);
    return {ok, status: ok ? 200 : 404, json: async () => JSON.parse(fs.readFileSync(filename, 'utf8'))};
  }
});
const stubs = {'renderer.js': {render() {}}, 'sound.js': Object.fromEntries(
  ['playShootSound','playHitSound','playPickupSound','playExtractionBeep','playEnemyShootSound','playGrenadeSound'].map(key => [key, () => {}]))};
const modules = new Map();
function moduleFor(file) {
  if (modules.has(file)) return modules.get(file);
  const basename = path.basename(file);
  let mod;
  if (stubs[basename]) {
    const values = stubs[basename];
    mod = new vm.SyntheticModule(Object.keys(values), function () {for (const [key, value] of Object.entries(values)) this.setExport(key, value);}, {context, identifier: file});
  } else {
    let source = fs.readFileSync(file, 'utf8');
    if (basename === 'main.js') source += `
      export const regression = {
        initWorld, finishRaid, update, interactTarget, useMedkit, throwGrenade,
        reloadWeapon, switchWeapon, giveLoot, newLoot, pickNearbyItem,
        refreshNearbyPanel, showContainerLoot, pickFromContainer, takeAllFromContainer,
        get player() {return player}, get containers() {return containers},
        get weaponSlots() {return weaponSlots}, get loots() {return loots},
        get viewingContainer() {return viewingContainer}, get raidState() {return raidState},
        get activeRaidId() {return activeRaidId}, get worldWidth() {return worldWidth},
        op(id) {selectedOpId = id},
        state(s) {
          if ('bots' in s) bots = s.bots;
          if ('walls' in s) walls = s.walls;
          if ('loots' in s) loots = s.loots;
          if ('containers' in s) containers = s.containers;
          if ('extractions' in s) extractions = s.extractions;
          if ('nearestLoot' in s) nearestLoot = s.nearestLoot;
          if ('nearestContainer' in s) nearestContainer = s.nearestContainer;
        }
      };`;
    mod = new vm.SourceTextModule(source, {context, identifier: file, importModuleDynamically: async (specifier, ref) => {
      const dynamic = moduleFor(path.resolve(path.dirname(ref.identifier), specifier));
      if (dynamic.status === 'unlinked') await dynamic.link(linker);
      if (dynamic.status === 'linked') await dynamic.evaluate();
      return dynamic;
    }});
  }
  modules.set(file, mod); return mod;
}
const linker = (specifier, ref) => moduleFor(path.resolve(path.dirname(ref.identifier), specifier));
const results = [];
async function check(id, action) {
  try {await action(); results.push({id, passed: true}); console.log('PASS', id);}
  catch (error) {results.push({id, passed: false, error: error.stack}); console.error('FAIL', id, error.message);}
}
(async () => {
  const main = moduleFor(path.join(client, 'js/main.js'));
  await main.link(linker); await main.evaluate(); await new Promise(setImmediate);
  const api = main.namespace.regression;
  const ns = name => modules.get(path.join(client, 'js', name + '.js')).namespace;
  const economy = ns('economy'), entities = ns('entities'), input = ns('input');
  const ops = ns('operatordata'), shop = ns('shopdata'), ui = ns('ui'), hud = ns('hud'), maploader = ns('maploader');
  function item(id) { return {...JSON.parse(fs.readFileSync(path.join(client, 'data/loot.json'), 'utf8')).find(x => x.id === id), id}; }
  async function raid(op = 'tactical', equipped = [], map = 'maps/factory_01.json') {
    if (api.raidState === 'inRaid') api.finishRaid(false);
    economy.resetProfile(); economy.setMaxEquipSlots(ops.getOperatorDef(op).maxSlots);
    economy.getProfile().equipped = equipped.map(item);
    getElement('map-select').value = map; api.op(op);
    assert.equal(await api.initWorld(), true);
    api.state({bots: [], walls: [], containers: [], loots: [], extractions: []});
    input.resetInput();
  }
  function container(type = 'wardrobe', config = {}) {
    const c = new entities.LootContainer(api.player.x, api.player.y, type, config);
    c.raidId = api.activeRaidId;
    api.state({containers: [c], nearestContainer: c}); return c;
  }
  function ground(type) {
    const loot = api.newLoot(api.player.x, api.player.y, type);
    api.state({loots: [loot], nearestLoot: loot}); return loot;
  }
  function step(seconds) {for (let t = 0; t < seconds - 1e-8; t += 0.05) api.update(0.05);}
  function key(code, extra = {}) {
    const event = {type: 'keydown', code, preventDefault() {this.prevented = true;}, ...extra};
    window.dispatchEvent(event); return event;
  }
  await check('B01: carried red/blue/green keys unlock only matching safes', async () => {
    for (const color of ['red', 'blue', 'green']) {
      await raid('tactical', ['keycard_' + color]);
      const safe = container('safe', {requiredKey: 'keycard_' + color});
      api.interactTarget(); assert.equal(safe.isSearching, true);
      const wrong = container('safe', {requiredKey: 'keycard_' + (color === 'red' ? 'blue' : 'red')});
      api.interactTarget(); assert.equal(wrong.isSearching, false);
    }
    const configured = JSON.parse(fs.readFileSync(path.join(client, 'maps/factory_01.json'), 'utf8')).containers.filter(x => x.type === 'safe');
    assert.deepEqual([...new Set(configured.map(x => x.requiredKey))].sort(), ['keycard_blue', 'keycard_green', 'keycard_red']);
    assert(shop.getShopItems().some(x => x.id === 'keycard_red'));
  });
  await check('B02: loot stored once; bonus paid once; resale pays 40%', async () => {
    await raid('tactical', ['weapon_ak47', 'keycard_red', 'medkit']);
    api.giveLoot(api.newLoot(0, 0, 'gem')); const raidId = api.activeRaidId;
    api.finishRaid(true);
    assert.equal(economy.getCoins(), 55000); assert.equal(api.player.coins, 55000);
    assert.equal(economy.getStash().length, 1);
    assert.deepEqual(Array.from(economy.getEquipped(), x => x.id).sort(), ['keycard_red','medkit','weapon_ak47']);
    api.finishRaid(true); api.update(0.1); assert.equal(economy.getCoins(), 55000);
    assert.equal(economy.settleRaid(raidId, true), false);
    assert.equal(economy.sellStashItem(0), 14000); assert.equal(economy.getCoins(), 69000);
    assert.match(getElement('result-desc').innerText, /存入仓库/);
  });
  await check('B03: lethal hit on last extraction frame produces only death', async () => {
    await raid('tactical', ['keycard_red']); api.player.x = 100; api.player.y = 100;
    api.player.hp = 1; api.player.armor = 0; api.player.isExtracting = true; api.player.extractTimer = 0.01;
    const bot = new entities.Bot(110, 100, {hp: 80, damage: 20, attackRange: 60});
    Object.assign(bot, {state: 'aggro', reactionDelay: 0, aiTickTimer: 100, targetX: 110, targetY: 100, fireCooldown: 0});
    api.state({bots: [bot], extractions: [{x: 50,y: 50,w: 100,h: 100}]}); api.update(0.02);
    assert.equal(api.raidState, 'dead'); assert.equal(getElement('result-title').innerText, '特工阵亡');
    assert.equal(economy.getCoins(), 50000); assert.equal(economy.getEquipped().length, 0);
    step(1); assert.equal(economy.getCoins(), 50000);
  });
  await check('B04: editing, repeated actions, blur, visibility and UI mouse clicks', async () => {
    await raid('tactical', ['grenade', 'medkit']); api.player.hp = 30;
    assert.equal(key('KeyG', {target: {tagName: 'INPUT'}}).prevented, undefined);
    assert.equal(api.player.grenadeCount, 1);
    key('Digit4', {repeat: true}); assert.equal(api.player.medkitCount, 1);
    key('KeyW'); assert.equal(input.keys.w, true); window.dispatchEvent({type: 'blur'}); assert.equal(input.keys.w, false);
    key('KeyW'); document.hidden = true; document.dispatchEvent({type: 'visibilitychange'}); assert.equal(input.keys.w, false); document.hidden = false;
    key('KeyW'); window.dispatchEvent({type: 'focusin', target: {tagName: 'TEXTAREA'}}); assert.equal(input.keys.w, false);
    window.dispatchEvent({type: 'mousedown', button: 0, target: getElement('nearby-loot-panel')}); assert.equal(input.mouse.isDown, false);
    window.dispatchEvent({type: 'mousedown', button: 0, target: getElement('gameCanvas')}); assert.equal(input.mouse.isDown, true);
    api.finishRaid(false); assert.equal(input.mouse.isDown, false); assert.equal(key('Tab').prevented, undefined);
  });
  await check('B05: medicines heal by definition and consume exactly one instance', async () => {
    await raid('heavy', ['medkit_large', 'injector']); api.player.hp = 1; api.useMedkit();
    assert.equal(api.player.hp, 101); assert.equal(api.player.medkitCount, 1);
    api.useMedkit(api.player.inventory[0].id); assert.equal(api.player.hp, 131); assert.equal(api.player.medkitCount, 0);
    api.finishRaid(true); assert.equal(economy.getEquipped().length, 0);
    await raid('heavy'); api.player.hp = 1; const med = ground('medkit'); api.interactTarget();
    assert.equal(api.player.hp, 1); assert.equal(api.player.medkitCount, 1);
    hud.refreshInventoryGrid(api.player); getElement('loot-grid').children[0].dispatchEvent({type: 'click'});
    assert.equal(api.player.hp, 51); assert(!api.player.inventory.includes(med));
  });
  await check('B05: picked grenade becomes usable and is consumed', async () => {
    await raid(); ground('grenade'); api.interactTarget(); assert.equal(api.player.grenadeCount, 1);
    api.throwGrenade(); assert.equal(api.player.grenadeCount, 0); assert.equal(api.player.inventory.length, 0);
  });
  await check('B06: default ammo type, configured amounts and secondary weapon supply', async () => {
    await raid('tactical', ['ammo_9mm']); assert.equal(api.player.gun.ammoType, '9mm'); assert.equal(api.player.gun.maxAmmo, 240);
    assert.equal(api.player.inventory.length, 0);
    await raid('tactical', ['weapon_ak47','ammo_rifle']); assert.equal(api.player.gun.maxAmmo, 180);
    await raid('tactical', ['weapon_shotgun','weapon_ak47','ammo_rifle']); api.switchWeapon(1); assert.equal(api.player.gun.maxAmmo, 180);
    const loot = ground('ammo_rifle'); api.interactTarget(); assert.equal(api.player.gun.maxAmmo, 270); assert(!api.loots.includes(loot));
    api.switchWeapon(0); assert.equal(api.player.gun.maxAmmo, 24);
  });
  await check('B07: guns own reload/cooldown state, shared ammo cannot be duplicated', async () => {
    await raid('tactical', ['weapon_ak47','weapon_shotgun']);
    api.player.gun.currentAmmo = 0; api.reloadWeapon(); step(1.9); api.switchWeapon(1);
    api.player.gun.currentAmmo = 0; assert.equal(api.player.gun.isReloading, false); assert.equal(api.player.gun.reloadTimer, 0);
    step(0.15); assert.equal(api.player.gun.currentAmmo, 0); assert.equal(api.weaponSlots[0].currentAmmo, 30);
    api.reloadWeapon(); step(2.4); assert.equal(api.player.gun.currentAmmo, 0); step(0.15); assert.equal(api.player.gun.currentAmmo, 6);
    await raid('tactical', ['weapon_ak47','weapon_m4']); api.player.ammoReserves.rifle = 10;
    api.weaponSlots[0].currentAmmo = 0; api.reloadWeapon(); api.switchWeapon(1); api.player.gun.currentAmmo = 0; api.reloadWeapon();
    step(2.1); assert.equal(api.weaponSlots.reduce((sum, gun) => sum + gun.currentAmmo, 0), 10); assert.equal(api.player.ammoReserves.rifle, 0);
  });
  await check('B08: medic regeneration delay, sniper precision and engineer search speed', async () => {
    await raid('medic'); api.player.hp = 50; step(2.9); assert.equal(api.player.hp, 50); step(7.1); assert(api.player.hp > 63 && api.player.hp < 65);
    await raid('sniper'); api.update(0.1); assert.equal(api.player.spread, 0.006);
    input.keys.d = true; api.update(0.1); assert.equal(api.player.spread, 0.024); input.resetInput();
    await raid('engineer');
    // Real map containers receive the passive when a raid is built.
    api.finishRaid(false); economy.resetProfile(); assert.equal(await api.initWorld(), true);
    assert(api.containers.every(c => c.searchDuration === c.baseSearchDuration * 0.5));
    api.state({bots:[],walls:[],containers:[],extractions:[]}); const bp = ground('backpack'); api.interactTarget(); assert.equal(bp.searchTimer, 0.75);
  });
  await check('B09: F and H cannot bypass backpack search or spawn contents twice', async () => {
    await raid(); const bp = ground('backpack'); api.interactTarget(); api.interactTarget();
    api.refreshNearbyPanel(); api.pickNearbyItem(0); assert.equal(api.player.inventory.length, 0); assert.equal(bp.isSearching, true);
    step(1.55); assert.equal(api.player.inventory.length, 1); assert.equal(bp.isSearched, true);
    const count = api.loots.length; assert(count >= 2 && count <= 3);
    api.state({nearestLoot: bp}); api.interactTarget(); step(0.5); assert.equal(api.loots.length, count);
    await raid(); const viaH = ground('backpack'); api.refreshNearbyPanel(); api.pickNearbyItem(0);
    assert.equal(viaH.isSearching, true); assert.equal(api.player.inventory.length, 0);
    input.keys.d = true; api.update(0.1); assert.equal(viaH.isSearching, false); assert.equal(viaH.searchTimer, 0);
  });
  await check('B10: container pickup checks distance, line of sight and raid ownership', async () => {
    await raid(); const c = container(); c.isOpen = true; c.spawnedLoot = [{type:'gem'}]; api.showContainerLoot(c);
    api.player.x += 1000; api.pickFromContainer(0); assert.equal(api.player.inventory.length, 0); assert.equal(api.viewingContainer, null);
    api.player.x = c.x; c.raidId = 'old-raid'; api.showContainerLoot(c); api.pickFromContainer(0); assert.equal(api.player.inventory.length, 0);
    c.raidId = api.activeRaidId; c.x += 50; api.state({walls:[new entities.Wall(api.player.x + 20,api.player.y - 40,10,80)]});
    api.showContainerLoot(c); api.pickFromContainer(0); assert.equal(api.player.inventory.length, 0);
    api.state({walls:[]}); api.showContainerLoot(c); api.pickFromContainer(0); assert.equal(api.player.inventory.length, 1);
    c.spawnedLoot.push({type:'cash'}); api.showContainerLoot(c); api.finishRaid(false);
    assert.equal(api.viewingContainer, null); await raid(); api.showContainerLoot(c); api.pickFromContainer(0); assert.equal(api.player.inventory.length, 0);
  });
  await check('B11: lobby capacity updates immediately; duplicate gear and overload are blocked', async () => {
    api.finishRaid(false); economy.resetProfile(); economy.setMaxEquipSlots(8);
    economy.getProfile().stash = [item('backpack'),item('backpack'),item('gem')]; ui.showStartScreen();
    getElement('stash-grid').children[0].dispatchEvent({type:'click'}); getElement('stash-equip-selected').onclick();
    assert.equal(economy.getMaxEquipSlots(), 12); assert.equal(getElement('equip-capacity-text').innerText, '容量: 12');
    assert.equal(economy.equipItem(0), false); assert.equal(economy.equipItem(1), false);
    getElement('equipped-grid').children[0].dispatchEvent({type:'click'}); assert.equal(getElement('equip-capacity-text').innerText, '容量: 8');
    economy.getProfile().equipped = Array.from({length:9}, () => item('medkit')); ui.refreshLobbyUI();
    assert.equal(getElement('deploy-btn').disabled, true); assert.throws(() => economy.beginRaid('overload'), /容量/);
    economy.unequipItem(0); ui.refreshLobbyUI(); assert.equal(getElement('deploy-btn').disabled, false);
    economy.getProfile().stash = Array.from({length:70}, () => item('gem')); ui.refreshLobbyUI(); assert.equal(getElement('stash-grid').children.length, 70);
  });
  const wide = {name:'自制宽地图',width:100,height:50,tileSize:64, tiles:Array(50).fill(Array(100).fill('0').join(',')),
    spawns:[{x:70,y:10,team:'pmc'}],extractions:[{x:80,y:10,w:3,h:3}]};
  await check('B12: real raid movement uses imported map dimensions; map validation rejects invalid data', async () => {
    fixtureMaps.set('wide.json', wide); await raid('tactical', [], 'wide.json'); assert.equal(api.worldWidth, 6400);
    const before = api.player.x; input.keys.d = true; api.update(0.1); assert.equal(api.player.x, before + 30); input.resetInput();
    api.player.x = 6390; input.keys.d = true; api.update(0.1); assert.equal(api.player.x, 6376); input.resetInput();
    assert.throws(() => maploader.buildWorldFromMap({...wide,width:99}), /尺寸/);
    assert.throws(() => maploader.buildWorldFromMap({...wide,spawns:[]}), /出生点/);
    assert.throws(() => maploader.buildWorldFromMap({...wide,extractions:[{x:99,y:0,w:3,h:3}]}), /撤离点/);
    const blocked = {...wide, tiles:wide.tiles.map((row,index) => index===0 ? '1,'+row.slice(2) : row), containers:[{x:0,y:0,type:'wardrobe'}]};
    assert.throws(() => maploader.buildWorldFromMap(blocked), /空地/);
  });
  await check('map import is usable from lobby and preserves custom name', async () => {
    api.finishRaid(false); getElement('restart-btn').dispatchEvent({type:'click'});
    getElement('map-import').dispatchEvent({type:'change', target:{files:[{size:100,name:'wide.json',text:async()=>JSON.stringify(wide)}],value:'wide.json'}});
    await new Promise(setImmediate);
    assert.match(getElement('map-select').value, /^imported-/); assert.equal(await api.initWorld(), true);
    assert.equal(api.worldWidth, 6400); assert.equal(api.player.mapName, '自制宽地图');
  });
  await check('failed map/weapon loading preserves reserved assets and returns to lobby', async () => {
    api.finishRaid(false); economy.resetProfile(); economy.getProfile().equipped = [item('keycard_red')];
    getElement('map-select').value = 'missing.json'; assert.equal(await api.initWorld(), false);
    assert.equal(api.raidState, 'lobby'); assert.equal(economy.getEquipped().length, 1); assert.equal(economy.getProfile().activeRaid, null);
    getElement('map-select').value = 'maps/factory_01.json'; economy.getProfile().equipped = [{id:'weapon_missing'}];
    assert.equal(await api.initWorld(), false); assert.equal(economy.getEquipped()[0].id, 'weapon_missing');
  });
  await check('profile reload forfeits unfinished raid; settlement failures can retry once', async () => {
    await raid('tactical', ['keycard_red']); api.giveLoot(api.newLoot(0,0,'gem'));
    storageFails = true; api.finishRaid(true); assert.equal(api.raidState, 'settlementPending'); assert.equal(economy.getCoins(), 50000);
    assert.equal(getElement('restart-btn').innerText, '重试保存'); api.update(0.1); assert.equal(economy.getCoins(), 50000);
    storageFails = false; getElement('restart-btn').dispatchEvent({type:'click'});
    assert.equal(api.raidState, 'extracted'); assert.equal(economy.getCoins(), 55000); assert.equal(economy.getStash().length, 1);
    await raid('tactical', ['keycard_red']); economy.loadProfile(); assert.equal(economy.getEquipped().length, 0);
    assert.equal(economy.getProfile().lastRaidResult.outcome, 'abandoned'); assert.equal(economy.getProfile().activeRaid, null);
    // A real reload also resets main.js; return its VM state to lobby here.
    getElement('restart-btn').dispatchEvent({type:'click'});
  });
  await check('HUD stamina/map/fire mode agree with gameplay; semi guns fire once per press', async () => {
    await raid('scout'); hud.updateHUD(api.player, null, null); assert.equal(getElement('stamina-text').innerText, '100%');
    await raid('heavy'); hud.updateHUD(api.player, null, null); assert.equal(getElement('stamina-text').innerText, '100%');
    await raid('sniper'); hud.updateHUD(api.player,null,null); assert.equal(getElement('fire-mode').innerText, '半自动');
    assert.equal(getElement('mission-title').innerText, '区域：' + api.player.mapName);
    window.dispatchEvent({type:'mousedown',button:0,target:getElement('gameCanvas')});
    assert.equal(input.mouse.justPressed, true); assert.equal(api.raidState, 'inRaid');
    step(2.5); assert.equal(api.player.gun.currentAmmo, 9);
    window.dispatchEvent({type:'mouseup',button:0}); window.dispatchEvent({type:'mousedown',button:0,target:getElement('gameCanvas')}); api.update(0.1); assert.equal(api.player.gun.currentAmmo, 8);
  });
  const output = {date:'2026-10-02',methodology:'Real ES modules in isolated VM; DOM, storage, audio, renderer and scheduler are doubles. Controlled game steps are <= 0.1 seconds.',passed:results.filter(x=>x.passed).length,total:results.length,results};
  fs.writeFileSync(path.join(__dirname,'client-regression-results.json'),JSON.stringify(output,null,2));
  console.log(`${output.passed}/${output.total} checks passed`);
  if (output.passed !== output.total) process.exitCode = 1;
})().catch(error => {console.error(error); process.exitCode = 1;});
