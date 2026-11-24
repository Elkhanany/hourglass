/*
 * Breathing pace: the glow behind the glass swells through the in-breath,
 * holds, and fades through the out-breath, while the sand is running.
 *
 *   tune    the Tune row (the Time tab: the first under "While it runs",
 *           before Full Zen; off by default), its note, the
 *           three-way choice under it (hidden while off; Calm 4·6, Box
 *           4·4·4·4, Deep 4·7·8), one toast on switching on, both saved,
 *           the choice on one line at 360, 390 and 430 px, the main screen
 *           as lean as before; switched on while the sand runs it swells at
 *           once, switched off it eases back before the layer goes; the
 *           toast sits just above the sheet, clear of the tabs and the rows,
 *           fades there when the sheet is closed, and elsewhere keeps its
 *           usual place
 *   calm    from the start of the glass: in for 4 s on a sine ease, out for
 *           6 s, again at 10 s; only opacity and scale move, as two
 *           transitions on a compositor layer of its own that is never
 *           painted again; a handful of style writes and one short timer
 *           callback for each part of a breath; no text cue, no haptics
 *   rest    paused, finished or reset, the glow eases back to rest without a
 *           jump and stays there; started again it begins with an in-breath;
 *           the Flip button's turn on a running glass leaves it undisturbed
 *   box, deep   the holds and the lengths of the other two patterns, and a
 *           new pattern chosen mid-breath goes on from where the glow is
 *   clock   the breath keeps its place by the wall clock: a blocked main
 *           thread across the turn of a breath, a hidden page, and a long
 *           sleep all come back where the clock says
 *   reduce  Reduce Motion: no scaling at all, brightness only
 *   zen     in Full Zen the controls are gone and the glow still breathes
 *           (the frame's own work is noted)
 *   saved   the switch and the pattern survive a reload, a restored running
 *           glass breathes, every sand tints the layer with its own glow,
 *           in landscape the glow stays a halo round the glass, and a saved
 *           pattern this version does not know (or a damaged one) is Calm
 *
 *   node tools/test/app-breath.test.js [--root <dir>] [--port <n>] [--only <name>]
 */
'use strict';
var H = require('./stubs/harness.js');
var tuneSheet = require('./lib/tune.js');
var sleep = H.sleep;

var SKEY = 'hourglass.settings.v1';
var PATTERNS = { calm: [4, 0, 6, 0], box: [4, 4, 4, 4], deep: [4, 7, 8, 0] };   // s: in, hold, out, hold
var TOAST = 'Breathe in as the glow swells, out as it fades';
var NOTE = 'The glow swells as you breathe in and fades as you breathe out';
var GLOW = { sahara: '255, 176, 92', volcanic: '214, 164, 78', moonstone: '168, 196, 235',
             lapis: '104, 136, 230', rosequartz: '236, 168, 178', seaglass: '150, 212, 198' };

function sine(u) { u = u < 0 ? 0 : (u > 1 ? 1 : u); return (1 - Math.cos(Math.PI * u)) / 2; }
/** The glow pattern p asks for, t seconds into a run of breaths: 0 at rest, 1 full. */
function ideal(p, t) {
  var c = p[0] + p[1] + p[2] + p[3];
  t -= Math.floor(t / c) * c;
  if (t < p[0]) return sine(t / p[0]);
  t -= p[0];
  if (t < p[1]) return 1;
  t -= p[1];
  if (t < p[2]) return 1 - sine(t / p[2]);
  return 0;
}
function f2(x) { return (+x).toFixed(2); }
function f3(x) { return (+x).toFixed(3); }

/**
 * Sample the layer every frame: [wall time, opacity, scale (0: transform none), has .in, breath.on].
 * The time is the frame's own (the animation clock the browser read the
 * transition at), as wall time: a callback that runs late is not mistaken
 * for a late breath.
 */
