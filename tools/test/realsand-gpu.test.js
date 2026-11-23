#!/usr/bin/env node
/*
 * Real sand in the app on a real WebGPU engine (design 13.3, narrow): Chromium's software
 * adapter (SwiftShader), the app loaded with ?offscreen=1 (the engine draws into a texture shown
 * on a 2-D canvas, since this Chromium cannot read back a WebGPU canvas, and accepts the
 * software adapter; tests only).
 *
 * SwiftShader runs a substep of a 10 s glass in tens of milliseconds, a few hundredths of real
 * time. So once the engine has started (in real time), the page's clock is made virtual: Date,
 * performance.now, its animation frames and its timers are driven by the test, one display
 * frame (1/60 s) at a time, each only once the GPU has finished the last one's work. The GPU's
 * budget then never binds, and the sand runs at real time in virtual time, as on the phone.
 * (Auto Hz is held at 480, the base rate, as the design's virtual clock asks: the one change the
 * test makes to the engine, on the instance.) Readbacks still come 1-3 frames late, as on the
 * phone. 10 s glasses (1,952 points), layered sand on.
 *
 *  BOOT    the switch on: the engine starts (pipelines, self-test), adopts the CPU sand and
 *          takes over: "On", the canvas drawn, the GPU's points the ledger's, the audit
 *          passes, the start-up times logged, the tone pass there;
 *  RUN     a 10 s glass to its end: the last point crosses within one frame after 00:00.0 (by
 *          the GPU's own record of its substep), no catch-up or residue transfer, the count 0
 *          within 3 frames of the end and never 0 while a point is above, every readback's
 *          audit passes (never fewer points above than the clock's target);
 *  RESET   the sweep lasts about a second; the new glass's count exact, all its points above;
 *  FLIP    at 4 s: the time after the swap is remAt(total - nTop) of the count at the swap, the
 *          count never goes back while the readback after the turn comes, which agrees with the
 *          ledger;
 *  POUR    0.5 s of + Sand, then real motion turning the glass over while sand is poured (a
 *          tilt swap with a pour): the time after each pour remAt(topAt(rem) + made) to 1e-6,
 *          every point poured on the GPU, the time after the swap remAt(total - nTop), and no
 *          readback with fewer points above than the target;
 *  HIDDEN  30 s hidden (the glass ends meanwhile), then shown: one transfer moves what is owed,
 *          the audit passes, and the glass empties;
 *  LOSS    the device destroyed mid-run and reported lost: the CPU sand takes over in the same
 *          frame with the ledger's counts, the clock untouched, its canvas shown; Real sand is
 *          rebuilt and takes the sand back;
 *  and no page or console errors.
 *
 * With --shots <dir> it saves pictures of the app with Real sand on: at rest, the stream, the
 * layers after a Flip, the Reset's two halves, the glass turned over by real motion, the CPU
 * sand after the loss. It runs only when named (run-all.js realsand-gpu), 10 to 15 minutes;
 * never two SwiftShader browsers at once.
 *   node tools/test/realsand-gpu.test.js [--port 8908] [--shots dir]
 */
'use strict';
var playwright = require('playwright');
var staticServer = require('./lib/static-server.js');
var path = require('path');
var fs = require('fs');
var ROOT = require('./lib/paths.js').ROOT;
var port = +process.env.PORT || 8908, shots = null;
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--port') port = +process.argv[++i];
  else if (process.argv[i] === '--shots') shots = process.argv[++i];
}
if (shots) fs.mkdirSync(shots, { recursive: true });
var count = 0, failures = 0, t0 = Date.now();
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + what + (detail ? '  — ' + detail : ''));
}
var FRAME = 1000 / 60;

/**
 * The page's clock, virtual on demand: installed before the app's scripts, real until freeze().
 * Then Date.now and performance.now read the virtual time, and animation frames and timers wait
 * for frame() and advance(); frame() runs one display frame and waits for the GPU's work.
 */
