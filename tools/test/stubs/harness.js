/*
 * Shared harness for the controller's browser tests (app-*.test.js) and the
 * integration suite (e2e-*.test.js). Development only, never shipped.
 *
 *   var H = require('./stubs/harness.js');
 *   var env = await H.start();               // server + Chromium, from the command line:
 *                                            //   --root <dir>  (default: this checkout)
 *                                            //   --port <n>    (default: $PORT, else 8804)
 *   var t = await env.open({ motionStub: true, reducedMotion: false, storage: {...} });
 *   ... t.page, t.touch, t.errors ...
 *   await env.close();
 *
 * Every page starts from a version-3 save with Real sand off, merged under what
 * the test seeds (lib/seed.js): Real sand is the app's default, and a page
 * seeds realSand: true to have it. opts.rawStorage seeds exactly what it is
 * given ({}: nothing saved, a first launch on a new phone).
 *
 * Each page is an iPhone 12 (390×844, DPR 3, mobile, touch) in Chromium;
 * opts.viewport ({ width, height }) opens it as a phone of another size;
 * opts.locale ('en-GB') and opts.timezoneId ('Europe/Berlin'), a phone of that
 * language and time zone.
 * Before any page script it gets tools/test/lib/profiles.js, page-init.js
 * (permission stubs, the motion driver, the invariant monitor) and the page's
 * side of lib/tune.js (window.__tune: where a control of Tune is). A suite
 * reaches a control of Tune through lib/tune.js, which opens Tune and shows
 * the control's tab; it never says itself which tab that is.
 *
 * The served tree is the app as it ships: every script index.html loads is
 * served as it is, and a tree that lacks one fails start() by name. The one
 * stand-in: with opts.motionStub, stubs/motion-stub.js (driven through
 * window.__motion) is served at motion.js's path (lib/paths.js), in place of
 * motion.js. The rule: a stand-in replaces the file it stands for; nothing is
 * added to app.js or to any other file, and app parts get engine objects only
 * from app.js, never by reading a global at load.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var playwright = null;              // loaded by start(), so the Node checks can read this file without it
var staticServer = require('../lib/static-server.js');
var paths = require('../lib/paths.js');
var seed = require('../lib/seed.js');
var tune = require('../lib/tune.js');
var ASK = require('../lib/ask.js');

var REPO = paths.ROOT;
var PROFILES = path.join(REPO, 'tools', 'test', 'lib', 'profiles.js');
var PAGE_INIT = path.join(__dirname, 'page-init.js');
// the stand-ins, by the file they stand for (its path in the served tree comes from index.html)
var STAND_INS = { 'motion.js': path.join(__dirname, 'motion-stub.js') };

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function parseArgs() {
  var a = process.argv.slice(2);
  var o = { root: process.env.HOURGLASS_ROOT || REPO, port: +process.env.PORT || 8804, only: null, headed: false,
            webgl: process.env.HOURGLASS_WEBGL === '1' };
  for (var i = 0; i < a.length; i++) {
    if (a[i] === '--root') o.root = path.resolve(a[++i]);
    else if (a[i] === '--port') o.port = +a[++i];
    else if (a[i] === '--only') o.only = a[++i];
    else if (a[i] === '--headed') o.headed = true;
    else if (a[i] === '--webgl') o.webgl = true;
  }
  return o;
}

/**
 * What is wrong with a tree to be served: every script index.html loads must
 * be in it, and every stand-in must have a file to stand for. [] when whole.
 */
function treeProblems(root) {
  var out = [], scripts;
  try { scripts = paths.classicScripts(root); } catch (e) { return ['no index.html in ' + root]; }
  scripts.forEach(function (f) {
    var p = path.join(root, f);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) out.push('index.html loads ' + f + ', which is not in ' + root);
  });
  Object.keys(STAND_INS).forEach(function (name) {
    try { paths.script(name, root); } catch (e) { out.push('the stand-in for ' + name + ' has nothing to stand for: ' + e.message); }
  });
  return out;
}

/** The URL path of each stand-in's file in the served tree: { '/motion.js': stub file }. */
function standInPaths(root) {
  var out = {};
  Object.keys(STAND_INS).forEach(function (name) { out['/' + paths.script(name, root)] = STAND_INS[name]; });
  return out;
}