function sampleStart(t) {
  return t.eval(function () {
    var el = document.getElementById('breath'), B = window.Hourglass.breath;
    if (window.__bs) window.__bs.on = false;
    var s = window.__bs = { on: true, out: [] };
    (function tick(ts) {
      if (!s.on) return;
      var cs = getComputedStyle(el), m = /matrix\(([-\d.e]+)/.exec(cs.transform);
      s.out.push([ts ? performance.timeOrigin + ts : Date.now(), +cs.opacity, m ? +m[1] : (cs.transform === 'none' ? 0 : NaN),
                  el.classList.contains('in') ? 1 : 0, B.on ? 1 : 0]);
      requestAnimationFrame(tick);
    })();
  });
}
function sampleStop(t) {
  return t.eval(function () { window.__bs.on = false; return window.__bs.out; });
}
/** Column k of the samples at wall time T (ms), between the two frames around it; NaN where frames are missing. */
function at(s, T, k) {
  k = k || 1;
  for (var i = 1; i < s.length; i++) {
    if (s[i][0] >= T) {
      var a = s[i - 1], b = s[i];
      if (a[0] > T || b[0] - a[0] > 700) return NaN;
      return b[0] === a[0] ? b[k] : a[k] + (b[k] - a[k]) * (T - a[0]) / (b[0] - a[0]);
    }
  }
  return NaN;
}
/** The frame nearest wall time T (null if none within 600 ms: a busy machine may skip a few). */
function frameAt(s, T) {
  var best = null, bd = 600;
  for (var i = 0; i < s.length; i++) {
    var d = Math.abs(s[i][0] - T);
    if (d <= bd) { bd = d; best = s[i]; } else if (s[i][0] > T) break;
  }
  return best;
}
/** The largest and smallest of column k between wall times T0 and T1. */
function range(s, T0, T1, k) {
  k = k || 1;
  var lo = Infinity, hi = -Infinity, n = 0;
  for (var i = 0; i < s.length; i++) {
    if (s[i][0] < T0 || s[i][0] > T1) continue;
    if (s[i][k] < lo) lo = s[i][k];
    if (s[i][k] > hi) hi = s[i][k];
    n++;
  }
  return { lo: lo, hi: hi, n: n };
}
/** The largest step of the glow between two frames beyond what the slowest and fastest eases allow (0.7 /s). */
function worstJump(s, T0, T1) {
  var worst = 0;
  for (var i = 1; i < s.length; i++) {
    if (s[i][0] < T0 || s[i][0] > T1) continue;
    var d = Math.abs(s[i][1] - s[i - 1][1]) - 0.7 * (s[i][0] - s[i - 1][0]) / 1000;
    if (d > worst) worst = d;
  }
  return worst;
}
/** Which part of which breath t seconds is in (4 × breath + part: 0 in, 1 held full, 2 out, 3 held at rest). */
function partOf(p, t) {
  var c = p[0] + p[1] + p[2] + p[3], n = Math.floor(t / c), i = 0;
  t -= n * c;
  while (t >= p[i]) { t -= p[i]; i++; }
  return 4 * n + i;
}
/**
 * The glow against the pattern at the given seconds after t0. The compositor
 * picks a transition up a little after the script asks for it (a few frames;
 * longer here, where it works in software and the layer's first picture is
 * drawn by the CPU), so each part of a breath may run up to MAX_LAG behind
 * the clock, never ahead of it. At the lag that fits it best, a part must
 * lie within 0.035 of the sine ease at every time asked for. The lag never
 * adds up: the next part is begun from the clock again (CLOCK checks that).
 */
var MAX_LAG = 0.4;
function follows(s, t0, p, times) {
  var groups = [], ok = true, out = [], lag0 = 0;
  times.forEach(function (x) {
    var g = groups[groups.length - 1];
    if (g && partOf(p, g[0]) === partOf(p, x)) g.push(x); else groups.push([x]);
  });
  groups.forEach(function (g, k) {
    // each time is read from the frame nearest to it, at that frame's own time
    var fr = g.map(function (x) { return frameAt(s, t0 + x * 1000); });
    var best = { worst: 2, lag: 0 };
    for (var lag = 0; lag <= MAX_LAG + 1e-9; lag += 0.02) {
      var worst = 0;
      for (var i = 0; i < g.length; i++) {
        var d = fr[i] ? Math.abs(fr[i][1] - ideal(p, (fr[i][0] - t0) / 1000 - lag)) : 1;
        if (d > worst) worst = d;
      }
      if (worst < best.worst) best = { worst: worst, lag: lag };
    }
    if (best.worst > 0.035) ok = false;
    if (!k) lag0 = best.lag;
    out.push(g.map(function (x, i) {
      return (+x.toFixed(1)) + ' s ' + (fr[i] ? f2(fr[i][1]) + ' (' + f2(ideal(p, (fr[i][0] - t0) / 1000)) + ')' : 'no frame');
    }).join(', ') + ' [' + Math.round(best.lag * 1000) + ' ms behind]');
  });
  return { ok: ok, detail: out.join('; '), lag: lag0 };
}
/** One reading against the pattern at t seconds, with the same allowance. */
function near(got, p, t) {
  for (var lag = 0; lag <= MAX_LAG + 1e-9; lag += 0.02) if (Math.abs(got - ideal(p, t - lag)) <= 0.035) return true;
  return false;
}
/**
 * Clear (≤ 0.02) at x seconds, where the pattern is at rest, in a frame
 * within 120 ms of it; a busy machine may have drawn none that near, and
 * then the nearest frame must be where the pattern says.
 */
function restsAt(s, t0, p, x) {
  var r = range(s, t0 + x * 1000 - 120, t0 + x * 1000 + 120), f = frameAt(s, t0 + x * 1000);
  if (r.n) return { ok: r.lo <= 0.02, detail: 'down to ' + f3(r.lo) + ' at ' + x + ' s' };
  return { ok: !!f && near(f[1], p, (f[0] - t0) / 1000), detail: f ? f3(f[1]) + ' at ' + ((f[0] - t0) / 1000).toFixed(2) + ' s (no frame nearer ' + x + ' s)' : 'no frame near ' + x + ' s' };
}
/** Full (≥ 0.97) at x seconds, where the pattern is full, the same way. */
function fullAt(s, t0, p, x) {
  var r = range(s, t0 + x * 1000 - 100, t0 + x * 1000 + 150), f = frameAt(s, t0 + x * 1000);
  if (r.n) return { ok: r.hi >= 0.97, detail: 'up to ' + f3(r.hi) + ' at ' + x + ' s' };
  return { ok: !!f && near(f[1], p, (f[0] - t0) / 1000), detail: f ? f3(f[1]) + ' at ' + ((f[0] - t0) / 1000).toFixed(2) + ' s (no frame nearer ' + x + ' s)' : 'no frame near ' + x + ' s' };
}
function settingsOf(t) {
  return t.eval(function (k) { return JSON.parse(localStorage.getItem(k) || '{}'); }, SKEY);
}
function seed(o) {
  var st = {};
  st[SKEY] = Object.assign({ muted: true }, o);
  return st;
}
function breathT0(t) { return t.eval(function () { return window.Hourglass.breath.t0; }); }
/** Open Tune on the tab that holds Breathing pace and bring its row into view (out of Zen first: two fingers pinching together). */
async function openTune(t) {
  if (await t.eval(function () { return document.getElementById('app').classList.contains('zen'); })) {
    var g = await t.glass();
    await t.touch.pinch(g.cx, g.cy, 230, 90, 260);
    await sleep(650);
  }
  await tuneSheet.show(t, '#opt-breath');          // (lib/tune.js: Tune opened, the row's tab shown, the row in view)
}
async function closeTune(t) {
  await tuneSheet.close(t);
  await sleep(150);
}

/* ---- tune: the row, the choice, the toast, what is saved --------------- */
async function tune(s, env) {
  var t = await env.open({});
  await t.eval(function () {
    var toast = document.getElementById('toast');
    window.__toasts = [];
    new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) if (recs[i].addedNodes.length) window.__toasts.push(toast.textContent);
    }).observe(toast, { childList: true });
  });
  var ui = await t.eval(function () {
    // its group: the rows under one heading of one tab
    var row = document.getElementById('opt-breath').closest('.row'), rows = [].slice.call(row.parentNode.children), i = rows.indexOf(row);
    var sw = document.getElementById('opt-breath'), layer = document.getElementById('breath'), w = window.__tune.where('#opt-breath');
    var head = row.parentNode.previousElementSibling;
    return {
      top: document.querySelectorAll('#hud-top button').length,
      bottom: document.querySelectorAll('#hud-bottom button').length,
      rows: document.querySelectorAll('#sheet-settings .row').length,
      tab: w.name, group: head && head.tagName === 'H3' ? head.textContent : null,
      before: i > 0 ? rows[i - 1].id || rows[i - 1].tagName : '(first)',
      then: rows[i + 1] && rows[i + 1].id,
      after: rows[i + 2] && rows[i + 2].querySelector('b') && rows[i + 2].querySelector('b').textContent,
      name: row.querySelector('b').textContent, note: row.querySelector('small').textContent,
      label: row.tagName + ' for ' + row.getAttribute('for'),
      sw: sw.type + ' ' + sw.getAttribute('role') + ' ' + sw.checked,
      choiceHidden: document.getElementById('breath-row').hidden,
      layerIn: layer.parentNode.id + ' ' + layer.parentNode.getAttribute('aria-hidden'),
      layerShown: getComputedStyle(layer).display,
      on: window.Hourglass.breath.on
    };
  });
  s.check('TUNE: the main screen has the same buttons (4 top, one of them hidden; 12 bottom); Tune has its row (12 in all, with Layered sand, Grain, Real sand, the custom sand\'s colour and Show when it ends)',
          ui.top === 4 && ui.bottom === 12 && ui.rows === 12, JSON.stringify({ top: ui.top, bottom: ui.bottom, rows: ui.rows }));
  s.check('TUNE: "Breathing pace" is the first row of the Time tab\'s "While it runs", its choice sits directly under it, then Full Zen',
          ui.tab === 'Time' && ui.group === 'While it runs' && ui.before === '(first)' && ui.then === 'breath-row' && ui.after === 'Full Zen' && ui.name === 'Breathing pace',
          ui.tab + ' / ' + ui.group + ': ' + ui.before + ' / ' + ui.name + ' / #' + ui.then + ' / ' + ui.after);
  s.check('TUNE: its note', ui.note === NOTE, '"' + ui.note + '"');
  s.check('TUNE: a labelled switch like the others, off by default',
          ui.label === 'LABEL for opt-breath' && ui.sw === 'checkbox switch false', ui.label + '; ' + ui.sw);
  s.check('TUNE: while it is off the choice is hidden and the layer does not exist (display none, inside the aria-hidden #ambient)',
          ui.choiceHidden && ui.layerShown === 'none' && ui.layerIn === 'ambient true' && !ui.on,
          'choice hidden ' + ui.choiceHidden + ', layer ' + ui.layerShown + ' in #' + ui.layerIn);

  // switch it on, with the row low in what the sheet shows, so that the choice opens below the fold.
  // (Since Tune has tabs the row is near the top of the Time tab: on a phone of 375 x 667 the tab
  // opens with the row whole and the choice's place cut off by the sheet's lower edge.)
  await t.page.setViewportSize({ width: 375, height: 667 });
  await sleep(450);
  await openTune(t);
  var box = await t.eval(function () {
    var body = window.__tune.scroller('#opt-breath'), sw = document.getElementById('opt-breath');
    var row = sw.closest('.row');
    body.scrollTop = 0;
    var r = sw.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, gap: row.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom, top: body.scrollTop };
  });
  await sleep(150);
  await t.touch.tap(box.x, box.y, 60);
  await sleep(350);
  var on = await t.eval(function () {
    var toast = document.getElementById('toast'), g = document.getElementById('breaths');
    var b = [].slice.call(g.querySelectorAll('button')), layer = document.getElementById('breath');
    return {
      toast: toast.textContent.replace(/ /g, ' '), shown: toast.classList.contains('show'),
      live: toast.getAttribute('role') + ' ' + toast.getAttribute('aria-live'),
      checked: document.getElementById('opt-breath').checked,
      hidden: document.getElementById('breath-row').hidden,
      group: g.getAttribute('role') + ' "' + g.getAttribute('aria-label') + '"',
      text: b.map(function (x) { return x.textContent; }),
      roles: b.map(function (x) { return x.tagName + ' ' + x.type + ' ' + x.getAttribute('role'); }),
      names: b.map(function (x) { return x.getAttribute('aria-label'); }),
      sel: b.map(function (x) { return x.getAttribute('aria-checked'); }),
      segmented: g.classList.contains('segmented'),
      layer: getComputedStyle(layer).display + ' ' + getComputedStyle(layer).opacity + ' ' + layer.classList.contains('in'),
      running: window.Hourglass.timer.state, on: window.Hourglass.breath.on
    };
  });
  s.check('TUNE: switching it on shows one quiet toast: "' + TOAST + '"', on.toast === TOAST && on.shown && on.live === 'status polite',
          '"' + on.toast + '", shown ' + on.shown + ', ' + on.live);
  s.check('TUNE: ... and the three-way choice appears, in the segmented style, Calm chosen',
          on.checked && !on.hidden && on.segmented && on.sel.join() === 'true,false,false' &&
          on.text.join('|') === 'Calm 4·6|Box 4·4·4·4|Deep 4·7·8', on.text.join(' | ') + '; ' + on.sel.join());
  s.check('TUNE: a radiogroup of three radios, each naming its counts for a screen reader',
          on.group === 'radiogroup "Breathing pattern"' && on.roles.every(function (r) { return r === 'BUTTON button radio'; }) &&
          on.names.join('|') === 'Calm: in 4 seconds, out 6|Box: in 4 seconds, hold 4, out 4, hold 4|Deep: in 4 seconds, hold 7, out 8',
          on.group + '; ' + on.names.join(' | '));
  s.check('TUNE: the glass is not running, so the glow stays at rest (clear, not swelling)',
          on.running === 'idle' && !on.on && on.layer === 'block 0 false', on.running + ', layer ' + on.layer);
  await sleep(700);
  var view = await t.eval(function () {
    var bodyEl = window.__tune.scroller('#breath-row'), body = bodyEl.getBoundingClientRect();
    var row = document.getElementById('breath-row').getBoundingClientRect();
    var toast = document.getElementById('toast').getBoundingClientRect(), sheet = document.getElementById('sheet-settings').getBoundingClientRect();
    return { top: row.top - body.top, bottom: body.bottom - row.bottom, h: row.height, scrolled: bodyEl.scrollTop,
             page: document.scrollingElement.scrollTop + document.getElementById('app').scrollTop,
             toast: [toast.left, toast.top, toast.right, toast.bottom], sheet: sheet.top, iw: window.innerWidth,
             shown: document.getElementById('toast').classList.contains('show') };
  });
  // (before the tap the row's lower edge stood box.gap px from the sheet's: the choice, h px high, could not have fitted)
  s.check('TUNE: the choice scrolls into view under the switch (and nothing else scrolls)',
          box.top === 0 && box.gap < 0 && box.gap + view.h > 1 && view.scrolled > 0 && view.bottom >= -0.5 && view.top >= 0 && view.page === 0,
          'the row ' + (-box.gap).toFixed(1) + ' px above the sheet\'s lower edge, the choice ' + view.h.toFixed(1) + ' px high: below the fold before; now scrolled ' +
          Math.round(view.scrolled) + ' px, ' + view.bottom.toFixed(1) + ' px above the sheet\'s lower edge');
  s.check('TUNE: the toast sits just above the sheet (its lower edge 4 px over the sheet\'s top), centred, so it covers no tab and no row',
          view.shown && Math.abs(view.toast[3] - (view.sheet - 4)) <= 1 && view.toast[1] >= 0 && Math.abs((view.toast[0] + view.toast[2]) / 2 - view.iw / 2) <= 1,
          'toast x ' + view.toast[0].toFixed(1) + ' to ' + view.toast[2].toFixed(1) + ', y ' + view.toast[1].toFixed(1) + ' to ' + view.toast[3].toFixed(1) +
          '; the sheet begins at y ' + view.sheet.toFixed(1));
  var st = await settingsOf(t);
  s.check('TUNE: saved with the other settings: breath true, breathPattern "calm"', st.breath === true && st.breathPattern === 'calm',
          JSON.stringify({ breath: st.breath, breathPattern: st.breathPattern }));

  // the choice
  await t.page.tap('#breaths button[data-breath="box"]');
  await sleep(250);
  var pick = await t.eval(function () {
    return [].slice.call(document.querySelectorAll('#breaths button')).map(function (x) { return x.getAttribute('aria-checked'); }).join();
  });
  st = await settingsOf(t);
  s.check('TUNE: choosing Box checks it alone and saves it', pick === 'false,true,false' && st.breathPattern === 'box', pick + ', saved "' + st.breathPattern + '"');

  // one line at every phone width
  var fits = [], widths = [360, 390, 430];
  for (var i = 0; i < widths.length; i++) {
    await t.page.setViewportSize({ width: widths[i], height: 844 });
    await sleep(450);
    await t.page.$eval('#breath-row', function (el) { el.scrollIntoView({ block: 'center' }); });
    await sleep(150);
    fits.push(await t.eval(function () {
      var b = [].slice.call(document.querySelectorAll('#breaths button')), out = { tops: [], h: [], spare: [] };
      var sheet = document.getElementById('sheet-settings').getBoundingClientRect(), g = document.getElementById('breaths').getBoundingClientRect();
      b.forEach(function (x) {
        var r = x.getBoundingClientRect(), range = document.createRange();
        range.selectNodeContents(x);
        var tr = range.getBoundingClientRect(), lines = range.getClientRects();
        var ys = {};
        for (var k = 0; k < lines.length; k++) ys[Math.round(lines[k].bottom / 6)] = 1;
        out.tops.push(Math.round(r.top)); out.h.push(Math.round(r.height));
        out.spare.push(Math.round(Math.min(tr.left - r.left, r.right - tr.right)));
        out.lines = Math.max(out.lines || 0, Object.keys(ys).length);
      });
      out.inside = g.left >= sheet.left + 16 && g.right <= sheet.right - 16;
      out.w = window.innerWidth;
      return out;
    }));
  }
  var fitOk = fits.every(function (f) {
    return f.lines === 1 && f.inside && f.tops[0] === f.tops[1] && f.tops[1] === f.tops[2] &&
           f.h.every(function (h) { return h === 44; }) && f.spare.every(function (x) { return x >= 4; });
  });
  s.check('TUNE: the three labels with their counts fit on one line at 360, 390 and 430 px', fitOk,
          fits.map(function (f) { return f.w + ' px: ' + f.lines + ' line, ' + f.h[0] + ' px high, spare ' + f.spare.join('/') + ' px'; }).join('; '));
  await t.page.setViewportSize({ width: 390, height: 844 });
  await sleep(450);

  // off again
  await t.page.tap('#opt-breath');
  await sleep(300);
  var off = await t.eval(function () {
    return { hidden: document.getElementById('breath-row').hidden, toasts: window.__toasts.length,
             layer: getComputedStyle(document.getElementById('breath')).display };
  });
  st = await settingsOf(t);
  s.check('TUNE: switched off, the choice hides again, nothing more is said, and it is saved',
          off.hidden && off.toasts === 1 && st.breath === false && st.breathPattern === 'box',
          'hidden ' + off.hidden + ', ' + off.toasts + ' toast in all, saved breath ' + st.breath + ' / "' + st.breathPattern + '"');
  await sleep(2700);
  var gone = await t.eval(function () { return getComputedStyle(document.getElementById('breath')).display; });
  s.check('TUNE: ... and once it has eased back the layer is gone again', off.layer === 'block' && gone === 'none', 'at once ' + off.layer + ', 2.7 s later ' + gone);

  // switched on and off while the sand is running (the sheet stays open)
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(500);
  await sampleStart(t);
  await t.page.tap('#opt-breath');
  await sleep(2000);
  var run = await t.eval(function () {
    var el = document.getElementById('breath');
    return { on: window.Hourglass.breath.on, t0: window.Hourglass.breath.t0, cls: el.classList.contains('in'), toasts: window.__toasts.length,
             state: window.Hourglass.timer.state };
  });
  await t.eval(function () {
    document.getElementById('opt-breath').addEventListener('change', function () { window.__offAt = Date.now(); });
  });
  await t.page.tap('#opt-breath');
  var late = await t.eval(function () {
    return new Promise(function (r) {
      setTimeout(function () { r(getComputedStyle(document.getElementById('breath')).display); }, window.__offAt + 2450 - Date.now());
    });
  });
  var tOff = await t.eval(function () { return window.__offAt; });
  await sleep(500);
  var gone2 = await t.eval(function () {
    return { layer: getComputedStyle(document.getElementById('breath')).display, on: window.Hourglass.breath.on, state: window.Hourglass.timer.state };
  });
  var smp = await sampleStop(t);
  var up = follows(smp, run.t0, PATTERNS.box, [0.5, 1, 1.5]), vOff = at(smp, tOff), vEnd = at(smp, tOff + 2450);
  s.check('TUNE: switched on while the sand is running, the glow begins to swell at once (and the toast comes again)',
          run.state === 'running' && run.on && run.cls && run.toasts === 2 && up.ok, up.detail + '; ' + run.toasts + ' toasts in all');
  s.check('TUNE: switched off while running, it eases back to rest before the layer goes',
          vOff > 0.25 && worstJump(smp, tOff - 100, tOff + 2500) <= 0.03 && late === 'block' && vEnd <= 0.02 &&
          gone2.layer === 'none' && !gone2.on && gone2.state === 'running',
          f2(vOff) + ' when switched off, ' + f3(vEnd) + ' 2.45 s later with the layer still there (' + late + '), then ' + gone2.layer);

  // the toast goes with the sheet: Tune closed while it is up, it fades where it is and does not jump down the screen
  await t.page.tap('#opt-breath');
  await sleep(700);
  var sheetTop = await t.eval(function () {
    var toast = document.getElementById('toast'), w = window.__tw = { on: true, out: [] };
    (function tick() {
      if (!w.on) return;
      w.out.push([toast.getBoundingClientRect().top, +getComputedStyle(toast).opacity, toast.getBoundingClientRect().bottom]);
      requestAnimationFrame(tick);
    })();
    return document.getElementById('sheet-settings').getBoundingClientRect().top;
  });
  await closeTune(t);
  var tw = await t.eval(function () {
    window.__tw.on = false;
    return { out: window.__tw.out, shown: document.getElementById('toast').classList.contains('show'), toasts: window.__toasts.length };
  });
  var seen = tw.out.filter(function (x) { return x[1] > 0.02; }), drift = 0;
  seen.forEach(function (x) { drift = Math.max(drift, Math.abs(x[0] - tw.out[0][0])); });
  // (8 px is the toast's own way of leaving)
  s.check('TUNE: Tune closed while the toast is up: the toast fades where it is, with the sheet',
          tw.toasts === 3 && tw.out[0][1] === 1 && Math.abs(tw.out[0][2] - (sheetTop - 4)) <= 1 && drift <= 8.5 && !tw.shown && tw.out[tw.out.length - 1][1] === 0,
          'at y ' + Math.round(tw.out[0][0]) + ' (above the sheet at ' + Math.round(sheetTop) + '), moved ' + drift.toFixed(1) + ' px while it faded over ' + seen.length + ' frames');
  // ... and what is said with no sheet open keeps its usual place (here: the Custom sheet's note, as that sheet closes)
  await t.eval(function () {
    document.getElementById('pill-custom').click();
    document.getElementById('wheel-min').scrollTop = 0;
    document.getElementById('wheel-sec').scrollTop = 5 * 46;
  });
  await sleep(700);
  await t.eval(function () { document.getElementById('custom-set').click(); });
  await sleep(500);
  var low = await t.eval(function () {
    var toast = document.getElementById('toast'), r = toast.getBoundingClientRect();
    return { text: toast.textContent, shown: toast.classList.contains('show'), up: window.innerHeight - r.bottom, mid: (r.left + r.right) / 2 };
  });
  s.check('TUNE: ... and a toast with no Tune under it keeps its usual place, 172 px above the bottom',
          low.shown && /Shortest glass/.test(low.text) && Math.abs(low.up - 172) < 1 && Math.abs(low.mid - 195) < 1,
          '"' + low.text + '" ' + low.up.toFixed(1) + ' px above the bottom, centred at x ' + low.mid.toFixed(1));
  s.check('TUNE: no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  await t.close();
}

