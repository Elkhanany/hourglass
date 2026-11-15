/*
 * renderer, in Node (no browser): the crack paths, the redraw policy of
 * syncDamage, and the Spill's physics. Canvases are stand-ins that record
 * what is drawn, so every case is exact and quick. The pixels themselves
 * are checked in the browser (render-app.test.js, render-regression.test.js).
 *
 *   node tools/test/render-unit.test.js        exits 0 when every case passes
 */
'use strict';
var L = require('./lib/load-physics.js');

var P = L.P, Sim = P.Sim, DMG = Sim.DMG, profile = P.profile;
var BINS = 40;

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

/* ---- stand-ins ---- */
/** A 2-D context that records every call and every style it is given. */
function recorder() {
  var c = { calls: 0, strokes: 0, fills: 0, rects: 0, beads: 0, puts: 0, images: 0, clears: 0, styles: {}, blur: [], log: [] };
  var props = {};
  ['strokeStyle', 'fillStyle', 'lineWidth', 'shadowBlur', 'shadowColor', 'globalAlpha', 'lineCap', 'lineJoin'].forEach(function (p) {
    Object.defineProperty(c, p, {
      get: function () { return props[p]; },
      set: function (v) {
        c.calls++; props[p] = v;
        if (p === 'strokeStyle' || p === 'fillStyle') c.styles[v] = (c.styles[v] || 0) + 1;
        if (p === 'shadowBlur') c.blur.push(v);
      }
    });
  });
  function m(name, fn) {
    c[name] = function () { c.calls++; c.log.push(name); return fn ? fn.apply(null, arguments) : undefined; };
  }
  ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'ellipse', 'setTransform', 'arc', 'closePath'].forEach(function (n) { m(n); });
  m('stroke', function () { c.strokes++; });
  m('fill', function () { c.fills++; });
  m('fillRect', function () { c.rects++; });
  m('rect', function () { c.beads++; });
  m('clearRect', function () { c.clears++; });
  m('putImageData', function () { c.puts++; });
  m('drawImage', function () { c.images++; });
  m('createRadialGradient', function () { return { addColorStop: function () {} }; });
  m('createImageData', function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; });
  c.reset = function () {
    c.calls = c.strokes = c.fills = c.rects = c.beads = c.puts = c.images = c.clears = 0;
    c.styles = {}; c.blur = []; c.log = [];
  };
  return c;
}
/** A canvas whose context is a recorder; its document makes more of them (the dune's band). */
function fakeCanvas() {
  var ctx = recorder();
  return {
    width: 300, height: 150, style: {}, ctx: ctx, gets: 0,
    getContext: function () { this.gets++; return ctx; },
    ownerDocument: { createElement: function () { return fakeCanvas(); } }
  };
}
/** A Renderer without canvases: enough for paths, the policy and the drawing of cracks. */
function fakeRenderer(sim) {
  var r = Object.create(P.Renderer.prototype);
  r.sim = sim; r.dpr = 3; r.scale = 1.48; r.frame = true; r.cssW = 374; r.cssH = 718;   // laid out
  r.ctx = recorder();
  r.fronts = 0;
  r._drawFront = function () { r.fronts++; r._drawCracks(r.ctx); };   // c-front, minus the glass and caps
  return r;
}
/** A glass with the given forced cracks: [[bulb, side, u, L, w], …]. */
function glass(list, seed) {
  var s = new Sim({ scale: 1.08, seed: seed || 4242 });
  (list || []).forEach(function (c) { s.forceCrack(segOf(c[0], c[1], c[2]), c[3], c[4]); });
  return s;
}
function segOf(bulb, side, u) {
  return (bulb * 2 + (side > 0 ? 1 : 0)) * BINS + Math.min(BINS - 1, Math.floor(u * BINS));
}
/** A bare crack record on a stand-in sim (for sweeping many seeds quickly). */
var GEO = P.makeGeometry(1.08);
function bare(u, Lc, seed, w, bulb, side) {
  return { id: seed, seg: 0, bulb: bulb === undefined ? 1 : bulb, side: side === undefined ? 1 : side, u: u,
           x: 0, y: 0, seed: seed >>> 0, L: Lc, w: w || 0, sealed: false, nh: w || 0 };
}
function bareSim(cracks) {
  return { geo: GEO, cracks: cracks, angle: 0, tilt: 0, crackRev: 1, warnSeg: -1,
           segInfo: Sim.prototype.segInfo };
}
/** φ of a canonical point: x = r(u)·sin φ, y = u·HB. */
function phiOf(x, y) {
  var r = profile(y / GEO.HB, GEO), s = x / r;
  return Math.asin(s > 1 ? 1 : (s < -1 ? -1 : s));
}
/** Canonical segments of a path entry, walker by walker: {key: [[x0, y0, x1, y1], …]}. */
function walkers(e) {
  var out = {};
  for (var w = 0; w < e.nw; w++) {
    var key = e.wArm[w] + ':' + e.wNth[w], list = [];
    for (var s = e.ws[w]; s < e.ws[w + 1]; s++) {
      var o = 7 * s;
      list.push([e.can[o], e.can[o + 1], e.can[o + 2], e.can[o + 3], e.can[o + 4], e.can[o + 5]]);
    }
    out[key] = list;
  }
  return out;
}