function virtualClock() {
  var realPerf = performance.now.bind(performance), realDate = Date.now, realRAF = window.requestAnimationFrame.bind(window);
  var realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  var realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  var V = window.__vt = { on: false, now: 0, off: 0, rafs: [], timers: [], id: 1e6, hidden: false, frames: 0, after: null };
  performance.now = function () { return V.on ? V.now : realPerf(); };
  Date.now = function () { return V.on ? Math.floor(V.off + V.now) : realDate(); };
  window.requestAnimationFrame = function (cb) { if (!V.on) return realRAF(cb); V.rafs.push(cb); return ++V.id; };
  window.setTimeout = function (fn, ms) {
    if (!V.on) return realST.apply(null, arguments);
    var id = ++V.id;
    V.timers.push({ id: id, at: V.now + (+ms || 0), fn: fn, args: [].slice.call(arguments, 2) });
    return id;
  };
  window.setInterval = function (fn, ms) {
    if (!V.on) return realSI.apply(null, arguments);
    var id = ++V.id;
    V.timers.push({ id: id, at: V.now + (+ms || 0), every: Math.max(1, +ms || 0), fn: fn, args: [] });
    return id;
  };
  window.clearTimeout = function (id) { if (id > 1e6) V.timers = V.timers.filter(function (t) { return t.id !== id; }); else realCT(id); };
  window.clearInterval = function (id) { if (id > 1e6) V.timers = V.timers.filter(function (t) { return t.id !== id; }); else realCI(id); };
  V.freeze = function () { V.now = realPerf(); V.off = realDate() - V.now; V.on = true; };
  V.realSleep = function (ms) { return new Promise(function (r) { realST(r, ms); }); };
  V.advance = function (ms) {
    var end = V.now + ms;
    for (;;) {
      V.timers.sort(function (a, b) { return a.at - b.at; });
      var t = V.timers[0];
      if (!t || t.at > end) break;
      V.now = Math.max(V.now, t.at);
      if (t.every) t.at += t.every; else V.timers.shift();
      try { t.fn.apply(null, t.args); } catch (e) { console.error(e); }
    }
    V.now = end;
  };
  V.frame = async function () {
    V.advance(1000 / 60);
    var cbs = V.rafs; V.rafs = [];
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](V.now); } catch (e) { console.error(e); } }
    V.frames++;
    if (V.after) V.after();
    var rs = window.Hourglass && window.Hourglass.realSand;
    if (rs && rs.device && !rs._gone) {
      // (a device that is gone may never answer)
      await Promise.race([rs.device.queue.onSubmittedWorkDone().catch(function () {}), V.realSleep(3000)]);
    }
    await V.realSleep(0);
  };
  V.setHidden = function (h) {
    V.hidden = !!h;
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return V.hidden; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return V.hidden ? 'hidden' : 'visible'; } });
    document.dispatchEvent(new Event('visibilitychange'));
  };
}

/**
 * In the page, once Real sand is live: the watch over every frame and every readback.
 * W.cross: the wall time of the last crossing (its substep within its run's span); W.audit: the
 * audits that failed; W.pours, W.swaps: the pour and swap sites; W.frames: each frame's count.
 */