/* ---- calm: a breath from the start of the glass ------------------------ */
async function calm(s, env) {
  var t = await env.open({
    storage: seed({ breath: true }),
    init: function () {
      window.__vib = 0;
      try { navigator.vibrate = function () { window.__vib++; return true; }; } catch (e) {}
      // every timer the breath sets for itself, and how long its callback runs
      var bt = window.__bt = { calls: 0, ms: 0, max: 0 }, set = window.setTimeout;
      window.setTimeout = function (fn, ms) {
        var f = fn;
        if (typeof f === 'function' && f.name === 'breathStep') {
          fn = function () {
            var a = performance.now();
            f();
            a = performance.now() - a;
            bt.calls++; bt.ms += a;
            if (a > bt.max) bt.max = a;
          };
        }
        return set.call(window, fn, ms);
      };
    }
  });
  var cdp = t.cdp, layers = null;
  cdp.on('LayerTree.layerTreeDidChange', function (e) { if (e.layers) layers = e.layers; });
  await cdp.send('DOM.enable');
  await cdp.send('LayerTree.enable');
  await sleep(1500);
  var idle = await t.eval(function () {
    var el = document.getElementById('breath'), cs = getComputedStyle(el);
    window.__writes = 0;
    new MutationObserver(function (recs) { window.__writes += recs.length; }).observe(el, { attributes: true });
    return { o: +cs.opacity, tp: cs.transitionProperty, wc: cs.willChange, bg: cs.backgroundImage, on: window.Hourglass.breath.on,
             ease: cs.transitionTimingFunction, dur: cs.transitionDuration };
  });
  s.check('CALM: before the glass starts the glow is at rest', idle.o === 0 && !idle.on, 'opacity ' + idle.o);
  s.check('CALM: the layer may only ever move by opacity and transform', idle.tp === 'opacity, transform' && idle.wc === 'opacity, transform',
          'transition-property "' + idle.tp + '", will-change "' + idle.wc + '"');
  await sampleStart(t);
  var g = await t.glass();
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(600);
  var began = await t.eval(function () {
    var H = window.Hourglass, el = document.getElementById('breath');
    return {
      t0: H.breath.t0, state: H.timer.state, on: H.breath.on, cls: el.classList.contains('in'), vib: window.__vib,
      anim: el.getAnimations().map(function (a) {
        var tm = a.effect.getTiming();
        return a.constructor.name + ' ' + a.transitionProperty + ' ' + tm.duration + ' ms ' + tm.easing;
      }).sort()
    };
  });
  await sleep(1400);
  // 2 s in: the compositor's view of the layer
  var doc = await cdp.send('DOM.getDocument', { depth: 0 });
  var q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#breath' });
  var bid = (await cdp.send('DOM.describeNode', { nodeId: q.nodeId })).node.backendNodeId;
  function breathLayer() {
    for (var i = 0; layers && i < layers.length; i++) if (layers[i].backendNodeId === bid) return layers[i];
    return null;
  }
  var L0 = breathLayer(), why = L0 ? (await cdp.send('LayerTree.compositingReasons', { layerId: L0.layerId })).compositingReasonIds : [];
  var paint0 = L0 ? L0.paintCount : -1;
  await sleep(10800);
  var L1 = breathLayer(), paint1 = L1 ? L1.paintCount : -2;
  var end = await t.eval(function () {
    return { writes: window.__writes, vib: window.__vib, bt: window.__bt, status: document.getElementById('status').textContent,
             top: document.querySelectorAll('#hud-top button').length, bottom: document.querySelectorAll('#hud-bottom button').length,
             kids: document.getElementById('app').children.length, bg: getComputedStyle(document.getElementById('breath')).backgroundImage };
  });
  var smp = await sampleStop(t), t0 = began.t0, P = PATTERNS.calm;
  var tap = 0;
  for (var i = 0; i < smp.length; i++) if (smp[i][4]) { tap = smp[i][0]; break; }
  s.check('CALM: it begins with an in-breath the moment the glass starts', began.state === 'running' && began.on && began.cls && Math.abs(t0 - tap) < 120,
          began.state + ', swelling ' + began.cls + ', the breath\'s clock starts ' + Math.round(tap - t0) + ' ms before the first running frame');
  s.check('CALM: one part of a breath is two transitions, opacity and transform, 4 s on the sine ease',
          began.anim.join('; ') === 'CSSTransition opacity 4000 ms cubic-bezier(0.37, 0, 0.63, 1); CSSTransition transform 4000 ms cubic-bezier(0.37, 0, 0.63, 1)',
          began.anim.join('; '));
  var rise = range(smp, t0 + 100, t0 + 3950), mono = true;
  for (i = 1; i < smp.length; i++) {
    if (smp[i][0] > t0 && smp[i][0] < t0 + 3950 && smp[i][1] < smp[i - 1][1] - 0.004) mono = false;
  }
  var a = follows(smp, t0, P, [0.5, 1, 2, 3, 3.5]);
  s.check('CALM: the glow swells through the 4 s in-breath on a sine ease', a.ok && mono && rise.n > 20, a.detail + '; ' + rise.n + ' frames, never falling: ' + mono);
  var peak = fullAt(smp, t0, P, 4);
  s.check('CALM: full at 4 s', peak.ok, peak.detail);
  var b = follows(smp, t0, P, [5, 6, 7, 8, 9]);
  s.check('CALM: ... and fades through the 6 s out-breath', b.ok, b.detail);
  var low = restsAt(smp, t0, P, 10), c = follows(smp, t0, P, [10.5, 11, 12]);
  s.check('CALM: at rest at 10 s and swelling again: six breaths a minute', low.ok && c.ok, low.detail + '; ' + c.detail);
  var sc = [at(smp, t0 + 60, 2), at(smp, t0 + 2000, 2), at(smp, t0 + 4000, 2), at(smp, t0 + 7000, 2)];
  var scWant = [0.92, 0.92 + 0.2 * ideal(P, 2 - a.lag), 1.12, 0.92 + 0.2 * ideal(P, 7 - b.lag)];
  s.check('CALM: it swells in size too, from 0.92 to 1.12 with the same ease',
          Math.abs(sc[0] - scWant[0]) < 0.01 && Math.abs(sc[1] - scWant[1]) < 0.012 && Math.abs(sc[2] - scWant[2]) < 0.01 && Math.abs(sc[3] - scWant[3]) < 0.012,
          'scale ' + sc.map(f3).join(', ') + ' at 0, 2, 4 and 7 s (' + scWant.map(f3).join(', ') + ')');
  s.check('CALM: no jumps anywhere in the breath', worstJump(smp, t0, t0 + 12000) <= 0.03, 'largest step beyond the ease ' + f3(worstJump(smp, t0, t0 + 12000)));
  s.check('CALM: the layer is the compositor\'s own: an accelerated opacity and transform transition',
          !!L0 && why.indexOf('ActiveOpacityAnimation') >= 0 && why.indexOf('ActiveTransformAnimation') >= 0, L0 ? why.join(', ') : 'no layer for #breath');
  s.check('CALM: ... and it is not painted again while it breathes (nor its gradient changed)', paint0 >= 0 && paint1 === paint0 && end.bg === idle.bg,
          'paint count ' + paint0 + ' at 2 s, ' + paint1 + ' at 12.8 s');
  s.check('CALM: no script runs between the parts of a breath: a handful of style writes at the start and at each turn', end.writes > 0 && end.writes <= 30,
          end.writes + ' attribute writes on the layer in 12.8 s, over ' + smp.length + ' frames');
  s.check('CALM: all the script a breath costs: one timer for each part, well under a millisecond each',
          end.bt.calls >= 2 && end.bt.calls <= 6 && end.bt.max < 2,
          end.bt.calls + ' timer callbacks in 12.8 s, ' + end.bt.ms.toFixed(2) + ' ms in all, the longest ' + end.bt.max.toFixed(2) + ' ms');
  s.check('CALM: nothing else changes: no text cue, no new control, no haptics after the tap\'s own',
          end.status === 'Flowing' && end.top === 4 && end.bottom === 12 && end.vib === began.vib,
          '"' + end.status + '", ' + end.top + ' + ' + end.bottom + ' buttons, vibrate calls ' + began.vib + ' → ' + end.vib);
  await H.invariants(s, t, 'CALM');
  await t.close();
}

