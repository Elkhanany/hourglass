/*
 * renderer regression: with no cracks, the picture is exactly what the
 * f446085 build drew. Both builds run the same Sim (same seed, same steps,
 * so the same lattice) into a Renderer on the app's canvases, and every
 * layer is compared by hash: c-back, c-sand, c-bloom, c-front, c-light and
 * both WebGL glass layers (c-glass-back, c-glass-front), across themes,
 * Frame on/off, the drawn 2-D glass, and the glass turned and upside down.
 * drawSand must take the same time in both, within ±5 %.
 *
 *   node tools/test/render-regression.test.js [port]     exits 0 when every case passes
 *
 * The pages and both copies of physics.js are served from memory through
 * Playwright's routing, at http://localhost:<port>/ (a trustworthy origin,
 * so the page can be cross-origin isolated for a fine timer). Nothing
 * listens on the port and no files are written. The port defaults to $PORT
 * or 8802. HOURGLASS_BASELINE=<file> compares against that file instead of
 * git's f446085.
 */
'use strict';
var fs = require('fs');
var L = require('./lib/load-physics.js');
var chromium = require('playwright').chromium;

var ORIGIN = 'http://localhost:' + (+(process.argv[2] || process.env.PORT || 8802)) + '/';
var CUR = fs.readFileSync(L.PHYSICS, 'utf8');
var BASE = process.env.HOURGLASS_BASELINE ? fs.readFileSync(process.env.HOURGLASS_BASELINE, 'utf8')
                                          : L.gitShow(L.BASELINE_REV, 'physics.js');

var failures = 0, count = 0;
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/* A running glass (the gate open, the stream in the air, avalanches below), and a Renderer on it. */
var SETUP = [
  'function runGlass(P, cfg) {',
  '  var sim = new P.Sim({ scale: 1.08, seed: cfg.seed }), t, i;',
  '  sim.reset(Math.round(sim.capacity * cfg.fill));',
  '  sim.gateOpen = true; t = sim.nTop;',
  '  for (i = 0; i < cfg.steps; i++) { sim.beginFrame(); t -= cfg.rate; sim.targetTop = Math.max(0, Math.ceil(t)); sim.step(); }',
  '  if (cfg.angle) { sim.flipping = true; sim.angle = cfg.angle; for (i = 0; i < 24; i++) { sim.beginFrame(); sim.step(); } }',
  '  return sim;',
  '}',
  'function render(P, sim, els, cfg) {',
  '  var ren = new P.Renderer(sim, els);',
  '  ren.setFrame(cfg.frame); ren.setTheme(cfg.theme); ren.layout(374, 718, 3);',
  '  ren.drawSand(); ren.drawSand(); ren.drawSand();',      // the bloom is refreshed every third frame
  '  ren.drawGlass(cfg.rot, true);',
  '  return ren;',
  '}'
].join('\n');

/* One build on the app's canvases (as the app runs it): every layer hashed. */
var HARNESS = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<style>html,body{margin:0;background:#000}#rotor{position:absolute;left:0;top:0}#rotor canvas{position:absolute;left:0;top:0}</style>',
  '</head><body><div id="rotor">',
  '<canvas id="c-back"></canvas><canvas id="c-glass-back"></canvas><canvas id="c-sand"></canvas><canvas id="c-bloom"></canvas>',
  '<canvas id="c-glass-front"></canvas><canvas id="c-front"></canvas></div><canvas id="c-light"></canvas>',
  '<script src="BUILD.js"></script>',
  '<script>',
  SETUP,
  'function fnv(b) { var h = 0x811c9dc5; for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }',
  'window.build = function (cfg) {',
  '  var P = window.HourglassPhysics, $ = function (id) { return document.getElementById(id); }, i;',
  '  var sim = runGlass(P, cfg);',
  '  var els = { back: $("c-back"), sand: $("c-sand"), bloom: $("c-bloom"), front: $("c-front"), light: $("c-light") };',
  '  if (cfg.gl) { els.glBack = $("c-glass-back"); els.glFront = $("c-glass-front"); }',
  '  var ren = render(P, sim, els, cfg);',
  // the new build is asked to keep its (absent) cracks in step, as the app will every frame
  '  var synced = 0;',
  '  if (ren.syncDamage) for (i = 0; i < 30; i++) if (ren.syncDamage(cfg.rot + 0.1 * i, 1000 + 40 * i)) synced++;',
  '  var out = { cells: fnv(sim.cell), seeds: fnv(sim.seed), np: sim.np, nTop: sim.nTop, synced: synced };',
  '  ["c-back", "c-sand", "c-bloom", "c-front", "c-light"].forEach(function (id) {',
  '    var c = $(id); out[id] = c.width + "x" + c.height + " " + fnv(c.getContext("2d").getImageData(0, 0, c.width, c.height).data);',
  '  });',
  '  if (ren.glass) ren.glass.forEach(function (g, k) {',
  '    var gl = g.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);',
  '    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);',
  '    out[k ? "c-glass-front" : "c-glass-back"] = w + "x" + h + " " + fnv(px);',
  '  });',
  '  else out.glass = "drawn in 2-D";',
  '  return out;',
  '};',
  '</script></body></html>'
].join('\n');

