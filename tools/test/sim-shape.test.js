/*
 * Other glasses (HourglassPhysics.SHAPES). The sand engine was fitted to one
 * glass, the classic teardrop. Every registered shape must do what that one
 * does, and the classic itself runs through the same cases as the reference.
 * All of it at scale 1.08 (a phone) unless a case says otherwise.
 *
 *   the classic glass      makeGeometry(1.08) and profile() give the numbers
 *                          they always gave (a few pinned, the rest compared
 *                          with f446085), and its lattice, capacity, pour cap
 *                          and fill limit are untouched, at every pace
 *   the registry           every record is whole, its f pure, 0 at the neck
 *                          and 1 at its widest; an unknown id is refused
 *
 * and for every shape:
 *
 *   lattice                what the engine needs, read off the cells by this
 *                          suite's own code: the classic neck, open rows
 *                          beside it, one span per row and per column, the
 *                          widest row within R, a funnel that opens by at most
 *                          a cell a row, an end wide enough to pour into, the
 *                          two bulbs mirror images; capacity 0.65 to 1.25 of
 *                          the classic; fillMax and maxTotal as specified
 *   every size             the same rules at the six sizes the app builds
 *                          (phone and tablet, classic, Fine and Finest sand)
 *   one minute             a one-minute glass run through its clock: census
 *                          exact every 30 steps, the neck never more than 40
 *                          grains behind after the first second, at most 2
 *                          grains above the neck at 00:00 before any deep
 *                          release, all of it below and at rest within 3 s
 *   45 minutes             the fullest timed glass, run for 60 s: the neck
 *                          keeps up; then all of it passed through
 *                          (fastForward): the heap's top stays 20 rows or
 *                          more under the neck
 *   leaned 12 degrees      for the whole one-minute run: at most 15 grains
 *                          above the neck at 00:00 (the classic leaves 1)
 *   the Flip               the button's turn at half run: census exact, and
 *                          the glass comes to rest
 *   a pour                 pour(300) into a 45-minute glass adds grains and
 *                          conserves them; a glass filled to its cap
 *                          (maxTotal) still passes all of it through the neck
 *   a hard shake           3 s of 'veryVigorous' (lib/profiles.js), beds in
 *                          flight: census exact every step, and no cell of
 *                          glass ever becomes sand or sand glass (against the
 *                          wall map taken when the glass was built)
 *   layered sand           each tone's count kept through a run, the Flip, a
 *                          shake, a pour and a fast-forward
 *   Finest sand            the one-minute glass again at pace 2, scale 2.16
 *                          (four times the grains: all below within 3 s of
 *                          00:00, at rest within 8)
 *
 * and the controls:
 *
 *   refused                glasses the engine must not accept (two bulges, a
 *                          shallow funnel, a pinched end, an open neck, wider
 *                          than R) are refused by name and by rule
 *   the suite can tell     the two-bulge glass, let through unchecked and
 *                          shaken, has sand written into its glass
 *   a small glass          where less than 0.78 fits under the neck, fillMax
 *                          says so and the clock's fullest glass obeys it
 *   HOURGLASS_SHAPE        the test library's switch gives every Sim the shape
 *
 *   node tools/test/sim-shape.test.js        exits 0 when every case passes
 */
'use strict';
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var L = require('./lib/load-physics.js');
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim, Clock = H.Clock, DT = H.DT, DT_MS = Clock.DT_MS;
var SRC = fs.readFileSync(L.PHYSICS, 'utf8');
var WALL = 1, REST = 2, Q = 1.08, DEG = Math.PI / 180;

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
var f3 = function (x) { return x.toFixed(3); };

function steps(sim, n) {
  for (var k = 0; k < n; k++) { if ((k & 1) === 0) sim.beginFrame(); sim.step(); }
}
function censusOk(sim) {
  var c = sim.census();
  return c.top === sim.nTop && c.total === sim.total;
}
/** A glass of this shape. The shape is always named, so HOURGLASS_SHAPE cannot change it. */
function glass(id, seed, PP, q) {
  return new (PP || P).Sim({ scale: q || Q, seed: seed, shape: id });
}
/** Which cells are glass. */
function wallMap(sim) {
  var n = sim.cell.length, w = new Uint8Array(n);
  for (var i = 0; i < n; i++) w[i] = sim.cell[i] === WALL ? 1 : 0;
  return w;
}
/** Rows from the neck down to the lower heap's top (−1: no sand below). */
function heapTop(sim) {
  var W = sim.W, cell = sim.cell;
  for (var y = sim.gateY + 1; y < sim.H; y++) {
    for (var x = sim.rowMin[y]; x <= sim.rowMax[y]; x++) if (cell[y * W + x] >= REST) return y - sim.gateY;
  }
  return -1;
}
/** The specification's heap sum: what fits under the neck with `clear` rows of fall, in grains. */
function heapMax(sim, clear) {
  var sum = 0, span = sim.gateX1 - sim.gateX0 + 1;
  for (var y = sim.gateY + 1 + clear; y < sim.H; y++) {
    var w = sim.rowMax[y] - sim.rowMin[y] + 1;
    if (w <= 0) continue;
    sum += Math.min(w, span + 2 * (y - sim.gateY - 1 - clear) / Math.tan(34 * Math.PI / 180));
  }
  return sum;
}

