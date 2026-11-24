/*
 * The app on an emulated iPhone, driven as a person drives it, for the
 * replay suites (development only, not shipped).
 *
 *   var I = require('./lib/replay-iphone.js');
 *   var env = await I.launch();                    // its own server (--root, --port) and Chromium
 *   var t = await env.open({ reducedMotion: false, permission: 'granted' });
 *   await t.finger.tap(x, y);                      // real touch and pointer events (CDP)
 *   await t.phone.play('vigorousZ');               // real devicemotion/deviceorientation at 60 Hz
 *   var log = await t.log();                       // what happened to the glass (lib/replay-probe.js)
 *   await env.close();
 *
 * The page is an iPhone 12 (390 x 844, touch, mobile UA, device pixel ratio
 * 2), service workers blocked. Before any page script it gets
 * lib/replay-streams.js and lib/replay-probe.js.
 *
 * Two things differ from a real iPhone and are worth knowing when a replay
 * misbehaves. This machine has no GPU, so WebGL is switched off inside the
 * page and the app draws its own 2-D glass (a WebGL glass turning in
 * software takes 0.1 to 0.7 s a frame, and every spin is lost). And touch
 * events reach the page late and in clumps when the machine is busy (gaps
 * of 20 to 90 ms where a phone gives 8 to 16), which makes a dragged glass
 * lurch after the finger: the suites measure what the glass actually did
 * (the speed of each blow, the gap between taps) and repeat a take whose
 * input came out wrong, never one whose result did.
 */
'use strict';
var path = require('path');
var playwright = require('playwright');
var staticServer = require('./static-server.js');

var REPO = require('./paths.js').ROOT;
var seed = require('./seed.js');
var tune = require('./tune.js');
var PROBE = path.join(__dirname, 'replay-probe.js');
var STREAMS = path.join(__dirname, 'replay-streams.js');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** Deterministic noise for finger scatter (mulberry32). */
function rng(seed) {
  var a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { return (r() + r() + r() + r() - 2) * 1.732; }

function parseArgs() {
  var a = process.argv.slice(2), o = { root: process.env.HOURGLASS_ROOT || REPO, port: +process.env.PORT || 8805, only: null };
  for (var i = 0; i < a.length; i++) {
    if (a[i] === '--root') o.root = path.resolve(a[++i]);
    else if (a[i] === '--port') o.port = +a[++i];
    else if (a[i] === '--only') o.only = a[++i];
  }
  return o;
}

/**
 * A finger on the screen. What an iPhone is understood to report for a
 * fingertip (not verified on a device): a radius of about 22 CSS px and
 * force 0 (no 3D Touch since the iPhone 11).
 */
function makeFinger(cdp) {
  var f = {
    x: 0, y: 0,
    pt: function (x, y) { return { x: x, y: y, id: 1, radiusX: 22, radiusY: 22, force: 0 }; },
    down: function (x, y) {
      f.x = x; f.y = y;
      return cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [f.pt(x, y)] });
    },
    move: function (x, y) {
      f.x = x; f.y = y;
      return cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [f.pt(x, y)] });
    },
    up: function () { return cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); },
    /** Several fingers at once: type 'touchStart' | 'touchMove', pts [[x, y], ...] (ids 1, 2, ...). up() lifts them all. */
    fingers: function (type, pts) {
      return cdp.send('Input.dispatchTouchEvent', { type: type, touchPoints: pts.map(function (q, i) {
        return { x: q[0], y: q[1], id: i + 1, radiusX: 22, radiusY: 22, force: 0 };
      }) });
    },
    /**
     * Two fingers on a level line through (cx, cy), the gap between them
     * going from `from` to `to` px over ms (one touchmove every 8 ms), then
     * lifted; hold: they stay down.
     */
    pinch: async function (cx, cy, from, to, ms, hold) {
      var two = function (gap) { return [[cx - gap / 2, cy], [cx + gap / 2, cy]]; };
      await f.fingers('touchStart', two(from));
      var t0 = Date.now();
      for (;;) {
        var u = Math.min(1, (Date.now() - t0) / (ms || 260));
        await f.fingers('touchMove', two(from + (to - from) * u));
        if (u >= 1) break;
        await sleep(8);
      }
      if (!hold) await f.up();
    },
    /** A tap: down, a short contact (60 to 90 ms for a quick fingertip tap), up. */
    tap: async function (x, y, holdMs) {
      await f.down(x, y);
      await sleep(holdMs === undefined ? 65 : holdMs);
      await f.up();
    },
    /**
     * Move along fn(u) -> {x, y}, u from 0 to 1 over ms of wall time, one
     * touchmove every 8 ms, sent on the clock (not one after the other's
     * acknowledgement). lift: the finger leaves while still moving (a flick
     * or a throw): the last move and the lift go out together.
     */
    path: async function (fn, ms, lift) {
      var t0 = Date.now(), sent = [], fail = null;
      var note = function (e) { fail = fail || e; };
      for (;;) {
        var u = Math.min(1, (Date.now() - t0) / ms), p = fn(u);
        f.x = p.x; f.y = p.y;
        sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [f.pt(p.x, p.y)] }).catch(note));
        if (u >= 1) break;
        await sleep(8);
      }
      if (lift) sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(note));
      await Promise.all(sent);
      if (fail) throw fail;
    }
  };
  return f;
}

