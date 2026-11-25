#!/usr/bin/env node
/*
 * Tune's Time tab: the six quick durations, set by the person, and "Show when it ends" (settings
 * design 3.4, rows 1 and 2).
 *
 *   ORDER    the Time tab, top to bottom: "Quick durations" (its six buttons and their note), "The
 *            clock" (Show when it ends, then Keep screen awake), then the rows that were there
 *            (While it runs, Touch, the reset link)
 *   QUICK    with nothing saved, the six pills under the glass and the six buttons of the Time
 *            tab say 1, 5, 10, 15, 30 and 60 minutes, named as before ("5 minutes"), and "Quick
 *            duration 3: 10 minutes, change"; a touch on each button opens the custom duration's
 *            own sheet with its minutes only ("Quick duration 3", no seconds, no rest), a turn of
 *            its dial and Set make the pill under the glass that number at once, the setting is
 *            saved, Tune comes back with the focus on that button; after a reload the six are as
 *            they were set
 *   LIT      the lit pill is the first whose minutes are the glass's (two the same: one lit); a
 *            pill changed away from the glass's minutes leaves the glass as it is (also running:
 *            its time goes on) and the light follows the number; none the same, Custom is lit
 *   CANCEL   the dial closed by its close button, by Escape, or by a tap on the scrim leaves the
 *            pill and the setting as they were, and Tune comes back
 *   KEYS     with a keyboard: a button of the Time tab opened by Enter, the dial turned by the
 *            arrow keys, Set by Enter: the pill set, the focus back on the button; what a screen
 *            reader meets (a group named "Quick durations", buttons that open a dialog, "Set
 *            quick duration 3 to 12 minutes"); each button at least 44 px each way
 *   FIT      at 393 x 852, 375 x 667 and 320 x 568 the Time tab has no sideways scroll, every row
 *            and button within the sheet, the six buttons at least 44 px; with "99" in all six,
 *            the pills under the glass and Custom fit a 320 px screen with no sideways scroll
 *   ENDS     with a clock the test sets (Date.now from a fixed moment, moved on at will) and a
 *            fixed locale and time zone (en-GB in Europe/Berlin, 24 hours; en-US in
 *            America/New_York, 12 hours): the state line reads "Flowing · ends 14:34" when a
 *            10 minute glass starts at 14:24:40; the same after a minute boundary, and nothing
 *            written to the page meanwhile; later after sand is added; right after a turn; gone
 *            while paused ("Paused" exactly) and back later by the pause; gone at the end ("Time
 *            · flip to begin again" exactly); across midnight; in a work and rest sequence the
 *            end of the phase now running; the switch off: today's words exactly, and none of
 *            the page's markup added; the end hidden from a screen reader in the live state line
 *            and given in the time's label instead; in Zen dimmed with the state line, and on a
 *            short screen hidden with it
 *
 * Every check has its control: the same measurements on a copy with that one thing broken (a
 * line of app.js, a rule of the style sheet, the page's markup), handed to the page in place of
 * the file it stands for, which must fail the check.
 *
 *   node tools/test/app-time.test.js [--port <n>] [--root <dir>] [--only order|quick|lit|cancel|keys|fit|ends]
 */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

var KEY = 'hourglass.settings.v1';
var DEFAULT_SIX = [1, 5, 10, 15, 30, 60];

/* ---- a copy with something broken, for a control (as app-tune) ---------------------------- */
function broken(env, file, change) {
  var src = fs.readFileSync(path.join(env.root, file), 'utf8'), out = change(src);
  if (out === src) throw new Error('app-time: the control\'s change to ' + file + ' changed nothing');
  var type = /\.css$/.test(file) ? 'text/css' : /\.html$/.test(file) ? 'text/html' : 'text/javascript';
  var names = file === 'index.html' ? ['/', '/index.html'] : ['/' + file], origin = env.url.replace(/\/$/, '');
  return {
    url: function (u) { return u.origin === origin && names.indexOf(u.pathname) >= 0; },
    handler: function (route) { route.fulfill({ status: 200, contentType: type + '; charset=utf-8', body: out }); }
  };
}
function add(text) { return function (src) { return src + '\n' + text + '\n'; }; }
function swap(from, to) {
  return function (src) {
    var n = src.split(from).length - 1;
    if (n !== 1) throw new Error('app-time: a control\'s text is in the file ' + n + ' times: ' + from.slice(0, 70));
    return src.replace(from, function () { return to; });
  };
}
function saved(t) { return t.eval(function (k) { return JSON.parse(localStorage.getItem(k) || 'null'); }, KEY); }