/**
 * What the sand needs of a glass, read off the cells alone (not the engine's
 * own check, and not its row and column tables). '' when all of it holds,
 * or the first rule that does not.
 */
function latticeFault(sim, pace) {
  var W = sim.W, Hh = sim.H, N = W * Hh, g = sim.geo, gate = (Hh - 1) / 2, w = wallMap(sim), x, y, i, runs;
  var lo = new Int32Array(Hh), hi = new Int32Array(Hh), top = -1;
  if (sim.gateY !== gate) return 'the gate is not the centre row';
  for (y = 0; y < Hh; y++) {
    lo[y] = W; hi[y] = -1; runs = 0;
    for (x = 0; x < W; x++) {
      if (w[y * W + x]) continue;
      if (x === 0 || w[y * W + x - 1]) runs++;
      if (x < lo[y]) lo[y] = x;
      hi[y] = x;
    }
    if (runs > 1) return 'row ' + y + ' has ' + runs + ' spans';
    if (y === gate && runs) return 'the gate row is open';
    if (runs && top < 0) top = y;
    if (runs && (lo[y] < 8 || hi[y] > W - 9)) return 'row ' + y + ' leaves less than 8 cells of glass at the side';
  }
  for (x = 0; x < W; x++) {
    for (var b = 0; b < 2; b++) {
      runs = 0;
      for (y = b ? gate + 1 : 0; y < (b ? Hh : gate); y++) if (!w[y * W + x] && w[(y - 1) * W + x]) runs++;
      if (runs > 1) return 'column ' + x + ' has ' + runs + ' spans in bulb ' + b;
    }
  }
  for (i = 0; i < N; i++) if (w[i] !== w[N - 1 - i]) return 'cell ' + i + ' is not the mirror of cell ' + (N - 1 - i);
  function wd(r) { return hi[r] >= lo[r] ? hi[r] - lo[r] + 1 : 0; }
  var span = sim.gateX1 - sim.gateX0 + 1, mid = (W - 1) / 2;
  if (span !== 2 * Math.round(3 * g.q) + 1) return 'the neck is ' + span + ' cells wide, the classic glass of this size has ' + (2 * Math.round(3 * g.q) + 1);
  if (sim.gateX0 + sim.gateX1 !== 2 * mid) return 'the neck is off the axis';
  if (lo[gate - 1] > sim.gateX0 || hi[gate - 1] < sim.gateX1 || lo[gate + 1] > sim.gateX0 || hi[gate + 1] < sim.gateX1) return 'a row beside the neck is narrower than the neck';
  if (top !== sim.topY) return 'topY is ' + sim.topY + ', the first open row is ' + top;
  for (y = 0; y < top; y++) if (wd(y)) return 'row ' + y + ' is open above the end';
  for (y = top; y < gate; y++) if (!wd(y)) return 'row ' + y + ' is closed inside the bulb';
  var wy = gate - 1, wMax = 0;
  for (y = gate - 1; y >= top; y--) if (wd(y) > wMax) { wMax = wd(y); wy = y; }
  if (wMax > 2 * g.R - 1) return 'the widest row has ' + wMax + ' cells, R is ' + g.R;
  if (lo[gate - 1] < sim.gateX0 - 1) return 'the funnel opens by ' + (sim.gateX0 - lo[gate - 1]) + ' cells at the neck';
  for (y = gate - 1; y > wy; y--) {
    if (lo[y] - lo[y - 1] > 1) return 'the funnel opens by ' + (lo[y] - lo[y - 1]) + ' cells in row ' + (y - 1);
    if (lo[y] - lo[y - 1] < 0) return 'the funnel narrows again in row ' + (y - 1);
  }
  for (y = top + 3; y <= top + 5; y++) {
    if (wd(y) < 7 * pace + 2) return 'the end is ' + wd(y) + ' cells wide ' + (y - top) + ' rows in (the pour needs ' + Math.ceil(7 * pace + 2) + ')';
  }
  // and the engine's own tables say the same
  for (y = 0; y < Hh; y++) {
    if (wd(y) ? (sim.rowMin[y] !== lo[y] || sim.rowMax[y] !== hi[y]) : sim.rowMin[y] <= sim.rowMax[y]) return 'rowMin/rowMax are wrong in row ' + y;
  }
  return '';
}

/**
 * A glass durMs long run by its clock, leaned `lean` degrees from the start,
 * for `secs` (default: to the end, and on until all of it is below and at
 * rest, 10 s at most). `below` and `rest` are seconds after 00:00.
 */
function clockRun(sim, durMs, lean, secs) {
  sim.reset(Clock.grainsFor(sim, durMs));
  steps(sim, 300);
  var T = new Clock(sim, durMs), now = 0, k, n = Math.round((secs || durMs / 1000 + 10) * 120);
  var r = { total: sim.total, maxLag: 0, left: -1, censusBad: 0, below: -1, rest: -1, endK: -1 };
  if (lean) { sim.tilt = lean * DEG; sim.wakeAll(); }
  T.start();
  for (k = 0; k < n; k++) {
    if (T.tick(DT_MS, false)) { r.left = sim.nTop; r.endK = k; }      // 00:00, before the valve is told to let the rest go
    T.apply(now, false, true);
    if ((k & 1) === 0) sim.beginFrame();
    sim.step(); now += DT_MS;
    if (k >= 120 && r.endK < 0 && sim.lag > r.maxLag) r.maxLag = sim.lag;
    if (k % 30 === 29 && !censusOk(sim)) r.censusBad++;
    if (r.endK >= 0 && r.below < 0 && sim.nTop === 0 && sim.np === 0) r.below = (k - r.endK) * DT;
    if (r.endK >= 0 && sim.nTop === 0 && sim.np === 0 && sim.quiet >= 24) { r.rest = (k - r.endK) * DT; break; }
  }
  if (!censusOk(sim)) r.censusBad++;
  return r;
}