/* ---- rest: paused, finished, reset ------------------------------------- */
async function rest(s, env) {
  var t = await env.open({ storage: seed({ breath: true }) });
  await sleep(1200);
  await sampleStart(t);
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(2000);
  var tp = await t.eval(function () { window.Hourglass.pause(); return Date.now(); });
  await sleep(4300);
  var p = await t.eval(function () {
    var el = document.getElementById('breath');
    return { on: window.Hourglass.breath.on, cls: el.classList.contains('in'), state: window.Hourglass.timer.state };
  });
  var smp = await sampleStop(t);
  var before = at(smp, tp - 30), mid = at(smp, tp + 1200), after = range(smp, tp + 2600, tp + 4200);
  s.check('REST: paused mid-breath, the glow eases back to rest: no jump, clear within 2.4 s',
          before > 0.3 && before < 0.65 && worstJump(smp, tp - 200, tp + 2600) <= 0.03 &&
          Math.abs(mid - before * (1 - sine(1.2 / 2.4))) <= 0.06 && at(smp, tp + 2500) <= 0.02,
          f2(before) + ' at the pause, ' + f2(mid) + ' 1.2 s later, ' + f3(at(smp, tp + 2500)) + ' at 2.5 s');
  s.check('REST: ... and it stays at rest while paused', p.state === 'paused' && !p.on && !p.cls && after.hi <= 0.01 && after.n > 10,
          'at most ' + f3(after.hi) + ' over the next 1.6 s');

  // started again: an in-breath from rest, on a new clock
  await sampleStart(t);
  var tr = await t.eval(function () { window.Hourglass.start(); return Date.now(); });
  await sleep(2600);
  var t0 = await breathT0(t);
  // paused and started again within half a second: the glow turns round where it is
  var tq = await t.eval(function () { window.Hourglass.pause(); return Date.now(); });
  await sleep(500);
  var tq2 = await t.eval(function () { window.Hourglass.start(); return Date.now(); });
  await sleep(1500);
  var t0b = await breathT0(t);
  smp = await sampleStop(t);
  var a = follows(smp, t0, PATTERNS.calm, [0.5, 1, 2]);
  s.check('REST: started again, it begins with a new in-breath', Math.abs(t0 - tr) < 60 && a.ok, 'clock ' + (t0 - tr) + ' ms from the start; ' + a.detail);
  var vq = at(smp, tq), v2 = at(smp, tq2), v3 = at(smp, tq2 + 1400);
  s.check('REST: paused and started again at once, it turns round where it is, without a jump',
          Math.abs(t0b - tq2) < 60 && v2 < vq - 0.03 && v3 > v2 + 0.05 && worstJump(smp, tq - 200, tq2 + 1450) <= 0.03,
          f2(vq) + ' at the pause, ' + f2(v2) + ' half a second later, ' + f2(v3) + ' 1.4 s after starting again');

  // the Flip button's turn (2.6 s) on a running glass: it runs on, and so does the breath, on the same clock
  await sampleStart(t);
  await t.eval(function () { window.Hourglass.flipNow(false); });
  await sleep(1300);
  var turning = await t.eval(function () { return window.Hourglass.flip.active; });
  await t.page.waitForFunction(function (until) { return !window.Hourglass.flip.active && Date.now() > until; }, t0b + 4800, { timeout: 15000, polling: 100 });
  var fl = await t.eval(function () {
    var H = window.Hourglass;
    return { state: H.timer.state, on: H.breath.on, t0: H.breath.t0, active: H.flip.active };
  });
  smp = await sampleStop(t);
  // (this in-breath began part-way up, so only its out-breath is held against the pattern)
  var f1 = at(smp, t0b + 2000), f2v = at(smp, t0b + 3000), fTop = fullAt(smp, t0b, PATTERNS.calm, 4), fOut = frameAt(smp, t0b + 4600) || [t0b + 4600, NaN];
  var fj = worstJump(smp, smp[0][0], t0b + 4650);
  s.check('REST: turned over by the Flip button while running, the breath goes on undisturbed',
          turning && !fl.active && fl.state === 'running' && fl.on && fl.t0 === t0b && f2v > f1 + 0.03 && fTop.ok &&
          near(fOut[1], PATTERNS.calm, (fOut[0] - t0b) / 1000) && fj <= 0.03,
          (turning ? 'turning' : 'not turning') + ' at 1.3 s, ' + fl.state + ' after it, the breath\'s clock ' + (fl.t0 === t0b ? 'unchanged' : 'moved') + '; ' +
          f2(f1) + ' at 2 s, ' + f2(f2v) + ' at 3 s, ' + fTop.detail + ', ' + f2(fOut[1]) + ' at 4.6 s (' + f2(ideal(PATTERNS.calm, (fOut[0] - t0b) / 1000)) +
          '), largest step ' + f3(fj));

  // reset
  await sampleStart(t);
  var tz = await t.eval(function () { window.Hourglass.reset(false); return Date.now(); });
  await sleep(4500);
  var z = await t.eval(function () { return { state: window.Hourglass.timer.state, on: window.Hourglass.breath.on }; });
  smp = await sampleStop(t);
  var vz = at(smp, tz), zr = range(smp, tz + 3000, tz + 4400);
  s.check('REST: Reset: the glow eases back to rest and stays', z.state === 'idle' && !z.on && vz > 0.3 && zr.hi <= 0.02 && worstJump(smp, tz, tz + 3000) <= 0.03,
          f2(vz) + ' at Reset, at most ' + f3(zr.hi) + ' from 3 s after');

  // the end of a glass: Deep holds full from 4 s to 11 s, and this glass ends at 10 s
  await t.eval(function () { window.Hourglass.setDuration(10000); });
  await sleep(1400);
  await tuneSheet.tap(t, '#breaths button[data-breath="deep"]');
  await closeTune(t);
  await t.eval(function () { __mon.reset(); });
  await sampleStart(t);
  await t.eval(function () { window.Hourglass.start(); });
  await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done'; }, null, { timeout: 15000, polling: 100 });
  await sleep(6500);
  var d = await t.eval(function () { return { done: __mon.doneAt, on: window.Hourglass.breath.on, cls: document.getElementById('breath').classList.contains('in') }; });
  smp = await sampleStop(t);
  var vd = at(smp, d.done - 100), dr = range(smp, d.done + 2600, d.done + 6400);
  s.check('REST: when the last grain falls the glow, held full, eases back to rest and does not breathe on',
          !d.on && !d.cls && vd >= 0.98 && at(smp, d.done + 1200) > 0.1 && at(smp, d.done + 1200) < 0.9 && dr.hi <= 0.02 && dr.n > 20 &&
          worstJump(smp, d.done - 100, d.done + 2600) <= 0.03,
          f2(vd) + ' as it ends, ' + f2(at(smp, d.done + 1200)) + ' 1.2 s later, at most ' + f3(dr.hi) + ' from 2.6 s to 6.4 s after');
  await H.invariants(s, t, 'REST');
  await t.close();
}

