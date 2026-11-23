/*
 * renderer, in the real app (Playwright Chromium, iPhone 12: 390×844 at
 * DPR 3, touch): cracks drawn on c-front, their glint, the redraw policy,
 * a flip, kintsugi gold, and the Spill. Cracks are injected through
 * window.Hourglass.sim (forceCrack, or a plain record as the spec's stub).
 *
 *   node tools/test/render-app.test.js [port]     exits 0 when every case passes
 *
 * The port defaults to $PORT or 8802. The repository is served by
 * tools/test/lib/static-server.js inside this process, and stopped at the end.
 * SNAP=<dir> also saves a few screenshots there for a look by eye.
 */
'use strict';
var path = require('path');
var server = require('./lib/static-server.js');
var chromium = require('playwright').chromium;

var PORT = +(process.argv[2] || process.env.PORT || 8802);
var ROOT = require('./lib/paths.js').ROOT;
var seed = require('./lib/seed.js');
var URL = 'http://127.0.0.1:' + PORT + '/';
var SNAP = process.env.SNAP || '';

var failures = 0, count = 0;
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/* ---- helpers that run inside the page ---- */
function pageHelpers() {
  var H = window.Hourglass, P = window.HourglassPhysics;
  var front = document.getElementById('c-front');
  window.__rt = {
    S: function () { return H.renderer.scale * H.renderer.dpr; },       // device px per cell on c-front
    /** vessel-centred cells → c-front pixels */
    toCanvas: function (vx, vy) { var S = this.S(); return [front.width / 2 + vx * S, front.height / 2 + vy * S]; },
    img: function () { return front.getContext('2d').getImageData(0, 0, front.width, front.height).data; },
    /** where a crack's path starts, vessel-centred cells (u, φ0 = π/2 − 0.06) */
    origin: function (cr) {
      var g = H.sim.geo, u = Math.min(cr.u, 0.995), phi = Math.PI / 2 - 0.06;
      return [(cr.side < 0 ? -1 : 1) * P.profile(u, g) * Math.sin(phi), (cr.bulb ? 1 : -1) * u * g.HB];
    },
    seg: function (bulb, side, u) { return (bulb * 2 + (side > 0 ? 1 : 0)) * 40 + Math.min(39, Math.floor(u * 40)); },
    /** cap rectangles in c-front pixels, kept clear of their rounded corners and edges */
    caps: function () {
      var g = H.sim.geo, q = g.q, yC = -(g.HB + 3 * q), colW = g.R * 0.62, out = [], self = this;
      var rects = [
        [-colW + 1.6 * q, yC + 0.5, colW - 1.6 * q, yC + g.collarH + 1.5 * q - 0.5],     // top collar
        [-g.capHalf + 2.6 * q, yC - g.slabH + 0.5, g.capHalf - 2.6 * q, yC - 0.5]       // top slab
      ];
      rects.forEach(function (r) {
        out.push(r);
        out.push([-r[2], -r[3], -r[0], -r[1]]);                                           // and the bottom ones
      });
      return out.map(function (r) {
        var a = self.toCanvas(r[0], r[1]), b = self.toCanvas(r[2], r[3]);
        return [Math.ceil(a[0]) + 2, Math.ceil(a[1]) + 2, Math.floor(b[0]) - 2, Math.floor(b[1]) - 2];
      });
    },
    /** pixels inside the rectangles that differ between two images */
    diffIn: function (a, b, rects) {
      var W = front.width, n = 0, d = 0;
      rects.forEach(function (r) {
        for (var y = r[1]; y < r[3]; y++) for (var x = r[0]; x < r[2]; x++) {
          var i = 4 * (y * W + x);
          n++;
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) d++;
        }
      });
      return { n: n, diff: d };
    }
  };
}

