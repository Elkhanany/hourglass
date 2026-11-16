#!/usr/bin/env node
/*
 * A finger on the glass, as a person uses one: real touch events on an
 * emulated iPhone (lib/replay-iphone.js), the app untouched. What the user
 * asked for is that the glass can be crashed, and that it never breaks by
 * accident, so the suite has two halves.
 *
 * MUST crack: a drop from the top of its travel; a slam on the desk at
 * 1,100 px/s or more; eight quick knocks scattered by 6 px; three hard
 * flicks; and, with Real motion on, a vigorous shake of the phone toward
 * and away from the face.
 *
 * NEVER mark it (damage under 0.2, no crack): the Flip button pressed twelve
 * times; casual flicks; taps up to two a second; triple taps; gentle
 * dragging; set-downs from under 55 px; letting go after an ordinary drag;
 * a hard shake with Real motion off.
 *
 * And what goes with a crash: a drop from about 90 px creaks, leaves about
 * 0.35 of damage, a stress mark and, once, a quiet note; the note about
 * mending shows for the first three cracks; a second blow on a crack opens
 * it and sand spills; holding it mends it and Reset gives a new glass;
 * with Reduce Motion a glass let go glides home but a slam still counts;
 * knocks reach a dimmed glass and leave the timer alone.
 *
 * A take whose INPUT came out wrong on a busy machine (touch events arrive
 * late and in clumps here: a slam that never reached 1,100 px/s, a knock
 * that came 0.4 s after the last) is repeated, up to three times, and says
 * so. A take is never repeated for its result.
 *
 *   node tools/test/replay-finger.test.js [--root <dir>] [--port <n>] [--only must|never|more]
 */
'use strict';
var I = require('./lib/replay-iphone.js');
var sleep = I.sleep;

var TAP_HOLD = 65;                         // ms a quick fingertip tap stays on the glass
// A thumb or finger flick on a phone: 2.5 to 5 cm long, 70 to 180 ms
var FLICKS = { casual: { dist: 140, ms: 180 }, hard: { dist: 260, ms: 100 } };