/* ---- box and deep: the holds ------------------------------------------- */
async function pattern(s, env, name) {
  var P = PATTERNS[name], U = name.toUpperCase();
  var t = await env.open({ storage: seed({ breath: true, breathPattern: name }) });
  await sleep(1200);
  await sampleStart(t);
  await t.eval(function () { window.Hourglass.start(); });
  var cycle = P[0] + P[1] + P[2] + P[3];
  await sleep(cycle * 1000 + 1700);
  var t0 = await breathT0(t);
  var smp = await sampleStop(t);
  var holdFull = range(smp, t0 + P[0] * 1000 + 450, t0 + (P[0] + P[1]) * 1000 - 100);
  var tOut = P[0] + P[1];
  var a = follows(smp, t0, P, [1, 2, 3, tOut + P[2] * 0.25, tOut + P[2] * 0.5, tOut + P[2] * 0.75, cycle + 1, cycle + 1.5]);
  s.check(U + ': in for ' + P[0] + ' s, out for ' + P[2] + ' s' + (P[3] ? ', and in again after the ' + P[3] + ' s rest' : ', and in again') + ' at ' + cycle + ' s', a.ok, a.detail);
  s.check(U + ': held full for ' + P[1] + ' s', holdFull.lo >= 0.985 && holdFull.n > 20,
          'never below ' + f3(holdFull.lo) + ' from ' + P[0] + ' s to ' + tOut + ' s (' + holdFull.n + ' frames)');
  if (P[3]) {
    var holdRest = range(smp, t0 + (tOut + P[2]) * 1000 + 450, t0 + cycle * 1000 - 100);
    s.check(U + ': held at rest for ' + P[3] + ' s', holdRest.hi <= 0.015 && holdRest.n > 20,
            'never above ' + f3(holdRest.hi) + ' from ' + (tOut + P[2]) + ' s to ' + cycle + ' s');
  } else {
    var low = restsAt(smp, t0, P, cycle);
    s.check(U + ': at rest at ' + cycle + ' s', low.ok, low.detail);
  }
  s.check(U + ': no jumps', worstJump(smp, t0, t0 + cycle * 1000 + 1500) <= 0.03, 'largest step beyond the ease ' + f3(worstJump(smp, t0, t0 + cycle * 1000 + 1500)));

  if (name === 'box') {
    // a new pattern chosen while the glow is up (swelling, or held full) goes on out from where it is
    await openTune(t);
    await sampleStart(t);
    await t.eval(function () {
      document.getElementById('breaths').addEventListener('click', function () { window.__pickAt = Date.now(); }, true);
    });
    await sleep(300);
    await t.page.tap('#breaths button[data-breath="calm"]');
    await sleep(6600);
    var t0c = await breathT0(t), pickAt = await t.eval(function () { return window.__pickAt; });
    smp = await sampleStop(t);
    var tSw = t0c + 4000, v0 = at(smp, tSw - 30), v3 = at(smp, tSw + 3000), v6 = at(smp, tSw + 6100);
    s.check('BOX: a new pattern chosen mid-breath goes on from where the glow is: out, without a jump',
            Math.abs(tSw - pickAt) < 40 && v0 > 0.6 && Math.abs(v3 - v0 / 2) < 0.08 && v6 <= 0.02 && worstJump(smp, tSw - 200, tSw + 6200) <= 0.03,
            f2(v0) + ' when Calm is chosen, ' + f2(v3) + ' 3 s later, ' + f3(v6) + ' at 6.1 s; its out-breath is clocked from ' +
            Math.round(tSw - pickAt) + ' ms after the tap');
  }
  await H.invariants(s, t, U);
  await t.close();
}

