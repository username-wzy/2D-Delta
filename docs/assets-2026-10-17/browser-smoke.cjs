// Browser verification against the actual app. Requires Playwright and Chrome.
// A temporary loopback-only server and isolated browser profiles are closed in finally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../client');
const output = __dirname;
const results = [];
let browser, server;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
async function check(name, action) {
  await action(); results.push({ name, passed: true }); console.log('PASS', name);
}
async function login(page) {
  await page.locator('#login-btn').click();
  await page.locator('#start-screen').waitFor({ state: 'visible' });
}
async function seed(context) {
  await context.addInitScript(() => {
    const storedItem = (id, emoji, name) => ({ id, emoji, name, value: 3000 });
    localStorage.setItem('emoji_delta_profile', JSON.stringify({
      username: '资产验证', passHash: '', coins: 100000,
      stash: [storedItem('weapon_ak47','🔫','AK-47'), storedItem('weapon_sniper','🔫','SVD'),
        storedItem('keycard_red','🔑','红色钥匙卡'), storedItem('keycard_blue','🔑','蓝色钥匙卡'),
        storedItem('keycard_green','🔑','绿色钥匙卡'), storedItem('medkit_large','💊','外科手术包'),
        storedItem('gem','💎','高价值蓝钻')],
      equipped: [storedItem('weapon_m4','🔫','M4A1'), storedItem('weapon_mp5','🔫','MP5-SD'),
        storedItem('backpack','🎒','战术背包'), storedItem('medkit','💊','医疗包')],
      activeRaid: null, createdAt: Date.now(),
    }));
    window.spriteDraws = {};
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
      const name = image.src?.split('/').pop();
      if (name) window.spriteDraws[name] = (window.spriteDraws[name] || 0) + 1;
      return original.call(this, image, ...args);
    };
  });
}
(async () => {
  server = http.createServer((request, response) => {
    let name;
    try { name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (name === '/favicon.ico') { response.writeHead(204).end(); return; }
    const target = path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
    if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    fs.readFile(target, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
      response.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await seed(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url + '/', { waitUntil: 'networkidle' });
  await check('four transparent atlases load and cover all configured operators, bots, weapons and shop goods', async () => {
    const info = await page.evaluate(async () => {
      const assets = await import('./js/assets.js');
      const loaded = await assets.loadGameAssets();
      const datasets = await Promise.all(['operators', 'bots', 'weapons', 'shop'].map(async name =>
        (await fetch(`data/${name}.json`)).json()));
      const missing = [];
      datasets.forEach((data, i) => data.forEach(item => {
        if (!assets.getAsset(item, i === 0 ? 'operator' : i === 1 ? 'bot' : 'item')) missing.push(item.id);
      }));
      const { Player } = await import('./js/entities.js');
      const defaults = datasets[0].every(op => assets.getAsset(new Player(op).gun)?.key === op.weaponId);
      return { loaded, missing, defaults, count: assets.allAssets().length };
    });
    assert.equal(info.loaded.filter(sheet => sheet.ready).length, 4);
    assert.equal(info.count, 37); assert.deepEqual(info.missing, []); assert(info.defaults);
  });
  await login(page);
  await check('old ID-only saves display distinct images while valuables retain Emoji', async () => {
    assert.equal(await page.locator('.op-card .asset-operators').count(), 6);
    assert.equal(await page.locator('.shop-item .asset-icon').count(), 19);
    assert.equal(await page.locator('#stash-grid [data-asset^="keycard_"]').count(), 3);
    assert.match(await page.locator('#stash-grid').innerText(), /💎/);
    assert.equal(await page.locator('#stash-grid [data-asset="gem"]').count(), 0);
    assert.equal(await page.locator('#stash-grid [data-asset="weapon_ak47"] .asset-art').evaluate(el => getComputedStyle(el).display), 'block');
    await page.locator('.op-card').filter({ hasText: '工程师' }).click();
    assert.match(await page.locator('#equip-capacity-text').innerText(), /18/);
  });
  await page.locator('#operator-cards').screenshot({ path: path.join(output, 'operators-in-lobby.png') });
  await page.locator('#shop-panel').screenshot({ path: path.join(output, 'shop-in-lobby.png') });
  await check('buying and equipping items keeps the correct image', async () => {
    await page.locator('.shop-item').filter({ hasText: 'P90' }).click();
    await page.locator('#stash-grid [data-asset="weapon_p90"]').waitFor();
    assert.equal(await page.locator('#stash-grid [data-asset="weapon_p90"]').count(), 1);
    await page.locator('#stash-grid .stash-item').filter({ has: page.locator('[data-asset="medkit_large"]') }).click();
    await page.locator('#stash-equip-selected').click();
    assert.equal(await page.locator('#equipped-grid [data-asset="medkit_large"]').count(), 1);
  });
  await page.locator('#deploy-btn').click();
  await page.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'));
  await check('actual raid renders characters, weapons and searchable containers; weapon switches update the HUD', async () => {
    await page.waitForFunction(() => ['operators.png','enemies.png','weapons.png','equipment.png'].every(file => window.spriteDraws[file] > 0));
    assert.equal(await page.locator('#player-avatar [data-asset="operator/engineer"]').count(), 1);
    assert.equal(await page.locator('#weapon-icon-emoji [data-asset="weapon_m4"]').count(), 1);
    await page.keyboard.press('2');
    await page.waitForFunction(() => document.querySelector('#weapon-icon-emoji [data-asset="weapon_mp5"]'));
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#loot-grid [data-asset="medkit_large"]').count(), 1);
    await page.keyboard.press('Tab');
    await page.mouse.move(1000, 450);
    await page.mouse.click(1000, 450);
    await page.screenshot({ path: path.join(output, 'raid.png') });
  });
  await check('HUD icon updates do not rebuild unchanged icon nodes each frame', async () => {
    const stable = await page.evaluate(async () => {
      const { updateHUD } = await import('./js/hud.js');
      const { Player } = await import('./js/entities.js');
      const { getOperatorDef } = await import('./js/operatordata.js');
      const player = new Player(getOperatorDef('scout')); player.weaponSlots = [player.gun]; player.selectedWeaponIdx = 0;
      updateHUD(player, null, null);
      const before = document.querySelector('#weapon-icon-emoji .asset-icon');
      for (let i = 0; i < 60; i++) updateHUD(player, null, null);
      return before === document.querySelector('#weapon-icon-emoji .asset-icon');
    });
    assert(stable);
  });
  const gallery = await context.newPage();
  gallery.on('pageerror', error => errors.push(error.message));
  await gallery.goto(url + '/asset-preview.html', { waitUntil: 'networkidle' });
  await check('all 37 Canvas frames have artwork and transparency; keycards exclude neighboring cabinet pixels', async () => {
    const inspected = await gallery.evaluate(async () => {
      const assets = await import('./js/assets.js'); await assets.loadGameAssets();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d'); const invalid = [];
      for (const asset of assets.allAssets()) {
        ctx.clearRect(0, 0, 128, 128);
        if (!assets.drawAsset(ctx, asset.key, 0, 0, 128, asset.sheet === 'weapons' ? 64 : 128)) invalid.push(asset.key);
        const pixels = ctx.getImageData(0, 0, 128, 128).data;
        let visible = 0, clear = 0;
        for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] > 32) visible++; if (pixels[i] === 0) clear++; }
        if (visible < 64 || clear < 64) invalid.push(asset.key + ': empty/opaque');
        if (['keycard_red', 'keycard_blue'].includes(asset.key)) {
          for (let y = 120; y < 128; y++) for (let x = 0; x < 128; x++) {
            if (pixels[(y * 128 + x) * 4 + 3] > 32) invalid.push(asset.key + ': neighboring row');
          }
        }
      }
      const dimensions = await Promise.all(Object.values(assets.atlasDefinitions).map(def => new Promise(resolve => {
        const image = new Image(); image.onload = () => resolve(image.naturalWidth === def.width && image.naturalHeight === def.height); image.src = def.src;
      })));
      return { invalid, dimensions };
    });
    assert.deepEqual(inspected.invalid, []); assert(inspected.dimensions.every(Boolean));
  });
  await check('asset gallery shows all 37 sprites without overflow on a small screen', async () => {
    assert.equal(await gallery.locator('.specimen').count(), 37);
    assert(await gallery.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return document.querySelector('.retained').getBoundingClientRect().bottom <= innerHeight;
    }));
    await gallery.evaluate(() => window.scrollTo(0, 0));
    await gallery.screenshot({ path: path.join(output, 'asset-gallery.png'), fullPage: true });
    await gallery.setViewportSize({ width: 390, height: 844 });
    assert(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await check('one unavailable sheet falls back to Emoji without blocking login or deployment', async () => {
    const degraded = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await seed(degraded);
    await degraded.route('**/assets/weapons.png', route => route.fulfill({ status: 404, body: '' }));
    const fallback = await degraded.newPage(); const failures = [];
    fallback.on('pageerror', error => failures.push(error.message));
    await fallback.goto(url + '/', { waitUntil: 'networkidle' }); await login(fallback);
    assert.equal(await fallback.locator('#stash-grid [data-asset="weapon_ak47"] .asset-fallback').evaluate(el => getComputedStyle(el).display), 'flex');
    assert.equal(await fallback.locator('#stash-grid [data-asset="medkit_large"] .asset-art').evaluate(el => getComputedStyle(el).display), 'block');
    await fallback.locator('#deploy-btn').click();
    await fallback.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'));
    assert(await fallback.evaluate(async () => {
      const assets = await import('./js/assets.js');
      return assets.getAssetState('weapons') === 'failed' &&
        assets.drawAsset(document.createElement('canvas').getContext('2d'), 'weapon_ak47', 0, 0, 64, 32) === false;
    }));
    assert.deepEqual(failures, []);
    await degraded.close();
  });
  await check('no JavaScript or console errors in the normal browser flow', async () => assert.deepEqual(errors, []));
  fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({
    date: '2026-10-17', browser: await browser.version(), passed: results.length,
    methodology: 'Real Chrome headless; isolated localStorage; temporary loopback HTTP server; real app modules and rendering. No production state hooks.', results,
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
