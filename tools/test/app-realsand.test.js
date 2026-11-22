#!/usr/bin/env node
/*
 * Real sand in the app (design 13.2), in the browser harness, which has no WebGPU adapter.
 *
 *  OFF   the switch off (the default): nothing under realsand/ is requested, no engine, the
 *        CPU Sim is the sim; the row "Real sand" sits in the Material group after Grain, off,
 *        with its note; Tune has 10 rows.
 *  NOGPU the switch on, the real engine, in this Chromium (navigator.gpu, but no adapter): the
 *        engine is loaded, does not start, the switch greys with "Needs WebGPU", the setting
 *        is cleared, the CPU sand runs, no errors.
 *  MOCK  the switch on, the real adapter (realsand/app-sand.mjs) with a mock GPU whose neck is
 *        the valve test's plant (stubs/realsand-mock-boot.mjs, served as realsand/boot.mjs):
 *        - HANDOVER: the CPU sand first, then the GPU sand as Hourglass.sim, #c-gpu in
 *          #c-sand's box after it, the canvases cross-faded, "On"; the monitor re-hooked;
 *        - END: a 10 s glass whose last point leaves within 30 ms of 00:00.0 (by the plant's
 *          record) and whose nTop reads 0 within 3 frames after, never before;
 *        - RESET: the sweep takes 850-1300 ms and the new glass's counts are exact;
 *        - POUR, HIDDEN, FLIP: a pour adds exactly the time its sand is worth, a hidden gap is
 *          caught up by a transfer, the Flip swaps the ledger and the time, and the glass still
 *          ends within 30 ms of 00:00.0;
 *        - SWAP FRAME: a swap while the GPU's runs are held turns #c-gpu by CSS, and the run
 *          with the flip pass turns it back;
 *        - LOSS: a device lost mid-run gives the sand to the CPU Sim in the same frame, at the
 *          ledger's counts, the clock untouched, with the toast; the engine rebuilds and takes
 *          the sand back; the glass ends on time;
 *        - SOUND: what audio.js is given (design 8): the stream's flow follows the grains the
 *          ledger releases, landings come after the fall from the neck to the heap, events
 *          within their ranges, poured sand lands in the top bulb, nothing for the bed's
 *          thumps and slams, no landing buzz;
 *        - census every 15 frames through the engine's audit(), no errors.
 *  FAIL  a start failure of the second kind: the CPU sand, the setting kept, the note says why;
 *        after three launches in a row it stops trying (nothing requested); off and on again
 *        clears the count.
 *  STAMP a build stamp other than app.js's: the note says Real sand is updating, the setting
 *        kept, no engine.
 *  AGAIN a start cut short because the page was hidden: tried again once the page is in view,
 *        and taken over then, with no failure counted.
 *
 *   node tools/test/app-realsand.test.js [--port 8905]
 */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./stubs/harness.js');
var sleep = H.sleep;
var KEY = 'hourglass.settings.v1';
var PLANT = fs.readFileSync(path.join(__dirname, 'lib', 'realsand-plant.js'), 'utf8');
var MOCK = fs.readFileSync(path.join(__dirname, 'stubs', 'realsand-mock-boot.mjs'), 'utf8');

