/*
 * physics-core acceptance 6: the leak (forced cracks on the lower dome).
 *
 *   at rest        w = 1 ≤ 0.2 grains/s (a one-grain breach arches and jams),
 *                  w = 2 0.5–4/s, w = 3 2–12/s
 *   shaken (T ≈ 1) w = 1 ≥ 4/s (vibration breaks the arches)
 *   the escape ring holds every escape until it is full
 *   upper-bulb escapes lower nTop and count in leakedTop; lower-bulb
 *   escapes count only in leakedBottom
 *   sealCracks() stops the leak within one step, shaking or not
 *
 *   node tools/test/sim-leak.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim;
var BINS = 40;

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
/** A settled glass with `lower` of its sand moved to the lower bulb. */
function glass(seed, lower, durMs) {
  var s = new Sim({ scale: 1.08, seed: seed });
  s.reset(H.Clock.grainsFor(s, durMs || 2700000));
  if (lower) s.fastForward(Math.round(s.nTop * lower));
  for (var k = 0; k < 600; k++) { s.beginFrame(); s.step(); }
  return s;
}
/**
 * Run `secs`, the felt field from fn(t) (felt g: {x, y, z}), draining the
 * ring each frame; returns escapes per bulb, ring entries, and checks the
 * census and total + lost every frame.
 */
function leakRun(s, secs, fn, opts) {
  opts = opts || {};
  var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {}, n = Math.round(secs * 120);
  var top0 = s.leakedTop, bot0 = s.leakedBottom, nTop0 = s.nTop, total0 = s.total + s.lost, ring = 0, framed = 0, rel = 0;
  for (var k = 0; k < n; k++) {
    f.x = f.y = f.z = f.w = f.al = 0;
    if (fn) fn(k / 120, f);
    H.felt(s, f, inp);
    s.setMotion(inp.ax, inp.ay, inp.w, inp.al, H.LAM, inp.gz);
    if ((k & 1) === 0) s.beginFrame();
    s.step();
    if ((k & 1) === 1) {
      framed += s.frame.leaked;
      rel += s.frame.released;
      if (!opts.keepRing) { ring += s.escN; s.escN = 0; }
      census(s);
      ok(s.total + s.lost === total0, 'total + lost changed');
    }
  }
  return { top: s.leakedTop - top0, bottom: s.leakedBottom - bot0, ring: ring, framed: framed, dTop: nTop0 - s.nTop, released: rel };
}

test('at rest: a one-grain breach jams, wider ones trickle', function () {
  var lim = [[0, 0.2], [0.5, 4], [2, 12]], out = [];
  [1, 2, 3].forEach(function (w) {
    var s = glass(20 + w, 1);
    s.forceCrack(segOf(1, 1, 0.9), 40, w);
    var r = leakRun(s, 20);
    var rate = r.bottom / 20;
    ok(rate >= lim[w - 1][0] && rate <= lim[w - 1][1], 'w=' + w + ': ' + rate.toFixed(2) + '/s, want ' + lim[w - 1].join('–'));
    ok(r.top === 0 && r.dTop === 0, 'w=' + w + ': a lower leak touched the upper bulb');
    ok(r.ring === r.bottom && r.framed === r.bottom, 'w=' + w + ': ring ' + r.ring + ' / frames ' + r.framed + ' / escapes ' + r.bottom);
    ok(!s.motionActive(), 'w=' + w + ': a leak at rest left the idle path');
    out.push('w' + w + ' ' + rate.toFixed(2) + '/s');
  });
  return out.join(', ') + ' (20 s each, idle path)';
});