/* ====================================================================== */

test('crack paths: deterministic in the seed, cached by (id, seed, ⌊L/2⌋, w)', function () {
  var s = glass([[0, 1, 0.12, 40, 2]]), cr = s.cracks[0];
  var a = fakeRenderer(s), b = fakeRenderer(s);
  var ea = a._crackPath(cr), eb = b._crackPath(cr);
  ok(ea.n > 10 && ea.n === eb.n, 'segment counts ' + ea.n + ' / ' + eb.n);
  for (var i = 0; i < 4 * ea.n; i++) ok(ea.seg[i] === eb.seg[i], 'two renderers drew different paths at ' + i);
  var copy = Float32Array.from(ea.seg.subarray(0, 4 * ea.n));
  ok(a._crackPath(cr) === ea, 'the second call returns the cached path');
  cr.L = 41;                                         // same ⌊L/2⌋: unchanged
  a._crackPath(cr);
  for (i = 0; i < copy.length; i++) ok(ea.seg[i] === copy[i], 'L 41 changed the path');
  var other = fakeRenderer(bareSim([bare(cr.u, 40, cr.seed ^ 1, 2, cr.bulb, cr.side)]));
  var eo = other._crackPath(other.sim.cracks[0]), same = eo.n === ea.n;
  for (i = 0; same && i < 4 * ea.n; i++) if (eo.seg[i] !== ea.seg[i]) same = false;
  ok(!same, 'another seed gave the same path');
  return ea.n + ' segments, identical across renderers; another seed differs';
});

test('kinds: a hoop by the waist, a star on the dome, a run along the glass between', function () {
  var hoops = 0, hoopIn = 0, stars = 0, starArms = [], runs = 0, runOk = 0, i, e, r, w;
  for (var seed = 1; seed <= 60; seed++) {
    [0.06, 0.15, 0.28].forEach(function (u) {
      r = fakeRenderer(bareSim([bare(u, 40, seed * 7919)]));
      e = r._crackPath(r.sim.cracks[0]);
      hoops++;
      ok(e.arms === 1, 'a hoop has one main arm, got ' + e.arms);
      w = walkers(e)['0:-1'];
      // round toward the viewer: φ (from x = r(u)·sin φ) falls away from the silhouette
      if (w.length && phiOf(w[w.length - 1][2], w[w.length - 1][3]) < phiOf(w[0][0], w[0][1]) - 0.1) hoopIn++;
    });
    [0.8, 0.9, 0.97].forEach(function (u) {
      r = fakeRenderer(bareSim([bare(u, 40, seed * 104729)]));
      e = r._crackPath(r.sim.cracks[0]);
      stars++;
      starArms.push(e.arms);
      ok(e.arms >= 3 && e.arms <= 5, 'a star has 3 to 5 arms, got ' + e.arms);
    });
    [0.35, 0.5, 0.6, 0.72].forEach(function (u) {
      r = fakeRenderer(bareSim([bare(u, 40, seed * 15485863)]));
      e = r._crackPath(r.sim.cracks[0]);
      runs++;
      ok(e.arms === 1, 'a run has one main arm');
      w = walkers(e)['0:-1'];
      if (!w.length) return;
      var dy = w[w.length - 1][3] - w[0][1];
      // toward the equator: down the bulb from the shoulder, up it from the dome side
      if (u < GEO.equator ? dy > 0 : dy < 0) runOk++;
    });
  }
  ok(hoopIn >= 0.9 * hoops, 'hoops running into the face: ' + hoopIn + '/' + hoops);
  ok(runOk >= 0.8 * runs, 'runs heading for the equator: ' + runOk + '/' + runs);
  var hist = [0, 0, 0, 0, 0, 0];
  starArms.forEach(function (n) { hist[n]++; });
  ok(hist[3] && hist[4] && hist[5], 'star arm counts 3/4/5 all occur: ' + hist.slice(3).join('/'));
  return 'hoops into the face ' + hoopIn + '/' + hoops + ', stars with 3/4/5 arms ' + hist.slice(3).join('/') +
    ', runs toward the equator ' + runOk + '/' + runs;
});

