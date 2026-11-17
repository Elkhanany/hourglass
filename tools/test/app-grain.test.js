/*
 * Grain (Tune): the same glass in finer sand.
 *
 *   TUNE    the row and its three choices, Classic chosen at first; the sand
 *           as it has been (scale 1.08, pace 1)
 *   CHOOSE  Finest, chosen while a glass runs: the page builds the glass
 *           afresh at twice the scale, with four times the grains and the
 *           pace set; the choice is saved and shown; the time runs on
 *   SAME    the finest glass keeps the clock (as much of its sand above the
 *           neck as there is time left), runs out with it, and Sand adds
 *           time as fast as on the classic glass
 *   BACK    Classic again, chosen while paused: the time is kept
 *   CRACK   a cracked glass comes back whole in another grain (Fine: twice
 *           the grains)
 *
 *   node tools/test/app-grain.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;
var KEY = 'hourglass.settings.v1';

function center(t, sel) {
  return t.eval(function (q) { var r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
}
function snap(t) {
  return t.eval(function (key) {
    var W = window.Hourglass, s = W.sim, st = JSON.parse(localStorage.getItem(key) || '{}');
    var on = document.querySelector('#grains [aria-checked="true"]');
    return { q: s.geo.q, pace: window.HourglassPhysics.Sim.pace(), total: s.total, top: s.nTop, state: W.timer.state, rem: W.timer.rem,
             dur: W.timer.durationMs, saved: st.grain, shown: on ? on.dataset.grain : null, cracks: s.cracks.length,
             main: document.getElementById('t-main').textContent, count: document.getElementById('grain-count').textContent };
  }, KEY);
}
/** Choose a grain in Tune; the page builds the glass afresh. Resolves when it is there. */
async function choose(t, grain, want) {
  await t.page.tap('#btn-settings');
  await sleep(800);
  await t.page.$eval('#grains', function (el) { el.scrollIntoView({ block: 'center' }); });
  await sleep(300);
  var c = await center(t, '#grains [data-grain="' + grain + '"]');
  await t.touch.tap(c.x, c.y, 60);
  for (var i = 0; i < 60; i++) {
    await sleep(250);
    try {
      var ok = await t.page.evaluate(function (w) { return !!(window.Hourglass && window.Hourglass.sim && Math.abs(window.Hourglass.sim.geo.q - w) < 1e-9 && document.readyState === 'complete'); }, want);
      if (ok) break;
    } catch (e) { /* the page is on its way */ }
  }
  await sleep(900);
}
/** Hold Sand for a second on an idle glass and say how much time it added (ms). */
async function pourSecond(t) {
  var r0 = await t.eval(function () { return window.Hourglass.timer.rem; });
  var c = await center(t, '#btn-sand');
  await t.touch.down(c.x, c.y);
  await sleep(1000);
  await t.touch.up();
  await sleep(1500);
  return (await t.eval(function () { return window.Hourglass.timer.rem; })) - r0;
}

