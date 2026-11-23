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
 *   node tools/test/e2e-perf.test.js [--root <dir>] [--port <n>] [--only shake|spin|cpu4] [--trace]
 *
 * Without a GPU the WebGL glass is shaded in software, so this runs with the
 * app's 2-D glass (see harness.js); JS frame work does not depend on it.
 *
 * --trace also records Chromium's own trace over each measured stretch and
 * notes how the renderer's main thread spent it (the frame callbacks, which
 * are the app's own work, against commit, paint, GC and the rest), how busy
 * the raster and display-compositor threads were, the frame callbacks in
 * thread CPU time (which leaves out whatever other processes on a busy
 * machine took), and what made up each long task. Headless Chromium without
 * a GPU rasterises and composites the app's large DPR 3 canvases in
 * software, and copies them in each commit on the main thread: work a
 * phone's GPU does instead. The budgets are checked exactly as without
 * --trace, though tracing costs a little.
 */
'use strict';
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

/* ---- --trace -------------------------------------------------------------- */
var TRACE = process.argv.indexOf('--trace') >= 0;
var TRACE_CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'v8', 'blink', 'cc', 'viz', 'gpu', '__metadata'];

async function traceStart(t) {
  if (!TRACE) return null;
  // (wrapped: an async function returning the bare promise would wait for it)
  var tr = { done: new Promise(function (r) { t.cdp.once('Tracing.tracingComplete', r); }) };
  await t.cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: TRACE_CATS } });
  return tr;
}
async function traceStop(t, tr) {
  if (!tr) return null;
  await t.cdp.send('Tracing.end');
  var ev = await tr.done, parts = [];
  for (;;) {
    var r = await t.cdp.send('IO.read', { handle: ev.stream, size: 1 << 20 });
    parts.push(r.base64Encoded ? Buffer.from(r.data, 'base64').toString('utf8') : r.data);
    if (r.eof) break;
  }
  await t.cdp.send('IO.close', { handle: ev.stream });
  var d = JSON.parse(parts.join(''));
  return d.traceEvents || d;
}

// What a stretch of the main thread was doing, by the nearest enclosing event
// that says so (GC inside a frame callback counts as GC).
var KINDS = [
  [/^(MinorGC|MajorGC|V8\.GC|BlinkGC|GCEvent|V8\.Scavenge)/, 'GC'],
  [/^FireAnimationFrame$/, 'frame callbacks'],
  [/ProduceCanvasResource/, 'commit: copying the canvases'],
  [/[Cc]ommit/, 'commit'],
  [/^(Paint|PaintImage|PrePaint|Layerize|UpdateLayerTree|Layout|UpdateLayoutTree|RecalcStyle|UpdateStyle|HitTest)$/, 'style, layout, paint'],
  [/^(TimerFire|EventDispatch|FunctionCall|EvaluateScript|v8\.callFunction|v8\.run|RunMicrotasks)$/, 'other script (test driver, events)']
];
/** The kind of an event inside one of kind `up`: script inside a frame callback belongs to the callback. */
function kindOf(name, up) {
  for (var i = 0; i < KINDS.length; i++) {
    if (!KINDS[i][0].test(name)) continue;
    var k = KINDS[i][1];
    return k === KINDS[KINDS.length - 1][1] && up !== 'other' ? up : k;
  }
  return up;
}
function f1(v) { return v.toFixed(1); }

