#!/usr/bin/env node
/*
 * Real sand in the app (design 13.2), in the browser harness, which has no WebGPU adapter.
 * Real sand is the app's default (settings design 5); the harness seeds { v: 2, realSand: false }
 * under every page's own storage (lib/seed.js), so a case seeds realSand: true to have it, or
 * rawStorage for exactly what it gives ({}: a first launch). The row's data-state is its state.
 *
 *  OFF   the switch off: nothing under realsand/ is requested (by the page's own record, and at
 *        the network through a route, also after a run, Tune, a theme, layered sand and a Reset;
 *        NOGPU's same route is the control), no engine, the CPU Sim is the sim; the row "Real
 *        sand" sits in the Material group after Grain, "Off: the classic sand", with no "Copy a
 *        report"; Grain and Real motion's crack sentence shown; Tune has 10 rows.
 *  NOGPU the switch on, the real engine, in this Chromium (navigator.gpu, but no adapter): the
 *        engine is loaded, does not start; the switch shows off, not disabled, "Needs WebGPU (iOS
 *        26 or later). Tap to try again"; the setting stays on and the user agent is kept; the
 *        CPU sand runs, no errors.
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
 *          within their ranges, poured sand lands in the top bulb, and of the bed, in a glass
 *          that is not moved, nothing: no thumps, slams or slides, no landing buzz;
 *        - census every 15 frames through the engine's audit(), no errors.
 *  FAIL  a start failure of the second kind: the CPU sand, the setting kept, the note says why;
 *        after three launches in a row it stops trying (nothing requested); off and on again
 *        clears the count. An engine file that cannot be had with no connection (a hole in the
 *        offline copy) is not counted, and the fourth launch still asks for it; with a
 *        connection (the control) the third launch is the last.
 *  STAMP a build stamp other than app.js's: the note says Real sand is updating, the setting
 *        kept, no engine.
 *  AGAIN a start cut short because the page was hidden: tried again once the page is in view,
 *        and taken over then, with no failure counted.
 *  SLOW  a cold start as slow as the owner's iPhone's in a home-screen web app (Gate A: 3.4 s to
 *        the engine's first frame; here 4 s): the CPU sand shows and runs meanwhile, the boot veil
 *        is held 1 s for it and no longer, the canvases cross-fade only once the engine has drawn, the clock
 *        runs on through the handover untouched, no failure is counted, the glass ends on time;
 *        ?debug=sand shows, and its copied report holds, the start-up times and the first fall.
 *        The latest the veil may lift is worked out from the opening's own frames (liftBy), so
 *        a long frame on a busy machine moves the bound by its own length and no more; the
 *        control is an app whose hold is 3 s.
 *  WAKE  Gate A's 4-minute glass ended 7 minutes late: the lab held no screen wake lock and had no
 *        catch-up. With the GPU sand running the app holds its wake lock (a stand-in for the
 *        browser's, which a headless Chromium refuses), lets it go while hidden and takes it back
 *        on return; every gap is caught up by a transfer, also one that runs past the end. The
 *        stream's first fall (Gate A: slow in a home-screen web app and in the hand) is in
 *        ?debug=sand's overlay and report, and in the report the row's "Copy a report" copies
 *        (a home-screen web app cannot open ?debug=sand), which leaves the switch alone.
 *  LIFE  losses of the graphics chip (design 7.9): one while hidden (a lock or an app switch) is
 *        silent and rebuilt once the page is back; one in view shows the toast and is rebuilt
 *        after 2 s; a second such loss within 10 minutes leaves the CPU sand for the session,
 *        with the note, the setting kept and nothing counted; the clock is untouched each time.
 *        A loss right after adopt() resolved, before the frame that hands over: the sand is
 *        never handed to the lost engine (the rebuild takes over, the count does not jump back
 *        up, the glass ends on time); a second loss right after the rebuild's onBack: final, the
 *        CPU sand stays, never "On".
 *  NOREBUILD a rebuild that cannot open a device: the CPU sand stays, the note says it will try
 *        again next launch, nothing is counted, and the next launch takes over again.
 *  CRASH the glass does not crack with Real sand on (owner's choice: crash waits for a later
 *        stage): a drop that cracks the CPU sand's glass (the control, switch off) only thumps and
 *        clacks on the GPU sand, and quick knocks creak nothing; a crack from before the switch was
 *        turned on stays, leaks nothing and can be mended; Reset makes the glass whole. The theme
 *        and the layers switch while the GPU sand is live: the grains take the Renderer's new
 *        colours, and the layers' re-tone is a transfer that moves no grain.
 *  RESIDUE points stuck on the funnel's wall after the end are moved by the residue rule: on a
 *        glass that ends in view (the control), and on a sequence that ends while hidden (its
 *        last fill made at 00:00.0 on return); then the GPU sand sleeps.
 *  ASLEEP the GPU sand asleep is drawn again after a theme, the screen turned and back, and the
 *        Frame switch, in #c-sand's box; a layout that changes nothing does not touch #c-gpu.
 *  QUIET the engine ready in the middle of a Flip takes over only once the turn is over; without
 *        ?debug=sand the row still has "Copy a report".
 *
 *  SOUNDS the bed heard when the glass is moved, in every state (design 8). The mock engine says
 *        what its sand does (stubs/realsand-mock-boot.mjs: __mockEnv.feeds, the frame record as the
 *        engine would fill it, only in frames in which the engine ran; __mockEnv.tally, the chip's
 *        own report). Idle before the start, running, paused and finished, the phone shaken
 *        (1.5 g at 5 Hz, the motion stub): every thump and slam the engine reported is given to
 *        audio.update in that frame and played, the slides at their rate, the agitation, the
 *        landing buzz; the stream and the ambience keep their rules (none unless it runs). The
 *        control, each time: the same shake with the engine saying nothing (the sand did not
 *        move): nothing. ASLEEP: its sand still, the engine sleeps within 1.5 s although it was
 *        reporting sound until then, and nothing more is given (the control: sand that moves keeps
 *        it awake and heard); a jolt wakes it and the sound comes within 3 frames. HIDDEN: no
 *        update at all, the rush and the shimmer let go (the control: back in view, heard again).
 *        MUTED: the feeds come, the output is silent, and so with the volume at 0 (the
 *        control: unmuted, it is not). BEDS: the engine's own ears, with nothing said for it:
 *        the mock chip's readbacks carry each bulb's bed (solver.mjs bedOf), the upper one
 *        sliding within itself, then falling and stopped by the glass; the real adapter makes
 *        slides, agitation and one landing of it, and audio.update is given them and plays them
 *        (the control: the same bed at rest in its records: nothing).
 *
 *  DEFAULT-NA nothing saved, the real engine: loaded once, "na" with "Tap to try again", the
 *        setting on and saved with v 2, the user agent kept; the next launch says so and loads
 *        nothing; another user agent kept (an iOS update, the control) or a tap on the row: tried
 *        again. NA-HIDDEN: a capability failure while the page was hidden keeps nothing and is
 *        tried again in view; the same failure in view (the control) is kept.
 *  DEFAULT-MOCK nothing saved, the mock engine: Real sand takes over ("On: ..."), Grain and the
 *        crack sentence hidden, v 2 saved; the dark opening held for the GPU sand's first frame;
 *        sessionStorage 'hourglass.openNow' (the control): not held, and only once.
 *  MIGRATE a save without a version, or of version 1, with realSand false: on, saved with v 2,
 *        the rest kept; turned off afterwards it stays off; a version-2 save with realSand false
 *        (the control) stays off and loads nothing.
 *  BUILD 3 failed launches, or "Needs WebGPU" for this user agent, found with an older engine
 *        build: forgotten and tried again; with this build (the controls): not tried.
 *        NA-EXPIRE: "Needs WebGPU" kept eight days ago is tried again; six days ago (the
 *        control): not tried.
 *  HANG  the watchdog (settings design 5.4, in app.js): the GPU stops answering while the glass
 *        runs in view: the CPU sand after 4 s, at the stopped engine's counts, the clock
 *        untouched, the toast; a new engine after 2 s; a second time the same; a third within
 *        ten minutes final; a glass with a swap still ends on time. Controls: readbacks held 8 s
 *        on an idle, a paused and a finished glass (asleep), a running glass whose readbacks come
 *        (calm), and a glass hidden 10 s with its readbacks held then let go: never fires.
 *        The stopped engine, kept 600 ms for the cross-fade, loses its device 200 ms after the
 *        swap: not heard (the note stays the watchdog's, also after the third, final time).
 *  RESTART a start made again in the same session: after the watchdog, or after a start that a
 *        reset of the chip cut short, "no adapter" keeps nothing and counts nothing ("Real sand
 *        could not restart; it will try again next launch"), and the next launch asks for the
 *        engine again. A start that took over gives the session its three retries back: a start
 *        cut short after three earlier ones and a watchdog swap is still tried again.
 *
 *  Some controls are app.js with one thing undone (appWithout), served in its place: the check
 *  that thing answers must fail on it.
 *
 *   node tools/test/app-realsand.test.js [--port 8905] [--only slow]
 *   (cases: off nogpu mock fail stamp again slow wake life norebuild crash residue asleep quiet
 *    sounds defaultna defaultmock migrate build hang restart)
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
  // the opening: the first animation frame, when the veil began to lift, when the GPU sand took over
  // (#app.real), and when each animation frame's callbacks ran until the lift (the app tests its
  // 1 s only in a frame, so one long frame moves the lift by its length)
  // .frames: when each frame's first callback ran; .last: when the last callback before the lift did
  var O = window.__open = { raf0: null, lift: null, real: null, frames: [], last: null }, frameT = null;
  window.requestAnimationFrame = function (cb) {
    if (window.__hidden) { held.push(cb); return 0; }
    if (O.lift !== null || O.frames.length >= 4000) return raf(cb);
    return raf(function (t) {
      var now = performance.now();
      if (O.raf0 === null) O.raf0 = now;
      if (O.lift === null) {
        if (t !== frameT) { frameT = t; O.frames.push(now); }
        O.last = now;
      }
      cb(t);
    });
  };
  // a phone with no connection (navigator.onLine false)
  if (arg.offline) Object.defineProperty(navigator, 'onLine', { configurable: true, get: function () { return false; } });
  new MutationObserver(function () {
    var v = document.getElementById('veil'), a = document.getElementById('app');
    if (O.lift === null && v && !v.classList.contains('boot')) O.lift = performance.now();
    if (O.real === null && a && a.classList.contains('real')) O.real = performance.now();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  // a reload that should open at once (a later "Use this shape"): the key set once, before the first load
  if (arg.openNow && !sessionStorage.getItem('__openNowSet')) {
    sessionStorage.setItem('__openNowSet', '1');
    sessionStorage.setItem('hourglass.openNow', '1');
  }
  window.__hide = function (on) {
    window.__hidden = !!on;
    document.dispatchEvent(new Event('visibilitychange'));
    if (!on) { var h = held; held = []; h.forEach(function (cb) { raf(cb); }); }
  };
  // the clipboard: what "Copy a report" and ?debug=sand's "copy the report" write to it
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, get: function () {
    return { writeText: function (t) { window.__copied.push(String(t)); return Promise.resolve(); } };
  } });
  // a hook on the mock engine's adopt(), set before boot.mjs hands the app its class: as the first
  // adopt() resolves, before the app's next frame, 'lose' loses the device and 'flip' begins a Flip
  if (arg.adopt) {
    var mc = null;
    window.__adopts = 0;
    Object.defineProperty(window, '__mockClass', { configurable: true, get: function () { return mc; }, set: function (C) {
      mc = C;
      var adopt = C.prototype.adopt;
      C.prototype.adopt = function () {
        return adopt.apply(this, arguments).then(function (r) {
          if (++window.__adopts === 1) {
            if (arg.adopt === 'lose') window.__mockEnv.device.loseIt('unknown', 'mock: lost between adopt() and the handover');
            if (arg.adopt === 'flip') { window.Hourglass.flipNow(); window.__flipAt = window.__mockEnv.V.frame; }
          }
          return r;
        });
      };
    } });
  }
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
    init: pageInit, initArg: { plant: PLANT, mock: mock || {}, wake: !!(o && o.wake), adopt: o && o.adopt },
    routes: [mockRoute()].concat((o && o.routes) || []), query: o && o.query,
    motionStub: !!(o && o.motionStub) });
}
/**
 * app.js with one thing undone, for a control: the check that thing answers must fail on it.
 * `swaps`: [[from, to], ...], each `from` a text of app.js as it is. .found: whether every one was
 * there (a control whose text is gone proves nothing, and says so); .route serves it as app.js.
 */