/** The suite's own server and browser (Chromium as Playwright launches it, no options). */
async function launch() {
  var a = parseArgs();
  var server = await new Promise(function (resolve, reject) {
    var s = staticServer.start(a.port, a.root, function () { resolve(s); });
    s.on('error', reject);
  });
  var browser = await playwright.chromium.launch();
  var env = {
    args: a, root: a.root, base: 'http://127.0.0.1:' + a.port + '/', browser: browser, server: server,
    open: function (o) { return open(env, o || {}); },
    close: async function () {
      try { await browser.close(); } catch (e) {}
      await new Promise(function (r) { server.close(function () { r(); }); setTimeout(r, 500); });
    }
  };
  console.log('serving ' + a.root + ' at ' + env.base + ' (emulated iPhone 12, DPR 2, the 2-D glass)');
  return env;
}

/**
 * Open the app. Options:
 *   query           appended to the URL
 *   reducedMotion   emulate prefers-reduced-motion: reduce
 *   permission      what DeviceMotionEvent.requestPermission resolves to
 *                   ('granted' | 'denied'); null: no such API (Android, desktop)
 *   storage         localStorage to seed, {key: value} (Real sand off unless it says realSand: true)
 */
async function open(env, o) {
  var dev = playwright.devices['iPhone 12'];
  var context = await env.browser.newContext({
    userAgent: dev.userAgent,
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference',
    serviceWorkers: 'block'
  });
  await context.addInitScript(function (cfg) { window.__probeCfg = cfg; },
    { permission: o.permission === undefined ? 'granted' : o.permission, webgl: false });
  await context.addInitScript({ path: STREAMS });
  await context.addInitScript({ path: PROBE });
  // { v: 2, realSand: false } under what the caller seeds (lib/seed.js: Real sand is the app's default)
  await context.addInitScript(seed.seedOnce, seed.storageFor(o));
  var page = await context.newPage();
  var errors = [];
  page.on('pageerror', function (e) { errors.push('pageerror: ' + (e && e.message)); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(env.base + (o.query || ''));
  await page.waitForFunction(function () { return window.Hourglass && window.__probe && window.__probe.hooked; }, null, { timeout: 20000 });
  await sleep(1700);                                   // the app fades up from dark
  var cdp = await context.newCDPSession(page);
  var t = {
    context: context, page: page, cdp: cdp, errors: errors,
    finger: makeFinger(cdp),
    eval: function (fn, arg) { return page.evaluate(fn, arg); },
    /** Where the glass is on screen, the lattice under it, and the room it has. */
    glass: function () {
      return page.evaluate(function () {
        var H = window.Hourglass, s = H.sim, rm = H.room;
        var r = document.getElementById('assembly').getBoundingClientRect();
        var c = document.getElementById('c-sand').getBoundingClientRect();
        return {
          cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top,
          W: s.W, H: s.H, gateY: s.gateY, HB: s.geo.HB, R: s.geo.R, pxPerCell: c.width / s.W,
          room: { x0: rm.x0, x1: rm.x1, y0: rm.y0, g: rm.g },
          zen: document.getElementById('app').classList.contains('zen'), state: H.timer.state
        };
      });
    },
    /** Tune > Real motion, switched on by a real tap on its row (the only way a person can; the row's haptic label lies over the switch). */
    realMotionOn: async function () {
      await tune.tap(page, 'label[for="opt-tilt"]');   // (Tune opened, the row's tab shown: lib/tune.js)
      await sleep(300);
      await tune.close(page);
      await sleep(100);
      return page.evaluate(function () { return { on: window.Hourglass.grav.on, perms: window.__probe.perms }; });
    },
    mark: function () { return page.evaluate(function () { window.__probe.reset(); }); },
    log: function () { return page.evaluate(function () { return window.__probe.dump(); }); },
    close: function () { return context.close(); }
  };
  t.phone = {
    /** Play a sensor stream (lib/replay-streams.js name, or {G, f, axis, dur}) as real sensor events, 60 a second. */
    play: async function (name, opts) {
      opts = opts || {};
      await page.evaluate(function (a) { window.__phone.play(a.name, a.opts); }, { name: name, opts: opts });
      if (opts.wait === false) return;
      var dur = opts.durS || (await page.evaluate(function () { return window.__phone.dur(); }));
      await sleep(dur * 1000 + 100);
    },
    stop: function () { return page.evaluate(function () { window.__phone.stop(); }); }
  };
  return t;
}

/** First time (s from mark) of event kind k in a recorder dump, or null; and how many. */
function first(log, k) {
  for (var i = 0; i < log.events.length; i++) if (log.events[i].k === k) return log.events[i].t / 1000;
  return null;
}
function count(log, k) {
  var n = 0;
  for (var i = 0; i < log.events.length; i++) if (log.events[i].k === k) n++;
  return n;
}

/** A suite's checks, printed as they are made. */
function Suite(name) { this.name = name; this.results = []; this.t0 = Date.now(); }
Suite.prototype.check = function (label, ok, detail) {
  this.results.push({ label: label, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  return !!ok;
};
Suite.prototype.note = function (label, detail) { console.log('NOTE  ' + label + (detail ? '  — ' + detail : '')); };
Suite.prototype.done = function () {
  var failed = this.results.filter(function (r) { return !r.ok; }).length, n = this.results.length;
  console.log(this.name + ': ' + (n - failed) + '/' + n + ' passed in ' + ((Date.now() - this.t0) / 1000).toFixed(1) + ' s');
  if (failed) process.exitCode = 1;
  return failed === 0;
};

module.exports = { REPO: REPO, sleep: sleep, rng: rng, gauss: gauss, launch: launch, first: first, count: count, Suite: Suite };
