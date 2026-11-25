/*
 * Hourglass sand engine: RealSand, the app's adapter (design section 4).
 *
 * The app (app.js) knows one sand, the CPU Sim of sand/sim.js, through about sixty members.
 * RealSand has the same members, so that app.js can point its one variable `sim` at it while
 * Real sand runs; behind them the sand is the GPU engine of this folder, with its metered neck.
 * The CPU Sim stays alive, not stepped: it is the glass's model (its geometry, capacity, cracks
 * and flaws), the source of every GPU fill (fill.mjs fromLattice: the bed's shape and each
 * grain's colour), the holder of the per-frame record the app and the audio read (sim.frame,
 * sim.nev and the event arrays, shared), and the instant fallback.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 *
 * ==============================================================================================
 *  THE APP'S SIDE
 * ==============================================================================================
 *  const real = await RealSand.create({ P, cpuSim, renderer, rotor, cSand, timer: T, settings,
 *                                        offscreen, onLost, onBack, log })
 *    P: window.HourglassPhysics (needed: create refuses without it, or without a value of the
 *    classic sand's it reads, classicValues); cpuSim: the app's Sim; renderer: its Renderer (the LUT, the
 *    scale); rotor, cSand: #rotor and #c-sand (RealSand makes #c-gpu after #c-sand and takes its
 *    CSS box); timer: the app's clock state T (state, rem, tailMs, lastTick are read);
 *    offscreen: draw into a texture and show it on a 2-D canvas (headless tests: their WebGPU
 *    canvas cannot present); allowFallback: accept a software adapter (headless tests only);
 *    onLost(info), onBack(): below.
 *  await real.start()       the device, the pipelines, the buffers, a self-test (no latency
 *                           limit: a slow start is not a failure). Throws an Error with code,
 *                           message and capability (true: WebGPU or a usable adapter is missing,
 *                           so the setting is cleared; false: retry at the next launch). Code
 *                           'stamp': the shaders are of another build than the modules (an
 *                           update under way). A page fetches its shaders once: a rebuild or a
 *                           retried start compiles the same sources.
 *  await real.adopt()       the GPU bed from the CPU Sim's lattice and counts now, settled 0.4 s
 *                           (simulated) with the neck shut; ready is true once it is drawn.
 *  real.ready              adopt()'s bed is drawn and the engine is not lost: only then may the
 *                           app hand it the sand (false from a loss until the rebuild's onBack).
 *  real.takeOver()          the app now uses real as its sim (sim = real, between two frames;
 *                           throws if the engine is lost): RealSand takes the CPU Sim's angle,
 *                           tilt and turn, and fills again if the CPU sand was poured, turned or
 *                           reset meanwhile; grains the CPU released meanwhile are owed and leave
 *                           through the valve, or, more than its catch-up lets flow after a gap
 *                           (0.4 s of the clock's flow, at least 12), are moved by a transfer.
 *  Each frame, as app.js's frame() runs (design 5.1): the clock, pours (pour), swaps
 *  (completeFlip), the valve's fields (gateOpen, deepRelease, targetTop, relCap, flipping),
 *  isActive(), beginFrame(), the catch-up (fastForward), the 120 Hz steps (feel, setMotion,
 *  step), then submit(now) in place of renderer.drawSand(). The count the app reads (nTop)
 *  follows the clock at the first step of the frame and moves to the frame's count over its
 *  steps; the GPU's run for the frame is encoded in submit.
 *  real.setHidden(hidden)   from visibilitychange: no GPU work while hidden.
 *  real.jolts               how the glass's motion is played to the sand at app speed (felt.mjs):
 *                           'live' (the default: at once), 'slowmo' (a lone jolt as a slowed film),
 *                           'film' (as before 2026-11: half a second late under any shaking) or
 *                           'plain'; also opts.jolts at create. Under Reduce Motion (real.reduced)
 *                           it is played plain.
 *  real.layout()            after renderer.layout(); real.setPalette() after a theme or layers
 *                           change; real.setSweep(kind, p) beside renderer.setSweep.
 *  onLost({ reason, lifecycle, final, message }): the GPU sand is gone (a lost device, readbacks
 *    that stopped, an error). RealSand has already brought the CPU Sim to the ledger's counts
 *    (syncCpu: the clock is not touched); the app makes the CPU Sim its sim again in this frame
 *    and shows its canvases. lifecycle: around a lock or an app switch (no toast); otherwise
 *    message is the toast. final: a second loss within 10 minutes, the current sand for the
 *    rest of the session (Tune says so). Unless final, RealSand rebuilds (a new device, at once
 *    when visible for a lifecycle loss, after 2 s otherwise), adopts the CPU sand again and
 *    calls onBack(), on which the app makes it its sim again (takeOver).
 *
 * ==============================================================================================
 *  WHAT IS SEEN (design 6, 7.4)
 * ==============================================================================================
 *  Each grain is drawn in its seed's colour from the Renderer's own table (setPalette: the
 *  theme, layered sand), inside the neck the app draws (the warp), lit from the room's upper
 *  left whatever the glass's angle on screen (the rotor's turn), and the Reset's sweep is drawn
 *  as the CPU sand draws it (setSweep: the old sand into the neck, the new revealed under a
 *  rising surface with its thread). With layered sand the tone pass (layers.mjs) lays falling
 *  sand in strata where it comes to rest, a fresh pattern after each turn, and the poured sand
 *  in layers; the layers switch re-tones every point by its depth from the CPU Sim's strata.
 */
import { buildGlass, sampleField } from './glass.mjs';
import { Solver, ShaderLibrary, createDevice, MATERIALS, PARTICLE_WORDS } from './solver.mjs';
import { newPace, paceReset, paceSkip, paceBudget, paceFrame, paceSubmit, paceDone, paceValve, QUEUE_DEFAULT } from './pace.mjs';
import { PPC, lattice, packParticles, fromLattice, rand32 } from './fill.mjs';
import { GrainRenderer, FLIGHT, exposure } from './grains.mjs';
import * as Rate from './rate.mjs';
import { GlassFelt, JOLT_MODES, kneeOf } from './felt.mjs';
import { Toner, LayerPlan, markSides, retone as retoneAll, toneWords, TONE_FRESH, TONE_TRACK, TONE_LAY, LAY_S } from './layers.mjs';
import { Valve, ALLOW_SHUT, NECK_ON } from './valve.mjs';
import { MODES, newModes, modesReset, chooseMode, frameMsFor } from './modes.mjs';
import * as Pal from './palette.mjs';
import { BUILD } from './build.mjs';

export { BUILD };

/** Solver cells per app cell at scale 1: 0.65 at the phone's 1.08, so the grid is 137 x 302 at every scale (design 3.3). */
export const CELLS_AT_Q1 = 0.702;
/** The substep rate, iterations and limits (the lab's at app speed); auto Hz up to 1,440. */
export const SET = Object.freeze({ hz: 480, iterations: 5, cap: 24, maxStep: 1, coriolis: true, auto: true, speed: 'app', hzMax: 0 });
const SET_CALM = Object.freeze(Object.assign({}, SET, { auto: false }));
const MATERIAL = MATERIALS.coarse;
const QUEUE = QUEUE_DEFAULT;               // frames of GPU work in flight at most (2)
const SETTLE_S = 0.4;                      // a fresh bed settles this long, neck shut, when adopted
const XFER_TIMEOUT_MS = 1000;              // a transfer's readback not back by then is abandoned (7.6)
const LIFECYCLE_MS = 1000;                 // a loss within this long of becoming visible is a lifecycle event (7.9)
const REBUILD_MS = 2000;                   // after a loss that is not, rebuild after this long
const LOSS_WINDOW_MS = 600000;             // a second such loss within 10 minutes is final
const LAM0 = 0.09;                         // the app's lambda before it has said one (G / g at the glass's size)
const RC = 0.36;                           // a grain's radius, solver cells (the lab's)
const BLUR = 1;                            // a grain in flight streaks over one display frame
const SAMPLES = 64;                        // the app's field samples kept (half a second at 120 Hz)
// The bed's sounds (design 8), on the classic Sim's scale (sand/sim.js _landing, _stepMotion):
//  E_MIN: a landing under this energy is not heard (audio.js thump: 1.3 sqrt(E) under 0.05);
//  FALL_S: a bed that lands has lost half its speed within this long (simulated s) of its
//  fastest, however many runs a second the display asks for;
//  BODY: a fall starts only when the bed falls as one body, this share of its points moving: a
//  falling body moves every point faster than a point moves from, while sand shaken up the wall
//  and sliding back down it into the rest is about half the bed moving (0.47 to 0.62 at the
//  speed of a landing, against 0.75 to 0.84 as a flicked bed's fall starts and up to 0.94 as it
//  speeds up), and is a slip, not a landing;
//  BED_MIN, BED_SHARE: a bed is heard from this many points and this share of the glass's: fewer
//  are the plug of the stream under the neck, the first grains on the floor or the last above
//  the neck, whose mean speed is no bed's (a 10 s glass's plug: 3 to 14 points at up to 59 cells/s);
//  SLIDE_K: the bed's motion within itself counts as the classic sand's slides at SLIDE_K over
//  the square root of the bed's grains (never more than all of it): the classic sand slides at
//  its surface, the GPU bed shears through its depth, and a bed of n grains has a surface of
//  about sqrt(n) (calibrated on two glasses against the classic sand on the same motion, design
//  8: 0.47 of it for the 1,155 grains of a 10 s glass, 0.30 for the 2,830 of a minute); CAL_S:
//  the lattice those grains were counted on (s at the classic grain on a phone, 0.702 / 1.08),
//  so that the same GPU motion is the same sound at every grain and size of the app's lattice;
//  PACK_LO, PACK_HI, PACK_T, AXIS: a bed thrown flies, it does not slide (the classic sand's bed
//  in the air slides nothing): its slides count in full while it is packed (PACK_HI of its
//  points crowded, against how packed it has lately been: a memory of PACK_T s), less as it
//  loosens, and once it is under PACK_LO not at all until it has packed again; nor while it
//  moves as a body along the glass's axis (AXIS of its speed) faster than a landing is heard
//  from; (the agitation's memory and the level under which a bed at rest is 0 are the classic
//  sand's, read at create: CLASSIC.TAU_T, CLASSIC.IDLE_T);
//  HOLD_MS: a readback's slides are fed until the next comes, this long at most; MUTE_MS: a fresh
//  bed (a fill, a transfer) settles unheard this long; TURN_W: turned faster than this (rad/s), a
//  bed neither lands nor heats (as the classic sand's, which a turn leaves calm)
const SND = Object.freeze({ E_MIN: 0.0015, FALL_S: 0.15, BODY: 0.7, BED_MIN: 40, BED_SHARE: 0.03, SLIDE_K: 16, CAL_S: 0.65, PACK_LO: 0.75, PACK_HI: 0.95, PACK_T: 1, AXIS: 0.9,
  HOLD_MS: 120, MUTE_MS: 400, TURN_W: 0.5 });

/**
 * The classic sand's values RealSand goes by, read once at create from its namespace (sand/sim.js,
 * window.HourglassPhysics: opts.P), so that the two sands cannot drift apart: STEP_HZ, DT: the
 * app's step; EV_CAP: landings a frame for the audio (the event arrays' length); IMPACT_V: px/s, a
 * blow from this speed thumps (MOTION.impV[0]); TAU_T: the agitation's memory, s (MOTION.tauT);
 * IDLE_T: under this, with the bed at rest, it is 0 (MOTION.idleT); LAYERS: the layered sand's
 * tunables (settle: steps after a turn in which sand coming to rest is laid in its new pattern; read
 * when used, since the object is shared and changed in place); pace: the finer sand's pace.
 * Without the namespace, or with one of these missing, create refuses and names what is missing:
 * no number here has a fallback of its own.
 */
function classicValues(P) {
  if (!P || typeof P !== 'object') throw new Error('RealSand: the classic sand\'s namespace is needed (opts.P, or window.HourglassPhysics from sand/sim.js), and there is none');
  // (each read spelled out on P and P.Sim, so the contract check in realsand-adapter sees it)
  const sim = !!P.Sim, mot = sim && !!P.Sim.MOTION, lay = sim && !!P.Sim.LAYERS, miss = [];
  const num = (v, name) => { if (typeof v !== 'number' || !Number.isFinite(v)) miss.push(name); return v; };
  const v = {
    STEP_HZ: num(P.STEP_HZ, 'P.STEP_HZ'), DT: num(P.DT, 'P.DT'),
    EV_CAP: num(sim ? P.Sim.EV_CAP : NaN, 'P.Sim.EV_CAP'), IMPACT_V: num(sim ? P.Sim.IMPACT_V : NaN, 'P.Sim.IMPACT_V'),
    TAU_T: num(mot ? P.Sim.MOTION.tauT : NaN, 'P.Sim.MOTION.tauT'), IDLE_T: num(mot ? P.Sim.MOTION.idleT : NaN, 'P.Sim.MOTION.idleT'),
    LAYERS: lay ? P.Sim.LAYERS : null, pace: sim ? P.Sim.pace : null
  };
  num(lay ? v.LAYERS.settle : NaN, 'P.Sim.LAYERS.settle');
  if (typeof v.pace !== 'function') miss.push('P.Sim.pace()');
  if (miss.length) throw new Error('RealSand: the classic sand\'s namespace lacks ' + miss.join(', '));
  return Object.freeze(v);
}
const SELF_TEST_POINTS = 500;

const ENGINE = { createDevice, Solver, GrainRenderer, ShaderLibrary, Toner };

/**
 * One shader library a page, for each base URL: its sources are fetched once, so a rebuild after
 * a lost device or a retried start compiles the very shaders the page started with. (A new
 * release's service worker takes the page over and answers fetches with the new files, while the
 * page's modules stay the old ones.)
 */