/** Before the page's scripts: the plant, the mock's settings, and a page that can be hidden (no animation frames then, as on the phone). */
function pageInit(arg) {
  var module = { exports: {} };
  (new Function('module', 'exports', arg.plant))(module, module.exports);
  window.__RealsandPlant = module.exports;
  window.__mock = arg.mock || {};
  window.__hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return window.__hidden; } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return window.__hidden ? 'hidden' : 'visible'; } });
  var raf = window.requestAnimationFrame.bind(window), held = [];
  window.requestAnimationFrame = function (cb) { if (window.__hidden) { held.push(cb); return 0; } return raf(cb); };
  window.__hide = function (on) {
    window.__hidden = !!on;
    document.dispatchEvent(new Event('visibilitychange'));
    if (!on) { var h = held; held = []; h.forEach(function (cb) { raf(cb); }); }
  };
}
function mockRoute() {
  return { url: '**/realsand/boot.mjs', handler: function (route) {
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: MOCK });
  } };
}
function openMock(env, mock, settings) {
  return env.open({ storage: { 'hourglass.settings.v1': Object.assign({ realSand: true, durationMs: 10000 }, settings || {}) },
    init: pageInit, initArg: { plant: PLANT, mock: mock || {} }, routes: [mockRoute()] });
}
/** The page's state of Real sand. */
function state(t) {
  return t.eval(function () {
    var Hg = window.Hourglass, s = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
    var el = document.getElementById('opt-realsand'), gpu = document.getElementById('c-gpu');
    return { note: document.getElementById('realsand-note').textContent, checked: el.checked, disabled: el.disabled,
      greyed: document.getElementById('realsand-row').classList.contains('na'),
      setting: s.realSand, fails: s.realSandFails, why: s.realSandWhy, engine: !!Hg.realSand,
      cpu: Hg.sim instanceof window.HourglassPhysics.Sim, live: !!Hg.realSand && Hg.sim === Hg.realSand,
      real: document.getElementById('app').classList.contains('real'), gpu: !!gpu,
      grainNote: document.getElementById('grain-note').textContent,
      requested: performance.getEntriesByType('resource').map(function (e) { return new URL(e.name).pathname; })
        .filter(function (p) { return p.indexOf('/realsand/') >= 0; }) };
  });
}
/** Record every frame: [Date.now, state, rem, lastTick, nTop, the plant's points above, its last crossing (s), live, mock frame]. */
function record(t) {
  return t.eval(function () {
    __rec.start(function (Hg) {
      var e = window.__mockEnv, pl = e && e.solver && e.solver.plant;
      return [Date.now(), Hg.timer.state, Hg.timer.rem, Hg.timer.lastTick, Hg.sim.nTop, pl ? pl.above : -1,
        pl ? pl.lastCrossT : NaN, Hg.sim === Hg.realSand ? 1 : 0, e ? e.V.frame : 0];
    }, { frame: true });
  });
}
/** From the record of one glass run to its end: the last point against 00:00.0, and when nTop read 0. */
function endOf(rows) {
  var endPred = NaN, f1 = -1, f2 = -1, early = 0, last = rows[rows.length - 1];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r[1] === 'running') endPred = r[3] + r[2];
    if (f1 < 0 && r[5] === 0) f1 = i;
    if (f2 < 0 && r[4] === 0) f2 = i;
    if (r[4] === 0 && r[5] > 0) early++;
  }
  return { endPred: endPred, lastCross: last[6] * 1000, d: last[6] * 1000 - endPred, frames: f2 - f1, f1: f1, f2: f2, early: early,
    done: last[1] === 'done', liveAll: rows.every(function (r) { return r[7] === 1; }) };
}
async function waitFor(t, fn, ms, arg) {
  await t.page.waitForFunction(fn, arg, { timeout: ms || 15000, polling: 50 });
}
async function runToEnd(t, maxMs) {
  await waitFor(t, function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, maxMs || 20000);
  await sleep(300);
  return endOf(await t.eval(function () { return __rec.stop(); }));
}
function fmtEnd(e) {
  return 'last point ' + (e.d >= 0 ? '+' : '') + e.d.toFixed(1) + ' ms after 00:00.0; nTop 0 ' + e.frames + ' frames after the plant emptied; ' +
    e.early + ' frames read 0 with a point above';
}