test('budget: at most 170 segments a crack, so three stay within 512', function () {
  var worst = 0, at = '', n = 0;
  var us = [0.02, 0.03, 0.12, 0.29, 0.31, 0.5, 0.66, 0.74, 0.76, 0.9, 0.99];
  var Ls = [4, 6, 10, 26, 40, 60, 80, 100, 120, 140];
  for (var seed = 1; seed <= 120; seed++) {
    for (var a = 0; a < us.length; a++) {
      for (var b = 0; b < Ls.length; b++) {
        var r = fakeRenderer(bareSim([bare(us[a], Ls[b], seed * 2654435761)]));
        var e = r._crackPath(r.sim.cracks[0]);
        n++;
        if (e.n > worst) { worst = e.n; at = 'u ' + us[a] + ', L ' + Ls[b] + ', seed ' + seed; }
      }
    }
  }
  ok(worst <= 170, 'a crack drew ' + worst + ' segments (' + at + ')');
  var g3 = fakeRenderer(bareSim([bare(0.9, 140, 11), bare(0.12, 140, 22, 0, 0, -1), bare(0.5, 140, 33, 0, 1, -1)]));
  var tot = 0;
  g3.sim.cracks.forEach(function (c) { tot += g3._crackPath(c).n; });
  ok(tot <= 512, 'three long cracks drew ' + tot + ' segments');
  return n + ' paths, the largest ' + worst + ' segments (' + at + '); three at L 140: ' + tot;
});

test('paths stay on the front face and never come within four rows of the waist', function () {
  var bad = 0, checked = 0, why = '';
  for (var seed = 1; seed <= 80; seed++) {
    [0.02, 0.05, 0.2, 0.45, 0.7, 0.85, 0.99].forEach(function (u) {
      [10, 50, 140].forEach(function (Lc) {
        var r = fakeRenderer(bareSim([bare(u, Lc, seed * 40503)]));
        var e = r._crackPath(r.sim.cracks[0]);
        var u0 = Math.min(u, 0.995), uLo = Math.min(Math.max(0.03, 4.5 / GEO.HB), u0);
        for (var s = 0; s < e.n; s++) {
          for (var k = 0; k < 2; k++) {
            var x = e.can[7 * s + 2 * k], y = e.can[7 * s + 2 * k + 1], uu = y / GEO.HB;
            checked++;
            if (uu < uLo - 1e-5 || uu > 0.995 + 1e-5) { bad++; why = 'u ' + uu; }
            else if (Math.abs(x) > profile(uu, GEO) + 1e-3) { bad++; why = 'x ' + x + ' outside r ' + profile(uu, GEO); }
            else if (y < 4 - 1e-4) { bad++; why = 'y ' + y + ' within four rows of the waist'; }
          }
        }
      });
    });
  }
  ok(!bad, bad + ' of ' + checked + ' endpoints off the face (' + why + ')');
  return checked + ' endpoints, all on the front face, |y| ≥ 4 cells';
});

test('a growing crack only extends: every arm keeps the steps it had', function () {
  var pairs = 0, kept = 0, grownSome = 0;
  for (var seed = 1; seed <= 60; seed++) {
    [0.1, 0.5, 0.9].forEach(function (u) {
      var prev = null;
      [4, 10, 26, 40, 60, 90, 140].forEach(function (Lc) {
        var r = fakeRenderer(bareSim([bare(u, Lc, seed * 69069 + 1)]));
        var wk = walkers(r._crackPath(r.sim.cracks[0]));
        if (prev) {
          Object.keys(prev).forEach(function (key) {
            var a = prev[key], b = wk[key];
            pairs++;
            ok(b && b.length >= a.length, 'walker ' + key + ' shrank at L ' + Lc + ' (seed ' + seed + ', u ' + u + ')');
            if (b.length > a.length) grownSome++;
            for (var i = 0; i < a.length; i++) {
              for (var j = 0; j < 4; j++) ok(a[i][j] === b[i][j], 'walker ' + key + ' moved at step ' + i + ', L ' + Lc);
            }
            kept++;
          });
        }
        prev = wk;
      });
    });
  }
  ok(grownSome > pairs * 0.3, 'arms barely grew: ' + grownSome + '/' + pairs);
  return kept + ' arm comparisons from L 4 to 140: every earlier step kept; ' + grownSome + ' grew';
});

