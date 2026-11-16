#!/usr/bin/env node
/*
 * Knocking on the glass (Sim.prototype.knock), at the strengths the app
 * gives a burst of quick taps: 0.6, 0.8, 1.0, then 1.2 each.
 *
 * Ordinary taps never mark it. Single, double and triple taps stay harmless,
 * however often they are repeated. A burst of quick knocks creaks from about
 * the fifth and cracks on the eighth, on the side it is struck, also when the
 * knocks scatter by a bin either way as a real finger's do; a knock near the
 * axis loads both sides. Mended gold holds.
 *
 * Changed with the crash work, and why:
 *  - A burst used to need 2 to 10 s of knocking on one exact lattice point
 *    (every 0.25 s for 12 s) to crack the glass, which no real finger did:
 *    scattered over the 6.4 px bands of the wall, 30 to 120 taps were needed
 *    or it never cracked. A blow now covers the stretches within 3 bins and
 *    its damage is written at once, so the class is "the eighth knock".
 *  - With Reduce Motion knocking used to be ignored. The finger's own blows
 *    now always count (only the flashes are left out), so that case asks for
 *    the same crack.
 *
 *   node tools/test/sim-knock.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var DT = 1 / 120, failures = 0, DMG = H.P.Sim.DMG;
function report(ok, text) { if (!ok) failures++; console.log((ok ? 'PASS  ' : 'FAIL  ') + text); }
function strength(run) { return 0.6 + 0.2 * Math.min(run, 3); }                // app.js knock()

/**
 * Knock n times, `gap` s apart, in bursts of `burst` (0: one unbroken burst)
 * `pause` s apart. o.side: −1 left, +1 right; o.mid: on the axis; o.scatter:
 * rows the knocks wander by; o.reduced: Reduce Motion.
 */
function knocking(seed, n, gap, o) {
  o = o || {};
  var run = H.glassAt({ durMs: 5 * 60000, startMs: 60000, seed: seed });
  var sim = run.sim, t = 0, next = 0, k = 0, inBurst = 0, warns = 0, crackAt = -1, crackKnock = -1, crackSide = 0, firstWarnKnock = -1;
  sim.reduced = !!o.reduced;
  var g = sim.geo, x = o.mid ? g.cx + 1 : g.cx + (o.side || 1) * g.R * 0.7, y0 = sim.gateY - g.HB * 0.5;
  var wander = [0, 4, -5, 2, -3, 6, -6, 1, 5, -2, 3, -4];                       // rows: about a bin either way
  var end = 60;
  while (t < end) {
    sim.beginFrame();
    if (k < n && t >= next) {
      sim.knock(x + (o.scatter ? wander[(k * 5) % 12] : 0), y0 + (o.scatter ? wander[k % 12] * o.scatter : 0), strength(inBurst));
      k++; inBurst++;
      if (o.burst && inBurst === o.burst) { inBurst = 0; next += o.pause; } else next += gap;
      if (k === n) end = t + 1;
    }
    sim.step(); t += DT;
    for (var e = 0; e < sim.frame.dmgN; e++) {
      if (sim.frame.dmgType[e] === DMG.WARN && crackAt < 0) { warns++; if (firstWarnKnock < 0) firstWarnKnock = k; }
      if (sim.frame.dmgType[e] === DMG.CRACK && crackAt < 0) { crackAt = t; crackKnock = k; crackSide = sim.cracks[0].side; }
    }
  }
  var dL = 0, dR = 0;
  for (var s = 0; s < sim.segD.length; s++) {
    if ((Math.floor(s / 40) & 1) === 0) { if (sim.segD[s] > dL) dL = sim.segD[s]; } else if (sim.segD[s] > dR) dR = sim.segD[s];
  }
  return { crackAt: crackAt, crackKnock: crackKnock, warns: warns, firstWarnKnock: firstWarnKnock, side: crackSide, dMax: sim.dMax, dL: dL, dR: dR,
           cracks: sim.cracks.length, sim: sim };
}

[11, 22, 33].forEach(function (seed) {
  var r = knocking(seed, 12, 1.0, { burst: 1, pause: 1.0 });
  report(r.cracks === 0 && r.dMax === 0, 'seed ' + seed + ': ordinary taps once a second never mark it (dMax ' + r.dMax.toFixed(3) + ')');

  r = knocking(seed, 18, 0.2, { burst: 3, pause: 1.5 });
  report(r.cracks === 0 && r.dMax < 0.2 && r.warns === 0, 'seed ' + seed + ': six triple taps, 1.5 s apart, stay harmless (dMax ' + r.dMax.toFixed(3) + ' < 0.2, no creak)');
  r = knocking(seed, 16, 0.2, { burst: 2, pause: 1.0 });
  report(r.cracks === 0 && r.dMax === 0, 'seed ' + seed + ': double taps never mark it (dMax ' + r.dMax.toFixed(3) + ')');

  r = knocking(seed, 8, 0.2, { side: 1 });
  report(r.crackKnock === 8 && r.warns >= 2 && r.firstWarnKnock >= 4 && r.firstWarnKnock <= 6 && r.side === 1,
    'seed ' + seed + ': eight quick knocks crack it on the eighth (knock ' + r.crackKnock + ', ' + r.crackAt.toFixed(2) + ' s), creaking from the ' +
    r.firstWarnKnock + 'th (' + r.warns + ' creaks), on the struck side (' + r.side + ')');
  r = knocking(seed, 7, 0.2, { side: 1 });
  report(r.cracks === 0 && r.dMax > 0.6, 'seed ' + seed + ': seven are not enough (dMax ' + r.dMax.toFixed(2) + ')');

  r = knocking(seed, 9, 0.2, { side: -1, scatter: 1 });
  report(r.crackKnock >= 8 && r.crackKnock <= 9 && r.side === -1,
    'seed ' + seed + ': scattered by a bin either way they still crack it, on knock ' + r.crackKnock + ' (side ' + r.side + ')');

  r = knocking(seed, 6, 0.2, { mid: true });
  report(r.dL > 0.4 && r.dR > 0.4, 'seed ' + seed + ': a knock by the axis loads both sides (after six: left ' + r.dL.toFixed(2) + ', right ' + r.dR.toFixed(2) + ')');
  r = knocking(seed, 6, 0.2, { side: 1 });
  report(r.dR > 0.4 && r.dL === 0, 'seed ' + seed + ': one out on the right loads the right only (left ' + r.dL.toFixed(2) + ', right ' + r.dR.toFixed(2) + ')');

  r = knocking(seed, 8, 0.2, { side: -1, reduced: true });
  report(r.crackKnock === 8 && r.side === -1, 'seed ' + seed + ': with Reduce Motion the knocks count just the same (crack on knock ' + r.crackKnock + ')');

  // mended gold holds: seal the crack, knock on
  r = knocking(seed, 8, 0.2, { side: 1 });
  var sim = r.sim, seg = sim.cracks[0].seg, L = sim.cracks[0].L;
  sim.sealCracks();
  for (var k = 0; k < 6; k++) { sim.knock(sim.geo.cx + sim.geo.R * 0.7, sim.gateY - sim.geo.HB * 0.5, 1.2); for (var i = 0; i < 24; i++) { sim.beginFrame(); sim.step(); } }
  report(sim.cracks[0].L === L && sim.cracks[0].sealed && sim.segD[seg] === 0, 'seed ' + seed + ': a mended crack takes no more (L ' + sim.cracks[0].L.toFixed(1) + ')');
});
console.log(failures ? 'knock: ' + failures + ' case(s) FAILED' : 'knock: all cases passed');
process.exit(failures ? 1 : 0);