/** Shapes this suite makes up are registered only while fn runs. */
function withShape(rec, fn) {
  P.SHAPES[rec.id] = rec;
  try { return fn(); } finally { delete P.SHAPES[rec.id]; }
}
function dome(u, c, n) { var w = (u - c) / (1 - c); return w <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow(w, n))); }
var BAD = [
  [{ id: 'x-beads', name: 'two bulges', kR: 1, kH: 1,
     f: function (u) { return Math.min(1, u / 0.25) * (1 - 0.45 * Math.exp(-Math.pow((u - 0.55) / 0.07, 2))) * dome(u, 0.85, 2.2); } }, /one bulge only/],
  [{ id: 'x-saucer', name: 'a shallow funnel', kR: 1.1, kH: 0.72,
     f: function (u) { return u <= 0.3 ? u / 0.3 : dome(u, 0.3, 2); } }, /funnel opens by \d+ cells/],
  [{ id: 'x-pinch', name: 'an end pinched shut', kR: 1, kH: 1,
     f: function (u) { return u <= 0.6 ? u / 0.6 : Math.max(0, (0.97 - u) / 0.37); } }, /too pointed to pour into/],
  [{ id: 'x-open', name: 'an open neck', kR: 1, kH: 1,
     f: function (u) { return 0.1 + 0.9 * Math.min(1, u / 0.7) * dome(u, 0.8, 2); } }, /its neck is \d+ cells wide/],
  [{ id: 'x-fat', name: 'wider than R', kR: 1, kH: 1,
     f: function (u) { return 1.05 * Math.min(1, u / 0.7) * dome(u, 0.8, 2); } }, /wider than R/]
];
// a low, stubby glass that passes: at a small scale less than 0.78 of it fits under the neck
var STUB = { id: 'x-stub', name: 'a stub', kR: 0.9, kH: 0.62, f: function (u) { return u <= 0.72 ? u / 0.72 : dome(u, 0.72, 2.2); } };

/* ---- the classic glass, and the registry ----------------------------------- */

var IDS = P.SHAPE_ORDER || [];
var base = null;                      // f446085
var classicCap = 0;

test('the classic glass: makeGeometry(1.08) and profile() give the numbers they always gave', function () {
  var g = P.makeGeometry(1.08), k, u;
  var want = { q: 1.08, R: 95, HB: 222, RN: 3.5, W: 207, H: 453, cx: 103.5, cy: 226.5, gateY: 226, equator: 0.66,
               wall: 2.8080000000000003, capHalf: 120.92, slabH: 11.88, collarH: 5.4, postX: 112.28, AW: 252.64000000000001, AH: 485.04 };
  for (k in want) ok(g[k] === want[k], 'makeGeometry(1.08).' + k + ' is ' + g[k] + ', was ' + want[k]);
  ok(g.shape === null, 'makeGeometry(1.08).shape is ' + g.shape);
  var pins = [[-0.2, 3.5], [0, 3.5], [0.1, 17.81886666913654], [0.33, 60.629209551845726], [0.66, 95], [0.9, 70.5286198692412], [0.999, 7.806073845888095], [1, 0], [1.5, 0]];
  pins.forEach(function (p) { ok(P.profile(p[0], g) === p[1], 'profile(' + p[0] + ') is ' + P.profile(p[0], g) + ', was ' + p[1]); });
  // every other u, and every scale's geometry, against the build before motion
  base = L.baseline();
  var n = 0;
  [1, 1.08, 1.3, 1.08 * Math.SQRT2, 2.16, 2.6].forEach(function (q) {
    var a = P.makeGeometry(q), b = base.makeGeometry(q), c = P.makeGeometry(q, 'classic'), d = P.makeGeometry(q, null);
    for (k in b) ok(a[k] === b[k] && c[k] === b[k] && d[k] === b[k], 'makeGeometry(' + q + ').' + k + ' is ' + a[k] + ', f446085 has ' + b[k]);
    for (k = 0; k <= 4000; k++) {
      u = -0.1 + 1.2 * k / 4000;
      // (b has no `shape` key at all: profile must take it for the classic glass)
      ok(P.profile(u, a) === base.profile(u, b) && P.profile(u, b) === base.profile(u, b), 'profile(' + u + ') at scale ' + q + ' is ' + P.profile(u, a) + ', f446085 gives ' + base.profile(u, b));
      n++;
    }
  });
  ok(P.makeGeometry().q === 1 && P.makeGeometry().R === 88, 'makeGeometry() is not the scale-1 glass');
  return '17 fields and 9 values of profile pinned; ' + n + ' more values at 6 scales identical to ' + L.BASELINE_REV;
});