/** Notes on where the time went over a traced stretch (see --trace). */
function traceNotes(s, label, events, ring) {
  if (!events) return;
  var names = {}, byThread = {};
  events.forEach(function (e) {
    if (e.ph === 'M' && e.name === 'thread_name') names[e.pid + ':' + e.tid] = e.args && e.args.name;
    else if (e.ph === 'X' && e.dur >= 0) (byThread[e.pid + ':' + e.tid] = byThread[e.pid + ':' + e.tid] || []).push(e);
  });
  var main = null, most = 0;
  Object.keys(byThread).forEach(function (k) {
    var n = 0;
    byThread[k].forEach(function (e) { if (e.name === 'FireAnimationFrame') n++; });
    if (n > most) { most = n; main = k; }
  });
  if (!main) { s.note(label + ' trace', 'no frame callbacks recorded'); return; }
  // Walk the main thread's nested events: each one's own time (less what it
  // contains) goes to its kind; each top-level task sums its frame callbacks
  // (the app's frame and the test's small monitors) and keeps its split.
  var list = byThread[main].sort(function (a, b) { return a.ts - b.ts || b.dur - a.dur; });
  var t0 = list[0].ts, t1 = t0, busy = 0, busyCpu = 0, self = {}, byName = {}, frames = [], longs = [], stack = [];
  function close(n) {
    var own = n.e.dur - n.kids;
    self[n.kind] = (self[n.kind] || 0) + own;
    byName[n.e.name] = (byName[n.e.name] || 0) + own;
    n.root.split[n.kind] = (n.root.split[n.kind] || 0) + own;
    if (n !== n.root) return;
    if (n.e.dur > 50000) longs.push(n);
    if (n.raf > 0) frames.push([n.raf / 1000, n.rafCpu / 1000]);
  }
  for (var i = 0; i < list.length; i++) {
    var e = list[i], end = e.ts + e.dur;
    while (stack.length && stack[stack.length - 1].end <= e.ts) close(stack.pop());
    var parent = stack.length ? stack[stack.length - 1] : null;
    var n = { e: e, end: end, kids: 0, kind: kindOf(e.name, parent ? parent.kind : 'other'),
              root: null, inRaf: false, raf: 0, rafCpu: 0, split: {} };
    n.root = parent ? parent.root : n;
    if (parent) {
      parent.kids += e.dur;
      n.inRaf = parent.inRaf || parent.e.name === 'FireAnimationFrame';
    } else {
      busy += e.dur; busyCpu += e.tdur || 0;
      if (end > t1) t1 = end;
    }
    if (e.name === 'FireAnimationFrame' && !n.inRaf) { n.root.raf += e.dur; n.root.rafCpu += e.tdur || 0; }
    stack.push(n);
  }
  while (stack.length) close(stack.pop());
  var secs = (t1 - t0) / 1e6;
  var parts = Object.keys(self).sort(function (a, b) { return self[b] - self[a]; })
    .map(function (k) { return k + ' ' + f1(self[k] / 1000 / secs); });
  s.note(label + ' trace: renderer main thread', 'busy ' + f1(busy / 1000 / secs) + ' ms/s (CPU ' + f1(busyCpu / 1000 / secs) +
         ' ms/s) over ' + secs.toFixed(1) + ' s: ' + parts.join(', ') + ' (ms/s)');
  s.note(label + ' trace: largest own times there', Object.keys(byName).sort(function (a, b) { return byName[b] - byName[a]; }).slice(0, 6)
    .map(function (k) { return k + ' ' + f1(byName[k] / 1000 / secs); }).join(', ') + ' (ms/s)');
  var fw = frames.map(function (f) { return f[0]; }), fc = frames.map(function (f) { return f[1]; });
  s.note(label + ' trace: frame callbacks per frame', 'p95 ' + f1(H.pct(fw, 95)) + ' ms wall, ' + f1(H.pct(fc, 95)) + ' ms thread CPU, p50 ' +
         f1(H.pct(fw, 50)) + ' / ' + f1(H.pct(fc, 50)) + ' ms (' + frames.length + ' frames)' +
         (ring ? '; Hourglass.perf.frameMs over the same stretch: p95 ' + f1(H.pct(ring, 95)) + ' ms' : ''));
  // off the main thread: compositing the picture (in software here), rasterising tiles
  var other = {};
  Object.keys(byThread).forEach(function (k) {
    if (k === main) return;
    var nm = names[k] || '?', grp = /VizCompositor/.test(nm) ? 'display compositor (software draw)' :
              (/^Compositor$/.test(nm) ? 'compositor' : (/ThreadPool|TileWorker|Raster/.test(nm) ? 'worker pool (raster)' :
              (/CrGpuMain/.test(nm) ? 'GPU main' : null)));
    if (!grp) return;
    var l = byThread[k].slice().sort(function (a, b) { return a.ts - b.ts || b.dur - a.dur; }), end2 = -1, sum = 0;
    l.forEach(function (ev) { if (ev.ts >= end2 && ev.ts >= t0 && ev.ts <= t1) { sum += ev.dur; end2 = ev.ts + ev.dur; } });
    other[grp] = (other[grp] || 0) + sum;
  });
  s.note(label + ' trace: off the main thread', Object.keys(other).map(function (k) { return k + ' ' + f1(other[k] / 1000 / secs) + ' ms/s'; }).join(', ') || 'nothing recorded');
  if (longs.length) {
    s.note(label + ' trace: long tasks', longs.slice(0, 6).map(function (n) {
      var sp = n.split;
      return f1(n.e.dur / 1000) + ' ms = ' + Object.keys(sp).sort(function (a, b) { return sp[b] - sp[a]; }).slice(0, 3)
        .map(function (k) { return k + ' ' + f1(sp[k] / 1000); }).join(' + ');
    }).join('; '));
  }
}

