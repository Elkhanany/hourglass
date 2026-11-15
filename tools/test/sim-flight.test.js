/*
 * physics-core acceptance 4: the bouncing bed.
 *
 * Shaken up and down harder than gravity (Γ > 1) the packed bed lifts off
 * as one body and lands with a thump; below that it never leaves its seat.
 * Its flights follow the completely inelastic bouncing bed (Mehta and
 * Luck), checked against the physicist's 1-D integrator (bed1d.js, ported
 * below) at the same Γ and frequency.
 *
 *   Γ 2.5 at 3 Hz   the lower bed's top surface rises ≥ 8 cells within a
 *                   cycle; ≥ 2 landings a second; thump energy reaches the frame
 *   Γ 0.8           never airborne
 *   Γ 2, 3, 4       highest flight within 30 % of the 1-D bed
 *
 *   node tools/test/sim-flight.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim, REST = P.REST, DT = Sim.DT;
var TAU = 2 * Math.PI;

var failures = 0, count = 0;
function test(name, fn) {
  var t0 = Date.now(), detail;
  count++;
  try {
    detail = fn();
    console.log('PASS  ' + name + (detail ? ': ' + detail : '') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  } catch (e) {
    failures++;
    console.log('FAIL  ' + name + ': ' + (e && e.message ? e.message : e));
    if (process.env.VERBOSE && e && e.stack) console.log(e.stack);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** bed1d.js: the 1-D completely inelastic bouncing bed, a_eff = G·(1 − Γ sin ωt). */
function bed1d(Gamma, f, T, dt) {
  var G = 3300, w = TAU * f, z = 0, v = 0, t = 0, air = false, maxZ = 0, landings = 0, vMax = 0;
  T = T || 4; dt = dt || 1 / 1200;
  while (t < T) {
    var a = G * (1 - Gamma * Math.sin(w * t));
    if (!air && a < 0) { air = true; v = 0; }
    if (air) {
      v += -a * dt; z += v * dt;
      if (z <= 0 && v < 0) { landings++; if (-v > vMax) vMax = -v; z = 0; v = 0; air = false; }
      if (z > maxZ) maxZ = z;
    }
    t += dt;
  }
  return { maxZ: maxZ, vMax: vMax, rate: landings / T };
}

/** A glass with all its sand in the lower bulb, settled, gate closed. */
function lowerBed(seed) {
  var s = new Sim({ scale: 1.08, seed: seed || 4242 });
  s.reset(H.Clock.grainsFor(s, 300000));
  s.fastForward(s.nTop);
  for (var k = 0; k < 1200; k++) { s.beginFrame(); s.step(); }
  return s;
}
/** The top of the lower bed: the mean first-grain row over its 21 central columns. */
function surface(s) {
  var W = s.W, c = Math.floor(s.geo.cx), sum = 0, n = 0;
  for (var x = c - 10; x <= c + 10; x++) {
    for (var y = s.gateY + 1; y < s.H; y++) {
      if (s.cell[y * W + x] >= REST) { sum += y; n++; break; }
    }
  }
  return sum / n;
}
/** Shake the lower bed vertically: felt a = G·(1 − Γ sin ωt) along the axis. */
function shake(s, Gamma, f, secs, each) {
  var n = Math.round(secs / DT);
  for (var k = 0; k < n; k++) {
    var t = k * DT;
    s.setMotion(0, -Gamma * s.G * Math.sin(TAU * f * t), 0, 0, H.LAM, 0);
    if ((k & 1) === 0) s.beginFrame();
    var air0 = s.slug[1].air;
    s.step();
    if (each) each(s, k, t, air0);
  }
}

test('Γ 2.5 at 3 Hz: the bed lifts, lands and thumps', function () {
  var s = lowerBed(11), y0 = surface(s), rise = 0, landings = 0, thump = 0, firstCycle = 0;
  shake(s, 2.5, 3, 4, function (x, k, t, air0) {
    if (k % 2 === 1) {
      var r = y0 - surface(x);
      if (r > rise) rise = r;
      if (t < 1 / 3 && r > firstCycle) firstCycle = r;
      if (x.frame.thump[2] > 0) thump++;
    }
    if (air0 && !x.slug[1].air) landings++;
  });
  var c = s.census();
  ok(c.total === s.total && c.top === s.nTop, 'census');
  ok(firstCycle >= 8, 'surface rose ' + firstCycle.toFixed(1) + ' cells in the first cycle (want ≥ 8)');
  ok(landings / 4 >= 2, landings / 4 + ' landings/s');
  ok(thump > 0, 'no thump energy in any frame');
  return 'surface rose ' + firstCycle.toFixed(1) + ' cells in the first cycle (' + rise.toFixed(1) + ' max), ' +
    (landings / 4).toFixed(2) + ' landings/s, thump in ' + thump + ' frames';
});

test('Γ 0.8: never airborne', function () {
  var out = [];
  [[0.8, 3], [0.8, 5.5]].forEach(function (c) {
    var s = lowerBed(22), air = 0;
    s.setMotion(0, 0, 0, 0, H.LAM, 0);
    for (var k = 0; k < 360; k++) {
      // the upper bulb too: put some sand there so both beds are tried
      s.setMotion(0, -c[0] * s.G * Math.sin(TAU * c[1] * k * DT), 0, 0, H.LAM, 0);
      if ((k & 1) === 0) s.beginFrame();
      s.step();
      if (s.airborne()) air++;
    }
    ok(air === 0, 'airborne for ' + air + ' steps at Γ ' + c[0] + ', ' + c[1] + ' Hz');
    out.push(c[1] + ' Hz');
  });
  // and a glass mid-run with both bulbs holding sand
  var run = H.glassAt({ durMs: 300000, startMs: 150000, seed: 33 }), air2 = 0;
  H.drive(run, null, { dur: 3, fn: function (t, o) { o.y = 0.8 * Math.sin(TAU * 4 * t); }, each: function (r) { if (r.sim.airborne()) air2++; } });
  ok(air2 === 0, 'mid-run glass airborne for ' + air2 + ' steps');
  return 'lower bed at ' + out.join(' and ') + ', and a running glass at 4 Hz: never airborne';
});

test('Γ 2, 3, 4: flight heights within 30 % of the 1-D bouncing bed', function () {
  var out = [], cases = [[2, 4.5], [3, 5], [4, 5.5]];
  cases.forEach(function (c) {
    var ref = bed1d(c[0], c[1], 4);
    var s = lowerBed(33), maxZ = 0;
    shake(s, c[0], c[1], 4, function (x, k, t) { if (t > 0.5 && x.slug[1].air && x.slug[1].Z > maxZ) maxZ = x.slug[1].Z; });
    var ratio = maxZ / ref.maxZ;
    ok(Math.abs(ratio - 1) <= 0.3, 'Γ ' + c[0] + ' at ' + c[1] + ' Hz: flight ' + maxZ.toFixed(1) + ' cells vs 1-D ' + ref.maxZ.toFixed(1));
    out.push('Γ' + c[0] + '@' + c[1] + 'Hz ' + maxZ.toFixed(1) + ' vs ' + ref.maxZ.toFixed(1) + ' (' + ((ratio - 1) * 100).toFixed(0) + ' %)');
  });
  return out.join(', ');
});

console.log(failures ? 'flight: ' + failures + ' of ' + count + ' cases FAILED' : 'flight: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
