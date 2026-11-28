/*
 * Light and dark, the Zen button and the double-click (1.19.0).
 *
 *   CHOICES   each of the four backgrounds saved (dark, light, system, hours) comes up in its look:
 *             the page's data-look, its theme-color and color-scheme, the renderer's shading, the
 *             moon button's state and name, the Tune row's choice
 *   TUNE      a choice in Tune's Glass tab changes the look and is saved; nothing is built again
 *             (the same Sim and Renderer, the glass not swapped out, no reset)
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

/* ---- every wait has an end, and what comes back from a page is small ---------------------- */
// A question to a page (page.evaluate) has no time limit of its own, and every value of an answer
// costs Playwright's protocol about 5 µs and 200 bytes of this process's memory while it crosses
// (the glass's two drawn canvases, 19 million numbers, 100 s and over 3 GB a time, ten times in
// FADE). Here each question ends after ASK_MS with an error that says which it was, and an answer
// of more than ANSWER_MAX values is refused in the page (lib/ask.js, which the harness's t.eval
// uses too); pixels are kept and measured in the page (pixels(), below). The case fails by name
// (run(), in main).
var ASK = require('./lib/ask.js');
var ASK_MS = ASK.ASK_MS, ANSWER_MAX = ASK.ANSWER_MAX, RSS_MAX_MB = 1000;
var within = ASK.within, smallAnswer = ASK.smallAnswer;
var OPEN = [];                      // the pages a case has open (closed for it if it fails)
/** A page whose every question has an end and a small answer. */
function bounded(t) {
  var page = t.page, ask = page.evaluate.bind(page), close = t.close;
  page.evaluate = function (fn, arg) {
    var what = 'a page was asked (' + String(fn).replace(/\s+/g, ' ').slice(0, 72) + ' ...)';
    // (a function goes as text, called in the page by smallAnswer; its argument is plain data)
    var q = typeof fn !== 'function' ? fn :
      '(' + String(smallAnswer) + ')((' + String(fn) + '), ' + (arg === undefined ? 'undefined' : JSON.stringify(arg)) + ', ' + ANSWER_MAX + ')';
    return within(ASK_MS, what, ask(q)).catch(function (e) {
      var said = String(e && e.message || e).split('\n')[0];
      throw new Error(said.indexOf(what) === 0 ? said : what + ': ' + said);
    });
  };
  t.close = function () {
    if (OPEN.indexOf(t) >= 0) OPEN.splice(OPEN.indexOf(t), 1);
    return within(ASK_MS, 'a page was closed', close());
  };
  OPEN.push(t);
  return t;
}
/** env.open with `storage` the settings to save (under the app's key, over a version-3 save with Real sand off). */
function opn(env, o) {
  o = Object.assign({}, o || {});
  if (o.storage) { var st = {}; st[KEY] = o.storage; o.storage = st; }
  return within(2 * ASK_MS, 'a page of the app was opened', env.open(o)).then(bounded);
}