async function testOff(s, env) {
  var t = await env.open({});
  try {
    await sleep(1200);
    var st = await state(t);
    s.check('OFF: nothing under realsand/ is requested, no engine, the CPU Sim is the sim, no #c-gpu',
            st.requested.length === 0 && !st.engine && st.cpu && !st.gpu && !st.real && !st.setting, JSON.stringify(st));
    var ui = await t.eval(function () {
      var row = document.getElementById('realsand-row'), el = document.getElementById('opt-realsand');
      var prev = row.previousElementSibling;
      return { tag: row.tagName, for: row.getAttribute('for'), title: row.querySelector('b').textContent,
        role: el.getAttribute('role'), type: el.type, cls: el.className,
        afterGrain: !!prev && prev.classList.contains('sub') && !!prev.querySelector('#grains'),
        material: row.parentNode.classList.contains('rows-single'), last: row === row.parentNode.lastElementChild,
        rows: document.querySelectorAll('#sheet-settings .row').length };
    });
    s.check('OFF: the row "Real sand", a labelled switch, sits in the Material group right after Grain\'s choices; Tune has 10 rows',
            ui.tag === 'LABEL' && ui.for === 'opt-realsand' && ui.title === 'Real sand' && ui.role === 'switch' && ui.type === 'checkbox' &&
            ui.cls === 'switch' && ui.afterGrain && ui.material && ui.last && ui.rows === 10, JSON.stringify(ui));
    s.check('OFF: off, with its note; Grain\'s note as before',
            !st.checked && !st.disabled && !st.greyed && st.note === 'Each grain simulated on the graphics chip. Uses more battery.' &&
            st.grainNote === 'Finer sand is more grains, and more work for the phone', JSON.stringify([st.note, st.grainNote]));
    await H.invariants(s, t, 'OFF');
  } finally { await t.close(); }
}

async function testNoGpu(s, env) {
  var t = await env.open({ storage: { 'hourglass.settings.v1': { realSand: true } } });
  try {
    await waitFor(t, function () { return document.getElementById('realsand-row').classList.contains('na'); }, 15000);
    var st = await state(t);
    s.check('NOGPU: the engine is loaded (boot.mjs and its modules) and does not start: this Chromium has no adapter',
            st.requested.indexOf('/realsand/boot.mjs') >= 0 && st.requested.indexOf('/realsand/app-sand.mjs') >= 0 && !st.engine, st.requested.length + ' requested');
    s.check('NOGPU: the switch greys, off, and says "Needs WebGPU (iOS 26 or later)"; the setting is cleared',
            st.greyed && st.disabled && !st.checked && st.note === 'Needs WebGPU (iOS 26 or later)' && st.setting === false, JSON.stringify(st));
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(600);
    var run = await t.eval(function () { return { st: window.Hourglass.timer.state, cpu: window.Hourglass.sim instanceof window.HourglassPhysics.Sim, real: document.getElementById('app').classList.contains('real') }; });
    s.check('NOGPU: the CPU sand runs as before', run.st === 'running' && run.cpu && !run.real, JSON.stringify(run));
    await H.invariants(s, t, 'NOGPU');
  } finally { await t.close(); }
}

