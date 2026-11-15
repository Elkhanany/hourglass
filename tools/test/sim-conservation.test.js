/*
 * physics-core acceptance 2: every grain is accounted for.
 *
 * Every profile × seeds {11, 22, 33} × fills {a 1-minute glass early, a
 * 5-minute glass mid-run, a 45-minute glass}, clock running, damage armed
 * (so the cracking profiles also breach and leak), with 200 grains poured
 * in after one second. At every 30th step:
 *
 *   census().total === sim.total
 *   census().top === sim.nTop
 *   sim.total + sim.lost === initial + poured
 *
 * and the neck valve never releases past the clock's target (nTop stays
 * ≥ targetTop but for what leaks out of the upper bulb). A tumble, the
 * glass turned end over end every 600 steps while it is shaken hard enough
 * to crack and leak, keeps all of the above.
 *
 *   node tools/test/sim-conservation.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');

var SEEDS = [11, 22, 33];
var FILLS = [[1, 5], [5, 150], [45, 600]];

function job(j) {
  var f = FILLS[j.fill];
  var run = H.glassAt({ durMs: f[0] * 60000, startMs: f[1] * 1000, seed: j.seed });
  var below = 0;
  var o = {
    armed: true, census: 30, pourAt: 1, pourN: 200, retime: true,
    each: function (r) {
      // nTop below the target only by what leaked from the upper bulb
      if (r.sim.nTop < r.sim.targetTop && r.sim.leakedTop === 0) below++;
    }
  };
  if (j.tumble) { o.flipEvery = 600; o.dur = j.dur; }
  var r = H.drive(run, j.name, o);
  return {
    census: r.censusErr, checks: r.censusChecks, conserve: r.conserveErr, over: r.overRelease, below: below,
    lost: r.lost, poured: r.poured, cracks: r.cracksNow, steps: r.steps, leakedTop: r.leakedTop
  };
}

if (H.isWorker) {
  H.workerMain(job);
} else {
  var jobs = [];
  H.Profiles.names.forEach(function (name) {
    SEEDS.forEach(function (seed) {
      for (var fill = 0; fill < FILLS.length; fill++) jobs.push({ name: name, seed: seed, fill: fill });
    });
  });
  SEEDS.forEach(function (seed) { jobs.push({ name: 'vigSlow60', seed: seed, fill: 1, tumble: true, dur: 30 }); });
  SEEDS.forEach(function (seed) { jobs.push({ name: 'lateralVV', seed: seed, fill: 0, tumble: true, dur: 15 }); });
  var t0 = Date.now();
  console.log('conservation: ' + jobs.length + ' runs on ' + require('os').cpus().length + ' processes');
  H.pool(__filename, jobs, function (res) {
    var failures = 0, lines = [];
    var errors = res.filter(function (r) { return r && r.error; });
    if (errors.length) { console.log(errors[0].error); process.exit(1); }
    function bad(r) { return r.census !== 0 || r.conserve !== 0 || r.over !== 0 || r.below !== 0; }
    H.Profiles.names.concat(['tumble']).forEach(function (name) {
      var n = 0, checks = 0, fails = [], lost = 0, poured = 0, cracked = 0, steps = 0;
      jobs.forEach(function (j, i) {
        if (name === 'tumble' ? !j.tumble : (j.tumble || j.name !== name)) return;
        var r = res[i];
        n++; checks += r.checks; lost += r.lost; poured += r.poured; steps += r.steps;
        if (r.cracks) cracked++;
        if (bad(r)) {
          fails.push((j.tumble ? j.name + ' ' : '') + 'seed ' + j.seed + ' fill ' + j.fill + ': census ' + r.census +
            ', total+lost ' + r.conserve + ', over-release ' + r.over + ', below target ' + r.below);
        }
      });
      var ok = fails.length === 0;
      if (!ok) failures++;
      lines.push((ok ? 'PASS  ' : 'FAIL  ') + (name === 'tumble' ? 'tumble (flip every 600 steps under vigSlow60 / lateralVV)' : name) +
        ': ' + n + ' runs, ' + steps + ' steps, ' + checks + ' census checks exact' +
        (poured ? ', ' + poured + ' poured' : '') + (lost ? ', ' + lost + ' leaked out (' + cracked + ' cracked glasses)' : '') +
        (ok ? '' : '; ' + fails.slice(0, 3).join('; ')));
    });
    lines.forEach(function (l) { console.log(l); });
    console.log((failures ? 'conservation: ' + failures + ' case(s) FAILED' : 'conservation: all ' + lines.length + ' cases passed') +
      ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    process.exit(failures ? 1 : 0);
  });
}
