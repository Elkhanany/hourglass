/*
 * layered sand: every grain keeps its tone, and the sand falls as it always did.
 *
 * A grain's tone is bit 7 of its colour seed (sim.seed, sim.pseed, sim.escS).
 *
 *   the fill is laid in five to nine wavy bands of unequal thickness, the
 *   companion tone never most of it; the same seed lays the same bands,
 *   another seed different ones
 *   each tone's count holds through an idle run, the Flip button and a
 *   flicked spin, shaking (beds in flight, spray, hops), a tumble that
 *   cracks the glass, a breach that leaks (every escaped grain counted by
 *   its tone as it leaves), sand poured in and a fast-forward; the census
 *   holds throughout
 *   poured sand arrives in layers of 420 to 840 grains, each the other tone
 *   from the last
 *   with layers on, the lattice, the grains in the air, the sleep map and
 *   the sand's random stream are the same, step for step, as with layers
 *   off (which sim-identity.test.js proves identical to f446085)
 *   the heap settles into strata; without sifting it would be a blend
 *   turned off, the tones are forgotten; turned on, the sand is laid in
 *   strata where it lies
 *   with layers off the renderer's colour table is the one it always built
 *   (7f71786); with layers on each tone has its own half of it
 *   sand on the desk keeps its tone
 *
 *   node tools/test/sim-tone.test.js        exits 0 when every case passes
 */
'use strict';
var L = require('./lib/load-physics.js');
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim, REST = P.REST, Clock = H.Clock;
var DT_MS = Clock.DT_MS, BINS = 40;
var LUT_REV = '7f71786';               // the renderer before layered sand

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
function census(s) {
  var c = s.census();
  ok(c.total === s.total && c.top === s.nTop, 'census ' + c.total + '/' + c.top + ' vs ' + s.total + '/' + s.nTop);
}
/** tones() must equal `want` [tone 0, tone 1]. */
function same(s, want, when) {
  var t = s.tones();
  ok(t[0] === want[0] && t[1] === want[1], when + ': tones ' + t.join(' + ') + ', want ' + want.join(' + '));
  ok(t[0] + t[1] === s.total, when + ': tones add up to ' + (t[0] + t[1]) + ', total ' + s.total);
}

/** A glass with layered sand, filled for durMs. */
function layered(seed, durMs, scale) {
  var s = new Sim({ scale: scale || 1.08, seed: seed, layers: true });
  s.reset(Clock.grainsFor(s, durMs || 300000));
  return s;
}
/** n steps of an upright glass at rest with its clock running, as app.js drives it. */
function flow(s, T, n, k0) {
  for (var k = 0; k < n; k++) {
    T.tick(DT_MS, false);
    T.apply(((k0 || 0) + k) * DT_MS, false);
    if ((k & 1) === 0) s.beginFrame();
    s.step();
  }
}
function rest(s, n) {
  s.gateOpen = false;
  for (var k = 0; k < n; k++) { if ((k & 1) === 0) s.beginFrame(); s.step(); }
}
/**
 * The bands down the middle of the upper bulb: their thicknesses in rows,
 * top first. A row is the companion's once more than 70 % of its 13 middle
 * grains are, and the other tone's again under 30 % (a seam is ragged).
 */
