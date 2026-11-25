#!/usr/bin/env node
/*
 * The glass's shape (release 1.15.0): Tune's Glass tab, the classic sand in every shape Tune
 * offers, and the time kept when the shape changes.
 *
 *   PICK     the Glass tab opens with its Shape section, above the frame's: the shape in use
 *            drawn large with "In use", and beside it the shapes Tune offers (glass/shapes.js
 *            SHAPE_ORDER, those with offered: all nine, Classic, Lozenge, Delta, Ampoule,
 *            Trumpet, Florence, Onion, Bell, Gourd), a radiogroup three a row, each drawn
 *            small and all at one scale (Delta drawn wider than Bell by their own widths); a
 *            shape held back (Trumpet, held on the test's page alone) is not shown
 *   LOOK     a tap on a shape only shows it: the large drawing, its name and "Use this shape";
 *            nothing saved, nothing loaded again, the glass behind as it was; tapping the
 *            shape in use again says "In use"
 *   USE      a 5-minute glass, 40 % of it run, and "Use this shape" on Delta: the page is built
 *            again in Delta and Tune comes back open on the Glass tab at once, Delta in use;
 *            the time left is what it was (within a frame), the sand counted anew as the same
 *            share of Delta's full glass, as much of it above the neck as the clock asks (within
 *            a grain), and the glass runs out at 00:00.0 on time; the focus is on Tune itself, so no
 *            button wears a focus ring that no tap asked for
 *   SHAPES   in each shape Tune offers, on the classic sand: a 60-minute glass filled to its cap
 *            (the clock's full glass for that shape), all of it above the neck; a 10 s glass run
 *            to its end, the last grain out as the readout reaches 00:00.0, on time
 *   FULL     a 60-minute Delta glass, and a 60-minute Trumpet, has no room for more sand: its
 *            Sand button reads "Full" (and says "The glass is full" to a screen reader), and a
 *            tap says so and adds none; the classic 60-minute glass still reads "Sand"
 *   SAND     the small glasses and the large one are drawn with sand in the current colour: the
 *            sand chosen in the Sand tab (one of the nine, or the custom colour as it is used),
 *            not the material's; a change of sand, with Tune open, repaints them
 *   OLD      a save of 1.14.0 (sand, sandColor, finish; no shape), one of 1.13.0 and one of 1.10.0
 *            come up in the classic glass with every setting they hold as it was; a save that
 *            names a shape held back (trumpet and florence, each held on the test's page alone,
 *            since Tune offers every shape) or unknown is the classic glass too, and saves
 *            'classic'
 *
 * Every check has its control: the same measurement on a copy of the app with that one thing
 * broken (served in place of the file), which must fail it.
 *
 *   node tools/test/app-shape.test.js [--root <dir>] [--port <n>] [--only pick,look,use,shapes,sand,full,old]
 */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;
var KEY = 'hourglass.settings.v1', SKEY = 'hourglass.session.v1';
var FRAME = 1000 / 60;
var OFFERED = ['classic', 'lozenge', 'delta', 'ampoule', 'trumpet', 'florence', 'onion', 'bell', 'gourd'];

/**
 * Tune offers every registered shape, so a shape held back is made on the test's page alone: an
 * init script that sets offered false on these shapes' records as glass/shapes.js hands its registry
 * to the page (before the settings and the picker read it).
 */
function hold(ids) {
  return {
    init: function (ids) {
      var v;
      Object.defineProperty(window, 'HourglassPhysics', { configurable: true, enumerable: true, get: function () { return v; },
        set: function (P) { v = P; ids.forEach(function (id) { if (P && P.SHAPES && P.SHAPES[id]) P.SHAPES[id].offered = false; }); } });
    },
    initArg: ids
  };
}

function only() {
  var i = process.argv.indexOf('--only');
  return i > 0 ? process.argv[i + 1].split(',') : null;
}
function wanted(name) { var o = only(); return !o || o.indexOf(name) >= 0; }

/* ---- a copy with one thing broken, for a control ------------------------------------------ */
function broken(env, file, change) {
  var src = fs.readFileSync(path.join(env.root, file), 'utf8'), out = change(src);
  if (out === src) throw new Error('app-shape: the control\'s change to ' + file + ' changed nothing');
  var type = /\.css$/.test(file) ? 'text/css' : /\.html$/.test(file) ? 'text/html' : 'text/javascript';
  var names = file === 'index.html' ? ['/', '/index.html'] : ['/' + file], origin = env.url.replace(/\/$/, '');
  return {
    url: function (u) { return u.origin === origin && names.indexOf(u.pathname) >= 0; },
    handler: function (route) { route.fulfill({ status: 200, contentType: type + '; charset=utf-8', body: out }); }
  };
}
function swap(from, to) {
  return function (src) {
    var n = src.split(from).length - 1;
    if (n !== 1) throw new Error('app-shape: a control\'s text is in the file ' + n + ' times: ' + from);
    return src.replace(from, to);
  };
}
function chain() { var fs2 = Array.prototype.slice.call(arguments); return function (src) { return fs2.reduce(function (s, f) { return f(s); }, src); }; }

