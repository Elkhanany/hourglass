/*
 * Development only, never shipped: served in place of realsand/boot.mjs by
 * app-realsand.test.js, so that the app's own loader, attachRealSand, its handover and every
 * seam run the real adapter (realsand/app-sand.mjs, class RealSand) on a page without WebGPU.
 * Only the GPU is a mock, the one of realsand-adapter.test.js: a device whose work is done a
 * frame later, a solver whose neck is the valve test's plant (tools/test/lib/realsand-plant.js:
 * the throttle with its lag and noise, the queue on the line, the membrane's tickets, the flip
 * pass), readbacks 1-3 frames late in 3 slots. Its frames are the page's animation frames, so
 * nothing of it moves while the test hides the page (the test holds requestAnimationFrame).
 *
 * The test sets, before the page loads:
 *   window.__RealsandPlant   the plant library (its CommonJS exports)
 *   window.__mock            { seed, plant, build (a stamp other than the engine's),
 *                              failStart (a start() error code), failCapability,
 *                              failTimes (only the first n starts fail),
 *                              failPlan (the n-th start fails with failPlan[n - 1], a
 *                              { code, capability }, if there is one: a start that fails
 *                              after one that went well, or two different failures in a row),
 *                              startDelay (ms of wall time before start() begins: a slow
 *                              cold start, as the pipelines' 2.8 s in a home-screen web app) }
 * and reads window.__mockEnv: { V.frame, solver (its plant, runs, uploads, flips), device
 * (loseIt), creates, starts, devices (devices opened), grains (its palettes and draws),
 * paletteFromLUT, hold (true: no GPU work completes, so runs are skipped), failDevice (true:
 * no device opens, as a rebuild that fails) }.
 *
 * The mock sand does not move when the glass is moved. A test says that it does, in two places
 * on window.__mockEnv (both null by default):
 *   tally   what the graphics chip reports of its sand: an object, or function (tally, frame)
 *           returning one, merged into every readback the mock GPU returns ({ moving: 400 } keeps
 *           the glass awake as moving sand does; the engine's own bed records go here too).
 *   feeds   what the engine tells the sound of the bed, as the classic Sim's frame record holds
 *           it: { thump: [E0, x0, E1, x1], slam: [E, x], slides: moves this frame, agit: 0 to 3 },
 *           or function (frame) returning one (or null). The mock adapter writes it over the
 *           record right after the real submit(), and only in a frame in which the engine made a
 *           run with substeps: asleep, hidden, lost or held, the engine's own rules report
 *           nothing. agitation() returns its agit in such a frame and 0 otherwise. fed counts
 *           the frames it was written in.
 */
import { RealSand, BUILD, paletteFromLUT } from './app-sand.mjs';
import * as FI from './fill.mjs';
import * as GL from './glass.mjs';
import * as SOL from './solver.mjs';

const M = window.__mock || {};
const L = window.__RealsandPlant;
const MATERIAL = SOL.MATERIALS.coarse, PW = SOL.PARTICLE_WORDS;

const env = window.__mockEnv = {
  V: { frame: 0 }, rnd: L.rng(M.seed || 5), plant: M.plant || {}, xferFrames: M.xferFrames || 1,
  hold: false, creates: 0, starts: 0, devices: 0, failDevice: false, solver: null, device: null, paletteFromLUT,
  tally: null, feeds: null, fed: 0,
  parity: () => (window.Hourglass && window.Hourglass.realSand ? window.Hourglass.realSand.valve.parity : 0)
};
let q = [];
function later(frames, fn) { q.push({ due: env.V.frame + frames, fn }); }
env.pump = function () {
  const now = env.V.frame, due = q.filter(e => e.due <= now);
  q = q.filter(e => e.due > now);
  due.forEach(e => e.fn());
};
(function tick() {
  env.V.frame++;
  if (!env.hold) env.pump();
  requestAnimationFrame(tick);
})();