function bands(s) {
  var W = s.W, cx = s.geo.cx | 0, runs = [], state = -1, x, y, i, n0, n1;
  for (y = s.topY; y < s.gateY; y++) {
    n0 = n1 = 0;
    for (x = cx - 6; x <= cx + 6; x++) {
      i = y * W + x;
      if (s.cell[i] >= REST) { if (s.seed[i] >> 7) n1++; else n0++; }
    }
    if (n0 + n1 === 0) continue;
    var f = n1 / (n0 + n1), t = state;
    if (f > 0.7) t = 1; else if (f < 0.3) t = 0; else if (t < 0) t = f > 0.5 ? 1 : 0;
    if (t === state) runs[runs.length - 1]++; else { runs.push(1); state = t; }
  }
  return runs;
}
/** The share of grains lying on a grain of the other tone, in bulb b: about 0.5 in a blend, low in strata. */
function unlike(s, b) {
  var W = s.W, y0 = b ? s.gateY + 1 : s.topY, y1 = b ? s.H - 2 : s.gateY - 2, n = 0, d = 0, x, y, i;
  for (y = y0; y <= y1; y++) {
    for (x = 1; x < W - 1; x++) {
      i = y * W + x;
      if (s.cell[i] < REST || s.cell[i + W] < REST) continue;
      n++;
      if ((s.seed[i] ^ s.seed[i + W]) & 128) d++;
    }
  }
  return n ? d / n : 0;
}
/** Strata down the axis of the lower heap (runs of one tone at least two grains thick, majority of 5 columns). */
function strata(s) {
  var W = s.W, cx = s.geo.cx | 0, n = 0, run = 0, last = -1, x, y, i, n0, n1;
  for (y = s.gateY + 1; y < s.H - 1; y++) {
    n0 = n1 = 0;
    for (x = cx - 2; x <= cx + 2; x++) {
      i = y * W + x;
      if (s.cell[i] >= REST) { if (s.seed[i] >> 7) n1++; else n0++; }
    }
    if (n0 + n1 < 5) continue;
    var t = n1 > n0 ? 1 : 0;
    if (t === last) { if (++run === 2) n++; } else { last = t; run = 1; }
  }
  return n;
}

/* ---- the fill ---- */
test('the fill is laid in five to nine bands of unequal thickness; the companion tone is never most of it', function () {
  var seen = {}, lo = 99, hi = 0, shares = [], ratio = 99;
  for (var k = 1; k <= 16; k++) {
    var s = layered(k * 7919), b = bands(s), t = s.tones(), share = t[1] / s.total;
    ok(b.length >= 5 && b.length <= 9, 'seed ' + k * 7919 + ': ' + b.length + ' bands (' + b.join(', ') + ')');
    ok(t[0] > 0 && t[1] > 0 && share <= 0.5, 'seed ' + k * 7919 + ': the companion is ' + (share * 100).toFixed(0) + ' %');
    ok(share >= 0.2, 'seed ' + k * 7919 + ': only ' + (share * 100).toFixed(0) + ' % companion');
    var mn = Math.min.apply(null, b), mx = Math.max.apply(null, b);
    ok(mn >= 3, 'seed ' + k * 7919 + ': a band ' + mn + ' rows thin');
    if (mx / mn < ratio) ratio = mx / mn;
    seen[b.length] = 1; shares.push(share);
    if (b.length < lo) lo = b.length;
    if (b.length > hi) hi = b.length;
    same(s, t, 'fill');
    census(s);
  }
  ok(Object.keys(seen).length >= 3, 'every fill has ' + Object.keys(seen).join(' or ') + ' bands');
  ok(ratio >= 1.25, 'bands of equal thickness (thickest / thinnest ' + ratio.toFixed(2) + ')');
  return '16 fills: ' + lo + ' to ' + hi + ' bands, thickest / thinnest ≥ ' + ratio.toFixed(1) + ', companion ' +
    (Math.min.apply(null, shares) * 100).toFixed(0) + '–' + (Math.max.apply(null, shares) * 100).toFixed(0) + ' %';
});

