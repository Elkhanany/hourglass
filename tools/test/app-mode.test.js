/*
 * Light and dark, the Zen button and the double-click (1.19.0).
 *
 *   CHOICES   each of the four backgrounds saved (dark, light, system, hours) comes up in its look:
 *             the page's data-look, its theme-color and color-scheme, the renderer's shading, the
 *             moon button's state and name, the Tune row's choice
 *   TUNE      a choice in Tune's Glass tab changes the look at once and is saved; nothing is built
 *             again (the same Sim and Renderer, no cross-fade, no reset)
 *   BUTTON    the moon button turns to the other look and back, saved as a choice of its own
 *             ('light', 'dark'), also from 'system' and from 'hours'; a reload keeps it
 *   OLD       a save from before the background (1.18.0's) comes up dark and saves 'dark'
 *   RESET     "Put the look and sound back as they came" puts the background back to dark
 *   FIRST     the first frame the browser paints is in the look of each choice (a control: the
 *             page without its early script opens a light choice on a dark frame)
 *   SYSTEM    'system' follows the browser's colour scheme, emulated light and dark, also when it
 *             changes while the app is open (a control: without the listener it does not)
 *   HOURS     'hours' by the device's clock on both sides of 7:00 and of 19:00; carried across each
 *             while open, and across a return from the background (controls: without the timer,
 *             without the return)
 *   RUNNING   a running glass keeps its exact time across changes of look
 *   CONTRAST  every text of the page, the bars, the four tabs of Tune and the dial sheet: its colour
 *             against its ground (computed styles), 4.5 to 1 at least in the light look; in the dark
 *             look as it always was (measured; the third ink is under 4.5 there and is left as it
 *             is: the dark look does not change); a control with a paler ink fails
 *   OUTLINE   on white the glass's outline is drawn: a dark line darker than the paper and the bore
 *             on either side of it, on the drawn glass and (in software WebGL) the rendered one;
 *             a control without the light shading fails each
 *   PALE      Moonstone, and a pale custom sand, stand out of the paper in the light look
 *   LAYOUT    Tune's Background row and the dial sheet in the light look at 393 x 852 and
 *             320 x 568: the four choices fit, the line under them shows whole
 *   ZEN       the Zen button is named for the window, with the corner icon (not the moon)
 *   DBL       a double-click of the mouse on the background brings Zen and takes it away, in Full
 *             Zen too; not on the glass, not on a control, not by a finger's double tap, not with a
 *             slow second click; it starts, pauses and turns nothing (controls: an app without the
 *             double-click, one that takes a finger's, one that waits too long)
 *   KEYS      a keyboard alone gets into Zen (the button) and out of it (Escape), Full Zen too; a
 *             mouse alone, by the button and the double-click
 *
 * Pictures of the looks go to $HOURGLASS_SHOTS when it names a folder.
 *
 *   node tools/test/app-mode.test.js [--root <dir>] [--port <n>] [--only NAME,NAME]
 */
'use strict';
var fs = require('fs'), path = require('path');
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;
var KEY = 'hourglass.settings.v1';
var SHOTS = process.env.HOURGLASS_SHOTS || '';
var PAPER = '#f3f0ea', NIGHT = '#0b0c0e';

/* ---- a copy with something changed, for a control ----------------------------------------- */
function routed(env, file, change) {
  var src = fs.readFileSync(path.join(env.root, file), 'utf8'), out = change(src);
  if (out === src) throw new Error('control: nothing changed in ' + file);
  var origin = env.url.replace(/\/$/, '');
  return { url: function (u) { return u.origin === origin && (u.pathname === '/' + file || (file === 'index.html' && u.pathname === '/')); }, handler: function (route) {
    route.fulfill({ status: 200, contentType: /\.css$/.test(file) ? 'text/css' : (/\.html$/.test(file) ? 'text/html' : 'text/javascript'), body: out });
  } };
}

/* ---- the clock: `new Date()` at a given time of day (Date.now and timers untouched) -------- */
function fakeClock(a) {
  var Real = Date, off = 0;
  function at(h, m, s) { var r = new Real(); return new Real(r.getFullYear(), r.getMonth(), r.getDate(), h, m, s).getTime() - r.getTime(); }
  window.__setClock = function (h, m, s) { off = at(h, m, s); };
  window.__setClock(a[0], a[1], a[2]);
  function D() {
    if (!arguments.length) return new Real(Real.now() + off);
    var args = [null].concat(Array.prototype.slice.call(arguments));
    return new (Function.prototype.bind.apply(Real, args))();
  }
  D.prototype = Real.prototype; D.now = Real.now; D.UTC = Real.UTC; D.parse = Real.parse;
  window.Date = D;
}

/* ---- the first frame: what the page is painted in, at the first frame it is drawn ---------- */
function firstFrame() {
  requestAnimationFrame(function () {
    var root = document.documentElement, cs = getComputedStyle(root), veil = document.getElementById('veil');
    var bodyBg = document.body ? getComputedStyle(document.body).backgroundColor : null;
    window.__first = { look: root.getAttribute('data-look'), html: cs.backgroundColor, body: bodyBg,
      veil: veil ? getComputedStyle(veil).backgroundColor : null, veilOp: veil ? getComputedStyle(veil).opacity : null,
      theme: (document.querySelector('meta[name="theme-color"]') || {}).content || null };
  });
}

