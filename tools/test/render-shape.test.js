/*
 * other glasses, as they are drawn (Playwright Chromium). Every shape of
 * HourglassPhysics.SHAPES, the classic teardrop first as the reference, is
 * built as the app builds a glass (a Sim of that shape, a Renderer on the
 * app's canvases, laid out for a phone: 374 x 718 CSS px at DPR 3), run to
 * the middle of its time, and its layers are read back pixel by pixel.
 *
 * For every shape, with each kind of glass in GLASSES (today the drawn 2-D
 * glass; the WebGL glass is to be added beside it, see GLASSES and PROBES):
 *
 *   sand        every pixel of sand on c-sand lies inside the shape's bore
 *               (profile), mid-run with the thread in the air; the sand's
 *               canvas sits on the middle of the glass, at the glass's scale
 *   the sweep   the same in the Reset sweep, at nine moments of the old sand
 *               going and 39 of the new coming, and the new sand's thread
 *               starts at the shape's own top
 *   the wall    on both glass layers (far wall and near wall) the inner
 *               surface of the glass follows profile within 1.5 device
 *               pixels, at 20 heights in each bulb, on both sides; and on
 *               every shape but the classic the wall is as thick there as
 *               geo.wall says, within 1.5 pixels (it does not thin away
 *               where a funnel flares or an end lies flat)
 *   half turn   both glass layers, with the frame and without, are the same
 *               picture turned by 180 degrees (a Flip puts the lattice back
 *               upright under layers that are not redrawn): at most 100 of
 *               a layer's pixels differ by more than 24 of 255 (up to 34 do
 *               on these nine glasses, on the smoothed edges of hairlines
 *               and of parts drawn turned)
 *   collar      with the frame, nothing of the glass shows beside a collar
 *               in the collar's own rows: it covers the end, both ends
 *   lights      what is drawn on c-light for the bare glass lies on the
 *               glass; the window glint is whole and inside the
 *               bore in both bulbs (not in mid-air, not cut by the wall)
 *   cracks      a crack's path stays on the glass and off the waist; on every
 *               shape but the classic no step of it is longer than a step
 *               (a low, flat end makes steps taken along the axis jump); by
 *               the waist it is a hoop, on the dome a star, between them a
 *               run, where this shape has its waist and its dome
 *   no errors   nothing is thrown or logged as an error by the page
 *
 * and the suite can tell: the same checks on a glass drawn with the wrong
 * shape (the classic teardrop's layers around another shape's sand) fail.
 *
 *   node tools/test/render-shape.test.js [--port n] [--only id[,id]]     exits 0 when every case passes
 *
 * The page and physics.js are served from memory through Playwright's
 * routing, at http://localhost:<port>/; nothing listens on the port and no
 * files are written. The port defaults to $PORT or 8802 (a bare number as the
 * first argument is taken as the port too). HOURGLASS_PHYSICS=<file> draws
 * with that copy of physics.js instead of the repository's (to try a change).
 * SNAP=<dir> saves each shape's glass there, bare and framed, for a look.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var L = require('./lib/load-physics.js');
var chromium = require('playwright').chromium;

var argv = process.argv.slice(2), PORT = +process.env.PORT || 8802, ONLY = null;
for (var ai = 0; ai < argv.length; ai++) {
  if (argv[ai] === '--port') PORT = +argv[++ai];
  else if (argv[ai] === '--only') ONLY = argv[++ai].split(',');
  else if (/^\d+$/.test(argv[ai])) PORT = +argv[ai];
}
var ORIGIN = 'http://localhost:' + PORT + '/';
var SRC = process.env.HOURGLASS_PHYSICS ? fs.readFileSync(process.env.HOURGLASS_PHYSICS, 'utf8') : L.physicsSource();
var SNAP = process.env.SNAP || '';
var IDS = L.P.SHAPE_ORDER;

/*
 * The kinds of glass. `gl` hands the Renderer the two WebGL canvases; `is`
 * is what it must then say it draws with. The WebGL glass is added here,
 * { id: 'webgl', gl: true, is: 'webgl' }, with its probes in PROBES (in the
 * page, below): how its two layers are read back and where their inner and
 * outer surfaces are. Everything else in this file is the same for both.
 */
var GLASSES = [
  { id: 'drawn', gl: false, is: 'drawn' }
];

var failures = 0, count = 0;
function ok(cond, msg) { if (!cond) throw new Error(msg); }
var f2 = function (x) { return x.toFixed(2); };

/* ---- the page ---------------------------------------------------------------- */

