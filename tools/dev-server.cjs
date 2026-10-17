// Dependency-free development server, bound only to loopback.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png',
  '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf' };
function createServer() {
  return http.createServer(async (request, response) => {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let name;
    try { name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (name === '/') { response.writeHead(302, { Location:'/client/' }).end(); return; }
    if (name === '/client') { response.writeHead(308, { Location:'/client/' }).end(); return; }
    if (name === '/tools' || name === '/tools/') { response.writeHead(302, { Location:'/tools/map-editor.html' }).end(); return; }
    if (name === '/favicon.ico') { response.writeHead(204).end(); return; }
    const segments = name.split('/').filter(Boolean);
    if (!['client','tools'].includes(segments[0]) || segments.some(part => part.startsWith('.') || part.includes('\\'))) {
      response.writeHead(403).end(); return;
    }
    const target = path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
    if (!target.startsWith(root + path.sep) || !types[path.extname(target)]) { response.writeHead(403).end(); return; }
    try {
      const real = await fs.realpath(target);
      if (!real.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const data = await fs.readFile(real);
      response.writeHead(200, { 'Content-Type':types[path.extname(target)],
        'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 5173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535');
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('2D Delta: http://127.0.0.1:' + server.address().port + '/client/'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close());
}
module.exports = { createServer };