function appWithout(env, swaps) {
  var file = require('./lib/paths.js').script('app.js', env.root), src = fs.readFileSync(path.join(env.root, file), 'utf8'), found = true;
  swaps.forEach(function (sw) {
    if (src.indexOf(sw[0]) < 0) found = false;
    src = src.split(sw[0]).join(sw[1]);
  });
  return { found: found, route: { url: '**/' + file, handler: function (route) {
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: src });
  } } };
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
        note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), toasts: window.__toasts.slice() };
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
    return { note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), checked: el.checked, disabled: el.disabled,
      dstate: document.getElementById('realsand-row').getAttribute('data-state'),
      setting: s.realSand, fails: s.realSandFails, why: s.realSandWhy, na: s.realSandNa, naAt: s.realSandNaAt, build: s.realSandBuild, v: s.v, ua: navigator.userAgent,
      grainShown: !document.getElementById('grain-row').hidden && !document.getElementById('grains').parentNode.hidden,
      crackShown: !document.getElementById('tilt-crack').hidden, engine: !!Hg.realSand,
      cpu: Hg.sim instanceof window.HourglassPhysics.Sim, live: !!Hg.realSand && Hg.sim === Hg.realSand,
      real: document.getElementById('app').classList.contains('real'), gpu: !!gpu,
      grainNote: document.getElementById('grain-note').textContent,
      report: (function (a) { return a ? (a.hidden ? 'hidden' : a.textContent) : null; })(document.getElementById('realsand-report')),
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
    s.check('OFF: off ("Off: the classic sand", data-state off); Grain shown with its note, and Real motion\'s crack sentence; no "Copy a report" link',
            !st.checked && !st.disabled && st.dstate === 'off' && st.note === 'Off: the classic sand' && st.grainShown && st.crackShown &&
            st.grainNote === 'Finer sand is more grains, and more work for the phone' && st.report === null,
            JSON.stringify([st.dstate, st.note, st.grainShown, st.crackShown, st.grainNote, st.report]));
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
    await waitFor(t, function () { return document.getElementById('realsand-row').getAttribute('data-state') === 'na'; }, 15000);
    var st = await state(t);
    s.check('NOGPU: the engine is loaded (boot.mjs and its modules, seen by the page and at the network) and does not start: this Chromium has no adapter',
            st.requested.indexOf('/realsand/boot.mjs') >= 0 && st.requested.indexOf('/realsand/app-sand.mjs') >= 0 && !st.engine &&
            net.hits.indexOf('/realsand/boot.mjs') >= 0 && net.hits.indexOf('/realsand/app-sand.mjs') >= 0, st.requested.length + ' requested, ' + net.hits.length + ' at the network');
    s.check('NOGPU: the switch shows off and is NOT disabled (data-state na), the note says "Needs WebGPU (iOS 26 or later). Tap to try again"; no report link shown',
            st.dstate === 'na' && !st.disabled && !st.checked && st.note === 'Needs WebGPU (iOS 26 or later). Tap to try again' && st.report !== 'Copy a report', JSON.stringify(st));
    s.check('NOGPU: the setting is never written off: it stays on, this browser\'s user agent is kept (realSandNa), no failure counted; Grain and the crack sentence shown',
            st.setting === true && st.na === st.ua && !!st.ua && !st.fails && st.why === 'Needs WebGPU (iOS 26 or later)' && st.grainShown && st.crackShown,
            JSON.stringify({ setting: st.setting, na: st.na, fails: st.fails, why: st.why, grain: st.grainShown, crack: st.crackShown }));
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
            st.live && st.dstate === 'on' && st.checked && st.setting === true && !st.fails && h.creates === 1, JSON.stringify(st));
    s.check('HANDOVER: #c-gpu sits in #rotor right after #c-sand, in its CSS box; #c-sand and #c-bloom faded out, #c-gpu in',
            h.parent === 'rotor' && h.prev === 'c-sand' && h.box && h.gpuOpacity === '1' && h.sandOpacity === '0' && h.bloomOpacity === '0', JSON.stringify(h));
    s.check('HANDOVER: the CPU Sim was the sim first; the monitor hooked the GPU sand when it took over; the counts carried over',
            h.hooks === 2 && h.total === h.want && h.top === h.total, JSON.stringify({ hooks: h.hooks, total: h.total, top: h.top, want: h.want }));
    s.check('HANDOVER: "On: every grain simulated on the graphics chip"; Grain\'s row and choices, and Real motion\'s crack sentence, are hidden (the classic sand\'s alone)',
            st.note === 'On: every grain simulated on the graphics chip' && !st.grainShown && !st.crackShown, JSON.stringify([st.note, st.grainShown, st.crackShown]));

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
    s.check('SOUND: a glass that is not moved: nothing for the bed\'s thumps, slams and slides, no landing buzz (SOUNDS has the glass that is)',
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
          note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), hooks0: __mon.hooks };
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
      return { note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), real: document.getElementById('app').classList.contains('real'),
        rebuilds: st.n.rebuilds, losses: st.n.losses, hooks: __mon.hooks, creates: window.__mockEnv.creates, state: Hg.timer.state };
    });
    s.check('LOSS: the engine rebuilds (a new device) and takes the sand back; "On"; the monitor followed the sim each way',
            back.rstate === 'on' && back.real && back.rebuilds === 1 && back.losses === 1 && back.hooks >= 4 && back.creates === 1 && back.state === 'running', JSON.stringify(back));
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
            st.cpu && !st.engine && !st.gpu && !st.real && st.setting === true && st.fails === 1 && st.checked && !st.disabled && st.dstate === 'failed' &&
            st.note === 'Could not start this time: its self-test failed. It will try again next launch' && st.grainShown, JSON.stringify(st));
    for (var i = 0; i < 2; i++) {
      await t.reload();
      await waitFor(t, function () { return /Could not start|Did not start/.test(document.getElementById('realsand-note').textContent); }, 15000);
    }
    st = await state(t);
    s.check('FAIL: three launches in a row: "Did not start 3 times", the setting still kept',
            st.fails === 3 && st.setting === true && st.dstate === 'gaveup' && st.note === 'Did not start 3 times: its self-test failed. Turn it off and on to try again', JSON.stringify(st));
    await t.reload();
    await sleep(1500);
    st = await state(t);
    s.check('FAIL: ... and the next launch does not try: nothing under realsand/ is requested', st.requested.length === 0 && st.fails === 3 && st.dstate === 'gaveup' && st.grainShown &&
            st.note === 'Did not start 3 times: its self-test failed. Turn it off and on to try again', JSON.stringify(st));
    var loads = 0;
    t.page.on('load', function () { loads++; });
    await t.page.$eval('#opt-realsand', function (el) { el.click(); });
    await waitFor(t, function () { return !!window.Hourglass && !!window.__mon && __mon.hooked; }, 10000).catch(function () {});
    await sleep(1500);
    st = await state(t);
    s.check('FAIL: off again: the page reloads, the count is cleared, nothing is loaded', loads >= 1 && st.setting === false && st.fails === 0 && st.requested.length === 0 &&
            st.dstate === 'off' && st.note === 'Off: the classic sand', JSON.stringify({ loads: loads, st: st }));
    await H.invariants(s, t, 'FAIL');
  } finally { await t.close(); }

  // A file of the engine that cannot be had (a hole in the offline copy; here boot.mjs fails at
  // the network), four launches in a row: with no connection it is not counted, and the fourth
  // launch still asks for the engine (so that the worker sees the hole and can fill it); with a
  // connection (the control) the third is the last.
  var cannotLoad = async function (offline) {
    var hits = 0, seen = [];
    var t2 = await env.open({ storage: { 'hourglass.settings.v1': { realSand: true, durationMs: 10000 } }, init: pageInit,
      initArg: { plant: PLANT, mock: {}, offline: offline },
      routes: [{ url: '**/realsand/boot.mjs', handler: function (route) { hits++; route.abort('internetdisconnected'); } }] });
    try {
      for (var i = 0; i < 4; i++) {
        if (i) await t2.reload();
        await waitFor(t2, function () { return /Could not start|Did not start/.test(document.getElementById('realsand-note').textContent); }, 15000).catch(function () {});
        await sleep(300);
        var st2 = await state(t2);
        seen.push({ dstate: st2.dstate, fails: st2.fails | 0, asked: hits, note: st2.note, cpu: st2.cpu, setting: st2.setting, onLine: await t2.eval(function () { return navigator.onLine; }) });
      }
    } finally { await t2.close(); }
    return seen;
  };
  var LOAD_NOTE = 'Could not start this time: the sand engine could not be loaded. It will try again next launch';
  var off = await cannotLoad(true);
  s.check('FAIL (no connection): the engine cannot be loaded, four launches in a row with navigator.onLine false: "Could not start this time" each time, nothing counted, ' +
          'and the fourth launch still asks for the engine; the CPU sand, the setting kept',
          off.length === 4 && off.every(function (x, i) { return x.dstate === 'failed' && x.fails === 0 && x.asked === i + 1 && x.note === LOAD_NOTE && x.cpu && x.setting === true && x.onLine === false; }),
          JSON.stringify(off.map(function (x) { return [x.dstate, x.fails, x.asked]; })));
  var on = await cannotLoad(false);
  s.check('FAIL (control, with a connection): the same failure is counted: "Did not start 3 times" at the third launch, and the fourth asks for nothing',
          on.length === 4 && on[0].fails === 1 && on[0].dstate === 'failed' && on[0].note === LOAD_NOTE && on[2].fails === 3 && on[2].dstate === 'gaveup' &&
          on[3].dstate === 'gaveup' && on[3].asked === 3 && on[0].onLine === true,
          JSON.stringify(on.map(function (x) { return [x.dstate, x.fails, x.asked]; })));
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
            st.live && st.dstate === 'on' && st.setting === true && !st.fails && n.creates === 2 && n.starts === 2, JSON.stringify({ st: st.note, fails: st.fails, n: n }));
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
      return { note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), cpu: Hg.sim instanceof window.HourglassPhysics.Sim,
        engine: !!rs, starts: window.__mockEnv.starts, ready: !!(rs && rs.ready), real: document.getElementById('app').classList.contains('real'),
        sand: getComputedStyle(document.getElementById('c-sand')).opacity, gpu: cg ? getComputedStyle(cg).opacity : 'none',
        veil: +getComputedStyle(document.getElementById('veil')).opacity, state: Hg.timer.state, top: Hg.sim.nTop, total: Hg.sim.total,
        fails: st.realSandFails | 0 };
    });
    s.check('SLOW: 2.5 s into a 4 s start: the CPU sand is the sim, shown, and running (grains through the neck); "Starting…"; the engine not ready',
            mid.cpu && mid.engine && mid.starts === 1 && !mid.ready && !mid.real && mid.sand === '1' && (mid.gpu === 'none' || mid.gpu === '0') &&
            mid.state === 'running' && mid.top < mid.total && mid.note === 'Starting…', JSON.stringify(mid));
    var op = await t.eval(function () { return window.__open; });
    s.check('SLOW: the dark opening waits 1 s for the engine\'s first frame and no longer: it began to lift 1 s after the first frame, before the handover; it has lifted',
            op.raf0 !== null && op.lift !== null && op.lift - op.raf0 >= 950 && op.lift - op.raf0 <= liftBy(op) && op.real === null && mid.veil < 0.02,
            openingSays(op) + ', veil ' + mid.veil);
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
    s.check('SLOW: a slow start is not a failure: "On", the setting kept, nothing counted', st.dstate === 'on' && st.setting === true && !st.fails && !st.why,
            JSON.stringify({ note: st.note, setting: st.setting, fails: st.fails, why: st.why }));
    // what the owner sends back from the phone (?debug=sand): the start-up times, in the overlay
    // and in the copied report, with the engine's log
    var rep = await debugReport(t);
    s.check('SLOW: ?debug=sand: the overlay shows the start-up times, and the copied report holds them (device, pipelines, self-test, first frame: here after 4 s) with the engine\'s log',
            !!rep.overlay && /first frame/.test(rep.overlay) && rep.copy && !!rep.times && rep.times.pipelines >= 0 && rep.times.selfTest >= 0 &&
            rep.times.firstFrame > 4000 && rep.started >= 1 && rep.live === true && rep.build === ENGINE_BUILD, JSON.stringify(rep.times) + ', ' + rep.started + ' log lines of the start');
    await H.invariants(s, t, 'SLOW');
  } finally { await t.close(); }
  // control: an app whose hold is 3 s: the veil lifts too late for the check above
  var long = appWithout(env, [['var VEIL_HOLD_MS = 1000;', 'var VEIL_HOLD_MS = 3000;']]);
  var t2 = await openMock(env, { seed: 9, startDelay: 4000 }, {}, { routes: [long.route] });
  try {
    await waitFor(t2, function () { return window.__open.lift !== null; }, 15000);
    var op2 = await t2.eval(function () { return window.__open; });
    s.check('SLOW (control): app.js with a hold of 3 s: the veil begins to lift 3 s after the first frame, later than the check above allows',
            long.found && op2.lift - op2.raf0 >= 2900 && op2.lift - op2.raf0 > liftBy(op2), openingSays(op2));
  } finally { await t2.close(); }
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
    // the home-screen web app cannot open ?debug=sand (its own storage, its own address): with the
    // switch on, the row has "Copy a report", which copies the same report (and leaves the switch alone)
    var lk = await t.eval(function () {
      var a = document.getElementById('realsand-report'), cb = document.getElementById('opt-realsand'), n = window.__copied.length, was = cb.checked;
      if (!a) return null;
      var inRow = document.getElementById('realsand-row').contains(a) && a.previousElementSibling === document.getElementById('realsand-note');
      a.click();
      return new Promise(function (res) {
        setTimeout(function () {
          res({ text: a.textContent, hidden: a.hidden, inRow: inRow, kept: cb.checked === was && was, copied: window.__copied[n] || null,
            toast: document.getElementById('toast').textContent });
        }, 150);
      });
    });
    var got = null;
    try { got = lk && lk.copied ? JSON.parse(lk.copied) : null; } catch (e) { got = null; }
    var gs = got && got.stats, gf = gs && gs.fall && gs.fall.log && gs.fall.log[0];
    s.check('WAKE: "Copy a report" in the Real sand row copies the report (the start-up times and the stream\'s first fall) with a toast, and leaves the switch on',
            !!lk && lk.text === 'Copy a report' && !lk.hidden && lk.inRow && lk.kept && lk.toast === 'Copied' && !!gs && gs.times && gs.times.pipelines >= 0 &&
            gs.times.firstFrame > 0 && gs.times.glass >= 0 && !!gf && gf.s >= 0 && gf.wall >= 0 && got.setting === true && got.live === true,
            JSON.stringify({ link: lk && { text: lk.text, hidden: lk.hidden, inRow: lk.inRow, kept: lk.kept, toast: lk.toast }, times: gs && gs.times, fall: gf }));
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
      return { note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), toasts: window.__toasts.slice(), rebuilds: st.n.rebuilds, losses: st.n.losses,
        devices: window.__mockEnv.devices, creates: window.__mockEnv.creates, run: Hg.timer.state };
    });
    s.check('LIFE: ... silently (no toast, "Starting…"); rebuilt only once the page is back, and the GPU sand takes over again: "On"',
            A.note === 'Starting…' && A.toasts.length === 0 && A2.toasts.length === 0 && !hiddenNow.live && hiddenNow.rebuilds === 0 &&
            A2.rstate === 'on' && A2.rebuilds === 1 && A2.losses === 1 && A2.devices === 2 && A2.creates === 1 && A2.run === 'running',
            JSON.stringify({ lost: A.note, hidden: hiddenNow, back: A2 }));
    // a loss in view (not around a lock or an app switch): the toast, then rebuilt after 2 s
    await sleep(1500);
    var B = await loseNow(t, 'mock: the graphics chip was reset');
    var tB = Date.now();
    await waitLive(t, 8000);
    var B2 = await t.eval(function () { var st = window.Hourglass.realSand.stats(); return { note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), rebuilds: st.n.rebuilds, losses: st.n.losses }; });
    var backMs = Date.now() - tB;
    s.check('LIFE: lost in view: the CPU sand in the same frame, the clock untouched, the toast and the note say Real sand paused',
            untouched(B) && B.toasts.indexOf('Real sand paused: the graphics chip was reset') >= 0 && B.note === 'Real sand paused: the graphics chip was reset', JSON.stringify(B));
    s.check('LIFE: ... and it comes back after 2 s: "On"', B2.rstate === 'on' && B2.rebuilds === 2 && B2.losses === 2 && backMs >= 1900,
            JSON.stringify(B2) + ', back after ' + backMs + ' ms');
    // a second loss in view within 10 minutes: final for this session
    await sleep(1500);
    var C = await loseNow(t, 'mock: reset again');
    await sleep(4000);
    var C2 = await t.eval(function () {
      var Hg = window.Hourglass, st = Hg.realSand.stats(), S = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
      return { note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), cpu: Hg.sim instanceof window.HourglassPhysics.Sim, rebuilds: st.n.rebuilds,
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
  await lifeLossBefore(s, env);
  await lifeFinalBack(s, env);
}

/** Each frame: [Date.now, state, rem, lastTick, nTop, the plant's points above, its last crossing (s), live, the engine lost, total, mock frame]. */
function recordLoss(t) {
  return t.eval(function () {
    __rec.start(function (Hg) {
      var e = window.__mockEnv, pl = e && e.solver && e.solver.plant, rs = Hg.realSand;
      return [Date.now(), Hg.timer.state, Hg.timer.rem, Hg.timer.lastTick, Hg.sim.nTop, pl ? pl.above : -1,
        pl ? pl.lastCrossT : NaN, Hg.sim === rs ? 1 : 0, rs && (rs._lostInfo || rs._gone) ? 1 : 0, Hg.sim.total, e ? e.V.frame : 0];
    }, { frame: true });
  });
}
/** The largest rise of nTop from one frame to the next while running, with the same total. */
function maxRise(rows) {
  var m = 0;
  for (var i = 1; i < rows.length; i++) {
    var a = rows[i - 1], b = rows[i];
    if (a[1] === 'running' && b[1] === 'running' && a[9] === b[9]) m = Math.max(m, b[4] - a[4]);
  }
  return m;
}

/*
 * LIFE: the device lost right after adopt() resolved, before the app's next frame (the frame that
 * would hand over): the app must not hand the sand to the lost engine (before the fix: 127 frames
 * with the lost engine as the sim, the note "On", and the rebuild's adopt filled from a CPU Sim
 * not stepped since, so 2 s of sand went back above). The CPU sand runs on; the engine is rebuilt
 * after 2 s and takes over; the count never jumps back up; the glass ends on time.
 */
async function lifeLossBefore(s, env) {
  // (a start of 1.5 s: the loss is not taken for a lock or an app switch, so the rebuild waits 2 s)
  var t = await openMock(env, { seed: 7, startDelay: 1500 }, { durationMs: 10000 }, { adopt: 'lose' });
  try {
    await watchToasts(t);
    await t.eval(function () { window.Hourglass.start(); });
    await recordLoss(t);
    await waitFor(t, function () { return window.__adopts >= 1; }, 20000);
    await sleep(200);
    var a = await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand;
      return { cpu: Hg.sim instanceof window.HourglassPhysics.Sim, lost: !!(rs && rs._lostInfo), ready: !!(rs && rs.ready),
        real: document.getElementById('app').classList.contains('real'), note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state') };
    });
    s.check('LIFE (LOST BEFORE THE HANDOVER): the device lost after adopt(), before the handover\'s frame: the CPU sand stays the sim, the engine not ready, the note says it paused',
            a.cpu && a.lost && !a.ready && !a.real && a.note === 'Real sand paused: the graphics chip was reset', JSON.stringify(a));
    await waitLive(t, 10000);
    await waitFor(t, function () { var Hg = window.Hourglass; return Hg.timer.state === 'done' && Hg.sim.nTop === 0; }, 20000);
    await sleep(300);
    var rows = await t.eval(function () { return __rec.stop(); });
    var b = await t.eval(function () { var rs = window.Hourglass.realSand, T = window.Hourglass.timer; return { n: rs.stats().n, rate: T.rate, note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state') }; });
    var lostLive = rows.filter(function (r) { return r[7] === 1 && r[8] === 1; }).length, rise = maxRise(rows), k = -1;
    for (var i = 0; i < rows.length; i++) if (rows[i][7] === 1) { k = i; break; }
    var end = endOf(rows.slice(k));
    s.check('LIFE (LOST BEFORE THE HANDOVER): no frame runs on the lost engine; rebuilt after 2 s, it takes over ("On"); nTop rises by no more than the settle\'s flow (0.4 s of the clock\'s) at the handover',
            lostLive === 0 && k > 0 && b.n.losses === 1 && b.n.rebuilds === 1 && b.rstate === 'on' && rise <= Math.max(12, Math.ceil(0.4 * b.rate)) + 1,
            JSON.stringify({ lostLive: lostLive, handoverFrame: k, rise: rise, rate: b.rate, losses: b.n.losses, rebuilds: b.n.rebuilds, note: b.note }));
    s.check('LIFE (LOST BEFORE THE HANDOVER): the glass ends on time on the rebuilt engine', end.done && end.liveAll && end.d >= -5 && end.d <= 30 && end.early === 0, fmtEnd(end));
    await H.invariants(s, t, 'LIFE (LOST BEFORE THE HANDOVER)');
  } finally { await t.close(); }
}

/*
 * LIFE: a second loss in view right after the rebuild's onBack (before the app's next frame): final.
 * The app must not take over the destroyed engine (before the fix it stayed the sim for the
 * session, with the note "On": a frozen picture on a phone, and nTop stuck at 1 after the end).
 */
async function lifeFinalBack(s, env) {
  var t = await openMock(env, { seed: 9 }, { durationMs: 30000 });
  try {
    await waitLive(t);
    await watchToasts(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    await t.eval(function () {
      var rs = window.Hourglass.realSand, back = rs.o.onBack;
      rs.o.onBack = function () { back(); window.__mockEnv.device.loseIt('unknown', 'mock: reset again'); };
      window.__mockEnv.device.loseIt('unknown', 'mock: the graphics chip was reset');
    });
    await sleep(4500);
    var FINAL = 'Paused after the graphics chip was reset twice; it will try again next launch';
    var a = await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand, st = rs.stats();
      return { cpu: Hg.sim instanceof window.HourglassPhysics.Sim, live: Hg.sim === rs, ready: rs.ready, real: document.getElementById('app').classList.contains('real'),
        note: document.getElementById('realsand-note').textContent, rstate: document.getElementById('realsand-row').getAttribute('data-state'), losses: st.n.losses, rebuilds: st.n.rebuilds, toasts: window.__toasts.slice(), run: Hg.timer.state, top: Hg.sim.nTop };
    });
    await sleep(1000);
    var top2 = await t.eval(function () { return window.Hourglass.sim.nTop; });
    s.check('LIFE (LOST AGAIN AT ONCE): a second loss right after the rebuild\'s onBack is final: the CPU sand stays the sim and runs on, the note says so, never "On"',
            a.cpu && !a.live && !a.ready && !a.real && a.note === FINAL && a.losses === 2 && a.rebuilds === 1 && a.run === 'running' && top2 < a.top,
            JSON.stringify(a) + ', nTop 1 s later ' + top2);
    await H.invariants(s, t, 'LIFE (LOST AGAIN AT ONCE)');
  } finally { await t.close(); }
}

/*
 * RESIDUE: points stuck on the funnel's wall after the end are moved by the residue rule, also
 * when the end comes with a fill made at 00:00.0: a 1-round sequence whose rest ends while the page
 * is hidden (the unseen turn's fill is made on return, after the catch-up). Before the fix that
 * fill turned the rule off: nTop read 2 for good, the GPU never slept, Play ran a 2-grain glass.
 * The control: the same stuck points on a glass that ends in view.
 */
async function testResidue(s, env) {
  var t = await openMock(env, { seed: 31, plant: { stuck: 3 } }, { durationMs: 10000 });
  try {
    await waitLive(t);
    await t.eval(function () { window.Hourglass.start(); });
    await waitFor(t, function () { return window.Hourglass.timer.state === 'done'; }, 20000);
    await sleep(4000);
    var c = await t.eval(function () { var Hg = window.Hourglass, rs = Hg.realSand; return { top: Hg.sim.nTop, residues: rs.stats().n.residues, above: window.__mockEnv.solver.plant.above }; });
    s.check('RESIDUE (control): 3 points stuck above at the end of a glass in view: the residue rule moves them, nTop 0 within 4 s',
            c.top === 0 && c.residues >= 1 && c.above === 0, JSON.stringify(c));
  } finally { await t.close(); }
  t = await openMock(env, { seed: 31, plant: { stuck: 3 } }, { durationMs: 10000, restMs: 10000, rounds: 1 });
  try {
    await waitLive(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    await t.eval(function () { window.__hide(true); });
    await sleep(21000);
    await t.eval(function () { window.__hide(false); });
    await waitFor(t, function () { return window.Hourglass.sim.nTop === 0; }, 6000).catch(function () {});
    var a = await t.eval(function () {
      var Hg = window.Hourglass, rs = Hg.realSand, st = rs.stats();
      return { state: Hg.timer.state, top: Hg.sim.nTop, live: Hg.sim === rs, residues: st.n.residues, deferred: st.n.deferred,
        above: window.__mockEnv.solver.plant.above, audit: rs.audit() && rs.audit().ok };
    });
    await sleep(3000);
    var m = await t.eval(function () { return window.Hourglass.realSand.modes.mode; });
    s.check('RESIDUE: a sequence ended while hidden (its last fill made on return, at 00:00.0): the stuck points are moved by the residue rule, nTop 0 within 6 s; then the GPU sand sleeps',
            a.state === 'done' && a.top === 0 && a.live && a.residues >= 1 && a.deferred >= 1 && a.above === 0 && a.audit !== false && m === 'asleep',
            JSON.stringify(a) + ', mode 3 s on: ' + m);
    await H.invariants(s, t, 'RESIDUE');
  } finally { await t.close(); }
}

/*
 * ASLEEP: the GPU sand at rest (asleep: no GPU work) is drawn again when what it looks like
 * changes: a theme, the screen turned (a resize) and back, the Frame switch. #c-gpu keeps
 * #c-sand's box; a layout that changes nothing leaves its width and height alone (setting either
 * clears a canvas's picture). Before the fix none of these drew anything (old colours, or a blank
 * or stretched picture, until the glass was started or tilted).
 */
async function testAsleep(s, env) {
  var t = await openMock(env, { seed: 61 }, {});
  try {
    await waitLive(t);
    await waitFor(t, function () { return window.Hourglass.realSand.modes.mode === 'asleep'; }, 15000);
    await sleep(500);
    await t.eval(function () {
      var c = document.getElementById('c-gpu'), W = window.__sets = { width: 0, height: 0 };
      ['width', 'height'].forEach(function (k) {
        var d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
        Object.defineProperty(c, k, { configurable: true, get: function () { return d.get.call(c); }, set: function (v) { W[k]++; d.set.call(c, v); } });
      });
    });
    var look = function () {
      return t.eval(function () {
        var rs = window.Hourglass.realSand, c = document.getElementById('c-gpu'), cs = document.getElementById('c-sand');
        return { draws: window.__mockEnv.grains.draws, frame: window.__mockEnv.V.frame, mode: rs.modes.mode, w: c.width, h: c.height,
          sets: window.__sets.width + window.__sets.height, same: ['width', 'height', 'left', 'top'].every(function (k) { return c.style[k] === cs.style[k]; }),
          box: c.style.width + ' x ' + c.style.height };
      });
    };
    // the mock frame of each draw, and of the change it follows (in the page: a theme's call, the
    // window's resize event), so that "within 2 frames" is the page's own count, not the test's latency
    await t.eval(function () {
      var e = window.__mockEnv, G = e.grains, enc = G.encode;
      window.__drawAt = []; window.__actAt = null;
      G.encode = function () { var r = enc.apply(this, arguments); window.__drawAt.push([G.draws, e.V.frame]); return r; };
      window.addEventListener('resize', function () { if (window.__actAt === null) window.__actAt = e.V.frame; });
    });
    // drawn again once, soon after the change, still asleep
    async function after(what, fn, ms) {
      var a = await look();
      await t.eval(function () { window.__actAt = null; });
      await fn();
      await t.page.waitForFunction(function (d) { return window.__mockEnv.grains.draws > d; }, a.draws, { timeout: ms || 1500, polling: 16 }).catch(function () {});
      var b = await look();
      await sleep(300);
      var c = await look();
      var at = await t.eval(function (n) {
        var d = window.__drawAt.filter(function (x) { return x[0] > n; })[0];
        return { act: window.__actAt, draw: d ? d[1] : null };
      }, a.draws);
      return { what: what, draws: b.draws - a.draws, frames: at.act !== null && at.draw !== null ? at.draw - at.act : null,
        asleep: c.mode === 'asleep' && c.draws === b.draws, same: c.same, sets: c.sets - a.sets, box: c.box, w: c.w };
    }
    var r0 = await after('a layout that changes nothing', function () { return t.eval(function () { window.dispatchEvent(new Event('resize')); }); }, 600);
    var r1 = await after('a theme', function () { return t.eval(function () { window.__actAt = window.__mockEnv.V.frame; window.Hourglass.setTheme('volcanic'); }); });
    var r2 = await after('landscape', function () { return t.page.setViewportSize({ width: 844, height: 390 }); });
    await sleep(400);
    var r3 = await after('portrait again', function () { return t.page.setViewportSize({ width: 390, height: 844 }); });
    await sleep(400);
    var r4 = await after('the Frame switch', function () { return t.page.$eval('#opt-frame', function (el) { el.click(); }); }, 2000);
    s.check('ASLEEP: a layout that changes nothing sets neither width nor height of #c-gpu and draws nothing',
            r0.sets === 0 && r0.draws === 0 && r0.asleep, JSON.stringify(r0));
    s.check('ASLEEP: a theme chosen: the GPU sand is drawn again within 2 frames (with its new palette), and sleeps on',
            r1.draws >= 1 && r1.frames !== null && r1.frames <= 2 && r1.asleep, JSON.stringify(r1));
    s.check('ASLEEP: the screen turned to landscape and back: drawn again each time at its new size within 2 frames of the resize, in #c-sand\'s box, and sleeps on',
            [r2, r3].every(function (r) { return r.draws >= 1 && r.frames !== null && r.frames <= 2 && r.sets >= 1 && r.same && r.asleep; }) && r2.w !== r3.w, JSON.stringify([r2, r3]));
    s.check('ASLEEP: the Frame switch (the glass sits larger): drawn again, in #c-sand\'s box, and sleeps on',
            r4.draws >= 1 && r4.sets >= 1 && r4.same && r4.asleep, JSON.stringify(r4));
    await H.invariants(s, t, 'ASLEEP');
  } finally { await t.close(); }
}

/*
 * QUIET: the handover waits for a quiet frame (review finding 10): the engine ready in the middle of
 * a Flip (begun as adopt() resolved) takes the sand only once the turn is over, so the cross-fade
 * never joins the CPU's turned bed to the GPU's upright one.
 */
async function testQuiet(s, env) {
  var t = await openMock(env, { seed: 71, startDelay: 600 }, { durationMs: 10000 }, { adopt: 'flip' });
  try {
    await t.eval(function () { window.Hourglass.start(); });
    var ho = await t.eval(function () {
      var Hg = window.Hourglass, t0 = performance.now(), endAt = null;
      return new Promise(function (res) {
        (function w() {
          if (performance.now() - t0 > 20000) { res(null); return; }
          if (window.__flipAt !== undefined && !Hg.flip.active && endAt === null) endAt = window.__mockEnv.V.frame;
          if (Hg.sim === Hg.realSand) { res({ flipAt: window.__flipAt, flipEnd: endAt, at: window.__mockEnv.V.frame, active: Hg.flip.active, angle: Hg.sim.angle }); return; }
          requestAnimationFrame(w);
        })();
      });
    });
    s.check('QUIET: the engine ready in the middle of a Flip takes the sand only once the turn is over (within a few frames after it)',
            !!ho && ho.flipAt !== undefined && !ho.active && ho.angle === 0 && ho.flipEnd !== null && ho.at - ho.flipAt > 60 && ho.at - ho.flipEnd <= 3, JSON.stringify(ho));
    await t.eval(function () { __rec.start(function (Hg) { var e = window.__mockEnv, pl = e.solver.plant; return [Date.now(), Hg.timer.state, Hg.timer.rem, Hg.timer.lastTick, Hg.sim.nTop, pl.above, pl.lastCrossT, Hg.sim === Hg.realSand ? 1 : 0, e.V.frame]; }, { frame: true }); });
    var end = await runToEnd(t, 20000);
    s.check('QUIET: ... and the glass ends on time', end.done && end.liveAll && end.d >= -5 && end.d <= 30 && end.early === 0, fmtEnd(end));
    var st = await state(t), dbg = await t.eval(function () { return !!document.getElementById('debug-sand'); });
    s.check('QUIET: without ?debug=sand (as the home-screen web app opens) the row still has "Copy a report"', st.report === 'Copy a report' && !dbg, JSON.stringify({ report: st.report, overlay: dbg }));
    await H.invariants(s, t, 'QUIET');
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
    s.check('NOREBUILD: the next launch takes over again: "On"', st.live && st.dstate === 'on' && st.setting === true && !st.fails, JSON.stringify({ note: st.note, fails: st.fails }));
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

/* ------------------------------------------------------------------------------------------ *
 *  Real sand by default (settings design 5): a first launch, the migration, a new engine
 *  build, the dark opening, and the watchdog
 * ------------------------------------------------------------------------------------------ */
/** The row's state from inside the page, and whether a toast or the watchdog's log said anything. */
function rowState(t) {
  return t.eval(function () {
    var Hg = window.Hourglass, rep = JSON.parse(Hg.realSandReport()), e = window.__mockEnv;
    return { dstate: document.getElementById('realsand-row').getAttribute('data-state'), note: document.getElementById('realsand-note').textContent,
      live: !!Hg.realSand && Hg.sim === Hg.realSand, cpu: Hg.sim instanceof window.HourglassPhysics.Sim, engine: !!Hg.realSand,
      watchdog: rep.watchdog, hangLog: (rep.log || []).filter(function (l) { return /watchdog/.test(l); }).length,
      creates: e ? e.creates : 0, gpus: document.querySelectorAll('#c-gpu').length, run: Hg.timer.state, mode: Hg.realSand ? Hg.realSand.stats().mode : null,
      grainShown: !document.getElementById('grain-row').hidden, toasts: (window.__toasts || []).slice() };
  });
}

async function testDefaultNa(s, env) {
  // a first launch on a phone whose browser has WebGPU but no adapter (this Chromium): nothing saved
  var net = realsandRequests();
  var t = await env.open({ rawStorage: {}, routes: [net.route] });
  try {
    await waitFor(t, function () { return document.getElementById('realsand-row').getAttribute('data-state') === 'na'; }, 15000);
    await sleep(300);
    var st = await state(t);
    var boots = net.hits.filter(function (p) { return p === '/realsand/boot.mjs'; }).length;
    s.check('DEFAULT-NA: nothing saved: Real sand is on, so the engine is loaded once (boot.mjs and its modules) and finds no adapter',
            boots === 1 && net.hits.indexOf('/realsand/app-sand.mjs') >= 0 && !st.engine && st.cpu && !st.real, JSON.stringify({ hits: net.hits.length, boots: boots }));
    s.check('DEFAULT-NA: "Needs WebGPU (iOS 26 or later). Tap to try again", the switch shown off and not disabled; the classic sand with Grain and the crack sentence',
            st.dstate === 'na' && st.note === 'Needs WebGPU (iOS 26 or later). Tap to try again' && !st.checked && !st.disabled && st.grainShown && st.crackShown,
            JSON.stringify(st));
    s.check('DEFAULT-NA: saved: the setting on (never written off), version 2, the engine build, and this browser\'s user agent with the time it was found; no failure counted',
            st.setting === true && st.v === 2 && st.build === ENGINE_BUILD && st.na === st.ua && !st.fails && st.naAt > Date.now() - 600000 && st.naAt <= Date.now() + 1000,
            JSON.stringify({ setting: st.setting, v: st.v, build: st.build, na: st.na, naAt: st.naAt, fails: st.fails }));
    // the next launch in the same browser: says so at once, loads nothing
    var n0 = net.hits.length;
    await t.reload();
    await sleep(1200);
    st = await state(t);
    s.check('DEFAULT-NA: the next launch, same user agent: "Needs WebGPU" at once, nothing under realsand/ requested (at the network either)',
            net.hits.length === n0 && st.requested.length === 0 && st.dstate === 'na' && st.setting === true && st.na === st.ua && !st.disabled,
            JSON.stringify({ hits: net.hits.slice(n0), requested: st.requested, dstate: st.dstate }));
    // control: another user agent kept (as after an iOS update): tried again
    await t.eval(function () {
      var k = 'hourglass.settings.v1', o = JSON.parse(localStorage.getItem(k));
      o.realSandNa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
      localStorage.setItem(k, JSON.stringify(o));
    });
    var n1 = net.hits.length;
    await t.reload();
    await waitFor(t, function () { return document.getElementById('realsand-row').getAttribute('data-state') === 'na'; }, 15000);
    st = await state(t);
    s.check('DEFAULT-NA (control): a user agent other than the one kept (an iOS update): the engine is loaded and tried again; this one is kept',
            net.hits.slice(n1).indexOf('/realsand/boot.mjs') >= 0 && st.na === st.ua && st.setting === true, JSON.stringify({ hits: net.hits.slice(n1).length, na: st.na === st.ua }));
    // a tap on the row: tried again (the page reloads, what was kept is forgotten first)
    var n2 = net.hits.length, loads = 0;
    t.page.on('load', function () { loads++; });
    await t.page.$eval('#opt-realsand', function (el) { el.click(); });
    await sleep(900);
    await waitFor(t, function () { return !!window.Hourglass && !!window.__mon && __mon.hooked && document.getElementById('realsand-row').getAttribute('data-state') === 'na'; }, 15000);
    st = await state(t);
    s.check('DEFAULT-NA: a tap on the row in "na" tries again: the page reloads and loads the engine, the setting still on',
            loads >= 1 && net.hits.slice(n2).indexOf('/realsand/boot.mjs') >= 0 && st.setting === true && st.na === st.ua && st.dstate === 'na',
            JSON.stringify({ loads: loads, hits: net.hits.slice(n2).length, setting: st.setting }));
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    var run = await t.eval(function () { return { st: window.Hourglass.timer.state, cpu: window.Hourglass.sim instanceof window.HourglassPhysics.Sim }; });
    s.check('DEFAULT-NA: the classic sand runs', run.st === 'running' && run.cpu, JSON.stringify(run));
    await H.invariants(s, t, 'DEFAULT-NA');
  } finally { await t.close(); }

  // NA-HIDDEN: a capability failure while the page was put away is not believed (iOS may refuse
  // an adapter to a page in the background): nothing kept, tried again once in view
  var t2 = await openMock(env, { failStart: 'noadapter', failCapability: true, failTimes: 1, startDelay: 1500 });
  try {
    await waitFor(t2, function () { return window.__mockEnv && window.__mockEnv.starts === 1; }, 15000);
    await t2.eval(function () { window.__hide(true); });
    await sleep(2500);
    var away = await state(t2);
    await t2.eval(function () { window.__hide(false); });
    await waitLive(t2);
    var st2 = await state(t2), n = await t2.eval(function () { return { starts: window.__mockEnv.starts }; });
    s.check('NA-HIDDEN: "no adapter" while the page was hidden: nothing kept ("Starting…"), tried again once in view, and taken over',
            away.dstate === 'starting' && !away.na && st2.live && st2.dstate === 'on' && !st2.na && n.starts === 2 && !st2.fails,
            JSON.stringify({ away: { dstate: away.dstate, na: away.na }, after: { dstate: st2.dstate, na: st2.na }, n: n }));
    await H.invariants(s, t2, 'NA-HIDDEN');
  } finally { await t2.close(); }
  // control: the same failure in view is believed: "na", the user agent kept
  var t3 = await openMock(env, { failStart: 'noadapter', failCapability: true, failTimes: 1, startDelay: 1500 });
  try {
    await waitFor(t3, function () { return document.getElementById('realsand-row').getAttribute('data-state') === 'na'; }, 15000);
    var st3 = await state(t3);
    s.check('NA-HIDDEN (control): the same failure with the page in view: "na", this user agent kept, no second start',
            st3.dstate === 'na' && st3.na === st3.ua && st3.setting === true && !st3.engine, JSON.stringify({ dstate: st3.dstate, na: st3.na === st3.ua }));
  } finally { await t3.close(); }
}

/**
 * The latest the veil may begin to lift, in ms after the first frame: the app's 1 s, as it can
 * keep it. It starts that clock in its second frame, after that frame's drawing (so: by the
 * fourth frame at the latest), and tests it once a frame, after that frame's work (so: the time
 * from the frame before the one that lifted to the lift); 50 ms for the rest. On a quiet machine
 * that is some 1.1 to 1.2 s; a long frame at either end moves it by its own length, no more.
 */
function liftBy(o) {
  var f = (o && o.frames) || [], n = f.length;
  if (n < 2 || o.last === null) return 1000;
  return 1000 + (f[Math.min(3, n - 1)] - f[0]) + (o.last - f[n - 2]) + 50;
}
/** The veil was held for the GPU sand: it began to lift once the GPU sand had taken over, or 1 s after the first frame (and not before), and no later than liftBy. */
function held(o) {
  return !!o && o.raf0 !== null && o.real !== null && o.lift !== null && o.lift - o.raf0 <= liftBy(o) &&
    (o.lift >= o.real || o.lift - o.raf0 >= 950);
}
function openingSays(o) {
  return JSON.stringify({ real: o.real === null ? null : Math.round(o.real - o.raf0), lift: o.lift === null ? null : Math.round(o.lift - o.raf0), by: Math.round(liftBy(o)), frames: o.frames.length });
}
async function testDefaultMock(s, env) {
  // a first launch where Real sand can run (the mock engine): nothing saved
  var t = await env.open({ rawStorage: {}, init: pageInit, initArg: { plant: PLANT, mock: { seed: 13 } }, routes: [mockRoute()] });
  try {
    await waitLive(t);
    await sleep(600);
    var st = await state(t), o = await t.eval(function () { return window.__open; });
    s.check('DEFAULT-MOCK: nothing saved: Real sand takes over ("On: every grain simulated on the graphics chip", data-state on), Grain and the crack sentence hidden',
            st.live && st.dstate === 'on' && st.note === 'On: every grain simulated on the graphics chip' && st.checked && !st.grainShown && !st.crackShown, JSON.stringify(st));
    s.check('DEFAULT-MOCK: saved: the setting on, version 2, the engine build; nothing counted, nothing kept',
            st.setting === true && st.v === 2 && st.build === ENGINE_BUILD && !st.fails && !st.na && !st.why, JSON.stringify({ setting: st.setting, v: st.v, build: st.build, fails: st.fails, na: st.na }));
    s.check('DEFAULT-MOCK: the dark opening waited for the engine\'s first frame: the veil began to lift as the GPU sand took over (or, on a slower start, after the full second)',
            held(o), openingSays(o));
    await H.invariants(s, t, 'DEFAULT-MOCK');
  } finally { await t.close(); }
  // control: a reload that should open at once ('hourglass.openNow'): not held, and the key used once
  var t2 = await env.open({ rawStorage: {}, init: pageInit, initArg: { plant: PLANT, mock: { seed: 13 }, openNow: true }, routes: [mockRoute()] });
  try {
    await waitLive(t2);
    await sleep(300);
    var o2 = await t2.eval(function () { return { o: window.__open, key: sessionStorage.getItem('hourglass.openNow') }; });
    s.check('DEFAULT-MOCK (control): opened with sessionStorage "hourglass.openNow": the veil lifts at the first frames, before the GPU sand takes over; the key is taken',
            o2.o.lift !== null && o2.o.real !== null && o2.o.lift < o2.o.real && o2.o.lift - o2.o.raf0 < 300 && o2.key === null,
            JSON.stringify({ real: o2.o.real - o2.o.raf0, lift: o2.o.lift - o2.o.raf0, key: o2.key }));
    await t2.reload();
    await waitLive(t2);
    await sleep(300);
    var o3 = await t2.eval(function () { return window.__open; });
    s.check('DEFAULT-MOCK (control): ... used once: the next launch waits for the first frame again',
            held(o3), openingSays(o3));
  } finally { await t2.close(); }
}

async function testMigrate(s, env) {
  var KEY1 = 'hourglass.settings.v1';
  var open1 = function (saved) {
    var raw = {}; raw[KEY1] = saved;
    return env.open({ rawStorage: raw, init: pageInit, initArg: { plant: PLANT, mock: { seed: 17 } }, routes: [mockRoute()] });
  };
  // a save of version 1 (no v: every launch before 1.10.0 wrote realSand: false)
  var t = await open1({ theme: 'lapis', durationMs: 10000, realSand: false, realSandFails: 0, realSandWhy: '', grain: 1 });
  try {
    await waitLive(t).catch(function () {});
    await sleep(400);
    var st = await state(t), keep = await t.eval(function () { var o = JSON.parse(localStorage.getItem('hourglass.settings.v1')); return { theme: o.theme, durationMs: o.durationMs, grain: o.grain }; });
    s.check('MIGRATE: a save without a version, with realSand false: Real sand comes up on and takes over; saved with v 2 and realSand true; the rest kept',
            st.live && st.dstate === 'on' && st.setting === true && st.v === 2 && keep.theme === 'lapis' && keep.durationMs === 10000 && keep.grain === 1,
            JSON.stringify({ dstate: st.dstate, setting: st.setting, v: st.v, keep: keep }));
    // turned off by the owner now: a version-2 save, kept off from then on
    await t.page.$eval('#opt-realsand', function (el) { el.click(); });
    await sleep(900);
    await waitFor(t, function () { return !!window.Hourglass && !!window.__mon && __mon.hooked; }, 15000);
    await t.reload();
    await sleep(1000);
    st = await state(t);
    s.check('MIGRATE: once: turned off afterwards, it stays off at the next launches (v 2, realSand false, nothing requested)',
            st.dstate === 'off' && st.setting === false && st.v === 2 && st.requested.length === 0 && !st.engine, JSON.stringify({ dstate: st.dstate, setting: st.setting, v: st.v, req: st.requested.length }));
  } finally { await t.close(); }
  // a save of version 1 that says so
  var t2 = await open1({ v: 1, realSand: false, durationMs: 10000 });
  try {
    await waitLive(t2).catch(function () {});
    var st2 = await state(t2);
    s.check('MIGRATE: a save of version 1 with realSand false: on, saved with v 2', st2.live && st2.setting === true && st2.v === 2, JSON.stringify({ dstate: st2.dstate, setting: st2.setting, v: st2.v }));
  } finally { await t2.close(); }
  // control: a save of version 2 with realSand false (the owner's own choice): off, nothing loaded
  var t3 = await open1({ v: 2, realSand: false, durationMs: 10000 });
  try {
    await sleep(1500);
    var st3 = await state(t3);
    s.check('MIGRATE (control): a save of version 2 with realSand false stays off: nothing under realsand/ requested, the CPU sand',
            st3.dstate === 'off' && st3.setting === false && st3.v === 2 && st3.requested.length === 0 && !st3.engine && st3.cpu,
            JSON.stringify({ dstate: st3.dstate, setting: st3.setting, v: st3.v, req: st3.requested.length }));
    await H.invariants(s, t3, 'MIGRATE');
  } finally { await t3.close(); }
}

async function testBuild(s, env) {
  var KEY1 = 'hourglass.settings.v1';
  var open1 = function (saved) {
    var raw = {}; raw[KEY1] = Object.assign({ v: 2, realSand: true, durationMs: 10000 }, saved);
    return env.open({ rawStorage: raw, init: pageInit, initArg: { plant: PLANT, mock: { seed: 19 } }, routes: [mockRoute()] });
  };
  var older = String(+ENGINE_BUILD - 1), ua = '';
  // gave up (3 failed launches) with an older engine build: tried again
  var t = await open1({ realSandFails: 3, realSandWhy: 'its self-test failed', realSandBuild: older });
  try {
    await waitLive(t).catch(function () {});
    await sleep(300);
    var st = await state(t);
    ua = st.ua;
    s.check('BUILD: 3 failed launches found with an older engine build (' + older + '): forgotten, tried again, taken over; the build saved',
            st.live && st.dstate === 'on' && !st.fails && !st.why && st.build === ENGINE_BUILD, JSON.stringify({ dstate: st.dstate, fails: st.fails, why: st.why, build: st.build }));
  } finally { await t.close(); }
  // "Needs WebGPU" kept for this user agent with an older engine build: tried again too
  var t2 = await open1({ realSandNa: ua, realSandNaAt: Date.now(), realSandWhy: 'Needs WebGPU (iOS 26 or later)', realSandBuild: older });
  try {
    await waitLive(t2).catch(function () {});
    var st2 = await state(t2);
    s.check('BUILD: "Needs WebGPU" kept for this user agent with an older engine build: forgotten, tried again, taken over',
            st2.live && st2.dstate === 'on' && !st2.na && st2.build === ENGINE_BUILD, JSON.stringify({ dstate: st2.dstate, na: st2.na, build: st2.build }));
  } finally { await t2.close(); }
  // controls: the same with this engine build: it does not try (nothing under realsand/ requested)
  var t3 = await open1({ realSandFails: 3, realSandWhy: 'its self-test failed', realSandBuild: ENGINE_BUILD });
  try {
    await sleep(1500);
    var st3 = await state(t3);
    s.check('BUILD (control): 3 failed launches with this engine build: "Did not start 3 times", nothing requested, Grain shown',
            st3.dstate === 'gaveup' && st3.fails === 3 && st3.requested.length === 0 && !st3.engine && st3.grainShown, JSON.stringify({ dstate: st3.dstate, fails: st3.fails, req: st3.requested.length }));
  } finally { await t3.close(); }
  var t4 = await open1({ realSandNa: ua, realSandNaAt: Date.now(), realSandWhy: 'Needs WebGPU (iOS 26 or later)', realSandBuild: ENGINE_BUILD });
  try {
    await sleep(1500);
    var st4 = await state(t4);
    s.check('BUILD (control): "Needs WebGPU" kept for this user agent with this engine build: "na" at once, nothing requested',
            st4.dstate === 'na' && st4.na === ua && st4.requested.length === 0 && !st4.engine, JSON.stringify({ dstate: st4.dstate, req: st4.requested.length }));
    await H.invariants(s, t4, 'BUILD');
  } finally { await t4.close(); }

  // NA-EXPIRE: "Needs WebGPU" is believed for seven days; then it is tried again all the same
  // (nothing here may rely on an iOS update changing the user agent)
  var DAY = 86400000;
  var t5 = await open1({ realSandNa: ua, realSandNaAt: Date.now() - 8 * DAY, realSandWhy: 'Needs WebGPU (iOS 26 or later)', realSandBuild: ENGINE_BUILD });
  try {
    await waitLive(t5).catch(function () {});
    var st5 = await state(t5);
    s.check('NA-EXPIRE: "Needs WebGPU" kept for this user agent eight days ago: tried again, and taken over; what was kept is gone',
            st5.live && st5.dstate === 'on' && !st5.na && !st5.naAt && st5.requested.indexOf('/realsand/boot.mjs') >= 0, JSON.stringify({ dstate: st5.dstate, na: st5.na, naAt: st5.naAt, req: st5.requested.length }));
  } finally { await t5.close(); }
  var t6 = await open1({ realSandNa: ua, realSandNaAt: Date.now() - 6 * DAY, realSandWhy: 'Needs WebGPU (iOS 26 or later)', realSandBuild: ENGINE_BUILD });
  try {
    await sleep(1500);
    var st6 = await state(t6);
    s.check('NA-EXPIRE (control): kept six days ago: "na" at once, nothing requested, the user agent and its time still kept',
            st6.dstate === 'na' && st6.na === ua && st6.naAt > 0 && st6.requested.length === 0 && !st6.engine, JSON.stringify({ dstate: st6.dstate, req: st6.requested.length }));
  } finally { await t6.close(); }
}

/*
 * RESTART: an engine started again in the same session (settings design 5.2). "No adapter" from a
 * start that follows a chip that stopped answering, or one that was reset as the engine started,
 * may only be the chip on its way back: nothing is kept, and the next launch tries again. And a
 * start that took over gives the session its three retries back.
 */
var RESTART_NOTE = 'Real sand could not restart; it will try again next launch';
async function testRestart(s, env) {
  var NOADAPTER = { code: 'noadapter', capability: true };
  /** plan: the mock's failPlan. hang: the first start takes over, and the watchdog fires. */
  var run = async function (plan, hang, routes) {
    var t = await openMock(env, { seed: 71, failPlan: plan }, { durationMs: 60000 }, { routes: routes }), out = {};
    var settled = function () {
      return waitFor(t, function () { var d = document.getElementById('realsand-row').getAttribute('data-state'); return d === 'paused' || d === 'na' || d === 'failed'; }, 20000).catch(function () {});
    };
    try {
      if (hang) {
        await waitLive(t);
        await watchToasts(t);
        await t.eval(function () { window.Hourglass.start(); });
        await sleep(1500);
        out.hang = await hangNow(t);
        await t.eval(function () { window.__mockEnv.hold = false; });
      }
      await settled();
      await sleep(300);
      out.after = await state(t);
      out.starts = await t.eval(function () { return window.__mockEnv.starts; });
      // the next launch
      await t.reload();
      await waitFor(t, function () {
        var Hg = window.Hourglass, d = document.getElementById('realsand-row').getAttribute('data-state');
        return (!!Hg.realSand && Hg.sim === Hg.realSand) || d === 'paused' || d === 'na' || d === 'failed';
      }, 20000).catch(function () {});
      await sleep(300);
      out.next = await state(t);
      out.errors = t.errors.slice(0, 2);
    } finally { await t.close(); }
    return out;
  };
  var kept = function (st) { return { dstate: st.dstate, note: st.note, na: st.na ? (st.na === st.ua ? 'this user agent' : st.na) : '', fails: st.fails | 0, setting: st.setting, req: st.requested.length }; };
  var nothingKept = function (st) {
    return st.dstate === 'paused' && st.note === RESTART_NOTE && !st.na && !st.naAt && !st.fails && st.setting === true && st.checked && st.cpu && !st.engine && st.grainShown;
  };
  var asked = function (st) { return st.requested.indexOf('/realsand/boot.mjs') >= 0; };

  // (a) the chip stops answering; the engine the watchdog starts 2 s later finds no adapter
  var a = await run([null, NOADAPTER], true, []);
  s.check('RESTART: the watchdog fires, and the engine started 2 s later finds no adapter: "' + RESTART_NOTE + '" (data-state paused), the classic sand with Grain shown, ' +
          'nothing kept or counted, the setting on',
          hangOk(a.hang) && a.starts === 2 && nothingKept(a.after) && a.errors.length === 0, JSON.stringify({ starts: a.starts, after: kept(a.after), errors: a.errors }));
  s.check('RESTART: ... and the next launch tries again, and takes over ("On")', asked(a.next) && a.next.live && a.next.dstate === 'on' && !a.next.na, JSON.stringify(kept(a.next)));
  // (b) the chip is reset as the engine starts ('lost'); the retry a second later finds no adapter
  var b = await run([{ code: 'lost' }, NOADAPTER], false, []);
  s.check('RESTART: a start cut short by a reset of the chip, and the retry a second later finds no adapter: the same, nothing kept or counted',
          b.starts === 2 && nothingKept(b.after), JSON.stringify({ starts: b.starts, after: kept(b.after) }));
  s.check('RESTART: ... and the next launch asks for the engine again', asked(b.next) && !b.next.na && b.next.dstate !== 'na', JSON.stringify(kept(b.next)));
  // control: app.js that does not mark the session (as before): "Needs WebGPU" is kept for this
  // user agent, and the next launches ask for nothing
  var blind = appWithout(env, [["if (code === 'lost') realShaky = true;", ''], ['    realShaky = true;\n', '']]);
  var ca = await run([null, NOADAPTER], true, [blind.route]);
  s.check('RESTART (control): app.js that does not mark a session that saw the chip go fails the first two checks: after the watchdog, "Needs WebGPU" is kept for this user agent, ' +
          'and the next launch asks for nothing under realsand/',
          blind.found && hangOk(ca.hang) && ca.after.dstate === 'na' && ca.after.na === ca.after.ua && ca.next.dstate === 'na' && ca.next.requested.length === 0 && !ca.next.live,
          JSON.stringify({ found: blind.found, after: kept(ca.after), next: kept(ca.next) }));
  var cb = await run([{ code: 'lost' }, NOADAPTER], false, [blind.route]);
  s.check('RESTART (control): ... and the other two: after the start cut short, the same',
          blind.found && cb.after.dstate === 'na' && cb.after.na === cb.after.ua && cb.next.dstate === 'na' && cb.next.requested.length === 0,
          JSON.stringify({ after: kept(cb.after), next: kept(cb.next) }));

  // The retries are a start's own. Three starts cut short (the page put away as each began), the
  // fourth takes over; the watchdog fires, and the start after it is cut short again: it is
  // tried again, as the first three were, and nothing is counted.
  var CUT = { code: 'hidden' };
  var retries = async function (routes) {
    var t = await openMock(env, { seed: 73, failPlan: [CUT, CUT, CUT, null, CUT, null] }, { durationMs: 60000 }, { routes: routes }), out = {};
    try {
      await waitLive(t, 30000);
      await watchToasts(t);
      out.first = { starts: await t.eval(function () { return window.__mockEnv.starts; }), st: await state(t) };
      await t.eval(function () { window.Hourglass.start(); });
      await sleep(1500);
      out.hang = await hangNow(t);
      await t.eval(function () { window.__mockEnv.hold = false; });
      await waitFor(t, function () {
        var Hg = window.Hourglass, d = document.getElementById('realsand-row').getAttribute('data-state');
        return (!!Hg.realSand && Hg.sim === Hg.realSand) || d === 'failed' || d === 'gaveup';
      }, 20000).catch(function () {});
      await sleep(300);
      out.st = await state(t);
      out.starts = await t.eval(function () { return window.__mockEnv.starts; });
    } finally { await t.close(); }
    return out;
  };
  var r = await retries([]);
  s.check('RESTART (retries): three starts cut short, the fourth takes over; after the watchdog the fifth is cut short too: tried again (the sixth takes over, "On"), nothing counted',
          r.first.starts === 4 && r.first.st.live && hangOk(r.hang) && r.starts === 6 && r.st.live && r.st.dstate === 'on' && !r.st.fails,
          JSON.stringify({ first: r.first.starts, starts: r.starts, dstate: r.st.dstate, fails: r.st.fails | 0 }));
  var spent = appWithout(env, [['      realRetries = 0;', '      ']]);
  var rc = await retries([spent.route]);
  s.check('RESTART (control): app.js that never gives the retries back fails the check: the fifth start, cut short, is counted as a failed launch and not tried again',
          spent.found && rc.first.starts === 4 && rc.starts === 5 && !rc.st.live && rc.st.dstate === 'failed' && rc.st.fails === 1,
          JSON.stringify({ found: spent.found, starts: rc.starts, dstate: rc.st.dstate, fails: rc.st.fails | 0, note: rc.st.note }));
}

/**
 * The GPU stops answering (the mock's hold: no work completes, no readback comes) while the glass
 * runs in view; resolves at the first frame on the CPU sand, with what the swap looked like.
 */
function hangNow(t, loseAfter) {
  return t.eval(function (loseAfter) {
    var Hg = window.Hourglass, e = window.__mockEnv, t0 = performance.now(), prev = null;
    e.hold = true;
    return new Promise(function (res) {
      (function w() {
        var now = performance.now();
        if (now - t0 > 15000) { res(null); return; }
        if (!(Hg.sim instanceof window.HourglassPhysics.Sim)) {
          prev = { end: Hg.timer.lastTick + Hg.timer.rem, run: Hg.timer.state };
          requestAnimationFrame(w);
          return;
        }
        var rs = Hg.realSand;           // (the stopped engine, kept until the CPU sand's canvas has faded in)
        // (the browser gives the stuck chip up: the stopped engine's device is lost while it is still kept)
        if (loseAfter > 0) setTimeout(function () { e.device.loseIt('unknown', 'mock: the stuck chip is given up'); }, loseAfter);
        res({ ms: now - t0, prev: prev, end: Hg.timer.lastTick + Hg.timer.rem, run: Hg.timer.state,
          top: Hg.sim.nTop, total: Hg.sim.total, ledger: rs ? { top: rs.nTop, total: rs.total } : null,
          real: document.getElementById('app').classList.contains('real'), dstate: document.getElementById('realsand-row').getAttribute('data-state'),
          note: document.getElementById('realsand-note').textContent, toasts: window.__toasts.slice(), grainShown: !document.getElementById('grain-row').hidden });
      })();
    });
  }, loseAfter || 0);
}
/** The swap looked right: in [3.9, 5] s, the clock's end untouched, the CPU Sim at the stopped engine's counts. */
function hangOk(h) {
  return !!h && h.ms >= 3900 && h.ms <= 5000 && !!h.prev && h.prev.run === 'running' && Math.abs(h.end - h.prev.end) < 1 && !h.real &&
    !!h.ledger && h.top === h.ledger.top && h.total === h.ledger.total;
}
var HANG_MSG = 'Real sand paused: the graphics chip stopped answering';
var HANG_FINAL = 'Real sand paused: the graphics chip stopped answering three times; it will try again next launch';

async function testHang(s, env) {
  var t = await openMock(env, { seed: 61 }, { durationMs: 60000 });
  try {
    await waitLive(t);
    await watchToasts(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(2500);
    // 1: the CPU sand within 4-5 s, the toast; a new engine after 2 s
    var h1 = await hangNow(t);
    s.check('HANG: the GPU stops answering while the glass runs in view: after 4 s (here ' + (h1 ? (h1.ms / 1000).toFixed(2) : '-') + ' s) the CPU sand takes over, at the stopped engine\'s counts, the clock untouched',
            hangOk(h1), JSON.stringify(h1));
    s.check('HANG: the toast and the note say "Real sand paused: the graphics chip stopped answering" (data-state lost)',
            !!h1 && h1.toasts.indexOf(HANG_MSG) >= 0 && h1.note === HANG_MSG && h1.dstate === 'lost' && !h1.grainShown, JSON.stringify(h1 && { toasts: h1.toasts, note: h1.note, dstate: h1.dstate }));
    var c0 = await t.eval(function () { var e = window.__mockEnv; e.hold = false; return { creates: e.creates, at: performance.now() }; });
    await waitLive(t, 15000);
    var b1 = await rowState(t), back1 = await t.eval(function (at) { return performance.now() - at; }, c0.at);
    s.check('HANG: a new engine after 2 s takes the sand back ("On"), one canvas, the stopped engine gone; the glass runs on',
            b1.live && b1.dstate === 'on' && b1.creates === c0.creates + 1 && b1.gpus === 1 && back1 >= 1700 && b1.run === 'running' && b1.watchdog === 1 && b1.hangLog === 1,
            JSON.stringify({ b: b1, backMs: back1 }));
    // 2: again, not final
    await sleep(1500);
    var h2 = await hangNow(t);
    await t.eval(function () { window.__mockEnv.hold = false; });
    await waitLive(t, 15000);
    var b2 = await rowState(t);
    s.check('HANG: a second time: the CPU sand again, not final, and a new engine again',
            hangOk(h2) && h2.dstate === 'lost' && b2.live && b2.creates === c0.creates + 2 && b2.watchdog === 2, JSON.stringify({ h: h2 && { ms: h2.ms, dstate: h2.dstate }, b: b2 }));
    // 3: within ten minutes: final; and 200 ms later the browser gives the stuck chip up (the
    // stopped engine, kept 600 ms for the cross-fade, loses its device): nothing changes
    await sleep(1500);
    var h3 = await hangNow(t, 200);
    await t.eval(function () { window.__mockEnv.hold = false; });
    await sleep(3500);
    var b3 = await rowState(t), st3 = await state(t);
    s.check('HANG: a third time within ten minutes is final: the CPU sand for the session, the note and toast say so, no new engine; the stopped engine\'s device lost 200 ms later changes nothing',
            hangOk(h3) && h3.dstate === 'paused' && h3.note === HANG_FINAL && h3.toasts.indexOf(HANG_FINAL) >= 0 &&
            b3.cpu && !b3.engine && b3.gpus === 0 && b3.creates === c0.creates + 2 && b3.dstate === 'paused' && b3.run === 'running' && b3.grainShown,
            JSON.stringify({ h: h3 && { ms: h3.ms, dstate: h3.dstate, note: h3.note }, b: b3 }));
    s.check('HANG: ... the setting kept, nothing counted; the report says the watchdog fired 3 times',
            st3.setting === true && !st3.fails && !st3.na && b3.watchdog === 3 && b3.hangLog === 3, JSON.stringify({ setting: st3.setting, fails: st3.fails, watchdog: b3.watchdog, log: b3.hangLog }));
    await H.invariants(s, t, 'HANG');
  } finally { await t.close(); }

  // the engine the watchdog stopped loses its device 200 ms later, while it is still kept: what
  // it says then is not heard (the note stays the watchdog's), and the new engine takes over
  var stoppedLoss = async function (routes) {
    var tl = await openMock(env, { seed: 65 }, { durationMs: 60000 }, { routes: routes });
    try {
      await waitLive(tl);
      await watchToasts(tl);
      await tl.eval(function () { window.Hourglass.start(); });
      await sleep(1500);
      var h = await hangNow(tl, 200);
      await sleep(1000);                    // (the loss at 200 ms, the stopped engine destroyed at 600 ms)
      var a = await rowState(tl);
      await tl.eval(function () { window.__mockEnv.hold = false; });
      await waitLive(tl, 15000).catch(function () {});
      var b = await rowState(tl);
      return { h: h, a: a, b: b, errors: tl.errors.slice(0, 2) };
    } finally { await tl.close(); }
  };
  var sl = await stoppedLoss([]);
  s.check('HANG (the stopped engine\'s device lost 200 ms after the swap): not heard: the note stays "' + HANG_MSG + '", one toast, and the new engine takes over as ever',
          hangOk(sl.h) && sl.a.note === HANG_MSG && sl.a.dstate === 'lost' && sl.a.toasts.length === 1 && sl.b.live && sl.b.dstate === 'on' && sl.b.gpus === 1 && sl.errors.length === 0,
          JSON.stringify({ a: { note: sl.a.note, dstate: sl.a.dstate, toasts: sl.a.toasts }, b: { live: sl.b.live, dstate: sl.b.dstate, gpus: sl.b.gpus }, errors: sl.errors }));
  var deaf = appWithout(env, [['if (eng && eng === realEng && eng !== realStopped) onRealLost(info);', 'onRealLost(info);']]);
  var slc = await stoppedLoss([deaf.route]);
  s.check('HANG (control): app.js that hears every engine\'s loss fails the check: the stopped engine\'s loss rewrites the note ("the graphics chip was reset")',
          deaf.found && hangOk(slc.h) && slc.a.note !== HANG_MSG && /was reset/.test(slc.a.note), JSON.stringify({ found: deaf.found, note: slc.a.note, dstate: slc.a.dstate }));

  // the glass still ends on time after a watchdog swap and the new engine's takeover
  var t2 = await openMock(env, { seed: 63 }, { durationMs: 14000 });
  try {
    await waitLive(t2);
    await watchToasts(t2);
    await record(t2);
    await t2.eval(function () { window.Hourglass.start(); });
    await sleep(2000);
    var h = await hangNow(t2);
    await t2.eval(function () { window.__mockEnv.hold = false; });
    var e = await runToEnd(t2, 30000);
    var back = await rowState(t2);
    s.check('HANG (END): a 14 s glass with a watchdog swap at 6 s: the new engine took over and the glass ends on time on the GPU sand: last point within 30 ms of 00:00.0, nTop 0 within 3 frames after, never before',
            hangOk(h) && back.live && e.done && e.d >= -5 && e.d <= 30 && e.frames >= 0 && e.frames <= 3 && e.early === 0, fmtEnd(e) + '; swap after ' + (h ? h.ms.toFixed(0) : '-') + ' ms');
    await H.invariants(s, t2, 'HANG (END)');
  } finally { await t2.close(); }

  // controls: the watchdog never fires on a glass that sleeps (idle, paused, finished) with its
  // readbacks held 8 s, on a running glass in view whose readbacks come (calm, every other frame),
  // or on one hidden 10 s with its readbacks held, then shown and let go within a second
  var t3 = await openMock(env, { seed: 67 }, { durationMs: 60000 });
  try {
    await waitLive(t3);
    await watchToasts(t3);
    var quiet = async function (label, ms) {
      var a = await rowState(t3);
      await t3.eval(function () { window.__mockEnv.hold = true; });
      await sleep(ms);
      var b = await rowState(t3);
      await t3.eval(function () { window.__mockEnv.hold = false; });
      await sleep(400);
      var c = await rowState(t3);
      s.check('HANG (control, ' + label + '): readbacks held ' + ms / 1000 + ' s: the watchdog does not fire (the GPU sand stays the sim, no new engine, no toast)',
              a.live && b.live && c.live && c.watchdog === 0 && c.creates === a.creates && c.toasts.length === 0 && c.dstate === 'on',
              JSON.stringify({ mode: a.mode, before: { live: a.live, creates: a.creates }, held: { live: b.live, mode: b.mode }, after: { live: c.live, watchdog: c.watchdog, creates: c.creates, toasts: c.toasts } }));
    };
    var asleep = function () { return waitFor(t3, function () { var rs = window.Hourglass.realSand; return !!rs && rs.stats().mode === 'asleep'; }, 15000); };
    // an idle glass
    await asleep();
    await quiet('an idle glass, asleep', 8000);
    // a running glass, its readbacks coming
    await t3.eval(function () { window.Hourglass.start(); });
    await sleep(3000);
    var modes = await t3.eval(function () {
      var rs = window.Hourglass.realSand, out = [], t0 = performance.now(), r0 = rs.stats().ledger.readbacks;
      return new Promise(function (res) {
        (function w() {
          out.push(rs.stats().mode);
          if (performance.now() - t0 > 8000) { res({ modes: out, reads: rs.stats().ledger.readbacks - r0 }); return; }
          setTimeout(w, 250);
        })();
      });
    });
    var r = await rowState(t3), calm = modes.modes.filter(function (m) { return m === 'calm'; }).length;
    s.check('HANG (control, a running glass in view, ' + calm + ' of ' + modes.modes.length + ' samples calm): 8 s, its readbacks coming: the watchdog does not fire',
            r.live && r.watchdog === 0 && r.toasts.length === 0 && modes.reads > 100 && calm > 0, JSON.stringify({ reads: modes.reads, calm: calm, live: r.live, watchdog: r.watchdog }));
    // its readbacks held from 1 s before the page is hidden for 10 s, then shown, and let go within
    // a second: no readback came in view for 1.6 s, but for 11.6 s of wall-clock time
    var h0 = await rowState(t3);
    await t3.eval(function () { window.__mockEnv.hold = true; });
    await sleep(1000);
    await t3.eval(function () { window.__hide(true); });
    await sleep(10000);
    await t3.eval(function () { window.__hide(false); });
    await sleep(600);
    await t3.eval(function () { window.__mockEnv.hold = false; });
    await sleep(5000);
    var h1c = await rowState(t3);
    s.check('HANG (control, hidden): readbacks held from 1 s before the page was hidden 10 s, shown, and let go within a second: the watchdog does not fire (it counts time in view only)',
            h1c.live && h1c.watchdog === 0 && h1c.creates === h0.creates && h1c.toasts.length === 0 && h1c.run === 'running', JSON.stringify(h1c));
    // a paused glass
    await t3.eval(function () { window.Hourglass.pause(); });
    await asleep();
    await quiet('a paused glass, asleep', 8000);
    // a finished glass
    await t3.eval(function () { window.Hourglass.reset(); });
    await waitFor(t3, function () { return !document.getElementById('app').classList.contains('sweep'); }, 5000);
    await t3.eval(function () { window.Hourglass.setDuration(10000); });
    await sleep(1500);
    await t3.eval(function () { window.Hourglass.start(); });
    await waitFor(t3, function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, 25000);
    await asleep();
    await quiet('a finished glass, asleep', 8000);
    await H.invariants(s, t3, 'HANG (controls)');
  } finally { await t3.close(); }
}

/* ---- SOUNDS: the bed heard when the glass is moved, in every state ------------------------- */

/** From now on: what audio.update is given of the bed, and what the sound engine plays for it (window.__bed). */
function bedWatch(t) {
  return t.eval(function () {
    var Hg = window.Hourglass, A = Hg.audio, e = window.__mockEnv;
    if (!A.__bedHooks) {
      A.__bedHooks = true;
      var up = A.update, th = A._thumpAt, cl = A._clackAt, ho = A.hold;
      A.update = function (st) {
        var B = window.__bed;
        var tm = st.thump ? Math.max(st.thump[0], st.thump[2]) : 0, sm = st.slam ? st.slam[0] : 0;
        B.updates++;
        if (tm > 0) { B.thumps++; if (tm > B.thumpE) B.thumpE = tm; }
        if (sm > 0) { B.slams++; if (sm > B.slamE) B.slamE = sm; }
        if (st.slides > B.slides) B.slides = st.slides;
        if (st.agit > B.agit) B.agit = st.agit;
        if (st.agit > 0 && B.firstAt < 0) B.firstAt = e.V.frame;
        if (st.flow > B.flow) B.flow = st.flow;
        if (st.ambient) B.ambient++;
        var r = up.apply(this, arguments);
        if (this.ready && this.ctx.state === 'running') {
          var L = this._last;                      // the levels it last asked for
          B.live++;
          B.rush = Math.max(B.rush, L.rush || 0);
          B.shimmer = Math.max(B.shimmer, (L.cS || 0) + (L.cG || 0));
          B.stream = Math.max(B.stream, (L.hS || 0) + (L.hG || 0));
        }
        return r;
      };
      A._thumpAt = function () { window.__bed.played++; return th.apply(this, arguments); };
      A._clackAt = function () { window.__bed.clacks++; return cl.apply(this, arguments); };
      A.hold = function () { window.__bed.holds++; return ho.apply(this, arguments); };
      if (navigator.vibrate) { var v = navigator.vibrate.bind(navigator); navigator.vibrate = function (p) { if (p === 10) window.__bed.buzz10++; return v(p); }; }
    }
    window.__bed = { updates: 0, live: 0, thumps: 0, slams: 0, thumpE: 0, slamE: 0, slides: 0, agit: 0, flow: 0, ambient: 0,
      played: 0, clacks: 0, holds: 0, buzz10: 0, rush: 0, shimmer: 0, stream: 0, firstAt: -1, joltAt: -1,
      fed0: e.fed, frame0: e.V.frame, t0: performance.now(), said: { frames: 0, thumps: 0, slams: 0, moves: 0 } };
  });
}
/**
 * The mock engine says what its sand does, in every frame in which it ran: slides at 48,000 a
 * second (for the time since it last said so, as an engine gives a rate), agitation 1.2, a
 * landing of E 0.4 in every 10th such frame and a slam of 0.3 in every 15th (on false: nothing).
 */
function bedSay(t, on) {
  return t.eval(function (on) {
    var k = 0, last = 0;
    window.__mockEnv.feeds = !on ? null : function () {
      var S = window.__bed.said, th = k % 10 === 3, sm = k % 15 === 11, now = performance.now();
      var n = Math.round(48000 * (last ? Math.min(0.1, (now - last) / 1000) : 1 / 60));
      last = now; k++;
      S.frames++; S.moves += n;
      if (th) S.thumps++;
      if (sm) S.slams++;
      return { thump: th ? [0.4, 0.2, 0, 0] : [0, 0, 0, 0], slam: sm ? [0.3, -0.5] : [0, 0], slides: n, agit: 1.2 };
    };
  }, on);
}
function bedRead(t) {
  return t.eval(function () {
    var B = window.__bed, Hg = window.Hourglass, e = window.__mockEnv, A = Hg.audio, o = {}, k;
    for (k in B) o[k] = B[k];
    o.fed = e.fed - B.fed0; o.frames = e.V.frame - B.frame0; o.secs = (performance.now() - B.t0) / 1000;
    o.state = Hg.timer.state; o.mode = Hg.realSand.modes.mode; o.live = Hg.sim === Hg.realSand; o.active = Hg.sim.isActive();
    o.audio = A.ready && A.ctx.state === 'running'; o.master = A._masterTarget(); o.muted = A.muted;
    o.rushNow = A._last.rush || 0; o.agitNow = A._agit; o.peak = window.__out ? window.__out.peak : -1;
    return o;
  });
}
/** The phone shaken side to side, 1.5 g at 5 Hz (the motion stub), or held still. */
function bedShake(t, on) {
  return t.eval(function (on) {
    if (on) window.__drive({ whole: true, fn: function (tt, f) { f.x = 1.5 * Math.sin(2 * Math.PI * 5 * tt); } });
    else window.__driveStop();
  }, on);
}
function bedBrief(b) {
  return JSON.stringify({ state: b.state, mode: b.mode, updates: b.updates, fed: b.fed, thumps: b.thumps + '/' + b.said.thumps + ' E ' + +b.thumpE.toFixed(3),
    played: b.played, slams: b.slams + '/' + b.said.slams + ' E ' + +b.slamE.toFixed(3), clacks: b.clacks, slides: Math.round(b.slides),
    said: Math.round(b.said.moves / b.secs), agit: b.agit, rush: +b.rush.toFixed(3), shimmer: +b.shimmer.toFixed(3), buzz: b.buzz10,
    flow: +b.flow.toFixed(2), ambient: b.ambient, stream: +b.stream.toFixed(4) });
}

async function testSounds(s, env) {
  var E4 = Math.fround(0.4), E3 = Math.fround(0.3);
  var t = await openMock(env, { seed: 31 }, { durationMs: 15000, tilt: true }, { motionStub: true });
  try {
    await waitLive(t);
    await sleep(600);
    // one touch for the sound (the mute button, twice: the glass stays idle)
    await t.page.tap('#btn-mute');
    await sleep(250);
    await t.page.tap('#btn-mute');
    await waitFor(t, function () { var a = window.Hourglass.audio; return a.ready && a.ctx.state === 'running' && !a.muted; }, 5000);
    var on = await t.eval(function () { return { grav: window.Hourglass.grav.on, stub: !!window.__motionStub, state: window.Hourglass.timer.state }; });
    s.check('SOUNDS: Real sand on the mock chip, Real motion on (the motion stub), the glass idle, the sound unlocked by a touch that started nothing',
            on.grav && on.stub && on.state === 'idle', JSON.stringify(on));

    /** In the state the glass is in: the control (shaken, the engine silent), then the same shake with the engine reporting. */
    async function inState(name, streams) {
      await bedSay(t, false);
      await bedWatch(t);
      await bedShake(t, true);
      await sleep(1500);
      var c = await bedRead(t);
      await bedWatch(t);
      await bedSay(t, true);
      await sleep(2500);
      var b = await bedRead(t);
      await bedSay(t, false);
      await bedShake(t, false);
      var rate = b.said.moves / b.secs;
      s.check('SOUNDS ' + name + ': every landing and slam the engine reported reached audio.update in its frame, at its energy (0.4, 0.3), and was played',
              b.state === name && b.live && b.audio && b.fed >= 25 && b.said.frames === b.fed && b.thumps === b.said.thumps && b.thumps >= 2 && b.thumpE === E4 &&
              b.played === b.thumps && b.slams === b.said.slams && b.slams >= 1 && b.slamE === E3 && b.clacks === b.slams, bedBrief(b));
      s.check('SOUNDS ' + name + ': the slides at the rate reported (' + Math.round(rate) + ' a second), the agitation (1.2): the rush and the shimmer sound, a hard landing buzzes',
              b.slides >= 0.6 * rate && b.slides <= 2.5 * rate && b.agit === 1.2 && b.rush > 0.05 && b.shimmer > 0.1 && b.buzz10 >= 1, bedBrief(b));
      s.check('SOUNDS ' + name + ': the stream and the ambience keep their rules (' + (streams ? 'running: both on' : 'no stream, no ambience') + ')',
              streams ? b.flow > 5 && b.ambient === b.updates && b.stream > 0.05 : b.flow < 0.4 && b.ambient === 0 && b.stream < 0.001, bedBrief(b));
      s.check('SOUNDS ' + name + ' (control): the same shake, the engine saying nothing of its sand (it did not move): nothing for the bed, no buzz',
              c.state === name && c.updates >= 10 && c.thumps === 0 && c.slams === 0 && c.slides < 1 && c.agit === 0 && c.played === 0 && c.clacks === 0 &&
              c.buzz10 === 0 && c.rush === 0 && (streams || c.shimmer < 0.02) && c.mode !== 'asleep', bedBrief(c));
      // (the shimmer of agitation 1.2 is 0.39 and more; just after a pause the stream's last landings leave 0.005 of crackle)
      await sleep(1500);                 // (the smoothed slide rate back to nothing before the next control)
    }
    await inState('idle', false);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1200);
    await inState('running', true);
    await t.eval(function () { window.Hourglass.pause(); });
    await sleep(1500);
    await inState('paused', false);
    await t.eval(function () { window.Hourglass.start(); });
    await waitFor(t, function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, 25000);
    await sleep(3000);                   // the bowl
    await inState('done', false);

    /* ---- ASLEEP: sand that moves keeps the glass awake and heard; still, it sleeps, silent ---- */
    await t.eval(function () { window.__mockEnv.tally = { moving: 400 }; });
    await bedSay(t, true);
    await sleep(3200);                   // past the 2 s the engine stays full after the shake
    await bedWatch(t);
    await sleep(2000);
    var aw = await bedRead(t);
    s.check('ASLEEP (control): the phone at rest, the chip\'s sand still moving: the engine stays awake and its feeds reach audio.update',
            aw.mode !== 'asleep' && aw.active && aw.fed >= 8 && aw.agit === 1.2 && aw.thumps === aw.said.thumps && aw.slides > 1000, bedBrief(aw));
    var slept = await t.eval(function () {
      var Hg = window.Hourglass, t0 = performance.now();
      window.__mockEnv.tally = null;     // the sand comes to rest (the engine still has its feeds to give)
      return new Promise(function (res) {
        (function w() {
          if (Hg.realSand.modes.mode === 'asleep') return res({ ms: performance.now() - t0, feeds: !!window.__mockEnv.feeds });
          if (performance.now() - t0 > 8000) return res({ ms: -1 });
          requestAnimationFrame(w);
        })();
      });
    });
    await sleep(1600);
    await bedWatch(t);
    await sleep(1200);
    var z = await bedRead(t);
    s.check('ASLEEP: its sand still, the engine sleeps within 1.5 s although it was reporting sound until then: sound does not keep the glass awake',
            slept.ms >= 0 && slept.ms <= 1500 && slept.feeds && z.mode === 'asleep' && !z.active, JSON.stringify(slept) + ' ' + bedBrief(z));
    s.check('ASLEEP: asleep, nothing is given to audio.update for the bed (frames go on), nothing is played, the rush and the shimmer are at nothing',
            z.updates >= 10 && z.fed === 0 && z.thumps === 0 && z.slams === 0 && z.slides < 1 && z.agit === 0 && z.played === 0 && z.clacks === 0 &&
            z.rush === 0 && z.shimmer < 0.001 && z.buzz10 === 0, bedBrief(z));
    var jolt = await t.eval(function () {
      var e = window.__mockEnv, B = window.__bed;
      B.firstAt = -1; B.joltAt = e.V.frame;
      e.tally = { moving: 400 };         // the jolt sets the sand moving
      window.__motion.x = 1;             // 1 g for a quarter of a second
      setTimeout(function () { window.__motion.x = 0; }, 250);
      return new Promise(function (res) {
        setTimeout(function () { res({ joltAt: B.joltAt, firstAt: B.firstAt, mode: window.Hourglass.realSand.modes.mode, why: window.Hourglass.realSand.modes.why }); }, 700);
      });
    });
    s.check('ASLEEP: a jolt wakes it, and the sound comes with the motion: the first feed within 3 frames of the jolt',
            jolt.firstAt >= 0 && jolt.firstAt - jolt.joltAt <= 3 && jolt.mode !== 'asleep', JSON.stringify(jolt));
    await t.eval(function () { window.__mockEnv.tally = null; });

    /* ---- HIDDEN ---------------------------------------------------------------------------- */
    await bedShake(t, true);
    await sleep(700);
    await t.eval(function () { window.__hide(true); });
    await sleep(150);                    // (the frame that was already on its way when the page was hidden)
    await bedWatch(t);
    await sleep(1500);
    var hd = await bedRead(t);
    s.check('HIDDEN: the page hidden while the phone is shaken and the engine has feeds to give: no audio.update at all, nothing reported or played; hold() lets the rush and the shimmer go',
            hd.updates === 0 && hd.fed === 0 && hd.played === 0 && hd.clacks === 0 && hd.holds >= 2 && hd.rushNow === 0 && hd.agitNow === 0, bedBrief(hd) + ' holds ' + hd.holds);
    await t.eval(function () { window.__hide(false); });
    await sleep(300);
    await bedWatch(t);
    await sleep(1500);
    var vs = await bedRead(t);
    s.check('HIDDEN (control): back in view, the same shake is heard again', vs.updates >= 10 && vs.fed >= 8 && vs.agit === 1.2 && vs.rush > 0.05 && vs.played === vs.thumps, bedBrief(vs));

    /* ---- MUTED: what comes out (an analyser on the engine's last node) ----------------------- */
    await t.eval(function () {
      var A = window.Hourglass.audio, an = A.ctx.createAnalyser(), buf = new Float32Array(2048), O = window.__out = { peak: 0 };
      an.fftSize = 2048;
      A.out.connect(an);
      (function poll() {
        an.getFloatTimeDomainData(buf);
        for (var i = 0; i < buf.length; i++) { var v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > O.peak) O.peak = v; }
        requestAnimationFrame(poll);
      })();
    });
    await t.page.tap('#btn-mute');
    await sleep(800);                    // the master's glide to nothing
    await t.eval(function () { window.__out.peak = 0; });
    await bedWatch(t);
    await sleep(1500);
    var mu = await bedRead(t);
    s.check('MUTED: the mute button: the feeds still come and are played into a closed master (target 0); what comes out is silence (peak under 0.001)',
            mu.muted && mu.master === 0 && mu.thumps >= 1 && mu.played >= 1 && mu.peak >= 0 && mu.peak < 0.001, 'peak ' + mu.peak.toExponential(2) + ' ' + bedBrief(mu));
    await t.page.tap('#btn-mute');
    await sleep(500);
    await t.eval(function () { window.__out.peak = 0; });
    await bedWatch(t);
    await sleep(1500);
    var un = await bedRead(t);
    s.check('MUTED (control): unmuted, the same feeds are heard (peak over 0.01)', !un.muted && un.master > 0 && un.thumps >= 1 && un.peak > 0.01, 'peak ' + un.peak.toFixed(4) + ' ' + bedBrief(un));
    // the volume slider at nothing (Tune's own control, moved as a finger moves it)
    var setVolume = function (v) {
      return t.eval(function (v) { var el = document.getElementById('volume'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    };
    await setVolume(0);
    await sleep(800);
    await t.eval(function () { window.__out.peak = 0; });
    await bedWatch(t);
    await sleep(1500);
    var v0 = await bedRead(t);
    await setVolume(80);
    s.check('MUTED: the volume at 0: the same feeds, silence at the output (the unmuted peak above is its control)',
            !v0.muted && v0.master === 0 && v0.thumps >= 1 && v0.peak >= 0 && v0.peak < 0.001, 'peak ' + v0.peak.toExponential(2) + ' ' + bedBrief(v0));
    await bedSay(t, false);
    await bedShake(t, false);

    /* ---- BEDS: nothing said for the engine: its own ears on the chip's records --------------- */
    await t.eval(function () { window.Hourglass.reset(); });
    await waitFor(t, function () { return !document.getElementById('app').classList.contains('sweep') && window.Hourglass.timer.state === 'idle'; }, 8000);
    await sleep(2500);                   // (a new bed settles unheard)
    /** The chip's readbacks from now on: the upper bed (20,000 points) as fn(k) says, k the readback's number; the lower bulb empty. */
    var bedsSay = function (how) {
      return t.eval(function (how) {
        var k = 0, e = window.__mockEnv;
        e.feeds = null;
        e.tally = !how ? null : function () {
          k++;
          var fall = how === 'moved' && k > 20 && k <= 23, stop = how === 'moved' && k > 23 && k <= 27;
          // moved: a quarter of its points sliding at 60 cells a second, its own velocity swinging; then 3 readbacks falling at 160, and stopped
          var vx = how === 'moved' ? 6 * Math.sin(k / 3) : 0, vy = fall ? -160 : (stop ? -8 : 0), sl = how === 'moved' ? 5000 : 0;
          return { moving: 5000, beds: [
            { n: 20000, vx: vx, vy: vy, x: 3, sliding: sl, slide: sl * (60 + Math.sqrt(vx * vx + vy * vy)) },
            { n: 0, vx: 0, vy: 0, x: 0, sliding: 0, slide: 0 }] };
        };
      }, how);
    };
    await bedsSay('rest');
    // (asleep, the chip reports nothing: a jolt of the phone wakes it, and its sand, reported moving, keeps it awake)
    await t.eval(function () { window.__motion.x = 1; setTimeout(function () { window.__motion.x = 0; }, 250); });
    await sleep(900);
    await bedWatch(t);
    await sleep(2000);
    var br = await bedRead(t);
    s.check('BEDS (control): the chip reports its sand awake but the beds at rest (no point sliding): the engine gives the sound nothing',
            br.state === 'idle' && br.mode !== 'asleep' && br.updates >= 10 && br.thumps === 0 && br.slams === 0 && br.slides < 1 && br.agit === 0 && br.played === 0 && br.rush === 0,
            bedBrief(br));
    await bedWatch(t);
    await bedsSay('moved');
    // (27 readbacks hold the slide, the fall and the stop: a second at a calm glass's 30 a second, longer on a busy machine)
    await t.page.waitForFunction(function () { return window.__bed.thumps >= 1; }, null, { timeout: 12000, polling: 100 }).catch(function () {});
    await sleep(1500);
    var bm = await bedRead(t);
    await bedsSay(null);
    var eng = await t.eval(function () { var rs = window.Hourglass.realSand, st = rs.stats(); return { G: rs.Gg, HB: rs.glass.HBc, sound: st.sound || null }; });
    var landing = 160 * 160 / (2 * eng.G * eng.HB);
    s.check('BEDS: the upper bed sliding within itself in the chip\'s records, idle: the real adapter gives slides and agitation, audio.update gets them, the rush sounds',
            bm.state === 'idle' && bm.fed === 0 && bm.slides > 3000 && bm.agit > 0 && bm.rush > 0.05, bedBrief(bm) + ' engine ' + JSON.stringify(eng.sound));
    s.check('BEDS: ... and the bed that fell at 160 cells a second and was stopped by the glass lands once, at the energy of that fall (' + landing.toFixed(4) + ' within a fifth), and is played',
            bm.thumps === 1 && bm.played === 1 && bm.slams === 0 && Math.abs(bm.thumpE / landing - 1) < 0.2, bedBrief(bm));
    await sleep(300);
    await H.invariants(s, t, 'SOUNDS');
  } finally { await t.close(); }
}

async function main() {
  var s = new H.Suite('app-realsand');
  var env = await H.start();
  try {
    var only = env.args.only;
    var cases = { off: testOff, nogpu: testNoGpu, mock: testMock, fail: testFail, stamp: testStamp, again: testAgain,
      slow: testSlow, wake: testWake, life: testLife, norebuild: testNoRebuild, crash: testCrash, residue: testResidue, asleep: testAsleep,
      quiet: testQuiet, sounds: testSounds, defaultna: testDefaultNa, defaultmock: testDefaultMock, migrate: testMigrate, build: testBuild, hang: testHang,
      restart: testRestart };
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
