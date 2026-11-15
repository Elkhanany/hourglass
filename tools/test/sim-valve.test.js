/*
 * physics-core acceptance 10: the neck valve under motion.
 *
 *   relCap > 0: no step releases more than ceil(relCap) grains, so a
 *   backlog drains as a thicker thread, never as a clump
 *   Γ 3 at 4 Hz: no release on any step where the upper bed is in the air
 *   or the field at the neck presses it with ≤ 0.25 G (Beverloo flow needs
 *   g > 0: the stream stutters with the hand), and it does flow between
 *
 *   node tools/test/sim-valve.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var MOT = H.P.Sim.MOTION, TAU = 2 * Math.PI;

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

test('relCap: no step releases more than ceil(relCap)', function () {
  var out = [];
  [0.4, 1.5, 3.2].forEach(function (cap) {
    var run = H.glassAt({ durMs: 60000, startMs: 10000, seed: 81 });
    var s = run.sim, T = run.T, worst = 0, total = 0, steps = 0, expect = 0;
    // a backlog: the clock runs on for 3 s while the gate stays shut
    for (var k = 0; k < 360; k++) { T.tick(H.Clock.DT_MS); s.beginFrame(); s.step(); }
    var owed = s.nTop - Math.ceil(T.topAt(T.rem));
    ok(owed > 300, 'no backlog to drain (' + owed + ')');
    var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {};
    for (k = 0; k < 600; k++) {
      f.y = 0.3 * Math.sin(TAU * 2 * k / 120);           // moving gently: the motion path
      H.felt(s, f, inp);
      s.setMotion(inp.ax, inp.ay, 0, 0, H.LAM, inp.gz);
      T.tick(H.Clock.DT_MS);
      T.apply(k * H.Clock.DT_MS, false, true);
      s.relCap = cap;
      var r0 = s.frame.released, need = s.nTop - s.targetTop;
      if (need > 0) expect += Math.min(need, Math.ceil(cap));
      s.step();
      var rel = s.frame.released - r0;
      if (rel > worst) worst = rel;
      total += rel; steps++;
      if ((k & 1) === 1) s.beginFrame();
    }
    ok(worst <= Math.ceil(cap), 'relCap ' + cap + ': a step released ' + worst);
    // it drains at the cap (the neck may starve for a moment now and then)
    ok(total >= 0.8 * expect, 'relCap ' + cap + ': released ' + total + ' of the ' + expect + ' the cap allowed');
    out.push('relCap ' + cap + ': ≤ ' + worst + '/step, ' + total + ' drained of ' + owed);
  });
  // and without a cap the backlog goes at once, as it always has
  var run2 = H.glassAt({ durMs: 60000, startMs: 10000, seed: 82 }), s2 = run2.sim, T2 = run2.T;
  for (var k = 0; k < 360; k++) { T2.tick(H.Clock.DT_MS); s2.beginFrame(); s2.step(); }
  T2.apply(0, false, true);
  s2.relCap = 0;
  s2.beginFrame();
  s2.step();
  out.push('relCap 0: ' + s2.frame.released + ' in one step');
  return out.join('; ');
});

test('Γ 3 at 4 Hz: no release while the upper bed flies or the neck is not pressed', function () {
  var out = [];
  [[1, 15, 11], [5, 150, 22], [45, 600, 33]].forEach(function (c) {
    var run = H.glassAt({ durMs: c[0] * 60000, startMs: c[1] * 1000, seed: c[2] });
    var s = run.sim, bad = 0, gated = 0, flowing = 0, relCapped = 0, r0 = 0, air0 = false, fny = 0;
    H.drive(run, null, {
      dur: 6,
      fn: function (t, o) { o.y = 3 * Math.sin(TAU * 4 * t); o.x = 0.3 * Math.sin(TAU * 4 * t + 0.5); },
      pre: function (r) {
        // what the valve will see: the upper bed as the last step left it,
        // and the field at the neck from this step's inputs (G·ĝ + A)
        r0 = s.frame.released;
        air0 = s.slug[0].air;
        fny = s.G * Math.cos(s.angle + s.tilt) + s.mAy;
      },
      each: function (r) {
        var rel = s.frame.released - r0;
        if (air0 || fny <= MOT.neckPress * s.G) { gated++; if (rel > 0) bad++; }
        else if (rel > 0) flowing++;
        if (s.relCap > 0 && rel > Math.ceil(s.relCap)) relCapped++;
      }
    });
    ok(bad === 0, H.fillName([c[0], c[1]]) + ': ' + bad + ' gated steps released sand');
    ok(flowing > 0, 'it never flowed between the blows');
    ok(relCapped === 0, relCapped + ' steps released past relCap');
    out.push(c[0] + '-min: ' + gated + ' gated steps silent, ' + flowing + ' flowing');
  });
  return out.join('; ');
});

console.log(failures ? 'valve: ' + failures + ' of ' + count + ' cases FAILED' : 'valve: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
