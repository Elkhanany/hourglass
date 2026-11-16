#!/usr/bin/env node
/*
 * Spinning the glass by hand loads its domes (centrifugal ω²r, at the size
 * the glass has on screen: λ = 0.037 while it spins, drawn back to fit).
 * Each flick leaves one dose of damage at let-go, by the most it pressed the
 * sand on the domes (Sim.prototype.flick: nothing under 0.22 g, 0.4 from
 * 0.40 g), and a spin that stays hard keeps loading them (the continuous
 * term of the damage step). So three hard flicks in a row crack it, casual
 * flicks and the Flip's pace never mark it, and stirring hard cracks it in a
 * few seconds.
 *
 * Changed with the crash work, and why. This suite used to flick the glass
 * to 16 rad/s every time, back to back, and ask for a crack after 3 to 8
 * flicks. A real thumb leaves the glass at 8 to 13 rad/s, which stayed above
 * the load threshold for a quarter of a second: twelve hard flicks left the
 * damage at 0.2 to 0.66 and the glass never cracked. The flicks here are a
 * real hand's (7.5 casual, 11 brisk, 14 rad/s hard), the dose at let-go is
 * new, a flaw counts for at most twice the steady load (it was the 16th
 * power of the flaw, up to ×35), and Reduce Motion no longer disarms what a
 * hand does to the glass.
 *
 *   node tools/test/sim-spin.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var DT = 1 / 120, failures = 0, DMG = H.P.Sim.DMG;
var LAM = 0.037;                                       // the glass while it spins on an iPhone (app.js lamNow)

function domeG(sim, w) { return LAM * w * w * sim.geo.HB / sim.G; }
/** n flicks to w0 rad/s, one every `period` s (flick on flick: the next comes while it still spins), as app.js spins the glass on. */
function flicks(w0, period, n, seed, reduced) {
  var run = H.glassAt({ durMs: 5 * 60000, startMs: 60000, seed: seed });
  var sim = run.sim, t = 0, warns = 0, doses = [];
  sim.spinArmed = true;                                // spun by hand, as the app arms it
  sim.reduced = !!reduced;
  function step(w) {
    sim.beginFrame();
    sim.setMotion(0, 0, w, 0, LAM, 0); sim.step(); t += DT;
    for (var e = 0; e < sim.frame.dmgN; e++) if (sim.frame.dmgType[e] === DMG.WARN) warns++;
  }
  for (var k = 1; k <= n; k++) {
    sim.beginFrame();
    doses.push(sim.flick(domeG(sim, w0)));             // let go: the flick's dose
    for (var e = 0; e < sim.frame.dmgN; e++) if (sim.frame.dmgType[e] === DMG.WARN) warns++;
    if (sim.cracks.length) return { flicks: k, t: t, dMax: 1, warns: warns, dose: doses[0] };
    var w = w0;
    for (var i = 0; i < period * 120; i++) {
      if (w > 2.2) w += (-w / 1.6 - 1.5) * DT; else w = 0;   // the app's free-spin law, then it settles
      step(w);
      if (sim.cracks.length) return { flicks: k, t: t, dMax: 1, warns: warns, dose: doses[0] };
    }
  }
  return { flicks: -1, t: t, dMax: sim.dMax, warns: warns, dose: doses[0] };
}
/** A spin held at w rad/s for up to secs (stirring): when it creaks and cracks. */
function stir(w, secs, seed) {
  var run = H.glassAt({ durMs: 5 * 60000, startMs: 60000, seed: seed });
  var sim = run.sim, t = 0, warnAt = -1, warns = 0;
  sim.spinArmed = true;
  while (t < secs) {
    sim.beginFrame();
    sim.setMotion(0, 0, w, 0, LAM, 0); sim.step(); t += DT;
    for (var e = 0; e < sim.frame.dmgN; e++) if (sim.frame.dmgType[e] === DMG.WARN) { warns++; if (warnAt < 0) warnAt = t; }
    if (sim.cracks.length) return { crackAt: t, warnAt: warnAt, warns: warns, dMax: 1, dome: sim.cracks[0].u };
  }
  return { crackAt: -1, warnAt: warnAt, warns: warns, dMax: sim.dMax, dome: 0 };
}
function report(ok, text) { if (!ok) failures++; console.log((ok ? 'PASS  ' : 'FAIL  ') + text); }