const LIBRARIES = new Map();
function libraryFor(Lib, base) {
  const key = String(base);
  let lib = LIBRARIES.get(key);
  if (!lib || !(lib instanceof Lib)) { lib = new Lib(base); LIBRARIES.set(key, lib); }
  return lib;
}
const SWEEP_MIN = 0.05;                    // app cells^2: a grain drawn this near the neck in the sweep's first half is swallowed (the CPU's 0.2 px^2)
const THREAD_MAX = 1024;                   // the sweep's thread: grains drawn at most

/** An Error for start(): code, message, and whether a capability is missing (the setting is then cleared). */
function startError(code, message, capability = false, cause = null) {
  const e = new Error(message);
  e.code = code; e.capability = !!capability; if (cause) e.cause = cause;
  return e;
}
const fin = v => (v - v === 0 ? +v : 0);

/** The grain palette from the app Renderer's own table at its middle light level (design 6.2): 256 x [r, g, b, a], a 2 for mica. */
export function paletteFromLUT(lut, isMica) {
  const out = new Float32Array(256 * 4);
  for (let s = 0; s < 256; s++) {
    const v = lut[(21 << 8) | s] >>> 0;
    out[4 * s] = (v & 255) / 255; out[4 * s + 1] = ((v >>> 8) & 255) / 255; out[4 * s + 2] = ((v >>> 16) & 255) / 255;
    out[4 * s + 3] = isMica && isMica[s] ? 2 : 1;
  }
  return out;
}

export class RealSand {
  /** A RealSand for the app's CPU Sim (no GPU yet: start()). opts: see the header; for tests also engine, clock, canvas, shaderBase. */
  static async create(opts) { return new RealSand(opts); }

  constructor(opts = {}) {
    if (!opts.cpuSim) throw new Error('RealSand: the CPU Sim (cpuSim) is needed');
    this.o = opts;
    this.P = opts.P || globalThis.HourglassPhysics || null;
    this.K = classicValues(this.P);
    this.cpu = opts.cpuSim;
    if (typeof this.cpu.layerState !== 'function') throw new Error('RealSand: the CPU Sim lacks layerState() (sand/sim.js)');
    this.view = opts.renderer || null;
    this.T = opts.timer || null;
    this.engine = Object.assign({}, ENGINE, opts.engine || {});
    this.clock = opts.clock || { wall: () => Date.now(), perf: () => performance.now() };
    this.log = opts.log || (() => {});
    this.offscreen = !!opts.offscreen;
    this.shaderBase = opts.shaderBase || new URL('./shaders/', import.meta.url);
    this.shaders = libraryFor(this.engine.ShaderLibrary || ShaderLibrary, this.shaderBase);
    const cpu = this.cpu, geo = cpu.geo;
    // the contract's own fields (the app writes them)
    this.angle = fin(cpu.angle); this.tilt = fin(cpu.tilt); this.flipping = !!cpu.flipping;
    this.gateOpen = false; this.deepRelease = false; this.targetTop = cpu.nTop; this.relCap = 0;
    this.topSweeps = 0; this.quiet = 0; this.damageArmed = false; this.spinArmed = false; this.reduced = false;
    this.quality = 2; this.escN = 0; this.dMax = 0;
    this.agit = new Float32Array(2);
    this.bf = new Float32Array(4);
    this.layers = !!cpu.layers;
    // units (design 3.3): s solver cells per app cell, ppg points per app grain
    this.s = CELLS_AT_Q1 / geo.q;
    this.ppg = PPC * PPC * this.s * this.s;
    const tGlass = this.clock.perf();
    this.glass = opts.glass || buildGlass({ s: this.s, neckMin: 5.5, geo, profile: this.P.profile });
    const msGlass = this.clock.perf() - tGlass;
    this.Gg = this.s * cpu.G;                // gravity at app speed, solver cells/s^2
    this._bulbTable();
    this.valve = new Valve({ ppg: this.ppg });
    this.valve.fill(cpu.nTop, cpu.total);
    // the frame's state
    this.pace = newPace();
    this.rate = Rate.newRate(SET.hz);
    // how the glass's motion is played to the sand at app speed (felt.mjs): 'live' (the default),
    // 'slowmo', 'film' or 'plain'; the app may set it later (a Tune row); Reduce Motion plays it plain
    this.jolts = JOLT_MODES.includes(opts.jolts) ? opts.jolts : JOLT_MODES[0];
    this.felt = new GlassFelt({ mode: this.jolts, knee: kneeOf(MATERIAL) });
    this.modes = newModes();
    this.modeSetting = 'auto';
    this.simTime = 0;
    this._smp = []; for (let i = 0; i < SAMPLES; i++) this._smp.push(this._blankSample());
    this._smpN = 0; this._pend = null; this._lam = LAM0; this._lastW = 0; this._lastAl = 0; this._peakA = 0;
    this._overSince = null; this._leans = []; this._motion = false;
    this._planned = false; this._planNow = 0; this._planPerf = null; this._mid = null;
    this._lastState = this.T ? this.T.state : 'idle'; this._runStart = null; this._endAt = -Infinity;
    this._pourAt = -Infinity; this._swapAt = -Infinity; this._settleUntil = -Infinity; this._wake = false;
    this._sweep = null; this._fillDue = false; this._xfer = null; this._xferGen = 0; this._xferPours = []; this._xferPourPts = 0;
    this._lastNow = 0; this._lastDrawn = 0; this._acc = 0; this._lastSteps = 0; this._lastRunPerf = null; this._behind = 0;
    this._rafLog = []; this._frames = [];
    this._drawnParity = this.valve.parity; this._cssTurned = false;
    // the picture must be drawn again although nothing moves (a new palette, a resized canvas, back
    // from hidden, a new bed): asleep, the next submit draws it in a run of no substeps
    this._redraw = false; this._guardOn = false;
    this._land = []; this._r2 = [0, 0];
    // the bed's sounds: what the readbacks since the last frame said (thump, slam), the slides'
    // rate (grain-cell moves a second) of the newest, each grid bulb's bed at the last readback
    // (prev), how packed it has lately been (pack), whether it was thrown loose and has not packed
    // again (loose) and its fall under way (fall), and the counts for the report
    this._snd = { thump: new Float32Array(4), slam: new Float32Array(2), rate: 0, rateAt: -Infinity, heardAt: -Infinity, fedAt: 0,
      prev: [null, null], fall: [null, null], pack: [0, 0], loose: [false, false], gen: -1, parity: -1, muteUntil: -Infinity, n: { thumps: 0, slams: 0 } };
    this._tally = null; this._gen = 0;
    this._fall = { from: null, wallFrom: null, s: NaN, wall: NaN, floor: this._floorDepth(), log: [] };
    this._losses = []; this._lostInfo = null;
    this._ready = false; this._firstFrameAt = null;
    this.hidden = !!(globalThis.document && globalThis.document.hidden);
    this._visibleAt = this.clock.perf();
    this._visWait = [];
    this.started = false; this.live = false; this.destroyed = false; this._gone = false;
    this.dev = null; this.device = null; this.solver = null; this.grains = null; this.canvas = opts.canvas || null;
    this._css = { w: 0, h: 0, dpr: 1 };
    // (the main thread's longest pieces of work, for Gate B: building the glass, the last fill; review finding 9)
    this.times = { start: null, device: null, pipelines: null, selfTest: null, selfTestRun: null, firstFrame: null, glass: msGlass, fill: null };
    this.n = { runs: 0, skips: 0, calmSkips: 0, asleep: 0, jolts: 0, cssTurns: 0, transfers: 0, xferTimeouts: 0, residues: 0, fills: 0,
      deferred: 0, readbackFails: 0, losses: 0, rebuilds: 0, pours: 0, swaps: 0, errors: 0, refills: 0, handoverCatchUps: 0, redraws: 0, guards: 0 };
    // the report on exact time (stats(), ?debug=sand), as the lab's Timer gives it (_onTally): runs read back, open
    // runs whose crossings left fewer above than their lowest target (the membrane's promise
    // broken), crossings while shut, audits and failed audits, and for each glass that ended, when
    // the last point crossed against the clock's 00:00.0 (ms; the GPU's substep record)
    this._ends = { runs: 0, below: 0, shutCross: 0, audits: 0, auditFails: 0, lastFor: null, last: [] };
    this._rng = rand32((cpu.rng | 0) ^ 0x5bd1e995);
    // layered sand on the GPU (design 7.4, layers.mjs): the tone pass, the layer schedule, the
    // crossing numbers it has reached (known: of the plan, from the readbacks; base: the plan's
    // number of the GPU's crossing 0), tone 1's share of the top bulb, the turned bulbs' patterns
    this.toner = null; this._retoneDue = false; this._toneAt = null; this._toneField = null;
    this._lay = { plan: new LayerPlan({ ppg: this.ppg, pace: this.K.pace(), lay: this.K.LAYERS, seed: ((cpu.rng | 0) ^ 0x6C8E9CF5) >>> 0 }),
      base: 0, known: 0, share: 0.5, words: null, wordsParity: 0, pats: null, until: -Infinity,
      // the debt: tone-1 grains given less those that crossed (the tone pass keeps it within a slack)
      debt: 0 };
    // the Reset's sweep: how far the farthest grain lies from the neck (grid cells^2), the new bed's points
    this._sweepFar = 0; this._sweepFill = null; this._sweepFrame = 0;
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Start, adopt, hand over, lose, rebuild
   * ---------------------------------------------------------------------------------------- */
  /** The device, the pipelines, the buffers and the self-test (design 10.1). */
  async start() {
    const perf = () => this.clock.perf(), t0 = perf();
    this.times.start = t0;
    this._hiddenInStart = false;           // (setHidden(true) while the device opens sets it)
    let dev;
    try { dev = await this.engine.createDevice(); } catch (e) {
      const cap = e && (e.code === 'nogpu' || e.code === 'noadapter');
      throw startError(cap ? e.code : 'device', cap ? (e.code === 'nogpu' ? 'Needs WebGPU (iOS 26 or later)' : 'No graphics adapter for WebGPU') : 'The graphics device could not be opened: ' + (e && e.message || e), cap, e);
    }
    // (allowFallback: tests only, whose headless browser has nothing but a software adapter)
    if (dev.info && dev.info.fallback && !this.o.allowFallback) {
      try { dev.device.destroy && dev.device.destroy(); } catch (e) { /* (gone already) */ }
      throw startError('fallback', 'This device\'s graphics are too slow for Real sand', true);
    }
    this._useDevice(dev);
    this.times.device = perf() - t0;
    this._hiddenInStart = this._hiddenInStart || this.hidden;
    try {
      const t1 = perf();
      try {
        this.solver = await this.engine.Solver.create(this.device, this.shaders);
        this._makeCanvas();
        this.grains = new this.engine.GrainRenderer(this.device, this.canvas, { offscreen: this.offscreen });
        await this.grains.init(this.solver.shaders);
        await this._makeToner();
      } catch (e) {
        await this._checkShaderBuild();
        const msg = String(e && e.message || e);
        throw startError(/Could not load|fetch|HTTP/i.test(msg) ? 'load' : 'compile', 'The sand engine could not be loaded: ' + msg, false, e);
      }
      await this._checkShaderBuild();
      this.times.pipelines = perf() - t1;
      this._configure();
      await this._selfTest();
      const doc = globalThis.document;
      if (this._gone) throw startError('lost', 'The graphics chip was reset while Real sand started');
      if (this._hiddenInStart || this.hidden || (doc && doc.hidden)) throw startError('hidden', 'The page was hidden while Real sand started');
    } catch (e) {
      // (the device is let go: the app keeps its current sand, and tries again at the next launch)
      try { this.dev.device.destroy && this.dev.device.destroy(); } catch (e2) { /* (gone already) */ }
      throw e;
    }
    this.started = true;
    this.log('Real sand: started in ' + Math.round(perf() - t0) + ' ms (device ' + Math.round(this.times.device) + ', pipelines ' +
      Math.round(this.times.pipelines) + ', self-test ' + Math.round(this.times.selfTest) + ')');
  }

  /**
   * The shaders loaded are of this engine's build (the line "Engine build" in common.inc.wgsl):
   * else old and new files of an update have met (code 'stamp': the app says it is updating).
   */
  async _checkShaderBuild() {
    const lib = this.shaders;
    if (!lib || !lib.sources || !lib.sources.has('common.inc')) return;     // (a mock engine loads no shader)
    let src = '';
    try { src = await lib.sources.get('common.inc'); } catch (e) { return; }
    const m = /^\/\/ Engine build: (\S+)/m.exec(src), b = m ? m[1] : null;
    if (b !== BUILD) throw startError('stamp', `The sand engine's shaders are build ${b}, its modules build ${BUILD}: a mix of old and new files`);
  }

  _useDevice(dev) {
    this.dev = dev; this.device = dev.device; this._gone = false;
    const d = dev;
    if (d.device && d.device.lost && d.device.lost.then) d.device.lost.then(info => this._deviceLost(d, info), () => {});
  }

  /** The tone pass for layered sand (layers.mjs), when the engine has one (the tests' mock GPU has none). */
  async _makeToner() {
    this.toner = null;
    if (!this.engine.Toner) return;
    this.toner = new this.engine.Toner(this.device, this.solver.shaders);
    await this.toner.init();
  }

  /** Buffers for the largest glass the app allows, uniform slots for the highest rate, the palette, the warp, the tone pass. */
  _configure() {
    const maxP = Math.ceil(this.valve.Pts(this.cpu.maxTotal) * 1.05) + 1024;
    this.solver.configure(this.glass, maxP, Rate.capAlloc(SET));
    this.grains.bind(this.solver.buffers.particles);
    if (this.grains.setWarp) this.grains.setWarp(this.glass.warp, this.glass.cx, this.glass.cy);
    if (this.toner) {
      this.toner.bind(this.solver.buffers.count, this.solver.buffers.particles);
      // (after each run's tally: its 8 words come back with the tally)
      this.solver.post = (enc, n) => this._tonePass(enc, n);
      this.solver.postWords = this.toner.counts;
    }
    this.layout();
    this.setPalette();
  }

  /** 500 points on the shut neck, 24 substeps: all there, all finite, all inside, none crossed (10.1). */
  async _selfTest() {
    const g = this.glass, t0 = this.clock.perf();
    let pts = lattice(g, (x, y) => y > g.cy + 0.6, [g.cx - g.Rc, g.cy, g.cx + g.Rc, g.cy + 40]);
    const idx = [...Array(pts.length / 2).keys()].sort((a, b) => pts[2 * a + 1] - pts[2 * b + 1]).slice(0, SELF_TEST_POINTS);
    pts = idx.flatMap(i => [pts[2 * i], pts[2 * i + 1]]);
    const n = pts.length / 2;
    this.solver.upload(packParticles(pts, MATERIAL), n);
    const neck = { flip: false, vcap: 0, allow: new Float32Array([ALLOW_SHUT]), flags: NECK_ON };
    const f = this._uprightField();
    const t1 = this.clock.perf();
    const p = this.solver.run(24, this._set(SET.hz), () => f, null, neck);
    let t = null;
    try { t = p ? await p : null; } catch (e) { throw startError('selftest', 'The self-test\'s readback failed: ' + (e && e.message || e), false, e); }
    this.times.selfTestRun = this.clock.perf() - t1;
    this.times.selfTest = this.clock.perf() - t0;
    const ok = !!t && n === SELF_TEST_POINTS && t.points === n && t.nan === 0 && t.outside === 0 && t.above === n;
    if (!ok) throw startError('selftest', 'The self-test failed: ' + (t ? `points ${t.points} of ${n}, not finite ${t.nan}, outside ${t.outside}, above ${t.above}` : 'no readback'));
  }

  /** The GPU bed from the CPU Sim's lattice and counts now, settled 0.4 s with the neck shut (design 7.8). */
  async adopt() {
    if (!this.solver) throw new Error('RealSand: start() first');
    const cpu = this.cpu;
    this.angle = fin(cpu.angle); this.tilt = fin(cpu.tilt); this.flipping = !!cpu.flipping;
    this.layers = !!cpu.layers;
    this._upload(cpu.nTop, cpu.total);
    this._adopted = { flip: cpu.glassFlip | 0, total: cpu.total, top: cpu.nTop };
    await this._settle(SETTLE_S);
    if (this._gone) throw startError('lost', 'The graphics chip was reset while Real sand took over the sand');
  }

  /** The app makes RealSand its sim (between two frames); only when ready (a lost engine throws). */
  takeOver() {
    if (this._lostInfo || this._gone || this.destroyed || !this.solver) throw new Error('RealSand: the engine is lost or not started');
    const cpu = this.cpu, v = this.valve, A = this._adopted;
    this.angle = fin(cpu.angle); this.tilt = fin(cpu.tilt); this.flipping = !!cpu.flipping;
    this.gateOpen = !!cpu.gateOpen; this.deepRelease = !!cpu.deepRelease; this.targetTop = cpu.targetTop; this.relCap = fin(cpu.relCap);
    this.quality = cpu.quality; this.reduced = !!cpu.reduced;
    // poured, turned or made new while the engine settled: the bed is the CPU's again (its own flow is owed)
    if (!A || cpu.total !== v.total || (cpu.glassFlip | 0) !== A.flip || cpu.nTop > v.nTop) {
      this.n.refills++;
      this._upload(cpu.nTop, cpu.total);
    } else {
      // the CPU released grains meanwhile: owed, they leave through the valve as the stream (the
      // settle's 0.4 s of flow, design 7.8). More than the app lets flow after a gap (its catch-up
      // on return: 0.4 s of the clock's flow, at least 12 grains), as when the page was hidden
      // while the engine adopted and the CPU caught up on return, is moved below by a transfer,
      // as the app's catch-up would: the count never goes back up to the adoption's
      const owed = v.nTop - cpu.nTop, rate = this.T && this.T.rate > 0 ? this.T.rate : 0;
      if (owed > Math.max(12, rate * 0.4)) { v.fastForward(owed); this.n.handoverCatchUps++; }
    }
    this._adopted = null;
    // (layers turned on or off while the CPU sand was the app's: the GPU's tones follow)
    if (this.layers !== !!cpu.layers) { this.layers = !!cpu.layers; this._retoneDue = true; }
    this.live = true;
    this._quiet(false);
    this._planned = false; this._mid = null;
    this._lastNow = 0; this._lastDrawn = 0; this._acc = 0; this._lastRunPerf = null;
    this._lastState = this.T ? this.T.state : 'idle';
    modesReset(this.modes, this._wall());
  }

  /**
   * The CPU Sim brought to the ledger's counts (design 7.8): made new with its damage kept, the
   * sand above the neck what the ledger says, settled, and the glass's angle, tilt and turn
   * copied. The clock is not touched. Used when the CPU sand takes over, and before a fill from
   * it that the ledger's counts must hold (a timed-out transfer).
   */
  syncCpu() {
    const cpu = this.cpu, v = this.valve;
    const total = v.total, top = Math.max(0, this.nTop - (v.xfer ? v.xfer.hold : 0));
    const dmg = cpu.serializeDamage();
    cpu.reset(total);
    cpu.restoreDamage(dmg);
    cpu.gateOpen = false; cpu.deepRelease = false; cpu.targetTop = cpu.nTop; cpu.relCap = 0;
    if (cpu.nTop > top) cpu.fastForward(cpu.nTop - top);
    for (let i = 0; i < 240 && cpu.isActive(); i++) { cpu.beginFrame(); cpu.step(); }
    cpu.beginFrame();
    cpu.angle = this.angle; cpu.tilt = this.tilt; cpu.flipping = this.flipping;
    cpu.gateOpen = this.gateOpen; cpu.deepRelease = this.deepRelease; cpu.targetTop = Math.min(this.targetTop, cpu.nTop); cpu.relCap = this.relCap;
    cpu.quality = this.quality; cpu.reduced = this.reduced;
    if (cpu.nTop !== top || cpu.total !== total) this.log(`Real sand: the CPU sand holds ${cpu.nTop} of ${cpu.total} above, the ledger ${top} of ${total}`);
    return { top: cpu.nTop, total: cpu.total };
  }

  _deviceLost(dev, info) {
    if (dev !== this.dev || this.destroyed || (info && info.reason === 'destroyed')) return;
    const lifecycle = this.hidden || this.clock.perf() - this._visibleAt < LIFECYCLE_MS;
    this._gone = true;
    if (!this.started) return;              // (start() throws 'lost')
    this._lose('device lost' + (info && info.message ? ': ' + info.message : ''), lifecycle);
  }

  /** The GPU sand is gone: the CPU takes over in this frame; rebuild unless it is the second loss in 10 minutes (7.9). */
  _lose(reason, lifecycle) {
    if (this.destroyed || this._lostInfo) return;
    const now = this.clock.perf();
    const wasLive = this.live;
    // (not ready until a rebuilt engine has drawn its settled bed: the app must not hand it the sand)
    this.live = false; this._gone = true; this._ready = false; this.n.losses++;
    this._xfer = null; this._xferGen++; this._gen++;
    this._quiet(false);
    let final = false;
    if (!lifecycle) {
      this._losses = this._losses.filter(t => now - t < LOSS_WINDOW_MS);
      this._losses.push(now);
      final = this._losses.length >= 2;
    }
    const info = { reason, lifecycle: !!lifecycle, final,
      message: final ? 'Paused after the graphics chip was reset twice; it will try again next launch'
        : lifecycle ? '' : 'Real sand paused: the graphics chip was reset' };
    this._lostInfo = info;
    this.log('Real sand: ' + reason + (lifecycle ? ' (lifecycle)' : '') + (final ? ' (final)' : ''));
    if (wasLive) this.syncCpu();
    try { this.dev && this.dev.device && this.dev.device.destroy && this.dev.device.destroy(); } catch (e) { /* (gone) */ }
    if (this.o.onLost) this.o.onLost(info);
    if (!final) this._rebuild(lifecycle ? 0 : REBUILD_MS);
  }

  /** A new device, pipelines and buffers; the CPU sand adopted; back to the app once visible. */
  async _rebuild(delayMs) {
    const sleep = this.o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    if (delayMs > 0) await sleep(delayMs);
    await this._visible();
    if (this.destroyed) return;
    this.n.rebuilds++;
    try {
      const dev = await this.engine.createDevice();
      if (this.destroyed) return;
      this._useDevice(dev);
      this.solver = await this.engine.Solver.create(this.device, this.shaders);
      this.grains = new this.engine.GrainRenderer(this.device, this.canvas, { offscreen: this.offscreen });
      await this.grains.init(this.solver.shaders);
      await this._makeToner();
      this._configure();
      this.pace = newPace();
      await this.adopt();
      await this._visible();
      if (this._gone || this.destroyed) return;
      this._lostInfo = null;
      if (this.o.onBack) this.o.onBack();
    } catch (e) {
      this.log('Real sand: could not rebuild: ' + (e && e.message || e));
      this._losses.push(this.clock.perf());
      if (this.o.onLost) this.o.onLost({ reason: 'rebuild failed', lifecycle: false, final: true,
        message: 'Real sand could not restart after the graphics chip was reset; it will try again next launch' });
    }
  }

  /** Resolves once the page is visible (setHidden, or the document's own visibilitychange: the app may hold no live RealSand then). */
  _visible() {
    const doc = globalThis.document;
    if (doc && this.hidden && !doc.hidden) this.setHidden(false);
    if (!this.hidden) return Promise.resolve();
    return new Promise(r => {
      this._visWait.push(r);
      if (doc && doc.addEventListener) {
        const on = () => { if (!doc.hidden) { doc.removeEventListener('visibilitychange', on); this.setHidden(false); } };
        doc.addEventListener('visibilitychange', on);
      }
    });
  }

  destroy() {
    this.destroyed = true; this.live = false;
    try { this.dev && this.dev.device && this.dev.device.destroy && this.dev.device.destroy(); } catch (e) { /* (gone) */ }
    if (this.canvas && this.canvas.parentNode && !this.o.canvas) this.canvas.parentNode.removeChild(this.canvas);
    for (const r of this._visWait) r();
    this._visWait = [];
  }

  /** From visibilitychange: no GPU work while hidden; a fill or transfer waits (7.7). */
  setHidden(hidden) {
    hidden = !!hidden;
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden && !this.started) this._hiddenInStart = true;
    if (hidden) this._quiet(false);
    if (!hidden) {
      this._visibleAt = this.clock.perf();
      this._lastNow = 0; this._lastDrawn = 0; this._acc = 0; this._lastRunPerf = null;
      this._redraw = true;                  // (iOS may have let the canvas's picture go meanwhile)
      const w = this._visWait; this._visWait = [];
      for (const r of w) r();
    }
  }