async function fresh(env, o) {
  o = o || {};
  var t = await env.open(o);
  if (!o.idle) { await t.page.tap('#btn-play'); await sleep(o.zen ? 7500 : 1200); }
  if (o.sandBelow) {
    // two minutes into its run and paused: sand in the lower bulb, and the controls stay up
    await t.eval(function () { window.Hourglass.timer.rem -= 120000; });
    await sleep(1500);
    await t.page.tap('#btn-play');
    await sleep(700);
  }
  return t;
}
async function state(t) {
  return t.eval(function () {
    var H = window.Hourglass, s = H.sim, b = H.body, d = H.renderer._dmg;
    return { py: b.py, px: b.px, mode: b.mode, dMax: s.dMax, state: H.timer.state, lost: s.lost, spill: H.spill.count, mark: d ? d.markQ : 0,
             zen: document.getElementById('app').classList.contains('zen'),
             cracks: s.cracks.map(function (c) { return { L: c.L, w: c.w, sealed: c.sealed, bulb: c.bulb, u: c.u }; }) };
  });
}
/** Take it by the waist and lift it h px (the finger's travel) over ms, then hold still. */
async function lift(t, g, h, ms) {
  await t.finger.down(g.cx, g.cy); await sleep(40);
  await t.finger.path(function (u) { var e = u * u * (3 - 2 * u); return { x: g.cx, y: g.cy - h * e }; }, ms, false);
  await sleep(300);
}
/** Lift it and let go: the glass's height at let-go, and what the recorder saw until it has landed. */
async function drop(t, h, ms) {
  var g = await t.glass();
  await t.mark();
  await lift(t, g, h, ms || 600);
  var at = await state(t);
  await t.finger.up();
  await sleep(1600);
  var log = await t.log();
  log.from = -at.py;
  return log;
}
/** Lift it `up` px, then drive it down through the desk at V px/s and hold it there. */
async function slam(t, up, V) {
  var g = await t.glass();
  await t.mark();
  await lift(t, g, up, 800);
  var dist = up + 150;
  await t.finger.path(function (u) { return { x: g.cx, y: g.cy - up + dist * u }; }, dist / V * 1000, false);
  await sleep(250);
  await t.finger.up();
  await sleep(1200);
  return t.log();
}
/** n taps at `rate` a second round (x, y), each scattered by sigma px; burst {n, pauseMs}: in groups. */
async function taps(t, x, y, o) {
  var r = I.rng(o.seed || 7), gap = 1000 / o.rate, t0 = Date.now();
  for (var k = 0; k < o.n; k++) {
    var due = t0 + k * gap + (o.burst ? Math.floor(k / o.burst.n) * o.burst.pauseMs : 0);
    if (Date.now() < due) await sleep(due - Date.now());
    await t.finger.tap(x + I.gauss(r) * o.sigma, y + I.gauss(r) * o.sigma, TAP_HOLD);
  }
}
/** The largest gap between knocks the page saw, ms. */
function worstGap(log) {
  var w = 0;
  for (var i = 1; i < log.knocks.length; i++) if (log.knocks[i].t - log.knocks[i - 1].t > w) w = log.knocks[i].t - log.knocks[i - 1].t;
  return w;
}
/** One flick across the upper bulb: the finger lands already moving and lifts at full speed. */
async function flick(t, g, f) {
  var x0 = g.cx - 60, y = g.cy - 110;      // on the glass also while it spins (it draws back to 0.6 of its size)
  await t.finger.down(x0, y);
  await t.finger.path(function (u) { return { x: x0 + f.dist * (0.25 * u + 0.75 * u * u), y: y }; }, f.ms, true);
}
function hitsText(log) {
  return log.hits.map(function (h) {
    return (h.ny > 0 ? 'desk' : (h.ny < 0 ? 'top edge' : 'side edge')) + ' at ' + h.v + ' px/s' + (h.held ? ' (held)' : '') + ' → ' + ['a clink', 'a creak', 'a crack', 'a breach'][h.grade];
  }).join(', ') || 'no blow';
}
function never(s, label, log, st, detail) {
  s.check('NEVER ' + label, log.dMaxPeak < 0.2 && st.cracks.length === 0,
    'damage ' + log.dMaxPeak.toFixed(3) + ' (< 0.2), ' + st.cracks.length + ' cracks' + (detail ? '; ' + detail : ''));
}

