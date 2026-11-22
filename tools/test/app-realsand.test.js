#!/usr/bin/env node
/*
 * Real sand in the app (design 13.2), in the browser harness, which has no WebGPU adapter.
 *
 *  OFF   the switch off (the default): nothing under realsand/ is requested (by the page's own
 *        record, and at the network through a route, also after a run, Tune, a theme, layered
 *        sand and a Reset; NOGPU's same route is the control), no engine, the CPU Sim is the
 *        sim; the row "Real sand" sits in the Material group after Grain, off, with its note;
 *        Tune has 10 rows.
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
 *  SLOW  a cold start as slow as the owner's iPhone's in a home-screen web app (Gate A: 3.4 s to
 *        the engine's first frame; here 4 s): the CPU sand shows and runs meanwhile, the boot veil
 *        is not held for it, the canvases cross-fade only once the engine has drawn, the clock
 *        runs on through the handover untouched, no failure is counted, the glass ends on time;
 *        ?debug=sand shows, and its copied report holds, the start-up times and the first fall.
 *  WAKE  Gate A's 4-minute glass ended 7 minutes late: the lab held no screen wake lock and had no
 *        catch-up. With the GPU sand running the app holds its wake lock (a stand-in for the
 *        browser's, which a headless Chromium refuses), lets it go while hidden and takes it back
 *        on return; every gap is caught up by a transfer, also one that runs past the end. The
 *        stream's first fall (Gate A: slow in a home-screen web app and in the hand) is in
 *        ?debug=sand's overlay and report.
 *  LIFE  losses of the graphics chip (design 7.9): one while hidden (a lock or an app switch) is
 *        silent and rebuilt once the page is back; one in view shows the toast and is rebuilt
 *        after 2 s; a second such loss within 10 minutes leaves the CPU sand for the session,
 *        with the note, the setting kept and nothing counted; the clock is untouched each time.
 *  NOREBUILD a rebuild that cannot open a device: the CPU sand stays, the note says it will try
 *        again next launch, nothing is counted, and the next launch takes over again.
 *  CRASH the glass does not crack with Real sand on (owner's choice: crash waits for a later
 *        stage): a drop that cracks the CPU sand's glass (the control, switch off) only thumps and
 *        clacks on the GPU sand, and quick knocks creak nothing; a crack from before the switch was
 *        turned on stays, leaks nothing and can be mended; Reset makes the glass whole. The theme
 *        and the layers switch while the GPU sand is live: the grains take the Renderer's new
 *        colours, and the layers' re-tone is a transfer that moves no grain.
 *
 *   node tools/test/app-realsand.test.js [--port 8905] [--only slow]
 */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./stubs/harness.js');
