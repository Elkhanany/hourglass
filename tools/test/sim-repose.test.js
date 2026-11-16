/*
 * Sand off the upright (sim.granular): what a leaned, turned, carried or
 * shaken glass does to its sand.
 *
 *   repose      held leans of 5, 10, 20, 30 and 45 degrees (and the other way):
 *               the free surface settles at 28 to 38 degrees to gravity and the
 *               sand comes to rest within 5 s, and stays at rest
 *   avalanches  after the Flip button's turn the steepest stretch of the new
 *               upper bulb is under 40 degrees within 3 s, and at rest by 6 s
 *   falling     sand let go (the phone turned over) gathers speed and
 *               stretches; it does not sink as a block at one speed
 *   momentum    a sideways jolt carries the bed on after it has ended; a glass
 *               carried by a finger and stopped dead (as app.js steps it)
 *               makes its sand surge and run back; a slow carry starts nothing
 *   shaking     four seconds of hard vertical shaking level a heap; walking
 *               does not
 *   the timer   a glass that runs while it leans still follows its clock
 *   the census  holds through all of it, and each tone keeps its count
 *   untouched   a glass that stands straight never reaches any of this code
 *
 * Every case that can is run against the engine without it too
 * (granular: false), which must fail the same check: that is the sand as it
 * was, and shows the check can tell the two apart.
 *
 * All angles are to gravity (or to the field the bed feels), read from the
 * lattice: one height per cell across the field, least squares over the
 * steepest 24-cell stretch; bins whose sand lies against the glass are left out.
 *
 *   node tools/test/sim-repose.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim, Clock = H.Clock, REST = P.REST, DT = Sim.DT, DT_MS = Clock.DT_MS;
var DEG = Math.PI / 180, TAU = 2 * Math.PI, WALL = 1;

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
function f1(v) { return (+v).toFixed(1); }

/* ---- glasses ---------------------------------------------------------- */

function steps(s, n, each) {
  for (var k = 0; k < n; k++) { if ((k & 1) === 0) s.beginFrame(); s.step(); if (each) each(s, k); }
}
/**
 * A 5-minute glass whose piles its own stream has built: run through its
 * clock-driven valve (at a 1-minute glass's rate) until `frac` of the sand
 * is below, then stopped and settled. o.granular false: the engine without
 * sand off the upright; o.layers: layered sand.
 */
function grown(frac, o) {
  o = o || {};
  var opts = { scale: 1.08, seed: o.seed || 4242 };
  if (o.granular === false) opts.granular = false;
  if (o.layers) opts.layers = true;
  var sim = new Sim(opts);
  sim.reset(Clock.grainsFor(sim, 300000));
  steps(sim, 300);
  var T = new Clock(sim, 60000), k = 0, now = 0;
  T.start();
  while (sim.nBottom < frac * sim.total && k < 400000) {
    T.tick(DT_MS, false); T.apply(now, false, true);
    if ((k & 1) === 0) sim.beginFrame();
    sim.step(); now += DT_MS; k++;
  }
  sim.gateOpen = false; sim.targetTop = sim.nTop;
  for (k = 0; (sim.np > 0 || sim.quiet < 60) && k < 6000; k++) { if ((k & 1) === 0) sim.beginFrame(); sim.step(); }
  return sim;
}
function censusOk(s) { var c = s.census(); return c.total === s.total && c.top === s.nTop; }

/* ---- reading the sand -------------------------------------------------- */

/**
 * The free surface of bulb b in the frame of the field (fx, fy): s across
 * the field and h up it, cells from the glass's centre, one point per cell
 * of s. A bin whose top grain lies under glass is not free surface.
 */
