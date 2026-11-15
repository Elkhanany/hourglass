#!/usr/bin/env node
/*
 * Spinning the glass hard loads its domes (centrifugal ω²r). A handful of
 * hard flicks in a row cracks it; a few flicks, slower spins and the Flip
 * button's turn never do.
 *
 *   node tools/test/sim-spin.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var DT = 1 / 120, failures = 0;

function flicks(lam, w0, gap, n, seed) {
  var run = H.glassAt({ durMs: 5 * 60000, startMs: 60000, seed: seed });
  var sim = run.sim || run, t = 0;
  sim.spinArmed = true;                                // spun by hand, as the app arms it
  for (var k = 1; k <= n; k++) {
    var w = w0;
    while (w > 2.2) {                                   // the app's free-spin law
      w += (-w / 1.6 - 1.5) * DT;
      sim.setMotion(0, 0, w, 0, lam, 0); sim.step(); t += DT;
      if (sim.cracks.length) return { flicks: k, t: t, dMax: 1 };
    }
    for (var i = 0; i < gap * 120; i++) { sim.setMotion(0, 0, 0, 0, lam, 0); sim.step(); t += DT; }
  }
  return { flicks: -1, t: t, dMax: sim.dMax };
}
function report(ok, text) { if (!ok) failures++; console.log((ok ? 'PASS  ' : 'FAIL  ') + text); }

[11, 22, 33].forEach(function (seed) {
  var r = flicks(0.062, 16, 1, 9, seed);
  report(r.flicks >= 3 && r.flicks <= 8, 'seed ' + seed + ': hard flicks back to back crack it after ' + r.flicks + ' (want 3–8)');
  r = flicks(0.062, 16, 1, 2, seed);
  report(r.flicks < 0 && r.dMax < 0.6, 'seed ' + seed + ': two hard flicks never crack it (dMax ' + r.dMax.toFixed(2) + ')');
  r = flicks(0.062, 2.2, 0.5, 10, seed);
  report(r.flicks < 0 && r.dMax === 0, 'seed ' + seed + ': turns at the Flip\'s pace never load it (dMax ' + r.dMax.toFixed(3) + ')');
});
console.log(failures ? 'spin: ' + failures + ' case(s) FAILED' : 'spin: all cases passed');
process.exit(failures ? 1 : 0);