test('the same seed lays the same bands, another seed different ones; the seams are wavy', function () {
  var a = layered(4242), b = layered(4242), c = layered(4243), i, diff = 0, N = a.seed.length;
  for (i = 0; i < N; i++) ok(a.seed[i] === b.seed[i], 'the same seed gave another fill at cell ' + i);
  for (i = 0; i < N; i++) if (a.cell[i] >= REST && c.cell[i] >= REST && ((a.seed[i] ^ c.seed[i]) & 128)) diff++;
  ok(diff > a.total * 0.1, 'another seed changed only ' + diff + ' tones');
  // a seam's height differs from column to column, gently: its range across the glass is 2 to 12 rows
  var W = a.W, cx = a.geo.cx | 0, ys = [], x, y;
  for (x = cx - 40; x <= cx + 40; x += 4) {
    var first = -1, t0 = -1;
    for (y = a.topY; y < a.gateY && first < 0; y++) {
      if (a.cell[y * W + x] < REST) continue;
      // the first seam: where three grains in a row are no longer the top band's tone
      if (t0 < 0) t0 = a.seed[y * W + x] >> 7;
      else if ((a.seed[y * W + x] >> 7) !== t0 && (a.seed[(y + 1) * W + x] >> 7) !== t0 && (a.seed[(y + 2) * W + x] >> 7) !== t0) first = y;
    }
    if (first >= 0) ys.push(first);
  }
  var range = Math.max.apply(null, ys) - Math.min.apply(null, ys);
  ok(ys.length >= 15 && range >= 2 && range <= 12, 'the first seam wanders ' + range + ' rows over ' + ys.length + ' columns');
  return 'identical for one seed, ' + diff + ' grains differ for the next; the first seam wanders ' + range + ' rows across the glass';
});

/* ---- every grain keeps its tone ---- */
test('an idle run keeps each tone\'s count', function () {
  var s = layered(11), T = new Clock(s, 300000), t0 = s.tones(), k;
  T.start();
  for (k = 0; k < 15; k++) {
    flow(s, T, 600, k * 600);
    same(s, t0, 'after ' + (k + 1) * 5 + ' s');
    census(s);
  }
  ok(!s.motionActive() && s.nBottom > 3000, 'an idle run should have passed sand: ' + s.nBottom);
  return 'a 5-minute glass, 75 s of flow (' + s.nBottom + ' grains through the neck): ' + t0.join(' + ') + ' at every check';
});

test('the Flip button and a flicked spin keep each tone\'s count', function () {
  var s = layered(22), T = new Clock(s, 300000), t0 = s.tones(), k = 0;
  T.start();
  flow(s, T, 7200, 0);
  var tn = new H.Turner(s);
  tn.flip();
  while (tn.busy() && k < 4000) { if ((k & 1) === 0) s.beginFrame(); tn.step(); s.step(); k++; }
  ok(tn.swaps === 1, 'the Flip button turned the glass ' + tn.swaps + ' times');
  same(s, t0, 'after the flip');
  rest(s, 600);
  same(s, t0, 'settled after the flip');
  census(s);
  tn.flick(16, 0.25);
  for (k = 0; tn.busy() && k < 6000; k++) { if ((k & 1) === 0) s.beginFrame(); tn.step(); s.step(); if (k % 120 === 0) same(s, t0, 'spinning'); }
  ok(!tn.busy() && tn.swaps >= 3, 'the spin made ' + (tn.swaps - 1) + ' half turns');
  s.setMotion(0, 0, 0, 0, 0, 0);
  rest(s, 600);
  same(s, t0, 'after the spin');
  census(s);
  return 'one Flip, then a spin of ' + (tn.swaps - 1) + ' half turns: ' + t0.join(' + ') + ' throughout';
});

test('shaking keeps each tone\'s count (beds in flight, spray and hops)', function () {
  var out = [];
  ['veryVigSlow', 'lateralVV', 'tableSpin'].forEach(function (name, n) {
    var sim = new Sim({ scale: 1.08, seed: 31 + n, layers: true });
    var run = H.glassAt({ durMs: 300000, startMs: 150000, sim: sim }), t0 = sim.tones(), bad = 0;
    var r = H.drive(run, name, { armed: false, dur: 8, each: function (rn, k) {
      if (k % 60 === 59) { var t = sim.tones(); if (t[0] !== t0[0] || t[1] !== t0[1]) bad++; }
    } });
    ok(bad === 0, name + ': the tones changed at ' + bad + ' checks');
    ok(r.censusErr === 0 && r.conserveErr === 0, name + ': census');
    ok(r.motionSteps > 300, name + ': only ' + r.motionSteps + ' steps on the motion path');
    same(sim, t0, name);
    out.push(name + ' (' + (r.maxAir ? 'bed in flight, ' : '') + r.sprayed + ' sprayed, ' + r.hops + ' hops)');
  });
  return out.join('; ');
});