function surface(sim, b, fx, fy) {
  var W = sim.W, cell = sim.cell, g = sim.geo, gate = sim.gateY;
  var m = Math.sqrt(fx * fx + fy * fy), dx = fx / m, dy = fy / m, ax = dy, ay = -dx;
  var y0 = b ? gate + 1 : 1, y1 = b ? sim.H - 2 : gate - 1, bins = {}, at = {}, x, y, k;
  for (y = y0; y <= y1; y++) {
    for (x = sim.rowMin[y]; x <= sim.rowMax[y]; x++) {
      if (cell[y * W + x] < REST) continue;
      var rx = x + 0.5 - g.cx, ry = y + 0.5 - g.cy;
      k = Math.round(rx * ax + ry * ay);
      var h = -(rx * dx + ry * dy);
      if (bins[k] === undefined || h > bins[k]) { bins[k] = h; at[k] = [x, y]; }
    }
  }
  var keys = Object.keys(bins).map(Number).sort(function (p, q) { return p - q; }), s = [], hh = [];
  keys.forEach(function (key) {
    var c = at[key], free = true;
    for (var j = 1; j <= 2; j++) if (cell[Math.round(c[1] - j * dy) * W + Math.round(c[0] - j * dx)] === WALL) free = false;
    if (free) { s.push(key); hh.push(bins[key]); }
  });
  return { s: s, h: hh };
}
/** Least-squares slope of the surface over s in [a, b], degrees (+ rising toward +s); NaN with too few points. */
function fit(sf, a, b) {
  var n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (var i = 0; i < sf.s.length; i++) {
    var s = sf.s[i];
    if (s < a || s > b) continue;
    n++; sx += s; sy += sf.h[i]; sxx += s * s; sxy += s * sf.h[i];
  }
  if (n < 8) return NaN;
  return Math.atan((n * sxy - sx * sy) / (n * sxx - sx * sx)) / DEG;
}
/** The steepest 24-cell stretch of bulb b's free surface, degrees to the field. */
function steepest(sim, b, fx, fy) {
  var sf = surface(sim, b, fx, fy), n = sf.s.length, best = 0;
  if (n < 30) return 0;
  for (var s = sf.s[0] + 4; s + 24 <= sf.s[n - 1] - 4; s += 2) {
    var a = fit(sf, s, s + 24);
    if (a === a && Math.abs(a) > best) best = Math.abs(a);
  }
  return best;
}
/** The two flanks of the lower heap, degrees (least squares from the apex to 8 cells from the glass). */
function flanks(sim) {
  var sf = surface(sim, 1, 0, 1), n = sf.s.length, best = -1, bv = -1e9;
  for (var i = 3; i < n - 3; i++) {
    var v = 0;
    for (var j = -3; j <= 3; j++) v += sf.h[i + j];
    if (v > bv) { bv = v; best = i; }
  }
  var l = fit(sf, sf.s[0] + 8, sf.s[best] - 10), r = -fit(sf, sf.s[best] + 10, sf.s[n - 1] - 8);
  return [l === l ? l : 0, r === r ? r : 0];
}
/** Where the sand of bulb b is: its centroid (cells from the glass's centre) and the span that holds its middle 80 % along y. */
function bed(sim, b) {
  var W = sim.W, gate = sim.gateY, sx = 0, sy = 0, n = 0, ys = [], i, N = W * sim.H;
  for (i = 0; i < N; i++) {
    if (sim.cell[i] < REST) continue;
    var y = (i / W) | 0;
    if ((y < gate) !== (b === 0)) continue;
    sx += i % W; sy += y; n++; ys.push(y);
  }
  for (i = 0; i < sim.np; i++) {
    if ((sim.py[i] < gate) !== (b === 0)) continue;
    sx += sim.px[i] - 0.5; sy += sim.py[i] - 0.5; n++; ys.push(sim.py[i]);
  }
  ys.sort(function (p, q) { return p - q; });
  return { x: sx / n + 0.5 - sim.geo.cx, y: sy / n + 0.5 - sim.geo.cy, n: n, span: ys[Math.floor(0.9 * n)] - ys[Math.floor(0.1 * n)] };
}

/* ---- repose ------------------------------------------------------------ */

