#!/usr/bin/env node
/*
 * Tune's Sound tab, in the app (settings design 3.3, round 1, step 5): the Sand level, the Bowl
 * level, how often the bowl rings, the ambience's fade before the end, and Sound in silent mode.
 *
 *   LAYOUT    at 393 × 852, 375 × 667 and 320 × 568, with every row shown (an ambience chosen,
 *             its fade on, the bowl on): the tab's rows in the design's order, each slider with
 *             its word and its value ("Sand 100", "Bowl 50"), nothing wider than the sheet, no
 *             sideways scroll, no word cut off, a finger's 44 px for every new control, and
 *             each named for a screen reader as the rows before them are (a radio group with a
 *             name and its radios, switches, labelled sliders); the bowl's rows go while the
 *             bowl is off, the fade's with no ambience, its three lengths while it is off
 *   LEVELS    the Sand and Bowl sliders: saved as v/100 and v/50, told to the sound engine (its
 *             gain for the sand, (v/100)^1.5), shown again after a reload; Bowl rung once let go
 *   RINGS     on a clock moved by the test (Date.now() shifted, as app-sequence does): "Once"
 *             rings no more; "Three times" again 8.5 s and 17 s after the first; "Until a tap"
 *             every 8.5 s, the last no later than 10 minutes after the first; and the first ring
 *             is the bowl as it always was, 0.75 s after the last grain
 *   TAP       while the bowl is still to ring, the first tap on the glass, the first button (the
 *             Tune button) and the first key (F) only stop it (the ringing bowl fades): used up,
 *             they start no glass, open nothing and turn nothing; the next one works as always
 *   TWICE     ... and a second tap 0.25 s after the first (Start, by a finger and by a mouse) is
 *             not eaten with it: only the rest of the first gesture is
 *   TWO       two fingers landing together on the glass while the bowl is to ring again (the
 *             phone picked up, a pinch begun) only stop it: the second finger is of the stopping
 *             gesture, eaten with it, and the glass does not turn; with Rings once, two fingers
 *             do nothing, as always
 *   QUIET     muted, Sound at 0 or Bowl at 0, the rings do not begin and the first tap after the
 *             end works as always; muted, or a slider brought to 0, while they are due, they stop
 *   AWAY      nothing rings while the page is hidden (a locked phone, another app): back on
 *             screen, the rings whose time has passed are dropped, not played late, the next
 *             comes on its time, and after 10 minutes away there is none
 *   ROUNDS    a work and rest sequence (two rounds, "Three times"): between the phases the soft
 *             bowl rings once and the next phase is not held up; the last end rings three times
 *   AWAKE     the rings keep the screen awake (the wake lock held past the 12 s the end has
 *             always had) only with Keep screen awake on; it is let go once they end
 *   ASLEEP    a glass that ran out while the phone slept: the bowl as it comes back, the rings
 *             counted from it (never crowded on it), none past 10 minutes after the real end
 *   BACK      the clock set back an hour after the end: the rings end (with the screen's lock and
 *             the tap they would take); with Rings once, the end's 12 s of screen let go
 *   FADE      the ambience's share as the glass runs out, for each length, at given times left:
 *             (left / stretch)^1.5 inside the stretch, whole before it; a glass shorter than twice
 *             the stretch fades over its last half; 0 once ended; paused it holds; sand added or the
 *             glass turned brings it back up, and the sound engine glides to it (no step from one
 *             frame to the next); in a sequence only the last phase fades; with the switch off the
 *             share is 1 throughout and after the end, as before
 *   SILENT    with navigator.audioSession stubbed: the type is 'playback' (on, as before) or
 *             'ambient' (off), from the launch (off: before any tap; on: as before, at the first
 *             tap) and at once when switched; without one the row says the browser decides by
 *             itself, and switching it throws nothing; a session whose type cannot be set throws
 *             nothing either
 *
 * Every check has its control: the same measurements on a copy of the app with that one thing
 * undone (a line taken out of app.js or audio.js, a rule more in the style sheet), which must
 * fail it. The copy is handed to the page in place of the file it stands for; the tree served is
 * the app as it ships.
 *
 *   node tools/test/app-sound.test.js [--port <n>] [--root <dir>] [--only layout,levels,rings,tap,twice,two,quiet,away,rounds,awake,asleep,back,fade,silent]
 */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./stubs/harness.js');
var paths = require('./lib/paths.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

var KEY = 'hourglass.settings.v1';
var GAP = 8500, MAX = 600000, BOWL = 750, LATE = 2000;           // app.js: RING_GAP, RING_MAX, BOWL_AT, RING_LATE
var SIZES = [[393, 852], [375, 667], [320, 568]];

/* ---- a copy with something broken, for a control ---------------------------------------- */
function broken(env, file, change) {
  var src = fs.readFileSync(path.join(env.root, file), 'utf8'), out = change(src);
  if (out === src) throw new Error('app-sound: the control\'s change to ' + file + ' changed nothing');
  var type = /\.css$/.test(file) ? 'text/css' : /\.html$/.test(file) ? 'text/html' : 'text/javascript';
  var names = file === 'index.html' ? ['/', '/index.html'] : ['/' + file], origin = env.url.replace(/\/$/, '');
  return {
    url: function (u) { return u.origin === origin && names.indexOf(u.pathname) >= 0; },
    handler: function (route) { route.fulfill({ status: 200, contentType: type + '; charset=utf-8', body: out }); }
  };
}
function swap(re, to) {
  return function (src) {
    var n = (src.match(new RegExp(re.source, 'g')) || []).length;
    if (n !== 1) throw new Error('app-sound: a control\'s text is in the file ' + n + ' times: ' + re.source);
    return src.replace(re, to);
  };
}
function add(text) { return function (src) { return src + '\n' + text + '\n'; }; }

/* ---- the page's side: a clock the test moves, a page it hides, a wake lock and an audio session it watches ---- */
function soundInit(arg) {
  var real = Date.now, skew = 0;
  Date.now = function () { return real.call(Date) + skew; };
  window.__jump = function (ms) { skew += ms; };
  window.__hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return window.__hidden; } });
  window.__hide = function (on) { window.__hidden = !!on; document.dispatchEvent(new Event('visibilitychange')); };
  var W = window.__wake = { held: 0, requests: 0, releases: 0 };
  try {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: function () {
      W.requests++; W.held++;
      var lock = new EventTarget(), gone = false;
      lock.release = function () { if (!gone) { gone = true; W.held--; W.releases++; } return Promise.resolve(); };
      return Promise.resolve(lock);
    } } });
  } catch (e) {}
  if (arg && arg.session) {
    var S = window.__session = { type: 'auto', sets: [] };
    var obj = {};
    Object.defineProperty(obj, 'type', {
      get: function () { return S.type; },
      set: function (v) { if (arg.session === 'throws') throw new Error('not allowed'); S.type = v; S.sets.push(v); }
    });
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: obj });
  }
}
/** Once the app runs: every bowl asked for, and every bowl stopped, on the app's clock. */
function watch(t) {
  return t.eval(function () {
    var A = window.Hourglass.audio, w = window.__bowl = { chimes: [], stops: 0, fades: [] };
    var chime = A.chime, stop = A.stopChime, update = A.update;
    window.__setFade = function (L) { document.querySelector('#ambfades [data-fade="' + L + '"]').click(); };   // (Tune's choice, as a tap makes it)
    A.chime = function (delay, soft) { w.chimes.push({ t: Date.now(), delay: delay || 0, soft: !!soft, hidden: document.hidden, state: window.Hourglass.timer.state }); return chime.apply(A, arguments); };
    A.stopChime = function () { w.stops++; return stop.apply(A, arguments); };
    A.update = function (st) {
      w.fades.push({ t: Date.now(), share: st.ambFade, gain: A.ambEnd ? A.ambEnd.gain.value : null, state: window.Hourglass.timer.state, rem: window.Hourglass.timer.rem });
      if (w.fades.length > 4000) w.fades.splice(0, 2000);
      return update.apply(A, arguments);
    };
  });
}
function bowl(t) { return t.eval(function () { return window.__bowl; }); }
function snap(t) {
  return t.eval(function () {
    var Hg = window.Hourglass, T = Hg.timer;
    return { now: Date.now(), state: T.state, rem: T.rem, rings: Hg.debug.rings, flip: Hg.flip.active, phase: Hg.seq.phase, gap: Hg.seq.gap,
             sheet: window.__tune.isOpen(),
             wake: window.__wake ? { held: window.__wake.held, requests: window.__wake.requests } : null };
  });
}
function jump(t, ms) { return t.eval(function (m) { window.__jump(m); }, ms); }
async function until(t, fn, arg, ms) {
  try { await t.page.waitForFunction(fn, arg, { timeout: ms || 15000, polling: 50 }); return true; } catch (e) { return false; }
}