test('a tumble that cracks the glass, and a breach that leaks: every grain that leaves is counted by its tone', function () {
  // forced breaches in both bulbs, shaken
  var s = layered(51, 2700000), esc = [0, 0], full = 0, k, e;
  s.fastForward(Math.round(s.nTop * 0.3));
  rest(s, 600);
  var t0 = s.tones();
  s.forceCrack(segOf(0, -1, 0.15), 40, 3);     // the upper funnel, left
  s.forceCrack(segOf(1, 1, 0.9), 40, 3);       // the lower dome, right
  var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {};
  for (k = 0; k < 6 * 120; k++) {
    f.y = 0.7 * Math.sin(2 * Math.PI * 4 * k / 120); f.z = 0.5;
    H.felt(s, f, inp);
    s.setMotion(inp.ax, inp.ay, inp.w, inp.al, H.LAM, inp.gz);
    if ((k & 1) === 0) s.beginFrame();
    s.step();
    if (k & 1) {
      if (s.escN >= 256) full++;
      for (e = 0; e < s.escN; e++) esc[s.escS[e] >> 7]++;
      s.escN = 0;
      census(s);
    }
  }
  ok(full === 0, 'the escape ring filled up: the count would miss grains');
  ok(s.leakedTop > 0 && s.leakedBottom > 0, 'both bulbs should leak: ' + s.leakedTop + ' / ' + s.leakedBottom);
  ok(esc[0] + esc[1] === s.lost, 'ring ' + (esc[0] + esc[1]) + ', lost ' + s.lost);
  ok(esc[0] > 0 && esc[1] > 0, 'both tones should leak: ' + esc.join(' + '));
  same(s, [t0[0] - esc[0], t0[1] - esc[1]], 'after the leak');
  var out = s.lost + ' grains left through two breaches (' + esc.join(' + ') + ' by tone)';

  // a tumble: turned end over end every 5 s while shaken hard enough to crack it
  var sim = new Sim({ scale: 1.08, seed: 52, layers: true });
  var run = H.glassAt({ durMs: 300000, startMs: 150000, sim: sim }), gone = [0, 0], bad = 0;
  t0 = sim.tones();
  var r = H.drive(run, 'vigSlow60', { armed: true, flipEvery: 600, dur: 30, frame: function () {
    if (sim.escN >= 256) full++;
    for (var q = 0; q < sim.escN; q++) gone[sim.escS[q] >> 7]++;
    var t = sim.tones();
    if (t[0] + gone[0] !== t0[0] || t[1] + gone[1] !== t0[1]) bad++;
  } });
  ok(full === 0, 'the escape ring filled up in the tumble');
  ok(bad === 0, 'the tumble: tones and escapes did not add up at ' + bad + ' frames');
  ok(r.censusErr === 0 && r.conserveErr === 0, 'the tumble: census');
  ok(gone[0] + gone[1] === sim.lost, 'the tumble: ring ' + (gone[0] + gone[1]) + ', lost ' + sim.lost);
  return out + '; a tumble (' + Math.floor(r.steps / 600) + ' turns, ' + r.cracksNow + ' crack(s), ' + sim.lost + ' leaked): exact at every frame';
});

