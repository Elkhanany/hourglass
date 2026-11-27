/*
 * other glasses, as they are drawn (Playwright Chromium). Every shape of
 * HourglassPhysics.SHAPES, the classic teardrop first as the reference, is
 * built as the app builds a glass (a Sim of that shape, a Renderer on the
 * app's canvases, laid out for a phone: 374 x 718 CSS px at DPR 3), run to
 * the middle of its time, and its layers are read back pixel by pixel.
 *
 * For every shape, with each kind of glass in GLASSES: the drawn 2-D glass
 * (c-back and c-front), and the WebGL glass (c-glass-back and
 * c-glass-front, rendered in software here: still pictures only):
 *
 *   sand        every pixel of sand on c-sand lies inside the shape's bore
 *               (profile), mid-run with the thread in the air; the sand's
 *               canvas sits on the middle of the glass, at the glass's scale
 *   the sweep   the same in the Reset sweep, at nine moments of the old sand
 *               going and 39 of the new coming, and the new sand's thread
 *               starts at the shape's own top (once, with the drawn glass:
 *               the sweep is the sand's own)
 *   the wall    on both glass layers (far wall and near wall) the inner
 *               surface of the glass follows profile within 1.5 device
 *               pixels, at 20 heights in each bulb, on both sides; and on
 *               every shape but the classic the wall is as thick there as
 *               geo.wall says, within 1.5 pixels (it does not thin away
 *               where a funnel flares or an end lies flat); the WebGL glass
 *               may be heavier by the waist, by its bead, never thinner
 *   half turn   both glass layers, with the frame and without, are the same
 *               picture turned by 180 degrees (a Flip puts the lattice back
 *               upright under layers that are not redrawn): at most 100 of
 *               a layer's pixels differ by more than 24 of 255 (up to 34 do
 *               on these nine glasses, on the smoothed edges of hairlines
 *               and of parts drawn turned). The WebGL glass is lit by a
 *               room that stays put, and is redrawn as it turns: there the
 *               glass drawn turned half round, and shown so, is the picture
 *               of the upright glass
 *   collar      with the frame, nothing of the glass shows beside a collar
 *               in the collar's own rows: it covers the end, both ends
 *   lights      what is drawn on c-light for the bare glass lies on the
 *               glass; with the drawn glass the window glint is whole and
 *               inside the bore in both bulbs (not in mid-air, not cut by
 *               the wall)
 *   cracks      (with the drawn glass: the paths are the same under either)
 *               a crack's path stays on the glass and off the waist; on every
 *               shape but the classic no step of it is longer than a step
 *               (a low, flat end makes steps taken along the axis jump); by
 *               the waist it is a hoop, on the dome a star, between them a
 *               run, where this shape has its waist and its dome
 *   no errors   nothing is thrown or logged as an error by the page
 *
 * and the suite can tell: the same checks on a glass drawn with the wrong
 * shape (the classic teardrop's layers around another shape's sand) fail.
 *
 * Then, of the WebGL glass alone (each said in full where it stands, below):
 * the classic glass is compiled from the shader text it always had, byte
 * for byte, and another glass from one of its own; that one reads its table
 * of half-widths at full precision; either layer's context, and both, can
 * be lost and restored and the picture comes back as it was; and a device
 * that will not take the table shader gets the drawn glass of the same
 * shape.
 *
 *   node tools/test/render-shape.test.js [--port n] [--only id[,id]]     exits 0 when every case passes
 *
 * The page and HourglassPhysics (the pieces joined, served as one script,
 * physics.js) are served from memory through Playwright's routing, at
 * http://localhost:<port>/; nothing listens on the port and no files are
 * written. The port defaults to $PORT or 8802 (a bare number as the
 * first argument is taken as the port too). HOURGLASS_PHYSICS=<file> draws
 * with that copy instead of the repository's pieces (to try a change).
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
 * is what it must then say it draws with. Each has its probes in PROBES (in
 * the page, below): which two layers hold its glass, how they are read back
 * and where their inner and outer surfaces are.
 */
