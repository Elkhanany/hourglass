/*
 * physics-core acceptance 5: fracture classes.
 *
 * Every profile runs on 3 seeds × 4 fills (the physicist's calibration
 * matrix: a 5-minute glass 20 s and 270 s into its run, a 1-minute glass at
 * 15 s, a 45-minute glass at 300 s), clock running, with damage armed as the
 * app arms it: by motion.js's own gate on the profile's acceleration (a
 * third of a second of RMS above 1.6 g, held for 0.6 s; lib/harness.js
 * armGate). Ordinary and even rough handling must never mark the glass
 * (dMax < 0.2); a vigorous shake, 3 g or more kept up, cracks it in about
 * three seconds:
 *
 *   firm60 (3 g at 5 Hz)                    crack in [1.5, 5] s
 *   vigorous60, veryVigorous, veryVigSlow,
 *   vigSlow60, lateralVV                    crack in [1.2, 4] s (vigSlow60: breached within 2 s after)
 *   lateralFirm (3.5 g sideways)            crack in [2, 8] s
 *
 * Every crack is preceded by at least three creaks (WARN) with rising
 * levels; cracks come one at a time (a crack relieves the rest of the glass,
 * so no two start within 2.5 s); every hole sits at least gateGuard rows
 * from the gate; and with damage disarmed, or with Reduce Motion, no profile
 * ever damages the glass at all. The census holds throughout.
 *
 * Changed with the crash work, and why. The user's complaint was that the
 * glass does not crack, and the diagnosis measured why: these classes asked
 * for 5.5 g at 5.5 Hz kept up for five to nine seconds, which a hand shaking
 * a phone does not do, while a vigorous shake (3 g at 3 to 5 Hz) landed the
 * bed at 90 % of the fatigue limit for ever. So:
 *  - the reference landing speed fell (vc 16 → 11), the rate cap rose (rMax
 *    0.30 → 0.9 /s, Pmax 0.15 → 0.45) and the waist bends from 2.6 g: the
 *    crack windows moved from [4.5, 10] s to [1.2, 5] s, and a crack is born
 *    16 cells long, so it breaches about 0.3 s later;
 *  - firm60 and lateralFirm (3 and 3.5 g) moved from "never" to "cracks":
 *    they are the vigorous shake the brief says must crack it;
 *  - vigorous60 and veryVigorous moved from "may, never before 4.5 s" to
 *    "cracks in [1.2, 4] s";
 *  - damage is armed by the app's real gate, not by fiat. With the lower
 *    fatigue limit the sim alone no longer tells a violent single jerk
 *    (hardJerks, 8 g for 33 ms) or a 2 g shake at 3 Hz from a vigorous shake;
 *    the gate does, as it does in the app, and the "never" class is now
 *    stricter for it (dMax < 0.2, no creak at all; it was < 0.4, with creaks
 *    allowed for firm60 and hardJerks).
 *
 *   node tools/test/sim-fracture.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');

var SEEDS = [11, 22, 33];
var NEVER = ['calm', 'sway', 'walking', 'running', 'normal', 'normalSlow',
  'knocks', 'hardJerks', 'drop', 'fingerWiggle', 'wristTwist', 'tableSpin'];
// name: [earliest crack, latest crack (s), breach within this many s after (−1: not asked)]
var CRACK = { firm60: [1.5, 5, -1], vigorous60: [1.2, 4, -1], veryVigorous: [1.2, 4, -1], vigSlow60: [1.2, 4, 2],
  veryVigSlow: [1.2, 4, -1], lateralVV: [1.2, 4, -1], lateralFirm: [2, 8, -1] };

function job(j) {
  var f = H.FILLS[j.fill];
  var run = H.glassAt({ durMs: f[0] * 60000, startMs: f[1] * 1000, seed: j.seed });
  var o = { armed: j.armed === false ? false : 'auto', reduced: !!j.reduced };
  if (j.crack) o.stopAfterBreach = 4.5;
  var r = H.drive(run, j.name, o);
  var CRACK_EV = H.P.Sim.DMG.CRACK, cracksAt = [];
  r.events.forEach(function (e) { if (e[1] === CRACK_EV) cracksAt.push(e[0]); });
  return {
    crackT: r.crackT, breachT: r.breachT, dMax: r.dMax, site: H.segName(r.dMaxSeg), segDmax: r.segDmax, cracksAt: cracksAt,
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
        if (r.cracks > 0 || r.dMax >= 0.2 || !common(r)) bad++;
      });
      report(bad === 0, name + ': ' + n + ' runs, no crack; worst dMax ' + worst.toFixed(3) + (at ? ' (' + at + ')' : '') +
        (bad ? '; ' + bad + ' runs failed (crack, dMax ≥ 0.2, census or valve)' : ''));
    });
    // crack windows
    var gapMin = Infinity, multi = 0, nCracks = 0, crowded = [];
    Object.keys(CRACK).forEach(function (name) {
      var w = CRACK[name], times = [], breaches = [], bad = [], n = 0;
      jobs.forEach(function (j, i) {
        if (j.name !== name || j.kind) return;
        var r = res[i], tag = 'seed ' + j.seed + ' ' + H.fillName(H.FILLS[j.fill]);
        n++;
        times.push(r.crackT);
        // one crack at a time: each relieves the rest of the glass for 2.5 s
        nCracks += r.cracksAt.length;
        if (r.cracksAt.length > 1) multi++;
        for (var c = 1; c < r.cracksAt.length; c++) {
          var gap = r.cracksAt[c] - r.cracksAt[c - 1];
          if (gap < gapMin) gapMin = gap;
          if (gap < 2.5 - 1e-6) crowded.push(name + ' ' + tag + ': cracks at ' + r.cracksAt.join(', ') + ' s');
        }
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
    report(crowded.length === 0 && multi > 0, 'one crack at a time: at most one CRACK per 2.5 s in every cracking run; ' + nCracks +
      ' cracks, ' + multi + ' runs with more than one, closest pair ' + (gapMin < Infinity ? gapMin.toFixed(2) + ' s apart' : '-') +
      (crowded.length ? '; ' + crowded.slice(0, 3).join('; ') : ''));
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