test('shaken: T ≈ 1 breaks the arches of a one-grain breach', function () {
  var out = [];
  // a steady 1 g out of the screen's plane holds the temperature at 1
  var s = glass(31, 1), Tsum = 0, n = 0;
  s.forceCrack(segOf(1, 1, 0.9), 40, 1);
  var r = leakRun(s, 1, function (t, f) { f.z = 1.06; });          // settle the temperature first
  r = leakRun(s, 8, function (t, f) { f.z = 1.06; Tsum += s.agit[1]; n++; });
  ok(Math.abs(Tsum / n - 1) < 0.1, 'T was ' + (Tsum / n).toFixed(2));
  ok(r.bottom / 8 >= 4, 'w=1 with T ≈ 1: ' + (r.bottom / 8).toFixed(2) + '/s, want ≥ 4');
  ok(r.ring === r.bottom && r.top === 0, 'ring / bulb bookkeeping');
  out.push('out-of-plane 1 g (T ' + (Tsum / n).toFixed(2) + '): ' + (r.bottom / 8).toFixed(1) + '/s');
  // a sideways shake of Γ 1.5 at 5 Hz: hot, but the bed stays seated
  var s2 = glass(32, 1), T2 = 0, n2 = 0;
  s2.forceCrack(segOf(1, 1, 0.9), 40, 1);
  var r2 = leakRun(s2, 8, function (t, f) { f.x = 1.5 * Math.sin(2 * Math.PI * 5 * t); T2 += s2.agit[1]; n2++; });
  ok(r2.bottom / 8 >= 4, 'w=1 under a lateral Γ 1.5 shake: ' + (r2.bottom / 8).toFixed(2) + '/s');
  out.push('lateral Γ 1.5 at 5 Hz (T ' + (T2 / n2).toFixed(2) + '): ' + (r2.bottom / 8).toFixed(1) + '/s');
  return out.join('; ');
});

test('the escape ring holds every escape until it is full', function () {
  var s = glass(41, 1);
  s.forceCrack(segOf(1, 1, 0.9), 40, 3);
  var k = 0, f = { z: 1.06 }, inp = {};
  H.felt(s, f, inp);
  s.setMotion(inp.ax, inp.ay, 0, 0, H.LAM, inp.gz);
  var lastOk = true;
  while (s.lost < 400 && k++ < 120 * 60) {
    if ((k & 1) === 0) s.beginFrame();
    s.step();
    if (s.lost <= 256 && s.escN !== s.lost) lastOk = false;
  }
  ok(lastOk, 'the ring missed an escape before it was full');
  ok(s.lost >= 400 && s.escN === 256, 'lost ' + s.lost + ', escN ' + s.escN);
  census(s);
  return s.lost + ' escapes, never drained: the ring kept the first 256, lost counts all';
});

test('upper-bulb escapes lower nTop and count in leakedTop; lower ones only in leakedBottom', function () {
  var s = glass(51, 0.3);
  s.forceCrack(segOf(0, -1, 0.15), 40, 3);     // the upper funnel, left
  s.forceCrack(segOf(1, 1, 0.9), 40, 3);       // the lower dome, right
  var nTop0 = s.nTop, total0 = s.total;
  var r = leakRun(s, 6, function (t, f) { f.y = 0.7 * Math.sin(2 * Math.PI * 4 * t); f.z = 0.5; });
  ok(r.top > 0 && r.bottom > 0, 'both bulbs should leak: top ' + r.top + ', bottom ' + r.bottom);
  ok(s.nTop === nTop0 - r.top && r.dTop === r.top, 'nTop fell by ' + (nTop0 - s.nTop) + ', upper escapes ' + r.top);
  ok(s.total === total0 - r.top - r.bottom && s.lost === r.top + r.bottom, 'total / lost');
  ok(s.leakedTop === r.top && s.leakedBottom === r.bottom, 'leakedTop / leakedBottom');
  return r.top + ' from the upper bulb (nTop ' + nTop0 + ' → ' + s.nTop + '), ' + r.bottom + ' from the lower, in 6 s of shaking';
});

test('sealCracks stops the leak within one step, while shaking', function () {
  var out = [];
  [false, true].forEach(function (shaking) {
    var s = glass(61, 1);
    s.forceCrack(segOf(1, 1, 0.9), 40, 3);
    var fn = shaking ? function (t, f) { f.y = 2 * Math.sin(2 * Math.PI * 4.5 * t); f.z = 0.5; } : null;
    var r = leakRun(s, 3, fn);
    ok(r.bottom > 0, 'it leaked first');
    var before = s.lost;
    s.beginFrame();
    ok(s.sealCracks() === 1, 'sealCracks');
    var after = leakRun(s, 4, fn);
    ok(after.bottom === 0 && s.lost === before, 'leaked ' + after.bottom + ' after sealing');
    out.push((shaking ? 'shaken' : 'at rest') + ': ' + r.bottom + ' out, then none');
  });
  return out.join('; ');
});

console.log(failures ? 'leak: ' + failures + ' of ' + count + ' cases FAILED' : 'leak: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