function installWatch() {
  var H = window.Hourglass, rs = H.realSand, T = H.timer, V = window.__vt;
  var W = window.__watch = { cross: null, audits: 0, audit: [], pours: [], swaps: [], frames: [], keep: false };
  rs._chooseRate = function () { this.rate.hz = 480; };       // the design's virtual clock: auto Hz held at 480
  var onTally = rs._onTally;
  rs._onTally = function (w, t, tSim, parity) {
    onTally.call(this, w, t, tSim, parity);
    if (t.crossings > 0 && t.lastCross >= 0 && w.steps > 0) W.cross = w.from + (w.to - w.from) * (t.lastCross + 1) / w.steps;
    var a = this.audit();
    W.audits++;
    if (a && !a.ok && W.audit.length < 5) W.audit.push({ a: a, t: { above: t.above, below: t.below, crossings: t.crossings } });
  };
  // the pour site: the time after the app's own update, at the next of its sim calls (a swap, a step) or the frame's end
  var pend = null;
  function settlePour() {
    if (!pend) return;
    var want = H.remAt(H.topAt(pend.rem) + pend.made);
    W.pours.push({ made: pend.made, rem: T.rem, want: want, ok: Math.abs(T.rem - want) <= 1e-6 * Math.max(1, want) });
    pend = null;
  }
  var pour = rs.pour;
  rs.pour = function (n) {
    settlePour();
    var rem = T.rem, made = pour.call(this, n);
    if (made) pend = { rem: rem, made: made };
    return made;
  };
  var step = rs.step;
  rs.step = function () { settlePour(); return step.call(this); };
  var flip = rs.completeFlip;
  rs.completeFlip = function () {
    settlePour();
    var rec = { top: this.nTop, total: this.total, at: V.frames + 1, seq: this.valve.last ? this.valve.last.seq : 0 };
    flip.call(this);
    W.swaps.push(rec);
  };
  // after each frame's callbacks: the time the swap set, and the count's course
  V.after = function () {
    settlePour();
    var s = W.swaps[W.swaps.length - 1];
    if (s && s.rem === undefined && s.at === V.frames) { s.rem = T.rem; s.want = H.remAt(s.total - s.top); }
    var t = rs._tally;
    if (W.keep) W.frames.push({ f: V.frames, now: Date.now(), rem: T.rem, state: T.state, nTop: H.sim.nTop, above: t ? t.above : -1 });
  };
}