/* ---- the quick durations ----------------------------------------------------------------- */
/** The pills under the glass, Tune's six buttons, Custom, the glass and the save, as they are now. */
function quickState(t) {
  return t.eval(function (k) {
    var pills = Array.prototype.map.call(document.querySelectorAll('#durations .pill[data-quick]'), function (p) {
      return { min: p.dataset.min, text: p.textContent, label: p.getAttribute('aria-label'), on: p.getAttribute('aria-checked') };
    });
    var btns = Array.prototype.map.call(document.querySelectorAll('#quick button'), function (b) {
      var r = b.getBoundingClientRect();
      return { text: b.textContent, label: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), lit: b.classList.contains('lit'), w: r.width, h: r.height };
    });
    var c = document.getElementById('pill-custom'), sc = document.getElementById('sheet-custom'), a = document.activeElement;
    var st = JSON.parse(localStorage.getItem(k) || 'null');
    return {
      pills: pills, btns: btns, custom: [c.getAttribute('aria-pressed'), document.getElementById('custom-label').textContent],
      glass: { state: window.Hourglass.timer.state, ms: window.Hourglass.timer.durationMs, rem: window.Hourglass.timer.rem },
      saved: st ? st.quick : null,
      sheet: { custom: !sc.hidden && sc.classList.contains('open'), quick: sc.classList.contains('quick'), title: document.getElementById('custom-title').textContent,
               sec: getComputedStyle(document.getElementById('wheel-sec').parentNode).display, seq: getComputedStyle(document.getElementById('seq')).display,
               set: document.getElementById('custom-set').textContent.replace(/\s+/g, ' ').trim(), setSaid: document.getElementById('custom-set').getAttribute('aria-label'),
               tune: window.__tune.isOpen() },
      focus: a ? (a.dataset && a.dataset.quick !== undefined && a.closest('#quick') ? 'quick ' + a.dataset.quick : a.id || a.tagName) : ''
    };
  }, KEY);
}
function minutesSaid(m) { return m + (m === 1 ? ' minute' : ' minutes'); }
/** Do the pills and the buttons say these six? */
function says(q, six) {
  return q.pills.length === 6 && q.btns.length === 6 && six.every(function (m, i) {
    var p = q.pills[i], b = q.btns[i];
    return p.min === String(m) && p.text === m + 'm' && p.label === minutesSaid(m) &&
      b.text === m + 'm' && b.label === 'Quick duration ' + (i + 1) + ': ' + minutesSaid(m) + ', change' && b.popup === 'dialog';
  });
}
function sixOf(q) { return q.pills.map(function (p) { return p.min; }).join(','); }
/** Turn the dial's minutes to m, as a finger leaves it (its scroll at that item). */
function dialTo(t, m) {
  return t.eval(function (m) {
    var w = document.getElementById('wheel-min');
    w.scrollTop = m * 46;
    w.dispatchEvent(new Event('scroll'));
    return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  }, m);
}
async function settle(t) { await tune.rest(t); await sleep(250); }
/** Tune's button i touched: the dial open over the glass, in its quick mode. */
async function openPill(t, i) {
  await tune.tap(t, '#quick [data-quick="' + i + '"]');
  await sleep(650);
}
/** The dial set to m and Set touched; Tune back. */
async function setTo(t, m) {
  await dialTo(t, m);
  await t.page.tap('#custom-set');
  await sleep(750);
  await settle(t);
}

