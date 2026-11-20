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
 *               coarse sand at 30 to 37 degrees (the brief's range), fine
 *               sand at 27 to 33 (about 30) and lower than coarse, water
 *               nearly flat (under 5); a narrow column, whose heap does
 *               not reach the wall, is logged (the wall's share of the
 *               angle)
 *   3 lean      a settled coarse heap leaned 20 degrees: the flank made
 *               steeper avalanches back to about the repose angle, the other
 *               holds, the centre of mass hardly moves (no block sliding or
 *               turning, no deep slump); water (control) levels; leaned 45
 *               degrees the sand avalanches
 *   4 spin      gravity turning 360 degrees a second for 10 s, then 3 to 5 g
 *               shakes for 3 s: finite, nothing leaves the glass, every
 *               material point kept; 1 s after the shake (the brief: about
 *               a second) at rest: mean speed under 3 cells/s, and the
 *               centre of mass still over the next second (under 0.5 cell)
 *   5 flip      the Flip pours the sand through the neck into the other
 *               bulb, with a crater above and a cone below (25 to 45
 *               degrees, measured a third of the way through, without the
 *               falling stream), until nearly all of it has crossed; and
 *               back again, with the same checks; each cone at rest after
 *               its pour stands at the repose angle (mean 25 to 37, its
 *               steeper flank under 40)
 *   6 flow      the rate through the neck of an upright glass, with the top
 *               three-quarters and a quarter full: sand about the same
 *               (ratio near 1, as in a real hourglass), water (control)
 *               slower as the head falls (ratio clearly above 1)
 *   7 inputs    a push to the right throws the sand to the left wall, a
 *               tilt to the right sends it right; through the scripted
 *               field, the finger drag and DeviceMotion readings (both
 *               sign conventions); the turning rate is read from the axis
 *               that carries it (alpha by the spec, gamma on iOS), and a
 *               pitch of the phone adds no turning
 *   8 tools     a short benchmark gives its rows; the report has the user
 *               agent, the adapter, the rows and the flow numbers; the
 *               frames per second counted are frames drawn (against the
 *               GPU submits counted in the page); turning the page to
 *               landscape shows how to lock portrait
 *   9 packing   sand keeps its volume, at app speed and at real speed: a
 *               flat bed at rest for 3 s keeps its area within 3 %; a 3 g
 *               press and release leaves it no thicker; after a 2 g jerk of
 *               the glass, a 3 g sideways shake, and (a heap) a 2 g shake up
 *               and down, it settles back within 10 % of its area; held at
 *               25 degrees (below repose) for 3 s it does not creep: centre
 *               under 0.5 cell, surface within 1 degree
 *  10 rest      a 1-minute flat bed at rest 0.5 to 4 s: area within 3 %, interior
 *               packing no looser than -3 % (it swelled 6.5 %)
 *  11 slowturn  a 1-minute bed, gravity turned 0 to 90 degrees at 30 deg/s with the
 *               glass: first failure at 30 to 40 degrees; from 65 to 90 it fails in
 *               surface sheets (lower half / top quarter move <= 0.3); the face 1 s
 *               after the turn >= 28 degrees (no liquid run-out; the scoreboard's
 *               block.postFail)
 *  12 fastturn  a quarter glass turned 180 deg/s to 90: face >= 22 degrees and mean
 *               speed <= 5 cells/s at +2 s; holes in the drawn bed <= 4 % at +0.2 s
 *               (bounds no worse than 5cc11b3, not real sand's: face 30 to 36,
 *               speed <= 3, holes <= 0.1 %; the messages say so)
 *  13 jerk      a quarter glass jerked 2 g: holes <= 1 % at +0.15 s; mean speed at
 *               +1 s <= 29.4 cells/s (no worse than 5cc11b3; real sand <= 3); no
 *               node clamped
 *  14 shake     a 1-minute bed shaken up and down 2 g at 10 Hz for 2 s: interior
 *               packing does not fall; the same with compaction off is logged
 *  15 press     real speed, a 3 g press for 0.5 s: the surface does not rise under
 *               it (<= 0.25 cell) nor hop when let go (<= 0.5)
 *  16 stream    an upright pour: the grains as drawn (with their streaks) cover
 *               >= 85 % of the 1-cell rows on the axis below the neck; drawn as
 *               dots (control) <= 60 %
 *  17 syrup     the flow test: syrup drains in >= 3 x water's time and >= 2 x
 *               coarse sand's (the scoreboard's target: real syrup oozes far more
 *               slowly than sand; 98f2d20 set 0.45 x, when sand drained 4 x faster)
 *  18 creep     a 1-minute bed held at 25 degrees, 0.5 to 3.5 s: centre <= 1.15
 *               cells (no worse than 5cc11b3; real sand <= 0.5), surface within 1
 *               degree
 *  19 pace      the live loop (a small bed pouring and shaken): at most two frames
 *               of GPU work in flight (the default), and the submit-to-done lag
 *               within two display frames, or (the software GPU here, where one
 *               substep's frame takes over a display frame) two such frames and
 *               one display frame more (on an iPhone at 5cc11b3, medium quarter,
 *               350 to 730 ms: three frames of work queued); the GPU budget holds
 *               the substeps and
 *               auto Hz back, and the report says so; control: the old pace (3
 *               frames in flight, no budget) breaks the bound. The Benchmark's
 *               rows for the default and its costly options, and the report's
 *               answers from them
 *
 * Screenshots of the key moments go to --shots (a phone-like 390 x 844
 * viewport, device scale 1).
 *
 *   node tools/test/lab-sand.test.js [--port <n>] [--only 2,6,9] [--shots <dir>]
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
// the bed's area: occupied 1 x 1 cells; positions [x0, y0, x1, y1, ...]
function bedArea(p) { var o = {}; for (var i = 0; i < p.length; i += 2) o[Math.floor(p[i]) + ',' + Math.floor(p[i + 1])] = 1; return Object.keys(o).length; }
// the top of the bed on the glass's axis (within 3 cells of it)
function bedTop(p) { var t = -1e9; for (var i = 0; i < p.length; i += 2) if (Math.abs(p[i]) < 3) t = Math.max(t, p[i + 1]); return t; }
var f1 = function (v) { return typeof v === 'number' && isFinite(v) ? v.toFixed(1) : String(v); };
var f2 = function (v) { return typeof v === 'number' && isFinite(v) ? v.toFixed(2) : String(v); };

async function main() {
  var server = srv.start(PORT, ROOT);
  var browser = await playwright.chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  var errors = [];
  var page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  // count the GPU submits that draw, to check the page's frames-per-second against them
  await page.addInitScript(function () {
    window.__submits = 0; window.__draws = 0;
    if (window.GPUQueue) { var sub = GPUQueue.prototype.submit; GPUQueue.prototype.submit = function () { window.__submits++; return sub.apply(this, arguments); }; }
    // a frame drawn: a command encoder that begins a render pass
    if (window.GPUCommandEncoder) { var brp = GPUCommandEncoder.prototype.beginRenderPass; GPUCommandEncoder.prototype.beginRenderPass = function () { window.__draws++; return brp.apply(this, arguments); }; }
  });
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  var L = function (fn, a) { return page.evaluate(fn, a); };
  var shot = async function (name) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  var sec = function (s) {                         // simulated seconds (the substep rate may change on the way: auto Hz)
    return L(function (s) { return window.__lab.advance(s); }, s);
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
      check(heap.coarse.mean >= 30 && heap.coarse.mean <= 37, 'coarse sand heaps at 30 to 37 degrees (' + f1(heap.coarse.mean) + ')');
      check(heap.fine.mean >= 27 && heap.fine.mean <= 33 && heap.fine.mean < heap.coarse.mean, 'fine sand heaps at about 30 (27 to 33), lower than coarse (' + f1(heap.fine.mean) + ' < ' + f1(heap.coarse.mean) + ')');
      check(heap.water.mean < 5, 'water nearly flat (' + f1(heap.water.mean) + ' < 5)');
      // the wall's share: a narrow column, whose heap does not reach the wall (logged, not checked)
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); var i = window.__lab.info(); return window.__lab.reset({ fill: 'column', material: 'coarse', width: 0.3 * i.glass.Rc, height: 0.45 * i.glass.Rc }); });
      await sec(2.5);
      var hn = await L(function () { return window.__lab.heapAngle({ bulb: 'lower' }); });
      log('  coarse, a narrow column (its toe off the wall): flanks ' + f1(hn.left) + '/' + f1(hn.right) + ', mean ' + f1(hn.mean) + ' degrees (logged)');
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
    // What real dry sand does. Gravity turns 20 degrees to the right: the right
    // flank is 20 degrees steeper against gravity, past the angle of repose, so it
    // fails and avalanches back to about that angle; the left flank is 20 degrees
    // shallower and holds. Only the wedge that fails moves: for this heap in this
    // bowl, an ideal granular bed (every slope capped at the repose angle, area
    // kept, no inertia) moves its centre of mass about 2 cells. A bed that slides
    // or turns as a block, or slumps deep, moves its centre much further.
    check(moveSand < 4 && moveSand < 0.5 * moveWater, 'sand does not turn, slide or slump as a block: its centre moves ' + f1(moveSand) + ' cells (under 4, and under half the water\'s ' + f1(moveWater) + ')');
    check(c.at20.g.mean > 0.6 * c.before.g.mean, 'sand keeps most of its slope against gravity: flanks ' + f1(c.at20.g.mean) + ' degrees on average, at least 0.6 of the upright ' + f1(c.before.g.mean));
    check(c.at20.g.right >= 0.75 * c.before.g.mean, 'the flank the lean steepened fails back to about the repose angle, not lower: ' + f1(c.at20.g.right) + ' degrees (at least 0.75 of ' + f1(c.before.g.mean) + ')');
    check(Math.abs(c.at20.g.left - (c.before.g.left - 20)) <= 6, 'the flank the lean made shallower holds: ' + f1(c.at20.g.left) + ' degrees, about ' + f1(c.before.g.left) + ' - 20');
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
    log('  settling (mean speed, cells/s, every 0.5 s): ' + settle.map(function (x) { return f1(x.meanSpeed); }).join(', ') + '; centre y ' + settle.map(function (x) { return f1(x.com[1]); }).join(', '));
    // at rest 1 s after the shake: slow, and the centre of mass still over the next second (a creeping bed fails)
    var drift = Math.hypot(settle[3].com[0] - settle[1].com[0], settle[3].com[1] - settle[1].com[1]);
    check(settle[1].meanSpeed < 3 && drift < 0.5, 'at rest 1 s after the shake: mean speed ' + f1(settle[1].meanSpeed) + ' cells/s (under 3), centre moves ' + f2(drift) + ' cells over the next second (under 0.5)');
  }

  /* ---- 5 ------------------------------------------------------------ */
  if (run(5)) {
    log('5 flip');
    // The neck sets how fast sand can pour (case 6 measures it), so the check is
    // not a drain time: it is that the sand keeps pouring through the neck, with
    // a crater above and a cone below, until (nearly) all of it has crossed.
    // crater: how far the free surface of the sand above the neck dips at the axis
    var crater = async function (sideUp) {
      var p = await L(function () { return window.__lab.positions(); });
      var bins = {};
      for (var i = 0; i < p.length; i += 2) {
        var x = p[i], h = sideUp * p[i + 1];            // height above the neck, up = against gravity
        if (h <= 2) continue;
        var k = Math.round(x);
        if (!(k in bins) || h > bins[k]) bins[k] = h;
      }
      var ks = Object.keys(bins).map(Number);
      if (ks.length < 10) return NaN;
      var xmin = Math.min.apply(null, ks), xmax = Math.max.apply(null, ks), half = (xmax - xmin) / 2, mid = (xmax + xmin) / 2;
      var avg = function (lo, hi) { var s = 0, n = 0; ks.forEach(function (k) { var d = Math.abs(k - mid); if (d >= lo && d <= hi) { s += bins[k]; n++; } }); return n ? s / n : NaN; };
      return avg(0.35 * half, 0.6 * half) - avg(0, 2);   // > 0: lower at the axis than part-way out
    };
    var pour = async function (label, fromAbove) {
      var t = 0, series = [], mid = null;
      // fromAbove: the sand starts in the grid's upper half (y > 0); key: where it is going
      var key = fromAbove ? 'below' : 'above';
      while (t < 10) {
        await sec(0.5); t += 0.5;
        var st = await L(function () { return window.__lab.stats(); });
        series.push(st[key]);
        // mid-pour: a third of the sand across (the cone has grown), the falling stream left out of
        // the cone: grains faster than 20 cells/s, and the column where the stream lands on the
        // cone's top (its grains have slowed there, but they are the stream, not the cone): a
        // neck's width either side of the axis
        if (st[key] >= 0.33 * st.count && !mid) {
          mid = { crater: await crater(fromAbove ? 1 : -1), cone: await L(function (b) { return window.__lab.heapAngle({ bulb: b, vMax: 20, skipAxis: window.__lab.info().glass.neckCells }); }, fromAbove ? 'lower' : 'upper') };
          await shot(fromAbove ? '05-flip-back-pouring' : '05-flip-pouring');
        }
        if (st[key] >= 0.97 * st.count) break;
        if (series.length >= 4 && series[series.length - 1] === series[series.length - 4]) break;   // stopped
      }
      // the cone at rest, 1.5 s after the pour (real sand cannot stand steeper than its repose angle)
      await sec(1.5);
      var rest = await L(function (b) { return window.__lab.heapAngle({ bulb: b }); }, fromAbove ? 'lower' : 'upper');
      await shot(fromAbove ? '05-flip-back-rest' : '05-flip-rest');
      log('  ' + label + ': crossed every 0.5 s ' + series.join(' ') + ' of ' + st.count + ' (' + t + ' s after the turn began); crater above ' + f1(mid && mid.crater) + ' cells deep, cone below ' + f1(mid && mid.cone.left) + '/' + f1(mid && mid.cone.right) + ' degrees; at rest after ' + f1(rest.left) + '/' + f1(rest.right) + ' (mean ' + f1(rest.mean) + ')');
      return { st: st, t: t, mid: mid, series: series, rest: rest };
    };
    await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'lower', material: 'coarse', points: 3000 }); });
    await sec(0.5);
    var a0 = await L(function () { return window.__lab.stats(); });
    await L(function () { window.__lab.flip(); });
    await sec(0.6);
    await shot('05-flip-mid');
    var f1r = await pour('flipped', false);
    var f2r;
    check(f1r.st.above >= 0.95 * a0.count && f1r.st.nan === 0, 'the sand pours through the neck into the other bulb, until ' + f1r.st.above + ' of ' + a0.count + ' have crossed');
    check(f1r.mid && f1r.mid.crater > 1 && f1r.mid.cone.steepest > 25 && f1r.mid.cone.steepest < 45, 'while it pours: a crater above (' + f1(f1r.mid && f1r.mid.crater) + ' cells deep) and a cone below (' + f1(f1r.mid && f1r.mid.cone.steepest) + ' degrees, 25 to 45)');
    await L(function () { window.__lab.flip(); });
    f2r = await pour('flipped back', true);
    check(f2r.st.below >= 0.95 * a0.count, 'and pours back the other way, until ' + f2r.st.below + ' of ' + a0.count + ' have crossed');
    check(f2r.mid && f2r.mid.crater > 1 && f2r.mid.cone.steepest > 25 && f2r.mid.cone.steepest < 45, 'and back: a crater above (' + f1(f2r.mid && f2r.mid.crater) + ' cells deep) and a cone below (' + f1(f2r.mid && f2r.mid.cone.steepest) + ' degrees, 25 to 45)');
    // at rest, each cone stands at the repose angle (the brief's 30 to 37), no steeper (its steeper flank under 40)
    var restOk = function (r) { return r.rest.mean >= 25 && r.rest.mean <= 37 && r.rest.steepest <= 40; };
    check(restOk(f1r) && restOk(f2r), 'each cone at rest stands at about the repose angle, no steeper: ' + f1(f1r.rest.mean) + ' (steeper flank ' + f1(f1r.rest.steepest) + ') and ' + f1(f2r.rest.mean) + ' (' + f1(f2r.rest.steepest) + '); mean 25 to 37, steeper flank under 40');
    check(f2r.st.outside === 0 && f2r.st.nan === 0, 'nothing outside the glass, nothing not finite');
  }

  /* ---- 6 ------------------------------------------------------------ */
  var flows = {};
  if (run(6) || run(8) || run(17)) {
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
    // The finger: a quick flick of the glass, to the right and (control) to the left.
    // While the glass speeds up the sand lags behind it, so in the glass it moves the
    // other way. The glass follows the finger on a spring (app.js's), so a flick's push
    // on the sand is the spring's: 200 px in 60 ms peaks at 0.67 g for some 40 ms, under
    // the sand's own failure point (tan 32 degrees, 0.62 g, for a moment): real sand
    // hardly moves for it (logged); 300 px in 40 ms peaks at 1.5 g (checked). At app
    // speed the world runs slowed, 1 / sqrt(lambda) (about 3.5) times, and the glass's
    // jolts are played back slowed like a film of them, so the sand's answer to the
    // first 0.1 s of the flick shows at 0.1 / sqrt(lambda) s.
    var flick = async function (dx, ms, tag) {
      var b = await bed();
      var lam = await L(function () { var i = window.__lab.info(); return i.settings.speed === 'app' ? i.g / i.gReal : 1; });
      var at = 0.1 / Math.sqrt(lam);
      await L(function (o) { window.__lab.setInput({ mode: 'upright' }); window.__lab.drag({ dx: o.dx, dy: 0, ms: o.ms }); }, { dx: dx, ms: ms });
      await sec(0.1);
      var pz = await L(function () { return window.__lab.pose(); });
      var s01 = await L(function () { return window.__lab.stats(); });
      await sec(at - 0.1);
      var st = await L(function () { return window.__lab.stats(); });
      if (tag) await shot(tag);
      return { dx: st.com[0] - b.com[0], dx01: s01.com[0] - b.com[0], x: pz.x, at: at };
    };
    var fr0 = await flick(200, 60), fl0 = await flick(-200, 60);
    log('  finger flick 200 px in 60 ms (0.67 g at the glass; logged): glass at x ' + f1(fr0.x) + ' px after 0.1 s, sand centre moved ' + f2(fr0.dx01) + ' cells at 0.1 s, ' + f2(fr0.dx) + ' at ' + f2(fr0.at) + ' s; to the left: ' + f2(fl0.dx01) + ', ' + f2(fl0.dx));
    var fr7 = await flick(300, 40, '07-flick-right'), fl7 = await flick(-300, 40);
    log('  finger flick 300 px in 40 ms (1.5 g at the glass): glass at x ' + f1(fr7.x) + ' px after 0.1 s, sand centre moved ' + f2(fr7.dx) + ' cells at ' + f2(fr7.at) + ' s (' + f2(fr7.dx01) + ' at 0.1 s); flick left (control): glass at ' + f1(fl7.x) + ', sand ' + f2(fl7.dx));
    check(fr7.x > 20 && fr7.dx < -0.5 && fl7.dx > 0.5, 'a flick of the glass to the right throws its sand to the left, a flick to the left throws it right');
    // A jerk of the glass (2 g for 50 ms, then -2 g for 50 ms), through the same path as the
    // finger's and the phone's: while the glass speeds up, it throws the bed against the
    // trailing wall. Checked at app speed, 0.2 s after the jerk began (in the slowed world, the
    // first 0.06 s of it): before the slowed playback, app speed gave it a 3-cell wobble. Real
    // speed is logged: there the whole jerk is over in 0.1 s, and the stop throws the bed back.
    var jerk = async function (speed) {
      await L(function (sp) { return window.__lab.settings({ speed: sp }); }, speed);
      var b = await bed();
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], glass: [2, 0] }); }); await sec(0.05);
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], glass: [-2, 0] }); }); await sec(0.05);
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
      await sec(0.1);
      var st = await L(function () { return window.__lab.stats(); });
      if (speed === 'app') await shot('07-jerk-app');
      return st.com[0] - b.com[0];
    };
    var jApp = await jerk('app'), jReal = await jerk('real');
    await L(function () { return window.__lab.settings({ speed: 'app' }); });
    log('  2 g jerk of the glass to the right, 50 ms each way: sand centre ' + f1(jApp) + ' cells at app speed, ' + f1(jReal) + ' at real speed (logged), 0.2 s after it began');
    check(jApp < -8, 'at app speed a jerk of the glass throws the bed against the trailing wall (centre ' + f1(jApp) + ' cells, over 8)');
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
    // The turning rate. The phone held upright twists back and forth in the screen's plane (its
    // gravity turns on the screen), with the rate in alpha (the spec) or in gamma (WebKit on iOS
    // fills alpha, beta, gamma from the x, y, z rates); and a pitch flick (rate about the screen's
    // x axis: beta by the spec, alpha on iOS) with gravity unchanged must add no turning.
    var rotCase = async function (twistAxis, pitchAxis) {
      await L(function () { window.__lab.motionReset(); window.__lab.setInput({ mode: 'motion' }); });
      var r = await L(function (o) {
        var g0 = 9.81, dt = 0.004, A = 0.5, prev = 0, peak = 0;
        var ev = function (phi, rate, pitch) {
          var rr = { alpha: 0, beta: 0, gamma: 0 };
          rr[o.twist] = -rate * 180 / Math.PI;            // + clockwise turn: the spec's alpha is counter-clockwise +
          if (pitch) rr[o.pitch] = pitch;
          window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: -g0 * Math.sin(phi), y: g0 * Math.cos(phi), z: 0 }, acceleration: null, rotationRate: rr, interval: 4 }));
        };
        for (var i = 0; i < 30; i++) ev(0, 0, 0);
        for (var j = 1; j <= 600; j++) { var phi = A * Math.sin(2 * Math.PI * j / 150); ev(phi, (phi - prev) / dt, 0); prev = phi; }
        var m = window.__lab.motion();
        for (var k = 0; k < 80; k++) ev(0, 0, 0);
        // the pitch flick: 300 deg/s about x for 0.1 s
        for (var q = 0; q < 25; q++) { ev(0, 0, 300); var w = Math.abs(window.__lab.motion().w); if (w > peak) peak = w; }
        return { axis: m.rAxis, sign: m.rSign, learnt: m.rLearnt, pitchTurn: peak };
      }, { twist: twistAxis, pitch: pitchAxis });
      return r;
    };
    var rw = await rotCase('alpha', 'beta'), ri = await rotCase('gamma', 'alpha');
    log('  turning rate, twist in alpha (spec): axis ' + rw.axis + ' sign ' + rw.sign + (rw.learnt ? ' learnt' : ' assumed') + ', pitch flick in beta gives ' + f2(rw.pitchTurn) + ' rad/s of turn');
    log('  turning rate, twist in gamma (iOS): axis ' + ri.axis + ' sign ' + ri.sign + (ri.learnt ? ' learnt' : ' assumed') + ', pitch flick in alpha gives ' + f2(ri.pitchTurn) + ' rad/s of turn');
    check(rw.learnt && rw.axis === 'alpha' && rw.sign === 1 && ri.learnt && ri.axis === 'gamma' && ri.sign === 1, 'the turning rate is read from the axis that carries it (alpha by the spec, gamma as iOS fills it)');
    check(rw.pitchTurn < 0.2 && ri.pitchTurn < 0.2, 'a pitch of the phone adds no turning (under 0.2 rad/s: ' + f2(rw.pitchTurn) + ', ' + f2(ri.pitchTurn) + ')');
    await L(function () { window.__lab.motionReset(); });
    await L(function () { window.__lab.setInput({ mode: 'upright' }); });
  }

  /* ---- 8 ------------------------------------------------------------ */
  if (run(8)) {
    log('8 tools');
    await L(function () { window.__lab.manual(false); });
    // (a frame takes a second or more on the software GPU at real speed: measure long enough to
    // see a few, and with auto Hz off, which would triple the substeps of a shaken frame here)
    await L(function () { return window.__lab.settings({ auto: false }); });
    var rows = await L(function () { return window.__lab.benchmark({ res: ['S'], amounts: ['minute'], speeds: ['app', 'real'], warm: 1, measure: 5 }); });
    await L(function () { return window.__lab.settings({ auto: true }); });
    rows.forEach(function (r) { log('  bench (software GPU, not a phone) ' + r.res + ' ' + r.amount + ' ' + r.speed + ': ' + r.points + ' points, median ' + f1(r.median) + ' ms, sim/real ' + f2(r.ratio) + ', steps ' + f1(r.steps)); });
    check(rows.length === 2 && rows.every(function (r) { return r.points > 0 && isFinite(r.median); }), 'the benchmark gives a row per setting');
    await L(function () { window.__lab.manual(true); });
    var text = await L(function () { return window.__lab.report(); });
    // (the user agent, the adapter, the benchmark's header and a row of it, every flow test run)
    check(/Device: Mozilla/.test(text) && /WebGPU adapter: vendor=/.test(text) && /\nBenchmark \(frames drawn a second/.test(text) && /\ncoarse +1-minute app /.test(text) && /\ncoarse +1-minute real /.test(text) &&
      (!flows.coarse || /Flow test: Coarse sand/.test(text)) && (!flows.water || /Flow test: Water/.test(text)), 'the report has the user agent, the adapter, the benchmark' + (flows.coarse ? ' and the flow tests' : ''));
    await page.click('#b-copy');
    var sheet = await L(function () { var t = document.querySelector('#sheet-body textarea'); return t ? t.value : ''; });
    check(/Hourglass sand lab results/.test(sheet), 'Copy results shows the report too');
    await L(function () { document.getElementById('sheet').hidden = true; });
    // frames per second are frames drawn: against the submits counted in the page (each frame drawn is one submit)
    // (a small load, so the software GPU draws a few frames a second; the page's own submits for
    // readbacks are not frames, so the frames drawn are counted against the submits that draw)
    await L(function () { window.__lab.setInput({ mode: 'upright' }); return window.__lab.reset({ fill: 'lower', material: 'coarse', points: 600 }); });
    await L(function () { window.__lab.manual(false); });
    // (the software GPU may still be working through the benchmark's last frames: wait for it)
    await page.waitForFunction(function () { var s = window.__lab.loopState(); return s.pending && !s.pending.every(Boolean); }, null, { timeout: 120000, polling: 250 }).catch(function () {});
    await page.waitForTimeout(1500);
    var sub0 = await L(function () { return window.__draws; });
    await page.waitForTimeout(4000);
    var sub1 = await L(function () { return window.__draws; });
    var fs8 = await L(function () { return window.__lab.frameStats(4000); });
    var ls8 = await L(function () { return window.__lab.loopState(); });
    await L(function () { window.__lab.manual(true); });
    var drawn = (sub1 - sub0) / 4;
    log('  live loop (software GPU): ' + f1(drawn) + ' frames drawn a second (render passes submitted); the page counts ' + f1(fs8 && fs8.fps) + ' fps drawn, ' + Math.round(100 * (fs8 ? fs8.skipped : 0)) + '% skipped, display ' + f1(fs8 && fs8.display) + ' Hz; loop ' + JSON.stringify(ls8));
    check(drawn > 0.5 && fs8 && Math.abs(fs8.fps - drawn) <= Math.max(1, 0.3 * drawn), 'the fps counted are frames drawn (' + f1(fs8 && fs8.fps) + ' against ' + f1(drawn) + ' drawn a second, and some were drawn)');
    // turned to landscape, the page says how to keep it upright
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400);
    var landOn = await L(function () { return window.__lab.landscape(); });
    await shot('08-landscape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    var landOff = await L(function () { return window.__lab.landscape(); });
    check(landOn && !landOff, 'turned to landscape the page asks for Portrait Orientation Lock, and the note goes in portrait');
    // the phone's own path: drawn to the WebGPU canvas, not offscreen. Here
    // (Chromium with SwiftShader) every mapAsync fails on that path, even in a
    // 20-line page, so this is the browser's fault, not the lab's; what the
    // lab owes is to say so, never to report "none" while its live numbers
    // are dead. Where the readbacks work, they must be counted as working.
    var p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    var p3errors = [];
    p3.on('pageerror', function (e) { p3errors.push(e.message); });
    await p3.goto(URL0.replace('offscreen=1&', ''));
    await p3.evaluate(function () { return window.__lab.ready; });
    await p3.waitForTimeout(4000);
    var cv = await p3.evaluate(async function () {
      var rep = String(await window.__lab.report());
      return { err: rep.split('\n').filter(function (l) { return /^Errors/.test(l); })[0] || '', status: (document.getElementById('status') || {}).textContent || '', hud: document.getElementById('hud').textContent };
    });
    var rbm = /live readbacks (\d+) ok, (\d+) failed/.exec(cv.err) || [0, -1, -1];
    var rbOk = +rbm[1], rbBad = +rbm[2];
    log('  canvas path: ' + cv.err.replace(/^Errors: /, '') + (cv.status ? '; status "' + cv.status + '"' : ''));
    check(rbOk >= 0 && rbBad >= 0 && rbOk + rbBad > 0, 'on the canvas path the report counts the live readbacks (' + rbOk + ' ok, ' + rbBad + ' failed)');
    check(rbBad === 0 || (/FAILING/.test(cv.hud) && /failing/.test(cv.status) && /mapAsync|\(/.test(cv.err)),
          'if the live readbacks fail, the HUD, the status line and the report say so');
    check(p3errors.length === 0, 'no page errors on the canvas path' + (p3errors.length ? ' (' + p3errors.length + ': ' + p3errors[0] + ')' : ''));
    await p3.close();
  }

  /* ---- 9 ------------------------------------------------------------ */
  if (run(9)) {
    for (var sp9 of ['app', 'real']) {
      log('9 packing (a flat bed, coarse sand, ' + sp9 + ' speed)');
      await L(function (sp) { return window.__lab.settings({ speed: sp }); }, sp9);
      var flat = async function () {
        await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'lower', material: 'coarse', amount: 'minute' }); });
        await sec(0.5);
      };
      var snap = async function () { var p = await L(function () { return window.__lab.positions(); }); var st = await L(function () { return window.__lab.stats(); }); return { area: bedArea(p), top: bedTop(p), com: st.com, v: st.meanSpeed }; };
      await flat();
      var p0 = await snap();
      await sec(3);
      var p3 = await snap();
      await shot('09-' + sp9 + '-rest-3s');
      log('  at rest 3 s: area ' + p0.area + ' -> ' + p3.area + ' cells, top ' + f1(p0.top) + ' -> ' + f1(p3.top) + ', mean speed ' + f1(p3.v) + ' cells/s');
      check(Math.abs(p3.area / p0.area - 1) <= 0.03, sp9 + ' speed: a bed at rest keeps its volume: area within 3 % over 3 s (' + f2(100 * (p3.area / p0.area - 1)) + ' %)');
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], accel: [0, -2] }); });   // 3 g, pressing it down
      await sec(0.5);
      var pp = await snap();
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
      await sec(1);
      var pr = await snap();
      log('  3 g press: top ' + f1(p3.top) + ' -> ' + f1(pp.top) + ' while pressed, ' + f1(pr.top) + ' 1 s after; area ' + p3.area + ' -> ' + pr.area);
      check(pr.top <= p3.top + 0.5 && pr.area <= 1.03 * p3.area, sp9 + ' speed: a 3 g press and release leaves the bed no thicker (top ' + f1(pr.top) + ' against ' + f1(p3.top) + ', area ' + pr.area + ' against ' + p3.area + ')');
      // a jerk of the glass, 2 g for 50 ms each way
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], glass: [2, 0] }); }); await sec(0.05);
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], glass: [-2, 0] }); }); await sec(0.05);
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
      await sec(1);
      var pj = await snap();
      log('  2 g jerk, 50 ms each way, then 1 s: area ' + pr.area + ' -> ' + pj.area + ' cells');
      check(pj.area <= 1.10 * pr.area, sp9 + ' speed: a jerked bed settles back within 10 % of its area (' + f2(100 * (pj.area / pr.area - 1)) + ' %)');
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], shake: { g: 3, hz: 5, axis: [1, 0] } }); });
      await sec(1);
      await shot('09-' + sp9 + '-shaken');
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
      await sec(1);
      var ps = await snap();
      await shot('09-' + sp9 + '-shaken-settled');
      log('  shaken 3 g at 5 Hz for 1 s, then 1 s: area ' + pj.area + ' -> ' + ps.area + ' cells');
      check(ps.area <= 1.10 * pj.area, sp9 + ' speed: a shaken bed settles back within 10 % of its area (' + f2(100 * (ps.area / pj.area - 1)) + ' %)');
      // a heap shaken up and down, 2 g at 10 Hz for 2 s (it may flatten: shaken sand flows)
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset({ fill: 'column', material: 'coarse', amount: 'minute' }); });
      await sec(2.5);
      var ph = await snap();
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1], shake: { g: 2, hz: 10, axis: [0, 1] } }); });
      await sec(2);
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
      await sec(1.5);
      var pv = await snap();
      await shot('09-' + sp9 + '-vshaken-settled');
      log('  a heap shaken up and down 2 g at 10 Hz for 2 s, then 1.5 s: area ' + ph.area + ' -> ' + pv.area + ' cells');
      check(pv.area <= 1.10 * ph.area, sp9 + ' speed: a heap shaken up and down settles back within 10 % of its area (' + f2(100 * (pv.area / ph.area - 1)) + ' %)');
      // creep below repose: a flat bed held at 25 degrees
      await flat();
      var a25 = 25 * Math.PI / 180;
      await L(function (a) { window.__lab.setInput({ mode: 'manual', gravity: [Math.sin(a), Math.cos(a)] }); }, a25);
      await sec(0.25);
      var c0 = await L(function () { return window.__lab.stats(); }), h0 = await L(function () { return window.__lab.heapAngle({ bulb: 'lower', frame: 'gravity' }); });
      await sec(3);
      var c3 = await L(function () { return window.__lab.stats(); }), h3 = await L(function () { return window.__lab.heapAngle({ bulb: 'lower', frame: 'gravity' }); });
      await shot('09-' + sp9 + '-held-25');
      var cm = Math.hypot(c3.com[0] - c0.com[0], c3.com[1] - c0.com[1]);
      log('  held at 25 degrees from 0.25 s to 3.25 s: centre moves ' + f2(cm) + ' cells, surface ' + f1(h0.tilt) + ' -> ' + f1(h3.tilt) + ' degrees to gravity, mean speed ' + f1(c3.meanSpeed) + ' cells/s');
      check(cm < 0.5 && Math.abs(h3.tilt - h0.tilt) <= 1, sp9 + ' speed: below its angle of repose the bed holds: centre under 0.5 cell (' + f2(cm) + '), surface within 1 degree (' + f1(Math.abs(h3.tilt - h0.tilt)) + ')');
      await L(function () { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
    }
    await L(function () { return window.__lab.settings({ speed: 'app' }); });
  }

  /* ---- 10 to 18: this round's realism checks (the scoreboard's scenarios and measures) ---- */
  var M = require('./lib/sand-measures.js');
  var D2R = Math.PI / 180;
  var reset10 = async function (o) {
    await L(function (o) { window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); return window.__lab.reset(o); }, Object.assign({ fill: 'lower', material: 'coarse' }, o));
  };
  var speed10 = function (sp, extra) { return L(function (o) { return window.__lab.settings(o); }, Object.assign({ speed: sp, override: null }, extra || {})); };
  var pos = function () { return L(function () { return window.__lab.positions(); }); };
  var stat = function () { return L(function () { return window.__lab.stats(); }); };
  var inp = function (o) { return L(function (o) { window.__lab.setInput(o); }, o); };
  // the glass shaken through its own path (the phone's), updated 120 times a simulated second
  var glassShake = function (g, hz, axis, dur) {
    return L(async function (o) {
      for (var i = 0; i < o.n; i++) {
        var a = o.g * Math.sin(2 * Math.PI * o.hz * (i + 0.5) / 120);
        window.__lab.setInput({ mode: 'manual', gravity: [0, 1], glass: [a * o.axis[0], a * o.axis[1]] });
        await window.__lab.advance(1 / 120);
      }
      window.__lab.setInput({ mode: 'manual', gravity: [0, 1] });
    }, { g: g, hz: hz, axis: axis, n: Math.round(dur * 120) });
  };

  if (run(10)) {
    log('10 rest (a 1-minute flat bed, coarse sand, app speed, 0.5 s to 4 s after the fill)');
    await speed10('app');
    await reset10({ amount: 'minute' });
    await sec(0.5);
    var k0 = M.packing(await pos());
    await sec(3.5);
    var k1 = M.packing(await pos());
    var dA = 100 * (k1.area / k0.area - 1), dP = 100 * (k1.packing / k0.packing - 1);
    log('  area ' + k0.area + ' -> ' + k1.area + ' cells (' + f2(dA) + ' %), interior packing ' + f2(k0.packing) + ' -> ' + f2(k1.packing) + ' (' + f2(dP) + ' %)');
    check(Math.abs(dA) <= 3 && dP >= -3, 'a bed at rest does not swell: area within 3 % (' + f2(dA) + ') and packing no looser than -3 % (' + f2(dP) + ') (5cc11b3: +6.5 / -4.2)');
  }

  if (run(11)) {
    log('11 a slow turn (a 1-minute bed, gravity turned 0 to 90 degrees at 30 deg/s with the glass)');
    await speed10('app');
    await reset10({ amount: 'minute' });
    await sec(1);
    var w11 = 30 * D2R, p11 = await pos(), steps11 = [], t11 = 0;
    await inp({ mode: 'manual', gravity: [0, 1], gravitySpin: w11, omega: -w11 });
    for (var a11 = 5; a11 <= 90; a11 += 5) {
      await sec(a11 / 30 - t11); t11 = a11 / 30;
      var q11 = await pos(), up11 = [Math.sin(a11 * D2R), Math.cos(a11 * D2R)], mv11 = M.stepMove(p11, q11, up11, 1 / 6);
      steps11.push({ a: a11, top: mv11.topMove, low: mv11.lowMove, ratio: mv11.ratio, face: M.faceFit(q11, up11, function (x, y) { return y < -1; }) });
      p11 = q11;
    }
    await inp({ mode: 'manual', gravity: [-1, Math.cos(90 * D2R)] });
    await sec(1);
    var face11 = M.faceFit(await pos(), [1, 0], function (x, y) { return y < -1; });
    var drift11 = M.median(steps11.filter(function (s) { return s.a <= 20; }).map(function (s) { return s.top; }));
    var thr11 = Math.max(1, 2 * drift11), fails11 = steps11.filter(function (s) { return s.top >= thr11; });
    log('  per 5 degrees (top quarter / lower half median move, cells; face): ' + steps11.map(function (s) { return s.a + ':' + f1(s.top) + '/' + f1(s.low) + ' ' + Math.round(s.face); }).join('  '));
    var first11 = fails11.length ? fails11[0].a : NaN;
    var late11 = fails11.filter(function (s) { return s.a >= 65; }), lateRatio = late11.length ? Math.max.apply(null, late11.map(function (s) { return s.ratio; })) : NaN;
    var deep11 = steps11.filter(function (s) { return s.a >= 40 && s.a <= 70; }).map(function (s) { return s.low; }), deepMax11 = Math.max.apply(null, deep11);
    log('  first failure at ' + first11 + ' degrees; lower/top in the failures from 65 to 90: ' + f2(lateRatio) + '; the lower half\'s largest move from 40 to 70: ' + f2(deepMax11) + ' cells (logged); face 1 s after the turn ' + f1(face11) + ' degrees');
    check(first11 >= 30 && first11 <= 40, 'the bed first fails at 30 to 40 degrees of turn (' + first11 + ')');
    check(lateRatio <= 0.3, 'from 65 to 90 degrees it fails in surface sheets: lower half / top quarter <= 0.3 (' + f2(lateRatio) + '; 5cc11b3: 0.8 to 1.5)');
    check(face11 >= 28, 'the avalanche stops near its repose angle: face 1 s after >= 28 degrees (' + f1(face11) + '; repose 31.5)');
    await inp({ mode: 'manual', gravity: [0, 1] });
  }

  if (run(12)) {
    log('12 a fast turn (a quarter glass, 180 deg/s to 90 degrees, held)');
    await speed10('app');
    await reset10({ amount: 'quarter' });
    await sec(1);
    var w12 = 180 * D2R;
    await inp({ mode: 'manual', gravity: [0, 1], gravitySpin: w12, omega: -w12 });
    await sec(0.5);
    await inp({ mode: 'manual', gravity: [-1, Math.cos(90 * D2R)] });
    await sec(0.2);
    var v12 = M.voids(await pos());
    await sec(1.8);
    var face12 = M.faceFit(await pos(), [1, 0], function (x, y) { return y < -1; }), s12 = await stat();
    log('  +0.2 s: holes ' + f2(100 * v12.holes) + ' % of the interior (' + v12.holeCount + ', biggest ' + f2(v12.biggestHole) + ' cell²); +2 s: face ' + f1(face12) + ' degrees, mean speed ' + f1(s12.meanSpeed) + ' cells/s');
    check(face12 >= 22 && s12.meanSpeed <= 5, 'no worse than 5cc11b3, not yet real sand: after a fast turn face >= 22 degrees (' + f1(face12) + '; 5cc11b3: 13.2; real sand 30 to 36) and mean speed <= 5 cells/s at +2 s (' + f1(s12.meanSpeed) + '; 9.5; real sand <= 3)');
    check(v12.holes <= 0.04, 'no worse than 5cc11b3, not yet real sand: holes <= 4 % at +0.2 s in the turn (' + f2(100 * v12.holes) + ' %; 5cc11b3: 16.3; real sand <= 0.1)');
  }

  if (run(13)) {
    log('13 a jerk (a quarter glass, 2 g for 50 ms each way through the glass)');
    await speed10('app');
    await reset10({ amount: 'quarter' });
    await sec(1);
    var c13 = (await stat()).clamped;
    await inp({ mode: 'manual', gravity: [0, 1], glass: [2, 0] }); await sec(0.05);
    await inp({ mode: 'manual', gravity: [0, 1], glass: [-2, 0] }); await sec(0.05);
    await inp({ mode: 'manual', gravity: [0, 1] });
    await sec(0.05);
    var v13 = M.voids(await pos());
    await sec(0.85);
    var s13 = await stat();
    log('  +0.15 s: holes ' + f2(100 * v13.holes) + ' %; +1 s: mean speed ' + f1(s13.meanSpeed) + ' cells/s; clamp hits ' + (s13.clamped - c13));
    check(v13.holes <= 0.01, 'a jerk does not tear the bed: holes <= 1 % at +0.15 s (' + f2(100 * v13.holes) + ' %; 5cc11b3: 6.8)');
    check(s13.meanSpeed <= 29.4 && s13.clamped - c13 === 0, 'no worse than 5cc11b3, not yet real sand: it settles no slower than before (mean speed at +1 s ' + f1(s13.meanSpeed) + ' <= 29.4; real sand <= 3) and no node is clamped (' + (s13.clamped - c13) + ')');
  }

  if (run(14)) {
    log('14 shaking packs (a 1-minute bed shaken up and down 2 g at 10 Hz for 2 s through the glass, then 1.5 s)');
    var res14 = {};
    for (var cmp of [null, 0]) {
      await speed10('app', cmp === null ? {} : { override: { compact: 0 } });
      await reset10({ amount: 'minute' });
      await sec(1.5);
      var b14 = M.packing(await pos());
      await glassShake(2, 10, [0, 1], 2);
      await sec(1.5);
      var e14 = M.packing(await pos());
      res14[cmp === null ? 'on' : 'off'] = 100 * (e14.packing / b14.packing - 1);
      log('  compaction ' + (cmp === null ? 'as set' : 'off') + ': interior packing ' + f2(b14.packing) + ' -> ' + f2(e14.packing) + ' (' + f2(res14[cmp === null ? 'on' : 'off']) + ' %), area ' + b14.area + ' -> ' + e14.area);
    }
    await speed10('app');
    log('  the compaction law\'s share: ' + f2(res14.on - res14.off) + ' % (logged)');
    check(res14.on >= 0, 'shaken sand packs or holds: packing change >= 0 (' + f2(res14.on) + ' %; 5cc11b3: -4.3 after the scoreboard\'s press and sideways shake)');
  }

  if (run(15)) {
    log('15 a 3 g press at real speed (a 1-minute bed, pressed 0.5 s, released)');
    await speed10('real');
    await reset10({ amount: 'minute' });
    await sec(2);
    var sf15 = M.meanSurface(await pos());
    await inp({ mode: 'manual', gravity: [0, 3] });
    await sec(0.5);
    var ul15 = M.meanSurface(await pos()) - sf15;
    await inp({ mode: 'manual', gravity: [0, 1] });
    var hop15 = -Infinity;
    for (var k15 = 0; k15 < 10; k15++) { await sec(0.05); hop15 = Math.max(hop15, M.meanSurface(await pos()) - sf15); }
    log('  surface under the press ' + f2(ul15) + ' cells; highest after the release ' + f2(hop15) + ' cells');
    check(ul15 <= 0.25 && hop15 <= 0.5, 'pressed, the bed does not swell (' + f2(ul15) + ' <= 0.25 cell; 5cc11b3: +1.49) nor hop when let go (' + f2(hop15) + ' <= 0.5; 1.80)');
    await speed10('app');
  }

  if (run(16)) {
    log('16 the drawn stream (an upright pour of the 1-minute amount; grains drawn as their streaks)');
    await speed10('app');
    await reset10({ fill: 'top', amount: 'minute' });
    var inf16 = await L(function () { return window.__lab.info(); }), rn16 = inf16.glass.neckCells / 2, vs16 = Math.sqrt(2 * inf16.g * 3) / 60;
    var cov1 = [], cov0 = [], gap1 = 0, a016 = null, none16 = 0, last16 = null;
    for (var t16 = 0; t16 < 12; t16 += 0.1) {
      await sec(0.1);
      var s16 = await stat();
      if (a016 === null && s16.simTime >= 0.5) a016 = s16.above;
      // (the stream from when it has formed, a fifth of a second after the neck opens, while 95 to
      // 25 % of the sand is above the neck; the sand runs out in a second or two at app speed)
      if (!a016 || s16.simTime < 0.7 || s16.above > 0.95 * a016) continue;
      if (s16.above < 0.25 * a016) break;
      var S16 = await L(async function (g) {
        if (window.__lab.streaks) return window.__lab.streaks();
        // (a page without streaks(): rebuild them from the velocities; upright, the field is straight down)
        var P = await window.__lab.particles(), hz = window.__lab.rate().hz, out = [];
        for (var i = 0; i < P.length; i += 5) out.push(P[i], P[i + 1], P[i + 2] / 60, (P[i + 3] - g / hz) / 60);
        return out;
      }, inf16.g);
      var d1 = M.drawnStream(S16, rn16, vs16, 1), d0 = M.drawnStream(S16, rn16, vs16, 0);
      if (d1) { cov1.push(d1.covered); cov0.push(d0.covered); gap1 = Math.max(gap1, d1.gap); } else none16++;
      last16 = s16;
    }
    log('  (above the neck at the gate: ' + a016 + '; last frame at ' + f2(last16 && last16.simTime) + ' s with ' + (last16 && last16.above) + ' above; ' + none16 + ' frames without room for the stream)');
    var m1 = M.mean(cov1), m0 = M.mean(cov0);
    log('  ' + cov1.length + ' frames: rows covered on the axis ' + f2(m1) + ' with the blur, ' + f2(m0) + ' as dots; longest gap ' + gap1 + ' rows');
    check(cov1.length >= 8 && m1 >= 0.85, 'the falling stream is drawn as a thread: >= 85 % of the rows covered (' + f2(m1) + ')');
    // control: the same frames drawn as dots. (With More, "yield: in loop", sand runs at about 2,400
    // points/s, near Beverloo's rate for this neck, and its points alone fill the axis: 0.98 measured;
    // this control holds for the default, where the stream is sparser: 5cc11b3 drew 0.45.)
    check(m0 <= 0.6, 'control: drawn as dots the stream is broken (' + f2(m0) + ' <= 0.6; 5cc11b3: 0.45)');
  }

  if (run(17)) {
    log('17 syrup oozes (the flow test, 5,000 points from a full top bulb)');
    for (var m17 of ['coarse', 'water', 'syrup']) {
      if (flows[m17]) continue;
      await L(function () { window.__lab.setInput({ mode: 'upright' }); });
      flows[m17] = await L(function (m) { return window.__lab.flowTest({ material: m, points: 5000, chunk: 24, limit: 40 }); }, m17);
    }
    var dc = flows.coarse && flows.coarse.duration, dw = flows.water && flows.water.duration, dsy = flows.syrup && flows.syrup.duration;
    log('  drained in: coarse ' + f1(dc) + ' s, water ' + f1(dw) + ' s, syrup ' + f1(dsy) + ' s');
    check(dsy >= 3 * dw && dsy >= 2 * dc, 'syrup oozes: drains in >= 3 x water\'s time (' + f2(dsy / dw) + ' x) and >= 2 x coarse sand\'s (' + f2(dsy / dc) + ' x; 5cc11b3: 1.47 x water, 0.14 x sand)');
  }

  if (run(18)) {
    log('18 creep (a 1-minute flat bed held at 25 degrees, below repose, app speed)');
    await speed10('app');
    await reset10({ amount: 'minute' });
    await sec(1);
    var g18 = [Math.sin(25 * D2R), Math.cos(25 * D2R)];
    await inp({ mode: 'manual', gravity: g18 });
    await sec(0.5);
    var a18 = await stat(), h18a = await L(function () { return window.__lab.heapAngle({ bulb: 'lower', frame: 'gravity' }); });
    await sec(3);
    var c18 = await stat(), h18c = await L(function () { return window.__lab.heapAngle({ bulb: 'lower', frame: 'gravity' }); });
    var d18 = Math.hypot(c18.com[0] - a18.com[0], c18.com[1] - a18.com[1]);
    log('  centre moves ' + f2(d18) + ' cells from 0.5 s to 3.5 s; surface ' + f1(h18a.tilt) + ' -> ' + f1(h18c.tilt) + ' degrees');
    check(d18 <= 1.15 && Math.abs(h18c.tilt - h18a.tilt) <= 1, 'no worse than 5cc11b3, not yet real sand: below repose it creeps no more than before: centre <= 1.15 cells (' + f2(d18) + '; 5cc11b3: 1.40; real sand <= 0.5), surface within 1 degree (' + f2(Math.abs(h18c.tilt - h18a.tilt)) + '; 1.03)');
    await inp({ mode: 'manual', gravity: [0, 1] });
  }

  /* ---- 19 ----------------------------------------------------------- */
  if (run(19)) {
    log('19 pace (the live loop on the software GPU: a 600-point bed pouring from the top, shaken)');
    var pace19 = async function (set) {
      await L(function (o) { window.__lab.manual(true); window.__lab.settings(o); window.__lab.setInput({ mode: 'manual', gravity: [0, 1], shake: { g: 2, hz: 4, axis: [1, 0] } }); return window.__lab.reset({ fill: 'top', material: 'coarse', points: 600, gate: 0 }); }, set);
      // (the stream is falling fast before the live loop takes over: auto Hz wants to rise)
      await L(function () { return window.__lab.advance(0.8); });
      await L(function () { window.__lab.manual(false); });
      // (while the stream still falls fast: the budget, auto Hz and the report)
      await page.waitForTimeout(5000);
      var early = await L(function () { return { f: window.__lab.frameStats(4000), rep: window.__lab.report() }; });
      // (long enough for frames of the old pace, over a second each here, to come back done)
      await page.waitForTimeout(5000);
      var r = await L(function () { return { f: window.__lab.frameStats(4000), ls: window.__lab.loopState(), log: window.__lab.gpuLog() }; });
      r.early = early.f; r.rep = early.rep;
      // the lag: the median submit-to-done time of the frames done over the last 4 s
      var tLast = r.log.reduce(function (m, x) { return Math.max(m, x.t); }, -Infinity);
      var ms = r.log.filter(function (x) { return x.t >= tLast - 4000; }).map(function (x) { return x.ms; }).sort(function (a, b) { return a - b; });
      r.lag = ms.length ? ms[ms.length >> 1] : NaN;
      r.T = 1000 / (r.f.display || 60);
      r.lagFrames = r.lag / r.T;
      // the quickest frame done, for the bound below
      r.minMs = ms.length ? ms[0] : NaN;
      await L(function () { window.__lab.manual(true); window.__lab.setInput({ mode: 'manual', gravity: [0, 1] }); });
      // (the old pace leaves frames queued on the software GPU: let them finish)
      await page.waitForFunction(function () { var s = window.__lab.loopState(); return s.inflight === 0; }, null, { timeout: 120000, polling: 250 }).catch(function () {});
      return r;
    };
    var desc19 = function (r) { return 'lag ' + f1(r.lag) + ' ms = ' + f2(r.lagFrames) + ' display frames (display ' + f1(r.f.display) + ' Hz), ' + f1(r.f.fps) + ' fps, ' + f1(r.f.steps) + ' substeps a frame, sim/real ' + f2(r.f.ratio) + ', ' + Math.round(100 * r.f.gpuHeld) + '% of frames held by the GPU budget, auto Hz ' + r.early.hzMax + (r.early.wantMax > r.early.hzMax ? ' (wanted ' + r.early.wantMax + ', held in ' + Math.round(100 * r.early.held) + '% of frames, 1 to 5 s in)' : '') + ', up to ' + r.ls.peakInflight + ' frames in flight'; };
    var now19 = await pace19({ queue: 2, budget: true });
    log('  default pace: ' + desc19(now19));
    var old19 = await pace19({ queue: 3, budget: false });
    // the bound: two display frames (two frames in flight), or, where a frame of one substep takes
    // longer than a display frame by itself (the software GPU here: the budget cannot go below one
    // substep), two such frames (the quickest seen at the default pace) and one display frame more;
    // the same for both
    now19.bound = old19.bound = Math.max(2 * now19.T, 2 * now19.minMs + now19.T);
    log('  old pace (control): ' + desc19(old19));
    await L(function () { return window.__lab.settings({ queue: 2, budget: true }); });
    check(now19.ls.peakInflight <= 2 && now19.lag <= now19.bound, 'what is drawn trails the sand by at most two display frames (or, where one substep takes longer than a frame, two such frames and a display frame): at most two frames of work in flight (' + now19.ls.peakInflight + '), lag ' + f1(now19.lag) + ' ms = ' + f2(now19.lagFrames) + ' frames, bound ' + f1(now19.bound) + ' ms');
    check(old19.ls.peakInflight > 1 && old19.lag > old19.bound, 'control: the old pace queues frames and breaks that bound (' + old19.ls.peakInflight + ' in flight, lag ' + f1(old19.lag) + ' ms = ' + f2(old19.lagFrames) + ' frames, bound ' + f1(old19.bound) + ' ms)');
    check(now19.early.gpuHeld > 0 && now19.early.wantMax > now19.early.hzMax && now19.early.held > 0 && /held by the GPU budget/.test(now19.rep) && /auto Hz held back in [1-9]/.test(now19.rep),
      'the GPU budget holds the substeps and auto Hz back here, and the report says so (' + Math.round(100 * now19.early.gpuHeld) + '% of frames, rate ' + now19.early.hzMax + ' for ' + now19.early.wantMax + ')');
    // the Benchmark's default and option rows, and the report's answers (short rows: the software GPU is slow)
    await L(function () { window.__lab.manual(false); });
    var rows19 = await L(function () { return window.__lab.benchmark({ options: true, res: [], warm: 0.5, measure: 2 }); });
    await L(function () { window.__lab.manual(true); });
    var text19 = await L(function () { return window.__lab.report(); });
    rows19.forEach(function (r) { log('  bench (software GPU, not a phone) ' + r.res + ' ' + r.amount + ' ' + r.speed + (r.tag ? ' [' + r.tag + ']' : '') + ': ' + r.points + ' points, ' + r.dispatches + ' dispatches a substep, ' + f2(r.msStep) + ' ms a substep, sim/real ' + f2(r.ratio)); });
    var tags19 = rows19.map(function (r) { return r.tag; }).join(',');
    check(tags19 === 'default,default,spread off,blur off,8 iterations,yield in loop' && rows19.every(function (r) { return isFinite(r.msStep) && r.msStep > 0; }) && rows19[2].dispatches === rows19[0].dispatches - 2,
      'the Benchmark times the default at both speeds and each costly option, with the GPU time a substep (' + tags19 + ')');
    check(/\nAnswers /.test(text19) && /Default, coarse grid, 1-minute, app speed: (HOLDS|does NOT hold) real time/.test(text19) && /Default, coarse grid, 1-minute, real speed: /.test(text19) && /Costly options at the default .*spread off .*blur off .*8 iterations/.test(text19) && /\nPace: at most 2 frames of GPU work in flight/.test(text19),
      'Copy results answers: does the default hold real time at each speed, the lag, the display rate, and what each option costs');
  }

  check(errors.length === 0, 'no page errors through the run' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  server.close();
}

main().catch(function (e) { failures++; log('FAIL  ' + (e && e.stack || e)); }).then(function () {
  log((failures ? 'lab-sand: ' + failures + ' of ' + count + ' checks FAILED' : 'lab-sand: all ' + count + ' checks passed') + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  process.exit(failures ? 1 : 0);
});