function longTasks() {
  window.__long = [];
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { window.__long.push({ t: e.startTime, d: e.duration }); });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
}

async function realMotionOn(t) {
  await tune.tap(t, '#opt-tilt');                  // (Tune opened, the switch's tab shown: lib/tune.js)
  await sleep(300);
  await tune.close(t);
  await sleep(100);
}
function ms(v) { return v.toFixed(2) + ' ms'; }

async function shake1x(s, env) {
  var t = await env.open({ init: longTasks });
  await realMotionOn(t);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); window.Hourglass.start(); });
  await sleep(2000);                                        // warm-up
  var warm = await t.eval(function () { return performance.now(); });
  var w = await H.perfWatch(t);
  var tr = await traceStart(t);
  await t.eval(function () { window.__drive({ profile: 'lateralVV', conv: 'ios', durS: 10 }); });
  await w.wait(10000);
  await t.eval(function () { window.__drive({ profile: 'veryVigSlow', conv: 'ios', durS: 10 }); });
  await w.wait(10000);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); });
  var lt = await t.eval(function (w0) { return window.__long.filter(function (e) { return e.t > w0 && e.d > 50; }); }, warm);
  var info = await t.eval(function () { var H = window.Hourglass; return { q: H.perf.quality, cracks: H.sim.cracks.length, lost: H.sim.lost }; });
  traceNotes(s, 'E13 1× shake', await traceStop(t, tr), w.frame);
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
  var tr = await traceStart(t);
  var d0 = await t.eval(function () { return { n: window.__df, t: performance.now() }; });
  await t.touch.path(function (u) { var a = a0 + 9 * 0.26 * u; return { x: g.cx + R1 * Math.cos(a), y: g.cy + R1 * Math.sin(a) }; }, 260, true);
  try {
    await t.page.waitForFunction(function () { var H = window.Hourglass; return H.body.mode === 'rest' && !H.flip.active; }, null, { timeout: 6000, polling: 'raf' });
  } catch (e) {}
  var d1 = await t.eval(function () { return { n: window.__df, t: performance.now(), w: __mon.upW }; });
  await w.poll();
  var lt = await t.eval(function (w0) { return window.__long.filter(function (e) { return e.t > w0 && e.d > 50; }); }, warm);
  traceNotes(s, 'E13 1× spin', await traceStop(t, tr), w.frame);
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
  var trA = await traceStart(t);
  await base.wait(5000);
  var evA = await traceStop(t, trA);
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
  var trB = await traceStart(t);
  await after.wait(8000);
  var evB = await traceStop(t, trB);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); });
  await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // (at 4× the renderer's main thread runs throttled: its wall and CPU times both include it)
  traceNotes(s, 'E13 4× calm baseline', evA, base.frame);
  traceNotes(s, 'E13 4× shake', evB, after.frame);
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
    if (!only || only === 'shake') await shake1x(s, env);
    if (!only || only === 'spin') await spin1x(s, env);
    if (!only || only === 'cpu4') await cpu4(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
