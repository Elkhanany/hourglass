#!/usr/bin/env node
/*
 * The look in the app (release 1.14.0): the sand and the frame's finish, chosen apart.
 *
 *   DEFAULT  with nothing saved: Sahara Quartz over walnut, drawn by the renderer's own bundle
 *            (its colour table and every static layer exactly what setTheme('sahara') draws),
 *            the page's colours the style sheet's own, the chip, the sand and the finish shown
 *   SANDS    each of the nine tapped in Tune: its own sand in the glass over the caps the frame
 *            had, the page's colours and the chip, one radio checked, saved; one of the six
 *            over its own caps is the renderer's own bundle again
 *   FINISH   each of the six finishes tapped: the caps change and the sand stays; hidden while
 *            the frame is off
 *   CUSTOM   Custom tapped with no colour made yet starts from a sea green and shows the well;
 *            a colour let go in the well is kept as asked and used clamped (the well shows the
 *            colour really used); 'custom' brings the last colour back; the page wears it
 *   DRAG     a colour dragged in the well: the colour table at most once a frame, the glass and
 *            frame not drawn again, nothing saved, until it is let go
 *   CHIP     the chip steps through the nine, then the custom sand once there is one; the
 *            finish stays
 *   SHIM     Hourglass.setTheme(id) is still the material of old: that sand over its own caps
 *   RELOAD   a sand, a finish and a custom colour come back after a reload
 *   NARROW   at 320 px: four sands a row, three finishes a row, every name whole, the well 44 px
 *
 * Every check has a control: a copy of the app (or of its style sheet) with one thing wrong
 * must fail it.
 *
 *   node tools/test/app-look.test.js [--root <dir>] [--port <n>] [--only <part>]
 */
'use strict';
var fs = require('fs');
var path = require('path');
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;
var KEY = 'hourglass.settings.v1';
var SIX = ['sahara', 'volcanic', 'moonstone', 'lapis', 'rosequartz', 'seaglass'];
var NINE = SIX.concat(['garnet', 'olivine', 'amethyst']);
var CAPS = { walnut: 'sahara', brass: 'volcanic', silver: 'moonstone', gold: 'lapis', copper: 'rosequartz', driftwood: 'seaglass' };
var NAMES = { sahara: 'Sahara Quartz', volcanic: 'Volcanic Black', moonstone: 'Moonstone', lapis: 'Lapis Lazuli', rosequartz: 'Rose Quartz', seaglass: 'Sea Glass',
              garnet: 'Red Garnet', olivine: 'Olivine', amethyst: 'Amethyst' };

/* ---- a copy with something broken, for a control (as app-tune makes them) ---------------- */
function broken(env, file, change) {
  var src = fs.readFileSync(path.join(env.root, file), 'utf8'), out = change(src);
  if (out === src) throw new Error('app-look: the control\'s change to ' + file + ' changed nothing');
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
    if (n !== 1) throw new Error('app-look: a control\'s text is in the file ' + n + ' times: ' + from.slice(0, 60));
    return src.replace(from, to);
  };
}
function add(text) { return function (src) { return src + '\n' + text + '\n'; }; }