/** Lean the glass as app.js does (stepGravity: the tilt, and wakeAll) and hold it for `secs`. */
function hold(sim, lean, secs) {
  var r = { rest: -1, lastMove: 0, late: 0, census: true };
  sim.tilt = lean * DEG; sim.wakeAll();
  steps(sim, Math.round(secs * 120), function (s, k) {
    var t = (k + 1) / 120;
    if (r.rest < 0 && s.quiet >= 24) r.rest = t - 0.2;
    if (s.quiet === 0) { r.lastMove = t; if (t > secs - 2) r.late++; }
    if (k % 30 === 29 && !censusOk(s)) r.census = false;
  });
  r.lower = steepest(sim, 1, sim.gx, sim.gy);
  r.upper = steepest(sim, 0, sim.gx, sim.gy);
  return r;
}

test('a held lean settles at the angle of repose to gravity and comes to rest', function () {
  var out = [];
  [5, 10, 20, 30, 45, -10, -30].forEach(function (lean) {
    var sim = grown(0.5), r = hold(sim, lean, 8);
    ok(r.census, 'lean ' + lean + '°: the census broke');
    ok(r.rest >= 0 && r.rest <= 5, 'lean ' + lean + '°: at rest after ' + (r.rest < 0 ? 'more than 8' : f1(r.rest)) + ' s (want at most 5)');
    ok(r.late === 0, 'lean ' + lean + '°: ' + r.late + ' steps with a grain moving between 6 and 8 s');
    ok(!sim.isActive(), 'lean ' + lean + '°: the sim is still active after 8 s');
    ok(r.lower >= 28 && r.lower <= 38, 'lean ' + lean + '°: the lower surface lies at ' + f1(r.lower) + '° to gravity (want 28 to 38)');
    ok(r.upper <= 38, 'lean ' + lean + '°: the upper surface lies at ' + f1(r.upper) + '° to gravity (want at most 38)');
    out.push(lean + '° → ' + f1(r.lower) + '° (above ' + f1(r.upper) + '°), at rest in ' + f1(r.rest) + ' s');
  });
  return out.join('; ');
});

test('... and without it (granular: false) the same lean creeps and never rests', function () {
  var sim = grown(0.5, { granular: false }), r = hold(sim, 10, 8);
  ok(r.rest < 0 && r.late > 0, 'the engine without sand off the upright came to rest after ' + f1(r.rest) + ' s: this suite could not tell');
  return 'lean 10°: still moving in ' + r.late + ' of the last 240 steps, surface at ' + f1(r.lower) + '° and falling';
});

/* ---- thick avalanches ---------------------------------------------------- */

/** The Flip button as app.js turns it, then `secs` at rest. Returns when the new upper bulb first lay under 40°, and more. */
function flipAndWatch(sim, secs) {
  var tn = new H.Turner(sim, H.LAM), k = 0, after = 0, r = { below40: -1, rest: -1, at: {}, census: true, during: 0 };
  tn.flip();
  while (tn.busy() || after < secs * 120) {
    if (tn.busy()) tn.step(); else { after++; sim.setMotion(0, 0, 0, 0, H.LAM, 0); }
    if ((k & 1) === 0) sim.beginFrame();
    sim.step(); k++;
    if ((k & 1) === 0 && !censusOk(sim)) r.census = false;
    if (tn.busy() || after === 0) continue;
    var t = after / 120;
    if (after % 12 === 0) {
      var a = steepest(sim, 0, 0, 1);
      if (r.below40 < 0 && a < 40) r.below40 = t;
      if (after === 12 || after === 120 || after === 360) r.at[after / 120] = a;
    }
    if (r.rest < 0 && sim.quiet >= 24) r.rest = t - 0.2;
  }
  r.end = steepest(sim, 0, 0, 1);
  return r;
}

