/*
 * physics-core P0: the interface skeleton and the parts of the glass that
 * already work before motion does: forced cracks, breaches (holeMap and
 * mouths), the leak at rest and the escape ring, kintsugi, persistence,
 * and the flip carrying all of it with the glass. Census invariants are
 * checked after every leak.
 *
 *   node tools/test/sim-p0.test.js        exits 0 when every case passes
 */
'use strict';
var L = require('./lib/load-physics.js');
var Clock = require('./lib/clock.js');

var P = L.P, Sim = P.Sim, MOT = Sim.MOTION, DMG = Sim.DMG;
var EMPTY = P.EMPTY, WALL = P.WALL, REST = P.REST;
var BINS = 40, SEGS = 160;
var FORTY_FIVE = 2700000;

/* ---- a tiny harness: one line per case ---- */
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
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}
function near(a, b, tol, msg) {
  ok(Math.abs(a - b) <= tol, msg + ' (' + a + ' vs ' + b + ')');
}

/* ---- helpers ---- */
function segOf(bulb, side, u) {
  return (bulb * 2 + (side > 0 ? 1 : 0)) * BINS + Math.min(BINS - 1, Math.floor(u * BINS));
}
function flipSeg(s) {
  return (3 - Math.floor(s / BINS)) * BINS + (s % BINS);
}
function row(s, i) { return Math.floor(i / s.W); }
function inside(s, i) {
  var x = i % s.W, y = row(s, i);
  return x >= s.rowMin[y] && x <= s.rowMax[y];
}
function adjacent(s, i, j) {
  var dx = Math.abs((i % s.W) - (j % s.W)), dy = Math.abs(row(s, i) - row(s, j));
  return dx <= 1 && dy <= 1 && (dx || dy);
}
function steps(s, n, each) {
  for (var k = 0; k < n; k++) {
    s.beginFrame();
    s.step();
    if (each) each(s, k);
  }
}
/** A settled glass: grains for a duration, `lower` of them moved to the lower bulb. */
function glass(o) {
  o = o || {};
  var s = new Sim({ scale: o.scale || 1.08, seed: o.seed || 4242 });
  s.reset(o.grains !== undefined ? o.grains : Clock.grainsFor(s, o.durMs || FORTY_FIVE));
  if (o.lower) s.fastForward(Math.round(s.nTop * o.lower));
  steps(s, o.settle === undefined ? 360 : o.settle);
  return s;
}
function census(s) {
  var c = s.census();
  ok(c.total === s.total, 'census total ' + c.total + ' !== sim.total ' + s.total);
  ok(c.top === s.nTop, 'census top ' + c.top + ' !== sim.nTop ' + s.nTop);
}
/** Outward unit normal of wall cell i (the stored normal points into the glass). */
function nOut(s, i) {
  return [-s.nrmX[i] / 127, -s.nrmY[i] / 127];
}
/**
 * Run `secs` at rest, draining the escape ring every frame as the app will.
 * Checks the census every frame and every ring entry against the holes.
 */