/* ---- reading the page ---------------------------------------------------------------------- */
function saved(t) { return t.eval(function (k) { return localStorage.getItem(k); }, KEY); }
/** The Glass tab's shapes as shown. */
function picker(t) {
  return t.eval(function () {
    var panel = document.getElementById('panel-glass'), kids = Array.prototype.slice.call(panel.children);
    var heads = kids.filter(function (e) { return e.tagName === 'H3'; }).map(function (e) { return e.textContent; });
    var group = document.getElementById('shapes'), bs = group.querySelectorAll('button[role="radio"]');
    var use = document.getElementById('shape-use');
    var list = Array.prototype.map.call(bs, function (b) {
      var svg = b.querySelector('svg'), bore = svg.querySelector('.bore'), bb = bore.getBoundingClientRect(), r = b.getBoundingClientRect();
      return { id: b.dataset.shape, name: b.querySelector('b').textContent, checked: b.getAttribute('aria-checked'), inUse: b.classList.contains('in-use'),
               label: b.getAttribute('aria-label'), view: svg.getAttribute('viewBox'), w: bb.width, h: bb.height, top: Math.round(r.top), left: Math.round(r.left) };
    });
    var big = document.getElementById('shape-big');
    return { first: kids[0] && kids[0].tagName === 'H3' ? kids[0].textContent : null, heads: heads,
             pickBeforeFrame: !!(panel.querySelector('.shape-pick').compareDocumentPosition(document.getElementById('opt-frame')) & Node.DOCUMENT_POSITION_FOLLOWING),
             role: group.getAttribute('role'), label: group.getAttribute('aria-label'), list: list,
             big: big.getAttribute('data-shape'), bigView: big.getAttribute('viewBox'), name: document.getElementById('shape-name').textContent,
             use: { text: use.textContent, state: use.dataset.state, disabled: use.getAttribute('aria-disabled') } };
  });
}
/** The glass and the clock as they are now; rem as of this very moment (not of the last frame). */
function glassNow(t) {
  return t.eval(function () {
    var W = window.Hourglass, s = W.sim, T = W.timer, now = Date.now();
    return { shape: s.geo.shape ? s.geo.shape.id : 'classic', total: s.total, nTop: s.nTop, cap: Math.round(s.capacity * Math.min(0.78, s.fillMax)),
             maxTotal: s.maxTotal, full: W.grainsFor(T.durationMs), state: T.state, dur: T.durationMs,
             rem: T.state === 'running' ? T.rem - (now - T.lastTick) : T.rem, at: now, topAt: W.topAt(T.rem), marker: !!window.__shapeMarker,
             simMarked: !!s.__shapeMarker };
  });
}
async function tapEl(t, sel) {
  var c = await t.eval(function (q) { var r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  await t.touch.tap(c.x, c.y, 60);
}
/** Wait for the page built again (after "Use this shape"), and Tune at rest. */
async function rebuilt(t, ms) {
  var end = Date.now() + (ms || 15000);
  for (;;) {
    var ok = await t.page.evaluate(function () { return !!(window.Hourglass && window.__mon && window.__mon.hooked && !window.__shapeMarker && document.readyState === 'complete'); }).catch(function () { return false; });
    if (ok) break;
    if (Date.now() > end) throw new Error('app-shape: the page was not built again');
    await sleep(100);
  }
}
// at the page's own start: as app.js has run (its script's load event, before any frame), the glass
// as it was restored, and how long app.js took (the clock may have moved on since the restore by
// as much: the scripts before it had all run when it began)
function atBoot() {
  var last = 0;
  document.addEventListener('load', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'SCRIPT') return;
    var now = performance.now();
    if (/\/app\.js$/.test(el.src || '') && window.Hourglass && !window.__atBoot) {
      var W = window.Hourglass, T = W.timer;
      window.__atBoot = { nTop: W.sim.nTop, total: W.sim.total, rem: T.rem, topAt: W.topAt(T.rem), rate: T.rate, ms: now - last, state: T.state, shape: W.sim.geo.shape ? W.sim.geo.shape.id : 'classic' };
    }
    last = now;
  }, true);
}
/** Frame by frame from now (rAF in the page): Date.now(), the state and the count above the neck. */
function record(t) {
  return t.eval(function () {
    var W = window.Hourglass, R = window.__rec = [];
    (function f() { R.push({ now: Date.now(), state: W.timer.state, nTop: W.sim.nTop, rem: W.timer.rem }); if (R.length < 40000) requestAnimationFrame(f); })();
  });
}
/** The end as recorded: when the readout reached 00:00.0, and when the last grain left the neck. */
function endOf(t, expectEnd) {
  return t.eval(function (want) {
    var R = window.__rec, done = null, empty = null, k;
    for (k = 0; k < R.length; k++) {
      if (done === null && R[k].state === 'done') done = k;
      if (done !== null && empty === null && R[k].nTop === 0) empty = k;
    }
    return { doneAt: done === null ? null : R[done].now, frames: done === null || empty === null ? null : empty - done,
             late: done === null ? null : R[done].now - want, topAtDone: done === null ? null : R[done].nTop, n: R.length };
  }, expectEnd);
}

