#!/usr/bin/env node
/*
 * Knocking on the glass. Ordinary taps never mark it; a quick burst of hard
 * knocks creaks, then cracks it on the side it is struck; Reduce Motion
 * leaves it unbreakable.
 *
 *   node tools/test/sim-knock.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var DT = 1 / 120, failures = 0, DMG = H.P.Sim.DMG;
function report(ok, text) { if (!ok) failures++; console.log((ok ? 'PASS  ' : 'FAIL  ') + text); }

// tap every `gap` s for `secs` s at the app's burst strengths; x on the left or right wall
function tapping(seed, gap, secs, burst, side, reduced) {
  var run = H.glassAt({ durMs: 5 * 60000, startMs: 60000, seed: seed });
  var sim = run.sim || run, t = 0, next = 0, n = 0, warns = 0, crackAt = -1, crackSide = 0;
  sim.reduced = !!reduced;
  var x = side < 0 ? sim.geo.cx - sim.geo.R * 0.7 : sim.geo.cx + sim.geo.R * 0.7, y = sim.gateY - sim.geo.HB * 0.5;
  while (t < secs) {
    if (t >= next) { sim.knock(x, y, burst ? 0.55 + 0.17 * Math.min(n, 4) : 0.55); n++; next += gap; }
    sim.beginFrame(); sim.step(); t += DT;
    for (var e = 0; e < sim.frame.dmgN; e++) {
      if (sim.frame.dmgType[e] === DMG.WARN && crackAt < 0) warns++;
      if (sim.frame.dmgType[e] === DMG.CRACK && crackAt < 0) { crackAt = t; crackSide = sim.cracks[0].side; }
    }
  }
  return { crackAt: crackAt, warns: warns, side: crackSide, dMax: sim.dMax, knocks: n };
}

[11, 22, 33].forEach(function (seed) {
  var r = tapping(seed, 1.0, 12, false, 1);
  report(r.crackAt < 0 && r.dMax === 0, 'seed ' + seed + ': ordinary taps once a second never mark it (dMax ' + r.dMax.toFixed(3) + ')');
  r = tapping(seed, 0.25, 12, true, 1);
  report(r.crackAt >= 2 && r.crackAt <= 10 && r.warns >= 3 && r.side === 1,
    'seed ' + seed + ': a burst of hard knocks (4/s) cracks it at ' + r.crackAt.toFixed(1) + ' s after ' + r.warns + ' creaks, on the struck side (' + r.side + ')');
  r = tapping(seed, 0.25, 12, true, -1, true);
  report(r.crackAt < 0 && r.dMax === 0, 'seed ' + seed + ': with Reduce Motion knocking never marks it');
});
console.log(failures ? 'knock: ' + failures + ' case(s) FAILED' : 'knock: all cases passed');
process.exit(failures ? 1 : 0);
