/*
 * Hourglass sand engine: RealSand, the app's adapter (design section 4).
 *
 * The app (app.js) knows one sand, the CPU Sim of physics.js, through about sixty members.
 * RealSand has the same members, so that app.js can point its one variable `sim` at it while
 * Real sand runs; behind them the sand is the GPU engine of this folder, with its metered neck.
 * The CPU Sim stays alive, not stepped: it is the glass's model (its geometry, capacity, cracks
 * and flaws), the source of every GPU fill (fill.mjs fromLattice: the bed's shape and each
 * grain's colour), the owner of the per-frame record the app and the audio read (sim.frame,
 * sim.nev and the event arrays, shared), and the instant fallback.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 *
 * ==============================================================================================
 *  THE APP'S SIDE
 * ==============================================================================================
 *  const real = await RealSand.create({ P, cpuSim, renderer, rotor, cSand, timer: T, settings,
 *                                        offscreen, onLost, onBack, log })
 *    P: window.HourglassPhysics; cpuSim: the app's Sim; renderer: its Renderer (the LUT, the
 *    scale); rotor, cSand: #rotor and #c-sand (RealSand makes #c-gpu after #c-sand and takes its
 *    CSS box); timer: the app's clock state T (state, rem, tailMs, lastTick are read);
 *    offscreen: draw into a texture and show it on a 2-D canvas (headless tests: their WebGPU
 *    canvas cannot present); allowFallback: accept a software adapter (headless tests only);
 *    onLost(info), onBack(): below.
 *  await real.start()       the device, the pipelines, the buffers, a self-test (no latency
 *                           limit: a slow start is not a failure). Throws an Error with code,
 *                           message and capability (true: WebGPU or a usable adapter is missing,
 *                           so the setting is cleared; false: retry at the next launch).
 *  await real.adopt()       the GPU bed from the CPU Sim's lattice and counts now, settled 0.4 s
 *                           (simulated) with the neck shut; ready is true once it is drawn.
 *  real.takeOver()          the app now uses real as its sim (sim = real, between two frames):
 *                           RealSand takes the CPU Sim's angle, tilt and turn, and fills again
 *                           if the CPU sand was poured, turned or reset meanwhile; grains the CPU
 *                           released meanwhile are owed and leave through the valve.
 *  Each frame, as app.js's frame() runs (design 5.1): the clock, pours (pour), swaps
 *  (completeFlip), the valve's fields (gateOpen, deepRelease, targetTop, relCap, flipping),
 *  isActive(), beginFrame(), the catch-up (fastForward), the 120 Hz steps (feel, setMotion,
 *  step), then submit(now) in place of renderer.drawSand(). The count the app reads (nTop)
 *  follows the clock at the first step of the frame and moves to the frame's count over its
 *  steps; the GPU's run for the frame is encoded in submit.
 *  real.setHidden(hidden)   from visibilitychange: no GPU work while hidden.
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
 *  WHAT IS LEFT TO OTHERS (stage 1b)
 * ==============================================================================================
 *  The drawing's own changes (design 6.2-6.5: the seed palette in the shader, the neck warp,
 *  the room's light, the Reset sweep on the GPU) read the look encode() is given here (warp,
 *  turn, sweep); layered sand on the GPU (7.4) fills setLayers, tones() and the pour's tone.
 */
import { buildGlass, sampleField } from './glass.mjs';
import { Solver, ShaderLibrary, createDevice, MATERIALS, PARTICLE_WORDS } from './solver.mjs';
import { newPace, paceReset, paceSkip, paceBudget, paceFrame, paceSubmit, paceDone, paceValve, QUEUE_DEFAULT } from './pace.mjs';
import { PPC, lattice, packParticles, fromLattice, rand32 } from './fill.mjs';
import { GrainRenderer, FLIGHT, exposure } from './grains.mjs';
import * as Rate from './rate.mjs';
import { GlassFelt } from './felt.mjs';
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
const IMPACT_V = 700;                      // px/s: a blow from this speed thumps (physics.js impV[0])
const LIFECYCLE_MS = 1000;                 // a loss within this long of becoming visible is a lifecycle event (7.9)
const REBUILD_MS = 2000;                   // after a loss that is not, rebuild after this long
const LOSS_WINDOW_MS = 600000;             // a second such loss within 10 minutes is final
const LAM0 = 0.09;                         // the app's lambda before it has said one (G / g at the glass's size)
const DT = 1 / 120;                        // the app's step
const RC = 0.36;                           // a grain's radius, solver cells (the lab's)
const BLUR = 1;                            // a grain in flight streaks over one display frame
const SAMPLES = 64;                        // the app's field samples kept (half a second at 120 Hz)
const EV_CAP = 48;                         // landings a frame for the audio (physics.js EV_CAP)
const SELF_TEST_POINTS = 500;

