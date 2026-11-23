/*
 * Finer sand (Sim.setPace). A glass built at p times the scale, with
 * setPace(p), holds p² times the grains and must still behave on screen as
 * the classic glass does: the same share of its sand above the neck at the
 * same moments, settled as soon after a turn or a lean and in the same
 * place, as many grains in the air for its size, cracked about as soon by
 * the same shaking and never by walking. Each is measured on the classic
 * sand (scale 1.08, pace 1) and on Fine (√2) and Finest (2), each in its
 * own copy of physics.js, since the pace is one for a page.
 *
 *   node tools/test/sim-grain.test.js        exits 0 when every case passes
 */
'use strict';
var L = require('./lib/load-physics.js');
var H = require('./lib/harness.js');
var DT = H.DT;
var SRC = L.physicsSource();
var REST = 2, Q = 1.08;

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
var f2 = function (x) { return x.toFixed(2); };

/** Where bulb b's sand lies: its centroid, in bulb half-widths across and bulb heights along. */
function centroid(sim, b) {
  var W = sim.W, cell = sim.cell, g = sim.geo, gate = sim.gateY;
  var y0 = b ? gate + 1 : 1, y1 = b ? sim.H - 2 : gate - 1, n = 0, sx = 0, sy = 0, x, y;
  for (y = y0; y <= y1; y++) {
    for (x = sim.rowMin[y]; x <= sim.rowMax[y]; x++) if (cell[y * W + x] >= REST) { n++; sx += x; sy += y; }
  }
  return { x: (sx / n - g.cx) / g.R, y: (sy / n - g.cy) / g.HB };
}
/**
 * Step the glass for `secs` and say how its sand settled: when the bulk had
 * arrived (the centroid within a hundredth of where it ends), when it was
 * quite at rest (nothing moving for a fifth of a second), and where it ends.
 */
function settle(sim, b, secs, each) {
  var s = [], rest = -1, k, c;
  for (k = 0; k < secs * 120; k++) {
    if ((k & 1) === 0) sim.beginFrame();
    if (each) each();
    sim.step();
    if (rest < 0 && sim.quiet >= 24) rest = (k + 1) * DT;
    if (k % 12 === 11) { c = centroid(sim, b); c.t = (k + 1) * DT; s.push(c); }
  }
  var end = s[s.length - 1], bulk = 0;
  for (k = 0; k < s.length; k++) if (Math.abs(s[k].x - end.x) > 0.01 || Math.abs(s[k].y - end.y) > 0.01) bulk = s[k].t;
  return { bulk: bulk, rest: rest, x: end.x, y: end.y };
}
function frames(sim, n, each) {
  for (var k = 0; k < n; k++) { if ((k & 1) === 0) sim.beginFrame(); sim.step(); if (each) each(k); }
}