  /** The engine has drawn its settled bed and is not lost: the app may hand it the sand (takeOver). */
  get ready() { return this._ready && !this._lostInfo && !this._gone && !this.destroyed; }
  get points() { return this.valve.points; }

  /* ---------------------------------------------------------------------------------------- *
   *  The Sim contract: counts and the glass
   * ---------------------------------------------------------------------------------------- */
  get nTop() { return this._mid ? this._mid.shown : this.valve.nTop; }
  get total() { return this.valve.total; }
  get nBottom() { return this.total - this.nTop; }
  get capacity() { return this.cpu.capacity; }
  get fillMax() { return this.cpu.fillMax; }
  get maxTotal() { return this.cpu.maxTotal; }
  get geo() { return this.cpu.geo; }
  get G() { return this.cpu.G; }
  get W() { return this.cpu.W; }
  get H() { return this.cpu.H; }
  get gy() { return Math.cos(this.angle + this.tilt); }
  get frame() { return this.cpu.frame; }
  get nev() { return this.cpu.nev; }
  set nev(v) { this.cpu.nev = v; }
  get evX() { return this.cpu.evX; }
  get evV() { return this.cpu.evV; }
  get evK() { return this.cpu.evK; }
  get cracks() { return this.cpu.cracks; }
  get warnSeg() { return this.cpu.warnSeg; }
  get escX() { return this.cpu.escX; }
  get escY() { return this.cpu.escY; }
  get escVX() { return this.cpu.escVX; }
  get escVY() { return this.cpu.escVY; }
  get escS() { return this.cpu.escS; }
  /** Grains spilled from the glass: none in Real sand (it does not crack, section 12). */
  get lost() { return 0; }
  census() { const top = this.nTop, total = this.total; return { top, bottom: total - top, total }; }
  /** Grains of each tone (layered sand: design 7.4 fills this from the readbacks). */
  tones() { return this._tones ? this._tones.slice() : [this.total, 0]; }
  /**
   * How shaken the sand is (0 ... 3), as the CPU Sim's: the hotter bed's granular temperature, from
   * the beds' own motion in the readbacks (_hear); fading when none comes, 0 asleep, hidden or lost.
   */
  agitation() {
    if (!this._heard()) return 0;
    const a = this.agit, T = a[0] > a[1] ? a[0] : a[1];
    if (!(T > 0)) return 0;
    const late = (this.clock.perf() - this._snd.heardAt - SND.HOLD_MS) / 1000;
    if (!(late > 0)) return T;
    const v = T * Math.exp(-late / this.K.TAU_T);
    return v < this.K.IDLE_T ? 0 : v;
  }
  /** The skater effect: each bed's mean r^2 per grain, as at the last fill (app cells^2). */
  inertiaZ() { return this.nTop * this._r2[0] + this.nBottom * this._r2[1]; }

  /* ---------------------------------------------------------------------------------------- *
   *  The Sim contract: CPU events (the count changes at once)
   * ---------------------------------------------------------------------------------------- */
  /** A new glass of n grains, all above (as the CPU Sim's reset): the GPU's fill from its lattice, now or when visible. */
  reset(n) {
    this._finishMid();
    const cpu = this.cpu;
    cpu.reset(n);
    this.angle = 0; this.flipping = false; this.targetTop = cpu.nTop;
    this._xfer = null; this._xferGen++; this._xferPours = []; this._xferPourPts = 0;
    if (this.solver && !this.hidden && !this._gone) this._upload(cpu.nTop, cpu.total);
    else { this.valve.fill(cpu.nTop, cpu.total); this._fillDue = true; this.n.deferred++; }
  }

