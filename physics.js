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

  // Damage is kept per stretch of glass: 2 bulbs × 2 sides × WALL_BINS bins
  // of u (0 at the neck, 1 at the far end of the bulb).
  var WALL_BINS = 40;
  var WALL_SEGS = 4 * WALL_BINS;
  var ESC_RING = 256;            // escaped grains kept until the app drains them
  var DMG_RING = 8;              // damage events kept per frame

  /** A number, or 0 for NaN and ±Infinity. */
  function finiteOr0(v) {
    v = +v;
    return v - v === 0 ? v : 0;
  }
  /** A whole number that can index the lattice. */
  function isIndex(v) {
    return typeof v === 'number' && v >= 0 && v <= 4294967295 && v === Math.floor(v);
  }
  /** Scramble a 32-bit seed (murmur3 finaliser) so nearby seeds share nothing. */
  function glassHash(h) {
    h |= 0;
    h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B);
    h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35);
    h ^= h >>> 16;
    return h;
  }
  /**
   * Turning the glass end over end maps a wall segment of block
   * q = bulb·2 + side (0 left, 1 right) to block 3 − q, at the same u.
   */
  function flipSegIndex(s) {
    return (3 - ((s / WALL_BINS) | 0)) * WALL_BINS + (s % WALL_BINS);
  }
  function flipSegArray(a) {
    for (var s = 0; s < 2 * WALL_BINS; s++) {
      var t = flipSegIndex(s), v = a[s];
      a[s] = a[t]; a[t] = v;
    }
  }
  /** A per-bulb pair of vectors [x0, y0, x1, y1] after the same flip. */
  function flipBulbPair(v) {
    var x0 = v[0], y0 = v[1];
    v[0] = -v[2]; v[1] = -v[3]; v[2] = -x0; v[3] = -y0;
  }
  /**
   * One bulb's bed: in the air or not, its speed U (cells/s) and height Z
   * (cells) off its seat, the whole cells of that (kZ), and which end it
   * rests on (seat +1: its +y end, −1: the far end). U and Z start as
   * fractions so the engine stores them as doubles from the outset: a
   * flight never changes the object's shape, which would cost the JIT a
   * deoptimisation in the middle of a shake.
   */
  function Slug() {
    this.air = false;
    this.U = 0.5;
    this.Z = 0.5;
    this.kZ = 0;
    this.seat = 1;
    this.U = 0;
    this.Z = 0;
  }
  /** The lattice direction (index into DX/DY) nearest the vector (x, y). */
  function dir8(x, y) {
    var k = Math.round(Math.atan2(x, y) / (Math.PI / 4));
    return ((k % 8) + 8) % 8;
  }

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
      released: 0, impGlass: 0, impSand: 0, impTop: 0, moved: 0, slides: 0,
      // what motion and damage did this frame, for the sound and the picture
      thump: new Float32Array(4),        // bed landings [E0, x0, E1, x1]
      slam: new Float32Array(2),         // beds slammed into the far end [E, x]
      leaked: 0, leakX: 0,               // grains that left the glass; where (−1 … +1)
      sprayed: 0, hops: 0,
      dmgN: 0,                           // damage events (Sim.DMG) this frame
      dmgType: new Uint8Array(DMG_RING),
      dmgK: new Int8Array(DMG_RING),     // crack index, −1 for WARN
      dmgLevel: new Uint8Array(DMG_RING),
      dmgX: new Float32Array(DMG_RING)   // −1 … +1 across the glass
    };

    // tunables -----------------------------------------------------------
    this.G = 3300;            // gravity, cells / s²  (slow-motion scale so the
                              // stream reads as individual accelerating grains)
    this.pDiag = 150;         // /256 chance per step of a 45° slide (also the
                              //   lateral diffusion of voids → drain funnel)
    this.pCreep = 96;         // /256 chance a *static* surface grain lets go
                              //   once the slope passes the angle of maximum
                              //   stability (3:4 ≈ 37°)
    this.pSlide = 214;        // /256 chance a *moving* grain keeps running
                              //   down a shallower 1:2 slope (dynamic friction)
    this.pWake = 150;         // /256 chance a slide wakes its neighbours
                              //   (how far an avalanche spreads)
    this.pRollStop = 3;       // /256 chance a rolling grain snags and stops
    this.focus = 2.4;         // stream self-focusing spring (1/s²)

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
    this._initMotion();
    this.reset(opts.grains || this.defaultGrains);
  }

  Sim.STEP_HZ = STEP_HZ;
  Sim.DT = DT;

  /**
   * Motion and glass tunables. Every inertial effect enters at the g-ratio it
   * would have on a real glass of the size it appears on screen, so most of
   * these thresholds are real ones: the bed lifts at 1 g, sand pins to the
   * far end once ω²r passes g. Change values in place; the object is shared.
   */
  var MOT = Sim.MOTION = {
    // the felt field, its slow mean, and how hot (agitated) the sand runs
    tauSlow: 0.35,       // s: slow mean of each bulb's field
    tauT: 0.25,          // s: granular temperature follows its drive
    gzK: 1.0,            // heat per g of out-of-plane shaking
    maxSweeps: 3,        // CA sweeps per bulb per step (2 at quality 1, 1 at 0)
    sweepT: 0.75,        // extra sweeps per unit of temperature (up to T = 2)
    weightless: 0.15,    // × G: below this the sand floats with the glass
    neckPress: 0.25,     // × G: the neck flows only while pressed this hard
    cenEvery: 8,         // steps between refreshes of the bed centroids
    // the idle path (bit-identical to the sim before motion) holds while all hold
    idleA: 0.01,         // × G
    idleW: 0.15,         // rad/s
    idleAl: 2,           // rad/s²
    idleGz: 0.02,        // g
    idleT: 0.02,
    // shaken sand loses its friction (lerped between fricS0 and fricS1 of T)
    fricS0: 0.15, fricS1: 0.85,
    pCreepMax: 236, pSlideMax: 250, pWakeMax: 230, pDiagMax: 240,
    // the bed flies as one body (a completely inelastic bouncing bed)
    liftTh: 0.04,        // × G: lift-off margin, so a bed at 1 g does not chatter
    muW: 0.40,           // sand on glass, while pressed sideways
    // spray, hops and airborne grains
    sprayV: 150, pSpray: 0.35, hopT: 0.45, hopMax: 4, softCap: 4096, vMax: 1400,
    pSprayQ1: 0.15, hopMaxQ1: 2,      // the lighter quality level (the governor's 1)
    jitX: 0.011, jitY: 0.004,         // a falling grain's aerodynamic jitter, per step (as today)
    retryV: 25,          // cells/s: a grain with nowhere to settle rises against the field and tries again
    Dcap: 8,             // a crack is full grown long before its stretch holds this much damage
    // the glass: stress corrosion with a fatigue limit, Weibull flaws
    nSeg: WALL_BINS,     // wall segments per bulb and side (bins of u; read-only)
    weibull: 20,         // Weibull modulus of the flaw strengths (median 1)
    n: 16,               // stress-corrosion exponent of soda-lime glass
    vc: 20,              // landing speed v/√(G·cell) of the reference stress
    xTh: 0.78,           // fatigue limit K_th/K_IC: below it a crack never grows
    A: 0.40,             // damage per reference column landing
    hRef: 40,            // grains in a reference column (h = min(2, n/hRef))
    capCol: 0.5,         // the most one column landing can supply
    Pmax: 0.15,          // the most one blow can ever do
    gamTh: 4.6, gamC: 6, nB: 16, tauB: 0.5, capB: 0.02, bendBins: 3,   // the waist bends
    rMax: 0.30,          // 1/s: fastest sub-critical growth (bounded crack velocity)
    tauP: 0.6,           // s: an unabsorbed blow fades
    tauHeal: 8,          // s: micro-damage arrests while no crack is visible
    warn: [0.35, 0.60, 0.80, 0.92],   // creak levels 1–4, crossing upward
    warnRearm: 0.15,     // a level re-arms this far below its threshold
    maxCracks: 3,        // per glass
    gateGuard: 4,        // cracks and holes stay at least this many rows from the gate
    L0: 4, growK: 22, growL: 30, growStep: 6, Lmax: 140,   // crack length, cells
    Lhole: 26, widen: 0.8, wMax: 3,   // breached at L > 26, wider at 26·(1 + 0.8·w)
    sealS: 1.5,          // a mended seam is half as strong again
    // the leak: 2-D Beverloo flow with jamming
    leakP0: 0.35, leakPmax: 1.35,     // pressure through the breach
    Q0: 3.0, leakJam: 1.2,            // grains/s at rest: Q0·max(0, w − 1.2)^1.5
    leakT: 12,           // grains/s per cell of breach while shaken (T = 1)
    leakCap: 3,          // credit cap, grains
    escV: 40, escVr: 30, escTan: 10,  // escape speed: 40 + 30·U out, N(0, 10) along, cells/s
    leakLinger: 120      // steps a leak keeps the sim awake
  };

  /** Damage events, as sim.frame.dmgType. */
  Sim.DMG = { WARN: 1, CRACK: 2, GROW: 3, BREACH: 4, WIDEN: 5, SEAL: 6 };

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
    this.maxTotal = Math.round(cap * 0.86);

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
   *  Motion and damage state. Everything is allocated here, once, so a
   *  step never allocates (garbage-collector pauses cost whole frames).
   * ---------------------------------------------------------------- */
  Sim.prototype._initMotion = function () {
    var g = this.geo, W = this.W, H = this.H, N = W * H, cell = this.cell;
    var gate = this.gateY, x, y, i, b, k, s;

    // Inputs from the app (setMotion), vessel frame, + = clockwise on screen.
    this.mAx = 0; this.mAy = 0;          // felt acceleration without gravity, cells/s²
    this.mW = 0; this.mAl = 0;           // rotation rate (rad/s) and its change (rad/s²)
    this.mLam = 0;                       // true-size scale of the rotational terms
    this.mGz = 0;                        // out-of-plane shaking, g
    this.damageArmed = false;            // only sustained real phone motion arms damage
    this.relCap = 0;                     // most grains the neck may release per step (0: no cap)
    this.reduced = false;                // Reduce Motion: gentler physics, a glass that cannot crack
    this.quality = 2;                    // 2 full, 1 lighter, 0 lightest (set by the app)

    // Each bulb's bed: the field it feels, its slow mean, centroid and heat.
    this.bf = new Float32Array(4);       // [f0x, f0y, f1x, f1y], cells/s²
    this.bfSlow = new Float32Array(4);
    this.cen = new Float32Array(4);      // bed centroids, cells from the glass centre
    this.agit = new Float32Array(2);     // granular temperature T_b
    this.sweepAcc = new Float32Array(2); // fractional CA sweeps carried over

    // The bed in flight: one slug per bulb; columns ride it until they meet glass.
    this.slug = [new Slug(), new Slug()];
    this.nAir = [0, 0];
    this.colLo = [new Int16Array(W), new Int16Array(W)];   // each column's span in each bulb
    this.colHi = [new Int16Array(W), new Int16Array(W)];
    this.cdOff = [new Int16Array(W), new Int16Array(W)];   // cells moved off the seat
    this.cair = [new Uint8Array(W), new Uint8Array(W)];    // riding the slug
    this.cpin = [new Uint8Array(W), new Uint8Array(W)];    // pressed to the far glass
    this._bx0 = W; this._bx1 = -1;       // the columns either bulb has (the same for both)
    for (b = 0; b < 2; b++) {
      var y0 = b ? gate + 1 : 1, y1 = b ? H - 2 : gate - 1;
      for (x = 0; x < W; x++) {
        var lo = 32767, hi = -1;
        for (y = y0; y <= y1; y++) {
          if (this.rowMin[y] <= x && x <= this.rowMax[y]) { if (y < lo) lo = y; hi = y; }
        }
        this.colLo[b][x] = lo; this.colHi[b][x] = hi;
        if (hi >= lo) {
          if (x < this._bx0) this._bx0 = x;
          if (x > this._bx1) this._bx1 = x;
        }
      }
    }
    this._botY = gate;                   // the last row inside the lower bulb
    for (y = gate + 1; y < H; y++) if (this.rowMin[y] <= this.rowMax[y]) this._botY = y;
    this._dLo = H; this._dHi = -1;       // rows a flying bed has changed this step
    this._n = 0; this._moved = 0;        // what the last column shift found and moved
    this._landAt = new Float64Array(2);  // step of each bulb's last landing
    this._thumpN = new Float32Array(2);  // grains landed this frame, per bulb (the thump's pan)
    this._slamN = 0;                     // ... and slammed into the far end
    this._cenAt = -1e9;                  // step the centroids were last measured

    this._motionStep = false;            // the last step took the motion path
    this._iz = 0; this._izAt = -1;       // cached moment of inertia (inertiaZ)
    this.neckGuards = 0;                 // _freeNear answers refused across the neck (diagnostic)

    // Escaped grains, for the spill outside the glass. The app drains the
    // ring every frame and sets escN = 0.
    this.escN = 0;
    this.escX = new Float32Array(ESC_RING);    // lattice cells
    this.escY = new Float32Array(ESC_RING);
    this.escVX = new Float32Array(ESC_RING);   // cells/s, vessel frame
    this.escVY = new Float32Array(ESC_RING);
    this.escS = new Uint8Array(ESC_RING);      // colour seed
    this.lost = 0;                       // grains that left the glass since reset
    this.leakedTop = 0; this.leakedBottom = 0;
    this._leakStep = -1e9;               // step of the last escape
    this._leakLive = false;              // a breach is still passing sand

    // The glass. Every wall cell that touches the inside belongs to a
    // segment: (bulb·2 + side)·WALL_BINS + bin of u. The gate row is split
    // by side, and the centre column goes right in the upper bulb and left
    // in the lower one, so the map is point-symmetric just as the vessel is:
    // cell N − 1 − i lies in block 3 − q of cell i's block q, and a flip
    // leaves the map itself unchanged. (The one cell in the middle of the
    // gate maps onto itself; no crack ever starts within gateGuard rows.)
    var segOf = this.segOf = new Int16Array(N);
    segOf.fill(-1);
    for (y = 1; y < H - 1; y++) {
      var dy = y + 0.5 - g.cy, bin = ((dy < 0 ? -dy : dy) / g.HB * WALL_BINS) | 0;
      if (bin > WALL_BINS - 1) bin = WALL_BINS - 1;
      for (x = 1; x < W - 1; x++) {
        i = y * W + x;
        if (cell[i] !== WALL) continue;
        var touch = false;
        for (k = 0; k < 8 && !touch; k++) if (cell[i + DX[k] + DY[k] * W] !== WALL) touch = true;
        if (!touch) continue;
        var xc = x + 0.5 - g.cx;
        b = y < gate ? 0 : (y > gate ? 1 : (xc <= 0 ? 0 : 1));
        var right = xc > 0 ? 1 : (xc < 0 ? 0 : (b === 0 ? 1 : 0));
        segOf[i] = (b * 2 + right) * WALL_BINS + bin;
      }
    }
    this.segD = new Float32Array(WALL_SEGS);   // damage; a crack starts at 1
    this.segP = new Float32Array(WALL_SEGS);   // pending load, absorbed at a bounded rate
    this.segS = new Float32Array(WALL_SEGS);   // strength of this glass's flaws
    this.segKt = new Float32Array(WALL_SEGS);  // stress concentration of the shape
    this.segCrack = new Int8Array(WALL_SEGS);  // index of the segment's crack, −1 none
    for (s = 0; s < WALL_SEGS; s++) {
      // Stress gathers at the blown shoulder by the waist and at the dome under the cap.
      var u = ((s % WALL_BINS) + 0.5) / WALL_BINS, a = (u - 0.05) / 0.06, c = (1 - u) / 0.08;
      this.segKt[s] = 1 + 0.10 * Math.exp(-a * a) + 0.05 * Math.exp(-c * c);
    }
    this.glassSeed = 0;                  // the flaws are drawn from this (see _drawFlaws)
    this.glassFlip = 0;                  // odd number of flips since they were drawn
    this.cracks = [];
    this.crackRev = 0;                   // changes whenever a crack appears, grows or moves
    this.dMax = 0;                       // worst damage on an uncracked segment
    this.warnSeg = -1;                   // ... and where it is
    this.warnLatch = new Uint8Array(4);  // creak levels already sounded
    this._pendP = false;                 // some segment still has a blow to absorb (segP)
    this.nOpen = 0;                      // unsealed cracks with a breach
    this._crackId = 0;
    this._holeBuf = new Uint8Array(N);   // holeMap's storage: a breach never allocates
    this.holeMap = null;                 // Uint8Array(N) from the first breach until reset
  };

  /**
   * This glass's flaws: one Weibull strength per segment (modulus 20, median
   * 1), from a private xorshift seeded by glassSeed, so the same glass can be
   * rebuilt from its seed and the sand's own random stream is never touched.
   */
  Sim.prototype._drawFlaws = function () {
    var S = this.segS, s = glassHash(this.glassSeed) || 0x6D2B79F5, m = 1 / MOT.weibull;
    for (var k = 0; k < WALL_SEGS; k++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      var U = (s >>> 0) / 4294967296;
      if (U < 1e-9) U = 1e-9;
      S[k] = Math.pow(-Math.log(U) / Math.LN2, m);
    }
    if (this.glassFlip) flipSegArray(S);
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
    this._newGlass();
  };

  /**
   * A new glass: the beds at rest and cool, no damage, nothing spilled, and
   * a fresh set of flaws. glassSeed is read from the random stream, never
   * advanced, so the sand itself comes out exactly as it always did.
   */
  Sim.prototype._newGlass = function () {
    var G = this.G, gx = Math.sin(this.tilt), gy = Math.cos(this.tilt);
    for (var b = 0; b < 2; b++) {
      var S = this.slug[b];
      S.air = false; S.U = 0; S.Z = 0; S.kZ = 0; S.seat = 1;
      this.nAir[b] = 0;
      this.cair[b].fill(0); this.cpin[b].fill(0); this.cdOff[b].fill(0);
      this.bf[2 * b] = this.bfSlow[2 * b] = G * gx;
      this.bf[2 * b + 1] = this.bfSlow[2 * b + 1] = G * gy;
    }
    this.cen.fill(0); this.agit.fill(0); this.sweepAcc.fill(0);
    this._landAt[0] = this._landAt[1] = -1e9;
    this._cenAt = -1e9;
    this._motionStep = false;
    this._izAt = -1;
    this._clearDamage();
    this.glassSeed = this.rng >>> 0;
    this.glassFlip = 0;
    this._drawFlaws();
  };

  /** No cracks, holes, damage or spilled sand (the flaws are left as they are). */
  Sim.prototype._clearDamage = function () {
    if (this.cracks.length) this.crackRev++;       // so the picture drops them
    this.cracks.length = 0;
    this.segCrack.fill(-1);
    this.segD.fill(0); this.segP.fill(0);
    this._pendP = false;
    if (this.holeMap !== null) { this._holeBuf.fill(0); this.holeMap = null; }
    this.nOpen = 0; this.dMax = 0; this.warnSeg = -1;
    this.warnLatch.fill(0);
    this.lost = 0; this.leakedTop = 0; this.leakedBottom = 0;
    this.escN = 0;
    this._leakStep = -1e9; this._leakLive = false;
  };

  /* ---------------------------------------------------------------- *
   *  Per-frame bookkeeping
   * ---------------------------------------------------------------- */
  Sim.prototype.beginFrame = function () {
    var f = this.frame;
    f.released = 0; f.impGlass = 0; f.impSand = 0; f.impTop = 0;
    f.moved = 0; f.slides = 0;
    f.thump[0] = f.thump[1] = f.thump[2] = f.thump[3] = 0;
    f.slam[0] = f.slam[1] = 0;
    f.leaked = 0; f.leakX = 0; f.sprayed = 0; f.hops = 0;
    f.dmgN = 0;
    this._thumpN[0] = this._thumpN[1] = 0; this._slamN = 0;
    this.nev = 0;
  };

  Object.defineProperty(Sim.prototype, 'nBottom', {
    get: function () { return this.total - this.nTop; }
  });

  /**
   * True while anything is still in motion (used to idle the render loop):
   * grains in the air, recent avalanches, a turn, a step on the motion path,
   * a bed in flight, or a breach still passing sand.
   */
  Sim.prototype.isActive = function () {
    return this.np > 0 || this.quiet < 24 || this.flipping ||
      this._motionStep || this.slug[0].air || this.slug[1].air ||
      this._leakLive || this.steps - this._leakStep < MOT.leakLinger;
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
   *  Motion: what the glass feels, and what the sand is doing
   * ---------------------------------------------------------------- */

  /**
   * The felt field for the coming steps, in the vessel frame (cells and
   * seconds, + = clockwise on screen): ax, ay the felt linear acceleration
   * without gravity (cells/s²); w the rotation rate (rad/s) and al its rate
   * of change (rad/s², smoothed and clamped by the caller); lam the true-size
   * scale of the rotational terms (0 turns them off); gz how hard the glass
   * is shaken out of the screen plane (g, agitation only). The values hold
   * until the next call; NaN reads as 0.
   */
  Sim.prototype.setMotion = function (ax, ay, w, al, lam, gz) {
    this.mAx = finiteOr0(ax); this.mAy = finiteOr0(ay);
    this.mW = finiteOr0(w); this.mAl = finiteOr0(al);
    lam = finiteOr0(lam); this.mLam = lam > 0 ? lam : 0;
    gz = finiteOr0(gz); this.mGz = gz < 0 ? -gz : gz;
  };

  /** True when the last step took the motion path. */
  Sim.prototype.motionActive = function () {
    return this._motionStep;
  };

  /** How shaken the sand is: the hotter bulb's granular temperature (0 … 3). */
  Sim.prototype.agitation = function () {
    var a = this.agit;
    return a[0] > a[1] ? a[0] : a[1];
  };

  /** True while either bed is in flight. */
  Sim.prototype.airborne = function () {
    return this.slug[0].air || this.slug[1].air;
  };

  /**
   * The sand's moment of inertia about the centre of the glass, Σ|r|² in
   * cells² (one grain = unit mass), for the skater effect of a free spin.
   * Packed sand is sampled on every second row and column (×4); grains in
   * the air count one by one. Cached: recomputed after cenEvery steps on the
   * motion path and after 60 on the idle path.
   */
  Sim.prototype.inertiaZ = function () {
    var every = this._motionStep ? MOT.cenEvery : 60;
    if (this._izAt >= 0 && this.steps - this._izAt < every) return this._iz;
    var W = this.W, H = this.H, cell = this.cell, rowMin = this.rowMin, rowMax = this.rowMax;
    var cx = this.geo.cx, cy = this.geo.cy, sum = 0, x, y;
    for (y = this.topY + (this.topY & 1); y < H; y += 2) {
      var x0 = rowMin[y], x1 = rowMax[y];
      if (x0 > x1) continue;
      var dy = y + 0.5 - cy, base = y * W, sx = 0, n = 0;
      for (x = x0 + (x0 & 1); x <= x1; x += 2) {
        if (cell[base + x] >= REST) { var dx = x + 0.5 - cx; sx += dx * dx; n++; }
      }
      sum += sx + n * dy * dy;
    }
    sum *= 4;
    for (var p = 0; p < this.np; p++) {
      var rx = this.px[p] - cx, ry = this.py[p] - cy;
      sum += rx * rx + ry * ry;
    }
    this._iz = sum;
    this._izAt = this.steps;
    return sum;
  };

  /**
   * Where wall segment `seg` is: bulb (0 above the neck in the lattice as it
   * stands, 1 below), side (−1 left, +1 right) and u at the middle of its bin
   * (0 neck … 1 far end). Fills `out` when given; null for no segment.
   */
  Sim.prototype.segInfo = function (seg, out) {
    if (!isIndex(seg) || seg >= WALL_SEGS) return null;
    out = out || {};
    out.bulb = seg >= 2 * WALL_BINS ? 1 : 0;
    out.side = ((seg / WALL_BINS) | 0) & 1 ? 1 : -1;
    out.u = ((seg % WALL_BINS) + 0.5) / WALL_BINS;
    return out;
  };

  /**
   * Put both beds down: whatever was in flight stays where it is in the
   * lattice and settles under the CA from here (before flips and bulk moves,
   * which must never find a bed in the air).
   */
  Sim.prototype._landSlugs = function () {
    for (var b = 0; b < 2; b++) {
      var S = this.slug[b];
      if (!S.air && S.seat === 1 && this.nAir[b] === 0) continue;
      if (S.air) {
        // a bed left hanging in mid-air falls back under the automaton
        this.rowAct.fill(2);
        this._landAt[b] = this.steps;
      }
      S.air = false; S.U = 0; S.Z = 0; S.kZ = 0; S.seat = 1;
      this.nAir[b] = 0;
      this.cair[b].fill(0); this.cpin[b].fill(0); this.cdOff[b].fill(0);
    }
  };

  /* ---------------------------------------------------------------- *
   *  One fixed physics step (1/120 s)
   * ---------------------------------------------------------------- */
  Sim.prototype.step = function () {
    // While the glass is moved, turned or shaken, or its sand is still hot
    // or in the air, the step takes the motion path. Otherwise it is exactly
    // the step the hourglass has always taken, so a glass at rest behaves,
    // grain for grain, as it did before any of this existed.
    var lim = MOT.idleA * this.G, ax = this.mAx, ay = this.mAy, w = this.mW, al = this.mAl;
    var a = this.agit, sl = this.slug;
    if (ax * ax + ay * ay >= lim * lim || w >= MOT.idleW || w <= -MOT.idleW ||
        al >= MOT.idleAl || al <= -MOT.idleAl || this.mGz >= MOT.idleGz ||
        a[0] >= MOT.idleT || a[1] >= MOT.idleT ||
        sl[0].air || sl[1].air || sl[0].seat < 0 || sl[1].seat < 0) {
      this._stepMotion();
      return;
    }
    this._motionStep = false;

    var ang = this.angle + this.tilt;
    var gx = Math.sin(ang), gy = Math.cos(ang);
    this.gx = gx; this.gy = gy;
    // At rest both beds feel plain gravity; the motion path adds what the
    // hand and the phone do to the glass.
    var bf = this.bf;
    bf[0] = bf[2] = this.G * gx;
    bf[1] = bf[3] = this.G * gy;

    // 1. Neck valve: let through exactly as many grains as the clock owes.
    //    If the neck is momentarily starved, reach a little higher up the
    //    funnel (and sweep the upper bulb harder) until it has caught up.
    var lag = 0;
    if (this.gateOpen && !this.flipping && gy > 0.7) {
      var need = this.nTop - this.targetTop;
      if (need > 0) {
        var rows = this.deepRelease ? (this.gateY - this.topY) : 3 + Math.min(need >> 3, 36);
        // Inserted for motion: for a moment after the glass was shaken the
        // app caps the release (relCap > 0), so the backlog the shaking left
        // drains as a thicker thread, never as a clump. 0 changes nothing.
        var give = need;
        if (this.relCap > 0 && need > this.relCap) give = Math.ceil(this.relCap);
        lag = need - this._release(give, rows);
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

    // 4. A breached glass leaks, even at rest, and micro-damage slowly arrests.
    if (this.nOpen > 0) this._leak();
    if (this.dMax > 1e-4 || this._pendP) this._damageStep(false);
    if (a[0] !== 0 || a[1] !== 0) this._cool();

    if (this.frame.moved === before && this.np === 0) this.quiet++;
    else this.quiet = 0;
    this.steps++;
  };

  /** The last warmth left in the sand fades on the idle path (it is below idleT already). */
  Sim.prototype._cool = function () {
    var a = this.agit, k = Math.exp(-DT / MOT.tauT);
    a[0] = a[0] * k < 1e-6 ? 0 : a[0] * k;
    a[1] = a[1] * k < 1e-6 ? 0 : a[1] * k;
  };

  /* ---------------------------------------------------------------- *
   *  The motion path: one step of a glass that is being moved, turned or
   *  shaken. Every inertial effect enters at the strength it would have
   *  on a real glass of the size this one appears on screen: the felt
   *  field per bulb, a bouncing bed, granular temperature, the gated neck,
   *  airborne grains under centrifugal, Euler and Coriolis forces, and the
   *  load on the glass.
   * ---------------------------------------------------------------- */
  Sim.prototype._stepMotion = function () {
    var G = this.G, f = this.frame, gate = this.gateY;
    var bf = this.bf, bs = this.bfSlow, cen = this.cen, agit = this.agit, slug = this.slug;
    var entry = !this._motionStep, b, T, n;
    this._motionStep = true;

    // 1. The heading. The clock, the valve's upright test, tiltSwap and the
    //    shading read only this quasi-static ĝ, so a shake never pauses the
    //    clock or turns the glass over.
    var ang = this.angle + this.tilt;
    var gx = Math.sin(ang), gy = Math.cos(ang);
    this.gx = gx; this.gy = gy;

    // 2. Where each bed is: the rotational terms act at its centroid.
    if (entry || this.steps - this._cenAt >= MOT.cenEvery) this._centroids();

    // 3. The field each bed feels, its slow mean, and how hot the sand runs.
    //    f_b = G·ĝ + A + λ·[ω²·r_b + α·(r_y, −r_x)]: gravity, the felt
    //    acceleration of the glass, centrifugal and Euler at the bed. Heat
    //    comes from what changes (|f − f̄|), not from a steady lean, and from
    //    shaking out of the screen's plane.
    var lam = this.mLam, w = this.mW, w2 = lam * w * w, la = lam * this.mAl;
    var Fx = G * gx + this.mAx, Fy = G * gy + this.mAy;     // the neck (r = 0) feels just this
    var kS = 1 - Math.exp(-DT / MOT.tauSlow), kT = 1 - Math.exp(-DT / MOT.tauT);
    var gzD = MOT.gzK * this.mGz;
    for (b = 0; b < 2; b++) {
      var rx = cen[2 * b], ry = cen[2 * b + 1];
      var fx = Fx + w2 * rx + la * ry, fy = Fy + w2 * ry - la * rx;
      bf[2 * b] = fx; bf[2 * b + 1] = fy;
      if (entry) {                                    // no fake kick on the way in
        bs[2 * b] = fx; bs[2 * b + 1] = fy;
      } else {
        bs[2 * b] += (fx - bs[2 * b]) * kS;
        bs[2 * b + 1] += (fy - bs[2 * b + 1]) * kS;
      }
      var ex = fx - bs[2 * b], ey = fy - bs[2 * b + 1];
      var D = Math.sqrt(ex * ex + ey * ey) / G + gzD;
      if (D > 3) D = 3;
      T = agit[b] + (D - agit[b]) * kT;
      agit[b] = T > 3 ? 3 : T;
    }

    // 4. The neck valve releases what the clock owes, but only while the
    //    upper bed sits on the neck and the field presses sand into it
    //    (Beverloo flow needs g > 0), so the stream stutters with the hand.
    //    While motion is recent a backlog drains as a thicker thread, never
    //    as a clump (relCap grains per step).
    var lag = 0, starved = 0;
    if (this.gateOpen && !this.flipping && gy > 0.7) {
      var need = this.nTop - this.targetTop;
      if (need > 0) {
        if (!slug[0].air && slug[0].seat > 0 && Fy > MOT.neckPress * G) {
          var rows = this.deepRelease ? (gate - this.topY) : 3 + Math.min(need >> 3, 36);
          var give = need;
          if (this.relCap > 0) {
            n = Math.ceil(this.relCap);
            if (n < give) give = n;
          }
          var out = this._release(give, rows);
          lag = need - out;
          starved = give - out;                       // the neck itself ran short
        } else lag = need;
      }
    }
    this.lag = lag;

    // 5. A bed the field pulls off its seat flies as one body. Not while the
    //    glass is turned by hand or button, or with Reduce Motion on.
    if (this.flipping || this.reduced) this._landSlugs();
    else { this._flight(0); this._flight(1); }

    // 6. Packed and sliding sand, bulb by bulb along its own field. Free
    //    fall goes as 1/√g, so the sweeps go as √|f|; hot sand runs faster.
    var before = f.moved;
    var base = (this.flipping || gy < 0.7) ? 2 : 1, qual = this.quality;
    var maxS = qual >= 2 ? MOT.maxSweeps : (qual === 1 ? (MOT.maxSweeps < 2 ? MOT.maxSweeps : 2) : 1);
    var spin = w > 0.3 || w < -0.3;
    for (b = 0; b < 2; b++) {
      if (slug[b].air) continue;                      // in flight the bed is weightless in its own frame
      var bx = bf[2 * b], by = bf[2 * b + 1], mag = Math.sqrt(bx * bx + by * by);
      if (mag < MOT.weightless * G) continue;         // the sand floats with the glass
      T = agit[b];
      var acc = this.sweepAcc[b] + base * Math.sqrt(mag / G) * (1 + MOT.sweepT * (T < 2 ? T : 2));
      n = Math.floor(acc);
      this.sweepAcc[b] = acc - n;
      if (n > maxS) n = maxS;
      // The upper bulb keeps the neck fed, as on the idle path: extra sweeps
      // when the neck ran short. (Sand the valve held back, because the bed
      // was in the air or relCap, is not a starved neck: sweeping cannot help.)
      if (b === 0 && !this.flipping && gy >= 0.7) n += this.topSweeps + (starved > 10 ? 1 : 0) + (starved > 60 ? 2 : 0);
      if (n > 0) this._caBulb(b, bx / mag, by / mag, n, T > 0.05 || spin || this.steps - this._landAt[b] < 8, T);
    }

    // 7. A hot surface boils: grains hop off it.
    if (!this.reduced && qual >= 1) {
      for (b = 0; b < 2; b++) if (agit[b] > MOT.hopT && !slug[b].air) this._hops(b);
    }

    // 8. Grains in the air, in the full field.
    if (this.np) this._particlesM();

    // 9. A breached glass leaks; shaking breaks the arches that jam it.
    if (this.nOpen > 0) this._leak();

    // 10. The load on the glass, its damage, cracks and the creaks before them.
    this._damageStep(true);

    // 11. A bed in flight is sand in motion.
    if (f.moved === before && this.np === 0 && !slug[0].air && !slug[1].air) this.quiet++;
    else this.quiet = 0;
    this.steps++;
  };

  /**
   * Each bed's centroid (cells from the glass centre), from every second row
   * and column. An empty bulb keeps a point where its sand would gather.
   */
  Sim.prototype._centroids = function () {
    var W = this.W, cell = this.cell, rowMin = this.rowMin, rowMax = this.rowMax;
    var g = this.geo, gate = this.gateY, cen = this.cen;
    for (var b = 0; b < 2; b++) {
      var y = b ? gate + 1 : this.topY, y1 = b ? this._botY : gate - 1;
      var sx = 0, sy = 0, n = 0;
      for (y += y & 1; y <= y1; y += 2) {
        var x0 = rowMin[y], x1 = rowMax[y], base = y * W, k = 0;
        for (var x = x0 + (x0 & 1); x <= x1; x += 2) {
          if (cell[base + x] >= REST) { sx += x; k++; }
        }
        if (k) { sy += y * k; n += k; }
      }
      if (n) {
        cen[2 * b] = sx / n + 0.5 - g.cx;
        cen[2 * b + 1] = sy / n + 0.5 - g.cy;
      } else {
        cen[2 * b] = 0;
        cen[2 * b + 1] = (b ? 0.80 : -0.40) * g.HB;
      }
    }
    this._cenAt = this.steps;
  };

  /**
   * n sweeps of bulb b's automaton along (ux, uy). Shaken sand loses its
   * friction (vibration fluidises a bed), so the stick-slip odds are lerped
   * toward free flow with the temperature T for these sweeps only.
   */
  Sim.prototype._caBulb = function (b, ux, uy, n, full, T) {
    var yLo = b ? this.gateY + 1 : 1, yHi = b ? this.H - 1 : this.gateY;
    var c0 = this.pCreep, s0 = this.pSlide, w0 = this.pWake, d0 = this.pDiag;
    var s = 1.2 * (T - MOT.fricS0) / MOT.fricS1;
    if (s > 0) {
      if (s > 1) s = 1;
      this.pCreep = c0 + (MOT.pCreepMax - c0) * s;
      this.pSlide = s0 + (MOT.pSlideMax - s0) * s;
      this.pWake = w0 + (MOT.pWakeMax - w0) * s;
      this.pDiag = d0 + (MOT.pDiagMax - d0) * s;
    }
    while (n-- > 0) this._ca(ux, uy, yLo, yHi, full);
    this.pCreep = c0; this.pSlide = s0; this.pWake = w0; this.pDiag = d0;
  };

  /* ---------------------------------------------------------------- *
   *  The bouncing bed (Mehta and Luck: a completely inelastic bed). The
   *  bed lifts when the field pulls it off its seat harder than the side
   *  walls hold it, and flies as one body (U, Z per bulb). Each column
   *  follows Z exactly until its leading grain meets glass, where it stops
   *  (a slam), so the bed deforms against a curved dome but never shreds.
   *  It lands, and its momentum becomes an impact, when Z returns to the
   *  seat.
   * ---------------------------------------------------------------- */
  Sim.prototype._flight = function (b) {
    var W = this.W, G = this.G, cell = this.cell, S = this.slug[b];
    var lo = this.colLo[b], hi = this.colHi[b], air = this.cair[b], off = this.cdOff[b], pin = this.cpin[b];
    var fx = this.bf[2 * b], pull = -this.bf[2 * b + 1] * S.seat;    // + pulls away from the seat
    var x0 = this._bx0, x1 = this._bx1, x, y, d;
    if (!S.air) {
      if (pull <= MOT.liftTh * G + MOT.muW * (fx < 0 ? -fx : fx)) return;
      // lift-off: every column holding sand rides along, whatever its shape
      var na = 0;
      for (x = x0; x <= x1; x++) {
        off[x] = 0; pin[x] = 0; air[x] = 0;
        for (y = lo[x]; y <= hi[x]; y++) {
          if (cell[y * W + x] >= REST) { air[x] = 1; na++; break; }
        }
      }
      if (!na) return;
      S.air = true; S.U = 0; S.Z = 0; S.kZ = 0;
    }
    S.U += pull * DT;
    S.Z += S.U * DT;
    var kZ = S.Z > 0 ? Math.floor(S.Z) : 0;
    var away = -S.seat, v = S.U < 0 ? -S.U : S.U, nAir = 0, nRide = 0;
    this._dLo = this.H; this._dHi = -1;
    for (x = x0; x <= x1; x++) {
      if (!air[x]) continue;
      d = kZ - off[x];
      if (pin[x] && d >= 0) { nAir++; continue; }      // still pressed to the far glass
      if (d > 0) {                                     // outward with the bed
        this._shiftCol(b, x, away * d);
        if (this._moved) off[x] = kZ;                  // the body rides with Z; strays compact behind it
        else {                                         // packed against the far glass: a slam
          pin[x] = 1;
          this._landing(b, x, away > 0 ? hi[x] + 1 : lo[x] - 1, this._n, v, away);
        }
      } else if (d < 0) {                              // back toward the seat
        this._shiftCol(b, x, away * d);
        off[x] = kZ;
        pin[x] = 0;
        if (!this._moved) {                            // packed on its seat: this column has landed
          this._landing(b, x, away > 0 ? lo[x] - 1 : hi[x] + 1, this._n, v, -away);
          air[x] = 0;
          continue;
        }
      }
      nAir++;
      if (!pin[x]) nRide++;
    }
    if (S.Z <= 0 && S.U <= 0) {
      // back on the seat: whatever still flies lands at once (inelastic)
      for (x = x0; x <= x1; x++) {
        if (!air[x]) continue;
        this._shiftCol(b, x, -away * 2);
        this._landing(b, x, away > 0 ? lo[x] - 1 : hi[x] + 1, this._n, v, -away);
        air[x] = 0; pin[x] = 0;
      }
      S.air = false; S.U = 0; S.Z = 0; nAir = 0;
    } else if (nAir > 0 && nRide === 0 && S.U > 0) {
      // the whole bed is against the far glass: it rests there now
      for (x = x0; x <= x1; x++) { air[x] = 0; pin[x] = 0; off[x] = 0; }
      S.air = false; S.U = 0; S.Z = 0; S.seat = -S.seat; nAir = 0;
    } else if (nAir === 0) {
      S.air = false; S.U = 0; S.Z = 0;
    }
    S.kZ = kZ;
    this.nAir[b] = nAir;
    if (this._dHi >= this._dLo) {                      // wake what the bed left and where it went
      var a = this.rowAct, y0 = this._dLo - 3, y1 = this._dHi + 3;
      if (y0 < 0) y0 = 0;
      if (y1 >= this.H) y1 = this.H - 1;
      for (; y0 <= y1; y0++) a[y0] = 2;
    }
  };

  /**
   * Move every grain of column x of bulb b by k cells along y without any
   * grain overtaking another (an order-preserving compaction against the
   * glass). Moved grains are written REST: a flying bed is packed sand, and
   * must not light up as sliding grains do. Sets _n (grains in the column)
   * and _moved (grains that moved), and widens the step's changed rows.
   */
  Sim.prototype._shiftCol = function (b, x, k) {
    var W = this.W, cell = this.cell, seed = this.seed;
    var L = this.colLo[b][x], Hh = this.colHi[b][x];
    var y, i, j, t, n = 0, moved = 0, limit, dLo = this._dLo, dHi = this._dHi;
    if (k > 0) {
      limit = Hh;
      for (y = Hh; y >= L; y--) {
        i = y * W + x;
        if (cell[i] < REST) continue;
        n++;
        t = y + k;
        if (t > limit) t = limit;
        if (t > y) {
          j = t * W + x;
          cell[j] = REST; seed[j] = seed[i]; cell[i] = EMPTY;
          limit = t - 1; moved++;
          if (y < dLo) dLo = y;
          if (t > dHi) dHi = t;
        } else limit = y - 1;
      }
    } else if (k < 0) {
      limit = L;
      for (y = L; y <= Hh; y++) {
        i = y * W + x;
        if (cell[i] < REST) continue;
        n++;
        t = y + k;
        if (t < limit) t = limit;
        if (t < y) {
          j = t * W + x;
          cell[j] = REST; seed[j] = seed[i]; cell[i] = EMPTY;
          limit = t + 1; moved++;
          if (t < dLo) dLo = t;
          if (y > dHi) dHi = y;
        } else limit = y + 1;
      }
    }
    this._n = n; this._moved = moved;
    this._dLo = dLo; this._dHi = dHi;
  };

  /**
   * Column x of bulb b (n grains) stopped against glass at speed v (cells/s),
   * moving along dir (±1 in y); endY is the row of the glass it struck.
   * This is where a shaken glass is heard and loaded: the thump (or the
   * clack of a slam into the far end), the heat the blow leaves in the sand,
   * a little spray off the surface, and the stress in the glass.
   */
  Sim.prototype._landing = function (b, x, endY, n, v, dir) {
    if (!n) return;
    var G = this.G, W = this.W, g = this.geo, f = this.frame, cell = this.cell;
    var nb = b ? this.total - this.nTop : this.nTop;
    if (nb < n) nb = n;
    var e2 = 0.5 * n * v * v;                          // the column's kinetic energy (grain = unit mass)
    var pan = (x + 0.5 - g.cx) / g.R, E = e2 / (G * g.HB * nb), m;
    if (pan < -1) pan = -1; else if (pan > 1) pan = 1;
    if (dir === this.slug[b].seat) {                   // landed on its seat: a thump
      m = this._thumpN[b];
      f.thump[2 * b + 1] = (f.thump[2 * b + 1] * m + pan * n) / (m + n);
      f.thump[2 * b] += E;
      this._thumpN[b] = m + n;
    } else {                                           // slammed into the far end: a clack
      m = this._slamN;
      f.slam[1] = (f.slam[1] * m + pan * n) / (m + n);
      f.slam[0] += E;
      this._slamN = m + n;
    }
    // the blow's energy, shared over the bulb's grains, heats the sand
    var T = this.agit[b] + e2 / (nb * G * 3);
    this.agit[b] = T > 3 ? 3 : T;
    this._landAt[b] = this.steps;
    if (v > 60 && (x & 7) === 0 && this.nev < EV_CAP) {
      var e = this.nev++, vs = v / Math.sqrt(G) / 20;
      this.evX[e] = pan;
      this.evV[e] = vs > 1 ? 1 : vs;
      this.evK[e] = 1 | (b ? 0 : 2);
    }
    // The free surface, the grain farthest from the end that took the blow,
    // stirs; above sprayV a few leave it as spray.
    var lo = this.colLo[b][x], hi = this.colHi[b][x], i = -1, y;
    if (dir > 0) { for (y = lo; y <= hi; y++) if (cell[y * W + x] >= REST) { i = y * W + x; break; } }
    else { for (y = hi; y >= lo; y--) if (cell[y * W + x] >= REST) { i = y * W + x; break; } }
    if (i >= 0) {
      var ps = this.reduced ? 0 : (this.quality >= 2 ? MOT.pSpray : (this.quality === 1 ? MOT.pSprayQ1 : 0));
      if (v > MOT.sprayV && ps > 0 && this.np < MOT.softCap && this.np < this.PCAP &&
          cell[i - dir * W] === EMPTY && this._rand() < ps) {
        var p = this.np++, e3 = 0.2 + 0.4 * this._rand();
        this.px[p] = x + 0.5;
        this.py[p] = y + 0.5 - dir * 0.6;
        this.pvx[p] = (this._rand() - 0.5) * 0.9 * v * e3;
        this.pvy[p] = -dir * v * e3;
        this.pseed[p] = this.seed[i];
        this.pinfo[p] = K_SPLASH;
        cell[i] = EMPTY;
        f.sprayed++;
      } else if (cell[i] === REST) cell[i] = MOVE;
      this._touchRow(y);
    }
    if (this.damageArmed && !this.reduced && endY >= 0 && endY < this.H) {
      var s = this.segOf[endY * W + x];
      if (s >= 0) this._load(s, v, n);
    }
  };

  /**
   * The stress pulse a column of n grains landing at v sends into wall
   * segment s: sub-critical crack growth with a fatigue limit. Stress goes
   * as v (water hammer), its duration as the column's height. Below the
   * fatigue limit (x ≤ xTh) a crack does not grow at all, which is why
   * firm shaking never cracks the glass however long it lasts.
   */
  Sim.prototype._load = function (s, v, n) {
    var k = this.segCrack[s];
    if (k >= 0 && this.cracks[k].sealed) return;      // a gold seam takes no more
    var x = this.segKt[s] * v / (Math.sqrt(this.G) * this.segS[s] * MOT.vc);
    if (x <= MOT.xTh) return;
    var h = n / MOT.hRef;
    if (h > 2) h = 2;
    var d = MOT.A * h * (Math.pow(x, MOT.n) - Math.pow(MOT.xTh, MOT.n));
    if (d > MOT.capCol) d = MOT.capCol;
    d += this.segP[s];
    this.segP[s] = d > MOT.Pmax ? MOT.Pmax : d;
    this._pendP = true;
  };

  /**
   * An agitated surface boils: grains hop off it. Each try takes the free
   * surface grain of a random column (or row, when the field lies across
   * the glass), facing away from the field, and launches it if the cell
   * beyond is free. The spray, the streaks, the mica flashes and the ticks
   * of these grains come for free from the particle code.
   */
  Sim.prototype._hops = function (b) {
    if (this.np >= MOT.softCap || this.np >= this.PCAP) return;
    var T = this.agit[b], cap = this.quality >= 2 ? MOT.hopMax : MOT.hopMaxQ1;
    var n = Math.floor((T - MOT.hopT) * 6 + this._rand());
    if (n > cap) n = cap;
    if (n <= 0) return;
    var fx = this.bf[2 * b], fy = this.bf[2 * b + 1], fm = Math.sqrt(fx * fx + fy * fy);
    if (fm < MOT.weightless * this.G) return;         // a floating glass has no "up"
    var ux = -fx / fm, uy = -fy / fm;                 // up, away from the field
    var k = dir8(ux, uy), W = this.W, cell = this.cell, step = DX[k] + DY[k] * W;
    var lo = this.colLo[b], hi = this.colHi[b], x0 = this._bx0, x1 = this._bx1;
    var yA = b ? this.gateY + 1 : this.topY, yB = b ? this._botY : this.gateY - 1;
    var Tc = T < 2 ? T : 2, i, j, x, y, p;
    for (var t = 0; t < n && this.np < MOT.softCap && this.np < this.PCAP; t++) {
      i = -1;
      if (uy * uy >= ux * ux) {
        x = x0 + ((this._rand() * (x1 - x0 + 1)) | 0);
        if (lo[x] > hi[x]) continue;
        if (uy < 0) { for (y = lo[x]; y <= hi[x]; y++) if (cell[y * W + x] >= REST) { i = y * W + x; break; } }
        else { for (y = hi[x]; y >= lo[x]; y--) if (cell[y * W + x] >= REST) { i = y * W + x; break; } }
      } else {
        y = yA + ((this._rand() * (yB - yA + 1)) | 0);
        var r0 = this.rowMin[y], r1 = this.rowMax[y];
        if (r0 > r1) continue;
        if (ux < 0) { for (x = r0; x <= r1; x++) if (cell[y * W + x] >= REST) { i = y * W + x; break; } }
        else { for (x = r1; x >= r0; x--) if (cell[y * W + x] >= REST) { i = y * W + x; break; } }
      }
      if (i < 0) continue;
      j = i + step;
      if (cell[j] !== EMPTY) continue;
      var sp = 40 + 160 * Tc * (0.3 + 0.7 * this._rand());
      var lat = (this._rand() + this._rand() + this._rand() - 1.5) * 120 * T;   // ≈ N(0, 60·T)
      p = this.np++;
      this.px[p] = (j % W) + 0.5;
      this.py[p] = ((j / W) | 0) + 0.5;
      this.pvx[p] = ux * sp + uy * lat;
      this.pvy[p] = uy * sp - ux * lat;
      this.pseed[p] = this.seed[i];
      this.pinfo[p] = K_SPLASH | 1;
      cell[i] = EMPTY;
      this._touchRow((i / W) | 0);
      this.frame.hops++;
    }
  };

  /**
   * Grains in the air on the motion path: a restructured copy of
   * _particles. Each feels the full field where it is, including the
   * Coriolis force, which turns it without changing its speed; a grain
   * that flies into a breach leaves the glass; and a grain is never handed
   * back to the lattice in the other bulb.
   */
  Sim.prototype._particlesM = function () {
    var W = this.W, cell = this.cell, g = this.geo, bf = this.bf;
    var px = this.px, py = this.py, pvx = this.pvx, pvy = this.pvy, pinfo = this.pinfo;
    var G = this.G, cx = g.cx, cy = g.cy, gateY = this.gateY, f = this.frame;
    var lam = this.mLam, w = this.mW, w2 = lam * w * w, la = lam * this.mAl;
    var Ax = this.mAx, Ay = this.mAy, Fx = G * this.gx + Ax, Fy = G * this.gy + Ay;
    // Coriolis, −2Ω×v = 2ω(v_y, −v_x), at √λ (sim speeds are slow-motion
    // real speeds), applied as an exact-norm Cayley rotation by c = √λ·ω·Δt:
    // explicit Euler would gain about 2 % of speed per step at 4π rad/s.
    var c = Math.sqrt(lam) * w * DT, cn = 1 / (1 + c * c), cA = (1 - c * c) * cn, cB = 2 * c * cn;
    var aLim = 0.02 * G;
    var calm = Ax * Ax + Ay * Ay < aLim * aLim && w < 0.2 && w > -0.2;
    var focus = calm && !this.flipping && this.gy > 0.9 ? this.focus : 0;
    var jx = MOT.jitX, jy = MOT.jitY, vMax = MOT.vMax, rV = MOT.retryV;
    var s = this.rng | 0;
    var vRef = Math.sqrt(2 * G * g.HB);
    var pRollStop = this.pRollStop;
    // each bulb's rolling frame: the lattice direction nearest its field
    var k0 = dir8(bf[0], bf[1]), k1 = dir8(bf[2], bf[3]);
    var a0 = DX[k0] + DY[k0] * W, l0 = DX[(k0 + 7) & 7] + DY[(k0 + 7) & 7] * W, r0 = DX[(k0 + 1) & 7] + DY[(k0 + 1) & 7] * W;
    var sl0 = DX[(k0 + 6) & 7] + DY[(k0 + 6) & 7] * W, sr0 = DX[(k0 + 2) & 7] + DY[(k0 + 2) & 7] * W;
    var a1 = DX[k1] + DY[k1] * W, l1 = DX[(k1 + 7) & 7] + DY[(k1 + 7) & 7] * W, r1b = DX[(k1 + 1) & 7] + DY[(k1 + 1) & 7] * W;
    var sl1 = DX[(k1 + 6) & 7] + DY[(k1 + 6) & 7] * W, sr1 = DX[(k1 + 2) & 7] + DY[(k1 + 2) & 7] * W;
    var m0 = Math.sqrt(bf[0] * bf[0] + bf[1] * bf[1]), m1 = Math.sqrt(bf[2] * bf[2] + bf[3] * bf[3]);
    var u0x = m0 > 0 ? bf[0] / m0 : this.gx, u0y = m0 > 0 ? bf[1] / m0 : this.gy;
    var u1x = m1 > 0 ? bf[2] / m1 : this.gx, u1y = m1 > 0 ? bf[3] / m1 : this.gy;

    for (var p = this.np - 1; p >= 0; p--) {
      var x = px[p], y = py[p];
      var rx = x - cx, ry = y - cy;
      var ax = Fx + w2 * rx + la * ry, ay = Fy + w2 * ry - la * rx;
      var vx = pvx[p] + ax * DT, vy = pvy[p] + ay * DT, t;
      if (c !== 0) { t = cA * vx + cB * vy; vy = cA * vy - cB * vx; vx = t; }
      var info = pinfo[p];

      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      if (focus && (info & K_MASK) === K_STREAM) {
        // a calm, upright stream necks down as it accelerates (as today)
        vx += (-(x - cx) * focus * 3.2 - vx * 1.6) * DT;
      }
      vx += ((s & 1023) - 511.5) * jx;
      vy += (((s >>> 10) & 1023) - 511.5) * jy;
      t = vx * vx + vy * vy;
      if (t > vMax * vMax) { t = vMax / Math.sqrt(t); vx *= t; vy *= t; }

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
      if (onGlass && this.holeMap !== null && this.holeMap[hit] !== 0) {
        this._escapeParticle(p, hit, vx, vy);         // out through the breach
        continue;
      }
      var top = ly < gateY;
      var bounces = info & 3;
      if (sp > 45 && bounces === 0) {
        if (top) f.impTop++;
        else if (onGlass) f.impGlass++;
        else f.impSand++;
        if (this.nev < EV_CAP) {
          var e = this.nev++;
          this.evX[e] = (lx - cx) / g.R;
          this.evV[e] = sp / vRef > 1 ? 1 : sp / vRef;
          this.evK[e] = (onGlass ? 0 : 1) | (top ? 2 : 0);
        }
      }

      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      var q1 = (s & 1023) / 1023, q2 = ((s >>> 10) & 1023) / 1023;
      var settle = false;
      // "down" here is the field this grain feels
      var am = Math.sqrt(ax * ax + ay * ay), ugx, ugy;
      if (am > 1e-6) { ugx = ax / am; ugy = ay / am; } else { ugx = this.gx; ugy = this.gy; }
      var ub = top ? u0x : u1x, vb = top ? u0y : u1y;

      if (onGlass) {
        // restitution off the curved glass (and off the closed neck, like glass)
        var nx = this.nrmX[hit] / 127, ny = this.nrmY[hit] / 127;
        if (nx === 0 && ny === 0 && sp > 0) { nx = -vx / sp; ny = -vy / sp; }
        var vn = vx * nx + vy * ny;
        if (vn < 0) {
          var rest = 0.16 + q1 * 0.2;
          vx -= (1 + rest) * vn * nx; vy -= (1 + rest) * vn * ny;
          vx *= 0.8; vy *= 0.8;
          vx += (q2 - 0.5) * sp * 0.18;
        }
        bounces++;
        if (bounces > 3 || sp < 70) settle = true;
      } else if (bounces < 2 && sp > 190 && q1 < 0.55) {
        // kinetic splash: a short hop off the sand before settling
        var hop = sp * (0.06 + q2 * 0.15);
        if (hop > 235) hop = 235;
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        var lat = ((s & 1023) / 511.5 - 1) * hop * 1.15;
        vx = -ugx * hop + ugy * lat;
        vy = -ugy * hop - ugx * lat;
        bounces++;
        info = (info & 3) | K_SPLASH;
        if (cell[hit] === REST) { cell[hit] = MOVE; this._touchRow((hit / W) | 0); }
      } else {
        // Landed on sand: keep tumbling down a slope steeper than sand can
        // hold, in this bulb's own frame; otherwise come to rest.
        var oM, oL, oR, oSL, oSR;
        if (top) { oM = a0; oL = l0; oR = r0; oSL = sl0; oSR = sr0; }
        else { oM = a1; oL = l1; oR = r1b; oSL = sl1; oSR = sr1; }
        var li = (ly | 0) * W + (lx | 0);
        if (cell[li] !== EMPTY) {
          li = this._freeNear(li, oM, true);
          if (li >= 0) { lx = (li % W) + 0.5; ly = ((li / W) | 0) + 0.5; }
        }
        if (li < 0) {
          vx = -ub * rV; vy = -vb * rV;               // buried: rise and look again
        } else {
          var rollL = cell[li + oSL] === EMPTY &&
            (cell[li + oL] === EMPTY || (cell[li + oSL + oL] === EMPTY && cell[li + oSL + oL + oL] === EMPTY &&
                                         cell[li + oSL + oL + oL + oL] === EMPTY));
          var rollR = cell[li + oSR] === EMPTY &&
            (cell[li + oR] === EMPTY || (cell[li + oSR + oR] === EMPTY && cell[li + oSR + oR + oR] === EMPTY &&
                                         cell[li + oSR + oR + oR + oR] === EMPTY));
          if ((rollL || rollR) && ((s >>> 20) & 255) >= pRollStop) {
            var side = ugy * vx - ugx * vy;
            var dir = (rollL && rollR) ? (side < 0 ? -1 : (side > 0 ? 1 : (q1 < 0.5 ? -1 : 1)))
                                       : (rollL ? -1 : 1);
            var run = 70 + q1 * 95, lift = 22 + q2 * 46;
            vx = ugy * run * dir - ugx * lift;
            vy = -ugx * run * dir - ugy * lift;
            if (bounces < 1) bounces = 1;
          } else {
            settle = true;
          }
        }
      }

      if (settle) {
        if (this._depositM(lx, ly, this.pseed[p], top ? k0 : k1, top)) {
          var last = --this.np;
          if (p !== last) {
            px[p] = px[last]; py[p] = py[last]; pvx[p] = pvx[last]; pvy[p] = pvy[last];
            this.pseed[p] = this.pseed[last]; pinfo[p] = pinfo[last];
          }
          continue;
        }
        vx = -ub * rV; vy = -vb * rV;                 // nowhere to settle: rise and try again
      }
      px[p] = lx; py[p] = ly; pvx[p] = vx; pvy[p] = vy;
      pinfo[p] = (info & K_MASK) | (bounces > 3 ? 3 : bounces);
    }
    this.rng = s || 0x9E3779B9;
  };

  /**
   * _deposit for the motion path: hand a grain back to the lattice as a
   * moving grain, along lattice direction k, never into the other bulb (a
   * grain that lands in one bulb must not reappear in the other: the clock
   * trusts nTop). False when there is no room; the grain then tries again.
   */
  Sim.prototype._depositM = function (x, y, sd, k, top) {
    var W = this.W, cell = this.cell;
    var i = (y | 0) * W + (x | 0);
    var m = DX[k] + DY[k] * W;
    if (cell[i] !== EMPTY) {
      i = this._freeNear(i, m, true);
      if (i < 0) return false;
    }
    if ((i < this.gateY * W) !== top) return false;
    cell[i] = MOVE; this.seed[i] = sd;
    this._touchRow((i / W) | 0);
    // the impact shakes the grains it lands on
    var l = DX[(k + 7) & 7] + DY[(k + 7) & 7] * W;
    var r = DX[(k + 1) & 7] + DY[(k + 1) & 7] * W;
    if (cell[i + m] === REST) cell[i + m] = MOVE;
    if (cell[i + l] === REST) cell[i + l] = MOVE;
    if (cell[i + r] === REST) cell[i + r] = MOVE;
    return true;
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
    // Sand leaves the neck as one thin thread that wanders a little — not as
    // rain across the whole orifice.
    var t = this.steps * DT;
    var mid = (this.gateX0 + this.gateX1 + 1) * 0.5;
    var wob = Math.sin(t * 2.1 + 1.9 * Math.sin(t * 0.53)) * 1.2 + Math.sin(t * 5.3 + 0.7) * 0.35;
    var fx = mid + wob + (this._rand() + this._rand() - 1) * 1.05;
    if (fx < this.gateX0 + 0.15) fx = this.gateX0 + 0.15;
    if (fx > this.gateX1 + 0.85) fx = this.gateX1 + 0.85;
    var y = this.gateY + 1;
    if (this.cell[y * this.W + (fx | 0)] !== EMPTY) return false;   // lower bulb is full
    var p = this.np++;
    this.px[p] = fx;
    this.py[p] = y + 0.05 + this._rand() * 0.6;
    this.pvx[p] = (this._rand() - 0.5) * 16;
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
  Sim.prototype._ca = function (gx, gy, yLo, yHi, forceFull) {
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
    // Inserted for motion: forceFull sweeps every row, asleep or not (shaken
    // sand moves everywhere at once, without asking the sleep map).
    var full = forceFull === true || this.flipping || gy < 0.7 || dith !== 0 || kA !== 0 || (this.steps & 63) === 0;
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

        // --- stick and slip (static vs. dynamic friction) ----------------
        // Sand does not creep, it lets go. A static grain holds until the
        // slope over four columns passes 3:4 (≈37°, the angle of maximum
        // stability). Once moving — or on smooth glass — it keeps running on
        // slopes as shallow as 1:2 and wakes its neighbours, so the surface
        // gives way in an avalanche and comes to rest near 30°, then builds
        // again. Averaged over time that is the ≈33° angle of repose.
        okL = cell[i + sl] === EMPTY && cell[i + sl + l] === EMPTY;
        okR = cell[i + sr] === EMPTY && cell[i + sr + r] === EMPTY;
        if (okL || okR) {
          if (cj === WALL) p = 256;
          else if (c === MOVE) p = pSlide;
          else {
            okL = okL && cell[i + sl + l + l] === EMPTY && cell[i + sl + l + l + l] === EMPTY;
            okR = okR && cell[i + sr + r + r] === EMPTY && cell[i + sr + r + r + r] === EMPTY;
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
                if (cell[j + m] === REST) cell[j + m] = MOVE;     // and the one it lands on
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
        vx += (-(x - cx) * focus * 3.2 - vx * 1.6) * DT;
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
      // Inserted for damage: a grain that flies into a breach leaves the
      // glass. holeMap stays null until the first breach, so an intact glass
      // never comes this way.
      if (onGlass && this.holeMap !== null && this.holeMap[hit] !== 0) {
        this._escapeParticle(p, hit, vx, vy);
        continue;
      }
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
      } else if (bounces < 2 && sp > 190 && r1 < 0.55) {
        // kinetic splash: a 2–5 cell hop off the sand before settling
        var hop = sp * (0.06 + r2 * 0.15);
        if (hop > 235) hop = 235;
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        var lat = ((s & 1023) / 511.5 - 1) * hop * 1.15;
        vx = -gx * hop + gy * lat;
        vy = -gy * hop - gx * lat;
        bounces++;
        info = (info & 3) | K_SPLASH;
        if (cell[hit] === REST) { cell[hit] = MOVE; this._touchRow((hit / W) | 0); }   // the struck grain stirs
      } else {
        // Landed on sand. If the surface here is steeper than sand can hold
        // (drop ≥ 3 over a run of 4 ≈ 37°) the grain keeps tumbling
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
            (cell[li + oL] === EMPTY || (cell[li + oSL + oL] === EMPTY && cell[li + oSL + oL + oL] === EMPTY &&
                                         cell[li + oSL + oL + oL + oL] === EMPTY));
          var rollR = cell[li + oSR] === EMPTY &&
            (cell[li + oR] === EMPTY || (cell[li + oSR + oR] === EMPTY && cell[li + oSR + oR + oR] === EMPTY &&
                                         cell[li + oSR + oR + oR + oR] === EMPTY));
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
   * `deep` (the motion path) climbs further through a tall shaken bed and
   * searches wider rings.
   */
  Sim.prototype._freeNear = function (i, m, deep) {
    var cell = this.cell, W = this.W, j = i, n = 0, N = cell.length;
    // Inserted for motion: deeper limits on request, and never an answer on
    // the other side of the closed neck. A grain that lands in one bulb must
    // not reappear in the other: that would break nTop, which the clock trusts.
    var climb = deep ? 96 : 14, rings = deep ? 12 : 8;
    var gate = this.gateY * W, top = i < gate;
    while (cell[j] >= REST && n < climb) { j -= m; n++; }
    if (cell[j] === EMPTY) {
      if ((j < gate) === top) return j;
      this.neckGuards++;
    }
    for (var r = 1; r <= rings; r++) {
      for (var dy = -r; dy <= r; dy++) {
        var row = i + dy * W;
        if (row < W || row >= N - W) continue;
        var st = (dy === -r || dy === r) ? 1 : 2 * r;
        for (var dx = -r; dx <= r; dx += st) {
          if (cell[row + dx] === EMPTY) {
            if ((row + dx < gate) === top) return row + dx;
            this.neckGuards++;
          }
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
    this._landSlugs();
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
    this._flipState();
  };

  /**
   * The rest of a flip: everything that belongs to the glass turns with it.
   * Bulb 0 becomes bulb 1, left becomes right, every cell i becomes N − 1 − i
   * and every vector changes sign, so a crack, its breach and its leak stay
   * on the same place of the glass.
   */
  Sim.prototype._flipState = function () {
    var W = this.W, H = this.H, N = W * H, k, h, t;
    // per-bulb vectors and states
    flipBulbPair(this.bf); flipBulbPair(this.bfSlow); flipBulbPair(this.cen);
    t = this.agit[0]; this.agit[0] = this.agit[1]; this.agit[1] = t;
    t = this.sweepAcc[0]; this.sweepAcc[0] = this.sweepAcc[1]; this.sweepAcc[1] = t;
    t = this._landAt[0]; this._landAt[0] = this._landAt[1]; this._landAt[1] = t;
    // the slugs trade states, not objects (a reader may keep sim.slug[0]);
    // both beds were just put down, so both sit on their seats
    var s0 = this.slug[0], s1 = this.slug[1];
    t = s0.air; s0.air = s1.air; s1.air = t;
    t = s0.U; s0.U = s1.U; s1.U = t;
    t = s0.Z; s0.Z = s1.Z; s1.Z = t;
    t = s0.kZ; s0.kZ = s1.kZ; s1.kZ = t;
    s0.seat = 1; s1.seat = 1;
    // the glass: damage, flaws, cracks and their breaches
    flipSegArray(this.segD); flipSegArray(this.segP);
    flipSegArray(this.segS); flipSegArray(this.segKt);
    flipSegArray(this.segCrack);
    if (this.warnSeg >= 0) this.warnSeg = flipSegIndex(this.warnSeg);
    this.glassFlip ^= 1;
    if (this.holeMap !== null) this.holeMap.reverse();
    for (k = 0; k < this.cracks.length; k++) {
      var cr = this.cracks[k];
      cr.seg = flipSegIndex(cr.seg);
      cr.bulb = 1 - cr.bulb; cr.side = -cr.side;
      cr.x = W - 1 - cr.x; cr.y = H - 1 - cr.y;
      for (h = 0; h < cr.nh; h++) cr.holes[h] = N - 1 - cr.holes[h];
      for (h = 0; h < cr.nm; h++) cr.mouth[h] = N - 1 - cr.mouth[h];
    }
    if (this.cracks.length) this.crackRev++;
    // grains already out of the glass but not yet handed to the app
    for (k = 0; k < this.escN; k++) {
      this.escX[k] = W - this.escX[k]; this.escY[k] = H - this.escY[k];
      this.escVX[k] = -this.escVX[k]; this.escVY[k] = -this.escVY[k];
    }
  };

  /**
   * Put every airborne grain to rest on the surface of its own column, in its own
   * bulb, so a bulk move can never bury a grain in flight.
   */
  Sim.prototype._landAll = function () {
    this._landSlugs();
    var W = this.W, cell = this.cell, gate = this.gateY, keep = 0;
    for (var p = 0; p < this.np; p++) {
      var x = this.px[p] | 0, y = this.py[p] | 0, i = y * W + x, j = i;
      while (cell[j] >= REST) j -= W;                  // climb out of the sand; glass and the closed neck stop it
      if (cell[j] !== EMPTY) {                         // met the glass: look close by, never across the neck
        j = this._freeNear(i, W);
        if (j >= 0 && (((j / W) | 0) < gate) !== (y < gate)) j = -1;
      }
      if (j < 0) {                                     // nowhere to put it: let it keep flying
        this.px[keep] = this.px[p]; this.py[keep] = this.py[p];
        this.pvx[keep] = this.pvx[p]; this.pvy[keep] = this.pvy[p];
        this.pseed[keep] = this.pseed[p]; this.pinfo[keep] = this.pinfo[p];
        keep++; continue;
      }
      this._settleAt(j % W, (j / W) | 0, this.pseed[p]);
    }
    this.np = keep;
  };

  /* ---------------------------------------------------------------- *
   *  Fast-forward: the page was asleep and the clock ran on. Move `n`
   *  grains through the neck in bulk (no per-grain flight) and relax.
   * ---------------------------------------------------------------- */
  Sim.prototype.fastForward = function (n) {
    this._landSlugs();
    this._landAll();
    this._izAt = -1;
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
   *  The glass: damage, cracks, breaches and leaks
   *
   *  Damage is kept per wall segment. A crack is a record on one segment.
   *  Once it breaks through, its holes are wall cells flagged in holeMap:
   *  they stay WALL, so census, reset and the drawing never see them. Its
   *  mouth is the inside cells that touch the holes. Grains leave through
   *  the mouth (_leak) or fly out through a hole (_particles).
   * ---------------------------------------------------------------- */

  /** Queue a damage event for this frame: Sim.DMG type, crack index (−1 none), level, pan. */
  Sim.prototype._pushDmg = function (type, k, level, x) {
    var f = this.frame, e = f.dmgN;
    if (e >= DMG_RING) return;
    f.dmgType[e] = type; f.dmgK[e] = k; f.dmgLevel[e] = level; f.dmgX[e] = x;
    f.dmgN = e + 1;
  };

  /** Stereo position of lattice column x: −1 at the left wall … +1 at the right. */
  Sim.prototype._panX = function (x) {
    var g = this.geo, p = (x + 0.5 - g.cx) / g.R;
    return p < -1 ? -1 : (p > 1 ? 1 : p);
  };

  /** Stereo position of wall segment s. */
  Sim.prototype._panSeg = function (s) {
    if (s < 0) return 0;
    var r = profile(((s % WALL_BINS) + 0.5) / WALL_BINS, this.geo) / this.geo.R;
    return ((s / WALL_BINS) | 0) & 1 ? r : -r;
  };

  /**
   * dMax and warnSeg: the worst damage on a segment that has no crack yet,
   * and where it is. Crossing each creak level upward sounds it once (WARN,
   * when `emit`); the level re-arms when the damage falls well below it.
   */
  Sim.prototype._scanDamage = function (emit) {
    var segD = this.segD, sc = this.segCrack, best = 0, at = -1, s, L;
    for (s = 0; s < WALL_SEGS; s++) {
      if (sc[s] < 0 && segD[s] > best) { best = segD[s]; at = s; }
    }
    this.dMax = best;
    this.warnSeg = at;
    var th = MOT.warn, latch = this.warnLatch;
    for (L = 0; L < 4; L++) {
      if (!latch[L]) {
        if (best >= th[L]) {
          latch[L] = 1;
          if (emit) this._pushDmg(Sim.DMG.WARN, -1, L + 1, this._panSeg(at));
        }
      } else if (best < th[L] - MOT.warnRearm) latch[L] = 0;
    }
  };

  /**
   * One step of the glass. A hard lateral shake bends the waist like a beam
   * held by the caps (motion path, armed only). Pending load becomes damage
   * no faster than rMax (a crack runs at a bounded speed, so one blow can
   * never do what sustained cycling does) and an unabsorbed blow fades.
   * Micro-damage in glass that has not cracked arrests and fades (τ tauHeal);
   * a stretch that reaches 1 cracks, up to maxCracks per glass; a crack
   * grows with further damage, breaks through and widens. Then the creaks.
   */
  Sim.prototype._damageStep = function (motion) {
    var segD = this.segD, segP = this.segP, sc = this.segCrack, s, p, d;
    if (motion && this.damageArmed && !this.reduced) {
      var gp = (this.mAx < 0 ? -this.mAx : this.mAx) / this.G;
      if (gp > MOT.gamTh) {
        var r = (Math.pow(gp / MOT.gamC, MOT.nB) - Math.pow(MOT.gamTh / MOT.gamC, MOT.nB)) * DT / MOT.tauB;
        if (r > MOT.capB) r = MOT.capB;
        for (var q = 0; q < 4; q++) {
          for (var u = 0; u < MOT.bendBins; u++) {
            s = q * WALL_BINS + u;
            if (sc[s] >= 0 && this.cracks[sc[s]].sealed) continue;
            d = r * Math.pow(this.segKt[s] / this.segS[s], MOT.nB);
            if (d > MOT.capB) d = MOT.capB;
            p = segP[s] + d;
            segP[s] = p > MOT.Pmax ? MOT.Pmax : p;
            this._pendP = true;
          }
        }
      }
    }
    if (this._pendP) {
      var cap = MOT.rMax * DT, kP = Math.exp(-DT / MOT.tauP), pend = false;
      for (s = 0; s < WALL_SEGS; s++) {
        p = segP[s];
        if (p <= 0) continue;
        var take = p < cap ? p : cap;
        d = segD[s] + take;
        segD[s] = d > MOT.Dcap ? MOT.Dcap : d;
        p = (p - take) * kP;
        if (p < 1e-7) p = 0; else pend = true;
        segP[s] = p;
      }
      this._pendP = pend;
    }
    var heal = 1 - DT / MOT.tauHeal, full = this.cracks.length >= MOT.maxCracks;
    for (s = 0; s < WALL_SEGS; s++) {
      d = segD[s];
      if (d <= 0) continue;
      if (sc[s] >= 0) { this._grow(sc[s]); continue; }
      if (d < 1) { segD[s] = d * heal; continue; }
      if (full) { segD[s] = 0.999; continue; }        // the glass has its three
      this._initCrack(s, -1);
      full = this.cracks.length >= MOT.maxCracks;
    }
    this._scanDamage(true);
  };

  /**
   * Crack k takes the damage its segment gained since it last grew. K grows
   * as √a, so a longer crack runs faster and grows in audible jumps (GROW
   * each time floor(L/growStep) rises). Past Lhole it breaks through; past
   * Lhole·(1 + widen·w) its breach widens by a cell.
   */
  Sim.prototype._grow = function (k) {
    var cr = this.cracks[k], D = this.segD[cr.seg];
    if (cr.sealed || D <= cr.D0) return;
    var L0 = cr.L, L = L0 + (D - cr.D0) * MOT.growK * (1 + L0 / MOT.growL);
    if (L > MOT.Lmax) L = MOT.Lmax;
    cr.D0 = D;
    if (L === L0) return;
    cr.L = L;
    if (((L / 2) | 0) !== ((L0 / 2) | 0)) this.crackRev++;    // the drawing changes every 2 cells
    var st = MOT.growStep;
    if (((L / st) | 0) > ((L0 / st) | 0)) this._pushDmg(Sim.DMG.GROW, k, (L / st) | 0, this._panX(cr.x));
    if (cr.nh === 0) {
      if (L > MOT.Lhole) this._openHole(cr, true);
    } else if (cr.nh < MOT.wMax && L > MOT.Lhole * (1 + MOT.widen * cr.w)) {
      this._widenHole(cr, true);
    }
  };

  /**
   * Where a crack in segment s starts: the wall cell beside the inside, on
   * the row nearest the middle of the segment, and never within gateGuard
   * rows of the gate (the waist itself never opens, so the bulbs are never
   * joined). A segment at the waist starts on the shoulder just outside.
   */
  Sim.prototype._crackSite = function (s) {
    var W = this.W, H = this.H, g = this.geo, gate = this.gateY, guard = MOT.gateGuard;
    var lower = s >= 2 * WALL_BINS, right = ((s / WALL_BINS) | 0) & 1, bin = s % WALL_BINS;
    var uMid = (bin + 0.5) / WALL_BINS, best = -1, bestD = 2;
    var y0 = lower ? gate + guard : 1, y1 = lower ? H - 2 : gate - guard;
    for (var y = y0; y <= y1; y++) {
      if (this.rowMin[y] > this.rowMax[y]) continue;
      var dy = y + 0.5 - g.cy, u = (dy < 0 ? -dy : dy) / g.HB, b = (u * WALL_BINS) | 0;
      if (b > WALL_BINS - 1) b = WALL_BINS - 1;
      if (b !== bin) continue;
      var d = u > uMid ? u - uMid : uMid - u;
      if (d < bestD) { bestD = d; best = y; }
    }
    if (best < 0) best = lower ? gate + guard : gate - guard;
    return best * W + (right ? this.rowMax[best] + 1 : this.rowMin[best] - 1);
  };

  /** A wall cell that touches the inside, in segment block `block`, clear of the gate. */
  Sim.prototype._wallSite = function (i, block) {
    if (this.cell[i] !== WALL || this.segOf[i] < 0) return false;
    if (((this.segOf[i] / WALL_BINS) | 0) !== block) return false;
    var dy = ((i / this.W) | 0) - this.gateY;
    return block >= 2 ? dy >= MOT.gateGuard : dy <= -MOT.gateGuard;
  };

  /** A crack record on segment s, starting at wall cell i (no events). */
  Sim.prototype._makeCrack = function (s, i, seed) {
    var W = this.W, g = this.geo, x = i % W, y = (i / W) | 0, dy = y + 0.5 - g.cy;
    var u = (dy < 0 ? -dy : dy) / g.HB;
    var cr = {
      id: this._crackId++,
      seg: s,
      bulb: s >= 2 * WALL_BINS ? 1 : 0,  // 0 above the neck in the lattice as it stands
      side: ((s / WALL_BINS) | 0) & 1 ? 1 : -1,
      u: u > 0.999 ? 0.999 : u,          // 0 neck … 1 far end
      x: x, y: y,                        // origin: the wall cell it starts from
      seed: seed >>> 0,                  // shapes the drawing of its path
      L: MOT.L0,                         // length, cells
      w: 0,                              // breach width, cells (0 … 3)
      sealed: false,
      holes: new Int32Array(MOT.wMax), nh: 0,
      mouth: new Int32Array(8 * MOT.wMax), nm: 0,
      born: this.steps,
      D0: this.segD[s],                  // the damage when it last grew
      credit: 0,                         // grains the leak owes
      mi: 0                              // mouth cell the leak tries first
    };
    this.segCrack[s] = this.cracks.length;
    this.cracks.push(cr);
    return cr;
  };

  /** A crack starts in segment s, at wall cell `at` (−1: the usual site). Emits CRACK. */
  Sim.prototype._initCrack = function (s, at) {
    var cr = this._makeCrack(s, at >= 0 ? at : this._crackSite(s), this._rand() * 4294967296);
    this.crackRev++;
    this._pushDmg(Sim.DMG.CRACK, this.cracks.length - 1, 0, this._panX(cr.x));
    this._scanDamage(false);
    return cr;
  };

  /** The crack breaks through: its origin wall cell becomes a hole. */
  Sim.prototype._openHole = function (cr, emit) {
    if (cr.nh > 0) return false;
    this._addHole(cr, cr.y * this.W + cr.x);
    if (emit) this._pushDmg(Sim.DMG.BREACH, this.cracks.indexOf(cr), cr.w, this._panX(cr.x));
    return true;
  };

  /** The breach widens by one more wall cell. */
  Sim.prototype._widenHole = function (cr, emit) {
    if (cr.nh === 0 || cr.nh >= MOT.wMax) return false;
    var j = this._nextHoleCell(cr);
    if (j < 0) return false;
    this._addHole(cr, j);
    if (emit) this._pushDmg(Sim.DMG.WIDEN, this.cracks.indexOf(cr), cr.w, this._panX(cr.x));
    return true;
  };

  Sim.prototype._addHole = function (cr, i) {
    cr.holes[cr.nh++] = i;
    cr.w = cr.nh;
    if (this.holeMap === null) this.holeMap = this._holeBuf;
    if (!cr.sealed) this.holeMap[i] = 1;
    this._buildMouth(cr);
    this._countOpen();
    this.crackRev++;
  };

  /**
   * The next wall cell to give way: a neighbour of the breach on the same
   * segment (else on the same side of the same bulb), clear of the gate, and
   * the one most open to the inside, so the breach runs along the glass.
   */
  Sim.prototype._nextHoleCell = function (cr) {
    var W = this.W, block = (cr.seg / WALL_BINS) | 0, best = -1, bestN = 0;
    for (var pass = 0; pass < 2 && best < 0; pass++) {
      for (var h = 0; h < cr.nh; h++) {
        for (var k = 0; k < 8; k++) {
          var j = cr.holes[h] + DX[k] + DY[k] * W;
          if (!this._wallSite(j, block)) continue;
          if (pass === 0 && this.segOf[j] !== cr.seg) continue;
          if (this._isHole(j)) continue;
          var n = this._insideAround(j);
          if (n > bestN) { bestN = n; best = j; }
        }
      }
    }
    return best;
  };

  /** True if wall cell j is already a hole of some crack. */
  Sim.prototype._isHole = function (j) {
    for (var k = 0; k < this.cracks.length; k++) {
      var cr = this.cracks[k];
      for (var h = 0; h < cr.nh; h++) if (cr.holes[h] === j) return true;
    }
    return false;
  };

  /** How many of cell i's eight neighbours lie inside the glass. */
  Sim.prototype._insideAround = function (i) {
    var W = this.W, n = 0;
    for (var k = 0; k < 8; k++) {
      var j = i + DX[k] + DY[k] * W, x = j % W, y = (j / W) | 0;
      if (x >= this.rowMin[y] && x <= this.rowMax[y]) n++;
    }
    return n;
  };

  /** The mouth: inside cells of the crack's own bulb that touch its holes. */
  Sim.prototype._buildMouth = function (cr) {
    var W = this.W, gate = this.gateY, m = cr.mouth, nm = 0, q;
    for (var h = 0; h < cr.nh; h++) {
      for (var k = 0; k < 8; k++) {
        var j = cr.holes[h] + DX[k] + DY[k] * W, x = j % W, y = (j / W) | 0;
        if (x < this.rowMin[y] || x > this.rowMax[y]) continue;     // not inside
        if ((y < gate) !== (cr.bulb === 0)) continue;               // the other bulb
        for (q = 0; q < nm; q++) if (m[q] === j) break;
        if (q === nm && nm < m.length) m[nm++] = j;
      }
    }
    cr.nm = cr.sealed ? 0 : nm;
  };

  Sim.prototype._countOpen = function () {
    var n = 0;
    for (var k = 0; k < this.cracks.length; k++) {
      if (!this.cracks[k].sealed && this.cracks[k].nh > 0) n++;
    }
    this.nOpen = n;
    if (!n) this._leakLive = false;
  };

  /**
   * Grains at the mouth of an open breach leave the glass. The pressure
   * through the hole follows how the bulb's field leans on it: fully when it
   * points out of the hole, a little when the sand runs past it, not at all
   * when the hole faces up and away from the sand. The rate is 2-D Beverloo
   * flow with jamming: a breach one grain wide arches over and jams at rest,
   * a wider one trickles, and shaking breaks the arches.
   */
  Sim.prototype._leak = function () {
    var cracks = this.cracks, cell = this.cell, bf = this.bf, G = this.G, live = false;
    for (var k = 0; k < cracks.length; k++) {
      var cr = cracks[k];
      if (cr.sealed || cr.nh === 0 || cr.nm === 0) continue;
      var b = cr.bulb, fx = bf[2 * b], fy = bf[2 * b + 1], fm = Math.sqrt(fx * fx + fy * fy);
      var P = 0;
      if (fm > 0) {
        // f̂·n̂_out, where the stored normal points into the glass
        var o = cr.holes[0];
        P = MOT.leakP0 - (fx * this.nrmX[o] + fy * this.nrmY[o]) / (127 * fm);
        if (P < 0) P = 0; else if (P > MOT.leakPmax) P = MOT.leakPmax;
        var r = Math.sqrt(fm / G);
        P *= r < 2 ? r : 2;
      }
      var T = this.agit[b], wj = cr.w - MOT.leakJam;
      var Q = P * ((wj > 0 ? MOT.Q0 * Math.pow(wj, 1.5) : 0) + MOT.leakT * cr.w * (T < 1 ? T : 1));
      var c = cr.credit + Q * DT;
      if (c > MOT.leakCap) c = MOT.leakCap;
      // one grain per mouth cell per step, while the credit lasts
      var nm = cr.nm, q = cr.mi < nm ? cr.mi : 0, sand = false;
      for (var n = 0; n < nm; n++) {
        var i = cr.mouth[q];
        if (cell[i] >= REST) {
          sand = true;
          if (c >= 1) { this._escapeAt(i, cr); c -= 1; }
        }
        if (++q === nm) q = 0;
      }
      cr.mi = cr.mi + 1 < nm ? cr.mi + 1 : 0;
      cr.credit = c;
      if (sand && Q > 0) live = true;
    }
    this._leakLive = live;
  };

  /** The grain in mouth cell i leaves through the nearest hole of crack cr. */
  Sim.prototype._escapeAt = function (i, cr) {
    var W = this.W, sd = this.seed[i], ix = i % W, iy = (i / W) | 0;
    this.cell[i] = EMPTY;
    this._touchRow(iy);
    this._lose(i < this.gateY * W);
    var o = cr.holes[0], best = 1e9;
    for (var h = 0; h < cr.nh; h++) {
      var j = cr.holes[h], dx = (j % W) - ix, dy = ((j / W) | 0) - iy, d = dx * dx + dy * dy;
      if (d < best) { best = d; o = j; }
    }
    var nx = -this.nrmX[o] / 127, ny = -this.nrmY[o] / 127;
    // out through the hole at a walking pace, scattered a little along the wall
    // (drawn whether or not the ring has room, so the sand never depends on the app)
    var sp = MOT.escV + MOT.escVr * this._rand();
    var tg = (this._rand() + this._rand() - 1) * 2.449 * MOT.escTan;     // ≈ N(0, escTan)
    this._record((o % W) + 0.5 + nx, ((o / W) | 0) + 0.5 + ny,
                 nx * sp - ny * tg, ny * sp + nx * tg, sd);
  };

  /** Particle p flew into hole cell `hit` at (vx, vy): it leaves the glass as it is. */
  Sim.prototype._escapeParticle = function (p, hit, vx, vy) {
    var W = this.W, last;
    this._lose(this.py[p] < this.gateY);
    var nx = -this.nrmX[hit] / 127, ny = -this.nrmY[hit] / 127;
    this._record((hit % W) + 0.5 + nx, ((hit / W) | 0) + 0.5 + ny, vx, vy, this.pseed[p]);
    last = --this.np;
    if (p !== last) {
      this.px[p] = this.px[last]; this.py[p] = this.py[last];
      this.pvx[p] = this.pvx[last]; this.pvy[p] = this.pvy[last];
      this.pseed[p] = this.pseed[last]; this.pinfo[p] = this.pinfo[last];
    }
  };

  /** A grain has left the glass, from above the neck when `top`. */
  Sim.prototype._lose = function (top) {
    this.total--;
    this.lost++;
    if (top) { this.nTop--; this.leakedTop++; } else this.leakedBottom++;
    this.frame.leaked++;
    this._leakStep = this.steps;
  };

  /** Hand an escaped grain to the app: lattice cells, cells/s, vessel frame. */
  Sim.prototype._record = function (x, y, vx, vy, sd) {
    var g = this.geo, p = (x - g.cx) / g.R;
    this.frame.leakX = p < -1 ? -1 : (p > 1 ? 1 : p);
    if (this.escN >= ESC_RING) return;     // full until drained (still counted in lost)
    var e = this.escN++;
    this.escX[e] = x; this.escY[e] = y;
    this.escVX[e] = vx; this.escVY[e] = vy;
    this.escS[e] = sd;
  };

  /**
   * Crack the glass at wall segment `seg`, for tests and debugging: a crack
   * at least L cells long, breached w cells wide (0 … 3). Emits CRACK when
   * it starts and BREACH when it breaks through. Returns the crack record, or
   * null when the segment is invalid or the glass already has its three.
   */
  Sim.prototype.forceCrack = function (seg, L, w) {
    if (!isIndex(seg) || seg >= WALL_SEGS) return null;
    var k = this.segCrack[seg], cr;
    if (k >= 0) cr = this.cracks[k];
    else {
      if (this.cracks.length >= MOT.maxCracks) return null;
      if (this.segD[seg] < 1) this.segD[seg] = 1;
      cr = this._initCrack(seg, -1);
    }
    if (cr.sealed) return cr;                       // mended seams do not reopen
    L = +L;
    if (L > cr.L) cr.L = L < MOT.Lmax ? L : MOT.Lmax;
    w = w | 0;
    if (w > MOT.wMax) w = MOT.wMax;
    if (w > 0) this._openHole(cr, true);
    while (cr.nh < w) if (!this._widenHole(cr, false)) break;
    this.crackRev++;
    return cr;
  };

  /**
   * Kintsugi: gold flows into every open crack. Its breach closes at once,
   * so leaking stops within a step; the mended stretch starts again from no
   * damage and is half as strong again as it was. The timer is untouched.
   * Emits SEAL for each crack and returns how many were sealed.
   */
  Sim.prototype.sealCracks = function () {
    var n = 0;
    for (var k = 0; k < this.cracks.length; k++) {
      var cr = this.cracks[k];
      if (cr.sealed) continue;
      cr.sealed = true;
      for (var h = 0; h < cr.nh; h++) this.holeMap[cr.holes[h]] = 0;
      cr.nm = 0; cr.credit = 0;
      this.segD[cr.seg] = 0; this.segP[cr.seg] = 0;
      this.segS[cr.seg] *= MOT.sealS;
      this._pushDmg(Sim.DMG.SEAL, k, 0, this._panX(cr.x));
      n++;
    }
    if (n) {
      this._countOpen();
      this.crackRev++;
      this._scanDamage(false);
    }
    return n;
  };

  /**
   * The glass's damage for the session, or null while it is pristine:
   * {v: 1, seed, W, f?, d?, c: [[seg, x, y, seed, L, w, sealed, holes…]],
   * lost, lt, lb}. Cells are lattice indices as the glass stands now; f
   * marks an odd number of flips since its flaws were drawn, and d (damage
   * to 3 dp) is left out while every segment is below 0.01.
   */
  Sim.prototype.serializeDamage = function () {
    var segD = this.segD, big = false, s, k, h;
    for (s = 0; s < WALL_SEGS; s++) if (segD[s] >= 0.01) { big = true; break; }
    if (!big && !this.cracks.length && !this.lost) return null;
    var o = { v: 1, seed: this.glassSeed >>> 0, W: this.W };
    if (this.glassFlip) o.f = 1;
    if (big) {
      var d = new Array(WALL_SEGS);
      for (s = 0; s < WALL_SEGS; s++) d[s] = Math.round(segD[s] * 1000) / 1000;
      o.d = d;
    }
    var c = [];
    for (k = 0; k < this.cracks.length; k++) {
      var cr = this.cracks[k];
      var e = [cr.seg, cr.x, cr.y, cr.seed >>> 0, Math.round(cr.L * 10) / 10, cr.w, cr.sealed ? 1 : 0];
      for (h = 0; h < cr.nh; h++) e.push(cr.holes[h]);
      c.push(e);
    }
    o.c = c;
    o.lost = this.lost; o.lt = this.leakedTop; o.lb = this.leakedBottom;
    return o;
  };

  /**
   * Rebuild what serializeDamage() saved, on a glass just reset to the saved
   * total: its flaws, damage, cracks, breaches and mouths. Anything malformed
   * or from another glass is refused whole, before anything is touched (so a
   * glass just reset stays pristine), and returns false. Emits no events.
   */
  Sim.prototype.restoreDamage = function (o) {
    if (!o || typeof o !== 'object' || o.v !== 1) return false;
    var W = this.W, H = this.H, N = W * H, d = o.d, c = o.c, s, k, h, q, e;
    if ((o.W !== undefined && o.W !== W) || !isIndex(o.seed)) return false;
    if (d !== undefined) {
      if (!Array.isArray(d) || d.length !== WALL_SEGS) return false;
      for (s = 0; s < WALL_SEGS; s++) {
        if (!(typeof d[s] === 'number' && d[s] >= 0 && d[s] < 1000)) return false;
      }
    }
    if (c === undefined) c = [];
    if (!Array.isArray(c) || c.length > MOT.maxCracks) return false;
    for (k = 0; k < c.length; k++) {
      e = c[k];
      if (!Array.isArray(e) || e.length < 7) return false;
      var seg = e[0], x = e[1], y = e[2], w = e[5];
      if (!isIndex(seg) || seg >= WALL_SEGS || !isIndex(x) || x >= W || !isIndex(y) || y >= H) return false;
      for (q = 0; q < k; q++) if (c[q][0] === seg) return false;      // one crack per segment
      var block = (seg / WALL_BINS) | 0, i0 = y * W + x;
      if (!this._wallSite(i0, block)) return false;
      if (!isIndex(e[3]) || !(typeof e[4] === 'number' && e[4] >= 0 && e[4] <= MOT.Lmax)) return false;
      if (!isIndex(w) || w > MOT.wMax || e.length !== 7 + w) return false;
      if (e[6] !== 0 && e[6] !== 1 && e[6] !== true && e[6] !== false) return false;
      if (w > 0 && e[7] !== i0) return false;                         // a breach opens at the origin
      for (h = 7; h < e.length; h++) {
        if (!isIndex(e[h]) || e[h] >= N || !this._wallSite(e[h], block)) return false;
        for (q = 7; q < h; q++) if (e[q] === e[h]) return false;
        for (q = 0; q < k; q++) if (c[q].indexOf(e[h], 7) >= 0) return false;
      }
    }

    this._clearDamage();
    this.glassSeed = o.seed;
    this.glassFlip = o.f ? 1 : 0;
    this._drawFlaws();
    if (d) for (s = 0; s < WALL_SEGS; s++) this.segD[s] = d[s];
    for (k = 0; k < c.length; k++) {
      e = c[k];
      var cr = this._makeCrack(e[0], e[2] * W + e[1], e[3]);
      cr.L = e[4];
      cr.sealed = !!e[6];
      for (h = 7; h < e.length; h++) cr.holes[cr.nh++] = e[h];
      cr.w = cr.nh;
      if (cr.nh) {
        if (this.holeMap === null) this.holeMap = this._holeBuf;
        if (!cr.sealed) for (h = 0; h < cr.nh; h++) this.holeMap[cr.holes[h]] = 1;
      }
      this._buildMouth(cr);
      if (cr.sealed) this.segS[cr.seg] *= MOT.sealS;
    }
    // a stretch with no crack never holds a whole unit of damage
    for (s = 0; s < WALL_SEGS; s++) {
      if (this.segCrack[s] < 0 && this.segD[s] > 0.999) this.segD[s] = 0.999;
    }
    this.lost = isIndex(o.lost) ? o.lost : 0;
    this.leakedTop = isIndex(o.lt) ? o.lt : 0;
    this.leakedBottom = isIndex(o.lb) ? o.lb : 0;
    this._countOpen();
    this.crackRev++;
    this._scanDamage(false);         // creak levels already passed stay quiet
    return true;
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
      // how the sand takes the light: surface rim (levels), share of glossy
      // grains and their extra sparkle, highlight tint, soft bloom
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.12, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [255, 214, 150],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.04
      },
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
      glint: [255, 226, 150],
      // black sand only reads if it is *lit*: a strong rim on the surface,
      // many glassy facets that catch the key light, and a soft bloom
      light: {
        rim: [10, 5], aoMax: 5, gloss: 0.24, glossBoost: 12, hl: 1.15, tint: [238, 234, 240],
        bloom: 0.85, bloomColor: [255, 224, 176],
        emit: { mica: 0.34, gloss: 0.04, rim: 0.18, haze: 0.010 }, backlight: 0.09
      },
      glass: { tint: [214, 206, 196], smoke: 0.30 },
      // satin, slightly aged brass: present, never glaring
      cap: { kind: 'brass', hi: [196, 170, 108], mid: [136, 110, 58], lo: [58, 44, 18] },
      glow: [204, 160, 84]
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
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.14, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [214, 230, 255],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.045
      },
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
   *  Glass — rendered, not drawn
   *
   *  The vessel is a surface of revolution, so every pixel of it has an
   *  exact 3-D normal. A small fragment shader lights that surface the way
   *  a renderer would: Fresnel reflection of a studio (softbox, strip,
   *  kickers behind for the bright rim, one small hard lamp), the mirrored
   *  second highlight of the far wall, absorption along the true path
   *  through the shell, and light bent through the solid rim. The room stays
   *  put while the glass turns, so highlights slide across it.
   * ==================================================================== */
  var GLASS_VS = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  var GLASS_FS = [
    'precision highp float;',
    'uniform vec2 uRes;',      // drawing buffer, px
    'uniform vec2 uBox;',      // the same rectangle in cells
    'uniform vec4 uGeo;',      // R, HB, RN, equator
    'uniform float uWall;',    // wall thickness, cells
    'uniform float uRot;',     // vessel against the room, rad clockwise
    'uniform float uPass;',    // 0 far wall (behind the sand), 1 near wall
    'uniform vec3 uAbs;',      // absorption per cell of glass
    'uniform vec3 uGlow;',     // warm bounce from the desk
    'uniform float uPx;',      // cells per pixel (edge anti-aliasing)
    'uniform float uGain;',    // exposure

    'float prof(float u) {',
    '  if (u >= 1.0) return 0.0;',
    '  float c = uGeo.w;',
    '  if (u <= c) return uGeo.z + (uGeo.x - uGeo.z) * sin(1.5707963 * pow(u / c, 1.22));',
    '  float w = (u - c) / (1.0 - c);',
    '  return uGeo.x * sqrt(max(0.0, 1.0 - pow(w, 2.3)));',
    '}',
    'float rIn(float y) { return prof(abs(y) / uGeo.y); }',
    'float rOut(float y) {',
    '  float u = abs(y) / (uGeo.y + uWall);',
    '  if (u >= 1.0) return 0.0;',
    // heavier at the waist, where blown glass is drawn out; closed at the tip
    '  return prof(u) + uWall * (1.0 + 1.15 * exp(-u * u / 0.0035)) * (1.0 - smoothstep(0.985, 1.0, u));',
    '}',
    'vec3 rotZ(vec3 v, float a) {',
    '  float c = cos(a), s = sin(a);',
    '  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);',
    '}',
    // a rectangular soft light seen in direction d (x right, y down, z to the eye)
    'float panel(vec3 d, vec3 c, vec2 hs, float soft) {',
    '  float k = dot(d, c);',
    '  if (k <= 0.02) return 0.0;',
    '  vec3 ux = normalize(cross(vec3(0.0, 1.0, 0.0), c));',
    '  vec3 uy = cross(c, ux);',
    '  vec2 q = abs(vec2(dot(d, ux), dot(d, uy)) / k);',
    '  vec2 m = 1.0 - smoothstep(hs - soft, hs + soft, q);',
    '  return m.x * m.y;',
    '}',
    'vec3 room(vec3 d) {',
    '  vec3 col = vec3(0.028) * (0.7 - 0.5 * d.y);',                                                                     // the dark room
    '  col += vec3(1.0, 0.96, 0.90) * 4.6 * panel(d, normalize(vec3(-0.66, -0.52, 0.54)), vec2(0.20, 0.46), 0.12);',     // key softbox
    '  col += vec3(0.90, 0.94, 1.0) * 1.7 * panel(d, normalize(vec3(0.88, -0.02, 0.36)), vec2(0.05, 0.80), 0.05);',      // fill strip
    '  col += vec3(1.0) * 1.5 * panel(d, normalize(vec3(-0.78, -0.05, -0.62)), vec2(0.07, 1.1), 0.06);',                 // kickers: the long
    '  col += vec3(1.0) * 1.1 * panel(d, normalize(vec3(0.78, -0.05, -0.62)), vec2(0.07, 1.1), 0.06);',                  //   soft side streaks
    // rim strips almost straight behind: they draw the bright line along the
    // glass's own edge, outside the sand, which is what tells the eye where
    // the glass ends
    '  col += vec3(1.0) * 1.7 * panel(d, normalize(vec3(-0.30, -0.04, -0.95)), vec2(0.05, 0.7), 0.08);',
    '  col += vec3(1.0) * 1.3 * panel(d, normalize(vec3(0.30, -0.04, -0.95)), vec2(0.05, 0.7), 0.08);',
    // soft light from the sides, which the thick rim bends round into the eye
    '  col += vec3(0.86, 0.89, 0.94) * 0.55 * panel(d, normalize(vec3(-1.0, -0.06, 0.04)), vec2(0.5, 0.55), 0.3);',
    '  col += vec3(0.86, 0.89, 0.94) * 0.45 * panel(d, normalize(vec3(1.0, -0.06, 0.04)), vec2(0.5, 0.55), 0.3);',
    '  float lamp = dot(d, normalize(vec3(-0.40, -0.50, 0.77)));',
    '  col += vec3(1.0, 0.98, 0.94) * (22.0 * smoothstep(0.99905, 0.99975, lamp) + 1.4 * pow(max(lamp, 0.0), 900.0));', // small hard lamp
    '  col += uGlow * 0.5 * smoothstep(0.25, 1.0, d.y);',                                                                // the desk below
    '  return col;',
    '}',
    'void main() {',
    '  vec2 p = (gl_FragCoord.xy / uRes - 0.5) * uBox;',
    '  p.y = -p.y;',
    '  float ro = rOut(p.y), ri = rIn(p.y), ax = abs(p.x);',
    '  float edge = 1.0 - smoothstep(ro - 1.6 * uPx, ro, ax);',
    '  if (ro <= 0.0 || edge <= 0.0) { gl_FragColor = vec4(0.0); return; }',
    '  const float E = 0.6;',
    // signed distance to the inner surface, positive inside the bore: the
    // horizontal gap shrunk by the wall's slope (it overstates the distance
    // where the surface lies flat, at the domes), and below the dome's tip
    // the vertical gap. Being a distance, not a column test, it has no seam.
    '  float dri = clamp((rIn(p.y + E) - rIn(p.y - E)) / (2.0 * E), -12.0, 12.0);',
    '  float dIn = min((ri - ax) / sqrt(1.0 + dri * dri), uGeo.y - abs(p.y));',
    '  float hlf = sqrt(max(ro * ro - ax * ax, 0.0));',
    '  float path = hlf - sqrt(max(ri * ri - ax * ax, 0.0));',          // glass crossed in one wall
    '  vec3 absorb = exp(-uAbs * path);',
    '  vec3 col; float a;',
    '  if (uPass > 0.5) {',
    '    float dro = clamp((rOut(p.y + E) - rOut(p.y - E)) / (2.0 * E), -8.0, 8.0);',
    '    float s = clamp(p.x / ro, -0.9995, 0.9995);',
    '    vec3 n = normalize(vec3(s, -dro, sqrt(1.0 - s * s)));',
    // hand-blown glass is never optically perfect
    '    n.xy += 0.010 * vec2(sin(p.y * 0.115 + 1.7 * sin(p.x * 0.06)), sin(p.x * 0.09 + p.y * 0.045));',
    '    n = normalize(n);',
    '    float F = 0.04 + 0.96 * pow(1.0 - max(n.z, 0.0), 5.0);',
    '    col = room(rotZ(vec3(0.0, 0.0, -1.0) + 2.0 * n.z * n, uRot)) * F;',
    // leaving the wall into the bore the inner surface mirrors at a glance,
    // so the sand darkens softly just where it meets the glass
    '    float si = clamp(ax / max(ri, 0.001), 0.0, 0.9995);',
    // (the dome's slope barely counts: the straight-through ray is a poor guide there)
    '    vec3 ni = normalize(vec3(si, -dri * 0.15, sqrt(1.0 - si * si)));',
    '    float Fi = ri > 0.5 ? 0.04 + 0.96 * pow(1.0 - max(ni.z, 0.0), 8.0) : 1.0;',
    '    vec3 tr = absorb * (1.0 - F) * (1.0 - Fi);',
    '    a = 1.0 - (tr.r + tr.g + tr.b) / 3.0;',
    // edge-on, the wall is solid glass: it bends light in from the sides
    '    float rim = 1.0 - smoothstep(-0.25, 0.35, dIn);',
    '    if (rim > 0.0) {',
    '      float sr = min(ax / ro, 0.9995);',
    '      float dv = 2.0 * (asin(sr) - asin(sr / 1.5));',
    '      float sx = p.x < 0.0 ? -1.0 : 1.0;',
    '      vec3 o = normalize(vec3(-sx * sin(dv), -dro * 0.5, -cos(dv)));',
    '      col += rim * room(rotZ(o, uRot)) * (1.0 - F) * (1.0 - F) * exp(-uAbs * hlf * 0.5);',
    '      a = mix(a, 0.82, rim);',
    '    }',
    '  } else {',
    '    if (dIn <= -0.3) { gl_FragColor = vec4(0.0); return; }',
    '    float sb = clamp(p.x / max(ri, 0.001), -0.9995, 0.9995);',
    '    vec3 nb = normalize(vec3(-sb, dri, sqrt(1.0 - sb * sb)));',
    // inner surfaces mirror strongly at a glance (total internal reflection)
    '    float Fb = 0.05 + 0.95 * pow(1.0 - max(nb.z, 0.0), 3.5);',
    '    col = room(rotZ(vec3(0.0, 0.0, -1.0) + 2.0 * nb.z * nb, uRot)) * Fb * 0.5;',
    '    vec3 tb = absorb * (1.0 - Fb * 0.7);',
    '    a = 1.0 - (tb.r + tb.g + tb.b) / 3.0;',
    '    edge *= smoothstep(-0.3, 0.3, dIn);',
    '  }',
    '  col = vec3(1.0) - exp(-col * uGain);',                             // film-like roll-off
    '  a = clamp(max(a, max(col.r, max(col.g, col.b))), 0.0, 1.0);',
    '  gl_FragColor = vec4(col, a) * edge;',
    '}'
  ].join('\n');

  /** One WebGL layer of the glass. Returns null where WebGL cannot do it. */
  function makeGlass(canvas, pass) {
    var opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
                 stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    var gl = null;
    try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) {}
    if (!gl) return null;
    var hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!hp || !hp.precision) return null;                 // needs full float precision
    var g = { gl: gl, canvas: canvas, pass: pass, prog: null, u: {}, lost: false };
    g.build = function () {
      function sh(type, src) {
        var o = gl.createShader(type);
        gl.shaderSource(o, src); gl.compileShader(o);
        if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'shader');
        return o;
      }
      var prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, GLASS_VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, GLASS_FS));
      gl.bindAttribLocation(prog, 0, 'p');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one big triangle
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      var names = ['uRes', 'uBox', 'uGeo', 'uWall', 'uRot', 'uPass', 'uAbs', 'uGlow', 'uPx', 'uGain'];
      for (var i = 0; i < names.length; i++) g.u[names[i]] = gl.getUniformLocation(prog, names[i]);
      g.prog = prog;
    };
    try { g.build(); } catch (e) { return null; }
    return g;
  }

  /* ======================================================================
   *  Renderer
   * ==================================================================== */

  var LEVELS = 48;      // light levels per grain colour (upper third = highlights)
  var AO_BIAS = 12;
  var SUB = 2;          // each grain is drawn as a lit 2×2 bead

  /**
   * @param sim   Sim
   * @param els   { back, sand, bloom, front, light } canvases
   *              back / sand / bloom / front rotate with the vessel,
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
    this.hiBoost = new Uint8Array(256);     // per-seed sparkle of the lit facet
    this.emit = new Float32Array(256);      // per-seed contribution to the bloom
    // Bloom: light scattered around the brightest grains, accumulated at
    // half resolution, blurred, and composited additively over the sand.
    this.bw = (W + 1) >> 1; this.bh = (H + 1) >> 1;
    this.bloomA = new Float32Array(this.bw * this.bh);
    this.bloomB = new Float32Array(this.bw * this.bh);
    this.bctx = null;
    if (els.bloom) {
      els.bloom.width = this.bw; els.bloom.height = this.bh;
      this.bctx = els.bloom.getContext('2d');
      this.bimg = this.bctx.createImageData(this.bw, this.bh);
      this.bbuf = new Uint32Array(this.bimg.data.buffer);
    }
    this.frame = true;    // caps + posts around the glass
    this.glass = null;    // [far wall, near wall] WebGL layers, or null → drawn glass
    this.glassRot = 0;
    this._initGlass();
    this.frameNo = 0;
    this.theme = THEMES.sahara;
    this.scale = 1;       // CSS px per cell
    this.dpr = 1;
    this._buildLightMap();
    this._buildMasks();
    this._buildLUT();
  }

  /**
   * Where the glass really is, finer than the lattice can say. A cell is
   * inside when its centre is, so a grain against the wall would poke its
   * square corner past the smooth inner surface the glass is drawn with.
   *   edgeMask   which of each cell's four drawn sub-pixels lie inside the
   *              curve (bit 0 top-left, 1 top-right, 2 bottom-left,
   *              3 bottom-right); 0 for glass, 15 for the open interior
   *   bloomMask  the share of each half-resolution glow pixel that lies
   *              inside, drawn in a little so light never spills onto the glass
   */
  Renderer.prototype._buildMasks = function () {
    var sim = this.sim, g = sim.geo, W = sim.W, H = sim.H, cell = sim.cell;
    var em = this.edgeMask = new Uint8Array(W * H);
    var x, y, i, rt, rb, dl, dr, m;
    for (y = 0; y < H; y++) {
      rt = profile(Math.abs(y + 0.25 - g.cy) / g.HB, g);
      rb = profile(Math.abs(y + 0.75 - g.cy) / g.HB, g);
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (cell[i] === WALL) continue;
        dl = Math.abs(x + 0.25 - g.cx); dr = Math.abs(x + 0.75 - g.cx);
        m = 0;
        if (dl < rt) m |= 1;
        if (dr < rt) m |= 2;
        if (dl < rb) m |= 4;
        if (dr < rb) m |= 8;
        em[i] = m;
      }
    }
    var bw = this.bw, bh = this.bh, bm = this.bloomMask = new Float32Array(bw * bh);
    var ry = new Float32Array(4), by, bx, sy, sx, n;
    for (by = 0; by < bh; by++) {
      for (sy = 0; sy < 4; sy++) ry[sy] = profile(Math.abs(by * 2 + sy * 0.5 + 0.25 - g.cy) / g.HB, g) - 2;
      for (bx = 0; bx < bw; bx++) {
        n = 0;
        for (sy = 0; sy < 4; sy++) {
          for (sx = 0; sx < 4; sx++) if (Math.abs(bx * 2 + sx * 0.5 + 0.25 - g.cx) < ry[sy]) n++;
        }
        bm[by * bw + bx] = n / 16;
      }
    }
  };

  /** Set up the rendered glass; fall back to the drawn one if WebGL is missing. */
  Renderer.prototype._initGlass = function () {
    var els = this.els, self = this;
    this.glass = null;
    if (els.glBack && els.glFront) {
      var a = makeGlass(els.glBack, 0), b = a && makeGlass(els.glFront, 1);
      if (a && b) {
        this.glass = [a, b];
        this.glass.forEach(function (g) {
          g.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); g.lost = true; });
          g.canvas.addEventListener('webglcontextrestored', function () {
            try { g.build(); g.lost = false; self.drawGlass(self.glassRot, true); } catch (err) {}
          });
        });
      }
    }
    if (els.glBack) els.glBack.style.display = this.glass ? '' : 'none';
    if (els.glFront) els.glFront.style.display = this.glass ? '' : 'none';
  };

  /**
   * Render the glass. `rot` is how far the vessel is turned against the room
   * (rad, clockwise): the lights stay where they are, the reflections move.
   */
  Renderer.prototype.drawGlass = function (rot, force) {
    var gs = this.glass;
    if (!gs || !this.cssW) return;
    if (!force && Math.abs(rot - this.glassRot) < 0.01) return;    // under 0.6°: not worth a redraw
    this.glassRot = rot;
    var g = this.sim.geo, th = this.theme, box = this._box();
    var tint = th.glass.tint, dens = 0.0035 + th.glass.smoke * 0.02;
    for (var i = 0; i < gs.length; i++) {
      var o = gs[i], gl = o.gl, u = o.u;
      if (o.lost || !o.prog) continue;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(o.prog);
      gl.uniform2f(u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(u.uBox, box.w, box.h);
      gl.uniform4f(u.uGeo, g.R, g.HB, g.RN, g.equator);
      gl.uniform1f(u.uWall, g.wall);
      gl.uniform1f(u.uRot, rot);
      gl.uniform1f(u.uPass, o.pass);
      gl.uniform3f(u.uAbs, dens * (0.6 + 2.4 * (1 - tint[0] / 255)),
                           dens * (0.6 + 2.4 * (1 - tint[1] / 255)),
                           dens * (0.6 + 2.4 * (1 - tint[2] / 255)));
      gl.uniform3f(u.uGlow, th.glow[0] / 255, th.glow[1] / 255, th.glow[2] / 255);
      gl.uniform1f(u.uPx, box.w / gl.drawingBufferWidth);
      gl.uniform1f(u.uGain, 1.1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };

  /** Assembly box in cells: the framed instrument, or the bare glass. */
  Renderer.prototype._box = function () {
    var g = this.sim.geo;
    if (this.frame) return { w: g.AW, h: g.AH };
    return { w: Math.max(this.sim.W, 2 * g.R + 16 * g.q), h: Math.max(this.sim.H, 2 * g.HB + 12 * g.q) };
  };
  Renderer.prototype.setFrame = function (on) {
    this.frame = !!on;
  };

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
  };

  /** Per-grain colour table: 256 persistent seeds × 48 light levels. */
  Renderer.prototype._buildLUT = function () {
    var th = this.theme, sd = th.sand, lut = this.lut, li = th.light;
    var tint = li.tint, em = li.emit;
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
      var glossy = !mica && hash01(s * 41 + 7) < li.gloss;
      this.hiBoost[s] = 3 + (glossy ? li.glossBoost : 0);
      this.emit[s] = em.haze + (mica ? em.mica : (glossy ? em.gloss : 0));
      for (var lv = 0; lv < LEVELS; lv++) {
        var m = 0.34 + lv * 0.031;                     // 0.34 … 1.80
        var r = base[0] * m, g = base[1] * m, b = base[2] * m;
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
        if (m > 1) {                                   // highlights roll off toward the light's own colour
          var w = (m - 1) * li.hl;
          if (w > 0.94) w = 0.94;
          r += (tint[0] - r) * w; g += (tint[1] - g) * w; b += (tint[2] - b) * w;
        }
        lut[(lv << 8) | s] = (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
      }
    }
    // depth 1 = exposed surface grain (rim-lit), deeper = occluded
    for (var d = 0; d < 256; d++) {
      var ao;
      if (d <= 1) ao = -li.rim[0]; else if (d === 2) ao = -li.rim[1];
      else ao = Math.min(li.aoMax, Math.round((d - 2) * 0.55));
      this.aoTab[d] = ao + AO_BIAS;
    }
    var gl = th.glint, bc = li.bloomColor;
    this.glintColor = ((255 << 24) | (gl[2] << 16) | (gl[1] << 8) | gl[0]) >>> 0;
    this.bloomRGB = ((bc[2] << 16) | (bc[1] << 8) | bc[0]) >>> 0;
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
    var els = this.els, box = this._box();
    var s = Math.min(boxW / box.w, boxH / box.h);
    if (!(s > 0)) s = 1;
    var cssW = Math.round(box.w * s), cssH = Math.round(box.h * s);
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
    if (this.glass) {
      // the shading is smooth, so the glass can render a little below device
      // resolution on very dense screens
      var gk = Math.min(dpr, Math.sqrt(2.4e6 / (cssW * cssH)));
      for (i = 0; i < this.glass.length; i++) {
        c = this.glass[i].canvas;
        c.width = Math.max(2, Math.round(cssW * gk)); c.height = Math.max(2, Math.round(cssH * gk));
        c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
      }
    }
    // sand: one buffer pixel per half cell; glow: one per 2×2 cells, which can
    // run a cell past the lattice when its size is odd, so size it by its own grid
    var grid = [[els.sand, this.sim.W, this.sim.H], [els.bloom, this.bw * 2, this.bh * 2]];
    for (i = 0; i < grid.length; i++) {
      c = grid[i][0];
      if (!c) continue;
      c.style.width = (grid[i][1] * s) + 'px';
      c.style.height = (grid[i][2] * s) + 'px';
      c.style.left = ((box.w - this.sim.W) / 2 * s) + 'px';
      c.style.top = ((box.h - this.sim.H) / 2 * s) + 'px';
    }
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
    var hiOff = this.hiOff, loOff = this.loOff, hiBoost = this.hiBoost, edge = this.edgeMask;
    var rowMin = sim.rowMin, rowMax = sim.rowMax, gateY = sim.gateY;
    var fr = ++this.frameNo, em;
    var up = sim.gy < 0;                 // vessel currently upside-down?
    var y, x, i, c, s, d, lv, bi, x0, x1, hi, lo, mid, h, hl;
    // bloom is soft and slow: refresh it every third frame
    var glow = this.bctx && fr % 3 === 0 ? this.bloomA : null;
    var emit = this.emit, bw = this.bw, rimE = this.theme.light.emit.rim, gi;

    buf.fill(0);
    depth.fill(0);
    if (glow) glow.fill(0);

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
        lv = base[i] - ao[d] + AO_BIAS;
        if (c === MOVE) lv++;
        if (glow) {
          gi = (y >> 1) * bw + (x >> 1);
          glow[gi] += d === 1 ? emit[s] + rimE : emit[s];
        }
        if (isMica[s]) {
          // mica flashes when it tumbles and twinkles slowly at the surface
          h = Math.imul(i ^ (c === MOVE ? fr : fr >> 4), 0x9E3779B1) >>> 0;
          if (c === MOVE ? (h >>> 30) === 0 : (d < 3 && (h >>> 27) === 0)) {
            buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = glint;
            if (glow) glow[gi] += 0.7;
            em = edge[i];
            if (em !== 15) {                 // against the glass: keep only what is inside
              if (!(em & 1)) buf[bi] = 0;
              if (!(em & 2)) buf[bi + 1] = 0;
              if (!(em & 4)) buf[bi + BW] = 0;
              if (!(em & 8)) buf[bi + BW + 1] = 0;
            }
            continue;
          }
        }
        hl = lv + hiBoost[s];
        if (hl > 47) hl = 47;
        hi = lut[(hl << 8) | s];
        mid = lut[(lv << 8) | s];
        lo = lut[((lv - 3) << 8) | s];
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = mid;
        if (up) { buf[bi + loOff[s]] = hi; buf[bi + hiOff[s]] = lo; }
        else { buf[bi + hiOff[s]] = hi; buf[bi + loOff[s]] = lo; }
        em = edge[i];
        if (em !== 15) {                     // against the glass: keep only what is inside
          if (!(em & 1)) buf[bi] = 0;
          if (!(em & 2)) buf[bi + 1] = 0;
          if (!(em & 4)) buf[bi + BW] = 0;
          if (!(em & 8)) buf[bi + BW + 1] = 0;
        }
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
          if (qx < 0 || qy < 0 || qx >= BW - 1 || qy >= BH) continue;
          var qi = qy * BW + qx;
          if (buf[qi] !== 0) continue;
          // a grain that has just bounced trails back the way it came: never through the glass
          if (!((edge[(qy >> 1) * W + (qx >> 1)] >> (((qy & 1) << 1) | (qx & 1))) & 1)) continue;
          var a = (150 * (1 - k / (len + 1)) * (1 - k / (len + 1))) | 0;
          buf[qi] = ((a << 24) | rgb) >>> 0;
          if (k < 3 && ((edge[(qy >> 1) * W + ((qx + 1) >> 1)] >> (((qy & 1) << 1) | ((qx + 1) & 1))) & 1)) buf[qi + 1] = buf[qi];
        }
      }
      // the grain itself: a 2×2 bead at its sub-cell position, clipped the same way
      for (var dy2 = 0; dy2 < 2; dy2++) {
        for (var dx2 = 0; dx2 < 2; dx2++) {
          var gx2 = ix + dx2, gy2 = iy + dy2;
          if ((edge[(gy2 >> 1) * W + (gx2 >> 1)] >> (((gy2 & 1) << 1) | (gx2 & 1))) & 1) buf[gy2 * BW + gx2] = col;
        }
      }
      if (glow) glow[(py[p] >> 1) * bw + (px[p] >> 1)] += 0.3;
    }

    this.sctx.putImageData(this.img, 0, 0);
    if (glow) this._bloomOut();
  };

  /** Blur the accumulated light and hand it to the compositor. */
  Renderer.prototype._bloomOut = function () {
    var bw = this.bw, bh = this.bh, a = this.bloomA, b = this.bloomB;
    var x, y, i, pass;
    for (pass = 0; pass < 1; pass++) {                 // separable [1 2 1]; the upscale softens the rest
      for (y = 1; y < bh - 1; y++) {
        i = y * bw + 1;
        for (x = 1; x < bw - 1; x++, i++) b[i] = (a[i - 1] + a[i] + a[i] + a[i + 1]) * 0.25;
      }
      for (y = 1; y < bh - 1; y++) {
        i = y * bw + 1;
        for (x = 1; x < bw - 1; x++, i++) a[i] = (b[i - bw] + b[i] + b[i] + b[i + bw]) * 0.25;
      }
    }
    var out = this.bbuf, rgb = this.bloomRGB, k = this.theme.light.bloom * 255, v, n = bw * bh;
    var mask = this.bloomMask;
    for (i = 0; i < n; i++) {
      v = a[i] * k * mask[i];                          // light stays inside the glass
      out[i] = v < 1 ? 0 : (((v > 200 ? 200 : v | 0) << 24) | rgb) >>> 0;
    }
    this.bctx.putImageData(this.bimg, 0, 0);
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
    this.drawGlass(this.glassRot, true);
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
    for (var side = 0; side < 2 && this.frame; side++) {
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
    // where the wall is seen edge-on. (Skipped when the glass is rendered.)
    var drawn = !this.glass;
    tracePath(ctx, g, g.wall);
    var body = ctx.createLinearGradient(-g.R - g.wall, 0, g.R + g.wall, 0);
    body.addColorStop(0, rgba(tint, 0.17));
    body.addColorStop(0.16, rgba(tint, 0.06));
    body.addColorStop(0.5, rgba(tint, 0.018));
    body.addColorStop(0.84, rgba(tint, 0.06));
    body.addColorStop(1, rgba(tint, 0.17));
    if (drawn) {
      ctx.fillStyle = 'rgba(4,5,7,' + th.glass.smoke + ')';
      ctx.fill();
      ctx.fillStyle = body;
      ctx.fill();
    }

    // faint reflection of the far wall
    ctx.save();
    tracePath(ctx, g, 0);
    ctx.clip();
    if (drawn) {
      tracePath(ctx, g, 0);
      ctx.strokeStyle = rgba(tint, 0.035);
      ctx.lineWidth = 16 * q; ctx.stroke();
      ctx.strokeStyle = rgba(tint, 0.045);
      ctx.lineWidth = 7 * q; ctx.stroke();
    }
    // a breath of light held inside each bulb, so dark sand has something to
    // stand against (identical in both bulbs: the layer turns with the glass)
    var bl = th.light.backlight;
    if (bl > 0) {
      for (var b = -1; b <= 1; b += 2) {
        var cyB = b * g.HB * g.equator * 0.92;
        var gr = ctx.createRadialGradient(0, cyB, 0, 0, cyB, g.R * 1.15);
        gr.addColorStop(0, rgba(th.glow, bl));
        gr.addColorStop(0.55, rgba(th.glow, bl * 0.45));
        gr.addColorStop(1, rgba(th.glow, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(-g.R - 2, cyB - g.R * 1.2, g.R * 2 + 4, g.R * 2.4);
      }
    }
    ctx.restore();
  };

  /* -- in front of the sand: glass wall, rim light, caps -------------- */
  Renderer.prototype._drawFront = function () {
    var ctx = this._ctx('front'), g = this.sim.geo, th = this.theme, q = g.q;
    var tint = th.glass.tint, cap = th.cap, k, i;

    var drawn = !this.glass;
    if (drawn) {
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
    }

    // End caps (collar + slab). Draw the top one, rotate for the bottom.
    for (var side = 0; side < 2 && this.frame; side++) {
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

    var drawn = !this.glass;                          // rendered glass brings its own highlights
    ctx.save();
    ctx.clip(outer);
    for (var b = -1; b <= 1 && drawn; b += 2) {       // -1 upper bulb, +1 lower
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
    ca.addColorStop(0, rgba(glow, drawn ? 0.20 : 0.13));
    ca.addColorStop(0.4, rgba(glow, drawn ? 0.07 : 0.045));
    ca.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = ca;
    ctx.fillRect(-g.R, g.HB * 0.6, g.R * 2, g.HB * 0.45);
    if (drawn) {
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
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    if (!this.frame) return;

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
      band.addColorStop(0.32, 'rgba(255,255,255,' + (th.cap.kind === 'wood' ? 0.10 : 0.17) + ')');
      band.addColorStop(0.44, 'rgba(255,255,255,0.03)');
      band.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = band;
      ctx.fillRect(-sw, sy, sw * 2, slab);
      var edge = ctx.createLinearGradient(0, sy, 0, sy + slab);
      edge.addColorStop(0, 'rgba(255,255,255,' + (th.cap.kind === 'wood' ? 0.20 : 0.26) + ')');
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