/** Everything this suite compares, for one grain (p = 1: the classic sand). */
function measure(p) {
  var P = L.loadIsolated(SRC, 'physics.js');
  if (p > 1) P.Sim.setPace(p);
  var q = Q * p, out = { p: p, pace: P.Sim.pace() };
  var glass = function (dur, start, seed) { return H.glassAt({ P: P, scale: q, durMs: dur, startMs: start, seed: seed }); };

  // the clock: a one-minute glass from its start to its end
  var run = glass(60000, 0, 11), sim = run.sim, share = {}, np = 0, nn = 0;
  out.total = sim.total; out.neck = 2 * sim.geo.RN; out.G = sim.G; out.grid = sim.W + 'x' + sim.H;
  sim.gateOpen = true;
  var rec = H.drive(run, null, { dur: 61.5, fn: function () {}, frame: function (r, k, t) {
    var s = Math.round(t);
    if ((s === 15 || s === 30 || s === 45) && share[s] === undefined && t >= s) share[s] = sim.nTop / sim.total;
    if (t > 5 && t < 50) { np += sim.np; nn++; }
  } });
  out.share = share; out.left = sim.nTop; out.census = rec.censusErr; out.over = rec.overRelease; out.air = np / nn / sim.total;

  // the Flip, half way through a minute
  run = glass(60000, 30000, 7); sim = run.sim;
  sim.gateOpen = false;
  var tn = new H.Turner(sim, H.LAM);
  tn.flip();
  while (tn.busy()) { sim.beginFrame(); tn.step(); sim.step(); }
  out.flip = settle(sim, 1, 10, function () { sim.setMotion(0, 0, 0, 0, H.LAM, 0); });
  var c = sim.census();
  out.flipCensus = c.top === sim.nTop && c.total === sim.total;

  // a lean of 30°, held
  run = glass(60000, 30000, 9); sim = run.sim;
  sim.gateOpen = false;
  sim.tilt = 30 * Math.PI / 180; sim.wakeAll();
  out.lean = settle(sim, 0, 12);
  sim.tilt = 0; sim.wakeAll();

  // shaken hard and slow: it cracks. Walked with: never.
  run = glass(300000, 150000, 4242);
  rec = H.drive(run, 'veryVigSlow', { armed: true });
  out.crackT = rec.crackT; out.cracks = rec.cracks; out.shakeCensus = rec.censusErr;
  run = glass(300000, 150000, 4242);
  rec = H.drive(run, 'walking', { armed: true });
  out.walkCracks = rec.cracks; out.walkD = rec.dMax;
  return out;
}

var classic = null, fine = {};
test('the classic sand, measured', function () {
  classic = measure(1);
  ok(classic.pace === 1 && classic.G === 3300, 'pace ' + classic.pace + ', G ' + classic.G);
  ok(classic.left === 0 && classic.census === 0 && classic.over === 0, classic.left + ' grains left at 00:00, census errors ' + classic.census);
  ok(classic.flip.rest > 0 && classic.lean.rest > 0, 'never at rest: ' + classic.flip.rest + ' / ' + classic.lean.rest);
  return classic.total + ' grains on ' + classic.grid + '; after the Flip the bulk has settled in ' + f2(classic.flip.bulk) + ' s and all is at rest in ' + f2(classic.flip.rest) +
         '; leaned 30°, in ' + f2(classic.lean.bulk) + ' and ' + f2(classic.lean.rest) + ' s; first crack ' + f2(classic.crackT) + ' s into the hard shake';
});

