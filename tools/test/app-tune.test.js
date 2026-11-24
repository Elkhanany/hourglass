#!/usr/bin/env node
/*
 * The new Tune, in the app: four tabs, Sand · Glass · Sound · Time, at one height (settings
 * design 2 and 3; round 1, step 3).
 *
 *   PANELS    one panel shown at a time, from the boot on; a tap on a tab shows its panel and
 *             no other; everything that can be set in Tune is in one of the four panels
 *   REMEMBER  the tab last shown is saved (tuneTab) and Tune opens on it, from its top: after
 *             a close, and after the page is loaded again; a tab shown again starts at its top;
 *             a saved name that is no tab comes up as Sand
 *   PLACE     the tab row and the close button stand at the same place on all four tabs, at
 *             390 × 844, 375 × 667 and 430 × 932; a tab that scrolls (under a finger, and to
 *             its end) leaves them, the sheet and the page where they were
 *   TOP       the sheet's top edge is 44 px under the glass's neck at those three sizes (454,
 *             365 and 502 px down), again once the frame is switched off (the glass sits
 *             larger) and when the window changes size; its lower edge is the screen's
 *   SIDE      a phone on its side keeps the old limit, 28 px from the top, on every tab
 *   FLOOR     a very short screen still gets 220 px of sheet
 *   SCRIM     behind Tune the scrim is light (0.2), behind the custom sheet as it was (0.5); a
 *             tap on it above the sheet closes Tune and does not start the glass
 *   ARIA      what a screen reader meets: a dialog named Tune, a tablist of four tabs, each
 *             with its panel and named by it, one selected and alone in the tab order
 *   KEYS      with the focus on a tab the arrows (round the ends), Home and End show and save
 *             the tab they move to and take the focus there, without a buzz; elsewhere they do
 *             nothing; Escape closes
 *   FOCUS     with a keyboard the focus stays in an open sheet: Tab twenty times and Shift+Tab
 *             twenty times from the close button never leave Tune (on the Sand and the Time
 *             tab) nor the custom-duration sheet, and go round from the last control to the
 *             first and back
 *   HAPTIC    on an iPhone's shape every button and switch row of all four panels, the tabs
 *             and the reset link carry their haptic label from the boot, before Tune is ever
 *             opened; a tab's tap and the link's taps tick
 *   TOAST     said while Tune is open, a toast sits just above the sheet, 4 px clear of it, and
 *             goes with it
 *   RESET     "Put the look and sound back as they came": the first tap only asks (and gives
 *             up after 3 s, when another tab is shown, when Tune is closed; a double tap is one
 *             tap); the second puts back the ten settings it names and no other (the sand and
 *             its finish among them; the custom sand's colour is kept), tells the
 *             engines what differed and nothing else, in order, rings no bowl, says so above the
 *             sheet, and loads nothing again; the first tap's question is said to a screen reader
 *             through a polite status drawn nowhere, emptied when the link gives up or answers
 *   HINT      at 393 × 852: a tab with more below shows it (its rows fade into the sheet's lower
 *             edge, a small chevron under them) from the moment it is shown at its top, and not
 *             once it is scrolled to its end (since 1.15.0 every tab has more below at its top,
 *             Glass too, with its shapes above the frame); a tab scrolled
 *             from its top fades its rows out under the tab row; neither edge takes a tap (a
 *             finger on the hint reaches the row under it) or is read out, and neither moves the
 *             sheet, the tab row or any row from where they were at 122a7fd; rows that appear or
 *             go (Grain with Real sand, "Copy a report") keep it right; with reduced motion they
 *             appear and go without a fade
 *
 * Every check has its control: the same measurements on a copy of the app with that one thing
 * broken (a rule more in the style sheet, a listener more after app.js, an attribute changed in
 * the page), which must fail the check. The copy is handed to the page in place of the file it
 * stands for; nothing is written, and the tree served is the app as it ships.
 *
 * Controls are reached through lib/tune.js, which finds a control's tab from the page.
 *
 *   node tools/test/app-tune.test.js [--port <n>] [--root <dir>] [--only <case>]
 */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var trace = require('./lib/trace.js');
var sleep = H.sleep;

var KEY = 'hourglass.settings.v1';
var TABS = ['sand', 'glass', 'sound', 'time'], NAMES = ['Sand', 'Glass', 'Sound', 'Time'];
var GAP = 44;                                        // the sheet's top edge under the neck (px)
var SIZES = [[390, 844], [375, 667], [430, 932]];
var TOP_AT = { '390 x 844': 454, '375 x 667': 365, '430 x 932': 502 };   // the design's measurements of the app
var ASK = 'Put the look and sound back as they came', SURE = 'Tap again to put them back', DONE = 'Look and sound put back';
// what the reset puts back: a new install's values
var BACK = { theme: 'sahara', sand: 'sahara', finish: 'walnut', frame: true, layers: false, volume: 0.8, character: 'asmr', ambience: 'none', ambienceLevel: 0.5, chime: true };

/* ---- a copy with something broken, for a control ---------------------------------------- */
/** A route that hands the page a file of the tree with `change` made to it (text → text). */
function broken(env, file, change) {
  var src = fs.readFileSync(path.join(env.root, file), 'utf8'), out = change(src);
  if (out === src) throw new Error('app-tune: the control\'s change to ' + file + ' changed nothing');
  var type = /\.css$/.test(file) ? 'text/css' : /\.html$/.test(file) ? 'text/html' : 'text/javascript';
  var names = file === 'index.html' ? ['/', '/index.html'] : ['/' + file], origin = env.url.replace(/\/$/, '');
  return {
    url: function (u) { return u.origin === origin && names.indexOf(u.pathname) >= 0; },
    handler: function (route) { route.fulfill({ status: 200, contentType: type + '; charset=utf-8', body: out }); }
  };
}
function add(text) { return function (src) { return src + '\n' + text + '\n'; }; }
function swap(re, to) {
  return function (src) {
    var n = (src.match(new RegExp(re.source, 'g')) || []).length;
    if (n !== 1) throw new Error('app-tune: a control\'s text is in the file ' + n + ' times: ' + re.source);
    return src.replace(re, to);
  };
}
/** Code that runs once app.js has (a listener more, a button more), as a self-contained ES5 block. */
function after(fn) { return add(';(' + fn.toString() + ')();'); }
/** A script the page runs before any of its own (index.html's scripts are deferred; this one is not). */
function before(fn) { return add('<script>(' + fn.toString() + ')();</script>'); }

/* ---- reading the page -------------------------------------------------------------------- */
function saved(t) { return t.eval(function (k) { return JSON.parse(localStorage.getItem(k) || 'null'); }, KEY); }
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function same(a, b, tol) { return a.length === b.length && a.every(function (v, i) { return near(v, b[i], tol); }); }

/** The tabs and the panels as they are now. */
function look(t) {
  return t.eval(function () {
    var s = document.getElementById('sheet-settings'), tabs = window.__tune.tabs();
    var panels = Array.prototype.map.call(s.querySelectorAll('[role="tabpanel"]'), function (p) {
      var r = p.getBoundingClientRect();
      return { id: p.id, hidden: p.hidden, away: p.hidden || getComputedStyle(p).display === 'none', box: p.getClientRects().length > 0 && r.width > 0 && r.height > 0 };
    });
    var body = s.querySelector('.sheet-body');
    return {
      open: window.__tune.isOpen(), n: tabs.length, panels: panels.length,
      selected: tabs.filter(function (x) { return x.selected === 'true'; }).map(function (x) { return x.key; }),
      unselected: tabs.filter(function (x) { return x.selected === 'false'; }).length,
      inOrder: tabs.filter(function (x) { return x.tabindex === 0; }).map(function (x) { return x.key; }),
      panelOf: tabs.reduce(function (o, x) { o[x.key] = x.controls; return o; }, {}),
      on: panels.filter(function (p) { return !p.away; }).map(function (p) { return p.id; }),          // not put away
      drawn: panels.filter(function (p) { return p.box; }).map(function (p) { return p.id; }),         // on screen
      hidden: panels.filter(function (p) { return p.hidden; }).length,
      top: body ? body.scrollTop : -1,
      focus: document.activeElement ? document.activeElement.id || document.activeElement.className : ''
    };
  });
}
/** Does the page show this tab, and no other? */
function shows(L, key) {
  var p = L.panelOf[key];
  return L.n === 4 && L.panels === 4 && L.selected.join() === key && L.unselected === 3 && L.inOrder.join() === key &&
    L.on.join() === p && L.hidden === 3 && (!L.open || L.drawn.join() === p);
}
function brief(L) { return 'selected ' + (L.selected.join('+') || 'none') + ', shown ' + (L.on.join('+') || 'none') + (L.open ? ', on screen ' + (L.drawn.join('+') || 'none') : ''); }
/** A finger on a tab (by its name in the page), and the sheet at rest again. */
async function tapTab(t, key) {
  await t.page.tap('#sheet-settings [role="tab"][data-tab="' + key + '"]');
  await tune.rest(t);
}