  /** The swap (swapEnds, tiltSwap, turnedUnseen): the ledger at once, the GPU at its next run's flip pass; the CPU Sim's glass turns with it. */
  completeFlip() {
    this._finishMid();
    this.valve.completeFlip();
    this.cpu.completeFlip();
    this.angle = 0; this.flipping = false;
    this._swapAt = this._wall(); this.n.swaps++;
    if (this.layers) this._turnedLayers();
  }

  /** The catch-up: the ledger drops by n at once; the GPU moves the sand by a transfer at the next submit (7.6). */
  fastForward(n) {
    this._finishMid();
    return this.valve.fastForward(n);
  }

  /** + Sand: n grains, fewer at the brim, at maxTotal or the buffer's room; the points are appended now (3.2, 7.3). */
  pour(n) {
    this._finishMid();
    const v = this.valve, sol = this.solver;
    n = Math.max(0, Math.floor(fin(n)));
    if (!n) return 0;
    const room = sol ? sol.maxParticles - sol.count - this._xferPourPts : Infinity;
    const g = this.glass;
    const k = v.pourable(n, { maxTotal: this.cpu.maxTotal, room: this._fillDue ? undefined : room, inlet: this._fillDue ? undefined : g.cy + g.HBc });
    if (!k) return 0;
    const r = v.pour(k);
    // layered sand: poured in layers of their own, each in the other tone (sand/sim.js _pourLayer)
    const bits = this.layers ? this._lay.plan.pourBits(r.grains) : -1;
    if (r.points && sol) {
      const recs = this._pourPoints(r.points, bits);
      if (this._fillDue) { /* the fill to come holds them */ }
      // (while any transfer is on its way its upload holds them: its readback was queued before them)
      else if (r.append && !this._xfer) sol.append(recs, r.points, r.mirrored);
      else { this._xferPours.push({ recs, parity: v.parity }); this._xferPourPts += r.points; }
    }
    this._pourAt = this._wall(); this.n.pours++;
    this._landing(r.grains, 0.25, true);
    return r.grains;
  }