test('sand poured in arrives in layers of the other tone from the last, and keeps the count', function () {
  var s = layered(61), W = s.W, cx = s.geo.cx | 0, y, top = -1, k, p;
  rest(s, 240);
  for (y = s.topY; y < s.gateY && top < 0; y++) if (s.cell[y * W + cx] >= REST) top = s.seed[y * W + cx] >> 7;
  var t0 = s.tones(), poured = [0, 0], runs = [], last = -1;
  // the Sand button held: 620 grains a second
  for (k = 0; poured[0] + poured[1] < 2600 && k < 2000; k++) {
    var np0 = s.np, made = s.pour(5);
    ok(made === 5, 'the pour stopped at ' + (poured[0] + poured[1]));
    var t = s.pseed[np0] >> 7;
    for (p = np0; p < s.np; p++) ok((s.pseed[p] >> 7) === t, 'two tones in one pour call');
    poured[t] += made;
    if (t === last) runs[runs.length - 1] += made; else { runs.push(made); last = t; if (runs.length === 1) ok(t === (top ^ 1), 'the first layer has the tone of the sand it lands on'); }
    if ((k & 1) === 0) s.beginFrame();
    s.step();
  }
  ok(runs.length >= 4, 'only ' + runs.length + ' layers in 2600 grains');
  for (k = 0; k < runs.length - 1; k++) ok(runs[k] >= 420 && runs[k] < 845, 'a layer of ' + runs[k] + ' grains');
  rest(s, 600);
  same(s, [t0[0] + poured[0], t0[1] + poured[1]], 'after the pour');
  census(s);
  // taps: a layer is finished by the next taps, in the same tone; the layer after it takes the other
  var s2 = layered(62), tones = [];
  rest(s2, 240);
  for (k = 0; k < 8; k++) {
    np0 = s2.np;
    ok(s2.pour(150) === 150, 'a tap of 150 grains');
    tones.push(s2.pseed[np0] >> 7);
    rest(s2, 300);
  }
  var changes = 0;
  for (k = 1; k < 8; k++) if (tones[k] !== tones[k - 1]) changes++;
  ok(changes >= 1 && changes <= 2, 'eight taps of 150 grains changed tone ' + changes + ' times (' + tones.join('') + ')');
  ok(tones[0] === tones[1] && tones[1] === tones[2], 'a layer under 420 grains changed tone (' + tones.join('') + ')');
  return '2600 grains held: layers of ' + runs.join(', ') + '; eight taps: ' + tones.join('');
});

test('a fast-forward keeps each tone\'s count and leaves strata', function () {
  var s = layered(71), t0 = s.tones();
  var moved = s.fastForward(6000);
  ok(moved === 6000, 'moved ' + moved);
  same(s, t0, 'after the fast-forward');
  rest(s, 300);
  same(s, t0, 'settled');
  census(s);
  var u = unlike(s, 1), n = strata(s);
  ok(u < 0.3 && n >= 4, 'the heap is a blend: unlike ' + u.toFixed(2) + ', ' + n + ' strata');
  return '6000 grains moved in bulk: ' + t0.join(' + ') + ' kept; the heap has ' + n + ' strata down its axis (unlike ' + u.toFixed(2) + ')';
});