async function testMock(s, env) {
  var t = await openMock(env, { seed: 7 });
  try {
    /* ---- HANDOVER ------------------------------------------------------- */
    await waitFor(t, function () { var Hg = window.Hourglass; return !!Hg.realSand && Hg.sim === Hg.realSand && __mon.sim === Hg.sim; }, 20000);
    await sleep(700);
    var st = await state(t);
    var h = await t.eval(function () {
      var c = document.getElementById('c-gpu'), cs = document.getElementById('c-sand'), Hg = window.Hourglass;
      return { parent: c && c.parentNode.id, prev: c && c.previousElementSibling && c.previousElementSibling.id,
        box: c && ['width', 'height', 'left', 'top'].every(function (k) { return c.style[k] === cs.style[k] && c.style[k] !== ''; }),
        gpuOpacity: getComputedStyle(c).opacity, sandOpacity: getComputedStyle(cs).opacity, bloomOpacity: getComputedStyle(document.getElementById('c-bloom')).opacity,
        hooks: __mon.hooks, log: Hg.realSand.stats ? Hg.realSand.stats().live : null, total: Hg.sim.total, top: Hg.sim.nTop,
        want: Hg.grainsFor(10000), creates: window.__mockEnv.creates };
    });
    s.check('HANDOVER: the GPU sand is the sim (Hourglass.sim is Hourglass.realSand), "On", the setting kept, no failures counted',
            st.live && st.note === 'On' && st.checked && st.setting === true && !st.fails && h.creates === 1, JSON.stringify(st));
    s.check('HANDOVER: #c-gpu sits in #rotor right after #c-sand, in its CSS box; #c-sand and #c-bloom faded out, #c-gpu in',
            h.parent === 'rotor' && h.prev === 'c-sand' && h.box && h.gpuOpacity === '1' && h.sandOpacity === '0' && h.bloomOpacity === '0', JSON.stringify(h));
    s.check('HANDOVER: the CPU Sim was the sim first; the monitor hooked the GPU sand when it took over; the counts carried over',
            h.hooks === 2 && h.total === h.want && h.top === h.total, JSON.stringify({ hooks: h.hooks, total: h.total, top: h.top, want: h.want }));
    s.check('HANDOVER: Grain\'s note says Real sand keeps its own grain', st.grainNote === 'Real sand keeps its own grain; this sets the classic sand', st.grainNote);

    /* ---- END: a 10 s glass ---------------------------------------------- */
    await record(t);
    // the sound the GPU sand makes (design 8): what the app gives audio.js, frame by frame
    await t.eval(function () {
      var Hg = window.Hourglass, A = Hg.audio, up = A.update;
      var R = window.__snd = { run: 0, flow: 0, rel0: null, imp0: null, impFrames: 0, ev: 0, evTop: 0, evBad: 0, thump: 0, slam: 0, slides: 0,
        tailMin: 1, fillMax: 0, buzz10: 0 };
      A.update = function (st) {
        var now = performance.now(), f = Hg.sim.frame;
        if (st.running) {
          R.run++; R.flow = Math.max(R.flow, Hg.stats.flow);
          if (R.rel0 === null && f.released > 0) R.rel0 = now;
          if (f.impSand + f.impGlass > 0) { R.impFrames++; if (R.imp0 === null) R.imp0 = now; }
        }
        var sim = st.sim;
        if (sim && sim.nev) {
          R.ev += sim.nev;
          for (var i = 0; i < sim.nev; i++) {
            if (sim.evK[i] & 2) R.evTop++;
            if (!(sim.evV[i] > 0 && sim.evV[i] <= 1) || !(Math.abs(sim.evX[i]) <= 1)) R.evBad++;
          }
        }
        if (st.thump) R.thump = Math.max(R.thump, st.thump[0], st.thump[2]);
        if (st.slam) R.slam = Math.max(R.slam, st.slam[0]);
        R.slides = Math.max(R.slides, st.slides);
        if (st.running) R.tailMin = Math.min(R.tailMin, st.tail);
        // (until the pour: the fill rises to the glass's own sand, all of it below)
        if (R.full === undefined) { R.fillMax = Math.max(R.fillMax, st.fill); if (Hg.timer.state === 'done' && Hg.sim.nTop === 0) R.full = Hg.sim.total / Hg.sim.capacity; }
        return up.apply(this, arguments);
      };
      if (navigator.vibrate) { var v = navigator.vibrate.bind(navigator); navigator.vibrate = function (p) { if (p === 10) R.buzz10++; return v(p); }; }
    });
    await t.eval(function () { window.Hourglass.start(); });
    var e1 = await runToEnd(t, 20000);
    s.check('END: a 10 s glass on the GPU sand: the last point leaves within 30 ms of 00:00.0 (the plant\'s record), nTop reads 0 within 3 frames after, never before',
            e1.done && e1.liveAll && e1.d >= -5 && e1.d <= 30 && e1.frames >= 0 && e1.frames <= 3 && e1.early === 0, fmtEnd(e1));
    var pl1 = await t.eval(function () { var p = window.__mockEnv.solver.plant; return { viol: p.viol, closed: p.closedCross, startErr: p.startErr }; });
    s.check('END: no point crossed below the target, none while the neck was shut, every run started from the true count', pl1.viol === 0 && pl1.closed === 0 && pl1.startErr === 0, JSON.stringify(pl1));

    /* ---- RESET ---------------------------------------------------------- */
    var r = await t.eval(function () {
      var Hg = window.Hourglass, app = document.getElementById('app'), t0 = performance.now();
      Hg.reset();
      return new Promise(function (res) {
        (function w() {
          if (!app.classList.contains('sweep') && performance.now() - t0 > 100) {
            var rs = Hg.realSand, e = window.__mockEnv, sol = e.solver;
            res({ ms: performance.now() - t0, total: Hg.sim.total, top: Hg.sim.nTop, want: Hg.grainsFor(Hg.timer.durationMs), live: Hg.sim === rs,
              points: rs.valve.points, count: sol.count, plant: sol.plant.above + sol.plant.below, pts: rs.valve.Pts(Hg.sim.total), state: Hg.timer.state });
            return;
          }
          requestAnimationFrame(w);
        })();
      });
    });
    s.check('RESET: the sweep takes 850-1300 ms on the GPU sand', r.ms >= 850 && r.ms <= 1300 && r.live, r.ms.toFixed(0) + ' ms');
    s.check('RESET: the new glass: total = grainsFor(10 s), all above, the GPU filled with exactly its points',
            r.total === r.want && r.top === r.total && r.points === r.pts && r.count === r.pts && r.plant === r.pts, JSON.stringify(r));

    /* ---- POUR, HIDDEN, FLIP --------------------------------------------- */
    await record(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    await t.eval(function () {
      var Hg = window.Hourglass, pour = Hg.sim.pour;
      Hg.pause();
      window.__pour = { rem0: Hg.timer.rem, made: [], top0: Hg.sim.nTop, total0: Hg.sim.total, app0: window.__mockEnv.solver.appended };
      Hg.sim.pour = function (n) { var m = pour.call(Hg.sim, n); window.__pour.made.push(m); return m; };
    });
    var box = await t.page.$eval('#btn-sand', function (el) { var b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await t.touch.down(box.x, box.y);
    await sleep(300);
    await t.touch.up();
    await sleep(400);
    var p = await t.eval(function () {
      var Hg = window.Hourglass, P = window.__pour, rem = P.rem0, made = 0;
      for (var i = 0; i < P.made.length; i++) { if (P.made[i]) rem = Hg.remAt(Hg.topAt(rem) + P.made[i]); made += P.made[i]; }
      delete Hg.sim.pour;
      var rs = Hg.realSand, e = window.__mockEnv;
      return { want: rem, got: Hg.timer.rem, made: made, top: Hg.sim.nTop - P.top0, total: Hg.sim.total - P.total0,
        appended: e.solver.appended - P.app0, ptsWant: rs.valve.Pts(Hg.sim.total) - rs.valve.Pts(P.total0) };
    });
    var snd = await t.eval(function () {
      var R = window.__snd, Hg = window.Hourglass;
      return Object.assign({ rate: Hg.timer.rate, full: R.full }, R);
    });
    s.check('SOUND: the stream is heard at the rate the ledger releases its grains (the smoothed flow within half and twice the clock\'s rate)',
            snd.run > 300 && snd.flow >= 0.5 * snd.rate && snd.flow <= 2 * snd.rate, JSON.stringify({ flow: snd.flow, rate: snd.rate, frames: snd.run }));
    s.check('SOUND: the first landings come after the fall from the neck to the floor (0.25 to 0.7 s after the first grain left), then through the run',
            snd.rel0 !== null && snd.imp0 !== null && snd.imp0 - snd.rel0 >= 250 && snd.imp0 - snd.rel0 <= 700 && snd.impFrames > snd.run * 0.5,
            JSON.stringify({ fall: snd.imp0 - snd.rel0, impFrames: snd.impFrames }));
    s.check('SOUND: landing events for the grains (up to 48 a frame), each within its ranges; the tail fades with the count and the fill rises',
            snd.ev > 100 && snd.evBad === 0 && snd.tailMin < 0.2 && Math.abs(snd.fillMax - snd.full) < 0.002,
            JSON.stringify({ ev: snd.ev, bad: snd.evBad, tailMin: snd.tailMin, fillMax: snd.fillMax, allBelow: snd.full }));
    s.check('SOUND: poured sand lands in the top bulb (its events marked so)', snd.evTop > 0, snd.evTop + ' events');
    s.check('SOUND: knowingly silent in Real sand: the bed\'s thumps, slams and slides, and so the landing buzz',
            snd.thump === 0 && snd.slam === 0 && snd.slides === 0 && snd.buzz10 === 0, JSON.stringify({ thump: snd.thump, slam: snd.slam, slides: snd.slides, buzz: snd.buzz10 }));
    s.check('POUR: the GPU sand takes the pour: the time is remAt(topAt(rem) + made) to 1e-6, the ledger rises by made, the GPU by the appended points',
            p.made > 30 && Math.abs(p.got - p.want) < 1e-6 && p.top === p.made && p.total === p.made && p.appended === p.ptsWant, JSON.stringify(p));
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(700);
    var ff0 = await t.eval(function () { return { ff: __mon.ff.length, xfer: window.Hourglass.realSand.stats().n.transfers }; });
    await t.eval(function () { window.__hide(true); });
    await sleep(3000);
    await t.eval(function () { window.__hide(false); });
    await sleep(600);
    var c = await t.eval(function (a) {
      var Hg = window.Hourglass, rs = Hg.realSand, au = rs.audit();
      return { ff: __mon.ff.slice(a.ff), xfer: rs.stats().n.transfers - a.xfer, live: Hg.sim === rs, audit: au };
    }, ff0);
    s.check('HIDDEN: back from 3 s hidden (no frames), the catch-up moves what is owed by a transfer, the GPU sand still the sim',
            c.ff.length >= 1 && c.ff.every(function (x) { return !x.motionRecent && x.n > 0; }) && c.xfer >= 1 && c.live, JSON.stringify(c));
    await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand, cf = rs.completeFlip;
      window.__swap = null;
      rs.completeFlip = function () {
        var before = { top: rs.nTop, total: rs.total, parity: rs.valve.parity };
        var r = cf.apply(rs, arguments);
        window.__swap = { before: before, after: { top: rs.nTop, total: rs.total, parity: rs.valve.parity }, want: Hg.remAt(before.total - before.top) };
        requestAnimationFrame(function () { window.__swap.rem = Hg.timer.rem; });
        return r;
      };
    });
    await sleep(1500);
    await t.page.tap('#btn-flip');
    await waitFor(t, function () { return !window.Hourglass.flip.active && !!window.__swap && window.__swap.rem !== undefined; }, 6000);
    var f = await t.eval(function () { delete window.Hourglass.realSand.completeFlip; return { swap: window.__swap, flips: window.__mockEnv.solver.flips, state: window.Hourglass.timer.state }; });
    s.check('FLIP: the swap turns the ledger at once (nTop = total - nTop), the GPU by its next run\'s flip pass, and the time is remAt of it (within a frame)',
            f.swap.after.top === f.swap.before.total - f.swap.before.top && f.swap.after.parity !== f.swap.before.parity && f.flips >= 1 &&
            Math.abs(f.swap.rem - f.swap.want) < 40 && f.state === 'running', JSON.stringify(f));
    var e2 = await runToEnd(t, 20000);
    s.check('POUR, HIDDEN, FLIP: the glass still ends on time: last point within 30 ms of 00:00.0, nTop 0 within 3 frames after, never before',
            e2.done && e2.d >= -5 && e2.d <= 30 && e2.frames >= 0 && e2.frames <= 3 && e2.early === 0, fmtEnd(e2));

    /* ---- SWAP FRAME ------------------------------------------------------- */
    // the GPU's work held (two frames in flight, every run skipped): at the swap the CSS rotor has
    // turned back by pi, and the canvas, still holding the picture from before, is turned by CSS
    var sw = await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand, e = window.__mockEnv, c = document.getElementById('c-gpu');
      var turns0 = rs.stats().n.cssTurns, skips0 = rs.stats().n.skips, flips0 = __mon.flips;
      return new Promise(function (res) {
        Hg.flipNow();
        var held = false, out = { turns0: turns0 };
        (function w() {
          if (!held && Hg.sim.angle && Math.abs(Hg.sim.angle) > 2.6) { held = true; e.hold = true; }
          if (held && __mon.flips > flips0 && out.during === undefined) {
            out.during = c.style.transform; out.skipped = rs.stats().n.skips - skips0;
            setTimeout(function () {
              out.stillDuring = c.style.transform;
              e.hold = false;
              setTimeout(function () { out.after = c.style.transform; out.turns = rs.stats().n.cssTurns - turns0; out.flipActive = Hg.flip.active; res(out); }, 1500);
            }, 200);
            return;
          }
          requestAnimationFrame(w);
        })();
      });
    });
    s.check('SWAP FRAME: runs skipped at the swap turn #c-gpu by CSS (rotate(180deg)) until the run with the flip pass, which turns it back',
            sw.during === 'rotate(180deg)' && sw.stillDuring === 'rotate(180deg)' && sw.after === '' && sw.turns >= 1 && sw.skipped >= 1, JSON.stringify(sw));

    /* ---- LOSS ------------------------------------------------------------- */
    await t.eval(function () { window.Hourglass.reset(); });
    await waitFor(t, function () { return !document.getElementById('app').classList.contains('sweep'); }, 5000);
    await sleep(300);
    await record(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(2500);
    var L = await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand, cpu = null;
      var before = { top: rs.nTop, total: rs.total, rem: Hg.timer.rem, tick: Hg.timer.lastTick };
      window.__mockEnv.device.loseIt('unknown', 'a mock loss');
      // (microtasks only: the device's lost promise is answered before these, and no frame runs between)
      return Promise.resolve().then(function () {}).then(function () {}).then(function () {
        cpu = Hg.sim;
        return { before: before, cpu: cpu instanceof window.HourglassPhysics.Sim, top: cpu.nTop, total: cpu.total, rem: Hg.timer.rem, tick: Hg.timer.lastTick,
          real: document.getElementById('app').classList.contains('real'), toast: document.getElementById('toast').textContent,
          note: document.getElementById('realsand-note').textContent, hooks0: __mon.hooks };
      });
    });
    s.check('LOSS: the CPU Sim is the sim in the same frame, at the ledger\'s counts; the clock untouched; #c-sand back',
            L.cpu && !L.real && L.top === L.before.top && L.total === L.before.total && L.rem === L.before.rem && L.tick === L.before.tick, JSON.stringify(L));
    s.check('LOSS: the toast and the note say Real sand paused: the graphics chip was reset',
            L.toast === 'Real sand paused: the graphics chip was reset' && L.note === 'Real sand paused: the graphics chip was reset', JSON.stringify([L.toast, L.note]));
    // (and the monitor has looked since: it hooks a new sim at its next frame)
    await waitFor(t, function () { var Hg = window.Hourglass; return Hg.sim === Hg.realSand && __mon.sim === Hg.sim; }, 8000);
    var back = await t.eval(function () {
      var Hg = window.Hourglass, st = Hg.realSand.stats();
      return { note: document.getElementById('realsand-note').textContent, real: document.getElementById('app').classList.contains('real'),
        rebuilds: st.n.rebuilds, losses: st.n.losses, hooks: __mon.hooks, creates: window.__mockEnv.creates, state: Hg.timer.state };
    });
    s.check('LOSS: the engine rebuilds (a new device) and takes the sand back; "On"; the monitor followed the sim each way',
            back.note === 'On' && back.real && back.rebuilds === 1 && back.losses === 1 && back.hooks >= 4 && back.creates === 1 && back.state === 'running', JSON.stringify(back));
    var rows = await t.eval(function () { return __rec.out.slice(); });
    var cpuFrames = rows.filter(function (q) { return q[7] === 0; }).length;
    await waitFor(t, function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, 20000);
    await sleep(300);
    var e3 = endOf(await t.eval(function () { return __rec.stop(); }));
    s.check('LOSS: the glass still ends on time on the GPU sand: last point within 30 ms of 00:00.0, nTop 0 within 3 frames after, never before',
            e3.done && e3.d >= -5 && e3.d <= 30 && e3.frames >= 0 && e3.frames <= 3 && e3.early === 0, fmtEnd(e3) + '; ' + cpuFrames + ' frames on the CPU sand');
    await H.invariants(s, t, 'MOCK');
    var au = await t.eval(function () { return __mon.audits; });
    s.check('MOCK: the census ran through the engine\'s audit() (the GPU\'s readback against the ledger)', au > 20, au + ' audits');
  } finally { await t.close(); }
}