test('mend fractions: the gold runs from the origin, every arm in step, branches from their roots', function () {
  var branches = 0, checked = 0;
  for (var seed = 1; seed <= 80; seed++) {
    [0.1, 0.5, 0.9].forEach(function (u) {
      var r = fakeRenderer(bareSim([bare(u, 80, seed * 2246822519)]));
      var e = r._crackPath(r.sim.cracks[0]);
      for (var w = 0; w < e.nw; w++) {
        var s0 = e.ws[w], s1 = e.ws[w + 1];
        if (s1 <= s0) continue;
        for (var s = s0; s < s1; s++) {
          var t0 = e.can[7 * s + 4], t1 = e.can[7 * s + 5];
          ok(t0 >= -1e-6 && t1 <= 1 + 1e-5 && t1 > t0, 'fraction out of order: ' + t0 + ' → ' + t1);
          if (s > s0) ok(t0 >= e.can[7 * (s - 1) + 5] - 1e-5, 'fraction fell along walker ' + w);
          checked++;
        }
        ok(Math.abs(e.can[7 * (s1 - 1) + 5] - 1) < 1e-4, 'walker ' + w + ' ends at ' + e.can[7 * (s1 - 1) + 5] + ', not 1');
        if (e.wNth[w] < 0) {
          ok(e.can[7 * s0 + 4] === 0, 'a main arm starts at the origin');
          continue;
        }
        // a branch starts filling only once the gold has reached its root on the parent
        branches++;
        var d0 = e.wD0[w], parent = -1;
        for (var q = 0; q < e.nw; q++) if (e.wNth[q] < 0 && e.wArm[q] === e.wArm[w]) parent = q;
        var reach = 0;
        for (s = e.ws[parent]; s < e.ws[parent + 1]; s++) {
          var tEnd = e.can[7 * s + 5], dEnd = (s - e.ws[parent] + 1) * 1.1;
          if (Math.abs(dEnd - d0) < 1e-3) reach = tEnd;
        }
        ok(e.can[7 * s0 + 4] >= reach - 1e-5, 'branch ' + w + ' starts at ' + e.can[7 * s0 + 4] + ' before its root fills at ' + reach);
      }
    });
  }
  ok(branches > 20, 'only ' + branches + ' branches seen');
  return checked + ' segments; ' + branches + ' branches each fill after their root';
});

test('flip: the crack stays on the same glass (point-reflected in the vessel)', function () {
  var s = glass([[1, 1, 0.9, 45, 3], [0, -1, 0.15, 40, 2]]), r = fakeRenderer(s), k, i;
  var before = [], chips = [], entries = [];
  for (k = 0; k < 2; k++) {
    var e = r._crackPath(s.cracks[k]);
    entries.push(e);
    before.push(Float32Array.from(e.seg.subarray(0, 4 * e.n)));
    chips.push(r.chipVessel(k, {}));
  }
  var rev = s.crackRev;
  s.completeFlip();
  ok(s.crackRev !== rev, 'crackRev did not change');
  for (k = 0; k < 2; k++) {
    var e2 = r._crackPath(s.cracks[k]);
    ok(e2 === entries[k], 'the flip rebuilt the path instead of mirroring it');
    for (i = 0; i < before[k].length; i++) ok(e2.seg[i] === -before[k][i], 'crack ' + k + ' segment value ' + i + ' not reflected');
    var c2 = r.chipVessel(k, {});
    ok(Math.abs((c2.x - s.geo.cx) + (chips[k].x - s.geo.cx)) < 1e-9 && Math.abs((c2.y - s.geo.cy) + (chips[k].y - s.geo.cy)) < 1e-9,
      'chip ' + k + ' not reflected: ' + JSON.stringify(chips[k]) + ' → ' + JSON.stringify(c2));
  }
  return 'both cracks and chips exactly point-reflected; the cached paths were re-mirrored, not regrown';
});

test('chipVessel: on the lattice hole, in lattice cells', function () {
  var worst = 0, n = 0, out = {};
  [[0, 1, 0.1], [0, -1, 0.2], [0, 1, 0.5], [0, -1, 0.85], [1, 1, 0.12], [1, -1, 0.4], [1, 1, 0.66], [1, -1, 0.95]].forEach(function (c) {
    var s = glass([[c[0], c[1], c[2], 40, 1]]), r = fakeRenderer(s), cr = s.cracks[0];
    var h = cr.holes[0], hx = (h % s.W) + 0.5, hy = Math.floor(h / s.W) + 0.5;
    ok(r.chipVessel(0, out) === out, 'chipVessel fills and returns out');
    var d = Math.hypot(out.x - hx, out.y - hy);
    if (d > worst) worst = d;
    n++;
  });
  ok(worst <= 1.5, 'a chip sits ' + worst.toFixed(2) + ' cells from its hole');
  var s0 = glass([]), r0 = fakeRenderer(s0);
  ok(r0.chipVessel(0, out) === null && r0.chipVessel(-1) === null, 'no crack: null');
  return n + ' breaches: chips within ' + worst.toFixed(2) + ' cells of the hole centre';
});