test('after the Flip the sand slumps to its angle of repose within 3 s', function () {
  var out = [];
  [[1.0, 'all the sand below'], [0.5, 'half run']].forEach(function (c) {
    var r = flipAndWatch(grown(c[0]), 6);
    ok(r.census, c[1] + ': the census broke during the turn');
    ok(r.below40 >= 0 && r.below40 <= 3, c[1] + ': under 40° after ' + (r.below40 < 0 ? 'more than 6' : f1(r.below40)) + ' s (want at most 3)');
    ok(r.at[3] <= 38, c[1] + ': ' + f1(r.at[3]) + '° 3 s after the turn (want at most 38)');
    ok(r.end >= 28 && r.end <= 38, c[1] + ': it ends at ' + f1(r.end) + '° (want 28 to 38)');
    ok(r.rest >= 0 && r.rest <= 6, c[1] + ': not at rest 6 s after the turn');
    out.push(c[1] + ': ' + f1(r.at[0.1]) + '° at 0.1 s, ' + f1(r.at[1]) + '° at 1 s, ' + f1(r.at[3]) + '° at 3 s; under 40° after ' + f1(r.below40) + ' s, at rest after ' + f1(r.rest) + ' s');
  });
  var old = flipAndWatch(grown(1.0, { granular: false }), 6);
  ok(old.below40 < 0 && old.at[3] > 60, 'without it the sand lay at ' + f1(old.at[3]) + '° after 3 s: this suite could not tell');
  out.push('without it: ' + f1(old.at[3]) + '° at 3 s, ' + f1(old.end) + '° at 6 s, not at rest');
  return out.join('; ');
});

/* ---- falling sand gathers speed ----------------------------------------- */

/** All the sand let go at once: the lattice is turned over (app.js tiltSwap, a phone turned upside down). */
function letGo(o) {
  var sim = grown(1.0, o), b0, v = [], span = [], prev, k;
  sim.completeFlip(); sim.wakeAll();
  b0 = bed(sim, 0); prev = b0.y;
  for (k = 0; k < 4; k++) {
    steps(sim, 6);
    var b = bed(sim, 0);
    v.push((b.y - prev) / 0.05); span.push(b.span); prev = b.y;
  }
  var rest = -1;
  steps(sim, 240, function (s, j) { if (rest < 0 && s.quiet >= 24) rest = 0.2 + (j + 1) / 120 - 0.2; });
  return { v: v, span0: b0.span, span: span, rest: rest, census: censusOk(sim), sim: sim };
}

test('sand let go gathers speed and stretches', function () {
  var r = letGo(), old = letGo({ granular: false });
  ok(r.census, 'the census broke');
  ok(r.v[1] > 1.4 * r.v[0] && r.v[2] > 1.2 * r.v[1], 'its centroid fell at ' + r.v.map(function (x) { return x.toFixed(0); }).join(', ') + ' cells/s over the first four 0.05 s: no acceleration');
  ok(r.span[2] > 1.15 * r.span0, 'the falling mass did not stretch: the middle 80 % spans ' + f1(r.span[2]) + ' rows after 0.15 s, ' + f1(r.span0) + ' at the start');
  ok(Math.abs(old.v[2] / old.v[0] - 1) < 0.1 && old.span[2] < 1.05 * old.span0, 'without it the mass fell at ' + old.v.map(function (x) { return x.toFixed(0); }).join(', ') +
    ' cells/s and spans ' + f1(old.span[2]) + ' rows: this suite could not tell');
  return 'centroid ' + r.v.map(function (x) { return x.toFixed(0); }).join(', ') + ' cells/s over four spans of 0.05 s (without it ' + old.v.map(function (x) { return x.toFixed(0); }).join(', ') +
    '); the mass stretches from ' + f1(r.span0) + ' to ' + f1(r.span[2]) + ' rows in 0.15 s (without it ' + f1(old.span[2]) + '); at rest after ' + f1(r.rest) + ' s';
});

/* ---- momentum ------------------------------------------------------------ */