[11, 22, 33].forEach(function (seed) {
  var r = flicks(7.5, 0.9, 10, seed);
  report(r.flicks < 0 && r.dMax === 0 && r.dose === 0, 'seed ' + seed + ': ten casual flicks (7.5 rad/s, 0.14 g at the dome) never mark it (dMax ' + r.dMax.toFixed(3) + ')');
  r = flicks(2.2, 0.9, 10, seed);
  report(r.flicks < 0 && r.dMax === 0, 'seed ' + seed + ': turns at the Flip\'s pace never load it (dMax ' + r.dMax.toFixed(3) + ')');
  r = flicks(14, 0.9, 4, seed);
  report(r.flicks === 3 && r.warns >= 1, 'seed ' + seed + ': three hard flicks (14 rad/s, 0.49 g, a dose of ' + r.dose.toFixed(2) + ' each) crack it on the third (flick ' + r.flicks + ', ' + r.warns + ' creaks first)');
  r = flicks(14, 0.9, 2, seed);
  report(r.flicks < 0 && r.dMax >= 0.6 && r.dMax < 1, 'seed ' + seed + ': two hard flicks do not (dMax ' + r.dMax.toFixed(2) + ')');
  r = flicks(11, 0.9, 12, seed);
  report(r.flicks >= 5 && r.flicks <= 9, 'seed ' + seed + ': brisk flicks (11 rad/s, a dose of ' + r.dose.toFixed(2) + ' each), one every 0.9 s, crack it after ' + r.flicks + ' (want 5–9)');
  r = flicks(11, 3, 8, seed);
  report(r.flicks < 0 && r.dMax < 0.8, 'seed ' + seed + ': the same flicks 3 s apart never crack it (it heals between them: dMax ' + r.dMax.toFixed(2) + ')');
  r = flicks(14, 0.9, 4, seed, true);
  report(r.flicks === 3, 'seed ' + seed + ': with Reduce Motion a hand\'s flicks count just the same (crack on flick ' + r.flicks + ')');
  r = stir(13, 8, seed);
  report(r.crackAt >= 1.5 && r.crackAt <= 6 && r.warns >= 3 && r.warnAt < r.crackAt - 0.5 && r.dome > 0.85,
    'seed ' + seed + ': stirring hard (13 rad/s) creaks at ' + r.warnAt.toFixed(1) + ' s and cracks a dome at ' + r.crackAt.toFixed(1) + ' s (want 1.5–6 s, ' + r.warns + ' creaks)');
  r = stir(8, 8, seed);
  report(r.crackAt < 0 && r.dMax === 0, 'seed ' + seed + ': stirring gently (8 rad/s, under 0.2 g) never loads it (dMax ' + r.dMax.toFixed(3) + ')');
});
// the dose law itself
(function () {
  var sim = H.glassAt({ durMs: 5 * 60000, startMs: 60000, seed: 11 }).sim, M = H.P.Sim.MOTION;
  var d0 = sim.flick(0.22), d1 = sim.flick(0.31), dMaxA = sim.dMax, d2 = sim.flick(0.40), d3 = sim.flick(0.9);
  report(d0 === 0 && Math.abs(d1 - 0.2) < 1e-6 && Math.abs(dMaxA - 0.2) < 1e-6 && Math.abs(d2 - M.flickD) < 1e-9 && d3 === M.flickD,
    'the dose: 0 at 0.22 g, ' + d1.toFixed(2) + ' at 0.31 g (written at once: dMax ' + dMaxA.toFixed(2) + '), ' + d2.toFixed(2) + ' at 0.40 g and above');
})();
console.log(failures ? 'spin: ' + failures + ' case(s) FAILED' : 'spin: all cases passed');
process.exit(failures ? 1 : 0);
