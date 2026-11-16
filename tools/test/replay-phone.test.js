#!/usr/bin/env node
/*
 * Shaking the phone, as a hand shakes one: realistic iPhone sensor streams
 * (lib/replay-streams.js, 60 readings a second in WebKit's signs) through
 * the real motion.js, the app's frame logic and the real Sim, on a virtual
 * clock (lib/replay-offline.js). No browser.
 *
 * MUST. A vigorous shake, 3 g at 4.5 Hz, chips the glass within 4 s whichever
 * way the phone is shaken: along its long axis, sideways, toward and away
 * from the face, and from the wrist. At 3 and at 5 Hz it cracks it within
 * 5 s. Every glass creaks before it cracks.
 *
 * NEVER. Walking, running, setting the phone down flat or on its edge (one
 * spike of 3 to 12 g, at every sampling phase), tapping it on a palm (3 to
 * 8 g, 2.5 a second for 30 s), a soft drop, a firm shake (1.5 g at 3 Hz,
 * either way) and gentle handling leave the damage at exactly 0. So does
 * the hardest shake with Reduce Motion on.
 *
 * Each stream runs on 3 glasses x 2 fills (the never streams) or 3 x 4
 * (the must streams): a 5-minute glass never started, and 20 s, 150 s and
 * 270 s into its run.
 *
 *   node tools/test/replay-phone.test.js        exits 0 when every case passes
 */
'use strict';
var O = require('./lib/replay-offline.js');
var H = O.H;

var SEEDS = [11, 22, 33];
var FILLS = [{ idle: true }, { startMs: 20000 }, { startMs: 150000 }, { startMs: 270000 }];
// [stream, what it is, the latest first chip (s; 0: a crack is enough), the latest first crack (s)]
var MUST = [
  ['vigorousY', '3 g at 4.5 Hz along the long axis', 4, 4],
  ['vigorousX', '3 g at 4.5 Hz sideways', 4, 4],
  ['vigorousZ', '3 g at 4.5 Hz toward and away from the face', 4, 4],
  ['vigorousWrist', '3 g at 4.5 Hz from the wrist', 4, 4],
  [{ G: 3, f: 3, axis: 'y', dur: 10 }, '3 g at 3 Hz along the long axis', 0, 5],
  [{ G: 3, f: 3, axis: 'z', dur: 10 }, '3 g at 3 Hz toward and away from the face', 0, 5],
  [{ G: 3, f: 5, axis: 'x', dur: 10 }, '3 g at 5 Hz sideways', 0, 5],
  [{ G: 3, f: 5, axis: 'z', dur: 10 }, '3 g at 5 Hz toward and away from the face', 0, 5],
  ['hardestZ', '5.5 g at 5.5 Hz toward and away from the face', 4, 4]
];
var NEVER = [['gentle', 'gentle handling'], ['walking', 'walking, the phone in a swinging hand'], ['running', 'running with it in the hand'],
  ['dropSoft', 'a soft drop (0.25 s of free fall, a 4 g stop)'], ['firmY', 'a firm shake, 1.5 g at 3 Hz, long axis'], ['firmX', 'a firm shake, 1.5 g at 3 Hz, sideways'],
  [{ G: 1.5, f: 3, axis: 'z', dur: 12 }, 'a firm shake, 1.5 g at 3 Hz, toward the face']];

function job(j) {
  var r = O.run(j.name, j.opts);
  return { firstCreak: r.firstCreak, firstCrack: r.firstCrack, firstBreach: r.firstBreach, dMax: r.dMax, segDmax: r.segDmax, cracks: r.cracks, armedAt: r.armedAt,
           peakRms: r.peakRms, inPeak: r.inPeak, swings: r.swings, blows: r.blows, landRatio: r.peakLandV / r.vTh };
}
function span(a, digits) {
  var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a), d = digits === undefined ? 1 : digits;
  return lo.toFixed(d) === hi.toFixed(d) ? lo.toFixed(d) : lo.toFixed(d) + '–' + hi.toFixed(d);
}

