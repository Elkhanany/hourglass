#!/usr/bin/env node
/*
 * The sand lab's Timer arithmetic (lab/sand/timer.mjs) in Node, without a browser: the app's
 * amounts and clock, and the power modes, as the page runs them.
 *
 * Checks: the amounts are the app's square-root rule on the app's phone glass (the design's
 * table: 10 s 1,155 grains, 1 minute 2,830, 5 minutes 6,327, 10 minutes 8,948, 25 minutes
 * 14,148, 60 minutes and longer 21,917); the clock (calibrate, topAt, remAt) agrees with the
 * valve test's model of app.js (tools/test/lib/realsand-plant.js) and runs from N grains to 0;
 * the target with the breathing averages out and ends at 0. The modes: a run starts full (its
 * first 2 s, and 2 s after), then is calm; the tail and the end are full; felt motion counts
 * only above the design's thresholds (0.05 g, 0.5 rad/s, 5 rad/s^2) held for 0.3 s, or a lean
 * of 3 degrees within 0.5 s, so a phone held still in the hand stays calm; calm only while
 * auto Hz is at the base rate; a still glass that is not running falls asleep after 0.5 s and
 * wakes at a touch, when leaned 5 degrees or turned at 2 rad/s (within 0.5 s), or tilted at 0.5
 * degree a second (past 1 degree since it fell asleep, within 2.5 s), and in its own frame at a
 * jolt of 0.3 g (0.35 g for a frame, or a peak of 0.5 g between frames; not 0.25 g, nor jitter); the heat guard drops a
 * full glass slower than 0.6 of real time to calm after 20 s in a row (not after 19, and not
 * counting across calm frames), only in auto; the burst's cost removes a submit's fixed latency.
 *
 *   node tools/test/lab-timer.test.js
 */
'use strict';
var path = require('path');
var plant = require('./lib/realsand-plant.js');
var t0 = Date.now(), count = 0, failures = 0;
function log(s) { console.log(s); }
function f0(x) { return isFinite(x) ? String(Math.round(x)) : String(x); }
function check(ok, what) { count++; if (!ok) failures++; log((ok ? 'ok    ' : 'FAIL  ') + what); }
var TAU9 = 2 * Math.PI * 9;

