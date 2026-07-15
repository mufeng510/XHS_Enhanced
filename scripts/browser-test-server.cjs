'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid port is required');
const routeHarness = pathname => pathname === '/search_result' || pathname.startsWith('/user/profile/') || pathname.startsWith('/explore/');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

http.createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = routeHarness(pathname) ? 'tests/browser/harness.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes repository root');
    if (!Object.hasOwn(types, path.extname(target))) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(target)], 'Cache-Control': 'no-store' });
    fs.createReadStream(target).on('error', () => response.writeHead(404).end()).pipe(response);
  } catch { response.writeHead(400).end(); }
}).listen(port, '127.0.0.1');
