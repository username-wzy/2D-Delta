const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let economy, shop, settings, storage, fail, failAt, writes, attempts;
global.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem(key,value) { attempts++; if (fail || attempts === failAt) throw new Error('QuotaExceededError'); storage.set(key,value); writes++; },
  removeItem: key => storage.delete(key)
};
global.fetch = async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname,'../client/data/shop.json'),'utf8')) });
test.before(async () => {
  economy = await import('../client/js/economy.js');
  shop = await import('../client/js/shopdata.js');
  settings = await import('../client/js/settings.js');
  await shop.loadShopData();
});
test.beforeEach(() => {
  storage = new Map(); fail = false; failAt = -1; attempts = writes = 0;
  economy.resetProfile(); economy.setMaxEquipSlots(12); attempts = writes = 0;
});
const disk = () => JSON.parse(storage.get(economy.STORAGE_KEY));
const item = id => ({ id, name:id, emoji:'📦', value: id==='gem'?35000:3000 });
test('new progress is anonymous and has no account/password API', () => {
  assert.equal(economy.getCoins(),50000);
  assert(!('username' in disk())); assert(!('passHash' in disk()));
  for(const name of ['setUsername','getUsername','setPassword','hasPassword','checkPassword']) assert(!(name in economy));
});
test('legacy progress migrates assets without carrying identity fields', () => {
  storage.delete(economy.STORAGE_KEY);
  storage.set('emoji_delta_profile',JSON.stringify({username:'old',passHash:'secret',coins:12345,stash:[item('gem')],equipped:[item('medkit')]}));
  economy.loadProfile();
  assert.equal(economy.getCoins(),12345); assert.equal(economy.getStash()[0].id,'gem');
  assert.equal(economy.getEquipped()[0].id,'medkit'); assert(!storage.has('emoji_delta_profile'));
  assert(!JSON.stringify(disk()).includes('secret')); assert(!('username' in disk()));
});
test('a failed purchase changes neither in-memory money/items nor stored progress', () => {
  const before=storage.get(economy.STORAGE_KEY); fail=true;
  assert.throws(()=>shop.buyItem(1),/保存失败/);
  assert.equal(economy.getCoins(),50000); assert.equal(economy.getStash().length,0);
  assert.equal(storage.get(economy.STORAGE_KEY),before); assert.equal(attempts,1);
});
test('a purchase is one durable write, so no second-write failure can lose the item', () => {
  failAt=2;
  assert(shop.buyItem(1).success);
  assert.equal(writes,1); assert.equal(attempts,1); assert.equal(disk().coins,38000);
  assert.equal(disk().stash[0].id,'weapon_ak47');
});
test('insufficient funds and invalid item indices are non-mutating', () => {
  economy.spendCoins(50000); attempts=writes=0;
  assert.equal(shop.buyItem(1).success,false);
  for(const index of [NaN,0.5,-1,Infinity,9999]) assert.equal(shop.buyItem(index).success,false);
  assert.equal(writes,0); assert.equal(economy.getCoins(),0);
});
test('failed batch equip is atomic; duplicate indices cannot equip an item twice', () => {
  economy.addToStash(item('weapon_ak47')); economy.addToStash(item('medkit'));
  const before=storage.get(economy.STORAGE_KEY); fail=true;
  assert.throws(()=>economy.equipItems([0,1,1]),/保存失败/);
  assert.equal(economy.getStash().length,2); assert.equal(economy.getEquipped().length,0);
  assert.equal(storage.get(economy.STORAGE_KEY),before); fail=false; attempts=writes=0;
  assert.equal(economy.equipItems([0,1,1]),2); assert.equal(writes,1);
});
test('failed selling or unequipping does not mutate memory or persisted items', () => {
  economy.addToStash(item('gem')); const before=storage.get(economy.STORAGE_KEY); fail=true;
  assert.throws(()=>economy.sellAllStash(),/保存失败/); assert.equal(economy.getStash().length,1);
  assert.equal(storage.get(economy.STORAGE_KEY),before);
  fail=false; economy.addToStash(item('medkit')); economy.equipItem(1); fail=true;
  assert.throws(()=>economy.unequipItem(0),/保存失败/); assert.equal(economy.getEquipped().length,1);
});
test('valuables sell at listed value, gear at forty percent', () => {
  assert.equal(economy.salePrice(item('gem')),35000);
  assert.equal(economy.salePrice(item('weapon_ak47')),1200);
  economy.addToStash(item('gem')); assert.equal(economy.sellAllStash(),35000); assert.equal(economy.getCoins(),85000);
});
test('deployment reserves gear atomically and blocks lobby transactions during a raid', () => {
  economy.addToStash(item('medkit')); economy.equipItem(0);
  fail=true; assert.throws(()=>economy.beginRaid('failed'),/保存失败/); assert.equal(economy.getEquipped().length,1);
  fail=false; economy.beginRaid('active');
  assert.equal(economy.getEquipped().length,0);
  assert.throws(()=>shop.buyItem(0),/行动期间/); assert.throws(()=>economy.addCoins(1),/行动期间/);
  assert(economy.cancelDeployment('active')); assert.equal(economy.getEquipped().length,1);
});
test('extraction stores loot once without minting a fixed bonus', () => {
  economy.beginRaid('r'); const loot={type:'gem',emoji:'💎',name:'钻石',value:35000};
  assert(economy.settleRaid('r',true,[],[loot],0,{kills:2,duration:30}));
  assert.equal(economy.getCoins(),50000); assert.equal(economy.getStash().length,1);
  assert.equal(economy.settleRaid('r',true,[],[loot]),false); assert.equal(economy.getProfile().stats.extracts,1);
  assert.equal(economy.getProfile().stats.kills,2);
});
test('paid extraction and its result are one retryable transaction', () => {
  economy.beginRaid('paid'); fail=true;
  assert.throws(()=>economy.settleRaid('paid',true,[],[],0,{extractionCost:3000}),/保存失败/);
  assert.equal(economy.getCoins(),50000); assert(economy.getProfile().activeRaid);
  fail=false; economy.settleRaid('paid',true,[],[],0,{extractionCost:3000});
  assert.equal(economy.getCoins(),47000); assert.equal(economy.getProfile().lastRaidResult.extractionCost,3000);
});
test('insufficient extraction funds leave the active raid available to try another exit', () => {
  economy.spendCoins(49000); economy.beginRaid('paid');
  assert.throws(()=>economy.settleRaid('paid',true,[],[],0,{extractionCost:3000}),/余额不足/);
  assert.equal(economy.getCoins(),1000); assert(economy.getProfile().activeRaid);
});
test('reload forfeits a reserved raid once and preserves the stash', () => {
  economy.addToStash(item('gem')); economy.addToStash(item('medkit')); economy.equipItem(1); economy.beginRaid('abandon');
  economy.loadProfile(); assert.equal(economy.getStash()[0].id,'gem'); assert.equal(economy.getEquipped().length,0);
  assert.equal(economy.getProfile().lastRaidResult.outcome,'abandoned'); economy.loadProfile();
  assert.equal(economy.getProfile().stats.raids,1);
});
test('corrupt storage is reported without overwriting its contents', () => {
  storage.set(economy.STORAGE_KEY,'{broken'); assert.throws(()=>economy.loadProfile(),error=>error.code==='CORRUPT_SAVE');
  assert.equal(storage.get(economy.STORAGE_KEY),'{broken');
  storage.set(economy.STORAGE_KEY,JSON.stringify({coins:-1})); assert.throws(()=>economy.loadProfile(),/损坏/);
});
test('reset is explicit and a failed reset preserves the existing progress', () => {
  economy.addCoins(123); fail=true; assert.throws(()=>economy.resetProfile(),/保存失败/);
  assert.equal(economy.getCoins(),50123);
});
test('settings only apply after their write succeeds', () => {
  settings.loadSettings(); fail=true; assert.throws(()=>settings.setSettings({sound:false}),/设置保存失败/);
  assert.equal(settings.getSettings().sound,true); fail=false;
  settings.setSettings({sound:false,screenShake:false}); assert.equal(settings.getSettings().sound,false);
  assert.equal(JSON.parse(storage.get('2d-delta-settings')).screenShake,false);
});