async function run(s, env) {
  var t = await env.open({});
  try {
    await sleep(900);
    /* ---- TUNE ----------------------------------------------------------- */
    var ui = await t.eval(function () {
      var g = document.getElementById('grains'), bs = g.querySelectorAll('button[role="radio"]'), row = document.getElementById('grain-row');
      var rows = document.getElementById('opt-layers').closest('.rows');
      return { role: g.getAttribute('role'), n: bs.length, names: Array.prototype.map.call(bs, function (b) { return b.textContent.replace(/\s+/g, ' ').trim(); }),
               head: row.querySelector('b').textContent, after: rows.contains(g) && !!(row.compareDocumentPosition(g) & 4) };
    });
    var a = await snap(t);
    s.check('TUNE: a Grain row with three choices sits under Layered sand', ui.role === 'radiogroup' && ui.n === 3 && ui.head === 'Grain' && ui.after &&
            ui.names.join(' / ') === 'Classic / Fine ×2 / Finest ×4', ui.names.join(' / '));
    s.check('TUNE: Classic is chosen at first, and the sand is as it has been', a.shown === '0' && a.q === 1.08 && a.pace === 1 && (a.saved === undefined || a.saved === 0),
            'scale ' + a.q + ', pace ' + a.pace + ', ' + a.total + ' grains');
    await t.eval(function () { window.Hourglass.setDuration(30000); });
    await sleep(1200);
    a = await snap(t);
    var poured0 = await pourSecond(t);
    await t.page.tap('#btn-reset');
    await sleep(2600);

    /* ---- CHOOSE: Finest, while it runs ------------------------------------ */
    var g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(5000);
    var before = await snap(t), t0 = Date.now();
    await choose(t, 2, 1.08 * 2);
    var b = await snap(t), away = Date.now() - t0;
    s.check('CHOOSE: Finest builds the glass afresh at twice the scale, with four times the grains, the pace set',
            Math.abs(b.q - 2.16) < 1e-9 && b.pace === 2 && b.total > 3.9 * a.total && b.total < 4.1 * a.total, 'scale ' + b.q + ', pace ' + b.pace + ', ' + a.total + ' → ' + b.total + ' grains');
    s.check('CHOOSE: the choice is saved and shown', b.saved === 2 && b.shown === '2', 'saved ' + b.saved + ', shown ' + b.shown);
    s.check('CHOOSE: the glass still runs, and its time ran on meanwhile', before.state === 'running' && b.state === 'running' && b.dur === 30000 &&
            Math.abs(before.rem - away - b.rem) < 900, 'left ' + (before.rem / 1000).toFixed(1) + ' s, ' + (away / 1000).toFixed(1) + ' s later ' + (b.rem / 1000).toFixed(1) + ' s');

    /* ---- SAME ------------------------------------------------------------- */
    var sh = b.top / b.total, due = b.rem / b.dur;
    s.check('SAME: as much of the finest sand is above the neck as there is time left', Math.abs(sh - due) < 0.05, (sh * 100).toFixed(1) + ' % of the sand, ' + (due * 100).toFixed(1) + ' % of the time');
    await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done'; }, null, { timeout: 40000 });
    await sleep(600);
    var e = await snap(t);
    s.check('SAME: it runs out with the clock: 00:00, and no grain left above the neck', e.main === '00:00' && e.top === 0 && e.total === b.total, e.main + ', ' + e.top + ' above the neck');
    await t.page.tap('#btn-reset');
    await sleep(2600);
    var poured2 = await pourSecond(t);
    s.check('SAME: a second of Sand adds as much time as on the classic glass', poured0 > 1500 && poured2 > 0.7 * poured0 && poured2 < 1.4 * poured0,
            'classic +' + (poured0 / 1000).toFixed(1) + ' s, finest +' + (poured2 / 1000).toFixed(1) + ' s');
    await t.page.tap('#btn-settings');
    await sleep(800);
    var shown = await t.eval(function () { return document.getElementById('grain-count').textContent; });
    await t.page.keyboard.press('Escape');
    await sleep(700);
    s.check('SAME: Tune says how many grains it now simulates', +shown.replace(/\D/g, '') > 3.9 * a.total, shown + ' grains shown, ' + a.total + ' in the classic glass');
    await t.page.tap('#btn-reset');
    await sleep(2600);

    /* ---- BACK: Classic again, while paused -------------------------------- */
    g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(3000);
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(800);
    var p0 = await snap(t);
    await choose(t, 0, 1.08);
    var p1 = await snap(t);
    s.check('BACK: Classic again: the sand as it was, the glass still paused at its time', p0.state === 'paused' && p1.state === 'paused' && p1.q === 1.08 && p1.pace === 1 &&
            Math.abs(p1.total - a.total) < 0.01 * a.total && Math.abs(p1.rem - p0.rem) < 300 && p1.saved === 0 && p1.shown === '0',
            (p0.rem / 1000).toFixed(1) + ' s → ' + (p1.rem / 1000).toFixed(1) + ' s, ' + p1.total + ' grains');

    /* ---- CRACK ---------------------------------------------------------------- */
    await t.eval(function () { window.Hourglass.debug.forceCrack(20, 40, 2); });
    await sleep(600);
    var c0 = await snap(t);
    await choose(t, 1, 1.08 * Math.SQRT2);
    var c1 = await snap(t);
    s.check('CRACK: in another grain the glass comes back whole (Fine: twice the grains), its time kept', c0.cracks === 1 && c1.cracks === 0 && c1.total > 1.95 * a.total && c1.total < 2.05 * a.total &&
            Math.abs(c1.pace - Math.SQRT2) < 1e-9 && c1.state === 'paused' && Math.abs(c1.rem - c0.rem) < 300, c0.cracks + ' crack → ' + c1.cracks + ', ' + c1.total + ' grains');
    await H.invariants(s, t, 'GRAIN');
  } finally {
    await t.close();
  }
}

async function main() {
  var s = new H.Suite('app-grain');
  var env = await H.start();
  try {
    await run(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
}

module.exports = { run: run };
if (require.main === module) main();