var GLASSES = [
  { id: 'drawn', gl: false, is: 'drawn' },
  { id: 'webgl', gl: true, is: 'webgl' }
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
    // `drawAs`: the layers of another shape around this one's sand (the control;
    // the WebGL glass is then set up again as that other shape's)
    var ren = new P.Renderer(sim, els), real = sim.geo;
    if (cfg.drawAs) { sim.geo = P.makeGeometry(1.08, cfg.drawAs); if (cfg.gl) ren._initGlass(); }
    ren.setFrame(false); ren.setTheme('sahara'); ren.layout(374, 718, 3);
    sim.geo = real;
    ren.drawSand(); ren.drawSand(); ren.drawSand();
    T.ren = ren; T.sim = sim; T.n = n; T.drawAs = cfg.drawAs || null; T.gl = {};
    T.drawGlass(0);
    return { glass: ren.glass ? 'webgl' : 'drawn', total: sim.total, below: sim.total - sim.nTop, np: sim.np, S: ren.scale * ren.dpr,
             W: sim.W, H: sim.H, topY: sim.topY, equator: sim.geo.equator, R: sim.geo.R, HB: sim.geo.HB, wallPx: sim.geo.wall * ren.scale * ren.dpr };
  };
  T.frame = function (on) {
    var real = T.sim.geo;
    if (T.drawAs) T.sim.geo = P.makeGeometry(1.08, T.drawAs);
    T.ren.setFrame(on); T.ren.layout(374, 718, 3);
    T.sim.geo = real;
    T.gl = {};
    T.drawGlass(0);
  };
  /** The WebGL glass turned by `rot` against the room (nothing happens with the drawn glass). */
  T.drawGlass = function (rot) {
    var real = T.sim.geo;
    if (T.drawAs) T.sim.geo = P.makeGeometry(1.08, T.drawAs);
    T.ren.drawGlass(rot, true);
    T.sim.geo = real;
  };

  /**
   * A layer's pixels, top row first, and its pixels per cell across and down
   * (S). A 2-D layer is read as it lies. A WebGL layer keeps its picture
   * only until the page is next shown, so the glass is drawn again (turned
   * by `rot`) and read at once with gl.readPixels, bottom row first; its
   * canvas covers the same box as the 2-D layers with a few pixels fewer.
   * What was read is kept until the frame changes.
   */
  var GL_ID = { 'c-glass-back': 0, 'c-glass-front': 1 };
  function layer(id, rot) {
    var c = $(id), S = T.ren.scale * T.ren.dpr, back = $('c-back');
    if (GL_ID[id] === undefined) return { W: c.width, H: c.height, Sx: S, Sy: S, d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
    rot = rot || 0;
    if (!T.gl[rot]) {
      T.drawGlass(rot);
      T.gl[rot] = T.ren.glass.map(function (g) {
        var gl = g.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4), d = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (var y = 0; y < h; y++) d.set(px.subarray(4 * w * (h - 1 - y), 4 * w * (h - y)), 4 * w * y);
        return { W: w, H: h, Sx: S * w / back.width, Sy: S * h / back.height, d: d };
      });
      if (rot) T.drawGlass(0);
    }
    return T.gl[rot][GL_ID[id]];
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
   * 28 px outside it). Each probe answers [inner, outer]: where the inner and
   * the outer surface are, in pixels from the bore as profile has it, or null
   * for one it cannot find.
   *   drawn, far wall (c-back)    the reflection of the far wall is clipped
   *                               to the bore: alpha steps down there; the
   *                               body of the glass ends at the outer surface
   *   drawn, near wall (c-front)  a hairline is stroked along each surface:
   *                               the first crest of alpha on the way out,
   *                               and the highest after it
   *   WebGL, far wall             shaded inside the bore only: it ends at
   *                               the inner surface (where its alpha has
   *                               fallen to half of what it is just inside);
   *                               it has no outer surface (false)
   *   WebGL, near wall            the wall is solid glass, far more opaque
   *                               than the bore: the outer surface is where
   *                               the glass ends, the inner where alpha has
   *                               climbed, on the way out of the bore, to
   *                               nine tenths of what it is inside the wall
   *                               (the bore darkens softly toward the wall,
   *                               the more slowly the wider the glass: on
   *                               the widest that point lies a pixel inside)
   * `bead`: this glass is heavier at the waist than its wall says. `inner`:
   * the layer whose inner surface the wall's thickness is measured from (the
   * far wall's, which ends sharply there), where it is not the layer's own.
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
    },
    webgl: {
      layers: ['c-glass-back', 'c-glass-front'], bead: true, inner: 'c-glass-back',
      'c-glass-back': function (v) {
        var k, j, top = 0, half;
        for (k = v.length - 1; k >= 0 && v[k] < 3; k--) {}
        if (k < 12 || k === v.length - 1) return [null, false];           // (nothing there, or no end to it)
        for (j = k - 12; j <= k; j++) if (v[j] > top) top = v[j];
        if (top < 8) return [null, false];
        half = top / 2;
        for (j = k; j > k - 12 && v[j] < half; j--) {}
        return [(j + (v[j] - half) / (v[j] - v[j + 1]) - 36) / 4, false];
      },
      'c-glass-front': function (v, wallPx) {
        var k, j, end, mid, lev;
        for (k = v.length - 1; k >= 0 && v[k] < 8; k--) {}
        if (k < 0 || k === v.length - 1) return [null, null];
        end = (k + (v[k] - 8) / (v[k] - v[k + 1]) - 36) / 4;               // where the glass ends
        mid = Math.round(k - 2 * wallPx);                                  // the middle of the wall, if it is as thick as it should be
        if (mid < 1) return [null, end];
        lev = 0.9 * v[mid];                                                // (the wall is this opaque from its inner surface on)
        for (j = mid; j > 0 && v[j - 1] >= lev; j--) {}
        if (j === 0 || v[mid] < 100) return [null, end];                   // (no bore beside it, or no wall)
        return [(j - (v[j] - lev) / (v[j] - v[j - 1]) - 36) / 4, end];
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
    var g = T.sim.geo, pr = PROBES[kind], out = {}, crisp = {};
    pr.layers.forEach(function (id) {
      var im = layer(id), S = (im.Sx + im.Sy) / 2;
      var res = { n: 0, worst: 0, at: '', line: '', none: [], thick: 0, thickAt: '', thickLine: '', thin: 1e9, outer: 0, wallPx: g.wall * S, waist: [1e9, -1e9] };
      for (var k = 0; k < 20; k++) {
        var u = 0.05 + 0.9 * k / 19, r = P.profile(u, g), dr = P.profile(u + 0.002, g) - P.profile(u - 0.002, g), dy = 0.004 * g.HB;
        var len = Math.sqrt(dr * dr + dy * dy);
        for (var q = 0; q < 4; q++) {
          var b = q & 1 ? 1 : -1, sd = q & 2 ? 1 : -1, where = 'u ' + u.toFixed(2) + (b < 0 ? ', upper bulb' : ', lower bulb') + (sd < 0 ? ', left' : ', right');
          // the point on the bore, and the way straight out of the glass there
          var px = im.W / 2 + sd * r * im.Sx, py = im.H / 2 + b * u * g.HB * im.Sy, nx = sd * dy / len, ny = -b * dr / len, v = [];
          for (var j = -36; j <= 112; j++) v.push(alphaAt(im, px + nx * j / 4, py + ny * j / 4));
          var e = pr[id](v, g.wall * S), line = v.filter(function (a, i) { return i % 4 === 0; }).map(Math.round).join(' ');
          res.n++;
          if (e[0] === null || e[1] === null) { res.none.push(where + (e[0] === null ? '' : ' (outer)')); if (!res.noneLine) res.noneLine = line; continue; }
          if (Math.abs(e[0]) > Math.abs(res.worst)) { res.worst = e[0]; res.at = where; res.line = line; }
          if (e[1] === false) { crisp[k * 4 + q] = e[0]; continue; }       // (a layer without an outer surface)
          res.outer++;
          // (the wall is measured from the far wall's layer where the glass has one: the inner surface is sharp there)
          var e0 = pr.inner ? crisp[k * 4 + q] : e[0];
          if (e0 === undefined) continue;
          var th = e[1] - e0 - g.wall * S;
          // (by the waist a glass with a bead is the thicker for it)
          if (pr.bead && u < 0.15) {
            if (th < res.waist[0]) { res.waist[0] = th; res.waistAt = where; res.waistLine = line; }
            if (th > res.waist[1]) res.waist[1] = th;
            continue;
          }
          if (Math.abs(th) > Math.abs(res.thick)) { res.thick = th; res.thickAt = where; res.thickLine = line; }
          if ((e[1] - e0) / (g.wall * S) < res.thin) res.thin = (e[1] - e0) / (g.wall * S);
        }
      }
      out[id] = res;
    });
    return out;
  };

  /**
   * Each glass layer against itself turned by 180 degrees: the largest
   * difference of a channel, and pixels that differ by more than 24. A
   * WebGL layer is lit by a room that stays where it is, so it is not its
   * own half turn; what a Flip needs of it is that the glass turned half
   * round (as it is drawn at the end of a Flip, and shown turned by the
   * page) is the picture of the upright glass that replaces it.
   */
  T.turn = function (kind) {
    var out = {};
    PROBES[kind].layers.forEach(function (id) {
      var im = layer(id), d = im.d, N = im.W * im.H, max = 0, bad = 0, lit = 0, i, j, c, e, gl = GL_ID[id] !== undefined;
      var o = gl ? layer(id, Math.PI).d : d;
      for (i = 0; i < (gl ? N : N >> 1); i++) {
        j = N - 1 - i;
        if (d[4 * i + 3] || o[4 * j + 3]) lit++;
        // (alpha, and colour as much as there is of it; a WebGL layer's colours come multiplied by it already)
        e = Math.abs(d[4 * i + 3] - o[4 * j + 3]);
        for (c = 0; c < 3; c++) e = Math.max(e, gl ? Math.abs(d[4 * i + c] - o[4 * j + c]) : Math.abs(d[4 * i + c] * d[4 * i + 3] - o[4 * j + c] * o[4 * j + 3]) / 255);
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
      var end = { bulb: b, half: half, reach: {} };
      for (id in ims) {
        // (under the lower collar c-light also holds the pool of light on the base, as it always has: not the glass)
        if (id === 'c-light' && b > 0) continue;
        // (each layer by its own pixels: a WebGL layer has a few fewer; the reach is then told in c-front's)
        var im = ims[id], reach = 0, lim = Math.floor((g.postX - 3.2 * q) * im.Sx), mx = im.W / 2;
        var ya = Math.ceil(im.H / 2 + b * (b < 0 ? y1 : y0) * im.Sy + 1.5), yb = Math.floor(im.H / 2 + b * (b < 0 ? y0 : y1) * im.Sy - 1.5);
        for (y = ya; y <= yb; y++) {
          for (x = lim; x > reach; x--) {
            if (im.d[4 * (y * im.W + Math.floor(mx + x)) + 3] || im.d[4 * (y * im.W + Math.floor(mx - x - 1)) + 3]) { reach = x; break; }
          }
        }
        end.reach[id] = Math.ceil(reach * S / im.Sx);
      }
      out.ends.push(end);
    }
    return out;
  };

  /**
   * c-light on the bare glass: lit pixels, and those that lie off the glass
   * (where the glass's own body has nothing: c-back with the drawn glass,
   * the near wall's layer, within a pixel, with WebGL); and the window glint
   * in each bulb, which is the only bright white right of the axis: its
   * pixels, and the least distance of one from the bore's wall (cells;
   * negative: it is cut).
   */
  T.lights = function (kind) {
    var ren = T.ren, g = T.sim.geo, S = ren.scale * ren.dpr, im = layer('c-light'), d = im.d, body = layer('c-back').d;
    var near = kind === 'webgl' ? layer('c-glass-front') : null, kx = near ? near.W / im.W : 1, ky = near ? near.H / im.H : 1;
    function off(x, y) {
      if (!near) return !body[4 * (y * im.W + x) + 3];
      var X = (x + 0.5) * kx, Y = (y + 0.5) * ky;
      return !(alphaAt(near, X, Y) || alphaAt(near, X - 1, Y) || alphaAt(near, X + 1, Y) || alphaAt(near, X, Y - 1) || alphaAt(near, X, Y + 1));
    }
    var lit = 0, out = 0, faint = 0, glint = [{ n: 0, margin: 1e9 }, { n: 0, margin: 1e9 }], x, y, i, cxp = im.W / 2, cyp = im.H / 2;
    for (y = 0; y < im.H; y++) {
      var yc = (y + 0.5 - cyp) / S, ri = P.profile(Math.abs(yc) / g.HB, g);
      for (x = 0; x < im.W; x++) {
        i = 4 * (y * im.W + x);
        if (d[i + 3] < 3) continue;                                        // (under 1 %: the last of an edge's smoothing)
        lit++;
        if (off(x, y)) { out++; if (d[i + 3] > faint) faint = d[i + 3]; }
        var xc = (x + 0.5 - cxp) / S;
        if (xc > 0 && d[i + 3] >= 40 && d[i] >= 200 && d[i + 1] >= 200 && d[i + 2] >= 200) {       // (white, or white in the caustic's glow)
          var gb = glint[yc < 0 ? 0 : 1];
          gb.n++;
          if (ri - xc < gb.margin) gb.margin = ri - xc;
        }
      }
    }
    return { lit: lit, out: out, faint: faint, glint: glint, S: S };
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

  /** The shader texts a Renderer of this shape hands to WebGL (recorded by the hook, below), and the glass it then has. */
  T.sources = function (shape) {
    var sim = new P.Sim({ scale: 1.08, seed: 7, shape: shape });
    window.GLSL.length = 0;
    var ren = new P.Renderer(sim, { back: $('c-back'), sand: $('c-sand'), bloom: $('c-bloom'), front: $('c-front'), light: $('c-light'),
                                    glBack: $('c-glass-back'), glFront: $('c-glass-front') });
    return { glass: ren.glass ? 'webgl' : 'drawn', src: window.GLSL.slice() };
  };

  /**
   * What the GLSL compiler makes of a fragment shader: whether it takes it,
   * and how many of its values it allows less than full precision (ANGLE
   * hands out its SPIR-V, where each such value is marked RelaxedPrecision;
   * -1 where the browser gives no SPIR-V).
   */
  T.relaxed = function (src) {
    var gl = document.createElement('canvas').getContext('webgl'), dbg = gl.getExtension('WEBGL_debug_shaders');
    var sh = gl.createShader(gl.FRAGMENT_SHADER), hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    var out = { ok: gl.getShaderParameter(sh, gl.COMPILE_STATUS), log: gl.getShaderInfoLog(sh), n: -1, highp: hp.precision };
    var w = ((dbg ? dbg.getTranslatedShaderSource(sh) : '').match(/0x[0-9A-Fa-f]{8}/g) || []).map(function (h) { return parseInt(h, 16); });
    if (w[0] !== 0x07230203) return out;
    out.n = 0;
    for (var i = 5; i < w.length && (w[i] >>> 16); i += w[i] >>> 16) if ((w[i] & 0xFFFF) === 71 && w[i + 2] === 0) out.n++;     // OpDecorate <id> RelaxedPrecision
    return out;
  };

  /** Both WebGL layers as they are now: a hash of each. */
  function fnv(b) { var h = 0x811c9dc5; for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  T.hashes = function () {
    T.gl = {};
    return ['c-glass-back', 'c-glass-front'].map(function (id) { var im = layer(id), lit = 0; for (var i = 3; i < im.d.length; i += 4) if (im.d[i]) lit++; return { hash: fnv(im.d), lit: lit }; });
  };
  /**
   * Take the WebGL context of the layers `which` (0 the far wall, 1 the near
   * wall) away (`back` false), or give it back, as a phone does to a page
   * in the background; resolves once the page has been told. Answers what
   * the Renderer then has: its kind of glass, each layer's `lost`, and
   * whether the WebGL canvases are shown.
   */
  T.context = function (which, back) {
    var gs = T.ren.glass;
    T.ext = T.ext || gs.map(function (g) { return g.gl.getExtension('WEBGL_lose_context'); });
    return Promise.all(which.map(function (k) {
      return new Promise(function (done) {
        var name = back ? 'webglcontextrestored' : 'webglcontextlost', c = gs[k].canvas;
        c.addEventListener(name, function f() { c.removeEventListener(name, f); done(); });
        if (back) T.ext[k].restoreContext(); else T.ext[k].loseContext();
      });
    })).then(function () {
      T.ren.drawGlass(0.5, true); T.ren.drawGlass(0, true);            // (a frame goes by: nothing may throw)
      return T.state();
    });
  };
  /**
   * The light look's rendered glass, read back from WebGL and laid over the page in numbers (each
   * layer premultiplied, as the browser lays it): an empty bulb (near wall over far wall over the
   * paper #f3f0ea) and a flat patch of a sand's colour behind the near wall (`sand`: its h, s, l).
   *   clear   inside the bore, away from its wall (|x| under 0.55 of the bore's half-width) and in
   *           the bulbs' bodies (0.25 to 0.85 of a bulb's height): the median CIELAB distance to
   *           the paper and the mean luminance against it, highlights (pixels brighter than the
   *           paper by 2 %) left out and counted
   *   sand    the patch there: its L* and its chroma against the patch's own; `edge`, the 95th
   *           percentile of its L* against its own between there and 1.5 cells from the wall
   *   rim     along the bore's outline, a point every cell all round (the waist, where the two
   *           walls meet, left out), the darkest pixel out along the normal from 1.5 cells inside
   *           to the wall's width and 3 cells past it: how much darker than the paper it is (the
   *           worst, and the median)
   */
  T.paper = function (cfg) {
    var sim = new P.Sim({ scale: 1.08, seed: 4242, shape: cfg.shape });
    sim.reset(Math.round(sim.capacity * 0.3));
    var ren = new P.Renderer(sim, { back: $('c-back'), sand: $('c-sand'), bloom: $('c-bloom'), front: $('c-front'), light: $('c-light'),
                                    glBack: $('c-glass-back'), glFront: $('c-glass-front') });
    ren.setFrame(false); ren.setTheme(cfg.theme || 'sahara'); ren.layout(374, 718, 3);
    ren.setPaper(true);
    if (!ren.glass) return { glass: 'drawn' };
    ren.drawGlass(0, true);
    var im = ren.glass.map(function (g) {
      var gl = g.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w: w, h: h, d: px };                                     // bottom row first
    });
    var B = im[0], F = im[1], w = F.w, h = F.h, box = ren._box(), geo = sim.geo, HB = geo.HB;
    function lin(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
    function lab(c) {
      var r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
      var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
      var X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
    }
    function hsl(hh, s, l) {
      var a = s * Math.min(l, 1 - l), k = function (n) { var m = (n + hh / 30) % 12; return l - a * Math.max(-1, Math.min(m - 3, 9 - m, 1)); };
      return [k(0), k(8), k(4)];
    }
    var page = [0xf3 / 255, 0xf0 / 255, 0xea / 255], pl = lab(page), pageLum = lum(page);
    var sand = hsl(cfg.sand[0], cfg.sand[1], cfg.sand[2]), sl = lab(sand), sc = Math.hypot(sl[1], sl[2]);
    function at(L, i, j) { var o = 4 * ((L.h - 1 - j) * L.w + i); return [L.d[o] / 255, L.d[o + 1] / 255, L.d[o + 2] / 255, L.d[o + 3] / 255]; }
    function over(t, u) { return [t[0] + (1 - t[3]) * u[0], t[1] + (1 - t[3]) * u[1], t[2] + (1 - t[3]) * u[2]]; }
    function empty(i, j) { return over(at(F, i, j), over(at(B, i, j), page)); }
    function q(a, p) { var b = a.slice().sort(function (x, y) { return x - y; }); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; }
    function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
    var de = [], lu = [], hi = 0, sL = [], sC = [], eL = [], i, j, k;
    for (j = 0; j < h; j++) {
      var y = (j + 0.5) / h * box.h - box.h / 2, u = Math.abs(y) / HB;
      if (u < 0.25 || u > 0.85) continue;
      var r = P.profile(u, geo);
      for (i = 0; i < w; i++) {
        var x = Math.abs((i + 0.5) / w * box.w - box.w / 2);
        if (x >= r - 1.5) continue;
        var s = lab(over(at(F, i, j), sand));
        if (x > 0.55 * r) { eL.push(s[0] / sl[0]); continue; }
        var c = empty(i, j), lc = lum(c), cl = lab(c);
        if (lc > pageLum * 1.02) { hi++; continue; }
        de.push(Math.hypot(cl[0] - pl[0], cl[1] - pl[1], cl[2] - pl[2])); lu.push(lc / pageLum);
        sL.push(s[0] / sl[0]); sC.push(Math.hypot(s[1], s[2]) / sc);
      }
    }
    // the outline, a point about every cell
    var pts = [], prev = null, run = 0, K = 4000;
    for (k = 0; k <= K; k++) {
      var yy = -HB + 2 * HB * k / K, cur = [P.profile(Math.min(Math.abs(yy) / HB, 1), geo), yy];
      if (prev) run += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      if (!prev || run >= 1) { pts.push(cur); run = 0; }
      prev = cur;
    }
    var dark = [], worst = { d: 9 };
    for (var side = -1; side <= 1; side += 2) {
      for (k = 1; k < pts.length - 1; k++) {
        if (Math.abs(pts[k][1]) / HB < 0.06) continue;
        var tx = pts[k + 1][0] - pts[k - 1][0], ty = pts[k + 1][1] - pts[k - 1][1], tl = Math.hypot(tx, ty), nx = ty / tl, ny = -tx / tl, lo = 9;
        if (nx < 0) { nx = -nx; ny = -ny; }
        for (var t = -1.5; t <= geo.wall + 3; t += 0.25) {
          var pi = Math.round(((side * (pts[k][0] + nx * t)) / box.w + 0.5) * w - 0.5), pj = Math.round(((pts[k][1] + ny * t) / box.h + 0.5) * h - 0.5);
          if (pi >= 0 && pj >= 0 && pi < w && pj < h) lo = Math.min(lo, lum(empty(pi, pj)));
        }
        var d = 1 - lo / pageLum;
        dark.push(d);
        if (d < worst.d) worst = { d: d, side: side, y: Math.round(pts[k][1]) };
      }
    }
    var r2 = function (v) { return Math.round(v * 1000) / 1000; };
    return { glass: 'webgl', paper: ren.paper,
      clear: { n: de.length, de: r2(q(de, 0.5)), lum: r2(mean(lu)), highlights: hi },
      sand: { L: r2(mean(sL)), C: r2(mean(sC)), edge: r2(q(eL, 0.95)) },
      rim: { n: dark.length, worst: r2(worst.d), at: worst.side < 0 ? 'left' : 'right', y: worst.y, median: r2(q(dark, 0.5)) } };
  };
  T.state = function () {
    return { glass: T.ren.glass ? 'webgl' : 'drawn', lost:T.ren.glass ? T.ren.glass.map(function (g) { return g.lost; }) : null,
             shown: [$('c-glass-back').style.display !== 'none', $('c-glass-front').style.display !== 'none'] };
  };

  window.ready = true;
}

/*
 * Before any script of the page: every shader text handed to WebGL is kept
 * (window.GLSL), and one that matches window.BREAK is handed on with a
 * brace too many, as a device that will not take that shader.
 */
function hook() {
  window.GLSL = []; window.BREAK = null;
  var ss = WebGLRenderingContext.prototype.shaderSource;
  WebGLRenderingContext.prototype.shaderSource = function (sh, src) {
    window.GLSL.push(src);
    return ss.call(this, sh, window.BREAK && window.BREAK.test(src) ? src + '\n}' : src);
  };
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

/** A page with HourglassPhysics (`src`: another copy of it) and the checks of pageCode. */
function open(browser, src) {
  var page;
  return browser.newContext({ viewport: { width: 400, height: 760 } }).then(function (ctx) {
    return ctx.newPage();
  }).then(function (pg) {
    page = pg;
    page.errors = [];
    page.on('pageerror', function (e) { page.errors.push('pageerror: ' + e.message); });
    page.on('console', function (m) { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
    return page.addInitScript(hook);
  }).then(function () {
    return page.route(ORIGIN + '**', function (route) {
      var u = route.request().url().slice(ORIGIN.length).split('?')[0];
      if (u === 'physics.js') return route.fulfill({ status: 200, body: src || SRC, contentType: 'text/javascript; charset=utf-8' });
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
    var e = await page.evaluate(function (k) { return window.T.edges(k); }, glass.id), worst = 0, thick = 0, thin = 1e9, wallPx = 0;
    Object.keys(e).forEach(function (layer) {
      var r = e[layer], how = '; alpha across the wall there, a pixel apart from 9 px inside: ';
      check(r.none.length === 0, layer + ': no inner edge or no outer edge found at ' + r.none.length + ' of ' + r.n + ' places (' + r.none.slice(0, 4).join('; ') + how + r.noneLine + ')');
      check(Math.abs(r.worst) <= 1.5, layer + ': the inner edge is ' + f2(r.worst) + ' px off profile at ' + r.at + ' (at most 1.5' + how + r.line + ')');
      worst = Math.max(worst, Math.abs(r.worst));
      if (!r.outer) return;             // (the WebGL glass's far wall is shaded inside the bore only)
      // (the classic glass keeps the wall it has always had, thinner down its funnel: render-regression holds its picture)
      if (id !== 'classic' || drawAs) {
        check(Math.abs(r.thick) <= 1.5, layer + ': the wall is ' + f2(r.thick) + ' px off its thickness of ' + f2(r.wallPx) + ' px at ' + r.thickAt + ' (at most 1.5' + how + r.thickLine + ')');
        // (the WebGL glass is heavier at the waist, as the teardrop is: by up to 1.15 of the wall, never thinner than it)
        if (r.waist[1] > -1e9) check(r.waist[0] >= -1.5 && r.waist[1] <= 1.15 * r.wallPx + 1.5, layer + ': by the waist the wall is ' + f2(r.waist[0]) + ' to ' + f2(r.waist[1]) + ' px off its thickness of ' + f2(r.wallPx) +
          ' px (the bead: 0 to ' + f2(1.15 * r.wallPx) + ', within 1.5; at its thinnest at ' + r.waistAt + how + r.waistLine + ')');
      }
      thick = Math.max(thick, Math.abs(r.thick)); thin = Math.min(thin, r.thin); wallPx = r.wallPx;
    });
    notes.push('inner edge within ' + f2(worst) + ' px of profile on ' + Object.keys(e).join(' and ') + ' (80 places each)' +
      (id === 'classic' ? ', the wall ' + f2(thin) + ' of its thickness at its thinnest' : ', the wall within ' + f2(thick) + ' px of its ' + f2(wallPx) + ' px'));

    var t = await page.evaluate(function (k) { return window.T.turn(k); }, glass.id);
    Object.keys(t).forEach(function (layer) {
      ok(t[layer].lit > 10000, layer + ' is empty: this case could not tell');
      ok(t[layer].bad <= 100, layer + ', bare: ' + t[layer].bad + ' of ' + t[layer].lit + ' pixels differ from the half turn by more than 24 of 255 (the most: ' + Math.round(t[layer].max) + '; 100 pixels at most)');
    });

    var li = await page.evaluate(function (k) { return window.T.lights(k); }, glass.id);
    ok(li.lit > 5000, 'c-light holds ' + li.lit + ' lit pixels: this case could not tell');
    // (The classic's caustic is cut to the drawn outline, which has always ended a few pixels below the tip of
    // its WebGL glass: the last of the caustic's glow lies there, at 3 of 255. render-regression holds that picture.)
    if (id === 'classic' && glass.is === 'webgl' && !drawAs) ok(li.out <= 3 && li.faint <= 3, li.out + ' lit pixels of c-light lie off the classic WebGL glass, the brightest ' + li.faint + ' of 255 (it has always been 1 pixel of 3)');
    else check(li.out === 0, li.out + ' lit pixels of c-light lie off the glass');
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
    var two = Object.keys(t), bad = two.map(function (l) { return Math.max(t[l].bad, t2[l].bad); });
    notes.push((glass.is === 'webgl' ? 'both layers, drawn turned half round, are the upright glass turned' : 'both layers their own half turn') + ', bare and framed (' + Math.max(bad[0], bad[1]) +
      ' px at most differ by more than 24 of 255, of ' + Math.min(t[two[0]].lit, t[two[1]].lit) + ' or more)');
    if (SNAP) await page.screenshot({ path: path.join(SNAP, id + '-' + glass.id + '-frame.png') });
    // (the sweep and the cracks are the sand's and the paths' own: the same whichever glass is round them)
    if (glass.is !== 'drawn') { ok(!page.errors.length, 'page errors: ' + page.errors.join(' | ')); return notes; }

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

/* ---- the WebGL glass's own cases ---------------------------------------------- */

/** The checks of the bare drawn glass's wall (as look makes them), on the page as it is. */
async function drawnWall(page, what, id) {
  var e = await page.evaluate(function () { return window.T.edges('drawn'); }), worst = 0;
  Object.keys(e).forEach(function (layer) {
    var r = e[layer];
    ok(r.none.length === 0, what + ': ' + layer + ': no inner edge or no outer edge found at ' + r.none.length + ' of ' + r.n + ' places (' + r.none.slice(0, 4).join('; ') + ')');
    ok(Math.abs(r.worst) <= 1.5, what + ': ' + layer + ': the inner edge is ' + f2(r.worst) + ' px off profile at ' + r.at);
    if (id !== 'classic') ok(Math.abs(r.thick) <= 1.5, what + ': ' + layer + ': the wall is ' + f2(r.thick) + ' px off its thickness at ' + r.thickAt);
    worst = Math.max(worst, Math.abs(r.worst));
  });
  return worst;
}

var EXTRA = [];

/*
 * The classic glass is rendered by the very shader text it has always had:
 * what its Renderer hands to WebGL is, byte for byte, what f446085's did.
 * Another glass gets another fragment shader (one that reads a table).
 */
EXTRA.push({ name: 'the classic WebGL glass is compiled from the text it always was', shapes: ['delta'], run: async function (browser, shape) {
  var old = await open(browser, process.env.HOURGLASS_BASELINE ? fs.readFileSync(process.env.HOURGLASS_BASELINE, 'utf8') : L.gitShow(L.BASELINE_REV, 'physics.js'));
  var now = await open(browser), other = await open(browser);
  try {
    var a = await old.evaluate(function () { return window.T.sources(); }), b = await now.evaluate(function () { return window.T.sources(); });
    var c = await other.evaluate(function (id) { return window.T.sources(id); }, shape);
    ok(a.glass === 'webgl' && b.glass === 'webgl' && c.glass === 'webgl', 'no WebGL glass (then: ' + a.glass + ', now: ' + b.glass + ', ' + shape + ': ' + c.glass + '): this case could not tell');
    ok(a.src.length === 4 && b.src.length === 4 && c.src.length === 4, 'shader texts handed to WebGL: ' + a.src.length + ' then, ' + b.src.length + ' now, ' + c.src.length + ' for ' + shape + ' (a vertex and a fragment shader for each of two layers: 4)');
    for (var i = 0; i < 4; i++) {
      var at = 0;
      while (at < a.src[i].length && a.src[i][at] === b.src[i][at]) at++;
      ok(a.src[i] === b.src[i], 'shader text ' + i + ' of the classic glass differs from ' + L.BASELINE_REV + '\'s at character ' + at + ': ' + JSON.stringify(b.src[i].slice(Math.max(0, at - 30), at + 30)) + ', it was ' + JSON.stringify(a.src[i].slice(Math.max(0, at - 30), at + 30)));
    }
    ok(c.src[0] === b.src[0] && c.src[1] !== b.src[1] && c.src[3] === c.src[1], shape + ' is not rendered by a fragment shader of its own, the same in both layers');
    ok(/sampler2D/.test(c.src[1]) && !/sampler2D/.test(b.src[1]), shape + '\'s fragment shader reads no table, or the classic one does');
    ok(!old.errors.length && !now.errors.length && !other.errors.length, 'page errors: ' + old.errors.concat(now.errors, other.errors).join(' | '));
    return ['the classic glass\'s vertex and fragment shader (' + b.src[0].length + ' and ' + b.src[1].length + ' characters) are ' + L.BASELINE_REV + '\'s to the byte; ' + shape + '\'s fragment shader is its own (' + c.src[1].length + ' characters, reads a table)'];
  } finally {
    await old.context().close(); await now.context().close(); await other.context().close();
  }
} });

/*
 * A phone gives a shader's numbers no more bits than the shader asks for,
 * and a table of 16-bit half-widths needs more than the 10 a mediump float
 * must have. The table shader may therefore leave no more of its values at
 * less than full precision than the classic shader does (those are none of
 * the table's: the picture's colour on its way out). ANGLE's own compiler
 * says which they are. The suite can tell: the same shader with its
 * sampler left at the default precision has more.
 */
EXTRA.push({ name: 'the table shader reads its table at full precision', shapes: ['delta'], run: async function (browser, shape) {
  var page = await open(browser);
  try {
    var b = await page.evaluate(function () { return window.T.sources(); }), c = await page.evaluate(function (id) { return window.T.sources(id); }, shape);
    var fs1 = c.src[1], weak = fs1.replace('uniform highp sampler2D', 'uniform sampler2D');
    ok(c.glass === 'webgl' && /sampler2D/.test(fs1), 'no table shader for ' + shape + ': this case could not tell');
    ok(/^precision highp float;/.test(fs1), 'the table shader does not begin by asking for highp floats');
    ok(/uniform highp sampler2D/.test(fs1) && weak !== fs1, 'the table shader does not ask for a highp sampler');
    var r = await page.evaluate(function (list) { return list.map(function (s) { return window.T.relaxed(s); }); }, [b.src[1], fs1, weak, fs1.replace('precision highp float;', '')]);
    ok(r[0].ok && r[1].ok && r[2].ok, 'a shader was not taken: ' + [r[0].log, r[1].log, r[2].log].join(' | '));
    ok(!r[3].ok && /No precision specified/.test(r[3].log), 'without its first line the table shader is still taken (' + r[3].log + '): some float in it has a precision of its own');
    ok(r[1].highp >= 16, 'this browser\'s highp float has ' + r[1].highp + ' bits: the table needs 16');
    ok(r[0].n >= 0 && r[1].n >= 0 && r[2].n >= 0, 'this browser hands out no SPIR-V for a shader: this case could not tell');
    ok(r[2].n > r[1].n, 'with the sampler left at its default precision the compiler marks ' + r[2].n + ' values RelaxedPrecision, with a highp sampler ' + r[1].n + ': this case could not tell');
    ok(r[1].n === r[0].n, 'the compiler allows ' + r[1].n + ' values of the table shader less than full precision, ' + r[0].n + ' of the classic shader: ' + (r[1].n - r[0].n) + ' of the table\'s own');
    ok(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
    return ['highp floats throughout (the compiler refuses the shader without that line) and a highp sampler; the compiler allows ' + r[1].n + ' values less than full precision, as in the classic shader (' + r[0].n +
      '), none of them the table\'s; with the sampler at its default it would be ' + r[2].n];
  } finally {
    await page.context().close();
  }
} });

/*
 * A phone takes a page's WebGL contexts away in the background and gives
 * them back later, empty. Either layer's context, then both, are lost and
 * restored (WEBGL_lose_context) while the glass is shown: while lost the
 * layer is marked so and drawing does nothing; once back, both layers hold
 * exactly the picture they held before (the table is there again).
 */
EXTRA.push({ name: 'the WebGL glass comes back after its contexts were lost', shapes: ['classic', 'delta', 'gourd'], run: async function (browser, shape) {
  var page = await open(browser), notes = [];
  try {
    var b = await page.evaluate(function (c) { return window.T.build(c); }, { shape: shape, gl: true, drawAs: null });
    ok(b.glass === 'webgl', 'the glass is ' + b.glass + ': this case could not tell');
    var before = await page.evaluate(function () { return window.T.hashes(); });
    ok(before[0].lit > 100000 && before[1].lit > 100000, 'the layers are empty before anything is lost (' + before[0].lit + ' and ' + before[1].lit + ' lit pixels): this case could not tell');
    var rounds = [[0], [1], [0, 1]];
    for (var i = 0; i < rounds.length; i++) {
      var which = rounds[i], what = which.length > 1 ? 'both contexts' : (which[0] ? 'the near wall\'s context' : 'the far wall\'s context');
      var st = await page.evaluate(function (w) { return window.T.context(w, false); }, which);
      ok(st.glass === 'webgl' && [0, 1].every(function (k) { return st.lost[k] === (which.indexOf(k) >= 0); }), what + ' lost: the Renderer has the ' + st.glass + ' glass, lost: ' + JSON.stringify(st.lost));
      var gone = await page.evaluate(function () { return window.T.hashes(); });
      which.forEach(function (k) { ok(gone[k].lit === 0, what + ' lost: its layer still reads ' + gone[k].lit + ' lit pixels: the context was not lost, this case could not tell'); });
      st = await page.evaluate(function (w) { return window.T.context(w, true); }, which);
      ok(st.glass === 'webgl' && !st.lost[0] && !st.lost[1] && st.shown[0] && st.shown[1], what + ' restored: the Renderer has the ' + st.glass + ' glass, lost: ' + JSON.stringify(st.lost) + ', shown: ' + JSON.stringify(st.shown));
      var after = await page.evaluate(function () { return window.T.hashes(); });
      [0, 1].forEach(function (k) {
        ok(after[k].hash === before[k].hash, what + ' restored: the ' + (k ? 'near' : 'far') + ' wall\'s layer is not the picture it was (' + after[k].lit + ' lit pixels, ' + before[k].lit + ' before)');
      });
    }
    ok(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
    notes.push('the far wall\'s context, the near wall\'s, then both lost and restored: each time both layers are the picture they were (' + before[0].lit + ' and ' + before[1].lit + ' lit pixels)');
    return notes;
  } finally {
    await page.context().close();
  }
} });

/*
 * A device that will not take the table shader (here: it is handed on with
 * a brace too many) gets the drawn glass of the same shape, never a
 * teardrop round other sand: when the Renderer is made, and when a context
 * comes back from being lost and its shader can no longer be built. The
 * classic glass is not touched by the first (its shader is another), and
 * falls back the same way in the second.
 */
EXTRA.push({ name: 'a device that refuses the shader gets the drawn glass of the same shape', shapes: ['delta', 'onion', 'classic'], run: async function (browser, shape) {
  var notes = [], page = await open(browser), st, w;
  try {
    // (1) refused from the start
    await page.evaluate(function () { window.BREAK = /uProf/; });
    var b = await page.evaluate(function (c) { return window.T.build(c); }, { shape: shape, gl: true, drawAs: null });
    st = await page.evaluate(function () { return window.T.state(); });
    if (shape === 'classic') {
      ok(b.glass === 'webgl' && st.shown[0] && st.shown[1], 'the classic glass is ' + b.glass + ' when only the table shader is refused');
      notes.push('the table shader refused: the classic glass is rendered all the same');
    } else {
      ok(b.glass === 'drawn' && !st.shown[0] && !st.shown[1], 'the table shader refused: the Renderer has the ' + b.glass + ' glass, WebGL canvases shown: ' + JSON.stringify(st.shown));
      w = await drawnWall(page, 'the table shader refused', shape);
      notes.push('the table shader refused: the drawn glass, its inner edge within ' + f2(w) + ' px of this shape\'s profile, the WebGL canvases hidden');
    }
    ok(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
  } finally {
    await page.context().close();
  }
  // (2) refused when a context comes back
  page = await open(browser);
  try {
    var b2 = await page.evaluate(function (c) { return window.T.build(c); }, { shape: shape, gl: true, drawAs: null });
    ok(b2.glass === 'webgl', 'the glass is ' + b2.glass + ': this case could not tell');
    st = await page.evaluate(function () { return window.T.context([1], false); });
    ok(st.glass === 'webgl' && st.lost[1], 'the near wall\'s context was not lost: this case could not tell');
    await page.evaluate(function () { window.BREAK = /gl_FragColor/; });
    st = await page.evaluate(function () { return window.T.context([1], true); });
    ok(st.glass === 'drawn' && !st.shown[0] && !st.shown[1], 'a context came back unable to build its shader: the Renderer has the ' + st.glass + ' glass, WebGL canvases shown: ' + JSON.stringify(st.shown));
    w = await drawnWall(page, 'a context came back unable to build its shader', shape);
    ok(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
    notes.push('a context that comes back and cannot build its shader: the drawn glass from then on, its inner edge within ' + f2(w) + ' px of this shape\'s profile');
    return notes;
  } finally {
    await page.context().close();
  }
} });

/*
 * On white the rendered glass is clear (the light look's glass made clear): read back from
 * WebGL and laid over the paper in numbers (T.paper), with Sahara's colour as the sand,
 *   - an empty bulb is the paper seen through glass: within 2.0 (CIELAB) of #f3f0ea at the
 *     median and 0.95 of its luminance or more, away from the wall and the highlights;
 *   - a flat patch of the sand behind the near wall keeps its colour: 0.93 of its chroma or more,
 *     its L* within 3 %, and toward the wall no film whitens it (the 95th percentile of its L*
 *     there 1.04 of its own at most);
 *   - the rim is darker than the paper all round the outline (the darkest point out along each
 *     normal 0.40 under the paper's luminance at the palest point, 0.84 at the median);
 *   - the room's highlights are still there (20 pixels or more brighter than the paper in the
 *     clear bulb).
 * The control is the same glass with the film put back as it was before (the alpha lifted to the
 * sheen under the steep exposure, the grey veil over the bore): it must fail in this shape.
 */
var PAPER_SAND = [36, 0.62, 0.61];      // Sahara's colour (sand/sands.js), the sand the app comes with
function filmBack(src) {
  var lift = "'  a = clamp(max(a, max(col.r, max(col.g, col.b))), 0.0, 1.0);',";
  var swaps = [
    ["{ dark: [], paper: ['    tr = absorb * (1.0 - F);', '    a = 1.0 - (tr.r + tr.g + tr.b) / 3.0;', '    fill = PAGE * F * absorb;'] },", ''],
    ["{ dark: [], paper: ['  col = min(max(col, fill), vec3(1.0));'] },", ''],
    [lift, lift + "\n{ dark: [], paper: ['  if (uPass < 0.5) { col += 0.075 * vec3(0.60, 0.58, 0.55) * (1.0 - a); a += 0.075 * (1.0 - a); }'] },"],
    ['gl.uniform1f(u.uGain, paper ? 1.15 : 1.1);', 'gl.uniform1f(u.uGain, paper ? 2.4 : 1.1);']
  ];
  swaps.forEach(function (s) {
    ok(src.split(s[0]).length === 2, 'the control cannot put the film back: "' + s[0] + '" is not in the source once');
    src = src.replace(s[0], function () { return s[1]; });
  });
  return src;
}
function paperFails(m) {
  var f = [];
  if (!(m.clear.de <= 2.0)) f.push('the empty bulb is ' + m.clear.de + ' from the paper (2.0 at most)');
  if (!(m.clear.lum >= 0.95)) f.push('the empty bulb has ' + m.clear.lum + ' of the paper\'s luminance (0.95 at least)');
  if (!(m.sand.C >= 0.93)) f.push('the sand behind the glass keeps ' + m.sand.C + ' of its chroma (0.93 at least)');
  if (!(Math.abs(m.sand.L - 1) <= 0.03)) f.push('the sand behind the glass has ' + m.sand.L + ' of its L* (within 3 %)');
  if (!(m.sand.edge <= 1.04)) f.push('toward the wall the sand is whitened to ' + m.sand.edge + ' of its L* (1.04 at most)');
  if (!(m.rim.worst >= 0.40)) f.push('the rim is only ' + m.rim.worst + ' darker than the paper at its palest (' + m.rim.at + ', y ' + m.rim.y + ' cells; 0.40 at least)');
  if (!(m.rim.median >= 0.84)) f.push('the rim is ' + m.rim.median + ' darker than the paper at the median (0.84 at least)');
  if (!(m.clear.highlights >= 20)) f.push('only ' + m.clear.highlights + ' highlight pixels in the clear bulb (20 at least)');
  return f;
}
EXTRA.push({ name: 'on white the rendered glass is clear, its rim dark all round', shapes: IDS, run: async function (browser, shape) {
  var page = await open(browser), ctl = await open(browser, filmBack(SRC));
  try {
    var m = await page.evaluate(function (c) { return window.T.paper(c); }, { shape: shape, sand: PAPER_SAND });
    ok(m.glass === 'webgl' && m.paper === true, 'no WebGL glass in the light look (' + m.glass + '): this case could not tell');
    ok(m.clear.n > 10000 && m.rim.n > 500, 'too little measured (' + m.clear.n + ' clear pixels, ' + m.rim.n + ' rim points): this case could not tell');
    var f = paperFails(m);
    ok(!f.length, f.join('; '));
    var c = await ctl.evaluate(function (cc) { return window.T.paper(cc); }, { shape: shape, sand: PAPER_SAND });
    ok(c.glass === 'webgl', 'the control has no WebGL glass in the light look: it could not tell');
    var cf = paperFails(c);
    ok(cf.length > 0, 'with the film put back the glass passes all the same (' + JSON.stringify(c) + '): this case cannot tell a milky glass');
    ok(!page.errors.length && !ctl.errors.length, 'page errors: ' + page.errors.concat(ctl.errors).join(' | '));
    return ['the empty bulb ' + m.clear.de + ' from the paper, ' + m.clear.lum + ' of its luminance (with the film: ' + c.clear.de + ', ' + c.clear.lum + '); the sand behind the glass keeps ' +
      m.sand.C + ' of its chroma, ' + m.sand.L + ' of its L*, ' + m.sand.edge + ' toward the wall (with the film: ' + c.sand.C + ', ' + c.sand.L + ', ' + c.sand.edge + '); the rim ' +
      m.rim.worst + ' darker than the paper at its palest, ' + m.rim.median + ' at the median, ' + m.rim.n + ' points (with the film: ' + c.rim.worst + ', ' + c.rim.median + '); ' +
      m.clear.highlights + ' highlight pixels; with the film ' + cf.length + ' checks fail (' + cf[0] + ')'];
  } finally {
    await page.context().close(); await ctl.context().close();
  }
} });

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
  for (var x = 0; x < EXTRA.length; x++) {
    for (var k = 0; k < EXTRA[x].shapes.length; k++) {
      var sh = EXTRA[x].shapes[k];
      if (ids.indexOf(sh) < 0) continue;
      t0 = Date.now(); name = EXTRA[x].name + ' (' + sh + ')';
      count++;
      try {
        var ns = await EXTRA[x].run(browser, sh);
        console.log('PASS  ' + name + ': ' + ns.join('; ') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
      } catch (e3) {
        failures++;
        console.log('FAIL  ' + name + ': ' + (e3 && e3.message ? e3.message : e3));
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
