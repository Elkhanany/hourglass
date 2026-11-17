/*!
 * Hourglass — physics.js
 * ---------------------------------------------------------------------------
 * 1. HourglassPhysics.Sim       Granular simulation. Every grain is simulated:
 *                               a cellular automaton for packed / sliding sand
 *                               plus sub-pixel ballistic particles for the
 *                               free-falling stream, the pour and the splash.
 *                               A glass at rest steps exactly as it always
 *                               has; moved, turned or shaken, it feels the
 *                               true-size field (the bed lifts and lands, the
 *                               sand runs hot), and its glass can crack, leak
 *                               and be mended.
 * 2. HourglassPhysics.Renderer  Per-grain pixel renderer (ImageData / Uint32)
 *                               and the blown-glass vessel, caps and lighting,
 *                               with its cracks, gold mends and their glints.
 * 3. HourglassPhysics.Spill     Sand that has left the glass, falling in the
 *                               room and gathering in a dune on the desk.
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
  // Finer sand (Sim.setPace, below the layers' table): how much more a finer
  // glass does each step, and how many more grains it holds. 1 unless set.
  var PACE = 1, PACE2 = 1, FEEDK = 1;

  // Particle kinds (upper bits of pinfo); lower two bits count bounces.
  var K_STREAM = 0, K_POUR = 4, K_SPLASH = 8, K_MASK = 12;

  var EV_CAP = 48;              // audio impact events kept per frame
  var SL_BINS = 2048;           // bins across the field for the thick avalanche (_slump): any glass, any lean, any grain

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
  /**
   * The engine stores a field in the form its first value needs: a small
   * integer, or a double. Widening it later changes the object's shape and
   * throws away the compiled code of every function that touches it, which
   * cost whole frames (10–25 ms) on the first turn, spin or shake of a page,
   * when these fields first take fractions. So they take their double form
   * here, before anything is compiled, as the slugs' U and Z do.
   */
  var SIM_DOUBLES = ['angle', 'tilt', 'gx', 'gy', 'mAx', 'mAy', 'mW', 'mAl', 'mLam', 'mGz', 'mKx', 'mKy', 'relCap', 'dMax', '_iz', '_lrng', '_layNeed'];
  function asDoubles(o, keys) {
    for (var k = 0; k < keys.length; k++) {
      var v = o[keys[k]];
      o[keys[k]] = 0.5;
      o[keys[k]] = v;
    }
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
    var PC = this.PCAP = Math.round(6144 * PACE2);
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
    this.G = 3300 * PACE;     // gravity, cells / s²  (slow-motion scale so the
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
    this._paceAcc = 0;        // finer sand: the automaton's pattern is repeated PACE times a step, on average
    this._reps = 1;           // … this many times in the step being taken
    this._slAcc = 0; this._slN = 0;   // … and its thick avalanches likewise
    this.lag = 0;             // grains the neck still owes the clock
    this.rng = (opts.seed | 0) || 0x2F6E2B1;
    this.granular = opts.granular !== false;   // sand off the upright: slopes judged against gravity itself (_caM)
    this.layers = !!opts.layers;   // layered sand: bit 7 of a grain's colour seed is its tone (setLayers)
    this._lrng = 1;           // the strata's own random stream (never the sand's)
    this._pourTone = 0; this._pourLeft = 0; this._pourAt = -1e9;   // the layer being poured in
    this._lb = new Int16Array(W);  // lower heap: each column's surface when the layer being laid began
    this._lbRaw = new Int16Array(W);
    this._layN = -1;          // grains below the neck when it began (−1: none begun)
    this._layNeed = 0;        // ... and how many make the layer
    this._layWait = 0;        // calm steps to wait before the next one begins
    this._layUp = 0;          // the tone that stays on top in this layer; the other sifts down
    this._layMin = 4; this._laySpan = 8; this._layPow = 1;   // how deep the heap's layers are laid this time (_style)
    this._rec = [null, null]; // each bulb's pattern since the last turn (_turned) …
    this._duty = [0.4, 0.4];  // … and the companion tone's share of its sand
    this._recN = 0;           // patterns drawn so far
    this._want = null;        // the tone each cell would have in its bulb's pattern (made a column at a time)
    this._wantAt = null;      // per bulb: the pattern each column of _want was made for
    this._dev = 0;            // steps left in which sand coming to rest is laid in its pattern
    this._devNeed = null; this._devMov = null;

    this._buildVessel();
    this._initMotion();
    asDoubles(this, SIM_DOUBLES);
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
    // Spray, hops and airborne grains. Kept sparse and low on purpose: a
    // shaken bed should read as sand jostling in a glass (the bed lifting
    // and landing carries the effect), not as a fountain of sparks. At the
    // first values (pSpray 0.35, 6 hop tries per unit of T, hops up to
    // 360 cells/s) shaking threw 270–660 grains/s up to 50 cells high.
    sprayV: 150, pSpray: 0.08, hopT: 0.45, hopMax: 2, softCap: 4096, vMax: 1400,
    sprayE: 0.2, sprayEr: 0.2,        // spray leaves at (sprayE + sprayEr·U) of the landing speed
    hopK: 1.5,                        // hop tries per step per unit of temperature above hopT
    hopV0: 40, hopV: 80,              // a hop's speed: hopV0 + hopV·min(T, 2)·U(0.3, 1), cells/s
    pSprayQ1: 0.04, hopMaxQ1: 1,      // the lighter quality level (the governor's 1)
    jitX: 0.011, jitY: 0.004,         // a falling grain's aerodynamic jitter, per step (as today)
    retryV: 25,          // cells/s: a grain with nowhere to settle rises against the field and tries again
    Dcap: 8,             // a crack is full grown long before its stretch holds this much damage
    // the glass: stress corrosion with a fatigue limit, Weibull flaws
    nSeg: WALL_BINS,     // wall segments per bulb and side (bins of u; read-only)
    weibull: 20,         // Weibull modulus of the flaw strengths (median 1)
    n: 16,               // stress-corrosion exponent of soda-lime glass
    vc: 11,              // landing speed v/√(G·cell) of the reference stress (a vigorous shake cracks it in ~3 s)
    xTh: 0.78,           // fatigue limit K_th/K_IC: below it a crack never grows
    A: 0.40,             // damage per reference column landing
    hRef: 40,            // grains in a reference column (h = min(2, n/hRef))
    capCol: 0.5,         // the most one column landing can supply
    Pmax: 0.45,          // the most one blow of the sand can ever do
    gamTh: 2.6, gamC: 3.4, nB: 16, tauB: 0.5, capB: 0.06, bendBins: 3,   // the waist bends
    // The phone shaken hard in any direction (shake): each swing of a sustained
    // shake loads the glass by shakeD, unless a landing has loaded it within
    // shakeQuiet steps (then the sand in the screen's plane is doing the work)
    shakeD: 0.085, shakeQuiet: 30,
    spinTh: 0.2, spinC: 0.8, spinRate: 0.6, domeBins: 4,              // a hard spin loads the domes (g at the dome)
    flawCap: 2,          // a flaw counts for at most this much of a steady load (the spin, the bending waist)
    // one flick by hand, at let-go (flick): its peak g at the dome, from flickG[0] (nothing) to flickG[1] (flickD of damage)
    flickG: [0.22, 0.40], flickD: 0.4,
    // a knock on the glass (tap or click): a fingertip covers knockBins bins either way, and both
    // sides of the glass when it lands within knockMid of the axis (× the glass's half-width there)
    // (measured with a real finger's scatter: the third knock of a burst, strength 1.0, adds 0.04 at
    // most, so triple taps stay harmless; the fourth to eighth, 1.2, add 0.23 each: a crack on the eighth)
    knockTh: 1.0, knockA: 0.08, knockCap: 0.23, knockBins: 3, knockMid: 0.3, knockFlaw: 1.5,
    // The glass itself striking the desk or an edge of the screen (impact):
    // the speed of the blow on screen, px/s. Below impV[0] it only clinks;
    // up to impV[1] it creaks and keeps impD of damage; from there it cracks
    // at once, impL[0] … impL[1] cells long; from impV[2] it breaks through
    // (impL[2] … impL[3] cells by 1.5 × impV[2]).
    impV: [700, 920, 1800], impD: 0.35, impL: [14, 24, 28, 40], impBins: 3,
    rMax: 0.9,           // 1/s: fastest sub-critical growth (bounded crack velocity)
    tauP: 0.6,           // s: an unabsorbed blow fades
    tauHeal: 8,          // s: micro-damage arrests while no crack is visible
    warn: [0.35, 0.60, 0.80, 0.92],   // creak levels 1–4, crossing upward
    warnRearm: 0.15,     // a level re-arms this far below its threshold
    maxCracks: 3,        // per glass
    relief: 0.5,         // a crack relaxes the rest of the glass: every other stretch keeps this share of its damage
    calm: 2.5,           // s: after a crack, no other starts this soon
    gateGuard: 4,        // cracks and holes stay at least this many rows from the gate
    L0: 16, growK: 22, growL: 30, growStep: 6, Lmax: 140,  // crack length, cells (born long enough to be seen)
    Lhole: 26, widen: 0.8, wMax: 3,   // breached at L > 26, wider at 26·(1 + 0.8·w)
    sealS: 1.5,          // a mended seam is half as strong again
    // the leak: 2-D Beverloo flow with jamming
    leakP0: 0.35, leakPmax: 1.35,     // pressure through the breach
    Q0: 3.0, leakJam: 1.2,            // grains/s at rest: Q0·max(0, w − 1.2)^1.5
    leakT: 12,           // grains/s per cell of breach while shaken (T = 1)
    leakCap: 3,          // credit cap, grains
    escV: 40, escVr: 30, escTan: 10,  // escape speed: 40 + 30·U out, N(0, 10) along, cells/s
    leakLinger: 120,     // steps a leak keeps the sim awake
    // Sand off the upright (sim.granular): slopes are judged against the
    // field itself, in degrees below its horizontal
    thS: 35, thD: 32,    // a grain at rest lets go above thS (maximum stability); one already moving runs on above thD
                         // (three degrees apart, as in dry sand: under a slow tilt it trickles, it does not wait and go)
    // What the glass builds while it stands straight is steeper than that: the old automaton drains its upper
    // bed to 40° and pours its heap to 34°. So that none of it gives way in bulk as these rules take over, a bed
    // holds that much more to begin with: upTop degrees on both angles in the upper bulb, upBot in the lower.
    // It gives that up evenly as the field leans from the glass's axis, all of it by upLean degrees, and does
    // not get it back by leaning less: only when the glass has stood straight again under its own rules (_hold).
    upTop: 13, upBot: 5, upLean: 15,
    nS: 8, nD: 3,        // cells of the slope probed beyond the step
    kinA: 0.21, kFall: 8, kSlide: 12, // a kinetic sweep: a fall covers 1 + kinA·run cells (at most kFall), a slide runs on up to kSlide
    pLet: 205,           // /256 chance a sweep that a grain at rest, the sand under it gone, lets go (so a hanging mass loosens from its face)
    // Shaken sand loses the slopes it can hold: all of them × (1 − thHot·s), s rising from 0 at a
    // temperature of hotT0 to 1 at hotT1. Below hotT0 (walking, a sway, a finger's wiggle) nothing changes.
    thHot: 0.55, hotT0: 0.5, hotT1: 1.5,
    // the thick avalanche (_slump): the slope over slB bins; it starts above thS + slUp and runs on down to slStop;
    // at most slMax grains a call (fewer at the lighter quality levels), a call every slEvery steps, a grain runs
    // on at most slRun bins, and a cliff gives up to slDeep grains from one bin; not while the glass spins past slW
    // each bed's sideways momentum (slip): it starts when the level push beats muS of the load, friction muK
    // takes it away again; slipK of the glass's own on-screen motion counts as push (setCarry); while it slides
    // its field leans by muK of the load plus slipC (1/s) of its speed; never faster than slipMax cells/s
    muS: 0.65, muK: 0.5, slipK: 0.6, slipC: 6, slipMax: 1200,
    airK: 1,             // how much of the glass's own on-screen motion a grain in the air feels (1: it stays where it was in the room)
    slipShifts: 2,       // cells a step a sliding bed is moved at most
    slipStop: 0.02,      // a shift that moves less than this share of the bed's grains has met the glass: the slide ends
    slB: 8, slUp: 1, slStop: 33, slMax: 96, slEvery: 2, slRun: 64, slDeep: 6, slW: 3, slHop: 2, slGain: 6,
    spinW: 6,            // rad/s: spun faster than this the sand is stepped by the old automaton
    maxSweepsG: 2,       // most sweeps a step for a bulb (maxSweeps without granular)
    offSweeps: 1,        // sweeps a step while turned or laid over (2 without granular: there a grain moves one cell a sweep)
    offLean: 0.012,      // sin of the lean from which the glass counts as off the upright (0.7°)
    handBack: 420        // steps the upright glass keeps these rules after the last lean, turn or motion (3.5 s)
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
    this.spinArmed = false;              // a spin made by hand (flick, turn) loads the domes
    this.relCap = 0;                     // most grains the neck may release per step (0: no cap)
    this.reduced = false;                // Reduce Motion: gentler physics; the phone's own shaking cannot crack the glass
    this.quality = 2;                    // 2 full, 1 lighter, 0 lightest (set by the app)

    // Sand off the upright (see _caM). sim.granular (opts.granular, on unless
    // false) only ever acts on a glass that is leaned, turning or moved, or
    // was a moment ago; false is the engine as it was at every lean.
    this.run = new Uint8Array(N);        // sweeps a grain has kept falling or sliding (its speed), carried with it
    this._offAt = -1e9;                  // the last step the glass was leaned, turning or moved
    this._lnKey = [2, 2, -1, -1];        // the slope probes in _lnOff are for this field, heat and hold
    this._keep = [1, 1];                 // how much of upTop / upBot each bed still holds (see _hold)
    this._lnOff = new Int32Array(128);
    this._aval = [0, 0];                 // a thick avalanche is running in this bulb (_slump)
    this._slideN = 0;                    // grains the last _slide looked at
    this._granCA = false;                // this step of the motion path uses _caM (granular, and not spun fast)
    this.mKx = 0; this.mKy = 0;          // what the sand feels of the glass's own motion on the screen, cells/s² (setCarry)
    this.slip = new Float32Array(2);     // each bed's sideways speed over the glass, cells/s along the level (its momentum)
    this.lean = new Float32Array(4);     // the field each bed's automaton runs in while it slides [x0, y0, x1, y1]
    this.slipAcc = new Float32Array(2);  // cells each sliding bed has still to be moved
    this._slTop = null; this._slI = null; this._slFlo = null; this._slFloI = null;   // its scratch, made at the first lean

    // Each bulb's bed: the field it feels, the slow mean of that field
    // without gravity (what heats the sand is a change in it), centroid and heat.
    this.bf = new Float32Array(4);       // [f0x, f0y, f1x, f1y], cells/s²
    this.hSlow = new Float32Array(4);    // slow mean of bf − G·ĝ, cells/s²
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
    this._loadAt = -1e9;                 // step of the last landing that loaded the glass (_load)
    this._shakeSeg = -1; this._shakeAt = -1e9;   // where the phone's shaking is wearing on the glass, and since when
    this._thumpN = new Float32Array(2);  // grains landed this frame, per bulb (the thump's pan)
    this._slamN = 0;                     // ... and slammed into the far end
    this._cenAt = -1e9;                  // step the centroids were last measured

    this._motionStep = false;            // the last step took the motion path
    this._cell32 = new Uint32Array(cell.buffer, cell.byteOffset, N >> 2);   // the lattice, four cells a word (_sandRow)
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
    this.segHit = new Float32Array(WALL_SEGS); // how hard each stretch is being hit lately (raw supply, fading as segP does)
    this._impH = new Float32Array(WALL_SEGS);  // scratch for impact(): how far out each stretch lies along the blow
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
    this._crackHold = -1e9;              // no new crack starts before this step (MOT.calm after one)
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
    this._layN = -1; this._pourLeft = 0;
    if (this.layers) this._strata();
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
      this.bf[2 * b] = G * gx;
      this.bf[2 * b + 1] = G * gy;
    }
    this.hSlow.fill(0); this.cen.fill(0); this.agit.fill(0); this.sweepAcc.fill(0);
    this._landAt[0] = this._landAt[1] = -1e9;
    this._loadAt = -1e9;
    this._shakeSeg = -1; this._shakeAt = -1e9;
    this._cenAt = -1e9;
    this._motionStep = false;
    this._izAt = -1;
    this.run.fill(0);
    this._offAt = -1e9;
    this._aval[0] = this._aval[1] = 0;
    this.slip[0] = this.slip[1] = 0; this.slipAcc[0] = this.slipAcc[1] = 0;
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
    this.segD.fill(0); this.segP.fill(0); this.segHit.fill(0);
    this._pendP = false;
    if (this.holeMap !== null) { this._holeBuf.fill(0); this.holeMap = null; }
    this.nOpen = 0; this.dMax = 0; this.warnSeg = -1;
    this.warnLatch.fill(0);
    this._crackHold = -1e9;
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
   * a bed in flight, a breach still passing sand, or damage that has yet to
   * fade from glass that did not crack (its mark fades with it).
   */
  Sim.prototype.isActive = function () {
    return this.np > 0 || this.quiet < 24 || this.flipping ||
      this._motionStep || this.slug[0].air || this.slug[1].air ||
      this._leakLive || this.steps - this._leakStep < MOT.leakLinger || this._pendP || this.dMax > 0.02;
  };

  /**
   * A knock on the glass: a tap or a click near (x, y) (lattice cells), `s`
   * how hard (0.6 for an ordinary tap, up to 1.2 for the fourth and later
   * of a quick burst). A fingertip is broad: the blow lands on every stretch
   * of wall within knockBins bins of the row it struck, on the side it
   * struck, and on both sides when it struck near the axis, so knocks that
   * scatter by a few pixels still add up. It obeys the fatigue limit, so
   * single, double and triple taps never mark the glass; a blow above it
   * writes up to knockCap of damage at once (a flaw counts for at most
   * knockFlaw of it), so a few hard knocks near one place creak, then crack
   * it there. The creaks and the crack are queued at once, for the app to
   * play inside the tap. Returns the segment struck, or −1.
   */
  Sim.prototype.knock = function (x, y, s) {
    if (!(s > 0)) return -1;
    var W = this.W, H = this.H, seg = -1, yi = Math.round(y), k, sg, yy = 0, row = -1;
    if (yi < 1) yi = 1; else if (yi > H - 2) yi = H - 2;
    for (k = 0; k < 8 && row < 0; k++) {               // the nearest row with glass on both sides
      for (sg = -1; sg <= 1 && row < 0; sg += 2) {
        yy = yi + sg * k;
        if (yy < 1 || yy > H - 2 || this.rowMin[yy] > this.rowMax[yy]) continue;
        row = yy;
      }
    }
    if (row < 0) return -1;
    var x0 = this.rowMin[row], x1 = this.rowMax[row], dx = x - this.geo.cx, half = (x1 - x0 + 1) / 2;
    var mid = (dx < 0 ? -dx : dx) < MOT.knockMid * half;
    var sn = Math.pow(s, MOT.nB), th = Math.pow(MOT.knockTh, MOT.nB);
    var sc = this.segCrack, segD = this.segD, top = -1, topD = 0, any = false;
    for (sg = -1; sg <= 1; sg += 2) {
      var s0 = this.segOf[row * W + (sg < 0 ? x0 - 1 : x1 + 1)];
      if (s0 < 0) continue;
      if ((sg < 0) === (dx < 0)) seg = s0;             // the side it struck
      else if (!mid) continue;
      var b0 = s0 - (s0 % WALL_BINS), lo = s0 - MOT.knockBins, hi = s0 + MOT.knockBins;
      if (lo < b0) lo = b0;
      if (hi > b0 + WALL_BINS - 1) hi = b0 + WALL_BINS - 1;
      for (var q = lo; q <= hi; q++) {
        k = sc[q];
        if (k >= 0 && this.cracks[k].sealed) continue;                 // mended gold holds
        var fl = Math.pow(this.segKt[q] / this.segS[q], MOT.nB);
        var d = MOT.knockA * (sn * (fl > MOT.knockFlaw ? MOT.knockFlaw : fl) - th);
        if (d <= 0) continue;
        if (d > MOT.knockCap) d = MOT.knockCap;
        this.segHit[q] += d;
        d += segD[q];
        segD[q] = d > MOT.Dcap ? MOT.Dcap : d;
        any = true;
        if (k < 0 && d >= 1 && d > topD) { topD = d; top = q; }
      }
    }
    if (seg < 0) return -1;
    if (!any) return seg;
    this._pendP = true;                                // the next step looks at the glass
    this.quiet = 0;
    if (top >= 0 && this.cracks.length < MOT.maxCracks && this.steps >= this._crackHold) this._initCrack(top, -1);
    this._scanDamage(true);
    return seg;
  };

  /**
   * The glass itself strikes something: the desk it lands on, or an edge of
   * the screen. (nx, ny) points from the glass to what it hit, in the
   * vessel's own frame (x right, y down the lattice); v is the speed of the
   * blow on screen, px/s. This is the hand's own deliberate act, so its
   * damage is written at once: nothing has to arm it, and neither the cap on
   * one blow (Pmax) nor the bounded rate (rMax) applies. It lands on the
   * weakest stretch of glass within impBins bins of the place that hit (the
   * lower dome for a landing upright, the flank for a wall), or on the open
   * crack there. Returns what it did: 0 nothing, 1 a creak (impD of damage),
   * 2 a crack, 3 a breach (from impV[2], or a cracking blow on a stretch
   * that is cracked already; each one after that widens the breach).
   */
  Sim.prototype.impact = function (nx, ny, v) {
    var V = MOT.impV, IL = MOT.impL;
    nx = finiteOr0(nx); ny = finiteOr0(ny); v = finiteOr0(v);
    if (!(v >= V[0]) || (nx === 0 && ny === 0)) return 0;
    var g = this.geo, sc = this.segCrack, cracks = this.cracks, hs = this._impH;
    var s, q, k, u, h, far = -1e9;
    // the place that hit: the stretches farthest out along (nx, ny) ...
    for (s = 0; s < WALL_SEGS; s++) {
      u = ((s % WALL_BINS) + 0.5) / WALL_BINS;
      h = ((((s / WALL_BINS) | 0) & 1) ? 1 : -1) * profile(u, g) * nx + (s >= 2 * WALL_BINS ? 1 : -1) * u * g.HB * ny;
      hs[s] = h;
      if (h > far) far = h;
    }
    // ... and, within impBins bins of them, the open crack if there is one, else the weakest stretch
    var pick = -1, pickW = 0, open = -1;
    for (s = 0; s < WALL_SEGS; s++) {
      if (hs[s] < far - 0.5) continue;
      var b0 = s - (s % WALL_BINS), lo = s - MOT.impBins, hi = s + MOT.impBins;
      if (lo < b0) lo = b0;
      if (hi > b0 + WALL_BINS - 1) hi = b0 + WALL_BINS - 1;
      for (q = lo; q <= hi; q++) {
        k = sc[q];
        if (k >= 0) { if (!cracks[k].sealed && open < 0) open = q; continue; }     // mended gold holds
        var w = this.segKt[q] / this.segS[q];
        if (w > pickW) { pickW = w; pick = q; }
      }
    }
    this._pendP = true;                                // the next step looks at the glass
    this.quiet = 0;
    if (v < V[1]) {
      // a creak: the stretch keeps impD of the way to a crack (an open crack lengthens instead)
      s = open >= 0 ? open : pick;
      if (s < 0) return 0;
      h = this.segD[s] + MOT.impD;
      this.segD[s] = h > MOT.Dcap ? MOT.Dcap : h;
      if (open < 0) {
        var f = this.frame, n0 = f.dmgN, lv = 0;
        this._scanDamage(true);
        if (f.dmgN === n0) {                           // no new level crossed: it is heard all the same
          for (k = 0; k < 4; k++) if (this.dMax >= MOT.warn[k]) lv = k + 1;
          this._pushDmg(Sim.DMG.WARN, -1, lv < 1 ? 1 : lv, this._panSeg(s));
        }
      }
      return 1;
    }
    var cr = null, grade = v >= V[2] ? 3 : 2, wide = grade === 3 ? 2 : 1, fresh = false;
    if (open >= 0) {
      cr = cracks[sc[open]];                           // cracked here already: this blow breaks it through
      grade = 3;
    } else if (pick >= 0 && cracks.length < MOT.maxCracks) {
      if (this.segD[pick] < 1) this.segD[pick] = 1;
      cr = this._initCrack(pick, -1);
      fresh = true;
    } else {
      for (k = 0; k < cracks.length && !cr; k++) if (!cracks[k].sealed) cr = cracks[k];
      if (!cr) return 0;                               // three gold seams: it holds
      grade = 3;
    }
    var t = grade === 3 ? (v - V[2]) / (0.5 * V[2]) : (v - V[1]) / (V[2] - V[1]);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var L = grade === 3 ? IL[2] + (IL[3] - IL[2]) * t : IL[0] + (IL[1] - IL[0]) * t;
    if (L > MOT.Lmax) L = MOT.Lmax;
    if (L > cr.L) {
      if (!fresh) this._pushDmg(Sim.DMG.GROW, cracks.indexOf(cr), (L / MOT.growStep) | 0, this._panX(cr.x));
      cr.L = L;
      this.crackRev++;
    }
    if (grade === 3) {
      if (cr.nh === 0) {
        this._openHole(cr, true);
        while (cr.nh < wide) if (!this._widenHole(cr, false)) break;
      } else this._widenHole(cr, true);
    }
    cr.D0 = this.segD[cr.seg];
    return grade;
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

  /**
   * The glass's own motion on the screen, for the coming steps: what its
   * sand feels of it, in the vessel frame, cells/s² (minus the glass's
   * on-screen acceleration, in cells). The sand lives in slow motion and
   * the hand in real time, so a carried glass that stops dead barely
   * registers as a g-ratio (setMotion); but its sand was moving across the
   * screen with it and keeps that speed, and this is what gives each bed
   * its sideways momentum (slip). Zero while the glass keeps its place.
   */
  Sim.prototype.setCarry = function (kx, ky) {
    if (!this.granular) return;                        // (the engine as it was never hears of it)
    this.mKx = finiteOr0(kx); this.mKy = finiteOr0(ky);
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
    // Finer sand: the automaton's pattern is repeated PACE times a step, and the thick avalanche,
    // which lowers a face a grain at a time, is called PACE² times as often (both on average).
    var reps = 1, slN = this.steps % MOT.slEvery === 0 ? 1 : 0;
    if (PACE !== 1) {
      var pacc = this._paceAcc + PACE; reps = pacc | 0; this._paceAcc = pacc - reps;
      pacc = this._slAcc + PACE2 / MOT.slEvery; slN = pacc | 0; this._slAcc = pacc - slN;
    }
    this._reps = reps; this._slN = slN;
    if (ax * ax + ay * ay >= lim * lim || w >= MOT.idleW || w <= -MOT.idleW ||
        al >= MOT.idleAl || al <= -MOT.idleAl || this.mGz >= MOT.idleGz ||
        a[0] >= MOT.idleT || a[1] >= MOT.idleT ||
        sl[0].air || sl[1].air || sl[0].seat < 0 || sl[1].seat < 0 ||
        this.mKx * this.mKx + this.mKy * this.mKy >= lim * lim || this.slip[0] !== 0 || this.slip[1] !== 0) {
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
        var rows = this.deepRelease ? (this.gateY - this.topY) : Math.round(3 * PACE) + Math.min(need >> 3, Math.round(36 * PACE));
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
    // Inserted for sand off the upright (sim.granular): leaned or turning,
    // and for a moment after, the slopes are judged against gravity itself
    // (_caM). A glass that stands straight and has been left alone never
    // comes here, and steps exactly as it always did.
    var off = false;
    if (this.granular) {
      off = this.flipping || gx > MOT.offLean || gx < -MOT.offLean || gy < 0;
      if (off) this._offAt = this.steps;
      else off = this.steps - this._offAt < MOT.handBack;
    }
    // (each bed holds its own slope beyond thS and thD until a lean has taken it: see upTop. What
    // the glass builds standing straight, under its own rules, is held again in full.)
    var upT = 0, upB = 0;
    if (off) { upT = this._hold(0, gx, gy); upB = this._hold(1, gx, gy); }
    else if (this.granular) { this._keep[0] = 1; this._keep[1] = 1; }
    for (var rep = 0; rep < reps; rep++) {
      if (off) {
        // (the step's thick avalanches, shared among its repetitions: one, at the first, unless setPace)
        for (var sk = ((rep + 1) * slN / reps | 0) - (rep * slN / reps | 0); sk > 0; sk--) {
          if (this.quiet < 24 || this._aval[0] || this._aval[1]) { this._slump(0, gx, gy, 0); this._slump(1, gx, gy, 0); }
        }
        if (upT === upB) this._caM(gx, gy, 1, H - 1, false, 1, 0, upT);
        else {                                              // the lower bulb's rows first, as one sweep takes them
          this._caM(gx, gy, this.gateY, H - 1, false, 1, 0, upB);
          this._caM(gx, gy, 1, this.gateY, false, 1, 0, upT);
        }
        if (this.flipping || gy < 0.7) { if (MOT.offSweeps > 1) this._caM(gx, gy, 1, H - 1, false, 0, 0, 0); }
        else {
          var extraM = this.topSweeps;
          while (extraM-- > 0) this._caM(gx, gy, 1, this.gateY, false, 0, 0, upT);
          // A neck that has run short is fed as it always was. Leaned far over, sand may
          // rightly lie at rest on the low side of the funnel, but the glass is a timer and
          // owes the clock its sand: these sweeps let it creep on down to the neck.
          extraM = ((lag > 10 ? 1 : 0) + (lag > 60 ? 3 : 0)) * FEEDK;
          while (extraM-- > 0) this._ca(gx, gy, 1, this.gateY);
        }
      } else if (this.flipping || gy < 0.7) {
        this._ca(gx, gy, 1, H - 1);
        this._ca(gx, gy, 1, H - 1);
      } else {
        this._ca(gx, gy, 1, H - 1);
        var extra = this.topSweeps + ((lag > 10 ? 1 : 0) + (lag > 60 ? 2 : 0)) * FEEDK;
        while (extra-- > 0) this._ca(gx, gy, 1, this.gateY);
      }
    }

    // 3. Free-falling grains.
    if (this.np) this._particles(gx, gy);
    if (this.layers) { for (rep = 0; rep < reps; rep++) this._sift(); if (this._dev > 0) this._develop(); }

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
    var bf = this.bf, hs = this.hSlow, cen = this.cen, agit = this.agit, slug = this.slug;
    var entry = !this._motionStep, b, T, n;
    this._motionStep = true;
    if (this.granular) this._offAt = this.steps;

    // 1. The heading. The clock, the valve's upright test, tiltSwap and the
    //    shading read only this quasi-static ĝ, so a shake never pauses the
    //    clock or turns the glass over.
    var ang = this.angle + this.tilt;
    var gx = Math.sin(ang), gy = Math.cos(ang);
    this.gx = gx; this.gy = gy;

    // 2. Where each bed is: the rotational terms act at its centroid.
    if (entry || this.steps - this._cenAt >= MOT.cenEvery) this._centroids();

    // 3. The field each bed feels, and how hot the sand runs.
    //    f_b = G·ĝ + h_b, with h_b = A + λ·[ω²·r_b + α·(r_y, −r_x)]: gravity,
    //    plus the felt acceleration of the glass and centrifugal and Euler at
    //    the bed. Only a change in h_b heats the sand (|h − h̄|), and shaking
    //    out of the screen's plane. Gravity is left out on purpose: turning
    //    the glass swings gravity round in the glass's own frame, and a slow
    //    turn, a lean or the Flip button must leave the sand as calm as it
    //    always was; it slides and avalanches on its own as the glass turns.
    var lam = this.mLam, w = this.mW, w2 = lam * w * w, la = lam * this.mAl;
    var Ax = this.mAx, Ay = this.mAy;
    var Fx = G * gx + Ax, Fy = G * gy + Ay;                 // the neck (r = 0) feels just this
    var kS = 1 - Math.exp(-DT / MOT.tauSlow), kT = 1 - Math.exp(-DT / MOT.tauT);
    var gzD = MOT.gzK * this.mGz;
    // (below full quality, which the app's governor sets on a device that cannot keep up, a moved
    // glass is stepped as it always was: the old automaton, no thick avalanches, no bed momentum)
    var gran = this.granular && this.quality >= 2, lvx = gy, lvy = -gx;  // the level, across gravity
    // (a slide the lighter level cut short ends there: nothing below would ever stop it, and the step would never idle)
    if (!gran) { this.slip[0] = this.slip[1] = 0; this.slipAcc[0] = this.slipAcc[1] = 0; }
    for (b = 0; b < 2; b++) {
      var rx = cen[2 * b], ry = cen[2 * b + 1];
      var hx = Ax + w2 * rx + la * ry, hy = Ay + w2 * ry - la * rx;
      bf[2 * b] = Fx + w2 * rx + la * ry; bf[2 * b + 1] = Fy + w2 * ry - la * rx;
      if (entry) {                                    // no fake kick on the way in
        hs[2 * b] = hx; hs[2 * b + 1] = hy;
      } else {
        hs[2 * b] += (hx - hs[2 * b]) * kS;
        hs[2 * b + 1] += (hy - hs[2 * b + 1]) * kS;
      }
      var ex = hx - hs[2 * b], ey = hy - hs[2 * b + 1];
      var D = Math.sqrt(ex * ex + ey * ey) / G + gzD;
      if (D > 3) D = 3;
      T = agit[b] + (D - agit[b]) * kT;
      agit[b] = T > 3 ? 3 : T;
      if (gran) {
        // A bed pushed sideways harder than friction holds it slides, and keeps sliding
        // until friction has taken its speed: sand has inertia. The push is the level
        // part of what the bed feels, and of the glass's own motion on the screen
        // (setCarry). While it slides, its automaton and its avalanches run in a field
        // that leans the way it is still going (lean); bf, which the flying bed and the
        // glass's damage read, is left as it is.
        var aH = hx * lvx + hy * lvy + (this.mKx * lvx + this.mKy * lvy) * MOT.slipK;
        var aN = G + hx * gx + hy * gy;
        if (aN < 0) aN = 0;
        var sp = this.slip[b], fK = MOT.muK * aN, nsp;
        if (this.reduced || slug[b].air) sp = 0;
        else if (sp === 0) {
          if (aH > MOT.muS * aN) sp = (aH - fK) * DT; else if (aH < -MOT.muS * aN) sp = (aH + fK) * DT;
        } else {
          nsp = sp + (aH - (sp > 0 ? fK : -fK)) * DT;
          sp = (nsp > 0) === (sp > 0) ? nsp : 0;
        }
        if (sp > MOT.slipMax) sp = MOT.slipMax; else if (sp < -MOT.slipMax) sp = -MOT.slipMax;
        this.slip[b] = sp;
        var add = sp === 0 ? 0 : (sp > 0 ? fK + sp * MOT.slipC : -fK + sp * MOT.slipC);
        this.lean[2 * b] = bf[2 * b] + add * lvx; this.lean[2 * b + 1] = bf[2 * b + 1] + add * lvy;
      }
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
          var rows = this.deepRelease ? (gate - this.topY) : Math.round(3 * PACE) + Math.min(need >> 3, Math.round(36 * PACE));
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
    // (a glass spun fast flings its sand about: there the automaton that judges slopes against the
    // field has nothing to add and costs more, so above spinW the sand is stepped as it always was)
    var granCA = this._granCA = gran && w < MOT.spinW && w > -MOT.spinW;
    var base = (this.flipping || gy < 0.7) ? (granCA ? MOT.offSweeps : 2) : 1, qual = this.quality;
    var maxS = qual >= 2 ? MOT.maxSweeps : (qual === 1 ? (MOT.maxSweeps < 2 ? MOT.maxSweeps : 2) : 1);
    if (granCA && maxS > MOT.maxSweepsG) maxS = MOT.maxSweepsG;         // (its first sweep carries a moving grain several cells)
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
      // (those go by the old automaton, _caBulb's feed: sand at rest on the low side of a
      // leaned funnel still creeps down to a neck that has run short)
      var feed = 0;
      if (b === 0 && !this.flipping && gy >= 0.7) { n += this.topSweeps; feed = ((starved > 10 ? 1 : 0) + (starved > 60 ? (granCA ? 3 : 2) : 0)) * FEEDK; }
      if (!granCA) { n += feed; feed = 0; }
      if (gran && this.slip[b] !== 0) {
        // the bed is moved over the glass by what it has slid (while its rows lie near the level)
        if (gy >= 0.7 || gy <= -0.7) {
          var acS = this.slipAcc[b] + this.slip[b] * lvx * DT, shifts = 0, got;
          while ((acS >= 1 || acS <= -1) && shifts < MOT.slipShifts) {
            got = this._slide(b, acS > 0 ? 1 : -1);
            acS += acS > 0 ? -1 : 1; shifts++;
            if (got < MOT.slipStop * this._slideN) { this.slip[b] = 0; acS = 0; break; }   // packed against the glass: the wall has its momentum
          }
          if (acS > 1) acS = 1; else if (acS < -1) acS = -1;
          this.slipAcc[b] = acS;
        }
      } else if (gran) this.slipAcc[b] = 0;
      if (n + feed > 0 && gran && this.slip[b] !== 0) {
        var ex = this.lean[2 * b], ey = this.lean[2 * b + 1], em = Math.sqrt(ex * ex + ey * ey) || 1;
        this._caBulb(b, ex / em, ey / em, n, true, T, feed);
      } else if (n + feed > 0) this._caBulb(b, bx / mag, by / mag, n, T > 0.05 || spin || this.steps - this._landAt[b] < 8, T, feed);
    }

    // 7. A hot surface boils: grains hop off it.
    if (!this.reduced && qual >= 1) {
      for (b = 0; b < 2; b++) if (agit[b] > MOT.hopT && !slug[b].air) this._hops(b);
    }

    // 8. Grains in the air, in the full field.
    if (this.np) this._particlesM();
    if (this.layers) { for (var rs = this._reps; rs > 0; rs--) this._sift(); if (this._dev > 0) this._develop(); }

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
   * The slope bulb b's bed holds beyond thS and thD (degrees: see upTop),
   * under a field along (ux, uy) (a unit vector in the glass's frame). The
   * field's lean takes it away, and it stays away: _keep is the share left,
   * and only the upright glass's own step gives it back.
   */
  Sim.prototype._hold = function (b, ux, uy) {
    var most = b ? MOT.upBot : MOT.upTop, keep = this._keep;
    if (keep[b] <= 0) return 0;
    var f = uy > 0 ? 1 - Math.atan2(ux < 0 ? -ux : ux, uy) * 57.29577951308232 / MOT.upLean : 0;
    if (f < keep[b]) keep[b] = f > 0 ? f : 0;
    return most * keep[b];
  };

  /**
   * n sweeps of bulb b's automaton along (ux, uy). Shaken sand loses its
   * friction (vibration fluidises a bed), so the stick-slip odds are lerped
   * toward free flow with the temperature T for these sweeps only.
   *
   * Only the rows that hold sand are swept. A row that is empty when a sweep
   * starts is still empty when the sweep reaches it (sand enters it only
   * from rows swept after it, and a grain that has moved is done for that
   * sweep), and sand spreads by at most one row per sweep; so the sweeps
   * start on the rows that hold sand and widen by a row each time. Every
   * grain meets the same rules as under full sweeps: only the dice rolled
   * for empty rows are saved. It helps most when a bulb holds little sand,
   * or a spin has flung its bed toward the far end.
   */
  Sim.prototype._caBulb = function (b, ux, uy, n, full, T, feed) {
    var yLo = b ? this.gateY + 1 : 1, yHi = b ? this.H - 1 : this.gateY;
    var lo = this._sandRow(yLo, yHi - 1, 1);
    if (lo < 0) return;                               // no sand in this bulb
    var hi = this._sandRow(yHi - 1, lo, -1);
    var c0 = this.pCreep, s0 = this.pSlide, w0 = this.pWake, d0 = this.pDiag;
    var s = 1.2 * (T - MOT.fricS0) / MOT.fricS1;
    if (s > 0) {
      // Rounded up: the automaton compares whole dice (0 … 255) with these,
      // and d < p is d < ⌈p⌉ for a whole d, so nothing changes, and the odds
      // stay whole numbers (see asDoubles: no change of shape mid-shake).
      if (s > 1) s = 1;
      this.pCreep = Math.ceil(c0 + (MOT.pCreepMax - c0) * s);
      this.pSlide = Math.ceil(s0 + (MOT.pSlideMax - s0) * s);
      this.pWake = Math.ceil(w0 + (MOT.pWakeMax - w0) * s);
      this.pDiag = Math.ceil(d0 + (MOT.pDiagMax - d0) * s);
    }
    var k, a, z, rep, reps = this._reps, slN = this._slN;
    if (this._granCA) {
      // the first sweep is kinetic and can carry sand kq rows
      var kq = MOT.kinA > 0 ? MOT.kFall + 2 : 1;
      var hot = (T - MOT.hotT0) / (MOT.hotT1 - MOT.hotT0);
      hot = hot > 0 ? (hot > 1 ? 1 : hot) : 0;
      var up = this._hold(b, ux, uy);
      // (a fast spin throws the sand: there is no avalanche to work out)
      // (finer sand repeats the pattern: reps is 1 unless setPace)
      for (rep = 0; rep < reps; rep++) {
        for (var sk = ((rep + 1) * slN / reps | 0) - (rep * slN / reps | 0); sk > 0; sk--) {
          if (this.mW < MOT.slW && this.mW > -MOT.slW) this._slump(b, ux, uy, hot);
        }
        for (k = 0; k < n; k++) {
          a = lo - (rep * n + k + 1) * kq; z = hi + 1 + (rep * n + k + 1) * kq;
          this._caM(ux, uy, a < yLo ? yLo : a, z > yHi ? yHi : z, full, k === 0 ? 1 : 0, hot, up);
        }
      }
      // feed: sweeps of the old automaton for a neck that has run short (see step)
      for (k = 0; k < feed * reps; k++) {
        a = lo - (reps * n + 1) * kq - k; z = hi + 1 + (reps * n + 1) * kq + k;
        this._ca(ux, uy, a < yLo ? yLo : a, z > yHi ? yHi : z, full);
      }
    } else for (rep = 0; rep < reps; rep++) for (k = 0; k < n; k++) {
      a = lo - (rep * n + k); z = hi + 1 + rep * n + k;                     // rows a … z − 1
      this._ca(ux, uy, a < yLo ? yLo : a, z > yHi ? yHi : z, full);
    }
    this.pCreep = c0; this.pSlide = s0; this.pWake = w0; this.pDiag = d0;
  };

  /**
   * The first row from y0 toward y1 (step dy = ±1) that holds a grain, or
   * −1. Four cells at a time: sand is the only cell value with bit 1 set
   * (REST 2, MOVE 3), and a word that runs past either end of a row reads
   * only glass, since every row starts and ends in solid wall.
   */
  Sim.prototype._sandRow = function (y0, y1, dy) {
    var w32 = this._cell32, W = this.W, rowMin = this.rowMin, rowMax = this.rowMax;
    for (var y = y0; dy > 0 ? y <= y1 : y >= y1; y += dy) {
      if (rowMin[y] > rowMax[y]) continue;
      var base = y * W, e = (base + rowMax[y]) >> 2;
      for (var q = (base + rowMin[y]) >> 2; q <= e; q++) {
        if ((w32[q] & 0x02020202) !== 0) return y;
      }
    }
    return -1;
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
        var p = this.np++, e3 = MOT.sprayE + MOT.sprayEr * this._rand();
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
    this.segHit[s] += d;
    d += this.segP[s];
    this.segP[s] = d > MOT.Pmax ? MOT.Pmax : d;
    this._pendP = true;
    this._loadAt = this.steps;
  };

  /**
   * A flick of the glass by hand has just been let go; gPeak is the most its
   * spin pressed the sand on the domes while the hand had it (g at the dome,
   * λ·ω²·HB/G). One dose of damage, written at once on the weakest dome
   * stretch (or the open crack there): nothing below flickG[0], flickD from
   * flickG[1], so casual flicks never mark the glass and three hard ones
   * crack it. The creak or the crack is queued at once, for the app to play
   * inside the gesture. Returns the dose.
   */
  Sim.prototype.flick = function (gPeak) {
    gPeak = finiteOr0(gPeak);
    var d = (gPeak - MOT.flickG[0]) / (MOT.flickG[1] - MOT.flickG[0]);
    if (!(d > 0)) return 0;
    d = (d > 1 ? 1 : d) * MOT.flickD;
    var sc = this.segCrack, pick = -1, pickW = 0, open = -1, s, k;
    for (var q = 0; q < 4; q++) {
      for (var u = WALL_BINS - MOT.domeBins; u < WALL_BINS; u++) {
        s = q * WALL_BINS + u;
        k = sc[s];
        if (k >= 0) { if (!this.cracks[k].sealed && open < 0) open = s; continue; }     // mended gold holds
        var w = this.segKt[s] / this.segS[s];
        if (w > pickW) { pickW = w; pick = s; }
      }
    }
    s = open >= 0 ? open : pick;
    if (s < 0) return 0;
    this.segHit[s] += d;
    k = this.segD[s] + d;
    this.segD[s] = k > MOT.Dcap ? MOT.Dcap : k;
    this._pendP = true;
    this.quiet = 0;
    if (open < 0 && k >= 1 && this.cracks.length < MOT.maxCracks && this.steps >= this._crackHold) this._initCrack(s, -1);
    this._scanDamage(true);
    return d;
  };

  /**
   * The phone itself is being shaken hard, in whatever direction: n more
   * swings of a sustained shake, as motion.js counts them from all three
   * axes. Across the screen's plane a shake throws no bed that could land
   * (the lattice is flat), so each swing loads the glass directly: shakeD on
   * the weakest stretch of wall beside the sand of the fuller bulb, absorbed
   * like any other load. Only while damage is armed, and not while landings
   * are loading the glass already. Returns the stretch loaded, or −1.
   */
  Sim.prototype.shake = function (n) {
    if (!(n > 0) || !this.damageArmed || this.reduced) return -1;
    if (this.steps - this._loadAt < MOT.shakeQuiet) return -1;
    if (n > 4) n = 4;
    var b = this.nTop >= this.total - this.nTop ? 0 : 1, best = this._shakeSeg, k;
    // one shake wears on one place: the stretch chosen as it began, while the swings keep coming
    if (best >= 0 && this.steps - this._shakeAt < 60) {
      k = this.segCrack[best];
      if (k >= 0 && this.cracks[k].sealed) best = -1;
    } else best = -1;
    if (best < 0) best = this._shakeSite(b);
    if (best < 0) return -1;
    this._shakeSeg = best; this._shakeAt = this.steps;
    var d = MOT.shakeD * n;
    this.segHit[best] += d;
    d += this.segP[best];
    this.segP[best] = d > MOT.Pmax ? MOT.Pmax : d;
    this._pendP = true;
    this.quiet = 0;
    return best;
  };
  /** The weakest stretch of wall beside the sand of bulb b (a mended one never), or −1. */
  Sim.prototype._shakeSite = function (b) {
    var g = this.geo, gate = this.gateY, k;
    var lo = this._sandRow(b ? gate + 1 : 1, b ? this.H - 2 : gate - 1, 1);
    if (lo < 0) return -1;
    var hi = this._sandRow(b ? this.H - 2 : gate - 1, lo, -1);
    var u0 = (lo + 0.5 - g.cy) / g.HB, u1 = (hi + 0.5 - g.cy) / g.HB;
    if (u0 < 0) u0 = -u0;
    if (u1 < 0) u1 = -u1;
    if (u0 > u1) { k = u0; u0 = u1; u1 = k; }
    var b0 = (u0 * WALL_BINS) | 0, b1 = (u1 * WALL_BINS) | 0, best = -1, bestW = 0;
    if (b1 > WALL_BINS - 1) b1 = WALL_BINS - 1;
    for (var side = 0; side < 2; side++) {
      for (var bin = b0; bin <= b1; bin++) {
        var s = (b * 2 + side) * WALL_BINS + bin;
        k = this.segCrack[s];
        if (k >= 0 && this.cracks[k].sealed) continue;                 // mended gold holds
        var w = this.segKt[s] / this.segS[s];
        if (w > bestW) { bestW = w; best = s; }
      }
    }
    return best;
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
    var n = Math.floor((T - MOT.hopT) * MOT.hopK + this._rand());
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
      var sp = MOT.hopV0 + MOT.hopV * Tc * (0.3 + 0.7 * this._rand());
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
    // A grain in the air belongs to the room, not to the glass: when the glass is carried
    // off or stopped (setCarry) the grain keeps the speed it had, so in the glass's frame
    // it feels all of the glass's own acceleration, in cells. Exactly nothing while the
    // glass keeps its place.
    var Kx = this.granular ? this.mKx * MOT.airK : 0, Ky = this.granular ? this.mKy * MOT.airK : 0;
    Fx += Kx; Fy += Ky;
    // Coriolis, −2Ω×v = 2ω(v_y, −v_x), at √λ (sim speeds are slow-motion
    // real speeds), applied as an exact-norm Cayley rotation by c = √λ·ω·Δt:
    // explicit Euler would gain about 2 % of speed per step at 4π rad/s.
    var c = Math.sqrt(lam) * w * DT, cn = 1 / (1 + c * c), cA = (1 - c * c) * cn, cB = 2 * c * cn;
    var aLim = 0.02 * G;
    var calm = Ax * Ax + Ay * Ay < aLim * aLim && Kx * Kx + Ky * Ky < aLim * aLim && w < 0.2 && w > -0.2;
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
      if (sp > 45 * PACE && bounces === 0) {
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
        if (bounces > 3 || sp < 70 * PACE) settle = true;
      } else if (bounces < 2 && sp > 190 * PACE && q1 < 0.55) {
        // kinetic splash: a short hop off the sand before settling
        var hop = sp * (0.06 + q2 * 0.15);
        if (hop > 235 * PACE) hop = 235 * PACE;
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
    var wob = (Math.sin(t * 2.1 + 1.9 * Math.sin(t * 0.53)) * 1.2 + Math.sin(t * 5.3 + 0.7) * 0.35) * PACE;
    var fx = mid + wob + (this._rand() + this._rand() - 1) * 1.05 * PACE;
    if (fx < this.gateX0 + 0.15) fx = this.gateX0 + 0.15;
    if (fx > this.gateX1 + 0.85) fx = this.gateX1 + 0.85;
    var y = this.gateY + 1;
    if (this.cell[y * this.W + (fx | 0)] !== EMPTY) return false;   // lower bulb is full
    var p = this.np++;
    this.px[p] = fx;
    this.py[p] = y + 0.05 + this._rand() * 0.6;
    this.pvx[p] = (this._rand() - 0.5) * 16 * PACE;
    this.pvy[p] = (118 + this._rand() * 64) * PACE;
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
    var tone = this.layers && n > 0 ? this._pourLayer(n) : -1;
    while (made < n) {
      if (this.total >= this.maxTotal || this.np >= this.PCAP) break;
      var x = g.cx + (this._rand() - 0.5) * 5.5 * PACE;
      var y = y0 + this._rand() * 3;
      if (this.cell[(y | 0) * W + (x | 0)] !== EMPTY) break;    // bulb is brim-full
      var p = this.np++;
      this.px[p] = x; this.py[p] = y;
      this.pvx[p] = (this._rand() - 0.5) * 30 * PACE;
      this.pvy[p] = (70 + this._rand() * 70) * PACE;
      this.pseed[p] = (this._rand() * 256) | 0;
      if (tone >= 0) this.pseed[p] = (this.pseed[p] & 127) | tone;
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
   *  The automaton off the upright (sim.granular). _ca judges every
   *  slope in the lattice's own frame and dithers between two frames 45°
   *  apart, which is right for a glass standing straight and wrong for
   *  any other: leaned, its sand has no angle of repose and creeps flat
   *  like a slow liquid. Here the grains, the odds and the stick-slip
   *  are the same, but every slope is judged against the field itself:
   *    - a grain falls along the two lattice directions the field lies
   *      between, in the odds that give the field's own direction;
   *    - it steps sideways only when the slope beyond the step, probed
   *      along a true line below the field's horizontal, is steeper than
   *      sand can hold: thS for a grain at rest, thD for one already
   *      moving (the line's phase is dithered, so the threshold is not
   *      quantised to the lattice);
   *    - rows sleep at any lean, so sand that has found its slope costs
   *      nothing and the glass comes to rest.
   *  kin: a kinetic sweep (the first of a step). A grain that keeps
   *  moving gathers speed (run, carried with it as its seed is): a fall
   *  covers 1 + kinA·run cells, which is g·t, and a slide runs on.
   *  hot (0 … 1): shaken sand holds shallower slopes (thHot).
   *  up: degrees the sand holds beyond thS and thD (near the upright: _hold).
   * ---------------------------------------------------------------- */
  Sim.prototype._caM = function (gx, gy, yLo, yHi, forceFull, kin, hot, up) {
    var W = this.W;
    var cell = this.cell, seed = this.seed, stamp = this.stamp, run = this.run;
    var rowMin = this.rowMin, rowMax = this.rowMax;
    var tick = this.tick = (this.tick % 250) + 1;
    var s = this.rng | 0;
    var pDiag = this.pDiag, pSlide = this.pSlide, pWake = this.pWake, pCreep = this.pCreep;
    var RD = Math.PI / 180;

    var gm = Math.sqrt(gx * gx + gy * gy) || 1, ux = gx / gm, uy = gy / gm;
    var a8 = Math.atan2(ux, uy) / (Math.PI / 4);
    var k0 = Math.floor(a8), frac = a8 - k0;
    if (frac > 0.998) { k0 += 1; frac = 0; } else if (frac < 0.002) frac = 0;
    var kA = ((k0 % 8) + 8) % 8, kB = (kA + 1) & 7;
    var phi = frac * 45;                                  // the field's angle from A toward B, degrees
    // the odds of B that make the mean step point along the field (A is an axis when kA is even)
    var pB = frac === 0 ? 0 : Math.round(((kA & 1) ? 1 - Math.tan((45 - phi) * RD) : Math.tan(phi * RD)) * 256);
    var dA = DX[kA] + DY[kA] * W, dB = DX[kB] + DY[kB] * W;
    var aDA = 90 - phi, aDB = 45 + phi;                   // how steeply each descends below the field's horizontal

    var cool = hot > 0 ? 1 - MOT.thHot * (hot > 1 ? 1 : hot) : 1;
    up = up > 0 ? up : 0;
    var thS = (MOT.thS + up) * cool, thD = (MOT.thD + up) * cool, nS = MOT.nS, nD = MOT.nD;

    // The steps to either side, steepest first. A: toward lower k; B: toward higher k.
    var kq;
    kq = (kA + 7) & 7; var cA1 = DX[kq] + DY[kq] * W, aA1 = 45 - phi;
    kq = (kA + 6) & 7; var cA2 = phi <= 22.5 ? DX[kq] + DY[kq] * W : 0;
    kq = (kB + 1) & 7; var cB1 = DX[kq] + DY[kq] * W, aB1 = phi;
    kq = (kB + 2) & 7; var cB2 = phi >= 22.5 ? DX[kq] + DY[kq] * W : 0;

    // True-line probes beyond a step: side (A 0, B 1) × class (at rest 0, moving 1) × 4 phases × 8 cells.
    var LN = this._lnOff, key = this._lnKey;
    var side, cls, ph, j, hx, hy, th, dx, dy, sh, q;
    if (key[0] !== ux || key[1] !== uy || key[2] !== cool || key[3] !== up) {
      key[0] = ux; key[1] = uy; key[2] = cool; key[3] = up;
      for (side = 0; side < 2; side++) {
        hx = side ? uy : -uy; hy = side ? -ux : ux;       // the field's horizontal toward this side
        for (cls = 0; cls < 2; cls++) {
          th = (cls ? thD : thS) * RD;
          dx = Math.cos(th) * hx + Math.sin(th) * ux; dy = Math.cos(th) * hy + Math.sin(th) * uy;
          for (ph = 0; ph < 4; ph++) {
            sh = (ph + 0.5) / 4 - 0.5;
            q = ((side * 2 + cls) * 4 + ph) * 8;
            for (j = 1; j <= 8; j++) LN[q + j - 1] = Math.round(j * dx + sh * ux) + Math.round(j * dy + sh * uy) * W;
          }
        }
      }
    }

    var y, yEnd, yStep;
    if (uy >= 0) { y = yHi - 1; yEnd = yLo - 1; yStep = -1; }
    else { y = yLo; yEnd = yHi; yStep = 1; }
    var fixedX = ux > 0.35 ? -1 : (ux < -0.35 ? 1 : 0);

    var kinA = kin ? Math.round(MOT.kinA * 256) : 0, kFall = MOT.kFall, kS = kin ? MOT.kSlide : 1, pLet = MOT.pLet;
    var moved = 0, slides = 0, pending = 0, mark, k;
    var i, i0, c, cN, x, n, xs, base, x0, x1, p, t, tA, tB, lA, lB, o, a, r, K, nm, fall, prim, oth, aOth, wall, thr, np2, ok, d;

    var act = this.rowAct;
    var full = forceFull === true || (this.steps & 63) === 0;
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

        // packed in on every side it could go: nothing to decide (most grains, most of the time)
        if (cell[i + dA] !== EMPTY && cell[i + dB] !== EMPTY && cell[i + cA1] !== EMPTY && cell[i + cB1] !== EMPTY &&
            (cA2 === 0 || cell[i + cA2] !== EMPTY) && (cB2 === 0 || cell[i + cB2] !== EMPTY)) {
          if (c === MOVE) cell[i] = REST;
          if (run[i] !== 0) run[i] = 0;
          continue;
        }
        // The grain is carried in the hand until it has finished moving (cell[i0] still
        // reads as sand meanwhile, so it cannot step back to where it started); cN is
        // the state it is left in.
        i0 = i; r = run[i]; nm = 0; cN = c;
        K = 1 + ((r * kinA) >> 8);
        if (K > kFall) K = kFall;
        for (;;) {
          s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
          // --- fall along the field ------------------------------------------
          if (pB !== 0 && (s & 255) < pB) { prim = dB; oth = dA; aOth = aDA; }
          else { prim = dA; oth = dB; aOth = aDB; }
          fall = 0;
          if (cell[i + prim] === EMPTY) { t = prim; fall = 1; }
          else if (aOth >= 67.5 && cell[i + oth] === EMPTY) { t = oth; fall = 1; }
          if (fall === 1) {
            // packed sand does not drop as one block: a grain at rest takes a moment to let go
            if (c === REST && ((s >>> 16) & 255) >= pLet) { cN = MOVE; pending++; break; }
          } else {
            // --- a step to the side, if the slope beyond it is too steep -------
            wall = cell[i + dA] === WALL || cell[i + dB] === WALL;
            cls = (c === MOVE || wall) ? 1 : 0;
            thr = cls ? thD : thS; np2 = cls ? nD : nS;
            ph = Math.imul(i, 0x9E3779B1) >>> 30;         // the line's phase, by place: a grain is stable or it is not, whenever it is asked
            tA = 0; lA = 0; tB = 0; lB = 0;
            // side A
            q = (cls * 4 + ph) * 8;
            if (oth === dA && aOth < 67.5 && cell[i + dA] === EMPTY) tA = dA;
            if (tA === 0 && cell[i + cA1] === EMPTY) {
              if (aA1 >= thr) tA = cA1;
              else {
                o = i + cA1; ok = 1;
                for (j = 0; j < np2; j++) if (cell[o + LN[q + j]] !== EMPTY) { ok = 0; break; }
                if (ok) { tA = cA1; lA = 1; }
              }
            }
            if (tA === 0 && cA2 !== 0 && cell[i + cA2] === EMPTY) {
              o = i + cA2; ok = 1;
              for (j = 0; j < np2; j++) if (cell[o + LN[q + j]] !== EMPTY) { ok = 0; break; }
              if (ok) { tA = cA2; lA = 1; }
            }
            // side B
            q = ((2 + cls) * 4 + ph) * 8;
            if (oth === dB && aOth < 67.5 && cell[i + dB] === EMPTY) tB = dB;
            if (tB === 0 && cell[i + cB1] === EMPTY) {
              if (aB1 >= thr) tB = cB1;
              else {
                o = i + cB1; ok = 1;
                for (j = 0; j < np2; j++) if (cell[o + LN[q + j]] !== EMPTY) { ok = 0; break; }
                if (ok) { tB = cB1; lB = 1; }
              }
            }
            if (tB === 0 && cB2 !== 0 && cell[i + cB2] === EMPTY) {
              o = i + cB2; ok = 1;
              for (j = 0; j < np2; j++) if (cell[o + LN[q + j]] !== EMPTY) { ok = 0; break; }
              if (ok) { tB = cB2; lB = 1; }
            }
            if (tA === 0 && tB === 0) { cN = REST; break; }
            if (tA !== 0 && tB !== 0) { if (s & 1024) { t = tA; a = lA; } else { t = tB; a = lB; } }
            else if (tA !== 0) { t = tA; a = lA; }
            else { t = tB; a = lB; }
            p = a === 0 ? pDiag : (wall ? 256 : (c === MOVE ? pSlide : pCreep));
            if (((s >>> 12) & 255) >= p) {
              // could have gone: look again (a steep step keeps the grain awake, a slope lets it rest)
              cN = a === 0 ? MOVE : REST;
              pending++;
              break;
            }
            slides++;
          }
          // --- move ------------------------------------------------------------
          d = i + t;
          if (fall === 0 && ((s >>> 20) & 255) < pWake) {
            // an avalanche spreads: what leaned on this grain, and what it lands on
            if (cell[i - dA] === REST) cell[i - dA] = MOVE;
            if (cell[i - dB] === REST) cell[i - dB] = MOVE;
            if (cell[i - t] === REST) cell[i - t] = MOVE;
            if (cell[d + dA] === REST) cell[d + dA] = MOVE;
          }
          i = d; c = cN = MOVE; nm++;
          if (fall ? nm >= K : nm >= kS) break;
        }
        if (nm > 0) {
          cell[i] = cN; seed[i] = seed[i0]; cell[i0] = EMPTY;
          moved++;
          stamp[i] = tick;
          run[i0] = 0;
          run[i] = kin ? (r < 255 ? r + 1 : 255) : r;
          if (nm > 1) {                                   // a long move: wake where it went
            k = ((i / W) | 0) - 3; if (k < 0) k = 0;
            t = k + 6; if (t > Hm) t = Hm;
            for (; k <= t; k++) act[k] = 2;
          }
        } else {
          if (cN !== cell[i0]) cell[i0] = cN;
          if (r !== 0) run[i0] = 0;
        }
      }
      if (moved + pending !== mark) {
        k = y - 3; if (k < 0) k = 0;
        n = y + 3; if (n > Hm) n = Hm;
        for (; k <= n; k++) act[k] = 2;
      }
    }
    this.rng = s || 0x9E3779B9;
    this.frame.moved += moved;
    this.frame.slides += slides;
  };

  /**
   * Move bulb b's bed one cell across the glass, toward dx (±1): every grain
   * that has room beside it steps over, row by row, so each row is pushed up
   * against the glass in order and stops there (a grain keeps its row, its
   * seed and its state, and the bed does not light up as sliding sand).
   * Returns the grains moved; _slideN is the grains it looked at.
   */
  Sim.prototype._slide = function (b, dx) {
    var W = this.W, cell = this.cell, seed = this.seed, run = this.run, rowMin = this.rowMin, rowMax = this.rowMax;
    var yLo = b ? this.gateY + 1 : 1, yHi = b ? this.H - 1 : this.gateY;
    var lo = this._sandRow(yLo, yHi - 1, 1);
    this._slideN = 0;
    if (lo < 0) return 0;
    var hi = this._sandRow(yHi - 1, lo, -1), act = this.rowAct;
    var moved = 0, n = 0, y, i, e, c;
    for (y = lo; y <= hi; y++) {
      // from the side it moves toward: a run of grains with room ahead moves up as one
      i = y * W + (dx > 0 ? rowMax[y] : rowMin[y]);
      e = y * W + (dx > 0 ? rowMin[y] : rowMax[y]);
      for (; i !== e; i -= dx) {
        c = cell[i - dx];
        if (c < REST) continue;
        n++;
        if (cell[i] !== EMPTY) continue;
        cell[i] = c; seed[i] = seed[i - dx]; run[i] = run[i - dx];
        cell[i - dx] = EMPTY; run[i - dx] = 0;
        moved++;
      }
      act[y] = 2;
    }
    this._slideN = n;
    if (moved > 0) this.frame.moved++;                 // the sand is not at rest (but a bed that slides is not grains sliding: no more than that)
    return moved;
  };

  /* ---------------------------------------------------------------- *
   *  A thick avalanche (sim.granular). The automaton moves one layer of
   *  grains a cell at a time, so a face far too steep (the sand after a
   *  flip stands at 76°) would take ten seconds and more to give way. Real
   *  sand fails in depth. Here the free surface of bulb b is read as
   *  heights across the field (one bin per cell; an empty bin's floor is
   *  the glass), and wherever it falls more steeply than sand can hold
   *  over slB bins, the top grain of the high bin is carried down to
   *  where the slope eases: started above thS + slUp, kept going down to
   *  slStop (an avalanche, once running, runs on to the angle of repose),
   *  at most slMax grains a call and slDeep from one bin, where the face
   *  is a cliff. Every move is one grain, with its seed, into one empty
   *  cell of the same bulb: nothing crosses the neck. The automaton still
   *  does the fine work. Returns the grains moved.
   * ---------------------------------------------------------------- */
  Sim.prototype._slump = function (b, gx, gy, hot) {
    var W = this.W, cell = this.cell, seed = this.seed, run = this.run, rowMin = this.rowMin, rowMax = this.rowMax;
    var yLo = b ? this.gateY + 1 : 1, yHi = b ? this.H - 1 : this.gateY;
    var lo = this._sandRow(yLo, yHi - 1, 1);
    if (lo < 0) { this._aval[b] = 0; return 0; }
    var hi = this._sandRow(yHi - 1, lo, -1);
    var gm = Math.sqrt(gx * gx + gy * gy) || 1, ux = gx / gm, uy = gy / gm, hx = uy, hy = -ux;
    var NB = SL_BINS, OFF = SL_BINS / 2 + 0.5, cx = this.geo.cx, cy = this.geo.cy;
    var top = this._slTop, topI = this._slI, flo = this._slFlo, floI = this._slFloI;
    if (top === null) {
      top = this._slTop = new Float32Array(NB); topI = this._slI = new Int32Array(NB);
      flo = this._slFlo = new Float32Array(NB); floI = this._slFloI = new Int32Array(NB);
      this._slGot = new Int32Array(NB); this._slId = 0;
    }
    // (a creeping grain is carried once a call: see below)
    var got = this._slGot, id = this._slId = (this._slId + 1) | 0;
    var x, y, i, s, h, s0 = NB, s1 = -1, x0, x1, sRow, hRow;

    // the glass under every bin: the lowest cell of the bulb's rim that falls in it
    flo.fill(1e9); floI.fill(-1);
    var cLo = this.colLo[b], cHi = this.colHi[b], k;
    for (y = yLo; y < yHi; y++) {
      x0 = rowMin[y]; x1 = rowMax[y];
      if (x0 > x1) continue;
      sRow = (y + 0.5 - cy) * hy + OFF; hRow = -(y + 0.5 - cy) * uy;
      for (k = 0; k < 2; k++) {
        x = k ? x1 : x0;
        s = ((x + 0.5 - cx) * hx + sRow) | 0; h = hRow - (x + 0.5 - cx) * ux;
        if (h < flo[s]) { flo[s] = h; floI[s] = y * W + x; }
      }
    }
    for (x = this._bx0; x <= this._bx1; x++) {
      if (cLo[x] > cHi[x]) continue;
      for (k = 0; k < 2; k++) {
        y = k ? cHi[x] : cLo[x];
        s = ((x + 0.5 - cx) * hx + (y + 0.5 - cy) * hy + OFF) | 0; h = -(y + 0.5 - cy) * uy - (x + 0.5 - cx) * ux;
        if (h < flo[s]) { flo[s] = h; floI[s] = y * W + x; }
      }
    }
    for (s = 0; s < NB; s++) if (floI[s] >= 0) { if (s < s0) s0 = s; s1 = s; }
    for (s = s0; s <= s1; s++) {
      if (floI[s] < 0) flo[s] = flo[s - 1];             // (a bin the rim skipped: as its neighbour, and no cell to set a grain on)
      top[s] = flo[s] - 1; topI[s] = -1;
    }

    // the free surface: the highest grain of every bin
    for (y = lo; y <= hi; y++) {
      x0 = rowMin[y]; x1 = rowMax[y];
      sRow = (x0 + 0.5 - cx) * hx + (y + 0.5 - cy) * hy + OFF; hRow = -(y + 0.5 - cy) * uy - (x0 + 0.5 - cx) * ux;
      for (i = y * W + x0, k = y * W + x1; i <= k; i++, sRow += hx, hRow -= ux) {
        if (cell[i] < REST) continue;
        s = sRow | 0;
        if (hRow > top[s]) { top[s] = hRow; topI[s] = i; }
      }
    }

    var RD = Math.PI / 180, cool = hot > 0 ? 1 - MOT.thHot * (hot > 1 ? 1 : hot) : 1;
    var B = MOT.slB, running = this._aval[b] > 0, up = this._hold(b, ux, uy);
    var tStart = B * Math.tan((MOT.thS + MOT.slUp + up) * cool * RD), tStop = B * Math.tan((MOT.slStop + up) * cool * RD);
    var need = running ? tStop : tStart, moved = 0, q = this.quality;
    var budget = q >= 2 ? MOT.slMax : (q === 1 ? (MOT.slMax * 0.6) | 0 : (MOT.slMax * 0.35) | 0);
    // the lattice steps that climb against the field (to set a grain on top of a bin)
    var kU = dir8(-ux, -uy), up = DX[kU] + DY[kU] * W;
    var up2 = DX[(kU + 1) & 7] + DY[(kU + 1) & 7] * W, up3 = DX[(kU + 7) & 7] + DY[(kU + 7) & 7] * W;
    var gate = this.gateY * W, isTop = b === 0, rs = this.rng | 0;
    rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5;
    var dirFirst = (rs & 1) ? 1 : -1, step1 = tStop / B * 0.5, deep = MOT.slDeep, reach = MOT.slRun, hop = MOT.slHop | 0, gain = MOT.slGain;
    var pass, dir, reps, t, drop, nx, far, j, d, e;
    for (pass = 0; pass < 2 && moved < budget; pass++) {
      dir = pass ? -dirFirst : dirFirst;                // downhill toward +s, then toward −s (the order alternates)
      for (s = dir > 0 ? s0 : s1; s >= s0 && s <= s1 && moved < budget; s += dir) {
        for (reps = 0; reps < deep && moved < budget; reps++) {
          t = s + dir * B;
          if (t < s0 || t > s1) break;
          i = topI[s];
          if (i < 0 || cell[i] < REST) break;           // (a bin's next grain may have left with a neighbour's)
          drop = top[s] - top[t];
          if (drop <= need) break;
          far = hop > 0 ? hop + ((drop - need) * gain | 0) : reach;
          if (far < B) {
            // A slope a little too steep creeps: its top grain goes a few bins down, the farther
            // the steeper, and is left moving, to be carried on at the next call if the slope
            // still asks (a bin that was given a grain in this call gives none on). Seen from
            // outside the sand flows, a layer at a time, and follows a slow tilt as it comes.
            // (From slB bins on, the cliff's rule below takes over.)
            if (got[s] === id) break;
            t = s + dir * far;
            if (top[t] > top[s] - 1) break;
          } else {
            // a cliff: it runs on down the slope while the slope still falls away (to the foot, or slRun bins)
            nx = t + dir; far = s + dir * reach;
            while (nx >= s0 && nx <= s1 && nx !== far && top[nx] <= top[t] - step1) { t = nx; nx += dir; }
          }
          j = topI[t];
          if (j >= 0) {
            if (cell[j] < REST) break;
            d = j + up;
            if (cell[d] !== EMPTY) { d = j + up2; if (cell[d] !== EMPTY) { d = j + up3; if (cell[d] !== EMPTY) break; } }
          } else {                                      // an empty bin: onto the glass
            d = floI[t];
            if (d < 0 || cell[d] !== EMPTY) break;
          }
          if ((d < gate) !== isTop) break;
          cell[d] = MOVE; seed[d] = seed[i]; cell[i] = EMPTY;
          run[d] = 0; run[i] = 0;
          topI[t] = d; top[t] = j < 0 ? flo[t] : top[t] + 1; got[t] = id;
          // the high bin's next grain: the one under it along the field
          e = i - up;
          if (cell[e] < REST) { e = i - up2; if (cell[e] < REST) e = i - up3; }
          if (cell[e] >= REST) { topI[s] = e; top[s] -= 1; if (cell[e] === REST) cell[e] = MOVE; }
          else { topI[s] = -1; top[s] = flo[s] - 1; }
          moved++;
          this._touchRow((i / W) | 0); this._touchRow((d / W) | 0);
          if (drop < need + B) break;                   // only a cliff gives way in depth
        }
      }
    }
    this.rng = rs || 0x9E3779B9;
    this._aval[b] = moved > 0 ? 1 : 0;                  // still running: keep going down to slStop
    this.frame.moved += moved; this.frame.slides += moved;
    return moved;
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
      vx += ((s & 1023) - 511.5) * 0.011 * PACE;
      vy += (((s >>> 10) & 1023) - 511.5) * 0.004 * PACE;

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
      if (sp > 45 * PACE && bounces === 0) {
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
        if (bounces > 3 || sp < 70 * PACE) settle = true;
      } else if (bounces < 2 && sp > 190 * PACE && r1 < 0.55) {
        // kinetic splash: a 2–5 cell hop off the sand before settling
        var hop = sp * (0.06 + r2 * 0.15);
        if (hop > 235 * PACE) hop = 235 * PACE;
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
            var run = (70 + r1 * 95) * PACE, lift = (22 + r2 * 46) * PACE;
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
    this.run.reverse();
    this.slip[0] = this.slip[1] = 0; this.slipAcc[0] = this.slipAcc[1] = 0;
    if (this.granular) this._offAt = this.steps;   // turned over: the sand has a fall and a slope to find
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
    this._pourLeft = 0; this._layN = -1; // sand poured or falling now lands on another surface
    if (this.layers) this._turned();
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
    flipBulbPair(this.bf); flipBulbPair(this.hSlow); flipBulbPair(this.cen);
    t = this.agit[0]; this.agit[0] = this.agit[1]; this.agit[1] = t;
    t = this.sweepAcc[0]; this.sweepAcc[0] = this.sweepAcc[1]; this.sweepAcc[1] = t;
    t = this._aval[0]; this._aval[0] = this._aval[1]; this._aval[1] = t;
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
    flipSegArray(this.segD); flipSegArray(this.segP); flipSegArray(this.segHit);
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
    if (this.layers && this._layN < 0) this._layer();
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
    if (this.layers) this._siftAll();
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
   * a stretch that reaches 1 cracks, up to maxCracks per glass, one at a
   * time (see _relieve); a crack grows with further damage, breaks through
   * and widens. Then the creaks.
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
            d = Math.pow(this.segKt[s] / this.segS[s], MOT.nB);
            d = r * (d > MOT.flawCap ? MOT.flawCap : d);
            if (d > MOT.capB) d = MOT.capB;
            this.segHit[s] += d;
            p = segP[s] + d;
            segP[s] = p > MOT.Pmax ? MOT.Pmax : p;
            this._pendP = true;
          }
        }
      }
    }
    // A fast spin presses the sand into both domes (centrifugal ω²r). Flicked
    // hard again and again, the glass creaks and then cracks at its weakest
    // dome. Finger play counts here: spinning it this hard is as deliberate
    // as shaking it, and a turn or the Flip (≤ 2.2 rad/s) never comes close.
    if (motion && this.spinArmed && this.mLam > 0) {
      var wv = this.mW < 0 ? -this.mW : this.mW;
      var gc = this.mLam * wv * wv * this.geo.HB / this.G;          // g at the dome
      if (gc > MOT.spinTh) {
        var rs = (gc - MOT.spinTh) / (MOT.spinC - MOT.spinTh);
        rs = (rs > 1 ? 1 : rs) * MOT.spinRate * DT;
        for (var q2 = 0; q2 < 4; q2++) {
          for (var u2 = WALL_BINS - MOT.domeBins; u2 < WALL_BINS; u2++) {
            s = q2 * WALL_BINS + u2;
            if (sc[s] >= 0 && this.cracks[sc[s]].sealed) continue;
            d = Math.pow(this.segKt[s] / this.segS[s], MOT.nB);
            d = rs * (d > MOT.flawCap ? MOT.flawCap : d);
            this.segHit[s] += d;
            p = segP[s] + d;
            segP[s] = p > MOT.Pmax ? MOT.Pmax : p;
            this._pendP = true;
          }
        }
      }
    }
    if (this._pendP) {
      var cap = MOT.rMax * DT, kP = Math.exp(-DT / MOT.tauP), pend = false, hit = this.segHit;
      for (s = 0; s < WALL_SEGS; s++) {
        hit[s] *= kP;
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
    var heal = 1 - DT / MOT.tauHeal, pick = -1, pickD = 0, pickH = 0;
    var hold = this.cracks.length >= MOT.maxCracks || this.steps < this._crackHold;
    for (s = 0; s < WALL_SEGS; s++) {
      d = segD[s];
      if (d <= 0) continue;
      if (sc[s] >= 0) { this._grow(sc[s]); continue; }
      if (d < 1) { segD[s] = d * heal; continue; }
      if (hold) { segD[s] = 0.999; continue; }        // the glass has its three, or has just cracked
      // Damage grows at a bounded rate, so the hardest shaking brings several
      // stretches to 1 together: the one being hit hardest now gives way.
      p = this.segHit[s];
      if (pick < 0 || p > pickH || (p === pickH && d > pickD)) { pick = s; pickH = p; pickD = d; }
    }
    if (pick >= 0) this._initCrack(pick, -1);
    this._scanDamage(true);
  };

  /**
   * A crack relaxes the glass around it: the stress that was building in
   * every other stretch without a crack eases to MOT.relief of what it was,
   * and no other crack starts for MOT.calm seconds. Under the hardest
   * shaking several stretches load up together; this way they give way one
   * at a time, each after creaks of its own, not as a sudden starburst.
   */
  Sim.prototype._relieve = function (s) {
    var segD = this.segD, segP = this.segP, sc = this.segCrack, k = MOT.relief;
    for (var q = 0; q < WALL_SEGS; q++) {
      if (q === s || sc[q] >= 0) continue;
      segD[q] *= k;
      segP[q] *= k;
    }
    this._crackHold = this.steps + Math.round(MOT.calm / DT);
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

  /** A crack starts in segment s, at wall cell `at` (−1: the usual site), and relieves the rest. Emits CRACK. */
  Sim.prototype._initCrack = function (s, at) {
    var cr = this._makeCrack(s, at >= 0 ? at : this._crackSite(s), this._rand() * 4294967296);
    this.crackRev++;
    this._pushDmg(Sim.DMG.CRACK, this.cracks.length - 1, 0, this._panX(cr.x));
    this._relieve(s);
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
   *  Layered sand: two tones that settle into strata
   *
   *  A grain's tone is bit 7 of its colour seed, the byte that has always
   *  travelled with the grain wherever it goes (the automaton, the stream,
   *  a bed in flight, a flip, a breach, the dune on the desk). So no path
   *  can leave a tone behind, and the sand itself never looks at it: with
   *  layers on, the lattice, the grains in the air and the sand's random
   *  stream evolve exactly as they do without.
   *
   *  The start is a fill laid in bands. They are drawn down through the
   *  neck together, so what falls is a mixture; and as a real mixture of
   *  two sands does (Makse, Havlin, King and Stanley, Nature 386, 1997),
   *  it settles into strata by itself. Here that is sifting: in each layer
   *  freshly laid on the heap, grains of one tone work their way down
   *  under the other, turn and turn about from layer to layer, so every
   *  layer freezes as two strata. A sifting grain trades places with a
   *  neighbour: their seeds trade cells, and the lattice is left as it is.
   *  Bands, layers and sifting draw on a random stream of their own.
   * ---------------------------------------------------------------- */

  /** Layered-sand tunables. Change values in place; the object is shared. */
  var LAY = Sim.LAYERS = {
    share: 0.4,          // the companion tone's share of sand that has no bands to go by
    pSift: 64,           // /256 chance per visit that a grain sifts under the one below it
    pSide: 128,          // /256 chance per visit that it sifts down sideways instead
    reach: 32,           // grains above the layer's floor that sifting looks at
    wait: 30,            // calm steps before a layer begins on sand that was turned or shaken
    settle: 480,         // steps after a turn in which sand coming to rest is laid in its new pattern (4 s)
    lay: 36,             // … at most this many grains a step in each bulb, so it settles in, never snaps
    pour: 420            // grains in a poured layer: pour … 2·pour
  };

  /*
   * Finer sand. A glass built at p times the scale holds p² times the
   * grains, each 1/p the size. Left to itself it would also run in slow
   * motion: a grain moves a cell a sweep, and there are p times the cells
   * to cross. setPace(p) makes the finer sand behave on screen as the sand
   * it replaces. Gravity is p times as many cells a second²; the
   * automaton's pattern of sweeps is repeated p times a step (step,
   * _caBulb); and what is measured in cells (speeds, crack lengths, layer
   * depths) or in grains (pours, leaks, caps) is scaled here to match.
   * Time is untouched: seconds, rates, and every threshold in g stay as
   * they are. What belongs to a grain stays a grain's: the slope probes,
   * the width a breach jams at, the raggedness of a seam.
   *
   * One pace for the page, as the tables above are one for the page: call
   * it before the Sim is built, with the factor the Sim's scale was raised
   * by. setPace(1) puts everything back exactly.
   */
  var MOT0 = null, LAY0 = null;
  Sim.setPace = function (p) {
    var k;
    p = p > 1 ? +p : 1;
    if (!MOT0) {
      MOT0 = {}; LAY0 = {};
      for (k in MOT) MOT0[k] = MOT[k] instanceof Array ? MOT[k].slice() : MOT[k];
      for (k in LAY) LAY0[k] = LAY[k];
    }
    for (k in MOT0) MOT[k] = MOT0[k] instanceof Array ? MOT0[k].slice() : MOT0[k];
    for (k in LAY0) LAY[k] = LAY0[k];
    PACE = p; PACE2 = p * p; FEEDK = Math.ceil(p);
    if (p === 1) return;
    // cells a second, and cells
    var lin = ['sprayV', 'hopV0', 'hopV', 'retryV', 'vMax', 'escV', 'escVr', 'escTan', 'slipMax', 'jitX', 'jitY',
               'growK', 'hRef', 'hopK', 'leakT'];
    for (k = 0; k < lin.length; k++) MOT[lin[k]] = MOT0[lin[k]] * p;
    // (whole cells: a crack's length is saved to a tenth and checked against these)
    var whole = ['L0', 'growL', 'growStep', 'Lmax', 'Lhole', 'slRun'];
    for (k = 0; k < whole.length; k++) MOT[whole[k]] = Math.round(MOT0[whole[k]] * p);
    MOT.impL = MOT0.impL.map(function (x) { return x * p; });
    MOT.slipShifts = Math.ceil(MOT0.slipShifts * p);
    MOT.gateGuard = Math.round(MOT0.gateGuard * p);
    MOT.slDeep = Math.round(MOT0.slDeep * p);
    // (a creeping slope is asked p² times as often, so each step is shorter: the flow keeps its speed on screen)
    MOT.slHop = Math.max(1, Math.round(MOT0.slHop / p));
    MOT.slGain = MOT0.slGain / Math.sqrt(p);
    // a breach as wide on screen is p times the cells, and widens in p times the steps
    MOT.wMax = Math.round(MOT0.wMax * p);
    MOT.widen = MOT0.widen / p;
    // grains
    MOT.softCap = Math.round(MOT0.softCap * p * p);
    MOT.slMax = Math.round(MOT0.slMax * p * p);
    MOT.leakCap = MOT0.leakCap * p * p;
    // a fall is g·t: the same on screen is 1/p as much a sweep, there being p sweeps
    MOT.kinA = MOT0.kinA / p;
    // the reference stress is a landing speed over √(G·cell)
    MOT.vc = MOT0.vc * Math.sqrt(p);
    LAY.reach = Math.round(LAY0.reach * p);
    LAY.lay = Math.round(LAY0.lay * p * p);
    LAY.pour = Math.round(LAY0.pour * p * p);
  };
  /** The pace the page's sand keeps (1: the sand as it always was). */
  Sim.pace = function () { return PACE; };

  /**
   * Layered sand on or off. On: the sand in the glass is laid in strata
   * where it lies. Off: the tones are forgotten (bit 7 is noise again, as
   * in a glass that never had them).
   */
  Sim.prototype.setLayers = function (on) {
    on = !!on;
    if (on === this.layers) return;
    this.layers = on;
    this._pourLeft = 0;
    this._dev = 0;
    if (on) { this._strata(); return; }
    var cell = this.cell, seed = this.seed, N = cell.length, salt = glassHash(this.rng ^ 0x3C6EF372), i;
    for (i = 0; i < N; i++) if (cell[i] >= REST) seed[i] = (seed[i] & 127) | (glassHash(i ^ salt) & 128);
    for (i = 0; i < this.np; i++) this.pseed[i] = (this.pseed[i] & 127) | (glassHash(~i ^ salt) & 128);
  };

  Sim.prototype._lrand = function () {
    var s = this._lrng;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    this._lrng = s;
    return (s >>> 0) / 4294967296;
  };

  /**
   * A pattern for the sand of bulb b, drawn afresh every time it is asked
   * for: strata of unequal thickness, fine or bold, that may lie level or
   * lean, arch or sag, run in gentle waves or fold on themselves like
   * marble. No two glasses, and no two turns of one glass, get the same.
   */
  Sim.prototype._pattern = function (b) {
    var self = this, u = function () { return self._lrand(); };
    var P = (9 + 26 * Math.pow(u(), 1.6)) * PACE;                       // one pair of strata, in cells: fine more often than bold
    var lean = u() < 0.55 ? 0.14 : 0.62;                       // level, or leaning (up to about 32 degrees)
    var fold = u() < 0.3 ? 0.35 + 0.75 * u() : 0.3 * u();      // waves, in pairs of strata: gentle, or folded
    var k = 2 * Math.PI / ((40 + 110 * u()) * PACE);
    return {
      y0: b ? this.gateY + 1 : this.topY, cx: this.geo.cx, hw: (this._bx1 - this._bx0) / 2 || 1, P: P,
      tilt: lean * (2 * u() - 1),
      bend: u() < 0.45 ? 0 : 1.8 * (2 * u() - 1),              // an arch or a sag: pairs of strata by the wall
      fold: fold * P, kx: k, ky: 0.9 * k * (u() - 0.5), p1: 2 * Math.PI * u(), p2: 2 * Math.PI * u(),
      km: 2 * Math.PI / (P * (2.5 + 3.5 * u())), p3: 2 * Math.PI * u(),   // strata swell and thin, never the same twice
      salt: glassHash((this._lrng ^ 0x7F4A7C15) | 0)
    };
  };
  /** How far through its pair of strata the cell at (x, y) lies in pattern R: 0 … 1. */
  Sim.prototype._phase = function (R, x, y) {
    var dx = x - R.cx, q = dx / R.hw;
    var v = (y - R.y0) + R.tilt * dx + R.bend * R.P * q * q +
            R.fold * (Math.sin(R.kx * x + R.ky * y + R.p1) + 0.4 * Math.sin(2.3 * R.kx * x - 1.7 * R.ky * y + R.p2)) +
            ((glassHash((y * this.W + x) ^ R.salt) >>> 8) / 16777216 - 0.5) * 1.6;      // a grain or so ragged
    v = v / R.P + 0.3 * Math.sin(v * R.km + R.p3);
    return v - Math.floor(v);
  };
  /** How deep the heap's next layers will be: fine, even, bold, or fine with a thick one now and then. */
  Sim.prototype._style = function () {
    var k = (this._lrand() * 4) | 0;
    this._layMin = [3, 4, 7, 3][k] * PACE; this._laySpan = [4, 8, 12, 18][k] * PACE; this._layPow = k === 3 ? 2.5 : 1;
  };

  /**
   * The glass has been turned over. Its sand tumbles into a blend; as it
   * comes to rest it is laid afresh, each bulb in a pattern of its own
   * (_develop), and the heap's next layers are laid another way too.
   */
  Sim.prototype._turned = function () {
    var W = this.W, cell = this.cell, seed = this.seed, x0 = this._bx0, x1 = this._bx1, b, x, y, i, n, n1;
    if (!this._want) {
      this._want = new Uint8Array(cell.length);
      this._wantAt = [new Int32Array(W), new Int32Array(W)];
      this._devNeed = [new Int32Array(LAY.lay), new Int32Array(LAY.lay)];
      this._devMov = [new Int32Array(4 * LAY.lay), new Int32Array(4 * LAY.lay)];
    }
    this._recN++;
    for (b = 0; b < 2; b++) {
      var lo = this.colLo[b], hi = this.colHi[b];
      for (x = x0, n = 0, n1 = 0; x <= x1; x++) {
        for (y = lo[x]; y <= hi[x]; y++) { i = y * W + x; if (cell[i] >= REST) { n++; n1 += seed[i] >> 7; } }
      }
      this._rec[b] = this._pattern(b);
      this._duty[b] = n ? n1 / n : 0;
    }
    this._style();
    this._dev = LAY.settle;
  };

  /**
   * One step of laying turned sand in its new pattern. A grain that has
   * come to rest in the wrong tone for its place trades seeds with one of
   * the right tone that is still on the move, so the pattern grows where
   * the sand settles and nothing changes in sand that lies still for good.
   * A quarter of the columns are looked at each step, and only so many
   * grains are laid: it settles in over a second or two, never snaps. Only
   * seeds trade places: the lattice is left as it is, and each tone keeps
   * its count.
   */
  Sim.prototype._develop = function () {
    this._dev--;
    var W = this.W, cell = this.cell, seed = this.seed, want = this._want, id = this._recN;
    var x0 = this._bx0, x1 = this._bx1, cap = LAY.lay, b, x, y, i, c, t, k, n;
    for (b = 0; b < 2; b++) {
      var lo = this.colLo[b], hi = this.colHi[b], at = this._wantAt[b], R = this._rec[b], duty = this._duty[b];
      var need = this._devNeed, mov = this._devMov, nn = [0, 0], nm = [0, 0];
      // (a quarter of the columns a step; on finer sand, where less of it is on the move at once, more of them)
      var stride = PACE2 >= 4 ? 1 : (PACE2 >= 2 ? 2 : 4);
      for (x = x0 + (this.steps + b) % stride; x <= x1; x += stride) {
        if (at[x] !== id) {
          for (y = lo[x]; y <= hi[x]; y++) want[y * W + x] = this._phase(R, x, y) < duty ? 1 : 0;
          at[x] = id;
        }
        for (y = lo[x]; y <= hi[x]; y++) {
          i = y * W + x; c = cell[i];
          if (c < REST) continue;
          t = seed[i] >> 7;
          if (c === REST) {
            k = want[i];
            if (k !== t && nn[k] < cap) need[k][nn[k]++] = i;
          } else if (nm[t] < 4 * cap) mov[t][nm[t]++] = i;
        }
      }
      for (k = 0; k < 2; k++) {
        // a resting grain that should be of tone k, and a moving one that is
        n = nn[k] < nm[k] ? nn[k] : nm[k];
        var stride = n ? (nm[k] / n) | 0 : 1;
        for (c = 0; c < n; c++) {
          i = need[k][c]; y = mov[k][c * stride];
          t = seed[i]; seed[i] = seed[y]; seed[y] = t;
        }
      }
    }
  };

  /**
   * Lay the sand in the glass in strata. Above the neck: a pattern drawn
   * afresh (_pattern), cut by the surface of the pile as it lies (level
   * in a fresh fill, the crater of a glass part-way through). The
   * companion tone never makes up most of it: the glass stays the
   * material it is. Below the neck, whatever lies there is sifted into
   * the strata a run would have left.
   */
  Sim.prototype._strata = function () {
    var W = this.W, cell = this.cell, seed = this.seed, x0 = this._bx0, x1 = this._bx1;
    var lo = this.colLo[0], hi = this.colHi[0], x, y, i, k, n0 = 0, n1 = 0;
    var salt = this._lrng = glassHash(this.rng ^ 0x51ED270B) || 0x6D2B79F5;
    var R = this._pattern(0), duty = 0.32 + 0.16 * this._lrand();
    this._style();
    this._dev = 0;
    for (x = x0; x <= x1; x++) {
      for (y = lo[x]; y <= hi[x]; y++) {
        i = y * W + x;
        if (cell[i] < REST) continue;
        k = this._phase(R, x, y) < duty ? 1 : 0;
        if (k) n1++; else n0++;
        seed[i] = (seed[i] & 127) | (k << 7);
      }
    }
    if (n1 > n0) {
      for (x = x0; x <= x1; x++) {
        for (y = lo[x]; y <= hi[x]; y++) if (cell[y * W + x] >= REST) seed[y * W + x] ^= 128;
      }
    }
    // below the neck and in the air there are no bands to go by
    var cut = LAY.share * 16777216;
    lo = this.colLo[1]; hi = this.colHi[1];
    for (x = x0; x <= x1; x++) {
      for (y = lo[x]; y <= hi[x]; y++) {
        i = y * W + x;
        if (cell[i] >= REST) seed[i] = (seed[i] & 127) | ((glassHash(i ^ salt) >>> 8) < cut ? 128 : 0);
      }
      this._lb[x] = hi[x] + 1;                         // all of it counts as freshly laid
    }
    for (i = 0; i < this.np; i++) this.pseed[i] = (this.pseed[i] & 127) | ((glassHash(~i ^ salt) >>> 8) < cut ? 128 : 0);
    this._siftAll();
  };

  /**
   * A new layer begins on the lower heap: note where its surface is now
   * (each column's first grain that rests on another, the floor where there
   * is none; a pit or a stray grain is not the surface, so each column takes
   * the median of five) and how much sand makes the layer. Sand above the
   * noted surface is the fresh layer; the tone that sifts down changes.
   */
  Sim.prototype._layer = function () {
    var W = this.W, cell = this.cell, lb = this._lb, raw = this._lbRaw, lo = this.colLo[1], hi = this.colHi[1];
    var x0 = this._bx0, x1 = this._bx1, top = this._sandRow(this.gateY + 1, this._botY, 1), wide = 0, x, y, s;
    if (top < 0) top = this.H;
    for (x = x0; x <= x1; x++) {
      s = hi[x] + 1;
      for (y = lo[x] > top ? lo[x] : top; y <= hi[x]; y++) {
        if (cell[y * W + x] >= REST && (y === hi[x] || cell[(y + 1) * W + x] >= REST)) { s = y; wide++; break; }
      }
      raw[x] = s;
    }
    for (x = x0; x <= x1; x++) {
      // the median of raw[x − 2 … x + 2]: the value with two others at or below it and two at or above
      var m = raw[x], k, q, lt, le;
      for (k = -2; k <= 2; k++) {
        if (x + k < x0 || x + k > x1) continue;
        var v = raw[x + k];
        for (q = -2, lt = 0, le = 0; q <= 2; q++) {
          if (x + q < x0 || x + q > x1) continue;
          if (raw[x + q] < v) lt++;
          if (raw[x + q] <= v) le++;
        }
        if (lt <= 2 && le >= 3) { m = v; break; }
      }
      lb[x] = m > hi[x] + 1 ? hi[x] + 1 : m;
    }
    this._layN = this.total - this.nTop;
    this._layNeed = (this._layMin + this._laySpan * Math.pow(this._lrand(), this._layPow)) * (wide > 24 * PACE ? wide : 24 * PACE);
    this._layUp ^= 1;
  };

  /**
   * One step of sifting on the lower heap (upright and calm only: a glass
   * being turned or shaken mixes its sand, and the next layer starts from
   * wherever that leaves it). Every eighth column is visited, from the
   * layer's floor up: a grain of the tone that is sinking, lying on one of
   * the other, may trade places with it, or with the one diagonally below.
   */
  Sim.prototype._sift = function () {
    if (this.flipping || this.gy <= 0.7 || this.agit[1] > 0.05 || this.slug[1].air) {
      this._layN = -1; this._layWait = LAY.wait;
      return;
    }
    if (this._layN < 0) {
      if (this._layWait > 0) { this._layWait--; return; }
      this._layer();
    } else if (this.total - this.nTop - this._layN >= this._layNeed) this._layer();
    var W = this.W, cell = this.cell, seed = this.seed, lb = this._lb, x1 = this._bx1;
    var s = this._lrng, up = this._layUp, pSift = LAY.pSift, pSide = LAY.pSide, reach = LAY.reach;
    var i, j, n, t, u, v, y, d;
    for (var x = this._bx0 + (this.steps & 7); x <= x1; x += 8) {
      y = lb[x] - 1;
      i = y * W + x;
      if (cell[i] < REST) continue;
      t = seed[i];
      for (n = 0; n < reach; n++, y--) {
        j = i - W;
        if (cell[j] < REST) break;
        u = seed[j];
        if ((t >> 7) === up) {                         // the grain below stays up: what is on it may sink
          s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
          if ((u >> 7) !== up) {
            if ((s & 255) < pSift) { seed[i] = u; seed[j] = t; u = t; }
          } else if ((s & 255) < pSide) {
            d = (s & 512) ? 1 : -1;
            if (y - 1 < lb[x + d] && cell[j + d] >= REST) {
              v = seed[j + d];
              if ((v >> 7) !== up) { seed[i] = v; seed[j + d] = t; }
            }
          }
        }
        i = j; t = u;
      }
    }
    this._lrng = s;
  };

  /**
   * Sift all the sand above the noted surface at once, into as many layers
   * as a run would have laid there (after a fast-forward; when layers are
   * turned on): within each layer of each column, one tone goes under the
   * other, turn and turn about. Then the next layer begins.
   */
  Sim.prototype._siftAll = function () {
    var W = this.W, cell = this.cell, seed = this.seed, lb = this._lb, x0 = this._bx0, x1 = this._bx1;
    var cut = [], tmp = [], x, y, k, n, q, sum = 0, cols = 0;
    for (x = x0; x <= x1; x++) {
      for (y = lb[x] - 1, n = 0; cell[y * W + x] >= REST; y--) n++;
      if (n) { sum += n; cols++; }
    }
    var K = cols ? Math.max(1, Math.round(sum / cols / (this._layMin + this._laySpan / (1 + this._layPow)))) : 0, at = 0;
    for (k = 0, sum = 0; k < K; k++) { cut[k] = 0.55 + this._lrand(); sum += cut[k]; }
    for (k = 0; k < K; k++) { at += cut[k] / sum; cut[k] = at; }
    for (x = x0; x <= x1 && K; x++) {
      for (y = lb[x] - 1, n = 0; cell[y * W + x] >= REST; y--) n++;
      var yb = lb[x] - 1;                              // each layer runs from yb up to ya
      for (k = 0; k < K && n; k++) {
        var ya = k === K - 1 ? lb[x] - n : lb[x] - Math.round(n * cut[k]), dn = (k + this._layUp) & 1;
        for (y = yb, q = 0; y >= ya; y--) if ((seed[y * W + x] >> 7) === dn) tmp[q++] = seed[y * W + x];
        for (y = yb; y >= ya; y--) if ((seed[y * W + x] >> 7) !== dn) tmp[q++] = seed[y * W + x];
        for (y = yb, q = 0; y >= ya; y--) seed[y * W + x] = tmp[q++];
        yb = ya - 1;
      }
    }
    this._layer();
  };

  /**
   * The tone (as bit 7) of the next `n` grains poured in. Sand is poured in
   * layers of 420 to 840 grains (a held Sand button lays one in about a
   * second, a few taps make one between them), each in the other tone from
   * the layer under it: the one just poured, or whatever lies on top of the
   * pile under the pour.
   */
  Sim.prototype._pourLayer = function (n) {
    if (this._pourLeft <= 0) {
      var t = this._pourTone;
      if (this.steps - this._pourAt > 120) {            // the last pour has landed: look at the pile
        var x = this.geo.cx | 0, W = this.W;
        for (var y = this.topY; y < this.gateY; y++) {
          if (this.cell[y * W + x] >= REST) { t = this.seed[y * W + x] >> 7; break; }
        }
      }
      this._pourTone = t ^ 1;
      this._pourLeft = LAY.pour + ((this._lrand() * LAY.pour) | 0);
    }
    this._pourLeft -= n;
    this._pourAt = this.steps;
    return this._pourTone << 7;
  };

  /** Grains of each tone, in the lattice and in the air: [tone 0, tone 1]. */
  Sim.prototype.tones = function () {
    var cell = this.cell, seed = this.seed, n = [0, 0], i, N = cell.length;
    for (i = 0; i < N; i++) if (cell[i] >= REST) n[seed[i] >> 7]++;
    for (i = 0; i < this.np; i++) n[this.pseed[i] >> 7]++;
    return n;
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
      // the companion tone of layered sand: a deeper sienna
      sand2: {
        h: 21, s: 0.56, l: 0.42, dh: 6, dl: 0.07,
        dark: { p: 0.05, h: 16, s: 0.50, l: 0.27 },
        alt: { p: 0.11, h: 26, s: 0.62, l: 0.48 },
        mica: { p: 0.04, h: 40, s: 0.45, l: 0.80 }
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
      // layered: pumice, a warm ash grey
      sand2: {
        h: 28, s: 0.13, l: 0.44, dh: 10, dl: 0.06,
        dark: { p: 0.08, h: 22, s: 0.11, l: 0.30 },
        alt: { p: 0.12, h: 34, s: 0.20, l: 0.51 },
        mica: { p: 0.05, h: 44, s: 0.70, l: 0.64 }
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
      // layered: the stone's blue shadow
      sand2: {
        h: 216, s: 0.22, l: 0.60, dh: 10, dl: 0.06,
        dark: { p: 0.06, h: 224, s: 0.20, l: 0.45 },
        alt: { p: 0.12, h: 204, s: 0.30, l: 0.68 },
        mica: { p: 0.06, h: 200, s: 0.24, l: 0.95 }
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
    },
    lapis: {
      id: 'lapis',
      name: 'Lapis Lazuli & Gold',
      short: 'Lapis Lazuli',
      sand: {
        h: 224, s: 0.62, l: 0.36, dh: 8, dl: 0.07,
        dark: { p: 0.10, h: 230, s: 0.58, l: 0.24 },    // deep ultramarine
        alt: { p: 0.10, h: 214, s: 0.22, l: 0.66 },      // pale calcite veins
        mica: { p: 0.07, h: 45, s: 0.85, l: 0.62 }       // pyrite: flecks of gold
      },
      // layered: seams of old gold
      sand2: {
        h: 38, s: 0.42, l: 0.40, dh: 6, dl: 0.06,
        dark: { p: 0.07, h: 30, s: 0.40, l: 0.28 },
        alt: { p: 0.10, h: 44, s: 0.50, l: 0.48 },
        mica: { p: 0.06, h: 50, s: 0.85, l: 0.72 }
      },
      glint: [255, 226, 150],
      // a dark sand, lit like the volcanic one so it reads against the night
      light: {
        rim: [8, 4], aoMax: 6, gloss: 0.20, glossBoost: 10, hl: 1.1, tint: [236, 240, 255],
        bloom: 0.75, bloomColor: [170, 190, 255],
        emit: { mica: 0.30, gloss: 0.04, rim: 0.14, haze: 0.009 }, backlight: 0.08
      },
      glass: { tint: [222, 230, 255], smoke: 0.16 },
      cap: { kind: 'gold', hi: [236, 204, 128], mid: [178, 140, 60], lo: [84, 60, 20] },
      glow: [104, 136, 230]
    },
    rosequartz: {
      id: 'rosequartz',
      name: 'Rose Quartz & Copper',
      short: 'Rose Quartz',
      sand: {
        h: 352, s: 0.42, l: 0.80, dh: 8, dl: 0.07,
        dark: { p: 0.05, h: 345, s: 0.32, l: 0.60 },
        alt: { p: 0.12, h: 12, s: 0.48, l: 0.83 },       // peach
        mica: { p: 0.05, h: 0, s: 0.10, l: 0.97 }
      },
      // layered: a deeper, dustier rose
      sand2: {
        h: 344, s: 0.30, l: 0.61, dh: 8, dl: 0.06,
        dark: { p: 0.05, h: 338, s: 0.26, l: 0.46 },
        alt: { p: 0.12, h: 356, s: 0.36, l: 0.66 },
        mica: { p: 0.05, h: 0, s: 0.12, l: 0.94 }
      },
      glint: [255, 244, 244],
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.14, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [255, 214, 222],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.045
      },
      glass: { tint: [255, 232, 236], smoke: 0.08 },
      cap: { kind: 'copper', hi: [228, 164, 132], mid: [170, 98, 66], lo: [76, 38, 22] },
      glow: [236, 168, 178]
    },
    seaglass: {
      id: 'seaglass',
      name: 'Sea Glass & Driftwood',
      short: 'Sea Glass',
      sand: {
        h: 166, s: 0.30, l: 0.72, dh: 10, dl: 0.07,
        dark: { p: 0.05, h: 188, s: 0.30, l: 0.50 },     // deeper teal
        alt: { p: 0.12, h: 140, s: 0.28, l: 0.78 },      // pale green
        mica: { p: 0.05, h: 180, s: 0.14, l: 0.96 }
      },
      // layered: deep-water teal
      sand2: {
        h: 188, s: 0.32, l: 0.49, dh: 10, dl: 0.06,
        dark: { p: 0.05, h: 196, s: 0.32, l: 0.35 },
        alt: { p: 0.12, h: 178, s: 0.30, l: 0.56 },
        mica: { p: 0.05, h: 180, s: 0.16, l: 0.94 }
      },
      glint: [236, 255, 250],
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.14, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [200, 245, 232],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.045
      },
      glass: { tint: [222, 246, 240], smoke: 0.08 },
      cap: { kind: 'wood', hi: [178, 168, 150], mid: [128, 118, 102], lo: [66, 59, 50] },   // bleached driftwood
      glow: [150, 212, 198]
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
    this.layers = false;  // layered sand: two tones (setLayers)
    this.glass = null;    // [far wall, near wall] WebGL layers, or null → drawn glass
    this.glassRot = 0;
    this._initGlass();
    this.frameNo = 0;
    this.sweep = 0;       // one glass of sand giving way to the next: 1 the old goes, 2 the new comes (setSweep)
    this.sweepP = 0;
    this._swNew = false; this._swSrc = null; this._swFar = 0; this._sw = null;
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

  /**
   * Per-grain colour table: 256 persistent seeds × 48 light levels. With
   * layered sand, bit 7 of a seed is the grain's tone (the theme's sand, or
   * its companion sand2) and the other seven spread over that tone's kinds
   * of grain.
   */
  Renderer.prototype._buildLUT = function () {
    var th = this.theme, sd = th.sand, lut = this.lut, li = th.light;
    var tint = li.tint, em = li.emit, lay = this.layers && th.sand2;
    for (var s = 0; s < 256; s++) {
      var c = s;
      if (lay) { sd = s < 128 ? th.sand : th.sand2; c = (s & 127) << 1; }
      var darkN = Math.round(sd.dark.p * 256);
      var micaN = Math.round(sd.mica.p * 256);
      var altN = Math.round(sd.alt.p * 256);
      var u1 = hash01(s * 7 + 1), u2 = hash01(s * 13 + 5), u3 = hash01(s * 29 + 11);
      var base, mica = 0;
      if (c < darkN) {
        base = hsl(sd.dark.h + (u1 - 0.5) * 10, sd.dark.s, sd.dark.l + (u2 - 0.5) * 0.08);
      } else if (c >= 256 - micaN) {
        base = hsl(sd.mica.h + (u1 - 0.5) * 14, sd.mica.s, sd.mica.l - u2 * 0.08);
        mica = 1;
      } else if (c >= 256 - micaN - altN) {
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

  /** Layered sand: draw the two tones (Sim.setLayers lays them). */
  Renderer.prototype.setLayers = function (on) {
    this.layers = !!on;
    this._buildLUT();
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

    if (this.sweep === 1) this._sweepOut(); else if (this.sweep === 2) this._sweepIn();
    this.sctx.putImageData(this.img, 0, 0);
    if (glow) this._bloomOut();
  };

  /* ---------------------------------------------------------------- *
   *  The sweep: one glass of sand gives way to the next (Reset, another
   *  duration). Only the picture changes; the sand itself is not touched.
   *
   *  1, the old sand goes into the neck, as an incompressible sheet flows
   *  into a point sink: for every grain the square of its distance from
   *  the neck falls by the same amount. So the nearest sand is swallowed
   *  first, a funnel sinks into the upper bed, the heap below is eaten
   *  from its apex, and no grain changes size on its way.
   *
   *  2, the new sand is poured: the bed the reset has laid is shown up to
   *  a surface that rises as a steady pour would raise it, grain for grain
   *  (fast in the narrow of the funnel, slower above), heaped under the
   *  thread that falls from the top of the bulb, and level at the end.
   *
   *  p runs from 0 to 1 in each; 0 for the kind ends it.
   * ---------------------------------------------------------------- */
  Renderer.prototype.setSweep = function (kind, p) {
    if (!kind) { this.sweep = 0; this._sw = null; return; }
    if (kind !== this.sweep) { this.sweep = kind; this._swNew = true; }
    this.sweepP = p > 0 ? (p < 1 ? p : 1) : 0;
  };

  Renderer.prototype._sweepOut = function () {
    var sim = this.sim, W = sim.W, BW = this.BW, BH = this.BH, buf = this.buf, edge = this.edgeMask;
    var nx = sim.geo.cx * SUB, ny = (sim.gateY + 0.5) * SUB;       // the neck, in the picture's own pixels
    var src = this._swSrc || (this._swSrc = new Uint32Array(BW * BH));
    var x, y, dx, dy, r2, k, sx, sy, v, row;
    if (this._swNew) {
      // how far from the neck the farthest sand lies
      this._swNew = false;
      var far = 0;
      for (y = 0; y < BH; y++) {
        dy = y + 0.5 - ny; row = y * BW;
        for (x = 0; x < BW; x++) {
          if (buf[row + x] === 0) continue;
          dx = x + 0.5 - nx; r2 = dx * dx + dy * dy;
          if (r2 > far) far = r2;
        }
      }
      this._swFar = far + 4;
    }
    var S = this._swFar * Math.pow(this.sweepP, 1.5), lim = this._swFar - S;   // what is left lies within √lim of the neck
    src.set(buf);
    buf.fill(0);
    if (lim <= 0) return;
    var R = Math.sqrt(lim);
    var x0 = Math.max(0, Math.floor(nx - R)), x1 = Math.min(BW - 1, Math.ceil(nx + R));
    var y0 = Math.max(0, Math.floor(ny - R)), y1 = Math.min(BH - 1, Math.ceil(ny + R));
    for (y = y0; y <= y1; y++) {
      dy = y + 0.5 - ny; row = y * BW;
      for (x = x0; x <= x1; x++) {
        dx = x + 0.5 - nx;
        r2 = dx * dx + dy * dy;
        if (r2 > lim || r2 < 0.2) continue;
        k = Math.sqrt((r2 + S) / r2);                              // where this grain was: farther out along its ray
        sx = (nx + dx * k) | 0; sy = (ny + dy * k) | 0;
        if (sx < 0 || sy < 0 || sx >= BW || sy >= BH) continue;
        v = src[sy * BW + sx];
        if (v === 0) continue;
        // inside the glass only (a ray from the neck can graze the wall beside it)
        if (!((edge[(y >> 1) * W + (x >> 1)] >> (((y & 1) << 1) | (x & 1))) & 1)) continue;
        buf[row + x] = v;
      }
    }
  };

  Renderer.prototype._sweepIn = function () {
    var sim = this.sim, W = sim.W, BW = this.BW, buf = this.buf, cell = sim.cell, seed = sim.seed, edge = this.edgeMask;
    var rowMin = sim.rowMin, rowMax = sim.rowMax, gate = sim.gateY, cx = sim.geo.cx, cxI = cx | 0;
    var lut = this.lut, base = this.baseLevel, ao = this.aoTab, hiOff = this.hiOff, loOff = this.loOff, hiBoost = this.hiBoost;
    var st = this._sw, x, y, i, bi, k, a, b, c, hw, h, s, d, lv, hl, em;
    if (this._swNew || !st) {
      // the bed as the reset laid it: its rows of sand from the neck up, the top of the bulb on its axis,
      // and a handful of its grains' colours for the thread
      this._swNew = false;
      st = this._sw = { lo: new Int32Array(gate), hi: new Int32Array(gate), cnt: new Int32Array(gate), n: 0, top: gate, cap: 1, pal: new Uint8Array(32) };
      for (y = gate - 1; y >= 1; y--) {
        a = -1; b = -2; c = 0;
        for (x = rowMin[y]; x <= rowMax[y]; x++) if (cell[y * W + x] >= REST) { if (a < 0) a = x; b = x; c++; }
        st.lo[y] = a; st.hi[y] = b; st.cnt[y] = c; st.n += c;
        if (c > 0) st.top = y;
      }
      for (y = 1; y < gate; y++) if (rowMin[y] <= cxI && cxI <= rowMax[y]) { st.cap = y; break; }
      for (k = 0; k < 32; k++) {
        y = st.top + (((gate - st.top) * (k + 0.5) / 32) | 0);
        st.pal[k] = st.cnt[y] > 0 ? seed[y * W + st.lo[y] + ((Math.imul(k, 0x9E3779B1) >>> 8) % st.cnt[y])] : 0;
      }
    }
    if (st.n === 0 || sim.gy <= 0) return;
    var p = this.sweepP, fr = this.frameNo;
    var v = (p - 0.08) / 0.78; v = v < 0 ? 0 : (v > 1 ? 1 : v);     // the share of the sand that has come
    var want = v * st.n, slope = 0.62 * Math.sqrt(1 - v);           // heaped under the thread (32°), level at the end
    // the apex row of the heap that holds `want` grains (bisection: a few dozen rows a time)
    var up = st.top - 2 - slope * W, dn = gate, yb = gate, it;
    for (it = 0; it < 14; it++) {
      yb = (up + dn) / 2; c = 0;
      for (y = Math.max(st.top, Math.ceil(yb - 0.5)); y < gate; y++) {
        if (st.cnt[y] === 0) continue;
        hw = slope > 1e-3 ? (y + 0.5 - yb) / slope : 1e9;
        a = Math.max(st.lo[y], Math.ceil(cx - hw - 0.5)); b = Math.min(st.hi[y], Math.floor(cx + hw - 0.5));
        if (b >= a) c += b - a + 1;
      }
      if (c > want) up = yb; else dn = yb;
    }
    if (v >= 1) yb = up;
    // hide what has not come yet, and light the surface of what has
    var deep = 2; while (deep < 40 && ao[deep] !== ao[255]) deep++;
    for (y = st.top; y < gate; y++) {
      if (st.cnt[y] === 0) continue;
      hw = slope > 1e-3 ? (y + 0.5 - yb) / slope : 1e9;
      for (x = st.lo[y]; x <= st.hi[y]; x++) {
        i = y * W + x;
        if (cell[i] < REST) continue;
        d = cx - (x + 0.5); if (d < 0) d = -d;
        bi = (y * SUB) * BW + x * SUB;
        if (hw < d) { buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = 0; continue; }
        // how deep under the heap's surface this grain lies for the moment (in its own column)
        d = ((y + 0.5 - yb - slope * d) | 0) + 1;
        if (d >= deep) continue;                                   // as deep as it will ever look
        s = seed[i];
        lv = base[i] - ao[d] + AO_BIAS;
        hl = lv + hiBoost[s]; if (hl > 47) hl = 47;
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = lut[(lv << 8) | s];
        buf[bi + hiOff[s]] = lut[(hl << 8) | s];
        buf[bi + loOff[s]] = lut[((lv - 3) << 8) | s];
        em = edge[i];
        if (em !== 15) {
          if (!(em & 1)) buf[bi] = 0;
          if (!(em & 2)) buf[bi + 1] = 0;
          if (!(em & 4)) buf[bi + BW] = 0;
          if (!(em & 8)) buf[bi + BW + 1] = 0;
        }
      }
    }
    // the thread: its first grains fall, it pours, its last grains fall
    var head = st.cap + (gate - st.cap) * Math.min(1, p / 0.09), tail = st.cap + (gate - st.cap) * Math.max(0, (p - 0.85) / 0.11);
    var end = Math.min(head, yb - 0.5), thick = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.2);
    for (y = Math.ceil(tail); y < end; y++) {
      for (k = -2; k <= 2; k++) {                                  // (a pour, not the glass's own thread: a few grains abreast)
        h = Math.imul((y * 5 + k + 2) ^ Math.imul(fr, 0x85EBCA6B), 0x9E3779B1) >>> 0;
        if ((h & 255) >= (k === 0 ? 225 : (k === 1 || k === -1 ? 150 : 50)) * thick) continue;
        x = cxI + k;
        if (x < rowMin[y] || x > rowMax[y]) continue;
        bi = (y * SUB + ((h >>> 9) & 1)) * BW + x * SUB + ((h >>> 8) & 1);
        c = lut[((22 + ((h >>> 28) & 3)) << 8) | st.pal[(h >>> 16) & 31]];
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = c;
      }
    }
    // … and a little spray where it lands
    if (head >= yb - 0.5 && tail < yb - 0.5) {
      for (k = 0; k < 14; k++) {
        h = Math.imul((k + 1) ^ Math.imul(fr, 0xC2B2AE35), 0x9E3779B1) >>> 0;
        if ((h & 255) > 140 * thick) continue;
        x = cxI + ((h >>> 8) % 15) - 7;
        d = cx - (x + 0.5); if (d < 0) d = -d;
        y = (yb + slope * d - 1 - ((h >>> 12) % 6)) | 0;
        if (y <= st.cap || y >= gate || x < rowMin[y] || x > rowMax[y]) continue;
        bi = (y * SUB) * BW + x * SUB;
        if (buf[bi] !== 0) continue;
        c = lut[((24 + ((h >>> 28) & 3)) << 8) | st.pal[(h >>> 20) & 31]];
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = c;
      }
    }
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
    this._drawCracks(ctx);                             // cracks lie on the glass, under the caps

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
   *  Cracks on the glass
   *
   *  A crack is drawn into c-front, after the drawn glass and before the
   *  caps, so the caps cover its ends under the collars, it turns with the
   *  glass, and it survives theme changes, Frame on/off and relayout, all
   *  of which redraw c-front. There is no crack canvas of its own: a full-
   *  size layer would cost megabytes and more compositing while the glass
   *  turns.
   *
   *  A crack grows over the front face of the glass in surface coordinates,
   *  u along the axis (0 at the neck, 1 at the far end) and φ round it (0
   *  facing the viewer, ±π/2 at the silhouette), and is projected as
   *  x = r(u)·sin φ, y = u·HB. A crack running round the shoulder therefore
   *  reads as a curved arc, and one across the dome bends with it. Paths are
   *  grown for the lower bulb's right side and mirrored into place. The
   *  vessel is point-symmetric, so after a flip the same mirror, taken from
   *  the crack's new bulb and side, puts it back on exactly the same glass.
   * ==================================================================== */
  var CRACK_SEGS = 170;             // segments per crack; a glass holds three at most (≤ 512)
  var CRACK_MAIN = 128;             // ... of which its main arms take this many at most
  var CRACK_STEP = 1.1;             // cells of arc length per segment
  var CRACK_WANDER = 9 * Math.PI / 180;    // how far the heading wanders per step (σ)
  var CRACK_ST = 7;                 // canonical floats per segment: x0, y0, x1, y1, t0, t1, branch
  var CRACK_LV = 32;                // hairline brightness levels: one stroke per level in use
  var CRACK_REDRAW = 33;            // ms: c-front is redrawn at most 30 times a second
  var CRACK_FLASH = 600;            // ms: a new crack flashes bright for this long
  var MARK_FROM = 0.2;              // damage from which a stretch of glass shows its stress mark
  var HALF_PI = Math.PI / 2;
  var CRACK_SHADOW = 'rgba(0,0,0,0.30)', CHIP_DARK = 'rgba(0,0,0,0.55)';
  var GOLD = 'rgba(214,170,92,0.95)', GOLD_CORE = 'rgba(255,232,180,0.9)';
  var GOLD_GLOW = 'rgba(255,190,90,0.5)', NO_SHADOW = 'rgba(0,0,0,0)';
  // Every colour a redraw needs is made once, here, by brightness level.
  var HAIR = [], RIM = [], GLINT = [];
  for (var lvI = 0; lvI <= CRACK_LV; lvI++) {
    HAIR.push('rgba(255,250,240,' + (lvI / CRACK_LV).toFixed(3) + ')');
    RIM.push('rgba(255,248,235,' + (lvI / CRACK_LV).toFixed(3) + ')');
    GLINT.push('rgba(255,255,255,' + (lvI / CRACK_LV).toFixed(3) + ')');
  }

  // Each arm of a crack draws from its own random stream, so a crack that
  // grows only ever extends: the steps already drawn stay exactly where they
  // were. The generator is mulberry32; its state lives here, one stream at a
  // time, because paths are built in one go and never interleave.
  var crackRng = new Int32Array(1);
  var crackBr = new Float64Array(6 * 6);   // side branches waiting for their walk
  var crackArm = new Float64Array(2 * 6);  // the main arms' headings and lengths
  function crackStream(seed, arm, branch) {
    var h = (seed ^ Math.imul(arm + 1, 0x9E3779B1) ^ Math.imul(branch + 1, 0x85EBCA77)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D);
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B);
    crackRng[0] = h ^ (h >>> 16);
  }
  function crackRand() {
    var t = crackRng[0] = (crackRng[0] + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** About N(0, 1): three uniforms, so a heading never jumps wildly. */
  function crackGauss() {
    return (crackRand() + crackRand() + crackRand() - 1.5) * 2;
  }

  /**
   * Walk one arm across the glass from (u, φ) with heading th (0 toward the
   * far end, −π/2 round toward the viewer), for `len` cells or `cap` steps,
   * whichever ends first, and append its segments to e in the canonical
   * frame, with how far along the crack each one starts and ends (d0 is
   * where this arm starts). Up to `spawn` side branches are noted on the
   * way; they are walked afterwards, each from its own stream. Returns the
   * distance to the arm's tip.
   */
  function crackWalk(e, g, u, phi, th, len, cap, d0, uLo, spawn, arm, branch) {
    var can = e.can, d = d0, steps = Math.floor(len / CRACK_STEP + 1e-6), k, o;
    if (steps > cap) steps = cap;
    var x0 = profile(u, g) * Math.sin(phi), y0 = u * g.HB;
    for (k = 0; k < steps; k++) {
      th += crackGauss() * CRACK_WANDER;
      var r = profile(u, g);
      if (r < 1.5) r = 1.5;
      var u1 = u + CRACK_STEP * Math.cos(th) / g.HB, p1 = phi + CRACK_STEP * Math.sin(th) / r;
      // it runs out of sight round the back, under the far cap, or toward the waist
      if (u1 < uLo || u1 > 0.995 || p1 <= -HALF_PI || p1 >= HALF_PI) break;
      if (spawn > 0 && crackRand() < 0.04) {
        // a branch splits off here, at 25° to 50° either side
        var b = 6 * e.nb++, sg = crackRand() < 0.5 ? -1 : 1;
        crackBr[b] = u; crackBr[b + 1] = phi;
        crackBr[b + 2] = th + sg * (25 + 25 * crackRand()) * Math.PI / 180;
        crackBr[b + 3] = (0.3 + 0.3 * crackRand()) * (len - (d - d0));
        crackBr[b + 4] = d; crackBr[b + 5] = arm;
        spawn--;
      }
      var x1 = profile(u1, g) * Math.sin(p1), y1 = u1 * g.HB;
      o = CRACK_ST * e.n++;
      can[o] = x0; can[o + 1] = y0; can[o + 2] = x1; can[o + 3] = y1;
      can[o + 4] = d; can[o + 5] = d + CRACK_STEP; can[o + 6] = branch ? 1 : 0;
      d += CRACK_STEP; u = u1; phi = p1; x0 = x1; y0 = y1;
    }
    return d;
  }

  /**
   * How far round the glass, from the middle of its face toward the side
   * its wall segment is on, a crack in segment `seg` starts (and its stress
   * mark shows): 0.55 to 0.9 rad, always the same for the same band of glass.
   */
  var FACE_U = 0.95;                // ... and no nearer the far end than this (the collar hides the rest)
  function facePhi(seg) {
    return 0.55 + 0.35 * hash01(11 + 7 * (seg % WALL_BINS));
  }

  /**
   * Grow crack cr's path at length 2·lk cells. Its kind follows where it
   * starts: by the waist a hoop runs round the shoulder (bending pulls along
   * the axis), on the dome a star of 3 to 5 arms spreads from the impact,
   * and in between it runs along the glass toward the equator and wanders.
   * Every length is a fixed share of L, capped so the crack never passes
   * its budget, which keeps the growth smooth right up to the cap.
   */
  function crackBuild(e, cr, g, lk) {
    var L = Math.max(2, 2 * lk), u0 = cr.u > 0.995 ? 0.995 : cr.u, seed = cr.seed | 0, j, k;
    var uLo = Math.max(0.03, 4.5 / g.HB);       // never within four rows of the waist
    if (uLo > u0) uLo = u0;                      // a crack right by it never comes nearer
    var phi0 = HALF_PI - 0.06;                   // just inside the silhouette, where the hole is
    var star = u0 > 0.75, hoop = u0 < 0.3;
    crackStream(seed, -1, -1);
    var nArms = star ? 3 + Math.floor(crackRand() * 3) : 1;
    if (!hoop) {
      // Seen edge-on at the silhouette, the first 20 or 30 cells of a crack
      // hide in the glass's bright rim, so a new crack could not be seen at
      // all. Away from the waist it therefore starts on the face of the
      // glass (facePhi), clear of the collar that seats the dome: just
      // where the stress mark showed before it.
      phi0 = facePhi(cr.seg);
      if (u0 > FACE_U) u0 = FACE_U;
    }
    for (j = 0; j < nArms; j++) {
      if (star) {
        // all round, a little uneven: the star of a blow
        var sp = 360 * (j + 0.5) / nArms + (crackRand() - 0.5) * 180 / nArms;
        crackArm[2 * j] = -HALF_PI + sp * Math.PI / 180;
        crackArm[2 * j + 1] = 0.5 + 0.3 * crackRand();
      } else {
        // a hoop runs round toward the viewer; the rest runs along the glass
        // toward the equator, leaning 30° into the face (straight along it,
        // the crack would hide in the bright edge of the glass)
        crackArm[2 * j] = hoop ? -HALF_PI : (u0 < g.equator ? -0.52 : 0.52 - Math.PI);
        crackArm[2 * j + 1] = 1;
      }
    }
    var armCap = Math.floor(CRACK_MAIN / nArms), slots = nArms === 1 ? 3 : 1;
    var brCap = Math.floor((CRACK_SEGS - CRACK_MAIN) / (nArms * slots));
    var w, q, s, o, can = e.can;
    e.n = 0; e.nb = 0; e.nw = 0; e.arms = nArms;
    for (j = 0; j < nArms; j++) {
      crackStream(seed, j, -1);
      w = e.nw++;
      e.wArm[w] = j; e.wNth[w] = -1; e.ws[w] = e.n; e.wD0[w] = 0;
      e.wEnd[w] = crackWalk(e, g, u0, phi0, crackArm[2 * j],
                            Math.min(crackArm[2 * j + 1] * L, armCap * CRACK_STEP), armCap, 0, uLo, slots, j, false);
    }
    for (k = 0; k < e.nb; k++) {
      var b = 6 * k, arm = crackBr[b + 5], nth = 0;
      for (j = 0; j < k; j++) if (crackBr[6 * j + 5] === arm) nth++;
      crackStream(seed, arm, nth);
      w = e.nw++;
      e.wArm[w] = arm; e.wNth[w] = nth; e.ws[w] = e.n; e.wD0[w] = crackBr[b + 4];
      e.wEnd[w] = crackWalk(e, g, crackBr[b], crackBr[b + 1], crackBr[b + 2], crackBr[b + 3], brCap,
                            crackBr[b + 4], uLo, 0, arm, true);
    }
    e.ws[e.nw] = e.n;
    // A mend fills each segment as a share of the way to the farthest tip it
    // leads to. Every arm then fills in step, and the gold reaches a branch's
    // root before the branch itself begins to fill.
    for (w = 0; w < e.nw; w++) {
      for (s = e.ws[w]; s < e.ws[w + 1]; s++) {
        o = CRACK_ST * s;
        var norm = e.wEnd[w];
        if (e.wNth[w] < 0) {
          for (q = 0; q < e.nw; q++) {
            if (e.wNth[q] >= 0 && e.wArm[q] === e.wArm[w] && e.wEnd[q] > norm &&
                e.wD0[q] >= can[o + 5] - 1e-3) norm = e.wEnd[q];
          }
        }
        can[o + 4] /= norm; can[o + 5] /= norm;
      }
    }
  }

  /** Put crack cr's canonical path where it is on the glass now, with its chip. */
  function crackMirror(e, cr, g) {
    var sx = cr.side < 0 ? -1 : 1, sy = cr.bulb ? 1 : -1, can = e.can, seg = e.seg, k, o, q;
    for (k = 0; k < e.n; k++) {
      o = CRACK_ST * k; q = 4 * k;
      seg[q] = sx * can[o]; seg[q + 1] = sy * can[o + 1];
      seg[q + 2] = sx * can[o + 2]; seg[q + 3] = sy * can[o + 3];
    }
    var u0 = cr.u > 0.995 ? 0.995 : cr.u, ua = Math.max(0, u0 - 0.004), ub = Math.min(0.999, u0 + 0.004);
    var dr = (profile(ub, g) - profile(ua, g)) / (ub - ua);
    // the chip sits in the wall, where the lattice hole is; it lies along the glass
    e.chipX = sx * (profile(u0, g) + 0.3 * g.wall);
    e.chipY = sy * u0 * g.HB;
    e.chipN = Math.atan2(-sy * dr, sx * g.HB);    // the wall's outward normal there
    e.chipT = Math.atan2(sy * g.HB, sx * dr);     // and its run along the glass
    e.bulb = cr.bulb; e.side = cr.side;
  }

  /** The renderer's damage state, made the first time something needs it. */
  function crackState(r) {
    if (r._dmg) return r._dmg;
    r._dmg = {
      paths: [],                  // cached paths, one per crack on the glass
      cur: [],                    // ... and the ones in use in the drawing under way
      rev: -1,                    // sim.crackRev as last drawn
      rot: r.sim.angle + r.sim.tilt,   // the glass against the room, as last drawn
      lastT: -1e9, now: 0,        // when c-front was last redrawn, and the time it drew
      dirty: false,               // the mend has moved since
      mend: 0,                    // gold run along the open cracks, 0 … 1
      animEnd: 0,                 // when the last flash ends; 0 once its clean frame is drawn
      aRec: [null, null, null, null],     // flashes: the crack,
      aKind: new Uint8Array(4),           //   1 cracking, 2 breaking through,
      aT0: new Float64Array(4),           //   and when it began
      aN: 0,
      warnT0: 0, warnT1: 0,                       // a creak: the stress mark brightens for a moment
      markQ: 0,                                   // the stress mark as last drawn (0: none)
      info: { bulb: 0, side: 1, u: 0 },
      lev: new Uint8Array(4 * CRACK_SEGS),        // brightness level per hairline segment
      cnt: new Uint16Array(CRACK_LV + 1)
    };
    return r._dmg;
  }

  /** The cache slot for crack cr (a crack that is gone gives up its slot). */
  function crackEntry(st, cracks, cr) {
    var list = st.paths, k, e;
    for (k = 0; k < list.length; k++) if (list[k].rec === cr) return list[k];
    for (k = 0; k < list.length; k++) {
      e = list[k];
      if (cracks.indexOf(e.rec) < 0) { e.rec = cr; e.lk = -1; return e; }
    }
    e = {
      rec: cr, id: -1, seed: 0, lk: -1, w: -1, bulb: -1, side: 0,
      n: 0, nb: 0, arms: 0,
      // walkers (arms and branches): first segment, arm, branch (−1 main), start and tip distance
      nw: 0, ws: new Int16Array(16), wArm: new Int8Array(16), wNth: new Int8Array(16),
      wD0: new Float32Array(16), wEnd: new Float32Array(16),
      can: new Float32Array(CRACK_ST * CRACK_SEGS), seg: new Float32Array(4 * CRACK_SEGS),
      chipX: 0, chipY: 0, chipN: 0, chipT: 0
    };
    list.push(e);
    return e;
  }

  /** True when crack cr's drawing is out of date: new, longer, wider, or moved by a flip. */
  function crackStale(st, cr) {
    var list = st.paths;
    for (var k = 0; k < list.length; k++) {
      var e = list[k];
      if (e.rec !== cr) continue;
      return e.lk !== Math.floor(cr.L / 2) || e.w !== cr.w || e.bulb !== cr.bulb || e.side !== cr.side || e.seed !== cr.seed;
    }
    return true;
  }

  /**
   * The stress mark to draw, as a whole number that changes whenever the
   * picture of it should: 0 for none (no stretch of uncracked glass holds
   * MARK_FROM of damage), else its place and its strength in 24 steps.
   */
  function markLevel(sim) {
    var D = sim.dMax, s = sim.warnSeg;
    if (!(D >= MARK_FROM) || !(s >= 0)) return 0;
    if (D > 1) D = 1;
    return 1 + Math.floor((D - MARK_FROM) / (1 - MARK_FROM) * 24) + 32 * s;
  }

  /** How far through its flash of `kind` crack cr is: 1 at the start, 0 when done. */
  function crackFlash(st, cr, kind, now) {
    var f = 0;
    for (var a = 0; a < 4; a++) {
      if (st.aRec[a] !== cr || st.aKind[a] !== kind) continue;
      var x = (now - st.aT0[a]) / (kind === 1 ? CRACK_FLASH : 120);
      if (x >= 0 && x < 1) { x = kind === 1 ? (1 - x) * (1 - x) : 1 - x; if (x > f) f = x; }
    }
    return f;
  }

  Renderer.prototype.animating = false;   // a crack, a creak or a breach is flashing
  Renderer.prototype.reduced = false;     // Reduce Motion (set by the app): no flashes

  /**
   * The drawn path of crack record `cr`: {seg, n, chipX, chipY, chipN, chipT}.
   * seg holds the segments' endpoints (x0, y0, x1, y1, …) in vessel-centred
   * cells, which is c-front's _ctx() space, and n says how many there are.
   * It is a fixed function of the crack's seed and length, cached per crack
   * by (id, seed, ⌊L/2⌋, w), and only re-mirrored when a flip moves it.
   */
  Renderer.prototype._crackPath = function (cr) {
    var sim = this.sim, st = crackState(this), e = crackEntry(st, sim.cracks || [], cr);
    var lk = Math.floor(cr.L / 2);
    if (e.id !== cr.id || e.seed !== cr.seed || e.lk !== lk || e.w !== cr.w) {
      crackBuild(e, cr, sim.geo, lk);
      e.id = cr.id; e.seed = cr.seed; e.lk = lk; e.w = cr.w; e.bulb = -1;
    }
    if (e.bulb !== cr.bulb || e.side !== cr.side) crackMirror(e, cr, sim.geo);
    return e;
  };

  /**
   * Draw the glass's cracks in cells (c-front's frame), before the caps.
   * A whole glass draws nothing and leaves the layer exactly as it was.
   * Open cracks are a fine silver hairline over a soft shadow, each segment
   * as bright as it faces the key light: the room stays put while the glass
   * turns, so the crack sparkles as it moves. A breach is a dark chip where
   * the glass's bright edge is broken, with a bright conchoidal rim. Mended
   * cracks are gold, and so is the run of a mend in progress.
   */
  Renderer.prototype._drawCracks = function (ctx) {
    var sim = this.sim, cracks = sim.cracks, n = cracks ? cracks.length : 0, st = this._dmg;
    var mark = markLevel(sim);
    if (!st && !n && !mark) return;
    st = crackState(this);
    st.rev = sim.crackRev;
    st.markQ = mark;
    var now = st.now, warn = st.warnT1 > now;
    if (!n && !mark) return;
    var rot = st.rot, lev = st.lev, cnt = st.cnt, cur = st.cur, k, s, o, e, cr, any, base, lv, sn, f;
    var total = 0;
    for (k = 0; k < n; k++) { cur[k] = this._crackPath(cracks[k]); total += cur[k].n; }
    if (lev.length < total) lev = st.lev = new Uint8Array(total);
    ctx.save();

    // a soft shadow under every open crack (one stroke, so crossings never darken twice)
    ctx.beginPath();
    any = false;
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (cr.sealed) continue;
      for (s = 0; s < e.n; s++) {
        o = 4 * s;
        ctx.moveTo(e.seg[o], e.seg[o + 1]); ctx.lineTo(e.seg[o + 2], e.seg[o + 3]);
        any = true;
      }
    }
    if (any) { ctx.strokeStyle = CRACK_SHADOW; ctx.lineWidth = 1.6; ctx.stroke(); }

    // the hairline: each segment glints as it faces the key light, |sin(a + rot − 0.9)|^6
    cnt.fill(0);
    base = 0;
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (cr.sealed) continue;
      var flash = crackFlash(st, cr, 1, now);   // the moment it cracks it flashes bright
      for (s = 0; s < e.n; s++) {
        o = 4 * s;
        sn = Math.sin(Math.atan2(e.seg[o + 3] - e.seg[o + 1], e.seg[o + 2] - e.seg[o]) + rot - 0.9);
        sn *= sn;
        var al = 0.40 + 0.55 * sn * sn * sn;
        if (e.can[CRACK_ST * s + 6]) al *= 0.8;   // side branches are finer
        if (flash > 0) al += (1 - al) * flash;
        lv = (al * CRACK_LV + 0.5) | 0;
        lev[base + s] = lv; cnt[lv]++;
      }
      base += e.n;
    }
    ctx.lineWidth = 0.7;
    for (lv = 0; lv <= CRACK_LV; lv++) {
      if (!cnt[lv]) continue;
      ctx.beginPath();
      base = 0;
      for (k = 0; k < n; k++) {
        cr = cracks[k]; e = cur[k];
        if (cr.sealed) continue;
        for (s = 0; s < e.n; s++) {
          if (lev[base + s] !== lv) continue;
          o = 4 * s;
          ctx.moveTo(e.seg[o], e.seg[o + 1]); ctx.lineTo(e.seg[o + 2], e.seg[o + 3]);
        }
        base += e.n;
      }
      ctx.strokeStyle = HAIR[lv];
      ctx.stroke();
    }

    // the chip of a breach: dark where the sand gets out, its inner edge bright
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (cr.sealed || !(cr.w > 0)) continue;
      var w = cr.w > 3 ? 3 : cr.w, ra = 0.6 + 0.4 * w, rb = 1.0 + 0.5 * w;
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ra, rb, e.chipN, 0, 2 * Math.PI);
      ctx.fillStyle = CHIP_DARK;
      ctx.fill();
      sn = Math.sin(e.chipT + rot - 0.9);
      sn *= sn;
      var rim = 0.5 + 0.3 * sn * sn * sn;
      f = crackFlash(st, cr, 2, now);          // just broken through: the rim flares
      if (f > 0) rim += (1 - rim) * f;
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ra, rb, e.chipN, HALF_PI, 3 * HALF_PI);
      ctx.strokeStyle = RIM[(rim * CRACK_LV + 0.5) | 0];
      ctx.lineWidth = 0.25;
      ctx.stroke();
    }

    // gold: mended cracks whole, and a mend in progress from the origin out
    // along every arm (the same share of the way to each tip)
    var p = st.mend;
    ctx.beginPath();
    any = false;
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      var lim = cr.sealed ? 2 : p;
      if (!(lim > 0)) continue;
      for (s = 0; s < e.n; s++) {
        var c = CRACK_ST * s, t0 = e.can[c + 4], t1 = e.can[c + 5];
        if (t0 >= lim) continue;
        o = 4 * s;
        var x0 = e.seg[o], y0 = e.seg[o + 1], x1 = e.seg[o + 2], y1 = e.seg[o + 3];
        if (t1 > lim) { f = (lim - t0) / (t1 - t0); x1 = x0 + (x1 - x0) * f; y1 = y0 + (y1 - y0) * f; }
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        any = true;
      }
    }
    if (any) {
      ctx.shadowColor = GOLD_GLOW; ctx.shadowBlur = 4 * this.dpr;    // blur is in canvas px
      ctx.strokeStyle = GOLD; ctx.lineWidth = 0.75; ctx.stroke();
      ctx.shadowBlur = 0; ctx.shadowColor = NO_SHADOW;
      ctx.strokeStyle = GOLD_CORE; ctx.lineWidth = 0.3; ctx.stroke();
    }
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (!(cr.w > 0)) continue;
      f = cr.sealed ? 1 : Math.min(1, p * 8);     // the gold reaches the chip first
      if (!(f > 0)) continue;
      var wg = cr.w > 3 ? 3 : cr.w, ga = 0.6 + 0.4 * wg, gb = 1.0 + 0.5 * wg;
      ctx.globalAlpha = f;
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ga, gb, e.chipN, 0, 2 * Math.PI);
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ga, gb, e.chipN, HALF_PI, 3 * HALF_PI);
      ctx.strokeStyle = GOLD_CORE; ctx.lineWidth = 0.25;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The stress mark: where the glass is most loaded and has not cracked, a
    // pale bloom on the glass with three craze lines, growing with the damage
    // (about 5 to 20 px across) and fading as it heals. A creak brightens it
    // for a moment.
    if (mark) {
      var info = sim.segInfo(sim.warnSeg, st.info), D = sim.dMax > 1 ? 1 : sim.dMax;
      var mt = (D - MARK_FROM) / (1 - MARK_FROM), g = sim.geo;
      // it shows where a crack would start: on the face of the glass, or (by the waist) at its edge
      var mu = info.u, mphi = HALF_PI - 0.06;
      if (mu >= 0.3) { mphi = facePhi(sim.warnSeg); if (mu > FACE_U) mu = FACE_U; }
      var mx = info.side * profile(mu, g) * Math.sin(mphi), my = (info.bulb ? 1 : -1) * mu * g.HB;
      var mr = 3 + 6.2 * mt;                                 // cells: its radius
      var ma = (0.55 + 0.40 * mt) * (mt < 0.06 ? mt / 0.06 : 1);
      if (warn) ma += (1 - ma) * 0.7 * (1 - (now - st.warnT0) / 300);
      ctx.save();
      tracePath(ctx, g, g.wall);
      ctx.clip();
      // (a soft shade round it first, so it reads on sand as well as on dark glass)
      var mg = ctx.createRadialGradient(mx, my, 0.5 * mr, mx, my, 1.5 * mr);
      mg.addColorStop(0, 'rgba(0,0,0,' + (0.32 * ma).toFixed(3) + ')');
      mg.addColorStop(1, NO_SHADOW);
      ctx.fillStyle = mg;
      ctx.fillRect(mx - 1.5 * mr, my - 1.5 * mr, 3 * mr, 3 * mr);
      mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
      mg.addColorStop(0, GLINT[(ma * CRACK_LV + 0.5) | 0]);
      mg.addColorStop(0.5, GLINT[(ma * 0.5 * CRACK_LV + 0.5) | 0]);
      mg.addColorStop(1, GLINT[0]);
      ctx.fillStyle = mg;
      ctx.fillRect(mx - mr, my - mr, 2 * mr, 2 * mr);
      // three craze lines from its heart, always the same for the same stretch
      ctx.beginPath();
      for (k = 0; k < 3; k++) {
        var ca = (k + hash01(sim.warnSeg * 7 + k)) * 2.094;
        var cl = mr * (0.5 + 0.4 * hash01(sim.warnSeg * 13 + k));
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + cl * Math.cos(ca), my + cl * Math.sin(ca));
      }
      ctx.strokeStyle = CRACK_SHADOW; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.strokeStyle = GLINT[(ma * CRACK_LV + 0.5) | 0]; ctx.lineWidth = 0.45; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  /**
   * Keep the cracks on c-front in step with the glass. Called once a frame,
   * after drawSand, with rot = sim.angle + sim.tilt. Returns true when it
   * redrew. A whole glass with nothing flashing costs nothing and never
   * touches the canvas. Otherwise c-front is redrawn at once when
   * sim.crackRev changes (a crack appears, breaks through, is mended, moves
   * with a flip or goes with a reset), and at most 30 times a second when a
   * crack has grown, the glass has turned more than 0.03 rad against the
   * room, the mend has moved, or something flashes; and once more as a
   * flash ends.
   */
  Renderer.prototype.syncDamage = function (rot, nowMs) {
    var sim = this.sim, n = sim.cracks ? sim.cracks.length : 0, st = this._dmg, k;
    var mark = markLevel(sim);
    if (!st) {
      if (!n && !mark) return false;
      st = crackState(this);
    }
    if (!this.cssW) return false;               // not laid out yet: layout() draws everything
    rot = +rot || 0;
    nowMs = +nowMs || 0;
    if (this.reduced && st.animEnd > nowMs) st.animEnd = nowMs;   // Reduce Motion: stop flashing now
    var running = st.animEnd > nowMs, ending = st.animEnd > 0 && !running;
    if (sim.crackRev === st.rev) {
      if (!n && !running && !ending && mark === st.markQ) { this.animating = false; return false; }
      var due = nowMs - st.lastT >= CRACK_REDRAW || nowMs < st.lastT;
      var changed = running || ending || mark !== st.markQ || (n > 0 && (st.dirty || Math.abs(rot - st.rot) > 0.03));
      for (k = 0; k < n && due && !changed; k++) changed = crackStale(st, sim.cracks[k]);
      if (!due || !changed) {
        this.animating = running || ending;
        return false;
      }
    }
    st.rot = rot; st.now = nowMs; st.lastT = nowMs; st.dirty = false;
    if (ending) st.animEnd = 0;                  // this is the clean frame after the flash
    this.animating = running;
    this._drawFront();
    return true;
  };

  /**
   * A damage event from sim.frame (type is a Sim.DMG value; k the crack's
   * index, −1 for WARN; level the creak level 1–4). Starts its flash: the
   * stress mark brightening for 300 ms for WARN, the hairline flaring
   * bright over 600 ms for CRACK, and a 120 ms brighter chip rim for
   * BREACH and WIDEN. Reduce Motion skips them all; the change itself is
   * drawn on the next syncDamage.
   */
  Renderer.prototype.damageEvent = function (type, k, level, nowMs) {
    var sim = this.sim, D = Sim.DMG, st = crackState(this), dur;
    st.dirty = true;
    if (this.reduced) return;
    nowMs = +nowMs || 0;
    if (type === D.WARN) {
      if (!markLevel(sim)) return;
      st.warnT0 = nowMs; st.warnT1 = nowMs + 300;
      dur = 300;
    } else if (type === D.CRACK || type === D.BREACH || type === D.WIDEN) {
      var cr = sim.cracks ? sim.cracks[k] : null;
      if (!cr) return;
      var a = st.aN;
      st.aN = (a + 1) & 3;
      st.aRec[a] = cr;
      st.aKind[a] = type === D.CRACK ? 1 : 2;
      st.aT0[a] = nowMs;
      dur = type === D.CRACK ? CRACK_FLASH : 120;
    } else {
      return;
    }
    if (nowMs + dur > st.animEnd) st.animEnd = nowMs + dur;
    this.animating = true;
  };

  /**
   * How far a mend has run, 0 … 1: gold flows along every open crack from
   * its origin to that share of the way to each tip. Lower it and the gold
   * recedes; 0 clears it. Drawn on the next syncDamage.
   */
  Renderer.prototype.setMend = function (p) {
    p = +p;
    if (!(p > 0)) p = 0; else if (p > 1) p = 1;
    var st = this._dmg;
    if (!st) {
      if (!p) return;
      st = crackState(this);
    }
    if (p === st.mend) return;
    st.mend = p;
    st.dirty = true;
  };

  /**
   * Where crack k's chip (its hole) is, in lattice cells (x right, y down,
   * from the lattice's top-left corner), as the glass stands now: for the
   * app's escape mapping and the sound's pan. Fills `out`; null for no crack.
   */
  Renderer.prototype.chipVessel = function (k, out) {
    var sim = this.sim, cr = sim.cracks ? sim.cracks[k] : null;
    if (!cr) return null;
    var g = sim.geo, u = cr.u > 0.995 ? 0.995 : cr.u;
    out = out || {};
    out.x = g.cx + (cr.side < 0 ? -1 : 1) * (profile(u, g) + 0.3 * g.wall);
    out.y = g.cy + (cr.bulb ? 1 : -1) * u * g.HB;
    return out;
  };

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

  /* ======================================================================
   *  Exports
   * ==================================================================== */
  root.HourglassPhysics = {
    Sim: Sim,
    Renderer: Renderer,
    Spill: Spill,
    THEMES: THEMES,
    makeGeometry: makeGeometry,
    profile: profile,
    EMPTY: EMPTY, WALL: WALL, REST: REST, MOVE: MOVE,
    STEP_HZ: STEP_HZ, DT: DT
  };
})(typeof window !== 'undefined' ? window : globalThis);
