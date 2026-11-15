/*
 * physics-core acceptance 11: the clock stays exact under motion.
 *
 * The physicist's seven trials (clock_test.js), with the app's clock
 * (lib/clock.js), its valve settings, relCap while motion is recent and
 * the re-timing rule once calm:
 *
 *   calm 1-minute glass
 *   2-minute glass, vigorous shaking 20–50 s, without and with re-timing
 *   2-minute glass, normal shaking 20–50 s, re-timed
 *   2-minute glass, vigorous shaking in the last 20 s, re-timed
 *   2-minute glass, an upper-bulb breach at 30 s, with and without re-timing
 *
 * In each the last grain leaves the neck within one step of the clock
 * reaching 00:00.0, and no grain ever crosses the neck except through the
 * valve: the census of the upper bulb equals nTop after every step. After
 * the long vigorous shake the re-timed clock matches the sand again (the
 * other trials never fall far enough behind to need it: the valve pauses
 * for a breach's few grains, and relCap catches up with a normal shake).
 *
 *   node tools/test/sim-clock.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim, Clock = H.Clock, Pr = H.Profiles;
var DT = Sim.DT, DT_MS = Clock.DT_MS, BINS = 40;

function trial(o) {
  var sim = new Sim({ scale: 1.08, seed: 5150 });
  var dur = o.durS * 1000;
  sim.reset(Clock.grainsFor(sim, dur));
  for (var i = 0; i < 300; i++) { sim.beginFrame(); sim.step(); }
  var T = new Clock(sim, dur);
  T.start();
  var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {};
  var lastMotion = -1e9, endStep = -1, lastLeave = -1, emptyAt = -1, crossings = 0, maxStall = 0, stall = 0;
  var lagAfter = 0, total0 = sim.total, steps = Math.round((o.durS + 3) / DT), cr = null;
  for (var k = 0; k < steps; k++) {
    var t = k * DT, now = k * DT_MS;
    var shaking = o.shake && t >= o.shake[0] && t < o.shake[1];
    f.x = f.y = f.z = f.w = f.al = 0;
    if (shaking) { f.y = Pr.human(o.shake[2], o.shake[3], t, 3); f.x = 0.6 * Pr.human(1, o.shake[3], t, 4); }
    H.felt(sim, f, inp);
    sim.setMotion(inp.ax, inp.ay, inp.w, inp.al, H.LAM, inp.gz);
    if (o.leakAt && k === Math.round(o.leakAt / DT)) {
      // a breach in the upper funnel wall, 40 rows above the neck, two cells wide
      var u = 40 / sim.geo.HB;
      cr = sim.forceCrack(Math.floor(u * BINS), 40, 2);
    }
    if (T.tick(DT_MS, false)) endStep = k;
    var running = T.apply(now, false, true);
    var calmS = (k - lastMotion) * DT;
    sim.relCap = T.relCap(calmS < 2);
    if (o.retime) T.maybeRetime(calmS, now);
    if ((k & 1) === 0) sim.beginFrame();
    var top0 = sim.nTop, rel0 = sim.frame.released, lt0 = sim.leakedTop;
    sim.step();
    if (sim.motionActive()) lastMotion = k;
    var rel = sim.frame.released - rel0;
    // every grain that left the upper bulb went through the valve or out of a breach
    var c = sim.census();
    if (c.top !== sim.nTop || c.total !== sim.total || top0 - sim.nTop !== rel + (sim.leakedTop - lt0)) crossings++;
    if (rel > 0) {
      lastLeave = k;
      if (stall > maxStall && t > 1 && T.rem > T.tailMs) maxStall = stall;
      stall = 0;
    } else stall += DT;
    if (emptyAt < 0 && sim.nTop === 0) emptyAt = t;
    if (o.shake && t > o.shake[1] + 3 && T.rem > T.tailMs) lagAfter = Math.max(lagAfter, Math.abs(sim.nTop - T.topAt(T.rem)));
    if (running === false && T.state === 'done' && sim.nTop === 0 && k > endStep + 240) break;
  }
  return {
    endStep: endStep, lastLeave: lastLeave, delta: lastLeave - endStep, emptyAt: emptyAt, crossings: crossings,
    retimes: T.retimes, maxStall: maxStall, lagAfter: lagAfter, lost: sim.lost, leakedTop: sim.leakedTop,
    conserve: sim.total + sim.lost - total0, cracked: !!cr
  };
}

var TRIALS = [
  { durS: 60, label: 'calm 1-min glass' },
  { durS: 120, shake: [20, 50, 4.0, 5.5], label: '2-min, vigorous 20–50 s, no re-time' },
  { durS: 120, shake: [20, 50, 4.0, 5.5], retime: true, mustRetime: true, label: '2-min, vigorous 20–50 s, re-time' },
  { durS: 120, shake: [20, 50, 2.0, 4.5], retime: true, label: '2-min, normal 20–50 s, re-time' },
  { durS: 120, shake: [100, 116, 4.0, 5.5], retime: true, label: '2-min, vigorous in the last 20 s, re-time' },
  { durS: 120, leakAt: 30, retime: true, label: '2-min, upper-bulb breach at 30 s, re-time' },
  { durS: 120, leakAt: 30, label: '2-min, upper-bulb breach at 30 s, no re-time' }
];

if (H.isWorker) {
  H.workerMain(function (j) { return trial(TRIALS[j]); });
} else {
  var t0 = Date.now();
  H.pool(__filename, TRIALS.map(function (x, i) { return i; }), function (res) {
    var failures = 0;
    res.forEach(function (r, i) {
      if (r.error) { console.log('FAIL  ' + TRIALS[i].label + ': ' + r.error); failures++; return; }
      var tr = TRIALS[i];
      var good = r.endStep >= 0 && Math.abs(r.delta) <= 1 && r.crossings === 0 && r.conserve === 0 && (!tr.leakAt || r.leakedTop > 0);
      // 30 s of vigorous shaking leaves thousands of grains of lag: once calm the
      // rest of the run is re-timed and the sand matches the clock again
      if (tr.mustRetime) good = good && r.retimes >= 1 && r.lagAfter <= 3;
      if (!good) failures++;
      console.log((good ? 'PASS  ' : 'FAIL  ') + tr.label + ': last grain left ' + (r.delta * DT_MS).toFixed(1) + ' ms (' + r.delta +
        ' steps) after 00:00.0' + '; top empty at ' + r.emptyAt.toFixed(2) + ' s; retimes ' + r.retimes +
        (tr.shake ? '; |lag| 3 s after the shake ≤ ' + r.lagAfter.toFixed(1) : '') +
        '; longest stall ' + r.maxStall.toFixed(2) + ' s' + (tr.leakAt ? '; leaked from the top ' + r.leakedTop : '') +
        '; neck crossings ' + r.crossings);
    });
    console.log((failures ? 'clock: ' + failures + ' of ' + TRIALS.length + ' trials FAILED' : 'clock: all ' + TRIALS.length + ' trials passed') +
      ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    process.exit(failures ? 1 : 0);
  });
}
