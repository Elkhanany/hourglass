/*!
 * Hourglass — glass/shapes.js
 * The glass: its geometry and the shapes it can take.
 *
 * One piece of HourglassPhysics, loaded in this order: glass/shapes.js, sand/sim.js, sand/sands.js, glass/gl.js,
 * glass/renderer.js, glass/cracks.js, glass/spill.js. Each reads what it needs from the namespace once,
 * at load (cut from physics.js by tools/split-physics.js).
 * Zero dependencies. License: GPL-3.0-or-later.
 */
(function (root) {
  'use strict';
  var P = root.HourglassPhysics || (root.HourglassPhysics = {});
  var _ = P._ || (P._ = {});        // names the pieces share that are not the app's

  /* ======================================================================
   *  Vessel geometry — shared by the simulation and the renderer
   * ==================================================================== */

  /**
   * Other glasses. A shape is { id, name, kR, kH, f }: kR and kH scale the
   * bulb's largest half-width and its height against the classic glass's
   * (88 and 206 cells at scale 1), and f(u) is how far the wall has opened
   * at u, from 0 at the neck (u = 0) to 1 at its widest:
   * r(u) = RN + (R - RN) * f(u). The classic teardrop is not written this
   * way: it keeps its own formula in profile(), so its numbers never move.
   *
   * What the sand needs of a shape (the Sim checks it when it is built):
   * the wall never opens by more than a cell a row on the way out of the
   * neck (sand runs off glass that steep, upright or leaned), one bulge and
   * no second waist (a bed in flight moves whole columns), and an end wide
   * enough to pour into. f must be a pure function of u.
   *
   * The shapes are a registry: one addShape per glass (SHAPES by id,
   * SHAPE_ORDER in the order they were added, the classic first). Beside
   * the five fields above a record says:
   *   offered    whether Tune shows the glass (not yet: one that still has
   *              to show that its sand flows and keeps time in both sands)
   *   symmetry   'point': the glass is the same after a half turn. Both
   *              sand engines turn it that way (here a turn is the lattice
   *              read backwards; the GPU's maps p to 2c - p), so there is
   *              no other value yet
   *   equator    the u of its widest point (read off f the first time it
   *              is asked for; 0.66 for the classic)
   *   classic    true for the teardrop alone, which has no f
   * checkShape(id, q, pace) says whether the sand can use a registered
   * shape at a size, and why not, without building a Sim.
   */
  // What the shapes below are drawn with. A funnel and a closing curve meet
  // in a rounded corner (shMin); a curve built that way is then scaled so its
  // widest point is exactly 1 (shUnit).
  /** The smaller of two positive numbers, with the corner where they cross rounded off (k large: a tight corner). */
  function shMin(a, b, k) {
    if (a <= 0 || b <= 0) return 0;
    return Math.pow(Math.pow(a, -k) + Math.pow(b, -k), -1 / k);
  }
  /**
   * The curve g scaled so that its largest value is 1, and 0 at both ends.
   * Its largest value is looked for once, the first time the shape is asked
   * for: a page that never shows the glass never pays for it.
   */
  function shUnit(g) {
    var m = 0;
    return function (u) {
      if (u <= 0) return 0;
      if (u >= 1) return 0;
      if (!m) {
        for (var k = 1, N = 20000, v; k < N; k++) { v = g(k / N); if (v > m) m = v; }
      }
      var x = g(u) / m;
      return x > 1 ? 1 : (x < 0 ? 0 : x);
    };
  }
  /** The closing curve of a bulb: 1 until u = c, 0 at u = 1; n shapes the shoulder, e the end (1/2: an ellipse). */
  function shClose(u, c, n, e) {
    if (u <= c) return 1;
    var w = (u - c) / (1 - c);
    if (w >= 1) return 0;
    return Math.pow(1 - Math.pow(w, n), e);
  }
  /** A funnel that leaves the neck with slope a and arrives level at t = 1 (a cubic). */
  function shSwell(t, a) { return t * (a + t * ((3 - 2 * a) + t * (a - 2))); }
  /** The rounded end: 1 until late, then a quarter round to 0 at w = 1 (m large: later and tighter). */
  function shTip(w, m) { return w >= 1 ? 0 : Math.sqrt(1 - Math.pow(w, m)); }
  /**
   * An ogee: 1 at w = 0, a round shoulder, then a hollow sweep down to k.
   * p moves the turn; a < 1 stops the sweep while it is still falling.
   */
  function shOgee(w, k, p, a) {
    if (w <= 0) return 1;
    if (w >= 1) return k;
    a = a || 1;
    var lo = Math.cos(Math.PI * a);
    return k + (1 - k) * (Math.cos(Math.PI * a * Math.pow(w, p)) - lo) / (1 - lo);
  }
  /**
   * A funnel drawn as its slope: knots [u, slope] from the neck to the widest
   * point, the slope eased from knot to knot (straight where a knot's third
   * entry is 1). The curve is the slope summed up, scaled to reach 1 at the
   * last knot; 1 beyond it.
   */
  function shRise(k) {
    var acc = [0], i;
    for (i = 1; i < k.length; i++) acc[i] = acc[i - 1] + (k[i][0] - k[i - 1][0]) * (k[i][1] + k[i - 1][1]) / 2;
    var tot = acc[k.length - 1];
    return function (u) {
      if (u <= k[0][0]) return 0;
      for (var j = 1; j < k.length; j++) if (u <= k[j][0]) {
        var d = k[j][0] - k[j - 1][0], t = (u - k[j - 1][0]) / d, s0 = k[j - 1][1], s1 = k[j][1];
        var part = k[j][2] ? s0 * t + (s1 - s0) * t * t / 2 : s0 * t + (s1 - s0) * (t * t * t - t * t * t * t / 2);
        return (acc[j - 1] + d * part) / tot;
      }
      return 1;
    };
  }
  /** A blown flask: a funnel (shRise) to u = c, full width to c2, then a round end ((1 - w^p)^q; p 2, q 1/2: an ellipse). */
  function shFlask(c, knots, p, q, c2) {
    var F = shRise(knots);
    c2 = c2 || c;
    return function (u) {
      if (u <= c) return F(u);
      if (u <= c2) return 1;
      var w = (u - c2) / (1 - c2);
      return w <= 0 ? 1 : w >= 1 ? 0 : Math.pow(1 - Math.pow(w, p), q || 0.5);
    };
  }

  var SHAPES = {}, SHAPE_ORDER = [];
  var SHAPE_FIELDS = ['id', 'name', 'kR', 'kH', 'f', 'classic', 'equator', 'symmetry', 'offered'];

  /**
   * Register a glass shape. The record is kept as it is given (and completed:
   * `symmetry` 'point' and `offered` false where it says neither), by its id,
   * after the shapes already there. What costs nothing to see is checked here,
   * as the page loads, and refused by name: an id and a name, kR and kH, an f
   * that is 0 at the neck, the symmetry both sand engines need, and a field
   * that is none of a shape's (`offerd: true` would leave a glass not
   * offered, without a word). What takes a walk along the curve or a lattice
   * is left to checkShape: a curve made by shUnit is walked 20,000 times the
   * first time it is asked for, and a page that never shows the glass never
   * pays for it.
   */
  function addShape(rec) {
    var what = 'addShape', k;
    if (!rec || typeof rec !== 'object') throw new Error(what + ': a record is needed');
    if (typeof rec.id !== 'string' || !rec.id) throw new Error(what + ': the record has no id');
    what += ' "' + rec.id + '"';
    if (rec.id in SHAPES) throw new Error(what + ': that id is taken');
    for (k in rec) {
      if (SHAPE_FIELDS.indexOf(k) < 0) throw new Error(what + ': ' + k + ' is no field of its record (' + SHAPE_FIELDS.join(', ') + ')');
    }
    if (typeof rec.name !== 'string' || !rec.name) throw new Error(what + ': it has no name');
    if (rec.symmetry !== undefined && rec.symmetry !== 'point') {
      throw new Error(what + ': symmetry "' + rec.symmetry + '": both sand engines turn the glass by a half turn, so it must be the same after one (\'point\')');
    }
    if (rec.offered !== undefined && typeof rec.offered !== 'boolean') throw new Error(what + ': offered is ' + rec.offered + ', not true or false');
    if (!(rec.kR > 0 && rec.kR < Infinity && rec.kH > 0 && rec.kH < Infinity)) throw new Error(what + ': kR is ' + rec.kR + ' and kH is ' + rec.kH + ' (both above 0)');
    if (rec.classic) {
      // the teardrop: profile() holds its curve, and only it may say so
      if (rec.id !== 'classic' || rec.f !== undefined) throw new Error(what + ': only the teardrop, which has no f, is the classic glass');
      if (!(rec.equator > 0 && rec.equator < 1)) throw new Error(what + ': its equator is ' + rec.equator + ' (the u of its widest point, between 0 and 1)');
    } else {
      if (typeof rec.f !== 'function') throw new Error(what + ': it has no f(u)');
      if (rec.f(0) !== 0) throw new Error(what + ': f(0) is ' + rec.f(0) + ' (the neck is the classic glass\'s own: f must be 0 there)');
      if (rec.equator !== undefined) throw new Error(what + ': its equator is read off f, so the record names none (only the classic glass, which has no f, says its own)');
      Object.defineProperty(rec, 'equator', { enumerable: true, configurable: true, get: function () { return shapeEquator(rec); } });
    }
    if (rec.symmetry === undefined) rec.symmetry = 'point';
    if (rec.offered === undefined) rec.offered = false;
    SHAPES[rec.id] = rec;
    SHAPE_ORDER.push(rec.id);
    return rec;
  }

  // the classic teardrop, the glass the sand engine was fitted to (its curve is profile()'s own)
  addShape({ id: 'classic', name: 'Classic', classic: true, kR: 1, kH: 1, equator: 0.66, offered: true });
  // two cones base to base: straight flanks, a softened girdle half way, small rounded points
  addShape({
    id: 'lozenge', name: 'Lozenge', kR: 0.92, kH: 1.08, offered: true,
    f: shUnit(function (u) {
      var c = 0.50, t = u / c, up = t * (1 + 0.07 * (1 - t)), d = 1 - u, m = 1 / (1 - c);
      var down = Math.sqrt(m * m * d * d + 0.34 * d) / Math.sqrt(1 + 0.34 * (1 - c));   // a straight flank into a round point
      return shMin(up, down, 7);
    })
  });
  // the hourglass of the pictogram: two wide, nearly straight cones on low rounded bases
  addShape({
    id: 'delta', name: 'Delta', kR: 1.10, kH: 0.86, offered: true,
    f: shUnit(function (u) {
      return shMin(Math.pow(u / 0.845, 1.04), shClose(u, 0.80, 2.2, 0.5), 10);
    })
  });
  // the apothecary's ampoule: a short shoulder, a long body that barely bows, a round end
  addShape({
    id: 'ampoule', name: 'Ampoule', kR: 0.70, kH: 1.08, offered: true,
    f: shFlask(0.63, [[0, 0.4], [0.04, 1], [0.24, 1], [0.38, 0.10], [0.63, 0, 1]], 2.0, 0.5, 0.72)
  });
  // two horns, bells outward: a slim neck that flares late to a wide lip
  addShape({
    id: 'trumpet', name: 'Trumpet', kR: 1.00, kH: 1.10, offered: true,
    f: shUnit(function (u) {
      return shMin(Math.pow(u / 0.87, 1.9), shClose(u, 0.78, 2.2, 0.5), 9);
    })
  });
  // the Florence flask: a slender drawn neck, a steep shoulder, a full globe
  addShape({
    id: 'florence', name: 'Florence', kR: 0.84, kH: 1.08, offered: true,
    f: shFlask(0.70, [[0, 0.20], [0.11, 0.24], [0.34, 1], [0.46, 1], [0.70, 0, 1]], 2.0)
  });
  // the onion dome: a broad low swell, hollow shoulders, a small finial
  addShape({
    id: 'onion', name: 'Onion', kR: 1.05, kH: 1.10, offered: true,
    f: shUnit(function (u) {
      var c = 0.50, w = Math.max(0, (u - c) / (1 - c));
      return shMin(u / 0.49, shOgee(w, 0.15, 1.12, 0.9) * shTip(w, 12), 6);
    })
  });
  // a bell: a round crown at the neck, a slow waist, a lip that flares to the rim
  addShape({
    id: 'bell', name: 'Bell', kR: 0.84, kH: 1.00, offered: true,
    f: shUnit(function (u) {
      var c = 0.78, crown = 0.52 * (1 - Math.exp(-u / 0.24)), flare = u > 0.27 ? 0.48 * Math.pow((u - 0.27) / 0.51, 2.5) : 0;
      var w = Math.max(0, (u - c) / (1 - c)), dome = 1.02 * Math.pow(Math.max(0, 1 - Math.pow(w, 1.9)), 0.62);
      return shMin(crown + flare, dome, 5);
    })
  });
  // the bottle gourd: a round body that draws in, without a second waist, to a smaller lobe
  addShape({
    id: 'gourd', name: 'Gourd', kR: 0.90, kH: 1.10, offered: true,
    f: shUnit(function (u) {
      var c = 0.535;
      if (u <= c) return shSwell(u / c, 1.3);
      var w = (u - c) / (1 - c), k = 0.56;
      return (k + (1 - k) * 0.5 * (1 + Math.cos(Math.PI * Math.min(1, w / 0.66)))) * shTip(w, 4.5);
    })
  });

  /** Where a shape is widest: the u of its largest f, the middle of a plateau. */
  var SHAPE_EQ = {};
  function shapeEquator(s) {
    if (SHAPE_EQ[s.id] !== undefined && SHAPE_EQ[s.id].f === s.f) return SHAPE_EQ[s.id].u;
    var N = 4096, k, v, m = -1, a = -1, b = 0, u, lo, hi, x, y;
    for (k = 0; k < N; k++) { v = s.f(k / N); if (v > m) m = v; }
    for (k = 0; k < N; k++) {
      if (s.f(k / N) >= m - 1e-9) { if (a < 0) a = k; b = k; }
    }
    u = (a + b) / (2 * N);
    // The top may lie between two samples: a glass that is widest at a corner
    // has it nowhere else. Close in on it; a plateau gives nothing higher.
    lo = Math.max(0, (a - 1) / N); hi = Math.min(1, (b + 1) / N);
    for (k = 0; k < 60; k++) {
      x = lo + (hi - lo) / 3; y = hi - (hi - lo) / 3;
      if (s.f(x) < s.f(y)) lo = x; else hi = y;
    }
    if (s.f((lo + hi) / 2) > m + 1e-9) u = (lo + hi) / 2;
    SHAPE_EQ[s.id] = { f: s.f, u: u };
    return u;
  }

  /**
   * All lengths are in grid cells (one cell = one grain of sand).
   * `q` scales the whole vessel: 1.08 ≈ 17k grains (phones),
   * 1.3 ≈ 25k grains (tablets / desktop); up to 33k with added sand.
   * `shape` is an id in SHAPES; without one (or 'classic') it is the
   * classic teardrop, exactly as it has always been.
   */
  function makeGeometry(q, shape) {
    q = q || 1;
    var s = null;
    if (shape !== undefined && shape !== null && shape !== 'classic') {
      s = Object.prototype.hasOwnProperty.call(SHAPES, shape) ? SHAPES[shape] : null;
      if (!s) throw new Error('makeGeometry: there is no glass shape "' + shape + '"');
    }
    var R = Math.round(88 * q);          // max inner half-width of a bulb
    var HB = Math.round(206 * q);        // bulb height, neck centre → far end
    if (s) {
      R = Math.round(88 * q * s.kR);
      HB = Math.round(206 * q * s.kH);
    }
    var RN = Math.round(3 * q) + 0.5;    // neck inner half-width (7 / 9 cells)
    var PAD = 8;
    var W = 2 * (R + PAD) + 1;           // odd → exact 180° symmetry
    var H = 2 * (HB + 4) + 1;            // odd → neck gate is the centre row
    return {
      q: q, R: R, HB: HB, RN: RN, W: W, H: H,
      cx: W / 2, cy: H / 2,
      gateY: (H - 1) / 2,
      equator: s ? shapeEquator(s) : 0.66,   // where the bulb is widest (0 = neck)
      shape: s,                          // the shape's record; null: the classic teardrop
      wall: 2.6 * q,                     // drawn glass thickness
      // assembly (glass + caps + posts) for the renderer
      capHalf: R + 24 * q,
      slabH: 11 * q,
      collarH: 5 * q,
      postX: R + 16 * q,
      AW: 2 * (R + 24 * q) + 10 * q,
      AH: 2 * HB + 2 * (14 * q) + 10 * q
    };
  }

  /**
   * Inner half-width of the glass at normalised distance u from the neck
   * (u = 0 at the neck centre, u = 1 at the closed end of the bulb).
   * A steep (≈50°+) funnel flares out of a short tubular neck, swells to the
   * equator, then closes in a flattened dome — a classic blown teardrop.
   */
  function profile(u, g) {
    if (u >= 1) return 0;
    if (u < 0) u = 0;
    if (g.shape) return g.RN + (g.R - g.RN) * g.shape.f(u);   // another glass (SHAPES)
    var c = g.equator;
    if (u <= c) {
      var v = u / c;
      var e = Math.sin(Math.PI * 0.5 * Math.pow(v, 1.22));
      return g.RN + (g.R - g.RN) * e;
    }
    var w = (u - c) / (1 - c);
    return g.R * Math.sqrt(1 - Math.pow(w, 2.3));
  }

  /**
   * What can be said of a shape's curve at any size, from a walk along it in
   * 2048 steps: f stays between 0 and 1, and it is one bulge (it never falls
   * on the way to its widest point, and never rises after it). [] or the
   * reasons.
   */
  function curveFaults(s) {
    var N = 2048, eps = 1e-9, v = new Float64Array(N + 1), out = [], k, m = -1, a = -1, b = -1;
    for (k = 0; k <= N; k++) {
      v[k] = +s.f(k / N);
      if (!(v[k] >= -eps && v[k] <= 1 + eps)) return ['f(' + k / N + ') is ' + v[k] + ' (f must stay between 0 and 1)'];
      if (v[k] > m) m = v[k];
    }
    for (k = 0; k <= N; k++) if (v[k] >= m - eps) { if (a < 0) a = k; b = k; }
    for (k = 1; k <= a; k++) if (v[k] < v[k - 1] - eps) { out.push('f falls before its widest point (at u = ' + k / N + '): one bulge only'); break; }
    for (k = a + 1; k < b; k++) if (v[k] < m - eps) { out.push('f has a waist between two widest points (at u = ' + k / N + '): one bulge only'); break; }
    for (k = b + 1; k <= N; k++) if (v[k] > v[k - 1] + eps) { out.push('f rises again beyond its widest point (at u = ' + k / N + '): one bulge only'); break; }
    return out;
  }


  P.makeGeometry = makeGeometry; _.curveFaults = curveFaults; P.addShape = addShape;
  P.SHAPE_ORDER = SHAPE_ORDER; P.SHAPES = SHAPES; P.profile = profile;
  _.loaded = 'glass/shapes.js';
})(typeof window !== 'undefined' ? window : globalThis);