/* ---- clock: a slow frame, a hidden page, a long sleep ------------------- */
async function clock(s, env) {
  var t = await env.open({ storage: seed({ breath: true }) });
  var P = PATTERNS.calm;
  await sleep(1200);
  await sampleStart(t);
  await t.eval(function () {
    window.Hourglass.start();
    // 3.6 s in, the main thread is held for 800 ms: no frame, no timer, across the turn of the breath
    setTimeout(function () { var end = Date.now() + 800; window.__held = Date.now(); while (Date.now() < end) {} }, 3600);
  });
  await sleep(11200);
  var t0 = await breathT0(t);
  var held = await t.eval(function () { return window.__held; });
  var smp = await sampleStop(t);
  var gap = 0;
  for (var i = 1; i < smp.length; i++) if (smp[i][0] > t0 + 3000 && smp[i][0] < t0 + 5000) gap = Math.max(gap, smp[i][0] - smp[i - 1][0]);
  var a = follows(smp, t0, P, [5, 6, 7, 8, 9, 10.5, 11]), low = restsAt(smp, t0, P, 10);
  s.check('CLOCK: the main thread held for 800 ms across the turn of a breath: the out-breath still ends on time',
          gap >= 700 && held - t0 > 3500 && held - t0 < 3900 && a.ok && low.ok,
          'no frame for ' + Math.round(gap) + ' ms from ' + ((held - t0) / 1000).toFixed(2) + ' s; ' + a.detail + '; ' + low.detail);

  // the page hidden for a while (the app sees document.hidden and visibilitychange)
  function setHidden(h) {
    return t.eval(function (hid) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return hid; } });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return hid ? 'hidden' : 'visible'; } });
      document.dispatchEvent(new Event('visibilitychange'));
      return Date.now();
    }, h);
  }
  await t.page.waitForFunction(function (cyc) {
    var e = (Date.now() - window.Hourglass.breath.t0) % cyc;
    return e > 900 && e < 1100;
  }, 10000, { polling: 50, timeout: 12000 });
  await t.eval(function () {
    window.__writes = 0;
    new MutationObserver(function (recs) { window.__writes += recs.length; }).observe(document.getElementById('breath'), { attributes: true });
  });
  var th = await setHidden(true);
  await sleep(5500);
  var w = await t.eval(function () { return window.__writes; });
  await sampleStart(t);
  var tv = await setHidden(false);
  await sleep(4500);
  smp = await sampleStop(t);
  // the first frame drawn after coming back (60 ms on), at that frame's own time
  function firstAfter(sm, T) { for (var k = 0; k < sm.length; k++) if (sm[k][0] >= T) return sm[k]; return [T, NaN]; }
  var e0 = (tv - t0) / 1000, f0 = firstAfter(smp, tv + 60), eAt = (f0[0] - t0) / 1000, want = ideal(P, eAt), got = f0[1];
  var b = follows(smp, t0, P, [e0 + 0.5, e0 + 1.5, e0 + 2.5, e0 + 4, e0 + 4.3]);
  s.check('CLOCK: while the page is hidden the breath has no timer running', w === 0, w + ' writes on the layer in ' + ((tv - th) / 1000).toFixed(1) + ' s hidden');
  s.check('CLOCK: back on the page, the glow is where the wall clock says, and goes on from there',
          near(got, P, eAt) && b.ok && worstJump(smp, f0[0], tv + 4400) <= 0.03,
          (e0 % 10).toFixed(1) + ' s into the breath: ' + f2(got) + ' (' + f2(want) + '); then ' + b.detail);

  // a long sleep: the page's timers and transitions were frozen, the wall clock ran on 13.3 s
  await t.page.waitForFunction(function (cyc) {
    var e = (Date.now() - window.Hourglass.breath.t0) % cyc;
    return e > 1000 && e < 1200;
  }, 10000, { polling: 50, timeout: 12000 });
  await setHidden(true);
  await sleep(300);
  await t.eval(function () { window.Hourglass.breath.t0 -= 13300; });
  await sampleStart(t);
  tv = await setHidden(false);
  await sleep(4200);
  var t0s = await breathT0(t);
  smp = await sampleStop(t);
  e0 = (tv - t0s) / 1000; f0 = firstAfter(smp, tv + 60); eAt = (f0[0] - t0s) / 1000; want = ideal(P, eAt); got = f0[1];
  var c = follows(smp, t0s, P, [e0 + 0.5, e0 + 1.5, e0 + 2.5, e0 + 3.5]);
  s.check('CLOCK: after a long sleep it wakes in the breath the wall clock says (here: fading, though it slept swelling)',
          e0 % 10 > 4.3 && e0 % 10 < 5.3 && near(got, P, eAt) && c.ok,
          (e0 % 10).toFixed(1) + ' s into a breath: ' + f2(got) + ' (' + f2(want) + '); then ' + c.detail);
  await H.invariants(s, t, 'CLOCK');
  await t.close();
}