async function quick(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({}, o.open || {})), m = { steps: [] };
  var SET = o.set || [2, 25, 3, 45, 90, 99];
  try {
    await sleep(800);
    m.boot = await quickState(t);
    for (var i = 0; i < 6; i++) {
      await openPill(t, i);
      var opened = await quickState(t);
      await setTo(t, SET[i]);
      m.steps.push({ i: i, opened: opened, after: await quickState(t) });
    }
    await t.reload();
    await sleep(800);
    m.reloaded = await quickState(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function quickOk(m, SET) {
  SET = SET || [2, 25, 3, 45, 90, 99];
  var boot = { ok: says(m.boot, DEFAULT_SIX) && m.boot.saved === '1,5,10,15,30,60' && m.boot.pills[1].on === 'true' && m.boot.custom[0] === 'false',
               detail: sixOf(m.boot) + '; ' + m.boot.btns.map(function (b) { return b.label; }).join(' | ') };
  var bad = [];
  m.steps.forEach(function (s) {
    var want = SET.slice(0, s.i + 1).concat(DEFAULT_SIX.slice(s.i + 1)), o = s.opened, a = s.after;
    if (!(o.sheet.custom && o.sheet.quick && o.sheet.title === 'Quick duration ' + (s.i + 1) && o.sheet.sec === 'none' && o.sheet.seq === 'none' && !o.sheet.tune &&
          o.sheet.set === 'Set ' + DEFAULT_SIX[s.i] + ' min')) bad.push(s.i + 1 + ': the dial opened as ' + JSON.stringify(o.sheet));
    if (!says(a, want)) bad.push(s.i + 1 + ': the six are ' + sixOf(a) + ' for ' + want.join());
    if (a.saved !== want.join(',')) bad.push(s.i + 1 + ': saved ' + a.saved);
    if (!a.sheet.tune || a.sheet.custom || a.focus !== 'quick ' + s.i) bad.push(s.i + 1 + ': after Set, Tune ' + a.sheet.tune + ', the dial ' + a.sheet.custom + ', the focus on ' + a.focus);
  });
  return {
    boot: boot,
    set: { ok: bad.length === 0 && m.steps.length === 6, detail: bad.slice(0, 3).join('; ') || 'each of the six set in turn: ' + m.steps.map(function (s) { return sixOf(s.after); }).join(' → ') },
    reload: { ok: says(m.reloaded, SET) && m.reloaded.saved === SET.join(','), detail: sixOf(m.reloaded) + ', saved ' + m.reloaded.saved },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- LIT: duplicates, the light by number, the glass kept --------------------------------- */
async function lit(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({ storage: { 'hourglass.settings.v1': { quick: '10,5,10,15,30,60', durationMs: 600000 } } }, o.open || {})), m = {};
  try {
    await sleep(800);
    m.twin = await quickState(t);
    // the glass running, then the first 10 set to 20: the glass goes on, the second 10 is lit
    await t.page.tap('#btn-play');
    await sleep(600);
    m.running = await quickState(t);
    await openPill(t, 0); await setTo(t, 20);
    m.moved = await quickState(t);
    // the second 10 set to 25: no pill has the glass's minutes, Custom is lit
    await openPill(t, 2); await setTo(t, 25);
    m.none = await quickState(t);
    // and back to 10: lit again
    await openPill(t, 5); await setTo(t, 10);
    m.back = await quickState(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function litOk(m) {
  var on = function (q) { return q.pills.map(function (p, i) { return p.on === 'true' ? i : -1; }).filter(function (i) { return i >= 0; }).join(); };
  var lights = function (q) { return q.btns.map(function (b, i) { return b.lit ? i : -1; }).filter(function (i) { return i >= 0; }).join(); };
  return {
    twin: { ok: m.twin.saved === '10,5,10,15,30,60' && on(m.twin) === '0' && lights(m.twin) === '0' && m.twin.custom[0] === 'false',
            detail: 'two 10s: lit ' + on(m.twin) + ' under the glass, ' + lights(m.twin) + ' in Tune' },
    follows: { ok: m.running.glass.state === 'running' && m.moved.glass.state === 'running' && m.moved.glass.ms === 600000 && m.moved.glass.rem < m.running.glass.rem &&
                   on(m.moved) === '2' && lights(m.moved) === '2' && m.none.glass.ms === 600000 && m.none.glass.state === 'running' && on(m.none) === '' &&
                   m.none.custom.join() === 'true,10:00' && on(m.back) === '5' && m.back.custom[0] === 'false' && m.back.glass.ms === 600000,
               detail: 'running ' + m.running.glass.state + ' ' + Math.round(m.running.glass.rem) + ' ms; the first set to 20: ' + m.moved.glass.state + ' ' + m.moved.glass.ms + ' ms, ' +
                       Math.round(m.moved.glass.rem) + ' left, lit ' + on(m.moved) + '; none the same: lit ' + (on(m.none) || 'none') + ', Custom ' + m.none.custom.join(' ') +
                       '; the sixth set to 10: lit ' + on(m.back) },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- CANCEL ----------------------------------------------------------------------------- */
async function cancel(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({}, o.open || {})), m = {};
  try {
    await sleep(800);
    var ways = [['close', async function () { await t.page.tap('#sheet-custom .sheet-close'); }],
                ['escape', async function () { await t.page.keyboard.press('Escape'); }],
                ['scrim', async function () { await t.page.touchscreen.tap(195, 120); }]];
    for (var i = 0; i < ways.length; i++) {
      await openPill(t, 2);
      await dialTo(t, 42);
      await ways[i][1]();
      await sleep(750);
      await settle(t);
      m[ways[i][0]] = await quickState(t);
    }
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function cancelOk(m) {
  var bad = ['close', 'escape', 'scrim'].filter(function (k) {
    var q = m[k];
    return !q || !says(q, DEFAULT_SIX) || q.saved !== '1,5,10,15,30,60' || !q.sheet.tune || q.sheet.custom;
  });
  return { ok: bad.length === 0 && m.errors.length === 0,
           detail: (bad.length ? 'WRONG after ' + bad.join(', ') + ': ' : '') + ['close', 'escape', 'scrim'].map(function (k) { var q = m[k]; return k + ' → ' + (q ? sixOf(q) + ' saved ' + q.saved + ', Tune ' + q.sheet.tune : 'not read'); }).join('; ') +
                   ' ' + m.errors.slice(0, 2).join(' | ') };
}

/* ---- KEYS ------------------------------------------------------------------------------- */
async function keys(env, o) {
  o = o || {};
  var t = await env.open(Object.assign({}, o.open || {})), m = {};
  try {
    await sleep(800);
    await tune.show(t, '#quick [data-quick="2"]');
    await settle(t);
    m.group = await t.eval(function () {
      var g = document.getElementById('quick'), by = g ? document.getElementById(g.getAttribute('aria-labelledby')) : null;
      return { role: g ? g.getAttribute('role') : null, name: by ? by.textContent : null,
               tags: Array.prototype.map.call(document.querySelectorAll('#quick > *'), function (b) { return b.tagName + (b.getAttribute('type') ? ':' + b.getAttribute('type') : '') + (b.tabIndex === 0 ? '' : ' tabindex ' + b.tabIndex); }).join() };
    });
    await t.eval(function () { document.querySelector('#quick [data-quick="2"]').focus(); });
    await t.page.keyboard.press('Enter');
    await sleep(700);
    m.opened = await quickState(t);
    await t.eval(function () { document.getElementById('wheel-min').focus(); });
    await t.page.keyboard.press('ArrowDown');
    await sleep(500);
    await t.page.keyboard.press('ArrowDown');
    await sleep(900);
    m.turned = await quickState(t);
    m.valuenow = await t.eval(function () { return document.getElementById('wheel-min').getAttribute('aria-valuenow') + '/' + document.getElementById('wheel-min').getAttribute('aria-valuemin'); });
    await t.eval(function () { document.getElementById('custom-set').focus(); });
    await t.page.keyboard.press('Enter');
    await sleep(900);
    await settle(t);
    m.done = await quickState(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
function keysOk(m) {
  var d = m.done, small = d.btns.filter(function (b) { return b.w < 44 || b.h < 44; });
  return {
    said: { ok: m.group.role === 'group' && m.group.name === 'Quick durations' && m.group.tags === 'BUTTON:button,BUTTON:button,BUTTON:button,BUTTON:button,BUTTON:button,BUTTON:button' &&
                m.opened.btns[2].label === 'Quick duration 3: 10 minutes, change' && m.turned.sheet.setSaid === 'Set quick duration 3 to 12 minutes' && m.valuenow === '12/1',
            detail: JSON.stringify(m.group) + '; the third named "' + m.opened.btns[2].label + '"; Set named "' + m.turned.sheet.setSaid + '"; the dial ' + m.valuenow },
    keys: { ok: m.opened.sheet.custom && m.opened.sheet.quick && m.turned.sheet.set === 'Set 12 min' && d.saved === '1,5,12,15,30,60' && d.pills[2].min === '12' && d.sheet.tune && d.focus === 'quick 2',
            detail: 'Enter opened the dial: ' + m.opened.sheet.custom + '; two arrows down: ' + m.turned.sheet.set + '; Enter on Set: saved ' + d.saved + ', Tune ' + d.sheet.tune + ', the focus on ' + d.focus },
    size: { ok: small.length === 0 && d.btns.length === 6, detail: d.btns.map(function (b) { return Math.round(b.w) + 'x' + Math.round(b.h); }).join(' ') },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- ORDER and FIT ----------------------------------------------------------------------- */
var SIZES = [[393, 852], [375, 667], [320, 568]];
function timeTab(t) {
  return t.eval(function () {
    var p = document.getElementById('panel-time'), b = document.querySelector('#sheet-settings .sheet-body'), br = b.getBoundingClientRect();
    var parts = Array.prototype.map.call(p.children, function (c) {
      return c.tagName === 'H3' ? 'h3 ' + c.textContent : c.id === 'tune-reset' ? 'the reset link' : c.className === 'quick-pick' ? 'the six' :
        'rows: ' + Array.prototype.map.call(c.querySelectorAll('.row b'), function (x) { return x.textContent; }).join(', ');
    });
    var out = [];
    p.querySelectorAll('h3, .row, .quick-pick, #quick button, .quick-pick small, .row b, .row small, .switch, #tune-reset, .segmented button').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width) return;
      if (r.left < br.left - 0.5 || r.right > br.right + 0.5 || el.scrollWidth > el.clientWidth + 1) out.push((el.id || el.className || el.tagName) + ' [' + Math.round(r.left) + ', ' + Math.round(r.right) + '] in [' + Math.round(br.left) + ', ' + Math.round(br.right) + ']' + (el.scrollWidth > el.clientWidth + 1 ? ' cut: ' + el.scrollWidth + '/' + el.clientWidth : ''));
    });
    var small = Array.prototype.filter.call(document.querySelectorAll('#quick button'), function (x) { var r = x.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length;
    return { parts: parts, out: out, small: small, sideways: b.scrollWidth - b.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
  });
}
function pillsFit(t) {
  return t.eval(function () {
    var d = document.getElementById('durations'), row = document.getElementById('duration-row').getBoundingClientRect(), c = document.getElementById('pill-custom').getBoundingClientRect();
    var pills = Array.prototype.map.call(d.querySelectorAll('.pill'), function (p) { var r = p.getBoundingClientRect(); return [r.left, r.right, p.textContent]; });
    return { scroll: d.scrollWidth - d.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth, custom: [c.left, c.right], row: [row.left, row.right], w: window.innerWidth,
             pills: pills, inside: pills.every(function (p) { return p[0] >= 0 && p[1] <= window.innerWidth; }) && c.right <= window.innerWidth };
  });
}
async function fit(env, o) {
  o = o || {};
  var m = { tabs: {} };
  for (var k = 0; k < SIZES.length; k++) {
    var size = SIZES[k];
    var t = await env.open(Object.assign({ viewport: { width: size[0], height: size[1] }, storage: { 'hourglass.settings.v1': { quick: '99,99,99,99,99,99' } } }, o.open || {}));
    try {
      await sleep(700);
      if (size[0] === 320) m.pills = await pillsFit(t);
      await tune.show(t, '#quick');
      await settle(t);
      m.tabs[size.join(' x ')] = await timeTab(t);
      m.errors = (m.errors || []).concat(t.errors);
    } finally { await t.close(); }
  }
  return m;
}
var ORDER = ['h3 Quick durations', 'the six', 'h3 The clock', 'rows: Show when it ends, Keep screen awake', 'h3 While it runs', 'rows: Breathing pace, Full Zen', 'h3 Touch', 'rows: Haptics', 'the reset link'];
function fitOk(m) {
  var first = m.tabs['393 x 852'];
  var bad = Object.keys(m.tabs).filter(function (k) { var x = m.tabs[k]; return x.out.length || x.small || x.sideways > 0 || x.page > 0; });
  var p = m.pills || {};
  return {
    order: { ok: !!first && first.parts.join('|') === ORDER.join('|'), detail: first ? first.parts.join(' | ') : 'not read' },
    tab: { ok: bad.length === 0 && Object.keys(m.tabs).length === 3,
           detail: Object.keys(m.tabs).map(function (k) { var x = m.tabs[k]; return k + ': sideways ' + x.sideways + '/' + x.page + ' px, ' + x.small + ' buttons under 44 px' + (x.out.length ? ', OUT: ' + x.out.slice(0, 3).join('; ') : ''); }).join(' | ') },
    pills: { ok: p.scroll <= 0 && p.page <= 0 && p.inside && (p.pills || []).length === 6 && p.pills.every(function (x) { return x[2] === '99m'; }),
             detail: 'at 320 x 568 with "99" in all six: the pills scroll ' + p.scroll + ' px sideways, the page ' + p.page + ' px; Custom ends at ' + (p.custom ? Math.round(p.custom[1]) : '?') + ' of ' + p.w },
    errors: { ok: (m.errors || []).length === 0, detail: (m.errors || []).slice(0, 2).join(' | ') }
  };
}

/* ---- ENDS ------------------------------------------------------------------------------- */
/** Runs before the page's scripts: Date.now() from a fixed moment, moved on by window.__jump. */
function clockInit(start) {
  var real = Date.now, r0 = real.call(Date), skew = 0;
  Date.now = function () { return start + (real.call(Date) - r0) + skew; };
  window.__jump = function (ms) { skew += ms; };
  // every write to the state line, counted (a node added, removed, or its text changed)
  window.__writes = 0;
  document.addEventListener('DOMContentLoaded', function () {
    var st = document.getElementById('status');
    if (st) new MutationObserver(function (l) { window.__writes += l.length; }).observe(st, { childList: true, characterData: true, subtree: true, attributes: true });
  });
}
function endState(t) {
  return t.eval(function () {
    var H = window.Hourglass, st = document.getElementById('status'), e = document.getElementById('ends');
    var at = Date.now() + H.timer.rem;
    var want = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(at));
    return {
      text: st.textContent, state: H.timer.state, rem: H.timer.rem, at: at, want: want, writes: window.__writes,
      ends: e ? { hidden: e.getAttribute('aria-hidden'), inStatus: e.parentNode === st, drawn: e.getClientRects().length > 0, display: getComputedStyle(e).display,
                  op: +getComputedStyle(e).opacity, vis: getComputedStyle(e).visibility } : null,
      live: st.getAttribute('aria-live'), label: document.getElementById('readout').getAttribute('aria-label'),
      statusDrawn: st.getClientRects().length > 0, hud: +getComputedStyle(st.closest('.hud')).opacity, zen: document.getElementById('app').classList.contains('zen'),
      kids: st.childNodes.length
    };
  });
}
var BERLIN = { locale: 'en-GB', timezoneId: 'Europe/Berlin', start: Date.UTC(2026, 10, 24, 13, 24, 40) };      // 14:24:40 there
var NEW_YORK = { locale: 'en-US', timezoneId: 'America/New_York', start: Date.UTC(2026, 10, 24, 19, 24, 40) };  // 2:24:40 PM there
async function ends(env, place, o) {
  o = o || {};
  var t = await env.open(Object.assign({ locale: place.locale, timezoneId: place.timezoneId, init: clockInit, initArg: place.start,
                                         storage: { 'hourglass.settings.v1': Object.assign({ durationMs: 600000, endsAt: true }, o.save || {}) } }, o.open || {})), m = {};
  async function jump(ms) { await t.eval(function (ms) { window.__jump(ms); }, ms); }
  try {
    await sleep(800);
    m.idle = await endState(t);
    await t.page.tap('#btn-play');
    await sleep(500);
    m.start = await endState(t);
    if (o.short) { m.errors = t.errors.slice(); return m; }
    // over a minute boundary (14:24:40 + 25 s), and three seconds of frames: the end stands, nothing written
    await jump(25000);
    await sleep(3000);
    m.minute = await endState(t);
    // sand added: a finger on Sand for 1.6 s
    var b = await t.eval(function () { var r = document.getElementById('btn-sand').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await t.touch.down(b.x, b.y); await sleep(1600); await t.touch.up();
    await sleep(700);
    m.sand = await endState(t);
    // a turn by the Flip button: Turning, then running on the other way up
    await t.page.tap('#btn-flip');
    await sleep(600);
    m.turning = await endState(t);
    await sleep(3200);
    m.flipped = await endState(t);
    // paused, three minutes pass, resumed
    await t.page.tap('#btn-play');
    await sleep(400);
    m.paused = await endState(t);
    await jump(180000);
    await sleep(300);
    m.pausedLater = await endState(t);
    await t.page.tap('#btn-play');
    await sleep(500);
    m.resumed = await endState(t);
    // Zen (the moon), then out again
    await t.page.tap('#btn-zen');
    await sleep(1800);
    m.zen = await endState(t);
    await t.page.keyboard.press('Escape');
    await sleep(900);
    // to the end
    var rem = (await endState(t)).rem;
    await jump(rem - 300);
    await sleep(2500);
    m.end = await endState(t);
    m.errors = t.errors.slice();
  } finally { await t.close(); }
  return m;
}
/** The state line reads "<words> · ends <the end of now + rem>", the end hidden from a screen reader and in the time's label. */
function reads(st, words) {
  return !!st && st.text === words + ' · ends ' + st.want && !!st.ends && st.ends.hidden === 'true' && st.ends.inStatus && st.live === 'polite' &&
    st.label === 'Time remaining, ends ' + st.want + '. Tap to set a custom duration.';
}
/** ... and nothing of it: today's words exactly, no span, today's label. */
function plain(st, words) { return !!st && st.text === words && !st.ends && st.kids === 1 && st.label === 'Time remaining. Tap to set a custom duration.'; }
function endsOk(m, place) {
  var want0 = place === NEW_YORK ? '2:34 PM' : '14:34';
  var r = function (k) { var x = m[k]; return x ? k + ' "' + x.text + '"' : k + ' not read'; };
  return {
    start: { ok: plain(m.idle, 'Tap the glass to begin') && reads(m.start, 'Flowing') && m.start.want === want0, detail: r('idle') + ', ' + r('start') + ' (want ends ' + want0 + '); label "' + m.start.label + '"' },
    minute: { ok: reads(m.minute, 'Flowing') && m.minute.text === m.start.text && m.minute.writes === m.start.writes,
              detail: r('minute') + ' after 14:25:00; writes to the state line meanwhile: ' + (m.minute.writes - m.start.writes) },
    sand: { ok: reads(m.sand, 'Flowing') && m.sand.at - m.minute.at > 60000 && m.sand.text !== m.minute.text, detail: r('sand') + ', the end ' + Math.round((m.sand.at - m.minute.at) / 1000) + ' s later' },
    flip: { ok: plain(m.turning, 'Turning') && reads(m.flipped, 'Flowing') && m.flipped.text !== m.sand.text, detail: r('turning') + ', ' + r('flipped') },
    pause: { ok: plain(m.paused, 'Paused') && plain(m.pausedLater, 'Paused') && reads(m.resumed, 'Flowing') && Math.abs(m.resumed.at - m.paused.at - 180000) < 3000,
             detail: r('paused') + ', ' + r('resumed') + ': the end ' + Math.round((m.resumed.at - m.paused.at) / 1000) + ' s later for a pause of 180 s' },
    zen: { ok: !!m.zen && m.zen.zen && reads(m.zen, 'Flowing') && m.zen.ends.display === 'inline' && m.zen.ends.op === 1 && m.zen.ends.vis === 'visible' && m.zen.hud < 0.2,
           detail: m.zen ? 'in Zen the line\'s controls at ' + m.zen.hud + ', the end itself ' + JSON.stringify(m.zen.ends) : 'not read' },
    end: { ok: plain(m.end, 'Time · flip to begin again') && m.end.state === 'done', detail: r('end') + ' (' + (m.end && m.end.state) + ')' },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- the run ----------------------------------------------------------------------------- */
function failing(v) { return Object.keys(v).filter(function (k) { return !v[k].ok; }); }
(async function () {
  var env = await H.start(), s = new H.Suite('app-time'), only = env.args.only;
  function wanted(name) { return !only || only.toLowerCase() === name.toLowerCase(); }
  async function control(label, part, measure, verdict) {
    var v, why;
    try { v = verdict(await measure()); } catch (e) { why = 'the copy could not be measured: ' + String(e && e.message || e).split('\n')[0]; }
    var bad = v ? failing(v) : [];
    var hit = v ? (part ? bad.indexOf(part) >= 0 : bad.length > 0) : false;
    s.check('CONTROL ' + label, hit, why || (hit ? 'fails: ' + v[part || bad[0]].detail : 'PASSES; failing only ' + (bad.join(', ') || 'nothing')));
  }
  function copy(file, change) { return { routes: [broken(env, file, change)] }; }
  try {
    if (wanted('order') || wanted('fit')) {
      var f = fitOk(await fit(env));
      s.check('ORDER: the Time tab is Quick durations (the six), The clock (Show when it ends, Keep screen awake), then the rows that were there (While it runs, Touch, the reset link)', f.order.ok, f.order.detail);
      s.check('FIT: at 393 x 852, 375 x 667 and 320 x 568 (with "99" in all six) the Time tab has no sideways scroll, every row, heading and button within the sheet and none cut, the six buttons at least 44 x 44 px', f.tab.ok, f.tab.detail);
      s.check('FIT: with "99" in all six, the pills under the glass and Custom fit a 320 px screen with no sideways scroll', f.pills.ok, f.pills.detail);
      s.check('FIT: no page or console errors', f.errors.ok, f.errors.detail);
      await control('ORDER: a page with Keep screen awake above Show when it ends', 'order', function () {
        return fit(env, { open: copy('index.html', function (src) {
          var a = src.indexOf('<label class="row" for="opt-ends">'), b = src.indexOf('<label class="row" for="opt-awake">'), e = src.indexOf('</label>', b) + 8;
          var ends = src.slice(a, b), awake = src.slice(b, e);
          return src.slice(0, a) + awake + '\n          ' + ends.trim() + src.slice(e);
        }) });
      }, fitOk);
      await control('FIT: a style sheet that keeps the six buttons six across at 320 px (and lets them shrink) makes them narrower than 44 px', 'tab', function () {
        return fit(env, { open: copy('styles.css', add('#quick { grid-template-columns: repeat(6, minmax(0, 1fr)) !important; } #quick button { min-width: 0 !important; }')) });
      }, fitOk);
      await control('FIT: a style sheet whose pills under the glass are wider does not fit 320 px', 'pills', function () {
        return fit(env, { open: copy('styles.css', add('#durations .pill { min-width: 44px !important; }')) });
      }, fitOk);
    }

    if (wanted('quick')) {
      var q = quickOk(await quick(env));
      s.check('QUICK: with nothing saved, the six pills under the glass and the Time tab\'s six buttons say 1, 5, 10, 15, 30 and 60 minutes ("Quick duration 3: 10 minutes, change"); 5 lit', q.boot.ok, q.boot.detail);
      s.check('QUICK: each of the six set in turn with the dial in its quick mode (its minutes only): the pill under the glass changes at once, the setting is saved, Tune comes back with the focus on that button', q.set.ok, q.set.detail);
      s.check('QUICK: after a reload the six are as they were set', q.reload.ok, q.reload.detail);
      s.check('QUICK: no page or console errors', q.errors.ok, q.errors.detail);
      await control('QUICK: a copy whose Set does not save the six is found out after the reload', 'reload', function () {
        return quick(env, { open: copy('app.js', swap("settings.quick = mins.join(','); save();", "settings.quick = mins.join(',');")) });
      }, quickOk);
      await control('QUICK: a copy that changes the pills under the glass only at the next launch', 'set', function () {
        return quick(env, { open: copy('app.js', swap("settings.quick = mins.join(','); save();\n    showQuick();", "settings.quick = mins.join(','); save();")) });
      }, quickOk);
      await control('QUICK: a copy whose dial keeps its seconds and rest in the quick mode', 'set', function () {
        return quick(env, { open: copy('styles.css', swap('#sheet-custom.quick .dial-sep, #sheet-custom.quick .dial-col + .dial-sep + .dial-col, #sheet-custom.quick #seq { display: none; }', '')) });
      }, quickOk);
    }

    if (wanted('lit')) {
      var l = litOk(await lit(env));
      s.check('LIT: two pills the same (10, 5, 10 ...): only the first is lit, under the glass and in Tune', l.twin.ok, l.twin.detail);
      s.check('LIT: a pill changed while the glass runs leaves the glass running with its time; the light follows the number (the second 10), none the same lights Custom ("10:00"), the same again lights that pill', l.follows.ok, l.follows.detail);
      s.check('LIT: no page or console errors', l.errors.ok, l.errors.detail);
      await control('LIT: a copy that lights every pill of the glass\'s minutes', 'twin', function () {
        return lit(env, { open: copy('app.js', swap('var on = !seq.rest && !hit && +pills[i].dataset.min', 'var on = !seq.rest && +pills[i].dataset.min')) });
      }, litOk);
      await control('LIT: a copy whose changed pill sets the glass to its new minutes', 'follows', function () {
        return lit(env, { open: copy('app.js', swap("    showQuick();\n    syncPills();\n  }", "    showQuick();\n    syncPills();\n    setDuration(mins[i] * 60000);\n  }")) });
      }, litOk);
    }

    if (wanted('cancel')) {
      var c = cancelOk(await cancel(env));
      s.check('CANCEL: the dial of the third pill turned to 42 and closed by its close button, by Escape or by a tap on the scrim: the pill and the setting as they were, Tune back', c.ok, c.detail);
      await control('CANCEL: a copy that sets the pill as the dial is closed', null, function () {
        return cancel(env, { open: copy('app.js', swap('      var back = quickBtns[quickEdit];', '      setQuick(quickEdit, quickMin());\n      var back = quickBtns[quickEdit];')) });
      }, function (m) { return { it: cancelOk(m) }; });
    }

    if (wanted('keys')) {
      var k = keysOk(await keys(env));
      s.check('KEYS: a group named "Quick durations" of six buttons in the tab order, each named "Quick duration n: m minutes, change"; the dial\'s Set named "Set quick duration 3 to 12 minutes", its minutes from 1', k.said.ok, k.said.detail);
      s.check('KEYS: Enter on the third button opens the dial, two arrows down turn it to 12, Enter on Set sets it, and the focus is back on that button', k.keys.ok, k.keys.detail);
      s.check('KEYS: each of the six at least 44 x 44 px', k.size.ok, k.size.detail);
      s.check('KEYS: no page or console errors', k.errors.ok, k.errors.detail);
      await control('KEYS: a copy whose buttons are named by their minutes only', 'said', function () {
        return keys(env, { open: copy('app.js', swap("': ' + minutesSaid(q) + ', change'", "': ' + minutesSaid(q)")) });
      }, keysOk);
      await control('KEYS: a copy that leaves the focus on the page when the dial closes', 'keys', function () {
        return keys(env, { open: copy('app.js', swap('      openSheet(sheetSettings, btnSettings, back);', '      openSheet(sheetSettings, btnSettings, sheetSettings);')) });
      }, keysOk);
    }

    if (wanted('ends')) {
      var e1 = endsOk(await ends(env, BERLIN), BERLIN);
      var LBL = { start: 'starts', minute: 'after a minute boundary', sand: 'after sand is added', flip: 'after a turn', pause: 'paused and resumed', zen: 'in Zen', end: 'at the end' };
      s.check('ENDS (en-GB, Europe/Berlin, 24 hours): a 10 minute glass started at 14:24:40 reads "Flowing · ends 14:34", the end hidden from a screen reader in the live line and in the time\'s label ("Time remaining, ends 14:34. ..."); before the start today\'s words', e1.start.ok, e1.start.detail);
      s.check('ENDS: over a minute boundary the end stands, and nothing is written to the state line for three seconds of frames', e1.minute.ok, e1.minute.detail);
      s.check('ENDS: sand added (1.6 s on Sand) moves the end later, as the time left says', e1.sand.ok, e1.sand.detail);
      s.check('ENDS: during a turn "Turning" exactly; turned, the end of the glass the other way up', e1.flip.ok, e1.flip.detail);
      s.check('ENDS: paused, "Paused" exactly (also three minutes later); resumed, the end three minutes later', e1.pause.ok, e1.pause.detail);
      s.check('ENDS: in Zen the end dims with the state line (nothing of its own shows it)', e1.zen.ok, e1.zen.detail);
      s.check('ENDS: at the end "Time · flip to begin again" exactly', e1.end.ok, e1.end.detail);
      s.check('ENDS: no page or console errors', e1.errors.ok, e1.errors.detail);
      var e2 = endsOk(await ends(env, NEW_YORK), NEW_YORK);
      s.check('ENDS (en-US, America/New_York, 12 hours): "Flowing · ends 2:34 PM" at the start, and right ' + Object.keys(LBL).filter(function (x) { return x !== 'start'; }).map(function (x) { return LBL[x]; }).join(', '),
              failing(e2).length === 0, failing(e2).map(function (x) { return x + ': ' + e2[x].detail; }).join('; ') || e2.start.detail);
      // across midnight: 23:58:10 there, a 10 minute glass ends at 00:08
      var night = Object.assign({}, BERLIN, { start: Date.UTC(2026, 10, 24, 22, 58, 10) }), nightUs = Object.assign({}, NEW_YORK, { start: Date.UTC(2026, 10, 25, 4, 58, 10) });
      var mn = await ends(env, night, { short: true }), mu = await ends(env, nightUs, { short: true });
      s.check('ENDS: across midnight (a 10 minute glass from 23:58:10): "Flowing · ends 00:08" (24 hours) and "Flowing · ends 12:08 AM" (12 hours)',
              mn.start.text === 'Flowing · ends 00:08' && mu.start.text === 'Flowing · ends 12:08 AM', mn.start.text + ' / ' + mu.start.text);
      // a work and rest sequence: the end of the phase now running
      var sq = await ends(env, BERLIN, { short: true, save: { durationMs: 120000, restMs: 60000, rounds: 2 } });
      s.check('ENDS: in a work and rest sequence, the end of the phase now running ("Work · 1 of 2 · ends 14:26" for 2 minutes from 14:24:40)',
              sq.start.text === 'Work · 1 of 2 · ends 14:26' && reads(sq.start, 'Work · 1 of 2'), sq.start.text);
      // the switch off: today's words, and the page as it was
      var off = await ends(env, BERLIN, { save: { endsAt: false } }), offOk = ['idle', 'start', 'minute', 'sand', 'flipped', 'resumed'].every(function (k2) {
        return plain(off[k2], k2 === 'idle' ? 'Tap the glass to begin' : 'Flowing');
      }) && plain(off.paused, 'Paused') && plain(off.end, 'Time · flip to begin again');
      s.check('ENDS: with the switch off (the default) the state line is today\'s, word for word, with nothing added to the page, at every step', offOk,
              ['start', 'paused', 'resumed', 'end'].map(function (k2) { return k2 + ' "' + off[k2].text + '" (' + off[k2].kids + ' node)'; }).join(', '));
      // the switch in Tune, while the glass runs
      var sw = await (async function () {
        var t = await env.open({ locale: BERLIN.locale, timezoneId: BERLIN.timezoneId, init: clockInit, initArg: BERLIN.start, storage: { 'hourglass.settings.v1': { durationMs: 600000 } } }), o = {};
        try {
          await sleep(800); await t.page.tap('#btn-play'); await sleep(400);
          o.before = await endState(t);
          await tune.tap(t, '#opt-ends'); await sleep(300);
          o.on = await endState(t); o.savedOn = (await saved(t)).endsAt;
          await tune.tap(t, '#opt-ends'); await sleep(300);
          o.off = await endState(t); o.savedOff = (await saved(t)).endsAt;
        } finally { await t.close(); }
        return o;
      })();
      s.check('ENDS: the switch in Tune, while the glass runs: on shows the end at once and saves true; off takes it away and saves false',
              plain(sw.before, 'Flowing') && reads(sw.on, 'Flowing') && sw.savedOn === true && plain(sw.off, 'Flowing') && sw.savedOff === false,
              '"' + sw.before.text + '" → "' + sw.on.text + '" (' + sw.savedOn + ') → "' + sw.off.text + '" (' + sw.savedOff + ')');
      // a short screen: the state line is not drawn there, nor its end
      var sh = await ends(env, BERLIN, { short: true, open: { viewport: { width: 320, height: 568 } } });
      s.check('ENDS: on a short screen (320 x 568), where the state line is not drawn, the end is not drawn either', sh.start.text === 'Flowing · ends 14:34' && !sh.start.statusDrawn && !sh.start.ends.drawn,
              '"' + sh.start.text + '", the line drawn: ' + sh.start.statusDrawn + ', the end drawn: ' + sh.start.ends.drawn);

      // the controls
      var endsCopy = function (file, change, place) { return function () { return ends(env, place || BERLIN, { open: copy(file, change) }); }; };
      await control('ENDS: a copy that writes the end to the page at every frame', 'minute',
        endsCopy('app.js', swap('    if (text === endsShown && (!text || endsEl.parentNode === statusEl)) return;\n', '')), function (m) { return endsOk(m, BERLIN); });
      await control('ENDS: a copy that works the end out once, as the glass starts', 'sand',
        endsCopy('app.js', swap('    if (min !== endsMin) {', '    if (endsMin !== endsMin) {')), function (m) { return endsOk(m, BERLIN); });
      await control('ENDS: a copy that keeps the end while paused', 'pause',
        endsCopy('app.js', swap("if (!settings.endsAt || T.state !== 'running' ||", "if (!settings.endsAt || (T.state !== 'running' && T.state !== 'paused') ||")), function (m) { return endsOk(m, BERLIN); });
      await control('ENDS: a copy that says the end through the live state line (not hidden from a screen reader)', 'start',
        endsCopy('app.js', swap("  endsEl.setAttribute('aria-hidden', 'true');\n", '')), function (m) { return endsOk(m, BERLIN); });
      await control('ENDS: a copy that always writes 24 hours is wrong in a 12 hour locale', 'start',
        endsCopy('app.js', swap("{ timeStyle: 'short' }", "{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }"), NEW_YORK), function (m) { return endsOk(m, NEW_YORK); });
      await control('ENDS: a style sheet that draws the end in Zen at full strength', 'zen',
        endsCopy('styles.css', add('#app.zen .hud { opacity: 1 !important; }')), function (m) { return endsOk(m, BERLIN); });
      await control('ENDS: a copy that shows the end whatever the switch says', null, function () {
        return ends(env, BERLIN, { save: { endsAt: false }, open: copy('app.js', swap("if (!settings.endsAt || T.state !== 'running'", "if (T.state !== 'running'")) });
      }, function (o2) { return { off: { ok: plain(o2.start, 'Flowing'), detail: '"' + o2.start.text + '"' } }; });
    }
  } catch (e) {
    s.check('the suite ran to its end', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' '));
  }
  await env.close();
  s.done();
})();