test('a sideways jolt carries the bed on after it has ended', function () {
  // 3 g for 60 ms, across the glass (the phone jerked sideways)
  function jolt(o) {
    var sim = grown(0.5, o), G = sim.G, c0 = bed(sim, 1).x, r = { peak: 0, slideAfter: 0, census: true };
    steps(sim, 360, function () {});
    c0 = bed(sim, 1).x;
    for (var k = 0; k < 360; k++) {
      var t = k / 120, a = t >= 0.1 && t < 0.16 ? 3 * Math.sin(Math.PI * (t - 0.1) / 0.06) : 0;
      sim.setMotion(a * G, 0, 0, 0, H.LAM, 0);
      if ((k & 1) === 0) sim.beginFrame();
      sim.step();
      if (t >= 0.16 && sim.slip[1] !== 0) r.slideAfter++;
      var d = bed(sim, 1).x - c0;
      if (Math.abs(d) > Math.abs(r.peak)) r.peak = d;
      if (k % 30 === 29 && !censusOk(sim)) r.census = false;
    }
    r.end = bed(sim, 1).x - c0;
    r.rest = sim.quiet >= 24;
    return r;
  }
  var r = jolt(), old = jolt({ granular: false });
  ok(r.census, 'the census broke');
  ok(r.peak >= 4, 'the lower bed moved ' + f1(r.peak) + ' cells (want at least 4)');
  ok(r.slideAfter >= 10, 'the bed slid on for ' + r.slideAfter + ' steps after the jolt (want at least 10)');
  ok(r.rest, 'not at rest 2.8 s after the jolt');
  ok(Math.abs(old.peak) < 2.5, 'without it the bed moved ' + f1(old.peak) + ' cells: this suite could not tell');
  return 'the lower bed\'s centroid moves ' + f1(r.peak) + ' cells and stays ' + f1(r.end) + ' over (without it ' + f1(old.peak) + '); it slides on for ' +
    (r.slideAfter / 120).toFixed(2) + ' s after the jolt has ended';
});

/**
 * The glass carried sideways by a finger at `v` px/s over `dist` px and
 * stopped dead, as app.js steps it: the hold spring (BODY.fw 30 rad/s,
 * damping 0.85), the drag as a g-ratio (K_DRAG 1 × KPX) into setMotion and
 * the glass's own on-screen acceleration in cells (1.48 px a cell, Zen on an
 * iPhone) into setCarry.
 */
function carry(sim, v, dist, secsAfter) {
  var KPX = 0.16e-3 / 9.81, PX = 1.48, fw = 30, fz = 0.85, G = sim.G;
  var px = 0, vx = 0, T1 = dist / v, n = Math.round((T1 + secsAfter) * 120);
  var r = { slip: 0, x: [], census: true, rest: -1 }, c0 = bed(sim, 1).x;
  for (var k = 0; k < n; k++) {
    var t = k * DT, tx = t < T1 ? v * t : dist;
    var ax = fw * fw * (tx - px) - 2 * fz * fw * vx;
    vx += ax * DT; px += vx * DT;
    sim.setMotion(-G * KPX * ax, 0, 0, 0, H.LAM, 0);
    sim.setCarry(-ax / PX, 0);
    if ((k & 1) === 0) sim.beginFrame();
    sim.step();
    if (Math.abs(sim.slip[1]) > r.slip) r.slip = Math.abs(sim.slip[1]);
    if (k % 6 === 5) r.x.push(bed(sim, 1).x - c0);
    if (k % 30 === 29 && !censusOk(sim)) r.census = false;
    if (t > T1 + 0.3 && r.rest < 0 && sim.quiet >= 24) r.rest = t - T1 - 0.2;
  }
  r.T1 = T1;
  return r;
}