var sleep = H.sleep;
var KEY = 'hourglass.settings.v1';
var PLANT = fs.readFileSync(path.join(__dirname, 'lib', 'realsand-plant.js'), 'utf8');
var MOCK = fs.readFileSync(path.join(__dirname, 'stubs', 'realsand-mock-boot.mjs'), 'utf8');
var ENGINE_BUILD = (/export const BUILD = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'realsand', 'build.mjs'), 'utf8')) || [])[1];

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
  // a screen wake lock that is granted (a headless Chromium refuses the real one): how many are held
  if (arg.wake) {
    var W = window.__wake = { held: 0, requests: 0, releases: 0 };
    var api = { request: function () {
      W.requests++; W.held++;
      var lock = new EventTarget();
      lock.type = 'screen'; lock.released = false;
      lock.release = function () {
        if (!lock.released) { lock.released = true; W.held--; W.releases++; lock.dispatchEvent(new Event('release')); }
        return Promise.resolve();
      };
      return Promise.resolve(lock);
    } };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, get: function () { return api; } });
  }
}
function mockRoute() {
  return { url: '**/realsand/boot.mjs', handler: function (route) {
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: MOCK });
  } };
}
function openMock(env, mock, settings, o) {
  return env.open({ storage: { 'hourglass.settings.v1': Object.assign({ realSand: true, durationMs: 10000 }, settings || {}) },
    init: pageInit, initArg: { plant: PLANT, mock: mock || {}, wake: !!(o && o.wake) }, routes: [mockRoute()], query: o && o.query });
}
/** Wait until the GPU sand is the app's sim and the monitor follows it. */
function waitLive(t, ms) {
  return waitFor(t, function () { var Hg = window.Hourglass; return !!Hg.realSand && Hg.sim === Hg.realSand && __mon.sim === Hg.sim; }, ms || 20000);
}
/** What ?debug=sand shows (its overlay) and what its "copy the report" copies (Hourglass.realSandReport). */
function debugReport(t) {
  return t.eval(function () {
    var r = JSON.parse(window.Hourglass.realSandReport()), el = document.getElementById('debug-sand');
    var F = r.stats && r.stats.fall, tm = r.stats && r.stats.times;
    return { overlay: el ? el.textContent : null, copy: !!el && /copy the report/.test(el.textContent),
      fall: F && F.log && F.log[0], times: tm && { device: tm.device, pipelines: tm.pipelines, selfTest: tm.selfTest, firstFrame: tm.firstFrame },
      started: (r.log || []).filter(function (l) { return /started in|first frame/.test(l); }).length,
      fallLogged: (r.log || []).filter(function (l) { return /first fall/.test(l); }).length, live: r.live, build: r.build };
  });
}
/** Every toast the page shows from now on (its text, each time it is set). */
function watchToasts(t) {
  return t.eval(function () {
    var el = document.getElementById('toast'), out = window.__toasts = [];
    new MutationObserver(function () { out.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}
/** The device lost now; read back after the microtasks that answer it (no frame runs between). */
function loseNow(t, why) {
  return t.eval(function (why) {
    var Hg = window.Hourglass, rs = Hg.realSand;
    var before = { top: Hg.sim.nTop, total: Hg.sim.total, rem: Hg.timer.rem, tick: Hg.timer.lastTick, live: Hg.sim === rs };
    window.__mockEnv.device.loseIt('unknown', why);
    return Promise.resolve().then(function () {}).then(function () {}).then(function () {
      var sim = Hg.sim;
      return { before: before, cpu: sim instanceof window.HourglassPhysics.Sim, top: sim.nTop, total: sim.total, rem: Hg.timer.rem,
        tick: Hg.timer.lastTick, real: document.getElementById('app').classList.contains('real'),
        note: document.getElementById('realsand-note').textContent, toasts: window.__toasts.slice() };
    });
  }, why);
}
function untouched(L) {
  return L.cpu && !L.real && L.before.live && L.top === L.before.top && L.total === L.before.total && L.rem === L.before.rem && L.tick === L.before.tick;
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

/** Every request the page makes under realsand/, at the network (a route set before the page loads). */
function realsandRequests() {
  var hits = [];
  return { hits: hits, route: { url: '**/realsand/**', handler: function (route) { hits.push(new URL(route.request().url()).pathname); route.continue(); } } };
}

async function testOff(s, env) {
  var net = realsandRequests();
  var t = await env.open({ routes: [net.route] });
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
    // the glass run, Tune opened, a theme and layered sand chosen, a Reset: still nothing of the engine
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    await t.page.tap('#btn-settings');
    await sleep(500);
    await t.eval(function () { window.Hourglass.setTheme('lapis'); });
    await t.page.$eval('#opt-layers', function (el) { el.click(); });
    await sleep(800);
    await t.eval(function () { window.Hourglass.reset(); });
    await sleep(1600);
    st = await state(t);
    s.check('OFF: at the network too, after a run, Tune, a theme, layered sand and a Reset: no request under realsand/ (NOGPU, switch on, is the control)',
            net.hits.length === 0 && st.requested.length === 0 && !st.engine, JSON.stringify(net.hits));
    await H.invariants(s, t, 'OFF');
  } finally { await t.close(); }
}

async function testNoGpu(s, env) {
  var net = realsandRequests();
  var t = await env.open({ storage: { 'hourglass.settings.v1': { realSand: true } }, routes: [net.route] });
  try {
    await waitFor(t, function () { return document.getElementById('realsand-row').classList.contains('na'); }, 15000);
    var st = await state(t);
    s.check('NOGPU: the engine is loaded (boot.mjs and its modules, seen by the page and at the network) and does not start: this Chromium has no adapter',
            st.requested.indexOf('/realsand/boot.mjs') >= 0 && st.requested.indexOf('/realsand/app-sand.mjs') >= 0 && !st.engine &&
            net.hits.indexOf('/realsand/boot.mjs') >= 0 && net.hits.indexOf('/realsand/app-sand.mjs') >= 0, st.requested.length + ' requested, ' + net.hits.length + ' at the network');
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

async function testSlow(s, env) {
  // Gate A: in a home-screen web app the pipelines took 2.8 s and the first frame came 3.4 s after
  // the page began (0.6 s in Chrome). Here the engine's start() is held 4 s before it begins.
  var t = await openMock(env, { seed: 9, startDelay: 4000 }, {}, { query: '?debug=sand' });
  try {
    await t.eval(function () { window.Hourglass.start(); });
    await t.eval(function () {
      __rec.start(function (Hg) {
        var e = window.__mockEnv, pl = e && e.solver && e.solver.plant;
        return [Date.now(), Hg.timer.state, Hg.timer.rem, Hg.timer.lastTick, Hg.sim.nTop, pl ? pl.above : -1,
          pl ? pl.lastCrossT : NaN, Hg.sim === Hg.realSand ? 1 : 0, e ? e.V.frame : 0];
      }, { frame: true });
    });
    await sleep(2500);
    var mid = await t.eval(function () {
      var Hg = window.Hourglass, cg = document.getElementById('c-gpu'), rs = Hg.realSand;
      var st = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
      return { note: document.getElementById('realsand-note').textContent, cpu: Hg.sim instanceof window.HourglassPhysics.Sim,
        engine: !!rs, starts: window.__mockEnv.starts, ready: !!(rs && rs.ready), real: document.getElementById('app').classList.contains('real'),
        sand: getComputedStyle(document.getElementById('c-sand')).opacity, gpu: cg ? getComputedStyle(cg).opacity : 'none',
        veil: +getComputedStyle(document.getElementById('veil')).opacity, state: Hg.timer.state, top: Hg.sim.nTop, total: Hg.sim.total,
        fails: st.realSandFails | 0 };
    });
    s.check('SLOW: 2.5 s into a 4 s start: the CPU sand is the sim, shown, and running (grains through the neck); "Starting…"; the engine not ready',
            mid.cpu && mid.engine && mid.starts === 1 && !mid.ready && !mid.real && mid.sand === '1' && (mid.gpu === 'none' || mid.gpu === '0') &&
            mid.state === 'running' && mid.top < mid.total && mid.note === 'Starting…', JSON.stringify(mid));
    s.check('SLOW: the boot veil is not held for the engine: it has lifted', mid.veil < 0.02, 'veil opacity ' + mid.veil);
    // the handover, seen from inside the page: the frame it happens in, and the canvases 150 ms and 700 ms on
    var ho = await t.eval(function () {
      var Hg = window.Hourglass, t0 = performance.now();
      return new Promise(function (res) {
        (function w() {
          if (performance.now() - t0 > 15000) { res(null); return; }
          if (Hg.sim === Hg.realSand) {
            var rs = Hg.realSand, cg = document.getElementById('c-gpu'), cs = document.getElementById('c-sand');
            var out = { after: performance.now() - t0, ready: rs.ready, draws: window.__mockEnv.grains.draws,
              firstFrame: rs.stats().times.firstFrame, page: performance.now() };
            setTimeout(function () {
              out.gpuMid = +getComputedStyle(cg).opacity; out.sandMid = +getComputedStyle(cs).opacity;
              setTimeout(function () { out.gpuEnd = +getComputedStyle(cg).opacity; out.sandEnd = +getComputedStyle(cs).opacity; res(out); }, 550);
            }, 150);
            return;
          }
          requestAnimationFrame(w);
        })();
      });
    });
    s.check('SLOW: the sand changes hands only once the engine has drawn its first frame (ready, its picture drawn)',
            !!ho && ho.ready && ho.draws >= 1 && ho.firstFrame > 4000, JSON.stringify(ho));
    s.check('SLOW: the canvases cross-fade: 150 ms after the handover both are part-way, 700 ms after the GPU sand is shown and the CPU sand gone',
            !!ho && ho.gpuMid > 0.05 && ho.gpuMid < 0.95 && ho.sandMid > 0.05 && ho.sandMid < 0.95 && ho.gpuEnd === 1 && ho.sandEnd === 0, JSON.stringify(ho));
    var e = await t.eval(function () {
      return new Promise(function (res) {
        (function w() {
          var Hg = window.Hourglass;
          if (Hg.timer.state === 'done' && Hg.sim.nTop === 0) { setTimeout(function () { res(__rec.stop()); }, 300); return; }
          requestAnimationFrame(w);
        })();
      });
    });
    // the clock through the handover: the end it foresees (lastTick + rem) does not move, from a
    // second before the handover to a second after it, and over the whole run
    var k0 = -1, near = 0, all = 0;
    for (var i = 0; i < e.length; i++) if (e[i][7] === 1) { k0 = i; break; }
    for (i = 1; i < e.length; i++) {
      if (e[i][1] !== 'running' || e[i - 1][1] !== 'running') continue;
      var d = Math.abs((e[i][3] + e[i][2]) - (e[i - 1][3] + e[i - 1][2]));
      all = Math.max(all, d);
      if (Math.abs(i - k0) <= 60) near = Math.max(near, d);
    }
    s.check('SLOW: the clock runs on through the handover untouched (the end it foresees moves by less than 1 ms, a second either side of it)',
            k0 > 60 && near < 1, 'handover at frame ' + k0 + '; the end moved by ' + near.toFixed(2) + ' ms near it, ' + all.toFixed(2) + ' ms at most over the run');
    var end = endOf(e.slice(k0));
    s.check('SLOW: the glass begun on the CPU sand ends on the GPU sand on time: last point within 30 ms of 00:00.0, nTop 0 within 3 frames after, never before',
            end.done && end.liveAll && end.d >= -5 && end.d <= 30 && end.frames >= 0 && end.frames <= 3 && end.early === 0, fmtEnd(end));
    var st = await state(t);
    s.check('SLOW: a slow start is not a failure: "On", the setting kept, nothing counted', st.note === 'On' && st.setting === true && !st.fails && !st.why,
            JSON.stringify({ note: st.note, setting: st.setting, fails: st.fails, why: st.why }));
    // what the owner sends back from the phone (?debug=sand): the start-up times, in the overlay
    // and in the copied report, with the engine's log
    var rep = await debugReport(t);
    s.check('SLOW: ?debug=sand: the overlay shows the start-up times, and the copied report holds them (device, pipelines, self-test, first frame: here after 4 s) with the engine\'s log',
            !!rep.overlay && /first frame/.test(rep.overlay) && rep.copy && !!rep.times && rep.times.pipelines >= 0 && rep.times.selfTest >= 0 &&
            rep.times.firstFrame > 4000 && rep.started >= 1 && rep.live === true && rep.build === ENGINE_BUILD, JSON.stringify(rep.times) + ', ' + rep.started + ' log lines of the start');
    await H.invariants(s, t, 'SLOW');
  } finally { await t.close(); }
}

async function testWake(s, env) {
  var t = await openMock(env, { seed: 21 }, {}, { wake: true, query: '?debug=sand' });
  try {
    await waitLive(t);
    await sleep(400);
    var w0 = await t.eval(function () { return { held: window.__wake.held, state: window.Hourglass.wakeState() }; });
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(700);
    var w1 = await t.eval(function () { var Hg = window.Hourglass; return { held: window.__wake.held, state: Hg.wakeState(), live: Hg.sim === Hg.realSand, run: Hg.timer.state }; });
    s.check('WAKE: the GPU sand running holds the screen wake lock (none while the glass stood idle)',
            w0.held === 0 && w1.held === 1 && w1.state === 'active' && w1.live && w1.run === 'running', JSON.stringify({ idle: w0, running: w1 }));
    // the stream's first fall from the neck to the floor of an empty lower bulb (Gate A: 0.83 s in a
    // home-screen web app and 1.03 s in the hand, 0.42-0.45 s elsewhere), for the owner's reports
    await sleep(600);
    var rep = await debugReport(t), f0 = rep.fall || {};
    s.check('WAKE: ?debug=sand: the stream\'s first fall is in the overlay and in the copied report (simulated and wall time, mode and rate) and the engine\'s log',
            !!rep.overlay && /first fall \d/.test(rep.overlay) && rep.copy && f0.s >= 0 && f0.wall >= 0 && !!f0.mode && f0.hz >= 480 && rep.fallLogged === 1,
            JSON.stringify({ fall: rep.fall, logged: rep.fallLogged, overlay: rep.overlay && rep.overlay.split('\n')[3] }));
    var gaps = [];
    for (var g = 0; g < 2; g++) {
      var a = await t.eval(function () { return { ff: __mon.ff.length, xfer: window.Hourglass.realSand.stats().n.transfers }; });
      await t.eval(function () { window.__hide(true); });
      await sleep(g ? 1500 : 2000);
      var hid = await t.eval(function () { return window.__wake.held; });
      await t.eval(function () { window.__hide(false); });
      await sleep(900);
      gaps.push(await t.eval(function (a) {
        var Hg = window.Hourglass, rs = Hg.realSand;
        return { ff: __mon.ff.slice(a.ff).map(function (x) { return x.n; }), xfer: rs.stats().n.transfers - a.xfer, held: window.__wake.held,
          live: Hg.sim === rs, audit: rs.audit().ok, run: Hg.timer.state };
      }, a));
      gaps[g].hidden = hid;
    }
    s.check('WAKE: hidden, the lock is let go; back in view, it is held again',
            gaps.every(function (x) { return x.hidden === 0 && x.held === 1; }), JSON.stringify(gaps));
    s.check('WAKE: every gap is caught up: each return moves what is owed (the catch-up\'s fastForward) by one transfer, the GPU sand still the sim',
            gaps.every(function (x) { return x.ff.length === 1 && x.ff[0] > 0 && x.xfer === 1 && x.live && x.audit && x.run === 'running'; }), JSON.stringify(gaps));
    // a gap that runs past the end: back in view the glass is done and its sand is all below
    var a3 = await t.eval(function () { var Hg = window.Hourglass; return { ff: __mon.ff.length, xfer: Hg.realSand.stats().n.transfers, rem: Hg.timer.rem }; });
    await t.eval(function () { window.__hide(true); });
    await sleep(a3.rem + 2000);
    await t.eval(function () { window.__hide(false); });
    await waitFor(t, function () { var Hg = window.Hourglass; return Hg.timer.state === 'done' && Hg.sim.nTop === 0 && window.__mockEnv.solver.plant.above === 0; }, 6000).catch(function () {});
    var g3 = await t.eval(function (a) {
      var Hg = window.Hourglass, rs = Hg.realSand, pl = window.__mockEnv.solver.plant;
      return { run: Hg.timer.state, top: Hg.sim.nTop, above: pl.above, below: pl.below, total: Hg.sim.total, pts: rs.valve.Pts(Hg.sim.total),
        xfer: rs.stats().n.transfers - a.xfer, ff: __mon.ff.slice(a.ff).map(function (x) { return x.n; }), live: Hg.sim === rs, audit: rs.audit().ok };
    }, a3);
    s.check('WAKE: a gap past the end: back in view the glass is done, nothing above (ledger and GPU), every point below, through a transfer',
            g3.run === 'done' && g3.top === 0 && g3.above === 0 && g3.below === g3.pts && g3.xfer >= 1 && g3.ff.length >= 1 && g3.live && g3.audit, JSON.stringify(g3));
    await H.invariants(s, t, 'WAKE');
  } finally { await t.close(); }
}

async function testLife(s, env) {
  var t = await openMock(env, { seed: 31 }, { durationMs: 30000 });
  try {
    await waitLive(t);
    await watchToasts(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    // a loss while the page is hidden: a lock or an app switch
    await t.eval(function () { window.__hide(true); });
    await sleep(300);
    var A = await loseNow(t, 'mock: the app was put away');
    s.check('LIFE: lost while hidden: the CPU Sim is the sim in the same frame, at the ledger\'s counts, the clock untouched',
            untouched(A), JSON.stringify(A));
    await sleep(1000);
    var hiddenNow = await t.eval(function () { return { live: window.Hourglass.sim === window.Hourglass.realSand, rebuilds: window.Hourglass.realSand.stats().n.rebuilds }; });
    await t.eval(function () { window.__hide(false); });
    await waitLive(t, 8000);
    var A2 = await t.eval(function () {
      var Hg = window.Hourglass, st = Hg.realSand.stats();
      return { note: document.getElementById('realsand-note').textContent, toasts: window.__toasts.slice(), rebuilds: st.n.rebuilds, losses: st.n.losses,
        devices: window.__mockEnv.devices, creates: window.__mockEnv.creates, run: Hg.timer.state };
    });
    s.check('LIFE: ... silently (no toast, "Starting…"); rebuilt only once the page is back, and the GPU sand takes over again: "On"',
            A.note === 'Starting…' && A.toasts.length === 0 && A2.toasts.length === 0 && !hiddenNow.live && hiddenNow.rebuilds === 0 &&
            A2.note === 'On' && A2.rebuilds === 1 && A2.losses === 1 && A2.devices === 2 && A2.creates === 1 && A2.run === 'running',
            JSON.stringify({ lost: A.note, hidden: hiddenNow, back: A2 }));
    // a loss in view (not around a lock or an app switch): the toast, then rebuilt after 2 s
    await sleep(1500);
    var B = await loseNow(t, 'mock: the graphics chip was reset');
    var tB = Date.now();
    await waitLive(t, 8000);
    var B2 = await t.eval(function () { var st = window.Hourglass.realSand.stats(); return { note: document.getElementById('realsand-note').textContent, rebuilds: st.n.rebuilds, losses: st.n.losses }; });
    var backMs = Date.now() - tB;
    s.check('LIFE: lost in view: the CPU sand in the same frame, the clock untouched, the toast and the note say Real sand paused',
            untouched(B) && B.toasts.indexOf('Real sand paused: the graphics chip was reset') >= 0 && B.note === 'Real sand paused: the graphics chip was reset', JSON.stringify(B));
    s.check('LIFE: ... and it comes back after 2 s: "On"', B2.note === 'On' && B2.rebuilds === 2 && B2.losses === 2 && backMs >= 1900,
            JSON.stringify(B2) + ', back after ' + backMs + ' ms');
    // a second loss in view within 10 minutes: final for this session
    await sleep(1500);
    var C = await loseNow(t, 'mock: reset again');
    await sleep(4000);
    var C2 = await t.eval(function () {
      var Hg = window.Hourglass, st = Hg.realSand.stats(), S = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
      return { note: document.getElementById('realsand-note').textContent, cpu: Hg.sim instanceof window.HourglassPhysics.Sim, rebuilds: st.n.rebuilds,
        devices: window.__mockEnv.devices, setting: S.realSand, fails: S.realSandFails | 0, run: Hg.timer.state, top: Hg.sim.nTop };
    });
    var FINAL = 'Paused after the graphics chip was reset twice; it will try again next launch';
    s.check('LIFE: a second loss in view within 10 minutes: the CPU sand, the clock untouched, the toast and the note say it is paused until the next launch',
            untouched(C) && C.note === FINAL && C.toasts.indexOf(FINAL) >= 0, JSON.stringify(C));
    s.check('LIFE: ... no rebuild (4 s on), the CPU sand runs on, the setting kept and nothing counted',
            C2.note === FINAL && C2.cpu && C2.rebuilds === 2 && C2.devices === 3 && C2.setting === true && C2.fails === 0 && C2.run === 'running' &&
            C2.top < C.top, JSON.stringify(C2));
    await H.invariants(s, t, 'LIFE');
  } finally { await t.close(); }
}

async function testNoRebuild(s, env) {
  var t = await openMock(env, { seed: 41 }, { durationMs: 30000 });
  try {
    await waitLive(t);
    await watchToasts(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    await t.eval(function () { window.__mockEnv.failDevice = true; });
    var L = await loseNow(t, 'mock: reset');
    var MSG = 'Real sand could not restart after the graphics chip was reset; it will try again next launch';
    await waitFor(t, function (m) { return document.getElementById('realsand-note').textContent === m; }, 8000, MSG).catch(function () {});
    var st = await state(t), n = await t.eval(function () { var Hg = window.Hourglass; return { rebuilds: Hg.realSand.stats().n.rebuilds, run: Hg.timer.state }; });
    s.check('NOREBUILD: the rebuild finds no device: the CPU sand stays (taken over in the frame of the loss), the note says it will try again next launch',
            untouched(L) && st.cpu && !st.live && !st.real && st.note === MSG && n.rebuilds === 1 && n.run === 'running', JSON.stringify({ L: L, note: st.note, n: n }));
    s.check('NOREBUILD: ... the setting kept, nothing counted', st.setting === true && !st.fails && st.checked && !st.disabled, JSON.stringify(st));
    await t.reload();
    await waitLive(t);
    st = await state(t);
    s.check('NOREBUILD: the next launch takes over again: "On"', st.live && st.note === 'On' && st.setting === true && !st.fails, JSON.stringify({ note: st.note, fails: st.fails }));
    await H.invariants(s, t, 'NOREBUILD');
  } finally { await t.close(); }
}

/** Lift the glass by its waist 280 px over 1.5 s, hold, let go: it falls and lands on the desk (replay-finger's drop from the top of its travel). */
async function dropGlass(t) {
  var g = await t.glass();
  await t.touch.down(g.cx, g.cy);
  await sleep(40);
  await t.touch.path(function (u) { var e = u * u * (3 - 2 * u); return { x: g.cx, y: g.cy - 280 * e }; }, 1500, false);
  await sleep(300);
  // every blow the glass takes, as the sim answers it (sim.impact: 0 a clink, 1 a creak or a thump, 2 a crack, 3 a breach)
  await t.eval(function () {
    var sim = window.Hourglass.sim, f = sim.impact, H = window.__hits = [];
    sim.impact = function (nx, ny, v) { var r = f.apply(sim, arguments); H.push([v, r]); return r; };
  });
  await t.touch.up();
  await sleep(1800);
  return t.eval(function () {
    var Hg = window.Hourglass, hard = [0, 0];
    delete Hg.sim.impact;
    window.__hits.forEach(function (h) { if (h[0] > hard[0]) hard = h; });
    return { hits: window.__hits.length, v: hard[0], grade: hard[1], cracks: Hg.sim.cracks.map(function (c) { return { L: c.L, sealed: !!c.sealed }; }) };
  });
}
/** Count what audio.js is asked to play for blows and damage, from now on. */
function spyBlows(t) {
  return t.eval(function () {
    var A = window.Hourglass.audio, B = window.__blows = { thump: 0, clack: 0, crack: 0, creak: 0, crackGrow: 0, mended: 0 };
    Object.keys(B).forEach(function (k) {
      var f = A[k];
      if (typeof f !== 'function' || f.__spied) return;
      A[k] = function () { window.__blows[k]++; return f.apply(this, arguments); };
      A[k].__spied = true;
    });
  });
}
var UPPER_SHOULDER = 6;           // a wall segment of the upper bulb (app-gestures.test.js)

async function testCrash(s, env) {
  // the switch off, with the mock engine served for when it is turned on
  var t = await openMock(env, { seed: 51 }, { realSand: false });
  try {
    await spyBlows(t);
    await t.eval(function () { window.Hourglass.start(); });
    var d0 = await dropGlass(t);
    var b0 = await t.eval(function () { return window.__blows; });
    s.check('CRASH (control, the CPU sand): the drop lands hard and cracks the glass, with its crack sound',
            d0.hits >= 1 && d0.v >= 920 && d0.grade >= 2 && d0.cracks.length === 1 && b0.crack === 1, JSON.stringify({ drop: d0, sounds: b0 }));
    // Real sand on: the page saves the session (the paused glass and its crack) and loads again
    await t.eval(function () { window.Hourglass.pause(); });
    await t.page.$eval('#opt-realsand', function (el) { el.click(); });
    await sleep(800);
    await t.page.waitForFunction(function () { return window.Hourglass && window.__mon && window.__mon.hooked; }, null, { timeout: 15000 });
    await waitLive(t);
    await sleep(800);
    await spyBlows(t);
    var c1 = await t.eval(function () {
      var Hg = window.Hourglass;
      return { cracks: Hg.sim.cracks.map(function (c) { return { L: c.L, sealed: !!c.sealed }; }), live: Hg.sim === Hg.realSand };
    });
    s.check('CRASH: a crack from before Real sand was turned on stays, open, as it was', c1.live && c1.cracks.length === 1 && !c1.cracks[0].sealed &&
            Math.abs(c1.cracks[0].L - d0.cracks[0].L) < 1e-6, JSON.stringify(c1));
    var d1 = await dropGlass(t);
    var b1 = await t.eval(function () { return window.__blows; });
    s.check('CRASH: on the GPU sand the same drop only thumps and clacks (impact 1): no new crack, the old one not grown, no crack or creak sound',
            d1.hits >= 1 && d1.v >= 920 && d1.grade === 1 && d1.cracks.length === 1 && Math.abs(d1.cracks[0].L - c1.cracks[0].L) < 1e-6 && !d1.cracks[0].sealed &&
            b1.thump >= 1 && b1.clack >= 1 && b1.crack === 0 && b1.crackGrow === 0 && b1.creak === 0, JSON.stringify({ drop: d1, sounds: b1 }));
    // quick knocks near one place (eight crack the CPU sand's glass: sim-knock, replay-finger)
    await t.eval(function () {
      var rs = window.Hourglass.realSand, k = rs.knock, K = window.__knocks = [];
      rs.knock = function () { var r = k.apply(rs, arguments); K.push(r); return r; };
    });
    var g = await t.glass();
    for (var i = 0; i < 10; i++) { await t.touch.tap(g.cx - 28, g.cy - 120, 50); await sleep(250); }
    await sleep(600);
    var k1 = await t.eval(function () {
      var Hg = window.Hourglass;
      delete Hg.realSand.knock;
      return { knocks: window.__knocks, cracks: Hg.sim.cracks.length, blows: window.__blows };
    });
    s.check('CRASH: ten quick knocks reach the GPU sand (knock answers -1) and creak and crack nothing',
            k1.knocks.length >= 8 && k1.knocks.every(function (r) { return r === -1; }) && k1.cracks === 1 && k1.blows.creak === 0 && k1.blows.crack === 0,
            JSON.stringify(k1));
    // the cracked glass runs: nothing leaks (the CPU Sim is not stepped; the GPU's glass has no breach)
    var counts = function () {
      var Hg = window.Hourglass, rs = Hg.realSand, pl = window.__mockEnv.solver.plant;
      return { total: Hg.sim.total, top: Hg.sim.nTop, spill: Hg.spill.count, lost: Hg.sim.lost, cpuLost: rs.cpu.lost, points: rs.valve.points,
        plant: pl.above + pl.below, state: Hg.timer.state };
    };
    var r0 = await t.eval(counts);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(2000);
    await t.eval(function () { window.Hourglass.pause(); });
    var r1 = await t.eval(counts);
    s.check('CRASH: a cracked glass leaks nothing on the GPU sand (2 s running: the grains, the spill and the GPU\'s points unchanged; sand ran)',
            r0.state === 'paused' && r1.total === r0.total && r1.spill === r0.spill && r1.lost === 0 && r1.cpuLost === 0 && r1.points === r0.points &&
            r0.plant === r0.points && r1.plant === r1.points && r1.top < r0.top, JSON.stringify({ before: r0, after: r1 }));
    // mending: a still press of 1.6 s on the glass (app-gestures' MEND)
    await t.eval(function () {
      var R = window.Hourglass.renderer, f = R.setMend;
      window.__mendMax = 0;
      R.setMend = function (p) { if (+p > window.__mendMax) window.__mendMax = +p; return f.apply(this, arguments); };
    });
    await sleep(500);
    g = await t.glass();
    await t.touch.down(g.cx, g.cy);
    await sleep(1600);
    await t.touch.up();
    await sleep(300);
    var m = await t.eval(function () {
      var Hg = window.Hourglass;
      delete Hg.renderer.setMend;
      return { cracks: Hg.sim.cracks.map(function (c) { return !!c.sealed; }), max: window.__mendMax, mended: window.__blows.mended, live: Hg.sim === Hg.realSand };
    });
    s.check('CRASH: the crack is mended on the GPU sand: sealed, the gold run to the end, the mend heard', m.live && m.cracks.length === 1 && m.cracks[0] && m.max === 1 && m.mended === 1,
            JSON.stringify(m));

    // the theme changed while the GPU sand is live: the grains take the Renderer's new colours
    var th = await t.eval(function () {
      var Hg = window.Hourglass, G = window.__mockEnv.grains, R = Hg.renderer, n0 = G.palettes, p0 = Array.from(G.pal);
      var want0 = Array.from(window.__mockEnv.paletteFromLUT(R.lut, R.isMica));
      Hg.setTheme('volcanic');
      var p1 = Array.from(G.pal), want1 = Array.from(window.__mockEnv.paletteFromLUT(R.lut, R.isMica));
      var same = function (a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); };
      return { calls: G.palettes - n0, before: same(p0, want0), after: same(p1, want1), changed: !same(p0, p1), n: p1.length };
    });
    s.check('CRASH (THEME): a theme chosen while the GPU sand runs: its grains take the Renderer\'s new table at once (and it is not the old one)',
            th.calls >= 1 && th.before && th.after && th.changed && th.n > 0, JSON.stringify(th));
    // the layers switch while the GPU sand is live (paused): the re-tone is a transfer that moves no grain
    var la0 = await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand, pl = window.__mockEnv.solver.plant;
      return { top: Hg.sim.nTop, total: Hg.sim.total, above: pl.above, below: pl.below, xfer: rs.stats().n.transfers, rem: Hg.timer.rem, layers: rs.cpu.layers };
    });
    await t.page.$eval('#opt-layers', function (el) { el.click(); });
    await sleep(1500);
    var la1 = await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand, pl = window.__mockEnv.solver.plant;
      var au = rs.audit();
      return { top: Hg.sim.nTop, total: Hg.sim.total, above: pl.above, below: pl.below, xfer: rs.stats().n.transfers, rem: Hg.timer.rem, layers: rs.cpu.layers,
        rsLayers: rs.layers, audit: au ? au.ok : 'no readback since', live: Hg.sim === rs, state: Hg.timer.state };
    });
    s.check('CRASH (LAYERS): layered sand turned on while the GPU sand is live: the CPU Sim lays its strata, the GPU re-tones by one transfer, no grain moves and no time passes',
            !la0.layers && la1.layers && la1.rsLayers && la1.xfer === la0.xfer + 1 && la1.top === la0.top && la1.total === la0.total &&
            la1.above === la0.above && la1.below === la0.below && la1.rem === la0.rem && la1.audit !== false && la1.live && la1.state === 'paused', JSON.stringify({ before: la0, after: la1 }));

    // Reset makes the glass whole
    await t.eval(function () { window.Hourglass.reset(); });
    await waitFor(t, function () { return !document.getElementById('app').classList.contains('sweep'); }, 5000);
    await sleep(300);
    var w = await t.eval(function () { var Hg = window.Hourglass; return { cracks: Hg.sim.cracks.length, live: Hg.sim === Hg.realSand }; });
    s.check('CRASH: Reset makes the glass whole', w.cracks === 0 && w.live, JSON.stringify(w));
    await H.invariants(s, t, 'CRASH');
  } finally { await t.close(); }
}

async function main() {
  var s = new H.Suite('app-realsand');
  var env = await H.start();
  try {
    var only = env.args.only;
    var cases = { off: testOff, nogpu: testNoGpu, mock: testMock, fail: testFail, stamp: testStamp, again: testAgain,
      slow: testSlow, wake: testWake, life: testLife, norebuild: testNoRebuild, crash: testCrash };
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
