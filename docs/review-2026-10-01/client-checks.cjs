// Read-only audit harness: production modules execute in a VM with fake DOM,
// localStorage and sounds. Only an in-memory copy of main.js exposes its state.
// Run: node --experimental-vm-modules docs/review-2026-10-01/client-checks.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const client = path.join(root, 'client');
const elements = new Map();
const notifications = [];
const outcomes = [];
const handlers = new Map();
const storage = new Map();
function element(id = '') {
  const classes = new Set(['hidden']);
  return {
    id, innerText: '', innerHTML: '', style: {}, dataset: {}, children: [],
    value: id === 'map-select' ? 'maps/factory_01.json' : '',
    width: 1280, height: 720, disabled: false,
    classList: {add: x => classes.add(x), remove: x => classes.delete(x),
      contains: x => classes.has(x), toggle: x => classes.has(x) ? classes.delete(x) : classes.add(x)},
    appendChild(x) { this.children.push(x); }, addEventListener() {},
    querySelector() { return element(); }, querySelectorAll() { return []; },
    getContext() { return {}; }
  };
}
function getElement(id) {
  if (!elements.has(id)) elements.set(id, element(id));
  return elements.get(id);
}
const hud = new Proxy({}, { get: (_, key) => getElement(String(key)) });
const context = vm.createContext({
  console: {log() {}, warn() {}, error: console.error}, Math, Date,
  performance: {now: () => 0}, setTimeout: () => 0, requestAnimationFrame: () => 0,
  localStorage: {getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
  document: {getElementById: getElement, createElement: () => element()},
  Event: class { constructor(type) { this.type = type; } },
  window: {innerWidth: 1280, innerHeight: 720,
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    dispatchEvent(e) { for (const fn of handlers.get(e.type) || []) fn(e); }},
  fetch: async file => {
    const name = path.resolve(client, file);
    const ok = fs.existsSync(name);
    return {ok, status: ok ? 200 : 404, json: async () => JSON.parse(fs.readFileSync(name, 'utf8'))};
  }
});
const stubs = {
  'renderer.js': {render() {}},
  'sound.js': Object.fromEntries(['playShootSound','playHitSound','playPickupSound','playExtractionBeep','playEnemyShootSound','playGrenadeSound'].map(k => [k, () => {}])),
  'hud.js': {initHUD: () => hud, updateHUD() {}, refreshInventoryGrid() {},
    pushNotification: text => notifications.push(text), getElements: () => hud},
  'ui.js': {showStartScreen() {}, hideStartScreen() {}, onDeploy() {}, onRestart() {},
    showLoginScreen() {}, onLogin() {}, initShopUI() {},
    showGameOver: () => outcomes.push({type: 'death'}),
    showVictory: (_, total, bonus) => outcomes.push({type: 'victory', total, bonus})}
};
const modules = new Map();
function moduleFor(file) {
  if (modules.has(file)) return modules.get(file);
  const basename = path.basename(file);
  let mod;
  if (stubs[basename]) {
    const values = stubs[basename];
    mod = new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, {context, identifier: file});
  } else {
    let source = fs.readFileSync(file, 'utf8');
    if (basename === 'main.js') source += `
      export const audit = {
        initWorld, update, interactTarget, useMedkit, reloadWeapon, switchWeapon,
        pickNearbyItem, refreshNearbyPanel, showContainerLoot, pickFromContainer,
        initOperatorPicker,
        get player() {return player}, get containers() {return containers},
        get weaponSlots() {return weaponSlots}, get loots() {return loots},
        get nearestLoot() {return nearestLoot}, get viewingContainer() {return viewingContainer},
        op(id) {selectedOpId = id},
        state(s) {
          if ('bots' in s) bots = s.bots;
          if ('walls' in s) walls = s.walls;
          if ('loots' in s) loots = s.loots;
          if ('containers' in s) containers = s.containers;
          if ('extractions' in s) extractions = s.extractions;
          if ('isGameOver' in s) isGameOver = s.isGameOver;
          if ('gameStarted' in s) gameStarted = s.gameStarted;
          if ('nearestLoot' in s) nearestLoot = s.nearestLoot;
          if ('nearestContainer' in s) nearestContainer = s.nearestContainer;
        }
      };`;
    mod = new vm.SourceTextModule(source, {context, identifier: file});
  }
  modules.set(file, mod);
  return mod;
}
const results = [];
function finding(id, observed) { results.push({id, observed}); }
(async () => {
  const main = moduleFor(path.join(client, 'js/main.js'));
  await main.link((specifier, referencing) => moduleFor(path.resolve(path.dirname(referencing.identifier), specifier)));
  await main.evaluate();
  await new Promise(setImmediate);
  const api = main.namespace.audit;
  const economy = modules.get(path.join(client, 'js/economy.js')).namespace;
  const entities = modules.get(path.join(client, 'js/entities.js')).namespace;
  const input = modules.get(path.join(client, 'js/input.js')).namespace;
  const ops = modules.get(path.join(client, 'js/operatordata.js')).namespace;
  const shop = modules.get(path.join(client, 'js/shopdata.js')).namespace;
  async function raid(op = 'tactical', equipped = []) {
    economy.resetProfile();
    economy.getProfile().equipped = equipped.map(id => ({id, emoji:'📦', name:id, value:100}));
    api.op(op); await api.initWorld();
    api.state({bots:[], walls:[], containers:[], loots:[], extractions:[]});
    input.mouse.isDown = false;
    for (const key of Object.keys(input.keys)) input.keys[key] = false;
  }
  await raid('tactical', ['keycard_red']);
  const safe = new entities.LootContainer(api.player.x, api.player.y, 'safe');
  api.state({nearestContainer:safe}); api.interactTarget();
  finding('keys-equipped-not-usable', {equipped:economy.getEquipped().map(x=>x.id), searching:safe.isSearching, notice:notifications.at(-1)});

  await raid();
  const gem = new entities.Loot(100, 100, 'gem');
  entities.applyLootData(gem, {emoji:'💎', name:'蓝钻', value:35000});
  api.player.inventory.push(gem);
  api.player.x=100; api.player.y=100; api.player.isExtracting=true; api.player.extractTimer=0.01;
  api.state({extractions:[{x:50,y:50,w:100,h:100}]});
  api.update(0.02);
  const afterExtraction=economy.getCoins();
  const resold=economy.sellStashItem(0);
  finding('extraction-double-value', {start:50000, afterExtraction, resold, afterResale:economy.getCoins(), outcome:outcomes.at(-1)});

  await raid('tactical', ['medkit_large', 'injector']);
  api.player.hp=1; api.useMedkit();
  finding('consumable-effects', {largeMedkitHeal:api.player.hp-1, medkitCount:api.player.medkitCount, remaining:economy.getEquipped().map(x=>x.id)});

  await raid('tactical', ['ammo_9mm']);
  finding('default-weapon-no-ammo-type', {ammoType:api.player.gun.ammoType ?? null, reserve:api.player.gun.maxAmmo, expectedReserve:240});
  await raid('tactical', ['weapon_ak47','ammo_rifle']);
  finding('rifle-ammo-amount', {reserve:api.player.gun.maxAmmo, expected:90+90});
  await raid('tactical', ['weapon_shotgun','weapon_ak47','ammo_rifle']);
  api.switchWeapon(1);
  finding('secondary-ammo-ignored', {reserve:api.player.gun.maxAmmo, expected:90+90});

  await raid('tactical', ['weapon_ak47','weapon_shotgun']);
  api.player.gun.currentAmmo=0; api.reloadWeapon(); for(let i=0;i<19;i++) api.update(0.1); api.switchWeapon(1); api.player.gun.currentAmmo=0;
  const inheritedTimer=api.player.gun.reloadTimer;
  api.update(0.06); api.update(0.05);
  finding('reload-shared-between-weapons', {inheritedTimer, shotgunAmmo:api.player.gun.currentAmmo, shotgunReloadTime:api.player.gun.reloadTime});

  await raid('medic'); api.player.hp=50;
  for(let i=0;i<100;i++) api.update(0.1);
  finding('medic-passive', {hpAfterTenSeconds:api.player.hp, configuredValue:ops.getOperatorDef('medic').passiveValue});
  await raid('engineer');
  const cabinet = new entities.LootContainer(api.player.x,api.player.y,'filing_cabinet');
  api.state({nearestContainer:cabinet}); api.interactTarget();
  finding('engineer-passive', {searchDuration:cabinet.searchTimer, configuredMultiplier:ops.getOperatorDef('engineer').passiveValue});
  await raid('sniper'); api.update(0.1);
  finding('sniper-passive', {spread:api.player.spread, configuredMultiplier:ops.getOperatorDef('sniper').passiveValue});

  await raid();
  const bp = new entities.Loot(api.player.x,api.player.y,'backpack');
  api.state({loots:[bp],nearestLoot:bp}); api.interactTarget(); api.interactTarget();
  finding('backpack-search-bypass-F', {inventory:api.player.inventory.map(x=>x.type), worldLoot:api.loots.length, searchTimer:bp.searchTimer});
  await raid();
  const bp2 = new entities.Loot(api.player.x,api.player.y,'backpack');
  api.state({loots:[bp2]}); api.refreshNearbyPanel(); api.pickNearbyItem(0);
  finding('backpack-search-bypass-H', {inventory:api.player.inventory.map(x=>x.type), searched:bp2.isSearching});

  await raid();
  const container=new entities.LootContainer(api.player.x,api.player.y,'wardrobe');
  container.isOpen=true; container.spawnedLoot.push({type:'gem',emoji:'💎',name:'蓝钻',value:35000});
  api.showContainerLoot(container); api.player.x += 1000; api.pickFromContainer(0);
  finding('container-pick-no-distance-check', {distance:1000, picked:api.player.inventory.length});
  container.spawnedLoot.push({type:'cash',emoji:'💵',name:'现金',value:5000});
  api.showContainerLoot(container); await api.initWorld(); api.pickFromContainer(0);
  finding('old-container-survives-new-raid', {oldContainerStillReferenced:api.viewingContainer===container, newRaidInventory:api.player.inventory.map(x=>x.type)});

  await raid(); api.player.x=100; api.player.y=100;
  api.player.isExtracting=true; api.player.extractTimer=0.01; api.player.hp=1; api.player.armor=0;
  const bot=new entities.Bot(110,100,{hp:80,damage:20,attackRange:60});
  bot.state='aggro'; bot.reactionDelay=0; bot.aiTickTimer=100; bot.targetX=110;bot.targetY=100;bot.fireCooldown=0;
  api.state({bots:[bot], extractions:[{x:50,y:50,w:100,h:100}]});
  const prior=outcomes.length; api.update(0.02);
  finding('death-and-victory-same-frame', {hp:api.player.hp, outcomes:outcomes.slice(prior), coins:economy.getCoins()});

  await raid();
  const grenade = new entities.Loot(api.player.x,api.player.y,'grenade');
  api.state({loots:[grenade], nearestLoot:grenade}); api.interactTarget();
  finding('picked-grenade-unusable', {inventory:api.player.inventory.map(x=>x.type), usableGrenades:api.player.grenadeCount});

  const evt={type:'keydown',code:'KeyG',key:'g',target:{tagName:'INPUT'},preventDefault(){this.prevented=true;}};
  const beforeInput=notifications.length; context.window.dispatchEvent(evt);
  finding('input-field-shortcuts', {prevented:evt.prevented===true, gameNotice:notifications.slice(beforeInput)});
  context.window.dispatchEvent({type:'keydown',code:'KeyW',key:'w',preventDefault(){}});
  context.window.dispatchEvent({type:'blur'});
  finding('blur-stuck-key', {wAfterBlur:input.keys.w, blurHandlerCount:(handlers.get('blur')||[]).length});

  const physics=modules.get(path.join(client,'js/physics.js')).namespace;
  const maploader=modules.get(path.join(client,'js/maploader.js')).namespace;
  const constants=modules.get(path.join(client,'js/constants.js')).namespace;
  const custom=maploader.buildWorldFromMap({name:'wide-audit-map',width:100,height:50,tileSize:64,
    worldWidth:6400,worldHeight:3200,tiles:Array(50).fill(Array(100).fill('0').join(',')),
    spawns:[{x:70,y:10,team:'pmc'}],extractions:[{x:80,y:10,w:3,h:3}]});
  const customPlayer=new entities.Player();customPlayer.x=custom.spawnX;customPlayer.y=custom.spawnY;
  const beforeMove=customPlayer.x;
  physics.movePlayer(customPlayer,0.1,{d:true},custom.walls,constants.WORLD_WIDTH,constants.WORLD_HEIGHT);
  finding('custom-map-hardcoded-world-boundary',{mapWidth:6400,spawnX:beforeMove,afterMoveX:customPlayer.x,extractionX:custom.extractions[0].x});

  const json={date:'2026-10-01', methodology:'Production game modules in isolated VM; DOM, UI output, audio and animation are stubbed; controlled state is injected into an in-memory main.js copy. All simulated frame steps are at most 0.1 seconds.', results};
  fs.writeFileSync(path.join(__dirname,'client-results.json'),JSON.stringify(json,null,2));
  console.log(JSON.stringify(json,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