/* ---- what the page shows of the look ----------------------------------------------------- */
function lookOf(t) {
  return t.eval(function (KEY) {
    var root = document.documentElement, W = window.Hourglass, b = document.getElementById('btn-look');
    var checked = document.querySelector('#looks [aria-checked="true"]');
    var vis = function (sel) { var e = document.querySelector('#btn-look ' + sel); return !!e && getComputedStyle(e).display !== 'none'; };
    var saved = null; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    return {
      look: root.getAttribute('data-look') || 'dark', paper: W.renderer.paper,
      theme: document.querySelector('meta[name="theme-color"]').content, scheme: document.querySelector('meta[name="color-scheme"]').content,
      bar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content,
      bg: getComputedStyle(document.body).backgroundColor,
      pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), moon: vis('.ic-moon'), sun: vis('.ic-sun'),
      choice: checked ? checked.dataset.look : null, saved: saved ? saved.background : undefined
    };
  }, KEY);
}
function lookIs(l, look, choice) {
  var light = look === 'light';
  return l.look === look && l.paper === light && l.theme === (light ? PAPER : NIGHT) && l.scheme === look &&
    l.bar === (light ? 'default' : 'black-translucent') && l.bg === (light ? 'rgb(243, 240, 234)' : 'rgb(11, 12, 14)') &&
    l.pressed === String(light) && l.label === 'Light background' && l.moon === !light && l.sun === light &&
    (choice === undefined || (l.choice === choice && l.saved === choice));
}
function said(l) { return JSON.stringify(l); }

/* ---- contrast: every text against the ground it is drawn on (computed styles) ------------- */
function contrasts(t, scope) {
  return t.eval(function (scope) {
    function parse(c) {
      var m = /rgba?\(([^)]+)\)/.exec(c), v;
      if (m) { v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; }
      m = /color\(srgb ([^)]+)\)/.exec(c);
      if (m) { v = m[1].split(/[ \/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
      return null;
    }
    function over(top, under) { var a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; }
    function lum(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
    function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    var page = parse(getComputedStyle(document.body).backgroundColor);
    function ground(el) {
      var chain = [], e;
      for (e = el; e && e !== document.body; e = e.parentElement) { var b = parse(getComputedStyle(e).backgroundColor); if (b && b[3] > 0) chain.push(b); }
      var g = page.slice();
      for (var i = chain.length - 1; i >= 0; i--) g = over(chain[i], g);
      return g;
    }
    var out = [], all = document.querySelectorAll(scope + ' *'), i;
    for (i = 0; i < all.length; i++) {
      var el = all[i], own = '', k;
      for (k = 0; k < el.childNodes.length; k++) if (el.childNodes[k].nodeType === 3) own += el.childNodes[k].textContent;
      own = own.trim();
      if (!own || !el.getClientRects().length) continue;
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('.vh, [hidden], .edge')) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
      var c = parse(cs.color), g = ground(el), op = 1;
      for (var e2 = el; e2; e2 = e2.parentElement) op *= +getComputedStyle(e2).opacity;
      if (op < 0.99) continue;                   // (a control fading in or out: measured once it has come)
      var shown = over(c, g);
      out.push({ text: own.slice(0, 28), id: el.id || el.className || el.tagName, color: cs.color, ratio: Math.round(ratio(shown, g) * 100) / 100,
                 ink3: /0\.38\)$/.test(cs.color) });
    }
    return out;
  }, scope);
}

/* ---- pixels of the screen (a screenshot, read back in the page) ---------------------------- */
async function pixels(t, clip) {
  var png = await t.page.screenshot({ clip: clip, scale: 'css' });
  return t.eval(function (b64) {
    return new Promise(function (done) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        var g = c.getContext('2d'); g.drawImage(img, 0, 0);
        done({ w: img.width, h: img.height, d: Array.prototype.slice.call(g.getImageData(0, 0, img.width, img.height).data) });
      };
      img.src = 'data:image/png;base64,' + b64;
    });
  }, png.toString('base64'));
}
function L(d, i) { return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; }
/**
 * The glass's outline on a level line through the empty lower bulb, from the bore's middle out
 * past the glass's left edge: the darkest point near the edge, against the bore just inside it and
 * the paper just outside it. -> { dark: how much darker the line is than the lighter of the two, ... }
 */
async function outline(t) {
  var g = await t.glass();
  var y = Math.round(g.top + g.h * 0.70), x0 = Math.max(0, Math.round(g.left - 24)), x1 = Math.round(g.cx);
  var px = await pixels(t, { x: x0, y: y - 1, width: x1 - x0, height: 3 });
  var row = [], x, k;
  for (x = 0; x < px.w; x++) { var s = 0; for (k = 0; k < 3; k++) s += L(px.d, ((k * px.w) + x) * 4); row.push(s / 3); }
  var paper = row.slice(0, 8).reduce(function (a, b) { return a + b; }, 0) / 8;
  // the edge: the darkest point in the outer third of the scan
  var lo = 1e9, at = -1;
  for (x = 8; x < Math.round(px.w * 0.6); x++) if (row[x] < lo) { lo = row[x]; at = x; }
  var inner = row.slice(at + 6, at + 16), bore = inner.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, inner.length);
  return { dark: Math.round(Math.min(paper, bore) - lo), paper: Math.round(paper), bore: Math.round(bore), line: Math.round(lo), at: at + x0 };
}

/* ---- the suite ------------------------------------------------------------------------- */
async function choices(s, env) {
  var rows = [];
  for (var c of ['dark', 'light', 'system', 'hours']) {
    var t = await env.open({ storage: { background: c }, timezoneId: 'UTC', init: fakeClock, initArg: [12, 0, 0] });
    await sleep(500);
    var l = await lookOf(t);
    var want = c === 'dark' ? 'dark' : 'light';          // (system: the browser's scheme, light here; hours: noon)
    rows.push(c + ' ' + (lookIs(l, want, c) ? 'ok' : said(l)));
    await t.close();
  }
  s.check('CHOICES: each of the four saved comes up in its look (dark; light; system in a light browser; hours at noon), the page, its metas, the renderer, the moon button (sun shown in light) and the Tune row as one',
    rows.every(function (r) { return / ok$/.test(r); }), rows.join('; '));
}

