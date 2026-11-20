/*
 * Lab: the sand test page (lab/sand/), headless.
 *
 * The page runs position-based MPM sand on WebGPU. Here WebGPU runs in
 * Chromium's software renderer (SwiftShader), which is slow, so every case
 * runs on the coarse grid with a reduced amount of sand and drives time
 * itself with __lab.step(n) (n substeps, awaiting the GPU), never in real
 * time. Nothing measured here says anything about a phone's speed.
 *
 *   1 load      the page loads, finds a WebGPU adapter, no page errors;
 *               nothing outside the glass, nothing not finite; without
 *               WebGPU it says what is needed (control)
 *   2 heaps     a column released in the lower bulb settles to a heap:
 *               coarse sand at 28 to 38 degrees, fine sand lower than
 *               coarse, water nearly flat (under 5)
 *   3 lean      a settled coarse heap leaned 20 degrees keeps its shape in
 *               the glass (its surface turns with the glass, its centre of
 *               mass stays) and its slope against gravity; water (control)
 *               levels; leaned 45 degrees the sand avalanches
 *   4 spin      gravity turning 360 degrees a second for 10 s, then 3 to 5 g
 *               shakes for 3 s: finite, nothing leaves the glass, every
 *               material point kept; at rest within about 2 s after
 *   5 flip      the Flip pours the sand through the neck into the other
 *               bulb, and back again
 *   6 flow      the rate through the neck of an upright glass, with the top
 *               three-quarters and a quarter full: sand about the same
 *               (ratio near 1, as in a real hourglass), water (control)
 *               slower as the head falls (ratio clearly above 1)
 *   7 inputs    a push to the right throws the sand to the left wall, a
 *               tilt to the right sends it right; through the scripted
 *               field, the finger drag and DeviceMotion readings (both
 *               sign conventions)
 *   8 tools     a short benchmark gives its rows; the report has the user
 *               agent, the adapter, the rows and the flow numbers
 *
 * Screenshots of the key moments go to --shots (a phone-like 390 x 844
 * viewport, device scale 1).
 *
 *   node tools/test/lab-sand.test.js [--port <n>] [--only 2,6] [--shots <dir>]
 */
'use strict';
var path = require('path');
var fs = require('fs');
var srv = require('./lib/static-server.js');
var playwright = require('playwright');