/* ---- PICK ----------------------------------------------------------------------------------- */
async function pick(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({ viewport: { width: 393, height: 852 } }, o.hold ? hold(o.hold) : {}, o.open || {}));
  try {
    await sleep(700);
    await tune.show(t, '#shapes');
    await sleep(300);
    var p = await picker(t);
    p.hold = o.hold || [];
    return p;
  } finally { await t.close(); }
}
function pickOk(p) {
  var ids = p.list.map(function (b) { return b.id; }), byId = {}, hd = p.hold || [];
  var want = OFFERED.filter(function (id) { return hd.indexOf(id) < 0; });
  p.list.forEach(function (b) { byId[b.id] = b; });
  var oneView = p.list.every(function (b) { return b.view === p.list[0].view; }) && p.bigView === p.list[0].view;
  var rows = p.list.length >= 4 && p.list[0].top === p.list[1].top && p.list[1].top === p.list[2].top && p.list[3].top > p.list[0].top;
  // at one scale: the drawn widths stand as the shapes' own widths (kR), and the heights as kH
  var P = require('./lib/load-physics.js').P, wr = byId.delta && byId.bell ? byId.delta.w / byId.bell.w : NaN, wantW = P.makeGeometry(1, 'delta').R / P.makeGeometry(1, 'bell').R;
  var hr = byId.onion && byId.bell ? byId.onion.h / byId.bell.h : NaN, wantH = P.makeGeometry(1, 'onion').HB / P.makeGeometry(1, 'bell').HB;
  var scale = Math.abs(wr / wantW - 1) < 0.04 && Math.abs(hr / wantH - 1) < 0.04;
  return {
    place: { ok: p.first === 'Shape' && p.heads.join() === 'Shape,Frame' && p.pickBeforeFrame, detail: 'headings ' + p.heads.join(', ') + '; the shapes before the frame: ' + p.pickBeforeFrame },
    group: { ok: p.role === 'radiogroup' && !!p.label && ids.join() === want.join() && rows && p.list.every(function (b) { return !!b.view && b.w > 5; }),
             detail: ids.join(', ') + (hd.length ? ' (held on this page: ' + hd.join(', ') + ')' : '') + '; three a row: ' + rows },
    scale: { ok: oneView && scale, detail: 'one view box: ' + oneView + '; drawn width delta/bell ' + wr.toFixed(3) + ' (theirs ' + wantW.toFixed(3) + '), height onion/bell ' + hr.toFixed(3) + ' (theirs ' + wantH.toFixed(3) + ')' },
    inUse: { ok: byId.classic && byId.classic.checked === 'true' && byId.classic.inUse && p.list.filter(function (b) { return b.inUse || b.checked === 'true'; }).length === 1 &&
                 p.big === 'classic' && p.name === 'Classic' && p.use.text === 'In use' && p.use.disabled === 'true',
             detail: JSON.stringify({ big: p.big, name: p.name, use: p.use }) }
  };
}

