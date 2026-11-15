/*
 * physics-core acceptance 5: fracture classes.
 *
 * With damage armed, every profile runs on 3 seeds × 4 fills (the
 * physicist's calibration matrix: a 5-minute glass 20 s and 270 s into its
 * run, a 1-minute glass at 15 s, a 45-minute glass at 300 s), clock
 * running. Ordinary and even hard handling must never crack the glass
 * (dMax < 0.4); only big, fast swings kept up for about five seconds may:
 *
 *   vigSlow60    crack in [4.5, 9] s, breached within 4 s after it
 *   veryVigSlow  crack in [4.5, 10] s
 *   lateralVV    crack in [4.5, 8] s
 *
 * Every crack is preceded by at least three creaks (WARN) with rising
 * levels; every hole sits at least gateGuard rows from the gate; and with
 * damage disarmed, or with Reduce Motion, no profile ever damages the
 * glass at all. The census holds throughout.
 *
 *   node tools/test/sim-fracture.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');

var SEEDS = [11, 22, 33];
var NEVER = ['calm', 'sway', 'walking', 'running', 'normal', 'normalSlow', 'firm60', 'vigorous60', 'veryVigorous',
  'lateralFirm', 'knocks', 'hardJerks', 'drop', 'fingerWiggle', 'wristTwist', 'tableSpin'];
var CRACK = { vigSlow60: [4.5, 9, 4], veryVigSlow: [4.5, 10, -1], lateralVV: [4.5, 8, -1] };

function job(j) {
  var f = H.FILLS[j.fill];
  var run = H.glassAt({ durMs: f[0] * 60000, startMs: f[1] * 1000, seed: j.seed });
  var o = { armed: j.armed !== false, reduced: !!j.reduced };
  if (j.crack) o.stopAfterBreach = 4.5;
  var r = H.drive(run, j.name, o);
  return {
    crackT: r.crackT, breachT: r.breachT, dMax: r.dMax, site: H.segName(r.dMaxSeg), segDmax: r.segDmax,
    warns: r.warnsBeforeCrack, levels: r.warnLevelsBeforeCrack, holesNearGate: r.holesNearGate,
    census: r.censusErr, conserve: r.conserveErr, over: r.overRelease, cracks: r.cracksNow, lost: r.lost
  };
}

if (H.isWorker) {
  H.workerMain(job);
} else {
  var jobs = [];
  NEVER.concat(Object.keys(CRACK)).forEach(function (name) {
    SEEDS.forEach(function (seed) {
      for (var fill = 0; fill < H.FILLS.length; fill++) jobs.push({ name: name, seed: seed, fill: fill, crack: !!CRACK[name] });
    });
  });
  // disarmed, and Reduce Motion: no damage at all, under every profile (one glass each)
  H.Profiles.names.forEach(function (name) {
    jobs.push({ name: name, seed: 11, fill: 0, armed: false, kind: 'disarmed' });
    jobs.push({ name: name, seed: 11, fill: 0, reduced: true, kind: 'reduced' });
  });
  var t0 = Date.now();
  console.log('fracture: ' + jobs.length + ' runs on ' + require('os').cpus().length + ' processes');
  H.pool(__filename, jobs, function (res) {
    var failures = 0, lines = [];
    function report(ok, text) { if (!ok) failures++; lines.push((ok ? 'PASS  ' : 'FAIL  ') + text); }
    var errors = res.filter(function (r) { return r && r.error; });
    if (errors.length) { console.log(errors[0].error); process.exit(1); }
    var common = function (r) { return r.census === 0 && r.conserve === 0 && r.over === 0 && r.holesNearGate === 0; };
    // never crack
    NEVER.forEach(function (name) {
      var worst = 0, at = '', bad = 0, n = 0;
      jobs.forEach(function (j, i) {
        if (j.name !== name || j.kind) return;
        var r = res[i];
        n++;
        if (r.dMax > worst) { worst = r.dMax; at = 'seed ' + j.seed + ', ' + H.fillName(H.FILLS[j.fill]) + ', ' + r.site; }
        if (r.cracks > 0 || r.dMax >= 0.4 || !common(r)) bad++;
      });
      report(bad === 0, name + ': ' + n + ' runs, no crack; worst dMax ' + worst.toFixed(3) + (at ? ' (' + at + ')' : '') +
        (bad ? '; ' + bad + ' runs failed (crack, dMax ≥ 0.4, census or valve)' : ''));
    });
    // crack windows
    Object.keys(CRACK).forEach(function (name) {
      var w = CRACK[name], times = [], breaches = [], bad = [], n = 0;
      jobs.forEach(function (j, i) {
        if (j.name !== name || j.kind) return;
        var r = res[i], tag = 'seed ' + j.seed + ' ' + H.fillName(H.FILLS[j.fill]);
        n++;
        times.push(r.crackT);
        if (r.crackT < w[0] || r.crackT > w[1]) bad.push(tag + ': crack at ' + r.crackT.toFixed(2) + ' s');
        if (w[2] > 0) {
          breaches.push(r.breachT - r.crackT);
          if (r.breachT < 0 || r.breachT - r.crackT > w[2]) bad.push(tag + ': breach ' + (r.breachT < 0 ? 'never' : (r.breachT - r.crackT).toFixed(2) + ' s after'));
        }
        if (!(r.warns >= 3)) bad.push(tag + ': only ' + r.warns + ' creaks before the crack');
        else {
          for (var q = 1; q < r.levels.length; q++) if (r.levels[q] <= r.levels[q - 1]) { bad.push(tag + ': creak levels not rising ' + r.levels.join(',')); break; }
        }
        if (!common(r)) bad.push(tag + ': census ' + r.census + ', conserve ' + r.conserve + ', over-release ' + r.over + ', holes near gate ' + r.holesNearGate);
      });
      var lo = Math.min.apply(null, times), hi = Math.max.apply(null, times);
      report(bad.length === 0, name + ': ' + n + ' runs crack in ' + lo.toFixed(2) + '–' + hi.toFixed(2) + ' s (want ' + w[0] + '–' + w[1] + ')' +
        (breaches.length ? ', breach ' + Math.min.apply(null, breaches).toFixed(2) + '–' + Math.max.apply(null, breaches).toFixed(2) + ' s later' : '') +
        ', ≥ 3 rising creaks first' + (bad.length ? '; ' + bad.slice(0, 4).join('; ') : ''));
    });
    // disarmed / reduced
    ['disarmed', 'reduced'].forEach(function (kind) {
      var bad = [];
      jobs.forEach(function (j, i) {
        if (j.kind !== kind) return;
        var r = res[i];
        if (r.segDmax !== 0 || r.cracks || !common(r)) bad.push(j.name + ' (segD ' + r.segDmax + ', cracks ' + r.cracks + ')');
      });
      report(bad.length === 0, (kind === 'disarmed' ? 'damageArmed = false' : 'reduced = true') + ': segD stays 0 under all ' +
        H.Profiles.names.length + ' profiles' + (bad.length ? '; ' + bad.join(', ') : ''));
    });
    lines.forEach(function (l) { console.log(l); });
    console.log((failures ? 'fracture: ' + failures + ' case(s) FAILED' : 'fracture: all ' + lines.length + ' cases passed') +
      ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    process.exit(failures ? 1 : 0);
  });
}