async function tuneRow(s, env) {
  var t = await env.open({});
  await sleep(600);
  await t.eval(function () { var W = window.Hourglass; window.__ids = { sim: W.sim, renderer: W.renderer }; window.__resets = 0; var r0 = W.sim.reset; W.sim.reset = function () { window.__resets++; return r0.apply(this, arguments); }; });
  var seen = [];
  for (var c of ['light', 'system', 'hours', 'dark']) {
    await tune.tap(t, '#looks [data-look="' + c + '"]');
    await sleep(150);
    var l = await lookOf(t), quiet = await t.eval(function () {
      var W = window.Hourglass, app = document.getElementById('app');
      return W.sim === window.__ids.sim && W.renderer === window.__ids.renderer && window.__resets === 0 &&
        !app.classList.contains('swap') && !document.getElementById('assembly').classList.contains('fade');
    });
    seen.push(c + ':' + l.look + (quiet ? '' : ' REBUILT') + (l.saved === c ? '' : ' saved ' + l.saved));
  }
  var note = await t.eval(function () { var n = document.getElementById('look-note'), r = n.getBoundingClientRect(); return { text: n.textContent, h: r.height }; });
  s.check('TUNE: Dark, Light, Device and Daytime in the Glass tab change the look at once and are saved; nothing is built again, nothing fades',
    seen.join() === 'light:light,system:light,hours:' + (new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'light' : 'dark') + ',dark:dark', seen.join(', '));
  s.check('TUNE: one plain line under the choices says what Device and Daytime do', /Device/.test(note.text) && /Daytime/.test(note.text) && /7:00/.test(note.text) && note.h > 10, JSON.stringify(note));
  s.check('TUNE: no page errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
  await t.close();
}

async function button(s, env) {
  var t = await env.open({});
  await sleep(500);
  var a = await lookOf(t);
  await t.page.tap('#btn-look'); await sleep(200);
  var b = await lookOf(t);
  await t.reload(); await sleep(400);
  var c = await lookOf(t);
  await t.page.tap('#btn-look'); await sleep(200);
  var d = await lookOf(t);
  s.check('BUTTON: the moon button: dark, a tap light (the sun shown, pressed), kept over a reload, a tap dark again; saved as light, then dark',
    lookIs(a, 'dark', 'dark') && lookIs(b, 'light', 'light') && lookIs(c, 'light', 'light') && lookIs(d, 'dark', 'dark'), [a, b, c, d].map(said).join(' | '));
  await t.close();
  // from 'system' (a dark browser) and from 'hours' (noon): a tap is the other look, as a choice of its own
  var u = await env.open({ storage: { background: 'system' } });
  await u.page.emulateMedia({ colorScheme: 'dark' }); await sleep(300);
  var e = await lookOf(u);
  await u.page.tap('#btn-look'); await sleep(200);
  var f = await lookOf(u);
  await u.close();
  var v = await env.open({ storage: { background: 'hours' }, timezoneId: 'UTC', init: fakeClock, initArg: [12, 0, 0] });
  await sleep(400);
  var g = await lookOf(v);
  await v.page.tap('#btn-look'); await sleep(200);
  var h = await lookOf(v);
  await v.close();
  s.check('BUTTON: from Device in a dark browser a tap gives light, and from Daytime at noon a tap gives dark, each kept as a choice of its own',
    lookIs(e, 'dark', 'system') && lookIs(f, 'light', 'light') && lookIs(g, 'light', 'hours') && lookIs(h, 'dark', 'dark'), [e, f, g, h].map(said).join(' | '));
}

async function oldSave(s, env) {
  var save = { v: 2, realSand: false, theme: 'lapis', sand: 'lapis', finish: 'brass', volume: 0.4, quick: '2,5,10,15,30,60', endsAt: true, tuneTab: 'glass' };
  var t = await env.open({ rawStorage: { 'hourglass.settings.v1': save } });
  await sleep(500);
  var l = await lookOf(t), kept = await t.eval(function (KEY) { var v = JSON.parse(localStorage.getItem(KEY)); return [v.sand, v.finish, v.volume, v.quick, v.endsAt, v.tuneTab].join(); }, KEY);
  s.check('OLD: a save from before the background (1.18.0) comes up dark and saves \'dark\', every other setting as it was', lookIs(l, 'dark', 'dark') && kept === 'lapis,brass,0.4,2,5,10,15,30,60,true,glass', said(l) + ' ' + kept);
  await t.close();
}

async function reset(s, env) {
  var t = await env.open({ storage: { background: 'light', sand: 'garnet' } });
  await sleep(500);
  var a = await lookOf(t);
  await tune.tap(t, '#tune-reset'); await sleep(600);
  await tune.tap(t, '#tune-reset'); await sleep(900);
  var b = await lookOf(t);
  s.check('RESET: "Put the look and sound back as they came" puts the light background back to dark, saved', lookIs(a, 'light', 'light') && lookIs(b, 'dark', 'dark'), said(a) + ' → ' + said(b));
  await t.close();
}

async function first(s, env) {
  var rows = [], ok = true;
  async function one(choice, scheme, hour, want, routes) {
    var t = await env.open({ storage: { background: choice }, timezoneId: 'UTC', init: fakeClock, initArg: [hour, 0, 0], routes: routes });
    if (scheme) await t.page.emulateMedia({ colorScheme: scheme });
    await t.context.addInitScript(firstFrame);
    await t.reload();
    var f = await t.eval(function () { return window.__first; });
    await t.close();
    var bg = want === 'light' ? 'rgb(243, 240, 234)' : 'rgb(11, 12, 14)';
    var good = !!f && f.html === bg && (f.body === null || f.body === bg) && (f.veil === null || f.veil === 'rgba(0, 0, 0, 0)' || f.veil === bg) &&
      (want === 'light' ? f.look === 'light' && f.theme === PAPER : f.look === null && f.theme === NIGHT);
    return { good: good, said: choice + (scheme ? ' (' + scheme + ')' : '') + (choice === 'hours' ? ' at ' + hour + ':00' : '') + ' → ' + JSON.stringify(f) };
  }
  var cases = [['dark', null, 12, 'dark'], ['light', null, 12, 'light'], ['system', 'light', 12, 'light'], ['system', 'dark', 12, 'dark'], ['hours', null, 12, 'light'], ['hours', null, 22, 'dark']];
  for (var c of cases) { var r = await one(c[0], c[1], c[2], c[3]); rows.push(r.said); ok = ok && r.good; }
  s.check('FIRST: the first frame painted is in the look of each choice (dark; light; Device in a light and a dark browser; Daytime at noon and at 22:00): the page, the veil and the theme-color', ok, rows.join(' | '));
  var noEarly = routed(env, 'index.html', function (src) { return src.replace(/<script>\s*\(function \(\) \{\s*try \{\s*var s = JSON\.parse[\s\S]*?<\/script>/, ''); });
  var ctl = await one('light', null, 12, 'light', [noEarly]);
  s.check('... and the page without its early script opens a light choice on a dark first frame (control)', !ctl.good, ctl.said);
}

async function system(s, env, routes) {
  var t = await env.open({ storage: { background: 'system' }, routes: routes });
  var seq = [];
  for (var sc of ['light', 'dark', 'light']) { await t.page.emulateMedia({ colorScheme: sc }); await sleep(250); seq.push((await lookOf(t)).look); }
  await t.close();
  return seq.join();
}

async function systemCase(s, env) {
  var seq = await system(s, env);
  s.check('SYSTEM: Device follows the browser\'s colour scheme as it changes while the app is open: light, dark, light again', seq === 'light,dark,light', seq);
  var deaf = routed(env, 'app.js', function (src) { return src.replace("if (schemeQ.addEventListener) schemeQ.addEventListener('change', onScheme); else if (schemeQ.addListener) schemeQ.addListener(onScheme);", ''); });
  var ctl = await system(s, env, [deaf]);
  s.check('... and an app that does not listen for the change stays as it opened (control)', ctl !== 'light,dark,light', ctl);
}

async function hoursAt(env, h, m, sec, routes) {
  var t = await env.open({ storage: { background: 'hours' }, timezoneId: 'UTC', init: fakeClock, initArg: [h, m, sec], routes: routes });
  await sleep(300);
  return t;
}
async function hoursCase(s, env) {
  var rows = [], ok = true, t, a, b;
  // both sides of each boundary, at the launch
  for (var c of [[6, 59, 0, 'dark'], [7, 0, 30, 'light'], [18, 59, 0, 'light'], [19, 0, 30, 'dark'], [0, 30, 0, 'dark'], [12, 0, 0, 'light']]) {
    t = await hoursAt(env, c[0], c[1], c[2]);
    a = await lookOf(t); await t.close();
    rows.push(c[0] + ':' + String(c[1]).padStart(2, '0') + ' ' + a.look); ok = ok && a.look === c[3] && lookIs(a, c[3], 'hours');
  }
  s.check('HOURS: Daytime by the device\'s clock: dark at 6:59 and 19:00:30 and 0:30, light at 7:00:30, 18:59 and noon', ok, rows.join(', '));
  // carried across each boundary while open
  async function across(h, m, sec, routes) {
    var u = await hoursAt(env, h, m, sec, routes), x = (await lookOf(u)).look;
    var left = await u.eval(function () { var n = new Date(), b = new Date(n.getTime()); b.setMinutes(60, 0, 0); return b.getTime() - n.getTime(); });
    await sleep(left + 900);
    var y = (await lookOf(u)).look; await u.close();
    return x + '→' + y;
  }
  var morning = await across(6, 59, 48), evening = await across(18, 59, 48);
  s.check('HOURS: while the app is open the look turns at 7:00 (dark to light) and at 19:00 (light to dark)', morning === 'dark→light' && evening === 'light→dark', 'from 6:59:48 ' + morning + ', from 18:59:48 ' + evening);
  var noTimer = routed(env, 'app.js', function (src) { return src.replace('lookTimer = setTimeout(showLook, ', 'lookTimer = 0 && setTimeout(showLook, '); });
  var ctl1 = await across(18, 59, 48, [noTimer]);
  s.check('... and an app without the timer stays light past 19:00 (control)', ctl1 !== 'light→dark', ctl1);
  // across a return from the background: the clock moved on while the page was hidden (a phone's timers sleep)
  async function back(h0, h1, routes) {
    var u = await hoursAt(env, h0, 0, 0, routes), x = (await lookOf(u)).look;
    await u.eval(function (h) {
      var hid = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return hid; } });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return hid ? 'hidden' : 'visible'; } });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__setClock(h, 30, 0);
      hid = false;
      document.dispatchEvent(new Event('visibilitychange'));
    }, h1);
    await sleep(200);
    var y = (await lookOf(u)).look; await u.close();
    return x + '→' + y;
  }
  var night = await back(18, 19), day = await back(6, 7);
  s.check('HOURS: back from the background with the clock past the hour, the look is the hour\'s at once (18:00 light → 19:30 dark; 6:00 dark → 7:30 light)', night === 'light→dark' && day === 'dark→light', night + ', ' + day);
  var noReturn = routed(env, 'app.js', function (src) {
    return src.replace("document.addEventListener('visibilitychange', function () { if (!document.hidden && settings.background === 'hours') showLook(); });", '')
              .replace("window.addEventListener('focus', function () { if (settings.background === 'hours') showLook(); });", '');
  });
  var ctl2 = await back(18, 19, [noReturn]);
  s.check('... and an app that does not look again on its return stays light (control)', ctl2 !== 'light→dark', ctl2);
}

