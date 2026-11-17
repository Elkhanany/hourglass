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
 *                          the classic; the pour cap (maxTotal) is what fits
 *                          under the neck with 6 rows of fall or what pours
 *                          can pile up under the end, whichever is less
 *                          (0.86 at most); fillMax is what fits with 30 rows
 *                          of fall (0.78 at most), never above the pour cap
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
 *   leaned 12 degrees      for the whole one-minute run: the neck never more
 *                          than 40 grains behind, at most 15 grains above
 *                          the neck at 00:00 (the classic leaves 1)
 *   the Flip               the button's turn at half run: census exact, and
 *                          the glass comes to rest
 *   a pour                 pour(300) into a 45-minute glass adds grains and
 *                          conserves them; pours fill the glass to exactly
 *                          its cap (maxTotal), from a 45-minute glass and
 *                          from a one-minute one (the sand then lies as a
 *                          pile under the end), on several seeds each; filled
 *                          to its cap either way, all of it still passes the
 *                          neck. (A glass whose 45-minute fill is already its
 *                          cap, the delta: that glass takes no pour, and the
 *                          rest is done from a 20-minute one)
 *   a hard shake           3 s of 'veryVigorous' (lib/profiles.js), beds in
 *                          flight: census exact every step, and no cell of
 *                          glass ever becomes sand or sand glass (against the
 *                          wall map taken when the glass was built)
 *   hard jerks             5 s of 'hardJerks' near the end of a run, then
 *                          left alone: the glass goes quiet (a flying grain
 *                          that a bed came down on climbs out of the sand;
 *                          it used to wait under it for ever)
 *   layered sand           each tone's count kept through a run, the Flip, a
 *                          shake, a pour and a fast-forward
 *   Finest sand            the one-minute glass again at pace 2, scale 2.16
 *                          (four times the grains: all below within 3 s of
 *                          00:00, at rest within 8)
 *
 * and the controls:
 *
 *   refused                a glass for each rule of the engine's check, and
 *                          no other rule of it: an open neck, no bulb, a
 *                          pinched row beside the neck, a waist before the
 *                          widest part, two bulges, wider than R, a step at
 *                          the neck, a flat shoulder, a funnel of 1.2 cells a
 *                          row, a ledge in the funnel, a pinched end, bulbs
 *                          that differ (and a shallow saucer, which breaks
 *                          two). Each is refused by name, in that rule's own
 *                          words
 *   the suite can tell     the two-bulge glass, let through unchecked and
 *                          shaken, has sand written into its glass
 *   a small glass          where less than 0.78 fits under the neck, fillMax
 *                          says so, the clock's fullest glass and a new
 *                          Sim's own fill obey it, with Finest sand too (the
 *                          fall left is 30 rows of it); the classic glass
 *                          keeps 0.78 where that rule would give it less
 *   a flat end             where pours cannot fill the corners beside their
 *                          pile, the pour cap is the pile, the clock asks
 *                          for no more, and pours reach exactly that (held to
 *                          0.86 instead, they run dry short of it)
 *   a bead                 a glass so small that 6 rows of fall bind its cap
 *   HOURGLASS_SHAPE        the test library's switch gives every Sim the shape
 *
 * What the running cases cannot see (so nobody loosens a lattice rule on their
 * word): a flat shoulder right at the neck, and an end 7 cells wide. Let
 * through unchecked, both keep their clock upright and leaned and pass every
 * case here: the valve lifts grains off a shoulder across the whole row. Only
 * the lattice rule holds them (see 'refused'). A funnel of 1.2 cells a row is
 * seen by one case only, the leaned one: there the neck falls 62 grains behind.
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