[[Math.SQRT2, 'Fine'], [2, 'Finest']].forEach(function (pp) {
  var p = pp[0], name = pp[1], m;
  test(name + ' (×' + f2(p * p) + ' grains): measured', function () {
    m = fine[name] = measure(p);
    ok(Math.abs(m.pace - p) < 1e-12 && Math.abs(m.G - 3300 * p) < 1e-6, 'pace ' + m.pace + ', G ' + m.G);
    var r = m.total / classic.total;
    ok(r > 0.96 * p * p && r < 1.04 * p * p, 'grains × ' + f2(r));
    ok(Math.abs(m.neck - classic.neck * p) <= 2, 'neck ' + m.neck + ' cells, classic ' + classic.neck);
    return m.total + ' grains on ' + m.grid + ', neck ' + m.neck + ' cells';
  });
  test(name + ': the clock is kept as exactly', function () {
    ok(m.left === 0, m.left + ' grains above the neck at 00:00');
    ok(m.census === 0 && m.over === 0 && m.flipCensus && m.shakeCensus === 0, 'census errors ' + m.census + ' / ' + m.shakeCensus + ', over-releases ' + m.over);
    var d = [15, 30, 45].map(function (s) { return Math.abs(m.share[s] - classic.share[s]); });
    ok(Math.max.apply(null, d) < 0.004, 'share above the neck differs by ' + d.map(function (x) { return x.toFixed(4); }).join(', '));
    return 'none left at 00:00; the share above the neck at 15, 30 and 45 s within ' + Math.max.apply(null, d).toFixed(4) + ' of the classic';
  });
  test(name + ': the thread is as long in the air', function () {
    // (grains in flight, as a share of the glass: the same flow for as long a fall)
    var r = m.air / classic.air;
    ok(r > 0.7 && r < 1.4, 'in the air ' + (m.air * 100).toFixed(2) + ' % of the sand, classic ' + (classic.air * 100).toFixed(2) + ' %');
    return (m.air * 100).toFixed(2) + ' % of the sand in the air, classic ' + (classic.air * 100).toFixed(2) + ' %';
  });
  [['flip', 'after the Flip'], ['lean', 'leaned 30°']].forEach(function (cs) {
    test(name + ': ' + cs[1] + ' its sand settles as soon, in the same place', function () {
      var a = m[cs[0]], c0 = classic[cs[0]];
      ok(a.rest > 0, 'never at rest');
      ok(a.bulk < c0.bulk + 0.6, 'the bulk settled in ' + f2(a.bulk) + ' s, classic ' + f2(c0.bulk));
      ok(a.rest < 1.6 * c0.rest + 0.3, 'at rest after ' + f2(a.rest) + ' s, classic ' + f2(c0.rest));
      ok(Math.abs(a.x - c0.x) < 0.04 && Math.abs(a.y - c0.y) < 0.04, 'it ends at (' + a.x.toFixed(3) + ', ' + a.y.toFixed(3) + '), classic (' + c0.x.toFixed(3) + ', ' + c0.y.toFixed(3) + ')');
      return 'bulk in ' + f2(a.bulk) + ' s (classic ' + f2(c0.bulk) + '), at rest in ' + f2(a.rest) + ' (' + f2(c0.rest) + '), ending within ' +
             Math.max(Math.abs(a.x - c0.x), Math.abs(a.y - c0.y)).toFixed(3) + ' of the classic heap';
    });
  });
  test(name + ': a hard, slow shake cracks it about as soon; a walk never does', function () {
    ok(classic.crackT > 0 && m.crackT > 0, 'no crack: ' + m.crackT + ' / ' + classic.crackT);
    var r = m.crackT / classic.crackT;
    ok(r > 0.5 && r < 2, 'first crack after ' + f2(m.crackT) + ' s, classic ' + f2(classic.crackT));
    ok(m.walkCracks === 0 && classic.walkCracks === 0 && m.walkD < 0.2, 'walking: ' + m.walkCracks + ' cracks, damage ' + f2(m.walkD));
    return 'first crack after ' + f2(m.crackT) + ' s (classic ' + f2(classic.crackT) + '); walking leaves ' + f2(m.walkD) + ' of damage at most (' + f2(classic.walkD) + ')';
  });
});

test('setPace(1) puts every constant back, and a pace is refused below 1', function () {
  var A = L.loadIsolated(SRC, 'physics.js'), B = L.loadIsolated(SRC, 'physics.js');
  B.Sim.setPace(2); B.Sim.setPace(Math.SQRT2); B.Sim.setPace(1);
  ok(JSON.stringify(A.Sim.MOTION) === JSON.stringify(B.Sim.MOTION) && JSON.stringify(A.Sim.LAYERS) === JSON.stringify(B.Sim.LAYERS), 'the tables differ after setPace(1)');
  B.Sim.setPace(0.5);
  ok(B.Sim.pace() === 1 && JSON.stringify(A.Sim.MOTION) === JSON.stringify(B.Sim.MOTION), 'pace ' + B.Sim.pace());
  // and the same glass steps the same way after it
  var a = new A.Sim({ scale: Q, seed: 5 }), b = new B.Sim({ scale: Q, seed: 5 });
  a.reset(9000); b.reset(9000);
  for (var k = 0; k < 600; k++) { a.beginFrame(); a.step(); b.beginFrame(); b.step(); }
  for (var i = 0; i < a.cell.length; i++) ok(a.cell[i] === b.cell[i], 'the lattices differ at cell ' + i);
  ok(a.rng === b.rng && a.G === b.G, 'the random streams differ');
  return 'tables equal, 600 steps of the same glass identical';
});

console.log(failures ? 'grain: ' + failures + ' of ' + count + ' cases FAILED' : 'grain: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
