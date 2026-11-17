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
 * The Flip button itself must stay as calm as it always was. Its turn
 * swings gravity round in the glass's own frame, and that must not heat
 * the sand (no hops, no spray, no loosened friction); afterwards the sand
 * must lie as it did before motion existed (f446085). A lean of the phone
 * and a steady hand turn must not heat it either.
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
  // A full glass, nearly all of it below: the lower equator is under sand
  // either way up (heaped on the dome now, filling the funnel after the
  // flip), so its breach leaks through its mouth before and after.
  s.reset(s.maxTotal);
  s.fastForward(Math.round(s.nTop * 0.9));
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
    bf: Array.from(s.bf), hs: Array.from(s.hSlow), cen: Array.from(s.cen), agit: Array.from(s.agit), sw: Array.from(s.sweepAcc),
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
  ok(near(s.hSlow[0], -before.hs[2]) && near(s.hSlow[1], -before.hs[3]) && near(s.hSlow[3], -before.hs[1]), 'hSlow');
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

/* ---- the Flip button, a lean and a steady turn leave the sand calm ---------- */

var L = require('./lib/load-physics.js');
var BASE = L.baseline();                 // f446085, before motion, in its own vm context

/**
 * A glass durMs long, startMs into its run, its clock run for 3 s so it has
 * a stream and a fresh lower pile. Nothing here touches the motion inputs,
 * so the sim stays on its idle path and comes out exactly as f446085's does.
 */
