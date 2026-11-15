/*
 * physics-core acceptance 3: the motion field points the right way.
 *
 *   (a) centrifuge: spun at 25 rad/s (λ 0.084) the upper bed is flung to
 *       its dome: its mean row moves ≥ 50 cells toward the dome in 2 s
 *   (b) weightless: with the felt acceleration cancelling gravity the
 *       lattice does not change at all over 120 steps
 *   (c) Coriolis: a grain falling +y under a clockwise spin is deflected
 *       toward +x; at 4π rad/s with no other force its speed is kept to
 *       0.1 % over 2 s (the exact-norm rotation)
 *   (d) a felt acceleration toward +x moves the lower pile toward +x
 *       within 1 s
 *
 *   node tools/test/sim-sanity.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim, MOT = Sim.MOTION, REST = P.REST;

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
function steps(s, n, each) {
  for (var k = 0; k < n; k++) { if ((k & 1) === 0) s.beginFrame(); s.step(); if (each) each(s, k); }
}
function settled(o) {
  var s = new Sim({ scale: 1.08, seed: o.seed || 4242 });
  s.reset(o.grains !== undefined ? o.grains : H.Clock.grainsFor(s, o.durMs || 300000));
  if (o.lower) s.fastForward(Math.round(s.nTop * o.lower));
  for (var k = 0; k < (o.settle || 600); k++) { s.beginFrame(); s.step(); }
  return s;
}
/** Mean position (cells) of the grains in bulb b: lattice and airborne. */
function bedMean(s, b) {
  var W = s.W, gate = s.gateY, sx = 0, sy = 0, n = 0, i, N = W * s.H;
  for (i = 0; i < N; i++) {
    if (s.cell[i] < REST) continue;
    var y = Math.floor(i / W);
    if ((y < gate) !== (b === 0)) continue;
    sx += i % W; sy += y; n++;
  }
  for (i = 0; i < s.np; i++) {
    if ((s.py[i] < gate) !== (b === 0)) continue;
    sx += s.px[i]; sy += s.py[i]; n++;
  }
  return { x: sx / n, y: sy / n, n: n };
}

test('(a) centrifuge: 25 rad/s flings the upper bed to its dome', function () {
  var s = settled({ durMs: 300000 });
  var a = bedMean(s, 0), best = a.y;
  s.setMotion(0, 0, 25, 0, 0.084, 0);
  steps(s, 240, function (x, k) { if (k % 12 === 11) best = Math.min(best, bedMean(x, 0).y); });
  var b = bedMean(s, 0);
  ok(a.y - b.y >= 50, 'mean row ' + a.y.toFixed(1) + ' → ' + b.y.toFixed(1) + ' (moved ' + (a.y - b.y).toFixed(1) + ', want ≥ 50)');
  var c = s.census();
  ok(c.top === s.nTop && c.total === s.total, 'census');
  return 'upper bed mean row ' + a.y.toFixed(1) + ' → ' + b.y.toFixed(1) + ' in 2 s (gate at row ' + s.gateY + ', dome tip near row ' + s.topY + ')';
});

test('(b) weightless: the felt acceleration cancels gravity, nothing moves', function () {
  var s = settled({ durMs: 300000, lower: 0.5, settle: 1200 });
  var guard = 0;
  while (s.np > 0 && guard++ < 1200) { s.beginFrame(); s.step(); }
  ok(s.np === 0, 'grains still in the air');
  var cell = new Uint8Array(s.cell), seed = new Uint8Array(s.seed);
  s.setMotion(-s.G * s.gx, -s.G * s.gy, 0, 0, 0.08, 0);
  var motion = 0;
  steps(s, 120, function (x) { if (x.motionActive()) motion++; });
  var diff = 0;
  for (var i = 0; i < cell.length; i++) if (cell[i] !== s.cell[i] || seed[i] !== s.seed[i]) diff++;
  ok(motion === 120, 'the motion path ran ' + motion + ' of 120 steps');
  ok(diff === 0, diff + ' cells changed');
  ok(!s.airborne() && s.np === 0, 'airborne ' + s.airborne() + ', np ' + s.np);
  return '120 steps on the motion path, |f| = ' + Math.hypot(s.bf[0], s.bf[1]).toFixed(3) + ': lattice identical';
});

