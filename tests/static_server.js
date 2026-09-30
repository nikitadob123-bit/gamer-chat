// Мини-сервер статики для тестов. Опционально подменяет config.js и CSP (для локального стенда).
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
exports.start = function (root, port, opts) {
  opts = opts || {};
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end('nf'); }
      let body = fs.readFileSync(f);
      if (opts.config && p === '/js/config.js') body = 'window.GC_CONFIG=' + JSON.stringify(opts.config) + ';';
      if (opts.csp && p === '/index.html') body = Buffer.from(body.toString().replace(/content="default-src[^"]*"/, 'content="' + opts.csp + '"'));
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      rsp.end(body);
    }).listen(port, '127.0.0.1', () => res(s));
  });
};