test('the classic glass: its lattice, capacity, pour cap and fill limit are untouched, at every pace', function () {
  var out = [];
  [1.08, 1.3].forEach(function (q) {
    var a = new Sim({ scale: q, seed: 3, shape: 'classic' }), b = new base.Sim({ scale: q, seed: 3 }), c = new Sim({ scale: q, seed: 3, shape: null }), i;
    ok(a.W === b.W && a.H === b.H, 'grid ' + a.W + 'x' + a.H + ', f446085 has ' + b.W + 'x' + b.H);
    for (i = 0; i < a.cell.length; i++) ok(a.cell[i] === b.cell[i] && c.cell[i] === b.cell[i] && a.seed[i] === b.seed[i], 'cell ' + i + ' differs from f446085 at scale ' + q);
    ok(a.rng === b.rng, 'the random stream differs from f446085 after the fill');
    ok(a.capacity === b.capacity && a.maxTotal === b.maxTotal && a.defaultGrains === b.defaultGrains, 'capacity, maxTotal or defaultGrains differ from f446085 at scale ' + q);
    ok(a.fillMax === 0.78 && a.geo.shape === null, 'fillMax ' + a.fillMax);
    [60000, 300000, 2700000, 7200000].forEach(function (ms) {
      ok(Clock.grainsFor(a, ms) === Clock.grainsFor(b, ms), 'grainsFor(' + ms + ') is ' + Clock.grainsFor(a, ms) + ', f446085 gets ' + Clock.grainsFor(b, ms));
    });
    out.push(a.capacity + ' cells, at most ' + a.maxTotal + ' grains at scale ' + q);
  });
  ok(new Sim({ scale: 1.08, seed: 3, shape: 'classic' }).capacity === 28099 && new Sim({ scale: 1.08, seed: 3, shape: 'classic' }).maxTotal === 24165, 'the phone glass no longer holds 28099 cells, 24165 grains at most');
  // finer sand: the same integers the old lines give
  [Math.SQRT2, 1.414, 2].forEach(function (p) {
    var PP = L.loadIsolated(SRC, 'physics.js');
    PP.Sim.setPace(p);
    [1.08, 1.3].forEach(function (q) {
      var s = new PP.Sim({ scale: q * p, seed: 3 });
      ok(s.maxTotal === Math.round(s.capacity * 0.86) && s.defaultGrains === Math.round(s.capacity * 0.62) && s.fillMax === 0.78,
        'pace ' + p + ', scale ' + q + ': maxTotal ' + s.maxTotal + ', defaultGrains ' + s.defaultGrains + ', fillMax ' + s.fillMax);
      ok(latticeFault(s, p) === '', 'pace ' + p + ', scale ' + q + ': ' + latticeFault(s, p));
    });
  });
  return out.join('; ') + '; fillMax 0.78; the same at paces 1.414 and 2';
});

test('the registry: every record is whole, its f pure, 0 at the neck and 1 at its widest; an unknown id is refused', function () {
  ok(P.SHAPES && IDS.length > 1 && IDS[0] === 'classic' && P.SHAPES.classic === null, 'SHAPES / SHAPE_ORDER: classic must come first, as null');
  ok(Object.keys(P.SHAPES).sort().join() === IDS.slice().sort().join(), 'SHAPE_ORDER [' + IDS + '] and SHAPES {' + Object.keys(P.SHAPES) + '} differ');
  IDS.slice(1).forEach(function (id) {
    var s = P.SHAPES[id], k, m = 0, at = 0, v;
    ok(s && s.id === id && typeof s.name === 'string' && s.name && typeof s.f === 'function', id + ': not { id, name, kR, kH, f }');
    ok(s.kR >= 0.60 && s.kR <= 1.15 && s.kH >= 0.60 && s.kH <= 1.10, id + ': kR ' + s.kR + ', kH ' + s.kH + ' (0.60 to 1.15 and 0.60 to 1.10)');
    ok(s.f(0) === 0, id + ': f(0) is ' + s.f(0));
    for (k = 0; k <= 5000; k++) {
      v = s.f(k / 5000);
      ok(v === s.f(k / 5000), id + ': f(' + k / 5000 + ') gave two answers');
      ok(v >= 0 && v <= 1, id + ': f(' + k / 5000 + ') is ' + v);
      if (v > m) { m = v; at = k / 5000; }
    }
    ok(m > 1 - 1e-6, id + ': the largest f is ' + m);
    var g = P.makeGeometry(Q, id);
    ok(g.shape === s && g.R === Math.round(88 * Q * s.kR) && g.HB === Math.round(206 * Q * s.kH), id + ': R ' + g.R + ', HB ' + g.HB);
    ok(g.W === 2 * (g.R + 8) + 1 && g.H === 2 * (g.HB + 4) + 1 && g.RN === 3.5 && g.gateY === (g.H - 1) / 2, id + ': grid ' + g.W + 'x' + g.H);
    ok(s.f(g.equator) > 1 - 1e-6, id + ': equator ' + g.equator + ' is not where f is largest (' + at + ')');
    ok(P.profile(0, g) === g.RN && P.profile(1, g) === 0 && P.profile(-1, g) === g.RN && P.profile(g.equator, g) > g.R - 1e-4, id + ': profile at the neck, the end or the equator');
  });
  var threw = 0;
  ['nope', 'Classic', '', 'toString', 7].forEach(function (id) {
    try { P.makeGeometry(1.08, id); } catch (e) { if (/no glass shape/.test(e.message)) threw++; }
    try { new Sim({ scale: 1.08, shape: id }); } catch (e2) { if (/no glass shape/.test(e2.message)) threw++; }
  });
  ok(threw === 10, 'unknown ids were refused ' + threw + ' times of 10');
  return IDS.length + ' shapes: ' + IDS.join(', ');
});