/*
 * Both builds in one page, each drawing the same glass on canvases of its
 * own, timed block for block in alternation: whatever else the machine is
 * doing then falls on both alike.
 */
var RACE = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body>',
  '<script src="base.js"></script>',
  '<script>window.BASE = window.HourglassPhysics;</script>',
  '<script src="cur.js"></script>',
  '<script>',
  SETUP,
  'window.CUR = window.HourglassPhysics;',
  'function canvases() {',
  '  var els = {};',
  '  ["back", "sand", "bloom", "front", "light", "glBack", "glFront"].forEach(function (n) {',
  '    var c = document.createElement("canvas"); c.style.cssText = "position:absolute;left:0;top:0"; document.body.appendChild(c); els[n] = c;',
  '  });',
  '  return els;',
  '}',
  'window.setup = function (cfg) {',
  '  window.RC = render(window.CUR, runGlass(window.CUR, cfg), canvases(), cfg);',
  '  window.RB = render(window.BASE, runGlass(window.BASE, cfg), canvases(), cfg);',
  '  return true;',
  '};',
  // ms per drawSand() in blocks of `per` calls (a multiple of 3, for the bloom), alternating builds and order
  'window.race = function (rounds, per) {',
  '  var c = [], b = [], r, k;',
  '  function block(ren, out) { var t0 = performance.now(); for (k = 0; k < per; k++) ren.drawSand(); out.push((performance.now() - t0) / per); }',
  '  for (r = 0; r < rounds; r++) {',
  '    if (r & 1) { block(window.RB, b); block(window.RC, c); } else { block(window.RC, c); block(window.RB, b); }',
  '  }',
  '  c.sort(function (x, y) { return x - y; }); b.sort(function (x, y) { return x - y; });',
  '  return { cur: c[c.length >> 1], base: b[b.length >> 1], curMin: c[0], baseMin: b[0], blocks: rounds };',
  '};',
  '</script></body></html>'
].join('\n');

var CONFIGS = [
  { name: 'Sahara, frame, WebGL glass, turned 0.3', theme: 'sahara', frame: true, gl: true, rot: 0.3, seed: 1234567, fill: 0.62, steps: 900, rate: 3 },
  { name: 'Volcanic, no frame, WebGL glass, mid-turn', theme: 'volcanic', frame: false, gl: true, rot: -0.4, seed: 777, fill: 0.5, steps: 600, rate: 2, angle: 0.8 },
  { name: 'Moonstone, frame, drawn 2-D glass', theme: 'moonstone', frame: true, gl: false, rot: 0, seed: 4242, fill: 0.78, steps: 1200, rate: 4 },
  { name: 'Sahara, no frame, drawn 2-D glass, upside down', theme: 'sahara', frame: false, gl: false, rot: 2.5, seed: 99, fill: 0.4, steps: 300, rate: 2, angle: 2.5 }
];

