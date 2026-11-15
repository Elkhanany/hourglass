/*
 * physics-core acceptance 7: a flip carries the glass's damage with it.
 *
 * A glass with a w = 2 crack is turned end over end (completeFlip) while it
 * is being shaken. The lattice is reversed, so everything that belongs to
 * the glass must follow: holeMap, hole and mouth indices i → N − 1 − i,
 * bulb and side swap, (x, y) → (W − 1 − x, H − 1 − y), crackRev changes,
 * and the leak carries on from the same place on the glass. The motion
 * state turns with it too: both beds are put down first (seats back to +1),
 * the per-bulb fields and centroids swap and change sign, and the
 * temperatures swap.
 *
 *   node tools/test/sim-flip.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim, WALL = P.WALL;
var BINS = 40, TAU = 2 * Math.PI;

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
function segOf(bulb, side, u) { return (bulb * 2 + (side > 0 ? 1 : 0)) * BINS + Math.min(BINS - 1, Math.floor(u * BINS)); }
function flipSeg(s) { return (3 - Math.floor(s / BINS)) * BINS + (s % BINS); }
function census(s) {
  var c = s.census();
  ok(c.total === s.total && c.top === s.nTop, 'census ' + c.total + '/' + c.top + ' vs ' + s.total + '/' + s.nTop);
}
/** Shake for n steps (felt g from fn); returns the escape positions seen in the ring. */
function shake(s, n, fn, k0) {
  var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {}, esc = [];
  for (var k = 0; k < n; k++) {
    f.x = f.y = f.z = f.w = f.al = 0;
    fn((k0 + k) / 120, f);
    H.felt(s, f, inp);
    s.setMotion(inp.ax, inp.ay, inp.w, inp.al, H.LAM, inp.gz);
    if ((k & 1) === 0) s.beginFrame();
    s.step();
    for (var e = 0; e < s.escN; e++) esc.push([s.escX[e], s.escY[e]]);
    s.escN = 0;
  }
  return esc;
}
function nearestHole(s, cr, x, y) {
  var best = 1e9;
  for (var h = 0; h < cr.nh; h++) {
    var i = cr.holes[h], hx = (i % s.W) + 0.5 - s.nrmX[i] / 127, hy = Math.floor(i / s.W) + 0.5 - s.nrmY[i] / 127;
    best = Math.min(best, Math.hypot(x - hx, y - hy));
  }
  return best;
}

