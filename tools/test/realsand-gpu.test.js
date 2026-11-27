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
 *          takes over: the row on (data-state), the canvas drawn, the GPU's points the ledger's, the audit
 *          passes, the start-up times logged, the tone pass there;
 *  SOUND   before the start, the glass asleep: nothing of the bed is fed. Flicked along the glass
 *          (the classic Sim stepped in Node on the same motion beside it): it wakes, the bed
 *          lifts and lands, and one thump is fed, of the energy of the bed's fastest fall,
 *          u^2 / (2 G HB), within a factor of 2 of the classic sand's, as the bed comes to rest
 *          (within 6 frames of its fastest fall), its agitation within a factor of 2 too; at a slow
 *          pace (a run every 3 frames, 24 substeps) the same flick lands a thump within 1.5 dB of it; thrown,
 *          the bed flies and is not heard as sliding (the slides fed are well under its motion
 *          within itself, which was fed in full before); with the readbacks unheard the same
 *          flick feeds nothing (control). Shaken sideways at
 *          1.5 g and 5 Hz: no thump (as the classic), agitation and slides within a factor of 2
 *          of the classic sand's. Leaned 30 degrees: sound only as far as the sand moved (this
 *          small bed does not: silence). At rest again: nothing, and the glass sleeps;
 *  RUN     a 10 s glass to its end: the last point crosses within one frame after 00:00.0 (by
 *          the GPU's own record of its substep), no catch-up or residue transfer, the count 0
 *          within 3 frames of the end and never 0 while a point is above, every readback's
 *          audit passes (never fewer points above than the clock's target); left alone from
 *          Start to the end, the bed feeds no thump or slam and next to no agitation, and the
 *          few crowded points under the neck (the plug of the stream) are never heard as a bed
 *          (taken for one, each bed's points counted a hundredfold, the same readbacks' plug is
 *          heard as a bed: the control);
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
 *  LIT     the sunlit sand (Tune's Light), on the engine's own canvas. Sunlit: the sand's side toward
 *          the screen's left is the brighter by a set margin, in both looks; the control, on the
 *          same grains: the sides' ratio over the base's canvas's (the same frame, the same pixels,
 *          no light of the engine's: the bed's shape cancels) is 1 under Soft and at least the
 *          margin under Sunlit. Soft is the picture of before: the grain renderer of the
 *          base (LIT_BASE, its grains.mjs and grains.wgsl taken from git) draws the same points
 *          with the same look in the same commands on a canvas of its own, and the two canvases
 *          are equal byte for byte at rest, with the stream running, at every sampled frame of a
 *          turn, and after it; under Sunlit they differ (the control). After that turn (the
 *          engine's points now lie turned end for end) a new glass is lit from the screen's left
 *          as before. Through a second full turn, under Sunlit, the key the grains are drawn with,
 *          as the screen shows the canvas, stays the room's (KEY_LIGHT) in every frame, the
 *          swap's too, and while the glass leans on its way over the lit side is the screen's
 *          left; the key turned back by the rotor's CSS angle as it stood when the frame was
 *          drawn, the rule the bead's light of before goes by, is a frame behind the turn (the
 *          control). (Once turned over the bed lies to one side of the glass, all of it on the
 *          lit side or the shaded one: no flanks to compare, so the new glass is.)
 *  SHAPES  each glass shape Tune offers, the page loaded in it (release 1.15.0): a 60-minute glass
 *          filled to its cap (the clock's full glass for that shape) with exactly the ledger's
 *          points on the GPU, none outside, the GPU's glass the shape's own; then a 10 s glass
 *          (a Reset) run to its end, its last point crossing within one frame after 00:00.0,
 *          and every readback agreeing with the ledger. With --shots, each shape mid-run
 *          (shape-<n>-<id>.png), for the contact sheet;
 *  and no page or console errors.
 *
 * With --shots <dir> it saves pictures of the app with Real sand on: at rest, the stream, the
 * layers after a Flip, the Reset's two halves, the glass turned over by real motion, the CPU
 * sand after the loss. It runs only when named (run-all.js realsand-gpu): the whole suite took
 * about 47 minutes with seven shapes on a four-core machine shared with other jobs (SHAPES
 * takes about 5 minutes more for each shape Tune offers); never two SwiftShader
 * browsers at once.
 *
 * --only <case>[,<case>...] runs those cases alone (the names above, any letter case; they run
 * in the order the log prints them: BOOT, SOUND, RUN, RESET, FLIP, POUR, HIDDEN, LOSS, LIT, SHAPES,
 * whatever the order named), and the last line names them, so the run is never read as the
 * whole suite; a name that is not a case is an error that lists the cases. The page is always
 * loaded and the engine started (BOOT's checks only when BOOT is named), and a case sets up
 * what it needs from the one before it: FLIP without RESET starts from a new glass (a Reset,
 * unless the glass is new already), POUR without FLIP from a new glass started and turned over
 * at 4 s, as FLIP leaves it. RESET is the shortest case: about 20 seconds with the engine's start.
 * --shapes <id>[,<id>...] runs SHAPES in those shapes instead of every shape Tune offers
 * (glass/shapes.js SHAPE_ORDER's ids, any order); one Tune holds back is offered on the test's page,
 * since the settings take only offered shapes. The last line names them too. SHAPES takes
 * about 5 minutes a shape (one shape, engine start included: 278 s).
 *   node tools/test/realsand-gpu.test.js [--port 8908] [--shots dir] [--only reset,flip] [--shapes trumpet,florence]
 */
'use strict';
var playwright = require('playwright');
var staticServer = require('./lib/static-server.js');
var path = require('path');
var fs = require('fs');
var ROOT = require('./lib/paths.js').ROOT;
var port = +process.env.PORT || 8908, shots = null, onlyArg = null, shapesArg = null;
for (var i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--port') port = +process.argv[++i];
  else if (process.argv[i] === '--shots') shots = process.argv[++i];
  else if (process.argv[i] === '--only') onlyArg = process.argv[++i] || '';
  else if (process.argv[i] === '--shapes') shapesArg = process.argv[++i] || '';
}
// the cases, in the order they run (whatever the order --only names them in)
var CASES = ['BOOT', 'SOUND', 'RUN', 'RESET', 'FLIP', 'POUR', 'HIDDEN', 'LOSS', 'LIT', 'SHAPES'];
// LIT: the commit whose grain renderer draws "the picture of before" (HOURGLASS_SOFT_BASE names another; render-unit's too)
var LIT_BASE = process.env.HOURGLASS_SOFT_BASE || '19c84db';
var ONLY = null;
if (onlyArg !== null) {
  ONLY = onlyArg.split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
  var badCase = ONLY.filter(function (c) { return CASES.indexOf(c) < 0; });
  if (!ONLY.length || badCase.length) {
    console.error('realsand-gpu: --only ' + (badCase.length ? 'names no case "' + badCase.join('", "') + '"' : 'names no case') + '; the cases are ' + CASES.join(', '));
    process.exit(2);
  }
  ONLY = CASES.filter(function (c) { return ONLY.indexOf(c) >= 0; });
}
function doCase(c) { return !ONLY || ONLY.indexOf(c) >= 0; }
// --shapes: the shapes SHAPES runs in (default: every shape Tune offers); one held back is offered for the test
var SHAPE_LIST = null, SHAPE_HELD = [];
if (shapesArg !== null) {
  var PH = require('./lib/load-physics.js').P;
  SHAPE_LIST = shapesArg.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var badShape = SHAPE_LIST.filter(function (s) { return PH.SHAPE_ORDER.indexOf(s) < 0; });
  if (!SHAPE_LIST.length || badShape.length) {
    console.error('realsand-gpu: --shapes ' + (badShape.length ? 'names no shape "' + badShape.join('", "') + '"' : 'names no shape') + '; the shapes are ' + PH.SHAPE_ORDER.join(', '));
    process.exit(2);
  }
  SHAPE_LIST = PH.SHAPE_ORDER.filter(function (s) { return SHAPE_LIST.indexOf(s) >= 0; });
  SHAPE_HELD = SHAPE_LIST.filter(function (s) { return !PH.SHAPES[s].offered; });
  if (!doCase('SHAPES')) {
    console.error('realsand-gpu: --shapes is for the SHAPES case, which --only leaves out');
    process.exit(2);
  }
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
    V.advance(V.frameMs || 1000 / 60);
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
    // RUN's control: the same readbacks heard with each bed's points counted a hundredfold, so that the few
    // crowded points under the neck are taken for a bed (W.plug.m: the engine's own rules on a record of its own).
    // few: the readbacks in which the lower bulb's crowded points were fewer than 40; early, ctl: those of them
    // in which the engine, and the control, heard them as a bed (_snd.prev: the bed heard at the last readback)
    var P = W.plug;
    if (P && t.beds && w.snd) {
      P.m._snd.muteUntil = this._snd.muteUntil;
      P.m._hear(w, { above: t.above, below: t.below, beds: t.beds.map(function (b) { return { n: b.n * 100, vx: b.vx, vy: b.vy, x: b.x, sliding: b.sliding * 100, slide: b.slide * 100 }; }) },
        parity === undefined ? this.valve.parity : parity);
      var lo = t.beds[1];
      if (lo.n > 0 && lo.n < 40) {
        P.few++;
        if (this._snd.prev[1]) P.early++;
        if (P.m._snd.prev[1]) P.ctl++;
        P.fast = Math.max(P.fast, Math.hypot(lo.vx, lo.vy));
      }
      if (P.m._snd.fall[1]) P.armed++;
      P.thumps = P.m._snd.n.thumps + P.m._snd.n.slams;
      P.agit = Math.max(P.agit, P.m.agit[0], P.m.agit[1]);
    }
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
    var fr = H.sim.frame;
    if (W.keep) W.frames.push({ f: V.frames, now: Date.now(), rem: T.rem, state: T.state, nTop: H.sim.nTop, above: t ? t.above : -1,
      th: fr.thump[0] + fr.thump[2] + fr.slam[0], agit: H.sim.agitation() });
  };
}


/**
 * LIT, in the page: the base's grain renderer (its module and shader, given as text) beside the engine's own, on a
 * canvas of its own, drawing the same points with the same look in the same commands; and what each drawn frame's
 * key is on the screen. window.__lit: same() compares the two canvases, flanks() measures the engine's.
 */
async function installLit(a) {
  var H = window.Hourglass, rs = H.realSand, g = rs.grains, V = window.__vt, K0 = window.HourglassPhysics.KEY_LIGHT;
  var url = URL.createObjectURL(new Blob([a.mjs], { type: 'text/javascript' }));
  var mod = await import(url);
  var c0 = document.createElement('canvas');
  c0.width = rs.canvas.width; c0.height = rs.canvas.height;
  var g0 = new mod.GrainRenderer(rs.device, c0, { offscreen: true });
  await g0.init({ module: function (device) { return Promise.resolve(device.createShaderModule({ code: a.wgsl })); } });
  g0.bind(rs.solver.buffers.particles);
  g0.setWarp(rs.glass.warp, rs.glass.cx, rs.glass.cy);
  var L = window.__lit = { draws: 0, pair: 0, look: null, track: null, g0: g0 };
  var setPal = g.setPalette.bind(g);
  g.setPalette = function (p) { setPal(p); g0.setPalette(p); };
  rs.setPalette();
  var enc = g.encode.bind(g), pres = g.present.bind(g);
  g.encode = function (e, n, look) {
    var both = !g.copyPending && !g0.copyPending;
    enc(e, n, look); g0.encode(e, n, look);
    L.draws++; L.look = look;
    if (both) L.pair = L.draws;             // (this frame's picture reaches both canvases)
  };
  g.present = function () { return Promise.all([pres(), g0.present()]); };
  /** Until both canvases hold what was last drawn. */
  L.settle = async function () {
    for (var k = 0; k < 400 && (g.copyPending || g0.copyPending || g.copyQueued || g0.copyQueued); k++) await V.realSleep(5);
  };
  /** One frame whose picture both canvases hold (asleep, the glass is drawn again for it). */
  L.frame = async function () {
    await L.settle();
    var d = L.draws;
    if (rs.stats().mode === 'asleep') rs._redraw = true;
    await V.frame();
    await L.settle();
    return L.draws > d && L.pair === L.draws;
  };
  /** The two canvases, pixel for pixel: how many differ, of how many drawn. */
  L.same = function () {
    var w = rs.canvas.width, h = rs.canvas.height;
    var p = rs.canvas.getContext('2d').getImageData(0, 0, w, h).data, q = c0.getContext('2d').getImageData(0, 0, w, h).data, n = 0, drawn = 0;
    for (var i = 0; i < p.length; i += 4) {
      if (p[i + 3] || q[i + 3]) drawn++;
      if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2] || p[i + 3] !== q[i + 3]) n++;
    }
    return { differ: n, drawn: drawn };
  };
  /** How the screen shows the canvas: the rotor's turn, and half a turn more while it holds a picture from before a swap (rad, clockwise). */
  L.shown = function () { return rs._rotorAngle() + (rs._cssTurned ? Math.PI : 0); };
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  /**
   * The sand on the engine's canvas, left and right of its own middle as the screen shows it: the mean relative
   * luminance of each side (a twentieth of the canvas's width clear of the middle), and their ratio. And the same
   * pixels on the base's canvas, which drew the very same grains in the very same frame without any light of the
   * engine's: their ratio there (base), and the engine's ratio over it (rel). How the bed happens to settle (more
   * of a deeper layer on one side, a steeper flank) is in both canvases alike and cancels in rel: rel is the
   * light's own share, 1 for a sand that no light of the engine's touches.
   */
  L.flanks = function () {
    var w = rs.canvas.width, h = rs.canvas.height, d = rs.canvas.getContext('2d').getImageData(0, 0, w, h).data;
    var e = c0.getContext('2d').getImageData(0, 0, w, h).data;
    var th = L.shown(), c = Math.cos(th), sn = Math.sin(th), x, y, i, n = 0, mx = 0, xs;
    for (y = 0; y < h; y += 2) for (x = 0; x < w; x += 2) { i = (y * w + x) * 4; if (d[i + 3] < 200) continue; n++; mx += (x - w / 2) * c - (y - h / 2) * sn; }
    if (!n) return { n: 0, ratio: NaN, base: NaN, rel: NaN };
    mx /= n;
    var S = [0, 0, 0, 0], B = [0, 0, 0, 0], gap = w / 20;
    for (y = 0; y < h; y += 2) for (x = 0; x < w; x += 2) {
      i = (y * w + x) * 4;
      if (d[i + 3] < 200) continue;
      xs = (x - w / 2) * c - (y - h / 2) * sn - mx;
      var k = xs < -gap ? 0 : (xs > gap ? 2 : -1);
      if (k < 0) continue;
      S[k] += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); S[k + 1]++;
      if (e[i + 3] < 200) continue;                         // (the base's own sums: the pixels both canvases hold)
      B[k] += 0.2126 * lin(e[i]) + 0.7152 * lin(e[i + 1]) + 0.0722 * lin(e[i + 2]); B[k + 1]++;
    }
    var ratio = (S[0] / S[1]) / (S[2] / S[3]), base = (B[0] / B[1]) / (B[2] / B[3]);
    return { n: n, left: S[0] / S[1], right: S[2] / S[3], ratio: ratio, base: base, rel: ratio / base, theta: th };
  };
  /**
   * A drawn frame's key as the screen shows it (the canvas's axes turned by the shown angle): how far from the
   * room's key (KEY_LIGHT) the key the grains were lit with lies, and the key turned back by the rotor's CSS
   * angle as it was when the frame was drawn (look.light: the rule the bead's light of before goes by).
   */
  L.keyOff = function () {
    var look = L.look, th = L.shown(), c = Math.cos(th), sn = Math.sin(th);
    function off(kx, ky) { var sx = c * kx + sn * ky, sy = -sn * kx + c * ky; return Math.hypot(sx - K0[0], sy - K0[1]); }
    var a = look.light, ca = Math.cos(a), sa = Math.sin(a);
    return { lit: look.lit ? off(look.lit.key[0], look.lit.key[1]) : null, old: off(ca * K0[0] - sa * K0[1], sa * K0[0] + ca * K0[1]),
      theta: th, parity: rs.valve.parity, fresh: !!(look.lit && look.lit.fresh) };
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
    if (SHAPE_HELD.length) {
      // --shapes named a shape Tune holds back (the settings take only offered ones): offered on this page, for the test.
      // (The first piece makes the namespace empty and fills it in, so the script waits on it for the registry itself.)
      await ctx.addInitScript(function (ids) {
        var v;
        function mark(S) { ids.forEach(function (id) { if (S && S[id]) S[id].offered = true; }); }
        Object.defineProperty(window, 'HourglassPhysics', { configurable: true, enumerable: true, get: function () { return v; },
          set: function (P) {
            v = P;
            if (!P) return;
            if (P.SHAPES) { mark(P.SHAPES); return; }
            var s;
            Object.defineProperty(P, 'SHAPES', { configurable: true, enumerable: true, get: function () { return s; }, set: function (S) { s = S; mark(S); } });
          } });
      }, SHAPE_HELD);
    }
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
        return { live: !!rs && H.sim === rs, note: document.getElementById('realsand-note').textContent,
          rstate: document.getElementById('realsand-row').getAttribute('data-state'), state: H.timer.state,
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
    /** For a case run without the one before it (--only): a new glass, idle and full, as Reset makes it, unless it is one. */
    async function newGlass() {
      var ok = await page.evaluate(function () {
        var H = window.Hourglass;
        return H.timer.state === 'idle' && H.sim.nTop === H.sim.total && !H.flip.active && !document.getElementById('app').classList.contains('sweep');
      });
      if (ok) return;
      await page.evaluate(function () { window.Hourglass.reset(); });
      await frames(150, sweeping);
      await frames(30);
    }

    /* ---- BOOT ------------------------------------------------------------ */
    await page.waitForFunction(function () {
      var H = window.Hourglass;
      return !!H && ((!!H.realSand && H.sim === H.realSand) || /Could not|Needs|Did not|updating/.test(document.getElementById('realsand-note').textContent));
    }, null, { timeout: 180000, polling: 200 });
    await page.evaluate(function () { window.__vt.freeze(); });
    await page.evaluate(installWatch);
    if (doCase('BOOT')) {
    var b = await fresh();
    check(b.live && b.rstate === 'on' && /^On/.test(b.note) && b.real, 'BOOT: the engine starts on WebGPU, adopts the CPU sand and takes over (Hourglass.sim is it, the row on, "On")', b.rstate + ': ' + b.note);
    check(b.px > 100, 'BOOT: its canvas holds the drawn sand', b.px + ' sampled pixels drawn');
    check(!!b.tally && b.tally.points === b.points && b.points === b.pts && b.gpuCount === b.pts && b.tally.nan === 0 && b.tally.outside === 0 && b.total === b.want,
          'BOOT: the GPU holds exactly the ledger\'s points for the glass, none lost or outside', JSON.stringify({ tally: b.tally, points: b.points, total: b.total }));
    check(!!b.audit && b.audit.ok, 'BOOT: the newest readback agrees with the ledger (audit)', JSON.stringify(b.audit));
    check(b.times && b.times.pipelines > 0 && b.times.selfTest > 0 && b.times.firstFrame > 0,
          'BOOT: the start-up times are logged (device, pipelines, self-test, first frame)', JSON.stringify(b.times));
    check(b.layers && b.layers.on && b.layers.toner, 'BOOT: layered sand runs on the GPU (the tone pass)', JSON.stringify(b.layers));
    await shot('1-rest');
    }

    /* ---- SOUND ----------------------------------------------------------- */
    if (doCase('SOUND')) {
    // the motions, as motion.sample gives them to the frame's steps (g, the page's frame: y down), by ms
    var MOVES = {
      // a flick of the wrist along the glass, as motion.js reports it step by step (2 g for 60 ms and the
      // stop, 1.4 g for 90 ms: the phone's own acceleration, played through the real motion.js)
      flick: { ms: 3000, at: function (u) {
        var Y = [0.073, 0.194, 0.660, 1.358, 1.695, 1.794, 1.489, 0.915, 0.362, -0.176, -0.590, -0.922, -1.140, -1.283, -1.284, -1.190, -0.981, -0.696, -0.407, -0.116];
        var k = Math.round(u * 0.12) - 1;
        return [0, k >= 0 && k < Y.length ? Y[k] : 0];
      } },
      // shaken from side to side at 1.5 g, 5 Hz, for 1.5 s
      shake: { ms: 4500, at: function (u) { return u < 0 || u > 1500 ? [0, 0] : [1.5 * Math.sin(2 * Math.PI * 5 * u / 1000), 0]; } },
      // leaned to 30 degrees over a second, held a second, and back (no push: the heading alone)
      lean: { ms: 5000, at: function () { return [0, 0]; }, heading: function (u) { var A = Math.PI / 6; return u < 0 ? 0 : u < 1000 ? A * u / 1000 : u < 2000 ? A : u < 3000 ? A * (3000 - u) / 1000 : 0; } }
    };
    /** The classic Sim on a motion, stepped as app.js's frame steps it: what it feeds the sound, frame by frame. */
    function classicOn(move, grains) {
      var P = require('./lib/load-physics.js').P, sim = new P.Sim({ scale: 1.08, seed: 11 }), G = sim.G, k;
      sim.setMotion(0, 0, 0, 0, 0, 0); sim.reset(grains);
      sim.gateOpen = false; sim.targetTop = sim.nTop; sim.quality = 2;
      for (k = 0; k < 600; k++) { sim.beginFrame(); sim.step(); }
      var out = { thumps: 0, thumpE: 0, slams: 0, agit: 0, slides: 0, rate: 0 }, S = 0, n = Math.round(move.ms * 60 / 1000);
      for (var fr = 0; fr < n; fr++) {
        var want = move.heading ? move.heading(fr * FRAME) : 0, aw = Math.abs(want);
        if (aw < 0.03) want = 0; else if (aw < 0.09) want = (want < 0 ? -1.5 : 1.5) * (aw - 0.03);
        var d = want - sim.tilt;
        if (Math.abs(d) > 0.0008) { sim.tilt += d * (1 - Math.exp(-FRAME / 100)); sim.wakeAll(); } else if (d !== 0) { sim.tilt = want; sim.wakeAll(); }
        sim.beginFrame();
        for (k = 0; k < 2; k++) {
          var a = move.at(fr * FRAME + (k + 1) * FRAME / 2);
          sim.setMotion(G * a[0], G * a[1], 0, 0, 0.09, 0);
          sim.step();
        }
        var f = sim.frame, th = f.thump[0] + f.thump[2];
        if (th > 0.0015) { out.thumps++; out.thumpE += th; }
        if (f.slam[0] > 0.0015) out.slams++;
        out.agit = Math.max(out.agit, sim.agitation());
        out.slides += f.slides;
        S += (f.slides * 60 - S) * (10 / 60);                      // (app.js feedAudio's smoothing)
        out.rate = Math.max(out.rate, S);
      }
      return out;
    }
    /** The app's own motion object made to answer from MOVES[name] (null: its own again); Real motion on while it does. */
    function setMove(name) {
      return page.evaluate(function (a) {
        var H = window.Hourglass, mo = H.motion, V = window.__vt, W = window.__watch;
        var keys = ['seenMotion', 'seenOrient', 'live', 'armed', 'heading', 'sample', 'takeSwings'];
        // (its own members back as they were: motion.js keeps heading, live and the rest as plain fields)
        if (W.moWas) keys.forEach(function (k) { if (W.moWas[k]) Object.defineProperty(mo, k, W.moWas[k]); else delete mo[k]; });
        W.moWas = null;
        H.grav.on = false; H.grav.target = 0;
        W.snd = null;
        if (!a.name) return;
        W.moWas = {};
        keys.forEach(function (k) { W.moWas[k] = Object.getOwnPropertyDescriptor(mo, k) || null; });
        var at = new Function('u', 'return (' + a.at + ')(u);'), heading = a.heading ? new Function('u', 'return (' + a.heading + ')(u);') : null, t0 = V.now;
        ['seenMotion', 'seenOrient', 'live'].forEach(function (k) { Object.defineProperty(mo, k, { configurable: true, get: function () { return true; } }); });
        Object.defineProperty(mo, 'armed', { configurable: true, get: function () { return false; } });
        Object.defineProperty(mo, 'heading', { configurable: true, get: function () { return heading ? heading(V.now - t0) : 0; } });
        mo.takeSwings = function () { return 0; };
        mo.sample = function (tMs, o) { o = o || {}; var q = at(tMs - t0); o.x = q[0]; o.y = q[1]; o.z = 0; o.w = 0; o.wf = 0; o.rms = 0; o.armed = false; o.live = true; return o; };
        H.grav.on = true;
        // the record: each frame's feeds as app.js reads them, and each readback's upper bed
        W.snd = { f0: V.frames, frames: [], beds: [] };
      }, { name: name, at: name ? String(MOVES[name].at) : null, heading: name && MOVES[name].heading ? String(MOVES[name].heading) : null });
    }
    /**
     * Play a move for its length, then on until the glass sleeps; what was fed, as classicOn counts it.
     * every: display frames a run takes (default 1): the page's frames that long while the move plays
     * and the glass settles, so that each run, and each readback, covers that many frames' substeps.
     * (A display that slow has been so before the move: the frames the sleeping glass's engine last
     * timed are put that far apart, as a phone's would be, so that its runs hold that many frames'
     * substeps from the move's first frame, not only once a second of slow frames has gone by.)
     */
    async function play(name, every) {
      every = every || 1;
      await frames(600, "rs.stats().mode === 'asleep' && rs.stats().inflight === 0");
      await page.evaluate(function (k) {
        var V = window.__vt, rs = window.Hourglass.realSand, ms = k * 1000 / 60;
        V.frameMs = ms;
        if (k > 1) { var L = []; for (var i = 60; i >= 0; i--) L.push(V.now - i * ms); rs._rafLog = L; }
      }, every);
      await setMove(name);
      await frames(Math.round(MOVES[name].ms * 60 / 1000 / every));
      await frames(400, "rs.stats().mode === 'asleep' && rs.stats().inflight === 0");
      await page.evaluate(function () { window.__vt.frameMs = 0; });
      await frames(30);
      var r = await page.evaluate(function () {
        var W = window.__watch, R = W.snd, F = R.frames, o = { thumps: [], slams: 0, agit: 0, slides: 0, rate: 0, woke: null, first: null, last: null, tail: 0, asleep: F.length ? F[F.length - 1].mode === 'asleep' : false, n: F.length };
        var S = 0;
        F.forEach(function (x, k) {
          if (x.th0 + x.th1 > 0.0015) o.thumps.push({ f: x.f, E: x.th0 + x.th1, upper: x.th0 > 0 });
          if (x.slam > 0.0015) o.slams++;
          if (x.agit > o.agit) o.agit = x.agit;
          o.slides += x.slides;
          S += (x.slides * 60 - S) * (10 / 60);
          if (S > o.rate) o.rate = S;
          if (o.woke === null && x.mode !== 'asleep') o.woke = x.f;
          var any = x.th0 + x.th1 + x.slam + x.slides + x.agit > 0;
          if (any) { if (o.first === null) o.first = x.f; o.last = x.f; }
          if (k >= F.length - 30 && (any || x.active)) o.tail++;
        });
        // the upper bed's fastest fall (grid y up: the most negative vy), and the first readback in which it moves
        var fall = null, seen = null;
        R.beds.forEach(function (b) { if (seen === null && b.sliding > 0.01 * b.n) seen = b.f; if (!fall || b.vy < fall.vy) fall = b; });
        o.fall = fall; o.seen = seen;
        // the substeps of the runs read back while the bed moved (their fewest)
        o.steps = null;
        R.beds.forEach(function (b) { if (seen !== null && b.f >= seen && b.f <= (fall ? fall.f + 6 : seen) && (o.steps === null || b.steps < o.steps)) o.steps = b.steps; });
        // the bed's motion within itself, counted in full whether it flies or not, as slides a second at
        // their fastest (app-sand.mjs _hear's measure without its "a thrown bed flies": 16 over the square
        // root of the bed's grains, 1.69 points a grain, of its moving points' speed beyond its own)
        var rs = window.Hourglass.realSand, S2 = 0;
        o.within = 0;
        R.beds.forEach(function (b) {
          var sp = Math.hypot(b.vx, b.vy), still = 0.02 * Math.sqrt(2 * Math.max(b.am, 1) * rs.glass.H);
          var x = b.sliding > 3 ? 16 * Math.max(0, b.slide - b.sliding * Math.max(sp, still)) / Math.sqrt(Math.max(256, b.n / 1.69)) / (rs.s * rs.ppg) : 0;
          S2 += (x - S2) * (10 / 60);
          if (S2 > o.within) o.within = S2;
        });
        return o;
      });
      await setMove(null);
      return r;
    }
    await page.evaluate(function () {
      // (the watch keeps the SOUND case's record while W.snd is set)
      var H = window.Hourglass, rs = H.realSand, V = window.__vt, W = window.__watch, after = V.after, onTally = rs._onTally;
      V.after = function () {
        after();
        if (!W.snd) return;
        var f = H.sim.frame;
        W.snd.frames.push({ f: V.frames - W.snd.f0, th0: f.thump[0], th1: f.thump[2], slam: f.slam[0], slides: f.slides, agit: H.sim.agitation(), mode: rs.stats().mode, active: H.sim.isActive() });
      };
      rs._onTally = function (w, t, tSim, parity) {
        onTally.call(this, w, t, tSim, parity);
        if (W.snd && t.beds && w.snd) W.snd.beds.push({ f: V.frames - W.snd.f0, n: t.beds[0].n, vx: t.beds[0].vx, vy: t.beds[0].vy, sliding: t.beds[0].sliding, slide: t.beds[0].slide,
          am: Math.hypot(w.snd.ax, w.snd.ay), steps: w.snd.n });
      };
    });
    var sInfo = await page.evaluate(function () { var H = window.Hourglass, rs = H.realSand; return { GH: rs.Gg * rs.glass.HBc, total: H.sim.total }; });
    // at rest, asleep, before the start: nothing
    await frames(600, "rs.stats().mode === 'asleep' && rs.stats().inflight === 0");
    await page.evaluate(function () { var W = window.__watch; W.snd = { f0: window.__vt.frames, frames: [], beds: [] }; });
    await frames(30);
    var rest = await page.evaluate(function () {
      var W = window.__watch, F = W.snd.frames, any = 0;
      F.forEach(function (x) { if (x.th0 + x.th1 + x.slam + x.slides + x.agit > 0 || x.active || x.mode !== 'asleep') any++; });
      W.snd = null;
      return { n: F.length, any: any, state: window.Hourglass.timer.state };
    });
    check(rest.state === 'idle' && rest.n === 30 && rest.any === 0, 'SOUND: before the start, the glass at rest and asleep: nothing of the bed is fed, and the sand is not active', JSON.stringify(rest));
    // flicked along the glass
    var cF = classicOn(MOVES.flick, sInfo.total), gF = await play('flick');
    // (the landing: the largest thump; pressed down first, a bed may give a much smaller one before it)
    var uF = gF.fall ? -gF.fall.vy : 0, Eu = uF * uF / (2 * sInfo.GH), tF = gF.thumps.slice().sort(function (a, b) { return b.E - a.E; })[0];
    var lvl = tF ? Math.sqrt(tF.E / cF.thumpE) : 0;
    check(gF.woke !== null && gF.woke <= 2 && gF.seen !== null && gF.first !== null && gF.first - gF.seen <= 3,
          'SOUND: a flick wakes the sleeping glass at once, and the bed is heard within 3 frames of the first readback in which it moves',
          JSON.stringify({ awakeInFrame: gF.woke, bedMovesInReadbackOfFrame: gF.seen, firstFedInFrame: gF.first }));
    check(gF.thumps.length >= 1 && gF.thumps.length <= 2 && !!tF && tF.upper && gF.slams === 0 && cF.thumps === 1 && cF.slams === 0 && lvl >= 0.5 && lvl <= 2,
          'SOUND: the bed lifts and lands: a thump in the upper bulb, no slam, as loud as the classic sand\'s for the same flick within a factor of 2 (the level audio.thump plays, 1.3 sqrt(E))',
          JSON.stringify({ gpu: gF.thumps.map(function (t) { return +t.E.toFixed(4); }), classic: +cF.thumpE.toFixed(4), level: +lvl.toFixed(2) }));
    check(!!tF && uF > 30 && Math.abs(tF.E / Eu - 1) <= 0.15 && tF.f - gF.fall.f >= 1 && tF.f - gF.fall.f <= 6,
          'SOUND: the thump is the energy of the bed\'s fastest fall, u^2 / (2 G HB), fed as the bed comes to rest: within 6 frames of the readback of that fall',
          JSON.stringify({ fastestFall: +uF.toFixed(1), E: tF ? +tF.E.toFixed(4) : null, fromFall: +Eu.toFixed(4), framesAfter: tF ? tF.f - gF.fall.f : null }));
    check(gF.agit / cF.agit >= 0.5 && gF.agit / cF.agit <= 2 && gF.asleep && gF.tail === 0,
          'SOUND: its agitation is within a factor of 2 of the classic sand\'s, and once the bed rests nothing is fed and the glass sleeps',
          JSON.stringify({ gpu: +gF.agit.toFixed(2), classic: +cF.agit.toFixed(2), fedInTheLast30Frames: gF.tail, asleep: gF.asleep }));
    check(gF.within > 1000 && gF.rate <= 0.6 * gF.within,
          'SOUND: thrown, the bed flies and is not heard as sliding (the classic sand\'s bed in the air slides nothing): the slides fed through the flick, at their fastest, are well under the bed\'s motion within itself, which was fed in full before (control)',
          JSON.stringify({ fedPerSecond: Math.round(gF.rate), motionWithinPerSecond: Math.round(gF.within), classicPerSecond: Math.round(cF.rate) }));
    // a slow pace (build 8): a run every 3 display frames, 24 substeps (the cap), as a busy GPU gives. The
    // fall and its landing can lie inside one run; the engine's fastest fall between readbacks (bed.peak)
    // gives the thump: the same flick lands one thump within 1.5 dB of the one at a run a frame, no slam
    var gP = await play('flick', 3), tP = gP.thumps.slice().sort(function (a, b) { return b.E - a.E; })[0];
    var dBP = tP && tF ? 10 * Math.log10(tP.E / tF.E) : null;
    check(gP.thumps.length >= 1 && gP.thumps.length <= 2 && !!tP && tP.upper && gP.slams === 0 && dBP !== null && Math.abs(dBP) <= 1.5 && gP.asleep && gP.tail === 0 && gP.steps >= 20,
          'SOUND: at a slow pace (a run every 3 frames, 24 substeps) the same flick lands a thump in the upper bulb, no slam, within 1.5 dB of the thump at a run a frame',
          JSON.stringify({ slow: gP.thumps.map(function (t) { return +t.E.toFixed(4); }), aFrame: tF ? +tF.E.toFixed(4) : null, dB: dBP === null ? null : +dBP.toFixed(2), fastestFallSeen: gP.fall ? +(-gP.fall.vy).toFixed(1) : null, fewestSubstepsARun: gP.steps }));
    // (logged, not checked: the same slow pace hearing the readbacks alone, as before build 8)
    await page.evaluate(function () { var rs = window.Hourglass.realSand; rs.__hear = rs._hear; rs._hear = function (w, t, p) { if (t && t.beds) t.beds.forEach(function (b) { b.peak = null; }); return rs.__hear.call(this, w, t, p); }; });
    var gPc = await play('flick', 3);
    await page.evaluate(function () { var rs = window.Hourglass.realSand; rs._hear = rs.__hear; delete rs.__hear; });
    console.log('      (slow pace from the readbacks alone, as before build 8: thumps ' + JSON.stringify(gPc.thumps.map(function (t) { return +t.E.toFixed(4); })) + ', the fastest fall a readback saw ' + (gPc.fall ? (-gPc.fall.vy).toFixed(1) : '-') + ' cells/s, runs of ' + gPc.steps + ' substeps at fewest)');
    // control: the same flick with the readbacks unheard feeds nothing
    await page.evaluate(function () { var rs = window.Hourglass.realSand; rs.__hear = rs._hear; rs._hear = function () {}; });
    var gC = await play('flick');
    await page.evaluate(function () { var rs = window.Hourglass.realSand; rs._hear = rs.__hear; delete rs.__hear; });
    check(gC.thumps.length === 0 && gC.agit === 0 && gC.slides === 0 && gC.fall && -gC.fall.vy > 30,
          'SOUND: ... and with the readbacks unheard (control: the engine as it was) the same flick, the bed falling as fast, feeds nothing',
          JSON.stringify({ thumps: gC.thumps.length, agit: gC.agit, slides: gC.slides, fastestFall: gC.fall ? +(-gC.fall.vy).toFixed(1) : null }));
    // shaken from side to side
    var cS = classicOn(MOVES.shake, sInfo.total), gS = await play('shake');
    check(gS.thumps.length === 0 && cS.thumps === 0 && gS.slams === 0 && gS.agit / cS.agit >= 0.5 && gS.agit / cS.agit <= 2 && gS.asleep && gS.tail === 0,
          'SOUND: shaken sideways at 1.5 g, 5 Hz: no thump (as the classic sand), the agitation within a factor of 2 of the classic\'s; nothing once at rest',
          JSON.stringify({ gpu: +gS.agit.toFixed(2), classic: +cS.agit.toFixed(2), thumps: gS.thumps.length, slams: gS.slams }));
    check(gS.slides / cS.slides >= 0.5 && gS.slides / cS.slides <= 2 && gS.rate / cS.rate >= 0.5 && gS.rate / cS.rate <= 2,
          'SOUND: ... and its slides, in all and at their fastest, within a factor of 2 of the classic sand\'s',
          JSON.stringify({ gpu: gS.slides, classic: cS.slides, gpuPerSecond: Math.round(gS.rate), classicPerSecond: Math.round(cS.rate) }));
    // leaned: sound only if the sand moved. (This small bed, deep in the funnel, does not: silence, where the
    // classic sand's heap gives a little, about 1,300 slides a second at its fastest.)
    var cL = classicOn(MOVES.lean, sInfo.total), gL = await play('lean');
    var movedL = gL.seen !== null;
    check(gL.thumps.length === 0 && gL.slams === 0 && cL.thumps === 0 && (movedL ? gL.rate <= 2 * cL.rate && gL.agit < 0.3 : gL.slides === 0 && gL.agit === 0),
          'SOUND: leaned 30 degrees: no landing, and sound only as far as the sand moved (a bed that does not move makes none; one that does, no more than twice the classic sand\'s slides)',
          JSON.stringify({ bedMoved: movedL, slides: gL.slides, perSecond: Math.round(gL.rate), agit: +gL.agit.toFixed(3), classicPerSecond: Math.round(cL.rate) }));
    var bs = await fresh();
    var moBack = await page.evaluate(function () { var mo = window.Hourglass.motion; return typeof mo.heading === 'number' && mo.seenMotion === false && typeof mo.sample === 'function' && !Object.prototype.hasOwnProperty.call(mo, 'sample'); });
    check(!!bs.audit && bs.audit.ok && bs.tally.points === bs.pts && bs.tally.nan === 0 && bs.tally.outside === 0 && bs.state === 'idle' && bs.nTop === bs.total && moBack,
          'SOUND: afterwards the glass is as it was: idle, all its sand above, every point in the glass, the audit passes, and the app\'s motion object is its own again',
          JSON.stringify({ audit: bs.audit, state: bs.state, nTop: bs.nTop, motionRestored: moBack }));
    }

    /* ---- RUN ------------------------------------------------------------- */
    if (doCase('RUN')) {
    var r0 = await page.evaluate(function () {
      var H = window.Hourglass, W = window.__watch, w = H.realSand.stats().layers.words;
      W.keep = true; W.frames = []; W.audit = []; W.cross = null;
      // (the control's record of the beds: the engine's own, on an object that reads everything else from the engine)
      var rs = H.realSand, m = Object.create(rs);
      m._snd = Object.assign({}, rs._snd, { thump: new Float32Array(4), slam: new Float32Array(2), prev: [null, null], fall: [null, null], pack: [0, 0], loose: [false, false], n: { thumps: 0, slams: 0 } });
      m.agit = new Float32Array(2);
      W.plug = { m: m, few: 0, early: 0, ctl: 0, fast: 0, armed: 0, thumps: 0, agit: 0 };
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
      // what the bed fed from Start to the end, the glass left alone; and the control's
      var snd = { landings: 0, agit: 0, plug: { few: W.plug.few, early: W.plug.early, ctl: W.plug.ctl, fast: W.plug.fast, armed: W.plug.armed, landings: W.plug.thumps, agit: W.plug.agit } };
      F.forEach(function (x) { if (x.th > 0) snd.landings++; if (x.agit > snd.agit) snd.agit = x.agit; });
      W.plug = null;
      return { snd: snd, zeroAt: zeroAt, cross: W.cross, doneF: doneF, emptyF: emptyF, zeroUp: zeroUp, audits: W.audits, audit: W.audit.slice(),
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
    var plug = run.snd.plug;
    check(run.snd.landings === 0 && run.snd.agit < 0.1 && plug.few > 20 && plug.early === 0,
          'RUN: started and left alone, the glass feeds no thump or slam and next to no agitation from Start to its end, and the few crowded points under the neck (the plug of the stream, the first grains on the floor) are never heard as a bed',
          JSON.stringify({ landings: run.snd.landings, agitation: +run.snd.agit.toFixed(3), readbacksWithFewerThan40PointsBelow: plug.few, heardAsABed: plug.early, theirFastest: +plug.fast.toFixed(1) }));
    // (heard as a bed, those points land a thump when they happen to slow from over 30 cells/s to half within
    // the landing's window: 0.0056 with the phone at rest in the take that found it; not in every take)
    check(plug.ctl > 20 && plug.ctl >= 0.9 * plug.few,
          'RUN: ... and with those points taken for a bed (control: the same readbacks, each bed\'s points counted a hundredfold) they are heard as one in nearly every such readback',
          JSON.stringify({ heardAsABed: plug.ctl, of: plug.few, fallsUnderWay: plug.armed, landings: plug.landings, agitation: +plug.agit.toFixed(2) }));
    // the report says the same (stats().ends, what "Copy a report" carries for Gate B)
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
    }

    /* ---- RESET ----------------------------------------------------------- */
    if (doCase('RESET')) {
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
    }

    /* ---- FLIP ------------------------------------------------------------ */
    if (doCase('FLIP')) {
    if (!doCase('RESET')) await newGlass();
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
    }

    /* ---- POUR, then a tilt swap with a pour ------------------------------ */
    if (doCase('POUR')) {
    if (!doCase('FLIP')) {
      // (what FLIP leaves: a new glass started, turned over at 4 s, its turn done 2 s since)
      await newGlass();
      await page.evaluate(function () { window.Hourglass.start(); });
      await frames(240);
      await page.evaluate(function () { window.Hourglass.flipNow(); });
      await frames(400, '!H.flip.active');
      await frames(120);
    }
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
    }

    /* ---- HIDDEN ---------------------------------------------------------- */
    if (doCase('HIDDEN')) {
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
    }

    /* ---- LOSS ------------------------------------------------------------ */
    if (doCase('LOSS')) {
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
    check(lb.live && lb.real && lb.rstate === 'on', 'LOSS: Real sand is rebuilt and takes the sand back', lb.rstate + ': ' + lb.note + (why ? '; ' + why.slice(0, 900) : ''));
    }

    /* ---- LIT ------------------------------------------------------------- */
    if (doCase('LIT')) {
    var baseLib = require('./lib/base.js'), baseMjs = null, baseWgsl = null;
    try { baseMjs = baseLib.show(LIT_BASE, 'realsand/grains.mjs'); baseWgsl = baseLib.show(LIT_BASE, 'realsand/shaders/grains.wgsl'); } catch (eb) { /* (checked below) */ }
    check(!!baseMjs && !!baseWgsl, 'LIT: the grain renderer of ' + LIT_BASE + ' (grains.mjs, grains.wgsl) is had from git', baseMjs ? '' : 'git show failed: the commit is not in this clone');
    if (baseMjs && baseWgsl) {
    await newGlass();
    await frames(30);
    await page.evaluate(installLit, { mjs: baseMjs, wgsl: baseWgsl });
    /** Tune's Light row and the look, by their own controls; then a frame both canvases hold. */
    async function setLit(light, look) {
      await page.evaluate(function (a) {
        var b = document.querySelector('#lights [data-light="' + a.light + '"]');
        if (b.getAttribute('aria-checked') !== 'true') b.click();
        if (a.look) { var l = document.querySelector('[data-look="' + a.look + '"]'); if (l.getAttribute('aria-checked') !== 'true') l.click(); }
      }, { light: light, look: look || null });
      if (look) await page.waitForTimeout(450);          // (the looks' fade runs on the page's own animation clock)
      await frames(3);
    }
    /** One frame both canvases hold: the two compared, the engine's flanks, the frame's key on the screen. */
    function litFrame() {
      return page.evaluate(async function () {
        var L = window.__lit, ok = await L.frame(), rs = window.Hourglass.realSand;
        return { ok: ok, same: L.same(), flanks: L.flanks(), key: L.keyOff(), light: rs._light, relief: rs.grains.n.relief, mode: rs.stats().mode };
      });
    }
    var SUN = 1.2, f2 = function (v) { return v === v ? v.toFixed(2) : String(v); };
    var look0 = await page.evaluate(function () { return document.documentElement.getAttribute('data-look') === 'light' ? 'light' : 'dark'; });
    // upright, at rest: sunlit in the dark look and in the light, then soft
    await setLit('sunlit', 'dark');
    var uD = await litFrame();
    await setLit('sunlit', 'light');
    var uL = await litFrame();
    await setLit('soft', 'dark');
    var sA = await litFrame();
    check(uD.ok && uL.ok && uD.light.on && uD.light.m === 0 && uL.light.m === 1 && uD.flanks.ratio >= SUN && uL.flanks.ratio >= SUN,
      'LIT: sunlit, the sand\'s side toward the screen\'s left is the brighter, upright and at rest, in both looks (relative luminance, at least ' + SUN + ' : 1)',
      'dark ' + f2(uD.flanks.ratio) + ' : 1, light ' + f2(uL.flanks.ratio) + ' : 1, ' + uD.flanks.n + ' pixels sampled');
    // the control, on the very same grains: each frame's flank ratio over the base's of the same frame (the bed's own
    // shape and layers cancel), 1 under Soft, and under Sunlit at least SUN in both looks
    check(sA.ok && uD.ok && uL.ok && !sA.light.on && sA.flanks.rel > 0.9 && sA.flanks.rel < 1.1 && uD.flanks.rel >= SUN && uL.flanks.rel >= SUN,
      'LIT: ... and under Soft the two sides are alike: the flank ratio over the light-free picture of the same grains in the same frame (the base\'s) is 1 under Soft (0.9 to 1.1), while Sunlit\'s is at least ' + SUN + ' in both looks (control)',
      'soft ' + f2(sA.flanks.rel) + ', sunlit dark ' + f2(uD.flanks.rel) + ', light ' + f2(uL.flanks.rel) + ' (the bed itself: ' + f2(sA.flanks.base) + ', ' + f2(uD.flanks.base) + ', ' + f2(uL.flanks.base) + ' : 1)');
    check(sA.ok && sA.same.differ === 0 && sA.same.drawn > 5000, 'LIT: Soft is the picture of ' + LIT_BASE + ', byte for byte: at rest', JSON.stringify(sA.same));
    check(uD.same.differ > 0.2 * uD.same.drawn && uL.same.differ > 0.2 * uL.same.drawn, 'LIT: ... while Sunlit is another picture (control)',
      'dark ' + uD.same.differ + ' of ' + uD.same.drawn + ' pixels differ, light ' + uL.same.differ + ' of ' + uL.same.drawn);
    // the stream running, soft
    await page.evaluate(function () { window.Hourglass.start(); });
    await frames(60);
    var sB = await litFrame();
    check(sB.ok && sB.same.differ === 0 && sB.same.drawn > 5000 && sB.mode !== 'asleep', 'LIT: Soft is the picture of ' + LIT_BASE + ': with the stream running', JSON.stringify(sB.same) + ', ' + sB.mode);
    /** A Flip to its end, every 4th frame one both canvases hold: what each of those says. */
    async function turn() {
      await page.evaluate(function () { window.Hourglass.flipNow(); });
      var out = [];
      for (var k = 0; k < 400; k++) {
        if (k % 4 === 0) out.push(await litFrame()); else await frames(1);
        if (!(await page.evaluate(function () { return window.Hourglass.flip.active; }))) break;
      }
      out.push(await litFrame());
      return out;
    }
    // a full turn under Soft: the base's picture in every sampled frame, the swap's and the leaned ones among them
    var tS = await turn(), worst = 0, held = 0, leaned = 0;
    tS.forEach(function (r) { if (r.ok) { held++; worst = Math.max(worst, r.same.differ); if (Math.abs(Math.sin(r.key.theta)) > 0.3) leaned++; } });
    check(held >= 8 && leaned >= 3 && worst === 0, 'LIT: Soft is the picture of ' + LIT_BASE + ': through a full turn, in every sampled frame',
      held + ' frames compared (' + leaned + ' with the glass leaned over 17 degrees), at most ' + worst + ' pixels differ');
    await frames(120);
    var sD = await litFrame();
    check(sD.ok && sD.same.differ === 0 && sD.same.drawn > 5000, 'LIT: Soft is the picture of ' + LIT_BASE + ': after the turn', JSON.stringify(sD.same));
    // after that full turn the engine's points lie turned end for end; a new glass (a Reset: the bed even again) is lit from the screen's left as before
    await page.evaluate(function () { window.Hourglass.reset(); });
    await frames(150, sweeping);
    await frames(40);
    await setLit('sunlit', null);
    var aT = await litFrame();
    check(aT.ok && aT.key.parity !== sB.key.parity && aT.flanks.ratio >= SUN && aT.key.lit < 0.01,
      'LIT: after a full turn (the engine\'s points turned end for end) a new glass is lit from the screen\'s left as before',
      f2(aT.flanks.ratio) + ' : 1, the key ' + aT.key.lit.toFixed(3) + ' from the room\'s');
    // a second full turn, sunlit, every frame of it: the key stays the room's; leaned on the way over, the lit side is the screen's left
    var tK = await page.evaluate(async function () {
      var H = window.Hourglass, L = window.__lit, V = window.__vt, rs = H.realSand, out = { n: 0, lit: 0, old: 0, swap: null, lean: [] }, p0 = rs.valve.parity;
      H.flipNow();
      for (var k = 0; k < 400 && H.flip.active; k++) {
        var d = L.draws;
        await L.settle();
        await V.frame();
        if (L.draws === d || !L.look.lit) continue;
        var o = L.keyOff(), t = Math.abs(o.theta);
        out.n++; out.lit = Math.max(out.lit, o.lit); out.old = Math.max(out.old, o.old);
        if (out.swap === null && rs.valve.parity !== p0) out.swap = { lit: o.lit, fresh: o.fresh };
        if (rs.valve.parity === p0 && t > 0.3 && t < 1.0 && out.lean.length < 12) { await L.settle(); if (L.pair === L.draws) out.lean.push(L.flanks().ratio); }
      }
      return out;
    });
    var leanMin = tK.lean.length ? Math.min.apply(null, tK.lean) : NaN;
    check(tK.n >= 30 && tK.lit < 0.01 && !!tK.swap && tK.swap.lit < 0.01 && tK.swap.fresh,
      'LIT: through a full turn the key the grains are lit with is the room\'s, as the screen shows the canvas, in every frame drawn, the swap\'s too (whose relief starts afresh)',
      tK.n + ' frames, at most ' + tK.lit.toFixed(4) + ' from KEY_LIGHT; the swap\'s frame ' + (tK.swap ? tK.swap.lit.toFixed(4) : 'not seen'));
    check(tK.old > 0.02, 'LIT: ... while the key turned back by the rotor\'s CSS angle as it stood when the frame was drawn (the bead\'s light of before goes by it) is a frame behind the turn (control)',
      'up to ' + tK.old.toFixed(3) + ' from KEY_LIGHT');
    check(tK.lean.length >= 3 && leanMin >= SUN, 'LIT: leaned (17 to 57 degrees, on the way over) the lit side is the screen\'s left',
      tK.lean.length + ' frames, ' + tK.lean.map(f2).join(', ') + ' : 1');
    await frames(30);
    // as it was found: the look, the light of the app (sunlit), the engine's own renderer alone
    await setLit('sunlit', look0);
    }
    }

    /* ---- SHAPES ---------------------------------------------------------- */
    if (doCase('SHAPES')) {
    var SHAPE_IDS = SHAPE_LIST || await page.evaluate(function () { var P = window.HourglassPhysics; return P.SHAPE_ORDER.filter(function (id) { return P.SHAPES[id].offered; }); });
    var shapeFill = [], shapeRun = [], fillOk = true, runOk = true;
    for (var si = 0; si < SHAPE_IDS.length; si++) {
      var sid = SHAPE_IDS[si];
      await page.evaluate(function (id) {
        localStorage.setItem('hourglass.settings.v1', JSON.stringify({ v: 2, realSand: true, durationMs: 3600000, layers: false, shape: id }));
        localStorage.removeItem('hourglass.session.v1');
      }, sid);
      await page.reload();
      await page.waitForFunction(function () {
        var H = window.Hourglass;
        return !!H && ((!!H.realSand && H.sim === H.realSand) || /Could not|Needs|Did not|updating/.test(document.getElementById('realsand-note').textContent));
      }, null, { timeout: 180000, polling: 200 });
      await page.evaluate(function () { window.__vt.freeze(); });
      await page.evaluate(installWatch);
      var f0 = await fresh();
      var g0 = await page.evaluate(function () {
        var H = window.Hourglass, rs = H.realSand, s = H.sim;
        return { cpu: s.geo.shape ? s.geo.shape.id : 'classic', gpu: rs && rs.glass.geo.shape ? rs.glass.geo.shape.id : 'classic',
                 cap: Math.round(s.capacity * Math.min(0.78, s.fillMax)) };
      });
      var okF = f0.live && g0.cpu === sid && g0.gpu === sid && f0.total === f0.want && f0.want === g0.cap && f0.nTop === f0.total &&
                !!f0.tally && f0.tally.points === f0.pts && f0.tally.above === f0.pts && f0.tally.nan === 0 && f0.tally.outside === 0 && !!f0.audit && f0.audit.ok;
      if (!okF) fillOk = false;
      shapeFill.push(sid + ' ' + f0.total + ' grains, ' + (f0.tally ? f0.tally.points : '?') + ' points' + (okF ? '' : ' (WRONG: ' + JSON.stringify({ live: f0.live, glass: g0, want: f0.want, nTop: f0.nTop, tally: f0.tally, audit: f0.audit }) + ')'));
      // a 10 s glass (a Reset to the new length), run to its end
      await page.evaluate(function () { window.Hourglass.setDuration(10000); });
      await frames(12);
      await frames(240, sweeping);
      await frames(30);
      await page.evaluate(function () { var W = window.__watch; W.keep = true; W.frames = []; W.audit = []; W.cross = null; W.audits = 0; window.Hourglass.start(); });
      await frames(270);
      await shot('shape-' + (si + 1) + '-' + sid);
      await frames(900, "T.state === 'done' && rs.nTop === 0");
      await frames(4);
      var rn = await page.evaluate(function () {
        var W = window.__watch, F = W.frames, zeroAt = null;
        for (var i = 0; i < F.length; i++) if (F[i].state === 'running' && zeroAt === null) zeroAt = F[i].now + F[i].rem;
        W.keep = false;
        return { zeroAt: zeroAt, cross: W.cross, audits: W.audits, audit: W.audit.slice(), state: window.Hourglass.timer.state, nTop: window.Hourglass.sim.nTop };
      });
      var lt = rn.cross !== null && rn.zeroAt !== null ? rn.cross - rn.zeroAt : NaN;
      var okR = rn.state === 'done' && rn.nTop === 0 && lt >= -0.5 && lt <= FRAME + 0.5 && rn.audit.length === 0 && rn.audits > 50;
      if (!okR) runOk = false;
      shapeRun.push(sid + ' ' + (lt === lt ? lt.toFixed(1) : lt) + ' ms' + (okR ? '' : ' (WRONG: ' + JSON.stringify(rn).slice(0, 300) + ')'));
    }
    if (!SHAPE_LIST) {
      check(SHAPE_IDS.length >= 9 && fillOk, 'SHAPES: in each shape Tune offers, a 60-minute glass is filled to its cap with exactly the ledger\'s points on the GPU, all above, none outside, the GPU\'s glass the shape\'s own: ' + shapeFill.join('; '));
      check(SHAPE_IDS.length >= 9 && runOk, 'SHAPES: ... and a 10 s glass in it runs to its end, the last point crossing within one frame after 00:00.0, every readback agreeing with the ledger: ' + shapeRun.join('; '));
    } else {
      var named = SHAPE_LIST.join(', ') + (SHAPE_HELD.length ? ' (held back from Tune, offered for this run: ' + SHAPE_HELD.join(', ') + ')' : '');
      check(shapeFill.length === SHAPE_LIST.length && fillOk, 'SHAPES: in each shape named by --shapes, ' + named + ', a 60-minute glass is filled to its cap with exactly the ledger\'s points on the GPU, all above, none outside, the GPU\'s glass the shape\'s own: ' + shapeFill.join('; '));
      check(shapeRun.length === SHAPE_LIST.length && runOk, 'SHAPES: ... and a 10 s glass in it runs to its end, the last point crossing within one frame after 00:00.0, every readback agreeing with the ledger: ' + shapeRun.join('; '));
    }
    }

    check(errors.length === 0, 'no page or console errors', errors.slice(0, 3).join(' | '));
  } catch (e) {
    check(false, 'no exception', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    if (browser) await browser.close();
    await new Promise(function (r) { server.close(function () { r(); }); setTimeout(r, 500); });
  }
  console.log('realsand-gpu: ' + (count - failures) + '/' + count + ' passed in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s' +
              (ONLY ? ' (only ' + ONLY.join(', ') + ', not the whole suite)' : '') + (SHAPE_LIST ? ' (SHAPES in ' + SHAPE_LIST.join(', ') + ' only)' : ''));
  if (failures) process.exitCode = 1;
})();