(async function main() {
  var server = await new Promise(function (res, rej) { var s = staticServer.start(port, ROOT, function () { res(s); }); s.on('error', rej); });
  var browser = null, errors = [];
  try {
    browser = await playwright.chromium.launch({ channel: 'chromium',
      args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--disable-webgl', '--autoplay-policy=no-user-gesture-required'] });
    var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(virtualClock);
    await ctx.addInitScript(function () {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('hourglass.settings.v1', JSON.stringify({ realSand: true, durationMs: 10000, layers: true }));
    });
    var page = await ctx.newPage();
    page.on('pageerror', function (e) { errors.push('pageerror: ' + (e && e.message)); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/?offscreen=1');

    /** n virtual frames, or until the expression `until` (in the page: H, rs, T, W) holds. */
    async function frames(n, until) {
      return page.evaluate(async function (a) {
        var V = window.__vt, H = window.Hourglass, T = H.timer, W = window.__watch, f = 0;
        var test = a.until ? new Function('H', 'rs', 'T', 'W', 'return (' + a.until + ');') : null;
        for (; f < a.n; f++) { await V.frame(); if (test && test(H, H.realSand, T, W)) { f++; break; } }
        return f;
      }, { n: n, until: until || null });
    }
    /** The engine's state as the page sees it. */
    function probe() {
      return page.evaluate(function () {
        var H = window.Hourglass, rs = H.realSand, st = rs ? rs.stats() : null, a = rs && rs.audit ? rs.audit() : null;
        var c = document.getElementById('c-gpu'), px = -1;
        if (c) {
          try {
            var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            px = 0;
            for (var k = 3; k < d.length; k += 4 * 13) if (d[k] > 0) px++;
          } catch (e) { px = -2; }
        }
        return { live: !!rs && H.sim === rs, note: document.getElementById('realsand-note').textContent, state: H.timer.state,
          rem: H.timer.rem, nTop: H.sim.nTop, total: H.sim.total, want: H.grainsFor(H.timer.durationMs),
          pts: rs ? rs.valve.Pts(H.sim.total) : 0, points: rs ? rs.points : 0, gpuCount: rs && rs.solver ? rs.solver.count : 0,
          tally: st && st.tally, audit: a, px: px, times: st && st.times, n: st && st.n, mode: st && st.mode,
          layers: st && st.layers && { on: st.layers.on, toner: st.layers.toner, tones: st.layers.tones },
          real: document.getElementById('app').classList.contains('real') };
      });
    }
    /** A probe once runs encoded from now have been read back (or the sand is asleep: its last readback stands). */
    async function fresh() {
      await page.evaluate(function () { window.__watch.since = window.Hourglass.realSand.stats().n.runs; });
      await frames(40, "rs.stats().n.runs > W.since + 3 || (rs.stats().mode === 'asleep' && rs.stats().inflight === 0)");
      await frames(3);
      return probe();
    }
    async function shot(name) {
      if (!shots) return;
      await page.screenshot({ path: path.join(shots, name + '.png'), clip: { x: 45, y: 120, width: 300, height: 590 } });
    }
    var sweeping = '!document.getElementById("app").classList.contains("sweep")';

    /* ---- BOOT ------------------------------------------------------------ */
    await page.waitForFunction(function () {
      var H = window.Hourglass;
      return !!H && ((!!H.realSand && H.sim === H.realSand) || /Could not|Needs|Did not|updating/.test(document.getElementById('realsand-note').textContent));
    }, null, { timeout: 180000, polling: 200 });
    await page.evaluate(function () { window.__vt.freeze(); });
    await page.evaluate(installWatch);
    var b = await fresh();
    check(b.live && b.note === 'On' && b.real, 'BOOT: the engine starts on WebGPU, adopts the CPU sand and takes over (Hourglass.sim is it, "On")', b.note);
    check(b.px > 100, 'BOOT: its canvas holds the drawn sand', b.px + ' sampled pixels drawn');
    check(!!b.tally && b.tally.points === b.points && b.points === b.pts && b.gpuCount === b.pts && b.tally.nan === 0 && b.tally.outside === 0 && b.total === b.want,
          'BOOT: the GPU holds exactly the ledger\'s points for the glass, none lost or outside', JSON.stringify({ tally: b.tally, points: b.points, total: b.total }));
    check(!!b.audit && b.audit.ok, 'BOOT: the newest readback agrees with the ledger (audit)', JSON.stringify(b.audit));
    check(b.times && b.times.pipelines > 0 && b.times.selfTest > 0 && b.times.firstFrame > 0,
          'BOOT: the start-up times are logged (device, pipelines, self-test, first frame)', JSON.stringify(b.times));
    check(b.layers && b.layers.on && b.layers.toner, 'BOOT: layered sand runs on the GPU (the tone pass)', JSON.stringify(b.layers));
    await shot('1-rest');

    /* ---- RUN ------------------------------------------------------------- */
    var r0 = await page.evaluate(function () {
      var H = window.Hourglass, W = window.__watch, w = H.realSand.stats().layers.words;
      W.keep = true; W.frames = []; W.audit = []; W.cross = null;
      H.start();
      return { n: H.realSand.stats().n, tone1: w ? w.above1 + w.below1 : -1 };
    });
    await frames(180);
    await shot('2-stream');
    await frames(900, "T.state === 'done' && rs.nTop === 0");
    await frames(4);
    var run = await page.evaluate(function () {
      var W = window.__watch, F = W.frames, zeroAt = null, doneF = null, emptyF = null, zeroUp = 0;
      for (var i = 0; i < F.length; i++) {
        if (F[i].state === 'running' && zeroAt === null) zeroAt = F[i].now + F[i].rem;
        if (F[i].state === 'done' && doneF === null) doneF = F[i].f;
        if (doneF !== null && F[i].nTop === 0 && emptyF === null) emptyF = F[i].f;
        // (the count reads 0 only once a readback has shown no point above)
        if (F[i].nTop === 0 && F[i].above > 0) zeroUp++;
      }
      W.keep = false;
      return { zeroAt: zeroAt, cross: W.cross, doneF: doneF, emptyF: emptyF, zeroUp: zeroUp, audits: W.audits, audit: W.audit.slice(),
        n: window.Hourglass.realSand.stats().n, state: window.Hourglass.timer.state, nTop: window.Hourglass.sim.nTop };
    });
    var late = run.cross !== null && run.zeroAt !== null ? run.cross - run.zeroAt : NaN;
    check(run.state === 'done' && run.nTop === 0, 'RUN: a 10 s glass runs to its end on the GPU sand', JSON.stringify({ state: run.state, nTop: run.nTop }));
    check(late >= -0.5 && late <= FRAME + 0.5, 'RUN: the last point crosses within one frame after 00:00.0 (the GPU\'s own substep)', (late === late ? late.toFixed(1) : late) + ' ms');
    check(run.n.transfers === r0.n.transfers && run.n.residues === r0.n.residues, 'RUN: no catch-up and no residue transfer: the neck kept the time',
          JSON.stringify({ transfers: run.n.transfers - r0.n.transfers, residues: run.n.residues - r0.n.residues }));
    check(run.emptyF !== null && run.emptyF - run.doneF <= 3 && run.zeroUp === 0, 'RUN: the count reads 0 within 3 frames of the end, and never while a point is above',
          JSON.stringify({ frames: run.emptyF - run.doneF, zeroWithAPointAbove: run.zeroUp }));
    check(run.audit.length === 0 && run.audits > 100, 'RUN: every readback agreed with the ledger: never fewer points above than the clock\'s target',
          run.audits + ' readbacks; ' + JSON.stringify(run.audit).slice(0, 400));
    // the owner's report says the same (stats().ends, what "Copy a report" carries for Gate B)
    var ends = await page.evaluate(function () { return window.Hourglass.realSand.stats().ends; });
    var le = ends && ends.lastPointMs.length ? ends.lastPointMs[ends.lastPointMs.length - 1] : null;
    check(!!le && le.from !== null && le.from >= -le.substep - 0.5 && le.to <= FRAME + 0.5 && late === late && late >= le.from - 0.5 && late <= le.to + 0.5,
          'RUN: the report gives the last point\'s crossing against 00:00.0, and it agrees with the GPU\'s substep record',
          JSON.stringify({ report: le, late: late === late ? +late.toFixed(1) : null }));
    check(!!ends && ends.belowTarget === 0 && ends.crossedShut === 0 && ends.auditFails === 0 && ends.audits > 100,
          'RUN: the report counts no run below its target, no crossing while shut and no failed audit',
          JSON.stringify({ runs: ends && ends.runs, belowTarget: ends && ends.belowTarget, crossedShut: ends && ends.crossedShut, audits: ends && ends.audits, auditFails: ends && ends.auditFails }));
    await frames(60);
    var e = await fresh();
    check(!!e.tally && e.tally.above === 0 && e.tally.points === e.pts && e.tally.nan === 0 && e.tally.outside === 0,
          'RUN: at the end no point is above the line, and every point is in the glass', JSON.stringify(e.tally));
    var lay = await page.evaluate(function () {
      var L = window.Hourglass.realSand._lay, w = L.words;
      return { tone1: w ? w.above1 + w.below1 : -1, debt: w ? w.debt : null, slack: L.plan.slackAt(L.known), laid: w ? w.laid : 0 };
    });
    check(r0.tone1 >= 0 && lay.laid > 1900 && Math.abs(lay.tone1 - r0.tone1) <= lay.slack && Math.abs(lay.debt) <= lay.slack,
          'RUN: layered sand: every grain that crossed was laid in the schedule\'s strata, and each tone kept its count within the slack',
          JSON.stringify({ before: r0.tone1, after: lay.tone1, debt: lay.debt, slack: lay.slack, laid: lay.laid }));

    /* ---- RESET ----------------------------------------------------------- */
    var rs0 = await page.evaluate(function () { window.Hourglass.reset(); return Date.now(); });
    await frames(12);
    await shot('4-reset-out');
    await frames(30);
    await shot('5-reset-in');
    await frames(120, sweeping);
    var rsMs = (await page.evaluate(function () { return Date.now(); })) - rs0;
    var rr = await fresh();
    check(rsMs >= 850 && rsMs <= 1300 + 2 * FRAME, 'RESET: the sweep (the old sand into the neck, the new poured in) lasts about a second', Math.round(rsMs) + ' ms');
    check(rr.total === rr.want && rr.nTop === rr.total && rr.tally && rr.tally.points === rr.pts && rr.tally.above === rr.pts && rr.audit && rr.audit.ok,
          'RESET: the new glass: its count, and the GPU filled with exactly its points, all above', JSON.stringify({ total: rr.total, nTop: rr.nTop, pts: rr.pts, tally: rr.tally }));

    /* ---- FLIP ------------------------------------------------------------ */
    await page.evaluate(function () { window.Hourglass.start(); });
    await frames(240);
    await page.evaluate(function () { var W = window.__watch; W.swaps = []; W.keep = true; W.frames = []; W.audit = []; window.Hourglass.flipNow(); });
    await frames(400, '!H.flip.active');
    var seq = await page.evaluate(function () { var rs = window.Hourglass.realSand; return rs.valve.last ? rs.valve.last.seq : 0; });
    // the count from the swap until the readback after the turn
    await frames(30, 'rs.audit() && rs.audit().seq > ' + seq);
    var fl = await page.evaluate(function () {
      var W = window.__watch, s = W.swaps[0], F = W.frames, back = 0, after = s ? s.total - s.top : 0;
      for (var i = 0; i < F.length; i++) if (s && F[i].f >= s.at && (F[i].nTop > after || (F[i].nTop === s.top && s.top !== after))) back++;
      W.keep = false;
      return { swap: s, back: back, audit: window.Hourglass.realSand.audit(), fails: W.audit.slice() };
    });
    var sw = fl.swap;
    check(!!sw && sw.rem !== undefined && Math.abs(sw.rem - sw.want) < 1e-6, 'FLIP: at the swap the time is remAt(total - nTop) of the count at the swap', JSON.stringify(sw));
    check(fl.back === 0 && fl.audit && fl.audit.ok && fl.fails.length === 0, 'FLIP: the count never goes back while the readback after the turn comes, and it agrees with the ledger',
          JSON.stringify({ back: fl.back, audit: fl.audit, fails: fl.fails }).slice(0, 400));
    await frames(120);
    await shot('3-layers-after-flip');

    /* ---- POUR, then a tilt swap with a pour ------------------------------ */
    await page.evaluate(function () {
      var W = window.__watch; W.pours = []; W.audit = []; W.swaps = [];
      document.getElementById('btn-sand').dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });
    await frames(30);
    await page.evaluate(function () { document.getElementById('btn-sand').dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })); });
    await frames(10);
    // real motion turns the glass over (as a phone turned over would): the swap comes while sand is poured
    await page.evaluate(function () {
      var H = window.Hourglass;
      H.grav.on = true; H.grav.target = Math.PI * 0.999;
      document.getElementById('btn-sand').dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });
    await frames(240, 'W.swaps.length > 0');
    await frames(4);
    await page.evaluate(function () { document.getElementById('btn-sand').dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })); });
    await shot('6-turned-by-motion');
    var pp = await fresh();
    var po = await page.evaluate(function () {
      var W = window.__watch, rs = window.Hourglass.realSand, made = 0;
      W.pours.forEach(function (p) { made += p.made; });
      return { pours: W.pours.length, made: made, bad: W.pours.filter(function (p) { return !p.ok; }).slice(0, 3), swap: W.swaps[0],
        points: rs.points, count: rs.solver.count + rs._xferPourPts, fails: W.audit.slice() };
    });
    check(po.pours > 10 && po.bad.length === 0, 'POUR: after every pour the time is remAt(topAt(rem) + made) to 1e-6', po.pours + ' pours, ' + po.made + ' grains; ' + JSON.stringify(po.bad));
    check(po.count === po.points && pp.tally && pp.tally.points === pp.points, 'POUR: every point poured is on the GPU (its count is the ledger\'s)',
          JSON.stringify({ gpu: po.count, ledger: po.points, tally: pp.tally && pp.tally.points }));
    check(!!po.swap && po.swap.rem !== undefined && Math.abs(po.swap.rem - po.swap.want) < 1e-6, 'POUR: the tilt swap with sand pouring: the time after it is remAt(total - nTop)', JSON.stringify(po.swap));
    check(po.fails.length === 0 && pp.audit && pp.audit.ok, 'POUR: no readback had fewer points above than the clock\'s target; the audit agrees',
          JSON.stringify(po.fails).slice(0, 300));
    await page.evaluate(function () { var H = window.Hourglass; H.grav.on = false; H.grav.target = 0; });

    /* ---- HIDDEN ---------------------------------------------------------- */
    await page.evaluate(function () { window.Hourglass.reset(); });
    await frames(150, sweeping);
    await page.evaluate(function () { window.Hourglass.start(); window.__watch.audit = []; });
    await frames(60);
    var h0 = await page.evaluate(function () {
      var V = window.__vt, n = window.Hourglass.realSand.stats().n;
      V.setHidden(true);
      V.advance(30000);
      return { transfers: n.transfers, residues: n.residues };
    });
    await page.evaluate(function () { window.__vt.setHidden(false); });
    await frames(60, 'rs.stats().n.transfers > ' + h0.transfers + ' && !rs._xfer');
    var h1 = await fresh();
    await frames(240, 'rs.nTop === 0');
    var h2 = await probe();
    check(h1.n.transfers - h0.transfers === 1, 'HIDDEN: back after 30 s hidden (the glass ended meanwhile): one transfer moves what is owed', (h1.n.transfers - h0.transfers) + ' transfers');
    check(h1.audit && h1.audit.ok && h1.tally && h1.tally.points === h1.pts, 'HIDDEN: after the transfer the GPU agrees with the ledger, every point kept', JSON.stringify({ audit: h1.audit, tally: h1.tally }));
    check(h2.state === 'done' && h2.nTop === 0, 'HIDDEN: and the glass empties', JSON.stringify({ state: h2.state, nTop: h2.nTop }));

    /* ---- LOSS ------------------------------------------------------------ */
    await page.evaluate(function () { window.Hourglass.reset(); });
    await frames(150, sweeping);
    await page.evaluate(function () { window.Hourglass.start(); });
    await frames(90);
    var lo = await page.evaluate(function () {
      var H = window.Hourglass, rs = H.realSand, d = rs.dev, rem = H.timer.rem, top = rs.nTop, total = rs.total;
      d.device.destroy();
      // (destroy() reports the reason 'destroyed', which is no loss; a reset graphics chip reports 'unknown')
      rs._deviceLost(d, { reason: 'unknown', message: 'test: the device was destroyed' });
      var cpu = H.sim, c = cpu.census();
      return { cpu: cpu !== rs, rem: H.timer.rem, rem0: rem, top: top, total: total, cTop: c.top, cTotal: c.total, nTop: cpu.nTop,
        real: document.getElementById('app').classList.contains('real') };
    });
    check(lo.cpu && !lo.real, 'LOSS: the CPU sand takes over in the same frame, its canvas shown', JSON.stringify({ cpu: lo.cpu, real: lo.real }));
    check(lo.rem === lo.rem0, 'LOSS: the clock is untouched', lo.rem0 + ' -> ' + lo.rem);
    check(lo.cTop === lo.top && lo.cTotal === lo.total && lo.nTop === lo.top, 'LOSS: the CPU sand holds the ledger\'s counts (census exact)',
          JSON.stringify({ ledger: [lo.top, lo.total], census: [lo.cTop, lo.cTotal] }));
    await frames(30);
    await page.waitForTimeout(600);
    await shot('7-cpu-after-loss');
    // the rebuild: after 2 s (virtual), a new device, its pipelines and the adoption (real time), then back
    await frames(150);
    for (var k = 0; k < 120 && (await page.evaluate(function () { var rs = window.Hourglass.realSand; return !!rs && !!rs._lostInfo; })); k++) {
      await frames(6);
      await page.waitForTimeout(1000);
    }
    await frames(60, 'H.sim === rs');
    var lb = await probe();
    var why = lb.live ? '' : await page.evaluate(function () {
      var r = JSON.parse(window.Hourglass.realSandReport()), rs = window.Hourglass.realSand;
      return JSON.stringify({ log: (r.log || []).slice(-6), lost: rs && rs._lostInfo, n: rs && rs.stats().n });
    });
    check(lb.live && lb.real && lb.note === 'On', 'LOSS: Real sand is rebuilt and takes the sand back', lb.note + (why ? '; ' + why.slice(0, 900) : ''));

    check(errors.length === 0, 'no page or console errors', errors.slice(0, 3).join(' | '));
  } catch (e) {
    check(false, 'no exception', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    if (browser) await browser.close();
    await new Promise(function (r) { server.close(function () { r(); }); setTimeout(r, 500); });
  }
  console.log('realsand-gpu: ' + (count - failures) + '/' + count + ' passed in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  if (failures) process.exitCode = 1;
})();
