const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const readJSON = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const clientJS = fs.readdirSync(path.join(root, 'client/js')).filter(file => file.endsWith('.js')).map(file => 'client/js/' + file);
const tests = fs.readdirSync(path.join(root,'tests')).filter(file => file.endsWith('.cjs')).map(file => 'tests/' + file);
const scripts = [...clientJS, ...tests, 'tools/dev-server.cjs', 'tools/check-project.cjs'];
for (const file of scripts) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding:'utf8' });
  assert.equal(result.status, 0, file + ': ' + (result.stderr || result.error || 'syntax check failed'));
  for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    assert(fs.existsSync(path.resolve(root, path.dirname(file), match[1])), file + ': missing import ' + match[1]);
  }
}
const datasets = Object.fromEntries(['operators','bots','weapons','loot','shop'].map(name => [name, readJSON('client/data/' + name + '.json')]));
for (const [name, rows] of Object.entries(datasets)) {
  assert(Array.isArray(rows) && rows.length > 0, name);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, name + ': duplicate ID');
}
const weapons = new Set(datasets.weapons.map(row => row.id));
for (const op of datasets.operators) {
  assert(weapons.has(op.weaponId), 'missing operator weapon: ' + op.id);
  assert.equal(op.maxHp,100); assert.equal(op.maxArmor,0); assert.equal(op.armorClass,0);
}
for (const weapon of datasets.weapons) assert(Number.isFinite(weapon.range) && weapon.range > 0, weapon.id + ': range');
for (const item of datasets.loot) assert(Number.isInteger(item.rarity) && item.rarity >= 1 && item.rarity <= 6, item.id + ': rarity');
assert(!fs.readFileSync(path.join(root,'client/index.html'),'utf8').includes('type="password"'));
assert(!fs.readFileSync(path.join(root,'client/js/main.js'),'utf8').includes('showLoginScreen'));
for (const item of datasets.shop.filter(row => row.category === 'weapon')) assert(weapons.has(item.id), item.id);
for (const file of fs.readdirSync(path.join(root, 'client/maps')).filter(file => file.endsWith('.json'))) readJSON('client/maps/' + file);
for (const name of ['operators','enemies','weapons','equipment']) {
  const png = fs.readFileSync(path.join(root, 'client/assets/' + name + '.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name + ': PNG signature');
  assert(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, name + ': dimensions');
  assert.equal(png[25], 6, name + ': expected RGBA');
}
let links = 0;
for (const file of ['README.md','ROADMAP.md','AGENT.md','client/assets/README.md','docs/initialization/README.md']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (match[1].includes('://') || match[1].startsWith('#')) continue;
    const target = decodeURIComponent(match[1].split('#')[0]);
    assert(fs.existsSync(path.resolve(root, path.dirname(file), target)), file + ': broken link ' + target);
    links++;
  }
}
assert.equal(readJSON('package.json').private, true, 'prevent accidental npm publishing');
console.log('Checked ' + scripts.length + ' JavaScript files, 5 config sets, map JSON, 4 RGBA atlases and ' + links + ' document links.');