var KEY = 'hourglass.settings.v1';
// Daytime is by the device's own clock, never UTC's: its cases open in a zone nine hours from UTC
// (no summer time), where the UTC hour is on the other side of 7:00 and 19:00 at noon and at 18:00
var ZONE = 'Asia/Tokyo';
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
/** Until a change of look has faded in (1.20.1: about a third of a second); the look once it has. */
async function settled(t) {
  await t.page.waitForFunction(function () { return !document.documentElement.classList.contains('look-fade'); }, null, { timeout: 5000 }).catch(function () {
    throw new Error('settled: a change of look was still fading after 5 s (html.look-fade)');
  });
}
async function lookOf(t) {
  await settled(t);
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

/* ---- pixels of the screen (a screenshot, read back in the page and measured there) --------- */
/**
 * The screen's pixels within `clip`, kept in the page as window.__px[name] ({ w, h, d }). They
 * are measured where they are, by the measures below and each case's own, and only the measure
 * comes back (here, the picture's size): a screen's worth of numbers does not cross to Node (a
 * whole one is 1.3 million; what each costs is said at layers()).
 */
async function pixels(t, clip, name) {
  var png = await t.page.screenshot({ clip: clip, scale: 'css' });
  return t.eval(function (a) {
    return new Promise(function (done, fail) {
      var img = new Image(), late = setTimeout(function () { fail(new Error('pixels: the screenshot "' + a.name + '" was not read back within 10 s')); }, 10000);
      img.onload = function () {
        clearTimeout(late);
        var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        var g = c.getContext('2d'); g.drawImage(img, 0, 0);
        (window.__px = window.__px || {})[a.name] = { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
        done({ w: img.width, h: img.height });
      };
      img.onerror = function () { clearTimeout(late); fail(new Error('pixels: the screenshot "' + a.name + '" could not be read back')); };
      img.src = 'data:image/png;base64,' + a.b64;
    });
  }, { name: name, b64: png.toString('base64') });
}
/** The mean colour of a kept picture: [r, g, b]. */
function meanOf(t, name) {
  return t.eval(function (name) {
    var d = window.__px[name].d, r = [0, 0, 0], n = d.length / 4;
    for (var i = 0; i < d.length; i += 4) { r[0] += d[i]; r[1] += d[i + 1]; r[2] += d[i + 2]; }
    return r.map(function (v) { return v / n; });
  }, name);
}
/** A kept picture's size, a hash of its pixels (FNV-1a over them as 32-bit words) and their sum: two that agree in all are the same to the pixel. */
function printOf(t, name) {
  return t.eval(function (name) {
    var p = window.__px[name], w = new Uint32Array(p.d.buffer), h = 2166136261 >>> 0, sum = 0, i;
    for (i = 0; i < w.length; i++) { h ^= w[i]; h = Math.imul(h, 16777619) >>> 0; }
    for (i = 0; i < p.d.length; i++) sum += p.d[i];
    return { w: p.w, h: p.h, hash: h, sum: sum };
  }, name);
}
/** How far two kept pictures are apart: the mean difference of a colour channel, in levels (alpha left out). */
function apart(t, a, b) {
  return t.eval(function (n) {
    var p = window.__px[n.a].d, q = window.__px[n.b].d, s2 = 0;
    for (var i = 0; i < p.length; i++) if ((i & 3) !== 3) s2 += Math.abs(p[i] - q[i]);
    return s2 / (p.length * 0.75);
  }, { a: a, b: b });
}
/**
 * The glass's outline on a level line through the empty lower bulb, from the bore's middle out
 * past the glass's left edge: the darkest point near the edge, against the bore just inside it and
 * the paper just outside it. -> { dark: how much darker the line is than the lighter of the two, ... }
 */
async function outline(t) {
  var g = await t.glass();
  var y = Math.round(g.top + g.h * 0.70), x0 = Math.max(0, Math.round(g.left - 24)), x1 = Math.round(g.cx);
  await pixels(t, { x: x0, y: y - 1, width: x1 - x0, height: 3 }, 'line');
  return t.eval(function (x0) {
    var px = window.__px.line;
    function L(d, i) { return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; }
    var row = [], x, k;
    for (x = 0; x < px.w; x++) { var s = 0; for (k = 0; k < 3; k++) s += L(px.d, ((k * px.w) + x) * 4); row.push(s / 3); }
    var paper = row.slice(0, 8).reduce(function (a, b) { return a + b; }, 0) / 8;
    // the edge: the darkest point in the outer third of the scan
    var lo = 1e9, at = -1;
    for (x = 8; x < Math.round(px.w * 0.6); x++) if (row[x] < lo) { lo = row[x]; at = x; }
    var inner = row.slice(at + 6, at + 16), bore = inner.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, inner.length);
    return { dark: Math.round(Math.min(paper, bore) - lo), paper: Math.round(paper), bore: Math.round(bore), line: Math.round(lo), at: at + x0 };
  }, x0);
}

/* ---- the suite ------------------------------------------------------------------------- */
async function choices(s, env) {
  var rows = [];
  for (var c of ['dark', 'light', 'system', 'hours']) {
    var t = await opn(env, { storage: { background: c }, timezoneId: ZONE, init: fakeClock, initArg: [12, 0, 0] });
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
  var t = await opn(env, {});
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
  s.check('TUNE: Dark, Light, Device and Daytime in the Glass tab change the look (one cross-fade of the page, FADE) and are saved; nothing is built again, the glass is not swapped out',
    seen.join() === 'light:light,system:light,hours:' + (new Date().getHours() >= 7 && new Date().getHours() < 19 ? 'light' : 'dark') + ',dark:dark', seen.join(', '));
  s.check('TUNE: one plain line under the choices says what Device and Daytime do', /Device/.test(note.text) && /Daytime/.test(note.text) && /7:00/.test(note.text) && note.h > 10, JSON.stringify(note));
  s.check('TUNE: no page errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
  await t.close();
}

async function button(s, env) {
  var t = await opn(env, {});
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
  var u = await opn(env, { storage: { background: 'system' } });
  await u.page.emulateMedia({ colorScheme: 'dark' }); await sleep(300);
  var e = await lookOf(u);
  await u.page.tap('#btn-look'); await sleep(200);
  var f = await lookOf(u);
  await u.close();
  var v = await opn(env, { storage: { background: 'hours' }, timezoneId: 'UTC', init: fakeClock, initArg: [12, 0, 0] });
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
  var t = await opn(env, { rawStorage: { 'hourglass.settings.v1': save } });
  await sleep(500);
  var l = await lookOf(t), kept = await t.eval(function (KEY) { var v = JSON.parse(localStorage.getItem(KEY)); return [v.sand, v.finish, v.volume, v.quick, v.endsAt, v.tuneTab].join(); }, KEY);
  s.check('OLD: a save from before the background (1.18.0) comes up dark and saves \'dark\', every other setting as it was', lookIs(l, 'dark', 'dark') && kept === 'lapis,brass,0.4,2,5,10,15,30,60,true,glass', said(l) + ' ' + kept);
  await t.close();
}

async function reset(s, env) {
  var t = await opn(env, { storage: { background: 'light', sand: 'garnet' } });
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
    var t = await opn(env, { storage: { background: choice }, timezoneId: ZONE, init: fakeClock, initArg: [hour, 0, 0], routes: routes });
    if (scheme) await t.page.emulateMedia({ colorScheme: scheme });
    await t.context.addInitScript(firstFrame);
    await t.reload();
    var f = await t.eval(function () { return window.__first; });
    await t.close();
    var bg = want === 'light' ? 'rgb(243, 240, 234)' : 'rgb(11, 12, 14)', edge = want === 'light' ? 'rgb(236, 233, 226)' : 'rgb(9, 10, 12)';   // (the canvas is the room's edge: GROUND)
    var good = !!f && f.html === edge && (f.body === null || f.body === bg) && (f.veil === null || f.veil === 'rgba(0, 0, 0, 0)' || f.veil === bg) &&
      (want === 'light' ? f.look === 'light' && f.theme === PAPER : f.look === null && f.theme === NIGHT);
    return { good: good, said: choice + (scheme ? ' (' + scheme + ')' : '') + (choice === 'hours' ? ' at ' + hour + ':00' : '') + ' → ' + JSON.stringify(f) };
  }
  var cases = [['dark', null, 12, 'dark'], ['light', null, 12, 'light'], ['system', 'light', 12, 'light'], ['system', 'dark', 12, 'dark'], ['hours', null, 12, 'light'], ['hours', null, 22, 'dark']];
  for (var c of cases) { var r = await one(c[0], c[1], c[2], c[3]); rows.push(r.said); ok = ok && r.good; }
  s.check('FIRST: the first frame painted is in the look of each choice (dark; light; Device in a light and a dark browser; Daytime at noon and at 22:00): the canvas (the room\'s edge), the page, the veil and the theme-color', ok, rows.join(' | '));
  var noEarly = routed(env, 'index.html', function (src) { return src.replace(/<script>\s*\(function \(\) \{\s*try \{\s*var s = JSON\.parse[\s\S]*?<\/script>/, ''); });
  var ctl = await one('light', null, 12, 'light', [noEarly]);
  s.check('... and the page without its early script opens a light choice on a dark first frame (control)', !ctl.good, ctl.said);
  var utc = await one('hours', null, 12, 'light', [utcPage(env)]);
  s.check('... and a page whose early script reads the UTC hour opens Daytime at noon in ' + ZONE + ' on a dark first frame (control)', !utc.good, utc.said);
}
/** Copies that read the UTC hour for Daytime, not the device's (the app, and the page's early script). */
function utcApp(env) {
  return routed(env, 'app.js', function (src) { return src.replace("var h = date.getHours(); return h >= DAY[0]", "var h = date.getUTCHours(); return h >= DAY[0]").replace('h = now.getHours();\n    next.setHours(', 'h = now.getUTCHours();\n    next.setUTCHours('); });
}
function utcPage(env) {
  return routed(env, 'index.html', function (src) { return src.replace("h = new Date().getHours(), light = false;", "h = new Date().getUTCHours(), light = false;"); });
}

async function system(s, env, routes) {
  var t = await opn(env, { storage: { background: 'system' }, routes: routes });
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
  var t = await opn(env, { storage: { background: 'hours' }, timezoneId: ZONE, init: fakeClock, initArg: [h, m, sec], routes: routes });
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
  s.check('HOURS: Daytime by the device\'s clock (in ' + ZONE + '): dark at 6:59 and 19:00:30 and 0:30, light at 7:00:30, 18:59 and noon', ok, rows.join(', '));
  t = await hoursAt(env, 12, 0, 0, [utcApp(env), utcPage(env)]);
  a = await lookOf(t); await t.close();
  s.check('... and an app that reads the UTC hour is dark at noon there (control)', a.look === 'dark', said(a));
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

  // the clock set by hand, or the time zone changed (after a flight), with the app open and in front:
  // no event comes, and the timer for 19:00 counts the time gone by, not the clock
  async function moved(how, routes) {
    var u = await opn(env, { storage: { background: 'hours' }, timezoneId: how === 'zone' ? undefined : ZONE, init: fakeClock, initArg: [18, 0, 0], routes: routes });
    if (how === 'zone') {          // (the zone set by this page's own session, which alone can change it again: then the page opened in it)
      await u.cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/London' });
      await u.reload();
    }
    await sleep(300);
    var x = (await lookOf(u)).look;
    if (how === 'clock') await u.eval(function () { window.__setClock(19, 30, 0); });
    else await u.cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });   // (18:00 in London is 3:00 there)
    await sleep(12500);
    var y = await lookOf(u), h = await u.eval(function () { return new Date().getHours(); });
    await u.close();
    return { said: x + '→' + y.look + ' (' + h + ':xx)', ok: x === 'light' && y.look === (h >= 7 && h < 19 ? 'light' : 'dark') && lookIs(y, y.look, 'hours'), look: y.look };
  }
  var clock = await moved('clock'), zone = await moved('zone');
  s.check('HOURS: the clock set from 18:00 to 19:30 with the app open and in front, no event: dark within 12.5 s; the zone changed from London (18:00) to Tokyo: the look of the hour there, dark',
    clock.ok && clock.look === 'dark' && zone.ok && zone.look === 'dark', clock.said + ', zone ' + zone.said);
  var noClock = routed(env, 'app.js', function (src) { return src.replace('if (!lookClockTimer) lookClockTimer = setInterval(lookClock, 10000);', ''); });
  var ctl3 = await moved('clock', [noClock]);
  s.check('... and an app that does not look at the clock while open stays light after the clock is set (control)', ctl3.look === 'light', ctl3.said);

  // the note under the row in the device's own clock, as the state line's end
  async function note(locale, routes) {
    var u = await opn(env, { storage: { background: 'hours', endsAt: true }, locale: locale, timezoneId: ZONE, init: fakeClock, initArg: [12, 0, 0], routes: routes });
    await sleep(500);
    await u.eval(function () { window.Hourglass.setDuration(60000); });
    await sleep(2600);
    await u.eval(function () { window.Hourglass.start(); });
    await sleep(1200);
    var r = await u.eval(function () {
      var b = document.querySelector('#looks [data-look="hours"]');
      return { note: document.getElementById('look-note').textContent, label: b.getAttribute('aria-label'), ends: (document.getElementById('ends') || {}).textContent || '' };
    });
    await u.close();
    return r;
  }
  var us = await note('en-US'), gb = await note('en-GB'), twelve = /7:00\s?AM to 7:00\s?PM/;
  s.check('HOURS: the note under Background says Daytime\'s hours in the device\'s clock, as the state line\'s end does: en-US "' + us.note.replace(/[\s\S]*Daytime is /, '').trim() + '" and "' + us.ends.trim() + '"; en-GB "' + gb.note.replace(/[\s\S]*Daytime is /, '').trim() + '"',
    twelve.test(us.note) && twelve.test(us.label) && /\d:\d\d\s?[AP]M/.test(us.ends) && /07:00 to 19:00/.test(gb.note) && !/[AP]M/.test(gb.ends) && /\d\d:\d\d/.test(gb.ends), JSON.stringify([us, gb]));
  var fixed = routed(env, 'app.js', function (src) { return src.replace("if (note) note.textContent = note.textContent.replace('7:00 to 19:00', a + ' to ' + z);", ''); });
  var ctl4 = await note('en-US', [fixed]);
  s.check('... and an app that leaves the note as written says 19:00 beside a 12-hour end (control)', !twelve.test(ctl4.note) && /19:00/.test(ctl4.note), ctl4.note);
}

async function running(s, env) {
  var t = await opn(env, {});
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
    var t = await opn(env, { storage: { background: look, endsAt: true }, viewport: size || { width: 393, height: 852 }, routes: routes });
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

  // the Sand button held (a pour): its word in each of the nine sands and a very pale custom one
  async function held(look, routes) {
    var t = await opn(env, { storage: { background: look, sandColor: '45,0.2,0.97' }, routes: routes }), out = [];
    await sleep(700);
    for (var id of ['sahara', 'volcanic', 'moonstone', 'lapis', 'rosequartz', 'seaglass', 'garnet', 'olivine', 'amethyst', 'custom']) {
      await t.eval(function (id) { window.Hourglass.setSand(id); }, id);
      await sleep(300);
      var b = await t.page.$eval('#btn-sand', function (e) { var q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
      await t.page.mouse.move(b.x, b.y); await t.page.mouse.down();
      await sleep(450);                                 // (the button's colour eases over 0.2 s)
      var m = (await contrasts(t, '#btn-sand'))[0], on = await t.eval(function () { return document.getElementById('btn-sand').classList.contains('held'); });
      await t.page.mouse.up();
      out.push({ sand: id, held: on, ratio: m ? m.ratio : 0, color: m ? m.color : null });
      await sleep(200);
    }
    await t.close();
    return out;
  }
  var hl = await held('light'), hd = await held('dark');
  var hlow = hl.filter(function (x) { return !x.held || x.ratio < 4.5; });
  s.check('CONTRAST: the Sand button held (a pour) in the light look wears the deeper accent: its word 4.5 to 1 or more against its ground in each of the nine sands and a very pale custom one (the lowest ' +
    Math.min.apply(null, hl.map(function (x) { return x.ratio; })) + '); in the dark look the sand\'s own accent as before',
    hlow.length === 0 && hd.every(function (x) { return x.held; }) && hd.some(function (x, k) { return x.color !== hl[k].color; }),
    hlow.map(function (x) { return x.sand + ' ' + x.ratio + (x.held ? '' : ' (not held)'); }).join(', ') || hd.map(function (x) { return x.sand + ' ' + x.color; }).join(', '));
  var noHeld = routed(env, 'styles.css', function (src) { return src.replace('html[data-look="light"] .act.held { color: var(--accent-text); }', ''); });
  var hc = await held('light', [noHeld]), hcl = hc.filter(function (x) { return x.ratio < 4.5; });
  s.check('... and a style sheet whose held Sand button wears the sand\'s own accent on paper falls under 4.5 to 1 (control: ' + hcl.map(function (x) { return x.sand + ' ' + x.ratio; }).join(', ') + ')',
    hcl.length > 0, JSON.stringify(hc.slice(0, 3)));
}

async function outlineCase(s, env, label, opts) {
  var t = await opn(env, Object.assign({ storage: { background: 'light', frame: false } }, opts || {}));
  await sleep(1200);
  var o = await outline(t);
  await t.close();
  return o;
}
async function outlines(s, env) {
  var o = await outlineCase(s, env), d = await outlineCase(s, env, null, { storage: { background: 'dark', frame: false } });
  s.check('OUTLINE: on white the drawn glass has its outline: a line ' + o.dark + ' levels darker than the paper and the bore beside it (paper ' + o.paper + ', bore ' + o.bore + ', line ' + o.line + ')',
    o.dark >= 25 && o.paper > 200, JSON.stringify(o) + '; the dark look: ' + JSON.stringify(d));
  var flat = routed(env, 'glass/renderer.js', function (src) { return src.replace('if (drawn && m > 0) tint = m >= 1 ? PAPER_INK : mix(tint, PAPER_INK, m);', ''); });
  var c = await outlineCase(s, env, null, { routes: [flat] });
  s.check('... and without the light shading the drawn glass\'s outline is lost on white (control)', c.dark < 25, JSON.stringify(c));
}

/**
 * The rendered glass half way through a change of look: its two programs' pictures, one over the
 * other, against the glass at either end (an idle glass, the region of the assembly on screen, its
 * two canvases alone on a fixed grey, so that the page fading behind it is not counted).
 */
/** The rendered glass's two canvases alone on a fixed grey (on) or the page as it is (off): what is read is the glass's own picture. */
function glassAlone(t, on) {
  return t.eval(function (on) {
    var st = document.getElementById('glass-alone');
    if (!on) { if (st) st.remove(); return; }
    st = document.createElement('style'); st.id = 'glass-alone';
    st.textContent = 'html, body, html.look-fade, html.look-fade body { background: #808080 !important; } #app * { visibility: hidden !important; } ' +
      '#c-glass-back, #c-glass-front { visibility: visible !important; } #ambient { display: none !important; }';
    document.head.appendChild(st);
  }, on);
}
async function glassPixels(t, clip, name) { await glassAlone(t, true); await sleep(300); var p = await pixels(t, clip, name); await glassAlone(t, false); return p; }
async function webglFade(env, routes) {
  var t = await opn(env, { storage: { background: 'dark' }, viewport: { width: 390, height: 844 }, routes: routes });
  await sleep(2500);
  var g = await t.glass(), clip = { x: Math.round(g.left + g.w * 0.2), y: Math.round(g.top + g.h * 0.55), width: Math.round(g.w * 0.6), height: Math.round(g.h * 0.3) };
  await glassPixels(t, clip, 'a');
  await t.page.tap('#btn-look');
  var h = await holdFade(t, 0.5);
  await sleep(2500);                                   // (software WebGL: a frame takes most of a second)
  await glassPixels(t, clip, 'm');
  await letGo(t); await settled(t); await sleep(2500);
  await glassPixels(t, clip, 'b');
  var am = await apart(t, 'a', 'm'), mb = await apart(t, 'm', 'b'), ab = await apart(t, 'a', 'b');
  await t.close();
  var r = { held: !!h, fromDark: Math.round(am * 100) / 100, toLight: Math.round(mb * 100) / 100, whole: Math.round(ab * 100) / 100 };
  r.between = r.held && r.fromDark > 0.2 * r.whole && r.toLight > 0.2 * r.whole && r.fromDark < r.whole && r.toLight < r.whole;
  return r;
}

async function webglOutline(s, root, port, outlines, fades) {
  var env = await H.start({ webgl: true, port: port, root: root });
  try {
    var has = await (async function () { var t = await opn(env, {}); var g = await t.eval(function () { return !!window.Hourglass.renderer.glass; }); await t.close(); return g; })();
    if (!has) { s.skip('OUTLINE and FADE (WebGL): the rendered glass', 'no WebGL here'); return; }
    if (fades) {
      var f = await webglFade(env);
      s.check('FADE (WebGL): half way through a change of look the rendered glass is between its two pictures (its two programs drawn one over the other): ' + f.fromDark + ' from the dark one and ' + f.toLight + ' from the light, of ' + f.whole + ' between them (mean levels)', f.between, JSON.stringify(f));
      var one = routed(env, 'glass/renderer.js', function (src) { return src.replace('if (m > 0 && m < 1) { try {', 'if (false) { try {'); });
      var fc = await webglFade(env, [one]);
      s.check('... and a glass that only switches program is already the light one half way (control)', !fc.between, JSON.stringify(fc));
    }
    if (!outlines) return;
    var o = await outlineCase(s, env);
    // glass on white: a deep line at its edge (100 levels under the paper at least) and a clear bore
    // (within 10 of the paper), not a smoked one: the dark room's shading on white gives a greyed bore
    var asGlass = function (x) { return x.paper > 200 && x.paper - x.line >= 100 && x.paper - x.bore <= 10 && x.dark >= 25; };
    s.check('OUTLINE (WebGL): on white the rendered glass shows its edge by a dark line ' + (o.paper - o.line) + ' levels under the paper, its bore clear (paper ' + o.paper + ', bore ' + o.bore + ', line ' + o.line + ')',
      asGlass(o), JSON.stringify(o));
    // (the control: the light look drawn by the dark look's program, its room and its composition
    // both, as on white without the light shading)
    var room = routed(env, 'glass/gl.js', function (src) {
      return src.replace('var GLASS_FS_PAPER = glassSource(0, true), GLASS_FS_SHAPE_PAPER = glassSource(1, true);', 'var GLASS_FS_PAPER = glassSource(0), GLASS_FS_SHAPE_PAPER = glassSource(1);');
    });
    var c = await outlineCase(s, env, null, { routes: [room] });
    s.check('... and the rendered glass shaded as in the dark look on white is not that: its bore greyed, or its line lost (control)', !asGlass(c), JSON.stringify(c));
    if (SHOTS) {
      for (var look of ['dark', 'light']) {
        var t = await opn(env, { storage: { background: look }, viewport: { width: 393, height: 852 } });
        await sleep(1500);
        await t.page.screenshot({ path: path.join(SHOTS, 'mode-webgl-' + look + '.png') });
        await t.close();
      }
    }
  } finally { await env.close(); }
}

async function paleSand(s, env) {
  async function one(storage, routes) {
    var t = await opn(env, { storage: Object.assign({ background: 'light', durationMs: 3600000 }, storage), routes: routes });
    await sleep(900);
    var g = await t.glass();
    // the bed in the upper bulb (idle: a full glass), and the paper to its left
    await pixels(t, { x: Math.round(g.cx - g.w * 0.12), y: Math.round(g.top + g.h * 0.30), width: Math.round(g.w * 0.24), height: Math.round(g.h * 0.06) }, 'bed');
    var a = await meanOf(t, 'bed');
    await pixels(t, { x: Math.max(2, Math.round(g.left - 18)), y: Math.round(g.top + g.h * 0.30), width: 10, height: Math.round(g.h * 0.06) }, 'paper');
    var b = await meanOf(t, 'paper');
    await t.close();
    function lumOf(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
    var ra = lumOf(a), rb = lumOf(b);
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
    var t = await opn(env, { storage: { background: 'light' }, viewport: size });
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
  var t = await opn(env, {});
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
  var t = await opn(env, Object.assign({ viewport: { width: 1280, height: 800 } }, opts || {}));
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

  // a touch screen whose browser has no vibration (an iPad with a mouse, a trackpad or a Pencil; Firefox
  // on a touch-screen PC): the app lays its haptic labels over every control and over the glass's stage
  // (hapticMount), and a click lands on a label, which is what it lies over
  function noVibrate() { delete Navigator.prototype.vibrate; }
  async function labelled(routes) {
    return dblRun(env, { init: noVibrate, routes: routes }, async function (t) {
      var p = await bg(t), out = { labels: await t.eval(function () { return document.querySelectorAll('label.haptic').length; }) };
      out.hit = await t.eval(function (p) { var e = document.elementFromPoint(p.x, p.y); return e ? e.tagName + (e.className ? '.' + e.className : '') : null; }, p);
      await t.page.mouse.dblclick(p.x, p.y); await sleep(300);
      out.mouse = (await zenOf(t)).zen;
      await sleep(1800);
      await t.page.mouse.dblclick(p.x, p.y); await sleep(300);
      out.mouseOut = (await zenOf(t)).zen;
      await sleep(600);
      for (var n = 1; n <= 2; n++) {                       // a pen's double-click (the Input domain's own pen)
        await t.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: n, pointerType: 'pen' });
        await t.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: n, pointerType: 'pen' });
      }
      await sleep(300);
      out.pen = (await zenOf(t)).zen;
      await sleep(1800);
      var m = await t.page.$eval('#btn-mute', function (e) { var r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await t.page.mouse.dblclick(p.x, p.y); await sleep(1800);          // (out of Zen again, then a control)
      await t.page.mouse.dblclick(m.x, m.y); await sleep(300);
      out.onMute = (await zenOf(t)).zen;
      out.errors = t.errors.slice(0, 2);
      return out;
    });
  }
  var r5 = await labelled();
  s.check('DBL: on a touch screen without vibration (haptic labels over the controls and the glass: ' + r5.labels + '; the click lands on ' + r5.hit + ') a double-click of the mouse brings Zen and another takes it away, a pen\'s brings it too, and one on the mute button\'s label does not',
    r5.labels > 10 && /^LABEL/.test(r5.hit || '') && r5.mouse && !r5.mouseOut && r5.pen && !r5.onMute && r5.errors.length === 0, JSON.stringify(r5));
  var asControl = routed(env, 'app.js', function (src) { return src.replace('if (el && el._host) el = el._host;', ''); });
  var c5 = await labelled([asControl]);
  s.check('... and an app that takes a haptic label for a control brings no Zen there, by the mouse or the pen (control)', !c5.mouse && !c5.pen, JSON.stringify(c5));
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

/* ---- the ground: one paper from the top edge of the screen to the bottom (1.20.1) --------- */
// The iPhone's home-screen app, as near as a test browser comes to it: the safe-area insets a
// phone has (47 px above, 34 px below), put in through the page's own variables, and a dynamic
// viewport shorter than the screen by the inset below (on the phone, 100dvh can come out so).
var PHONES = [[390, 844], [393, 852], [430, 932], [375, 667], [320, 568]];
var INSETS = function () { var s = document.documentElement.style; s.setProperty('--sat', '47px'); s.setProperty('--sab', '34px'); window.dispatchEvent(new Event('resize')); };
function shortDvh(env, change) {
  return routed(env, 'styles.css', function (src) { return (change ? change(src) : src).split('100dvh').join('calc(100dvh - 34px)'); });
}
/**
 * A step in the ground: each of four columns near the screen's two sides, and three under the bottom
 * bar (a quarter, half and three quarters across; from 30 px below it, where its shadow's own fall has
 * eased), scanned from the top edge to the bottom, the mean
 * of the 5 pixels above each point against the 5 below it, outside every control (the bars, the chip,
 * the buttons, the time, a sheet, the glass and its shadow). A gradient of the room changes by a few
 * levels over that span; a seam by more than 12. The bottom bar's shadow is in the picture: it reaches
 * past the app's box, which cuts it at its foot where the box ends above the screen's (1.22.0: in a
 * fade it is the paper's from a quarter of the way; the dark one half way to the paper stepped by up
 * to 20 there, and from 1.21.1 to 1.22.0 this scan left the shadow out).
 * -> { steps: [{ x, y, above, below }], box: whether the app's own box is the window's }
 */
async function seams(t) {
  var size = await t.eval(function () {
    return new Promise(function (done) { requestAnimationFrame(function () { requestAnimationFrame(function () { done({ w: innerWidth, h: innerHeight }); }); }); });
  });
  await pixels(t, { x: 0, y: 0, width: size.w, height: size.h }, 'screen');
  // (the columns are scanned in the page, where the screen's pixels are kept; a column steps at most once in 9 pixels)
  return t.eval(function () {
    var px = window.__px.screen, info = (function () {
      var boxes = [];
      document.querySelectorAll('.panel, .chip, .icon-btn, #readout, #status, .sheet.open, #toast.show, #assembly, #shadow').forEach(function (e) {
        var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        if (r.width && r.height && cs.visibility !== 'hidden' && +cs.opacity > 0) boxes.push([r.left - 2, r.top - (e.classList.contains('sheet') ? 90 : 4), r.right + 2, r.bottom + 4]);
      });
      var a = document.getElementById('app').getBoundingClientRect(), p = document.querySelector('#hud-bottom .panel'), pb = p ? p.getBoundingClientRect() : null;
      return { boxes: boxes, app: [a.left, a.top, a.right, a.bottom], bar: pb && pb.height ? [pb.left, pb.top, pb.right, pb.bottom] : null };
    })();
    var W = px.w, Hh = px.h, d = px.d, steps = [];
    function inside(x, y) { return info.boxes.some(function (b) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }); }
    function mean(x, y0, y1) { var r = [0, 0, 0]; for (var y = y0; y < y1; y++) { var i = (y * W + x) * 4; r[0] += d[i]; r[1] += d[i + 1]; r[2] += d[i + 2]; } return r.map(function (v) { return Math.round(v / (y1 - y0)); }); }
    // (under the bar the scan begins 30 px below it: nearer, the shadow's own fall is steeper than a seam's 12 in 10 px)
    function nearBar(x, y) { var b = info.bar; return !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] + 30; }
    [3, 6, W - 7, W - 4, Math.round(W / 4), Math.round(W / 2), Math.round(3 * W / 4)].forEach(function (x) {
      for (var y = 6; y < Hh - 6; y++) {
        if (inside(x, y - 6) || inside(x, y + 6) || nearBar(x, y - 6)) continue;
        var a = mean(x, y - 6, y - 1), b = mean(x, y + 1, y + 6);
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 12) { steps.push({ x: x, y: y, above: a, below: b }); y += 8; }
      }
    });
    var box = Math.abs(info.app[0]) < 0.5 && Math.abs(info.app[1]) < 0.5 && Math.abs(info.app[2] - W) < 0.5 && Math.abs(info.app[3] - Hh) < 0.5;
    return { steps: steps, box: box, app: info.app.map(Math.round) };
  });
}
async function groundCase(env, look, size, how, routes, tag, mid) {
  var t = await opn(env, { storage: { background: look }, viewport: { width: size[0], height: size[1] }, routes: routes });
  await sleep(700);
  await t.eval(INSETS);
  await sleep(300);
  var held;
  if (how === 'zen') { await t.page.tap('#btn-zen'); await sleep(1900); }
  if (how === 'tune') { await tune.open(t); await sleep(900); }
  if (how === 'fade') { await t.page.tap('#btn-look'); held = await holdFade(t, 0.5); }
  var r = await seams(t);
  if (how === 'fade') r.lk = held ? held.lk : null;
  if (SHOTS && (size[0] === 390 || mid)) await t.page.screenshot({ path: path.join(SHOTS, 'mode-ground-' + look + '-' + how + '-' + size.join('x') + (tag ? '-' + tag : '') + '.png') });
  await t.close();
  return r;
}
/**
 * The page as a home-screen app on an iPhone can lay it out: its layout viewport shorter than the
 * window by about the status bar's height (59 px), at the bottom or at the top. The body and the
 * app's box end there; under them the window shows the canvas (the root's colour).
 */
var SHORT = 59;
function shortView(env, end, change) {
  return routed(env, 'styles.css', function (src) {
    return (change ? change(src) : src) + '\nbody, #app { ' + end + ': ' + SHORT + 'px !important; ' + (end === 'top' ? 'bottom: 0 !important; ' : '') + 'height: auto !important; }\n';
  });
}
/** The ground as it was before 1.20.2: no flat edge to the room, the canvas the page's own colour, the scrim to the edges. */
function oldGround(src) {
  return src.split('var(--rim), ').join('').replace('html { background: var(--edge); }', '').replace('html.look-fade { background: var(--edge); }', '')
    .replace(/\n  -webkit-mask-image: linear-gradient\(transparent, #000 96px[^\n]*\n  mask-image: [^\n]*/, '');
}
/** index.html's colours before the first paint as they were before 1.20.2 (the canvas the page's own colour). */
function oldPage(env) {
  return routed(env, 'index.html', function (src) {
    return src.replace('<style>html{background:#090a0c}body{background:#0b0c0e}html[data-look="light"]{background:#ece9e2}html[data-look="light"] body{background:#f3f0ea}</style>',
      '<style>html,body{background:#0b0c0e}html[data-look="light"],html[data-look="light"] body{background:#f3f0ea}</style>');
  });
}
async function shortGround(s, env, change) {
  var rows = [], ok = true, look, size, how, end, r, more = change ? [oldPage(env)] : [];
  for (look of ['light', 'dark']) for (size of [[393, 852], [375, 667]]) for (how of ['plain', 'zen', 'tune']) for (end of ['bottom', 'top']) {
    r = await groundCase(env, look, size, how, [shortView(env, end, change)].concat(more), 'short-' + end + (change ? '-old' : ''), 'shot');
    ok = ok && r.steps.length === 0;
    rows.push(look + ' ' + size.join('x') + ' ' + how + ' ' + end + (r.steps.length ? ' ' + JSON.stringify(r.steps.slice(0, 2)) : ' one'));
  }
  for (end of ['bottom', 'top']) for (look of ['dark', 'light']) {
    r = await groundCase(env, look, [393, 852], 'fade', [shortView(env, end, change)].concat(more), 'short-' + end + (change ? '-old' : ''), 'shot');
    ok = ok && r.steps.length === 0 && r.lk > 0.3 && r.lk < 0.7;
    rows.push(look + ' faded half way (' + r.lk + ') ' + end + (r.steps.length ? ' ' + JSON.stringify(r.steps.slice(0, 2)) : ' one'));
  }
  return { ok: ok, rows: rows };
}
async function ground(s, env) {
  var rows = [], ok = true, look, size, r;
  for (look of ['light', 'dark']) {
    var phone = [shortDvh(env)];
    for (size of PHONES) {
      r = await groundCase(env, look, size, 'plain', phone);
      ok = ok && r.box && r.steps.length === 0;
      rows.push(look + ' ' + size.join('x') + (r.box ? '' : ' box ' + r.app.join(',')) + (r.steps.length ? ' ' + JSON.stringify(r.steps.slice(0, 2)) : ' one'));
    }
    for (var how of ['zen', 'tune']) {
      r = await groundCase(env, look, [390, 844], how, phone);
      ok = ok && r.box && r.steps.length === 0;
      rows.push(look + ' 390x844 ' + how + (r.box ? '' : ' box ' + r.app.join(',')) + (r.steps.length ? ' ' + JSON.stringify(r.steps.slice(0, 2)) : ' one'));
    }
  }
  s.check('GROUND: as the home-screen app has it (the insets, a dynamic viewport short of the screen), the ground is one from the top edge to the bottom at 390 x 844, 393 x 852, 430 x 932, 375 x 667 and 320 x 568, in Zen and with Tune open, in both looks: the app\'s box is the window\'s, and no column near either side steps outside a control',
    ok, rows.join('; '));
  // control: the app's box a viewport unit tall again (as before 1.20.1), and the ground as it was before 1.20.2: the page's own ground shows as a band under it
  var old = shortDvh(env, function (src) { return oldGround(src).replace('#app {\n  position: fixed; inset: 0;\n', '#app {\n  position: fixed; inset: 0;\n  height: 100vh; height: 100dvh;\n'); });
  var c1 = await groundCase(env, 'light', [390, 844], 'plain', [old, oldPage(env)], 'old'), c2 = await groundCase(env, 'dark', [390, 844], 'plain', [old, oldPage(env)], 'old');
  s.check('... and with the app\'s box 100dvh tall again, on the ground as it was, a band of another ground shows along the bottom, in the light look (' + (c1.steps[0] ? c1.steps[0].above.join('.') + ' over ' + c1.steps[0].below.join('.') : 'none') + ') and the dark (control)',
    c1.steps.length > 0 && c2.steps.length > 0 && !c1.box, JSON.stringify(c1.steps.slice(0, 2)) + ' | ' + JSON.stringify(c2.steps.slice(0, 2)));

  // whatever the box: a layout viewport 59 px short of the window, below or above (1.20.2)
  var sh = await shortGround(s, env);
  s.check('GROUND: with the layout viewport ' + SHORT + ' px shorter than the window, at the bottom and at the top, the canvas shown there meets the room with no step, in both looks, at 393 x 852 and 375 x 667, in Zen and with Tune open, and half way through a fade either way',
    sh.ok, sh.rows.join('; '));
  // control: the bar's shadow in a fade as it was before 1.22.0 (the dark one half way to the paper), half way through a fade
  var oldShadow = function (src) { var o = src.replace('rgba(60, 46, 28, 0.14) min(100%, 4 * var(--lp)))', 'rgba(60, 46, 28, 0.14) var(--lp))'); if (o === src) throw new Error('app-mode: the fade\'s bar shadow is not in styles.css'); return o; };
  var shSh = [];
  for (look of ['dark', 'light']) { r = await groundCase(env, look, [393, 852], 'fade', [shortView(env, 'bottom', oldShadow)], 'short-bottom-oldshadow', 'shot'); shSh.push(look + ' faded half way (' + r.lk + ')' + (r.steps.length ? ' ' + JSON.stringify(r.steps.slice(0, 2)) : ' one')); }
  s.check('... and with the bar\'s shadow in a fade as it was before 1.22.0 (the dark look\'s half way to the paper), half way through a fade either way the shadow steps where the app\'s box ends above the screen\'s foot (control)',
    shSh.every(function (x) { return !/ one$/.test(x); }), shSh.join('; '));
  var shOld = await shortGround(s, env, oldGround);
  var stepped = shOld.rows.filter(function (x) { return !/ one$/.test(x); }), must = shOld.rows.filter(function (x) { return /^light \d+x\d+ plain|tune top|faded/.test(x); });
  s.check('... and with the ground as it was (the room\'s edge shaded, the canvas the page\'s own colour, the scrim to the edges) the band shows as a step: in the light look at both ends at both sizes, with Tune open at the top in both looks, half way through a fade, ' + stepped.length + ' of ' + shOld.rows.length + ' in all (control)',
    must.length === 12 && must.every(function (x) { return !/ one$/.test(x); }), shOld.rows.join('; '));
}

/* ---- the fade between the looks (1.20.1) ------------------------------------------------- */
/** The fade's animation held at `f` of its way (or null: there is none), and two frames drawn there. */
function holdFade(t, f) {
  return t.eval(function (f) {
    var a = document.documentElement.getAnimations().filter(function (x) { return x.effect && x.effect.getKeyframes().some(function (k) { return '--lk' in k; }); })[0];
    if (!a) return Promise.resolve(null);
    a.pause(); a.currentTime = a.effect.getComputedTiming().duration * f;
    return new Promise(function (done, fail) {
      var late = setTimeout(function () { fail(new Error('holdFade: three frames were not drawn within 20 s of holding the fade at ' + f)); }, 20000);
      requestAnimationFrame(function () { requestAnimationFrame(function () { requestAnimationFrame(function () {
        clearTimeout(late);
        done({ lk: +getComputedStyle(document.documentElement).getPropertyValue('--lk'), mix: window.Hourglass.renderer.mix, body: getComputedStyle(document.body).backgroundColor,
               theme: document.querySelector('meta[name="theme-color"]').content, ink: getComputedStyle(document.getElementById('t-main')).color });
      }); }); });
    });
  }, f);
}
function letGo(t) { return t.eval(function () { document.documentElement.getAnimations().forEach(function (a) { a.play(); }); }); }
/**
 * The glass's own drawn layers (c-back and c-front) as they are now, read in the page and kept
 * there as `name` (when one is given). They stay in the page: at 390 x 844 they are 1122 x 2154
 * each, 19 million numbers the two, and every number of an answer costs Playwright's protocol
 * about 5 µs and 200 bytes of this process's memory while it crosses (100 s and over 3 GB a
 * picture, ten pictures in FADE). What comes back is each layer's size, a hash of its pixels
 * (FNV-1a over them as 32-bit words) and their sum: two pictures that agree in all three are the
 * same to the pixel.
 */
function layers(t, name) {
  return t.eval(function (name) {
    var kept = [];
    if (name) (window.__layers = window.__layers || {})[name] = kept;
    return ['c-back', 'c-front'].map(function (id) {
      var c = document.getElementById(id), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      var w = new Uint32Array(d.buffer), h = 2166136261 >>> 0, sum = 0, i;
      for (i = 0; i < w.length; i++) { h ^= w[i]; h = Math.imul(h, 16777619) >>> 0; }
      for (i = 0; i < d.length; i++) sum += d[i];
      kept.push(d);
      return { w: c.width, h: c.height, hash: h, sum: sum };
    });
  }, name || null);
}
/** How far two kept pictures' layers are apart: every channel's difference, summed over both layers (in the page). */
function layerDist(t, a, b) {
  return t.eval(function (n) {
    var A = window.__layers[n.a], B = window.__layers[n.b], s = 0;
    for (var k = 0; k < A.length; k++) for (var i = 0; i < A[k].length; i++) s += Math.abs(A[k][i] - B[k][i]);
    return s;
  }, { a: a, b: b });
}
/** Two lists of pictures (their sizes, hashes and sums) the same to the pixel, one for one; also pictures of two pages. */
function samePixels(a, b) { return a.length === b.length && a.every(function (l, k) { return l.w === b[k].w && l.h === b[k].h && l.hash === b[k].hash && l.sum === b[k].sum; }); }
/** The picture's numbers: a patch of the room beside the glass, the bar's ground, and the glass's own drawn layers (kept in the page as `name`). */
async function picture(t, name) {
  var g = await t.glass();
  await pixels(t, { x: 4, y: Math.round(g.top + g.h * 0.4), width: 24, height: 24 }, 'room');
  var room = await meanOf(t, 'room');
  var bar = await t.eval(function () { var r = document.querySelector('.panel').getBoundingClientRect(); return { x: Math.round(r.left + 6), y: Math.round(r.bottom - 10) }; });
  await pixels(t, { x: bar.x, y: bar.y, width: 6, height: 4 }, 'bar');
  var panel = await meanOf(t, 'bar');
  return { room: room, bar: panel, layers: await layers(t, name) };
}
/** m lies well between a and b, in each of its three channels (a and b far apart). */
function between(a, m, b) { return a.every(function (v, i) { var lo = Math.min(v, b[i]), hi = Math.max(v, b[i]); return hi - lo > 8 && m[i] > lo + 0.15 * (hi - lo) && m[i] < hi - 0.15 * (hi - lo); }); }
async function fadeMid(env, routes, shots) {
  var t = await opn(env, { storage: { background: 'dark' }, viewport: { width: 390, height: 844 }, routes: routes });
  await sleep(700);
  await t.eval(function () { window.Hourglass.setDuration(600000); });
  await sleep(2600);
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(1200);
  var dark = await picture(t, 'dark');
  if (shots) await t.page.screenshot({ path: path.join(SHOTS, 'mode-fade-0.png') });
  await t.page.tap('#btn-look');
  var mid = null, held = null;
  for (var f of [0.25, 0.5, 0.75]) {
    var h = await holdFade(t, f);
    if (f === 0.5) { held = h; mid = h ? await picture(t, 'mid') : null; }
    if (shots && h) await t.page.screenshot({ path: path.join(SHOTS, 'mode-fade-' + Math.round(f * 4) + '.png') });
  }
  await letGo(t);
  await settled(t); await sleep(200);
  var light = await picture(t, 'light');
  if (shots) await t.page.screenshot({ path: path.join(SHOTS, 'mode-fade-4.png') });
  var running = await t.eval(function () { return window.Hourglass.timer.state; });
  // the three pictures' drawn layers against each other, where they were kept
  var gd = 0, gl = 0, all = 0;
  if (held && mid) { gd = await layerDist(t, 'dark', 'mid'); gl = await layerDist(t, 'mid', 'light'); all = await layerDist(t, 'dark', 'light'); }
  await t.close();
  if (!held || !mid) return { held: held, between: false };
  return { held: held, running: running, room: [dark.room, mid.room, light.room].map(function (c) { return c.map(Math.round).join('.'); }), bar: [dark.bar, mid.bar, light.bar].map(function (c) { return c.map(Math.round).join('.'); }),
    glass: { fromDark: gd, toLight: gl, whole: all },
    between: between(dark.room, mid.room, light.room) && between(dark.bar, mid.bar, light.bar) && gd > 0.15 * all && gl > 0.15 * all && gd < all && gl < all,
    lk: held.lk };
}
async function fadeCase(s, env) {
  var m = await fadeMid(env, null, !!SHOTS);
  s.check('FADE: half way through a change of look (dark to light, a glass running) the page is between the two: the room beside the glass ' + (m.room || []).join(' / ') + ', the bar ' + (m.bar || []).join(' / ') + ', the glass\'s drawn layers, and the body\'s colour and the theme-color mixed',
    m.between && m.held && m.held.lk > 0.3 && m.held.lk < 0.7 && m.held.mix > 0.3 && m.held.mix < 0.7 && m.held.theme !== '#0b0c0e' && m.held.theme !== '#f3f0ea' && m.running === 'running', JSON.stringify(m));
  var none = routed(env, 'app.js', function (src) { return src.replace('var canFadeLook = !!(', 'var canFadeLook = false && !!('); });
  var c = await fadeMid(env, [none]);
  s.check('... and an app without the fade has nothing between the two: the look is changed at once (control)', !c.between, JSON.stringify(c));

  // the ends: after a fade, exactly the look as it is opened (the page's colours, the metas, the glass's drawn layers)
  async function endOf(look, act) {
    var t = await opn(env, { storage: { background: look }, viewport: { width: 390, height: 844 } });
    await sleep(800);
    if (act) { await act(t); await settled(t); }
    await sleep(1500);                  // (the room's own easings at the launch over, in both: the same picture at rest)
    var l = await lookOf(t), p = await picture(t);
    await pixels(t, { x: 0, y: 0, width: 390, height: 120 }, 'top');
    var page = await printOf(t, 'top');
    await t.close();
    return { l: l, p: p, page: page };
  }
  var rows = [], ok = true;
  for (var pair of [['dark', 'light'], ['light', 'dark']]) {
    var faded = await endOf(pair[0], function (t) { return t.page.tap('#btn-look'); }), plain = await endOf(pair[1]);
    var glass = samePixels(faded.p.layers, plain.p.layers), top = samePixels([faded.page], [plain.page]);
    var same = lookIs(faded.l, pair[1]) && glass && top &&
      faded.p.room.every(function (v, i) { return Math.abs(v - plain.p.room[i]) < 0.01; });
    ok = ok && same;
    rows.push(pair.join('→') + (same ? ' exact' : ' ' + said(faded.l) + ' glass ' + (glass ? 'the same' : JSON.stringify(faded.p.layers) + ' vs ' + JSON.stringify(plain.p.layers)) +
      ' top ' + (top ? 'the same' : JSON.stringify(faded.page) + ' vs ' + JSON.stringify(plain.page)) + ' room ' + faded.p.room.map(Math.round) + ' vs ' + plain.p.room.map(Math.round)));
  }
  s.check('FADE: each end is exactly its look as the app opens in it: the page\'s top and the room, the metas, the moon button, and the glass\'s drawn layers to the pixel (' + rows.join(', ') + ')', ok, rows.join(' | '));
}

/** Whether the page ever fades (the class, or an animation of --lk), watched from its first line. */
function watchFades() {
  window.__fades = 0;
  var bump = function () { window.__fades++; };
  var anim = Element.prototype.animate;
  Element.prototype.animate = function (k) { if (JSON.stringify(k || '').indexOf('--lk') >= 0) bump(); return anim.apply(this, arguments); };
  new MutationObserver(function () { if (document.documentElement.classList.contains('look-fade')) bump(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
async function launchCase(s, env) {
  async function one(choice, routes) {
    var t = await opn(env, { storage: { background: choice }, routes: routes, init: watchFades });
    await t.reload();
    await sleep(1500);
    var r = await t.eval(function () { return window.__fades; }), l = await lookOf(t);
    await t.close();
    return { fades: r, look: l.look };
  }
  var a = await one('light'), b = await one('dark');
  s.check('LAUNCH: the app opens in its look with no fade (light: ' + a.fades + ' fades, dark: ' + b.fades + ')', a.fades === 0 && b.fades === 0 && a.look === 'light' && b.look === 'dark', JSON.stringify([a, b]));
  var late = routed(env, 'index.html', function (src) { return src.replace(/<script>\s*\(function \(\) \{\s*try \{\s*var s = JSON\.parse[\s\S]*?<\/script>/, ''); });
  var fades = routed(env, 'app.js', function (src) { return src.replace('showLook(true);  ', 'showLook();      '); });
  var c = await one('light', [late, fades]);
  s.check('... and an app that put its look on only after the first frame, and faded to it, would fade at the launch (control)', c.fades > 0, JSON.stringify(c));
}

async function reduceCase(s, env) {
  async function one(routes) {
    var t = await opn(env, { storage: { background: 'dark' }, reducedMotion: true, routes: routes, init: watchFades });
    await sleep(700);
    await t.page.tap('#btn-look');
    var at = await t.eval(function () { return new Promise(function (done) { requestAnimationFrame(function () { done({ body: getComputedStyle(document.body).backgroundColor, mix: window.Hourglass.renderer.mix }); }); }); });
    var r = await t.eval(function () { return window.__fades; });
    await t.close();
    return { fades: r, at: at };
  }
  var a = await one();
  s.check('REDUCE: with Reduce Motion a change of look is at once, as before: no fade, the next frame already light (' + a.at.body + ')', a.fades === 0 && a.at.body === 'rgb(243, 240, 234)' && a.at.mix === 1, JSON.stringify(a));
  var deaf = routed(env, 'app.js', function (src) { return src.replace('canFadeLook && !reduceMotion && !document.hidden', 'canFadeLook && !document.hidden'); });
  var c = await one([deaf]);
  s.check('... and an app that fades all the same fades with Reduce Motion (control)', c.fades > 0, JSON.stringify(c));
}

async function twiceCase(s, env) {
  // Each change after the first is made in a fade held 40 % of its way (its animation paused there,
  // as holdFade does), whatever the frame rate: the new fade must start from the very point the page
  // shows (the --lk read just before the change), and the last change decides the look.
  async function one(taps, routes) {
    var t = await opn(env, { storage: { background: 'dark' }, routes: routes });
    await sleep(900);
    var steps = await t.eval(function (taps) {
      var root = document.documentElement, b = document.getElementById('btn-look'), out = [];
      function lkAnim() { return root.getAnimations().filter(function (x) { return x.effect && x.effect.getKeyframes().some(function (k) { return '--lk' in k; }); })[0] || null; }
      function frame() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
      async function go() {
        b.click();
        var a = lkAnim();
        if (a) a.pause();                      // (held until it is moved on, below: no frame can end it)
        for (var i = 1; i < taps; i++) {
          if (!a || !root.classList.contains('look-fade')) { out.push({ inFade: false }); b.click(); a = null; continue; }
          a.currentTime = a.effect.getComputedTiming().duration * 0.4;
          await frame();
          var before = +getComputedStyle(root).getPropertyValue('--lk');
          b.click();
          var a2 = lkAnim(), from = a2 && a2 !== a ? parseFloat(a2.effect.getKeyframes()[0]['--lk']) : NaN;
          out.push({ inFade: true, before: Math.round(before * 1000) / 1000, from: from });
          a = a2 && a2 !== a ? a2 : null;
          if (a && i < taps - 1) a.pause();
        }
        return out;
      }
      return go();
    }, taps);
    var l = await lookOf(t);
    var mix = await t.eval(function () { return window.Hourglass.renderer.mix; });
    await t.close();
    var jump = 0, inFade = steps.length === taps - 1;
    steps.forEach(function (x) { if (!x.inFade || !isFinite(x.from)) { inFade = false; return; } jump = Math.max(jump, Math.abs(x.from - x.before)); });
    return { l: l, jump: Math.round(jump * 1000) / 1000, mix: mix, inFade: inFade, steps: steps };
  }
  var two = await one(2), three = await one(3);
  s.check('TWICE: two quick changes (dark, light, dark again within a fade) end exactly dark, three end exactly light, and each change goes on from the very point the page shows (off by ' + Math.max(two.jump, three.jump) + ' at most)',
    lookIs(two.l, 'dark', 'dark') && lookIs(three.l, 'light', 'light') && two.mix === 0 && three.mix === 1 && two.inFade && three.inFade && two.jump < 0.02 && three.jump < 0.02, JSON.stringify([two, three]));
  var restart = routed(env, 'app.js', function (src) { return src.replace('var from = lookNow(), fade', "var from = lookShown === 'light' ? 1 : 0, fade"); });
  var c = await one(2, [restart]);
  s.check('... and an app that starts each change again from the look it left jumps when changed in a fade (control)', c.inFade && c.jump >= 0.06, JSON.stringify(c));
}

async function paceCase(s, env) {
  var t = await opn(env, { storage: { background: 'dark' } });
  await sleep(700);
  await t.eval(function () { window.Hourglass.setDuration(60000); });
  await sleep(2600);
  await t.eval(function () {
    window.Hourglass.start();
    var r = window.Hourglass.renderer, f = r._paperMix, w = window.__pace = { cost: [], frames: [] }, last = performance.now();
    r._paperMix = function () { var t0 = performance.now(); try { return f.apply(this, arguments); } finally { w.cost.push(performance.now() - t0); } };
    (function step(n) { w.frames.push(n - last); last = n; if (w.frames.length < 240) requestAnimationFrame(step); })(last);
  });
  await sleep(600);
  var a = await t.eval(function () { var W = window.Hourglass, T = W.timer; return { rem: T.rem - (Date.now() - T.lastTick), at: Date.now() }; });
  for (var i = 0; i < 3; i++) { await t.page.tap('#btn-look'); await sleep(500); }
  var b = await t.eval(function () {
    var W = window.Hourglass, T = W.timer, w = window.__pace, c = w.cost.slice().sort(function (x, y) { return x - y; });
    return { rem: T.rem - (Date.now() - T.lastTick), at: Date.now(), state: T.state, calls: c.length, worst: c[c.length - 1], median: c[c.length >> 1] };
  });
  await t.close();
  var drift = Math.abs((a.rem - (b.at - a.at)) - b.rem);
  s.check('PACE: three changes of look while a glass runs: its time the wall clock\'s (drift ' + Math.round(drift) + ' ms), the glass redrawn in each frame of a fade in ' + (b.median || 0).toFixed(1) + ' ms (the longest ' + (b.worst || 0).toFixed(1) + ' ms)',
    b.state === 'running' && drift <= 40 && b.calls >= 10 && b.worst < 16, JSON.stringify(b));
}

/* ---- the pills under the glass at every width (1.20.1) --------------------------------- */
async function pillsAt(env, w, look, quick, routes) {
  var st = { background: look }; if (quick) st.quick = quick;
  var t = await opn(env, { storage: st, viewport: { width: w, height: w >= 760 ? 800 : 844 }, routes: routes });
  await sleep(450);
  var r = await t.eval(function () {
    var row = document.getElementById('durations'), c = document.getElementById('pill-custom'), rr = row.getBoundingClientRect(), cr = c.getBoundingClientRect(), pr = document.querySelector('.panel').getBoundingClientRect();
    var ps = Array.prototype.map.call(row.querySelectorAll('.pill'), function (p) { var b = p.getBoundingClientRect(); return { t: p.textContent.trim(), l: b.left, r: b.right }; });
    return { n: ps.length, whole: ps.every(function (p) { return p.l >= rr.left - 0.5 && p.r <= rr.right + 0.5 && p.r <= cr.left + 0.5; }) && cr.right <= pr.right + 0.5 && cr.left >= pr.left,
      scroll: row.scrollWidth - row.clientWidth, last: ps[5] && ps[5].t, unit: getComputedStyle(row.querySelector('.pill i') || row).display, minW: getComputedStyle(row.querySelector('.pill')).minWidth };
  });
  if (SHOTS && w === 1280 && !quick) await t.page.screenshot({ path: path.join(SHOTS, 'mode-pills-' + look + '-1280' + (routes ? '-old' : '') + '.png'), clip: { x: 300, y: 600, width: 680, height: 200 } });
  await t.close();
  return r;
}
/* ---- a home-screen app: the app's box the window's, never taller (1.21.1) ---------------- */
// Release 1.20.2 sized the box, in a home-screen app, as tall as the larger of the window and
// 100vh / 100lvh; on an iPhone whose web view shows less of the page than those units measure
// (vh the whole screen) the box ran past what is shown and the control panel's foot was lost.
// 1.21.1 took the rule out: the box is the window's (inset: 0) everywhere. A test browser cannot
// be a home-screen app (display-mode cannot be emulated in it) and its vh is its window, so the
// home-screen app is played: every `@media (display-mode: standalone)` made true, and every 100vh
// and 100lvh measuring 56 px more than the window shows, as on that iPhone. The box must be the
// layout viewport's exactly, never taller; the stylesheet of STANDALONE_BASE (release 1.21.0, the
// rule still in it), played the same way, must give a box taller than the window (control).
var STANDALONE_BASE = process.env.HOURGLASS_STANDALONE_BASE || '2aba504';
function phoneCss(src) {
  return src.replace(/@media \(display-mode: standalone\)/g, '@media all').replace(/\b100(l?)vh\b/g, 'calc(100$1vh + 56px)');
}
function cssRoute(env, src) {
  var origin = env.url.replace(/\/$/, '');
  return { url: function (u) { return u.origin === origin && u.pathname === '/styles.css'; }, handler: function (route) {
    route.fulfill({ status: 200, contentType: 'text/css', body: src });
  } };
}
async function boxAt(env, look, size, routes) {
  var t = await opn(env, { storage: { background: look }, viewport: { width: size[0], height: size[1] }, routes: routes });
  await sleep(700);
  var b = await t.eval(function () {
    var r = document.getElementById('app').getBoundingClientRect(), p = document.querySelector('.panel').getBoundingClientRect();
    return { app: [r.left, r.top, r.width, r.height].map(Math.round), w: innerWidth, h: innerHeight, root: document.documentElement.clientHeight, panel: Math.round(p.bottom) };
  });
  await tune.open(t); await sleep(700);
  b.sheet = await t.eval(function () { var r = document.getElementById('sheet-settings').getBoundingClientRect(); return Math.round(r.bottom); });
  await t.close();
  return b;
}
async function standaloneCase(s, env) {
  var phone = cssRoute(env, phoneCss(fs.readFileSync(path.join(env.root, 'styles.css'), 'utf8')));
  var rows = [], ok = true, tab = {};
  for (var look of ['light', 'dark']) for (var size of [[393, 852], [1280, 800], [412, 915]]) for (var how of ['tab', 'standalone']) {
    var b = await boxAt(env, look, size, how === 'standalone' ? [phone] : null);
    var key = look + size.join('x'), was = tab[key];
    if (how === 'tab') tab[key] = b;
    var same = b.app[0] === 0 && b.app[1] === 0 && b.app[2] === b.w && b.app[3] === b.h && b.app[3] === b.root &&
      (how === 'tab' || (was && was.panel === b.panel && was.sheet === b.sheet));
    ok = ok && same;
    rows.push(look + ' ' + size.join('x') + ' ' + how + ': app ' + b.app.join(',') + ' of ' + b.w + 'x' + b.h + ' (layout viewport ' + b.root + '), bar to ' + b.panel + ', Tune to ' + b.sheet);
  }
  s.check('STANDALONE: in a home-screen app (played: its media query true, 100vh and 100lvh 56 px more than the window shows) the app\'s box is exactly the layout viewport\'s, never taller, at a phone\'s size, a PC window\'s and an Android phone\'s, in both looks, and the bar and Tune end where they do in a tab',
    ok, rows.join('; '));
  // control: 1.21.0's stylesheet, its home-screen rule played the same way, sizes the box past what is shown
  var src = null;
  try { src = require('./lib/base.js').show(STANDALONE_BASE, 'styles.css'); } catch (e) { /* (checked below) */ }
  var c = src ? await boxAt(env, 'light', [393, 852], [cssRoute(env, phoneCss(src))]) : null;
  s.check('... and with the stylesheet of ' + STANDALONE_BASE + ' (the box as tall as the larger of the window, 100vh and 100lvh) played the same way, the same measure sees the box run past the window (control)',
    !!c && c.app[3] > c.h && c.panel > c.h, c ? 'app ' + c.app.join(',') + ' of ' + c.w + 'x' + c.h + ', bar to ' + c.panel : 'git show failed: the commit is not in this clone');
}

/* ---- the readout under the version line (1.20.2) -------------------------------------------- */
async function measuresCase(s, env) {
  var t = await opn(env, { storage: { background: 'light' }, viewport: { width: 393, height: 852 } });
  try {
    await sleep(700);
    await tune.open(t);
    var before = await t.eval(function () { return !!document.getElementById('measures-line'); });
    await tune.tap(t, '#version-line');
    await sleep(200);
    var m = await t.eval(function () {
      var l = document.getElementById('measures-line'), v = document.getElementById('version-line'), r = document.getElementById('app').getBoundingClientRect();
      var want = 'screen ' + screen.width + '×' + screen.height + ' · window ' + innerWidth + '×' + innerHeight + ' · root ' + document.documentElement.clientHeight +
        ' · visual ' + Math.round(visualViewport.height * 10) / 10 + ' · insets 0 0 0 0 · standalone no · bar default · dpr ' + Math.round(devicePixelRatio * 10) / 10 +
        ' · app 0,0 ' + r.width + '×' + r.height;
      return { text: l && l.textContent, want: want, shown: !!l && !l.hidden && l.getBoundingClientRect().height > 0, after: !!l && v.nextElementSibling === l,
               size: l ? parseFloat(getComputedStyle(l).fontSize) : 0, stored: Object.keys(localStorage).join(',') };
    });
    await sleep(5000);
    var mid = await t.eval(function () { var l = document.getElementById('measures-line'); return !!l && !l.hidden; });
    await sleep(3500);
    var gone = await t.eval(function () { var l = document.getElementById('measures-line'); return !l || l.hidden; });
    s.check('MEASURES: a tap on the version line shows one small line under it, the page\'s measures exactly (' + m.text + '), still there 5 s later and gone by 8.7 s; nothing more is stored',
      !before && m.shown && m.after && m.text === m.want && m.size <= 11 && mid && gone && m.stored === 'hourglass.settings.v1', JSON.stringify(m) + ' mid ' + mid + ' gone ' + gone);
  } finally { await t.close(); }
  // in sight (1.22.0): on a small phone (a home-screen app's, its layout viewport 59 px short at the bottom: GROUND)
  // the version line is reached with Tune scrolled to its foot, and the line
  // shown under it is brought into the scroller's view (control: app.js without that, where it shows below the foot)
  var seen = await measuresSeen(env), unseen = await measuresSeen(env, [routed(env, 'app.js', function (src) {
    var o = src.replace("    if (m.scrollIntoView) m.scrollIntoView({ block: 'nearest' });", ''); if (o === src) throw new Error('app-mode: the readout\'s scroll is not in app.js'); return o; })]);
  s.check('MEASURES: at 375 x 667, the layout viewport ' + SHORT + ' px short, Tune scrolled to its foot, the line shown under the version line is in sight in the sheet\'s scroller, whole',
    seen.whole, JSON.stringify(seen));
  s.check('... and with app.js not bringing it into view it is below the scroller\'s foot (control)', unseen.shown && !unseen.whole, JSON.stringify(unseen));
}
/** Tune open on a small phone, scrolled to its foot, the version line tapped: where the readout is against its scroller. */
async function measuresSeen(env, routes) {
  var t = await opn(env, { storage: { background: 'light' }, viewport: { width: 375, height: 667 }, routes: [shortView(env, 'bottom')].concat(routes || []) });
  try {
    await sleep(700);
    await tune.open(t);
    await sleep(300);
    await t.eval(function () {
      var v = document.getElementById('version-line'), e = v.parentNode;
      while (e && e !== document.body && !(e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentNode;
      window.__scroller = e;
      if (e) e.scrollTop = e.scrollHeight;
    });
    await sleep(300);
    await t.eval(function () { document.getElementById('version-line').click(); });
    await sleep(900);
    return await t.eval(function () {
      var l = document.getElementById('measures-line'), e = window.__scroller;
      if (!l || !e) return { shown: false, scroller: !!e };
      var r = l.getBoundingClientRect(), b = e.getBoundingClientRect();
      return { shown: !l.hidden, line: [Math.round(r.top), Math.round(r.bottom)], view: [Math.round(b.top), Math.round(b.bottom)], whole: !l.hidden && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5 };
    });
  } finally { await t.close(); }
}

async function pillsCase(s, env) {
  var rows = [], ok = true, phone = true;
  for (var quick of [null, '99,99,99,99,99,99']) for (var w of [320, 360, 390, 430, 440, 441, 480, 560, 600, 768, 1024, 1280, 1600, 2560]) {
    for (var look of (w === 1280 || w === 390 ? ['dark', 'light'] : ['dark'])) {
      var r = await pillsAt(env, w, look, quick);
      var good = r.n === 6 && r.whole && r.scroll <= 0;
      ok = ok && good;
      // a phone keeps its own pills: no "m", the narrow ones
      if (w <= 440) phone = phone && r.unit === 'none' && (w <= 340 ? r.minW === '30px' : r.minW === '34px');
      if (!good) rows.push(w + ' ' + look + (quick ? ' 99s' : '') + ' ' + JSON.stringify(r));
    }
  }
  s.check('PILLS: the six pills and Custom show whole, with no scroll, at every width from 320 to 2560 px (the quick durations as they come and six of 99), in both looks', ok, rows.join(' | ') || 'all whole');
  s.check('PILLS: on a phone (440 px and under) they are the phone\'s pills, as they were: no "m", 34 px at least (30 on the narrowest)', phone, '');
  var old = routed(env, 'styles.css', function (src) { return src.replace('@container (max-width: 519px) {', '@container (max-width: 1px) {').replace('  .panel { max-width: 560px; }\n', ''); });
  var c = await pillsAt(env, 1280, 'dark', null, [old]);
  s.check('... and without the bar\'s own measure (the pills sized by the window alone, as before) the last pill is cut off by Custom at 1280 x 800 (control)', !c.whole || c.scroll > 0, JSON.stringify(c));
}

async function pictures(env) {
  if (!SHOTS) return;
  for (var look of ['dark', 'light']) {
    var t = await opn(env, { storage: { background: look }, viewport: { width: 393, height: 852 } });
    await sleep(800);
    await t.page.screenshot({ path: path.join(SHOTS, 'mode-2d-' + look + '.png') });
    await t.close();
  }
}

(async function main() {
  var s = new H.Suite('app-mode');
  // This process's own memory has an end as well. The suite holds about 150 MB; what ran it to
  // gigabytes was a page's answer too large for the protocol. Over RSS_MAX_MB it stops and says
  // so (looked at once a second, between the protocol's own long steps).
  setInterval(function () {
    var held = Math.round(process.memoryUsage().rss / 1048576);
    if (held <= RSS_MAX_MB) return;
    console.log('FAIL  app-mode: this process holds ' + held + ' MB, over ' + RSS_MAX_MB + ': something large came from a page; the suite is stopped');
    process.exit(1);
  }, 1000).unref();
  var env = await H.start();
  var only = env.args.only ? env.args.only.split(',') : null;
  var want = function (n) { return !only || only.indexOf(n) >= 0; };
  /**
   * One case to its end, or failed by name with what stopped it (a wait that ended, an answer
   * too large, anything thrown), the pages it left open closed; the next case goes on.
   */
  async function run(name, fn) {
    if (!want(name)) return;
    try { await fn(s, env); }
    catch (e) {
      s.check(name + ': the case ran to its end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
      while (OPEN.length) await OPEN[0].close().catch(function () {});
    }
  }
  try {
    await run('CHOICES', choices);
    await run('TUNE', tuneRow);
    await run('BUTTON', button);
    await run('OLD', oldSave);
    await run('RESET', reset);
    await run('FIRST', first);
    await run('SYSTEM', systemCase);
    await run('HOURS', hoursCase);
    await run('RUNNING', running);
    await run('CONTRAST', contrast);
    await run('OUTLINE', outlines);
    await run('PALE', paleSand);
    await run('LAYOUT', layout);
    await run('ZEN', zenButton);
    await run('DBL', dbl);
    await run('KEYS', keys);
    await run('GROUND', ground);
    await run('FADE', fadeCase);
    await run('LAUNCH', launchCase);
    await run('REDUCE', reduceCase);
    await run('TWICE', twiceCase);
    await run('PACE', paceCase);
    await run('PILLS', pillsCase);
    await run('STANDALONE', standaloneCase);
    await run('MEASURES', measuresCase);
    await pictures(env);
  } catch (e) {
    s.check('the suite ran to its end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    await env.close();
  }
  if (want('OUTLINE') || want('FADE')) {
    try { await webglOutline(s, env.root, env.port, want('OUTLINE'), want('FADE')); }
    catch (e) { s.check('OUTLINE and FADE (WebGL) ran', false, String(e && e.message)); }
  }
  s.done();
})();