test('_drawCracks: nothing for a whole glass; batched strokes; gold for mended and mending', function () {
  var s = glass([]), r = fakeRenderer(s), ctx = recorder();
  r._drawCracks(ctx);
  ok(ctx.calls === 0, 'a whole glass touched the context ' + ctx.calls + ' times');
  ok(!r._dmg, 'a whole glass made damage state');
  s = glass([[0, 1, 0.12, 40, 2], [1, 1, 0.9, 60, 3], [1, -1, 0.5, 80, 0]]);
  r = fakeRenderer(s);
  r._drawCracks(ctx);
  var segs = 0;
  s.cracks.forEach(function (c) { segs += r._crackPath(c).n; });
  ok(ctx.strokes >= 2 && ctx.strokes <= 1 + 33 + 2, ctx.strokes + ' strokes for ' + segs + ' segments: not batched');
  ok(ctx.fills === 2, 'two chips filled, got ' + ctx.fills);
  ok(!ctx.styles['rgba(214,170,92,0.95)'], 'gold on an unmended glass');
  var plain = ctx.strokes;
  ctx.reset();
  r.setMend(0.5);
  r._drawCracks(ctx);
  ok(ctx.styles['rgba(214,170,92,0.95)'] && ctx.blur.indexOf(12) >= 0, 'a mend in progress draws gold with a 4 CSS px glow');
  ctx.reset();
  r.setMend(0);
  s.sealCracks();
  r._drawCracks(ctx);
  ok(ctx.styles['rgba(214,170,92,0.95)'] && ctx.styles['rgba(255,232,180,0.9)'], 'mended cracks are gold with a light core');
  ok(!ctx.styles['rgba(0,0,0,0.30)'], 'mended cracks keep no shadow or hairline');
  return segs + ' segments in ' + plain + ' strokes; gold for a mend at 0.5 and for mended cracks';
});

test('syncDamage: the redraw policy', function () {
  // a whole glass: nothing, ever, and no state made
  var s = glass([]), r = fakeRenderer(s), t = 1000, i;
  for (i = 0; i < 60; i++) ok(r.syncDamage(0, t += 16.7) === false, 'a whole glass redrew');
  ok(r.fronts === 0 && !r._dmg && r.animating === false, 'a whole glass touched the layer');
  r.setMend(0);
  ok(!r._dmg, 'setMend(0) on a whole glass made state');
  // not laid out yet (no canvas size): never draws; layout() will draw what is there
  var early = fakeRenderer(glass([[1, 1, 0.9, 40, 2]]));
  early.cssW = 0;
  ok(early.syncDamage(0, 1) === false && early.fronts === 0, 'drew before the first layout');
  // a crack appears: exactly one redraw, then none while nothing changes
  s.forceCrack(segOf(0, 1, 0.12), 40, 2);
  ok(r.syncDamage(0, t += 16.7) === true && r.fronts === 1, 'a new crack: one redraw');
  for (i = 0; i < 60; i++) r.syncDamage(0.02 * Math.sin(i), t += 16.7);   // |Δrot| < 0.03
  ok(r.fronts === 1, 'small sway and nothing new redrew ' + (r.fronts - 1) + ' times');
  s.crackRev++;
  r.syncDamage(0, t += 16.7);
  r.syncDamage(0, t += 16.7);
  ok(r.fronts === 2, 'one crackRev++: ' + (r.fronts - 1) + ' redraws');
  // a crack that grows is redrawn even if crackRev stays (within 30 Hz), and only when ⌊L/2⌋ moves
  var cr0 = s.cracks[0], g0 = r.fronts;
  cr0.L += 0.6;                                      // 40 → 40.6: the same drawing
  for (i = 0; i < 4; i++) r.syncDamage(0, t += 16.7);
  ok(r.fronts === g0, 'L 40.6 redrew');
  cr0.L = 43;
  for (i = 0; i < 4; i++) r.syncDamage(0, t += 16.7);
  ok(r.fronts === g0 + 1 && r._crackPath(cr0).lk === 21, 'growth to L 43 redrew ' + (r.fronts - g0) + ' times');
  // turning: at most 30 a second (every 2nd frame at 60 Hz; every 5th at 125 Hz, 8 ms apart)
  var f0 = r.fronts, rot = 0;
  for (i = 0; i < 120; i++) { rot += 0.05; r.syncDamage(rot, t += 8); }     // 120 frames at 125 Hz, 0.96 s
  var turns = r.fronts - f0;
  ok(turns >= 20 && turns <= 29, 'turning for 0.96 s at 125 Hz redrew ' + turns + ' times');
  f0 = r.fronts;
  for (i = 0; i < 60; i++) { rot += 0.05; r.syncDamage(rot, t += 1000 / 60); }  // 1 s at 60 Hz
  var turns60 = r.fronts - f0;
  ok(turns60 >= 28 && turns60 <= 30, 'turning for 1 s at 60 Hz redrew ' + turns60 + ' times');
  // a creak: a 300 ms glint, redrawn at most 30 times a second, then one clean frame
  s.segD[segOf(1, 1, 0.9)] = 0.5;
  s._scanDamage(false);
  ok(s.warnSeg >= 0, 'no stressed segment to glint at');
  f0 = r.fronts;
  var tw = t;
  r.damageEvent(DMG.WARN, -1, 1, tw);
  ok(r.animating === true, 'animating after WARN');
  var draws = [];
  for (i = 0; i < 40; i++) { if (r.syncDamage(rot, t += 10)) draws.push(t); }    // 100 Hz frames for 400 ms
  var gaps = draws.slice(1).map(function (x, j) { return x - draws[j]; });
  var during = draws.filter(function (x) { return x < tw + 300; }).length;
  var after = draws.filter(function (x) { return x >= tw + 300; }).length;
  ok(during >= 7 && during <= 9, 'the glint redrew ' + during + ' times in its 300 ms');
  ok(after === 1, (after) + ' clean frames after the glint');
  ok(Math.min.apply(null, gaps) >= 33, 'redraws ' + Math.min.apply(null, gaps) + ' ms apart');
  ok(r.animating === false, 'animating still true after the glint ended');
  var settled = r.fronts;
  for (i = 0; i < 30; i++) r.syncDamage(rot, t += 16.7);
  ok(r.fronts === settled, 'kept redrawing after the glint');
  // Reduce Motion: no flashes at all
  r.reduced = true;
  r.damageEvent(DMG.WARN, -1, 2, t);
  r.damageEvent(DMG.CRACK, 0, 0, t);
  ok(r.animating === false && r._dmg.animEnd === 0, 'Reduce Motion flashed');
  r.reduced = false;
  // the mend: redrawn as it moves, at most 30 a second
  f0 = r.fronts;
  for (i = 1; i <= 60; i++) { r.setMend(i / 60); r.syncDamage(rot, t += 8); }
  var mends = r.fronts - f0;
  ok(mends >= 12 && mends <= 16, 'a 0.48 s mend redrew ' + mends + ' times');
  // gone with a reset: one redraw to clear, then nothing
  s.reset(s.total);
  f0 = r.fronts;
  for (i = 0; i < 30; i++) r.syncDamage(rot, t += 16.7);
  ok(r.fronts - f0 === 1, 'after a reset: ' + (r.fronts - f0) + ' redraws');
  return 'whole glass 0; crack 1; sway 0; crackRev++ 1; turning ' + turns + '/0.96 s at 125 Hz, ' + turns60 +
    '/1 s at 60 Hz; glint ' + during + ' + 1 clean (≥ 33 ms apart); mend ' + mends + '; reset 1';
});