function arg(name, def) {
  var i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
var PORT = parseInt(arg('--port', process.env.PORT || '8995'), 10);
var ONLY = (arg('--only', '') || '').split(',').filter(Boolean).map(Number);
var SHOTS = arg('--shots', '');
var ROOT = path.resolve(__dirname, '..', '..');
var URL0 = 'http://127.0.0.1:' + PORT + '/lab/sand/?offscreen=1&res=S&amount=minute';

var failures = 0, count = 0, t0 = Date.now();
function log(s) { console.log(s); }
function check(cond, what) {
  count++;
  if (cond) log('  ok    ' + what);
  else { failures++; log('  FAIL  ' + what); }
  return cond;
}
var f1 = function (v) { return typeof v === 'number' && isFinite(v) ? v.toFixed(1) : String(v); };
var f2 = function (v) { return typeof v === 'number' && isFinite(v) ? v.toFixed(2) : String(v); };

async function main() {
  var server = srv.start(PORT, ROOT);
  var browser = await playwright.chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  var errors = [];
  var page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  var L = function (fn, a) { return page.evaluate(fn, a); };
  var shot = async function (name) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  var sec = async function (s, chunk) {           // simulated seconds, in chunks
    var n = await L(function (s) { return window.__lab.steps(s); }, s);
    return L(function (n) { return window.__lab.step(n); }, n);
  };
  var run = function (k) { return !ONLY.length || ONLY.indexOf(k) >= 0; };

  await page.goto(URL0);
  var info = await L(function () { return window.__lab.ready; });
  await L(function () { window.__lab.manual(true); });
  log('adapter: ' + JSON.stringify(info.adapter) + '; glass ' + info.glass.W + 'x' + info.glass.H + ', neck ' + f1(info.glass.neckCells) + ' cells (widened ' + Math.round(info.glass.neckWidened * 100) + '%)');

  /* ---- 1 ------------------------------------------------------------ */
  if (run(1)) {
    log('1 load');
    check(!!(info.adapter && (info.adapter.vendor || info.adapter.architecture || info.adapter.description || info.adapter.device !== undefined)), 'a WebGPU adapter: ' + JSON.stringify(info.adapter));
    await L(function () { return window.__lab.reset({ fill: 'top', amount: 'minute' }); });
    await sec(0.5);
    var st = await L(function () { return window.__lab.stats(); });
    log('  points ' + st.count + ', outside ' + st.outside + ', not finite ' + st.nan + ', closest to the wall ' + f2(st.minDist) + ' cells');
    check(st.count > 1000 && st.outside === 0 && st.nan === 0, 'nothing outside the glass, nothing not finite');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
    await shot('01-loaded');
    // control: a browser without WebGPU is told what it needs
    var p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p2.addInitScript(function () { Object.defineProperty(Navigator.prototype, 'gpu', { get: function () { return undefined; } }); });
    await p2.goto(URL0);
    await p2.waitForFunction(function () { return !document.getElementById('notice').hidden; }, null, { timeout: 15000 }).catch(function () {});
    var note = await p2.evaluate(function () { var n = document.getElementById('notice'); return n.hidden ? '' : n.textContent; });
    check(/iOS 26/.test(note) && /Settings, General, About/.test(note), 'without WebGPU the page says it needs iOS 26 in Safari');
    await p2.close();
  }

  /* ---- 2 ------------------------------------------------------------ */
  var heap = {};
  if (run(2) || run(3)) {
    log('2 heaps (a column released in the lower bulb, 2.5 s)');
    for (var m of ['coarse', 'fine', 'water']) {
      await L(function (m) { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'column', material: m }); }, m);
      await sec(2.5);
      var h = await L(function () { return window.__lab.heapAngle({ bulb: 'lower' }); });
      var s2 = await L(function () { return window.__lab.stats(); });
      heap[m] = h;
      log('  ' + m.padEnd(7) + ' heap: left ' + f1(h.left) + ', right ' + f1(h.right) + ', mean ' + f1(h.mean) + ' degrees; mean speed ' + f1(s2.meanSpeed) + ' cells/s');
      await shot('02-heap-' + m);
    }
    if (run(2)) {
      check(heap.coarse.mean >= 28 && heap.coarse.mean <= 38, 'coarse sand heaps at 28 to 38 degrees (' + f1(heap.coarse.mean) + ')');
      check(heap.fine.mean < heap.coarse.mean, 'fine sand lower than coarse (' + f1(heap.fine.mean) + ' < ' + f1(heap.coarse.mean) + ')');
      check(heap.water.mean < 5, 'water nearly flat (' + f1(heap.water.mean) + ' < 5)');
    }
  }

  /* ---- 3 ------------------------------------------------------------ */
  if (run(3)) {
    log('3 lean');
    var lean = async function (m, deg, secs) {
      var a = deg * Math.PI / 180;
      await L(function (a) { window.__lab.setInput({ mode: 'manual', gravity: [Math.sin(a), Math.cos(a)] }); }, a);
      await sec(secs);
      return {
        g: await L(function () { return window.__lab.heapAngle({ bulb: 'lower', frame: 'gravity' }); }),
        glass: await L(function () { return window.__lab.heapAngle({ bulb: 'lower', frame: 'glass' }); }),
        st: await L(function () { return window.__lab.stats(); })
      };
    };
    var res = {};
    for (var m3 of ['coarse', 'water']) {
      await L(function (m) { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'column', material: m }); }, m3);
      await sec(2.5);
      var before = await lean(m3, 0, 0.05);
      var at20 = await lean(m3, 20, 1.5);
      if (m3 === 'coarse') await shot('03-lean20-coarse');
      res[m3] = { before: before, at20: at20 };
      log('  ' + m3.padEnd(6) + ' upright: surface tilt in the glass ' + f1(before.glass.tilt) + ', flanks ' + f1(before.g.left) + '/' + f1(before.g.right) + ', centre (' + f1(before.st.com[0]) + ', ' + f1(before.st.com[1]) + ')');
      log('  ' + m3.padEnd(6) + ' 20 deg:  surface tilt in the glass ' + f1(at20.glass.tilt) + ', to gravity ' + f1(at20.g.tilt) + ', flanks to gravity ' + f1(at20.g.left) + '/' + f1(at20.g.right) + ', centre (' + f1(at20.st.com[0]) + ', ' + f1(at20.st.com[1]) + ')');
      if (m3 === 'coarse') {
        var at45 = await lean(m3, 45, 2);
        res.coarse.at45 = at45;
        await shot('03-lean45-coarse');
        log('  coarse 45 deg:  flanks to gravity ' + f1(at45.g.left) + '/' + f1(at45.g.right) + ', steepest ' + f1(at45.g.steepest) + ', centre (' + f1(at45.st.com[0]) + ', ' + f1(at45.st.com[1]) + ')');
      }
    }
    var c = res.coarse, w = res.water;
    var dTiltSand = Math.abs(c.at20.glass.tilt - c.before.glass.tilt), dTiltWater = Math.abs(w.at20.glass.tilt - w.before.glass.tilt);
    var moveSand = Math.hypot(c.at20.st.com[0] - c.before.st.com[0], c.at20.st.com[1] - c.before.st.com[1]);
    var moveWater = Math.hypot(w.at20.st.com[0] - w.before.st.com[0], w.at20.st.com[1] - w.before.st.com[1]);
    log('  surface turned in the glass: sand ' + f1(dTiltSand) + ' deg, water ' + f1(dTiltWater) + ' deg; centre of mass moved: sand ' + f1(moveSand) + ', water ' + f1(moveWater) + ' cells');
    check(dTiltWater > 14, 'water (control) levels when leaned 20 degrees (its surface turns ' + f1(dTiltWater) + ' degrees in the glass)');
    check(dTiltSand < 8, 'sand does not level: its surface turns under 8 degrees in the glass (' + f1(dTiltSand) + ')');
    // what moves is the flank the lean made too steep, which avalanches; a bed that turned or slid as a block would carry its centre as far as the water's
    check(moveSand < 0.25 * moveWater, 'sand does not turn or slide as a block: its centre moves ' + f1(moveSand) + ' cells, under a quarter of the water\'s ' + f1(moveWater));
    check(Math.abs(c.at20.g.tilt) >= 0.6 * 20, 'sand keeps most of the lean as a slope against gravity: its surface stands at ' + f1(Math.abs(c.at20.g.tilt)) + ' degrees to the field (at least 12 of the 20)');
    var down45 = (c.at45.st.com[0] - c.at20.st.com[0]);
    check(c.at45.g.steepest <= 40 && down45 > 2, 'leaned 45 degrees it avalanches: steepest flank ' + f1(c.at45.g.steepest) + ' <= 40 degrees, centre moved ' + f1(down45) + ' cells downhill');
  }

  /* ---- 4 ------------------------------------------------------------ */
  if (run(4)) {
    log('4 spin and shake');
    await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'lower', material: 'coarse', points: 3000 }); });
    await sec(0.5);
    var s0 = await L(function () { return window.__lab.stats(); });
    await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], gravitySpin: 2 * Math.PI }); });
    var okSpin = true, worst = 0;
    for (var k = 0; k < 10; k++) {
      await sec(1);
      var sk = await L(function () { return window.__lab.stats(); });
      worst = Math.max(worst, sk.maxSpeed);
      if (sk.nan || sk.outside || sk.count !== s0.count) okSpin = false;
      if (k === 4) await shot('04-spin');
    }
    var s1 = await L(function () { return window.__lab.stats(); });
    log('  after 10 s of spinning gravity: points ' + s1.count + '/' + s0.count + ', outside ' + s1.outside + ', not finite ' + s1.nan + ', fastest ' + f1(worst) + ' cells/s, clamp hits ' + s1.clamped);
    check(okSpin, 'spinning gravity: finite, nothing outside, every point kept, each second for 10 s');
    var okShake = true;
    var shakes = [{ g: 3, hz: 4, axis: [1, 0] }, { g: 5, hz: 5, axis: [0, 1] }, { g: 4, hz: 3, axis: [0.7071, 0.7071] }];
    for (var j = 0; j < 3; j++) {
      await L(function (sh) { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], shake: sh }); }, shakes[j]);
      await sec(1);
      var sj = await L(function () { return window.__lab.stats(); });
      if (sj.nan || sj.outside || sj.count !== s0.count) okShake = false;
      if (j === 1) await shot('04-shake');
    }
    var s3 = await L(function () { return window.__lab.stats(); });
    log('  after 3 s of 3 to 5 g shakes: outside ' + s3.outside + ', not finite ' + s3.nan + ', mean speed ' + f1(s3.meanSpeed) + ' cells/s');
    check(okShake, '3 to 5 g shakes: finite, nothing outside, every point kept');
    await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
    var settle = [];
    for (var q = 0; q < 6; q++) { await sec(0.5); settle.push(await L(function () { return window.__lab.stats(); })); }
    var vRef = Math.sqrt(2 * settle[0].g * 10);         // the speed of a fall of 10 cells
    log('  settling (mean speed, cells/s, every 0.5 s): ' + settle.map(function (x) { return f1(x.meanSpeed); }).join(', ') + '; reference ' + f1(vRef));
    var restAt = -1;
    for (var r = 0; r < settle.length; r++) if (settle[r].meanSpeed < 0.05 * vRef) { restAt = (r + 1) * 0.5; break; }
    check(restAt > 0 && restAt <= 2, 'at rest within about 2 s after the shake (mean speed under 5 % of a 10-cell fall at ' + restAt + ' s)');
  }

  /* ---- 5 ------------------------------------------------------------ */
  if (run(5)) {
    log('5 flip');
    await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'lower', material: 'coarse', points: 3000 }); });
    await sec(0.5);
    var a0 = await L(function () { return window.__lab.stats(); });
    await L(function () { window.__lab.flip(); });
    await sec(0.9);
    await shot('05-flip-mid');
    await sec(0.3 + 2.5);
    var a1 = await L(function () { return window.__lab.stats(); });
    var hl = await L(function () { return window.__lab.heapAngle({ bulb: 'upper' }); });
    await shot('05-flip-poured');
    log('  before: above ' + a0.above + ', below ' + a0.below + '; 2.5 s after the turn: above (now under the neck) ' + a1.above + ', below (now on top) ' + a1.below + '; the cone under the neck ' + f1(hl.left) + '/' + f1(hl.right) + ' degrees');
    check(a1.above > 0.6 * a0.count, 'the sand pours through the neck into the other bulb (' + a1.above + ' of ' + a0.count + ')');
    await L(function () { window.__lab.flip(); });
    await sec(1.2 + 3);
    var a2 = await L(function () { return window.__lab.stats(); });
    log('  flipped back: below ' + a2.below + ' of ' + a2.count);
    check(a2.below > 0.6 * a2.count, 'and pours back the other way (' + a2.below + ' of ' + a2.count + ')');
    check(a2.outside === 0 && a2.nan === 0, 'nothing outside the glass, nothing not finite');
  }

  /* ---- 6 ------------------------------------------------------------ */
  var flows = {};
  if (run(6) || run(8)) {
    log('6 flow through the neck (upright, from a full top bulb of 5,000 points)');
    for (var m6 of ['coarse', 'water']) {
      await L(function () { window.__lab.setInput({ mode: 'upright' }); });
      var fr = await L(function (m) { return window.__lab.flowTest({ material: m, points: 5000, chunk: 24, limit: 40 }); }, m6);
      flows[m6] = fr;
      if (fr) log('  ' + m6.padEnd(6) + ' rate at 3/4 full ' + f1(fr.rate75) + ' points/s (' + f1(fr.grains75) + ' app grains/s), at 1/4 full ' + f1(fr.rate25) + ' (' + f1(fr.grains25) + '); ratio ' + f2(fr.ratio) + '; drained in ' + f1(fr.duration) + ' s');
      if (fr) log('         rate against fill: ' + fr.curve.map(function (p) { return p.fill + ':' + Math.round(p.rate); }).join(' '));
      if (m6 === 'coarse') await shot('06-flow-coarse-end');
    }
    if (run(6)) {
      check(flows.water && flows.water.ratio > 1.3, 'water (control) slows as the top empties: ratio ' + f2(flows.water && flows.water.ratio) + ' > 1.3');
      check(flows.coarse && flows.coarse.ratio > 0.8 && flows.coarse.ratio < 1.25, 'sand runs at a near-constant rate: ratio ' + f2(flows.coarse && flows.coarse.ratio) + ' within 0.8 to 1.25');
    }
  }

  /* ---- 7 ------------------------------------------------------------ */
  if (run(7)) {
    log('7 inputs');
    var bed = async function () {
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'lower', material: 'coarse', points: 3000 }); });
      await sec(0.5);
      return L(function () { return window.__lab.stats(); });
    };
    var b0 = await bed();
    await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], accel: [3, 0] }); });
    await sec(0.15);
    var push = await L(function () { return window.__lab.stats(); });
    await shot('07-push-right');
    b0 = await bed();
    await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], accel: [-3, 0] }); });
    await sec(0.15);
    var pushL = await L(function () { return window.__lab.stats(); });
    log('  push right 3 g: centre x ' + f1(b0.com[0]) + ' -> ' + f1(push.com[0]) + '; push left (control): -> ' + f1(pushL.com[0]));
    check(push.com[0] < b0.com[0] - 1 && pushL.com[0] > b0.com[0] + 1, 'a push to the right throws the sand left, a push to the left throws it right');
    b0 = await bed();
    var a = 30 * Math.PI / 180;
    await L(function (a) { window.__lab.setInput({ mode: 'manual', gravity: [Math.sin(a), Math.cos(a)] }); }, a);
    await sec(0.8);
    var tilt = await L(function () { return window.__lab.stats(); });
    log('  tilt right 30 deg: centre x ' + f1(b0.com[0]) + ' -> ' + f1(tilt.com[0]));
    check(tilt.com[0] > b0.com[0] + 1, 'a tilt to the right sends the sand to the right');
    // the finger: a quick drag to the right
    b0 = await bed();
    await L(function () { window.__lab.setInput({ mode: 'upright' }); window.__lab.drag({ dx: 90, dy: 0, ms: 60 }); });
    await sec(0.08);
    var drag = await L(function () { return window.__lab.stats(); });
    var pz = await L(function () { return window.__lab.pose(); });
    log('  finger flick right 90 px in 60 ms: glass at x ' + f1(pz.x) + ' px; sand centre x ' + f1(b0.com[0]) + ' -> ' + f1(drag.com[0]));
    check(pz.x > 20 && drag.com[0] < b0.com[0] - 0.5, 'a flick of the glass to the right throws its sand to the left wall');
    await sec(1.5);
    // a real pointer drag moves the glass (live loop, a few frames)
    await L(function () { window.__lab.manual(false); });
    var box = await L(function () { var i = window.__lab.info(); return { x: i.view.hx, y: i.view.hy }; });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y, { steps: 4 });
    await page.waitForTimeout(1500);
    var pz2 = await L(function () { return window.__lab.pose(); });
    await page.mouse.up();
    await L(function () { window.__lab.manual(true); });
    log('  pointer drag 60 px: glass at x ' + f1(pz2.x) + ' px');
    check(pz2.x > 10, 'a finger on the glass carries it');
    // DeviceMotion: the phone leaned 30 degrees to the right, then pushed right at 2 g; W3C signs (Chromium), then WebKit's
    var motionCase = async function (sign) {
      await bed();
      await L(function () { window.__lab.motionReset(); window.__lab.setInput({ mode: 'motion' }); });
      var send = function (ax, ay) {
        return L(function (o) {
          for (var i = 0; i < 25; i++) window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: o.ax, y: o.ay, z: 0 }, acceleration: null, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 16 }));
        }, { ax: ax, ay: ay });
      };
      var g0 = 9.81, s = Math.sin(a), c = Math.cos(a);
      // upright first, so the sign is learnt from readings
      await send(sign * 0, sign * g0); await send(sign * 0, sign * g0);
      var m0 = await L(function () { return window.__lab.stats(); });
      // W3C: aIG = a - g; the phone turned clockwise by 30 degrees: gravity in device axes (x right, y up) is (sin, -cos)
      await send(sign * -g0 * s, sign * g0 * c);
      await sec(0.8);
      var m1 = await L(function () { return window.__lab.stats(); });
      var mo = await L(function () { return window.__lab.motion(); });
      return { m0: m0, m1: m1, sign: mo.sign, g: [mo.gx, mo.gy] };
    };
    var w3c = await motionCase(1), webkit = await motionCase(-1);
    log('  DeviceMotion lean right, W3C signs: learnt sign ' + w3c.sign + ', felt (' + f2(w3c.g[0]) + ', ' + f2(w3c.g[1]) + ') g, centre x ' + f1(w3c.m0.com[0]) + ' -> ' + f1(w3c.m1.com[0]));
    log('  DeviceMotion lean right, WebKit signs: learnt sign ' + webkit.sign + ', felt (' + f2(webkit.g[0]) + ', ' + f2(webkit.g[1]) + ') g, centre x ' + f1(webkit.m0.com[0]) + ' -> ' + f1(webkit.m1.com[0]));
    check(w3c.sign === 1 && webkit.sign === -1, 'the sign of the readings is learnt (W3C +1, WebKit -1)');
    check(w3c.m1.com[0] > w3c.m0.com[0] + 1 && webkit.m1.com[0] > webkit.m0.com[0] + 1, 'a phone leaned right sends the sand right, either convention');
    await L(function () { window.__lab.setInput({ mode: 'upright' }); });
  }

  /* ---- 8 ------------------------------------------------------------ */
  if (run(8)) {
    log('8 tools');
    await L(function () { window.__lab.manual(false); });
    var rows = await L(function () { return window.__lab.benchmark({ res: ['S'], amounts: ['minute'], speeds: ['app', 'real'], warm: 0.3, measure: 1 }); });
    rows.forEach(function (r) { log('  bench (software GPU, not a phone) ' + r.res + ' ' + r.amount + ' ' + r.speed + ': ' + r.points + ' points, median ' + f1(r.median) + ' ms, sim/real ' + f2(r.ratio) + ', steps ' + f1(r.steps)); });
    check(rows.length === 2 && rows.every(function (r) { return r.points > 0 && isFinite(r.median); }), 'the benchmark gives a row per setting');
    await L(function () { window.__lab.manual(true); });
    var text = await L(function () { return window.__lab.report(); });
    check(/Device: Mozilla/.test(text) && /WebGPU adapter: vendor=/.test(text) && /Benchmark \(frame ms/.test(text) && (!flows.coarse || /Flow test: Coarse sand/.test(text)), 'the report has the user agent, the adapter, the benchmark' + (flows.coarse ? ' and the flow test' : ''));
    await page.click('#b-copy');
    var sheet = await L(function () { var t = document.querySelector('#sheet-body textarea'); return t ? t.value : ''; });
    check(/Hourglass sand lab results/.test(sheet), 'Copy results shows the report too');
    await L(function () { document.getElementById('sheet').hidden = true; });
  }

  check(errors.length === 0, 'no page errors through the run' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  server.close();
}

main().catch(function (e) { failures++; log('FAIL  ' + (e && e.stack || e)); }).then(function () {
  log((failures ? 'lab-sand: ' + failures + ' of ' + count + ' checks FAILED' : 'lab-sand: all ' + count + ' checks passed') + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  process.exit(failures ? 1 : 0);
});