/* ---- the page's side ----------------------------------------------------------------------- */
function pageInit() {
  window.__look = {
    hash: function (a) {
      var h = 2166136261 >>> 0, i;
      for (i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; }
      return h;
    },
    /** A hash of the colour table and of each static layer the renderer draws. */
    picture: function () {
      var R = window.Hourglass.renderer, L = window.__look;
      return L.hash(R.lut) + ' ' + ['c-back', 'c-front', 'c-light'].map(function (id) {
        var c = document.getElementById(id), x = c.getContext('2d');
        return L.hash(new Uint32Array(x.getImageData(0, 0, c.width, c.height).data.buffer));
      }).join(' ');
    },
    /** What the page shows of the look, and what the renderer and the save hold. */
    state: function () {
      var Hg = window.Hourglass, R = Hg.renderer, P = window.HourglassPhysics, root = document.documentElement;
      var st = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}'), capOf = null, k;
      for (k in P.THEMES) if (P.THEMES[k].cap === R.theme.cap) capOf = k;
      var on = function (q) { return Array.prototype.map.call(document.querySelectorAll(q + ' [aria-checked="true"]'), function (b) { return b.dataset.sand || b.dataset.finish; }).join(); };
      var well = document.getElementById('sand-color'), rows = document.getElementById('sandcolor-rows'), fin = document.getElementById('finish-sub');
      return {
        look: R.look, sandOf: (function () { for (var s in P.SANDS) if (P.SANDS[s].sand === R.theme.sand) return s; return R.theme.id; })(),
        capOf: capOf, bundle: R.theme === P.THEMES[R.theme.id],
        data: root.getAttribute('data-theme'), chip: document.getElementById('theme-name').textContent, chipLabel: document.getElementById('btn-theme').getAttribute('aria-label'),
        inline: root.style.getPropertyValue('--accent'), accent: getComputedStyle(root).getPropertyValue('--accent').trim(),
        sands: on('#sands'), finishes: on('#finishes'),
        well: { shown: !!rows && !rows.hidden, value: well ? well.value : null },
        orb: document.getElementById('orb-custom').style.background,
        finishShown: !!fin && !fin.hidden,
        saved: { sand: st.sand, sandColor: st.sandColor, finish: st.finish, theme: st.theme },
        fading: document.getElementById('assembly').classList.contains('fade')
      };
    }
  };
}
function state(t) { return t.eval(function () { return window.__look.state(); }); }
function js(x) { return JSON.stringify(x); }
async function settle(t) {
  await t.page.waitForFunction(function () { return !document.getElementById('assembly').classList.contains('fade'); }, null, { timeout: 4000 }).catch(function () {});
  await sleep(120);
}

/* ---- DEFAULT --------------------------------------------------------------------------------- */
async function defaults(env, o) {
  var t = await env.open(Object.assign({ init: pageInit, rawStorage: {} }, o || {}));
  try {
    await sleep(900);
    var m = { a: await state(t) };
    m.pic = await t.eval(function () {
      var R = window.Hourglass.renderer, L = window.__look, out = { now: L.picture() };
      R.setTheme('sahara');
      out.bundle = L.picture();
      return out;
    });
    m.sheet = await t.eval(function () {
      var root = document.documentElement, was = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'sahara');
      var c = getComputedStyle(root).getPropertyValue('--accent').trim();
      root.setAttribute('data-theme', was);
      return c;
    });
    m.errors = t.errors.slice();
    return m;
  } finally { await t.close(); }
}
function defaultsOk(m) {
  var a = m.a;
  return {
    ok: js(a.look) === js({ sand: 'sahara', material: 'sahara' }) && a.bundle && a.capOf === 'sahara' && a.data === 'sahara' && a.chip === 'Sahara Quartz' &&
        a.chipLabel === 'Change sand' && a.inline === '' && a.accent === '#e9b872' && a.sands === 'sahara' && a.finishes === 'walnut' && !a.well.shown && a.finishShown &&
        a.saved.sand === 'sahara' && a.saved.finish === 'walnut' && a.saved.sandColor === '' && a.saved.theme === 'sahara' && m.pic.now === m.pic.bundle && m.errors.length === 0,
    detail: js(a) + ' picture ' + m.pic.now + (m.pic.now === m.pic.bundle ? ' = ' : ' FOR ') + m.pic.bundle + ' ' + m.errors.slice(0, 2).join(' | ')
  };
}