  /**
   * Records for n poured points at the top bulb's far end, x within 2.75 app cells of the axis,
   * moving toward the neck (7.3); bits: layered sand's tone (bit 7) for them all, or -1 (none).
   */
  _pourPoints(n, bits = -1) {
    const g = this.glass, s = this.s, r = this._rng, pts = [], seeds = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = g.cx + (r() - 0.5) * 5.5 * s;
        y = g.cy + g.HBc - (3 + r() * 3 + tries * 0.5) * s;
        if (sampleField(g, x, y)[2] > 0.45) break;
      }
      pts.push(x, y); seeds.push(bits >= 0 ? ((r() * 128) | 0) | bits : (r() * 256) | 0);
    }
    const data = packParticles(pts, MATERIAL, seeds);
    const dt = 1 / this.rate.hz;
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_WORDS;
      data[o + 2] = (r() - 0.5) * 30 * s * dt;
      data[o + 3] = -(70 + r() * 70) * s * dt;
    }
    // (all above: the tone pass is not to take them for crossings)
    markSides(data, n, g.cy, this.valve.parity);
    return data;
  }

  /**
   * Layered sand on or off (design 7.4): the CPU Sim, brought to the ledger's counts, lays its
   * strata (or forgets them), and every GPU point takes the tone of the CPU's grain at its depth
   * in its column (a readback, re-toned, uploaded: a transfer that moves nothing), behind the
   * app's soft swap.
   */
  setLayers(on) {
    on = !!on;
    this.cpu.setLayers(on);
    const was = this.layers;
    this.layers = on;
    if (on === was) return;
    if (this.live) this.syncCpu();
    this._lay.pats = null; this._lay.until = -Infinity;
    if (this.solver && !this._gone) this._retoneDue = true;
  }

  /* ---------------------------------------------------------------------------------------- *
   *  The Sim contract: the frame, the field, motion
   * ---------------------------------------------------------------------------------------- */
  beginFrame() {
    this.cpu.beginFrame();
    this._planned = false;
  }

  /** One of the app's 120 Hz steps: the frame's count moves on by a part (design 3.4). */
  step() {
    if (!this._planned) this._plan();
    if (this._pend) this._push(this._pend);
    const m = this._mid;
    if (m && m.k < m.K) { m.k++; this._shown(m.from + Math.round((m.to - m.from) * m.k / m.K)); }
    this._motionNow();
  }

  /** The valve's count for this frame, from the app's fields and the clock (first step, or submit). */
  _plan() {
    this._planned = true;
    const T = this.T, now = this._wall(), perf = this.clock.perf();
    const st = T ? T.state : 'idle';
    if (st !== this._lastState) {
      if (st === 'running') this._runStart = now;
      if (st === 'done') this._endAt = now;
      this._lastState = st;
    }
    const K = this._planPerf === null ? 2 : Math.max(1, Math.min(6, Math.round((perf - this._planPerf) * 0.12)));
    this._planPerf = perf; this._planNow = now;
    const before = this.valve.nTop;
    const pl = this.valve.plan({ now, target: this.targetTop, gateOpen: this.gateOpen, deepRelease: this.deepRelease, relCap: this.relCap,
      flipping: this.flipping, gy: this.gy, rem: T ? T.rem : Infinity, tailMs: T ? T.tailMs : 0, steps: K });
    this._mid = { from: before, to: pl.top, shown: before, k: 0, K };
  }
  _shown(v) {
    const m = this._mid;
    if (v < m.shown) this.cpu.frame.released += m.shown - v;
    m.shown = v;
  }
  /** The frame's count reached at once (before an event, and at submit). */
  _finishMid() {
    const m = this._mid;
    if (!m) return;
    this._shown(m.to);
    this._mid = null;
  }

  /**
   * The glass's linear acceleration the sand feels (g, page frame, y down, before the free fall
   * and the rotation: composeField's fx, fy), at the app's step time tS (ms). Played to the sand
   * in the mode this.jolts (felt.mjs: live by default; plain under Reduce Motion), its knees in
   * the frame of the sand's gravity (on the page at angle + tilt - rho: upside down after a
   * turn-over, on its side), turned into the glass by rho, the free fall added unplayed, scaled by
   * G: the field's felt part for the GPU's substeps near tS (design 5.2).
   */
  feel(tS, fx, fy, air, rho) {
    fx = fin(fx); fy = fin(fy); rho = fin(rho);
    this.felt.opt.mode = this.reduced ? 'plain' : (JOLT_MODES.includes(this.jolts) ? this.jolts : JOLT_MODES[0]);
    const j = this.felt.feel(fx, fy, this.K.DT, fin(tS) / 1000, true, this._lam > 0 ? this._lam : LAM0, this.angle + this.tilt - rho);
    const c = Math.cos(rho), s = Math.sin(rho), G = this.cpu.G;
    const px = j[0], py = j[1] - (air ? 0.9 : 0);
    const smp = this._pend || this._takeSample();
    smp.t = fin(tS); smp.ax = G * (px * c + py * s); smp.ay = G * (-px * s + py * c);
    smp.a = Math.hypot(fx, fy); smp.felt = true;
    this._pend = smp;
  }

  /** The felt field (setMotion as the CPU Sim's): w, al, lam always; ax, ay only in a step with no feel(). */
  setMotion(ax, ay, w, al, lam, gz) {
    let smp = this._pend;
    if (!smp) {
      smp = this._takeSample();
      const last = this._latest();
      smp.t = last ? Math.min(this.clock.perf(), last.t + 1000 * this.K.DT) : this.clock.perf();
      smp.ax = fin(ax); smp.ay = fin(ay); smp.a = Math.hypot(smp.ax, smp.ay) / this.cpu.G; smp.felt = false;
    }
    smp.w = fin(w); smp.al = fin(al);
    lam = fin(lam); if (lam > 0) this._lam = lam;
    smp.lam = this._lam;
    this._push(smp);
  }
  setCarry(kx, ky) { this._carry = [fin(kx), fin(ky)]; }

  _blankSample() { return { t: -Infinity, theta: 0, parity: 0, ax: 0, ay: 0, a: 0, w: 0, al: 0, lam: LAM0, felt: false, used: false }; }
  _takeSample() { return this._blankSample(); }
  _push(smp) {
    smp.theta = this.angle + this.tilt; smp.parity = this.valve.parity;
    if (!smp.lam) smp.lam = this._lam;
    this._smp[this._smpN % SAMPLES] = smp; this._smpN++;
    this._pend = null;
    if (smp.a > this._peakA) this._peakA = smp.a;
    this._lastW = smp.w; this._lastAl = smp.al;
    const G = this.cpu.G;
    for (let b = 0; b < 2; b++) { this.bf[2 * b] = G * Math.sin(smp.theta) + smp.ax; this.bf[2 * b + 1] = G * Math.cos(smp.theta) + smp.ay; }
  }
  _latest() { return this._smpN ? this._smp[(this._smpN - 1) % SAMPLES] : null; }
  /** The newest sample at or before t (ms; the earliest kept when all are later), or null. */
  _sampleAt(t) {
    const n = Math.min(this._smpN, SAMPLES);
    let best = null;
    for (let i = 1; i <= n; i++) {
      const smp = this._smp[(this._smpN - i) % SAMPLES];
      best = smp;
      if (smp.t <= t) return smp;
    }
    return best;
  }

  /** Felt motion over the power modes' thresholds held 0.3 s, or a lean of 3 degrees within 0.5 s (design 9.1). */
  _motionNow() {
    const smp = this._latest();
    if (!smp) { this._motion = false; return; }
    const t = smp.t, M = MODES;
    const over = smp.a >= M.ACC_G || Math.abs(smp.w) >= M.W || Math.abs(smp.al) >= M.ALPHA;
    if (over) { if (this._overSince === null) this._overSince = t; } else this._overSince = null;
    const L = this._leans;
    L.push({ t, v: smp.theta });
    while (L.length > 2 && t - L[0].t > M.LEAN_MS) L.shift();
    let lo = Infinity, hi = -Infinity;
    for (const l of L) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); }
    this._motion = (this._overSince !== null && t - this._overSince >= M.FELT_MS) || (hi - lo) * 180 / Math.PI >= M.LEAN_DEG;
  }
  /** The app's lastMotionAt: RealSand's own thresholds (a phone held still in the hand does not count). */
  motionActive() { return this._motion; }

  /** False only while asleep with nothing owed and nothing to draw again. */
  isActive() {
    if (this._gone && !this.live) return false;
    return this.modes.mode !== 'asleep' || this._wake || this._fillDue || !!this.valve.xfer || !!this._xfer ||
      this.valve.flipPending || this.flipping || !!this._sweep || this._redraw || this._retoneDue;
  }
  /** A glass asleep wakes only when its lean has changed by more than 1 degree since it fell asleep (9.1). */
  wakeAll() {
    const m = this.modes;
    if (m.mode !== 'asleep' || m.sleepLean === null) return;
    const d = this.angle + this.tilt - m.sleepLean;
    if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI > MODES.WAKE_DEG) this._wake = true;
  }

  /* ---------------------------------------------------------------------------------------- *
   *  The Sim contract: blows and damage (the glass does not crack in Real sand, section 12)
   * ---------------------------------------------------------------------------------------- */
  /** A blow of v px/s: 1 (it thumps and clacks, as a creaking blow) from 700 px/s, else 0; no damage. */
  impact(nx, ny, v) {
    // (a blow jolts the sand: awake, and full for a while, whatever it does to the glass)
    this._wake = true; this.modes.busyUntil = Math.max(this.modes.busyUntil, this._wall() + MODES.HOLD_MS);
    return fin(v) >= this.K.IMPACT_V ? 1 : 0;
  }
  knock() { return -1; }
  flick() { return 0; }
  shake() { return -1; }
  sealCracks() { return this.cpu.sealCracks(); }
  segInfo(seg, out) { return this.cpu.segInfo(seg, out); }
  serializeDamage() { return this.cpu.serializeDamage(); }
  restoreDamage(o) { return this.cpu.restoreDamage(o); }
  forceCrack(seg, L, w) { return this.cpu.forceCrack(seg, L, w); }

  /* ---------------------------------------------------------------------------------------- *
   *  Drawing: the canvas, the palette, the sweep
   * ---------------------------------------------------------------------------------------- */
  _makeCanvas() {
    if (this.canvas) return;
    const doc = globalThis.document, cs = this.o.cSand;
    if (!doc) { this.canvas = { style: {}, width: 1, height: 1 }; return; }
    const c = doc.createElement('canvas');
    c.id = 'c-gpu';
    if (cs && cs.parentNode) cs.parentNode.insertBefore(c, cs.nextSibling);
    else if (this.o.rotor) this.o.rotor.appendChild(c);
    this.canvas = c;
  }

  /** #c-gpu takes #c-sand's CSS box; its backing store at the device's pixels, under 4.2 Mpx (design 6.1). */
  layout() {
    const c = this.canvas, cs = this.o.cSand;
    if (!c) return;
    let cssW = 0, cssH = 0;
    if (cs && cs.style) {
      for (const k of ['width', 'height', 'left', 'top']) c.style[k] = cs.style[k];
      c.style.position = 'absolute';
      cssW = parseFloat(cs.style.width) || 0; cssH = parseFloat(cs.style.height) || 0;
    }
    if (!(cssW > 0 && cssH > 0)) { cssW = this.cpu.W * 1.5; cssH = this.cpu.H * 1.5; }
    let dpr = Math.max(1, Math.min(globalThis.devicePixelRatio || 1, 3));
    while (cssW * dpr * cssH * dpr > 4.2e6 && dpr > 1) dpr -= 0.25;
    // (setting a canvas's width or height, even to the same value, clears its picture: only when it changes)
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr)), o = this._css;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    if (o.w !== cssW || o.h !== cssH || o.dpr !== dpr || o.bw !== w || o.bh !== h) this._redraw = true;
    this._css = { w: cssW, h: cssH, dpr, bw: w, bh: h };
  }

  /** The grains' palette from the Renderer's table (its theme, layered sand), design 6.2. */
  setPalette() {
    if (!this.grains) return;
    const R = this.view;
    const fromLUT = Pal.paletteFromLUT || paletteFromLUT;
    this.grains.setPalette(R && R.lut && R.isMica ? fromLUT(R.lut, R.isMica) : Pal.palette('coarse'));
    this._palKey = this._paletteKey();
    this._redraw = true;
  }
  /** A few of the table's colours at the palette's light level: when they change, so has the sand's colour. */
  _paletteKey() {
    const lut = this.view && this.view.lut;
    if (!lut) return 0;
    let k = 0;
    for (let s = 0; s < 256; s += 17) k = (Math.imul(k, 31) + (lut[(21 << 8) | s] | 0)) | 0;
    return k;
  }

  /**
   * The Reset transition (design 6.5), beside the Renderer's (glass/renderer.js setSweep): kind 1, the
   * old sand drawn into the neck (frozen: draw-only runs); 2, the new bed (the fill reset()
   * made between the two) revealed from the neck up under a rising surface, with the thread
   * that pours it; 0, done. p runs from 0 to 1 in each.
   */
  setSweep(kind, p) {
    p = Math.min(1, Math.max(0, fin(p)));
    if (!kind) { this._sweep = null; this._sweepFill = null; return; }
    if (kind === 1 && (!this._sweep || this._sweep.kind !== 1)) this._sweepFar = this._farthest();
    this._sweep = { kind, p };
  }

  /**
   * How far from the neck the farthest grain lies, squared, grid cells (the drawn glass's): each
   * bed taken as filling its bulb from where it rests (the top from the neck, the lower from its
   * far end) with its points, plus one app cell, as the CPU's sweep adds one (glass/renderer.js _swFar).
   */
  _farthest() {
    const g = this.glass, v = this.valve, per = PPC * PPC;
    const reach = (pts, fromNeck) => {
      let cells = pts / per, y = fromNeck ? 0 : g.HBc, far = 0;
      while (cells > 0 && y >= 0 && y <= g.HBc) {
        cells -= 2 * g.half(y) * 0.5;
        const h = g.halfDrawn(y);
        far = Math.max(far, y * y + h * h);
        y += fromNeck ? 0.5 : -0.5;
      }
      return far;
    };
    const top = v.Pts(this.nTop), bot = v.Pts(this.nBottom);
    return Math.max(top > 0 ? reach(top, true) : 0, bot > 0 ? reach(bot, false) : 0) + this.s * this.s;
  }

  /**
   * The new bed's top-bulb points for the sweep's second half: their heights and drawn distances
   * from the axis (grid), every k-th of them (at most 4,096: the apex's bisection runs each frame).
   */
  _sweepPoints(pts, nTop) {
    const g = this.glass, k = Math.max(1, Math.ceil(nTop / 4096)), m = Math.ceil(nTop / k);
    const ys = new Float32Array(m), ax = new Float32Array(m);
    for (let q = 0; q < m; q++) {
      const i = q * k, x = pts[2 * i], y = pts[2 * i + 1], j = Math.min(g.H - 1, Math.max(0, Math.floor(y)));
      ys[q] = y; ax[q] = Math.abs(x - g.cx) * (g.warp ? g.warp[j] : 1);
    }
    return { n: m, ys, ax };
  }

  /** The sweep's look for grains.mjs encode (grid units), as glass/renderer.js _sweepOut and _sweepIn draw it. */
  _sweepLook() {
    const sw = this._sweep, g = this.glass, s = this.s;
    if (!sw) return null;
    if (sw.kind === 1) return { kind: 1, S: this._sweepFar * Math.pow(sw.p, 1.5), min: SWEEP_MIN * s * s };
    const F = this._sweepFill;
    if (!F) return null;
    const p = sw.p;
    let v = (p - 0.08) / 0.78; v = v < 0 ? 0 : (v > 1 ? 1 : v);           // the share of the sand that has come
    const want = v * F.n, slope = 0.62 * Math.sqrt(1 - v);                // heaped under the thread (32 degrees), level at the end
    const tip = g.cy + g.HBc;
    let apex = tip + 1e4;
    if (v < 1) {
      // the apex (grid y) of the heap that shows `want` of the bed's points: bisection
      const count = A => { let c = 0; for (let i = 0; i < F.n; i++) if (F.ys[i] <= A - slope * F.ax[i]) c++; return c; };
      let lo = g.cy, hi = tip + slope * g.Rc + 1;
      for (let k = 0; k < 24; k++) { const A = (lo + hi) / 2; if (count(A) >= want) hi = A; else lo = A; }
      apex = want > 0 ? hi : g.cy;
    }
    // the thread: its first grains fall from the top of the bulb, it pours, its last grains fall
    const span = tip - g.cy;
    const head = tip - span * Math.min(1, p / 0.09), tail = tip - span * Math.max(0, (p - 0.85) / 0.11);
    const lo = Math.max(head, Math.min(apex, tip) + 0.5 * s), hi = tail;
    const share = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.2);
    // (the CPU's thread is about 2.4 grains abreast a row: so many, spread over its length)
    const n = hi > lo ? Math.min(THREAD_MAX, Math.ceil(2.4 * (hi - lo) / s)) : 0;
    return { kind: 2, apex, slope, thread: { lo, hi, spread: 2.5 * s, share, n, frame: this._sweepFrame++ } };
  }

  /** The glass's angle on screen (the rotor's CSS turn), rad: the room's light is turned back by it. */
  _rotorAngle() {
    const r = this.o.rotor, t = r && r.style ? r.style.transform : '';
    const m = t ? /rotate\(\s*(-?[0-9.eE+-]+)rad\)/.exec(t) : null;
    return m ? fin(parseFloat(m[1])) : 0;
  }

  /** What encode() draws with this frame: the grid onto #c-gpu's box of the app's lattice, the grain, the blur. */
  _look(hz) {
    const s = this.s, g = this.glass, W = this.cpu.W, H = this.cpu.H, css = this._css;
    const kx = 2 / (s * W), ky = 2 / (s * H);
    const scale = css.w > 0 ? css.w / W : 1;                 // CSS px per app cell
    const rpx = Math.max(RC / s * scale, 0.75 / css.dpr);
    return {
      m: [kx, 0, 0, ky], o: [-g.cx * kx, -g.cy * ky], r: [2 * rpx / Math.max(1, css.w), 2 * rpx / Math.max(1, css.h)],
      liquid: false, exposure: exposure(BLUR, this._displayMs(), hz), flight: FLIGHT,
      // the room's light turned back by the glass's angle on screen; the Reset's sweep (design 6.2, 6.5)
      light: this._rotorAngle(), sweep: this._sweepLook()
    };
  }

  /** The swap frame (6.6): while the canvas holds a picture from before a swap, it is turned half a turn. */
  _turnCss() {
    const turn = this._drawnParity !== this.valve.parity;
    if (turn === this._cssTurned || !this.canvas) return;
    this.canvas.style.transform = turn ? 'rotate(180deg)' : '';
    this._cssTurned = turn;
    if (turn) this.n.cssTurns++;
  }

  /* ---------------------------------------------------------------------------------------- *
   *  The frame's GPU work (design 5.1, 9)
   * ---------------------------------------------------------------------------------------- */
  /** Once an active app frame, in place of renderer.drawSand(): this frame's substeps and drawing. */
  submit(now) {
    if (!this._planned) this._plan();
    this._finishMid();
    this._planned = false;
    now = fin(now);
    this._rafLog.push(now);
    if (this._rafLog.length > 61) this._rafLog.shift();
    this._sound(now);
    if (!this.live || this.hidden || this.destroyed) return;
    // (the Renderer's table rebuilt by anything else than a theme or the layers switch, a sand of
    // its own: the grains take its colours at once)
    if (this.grains && this._paletteKey() !== this._palKey) this.setPalette();
    try { this._submit(now); } catch (e) {
      this.n.errors++;
      this.log('Real sand: ' + (e && e.stack || e));
      this._lose('error: ' + (e && e.message || e), false);
    }
  }

  _submit(now) {
    const v = this.valve, wall = this._planNow, perf = this.clock.perf();
    const dtReal = this._lastNow ? Math.min((now - this._lastNow) / 1000, 0.25) : 1 / 60;
    this._lastNow = now;
    paceValve(this.pace, perf);
    if (v.stalled()) { this._lose('no readback for ' + v.unread + ' runs', false); return; }
    // a transfer in flight holds the runs; abandoned after 1 s (7.6)
    if (this._xfer) {
      if (wall - this._xfer.t0 > XFER_TIMEOUT_MS) this._xferAbandon('timeout');
      else { this._turnCss(); return; }
    }
    if (this._fillDue) this._upload(Math.max(0, v.nTop - (v.xfer ? v.xfer.hold : 0)), v.total);
    if (v.xfer) { this._startTransfer('catch-up'); this._turnCss(); return; }
    if (v.residueDue(wall)) { v.fastForward(v.nTop); this.n.residues++; this._startTransfer('residue'); this._turnCss(); return; }
    // the layers switch: every point re-toned from a readback (7.4)
    if (this._retoneDue) { this._retoneDue = false; this._startTransfer('retone'); this._turnCss(); return; }
    // the power mode: asleep runs nothing; calm draws every other frame at the same rate
    const before = this.modes.mode, mode = this._modeFor(wall);
    this._wake = false;
    if (before === 'asleep' && mode !== 'asleep' && this.modes.why === 'jolt') this._fromJolt(now, dtReal);
    if (this.modes.guard !== this._guardOn) this._guardSays(this.modes.guard, now, mode);
    if (mode === 'asleep') {
      this.n.asleep++; this._lastDrawn = 0; this._acc = 0; this._lastRunPerf = null;
      if (before !== 'asleep') this._quiet(false);                       // (a sleeping glass is silent)
      // a new palette, a resized canvas, back from hidden: drawn again, with no substep and no change of mode
      if (this._redraw && this.pace.inflight < QUEUE) { this.n.redraws++; this._run(0, this.rate.hz, wall, now, true, this._displayMs()); this._lastRunPerf = null; }
      this._turnCss();
      return;
    }
    const T0 = this._displayMs(), Tm = frameMsFor(mode, T0);
    paceFrame(this.pace, Tm);
    if (mode === 'calm' && this._lastDrawn && now - this._lastDrawn < Tm - 0.5 * T0) {
      this.n.calmSkips++;
      this._acc = Math.min(this._acc + dtReal, this._capFrame() / this.rate.hz);
      this._turnCss();
      return;
    }
    // the GPU is behind: skip this frame rather than queue more
    if (this.pace.inflight >= QUEUE || this.solver.readbacks.every(r => r.pending)) {
      paceSkip(this.pace, perf); this.n.skips++;
      const avail = this._acc + dtReal;
      this._acc = Math.min(avail, this._capFrame() / this.rate.hz);
      this._behind += avail - this._acc;
      this._turnCss();
      return;
    }
    const since = this._lastDrawn ? (now - this._lastDrawn) / 1000 : dtReal;
    this._lastDrawn = now;
    paceBudget(this.pace, { now: perf, need: Math.ceil(SET.hz * Tm / 1000), top: Rate.capTop(SET), last: this._lastSteps });
    this._chooseRate(mode, Tm, perf);
    const hz = this.rate.hz, cap = this._capFrame();
    const available = this._acc + dtReal;
    this._acc = Math.min(available, cap / hz);
    const dropped = available - this._acc;
    this._behind += dropped;
    let steps = Math.min(cap, Math.floor((this._acc + 1e-9) * hz));
    this._acc -= steps / hz;
    // the Reset's first phase: the old sand frozen while it is drawn into the neck
    if (this._sweep && this._sweep.kind === 1) { steps = 0; this._acc = 0; }
    this._run(steps, hz, wall, now, true, Tm);
    const gpuHeld = dropped > 1e-6 && cap < Rate.capNow(SET, this.rate);
    this.pace.binding = gpuHeld || !!this.rate.held;
    this._frames.push({ t: now, sim: steps / hz, real: since, steps, hz, mode });
    while (this._frames.length && now - this._frames[0].t > 4000) this._frames.shift();
  }

  /**
   * Woken from asleep by a jolt: the first run starts from the jolt's first sample (the first at
   * or over the felt-motion threshold within the frame's cap of substeps), not from this frame,
   * so that its push is not lost (the samples hold half a second): its substeps are the time since.
   */
  _fromJolt(now, dtReal) {
    const span = 1000 * this._capFrame() / this.rate.hz, n = Math.min(this._smpN, SAMPLES);
    let from = null;
    for (let i = 1; i <= n; i++) {
      const smp = this._smp[(this._smpN - i) % SAMPLES];
      if (now - smp.t > span) break;
      if (smp.a >= MODES.ACC_G) from = smp.t;
    }
    if (from === null) return;
    this._lastRunPerf = Math.max(now - span, from - 0.001);
    this._acc = Math.max(0, (now - this._lastRunPerf) / 1000 - dtReal);
    this.n.jolts++;
  }

  /** One run: the valve's words, the field of each substep, the solver, the drawing, one submit. */
  _run(steps, hz, wall, perfNow, draw, Tm) {
    const v = this.valve, sol = this.solver;
    const w = v.run({ steps, now: wall, simDt: steps / hz });
    const fields = this._fields(steps, perfNow, hz);
    const set = this._set(hz);
    const gen = this._gen, parity = v.parity;
    this._toneField = fields[fields.length - 1];
    w.snd = this._runSound(steps, hz, fields);
    const p = sol.run(steps, set, k => fields[Math.min(k, fields.length - 1)], draw ? enc => this.grains.encode(enc, sol.count, this._look(hz)) : null, w);
    if (draw) { this._drawnParity = v.parity; this._turnCss(); this._redraw = false; }
    const tSim = this.simTime, seq = paceSubmit(this.pace, this.clock.perf()), tSub = this.clock.perf();
    this._lastSteps = steps; this._lastRunPerf = perfNow; this.n.runs++;
    const pace = this.pace;
    this.device.queue.onSubmittedWorkDone().then(() => {
      const ms = this.clock.perf() - tSub;
      if (draw && !this._ready && gen === this._gen) this._firstFrame();
      paceDone(pace, seq, steps, ms, Tm || 1000 / 60);
    }, () => { paceDone(pace, seq, 0, 0, Tm || 1000 / 60); });
    if (p) p.then(t => { if (t && gen === this._gen) this._onTally(w, t, tSim, parity); }, () => { this.n.readbackFails++; });
    if (draw && this.grains.present) this.grains.present();
    return w;
  }

  /** The first GPU frame is drawn: ready (the boot veil may lift); its time from the page's start and from start(), logged (Gate A). */
  _firstFrame() {
    this._ready = true;
    // (after a rebuild: ready again; the start's own times are kept for the report)
    if (this._firstFrameAt !== null) { this.log('Real sand: the rebuilt engine drew its first frame'); return; }
    this._firstFrameAt = this.clock.perf();
    this.times.firstFrame = this._firstFrameAt;
    this.times.firstFrameFromStart = this._firstFrameAt - (this.times.start || 0);
    this.log('Real sand: first frame ' + Math.round(this.times.firstFrame) + ' ms after the page\'s start (' + Math.round(this.times.firstFrameFromStart) + ' ms after start())');
  }

  _set(hz) { return { hz, iterations: SET.iterations, maxStep: SET.maxStep, coriolis: SET.coriolis, material: MATERIAL }; }

  /** Each substep's field (design 5.2): the newest app sample at or before its time, in the run's orientation. */
  _fields(steps, perfNow, hz) {
    const n = Math.max(1, steps), out = new Array(n), P = this.valve.parity;
    const p1 = perfNow, p0 = this._lastRunPerf === null ? p1 - 1000 / 60 : Math.max(this._lastRunPerf, p1 - 250);
    for (let k = 0; k < n; k++) {
      const t = p0 + (p1 - p0) * (k + 1) / n;
      out[k] = this._fieldOf(this._sampleAt(t), P);
    }
    this.simTime += steps / hz;
    return out;
  }
  /** The solver's field from an app sample (vessel frame, y down, app cells/s^2) in parity P: grid y up, solver cells. */
  _fieldOf(smp, P) {
    if (!smp) return this._uprightField();
    const G = this.cpu.G, sg = smp.parity === P ? 1 : -1;
    const gx = sg * (G * Math.sin(smp.theta) + smp.ax), gy = sg * (G * Math.cos(smp.theta) + smp.ay);
    const lam = smp.lam > 0 ? smp.lam : this._lam, rl = Math.sqrt(lam);
    return { gravity: [this.s * gx, -this.s * gy], omega: -smp.w * rl, alpha: -smp.al * lam, cor: rl, gate: false };
  }
  _uprightField() {
    const th = this.angle + this.tilt, G = this.Gg;
    return { gravity: [G * Math.sin(th), -G * Math.cos(th)], omega: 0, alpha: 0, cor: Math.sqrt(this._lam), gate: false };
  }

  _capFrame() { const c = Rate.capNow(SET, this.rate); return Number.isFinite(this.pace.budget) ? Math.max(1, Math.min(c, this.pace.budget)) : c; }

  /** Auto Hz from the fastest crowded point (a falling stream does not ask for it), held by the GPU's budget; off in calm. */
  _chooseRate(mode, Tm, perf) {
    const t = this._tally, tt = t ? (t._crowd || (t._crowd = { maxSpeed: t.crowdSpeed || 0 })) : null;
    const jolt = Math.hypot(this.felt.jx, this.felt.jy) * this.Gg * 0.05;
    const hzCap = Number.isFinite(this.pace.budget) ? this.pace.budget * 1000 / Tm : Infinity;
    Rate.chooseRate(this.rate, tt, { s: mode === 'calm' ? SET_CALM : SET, jolt, time: this.simTime, hzCap, now: perf });
  }

  /** The display's frame, ms: the median time between this page's frames over the last second (4 to 100). */
  _displayMs() {
    const r = this._rafLog, d = [];
    for (let i = 1; i < r.length; i++) { const x = r[i] - r[i - 1]; if (x > 0 && x < 100) d.push(x); }
    if (d.length < 3) return 1000 / 60;
    d.sort((a, b) => a - b);
    return Math.max(4, Math.min(100, d[d.length >> 1]));
  }
  /** Simulated over real time over the last second of frames drawn (NaN: under half a second of them). */
  _ratio(now) {
    let sim = 0, real = 0;
    const F = this._frames;
    for (let i = F.length - 1; i >= 0 && now - F[i].t <= 1000; i--) { sim += F[i].sim; real += F[i].real; }
    return real >= 0.5 ? sim / real : NaN;
  }

  /** The power mode (modes.mjs) from what the glass and its clock are doing (design 9.1, no economy). */
  _modeFor(wall) {
    const T = this.T, v = this.valve, t = this._tally;
    const still = !!t && t.moving <= 3;
    const st = T ? T.state : 'idle';
    const running = st === 'running', draining = st === 'done' && v.nTop > 0;
    let busy = '';
    if (this.flipping) busy = 'turning';
    else if (this._sweep) busy = 'sweep';
    else if (wall - this._pourAt < 200) busy = 'pour';
    else if (v.flipPending) busy = 'swap';
    else if (wall < this._settleUntil) busy = 'settling';
    else if (running && this._runStart !== null && wall - this._runStart < MODES.START_MS) busy = 'start';
    else if (running && T && T.rem < T.tailMs + 300) busy = 'tail';
    else if (st === 'done' && (draining || wall - this._endAt < MODES.HOLD_MS)) busy = 'end';
    const smp = this._latest();
    // (peak: the hardest felt since the last frame, so that a jolt between two frames counts)
    const felt = smp ? { a: smp.a, peak: this._peakA, w: smp.w, alpha: smp.al, lean: smp.theta } : { a: 0, peak: this._peakA, w: 0, alpha: 0, lean: this.angle + this.tilt };
    this._peakA = 0;
    const lastNow = this._rafLog.length ? this._rafLog[this._rafLog.length - 1] : 0;
    return chooseMode(this.modes, { now: wall, setting: this.modeSetting, busy, felt, active: running || draining || !still, still,
      pending: !!(this.flipping || v.flipPending || v.xfer || this._fillDue), ratio: this._ratio(lastNow), atBase: this.rate.hz === SET.hz });
  }

  /** The heat guard tripped (calm from now) or was lifted (a new bed): logged with the time, for Gate B's reports (design 9.1). */
  _guardSays(on, now, mode) {
    this._guardOn = on;
    if (on) this.n.guards++;
    const r = this._ratio(now), at = new Date(this.clock.wall()).toISOString().slice(11, 19);
    this.log(`Real sand: the heat guard ${on ? 'tripped (calm from now)' : 'lifted'} at ${at} UTC: sim/real ${Number.isFinite(r) ? r.toFixed(2) : '-'}, ${mode}, ${this.rate.hz} Hz`);
  }

  /** A run's readback: to the ledger, auto Hz, the modes, the first fall's log, layered sand's counts. */
  _onTally(w, t, tSim, parity) {
    this.valve.onReadback(w.seq, t);
    t.simTime = tSim;
    this._tally = t;
    this._endsOf(w, t);
    if (t.post && this.layers) this._toneCounts(toneWords(t.post), parity === undefined ? this.valve.parity : parity);
    this._hear(w, t, parity === undefined ? this.valve.parity : parity);
    const F = this._fall;
    if (F.from === null && t.crossings > 0 && t.below === t.crossings) { F.from = tSim; F.wallFrom = w.to; }
    else if (F.from !== null && !(F.s >= 0) && t.deepest >= F.floor - 1.5) {
      F.s = tSim - F.from; F.wall = w.to - F.wallFrom;
      F.log.push({ s: F.s, wall: F.wall, hz: this.rate.hz, mode: this.modes.mode });
      if (F.log.length > 8) F.log.shift();
      this.log(`Real sand: the stream's first fall ${F.s.toFixed(2)} s simulated, ${(F.wall / 1000).toFixed(2)} s on the clock (${this.modes.mode}, ${this.rate.hz} Hz)`);
    }
  }

  /**
   * Exact time for the report (stats(); the lab's timerReadback does the same for its Timer): the
   * membrane's promise in every open run, nothing across a shut neck, the ledger's audit, and the
   * end: the first readback with no point above at or after the clock's 00:00.0 holds the
   * substep of the last crossing (tally lastCross), given as a span of the clock's time.
   */
  _endsOf(w, t) {
    const E = this._ends;
    E.runs++;
    if (w && w.targets) {
      if (w.closed) E.shutCross += t.crossings;
      else if (t.crossings > 0) {
        let m = Infinity;
        for (let i = 0; i < w.targets.length; i++) m = Math.min(m, w.targets[i]);
        if (t.above < m) E.below++;
      }
    }
    const a = this.valve.audit();
    if (a) { E.audits++; if (!a.ok) E.auditFails++; }
    const z = this.valve.endAt;
    if (z !== null && Number.isFinite(z) && z !== E.lastFor && t.above === 0 && w && w.to >= z - 1e-6) {
      E.lastFor = z;
      const S = Math.max(1, w.steps | 0), sub = (w.to - w.from) / S, k = t.lastCross;
      E.last.push(k >= 0
        ? { from: +(w.from + k * sub - z).toFixed(1), to: +(w.from + (k + 1) * sub - z).toFixed(1), substep: +sub.toFixed(2) }
        : { from: null, to: null, readAt: +(w.to - z).toFixed(1) });
      if (E.last.length > 8) E.last.shift();
    }
  }

  /** The depth from the counting line to the glass's floor on its axis, solver cells (the first fall's length). */
  _floorDepth() {
    const g = this.glass;
    let d = 0;
    while (d < g.cy - 1 && sampleField(g, g.cx, g.cy - d - 0.5)[2] > 0) d += 0.5;
    return d;
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Fills and transfers (design 7.1, 7.6, 7.7)
   * ---------------------------------------------------------------------------------------- */
  /** The field's direction on the grid now: where low is for a fill's surface. */
  _down() { const th = this.angle + this.tilt; return [Math.sin(th), -Math.cos(th)]; }

  /** A fill from the CPU lattice with top grains above of total, uploaded; the ledger takes the upload's own counts. */
  _upload(top, total) {
    const v = this.valve, cpu = this.cpu, tFill = this.clock.perf();
    top = Math.max(0, Math.min(total, Math.round(top)));
    const want = { top: v.Pts(top), bottom: v.Pts(total - top) };
    const f = fromLattice(cpu, this.glass, { top: want.top, bottom: want.bottom, down: this._down(), seed: (this._rng() * 4294967296) >>> 0 });
    const data = packParticles(f.pts, MATERIAL, f.seeds);
    const marks = markSides(data, f.top + f.bottom, this.glass.cy, v.parity);
    if (marks.above) this._lay.share = marks.above1 / marks.above;
    this._lay.debt = 0;
    // (the Reset's sweep shows this bed as it is poured in)
    if (this._sweep) this._sweepFill = this._sweepPoints(f.pts, f.top);
    const sides = this.solver.upload(data, f.top + f.bottom);
    this._toneUploaded();
    v.fill(top, total, sides.above, sides.below);
    this._fillDue = false; this.n.fills++;
    this._xferPours = []; this._xferPourPts = 0;
    this._r2 = this._meanR2(f.pts, f.top);
    this._afterUpload();
    this._redraw = true;
    this._settleUntil = this._wall() + SETTLE_S * 1000;
    this._fall.from = null; this._fall.s = NaN; this._fall.wall = NaN;
    this.times.fill = this.clock.perf() - tFill;
    return sides;
  }
  _afterUpload() {
    this._tally = null; this._gen++;
    this._quiet(true);
    paceReset(this.pace);
    Rate.rateReset(this.rate, SET.hz);
    this.felt.reset(0);
    modesReset(this.modes, this._wall());
    this._lastRunPerf = null;
  }
  /** Mean r^2 per point about the neck, each bulb, app cells^2 (for inertiaZ). */
  _meanR2(pts, nTop) {
    const g = this.glass, s2 = this.s * this.s, sum = [0, 0], cnt = [0, 0];
    for (let i = 0; i < pts.length / 2; i++) {
      const b = i < nTop ? 0 : 1, dx = pts[2 * i] - g.cx, dy = pts[2 * i + 1] - g.cy;
      sum[b] += (dx * dx + dy * dy) / s2; cnt[b]++;
    }
    const r = [cnt[0] ? sum[0] / cnt[0] : 0, cnt[1] ? sum[1] / cnt[1] : 0];
    if (!cnt[0]) r[0] = r[1]; if (!cnt[1]) r[1] = r[0];
    return r;
  }

  /** Settle a fresh bed with the neck shut: sec simulated, in runs of the cap, the last one drawn. */
  async _settle(sec) {
    let left = Math.round(sec * SET.hz);
    const T = this.T;
    while (left > 0 && !this._gone) {
      const n = Math.min(SET.cap, left);
      left -= n;
      const now = this._wall();
      this.valve.plan({ now, target: this.valve.nTop, gateOpen: false, flipping: this.flipping, gy: this.gy, rem: T ? T.rem : Infinity, tailMs: T ? T.tailMs : 0, steps: 1 });
      const w = this.valve.run({ steps: n, now, simDt: n / SET.hz });
      const f = this._uprightField(), gen = this._gen, last = left <= 0, parity = this.valve.parity;
      this._toneField = f;
      const p = this.solver.run(n, this._set(SET.hz), () => f, last ? enc => this.grains.encode(enc, this.solver.count, this._look(SET.hz)) : null, w);
      this.simTime += n / SET.hz;
      if (p) p.then(t => { if (t && gen === this._gen) this._onTally(w, t, this.simTime, parity); }, () => { this.n.readbackFails++; });
      if (last) { this._drawnParity = this.valve.parity; this._turnCss(); this._redraw = false; if (this.grains.present) this.grains.present(); }
      await this.device.queue.onSubmittedWorkDone();
      if (last && !this._ready) this._firstFrame();
    }
  }

  /**
   * The transfer (7.6): after a pending flip pass has run, every point is read back; the points
   * of the top bulb nearest the neck that the catch-up moved are laid on the lower heap in a
   * jittered 30-degree cone over its surface, those poured meanwhile go in at the top's far
   * end, and the bed is uploaded with its exact counts. Runs are held until it is done.
   */
  _startTransfer(kind) {
    const v = this.valve, gen = ++this._xferGen;
    this._xfer = { kind, t0: this._planNow, gen, parity: v.parity };
    this.n.transfers++;
    if (v.flipPending) {
      const w = v.run({ steps: 0, now: this._planNow });
      const f = this._uprightField();
      this._toneField = f;
      this.solver.run(0, this._set(this.rate.hz), () => f, null, w);
    }
    // (the points read back lie as the GPU's do now: in the ledger's orientation, parity)
    let read;
    try { read = this.solver.readParticles(); } catch (e) { read = Promise.reject(e); }
    read.then(data => this._xferDone(gen, data), e => { if (gen === this._xferGen) this._xferAbandon('readback failed: ' + (e && e.message || e)); });
  }

  _xferDone(gen, data) {
    if (gen !== this._xferGen || !this._xfer || this._gone) return;
    const v = this.valve, g = this.glass, line = Math.fround(g.cy), W = PARTICLE_WORDS, kind = this._xfer.kind;
    const n = Math.floor(data.length / W);
    // a swap while the readback was on its way: the points turned half a turn, as the flip pass would
    if (this._xfer.parity !== v.parity) this._mirror(data, n);
    // the layers switch: every point's tone afresh, by its depth from the CPU Sim's strata (7.4)
    if (kind === 'retone') {
      retoneAll(data, n, this.layers, { cpu: this.cpu, line, seed: (this._rng() * 4294967296) >>> 0,
        map: (x, y) => this._appCell(x, y) });
      this.n.retones = (this.n.retones || 0) + 1;
      this._lay.debt = 0;
    }
    const above = [];
    for (let i = 0; i < n; i++) {
      const o = i * W;
      if (data[o + 15] === 0) continue;
      const x = data[o], y = data[o + 1];
      if (x === x && y === y && Math.abs(y) < 1e9 && y > line) above.push(i);
    }
    // (a re-tone with no catch-up owed moves nothing)
    const m = v.xfer ? v.transferPlan(above.length) : 0;
    // the points nearest the neck: what would have flowed next
    above.sort((a, b) => {
      const ax = data[a * W] - g.cx, ay = data[a * W + 1] - g.cy, bx = data[b * W] - g.cx, by = data[b * W + 1] - g.cy;
      return ax * ax + ay * ay - (bx * bx + by * by);
    });
    const moved = above.slice(0, m);
    const spots = this._heapSpots(data, n, moved.length);
    const pours = this._xferPours, pourPts = this._xferPourPts;
    const out = new Float32Array((n + pourPts) * W);
    out.set(data.subarray(0, n * W));
    if (spots.length) {
      let seeds = moved.slice(0, spots.length / 2).map(i => (data[i * W + 20] | 0) & 255);
      // layered sand: laid in the schedule's tones, lowest first, as the points the GPU would have laid
      if (this.layers) {
        const L = this._lay;
        L.plan.ensure(L.known + seeds.length + 64, L.share, this._heapWide());
        const g = L.plan.give(L.known, seeds.map(sd => (sd >> 7) & 1), L.debt);
        seeds = seeds.map((sd, k) => (sd & 127) | (g.tones[k] << 7));
        L.debt = g.debt; L.known += seeds.length;
      }
      const fresh = packParticles(spots, MATERIAL, seeds);
      for (let k = 0; k < spots.length / 2; k++) out.set(fresh.subarray(k * W, (k + 1) * W), moved[k] * W);
    }
    let at = n * W;
    for (const p of pours) { if (p.parity !== v.parity) this._mirror(p.recs, p.recs.length / W); out.set(p.recs, at); at += p.recs.length; }
    markSides(out, n + pourPts, g.cy, v.parity);
    const sides = this.solver.upload(out, n + pourPts);
    this._toneUploaded();
    const target = this.T && this.T.state === 'done' ? 0 : this.targetTop;
    v.transferDone(sides.above, sides.below, target);
    this._xfer = null; this._xferPours = []; this._xferPourPts = 0;
    this._redraw = true;                    // (asleep after a re-tone: the new tones are drawn)
    // (the first fall is timed only on a stream that a transfer did not cut short: it lays sand on the floor)
    const F = this._fall;
    if (!(F.s >= 0)) { F.from = null; F.s = NaN; F.wall = NaN; }
    this._tally = null; this._gen++; this._lastRunPerf = null;
    this._quiet(true);
  }

  /** Particle records turned half a turn about the neck (the flip pass's map: a point on the line first moved 0.01 below it). */
  _mirror(data, n) {
    const g = this.glass, W = PARTICLE_WORDS, cx2 = 2 * g.cx, cy2 = 2 * g.cy, line = Math.fround(g.cy);
    for (let i = 0; i < n; i++) {
      const o = i * W;
      if (data[o + 1] === line) data[o + 1] -= 0.01;
      data[o] = cx2 - data[o]; data[o + 1] = cy2 - data[o + 1]; data[o + 2] = -data[o + 2]; data[o + 3] = -data[o + 3];
    }
  }

  /** Spots for m points on the lower heap: a jittered lattice over its surface, under a 30-degree cone sized by bisection. */
  _heapSpots(data, n, m) {
    if (m <= 0) return [];
    const g = this.glass, W = PARTICLE_WORDS, line = g.cy;
    const surf = new Float32Array(g.W).fill(g.cy - g.HBc - 1);
    for (let i = 0; i < n; i++) {
      const o = i * W, x = data[o], y = data[o + 1];
      if (data[o + 15] === 0 || !(y <= line) || !(x === x)) continue;
      const c = Math.floor(x);
      if (c >= 0 && c < g.W && y > surf[c]) surf[c] = y;
    }
    const cand = [];
    const pts = lattice(g, (x, y) => y < line - 0.6 && y > surf[Math.min(g.W - 1, Math.max(0, Math.floor(x)))] + 0.3,
      [g.cx - g.Rc, g.cy - g.HBc, g.cx + g.Rc, g.cy], (this._rng() * 4294967296) >>> 0);
    for (let i = 0; i < pts.length; i += 2) cand.push(pts[i], pts[i + 1]);
    const tan = Math.tan(30 * Math.PI / 180);
    const under = A => { let c = 0; for (let i = 0; i < cand.length; i += 2) if (cand[i + 1] < A - Math.abs(cand[i] - g.cx) * tan) c++; return c; };
    let lo = g.cy - g.HBc, hi = g.cy + g.Rc * tan;
    for (let k = 0; k < 30; k++) { const A = (lo + hi) / 2; if (under(A) >= m) hi = A; else lo = A; }
    const sel = [];
    for (let i = 0; i < cand.length; i += 2) if (cand[i + 1] < hi - Math.abs(cand[i] - g.cx) * tan) sel.push(i);
    sel.sort((a, b) => cand[a + 1] - cand[b + 1]);
    const out = [];
    for (const i of sel.slice(0, m)) out.push(cand[i], cand[i + 1]);
    return out;
  }

  /** A transfer that did not come back in time (or failed): the CPU at the ledger's counts, and the GPU filled from it. */
  _xferAbandon(why) {
    this.n.xferTimeouts++;
    this.log('Real sand: transfer abandoned (' + why + ')');
    this._xfer = null; this._xferGen++;
    const v = this.valve;
    this.syncCpu();
    this._upload(Math.max(0, v.nTop - (v.xfer ? v.xfer.hold : 0)), v.total);
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Layered sand on the GPU (design 7.4; layers.mjs, shaders/tone.wgsl)
   * ---------------------------------------------------------------------------------------- */
  /** A grid point's app cell [x, y] (continuous): drawn inside the app's neck (the warp), y down. */
  _appCell(x, y) {
    const g = this.glass, j = Math.min(g.H - 1, Math.max(0, Math.floor(y))), k = g.warp ? g.warp[j] : 1;
    return [this.cpu.W / 2 + (x - g.cx) * k / this.s, this.cpu.H / 2 - (y - g.cy) / this.s];
  }
  /** The lower heap's width at its surface, app cells (a layer is so many rows of it: sand/sim.js _layer). */
  _heapWide() { const g = this.glass; return 2 * g.halfDrawn(Math.max(0, this._drop(this.nBottom))) / this.s; }

  /** The tone pass of a run (solver.mjs post, after its tally): its flags, the schedule's table, each bulb's new pattern. */
  _tonePass(enc, n) {
    if (!this.toner || !this.layers) return;
    const L = this._lay, now = this._wall(), g = this.glass;
    const turning = this.flipping || this.gy < 0.9 || this.valve.flipPending, developing = now < L.until;
    let flags = TONE_FRESH;
    if (turning || developing) flags |= TONE_TRACK;
    if (developing && L.pats) flags |= TONE_LAY;
    L.plan.ensure(L.known + 1024, L.share, this._heapWide());
    L.plan.drop(L.known);
    const perf = this.clock.perf(), dt = this._toneAt === null ? 1 / 60 : Math.min(0.25, Math.max(0, (perf - this._toneAt) / 1000));
    this._toneAt = perf;
    const f = this._toneField || this._uprightField();
    this.toner.encode(enc, n, { flags, parity: this.valve.parity, line: g.cy, cx: g.cx, cy: g.cy, s: this.s, dt: 1 / this.rate.hz,
      gravity: f.gravity, appW: this.cpu.W, appH: this.cpu.H, trade: 1 - Math.exp(-dt / LAY_S), dither: this._rng(),
      slack: L.plan.slackAt(L.known), frame: this.n.runs,
      pats: L.pats, segs: L.plan.table(L.base, L.known) });
  }

  /** A readback's tone counts (its run's orientation, parity): how far the GPU has laid, the top bulb's share, tones(). */
  _toneCounts(tw, parity) {
    const L = this._lay;
    L.known = Math.max(L.known, L.base + tw.laid);
    L.debt = tw.debt;
    L.words = tw; L.wordsParity = parity;
    const top = parity === this.valve.parity ? [tw.above1, tw.above] : [tw.below1, tw.below];
    if (top[1] > 0) L.share = top[0] / top[1];
    const pts = tw.above + tw.below, total = this.total;
    if (pts > 0) { const t1 = Math.round(total * (tw.above1 + tw.below1) / pts); this._tones = [total - t1, t1]; }
  }

  /** After an upload: the GPU numbers its crossings from 0 again, from where the plan stands. */
  _toneUploaded() {
    const L = this._lay;
    L.base = L.known; L.words = null;
    if (this.toner) this.toner.reset(L.debt);
  }

  /**
   * A swap with layered sand: each bulb takes a pattern of its own as its sand comes to rest
   * (the CPU Sim's, drawn at its completeFlip: sand/sim.js _turned), in the share of tone 1 the
   * bulb held at the swap, for 4 s; the heap's next layers are laid another way too.
   */
  _turnedLayers() {
    const cpu = this.cpu, L = this._lay, w = L.words, st = cpu.layerState(), rec = st.rec;
    L.plan.style(); L.plan.replan(L.known);
    if (!rec || !rec[0] || !rec[1]) { L.pats = null; return; }
    // the bulb on top now was below in the orientation before the swap
    let d0 = st.duty[0], d1 = st.duty[1];
    if (w) {
      const before = L.wordsParity !== this.valve.parity;
      const nowTop = before ? [w.below1, w.below] : [w.above1, w.above], nowBot = before ? [w.above1, w.above] : [w.below1, w.below];
      if (nowTop[1] > 0) d0 = nowTop[0] / nowTop[1];
      if (nowBot[1] > 0) d1 = nowBot[0] / nowBot[1];
    }
    L.pats = [Object.assign({}, rec[0], { duty: d0 }), Object.assign({}, rec[1], { duty: d1 })];
    L.until = this._wall() + Math.max(0, this.K.LAYERS.settle) / this.K.STEP_HZ * 1000;
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Sounds (design 8): the grains released, landing after their fall
   * ---------------------------------------------------------------------------------------- */
  /** The lower bulb's area (points' cells) from its far end up, every half cell, for the heap's height. */
  _bulbTable() {
    const g = this.glass, n = Math.ceil(g.HBc * 2) + 1, a = new Float64Array(n + 1);
    for (let k = 1; k <= n; k++) a[k] = a[k - 1] + 2 * g.half(g.HBc - (k - 0.5) / 2) * 0.5;
    this._area = a;
  }
  /** The drop from the neck to the lower heap's surface, solver cells, for nb grains below. */
  _drop(nb) {
    const cells = nb * this.ppg / (PPC * PPC), a = this._area;
    let k = 0;
    while (k + 1 < a.length && a[k + 1] < cells) k++;
    return Math.max(0, this.glass.HBc - k / 2);
  }
  /** Grains released now land after their fall (impSand, impGlass, events); top: poured, they land in the upper bulb. */
  _landing(n, delayS, top) {
    if (!(n > 0)) return;
    const G = this.Gg, vc = SET.maxStep * SET.hz;
    let t = delayS, v = 0;
    if (!top) {
      const h = this._drop(this.nBottom), h0 = vc * vc / (2 * G);
      t = h > h0 ? vc / G + (h - h0) / vc : Math.sqrt(2 * h / G);
      v = Math.min(vc, Math.sqrt(2 * G * h));
    } else v = 0.4 * vc;
    this._land.push({ at: this._wall() + t * 1000, n, v, top: !!top });
  }
  _sound(raf) {
    const f = this.cpu.frame, now = this._wall();
    const rel = f.released;
    if (rel > 0) this._landing(rel, 0, false);
    const vRef = Math.sqrt(2 * this.Gg * this.glass.HBc);
    const glassy = this.nBottom < 0.02 * this.cpu.capacity;
    while (this._land.length && this._land[0].at <= now) {
      const L = this._land.shift();
      if (L.top) f.impTop += L.n; else if (glassy) f.impGlass += L.n; else f.impSand += L.n;
      for (let i = 0; i < L.n && this.cpu.nev < this.K.EV_CAP; i++) {
        const e = this.cpu.nev++;
        this.cpu.evX[e] = (this._rng() - 0.5) * 0.3;
        this.cpu.evV[e] = Math.min(1, L.v / vRef * (0.85 + 0.3 * this._rng()));
        this.cpu.evK[e] = (L.top ? 2 : 0) | (glassy && !L.top ? 0 : 1);
      }
    }
    if (this._land.length > 512) this._land.splice(0, this._land.length - 512);
    this._bedSound(f, raf);
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Sounds (design 8): the beds. What the classic Sim's record says of a moved glass (sand/sim.js:
   *  frame.thump, frame.slam, frame.slides, agitation), made from what the GPU sand did: each
   *  readback's beds (solver.mjs bedOf: each bulb's sand in a bed, its mean velocity, speeds and
   *  place), never from the phone's motion alone. Nothing here asks for a run or keeps the glass
   *  awake, and the clock's state is not looked at: idle, running, paused and done sound alike.
   * ---------------------------------------------------------------------------------------- */
  /** The GPU sand is the app's, in view and awake: only then is anything of the bed heard. */
  _heard() { return this.live && !this.hidden && !this._gone && !this.destroyed && this.modes.mode !== 'asleep'; }

  /** Nothing of the bed is heard from now: its record forgotten; fresh: a new bed settles unheard for MUTE_MS. */
  _quiet(fresh) {
    const S = this._snd;
    S.thump.fill(0); S.slam.fill(0); S.rate = 0; S.rateAt = -Infinity; S.heardAt = -Infinity;
    S.prev[0] = S.prev[1] = null; S.fall[0] = S.fall[1] = null; S.pack[0] = S.pack[1] = 0; S.loose[0] = S.loose[1] = false;
    this.agit[0] = this.agit[1] = 0;
    if (fresh) S.muteUntil = this._wall() + SND.MUTE_MS;
  }

  /**
   * What a run's readback will need of the run: its simulated time, its mean field and the
   * direction of plain gravity (grid frame, y up), and whether the glass was being turned.
   */
  _runSound(steps, hz, fields) {
    if (!(steps > 0)) return null;
    let gx = 0, gy = 0, w = 0;
    const n = Math.min(steps, fields.length);
    for (let k = 0; k < n; k++) { gx += fields[k].gravity[0]; gy += fields[k].gravity[1]; w = Math.max(w, Math.abs(fields[k].omega)); }
    const th = this.angle + this.tilt, rl = Math.sqrt(this._lam > 0 ? this._lam : LAM0);
    return { dt: steps / hz, ax: gx / n, ay: gy / n, sx: Math.sin(th), sy: -Math.cos(th), turn: this.flipping || w > SND.TURN_W * rl };
  }

  /**
   * A readback's beds, heard (t.beds: [the bulb above the line, the one below] in the run's
   * orientation, parity; w.snd: _runSound). On the classic sand's scale:
   *  - a bed is its bulb's crowded points once they are BED_MIN and BED_SHARE of the glass's: the
   *    few under the neck of a glass just started, or the last above it, are the stream's, and
   *    nothing is heard of them.
   *  - a landing. A bed that falls as one body (BODY of its points moving) with the field along
   *    the glass's axis, and is then stopped by
   *    the glass (it loses half its speed within FALL_S of its fastest, the field not having
   *    slowed it), has landed with the speed u it fell at: E = u^2 / (2 G HB), the classic's
   *    energy of a bed landing at u (its kinetic energy a grain over G times the bulb's height).
   *    On the side gravity holds the sand to, a thump; on the far end, a slam; its place, the
   *    bed's centre across the bulb. A bed stopped sideways lands nothing, as the classic sand's
   *    slip does not; nor does sand that slides down the glass's wall into the rest of the bed,
   *    the bed's mean falling while half of it is still (a fall once started that speeds up goes on).
   *  - slides: the bed's motion within itself, the summed speed of its moving points beyond the
   *    bed's own speed (a bed flying or sliding as one body slides nothing) and beyond the speed a
   *    point moves from (a bed that only creeps slides nothing), in the CPU Sim's grains and cells
   *    a second, times SLIDE_K over the square root of the bed's grains (the classic sand slides
   *    at its surface), and only of a bed that is packed and not flying along the glass as a
   *    body: thrown, it flies, and the classic sand's bed in the air slides nothing;
   *  - agitation: each bed's granular temperature follows its own acceleration over the glass (in
   *    g, the classic's measure of the field's change) with the classic's memory, and a landing
   *    heats it as the classic's does (E HB / 3); 0 once the bed is at rest.
   */
  _hear(w, t, parity) {
    const S = this._snd, q = w && w.snd, beds = t && t.beds;
    if (!beds || !q || !this._heard()) return;                // (a mock's tally with no beds; a run of no substeps; asleep)
    const perf = this.clock.perf();
    if (this._sweep || this._wall() < S.muteUntil) { S.prev[0] = S.prev[1] = null; S.fall[0] = S.fall[1] = null; return; }
    if (S.gen !== this._gen || S.parity !== parity) { S.gen = this._gen; S.parity = parity; S.prev[0] = S.prev[1] = null; S.fall[0] = S.fall[1] = null; S.pack[0] = S.pack[1] = 0; S.loose[0] = S.loose[1] = false; }
    // (no readback for a while, a stall: what was stirred has faded by the clock meanwhile, as agitation() said)
    const late = (perf - S.heardAt - SND.HOLD_MS) / 1000;
    if (late > 0) { const k = Math.exp(-late / this.K.TAU_T); this.agit[0] *= k; this.agit[1] *= k; }
    // (a readback of a run from before a swap: its bulbs are the other way up now)
    const flipped = parity !== this.valve.parity, g = this.glass, GH = this.Gg * g.HBc, HB = this.cpu.geo.HB;
    const am = Math.hypot(q.ax, q.ay) || 1, kT = 1 - Math.exp(-q.dt / this.K.TAU_T), uMin = Math.sqrt(2 * SND.E_MIN * GH);
    // (tally.wgsl: a point moves when it is faster than 2 % of a free fall over the glass in the run's field)
    const still = 0.02 * Math.sqrt(2 * Math.max(am, 1) * g.H);
    // (a few crowded points are no bed; the slides' share is of the bed's grains on the lattice it was calibrated on)
    const nMin = Math.max(SND.BED_MIN, SND.BED_SHARE * ((t.above || 0) + (t.below || 0)));
    const calPpg = PPC * PPC * SND.CAL_S * SND.CAL_S, kP = 1 - Math.exp(-q.dt / SND.PACK_T);
    let rate = 0;
    for (let gb = 0; gb < 2; gb++) {
      const bed = beds[gb], b = flipped ? 1 - gb : gb;         // b: the app's bulb, 0 the one above now
      if (!bed || !(bed.n >= nMin)) { S.prev[gb] = null; S.fall[gb] = null; S.pack[gb] = 0; S.loose[gb] = false; this.agit[b] *= 1 - kT; continue; }
      const vx = bed.vx, vy = bed.vy, sp = Math.hypot(vx, vy);
      const moving = bed.sliding > Math.max(3, 0.01 * bed.n);
      // how packed the bed is (the share of its bulb's points that are crowded), against how packed
      // it has lately been: the heap under a running stream is never all crowded, a bed thrown loose
      // was packed a moment ago, and stays loose until it has packed again
      const N = gb ? t.below : t.above, r = N > 0 ? bed.n / N : 1;
      const ref = S.pack[gb] > r ? S.pack[gb] + (r - S.pack[gb]) * kP : r;
      S.pack[gb] = ref;
      if (r < SND.PACK_LO * ref) S.loose[gb] = true; else if (r >= SND.PACK_HI * ref) S.loose[gb] = false;
      // (... or it flies along the glass as a body, as the classic sand's bed in the air)
      const flies = S.loose[gb] || (sp > uMin && Math.abs(vy) >= SND.AXIS * sp);
      const pk = flies ? 0 : Math.max(0, Math.min(1, (r / ref - SND.PACK_LO) / (SND.PACK_HI - SND.PACK_LO)));
      // slides: the moving points' speed beyond the bed's own, and beyond the speed a point moves from
      if (bed.sliding > 3) rate += pk * Math.max(0, bed.slide - bed.sliding * Math.max(sp, still)) / Math.sqrt(Math.max(SND.SLIDE_K * SND.SLIDE_K, bed.n / calPpg));
      // a landing
      let E = 0, F = S.fall[gb];
      if (q.turn) F = null;
      else if (F && sp <= F.u) {
        F.push += (q.ax * F.dx + q.ay * F.dy) * q.dt; F.t += q.dt;
        const u = vx * F.dx + vy * F.dy;
        if (F.t > SND.FALL_S + 1e-6) F = null;                 // (too late: it slowed, it did not land)
        else if (u <= 0.5 * F.u) {
          // (stopped by the glass, not slowed by the field: what the glass took is 0.4 of its speed and more)
          if (F.u + F.push - u >= 0.4 * F.u) {
            E = 0.5 * F.u * F.u / GH;
            const x = Math.max(-1, Math.min(1, (flipped ? -bed.x : bed.x) / g.Rc));
            if (F.dx * q.sx + F.dy * q.sy > 0) { S.thump[2 * b] += E; S.thump[2 * b + 1] = x; S.n.thumps++; }
            else { S.slam[0] += E; S.slam[1] = x; S.n.slams++; }
          }
          F = null;
        }
      } else if (sp >= uMin && vx * q.ax + vy * q.ay >= 0.5 * sp * am && Math.abs(vy) >= 0.707 * sp && (F || bed.sliding >= SND.BODY * bed.n)) F = { u: sp, dx: vx / sp, dy: vy / sp, push: 0, t: 0 };
      else if (F) F = null;
      S.fall[gb] = F;
      // the granular temperature
      const P = S.prev[gb];
      let D = P && moving && !q.turn ? Math.hypot(vx - P[0], vy - P[1]) / q.dt / this.Gg : 0;
      if (D > 3) D = 3;
      let T = this.agit[b] + (D - this.agit[b]) * kT + E * HB / 3;
      if (T > 3) T = 3;
      if (!moving && T < this.K.IDLE_T) T = 0;
      this.agit[b] = T;
      S.prev[gb] = [vx, vy];
    }
    S.rate = SND.SLIDE_K * rate / (this.s * this.ppg);        // (in the app's grains and cells a second)
    S.rateAt = S.heardAt = perf;
  }

  /**
   * The frame's record of the beds, from the readbacks since the last frame (submit: after the
   * app's beginFrame, before its sound); raf: the frame's own time, as the app divides by it.
   */
  _bedSound(f, raf) {
    const S = this._snd, perf = this.clock.perf();
    const dt = S.fedAt && raf > S.fedAt ? Math.min(0.1, (raf - S.fedAt) / 1000) : 1 / 60;
    S.fedAt = raf;
    if (this._heard()) {
      for (let b = 0; b < 2; b++) if (S.thump[2 * b] > 0) { f.thump[2 * b] += S.thump[2 * b]; f.thump[2 * b + 1] = S.thump[2 * b + 1]; }
      if (S.slam[0] > 0) { f.slam[0] += S.slam[0]; f.slam[1] = S.slam[1]; }
      // (the rate of the newest readback, for this frame's time: calm draws 30 runs a second, the app hears 60 frames)
      if (perf - S.rateAt <= SND.HOLD_MS) { const n = Math.round(S.rate * dt); f.slides += n; f.moved += n; }
    }
    S.thump.fill(0); S.slam.fill(0);
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Reports
   * ---------------------------------------------------------------------------------------- */
  _wall() { const T = this.T; return T && Number.isFinite(T.lastTick) ? T.lastTick : this.clock.wall(); }

  /** For ?debug=sand and the Real sand report. */
  stats() {
    const t = this._tally, v = this.valve, now = this._rafLog.length ? this._rafLog[this._rafLog.length - 1] : 0;
    const F = this._fall;
    return {
      build: BUILD, live: this.live, ready: this._ready, mode: this.modes.mode, why: this.modes.why, guard: this.modes.guard,
      hz: this.rate.hz, hzPeak: this.rate.peak, held: this.rate.held, jolts: this.felt.opt.mode, steps: this._lastSteps, budget: this.pace.budget, msStep: this.pace.msStep, inflight: this.pace.inflight,
      ratio: this._ratio(now), display: this._displayMs(), behindS: this._behind, s: this.s, ppg: this.ppg,
      points: v.points, gpuCount: this.solver ? this.solver.count : 0,
      tally: t ? { points: t.points, above: t.above, below: t.below, queue: t.queue, refused: t.refused, crossings: t.crossings, nan: t.nan, outside: t.outside, moving: t.moving } : null,
      ledger: v.stats(), fall: { s: F.s, wall: F.wall, floor: F.floor, log: F.log.slice() },
      layers: { on: this.layers, toner: !!this.toner, known: this._lay.known, share: this._lay.share, words: this._lay.words,
        developing: this._wall() < this._lay.until, tones: this.tones() },
      sound: { agit: this.agitation(), slides: this._snd.rate, thumps: this._snd.n.thumps, slams: this._snd.n.slams },
      times: Object.assign({}, this.times), n: Object.assign({}, this.n), lost: this._lostInfo,
      ends: { runs: this._ends.runs, belowTarget: this._ends.below, crossedShut: this._ends.shutCross,
        audits: this._ends.audits, auditFails: this._ends.auditFails, lastPointMs: this._ends.last.slice() }
    };
  }
  /**
   * Tests: the newest readback of this epoch against the ledger (valve.mjs audit: its points
   * above and below, with the pours made since its run, are the ledger's), and every point the
   * GPU counted in that readback is above or below the line (none lost to a NaN). (The tally's
   * own point count is from before any pour made since its run, so it is not the ledger's total.)
   */
  audit() {
    const a = this.valve.audit(), t = this._tally;
    if (a && t) { a.gpuPoints = t.points; a.ok = a.ok && t.points === t.above + t.below; }
    return a;
  }
}