function pageCode() {
  var P = window.HourglassPhysics;
  function $(id) { return document.getElementById(id); }
  var T = window.T = { ren: null, sim: null };

  /** A glass of this shape half way through a run: about 0.4 of its sand below, the thread in the air. */
  T.build = function (cfg) {
    var sim = new P.Sim({ scale: 1.08, seed: 4242, shape: cfg.shape }), i, t;
    var n = Math.round(sim.capacity * Math.min(sim.fillMax, 0.66));
    sim.reset(n);
    for (i = 0; i < 240; i++) { sim.beginFrame(); sim.step(); }
    sim.fastForward(Math.round(n * 0.34));
    sim.gateOpen = true; t = sim.nTop;
    for (i = 0; i < 480; i++) { sim.beginFrame(); t -= n * 0.06 / 480; sim.targetTop = Math.max(0, Math.ceil(t)); sim.step(); }
    var els = { back: $('c-back'), sand: $('c-sand'), bloom: $('c-bloom'), front: $('c-front'), light: $('c-light') };
    if (cfg.gl) { els.glBack = $('c-glass-back'); els.glFront = $('c-glass-front'); }
    // `drawAs`: the layers of another shape around this one's sand (the control)
    var ren = new P.Renderer(sim, els), real = sim.geo;
    if (cfg.drawAs) sim.geo = P.makeGeometry(1.08, cfg.drawAs);
    ren.setFrame(false); ren.setTheme('sahara'); ren.layout(374, 718, 3);
    sim.geo = real;
    ren.drawSand(); ren.drawSand(); ren.drawSand();
    ren.drawGlass(0, true);
    T.ren = ren; T.sim = sim; T.n = n; T.drawAs = cfg.drawAs || null;
    return { glass: ren.glass ? 'webgl' : 'drawn', total: sim.total, below: sim.total - sim.nTop, np: sim.np, S: ren.scale * ren.dpr,
             W: sim.W, H: sim.H, topY: sim.topY, equator: sim.geo.equator, R: sim.geo.R, HB: sim.geo.HB, wallPx: sim.geo.wall * ren.scale * ren.dpr };
  };
  T.frame = function (on) {
    var real = T.sim.geo;
    if (T.drawAs) T.sim.geo = P.makeGeometry(1.08, T.drawAs);
    T.ren.setFrame(on); T.ren.layout(374, 718, 3);
    T.sim.geo = real;
    T.ren.drawGlass(0, true);
  };

  /** A 2-D layer's pixels. */
  function layer(id) {
    var c = $(id);
    return { W: c.width, H: c.height, d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
  }
  /** Alpha at a point between pixel centres. */
  function alphaAt(im, x, y) {
    x -= 0.5; y -= 0.5;
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    if (x0 < 0 || y0 < 0 || x0 >= im.W - 1 || y0 >= im.H - 1) return 0;
    var i = 4 * (y0 * im.W + x0) + 3, w = 4 * im.W;
    return (im.d[i] * (1 - fx) + im.d[i + 4] * fx) * (1 - fy) + (im.d[i + w] * (1 - fx) + im.d[i + w + 4] * fx) * fy;
  }

  /*
   * How each kind of glass shows its wall, read along a line straight
   * through it (v[k]: alpha every quarter pixel from 9 px inside the bore to
   * 20 px outside it). Each probe answers [inner, outer]: where the inner and
   * the outer surface are, in pixels from the bore as profile has it, or null
   * for one it cannot find.
   *   drawn, far wall (c-back)    the reflection of the far wall is clipped
   *                               to the bore: alpha steps down there; the
   *                               body of the glass ends at the outer surface
   *   drawn, near wall (c-front)  a hairline is stroked along each surface:
   *                               the first crest of alpha on the way out,
   *                               and the highest after it
   * (The WebGL glass: its layers are read with gl.readPixels, bottom row
   * first, and its own two probes go here.)
   */
  function crest(v, k, floor) {
    var sw = 0, sx = 0;
    for (var j = Math.max(0, k - 6); j <= Math.min(v.length - 1, k + 6); j++) { var w = Math.max(0, v[j] - floor); sw += w; sx += w * (j - 36) / 4; }
    return sx / sw;
  }
  var PROBES = {
    drawn: {
      layers: ['c-back', 'c-front'],
      'c-back': function (v) {
        var k, d, j, half;
        for (k = 4; k < v.length - 8; k++) {
          d = v[k - 3] - v[k + 3];
          if (d >= 6 && d >= v[k - 4] - v[k + 2] && d >= v[k - 2] - v[k + 4]) break;
        }
        if (k >= v.length - 8) return [null, null];
        half = v[k + 5] / 2;                                             // (the body of the glass, just outside the bore)
        for (j = k + 5; j < v.length; j++) if (v[j] < half) return [(k - 36) / 4, (j - 1 + (v[j - 1] - half) / (v[j - 1] - v[j]) - 36) / 4];
        return [(k - 36) / 4, null];
      },
      'c-front': function (v) {
        var k, j, lo, dip, best;
        for (k = 8; k < v.length - 8; k++) {
          if (v[k] < v[k - 1] || v[k] < v[k + 1]) continue;
          lo = Math.min(v[k - 8], v[k - 4]); dip = v[k];
          for (j = k + 1; j <= k + 8; j++) if (v[j] < dip) dip = v[j];
          if (v[k] - lo >= 12 && v[k] - dip >= 12) break;
        }
        if (k >= v.length - 8) return [null, null];
        best = k + 8;
        for (j = k + 8; j < v.length; j++) if (v[j] > v[best]) best = j;
        return [crest(v, k, v[k] - 0.5 * (v[k] - Math.max(lo, dip))), v[best] >= 40 && v[best] - dip >= 12 ? crest(v, best, 0.5 * (v[best] + dip)) : null];
      }
    }
  };

  /** Sand on c-sand against the bore: pixels in all, pixels outside, the worst by how much (cells), the first row with sand (cells). */
  T.sand = function () {
    var ren = T.ren, g = T.sim.geo, BW = ren.BW, BH = ren.BH, d = ren.sctx.getImageData(0, 0, BW, BH).data;
    var n = 0, out = 0, worst = 0, top = -1, x, y, r, dx;
    for (y = 0; y < BH; y++) {
      r = P.profile(Math.abs((y + 0.5) / 2 - g.cy) / g.HB, g);
      for (x = 0; x < BW; x++) {
        if (!d[4 * (y * BW + x) + 3]) continue;
        n++;
        if (top < 0) top = y / 2;
        dx = Math.abs((x + 0.5) / 2 - g.cx);
        if (!(dx < r)) { out++; if (dx - r > worst) worst = dx - r; }
      }
    }
    // where the sand's canvas lies on the glass's (CSS px): its middle on the middle
    var cs = $('c-sand').style, cb = $('c-back').style;
    var off = Math.max(Math.abs(parseFloat(cs.left) + parseFloat(cs.width) / 2 - parseFloat(cb.width) / 2),
                       Math.abs(parseFloat(cs.top) + parseFloat(cs.height) / 2 - parseFloat(cb.height) / 2));
    return { n: n, out: out, worst: worst, top: top, off: off, pxPerCell: parseFloat(cs.width) / T.sim.W, scale: ren.scale };
  };

  /** The Reset sweep at p (1 + p: the old sand goes; 2 + p: the new comes), then the sand as T.sand reads it. */
  T.sweep = function (pp) {
    var ren = T.ren, sim = T.sim;
    if (pp < 2) { ren.setSweep(1, pp - 1); ren.drawSand(); }
    else {
      if (!T.fresh) { sim.reset(T.n); sim.tilt = 0; T.fresh = true; }
      ren.setSweep(2, pp - 2); ren.drawSand();
    }
    return T.sand();
  };

  /**
   * The wall on both layers against profile, at 20 heights in each bulb on
   * both sides: how far the inner surface is from the bore (px; the worst,
   * and where), how far the wall's thickness is from g.wall (px; the worst),
   * and the places where a probe found no surface.
   */
  T.edges = function (kind) {
    var ren = T.ren, g = T.sim.geo, S = ren.scale * ren.dpr, pr = PROBES[kind], out = {};
    pr.layers.forEach(function (id) {
      var im = layer(id), res = { n: 0, worst: 0, at: '', line: '', none: [], thick: 0, thickAt: '', thickLine: '', thin: 1e9 };
      for (var k = 0; k < 20; k++) {
        var u = 0.05 + 0.9 * k / 19, r = P.profile(u, g), dr = P.profile(u + 0.002, g) - P.profile(u - 0.002, g), dy = 0.004 * g.HB;
        var len = Math.sqrt(dr * dr + dy * dy);
        for (var q = 0; q < 4; q++) {
          var b = q & 1 ? 1 : -1, sd = q & 2 ? 1 : -1, where = 'u ' + u.toFixed(2) + (b < 0 ? ', upper bulb' : ', lower bulb') + (sd < 0 ? ', left' : ', right');
          // the point on the bore, and the way straight out of the glass there
          var px = im.W / 2 + sd * r * S, py = im.H / 2 + b * u * g.HB * S, nx = sd * dy / len, ny = -b * dr / len, v = [];
          for (var j = -36; j <= 80; j++) v.push(alphaAt(im, px + nx * j / 4, py + ny * j / 4));
          var e = pr[id](v), line = v.filter(function (a, i) { return i % 4 === 0; }).map(Math.round).join(' ');
          res.n++;
          if (e[0] === null || e[1] === null) { res.none.push(where + (e[0] === null ? '' : ' (outer)')); if (!res.line) res.line = line; continue; }
          if (Math.abs(e[0]) > Math.abs(res.worst)) { res.worst = e[0]; res.at = where; res.line = line; }
          var th = e[1] - e[0] - g.wall * S;
          if (Math.abs(th) > Math.abs(res.thick)) { res.thick = th; res.thickAt = where; res.thickLine = line; }
          if ((e[1] - e[0]) / (g.wall * S) < res.thin) res.thin = (e[1] - e[0]) / (g.wall * S);
        }
      }
      out[id] = res;
    });
    return out;
  };

  /** Each glass layer against itself turned by 180 degrees: the largest difference of a channel, and pixels that differ by more than 24. */
  T.turn = function (kind) {
    var out = {};
    PROBES[kind].layers.forEach(function (id) {
      var im = layer(id), d = im.d, N = im.W * im.H, max = 0, bad = 0, lit = 0, i, j, c, e;
      for (i = 0; i < N >> 1; i++) {
        j = N - 1 - i;
        if (d[4 * i + 3] || d[4 * j + 3]) lit++;
        // (alpha, and colour as much as there is of it)
        e = Math.abs(d[4 * i + 3] - d[4 * j + 3]);
        for (c = 0; c < 3; c++) e = Math.max(e, Math.abs(d[4 * i + c] * d[4 * i + 3] - d[4 * j + c] * d[4 * j + 3]) / 255);
        if (e > max) max = e;
        if (e > 24) bad++;
      }
      out[id] = { max: max, bad: bad, lit: lit };
    });
    return out;
  };

  /**
   * The collars (frame on). The collar's own half-width is read off c-front
   * (the run of solid pixels through its middle row). Then, in the collar's
   * rows, how far from the axis anything shows on each layer, short of the
   * posts: more than the collar's half-width, and the end of the glass
   * sticks out beside it.
   */
  T.collar = function (kind) {
    var ren = T.ren, g = T.sim.geo, q = g.q, S = ren.scale * ren.dpr, front = layer('c-front'), out = { ends: [] };
    var ids = PROBES[kind].layers.concat(['c-light']), ims = {};
    ids.forEach(function (id) { ims[id] = id === 'c-front' ? front : layer(id); });
    for (var b = -1; b <= 1; b += 2) {
      var y0 = g.HB - 3.5 * q, y1 = g.HB + 3 * q;                       // the collar, in cells from the neck
      var cy = Math.round(front.H / 2 + b * (y0 + y1) / 2 * S), cx = front.W / 2, half = 0, x, y, id;
      while (half < cx && front.d[4 * (cy * front.W + Math.floor(cx + half)) + 3] === 255 && front.d[4 * (cy * front.W + Math.floor(cx - half - 1)) + 3] === 255) half++;
      var lim = Math.floor((g.postX - 3.2 * q) * S), end = { bulb: b, half: half, reach: {} };
      var ya = Math.ceil(front.H / 2 + b * (b < 0 ? y1 : y0) * S + 1.5), yb = Math.floor(front.H / 2 + b * (b < 0 ? y0 : y1) * S - 1.5);
      for (id in ims) {
        // (under the lower collar c-light also holds the pool of light on the base, as it always has: not the glass)
        if (id === 'c-light' && b > 0) continue;
        var im = ims[id], reach = 0;
        for (y = ya; y <= yb; y++) {
          for (x = lim; x > reach; x--) {
            if (im.d[4 * (y * im.W + Math.floor(cx + x)) + 3] || im.d[4 * (y * im.W + Math.floor(cx - x - 1)) + 3]) { reach = x; break; }
          }
        }
        end.reach[id] = reach;
      }
      out.ends.push(end);
    }
    return out;
  };

  /**
   * c-light on the bare glass: lit pixels, and those that lie off the glass
   * (where c-back, the glass's own body, has nothing); and the window glint
   * in each bulb, which is the only bright white right of the axis: its
   * pixels, and the least distance of one from the bore's wall (cells;
   * negative: it is cut).
   */
  T.lights = function () {
    var ren = T.ren, g = T.sim.geo, S = ren.scale * ren.dpr, im = layer('c-light'), d = im.d, body = layer('c-back').d;
    var lit = 0, out = 0, glint = [{ n: 0, margin: 1e9 }, { n: 0, margin: 1e9 }], x, y, i, cxp = im.W / 2, cyp = im.H / 2;
    for (y = 0; y < im.H; y++) {
      var yc = (y + 0.5 - cyp) / S, ri = P.profile(Math.abs(yc) / g.HB, g);
      for (x = 0; x < im.W; x++) {
        i = 4 * (y * im.W + x);
        if (d[i + 3] < 3) continue;                                        // (under 1 %: the last of an edge's smoothing)
        lit++;
        if (!body[i + 3]) out++;
        var xc = (x + 0.5 - cxp) / S;
        if (xc > 0 && d[i + 3] >= 40 && d[i] >= 200 && d[i + 1] >= 200 && d[i + 2] >= 200) {       // (white, or white in the caustic's glow)
          var gb = glint[yc < 0 ? 0 : 1];
          gb.n++;
          if (ri - xc < gb.margin) gb.margin = ri - xc;
        }
      }
    }
    return { lit: lit, out: out, glint: glint, S: S };
  };

  /** Cracks on this shape's glass (no canvas needed: the paths alone). */
  T.cracks = function () {
    var g = T.sim.geo, eq = g.equator, res = { n: 0, bad: 0, why: '', longest: 0, hoops: 0, hoopOk: 0, stars: 0, starOk: 0, runs: 0, runOk: 0 };
    function path(u, Lc, seed) {
      var r = Object.create(P.Renderer.prototype);
      r.sim = { geo: g, cracks: [{ id: seed, seg: 0, bulb: 1, side: 1, u: u, x: 0, y: 0, seed: seed >>> 0, L: Lc, w: 0, sealed: false, nh: 0 }],
                angle: 0, tilt: 0, crackRev: 1, warnSeg: -1, segInfo: P.Sim.prototype.segInfo };
      r.dpr = 3; r.scale = 1.4; r.frame = true; r.cssW = 374; r.cssH = 718;
      return r._crackPath(r.sim.cracks[0]);
    }
    for (var seed = 1; seed <= 40; seed++) {
      [0.02, 0.05, 0.2, 0.45, 0.7, 0.85, 0.93, 0.99].forEach(function (u) {
        [10, 50, 140].forEach(function (Lc) {
          var e = path(u, Lc, seed * 40503), u0 = Math.min(u, 0.995), uLo = Math.min(Math.max(0.03, 4.5 / g.HB), u0);
          for (var s = 0; s < e.n; s++) {
            var o = 7 * s, len = Math.sqrt(Math.pow(e.can[o + 2] - e.can[o], 2) + Math.pow(e.can[o + 3] - e.can[o + 1], 2));
            if (len > res.longest) res.longest = len;
            for (var k = 0; k < 2; k++) {
              var x = e.can[o + 2 * k], y = e.can[o + 2 * k + 1], uu = y / g.HB;
              res.n++;
              if (uu < uLo - 1e-5 || uu > 0.995 + 1e-5) { res.bad++; res.why = 'u ' + uu; }
              else if (Math.abs(x) > P.profile(uu, g) + 1e-3) { res.bad++; res.why = 'x ' + x + ' outside r ' + P.profile(uu, g); }
            }
          }
        });
      });
      // its kind, by where this shape has its waist and its dome
      // (a hoop sets out round the glass, a run along it: how far its first six steps take it down the axis, in cells a step)
      var e1 = path(0.4 * eq, 40, seed * 7919), n1 = e1.ws[1] - e1.ws[0];
      res.hoops++;
      if (e1.arms === 1 && n1 >= 6 && Math.abs(e1.can[7 * 5 + 3] - e1.can[1]) / 6 < 0.35) res.hoopOk++;
      var e2 = path(eq + 0.5 * (1 - eq), 40, seed * 104729);
      res.stars++;
      if (e2.arms >= 3 && e2.arms <= 5) res.starOk++;
      var e3 = path(0.75 * eq, 40, seed * 15485863), n3 = e3.ws[1] - e3.ws[0];
      res.runs++;
      if (e3.arms === 1 && n3 >= 6 && (e3.can[7 * 5 + 3] - e3.can[1]) / 6 > 0.35) res.runOk++;
    }
    return res;
  };

  window.ready = true;
}

var HTML = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<style>html,body{margin:0;background:#0b0c0e}#rotor{position:absolute;left:0;top:0}#rotor canvas{position:absolute;left:0;top:0}',
  '#c-bloom{mix-blend-mode:screen}#c-light{position:absolute;left:0;top:0}</style>',
  '</head><body><div id="rotor">',
  '<canvas id="c-back"></canvas><canvas id="c-glass-back"></canvas><canvas id="c-sand"></canvas><canvas id="c-bloom"></canvas>',
  '<canvas id="c-glass-front"></canvas><canvas id="c-front"></canvas></div><canvas id="c-light"></canvas>',
  '<script src="physics.js"></script>',
  '<script>(' + pageCode.toString() + ')();</script></body></html>'
].join('\n');

function open(browser) {
  var page;
  return browser.newContext({ viewport: { width: 400, height: 760 } }).then(function (ctx) {
    return ctx.newPage();
  }).then(function (pg) {
    page = pg;
    page.errors = [];
    page.on('pageerror', function (e) { page.errors.push('pageerror: ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
    return page.route(ORIGIN + '**', function (route) {
      var u = route.request().url().slice(ORIGIN.length).split('?')[0];
      if (u === 'physics.js') return route.fulfill({ status: 200, body: SRC, contentType: 'text/javascript; charset=utf-8' });
      if (u === 'index.html') return route.fulfill({ status: 200, body: HTML, contentType: 'text/html; charset=utf-8' });
      return route.fulfill({ status: 404, body: 'not found' });
    });
  }).then(function () {
    return page.goto(ORIGIN + 'index.html');
  }).then(function () {
    return page.waitForFunction(function () { return window.ready === true; });
  }).then(function () {
    return page;
  });
}

/* ---- what a shape's picture must be ------------------------------------------- */

var classicGlint = null;                // the classic glass's glint, in pixels per square device pixel of a cell

/**
 * One shape with one kind of glass, through every check. Returns the lines
 * to print; throws at the first check that fails. `drawAs` draws the layers
 * of another shape around this one's sand (the control): then the checks of
 * the bare glass are all made, and the ones that fail are returned.
 */
async function look(browser, id, glass, drawAs) {
  var page = await open(browser), fails = [], notes = [];
  function check(cond, msg) { if (!cond) { if (drawAs) fails.push(msg); else throw new Error(msg); } }
  try {
    var b = await page.evaluate(function (c) { return window.T.build(c); }, { shape: id, gl: glass.gl, drawAs: drawAs || null });
    ok(b.glass === glass.is, 'the glass is ' + b.glass + ', this case is for the ' + glass.is + ' glass');
    ok(b.below > 0.3 * b.total && b.below < 0.5 * b.total && b.np > 20, 'not mid-run: ' + b.below + ' of ' + b.total + ' grains below, ' + b.np + ' in the air');

    // sand
    var s = await page.evaluate(function () { return window.T.sand(); });
    ok(s.n > 20000, 'only ' + s.n + ' pixels of sand: this case could not tell');
    ok(s.out === 0, s.out + ' of ' + s.n + ' pixels of sand lie outside the glass, by up to ' + f2(s.worst) + ' cells');
    // (the glass's canvases are a whole number of CSS px wide and high, the sand's is not: half a pixel at most between their middles)
    ok(s.off <= 0.5 && Math.abs(s.pxPerCell - s.scale) < 1e-4, 'the sand\'s canvas is ' + s.off + ' px off the middle of the glass, at ' + s.pxPerCell + ' px a cell (the glass: ' + s.scale + ')');
    notes.push(s.n + ' px of sand, none outside the bore');

    // the bare glass: inner edge, half turn, lights
    var e = await page.evaluate(function (k) { return window.T.edges(k); }, glass.id), worst = 0, thick = 0, thin = 1e9;
    Object.keys(e).forEach(function (layer) {
      var r = e[layer], how = '; alpha across the wall there, a pixel apart from 9 px inside: ';
      check(r.none.length === 0, layer + ': no inner edge or no outer edge found at ' + r.none.length + ' of ' + r.n + ' places (' + r.none.slice(0, 4).join('; ') + how + r.line + ')');
      check(Math.abs(r.worst) <= 1.5, layer + ': the inner edge is ' + f2(r.worst) + ' px off profile at ' + r.at + ' (at most 1.5' + how + r.line + ')');
      // (the classic glass keeps the wall it has always had, thinner down its funnel: render-regression holds its picture)
      if (id !== 'classic' || drawAs) check(Math.abs(r.thick) <= 1.5, layer + ': the wall is ' + f2(r.thick) + ' px off its thickness of ' + f2(b.wallPx) + ' px at ' + r.thickAt + ' (at most 1.5' + how + r.thickLine + ')');
      worst = Math.max(worst, Math.abs(r.worst)); thick = Math.max(thick, Math.abs(r.thick)); thin = Math.min(thin, r.thin);
    });
    notes.push('inner edge within ' + f2(worst) + ' px of profile on ' + Object.keys(e).join(' and ') + ' (80 places each)' +
      (id === 'classic' ? ', the wall ' + f2(thin) + ' of its thickness at its thinnest' : ', the wall within ' + f2(thick) + ' px of its ' + f2(b.wallPx) + ' px'));

    var t = await page.evaluate(function (k) { return window.T.turn(k); }, glass.id);
    Object.keys(t).forEach(function (layer) {
      ok(t[layer].lit > 10000, layer + ' is empty: this case could not tell');
      ok(t[layer].bad <= 100, layer + ', bare: ' + t[layer].bad + ' of ' + t[layer].lit + ' pixels differ from the half turn by more than 24 of 255 (the most: ' + Math.round(t[layer].max) + '; 100 pixels at most)');
    });

    var li = await page.evaluate(function () { return window.T.lights(); });
    ok(li.lit > 5000, 'c-light holds ' + li.lit + ' lit pixels: this case could not tell');
    check(li.out === 0, li.out + ' lit pixels of c-light lie off the glass');
    if (glass.is === 'drawn') {
      var per = [li.glint[0].n / (li.S * li.S), li.glint[1].n / (li.S * li.S)];
      if (id === 'classic' && !drawAs) classicGlint = per;
      ok(classicGlint, 'the classic glass was not looked at first');
      [0, 1].forEach(function (k) {
        var name = k ? 'lower' : 'upper';
        check(per[k] >= 0.85 * classicGlint[k], 'the window glint in the ' + name + ' bulb is ' + li.glint[k].n + ' px, ' + f2(per[k] / classicGlint[k]) + ' of the classic glass\'s: cut, or not there');
        check(li.glint[k].n === 0 || li.glint[k].margin >= 0, 'the window glint in the ' + name + ' bulb crosses the wall by ' + f2(-li.glint[k].margin) + ' cells');
      });
      notes.push('glint whole in both bulbs, ' + f2(Math.min(li.glint[0].margin, li.glint[1].margin)) + ' cells or more from the wall');
    }
    if (drawAs) return fails;           // (the control ends here: its frame is another glass's)
    if (SNAP) await page.screenshot({ path: path.join(SNAP, id + '-' + glass.id + '-bare.png') });

    // the frame: collars, half turn
    await page.evaluate(function () { window.T.frame(true); });
    var c = await page.evaluate(function (k) { return window.T.collar(k); }, glass.id), tight = 1e9;
    c.ends.forEach(function (end) {
      var name = end.bulb < 0 ? 'upper' : 'lower';
      ok(end.half > 20, 'no ' + name + ' collar found on c-front (' + end.half + ' px)');
      Object.keys(end.reach).forEach(function (layer) {
        check(end.reach[layer] <= end.half + 1, 'beside the ' + name + ' collar (' + end.half + ' px to a side) ' + layer + ' shows glass out to ' + end.reach[layer] + ' px: the collar does not cover the end');
        if (layer !== 'c-front') tight = Math.min(tight, end.half - end.reach[layer]);
      });
    });
    notes.push('collars ' + c.ends[0].half + ' px to a side cover the end (' + tight + ' px to spare)');
    var t2 = await page.evaluate(function (k) { return window.T.turn(k); }, glass.id);
    Object.keys(t2).forEach(function (layer) {
      ok(t2[layer].bad <= 100, layer + ', framed: ' + t2[layer].bad + ' of ' + t2[layer].lit + ' pixels differ from the half turn by more than 24 of 255 (the most: ' + Math.round(t2[layer].max) + '; 100 pixels at most)');
    });
    notes.push('both layers their own half turn, bare and framed (' + Math.max(t['c-back'].bad, t['c-front'].bad, t2['c-back'].bad, t2['c-front'].bad) + ' px at most differ by more than 24 of 255, of ' +
      Math.min(t['c-back'].lit, t['c-front'].lit) + ' or more)');
    if (SNAP) await page.screenshot({ path: path.join(SNAP, id + '-' + glass.id + '-frame.png') });

    // the sweep: nine moments of the old sand going, 39 of the new coming
    var sw = [], px = 0, k;
    for (k = 1; k <= 9; k++) sw.push(1 + k / 10);
    for (k = 1; k <= 39; k++) sw.push(2 + k / 40);
    var rs = await page.evaluate(function (list) { return list.map(function (p) { return window.T.sweep(p); }); }, sw);
    rs.forEach(function (r, i) {
      var p = sw[i], when = p < 2 ? 'the old sand going, ' + f2(p - 1) : 'the new sand coming, ' + f2(p - 2);
      ok(r.n > 300 || p > 1.85, when + ': only ' + r.n + ' pixels of sand');
      ok(r.out === 0, when + ': ' + r.out + ' of ' + r.n + ' pixels of sand lie outside the glass, by up to ' + f2(r.worst) + ' cells');
      // (the thread pours from p = 0.12 to 0.85; before and after, its first and last grains are on their way down)
      if (p >= 2.12 && p <= 2.85) ok(r.top >= b.topY && r.top <= b.topY + 3, when + ': the thread starts at row ' + r.top + ', the top of this glass is row ' + b.topY);
      px += r.n;
    });
    notes.push('the sweep at ' + sw.length + ' moments: no sand outside (' + px + ' px), the thread from the top');

    // cracks
    var cr = await page.evaluate(function () { return window.T.cracks(); });
    ok(cr.n > 20000, 'only ' + cr.n + ' crack points: this case could not tell');
    ok(cr.bad === 0, cr.bad + ' of ' + cr.n + ' crack points lie off the glass (' + cr.why + ')');
    // (on the classic glass a step is taken along the axis, as it always was: up to 6 cells where its dome closes)
    ok(id === 'classic' || cr.longest <= 1.75, 'a step of a crack is ' + f2(cr.longest) + ' cells long (a step is 1.1 along the glass: 1.75 at most as it is seen)');
    ok(cr.hoopOk >= 0.9 * cr.hoops, 'by the waist (u = 0.4 of the way to the widest) ' + cr.hoopOk + ' of ' + cr.hoops + ' cracks run round the glass');
    ok(cr.starOk === cr.stars, 'on the dome (half way from the widest to the end) ' + cr.starOk + ' of ' + cr.stars + ' cracks are stars of 3 to 5 arms');
    ok(cr.runOk >= 0.9 * cr.runs, 'between (u = 0.75 of the way to the widest) ' + cr.runOk + ' of ' + cr.runs + ' cracks run along the glass toward its widest');
    notes.push('cracks on the glass (' + cr.n + ' points, longest step ' + f2(cr.longest) + ' cells), hoops ' + cr.hoopOk + '/' + cr.hoops + ', stars ' + cr.starOk + '/' + cr.stars + ', runs ' + cr.runOk + '/' + cr.runs);

    ok(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
  } finally {
    await page.context().close();
  }
  return notes;
}

async function main() {
  var browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  var ids = IDS.filter(function (id) { return !ONLY || id === 'classic' || ONLY.indexOf(id) >= 0; });
  for (var g = 0; g < GLASSES.length; g++) {
    for (var i = 0; i < ids.length; i++) {
      var t0 = Date.now(), name = ids[i] + ', ' + GLASSES[g].id + ' glass';
      count++;
      try {
        var notes = await look(browser, ids[i], GLASSES[g]);
        console.log('PASS  ' + name + ': ' + notes.join('; ') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      } catch (e) {
        failures++;
        console.log('FAIL  ' + name + ': ' + (e && e.message ? e.message : e));
      }
    }
    // the control: the classic teardrop's layers round the sand of the widest and of the most pointed shape
    var ctl = ['delta', 'onion'].filter(function (id) { return ids.indexOf(id) >= 0; });
    for (i = 0; i < ctl.length; i++) {
      t0 = Date.now(); name = 'the suite can tell: ' + ctl[i] + '\'s sand in the classic teardrop\'s ' + GLASSES[g].id + ' glass';
      count++;
      try {
        var fails = await look(browser, ctl[i], GLASSES[g], 'classic');
        ok(fails.some(function (f) { return /inner edge/.test(f); }), 'the inner edge check passed on the wrong glass (failed: ' + (fails.join(' | ') || 'nothing') + ')');
        console.log('PASS  ' + name + ': ' + fails.length + ' checks fail, the first: ' + fails[0] + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      } catch (e2) {
        failures++;
        console.log('FAIL  ' + name + ': ' + (e2 && e2.message ? e2.message : e2));
      }
    }
  }
  await browser.close();
  console.log(failures ? 'render-shape: ' + failures + ' of ' + count + ' cases FAILED' : 'render-shape: all ' + count + ' cases passed');
  process.exit(failures ? 1 : 0);
}

main().catch(function (e) {
  console.log('FAIL  harness: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