test('completeFlip mid-shake remaps the crack, its breach, its leak and the motion state', function () {
  var s = new Sim({ scale: 1.08, seed: 71 }), W = s.W, H2 = s.H, N = W * H2, h, q;
  s.reset(H.Clock.grainsFor(s, 2700000));
  s.fastForward(Math.round(s.nTop * 0.6));
  for (var k = 0; k < 600; k++) { s.beginFrame(); s.step(); }
  var cr = s.forceCrack(segOf(1, 1, 0.66), 40, 2);       // the lower equator, right: it leaks either way up
  ok(cr.w === 2 && cr.nh === 2, 'w = 2 crack');
  var fn = function (t, f) { f.y = 2.2 * Math.sin(TAU * 4 * t); f.x = 0.6 * Math.sin(TAU * 4 * t + 1); };
  var esc0 = shake(s, 240, fn, 0);
  ok(esc0.length > 0, 'it leaked before the flip');
  // flip at a moment the lower bed is in the air
  var guard = 0;
  while (!s.slug[1].air && guard++ < 120) shake(s, 1, fn, 240 + guard);
  ok(s.slug[1].air, 'the lower bed never flew');
  var before = {
    seg: cr.seg, x: cr.x, y: cr.y, bulb: cr.bulb, side: cr.side, u: cr.u,
    holes: Array.prototype.slice.call(cr.holes, 0, cr.nh), mouth: Array.prototype.slice.call(cr.mouth, 0, cr.nm),
    map: new Uint8Array(s.holeMap), segD: new Float32Array(s.segD), rev: s.crackRev,
    bf: Array.from(s.bf), bs: Array.from(s.bfSlow), cen: Array.from(s.cen), agit: Array.from(s.agit), sw: Array.from(s.sweepAcc),
    total: s.total, nTop: s.nTop
  };
  census(s);
  s.completeFlip();
  census(s);
  ok(!s.slug[0].air && !s.slug[1].air && s.slug[0].seat === 1 && s.slug[1].seat === 1 && s.nAir[0] === 0 && s.nAir[1] === 0,
     'both beds put down, seats +1');
  ok(cr.bulb === 1 - before.bulb && cr.side === -before.side && cr.u === before.u, 'bulb/side/u');
  ok(cr.x === W - 1 - before.x && cr.y === H2 - 1 - before.y && cr.seg === flipSeg(before.seg), 'origin (x, y) and segment');
  for (h = 0; h < cr.nh; h++) ok(cr.holes[h] === N - 1 - before.holes[h], 'hole ' + h);
  for (h = 0; h < cr.nm; h++) ok(cr.mouth[h] === N - 1 - before.mouth[h], 'mouth ' + h);
  for (var i = 0; i < N; i++) if (s.holeMap[i] !== before.map[N - 1 - i]) throw new Error('holeMap is not reversed at ' + i);
  for (q = 0; q < 160; q++) ok(s.segD[flipSeg(q)] === before.segD[q], 'segD ' + q);
  ok(s.crackRev !== before.rev, 'crackRev');
  for (h = 0; h < cr.nh; h++) ok(s.cell[cr.holes[h]] === WALL && s.holeMap[cr.holes[h]] === 1, 'hole is glass, in holeMap');
  // per-bulb vectors swap and change sign; temperatures and sweep carries swap
  var near = function (a, b) { return Math.abs(a - b) < 1e-3 * (1 + Math.abs(b)); };
  ok(near(s.bf[0], -before.bf[2]) && near(s.bf[1], -before.bf[3]) && near(s.bf[2], -before.bf[0]) && near(s.bf[3], -before.bf[1]), 'bf');
  ok(near(s.bfSlow[0], -before.bs[2]) && near(s.bfSlow[3], -before.bs[1]), 'bfSlow');
  ok(near(s.cen[0], -before.cen[2]) && near(s.cen[1], -before.cen[3]) && near(s.cen[3], -before.cen[1]), 'cen');
  ok(near(s.agit[0], before.agit[1]) && near(s.agit[1], before.agit[0]), 'agit');
  ok(near(s.sweepAcc[0], before.sw[1]) && near(s.sweepAcc[1], before.sw[0]), 'sweepAcc');
  ok(s.nTop === before.total - before.nTop, 'nTop is the other bulb now');
  // the leak carries on from the same place on the glass
  var esc1 = shake(s, 480, fn, 600), far = 0;
  ok(esc1.length > 0, 'no leak after the flip');
  esc1.forEach(function (e) { if (nearestHole(s, cr, e[0], e[1]) > 1.5) far++; });
  ok(far === 0, far + ' escapes away from the remapped breach');
  census(s);
  // and flipping back restores the crack exactly
  s.completeFlip();
  ok(cr.seg === before.seg && cr.x === before.x && cr.y === before.y && cr.holes[0] === before.holes[0] && cr.bulb === before.bulb, 'second flip');
  return esc0.length + ' escapes before, ' + esc1.length + ' after the flip, all at the remapped breach (' +
    (cr.bulb ? 'lower' : 'upper') + ' bulb after the second flip); seats, fields, centroids and temperatures follow';
});

test('a tumble while shaken keeps the cracks where the glass is', function () {
  var s = new Sim({ scale: 1.08, seed: 72 }), W = s.W, N = W * s.H;
  s.reset(H.Clock.grainsFor(s, 300000));
  for (var k = 0; k < 360; k++) { s.beginFrame(); s.step(); }
  var a = s.forceCrack(segOf(1, -1, 0.9), 40, 2), b = s.forceCrack(segOf(0, 1, 0.3), 30, 1);
  var ha = a.holes[0], hb = b.holes[0], flips = 0;
  var fn = function (t, f) { f.y = 2.5 * Math.sin(TAU * 4 * t); };
  for (var n = 0; n < 12; n++) {
    shake(s, 100, fn, n * 100);
    s.completeFlip(); flips++;
    census(s);
    var odd = flips & 1;
    ok(a.holes[0] === (odd ? N - 1 - ha : ha) && b.holes[0] === (odd ? N - 1 - hb : hb), 'after flip ' + flips);
    ok(s.holeMap[a.holes[0]] === 1 && s.holeMap[b.holes[0]] === 1, 'holeMap after flip ' + flips);
  }
  return flips + ' flips under shaking; both breaches always where the glass is; census exact';
});

console.log(failures ? 'flip: ' + failures + ' of ' + count + ' cases FAILED' : 'flip: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