async function running(s, env) {
  var t = await env.open({});
  await sleep(600);
  await t.eval(function () { window.Hourglass.setDuration(60000); });
  await sleep(2600);
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(1500);
  function now() {
    return t.eval(function () {
      var W = window.Hourglass, T = W.timer, n = Date.now();
      return { state: T.state, rem: T.state === 'running' ? T.rem - (n - T.lastTick) : T.rem, at: n, sim: W.sim.total, top: W.sim.nTop };
    });
  }
  var a = await now(), worst = 0, states = [];
  for (var i = 0; i < 4; i++) {
    await t.page.tap('#btn-look');
    await sleep(400);
    var b = await now();
    var drift = Math.abs((a.rem - (b.at - a.at)) - b.rem);
    worst = Math.max(worst, drift); states.push(b.state);
  }
  s.check('RUNNING: four changes of look while a glass runs: it runs on, its time exactly the wall clock\'s (within 40 ms)', worst <= 40 && states.every(function (x) { return x === 'running'; }),
    'worst ' + Math.round(worst) + ' ms; ' + states.join(','));
  s.check('RUNNING: no page errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
  await t.close();
}

async function contrast(s, env) {
  async function measure(look, routes, size) {
    var t = await env.open({ storage: { background: look, endsAt: true }, viewport: size || { width: 393, height: 852 }, routes: routes });
    await sleep(700);
    var out = await contrasts(t, '#app');            // the bars
    await t.eval(function () { window.Hourglass.setDuration(60000); });
    await sleep(2600);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1600);
    out = out.concat(await contrasts(t, '#hud-top'));   // the state line while it runs
    for (var tab of ['sand', 'glass', 'sound', 'time']) {
      await tune.tap(t, '#tune-tabs [data-tab="' + tab + '"]');
      await sleep(500);
      out = out.concat((await contrasts(t, '#sheet-settings')).map(function (x) { x.where = tab; return x; }));
    }
    await tune.close(t);
    await t.page.tap('#pill-custom'); await sleep(900);
    out = out.concat((await contrasts(t, '#sheet-custom')).map(function (x) { x.where = 'dial'; return x; }));
    await t.close();
    return out;
  }
  var light = await measure('light'), small = await measure('light', null, { width: 320, height: 568 }), dark = await measure('dark');
  var low = light.concat(small).filter(function (x) { return x.ratio < 4.5; });
  var lmin = Math.min.apply(null, light.concat(small).map(function (x) { return x.ratio; }));
  s.check('CONTRAST: in the light look every text of the bars, the state line, all four tabs of Tune and the dial sheet stands 4.5 to 1 or more against its ground (' + light.length + ' at 393 x 852, ' + small.length + ' at 320 x 568; the lowest ' + lmin + ')',
    light.length >= 40 && low.length === 0, low.slice(0, 6).map(function (x) { return x.where + ' "' + x.text + '" ' + x.ratio; }).join('; '));
  var dlow = dark.filter(function (x) { return x.ratio < 4.5 && !x.ink3; }), d3 = dark.filter(function (x) { return x.ink3; });
  s.check('CONTRAST: in the dark look every text in the first two inks stands 4.5 to 1 or more (the third ink, quieter, measured: unchanged from before)',
    dark.length >= 40 && dlow.length === 0, dlow.slice(0, 6).map(function (x) { return x.where + ' "' + x.text + '" ' + x.ratio; }).join('; ') ||
    'third ink: ' + (d3.length ? Math.min.apply(null, d3.map(function (x) { return x.ratio; })) + ' to ' + Math.max.apply(null, d3.map(function (x) { return x.ratio; })) : 'none'));
  var pale = routed(env, 'styles.css', function (src) { return src.replace('--ink-3: rgba(31, 29, 26, 0.68);', '--ink-3: rgba(31, 29, 26, 0.45);'); });
  var ctl = await measure('light', [pale]);
  s.check('... and a light look with a paler third ink falls under 4.5 to 1 (control)', ctl.some(function (x) { return x.ratio < 4.5; }),
    ctl.filter(function (x) { return x.ratio < 4.5; }).length + ' texts under');
}

