// Real Chrome UI, storage, input, Canvas and lifecycle verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../tools/dev-server.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root,'docs/mvp');
fs.mkdirSync(path.join(output,'screenshots'),{recursive:true});
const results=[], errors=[];
let browser,server;
const map = (exitAtSpawn=false) => ({
  name:'验收训练区域', width:20,height:16,tileSize:64,botCount:0,
  tiles:Array.from({length:16},(_,y)=>Array.from({length:20},(_,x)=>x===0||y===0||x===19||y===15?1:0)),
  spawns:[{x:3,y:4,team:'pmc'}],
  lootPoints:[{x:3,y:4,type:'gem'}],
  containers:[],
  extractions:[{x:exitAtSpawn?2:14,y:exitAtSpawn?3:10,w:3,h:3,condition:'standard',duration:10}]
});
async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
async function ready(page,url){await page.goto(url+'/client/',{waitUntil:'networkidle'});await page.locator('#enter-lobby-btn').waitFor();await page.waitForFunction(()=>!document.getElementById('enter-lobby-btn').disabled);}
async function lobby(page){await page.locator('#enter-lobby-btn').click();await page.locator('#start-screen').waitFor({state:'visible'});}
async function view(page,name){await page.locator('.nav-tab[data-lobby-view="'+name+'"]').click();}
const saved = page => page.evaluate(()=>JSON.parse(localStorage.getItem('2d_delta_save_v1')));
async function snapshot(page,name){await page.screenshot({path:path.join(output,'screenshots',name+'.png')});}
async function newPage(options={}){
  const context=await browser.newContext({viewport:{width:1440,height:900},...options});
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  return {context,page};
}
(async()=>{
  server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {}),headless:true});
  const {context,page}=await newPage();
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ready(page,url);
  await check('anonymous home boots without login; initial local progress is valid',async()=>{
    assert.equal(await page.locator('input[type=password]').count(),0);
    const profile=await saved(page);assert.equal(profile.coins,50000);assert(!('username'in profile));assert(!('passHash'in profile));
    assert(await page.locator('#home-screen').isVisible());await snapshot(page,'home-1440');
    await page.setViewportSize({width:1366,height:768});await snapshot(page,'home-1366');
    const button=await page.locator('#enter-lobby-btn').boundingBox();assert(button.y+button.height<768);await page.setViewportSize({width:1440,height:900});
  });
  await lobby(page);
  await check('navigation opens real operations, loadout and supply workspaces',async()=>{
    await view(page,'loadout');assert(await page.locator('#view-loadout').isVisible());assert.equal(await page.locator('.nav-tab.active').count(),1);
    assert.match(await page.locator('#stash-grid').innerText(),/仓库等待/);await snapshot(page,'loadout-empty');
    await view(page,'supply');assert.equal(await page.locator('.shop-item').count(),19);
    await page.locator('[data-shop-filter="medicine"]').click();assert.equal(await page.locator('.shop-item').count(),3);
    await page.locator('[data-shop-filter="all"]').click();assert.equal(await page.locator('.shop-item').count(),19);
    await snapshot(page,'supply-1440');
  });
  await check('buying, selecting and equipping uses real persisted assets and money',async()=>{
    for(const name of ['M4A1','轻型防弹衣','军用医疗包','破片手榴弹']){
      const count=(await saved(page)).stash.length;
      await page.locator('.shop-item').filter({hasText:name}).click();
      await page.waitForFunction(n=>JSON.parse(localStorage.getItem('2d_delta_save_v1')).stash.length===n+1,count);
    }
    assert.equal((await saved(page)).coins,23000);
    await view(page,'loadout');
    await page.locator('#stash-select-all').check();await page.locator('#stash-equip-selected').click();
    assert.equal((await saved(page)).equipped.length,4);assert.equal((await saved(page)).stash.length,0);
    await snapshot(page,'loadout-equipped');
    await view(page,'operations');await page.locator('[data-operator-id="engineer"]').click();
    assert.match(await page.locator('#selected-operator-name').innerText(),/工程师/);
    await snapshot(page,'operations-1440');
  });
  await check('settings persist and both destructive confirmation choices work',async()=>{
    await page.locator('#start-screen [data-open-dialog="settings-dialog"]').click();
    await page.locator('[data-setting="screenShake"]').uncheck();
    await page.locator('[data-setting="compactHUD"]').check();
    assert(await page.evaluate(()=>document.documentElement.classList.contains('compact-hud')));
    await page.locator('#settings-dialog [data-close-dialog]').last().click();
    // Sell-all is tested with a newly purchased item so carried gear stays intact.
    await view(page,'supply');await page.locator('.shop-item').filter({hasText:'军用医疗包'}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('2d_delta_save_v1')).stash.length===1);
    await view(page,'loadout');await page.locator('#sell-all-btn').click();
    await page.locator('[data-confirm="cancel"]').first().click();assert.equal((await saved(page)).stash.length,1);
    await page.locator('#sell-all-btn').click();await page.locator('[data-confirm="accept"]').click();
    assert.equal((await saved(page)).stash.length,0);assert.equal((await saved(page)).equipped.length,4);
  });
  await view(page,'operations');
  await check('responsive home and operations fit laptop and tablet widths',async()=>{
    for(const width of [1366,1024]){
      await page.setViewportSize({width,height:768});await snapshot(page,'operations-'+width);
      const bounds=await page.locator('#deploy-btn').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=768);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.setViewportSize({width:1440,height:900});
  });
  // A regular shipped factory raid exercises production map generation and sprites.
  await page.addInitScript(()=>{
    window.spriteDraws={};
    const original=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(image,...args){const name=image.src?.split('/').pop();if(name)window.spriteDraws[name]=(window.spriteDraws[name]||0)+1;return original.call(this,image,...args);};
  });
  await page.evaluate(()=>{
    window.spriteDraws={};
    const original=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(image,...args){const name=image.src?.split('/').pop();if(name)window.spriteDraws[name]=(window.spriteDraws[name]||0)+1;return original.call(this,image,...args);};
  });
  await page.locator('#deploy-btn').click();await page.locator('#hud').waitFor({state:'visible'});
  await check('factory deploy renders all four atlases and consumes the lobby reservation',async()=>{
    await page.waitForFunction(()=>['operators.png','enemies.png','weapons.png','equipment.png'].every(f=>window.spriteDraws[f]>0));
    assert((await saved(page)).activeRaid);assert.equal((await saved(page)).equipped.length,0);
    assert.match(await page.locator('#weapon-name-text').innerText(),/M4A1/);
    await snapshot(page,'factory-raid');
  });
  await check('Esc pause freezes countdown, opens confirmation, and abandonment returns to lobby',async()=>{
    await page.keyboard.press('Escape');assert(await page.locator('#pause-panel').isVisible());
    const before=await page.locator('#raid-timer').innerText();await page.waitForTimeout(1200);assert.equal(await page.locator('#raid-timer').innerText(),before);
    await page.locator('#resume-btn').click();await page.keyboard.press('Escape');
    await page.locator('#abandon-btn').click();await page.locator('[data-confirm="accept"]').click();
    await page.locator('#result-modal').waitFor({state:'visible'});assert.match(await page.locator('#result-title').innerText(),/放弃/);
    assert.equal((await saved(page)).stats.deaths,1);
    await page.locator('#restart-btn').click();assert(await page.locator('#start-screen').isVisible());
    assert.match(await page.locator('#selected-operator-name').innerText(),/工程师/);
  });
  // Isolated deterministic map fixtures are served through the public import/file flow.
  const training=await newPage();const p=training.page;
  await ready(p,url);await lobby(p);
  await p.locator('#map-import').setInputFiles({name:'training.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(map(true)))});
  await p.waitForFunction(()=>document.getElementById('map-select').value.startsWith('imported-'));
  await p.clock.install();
  await p.locator('#deploy-btn').click();await p.locator('#hud').waitFor({state:'visible'});
  await check('real imported-map search, protected inventory and successful extraction complete a full loop',async()=>{
    await p.keyboard.press('f');await p.keyboard.press('Tab');assert(await p.locator('#inventory-drawer').isVisible());
    await p.locator('#loot-grid .loot-action').filter({hasText:'保护'}).click();
    assert.equal((await saved(p)).activeRaid.secureInventory[0].id,'gem');
    assert.match(await p.locator('#secure-count').innerText(),/1 \/ 2/);await snapshot(p,'protected-inventory');
    await p.keyboard.press('Tab');
    await p.clock.runFor(11000);
    await p.locator('#result-modal').waitFor({state:'visible'});
    assert.match(await p.locator('#result-title').innerText(),/撤离成功/);
    assert.equal((await saved(p)).stash[0].id,'gem');assert.equal((await saved(p)).coins,50000);
    await snapshot(p,'extracted');
    await p.locator('#restart-btn').click();await view(p,'loadout');
    await p.locator('#stash-grid .stash-item').click();await p.locator('#stash-sell-selected').click();
    assert.equal((await saved(p)).coins,85000);assert.equal((await saved(p)).stats.extracts,1);
  });
  await check('protected loot survives a browser reload once; no stale carried gear returns',async()=>{
    const q=(await newPage()).page;await ready(q,url);await lobby(q);
    await q.locator('#map-import').setInputFiles({name:'reload.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(map(false)))});
    await q.waitForFunction(()=>document.getElementById('map-select').value.startsWith('imported-'));
    await q.locator('#deploy-btn').click();await q.locator('#hud').waitFor({state:'visible'});
    await q.keyboard.press('f');await q.keyboard.press('Tab');await q.locator('#loot-grid .loot-action').filter({hasText:'保护'}).click();
    await q.reload({waitUntil:'networkidle'});await q.waitForFunction(()=>!document.getElementById('enter-lobby-btn').disabled);
    const progress=await saved(q);assert.equal(progress.stash.length,1);assert.equal(progress.stash[0].id,'gem');assert.equal(progress.stats.deaths,1);assert.equal(progress.activeRaid,null);
    await q.reload({waitUntil:'networkidle'});assert.equal((await saved(q)).stash.length,1);
  });
  await check('all 37 assets render transparently; valuable Emoji and optional artwork fallback remain usable',async()=>{
    const info=await page.evaluate(async()=>{
      const assets=await import('./js/assets.js');await assets.loadGameAssets();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d');const invalid=[];
      for(const asset of assets.allAssets()){
        ctx.clearRect(0,0,128,128);if(!assets.drawAsset(ctx,asset.key,0,0,128,asset.sheet==='weapons'?64:128))invalid.push(asset.key);
        const pixels=ctx.getImageData(0,0,128,128).data;let visible=0,clear=0;
        for(let i=3;i<pixels.length;i+=4){if(pixels[i]>32)visible++;if(pixels[i]===0)clear++;}
        if(visible<64||clear<64)invalid.push(asset.key);
      }
      return {invalid,count:assets.allAssets().length,gem:assets.getAsset({type:'gem'})?.key||null};
    });
    assert.equal(info.count,37);assert.deepEqual(info.invalid,[]);assert.equal(info.gem,null);
    const degraded=await newPage();
    await degraded.page.route('**/assets/weapons.png',r=>r.fulfill({status:404,body:''}));
    await ready(degraded.page,url);await lobby(degraded.page);
    await view(degraded.page,'supply');
    assert.equal(await degraded.page.locator('.shop-item .asset-weapons .asset-fallback').first().evaluate(el=>getComputedStyle(el).display),'flex');
    await degraded.page.locator('#deploy-btn').click();await degraded.page.locator('#hud').waitFor({state:'visible'});
    await degraded.context.close();
  });

  await check('real sprint input updates stamina; a grenade defeat keeps only protected loot',async()=>{
    const {page:q}=await newPage();await ready(q,url);await lobby(q);
    const fixture=map(false);fixture.lootPoints=[{x:3,y:4,type:'gem'},{x:3,y:4,type:'grenade'},{x:3,y:4,type:'grenade'}];
    await q.locator('#map-import').setInputFiles({name:'combat.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await q.waitForFunction(()=>document.getElementById('map-select').value.startsWith('imported-'));
    await q.clock.install();await q.locator('#deploy-btn').click();await q.locator('#hud').waitFor({state:'visible'});
    await q.keyboard.down('Shift');await q.keyboard.down('d');await q.clock.runFor(400);
    assert(parseInt(await q.locator('#stamina-text').innerText())<100);
    await q.keyboard.up('d');await q.keyboard.up('Shift');await q.clock.runFor(2000);
    assert.equal(await q.locator('#stamina-text').innerText(),'100%');
    // Return to spawn by following normal input for the same displacement (sprint).
    await q.keyboard.down('Shift');await q.keyboard.down('a');await q.clock.runFor(400);await q.keyboard.up('a');await q.keyboard.up('Shift');
    await q.clock.runFor(50);await q.keyboard.press('f');await q.clock.runFor(50);await q.keyboard.press('f');await q.clock.runFor(50);await q.keyboard.press('f');
    await q.keyboard.press('Tab');await q.locator('#loot-grid .loot-action').filter({hasText:'保护'}).click();await q.keyboard.press('Tab');
    await q.mouse.move(720,450);await q.clock.runFor(50);await q.keyboard.press('g');await q.clock.runFor(1800);await q.keyboard.press('g');await q.clock.runFor(1800);
    await q.locator('#result-modal').waitFor({state:'visible'});assert.match(await q.locator('#result-title').innerText(),/行动失败/);
    const progress=await saved(q);assert.equal(progress.stats.deaths,1);assert.equal(progress.stash.length,1);assert.equal(progress.stash[0].id,'gem');
    await snapshot(q,'defeated');await q.locator('#restart-btn').click();assert(await q.locator('#start-screen').isVisible());
  });
  await check('map editor round trip preserves paid exits, ground loot and an explicit zero bot count',async()=>{
    const {page:q}=await newPage();await q.goto(url+'/tools/map-editor.html',{waitUntil:'networkidle'});
    const fixture=map(false);fixture.extractions[0]={...fixture.extractions[0],condition:'paid',cost:3000};
    await q.locator('#importText').fill(JSON.stringify(fixture));await q.locator('#importTextBtn').click();
    const downloaded=q.waitForEvent('download');await q.locator('#exportBtn').click();const file=await (await downloaded).path();
    const roundtrip=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(roundtrip.botCount,0);assert.equal(roundtrip.extractions[0].cost,3000);assert.equal(roundtrip.lootPoints[0].type,'gem');
  });

  await check('corrupt local progress shows a recoverable error without overwriting the save',async()=>{
    const failed=await newPage();await failed.context.addInitScript(()=>localStorage.setItem('2d_delta_save_v1','{broken'));
    await failed.page.goto(url+'/client/',{waitUntil:'networkidle'});
    await failed.page.locator('#boot-reset-btn').waitFor({state:'visible'});
    assert.equal(await failed.page.evaluate(()=>localStorage.getItem('2d_delta_save_v1')),'{broken');
    assert(await failed.page.locator('#enter-lobby-btn').isDisabled());await snapshot(failed.page,'save-error');
    await failed.context.close();
  });
  await check('normal user flows emit no JavaScript or console errors',async()=>assert.deepEqual(errors,[]));
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({
    date:'2026-10-17',browser:await browser.version(),passed:results.length,
    methodology:'Real Chrome headless, real ES modules, isolated storage, public UI/file import, Playwright clock for extraction, temporary loopback server closed after tests. No production state hooks.',
    results
  },null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
});