/** A page at `file` ('index.html' with build `which`, or 'race.html'), served from memory. */
function open(browser, file, which) {
  var page;
  return browser.newContext({ viewport: { width: 400, height: 800 } }).then(function (ctx) {
    return ctx.newPage();
  }).then(function (pg) {
    page = pg;
    page.errors = [];
    page.on('pageerror', function (e) { page.errors.push('pageerror: ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
    return page.route(ORIGIN + '**', function (route) {
      var u = route.request().url().slice(ORIGIN.length).split('?')[0];
      var body = u === 'BUILD.js' ? (which === 'base' ? BASE : CUR) : u === 'base.js' ? BASE : u === 'cur.js' ? CUR :
                 u === 'index.html' ? HARNESS : u === 'race.html' ? RACE : null;
      if (body === null) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({
        status: 200, body: body,
        contentType: /\.js$/.test(u) ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        // cross-origin isolated: performance.now() to 5 µs for the timing
        headers: { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }
      });
    });
  }).then(function () {
    return page.goto(ORIGIN + file);
  }).then(function () {
    return page.waitForFunction(function () { return !!window.HourglassPhysics && !!(window.build || window.race); });
  }).then(function () {
    return page;
  });
}

/** Both builds draw configuration cfg, each in a page of its own; every layer must match. */
function compare(browser, cfg) {
  var t0 = Date.now(), pc, pb, a;
  count++;
  return open(browser, 'index.html', 'cur').then(function (p) {
    pc = p;
    return open(browser, 'index.html', 'base');
  }).then(function (p) {
    pb = p;
    return pc.evaluate(function (x) { return window.build(x); }, cfg);
  }).then(function (x) {
    a = x;
    return pb.evaluate(function (y) { return window.build(y); }, cfg);
  }).then(function (b) {
    ok(a.cells === b.cells && a.seeds === b.seeds && a.np === b.np, 'the two builds simulated different sand: ' + JSON.stringify([a.cells, b.cells, a.np, b.np]));
    ok(a.synced === 0, 'syncDamage redrew ' + a.synced + ' times with no cracks');
    var keys = Object.keys(b).filter(function (k) { return k !== 'synced'; }), diff = [];
    keys.forEach(function (k) { if (a[k] !== b[k]) diff.push(k + ' ' + a[k] + ' vs ' + b[k]); });
    ok(!diff.length, 'layers differ from f446085: ' + diff.join('; '));
    ok(!pc.errors.length && !pb.errors.length, 'page errors: ' + pc.errors.concat(pb.errors).join(' | '));
    var layers = keys.filter(function (k) { return /^c-/.test(k); });
    console.log('PASS  7. REGRESSION (' + cfg.name + '): ' + layers.length + ' layers identical (' + layers.join(', ') +
      (a.glass ? '; glass ' + a.glass : '') + '), np ' + a.np + ', syncDamage idle (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  }).catch(function (e) {
    failures++;
    console.log('FAIL  7. REGRESSION (' + cfg.name + '): ' + (e && e.message ? e.message : e));
  }).then(function () {
    return (pc ? pc.context().close() : null);
  }).then(function () {
    return (pb ? pb.context().close() : null);
  });
}

/** drawSand time: both builds in one page, the same glass, blocks in alternation. */
function timing(browser) {
  var page;
  count++;
  return open(browser, 'race.html').then(function (p) {
    page = p;
    return page.evaluate(function (cfg) { return window.setup(cfg); }, CONFIGS[0]);
  }).then(function () {
    return page.evaluate(function () { return window.race(30, 9); });       // warm up both
  }).then(function () {
    return page.evaluate(function () { return window.race(400, 9); });
  }).then(function (r) {
    var d = r.cur / r.base - 1, dm = r.curMin / r.baseMin - 1;
    ok(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
    ok(Math.abs(d) <= 0.05, 'drawSand ' + r.cur.toFixed(3) + ' ms vs ' + r.base.toFixed(3) + ' ms at f446085: ' + (d * 100).toFixed(1) + ' %');
    console.log('PASS  7. REGRESSION (drawSand time): median ' + r.cur.toFixed(3) + ' ms vs ' + r.base.toFixed(3) + ' ms at f446085 (' +
      (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' %); fastest ' + r.curMin.toFixed(3) + ' vs ' + r.baseMin.toFixed(3) + ' ms (' +
      (dm >= 0 ? '+' : '') + (dm * 100).toFixed(1) + ' %); ' + r.blocks + ' alternating blocks of 9 calls, both builds in one page');
  }).catch(function (e) {
    failures++;
    console.log('FAIL  7. REGRESSION (drawSand time): ' + (e && e.message ? e.message : e));
  }).then(function () {
    return (page ? page.context().close() : null);
  });
}

function main() {
  var browser;
  return chromium.launch({ args: ['--enable-unsafe-swiftshader'] }).then(function (b) {
    browser = b;
    return CONFIGS.reduce(function (done, cfg) {
      return done.then(function () { return compare(browser, cfg); });
    }, Promise.resolve());
  }).then(function () {
    return timing(browser);
  }).then(function () {
    return browser.close();
  }).then(function () {
    console.log(failures ? 'render-regression: ' + failures + ' of ' + count + ' cases FAILED' : 'render-regression: all ' + count + ' cases passed');
    process.exit(failures ? 1 : 0);
  });
}

main().catch(function (e) {
  console.log('FAIL  harness: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