test('a glass carried by a finger and stopped dead: its sand is left behind, surges past where it lay and comes to rest; a slow carry starts nothing', function () {
  var sim = grown(0.5), r = carry(sim, 600, 180, 2.5);
  ok(r.census, 'the census broke');
  ok(r.slip >= 100, 'the bed slid at ' + r.slip.toFixed(0) + ' cells/s at most (want at least 100)');
  // carried off toward +x the sand is left behind (its centroid moves toward −x in the glass);
  // at the stop it surges the other way, past where it lay; then it lies still
  var iStop = Math.round(r.T1 * 20), back = 0, fwd = -1e9, k;
  for (k = 0; k < iStop + 3; k++) if (r.x[k] < back) back = r.x[k];
  for (k = iStop; k < r.x.length; k++) if (r.x[k] > fwd) fwd = r.x[k];
  var end = r.x[r.x.length - 1];
  ok(back <= -5, 'carried off, the bed was left behind by ' + f1(-back) + ' cells at most (want at least 5)');
  ok(fwd >= 1, 'stopped dead, the bed surged to ' + f1(fwd) + ' cells past where it lay (want at least 1)');
  ok(fwd - back >= 8, 'the slosh spans ' + f1(fwd - back) + ' cells (want at least 8)');
  ok(r.rest >= 0 && r.rest <= 2, 'not at rest 2 s after the stop');
  var slow = carry(grown(0.5), 150, 120, 1.5), xs = Math.max.apply(null, slow.x.map(Math.abs));
  ok(slow.slip === 0, 'a slow carry (150 px/s) set the bed sliding at ' + slow.slip.toFixed(0) + ' cells/s');
  ok(xs < 1, 'a slow carry moved the bed ' + f1(xs) + ' cells');
  var old = carry(grown(0.5, { granular: false }), 600, 180, 2.5), xo = Math.max.apply(null, old.x.map(Math.abs));
  ok(xo < 2, 'without it the bed moved ' + f1(xo) + ' cells: this suite could not tell');
  return '600 px/s over 180 px: the bed slides at up to ' + r.slip.toFixed(0) + ' cells/s; its centroid is left ' + f1(-back) + ' cells behind, surges to ' + f1(fwd) +
    ' past where it lay at the stop and ends at ' + f1(end) + ', at rest ' + f1(r.rest) + ' s after the stop (without it: ' + f1(xo) + ' cells in all); 150 px/s: no slide, the bed moves ' + f1(xs) + ' cells';
});

/* ---- shaking -------------------------------------------------------------- */

test('four seconds of hard vertical shaking level a heap; walking does not', function () {
  function shaken(name, fn, o) {
    var sim = grown(0.5, o), f0 = flanks(sim);
    var r = H.drive({ sim: sim, T: null }, name, { fn: fn, dur: 4, clock: false, census: 30 });
    sim.setMotion(0, 0, 0, 0, H.LAM, 0);
    steps(sim, 360);
    var f = flanks(sim);
    return { before: (f0[0] + f0[1]) / 2, after: (f[0] + f[1]) / 2, censusErr: r.censusErr, dMax: r.dMax };
  }
  var hard = shaken(null, function (t, f) { f.y = -2.5 * Math.sin(TAU * 4 * t); });
  var walk = shaken('walking');
  var old = shaken(null, function (t, f) { f.y = -2.5 * Math.sin(TAU * 4 * t); }, { granular: false });
  ok(hard.censusErr === 0 && walk.censusErr === 0, 'the census broke');
  ok(hard.before > 31, 'the heap stood at ' + f1(hard.before) + '° before the shake');
  ok(hard.after <= 18, 'shaken at 2.5 g, 4 Hz for 4 s the heap still stands at ' + f1(hard.after) + '° (want at most 18)');
  ok(walk.after >= 24, 'walking for 4 s took the heap to ' + f1(walk.after) + '° (want at least 24)');
  ok(old.after > 22, 'without it the shake left ' + f1(old.after) + '°: this suite could not tell');
  return 'flanks ' + f1(hard.before) + '° → ' + f1(hard.after) + '° shaken at 2.5 g, 4 Hz (without it ' + f1(old.after) + '°); → ' + f1(walk.after) + '° walking';
});

/* ---- the timer, the census, the tones ------------------------------------- */

test('a glass that runs while it leans follows its clock', function () {
  var out = [];
  [10, 30].forEach(function (lean) {
    var sim = new Sim({ scale: 1.08, seed: 77 });
    sim.reset(Clock.grainsFor(sim, 300000));
    steps(sim, 300);
    var T = new Clock(sim, 300000), now = 0, worst = 0, over = 0;
    T.start();
    sim.tilt = lean * DEG; sim.wakeAll();
    for (var k = 0; k < 120 * 40; k++) {
      T.tick(DT_MS, false); T.apply(now, false, true);
      if ((k & 1) === 0) sim.beginFrame();
      var tgt = sim.targetTop;
      sim.step(); now += DT_MS;
      if (sim.nTop < tgt) over++;
      if (k > 600 && sim.lag > worst) worst = sim.lag;
      if (k % 120 === 119) ok(censusOk(sim), 'lean ' + lean + '°: the census broke at ' + ((k + 1) / 120) + ' s');
    }
    ok(over === 0, 'lean ' + lean + '°: the valve ran ahead of the clock in ' + over + ' steps');
    ok(worst <= 12, 'lean ' + lean + '°: the neck fell ' + worst + ' grains behind the clock (want at most 12)');
    out.push('lean ' + lean + '°, 40 s: never ahead, at most ' + worst + ' grains behind, ' + (sim.total - sim.nTop) + ' through');
  });
  return out.join('; ');
});