/* ---- the runner (plain promises: the house style is ES5) ---- */
var browser, srv, CASES = [];
function newPage(isolated) {
  var page;
  return browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true
  }).then(function (ctx) {
    // the classic sand, as before Real sand was the default (lib/seed.js)
    return ctx.addInitScript(seed.seedOnce, seed.storageFor({})).then(function () { return ctx.newPage(); });
  }).then(function (p) {
    page = p;
    page.errors = [];
    page.on('pageerror', function (e) { page.errors.push('pageerror: ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
    if (!isolated) return null;
    // cross-origin isolated, so performance.now() resolves 5 µs instead of 100 µs
    return page.route('**/*', function (route) {
      return route.fetch().then(function (resp) {
        return route.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), {
          'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }) });
      });
    });
  }).then(function () {
    return page.goto(URL, { waitUntil: 'load' });
  }).then(function () {
    return page.waitForFunction(function () { return window.Hourglass && window.Hourglass.sim && window.Hourglass.renderer.cssW; });
  }).then(function () {
    return page.waitForTimeout(1200);                  // the boot fade and the first frames
  }).then(function () {
    return page.evaluate(pageHelpers);
  }).then(function () {
    return page;
  });
}
function test(name, fn, isolated) {
  var t0 = Date.now(), page = null;
  count++;
  return newPage(isolated).then(function (p) {
    page = p;
    return fn(page);
  }).then(function (detail) {
    ok(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
    console.log('PASS  ' + name + (detail ? ': ' + detail : '') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  }).catch(function (e) {
    failures++;
    console.log('FAIL  ' + name + ': ' + (e && e.message ? e.message : e));
    if (process.env.VERBOSE && e && e.stack) console.log(e.stack);
  }).then(function () {
    return page ? page.context().close() : null;
  });
}

/* ====================================================================== */

CASES.push(['1. DRAWING: a w = 2 crack on the upper bulb (u 0.12, right, L 40) is drawn; the caps cover it', function (page) {
  return page.evaluate(function () {
    var H = window.Hourglass, sim = H.sim, ren = H.renderer, R = window.__rt, front = document.getElementById('c-front');
    var before = R.img();
    // the spec's stub: a plain record pushed onto sim.cracks, then crackRev++
    var cr = { id: 9001, seg: R.seg(0, 1, 0.12), bulb: 0, side: 1, u: 0.12, x: 0, y: 0, seed: 0x5EED1234 >>> 0,
               L: 40, w: 2, sealed: false, holes: new Int32Array(3), nh: 0, mouth: new Int32Array(24), nm: 0, born: 0 };
    sim.cracks.push(cr);
    sim.crackRev++;
    var drew = ren.syncDamage(0, performance.now());
    var after = R.img(), W = front.width, Hh = front.height;
    var o = R.toCanvas.apply(R, R.origin(cr)), rad = 12 * R.S(), n = 0, any = 0;
    for (var y = Math.max(0, Math.floor(o[1] - rad)); y < Math.min(Hh, o[1] + rad); y++) {
      for (var x = Math.max(0, Math.floor(o[0] - rad)); x < Math.min(W, o[0] + rad); x++) {
        if ((x - o[0]) * (x - o[0]) + (y - o[1]) * (y - o[1]) > rad * rad) continue;
        var i = 4 * (y * W + x);
        if (after[i + 3] > 0 && before[i + 3] === 0) n++;
        if (after[i + 3] > 0) any++;
      }
    }
    var capsA = R.diffIn(before, after, R.caps());
    // and a long star on the lower dome, whose arms run under the collar
    sim.cracks.length = 0;
    sim.crackRev++;
    ren.syncDamage(0, performance.now() + 100);
    var clean = R.img();
    var star = sim.forceCrack(R.seg(1, 1, 0.97), 90, 3);
    ren.syncDamage(0, performance.now() + 200);
    var withStar = R.img(), p = ren._crackPath(star), under = 0, g = sim.geo;
    for (var s = 0; s < p.n; s++) if (p.seg[4 * s + 3] > g.HB - 3.5 * g.q) under++;
    var capsB = R.diffIn(clean, withStar, R.caps());
    // a crack pixel within 6 cells of chipVessel (what the app maps escapes and pans from)
    var cv = ren.chipVessel(0, {}), c6 = R.toCanvas(cv.x - g.cx, cv.y - g.cy), near = 0, r6 = 6 * R.S();
    for (y = Math.floor(c6[1] - r6); y < c6[1] + r6; y++) for (x = Math.floor(c6[0] - r6); x < c6[0] + r6; x++) {
      if ((x - c6[0]) * (x - c6[0]) + (y - c6[1]) * (y - c6[1]) <= r6 * r6 && withStar[4 * (y * W + x) + 3] > 0) near++;
    }
    return { drew: drew, n: n, any: any, capsA: capsA, capsB: capsB, starSegs: p.n, under: under, near: near };
  }).then(function (r) {
    ok(r.drew === true, 'syncDamage(0, t) returned ' + r.drew);
    ok(r.n >= 40, 'only ' + r.n + ' new pixels within 12 cells of the origin');
    ok(r.capsA.n > 10000 && r.capsA.diff === 0, 'cap pixels changed with the crack: ' + JSON.stringify(r.capsA));
    ok(r.under > 0, 'the dome star never reached under the collar (test setup)');
    ok(r.capsB.diff === 0, 'cap pixels changed with a star running under the collar: ' + JSON.stringify(r.capsB));
    ok(r.near > 20, 'only ' + r.near + ' crack pixels within 6 cells of chipVessel(0)');
    return r.n + ' new pixels within 12 cells; caps identical (' + r.capsA.n + ' px; and with a star ' + r.under +
      ' of whose ' + r.starSegs + ' segments run under the collar); ' + r.near + ' px within 6 cells of chipVessel';
  });
}]);

CASES.push(['2. GLINT: the hairline brightens and dims as the glass turns against the room', function (page) {
  return page.evaluate(function () {
    var H = window.Hourglass, sim = H.sim, ren = H.renderer, R = window.__rt, front = document.getElementById('c-front');
    var W = front.width, t = performance.now();
    var bare = R.img();
    /** mean light the hairline adds, rot 0 vs rot 0.6, for the DRAWING crack with this seed */
    function glint(seed) {
      var cr = { id: 9100 + (seed & 1023), seg: R.seg(0, 1, 0.12), bulb: 0, side: 1, u: 0.12, x: 0, y: 0, seed: seed >>> 0,
                 L: 40, w: 2, sealed: false, holes: new Int32Array(3), nh: 0, mouth: new Int32Array(24), nm: 0, born: 0 };
      sim.cracks.length = 0;
      sim.cracks.push(cr);
      sim.crackRev++;
      var p = ren._crackPath(cr), S = R.S();
      // the crack's box in pixels, without its chip
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (var s = 0; s < p.n; s++) for (var k = 0; k < 2; k++) {
        var c = R.toCanvas(p.seg[4 * s + 2 * k], p.seg[4 * s + 2 * k + 1]);
        x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]);
      }
      x0 = Math.floor(x0 - 4); y0 = Math.floor(y0 - 4); x1 = Math.ceil(x1 + 4); y1 = Math.ceil(y1 + 4);
      var chip = R.toCanvas(p.chipX, p.chipY), keep = 4 * S;
      function lum(rot) {
        ren.syncDamage(rot, t += 50);
        var a = R.img(), sum = 0, n = 0;
        for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
          if ((x - chip[0]) * (x - chip[0]) + (y - chip[1]) * (y - chip[1]) < keep * keep) continue;
          var i = 4 * (y * W + x);
          if (a[i + 3] === 0 && bare[i + 3] === 0) continue;
          // the light the hairline adds: premultiplied luminance over the layer without it
          sum += (a[i] + a[i + 1] + a[i + 2]) / 3 * a[i + 3] / 255 - (bare[i] + bare[i + 1] + bare[i + 2]) / 3 * bare[i + 3] / 255;
          n++;
        }
        return { mean: sum / n, n: n };
      }
      var a0 = lum(0), a6 = lum(0.6), back = lum(0);
      return { a0: a0, a6: a6, back: back, d: Math.abs(a6.mean - a0.mean) / a0.mean };
    }
    var main = glint(0x5EED1234), sweep = [];
    for (var k = 1; k <= 24; k++) sweep.push(glint(Math.imul(k, 0x9E3779B1)).d);
    sweep.sort(function (a, b) { return a - b; });
    return { main: main, sweep: sweep };
  }).then(function (r) {
    var m = r.main, d = m.d, sw = r.sweep;
    ok(d >= 0.2, 'mean hairline luminance ' + m.a0.mean.toFixed(2) + ' at rot 0, ' + m.a6.mean.toFixed(2) + ' at rot 0.6: ' + (d * 100).toFixed(1) + ' %');
    ok(Math.abs(m.back.mean - m.a0.mean) < 1e-9, 'turning back to rot 0 did not restore it');
    ok(sw[sw.length >> 1] >= 0.2, 'over 24 seeds the median difference is only ' + (sw[sw.length >> 1] * 100).toFixed(0) + ' %');
    return 'mean luminance ' + m.a0.mean.toFixed(2) + ' (rot 0) vs ' + m.a6.mean.toFixed(2) + ' (rot 0.6): ' + (d * 100).toFixed(0) +
      ' % over ' + m.a0.n + ' px, back at rot 0 exactly as before; 24 other seeds: min ' + (sw[0] * 100).toFixed(0) + ' %, median ' +
      (sw[sw.length >> 1] * 100).toFixed(0) + ' %, max ' + (sw[sw.length - 1] * 100).toFixed(0) + ' %';
  });
}]);

CASES.push(['3. POLICY: redraws only when something changed (spy on _drawFront)', function (page) {
  return page.evaluate(function () {
    var H = window.Hourglass, sim = H.sim, ren = H.renderer, R = window.__rt, front = document.getElementById('c-front');
    var fronts = 0, gets = 0, ops = 0, orig = ren._drawFront, getCtx = front.getContext;
    ren._drawFront = function () { fronts++; return orig.apply(this, arguments); };
    var ctx = getCtx.call(front, '2d');
    front.getContext = function () { gets++; return getCtx.apply(front, arguments); };
    ['clearRect', 'setTransform', 'stroke', 'fill', 'fillRect', 'drawImage', 'putImageData', 'getImageData'].forEach(function (m) {
      var f = ctx[m];
      ctx[m] = function () { ops++; return f.apply(ctx, arguments); };
    });
    var t = performance.now(), i, out = {};
    // no cracks: nothing at all
    for (i = 0; i < 60; i++) ren.syncDamage(0, t += 16.7);
    out.none = { fronts: fronts, gets: gets, ops: ops, animating: ren.animating };
    // a crack appears (forceCrack bumps crackRev): exactly one redraw
    sim.forceCrack(R.seg(1, 1, 0.9), 40, 2);
    fronts = 0;
    for (i = 0; i < 60; i++) ren.syncDamage(0.02 * Math.sin(i * 0.3), t += 16.7);   // |Δrot| < 0.03
    out.appear = fronts;
    // nothing new for 60 frames: none
    fronts = 0;
    for (i = 0; i < 60; i++) ren.syncDamage(0.025 * Math.cos(i * 0.2), t += 16.7);
    out.still = fronts;
    // one crackRev++: exactly one
    sim.crackRev++;
    fronts = 0;
    for (i = 0; i < 60; i++) ren.syncDamage(0, t += 16.7);
    out.bump = fronts;
    // turning for a second at 60 Hz: at most 30
    fronts = 0;
    for (i = 0; i < 60; i++) ren.syncDamage(i * 0.05, t += 16.7);
    out.turning = fronts;
    ren._drawFront = orig; front.getContext = getCtx;
    // what a redraw costs with three long cracks (the most a glass holds), mended and not
    sim.forceCrack(R.seg(0, 1, 0.12), 140, 3);
    sim.forceCrack(R.seg(1, -1, 0.5), 140, 2);
    sim.cracks[0].L = 140; sim.crackRev++;
    var times = [], segs = 0;
    for (i = 0; i < 90; i++) {
      if (i === 45) sim.sealCracks();
      var t0 = performance.now();
      ren.syncDamage(i * 0.05, t += 34);
      times.push(performance.now() - t0);
    }
    sim.cracks.forEach(function (c) { segs += ren._crackPath(c).n; });
    times = times.slice(5).sort(function (a, b) { return a - b; });
    out.redraw = { segs: segs, median: times[times.length >> 1], p95: times[Math.floor(times.length * 0.95)] };
    return out;
  }).then(function (r) {
    ok(r.none.fronts === 0 && r.none.gets === 0 && r.none.ops === 0 && r.none.animating === false,
      'no cracks: ' + JSON.stringify(r.none));
    ok(r.appear === 1, 'a new crack: ' + r.appear + ' redraws');
    ok(r.still === 0, 'nothing new over 60 frames: ' + r.still + ' redraws');
    ok(r.bump === 1, 'one crackRev++: ' + r.bump + ' redraws');
    ok(r.turning >= 28 && r.turning <= 30, 'turning for 1 s: ' + r.turning + ' redraws');
    ok(r.redraw.p95 < 4, 'a c-front redraw with ' + r.redraw.segs + ' crack segments took ' + r.redraw.p95.toFixed(2) + ' ms (p95)');
    return 'no cracks 0 redraws, 0 canvas calls; new crack 1; 60 still frames 0; crackRev++ 1; 1 s of turning ' + r.turning +
      '; a redraw with three long cracks (' + r.redraw.segs + ' segments, open and mended) costs ' + r.redraw.median.toFixed(2) +
      ' ms median, ' + r.redraw.p95.toFixed(2) + ' ms p95';
  });
}]);

CASES.push(['4. FLIP: after completeFlip() and the rotor turned by π the crack is where it was', function (page) {
  return page.evaluate(function () {
    var H = window.Hourglass, sim = H.sim, ren = H.renderer, R = window.__rt, front = document.getElementById('c-front');
    var rotor = document.getElementById('rotor'), g = sim.geo, t = performance.now();
    /** a lattice point → page CSS px, through the rotor's (and every parent's) transform */
    function page(lx, ly) {
      var probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;width:0;height:0;left:' + (ren.cssW / 2 + (lx - g.cx) * ren.scale) +
        'px;top:' + (ren.cssH / 2 + (ly - g.cy) * ren.scale) + 'px';
      rotor.appendChild(probe);
      var b = probe.getBoundingClientRect();
      rotor.removeChild(probe);
      return [b.left, b.top];
    }
    var out = { cases: [] };
    [[1, 1, 0.9, 50, 2], [0, -1, 0.15, 40, 3]].forEach(function (c, n) {
      sim.forceCrack(R.seg(c[0], c[1], c[2]), c[3], c[4]);
      ren.syncDamage(0, t += 100);
      var k = sim.cracks.length - 1;
      var a = ren.chipVessel(k, {}), pa = page(a.x, a.y), imgA = R.img();
      var revA = sim.crackRev;
      sim.completeFlip();
      rotor.style.transform = 'rotate(' + Math.PI + 'rad)';
      var drew = ren.syncDamage(0, t += 100);
      var b = ren.chipVessel(k, {}), pb = page(b.x, b.y), imgB = R.img();
      // c-front itself turns over: each crack pixel is now at the point reflection
      var W = front.width, Hh = front.height, worst = 0, sum = 0, m = 0;
      for (var i = 0; i < W * Hh; i++) {
        if (imgA[4 * i + 3] === 0 && imgB[4 * (W * Hh - 1 - i) + 3] === 0) continue;
        var d = Math.abs(imgA[4 * i + 3] - imgB[4 * (W * Hh - 1 - i) + 3]);
        sum += d; m++;
        if (d > worst) worst = d;
      }
      out.cases.push({ move: Math.hypot(pa[0] - pb[0], pa[1] - pb[1]), drew: drew, rev: sim.crackRev !== revA,
                       meanAlphaDiff: sum / m, worst: worst, px: m });
      // turn back for the next case
      sim.completeFlip();
      rotor.style.transform = '';
      ren.syncDamage(0, t += 100);
    });
    return out;
  }).then(function (r) {
    r.cases.forEach(function (c, i) {
      ok(c.drew && c.rev, 'case ' + i + ': no redraw after the flip');
      ok(c.move < 1, 'case ' + i + ': the chip moved ' + c.move.toFixed(3) + ' CSS px on the page');
      ok(c.meanAlphaDiff < 0.5, 'case ' + i + ': c-front is not the point reflection (mean |Δα| ' + c.meanAlphaDiff.toFixed(3) + ', worst ' + c.worst + ')');
    });
    return r.cases.map(function (c) {
      return 'chip moved ' + c.move.toFixed(3) + ' px, c-front reflected (mean |Δα| ' + c.meanAlphaDiff.toFixed(3) + ' over ' + c.px + ' px)';
    }).join('; ');
  });
}]);

CASES.push(['5. GOLD: a mend runs gold half way along every arm; mended stays gold through a theme and a relayout', function (page) {
  return page.evaluate(function () {
    var H = window.Hourglass, sim = H.sim, ren = H.renderer, R = window.__rt, front = document.getElementById('c-front');
    var t = performance.now(), out = {};
    function solidGold(a, i) { return a[i + 3] > 180 && a[i] > a[i + 1] && a[i + 1] > a[i + 2] && a[i] - a[i + 2] > 60; }
    function goldNear(a, vx, vy, cells) {
      var W = front.width, c = R.toCanvas(vx, vy), rr = cells * R.S();
      for (var y = Math.floor(c[1] - rr); y <= c[1] + rr; y++) for (var x = Math.floor(c[0] - rr); x <= c[0] + rr; x++) {
        if ((x - c[0]) * (x - c[0]) + (y - c[1]) * (y - c[1]) > rr * rr) continue;
        if (solidGold(a, 4 * (y * W + x))) return true;
      }
      return false;
    }
    // the collars cover the domes' tips (and crack ends there); brass ones are gold-coloured themselves
    var g = sim.geo, underCap = g.HB + 3 * g.q - g.collarH - 1.5 * g.q - 1;
    /** midpoints of the segments of crack cr whose middle lies at fractions [lo, hi] of the way to their tip */
    function points(cr, lo, hi) {
      var p = ren._crackPath(cr), out2 = [];
      for (var s = 0; s < p.n; s++) {
        var tm = (p.can[7 * s + 4] + p.can[7 * s + 5]) / 2, my = (p.seg[4 * s + 1] + p.seg[4 * s + 3]) / 2;
        if (tm >= lo && tm <= hi && Math.abs(my) < underCap) out2.push([(p.seg[4 * s] + p.seg[4 * s + 2]) / 2, my]);
      }
      return out2;
    }
    /** how far a point is from the part of any crack the gold should already cover (t0 < p) */
    function fromGold(x, y, p) {
      var best = 1e9;
      sim.cracks.forEach(function (c) {
        var q = ren._crackPath(c);
        for (var s = 0; s < q.n; s++) {
          if (q.can[7 * s + 4] >= p) continue;
          var ax = q.seg[4 * s], ay = q.seg[4 * s + 1], bx = q.seg[4 * s + 2], by = q.seg[4 * s + 3];
          var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, u = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          u = u < 0 ? 0 : (u > 1 ? 1 : u);
          best = Math.min(best, Math.hypot(ax + u * dx - x, ay + u * dy - y));
        }
      });
      return best;
    }
    function along(a, cr, lo, hi, cells) {
      var pts = points(cr, lo, hi), hit = 0;
      pts.forEach(function (q) { if (goldNear(a, q[0], q[1], cells)) hit++; });
      return { hit: hit, n: pts.length };
    }
    /** the last third must be silver, except where it runs right beside gold of another arm */
    function lastThird(a, cr) {
      var hit = 0, n = 0;
      points(cr, 0.62, 1.0).forEach(function (q) {
        if (fromGold(q[0], q[1], 0.5) < 1.5) return;
        n++;
        if (goldNear(a, q[0], q[1], 0.5)) hit++;
      });
      return { hit: hit, n: n };
    }
    function rec(id, bulb, side, u, L, w, seed) {
      return { id: id, seg: R.seg(bulb, side, u), bulb: bulb, side: side, u: u, x: 0, y: 0, seed: seed >>> 0, L: L, w: w,
               sealed: false, holes: new Int32Array(3), nh: 0, mouth: new Int32Array(24), nm: 0, born: 0 };
    }
    function count(a) { var n = 0; for (var i = 0; i < a.length; i += 4) if (solidGold(a, i)) n++; return n; }
    // the mend at 0.5, for a star (several arms and branches) and a hoop, over several seeds
    out.first = { hit: 0, n: 0 }; out.last = { hit: 0, n: 0 }; out.arms = [];
    for (var k = 0; k < 6; k++) {
      sim.cracks.length = 0;
      sim.cracks.push(rec(9200 + 2 * k, 1, 1, 0.9, 60, 2, Math.imul(k + 1, 0x9E3779B1)));
      sim.cracks.push(rec(9201 + 2 * k, 0, -1, 0.12, 50, 1, Math.imul(k + 7, 0x85EBCA77)));
      sim.crackRev++;
      ren.setMend(0.5);
      ren.syncDamage(0, t += 100);
      var a = R.img();
      if (!k) out.gold = count(a);
      out.arms.push(ren._crackPath(sim.cracks[0]).arms);
      sim.cracks.forEach(function (c) {
        var f = along(a, c, 0.03, 0.42, 1.0), l = lastThird(a, c);
        out.first.hit += f.hit; out.first.n += f.n; out.last.hit += l.hit; out.last.n += l.n;
      });
    }
    // lift early: the gold recedes; 0 clears it
    ren.setMend(0);
    ren.syncDamage(0, t += 100);
    out.cleared = count(R.img());
    // mended: gold the whole way, through a new theme and a relayout
    var cr = sim.cracks[0];
    sim.sealCracks();
    ren.syncDamage(0, t += 100);
    out.sealed = along(R.img(), cr, 0.02, 1.0, 1.0);
    H.setTheme('volcanic');
    out.volcanic = along(R.img(), cr, 0.02, 1.0, 1.0);
    ren.layout(ren.cssW, ren.cssH, window.devicePixelRatio);
    out.layout = along(R.img(), cr, 0.02, 1.0, 1.0);
    return out;
  }).then(function (r) {
    ok(r.gold > 200, 'only ' + r.gold + ' gold pixels at mend 0.5');
    ok(r.first.n > 60 && r.first.hit >= 0.95 * r.first.n, 'gold along the first half at ' + r.first.hit + '/' + r.first.n + ' points');
    ok(r.last.n > 60 && r.last.hit <= 0.03 * r.last.n, 'gold along the last third at ' + r.last.hit + '/' + r.last.n + ' points');
    ok(r.cleared === 0, r.cleared + ' gold pixels left after setMend(0)');
    ['sealed', 'volcanic', 'layout'].forEach(function (k) {
      ok(r[k].n > 40 && r[k].hit === r[k].n, k + ': gold at ' + r[k].hit + '/' + r[k].n + ' points along the mended crack');
    });
    return 'mend 0.5 over 6 seeds (stars of ' + r.arms.join('/') + ' arms, and hoops): gold at ' + r.first.hit + '/' + r.first.n +
      ' points of the first half, ' + r.last.hit + '/' + r.last.n + ' of the last third; cleared at 0; mended gold ' + r.sealed.hit + '/' +
      r.sealed.n + ', after volcanic ' + r.volcanic.hit + '/' + r.volcanic.n + ', after layout ' + r.layout.hit + '/' + r.layout.n;
  });
}]);

CASES.push(['6. SPILL: the dune lands, keeps its slope, slides, falls away, clears, and draws quickly', function (page) {
  var r, r2, trials = [];
  return page.evaluate(function () {
    var H = window.Hourglass, sim = H.sim, ren = H.renderer, g = sim.geo, P = window.HourglassPhysics;
    // #c-spill as the controller will place it: in #zoom, 1.7 layout boxes wide
    var zoom = document.getElementById('zoom'), c = document.createElement('canvas');
    var w = 1.7 * ren.cssW, h = ren.cssH, s = ren.scale;
    c.id = 'c-spill-test';
    c.style.cssText = 'position:absolute;left:' + (-0.35 * ren.cssW) + 'px;top:0;pointer-events:none';
    zoom.appendChild(c);
    var deskY = h / 2 + (g.HB + 14 * g.q) * s, mid = w / 2, half = (g.capHalf + 30 * g.q) * s;
    var sp = new P.Spill(c, ren), out = {};
    out.w0 = c.width;
    sp.layout(w, h, window.devicePixelRatio, deskY, mid - half, mid + half);
    out.w1 = c.width;
    var chipX = mid + (P.profile(0.9, g) + 0.3 * g.wall) * s, chipY = h / 2 + 0.9 * g.HB * s, i;
    function rnd(n) { var x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }
    for (i = 0; i < 300; i++) sp.add(chipX + rnd(i) * 3, chipY + rnd(i + 999) * 2, 20 + 40 * rnd(i + 7), 30 * rnd(i + 3), (rnd(i + 5) * 256) | 0);
    out.alloc = [c.width, c.height];
    function steps(n, gx, gy, each) { for (var j = 0; j < n; j++) { sp.step(1 / 60, gx, gy, 2000, 0, 0); sp.draw(); if (each) each(j); } }
    function heights() { var a = []; for (var q = sp.c0; q <= sp.c1; q++) a.push(sp.col[q] * 0.5); return a; }
    function centroid() { var m = 0, sx = 0; for (var q = sp.c0; q <= sp.c1; q++) { m += sp.col[q]; sx += sp.col[q] * (2 * q + 1); } return sx / m; }
    steps(180, 0, 1);
    out.heap = sp.heapN; out.air = sp.nAir; out.count = sp.count;
    var hh = heights(), step = 0;
    for (i = 1; i < hh.length; i++) step = Math.max(step, Math.abs(hh[i] - hh[i - 1]));
    out.step = step; out.top = Math.max.apply(null, hh);
    // a look by eye: the dune on the desk
    out.snapAt = c.getBoundingClientRect().toJSON();
    window.__spill = sp;
    return out;
  }).then(function (x) {
    r = x;
    return SNAP ? page.screenshot({ path: path.join(SNAP, 'spill_dune.png') }) : null;
  }).then(function () {
    return page.evaluate(function () {
      var sp = window.__spill, out = {}, i, c = sp.canvas;
      function steps(n, gx, gy, each) { for (var j = 0; j < n; j++) { sp.step(1 / 60, gx, gy, 2000, 0, 0); sp.draw(); if (each) each(j); } }
      function centroid() { var m = 0, sx = 0; for (var q = sp.c0; q <= sp.c1; q++) { m += sp.col[q]; sx += sp.col[q] * (2 * q + 1); } return sx / m; }
      var c0 = centroid(), a = 25 * Math.PI / 180;
      out.downhill = null;
      steps(120, Math.sin(a), Math.cos(a), function (j) { if (out.downhill === null && centroid() - c0 >= 10) out.downhill = (j + 1) / 60; });
      out.shift = centroid() - c0;
      out.empty = null;
      steps(180, 0, -1, function (j) { if (out.empty === null && sp.heapN === 0) out.empty = (j + 1) / 60; });
      sp.clear();
      out.cleared = [sp.count, c.width, c.height];
      // draw() with 600 grains in flight over a full dune
      var lay = [sp.wCss, sp.hCss, 3, sp.deskY, sp.x0, sp.x1];
      sp.layout.apply(sp, lay);
      for (i = 0; i < 6000 && sp.heapN < 5000; i++) {
        sp.add(sp.x0 + 4 + ((i * 7919) % Math.floor(sp.x1 - sp.x0 - 8)), sp.deskY - 40, 0, 0, i & 255);
        if (i % 300 === 299) steps(60, 0, 1);
      }
      steps(240, 0, 1);
      out.fullHeap = sp.heapN;
      return out;
    });
  }).then(function (x) {
    r2 = x;
    // draw() once an animation frame, as the app does (the canvas flushes between frames),
    // with 600 grains in flight spread over the canvas and landing on a full dune. This
    // machine is shared, so three trials are timed and the best one's p95 is the gate.
    function trial() {
      return page.evaluate(function () {
        return new Promise(function (resolve) {
          var sp = window.__spill, times = [], seedN = 1, f = 0, air = 1e9;
          function top() {
            while (sp.nAir < 600) {
              var k = seedN++, x = 40 + ((k * 2654435761) >>> 0) % Math.floor(sp.wCss - 80), y = 30 + ((k * 40503) >>> 0) % Math.floor(sp.deskY - 120);
              sp.add(x, y, ((k * 17) % 300) - 150, -((k * 31) % 200), k & 255);
            }
          }
          function frame() {
            sp.step(1 / 60, 0, 1, 150, 0, 0);
            top();                                   // exactly 600 in flight at every draw
            if (f >= 40) air = Math.min(air, sp.nAir);
            var t0 = performance.now();
            sp.draw();
            times.push(performance.now() - t0);
            if (++f < 220) { requestAnimationFrame(frame); return; }
            times = times.slice(40).sort(function (p, q) { return p - q; });
            resolve({ p95: times[Math.floor(times.length * 0.95)], median: times[times.length >> 1], max: times[times.length - 1],
                      air: air, heap: sp.heapN, iso: self.crossOriginIsolated });
          }
          requestAnimationFrame(frame);
        });
      }).then(function (t) { trials.push(t); });
    }
    return trial().then(trial).then(trial);
  }).then(function () {
    return SNAP ? page.screenshot({ path: path.join(SNAP, 'spill_full.png') }) : null;
  }).then(function () {
    var best = trials.slice().sort(function (a, b) { return a.p95 - b.p95; })[0];
    r2.p95 = best.p95; r2.median = best.median; r2.iso = best.iso;
    r2.air = Math.min.apply(null, trials.map(function (x) { return x.air; }));
    r2.trials = trials.map(function (x) { return x.p95.toFixed(3) + '/' + x.median.toFixed(3); }).join(', ');
    ok(r.w0 === 0 && r.w1 === 0, 'the canvas had a backing store before anything spilled: ' + r.w0 + ' / ' + r.w1);
    ok(r.alloc[0] > 0, 'no backing store after the first add()');
    ok(r.heap === 300 && r.air === 0 && r.count === 300, 'after 3 s: heap ' + r.heap + ', air ' + r.air + ', count ' + r.count);
    ok(r.step <= 1.3 + 0.5, 'largest step ' + r.step + ' px');
    ok(r2.downhill !== null && r2.shift >= 10, 'the centroid moved ' + r2.shift.toFixed(1) + ' px downhill in 2 s');
    ok(r2.empty !== null, 'turned over, the dune was not empty within 3 s');
    ok(r2.cleared[0] === 0 && r2.cleared[1] === 0, 'clear(): count ' + r2.cleared[0] + ', width ' + r2.cleared[1]);
    ok(r2.air === 600, 'only ' + r2.air + ' grains in flight for the timing');
    ok(r2.iso, 'the page was not cross-origin isolated (timer too coarse to time draw())');
    ok(r2.p95 <= 0.3, 'draw() p95 ' + r2.p95.toFixed(3) + ' ms with 600 in flight over ' + r2.fullHeap + ' on the dune');
    return '300 landed (' + r.top + ' px tall, largest step ' + r.step + ' px); downhill 10 px in ' + r2.downhill.toFixed(2) + ' s (' +
      r2.shift.toFixed(1) + ' px in 2 s); empty in ' + r2.empty.toFixed(2) + ' s turned over; clear() → 0, width 0; draw() p95 ' +
      r2.p95.toFixed(3) + ' ms, median ' + r2.median.toFixed(3) + ' ms (600 in flight, ' + r2.fullHeap + ' on the dune, per frame; ' +
      'p95/median of the 3 trials: ' + r2.trials + ' ms)';
  });
}, true]);

function main() {
  return new Promise(function (res, rej) { srv = server.start(PORT, ROOT, res); srv.on('error', rej); }).then(function () {
    return chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  }).then(function (b) {
    browser = b;
    return CASES.reduce(function (done, c) {
      return done.then(function () { return test(c[0], c[1], c[2]); });
    }, Promise.resolve());
  }).then(function () {
    return browser.close();
  }).then(function () {
    return new Promise(function (res) { srv.close(res); });
  }).then(function () {
    console.log(failures ? 'render-app: ' + failures + ' of ' + count + ' cases FAILED' : 'render-app: all ' + count + ' cases passed');
    process.exit(failures ? 1 : 0);
  });
}

main().catch(function (e) {
  console.log('FAIL  harness: ' + (e && e.stack ? e.stack : e));
  try { if (browser) browser.close(); } catch (x) {}
  try { if (srv) srv.close(); } catch (x) {}
  process.exit(1);
});