const ENGINE = { createDevice, Solver, GrainRenderer, ShaderLibrary };

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
    this.cpu = opts.cpuSim;
    this.view = opts.renderer || null;
    this.T = opts.timer || null;
    this.engine = Object.assign({}, ENGINE, opts.engine || {});
    this.clock = opts.clock || { wall: () => Date.now(), perf: () => performance.now() };
    this.log = opts.log || (() => {});
    this.offscreen = !!opts.offscreen;
    this.shaderBase = opts.shaderBase || new URL('./shaders/', import.meta.url);
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
    this.glass = opts.glass || buildGlass({ s: this.s, neckMin: 5.5, geo, profile: this.P ? this.P.profile : undefined });
    this.Gg = this.s * cpu.G;                // gravity at app speed, solver cells/s^2
    this._bulbTable();
    this.valve = new Valve({ ppg: this.ppg });
    this.valve.fill(cpu.nTop, cpu.total);
    // the frame's state
    this.pace = newPace();
    this.rate = Rate.newRate(SET.hz);
    this.felt = new GlassFelt();
    this.modes = newModes();
    this.modeSetting = 'auto';
    this.simTime = 0;
    this._smp = []; for (let i = 0; i < SAMPLES; i++) this._smp.push(this._blankSample());
    this._smpN = 0; this._pend = null; this._lam = LAM0; this._lastW = 0; this._lastAl = 0;
    this._overSince = null; this._leans = []; this._motion = false;
    this._planned = false; this._planNow = 0; this._planPerf = null; this._mid = null;
    this._lastState = this.T ? this.T.state : 'idle'; this._runStart = null; this._endAt = -Infinity;
    this._pourAt = -Infinity; this._swapAt = -Infinity; this._settleUntil = -Infinity; this._wake = false;
    this._sweep = null; this._fillDue = false; this._xfer = null; this._xferGen = 0; this._xferPours = []; this._xferPourPts = 0;
    this._lastNow = 0; this._lastDrawn = 0; this._acc = 0; this._lastSteps = 0; this._lastRunPerf = null; this._behind = 0;
    this._rafLog = []; this._frames = [];
    this._drawnParity = this.valve.parity; this._cssTurned = false;
    this._land = []; this._r2 = [0, 0];
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
    this.times = { start: null, device: null, pipelines: null, selfTest: null, selfTestRun: null, firstFrame: null };
    this.n = { runs: 0, skips: 0, calmSkips: 0, asleep: 0, cssTurns: 0, transfers: 0, xferTimeouts: 0, residues: 0, fills: 0,
      deferred: 0, readbackFails: 0, losses: 0, rebuilds: 0, pours: 0, swaps: 0, errors: 0, refills: 0 };
    this._rng = rand32((cpu.rng | 0) ^ 0x5bd1e995);
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Start, adopt, hand over, lose, rebuild
   * ---------------------------------------------------------------------------------------- */
  /** The device, the pipelines, the buffers and the self-test (design 10.1). */
  async start() {
    const perf = () => this.clock.perf(), t0 = perf();
    this.times.start = t0;
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
    const t1 = perf();
    try {
      this.solver = await this.engine.Solver.create(this.device, this.shaderBase);
      this._makeCanvas();
      this.grains = new this.engine.GrainRenderer(this.device, this.canvas, { offscreen: this.offscreen });
      await this.grains.init(this.solver.shaders);
    } catch (e) {
      const msg = String(e && e.message || e);
      throw startError(/Could not load|fetch|HTTP/i.test(msg) ? 'load' : 'compile', 'The sand engine could not be loaded: ' + msg, false, e);
    }
    this.times.pipelines = perf() - t1;
    this._configure();
    await this._selfTest();
    if (this._gone) throw startError('lost', 'The graphics chip was reset while Real sand started');
    if (this.hidden) throw startError('hidden', 'The page was hidden while Real sand started');
    this.started = true;
    this.log('Real sand: started in ' + Math.round(perf() - t0) + ' ms (device ' + Math.round(this.times.device) + ', pipelines ' +
      Math.round(this.times.pipelines) + ', self-test ' + Math.round(this.times.selfTest) + ')');
  }

  _useDevice(dev) {
    this.dev = dev; this.device = dev.device; this._gone = false;
    const d = dev;
    if (d.device && d.device.lost && d.device.lost.then) d.device.lost.then(info => this._deviceLost(d, info), () => {});
  }

  /** Buffers for the largest glass the app allows, uniform slots for the highest rate, the palette. */
  _configure() {
    const maxP = Math.ceil(this.valve.Pts(this.cpu.maxTotal) * 1.05) + 1024;
    this.solver.configure(this.glass, maxP, Rate.capAlloc(SET));
    this.grains.bind(this.solver.buffers.particles);
    if (this.grains.setWarp) this.grains.setWarp(this.glass.warp);
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
  }

  /** The app makes RealSand its sim (between two frames). */
  takeOver() {
    const cpu = this.cpu, v = this.valve, A = this._adopted;
    this.angle = fin(cpu.angle); this.tilt = fin(cpu.tilt); this.flipping = !!cpu.flipping;
    this.gateOpen = !!cpu.gateOpen; this.deepRelease = !!cpu.deepRelease; this.targetTop = cpu.targetTop; this.relCap = fin(cpu.relCap);
    this.quality = cpu.quality; this.reduced = !!cpu.reduced;
    // poured, turned or made new while the engine settled: the bed is the CPU's again (its own flow is owed)
    if (!A || cpu.total !== v.total || (cpu.glassFlip | 0) !== A.flip || cpu.nTop > v.nTop) {
      this.n.refills++;
      this._upload(cpu.nTop, cpu.total);
    }
    this._adopted = null;
    this.live = true;
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
    this.live = false; this._gone = true; this.n.losses++;
    this._xfer = null; this._xferGen++; this._gen++;
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
      this.solver = await this.engine.Solver.create(this.device, this.shaderBase);
      this.grains = new this.engine.GrainRenderer(this.device, this.canvas, { offscreen: this.offscreen });
      await this.grains.init(this.solver.shaders);
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
    if (!hidden) {
      this._visibleAt = this.clock.perf();
      this._lastNow = 0; this._lastDrawn = 0; this._acc = 0; this._lastRunPerf = null;
      const w = this._visWait; this._visWait = [];
      for (const r of w) r();
    }
  }

  get ready() { return this._ready; }
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
  agitation() { return 0; }
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
    if (r.points && sol) {
      const recs = this._pourPoints(r.points);
      if (this._fillDue) { /* the fill to come holds them */ }
      else if (r.append) sol.append(recs, r.points, r.mirrored);
      else { this._xferPours.push(recs); this._xferPourPts += r.points; }
    }
    this._pourAt = this._wall(); this.n.pours++;
    this._landing(r.grains, 0.25, true);
    return r.grains;
  }

  /** Records for n poured points at the top bulb's far end, x within 2.75 app cells of the axis, moving toward the neck (7.3). */
  _pourPoints(n) {
    const g = this.glass, s = this.s, r = this._rng, pts = [], seeds = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = g.cx + (r() - 0.5) * 5.5 * s;
        y = g.cy + g.HBc - (3 + r() * 3 + tries * 0.5) * s;
        if (sampleField(g, x, y)[2] > 0.45) break;
      }
      pts.push(x, y); seeds.push((r() * 256) | 0);
    }
    const data = packParticles(pts, MATERIAL, seeds);
    const dt = 1 / this.rate.hz;
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_WORDS;
      data[o + 2] = (r() - 0.5) * 30 * s * dt;
      data[o + 3] = -(70 + r() * 70) * s * dt;
    }
    return data;
  }

  setLayers(on) {
    this.cpu.setLayers(on);
    this.layers = !!on;
    if (this.retone) this.retone(this.layers);
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
   * The glass's linear acceleration the sand feels (g, page frame, before the free fall and the
   * rotation: composeField's fx, fy), at the app's step time tS (ms). Played through the lab's
   * slowed playback of jolts (felt.mjs), turned into the glass by rho, the free fall added
   * unplayed, scaled by G: the field's felt part for the GPU's substeps near tS (design 5.2).
   */
  feel(tS, fx, fy, air, rho) {
    fx = fin(fx); fy = fin(fy);
    const j = this.felt.feel(fx, fy, DT, fin(tS) / 1000, true, this._lam > 0 ? this._lam : LAM0);
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
      smp.t = last ? Math.min(this.clock.perf(), last.t + 1000 * DT) : this.clock.perf();
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

  /** False only while asleep with nothing owed. */
  isActive() {
    if (this._gone && !this.live) return false;
    return this.modes.mode !== 'asleep' || this._wake || this._fillDue || !!this.valve.xfer || !!this._xfer ||
      this.valve.flipPending || this.flipping || !!this._sweep;
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
  impact(nx, ny, v) { return fin(v) >= IMPACT_V ? 1 : 0; }
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
    c.width = Math.max(1, Math.round(cssW * dpr)); c.height = Math.max(1, Math.round(cssH * dpr));
    this._css = { w: cssW, h: cssH, dpr };
  }

  /** The grains' palette from the Renderer's table (its theme, layered sand), design 6.2. */
  setPalette() {
    if (!this.grains) return;
    const R = this.view;
    const fromLUT = Pal.paletteFromLUT || paletteFromLUT;
    this.grains.setPalette(R && R.lut && R.isMica ? fromLUT(R.lut, R.isMica) : Pal.palette('coarse'));
  }

  /** The Reset transition (design 6.5): kind 1 the old sand drawn into the neck (frozen), 2 the new revealed, 0 done. */
  setSweep(kind, p) { this._sweep = kind ? { kind, p: fin(p) } : null; }

  /** What encode() draws with this frame: the grid onto #c-gpu's box of the app's lattice, the grain, the blur. */
  _look(hz) {
    const s = this.s, g = this.glass, W = this.cpu.W, H = this.cpu.H, css = this._css;
    const kx = 2 / (s * W), ky = 2 / (s * H);
    const scale = css.w > 0 ? css.w / W : 1;                 // CSS px per app cell
    const rpx = Math.max(RC / s * scale, 0.75 / css.dpr);
    return {
      m: [kx, 0, 0, ky], o: [-g.cx * kx, -g.cy * ky], r: [2 * rpx / Math.max(1, css.w), 2 * rpx / Math.max(1, css.h)],
      liquid: false, exposure: exposure(BLUR, this._displayMs(), hz), flight: FLIGHT,
      // for the drawing's own steps (design 6.2, 6.5): the neck's warp per grid row, the
      // glass's turn (the room's light is turned back by it), the Reset's sweep
      warp: g.warp, turn: this.angle, sweep: this._sweep
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
    this._sound();
    if (!this.live || this.hidden || this.destroyed) return;
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
    // the power mode: asleep runs nothing; calm draws every other frame at the same rate
    const mode = this._modeFor(wall);
    this._wake = false;
    if (mode === 'asleep') { this.n.asleep++; this._lastDrawn = 0; this._acc = 0; this._lastRunPerf = null; this._turnCss(); return; }
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

  /** One run: the valve's words, the field of each substep, the solver, the drawing, one submit. */
  _run(steps, hz, wall, perfNow, draw, Tm) {
    const v = this.valve, sol = this.solver;
    const w = v.run({ steps, now: wall, simDt: steps / hz });
    const fields = this._fields(steps, perfNow, hz);
    const set = this._set(hz);
    const gen = this._gen;
    const p = sol.run(steps, set, k => fields[Math.min(k, fields.length - 1)], draw ? enc => this.grains.encode(enc, sol.count, this._look(hz)) : null, w);
    if (draw) { this._drawnParity = v.parity; this._turnCss(); }
    const tSim = this.simTime, seq = paceSubmit(this.pace, this.clock.perf()), tSub = this.clock.perf();
    this._lastSteps = steps; this._lastRunPerf = perfNow; this.n.runs++;
    const pace = this.pace;
    this.device.queue.onSubmittedWorkDone().then(() => {
      const ms = this.clock.perf() - tSub;
      if (draw && !this._ready && gen === this._gen) this._firstFrame();
      paceDone(pace, seq, steps, ms, Tm || 1000 / 60);
    }, () => { paceDone(pace, seq, 0, 0, Tm || 1000 / 60); });
    if (p) p.then(t => { if (t && gen === this._gen) this._onTally(w, t, tSim); }, () => { this.n.readbackFails++; });
    if (draw && this.grains.present) this.grains.present();
    return w;
  }

  /** The first GPU frame is drawn: ready (the boot veil may lift); its time from the page's start and from start(), logged (Gate A). */
  _firstFrame() {
    this._ready = true; this._firstFrameAt = this.clock.perf();
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
    const felt = smp ? { a: smp.a, w: smp.w, alpha: smp.al, lean: smp.theta } : { a: 0, w: 0, alpha: 0, lean: this.angle + this.tilt };
    const lastNow = this._rafLog.length ? this._rafLog[this._rafLog.length - 1] : 0;
    return chooseMode(this.modes, { now: wall, setting: this.modeSetting, busy, felt, active: running || draining || !still, still,
      pending: !!(this.flipping || v.flipPending || v.xfer || this._fillDue), ratio: this._ratio(lastNow), atBase: this.rate.hz === SET.hz });
  }

  /** A run's readback: to the ledger, auto Hz, the modes, the first fall's log. */
  _onTally(w, t, tSim) {
    this.valve.onReadback(w.seq, t);
    t.simTime = tSim;
    this._tally = t;
    const F = this._fall;
    if (F.from === null && t.crossings > 0 && t.below === t.crossings) { F.from = tSim; F.wallFrom = w.to; }
    else if (F.from !== null && !(F.s >= 0) && t.deepest >= F.floor - 1.5) {
      F.s = tSim - F.from; F.wall = w.to - F.wallFrom;
      F.log.push({ s: F.s, wall: F.wall, hz: this.rate.hz, mode: this.modes.mode });
      if (F.log.length > 8) F.log.shift();
      this.log(`Real sand: the stream's first fall ${F.s.toFixed(2)} s simulated, ${(F.wall / 1000).toFixed(2)} s on the clock (${this.modes.mode}, ${this.rate.hz} Hz)`);
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
    const v = this.valve, cpu = this.cpu;
    top = Math.max(0, Math.min(total, Math.round(top)));
    const want = { top: v.Pts(top), bottom: v.Pts(total - top) };
    const f = fromLattice(cpu, this.glass, { top: want.top, bottom: want.bottom, down: this._down(), seed: (this._rng() * 4294967296) >>> 0 });
    const data = packParticles(f.pts, MATERIAL, f.seeds);
    const sides = this.solver.upload(data, f.top + f.bottom);
    v.fill(top, total, sides.above, sides.below);
    this._fillDue = false; this.n.fills++;
    this._xferPours = []; this._xferPourPts = 0;
    this._r2 = this._meanR2(f.pts, f.top);
    this._afterUpload();
    this._settleUntil = this._wall() + SETTLE_S * 1000;
    if (this._fall.log) { this._fall.from = null; this._fall.s = NaN; this._fall.wall = NaN; }
    return sides;
  }
  _afterUpload() {
    this._tally = null; this._gen++;
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
      const f = this._uprightField(), gen = this._gen, last = left <= 0;
      const p = this.solver.run(n, this._set(SET.hz), () => f, last ? enc => this.grains.encode(enc, this.solver.count, this._look(SET.hz)) : null, w);
      this.simTime += n / SET.hz;
      if (p) p.then(t => { if (t && gen === this._gen) this._onTally(w, t, this.simTime); }, () => { this.n.readbackFails++; });
      if (last) { this._drawnParity = this.valve.parity; this._turnCss(); if (this.grains.present) this.grains.present(); }
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
    this._xfer = { kind, t0: this._planNow, gen };
    this.n.transfers++;
    if (v.flipPending) {
      const w = v.run({ steps: 0, now: this._planNow });
      const f = this._uprightField();
      this.solver.run(0, this._set(this.rate.hz), () => f, null, w);
    }
    let read;
    try { read = this.solver.readParticles(); } catch (e) { read = Promise.reject(e); }
    read.then(data => this._xferDone(gen, data), e => { if (gen === this._xferGen) this._xferAbandon('readback failed: ' + (e && e.message || e)); });
  }

  _xferDone(gen, data) {
    if (gen !== this._xferGen || !this._xfer || this._gone) return;
    const v = this.valve, g = this.glass, line = Math.fround(g.cy), W = PARTICLE_WORDS;
    const n = Math.floor(data.length / W);
    const above = [];
    for (let i = 0; i < n; i++) {
      const o = i * W;
      if (data[o + 15] === 0) continue;
      const x = data[o], y = data[o + 1];
      if (x === x && y === y && Math.abs(y) < 1e9 && y > line) above.push(i);
    }
    const m = v.transferPlan(above.length);
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
      const seeds = moved.slice(0, spots.length / 2).map(i => data[i * W + 20]);
      const fresh = packParticles(spots, MATERIAL, seeds);
      for (let k = 0; k < spots.length / 2; k++) out.set(fresh.subarray(k * W, (k + 1) * W), moved[k] * W);
    }
    let at = n * W;
    for (const recs of pours) { out.set(recs, at); at += recs.length; }
    const sides = this.solver.upload(out, n + pourPts);
    const target = this.T && this.T.state === 'done' ? 0 : this.targetTop;
    v.transferDone(sides.above, sides.below, target);
    this._xfer = null; this._xferPours = []; this._xferPourPts = 0;
    this._tally = null; this._gen++; this._lastRunPerf = null;
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
  _sound() {
    const f = this.cpu.frame, now = this._wall();
    const rel = f.released;
    if (rel > 0) this._landing(rel, 0, false);
    const vRef = Math.sqrt(2 * this.Gg * this.glass.HBc);
    const glassy = this.nBottom < 0.02 * this.cpu.capacity;
    while (this._land.length && this._land[0].at <= now) {
      const L = this._land.shift();
      if (L.top) f.impTop += L.n; else if (glassy) f.impGlass += L.n; else f.impSand += L.n;
      for (let i = 0; i < L.n && this.cpu.nev < EV_CAP; i++) {
        const e = this.cpu.nev++;
        this.cpu.evX[e] = (this._rng() - 0.5) * 0.3;
        this.cpu.evV[e] = Math.min(1, L.v / vRef * (0.85 + 0.3 * this._rng()));
        this.cpu.evK[e] = (L.top ? 2 : 0) | (glassy && !L.top ? 0 : 1);
      }
    }
    if (this._land.length > 512) this._land.splice(0, this._land.length - 512);
  }

  /* ---------------------------------------------------------------------------------------- *
   *  Reports
   * ---------------------------------------------------------------------------------------- */
  _wall() { const T = this.T; return T && Number.isFinite(T.lastTick) ? T.lastTick : this.clock.wall(); }

  /** For ?debug=sand and the owner's reports. */
  stats() {
    const t = this._tally, v = this.valve, now = this._rafLog.length ? this._rafLog[this._rafLog.length - 1] : 0;
    const F = this._fall;
    return {
      build: BUILD, live: this.live, ready: this._ready, mode: this.modes.mode, why: this.modes.why, guard: this.modes.guard,
      hz: this.rate.hz, steps: this._lastSteps, budget: this.pace.budget, msStep: this.pace.msStep, inflight: this.pace.inflight,
      ratio: this._ratio(now), display: this._displayMs(), behindS: this._behind, s: this.s, ppg: this.ppg,
      points: v.points, gpuCount: this.solver ? this.solver.count : 0,
      tally: t ? { points: t.points, above: t.above, below: t.below, queue: t.queue, refused: t.refused, crossings: t.crossings, nan: t.nan, outside: t.outside, moving: t.moving } : null,
      ledger: v.stats(), fall: { s: F.s, wall: F.wall, floor: F.floor, log: F.log.slice() },
      times: Object.assign({}, this.times), n: Object.assign({}, this.n), lost: this._lostInfo
    };
  }
  /** Tests: the newest readback of this epoch against the ledger (valve.mjs audit), and the GPU's points. */
  audit() {
    const a = this.valve.audit();
    if (a && this._tally) { a.gpuPoints = this._tally.points; a.ok = a.ok && this._tally.points === a.total; }
    return a;
  }
}