function Suite(name) {
  this.name = name;
  this.results = [];
  this.t0 = Date.now();
}
Suite.prototype.check = function (label, ok, detail) {
  this.results.push({ label: label, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  return !!ok;
};
Suite.prototype.note = function (label, detail) {
  console.log('NOTE  ' + label + (detail ? '  — ' + detail : ''));
};
Suite.prototype.skip = function (label, why) {
  this.results.push({ label: label, ok: true, skipped: true, detail: why || '' });
  console.log('SKIP  ' + label + (why ? '  — ' + why : ''));
};
Suite.prototype.done = function () {
  var failed = this.results.filter(function (r) { return !r.ok; });
  var skipped = this.results.filter(function (r) { return r.skipped; }).length;
  var n = this.results.length;
  console.log(this.name + ': ' + (n - failed.length - skipped) + '/' + (n - skipped) + ' passed' +
              (skipped ? ', ' + skipped + ' skipped' : '') + ' in ' + ((Date.now() - this.t0) / 1000).toFixed(1) + ' s');
  if (failed.length) process.exitCode = 1;
  return failed.length === 0;
};

/** A finger on the touch screen (CDP touch events: real pointer and touch events, real user activation). */
function makeTouch(cdp) {
  var t = {
    x: 0, y: 0,
    down: function (x, y) {
      t.x = x; t.y = y;
      return cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x, y: y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    },
    move: function (x, y) {
      t.x = x; t.y = y;
      return cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x, y: y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    },
    up: function () {
      return cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    /** Several fingers at once: type 'touchStart' | 'touchMove', pts [[x, y], ...] (ids 1, 2, ...). up() lifts them all. */
    fingers: function (type, pts) {
      return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: pts.map(function (q, i) {
        return { x: q[0], y: q[1], id: i + 1, radiusX: 2, radiusY: 2, force: 1 };
      }) });
    },
    /**
     * Two fingers on a level line through (cx, cy), the gap between them
     * going from `from` to `to` px over ms (a step every ~8 ms), then lifted;
     * hold: they stay down.
     */
    pinch: async function (cx, cy, from, to, ms, hold) {
      var two = function (gap) { return [[cx - gap / 2, cy], [cx + gap / 2, cy]]; };
      await t.fingers('touchStart', two(from));
      var t0 = Date.now();
      for (;;) {
        var u = Math.min(1, (Date.now() - t0) / (ms || 260));
        await t.fingers('touchMove', two(from + (to - from) * u));
        if (u >= 1) break;
        await sleep(8);
      }
      if (!hold) await t.up();
    },
    /**
     * Move along fn(u) → {x, y}, u from 0 to 1 over ms of wall time, a step
     * every ~8 ms. `lift`: the finger leaves the glass while still moving (a
     * flick): the last move and the lift go out together, so the page never
     * sees the finger stop first.
     */
    path: async function (fn, ms, lift) {
      var t0 = Date.now();
      for (;;) {
        var u = Math.min(1, (Date.now() - t0) / ms), p = fn(u);
        if (u >= 1 && lift) {
          t.x = p.x; t.y = p.y;
          var m = cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
          var e = cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await Promise.all([m, e]);
          break;
        }
        await t.move(p.x, p.y);
        if (u >= 1) break;
        await sleep(8);
      }
    },
    tap: async function (x, y, holdMs) {
      await t.down(x, y);
      await sleep(holdMs || 60);
      await t.up();
    }
  };
  return t;
}

async function start(opts) {
  opts = opts || {};
  var a = parseArgs();
  var root = opts.root || a.root;
  var problems = treeProblems(root);
  if (problems.length) throw new Error('harness: the tree to be served is not whole: ' + problems.join('; '));
  playwright = playwright || require('playwright');
  var port = opts.port || a.port;
  var server = await new Promise(function (resolve, reject) {
    var s = staticServer.start(port, root, function () { resolve(s); });
    s.on('error', reject);
  });
  // Without a GPU, Chromium shades the WebGL glass in software: every frame
  // of a turn then takes ~0.7 s here (the f446085 app too), and the glass
  // turns in slow motion. The tests run the app's own 2-D glass instead,
  // unless --webgl (or opts.webgl) asks for the real thing.
  var webgl = opts.webgl !== undefined ? !!opts.webgl : a.webgl;
  var browser = await playwright.chromium.launch({
    headless: !a.headed,
    args: ['--autoplay-policy=no-user-gesture-required'].concat(webgl ? ['--enable-unsafe-swiftshader'] : ['--disable-webgl'])
  });
  var env = {
    root: root, port: port, url: 'http://127.0.0.1:' + port + '/', args: a, standIns: standInPaths(root),
    browser: browser, server: server, pages: [],
    open: function (o) { return open(env, o || {}); },
    close: async function () {
      try { await browser.close(); } catch (e) {}
      await new Promise(function (r) { server.close(function () { r(); }); setTimeout(r, 500); });
    }
  };
  env.webgl = webgl;
  console.log('serving ' + root + ' at ' + env.url + '  (' + paths.classicScripts(root).join(', ') +
              ' as they are: renderer real, audio real, motion.js real unless a test asks for its stub; glass ' +
              (webgl ? 'WebGL' : '2-D') + ')');
  return env;
}

async function open(env, o) {
  var dev = playwright.devices['iPhone 12'];
  var context = await env.browser.newContext({
    userAgent: dev.userAgent,
    viewport: o.viewport || { width: 390, height: 844 },
    screen: o.viewport || { width: 390, height: 844 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference',
    serviceWorkers: o.serviceWorkers ? 'allow' : 'block',
    // a phone's language and time zone, where a test asks for them (the browser's own otherwise)
    locale: o.locale || undefined, timezoneId: o.timezoneId || undefined
  });
  await context.addInitScript({ path: PROFILES });
  await context.addInitScript({ path: PAGE_INIT });
  await context.addInitScript(tune.pageSide, tune.SHEET);     // the page's side of lib/tune.js: where a control of Tune is
  // every page: { v: 3, realSand: false } under what the test seeds (Real sand only when it asks
  // for it), or o.rawStorage as it is; once per test page, so a reload sees what the app saved
  await context.addInitScript(seed.seedOnce, seed.storageFor(o));
  if (o.init) await context.addInitScript(o.init, o.initArg);
  // routes of the test's own, set before the page first loads: [{ url, handler }] (page.route's)
  for (var ri = 0; ri < (o.routes || []).length; ri++) await context.route(o.routes[ri].url, o.routes[ri].handler);
  // a stand-in is served at the path of the file it stands for, and nothing else is touched
  var useMotionStub = !!o.motionStub;
  if (useMotionStub) {
    var origin = env.url.replace(/\/$/, ''), served = env.standIns;
    await context.route(function (u) { return u.origin === origin && served.hasOwnProperty(u.pathname); }, function (route) {
      var u = new URL(route.request().url());
      route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(served[u.pathname], 'utf8') });
    });
  }
  var page = await context.newPage();
  var errors = [];
  page.on('pageerror', function (e) { errors.push('pageerror: ' + (e && e.message)); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(env.url + (o.query || ''));
  await page.waitForFunction(function () { return window.Hourglass && window.__mon && window.__mon.hooked; }, null, { timeout: 15000 });
  var cdp = await context.newCDPSession(page), evaluate = page.evaluate.bind(page);
  var t = {
    context: context, page: page, cdp: cdp, errors: errors, motionStub: useMotionStub,
    touch: makeTouch(cdp),
    // a question to the page: it ends after 30 s, and an answer of more than 20,000 values is
    // refused in the page (lib/ask.js); o.max raises that for one question that truly needs it
    eval: function (fn, arg, o) { return ASK.ask(evaluate, fn, arg, o); },
    glass: function () {
      return page.evaluate(function () {
        var r = document.getElementById('assembly').getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top };
      });
    },
    reload: async function () {
      await page.reload();
      await page.waitForFunction(function () { return window.Hourglass && window.__mon && window.__mon.hooked; }, null, { timeout: 15000 });
    },
    close: function () { return context.close(); }
  };
  env.pages.push(t);
  return t;
}

/** The checks every scenario ends with: census exact, no errors, perf rings readable. */
async function invariants(s, t, label) {
  var m = await t.page.evaluate(function () {
    var H = window.Hourglass, p = H.perf;
    return {
      checks: __mon.checks, fails: __mon.censusFails.length, first: __mon.censusFails[0] || null,
      perf: !!(p && p.frameMs && p.frameMs.length === 600 && p.simMs && p.simMs.length === 600 &&
               typeof p.i === 'number' && typeof p.quality === 'number' && typeof p.emaSim === 'number')
    };
  });
  s.check(label + ': census exact every 15 frames', m.fails === 0 && m.checks > 0,
          m.checks + ' checks, ' + m.fails + ' failures' + (m.first ? ' ' + JSON.stringify(m.first) : ''));
  s.check(label + ': no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  s.check(label + ': Hourglass.perf rings readable', m.perf);
}

/** p-th percentile of a numeric array. */
function pct(a, p) {
  if (!a.length) return NaN;
  var b = a.slice().sort(function (x, y) { return x - y; });
  return b[Math.min(b.length - 1, Math.max(0, Math.ceil(p / 100 * b.length) - 1))];
}

/** The perf rings since slot `from` (wrapping), as plain arrays. */
async function perfSince(t, from, n) {
  return t.page.evaluate(function (a) {
    var p = window.Hourglass.perf, out = { frame: [], sim: [], draw: [], interval: [], quality: p.quality };
    var i = a.from, k = 0;
    while (i !== p.i && k < 600) {
      out.frame.push(p.frameMs[i]); out.sim.push(p.simMs[i]); out.draw.push(p.drawMs[i]); out.interval.push(p.intervalMs[i]);
      i = (i + 1) % 600; k++;
    }
    return out;
  }, { from: from });
}

/**
 * Collect the perf rings over a long stretch (they hold 600 frames): call
 * poll() at least every few seconds, and stop() for everything gathered.
 */
async function perfWatch(t) {
  var w = { frame: [], sim: [], draw: [], interval: [], quality: [] };
  var at = await t.page.evaluate(function () { return window.Hourglass.perf.i; });
  w.poll = async function () {
    var p = await perfSince(t, at);
    at = (at + p.frame.length) % 600;
    w.frame = w.frame.concat(p.frame); w.sim = w.sim.concat(p.sim);
    w.draw = w.draw.concat(p.draw); w.interval = w.interval.concat(p.interval);
    w.quality.push(p.quality);
    return w;
  };
  /** Wait ms, polling the rings meanwhile. */
  w.wait = async function (ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
      await sleep(Math.min(3000, end - Date.now()));
      await w.poll();
    }
  };
  return w;
}

module.exports = {
  REPO: REPO, sleep: sleep, start: start, Suite: Suite, invariants: invariants, pct: pct,
  perfSince: perfSince, perfWatch: perfWatch, treeProblems: treeProblems, standInPaths: standInPaths
};