test('(c) Coriolis: deflects a falling grain toward +x and keeps its speed', function () {
  var jx = MOT.jitX, jy = MOT.jitY;
  MOT.jitX = 0; MOT.jitY = 0;                 // no aerodynamic jitter: only the field acts
  try {
    // (1) in gravity, spinning clockwise: a grain dropped on the axis drifts to +x
    var s = new Sim({ scale: 1.08, seed: 5 });
    s.reset(0);
    var p = s.np++, x0 = s.geo.cx;
    s.px[p] = x0; s.py[p] = s.gateY + 30; s.pvx[p] = 0; s.pvy[p] = 0; s.pseed[p] = 1; s.pinfo[p] = 8;
    s.total++;
    s.setMotion(0, 0, 4, 0, 0.08, 0);
    steps(s, 18);
    ok(s.np === 1 && s.pvy[0] > 0, 'the grain should still be falling');
    var dx = s.px[0] - x0;
    ok(dx > 0 && s.pvx[0] > 0, 'deflected to ' + dx.toFixed(3) + ' (vx ' + s.pvx[0].toFixed(2) + '), want +x');
    // (2) 4π rad/s and nothing else: the felt acceleration cancels gravity and
    //     the centrifugal pull at the grain, step by step; speed is kept
    var t = new Sim({ scale: 1.08, seed: 6 });
    t.reset(0);
    var lam = 0.084, w = 4 * Math.PI, w2 = lam * w * w, cx = t.geo.cx, cy = t.geo.cy;
    var q = t.np++;
    t.px[q] = cx; t.py[q] = t.gateY + 110; t.pvx[q] = 0; t.pvy[q] = 100; t.pseed[q] = 2; t.pinfo[q] = 8;
    t.total++;
    var v0 = 100, worst = 0, firstVx = 0;
    for (var k = 0; k < 240; k++) {
      var rx = t.px[0] - cx, ry = t.py[0] - cy;
      t.setMotion(-t.G * t.gx - w2 * rx, -t.G * t.gy - w2 * ry, w, 0, lam, 0);
      if ((k & 1) === 0) t.beginFrame();
      t.step();
      ok(t.np === 1, 'the grain hit something at step ' + k);
      var v = Math.hypot(t.pvx[0], t.pvy[0]), e = Math.abs(v / v0 - 1);
      if (e > worst) worst = e;
      if (k === 0) firstVx = t.pvx[0];
    }
    ok(firstVx > 0, 'first step deflects toward +x: vx ' + firstVx);
    ok(worst < 1e-3, 'speed drifted ' + (worst * 100).toFixed(4) + ' %');
    return 'dropped grain drifts +' + dx.toFixed(2) + ' cells in 0.15 s at 4 rad/s; at 4π rad/s |v| kept within ' +
      (worst * 100).toFixed(5) + ' % over 2 s (circle of ' + (v0 / (2 * Math.sqrt(lam) * w)).toFixed(1) + ' cells)';
  } finally {
    MOT.jitX = jx; MOT.jitY = jy;
  }
});

test('(d) felt acceleration toward +x moves the lower pile toward +x', function () {
  var s = settled({ durMs: 300000, lower: 1, settle: 1200 });
  var a = bedMean(s, 1), t = -1;
  s.setMotion(0.5 * s.G, 0, 0, 0, 0.08, 0);
  steps(s, 120, function (x, k) { if (t < 0 && k % 6 === 5 && bedMean(x, 1).x - a.x > 0.1) t = (k + 1) / 120; });
  var b = bedMean(s, 1);
  ok(b.x - a.x > 0.3, 'centroid x ' + a.x.toFixed(2) + ' → ' + b.x.toFixed(2) + ' (want > +0.3 cells)');
  var c = s.census();
  ok(c.top === s.nTop && c.total === s.total, 'census');
  return 'ax = +0.5 g: lower pile centroid x ' + a.x.toFixed(2) + ' → ' + b.x.toFixed(2) + ' in 1 s (past +0.1 cell at ' + t.toFixed(2) + ' s)';
});

console.log(failures ? 'sanity: ' + failures + ' of ' + count + ' cases FAILED' : 'sanity: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
