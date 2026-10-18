// Execute real game, economy, HUD and lobby modules. Only Canvas rendering,
// sound, browser DOM/storage and the animation scheduler are test doubles.
// No production exports are added: state access exists in this VM copy only.
// Run from the repository root:
// node --experimental-vm-modules docs/fixes-2026-10-02/client-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
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
  const el = surface({id, tagName: 'DIV', style: {setProperty(name,value){this[name]=value;}}, dataset: {}, children: [],
    value: id === 'map-select' ? 'maps/factory_01.json' : '', width: 1280, height: 720,
    disabled: false, className: '', innerText: '', textContent: '',
    classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      toggle(x, force) { const yes = force ?? !classes.has(x); if (yes) classes.add(x); else classes.delete(x); return yes; }},
    setAttribute(key,value) { this[key] = value; }, removeAttribute(key) { delete this[key]; },
    remove() { this.parentElement?.removeChild(this); },
    append(...nodes) { for (const node of nodes) this.appendChild(node); },
    appendChild(x) { x.parentElement = this; this.children.push(x); return x; },
    removeChild(x) { this.children.splice(this.children.indexOf(x), 1); x.parentElement = null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || element(selector); },
    querySelectorAll(selector) { return this.children.filter(x => selector.startsWith('.') && x.className.split(' ').includes(selector.slice(1))); },
    getContext() { return {}; }, focus() {}, closest() { return null; }
  });
  let text = '';
  for (const key of ['innerText','textContent']) Object.defineProperty(el,key,{get:()=>text,set:v=>{text=String(v);}});
  let markup = '';
  Object.defineProperty(el, 'innerHTML', {get: () => markup, set(value) { markup = value; this.children = []; }});
  return el;
}
function getElement(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); }
const document = surface({getElementById: getElement, createElement: () => element(), hidden: false, documentElement: element(), querySelectorAll: () => [], querySelector: () => null});
const window = surface({innerWidth: 1280, innerHeight: 720});
const context = vm.createContext({console, Math, Date, performance: {now: () => 0},
  matchMedia: () => ({matches:true}), queueMicrotask, location: { reload() {} },
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
        initWorld, finishRaid, update, interactTarget, useMedkit, throwGrenade, fireWeapon, secureLoot, togglePause, equipRaidItem, unequipRaidItem, useRepair, rotateInventoryItem, organizeInventory,
        get grenades() {return grenades}, get isPaused() {return isPaused},
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
  async function deploy() {
    if (['dead','extracted'].includes(api.raidState)) getElement('restart-btn').dispatchEvent({type:'click'});
    return api.initWorld();
  }
  function item(id) { return {...JSON.parse(fs.readFileSync(path.join(client, 'data/loot.json'), 'utf8')).find(x => x.id === id), id}; }
  async function raid(op = 'tactical', equipped = [], map = 'maps/factory_01.json') {
    if (api.raidState === 'inRaid') api.finishRaid(false);
    economy.resetProfile(); economy.setMaxEquipSlots(ops.getOperatorDef(op).maxSlots);
    economy.getProfile().equipped = equipped.map(item);
    getElement('map-select').value = map; api.op(op);
    assert.equal(await deploy(), true);
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
  await check('B02: loot stored once; no fixed bonus; valuables sell at listed value', async () => {
    await raid('tactical', ['weapon_ak47', 'keycard_red', 'medkit']);
    api.giveLoot(api.newLoot(0, 0, 'gem')); const raidId = api.activeRaidId;
    api.finishRaid(true);
    assert.equal(economy.getCoins(), 50000); assert.equal(api.player.coins, 50000);
    assert.equal(economy.getStash().length, 1);
    assert.deepEqual(Array.from(economy.getEquipped(), x => x.id).sort(), ['keycard_red','medkit','weapon_ak47']);
    api.finishRaid(true); api.update(0.1); assert.equal(economy.getCoins(), 50000);
    assert.equal(economy.settleRaid(raidId, true), false);
    assert.equal(economy.sellStashItem(0), 35000); assert.equal(economy.getCoins(), 85000);
    assert.match(getElement('result-desc').innerText, /存入仓库/);
  });
  await check('B03: lethal hit on last extraction frame produces only death', async () => {
    await raid('tactical', ['keycard_red']); api.player.x = 100; api.player.y = 100;
    api.player.hp = 1; api.player.armor = 0; api.player.isExtracting = true; api.player.extractTimer = 0.01;
    const bot = new entities.Bot(110, 100, {hp: 80, damage: 20, attackRange: 60});
    Object.assign(bot, {state: 'aggro', reactionDelay: 0, aiTickTimer: 100, targetX: 110, targetY: 100, fireCooldown: 0});
    api.state({bots: [bot], extractions: [{x: 50,y: 50,w: 100,h: 100}]}); api.update(0.02);
    assert.equal(api.raidState, 'dead'); assert.equal(getElement('result-title').innerText, '行动失败');
    assert.equal(economy.getCoins(), 50000); assert.equal(economy.getEquipped().length, 0);
    step(1); assert.equal(economy.getCoins(), 50000);
  });
  await check('B04: editing, repeated actions, blur, visibility and UI mouse clicks', async () => {
    await raid('tactical', ['grenade', 'medkit']); api.player.hp = 30;
    assert.equal(key('KeyG', {target: {tagName: 'INPUT'}}).prevented, undefined);
    assert.equal(api.player.grenadeCount, 1);
    key('Digit4', {repeat: true}); assert.equal(api.player.medkitCount, 1);
    key('KeyW'); assert.equal(input.keys.w, true); window.dispatchEvent({type: 'blur'}); assert.equal(input.keys.w, false);
    key('KeyW'); document.hidden = true; document.dispatchEvent({type: 'visibilitychange'}); assert.equal(input.keys.w, false); document.hidden = false; api.togglePause(false);
    key('KeyW'); window.dispatchEvent({type: 'focusin', target: {tagName: 'TEXTAREA'}}); assert.equal(input.keys.w, false);
    window.dispatchEvent({type: 'mousedown', button: 0, target: getElement('nearby-loot-panel')}); assert.equal(input.mouse.isDown, false);
    window.dispatchEvent({type: 'mousedown', button: 0, target: getElement('gameCanvas')}); assert.equal(input.mouse.isDown, true);
    api.finishRaid(false); assert.equal(input.mouse.isDown, false); assert.equal(key('Tab').prevented, undefined);
  });
  await check('B05: timed medicines heal by definition and consume one instance after completion', async () => {
    await raid('heavy', ['medkit_large','injector']); api.player.hp=1; api.useMedkit();
    assert.equal(api.player.hp,1); assert.equal(api.player.medkitCount,2); step(5.1);
    assert.equal(api.player.hp,100); assert.equal(api.player.medkitCount,1);
    api.player.hp=50; api.useMedkit(api.player.inventory[0].id); step(2.1);
    assert.equal(api.player.hp,80); assert.equal(api.player.medkitCount,0);
    api.finishRaid(true); assert.equal(economy.getEquipped().length,0);
    await raid('heavy'); api.player.hp=1; const med=ground('medkit'); api.interactTarget();
    assert.equal(api.player.hp,1); assert.equal(api.player.medkitCount,1);
    hud.refreshInventoryGrid(api.player);
    document.dispatchEvent({type:'use-medicine',detail:med.id});
    step(3.1); assert.equal(api.player.hp,51); assert(!api.player.inventory.includes(med));
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
    api.finishRaid(false); economy.resetProfile(); assert.equal(await deploy(), true);
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
  await check('B11: lobby grid capacity follows one backpack; overload and stash pagination remain usable', async () => {
    api.finishRaid(false); economy.resetProfile(); economy.setMaxEquipSlots(24);
    economy.getProfile().stash=[item('backpack'),item('backpack'),item('gem')];ui.showStartScreen();
    getElement('stash-grid').querySelectorAll('.stash-item')[0].dispatchEvent({type:'click'});getElement('stash-equip-selected').onclick();
    assert.equal(economy.getMaxEquipSlots(),36);assert.match(getElement('equip-capacity-text').innerText,/36/);
    assert.equal(economy.equipItem(0),false);assert.equal(economy.equipItem(1),false);
    getElement('lobby-gear-grid').children[3].querySelectorAll('.stash-item')[0].dispatchEvent({type:'click'});
    assert.equal(economy.getMaxEquipSlots(),24);
    economy.getProfile().equipped=Array.from({length:7},()=>item('medkit_large'));ui.refreshLobbyUI();
    assert.equal(getElement('deploy-btn').disabled,true);assert.throws(()=>economy.beginRaid('overload'),/格位/);
    economy.unequipItem(0);ui.refreshLobbyUI();assert.equal(getElement('deploy-btn').disabled,false);
    economy.getProfile().stash=Array.from({length:70},()=>item('gem'));ui.refreshLobbyUI();
    const seen=new Set();
    for(let page=0;page<5;page++){
      for(const button of getElement('stash-grid').querySelectorAll('.stash-item'))seen.add(Number(button.dataset.index));
      const buttons=getElement('stash-page-controls').children;
      if(page<4)buttons.at(-1).dispatchEvent({type:'click'});
    }
    assert.equal(seen.size,70);
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
    assert.match(getElement('map-select').value, /^imported-/); assert.equal(await deploy(), true);
    assert.equal(api.worldWidth, 6400); assert.equal(api.player.mapName, '自制宽地图');
  });
  await check('failed map/weapon loading preserves reserved assets and returns to lobby', async () => {
    api.finishRaid(false); economy.resetProfile(); economy.getProfile().equipped = [item('keycard_red')];
    getElement('map-select').value = 'missing.json'; assert.equal(await deploy(), false);
    assert.equal(api.raidState, 'lobby'); assert.equal(economy.getEquipped().length, 1); assert.equal(economy.getProfile().activeRaid, null);
    getElement('map-select').value = 'maps/factory_01.json'; economy.getProfile().equipped = [{id:'weapon_missing'}];
    assert.equal(await deploy(), false); assert.equal(economy.getEquipped()[0].id, 'weapon_missing');
  });
  await check('profile reload forfeits unfinished raid; settlement failures can retry once', async () => {
    await raid('tactical', ['keycard_red']); api.giveLoot(api.newLoot(0,0,'gem'));
    storageFails = true; api.finishRaid(true); assert.equal(api.raidState, 'settlementPending'); assert.equal(economy.getCoins(), 50000);
    assert.equal(getElement('restart-btn').innerText, '重试保存'); api.update(0.1); assert.equal(economy.getCoins(), 50000);
    storageFails = false; getElement('restart-btn').dispatchEvent({type:'click'});
    assert.equal(api.raidState, 'extracted'); assert.equal(economy.getCoins(), 50000); assert.equal(economy.getStash().length, 1);
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

  await check('MVP: configured loot points produce one pickable item and no implicit bots when disabled', async () => {
    const testMap={name:'Loot test',width:8,height:8,tileSize:64,botCount:0,tiles:Array.from({length:8},()=>Array(8).fill(0)),spawns:[{x:1,y:1,team:'pmc'}],lootPoints:[{x:1,y:1,type:'gem'}],extractions:[{x:5,y:5,w:2,h:2}]};
    const world=maploader.buildWorldFromMap(testMap);assert.equal(world.loots.length,1);assert.equal(world.loots[0].type,'gem');assert.equal(world.bots.length,0);
    fixtureMaps.set('loot-test.json',testMap);await raid('tactical',[],'loot-test.json');
    // raid helper clears entities; redeploy with the real fixture for ownership checks.
    api.finishRaid(false);assert(await deploy());assert.equal(api.loots.length,1);assert.equal(api.loots[0].raidId,api.activeRaidId);
  });
  await check('MVP: searches regenerate stamina and movement interrupts on the same frame', async () => {
    await raid(); const c=container(); api.player.stamina=10; api.interactTarget(); step(1);
    assert(api.player.stamina>40); assert(c.isSearching);
    const x=api.player.x; input.keys.d=true; api.update(0.1);
    assert(!c.isSearching); assert(api.player.x>x); input.resetInput();
  });
  await check('MVP: healing cancels without consuming on movement, fire, reload, or hit', async () => {
    await raid('tactical',['medkit']); api.player.hp=20;
    const med=api.player.inventory[0]; api.useMedkit(); step(1); input.keys.d=true; api.update(0.1); input.resetInput();
    assert.equal(api.player.action,null); assert(api.player.inventory.includes(med)); assert.equal(api.player.hp,20);
    api.useMedkit(); api.fireWeapon(); assert.equal(api.player.action,null);
    api.useMedkit(); api.reloadWeapon(); assert.equal(api.player.action,null);
    step(3); api.useMedkit(); const bot=new entities.Bot(api.player.x+10,api.player.y,{damage:1,attackRange:100});
    Object.assign(bot,{state:'aggro',hasVisualContact:true,reactionDelay:0,aiTickTimer:100,targetX:bot.x,targetY:bot.y});
    api.state({bots:[bot]}); api.update(0.1); assert.equal(api.player.action,null); assert(api.player.inventory.includes(med));
  });
  await check('MVP: protected 2x2 grid survives defeat, refresh, and retry without duplicates', async () => {
    await raid(); const gem=api.newLoot(0,0,'gem'), cash=api.newLoot(0,0,'cash');
    api.giveLoot(gem); api.giveLoot(cash); api.secureLoot(gem.id); api.secureLoot(cash.id);
    assert.equal(api.player.secureInventory.length,2); assert.equal(api.player.inventory.length,0);
    api.giveLoot(api.newLoot(0,0,'box')); api.secureLoot(api.player.inventory[0].id); assert.equal(api.player.secureInventory.length,2);
    api.finishRaid(false); assert.deepEqual(Array.from(economy.getStash(),x=>x.id).sort(),['cash','gem']);
    await raid(); const protectedGem=api.newLoot(0,0,'gem'); api.giveLoot(protectedGem);
    storageFails=true; api.secureLoot(protectedGem.id); assert.equal(api.player.secureInventory.length,0);
    storageFails=false; api.secureLoot(protectedGem.id); economy.loadProfile();
    assert.equal(economy.getStash().length,1); assert.equal(economy.getStash()[0].id,'gem');
    economy.loadProfile(); assert.equal(economy.getStash().length,1);
    getElement('restart-btn').dispatchEvent({type:'click'});
  });
  await check('MVP: grenades fly, collide, explode after fuse, and can damage the thrower', async () => {
    await raid('tactical',['grenade']); input.mouse.worldX=api.player.x; input.mouse.worldY=api.player.y;
    api.throwGrenade(); assert.equal(api.grenades.length,1); assert.equal(api.player.hp,100);
    step(1.5); assert.equal(api.player.hp,100); step(0.15);
    assert.equal(api.grenades.length,0); assert.equal(api.raidState,'dead');
  });
  await check('MVP: range, armor, and durability participate in actual gunfire', async () => {
    await raid('tactical',['weapon_mp5']);
    api.player.x=100; api.player.y=100; input.mouse.worldX=1000; input.mouse.worldY=100;
    const near=new entities.Bot(300,100,{hp:100,armor:100,armorClass:5});
    const far=new entities.Bot(1100,100,{hp:100});
    api.state({bots:[near,far]}); api.fireWeapon();
    assert(near.hp<100 && near.hp>90); assert(near.armor<100); assert.equal(far.hp,100);
    api.state({bots:[far]}); api.player.gun.cooldown=0; api.fireWeapon(); assert.equal(far.hp,100);
    await raid('heavy',['armor_light']); assert.equal(api.player.armor,120); assert.equal(api.player.armorClass,2);
    api.player.armor=37.5; api.finishRaid(true); assert.equal(economy.getEquipped()[0].durability,37);
    getElement('restart-btn').dispatchEvent({type:'click'}); assert(await api.initWorld()); assert.equal(api.player.armor,37);
  });
  await check('MVP: pause freezes world timers and prevents deployment; resume clears held input', async () => {
    await raid(); input.keys.d=true; const x=api.player.x,t=api.player.raidTimeRemaining;
    api.togglePause(true); step(20); assert.equal(api.player.x,x); assert.equal(api.player.raidTimeRemaining,t);
    assert.equal(await api.initWorld(),false); assert.equal(input.keys.d,false); api.togglePause(false); step(1);
    assert(api.player.raidTimeRemaining<t);
  });
  await check('MVP: paid exit debits exactly once, insufficient funds reject, timeout wins ties', async () => {
    await raid(); const p=api.player;
    const exit={x:p.x-50,y:p.y-50,w:100,h:100,condition:'paid',cost:3000,duration:1};
    api.state({extractions:[exit]}); step(1.1); assert.equal(api.raidState,'extracted'); assert.equal(economy.getCoins(),47000);
    api.finishRaid(true); assert.equal(economy.getCoins(),47000);
    await raid(); economy.getProfile().coins=2000; api.state({extractions:[{...exit,x:api.player.x-50,y:api.player.y-50}]});
    step(2); assert.equal(api.raidState,'inRaid'); assert.equal(api.player.isExtracting,false);
    api.player.raidElapsed=599.99; api.update(0.1); assert.equal(api.player.raidOutcome,'timeout');
    assert.equal(api.raidState,'dead'); assert.equal(economy.getCoins(),2000);
  });


  await check('V2: picked guns equip into fixed slots without farming basic gear or reserve ammo',async()=>{
    await raid();const gun=api.newLoot(0,0,'weapon_mp5');api.giveLoot(gun);
    const reserve=api.player.ammoReserves['9mm'];assert(api.equipRaidItem({id:gun.id,slot:0}));
    assert.equal(api.player.inventory.length,0);assert.equal(api.player.gun.id,'weapon_mp5');
    api.player.gun.currentAmmo=0;api.player.gun.cooldown=0.7;
    assert(api.unequipRaidItem({slot:0}));assert.equal(api.player.gun.id,'unarmed');
    api.fireWeapon();assert.equal(api.player.gun.currentAmmo,0);
    assert.equal(api.player.inventory[0].weaponState.currentAmmo,0);
    assert(api.equipRaidItem({id:api.player.inventory[0].id,slot:1}));
    assert.equal(api.player.gun.currentAmmo,0);assert.equal(api.player.gun.cooldown,0.7);
    assert.equal(api.player.ammoReserves['9mm'],reserve);assert.equal(api.player.loadoutGear.length,1);
    assert.equal(api.unequipRaidItem({slot:0}),false);
  });
  await check('V2: armor swaps preserve damaged durability and equipping failure is atomic',async()=>{
    await raid('tactical',['armor_heavy']);api.player.armor=45;
    const light=api.newLoot(0,0,'armor_light');light.durability=17;api.giveLoot(light);
    assert(api.equipRaidItem({id:light.id,slot:'armor'}));assert.equal(api.player.armor,17);assert.equal(api.player.armorClass,2);
    const heavy=api.player.inventory.find(i=>i.type==='armor_heavy');assert.equal(heavy.durability,45);
    assert(api.equipRaidItem({id:heavy.id,slot:'armor'}));assert.equal(api.player.armor,45);
    api.finishRaid(true);assert.equal(economy.getEquipped().filter(i=>i.id==='armor_heavy').length,1);
    await raid('tactical',['weapon_sniper']);
    const small=api.newLoot(0,0,'weapon_mp5');api.giveLoot(small);
    while(api.giveLoot(api.newLoot(0,0,'cash'))) {}
    const before=JSON.stringify({bag:api.player.inventory,gear:api.player.loadoutGear,gun:api.player.gun});
    assert.equal(api.equipRaidItem({id:small.id,slot:0}),false);
    assert.equal(JSON.stringify({bag:api.player.inventory,gear:api.player.loadoutGear,gun:api.player.gun}),before);
  });
  await check('V2: four repair kits restore configured amounts only after completing and never overfill',async()=>{
    for(const [id,amount,time] of [['repair_improvised',40,8],['repair_standard',80,7],['repair_precision',120,6],['repair_advanced',180,5]]) {
      await raid('heavy',['armor_heavy',id]);api.player.armor=0;
      const kit=api.player.inventory.find(i=>i.type===id);api.useRepair(kit.id);
      step(time-0.1);assert.equal(api.player.armor,0);assert(api.player.inventory.includes(kit));
      step(0.2);assert.equal(api.player.armor,amount);assert(!api.player.inventory.includes(kit));
      assert.equal(api.player.loadoutGear.find(i=>i.id==='armor_heavy').durability,amount);
    }
    await raid('tactical',['armor_light','repair_advanced']);api.player.armor=119;
    const kit=api.player.inventory[0];api.useRepair(kit.id);step(5.1);assert.equal(api.player.armor,120);
  });
  await check('V2: repair interruption consumes nothing and never repairs a replacement of the same type',async()=>{
    await raid('tactical',['armor_light','repair_standard']);api.player.armor=10;
    const kit=api.player.inventory[0];api.useRepair(kit.id);step(1);input.keys.d=true;api.update(0.1);input.resetInput();
    assert.equal(api.player.action,null);assert(api.player.inventory.includes(kit));assert.equal(api.player.armor,10);
    api.useRepair(kit.id);
    const replacement=api.newLoot(0,0,'armor_light');replacement.durability=30;api.giveLoot(replacement);
    assert(api.equipRaidItem({id:replacement.id,slot:'armor'}));assert.equal(api.player.action,null);
    step(8);assert.equal(api.player.armor,30);assert(api.player.inventory.includes(kit));
    api.useRepair(kit.id);api.togglePause(true);step(20);assert.equal(api.player.armor,30);
    api.togglePause(false);step(7.1);assert.equal(api.player.armor,110);
  });
  await check('V2: big footprints, 2x2 protection and backpack shrink respect geometry',async()=>{
    await raid();const wide=api.newLoot(0,0,'cash');wide.gridW=3;wide.gridH=1;
    assert(api.giveLoot(wide));api.secureLoot(wide.id);assert.equal(api.player.secureInventory.length,0);assert(api.player.inventory.includes(wide));
    const huge=api.newLoot(0,0,'portable_generator');assert(api.giveLoot(huge));
    const usage=ns('inventory').inventoryUsage(api.player.inventory);assert(usage>=15);
    assert(api.rotateInventoryItem(wide.id)!==false);assert(api.player.inventory.includes(wide));
    await raid('scout',['backpack']);
    while(api.giveLoot(api.newLoot(0,0,'cash'))) {}
    const before=JSON.stringify(api.player.inventory);assert.equal(api.unequipRaidItem({slot:'backpack'}),false);
    assert.equal(JSON.stringify(api.player.inventory),before);assert.equal(api.player.maxSlots,36);
  });
  await check('V2: container pickup retains real weapon magazine and armor durability metadata',async()=>{
    await raid();const c=container();c.isOpen=true;
    c.spawnedLoot=[{type:'weapon_mp5',weaponState:{currentAmmo:3,cooldown:0.4},gridW:2,gridH:3},{type:'armor_light',durability:7,maxDurability:120}];
    api.showContainerLoot(c);api.pickFromContainer(0);api.pickFromContainer(0);
    const gun=api.player.inventory.find(i=>i.type==='weapon_mp5'),armor=api.player.inventory.find(i=>i.type==='armor_light');
    assert(api.equipRaidItem({id:gun.id,slot:0}));assert.equal(api.player.gun.currentAmmo,3);
    assert(api.equipRaidItem({id:armor.id,slot:'armor'}));assert.equal(api.player.armor,7);
    api.finishRaid(true);
    const savedGun=economy.getEquipped().find(i=>i.id==='weapon_mp5');assert.equal(savedGun.weaponState.currentAmmo,3);
    assert.equal(economy.getEquipped().find(i=>i.id==='armor_light').durability,7);
    assert(economy.getProfile().stats.bestHaul>0);
  });
  await check('V2: paused and settled events cannot equip, unequip or start repairs',async()=>{
    await raid('tactical',['armor_light','repair_standard']);api.player.armor=10;
    const gun=api.newLoot(0,0,'weapon_mp5');api.giveLoot(gun);api.togglePause(true);
    assert.equal(api.equipRaidItem({id:gun.id}),false);assert.equal(api.unequipRaidItem({slot:'armor'}),false);
    api.useRepair(api.player.inventory.find(i=>i.type==='repair_standard').id);assert.equal(api.player.action,null);
    api.togglePause(false);api.finishRaid(false);assert.equal(api.equipRaidItem({id:gun.id}),false);
  });

  const output = {date:'2026-10-18',revision:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),methodology:'Real ES modules in isolated VM; DOM, storage, audio, renderer and scheduler are doubles. Controlled game steps are <= 0.1 seconds.',passed:results.filter(x=>x.passed).length,total:results.length,results};
  fs.writeFileSync(path.join(root,'docs/mvp/game-results.json'),JSON.stringify(output,null,2));
  console.log(`${output.passed}/${output.total} checks passed`);
  if (output.passed !== output.total) process.exitCode = 1;
})().catch(error => {console.error(error); process.exitCode = 1;});