/* ---- Reduce Motion ----------------------------------------------------- */
async function reduce(s, env) {
  var t = await env.open({ storage: seed({ breath: true }), reducedMotion: true });
  await sleep(1200);
  await sampleStart(t);
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(1500);
  var anim = await t.eval(function () {
    return document.getElementById('breath').getAnimations().map(function (a) { return a.transitionProperty; }).join();
  });
  await sleep(5700);
  var t0 = await breathT0(t), rm = await t.eval(function () { return window.Hourglass.reduceMotion; });
  var smp = await sampleStop(t);
  var none = smp.every(function (x) { return x[2] === 0; });
  var a = follows(smp, t0, PATTERNS.calm, [1, 2, 3, 5.5, 7]), full = fullAt(smp, t0, PATTERNS.calm, 4);
  s.check('REDUCE: with Reduce Motion nothing scales: the layer\'s transform is none in every frame, and only opacity is in transition',
          rm && none && anim === 'opacity' && smp.length > 60, smp.length + ' frames, transitions: ' + anim);
  s.check('REDUCE: ... the brightness alone swells and fades, as gently', a.ok && full.ok && worstJump(smp, t0, t0 + 7000) <= 0.03,
          a.detail + '; ' + full.detail);
  await H.invariants(s, t, 'REDUCE');
  await t.close();
}