/** The brightest alpha among the styles of one colour drawn since ctx.reset(). */
function brightest(ctx, rgb) {
  var best = -1;
  Object.keys(ctx.styles).forEach(function (k) {
    if (k.indexOf('rgba(' + rgb + ',') === 0) best = Math.max(best, parseFloat(k.slice(k.lastIndexOf(',') + 1)));
  });
  return best;
}

test('damageEvent: CRACK flashes the hairline, BREACH flares the rim, for 250 / 120 ms', function () {
  var s = glass([[1, 1, 0.9, 45, 2]]), r = fakeRenderer(s), t = 5000, i;
  r.ctx.reset();
  r.syncDamage(0, t);
  var hair0 = brightest(r.ctx, '255,250,240'), rim0 = brightest(r.ctx, '255,248,235');
  r.damageEvent(DMG.CRACK, 0, 0, t);
  ok(r.animating && r._dmg.animEnd === t + 250, 'CRACK: 250 ms');
  r.ctx.reset();
  r.syncDamage(0, t += 34);
  var hair1 = brightest(r.ctx, '255,250,240');
  ok(hair1 >= 0.85 && hair1 > hair0 + 0.05, 'hairline during the flash ' + hair1 + ' vs ' + hair0);
  for (i = 0; i < 20; i++) r.syncDamage(0, t += 17);
  ok(!r.animating, 'the flash did not end');
  r.ctx.reset();
  r.syncDamage(0, t += 1000);
  s.crackRev++;
  r.syncDamage(0, t += 40);
  ok(brightest(r.ctx, '255,250,240') === hair0, 'after the flash the hairline is back to ' + hair0);
  r.damageEvent(DMG.BREACH, 0, 1, t);
  ok(r._dmg.animEnd === t + 120, 'BREACH: 120 ms');
  r.ctx.reset();
  r.syncDamage(0, t += 34);
  var rim1 = brightest(r.ctx, '255,248,235');
  ok(rim1 > rim0 + 0.05, 'rim during the flare ' + rim1 + ' vs ' + rim0);
  r.damageEvent(DMG.GROW, 0, 0, t);
  r.damageEvent(DMG.SEAL, 0, 0, t);
  r.damageEvent(DMG.CRACK, 7, 0, t);                // no such crack: ignored
  return 'hairline ' + hair0 + ' → ' + hair1 + ' in the flash; rim ' + rim0 + ' → ' + rim1 + ' in the flare';
});