function makeEngine() {
  function Device() {
    this.lost = new Promise(r => { this.loseIt = (reason, message) => r({ reason: reason || 'unknown', message: message || '' }); });
    this.queue = { onSubmittedWorkDone: () => new Promise(r => later(1, r)) };
    this.destroy = () => { this.destroyed = true; this.loseIt('destroyed'); };
  }
  let lastRd = 0;
  function Mock(device) {
    this.device = device; this.shaders = {}; this.count = 0; this.cap = 24; this.maxParticles = 0;
    this.buffers = { particles: {} }; this.readbacks = [{ pending: false }, { pending: false }, { pending: false }];
    this.runs = 0; this.appended = 0; this.uploads = 0; this.flips = 0;
    env.solver = this;
  }
  Mock.create = async device => new Mock(device);
  Mock.prototype.configure = function (glass, maxP, cap) {
    this.glass = glass; this.maxParticles = maxP; this.cap = cap;
    // (one plant for the glass: a device rebuilt after a loss finds the same sand)
    this.plant = env.plantObj || (env.plantObj = new L.Plant(env.plant || {}, env.rnd));
    if (!glass._pos) {
      const top = FI.lattice(glass, (x, y) => y > glass.cy + 0.6, [glass.cx - glass.Rc, glass.cy, glass.cx + glass.Rc, glass.cy + glass.HBc], 3);
      const bot = FI.lattice(glass, (x, y) => y < glass.cy - 0.6, [glass.cx - glass.Rc, glass.cy - glass.HBc, glass.cx + glass.Rc, glass.cy], 4);
      const sortY = a => {
        const i = []; for (let k = 0; k < a.length / 2; k++) i.push(k);
        i.sort((p, r) => a[2 * p + 1] - a[2 * r + 1]);
        const o = []; i.forEach(k => o.push(a[2 * k], a[2 * k + 1])); return o;
      };
      glass._pos = { top: sortY(top), bot: sortY(bot) };
      let d = 0; while (d < glass.cy - 1 && GL.sampleField(glass, glass.cx, glass.cy - d - 0.5)[2] > 0) d += 0.5;
      glass._floor = d;
    }
  };
  Mock.prototype.allocUniforms = function (cap) { this.cap = cap; };
  Mock.prototype.countSides = SOL.Solver.prototype.countSides;
  Mock.prototype.upload = function (data, n) {
    const sides = this.countSides(data, n);
    this.count = n; this.uploads++;
    this.plant.upload(sides.above, sides.below, env.parity());
    this.uploadSim = env.V.frame;
    return sides;
  };
  Mock.prototype.append = function (data, n, mirrored) {
    if (!(n > 0)) return 0;
    if (this.count + n > this.maxParticles) throw new RangeError('append: no room');
    for (let i = 0; i < n; i++) if (!(data[i * PW + 1] > Math.fround(this.glass.cy))) throw new RangeError('append: every point must lie above the counting line');
    this.count += n; this.appended += n;
    this.plant.append(n, mirrored);
    return n;
  };
  Mock.prototype.run = function (steps, set, fieldAt, after, neck) {
    steps = Math.min(steps, this.cap);
    for (let s = 0; s < Math.max(steps, 1); s++) this.lastField = fieldAt(s);
    if (after) after({});
    this.runs++;
    const pl = this.plant;
    let out;
    if (neck && neck.targets) {
      if (neck.flip) this.flips++;
      out = pl.run(neck, neck.from / 1000, (neck.to - neck.from) / 1000);
    } else {
      if (neck && neck.flip) { const a = pl.above; pl.above = pl.below; pl.below = a; pl.parity ^= 1; this.flips++; }
      out = { above: pl.above, below: pl.below, queue: 0, crossings: 0, start: pl.t1, refused: 0, upward: 0 };
      pl.t1 = pl.above; pl.t2 = pl.below;
    }
    const slot = this.readbacks.find(r => !r.pending);
    if (!slot) return null;
    slot.pending = true;
    const g = this.glass, P2 = g._pos;
    const brimY = out.above > 0 ? P2.top[2 * Math.min(out.above, P2.top.length / 2) - 1] : 0;
    const t = { points: out.above + out.below, above: out.above, below: out.below, outside: 0, nan: 0, clamped: 0, maxMove: 0,
      maxSpeed: 0, meanSpeed: 0, moving: (out.crossings > 0 || pl.flow > 1 || env.V.frame - this.uploadSim < 30) ? 20 : 0,
      crossings: out.crossings, start: out.start, refused: out.refused, upward: out.upward, queue: out.queue, crowdSpeed: 0,
      brim: Math.round(brimY * 16), lastCross: -1, deepest: out.below > 0 ? g._floor : 0 };
    // what the test says the chip's sand is doing
    const more = typeof env.tally === 'function' ? env.tally(t, env.V.frame) : env.tally;
    if (more) Object.assign(t, more);
    const lag = 1 + Math.floor(env.rnd() * 3);
    lastRd = Math.max(lastRd, env.V.frame + lag);
    const due = lastRd - env.V.frame;
    return new Promise(r => later(due, () => { slot.pending = false; r(t); }));
  };
  Mock.prototype.readParticles = function () {
    const pl = this.plant, g = this.glass, a = Math.min(pl.above, g._pos.top.length / 2), b = Math.min(pl.below, g._pos.bot.length / 2);
    const pts = g._pos.top.slice(0, 2 * a).concat(g._pos.bot.slice(0, 2 * b));
    const data = FI.packParticles(pts, MATERIAL);
    return new Promise(r => later(env.xferFrames, () => r(data)));
  };
  function Grains() { this.draws = 0; env.grains = this; }
  Grains.prototype.init = async function () {};
  Grains.prototype.bind = function () {};
  Grains.prototype.setPalette = function (p) { this.pal = p; this.palettes = (this.palettes || 0) + 1; };
  Grains.prototype.encode = function (enc, n, look) { this.draws++; this.look = look; };
  Grains.prototype.present = function () {};
  return {
    createDevice: async () => {
      if (env.failDevice) throw new Error('mock: the graphics device could not be opened');
      env.devices++;
      env.device = new Device();
      return { adapter: {}, device: env.device, info: { fallback: false } };
    },
    // (no tone pass: layered sand on the GPU is realsand-gpu's)
    Solver: Mock, GrainRenderer: Grains, Toner: null
  };
}