async function testFail(s, env) {
  var t = await openMock(env, { failStart: 'selftest' });
  try {
    await waitFor(t, function () { return /Could not start|Did not start/.test(document.getElementById('realsand-note').textContent); }, 15000);
    var st = await state(t);
    s.check('FAIL: a start failure of the second kind: the CPU sand, no engine or canvas left, the setting kept, the note says why',
            st.cpu && !st.engine && !st.gpu && !st.real && st.setting === true && st.fails === 1 && st.checked && !st.disabled &&
            st.note === 'Could not start this time: its self-test failed. It will try again next launch', JSON.stringify(st));
    for (var i = 0; i < 2; i++) {
      await t.reload();
      await waitFor(t, function () { return /Could not start|Did not start/.test(document.getElementById('realsand-note').textContent); }, 15000);
    }
    st = await state(t);
    s.check('FAIL: three launches in a row: "Did not start 3 times", the setting still kept',
            st.fails === 3 && st.setting === true && st.note === 'Did not start 3 times: its self-test failed. Turn it off and on to try again', JSON.stringify(st));
    await t.reload();
    await sleep(1500);
    st = await state(t);
    s.check('FAIL: ... and the next launch does not try: nothing under realsand/ is requested', st.requested.length === 0 && st.fails === 3 &&
            st.note === 'Did not start 3 times: its self-test failed. Turn it off and on to try again', JSON.stringify(st));
    var loads = 0;
    t.page.on('load', function () { loads++; });
    await t.page.$eval('#opt-realsand', function (el) { el.click(); });
    await waitFor(t, function () { return !!window.Hourglass && !!window.__mon && __mon.hooked; }, 10000).catch(function () {});
    await sleep(1500);
    st = await state(t);
    s.check('FAIL: off again: the page reloads, the count is cleared, nothing is loaded', loads >= 1 && st.setting === false && st.fails === 0 && st.requested.length === 0 &&
            st.note === 'Each grain simulated on the graphics chip. Uses more battery.', JSON.stringify({ loads: loads, st: st }));
    await H.invariants(s, t, 'FAIL');
  } finally { await t.close(); }
}