/* ---- SANDS, FINISH, CHIP, SHIM, RELOAD ------------------------------------------------------- */
async function walk(env, o) {
  var t = await env.open(Object.assign({ init: pageInit }, o || {})), m = { sands: {}, finishes: {}, bundles: {} };
  try {
    await sleep(900);
    for (var i = 0; i < NINE.length; i++) {
      await tune.tap(t, '#sands [data-sand="' + NINE[i] + '"]');
      await settle(t);
      m.sands[NINE[i]] = await state(t);
    }
    // the six finishes, under Red Garnet
    await tune.tap(t, '#sands [data-sand="garnet"]'); await settle(t);
    var fins = Object.keys(CAPS);
    for (i = 0; i < fins.length; i++) {
      await tune.tap(t, '#finishes [data-finish="' + fins[i] + '"]');
      await settle(t);
      m.finishes[fins[i]] = await state(t);
    }
    // one of the six over its own caps: the renderer's own bundle, picture for picture
    await tune.tap(t, '#sands [data-sand="lapis"]'); await settle(t);
    await tune.tap(t, '#finishes [data-finish="gold"]'); await settle(t);
    m.lapisGold = await state(t);
    m.lapisPic = await t.eval(function () { var R = window.Hourglass.renderer, L = window.__look, a = L.picture(); R.setTheme('lapis'); return [a, L.picture()]; });
    // the frame off: no finish to choose
    await tune.tap(t, '#opt-frame'); await settle(t);
    m.frameOff = await state(t);
    await tune.tap(t, '#opt-frame'); await settle(t);
    m.frameOn = await state(t);
    // the chip: through the nine (no custom sand yet), the finish kept
    await tune.close(t);
    await t.eval(function () { window.Hourglass.setSand('amethyst'); });
    await settle(t);
    m.chip = [];
    for (i = 0; i < 2; i++) { await t.page.tap('#btn-theme'); await settle(t); m.chip.push(await state(t)); }
    // the shim: the material of old
    await t.eval(function () { window.Hourglass.setTheme('moonstone'); });
    await settle(t);
    m.shim = await state(t);
    // a reload keeps a sand and a finish
    await t.eval(function () { window.Hourglass.setSand('olivine'); window.Hourglass.setFinish('copper'); });
    await settle(t);
    await t.page.reload();
    await t.page.waitForFunction(function () { return window.Hourglass && window.__look; }, null, { timeout: 20000 });
    await sleep(900);
    m.reload = await state(t);
    m.errors = t.errors.slice();
    return m;
  } finally { await t.close(); }
}
function walkOk(m) {
  var sBad = [], fBad = [];
  var finishWas = 'walnut';
  NINE.forEach(function (id) {
    var a = m.sands[id], own = SIX.indexOf(id) >= 0;
    if (!a || a.sandOf !== id || a.look.sand !== id || a.capOf !== CAPS[finishWas] || a.data !== id || a.chip !== NAMES[id] || a.sands !== id || a.finishes !== finishWas ||
        a.saved.sand !== id || a.saved.finish !== finishWas || a.saved.theme !== (own ? id : 'seaglass') || a.inline !== '' || a.fading || a.bundle !== (id === 'sahara'))
      sBad.push(id + ' ' + js(a));
  });
  Object.keys(CAPS).forEach(function (f) {
    var a = m.finishes[f];
    if (!a || a.capOf !== CAPS[f] || a.look.material !== CAPS[f] || a.sandOf !== 'garnet' || a.finishes !== f || a.sands !== 'garnet' || a.saved.finish !== f || a.saved.sand !== 'garnet' || a.bundle)
      fBad.push(f + ' ' + js(a));
  });
  var lg = m.lapisGold, c0 = m.chip[0], c1 = m.chip[1];
  return {
    sands: { ok: sBad.length === 0, detail: sBad.length ? sBad.slice(0, 2).join(' | ') : 'the nine, each over walnut, Sahara Quartz alone the bundle' },
    finish: { ok: fBad.length === 0 && !m.frameOff.finishShown && m.frameOn.finishShown,
              detail: (fBad.slice(0, 2).join(' | ') || 'the six caps under Red Garnet') + '; frame off: finish row ' + (m.frameOff.finishShown ? 'SHOWN' : 'hidden') + ', on: ' + (m.frameOn.finishShown ? 'shown' : 'HIDDEN') },
    bundle: { ok: lg.bundle && lg.sandOf === 'lapis' && lg.capOf === 'lapis' && m.lapisPic[0] === m.lapisPic[1], detail: js(lg.look) + ' bundle ' + lg.bundle + ' picture ' + m.lapisPic.join(' / ') },
    chip: { ok: c0.sandOf === 'sahara' && c0.saved.sand === 'sahara' && c1.sandOf === 'volcanic' && c0.capOf === 'lapis' && c1.capOf === 'lapis' && c1.chip === 'Volcanic Black' && c1.saved.finish === 'gold',
            detail: 'amethyst → ' + c0.sandOf + ' → ' + c1.sandOf + ', caps ' + c0.capOf + ', ' + c1.capOf },
    shim: { ok: m.shim.bundle && m.shim.sandOf === 'moonstone' && m.shim.capOf === 'moonstone' && m.shim.saved.finish === 'silver' && m.shim.saved.theme === 'moonstone' && m.shim.finishes === 'silver',
            detail: js(m.shim) },
    reload: { ok: m.reload.sandOf === 'olivine' && m.reload.capOf === 'rosequartz' && m.reload.sands === 'olivine' && m.reload.finishes === 'copper' && m.reload.chip === 'Olivine', detail: js(m.reload) },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- CUSTOM and DRAG ------------------------------------------------------------------------- */
async function custom(env, o) {
  var t = await env.open(Object.assign({ init: pageInit }, o || {})), m = {};
  try {
    await sleep(900);
    m.before = await state(t);
    await tune.tap(t, '#sands [data-sand="custom"]'); await settle(t);
    m.first = await state(t);
    m.firstClamp = await t.eval(function () { var P = window.HourglassPhysics; return P.customSand.clamp(185, 0.5, 0.5); });
    // white, let go in the well: kept as asked, used clamped, the well showing what is used
    await tune.show(t, '#sand-color');
    await t.eval(function () {
      var w = document.getElementById('sand-color');
      w.value = '#ffffff'; w.dispatchEvent(new Event('input', { bubbles: true })); w.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(t);
    m.white = await state(t);
    m.whiteUsed = await t.eval(function () {
      var R = window.Hourglass.renderer, P = window.HourglassPhysics, c = P.customSand.clamp(0, 0, 1);
      return { clamp: c, sand: [R.theme.sand.h, R.theme.sand.s, R.theme.sand.l], tokens: P.customSand(0, 0, 1).ui.accent };
    });
    // a drag: thirty inputs in one go, then two frames: the table once, no static layer, nothing saved
    m.drag = await t.eval(function () {
      return new Promise(function (resolve) {
        var R = window.Hourglass.renderer, n = { live: 0, full: 0, statics: 0 }, sl = R.setLook, ds = R.drawStatic, w = document.getElementById('sand-color');
        var savedWas = localStorage.getItem('hourglass.settings.v1');
        R.setLook = function (look, live) { if (live) n.live++; else n.full++; return sl.apply(R, arguments); };
        R.drawStatic = function () { n.statics++; return ds.apply(R, arguments); };
        for (var i = 0; i < 30; i++) { w.value = '#' + (0x206040 + i * 0x020100).toString(16); w.dispatchEvent(new Event('input', { bubbles: true })); }
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          var mid = { live: n.live, full: n.full, statics: n.statics, saved: localStorage.getItem('hourglass.settings.v1') === savedWas, look: R.look.sand };
          w.dispatchEvent(new Event('change', { bubbles: true }));
          var end = { live: n.live, full: n.full, statics: n.statics, saved: JSON.parse(localStorage.getItem('hourglass.settings.v1')).sandColor };
          R.setLook = sl; R.drawStatic = ds;
          resolve({ mid: mid, end: end, value: w.value });
        }); });
      });
    });
    // another sand, then Custom again: the colour comes back
    await tune.tap(t, '#sands [data-sand="seaglass"]'); await settle(t);
    m.away = await state(t);
    await tune.tap(t, '#sands [data-sand="custom"]'); await settle(t);
    m.back = await state(t);
    // the chip with a custom sand made: amethyst, then custom, then sahara
    await tune.close(t);
    await t.eval(function () { window.Hourglass.setSand('amethyst'); }); await settle(t);
    await t.page.tap('#btn-theme'); await settle(t);
    m.chip1 = await state(t);
    await t.page.tap('#btn-theme'); await settle(t);
    m.chip2 = await state(t);
    // a reload: the custom sand chosen, its colour
    await t.eval(function () { window.Hourglass.setSand('custom'); }); await settle(t);
    await t.page.reload();
    await t.page.waitForFunction(function () { return window.Hourglass && window.__look; }, null, { timeout: 20000 });
    await sleep(900);
    m.reload = await state(t);
    m.errors = t.errors.slice();
    return m;
  } finally { await t.close(); }
}
function hex(c) {
  // (as the app writes it: the colour { h, s, l } as #rrggbb)
  var s = c.s, l = c.l, k = function (n) { return (n + c.h / 30) % 12; }, a = s * Math.min(l, 1 - l);
  var f = function (n) { var v = Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); return (v < 16 ? '0' : '') + v.toString(16); };
  return '#' + f(0) + f(8) + f(4);
}
function customOk(m) {
  var f = m.first, w = m.white, u = m.whiteUsed, d = m.drag;
  return {
    first: { ok: !m.before.well.shown && f.look.sand && typeof f.look.sand === 'object' && f.saved.sand === 'custom' && f.saved.sandColor === '185,0.5,0.5' && f.sands === 'custom' &&
                 f.well.shown && f.well.value === hex(m.firstClamp) && f.chip === 'Custom' && f.data === null && f.inline !== '' && f.orb !== '' && f.capOf === 'sahara' && f.saved.theme === 'sahara',
             detail: js(f) },
    white: { ok: w.saved.sandColor === '0,0,1' && js(w.look.sand) === js({ h: 0, s: 0, l: 1 }) && u.sand[0] === Math.round(u.clamp.h) && u.sand[2] === u.clamp.l && u.clamp.l < 1 &&
                 w.well.value === hex(u.clamp) && w.well.value !== '#ffffff' && w.inline === u.tokens,
             detail: 'saved ' + w.saved.sandColor + ', used ' + js(u.sand) + ' (clamp ' + js(u.clamp) + '), the well ' + w.well.value + ', accent ' + w.inline + ' for ' + u.tokens },
    drag: { ok: d.mid.live >= 1 && d.mid.live <= 2 && d.mid.full === 0 && d.mid.statics === 0 && d.mid.saved && typeof d.mid.look === 'object' && d.end.full === 1 && d.end.statics >= 1 && /^\d/.test(d.end.saved),
            detail: js(d) },
    again: { ok: m.away.sandOf === 'seaglass' && m.away.orb !== '' && m.back.saved.sand === 'custom' && m.back.saved.sandColor === m.drag.end.saved && m.back.well.shown,
             detail: js(m.away.saved) + ' → ' + js(m.back.saved) },
    chip: { ok: m.chip1.saved.sand === 'custom' && m.chip1.chip === 'Custom' && m.chip2.saved.sand === 'sahara', detail: m.chip1.saved.sand + ' → ' + m.chip2.saved.sand },
    reload: { ok: m.reload.saved.sand === 'custom' && m.reload.look.sand && typeof m.reload.look.sand === 'object' && m.reload.well.shown && m.reload.inline !== '' && m.reload.chip === 'Custom', detail: js(m.reload) },
    errors: { ok: m.errors.length === 0, detail: m.errors.slice(0, 2).join(' | ') }
  };
}