if (H.isWorker) H.workerMain(job);
else {
  var jobs = [], groups = [];
  function add(kind, name, label, fills, opts, lim) {
    var g = { kind: kind, label: label, idx: [], lim: lim };
    SEEDS.forEach(function (seed) {
      fills.forEach(function (f) {
        g.idx.push(jobs.length);
        jobs.push({ name: name, opts: Object.assign({ seed: seed, startMs: f.startMs, idle: f.idle }, opts || {}) });
      });
    });
    groups.push(g);
  }
  MUST.forEach(function (m) { add('must', m[0], m[1], FILLS, null, [m[2], m[3]]); });
  NEVER.forEach(function (n) { add('never', n[0], n[1], [FILLS[0], FILLS[2]]); });
  // a spike sampled 60 times a second lands anywhere in a reading: every phase, on one glass
  ['setDownFlat', 'setDownEdge'].forEach(function (name) {
    var g = { kind: 'never', label: (name === 'setDownFlat' ? 'set down flat' : 'set down on its edge') + ': one spike of 3 to 12 g, 10 or 20 ms, at 6 sampling phases', idx: [] };
    [3, 6, 8, 12].forEach(function (peak) {
      [0.010, 0.020].forEach(function (width) {
        for (var ph = 0; ph < 6; ph++) {
          g.idx.push(jobs.length);
          jobs.push({ name: name, opts: { seed: 11, startMs: 60000, stream: { peak: peak, width: width, phase: ph * 0.0028 } } });
        }
      });
    });
    groups.push(g);
  });
  ['palmTap', 'palmTapFlat'].forEach(function (name) {
    var g = { kind: 'never', label: (name === 'palmTap' ? 'tapped on a palm, edge first' : 'tapped on a palm, flat') + ': 3, 5 and 8 g, 2.5 a second for 30 s', idx: [] };
    [3, 5, 8].forEach(function (peak) {
      SEEDS.forEach(function (seed) {
        g.idx.push(jobs.length);
        jobs.push({ name: name, opts: { seed: seed, startMs: 60000, dur: 30, stream: { peak: peak } } });
      });
    });
    groups.push(g);
  });
  add('never', 'hardestY', 'the hardest shake (5.5 g at 5.5 Hz) with Reduce Motion', [FILLS[1]], { reduced: true });

  var t0 = Date.now(), failures = 0;
  console.log('replay-phone: ' + jobs.length + ' runs of the real motion.js and Sim on ' + require('os').cpus().length + ' processes');
  H.pool(__filename, jobs, function (res) {
    var errors = res.filter(function (r) { return r && r.error; });
    if (errors.length) { console.log(errors[0].error); process.exit(1); }
    groups.forEach(function (g) {
      var rs = g.idx.map(function (i) { return res[i]; }), ok, text;
      var rms = Math.max.apply(null, rs.map(function (r) { return r.peakRms; })), sw = Math.max.apply(null, rs.map(function (r) { return r.swings; }));
      if (g.kind === 'must') {
        var cr = rs.map(function (r) { return r.firstCrack === null ? Infinity : r.firstCrack; });
        var br = rs.map(function (r) { return r.firstBreach === null ? Infinity : r.firstBreach; });
        var ck = rs.map(function (r) { return r.firstCreak === null ? Infinity : r.firstCreak; });
        var early = rs.filter(function (r) { return !(r.firstCreak !== null && r.firstCrack !== null && r.firstCreak < r.firstCrack); }).length;
        ok = Math.max.apply(null, cr) <= g.lim[1] && (g.lim[0] === 0 || Math.max.apply(null, br) <= g.lim[0]) && early === 0;
        text = 'MUST  ' + g.label + ': ' + rs.length + ' glasses creak at ' + span(ck) + ' s, crack at ' + span(cr) + ' s (≤ ' + g.lim[1] + ')' +
          (g.lim[0] ? ', chip at ' + span(br) + ' s (≤ ' + g.lim[0] + ')' : (isFinite(Math.max.apply(null, br)) ? ', chip at ' + span(br) + ' s' : '')) +
          '; armed at ' + span(rs.map(function (r) { return r.armedAt === null ? Infinity : r.armedAt; })) + ' s, RMS ' + rms.toFixed(2) + ' g, ' + sw + ' swings in a row' +
          (early ? '; ' + early + ' cracked without a creak first' : '');
      } else {
        var worst = Math.max.apply(null, rs.map(function (r) { return r.segDmax; })), cracks = rs.filter(function (r) { return r.cracks > 0; }).length;
        var armed = rs.filter(function (r) { return r.armedAt !== null; }).length;
        ok = worst === 0 && cracks === 0;
        text = 'NEVER ' + g.label + ': ' + rs.length + ' runs, damage ' + (worst === 0 ? '0' : worst.toFixed(3)) + ', ' + cracks + ' cracked; peak ' +
          Math.max.apply(null, rs.map(function (r) { return r.inPeak; })).toFixed(1) + ' g, RMS ' + rms.toFixed(2) + ' g (arms at 1.6), armed in ' + armed +
          ', at most ' + sw + ' swings in a row (8 count), beds landing at ' + (100 * Math.max.apply(null, rs.map(function (r) { return r.landRatio; }))).toFixed(0) + ' % of the fatigue limit';
      }
      if (!ok) failures++;
      console.log((ok ? 'PASS  ' : 'FAIL  ') + text);
    });
    console.log((failures ? 'replay-phone: ' + failures + ' case(s) FAILED' : 'replay-phone: all ' + groups.length + ' cases passed') +
      ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    process.exit(failures ? 1 : 0);
  });
}
