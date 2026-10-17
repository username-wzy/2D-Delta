// Deterministic map for browser smoke testing: no distant open tile can spawn
// a bot; the player starts in extraction. Also exercises a 6400px wide world.
const fs = require('node:fs');
const path = require('node:path');
const tiles = Array.from({length:50}, () => Array(100).fill(1));
for(let y=10;y<13;y++) for(let x=70;x<73;x++) tiles[y][x]=0;
const map = {name:'回归验证 · 宽地图',width:100,height:50,tileSize:64,
  tiles:tiles.map(row=>row.join(',')), spawns:[{x:71,y:11,team:'pmc'}],
  containers:[],extractions:[{x:70,y:10,w:3,h:3}]};
fs.writeFileSync(path.join(__dirname,'smoke-map.json'),JSON.stringify(map,null,2));