/* ---- LOOK ------------------------------------------------------------------------------------ */
async function look(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({ viewport: { width: 393, height: 852 } }, o.open || {}));
  try {
    await sleep(700);
    await t.eval(function () { window.__shapeMarker = true; window.Hourglass.sim.__shapeMarker = true; });
    await tune.show(t, '#shapes [data-shape="delta"]');        // (the Glass tab shown: that is saved, as any tab)
    var g0 = await glassNow(t), s0 = await saved(t);
    await tapEl(t, '#shapes [data-shape="delta"]');
    await sleep(400);
    var pd = await picker(t), g1 = await glassNow(t), s1 = await saved(t);
    await tapEl(t, '#shapes [data-shape="bell"]');
    await sleep(300);
    var pb = await picker(t);
    await tapEl(t, '#shapes [data-shape="classic"]');
    await sleep(300);
    var pc = await picker(t), g2 = await glassNow(t), s2 = await saved(t);
    return { pd: pd, pb: pb, pc: pc, g0: g0, g1: g1, g2: g2, same: s0 === s1 && s1 === s2, s0: s0, s1: s1, errors: t.errors.slice() };
  } finally { await t.close(); }
}
function lookOk(m) {
  function on(p) { return p.list.filter(function (b) { return b.checked === 'true'; }).map(function (b) { return b.id; }).join(); }
  var shows = on(m.pd) === 'delta' && m.pd.big === 'delta' && m.pd.name === 'Delta' && m.pd.use.text === 'Use this shape' && m.pd.use.disabled === 'false' &&
              on(m.pb) === 'bell' && m.pb.name === 'Bell' && m.pb.use.text === 'Use this shape' &&
              on(m.pc) === 'classic' && m.pc.name === 'Classic' && m.pc.use.text === 'In use' && m.pc.use.disabled === 'true' &&
              m.pd.list.filter(function (b) { return b.inUse; }).map(function (b) { return b.id; }).join() === 'classic';
  var still = m.same && m.g1.marker && m.g2.marker && m.g1.simMarked && m.g1.shape === 'classic' && m.g2.shape === 'classic' && m.g1.total === m.g0.total;
  return {
    shows: { ok: shows, detail: 'Delta: ' + JSON.stringify([on(m.pd), m.pd.name, m.pd.use.text]) + '; Bell: ' + JSON.stringify([on(m.pb), m.pb.name, m.pb.use.text]) + '; Classic: ' + JSON.stringify([on(m.pc), m.pc.name, m.pc.use.text]) },
    still: { ok: still, detail: 'saved the same: ' + m.same + (m.same ? '' : ' (' + m.s0 + ' then ' + m.s1 + ')') + '; the page and the glass the same: ' + (m.g1.marker && m.g1.simMarked) + ', ' + m.g1.shape + ', ' + m.g0.total + ' -> ' + m.g1.total + ' grains' },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- USE ------------------------------------------------------------------------------------- */
async function use(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({ viewport: { width: 393, height: 852 }, storage: { 'hourglass.settings.v1': { durationMs: 300000 } }, init: atBoot }, o.open || {}));
  var m = {};
  try {
    await sleep(700);
    var g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(600);
    // Tune open on Delta first, so that between the clock set to 40 % and the change there is
    // only the fixed wait (the sheet's opening, its scrolling and the taps take longer on a
    // loaded machine, and the clock runs on through them: measured after them, the share run
    // at the change drifted with the machine's load)
    await tune.show(t, '#shapes [data-shape="delta"]');
    await tapEl(t, '#shapes [data-shape="delta"]');
    await sleep(300);
    // 40 % of the glass run: the clock moved on, and the sand caught up with it
    m.setAt = await t.eval(function () { var T = window.Hourglass.timer; T.rem = 0.6 * T.durationMs; T.lastTick = Date.now(); window.__shapeMarker = true; return T.lastTick; });
    await sleep(2200);
    m.before = await glassNow(t);
    m.session0 = null;
    await tapEl(t, '#shape-use');
    await rebuilt(t);
    m.after = await glassNow(t);
    m.boot = await t.eval(function () { return window.__atBoot; }) || {};
    m.session = await t.eval(function (k) { return localStorage.getItem(k); }, SKEY);
    await sleep(700);
    m.tune = await t.eval(function () {
      var s = document.getElementById('sheet-settings'), sel = document.querySelector('#tune-tabs [aria-selected="true"]');
      var f = document.activeElement, cs = f ? getComputedStyle(f) : null;
      return { open: !s.hidden && s.classList.contains('open'), tab: sel ? sel.dataset.tab : null, flag: sessionStorage.getItem('hourglass.openNow'),
               focus: f ? (f.id || f.className || f.tagName) : '', ring: !!cs && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 };
    });
    m.pick = await picker(t);
    m.saved = JSON.parse(await saved(t));
    if (o.short) return m;
    await record(t);
    var expectEnd = m.after.at + m.after.rem;
    await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, null, { timeout: m.after.rem + 30000, polling: 250 });
    await sleep(400);
    m.end = await endOf(t, expectEnd);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function useOk(m) {
  var b = m.before, a = m.after, bt = m.boot || {};
  var want = Math.min(a.maxTotal, Math.round(b.total * a.full / b.full));
  var keptMs = a.rem - (b.rem - (a.at - b.at));
  var out = {
    built: { ok: a.shape === 'delta' && !a.marker && m.saved.shape === 'delta' && a.state === 'running' && b.state === 'running',
             detail: 'built in ' + a.shape + ', saved ' + m.saved.shape + ', ' + b.state + ' -> ' + a.state },
    tune: { ok: m.tune.open && m.tune.tab === 'glass' && !m.tune.flag && m.pick.list.filter(function (x) { return x.inUse; }).map(function (x) { return x.id; }).join() === 'delta' &&
                m.pick.big === 'delta' && m.pick.use.text === 'In use',
            detail: JSON.stringify(m.tune) + '; in use ' + m.pick.list.filter(function (x) { return x.inUse; }).map(function (x) { return x.id; }).join() + ', ' + m.pick.use.text },
    // (no tap came before the reload: a button given the focus would wear its ring)
    focus: { ok: m.tune.focus === 'sheet-settings' && !m.tune.ring, detail: 'the focus on ' + m.tune.focus + (m.tune.ring ? ', with a ring' : ', no ring') },
    time: { ok: Math.abs(keptMs) <= FRAME && Math.abs(b.rem / b.dur - 0.6) < 0.02,
            detail: 'left ' + (b.rem / 1000).toFixed(3) + ' s at ' + (100 - 100 * b.rem / b.dur).toFixed(1) + ' % run (set to 40 % ' + ((b.at - m.setAt) / 1000).toFixed(2) + ' s before); ' + ((a.at - b.at) / 1000).toFixed(2) + ' s later ' + (a.rem / 1000).toFixed(3) + ' s: ' + keptMs.toFixed(1) + ' ms off' },
    // (within a grain of what the clock asked at the restore: it may have let through as much more as
    // it runs in the time app.js took after it)
    sand: { ok: a.total === want && bt.total === want && bt.nTop - bt.topAt >= -1 && bt.nTop - bt.topAt <= 1 + bt.rate * bt.ms / 1000 && bt.shape === 'delta',
            detail: b.total + ' grains of the classic glass (full ' + b.full + ') -> ' + a.total + ' of Delta (full ' + a.full + '; the same share: ' + want + '); as app.js has run ' +
                    bt.nTop + ' above the neck, the clock asks ' + (bt.topAt || 0).toFixed(1) + ' (and ' + (bt.rate * bt.ms / 1000).toFixed(1) + ' grains more over the ' + Math.round(bt.ms) + ' ms app.js took)' }
  };
  if (m.end) out.end = { ok: m.end.frames !== null && m.end.frames <= 2 && Math.abs(m.end.late) <= 2 * FRAME + 5 && m.errors.length === 0,
                         detail: '00:00.0 ' + (m.end.late === null ? '?' : m.end.late.toFixed(0)) + ' ms from when it was due; the last grain out ' + m.end.frames + ' frames after; errors: ' + m.errors.length };
  return out;
}

/* ---- SHAPES ---------------------------------------------------------------------------------- */
async function shapes(env, o) {
  o = o || {};
  var out = [];
  for (var i = 0; i < OFFERED.length; i++) {
    var id = OFFERED[i];
    var t = await env.open(Object.assign({ storage: { 'hourglass.settings.v1': { durationMs: 3600000, shape: id } } }, o.open || {}));
    try {
      await sleep(700);
      var f = await glassNow(t), r = { id: id, fill: f };
      if (!o.short) {
        await t.eval(function () { window.Hourglass.setDuration(10000); });
        await sleep(2500);
        var g = await t.glass();
        await record(t);
        await t.touch.tap(g.cx, g.cy, 60);
        await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'running'; }, null, { timeout: 5000 });
        var st = await t.eval(function () { var T = window.Hourglass.timer; return { at: Date.now(), rem: T.rem - (Date.now() - T.lastTick), dur: T.durationMs }; });
        await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, null, { timeout: 30000, polling: 100 });
        await sleep(300);
        r.end = await endOf(t, st.at + st.rem);
        r.run = st;
        var mon = await t.eval(function () { return { checks: __mon.checks, fails: __mon.censusFails.length }; });
        r.census = mon;
      }
      r.errors = t.errors.slice();
      out.push(r);
    } finally { await t.close(); }
  }
  return out;
}
function shapesOk(list) {
  var fill = list.map(function (r) { var f = r.fill; return { id: r.id, ok: f.shape === r.id && f.total === f.cap && f.nTop === f.total && f.dur === 3600000, f: f }; });
  var ends = list.filter(function (r) { return r.end; }).map(function (r) {
    return { id: r.id, ok: r.end.frames !== null && r.end.frames <= 2 && Math.abs(r.end.late) <= 2 * FRAME + 5 && r.census.fails === 0 && r.errors.length === 0, e: r.end, c: r.census };
  });
  return {
    fill: { ok: fill.length === OFFERED.length && fill.every(function (x) { return x.ok; }),
            detail: fill.map(function (x) { return x.id + (x.ok ? ' ' + x.f.total : ' WRONG ' + JSON.stringify({ shape: x.f.shape, total: x.f.total, cap: x.f.cap, nTop: x.f.nTop })); }).join('; ') },
    end: { ok: ends.length === OFFERED.length && ends.every(function (x) { return x.ok; }),
           detail: ends.map(function (x) { return x.id + ' ' + (x.e.late === null ? '?' : x.e.late.toFixed(0)) + ' ms, last grain +' + x.e.frames + ' frames' + (x.ok ? '' : ' WRONG ' + JSON.stringify({ e: x.e, census: x.c })); }).join('; ') }
  };
}