/** A 10 s glass with the rings asked for, run to its end (the clock moved on to 0.4 s before it). → { t, t0, first } */
async function toEnd(env, o) {
  var settings = Object.assign({ durationMs: 10000, bowlRings: 'three', chime: true, keepAwake: true }, o.settings || {});
  var store = {}; store[KEY] = settings;
  var t = await env.open({ storage: store, init: soundInit, initArg: o.initArg || {}, routes: o.routes || [], viewport: o.viewport });
  await sleep(700);
  await watch(t);
  await t.eval(function () { window.Hourglass.audio.unlock(); window.Hourglass.start(); });
  await sleep(200);
  // on to just before the end, a second at a time (the app's clock moves on as a phone's does when it is watched)
  for (var i = 0; i < 40; i++) {
    var s = await snap(t);
    if (s.state === 'done' || s.rem < 1300) break;
    await jump(t, 1000);
    await sleep(40);
  }
  var done = await until(t, function () { return window.Hourglass.timer.state === 'done'; }, null, 8000);
  var b = await bowl(t), s2 = await snap(t);
  return { t: t, done: done, first: b.chimes[0] || null, end: s2, t0: s2.rings ? s2.rings.t0 : (b.chimes[0] ? b.chimes[0].t + BOWL : null) };
}
/** The clock moved to `at` ms after the first ring, then a few frames. */
async function at(t, t0, ms) {
  var now = (await snap(t)).now;
  if (t0 + ms > now) await jump(t, t0 + ms - now);
  await sleep(150);
}
function since(list, n) { return list.slice(n); }

/* ---- LAYOUT ------------------------------------------------------------------------------- */
var ORDER = ['#volume', '#ambiences', '#amb-level', '#opt-ambfade', '#ambfades', '#characters', '#sand-level', '#opt-chime', '#rings', '#bowl-level', '#opt-silent'];
async function layout(env, routes) {
  var out = [];
  for (var i = 0; i < SIZES.length; i++) {
    var st = {}; st[KEY] = { ambience: 'brook', ambFade: 300000, chime: true, tuneTab: 'sound' };
    var t = await env.open({ storage: st, viewport: { width: SIZES[i][0], height: SIZES[i][1] }, routes: routes || [] });
    try {
      await sleep(600);
      await tune.show(t, '#opt-silent');
      var m = await t.eval(function (order) {
        var panel = document.getElementById('panel-sound'), body = panel.closest('.sheet-body') || panel, br = body.getBoundingClientRect();
        var els = order.map(function (q) { return document.querySelector(q); });
        var inOrder = els.every(function (el, k) { return el && (k === 0 || (els[k - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)); });
        var wide = [], small = [], cut = [], seen = [];
        var check = ['#sand-level', '#bowl-level', '#opt-ambfade', '#opt-silent'].map(function (q) { var e = document.querySelector(q); return e.closest('label') || e; })
          .concat(Array.prototype.slice.call(document.querySelectorAll('#rings button, #ambfades button')))
          .concat([document.getElementById('sand-level'), document.getElementById('bowl-level')]);
        check.forEach(function (el) {
          var r = el.getBoundingClientRect(), name = el.id || (el.dataset.rings ? 'rings ' + el.dataset.rings : el.dataset.fade ? 'fade ' + el.dataset.fade : el.className);
          seen.push(name);
          if (r.left < br.left - 0.5 || r.right > br.right + 0.5) wide.push(name + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' in ' + Math.round(br.left) + '..' + Math.round(br.right));
          if (r.height < 44 - 0.01) small.push(name + ' ' + r.height.toFixed(1) + ' px high');
          if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) cut.push(name + ' ' + el.scrollWidth + ' > ' + el.clientWidth);
        });
        var sib = function (id) { var o = document.getElementById(id), lab = o.closest('label').querySelector('.lab'); return (lab.textContent || '').trim() + ' ' + o.textContent; };
        var aria = [];
        [['#rings', 'Rings'], ['#ambfades', 'Fade out over']].forEach(function (g) {
          var el = document.querySelector(g[0]), named = el.getAttribute('aria-label') || (document.getElementById(el.getAttribute('aria-labelledby') || '') || {}).textContent;
          if (el.getAttribute('role') !== 'radiogroup' || named !== g[1]) aria.push(g[0] + ' is ' + el.getAttribute('role') + ' named ' + JSON.stringify(named));
          var radios = el.querySelectorAll('button[role="radio"]'), on = el.querySelectorAll('button[aria-checked="true"]');
          if (radios.length !== 3 || on.length !== 1) aria.push(g[0] + ': ' + radios.length + ' radios, ' + on.length + ' checked');
        });
        ['#opt-ambfade', '#opt-silent'].forEach(function (q) {
          var el = document.querySelector(q);
          if (el.getAttribute('role') !== 'switch' || el.type !== 'checkbox' || !el.closest('label.row') || !el.closest('label.row').querySelector('b')) aria.push(q + ' is no named switch');
        });
        ['#sand-level', '#bowl-level'].forEach(function (q) { if (!document.querySelector(q).getAttribute('aria-label')) aria.push(q + ' has no name'); });
        return {
          inOrder: inOrder, wide: wide, small: small, cut: cut, aria: aria, n: seen.length,
          sideways: [document.documentElement.scrollWidth - window.innerWidth, body.scrollWidth - body.clientWidth, panel.scrollWidth - panel.clientWidth],
          words: { sand: sib('sand-level-out'), bowl: sib('bowl-level-out') },
          names: Array.prototype.map.call(document.querySelectorAll('#rings button, #ambfades button'), function (b) { return b.textContent.trim(); }),
          rows: [(document.querySelector('label[for="opt-ambfade"] b') || {}).textContent, (document.querySelector('label[for="opt-silent"] b') || {}).textContent]
        };
      }, ORDER);
      // what comes and goes: the bowl off, no ambience, the fade off
      m.hiding = await t.eval(function () {
        var shown = function (id) { var e = document.getElementById(id); return !!e && e.getClientRects().length > 0; }, out = {};
        out.before = [shown('bowl-sub'), shown('ambfade-rows'), shown('ambfade-sub')];
        document.getElementById('opt-chime').click();
        document.getElementById('opt-ambfade').click();
        out.off = [shown('bowl-sub'), shown('ambfade-sub')];
        document.querySelector('#ambiences [data-ambience="none"]').click();
        out.none = shown('ambfade-rows');
        document.getElementById('opt-chime').click();
        document.querySelector('#ambiences [data-ambience="rain"]').click();
        out.back = [shown('bowl-sub'), shown('ambfade-rows'), shown('ambfade-sub')];
        return out;
      });
      m.size = SIZES[i].join(' x ');
      m.errors = t.errors.slice();
      out.push(m);
    } finally { await t.close(); }
  }
  return out;
}
function layoutOk(list) {
  var ok = {}, all = function (f) { return list.every(f); }, say = function (f) { return list.map(function (m) { return m.size + ': ' + f(m); }).join('; '); };
  ok.order = { ok: all(function (m) { return m.inOrder && m.rows.join('|') === 'Fade out before the end|Sound in silent mode' &&
                                       m.names.join('|') === 'Last minute|Last 5 min|Last 10 min|Once|Three times|Until a tap' &&
                                       m.words.sand === 'Sand 100' && m.words.bowl === 'Bowl 50'; }),
               detail: say(function (m) { return (m.inOrder ? 'in order' : 'OUT OF ORDER') + ', ' + m.words.sand + ', ' + m.words.bowl + ', ' + m.names.join('/'); }) };
  ok.fit = { ok: all(function (m) { return m.wide.length === 0 && m.cut.length === 0 && m.sideways.every(function (x) { return x <= 0; }); }),
             detail: say(function (m) { return 'sideways ' + m.sideways.join('/') + (m.wide.length ? '; wider than the sheet: ' + m.wide.join(', ') : '') + (m.cut.length ? '; cut: ' + m.cut.join(', ') : ''); }) };
  ok.hit = { ok: all(function (m) { return m.small.length === 0 && m.n >= 12; }), detail: say(function (m) { return m.n + ' controls' + (m.small.length ? ', under 44 px: ' + m.small.join(', ') : ', each 44 px or more'); }) };
  ok.aria = { ok: all(function (m) { return m.aria.length === 0; }), detail: say(function (m) { return m.aria.join(', ') || 'named'; }) };
  ok.hiding = { ok: all(function (m) { var h = m.hiding; return h.before.join() === 'true,true,true' && h.off.join() === 'false,false' && h.none === false && h.back.join() === 'true,true,false'; }),
                detail: say(function (m) { return JSON.stringify(m.hiding); }) };
  ok.errors = { ok: all(function (m) { return m.errors.length === 0; }), detail: say(function (m) { return m.errors.slice(0, 2).join(' | ') || 'none'; }) };
  return ok;
}