/* ---- every shape, the classic first ----------------------------------------- */

var FINE = {};                        // isolated copies of physics.js at the finer paces
function finer(p) {
  var key = p.toFixed(3);
  if (!FINE[key]) { FINE[key] = L.loadIsolated(SRC, 'physics.js'); FINE[key].Sim.setPace(p); }
  return FINE[key];
}

IDS.forEach(function (id) {
  var classic = id === 'classic';

  test(id + ': the lattice holds what the sand needs; capacity, fillMax and maxTotal as specified', function () {
    var sim = glass(id, 1), fault = latticeFault(sim, 1), cap = sim.capacity;
    ok(fault === '', fault);
    if (classic) classicCap = cap;
    ok(classicCap > 0 && cap >= 0.65 * classicCap && cap <= 1.25 * classicCap, 'capacity ' + cap + ' is ' + f3(cap / classicCap) + ' of the classic glass (0.65 to 1.25)');
    var share = heapMax(sim, 30) / cap, share6 = heapMax(sim, 6) / cap;
    ok(sim.fillMax === Math.min(0.78, share), 'fillMax is ' + sim.fillMax + ', ' + f3(share) + ' of it fits under the neck with 30 rows of fall');
    ok(sim.maxTotal === Math.round(cap * Math.min(0.86, share6)), 'maxTotal is ' + sim.maxTotal + ', ' + f3(share6) + ' of ' + cap + ' fits with 6 rows of fall');
    if (classic) ok(sim.fillMax === 0.78 && sim.maxTotal === Math.round(cap * 0.86), 'the classic glass: fillMax ' + sim.fillMax + ', maxTotal ' + sim.maxTotal);
    ok(sim.defaultGrains === Math.round(cap * Math.min(0.62, sim.fillMax)) && sim.total === sim.defaultGrains, 'defaultGrains ' + sim.defaultGrains + ', filled with ' + sim.total);
    return sim.W + 'x' + sim.H + ', ' + cap + ' cells (' + f3(cap / classicCap) + ' of the classic), widest at u = ' + sim.geo.equator.toFixed(2) + '; ' + f3(share) +
      ' fits under the neck with 30 rows of fall: fillMax ' + sim.fillMax + ', maxTotal ' + sim.maxTotal;
  });

  test(id + ': the same rules hold at every size the app builds', function () {
    var n = 0;
    [1, Math.SQRT2, 2].forEach(function (p) {
      var PP = p > 1 ? finer(p) : P;
      [1.08, 1.3].forEach(function (q) {
        var sim = glass(id, 1, PP, q * p), fault = latticeFault(sim, p);
        ok(fault === '', 'scale ' + q + ', pace ' + p.toFixed(3) + ': ' + fault);
        ok(sim.fillMax === Math.min(0.78, heapMax(sim, Math.round(30 * p)) / sim.capacity) && sim.maxTotal === Math.round(sim.capacity * Math.min(0.86, heapMax(sim, Math.round(6 * p)) / sim.capacity)),
          'scale ' + q + ', pace ' + p.toFixed(3) + ': fillMax ' + sim.fillMax + ', maxTotal ' + sim.maxTotal);
        n++;
      });
    });
    return n + ' sizes';
  });

  test(id + ': a one-minute glass keeps its clock', function () {
    var sim = glass(id, 99), r = clockRun(sim, 60000, 0);
    ok(r.censusBad === 0, 'the census was wrong ' + r.censusBad + ' times');
    ok(r.maxLag <= 40, 'the neck fell ' + r.maxLag + ' grains behind the clock (at most 40)');
    ok(r.left >= 0 && r.left <= 2, r.left + ' grains above the neck at 00:00, before any deep release (at most 2)');
    ok(r.rest >= 0 && r.rest <= 3 && sim.nTop === 0, 'not all below and at rest 3 s after 00:00 (' + sim.nTop + ' above, ' + sim.np + ' in the air)');
    return r.total + ' grains; the neck at most ' + r.maxLag + ' behind; ' + r.left + ' above at 00:00; at rest ' + r.rest.toFixed(2) + ' s later';
  });

  test(id + ': a 45-minute glass runs freely, and all of it fits under the neck', function () {
    var sim = glass(id, 99), r = clockRun(sim, 2700000, 0, 60);
    ok(r.censusBad === 0, 'the census was wrong ' + r.censusBad + ' times');
    ok(r.maxLag <= 40, 'the neck fell ' + r.maxLag + ' grains behind the clock (at most 40)');
    var above = sim.nTop, moved = sim.fastForward(above);
    steps(sim, 600);
    var top = heapTop(sim);
    ok(moved === above && sim.nTop === 0, 'only ' + moved + ' of ' + above + ' grains passed the neck: the lower bulb is full');
    ok(censusOk(sim), 'the census is wrong after the fast-forward');
    ok(top >= 20, 'the heap of ' + sim.total + ' grains ends ' + top + ' rows under the neck (at least 20)');
    return r.total + ' grains (' + f3(r.total / sim.capacity) + ' of capacity); the neck at most ' + r.maxLag + ' behind in 60 s; all of it below, the heap ends ' + top + ' rows under the neck';
  });

  test(id + ': leaned 12 degrees for the whole minute, it still empties on time', function () {
    var sim = glass(id, 99), r = clockRun(sim, 60000, 12);
    ok(r.censusBad === 0, 'the census was wrong ' + r.censusBad + ' times');
    ok(r.left >= 0 && r.left <= 15, r.left + ' grains above the neck at 00:00 (at most 15; the classic glass leaves 1)');
    return r.left + ' above the neck at 00:00, the neck at most ' + r.maxLag + ' behind';
  });

  test(id + ': the Flip at half run conserves the sand, and the glass comes to rest', function () {
    var sim = glass(id, 7), run = H.glassAt({ sim: sim, durMs: 60000, startMs: 30000 }), total = sim.total, k, rest = -1, bad = 0;
    sim.gateOpen = false;
    var tn = new H.Turner(sim, H.LAM), before = sim.nTop;
    tn.flip();
    for (k = 0; tn.busy(); k++) {
      if ((k & 1) === 0) sim.beginFrame();
      tn.step(); sim.step();
      if (k % 30 === 29 && !censusOk(sim)) bad++;
    }
    ok(tn.swaps === 1 && sim.nTop === total - before, 'after the turn ' + sim.nTop + ' grains are above the neck, ' + (total - before) + ' were below it');
    for (k = 0; k < 1200 && rest < 0; k++) {
      if ((k & 1) === 0) sim.beginFrame();
      sim.setMotion(0, 0, 0, 0, H.LAM, 0);
      sim.step();
      if (k % 30 === 29 && !censusOk(sim)) bad++;
      if (sim.quiet >= 24 && sim.np === 0) rest = (k + 1) * DT;
    }
    ok(bad === 0 && censusOk(sim) && sim.total === total, 'the census was wrong ' + bad + ' times; ' + sim.total + ' grains of ' + total);
    ok(rest >= 0, 'not at rest 10 s after the turn');
    ok(run.T.sim === sim, 'the clock lost its glass');
    return total + ' grains, ' + sim.nTop + ' above the neck after the turn; at rest ' + rest.toFixed(2) + ' s after it';
  });

  test(id + ': a pour adds sand and conserves it; a glass filled to its cap still passes all of it', function () {
    var sim = glass(id, 3);
    sim.reset(Clock.grainsFor(sim, 2700000));
    steps(sim, 300);
    var total = sim.total, top = sim.nTop, made = sim.pour(300), k, bad = 0;
    ok(made > 0 && made <= 300, 'pour(300) made ' + made + ' grains');
    ok(sim.total === total + made && sim.nTop === top + made, 'the pour of ' + made + ' took the glass from ' + total + ' to ' + sim.total + ' grains');
    for (k = 0; k < 600; k++) {
      if ((k & 1) === 0) sim.beginFrame();
      sim.step();
      if (k % 30 === 29 && !censusOk(sim)) bad++;
    }
    ok(bad === 0 && sim.np === 0 && sim.total === total + made, 'the census was wrong ' + bad + ' times; ' + sim.np + ' grains still in the air after 5 s');
    // to the cap, in pours, then all of it through the neck
    var guard = 0;
    while (sim.total < sim.maxTotal && guard++ < 400) {
      if (!sim.pour(300)) steps(sim, 60);
      steps(sim, 12);
    }
    steps(sim, 600);
    ok(sim.total === sim.maxTotal && sim.np === 0 && censusOk(sim), 'pours filled it to ' + sim.total + ' of ' + sim.maxTotal + ' grains (' + sim.np + ' in the air)');
    ok(sim.pour(300) === 0, 'a pour into a glass at its cap made grains');
    var above = sim.nTop, moved = sim.fastForward(above);
    steps(sim, 600);
    ok(moved === above && sim.nTop === 0 && censusOk(sim), 'filled to its cap, only ' + moved + ' of ' + above + ' grains passed the neck');
    return 'pour(300) made ' + made + '; filled to its cap of ' + sim.maxTotal + ' by pours, all of it passes: the heap ends ' + heapTop(sim) + ' rows under the neck';
  });

  test(id + ': shaken hard for 3 s, no sand is lost and none is written into the glass', function () {
    var sim = glass(id, 11), w0 = wallMap(sim), n = sim.cell.length, broke = 0;
    var run = H.glassAt({ sim: sim, durMs: 300000, startMs: 150000 });
    var rec = H.drive(run, 'veryVigorous', { dur: 3, clock: false, census: 1, each: function () {
      var c = sim.cell;
      for (var j = 0; j < n; j++) if ((c[j] === WALL ? 1 : 0) !== w0[j]) { broke++; break; }
    } });
    ok(rec.steps === 360 && rec.censusChecks === 360, 'the shake ran ' + rec.steps + ' steps');
    ok(rec.maxAir > 50 && rec.thumps > 0, 'the beds never flew (' + rec.maxAir + ' columns in the air at most): this case could not tell');
    ok(rec.censusErr === 0 && rec.conserveErr === 0, 'the census was off by ' + rec.censusErr + ', the total by ' + rec.conserveErr);
    ok(broke === 0, 'glass and sand changed places in ' + broke + ' steps');
    sim.setMotion(0, 0, 0, 0, H.LAM, 0);
    steps(sim, 600);
    ok(censusOk(sim), 'the census is wrong after the shake');
    return sim.total + ' grains, up to ' + rec.maxAir + ' columns in the air, ' + rec.thumps + ' landings heard, ' + rec.slams + ' slams; census exact at every step, the glass untouched';
  });

  test(id + ': layered sand keeps each tone\'s count through a run, the Flip, a shake, a pour and a fast-forward', function () {
    var sim = new Sim({ scale: Q, seed: 21, shape: id, layers: true });
    sim.reset(Clock.grainsFor(sim, 300000));
    var t0 = sim.tones(), T = new Clock(sim, 300000), now = 0, k;
    function same(when) {
      var t = sim.tones();
      ok(t[0] === t0[0] && t[1] === t0[1] && t[0] + t[1] === sim.total, when + ': tones ' + t.join(' + ') + ', were ' + t0.join(' + ') + ' (' + sim.total + ' grains)');
      ok(censusOk(sim), when + ': the census is wrong');
    }
    ok(t0[0] + t0[1] === sim.total && t0[1] > 0.1 * sim.total && t0[1] <= t0[0], 'the fill is laid ' + t0.join(' + ') + ' of ' + sim.total);
    T.start();
    for (k = 0; k < 3600; k++) {
      T.tick(DT_MS, false); T.apply(now, false, true);
      if ((k & 1) === 0) sim.beginFrame();
      sim.step(); now += DT_MS;
    }
    same('after 30 s of flow');
    sim.gateOpen = false;
    var tn = new H.Turner(sim, H.LAM);
    tn.flip();
    for (k = 0; tn.busy(); k++) { if ((k & 1) === 0) sim.beginFrame(); tn.step(); sim.step(); }
    same('after the Flip');
    sim.setMotion(0, 0, 0, 0, H.LAM, 0);
    steps(sim, 720);
    same('settled in its new pattern');
    H.drive({ sim: sim, T: null }, 'vigorous', { dur: 2, clock: false, census: 30 });
    sim.setMotion(0, 0, 0, 0, H.LAM, 0);
    steps(sim, 480);
    same('after the shake');
    var made = sim.pour(500), t1 = sim.tones();
    ok(made === 500 && t1[0] + t1[1] === sim.total && t1[0] >= t0[0] && t1[1] >= t0[1], 'the pour made ' + made + ': tones ' + t1.join(' + ') + ', were ' + t0.join(' + '));
    t0 = t1;
    steps(sim, 600);
    same('after the pour');
    var moved = sim.fastForward(sim.nTop >> 1);
    steps(sim, 300);
    ok(moved > 0, 'the fast-forward moved nothing');
    same('after the fast-forward');
    return sim.total + ' grains, ' + t0.join(' + ') + ' at the end, every count kept';
  });

  test(id + ': Finest sand (pace 2, scale 2.16) keeps the one-minute clock', function () {
    var sim = glass(id, 99, finer(2), 2.16), r = clockRun(sim, 60000, 0);
    ok(r.censusBad === 0, 'the census was wrong ' + r.censusBad + ' times');
    ok(r.maxLag <= 160, 'the neck fell ' + r.maxLag + ' grains behind the clock (at most 160: four times the grains)');
    ok(r.left >= 0 && r.left <= 8, r.left + ' grains above the neck at 00:00 (at most 8)');
    // (four times the grains: the last of it is below as soon, but the heap takes longer to lie still: 4.7 s in the classic glass)
    ok(r.below >= 0 && r.below <= 3 && sim.nTop === 0, 'not all below 3 s after 00:00 (' + sim.nTop + ' above, ' + sim.np + ' in the air)');
    ok(r.rest >= 0 && r.rest <= 8, 'not at rest 8 s after 00:00');
    return r.total + ' grains on ' + sim.W + 'x' + sim.H + '; the neck at most ' + r.maxLag + ' behind; ' + r.left + ' above at 00:00; all below ' + r.below.toFixed(2) + ' s later, at rest ' + r.rest.toFixed(2) + ' s later';
  });
});