/* ---- SAND ------------------------------------------------------------------------------------ */
// The colour the shapes' sand is filled with, small (Delta's button) and large, as drawn, and the
// colour of the sand the settings name (its record's base tone: P.SANDS, or P.customSand of the
// colour), both as the browser resolves them.
function shapeColours(t) {
  return t.eval(function () {
    var P = window.HourglassPhysics, raw = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
    function rgb(css) { var e = document.createElement('i'); e.style.color = css; document.body.appendChild(e); var c = getComputedStyle(e).color; e.remove(); return c.match(/[\d.]+/g).slice(0, 3).map(Number); }
    function fill(el) { return getComputedStyle(el).fill.match(/[\d.]+/g).slice(0, 3).map(Number); }
    var c = /^([\d.]+),([\d.]+),([\d.]+)$/.exec(raw.sandColor || ''), rec = raw.sand === 'custom' && c ? P.customSand(+c[1], +c[2], +c[3]) : P.SANDS[raw.sand];
    var sd = rec.sand, want = rgb('hsl(' + sd.h + ', ' + (sd.s * 100) + '%, ' + (sd.l * 100) + '%)');
    var th = P.THEMES[raw.theme] && P.THEMES[raw.theme].sand;
    return { sand: raw.sand, theme: raw.theme, want: want, material: th ? rgb('hsl(' + th.h + ', ' + (th.s * 100) + '%, ' + (th.l * 100) + '%)') : null,
             small: fill(document.querySelector('#shapes [data-shape="delta"] .sand')), big: fill(document.querySelector('#shape-big .sand')) };
  });
}
async function sandCase(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({ storage: { 'hourglass.settings.v1': { sand: 'lapis', theme: 'lapis', finish: 'gold' } } }, o.open || {}));
  var m = {};
  try {
    await sleep(700);
    await tune.show(t, '#shapes');
    await sleep(300);
    m.first = await shapeColours(t);
    // with Tune open on the Glass tab: a sand that is no material, then a colour of one's own
    await t.eval(function () { window.Hourglass.setSand('garnet'); });
    await sleep(500);
    m.garnet = await shapeColours(t);
    await t.eval(function () { window.Hourglass.setSand({ h: 160, s: 0.55, l: 0.5 }); });
    await sleep(500);
    m.custom = await shapeColours(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function sandOk(m) {
  function near(a, b) { return !!a && !!b && a.every(function (v, i) { return Math.abs(v - b[i]) <= 2; }); }
  function one(r) { return near(r.small, r.want) && near(r.big, r.want); }
  function says(n, r) { return n + ' (' + r.sand + '): small ' + r.small.join() + ', large ' + r.big.join() + ', the sand ' + r.want.join() + (r.material ? ', the material ' + r.material.join() : ''); }
  return {
    first: { ok: one(m.first), detail: says('at the start', m.first) },
    change: { ok: one(m.garnet) && one(m.custom) && !near(m.garnet.small, m.first.small) && !near(m.custom.small, m.garnet.small) && m.errors.length === 0,
              detail: says('then', m.garnet) + '; ' + says('then', m.custom) + (m.errors.length ? '; ' + m.errors[0] : '') }
  };
}

/* ---- FULL ------------------------------------------------------------------------------------ */
async function full(env, o) {
  o = o || {};
  var m = {};
  async function one(shape) {
    var t = await env.open(Object.assign({ storage: { 'hourglass.settings.v1': { durationMs: 3600000, shape: shape } } }, o.open || {}));
    try {
      await sleep(900);
      var r = await t.eval(function () {
        var b = document.getElementById('btn-sand'), s = window.Hourglass.sim;
        return { word: b.querySelector('span').textContent, label: b.getAttribute('aria-label'), cls: b.classList.contains('full'), total: s.total, max: s.maxTotal };
      });
      await tapEl(t, '#btn-sand');
      await sleep(700);
      r.toast = await t.eval(function () { var e = document.getElementById('toast'); return e.classList.contains('show') ? e.textContent : ''; });
      r.after = await t.eval(function () { return window.Hourglass.sim.total; });
      r.errors = t.errors.slice();
      return r;
    } finally { await t.close(); }
  }
  m.delta = await one('delta');
  m.trumpet = await one('trumpet');
  m.classic = await one('classic');
  return m;
}
function fullOk(m) {
  var c = m.classic;
  function says(d) { return d.total === d.max && d.word === 'Full' && d.label === 'The glass is full' && d.cls && d.toast === 'The glass is full' && d.after === d.total; }
  function told(n, d) { return n + ', 60 minutes: ' + d.total + ' of ' + d.max + ' grains; the button "' + d.word + '" (' + d.label + '); a tap: "' + d.toast + '", ' + d.total + ' -> ' + d.after; }
  return {
    says: { ok: says(m.delta) && says(m.trumpet), detail: told('Delta', m.delta) + '; ' + told('Trumpet', m.trumpet) },
    room: { ok: c.total < c.max && c.word === 'Sand' && c.label === 'Add sand. Hold to pour.' && !c.cls && c.after > c.total,
            detail: 'Classic, 60 minutes: ' + c.total + ' of ' + c.max + '; the button "' + c.word + '"; a tap adds ' + (c.after - c.total) + ' grains' }
  };
}

/* ---- OLD ------------------------------------------------------------------------------------- */
var SAVE_1_13 = { theme: 'lapis', character: 'bamboo', volume: 0.35, muted: true, chime: false, tilt: false, zenFull: true, haptics: false, keepAwake: false, frame: false,
  layers: true, ambience: 'rain', ambienceLevel: 0.7, breath: true, breathPattern: 'box', durationMs: 1500000, restMs: 0, rounds: 1, motionSign: -1, mendNotes: 2,
  hintCrack: true, hintZen: 3, grain: 0, hintMotion: 3, realSand: false, realSandFails: 0, realSandWhy: '', realSandNa: '', realSandNaAt: 0, realSandBuild: '6', v: 2, tuneTab: 'glass' };
var SAVE_1_10 = { theme: 'seaglass', character: 'dune', volume: 1, muted: false, chime: true, tilt: false, zenFull: false, haptics: true, keepAwake: true, frame: false, layers: false,
  ambience: 'drips', ambienceLevel: 0.2, breath: false, breathPattern: 'calm', durationMs: 600000, restMs: 0, rounds: 1, motionSign: 0, mendNotes: 0, hintCrack: false, hintZen: 0,
  grain: 0, hintMotion: 0, realSand: false, realSandFails: 0, realSandWhy: '', realSandNa: '', realSandNaAt: 0, realSandBuild: '5', v: 2 };
// (1.14.0: the sand, its colour and the frame's finish chosen apart; no shape yet)
var SAVE_1_14 = { theme: 'rosequartz', character: 'warm', volume: 0.6, muted: false, chime: true, tilt: false, zenFull: false, haptics: true, keepAwake: false, frame: true,
  layers: true, ambience: 'ocean', ambienceLevel: 0.4, breath: false, breathPattern: 'calm', durationMs: 900000, restMs: 0, rounds: 1, motionSign: 1, mendNotes: 0,
  hintCrack: false, hintZen: 1, grain: 0, hintMotion: 2, realSand: false, realSandFails: 0, realSandWhy: '', realSandNa: '', realSandNaAt: 0, realSandBuild: '6', v: 2,
  tuneTab: 'sand', sand: 'custom', sandColor: '12.5,0.6,0.55', finish: 'copper' };
async function old(env, o) {
  o = o || {};
  var cases = [['1.14.0', SAVE_1_14], ['1.13.0', SAVE_1_13], ['1.10.0', SAVE_1_10], ['trumpet', { v: 2, realSand: false, shape: 'trumpet' }, ['trumpet']], ['florence', { v: 2, realSand: false, shape: 'florence' }, ['florence']],
               ['unknown', { v: 2, realSand: false, shape: 'heart' }]];
  var out = [];
  for (var i = 0; i < cases.length; i++) {
    var raw = {}; raw[KEY] = cases[i][1];
    var t = await env.open(Object.assign({ rawStorage: raw }, cases[i][2] ? hold(cases[i][2]) : {}, o.open || {}));
    try {
      await sleep(900);
      var g = await glassNow(t), s = JSON.parse(await saved(t));
      await tune.show(t, '#shapes');
      var p = await picker(t);
      out.push({ name: cases[i][0], save: cases[i][1], glass: g.shape, saved: s, inUse: p.list.filter(function (b) { return b.inUse; }).map(function (b) { return b.id; }).join(), errors: t.errors.slice() });
    } finally { await t.close(); }
  }
  return out;
}
function oldOk(list) {
  var bad = [];
  list.forEach(function (r) {
    if (r.glass !== 'classic' || r.saved.shape !== 'classic' || r.inUse !== 'classic') bad.push(r.name + ': the glass ' + r.glass + ', saved ' + r.saved.shape + ', in use ' + r.inUse);
    if (r.name === '1.14.0' || r.name === '1.13.0' || r.name === '1.10.0') {
      Object.keys(r.save).forEach(function (k) {
        if (k === 'realSandBuild') return;                         // (the engine's stamp: the app writes its own)
        if (JSON.stringify(r.saved[k]) !== JSON.stringify(r.save[k])) bad.push(r.name + ': ' + k + ' ' + JSON.stringify(r.saved[k]) + ' for ' + JSON.stringify(r.save[k]));
      });
    }
    if (r.errors.length) bad.push(r.name + ': ' + r.errors[0]);
  });
  return { ok: list.length === 6 && bad.length === 0, detail: bad.length ? bad.join('; ') : list.map(function (r) { return r.name + ' -> ' + r.glass; }).join(', ') + '; every other setting of the three old saves as it was' };
}

/* ---- the run ---------------------------------------------------------------------------------- */
async function main() {
  var s = new H.Suite('app-shape');
  var env = await H.start();
  /** A control: the measurement on a broken copy must fail the named check. */
  async function control(label, key, measure, judge) {
    var r;
    try { r = judge(await measure())[key]; } catch (e) { r = { ok: false, detail: 'it threw: ' + (e && e.message) }; }
    s.check('CONTROL ' + label, !r.ok, r.detail);
  }
  function app(change) { return { open: { routes: [broken(env, 'app.js', change)] } }; }
  try {
    if (wanted('pick')) {
      var pk = pickOk(await pick(env));
      s.check('PICK: the Glass tab opens with its Shape section, above the frame\'s', pk.place.ok, pk.place.detail);
      s.check('PICK: the shapes Tune offers, all nine, in their order, a radiogroup three a row', pk.group.ok, pk.group.detail);
      var ph = pickOk(await pick(env, { hold: ['trumpet'] }));
      s.check('PICK: a shape held back is not shown (Trumpet, held on this page)', ph.group.ok, ph.group.detail);
      s.check('PICK: every shape drawn at one scale (Delta wider than Bell by their own widths, Onion taller)', pk.scale.ok, pk.scale.detail);
      s.check('PICK: Classic is in use, drawn large, its button "In use"', pk.inUse.ok, pk.inUse.detail);
      await control('a copy that draws each shape to fill its own box loses the one scale', 'scale', function () {
        return pick(env, app(chain(swap('    if (!shapeBox) {                                    // one box for all: every shape at the same scale', '    shapeBox = null;\n    if (!shapeBox) {'),
                                   swap('        var gi = P.makeGeometry(1, SHAPE_IDS[i]);', '        var gi = g;'))));
      }, pickOk);
      await control('a copy that offers every registered shape shows the one held back', 'group', function () {
        return pick(env, Object.assign({ hold: ['trumpet'] }, app(swap('if (P.SHAPES[P.SHAPE_ORDER[si]].offered) SHAPE_IDS.push', 'SHAPE_IDS.push'))));
      }, pickOk);
    }
    if (wanted('look')) {
      var lk = lookOk(await look(env));
      s.check('LOOK: a tap shows the shape, large, with its name and "Use this shape"; the shape in use again says "In use"', lk.shows.ok, lk.shows.detail);
      s.check('LOOK: ... and only shows it: nothing saved, the page not loaded again, the glass behind as it was', lk.still.ok, lk.still.detail);
      s.check('LOOK: no page or console errors', lk.errors.ok, lk.errors.detail);
      await control('a copy whose tap on a shape saves it', 'still', function () {
        return look(env, app(swap('      shapeLooked = b.dataset.shape;\n', '      shapeLooked = b.dataset.shape; settings.shape = shapeLooked; save();\n')));
      }, lookOk);
    }
    if (wanted('use')) {
      var us = useOk(await use(env));
      s.check('USE: "Use this shape" builds the page again in Delta, saved, the glass still running', us.built.ok, us.built.detail);
      s.check('USE: Tune is open again at once on the Glass tab, Delta in use', us.tune.ok, us.tune.detail);
      s.check('USE: ... with the focus on Tune itself, and no focus ring on a button', us.focus.ok, us.focus.detail);
      s.check('USE: changed at 40 % of a 5-minute glass, the time left is kept within a frame', us.time.ok, us.time.detail);
      s.check('USE: the sand is counted anew as the same share of Delta\'s full glass, as much above the neck as the clock asks (within a grain)', us.sand.ok, us.sand.detail);
      s.check('USE: ... and the glass runs out at 00:00.0 on time, the last grain with it', us.end && us.end.ok, us.end && us.end.detail);
      await control('a copy that restores the session as if the glass were the same', 'sand', function () {
        return use(env, Object.assign({ short: true }, app(swap('    if (was !== glassShape()) {', '    if (false) {'))));
      }, useOk);
      await control('a copy that does not open Tune again after the reload', 'tune', function () {
        return use(env, Object.assign({ short: true }, app(swap('  if (reopen === \'glass\') {', '  if (false) {'))));
      }, useOk);
      await control('a copy that gives the focus to the close button after the reload', 'focus', function () {
        return use(env, Object.assign({ short: true }, app(swap('openSheet(sheetSettings, btnSettings, sheetSettings);', 'openSheet(sheetSettings, btnSettings);'))));
      }, useOk);
    }
    if (wanted('shapes')) {
      var sh = shapesOk(await shapes(env));
      s.check('SHAPES: in each shape Tune offers, a 60-minute glass filled to its cap, all above the neck', sh.fill.ok, sh.fill.detail);
      s.check('SHAPES: ... and a 10 s glass runs out at 00:00.0 on time, the last grain with it (census exact, no errors)', sh.end.ok, sh.end.detail);
      await control('a copy that builds every glass classic', 'fill', function () {
        return shapes(env, Object.assign({ short: true }, app(swap('    if (id !== \'classic\' && P.SHAPES', '    if (false && P.SHAPES'))));
      }, shapesOk);
    }
    if (wanted('sand')) {
      var sa = sandOk(await sandCase(env));
      s.check('SAND: the small glasses and the large one are drawn in the sand chosen in the Sand tab', sa.first.ok, sa.first.detail);
      s.check('SAND: ... and with Tune open a change of sand repaints them: a sand that is no material (Red Garnet), then a colour of one\'s own', sa.change.ok, sa.change.detail);
      await control('a copy that does not repaint the shapes when the sand changes', 'change', function () {
        return sandCase(env, app(swap('    shapeSand(rec);\n', '')));
      }, sandOk);
      await control('a copy that draws the shapes in the old material\'s sand', 'change', function () {
        return sandCase(env, app(swap('    var sd = (rec || sandRecord()).sand;', '    var sd = P.THEMES[settings.theme] && P.THEMES[settings.theme].sand;')));
      }, sandOk);
    }
    if (wanted('full')) {
      var fu = fullOk(await full(env));
      s.check('FULL: a 60-minute Delta glass, and a 60-minute Trumpet, has no room: its Sand button reads "Full", says "The glass is full", and a tap adds none', fu.says.ok, fu.says.detail);
      s.check('FULL: the classic 60-minute glass has room: its button reads "Sand" and a tap adds sand', fu.room.ok, fu.room.detail);
      await control('a copy whose Sand button never says the glass is full', 'says', function () {
        return full(env, app(swap('    var full = sim.total >= sim.maxTotal;', '    var full = false;')));
      }, fullOk);
    }
    if (wanted('old')) {
      var od = oldOk(await old(env));
      s.check('OLD: saves of 1.14.0, 1.13.0 and 1.10.0 come up in the classic glass, every setting as it was; a shape held back (trumpet, florence, each held on its page) or unknown is the classic glass, saved so', od.ok, od.detail);
      await control('a copy of the settings that takes any shape name', 'ok', function () {
        return old(env, { open: { routes: [broken(env, 'app/settings.js', swap('return !!s && has.call(s, v) && s[v].offered === true;', 'return true;'))] } });
      }, function (l) { return { ok: oldOk(l) }; });
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
}

if (require.main === module) main();