/** What pours can pile up under the end of the upper bulb, at 34 degrees from the three rows they fall in, in grains. */
function pileMax(sim, pace) {
  var sum = 0, y0 = sim.topY + 3;
  for (var y = y0; y < sim.gateY; y++) {
    var w = sim.rowMax[y] - sim.rowMin[y] + 1;
    if (w > 0) sum += Math.min(w, 5.5 * pace + 2 * (y - y0) / Math.tan(34 * Math.PI / 180));
  }
  return sum;
}
/** The pour cap and the fill limit a glass that is not the classic one must have, from this suite's own sums. */
function limits(sim, pace) {
  var cap = sim.capacity;
  var max = Math.round(cap * Math.min(0.86, heapMax(sim, Math.round(6 * pace)) / cap, pileMax(sim, pace) / cap));
  return { maxTotal: max, fillMax: Math.min(0.78, heapMax(sim, Math.round(30 * pace)) / cap, max / cap) };
}
/** Pours of 300 grains until the glass is at its cap, or until 40 in a row, a good half second apart, have made nothing. */
function pourFull(sim) {
  var dry = 0;
  while (sim.total < sim.maxTotal && dry < 40) {
    if (sim.pour(300)) dry = 0; else { dry++; steps(sim, 60); }
    steps(sim, 12);
  }
  steps(sim, 600);
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

/** Shapes this suite makes up are registered only while fn runs (in PP, another copy of physics.js, when given). */
function withShape(rec, fn, PP) {
  (PP || P).SHAPES[rec.id] = rec;
  try { return fn(); } finally { delete (PP || P).SHAPES[rec.id]; }
}
function dome(u, c, n) { var w = (u - c) / (1 - c); return w <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow(w, n))); }
function cone(u, c) { return Math.min(1, u / c); }
var asked = 2;                        // the u x-twist was last asked for
// Each breaks one rule of the engine's check and no other (apart from x-beads,
// whose funnel also opens too fast at the neck: the bulge rule comes first;
// and from x-saucer, shallow all the way up: the row at the neck comes first).
// The pattern is that rule's own wording, so no other rule can stand in for it.
var BAD = [
  [{ id: 'x-open', name: 'an open neck', kR: 1, kH: 1,
     f: function (u) { return 0.1 + 0.9 * cone(u, 0.7) * dome(u, 0.8, 2); } }, /its neck is 25 cells wide, not 7/],
  [{ id: 'x-tube', name: 'no bulb', kR: 1, kH: 1,
     f: function (u) { return u < 0.01 ? 0 : -1; } }, /it has no bulb/],
  [{ id: 'x-collar', name: 'a pinched row beside the neck', kR: 1, kH: 1,
     f: function (u) { return u > 0 && u < 0.006 ? -0.02 : cone(u, 0.6) * dome(u, 0.8, 2.2); } }, /the rows beside the neck are narrower than the neck/],
  [{ id: 'x-waist', name: 'a waist before the widest part', kR: 1, kH: 1,
     f: function (u) { return cone(u, 0.9) * (1 - 0.2 * Math.exp(-Math.pow((u - 0.4) / 0.066, 2))) * dome(u, 0.9, 2); } }, /it narrows again between the neck and its widest row/],
  [{ id: 'x-beads', name: 'two bulges', kR: 1, kH: 1,
     f: function (u) { return cone(u, 0.25) * (1 - 0.45 * Math.exp(-Math.pow((u - 0.55) / 0.07, 2))) * dome(u, 0.85, 2.2); } }, /it widens again beyond its widest row/],
  [{ id: 'x-fat', name: 'wider than R', kR: 1, kH: 1,
     f: function (u) { return 1.05 * cone(u, 0.7) * dome(u, 0.8, 2); } }, /its widest row is 199 cells, wider than R = 95 allows/],
  [{ id: 'x-step', name: 'a step at the neck', kR: 1, kH: 1,
     f: function (u) { return u <= 0 ? 0 : Math.min(1, 0.03 + u / 0.6) * dome(u, 0.8, 2.2); } }, /its funnel opens by 3 cells in one row at the neck/],
  [{ id: 'x-shoulder', name: 'a flat shoulder', kR: 0.8, kH: 1,
     f: function (u) { return u < 0.004 ? 0 : dome(u, 0.8, 2.2); } }, /its funnel opens by 72 cells in one row at the neck/],
  // (R 76 and HB 222 at this scale: 1.2 cells a row is f' = 1.2 * 222 / 72.5; legal in the row at the neck)
  [{ id: 'x-funnel12', name: 'a funnel of 1.2 cells a row', kR: 0.8, kH: 1,
     f: function (u) { return cone(u, 72.5 / (1.2 * 222)) * dome(u, 0.8, 2.2); } }, /its funnel opens by 2 cells in one row \(row 223;/],
  [{ id: 'x-ledge', name: 'a ledge in the funnel', kR: 1, kH: 1,
     f: function (u) { return (u < 0.3 ? u / 0.6 : Math.min(1, 0.5 + 3 / 91.5 + (u - 0.3) / 0.6)) * dome(u, 0.7, 2.2); } }, /its funnel opens by 4 cells in one row \(row 159;/],
  [{ id: 'x-saucer', name: 'a shallow saucer', kR: 1.1, kH: 0.72,
     f: function (u) { return u <= 0.3 ? u / 0.3 : dome(u, 0.3, 2); } }, /its funnel opens by 2 cells in one row at the neck/],
  [{ id: 'x-pinch', name: 'an end pinched shut', kR: 1, kH: 1,
     f: function (u) { return u <= 0.6 ? u / 0.6 : Math.max(0, (0.97 - u) / 0.37); } }, /its end is 7 cells wide 3 rows in, too pointed to pour into/],
  // (an f that is not a function of u alone: 3 % narrower whenever u has gone up since it was last asked, as it does down the lower bulb)
  [{ id: 'x-twist', name: 'bulbs that differ', kR: 1, kH: 1,
     f: function (u) { var up = u > asked; asked = u; return cone(u, 0.6) * dome(u, 0.8, 2.2) * (up ? 0.97 : 1); } }, /its two bulbs are not mirror images/]
];
function bad(id) { return BAD.filter(function (b) { return b[0].id === id; })[0][0]; }
// a low, stubby glass that passes: at a small scale less than 0.78 of it fits under the neck
var STUB = { id: 'x-stub', name: 'a stub', kR: 0.9, kH: 0.62, f: function (u) { return u <= 0.72 ? u / 0.72 : dome(u, 0.72, 2.2); } };
// a cone that ends flat at its widest: pours leave the corners beside their pile empty
var FLAT = { id: 'x-flat', name: 'a flat end', kR: 1, kH: 0.8, f: function (u) { return cone(u, 0.8); } };
// two cones base to base, to be built very small: a funnel of a cell a row, and all of it within reach of a pile
var BEAD = { id: 'x-bead', name: 'a bead', kR: 0.76, kH: 0.6, f: function (u) { return u <= 0.5 ? u / 0.5 : 1 - 0.75 * (u - 0.5) / 0.5; } };
// widest at a corner, u = 0.6, which no even run of samples of f lands on
var KITE = { id: 'x-kite', name: 'a kite', kR: 1, kH: 1, f: function (u) { return u <= 0.6 ? u / 0.6 : (1 - u) / 0.4; } };

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
  // (0.5: a glass half the phone's size, where the rule for other shapes would give 0.7495, not 0.78)
  [0.5, 1.08, 1.3].forEach(function (q) {
    var a = new Sim({ scale: q, seed: 3, shape: 'classic' }), b = new base.Sim({ scale: q, seed: 3 }), c = new Sim({ scale: q, seed: 3, shape: null }), i;
    ok(a.W === b.W && a.H === b.H, 'grid ' + a.W + 'x' + a.H + ', f446085 has ' + b.W + 'x' + b.H);
    for (i = 0; i < a.cell.length; i++) ok(a.cell[i] === b.cell[i] && c.cell[i] === b.cell[i] && a.seed[i] === b.seed[i], 'cell ' + i + ' differs from f446085 at scale ' + q);
    ok(a.rng === b.rng, 'the random stream differs from f446085 after the fill');
    ok(a.capacity === b.capacity && a.maxTotal === b.maxTotal && a.defaultGrains === b.defaultGrains, 'capacity, maxTotal or defaultGrains differ from f446085 at scale ' + q);
    ok(a.fillMax === 0.78 && c.fillMax === 0.78 && a.geo.shape === null, 'fillMax ' + a.fillMax + ' at scale ' + q);
    if (q === 0.5) ok(heapMax(a, 30) / a.capacity < 0.76, 'at scale 0.5 the heap rule gives the classic glass ' + f3(heapMax(a, 30) / a.capacity) + ': this size no longer tells the constant from the rule');
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
    [0.5, 1.08, 1.3].forEach(function (q) {
      var s = new PP.Sim({ scale: q * p, seed: 3 });
      ok(s.maxTotal === Math.round(s.capacity * 0.86) && s.defaultGrains === Math.round(s.capacity * 0.62) && s.fillMax === 0.78,
        'pace ' + p + ', scale ' + q + ': maxTotal ' + s.maxTotal + ', defaultGrains ' + s.defaultGrains + ', fillMax ' + s.fillMax);
      if (q === 0.5) ok(heapMax(s, Math.round(30 * p)) / s.capacity < 0.77, 'pace ' + p + ', scale 0.5: the heap rule gives ' + f3(heapMax(s, Math.round(30 * p)) / s.capacity) + ': this size no longer tells');
      ok(latticeFault(s, p) === '', 'pace ' + p + ', scale ' + q + ': ' + latticeFault(s, p));
    });
  });
  return out.join('; ') + '; fillMax 0.78 at each, also where the heap rule would give less; the same at paces 1.414 and 2';
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
    // ... and the middle of it, where the widest part is a plateau
    var lo = -1, hi = -1;
    for (k = 0; k <= 5000; k++) if (s.f(k / 5000) >= m - 1e-9) { if (lo < 0) lo = k; hi = k; }
    ok(Math.abs(g.equator - (lo + hi) / 10000) <= 5e-4, id + ': equator ' + g.equator + ' is not the middle of its widest part, u = ' + lo / 5000 + ' to ' + hi / 5000);
    ok(P.profile(0, g) === g.RN && P.profile(1, g) === 0 && P.profile(-1, g) === g.RN && P.profile(g.equator, g) > g.R - 1e-4, id + ': profile at the neck, the end or the equator');
  });
  // a glass widest at a corner has its equator there, though no sample of f falls on it
  withShape(KITE, function () {
    var e = P.makeGeometry(Q, KITE.id).equator;
    ok(Math.abs(e - 0.6) < 1e-9 && KITE.f(e) > 1 - 1e-6 && P.makeGeometry(1.3, KITE.id).equator === e, 'the kite\'s equator is ' + e + ' (f there: ' + KITE.f(e) + '), its corner is at 0.6');
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
    var share = heapMax(sim, 30) / cap, share6 = heapMax(sim, 6) / cap, pile = pileMax(sim, 1) / cap;
    var want = classic ? { fillMax: 0.78, maxTotal: Math.round(cap * 0.86) } : limits(sim, 1);
    ok(sim.maxTotal === want.maxTotal, 'maxTotal is ' + sim.maxTotal + ' of ' + cap + ': ' + f3(share6) + ' of it fits under the neck with 6 rows of fall, pours pile up ' + f3(pile));
    ok(sim.fillMax === want.fillMax, 'fillMax is ' + sim.fillMax + ': ' + f3(share) + ' fits under the neck with 30 rows of fall, the pour cap is ' + f3(sim.maxTotal / cap));
    ok(sim.defaultGrains === Math.round(cap * Math.min(0.62, sim.fillMax)) && sim.total === sim.defaultGrains, 'defaultGrains ' + sim.defaultGrains + ', filled with ' + sim.total);
    // the clock's fullest glass is laid whole (reset holds a fill to the pour cap), and what fits under the neck is not exceeded by either
    var full = Clock.grainsFor(sim, 4 * 3600000);
    sim.reset(full);
    ok(full === Math.round(cap * sim.fillMax) && sim.total === full && full <= sim.maxTotal, 'a four-hour glass asks for ' + full + ' grains, ' + sim.total + ' were laid, the pour cap is ' + sim.maxTotal);
    ok(sim.fillMax <= share && sim.maxTotal <= Math.round(cap * share6), 'fillMax ' + sim.fillMax + ' or maxTotal ' + sim.maxTotal + ' is more than fits under the neck (' + f3(share) + ', ' + f3(share6) + ')');
    return sim.W + 'x' + sim.H + ', ' + cap + ' cells (' + f3(cap / classicCap) + ' of the classic), widest at u = ' + sim.geo.equator.toFixed(2) + '; ' + f3(share) +
      ' fits under the neck with 30 rows of fall, pours pile up ' + f3(pile) + ': fillMax ' + sim.fillMax + ', maxTotal ' + sim.maxTotal + ' (' + f3(sim.maxTotal / cap) + ')';
  });

  test(id + ': the same rules hold at every size the app builds', function () {
    var n = 0, out = [];
    [1, Math.SQRT2, 2].forEach(function (p) {
      var PP = p > 1 ? finer(p) : P;
      [1.08, 1.3].forEach(function (q) {
        var sim = glass(id, 1, PP, q * p), fault = latticeFault(sim, p);
        ok(fault === '', 'scale ' + q + ', pace ' + p.toFixed(3) + ': ' + fault);
        var want = classic ? { fillMax: 0.78, maxTotal: Math.round(sim.capacity * 0.86) } : limits(sim, p);
        ok(sim.fillMax === want.fillMax && sim.maxTotal === want.maxTotal,
          'scale ' + q + ', pace ' + p.toFixed(3) + ': fillMax ' + sim.fillMax + ', maxTotal ' + sim.maxTotal + ' (this suite\'s sums give ' + want.fillMax + ' and ' + want.maxTotal + ')');
        out.push(f3(sim.maxTotal / sim.capacity));
        n++;
      });
    });
    return n + ' sizes; the pour cap is ' + out.join(', ') + ' of capacity';
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
    ok(r.maxLag <= 40, 'leaned, the neck fell ' + r.maxLag + ' grains behind the clock (at most 40; the classic glass reads 0, a funnel of 1.2 cells a row 62)');
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
    var sim = glass(id, 3), ms = 2700000, k, bad = 0;
    // (a glass that takes less by pours than 45 minutes ask for, the delta's, is laid at its cap by the clock
    // and has no room for a pour: there the 45-minute glass must say so, and the pour is tried on a 20-minute one)
    if (Clock.grainsFor(sim, ms) >= sim.maxTotal) {
      ok(!classic && sim.fillMax < 0.78, 'a 45-minute glass asks for ' + Clock.grainsFor(sim, ms) + ' grains, the pour cap is ' + sim.maxTotal + ', yet fillMax is ' + sim.fillMax);
      sim.reset(Clock.grainsFor(sim, ms));
      steps(sim, 300);
      ok(sim.total === sim.maxTotal && sim.pour(300) === 0 && sim.total === sim.maxTotal, 'the 45-minute glass, laid at its cap of ' + sim.maxTotal + ', holds ' + sim.total + ' or took a pour');
      ms = 1200000;
      ok(Clock.grainsFor(sim, ms) < sim.maxTotal - 600, 'a 20-minute glass leaves no room for a pour either');
    }
    sim.reset(Clock.grainsFor(sim, ms));
    steps(sim, 300);
    var total = sim.total, top = sim.nTop, made = sim.pour(300);
    ok(made > 0 && made <= 300, 'pour(300) made ' + made + ' grains');
    ok(sim.total === total + made && sim.nTop === top + made, 'the pour of ' + made + ' took the glass from ' + total + ' to ' + sim.total + ' grains');
    for (k = 0; k < 600; k++) {
      if ((k & 1) === 0) sim.beginFrame();
      sim.step();
      if (k % 30 === 29 && !censusOk(sim)) bad++;
    }
    ok(bad === 0 && sim.np === 0 && sim.total === total + made, 'the census was wrong ' + bad + ' times; ' + sim.np + ' grains still in the air after 5 s');
    // to the cap, in pours
    pourFull(sim);
    ok(sim.total === sim.maxTotal && sim.np === 0 && censusOk(sim), 'pours filled it to ' + sim.total + ' of ' + sim.maxTotal + ' grains (' + sim.np + ' in the air)');
    ok(sim.pour(300) === 0, 'a pour into a glass at its cap made grains');
    // and on other seeds, and from a one-minute glass: the sand then lies as a pile under the end, with room beside it
    var pile = null, runs = 1;
    [[2, ms], [4, ms], [1, 60000], [2, 60000], [3, 60000], [4, 60000]].forEach(function (c) {
      var s = glass(id, c[0]);
      s.reset(Clock.grainsFor(s, c[1]));
      steps(s, 300);
      pourFull(s);
      ok(s.total === s.maxTotal && s.np === 0 && censusOk(s), 'seed ' + c[0] + ', from a ' + c[1] / 60000 + '-minute glass: pours stopped at ' + s.total + ' of ' + s.maxTotal + ' grains (' + (s.maxTotal - s.total) + ' short)');
      runs++;
      if (!pile && c[1] === 60000) pile = s;
    });
    // all of it through the neck, from the level fill and from the pile
    var tops = [sim, pile].map(function (s) {
      var above = s.nTop, moved = s.fastForward(above);
      steps(s, 600);
      ok(moved === above && s.nTop === 0 && censusOk(s), 'filled to its cap, only ' + moved + ' of ' + above + ' grains passed the neck');
      return heapTop(s);
    });
    return 'pour(300) made ' + made + '; pours filled it to its cap of ' + sim.maxTotal + ' exactly in ' + runs + ' runs (' + ms / 60000 + '-minute and one-minute glasses, seeds 1 to 4)' +
      (ms < 2700000 ? ' (its 45-minute glass is its cap, and takes no pour)' : '') + '; all of it passes: the heap ends ' + tops.join(' and ') + ' rows under the neck';
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

  test(id + ': after hard jerks near the end of its run, left alone, the glass goes quiet', function () {
    // (seeds on which the classic glass kept a grain waiting under a landed bed for ever)
    var out = [], flew = 0;
    [4, 9, 10, 31].forEach(function (seed) {
      var sim = glass(id, seed), run = H.glassAt({ sim: sim, durMs: 300000, startMs: 270000 }), k, rest = -1;
      var rec = H.drive(run, 'hardJerks', { dur: 5, armed: false, census: 30 });
      flew += rec.maxAir;
      sim.setMotion(0, 0, 0, 0, H.LAM, 0); sim.gateOpen = false;
      for (k = 0; k < 1200; k++) {
        if ((k & 1) === 0) sim.beginFrame();
        sim.step();
        if (rest < 0 && sim.np === 0 && sim.quiet >= 24) rest = (k + 1) * DT;
      }
      ok(rec.censusErr === 0 && rec.conserveErr === 0 && censusOk(sim), 'seed ' + seed + ': the census was off by ' + rec.censusErr + ' in the jerks, or is wrong after them');
      ok(rest >= 0 && !sim.isActive(), 'seed ' + seed + ': not quiet 10 s after the jerks: ' + sim.np + ' grains in the air' +
        (sim.np ? ', one at rest inside the sand at ' + sim.px[0].toFixed(1) + ', ' + sim.py[0].toFixed(1) + ' (the floor is row ' + (sim.H - 6) + ')' : ''));
      out.push(rest.toFixed(2));
    });
    ok(flew > 200, 'the beds never left the glass in the jerks (' + flew + ' columns in the air): this case could not tell');
    return 'quiet ' + out.join(', ') + ' s after the jerks (seeds 4, 9, 10, 31), census exact';
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
  var rec0 = bad('x-beads'), saved = Sim.prototype._checkShape;
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

test('a small glass that fits less than 0.78 under its neck says so, and the clock\'s fullest glass obeys; with Finest sand too', function () {
  var out = withShape(STUB, function () {
    var sim = new Sim({ scale: 0.6, seed: 5, shape: STUB.id }), cap = sim.capacity, share = heapMax(sim, 30) / cap;
    ok(latticeFault(sim, 1) === '', latticeFault(sim, 1));
    ok(share < 0.62, 'the stub fits ' + f3(share) + ' under its neck: it no longer tells');
    ok(sim.fillMax === share, 'fillMax is ' + sim.fillMax + ', ' + share + ' fits');
    ok(sim.maxTotal === limits(sim, 1).maxTotal && sim.maxTotal > Math.round(cap * share), 'maxTotal ' + sim.maxTotal);
    // the fill a new Sim is laid with is held to it too (0.62 of capacity otherwise)
    ok(sim.defaultGrains === Math.round(cap * share) && sim.total === sim.defaultGrains, 'a new Sim holds ' + sim.total + ' grains, defaultGrains is ' + sim.defaultGrains + ', ' + Math.round(cap * share) + ' fit');
    var n = Clock.grainsFor(sim, 4 * 3600000);
    ok(n === Math.round(cap * share), 'a four-hour glass takes ' + n + ' grains, ' + Math.round(cap * share) + ' fit');
    ok(Clock.grainsFor(sim, 60000) === Math.round(cap * 0.36), 'a one-minute glass takes ' + Clock.grainsFor(sim, 60000));
    sim.reset(n);
    steps(sim, 300);
    var moved = sim.fastForward(sim.nTop);
    steps(sim, 600);
    var top = heapTop(sim);
    ok(moved === n && sim.nTop === 0 && censusOk(sim), 'only ' + moved + ' of ' + n + ' grains passed the neck');
    ok(top >= 20, 'its fullest glass ends ' + top + ' rows under the neck (at least 20)');
    return 'scale 0.6, ' + cap + ' cells: fillMax ' + f3(sim.fillMax) + ', a new Sim holds ' + sim.defaultGrains + '; its fullest glass, ' + n + ' grains, ends ' + top + ' rows under the neck';
  });
  // Finest sand: the fall left is 30 rows of it, 60 cells. The same glass, twice the cells across.
  var PP = finer(2);
  out += withShape(STUB, function () {
    var s = new PP.Sim({ scale: 1.2, seed: 5, shape: STUB.id }), cap = s.capacity, share = heapMax(s, 60) / cap;
    ok(latticeFault(s, 2) === '', latticeFault(s, 2));
    ok(share < 0.62 && heapMax(s, 30) / cap > 0.8, 'at pace 2 the stub fits ' + f3(share) + ' with 60 cells of fall, ' + f3(heapMax(s, 30) / cap) + ' with 30: it no longer tells them apart');
    ok(s.fillMax === share, 'pace 2: fillMax is ' + s.fillMax + ', ' + share + ' fits with 60 cells of fall');
    ok(s.maxTotal === limits(s, 2).maxTotal, 'pace 2: maxTotal ' + s.maxTotal);
    ok(s.defaultGrains === Math.round(cap * share) && s.total === s.defaultGrains, 'pace 2: a new Sim holds ' + s.total + ' grains, ' + Math.round(cap * share) + ' fit');
    return '; with Finest sand (pace 2, scale 1.2, ' + cap + ' cells) fillMax ' + f3(s.fillMax);
  }, PP);
  // the classic glass is held to 0.78 as it always was, also where this rule would give it less (0.7495 at scale 0.5)
  base = base || L.baseline();
  [0.5, 0.6].forEach(function (q) {
    var c = new Sim({ scale: q, seed: 5, shape: 'classic' }), b = new base.Sim({ scale: q, seed: 5 }), ms = 4 * 3600000;
    ok(c.fillMax === 0.78 && Clock.grainsFor(c, ms) === Math.round(c.capacity * 0.78) && Clock.grainsFor(c, ms) === Clock.grainsFor(b, ms) && c.maxTotal === b.maxTotal && c.total === b.total,
      'the classic glass at scale ' + q + ': fillMax ' + c.fillMax + ', a four-hour glass ' + Clock.grainsFor(c, ms) + ' grains (f446085: ' + Clock.grainsFor(b, ms) + ')');
  });
  return out + '; the classic glass keeps 0.78 at scales 0.5 and 0.6';
});

test('a flat-ended glass is held to what pours can pile up under its end, and the clock asks for no more', function () {
  return withShape(FLAT, function () {
    var sim = new Sim({ scale: Q, seed: 5, shape: FLAT.id }), cap = sim.capacity;
    var pile = pileMax(sim, 1) / cap, share = heapMax(sim, 30) / cap, share6 = heapMax(sim, 6) / cap;
    ok(latticeFault(sim, 1) === '', latticeFault(sim, 1));
    ok(pile < 0.75 && share > 0.8 && share6 > 0.9, 'pours pile up ' + f3(pile) + ' of it, ' + f3(share) + ' and ' + f3(share6) + ' fit under its neck: it no longer tells');
    ok(sim.maxTotal === Math.round(cap * pile), 'maxTotal is ' + sim.maxTotal + ', pours pile up ' + Math.round(cap * pile));
    ok(sim.fillMax === sim.maxTotal / cap, 'fillMax is ' + sim.fillMax + ', the pour cap is ' + sim.maxTotal / cap + ' of capacity');
    // the clock's fullest glass is the pour cap, laid whole, and takes no more
    var n = Clock.grainsFor(sim, 4 * 3600000);
    sim.reset(n);
    steps(sim, 300);
    ok(n === sim.maxTotal && sim.total === n && sim.pour(300) === 0, 'a four-hour glass asks for ' + n + ' grains, ' + sim.total + ' were laid, the cap is ' + sim.maxTotal);
    // pours reach it from a one-minute glass, exactly, and all of it passes the neck
    [1, 2, 3].forEach(function (seed) {
      var s = new Sim({ scale: Q, seed: seed, shape: FLAT.id });
      s.reset(Clock.grainsFor(s, 60000));
      steps(s, 300);
      pourFull(s);
      ok(s.total === s.maxTotal && s.np === 0 && censusOk(s), 'seed ' + seed + ': pours stopped at ' + s.total + ' of ' + s.maxTotal + ' grains');
      var above = s.nTop, moved = s.fastForward(above);
      steps(s, 600);
      ok(moved === above && s.nTop === 0 && censusOk(s), 'seed ' + seed + ': only ' + moved + ' of ' + above + ' grains passed the neck');
    });
    // and this glass tells: held to 0.86 of its capacity, as the classic glass is, the pours run dry short of it
    var old = new Sim({ scale: Q, seed: 1, shape: FLAT.id });
    old.maxTotal = Math.round(cap * 0.86);
    old.reset(Clock.grainsFor(old, 60000));
    steps(old, 300);
    pourFull(old);
    ok(old.total < old.maxTotal - 0.05 * cap && old.total >= sim.maxTotal && censusOk(old), 'held to 0.86, the pours stopped at ' + old.total + ' of ' + old.maxTotal + ': this glass could not tell');
    return cap + ' cells: pours pile up ' + f3(pile) + ' of it: maxTotal ' + sim.maxTotal + ', fillMax ' + f3(sim.fillMax) + '; pours from a one-minute glass reach it exactly (3 seeds); held to 0.86 they run dry ' +
      (old.maxTotal - old.total) + ' grains short, at ' + f3(old.total / cap);
  });
});

test('a bead of a glass is held to what fits under its neck with 6 rows of fall, of the sand it holds', function () {
  var out = [];
  [1, 2].forEach(function (p) {
    var PP = p > 1 ? finer(p) : P;
    withShape(BEAD, function () {
      var s = new PP.Sim({ scale: 0.3 * p, seed: 5, shape: BEAD.id }), cap = s.capacity;
      var share = heapMax(s, Math.round(6 * p)) / cap, pile = pileMax(s, p) / cap;
      ok(latticeFault(s, p) === '', 'pace ' + p + ': ' + latticeFault(s, p));
      ok(share < 0.85 && pile > 0.86 && (p === 1 || heapMax(s, 6) / cap > 0.86), 'pace ' + p + ': ' + f3(share) + ' fits under its neck with ' + Math.round(6 * p) + ' cells of fall, pours pile up ' + f3(pile) + ': it no longer tells');
      ok(s.maxTotal === Math.round(cap * share), 'pace ' + p + ': maxTotal is ' + s.maxTotal + ', ' + Math.round(cap * share) + ' fit under the neck');
      ok(s.fillMax === limits(s, p).fillMax && Math.round(cap * s.fillMax) <= s.maxTotal, 'pace ' + p + ': fillMax ' + s.fillMax);
      out.push('pace ' + p + ', scale ' + 0.3 * p + ', ' + cap + ' cells: ' + f3(share) + ' fits, maxTotal ' + s.maxTotal);
    }, PP);
  });
  return out.join('; ');
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