class MockSand extends RealSand {
  static async create(o) {
    env.creates++;
    return new MockSand(Object.assign({}, o, { engine: makeEngine() }));
  }
  async start() {
    env.starts++;
    const n = env.starts;
    if (M.startDelay > 0) await new Promise(r => setTimeout(r, M.startDelay));
    const planned = M.failPlan && M.failPlan[n - 1];
    if (planned) {
      const e = new Error('mock start failure: ' + planned.code);
      e.code = planned.code; e.capability = !!planned.capability;
      throw e;
    }
    if (M.failStart && !(M.failTimes > 0 && env.starts > M.failTimes)) {
      const e = new Error('mock start failure: ' + M.failStart);
      e.code = M.failStart; e.capability = !!M.failCapability;
      throw e;
    }
    return super.start();
  }
  /** The frame's GPU work as ever, then what the test says the engine tells the sound (env.feeds), where the engine ran. */
  submit(now) {
    const runs = this.n.runs;
    super.submit(now);
    const ran = this.n.runs > runs && this._lastSteps > 0 && this.live && !this.hidden;
    const F = ran ? (typeof env.feeds === 'function' ? env.feeds(env.V.frame) : env.feeds) : null;
    this._mockAgit = 0;
    if (!F) return;
    const f = this.cpu.frame;
    if (F.thump) f.thump.set(F.thump);
    if (F.slam) f.slam.set(F.slam);
    if (F.slides >= 0) f.slides = F.slides;
    if (F.agit >= 0) this._mockAgit = F.agit;
    env.fed++;
  }
  agitation() { return env.feeds ? (this._mockAgit || 0) : super.agitation(); }
}
window.__mockClass = MockSand;

const H = window.Hourglass;
if (H && typeof H.attachRealSand === 'function') H.attachRealSand(MockSand, M.build || BUILD);