/* ---- NARROW ---------------------------------------------------------------------------------- */
async function narrow(env, o) {
  var t = await env.open(Object.assign({ viewport: { width: 320, height: 568 }, init: pageInit }, o || {})), m = {};
  try {
    await sleep(900);
    await tune.tap(t, '#sands [data-sand="custom"]'); await settle(t);
    await tune.show(t, '#sand-color');
    m.sand = await t.eval(function () {
      var tops = function (q) { var ys = []; Array.prototype.forEach.call(document.querySelectorAll(q), function (b) { var y = Math.round(b.getBoundingClientRect().top); if (ys.indexOf(y) < 0) ys.push(y); }); return ys.length; };
      var cut = Array.prototype.filter.call(document.querySelectorAll('#sands .nm, #finishes .nm'), function (e) { return e.getClientRects().length && e.scrollWidth > e.clientWidth + 1; }).map(function (e) { return e.textContent; });
      var w = document.getElementById('sand-color').getBoundingClientRect(), b = document.querySelector('#sands button').getBoundingClientRect();
      return { sandRows: tops('#sands button'), cut: cut, well: [Math.round(w.width), Math.round(w.height)], button: [Math.round(b.width), Math.round(b.height)], docW: document.documentElement.scrollWidth };
    });
    await tune.show(t, '#finishes [data-finish="walnut"]');
    m.glass = await t.eval(function () {
      var ys = []; Array.prototype.forEach.call(document.querySelectorAll('#finishes button'), function (b) { var y = Math.round(b.getBoundingClientRect().top); if (ys.indexOf(y) < 0) ys.push(y); });
      var b = document.querySelector('#finishes button').getBoundingClientRect();
      return { finishRows: ys.length, button: [Math.round(b.width), Math.round(b.height)] };
    });
    m.errors = t.errors.slice();
    return m;
  } finally { await t.close(); }
}
function narrowOk(m) {
  return { ok: m.sand.sandRows === 3 && m.glass.finishRows === 2 && m.sand.cut.length === 0 && m.sand.well[0] >= 44 && m.sand.well[1] >= 44 && m.sand.button[0] >= 44 && m.sand.button[1] >= 44 &&
               m.glass.button[0] >= 44 && m.sand.docW <= 320 && m.errors.length === 0,
           detail: js(m) };
}