/* ---- Zen and Full Zen -------------------------------------------------- */
async function zen(s, env) {
  var t = await env.open({ storage: seed({ breath: true, zenFull: true }) });
  await sleep(1200);
  var g = await t.glass();
  await sampleStart(t);
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(400);
  await t.page.tap('#btn-zen');                              // (Zen comes by the moon button or a pinch, never by itself)
  await t.page.waitForFunction(function () { return document.getElementById('app').classList.contains('zen-deep'); }, null, { timeout: 12000 });
  await sleep(600);
  var p = await H.perfWatch(t);
  var tz = Date.now();
  await p.wait(8000);
  var z = await t.eval(function () {
    var app = document.getElementById('app');
    return { cls: app.className, hud: getComputedStyle(document.getElementById('hud-bottom')).opacity + ' / ' + getComputedStyle(document.getElementById('hud-top')).opacity,
             amb: getComputedStyle(document.getElementById('ambient')).opacity, state: window.Hourglass.timer.state };
  });
  var t0 = await breathT0(t);
  var smp = await sampleStop(t);
  var e0 = (tz - t0) / 1000, sw = range(smp, tz, tz + 8000);
  var a = follows(smp, t0, PATTERNS.calm, [e0 + 0.5, e0 + 2, e0 + 3.5, e0 + 5, e0 + 6.5, e0 + 7.8]);
  s.check('ZEN: in Full Zen the controls are gone and the glow still breathes',
          /\bzen\b/.test(z.cls) && /zen-full/.test(z.cls) && z.hud === '0 / 0' && z.amb === '1' && z.state === 'running' && a.ok && sw.hi - sw.lo > 0.9,
          'controls at opacity ' + z.hud + '; the glow from ' + f2(sw.lo) + ' to ' + f2(sw.hi) + ' over 8 s; ' + a.detail);
  // (what a breath costs in script is measured in CALM; the frame's own work is physics and
  //  drawing, and here it follows how fast this machine composites in software, so it is only noted)
  s.note('ZEN: the frame\'s own work while breathing', 'p95 ' + H.pct(p.frame, 95).toFixed(2) + ' ms, p50 ' + H.pct(p.frame, 50).toFixed(2) +
         ' ms over ' + p.frame.length + ' frames in 8 s (E1\'s budget, without breathing: p95 ≤ 8 ms)');
  await H.invariants(s, t, 'ZEN');
  await t.close();
}

/* ---- saved, restored, all six sands ------------------------------------ */
async function saved(s, env) {
  var t = await env.open({ storage: seed({ breath: true, breathPattern: 'deep' }) });
  await sleep(1000);
  function state() {
    return t.eval(function () {
      var H = window.Hourglass, el = document.getElementById('breath');
      return {
        sw: document.getElementById('opt-breath').checked, hidden: document.getElementById('breath-row').hidden,
        sel: [].slice.call(document.querySelectorAll('#breaths button')).filter(function (b) { return b.getAttribute('aria-checked') === 'true'; })
          .map(function (b) { return b.dataset.breath; }).join(),
        layer: getComputedStyle(el).display, on: H.breath.on, cls: el.classList.contains('in'), state: H.timer.state,
        age: Date.now() - H.breath.t0
      };
    });
  }
  var a = await state();
  s.check('SAVED: a saved switch and pattern come back: on, Deep chosen, the choice shown, the layer there and at rest',
          a.sw && !a.hidden && a.sel === 'deep' && a.layer === 'block' && !a.on && !a.cls, JSON.stringify(a));
  var tints = await t.eval(function (ids) {
    var out = {}, el = document.getElementById('breath');
    ids.forEach(function (id) { window.Hourglass.setTheme(id); out[id] = getComputedStyle(el).backgroundImage; });
    window.Hourglass.setTheme('sahara');
    return out;
  }, Object.keys(GLOW));
  var bad = Object.keys(GLOW).filter(function (id) {
    return tints[id].split('rgba(' + GLOW[id] + ',').length - 1 < 3 || /rgba?\((?!\d+, \d+, \d+, 0\))/.test(tints[id].replace(new RegExp('rgba\\(' + GLOW[id] + ',', 'g'), ''));
  });
  s.check('SAVED: each of the six sands tints the layer with its own glow, and with nothing else', bad.length === 0,
          bad.length ? bad.join(', ') + ': ' + tints[bad[0]] : Object.keys(GLOW).join(', '));

  // upright, the swell is as wide as the screen; on its side it follows the height: a halo round the glass, not a band
  function widths() {
    return t.eval(function () {
      var re = /radial-gradient\(([\d.]+)(%|vh|px) /g, bg = getComputedStyle(document.getElementById('breath')).backgroundImage, m, out = [];
      while ((m = re.exec(bg))) out.push(+m[1] * (m[2] === '%' ? window.innerWidth / 100 : m[2] === 'vh' ? window.innerHeight / 100 : 1));
      return { r: out, w: window.innerWidth, h: window.innerHeight };
    });
  }
  var up = await widths();
  await t.page.setViewportSize({ width: 844, height: 390 });
  await sleep(450);
  var side = await widths();
  await t.page.setViewportSize({ width: 390, height: 844 });
  await sleep(450);
  // (a gradient is clear from 0.7 of its radius: twice that is how wide the light can be seen)
  var seenUp = 1.4 * Math.max.apply(null, up.r), seenSide = 1.4 * Math.max.apply(null, side.r);
  s.check('SAVED: upright the glow\'s three pools are 60, 62 and 70 % of the width; in landscape they follow the height and stay a halo round the glass',
          up.r.length === 3 && Math.abs(up.r[0] - 0.60 * up.w) < 0.5 && Math.abs(up.r[1] - 0.62 * up.w) < 0.5 && Math.abs(up.r[2] - 0.70 * up.w) < 0.5 &&
          side.r.length === 3 && side.w === 844 && seenSide < 0.5 * side.w && seenSide > 0.6 * side.h,
          'upright ' + up.r.map(Math.round).join(', ') + ' px, seen across ' + Math.round(seenUp) + ' of ' + up.w + ' px; on its side ' +
          side.r.map(Math.round).join(', ') + ' px, seen across ' + Math.round(seenSide) + ' of ' + side.w + ' px');

  // a running glass, restored by a reload, breathes again from an in-breath
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(1500);
  await t.reload();
  await sleep(700);
  var b = await state();
  s.check('SAVED: a running glass restored by a reload breathes again, from an in-breath',
          b.state === 'running' && b.on && b.cls && b.sel === 'deep' && b.age < 2500, JSON.stringify(b));
  await t.close();

  // a pattern this version does not know falls back to Calm
  t = await env.open({ storage: seed({ breath: true, breathPattern: 'ocean' }) });
  await sleep(600);
  var c = await state();
  s.check('SAVED: an unknown saved pattern falls back to Calm', c.sw && c.sel === 'calm', JSON.stringify({ sw: c.sw, sel: c.sel }));
  s.check('SAVED: no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  await t.close();

  // ... and so does a name every object answers to (damaged storage): Calm, breathing, one timer for each part
  t = await env.open({ storage: seed({ breath: true, breathPattern: 'constructor' }), init: function () {
    var st = window.setTimeout;
    window.__steps = 0;
    window.setTimeout = function (f) { if (/breathStep/.test(String(f))) window.__steps++; return st.apply(window, arguments); };
  } });
  await sleep(600);
  var d = await state();
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(1500);
  var d2 = await t.eval(function () {
    return { n: window.Hourglass.breath.n, o: +getComputedStyle(document.getElementById('breath')).opacity, steps: window.__steps };
  });
  s.check('SAVED: a saved pattern named like a built-in property ("constructor") falls back to Calm too, and breathes',
          d.sw && d.sel === 'calm' && d2.n === 0 && d2.o > 0.05 && d2.steps === 1 && t.errors.length === 0,
          JSON.stringify({ sw: d.sw, sel: d.sel, part: d2.n, glow: +d2.o.toFixed(2), timers: d2.steps }) + ' ' + t.errors.slice(0, 2).join(' | '));
  await t.close();
}

(async function main() {
  var s = new H.Suite('app-breath');
  var env = await H.start();
  var only = env.args.only;
  var all = [['tune', tune], ['calm', calm], ['rest', rest],
             ['box', function (su, en) { return pattern(su, en, 'box'); }],
             ['deep', function (su, en) { return pattern(su, en, 'deep'); }],
             ['clock', clock], ['reduce', reduce], ['zen', zen], ['saved', saved]];
  try {
    for (var i = 0; i < all.length; i++) {
      if (only && only !== all[i][0]) continue;
      try {
        await all[i][1](s, env);
      } catch (e) {
        s.check(all[i][0] + ': no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
      }
    }
  } finally {
    await env.close();
  }
  s.done();
})();