function quietGlass(Pk, seed, durMs, startMs, granular) {
  var s = new Pk.Sim(granular === false ? { scale: 1.08, seed: seed, granular: false } : { scale: 1.08, seed: seed }), i;
  s.reset(H.Clock.grainsFor(s, durMs));
  for (i = 0; i < 300; i++) { s.beginFrame(); s.step(); }
  var T = new H.Clock(s, durMs);
  T.rem = durMs - startMs;
  var want = Math.ceil(T.topAt(T.rem));
  if (s.nTop > want) s.fastForward(s.nTop - want);
  T.state = 'running';
  for (i = 0; i < 360; i++) {
    T.tick(H.Clock.DT_MS, false); T.apply(i * H.Clock.DT_MS, false, true);
    if ((i & 1) === 0) s.beginFrame();
    s.step();
  }
  s.gateOpen = false;                    // the clock stands still while the glass turns
  return s;
}
/** What the sand did: the hottest it ran, hops, spray, and a census check every frame. */
function watcher() {
  return { T: 0, hops: 0, sprayed: 0, census: 0, frame: function (s) {
    var a = s.agitation();
    if (a > this.T) this.T = a;
    this.hops += s.frame.hops; this.sprayed += s.frame.sprayed;
    var c = s.census();
    if (c.total !== s.total || c.top !== s.nTop) this.census++;
  } };
}
/** The Flip button as app.js turns it (H.Turner), then 2 s at rest; watching the sand throughout. */
function flipNow(s, lam, w) {
  var tn = new H.Turner(s, lam), k = 0;
  tn.flip();
  while (tn.busy() || k < 312 + 240) {
    if (tn.busy()) tn.step(); else s.setMotion(0, 0, 0, 0, lam, 0);
    if ((k & 1) === 0) s.beginFrame();
    s.step();
    if (k & 1) w.frame(s);
    k++;
  }
  return tn.swaps;
}
/** f446085's Flip: the angle set once a frame (two steps), no motion inputs; then 2 s at rest. */
function flipThen(s) {
  var t = 0, k, turning = true;
  s.flipping = true; s.wakeAll();
  for (k = 0; k < 314 + 240; k++) {
    if ((k & 1) === 0) {
      if (turning) {
        t += 2000 / 120;
        var p = t / 2600;
        if (p >= 1) { s.completeFlip(); s.flipping = false; s.angle = 0; s.wakeAll(); turning = false; }
        else s.angle = Math.PI * (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
      }
      s.beginFrame();
    }
    s.step();
  }
}
/**
 * How the sand lies in each bulb: its grains, their centroid, and the angle
 * of its free surface (the principal axis of the sand cells that touch air).
 */
function lie(s) {
  var W = s.W, cell = s.cell, out = [];
  for (var b = 0; b < 2; b++) {
    var y0 = b ? s.gateY + 1 : 1, y1 = b ? s.H - 2 : s.gateY - 1;
    var n = 0, sx = 0, sy = 0, m = 0, ax = 0, ay = 0, axx = 0, ayy = 0, axy = 0;
    for (var y = y0; y <= y1; y++) {
      for (var x = s.rowMin[y]; x <= s.rowMax[y]; x++) {
        var i = y * W + x;
        if (cell[i] < P.REST) continue;
        n++; sx += x; sy += y;
        if (cell[i - 1] === P.EMPTY || cell[i + 1] === P.EMPTY || cell[i - W] === P.EMPTY || cell[i + W] === P.EMPTY) {
          m++; ax += x; ay += y; axx += x * x; ayy += y * y; axy += x * y;
        }
      }
    }
    var mx = ax / m, my = ay / m, cxx = axx / m - mx * mx, cyy = ayy / m - my * my, cxy = axy / m - mx * my;
    out.push({ n: n, cx: sx / n, cy: sy / n, ang: 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI });
  }
  return out;
}
var FLIP_FILLS = [[300000, 150000, '5-min glass mid-run'], [60000, 20000, '1-min glass'], [2700000, 600000, '45-min glass']];

test('the Flip button\'s turn leaves the sand calm: T < 0.05, no hops, no spray', function () {
  var worst = 0, at = '', lines = [];
  [0.062, 0.08, 0.123].forEach(function (lam) {
    FLIP_FILLS.forEach(function (fl) {
      [11, 22].forEach(function (seed) {
        var s = quietGlass(P, seed, fl[0], fl[1]), w = watcher();
        var swaps = flipNow(s, lam, w);
        ok(swaps === 1, 'one swap, got ' + swaps);
        ok(w.census === 0, 'census off in ' + w.census + ' frames');
        ok(w.hops === 0 && w.sprayed === 0, fl[2] + ' λ ' + lam + ': ' + w.hops + ' hops, ' + w.sprayed + ' sprayed');
        ok(w.T < 0.05, fl[2] + ' seed ' + seed + ' λ ' + lam + ': the sand ran at T ' + w.T.toFixed(3));
        if (w.T > worst) { worst = w.T; at = fl[2] + ', λ ' + lam; }
      });
    });
    lines.push('λ ' + lam);
  });
  return '18 turns (3 fills × 2 seeds × λ ' + lines.join(', ').replace(/λ /g, '') + '), 2 s after each too: hottest T ' + worst.toFixed(3) +
    ' (' + at + '); 0 hops, 0 spray, census exact';
});

// Until sand off the upright (sim.granular; tools/test/sim-repose.test.js) this case
// read "after the Flip the sand lies as it did in f446085: same grains per bulb, same
// surfaces", and what it pinned was the fault: f446085 leaves the turned sand standing
// against the glass at about 68°. Both halves are kept. Without granular the motion
// path's turn must still leave the sand as f446085's did, to 3° and 3 cells; with it
// (the engine as shipped) the same grains are in each bulb and they lie at the angle
// of repose, which f446085's do not.
test('after the Flip: the same grains per bulb as in f446085; without granular the same surfaces too, with it the sand lies at its angle of repose', function () {
  var dAng = 0, dCen = 0, notes = [], worst = 0;
  FLIP_FILLS.forEach(function (fl) {
    var angN = [0, 0], angO = [0, 0], angG = [0, 0];
    [11, 22, 33].forEach(function (seed) {
      var a = quietGlass(P, seed, fl[0], fl[1], false), b = quietGlass(BASE, seed, fl[0], fl[1]), c = quietGlass(P, seed, fl[0], fl[1]);
      for (var i = 0; i < a.cell.length; i++) if (a.cell[i] !== b.cell[i] || c.cell[i] !== b.cell[i]) throw new Error('the glasses differ before the turn at cell ' + i);
      flipNow(a, H.LAM, watcher());
      flipNow(c, H.LAM, watcher());
      flipThen(b);
      ok(a.nTop === b.nTop && a.total === b.total, fl[2] + ' seed ' + seed + ': nTop ' + a.nTop + ' vs ' + b.nTop);
      ok(c.nTop === b.nTop && c.total === b.total, fl[2] + ' seed ' + seed + ' (granular): nTop ' + c.nTop + ' vs ' + b.nTop);
      var la = lie(a), lb = lie(b), lc = lie(c);
      for (var k = 0; k < 2; k++) {
        ok(la[k].n === lb[k].n && lc[k].n === lb[k].n, 'grains in bulb ' + k);
        var da = Math.abs(la[k].ang - lb[k].ang), dc = Math.hypot(la[k].cx - lb[k].cx, la[k].cy - lb[k].cy);
        ok(da <= 3, fl[2] + ' seed ' + seed + ' bulb ' + k + ' (without granular): surface at ' + la[k].ang.toFixed(1) + '° vs ' + lb[k].ang.toFixed(1) + '°');
        ok(dc <= 3, fl[2] + ' seed ' + seed + ' bulb ' + k + ' (without granular): centroid ' + dc.toFixed(1) + ' cells from f446085\'s');
        var g = Math.abs(lc[k].ang);
        ok(g <= 38, fl[2] + ' seed ' + seed + ' bulb ' + k + ': the sand lies at ' + g.toFixed(1) + '° 2 s after the Flip (want at most 38)');
        if (da > dAng) dAng = da;
        if (dc > dCen) dCen = dc;
        if (g > worst) worst = g;
        angN[k] += la[k].ang / 3; angO[k] += lb[k].ang / 3; angG[k] += lc[k].ang / 3;
      }
    });
    ok(Math.abs(angO[0]) > 45, fl[2] + ': f446085 leaves the upper sand at ' + angO[0].toFixed(1) + '°: nothing to mend?');
    notes.push(fl[2] + ' surfaces ' + angG[0].toFixed(1) + '°/' + angG[1].toFixed(1) + '° (without granular ' + angN[0].toFixed(1) + '°/' + angN[1].toFixed(1) +
      '°, f446085 ' + angO[0].toFixed(1) + '°/' + angO[1].toFixed(1) + '°)');
  });
  return '9 glasses: grains per bulb identical; with granular no surface steeper than ' + worst.toFixed(1) + '° (allowed 38); without it surfaces within ' + dAng.toFixed(1) +
    '° and centroids within ' + dCen.toFixed(1) + ' cells of f446085\'s (allowed 3° and 3 cells); ' + notes.join('; ');
});

test('a lean of the phone and a steady turn do not heat the sand', function () {
  var lam = H.LAM, K = 1 - Math.exp(-H.DT / 0.04);
  // the phone leaned 40° in its own plane over 0.8 s, held, and back: the heading
  // follows, and the gyroscope's rate reaches the sim as w (composeField)
  var s = quietGlass(P, 7, 300000, 150000), w = watcher(), psi = 0, al = 0, wp = 0, k;
  for (k = 0; k < 312; k++) {
    var t = k / 120, u = t < 0.8 ? t / 0.8 : (t < 1.8 ? 1 : (t < 2.6 ? 1 - (t - 1.8) / 0.8 : 0));
    var to = 0.7 * (0.5 - 0.5 * Math.cos(Math.PI * u)), wv = (to - psi) * 120;
    psi = to; s.tilt = psi;
    al += ((wv - wp) * 120 - al) * K; wp = wv;
    s.setMotion(0, 0, wv, al, lam, 0);
    if ((k & 1) === 0) s.beginFrame();
    s.step();
    if (k & 1) w.frame(s);
  }
  ok(w.T < 0.05 && w.hops === 0 && w.census === 0, 'lean: T ' + w.T.toFixed(3) + ', ' + w.hops + ' hops');
  var leanT = w.T;
  // a hand turning the glass at a steady 2 rad/s for 3 s, through two swaps
  s = quietGlass(P, 8, 300000, 150000); w = watcher();
  var th = 0, wv2 = 0, swaps = 0; al = 0; wp = 0;
  s.flipping = true; s.wakeAll();
  for (k = 0; k < 480; k++) {
    var t2 = k / 120, want = t2 < 0.3 ? 2 * t2 / 0.3 : (t2 < 3.3 ? 2 : Math.max(0, 2 - 2 * (t2 - 3.3) / 0.3));
    wv2 = want; th += wv2 / 120;
    if (th > Math.PI) { s.completeFlip(); s.flipping = true; th -= Math.PI; swaps++; }
    s.angle = th;
    al += ((wv2 - wp) * 120 - al) * K; wp = wv2;
    s.setMotion(0, 0, wv2, al, lam, 0);
    if ((k & 1) === 0) s.beginFrame();
    s.step();
    if (k & 1) w.frame(s);
  }
  ok(swaps === 2, swaps + ' swaps');
  ok(w.T < 0.05 && w.hops === 0 && w.sprayed === 0 && w.census === 0, 'steady turn: T ' + w.T.toFixed(3) + ', ' + w.hops + ' hops');
  return 'lean 40° and back: hottest T ' + leanT.toFixed(3) + '; turned at 2 rad/s for 3 s (2 swaps): hottest T ' + w.T.toFixed(3) + '; no hops, census exact';
});

console.log(failures ? 'flip: ' + failures + ' of ' + count + ' cases FAILED' : 'flip: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