/* ---- the Spill ---- */
var DESK = { w: 636, h: 718, deskY: 700, x0: 140, x1: 496 };
function spill(o) {
  o = o || {};
  var c = fakeCanvas(), ren = { lut: null, theme: {}, reduced: !!o.reduced };
  var sp = new P.Spill(c, ren);
  sp.layout(DESK.w, DESK.h, 3, DESK.deskY, DESK.x0, DESK.x1);
  return sp;
}
function heights(sp) {
  var out = [];
  for (var c = sp.c0; c <= sp.c1; c++) out.push(sp.col[c] * 0.5);
  return out;
}
function centroid(sp) {
  var m = 0, sx = 0;
  for (var c = sp.c0; c <= sp.c1; c++) { m += sp.col[c]; sx += sp.col[c] * (c * 2 + 1); }
  return m ? sx / m : NaN;
}
function maxStep(sp) {
  var h = heights(sp), worst = 0;
  for (var i = 1; i < h.length; i++) worst = Math.max(worst, Math.abs(h[i] - h[i - 1]));
  return worst;
}
function pour(sp, n, x) {
  for (var i = 0; i < n; i++) sp.add(x + (i % 7) - 3, 300 + (i % 11), (i % 5) * 4 - 8, 20, i * 37);
}
function run(sp, secs, gx, gy, kx, ky, each) {
  for (var i = 0; i < Math.round(secs * 60); i++) {
    sp.step(1 / 60, gx, gy, 2000, kx || 0, ky || 0);
    sp.draw();
    if (each) each(i);
  }
}

test('Spill: 300 grains land and settle at the angle of repose', function () {
  var sp = spill();
  ok(sp.canvas.width === 0 && sp.canvas.height === 0, 'a backing store before anything spilled');
  pour(sp, 300, 330);
  ok(sp.canvas.width === Math.round(636 * 1.5) && sp.canvas.height === Math.round(718 * 1.5), 'backing store at dpr 1.5: ' + sp.canvas.width + '×' + sp.canvas.height);
  ok(sp.count === 300 && sp.nAir === 300, 'count ' + sp.count);
  run(sp, 3, 0, 1);
  ok(sp.heapN === 300 && sp.nAir === 0 && sp.count === 300, 'heap ' + sp.heapN + ', air ' + sp.nAir + ', count ' + sp.count);
  var step = maxStep(sp), top = Math.max.apply(null, heights(sp));
  ok(step <= 1.3 + 0.5, 'largest step ' + step + ' px');
  ok(!sp.active, 'still moving after 3 s');
  return 'all 300 on the dune, ' + top + ' px tall; largest step ' + step + ' px (≤ 1.8)';
});

test('Spill: a tilted room moves the dune downhill; turned over, it falls away', function () {
  var sp = spill();
  pour(sp, 300, 330);
  run(sp, 3, 0, 1);
  var c0 = centroid(sp), a = 25 * Math.PI / 180, moved = null;
  run(sp, 2, Math.sin(a), Math.cos(a), 0, 0, function (i) {
    if (moved === null && centroid(sp) - c0 >= 10) moved = (i + 1) / 60;
  });
  var shift = centroid(sp) - c0;
  ok(moved !== null, 'the centroid moved ' + shift.toFixed(1) + ' px downhill in 2 s');
  // the other way round, and further: it creeps off the low end of the desk
  var before = sp.count;
  run(sp, 6, -Math.sin(1.0), Math.cos(1.0));
  ok(sp.count < before, 'a steep tilt never poured anything off the end (' + sp.count + ')');
  // turned over
  var sp2 = spill();
  pour(sp2, 300, 330);
  run(sp2, 3, 0, 1);
  var emptied = null;
  run(sp2, 3, 0, -1, 0, 0, function (i) { if (emptied === null && sp2.heapN === 0) emptied = (i + 1) / 60; });
  ok(emptied !== null, 'turned over, ' + sp2.heapN + ' grains still on the desk after 3 s');
  var gone = sp2.count;
  return 'downhill 10 px in ' + moved.toFixed(2) + ' s (' + shift.toFixed(1) + ' px in 2 s); steep tilt poured ' + (before - sp.count) +
    ' off; inverted dune empty in ' + emptied.toFixed(2) + ' s (' + gone + ' still falling at 3 s)';
});