/* ---- MUST ------------------------------------------------------------------ */
async function must(s, env) {
  var t, g, log, st, k, tries;

  // a drop from the top of its travel
  t = await fresh(env);
  g = await t.glass();
  log = await drop(t, 280, 1500);                    // lifted slowly: it only touches the top edge
  st = await state(t);
  var land = log.hits.filter(function (h) { return h.ny > 0 && !h.held; })[0];
  s.check('MUST a drop from the top of its travel cracks on landing',
    !!land && land.grade >= 2 && st.cracks.length === 1 && Math.abs(log.from + g.room.y0) < 2,
    'lifted ' + log.from.toFixed(0) + ' px (the room above it: ' + (-g.room.y0).toFixed(0) + ' px), ' + hitsText(log) + '; crack ' +
    (st.cracks[0] ? st.cracks[0].L.toFixed(0) + ' cells long on the ' + (st.cracks[0].bulb ? 'lower' : 'upper') + ' dome' : 'none'));
  s.check('... it is seen, heard and said at once', st.cracks.length === 1 && st.cracks[0].L >= 14 && I.count(log, 'crack') === 1 &&
    log.events.some(function (e) { return e.k === 'toast' && /cracked/.test(e.v); }) && st.cracks[0].bulb === 1,
    'crack sound ' + I.count(log, 'crack') + ', thump ' + I.count(log, 'thump') + ', clack ' + I.count(log, 'clack') + ', note "' +
    (log.events.filter(function (e) { return e.k === 'toast'; }).map(function (e) { return e.v; })[0] || '') + '"');
  var margin = land ? land.v / 920 : 0;
  s.note('margin', 'the drop landed at ' + (land ? land.v : '?') + ' px/s; it cracks from 920 (' + ((margin - 1) * 100).toFixed(0) + ' % to spare)');
  await t.close();

  // a slam at 1,100 px/s or more
  for (tries = 1; tries <= 3; tries++) {
    t = await fresh(env);
    log = await slam(t, 125, 1900);
    st = await state(t);
    k = log.hits.filter(function (h) { return h.ny > 0 && h.held && h.v >= 1100; })[0];
    if (k || tries === 3) break;
    s.note('slam, take ' + tries, 'the glass only reached ' + hitsText(log) + ': repeated');
    await t.close();
  }
  s.check('MUST a slam on the desk at 1,100 px/s or more cracks it', !!k && k.grade >= 2 && st.cracks.length >= 1,
    hitsText(log) + (tries > 1 ? ' (take ' + tries + ')' : ''));
  s.check('... every blow of 920 px/s or more cracked, none under 700 px/s left a mark',
    log.hits.every(function (h) { return h.v >= 920 ? h.grade >= 2 : (h.v < 700 ? h.grade === 0 : h.grade === 1); }), hitsText(log));
  await t.close();

  // eight quick knocks with 6 px of scatter
  var kn;
  for (tries = 1; tries <= 3; tries++) {
    t = await fresh(env, { idle: true });
    g = await t.glass();
    await t.mark();
    await taps(t, g.cx + 0.55 * g.R * g.pxPerCell, g.cy - 0.5 * g.HB * g.pxPerCell, { rate: 5, sigma: 6, n: 8, seed: 6 + tries });
    await sleep(900);
    log = await t.log(); st = await state(t);
    if ((log.knocks.length === 8 && worstGap(log) < 380) || tries === 3) break;
    s.note('knocks, take ' + tries, log.knocks.length + ' knocks, the longest gap ' + worstGap(log) + ' ms: repeated');
    await t.close();
  }
  kn = log.knocks.filter(function (q) { var c = I.first(log, 'crack'); return c !== null && q.t <= c * 1000 + 30; }).length;
  var ck = log.knocks.filter(function (q) { var c = I.first(log, 'creak'); return c !== null && q.t <= c * 1000 + 30; }).length;
  s.check('MUST eight quick knocks with 6 px of scatter crack it', st.cracks.length === 1 && kn === 8,
    'cracked on knock ' + kn + ' at ' + (I.first(log, 'crack') || 0).toFixed(2) + ' s; strengths ' + log.knocks.map(function (q) { return q.s; }).join(' ') +
    '; longest gap ' + worstGap(log) + ' ms' + (tries > 1 ? ' (take ' + tries + ')' : ''));
  s.check('... it creaks first (from about the fifth), each creak with a tick in the hand', ck >= 4 && ck <= 6 && I.count(log, 'creak') >= 2 && I.count(log, 'haptic') >= 8,
    'first creak on knock ' + ck + ', ' + I.count(log, 'creak') + ' creaks, ' + I.count(log, 'haptic') + ' ticks');
  s.check('... and the burst never started the glass (its first tap is taken back)', st.state === 'idle', 'idle → ' + st.state + ', ' + I.count(log, 'state') + ' changes');
  await t.close();

  // three hard flicks
  var full = 0, total = 0;
  for (tries = 1; tries <= 3; tries++) {
    t = await fresh(env);
    g = await t.glass();
    await t.mark();
    for (k = 0; k < 6; k++) {
      await flick(t, g, FLICKS.hard);
      await sleep(900);
      if ((await state(t)).cracks.length) break;
    }
    await sleep(1500);
    log = await t.log(); st = await state(t);
    var crackT = I.first(log, 'crack');
    var upto = log.flicks.filter(function (q) { return crackT === null || q.t <= crackT * 1000 + 30; });
    full = upto.filter(function (q) { return q.dose >= 0.36; }).length; total = upto.length;
    if (st.cracks.length || full >= 3 || tries === 3) break;
    s.note('flicks, take ' + tries, 'only ' + full + ' of ' + total + ' flicks came out hard (' + log.flicks.map(function (q) { return q.g; }).join(' ') + ' g): repeated');
    await t.close();
  }
  s.check('MUST three hard flicks crack it', st.cracks.length >= 1 && full <= 3 && total <= 6,
    'cracked after ' + total + ' flicks, ' + full + ' of them hard (0.40 g at the dome or more); peak g and dose of each: ' +
    log.flicks.map(function (q) { return q.g + '→' + q.dose; }).join(', ') + (tries > 1 ? ' (take ' + tries + ')' : ''));
  await t.close();

  // the phone itself, shaken toward and away from the face, in the app
  t = await fresh(env);
  await t.mark();
  await t.phone.play('vigorousZ', { durS: 4 });
  log = await t.log();
  s.check('NEVER a hard shake with Real motion off does anything', log.dMaxPeak === 0 && log.peakSimG === 0, 'damage ' + log.dMaxPeak + ', ' + log.peakSimG.toFixed(2) + ' g reached the sand');
  var on = await t.realMotionOn();
  await sleep(600);
  await t.mark();
  await t.phone.play('vigorousZ', { durS: 6 });
  log = await t.log(); st = await state(t);
  s.check('MUST with Real motion on, 3 g at 4.5 Hz toward and away from the face cracks it', on.on && st.cracks.length >= 1 && I.first(log, 'crack') <= 5.5,
    'creak at ' + (I.first(log, 'creak') || 0).toFixed(1) + ' s, crack at ' + (I.first(log, 'crack') || 0).toFixed(1) + ' s, chip at ' + (I.first(log, 'chip') || 0).toFixed(1) +
    ' s (in the browser, in real time; replay-phone holds it to 4 s on a steady clock)');
  await t.close();
}