(async function () {
  var T = await import(path.join(__dirname, '..', '..', 'lab', 'sand', 'timer.mjs'));

  /* ---- amounts ---- */
  var want = { 10e3: 1155, 60e3: 2830, 300e3: 6327, 600e3: 8948, 1500e3: 14148, 3600e3: 21917, 5999e3: 21917 };
  var got = Object.keys(want).map(function (ms) { return [ms, T.grainsFor(+ms), want[ms]]; });
  check(got.every(function (g) { return g[1] === g[2]; }), 'the amounts are the app\'s square-root rule on its phone glass: ' + got.map(function (g) { return (g[0] / 1000) + ' s ' + g[1]; }).join(', '));
  check(T.TIMERS.map(function (t) { return t.id; }).join() === '10s,1m,10m,60m,60m-4,60m-30' && T.timerById('60m-4').amountMs === 3600e3 && T.timerById('60m-4').ms === 240e3,
    'the Timer offers 10 s, 1, 10 and 60 minutes, and the 60-minute amount timed to 4 or 30 minutes');

  /* ---- the clock ---- */
  var worst = 0, ends = true;
  [[10e3, 1155], [60e3, 2830], [240e3, 21917], [3600e3, 21917], [12e3, 2830]].forEach(function (c) {
    var a = T.makeClock(c[0], c[1]), b = plant.makeClock(c[0], c[1], 1);
    if (a.tailMs !== b.tailMs || a.tailGrains !== b.tailGrains) worst = Infinity;
    for (var rem = 0; rem <= c[0]; rem += c[0] / 997) {
      worst = Math.max(worst, Math.abs(a.topAt(rem) - b.topAt(rem)), Math.abs(a.remAt(a.topAt(rem)) - rem) / 1000);
    }
    if (Math.abs(a.topAt(c[0]) - c[1]) > 1e-6 || a.topAt(0) !== 0) ends = false;
  });
  check(worst < 1e-6 && ends, 'the clock agrees with the model of app.js (worst ' + worst.toExponential(1) + '), runs from N grains at the start to 0 at 00:00.0, and remAt inverts topAt');
  var clk = T.makeClock(60e3, 2830), dev = 0, nb = 0, last = -1;
  for (var now = 0; now < 60e3; now += 1000 / 60) {
    var rem = 60e3 - now, ideal = clk.topAt(rem), tg = T.targetAt(clk, rem, now);
    if (rem > clk.tailMs + 4200) { dev += tg - ideal; nb++; }
    last = tg;
  }
  check(Math.abs(dev / nb) < 0.02 * clk.rate && T.targetAt(clk, 0, 1234) === 0 && T.breathing(clk, clk.tailMs + 1000, 5) === 0,
    'the target breathes about the clock (mean ' + (dev / nb).toFixed(2) + ' grains off, the rate ' + clk.rate.toFixed(1) + ' a second), is still in the tail and 0 at 00:00.0');

  /* ---- the modes ---- */
  var F0 = { a: 0, w: 0, alpha: 0, lean: 0 };
  // run a sequence of frames through chooseMode; each step: { ms, o } with o merged into the defaults
  function seq(steps, setting) {
    var m = T.newModes();
    var t = 0, out = [];
    steps.forEach(function (s, si) {
      for (var k = 0; k < s.ms; k += 1000 / 60) {
        var o = Object.assign({ now: t, setting: setting || 'auto', busy: '', felt: F0, active: true, still: false, pending: false, ratio: 1, atBase: true }, s.o || {});
        if (typeof o.felt === 'function') o.felt = o.felt(t);
        out.push({ t: t, mode: T.chooseMode(m, o), why: m.why, step: si });
        t += 1000 / 60;
      }
    });
    out.m = m;
    return out;
  }
  function at(out, t) { for (var i = out.length - 1; i >= 0; i--) if (out[i].t <= t) return out[i]; return out[0]; }
  var r = seq([{ ms: 2000, o: { busy: 'start' } }, { ms: 6000 }, { ms: 1000, o: { busy: 'tail' } }, { ms: 2500 }]);
  check(at(r, 1000).mode === 'full' && at(r, 3900).mode === 'full' && at(r, 4100).mode === 'calm' && at(r, 7900).mode === 'calm' && at(r, 8500).mode === 'full' && at(r, 10900).mode === 'full' && at(r, 11400).mode === 'calm',
    'a run is full in its first 2 s and 2 s after, then calm; full again in the tail and 2 s after it');
  // a phone held in the hand: small tremor, under the thresholds; then a real move
  var hand = function (t) { return { a: 0.02 + 0.01 * Math.sin(t / 50), w: 0.2 * Math.sin(t / 80), alpha: 2 * Math.cos(t / 80), lean: 0.01 * Math.sin(t / 300) }; };
  var r2 = seq([{ ms: 3000, o: { felt: hand } }, { ms: 250, o: { felt: { a: 0.08, w: 0, alpha: 0, lean: 0 } } }, { ms: 500 }, { ms: 400, o: { felt: { a: 0.08, w: 0, alpha: 0, lean: 0 } } }]);
  check(r2.slice(10, 180).every(function (x) { return x.mode === 'calm'; }), 'a phone held still in the hand (0.02 g, 0.2 rad/s, 2 rad/s^2 of tremor) stays calm');
  check(at(r2, 3200).mode === 'calm' && at(r2, 3700).mode === 'calm' && at(r2, 4100).mode === 'full' && at(r2, 4100).why === 'felt motion',
    'felt motion over 0.05 g counts once held 0.3 s (a 0.25 s jolt does not)');
  var r3 = seq([{ ms: 1000 }, { ms: 300, o: { felt: function (t) { return { a: 0, w: 0, alpha: 0, lean: (t - 1000) / 300 * 4 * Math.PI / 180 }; } } }, { ms: 200, o: { felt: { a: 0, w: 0, alpha: 0, lean: 4 * Math.PI / 180 } } }]);
  check(at(r3, 900).mode === 'calm' && at(r3, 1400).mode === 'full' && at(r3, 1400).why === 'lean', 'a lean of 3 degrees within 0.5 s asks for full');
  var r4 = seq([{ ms: 500 }, { ms: 1000, o: { atBase: false } }, { ms: 200 }]);
  check(at(r4, 400).mode === 'calm' && at(r4, 1000).mode === 'full' && at(r4, 1600).mode === 'calm', 'calm only while auto Hz is at the base rate, so a change of mode never changes the substep rate');
  var r5 = seq([{ ms: 1000, o: { active: false, still: true } }, { ms: 100, o: { active: false, still: true, busy: 'touched' } }, { ms: 2600, o: { active: false, still: true } }]);
  check(at(r5, 300).mode === 'calm' && at(r5, 900).mode === 'asleep' && at(r5, 1050).mode === 'full' && at(r5, 3000).mode === 'full' && at(r5, 3650).mode === 'asleep',
    'a still glass that is not running sleeps after 0.5 s; a touch wakes it to full, and it sleeps again 2.5 s after');
  // asleep, the phone moved: a lean of 5 degrees at once, a turn of 2 rad/s, a tilt of 0.5 degree a
  // second (design 9.1: more than 1 degree since it fell asleep, however slowly)
  var rest = { active: false, still: true };
  var leanTo = function (deg) { return { a: 0, w: 0, alpha: 0, lean: deg * Math.PI / 180 }; };
  var wakeAt = function (out, t0) { for (var i = 0; i < out.length; i++) if (out[i].t >= t0 && out[i].mode === 'full') return out[i].t - t0; return Infinity; };
  var w1 = seq([{ ms: 1000, o: rest }, { ms: 1000, o: Object.assign({ felt: leanTo(5) }, rest) }]);
  var w2 = seq([{ ms: 1000, o: rest }, { ms: 1000, o: Object.assign({ felt: { a: 0, w: 2, alpha: 0, lean: 0 } }, rest) }]);
  var w3 = seq([{ ms: 1000, o: rest }, { ms: 4000, o: Object.assign({ felt: function (t) { return leanTo(0.5 * (t - 1000) / 1000); } }, rest) }]);
  var wk = [wakeAt(w1, 1000), wakeAt(w2, 1000), wakeAt(w3, 1000)];
  check(at(w1, 990).mode === 'asleep' && wk[0] <= 500 && wk[1] <= 500 && wk[2] <= 2500 && at(w3, 1000 + wk[2]).why === 'lean since asleep',
    'asleep, the glass wakes to full when it is leaned 5 degrees (' + f0(wk[0]) + ' ms), turned at 2 rad/s (' + f0(wk[1]) + ' ms), or tilted slowly, at 0.5 degree a second, past 1 degree since it fell asleep (' + f0(wk[2]) + ' ms)');
  // asleep, a jolt (design 9.1 as of 2026-11): felt motion of 0.3 g wakes it at once, in its own
  // frame, held or not (a flick is over before 0.3 s), as does a jolt between two frames (peak);
  // the hand's jitter (0.25 g at 9 Hz) is no jolt
  var jolt = function (a, peak) { return { a: a, peak: peak, w: 0, alpha: 0, lean: 0 }; };
  var w4 = seq([{ ms: 1000, o: rest }, { ms: 1000 / 60, o: Object.assign({ felt: jolt(0.35, 0.35) }, rest) }, { ms: 500, o: rest }]);
  var w5 = seq([{ ms: 1000, o: rest }, { ms: 1000 / 60, o: Object.assign({ felt: jolt(0, 0.5) }, rest) }, { ms: 500, o: rest }]);
  var w6 = seq([{ ms: 1000, o: rest }, { ms: 2000, o: Object.assign({ felt: function (t) { return jolt(0.25 * Math.abs(Math.sin(TAU9 * t / 1000)), 0.25); } }, rest) }]);
  var w7 = seq([{ ms: 1000, o: rest }, { ms: 1000 / 60, o: Object.assign({ felt: jolt(0.25, 0.25) }, rest) }, { ms: 500, o: rest }]);
  var joltFrame = function (out) { for (var i = 1; i < out.length; i++) if (out[i].step === 1) return { before: out[i - 1], at: out[i] }; return null; };
  var j4 = joltFrame(w4), j5 = joltFrame(w5), j7 = joltFrame(w7);
  var inOwn = function (j) { return j.before.mode === 'asleep' && j.at.mode === 'full' && j.at.why === 'jolt'; };
  check(inOwn(j4) && inOwn(j5) && w6.every(function (x) { return x.why !== 'jolt'; }) && j7.before.mode === 'asleep' && w7.every(function (x) { return x.mode === 'asleep' || x.t < 900; }),
    'asleep, a jolt wakes the glass in its own frame: 0.35 g for one frame (' + j4.at.mode + ', ' + j4.at.why + '), or a peak of 0.5 g between two frames (' + j5.at.mode + ', ' + j5.at.why +
    '); 0.25 g for a frame does not (' + j7.at.mode + '), nor is the hand\'s jitter at 0.25 g a jolt');
  var r6 = seq([{ ms: 1000, o: { active: false, still: true, pending: true } }]);
  check(r6.every(function (x) { return x.mode !== 'asleep'; }), 'not asleep while a swap waits for its flip pass');
  var r7 = seq([{ ms: 19000, o: { busy: 'turning', ratio: 0.5 } }, { ms: 2000, o: { busy: 'turning', ratio: 0.5 } }, { ms: 1000 }]);
  check(at(r7, 18900).mode === 'full' && !at(r7, 18900).guard && at(r7, 20200).mode === 'calm' && at(r7, 20200).why === 'heat guard' && r7.m.guard && at(r7, 21500).mode === 'calm',
    'the heat guard: full under 0.6 of real time for 20 s drops to calm (not at 19 s), and stays calm');
  var r8 = seq([{ ms: 21000, o: { busy: 'turning', ratio: 0.5 } }], 'full');
  check(r8.every(function (x) { return x.mode === 'full'; }) && !r8.m.guard, 'the heat guard acts only in auto: a mode set by hand is kept');
  var r9 = seq([{ ms: 21000, o: { busy: 'turning', ratio: 0.7 } }]);
  check(!r9.m.guard, 'no heat guard at 0.7 of real time');
  // 20 s in a row: 5 s slow and full, 40 s calm, then slow and full again
  var r10 = seq([{ ms: 5000, o: { busy: 'turning', ratio: 0.5 } }, { ms: 40000, o: { ratio: 0.5 } }, { ms: 19500, o: { busy: 'turning', ratio: 0.5 } }, { ms: 1500, o: { busy: 'turning', ratio: 0.5 } }]);
  check(at(r10, 30000).mode === 'calm' && at(r10, 64400).mode === 'full' && r10.m.guard && Math.abs(r10.m.guardAt - 45000 - 20000) < 50,
    'the heat guard counts 20 s in a row: slow and full for 7 s, calm for 38 s, then slow and full again, it engages 20 s after the calm ends (at ' + f0(r10.m.guardAt / 1000) + ' s, not at once)');
  check(T.frameMsFor('calm', 1000 / 60) === 1000 / 30 && T.frameMsFor('calm', 1000 / 30) === 1000 / 30 && T.frameMsFor('full', 1000 / 60) === 1000 / 60,
    'calm draws 30 frames a second (every other frame of a 60 Hz display; every frame of a 30 Hz one)');

  /* ---- the burst ---- */
  var c = T.burstCost([10, 11, 9, 10.2], [46, 45.5, 47, 46.2], 24, 96);
  check(Math.abs(c - 0.5) < 0.01 && Math.abs(T.gpuShare(0.5, 480, 1, 60) - 0.30) < 1e-9, 'the burst: (median of 96 - median of 24) / 72 removes the fixed latency (0.5 ms a substep), and the share adds the frames\' drawing');

  log('lab-timer: ' + (failures ? failures + ' of ' + count + ' checks FAILED' : 'all ' + count + ' checks passed') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
