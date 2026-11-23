/*
 * A small static file server for the browser tests (development only, no
 * dependencies).
 *
 *   node tools/test/lib/static-server.js <port> [root]
 *
 * Serves `root` (default: this repository) at http://127.0.0.1:<port>/ until
 * it is stopped (Ctrl-C or SIGTERM). Nothing is cached, so a test always
 * sees the files as they are. Inside a test script:
 *
 *   var server = require('./lib/static-server.js').start(port, root, onListening);
 *   ...
 *   server.close();
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var DEFAULT_ROOT = require('./paths.js').ROOT;

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

function send(res, code, headers, body) {
  res.writeHead(code, headers || {});
  res.end(body);
}

function start(port, root, onListening) {
  root = path.resolve(root || DEFAULT_ROOT);
  var server = http.createServer(function (req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { 'Allow': 'GET, HEAD' });
      return;
    }
    var urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    } catch (e) {
      send(res, 400);
      return;
    }
    // normalize() resolves any ".." against "/", so the path cannot leave root
    var file = path.join(root, path.normalize('/' + urlPath));
    if (file !== root && file.indexOf(root + path.sep) !== 0) {
      send(res, 403);
      return;
    }
    fs.stat(file, function (err, st) {
      if (!err && st.isDirectory()) {
        if (urlPath.charAt(urlPath.length - 1) !== '/') {
          // so that relative URLs inside the page resolve against the directory
          send(res, 301, { 'Location': req.url.split('?')[0] + '/' });
          return;
        }
        file = path.join(file, 'index.html');
      }
      fs.readFile(file, function (err2, data) {
        if (err2) {
          send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found\n');
          return;
        }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': data.length,
          'Cache-Control': 'no-store'
        });
        res.end(req.method === 'HEAD' ? undefined : data);
      });
    });
  });
  server.listen(port, '127.0.0.1', onListening);
  return server;
}

module.exports = { start: start, DEFAULT_ROOT: DEFAULT_ROOT };

if (require.main === module) {
  var port = parseInt(process.argv[2], 10);
  if (!(port > 0 && port < 65536)) {
    process.stderr.write('usage: node tools/test/lib/static-server.js <port> [root]\n');
    process.exit(2);
  }
  var root = path.resolve(process.argv[3] || DEFAULT_ROOT);
  var server = start(port, root, function () {
    process.stdout.write('static-server: http://127.0.0.1:' + port + '/ serving ' + root + '\n');
  });
  server.on('error', function (e) {
    process.stderr.write('static-server: ' + e.message + '\n');
    process.exit(1);
  });
  var stop = function () { server.close(function () { process.exit(0); }); setTimeout(function () { process.exit(0); }, 500).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