async function outlineCase(s, env, label, opts) {
  var t = await env.open(Object.assign({ storage: { background: 'light', frame: false } }, opts || {}));
  await sleep(1200);
  var o = await outline(t);
  await t.close();
  return o;
}
async function outlines(s, env) {
  var o = await outlineCase(s, env), d = await outlineCase(s, env, null, { storage: { background: 'dark', frame: false } });
  s.check('OUTLINE: on white the drawn glass has its outline: a line ' + o.dark + ' levels darker than the paper and the bore beside it (paper ' + o.paper + ', bore ' + o.bore + ', line ' + o.line + ')',
    o.dark >= 25 && o.paper > 200, JSON.stringify(o) + '; the dark look: ' + JSON.stringify(d));
  var flat = routed(env, 'glass/renderer.js', function (src) { return src.replace('if (drawn && this.paper) tint = PAPER_INK;', ''); });
  var c = await outlineCase(s, env, null, { routes: [flat] });
  s.check('... and without the light shading the drawn glass\'s outline is lost on white (control)', c.dark < 25, JSON.stringify(c));
}

async function webglOutline(s, root, port) {
  var env = await H.start({ webgl: true, port: port, root: root });
  try {
    var has = await (async function () { var t = await env.open({}); var g = await t.eval(function () { return !!window.Hourglass.renderer.glass; }); await t.close(); return g; })();
    if (!has) { s.skip('OUTLINE (WebGL): the rendered glass', 'no WebGL here'); return; }
    var o = await outlineCase(s, env);
    s.check('OUTLINE (WebGL): on white the rendered glass shows its edge by a dark line ' + o.dark + ' levels darker than the paper and the bore (paper ' + o.paper + ', bore ' + o.bore + ', line ' + o.line + ')',
      o.dark >= 25 && o.paper > 200, JSON.stringify(o));
    var room = routed(env, 'glass/gl.js', function (src) { return src.replace('paper ? GLASS_FS_ROOM_PAPER : GLASS_FS_ROOM', 'GLASS_FS_ROOM'); });
    var c = await outlineCase(s, env, null, { routes: [room] });
    s.check('... and the rendered glass lit by the dark room on white loses that line (control)', c.dark < 25, JSON.stringify(c));
    if (SHOTS) {
      for (var look of ['dark', 'light']) {
        var t = await env.open({ storage: { background: look }, viewport: { width: 393, height: 852 } });
        await sleep(1500);
        await t.page.screenshot({ path: path.join(SHOTS, 'mode-webgl-' + look + '.png') });
        await t.close();
      }
    }
  } finally { await env.close(); }
}

