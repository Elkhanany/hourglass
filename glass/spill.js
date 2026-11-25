/*!
 * Hourglass — glass/spill.js
 * Sand that has left the glass.
 *
 * 3. HourglassPhysics.Spill     Sand that has left the glass, falling in the
 *                               room and gathering in a dune on the desk.
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
  if (_.loaded !== 'glass/cracks.js') return;   // a piece before this one is missing: define nothing (app.js says it is updating)

  /* ======================================================================
   *  Spill — the sand that got out
   *
   *  Grains that escape through a breach fall in the room, not with the
   *  glass, and gather in a small dune on the desk line below it. Its canvas
   *  sits in #zoom, outside the assembly, so the dune stays on the desk while
   *  the glass is lifted, turned or spun, and grows and shrinks with the Zen
   *  zoom like the shadow. Grains in flight fall under the same slow-motion
   *  gravity as the sand inside. Landed ones stack in 2 px columns that give
   *  way at the angle of repose (33°), measured against the room's real
   *  gravity, so a tilted phone makes the dune creep downhill and pour off
   *  the low end of the desk; turned over, it falls away.
   *
   *  Units: canvas-local CSS px, px/s and px/s²; gravity and the felt kick
   *  in the page frame (x right, y down), the kick in g.
   * ==================================================================== */
  var SPILL_AIR = 600;        // grains in flight at most; past it the oldest drops onto the dune
  var SPILL_COL = 2;          // CSS px per heap column
  var SPILL_H = 0.5;          // CSS px of height per grain
  var SPILL_STACK = 48;       // grains per column at most (24 px)
  var SPILL_REPOSE = 1.3;     // px between neighbouring columns at 33°: 2·tan 33°
  var SPILL_HOPS = 8;         // top grains a hard kick throws per step
  var SPILL_TOP = 28;         // CSS px of the dune's band above the desk line
  var SPILL_SAND = ((255 << 24) | (104 << 16) | (160 << 8) | 204) >>> 0;   // without a renderer's sand

  /**
   * @param canvas    the dune's canvas (#c-spill); its backing store is made
   *                  with the first grain and let go of by clear()
   * @param renderer  the glass's Renderer: its sand colours and Reduce Motion
   */
  function Spill(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer || null;
    this.ctx = null;
    this.wCss = 0; this.hCss = 0; this.dpr = 1;
    this.deskY = 0; this.x0 = 0; this.x1 = 0;
    this.c0 = 0; this.c1 = -1;                 // the dune's columns: those on the desk
    this.col = new Uint16Array(0);             // grains per column
    this.cseed = new Uint8Array(0);            // their colour seeds, bottom up, SPILL_STACK a column
    this.px = new Float32Array(SPILL_AIR);     // grains in flight
    this.py = new Float32Array(SPILL_AIR);
    this.pvx = new Float32Array(SPILL_AIR);
    this.pvy = new Float32Array(SPILL_AIR);
    this.ps = new Uint8Array(SPILL_AIR);
    this.pAge = new Uint32Array(SPILL_AIR);
    this.nAir = 0;                             // in flight
    this.heapN = 0;                            // on the dune
    this.count = 0;                            // both
    this.landed = 0;                           // landings during the last step
    this.active = false;                       // something moved during the last step
    this.gx = 0; this.gy = 1;                  // the room's gravity at the last step
    this._age = 0; this._pend = 0; this._tick = 0; this._rng = 0x2545F491;
    this._dirty = false;                       // draw() has something new to show
    this._cd = new Uint8Array(0);              // dune columns to repaint ...
    this._h0 = 1e9; this._h1 = -1;             // ... and the span they lie in
    this._box = new Int32Array(4);             // where grains in flight were drawn, device px
    this._box[2] = this._box[3] = -1;
    this._dx = new Int16Array(SPILL_AIR);      // ... and where each one is drawn this time
    this._dy = new Int16Array(SPILL_AIR);
    // The dune is painted pixel by pixel into a band of its own (a small
    // offscreen canvas, as wide as the desk and as tall as the dune can be)
    // and laid onto the spill canvas from there: only changed columns are
    // repainted, and laying it back never forces the canvas to flush.
    this._img = null; this._buf = null;
    this._band = null; this._bctx = null;
    this._bx = 0; this._by = 0; this._bw = 0; this._bh = 0;
    this._pal = [];                            // flight colours, 4 by seed, from the sand's own table
    this._palOf = undefined;
    this._palLay = false;
    this._streak = '';
    this._nb = new Uint16Array(5);             // grains in flight per colour, then where each colour starts
    this._ord = new Int16Array(SPILL_AIR);     // grains in flight in colour order
    canvas.width = 0;                          // no backing store until something spills
    canvas.height = 0;
  }

  /**
   * Size the canvas (CSS px) and place the desk: deskY is the line the dune
   * sits on, x0 … x1 the ends of the desk, all canvas-local CSS px. dpr is
   * capped at 1.5: these are 2 px beads. Sand already spilled stays where it
   * was against the glass, which is the canvas's centre.
   */
  Spill.prototype.layout = function (wCss, hCss, dpr, deskY, x0, x1) {
    wCss = +wCss || 0; hCss = +hCss || 0;
    dpr = +dpr || 1;
    if (dpr > 1.5) dpr = 1.5; else if (dpr < 1) dpr = 1;
    var nCols = Math.ceil(wCss / SPILL_COL), shift = 0, k, j;
    if (this.wCss && this.count) shift = Math.round((wCss - this.wCss) / 2 / SPILL_COL);
    if (nCols !== this.col.length || shift) {
      var col = new Uint16Array(nCols), cs = new Uint8Array(nCols * SPILL_STACK), old = this.col;
      for (k = 0; k < old.length; k++) {
        j = k + shift;
        if (!old[k] || j < 0 || j >= nCols) continue;
        col[j] = old[k];
        cs.set(this.cseed.subarray(k * SPILL_STACK, (k + 1) * SPILL_STACK), j * SPILL_STACK);
      }
      this.col = col; this.cseed = cs;
      this._cd = new Uint8Array(nCols);
    }
    var dy = this.wCss ? (+deskY || 0) - this.deskY : 0;
    for (k = 0; k < this.nAir; k++) { this.px[k] += shift * SPILL_COL; this.py[k] += dy; }
    this.wCss = wCss; this.hCss = hCss; this.dpr = dpr;
    this.deskY = +deskY || 0; this.x0 = +x0 || 0; this.x1 = +x1 || 0;
    this.c0 = Math.max(0, Math.ceil(this.x0 / SPILL_COL));
    this.c1 = Math.min(nCols - 1, Math.floor(this.x1 / SPILL_COL) - 1);
    // a shorter desk lets go of what lay past its new ends
    var n = 0;
    for (k = 0; k < nCols; k++) {
      if (k >= this.c0 && k <= this.c1) n += this.col[k];
      else if (this.col[k]) { this.count -= this.col[k]; this.col[k] = 0; }
    }
    this.heapN = n;
    if (this.canvas.style) {
      this.canvas.style.width = wCss + 'px';
      this.canvas.style.height = hCss + 'px';
    }
    if (this.ctx) this._alloc();
  };

  /** The backing store and the dune's band, at the current size; everything is repainted. */
  Spill.prototype._alloc = function () {
    var c = this.canvas, dpr = this.dpr;
    c.width = Math.max(1, Math.round(this.wCss * dpr));
    c.height = Math.max(1, Math.round(this.hCss * dpr));
    this.ctx = c.getContext('2d');
    var bx = Math.max(0, Math.floor(this.c0 * SPILL_COL * dpr));
    var bx1 = Math.min(c.width, Math.ceil((this.c1 + 1) * SPILL_COL * dpr));
    var by = Math.max(0, Math.floor((this.deskY - SPILL_TOP) * dpr));
    var by1 = Math.min(c.height, Math.ceil((this.deskY + 1) * dpr));
    this._bx = bx; this._by = by;
    this._bw = Math.max(1, bx1 - bx); this._bh = Math.max(1, by1 - by);
    this._img = this.ctx.createImageData(this._bw, this._bh);
    this._buf = new Uint32Array(this._img.data.buffer);
    var doc = c.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!this._band && doc && doc.createElement) this._band = doc.createElement('canvas');
    if (this._band) {
      this._band.width = this._bw; this._band.height = this._bh;
      this._bctx = this._band.getContext('2d');
    }
    this._markAll();
    this._box[0] = this._box[1] = 0; this._box[2] = this._box[3] = -1;
    this._dirty = true;
  };

  /** Column c of the dune has changed: repaint it on the next draw. */
  Spill.prototype._mark = function (c) {
    this._cd[c] = 1;
    if (c < this._h0) this._h0 = c;
    if (c > this._h1) this._h1 = c;
  };

  /** Repaint the whole dune on the next draw (a new size, a new material). */
  Spill.prototype._markAll = function () {
    for (var c = this.c0; c <= this.c1; c++) this._cd[c] = 1;
    this._h0 = this.c0; this._h1 = this.c1;
  };

  /**
   * A grain leaves the glass at (x, y) with velocity (vx, vy): canvas-local
   * CSS px and px/s. With Reduce Motion it is simply there on the dune.
   */
  Spill.prototype.add = function (x, y, vx, vy, seed) {
    if (!this.wCss || !(x - x === 0) || !(y - y === 0)) return;
    if (!this.ctx) this._alloc();
    seed &= 255;
    if (this.renderer && this.renderer.reduced) {
      var c = Math.floor(x / SPILL_COL);
      if (this.gy > 0.5 && c >= this.c0 && c <= this.c1 && this._land(c, seed)) {
        this.count++; this._pend++; this._dirty = true;
      }
      return;
    }
    if (this.nAir >= SPILL_AIR) this._dropOldest();
    var i = this.nAir++;
    this.px[i] = x; this.py[i] = y;
    this.pvx[i] = vx - vx === 0 ? vx : 0; this.pvy[i] = vy - vy === 0 ? vy : 0;
    this.ps[i] = seed; this.pAge[i] = this._age++;
    this.count++;
    this._dirty = true;
    this.active = true;
  };

  /**
   * One step: dt in s; (gx, gy) the room's gravity in the page frame (a unit
   * vector); gPx its strength in px/s²; (kx, ky) the felt kick of the phone,
   * in g. Grains in flight fall in both and land where the dune is; the dune
   * slides at the angle of repose, falls off a desk turned away, and hops
   * when the phone is jolted harder than 1.2 g.
   */
  Spill.prototype.step = function (dt, gx, gy, gPx, kx, ky) {
    this.landed = this._pend; this._pend = 0;
    gx = +gx || 0; gy = +gy || 0; gPx = +gPx || 0; kx = +kx || 0; ky = +ky || 0;
    this.gx = gx; this.gy = gy;
    if (!this.count || !(dt > 0)) { this.active = false; return; }
    if (dt > 0.1) dt = 0.1;
    var moved = this.nAir > 0, i, c;
    var ax = (gx + kx) * gPx * dt, ay = (gy + ky) * gPx * dt;
    var faces = gy > 0.5, col = this.col, deskY = this.deskY, c0 = this.c0, c1 = this.c1;
    var xMax = this.wCss + 4, yMax = this.hCss + 4;
    // backwards, so a grain swapped into a freed slot has had its step already
    for (i = this.nAir - 1; i >= 0; i--) {
      var vx = this.pvx[i] + ax, vy = this.pvy[i] + ay;
      var x = this.px[i] + vx * dt, y = this.py[i] + vy * dt;
      c = Math.floor(x / SPILL_COL);
      if (faces && c >= c0 && c <= c1 && y >= deskY - col[c] * SPILL_H) {
        if (this._land(c, this.ps[i])) this.landed++; else this.count--;
        this._kill(i);
        continue;
      }
      if (x < -4 || x > xMax || y < -4 || y > yMax) {   // fell out of the picture
        this.count--;
        this._kill(i);
        continue;
      }
      this.px[i] = x; this.py[i] = y; this.pvx[i] = vx; this.pvy[i] = vy;
    }
    if (this.heapN) {
      if (gy < 0.25) {
        if (this._release()) moved = true;         // the desk is turned away: the sand falls off it
      } else {
        if (this._relax(gx / gy)) moved = true;
        if (kx * kx + ky * ky > 1.44 && !(this.renderer && this.renderer.reduced) && this._hop(kx, ky)) moved = true;
      }
    }
    this.active = moved;
    if (moved) this._dirty = true;
  };

  /** Put a grain on column c, or on the lower of its neighbours when c is full. False if nowhere. */
  Spill.prototype._land = function (c, seed) {
    var col = this.col;
    if (col[c] >= SPILL_STACK) {
      var to = -1;
      for (var d = 1; d <= 8 && to < 0; d++) {
        var a = c - d, b = c + d;
        var okA = a >= this.c0 && col[a] < SPILL_STACK, okB = b <= this.c1 && col[b] < SPILL_STACK;
        if (okA && (!okB || col[a] <= col[b])) to = a;
        else if (okB) to = b;
      }
      if (to < 0) return false;
      c = to;
    }
    this.cseed[c * SPILL_STACK + col[c]] = seed;
    col[c]++;
    this.heapN++;
    this._mark(c);
    return true;
  };

  /** Free flight slot i (the last grain in flight takes its place). */
  Spill.prototype._kill = function (i) {
    var last = --this.nAir;
    if (i === last) return;
    this.px[i] = this.px[last]; this.py[i] = this.py[last];
    this.pvx[i] = this.pvx[last]; this.pvy[i] = this.pvy[last];
    this.ps[i] = this.ps[last]; this.pAge[i] = this.pAge[last];
  };

  /** No room in the air: the oldest grain in flight drops straight onto the dune. */
  Spill.prototype._dropOldest = function () {
    var age = this.pAge, o = 0, best = age[0], k;
    for (k = 1; k < this.nAir; k++) if (age[k] < best) { best = age[k]; o = k; }
    var c = Math.floor(this.px[o] / SPILL_COL);
    if (this.gy > 0.5 && c >= this.c0 && c <= this.c1 && this._land(c, this.ps[o])) this._pend++;
    else this.count--;
    this._kill(o);
  };

  /** A new grain in flight, if there is room: (x, y) px, (vx, vy) px/s. */
  Spill.prototype._fly = function (x, y, vx, vy, seed) {
    if (this.nAir >= SPILL_AIR) { this.count--; return; }
    var i = this.nAir++;
    this.px[i] = x; this.py[i] = y; this.pvx[i] = vx; this.pvy[i] = vy;
    this.ps[i] = seed; this.pAge[i] = this._age++;
  };

  /** Take the top grain off column c; returns its seed. */
  Spill.prototype._pop = function (c) {
    var n = --this.col[c];
    this.heapN--;
    this._mark(c);
    return this.cseed[c * SPILL_STACK + n];
  };

  /**
   * Avalanching, two alternating passes: a grain moves to its neighbour
   * where the step down to it is steeper than the angle of repose. The desk
   * is level on the page, but the room's gravity may lean (lean = gx/gy):
   * then the downhill side gives way sooner and the uphill side holds more.
   * Past either end of the desk a grain falls off.
   */
  Spill.prototype._relax = function (lean) {
    if (lean > 20) lean = 20; else if (lean < -20) lean = -20;
    var thR = SPILL_REPOSE - 2 * lean, thL = SPILL_REPOSE + 2 * lean;   // px, moving right / left
    var col = this.col, c0 = this.c0, c1 = this.c1, moved = false, pass, j, c;
    for (pass = 0; pass < 2; pass++) {
      var fwd = ((this._tick + pass) & 1) === 0;
      for (j = c0 - 1; j <= c1; j++) {
        c = fwd ? j : c0 - 1 + c1 - j;            // the pair (c, c + 1)
        var a = c >= c0 ? col[c] : 0, b = c < c1 ? col[c + 1] : 0, d = (a - b) * SPILL_H;
        if (a && d > thR && (c >= c1 || b < SPILL_STACK)) { this._move(c, c + 1); moved = true; }
        else if (b && -d > thL && (c < c0 || a < SPILL_STACK)) { this._move(c + 1, c); moved = true; }
      }
    }
    this._tick++;
    return moved;
  };

  /** The top grain of column `from` slides onto `to`, or off the end of the desk. */
  Spill.prototype._move = function (from, to) {
    var sd = this._pop(from);
    if (to < this.c0 || to > this.c1) {
      var right = to > from;
      this._fly(right ? (this.c1 + 1) * SPILL_COL + 0.5 : this.c0 * SPILL_COL - 0.5,
                this.deskY - this.col[from] * SPILL_H - 1, right ? 30 : -30, 0, sd);
      return;
    }
    this.cseed[to * SPILL_STACK + this.col[to]] = sd;
    this.col[to]++;
    this.heapN++;
    this._mark(to);
  };

  /** The desk faces away from gravity: every column lets its top grain fall. */
  Spill.prototype._release = function () {
    var col = this.col, moved = false;
    for (var c = this.c0; c <= this.c1; c++) {
      if (!col[c]) continue;
      var sd = this._pop(c);
      this._fly(c * SPILL_COL + 1, this.deskY - col[c] * SPILL_H, 0, 0, sd);
      moved = true;
    }
    return moved;
  };

  /**
   * A hard jolt throws a few grains off the top of the dune, against the
   * felt kick (the desk was moving that way when it pushed them). A kick
   * that would drive them into the desk throws nothing.
   */
  Spill.prototype._hop = function (kx, ky) {
    var col = this.col, lo = -1, hi = -1, c, k;
    var kn = Math.sqrt(kx * kx + ky * ky), ux = -kx / kn, uy = -ky / kn;
    if (uy > 0.2) return false;
    for (c = this.c0; c <= this.c1; c++) if (col[c]) { if (lo < 0) lo = c; hi = c; }
    if (lo < 0) return false;
    var moved = false;
    for (k = 0; k < SPILL_HOPS && this.nAir < SPILL_AIR; k++) {
      c = lo + ((this._rand() * (hi - lo + 1)) | 0);
      if (!col[c]) continue;
      var sd = this._pop(c), sp = 60 + 40 * this._rand();
      this._fly(c * SPILL_COL + 1, this.deskY - col[c] * SPILL_H - 0.5, ux * sp, uy * sp, sd);
      moved = true;
    }
    return moved;
  };

  Spill.prototype._rand = function () {
    var s = this._rng;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this._rng = s;
    return (s >>> 0) / 4294967296;
  };

  /**
   * Flight colours from the sand's own table: four tints by seed (a grain
   * in flight is a 2 px speck, and every colour costs a fill), and the
   * streak's.
   */
  Spill.prototype._palette = function () {
    var ren = this.renderer, lut = ren && ren.lut, v, b;
    for (b = 0; b < 4; b++) {
      v = lut ? lut[(21 << 8) | (b * 64 + 32)] : SPILL_SAND;
      this._pal[b] = 'rgb(' + (v & 255) + ',' + ((v >>> 8) & 255) + ',' + ((v >>> 16) & 255) + ')';
    }
    v = lut ? lut[(21 << 8) | 136] : SPILL_SAND;
    this._streak = 'rgba(' + (v & 255) + ',' + ((v >>> 8) & 255) + ',' + ((v >>> 16) & 255) + ',0.45)';
    this._palOf = ren ? ren.theme : null;
    this._palLay = !!(ren && ren.layers);
  };

  /**
   * Repaint the marked dune columns between cA and cB into its band: each a
   * stack of 2×2 px beads in 1 px steps (two grains a bead), in the sand's
   * own colours, lit on top and darker with depth.
   */
  Spill.prototype._paint = function (cA, cB) {
    var buf = this._buf, bw = this._bw, bh = this._bh, bx = this._bx, by = this._by, dpr = this.dpr;
    var lut = this.renderer && this.renderer.lut, col = this.col, cs = this.cseed, deskY = this.deskY, cd = this._cd;
    var c, x, y, k, row, run0 = -1, run1 = -1;
    for (c = cA; c <= cB + 1; c++) {
      if (c > cB || cd[c]) {
        // hand the band each run of repainted columns (runs a few columns apart go together)
        if (run1 >= 0 && (c > cB || c - run1 > 6)) {
          this._put(run0, run1);
          run0 = run1 = -1;
        }
        if (c > cB) break;
      } else continue;
      cd[c] = 0;
      if (run0 < 0) run0 = c;
      run1 = c;
      var xa = Math.round(c * SPILL_COL * dpr) - bx, xb = Math.round((c + 1) * SPILL_COL * dpr) - bx;
      if (xa < 0) xa = 0;
      if (xb > bw) xb = bw;
      if (xb <= xa) continue;
      for (y = 0; y < bh; y++) { row = y * bw; for (x = xa; x < xb; x++) buf[row + x] = 0; }
      var n = col[c], beads = (n + 1) >> 1;
      for (k = 0; k < beads; k++) {
        var gi = 2 * k + 1 < n ? 2 * k + 1 : n - 1, depth = beads - 1 - k;
        var sd = cs[c * SPILL_STACK + gi], lv = 22 - (depth < 8 ? depth : 8);
        var px = lut ? lut[(lv << 8) | sd] : SPILL_SAND;
        var ya = Math.round((deskY - 2 - k) * dpr) - by, yb = Math.round((deskY - k) * dpr) - by;
        if (ya < 0) ya = 0;
        if (yb > bh) yb = bh;
        for (y = ya; y < yb; y++) { row = y * bw; for (x = xa; x < xb; x++) buf[row + x] = px; }
      }
    }
  };

  /** Copy dune columns cA … cB from the band's pixels onto its canvas. */
  Spill.prototype._put = function (cA, cB) {
    if (!this._bctx) return;
    var dpr = this.dpr, bx = this._bx, bw = this._bw;
    var xa = Math.round(cA * SPILL_COL * dpr) - bx, xb = Math.round((cB + 1) * SPILL_COL * dpr) - bx;
    if (xa < 0) xa = 0;
    if (xb > bw) xb = bw;
    if (xb > xa) this._bctx.putImageData(this._img, 0, 0, xa, 0, xb - xa, this._bh);
  };

  /**
   * Show what changed since the last draw, and nothing at all when nothing
   * did. Only the area the grains in flight covered (last time and now) and
   * the dune columns that changed are cleared and drawn again.
   */
  Spill.prototype.draw = function () {
    var ren = this.renderer, th = ren ? ren.theme : null;
    if (th !== this._palOf || !!(ren && ren.layers) !== this._palLay) {   // a new material, or its two tones: new sand colours
      this._palette();
      if (this.ctx) { this._markAll(); this._dirty = true; }
    }
    if (!this._dirty || !this.ctx) return;
    this._dirty = false;
    var ctx = this.ctx, dpr = this.dpr, cw = this.canvas.width, ch = this.canvas.height;
    var sz = Math.max(1, Math.round(2 * dpr)), i, X, Y, nAir = this.nAir, fast = 0;
    var px = this.px, py = this.py, pvx = this.pvx, pvy = this.pvy, ps = this.ps, dX = this._dx, dY = this._dy;
    var nb = this._nb;
    // one pass over the grains in flight: where each is drawn, the box they
    // cover (streaks included, device px), and how many there are of each colour
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    nb[0] = nb[1] = nb[2] = nb[3] = nb[4] = 0;
    for (i = 0; i < nAir; i++) {
      X = dX[i] = Math.round((px[i] - 1) * dpr); Y = dY[i] = Math.round((py[i] - 1) * dpr);
      if (X < x0) x0 = X;
      if (X + sz > x1) x1 = X + sz;
      if (Y < y0) y0 = Y;
      if (Y + sz > y1) y1 = Y + sz;
      nb[(ps[i] >> 6) + 1]++;
      var v2 = pvx[i] * pvx[i] + pvy[i] * pvy[i];
      if (v2 > 90000) {
        fast++;
        var k = Math.min(10, Math.sqrt(v2) / 60) * dpr / Math.sqrt(v2);
        var sx = X + sz / 2 - pvx[i] * k, sy = Y + sz / 2 - pvy[i] * k;
        if (sx < x0) x0 = Math.floor(sx) - 1;
        if (sx > x1) x1 = Math.ceil(sx) + 1;
        if (sy < y0) y0 = Math.floor(sy) - 1;
        if (sy > y1) y1 = Math.ceil(sy) + 1;
      }
    }
    // clear: the grains in flight last time, the ones now, and dune columns that changed
    var box = this._box, cx0 = x0, cy0 = y0, cx1 = x1, cy1 = y1;
    if (box[2] >= box[0]) {
      if (box[0] < cx0) cx0 = box[0];
      if (box[1] < cy0) cy0 = box[1];
      if (box[2] > cx1) cx1 = box[2];
      if (box[3] > cy1) cy1 = box[3];
    }
    var bx = this._bx, by = this._by, bw = this._bw, bh = this._bh;
    if (this._h1 >= this._h0) {
      var hc0 = this._h0, hc1 = this._h1;
      this._h0 = 1e9; this._h1 = -1;
      this._paint(hc0, hc1);
      var hx0 = Math.round(hc0 * SPILL_COL * dpr), hx1 = Math.round((hc1 + 1) * SPILL_COL * dpr);
      if (hx0 < bx) hx0 = bx;
      if (hx1 > bx + bw) hx1 = bx + bw;
      if (cx1 <= cx0) { cx0 = hx0; cx1 = hx1; cy0 = by; cy1 = by + bh; }
      else {
        if (hx0 < cx0) cx0 = hx0;
        if (hx1 > cx1) cx1 = hx1;
        if (by < cy0) cy0 = by;
        if (by + bh > cy1) cy1 = by + bh;
      }
    }
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 > cw) cx1 = cw;
    if (cy1 > ch) cy1 = ch;
    if (cx1 > cx0 && cy1 > cy0) {
      ctx.clearRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
      // lay the dune back wherever it was cleared
      var rx0 = cx0 > bx ? cx0 : bx, ry0 = cy0 > by ? cy0 : by;
      var rx1 = cx1 < bx + bw ? cx1 : bx + bw, ry1 = cy1 < by + bh ? cy1 : by + bh;
      if (rx1 > rx0 && ry1 > ry0) {
        if (this._band) ctx.drawImage(this._band, rx0 - bx, ry0 - by, rx1 - rx0, ry1 - ry0, rx0, ry0, rx1 - rx0, ry1 - ry0);
        else ctx.putImageData(this._img, bx, by, rx0 - bx, ry0 - by, rx1 - rx0, ry1 - ry0);
      }
    }
    // the grains in flight: one path of beads per colour, filled once
    if (nAir) {
      var ord = this._ord, b, j;
      for (b = 1; b <= 4; b++) nb[b] += nb[b - 1];
      for (i = 0; i < nAir; i++) ord[nb[ps[i] >> 6]++] = i;    // now nb[b] is where colour b ends
      for (b = 0, j = 0; b < 4; b++) {
        if (j === nb[b]) continue;
        ctx.beginPath();
        for (; j < nb[b]; j++) { i = ord[j]; ctx.rect(dX[i], dY[i], sz, sz); }
        ctx.fillStyle = this._pal[b];
        ctx.fill();
      }
      if (fast) {                              // a fine streak behind the fast ones
        ctx.beginPath();
        for (i = 0; i < nAir; i++) {
          var w2 = pvx[i] * pvx[i] + pvy[i] * pvy[i];
          if (w2 <= 90000) continue;
          var q = Math.min(10, Math.sqrt(w2) / 60) * dpr / Math.sqrt(w2);
          X = dX[i] + sz / 2; Y = dY[i] + sz / 2;
          ctx.moveTo(X, Y); ctx.lineTo(X - pvx[i] * q, Y - pvy[i] * q);
        }
        ctx.strokeStyle = this._streak; ctx.lineWidth = dpr; ctx.stroke();
      }
      box[0] = x0; box[1] = y0; box[2] = x1; box[3] = y1;
    } else {
      box[0] = box[1] = 0; box[2] = box[3] = -1;
    }
  };

  /** Sweep it all away (Reset, a new glass): nothing spilled, no backing store. */
  Spill.prototype.clear = function () {
    this.nAir = 0; this.heapN = 0; this.count = 0; this.landed = 0; this._pend = 0;
    this.active = false; this._dirty = false;
    this.col.fill(0);
    this._cd.fill(0);
    this._h0 = 1e9; this._h1 = -1;
    this._box[0] = this._box[1] = 0; this._box[2] = this._box[3] = -1;
    this.canvas.width = 0;
    this.canvas.height = 0;
    if (this._band) { this._band.width = 0; this._band.height = 0; }
    this.ctx = null; this._bctx = null; this._img = null; this._buf = null;
  };


  P.Spill = Spill;
  _.loaded = 'glass/spill.js';
})(typeof window !== 'undefined' ? window : globalThis);