function leakRun(s, secs, holes) {
  var top0 = s.leakedTop, bot0 = s.leakedBottom, ring = 0, framed = 0, badPos = 0, badVel = 0;
  var n = Math.round(secs * 120), total0 = s.total + s.lost;
  for (var k = 0; k < n; k++) {
    s.beginFrame();
    s.step();
    framed += s.frame.leaked;
    if (s.frame.leaked) {
      ok(s.frame.leakX >= -1 && s.frame.leakX <= 1, 'leakX out of range: ' + s.frame.leakX);
      census(s);
    }
    for (var e = 0; e < s.escN; e++) {
      ring++;
      var best = 1e9, bn = null;
      for (var h = 0; h < holes.length; h++) {
        var hi = holes[h], nn = nOut(s, hi);
        var hx = (hi % s.W) + 0.5 + nn[0], hy = row(s, hi) + 0.5 + nn[1];
        var d = Math.hypot(s.escX[e] - hx, s.escY[e] - hy);
        if (d < best) { best = d; bn = nn; }
      }
      if (best > 1e-3) badPos++;
      if (s.escVX[e] * bn[0] + s.escVY[e] * bn[1] <= 0) badVel++;
    }
    s.escN = 0;
    ok(s.total + s.lost === total0, 'total + lost changed: ' + (s.total + s.lost) + ' vs ' + total0);
  }
  census(s);
  return { top: s.leakedTop - top0, bottom: s.leakedBottom - bot0, ring: ring, framed: framed, badPos: badPos, badVel: badVel };
}
function events(s) {
  var f = s.frame, out = [];
  for (var e = 0; e < f.dmgN; e++) out.push([f.dmgType[e], f.dmgK[e], f.dmgLevel[e]]);
  return out;
}
function hashState(s) {
  var h = -2128831035, arrs = [s.cell, s.seed, s.holeMap || new Uint8Array(0)], a, i;
  for (a = 0; a < arrs.length; a++) for (i = 0; i < arrs[a].length; i++) { h ^= arrs[a][i]; h = Math.imul(h, 16777619); }
  var nums = [s.rng, s.np, s.nTop, s.total, s.lost, s.leakedTop, s.leakedBottom, s.crackRev, s.escN];
  for (i = 0; i < s.escN; i++) nums.push(s.escX[i], s.escY[i], s.escVX[i], s.escVY[i], s.escS[i]);
  for (i = 0; i < SEGS; i++) nums.push(s.segD[i], s.segS[i]);
  var f = new Float64Array(nums), b = new Uint8Array(f.buffer);
  for (i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ====================================================================== */

test('interface skeleton (every P0 member, types and initial values)', function () {
  var keys = ['tauSlow', 'tauT', 'gzK', 'maxSweeps', 'sweepT', 'weightless', 'neckPress', 'cenEvery',
    'idleA', 'idleW', 'idleAl', 'idleGz', 'idleT', 'fricS0', 'fricS1', 'pCreepMax', 'pSlideMax',
    'pWakeMax', 'pDiagMax', 'liftTh', 'muW', 'sprayV', 'pSpray', 'hopT', 'hopMax', 'softCap', 'vMax'];
  var want = [0.35, 0.25, 1.0, 3, 0.75, 0.15, 0.25, 8, 0.01, 0.15, 2, 0.02, 0.02, 0.15, 0.85, 236, 250,
    230, 240, 0.04, 0.40, 150, 0.35, 0.45, 4, 4096, 1400];
  keys.forEach(function (k, i) { ok(MOT[k] === want[i], 'Sim.MOTION.' + k + ' = ' + MOT[k] + ', spec ' + want[i]); });
  ok(JSON.stringify(DMG) === '{"WARN":1,"CRACK":2,"GROW":3,"BREACH":4,"WIDEN":5,"SEAL":6}', 'Sim.DMG ' + JSON.stringify(DMG));
  var s = new Sim({ scale: 1.08, seed: 7 });
  ['setMotion', 'motionActive', 'agitation', 'airborne', 'inertiaZ', 'segInfo', 'sealCracks',
   'serializeDamage', 'restoreDamage', 'forceCrack'].forEach(function (m) {
    ok(typeof s[m] === 'function', 'missing sim.' + m + '()');
  });
  ok(s.damageArmed === false && s.relCap === 0 && s.reduced === false && s.quality === 2, 'input defaults');
  ok(s.motionActive() === false && s.airborne() === false && s.agitation() === 0, 'readouts at rest');
  ok(s.bf instanceof Float32Array && s.bf.length === 4 && s.agit instanceof Float32Array && s.agit.length === 2, 'bf / agit');
  ok(s.slug.length === 2 && ['air', 'U', 'Z', 'kZ', 'seat'].every(function (k) { return k in s.slug[0] && k in s.slug[1]; }), 'slug[2]');
  ok(s.lost === 0 && s.leakedTop === 0 && s.leakedBottom === 0, 'lost counters');
  ok(Array.isArray(s.cracks) && s.cracks.length === 0 && s.holeMap === null, 'cracks [] and holeMap null');
  ok(s.crackRev === 0 && s.dMax === 0 && s.warnSeg === -1, 'crackRev / dMax / warnSeg');
  var f = s.frame;
  ok(f.thump instanceof Float32Array && f.thump.length === 4 && f.slam instanceof Float32Array && f.slam.length === 2, 'thump / slam');
  ok(f.leaked === 0 && f.leakX === 0 && f.sprayed === 0 && f.hops === 0 && f.dmgN === 0, 'frame counters zero');
  ok(f.dmgType instanceof Uint8Array && f.dmgLevel instanceof Uint8Array && f.dmgX instanceof Float32Array &&
     f.dmgK instanceof Int8Array && f.dmgType.length === 8 && f.dmgK.length === 8, 'damage event queue');
  ['escX', 'escY', 'escVX', 'escVY'].forEach(function (k) { ok(s[k] instanceof Float32Array && s[k].length === 256, k); });
  ok(s.escS instanceof Uint8Array && s.escS.length === 256 && s.escN === 0, 'escS / escN');
  // setMotion stores its inputs; NaN reads as 0
  s.setMotion(10, -20, 1.5, -3, 0.08, -0.5);
  ok(s.mAx === 10 && s.mAy === -20 && s.mW === 1.5 && s.mAl === -3 && Math.abs(s.mLam - 0.08) < 1e-12 && s.mGz === 0.5, 'setMotion stores');
  s.setMotion(NaN, Infinity, undefined, 'x', -1, NaN);
  ok(s.mAx === 0 && s.mAy === 0 && s.mW === 0 && s.mAl === 0 && s.mLam === 0 && s.mGz === 0, 'NaN → 0');
  steps(s, 2);
  ok(s.bf[0] === 0 && s.bf[2] === 0 && s.bf[1] === s.G && s.bf[3] === s.G, 'bf = G·ĝ at rest: ' + Array.from(s.bf));
  ok(s.motionActive() === false, 'step() stays on the idle path');
  // segInfo
  var a = s.segInfo(0), b = s.segInfo(159), c = s.segInfo(85);
  ok(a.bulb === 0 && a.side === -1 && a.u === 0.0125, 'segInfo(0) ' + JSON.stringify(a));
  ok(b.bulb === 1 && b.side === 1 && b.u === 0.9875, 'segInfo(159) ' + JSON.stringify(b));
  ok(c.bulb === 1 && c.side === -1 && c.u === 0.1375, 'segInfo(85) ' + JSON.stringify(c));
  ok(s.segInfo(-1) === null && s.segInfo(160) === null && s.segInfo(1.5) === null, 'segInfo out of range');
  return 'MOTION has ' + Object.keys(MOT).length + ' tunables; setMotion, readouts, frame, ring and segInfo as specified';
});

test('inertiaZ: Σ|r|² of the sand, sampled and cached', function () {
  var s = glass({ durMs: 300000, lower: 0.4, seed: 11 });
  var exact = 0, i, N = s.W * s.H, cx = s.geo.cx, cy = s.geo.cy;
  for (i = 0; i < N; i++) {
    if (s.cell[i] >= REST) {
      var dx = (i % s.W) + 0.5 - cx, dy = row(s, i) + 0.5 - cy;
      exact += dx * dx + dy * dy;
    }
  }
  for (i = 0; i < s.np; i++) exact += Math.pow(s.px[i] - cx, 2) + Math.pow(s.py[i] - cy, 2);
  var iz = s.inertiaZ();
  ok(Math.abs(iz / exact - 1) < 0.01, 'inertiaZ ' + iz.toExponential(4) + ' vs exact ' + exact.toExponential(4));
  ok(s.inertiaZ() === iz, 'second call is the cached value');
  s.fastForward(2000);
  ok(s.inertiaZ() !== iz, 'a bulk move refreshes it');
  return 'sampled ' + iz.toExponential(4) + ' vs exact ' + exact.toExponential(4) + ' (' + ((iz / exact - 1) * 100).toFixed(2) + ' %)';
});

test('wall segments: map covers the glass, point-symmetric under a flip', function () {
  var s = new Sim({ scale: 1.08, seed: 3 }), W = s.W, H = s.H, N = W * H, i, k;
  var per = new Int32Array(SEGS), wrongSet = 0, asym = 0;
  for (i = W + 1; i < N - W - 1; i++) {
    var touch = false;
    if (s.cell[i] === WALL) for (k = -1; k <= 1; k++) for (var d = -1; d <= 1; d++) if (s.cell[i + k * W + d] !== WALL) touch = true;
    if ((s.segOf[i] >= 0) !== touch) wrongSet++;
    if (s.segOf[i] >= 0) per[s.segOf[i]]++;
  }
  for (i = 0; i < N; i++) {
    var a = s.segOf[i], b = s.segOf[N - 1 - i];
    if ((a < 0) !== (b < 0) || (a >= 0 && b !== flipSeg(a))) asym++;
  }
  var emptySegs = 0, minPer = 1e9;
  for (k = 0; k < SEGS; k++) { if (!per[k]) emptySegs++; if (per[k] < minPer) minPer = per[k]; }
  ok(wrongSet === 0, wrongSet + ' cells disagree with "wall touching the inside"');
  ok(emptySegs === 0, emptySegs + ' segments have no wall cell');
  // the one self-symmetric cell, the middle of the closed gate, cannot map to 3 − q
  ok(asym === 1 && s.segOf[s.gateY * W + Math.floor(s.geo.cx)] >= 0, asym + ' cells break the flip symmetry (1 allowed: the centre of the gate)');
  var gl = s.segOf[s.gateY * W + s.gateX0], gr = s.segOf[s.gateY * W + s.gateX1];
  ok(Math.floor(gl / BINS) === 0 && Math.floor(gr / BINS) === 3, 'gate row split by side: ' + gl + ', ' + gr);
  return per.reduce(function (x, y) { return x + y; }, 0) + ' wall cells in 160 segments (min ' + minPer + ' per segment)';
});

test('forceCrack: sites, holes in holeMap, mouths, events, the 3-crack cap', function () {
  var sites = [
    ['upper funnel L', segOf(0, -1, 0.15)], ['upper funnel R', segOf(0, 1, 0.15)],
    ['upper equator R', segOf(0, 1, 0.66)], ['upper dome tip L', segOf(0, -1, 0.99)],
    ['waist (u bin 0) L', segOf(0, -1, 0.0)], ['waist (u bin 0) lower R', segOf(1, 1, 0.0)],
    ['lower funnel L', segOf(1, -1, 0.2)], ['lower equator R', segOf(1, 1, 0.66)],
    ['lower dome R', segOf(1, 1, 0.9)], ['lower dome tip L', segOf(1, -1, 0.99)]
  ];
  var notes = [];
  [1.08, 1.3].forEach(function (scale) {
    sites.forEach(function (st) {
      var s = new Sim({ scale: scale, seed: 5 }), W = s.W, gate = s.gateY, sg = st[1];
      s.beginFrame();
      var rev0 = s.crackRev, cr = s.forceCrack(sg, 40, 3), tag = st[0] + ' @' + scale;
      ok(cr && s.cracks.length === 1 && s.cracks[0] === cr, tag + ': no record');
      ok(cr.seg === sg && cr.bulb === (sg >= 80 ? 1 : 0) && cr.side === (Math.floor(sg / 40) % 2 ? 1 : -1), tag + ': bulb/side');
      ok(cr.L === 40 && cr.w === 3 && cr.nh === 3 && !cr.sealed && cr.born === s.steps, tag + ': L/w/nh ' + cr.L + '/' + cr.w + '/' + cr.nh);
      ok(cr.holes instanceof Int32Array && cr.holes.length === 3 && cr.mouth instanceof Int32Array && cr.mouth.length === 24, tag + ': arrays');
      ok(cr.seed === cr.seed >>> 0 && cr.u >= 0 && cr.u < 1 && typeof cr.id === 'number', tag + ': seed/u/id');
      var i0 = cr.y * W + cr.x;
      ok(s.cell[i0] === WALL && Math.floor(s.segOf[i0] / BINS) === Math.floor(sg / BINS), tag + ': origin is not glass of that bulb/side');
      ok(cr.holes[0] === i0, tag + ': the breach must open at the origin');
      for (var h = 0; h < cr.nh; h++) {
        var hi = cr.holes[h];
        ok(s.cell[hi] === WALL && s.holeMap[hi] === 1, tag + ': hole ' + h + ' not WALL + holeMap');
        ok(Math.abs(row(s, hi) - gate) >= 4, tag + ': hole within 4 rows of the gate');
        ok((row(s, hi) < gate) === (cr.bulb === 0) && Math.floor(s.segOf[hi] / BINS) === Math.floor(sg / BINS), tag + ': hole in the wrong block');
      }
      var holeCount = 0;
      for (var q = 0; q < s.holeMap.length; q++) holeCount += s.holeMap[q];
      ok(holeCount === 3, tag + ': holeMap has ' + holeCount + ' cells');
      ok(cr.nm > 0, tag + ': no mouth');
      for (q = 0; q < cr.nm; q++) {
        var m = cr.mouth[q];
        ok(inside(s, m) && (row(s, m) < gate) === (cr.bulb === 0), tag + ': mouth cell not inside its bulb');
        ok(cr.holes.slice(0, cr.nh).some(function (hh) { return adjacent(s, hh, m); }), tag + ': mouth not beside a hole');
        for (var r = 0; r < q; r++) ok(cr.mouth[r] !== m, tag + ': duplicate mouth');
      }
      var ev = events(s);
      ok(ev.length === 2 && ev[0][0] === DMG.CRACK && ev[0][1] === 0 && ev[1][0] === DMG.BREACH && ev[1][1] === 0, tag + ': events ' + JSON.stringify(ev));
      ok(s.crackRev > rev0 && s.nOpen === 1, tag + ': crackRev/nOpen');
      if (scale === 1.08) notes.push(st[0].split(' ').map(function (w) { return w.charAt(0); }).join('') + ' nm' + cr.nm);
    });
  });
  // re-forcing a cracked segment returns the same record; the fourth crack is refused
  var s = new Sim({ scale: 1.08, seed: 5 });
  var a = s.forceCrack(segOf(1, 1, 0.9), 30, 0);
  s.beginFrame();
  var a2 = s.forceCrack(segOf(1, 1, 0.9), 50, 1);
  ok(a2 === a && s.cracks.length === 1 && a.L === 50 && a.w === 1, 're-force grows the same crack');
  ok(events(s).length === 1 && events(s)[0][0] === DMG.BREACH, 're-force emits only BREACH: ' + JSON.stringify(events(s)));
  ok(s.forceCrack(segOf(0, 1, 0.5), 10, 0) && s.forceCrack(segOf(0, -1, 0.5), 10, 0), 'second and third');
  ok(s.forceCrack(segOf(1, -1, 0.5), 10, 0) === null && s.cracks.length === 3, 'the fourth crack is refused');
  ok(s.forceCrack(-1, 10, 1) === null && s.forceCrack(160, 10, 1) === null, 'invalid segments');
  return sites.length + ' sites × 2 scales: holes WALL in holeMap, ≥ 4 rows from the gate, mouths inside and adjacent';
});

test('leak at rest, lower dome: rates by width, ring entries, census (acceptance 6)', function () {
  var rates = [], lim = [[0, 0.2], [0.5, 4], [2, 12]], out = [];
  [1, 2, 3].forEach(function (w) {
    var s = glass({ lower: 1, seed: 21 + w });
    var cr = s.forceCrack(segOf(1, 1, 0.9), 40, w);
    var nTop0 = s.nTop, holes = Array.prototype.slice.call(cr.holes, 0, cr.nh);
    var r = leakRun(s, 10, holes);
    var rate = r.bottom / 10;
    rates.push(rate);
    ok(rate >= lim[w - 1][0] && rate <= lim[w - 1][1], 'w=' + w + ': ' + rate.toFixed(2) + ' grains/s, want ' + lim[w - 1].join('–'));
    ok(r.top === 0 && s.nTop === nTop0, 'w=' + w + ': a lower-bulb leak touched nTop/leakedTop');
    ok(r.ring === r.bottom && r.framed === r.bottom && s.lost === r.bottom, 'w=' + w + ': ring ' + r.ring + ', frames ' + r.framed + ', escapes ' + r.bottom);
    ok(r.badPos === 0 && r.badVel === 0, 'w=' + w + ': ' + r.badPos + ' entries away from a hole, ' + r.badVel + ' moving inward');
    out.push('w' + w + ' ' + rate.toFixed(2) + '/s');
  });
  // shaken (T = 1): the leak law opens a one-grain breach (P0 sets the temperature by hand)
  var s = glass({ lower: 1, seed: 29 });
  var cr = s.forceCrack(segOf(1, 1, 0.9), 40, 1);
  s.agit[1] = 1;
  var r = leakRun(s, 5, [cr.holes[0]]);
  ok(r.bottom / 5 >= 4, 'shaken w=1: ' + (r.bottom / 5).toFixed(2) + ' grains/s, want ≥ 4');
  out.push('shaken w1 ' + (r.bottom / 5).toFixed(1) + '/s');
  return out.join(', ') + '; every escape in the ring, at the hole, moving out';
});

test('leak from the upper bulb: nTop and leakedTop follow, census holds', function () {
  var s = glass({ seed: 31 });
  var cr = s.forceCrack(segOf(0, -1, 0.15), 40, 3);
  var nTop0 = s.nTop, total0 = s.total;
  var r = leakRun(s, 8, Array.prototype.slice.call(cr.holes, 0, cr.nh));
  ok(r.top > 0 && r.bottom === 0, 'upper funnel breach: top ' + r.top + ', bottom ' + r.bottom);
  ok(s.nTop === nTop0 - r.top && s.total === total0 - r.top && s.leakedTop === r.top, 'nTop/total/leakedTop bookkeeping');
  ok(r.ring === r.top, 'ring entries ' + r.ring + ' vs escapes ' + r.top);
  return r.top + ' grains out in 8 s (' + (r.top / 8).toFixed(2) + '/s); nTop ' + nTop0 + ' → ' + s.nTop;
});

test('escape ring: entries until full, overflow still counted in lost', function () {
  var s = glass({ lower: 1, seed: 41 });
  s.forceCrack(segOf(1, 1, 0.9), 40, 3);
  s.agit[1] = 1;
  var n = 0;
  while (s.lost < 300 && n++ < 120 * 60) { s.beginFrame(); s.step(); }
  ok(s.lost >= 300 && s.escN === 256, 'lost ' + s.lost + ', escN ' + s.escN);
  census(s);
  return s.lost + ' escapes undrained: escN stays 256, lost counts all';
});

test('a grain flying into a breach leaves with its own velocity (legacy _particles)', function () {
  var out = [];
  [[1, 1, 0.9], [0, -1, 0.15]].forEach(function (site) {
    var s = new Sim({ scale: 1.08, seed: 51 });
    s.reset(0);                                    // an empty glass
    var cr = s.forceCrack(segOf(site[0], site[1], site[2]), 40, 1);
    var hole = cr.holes[0], m = cr.mouth[0], W = s.W;
    var hx = (hole % W) + 0.5, hy = row(s, hole) + 0.5, mx = (m % W) + 0.5, my = row(s, m) + 0.5;
    var d = Math.hypot(hx - mx, hy - my), vx = (hx - mx) / d * 150, vy = (hy - my) / d * 150;
    var p = s.np++;
    s.px[p] = mx; s.py[p] = my; s.pvx[p] = vx; s.pvy[p] = vy; s.pseed[p] = 77; s.pinfo[p] = 8;
    s.total++;
    var top = my < s.gateY;
    if (top) s.nTop++;
    census(s);
    steps(s, 1);
    ok(s.np === 0 && s.lost === 1 && s.total === 0 && s.nTop === 0, 'escape bookkeeping: np ' + s.np + ', lost ' + s.lost);
    ok(top ? s.leakedTop === 1 : s.leakedBottom === 1, 'leaked counter of the right bulb');
    ok(s.escN === 1 && s.escS[0] === 77, 'ring entry with the grain\'s seed');
    var v = Math.hypot(s.escVX[0], s.escVY[0]), n = nOut(s, hole);
    ok(Math.abs(v - 150) < 30 && s.escVX[0] * n[0] + s.escVY[0] * n[1] > 0, 'own velocity, outward: |v| ' + v.toFixed(1));
    census(s);
    out.push((top ? 'upper' : 'lower') + ' |v| ' + v.toFixed(0));
  });
  // a sealed breach is glass again: the grain bounces
  var s = new Sim({ scale: 1.08, seed: 52 });
  s.reset(0);
  var cr = s.forceCrack(segOf(1, 1, 0.9), 40, 1);
  s.sealCracks();
  var hole = cr.holes[0], W = s.W;
  var hx = (hole % W) + 0.5, hy = row(s, hole) + 0.5, n = nOut(s, hole);
  var p = s.np++;
  s.px[p] = hx - 1.5 * n[0]; s.py[p] = hy - 1.5 * n[1]; s.pvx[p] = n[0] * 150; s.pvy[p] = n[1] * 150;
  s.pseed[p] = 9; s.pinfo[p] = 8; s.total++;
  steps(s, 1);
  ok(s.lost === 0 && s.escN === 0 && s.total === 1, 'a sealed hole let a grain out');
  census(s);
  return out.join(', ') + '; a sealed hole bounces it';
});

test('sealCracks: leaking stops within one step, the seam is stronger', function () {
  var s = glass({ lower: 1, seed: 61 });
  var cr = s.forceCrack(segOf(1, 1, 0.9), 40, 3);
  steps(s, 600);
  ok(s.leakedBottom > 10, 'it leaked first (' + s.leakedBottom + ')');
  var S0 = s.segS[cr.seg], rev = s.crackRev, before = s.leakedBottom;
  s.beginFrame();
  var n = s.sealCracks();
  ok(n === 1 && cr.sealed && cr.nm === 0 && s.nOpen === 0, 'sealed ' + n + ', nm ' + cr.nm);
  ok(s.crackRev > rev && events(s).length === 1 && events(s)[0][0] === DMG.SEAL && events(s)[0][1] === 0, 'SEAL event and crackRev');
  for (var h = 0; h < cr.nh; h++) ok(s.holeMap[cr.holes[h]] === 0 && s.cell[cr.holes[h]] === WALL, 'hole still marked');
  ok(s.segD[cr.seg] === 0 && Math.abs(s.segS[cr.seg] - S0 * 1.5) < 1e-6, 'segD ' + s.segD[cr.seg] + ', S ×' + (s.segS[cr.seg] / S0).toFixed(3));
  steps(s, 1);
  ok(s.leakedBottom === before, 'leaked on the step after sealing');
  steps(s, 240);
  ok(s.leakedBottom === before && s.sealCracks() === 0, 'leaked later, or sealed twice');
  census(s);
  var quietBy = -1;
  for (var k = 0; k < 2400 && quietBy < 0; k++) { s.beginFrame(); s.step(); if (!s.isActive()) quietBy = k; }
  ok(quietBy >= 0, 'the glass never went idle after sealing');
  return 'sealed after ' + before + ' escapes; S ×1.5; no escape since; idle after ' + quietBy + ' steps';
});

test('completeFlip carries the crack, its holes and its leak (acceptance 7)', function () {
  var s = glass({ lower: 1, seed: 71 }), W = s.W, H = s.H, N = W * H, h;
  var cr = s.forceCrack(segOf(1, 1, 0.66), 40, 3);           // lower equator, right: leaks either way up
  var a = leakRun(s, 3, Array.prototype.slice.call(cr.holes, 0, cr.nh));
  ok(a.bottom > 0, 'it leaked before the flip');
  var before = {
    seg: cr.seg, x: cr.x, y: cr.y, bulb: cr.bulb, side: cr.side, u: cr.u,
    holes: Array.prototype.slice.call(cr.holes, 0, cr.nh), mouth: Array.prototype.slice.call(cr.mouth, 0, cr.nm),
    map: new Uint8Array(s.holeMap), segD: new Float32Array(s.segD), segS: new Float32Array(s.segS), rev: s.crackRev
  };
  s.completeFlip();
  ok(cr.bulb === 1 - before.bulb && cr.side === -before.side && cr.u === before.u, 'bulb/side/u');
  ok(cr.x === W - 1 - before.x && cr.y === H - 1 - before.y && cr.seg === flipSeg(before.seg), 'origin and segment');
  for (h = 0; h < cr.nh; h++) ok(cr.holes[h] === N - 1 - before.holes[h], 'hole ' + h + ' not remapped');
  for (h = 0; h < cr.nm; h++) ok(cr.mouth[h] === N - 1 - before.mouth[h], 'mouth ' + h + ' not remapped');
  for (var i = 0; i < N; i++) if (s.holeMap[i] !== before.map[N - 1 - i]) throw new Error('holeMap is not the reverse at ' + i);
  for (var q = 0; q < SEGS; q++) {
    ok(s.segD[flipSeg(q)] === before.segD[q] && s.segS[flipSeg(q)] === before.segS[q], 'segment arrays not remapped at ' + q);
  }
  ok(s.crackRev > before.rev, 'crackRev');
  for (h = 0; h < cr.nh; h++) {
    var hi = cr.holes[h];
    ok(s.cell[hi] === WALL && Math.floor(s.segOf[hi] / BINS) === Math.floor(cr.seg / BINS), 'the remapped hole is not glass of its new block');
  }
  for (h = 0; h < cr.nm; h++) ok(inside(s, cr.mouth[h]) && row(s, cr.mouth[h]) < s.gateY, 'remapped mouth not inside the upper bulb');
  census(s);
  steps(s, 480);                                             // the sand falls to its new floor
  var b = leakRun(s, 6, Array.prototype.slice.call(cr.holes, 0, cr.nh));
  ok(b.top > 0 && b.bottom === 0, 'after the flip it leaks from the upper bulb: top ' + b.top + ', bottom ' + b.bottom);
  ok(b.badPos === 0 && b.badVel === 0, 'escapes after the flip come out of the same place on the glass');
  // turning it back restores everything
  s.completeFlip();
  ok(cr.seg === before.seg && cr.x === before.x && cr.holes[0] === before.holes[0], 'a second flip restores the crack');
  for (q = 0; q < SEGS; q++) ok(s.segS[q] === before.segS[q], 'a second flip restores the flaws');
  return 'leaked ' + a.bottom + ' below, flipped, then ' + b.top + ' from the same breach above; holeMap, holes, mouths, segments remapped';
});

test('serializeDamage → JSON → restoreDamage reproduces the glass (acceptance 8)', function () {
  var s = glass({ lower: 1, seed: 81 });
  var c = s.forceCrack(segOf(1, -1, 0.9), 30, 1);           // mended first
  s.sealCracks();
  var a = s.forceCrack(segOf(1, 1, 0.9), 40, 2);            // open and leaking
  steps(s, 360);
  var b = s.forceCrack(segOf(0, 1, 0.3), 12.34, 0);         // a hairline, no breach
  s.segD[segOf(0, -1, 0.5)] = 0.42;
  s.segD[segOf(1, -1, 0.3)] = 0.81;
  s.segD[segOf(0, 1, 0.8)] = 0.007;
  s.completeFlip();                                          // an odd number of flips since the flaws
  ok(s.lost > 0 && c.sealed && !a.sealed && b.w === 0, 'setup');
  var json = JSON.stringify(s.serializeDamage());
  ok(json.length < 8192, 'JSON is ' + json.length + ' bytes');
  var o = JSON.parse(json);
  var t = new Sim({ scale: 1.08, seed: 999 });
  t.reset(s.total);
  t.beginFrame();
  ok(t.restoreDamage(o) === true, 'restoreDamage refused its own output');
  ok(t.frame.dmgN === 0, 'restoring made events (it must stay quiet)');
  for (var q = 0; q < SEGS; q++) near(t.segD[q], s.segD[q], 1e-3, 'segD[' + q + ']');
  for (q = 0; q < SEGS; q++) ok(t.segS[q] === s.segS[q], 'segS[' + q + '] ' + t.segS[q] + ' vs ' + s.segS[q]);
  ok(t.glassSeed === s.glassSeed && t.glassFlip === s.glassFlip && t.glassFlip === 1, 'glassSeed / glassFlip');
  ok(t.cracks.length === 3, t.cracks.length + ' cracks');
  s.cracks.forEach(function (x, k) {
    var y = t.cracks[k];
    ['seg', 'bulb', 'side', 'x', 'y', 'seed', 'w', 'nh', 'sealed', 'nm', 'u'].forEach(function (f) {
      ok(x[f] === y[f], 'crack ' + k + '.' + f + ': ' + y[f] + ' vs ' + x[f]);
    });
    near(y.L, x.L, 0.05, 'crack ' + k + '.L');
    for (var h = 0; h < x.nh; h++) ok(x.holes[h] === y.holes[h], 'crack ' + k + ' hole ' + h);
    var mx = Array.prototype.slice.call(x.mouth, 0, x.nm).sort(), my = Array.prototype.slice.call(y.mouth, 0, y.nm).sort();
    ok(mx.join() === my.join(), 'crack ' + k + ' mouth');
    ok(t.segCrack[y.seg] === k, 'segCrack of crack ' + k);
  });
  ok(Buffer.compare(Buffer.from(t.holeMap.buffer), Buffer.from(s.holeMap.buffer)) === 0, 'holeMap differs');
  ok(t.lost === s.lost && t.leakedTop === s.leakedTop && t.leakedBottom === s.leakedBottom, 'lost counters');
  s._scanDamage(false);
  ok(t.dMax === s.dMax && t.warnSeg === s.warnSeg && t.nOpen === s.nOpen, 'dMax/warnSeg/nOpen');
  ok(JSON.stringify(t.serializeDamage()) === json, 'a second round trip changes the JSON');
  // the restored breach leaks like the original
  var r = leakRun(t, 2, Array.prototype.slice.call(t.cracks[1].holes, 0, t.cracks[1].nh));
  ok(t.lost === s.lost + r.top + r.bottom, 'restored lost counter keeps counting');
  return json.length + ' bytes; segD, flaws (incl. the mended ×1.5 and the flip), 3 cracks, holeMap, mouths, counters equal';
});

test('serializeDamage is null while pristine; bad input never restores', function () {
  var s = new Sim({ scale: 1.08, seed: 91 });
  ok(s.serializeDamage() === null, 'a new glass serialises to null');
  s.forceCrack(segOf(1, 1, 0.9), 40, 2);
  ok(s.serializeDamage() !== null, 'a cracked glass serialises');
  s.reset(s.total);
  ok(s.serializeDamage() === null, 'reset gives a pristine glass');
  var good = (function () {
    var u = new Sim({ scale: 1.08, seed: 92 });
    u.forceCrack(segOf(1, 1, 0.9), 40, 2);
    return u.serializeDamage();
  })();
  function variant(fn) { var o = JSON.parse(JSON.stringify(good)); fn(o); return o; }
  var gate = s.gateY, W = s.W;
  var bad = [
    undefined, null, 5, 'x', {}, { v: 2 },
    variant(function (o) { o.seed = -1; }),
    variant(function (o) { o.seed = 1.5; }),
    variant(function (o) { o.W = 249; }),
    variant(function (o) { o.d = [1, 2]; }),
    variant(function (o) { o.d = new Array(160).fill(0); o.d[3] = NaN; }),
    variant(function (o) { o.c = 'x'; }),
    variant(function (o) { o.c[0][0] = 160; }),
    variant(function (o) { o.c[0][0] = 3; }),                       // segment of another block
    variant(function (o) { o.c[0][1] = 9999; }),
    variant(function (o) { o.c[0][5] = 3; }),                       // w and hole list disagree
    variant(function (o) { o.c[0][7] = o.c[0][8]; }),               // breach not at the origin
    variant(function (o) { o.c[0][8] = 0; }),                       // a hole that is not glass by the inside
    variant(function (o) { o.c[0][8] = (gate + 2) * W + s.rowMax[gate + 2] + 1; }),   // too near the gate
    variant(function (o) { o.c.push(o.c[0].slice()); }),            // the same segment twice
    variant(function (o) { o.c = [o.c[0], o.c[0], o.c[0], o.c[0]]; })
  ];
  var t = new Sim({ scale: 1.08, seed: 93 });
  bad.forEach(function (o, k) {
    t.reset(t.total);
    var r;
    try { r = t.restoreDamage(o); } catch (e) { throw new Error('bad input ' + k + ' threw: ' + e.message); }
    ok(r === false, 'bad input ' + k + ' was accepted');
    ok(t.cracks.length === 0 && t.holeMap === null && t.lost === 0 && t.serializeDamage() === null, 'bad input ' + k + ' left damage behind');
  });
  t.reset(t.total);
  ok(t.restoreDamage(good) === true && t.cracks.length === 1, 'the good input');
  return bad.length + ' malformed inputs refused without a trace; good input accepted';
});

test('micro-damage relaxes on the idle path; cracked stretches do not', function () {
  var s = new Sim({ scale: 1.08, seed: 101 });
  var d = new Array(160).fill(0), sA = segOf(0, 1, 0.5), sB = segOf(1, -1, 0.4);
  d[sA] = 0.5; d[sB] = 0.3;
  ok(s.restoreDamage({ v: 1, seed: s.glassSeed, d: d, c: [] }), 'restore');
  ok(s.dMax === 0.5 && s.warnSeg === sA && s.warnLatch[0] === 1 && s.warnLatch[1] === 0, 'dMax/warnSeg/latch after restore');
  var cr = s.forceCrack(segOf(1, 1, 0.9), 40, 0);
  var warned = 0;
  steps(s, 120, function (x) { warned += x.frame.dmgN; });
  near(s.segD[sA], 0.5 * Math.pow(1 - 1 / 960, 120), 2e-6, 'segD after 1 s');
  ok(s.dMax === s.segD[sA] && s.segD[cr.seg] === 1, 'dMax follows; the cracked segment holds');
  ok(warned === 0, 'falling damage sounded a creak');
  steps(s, 120 * 8);
  ok(s.warnLatch[0] === 0, 'level 1 re-armed once well below it (dMax ' + s.dMax.toFixed(3) + ')');
  return 'segD 0.5 → ' + s.segD[sA].toFixed(3) + ' in 9 s, the crack stays at 1, level 1 re-armed';
});

test('reset: a new glass (no damage, new flaws, same sand)', function () {
  var s = glass({ lower: 1, seed: 111 });
  var cracks = s.cracks, S0 = new Float32Array(s.segS), seed0 = s.glassSeed;
  s.forceCrack(segOf(1, 1, 0.9), 40, 3);
  steps(s, 240);
  s.completeFlip();
  var rev = s.crackRev;
  ok(s.lost > 0 && s.escN > 0, 'setup leaked');
  s.reset(10000);
  ok(s.cracks === cracks && s.cracks.length === 0 && s.holeMap === null && s.crackRev > rev, 'cracks/holeMap/crackRev');
  ok(s.lost === 0 && s.leakedTop === 0 && s.leakedBottom === 0 && s.escN === 0 && s.nOpen === 0, 'counters');
  ok(s.dMax === 0 && s.warnSeg === -1 && s.glassFlip === 0, 'dMax/warnSeg/flip');
  for (var q = 0; q < SEGS; q++) ok(s.segD[q] === 0 && s.segP[q] === 0, 'segD/segP');
  var same = 0;
  for (q = 0; q < SEGS; q++) if (s.segS[q] === S0[q]) same++;
  ok(s.glassSeed !== seed0 && same < 5, 'new flaws (' + same + ' equal)');
  // the flaws come from glassSeed alone; the sand from the same seed is unchanged
  var a = new Sim({ scale: 1.08, seed: 112 }), b = new Sim({ scale: 1.08, seed: 112 });
  ok(a.glassSeed === b.glassSeed && a.segS.every(function (v, k) { return v === b.segS[k]; }), 'flaws are deterministic');
  var o = new (L.baseline().Sim)({ scale: 1.08, seed: 112 });
  ok(Buffer.compare(Buffer.from(a.seed.buffer), Buffer.from(o.seed.buffer)) === 0 && a.rng === o.rng, 'drawing the flaws touched the sand\'s random stream');
  census(s);
  return 'cracks, holes, damage, counters and ring cleared; new Weibull set; rng untouched';
});

test('_freeNear never answers across the closed neck; deep climbs further', function () {
  var OLD = L.baseline();
  function setup(S) {
    var s = new S({ scale: 1.08, seed: 121 });
    s.reset(0);
    for (var y = s.gateY - 20; y < s.gateY; y++) for (var x = s.rowMin[y]; x <= s.rowMax[y]; x++) s.cell[y * s.W + x] = REST;
    return s;
  }
  var n = setup(Sim), o = setup(OLD.Sim), W = n.W, gate = n.gateY;
  var i = (gate - 1) * W + Math.floor(n.geo.cx);
  var jo = o._freeNear(i, W), jn = n._freeNear(i, W);
  ok(jo >= 0 && row(o, jo) > gate, 'the old search should have crossed the neck (got ' + jo + ')');
  ok(jn === -1 && n.neckGuards > 0, 'the new search crossed or found something: ' + jn);
  var jd = n._freeNear(i, W, true);
  ok(jd >= 0 && row(n, jd) === gate - 21 && n.cell[jd] === EMPTY, 'deep climb: ' + jd);
  // a normal landing answers exactly as before
  var a = glass({ durMs: 300000, lower: 0.5, seed: 122 }), b = new OLD.Sim({ scale: 1.08, seed: 122 });
  b.reset(Clock.grainsFor(b, 300000)); b.fastForward(Math.round(b.nTop * 0.5));
  for (var k = 0; k < 360; k++) { b.beginFrame(); b.step(); }
  var mism = 0, tries = 0;
  for (var y = gate + 2; y < a.H - 2; y += 3) {
    for (var x = a.rowMin[y]; x <= a.rowMax[y]; x += 3) {
      var c = y * W + x;
      if (a.cell[c] < REST) continue;
      tries++;
      if (a._freeNear(c, W) !== b._freeNear(c, W)) mism++;
    }
  }
  ok(tries > 100 && mism === 0, mism + ' of ' + tries + ' ordinary answers changed');
  return 'old answer crossed to row ' + row(o, jo) + ', new refuses (' + n.neckGuards + ' refusals); deep finds row gate−21; ' + tries + ' ordinary answers unchanged';
});

test('_ca(…, forceFull) sweeps sleeping rows', function () {
  function setup(S) {
    var s = new S({ scale: 1.08, seed: 131 });
    s.reset(0);
    var i = (s.gateY + 100) * s.W + Math.floor(s.geo.cx);
    s.cell[i] = REST;
    s.rowAct.fill(0);
    s.steps = 1;
    return { s: s, i: i };
  }
  var a = setup(Sim);
  a.s._ca(0, 1, 1, a.s.H - 1);
  ok(a.s.cell[a.i] === REST, 'a sleeping row was swept without forceFull');
  a.s._ca(0, 1, 1, a.s.H - 1, true);
  ok(a.s.cell[a.i] === EMPTY && a.s.cell[a.i + a.s.W] !== EMPTY, 'forceFull did not sweep the sleeping row');
  return 'asleep: untouched; forceFull: the grain falls';
});

test('determinism: same seed and inputs, same glass', function () {
  function run() {
    var s = glass({ lower: 0.6, seed: 141, durMs: 300000 });
    s.forceCrack(segOf(1, 1, 0.66), 40, 3);
    s.forceCrack(segOf(0, -1, 0.2), 40, 2);
    steps(s, 600);
    s.completeFlip();
    steps(s, 600);
    s.sealCracks();
    steps(s, 120);
    return hashState(s);
  }
  var h1 = run(), h2 = run();
  ok(h1 === h2, 'hashes differ: ' + h1 + ' vs ' + h2);
  return 'hash 0x' + h1.toString(16);
});

test('isActive while a breach passes sand, beginFrame clears the frame', function () {
  var s = glass({ lower: 1, seed: 151, settle: 1200 });
  ok(!s.isActive(), 'the settled glass should be idle');
  s.forceCrack(segOf(1, 1, 0.66), 40, 2);
  var idle = 0, leaks = 0;
  steps(s, 120 * 6, function (x) { if (!x.isActive()) idle++; leaks += x.frame.leaked; });
  ok(idle === 0 && leaks > 0, 'idle for ' + idle + ' steps while leaking (' + leaks + ' escapes)');
  s.frame.thump[0] = 1; s.frame.slam[1] = 1; s.frame.sprayed = 3; s.frame.hops = 2; s.frame.leaked = 4; s.frame.leakX = 0.5;
  s.forceCrack(segOf(0, 1, 0.5), 10, 0);
  ok(s.frame.dmgN > 0, 'an event was queued');
  s.beginFrame();
  var f = s.frame;
  ok(f.thump[0] === 0 && f.slam[1] === 0 && f.sprayed === 0 && f.hops === 0 && f.leaked === 0 && f.leakX === 0 && f.dmgN === 0, 'beginFrame left values');
  return 'active through ' + leaks + ' slow escapes (w = 2, sideways: ' + (leaks / 6).toFixed(2) + '/s)';
});

test('lib/clock.js: app.js\'s clock, valve settings and the re-timing rule', function () {
  var s = new Sim({ scale: 1.08, seed: 161 });
  s.reset(Clock.grainsFor(s, 120000));
  var T = new Clock(s, 120000), r;
  ok(Math.abs(T.topAt(120000) - s.total) < 1e-6 && Math.abs(T.topAt(T.tailMs) - T.tailGrains) < 1e-9, 'calibrate: full glass at the start, tail at tailMs');
  for (r = 50; r < 120000; r += 997) near(T.remAt(T.topAt(r)), r, 1e-6, 'remAt(topAt(' + r + '))');
  ok(T.topAt(0) === 0 && T.remAt(0) === 0 && T.mpg0 === T.mpg, 'ends and mpg0');
  T.start();
  ok(T.apply(0) && s.gateOpen && !s.deepRelease && s.targetTop === T.target(0) &&
     s.topSweeps === Math.min(6, Math.floor(T.rate / 260)), 'apply while running');
  ok(!T.apply(0, true) && !s.gateOpen && s.targetTop === s.nTop && s.topSweeps === 0, 'apply while turning');
  ok(T.target(0, true) === Math.ceil(T.topAt(T.rem) - 1e-7), 'smooth target');
  ok(T.relCap(false) === 0 && Math.abs(T.relCap(true) - T.rate / 120 * 3) < 1e-9, 'relCap in the bulk: 3× the rate');
  // run 20 s, then lose 200 grains from the top as a leak would; re-time once calm
  for (var k = 0; k < 2400; k++) { T.tick(Clock.DT_MS); T.apply(k * Clock.DT_MS, false, true); s.beginFrame(); s.step(); }
  ok(!T.maybeRetime(1, 20000), 'nothing to re-time while the sand matches the clock');
  var taken = 0;
  for (var y = s.topY; y < s.gateY && taken < 200; y++) {
    for (var x = s.rowMin[y]; x <= s.rowMax[y] && taken < 200; x++) {
      var i = y * s.W + x;
      if (s.cell[i] >= REST) { s.cell[i] = EMPTY; s.total--; s.nTop--; taken++; }
    }
  }
  census(s);
  ok(!T.maybeRetime(0.5, 20000), 're-timed before 0.75 s of calm');
  var mpg = T.mpg;
  ok(T.maybeRetime(0.8, 20000), 'did not re-time after a 200-grain loss');
  near(T.topAt(T.rem), s.nTop, 1e-6, 're-timed clock');
  // fewer grains for the same time: each takes longer, the thread runs a little slower
  ok(T.mpg > mpg && T.retimes === 1 && !T.maybeRetime(5, 20200), 'slower stream, at most once per 0.5 s');
  // a tick to the end reports 00:00.0 once and stops the clock
  T.rem = 5; T.state = 'running';
  ok(T.tick(10) === true && T.state === 'done' && T.rem === 0 && T.tick(10) === false, 'tick to the end');
  return 'mpg ' + mpg.toFixed(2) + ' → ' + T.mpg.toFixed(2) + ' ms/grain after losing 200 grains';
});

test('lib/profiles.js: every profile, and device events in both sign conventions', function () {
  var Pr = require('./lib/profiles.js'), out = {}, peak = {};
  Pr.names.forEach(function (n) {
    var p = Pr.PROFILES[n], m = 0;
    for (var t = 0; t < p.dur; t += 1 / 120) {
      Pr.sample(n, t, out);
      ok(isFinite(out.x) && isFinite(out.y) && isFinite(out.z) && isFinite(out.w) && isFinite(out.al), n + ' gave a non-number');
      m = Math.max(m, Math.hypot(out.x, out.y), Math.abs(out.w));
    }
    peak[n] = m;
  });
  ok(Pr.names.length === 23 && peak.calm === 0 && peak.drop >= 12 && peak.hardJerks >= 8 && peak.tableSpin > 9, 'profile set');
  ok(peak.veryVigSlow > 5 && peak.lateralVV > 5.5 && peak.walking < 0.4, 'profile peaks');
  // invert the synthesiser the way motion.js will, for every convention and screen angle
  var G0 = Pr.G0, f = { x: 0.5, y: -0.3, z: 0.1, w: 2 }, n = 0;
  ['spec', 'ios', 'ios-g'].forEach(function (conv) {
    [0, 90, -90, 180].forEach(function (o) {
      var e = Pr.deviceEvent(f, { conv: conv, o: o }), sign = conv === 'spec' ? 1 : -1, unit = conv === 'ios-g' ? G0 : 1;
      var k = [sign * e.acceleration.x * unit, sign * e.acceleration.y * unit, sign * e.acceleration.z * unit];
      var g = Pr.toPage(-k[0] / G0, k[1] / G0, o);         // felt = −k/g; device y up → screen y down
      near(g[0], f.x, 1e-9, conv + ' o' + o + ' felt x');
      near(g[1], f.y, 1e-9, conv + ' o' + o + ' felt y');
      near(-k[2] / G0, f.z, 1e-9, conv + ' o' + o + ' felt z');
      // accelerationIncludingGravity − acceleration is gravity's reaction: up, (0, +g, 0) when upright
      near(sign * unit * (e.accelerationIncludingGravity.y - e.acceleration.y), G0, 1e-9, conv + ' gravity');
      near(Math.abs(e.rotationRate.alpha), 2 * 180 / Math.PI, 1e-9, conv + ' rotation rate');
      n++;
    });
  });
  var flat = Pr.deviceEvent({ x: 0, y: 0 }, { beta: 0, gamma: 0 });
  near(flat.accelerationIncludingGravity.z, G0, 1e-9, 'face up, spec: aIG.z = +g');
  ok(Pr.deviceEvent(f, { noAccel: true }).acceleration === null, 'noAccel');
  return Pr.names.length + ' profiles finite; ' + n + ' convention × angle round trips exact';
});

console.log(failures ? 'sim-p0: ' + failures + ' of ' + count + ' cases FAILED' : 'sim-p0: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
