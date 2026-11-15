/*!
 * Hourglass — physics.js
 * ---------------------------------------------------------------------------
 * 1. HourglassPhysics.Sim       Granular simulation. Every grain is simulated:
 *                               a cellular automaton for packed / sliding sand
 *                               plus sub-pixel ballistic particles for the
 *                               free-falling stream, the pour and the splash.
 * 2. HourglassPhysics.Renderer  Per-grain pixel renderer (ImageData / Uint32)
 *                               and the blown-glass vessel, caps and lighting.
 *
 * Zero dependencies. License: GPL-3.0.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  /* ======================================================================
   *  Constants
   * ==================================================================== */

  var EMPTY = 0;   // free space inside the glass
  var WALL = 1;    // glass / outside / closed neck gate
  var REST = 2;    // static, packed grain
  var MOVE = 3;    // sliding / falling grain (has kinetic privileges)

  // Eight neighbour directions. Index k is the angle (in 45° units) measured
  // from "down" (+y) toward "right" (+x).
  var DX = [0, 1, 1, 1, 0, -1, -1, -1];
  var DY = [1, 1, 0, -1, -1, -1, 0, 1];

  var STEP_HZ = 120;            // fixed physics rate
  var DT = 1 / STEP_HZ;

  // Particle kinds (upper bits of pinfo); lower two bits count bounces.
  var K_STREAM = 0, K_POUR = 4, K_SPLASH = 8, K_MASK = 12;

  var EV_CAP = 48;              // audio impact events kept per frame

  /* ======================================================================
   *  Vessel geometry — shared by the simulation and the renderer
   * ==================================================================== */

  /**
   * All lengths are in grid cells (one cell = one grain of sand).
   * `q` scales the whole vessel: 1.08 ≈ 17k grains (phones),
   * 1.3 ≈ 25k grains (tablets / desktop); up to 33k with added sand.
   */
  function makeGeometry(q) {
    q = q || 1;
    var R = Math.round(88 * q);          // max inner half-width of a bulb
    var HB = Math.round(206 * q);        // bulb height, neck centre → far end
    var RN = Math.round(3 * q) + 0.5;    // neck inner half-width (7 / 9 cells)
    var PAD = 8;
    var W = 2 * (R + PAD) + 1;           // odd → exact 180° symmetry
    var H = 2 * (HB + 4) + 1;            // odd → neck gate is the centre row
    return {
      q: q, R: R, HB: HB, RN: RN, W: W, H: H,
      cx: W / 2, cy: H / 2,
      gateY: (H - 1) / 2,
      equator: 0.66,                     // where the bulb is widest (0 = neck)
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
    var c = g.equator;
    if (u <= c) {
      var v = u / c;
      var e = Math.sin(Math.PI * 0.5 * Math.pow(v, 1.22));
      return g.RN + (g.R - g.RN) * e;
    }
    var w = (u - c) / (1 - c);
    return g.R * Math.sqrt(1 - Math.pow(w, 2.3));
  }

  /* ======================================================================
   *  Simulation
   * ==================================================================== */

  function Sim(opts) {
    opts = opts || {};
    var g = this.geo = makeGeometry(opts.scale || 1);
    var W = this.W = g.W, H = this.H = g.H, N = W * H;

    this.cell = new Uint8Array(N);       // EMPTY / WALL / REST / MOVE
    this.seed = new Uint8Array(N);       // persistent per-grain colour seed
    this.stamp = new Uint8Array(N);      // "already moved this step" marker
    this.rowAct = new Uint8Array(H);     // rows that still need CA sweeps (sleep map)
    this.nrmX = new Int8Array(N);        // glass surface normals (×127)
    this.nrmY = new Int8Array(N);
    this.rowMin = new Int16Array(H);     // interior span per row
    this.rowMax = new Int16Array(H);
    this.gateY = g.gateY;
    this.gateX0 = 0; this.gateX1 = -1;
    this.topY = 0;                       // first interior row of upper bulb

    // ballistic particles
    var PC = this.PCAP = 6144;
    this.px = new Float32Array(PC);
    this.py = new Float32Array(PC);
    this.pvx = new Float32Array(PC);
    this.pvy = new Float32Array(PC);
    this.pseed = new Uint8Array(PC);
    this.pinfo = new Uint8Array(PC);
    this.np = 0;

    // impact events for the audio engine (reset every frame)
    this.evX = new Float32Array(EV_CAP);   // -1 … +1 across the bulb
    this.evV = new Float32Array(EV_CAP);   // 0 … 1 normalised impact speed
    this.evK = new Uint8Array(EV_CAP);     // bit0: sand(1)/glass(0), bit1: upper bulb
    this.nev = 0;
    this.frame = {
      released: 0, impGlass: 0, impSand: 0, impTop: 0, moved: 0, slides: 0
    };

    // tunables -----------------------------------------------------------
    this.G = 3300;            // gravity, cells / s²  (slow-motion scale so the
                              // stream reads as individual accelerating grains)
    this.pDiag = 150;         // /256 chance per step of a 45° slide (also the
                              //   lateral diffusion of voids → drain funnel)
    this.pCreep = 72;         // /256 chance a *static* surface grain lets go
                              //   once the local slope exceeds 2:3 (≈33.7°)
    this.pSlide = 150;        // /256 chance a *moving* grain keeps running
                              //   down a shallower 1:2 slope (dynamic friction)
    this.pWake = 64;          // /256 chance a slide wakes its neighbours
                              //   (avalanche propagation)
    this.pRollStop = 3;       // /256 chance a rolling grain snags and stops
    this.focus = 9;           // stream self-focusing spring (1/s²)

    // state --------------------------------------------------------------
    this.angle = 0;           // rotation of the vessel (rad, clockwise)
    this.tilt = 0;            // extra gravity rotation from device tilt
    this.gx = 0; this.gy = 1;
    this.flipping = false;
    this.gateOpen = false;    // true while the timer runs
    this.deepRelease = false; // allow pulling the very last stragglers
    this.targetTop = 0;       // grains that should still be above the neck
    this.nTop = 0;            // grains above the neck (incl. airborne pour)
    this.total = 0;
    this.capacity = 0;        // interior cells in one bulb
    this.maxTotal = 0;
    this.tick = 0;
    this.steps = 0;
    this.quiet = 0;           // consecutive steps with nothing moving
    this.topSweeps = 0;       // extra CA sweeps of the upper bulb per step
    this.lag = 0;             // grains the neck still owes the clock
    this.rng = (opts.seed | 0) || 0x2F6E2B1;

    this._buildVessel();
    this.reset(opts.grains || this.defaultGrains);
  }

  Sim.STEP_HZ = STEP_HZ;
  Sim.DT = DT;

  /* ---------------------------------------------------------------- *
   *  Vessel rasterisation
   * ---------------------------------------------------------------- */
  Sim.prototype._buildVessel = function () {
    var g = this.geo, W = this.W, H = this.H, cell = this.cell;
    var x, y, i, cap = 0;
    this.topY = -1;
    for (y = 0; y < H; y++) {
      var u = Math.abs(y + 0.5 - g.cy) / g.HB;
      var r = profile(u, g);
      var mn = W, mx = -1;
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (Math.abs(x + 0.5 - g.cx) < r) {
          cell[i] = EMPTY;
          if (x < mn) mn = x;
          if (x > mx) mx = x;
        } else {
          cell[i] = WALL;
        }
      }
      if (y === this.gateY) {
        // The neck gate: a one-row valve the timer opens grain by grain.
        this.gateX0 = mn; this.gateX1 = mx;
        for (x = mn; x <= mx; x++) cell[y * W + x] = WALL;
        mn = W; mx = -1;
      }
      this.rowMin[y] = mn; this.rowMax[y] = mx;
      if (mx >= mn) {
        if (this.topY < 0) this.topY = y;
        if (y < this.gateY) cap += mx - mn + 1;
      }
    }
    this.capacity = cap;
    this.defaultGrains = Math.round(cap * 0.62);
    this.maxTotal = Math.round(cap * 0.82);

    // Surface normals for every wall cell that touches the interior
    // (used to bounce ballistic grains off the curved glass).
    var dx, dy;
    for (y = 2; y < H - 2; y++) {
      for (x = 2; x < W - 2; x++) {
        i = y * W + x;
        if (cell[i] !== WALL) continue;
        var sx = 0, sy = 0, n = 0;
        for (dy = -2; dy <= 2; dy++) {
          for (dx = -2; dx <= 2; dx++) {
            if (cell[i + dy * W + dx] !== WALL) { sx += dx; sy += dy; n++; }
          }
        }
        if (!n) continue;
        var len = Math.sqrt(sx * sx + sy * sy);
        if (len < 0.5) continue;
        this.nrmX[i] = Math.round(sx / len * 127);
        this.nrmY[i] = Math.round(sy / len * 127);
      }
    }
  };

  /* ---------------------------------------------------------------- *
   *  Random helpers (xorshift32)
   * ---------------------------------------------------------------- */
  Sim.prototype._rand = function () {
    var s = this.rng;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this.rng = s;
    return (s >>> 0) / 4294967296;
  };

  /* ---------------------------------------------------------------- *
   *  Fill / reset
   * ---------------------------------------------------------------- */

  /** Empty the vessel and settle `n` grains in the upper bulb. */
  Sim.prototype.reset = function (n) {
    var W = this.W, cell = this.cell, seed = this.seed;
    var i, x, y, N = W * this.H;
    for (i = 0; i < N; i++) if (cell[i] >= REST) cell[i] = EMPTY;
    this.np = 0;
    n = Math.max(0, Math.min(n | 0, this.maxTotal));
    var left = n;
    for (y = this.gateY - 1; y >= this.topY && left > 0; y--) {
      var x0 = this.rowMin[y], x1 = this.rowMax[y];
      if (x0 > x1) continue;
      var span = x1 - x0 + 1;
      if (span <= left) {
        for (x = x0; x <= x1; x++) {
          i = y * W + x; cell[i] = REST; seed[i] = (this._rand() * 256) | 0;
        }
        left -= span;
      } else {
        // last, partial row: a low, slightly irregular crown around the axis
        var c = (x0 + x1) >> 1, k = 0;
        while (left > 0 && k < span) {
          x = c + ((k & 1) ? -((k + 1) >> 1) : (k >> 1));
          k++;
          if (x < x0 || x > x1) continue;
          i = y * W + x; cell[i] = REST; seed[i] = (this._rand() * 256) | 0;
          left--;
        }
      }
    }
    this.rowAct.fill(2);
    this.total = n - left;
    this.nTop = this.total;
    this.targetTop = this.nTop;
    this.angle = 0;
    this.flipping = false;
    this.quiet = 0;
    this.nev = 0;
  };

  /* ---------------------------------------------------------------- *
   *  Per-frame bookkeeping
   * ---------------------------------------------------------------- */
  Sim.prototype.beginFrame = function () {
    var f = this.frame;
    f.released = 0; f.impGlass = 0; f.impSand = 0; f.impTop = 0;
    f.moved = 0; f.slides = 0;
    this.nev = 0;
  };

  Object.defineProperty(Sim.prototype, 'nBottom', {
    get: function () { return this.total - this.nTop; }
  });

  /** True while anything is still in motion (used to idle the render loop). */
  Sim.prototype.isActive = function () {
    return this.np > 0 || this.quiet < 24 || this.flipping;
  };

  /**
   * Sleep map. A settled pile costs nothing: the automaton only sweeps rows
   * near something that changed. Anything that edits the lattice from the
   * outside (deposits, the neck valve, splashes) wakes the rows around it.
   */
  Sim.prototype._touchRow = function (y) {
    var a = this.rowAct, y0 = y - 3, y1 = y + 3;
    if (y0 < 0) y0 = 0;
    if (y1 >= this.H) y1 = this.H - 1;
    for (; y0 <= y1; y0++) a[y0] = 2;
  };
  Sim.prototype.wakeAll = function () {
    this.rowAct.fill(2);
    this.quiet = 0;
  };

  /* ---------------------------------------------------------------- *
   *  One fixed physics step (1/120 s)
   * ---------------------------------------------------------------- */
  Sim.prototype.step = function () {
    var ang = this.angle + this.tilt;
    var gx = Math.sin(ang), gy = Math.cos(ang);
    this.gx = gx; this.gy = gy;

    // 1. Neck valve: let through exactly as many grains as the clock owes.
    //    If the neck is momentarily starved, reach a little higher up the
    //    funnel (and sweep the upper bulb harder) until it has caught up.
    var lag = 0;
    if (this.gateOpen && !this.flipping && gy > 0.7) {
      var need = this.nTop - this.targetTop;
      if (need > 0) {
        var rows = this.deepRelease ? (this.gateY - this.topY) : 3 + Math.min(need >> 3, 36);
        lag = need - this._release(need, rows);
      }
    }
    this.lag = lag;

    // 2. Packed + sliding sand. One sweep moves a grain one cell, so fast
    //    timers get extra sweeps of the upper bulb to keep the neck fed.
    var before = this.frame.moved;
    var H = this.H;
    if (this.flipping || gy < 0.7) {
      this._ca(gx, gy, 1, H - 1);
      this._ca(gx, gy, 1, H - 1);
    } else {
      this._ca(gx, gy, 1, H - 1);
      var extra = this.topSweeps + (lag > 10 ? 1 : 0) + (lag > 60 ? 2 : 0);
      while (extra-- > 0) this._ca(gx, gy, 1, this.gateY);
    }

    // 3. Free-falling grains.
    if (this.np) this._particles(gx, gy);

    if (this.frame.moved === before && this.np === 0) this.quiet++;
    else this.quiet = 0;
    this.steps++;
  };

  /* ---------------------------------------------------------------- *
   *  Neck release
   * ---------------------------------------------------------------- */
  Sim.prototype._release = function (need, maxRows) {
    var W = this.W, cell = this.cell, gy0 = this.gateY;
    var out = 0, r, k;
    for (r = 1; r <= maxRows && out < need; r++) {
      var y = gy0 - r;
      var x0 = this.rowMin[y], x1 = this.rowMax[y];
      if (x0 > x1) continue;
      var span = x1 - x0 + 1;
      var start = (this._rand() * span) | 0;
      for (k = 0; k < span && out < need; k++) {
        var x = x0 + ((start + k) % span);
        var i = y * W + x;
        if (cell[i] >= REST) {
          if (!this._spawnStream(x, this.seed[i])) { r = maxRows + 1; break; }
          cell[i] = EMPTY;
          out++;
        }
      }
      if (out) this._touchRow(y);
    }
    this.nTop -= out;
    this.frame.released += out;
    return out;
  };

  /** A grain leaves the orifice with the Beverloo exit speed ~ sqrt(g·D). */
  Sim.prototype._spawnStream = function (x, sd) {
    if (this.np >= this.PCAP) return false;
    if (x < this.gateX0 || x > this.gateX1) {
      x = this.gateX0 + ((this._rand() * (this.gateX1 - this.gateX0 + 1)) | 0);
    }
    var y = this.gateY + 1;
    if (this.cell[y * this.W + x] !== EMPTY) return false;   // lower bulb is full
    var p = this.np++;
    this.px[p] = x + 0.2 + this._rand() * 0.6;
    this.py[p] = y + 0.05 + this._rand() * 0.6;
    this.pvx[p] = (this._rand() - 0.5) * 26;
    this.pvy[p] = 118 + this._rand() * 64;
    this.pseed[p] = sd;
    this.pinfo[p] = K_STREAM;
    return true;
  };

  /* ---------------------------------------------------------------- *
   *  Pour fresh sand into the upper bulb
   * ---------------------------------------------------------------- */
  Sim.prototype.pour = function (n) {
    var W = this.W, g = this.geo, made = 0;
    var y0 = this.topY + 3;
    while (made < n) {
      if (this.total >= this.maxTotal || this.np >= this.PCAP) break;
      var x = g.cx + (this._rand() - 0.5) * 5.5;
      var y = y0 + this._rand() * 3;
      if (this.cell[(y | 0) * W + (x | 0)] !== EMPTY) break;    // bulb is brim-full
      var p = this.np++;
      this.px[p] = x; this.py[p] = y;
      this.pvx[p] = (this._rand() - 0.5) * 30;
      this.pvy[p] = 70 + this._rand() * 70;
      this.pseed[p] = (this._rand() * 256) | 0;
      this.pinfo[p] = K_POUR;
      this.total++; this.nTop++;
      made++;
    }
    return made;
  };

  /* ---------------------------------------------------------------- *
   *  Cellular automaton: static / sliding grains under any gravity
   * ---------------------------------------------------------------- */
  Sim.prototype._ca = function (gx, gy, yLo, yHi) {
    var W = this.W;
    var cell = this.cell, seed = this.seed, stamp = this.stamp;
    var rowMin = this.rowMin, rowMax = this.rowMax;
    var tick = this.tick = (this.tick % 250) + 1;   // one stamp per sweep
    var s = this.rng | 0;
    var pDiag = this.pDiag, pSlide = this.pSlide, pWake = this.pWake, pCreep = this.pCreep;

    // Gravity rarely lines up with the lattice. Dither between the two
    // nearest lattice directions so the mean drift follows the true vector.
    var a8 = Math.atan2(gx, gy) / (Math.PI / 4);
    var k0 = Math.floor(a8), frac = a8 - k0, dith = 0;
    if (frac > 0.985) k0 += 1;
    else if (frac > 0.015) dith = (frac * 256) | 0;
    var kA = ((k0 % 8) + 8) % 8, kB = (kA + 1) & 7;

    var aM = DX[kA] + DY[kA] * W;
    var aL = DX[(kA + 7) & 7] + DY[(kA + 7) & 7] * W;
    var aR = DX[(kA + 1) & 7] + DY[(kA + 1) & 7] * W;
    var aSL = DX[(kA + 6) & 7] + DY[(kA + 6) & 7] * W;
    var aSR = DX[(kA + 2) & 7] + DY[(kA + 2) & 7] * W;
    var bM = DX[kB] + DY[kB] * W;
    var bL = DX[(kB + 7) & 7] + DY[(kB + 7) & 7] * W;
    var bR = DX[(kB + 1) & 7] + DY[(kB + 1) & 7] * W;
    var bSL = DX[(kB + 6) & 7] + DY[(kB + 6) & 7] * W;
    var bSR = DX[(kB + 2) & 7] + DY[(kB + 2) & 7] * W;

    // Visit downstream cells first so a void can travel a whole column in
    // one step; randomise the row direction to kill left/right bias.
    var y, yEnd, yStep;
    if (gy >= 0) { y = yHi - 1; yEnd = yLo - 1; yStep = -1; }
    else { y = yLo; yEnd = yHi; yStep = 1; }
    var fixedX = gx > 0.35 ? -1 : (gx < -0.35 ? 1 : 0);

    var moved = 0, slides = 0, pending = 0, mark, k;
    var m, l, r, sl, sr, i, j, c, cj, cl, cr, t, x, n, xs, base, x0, x1, okL, okR, p;

    // Sleeping rows are skipped while the vessel is upright and gravity sits
    // on the lattice; a full sweep every 64 steps is the safety net.
    var act = this.rowAct;
    var full = this.flipping || gy < 0.7 || dith !== 0 || kA !== 0 || (this.steps & 63) === 0;
    var Hm = this.H - 1;

    for (; y !== yEnd; y += yStep) {
      x0 = rowMin[y]; x1 = rowMax[y];
      if (x0 > x1) continue;
      if (!full) {
        if (act[y] === 0) continue;
        act[y]--;
      }
      mark = moved + pending;
      xs = fixedX;
      if (xs === 0) {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        xs = (s & 4) ? 1 : -1;
      }
      x = xs > 0 ? x0 : x1;
      base = y * W;
      for (n = x1 - x0 + 1; n > 0; n--, x += xs) {
        i = base + x;
        c = cell[i];
        if (c < REST) continue;
        if (stamp[i] === tick) continue;

        if (dith) {
          s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
          if ((s & 255) < dith) { m = bM; l = bL; r = bR; sl = bSL; sr = bSR; }
          else { m = aM; l = aL; r = aR; sl = aSL; sr = aSR; }
        } else { m = aM; l = aL; r = aR; sl = aSL; sr = aSR; }

        // --- free fall ---------------------------------------------------
        j = i + m; cj = cell[j];
        if (cj === EMPTY) {
          cell[j] = MOVE; seed[j] = seed[i]; stamp[j] = tick; cell[i] = EMPTY;
          moved++;
          continue;
        }

        // --- 45° slide (static friction limit) ---------------------------
        cl = cell[i + l]; cr = cell[i + r];
        if (cl === EMPTY || cr === EMPTY) {
          s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
          if ((s & 255) < pDiag) {
            t = (cl === EMPTY && cr === EMPTY) ? ((s & 256) ? l : r)
                                              : (cl === EMPTY ? l : r);
            j = i + t;
            cell[j] = MOVE; seed[j] = seed[i]; stamp[j] = tick; cell[i] = EMPTY;
            moved++; slides++;
            // avalanche propagation: disturb what was leaning on this grain
            if (((s >>> 9) & 255) < pWake) {
              if (cell[i + sl] === REST) cell[i + sl] = MOVE;
              if (cell[i + sr] === REST) cell[i + sr] = MOVE;
              if (cell[j + m] === REST) cell[j + m] = MOVE;
            }
          } else {
            if (c === REST) cell[i] = MOVE; // stay awake, try again next step
            pending++;
          }
          continue;
        }

        // --- surface creep (static vs. dynamic friction) -----------------
        // A static grain holds until the slope measured over three columns
        // exceeds 2:3 (≈33.7°, the angle of repose). A grain that is already
        // moving — or one resting on smooth glass — keeps running on slopes
        // as shallow as 1:2. The pile therefore breathes between the two
        // angles in small avalanches instead of stacking in 45° stairs.
        okL = cell[i + sl] === EMPTY && cell[i + sl + l] === EMPTY;
        okR = cell[i + sr] === EMPTY && cell[i + sr + r] === EMPTY;
        if (okL || okR) {
          if (cj === WALL) p = 256;
          else if (c === MOVE) p = pSlide;
          else {
            okL = okL && cell[i + sl + l + l] === EMPTY;
            okR = okR && cell[i + sr + r + r] === EMPTY;
            p = pCreep;
          }
          if (okL || okR) {
            s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
            if ((s & 255) < p) {
              t = (okL && okR) ? ((s & 256) ? sl : sr) : (okL ? sl : sr);
              j = i + t;
              cell[j] = MOVE; seed[j] = seed[i]; stamp[j] = tick; cell[i] = EMPTY;
              moved++; slides++;
              if (((s >>> 9) & 255) < pWake) {
                if (cell[i - t] === REST) cell[i - t] = MOVE;     // the grain uphill
              }
              continue;
            }
            pending++;                      // could have gone: look again
          }
        }
        if (c === MOVE) cell[i] = REST;
      }
      if (moved + pending !== mark) {
        // something happened here: keep the neighbourhood awake
        k = y - 3; if (k < 0) k = 0;
        n = y + 3; if (n > Hm) n = Hm;
        for (; k <= n; k++) act[k] = 2;
      }
    }
    this.rng = s || 0x9E3779B9;
    this.frame.moved += moved;
    this.frame.slides += slides;
  };

  /* ---------------------------------------------------------------- *
   *  Ballistic grains: v = v0 + g·Δt, sub-pixel positions, restitution
   * ---------------------------------------------------------------- */
  Sim.prototype._particles = function (gx, gy) {
    var W = this.W, cell = this.cell;
    var px = this.px, py = this.py, pvx = this.pvx, pvy = this.pvy;
    var pinfo = this.pinfo;
    var G = this.G, ax = gx * G * DT, ay = gy * G * DT;
    var cx = this.geo.cx, gateY = this.gateY;
    var upright = !this.flipping && gy > 0.9;
    var focus = upright ? this.focus : 0;
    var s = this.rng | 0;
    var f = this.frame;
    var vRef = Math.sqrt(2 * G * this.geo.HB);   // speed after a full-bulb fall
    // lattice frame nearest to gravity (for rolling on the pile surface)
    var kg = Math.round(Math.atan2(gx, gy) / (Math.PI / 4));
    kg = ((kg % 8) + 8) % 8;
    var oM = DX[kg] + DY[kg] * W;
    var oL = DX[(kg + 7) & 7] + DY[(kg + 7) & 7] * W;
    var oR = DX[(kg + 1) & 7] + DY[(kg + 1) & 7] * W;
    var oSL = DX[(kg + 6) & 7] + DY[(kg + 6) & 7] * W;
    var oSR = DX[(kg + 2) & 7] + DY[(kg + 2) & 7] * W;
    var pRollStop = this.pRollStop;

    for (var p = this.np - 1; p >= 0; p--) {
      var x = px[p], y = py[p];
      var vx = pvx[p] + ax, vy = pvy[p] + ay;
      var info = pinfo[p];

      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      if (focus && (info & K_MASK) === K_STREAM) {
        // By continuity an accelerating stream necks down: a soft, damped
        // pull toward the axis reproduces that narrowing.
        vx += (-(x - cx) * focus * 3.2 - vx * 3.0) * DT;
      }
      // aerodynamic micro-jitter
      vx += ((s & 1023) - 511.5) * 0.011;
      vy += (((s >>> 10) & 1023) - 511.5) * 0.004;

      var ddx = vx * DT, ddy = vy * DT;
      var adx = ddx < 0 ? -ddx : ddx, ady = ddy < 0 ? -ddy : ddy;
      var steps = Math.ceil(adx > ady ? adx : ady);
      if (steps < 1) steps = 1;
      var lx = x, ly = y, hit = -1, k, tx, ty, ci;
      for (k = 1; k <= steps; k++) {
        tx = x + ddx * k / steps; ty = y + ddy * k / steps;
        ci = (ty | 0) * W + (tx | 0);
        if (cell[ci] !== EMPTY) { hit = ci; break; }
        lx = tx; ly = ty;
      }
      if (hit < 0) {
        px[p] = lx; py[p] = ly; pvx[p] = vx; pvy[p] = vy;
        continue;
      }

      // ---- impact -------------------------------------------------------
      var sp = Math.sqrt(vx * vx + vy * vy);
      var onGlass = cell[hit] === WALL;
      var top = ly < gateY;
      var bounces = info & 3;
      if (sp > 45 && bounces === 0) {
        if (top) f.impTop++;
        else if (onGlass) f.impGlass++;
        else f.impSand++;
        if (this.nev < EV_CAP) {
          var e = this.nev++;
          this.evX[e] = (lx - cx) / this.geo.R;
          this.evV[e] = sp / vRef > 1 ? 1 : sp / vRef;
          this.evK[e] = (onGlass ? 0 : 1) | (top ? 2 : 0);
        }
      }

      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      var r1 = (s & 1023) / 1023, r2 = ((s >>> 10) & 1023) / 1023;
      var settle = false;

      if (onGlass) {
        // restitution off the curved glass
        var nx = this.nrmX[hit] / 127, ny = this.nrmY[hit] / 127;
        if (nx === 0 && ny === 0 && sp > 0) { nx = -vx / sp; ny = -vy / sp; }
        var vn = vx * nx + vy * ny;
        if (vn < 0) {
          var rest = 0.16 + r1 * 0.2;
          vx -= (1 + rest) * vn * nx; vy -= (1 + rest) * vn * ny;
          vx *= 0.8; vy *= 0.8;
          vx += (r2 - 0.5) * sp * 0.18;
        }
        bounces++;
        if (bounces > 3 || sp < 70) settle = true;
      } else if (bounces < 2 && sp > 210 && r1 < 0.42) {
        // kinetic splash: a 2–5 cell hop off the sand before settling
        var hop = sp * (0.07 + r2 * 0.1);
        if (hop > 185) hop = 185;
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        var lat = ((s & 1023) / 511.5 - 1) * hop * 0.95;
        vx = -gx * hop + gy * lat;
        vy = -gy * hop - gx * lat;
        bounces++;
        info = (info & 3) | K_SPLASH;
        if (cell[hit] === REST) { cell[hit] = MOVE; this._touchRow((hit / W) | 0); }   // the struck grain stirs
      } else {
        // Landed on sand. If the surface here is steeper than the angle of
        // repose (drop ≥ 2 over a run of 3 ≈ 33.7°) the grain keeps tumbling
        // downslope in short ballistic hops; otherwise it comes to rest.
        var li = (ly | 0) * W + (lx | 0);
        // Another grain may have settled into this very cell during the
        // step. Rise to the true surface first, so grains never stack into
        // a tower: on top of a fresh column the slope test below fails and
        // the grain rolls away instead.
        if (cell[li] !== EMPTY) {
          li = this._freeNear(li, oM);
          if (li >= 0) { lx = (li % W) + 0.5; ly = ((li / W) | 0) + 0.5; }
        }
        if (li < 0) {
          vx = 0; vy = 0;                                  // buried: wait
        } else {
          var rollL = cell[li + oSL] === EMPTY &&
            (cell[li + oL] === EMPTY || (cell[li + oSL + oL] === EMPTY && cell[li + oSL + oL + oL] === EMPTY));
          var rollR = cell[li + oSR] === EMPTY &&
            (cell[li + oR] === EMPTY || (cell[li + oSR + oR] === EMPTY && cell[li + oSR + oR + oR] === EMPTY));
          if ((rollL || rollR) && ((s >>> 20) & 255) >= pRollStop) {
            // keep rolling the way it is already heading when possible
            var side = gy * vx - gx * vy;                  // lateral velocity
            var dir = (rollL && rollR) ? (side < 0 ? -1 : (side > 0 ? 1 : (r1 < 0.5 ? -1 : 1)))
                                       : (rollL ? -1 : 1);
            var run = 70 + r1 * 95, lift = 22 + r2 * 46;
            vx = gy * run * dir - gx * lift;
            vy = -gx * run * dir - gy * lift;
            if (bounces < 1) bounces = 1;
          } else {
            settle = true;
          }
        }
      }

      if (settle) {
        if (this._deposit(lx, ly, this.pseed[p], gx, gy)) {
          // swap-remove
          var last = --this.np;
          if (p !== last) {
            px[p] = px[last]; py[p] = py[last]; pvx[p] = pvx[last]; pvy[p] = pvy[last];
            this.pseed[p] = this.pseed[last]; pinfo[p] = pinfo[last];
          }
          continue;
        }
        vx = 0; vy = 0;                                   // retry next step
      }
      px[p] = lx; py[p] = ly; pvx[p] = vx; pvy[p] = vy;
      pinfo[p] = (info & K_MASK) | (bounces > 3 ? 3 : bounces);
    }
    this.rng = s || 0x9E3779B9;
  };

  /** Hand a ballistic grain back to the lattice as a moving grain. */
  Sim.prototype._deposit = function (x, y, sd, gx, gy) {
    var W = this.W, cell = this.cell;
    var i = (y | 0) * W + (x | 0);
    // lattice direction closest to gravity
    var k = Math.round(Math.atan2(gx, gy) / (Math.PI / 4));
    k = ((k % 8) + 8) % 8;
    var m = DX[k] + DY[k] * W;
    if (cell[i] !== EMPTY) {               // cell taken this very step
      i = this._freeNear(i, m);
      if (i < 0) return false;
    }
    cell[i] = MOVE; this.seed[i] = sd;
    this._touchRow((i / W) | 0);
    // the impact shakes the grains it lands on → triggers mini-avalanches
    var l = DX[(k + 7) & 7] + DY[(k + 7) & 7] * W;
    var r = DX[(k + 1) & 7] + DY[(k + 1) & 7] * W;
    if (cell[i + m] === REST) cell[i + m] = MOVE;
    if (cell[i + l] === REST) cell[i + l] = MOVE;
    if (cell[i + r] === REST) cell[i + r] = MOVE;
    return true;
  };

  /**
   * Nearest free cell to `i`: first straight up through the sand (against
   * gravity, lattice offset `m`), then in widening rings. -1 if none.
   */
  Sim.prototype._freeNear = function (i, m) {
    var cell = this.cell, W = this.W, j = i, n = 0, N = cell.length;
    while (cell[j] >= REST && n < 14) { j -= m; n++; }
    if (cell[j] === EMPTY) return j;
    for (var r = 1; r <= 8; r++) {
      for (var dy = -r; dy <= r; dy++) {
        var row = i + dy * W;
        if (row < W || row >= N - W) continue;
        var st = (dy === -r || dy === r) ? 1 : 2 * r;
        for (var dx = -r; dx <= r; dx += st) {
          if (cell[row + dx] === EMPTY) return row + dx;
        }
      }
    }
    return -1;
  };

  /**
   * Bulk deposit (no flight): drop a grain at (x, y) and walk it downhill
   * until the local slope is below the angle of repose (2:3).
   */
  Sim.prototype._settleAt = function (x, y, sd) {
    var W = this.W, cell = this.cell, i = y * W + x, n = 0, L, R;
    while (n++ < 500) {
      while (cell[i + W] === EMPTY) i += W;
      L = cell[i - 1] === EMPTY &&
        (cell[i + W - 1] === EMPTY || (cell[i + W - 2] === EMPTY && cell[i + 2 * W - 3] === EMPTY));
      R = cell[i + 1] === EMPTY &&
        (cell[i + W + 1] === EMPTY || (cell[i + W + 2] === EMPTY && cell[i + 2 * W + 3] === EMPTY));
      if (!L && !R) break;
      i += (L && R) ? (this._rand() < 0.5 ? -1 : 1) : (L ? -1 : 1);
    }
    cell[i] = REST; this.seed[i] = sd;
  };

  /* ---------------------------------------------------------------- *
   *  Flip: once the vessel has turned 180°, re-index the lattice so the
   *  simulation is upright again. The vessel is exactly point-symmetric,
   *  so reversing the arrays *is* the rotation.
   * ---------------------------------------------------------------- */
  Sim.prototype.completeFlip = function () {
    this.cell.reverse();
    this.seed.reverse();
    var W = this.W, H = this.H;
    for (var p = 0; p < this.np; p++) {
      this.px[p] = W - this.px[p]; this.py[p] = H - this.py[p];
      if (this.px[p] >= W) this.px[p] = W - 0.001;
      if (this.py[p] >= H) this.py[p] = H - 0.001;
      this.pvx[p] = -this.pvx[p]; this.pvy[p] = -this.pvy[p];
    }
    this.nTop = this.total - this.nTop;
    this.angle = 0;
    this.flipping = false;
    this.wakeAll();
  };

  /* ---------------------------------------------------------------- *
   *  Fast-forward: the tab was hidden and the clock ran on. Move `n`
   *  grains through the neck in bulk (no per-grain flight) and relax.
   * ---------------------------------------------------------------- */
  Sim.prototype.fastForward = function (n) {
    var W = this.W, cell = this.cell, seed = this.seed;
    var gy0 = this.gateY, below = (gy0 + 1) * W, moved = 0, guard = 0;
    var span = this.gateX1 - this.gateX0 + 1;
    this.gx = 0; this.gy = 1;
    while (moved < n && guard++ < 4000) {
      var batch = Math.min(n - moved, 120), got = 0;
      for (var r = 1; r <= gy0 - this.topY && got < batch; r++) {
        var y = gy0 - r, x0 = this.rowMin[y], x1 = this.rowMax[y];
        for (var x = x0; x <= x1 && got < batch; x++) {
          var i = y * W + x;
          if (cell[i] < REST) continue;
          var tx = this.gateX0 + ((this._rand() * span) | 0);
          if (cell[below + tx] !== EMPTY) { guard = 1e9; got = batch; break; }   // full
          var sd = seed[i];
          cell[i] = EMPTY;
          this._touchRow(y);
          this._settleAt(tx, gy0 + 1, sd);
          got++; moved++;
        }
      }
      if (!got) break;
      this._ca(0, 1, 1, gy0);              // let the upper funnel follow
      this._ca(0, 1, 1, gy0);
    }
    this.nTop -= moved;
    this.wakeAll();
    return moved;
  };

  /* ---------------------------------------------------------------- *
   *  Diagnostics (used by the test-suite; cheap enough to keep)
   * ---------------------------------------------------------------- */
  Sim.prototype.census = function () {
    var W = this.W, cell = this.cell, top = 0, bottom = 0, i, N = W * this.H;
    var gate = this.gateY * W;
    for (i = 0; i < N; i++) if (cell[i] >= REST) { if (i < gate) top++; else bottom++; }
    for (var p = 0; p < this.np; p++) { if (this.py[p] < this.gateY) top++; else bottom++; }
    return { top: top, bottom: bottom, total: top + bottom };
  };

  /* ======================================================================
   *  Themes
   * ==================================================================== */

  var THEMES = {
    sahara: {
      id: 'sahara',
      name: 'Sahara Quartz & Walnut',
      short: 'Sahara Quartz',
      sand: {
        h: 36, s: 0.62, l: 0.61, dh: 6, dl: 0.085,
        dark: { p: 0.045, h: 22, s: 0.50, l: 0.36 },    // iron-stained grains
        alt: { p: 0.11, h: 30, s: 0.70, l: 0.54 },       // amber grains
        mica: { p: 0.05, h: 46, s: 0.40, l: 0.90 }       // mica glints
      },
      glint: [255, 247, 224],
      glass: { tint: [255, 233, 204], smoke: 0.10 },
      cap: { kind: 'wood', hi: [112, 70, 42], mid: [70, 41, 23], lo: [30, 17, 9] },
      glow: [255, 176, 92]
    },
    volcanic: {
      id: 'volcanic',
      name: 'Volcanic Black & Brushed Brass',
      short: 'Volcanic Black',
      sand: {
        h: 236, s: 0.11, l: 0.255, dh: 20, dl: 0.06,
        dark: { p: 0.10, h: 240, s: 0.10, l: 0.15 },
        alt: { p: 0.12, h: 262, s: 0.30, l: 0.37 },      // iridescent basalt
        mica: { p: 0.07, h: 44, s: 0.82, l: 0.62 }       // gold flecks
      },
      glint: [255, 222, 140],
      glass: { tint: [214, 206, 196], smoke: 0.30 },
      cap: { kind: 'brass', hi: [236, 208, 132], mid: [176, 142, 70], lo: [84, 64, 24] },
      glow: [214, 164, 78]
    },
    moonstone: {
      id: 'moonstone',
      name: 'Moonstone & Frosted Silver',
      short: 'Moonstone',
      sand: {
        h: 44, s: 0.14, l: 0.83, dh: 10, dl: 0.07,
        dark: { p: 0.06, h: 220, s: 0.12, l: 0.62 },
        alt: { p: 0.14, h: 208, s: 0.34, l: 0.82 },      // blue adularescence
        mica: { p: 0.06, h: 200, s: 0.20, l: 0.98 }
      },
      glint: [255, 255, 255],
      glass: { tint: [214, 232, 255], smoke: 0.07 },
      cap: { kind: 'silver', hi: [236, 240, 245], mid: [160, 166, 176], lo: [72, 77, 86] },
      glow: [168, 196, 235]
    }
  };

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s < 0) s = 0; if (s > 1) s = 1;
    if (l < 0) l = 0; if (l > 1) l = 1;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  function hash01(n) {
    n = Math.imul(n ^ 0x9E3779B9, 0x85EBCA6B);
    n ^= n >>> 13; n = Math.imul(n, 0xC2B2AE35); n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /* ======================================================================
   *  Renderer
   * ==================================================================== */

  var LEVELS = 32;      // shading levels per grain colour
  var SUB = 2;          // each grain is drawn as a lit 2×2 bead

  /**
   * @param sim   Sim
   * @param els   { back, sand, front, light } canvases
   *              back / sand / front rotate with the vessel,
   *              light (speculars, caustics) stays fixed in the room.
   */
  function Renderer(sim, els) {
    this.sim = sim;
    this.els = els;
    var W = sim.W, H = sim.H;
    this.BW = W * SUB; this.BH = H * SUB;
    els.sand.width = this.BW; els.sand.height = this.BH;
    this.sctx = els.sand.getContext('2d');
    this.img = this.sctx.createImageData(this.BW, this.BH);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.depth = new Uint8Array(W);
    this.lut = new Uint32Array(LEVELS * 256);
    this.isMica = new Uint8Array(256);
    // Each grain is a tiny faceted bead: which corner catches the light is
    // part of its persistent seed, so packed sand never looks like a grid.
    this.hiOff = new Uint16Array(256);
    this.loOff = new Uint16Array(256);
    for (var sd = 0; sd < 256; sd++) {
      var o = (hash01(sd * 3 + 17) * 4) | 0;           // 0,1 → top-left, 2 → top-right, 3 → bottom-left
      var hiP = o < 2 ? 0 : (o === 2 ? 1 : this.BW);
      this.hiOff[sd] = hiP;
      this.loOff[sd] = this.BW + 1 - hiP;
    }
    this.glintColor = 0xFFFFFFFF;
    this.baseLevel = new Uint8Array(W * H);
    this.aoTab = new Uint8Array(256);
    this.frameNo = 0;
    this.theme = THEMES.sahara;
    this.scale = 1;       // CSS px per cell
    this.dpr = 1;
    this._buildLightMap();
    this._buildLUT();
  }

  /** Cylinder shading baked per cell + ambient-occlusion ramp by depth. */
  Renderer.prototype._buildLightMap = function () {
    var sim = this.sim, g = sim.geo, W = sim.W, H = sim.H, x, y;
    for (y = 0; y < H; y++) {
      var u = Math.abs(y + 0.5 - g.cy) / g.HB;
      var r = profile(u, g);
      for (x = 0; x < W; x++) {
        var t = r > 0.5 ? Math.abs(x + 0.5 - g.cx) / r : 0;
        if (t > 1) t = 1;
        // bright core, falling off toward the glass like a lit cylinder
        var lv = 22.5 - 8.5 * t * t * t - 1.5 * t;
        this.baseLevel[y * W + x] = Math.max(12, Math.min(24, Math.round(lv)));
      }
    }
    // depth 1 = exposed surface grain (lit), deeper = occluded
    for (var d = 0; d < 256; d++) {
      var ao;
      if (d <= 1) ao = -3; else if (d === 2) ao = -1;
      else ao = Math.min(8, Math.round((d - 2) * 0.55));
      this.aoTab[d] = ao + 3;        // stored with +3 bias (0 … 11)
    }
  };

  /** Per-grain colour table: 256 persistent seeds × 32 light levels. */
  Renderer.prototype._buildLUT = function () {
    var th = this.theme, sd = th.sand, lut = this.lut;
    var darkN = Math.round(sd.dark.p * 256);
    var micaN = Math.round(sd.mica.p * 256);
    var altN = Math.round(sd.alt.p * 256);
    for (var s = 0; s < 256; s++) {
      var u1 = hash01(s * 7 + 1), u2 = hash01(s * 13 + 5), u3 = hash01(s * 29 + 11);
      var base, mica = 0;
      if (s < darkN) {
        base = hsl(sd.dark.h + (u1 - 0.5) * 10, sd.dark.s, sd.dark.l + (u2 - 0.5) * 0.08);
      } else if (s >= 256 - micaN) {
        base = hsl(sd.mica.h + (u1 - 0.5) * 14, sd.mica.s, sd.mica.l - u2 * 0.08);
        mica = 1;
      } else if (s >= 256 - micaN - altN) {
        base = hsl(sd.alt.h + (u1 - 0.5) * sd.dh * 2.4, sd.alt.s, sd.alt.l + (u2 - 0.5) * sd.dl);
      } else {
        base = hsl(sd.h + (u1 - 0.5) * 2 * sd.dh,
                   sd.s + (u3 - 0.5) * 0.16,
                   sd.l + (u2 - 0.5) * 2 * sd.dl);
      }
      this.isMica[s] = mica;
      for (var lv = 0; lv < LEVELS; lv++) {
        var m = 0.34 + lv * 0.031;                     // 0.34 … 1.30
        var r = base[0] * m, g = base[1] * m, b = base[2] * m;
        if (m > 1) {                                   // push highlights to white
          var w = (m - 1) * 0.9;
          r += (255 - r) * w; g += (255 - g) * w; b += (255 - b) * w;
        }
        r = r > 255 ? 255 : r | 0; g = g > 255 ? 255 : g | 0; b = b > 255 ? 255 : b | 0;
        lut[(lv << 8) | s] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }
    var gl = th.glint;
    this.glintColor = ((255 << 24) | (gl[2] << 16) | (gl[1] << 8) | gl[0]) >>> 0;
  };

  Renderer.prototype.setTheme = function (id) {
    this.theme = THEMES[id] || THEMES.sahara;
    this._buildLUT();
    this.drawStatic();
  };

  /**
   * Fit the assembly into a box (CSS px) and size every canvas.
   * Returns { width, height, scale } in CSS px.
   */
  Renderer.prototype.layout = function (boxW, boxH, dpr) {
    var g = this.sim.geo, els = this.els;
    var s = Math.min(boxW / g.AW, boxH / g.AH);
    if (!(s > 0)) s = 1;
    var cssW = Math.round(g.AW * s), cssH = Math.round(g.AH * s);
    dpr = Math.max(1, Math.min(dpr || 1, 3));
    // keep the static layers within a sane memory budget
    while (cssW * dpr * cssH * dpr > 4.2e6 && dpr > 1) dpr -= 0.25;
    this.scale = s; this.dpr = dpr;
    var names = ['back', 'front', 'light'];
    for (var i = 0; i < names.length; i++) {
      var c = els[names[i]];
      c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    }
    var sc = els.sand;
    sc.style.width = (this.sim.W * s) + 'px';
    sc.style.height = (this.sim.H * s) + 'px';
    sc.style.left = ((g.AW - this.sim.W) / 2 * s) + 'px';
    sc.style.top = ((g.AH - this.sim.H) / 2 * s) + 'px';
    this.cssW = cssW; this.cssH = cssH;
    this.drawStatic();
    return { width: cssW, height: cssH, scale: s };
  };

  /* ---------------------------------------------------------------- *
   *  Sand: one lit bead per simulated grain
   * ---------------------------------------------------------------- */
  Renderer.prototype.drawSand = function () {
    var sim = this.sim, W = sim.W, H = sim.H, BW = this.BW;
    var cell = sim.cell, seed = sim.seed, buf = this.buf, lut = this.lut;
    var base = this.baseLevel, ao = this.aoTab, depth = this.depth;
    var isMica = this.isMica, glint = this.glintColor;
    var hiOff = this.hiOff, loOff = this.loOff;
    var rowMin = sim.rowMin, rowMax = sim.rowMax, gateY = sim.gateY;
    var fr = ++this.frameNo;
    var up = sim.gy < 0;                 // vessel currently upside-down?
    var y, x, i, c, s, d, lv, bi, x0, x1, hi, lo, mid, h;

    buf.fill(0);
    depth.fill(0);

    var yS = up ? H - 1 : 0, yE = up ? -1 : H, yD = up ? -1 : 1;
    for (y = yS; y !== yE; y += yD) {
      if (y === gateY) { depth.fill(0); continue; }
      x0 = rowMin[y]; x1 = rowMax[y];
      if (x0 > x1) continue;
      i = y * W + x0;
      bi = (y * SUB) * BW + x0 * SUB;
      for (x = x0; x <= x1; x++, i++, bi += SUB) {
        c = cell[i];
        if (c < REST) { depth[x] = 0; continue; }
        d = depth[x]; if (d < 255) depth[x] = ++d;
        s = seed[i];
        lv = base[i] - ao[d] + 3;
        if (c === MOVE) lv++;
        if (isMica[s]) {
          // mica flashes when it tumbles and twinkles slowly at the surface
          h = Math.imul(i ^ (c === MOVE ? fr : fr >> 4), 0x9E3779B1) >>> 0;
          if (c === MOVE ? (h >>> 30) === 0 : (d < 3 && (h >>> 27) === 0)) {
            buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = glint;
            continue;
          }
        }
        hi = lut[((lv + 3) << 8) | s];
        mid = lut[(lv << 8) | s];
        lo = lut[((lv - 3) << 8) | s];
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = mid;
        if (up) { buf[bi + loOff[s]] = hi; buf[bi + hiOff[s]] = lo; }
        else { buf[bi + hiOff[s]] = hi; buf[bi + loOff[s]] = lo; }
      }
    }

    // Free-falling grains: sub-cell position plus a short velocity streak.
    var np = sim.np, px = sim.px, py = sim.py, pvx = sim.pvx, pvy = sim.pvy, ps = sim.pseed;
    var BH = this.BH, N = BW * BH;
    for (var p = 0; p < np; p++) {
      var fx = px[p] * SUB, fy = py[p] * SUB;
      var ix = fx | 0, iy = fy | 0;
      if (ix < 1 || iy < 1 || ix >= BW - 2 || iy >= BH - 2) continue;
      s = ps[p];
      var col;
      h = Math.imul((p * 31 + fr) ^ s, 0x9E3779B1) >>> 0;
      if (isMica[s] && (h >>> 30) < 2) col = glint;
      else col = lut[((24 + (h >>> 30)) << 8) | s];
      var vx = pvx[p], vy = pvy[p];
      var sp = Math.sqrt(vx * vx + vy * vy);
      var len = sp * SUB / 60 * 0.9;         // streak ≈ one frame of travel
      if (len > 20) len = 20;
      if (len >= 1.5) {
        var ux = -vx / sp, uy = -vy / sp, rgb = col & 0x00FFFFFF;
        for (var k = 1; k <= len; k++) {
          var qx = (fx + ux * (k + 0.5)) | 0, qy = (fy + uy * (k + 0.5)) | 0;
          var qi = qy * BW + qx;
          if (qi < 0 || qi >= N || buf[qi] !== 0) continue;
          var a = (150 * (1 - k / (len + 1)) * (1 - k / (len + 1))) | 0;
          buf[qi] = ((a << 24) | rgb) >>> 0;
          if (k < 3) buf[qi + 1] = buf[qi];
        }
      }
      bi = iy * BW + ix;
      buf[bi] = buf[bi + 1] = col;
      buf[bi + BW] = buf[bi + BW + 1] = col;
    }

    this.sctx.putImageData(this.img, 0, 0);
  };

  /* ---------------------------------------------------------------- *
   *  Static layers
   * ---------------------------------------------------------------- */

  /**
   * Closed outline of the whole vessel, pushed outward by `grow` cells.
   * `path` is a Path2D or a 2D context (call beginPath() first).
   */
  function tracePathTo(path, g, grow) {
    var n = 200, k, u, r, a, pts = [];
    var ky = (g.HB + grow) / g.HB;
    for (k = 0; k <= n; k++) {                       // right side, tip → neck
      a = k / n;
      u = 1 - (0.45 * a * (2 - a) + 0.55 * a);       // denser near the dome tip
      r = profile(u, g) + grow;
      pts.push([r, -u * g.HB * ky]);
    }
    for (k = n - 1; k >= 0; k--) pts.push([pts[k][0], -pts[k][1]]);
    path.moveTo(pts[0][0], pts[0][1]);
    for (k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]);
    for (k = pts.length - 1; k >= 0; k--) path.lineTo(-pts[k][0], pts[k][1]);
    path.closePath();
  }
  function tracePath(ctx, g, grow) {
    ctx.beginPath();
    tracePathTo(ctx, g, grow);
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  Renderer.prototype._ctx = function (name) {
    var c = this.els[name], ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    var S = this.scale * this.dpr;
    ctx.setTransform(S, 0, 0, S, c.width / 2, c.height / 2);   // cells, centred
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    return ctx;
  };

  Renderer.prototype.drawStatic = function () {
    if (!this.cssW) return;
    this._drawBack();
    this._drawFront();
    this._drawLight();
  };

  /** Material ramp across a turned / brushed part (symmetric → flip-safe). */
  function metalGradient(ctx, x0, x1, cap, vertical) {
    var gr = vertical ? ctx.createLinearGradient(0, x0, 0, x1)
                      : ctx.createLinearGradient(x0, 0, x1, 0);
    var lo = cap.lo, mid = cap.mid, hi = cap.hi;
    gr.addColorStop(0, rgba(lo, 1));
    gr.addColorStop(0.18, rgba(mid, 1));
    gr.addColorStop(0.5, rgba(mix(mid, hi, cap.kind === 'wood' ? 0.35 : 0.8), 1));
    gr.addColorStop(0.82, rgba(mid, 1));
    gr.addColorStop(1, rgba(lo, 1));
    return gr;
  }

  /* -- behind the sand: posts, glass body ----------------------------- */
  Renderer.prototype._drawBack = function () {
    var ctx = this._ctx('back'), g = this.sim.geo, th = this.theme, q = g.q;
    var tint = th.glass.tint;

    // Two slender turned posts. Draw one, rotate 180° for the other so the
    // layer is exactly point-symmetric (it rotates with the vessel).
    for (var side = 0; side < 2; side++) {
      ctx.save();
      if (side) ctx.rotate(Math.PI);
      var px = -g.postX, half = 1.7 * q, yT = -(g.HB + 4 * q), yB = g.HB + 4 * q;
      ctx.fillStyle = metalGradient(ctx, px - half, px + half, th.cap, false);
      roundRect(ctx, px - half, yT, half * 2, yB - yT, half);
      ctx.fill();
      // turned details: a swell near each end and a fine ring at the waist
      var swell = 2.9 * q;
      ctx.fillStyle = metalGradient(ctx, px - swell, px + swell, th.cap, false);
      var ends = [yT + 6 * q, yB - 20 * q];
      for (var e = 0; e < 2; e++) {
        roundRect(ctx, px - swell, ends[e], swell * 2, 14 * q, swell);
        ctx.fill();
      }
      roundRect(ctx, px - swell * 0.9, -2.2 * q, swell * 1.8, 4.4 * q, 2 * q);
      ctx.fill();
      ctx.restore();
    }

    // Glass body: almost clear in the middle, denser toward the silhouette
    // where the wall is seen edge-on.
    tracePath(ctx, g, g.wall);
    var body = ctx.createLinearGradient(-g.R - g.wall, 0, g.R + g.wall, 0);
    body.addColorStop(0, rgba(tint, 0.17));
    body.addColorStop(0.16, rgba(tint, 0.06));
    body.addColorStop(0.5, rgba(tint, 0.018));
    body.addColorStop(0.84, rgba(tint, 0.06));
    body.addColorStop(1, rgba(tint, 0.17));
    ctx.fillStyle = 'rgba(4,5,7,' + th.glass.smoke + ')';
    ctx.fill();
    ctx.fillStyle = body;
    ctx.fill();

    // faint reflection of the far wall
    ctx.save();
    tracePath(ctx, g, 0);
    ctx.clip();
    tracePath(ctx, g, 0);
    ctx.strokeStyle = rgba(tint, 0.035);
    ctx.lineWidth = 16 * q; ctx.stroke();
    ctx.strokeStyle = rgba(tint, 0.045);
    ctx.lineWidth = 7 * q; ctx.stroke();
    ctx.restore();
  };

  /* -- in front of the sand: glass wall, rim light, caps -------------- */
  Renderer.prototype._drawFront = function () {
    var ctx = this._ctx('front'), g = this.sim.geo, th = this.theme, q = g.q;
    var tint = th.glass.tint, cap = th.cap, k, i;

    // double wall: the band between the outer and inner surface
    ctx.save();
    tracePath(ctx, g, g.wall);
    var wallGr = ctx.createLinearGradient(-g.R, 0, g.R, 0);
    wallGr.addColorStop(0, rgba(tint, 0.20));
    wallGr.addColorStop(0.5, rgba(tint, 0.09));
    wallGr.addColorStop(1, rgba(tint, 0.20));
    ctx.fillStyle = wallGr;
    // even-odd: outer minus inner
    var outer = new Path2D(), inner = new Path2D(), band = new Path2D();
    tracePathTo(outer, g, g.wall); tracePathTo(inner, g, 0);
    tracePathTo(band, g, g.wall); tracePathTo(band, g, 0);
    ctx.fill(band, 'evenodd');
    ctx.restore();

    // Fresnel rim: light gathers where the surface turns away from the eye
    ctx.save();
    ctx.clip(inner);
    ctx.strokeStyle = rgba(tint, 0.03); ctx.lineWidth = 13 * q; ctx.stroke(inner);
    ctx.strokeStyle = rgba(tint, 0.04); ctx.lineWidth = 7 * q; ctx.stroke(inner);
    ctx.strokeStyle = rgba(tint, 0.06); ctx.lineWidth = 3 * q; ctx.stroke(inner);
    ctx.restore();

    ctx.strokeStyle = rgba(tint, 0.42); ctx.lineWidth = 0.75 * q; ctx.stroke(outer);
    ctx.strokeStyle = rgba(tint, 0.20); ctx.lineWidth = 0.5 * q; ctx.stroke(inner);

    // End caps (collar + slab). Draw the top one, rotate for the bottom.
    for (var side = 0; side < 2; side++) {
      ctx.save();
      if (side) ctx.rotate(Math.PI);
      var yC = -(g.HB + 3 * q);                        // collar top
      var colW = g.R * 0.62;
      // collar seating the dome
      ctx.fillStyle = metalGradient(ctx, -colW, colW, cap, false);
      roundRect(ctx, -colW, yC, colW * 2, g.collarH + 1.5 * q, 1.6 * q);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(-colW, yC + g.collarH, colW * 2, 1.5 * q);
      // slab
      var sy = yC - g.slabH, sw = g.capHalf;
      ctx.fillStyle = metalGradient(ctx, -sw, sw, cap, false);
      roundRect(ctx, -sw, sy, sw * 2, g.slabH, 2.6 * q);
      ctx.fill();
      ctx.save();
      roundRect(ctx, -sw, sy, sw * 2, g.slabH, 2.6 * q);
      ctx.clip();
      if (cap.kind === 'wood') {
        // long, lazy grain lines
        for (k = 0; k < 16; k++) {
          var gy = sy + (hash01(k * 3 + 1) * 0.92 + 0.04) * g.slabH;
          var amp = (hash01(k * 5 + 2) - 0.5) * 2.2 * q;
          var ph = hash01(k * 7 + 3) * 6.28;
          ctx.beginPath();
          for (i = 0; i <= 24; i++) {
            var gx = -sw + (i / 24) * sw * 2;
            var yy = gy + Math.sin(i * 0.5 + ph) * amp * 0.35 + Math.sin(i * 0.17 + ph * 2) * amp;
            if (i) ctx.lineTo(gx, yy); else ctx.moveTo(gx, yy);
          }
          ctx.strokeStyle = hash01(k * 11 + 4) > 0.3
            ? 'rgba(10,5,2,' + (0.16 + hash01(k) * 0.22) + ')'
            : rgba(cap.hi, 0.10 + hash01(k) * 0.10);
          ctx.lineWidth = (0.3 + hash01(k * 13) * 0.55) * q;
          ctx.stroke();
        }
      } else {
        // brushed metal: a dense field of hairlines
        for (k = 0; k < 46; k++) {
          var by = sy + hash01(k * 3 + 9) * g.slabH;
          ctx.fillStyle = hash01(k * 7 + 1) > 0.5
            ? 'rgba(255,255,255,' + (0.03 + hash01(k) * 0.07) + ')'
            : 'rgba(0,0,0,' + (0.04 + hash01(k) * 0.09) + ')';
          var bx = -sw + hash01(k * 17 + 2) * sw * 0.6;
          ctx.fillRect(bx, by, sw * 2 * (0.5 + hash01(k * 5) * 0.5), 0.22 * q);
        }
      }
      // symmetric bevel: darker lips top and bottom
      var bev = ctx.createLinearGradient(0, sy, 0, sy + g.slabH);
      bev.addColorStop(0, 'rgba(0,0,0,0.30)');
      bev.addColorStop(0.16, 'rgba(0,0,0,0)');
      bev.addColorStop(0.84, 'rgba(0,0,0,0)');
      bev.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = bev;
      ctx.fillRect(-sw, sy, sw * 2, g.slabH);
      ctx.restore();
      ctx.restore();
    }
  };

  /* -- room lighting: speculars, caustics (does not rotate) ----------- */
  Renderer.prototype._drawLight = function () {
    var ctx = this._ctx('light'), g = this.sim.geo, th = this.theme, q = g.q;
    var glow = th.glow, k, u;
    var outer = new Path2D(); tracePathTo(outer, g, g.wall);

    ctx.save();
    ctx.clip(outer);
    for (var b = -1; b <= 1; b += 2) {                // -1 upper bulb, +1 lower
      var cyB = b * g.HB * g.equator;

      // broad soft sheen from a key light up and to the left
      var sh = ctx.createRadialGradient(-g.R * 0.46, cyB - g.HB * 0.16, 0,
                                        -g.R * 0.46, cyB - g.HB * 0.16, g.R * 0.95);
      sh.addColorStop(0, 'rgba(255,255,255,0.105)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0.03)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(-g.R - 8, cyB - g.HB * 0.7, g.R * 2 + 16, g.HB * 1.3);

      // long specular crescent hugging the left wall
      var uA = 0.26, uB = 0.93, n = 30;
      ctx.beginPath();
      for (k = 0; k <= n; k++) {
        u = uA + (uB - uA) * k / n;
        var xo = -profile(u, g) * 0.905;
        if (k) ctx.lineTo(xo, b * u * g.HB); else ctx.moveTo(xo, b * u * g.HB);
      }
      for (k = n; k >= 0; k--) {
        u = uA + (uB - uA) * k / n;
        var taper = Math.sin(Math.PI * k / n);
        ctx.lineTo(-profile(u, g) * (0.905 - 0.085 * taper), b * u * g.HB);
      }
      ctx.closePath();
      var cr = ctx.createLinearGradient(0, b * uA * g.HB, 0, b * uB * g.HB);
      var a0 = b < 0 ? 0.04 : 0.20, a1 = b < 0 ? 0.36 : 0.05;
      cr.addColorStop(0, 'rgba(255,255,255,' + a0 + ')');
      cr.addColorStop(0.55, 'rgba(255,255,255,' + Math.max(a0, a1) * 0.8 + ')');
      cr.addColorStop(1, 'rgba(255,255,255,' + a1 + ')');
      ctx.fillStyle = cr;
      ctx.fill();

      // thin bounce light on the right wall
      ctx.beginPath();
      for (k = 0; k <= n; k++) {
        u = 0.34 + 0.5 * k / n;
        var xr = profile(u, g) * 0.95;
        if (k) ctx.lineTo(xr, b * u * g.HB); else ctx.moveTo(xr, b * u * g.HB);
      }
      ctx.strokeStyle = rgba(glow, 0.20);
      ctx.lineWidth = 0.9 * q;
      ctx.stroke();

      // window glint, upper right
      ctx.save();
      ctx.translate(g.R * 0.52, cyB - g.HB * 0.20);
      ctx.rotate(0.42);
      var wg = ctx.createLinearGradient(0, -7 * q, 0, 7 * q);
      wg.addColorStop(0, 'rgba(255,255,255,0.26)');
      wg.addColorStop(1, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = wg;
      roundRect(ctx, -2.6 * q, -7 * q, 5.2 * q, 14 * q, 2.2 * q);
      ctx.fill();
      ctx.restore();
    }

    // caustic: light focused through the lower bulb onto its floor
    ctx.globalCompositeOperation = 'lighter';
    var ca = ctx.createRadialGradient(g.R * 0.20, g.HB * 0.93, 0, g.R * 0.20, g.HB * 0.93, g.R * 0.75);
    ca.addColorStop(0, rgba(glow, 0.20));
    ca.addColorStop(0.4, rgba(glow, 0.07));
    ca.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = ca;
    ctx.fillRect(-g.R, g.HB * 0.6, g.R * 2, g.HB * 0.45);
    // refracted arc following the dome
    ctx.beginPath();
    for (k = 0; k <= 26; k++) {
      u = 0.80 + 0.17 * k / 26;
      var xa = profile(u, g) * 0.93;
      if (k) ctx.lineTo(xa, u * g.HB); else ctx.moveTo(xa, u * g.HB);
    }
    ctx.strokeStyle = rgba(glow, 0.30); ctx.lineWidth = 1.5 * q; ctx.stroke();
    ctx.strokeStyle = rgba(glow, 0.10); ctx.lineWidth = 5 * q; ctx.stroke();
    // sparkle where the neck pinches the light
    var nk = ctx.createRadialGradient(-g.RN - 1, 0, 0, -g.RN - 1, 0, 9 * q);
    nk.addColorStop(0, 'rgba(255,255,255,0.50)');
    nk.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    nk.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = nk;
    ctx.fillRect(-g.RN - 12 * q, -10 * q, 22 * q, 20 * q);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    // caps: key light rakes the top edges, the base catches the caustic
    var sw = g.capHalf, yC = g.HB + 3 * q, slab = g.slabH;
    for (var t = -1; t <= 1; t += 2) {
      var sy = t < 0 ? -(yC + slab) : yC;
      ctx.save();
      roundRect(ctx, -sw, sy, sw * 2, slab, 2.6 * q);
      ctx.clip();
      var band = ctx.createLinearGradient(-sw, 0, sw, 0);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.22, 'rgba(255,255,255,0.03)');
      band.addColorStop(0.32, 'rgba(255,255,255,' + (th.cap.kind === 'wood' ? 0.10 : 0.30) + ')');
      band.addColorStop(0.44, 'rgba(255,255,255,0.03)');
      band.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = band;
      ctx.fillRect(-sw, sy, sw * 2, slab);
      var edge = ctx.createLinearGradient(0, sy, 0, sy + slab);
      edge.addColorStop(0, 'rgba(255,255,255,' + (th.cap.kind === 'wood' ? 0.20 : 0.42) + ')');
      edge.addColorStop(0.14, 'rgba(255,255,255,0)');
      edge.addColorStop(0.7, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = edge;
      ctx.fillRect(-sw, sy, sw * 2, slab);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    var pool = ctx.createRadialGradient(g.R * 0.1, yC, 0, g.R * 0.1, yC, g.R * 0.8);
    pool.addColorStop(0, rgba(glow, 0.16));
    pool.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(-sw, yC - 2 * q, sw * 2, slab * 0.7);
    ctx.globalCompositeOperation = 'source-over';

    // posts: a hairline highlight down the lit side
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      var hl = ctx.createLinearGradient(0, -g.HB, 0, g.HB);
      hl.addColorStop(0, 'rgba(255,255,255,0.34)');
      hl.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      hl.addColorStop(1, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = hl;
      ctx.fillRect(sgn * g.postX - 0.95 * q, -g.HB, 0.5 * q, g.HB * 2);
    }
  };

  /* ======================================================================
   *  Exports
   * ==================================================================== */
  root.HourglassPhysics = {
    Sim: Sim,
    Renderer: Renderer,
    THEMES: THEMES,
    makeGeometry: makeGeometry,
    profile: profile,
    EMPTY: EMPTY, WALL: WALL, REST: REST, MOVE: MOVE,
    STEP_HZ: STEP_HZ, DT: DT
  };
})(typeof window !== 'undefined' ? window : globalThis);