/* ---- NEVER ----------------------------------------------------------------- */
async function neverMarks(s, env) {
  var t, g, log, st, k;

  t = await fresh(env);
  await t.mark();
  for (k = 0; k < 12; k++) { await t.page.tap('#btn-flip'); await sleep(330); }
  await sleep(3500);
  log = await t.log(); st = await state(t);
  never(s, 'the Flip button pressed twelve times in 4 s', log, st, 'peak ' + log.peakW.toFixed(1) + ' rad/s, ' + log.peakSpinG.toFixed(3) + ' g at the dome (0.22 counts)');
  await t.close();

  t = await fresh(env);
  g = await t.glass();
  await t.mark();
  for (k = 0; k < 8; k++) { await flick(t, g, FLICKS.casual); await sleep(900); }
  await sleep(2500);
  log = await t.log(); st = await state(t);
  var gs = log.flicks.map(function (q) { return q.g; }), gmean = gs.reduce(function (a, b) { return a + b; }, 0) / (gs.length || 1);
  never(s, 'eight casual flicks', log, st, 'peak g at the dome ' + gs.join(' ') + ' (mean ' + gmean.toFixed(2) +
    '; a dose starts at 0.22, and eight flicks pass 0.2 of damage only from 0.23 each)');
  await t.close();

  t = await fresh(env, { idle: true });
  g = await t.glass();
  var kx = g.cx + 0.55 * g.R * g.pxPerCell, ky = g.cy - 0.5 * g.HB * g.pxPerCell;
  await t.mark();
  await taps(t, kx, ky, { rate: 2, sigma: 4, n: 20 });
  await sleep(600);
  log = await t.log(); st = await state(t);
  never(s, 'taps at two a second for 10 s', log, st, 'strengths ' + log.knocks.slice(0, 6).map(function (q) { return q.s; }).join(' ') + ' … (1.2 counts)');
  await t.mark();
  await taps(t, kx, ky, { rate: 1, sigma: 4, n: 6 });
  await sleep(600);
  log = await t.log(); st = await state(t);
  never(s, 'taps at one a second', log, st, I.count(log, 'state') + ' starts and pauses in 6 taps');
  s.check('... and each of them still starts or pauses the glass', I.count(log, 'state') === 6, I.count(log, 'state') + ' of 6');
  await t.close();

  t = await fresh(env, { idle: true });
  await t.mark();
  await taps(t, kx, ky, { rate: 5, sigma: 4, n: 12, burst: { n: 3, pauseMs: 1500 } });
  await sleep(600);
  log = await t.log(); st = await state(t);
  never(s, 'four triple taps', log, st, 'strengths ' + log.knocks.map(function (q) { return q.s; }).join(' '));
  await t.close();

  var drags = [
    ['gentle dragging: carried in 60 px circles, once a second, for 5 s', async function (t, g) {
      await t.finger.path(function (u) { var a = 2 * Math.PI * 5 * u; return { x: g.cx + 60 * Math.sin(a), y: g.cy - 60 + 60 * Math.cos(a) }; }, 5000, false);
    }],
    ['gentle dragging: slid along the desk and against the screen\'s edges, 1 Hz for 5 s', async function (t, g) {
      await t.finger.path(function (u) { return { x: g.cx + 55 * Math.sin(2 * Math.PI * 5 * u), y: g.cy }; }, 5000, false);
    }],
    ['a set-down by hand: lifted 100 px, brought down in half a second, stopping at the desk', async function (t, g) {
      await t.finger.path(function (u) { var e = u * u * (3 - 2 * u); return { x: g.cx, y: g.cy - 100 * e }; }, 500, false);
      await sleep(300);
      await t.finger.path(function (u) { var e = u * u * (3 - 2 * u); return { x: g.cx, y: g.cy - 100 * (1 - e) }; }, 500, false);
    }],
    ['letting go after an ordinary drag: 60 px to the side and 30 px up', async function (t, g) {
      await t.finger.path(function (u) { return { x: g.cx + 60 * u, y: g.cy - 30 * u }; }, 300, false);
    }],
    ['letting go after an ordinary drag: pushed to the edge of the screen and let go there', async function (t, g) {
      await t.finger.path(function (u) { return { x: g.cx + 110 * u, y: g.cy }; }, 450, false);
    }]
  ];
  for (k = 0; k < drags.length; k++) {
    t = await fresh(env);
    g = await t.glass();
    await t.mark();
    await t.finger.down(g.cx, g.cy); await sleep(40);
    await drags[k][1](t, g);
    await sleep(200);
    await t.finger.up();
    await sleep(1800);
    log = await t.log(); st = await state(t);
    var top = Math.max.apply(null, log.hits.map(function (h) { return h.v; }).concat([0]));
    never(s, drags[k][0], log, st, log.hits.length + ' touches of the desk or an edge, the hardest at ' + top + ' px/s (a mark from 700)');
    await t.close();
  }

  // set-downs from under 55 px: let go at 25, 40 and 52 px
  t = await fresh(env);
  var lows = [];
  for (k = 0; k < 3; k++) {
    log = await drop(t, [42, 57, 69][k], 500);
    st = await state(t);
    var hv = log.hits.filter(function (h) { return h.ny > 0; }).map(function (h) { return h.v; })[0] || 0;
    lows.push(log.from.toFixed(0) + ' px → ' + hv + ' px/s');
    if (!(log.from < 55 && log.dMaxPeak < 0.2 && st.cracks.length === 0)) break;
  }
  s.check('NEVER set-downs from under 55 px (let go at three heights)', k === 3 && st.dMax < 0.2 && st.cracks.length === 0,
    lows.join(', ') + ' (a mark from 700 px/s); damage ' + st.dMax.toFixed(3));
  await t.close();
}

