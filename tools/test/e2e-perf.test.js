/*
 * Integration E13: performance, from Hourglass.perf (JS work per frame, the
 * physics steps and drawSand within it, and the time between frames).
 *
 * At 1×:
 *   - 20 s of shaking without rotation ('lateralVV' 10 s, then 'veryVigSlow'
 *     10 s): frame work p95 ≤ 8 ms, sim p95 ≤ 3 ms, drawSand p95 ≤ 1.5 ms
 *   - a 9 rad/s free spin with a crack present: frame work p95 ≤ 8 ms, and
 *     c-front redrawn at most 30 times a second
 *   - no long task over 50 ms after the warm-up
 * At 4× (CDP CPU throttling):
 *   - the governor drops sim.quality to ≤ 1 within 3 s of a shake starting
 *   - sim p95 ≤ 8 ms once it has
 *   - frame interval p95 ≤ 20 ms during the shake, or, if the unshaken
 *     baseline at 4× cannot do that here, the shake adds ≤ 3 ms to its p95
 *
 *   node tools/test/e2e-perf.test.js [--root <dir>] [--port <n>] [--only shake|spin|cpu4]
 *
 * Without a GPU the WebGL glass is shaded in software, so this runs with the
 * app's 2-D glass (see harness.js); JS frame work does not depend on it.
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;

function longTasks() {
  window.__long = [];
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { window.__long.push({ t: e.startTime, d: e.duration }); });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
}

async function realMotionOn(t) {
  await t.page.tap('#btn-settings');
  await sleep(700);
  await t.page.$eval('#opt-tilt', function (el) { el.scrollIntoView({ block: 'center' }); });
  await sleep(150);
  await t.page.tap('#opt-tilt');
  await sleep(300);
  await t.page.tap('#sheet-settings .sheet-close');
  await sleep(700);
}
function ms(v) { return v.toFixed(2) + ' ms'; }

async function shake1x(s, env) {
  var t = await env.open({ init: longTasks });
  await realMotionOn(t);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); window.Hourglass.start(); });
  await sleep(2000);                                        // warm-up
  var warm = await t.eval(function () { return performance.now(); });
  var w = await H.perfWatch(t);
  await t.eval(function () { window.__drive({ profile: 'lateralVV', conv: 'ios', durS: 10 }); });
  await w.wait(10000);
  await t.eval(function () { window.__drive({ profile: 'veryVigSlow', conv: 'ios', durS: 10 }); });
  await w.wait(10000);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); });
  var lt = await t.eval(function (w0) { return window.__long.filter(function (e) { return e.t > w0 && e.d > 50; }); }, warm);
  var info = await t.eval(function () { var H = window.Hourglass; return { q: H.perf.quality, cracks: H.sim.cracks.length, lost: H.sim.lost }; });
  var f95 = H.pct(w.frame, 95), s95 = H.pct(w.sim, 95), d95 = H.pct(w.draw, 95);
  s.check('E13 1× shake: frame work p95 ≤ 8 ms', f95 <= 8, 'p95 ' + ms(f95) + ', p50 ' + ms(H.pct(w.frame, 50)) + ', max ' + ms(Math.max.apply(null, w.frame)) +
          ' over ' + w.frame.length + ' frames (' + info.cracks + ' cracks, ' + info.lost + ' lost on the way)');
  s.check('E13 1× shake: sim p95 ≤ 3 ms', s95 <= 3, 'p95 ' + ms(s95) + ', p50 ' + ms(H.pct(w.sim, 50)) + ', quality now ' + info.q);
  s.check('E13 1× shake: drawSand p95 ≤ 1.5 ms', d95 <= 1.5, 'p95 ' + ms(d95) + ', p50 ' + ms(H.pct(w.draw, 50)));
  s.check('E13 1×: no long task over 50 ms after the warm-up', lt.length === 0, lt.length + ' long tasks ' + JSON.stringify(lt.slice(0, 3)));
  await t.eval(function () { window.__driveStop(); });
  await H.invariants(s, t, 'E13 shake');
  await t.close();
}

async function spin1x(s, env) {
  var t = await env.open({ init: longTasks });
  await t.eval(function () {
    window.Hourglass.debug.forceCrack(156, 60, 2);
    var R = window.Hourglass.renderer, df = R._drawFront;
    window.__df = 0;
    R._drawFront = function () { window.__df++; return df.apply(this, arguments); };
  });
  // warm-up: the first touch unlocks the sound (building its graph is a ~50 ms task of its
  // own); a tap beside the glass does that without starting or turning anything
  await t.touch.tap(12, 420, 60);
  await sleep(2000);
  var g = await t.glass();
  var warm = await t.eval(function () { return performance.now(); });
  var R = 0.2 * g.h, R1 = R + 22, a0 = -Math.PI / 2;
  await t.touch.down(g.cx + R * Math.cos(a0), g.cy + R * Math.sin(a0));
  await sleep(30);
  await t.touch.move(g.cx + R1 * Math.cos(a0), g.cy + R1 * Math.sin(a0));
  await sleep(50);
  var w = await H.perfWatch(t);
  var d0 = await t.eval(function () { return { n: window.__df, t: performance.now() }; });
  await t.touch.path(function (u) { var a = a0 + 9 * 0.26 * u; return { x: g.cx + R1 * Math.cos(a), y: g.cy + R1 * Math.sin(a) }; }, 260, true);
  try {
    await t.page.waitForFunction(function () { var H = window.Hourglass; return H.body.mode === 'rest' && !H.flip.active; }, null, { timeout: 6000, polling: 'raf' });
  } catch (e) {}
  var d1 = await t.eval(function () { return { n: window.__df, t: performance.now(), w: __mon.upW }; });
  await w.poll();
  var lt = await t.eval(function (w0) { return window.__long.filter(function (e) { return e.t > w0 && e.d > 50; }); }, warm);
  var rate = (d1.n - d0.n) / ((d1.t - d0.t) / 1000);
  var f95 = H.pct(w.frame, 95);
  s.check('E13 1× spin (9 rad/s, a crack present): frame work p95 ≤ 8 ms', f95 <= 8,
          'p95 ' + ms(f95) + ', max ' + ms(Math.max.apply(null, w.frame)) + ' over ' + w.frame.length + ' frames, released at ' + d1.w.toFixed(2) + ' rad/s');
  s.check('E13 1× spin: c-front redrawn at most 30 times a second', rate <= 31, rate.toFixed(1) + ' redraws/s (' + (d1.n - d0.n) + ' in ' + ((d1.t - d0.t) / 1000).toFixed(2) + ' s)');
  s.check('E13 1× spin: no long task over 50 ms', lt.length === 0, lt.length + ' long tasks ' + JSON.stringify(lt.slice(0, 3)));
  await H.invariants(s, t, 'E13 spin');
  await t.close();
}

async function cpu4(s, env) {
  var t = await env.open({});
  await realMotionOn(t);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); window.Hourglass.start(); });
  await sleep(1500);
  await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await sleep(1500);
  var base = await H.perfWatch(t);
  await base.wait(5000);
  var b95 = H.pct(base.interval, 95);
  await t.eval(function () {
    var H = window.Hourglass;
    window.__q = { t0: performance.now(), at: -1 };
    (function f() {
      if (window.__q.at < 0 && H.sim.quality <= 1) window.__q.at = performance.now() - window.__q.t0;
      if (performance.now() - window.__q.t0 < 12000) requestAnimationFrame(f);
    })();
    window.__drive({ profile: 'veryVigSlow', conv: 'ios', durS: 12 });
  });
  var all = await H.perfWatch(t);
  await all.wait(3500);
  var q = await t.eval(function () { return window.__q.at; });
  var after = await H.perfWatch(t);
  await after.wait(8000);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); });
  await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  var shakeIv = all.interval.concat(after.interval);
  var i95 = H.pct(shakeIv, 95), s95 = H.pct(after.sim, 95);
  s.check('E13 4×: the governor drops quality to ≤ 1 within 3 s of the shake', q >= 0 && q <= 3000, q < 0 ? 'never' : 'after ' + (q / 1000).toFixed(2) + ' s');
  s.check('E13 4×: sim p95 ≤ 8 ms once it has', s95 <= 8, 'p95 ' + ms(s95) + ', p50 ' + ms(H.pct(after.sim, 50)) + ', quality ' + JSON.stringify(after.quality));
  var fps = 1000 / H.pct(shakeIv, 50);
  if (b95 <= 20) {
    s.check('E13 4×: frame interval p95 ≤ 20 ms during the shake', i95 <= 20, 'p95 ' + ms(i95) + ' (baseline ' + ms(b95) + '), ~' + fps.toFixed(0) + ' fps');
  } else {
    s.check('E13 4×: the shake adds ≤ 3 ms to the frame interval p95 (the unshaken baseline here is over 20 ms)', i95 - b95 <= 3,
            'shake p95 ' + ms(i95) + ' vs baseline ' + ms(b95) + ', ~' + fps.toFixed(0) + ' fps');
  }
  await t.eval(function () { window.__driveStop(); });
  await H.invariants(s, t, 'E13 4×');
  await t.close();
}

(async function main() {
  var s = new H.Suite('e2e-perf (E13)');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!env.caps.p1) s.check('E13 needs the motion path (physics-core P1)', false, 'the served sim is P0');
    else {
      if (!only || only === 'shake') await shake1x(s, env);
      if (!only || only === 'spin') await spin1x(s, env);
      if (!only || only === 'cpu4') await cpu4(s, env);
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