/* ---- controls ---------------------------------------------------------------- */

test('glasses the sand cannot use are refused, by name and by rule', function () {
  var out = [];
  BAD.forEach(function (bad) {
    var rec = bad[0], msg = '';
    withShape(rec, function () {
      try { new Sim({ scale: Q, seed: 1, shape: rec.id }); } catch (e) { msg = e.message; }
    });
    ok(msg.indexOf('"' + rec.id + '"') >= 0 && bad[1].test(msg), rec.name + ': ' + (msg ? 'refused with "' + msg + '"' : 'accepted'));
    out.push(rec.name);
  });
  ok(!P.SHAPES['x-beads'], 'a made-up shape was left in the registry');
  // and none of it touches the classic glass
  var saved = Sim.prototype._checkShape, called = 0;
  Sim.prototype._checkShape = function () { called++; };
  try { new Sim({ scale: Q, seed: 1 }); new Sim({ scale: Q, seed: 1, shape: 'classic' }); } finally { Sim.prototype._checkShape = saved; }
  ok(called === 0, 'the classic glass was checked ' + called + ' times');
  return out.join(', ');
});

test('the suite can tell: a two-bulge glass, let through unchecked and shaken, has sand written into its glass', function () {
  var rec0 = BAD[0][0], saved = Sim.prototype._checkShape;
  return withShape(rec0, function () {
    var sim;
    Sim.prototype._checkShape = function () {};
    try { sim = new Sim({ scale: Q, seed: 11, shape: rec0.id }); } finally { Sim.prototype._checkShape = saved; }
    ok(/spans/.test(latticeFault(sim, 1)), 'this suite found: ' + (latticeFault(sim, 1) || 'no fault'));
    var w0 = wallMap(sim), n = sim.cell.length, worst = 0;
    var run = H.glassAt({ sim: sim, durMs: 300000, startMs: 150000 });
    var rec = H.drive(run, 'veryVigorous', { dur: 3, clock: false, census: 1, each: function () {
      var c = sim.cell, m = 0;
      for (var j = 0; j < n; j++) if ((c[j] === WALL ? 1 : 0) !== w0[j]) m++;
      if (m > worst) worst = m;
    } });
    ok(worst > 0, 'no cell of glass was overwritten: the shake case could not tell');
    return 'up to ' + worst + ' cells of glass overwritten in 3 s (the census alone, off by ' + rec.censusErr + ', would not have said)';
  });
});