async function paleSand(s, env) {
  async function one(storage, routes) {
    var t = await env.open({ storage: Object.assign({ background: 'light', durationMs: 3600000 }, storage), routes: routes });
    await sleep(900);
    var g = await t.glass();
    // the bed in the upper bulb (idle: a full glass), and the paper to its left
    var bed = await pixels(t, { x: Math.round(g.cx - g.w * 0.12), y: Math.round(g.top + g.h * 0.30), width: Math.round(g.w * 0.24), height: Math.round(g.h * 0.06) });
    var paper = await pixels(t, { x: Math.max(2, Math.round(g.left - 18)), y: Math.round(g.top + g.h * 0.30), width: 10, height: Math.round(g.h * 0.06) });
    await t.close();
    function mean(p) { var r = 0, gg = 0, b = 0, n = p.d.length / 4; for (var i = 0; i < p.d.length; i += 4) { r += p.d[i]; gg += p.d[i + 1]; b += p.d[i + 2]; } return [r / n, gg / n, b / n]; }
    function lumOf(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
    var a = mean(bed), b = mean(paper), ra = lumOf(a), rb = lumOf(b);
    return { ratio: Math.round((Math.max(ra, rb) + 0.05) / (Math.min(ra, rb) + 0.05) * 100) / 100, sand: a.map(Math.round), paper: b.map(Math.round) };
  }
  var moon = await one({ sand: 'moonstone', theme: 'moonstone' }), custom = await one({ sand: 'custom', sandColor: '45,0.2,0.97' });
  s.check('PALE: on paper Moonstone and a very pale custom sand stand out of the ground (their bed against the paper beside the glass: ' + moon.ratio + ' and ' + custom.ratio + ' to 1)',
    moon.ratio >= 1.3 && custom.ratio >= 1.3, JSON.stringify({ moonstone: moon, custom: custom }));
  // control: the same measure against a ground painted the sand's own colour finds no difference
  var same = routed(env, 'styles.css', function (src) { return src.replace('--bg: #f3f0ea;', '--bg: rgb(' + moon.sand.join(',') + ');').replace(/radial-gradient\(120% 90% at 50% 50%, #fbf9f5 0%, #f3f0ea 58%, #e9e4db 100%\)/, 'rgb(' + moon.sand.join(',') + ')'); });
  var ctl = await one({ sand: 'moonstone', theme: 'moonstone' }, [same]);
  s.check('... and the same measure finds no difference on a ground of the sand\'s own colour (control)', ctl.ratio < 1.3, JSON.stringify(ctl));
}

async function layout(s, env) {
  var rows = [], ok = true;
  for (var size of [{ width: 393, height: 852 }, { width: 320, height: 568 }]) {
    var t = await env.open({ storage: { background: 'light' }, viewport: size });
    await sleep(500);
    await tune.show(t, '#looks', { block: 'center' });
    await sleep(400);
    var m = await t.eval(function () {
      var g = document.getElementById('looks'), bs = g.querySelectorAll('button'), r = g.getBoundingClientRect(), n = document.getElementById('look-note').getBoundingClientRect();
      var fit = Array.prototype.every.call(bs, function (b) { var q = b.getBoundingClientRect(); return b.scrollWidth <= b.clientWidth + 1 && q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.height >= 44; });
      var one = Array.prototype.every.call(bs, function (b) { return b.getBoundingClientRect().top === bs[0].getBoundingClientRect().top; });
      var body = document.querySelector('#sheet-settings .sheet-body').getBoundingClientRect();
      return { n: bs.length, fit: fit, oneRow: one, words: Array.prototype.map.call(bs, function (b) { return b.textContent; }).join(','), noteWhole: n.left >= body.left && n.right <= body.right + 0.5 && n.height > 10,
               page: document.documentElement.scrollWidth <= innerWidth };
    });
    if (SHOTS) await t.page.screenshot({ path: path.join(SHOTS, 'mode-tune-glass-light-' + size.width + '.png') });
    await tune.close(t);
    await t.page.tap('#pill-custom'); await sleep(900);
    var dial = await t.eval(function () {
      var sh = document.getElementById('sheet-custom'), r = sh.getBoundingClientRect(), w = document.getElementById('wheel-min').getBoundingClientRect(), set = document.getElementById('custom-set').getBoundingClientRect();
      return { inView: r.top >= 0 && r.bottom <= innerHeight + 1, wheel: w.height > 100, set: set.bottom <= innerHeight + 1, bg: getComputedStyle(sh).backgroundColor };
    });
    if (SHOTS) await t.page.screenshot({ path: path.join(SHOTS, 'mode-dial-light-' + size.width + '.png') });
    await t.close();
    var good = m.n === 4 && m.fit && m.oneRow && m.words === 'Dark,Light,Device,Daytime' && m.noteWhole && m.page && dial.inView && dial.wheel && dial.set && /^rgba\(250, 248, 244/.test(dial.bg);
    ok = ok && good;
    rows.push(size.width + ' x ' + size.height + ': ' + JSON.stringify(m) + ' dial ' + JSON.stringify(dial));
  }
  s.check('LAYOUT: in the light look at 393 x 852 and 320 x 568 the Background row holds its four choices in one row, each whole and a finger tall, the line under them whole; the dial sheet in view on its paper sheet', ok, rows.join(' | '));
}

async function zenButton(s, env) {
  var t = await env.open({});
  var z = await t.eval(function () {
    var b = document.getElementById('btn-zen'), p = b.querySelector('svg path');
    return { label: b.getAttribute('aria-label'), d: p.getAttribute('d'), fill: getComputedStyle(p).fill, sw: getComputedStyle(b.querySelector('svg')).strokeWidth,
             box: b.querySelector('svg').getAttribute('viewBox'), moonPath: document.querySelector('#btn-look .ic-moon path').getAttribute('d') };
  });
  await t.close();
  s.check('ZEN: the Zen button is "Zen: let the glass fill the window" (not the screen), drawn as four outward corners in the top bar\'s style (24 x 24, the same stroke, no fill), and the moon is the background\'s',
    z.label === 'Zen: let the glass fill the window' && !/screen/.test(z.label) && /^M4\.6 9\.2V4\.6h4\.6M14\.8 4\.6h4\.6v4\.6M19\.4 14\.8v4\.6h-4\.6M9\.2 19\.4H4\.6v-4\.6$/.test(z.d) &&
    z.d !== z.moonPath && z.fill === 'none' && z.sw === '1.6px' && z.box === '0 0 24 24', JSON.stringify(z));
}

/* ---- the double-click ------------------------------------------------------------------- */
function zenOf(t) {
  return t.eval(function () {
    var W = window.Hourglass, app = document.getElementById('app');
    return { zen: app.classList.contains('zen'), full: app.classList.contains('zen-full'), state: W.timer.state, angle: W.sim.angle, px: Math.round(W.body.px * 100) / 100, py: Math.round(W.body.py * 100) / 100 };
  });
}
async function bg(t) { var g = await t.glass(); return { x: Math.max(8, Math.round(g.left / 2)), y: Math.round(g.cy + g.h * 0.1) }; }
async function dblRun(env, opts, act) {
  var t = await env.open(Object.assign({ viewport: { width: 1280, height: 800 } }, opts || {}));
  await sleep(700);
  try { return await act(t); } finally { await t.close(); }
}
async function dbl(s, env) {
  // into Zen and out of it, by the mouse on the background, nothing else changed
  var r1 = await dblRun(env, {}, async function (t) {
    var p = await bg(t), a = await zenOf(t);
    await t.page.mouse.dblclick(p.x, p.y); await sleep(300);
    var b = await zenOf(t);
    await sleep(1800);                                   // settled: the dim controls take no clicks
    await t.page.mouse.dblclick(p.x, p.y); await sleep(300);
    var c = await zenOf(t);
    return { a: a, b: b, c: c, errors: t.errors.slice() };
  });
  var same = function (x, y) { return x.state === y.state && x.angle === y.angle && x.px === y.px && x.py === y.py; };
  s.check('DBL: a double-click of the mouse on the background brings Zen, and another takes it away; the glass is not started, paused, moved or turned',
    !r1.a.zen && r1.b.zen && !r1.c.zen && same(r1.a, r1.b) && same(r1.a, r1.c) && r1.a.state === 'idle' && r1.errors.length === 0, JSON.stringify(r1));
  // Full Zen: every control hidden, the double-click still takes it away
  var r2 = await dblRun(env, { storage: { zenFull: true } }, async function (t) {
    var p = await bg(t);
    await t.page.mouse.dblclick(p.x, p.y); await sleep(2000);
    var b = await zenOf(t), hud = await t.eval(function () { return getComputedStyle(document.getElementById('hud-top')).opacity; });
    await t.page.mouse.dblclick(30, 400); await sleep(300);
    var c = await zenOf(t);
    return { b: b, hud: hud, c: c };
  });
  s.check('DBL: in Full Zen (every control hidden) a double-click anywhere off the glass takes it away again', r2.b.zen && r2.b.full && r2.hud === '0' && !r2.c.zen, JSON.stringify(r2));
  // not on the glass, not on a control
  var r3 = await dblRun(env, {}, async function (t) {
    var g = await t.glass();
    await t.page.mouse.dblclick(g.cx, g.cy + g.h * 0.2); await sleep(900);
    var onGlass = await zenOf(t);
    var m = await t.page.$eval('#btn-mute', function (e) { var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await t.page.mouse.dblclick(m.x, m.y); await sleep(300);
    var onMute = await zenOf(t);
    var pl = await t.page.$eval('#durations .pill[data-quick="1"]', function (e) { var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await t.page.mouse.dblclick(pl.x, pl.y); await sleep(1500);
    var onPill = await zenOf(t);
    return { onGlass: onGlass, onMute: onMute, onPill: onPill };
  });
  s.check('DBL: a double-click on the glass, on a button of the top bar or on a pill is not Zen', !r3.onGlass.zen && !r3.onMute.zen && !r3.onPill.zen, JSON.stringify(r3));
  // not with a slow second click, not by a finger
  var r4 = await dblRun(env, {}, async function (t) {
    var p = await bg(t);
    await t.page.mouse.click(p.x, p.y); await sleep(750); await t.page.mouse.click(p.x, p.y); await sleep(300);
    var slow = await zenOf(t);
    await t.touch.tap(p.x, p.y, 40); await sleep(90); await t.touch.tap(p.x, p.y, 40); await sleep(400);
    var finger = await zenOf(t);
    return { slow: slow, finger: finger };
  });
  s.check('DBL: two clicks 0.75 s apart are two single clicks (no Zen), and a finger\'s double tap on the background brings no Zen', !r4.slow.zen && !r4.finger.zen && r4.slow.state === 'idle', JSON.stringify(r4));
  // controls
  var noDbl = routed(env, 'app.js', function (src) { return src.replace("window.addEventListener('pointerup', function (e) {\n    var d = dblDown", "window.addEventListener('pointerup-none', function (e) {\n    var d = dblDown"); });
  var c1 = await dblRun(env, { routes: [noDbl] }, async function (t) { var p = await bg(t); await t.page.mouse.dblclick(p.x, p.y); await sleep(300); return zenOf(t); });
  s.check('... and an app without the double-click is not in Zen after one (control)', !c1.zen, JSON.stringify(c1));
  var anyFinger = routed(env, 'app.js', function (src) {
    return src.split("e.pointerType !== 'mouse' && e.pointerType !== 'pen'").join('false').split("(e.pointerType !== 'mouse' && e.pointerType !== 'pen')").join('false');
  });
  var c2 = await dblRun(env, { routes: [anyFinger] }, async function (t) { var p = await bg(t); await t.touch.tap(p.x, p.y, 40); await sleep(90); await t.touch.tap(p.x, p.y, 40); await sleep(400); return zenOf(t); });
  s.check('... and an app that takes a finger\'s double tap too is in Zen after one (control)', c2.zen, JSON.stringify(c2));
  var slowOk = routed(env, 'app.js', function (src) { return src.replace('var DBL = { ms: 500, px: 8 };', 'var DBL = { ms: 2000, px: 8 };'); });
  var c3 = await dblRun(env, { routes: [slowOk] }, async function (t) { var p = await bg(t); await t.page.mouse.click(p.x, p.y); await sleep(750); await t.page.mouse.click(p.x, p.y); await sleep(300); return zenOf(t); });
  s.check('... and an app that waits 2 s for the second click takes the slow pair for a double-click (control)', c3.zen, JSON.stringify(c3));
}

async function keys(s, env) {
  // a keyboard alone: Tab to the Zen button, Enter; Escape leaves; Full Zen the same
  var r = await dblRun(env, { storage: { zenFull: true } }, async function (t) {
    var steps = 0, f = '';
    for (; steps < 12 && f !== 'btn-zen'; steps++) { await t.page.keyboard.press('Tab'); f = await t.eval(function () { return document.activeElement && document.activeElement.id; }); }
    await t.page.keyboard.press('Enter'); await sleep(2000);
    var inn = await zenOf(t);
    await t.page.keyboard.press('Escape'); await sleep(300);
    var out = await zenOf(t);
    return { tabs: steps, reached: f, inn: inn, out: out };
  });
  s.check('KEYS: a keyboard alone reaches the Zen button by Tab (' + r.tabs + ' presses), Enter brings Full Zen, Escape leaves it', r.reached === 'btn-zen' && r.inn.zen && r.inn.full && !r.out.zen, JSON.stringify(r));
  // a mouse alone: the button in, the double-click out
  var m = await dblRun(env, {}, async function (t) {
    var b = await t.page.$eval('#btn-zen', function (e) { var q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
    await t.page.mouse.click(b.x, b.y); await sleep(2000);
    var inn = await zenOf(t), p = await bg(t);
    await t.page.mouse.dblclick(p.x, p.y); await sleep(300);
    var out = await zenOf(t);
    return { inn: inn, out: out };
  });
  s.check('KEYS: a mouse alone: the Zen button brings Zen, a double-click on the background takes it away', m.inn.zen && !m.out.zen, JSON.stringify(m));
}

async function pictures(env) {
  if (!SHOTS) return;
  for (var look of ['dark', 'light']) {
    var t = await env.open({ storage: { background: look }, viewport: { width: 393, height: 852 } });
    await sleep(800);
    await t.page.screenshot({ path: path.join(SHOTS, 'mode-2d-' + look + '.png') });
    await t.close();
  }
}

(async function main() {
  var s = new H.Suite('app-mode');
  var env = await H.start();
  var only = env.args.only ? env.args.only.split(',') : null;
  var want = function (n) { return !only || only.indexOf(n) >= 0; };
  try {
    if (want('CHOICES')) await choices(s, env);
    if (want('TUNE')) await tuneRow(s, env);
    if (want('BUTTON')) await button(s, env);
    if (want('OLD')) await oldSave(s, env);
    if (want('RESET')) await reset(s, env);
    if (want('FIRST')) await first(s, env);
    if (want('SYSTEM')) await systemCase(s, env);
    if (want('HOURS')) await hoursCase(s, env);
    if (want('RUNNING')) await running(s, env);
    if (want('CONTRAST')) await contrast(s, env);
    if (want('OUTLINE')) await outlines(s, env);
    if (want('PALE')) await paleSand(s, env);
    if (want('LAYOUT')) await layout(s, env);
    if (want('ZEN')) await zenButton(s, env);
    if (want('DBL')) await dbl(s, env);
    if (want('KEYS')) await keys(s, env);
    await pictures(env);
  } catch (e) {
    s.check('the suite ran to its end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    await env.close();
  }
  if (want('OUTLINE')) {
    try { await webglOutline(s, env.root, env.port); }
    catch (e) { s.check('OUTLINE (WebGL) ran', false, String(e && e.message)); }
  }
  s.done();
})();
