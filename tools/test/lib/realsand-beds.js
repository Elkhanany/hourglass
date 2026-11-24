/*
 * Beds for a mock GPU's readbacks (development only, never shipped).
 *
 * Real sand hears its sand through each readback's `beds` (realsand/solver.mjs bedOf, summed on
 * the GPU by shaders/tally.wgsl): for the bulb above the counting line and the one below, the
 * points in a bed, their mean velocity, their place across the glass, and how many of them move
 * and how fast. A mock solver has no sand, so a test says what its sand does and this file
 * sums it exactly as the shader would. Runs in Node (require) and in a page (window.__RealsandBeds,
 * like the plant library).
 *
 *   var B = require('./lib/realsand-beds.js');
 *   tally.beds = B.beds(B.bed([{ n: 1900, v: [0, -80] }]), B.rest(0));      // the upper bed falling as one body
 *   tally.beds = B.beds(B.bed([{ n: 1700 }, { n: 200, v: [60, 0] }]), null); // 200 of its points sliding
 *
 * Units are the solver's: cells and cells a second on its grid, y up (the neck's centre at 0, 0;
 * the upper bulb above). On a phone a solver cell is 1 / 0.65 of the app's, and 1.69 points make
 * one of the app's grains. A mock tally with no `beds` feeds nothing.
 */
(function (root) {
  'use strict';

  // A point "moves" when it is faster than 2 % of a free fall over the glass (tally.wgsl): 22.8
  // cells/s on the app's grid under plain gravity (302 cells high, 2,145 cells/s^2).
  var STILL = 22.8;
  // (the shader counts a bed point's speed up to this)
  var CAP = 2000;

  /**
   * One bulb's bed from groups of points: [{ n, v: [vx, vy] }] (v: cells/s; none: at rest), x:
   * the bed's centre across the glass from the neck's, cells (default: on the axis).
   */
  function bed(groups, x) {
    var n = 0, sx = 0, sy = 0, sliding = 0, slide = 0;
    (groups || []).forEach(function (g) {
      var k = g.n > 0 ? Math.round(g.n) : 0, vx = g.v ? +g.v[0] || 0 : 0, vy = g.v ? +g.v[1] || 0 : 0;
      var sp = Math.sqrt(vx * vx + vy * vy);
      if (sp > CAP) { vx *= CAP / sp; vy *= CAP / sp; sp = CAP; }
      n += k; sx += k * vx; sy += k * vy;
      if (sp > STILL) { sliding += k; slide += k * sp; }
    });
    return { n: n, vx: n ? sx / n : 0, vy: n ? sy / n : 0, x: n ? +x || 0 : 0, sliding: sliding, slide: slide };
  }
  /** A bed of n points at rest. */
  function rest(n) { return bed([{ n: n }]); }
  /** A tally's `beds`: [the bulb above the line, the one below]; null: no sand there. */
  function beds(above, below) { return [above || bed([]), below || bed([])]; }

  /**
   * A bed of n points thrown and landing, one `bed` a run (60 runs a second): it rises at `up`
   * cells/s and is slowed by gravity g (cells/s^2) to rest, falls back under it to `down` cells/s,
   * and is stopped by the glass over `stop` runs (2: a landing). axis 'y' (the default): along the
   * glass, falling toward the neck's side of the upper bulb (-y); 'x': the same speeds sideways.
   * Returns { list, peak (the run of its fastest fall), stopped (the first run at half that speed
   * or less), down }.
   */
  function toss(o) {
    var n = o.n, g = o.g || 2145, dt = 1 / 60, list = [], v = o.up || 0, k;
    function push(vv) { list.push(bed([{ n: n, v: o.axis === 'x' ? [-vv, 0] : [0, vv] }])); }
    while (v > 0) { push(v); v -= g * dt; }
    v = 0;
    while (v > -o.down) { v = Math.max(-o.down, v - g * dt); push(v); }
    var peak = list.length - 1, stop = o.stop || 2, stopped = -1;
    for (k = 1; k <= stop; k++) {
      var vv = -o.down * (1 - k / stop);
      if (stopped < 0 && -vv <= 0.5 * o.down) stopped = list.length;
      push(vv);
    }
    for (k = 0; k < 4; k++) push(0);
    return { list: list, peak: peak, stopped: stopped, down: o.down };
  }

  var api = { STILL: STILL, bed: bed, rest: rest, beds: beds, toss: toss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__RealsandBeds = api;
})(typeof window !== 'undefined' ? window : globalThis);