test('a small glass that fits less than 0.78 under its neck says so, and the clock\'s fullest glass obeys', function () {
  return withShape(STUB, function () {
    var sim = new Sim({ scale: 0.6, seed: 5, shape: STUB.id }), cap = sim.capacity, share = heapMax(sim, 30) / cap;
    ok(latticeFault(sim, 1) === '', latticeFault(sim, 1));
    ok(share < 0.75, 'the stub fits ' + f3(share) + ' under its neck: it no longer tells');
    ok(sim.fillMax === share, 'fillMax is ' + sim.fillMax + ', ' + share + ' fits');
    ok(sim.maxTotal === Math.round(cap * Math.min(0.86, heapMax(sim, 6) / cap)), 'maxTotal ' + sim.maxTotal);
    var n = Clock.grainsFor(sim, 4 * 3600000);
    ok(n === Math.round(cap * share), 'a four-hour glass takes ' + n + ' grains, ' + Math.round(cap * share) + ' fit');
    ok(Clock.grainsFor(sim, 60000) === Math.round(cap * 0.36), 'a one-minute glass takes ' + Clock.grainsFor(sim, 60000));
    // the classic glass of that size is held to 0.78 as it always was
    var c = new Sim({ scale: 0.6, seed: 5, shape: 'classic' });
    ok(c.fillMax === 0.78 && Clock.grainsFor(c, 4 * 3600000) === Math.round(c.capacity * 0.78), 'the classic glass at scale 0.6: fillMax ' + c.fillMax);
    sim.reset(n);
    steps(sim, 300);
    var moved = sim.fastForward(sim.nTop);
    steps(sim, 600);
    var top = heapTop(sim);
    ok(moved === n && sim.nTop === 0 && censusOk(sim), 'only ' + moved + ' of ' + n + ' grains passed the neck');
    ok(top >= 20, 'its fullest glass ends ' + top + ' rows under the neck (at least 20)');
    return 'scale 0.6, ' + cap + ' cells: fillMax ' + f3(sim.fillMax) + '; its fullest glass, ' + n + ' grains, ends ' + top + ' rows under the neck';
  });
});

