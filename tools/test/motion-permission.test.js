/*
 * audio-motion acceptance 5: motion.js permission flow, in Chromium.
 *
 * Both requestPermission functions are stubbed before any page script runs:
 * each counts its calls, records navigator.userActivation.isActive at the
 * moment it is called, and resolves window.__perm. Then:
 *
 *   - m.request() inside a tap's click handler calls both, synchronously
 *     (counts 1 and 1 when request() returns, user activation live at each)
 *   - 'denied' resolves 'denied'; a rejection rejects; nothing to ask grants
 *   - real DeviceMotionEvent / DeviceOrientationEvent objects, dispatched
 *     the way the integration tests will, reach motion.js: the iOS sign is
 *     learnt and a jerk to +x reads as felt −x
 *
 *   node tools/test/motion-permission.test.js [port]     (default 8803)
 */
'use strict';
var path = require('path');
var chromium = require('playwright').chromium;
var Server = require('./lib/static-server.js');

var ROOT = path.resolve(__dirname, '..', '..');
var PORT = +(process.argv[2] || process.env.PORT || 8803);
var BASE = 'http://127.0.0.1:' + PORT;

var failures = 0, cases = 0;
function report(ok, name, detail) {
  cases++;
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

var PAGE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<body style="margin:0"><button id="ask" style="width:300px;height:200px">ask</button>' +
  '<script src="/motion.js"></script>' +
  '<script>' +
  'window.m = new HourglassMotion({ sign: 0 });' +
  'document.getElementById("ask").addEventListener("click", function () {' +
  '  var p = window.m.request();' +
  '  window.__sync = [window.__dm.calls, window.__do.calls];' +   // counts the moment request() returned
  '  p.then(function (r) { window.__result = r; }, function (e) { window.__result = "rejected: " + (e && e.name); });' +
  '});' +
  '</script>';

// Runs before any page script: the permission stubs.
function stubs() {
  window.__perm = 'granted';
  window.__reject = false;
  function make(name) {
    var rec = { calls: 0, active: [] };
    window[name] = rec;
    return function () {
      rec.calls++;
      rec.active.push(!!(navigator.userActivation && navigator.userActivation.isActive));
      return window.__reject ? Promise.reject(new DOMException('no', 'NotAllowedError')) : Promise.resolve(window.__perm);
    };
  }
  if (window.DeviceMotionEvent) DeviceMotionEvent.requestPermission = make('__dm');
  if (window.DeviceOrientationEvent) DeviceOrientationEvent.requestPermission = make('__do');
}

async function main() {
  var server = await new Promise(function (res, rej) {
    var s = Server.start(PORT, ROOT, function () { res(s); });
    s.on('error', rej);
  });
  var browser = await chromium.launch();
  try {
    var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await ctx.addInitScript(stubs);
    await ctx.addInitScript({ path: path.join(__dirname, 'lib', 'profiles.js') });
    var page = await ctx.newPage();
    var errors = [];
    page.on('pageerror', function (e) { errors.push(e.message); });
    page.on('console', function (msg) { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.route(BASE + '/__motion-permission.html', function (r) { r.fulfill({ contentType: 'text/html', body: PAGE }); });
    await page.goto(BASE + '/__motion-permission.html');

    // ---- granted, inside a tap ------------------------------------------------
    var needs = await page.evaluate(function () { return window.m.needsPermission; });
    await page.tap('#ask');
    await page.waitForFunction(function () { return window.__result !== undefined; });
    var r1 = await page.evaluate(function () {
      return { sync: window.__sync, dm: window.__dm, do: window.__do, result: window.__result };
    });
    report(needs === true && r1.sync[0] === 1 && r1.sync[1] === 1 && r1.dm.active[0] === true && r1.do.active[0] === true && r1.result === 'granted',
           'request() in a tap calls both synchronously, with user activation',
           'needsPermission ' + needs + ', counts at return ' + JSON.stringify(r1.sync) + ', isActive ' + r1.dm.active[0] + '/' + r1.do.active[0] + ', result ' + r1.result);

    // ---- denied -----------------------------------------------------------------
    await page.evaluate(function () { window.__perm = 'denied'; window.__result = undefined; });
    await page.tap('#ask');
    await page.waitForFunction(function () { return window.__result !== undefined; });
    var r2 = await page.evaluate(function () { return { sync: window.__sync, result: window.__result }; });
    report(r2.result === 'denied' && r2.sync[0] === 2 && r2.sync[1] === 2, "'denied' resolves 'denied'", 'result ' + r2.result + ', counts ' + JSON.stringify(r2.sync));

    // ---- motion granted but orientation denied is not access ----------------------
    var r3 = await page.evaluate(function () {
      var dmFn = DeviceMotionEvent.requestPermission;
      DeviceOrientationEvent.requestPermission = function () { return Promise.resolve('denied'); };
      window.__perm = 'granted';
      return window.m.request().then(function (r) { DeviceOrientationEvent.requestPermission = dmFn; return r; });
    });
    report(r3 === 'denied', "orientation 'denied' with motion 'granted' resolves 'denied'", 'result ' + r3);

    // ---- a refusal to ask (no gesture on WebKit) rejects ----------------------------
    var r4 = await page.evaluate(function () {
      window.__reject = true;
      return window.m.request().then(function (r) { return 'resolved ' + r; }, function (e) { return 'rejected ' + (e && e.name); }).then(function (x) { window.__reject = false; return x; });
    });
    report(r4 === 'rejected NotAllowedError', 'a refused request rejects', r4);

    // ---- nothing to ask: granted; no sensors at all: unavailable ---------------------
    var r5 = await page.evaluate(function () {
      var a = DeviceMotionEvent.requestPermission, b = DeviceOrientationEvent.requestPermission;
      delete DeviceMotionEvent.requestPermission; delete DeviceOrientationEvent.requestPermission;
      var m2 = new HourglassMotion({});
      return m2.request().then(function (r) {
        DeviceMotionEvent.requestPermission = a; DeviceOrientationEvent.requestPermission = b;
        return { needs: m2.needsPermission, result: r };
      });
    });
    report(r5.result === 'granted' && r5.needs === false, 'no requestPermission (Android, desktop): granted, nothing to ask', JSON.stringify(r5));
    var r6 = await page.evaluate(function () {
      var DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent;
      window.DeviceMotionEvent = undefined; window.DeviceOrientationEvent = undefined;
      return new HourglassMotion({}).request().then(function (r) { window.DeviceMotionEvent = DM; window.DeviceOrientationEvent = DO; return r; });
    });
    report(r6 === 'unavailable', "no sensor events at all: 'unavailable'", r6);

    // ---- real events through the real DOM ------------------------------------------
    var r7 = await page.evaluate(function () {
      var P = window.HourglassProfiles, m = new HourglassMotion({ sign: 0 }), out = {}, signs = [];
      m.onsign = function (s) { signs.push(s); };
      m.start();
      return new Promise(function (resolve) {
        var t0 = performance.now(), n = 0, minX = 0, xs = [];
        var id = setInterval(function () {
          var t = (performance.now() - t0) / 1000;
          var f = { x: t >= 1.2 && t < 1.35 ? -1.5 : 0, y: 0, z: 0, w: 0 };   // a 150 ms device jerk to +x
          var ev = P.deviceEvent(f, { conv: 'ios' });
          window.dispatchEvent(new DeviceMotionEvent('devicemotion', ev));
          window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', P.orientationEvent({})));
          m.sample(performance.now(), out);
          if (t >= 1.2 && t < 1.6) { minX = Math.min(minX, out.x); xs.push(+out.x.toFixed(2)); }
          if (++n >= 110) {
            clearInterval(id);
            m.stop();
            resolve({ sign: m.sign, locked: m.locked, signs: signs, seenMotion: m.seenMotion, seenOrient: m.seenOrient, heading: m.heading, minX: minX, xs: xs.slice(0, 12) });
          }
        }, 1000 / 60);
      });
    });
    report(r7.sign === -1 && r7.locked && r7.signs.length === 1 && r7.seenMotion && r7.seenOrient && Math.abs(r7.heading) < 1e-9 && r7.minX < -1.2,
           'real DOM events: iOS sign learnt; a jerk to +x reads felt −x',
           'sign ' + r7.sign + (r7.locked ? ' (learnt)' : '') + ', onsign ' + JSON.stringify(r7.signs) + ', heading ' + r7.heading + ', min felt x ' + r7.minX.toFixed(2) + ' g');

    report(errors.length === 0, 'no page or console errors', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (cases - failures) + '/' + cases + ' passed');
  process.exit(failures ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