/* ---- the sand itself never looks at a tone ---- */
function fnv(h, bytes, n) {
  for (var i = 0; i < n; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  return h;
}
function bytesOf(a, n) { return new Uint8Array(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT); }
/** Everything that drives the next step, but for the colour seeds. */
function hashSand(s) {
  var np = s.np, h = fnv(-2128831035, s.cell, s.cell.length);
  h = fnv(h, s.stamp, s.stamp.length);
  h = fnv(h, s.rowAct, s.rowAct.length);
  h = fnv(h, bytesOf(s.px, np), np * 4);
  h = fnv(h, bytesOf(s.py, np), np * 4);
  h = fnv(h, bytesOf(s.pvx, np), np * 4);
  h = fnv(h, bytesOf(s.pvy, np), np * 4);
  h = fnv(h, s.pinfo, np);
  h = fnv(h, bytesOf(s.agit, 2), 8);
  h = fnv(h, bytesOf(s.bf, 4), 16);
  var sc = new Float64Array([s.rng, np, s.nTop, s.total, s.steps, s.quiet, s.tick, s.angle, s.tilt, s.gx, s.gy,
                             s.lag, s.targetTop, s.lost, s.slug[0].Z, s.slug[1].Z, s.slug[0].U, s.slug[1].U, s.glassSeed]);
  return fnv(h, bytesOf(sc, sc.length), sc.length * 8) >>> 0;
}
test('with layers on the sand falls exactly as it does without (lattice, grains in the air, sleep map, random stream)', function () {
  var STEPS = 12000, out = [];
  [[4242, 60000, 1.08], [777, 300000, 1.3]].forEach(function (c) {
    var sims = [false, true].map(function (on) {
      var s = new Sim({ scale: c[2], seed: c[0], layers: on });
      s.reset(Clock.grainsFor(s, c[1]));
      return { s: s, T: new Clock(s, c[1]), tn: null };
    });
    sims.forEach(function (o) { o.T.start(); o.tn = new H.Turner(o.s); });
    ok(hashSand(sims[0].s) === hashSand(sims[1].s), 'the fills differ');
    var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {}, tones = sims[1].s.tones(), swaps = 0, moved = 0;
    for (var k = 0; k < STEPS; k++) {
      for (var q = 0; q < 2; q++) {
        var s = sims[q].s, T = sims[q].T, tn = sims[q].tn;
        if (k === 1500) T.poured(s.pour(300));                                   // sand poured in
        if (k === 5000) tn.flip();                                               // the Flip button
        if (k === 6500) { T.rem -= 8000; moved = s.fastForward(Math.max(0, s.nTop - Math.ceil(T.topAt(T.rem)))); }   // the page slept 8 s
        if (tn.busy()) { tn.step(); if (tn.swapped) { T.rem = T.remAt(s.nTop); swaps++; } }   // (Clock.turnOver, after the swap)
        else if (k >= 2600 && k < 3200) {                                        // five seconds of hard shaking
          f.x = 1.2 * Math.sin(2 * Math.PI * 3 * k / 120); f.y = 2.2 * Math.sin(2 * Math.PI * 4.5 * k / 120); f.z = 0.4;
          H.felt(s, f, inp);
          s.setMotion(inp.ax, inp.ay, 0, 0, H.LAM, inp.gz);
        } else s.setMotion(0, 0, 0, 0, H.LAM, 0);
        T.tick(DT_MS, tn.busy());
        T.apply(k * DT_MS, tn.busy());
        if ((k & 1) === 0) s.beginFrame();
        s.step();
      }
      if (k % 50 === 49) ok(hashSand(sims[0].s) === hashSand(sims[1].s), 'seed ' + c[0] + ': the sand differs by step ' + (k + 1));
    }
    var a = sims[0].s, b = sims[1].s, t = b.tones();
    ok(swaps === 2 && moved > 0, 'the script should flip and fast-forward: ' + swaps / 2 + ' flips, ' + moved + ' moved');
    ok(t[0] + t[1] === b.total && t[0] + t[1] === tones[0] + tones[1] + 300, 'tones ' + t.join(' + ') + ' of ' + b.total);
    census(a); census(b);
    out.push('scale ' + c[2] + ': ' + STEPS + ' steps (a pour, a shake, a flip, a fast-forward) identical at ' + STEPS / 50 + ' checks, hash 0x' + hashSand(b).toString(16));
  });
  return out.join('; ');
});

/* ---- strata ---- */
test('the heap settles into strata; without sifting it would be a blend', function () {
  function runOut(seed, sift) {
    var LAY = Sim.LAYERS, keep = [LAY.pSift, LAY.pSide];
    if (!sift) { LAY.pSift = 0; LAY.pSide = 0; }
    var s = layered(seed, 60000), T = new Clock(s, 60000), t0 = s.tones();
    T.start();
    flow(s, T, 7200 + 600, 0);
    LAY.pSift = keep[0]; LAY.pSide = keep[1];
    ok(s.nTop === 0, 'the glass should have run out: ' + s.nTop + ' left');
    same(s, t0, 'run out');
    return s;
  }
  var out = [];
  [101, 202, 303].forEach(function (seed) {
    var a = runOut(seed, true), b = runOut(seed, false), ua = unlike(a, 1), ub = unlike(b, 1), n = strata(a);
    ok(ua < 0.3, 'seed ' + seed + ': the heap is a blend (unlike ' + ua.toFixed(2) + ')');
    ok(n >= 5, 'seed ' + seed + ': only ' + n + ' strata down the axis');
    ok(ub > 0.36, 'seed ' + seed + ': unsifted sand is not a blend (unlike ' + ub.toFixed(2) + ')? the measure is wrong');
    // the same sand in the same cells: sifting only trades seeds
    for (var i = 0; i < a.cell.length; i++) ok(a.cell[i] === b.cell[i], 'seed ' + seed + ': sifting moved the lattice at ' + i);
    out.push(n + ' strata, unlike ' + ua.toFixed(2) + ' (unsifted ' + ub.toFixed(2) + ')');
  });
  return 'a 1-minute glass run out, three seeds: ' + out.join('; ');
});

test('turned off, the tones are forgotten; turned on, the sand is laid in strata where it lies', function () {
  var s = layered(81), T = new Clock(s, 300000), N = s.cell.length, i, n = 0, hi = 0;
  T.start();
  flow(s, T, 18000, 0);
  var cells = new Uint8Array(s.cell), low = new Uint8Array(N), rng = s.rng;
  for (i = 0; i < N; i++) low[i] = s.seed[i] & 127;
  s.setLayers(false);
  ok(s.layers === false, 'layers');
  for (i = 0; i < N; i++) if (s.cell[i] >= REST) { n++; if (s.seed[i] >> 7) hi++; }
  var u0 = unlike(s, 0), u1 = unlike(s, 1);
  ok(Math.abs(hi / n - 0.5) < 0.03, 'bit 7 is set on ' + (100 * hi / n).toFixed(1) + ' % of the grains');
  ok(Math.abs(u0 - 0.5) < 0.05 && Math.abs(u1 - 0.5) < 0.05, 'still in strata: unlike ' + u0.toFixed(2) + ' / ' + u1.toFixed(2));
  s.setLayers(true);
  var t = s.tones(), v0 = unlike(s, 0), v1 = unlike(s, 1);
  ok(t[1] <= t[0] && t[1] > 0.2 * s.total, 'the companion is ' + (100 * t[1] / s.total).toFixed(0) + ' %');
  ok(v0 < 0.2 && v1 < 0.3, 'not in strata: unlike ' + v0.toFixed(2) + ' above, ' + v1.toFixed(2) + ' below');
  ok(bands(s).length >= 3 && strata(s) >= 3, bands(s).length + ' bands above, ' + strata(s) + ' strata below');
  // neither touches the sand: the lattice, the other seven bits of every seed that did not trade places above the neck, the random stream
  for (i = 0; i < N; i++) ok(s.cell[i] === cells[i], 'the lattice changed at ' + i);
  for (i = 0; i < s.gateY * s.W; i++) ok((s.seed[i] & 127) === low[i], 'a seed above the neck changed at ' + i);
  ok(s.rng === rng, 'the sand\'s random stream moved');
  census(s);
  return 'off: bit 7 on ' + (100 * hi / n).toFixed(1) + ' % of grains, unlike ' + u0.toFixed(2) + ' / ' + u1.toFixed(2) +
    '; on again: ' + bands(s).length + ' bands above, ' + strata(s) + ' strata below (unlike ' + v0.toFixed(2) + ' / ' + v1.toFixed(2) + ')';
});

/* ---- the picture ---- */
function lutOf(Ph, id, layers) {
  var o = { theme: Ph.THEMES[id], lut: new Uint32Array(48 * 256), isMica: new Uint8Array(256), hiBoost: new Uint8Array(256),
            emit: new Float32Array(256), aoTab: new Uint8Array(256), layers: !!layers };
  Ph.Renderer.prototype._buildLUT.call(o);
  return o;
}
test('layers off: the colour table is the one the renderer always built; layers on: each tone has its own half', function () {
  var OLD = L.baseline(LUT_REV), out = [];
  Object.keys(P.THEMES).forEach(function (id) {
    ok(OLD.THEMES[id], id + ' is not in ' + LUT_REV);
    var a = lutOf(OLD, id), b = lutOf(P, id, false), c = lutOf(P, id, true), i, s;
    for (i = 0; i < a.lut.length; i++) ok(a.lut[i] === b.lut[i], id + ': colour ' + i + ' differs with layers off');
    for (i = 0; i < 256; i++) {
      ok(a.isMica[i] === b.isMica[i] && a.hiBoost[i] === b.hiBoost[i] && a.emit[i] === b.emit[i] && a.aoTab[i] === b.aoTab[i], id + ': seed ' + i + ' differs with layers off');
    }
    ok(a.glintColor === b.glintColor && a.bloomRGB === b.bloomRGB, id + ': glint or bloom');
    // layers on: the mean colour of each half at mid light, and each tone's kinds of grain
    var th = P.THEMES[id], m = [[0, 0, 0], [0, 0, 0]], mica = [0, 0];
    ok(th.sand2 && th.sand2.dark && th.sand2.alt && th.sand2.mica, id + ' has no companion sand');
    for (s = 0; s < 256; s++) {
      var v = c.lut[(24 << 8) | s], q = s >> 7;
      m[q][0] += (v & 255) / 128; m[q][1] += ((v >>> 8) & 255) / 128; m[q][2] += ((v >>> 16) & 255) / 128;
      mica[q] += c.isMica[s];
    }
    var d = Math.sqrt(Math.pow(m[0][0] - m[1][0], 2) + Math.pow(m[0][1] - m[1][1], 2) + Math.pow(m[0][2] - m[1][2], 2));
    ok(d >= 40 && d <= 190, id + ': the tones are ' + d.toFixed(0) + ' apart in RGB (too alike below 40, too loud above 190)');
    ok(Math.abs(mica[0] - Math.round(th.sand.mica.p * 128)) <= 1 && Math.abs(mica[1] - Math.round(th.sand2.mica.p * 128)) <= 1,
       id + ': mica seeds ' + mica.join(' / '));
    out.push(id + ' ' + d.toFixed(0));
  });
  return 'identical to ' + LUT_REV + ' for all six sands; the two tones\' distance in RGB: ' + out.join(', ');
});

test('sand on the desk keeps its tone', function () {
  var ctx = { createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; } };
  var canvas = { width: 0, height: 0, style: {}, getContext: function () { return ctx; }, ownerDocument: null };
  var ren = { lut: lutOf(P, 'sahara', true).lut, theme: P.THEMES.sahara, layers: true, reduced: false };
  var sp = new P.Spill(canvas, ren), put = [0, 0], got = [0, 0], i, c, k;
  sp.layout(636, 718, 3, 700, 140, 496);
  for (i = 0; i < 300; i++) {
    var seed = (i * 37) & 255;
    put[seed >> 7]++;
    sp.add(330 + (i % 7) - 3, 300 + (i % 11), (i % 5) * 4 - 8, 20, seed);
  }
  for (i = 0; i < 180; i++) sp.step(1 / 60, 0, 1, 2000, 0, 0);
  ok(sp.heapN === 300 && sp.nAir === 0, 'heap ' + sp.heapN + ', in flight ' + sp.nAir);
  for (c = sp.c0; c <= sp.c1; c++) for (k = 0; k < sp.col[c]; k++) got[sp.cseed[c * 48 + k] >> 7]++;
  ok(got[0] === put[0] && got[1] === put[1], 'on the dune ' + got.join(' + ') + ', spilled ' + put.join(' + '));
  // in flight a grain is drawn in one of four colours by its seed's top two bits: two per tone
  sp._palette();
  ok(sp._pal.length === 4 && sp._pal[0] !== sp._pal[2] && sp._pal[1] !== sp._pal[3], 'flight colours ' + sp._pal.join(' '));
  return put.join(' + ') + ' spilled, ' + got.join(' + ') + ' on the dune after sliding to rest; flight colours two per tone';
});

console.log(failures ? 'tone: ' + failures + ' of ' + count + ' cases FAILED' : 'tone: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