test('HOURGLASS_SHAPE gives every Sim of a suite the shape, unless the suite names one', function () {
  var id = IDS[IDS.length - 1];
  var code = 'var L = require(' + JSON.stringify(path.join(__dirname, 'lib', 'load-physics.js')) + '), S = L.P.Sim;' +
    'var a = new S({ scale: 1.08, seed: 1 }), b = new S({ scale: 1.08, seed: 1, shape: "classic" }), c = new S();' +
    'console.log([a.geo.shape && a.geo.shape.id, b.geo.shape, c.geo.shape && c.geo.shape.id, a instanceof S, typeof S.setPace, S.DT].map(String).join(" "));';
  function child(env) {
    var e = {}, k;
    for (k in process.env) e[k] = process.env[k];
    delete e.HOURGLASS_SHAPE; delete e.HOURGLASS_PACE;
    for (k in env) e[k] = env[k];
    var r = childProcess.spawnSync(process.execPath, ['-e', code], { env: e, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : 'exit ' + r.status + ': ' + String(r.stderr).split('\n').filter(function (l) { return /^Error/.test(l); })[0];
  }
  var set = child({ HOURGLASS_SHAPE: id }), unset = child({}), fine = child({ HOURGLASS_SHAPE: id, HOURGLASS_PACE: '2' }), bad = child({ HOURGLASS_SHAPE: 'nope' });
  ok(set === id + ' null ' + id + ' true function ' + Sim.DT, 'with HOURGLASS_SHAPE=' + id + ': ' + set);
  ok(unset === 'null null null true function ' + Sim.DT, 'unset: ' + unset);
  ok(fine === set, 'with HOURGLASS_PACE=2 as well: ' + fine);
  ok(/no glass shape "nope"/.test(bad), 'HOURGLASS_SHAPE=nope: ' + bad);
  return 'HOURGLASS_SHAPE=' + id + ' shapes every Sim but the one that asked for the classic; unset, none; an unknown id is refused';
});

console.log(failures ? 'shape: ' + failures + ' of ' + count + ' cases FAILED' : 'shape: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