/* ---- the run --------------------------------------------------------------------------------- */
(async function () {
  var env = await H.start(), s = new H.Suite('app-look'), only = env.args.only;
  function wanted(name) { return !only || only.toLowerCase() === name.toLowerCase(); }
  function failing(v) { return v.ok !== undefined ? (v.ok ? [] : ['it']) : Object.keys(v).filter(function (k) { return !v[k].ok; }); }
  async function control(label, part, measure, verdict) {
    var v, why;
    try { v = verdict(await measure()); } catch (e) { why = 'the copy could not be measured: ' + String(e && e.message || e).split('\n')[0]; }
    var bad = v ? failing(v) : [], hit = v ? (part ? bad.indexOf(part) >= 0 : bad.length > 0) : false;
    s.check('CONTROL ' + label, hit, why || (hit ? 'fails: ' + (part ? v[part].detail : (v.detail || bad.join(', '))) : 'PASSES; failing only ' + (bad.join(', ') || 'nothing')));
  }
  function app(change) { return { routes: [broken(env, 'app.js', change)] }; }
  try {
    if (wanted('default')) {
      var d = defaultsOk(await defaults(env));
      s.check('DEFAULT: nothing saved: Sahara Quartz over walnut, drawn by the renderer\'s own bundle (the colour table and every static layer exactly what setTheme(\'sahara\') draws), the style sheet\'s colours, the chip ("Change sand"), the sand and the finish shown, saved so', d.ok, d.detail);
      await control('DEFAULT: a copy that always puts the look together by setLook (never the bundle)', null, function () {
        return defaults(env, app(swap('    if (settings.sand === material) renderer.setTheme(material);\n', '    if (false) renderer.setTheme(material);\n')));
      }, defaultsOk);
    }
    if (wanted('walk')) {
      var w = walkOk(await walk(env));
      s.check('SANDS: each of the nine tapped in Tune is the sand in the glass, over the caps the frame had (walnut); its name on the chip, its colours on the page, its radio alone checked, saved (the material follows the six only); Sahara Quartz over walnut alone the bundle', w.sands.ok, w.sands.detail);
      s.check('FINISH: each of the six finishes tapped puts its caps on the frame and leaves the sand (Red Garnet); the finish is hidden while the frame is off', w.finish.ok, w.finish.detail);
      s.check('BUNDLE: Lapis Lazuli chosen with the gold finish is the renderer\'s own lapis, picture for picture', w.bundle.ok, w.bundle.detail);
      s.check('CHIP: the chip steps from Amethyst to Sahara Quartz and Volcanic Black (no custom sand yet), and the finish stays', w.chip.ok, w.chip.detail);
      s.check('SHIM: Hourglass.setTheme(\'moonstone\') is the material of old: Moonstone over silver caps, the renderer\'s own bundle, saved so', w.shim.ok, w.shim.detail);
      s.check('RELOAD: Olivine over copper comes back after a reload', w.reload.ok, w.reload.detail);
      s.check('no page or console errors', w.errors.ok, w.errors.detail);
      await control('SANDS: a copy whose sand takes the caps of its own material (as the material of old)', 'sands', function () {
        return walk(env, app(swap("      if (own(P.THEMES, v)) settings.theme = v;\n", "      if (own(P.THEMES, v)) { settings.theme = v; settings.finish = P.finishOf(v); }\n")));
      }, walkOk);
      await control('FINISH: a copy that leaves the finish row shown while the frame is off', 'finish', function () {
        return walk(env, app(swap("  function showFinishRow() { if ($('finish-sub')) $('finish-sub').hidden = !settings.frame; }", "  function showFinishRow() {}")));
      }, walkOk);
      await control('CHIP: a copy whose chip steps the six materials, caps and all', 'chip', function () {
        return walk(env, app(swap("    setSand(order[(order.indexOf(settings.sand) + 1) % order.length], true);", "    var six = ['sahara', 'volcanic', 'moonstone', 'lapis', 'rosequartz', 'seaglass']; setTheme(six[(six.indexOf(settings.theme) + 1) % six.length], true);")));
      }, walkOk);
    }
    if (wanted('custom')) {
      var c = customOk(await custom(env));
      s.check('CUSTOM: Custom tapped with no colour made starts from a sea green (185, 50 %, 50 %), shows the well with the colour really used, names it on the chip and wears its colours (the frame keeps walnut, the material stays)', c.first.ok, c.first.detail);
      s.check('CUSTOM: white let go in the well is kept as asked ("0,0,1") and used clamped: the sand is customSand.clamp\'s, the well shows that colour, the page its accent', c.white.ok, c.white.detail);
      s.check('DRAG: thirty colours in one frame from the well: the colour table once a frame, the glass and frame not drawn, nothing saved; let go, the look is drawn and saved once', c.drag.ok, c.drag.detail);
      s.check('CUSTOM: another sand, then Custom again: the colour comes back (and its swatch keeps it meanwhile)', c.again.ok, c.again.detail);
      s.check('CHIP: with a custom sand made, the chip goes Amethyst, Custom, Sahara Quartz', c.chip.ok, c.chip.detail);
      s.check('RELOAD: the custom sand and its colour come back after a reload', c.reload.ok, c.reload.detail);
      s.check('CUSTOM: no page or console errors', c.errors.ok, c.errors.detail);
      await control('CUSTOM: a copy whose well shows the colour asked, not the one used', 'white', function () {
        return custom(env, app(swap('    if (well && c && !live) well.value = hexOf(P.customSand.clamp(c.h, c.s, c.l));', '    if (well && c && !live) well.value = hexOf(c);')));
      }, customOk);
      await control('DRAG: a copy that draws the whole look on every move of the finger', 'drag', function () {
        return custom(env, app(swap("    $('sand-color').addEventListener('input', function (e) { var c = hslOfHex(e.target.value); if (c) dragSand(c); });",
                                    "    $('sand-color').addEventListener('input', function (e) { var c = hslOfHex(e.target.value); if (c) setSand(c); });")));
      }, customOk);
      await control('CUSTOM: a copy whose Custom does nothing until a colour is made', 'first', function () {
        return custom(env, app(swap("    if (id === 'custom' && !Store.colorOf(settings.sandColor)) setSand(CUSTOM_FIRST, true);", "    if (id === 'custom' && !Store.colorOf(settings.sandColor)) return;")));
      }, customOk);
    }
    if (wanted('narrow')) {
      var n = narrowOk(await narrow(env));
      s.check('NARROW: at 320 x 568, four sands a row (three rows), three finishes a row, every name whole, the well and every sand at least 44 px, nothing wider than the screen', n.ok, n.detail);
      await control('NARROW: a style sheet that keeps five sands a row on the narrowest phones', null, function () {
        return narrow(env, { routes: [broken(env, 'styles.css', swap('@media (max-width: 339px) { .sands { grid-template-columns: repeat(4, 1fr); } }', ''))] });
      }, narrowOk);
    }
  } catch (e) {
    s.check('the suite ran to its end', false, String(e && e.stack || e).split('\n').slice(0, 4).join(' '));
  }
  await env.close();
  s.done();
})();