async function testStamp(s, env) {
  var t = await openMock(env, { build: 'an-older-one' });
  try {
    await waitFor(t, function () { return /updating/.test(document.getElementById('realsand-note').textContent); }, 15000);
    await sleep(500);
    var st = await state(t);
    s.check('STAMP: a build stamp other than app.js\'s: "Real sand is updating", the CPU sand, no engine, the setting kept, no failure counted',
            st.note === 'Real sand is updating; it will be back at the next launch' && st.cpu && !st.engine && !st.gpu && st.setting === true && !st.fails, JSON.stringify(st));
    await H.invariants(s, t, 'STAMP');
  } finally { await t.close(); }
}

async function testAgain(s, env) {
  var t = await openMock(env, { failStart: 'hidden', failTimes: 1 });
  try {
    await waitFor(t, function () { var Hg = window.Hourglass; return !!Hg.realSand && Hg.sim === Hg.realSand; }, 20000);
    var st = await state(t), n = await t.eval(function () { return { creates: window.__mockEnv.creates, starts: window.__mockEnv.starts }; });
    s.check('AGAIN: a start cut short by the page being hidden is tried again once it is in view, and takes over; no failure counted',
            st.live && st.note === 'On' && st.setting === true && !st.fails && n.creates === 2 && n.starts === 2, JSON.stringify({ st: st.note, fails: st.fails, n: n }));
    await H.invariants(s, t, 'AGAIN');
  } finally { await t.close(); }
}

async function main() {
  var s = new H.Suite('app-realsand');
  var env = await H.start();
  try {
    var only = env.args.only;
    var cases = { off: testOff, nogpu: testNoGpu, mock: testMock, fail: testFail, stamp: testStamp, again: testAgain };
    for (var k in cases) {
      if (only && only !== k) continue;
      try { await cases[k](s, env); } catch (e) {
        s.check(k.toUpperCase() + ': no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
      }
    }
  } finally {
    await env.close();
  }
  s.done();
}
main();