test('Spill: clear() sweeps it all and lets go of the canvas', function () {
  var sp = spill();
  pour(sp, 120, 330);
  run(sp, 0.5, 0, 1);
  sp.clear();
  ok(sp.count === 0 && sp.nAir === 0 && sp.heapN === 0 && !sp.active, 'count ' + sp.count);
  ok(sp.canvas.width === 0 && sp.canvas.height === 0, 'canvas ' + sp.canvas.width + '×' + sp.canvas.height);
  var calls = sp.canvas.ctx.calls;
  sp.draw();
  sp.step(1 / 60, 0, 1, 2000, 0, 0);
  ok(sp.canvas.ctx.calls === calls, 'drew after clear()');
  pour(sp, 10, 330);
  ok(sp.canvas.width > 0 && sp.count === 10, 'a new spill after clear() did not start again');
  return 'count 0, canvas 0×0, and a fresh start on the next grain';
});

test('Spill: 600 in the air at most (the oldest drops onto the dune); draws only on change', function () {
  var sp = spill();
  for (var i = 0; i < 650; i++) sp.add(200 + (i % 200), 100, 0, -50, i);
  ok(sp.nAir === 600 && sp.heapN === 50 && sp.count === 650, 'air ' + sp.nAir + ', heap ' + sp.heapN + ', count ' + sp.count);
  sp.draw();
  var ctx = sp.canvas.ctx;
  ctx.reset();
  sp.draw();
  ok(ctx.calls === 0, 'a second draw with nothing new touched the canvas ' + ctx.calls + ' times');
  sp.step(1 / 60, 0, 1, 2000, 0, 0);
  sp.draw();
  ok(ctx.beads === 600 && ctx.rects === 0 && ctx.clears === 1, 'one clear and 600 beads: ' + ctx.clears + ' / ' + ctx.beads + ' / ' + ctx.rects);
  ok(ctx.fills <= 16, ctx.fills + ' fills for the grains in flight (one per colour)');
  ok(ctx.puts === 0, 'putImageData on the spill canvas itself (' + ctx.puts + '): it forces a flush');
  // the dune's band is laid back from its own canvas
  var band = sp._band;
  ok(band && band.width === sp._bw && band.ctx.puts > 0 && ctx.images >= 0, 'the dune band was not painted on its own canvas');
  return '650 added: 600 fly, 50 dropped; a still frame costs nothing; 600 beads in ' + ctx.fills + ' fills';
});

test('Spill: kicks, Reduce Motion and relayout', function () {
  var sp = spill();
  pour(sp, 200, 330);
  run(sp, 3, 0, 1);
  run(sp, 0.1, 0, 1, 0, 1.0);                       // a firm push (1 g): nothing hops
  ok(sp.nAir === 0, 'a 1 g kick threw ' + sp.nAir);
  sp.step(1 / 60, 0, 1, 2000, 0, 2.0);               // 2 g down: the desk throws grains up
  var thrown = sp.nAir;
  ok(thrown > 0 && thrown <= 8, 'a 2 g kick threw ' + thrown);
  for (var i = 0; i < sp.nAir; i++) ok(sp.pvy[i] < 0, 'a grain was thrown into the desk');
  sp.step(1 / 60, 0, 1, 2000, 0, -2.0);              // a kick that would drive them into the desk: none
  ok(sp.nAir <= thrown, 'a downward throw');
  // Reduce Motion: straight onto the dune, and no hops
  var rm = spill({ reduced: true });
  pour(rm, 50, 330);
  ok(rm.nAir === 0 && rm.heapN === 50, 'Reduce Motion: air ' + rm.nAir + ', heap ' + rm.heapN);
  rm.step(1 / 60, 0, 1, 2000, 0, 0);
  ok(rm.landed === 50, 'landings reported ' + rm.landed);
  rm.step(1 / 60, 0, 1, 2000, 0, 3.0);
  ok(rm.nAir === 0, 'Reduce Motion hopped');
  // relayout keeps the dune under the glass (the canvas centre)
  run(sp, 1, 0, 1);
  var c0 = centroid(sp), before = sp.heapN;
  sp.layout(DESK.w + 40, DESK.h, 3, DESK.deskY + 10, DESK.x0 + 20, DESK.x1 + 20);
  ok(Math.abs(centroid(sp) - (c0 + 20)) < 2.01 && sp.heapN === before, 'relayout moved the dune: ' + c0 + ' → ' + centroid(sp));
  // a new material: the whole dune is repainted in the new sand's colours, once
  sp.draw();
  var band = sp._band.ctx;
  band.reset();
  sp.draw();
  ok(band.puts === 0, 'a still dune was repainted');
  sp.renderer.theme = {};                            // setTheme() swaps the theme object (and its colour table)
  sp.draw();
  ok(band.puts > 0, 'a new material did not repaint the dune');
  return 'a 2 g kick threw ' + thrown + ' up; Reduce Motion lands at once and never hops; relayout keeps the dune centred; ' +
    'a new material repaints it';
});

console.log(failures ? 'render-unit: ' + failures + ' of ' + count + ' cases FAILED' : 'render-unit: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