test('the census and each tone\'s count hold through a lean, a Flip, a jolt, a carry, a shake and a turn-over', function () {
  var sim = grown(0.5, { layers: true }), G = sim.G, bad = 0, checks = 0;
  var tones0 = sim.tones(), tn, k;
  function check() {
    checks++;
    var t = sim.tones();
    if (!censusOk(sim) || t[0] !== tones0[0] || t[1] !== tones0[1]) bad++;
  }
  sim.tilt = 30 * DEG; sim.wakeAll(); steps(sim, 240, check);
  sim.tilt = 0; sim.wakeAll(); steps(sim, 120, check);
  tn = new H.Turner(sim, H.LAM); tn.flip();
  for (k = 0; tn.busy(); k++) { tn.step(); if ((k & 1) === 0) sim.beginFrame(); sim.step(); check(); }
  steps(sim, 240, function (s, j) { var t = j / 120; s.setMotion((t < 0.06 ? 3 : 0) * G, 0, 0, 0, H.LAM, 0); check(); });
  var r = carry(sim, 700, 200, 1); check();
  steps(sim, 360, function (s, j) { s.setCarry(0, 0); s.setMotion(0.3 * G * Math.sin(TAU * 3 * j / 120), -2.5 * G * Math.sin(TAU * 4 * j / 120), 0, 0, H.LAM, 0); check(); });
  sim.setMotion(0, 0, 0, 0, H.LAM, 0);
  sim.completeFlip(); sim.wakeAll(); steps(sim, 240, check);
  ok(r.census, 'the census broke during the carry');
  ok(bad === 0, 'the census or a tone\'s count was off in ' + bad + ' of ' + checks + ' checks');
  return checks + ' checks, every step: ' + sim.total + ' grains, tones ' + tones0[0] + ' and ' + tones0[1];
});

/* ---- untouched ------------------------------------------------------------- */

test('a glass that stands straight never reaches this code; after a lean it is handed back', function () {
  var sim = new Sim({ scale: 1.08, seed: 9 }), calls = 0;
  ['_caM', '_slump'].forEach(function (n) {
    var f = sim[n];
    sim[n] = function () { calls++; return f.apply(this, arguments); };
  });
  sim.reset(Clock.grainsFor(sim, 60000));
  steps(sim, 300);
  var T = new Clock(sim, 60000), now = 0;
  T.start();
  function run(n) {
    for (var k = 0; k < n; k++) {
      T.tick(DT_MS, false); T.apply(now, false, true);
      sim.setMotion(0, 0, 0, 0, H.LAM, 0);
      if ((k & 1) === 0) sim.beginFrame();
      sim.step(); now += DT_MS;
    }
  }
  run(1200);
  ok(calls === 0, 'an upright, untouched, running glass called the new automaton ' + calls + ' times in 10 s');
  sim.tilt = 12 * DEG; sim.wakeAll(); run(240);
  var leaned = calls;
  ok(leaned > 0, 'a leaned glass never called it');
  sim.tilt = 0; sim.wakeAll(); run(Sim.MOTION.handBack + 2);
  var c1 = calls; run(600);
  ok(calls === c1, 'upright again, it was still called ' + (calls - c1) + ' times after the hand-back');
  ok(censusOk(sim), 'the census broke');
  return '0 calls in 10 s upright; ' + leaned + ' in 2 s leaned; none from ' + (Sim.MOTION.handBack / 120).toFixed(1) + ' s after it stood straight again';
});

console.log(failures ? 'repose: ' + failures + ' of ' + count + ' cases FAILED' : 'repose: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