/* ---- LEVELS ------------------------------------------------------------------------------- */
async function levels(env, routes) {
  var t = await env.open({ routes: routes || [] }), m = {};
  try {
    await sleep(600);
    await watch(t);
    await t.eval(function () { window.Hourglass.audio.unlock(); });
    await tune.show(t, '#sand-level');
    await t.eval(function () {
      var s = document.getElementById('sand-level'); s.value = '40'; s.dispatchEvent(new Event('input', { bubbles: true }));
      var b = document.getElementById('bowl-level'); b.value = '80'; b.dispatchEvent(new Event('input', { bubbles: true })); b.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(600);
    m.after = await t.eval(function (k) {
      var A = window.Hourglass.audio;
      return { saved: JSON.parse(localStorage.getItem(k)), sand: A.sandLevel, bowl: A.bowlLevel, gain: A.gSand ? A.gSand.gain.value : null, running: A.isRunning(),
               out: [document.getElementById('sand-level-out').textContent, document.getElementById('bowl-level-out').textContent], chimes: window.__bowl.chimes.length };
    }, KEY);
    await t.reload();
    await sleep(500);
    m.reloaded = await t.eval(function () {
      var A = window.Hourglass.audio;
      return { sand: document.getElementById('sand-level').value, bowl: document.getElementById('bowl-level').value, engine: [A.sandLevel, A.bowlLevel] };
    });
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function levelsOk(m) {
  var a = m.after, law = Math.pow(0.4, 1.5);
  return {
    saved: { ok: a.saved.sandLevel === 0.4 && a.saved.bowlLevel === 1.6 && a.out.join() === '40,80' && m.reloaded.sand === '40' && m.reloaded.bowl === '80' && m.reloaded.engine.join() === '0.4,1.6',
             detail: 'saved sandLevel ' + a.saved.sandLevel + ', bowlLevel ' + a.saved.bowlLevel + '; shown ' + a.out.join(', ') + '; after a reload ' + JSON.stringify(m.reloaded) },
    told: { ok: a.sand === 0.4 && a.bowl === 1.6 && a.running && Math.abs(a.gain - law) < 0.01 && a.chimes === 1 && m.errors.length === 0,
            detail: 'the engine: sand ' + a.sand + ' (its gain ' + (a.gain == null ? '?' : a.gain.toFixed(3)) + ' for ' + law.toFixed(3) + '), bowl ' + a.bowl + '; ' + a.chimes + ' bowl rung once let go; ' + (m.errors.join(' | ') || 'no errors') }
  };
}

/* ---- RINGS -------------------------------------------------------------------------------- */
async function rings(env, routes) {
  var out = {};
  // Once: as it always was
  var r = await toEnd(env, { settings: { bowlRings: 'once' }, routes: routes });
  try {
    var n0 = (await bowl(r.t)).chimes.length, s0 = await snap(r.t);
    await at(r.t, r.t0, GAP + 100); await at(r.t, r.t0, 2 * GAP + 100); await at(r.t, r.t0, 60000);
    out.once = { done: r.done, first: r.first, rings: s0.rings, more: (await bowl(r.t)).chimes.length - n0 };
  } finally { await r.t.close(); }
  // Three times
  r = await toEnd(env, { settings: { bowlRings: 'three' }, routes: routes });
  try {
    var t = r.t, b0 = (await bowl(t)).chimes.length, s1 = await snap(r.t), times = [];
    await at(t, r.t0, GAP - 600); var before1 = (await bowl(t)).chimes.length - b0;
    await at(t, r.t0, GAP + 40); await sleep(100);
    await at(t, r.t0, 2 * GAP - 600); var before2 = (await bowl(t)).chimes.length - b0;
    await at(t, r.t0, 2 * GAP + 40); await sleep(100);
    await at(t, r.t0, 3 * GAP + 40); await at(t, r.t0, 60000);
    var b = await bowl(t);
    since(b.chimes, b0).forEach(function (c) { times.push(c.t - r.t0); });
    out.three = { done: r.done, first: r.first, t0: r.t0, endAt: r.end.now, rings0: s1.rings, before1: before1, before2: before2, times: times, after: (await snap(t)).rings, soft: since(b.chimes, b0).some(function (c) { return c.soft || c.delay; }) };
  } finally { await r.t.close(); }
  // Until a tap: every 8.5 s, and no later than 10 minutes after the first
  r = await toEnd(env, { settings: { bowlRings: 'tap' }, routes: routes });
  try {
    var tt = r.t, c0 = (await bowl(tt)).chimes.length, s2 = await snap(tt);
    for (var k = 1; k <= 3; k++) { await at(tt, r.t0, k * GAP + 40); await sleep(60); }
    var three = (await bowl(tt)).chimes.length - c0;
    // on to just after the 70th (the last within 10 minutes: 595 s); those in between are long past and dropped
    await at(tt, r.t0, 70 * GAP + 300); await sleep(100);
    var at70 = (await bowl(tt)).chimes.length - c0, live = (await snap(tt)).rings;
    await at(tt, r.t0, 71 * GAP + 100); await sleep(100);
    await at(tt, r.t0, MAX + 30000); await sleep(100);
    var bb = await bowl(tt);
    out.tap = { rings0: s2.rings, three: three, at70: at70, live: live, total: bb.chimes.length - c0, last: bb.chimes[bb.chimes.length - 1].t - r.t0,
                times: since(bb.chimes, c0).map(function (c) { return c.t - r.t0; }), after: (await snap(tt)).rings };
  } finally { await r.t.close(); }
  return out;
}
function ringsOk(m) {
  var o = m.once, th = m.three, tp = m.tap;
  var near = function (x, want) { return x >= want && x <= want + 400; };
  return {
    first: { ok: !!th.first && th.first.delay === 0.75 && !th.first.soft && Math.abs(th.t0 - (th.first.t + BOWL)) <= 50 && !!o.first && o.first.delay === 0.75,
             detail: 'the first bowl asked for with delay ' + (th.first && th.first.delay) + ' s at the end; the rings counted from ' + (th.t0 - (th.first ? th.first.t : 0)) + ' ms after it' },
    once: { ok: o.done && o.rings === null && o.more === 0, detail: 'Once: rings ' + JSON.stringify(o.rings) + ', ' + o.more + ' more bowls in the next minute' },
    three: { ok: th.done && th.rings0 && th.rings0.n === 2 && th.before1 === 0 && th.before2 === 1 && th.times.length === 2 && near(th.times[0], GAP) && near(th.times[1], 2 * GAP) && th.after === null && !th.soft,
             detail: 'Three times: rings at ' + th.times.join(', ') + ' ms after the first (8500, 17000 asked), none before their time (' + th.before1 + ', ' + th.before2 + '), none after; then ' + JSON.stringify(th.after) },
    tap: { ok: tp.rings0 && tp.rings0.n === 70 && tp.three === 3 && tp.at70 === 4 && tp.live === null && tp.total === 4 && near(tp.last, 70 * GAP) && tp.after === null,
           detail: 'Until a tap: ' + tp.three + ' rings in the first 26 s, then (the clock moved to 595.3 s) the 70th at ' + tp.last + ' ms, ' + tp.total + ' in all; past 10 minutes none, and then ' + JSON.stringify(tp.after) +
                   ' (times ' + tp.times.join(', ') + ')' }
  };
}

/* ---- TAP: the first tap, button or key only stops the bowl ---------------------------------- */
async function taps(env, routes) {
  var out = {};
  var ways = [
    ['glass', async function (t) { var g = await t.glass(); await t.page.touchscreen.tap(g.cx, g.cy); }],
    ['button', async function (t) { var b = await t.eval(function () { var r = document.getElementById('btn-settings').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); await t.page.touchscreen.tap(b.x, b.y); }],
    ['key', async function (t) { await t.page.keyboard.press('f'); }]
  ];
  for (var i = 0; i < ways.length; i++) {
    var r = await toEnd(env, { settings: { bowlRings: 'tap' }, routes: routes }), t = r.t;
    try {
      await sleep(1200);                                        // (the first bowl is ringing)
      var b0 = await bowl(t), before = await snap(t);
      await ways[i][1](t);
      await sleep(500);
      var first = await snap(t), b1 = await bowl(t);
      // the bowl that rang was stopped, and no more come
      await at(t, r.t0, 3 * GAP);
      var quiet = (await bowl(t)).chimes.length - b1.chimes.length, still = await snap(t);
      await ways[i][1](t);
      await sleep(900);
      var second = await snap(t);
      out[ways[i][0]] = { due: !!before.rings, stops: b1.stops - b0.stops, first: first, quiet: quiet, still: still, second: second, errors: t.errors.slice() };
    } finally { await t.close(); }
  }
  return out;
}
function tapsOk(m) {
  var used = function (x) { return x.due && x.stops === 1 && x.first.rings === null && x.first.state === 'done' && !x.first.flip && !x.first.sheet && x.quiet === 0 && x.still.state === 'done' && !x.still.flip && !x.still.sheet; };
  var g = m.glass, b = m.button, k = m.key;
  var d = function (x) { return 'stopped ' + x.stops + ', then rings ' + JSON.stringify(x.first.rings) + ', ' + x.first.state + (x.first.flip ? ' TURNING' : '') + (x.first.sheet ? ' TUNE OPEN' : '') + ', ' + x.quiet + ' bowls after'; };
  return {
    glass: { ok: used(g) && (g.second.flip || g.second.state === 'running'), detail: 'the glass: ' + d(g) + '; the next tap: ' + (g.second.flip ? 'the glass turns' : g.second.state) },
    button: { ok: used(b) && b.second.sheet, detail: 'the Tune button: ' + d(b) + '; the next tap: ' + (b.second.sheet ? 'Tune opens' : 'NOTHING') },
    key: { ok: used(k) && k.second.flip, detail: 'the F key: ' + d(k) + '; the next: ' + (k.second.flip ? 'the glass turns' : 'NOTHING') },
    errors: { ok: g.errors.length + b.errors.length + k.errors.length === 0, detail: g.errors.concat(b.errors, k.errors).slice(0, 3).join(' | ') }
  };
}

/* ---- TWICE: the first tap is used up, a second one 0.25 s later is not ---------------------- */
async function twice(env, routes) {
  var out = {};
  var ways = [
    ['finger', function (t, p) { return t.page.touchscreen.tap(p.x, p.y); }],
    ['mouse', function (t, p) { return t.page.mouse.click(p.x, p.y); }]
  ];
  for (var i = 0; i < ways.length; i++) {
    var r = await toEnd(env, { settings: { bowlRings: 'tap' }, routes: routes }), t = r.t;
    try {
      await sleep(1200);                                        // (the first bowl is ringing)
      var p = await t.eval(function () { var b = document.getElementById('btn-play').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      var before = await snap(t);
      await ways[i][1](t, p);
      await sleep(250);
      var first = await snap(t);
      await ways[i][1](t, p);
      await sleep(900);
      out[ways[i][0]] = { due: !!before.rings, first: first, second: await snap(t), errors: t.errors.slice() };
    } finally { await t.close(); }
  }
  return out;
}
function twiceOk(m) {
  var one = function (x) {
    return { ok: x.due && x.first.rings === null && x.first.state === 'done' && !x.first.flip && (x.second.flip || x.second.state === 'running') && !x.errors.length,
             detail: 'the first tap on Start: rings ' + JSON.stringify(x.first.rings) + ', ' + x.first.state + (x.first.flip ? ' TURNING' : '') +
                     '; the second, 0.25 s later: ' + (x.second.flip ? 'the glass turns' : x.second.state === 'running' ? 'the glass runs' : 'NOTHING (' + x.second.state + ')') + (x.errors.length ? '; ' + x.errors.slice(0, 2).join(' | ') : '') };
  };
  return { finger: one(m.finger), mouse: one(m.mouse) };
}

/* ---- TWO: two fingers landing together while the bowl is due are one gesture, used up ------- */
async function two(env, routes) {
  var out = {};
  for (var rings of ['tap', 'once']) for (var where of ['top', 'middle']) {
    var r = await toEnd(env, { settings: { bowlRings: rings }, routes: routes }), t = r.t;
    try {
      await sleep(1200);
      var g = await t.glass(), y = where === 'top' ? g.top + g.h * 0.2 : g.cy;
      var before = await snap(t);
      await t.touch.fingers('touchStart', [[g.cx - g.w * 0.12, y], [g.cx + g.w * 0.12, y + 6]]);
      await sleep(60);
      await t.touch.up();
      await sleep(900);
      out[rings + '-' + where] = { due: !!before.rings, after: await snap(t), errors: t.errors.slice() };
    } finally { await t.close(); }
  }
  return out;
}
function twoOk(m) {
  var one = function (x, due) {
    return { ok: x.due === due && x.after.rings === null && x.after.state === 'done' && !x.after.flip && !x.errors.length,
             detail: (due ? 'Until a tap, the bowl due' : 'Once, nothing due') + ': after two fingers together, rings ' + JSON.stringify(x.after.rings) + ', ' + x.after.state +
                     (x.after.flip ? ', the glass TURNING' : ', not turned') + (x.errors.length ? '; ' + x.errors.slice(0, 2).join(' | ') : '') };
  };
  return { top: one(m['tap-top'], true), middle: one(m['tap-middle'], true), onceTop: one(m['once-top'], false), onceMiddle: one(m['once-middle'], false) };
}

/* ---- QUIET: rings that cannot be heard are not rung, and take no tap ------------------------ */
async function quiet(env, routes) {
  var out = {};
  var silent = [['muted', { muted: true }], ['sound0', { volume: 0 }], ['bowl0', { bowlLevel: 0 }]];
  for (var i = 0; i < silent.length; i++) {
    var r = await toEnd(env, { settings: Object.assign({ bowlRings: 'tap' }, silent[i][1]), routes: routes }), t = r.t;
    try {
      await sleep(600);
      var end = await snap(t), g = await t.glass();
      await t.page.touchscreen.tap(g.cx, g.cy);
      await sleep(700);
      out[silent[i][0]] = { done: r.done, rings: end.rings, after: await snap(t), errors: t.errors.slice() };
    } finally { await t.close(); }
  }
  // turned inaudible while the rings are due (a slider still held from before the end, the Mute button): they stop
  var ways = [
    ['toMute', function () { document.getElementById('btn-mute').click(); }],
    ['toSound0', function () { var v = document.getElementById('volume'); v.value = 0; v.dispatchEvent(new Event('input', { bubbles: true })); }],
    ['toBowl0', function () { var v = document.getElementById('bowl-level'); v.value = 0; v.dispatchEvent(new Event('input', { bubbles: true })); }]
  ];
  for (var j = 0; j < ways.length; j++) {
    var q = await toEnd(env, { settings: { bowlRings: 'tap' }, routes: routes }), u = q.t;
    try {
      await sleep(600);
      var due = await snap(u);
      await u.eval(ways[j][1]);
      await sleep(300);
      out[ways[j][0]] = { due: due.rings, after: await snap(u), errors: u.errors.slice() };
    } finally { await u.close(); }
  }
  return out;
}
function quietOk(m) {
  var arm = function (x, what) {
    return { ok: x.done && x.rings === null && (x.after.flip || x.after.state === 'running') && !x.errors.length,
             detail: what + ', Until a tap, the glass run out: rings ' + JSON.stringify(x.rings) + '; the first tap on the glass: ' + (x.after.flip ? 'it turns' : x.after.state === 'running' ? 'it runs' : 'NOTHING (' + x.after.state + ')') + (x.errors.length ? '; ' + x.errors.join(' | ') : '') };
  };
  var stop = function (x, what) {
    return { ok: !!x.due && x.after.rings === null && !x.errors.length, detail: what + ' while the rings are due: rings ' + JSON.stringify(x.due) + ' -> ' + JSON.stringify(x.after.rings) + (x.errors.length ? '; ' + x.errors.join(' | ') : '') };
  };
  return { muted: arm(m.muted, 'muted'), sound0: arm(m.sound0, 'Sound at 0'), bowl0: arm(m.bowl0, 'Bowl at 0'),
           toMute: stop(m.toMute, 'muted'), toSound0: stop(m.toSound0, 'Sound brought to 0'), toBowl0: stop(m.toBowl0, 'Bowl brought to 0') };
}

/* ---- AWAY: hidden, nothing rings; back, nothing late --------------------------------------- */
async function away(env, routes) {
  var out = {};
  var r = await toEnd(env, { settings: { bowlRings: 'tap' }, routes: routes }), t = r.t;
  try {
    var c0 = (await bowl(t)).chimes.length;
    await t.eval(function () { window.__hide(true); });
    for (var sec = 1; sec <= 30; sec++) { await at(t, r.t0, sec * 1000 + 200); }   // 8.5, 17 and 25.5 s pass while hidden, a second at a time
    var hidden = (await bowl(t)).chimes.length - c0;
    await t.eval(function () { window.__hide(false); });
    await sleep(600);
    var back = (await bowl(t)).chimes.length - c0, rs = (await snap(t)).rings;
    await at(t, r.t0, 4 * GAP + 60); await sleep(100);             // the next, on its time
    var b = await bowl(t);
    out.short = { hidden: hidden, back: back, rings: rs, next: b.chimes.length - c0, nextAt: b.chimes[b.chimes.length - 1].t - r.t0 };
    // away for longer than the 10 minutes
    await t.eval(function () { window.__hide(true); });
    await at(t, r.t0, MAX + 60000); await sleep(300);
    await t.eval(function () { window.__hide(false); });
    await sleep(600);
    out.long = { more: (await bowl(t)).chimes.length - b.chimes.length, rings: (await snap(t)).rings };
    out.errors = t.errors.slice();
  } finally { await t.close(); }
  return out;
}
function awayOk(m) {
  var s = m.short, l = m.long;
  return {
    hidden: { ok: s.hidden === 0, detail: s.hidden + ' bowls rung while hidden (three rings came due)' },
    late: { ok: s.back === 0 && s.rings && s.rings.k === 4 && s.next === 1 && s.nextAt >= 4 * GAP && s.nextAt <= 4 * GAP + 400,
            detail: 'back on screen: ' + s.back + ' late bowls, the next ring ' + (s.rings && s.rings.k) + ', rung at ' + s.nextAt + ' ms (' + 4 * GAP + ' asked)' },
    long: { ok: l.more === 0 && l.rings === null && m.errors.length === 0, detail: 'back after 11 minutes: ' + l.more + ' bowls, rings ' + JSON.stringify(l.rings) + (m.errors.length ? '; ' + m.errors.join(' | ') : '') }
  };
}

/* ---- ROUNDS: between phases once, softly, and never held ------------------------------------ */
async function rounds(env, routes) {
  var st = {}; st[KEY] = { durationMs: 10000, restMs: 10000, rounds: 2, bowlRings: 'three', chime: true };
  var t = await env.open({ storage: st, init: soundInit, routes: routes || [] }), m = { gaps: [], ringsInPhases: [] };
  try {
    await sleep(700);
    await watch(t);
    await t.eval(function () { window.Hourglass.audio.unlock(); window.Hourglass.start(); });
    var lastGap = 0, gapSeen = 0, end = Date.now() + 90000;
    while (Date.now() < end) {
      var s = await snap(t);
      if (s.state === 'done') break;
      if (s.rings) m.ringsInPhases.push(s.phase);
      if (s.gap && !lastGap) gapSeen = Date.now();
      if (!s.gap && lastGap) m.gaps.push(Date.now() - gapSeen);     // how long a turn between phases held the next one (real ms)
      lastGap = s.gap;
      if (s.state === 'running' && !s.gap && s.rem > 1400) await jump(t, 1000);
      await sleep(40);
    }
    await sleep(300);
    var b = await bowl(t), fin = await snap(t);
    m.chimes = b.chimes; m.final = fin;
    var n = b.chimes.length;
    if (fin.rings) { await at(t, fin.rings.t0, GAP + 60); await sleep(100); await at(t, fin.rings.t0, 2 * GAP + 60); await sleep(100); }
    m.after = (await bowl(t)).chimes.slice(n).map(function (c) { return { t: c.t - fin.rings.t0, soft: c.soft }; });
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function roundsOk(m) {
  var soft = m.chimes.filter(function (c) { return c.soft; }), hard = m.chimes.filter(function (c) { return !c.soft; });
  return {
    between: { ok: soft.length === 3 && m.ringsInPhases.length === 0 && m.gaps.length === 3 && m.gaps.every(function (g) { return g <= 1200 + 2600 + 1500; }),
               detail: soft.length + ' soft bowls between the four phases (3 asked), the rings never due in a phase (' + m.ringsInPhases.length + ' frames where they were); each turn held the next phase ' + m.gaps.join(', ') + ' ms (the turn itself 3800)' },
    last: { ok: m.final.state === 'done' && hard.length === 1 && !!m.final.rings && m.final.rings.n === 2 && m.after.length === 2 && m.after.every(function (c) { return !c.soft; }) && m.errors.length === 0,
            detail: 'the last end: ' + hard.length + ' bowl, rings ' + JSON.stringify(m.final.rings) + ', then ' + JSON.stringify(m.after) + (m.errors.length ? '; ' + m.errors.join(' | ') : '') }
  };
}

/* ---- AWAKE: the rings keep the screen on only with Keep screen awake ------------------------- */
async function awake(env, routes) {
  var out = {};
  for (var on = 1; on >= 0; on--) {
    var r = await toEnd(env, { settings: { bowlRings: 'three', keepAwake: !!on }, routes: routes }), t = r.t;
    try {
      await at(t, r.t0, 13000);                                   // past the 12 s an end has always kept the screen on
      await t.eval(function () { window.__hide(false); });        // (anything that asks again whether to keep it: here a visibilitychange)
      await sleep(300);
      var mid = await snap(t);
      await at(t, r.t0, 2 * GAP + 60); await sleep(400);          // the last ring
      var after = await snap(t);
      out[on ? 'on' : 'off'] = { mid: mid.wake, rings: mid.rings, after: after.wake, ringsAfter: after.rings };
    } finally { await t.close(); }
  }
  return out;
}
function awakeOk(m) {
  return {
    on: { ok: !!m.on.rings && m.on.mid.held === 1 && m.on.ringsAfter === null && m.on.after.held === 0,
          detail: 'Keep screen awake on: 13 s after the end, with rings to come, the lock held ' + m.on.mid.held + '; after the last ring held ' + m.on.after.held },
    off: { ok: !!m.off.rings && m.off.mid.requests === 0 && m.off.after.requests === 0, detail: 'Keep screen awake off: ' + m.off.mid.requests + ' requests for the lock with rings to come' }
  };
}

/* ---- BACK: the clock set back an hour after the end ------------------------------------------- */
async function back(env, routes) {
  var out = {};
  var cases = [['tap', 'tap'], ['once', 'once']];
  for (var i = 0; i < cases.length; i++) {
    var r = await toEnd(env, { settings: { bowlRings: cases[i][1], keepAwake: true }, routes: routes }), t = r.t;
    try {
      await sleep(600);
      var before = await snap(t);
      await jump(t, -3600000);
      await t.eval(function () { window.__hide(false); });        // (anything that asks again whether to keep the screen on)
      await sleep(400);
      var after = await snap(t), g = await t.glass();
      await t.page.touchscreen.tap(g.cx, g.cy);
      await sleep(700);
      out[cases[i][0]] = { before: before, after: after, tapped: await snap(t), errors: t.errors.slice() };
    } finally { await t.close(); }
  }
  return out;
}
function backOk(m) {
  var a = m.tap, o = m.once;
  return {
    rings: { ok: !!a.before.rings && a.before.wake.held === 1 && a.after.rings === null && a.after.wake.held === 0 && (a.tapped.flip || a.tapped.state === 'running') && !a.errors.length,
             detail: 'Until a tap, the clock set back an hour: rings ' + JSON.stringify(a.before.rings) + ' -> ' + JSON.stringify(a.after.rings) + ', the screen lock held ' + a.before.wake.held + ' -> ' + a.after.wake.held +
                     '; the next tap on the glass: ' + (a.tapped.flip ? 'it turns' : a.tapped.state) },
    once: { ok: o.before.rings === null && o.before.wake.held === 1 && o.after.wake.held === 0 && !o.errors.length,
            detail: 'Once, the clock set back an hour within the 12 s after the end: the screen lock held ' + o.before.wake.held + ' -> ' + o.after.wake.held }
  };
}

/* ---- ASLEEP: the glass ran out while the phone slept --------------------------------------- */
async function asleep(env, routes) {
  var out = {};
  var cases = [['three', 'three', 8000], ['long', 'tap', 660000]];
  for (var i = 0; i < cases.length; i++) {
    var st = {}; st[KEY] = { durationMs: 10000, chime: true, bowlRings: cases[i][1] };
    var t = await env.open({ storage: st, init: soundInit, routes: routes || [] });
    try {
      await sleep(700);
      await watch(t);
      await t.eval(function () { window.Hourglass.audio.unlock(); window.Hourglass.start(); });
      await sleep(300);
      var rem = await t.eval(function () { return window.Hourglass.timer.rem; });
      await jump(t, rem + cases[i][2]);                           // asleep: the clock moves past the end in one step, no frame between
      for (var k = 0; k < 80; k++) { await sleep(60); await jump(t, 250); }   // awake: 20 s on the app's clock, a quarter second at a time
      await sleep(300);
      var b = await bowl(t), sn = await snap(t);
      out[cases[i][0]] = { state: sn.state, rings: sn.rings, bowls: b.chimes.map(function (c) { return c.t + c.delay * 1000; }), errors: t.errors.slice() };
    } finally { await t.close(); }
  }
  return out;
}
function asleepOk(m) {
  var th = m.three, lg = m.long, after = [];
  for (var i = 1; i < th.bowls.length; i++) after.push(th.bowls[i] - th.bowls[0]);   // (the test's clock moves a quarter second at a time)
  return {
    three: { ok: th.state === 'done' && th.bowls.length === 3 && after.every(function (g, k) { return g >= (k + 1) * GAP && g <= (k + 1) * GAP + 400; }) && !th.errors.length,
             detail: 'Three times, the end found 8 s late: ' + th.bowls.length + ' bowls, the rings ' + after.join(' and ') + ' ms after the first (' + GAP + ' and ' + 2 * GAP + ' asked)' },
    long: { ok: lg.state === 'done' && lg.bowls.length === 1 && lg.rings === null && !lg.errors.length,
            detail: 'Until a tap, the end found 11 minutes late: ' + lg.bowls.length + ' bowl (the end\'s, late), then rings ' + JSON.stringify(lg.rings) }
  };
}

/* ---- FADE --------------------------------------------------------------------------------- */
// the share for each length, at given times left, on a 30-minute glass; and on glasses shorter than twice the length
var FADE_AT = [[2, 1], [1, 1], [0.5, Math.pow(0.5, 1.5)], [0.25, 0.125], [0.01, Math.pow(0.01, 1.5)]];
async function fade(env, routes) {
  var m = { table: [], short: [] };
  var st = {}; st[KEY] = { ambience: 'brook', ambFade: 300000, durationMs: 1800000 };
  var t = await env.open({ storage: st, init: soundInit, routes: routes || [] });
  try {
    await sleep(700);
    await watch(t);
    m.table = await t.eval(function (a) {
      var Hg = window.Hourglass, T = Hg.timer, out = [], was = [T.state, T.rem, T.durationMs];
      [60000, 300000, 600000].forEach(function (L) {
        window.__setFade(L);
        T.state = 'running';
        a.forEach(function (p) { T.rem = p[0] * L; out.push({ L: L, x: p[0], got: Hg.debug.ambFadeShare(), want: p[1] }); });
      });
      T.state = 'done'; T.rem = 0; out.push({ L: 'ended', got: Hg.debug.ambFadeShare(), want: 0 });
      T.state = was[0]; T.rem = was[1];
      return out;
    }, FADE_AT);
    // a glass shorter than twice the length: the fade takes its last half
    m.short = await t.eval(function () {
      var Hg = window.Hourglass, T = Hg.timer, out = [], was = [T.state, T.rem, T.durationMs];
      [[240000, 300000], [60000, 60000], [900000, 600000]].forEach(function (c) {
        window.__setFade(c[1]); T.durationMs = c[0]; T.state = 'running';
        var half = Math.min(c[1], c[0] / 2);
        [[c[0], 1], [half * 1.01, 1], [half / 2, Math.pow(0.5, 1.5)], [half / 4, 0.125]].forEach(function (p) { T.rem = p[0]; out.push({ len: c[0], L: c[1], rem: p[0], got: Hg.debug.ambFadeShare(), want: p[1] }); });
      });
      T.state = was[0]; T.rem = was[1]; T.durationMs = was[2];
      return out;
    });
    // a running glass in its last stretch: paused it holds; turned over it comes back up, and the engine glides there
    await t.eval(function () { window.__setFade(600000); window.Hourglass.audio.unlock(); window.Hourglass.start(); });
    await sleep(300);
    await t.eval(function () { var T = window.Hourglass.timer; window.__jump(T.rem - 120000); });   // 2 minutes left of the last 10
    await sleep(800);
    var pz = await t.eval(function () { window.Hourglass.pause(); var Hg = window.Hourglass; return { share: Hg.debug.ambFadeShare(), rem: Hg.timer.rem }; });
    await sleep(1200);
    m.paused = { at: pz, later: await t.eval(function () { var Hg = window.Hourglass; return { share: Hg.debug.ambFadeShare(), rem: Hg.timer.rem, state: Hg.timer.state }; }) };
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(800);
    /** The engine's gain over the frames since n0: its lowest, its highest, and its largest change from one frame to the next, per 1/60 s. */
    async function glide(n0) {
      var f = (await bowl(t)).fades.slice(n0).filter(function (x) { return x.gain != null; }), step = 0, lo = 1, hi = 0;
      for (var i = 1; i < f.length; i++) step = Math.max(step, Math.abs(f[i].gain - f[i - 1].gain) * (1000 / 60) / Math.max(1000 / 60, f[i].t - f[i - 1].t));
      f.forEach(function (x) { lo = Math.min(lo, x.gain); hi = Math.max(hi, x.gain); });
      return { frames: f.length, step: step, lo: lo, hi: hi, share0: f.length ? f[0].share : null, share1: f.length ? f[f.length - 1].share : null };
    }
    // sand added (the Sand button held 1.5 s pours more): the share rises with the time left, gliding
    var n1 = (await bowl(t)).fades.length;
    await t.eval(function () { document.getElementById('btn-sand').focus(); });
    await t.page.keyboard.down(' ');
    await sleep(1500);
    await t.page.keyboard.up(' ');
    await sleep(1500);
    m.added = await glide(n1);
    m.added.rem = (await snap(t)).rem;
    var n0 = (await bowl(t)).fades.length;
    await t.eval(function () { window.Hourglass.flipNow(false); });
    await sleep(4500);
    m.turned = await glide(n0);
    m.turned.rem = (await snap(t)).rem;
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  // the switch off: the share is 1 to the end and after it, as before
  st = {}; st[KEY] = { ambience: 'brook', ambFade: 0, durationMs: 10000, bowlRings: 'once' };
  var r = await toEnd(env, { settings: st[KEY], routes: routes });
  try {
    await sleep(2500);
    var all = (await bowl(r.t)).fades;
    m.off = { n: all.length, shares: all.filter(function (x) { return x.share !== 1; }).length, gains: all.filter(function (x) { return x.gain != null && x.gain !== 1; }).length, done: r.done,
              ended: all.filter(function (x) { return x.state === 'done'; }).length };
  } finally { await r.t.close(); }
  // a sequence: only its last phase fades
  st = {}; st[KEY] = { ambience: 'brook', ambFade: 600000, durationMs: 1200000, restMs: 600000, rounds: 2 };
  var q = await env.open({ storage: st, init: soundInit, routes: routes || [] });
  try {
    await sleep(700);
    m.seq = await q.eval(function () {
      var Hg = window.Hourglass, T = Hg.timer, S = Hg.seq, out = [];
      T.state = 'running';
      [0, 1, 2, 3].forEach(function (ph) { S.phase = ph; T.rem = ph & 1 ? 100000 : 100000; out.push({ phase: ph, rem: T.rem, got: Hg.debug.ambFadeShare() }); });
      S.phase = 3; T.rem = 150000; out.push({ phase: 3, rem: T.rem, got: Hg.debug.ambFadeShare(), want: Math.pow(0.5, 1.5) });   // (the last phase, 10 min: its last 5)
      S.phase = 0; T.state = 'idle'; T.rem = T.durationMs;
      return out;
    });
  } finally { await q.close(); }
  return m;
}
function fadeOk(m) {
  var close = function (a, b) { return Math.abs(a - b) <= 1e-9; };
  var bad = m.table.filter(function (r) { return !close(r.got, r.want); }), sbad = m.short.filter(function (r) { return !close(r.got, r.want); });
  var p = m.paused, tu = m.turned;
  var seqOk = m.seq.slice(0, 3).every(function (r) { return r.got === 1; }) && m.seq[3].got < 1 && close(m.seq[4].got, m.seq[4].want);
  return {
    table: { ok: bad.length === 0 && m.table.length === 16, detail: m.table.length + ' shares, ' + (bad.length ? 'wrong: ' + JSON.stringify(bad.slice(0, 3)) : 'each (left / stretch)^1.5 inside the stretch, 1 before it, 0 once ended') },
    short: { ok: sbad.length === 0, detail: sbad.length ? 'wrong: ' + JSON.stringify(sbad.slice(0, 3)) : 'a 4-minute glass on "5 min" fades over its last 2 minutes, a 1-minute one on "1 min" over its last 30 s, a 15-minute one on "10 min" over its last 7.5' },
    paused: { ok: p.later.state === 'paused' && p.at.share < 1 && p.at.share > 0 && p.later.share === p.at.share && p.later.rem === p.at.rem,
              detail: 'paused at ' + Math.round(p.at.rem) + ' ms left: share ' + p.at.share.toFixed(3) + ', 1.2 s later ' + p.later.share.toFixed(3) },
    turned: { ok: tu.frames > 30 && tu.share0 < 0.6 && tu.share1 === 1 && tu.lo < 0.6 && tu.hi > 0.97 && tu.step <= 0.06,
              detail: 'turned over with ' + Math.round(tu.rem) + ' ms then left: the share ' + (tu.share0 == null ? '?' : tu.share0.toFixed(3)) + ' → ' + tu.share1 + '; the engine\'s gain ' + tu.lo.toFixed(3) + ' → ' + tu.hi.toFixed(3) +
                      ' over ' + tu.frames + ' frames, at most ' + tu.step.toFixed(3) + ' from one 1/60 s to the next (a glide; 0.06 allowed)' },
    added: { ok: m.added.frames > 30 && m.added.share1 > m.added.share0 + 0.02 && m.added.share1 < 1 && m.added.step <= 0.06,
             detail: 'sand added in the last stretch: the share ' + (m.added.share0 == null ? '?' : m.added.share0.toFixed(3)) + ' → ' + (m.added.share1 == null ? '?' : m.added.share1.toFixed(3)) +
                     ' (' + Math.round(m.added.rem) + ' ms then left); the engine\'s gain at most ' + m.added.step.toFixed(3) + ' from one 1/60 s to the next' },
    off: { ok: m.off.done && m.off.n > 100 && m.off.shares === 0 && m.off.gains === 0 && m.off.ended > 20, detail: 'switch off: ' + m.off.n + ' frames, ' + m.off.ended + ' after the end; ' + m.off.shares + ' shares and ' + m.off.gains + ' gains other than 1' },
    seq: { ok: seqOk, detail: m.seq.map(function (r) { return 'phase ' + r.phase + ' ' + r.rem / 1000 + ' s left: ' + r.got.toFixed(3); }).join('; ') },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- SILENT: the audio session --------------------------------------------------------------- */
async function silent(env, routes) {
  var out = {};
  for (var c = 0; c < 4; c++) {
    var on = c !== 1, session = c === 2 ? null : c === 3 ? 'throws' : 'stub';
    var st = {}; st[KEY] = { silentRing: on };
    var t = await env.open({ storage: st, init: soundInit, initArg: { session: session }, routes: routes || [] });
    try {
      await sleep(700);
      var r = { launch: await t.eval(function () { return window.__session ? window.__session.sets.slice() : null; }) };
      var g = await t.glass();
      await t.page.touchscreen.tap(g.cx, g.cy);                       // a first tap (on the glass): the sound is unlocked
      await sleep(300);
      r.tapped = await t.eval(function () { return window.__session ? window.__session.sets.slice() : null; });
      await tune.tap(t, '#opt-silent');
      await sleep(200);
      r.switched = await t.eval(function (k) { return { sets: window.__session ? window.__session.sets.slice() : null, saved: JSON.parse(localStorage.getItem(k)).silentRing, checked: document.getElementById('opt-silent').checked, engine: window.Hourglass.audio.silentRing }; }, KEY);
      await tune.tap(t, '#opt-silent');
      await sleep(200);
      r.back = await t.eval(function () { return { sets: window.__session ? window.__session.sets.slice() : null, note: document.getElementById('silent-note').textContent, shown: document.getElementById('opt-silent').getClientRects().length > 0 }; });
      r.errors = t.errors.slice();
      out[['on', 'off', 'none', 'throws'][c]] = r;
    } finally { await t.close(); }
  }
  return out;
}
function silentOk(m) {
  var j = function (a) { return JSON.stringify(a); };
  return {
    on: { ok: j(m.on.launch) === '[]' && j(m.on.tapped) === '["playback"]' && j(m.on.switched.sets) === '["playback","ambient"]' && m.on.switched.saved === false && m.on.switched.engine === false &&
              j(m.on.back.sets) === '["playback","ambient","playback"]' && /plays with the ringer off/.test(m.on.back.note),
          detail: 'on (as before): at the launch ' + j(m.on.launch) + ', after the first tap ' + j(m.on.tapped) + ', switched off ' + j(m.on.switched.sets) + ' (saved ' + m.on.switched.saved + '), on again ' + j(m.on.back.sets) },
    off: { ok: j(m.off.launch) === '["ambient"]' && m.off.tapped[m.off.tapped.length - 1] === 'ambient' && m.off.tapped.indexOf('playback') < 0 && m.off.switched.sets[m.off.switched.sets.length - 1] === 'playback' && m.off.switched.saved === true &&
               m.off.back.sets[m.off.back.sets.length - 1] === 'ambient',
           detail: 'off: at the launch, before any tap, ' + j(m.off.launch) + ', after the first tap ' + j(m.off.tapped) + ', switched on ' + j(m.off.switched.sets) + ', off again ' + j(m.off.back.sets) },
    none: { ok: m.none.back.shown && m.none.back.note === 'This browser decides by itself' && m.none.switched.saved === false && m.none.errors.length === 0 && m.throws.errors.length === 0 && m.throws.switched.saved === false,
            detail: 'no audioSession: the row says "' + m.none.back.note + '", switched and saved (' + m.none.switched.saved + '), errors: ' + (m.none.errors.concat(m.throws.errors).join(' | ') || 'none') + ' (also with a session whose type throws)' }
  };
}

/* ---- the run ------------------------------------------------------------------------------ */
(async function main() {
  var s = new H.Suite('app-sound');
  var env = await H.start();
  var only = env.args.only ? env.args.only.split(',') : null;
  function wanted(name) { return !only || only.indexOf(name) >= 0; }
  function failing(v) { return Object.keys(v).filter(function (k) { return v[k] && v[k].ok === false; }); }
  async function control(label, part, measure, verdict) {
    var v, why;
    try { v = verdict(await measure()); } catch (e) { why = 'the copy could not be measured: ' + String(e && e.message || e).split('\n')[0]; }
    var bad = v ? failing(v) : [];
    var hit = v ? bad.indexOf(part) >= 0 : false;
    s.check('CONTROL ' + label, hit, why || (hit ? 'fails: ' + v[part].detail : 'PASSES; failing only ' + (bad.join(', ') || 'nothing')));
  }
  function copyOf(file, re, to) { return [broken(env, file, swap(re, to))]; }
  try {
    if (wanted('layout')) {
      var lo = layoutOk(await layout(env));
      s.check('LAYOUT: at 393 x 852, 375 x 667 and 320 x 568 the Sound tab\'s rows are in the design\'s order (Sound, Ambience and its level, Fade out before the end and its three lengths, Sand sound, Sand, Completion bowl, Rings, Bowl, Sound in silent mode) and words, each slider with its word and value', lo.order.ok, lo.order.detail);
      s.check('LAYOUT: ... nothing wider than the sheet, no sideways scroll, no word cut off', lo.fit.ok, lo.fit.detail);
      s.check('LAYOUT: ... every new control takes a finger\'s 44 px', lo.hit.ok, lo.hit.detail);
      s.check('LAYOUT: ... and is named for a screen reader as the rows before it are (two radio groups of three, two switches, two labelled sliders)', lo.aria.ok, lo.aria.detail);
      s.check('LAYOUT: the bowl\'s Rings and level go while the bowl is off, the fade\'s row with no ambience, its three lengths while it is off', lo.hiding.ok, lo.hiding.detail);
      s.check('LAYOUT: no page or console errors', lo.errors.ok, lo.errors.detail);
      await control('LAYOUT: a copy whose Rings will not wrap (each choice 120 px)', 'fit', function () { return layout(env, [broken(env, 'styles.css', add('#rings button { white-space: nowrap; min-width: 120px; }'))]); }, layoutOk);
      await control('LAYOUT: a copy whose new sliders are 30 px high', 'hit', function () { return layout(env, [broken(env, 'styles.css', add('.slider-row.tall input[type="range"] { height: 30px; }'))]); }, layoutOk);
      await control('LAYOUT: a copy that leaves the bowl\'s rows shown with the bowl off', 'hiding', function () { return layout(env, copyOf('app.js', /if \(bowlSub\) bowlSub\.hidden = !settings\.chime;/, '')); }, layoutOk);
    }
    if (wanted('levels')) {
      var lv = levelsOk(await levels(env));
      s.check('LEVELS: Sand 40 and Bowl 80 are saved as 0.4 and 1.6, shown as "40" and "80", and come back so after a reload', lv.saved.ok, lv.saved.detail);
      s.check('LEVELS: ... and are told to the sound engine (the sand\'s gain (40/100)^1.5), the bowl rung once at its new level when the slider is let go', lv.told.ok, lv.told.detail);
      await control('LEVELS: a copy whose Sand slider does not tell the sound engine', 'told', function () { return levels(env, copyOf('app.js', /    audio\.setSandLevel\(settings\.sandLevel\);\n    showSandLevel\(\);/, '    showSandLevel();')); }, levelsOk);
    }
    if (wanted('rings')) {
      var rg = ringsOk(await rings(env));
      s.check('RINGS: the first ring is the bowl as it always was, 0.75 s after the last grain, and the rings are counted from it', rg.first.ok, rg.first.detail);
      s.check('RINGS: "Once" rings no more', rg.once.ok, rg.once.detail);
      s.check('RINGS: "Three times" rings again 8.5 s and 17 s after the first, not before, and then no more', rg.three.ok, rg.three.detail);
      s.check('RINGS: "Until a tap" rings every 8.5 s, the last no later than 10 minutes after the first', rg.tap.ok, rg.tap.detail);
      await control('RINGS: a copy whose rings go on past 10 minutes (20)', 'tap', function () { return rings(env, copyOf('app.js', /RING_MAX = 600000/, 'RING_MAX = 1200000')); }, ringsOk);
      await control('RINGS: a copy that rings three times 6 s apart', 'three', function () { return rings(env, copyOf('app.js', /RING_GAP = 8500/, 'RING_GAP = 6000')); }, ringsOk);
    }
    if (wanted('tap')) {
      var tp = tapsOk(await taps(env));
      s.check('TAP: while the bowl is to ring again, the first tap on the glass only stops it (the ringing bowl fades, no more come, no glass starts or turns); the next tap starts the glass', tp.glass.ok, tp.glass.detail);
      s.check('TAP: ... the first button (Tune) only stops it, and opens nothing; the next opens Tune', tp.button.ok, tp.button.detail);
      s.check('TAP: ... the first key (F) only stops it, and turns nothing; the next turns the glass', tp.key.ok, tp.key.detail);
      s.check('TAP: no page or console errors', tp.errors.ok, tp.errors.detail);
      await control('TAP: a copy whose first tap is not used up (it starts the glass too)', 'glass', function () {
        return taps(env, copyOf('app.js', /    ringEat = \{ ids: \[e\.pointerId\], touches: \[\], up: 0 \};\n    ringEaten\(e\);\n/, '    ringEat = null;\n'));
      }, tapsOk);
      await control('TAP: a copy whose first key is not used up', 'key', function () {
        return taps(env, copyOf('app.js', /    ringEat = \{ key: e\.key, up: 0 \};\n    ringEaten\(e\);\n/, ''));
      }, tapsOk);
    }
    if (wanted('twice')) {
      var tw = twiceOk(await twice(env));
      s.check('TWICE: while the bowl is to ring again, Start tapped with a finger twice 0.25 s apart: the first only stops the bowl, the second starts the glass', tw.finger.ok, tw.finger.detail);
      s.check('TWICE: ... and clicked twice with a mouse 0.25 s apart: the same', tw.mouse.ok, tw.mouse.detail);
      // the copy: the next gesture's pointer down no longer ends the first, and every touch is eaten, not only the first's (as up to 1.19.0)
      var eatsAll = [broken(env, 'app.js', function (src) {
        src = swap(/    if \(ringEat\) ringEat = null;[^\n]*\n/, '')(src);
        src = swap(/        else if \(!ringTouch\(e, q\)\) return;\n/, '')(src);
        return swap(/        if \(type === 'touchend' \|\| type === 'touchcancel'\) \{[^\n]*\n          ringEaten\(e\);\n[^\n]*\n[^\n]*\n          return;\n        \}\n/, '')(src);
      })];
      await control('TWICE: a copy that eats every touch and click until 0.6 s after the first tap lifts (as up to 1.19.0): a finger', 'finger', function () { return twice(env, eatsAll); }, twiceOk);
      await control('TWICE: a copy whose mouse gesture is not ended by its click nor by the next press: a mouse', 'mouse', function () {
        return twice(env, [broken(env, 'app.js', function (src) {
          src = swap(/    if \(ringEat\) ringEat = null;[^\n]*\n/, '')(src);
          return swap(/      if \(type === 'click'\) ringEat = null;\n/, '')(src);
        })]);
      }, twiceOk);
    }
    if (wanted('two')) {
      var tf = twoOk(await two(env));
      s.check('TWO: while the bowl is to ring again (Until a tap), two fingers landing together near the top of the glass only stop it: the glass does not turn', tf.top.ok, tf.top.detail);
      s.check('TWO: ... and the same two fingers across its middle', tf.middle.ok, tf.middle.detail);
      s.check('TWO: with Rings once (nothing due) two fingers together do nothing, as always', tf.onceTop.ok && tf.onceMiddle.ok, tf.onceTop.detail + ' | ' + tf.onceMiddle.detail);
      await control('TWO: a copy that takes a finger landing while the stopping one is down for a new gesture (as up to 1.21.1)', 'top', function () {
        return two(env, copyOf('app.js', /    if \(ringEat && ringEat\.ids && !ringEat\.up\) \{[^\n]*\n[^\n]*\n      ringEaten\(e\);\n      return;\n    \}\n/, ''));
      }, twoOk);
    }
    if (wanted('quiet')) {
      var qu = quietOk(await quiet(env));
      s.check('QUIET: with the app muted, the rings do not begin, and the first tap on the glass after the end turns it', qu.muted.ok, qu.muted.detail);
      s.check('QUIET: ... the same with Sound at 0', qu.sound0.ok, qu.sound0.detail);
      s.check('QUIET: ... and with Bowl at 0', qu.bowl0.ok, qu.bowl0.detail);
      s.check('QUIET: muted while the rings are due, they stop', qu.toMute.ok, qu.toMute.detail);
      s.check('QUIET: ... and so with Sound brought to 0', qu.toSound0.ok, qu.toSound0.detail);
      s.check('QUIET: ... or Bowl', qu.toBowl0.ok, qu.toBowl0.detail);
      var armsAll = copyOf('app.js', /    var n = ringsHeard\(\) \? ringsLast/, '    var n = settings.chime ? ringsLast');
      await control('QUIET: a copy whose rings begin whenever the bowl is on (as up to 1.19.0): muted', 'muted', function () { return quiet(env, armsAll); }, quietOk);
      await control('QUIET: ... Sound at 0', 'sound0', function () { return quiet(env, armsAll); }, quietOk);
      await control('QUIET: ... Bowl at 0', 'bowl0', function () { return quiet(env, armsAll); }, quietOk);
      await control('QUIET: a copy whose rings go on when Sound is brought to 0', 'toSound0', function () { return quiet(env, copyOf('app.js', /    showVolume\(\); save\(\);\n    ringsUnheard\(\);\n/, '    showVolume(); save();\n')); }, quietOk);
      await control('QUIET: a copy whose rings go on when Bowl is brought to 0', 'toBowl0', function () { return quiet(env, copyOf('app.js', /      audio\.setBowlLevel\(settings\.bowlLevel\);\n      ringsUnheard\(\);\n/, '      audio.setBowlLevel(settings.bowlLevel);\n')); }, quietOk);
      await control('QUIET: a copy whose rings go on when the app is muted', 'toMute', function () { return quiet(env, copyOf('app.js', /    audio\.setMuted\(m\);\n    ringsUnheard\(\);\n/, '    audio.setMuted(m);\n')); }, quietOk);
    }
    if (wanted('away')) {
      var aw = awayOk(await away(env));
      s.check('AWAY: nothing rings while the page is hidden', aw.hidden.ok, aw.hidden.detail);
      s.check('AWAY: back on screen, the rings whose time has passed are dropped (no burst), and the next comes on its time', aw.late.ok, aw.late.detail);
      s.check('AWAY: back after more than 10 minutes, nothing rings and the rings are over', aw.long.ok, aw.long.detail);
      await control('AWAY: a copy that rings while hidden', 'hidden', function () { return away(env, copyOf('app.js', /if \(!rings \|\| document\.hidden\) return;/, 'if (!rings) return;')); }, awayOk);
      await control('AWAY: a copy that plays a late ring', 'late', function () { return away(env, copyOf('app.js', /RING_LATE = 2000/, 'RING_LATE = 1e9')); }, awayOk);
    }
    if (wanted('rounds')) {
      var ro = roundsOk(await rounds(env));
      s.check('ROUNDS: between the phases of a sequence the soft bowl rings once each time and the next phase is not held up (the rings never due in a phase)', ro.between.ok, ro.between.detail);
      s.check('ROUNDS: the last end rings as Rings says (three times)', ro.last.ok, ro.last.detail);
      await control('ROUNDS: a copy that rings again between phases too', 'between', function () {
        return rounds(env, [broken(env, 'app.js', function (src) {
          return swap(/if \(T\.state !== 'done'\) \{ ringsStop\(\); return; \}/, '')(swap(/      audio\.chime\(Math\.max\(0, SEQ_BOWL - over\) \/ 1000, true\);/, '      audio.chime(Math.max(0, SEQ_BOWL - over) / 1000, true); ringsBegin(Date.now() + BOWL_AT);')(src));
        })]);
      }, roundsOk);
    }
    if (wanted('awake')) {
      var ak = awakeOk(await awake(env));
      s.check('AWAKE: with Keep screen awake on, the rings keep the screen on past the end\'s 12 s, and let it go after the last', ak.on.ok, ak.on.detail);
      s.check('AWAKE: with it off, the rings never ask for the screen', ak.off.ok, ak.off.detail);
      await control('AWAKE: a copy whose rings do not keep the screen on', 'on', function () { return awake(env, copyOf('app.js', / \|\| ringsDue\(\)\)\)\);/, ')));')); }, awakeOk);
    }
    if (wanted('asleep')) {
      var sl = asleepOk(await asleep(env));
      s.check('ASLEEP: a glass that ran out while the phone slept (found 8 s late, Three times): the bowl as it comes back, then the rings 8.5 s apart from it, never crowded on it', sl.three.ok, sl.three.detail);
      s.check('ASLEEP: ... found 11 minutes late (Until a tap): the end\'s bowl, and no rings past the 10 minutes after the end', sl.long.ok, sl.long.detail);
      await control('ASLEEP: a copy that counts the rings from the real end (as up to 1.19.0)', 'three', function () {
        return asleep(env, copyOf('app.js', /    ringsBegin\(endWall \+ BOWL_AT, endWall - \(over > 0 \? over : 0\) \+ BOWL_AT\);/, '    ringsBegin(endWall - (over > 0 ? over : 0) + BOWL_AT);'));
      }, asleepOk);
      await control('ASLEEP: a copy whose rings run 10 minutes from the late bowl', 'long', function () {
        return asleep(env, copyOf('app.js', /    if \(settings\.bowlRings === 'tap' && end !== undefined\) n = [^\n]*\n/, ''));
      }, asleepOk);
    }
    if (wanted('back')) {
      var bk = backOk(await back(env));
      s.check('BACK: the clock set back an hour while the bowl is to ring again: the rings end, the screen is let go, and the next tap works', bk.rings.ok, bk.rings.detail);
      s.check('BACK: ... and set back within the 12 s an end keeps the screen on (Rings once): the screen is let go', bk.once.ok, bk.once.detail);
      await control('BACK: a copy whose rings wait for the clock to come back', 'rings', function () { return back(env, copyOf('app.js', /    if \(now < endWall - 1000\) \{ ringsStop\(\); return; \}[^\n]*\n/, '')); }, backOk);
      await control('BACK: a copy whose end keeps the screen on while the clock is behind it', 'once', function () { return back(env, copyOf('app.js', /return ago >= -1000 && ago < END_AWAKE;/, 'return ago < END_AWAKE;')); }, backOk);
    }
    if (wanted('fade')) {
      var fd = fadeOk(await fade(env));
      s.check('FADE: the ambience\'s share for the last minute, 5 and 10 minutes, at 2, 1, 1/2, 1/4 and 1/100 of the stretch left: (left / stretch)^1.5 inside it, whole before it, 0 once ended', fd.table.ok, fd.table.detail);
      s.check('FADE: a glass shorter than twice the stretch fades over its last half', fd.short.ok, fd.short.detail);
      s.check('FADE: paused, it holds', fd.paused.ok, fd.paused.detail);
      s.check('FADE: sand added in its last stretch, it rises with the time left, gliding', fd.added.ok, fd.added.detail);
      s.check('FADE: turned over in its last stretch, it comes back up whole, and the sound engine glides there (no step)', fd.turned.ok, fd.turned.detail);
      s.check('FADE: with the switch off, the share is 1 to the end and after it, and the engine\'s gain never leaves 1 (as before)', fd.off.ok, fd.off.detail);
      s.check('FADE: in a work and rest sequence only the last phase fades, over its own length', fd.seq.ok, fd.seq.detail);
      s.check('FADE: no page or console errors', fd.errors.ok, fd.errors.detail);
      await control('FADE: a copy without the half-glass rule', 'short', function () { return fade(env, copyOf('app.js', /    stretch = Math\.min\(stretch, len \/ 2\);\n/, '')); }, fadeOk);
      await control('FADE: a copy that fades by the wall clock while paused', 'paused', function () { return fade(env, copyOf('app.js', /    rem = T\.rem;\n/, '    rem = T.rem - (T.state === \'paused\' ? Date.now() - T.lastTick : 0);\n')); }, fadeOk);
      await control('FADE: a copy whose sound engine steps to the share', 'turned', function () { return fade(env, copyOf(paths.script('audio.js', env.root), /this\._set\('ambEnd', this\.ambEnd\.gain, fe, 0\.35\);/, 'this.ambEnd.gain.value = fe;')); }, fadeOk);
      await control('FADE: a copy that ends in quiet with the switch off too', 'off', function () {
        return fade(env, copyOf('app.js', /    if \(!stretch \|\| settings\.ambience === 'none'\) return 1;\n/, "    if (T.state === 'done') return 0;\n    if (!stretch || settings.ambience === 'none') return 1;\n"));
      }, fadeOk);
      await control('FADE: a copy that fades every phase of a sequence', 'seq', function () { return fade(env, copyOf('app.js', /    if \(seq\.rest && seq\.phase < last\) return 1;[^\n]*\n/, '')); }, fadeOk);
    }
    if (wanted('silent')) {
      var si = silentOk(await silent(env));
      s.check('SILENT: on (the default): the page\'s audio session is \'playback\' from the first tap, as before; switched off it is \'ambient\' at once, and \'playback\' again when switched on', si.on.ok, si.on.detail);
      s.check('SILENT: off: \'ambient\' from the launch (before any tap) and after the first tap, \'playback\' at once when switched on', si.off.ok, si.off.detail);
      s.check('SILENT: a browser without an audio session: the row says it decides by itself, the switch still saves, and nothing throws (nor with a session whose type cannot be set)', si.none.ok, si.none.detail);
      await control('SILENT: a copy of audio.js that always asks for \'playback\'', 'off', function () { return silent(env, copyOf(paths.script('audio.js', env.root), /if \(s\) s\.type = this\.silentRing === false \? 'ambient' : 'playback';/, "if (s) s.type = 'playback';")); }, silentOk);
      await control('SILENT: a copy of app.js that leaves the session alone at the launch', 'off', function () { return silent(env, copyOf('app.js', /  if \(!settings\.silentRing\) audio\.setSilentRing\(false\);[^\n]*\n/, '')); }, silentOk);
    }
  } catch (e) {
    s.check('the suite ran to its end', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally {
    await env.close();
  }
  s.done();
})();