/* ---- what goes with a crash --------------------------------------------- */
async function more(s, env) {
  var t, g, log, st, k;

  // a drop from about 90 px creaks
  t = await fresh(env, { sandBelow: true });
  log = await drop(t, 106, 700);
  st = await state(t);
  var land = log.hits.filter(function (h) { return h.ny > 0; })[0] || { v: 0, grade: -1 };
  s.check('a drop from about 90 px creaks: about 0.35 of damage, a stress mark, a creak, no crack',
    log.from > 80 && log.from < 100 && land.grade === 1 && log.dMaxPeak > 0.3 && log.dMaxPeak < 0.4 && st.cracks.length === 0 && I.count(log, 'creak') === 1 && st.mark > 0,
    'let go at ' + log.from.toFixed(0) + ' px, landed at ' + land.v + ' px/s; damage ' + log.dMaxPeak.toFixed(2) + ', mark ' + (st.mark > 0 ? 'drawn' : 'missing') + ', ' + I.count(log, 'creak') + ' creak');
  var notes = log.events.filter(function (e) { return e.k === 'toast'; }).map(function (e) { return e.v; });
  s.check('... with one quiet note, the first time a finger makes it creak', notes.length === 1 && /can crack/.test(notes[0]), JSON.stringify(notes));
  await sleep(3000);
  var healed = await state(t);
  s.check('... and the mark fades as the glass heals', healed.dMax < st.dMax - 0.05 && healed.dMax > 0, st.dMax.toFixed(2) + ' → ' + healed.dMax.toFixed(2) + ' in 3 s');
  // more drops from the same height, one after another: each adds its 0.35 to what has not yet
  // healed (it fades with a time constant of 8 s), so about the fifth cracks it; the note is not shown again
  var again = 0, nDrops = 1, trail = [st.dMax.toFixed(2)];
  while (nDrops < 8) {
    log = await drop(t, 106, 700);
    nDrops++;
    again += log.events.filter(function (e) { return e.k === 'toast' && /can crack/.test(e.v); }).length;
    st = await state(t);
    trail.push(st.cracks.length ? 'crack' : log.dMaxPeak.toFixed(2));
    if (st.cracks.length) break;
  }
  s.check('such drops one after another crack it, on about the fifth or sixth (the note about care is not repeated)',
    st.cracks.length === 1 && nDrops >= 4 && nDrops <= 7 && again === 0,
    'damage after each: ' + trail.join(', ') + '; the note shown again ' + again + ' times');
  // a second cracking blow on the crack opens it, and sand spills
  log = await drop(t, 280, 1500);
  await sleep(3500);
  st = await state(t);
  s.check('a cracking blow on a cracked glass breaks it through, and sand spills onto the desk',
    st.cracks.length === 1 && st.cracks[0].w >= 1 && st.lost > 0 && st.spill > 0,
    hitsText(log) + '; breach ' + (st.cracks[0] ? st.cracks[0].w : 0) + ' cells wide, crack ' + (st.cracks[0] ? st.cracks[0].L.toFixed(0) : 0) + ' cells, ' + st.lost + ' grains out, ' + st.spill + ' on the desk');
  // the mend: a still finger
  g = await t.glass();
  await t.finger.down(g.cx + 30, g.cy - 60);
  await sleep(1900);
  await t.finger.up();
  await sleep(600);
  var lost0 = (await state(t)).lost;
  await sleep(2500);
  st = await state(t);
  s.check('held still, it mends: gold in the crack, the leak stopped', st.cracks.length === 1 && st.cracks[0].sealed && st.lost === lost0,
    'sealed ' + (st.cracks[0] && st.cracks[0].sealed) + ', ' + (st.lost - lost0) + ' grains lost in the 2.5 s after');
  log = await drop(t, 280, 1500);
  st = await state(t);
  s.check('a mended glass can crack again, beside the gold', st.cracks.length === 2 && st.cracks[0].sealed && !st.cracks[1].sealed, st.cracks.length + ' cracks; ' + hitsText(log));
  await t.page.tap('#btn-reset');
  await sleep(1200);
  st = await state(t);
  s.check('Reset gives a new glass', st.cracks.length === 0 && st.dMax === 0 && st.lost === 0 && st.spill === 0, st.cracks.length + ' cracks, ' + st.spill + ' grains on the desk');
  await t.close();

  // the note about mending: the first three cracks, not the fourth
  t = await fresh(env, { idle: true });
  var shown = [];
  for (k = 0; k < 4; k++) {
    await t.mark();
    await t.eval(function () { window.Hourglass.debug.forceCrack(6, 20, 0); });
    await sleep(500);
    shown.push((await t.log()).events.filter(function (e) { return e.k === 'toast' && /cracked/.test(e.v); }).length);
    await sleep(4300);                               // the note has gone
    await t.eval(function () { window.Hourglass.reset(); });
    await sleep(900);
  }
  s.check('the note "The glass cracked · hold it still to mend" shows for the first three cracks, not the fourth', shown.join('') === '1110', 'shown ' + shown.join(', '));
  await t.close();

  // Reduce Motion: let go, it glides home; slammed or knocked, it still counts
  t = await fresh(env, { reducedMotion: true });
  log = await drop(t, 120, 700);
  st = await state(t);
  s.check('Reduce Motion: let go in the air it glides home (no fall, no blow)', log.from > 90 && log.hits.length === 0 && st.py === 0 && st.dMax === 0,
    'let go at ' + log.from.toFixed(0) + ' px; ' + hitsText(log) + '; back at ' + st.py.toFixed(1) + ' px');
  var tries, hard;
  for (tries = 1; tries <= 3; tries++) {
    log = await slam(t, 125, 1900);
    st = await state(t);
    hard = log.hits.filter(function (h) { return h.ny > 0 && h.held && h.v >= 1100; })[0];
    if (hard || st.cracks.length || tries === 3) break;
    s.note('Reduce Motion slam, take ' + tries, 'only ' + hitsText(log) + ': repeated');
    await t.page.tap('#btn-reset'); await sleep(1200);
  }
  s.check('Reduce Motion: a glass banged on the desk still cracks', !!hard && st.cracks.length >= 1, hitsText(log));
  await t.close();
  for (tries = 1; tries <= 3; tries++) {
    t = await fresh(env, { reducedMotion: true, idle: true });
    g = await t.glass();
    await t.mark();
    await taps(t, g.cx + 0.55 * g.R * g.pxPerCell, g.cy - 0.5 * g.HB * g.pxPerCell, { rate: 5, sigma: 6, n: 8, seed: 20 + tries });
    await sleep(900);
    log = await t.log(); st = await state(t);
    if ((log.knocks.length === 8 && worstGap(log) < 380) || tries === 3) break;
    await t.close();
  }
  s.check('Reduce Motion: eight quick knocks still crack it', st.cracks.length === 1, 'strengths ' + log.knocks.map(function (q) { return q.s; }).join(' ') + (tries > 1 ? ' (take ' + tries + ')' : ''));
  await t.close();

  // knocks reach a dimmed glass, and leave the timer alone
  for (tries = 1; tries <= 3; tries++) {
    t = await fresh(env, { zen: true });
    g = await t.glass();
    var z0 = await state(t);
    await t.mark();
    await taps(t, g.cx + 0.55 * g.R * g.pxPerCell, g.cy - 0.5 * g.HB * g.pxPerCell, { rate: 5, sigma: 6, n: 8, seed: 30 + tries });
    await sleep(900);
    log = await t.log(); st = await state(t);
    if ((z0.zen && log.knocks.length === 8 && worstGap(log) < 380) || tries === 3) break;
    await t.close();
  }
  s.check('knocks reach a dimmed glass: eight crack it, the first wakes the controls, the timer runs on',
    z0.zen && st.cracks.length === 1 && !st.zen && st.state === 'running' && I.count(log, 'state') === 0,
    'dimmed ' + z0.zen + ' → ' + st.zen + '; ' + st.cracks.length + ' crack; ' + z0.state + ' → ' + st.state + ' with ' + I.count(log, 'state') + ' changes' + (tries > 1 ? ' (take ' + tries + ')' : ''));
  await t.close();

  // a glass thrown at the edge of the screen
  for (tries = 1; tries <= 3; tries++) {
    t = await fresh(env);
    g = await t.glass();
    await t.mark();
    await t.finger.down(g.cx, g.cy); await sleep(40);
    await t.finger.path(function (u) { return { x: g.cx + 200 * u * u, y: g.cy }; }, 85, true);
    await sleep(2000);
    log = await t.log(); st = await state(t);
    if (log.hits.some(function (h) { return h.nx > 0 && h.v >= 920; }) || tries === 3) break;
    await t.close();
  }
  var side = log.hits.filter(function (h) { return h.nx > 0; })[0] || { v: 0, grade: 0 };
  s.check('thrown at the edge of the screen it strikes it, and cracks on its flank', side.v >= 920 && side.grade >= 2 && st.cracks.length >= 1 && st.cracks[0].u > 0.5 && st.cracks[0].u < 0.8 && st.px === 0,
    hitsText(log) + '; crack at u = ' + (st.cracks[0] ? st.cracks[0].u.toFixed(2) : '-') + ' (the widest part is 0.66); back in its place: ' + (st.px === 0));
  await t.close();
}

(async function main() {
  var s = new I.Suite('replay-finger');
  var env = await I.launch(), only = env.args.only;
  try {
    if (!only || only === 'must') await must(s, env);
    if (!only || only === 'never') await neverMarks(s, env);
    if (!only || only === 'more') await more(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