/* ---- PANELS ------------------------------------------------------------------------------ */
async function panels(env, o) {
  var t = await env.open(o || {}), m = { each: [] };
  try {
    await sleep(600);
    m.boot = await look(t);
    m.loose = await t.eval(function () {
      // what a person can set or press in Tune, and is in no panel (the head's tabs and close button apart)
      var s = document.getElementById('sheet-settings');
      return Array.prototype.filter.call(s.querySelectorAll('.row, .slider-row, [role="radiogroup"], input, select, a, button:not(.sheet-close):not([role="tab"])'), function (el) {
        return !el.closest('[role="tabpanel"]');
      }).map(function (el) { return el.id || el.className || el.tagName; });
    });
    await tune.open(t);
    m.opened = await look(t);
    var order = [TABS[1], TABS[2], TABS[3], TABS[0], TABS[2]];
    for (var i = 0; i < order.length; i++) {
      await tapTab(t, order[i]);
      m.each.push({ key: order[i], look: await look(t) });
    }
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function panelsOk(m) {
  var bad = m.each.filter(function (e) { return !shows(e.look, e.key); });
  return {
    boot: { ok: !m.boot.open && shows(m.boot, 'sand') && shows(m.opened, 'sand'), detail: 'closed: ' + brief(m.boot) + '; opened: ' + brief(m.opened) },
    taps: { ok: bad.length === 0 && m.each.length === 5, detail: bad.length ? 'after a tap on ' + bad[0].key + ': ' + brief(bad[0].look) : m.each.map(function (e) { return e.key; }).join(', ') + ': each alone' },
    loose: { ok: m.loose.length === 0, detail: m.loose.join(', ') },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- REMEMBER ---------------------------------------------------------------------------- */
async function remember(env, o) {
  var t = await env.open(o || {}), m = {};
  function scrollTo(px) { return t.eval(function (y) { var b = document.querySelector('#sheet-settings .sheet-body'); b.scrollTop = y; return b.scrollTop; }, px); }
  try {
    await sleep(600);
    await tune.open(t);
    await tapTab(t, 'sound');
    m.saved1 = (await saved(t)).tuneTab;
    m.scrolled1 = await scrollTo(150);
    await tune.close(t);
    m.closed = await look(t);
    await tune.open(t);
    m.reopened = await look(t);
    // another tab and back: from its top
    await tapTab(t, 'time');
    m.scrolled2 = await scrollTo(90);
    await tapTab(t, 'sound');
    m.back = await look(t);
    await scrollTo(150);
    await tapTab(t, 'sound');                          // the tab already shown
    m.again = await look(t);
    m.saved2 = (await saved(t)).tuneTab;
    await tune.close(t);
    await t.reload();
    await sleep(600);
    m.loaded = await look(t);
    m.saved3 = (await saved(t)).tuneTab;
    await tune.open(t);
    m.loadedOpen = await look(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function rememberOk(m) {
  return {
    close: { ok: m.saved1 === 'sound' && m.scrolled1 > 100 && shows(m.closed, 'sound') && shows(m.reopened, 'sound') && m.reopened.top === 0,
             detail: 'saved "' + m.saved1 + '", scrolled ' + m.scrolled1 + ' px; closed: ' + brief(m.closed) + '; opened again: ' + brief(m.reopened) + ' at ' + m.reopened.top + ' px' },
    top: { ok: m.scrolled2 > 50 && shows(m.back, 'sound') && m.back.top === 0 && shows(m.again, 'sound') && m.again.top === 0 && m.saved2 === 'sound',
           detail: 'Time scrolled ' + m.scrolled2 + ' px; back on Sound at ' + m.back.top + ' px; tapped again at ' + m.again.top + ' px' },
    reload: { ok: m.saved3 === 'sound' && !m.loaded.open && shows(m.loaded, 'sound') && shows(m.loadedOpen, 'sound') && m.loadedOpen.top === 0,
              detail: 'saved "' + m.saved3 + '"; loaded: ' + brief(m.loaded) + '; opened: ' + brief(m.loadedOpen) },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}
/** A saved tab that is none: the page comes up on Sand. */
async function rememberBad(env) {
  var out = [];
  for (var v of ['lagoon', 3, '']) {
    var t = await env.open({ storage: { 'hourglass.settings.v1': { tuneTab: v } } });
    try { await sleep(400); var L = await look(t); out.push({ v: v, ok: shows(L, 'sand') && t.errors.length === 0, detail: JSON.stringify(v) + ': ' + brief(L) }); } finally { await t.close(); }
  }
  return out;
}

/* ---- PLACE and TOP: one phone size ------------------------------------------------------- */
function geo(t) {
  return t.eval(function () {
    var a = document.getElementById('assembly').getBoundingClientRect(), s = document.getElementById('sheet-settings'), r = s.getBoundingClientRect();
    return { neck: a.top + a.height / 2, prop: s.style.getPropertyValue('--tune-top').trim(), top: r.top, bottom: r.bottom, height: r.height,
             ih: window.innerHeight, iw: window.innerWidth, open: window.__tune.isOpen() };
  });
}
/** Where the tab row, the close button and the sheet stand, and what scrolls the tab shown. */
function place(t) {
  return t.eval(function () {
    var s = document.getElementById('sheet-settings'), row = s.querySelector('[role="tablist"]'), x = s.querySelector('.sheet-close');
    var shown = s.querySelector('[role="tabpanel"]:not([hidden])'), sc = shown && shown.firstElementChild ? window.__tune.scroller(shown.firstElementChild) : null;
    function R(el) { var r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }
    var q = sc ? sc.getBoundingClientRect() : null;
    return {
      row: row ? R(row) : [], close: x ? R(x) : [], sheet: R(s),
      scroller: sc ? (sc.id ? '#' + sc.id : '.' + String(sc.className).split(' ')[0]) : '(none)',
      view: sc ? sc.clientHeight : 0, length: sc ? sc.scrollHeight : 0, scrolled: sc ? sc.scrollTop : 0, viewBox: q ? [q.left, q.top, q.right, q.bottom] : null,
      page: (document.scrollingElement ? document.scrollingElement.scrollTop : 0) + document.getElementById('app').scrollTop
    };
  });
}
/**
 * One phone: where the sheet stands against the neck, where the tab row stands on each tab, and
 * what a scroll does to it. o.extra: the frame switched off, and the window made another size.
 */
async function sized(env, size, o) {
  o = o || {};
  var t = await env.open(Object.assign({ viewport: { width: size[0], height: size[1] } }, o.open || {})), m = { size: size.join(' x '), tabs: [] };
  try {
    await sleep(700);
    m.closed = await geo(t);
    await tune.open(t);
    m.opened = await geo(t);
    for (var k = 0; k < TABS.length; k++) {
      await tapTab(t, TABS[k]);
      var p = await place(t);
      p.key = TABS[k];
      m.tabs.push(p);
    }
    // the tab with the most to scroll: under a finger, then to its end
    var long = m.tabs.slice().sort(function (a, b) { return (b.length - b.view) - (a.length - a.view); })[0];
    m.long = long.key;
    await tapTab(t, long.key);
    var p0 = await place(t), vb = p0.viewBox;
    if (vb) {
      var x = (vb[0] + vb[2]) / 2, y0 = vb[1] + 0.75 * (vb[3] - vb[1]), dy = Math.min(170, y0 - vb[1] - 12);
      await t.touch.down(x, y0);
      await t.touch.path(function (u) { return { x: x, y: y0 - dy * u }; }, 350);
      await t.touch.up();
      await sleep(700);
    }
    m.finger = await place(t);
    m.finger.look = await look(t);
    await t.eval(function () {
      var s = document.getElementById('sheet-settings'), shown = s.querySelector('[role="tabpanel"]:not([hidden])');
      var sc = shown && shown.firstElementChild ? window.__tune.scroller(shown.firstElementChild) : null;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
    await tune.rest(t);
    m.end = await place(t);
    m.start = p0;
    if (o.extra) {
      // the frame switched off: the bare glass sits larger, and layout() runs behind the cross-fade
      await tune.tap(t, '#opt-frame');
      await sleep(1300);
      await tune.rest(t);
      m.noFrame = await geo(t);
      m.noFrame.frame = await t.eval(function () { return window.Hourglass.renderer.frame; });
      // the window made another size (a phone turned back and forth lays the page out the same way)
      await t.page.setViewportSize({ width: o.extra[0], height: o.extra[1] });
      await sleep(900);
      await tune.rest(t);
      m.resized = await geo(t);
    }
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
/**
 * The sheet's top edge is where the neck puts it: the property is the neck + 44 px, rounded to a
 * whole pixel, and the sheet is there, within 1 px (the contract's tolerance: half a pixel of
 * rounding, and the glass is drawn up to a tenth of a pixel from where the app reckons it, its
 * transform being written in tenths). That the sheet FOLLOWS the neck is checked apart, by how
 * far each moved (frame, resize), not by this tolerance.
 */
function under(g) { return /^\d+px$/.test(g.prop) && near(parseFloat(g.prop), g.neck + GAP, 1) && near(g.top, parseFloat(g.prop), 0.5); }
function topSays(g) { return 'neck at ' + g.neck.toFixed(1) + ', --tune-top ' + (g.prop || 'not set') + ', the sheet\'s top at ' + g.top.toFixed(1); }
function sizedOk(m) {
  var first = m.tabs[0], moved = m.tabs.filter(function (p) { return !same(p.row, first.row, 0.5) || !same(p.close, first.close, 0.5) || !same(p.sheet, first.sheet, 0.5); });
  var mid = function (p) { return ((p.row[1] + p.row[3]) / 2).toFixed(1); };
  var still = function (p) { return same(p.row, m.start.row, 0.5) && same(p.close, m.start.close, 0.5) && same(p.sheet, m.start.sheet, 0.5) && p.page === 0; };
  var out = {
    place: { ok: m.tabs.length === 4 && first.row.length === 4 && moved.length === 0 && first.row[3] - first.row[1] >= 30,
             detail: m.size + ': the tab row\'s centre at y ' + m.tabs.map(mid).join(', ') + ' (Sand, Glass, Sound, Time); ' + first.view + ' px of rows in view; the tabs are ' +
                     m.tabs.map(function (p) { return p.length; }).join(', ') + ' px long' + (moved.length ? '; MOVED on ' + moved.map(function (p) { return p.key; }).join(', ') : '') },
    scroll: { ok: m.start.scroller === '.sheet-body' && m.start.length - m.start.view > 100 && m.finger.scrolled > 100 && still(m.finger) && shows(m.finger.look, m.long) &&
                  m.end.scrolled >= m.end.length - m.end.view - 1 && m.end.scrolled > m.finger.scrolled - 1 && still(m.end),
              detail: m.size + ': ' + m.long + ' (' + m.start.length + ' px in ' + m.start.view + ') scrolls in ' + m.start.scroller + ': ' + Math.round(m.finger.scrolled) + ' px under a finger, ' +
                      Math.round(m.end.scrolled) + ' px at its end; the tab row at y ' + mid(m.start) + ', then ' + mid(m.finger) + ', then ' + mid(m.end) + '; the page scrolled ' + (m.finger.page + m.end.page) + ' px' },
    top: { ok: !m.closed.open && m.opened.open && under(m.opened) && near(m.opened.neck, m.closed.neck, 0.01) && m.closed.prop === m.opened.prop &&
               near(m.opened.top, TOP_AT[m.size], 1) && near(m.opened.bottom, m.opened.ih, 0.5) && m.opened.neck > 0,
           detail: m.size + ': ' + topSays(m.opened) + ' (' + (m.opened.top - m.opened.neck).toFixed(1) + ' px under; the design measured ' + TOP_AT[m.size] + '), its lower edge at ' +
                   m.opened.bottom.toFixed(1) + ' of ' + m.opened.ih + '; ' + Math.round(100 * m.opened.height / m.opened.ih) + ' % of the screen' },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
  if (m.noFrame) {
    // (the neck moves a pixel here; within the rounding above a sheet left where it was could pass, so the sheet must have moved as far as the neck did)
    var dn = m.noFrame.neck - m.opened.neck, dt = m.noFrame.top - m.opened.top;
    out.frame = { ok: m.noFrame.frame === false && under(m.noFrame) && Math.abs(dn) >= 0.5 && Math.abs(dt - dn) <= 0.75,
                  detail: 'the frame off: ' + topSays(m.noFrame) + ' (the neck was at ' + m.opened.neck.toFixed(1) + ', the sheet\'s top at ' + m.opened.top.toFixed(1) + ')' };
    out.resize = { ok: under(m.resized) && m.resized.ih !== m.opened.ih && near(m.resized.bottom, m.resized.ih, 0.5),
                   detail: 'made ' + m.resized.iw + ' x ' + m.resized.ih + ': ' + topSays(m.resized) };
  }
  return out;
}

/* ---- SIDE, FLOOR ------------------------------------------------------------------------- */
async function odd(env, size, o) {
  var t = await env.open(Object.assign({ viewport: { width: size[0], height: size[1] } }, o || {})), m = { size: size.join(' x '), tabs: [] };
  try {
    await sleep(700);
    await tune.open(t);
    m.g = await geo(t);
    for (var k = 0; k < TABS.length; k++) { await tapTab(t, TABS[k]); m.tabs.push(await place(t)); }
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function oddSame(m) { return m.tabs.length === 4 && m.tabs.every(function (p) { return same(p.row, m.tabs[0].row, 0.5) && same(p.sheet, m.tabs[0].sheet, 0.5); }); }
function sideOk(m) {
  return { ok: near(m.g.top, 28, 1) && near(m.g.bottom, m.g.ih, 0.5) && oddSame(m) && m.errors.length === 0,
           detail: m.size + ': the sheet from ' + m.g.top.toFixed(1) + ' to ' + m.g.bottom.toFixed(1) + ' of ' + m.g.ih + ' (--tune-top ' + m.g.prop + ', the neck at ' + m.g.neck.toFixed(1) + ')' };
}
function floorOk(m) {
  // (the floor must be what holds the sheet up here, or the size proves nothing)
  var binds = m.g.neck + GAP > m.g.ih - 220 + 0.5;
  return { ok: binds && near(m.g.height, 220, 1) && near(m.g.bottom, m.g.ih, 0.5) && oddSame(m) && m.errors.length === 0,
           detail: m.size + ': the neck at ' + m.g.neck.toFixed(1) + ', so ' + (m.g.ih - m.g.neck - GAP).toFixed(1) + ' px under it' + (binds ? '' : ' (THE FLOOR IS NOT REACHED AT THIS SIZE)') +
                   '; the sheet is ' + m.g.height.toFixed(1) + ' px tall' };
}

/* ---- SCRIM ------------------------------------------------------------------------------- */
async function scrim(env, o) {
  var t = await env.open(o || {}), m = {};
  function read() {
    return t.eval(function () {
      var sc = document.getElementById('scrim');
      return { light: sc.classList.contains('light'), bg: getComputedStyle(sc).backgroundColor, shown: !sc.hidden && sc.classList.contains('open'),
               tune: window.__tune.isOpen(), custom: !document.getElementById('sheet-custom').hidden, state: window.Hourglass.timer.state };
    });
  }
  try {
    await sleep(700);
    await tune.open(t);
    await sleep(600);                                  // (the scrim's own fade)
    m.tune = await read();
    var g = await geo(t);
    await t.touch.tap(g.iw / 2, g.neck - 70, 60);      // on the upper bulb, above the sheet
    await t.page.waitForFunction(function () { return document.getElementById('sheet-settings').hidden; }, null, { timeout: 4000 }).catch(function () {});
    await sleep(200);
    m.after = await read();
    await t.page.tap('#readout');                      // the custom-duration sheet
    await sleep(900);
    m.custom = await read();
    await t.page.keyboard.press('Escape');
    await sleep(700);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function scrimOk(m) {
  return {
    light: { ok: m.tune.tune && m.tune.shown && m.tune.light && m.tune.bg === 'rgba(4, 5, 6, 0.2)' && m.custom.custom && m.custom.shown && !m.custom.light && m.custom.bg === 'rgba(4, 5, 6, 0.5)',
             detail: 'behind Tune ' + m.tune.bg + (m.tune.light ? ' (light)' : '') + ', behind the custom sheet ' + m.custom.bg + (m.custom.light ? ' (light)' : '') },
    tap: { ok: m.tune.tune && !m.after.tune && m.tune.state === 'idle' && m.after.state === 'idle' && m.errors.length === 0,
           detail: 'Tune ' + (m.after.tune ? 'still open' : 'closed') + ', the glass ' + m.after.state + ' ' + m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- ARIA -------------------------------------------------------------------------------- */
async function aria(env, o) {
  var t = await env.open(o || {}), m;
  try {
    await sleep(600);
    await tune.open(t);
    m = await t.eval(function () {
      var s = document.getElementById('sheet-settings'), title = document.getElementById('settings-title'), list = s.querySelector('[role="tablist"]');
      var body = s.querySelector('.sheet-body'), close = s.querySelector('.sheet-close'), head = s.querySelector('.sheet-head'), tabs = window.__tune.tabs();
      var tr = title ? title.getBoundingClientRect() : null, lr = list ? list.getBoundingClientRect() : null, cr = close ? close.getBoundingClientRect() : null;
      return {
        dialog: [s.getAttribute('role'), s.getAttribute('aria-modal'), s.getAttribute('aria-labelledby')],
        title: title ? [title.tagName, title.textContent.trim(), s.contains(title), tr.width <= 1.01 && tr.height <= 1.01] : null,
        list: list ? [list.id, list.getAttribute('aria-labelledby'), list.children.length, !!head && head.contains(list)] : null,
        tabs: tabs,
        inBody: tabs.map(function (x) { var p = document.getElementById(x.controls); return !!p && p.parentNode === body; }),
        close: close ? [close.tagName, close.getAttribute('type'), close.getAttribute('aria-label')] : null,
        rowThenClose: !!lr && !!cr && lr.right <= cr.left + 0.5 && lr.left < cr.left,
        opener: document.getElementById('btn-settings').getAttribute('aria-label'),
        scrollers: Array.prototype.filter.call(s.querySelectorAll('*'), function (el) { var oy = getComputedStyle(el).overflowY; return oy === 'auto' || oy === 'scroll'; })
          .map(function (el) { return el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]; })
      };
    });
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function ariaOk(m) {
  var bad = [];
  if (m.dialog.join() !== 'dialog,true,settings-title') bad.push('the sheet is ' + m.dialog.join(' '));
  if (!m.title || m.title.join() !== 'H2,Tune,true,true') bad.push('the title is ' + JSON.stringify(m.title));
  if (!m.list || m.list.join() !== 'tune-tabs,settings-title,4,true') bad.push('the tab row is ' + JSON.stringify(m.list));
  if (m.tabs.length !== 4) bad.push(m.tabs.length + ' tabs');
  m.tabs.forEach(function (x, i) {
    var want = { id: 'tab-' + TABS[i], name: NAMES[i], key: TABS[i], tag: 'BUTTON', type: 'button', controls: 'panel-' + TABS[i], inList: true };
    Object.keys(want).forEach(function (k) { if (x[k] !== want[k]) bad.push('tab ' + (i + 1) + ': ' + k + ' ' + JSON.stringify(x[k]) + ' for ' + JSON.stringify(want[k])); });
    if (x.selected !== 'true' && x.selected !== 'false') bad.push(x.id + ': aria-selected ' + x.selected);
    if (x.tabindex !== (x.selected === 'true' ? 0 : -1)) bad.push(x.id + ': tabindex ' + x.tabindex + ' with aria-selected ' + x.selected);
    var p = x.panel;
    if (!p || p.role !== 'tabpanel' || p.labelledby !== x.id || !p.inTune || !m.inBody[i]) bad.push(x.id + ': its panel is ' + JSON.stringify(p) + (m.inBody[i] ? '' : ', not a child of the sheet\'s body'));
  });
  if (m.tabs.filter(function (x) { return x.selected === 'true'; }).length !== 1) bad.push('not one tab selected');
  if (!m.close || m.close.join() !== 'BUTTON,button,Close' || !m.rowThenClose) bad.push('the close button is ' + JSON.stringify(m.close) + (m.rowThenClose ? '' : ', not after the tab row'));
  if (m.opener !== 'Tune: sand, glass, sound and time') bad.push('the Tune button says "' + m.opener + '"');
  if (m.scrollers.join() !== '.sheet-body') bad.push('what scrolls in the sheet: ' + (m.scrollers.join(', ') || 'nothing'));
  if (m.errors.length) bad.push(m.errors[0]);
  return { ok: bad.length === 0, detail: bad.slice(0, 4).join('; ') };
}

/* ---- KEYS -------------------------------------------------------------------------------- */
// each key and the tab it must lead to, from Sand
var WALK = [['ArrowRight', 'glass'], ['ArrowRight', 'sound'], ['ArrowRight', 'time'], ['ArrowRight', 'sand'], ['ArrowLeft', 'time'], ['Home', 'sand'], ['End', 'time'], ['ArrowLeft', 'sound']];
async function keys(env, o) {
  var t = await env.open(Object.assign({ init: trace.recorder }, o || {})), m = { steps: [] };
  async function step(key, want) {
    await t.page.keyboard.press(key);
    await sleep(140);
    var r = await t.eval(function (k) { return { saved: JSON.parse(localStorage.getItem(k) || '{}').tuneTab, events: window.__trace.take() }; }, KEY);
    r.key = key; r.want = want; r.look = await look(t);
    return r;
  }
  try {
    await sleep(600);
    await tune.open(t);
    await sleep(200);                                  // (the close button has taken the focus)
    m.focus0 = (await look(t)).focus;
    await t.page.keyboard.press('Shift+Tab');          // back from the close button: the one tab in the tab order
    await sleep(100);
    m.focus1 = (await look(t)).focus;
    await t.eval(function () { var el = document.querySelector('#sheet-settings [role="tab"][aria-selected="true"]'); if (el) el.focus(); window.__trace.take(); });
    for (var i = 0; i < WALK.length; i++) m.steps.push(await step(WALK[i][0], WALK[i][1]));
    // a key that leads nowhere new: Home on the first tab
    await step('Home', 'sand');
    m.homeAgain = await step('Home', 'sand');
    // the focus elsewhere in the sheet: the keys are not the tabs'
    await t.eval(function () { document.querySelector('#sheet-settings .sheet-close').focus(); });
    m.elsewhere = await step('ArrowRight', 'sand');
    await t.page.keyboard.press('Escape');
    await t.page.waitForFunction(function () { return document.getElementById('sheet-settings').hidden; }, null, { timeout: 4000 }).catch(function () {});
    m.closed = !(await look(t)).open;
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function keysOk(m) {
  var bad = m.steps.filter(function (r) {
    return !(shows(r.look, r.want) && r.look.focus === 'tab-' + r.want && r.saved === r.want && JSON.stringify(r.events) === JSON.stringify([['save', { tuneTab: r.want }]]) && r.look.top === 0);
  });
  var quiet = function (r) { return shows(r.look, r.want) && r.saved === r.want && r.events.length === 0; };
  return {
    walk: { ok: bad.length === 0 && m.steps.length === WALK.length,
            detail: bad.length ? bad[0].key + ' for ' + bad[0].want + ': ' + brief(bad[0].look) + ', focus on ' + bad[0].look.focus + ', saved "' + bad[0].saved + '", ' + JSON.stringify(bad[0].events)
                               : m.steps.map(function (r) { return r.key.replace('Arrow', '') + ' ' + r.want; }).join(', ') },
    rest: { ok: m.focus0 === 'icon-btn sheet-close' && m.focus1 === 'tab-sand' && quiet(m.homeAgain) && m.homeAgain.look.focus === 'tab-sand' && quiet(m.elsewhere) && m.closed && m.errors.length === 0,
            detail: 'opened with the focus on ' + m.focus0 + ', Shift+Tab to ' + m.focus1 + '; Home on Sand: ' + JSON.stringify(m.homeAgain.events) + '; ArrowRight from the close button: ' + brief(m.elsewhere.look) +
                    ' ' + JSON.stringify(m.elsewhere.events) + '; Escape ' + (m.closed ? 'closed it' : 'DID NOT CLOSE IT') + ' ' + m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- HAPTIC ------------------------------------------------------------------------------ */
/** An iPhone has no navigator.vibrate. */
function noVibrate() {
  try { delete Navigator.prototype.vibrate; } catch (e) {}
  if (navigator.vibrate) { try { Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true }); } catch (e2) {} }
}
async function haptic(env, o) {
  var t = await env.open(Object.assign({ init: noVibrate }, o || {})), m = {};
  function sw(sel) { return t.eval(function (q) { var el = document.querySelector(q); return el && el._haptic ? el._haptic.querySelector('input').checked : null; }, sel); }
  /** A finger on a control: did its hidden switch flip (which is when the phone ticks)? */
  async function tapOn(sel, wait) {
    var c = await t.eval(function (q) { var r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel), a = await sw(sel);
    await t.touch.tap(c.x, c.y, 60);
    await sleep(wait || 350);
    return (await sw(sel)) !== a;
  }
  try {
    await sleep(900);
    m.boot = await t.eval(function () {
      var s = document.getElementById('sheet-settings'), hosts = Array.prototype.slice.call(s.querySelectorAll('button, label.row')), bad = [], per = {};
      hosts.forEach(function (h) {
        var l = h._haptic, ok = !!l && l.parentNode === h && l.matches('label.haptic[aria-hidden="true"]') && l.querySelectorAll('input[type="checkbox"][switch]').length === 1;
        var p = h.closest('[role="tabpanel"]'), at = p ? p.id : (h.getAttribute('role') === 'tab' ? 'tabs' : 'head');
        per[at] = per[at] || [0, 0];
        per[at][0]++;
        if (ok) per[at][1]++; else bad.push(h.id || h.getAttribute('for') || (h.textContent || '').trim().slice(0, 24));
      });
      return { vibrate: typeof navigator.vibrate, opened: window.__tune.isOpen(), hosts: hosts.length, bad: bad, per: per, labels: s.querySelectorAll('.haptic').length,
               reset: !!document.getElementById('tune-reset') && !!document.getElementById('tune-reset')._haptic };
    });
    await tune.open(t);
    m.tab = await tapOn('#sheet-settings [role="tab"][data-tab="glass"]');
    m.tabLook = await look(t);
    m.tabAgain = await tapOn('#sheet-settings [role="tab"][data-tab="glass"]');
    await tune.show(t, '#tune-reset');
    m.ask = await tapOn('#tune-reset', 250);
    m.asked = await t.eval(function () { return document.getElementById('tune-reset').getAttribute('data-state'); });
    await sleep(450);
    m.sure = await tapOn('#tune-reset', 350);
    m.done = await t.eval(function () { var q = document.getElementById('toast'); return document.getElementById('tune-reset').getAttribute('data-state') + ': ' + (q.classList.contains('show') ? q.textContent : ''); });
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function hapticOk(m) {
  var b = m.boot, P = TABS.map(function (k) { return 'panel-' + k; });
  var whole = P.every(function (id) { return b.per[id] && b.per[id][0] > 0; }) && !!b.per.tabs && b.per.tabs[0] === 4;
  return {
    boot: { ok: b.vibrate === 'undefined' && !b.opened && whole && b.bad.length === 0 && b.labels === b.hosts && b.reset,
            detail: P.concat(['tabs', 'head']).map(function (id) { return id.replace('panel-', '') + ' ' + (b.per[id] ? b.per[id][1] + ' of ' + b.per[id][0] : 'none'); }).join(', ') +
                    (b.bad.length ? '; without: ' + b.bad.join(', ') : '') + '; ' + b.labels + ' labels in the sheet' },
    taps: { ok: m.tab && shows(m.tabLook, 'glass') && m.tabAgain && m.ask && m.asked === 'armed' && m.sure && m.done === 'idle: ' + DONE && m.errors.length === 0,
            detail: 'a tab ' + m.tab + ' (' + brief(m.tabLook) + '), the tab shown ' + m.tabAgain + ', the link ' + m.ask + ' (' + m.asked + ') and ' + m.sure + ' (' + m.done + ') ' + m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- TOAST ------------------------------------------------------------------------------- */
function toastBox(t) {
  return t.eval(function () {
    var q = document.getElementById('toast'), r = q.getBoundingClientRect(), s = document.getElementById('sheet-settings').getBoundingClientRect();
    var row = document.querySelector('#sheet-settings [role="tablist"]'), a = document.getElementById('assembly').getBoundingClientRect();
    return { text: q.textContent, shown: q.classList.contains('show'), high: q.classList.contains('high'), opacity: +getComputedStyle(q).opacity,
             box: [r.left, r.top, r.right, r.bottom], sheet: s.top, row: row ? row.getBoundingClientRect().top : -1, neck: a.top + a.height / 2, iw: window.innerWidth };
  });
}
/** A toast said above the sheet: its lower edge 4 px over the sheet's top, centred, on the screen, over no tab. */
function above(b) {
  return b.shown && b.high && b.opacity > 0.9 && near(b.box[3], b.sheet - 4, 1) && near((b.box[0] + b.box[2]) / 2, b.iw / 2, 1) && b.box[1] >= 0 && b.box[3] <= b.row && b.box[3] - b.box[1] > 20;
}
function toastSays(b) {
  return '"' + b.text + '"' + (b.shown ? '' : ' NOT SHOWN') + (b.high ? '' : ' (not marked high)') + ' from y ' + b.box[1].toFixed(1) + ' to ' + b.box[3].toFixed(1) + ', centred at x ' +
    ((b.box[0] + b.box[2]) / 2).toFixed(1) + '; the sheet begins at ' + b.sheet.toFixed(1) + ', the neck is at ' + b.neck.toFixed(1);
}
async function toast(env, o) {
  var t = await env.open(o || {}), m = {};
  try {
    await sleep(600);
    await tune.tap(t, '#opt-breath');                  // Breathing pace says how to follow it
    await sleep(500);
    m.up = await toastBox(t);
    await tune.close(t);
    m.gone = await toastBox(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function toastOk(m) {
  return { ok: above(m.up) && /Breathe in/.test(m.up.text) && !m.gone.shown && m.errors.length === 0,
           detail: toastSays(m.up) + '; with Tune closed it is ' + (m.gone.shown ? 'STILL SHOWN' : 'gone') + ' ' + m.errors.slice(0, 2).join(' | ') };
}

/* ---- FOCUS ------------------------------------------------------------------------------- */
/** From the close button of the open sheet `id`: Tab `n` times, then (from the close button again) Shift+Tab `n` times. */
async function tabWalk(t, id, n) {
  function where() {
    return t.eval(function (id) {
      var s = document.getElementById(id), a = document.activeElement;
      var name = !a ? '' : a.id || (a.getAttribute('aria-label') || (a.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 24) || a.tagName;
      // (the sheet's own stops, as Tab meets them: shown, enabled, in the tab order)
      var stops = Array.prototype.filter.call(s.querySelectorAll('button, [href], input, select, textarea, [tabindex]'), function (c) {
        return c.tabIndex >= 0 && !c.disabled && c.getClientRects().length && getComputedStyle(c).visibility !== 'hidden';
      });
      return { inside: !!a && a !== s && s.contains(a), name: name, at: stops.indexOf(a), stops: stops.length };
    }, id);
  }
  var w = { fwd: [], back: [] };
  for (var dir = 0; dir < 2; dir++) {
    await t.eval(function (id) { document.querySelector('#' + id + ' .sheet-close').focus(); }, id);
    await sleep(60);
    w[dir ? 'back' : 'fwd'].push(await where());
    for (var i = 0; i < n; i++) {
      await t.page.keyboard.press(dir ? 'Shift+Tab' : 'Tab');
      await sleep(40);
      w[dir ? 'back' : 'fwd'].push(await where());
    }
  }
  return w;
}
async function focus(env, o) {
  var t = await env.open(o || {}), m = {};
  try {
    await sleep(600);
    await tune.open(t);
    await sleep(300);
    m.sand = await tabWalk(t, 'sheet-settings', 20);
    await tapTab(t, 'time');
    m.time = await tabWalk(t, 'sheet-settings', 20);
    await tune.close(t);
    await sleep(700);
    await t.page.tap('#readout');                      // the custom-duration sheet: the same open and close
    await sleep(900);
    m.custom = await tabWalk(t, 'sheet-custom', 20);
    await t.page.keyboard.press('Escape');
    await t.page.waitForFunction(function () { return document.getElementById('sheet-custom').hidden; }, null, { timeout: 4000 }).catch(function () {});
    m.closed = await t.eval(function () { return document.getElementById('sheet-custom').hidden; });
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
/** A walk that never leaves the sheet, and goes round: Tab from its last stop to its first, Shift+Tab from its first to its last. */
function walkOk(w) {
  var all = w.fwd.concat(w.back), out = all.filter(function (r) { return !r.inside; });
  var round = function (seq, from, to) {
    for (var i = 1; i < seq.length; i++) if (seq[i - 1].at === from(seq[i - 1]) && seq[i].at === to(seq[i])) return true;
    return false;
  };
  var fwdRound = round(w.fwd, function (r) { return r.stops - 1; }, function () { return 0; });
  var backRound = round(w.back, function () { return 0; }, function (r) { return r.stops - 1; });
  return { ok: out.length === 0 && fwdRound && backRound && all.length === 42,
           detail: (out.length ? 'LEFT THE SHEET for ' + out.map(function (r) { return r.name; }).slice(0, 3).join(', ') + '; ' : '') +
                   'Tab: ' + w.fwd.map(function (r) { return r.name; }).join(' > ') + (fwdRound ? ' (round from the last to the first)' : ' (NEVER ROUND)') +
                   '; Shift+Tab: ' + w.back.map(function (r) { return r.name; }).join(' < ') + (backRound ? ' (round from the first to the last)' : ' (NEVER ROUND)') };
}
function focusOk(m) {
  var sd = walkOk(m.sand), tm = walkOk(m.time), cu = walkOk(m.custom);
  return {
    tune: { ok: sd.ok && tm.ok, detail: 'Sand: ' + sd.detail + ' | Time: ' + tm.detail },
    custom: { ok: cu.ok && m.closed && m.errors.length === 0, detail: cu.detail + (m.closed ? '; Escape closed it' : '; ESCAPE DID NOT CLOSE IT') + ' ' + m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- RESET ------------------------------------------------------------------------------- */
// A save with everything the reset names changed, and with what it must keep changed too (the
// mute button, the grain, a sequence, breathing, Full Zen, the screen not kept awake, what the app
// has learned and hinted). Real motion is left off: left on, it has a life of its own at the boot.
var CHANGED = {
  theme: 'lapis', sand: 'garnet', sandColor: '185,0.5,0.5', finish: 'copper', frame: false, layers: true, volume: 0.35, character: 'bamboo', ambience: 'rain', ambienceLevel: 0.7, chime: false,
  muted: true, grain: 1, zenFull: true, keepAwake: false, breath: true, breathPattern: 'box', durationMs: 600000, restMs: 120000, rounds: 3,
  motionSign: -1, mendNotes: 2, hintCrack: true, hintZen: 3, hintMotion: 3, tuneTab: 'time'
};
/** The reset link, the saved settings as text, and what the page and the engines show of the eight. */
function resetState(t) {
  return t.eval(function (key) {
    var Hg = window.Hourglass, el = document.getElementById('tune-reset'), q = document.getElementById('toast'), a = Hg.audio;
    var say = document.getElementById('tune-reset-say'), sb = say ? say.getBoundingClientRect() : null;
    var one = function (sel) { var c = document.querySelector(sel); return c ? (c.dataset.sand || c.dataset.finish || c.dataset.character || c.dataset.ambience) : null; };
    return {
      link: el ? [el.getAttribute('data-state'), (el.textContent || '').replace(/\s+/g, ' ').trim()] : null,
      saved: localStorage.getItem(key),
      shown: { theme: [document.documentElement.dataset.theme, one('#sands [aria-checked="true"]'), document.getElementById('theme-name') ? document.getElementById('theme-name').textContent : ''],
               finish: one('#finishes [aria-checked="true"]'), look: [Hg.renderer.look.sand, Hg.renderer.look.material],
               frame: document.getElementById('opt-frame').checked, layers: document.getElementById('opt-layers').checked,
               volume: [document.getElementById('volume').value, document.getElementById('volume-out').textContent],
               character: one('#characters [aria-checked="true"]'), ambience: one('#ambiences [aria-checked="true"]'), ambRow: !document.getElementById('amb-row').hidden,
               ambLevel: [document.getElementById('amb-level').value, document.getElementById('amb-out').textContent], chime: document.getElementById('opt-chime').checked },
      engines: { frame: Hg.renderer.frame, layers: [Hg.sim.layers, Hg.renderer.layers], volume: a.volume, muted: a.muted, character: a.character, ambience: a.ambience,
                 ambLevel: a.ambLevel, chime: a.chimeEnabled },
      toast: q.classList.contains('show') ? q.textContent : '',
      // (the polite status only a screen reader hears: its words, its role, where it is and how big it is drawn)
      say: say ? { text: say.textContent, role: say.getAttribute('role'), live: say.getAttribute('aria-live'), inSheet: !!say.closest('#sheet-settings'),
                   inPanel: !!say.closest('[role="tabpanel"]'), drawn: [sb.width, sb.height] } : null,
      alive: window.__alive === 1, state: Hg.timer.state, rem: Hg.timer.rem, events: window.__trace.take()
    };
  }, KEY);
}
async function reset(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({ init: trace.recorder, storage: { 'hourglass.settings.v1': o.save || CHANGED } }, o.open || {})), m = {};
  var link = '#tune-reset';
  try {
    await sleep(900);
    await t.eval(function () { window.__alive = 1; });
    await tune.show(t, link);
    m.place = await t.eval(function () {
      var el = document.getElementById('tune-reset'), p = el && el.closest('[role="tabpanel"]');
      return el ? { tag: el.tagName, type: el.getAttribute('type'), row: el.classList.contains('row') || !!el.closest('.row'), panel: p ? p.id : null, last: !!p && p.lastElementChild === el,
                    rows: document.querySelectorAll('#sheet-settings .row').length } : null;
    });
    await t.eval(function () { window.__trace.take(); });
    m.idle = await resetState(t);
    // the first tap only asks; three seconds later it has given up
    await t.page.tap(link);
    var t0 = Date.now();
    await sleep(700);
    m.asked = await resetState(t);
    await t.page.waitForFunction(function () { return document.getElementById('tune-reset').getAttribute('data-state') !== 'armed'; }, null, { timeout: 6000 }).catch(function () {});
    m.waited = Date.now() - t0;
    m.gaveUp = await resetState(t);
    // asked again, and another tab shown; asked again, and Tune closed
    await t.page.tap(link);
    await sleep(150);
    await tapTab(t, 'sound');
    await tapTab(t, 'time');
    m.otherTab = await resetState(t);
    await tune.show(t, link);
    await t.page.tap(link);
    await sleep(150);
    await tune.close(t);
    await tune.show(t, link);
    m.closed = await resetState(t);
    // a double tap is one tap (two clicks in one moment), and still only asks
    await t.eval(function () { var el = document.getElementById('tune-reset'); el.click(); el.click(); });
    await sleep(500);
    m.double = await resetState(t);
    // the second tap
    await t.page.tap(link);
    await sleep(120);
    m.done = await resetState(t);
    await sleep(400);                                  // (the toast comes in over 0.3 s)
    m.doneToast = await toastBox(t);
    await sleep(500);                                  // the cross-fade
    m.later = await resetState(t);
    // and once more, with nothing left to put back
    await sleep(1800);                                 // (the toast has gone)
    await t.page.tap(link);
    await sleep(600);
    await t.eval(function () { window.__trace.take(); });
    await t.page.tap(link);
    await sleep(700);
    m.again = await resetState(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function names(ev) { return ev.map(function (e) { return e[0]; }); }
/** A trace as text, each save's keys in one order (what is saved is compared, not the order the recorder lists it in). */
function evText(ev) {
  return JSON.stringify(ev.map(function (e) {
    return e.map(function (a) {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return a;
      var o = {}; Object.keys(a).sort().forEach(function (k) { o[k] = a[k]; }); return o;
    });
  }));
}
/** The keys of two saves (as text) that differ, apart from those in `but`. */
function differing(a, b, but) {
  var x = JSON.parse(a), y = JSON.parse(b), out = [];
  Object.keys(x).concat(Object.keys(y)).forEach(function (k) {
    if (out.indexOf(k) < 0 && !(but && k in but) && JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(k);
  });
  return out;
}
function resetOk(m, save) {
  save = save || CHANGED;
  var before = m.idle.saved, was = JSON.parse(before), now = JSON.parse(m.done.saved);
  // (what differed: as the app had it before the tap, a sand and a finish made from the saved material included)
  var keys = Object.keys(BACK), differ = keys.filter(function (k) { return was[k] !== BACK[k]; });
  var untouched = function (st) { return st.saved === before && st.alive; };
  var quiet = function (st) { return names(st.events).filter(function (n) { return n !== 'buzz'; }).length === 0; };
  // 1. the first tap
  var ask = {
    ok: !!m.place && m.place.tag === 'BUTTON' && m.place.type === 'button' && !m.place.row && m.place.panel === 'panel-time' && m.place.last && m.place.rows === 11 &&
        m.idle.link.join('|') === 'idle|' + ASK && m.asked.link.join('|') === 'armed|' + SURE && untouched(m.asked) && JSON.stringify(m.asked.events) === '[["buzz",8]]' &&
        m.gaveUp.link.join('|') === 'idle|' + ASK && untouched(m.gaveUp) && m.gaveUp.events.length === 0 && m.waited >= 2900 && m.waited < 5500,
    detail: JSON.stringify(m.place) + '; ' + m.idle.link.join(': ') + ' → ' + m.asked.link.join(': ') + ' ' + JSON.stringify(m.asked.events) + (untouched(m.asked) ? '' : ' AND THE SAVE CHANGED') +
            ' → after ' + (m.waited / 1000).toFixed(1) + ' s ' + m.gaveUp.link.join(': ') + (untouched(m.gaveUp) ? '' : ' AND THE SAVE CHANGED')
  };
  // (showing another tab saves that tab: tuneTab is not the reset's)
  var gives = {
    ok: m.otherTab.link.join('|') === 'idle|' + ASK && differing(m.otherTab.saved, before).length === 0 && m.closed.link.join('|') === 'idle|' + ASK && untouched(m.closed) &&
        m.double.link.join('|') === 'armed|' + SURE && untouched(m.double) && quiet(m.double),
    detail: 'another tab shown: ' + m.otherTab.link[0] + '; Tune closed: ' + m.closed.link[0] + '; a double tap: ' + m.double.link[0] + ' ' + JSON.stringify(m.double.events) +
            (untouched(m.double) ? '' : ' AND THE SAVE CHANGED')
  };
  // 2. what is put back, and what is kept
  var notBack = keys.filter(function (k) { return now[k] !== BACK[k]; }), lost = differing(before, m.done.saved, BACK);
  var defaults = keys.filter(function (k) { return m.defaults && m.defaults[k] !== BACK[k]; });
  var back = {
    ok: notBack.length === 0 && defaults.length === 0 && differ.every(function (k) { return !(k in save) || was[k] === save[k]; }) && Object.keys(was).join() === Object.keys(now).join(),
    detail: notBack.length ? 'not put back: ' + notBack.map(function (k) { return k + ' ' + JSON.stringify(now[k]); }).join(', ')
                           : differ.length + ' of the ten differed (' + differ.join(', ') + '), all ten are a new install\'s'
  };
  var kept = {
    ok: lost.length === 0 && Object.keys(was).length >= 32 && m.done.alive && m.later.alive && m.done.state === m.idle.state && m.done.rem === m.idle.rem && m.later.saved === m.done.saved,
    detail: lost.length ? 'changed besides the ten: ' + lost.map(function (k) { return k + ' ' + JSON.stringify(was[k]) + ' → ' + JSON.stringify(now[k]); }).join(', ')
                        : (Object.keys(was).length - keys.length) + ' other keys as they were (muted ' + now.muted + ', grain ' + now.grain + ', breath ' + now.breath + ' ' + now.breathPattern +
                          ', zenFull ' + now.zenFull + ', keepAwake ' + now.keepAwake + ', tuneTab ' + now.tuneTab + '); the page not loaded again: ' + (m.done.alive && m.later.alive) +
                          '; the glass ' + m.done.state
  };
  // 3. what the engines are told, in order: only what differed
  var told = { volume: ['audio.setVolume', BACK.volume], character: ['audio.setCharacter', BACK.character], ambience: ['audio.setAmbience', BACK.ambience, false],
               ambienceLevel: ['audio.setAmbienceLevel', BACK.ambienceLevel, false], chime: ['audio.setChimeEnabled', BACK.chime] };
  // (the sand, its finish and the material are one look: one call, Sahara Quartz over walnut, the renderer's own bundle)
  var faded = { look: [['renderer.setTheme', BACK.theme]], frame: [['renderer.setFrame', BACK.frame]], layers: [['sim.setLayers', BACK.layers], ['renderer.setLayers', BACK.layers]] };
  var change = {}, wantNow, wantLater = [];
  differ.forEach(function (k) { change[k] = BACK[k]; });
  wantNow = [['save', change]].concat(Object.keys(told).filter(function (k) { return differ.indexOf(k) >= 0; }).map(function (k) { return told[k]; }));
  if (!('haptics' in save) || save.haptics) wantNow.push(['buzz', 12]);
  Object.keys(faded).forEach(function (k) {
    if (k === 'look' ? differ.some(function (d) { return d === 'theme' || d === 'sand' || d === 'finish'; }) : differ.indexOf(k) >= 0) wantLater = wantLater.concat(faded[k]);
  });
  var engines = {
    ok: evText(m.done.events) === evText(wantNow) && JSON.stringify(m.later.events) === JSON.stringify(wantLater),
    detail: 'in the tap ' + JSON.stringify(m.done.events) + (evText(m.done.events) === evText(wantNow) ? '' : ' FOR ' + JSON.stringify(wantNow)) +
            '; behind the cross-fade ' + JSON.stringify(m.later.events) + (JSON.stringify(m.later.events) === JSON.stringify(wantLater) ? '' : ' FOR ' + JSON.stringify(wantLater))
  };
  // 4. what the page shows, and what it says
  var sh = m.later.shown, en = m.later.engines;
  var shown = {
    ok: sh.theme[0] === BACK.sand && sh.theme[1] === BACK.sand && sh.theme[2] === 'Sahara Quartz' && sh.finish === BACK.finish && sh.look.join() === 'sahara,sahara' &&
        now.sandColor === (save.sandColor || '') && sh.frame === BACK.frame && sh.layers === BACK.layers && sh.volume.join() === '80,80' && sh.character === BACK.character &&
        sh.ambience === BACK.ambience && sh.ambRow === false && sh.ambLevel[0] === '50' && sh.chime === BACK.chime &&
        en.frame === BACK.frame && en.layers.join() === 'false,false' && en.volume === BACK.volume && en.character === BACK.character && en.ambience === BACK.ambience &&
        en.ambLevel === BACK.ambienceLevel && en.chime === BACK.chime && en.muted === !!save.muted,
    detail: JSON.stringify(sh) + ' ' + JSON.stringify(en)
  };
  var says = {
    ok: m.done.link.join('|') === 'idle|' + ASK && m.done.toast === DONE && above(m.doneToast),
    detail: 'the link ' + m.done.link.join(': ') + '; ' + toastSays(m.doneToast)
  };
  // 5. with nothing left to put back: saved once, no engine told
  var wantAgain = [['save', {}]].concat(!('haptics' in save) || save.haptics ? [['buzz', 12]] : []);
  var again = {
    ok: JSON.stringify(m.again.events) === JSON.stringify(wantAgain) && m.again.saved === m.done.saved && m.again.link[0] === 'idle' && m.again.toast === DONE && m.errors.length === 0,
    detail: JSON.stringify(m.again.events) + ' ' + m.errors.slice(0, 2).join(' | ')
  };
  // 6. the first tap's question is said to a screen reader too: a polite status in the sheet, drawn
  // nowhere, holds it while the link is armed, and is empty once it has given up or answered
  var sayText = function (st) { return st.say ? st.say.text : null; };
  var sv = m.asked.say;
  var speaks = {
    ok: !!sv && sv.role === 'status' && sv.live === 'polite' && sv.inSheet && !sv.inPanel && sv.drawn[0] <= 1 && sv.drawn[1] <= 1 &&
        sayText(m.idle) === '' && sayText(m.asked) === SURE && m.asked.toast === '' && sayText(m.gaveUp) === '' && sayText(m.otherTab) === '' &&
        sayText(m.closed) === '' && sayText(m.double) === SURE && sayText(m.done) === '' && sayText(m.again) === '',
    detail: (sv ? JSON.stringify({ role: sv.role, live: sv.live, inSheet: sv.inSheet, inPanel: sv.inPanel, drawn: sv.drawn }) : 'no status') +
            '; said: idle ' + JSON.stringify(sayText(m.idle)) + ', first tap ' + JSON.stringify(sayText(m.asked)) + ' (toast ' + JSON.stringify(m.asked.toast) + '), after 3 s ' +
            JSON.stringify(sayText(m.gaveUp)) + ', another tab ' + JSON.stringify(sayText(m.otherTab)) + ', Tune closed ' + JSON.stringify(sayText(m.closed)) +
            ', a double tap ' + JSON.stringify(sayText(m.double)) + ', answered ' + JSON.stringify(sayText(m.done)) + ', again ' + JSON.stringify(sayText(m.again))
  };
  return { ask: ask, gives: gives, back: back, kept: kept, engines: engines, shown: shown, says: says, again: again, speaks: speaks };
}

/* ---- HINT -------------------------------------------------------------------------------- */
// At 393 x 852, at 122a7fd (the Tune before its edges; measured with the same page, deviceScaleFactor
// 2 and 3 alike): the sheet, the tab row, the scroller and each tab's first row (its first card,
// row or slider row), [left, top, right, bottom] in CSS px. The edges are laid over the rows and
// must move none of them.
var HINT_SIZE = [393, 852];
var BEFORE = {
  sheet: [0, 459, 393, 852], tabs: [16, 479, 329, 521], body: [16, 527, 377, 836],
  // (Sand's first control is its first sand since 1.14.0, measured at 393 x 852 with the edges taken out of the page;
  // it stands where the first material card stood, its top at 555)
  row: { sand: [16, 555, 85, 644.05], glass: [16, 555, 377, 801], sound: [20, 541, 373, 571], time: [16, 558, 377, 616] }
};
// (1.15.0: the Glass tab's first row is its shape picker, .shape-pick, in the place where the
// frame's row stood at 122a7fd: [16, 555, 377, 609.25] then; it is taller, and the frame's row is
// now under it)
/** The edges as they are now: shown or not (their opacity, once a transition is done), where, and what they are. */
function edges(t) {
  return t.eval(function () {
    var s = document.getElementById('sheet-settings'), b = s.querySelector('.sheet-body'), p = s.querySelector('[role="tabpanel"]:not([hidden])');
    var top = s.querySelector('.edge-top'), more = s.querySelector('.edge-more'), mark = more ? more.querySelector('svg path, svg polyline') : null;
    function R(el) { var r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(function (v) { return Math.round(v * 100) / 100; }); }
    function look(el) {
      if (!el) return null;
      var cs = getComputedStyle(el);
      return { box: R(el), opacity: +cs.opacity, events: cs.pointerEvents, hidden: el.getAttribute('aria-hidden'), fade: cs.transitionDuration, kids: el.querySelectorAll('*').length };
    }
    var row = p ? p.querySelector('#sands button, .row, .slider-row, .shape-pick') : null;
    return {
      tab: p ? p.getAttribute('data-tab') : null, scrolled: b.scrollTop, left: b.scrollHeight - b.clientHeight - b.scrollTop, length: b.scrollHeight, view: b.clientHeight,
      sheet: R(s), tabs: R(document.getElementById('tune-tabs')), body: R(b), row: row ? R(row) : null,
      top: look(top), more: look(more), mark: mark ? R(mark) : null, markEvents: mark ? getComputedStyle(mark.ownerSVGElement).pointerEvents : null,
      grain: (function () { var g = document.getElementById('grain-row'); return !!g && !g.hidden && g.getClientRects().length > 0; })(),
      report: (function () { var a = document.getElementById('realsand-report'); return !!a && !a.hidden; })()
    };
  });
}
function scrollBody(t, where) {
  return t.eval(function (w) {
    var b = document.querySelector('#sheet-settings .sheet-body');
    b.scrollTop = w === 'end' ? b.scrollHeight : w === 'middle' ? Math.round((b.scrollHeight - b.clientHeight) / 2) : typeof w === 'number' ? w : 0;
    return b.scrollTop;
  }, where);
}
/** Each tab at its top, then each tab that scrolls in its middle and at its end; then a finger on the hint's place. */
async function hint(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({ viewport: { width: HINT_SIZE[0], height: HINT_SIZE[1] } }, o.open || {})), m = { at: {}, middle: {}, end: {} };
  try {
    await sleep(700);
    await tune.open(t);
    for (var k = 0; k < TABS.length; k++) {
      await tapTab(t, TABS[k]);
      if (o.reduced) { m.at[TABS[k]] = await edges(t); continue; }      // (read at once: nothing may fade)
      await sleep(400);
      m.at[TABS[k]] = await edges(t);
    }
    if (o.reduced) {
      // scrolled and back: each edge is there, or not, in the very frame after
      await tapTab(t, 'sand');
      await scrollBody(t, 'middle'); await t.eval(function () { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); });
      m.middle.sand = await edges(t);
    } else {
      for (k = 0; k < TABS.length; k++) {
        if (m.at[TABS[k]].left <= 2) continue;
        await tapTab(t, TABS[k]);
        await scrollBody(t, 'middle'); await sleep(400);
        m.middle[TABS[k]] = await edges(t);
        await scrollBody(t, 'end'); await sleep(400);
        m.end[TABS[k]] = await edges(t);
      }
      // a finger where the hint is, on the Sand tab at its top: the row or sand under it answers. (The
      // lowest point of the hint over a control that does not load the page again: Real sand's row,
      // which does, may lie under the hint's lowest pixels.)
      await tapTab(t, 'sand'); await sleep(400);
      var e = await edges(t), pt = { x: (e.body[0] + e.body[2]) / 2, y: e.body[3] - 10 };
      var STATE = function (q) {
        var p = document.querySelector('#sheet-settings [role="tabpanel"]:not([hidden])'), hosts = p.querySelectorAll('#sands button, label.row'), host = null, i, r;
        for (i = 0; i < hosts.length; i++) { r = hosts[i].getBoundingClientRect(); if (q.x >= r.left && q.x <= r.right && q.y >= r.top && q.y <= r.bottom) host = hosts[i]; }
        var hit = document.elementFromPoint(q.x, q.y);
        var name = !host ? null : host.dataset.sand ? 'the ' + host.dataset.sand + ' sand' : 'the row of #' + host.htmlFor;
        var on = !host ? null : host.dataset.sand ? host.getAttribute('aria-checked') : String(document.getElementById(host.htmlFor).checked);
        return { host: name, on: on, hit: hit ? (hit.closest('.edge') ? 'the hint' : hit.closest('#sands button, label.row') ? 'a row' : hit.tagName) : null };
      };
      for (var y = e.body[3] - 10; e.more && y > e.more.box[1] + 4; y -= 4) {
        var under = await t.eval(STATE, { x: pt.x, y: y });
        if (under.host && under.host !== 'the row of #opt-realsand') { pt.y = y; break; }
      }
      m.tap = { at: pt, more: e.more ? e.more.opacity : null, before: await t.eval(STATE, pt) };
      await t.touch.tap(pt.x, pt.y, 60);
      await sleep(500);
      m.tap.after = await t.eval(STATE, pt);
    }
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
/**
 * Rows that appear and go on the Sand tab, by the app's own paths: Real sand on, its engine held
 * back (the row "starting": Grain hidden, "Copy a report" made and shown); then the engine failing
 * to load while the tab is scrolled to its end (Grain appears under a scroll that does not move);
 * then the switch turned off and on again (the page built afresh each time). The engine is held
 * back before it is asked for: the app's script element for realsand/boot.mjs is kept out of the
 * page until release() puts it in, and the network then refuses the file. (A request held open
 * at the network would hold the page's load event too, and the page would never be opened.)
 */
async function hintRows(env, o) {
  o = o || {};
  var m = {};
  var refuse = { url: '**/realsand/boot.mjs', handler: function (route) { route.abort('failed').catch(function () {}); } };
  var holdBoot = function () {
    var put = Node.prototype.appendChild;
    window.__bootHeld = [];
    Node.prototype.appendChild = function (el) {
      if (el && el.tagName === 'SCRIPT' && /realsand\/boot\.mjs$/.test(el.src || '') && !window.__bootGo) { window.__bootHeld.push([this, el]); return el; }
      return put.call(this, el);
    };
    window.__bootRelease = function () {
      window.__bootGo = true;
      var h = window.__bootHeld; window.__bootHeld = [];
      h.forEach(function (x) { put.call(x[0], x[1]); });
      return h.length;
    };
  };
  function release() { return t.eval(function () { return window.__bootRelease ? window.__bootRelease() : -1; }); }
  var t = await env.open({ viewport: { width: HINT_SIZE[0], height: HINT_SIZE[1] }, storage: { 'hourglass.settings.v1': { realSand: true } },
                           init: holdBoot, routes: [refuse].concat(o.routes || []) });
  async function sandTab(name) {
    await tune.open(t); await tapTab(t, 'sand'); await sleep(400);
    m[name] = await edges(t);
    await scrollBody(t, 'end'); await sleep(400);
    m[name + 'End'] = await edges(t);
  }
  async function flip() {
    var loaded = t.page.waitForEvent('load', { timeout: 15000 });
    await tune.tap(t, '#opt-realsand');
    await loaded;
    await t.page.waitForFunction(function () { return window.Hourglass && window.__mon && window.__mon.hooked; }, null, { timeout: 15000 });
    await sleep(700);
  }
  try {
    await sleep(700);
    await sandTab('held');
    m.released = await release(); await sleep(900);
    m.failed = await edges(t);
    await scrollBody(t, 'end'); await sleep(400);
    m.failedEnd = await edges(t);
    await flip();                                      // off: the classic sand, Grain shown
    await sandTab('off');
    await flip();                                      // on again: held back again, Grain hidden
    await sandTab('on');
  } finally { await t.close(); }
  return m;
}
function op(e, which) { return e && e[which] ? e[which].opacity : -1; }
function showsHint(e) { return op(e, 'more') >= 0.99 && e.left > 2; }
function noHint(e) { return op(e, 'more') <= 0.01; }
function edgeSays(e) { return e ? e.tab + ' ' + Math.round(e.scrolled) + '/' + (e.length - e.view) + ' px: hint ' + op(e, 'more') + ', top edge ' + op(e, 'top') : 'not read'; }
function hintOk(m) {
  var at = m.at, scrolls = TABS.filter(function (k) { return at[k] && at[k].left > 2; });
  var e0 = at.sand || {}, more = e0.more || {}, top = e0.top || {};
  var placeBad = TABS.filter(function (k) {
    var e = at[k];
    return !e || !same(e.sheet, BEFORE.sheet, 0.5) || !same(e.tabs, BEFORE.tabs, 0.5) || !same(e.body, BEFORE.body, 0.5) || !e.row || !same(e.row, BEFORE.row[k], 0.5);
  });
  var tap = m.tap || {}, b = tap.before || {}, a = tap.after || {};
  return {
    tabs: { ok: scrolls.join() === 'sand,glass,sound,time' && scrolls.every(function (k) { return showsHint(at[k]) && op(at[k], 'top') <= 0.01; }),
            detail: TABS.map(function (k) { return edgeSays(at[k]); }).join('; ') },
    middle: { ok: Object.keys(m.middle).join() === 'sand,glass,sound,time' && Object.keys(m.middle).every(function (k) { var e = m.middle[k]; return showsHint(e) && op(e, 'top') >= 0.99 && e.scrolled > 2; }),
              detail: Object.keys(m.middle).map(function (k) { return edgeSays(m.middle[k]); }).join('; ') || 'no tab scrolled' },
    end: { ok: Object.keys(m.end).join() === 'sand,glass,sound,time' && Object.keys(m.end).every(function (k) { var e = m.end[k]; return noHint(e) && e.left <= 2 && op(e, 'top') >= 0.99; }),
           detail: Object.keys(m.end).map(function (k) { return edgeSays(m.end[k]); }).join('; ') || 'no tab scrolled' },
    what: { ok: more.hidden === 'true' && top.hidden === 'true' && more.events === 'none' && top.events === 'none' && e0.markEvents === 'none' && top.kids === 0 &&
                !!e0.mark && near(more.box[3], e0.body[3], 0.5) && near(top.box[1], e0.body[1], 0.5) && more.box[3] - more.box[1] >= 24 && top.box[3] - top.box[1] <= 24 &&
                e0.mark[1] >= e0.body[3] - 1 && e0.mark[3] <= e0.sheet[3] && e0.mark[2] - e0.mark[0] <= 16,
            detail: 'the hint ' + JSON.stringify(more) + ', its chevron ' + JSON.stringify(e0.mark) + ' (pointer-events ' + e0.markEvents + ') under the rows\' lower edge at ' + e0.body[3] +
                    '; the top edge ' + JSON.stringify(top) },
    tap: { ok: tap.more >= 0.99 && !!b.host && a.host === b.host && a.on !== b.on && b.hit !== 'the hint',
           detail: 'a finger at ' + JSON.stringify(tap.at) + ' on the hint (shown: ' + tap.more + '): under it ' + b.host + ' (hit test: ' + b.hit + '), ' + b.on + ' → ' + a.on },
    place: { ok: placeBad.length === 0,
             detail: placeBad.length ? 'MOVED on ' + placeBad.map(function (k) { var e = at[k] || {}; return k + ': sheet ' + JSON.stringify(e.sheet) + ', tabs ' + JSON.stringify(e.tabs) + ', rows in ' + JSON.stringify(e.body) + ', first row ' + JSON.stringify(e.row); }).join('; ')
                                     : 'on all four tabs as at 122a7fd: the sheet ' + JSON.stringify(BEFORE.sheet) + ', the tab row ' + JSON.stringify(BEFORE.tabs) + ', the rows in ' + JSON.stringify(BEFORE.body) +
                                       ', the first rows at ' + TABS.map(function (k) { return k + ' ' + at[k].row[1]; }).join(', ') },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}
function hintRowsOk(m) {
  var steps = ['held', 'heldEnd', 'failed', 'failedEnd', 'off', 'offEnd', 'on', 'onEnd'];
  var want = {
    held: function (e) { return !e.grain && e.report && showsHint(e); }, heldEnd: function (e) { return !e.grain && noHint(e) && e.left <= 2; },
    failed: function (e) { return m.released === 1 && e.grain && showsHint(e) && near(e.scrolled, m.heldEnd.scrolled, 1); }, failedEnd: function (e) { return e.grain && noHint(e) && e.left <= 2; },
    off: function (e) { return e.grain && showsHint(e); }, offEnd: function (e) { return e.grain && noHint(e); },
    on: function (e) { return !e.grain && showsHint(e); }, onEnd: function (e) { return !e.grain && noHint(e); }
  };
  var bad = steps.filter(function (k) { return !m[k] || !want[k](m[k]); });
  return { ok: bad.length === 0,
           detail: (bad.length ? 'WRONG at ' + bad.join(', ') + ': ' : '') + steps.map(function (k) { var e = m[k]; return k + ' (Grain ' + (e && e.grain ? 'shown' : 'hidden') + ') ' + edgeSays(e); }).join('; ') + '; engine let go ' + m.released + ' time(s)' };
}
function hintReducedOk(m) {
  var s = m.at.sand || {}, g = m.at.glass || {}, mid = m.middle.sand || {};
  return { ok: s.more && s.more.fade === '0s' && s.top.fade === '0s' && showsHint(s) && showsHint(g) && op(g, 'top') <= 0.01 && op(mid, 'top') >= 0.99 && showsHint(mid),
           detail: 'fades ' + (s.more ? s.more.fade + ' and ' + s.top.fade : 'not read') + '; read at once: ' + [s, g, mid].map(edgeSays).join('; ') };
}

/* ---- the run ----------------------------------------------------------------------------- */
function failing(v) { return Object.keys(v).filter(function (k) { return !v[k].ok; }); }
(async function () {
  var env = await H.start(), s = new H.Suite('app-tune'), only = env.args.only;
  function wanted(name) { return !only || only.toLowerCase() === name.toLowerCase(); }
  /** A control: the same measurements on a broken copy must fail `part` of the check (and say how). */
  async function control(label, part, measure, verdict) {
    var v, why;
    try { v = verdict(await measure()); } catch (e) { why = 'the copy could not be measured: ' + String(e && e.message || e).split('\n')[0]; }
    var bad = v ? (v.ok === undefined ? failing(v) : (v.ok ? [] : ['it'])) : [];
    var hit = v ? (part ? bad.indexOf(part) >= 0 : bad.length > 0) : false;
    s.check('CONTROL ' + label, hit, why || (hit ? 'fails: ' + (part ? v[part].detail : (v.detail || bad.join(', '))) : 'PASSES; failing only ' + (bad.join(', ') || 'nothing')));
  }
  try {
    if (wanted('panels')) {
      var p = panelsOk(await panels(env));
      s.check('PANELS: at the boot, and with Tune opened, one panel is shown (Sand) and its tab is the one selected', p.boot.ok, p.boot.detail);
      s.check('PANELS: a tap on a tab shows its panel and no other, and selects it alone', p.taps.ok, p.taps.detail);
      s.check('PANELS: everything that can be set or pressed in Tune is in one of the four panels', p.loose.ok, p.loose.detail);
      s.check('PANELS: no page or console errors', p.errors.ok, p.errors.detail);
      await control('PANELS: a style sheet that draws a hidden panel shows more than one', 'taps', function () {
        return panels(env, { routes: [broken(env, 'styles.css', add('#sheet-settings [role="tabpanel"][hidden] { display: block !important; }'))] });
      }, panelsOk);
      await control('PANELS: a page with a switch outside the panels is found out', 'loose', function () {
        return panels(env, { routes: [broken(env, 'index.html', swap(/<div id="panel-sand"/, '<label class="row" for="opt-loose"><span><b>Loose</b></span><input id="opt-loose" class="switch" type="checkbox" role="switch"></label><div id="panel-sand"'))] });
      }, panelsOk);
    }

    if (wanted('remember')) {
      var r = rememberOk(await remember(env));
      s.check('REMEMBER: the tab shown is saved (tuneTab), and after a close Tune opens on it, from its top', r.close.ok, r.close.detail);
      s.check('REMEMBER: a tab shown again, from another tab or by a tap on itself, starts at its top', r.top.ok, r.top.detail);
      s.check('REMEMBER: loaded again, the page comes up on that tab and Tune opens on it', r.reload.ok, r.reload.detail);
      s.check('REMEMBER: no page or console errors', r.errors.ok, r.errors.detail);
      var rb = await rememberBad(env);
      s.check('REMEMBER: a saved tab that is none ("lagoon", 3, "") comes up as Sand', rb.every(function (x) { return x.ok; }), rb.map(function (x) { return x.detail; }).join('; '));
      await control('REMEMBER: a copy that shows the first tab at every opening has forgotten it after a close', 'close', function () {
        return remember(env, { routes: [broken(env, 'app.js', after(function () {
          document.getElementById('btn-settings').addEventListener('click', function () { var b = document.querySelector('#sheet-settings [role="tab"]'); if (b) b.click(); });
        }))] });
      }, rememberOk);
      await control('REMEMBER: a copy whose settings have no record for the tab has forgotten it after a reload', 'reload', function () {
        return remember(env, { routes: [broken(env, 'app/settings.js', after(function () {
          var R = window.HourglassSettings.RECORDS;
          for (var i = R.length - 1; i >= 0; i--) if (R[i].id === 'tuneTab') R.splice(i, 1);
        }))] });
      }, rememberOk);
      await control('REMEMBER: a copy whose sheet keeps its scroll from one opening to the next does not open from the top', 'close', function () {
        return remember(env, { routes: [broken(env, 'app.js', after(function () {
          var b = document.querySelector('#sheet-settings .sheet-body'), at = 0;
          b.addEventListener('scroll', function () { if (b.scrollTop > 0) at = b.scrollTop; });
          document.getElementById('btn-settings').addEventListener('click', function () { b.scrollTop = at; });
        }))] });
      }, rememberOk);
    }

    if (wanted('place') || wanted('top')) {
      for (var i = 0; i < SIZES.length; i++) {
        var z = sizedOk(await sized(env, SIZES[i], i === 0 ? { extra: [375, 667] } : {}));
        s.check('PLACE: the tab row, the close button and the sheet stand at the same place on all four tabs', z.place.ok, z.place.detail);
        s.check('PLACE: a tab that scrolls, under a finger and to its end, leaves the tab row, the sheet and the page where they were', z.scroll.ok, z.scroll.detail);
        s.check('TOP: the sheet\'s top edge is 44 px under the glass\'s neck, and its lower edge is the screen\'s', z.top.ok, z.top.detail);
        if (z.frame) {
          s.check('TOP: the frame switched off (the bare glass sits larger): the sheet\'s top follows the neck', z.frame.ok, z.frame.detail);
          s.check('TOP: the window made another size: the sheet\'s top follows the neck', z.resize.ok, z.resize.detail);
        }
        s.check('PLACE, TOP at ' + SIZES[i].join(' x ') + ': no page or console errors', z.errors.ok, z.errors.detail);
      }
      await control('PLACE: a style sheet whose sheet is as tall as its tab moves the tab row from tab to tab', 'place', function () {
        return sized(env, SIZES[0], { open: { routes: [broken(env, 'styles.css', add('.sheet.tune { top: auto !important; }'))] } });
      }, sizedOk);
      await control('PLACE: a style sheet whose whole sheet scrolls, not its body, takes the tab row along', 'scroll', function () {
        return sized(env, SIZES[0], { open: { routes: [broken(env, 'styles.css', add('#sheet-settings.sheet { display: block !important; overflow-y: auto !important; }\n#sheet-settings .sheet-body { overflow: visible !important; }'))] } });
      }, sizedOk);
      await control('TOP: a style sheet that puts the sheet at half the screen, whatever the glass, is not under the neck', 'top', function () {
        return sized(env, SIZES[1], { open: { routes: [broken(env, 'styles.css', add('#sheet-settings { --tune-top: 50% !important; }'))] } });
      }, sizedOk);
      await control('TOP: a copy that places the sheet once, at the boot, does not follow the glass when the frame goes', 'frame', function () {
        return sized(env, SIZES[0], { extra: [375, 667], open: { routes: [broken(env, 'app.js', after(function () {
          var s = document.getElementById('sheet-settings'), was = s.style.getPropertyValue('--tune-top'), set = s.style.setProperty;
          s.style.setProperty = function (k, v) { return set.call(this, k, k === '--tune-top' ? was : v); };
        }))] } });
      }, sizedOk);
    }

    if (wanted('side')) {
      var sd = sideOk(await odd(env, [844, 390]));
      s.check('SIDE: a phone on its side keeps the old limit: the sheet from 28 px under the top to the bottom, on every tab', sd.ok, sd.detail);
      await control('SIDE: a style sheet without the rule for a phone on its side puts the sheet under the neck there too', null, function () {
        return odd(env, [844, 390], { routes: [broken(env, 'styles.css', add('@media (orientation: landscape) and (max-height: 520px) { .sheet.tune { top: var(--tune-top, 46%) !important; } }'))] });
      }, sideOk);
    }
    if (wanted('floor')) {
      var fl = floorOk(await odd(env, [320, 440]));
      s.check('FLOOR: on a very short screen the sheet is still 220 px tall, on every tab', fl.ok, fl.detail);
      await control('FLOOR: a copy that puts the sheet 44 px under the neck however little is left is shorter', null, function () {
        return odd(env, [320, 440], { routes: [broken(env, 'app.js', after(function () {
          var s = document.getElementById('sheet-settings'), set = s.style.setProperty;
          function neck() { var a = document.getElementById('assembly').getBoundingClientRect(); return Math.round(a.top + a.height / 2 + 44) + 'px'; }
          s.style.setProperty = function (k, v) { return set.call(this, k, k === '--tune-top' ? neck() : v); };
          set.call(s.style, '--tune-top', neck());
        }))] });
      }, floorOk);
    }

    if (wanted('scrim')) {
      var sc = scrimOk(await scrim(env));
      s.check('SCRIM: behind Tune it is light (0.2), behind the custom sheet as it was (0.5)', sc.light.ok, sc.light.detail);
      s.check('SCRIM: a tap on it above the sheet, on the glass, closes Tune and does not start the glass', sc.tap.ok, sc.tap.detail);
      await control('SCRIM: a style sheet whose light scrim is as dark as the other', 'light', function () {
        return scrim(env, { routes: [broken(env, 'styles.css', add('#scrim.light { background: rgba(4, 5, 6, 0.5) !important; }'))] });
      }, scrimOk);
      await control('SCRIM: a copy whose scrim lets the tap through to the glass starts it', 'tap', function () {
        return scrim(env, { routes: [broken(env, 'app.js', after(function () {
          document.getElementById('scrim').addEventListener('click', function () { window.Hourglass.start(); });
        }))] });
      }, scrimOk);
    }

    if (wanted('aria')) {
      var a = ariaOk(await aria(env));
      s.check('ARIA: a dialog named by the hidden title "Tune"; a tablist of four tabs, Sand, Glass, Sound, Time, each a button with its panel (a tabpanel in the sheet\'s body, named by its tab), ' +
              'one selected and alone in the tab order; then the close button; the body the one thing that scrolls; the Tune button says what is in it', a.ok, a.detail);
      await control('ARIA: a page whose Glass tab names a panel that is not there', null, function () {
        return aria(env, { routes: [broken(env, 'index.html', swap(/aria-controls="panel-glass"/, 'aria-controls="panel-glas"'))] });
      }, ariaOk);
      await control('ARIA: a page whose Sound panel is named by no tab', null, function () {
        return aria(env, { routes: [broken(env, 'index.html', swap(/ aria-labelledby="tab-sound"/, ''))] });
      }, ariaOk);
    }

    if (wanted('keys')) {
      var k = keysOk(await keys(env));
      s.check('KEYS: with the focus on a tab, ArrowRight and ArrowLeft go round the row, Home and End to its ends: the tab is shown from its top, saved, and has the focus; no buzz, no engine told',
              k.walk.ok, k.walk.detail);
      s.check('KEYS: Tune opens with the focus on the close button, Shift+Tab leads to the selected tab; a key that leads nowhere new saves nothing; with the focus elsewhere the arrows are not the tabs\'; Escape closes',
              k.rest.ok, k.rest.detail);
      await control('KEYS: a page that swallows the arrow keys, Home and End', 'walk', function () {
        return keys(env, { routes: [broken(env, 'index.html', before(function () {
          window.addEventListener('keydown', function (e) { if (/^(Arrow|Home$|End$)/.test(e.key)) e.stopImmediatePropagation(); }, true);
        }))] });
      }, keysOk);
      await control('KEYS: a copy whose keys buzz as a tap does', 'walk', function () {
        return keys(env, { routes: [broken(env, 'app.js', after(function () {
          document.getElementById('tune-tabs').addEventListener('keydown', function (e) { if (/^(Arrow|Home$|End$)/.test(e.key)) navigator.vibrate(8); });
        }))] });
      }, keysOk);
      await control('KEYS: a copy whose arrows move the tabs from anywhere in the sheet', 'rest', function () {
        return keys(env, { routes: [broken(env, 'app.js', after(function () {
          document.getElementById('sheet-settings').addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowRight' || (e.target.getAttribute && e.target.getAttribute('role') === 'tab')) return;
            var tabs = document.querySelectorAll('#sheet-settings [role="tab"]'), i = 0;
            while (i < tabs.length && tabs[i].getAttribute('aria-selected') !== 'true') i++;
            tabs[(i + 1) % tabs.length].click();
          });
        }))] });
      }, keysOk);
    }

    if (wanted('focus')) {
      var fo = focusOk(await focus(env));
      s.check('FOCUS: in Tune (on the Sand and the Time tab), Tab twenty times and Shift+Tab twenty times from the close button never leave the sheet, and go round from its last control to its first and back', fo.tune.ok, fo.tune.detail);
      s.check('FOCUS: the same in the custom-duration sheet, and Escape still closes it', fo.custom.ok, fo.custom.detail);
      var noRound = function () { return focus(env, { routes: [broken(env, 'app.js', swap(/if \(e\.key === 'Tab'\) \{ if \(sheetOpen\) keepTabIn\(sheetOpen, e\); return; \}/, ''))] }); };
      await control('FOCUS: a copy whose sheets let Tab go on to the page behind the scrim (Tune)', 'tune', noRound, focusOk);
      await control('FOCUS: a copy whose sheets let Tab go on to the page behind the scrim (the custom-duration sheet)', 'custom', noRound, focusOk);
    }

    if (wanted('haptic')) {
      var h = hapticOk(await haptic(env));
      s.check('HAPTIC: at the boot, before Tune is ever opened, every button and switch row of all four panels, the four tabs and the reset link carry one haptic label each, and there are no others',
              h.boot.ok, h.boot.detail);
      s.check('HAPTIC: a tap on a tab ticks (also on the tab already shown), and so do both taps on the reset link', h.taps.ok, h.taps.detail);
      await control('HAPTIC: a copy that makes a button of a panel after the labels are laid leaves it without one', 'boot', function () {
        return haptic(env, { routes: [broken(env, 'app.js', after(function () {
          var p = document.getElementById('panel-glass'), b = document.createElement('button');
          b.type = 'button'; b.id = 'made-late'; b.textContent = 'Made late';
          if (p) p.appendChild(b);
        }))] });
      }, hapticOk);
      await control('HAPTIC: a copy whose tabs ask for no tick', 'taps', function () {
        return haptic(env, { routes: [broken(env, 'index.html', before(function () {
          // (the tab row's own listener is not reached: the tab is shown here, silently)
          document.addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('#tune-tabs [role="tab"]') : null;
            if (!b || e.target.closest('.haptic')) return;
            e.stopImmediatePropagation();
            var tabs = document.querySelectorAll('#tune-tabs [role="tab"]');
            for (var i = 0; i < tabs.length; i++) {
              var on = tabs[i] === b;
              tabs[i].setAttribute('aria-selected', on ? 'true' : 'false'); tabs[i].tabIndex = on ? 0 : -1;
              document.getElementById(tabs[i].getAttribute('aria-controls')).hidden = !on;
            }
          }, true);
        }))] });
      }, hapticOk);
    }

    if (wanted('toast')) {
      var q = toastOk(await toast(env));
      s.check('TOAST: said while Tune is open, it sits just above the sheet (its lower edge 4 px over the sheet\'s top), centred, over no tab and no row, and goes when Tune is closed', q.ok, q.detail);
      await control('TOAST: a style sheet that leaves it where it is said with no sheet open puts it on the rows', null, function () {
        return toast(env, { routes: [broken(env, 'styles.css', add('#toast.high { bottom: calc(var(--sab) + 172px) !important; top: auto !important; }'))] });
      }, toastOk);
      await control('TOAST: a copy that keeps it up when Tune is closed', null, function () {
        return toast(env, { routes: [broken(env, 'app.js', after(function () {
          var q = document.getElementById('toast');
          document.querySelector('#sheet-settings .sheet-close').addEventListener('click', function () { q.classList.add('show'); });
        }))] });
      }, toastOk);
    }

    if (wanted('reset')) {
      var m = await reset(env);
      m.defaults = await (async function () {
        var t = await env.open({});
        try { return await t.eval(function () { var o = {}; window.HourglassSettings.RECORDS.forEach(function (r) { o[r.id] = r.default; }); return o; }); } finally { await t.close(); }
      })();
      var v = resetOk(m);
      s.check('RESET: the link is a button at the end of the Time tab, no row; its first tap only asks ("' + SURE + '", one buzz, nothing set or saved) and after 3 s it has given up', v.ask.ok, v.ask.detail);
      s.check('RESET: it gives up at once when another tab is shown and when Tune is closed; a double tap is one tap and still only asks', v.gives.ok, v.gives.detail);
      s.check('RESET: the second tap puts back the ten it names (the sand, the material that follows it, the finish, frame, layered sand, volume, sand sound, ambience and its level, bowl), each to a new install\'s value', v.back.ok, v.back.detail);
      s.check('RESET: ... and keeps every other saved setting byte for byte (the custom sand\'s colour too, for its swatch), loads nothing again and leaves the glass as it is', v.kept.ok, v.kept.detail);
      s.check('RESET: saved once, then the sound engine told its five in order and one buzz, inside the tap; the look (one call for sand and finish), the frame and the layers behind one cross-fade; the bowl is not rung', v.engines.ok, v.engines.detail);
      s.check('RESET: the controls and the engines show it (the mute button left as it was)', v.shown.ok, v.shown.detail);
      s.check('RESET: the link is as it was, and "' + DONE + '" is said just above the sheet', v.says.ok, v.says.detail);
      s.check('RESET: with nothing left to put back it saves once, tells no engine, and says so again', v.again.ok, v.again.detail);
      s.check('RESET: the first tap\'s "' + SURE + '" is said to a screen reader through a polite status in the sheet that is drawn nowhere (no toast), and it is emptied when the link gives up, another tab is shown, Tune is closed or the second tap answers', v.speaks.ok, v.speaks.detail);
      // a save where only the material differs, and Haptics is off: one thing told, no buzz, Haptics still off
      var SOME = { theme: 'volcanic', haptics: false, tuneTab: 'time' }, m2 = await reset(env, { save: SOME }), v2 = resetOk(m2, SOME);
      s.check('RESET: from a save of 1.13.0 where only the material differs (Volcanic Black, so brass caps), with Haptics off: only the sand, its finish and the material are saved and set, no engine of the sound is told, nothing buzzes, Haptics stays off',
              v2.back.ok && v2.kept.ok && v2.engines.ok && v2.shown.ok && JSON.parse(m2.done.saved).haptics === false && JSON.stringify(m2.asked.events) === '[]',
              [v2.back, v2.kept, v2.engines].filter(function (x) { return !x.ok; }).map(function (x) { return x.detail; }).join('; ') || v2.engines.detail);
      // the controls
      var copy = function (fn, file) { return function () { return reset(env, { open: { routes: [broken(env, file || 'app.js', after(fn))] } }); }; };
      await control('RESET: a link that needs no second tap (it answers itself half a second later)', 'ask', copy(function () {
        var el = document.getElementById('tune-reset'), busy = false;
        el.addEventListener('click', function () {
          if (busy || el.getAttribute('data-state') !== 'armed') return;
          busy = true;
          setTimeout(function () { el.click(); busy = false; }, 450);
        });
      }), resetOk);
      await control('RESET: a link that never gives up', 'ask', function () {
        return reset(env, { open: { routes: [broken(env, 'index.html', before(function () {
          var st = window.setTimeout;
          window.setTimeout = function (fn, ms) { return ms === 3000 ? 0 : st.apply(window, arguments); };
        }))] } });
      }, resetOk);
      await control('RESET: a link that takes a double tap for its answer', 'gives', function () {
        return reset(env, { open: { routes: [broken(env, 'index.html', before(function () {
          // (the second click of a pair comes 0.5 s later by this page's clock)
          var now = performance.now.bind(performance), skew = 0;
          performance.now = function () { return now() + skew; };
          document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#tune-reset')) skew += 500; }, true);
        }))] } });
      }, resetOk);
      await control('RESET: a copy that puts Full Zen back too', 'kept', copy(function () {
        var el = document.getElementById('tune-reset'), armed = false;
        document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#tune-reset')) armed = el.getAttribute('data-state') === 'armed'; }, true);
        el.addEventListener('click', function () {
          var z = document.getElementById('opt-zen');
          if (armed && el.getAttribute('data-state') === 'idle' && z.checked) z.click();
        });
      }), resetOk);
      await control('RESET: a copy that leaves the volume as it was', 'back', copy(function () {
        var el = document.getElementById('tune-reset'), armed = false, was = 0;
        document.addEventListener('click', function (e) {
          if (!(e.target && e.target.closest && e.target.closest('#tune-reset'))) return;
          armed = el.getAttribute('data-state') === 'armed'; was = document.getElementById('volume').value;
        }, true);
        el.addEventListener('click', function () {
          var v = document.getElementById('volume');
          if (armed && el.getAttribute('data-state') === 'idle') { v.value = was; v.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      }), resetOk);
      await control('RESET: a copy that leaves the frame\'s finish as it was', 'back', copy(function () {
        var el = document.getElementById('tune-reset'), armed = false, was = null;
        document.addEventListener('click', function (e) {
          if (!(e.target && e.target.closest && e.target.closest('#tune-reset'))) return;
          armed = el.getAttribute('data-state') === 'armed';
          was = JSON.parse(localStorage.getItem('hourglass.settings.v1')).finish;
        }, true);
        el.addEventListener('click', function () { if (armed && el.getAttribute('data-state') === 'idle') window.Hourglass.setFinish(was); });
      }), resetOk);
      await control('RESET: a copy that rings the bowl as it puts it back', 'engines', copy(function () {
        var el = document.getElementById('tune-reset'), armed = false;
        document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#tune-reset')) armed = el.getAttribute('data-state') === 'armed'; }, true);
        el.addEventListener('click', function () { if (armed && el.getAttribute('data-state') === 'idle') window.Hourglass.audio.chime(0); });
      }), resetOk);
      await control('RESET: a copy that tells the sound engine everything, differing or not', 'again', copy(function () {
        var el = document.getElementById('tune-reset'), armed = false;
        document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#tune-reset')) armed = el.getAttribute('data-state') === 'armed'; }, true);
        el.addEventListener('click', function () { var a = window.Hourglass.audio; if (armed && el.getAttribute('data-state') === 'idle') a.setVolume(a.volume); });
      }), resetOk);
      await control('RESET: a copy whose first tap only changes the link\'s words (nothing said to a screen reader)', 'speaks', function () {
        return reset(env, { open: { routes: [broken(env, 'app.js', swap(/if \(resetSay\) resetSay\.textContent = RESET_SURE;/, ''))] } });
      }, resetOk);
      await control('RESET: a copy that leaves the question in the status once the link has given up', 'speaks', function () {
        return reset(env, { open: { routes: [broken(env, 'app.js', swap(/if \(resetSay\) resetSay\.textContent = '';/, ''))] } });
      }, resetOk);
      await control('RESET: a copy that says it done in the usual place, on the rows', 'says', function () {
        return reset(env, { open: { routes: [broken(env, 'styles.css', add('#toast.high { bottom: calc(var(--sab) + 172px) !important; top: auto !important; }'))] } });
      }, resetOk);
    }

    if (wanted('hint')) {
      var hn = hintOk(await hint(env));
      s.check('HINT: at 393 x 852 every tab (Sand, Glass, Sound and Time), shown at its top, shows that there is more below, with no top edge', hn.tabs.ok, hn.tabs.detail);
      s.check('HINT: scrolled to the middle, the rows fade out under the tab row and the hint still shows', hn.middle.ok, hn.middle.detail);
      s.check('HINT: scrolled to the end (within 2 px), the hint is gone and the top edge stays', hn.end.ok, hn.end.detail);
      s.check('HINT: the hint lies over the rows\' lower edge, its chevron under them; both edges are hidden from a screen reader and take no pointer', hn.what.ok, hn.what.detail);
      s.check('HINT: a finger on the hint reaches the row under it', hn.tap.ok, hn.tap.detail);
      s.check('HINT: the sheet, the tab row, the rows\' box and every tab\'s first row stand where they stood at 122a7fd', hn.place.ok, hn.place.detail);
      s.check('HINT: no page or console errors', hn.errors.ok, hn.errors.detail);
      var hr = hintRowsOk(await hintRows(env));
      s.check('HINT: rows that appear and go keep it right: Grain appearing under a tab scrolled to its end (Real sand failing to start) brings the hint back; Real sand turned off and on again, it is right at the top and at the end', hr.ok, hr.detail);
      var hd = hintReducedOk(await hint(env, { reduced: true, open: { reducedMotion: true } }));
      s.check('HINT: with reduced motion the edges appear and go at once, without a fade', hd.ok, hd.detail);
      var css = function (rule) { return function () { return hint(env, { open: { routes: [broken(env, 'styles.css', add(rule))] } }); }; };
      await control('HINT: a hint never drawn (a style sheet that always hides it) is missing on every tab at its top', 'tabs', css('#sheet-settings .edge-more { opacity: 0 !important; }'), hintOk);
      await control('HINT: a hint drawn always (a style sheet that never hides it) shows at the end', 'end', css('#sheet-settings .edge-more { opacity: 1 !important; }'), hintOk);
      await control('HINT: a style sheet with no top edge cuts the rows hard under the tab row', 'middle', css('#sheet-settings .edge-top { opacity: 0 !important; }'), hintOk);
      await control('HINT: a hint that takes taps (pointer-events put back to auto) stops the finger', 'tap', css('#sheet-settings .edge-more { pointer-events: auto !important; }'), hintOk);
      await control('HINT: a page whose hint a screen reader would read (aria-hidden taken off it) is found out', 'what', function () {
        return hint(env, { open: { routes: [broken(env, 'index.html', swap(/<div class="edge edge-more" aria-hidden="true">/, '<div class="edge edge-more">'))] } });
      }, hintOk);
      await control('HINT: an edge that takes room moves the rows', 'place', css('#sheet-settings .edge-top { margin-bottom: 0 !important; }'), hintOk);
      await control('HINT: a copy that reads the scroll only when it moves (not when a tab is opened or shown) shows no hint on a tab opened at its top', 'tabs', function () {
        return hint(env, { open: { routes: [broken(env, 'app.js', function (src) {
          return [/var edgeWatch = new ResizeObserver\(function \(\) \{ tuneEdges\(\); \}\);/, /tuneEdges\(\);\n    resetDisarm\(\);/, /tuneEdges\(\);\n    buzz\(8\);/]
            .reduce(function (out, re, i) { return swap(re, ['var edgeWatch = { observe: function () {} };', 'resetDisarm();', 'buzz(8);'][i])(out); }, src);
        })] } });
      }, hintOk);
      await control('HINT: a page with no ResizeObserver (rows that change are not seen) misses Grain appearing', null, function () {
        return hintRows(env, { routes: [broken(env, 'index.html', before(function () { window.ResizeObserver = undefined; }))] });
      }, hintRowsOk);
      await control('HINT: a style sheet that fades the edges with reduced motion too', null, function () {
        return hint(env, { reduced: true, open: { reducedMotion: true, routes: [broken(env, 'styles.css', add('#sheet-settings .edge { transition: opacity 0.25s !important; }'))] } });
      }, hintReducedOk);
    }
  } catch (e) {
    s.check('the suite ran to its end', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' '));
  }
  await env.close();
  s.done();
})();
