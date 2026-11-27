#!/usr/bin/env node
/*
 * Real sand's adapter (realsand/app-sand.mjs, class RealSand) in Node, without a browser or a
 * GPU: its engine is a mock whose neck is the valve test's plant (tools/test/lib/realsand-plant.js:
 * the throttle with its lag and noise, the queue on the line, the membrane's tickets, the flip
 * pass; readbacks 1 to 3 frames late), and the app around it is a copy of app.js's frame() in
 * the order the design gives (5.1): the clock, pours, swaps, the valve's fields, isActive,
 * beginFrame, the catch-up, the 120 Hz steps (feel, setMotion, step), submit.
 *
 * Checks:
 *  - the engine contract: every name app.js and audio.js bind to a sand engine (sim, cpuSim,
 *    real, realEng, eng, realCls; audio's sim), read from their code, equals the lists here
 *    (a member used and not listed, or listed and no longer used, fails; a copy of app.js
 *    with sim.foo and realEng.bar is the control). It reads `name.member` on those six names
 *    only: an engine held under another name (var e = realEng; e.foo()) or a member in
 *    brackets (sim['foo']) is not seen. The CPU Sim has the Sim's members and RealSand
 *    has them with the CPU Sim's types, and its own; the shared ones are the CPU Sim's own
 *    objects (frame, geo, the event arrays, cracks);
 *  - the glass built from the app's geometry and the fills from the CPU lattice: exact point
 *    counts above and below, every point inside the glass and on its side of the line, each
 *    point's seed the CPU grain's under it;
 *  - each clock site of design 3.6, each on a glass run to its end, with the last point out
 *    within a frame or two of 00:00.0 (by the plant's record), never before it by more than a
 *    substep, and nTop never 0 while a point is above: the start (a finished glass started
 *    again: a Flip), the Flip's swap (nTop = total - nTop at once, the time remAt of it), a tilt
 *    swap (real motion, the clock stopped on its side), a pour (the ledger by exactly n grains,
 *    the GPU by exactly the appended points, the time remAt(topAt + made)), a re-time after a
 *    shake that starved the neck, a sequence's next phase (turned unseen: a new fill, calibrated
 *    from nTop), a session saved and restored at boot (CPU counts adopted), the catch-up after
 *    the page was hidden (a transfer), the finish and draining (nTop 0 only once the last point
 *    is out);
 *  - impact() 1 from 700 px/s and no damage; sealCracks() leaves its SEAL event in the shared
 *    frame; knock -1, flick 0, shake -1;
 *  - units at scale 1.08 (phone), 1.3 (tablet), Fine and Finest: the same grid, the same gravity
 *    in solver cells, the ledger reporting the app's own target while the neck is supplied;
 *  - the self-test at start, a missing capability, the hand-held phone's thresholds, a device
 *    lost around a lock (the CPU takes over with the clock untouched, then back), and the
 *    swap frame's CSS turn on a skipped run;
 *  - the stage 1b review's findings: a device lost after adopt() makes the engine not ready and
 *    takeOver() refuses it, the rebuild is ready again; a handover after the CPU caught up a
 *    backlog takes the CPU's count by a transfer (a few grains still flow); a brief lock while
 *    the device opened fails the start with 'hidden'; asleep, the picture is drawn again after a
 *    palette, a new size and back from hidden, and a layout that changes nothing touches nothing;
 *    one shader library a page (a rebuild fetches no shader) and the shaders' build checked
 *    ('stamp'); the heat guard's trip is logged;
 *  - the glass's motion (felt.mjs) as RealSand's jolts say: live by default (a 0.5 g jolt at once
 *    and as it is, 1.5 g capped at 2 g; on its side the same along its floor, and into its floor
 *    as it is), 'film' slowed as before, plain under Reduce Motion; asleep,
 *    a flick wakes the glass in the frame after it begins and its push reaches the first run;
 *  - the bed's sounds (design 8), with the mock solver saying what its sand does
 *    (lib/realsand-beds.js): a bed that falls and is stopped by the glass feeds one thump of the
 *    classic sand's energy, u^2 / (2 G HB), in the frame its readback comes, before the start,
 *    paused, running and (the lower bulb's) finished; one stopped at the far end a slam; one
 *    slowed by the field, or stopped sideways, nothing; sand sliding within a bed feeds the
 *    classic's slides at the calibrated share, every frame also when calm draws every other, and
 *    a bed moving as one body none; a shaken bed's agitation follows its own acceleration and is
 *    0 again at rest; at rest, hidden and asleep nothing is fed, and the sound never keeps the
 *    glass awake; each with its control (the same motion on an engine that hears nothing). A few
 *    crowded points (the plug of the stream under the neck of a glass just started) are no bed
 *    and feed nothing; a bed thrown loose, or flying along the glass as a body, slides nothing;
 *    the landing's window is time, the same at 60, 120 and 180 runs a second; at a slow pace (a
 *    run every 2, 4 or 6 frames, every phase) a toss lands one thump within 1.5 dB of its fall's
 *    energy, at most a run late, from the engine's fastest fall between readbacks (bed.peak; the
 *    readbacks alone, the control, do not); after a stall the
 *    faded agitation stays faded; and the same GPU motion is the same sound at every lattice;
 *  - every glass shape (glass/shapes.js SHAPES): adopt() fills it from the CPU lattice with exactly the
 *    points of each bulb, and a 10 s glass and a 5-minute glass run to 00:00.0 on time, the last
 *    point out within a frame or two; the control, a delta glass whose neck passes too little sand
 *    for its pace, must miss it.
 *
 *   node tools/test/realsand-adapter.test.js
 */
'use strict';
var path = require('path'), fs = require('fs');
var L = require('./lib/realsand-plant.js');
var P = require('./lib/load-physics.js').P;
var paths = require('./lib/paths.js');
var ROOT = paths.ROOT;
var t0 = Date.now(), count = 0, failures = 0;
function log(s) { console.log(s); }
function check(ok, what) { count++; if (!ok) failures++; log((ok ? 'ok    ' : 'FAIL  ') + what); }
function f1(x) { return isFinite(x) ? x.toFixed(1) : String(x); }
var tick = function () { return new Promise(function (r) { setImmediate(r); }); };

(async function () {
  var RS = await import(path.join(ROOT, 'realsand', 'app-sand.mjs'));
  var GL = await import(path.join(ROOT, 'realsand', 'glass.mjs'));
  var FI = await import(path.join(ROOT, 'realsand', 'fill.mjs'));
  var SOL = await import(path.join(ROOT, 'realsand', 'solver.mjs'));
  var VA = await import(path.join(ROOT, 'realsand', 'valve.mjs'));
  var MATERIAL = SOL.MATERIALS.coarse, PW = SOL.PARTICLE_WORDS;
  var glassCache = {};
  function glassFor(geo) {
    var k = geo.q.toFixed(4) + (geo.shape ? ' ' + geo.shape.id : '');
    if (!glassCache[k]) glassCache[k] = GL.buildGlass({ s: RS.CELLS_AT_Q1 / geo.q, neckMin: 5.5, geo: geo, profile: P.profile });
    return glassCache[k];
  }

  /* ------------------------------------------------------------------------------------ *
   *  The mock engine: a device whose work is done a frame later, a solver whose neck is the
   *  plant, readbacks 1-3 frames late in 3 slots
   * ------------------------------------------------------------------------------------ */
  function makeEngine(env) {
    var q = [];
    function later(frames, fn) { q.push({ due: env.V.frame + frames, fn: fn }); }
    env.pump = function () {
      var now = env.V.frame, due = q.filter(function (e) { return e.due <= now; });
      q = q.filter(function (e) { return e.due > now; });
      due.forEach(function (e) { e.fn(); });
    };
    function Device() {
      var self = this;
      this.lost = new Promise(function (r) { self.loseIt = function (reason, message) { r({ reason: reason || 'unknown', message: message || '' }); }; });
      this.queue = { onSubmittedWorkDone: function () { return new Promise(function (r) { later(1, r); }); } };
      this.destroy = function () { self.destroyed = true; self.loseIt('destroyed'); };
    }
    var lastRd = 0;
    function Mock(device) {
      this.device = device; this.shaders = {}; this.count = 0; this.cap = 24; this.maxParticles = 0;
      this.buffers = { particles: {} }; this.readbacks = [{ pending: false }, { pending: false }, { pending: false }];
      this.runs = 0; this.appended = 0; this.uploads = 0; this.fields = []; this.flips = 0;
      env.solver = this;
    }
    Mock.create = async function (device) { return new Mock(device); };
    Mock.prototype.configure = function (glass, maxP, cap) {
      this.glass = glass; this.maxParticles = maxP; this.cap = cap;
      // (one plant for the glass: a device rebuilt after a loss finds the same sand)
      this.plant = env.plantObj || (env.plantObj = new L.Plant(env.plant || {}, env.rnd));
      if (!glass._pos) {
        var top = FI.lattice(glass, function (x, y) { return y > glass.cy + 0.6; }, [glass.cx - glass.Rc, glass.cy, glass.cx + glass.Rc, glass.cy + glass.HBc], 3);
        var bot = FI.lattice(glass, function (x, y) { return y < glass.cy - 0.6; }, [glass.cx - glass.Rc, glass.cy - glass.HBc, glass.cx + glass.Rc, glass.cy], 4);
        var sortY = function (a) { var i = []; for (var k = 0; k < a.length / 2; k++) i.push(k); i.sort(function (p, r) { return a[2 * p + 1] - a[2 * r + 1]; }); var o = []; i.forEach(function (k) { o.push(a[2 * k], a[2 * k + 1]); }); return o; };
        glass._pos = { top: sortY(top), bot: sortY(bot) };
        var d = 0; while (d < glass.cy - 1 && GL.sampleField(glass, glass.cx, glass.cy - d - 0.5)[2] > 0) d += 0.5;
        glass._floor = d;
      }
    };
    Mock.prototype.allocUniforms = function (cap) { this.cap = cap; };
    Mock.prototype.countSides = SOL.Solver.prototype.countSides;
    Mock.prototype.upload = function (data, n) {
      var sides = this.countSides(data, n);
      this.count = n; this.uploads++;
      this.plant.upload(sides.above, sides.below, env.parity ? env.parity() : 0);
      this.uploadSim = env.V.frame;
      this.lastUpload = { data: data, n: n, sides: sides };
      return sides;
    };
    Mock.prototype.append = function (data, n, mirrored) {
      if (!(n > 0)) return 0;
      if (this.count + n > this.maxParticles) throw new RangeError('append: no room');
      for (var i = 0; i < n; i++) if (!(data[i * PW + 1] > Math.fround(this.glass.cy))) throw new RangeError('append: every point must lie above the counting line');
      this.count += n; this.appended += n;
      this.plant.append(n, mirrored);
      return n;
    };
    Mock.prototype.run = function (steps, set, fieldAt, after, neck) {
      steps = Math.min(steps, this.cap);
      for (var s = 0; s < Math.max(steps, 1); s++) { var f = fieldAt(s); if (env.recordFields) this.fields.push(f); this.lastField = f; }
      if (env.recordSets) env.recordSets.push({ beds: !!set.beds, perf: env.V.perf, steps: steps });
      if (after) after({});
      this.runs++;
      var pl = this.plant, out;
      if (neck && neck.targets) {
        if (neck.flip) this.flips++;
        out = pl.run(neck, neck.from / 1000, (neck.to - neck.from) / 1000);
        if (env.onRun) env.onRun(neck, out);
      } else {
        if (neck && neck.flip) { var a = pl.above; pl.above = pl.below; pl.below = a; pl.parity ^= 1; this.flips++; }
        out = { above: pl.above, below: pl.below, queue: 0, crossings: 0, start: pl.t1, refused: 0, upward: 0 };
        pl.t1 = pl.above; pl.t2 = pl.below;
      }
      var slot = this.readbacks.find(function (r) { return !r.pending; });
      if (!slot) return null;
      slot.pending = true;
      var g = this.glass, P2 = g._pos;
      var brimY = out.above > 0 ? P2.top[2 * Math.min(out.above, P2.top.length / 2) - 1] : 0;
      var t = { points: out.above + out.below, above: out.above, below: out.below, outside: 0, nan: 0, clamped: 0, maxMove: 0,
        maxSpeed: 0, meanSpeed: 0, moving: (out.crossings > 0 || pl.flow > 1 || env.V.frame - this.uploadSim < 30) ? 20 : 0,
        crossings: out.crossings, start: out.start, refused: out.refused, upward: out.upward, queue: out.queue, crowdSpeed: 0,
        brim: Math.round(brimY * 16), lastCross: -1, deepest: out.below > 0 ? g._floor : 0 };
      // what a test says the mock's sand does (lib/realsand-beds.js): this run's beds; its moving points count as moving
      var bd = env.beds && steps > 0 ? env.beds(env.V.frame) : null;
      if (bd) { t.beds = bd; if (env.bedsMove !== false) t.moving = Math.max(t.moving, bd[0].sliding + bd[1].sliding); }
      var lag = env.lag ? env.lag() : 1 + Math.floor(env.rnd() * 3);
      lastRd = Math.max(lastRd, env.V.frame + lag);
      var due = lastRd - env.V.frame;
      return new Promise(function (r) { later(due, function () { slot.pending = false; r(t); }); });
    };
    Mock.prototype.readParticles = function () {
      var pl = this.plant, g = this.glass, a = Math.min(pl.above, g._pos.top.length / 2), b = Math.min(pl.below, g._pos.bot.length / 2);
      var pts = g._pos.top.slice(0, 2 * a).concat(g._pos.bot.slice(0, 2 * b));
      var data = FI.packParticles(pts, MATERIAL);
      return new Promise(function (r) { later(env.xferFrames || 1, function () { r(data); }); });
    };
    function Grains() { this.draws = 0; env.grains = this; }
    Grains.prototype.init = async function () {};
    Grains.prototype.bind = function () {};
    Grains.prototype.setPalette = function (p) { this.pal = p; };
    Grains.prototype.encode = function (enc, n, look) { this.draws++; this.look = look; };
    Grains.prototype.present = function () {};
    return {
      createDevice: async function () {
        if (env.noGpu) throw Object.assign(new Error('WebGPU is not available'), { code: 'nogpu' });
        env.device = new Device();
        return { adapter: {}, device: env.device, info: { fallback: !!env.fallback } };
      },
      // (no tone pass: layered sand on the GPU is realsand-gpu's)
      Solver: Mock, GrainRenderer: Grains, Toner: null
    };
  }

  /* ------------------------------------------------------------------------------------ *
   *  The app: app.js's clock and frame(), as far as the sand sees them
   * ------------------------------------------------------------------------------------ */
  var TAIL_P = 1.7, FULL = 0.78, STEP_MS = 1000 / 120, DT = 1 / 120, MAX_STEPS = 6;
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  function makeApp(o) {
    var fine = o.fine || 1, fine2 = fine * fine;
    if (fine > 1) P.Sim.setPace(fine);
    var cpu = new P.Sim({ scale: (o.q || 1.08) * fine, seed: o.seed || 11, shape: o.shape });
    cpu.reset(grainsFor(o.ms));                     // the glass of its length, as newGlass lays it
    var V = { wall: 1.7e12, perf: 1000, frame: 0 };
    var env = { V: V, rnd: L.rng(o.seed || 5), plant: o.plant, lag: o.lag, xferFrames: o.xferFrames };
    var T = { state: 'idle', durationMs: o.ms, rem: o.ms, mpg: 1, mpg0: 1, rate: 0, tailMs: 1000, tailGrains: 30, lastTick: V.wall };
    var app = { cpu: cpu, V: V, env: env, T: T, fine2: fine2, sim: cpu, real: null, back: false, hidden: false,
      flip: { active: false, prog: 0, dur: 2600, swapped: false, was: 'idle', auto: false },
      pour: { held: false, until: 0, acc: 0 }, grav: { on: !!o.motion, base: 0, target: 0 }, tiltOver: 0,
      lastMotionAt: -1e9, lastRetime: -1e9, acc: 0, lastFrame: V.perf, motionIn: null, losses: [], backs: 0,
      zeroAt: NaN, ends: [], retimes: 0, stats: { frames: 0, zeroEarly: 0, censusOff: 0, negRel: 0, supChecked: 0, supOff: 0 } };
    function grainsFor(ms) { var f = Math.min(FULL, cpu.fillMax || FULL) * Math.sqrt(Math.min(1, ms / 3600000)); return Math.round(cpu.capacity * Math.max(0.02, f)); }
    function calibrate(d, N) {
      d = d || T.durationMs; N = Math.max(8, N === undefined ? app.sim.total : N);
      T.tailMs = Math.min(2600, Math.max(500, d * 0.04));
      var rate = N / (d / 1000);
      T.tailGrains = Math.max(3, Math.min(Math.round(30 * fine2), Math.floor(rate * T.tailMs / 1000 / TAIL_P)));
      T.mpg = (d - T.tailMs) / (N - T.tailGrains); T.mpg0 = T.mpg; T.rate = 1000 / T.mpg;
    }
    function topAt(rem) { return rem <= 0 ? 0 : rem >= T.tailMs ? T.tailGrains + (rem - T.tailMs) / T.mpg : T.tailGrains * Math.pow(rem / T.tailMs, TAIL_P); }
    function remAt(top) { return top <= 0 ? 0 : top >= T.tailGrains ? T.tailMs + (top - T.tailGrains) * T.mpg : T.tailMs * Math.pow(top / T.tailGrains, 1 / TAIL_P); }
    app.grainsFor = grainsFor; app.calibrate = calibrate; app.topAt = topAt; app.remAt = remAt;
    app.eventAt = -Infinity;
    app.newGlass = function () { app.sim.reset(grainsFor(T.durationMs)); app.sim.tilt = 0; calibrate(); T.rem = T.durationMs; };
    app.tickClock = function () {
      var now = V.wall, d = now - T.lastTick;
      T.lastTick = now;
      if (d > 1500) app.back = true;
      if (d <= 0 || T.state !== 'running') return;
      if (app.flip.active || (app.grav.on && app.sim.gy < 0.7)) return;
      var r0 = T.rem;
      T.rem -= d;
      if (T.rem <= 0) { app.zeroAt = now - d + r0; T.rem = 0; app.finish(); }
    };
    app.finish = function () { T.state = 'done'; app.ends.push({ zeroAt: app.zeroAt }); };
    app.start = function () {
      if (app.flip.active) return;
      if (T.state === 'done' || T.rem <= 0) {
        if (app.sim.nTop === 0) { app.startFlip(true); return; }
        T.rem = remAt(app.sim.nTop);
      }
      T.state = 'running';
    };
    app.startFlip = function (auto) {
      var f = app.flip;
      if (f.active) return;
      f.active = true; f.was = T.state; f.auto = !!auto; f.swapped = false; f.prog = 0;
      app.sim.flipping = true; app.sim.wakeAll();
    };
    app.swapEnds = function () {
      var before = app.sim.nTop, there = remAt(app.sim.total - before);
      app.sim.completeFlip();
      app.sim.flipping = true;
      T.rem = there;
      app.flip.swapped = !app.flip.swapped;
      app.eventAt = V.wall;
      if (app.onSwap) app.onSwap(app);
      app.swaps = (app.swaps || []).concat([{ before: before, after: app.sim.nTop, total: app.sim.total, rem: T.rem, want: there }]);
    };
    app.endTurn = function () {
      var f = app.flip;
      f.active = false; app.sim.flipping = false; app.sim.angle = 0; app.sim.wakeAll();
      var next = f.was;
      if (f.swapped) next = T.rem <= 0 ? 'done' : (f.auto || f.was === 'running' || f.was === 'done') ? 'running' : 'paused';
      if (app.onSwapped && f.swapped) next = app.onSwapped(next);
      T.state = next;
    };
    app.turnStep = function (dt) {
      var f = app.flip, th;
      f.prog += dt * 1000 / f.dur;
      if (f.prog >= 1) { app.swapEnds(); app.endTurn(); return; }
      var p = f.prog, e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      th = Math.PI * e;
      app.body.w = (th - app.sim.angle) / dt;
      app.sim.angle = th;
    };
    app.tiltSwap = function () {
      var was = T.state, there = remAt(app.sim.total - app.sim.nTop), before = app.sim.nTop;
      app.sim.completeFlip();
      app.grav.base = app.grav.base ? 0 : Math.PI;
      app.sim.tilt = wrapPi(app.sim.tilt + Math.PI);
      T.rem = there; app.eventAt = V.wall;
      app.tilts = (app.tilts || []).concat([{ before: before, after: app.sim.nTop, total: app.sim.total, rem: T.rem, want: there }]);
      T.state = T.rem <= 0 ? 'done' : (was === 'running' || was === 'done') ? 'running' : 'paused';
    };
    app.stepGravity = function (dtMs, now) {
      var g = app.grav, want = g.on ? g.target : 0;
      var d = wrapPi(want + g.base - app.sim.tilt);
      if (Math.abs(d) > 0.0008) { app.sim.tilt = wrapPi(app.sim.tilt + d * (1 - Math.exp(-dtMs / 100))); app.sim.wakeAll(); }
      else if (d !== 0) { app.sim.tilt = wrapPi(want + g.base); app.sim.wakeAll(); }
      var over = !app.flip.active && (app.sim.tilt > 1.75 || app.sim.tilt < -1.75);
      if (!over) app.tiltOver = 0; else if (!app.tiltOver) app.tiltOver = now; else if (now - app.tiltOver >= 200) { app.tiltOver = 0; app.tiltSwap(); }
    };
    app.handlePour = function (now, dtMs) {
      var pr = app.pour;
      if (!(pr.held || now < pr.until) || app.flip.active) return;
      pr.acc += 620 * fine2 * Math.min(dtMs, 50) / 1000;
      var n = pr.acc | 0;
      if (!n) return;
      pr.acc -= n;
      var g0 = app.sim.nTop, t0 = app.sim.total, p0 = app.real ? app.real.valve.points : 0, gpu0 = env.solver ? env.solver.count + app.real._xferPourPts : 0;
      var made = app.sim.pour(n);
      if (made) {
        var want = remAt(topAt(T.rem) + made);
        app.eventAt = V.wall;
      if (app.onSwap) app.onSwap(app);
        T.rem = want;
        if (T.state === 'done') T.state = 'paused';
        if (app.real) {
          var pts = VA.pointsFor(t0 + made, app.real.ppg) - VA.pointsFor(t0, app.real.ppg);
          app.pours.push({ n: n, made: made, dTop: app.sim.nTop - g0, dTotal: app.sim.total - t0, dPoints: app.real.valve.points - p0,
            dGpu: env.solver.count + app.real._xferPourPts - gpu0, pts: pts });
        }
      } else app.full = true;
    };
    app.pours = [];
    app.body = { w: 0 };
    app.maybeRetime = function (now) {
      if (now - app.lastMotionAt < 750 || app.flip.active) return;
      if (T.state !== 'running' || now - app.lastRetime < 500) return;
      if (T.rem <= T.tailMs + 2000 || app.sim.nTop <= T.tailGrains + 2) return;
      if (Math.abs(app.sim.nTop - topAt(T.rem)) <= Math.max(3, 0.5 * T.rate)) return;
      var mpg = (T.rem - T.tailMs) / (app.sim.nTop - T.tailGrains);
      if (!(mpg > T.mpg0 / 4 && mpg < 4 * T.mpg0)) return;
      T.mpg = mpg; T.rate = 1000 / mpg; app.lastRetime = now; app.retimes++;
    };
    /** One rAF frame of dtMs (app.js frame(), 1195-1321). */
    app.frame = function (dtMs) {
      V.wall += dtMs; V.perf += dtMs;
      var now = V.perf, sim = app.sim, real = app.real;
      app.tickClock();
      if (app.onFrame) app.onFrame(app);
      app.handlePour(now, dtMs);
      app.stepGravity(Math.min(dtMs, 100), now);
      var running = T.state === 'running' && !app.flip.active, draining = T.state === 'done' && sim.nTop > 0 && !app.flip.active;
      var target = sim.nTop;
      if (running) {
        var ideal = topAt(T.rem), fade = (T.rem - T.tailMs - 1200) / 3000;
        if (fade > 0) {
          if (fade > 1) fade = 1;
          var ts = now / 1000;
          ideal += T.rate * fade * (0.113 * Math.sin(ts * 1.95 + 1.3 * Math.sin(ts * 0.37)) + 0.022 * Math.sin(ts * 11.9 + 1.1 * Math.sin(ts * 1.7)) + 0.007 * Math.sin(ts * 28.9 + 0.5));
        }
        target = Math.max(0, Math.ceil(ideal - 1e-7));
      } else if (draining) target = 0;
      sim.gateOpen = running || draining;
      sim.deepRelease = draining || (running && T.rem <= 0);
      sim.targetTop = target;
      var motionRecent = now - app.lastMotionAt < 2000;
      sim.relCap = motionRecent ? T.rate * DT * (3 + 20 * Math.max(0, 1 - (T.rem - T.tailMs) / 5000)) : 0;
      var mi = app.motionIn ? app.motionIn(app, now) : null;
      var active = running || draining || app.flip.active || sim.isActive() || !!mi || app.pour.held || now < app.pour.until;
      if (active) {
        sim.beginFrame();
        if (sim.gateOpen && (app.back || !motionRecent)) {
          var owed = sim.nTop - target, cap = app.back ? Math.max(12, T.rate * 0.4) : Math.max(400, T.rate * 1.2);
          if (owed > cap) { app.ff = (app.ff || 0) + 1; sim.fastForward(owed - Math.min(30, Math.ceil(cap * 0.5))); }
        }
        app.acc += Math.min(dtMs, 100);
        var n = 0, tS = now - app.acc;
        while (app.acc >= STEP_MS && n < MAX_STEPS) {
          tS += STEP_MS;
          if (app.flip.active) app.turnStep(DT);
          // (app.motionPerStep: the motion at each step's own time, as motion.js gives it; else the frame's)
          var ms = app.motionPerStep && app.motionIn ? app.motionIn(app, tS) : mi;
          var fx = ms ? ms.fx : 0, fy = ms ? ms.fy : 0, w = (ms ? ms.w : 0) + (app.flip.active ? app.body.w : 0);
          var rho = sim.angle + app.grav.base, c = Math.cos(rho), s = Math.sin(rho), G = sim.G;
          if (real && app.sim === real) real.feel(tS, fx, fy, false, rho);
          sim.setMotion(G * (fx * c + fy * s), G * (-fx * s + fy * c), w, 0, 0.09, 0);
          sim.step();
          if (sim.motionActive()) app.lastMotionAt = now;
          app.acc -= STEP_MS; n++;
          if (app.sim !== sim) break;
        }
        if (n === MAX_STEPS) app.acc = 0;
        if (real && app.sim === real) real.submit(now);
        if (sim.frame.released < 0) app.stats.negRel++;
      }
      app.back = false;
      app.maybeRetime(now);
      app.check(target, running);
      if (app.after) app.after(app);
    };
    app.check = function (target, running) {
      var st = app.stats, sim = app.sim, real = app.real;
      st.frames++;
      if (!real || sim !== real || !env.solver) return;
      var pl = env.solver.plant, gpuTop = pl.topFor(real.valve.parity);
      if (sim.nTop === 0 && gpuTop > 0 && !real.valve.xfer && !real._xfer) st.zeroEarly++;
      var c = sim.census();
      if (c.top !== sim.nTop || c.total !== sim.total) st.censusOff++;
      if (running && !real.valve.closed && real.valve.last && !real.valve.last.closed) {
        // supplied (the GPU at its run's end target for 6 frames: a readback is up to 3 frames old) and the
        // target falling, no event in the last second: the ledger reports the app's target
        var w = real.valve.last, sup = !!w.steps && pl.above === w.targets[w.steps - 1];
        st.supRun = sup ? (st.supRun || 0) + 1 : 0;
        if (st.supRun >= 6 && app.prevTarget !== undefined && target <= app.prevTarget && target <= sim.total && app.V.wall - app.eventAt > 1000) {
          st.supChecked++; if (sim.nTop !== target) { st.supOff++; if (process.env.VERBOSE) log('      off: nTop ' + sim.nTop + ' target ' + target + ' rem ' + Math.round(app.T.rem) + ' relCap ' + sim.relCap.toFixed(2) + ' gpu ' + pl.above + ' end ' + w.targets[w.steps - 1] + ' short ' + real.valve.refShort); }
        }
      }
      app.prevTarget = target;
    };
    /** Frames for ms (1/60 s, now and then a 50 ms one), with o.events at their times (s from now). */
    app.run = async function (ms, opts) {
      opts = opts || {};
      var end = V.wall + ms, rnd = L.rng(opts.seed || 3);
      while (V.wall < end) {
        if (app.hiddenUntil) {
          // hidden: no frames; the app's 400 ms interval ticks the clock
          V.wall += 400; V.perf += 400;
          app.tickClock();
          if (V.wall >= app.hiddenUntil) {
            app.hiddenUntil = 0; app.back = true; app.tickClock(); app.eventAt = V.wall;
            if (app.realObj) app.realObj.setHidden(false);
            app.lastFrame = V.perf; app.acc = 0;
          }
          continue;
        }
        // the GPU's work done and the readbacks due by this frame arrive between frames, as mapAsync's do
        V.frame++; env.pump(); await tick();
        app.frame(rnd() < 0.02 ? 50 : 1000 / 60);
        if (opts.until && opts.until(app)) break;
      }
    };
    app.hide = function (ms) { app.hiddenUntil = V.wall + ms; if (app.realObj) app.realObj.setHidden(true); app.pour.held = false; };
    /** RealSand from the CPU Sim as the app hands over at boot: create, start, adopt, takeOver. */
    app.attach = async function (extra) {
      // (a test's own engine pumps its own queue: the default is made only when none is given)
      var engine = extra && extra.engine ? extra.engine : makeEngine(env);
      var real = await RS.RealSand.create(Object.assign({ P: P, cpuSim: cpu, timer: T, glass: glassFor(cpu.geo), engine: engine,
        clock: { wall: function () { return V.wall; }, perf: function () { return V.perf; } }, canvas: { style: {}, width: 1, height: 1 },
        sleep: async function () {}, log: function (s) { if (process.env.VERBOSE) log('      ' + s); },
        onLost: function (info) { app.losses.push(info); app.sim = cpu; app.real = null; },
        onBack: function () { app.backs++; app.sim = real; app.real = real; real.takeOver(); } }, extra || {}, { engine: engine }));
      env.parity = function () { return real.valve.parity; };
      app.realObj = real;
      var started = real.start(), done = false, err = null;
      started.then(function () { done = true; }, function (e) { done = true; err = e; });
      while (!done) { V.frame++; env.pump(); await tick(); }
      if (err) throw err;
      var adopted = real.adopt(); done = false;
      adopted.then(function () { done = true; }, function (e) { done = true; err = e; });
      while (!done) { V.frame++; env.pump(); await tick(); }
      if (err) throw err;
      // (adoptOnly: started and adopted, not yet handed the sand: the test calls takeOver)
      if (extra && extra.adoptOnly) return real;
      app.sim = real; app.real = real;
      real.takeOver();
      return real;
    };
    /** The last end: when the last point crossed (the plant's record) against 00:00.0, ms. */
    app.endMs = function () { return env.solver.plant.lastCrossT * 1000 - app.zeroAt; };
    if (fine > 1) app.restorePace = function () { P.Sim.setPace(1); };
    return app;
  }

  /** A glass of ms, run from the start to its end (plus 0.5 s); events: { at (ms from the start), fn(app) }. */
  async function runGlass(app, ms, events, opts) {
    opts = opts || {};
    events = (events || []).slice().sort(function (a, b) { return a.at - b.at; });
    var t0w = app.V.wall;
    app.onFrame = function (a) {
      while (events.length && a.V.wall - t0w >= events[0].at) events.shift().fn(a);
      if (opts.onFrame) opts.onFrame(a);
    };
    await app.run(ms + 30000, { until: function (a) {
      return !events.length && a.T.state === 'done' && a.sim.nTop === 0 && a.zeroAt > t0w && a.V.wall - a.zeroAt > 500 && (!opts.until || opts.until(a));
    } });
    app.onFrame = null;
  }
  function endOk(app, what, lateMs) {
    var e = app.endMs(), pl = app.env.solver.plant, sub = 1000 / 480 + 0.5;
    check(e >= -sub && e <= (lateMs || 34) && app.stats.zeroEarly === 0 && app.T.state === 'done' && app.sim.nTop === 0 && pl.above === 0 && pl.viol === 0 && pl.startErr === 0 && pl.closedCross === 0,
      what + ': the last point out ' + f1(e) + ' ms after 00:00.0; nTop 0 while a point was above in ' + app.stats.zeroEarly +
      ' frames; crossings below the target ' + pl.viol + ', runs started on a wrong count ' + pl.startErr + ', crossings while shut ' + pl.closedCross);
  }

  /* ------------------------------------------------------------------------------------ *
   *  1. The contract (the plan's 4.2): every name app.js and audio.js bind to a sand engine,
   *     against the lists here: (a) the Sim's members, on both engines with the CPU Sim's types;
   *     (b) the GPU engine's own, called on real, realEng, eng and realCls under their guards; (c) what
   *     RealSand reads from the classic sand (its namespace and the CPU Sim)
   * ------------------------------------------------------------------------------------ */
  var CONTRACT = {
    // (a) the CPU Sim's members, which RealSand has too, with the same types
    sim: ['nTop', 'nBottom', 'total', 'capacity', 'fillMax', 'maxTotal', 'reset', 'pour', 'fastForward', 'completeFlip', 'step', 'beginFrame', 'isActive', 'motionActive',
          'gateOpen', 'deepRelease', 'targetTop', 'relCap',
          'angle', 'tilt', 'flipping', 'gy', 'G', 'setMotion', 'setCarry', 'wakeAll', 'inertiaZ',
          'quality', 'reduced', 'quiet', 'spinArmed', 'damageArmed', 'topSweeps',
          'impact', 'knock', 'flick', 'shake',
          'frame', 'nev', 'evX', 'evV', 'evK', 'agit', 'agitation', 'bf',
          'geo', 'W', 'H', 'cracks', 'warnSeg', 'segInfo', 'sealCracks', 'serializeDamage', 'restoreDamage', 'forceCrack', 'dMax', 'lost', 'escN', 'escX', 'escY', 'escVX', 'escVY', 'escS',
          'setLayers'],
    cpuSim: [],                                                    // the CPU Sim kept beside RealSand: nothing of its own yet
    audioSim: ['nev', 'evX', 'evV', 'evK'],                        // audio.js: its sim, taken from st.sim
    tests: ['census', 'tones'],                                    // page-init.js's census, app-layers' tones
    // (b) RealSand's own
    real: ['feel', 'points', 'setLight', 'setSweep', 'submit'],          // (setLight: Tune's Light and the look, under its guard)
    realEng: ['ready', 'takeOver', 'destroy', 'destroyed', 'stats', 'layout', 'setHidden', 'setPalette', 'syncCpu'],   // (syncCpu: the watchdog)
    eng: ['start', 'adopt'],
    realCls: ['create']
  };
  var scan = require('./lib/scan.js');
  /** The names bound to an engine in the controller (app.js, and app/ once it has files) and audio.js. */
  function engineNames(appSrcs, audioSrc) {
    var used = {};
    ['sim', 'cpuSim', 'real', 'realEng', 'eng', 'realCls'].forEach(function (v) {
      var seen = {};
      appSrcs.forEach(function (src) { scan.members(src, v).forEach(function (m) { seen[m] = true; }); });
      used[v] = Object.keys(seen).sort();
    });
    used.audioSim = scan.members(audioSrc, 'sim');
    return used;
  }
  /** What differs from the contract: ['realEng.bar used, not in the contract', 'sim.inertiaZ in the contract, no longer used'] */
  function contractDiff(used) {
    var out = [];
    Object.keys(used).forEach(function (v) {
      var list = CONTRACT[v];
      used[v].forEach(function (m) { if (list.indexOf(m) < 0) out.push(v + '.' + m + ' used, not in the contract'); });
      list.forEach(function (m) { if (used[v].indexOf(m) < 0) out.push(v + '.' + m + ' in the contract, no longer used'); });
    });
    return out;
  }
  var controller = [paths.APP].concat(paths.classicScripts().filter(function (f) { return /^app\//.test(f); }).map(function (f) { return path.join(ROOT, f); }));
  var appSrcs = controller.map(function (f) { return fs.readFileSync(f, 'utf8'); }), audioSrc = paths.piece(paths.script('audio.js'));
  var used = engineNames(appSrcs, audioSrc), diff = contractDiff(used);
  check(diff.length === 0 && used.sim.length === CONTRACT.sim.length,
    'the contract: app.js binds ' + used.sim.length + ' members to sim, ' + used.cpuSim.length + ' to cpuSim, ' + used.real.length + ' to real, ' + used.realEng.length + ' to realEng, ' +
    used.eng.length + ' to eng and ' + used.realCls.length + ' to realCls, and audio.js ' + used.audioSim.length + ' to its sim: each the list in this test' + (diff.length ? ': ' + diff.join('; ') : ''));
  // controls: a copy of app.js that uses sim.foo and realEng.bar (and names sim.baz only in a
  // comment and a string), and one that no longer uses sim.inertiaZ
  var more = appSrcs[0].replace('var REAL_TEST = ', 'var CONTRACT_PROBE = function () { return sim.foo + realEng.bar(); /* sim.baz */ }, CONTRACT_PROBE2 = "sim.baz";\n  var REAL_TEST = ');
  var less = appSrcs[0].replace(/\bsim\.inertiaZ\b/g, 'sim.angle');
  var dMore = contractDiff(engineNames([more].concat(appSrcs.slice(1)), audioSrc)), dLess = contractDiff(engineNames([less].concat(appSrcs.slice(1)), audioSrc));
  check(dMore.join() === 'sim.foo used, not in the contract,realEng.bar used, not in the contract' && dLess.join() === 'sim.inertiaZ in the contract, no longer used',
    '... and a copy of app.js that uses sim.foo and realEng.bar (sim.baz only in a comment and a string), or no longer uses sim.inertiaZ, breaks it (control): ' + dMore.concat(dLess).join('; '));
  var A = makeApp({ ms: 10000 });
  var real = await A.attach();
  var cpu = A.cpu, bad = [], noCpu = [];
  function kind(x) { return x === null ? 'null' : typeof x === 'object' ? 'object ' + (x.constructor && x.constructor.name) : typeof x; }
  CONTRACT.sim.concat(CONTRACT.tests).forEach(function (m) {
    var a = cpu[m], b = real[m];
    if (a === undefined) noCpu.push(m);
    if (kind(a) !== kind(b)) bad.push(m + ' (' + kind(a) + ' / ' + kind(b) + ')');
  });
  check(noCpu.length === 0 && bad.length === 0, 'the CPU Sim has every one of the ' + CONTRACT.sim.length + ' Sim members and the tests\' ' + CONTRACT.tests.length +
    ', and RealSand has each with the CPU Sim\'s type' + (noCpu.length ? ': the CPU Sim lacks ' + noCpu.join(', ') : '') + (bad.length ? ': differ ' + bad.join(', ') : ''));
  var own = CONTRACT.real.concat(CONTRACT.realEng, CONTRACT.eng).filter(function (m) { return real[m] === undefined; });
  if (typeof RS.RealSand.create !== 'function') own.push('RealSand.create (static)');
  check(own.length === 0, 'RealSand has its own ' + (CONTRACT.real.length + CONTRACT.realEng.length + CONTRACT.eng.length) + ' members the app calls on real, realEng and eng, and the static create', own.join(', '));

  // (c) what RealSand reads from the classic sand, at create and after: its namespace (P), the
  // namespace's Sim (statics), and the CPU Sim's members beyond the Sim's (a). Each must exist; a
  // private (underscore) member read from the CPU Sim breaks the contract.
  var READS = {
    ns: ['DT', 'KEY_LIGHT', 'STEP_HZ', 'Sim', 'profile'],           // (KEY_LIGHT: the sunlit sand's key, the classic sand's own)
    simStatics: ['EV_CAP', 'IMPACT_V', 'LAYERS', 'MOTION', 'pace'],
    realCpu: ['glassFlip', 'layerState', 'layers', 'rng']
  };
  var adapterSrc = fs.readFileSync(path.join(ROOT, 'realsand', 'app-sand.mjs'), 'utf8');
  function anyOf(src, names) {
    var seen = {};
    names.forEach(function (nm) { scan.members(src, nm).forEach(function (m) { seen[m] = true; }); });
    return Object.keys(seen).sort();
  }
  /** What app-sand.mjs reads against READS: ['realCpu._rec read: private', 'simStatics.FOO read, not in the contract'] */
  function readsDiff(src) {
    var got = {
      ns: anyOf(src, ['P', 'this\\.P']),
      simStatics: anyOf(src, ['P\\.Sim', 'this\\.P\\.Sim']),
      realCpu: anyOf(src, ['cpu', 'this\\.cpu']).filter(function (m) { return CONTRACT.sim.indexOf(m) < 0; })
    }, out = [];
    Object.keys(got).forEach(function (k) {
      got[k].forEach(function (m) {
        if (k === 'realCpu' && m.charAt(0) === '_') out.push(k + '.' + m + ' read: private');
        else if (READS[k].indexOf(m) < 0) out.push(k + '.' + m + ' read, not in the contract');
      });
      READS[k].forEach(function (m) { if (got[k].indexOf(m) < 0) out.push(k + '.' + m + ' in the contract, no longer read'); });
    });
    return out;
  }
  var rd = readsDiff(adapterSrc);
  var rMiss = READS.ns.filter(function (m) { return P[m] === undefined; }).map(function (m) { return 'P.' + m; })
    .concat(READS.simStatics.filter(function (m) { return P.Sim[m] === undefined; }).map(function (m) { return 'P.Sim.' + m; }))
    .concat(READS.realCpu.filter(function (m) { return cpu[m] === undefined; }).map(function (m) { return 'cpu.' + m; }));
  check(rd.length === 0 && rMiss.length === 0,
    'RealSand reads from the classic sand only what is listed: ' + READS.ns.length + ' names on its namespace (' + READS.ns.join(', ') + '), ' + READS.simStatics.length + ' on P.Sim (' +
    READS.simStatics.join(', ') + ') and ' + READS.realCpu.length + ' of the CPU Sim beyond the Sim\'s (' + READS.realCpu.join(', ') + '), each there, none private' +
    (rd.length || rMiss.length ? ': ' + rd.concat(rMiss.map(function (m) { return m + ' missing'; })).join('; ') : ''));
  var rdBad = readsDiff(adapterSrc.replace('const cpu = this.cpu, L = this._lay', 'const cpu = this.cpu, PROBE = cpu._rec + this.P.Sim.FOO, L = this._lay'));
  check(rdBad.join() === 'simStatics.FOO read, not in the contract,realCpu._rec read: private',
    '... and a copy of app-sand.mjs that reads cpu._rec and P.Sim.FOO breaks it (control): ' + rdBad.join('; '));
  // with no namespace, or one that lacks a value, create refuses and names what is missing
  async function refusal(o) {
    try { await RS.RealSand.create(Object.assign({ cpuSim: cpu, glass: real.glass, canvas: { style: {}, width: 1, height: 1 } }, o)); return 'made'; }
    catch (e) { return String(e && e.message); }
  }
  var refusals = [], gP = globalThis.HourglassPhysics;
  try { delete globalThis.HourglassPhysics; refusals.push(await refusal({ P: null })); } finally { globalThis.HourglassPhysics = gP; }
  var simLess = { MOTION: { tauT: P.Sim.MOTION.tauT }, LAYERS: P.Sim.LAYERS, pace: P.Sim.pace, IMPACT_V: P.Sim.IMPACT_V };
  refusals.push(await refusal({ P: Object.assign({}, P, { Sim: simLess }) }));
  refusals.push(await refusal({ P: P, cpuSim: Object.assign(Object.create(Object.getPrototypeOf(cpu)), cpu, { layerState: 0 }) }));
  refusals.push(await refusal({ P: P }));
  check(/namespace is needed/.test(refusals[0]) && /lacks P\.Sim\.EV_CAP, P\.Sim\.MOTION\.idleT$/.test(refusals[1]) && /lacks layerState/.test(refusals[2]) && refusals[3] === 'made',
    'RealSand.create refuses, naming what is missing, without the classic sand\'s namespace, with one that lacks values, or with a CPU Sim without layerState() (and is made with all of them): ' + refusals.join(' | '));
  check(real.frame === cpu.frame && real.geo === cpu.geo && real.evX === cpu.evX && real.evK === cpu.evK && real.evV === cpu.evV && real.cracks === cpu.cracks &&
    real.G === cpu.G && real.capacity === cpu.capacity && real.maxTotal === cpu.maxTotal && real.W === cpu.W && real.H === cpu.H,
    'the per-frame record, the glass, the event arrays and the cracks are the CPU Sim\'s own (shared with the app and the audio)');
  // writable fields the app sets
  var ws = ['angle', 'tilt', 'flipping', 'gateOpen', 'deepRelease', 'targetTop', 'relCap', 'topSweeps', 'quiet', 'damageArmed', 'spinArmed', 'reduced', 'quality', 'escN', 'nev'];
  var wbad = ws.filter(function (k) { var was = real[k]; try { real[k] = was; return false; } catch (e) { return true; } });
  var st0 = real.stats();
  check(st0 && typeof st0.mode === 'string' && st0.ledger && st0.times && st0.build === RS.BUILD && typeof real.isActive() === 'boolean',
    'stats() reports the mode, the rate, the ledger, the start times and the build (' + st0.build + ')');
  check(wbad.length === 0, 'the fields the app writes are writable (' + ws.join(', ') + ')');

  /* ---- the self-test, the fill, the glass ---- */
  var g = real.glass, sides = A.env.solver.lastUpload.sides;
  check(real.times.selfTest !== null && real.started && real.ready, 'start() ran the self-test (500 points on the shut neck: all there, finite, inside, none crossed) and adopt() drew the settled bed (ready)');
  var Pts = function (n) { return VA.pointsFor(n, real.ppg); };
  check(sides.above === Pts(cpu.nTop) && sides.below === Pts(cpu.total - cpu.nTop) && real.points === sides.above + sides.below && real.nTop === cpu.nTop && real.total === cpu.total,
    'adopt() fills from the CPU lattice with exactly Pts(nTop) = ' + sides.above + ' points above and Pts(nBottom) = ' + sides.below + ' below; the ledger takes the CPU\'s counts');
  // a fill from a lattice with sand in both bulbs: counts, sides, inside, seeds
  var cpu2 = new P.Sim({ scale: 1.08, seed: 21 });
  cpu2.reset(6000); cpu2.fastForward(2500);
  var want = { top: Pts(cpu2.nTop), bottom: Pts(cpu2.total - cpu2.nTop) };
  var fl = FI.fromLattice(cpu2, g, want), inside = 0, wrongSide = 0, seedOk = 0, under = 0;
  for (var i = 0; i < fl.top + fl.bottom; i++) {
    var x = fl.pts[2 * i], y = fl.pts[2 * i + 1];
    if (GL.sampleField(g, x, y)[2] > 0.45) inside++;
    if ((i < fl.top) !== (y > g.cy)) wrongSide++;
    var k = g.warp[Math.floor(y)], xa = Math.floor(cpu2.W / 2 + (x - g.cx) * k / g.s), ya = Math.floor(cpu2.H / 2 - (y - g.cy) / g.s), ci = ya * cpu2.W + xa;
    if (cpu2.cell[ci] >= P.REST) { under++; if (cpu2.seed[ci] === fl.seeds[i]) seedOk++; }
  }
  check(fl.top === want.top && fl.bottom === want.bottom && inside === fl.top + fl.bottom && wrongSide === 0 && seedOk === under && under > 0.9 * (fl.top + fl.bottom),
    'fromLattice: ' + fl.top + ' + ' + fl.bottom + ' points as asked, all inside the glass and on their side of the line; ' + under + ' lie on a CPU grain (' +
    Math.round(100 * under / (fl.top + fl.bottom)) + ' %) and carry its seed (' + seedOk + ')');
  var gLab = GL.buildGlass({ s: 0.65 }), same = gLab.W === g.W && gLab.H === g.H;
  for (i = 0; same && i < g.field.length; i++) if (g.field[i] !== gLab.field[i]) same = false;
  check(same && g.warp[Math.floor(g.cy)] < 0.9 && g.warp[Math.floor(g.cy + 0.66 * g.HBc)] === 1,
    'the glass built from the app\'s makeGeometry(1.08) and profile is the lab\'s field to the bit (' + g.W + ' x ' + g.H + '); the drawn neck\'s warp ' + g.warp[Math.floor(g.cy)].toFixed(3) + ' at the line, 1 at the equator');

  /* ------------------------------------------------------------------------------------ *
   *  2. The clock sites, each to the end of its glass
   * ------------------------------------------------------------------------------------ */
  // finish and draining: a plain 10 s glass
  A.calibrate(); A.T.rem = A.T.durationMs; A.start();
  var confirmedAfter = NaN, outAfter = NaN;
  A.after = function (a) {
    if (a.T.state !== 'done') return;
    if (isNaN(outAfter) && a.env.solver.plant.above === 0) outAfter = a.V.wall - a.zeroAt;
    if (isNaN(confirmedAfter) && a.sim.nTop === 0) confirmedAfter = a.V.wall - a.zeroAt;
  };
  await runGlass(A, 10000, []);
  A.after = null;
  endOk(A, 'finish and draining (10 s glass)');
  check(A.stats.supChecked > 100 && A.stats.supOff === 0 && outAfter >= 0 && outAfter < 17 && confirmedAfter > outAfter && confirmedAfter - outAfter <= 3 * 1000 / 60 + 1 && A.stats.censusOff === 0 && A.stats.negRel === 0 && !A.losses.length,
    'while the neck is supplied and the target falls the count is the app\'s target (' + A.stats.supChecked + ' frames, ' + A.stats.supOff + ' off); the last point is out in the frame ' +
    f1(outAfter) + ' ms after 00:00.0 and nTop reads 0 ' + f1(confirmedAfter) + ' ms after it, once a readback (1-3 frames late) shows no point above; census exact; no release below 0; no loss');
  var au = real.audit();
  check(au && au.ok, 'audit(): the newest readback agrees with the ledger (' + (au ? au.total + ' points' : 'none') + ')');

  // start: the finished glass started again turns over (startFlip) and runs to its end
  A.start();
  check(A.flip.active, 'start() on a finished glass with nTop 0 turns it over (a Flip), as app.js start() does');
  A.stats.zeroEarly = 0; A.swaps = [];
  await runGlass(A, 13000, []);
  var sw = A.swaps[0];
  endOk(A, 'start after the end: the glass turned over and run again');
  check(sw && sw.after === sw.total - sw.before && sw.rem === sw.want, 'the Flip\'s swap: nTop ' + (sw && sw.before) + ' -> ' + (sw && sw.after) + ' = total - nTop at once, the time remAt(total - nTop)');

  // the Flip at 4 s of a running glass
  var B = makeApp({ ms: 10000, seed: 31 });
  var rB = await B.attach(); B.calibrate(); B.T.rem = B.T.durationMs; B.start();
  var revert = 0, afterSwap = null;
  await runGlass(B, 12600, [{ at: 4000, fn: function (a) { a.startFlip(false); } }], { onFrame: function (a) {
    var s = a.swaps && a.swaps[0];
    if (s && afterSwap === null) afterSwap = { frames: 0 };
    if (s && afterSwap.frames++ < 30 && a.sim.nTop === s.before && s.before !== s.after) revert++;
  } });
  sw = B.swaps[0];
  endOk(B, 'Flip at 4 s');
  check(sw && sw.after === sw.total - sw.before && sw.rem === sw.want && revert === 0 && B.env.solver.flips >= 1,
    'the swap: nTop ' + (sw && sw.before) + ' -> ' + (sw && sw.after) + ' at once, the time remAt of it; never back to the count before the swap (' + revert + ' frames); the next run carried the flip pass');

  // a tilt swap (real motion): the clock stops on its side, the lower bulb becomes the top
  var C = makeApp({ ms: 10000, seed: 41, motion: true });
  await C.attach(); C.calibrate(); C.T.rem = C.T.durationMs; C.start();
  await runGlass(C, 13000, [{ at: 3000, fn: function (a) { a.grav.target = Math.PI; } }]);
  var tl = C.tilts && C.tilts[0];
  endOk(C, 'tilt swap (real motion, turned over at 3 s)');
  check(tl && tl.after === tl.total - tl.before && tl.rem === tl.want && C.stats.censusOff === 0,
    'the tilt swap: nTop ' + (tl && tl.before) + ' -> ' + (tl && tl.after) + ' at once, the time remAt(total - nTop), the clock stopped while the glass lay on its side');

  // pour: + Sand held 1.5 s at 3 s, and a tilt swap with a pour in the same frame
  var D = makeApp({ ms: 10000, seed: 51, motion: true });
  var rD = await D.attach(); D.calibrate(); D.T.rem = D.T.durationMs; D.start();
  await runGlass(D, 16000, [{ at: 3000, fn: function (a) { a.pour.until = a.V.perf + 1500; } },
    { at: 6000, fn: function (a) { a.grav.target = Math.PI; } },
    { at: 6000, fn: function (a) { a.pourOnSwap = true; } }], { onFrame: function (a) {
      if (a.pourOnSwap && a.tilts && a.tilts.length) { a.pourOnSwap = false; a.pour.until = a.V.perf + 100; }
    } });
  var pb = D.pours.filter(function (p) { return !(p.made === p.dTop && p.made === p.dTotal && p.dPoints === p.pts && p.dGpu === p.pts); });
  endOk(D, 'pour 1.5 s, then a tilt swap and a pour together');
  check(D.pours.length > 40 && pb.length === 0 && !D.full,
    D.pours.length + ' pours: each raised nTop and total by exactly the grains made at once, the ledger\'s points and the GPU\'s by exactly Pts(total + n) - Pts(total) (' + pb.length + ' off); the time remAt(topAt + made)');

  // re-time: a shake starves the neck for 1.5 s; once calm the app re-times from nTop
  var E = makeApp({ ms: 10000, seed: 61 });
  await E.attach(); E.calibrate(); E.T.rem = E.T.durationMs; E.start();
  E.motionIn = function (a, now) { return a.shakeUntil > a.V.wall ? { fx: 0.6 * Math.sin(now / 40), fy: 0.4 * Math.cos(now / 33), w: 0 } : null; };
  await runGlass(E, 12000, [{ at: 2500, fn: function (a) { a.shakeUntil = a.V.wall + 500; a.env.solver.plant.starve = true; } },
    { at: 4800, fn: function (a) { a.env.solver.plant.starve = false; } }]);
  endOk(E, 'a shake, the neck starved 2.3 s, re-timed once calm');
  check(E.retimes >= 1, 'the app re-timed from nTop after the shake (' + E.retimes + ' times): the starved count was reported, not the target');

  // a sequence's next phase: the glass turned unseen (a new fill), calibrated from nTop
  var F = makeApp({ ms: 10000, seed: 71 });
  var rF = await F.attach(); F.calibrate(); F.T.rem = F.T.durationMs; F.start();
  await runGlass(F, 10000, []);
  endOk(F, 'a sequence\'s first phase');
  var fills0 = rF.n.fills;
  F.sim.completeFlip(); var dmg = F.sim.serializeDamage(); F.sim.reset(F.sim.total); F.sim.restoreDamage(dmg);   // turnedUnseen(1)
  F.calibrate(8000, F.sim.nTop); F.T.rem = 8000; F.T.state = 'running';                                         // beginPhase
  var fillOk = rF.n.fills === fills0 + 1 && F.sim.nTop === F.sim.total && F.env.solver.lastUpload.sides.above === VA.pointsFor(F.sim.total, rF.ppg);
  F.stats.zeroEarly = 0;
  await runGlass(F, 8000, []);
  endOk(F, 'the next phase (8 s), after an unseen turn');
  check(fillOk, 'the unseen turn: reset(total) fills the GPU from the CPU lattice with all ' + F.sim.total + ' grains above, and the phase is calibrated from nTop');

  // a session saved at 4 s and restored at boot 3 s later (the CPU Sim restores, then the handover)
  var G1 = makeApp({ ms: 10000, seed: 81 });
  await G1.attach(); G1.calibrate(); G1.T.rem = G1.T.durationMs; G1.start();
  await G1.run(4000);
  var saved = { total: G1.sim.total, top: G1.sim.nTop, rem: G1.T.rem, mpg: G1.T.mpg };
  var G2 = makeApp({ ms: 10000, seed: 82 });
  G2.calibrate(10000, saved.total); G2.T.rem = saved.rem - 3000; G2.T.state = 'running';
  G2.cpu.reset(saved.total); G2.cpu.fastForward(saved.total - Math.ceil(G2.topAt(G2.T.rem)));
  for (i = 0; i < 240 && G2.cpu.isActive(); i++) { G2.cpu.beginFrame(); G2.cpu.step(); }
  var cpuTop = G2.cpu.nTop;
  var rG = await G2.attach();
  check(rG.nTop === cpuTop && rG.total === saved.total && G2.env.solver.lastUpload.sides.above === VA.pointsFor(cpuTop, rG.ppg),
    'a session restored at boot: the CPU Sim restores ' + cpuTop + ' of ' + saved.total + ' above, and the handover adopts exactly those counts');
  await runGlass(G2, 4000, []);
  endOk(G2, 'the restored session to its end');

  // the catch-up after the page was hidden 5 s: a transfer
  var H = makeApp({ ms: 10000, seed: 91 });
  var rH = await H.attach(); H.calibrate(); H.T.rem = H.T.durationMs; H.start();
  await H.run(2500);
  var hideTop = H.sim.nTop, ffAt = null;
  H.hide(5000);
  await runGlass(H, 3000, [], { onFrame: function (a) { if (a.ff && ffAt === null) ffAt = { top: a.sim.nTop, target: Math.ceil(a.topAt(a.T.rem)) }; } });
  endOk(H, 'hidden 5 s at 2.5 s, caught up on return');
  var auH = rH.audit();
  check(H.ff === 1 && rH.n.transfers === 1 && rH.valve.n.uploadOff === 0 && ffAt && ffAt.top - ffAt.target <= 30 && auH && auH.ok,
    'back from the background: one catch-up (' + hideTop + ' above when hidden, ' + (ffAt && ffAt.top) + ' after it against ' + (ffAt && ffAt.target) + ' due), moved on the GPU by one transfer with every point kept; audit() agrees after');

  // hidden across the end (the lab's Gate A run without catch-up ended 7 minutes late): on return the
  // catch-up moves what is owed by a transfer, the rest drains, and the glass is empty within a second
  var H2 = makeApp({ ms: 10000, seed: 92 });
  var rH2 = await H2.attach(); H2.calibrate(); H2.T.rem = H2.T.durationMs; H2.start();
  await H2.run(3000);
  H2.hide(12000);
  await H2.run(12000);
  var backAt = H2.V.wall, aboveBack = H2.sim.nTop, emptyAt = null;
  H2.after = function (a) { if (emptyAt === null && a.sim.nTop === 0) emptyAt = a.V.wall; };
  await H2.run(3000);
  H2.after = null;
  check(aboveBack > 500 && emptyAt !== null && emptyAt - backAt < 1000 && H2.env.solver.plant.above === 0 && H2.stats.zeroEarly === 0 && rH2.n.transfers >= 1,
    'hidden across the end: back with ' + aboveBack + ' grains above, caught up by ' + rH2.n.transfers + ' transfer(s) and drained, the glass empty ' +
    (emptyAt === null ? 'never' : f1(emptyAt - backAt) + ' ms') + ' after the page showed; nTop never 0 with a point above');

  // a swap while a transfer's readback is on its way (the phone turned over as the page showed): the
  // points read back are turned as the flip pass would, and the upload is in the ledger's orientation
  var H4 = makeApp({ ms: 10000, seed: 94, xferFrames: 6 });
  var rH4 = await H4.attach(); H4.calibrate(); H4.T.rem = H4.T.durationMs; H4.start();
  await H4.run(2000);
  H4.hide(2000);
  var swapped4 = null;
  await runGlass(H4, 9000, [], { onFrame: function (a) {
    if (swapped4 === null && rH4._xfer) { var b4 = a.sim.nTop; a.sim.completeFlip(); a.T.rem = a.remAt(a.sim.total - b4); swapped4 = { before: b4, after: a.sim.nTop }; }
  } });
  endOk(H4, 'a swap while a transfer was on its way');
  var au4 = rH4.audit();
  check(swapped4 && swapped4.after === H4.sim.total - swapped4.before && rH4.valve.n.uploadOff === 0 && au4 && au4.ok && rH4.n.xferTimeouts === 0,
    'the transfer\'s points were turned with the swap (' + (swapped4 && swapped4.before) + ' -> ' + (swapped4 && swapped4.after) + ' above), every point kept, audit() agreeing after');

  // a transfer whose readback never comes (a hung device): abandoned after 1 s, the CPU Sim brought to
  // the ledger's counts and the GPU filled from it; the glass still ends on time
  var H3 = makeApp({ ms: 10000, seed: 93, xferFrames: 1e9 });
  var rH3 = await H3.attach(); H3.calibrate(); H3.T.rem = H3.T.durationMs; H3.start();
  await H3.run(2500);
  H3.hide(3000);
  await runGlass(H3, 6000, []);
  endOk(H3, 'a transfer that never came back');
  check(rH3.n.xferTimeouts === 1 && rH3.n.transfers >= 1 && H3.stats.censusOff === 0,
    'the transfer was abandoned after 1 s (' + rH3.n.xferTimeouts + '), the GPU filled again from the CPU Sim at the ledger\'s counts');

  // a sequence's phase ending while the page is hidden: the unseen turn's fill waits for the page to show (7.7)
  var F2 = makeApp({ ms: 10000, seed: 72 });
  var rF2 = await F2.attach(); F2.calibrate(); F2.T.rem = F2.T.durationMs; F2.start();
  await F2.run(2000);
  F2.hide(12000);
  var fills2 = rF2.n.fills, uploads2 = F2.env.solver.uploads, turnedAt = null;
  F2.onFrame = function (a) { if (a.T.state === 'done' && !turnedAt) { turnedAt = true; } };
  await F2.run(9000);                 // (hidden: the clock runs out at about 10 s)
  check(F2.T.state === 'done' && F2.sim.nTop > 0, 'hidden, the clock ran out with ' + F2.sim.nTop + ' grains still above (no GPU work while hidden)');
  F2.sim.completeFlip(); dmg = F2.sim.serializeDamage(); F2.sim.reset(F2.sim.total); F2.sim.restoreDamage(dmg);
  F2.calibrate(6000, F2.sim.nTop); F2.T.rem = 6000; F2.T.state = 'running';
  var deferredOk = rF2.n.fills === fills2 && F2.env.solver.uploads === uploads2 && rF2._fillDue && F2.sim.nTop === F2.sim.total;
  F2.onFrame = null; F2.stats.zeroEarly = 0;
  await F2.run(3500);                 // the rest of the hidden time, then the page shows
  var afterShow = rF2.n.fills === fills2 + 1 && !rF2._fillDue;
  await runGlass(F2, 8000, []);
  check(deferredOk && afterShow, 'the next phase turned and filled unseen: the ledger at once (all ' + F2.sim.total + ' grains above), the GPU\'s fill made once, when the page showed');
  endOk(F2, 'that phase, from its fill on return');

  // the brim and maxTotal: + Sand stops at the glass's fill limit, and when the bed reaches the inlet
  var M = makeApp({ ms: 3600000, seed: 151 });
  var rM = await M.attach();
  M.sim.reset(M.cpu.maxTotal - 40);
  await M.run(300);
  var madeA = M.sim.pour(100), totalA = M.sim.total;
  var t = M.env.solver.plant, brimRb = rM.valve.tallies[rM.valve.tallies.length - 1];
  brimRb.brim = Math.round((rM.glass.cy + rM.glass.HBc - 2) * 16);     // the newest readback: sand 2 cells under the inlet
  M.sim.reset(M.cpu.maxTotal - 2000);
  await M.run(300);
  rM.valve.tallies[rM.valve.tallies.length - 1].brim = Math.round((rM.glass.cy + rM.glass.HBc - 2) * 16);
  var madeB = M.sim.pour(100);
  check(madeA === 40 && totalA === M.cpu.maxTotal && madeB === 0,
    'a pour stops at the glass\'s limit (' + madeA + ' of 100 made at ' + M.cpu.maxTotal + ' grains), and makes none while the newest readback has sand within 4 cells of the inlet ("The glass is full")');

  /* ------------------------------------------------------------------------------------ *
   *  3. Blows, mending, damage
   * ------------------------------------------------------------------------------------ */
  var segD = cpu.segD ? Array.prototype.slice.call(cpu.segD) : null;
  check(real.impact(0, 1, 699) === 0 && real.impact(0, 1, 700) === 1 && real.impact(1, 0, 2500) === 1 && real.knock(10, 10, 1.2) === -1 && real.flick(0.9) === 0 && real.shake(8) === -1 &&
    (!segD || Array.prototype.slice.call(cpu.segD).join() === segD.join()) && cpu.cracks.length === 0,
    'impact() is 1 from 700 px/s (a blow thumps and clacks) and 0 below; knock -1, flick 0, shake -1; the glass takes no damage');
  cpu.forceCrack(5, 30, 0);
  var nCracks = real.cracks.length;
  real.beginFrame();
  var sealed = real.sealCracks(), fr = real.frame, seal = false;
  for (i = 0; i < fr.dmgN; i++) if (fr.dmgType[i] === P.Sim.DMG.SEAL) seal = true;
  check(nCracks === 1 && sealed === 1 && seal && fr === A.cpu.frame, 'a crack the glass had stays (cracks from the CPU Sim) and sealCracks() mends it: its SEAL event is in the shared frame, where the app\'s drainDamage reads it');

  /* ------------------------------------------------------------------------------------ *
   *  4. Units: the phone, a tablet, Fine and Finest
   * ------------------------------------------------------------------------------------ */
  var rows = [];
  var unitOk = true;
  for (var u of [{ q: 1.08, fine: 1, name: 'phone 1.08' }, { q: 1.3, fine: 1, name: 'tablet 1.3' }, { q: 1.08, fine: Math.SQRT2, name: 'Fine' }, { q: 1.08, fine: 2, name: 'Finest' }]) {
    var U = makeApp({ ms: 10000, q: u.q, fine: u.fine, seed: 101 });
    var rU = await U.attach(); U.calibrate(); U.T.rem = U.T.durationMs; U.start();
    var sd = U.env.solver.lastUpload.sides, gg = rU.glass;
    await runGlass(U, 10000, [{ at: 3000, fn: function (a) { a.pour.until = a.V.perf + 400; } }]);
    var e = U.endMs(), pl = U.env.solver.plant, pb2 = U.pours.filter(function (p) { return !(p.dTop === p.made && p.dPoints === p.pts && p.dGpu === p.pts); }).length;
    var ok = gg.W === 137 && (gg.H === 302 || gg.H === 303) && Math.abs(rU.Gg - rU.s * U.cpu.G) < 1e-9 && (u.q !== 1.08 || Math.abs(rU.Gg - 2145) < 3) && sd.above === VA.pointsFor(U.grainsFor(10000), rU.ppg) &&
      e >= -2.6 && e <= 34 && U.stats.zeroEarly === 0 && pl.viol === 0 && U.stats.supOff === 0 && U.stats.supChecked > 50 && pb2 === 0;
    if (!ok) unitOk = false;
    rows.push(u.name + ': s ' + rU.s.toFixed(3) + ', ' + rU.ppg.toFixed(2) + ' points a grain, grid ' + gg.W + ' x ' + gg.H + ', g ' + rU.Gg.toFixed(0) + ' cells/s2, ' +
      U.grainsFor(10000) + ' grains = ' + sd.above + ' points; end ' + f1(e) + ' ms; target held ' + U.stats.supChecked + '/' + (U.stats.supChecked - U.stats.supOff));
    if (U.restorePace) U.restorePace();
  }
  check(unitOk, 'units at four scales, each a 10 s glass with a pour run to its end:\n        ' + rows.join('\n        '));

  /* ------------------------------------------------------------------------------------ *
   *  5. Start-up failures, the modes, a lost device, the swap frame
   * ------------------------------------------------------------------------------------ */
  var X = makeApp({ ms: 10000, seed: 111 });
  var err1 = null;
  try { await X.attach({ engine: Object.assign(makeEngine(X.env), { createDevice: async function () { throw Object.assign(new Error('WebGPU is not available'), { code: 'nogpu' }); } }) }); } catch (e1) { err1 = e1; }
  X.env.fallback = true;
  var err2 = null;
  try { await X.attach(); } catch (e2) { err2 = e2; }
  X.env.fallback = false;
  var err3 = null, err4 = null, err5 = null, engBad = makeEngine(X.env);
  engBad.Solver = { create: async function () { throw new Error('g2p2g: 12:3 unresolved identifier'); } };
  try { await X.attach({ engine: engBad }); } catch (e3) { err3 = e3; }
  var engLoad = makeEngine(X.env);
  engLoad.Solver = { create: async function () { throw new Error('Could not load tally: HTTP 404'); } };
  try { await X.attach({ engine: engLoad }); } catch (e4) { err4 = e4; }
  var engHide = makeEngine(X.env), MockS = engHide.Solver;
  engHide.Solver = { create: async function (d) { X.realObj.setHidden(true); return MockS.create(d); } };
  try { await X.attach({ engine: engHide }); } catch (e5) { err5 = e5; }
  check(err3 && err3.code === 'compile' && err3.capability === false && err4 && err4.code === 'load' && err4.capability === false &&
    err5 && err5.code === 'hidden' && err5.capability === false && X.env.device.destroyed,
    'other start failures keep the setting (retry at the next launch): a shader that does not compile, one that does not load, the page hidden during start; the device is let go');
  check(err1 && err1.code === 'nogpu' && err1.capability === true && err2 && err2.code === 'fallback' && err2.capability === true,
    'start() without WebGPU throws "' + (err1 && err1.message) + '" and with a fallback adapter "' + (err2 && err2.message) + '", both a missing capability (the setting is cleared)');

  // a phone held still in the hand: calm and not motion; a jolt: full, motion
  var Y = makeApp({ ms: 60000, seed: 121 });
  var rY = await Y.attach(); Y.calibrate(); Y.T.rem = Y.T.durationMs; Y.start();
  var held = L.rng(9);
  Y.motionIn = function (a, now) {
    var j = a.jolt && a.V.wall < a.jolt ? 0.3 : 0;
    return { fx: 0.012 * (held() - 0.5) + 0.006 * Math.sin(now / 90) + j, fy: 0.012 * (held() - 0.5) + j, w: 0.08 * Math.sin(now / 300) };
  };
  var modesSeen = {};
  Y.onFrame = function (a) { modesSeen[rY.modes.mode] = (modesSeen[rY.modes.mode] || 0) + 1; };
  await Y.run(4500);
  modesSeen = {};
  await Y.run(5000);
  var calmShare = (modesSeen.calm || 0) / ((modesSeen.calm || 0) + (modesSeen.full || 0) + (modesSeen.asleep || 0)), motionAt = Y.lastMotionAt;
  Y.jolt = Y.V.wall + 600; modesSeen = {};
  await Y.run(800);
  check(calmShare > 0.95 && motionAt < 0 && modesSeen.full > 0 && Y.lastMotionAt > 0,
    'held still in the hand (0.01 g of tremor, 0.08 rad/s): calm ' + Math.round(100 * calmShare) + ' % of frames once the run\'s start is over, and motionActive never set (the catch-up stays allowed); a 0.3 g jolt held 0.6 s: full, and motion');
  Y.onFrame = null; Y.motionIn = null;

  // feel(): a 50 ms jolt reaches the GPU's substeps (5.2), as RealSand's jolts say (felt.mjs):
  // live, the default, at once (0.5 g, under the bed's friction, as it is; 1.5 g, beyond it, at the
  // film's speed, capped at 2 g); 'film' (as before) slowed like a film; plain under Reduce Motion
  // (tilt: the sand's gravity turned on the page, pi / 2 a phone on its side; along: the jolt along
  // the page's y, else its x; the felt part of the field, the gravity at rest taken off, along it)
  async function joltRun(g, mode, reduced, tilt, along) {
    var J = makeApp({ ms: 60000, seed: 171, motion: !!tilt });
    var rJ = await J.attach(); J.calibrate(); J.T.rem = J.T.durationMs; J.start();
    if (mode) rJ.jolts = mode;
    rJ.reduced = !!reduced;
    if (tilt) J.grav.target = tilt;
    await J.run(3000);
    J.env.recordFields = true; J.env.solver.fields = [];
    var joltUntil = J.V.wall + 50;
    J.motionIn = function (a) { return a.V.wall <= joltUntil ? (along ? { fx: 0, fy: g, w: 0 } : { fx: g, fy: 0, w: 0 }) : null; };
    await J.run(1000);
    J.motionIn = null; J.env.recordFields = false;
    var th = rJ.angle + rJ.tilt, gx = J.env.solver.fields.map(function (f) { return along ? -f.gravity[1] / rJ.Gg - Math.cos(th) : f.gravity[0] / rJ.Gg - Math.sin(th); });
    var st = rJ.stats();
    return { over: gx.filter(function (x) { return x > 0.1; }).length, peak: Math.max.apply(null, gx), n: gx.length, jolts: st.jolts, tilt: rJ.tilt, rate: typeof st.hzPeak === 'number' && typeof st.held === 'number' };
  }
  var jF = await joltRun(0.5, 'film'), jL = await joltRun(0.5), jL15 = await joltRun(1.5), jP15 = await joltRun(1.5, null, true);
  check(jF.over > 2 * 24 && jF.peak > 0.35 && jF.peak <= 0.5 && jF.n > 400 && jF.jolts === 'film',
    'jolts \'film\' (as before): a 50 ms jolt of 0.5 g (24 substeps at 480 Hz) is felt by ' + jF.over + ' substeps, slowed like a film, at up to ' + jF.peak.toFixed(2) + ' g against the glass\'s gravity');
  check(jL.jolts === 'live' && jL.over >= 20 && jL.over <= 40 && jL.peak > 0.35 && jL.peak <= 0.5 && jL15.peak > 1.5 && jL15.peak <= 2 + 1e-6 && jL.rate,
    'live, the default: the same jolt is felt by ' + jL.over + ' substeps (at once, not slowed), at up to ' + jL.peak.toFixed(2) + ' g (under the bed\'s friction: as it is); a 1.5 g jolt at up to ' + jL15.peak.toFixed(2) + ' g (beyond the friction at the film\'s speed, capped at 2 g); the report has the highest auto Hz and the rate the GPU\'s budget held back (' + (jL.rate ? 'hzPeak, held' : 'missing') + ')');
  check(jP15.jolts === 'plain' && jP15.peak > 1.3 && jP15.peak <= 1.5 && jP15.over <= 40,
    'under Reduce Motion the glass\'s motion is played plain: the 1.5 g jolt at up to ' + jP15.peak.toFixed(2) + ' g, by ' + jP15.over + ' substeps');
  // live takes its knees in the frame of the sand's gravity (on the page at angle + tilt - rho):
  // on its side, a jolt along its floor (the page's y) is played as one along the floor upright,
  // and one into its floor (the page's x) as it is
  var jSa = await joltRun(1.5, null, false, Math.PI / 2, true), jSi = await joltRun(1.5, null, false, Math.PI / 2, false);
  check(jSa.jolts === 'live' && Math.abs(jSa.tilt - Math.PI / 2) < 1e-3 && jSa.peak > 1.5 && Math.abs(jSa.peak - jL15.peak) <= 1e-3 && jSi.peak > 1.3 && jSi.peak <= 1.5,
    'live, the glass on its side (the sand\'s gravity along the page\'s x, tilt ' + jSa.tilt.toFixed(2) + '): a 1.5 g jolt along its floor is felt at up to ' + jSa.peak.toFixed(2) + ' g, as upright (' + jL15.peak.toFixed(2) + '), and one into its floor as it is (' + jSi.peak.toFixed(2) + ' g)');

  // the heat guard: full (a hand shaking the glass) and slower than 0.6 of real time for 20 s: calm
  var K = makeApp({ ms: 120000, seed: 161 });
  var kLog = [];
  var rK = await K.attach({ log: function (s) { kLog.push(s); } }); K.calibrate(); K.T.rem = K.T.durationMs; K.start();
  K.motionIn = function (a, now) { return { fx: 0.15 * Math.sin(now / 50), fy: 0, w: 0 }; };
  var guardAt = null, t0K = K.V.wall;
  K.after = function (a) { if (guardAt === null && rK.modes.guard) guardAt = a.V.wall - t0K; };
  // frames of 120 ms (a GPU too slow for the bed): each run holds at most 50 ms of sand time
  var endK = K.V.wall + 24000;
  while (K.V.wall < endK) { K.V.frame++; K.env.pump(); await tick(); K.frame(120); }
  K.after = null; K.motionIn = null;
  var kTrip = kLog.filter(function (l) { return /heat guard tripped/.test(l); });
  check(guardAt !== null && guardAt >= 20000 && guardAt < 22000 && rK.modes.mode === 'calm' && rK.n.guards === 1 && kTrip.length === 1 &&
    /\d\d:\d\d:\d\d UTC: sim\/real 0\.[0-5]\d, calm, \d+ Hz/.test(kTrip[0]),
    'the heat guard: shaken (full) at 0.42 of real time, the glass ran calm after ' + (guardAt === null ? 'never' : f1(guardAt / 1000) + ' s') +
    '; the trip is logged with its time, the ratio, the mode and the rate (' + (kTrip[0] || 'not logged') + ')');

  // asleep: a paused glass at rest runs nothing; wakeAll wakes it only past 1 degree of lean
  Y.T.state = 'paused';
  await Y.run(3500);
  var runs0 = Y.env.solver.runs, asleep = rY.modes.mode === 'asleep' && !rY.isActive();
  await Y.run(1000);
  var noRuns = Y.env.solver.runs === runs0;
  rY.tilt = 0.5 * Math.PI / 180; rY.wakeAll(); var stillAsleep = !rY.isActive();
  rY.tilt = 1.5 * Math.PI / 180; rY.wakeAll(); var woke = rY.isActive();
  rY.tilt = 0;
  check(asleep && noRuns && stillAsleep && woke, 'a paused glass at rest falls asleep (no runs for 1 s); wakeAll() wakes it only once its lean has changed by more than 1 degree since it slept');

  // asleep, a jolt wakes the glass at once (a flick never woke it: it is over before felt motion has
  // been held 0.3 s), and its first run starts from the jolt's first sample, so the push is felt;
  // the hand's jitter (0.2 g at 9 Hz) is no jolt
  var JW = makeApp({ ms: 10000, seed: 205 });
  var rJW = await JW.attach(); JW.calibrate(); JW.T.rem = JW.T.durationMs;
  JW.T.state = 'paused';
  await JW.run(3500);
  var jwAsleep = rJW.modes.mode === 'asleep', jwWhys = {};
  JW.motionIn = function (a, now) { return { fx: 0.2 * Math.sin(now * 2 * Math.PI * 9 / 1000), fy: 0, w: 0 }; };
  JW.onFrame = function () { jwWhys[rJW.modes.why] = true; };
  await JW.run(1000);
  JW.motionIn = null; JW.onFrame = null;
  await JW.run(3500);
  var jwAsleep2 = rJW.modes.mode === 'asleep', jolts0 = rJW.n.jolts, runs0J = JW.env.solver.runs;
  JW.env.recordFields = true; JW.env.solver.fields = [];
  var tFlick = JW.V.perf, wokeAfter = null, wokeFrames = null, framesJ = 0, firstRun = null, lastStart = tFlick;
  // (its first frame 0.2 g, under a jolt: the glass wakes in the second, from the first's samples)
  JW.motionIn = function (a, now) { var u = now - tFlick; return u <= 17 ? { fx: 0.2, fy: 0, w: 0 } : u <= 67 ? { fx: 2, fy: 0, w: 0 } : u <= 117 ? { fx: -2, fy: 0, w: 0 } : null; };
  JW.onFrame = function (a) {
    // (at the start of each frame: woken by the frame before, the first of the flick's)
    if (wokeAfter === null && rJW.modes.mode !== 'asleep') { wokeAfter = lastStart - tFlick; wokeFrames = framesJ; }
    if (firstRun === null && JW.env.solver.runs > runs0J) firstRun = JW.env.solver.fields.slice();
    framesJ++; lastStart = a.V.perf;
  };
  await JW.run(500, { seed: 4242 });          // (frames of 1/60 s from the first)
  JW.motionIn = null; JW.onFrame = null; JW.env.recordFields = false;
  var gx1 = firstRun ? firstRun.map(function (f) { return f.gravity[0] / rJW.Gg; }) : [NaN], push1 = Math.max.apply(null, gx1);
  check(jwAsleep && !jwWhys.jolt && jwAsleep2 && wokeFrames === 2 && rJW.n.jolts === jolts0 + 1 && gx1[0] > 0.05 && gx1[0] < 0.3 && push1 > 1,
    'asleep, a flick (a frame of 0.2 g, then 2 g for 50 ms and the stop) wakes the glass in the first frame of its 2 g (' + (wokeFrames === null ? 'never' : 'frame ' + wokeFrames + ', ending ' + Math.round(wokeAfter) + ' ms after it began') +
    '), and the first run starts from its first sample (its first substep ' + f1(gx1[0]) + ' g, then up to ' + f1(push1) + ' g); the hand\'s jitter is no jolt (' + Object.keys(jwWhys).join(', ') + ')');

  // ... and on a slow display (frames of 50 ms, a run each, as a busy GPU's page gives), woken by a
  // jolt within the frame, the first run is the time since the jolt's first sample alone, not the
  // whole frame's substeps laid over that time (which held the push for most of them: the bed was
  // thrown faster than at a run a frame). Control: the time since clamped at 0, as before
  async function slowWake(old) {
    var A = makeApp({ ms: 10000, seed: 206 });
    var rA = await A.attach(); A.calibrate(); A.T.rem = A.T.durationMs;
    A.T.state = 'paused';
    await A.run(3500);
    var asleep = rA.modes.mode === 'asleep', fj = rA._fromJolt, woke = null;
    rA._fromJolt = function (now, dt) { fj.call(this, now, dt); if (old) this._acc = Math.max(0, this._acc); woke = { now: now, from: this._lastRunPerf }; };
    var runs0 = A.env.solver.runs, first = null;
    A.env.recordFields = true; A.env.solver.fields = [];
    var tF = A.V.perf + 30;
    A.motionPerStep = true;
    A.motionIn = function (a, now) { var u = now - tF; return u < 0 ? null : u <= 50 ? { fx: 2, fy: 0, w: 0 } : u <= 100 ? { fx: -2, fy: 0, w: 0 } : null; };
    for (var k = 0; k < 6; k++) {
      A.V.frame++; A.env.pump(); await tick(); A.frame(50);
      if (first === null && A.env.solver.runs > runs0) first = A.env.solver.fields.slice();
    }
    A.motionIn = null; A.motionPerStep = false; A.env.recordFields = false;
    var hz = rA.rate.hz, gx = first ? first.map(function (f) { return f.gravity[0] / rA.Gg; }) : [];
    // (the longest stretch of substeps that hold one field, ms: the app's samples are 1/120 s apart)
    var hold = 0, h = 0;
    for (var i = 0; i < gx.length; i++) { h = i && gx[i] === gx[i - 1] ? h + 1 : 1; if (h > hold) hold = h; }
    return { asleep: asleep, sinceMs: woke ? woke.now - woke.from : null, runMs: first ? 1000 * first.length / hz : null, holdMs: 1000 * hold / hz, push: gx.length ? Math.max.apply(null, gx) : 0 };
  }
  var swNew = await slowWake(false), swOld = await slowWake(true);
  var swTxt = function (s) { return 'its first run ' + f1(s.runMs) + ' ms of substeps for ' + f1(s.sinceMs) + ' ms since the jolt, one field held at most ' + f1(s.holdMs) + ' ms, up to ' + f1(s.push) + ' g'; };
  check(swNew.asleep && swOld.asleep && swNew.sinceMs > 5 && swNew.sinceMs < 50 && Math.abs(swNew.runMs - swNew.sinceMs) <= 1000 / 480 + 0.5 && swNew.holdMs <= 1000 / 120 + 2.5 && swNew.push > 1 &&
    swOld.runMs >= swOld.sinceMs + 20 && swOld.holdMs > 1000 / 120 + 2.5,
    'a slow display (frames of 50 ms), woken by a flick within a frame: ' + swTxt(swNew) + '; with the time since clamped at 0 (control, as before) ' + swTxt(swOld));

  // the beds' fastest falls between readbacks cost the GPU only while a fall is possible: a glass
  // running in a hand that holds it still (0.01 g of tremor) never asks for them; a flick (2 g, then
  // -2 g, 50 ms each) asks from its first run until 0.5 s of simulated time after its last sample
  var BF = makeApp({ ms: 60000, seed: 207 });
  var rBF = await BF.attach(); BF.calibrate(); BF.T.rem = BF.T.durationMs; BF.start();
  var heldB = L.rng(19);
  BF.motionIn = function (a, now) { return { fx: 0.012 * (heldB() - 0.5), fy: 0.012 * (heldB() - 0.5), w: 0 }; };
  await BF.run(3000);
  BF.env.recordSets = [];
  await BF.run(4000);
  var setsHeld = BF.env.recordSets;
  BF.env.recordSets = [];
  var tFB = BF.V.perf;
  BF.motionIn = function (a, now) { var u = now - tFB; return u <= 50 ? { fx: 0, fy: 2, w: 0 } : u <= 100 ? { fx: 0, fy: -2, w: 0 } : { fx: 0.012 * (heldB() - 0.5), fy: 0.012 * (heldB() - 0.5), w: 0 }; };
  await BF.run(1500);
  BF.motionIn = null;
  var setsB = BF.env.recordSets, onB = setsB.filter(function (x) { return x.beds && x.steps > 0; });
  var firstOnB = onB.length ? onB[0].perf - tFB : null, lastOnB = onB.length ? onB[onB.length - 1].perf - tFB : null;
  var firstRunB = setsB.filter(function (x) { return x.steps > 0; })[0];
  check(setsHeld.length > 100 && setsHeld.every(function (x) { return !x.beds; }) && onB.length > 0 && firstRunB && firstRunB.beds &&
    lastOnB >= 100 + 450 && lastOnB <= 100 + 500 + 50 && setsB.filter(function (x) { return x.perf - tFB > 700; }).every(function (x) { return !x.beds; }),
    'the beds\' fastest falls are asked of the GPU only while a fall is possible: running, held still in the hand, never (' + setsHeld.filter(function (x) { return x.beds; }).length + ' of ' + setsHeld.length +
    ' runs); a flick from its first run (' + (firstRunB ? (firstRunB.beds ? 'asked' : 'not asked') : 'none') + ', ' + (firstOnB === null ? '-' : Math.round(firstOnB) + ' ms') + ') to ' + (lastOnB === null ? 'never' : Math.round(lastOnB) + ' ms') + ' after it began (its last sample at 100 ms), and not after');

  /* ------------------------------------------------------------------------------------ *
   *  The bed's sounds (design 8): the mock solver's sand does what the test says
   *  (lib/realsand-beds.js), one readback a frame late
   * ------------------------------------------------------------------------------------ */
  var B = require('./lib/realsand-beds.js');
  var one = function () { return 1; };
  /** n frames of 1/60 s; each(app, k) after each. */
  async function framesOf(app, n, each) {
    for (var k = 0; k < n; k++) { app.V.frame++; app.env.pump(); await tick(); app.frame(1000 / 60); if (each) each(app, k); }
  }
  /**
   * A scene: the glass is jolted awake (0.5 g sideways for 3 frames: full for 2 s after), 12
   * quiet frames, then the mock's beds follow list (one a run) from the scene's frame 15; the
   * record of every frame: { thump, slam, slides, agit, mode, active }.
   */
  async function scene(app, real, list, o) {
    o = o || {};
    var rec = [], f0 = null, pre = 15, lower = !!o.lower, n = list.length + (o.after === undefined ? 30 : o.after);
    var still = B.rest(real.points);
    app.env.beds = function (frame) {
      if (f0 === null) return null;
      var k = frame - f0 - pre, bed = k >= 0 && k < list.length ? list[k] : (o.hold && k >= list.length ? list[list.length - 1] : still);
      return lower ? B.beds(null, bed) : B.beds(bed, null);
    };
    var t0s = app.V.perf;
    app.motionIn = function (a, now) {
      var u = now - t0s;
      if (u <= 50) return { fx: 0.5, fy: 0, w: 0 };
      return o.motion ? o.motion(Math.round(u * 60 / 1000) - pre) : null;
    };
    f0 = app.V.frame + 1;
    await framesOf(app, pre + n, function (a) {
      var f = a.cpu.frame;
      rec.push({ k: a.V.frame - f0 - pre, th0: f.thump[0], x0: f.thump[1], th1: f.thump[2], slam: f.slam[0], x: f.slam[1], slides: f.slides, agit: real.agitation(), mode: real.modes.mode, active: real.isActive() });
    });
    app.env.beds = null; app.motionIn = null;
    return rec;
  }
  function fed(rec, key) { return rec.filter(function (r) { return r[key] > 0; }); }
  function sum(rec, key) { return rec.reduce(function (a, r) { return a + r[key]; }, 0); }
  var SO = makeApp({ ms: 300000, seed: 301, lag: one });
  var rSO = await SO.attach(); SO.calibrate(); SO.T.rem = SO.T.durationMs;
  var GH = rSO.Gg * rSO.glass.HBc, toss = B.toss({ n: rSO.points, up: 60, down: 86, stop: 2 }), Ewant = 86 * 86 / (2 * GH);
  await framesOf(SO, 60);                    // (a fresh bed settles unheard for 0.4 s)
  // before the start (idle): the bed is thrown, falls back at 86 cells/s and is stopped by the glass
  var s1 = await scene(SO, rSO, toss.list), th1 = fed(s1, 'th0');
  check(SO.T.state === 'idle' && th1.length === 1 && Math.abs(th1[0].th0 / Ewant - 1) < 1e-3 && th1[0].k === toss.stopped + 1 && fed(s1, 'slam').length === 0 && fed(s1, 'th1').length === 0,
    'before the start, a bed thrown and stopped by the glass at 86 cells/s feeds one thump of the classic sand\'s energy for that landing, u^2 / (2 G HB) = ' + Ewant.toFixed(4) +
    ' (' + th1.map(function (r) { return r.th0.toFixed(4) + ' in frame ' + r.k; }).join(', ') + '; the bed at half its speed in run ' + toss.stopped + ', its readback a frame later), in the upper bulb, and no slam');
  // ... on an engine that hears nothing (as before this work), the same scene feeds nothing (control)
  await framesOf(SO, 90);                    // (the landing's heat has faded)
  var hearWas = rSO._hear; rSO._hear = function () {};
  var s1c = await scene(SO, rSO, toss.list);
  rSO._hear = hearWas;
  check(fed(s1c, 'th0').length === 0 && sum(s1c, 'slides') === 0 && Math.max.apply(null, s1c.map(function (r) { return r.agit; })) === 0,
    '... and with the readbacks unheard (control: the engine as it was) the same scene feeds no thump, no slide and no agitation');
  // the landing heats the bed (the classic's E HB / 3) and the heat is gone at rest
  var aPeak = Math.max.apply(null, s1.map(function (r) { return r.agit; })), aEnd = s1[s1.length - 1].agit, heat = Ewant * SO.cpu.geo.HB / 3;
  check(aPeak > heat && aPeak < heat + 0.6 && aEnd < 0.3 * aPeak,
    'the landing heats the bed as the classic sand\'s does (E HB / 3 = ' + heat.toFixed(2) + ' on top of what its fall stirred: agitation up to ' + aPeak.toFixed(2) + '), fading after (' + aEnd.toFixed(2) + ' half a second on)');
  // sideways at the same speeds: stopped by the side of the glass, no landing (the classic sand's slip lands nothing)
  var s2 = await scene(SO, rSO, B.toss({ n: rSO.points, up: 60, down: 86, stop: 2, axis: 'x' }).list);
  // slowed by the field, not by the glass: falling at 86, then the hand pulls the glass down at 2 g (the field 1 g upward) and the bed slows by 35.75 a run
  var slowed = [0, -35.75, -71.5, -86, -86, -50.25, -14.5, 0, 0, 0].map(function (v) { return B.bed([{ n: rSO.points, v: [0, v] }]); });
  var s3 = await scene(SO, rSO, slowed, { motion: function (k) { return k >= 5 && k <= 7 ? { fx: 0, fy: -2, w: 0 } : null; } });
  check(fed(s2, 'th0').length === 0 && fed(s2, 'slam').length === 0 && fed(s3, 'th0').length === 0 && fed(s3, 'slam').length === 0,
    'a bed stopped sideways lands nothing, and one that the field slows (the glass pulled away under it) has not landed: no thump, no slam (' +
    (fed(s2, 'th0').length + fed(s2, 'slam').length) + ', ' + (fed(s3, 'th0').length + fed(s3, 'slam').length) + ')');
  // thrown to the far end: the field upward (the glass pulled down at 2 g), the bed rising at 80 and stopped there
  var far = [40, 80, 80, 80, 40, 0, 0, 0].map(function (v) { return B.bed([{ n: rSO.points, v: [0, v] }], 12); });
  var s4 = await scene(SO, rSO, far, { motion: function (k) { return k >= -2 && k <= 6 ? { fx: 0, fy: -2, w: 0 } : null; } }), sl4 = fed(s4, 'slam');
  var Eslam = 80 * 80 / (2 * GH);
  check(sl4.length === 1 && Math.abs(sl4[0].slam / Eslam - 1) < 1e-3 && fed(s4, 'th0').length === 0 && Math.abs(sl4[0].x - 12 / rSO.glass.Rc) < 1e-6 && sl4[0].k === 5,
    'a bed thrown at the far end of its bulb (the field upward, 80 cells/s) and stopped there feeds one slam of ' + Eslam.toFixed(4) + ' (' + sl4.map(function (r) { return r.slam.toFixed(4) + ' in frame ' + r.k; }).join(', ') +
    '), at the bed\'s place across the bulb (' + (sl4[0] ? sl4[0].x.toFixed(2) : '-') + '), and no thump');
  // slides: 200 of the bed's points sliding at 60 cells/s, the rest at rest; the classic's count at the calibrated share
  // (their speed beyond the bed's own and beyond the speed a point moves from: 2 % of a free fall over the glass)
  var N = rSO.points, slideBed = B.bed([{ n: N - 200 }, { n: 200, v: [60, 0] }]), still = 0.02 * Math.sqrt(2 * rSO.Gg * rSO.glass.H);
  // (... as the classic sand's slides: 16 over the square root of the bed's grains of it, the calibrated share)
  var share = 16 / Math.sqrt(N / rSO.ppg), rateWant = share * 200 * (60 - Math.max(200 * 60 / N, still)) / (rSO.s * rSO.ppg);
  // (a bed that only creeps, 300 of its points just over that speed, slides next to nothing: under 1,000 a second)
  var creepBed = B.bed([{ n: N - 300 }, { n: 300, v: [0, 24.2] }]);
  var s5k = await scene(SO, rSO, [creepBed], { hold: true, after: 60 }), creep = sum(s5k.filter(function (r) { return r.k >= 5; }), 'slides') / s5k.filter(function (r) { return r.k >= 5; }).length * 60;
  var s5 = await scene(SO, rSO, [slideBed], { hold: true, after: 240 });
  // (full for 2 s after the jolt, calm after: the same slides a frame in both)
  var full5 = s5.filter(function (r) { return r.k >= 5 && r.mode === 'full'; }), calm5 = s5.filter(function (r) { return r.mode === 'calm'; });
  var perF = function (a) { return sum(a, 'slides') / a.length * 60; };
  var body = B.bed([{ n: N, v: [60, 0] }]);
  var s5c = await scene(SO, rSO, [body], { hold: true, after: 60 });
  check(full5.length > 60 && calm5.length > 60 && Math.abs(perF(full5) / rateWant - 1) < 0.02 && Math.abs(perF(calm5) / rateWant - 1) < 0.02 &&
    calm5.every(function (r) { return r.slides > 0; }) && sum(s5c.filter(function (r) { return r.k >= 2; }), 'slides') === 0 && fed(s5, 'th0').length === 0 && Math.abs(B.STILL - still) < 0.1 && creep < 300,
    'sand sliding within the bed (200 points at 60 cells/s) feeds the classic\'s slides at the calibrated share (' + share.toFixed(2) + ' for this bed of ' + Math.round(N / rSO.ppg) + ' grains), ' + Math.round(rateWant) + ' a second (full: ' + Math.round(perF(full5)) + ', calm, a run every other frame: ' + Math.round(perF(calm5)) +
    ', in every frame); the whole bed moving as one body at that speed slides nothing (control: ' + sum(s5c.filter(function (r) { return r.k >= 2; }), 'slides') + '), and one that only creeps next to nothing (' + Math.round(creep) + ' a second)');
  // agitation: the bed thrown from side to side at +-100 cells/s, 5 Hz (its acceleration 0.93 g on average); then at rest
  var shake = [];
  for (var qk = 0; qk < 90; qk++) shake.push(B.bed([{ n: N, v: [100 * Math.sin(2 * Math.PI * 5 * qk / 60), 0] }]));
  var s6 = await scene(SO, rSO, shake, { after: 150 });
  var a6 = s6.filter(function (r) { return r.k >= 45 && r.k < 90; }).map(function (r) { return r.agit; }), a6lo = Math.min.apply(null, a6), a6hi = Math.max.apply(null, a6);
  var back6 = s6.filter(function (r) { return r.k >= 90 && r.agit === 0; })[0];
  // (control: the same bed drifting at a steady 100 cells/s: no acceleration but the start's)
  var s6c = await scene(SO, rSO, [B.bed([{ n: N, v: [100, 0] }])], { hold: true, after: 60 });
  var a6c = Math.max.apply(null, s6c.filter(function (r) { return r.k >= 45; }).map(function (r) { return r.agit; }));
  check(a6lo > 0.4 && a6hi < 1.2 && back6 && back6.k - 90 < 90 && a6c < 0.05 && fed(s6, 'th0').length === 0 && fed(s6, 'slam').length === 0,
    'a bed thrown from side to side at 100 cells/s, 5 Hz is agitated as its own acceleration over the glass says (' + a6lo.toFixed(2) + ' to ' + a6hi.toFixed(2) + ' while shaken, 0.93 g on average), with no landing, and exactly 0 again ' +
    (back6 ? ((back6.k - 90) / 60).toFixed(2) + ' s' : 'never') + ' after it rests; one drifting at a steady speed is not (control: ' + a6c.toFixed(3) + ')');
  // at rest nothing is fed: awake (running, the stream flowing) with both beds still
  SO.start();
  var rest7 = [];
  SO.env.beds = function () { return B.beds(B.rest(rSO.valve.Pts(rSO.nTop)), B.rest(rSO.valve.Pts(rSO.nBottom))); };
  await framesOf(SO, 90);                    // (the last scene's drift has stopped and faded)
  await framesOf(SO, 150, function (a) { var f = a.cpu.frame; rest7.push({ th0: f.thump[0], th1: f.thump[2], slam: f.slam[0], slides: f.slides, agit: rSO.agitation(), mode: rSO.modes.mode }); });
  SO.env.beds = null;
  check(rest7.every(function (r) { return r.mode !== 'asleep'; }) && sum(rest7, 'th0') + sum(rest7, 'th1') + sum(rest7, 'slam') + sum(rest7, 'slides') + sum(rest7, 'agit') === 0 && SO.cpu.frame.released >= 0,
    'at rest nothing is fed: a running glass, awake, its beds still: no thump, slam, slide or agitation in 150 frames (the stream\'s own record goes on)');
  // running, and paused: the same landing, the same thump
  var s8 = await scene(SO, rSO, toss.list), th8 = fed(s8, 'th0');
  SO.T.state = 'paused';
  var s9 = await scene(SO, rSO, toss.list), th9 = fed(s9, 'th0');
  check(th8.length === 1 && Math.abs(th8[0].th0 / Ewant - 1) < 1e-3 && th9.length === 1 && Math.abs(th9[0].th0 / Ewant - 1) < 1e-3,
    'running and paused, the same landing feeds the same thump (' + th8.map(function (r) { return r.th0.toFixed(4); }).join() + ' running, ' + th9.map(function (r) { return r.th0.toFixed(4); }).join() + ' paused)');
  // asleep: silent; and never kept awake by sound (sliding beds in the readbacks, the tally's own count of moving points 0)
  await framesOf(SO, 200);
  SO.env.bedsMove = false;
  var sleepAt = null, fedAsleep = 0, fedAwake = 0, t0SO = SO.V.perf;
  SO.env.beds = function () { return B.beds(slideBed, null); };
  SO.motionIn = function (a, now) { return now - t0SO <= 50 ? { fx: 0.5, fy: 0, w: 0 } : null; };
  await framesOf(SO, 400, function (a, k) {
    var f = a.cpu.frame, asl = rSO.modes.mode === 'asleep';
    if (asl && sleepAt === null) sleepAt = k;
    // (the app passes the record on only in a frame it counts active; agitation in every frame)
    var got = (rSO.isActive() ? f.thump[0] + f.thump[2] + f.slam[0] + f.slides : 0) + rSO.agitation();
    if (asl) fedAsleep += got; else fedAwake += got;
  });
  SO.env.beds = null; SO.env.bedsMove = undefined; SO.motionIn = null;
  // (the same glass, jolted the same and left, with no beds in its readbacks, falls asleep after as many frames: control)
  var S2 = makeApp({ ms: 300000, seed: 301, lag: one });
  var rS2 = await S2.attach(); S2.calibrate(); S2.T.rem = S2.T.durationMs; S2.T.state = 'paused';
  await framesOf(S2, 200);
  var t0S2 = S2.V.perf, sleep2 = null;
  S2.motionIn = function (a, now) { return now - t0S2 <= 50 ? { fx: 0.5, fy: 0, w: 0 } : null; };
  await framesOf(S2, 400, function (a, k) { if (sleep2 === null && rS2.modes.mode === 'asleep') sleep2 = k; });
  S2.motionIn = null;
  check(sleepAt !== null && fedAwake > 0 && fedAsleep === 0 && !rSO.isActive() && rSO.agitation() === 0 && sleep2 !== null && Math.abs(sleepAt - sleep2) <= 2,
    'a sleeping glass is silent, and sound never keeps it awake: jolted and left, with sliding beds in every readback but no point moving by the tally\'s own count, it sleeps after ' + sleepAt +
    ' frames (the same with no beds heard: ' + sleep2 + '), fed while awake, nothing after (' + fedAsleep + ', agitation ' + rSO.agitation() + ')');
  // hidden: nothing; back in view, the beds are heard afresh
  var s10 = await scene(SO, rSO, [slideBed], { hold: true, after: 20 });
  var before10 = rSO.stats().sound.slides;
  rSO.setHidden(true);
  var hid = { agit: rSO.agitation(), slides: rSO.stats().sound.slides };
  rSO.setHidden(false);
  check(before10 > 0 && sum(s10, 'slides') > 0 && hid.agit === 0 && hid.slides === 0,
    'hidden, nothing of the bed is heard (slides ' + Math.round(before10) + ' a second before, ' + hid.slides + ' hidden; agitation ' + hid.agit + ')');
  // finished: all the sand below; the lower bed thrown and landing feeds the lower bulb's thump
  var SD = makeApp({ ms: 10000, seed: 303, lag: one });
  var rSD = await SD.attach(); SD.calibrate(); SD.T.rem = SD.T.durationMs; SD.start();
  await runGlass(SD, 10000);
  var tossD = B.toss({ n: rSD.points, up: 60, down: 86, stop: 2 });
  var s11 = await scene(SD, rSD, tossD.list, { lower: true }), th11 = fed(s11, 'th1');
  check(SD.T.state === 'done' && rSD.nTop === 0 && th11.length === 1 && Math.abs(th11[0].th1 / Ewant - 1) < 1e-3 && fed(s11, 'th0').length === 0,
    'finished (all the sand below), the lower bed\'s landing feeds the lower bulb\'s thump (' + th11.map(function (r) { return r.th1.toFixed(4) + ' in frame ' + r.k; }).join(', ') + '), none for the upper');

  // a few crowded points are no bed: a 10 s glass just started, the plug of the stream under its neck (as the
  // real engine's readbacks gave it: 5 points slowing from 59 to 27 cells/s) lands nothing and stirs nothing
  var PL = makeApp({ ms: 10000, seed: 307, lag: one });
  var rPL = await PL.attach(); PL.calibrate(); PL.T.rem = PL.T.durationMs;
  await framesOf(PL, 60);
  PL.start();
  var plugV = [-58.9, -47.1, -35.3, -26.8, -26, -19.7, -24.4, -23.5], GHp = rPL.Gg * rPL.glass.HBc, Eplug = 58.9 * 58.9 / (2 * GHp);
  var plugOf = function (n) { return plugV.map(function (v) { return B.bed([{ n: n, v: [0, v] }]); }); };
  var s12 = await scene(PL, rPL, plugOf(5), { lower: true });
  // (control: the same speeds of a bed, 5 % of the glass's points, are a landing)
  var nBed = Math.ceil(0.05 * rPL.points), s12c = await scene(PL, rPL, plugOf(nBed), { lower: true }), th12c = fed(s12c, 'th1');
  var a12 = Math.max.apply(null, s12.map(function (r) { return r.agit; })), a12c = Math.max.apply(null, s12c.map(function (r) { return r.agit; }));
  check(PL.T.state === 'running' && fed(s12, 'th0').length + fed(s12, 'th1').length + fed(s12, 'slam').length === 0 && sum(s12, 'slides') === 0 && a12 === 0 &&
    th12c.length === 1 && Math.abs(th12c[0].th1 / Eplug - 1) < 1e-3 && a12c > 0.3,
    'a few crowded points are no bed: the plug of the stream under the neck of a glass just started (5 points slowing from 59 to 27 cells/s) feeds no thump, slam, slide or agitation (' +
    (fed(s12, 'th0').length + fed(s12, 'th1').length + fed(s12, 'slam').length) + ', ' + sum(s12, 'slides') + ', ' + a12 + '); the same speeds of a bed of ' + nBed + ' points (5 % of the glass\'s ' + rPL.points +
    ') land a thump of ' + (th12c[0] ? th12c[0].th1.toFixed(4) : '-') + ' and stir it to ' + a12c.toFixed(2) + ' (control)');

  /* The same rules one readback at a time: the adapter's own _hear, _bedSound and agitation() on a glass
   * of its own, awake, the clock moved by hand (the mock's runs and frames left out). */
  function hearer(app, real) {
    real.modes.mode = 'full'; real._quiet(false); real._snd.muteUntil = -Infinity;
    var N = real.points;
    /** One readback dtMs after the last (o.none: none came): what the next frame is fed, and the agitation. */
    return function (dtMs, up, lo, o) {
      o = o || {};
      app.V.perf += dtMs; app.V.wall += dtMs;
      if (!o.none) real._hear({ snd: { dt: dtMs / 1000, ax: 0, ay: -real.Gg, sx: 0, sy: -1, turn: false } },
        { above: o.above === undefined ? N : o.above, below: o.below || 0, beds: B.beds(up, lo) }, real.valve.parity);
      var f = { thump: new Float32Array(4), slam: new Float32Array(2), slides: 0, moved: 0 };
      real._bedSound(f, app.V.perf);
      return { th0: f.thump[0], th1: f.thump[2], slam: f.slam[0], slides: f.slides, rate: real._snd.rate, agit: real.agitation() };
    };
  }
  var HR = makeApp({ ms: 60000, seed: 309, lag: one });
  var rHR = await HR.attach(); HR.calibrate(); HR.T.rem = HR.T.durationMs;
  var hear = hearer(HR, rHR), NH = rHR.points, GHh = rHR.Gg * rHR.glass.HBc, F60 = 1000 / 60, k13;
  // a thrown bed flies, it does not slide. 300 of the bed's points sliding at 60 cells/s: heard while the bed is
  // packed; thrown loose (60 % of its bulb's points still crowded) nothing, nor while it packs again (85 %),
  // and heard again once packed
  var within = function (n) { return B.bed([{ n: n - 300 }, { n: 300, v: [60, 0] }]); };
  for (k13 = 0; k13 < 5; k13++) var packed13 = hear(F60, within(NH), null);
  for (k13 = 0; k13 < 5; k13++) var loose13 = hear(F60, within(Math.round(0.6 * NH)), null);
  for (k13 = 0; k13 < 5; k13++) var packing13 = hear(F60, within(Math.round(0.85 * NH)), null);
  for (k13 = 0; k13 < 5; k13++) var again13 = hear(F60, within(NH), null);
  // ... nor while it moves as a body along the glass (90 cells/s, the same 300 points 60 across it): the classic
  // sand's bed in the air slides nothing; moving as fast across the glass it slides (control)
  for (k13 = 0; k13 < 5; k13++) var along13 = hear(F60, B.bed([{ n: NH - 300, v: [0, 90] }, { n: 300, v: [60, 90] }]), null);
  for (k13 = 0; k13 < 5; k13++) var across13 = hear(F60, B.bed([{ n: NH - 300, v: [90, 0] }, { n: 300, v: [90, 60] }]), null);
  check(packed13.rate > 1000 && loose13.rate === 0 && packing13.rate === 0 && Math.abs(again13.rate / packed13.rate - 1) < 1e-9 && along13.rate === 0 && across13.rate > 300 &&
    packed13.th0 + loose13.th0 + packing13.th0 + again13.th0 === 0,
    'a thrown bed flies, it does not slide: sand sliding within a packed bed is heard (' + Math.round(packed13.rate) + ' slides a second); the same within a bed thrown loose (60 % of its bulb\'s points crowded) is not (' +
    Math.round(loose13.rate) + '), nor while it packs again (85 %: ' + Math.round(packing13.rate) + '), and it is once packed (' + Math.round(again13.rate) + '); a packed bed moving along the glass as a body at 90 cells/s slides nothing (' +
    Math.round(along13.rate) + '), across the glass it does (control: ' + Math.round(across13.rate) + ')');
  // the landing's window is counted in time, not in runs: a bed falling at 86 cells/s that the glass slows
  // to half that speed in 0.12 s and then stops lands the same thump whatever the display's rate
  var Efall = 86 * 86 / (2 * GHh), landed = [], slow14 = [];
  [60, 120, 180].forEach(function (hz) {
    [0.12, 0.2].forEach(function (halfS) {
      rHR._quiet(false);
      var E = 0, n = 0;
      hear(1000 / hz, B.rest(NH), null);
      for (var q = 0; q / hz <= halfS + 0.1; q++) {
        var tq = q / hz, r = hear(1000 / hz, B.bed([{ n: NH, v: [0, tq <= halfS + 1e-9 ? -86 * (1 - 0.5 * tq / halfS) : 0] }]), null);
        if (r.th0 > 0) { E += r.th0; n++; }
      }
      (halfS === 0.12 ? landed : slow14).push({ hz: hz, n: n, E: E });
    });
  });
  check(landed.every(function (l) { return l.n === 1 && Math.abs(l.E / Efall - 1) < 1e-6; }) && slow14.every(function (l) { return l.E < 0.5 * Efall; }),
    'the landing\'s window is time, not runs: a bed falling at 86 cells/s that the glass slows to half in 0.12 s lands one thump of ' + Efall.toFixed(4) + ' at 60, 120 and 180 runs a second (' +
    landed.map(function (l) { return l.hz + ': ' + l.n + ' of ' + l.E.toFixed(4); }).join(', ') + '); slowed to half only in 0.2 s it has not landed at that speed, only as fast as the glass then stopped it (control: ' +
    slow14.map(function (l) { return l.E.toFixed(4); }).join(', ') + ')');
  // a slow pace: one run (and one readback) every 2, 4 or 6 display frames at 60 Hz, 8 substeps a frame
  // (480 Hz), as a busy GPU gives. A bed thrown up at 60 cells/s falls back to 86 cells/s and the glass
  // stops it in 2 frames' time (the field 2145 cells/s^2 throughout); every phase of the toss against the
  // runs. With the engine's fastest fall between readbacks (bed.peak: the bed at the end of each substep
  // but a run's last, along the field) each toss lands one thump of the fall's energy within 1.5 dB, at
  // the readback of the run in which the glass stopped it or the next. Without it (control: the tally
  // alone, as before build 8) some phases land none or one far too weak.
  // o.launch: s the bed is first thrown up by the field turned round (as a flick's stop turns it: up
  // at the bed's own pace, the field up/launch cells/s^2 toward the top), each substep's field then
  // given to the run (q.f); the engine keeps the fastest fall toward the glass's floor (-y)
  function paceToss(every, hz, sub, withPeak, up, o) {
    o = o || {};
    var g = rHR.Gg, stopS = 2 / 60, down = 86, tL = o.launch || 0;
    var vAt = function (t) {
      var tUp = up / g, tDown = down / g;
      if (t < 0) return 0;
      if (t < tL) return up * t / tL;
      t -= tL;
      if (t < tUp) return up - g * t;
      t -= tUp; if (t < tDown) return -g * t;
      t -= tDown; if (t < stopS) return -down * (1 - t / stopS);
      return 0;
    };
    var gAt = function (t) { return t >= 0 && t < tL ? up / tL : -g; };
    var bedAt = function (v) { return v === 0 ? B.rest(NH) : B.bed([{ n: NH, v: [0, v] }]); };
    var tStop = tL + up / g + down / g + stopS / 2;          // (the bed at half its speed)
    var rows = [];
    for (var ph = 0; ph < every; ph++) {
      rHR._quiet(false); rHR._snd.muteUntil = -Infinity;
      for (var w0 = 0; w0 < 10; w0++) hear(1000 / hz, B.rest(NH), null);
      var nSub = every * sub, dtSub = 1 / (hz * sub), t0 = -ph / hz, E = 0, n = 0, late = null;
      for (var r = 0; r < Math.ceil((0.5 + tL) * hz / every) + 2; r++) {
        // the run's substeps: the fastest fall at the end of every BEDS_EVERY-th back from the last, not
        // the last itself (solver.mjs; none faster than 0: none kept)
        var best = null, bestV = 0, fs = [], gm = 0;
        for (var s = 0; s < nSub; s++) {
          var ts = t0 + (r * nSub + s + 1) * dtSub, vs = vAt(ts), gs = gAt(ts);
          fs.push({ gravity: [0, gs] }); gm += gs / nSub;
          if (s < nSub - 1 && (nSub - 1 - s) % SOL.BEDS_EVERY === 0 && -vs > bestV) { bestV = -vs; best = s; }
        }
        var tEnd = t0 + (r + 1) * nSub * dtSub, end = bedAt(vAt(tEnd));
        var bed = withPeak ? B.withPeak(end, best === null ? null : bedAt(-bestV), best) : end;
        HR.V.perf += 1000 * every / hz; HR.V.wall += 1000 * every / hz;
        rHR._hear({ snd: { dt: every / hz, n: nSub, hz: hz * sub, ax: 0, ay: tL ? gm : -g, f: tL ? fs : undefined, sx: 0, sy: -1, turn: false } }, { above: NH, below: 0, beds: B.beds(bed, null) }, rHR.valve.parity);
        var f = { thump: new Float32Array(4), slam: new Float32Array(2), slides: 0, moved: 0 };
        rHR._bedSound(f, HR.V.perf);
        if (f.thump[0] > 0) {
          E += f.thump[0]; n++;
          // (runs after the one in which the glass had it at half speed)
          late = Math.floor((tEnd - tStop) / (every / hz) - 1e-9);
        }
        if (f.slam[0] > 0) n += 100;
      }
      rows.push({ ph: ph, n: n, E: E / Efall, late: late });
    }
    return rows;
  }
  var dB = function (x) { return x > 0 ? 10 * Math.log10(x) : -Infinity; };
  var paceOk = function (rows) { return rows.every(function (p) { return p.n === 1 && Math.abs(dB(p.E)) <= 1.5 && p.late >= 0 && p.late <= 1; }); };
  var paceTxt = function (rows) { return rows.map(function (p) { return p.n + 'x' + (p.n ? dB(p.E).toFixed(1) + ' dB' : '') + (p.late > 0 ? ' (a run late)' : ''); }).join(' '); };
  var pace15 = [2, 4, 6].map(function (every) { return { every: every, rows: paceToss(every, 60, 8, true, 60), ball: paceToss(every, 60, 8, true, 86), ctl: paceToss(every, 60, 8, false, 60) }; });
  check(pace15.every(function (p) { return paceOk(p.rows) && paceOk(p.ball); }) && pace15.some(function (p) { return !paceOk(p.ctl); }),
    'a slow pace (a run every 2, 4 and 6 frames, every phase of the toss): one thump a fall, within 1.5 dB of the fall\'s energy and at most a run late, from the engine\'s fastest fall between readbacks: ' +
    pace15.map(function (p) { return 'every ' + p.every + ': ' + paceTxt(p.rows) + '; thrown up at 86: ' + paceTxt(p.ball); }).join(' | ') +
    '; from the readbacks alone (control, as before) not: ' + pace15.map(function (p) { return 'every ' + p.every + ': ' + paceTxt(p.ctl); }).join(' | '));
  // ... and a flick: the bed is thrown up by the field turned round (the flick's stop: 0.1 s of it, the
  // bed up to 86 cells/s), then falls back under gravity and lands; each substep's field goes with the
  // run. A readback may see the bed going up with that field (a motion along the field, under way) and
  // the run after it hold the fall: the fastest fall toward the glass's floor ends the motion up (the
  // field turned it round) and lands one thump a fall within 1.5 dB, at most a run late. From the
  // readbacks alone (control) some phases land none or one far too weak
  var flick15 = [2, 4, 6].map(function (every) {
    return { every: every, rows: paceToss(every, 60, 8, true, 86, { launch: 0.1 }), ctl: paceToss(every, 60, 8, false, 86, { launch: 0.1 }) };
  });
  check(flick15.every(function (p) { return paceOk(p.rows); }) && flick15.some(function (p) { return !paceOk(p.ctl); }),
    'a flick at a slow pace (thrown up by the field turned round, then falling and landing): one thump a fall within 1.5 dB, at most a run late, from the fastest fall toward the glass\'s floor: ' +
    flick15.map(function (p) { return 'every ' + p.every + ': ' + paceTxt(p.rows); }).join(' | ') +
    '; from the readbacks alone (control) not: ' + flick15.map(function (p) { return 'every ' + p.every + ': ' + paceTxt(p.ctl); }).join(' | '));
  // a slip is no landing: after a sideways shake the sand thrown up the wall slides back down it (55 degrees
  // from the level, as the GPU sand does down the funnel) into the rest of the bed, which lies still. Half the
  // bed moving at 2.8 times the speed of the faintest landing makes the bed's mean fall at 1.4 times it along
  // the glass, and the heap stops it within 2 runs: no thump, no slam. The same mean motion with the whole bed
  // moving as one body, stopped the same, is a landing (control: one thump, of that speed's energy)
  var uM17 = Math.sqrt(2 * 0.0015 * GHh), dir17 = [-Math.cos(55 * Math.PI / 180), -Math.sin(55 * Math.PI / 180)];
  var at17 = function (k) { return [k * dir17[0], k * dir17[1]]; };
  function land17(body) {
    rHR._quiet(false);
    var out = { th: 0, n: 0, slam: 0, phi: 0 };
    var seq = body ? [B.rest(NH), B.bed([{ n: NH, v: at17(1.4 * uM17) }]), B.bed([{ n: NH, v: at17(0.45 * uM17) }]), B.rest(NH), B.rest(NH)]
      : [B.rest(NH), B.bed([{ n: NH - Math.round(NH / 2) }, { n: Math.round(NH / 2), v: at17(2.8 * uM17) }]),
        B.bed([{ n: NH - Math.round(0.3 * NH) }, { n: Math.round(0.3 * NH), v: at17(1.5 * uM17) }]), B.rest(NH), B.rest(NH)];
    out.phi = seq[1].sliding / seq[1].n; out.sp = Math.hypot(seq[1].vx, seq[1].vy) / uM17;
    seq.forEach(function (bd) { var r = hear(F60, bd, null); if (r.th0 > 0) { out.th += r.th0; out.n++; } out.slam += r.slam; });
    return out;
  }
  var slip17 = land17(false), body17 = land17(true), Ebody17 = Math.pow(1.4 * uM17, 2) / (2 * GHh);
  check(slip17.n === 0 && slip17.slam === 0 && Math.abs(slip17.sp - 1.4) < 0.01 && body17.n === 1 && Math.abs(body17.th / Ebody17 - 1) < 1e-6 && body17.slam === 0,
    'a slip is no landing: sand sliding back down the wall into a still bed (half its points moving, the bed\'s mean falling at ' + slip17.sp.toFixed(2) +
    ' times the speed of the faintest landing, stopped within 2 runs) feeds no thump or slam (' + slip17.n + ', ' + slip17.slam + '); the same fall with the whole bed moving as one body lands one thump of ' +
    body17.th.toFixed(4) + ' (control: ' + Ebody17.toFixed(4) + ')');
  // a stall: no readback for a second while the sand was stirred. What was stirred has faded by the clock,
  // and the next readback (the bed at rest) does not bring it back
  rHR._quiet(false);
  var shaken = function (q) { return B.bed([{ n: NH, v: [100 * Math.sin(2 * Math.PI * 5 * q / 60), 0] }]); };
  for (k13 = 0; k13 < 60; k13++) var stirred15 = hear(F60, shaken(k13), null);
  var stalled15 = hear(1000, null, null, { none: true }), back15 = hear(F60, B.rest(NH), null);
  // (control: with no stall the readback after the shake still carries most of it: it fades with its memory, not at once)
  rHR._quiet(false);
  for (k13 = 0; k13 < 60; k13++) hear(F60, shaken(k13), null);
  var next15 = hear(F60, B.rest(NH), null);
  check(stirred15.agit > 0.4 && stalled15.agit < 0.05 && back15.agit < 0.05 && next15.agit > 0.7 * stirred15.agit,
    'a stall does not bring a faded shimmer back: stirred to ' + stirred15.agit.toFixed(2) + ', then no readback for 1 s (agitation ' + stalled15.agit.toFixed(3) + '), the next readback, the bed at rest, reads ' +
    back15.agit.toFixed(3) + '; with no stall the readback after the shake still reads ' + next15.agit.toFixed(2) + ' (control)');
  // the same GPU motion is the same sound at every grain and size of the app's lattice: the app divides the
  // slides by the lattice's grains and cells (app.js feedAudio: fine^3; a tablet's lattice is 1.3 / 1.08 finer)
  var perEar = [];
  for (var u16 of [{ q: 1.08, fine: 1, name: 'phone' }, { q: 1.08, fine: Math.SQRT2, name: 'Fine' }, { q: 1.08, fine: 2, name: 'Finest' }, { q: 1.3, fine: 1, name: 'tablet' }]) {
    var U16 = makeApp({ ms: 10000, q: u16.q, fine: u16.fine, seed: 311, lag: one });
    var rU16 = await U16.attach(), hear16 = hearer(U16, rU16), r16 = null, lat = u16.q * u16.fine / 1.08;
    // (1,600 of the bed's points drifting at 30 cells/s, 300 at 30 and 80 across them: every one of them moving)
    for (k13 = 0; k13 < 5; k13++) r16 = hear16(F60, B.bed([{ n: 1600, v: [30, 0] }, { n: 300, v: [30, 80] }]), null, { above: 1900 });
    perEar.push({ name: u16.name, s: rU16.s, rate: r16.rate, ear: r16.rate / (lat * lat * lat) });
    if (U16.restorePace) U16.restorePace();
  }
  check(perEar[0].ear > 1000 && perEar.every(function (e) { return Math.abs(e.ear / perEar[0].ear - 1) < 1e-6; }),
    'the same motion of the same GPU bed is the same sound at every lattice of the app: its slides, divided by the lattice\'s grains and cells as the app divides them, are ' +
    perEar.map(function (e) { return Math.round(e.ear) + ' a second (' + e.name + ', s ' + e.s.toFixed(3) + ')'; }).join(', '));

  // a device lost while hidden (a lock): the CPU takes over with the clock untouched, the GPU comes back on return
  var Z = makeApp({ ms: 10000, seed: 131 });
  var rZ = await Z.attach(); Z.calibrate(); Z.T.rem = Z.T.durationMs; Z.start();
  await Z.run(3000);
  Z.hide(2000);
  var remHidden = Z.T.rem, topHidden = Z.sim.nTop;
  Z.env.device.loseIt('unknown', 'reclaimed');
  await tick(); await tick();
  var tookOver = Z.sim === Z.cpu && Z.losses.length === 1 && Z.losses[0].lifecycle && !Z.losses[0].message && Z.cpu.nTop === topHidden && Z.T.rem === remHidden;
  if (process.env.VERBOSE) log('      lost: ' + JSON.stringify({ cpu: Z.sim === Z.cpu, losses: Z.losses, top: Z.cpu.nTop, topHidden: topHidden, rem: Z.T.rem, remHidden: remHidden }));
  await runGlass(Z, 7000, []);
  check(tookOver && Z.backs === 1 && Z.sim === rZ,
    'a device lost while hidden: the CPU Sim takes over at once with ' + topHidden + ' grains above and the clock untouched, no toast; rebuilt, adopted and back once visible');
  endOk(Z, 'the glass after a lost device');

  // the swap frame: a run skipped after a swap turns the canvas half a turn until the flip pass is drawn
  var Q = makeApp({ ms: 10000, seed: 141 });
  var rQ = await Q.attach(); Q.calibrate(); Q.T.rem = Q.T.durationMs; Q.start();
  var turned = 0, wrong = 0, held = null;
  // every readback slot busy for the swap's frame and the next: those runs are skipped
  Q.onSwap = function (a) { var m = a.env.solver; held = { rb: m.readbacks, until: a.V.frame + 2 }; m.readbacks = [{ pending: true }, { pending: true }, { pending: true }]; };
  await runGlass(Q, 12600, [{ at: 3000, fn: function (a) { a.startFlip(false); } }], { onFrame: function (a) {
    if (held && a.V.frame >= held.until) { a.env.solver.readbacks = held.rb; held = null; }
    var t = rQ.canvas.style.transform === 'rotate(180deg)';
    if (t) turned++;
    if (t !== (rQ._drawnParity !== rQ.valve.parity)) wrong++;
  } });
  check(rQ.n.skips >= 2 && turned >= 1 && wrong === 0 && rQ.n.cssTurns >= 1 && rQ.canvas.style.transform === '',
    'every readback slot busy at the Flip\'s swap: ' + rQ.n.skips + ' runs skipped; the canvas was turned half a turn in ' + turned + ' frames, exactly while its picture was from before the swap, and is upright after');
  endOk(Q, 'the Flip with its swap\'s runs skipped');

  /* ------------------------------------------------------------------------------------ *
   *  6. The stage 1b review's findings
   * ------------------------------------------------------------------------------------ */
  // a loss after adopt(), before the app's handover: not ready (the app hands it nothing) and
  // takeOver() refuses it; the rebuild draws its bed and is ready again, and is handed the sand
  var LB = makeApp({ ms: 10000, seed: 181 }), engLB = makeEngine(LB.env);
  LB.calibrate(); LB.T.rem = LB.T.durationMs; LB.start();
  await LB.run(1500);
  var rLB = await LB.attach({ engine: engLB, adoptOnly: true, onBack: function () { LB.backs++; } });
  var readyBefore = rLB.ready;
  LB.env.device.loseIt('unknown', 'reset');
  await tick(); await tick();
  var lbReady = rLB.ready, lbThrew = false;
  try { rLB.takeOver(); } catch (e) { lbThrew = /lost/.test(e.message); }
  while (!LB.backs && LB.V.frame < 5000) { LB.V.frame++; LB.env.pump(); await tick(); }
  var lbBack = rLB.ready;
  LB.sim = rLB; LB.real = rLB; rLB.takeOver();
  await runGlass(LB, 9000, []);
  check(readyBefore && !lbReady && lbThrew && LB.losses.length === 1 && LB.backs === 1 && lbBack && LB.sim === rLB,
    'a device lost after adopt(), before the handover: ready is false at once and takeOver() refuses the lost engine; rebuilt, it is ready again (onBack) and takes the sand');
  endOk(LB, 'the glass handed over after the rebuild');

  // hidden while the engine adopted: on return the CPU caught up (the app's catch-up) before the
  // handover; the GPU takes the CPU's count by a transfer, and the count never goes back up to
  // the adoption's (a backlog leaving as a gulp). A few grains released meanwhile flow, as before.
  async function handoverAfter(owed, seed) {
    var HA = makeApp({ ms: 30000, seed: seed }), engHA = makeEngine(HA.env);
    HA.calibrate(); HA.T.rem = HA.T.durationMs; HA.start();
    await HA.run(2000);
    var rHA = await HA.attach({ engine: engHA, adoptOnly: true });
    var adopted = rHA.nTop;
    HA.cpu.fastForward(owed);                     // (the CPU, still the app's sim, let these through)
    HA.sim = rHA; HA.real = rHA; rHA.takeOver();
    var at = { gpu: rHA.nTop, cpu: HA.cpu.nTop, adopted: adopted, catchUps: rHA.n.handoverCatchUps, xfer: !!rHA.valve.xfer };
    var rose = 0, prev = rHA.nTop;
    HA.after = function (a) { if (a.sim.nTop > prev) rose = Math.max(rose, a.sim.nTop - prev); prev = a.sim.nTop; };
    await runGlass(HA, 28000, []);
    HA.after = null;
    at.rose = rose; at.transfers = rHA.n.transfers;
    return { app: HA, at: at };
  }
  var hBig = await handoverAfter(300, 191), hSmall = await handoverAfter(5, 193);
  check(hBig.at.catchUps === 1 && hBig.at.gpu <= hBig.at.cpu + 1 && hBig.at.xfer && hBig.at.transfers >= 1 && hBig.at.rose <= 1 &&
    hSmall.at.catchUps === 0 && hSmall.at.gpu === hSmall.at.adopted && hSmall.at.gpu - hSmall.at.cpu === 5,
    'the handover after the CPU caught up 300 grains: nTop ' + hBig.at.cpu + ' (CPU) -> ' + hBig.at.gpu + ' (GPU), moved by a transfer, never back to the adoption\'s ' + hBig.at.adopted +
    ' (largest rise after ' + hBig.at.rose + '); after 5 grains: owed, they flow (' + hSmall.at.cpu + ' -> ' + hSmall.at.gpu + ')');
  endOk(hBig.app, 'the glass after a handover that caught up');

  // the page hidden and shown again while the device opened: start() still says 'hidden' (it was
  // overwritten by the page's state after the device opened)
  var HS = makeApp({ ms: 10000, seed: 197 }), engHS = makeEngine(HS.env), devHS = engHS.createDevice, errHS = null;
  engHS.createDevice = async function () { HS.realObj.setHidden(true); HS.realObj.setHidden(false); return devHS(); };
  try { await HS.attach({ engine: engHS }); } catch (e) { errHS = e; }
  check(errHS && errHS.code === 'hidden' && HS.env.device.destroyed, 'a brief lock while the device opened: start() fails with \'hidden\' (tried again once in view), the device let go');

  // asleep, the picture is drawn again (with no substep, still asleep) after a new palette, a
  // canvas whose size changed, and back from hidden; a layout that changes nothing leaves the
  // canvas's width and height alone (setting them clears its picture)
  var AS = makeApp({ ms: 10000, seed: 199 });
  var rAS = await AS.attach(); AS.calibrate(); AS.T.rem = AS.T.durationMs;
  AS.T.state = 'paused';
  await AS.run(3500);
  var sets = 0, cw = rAS.canvas.width, ch = rAS.canvas.height;
  Object.defineProperty(rAS.canvas, 'width', { get: function () { return cw; }, set: function (v) { sets++; cw = v; } });
  Object.defineProperty(rAS.canvas, 'height', { get: function () { return ch; }, set: function (v) { sets++; ch = v; } });
  var asleepNow = function () { return rAS.modes.mode === 'asleep' && !rAS.isActive(); };
  async function redrawn(fn) {
    var d0 = AS.env.grains.draws, steps0 = AS.env.solver.runs, mode0 = rAS.modes.mode;
    fn();
    var wake = rAS.isActive();
    await AS.run(100);
    return { wake: wake, draws: AS.env.grains.draws - d0, runs: AS.env.solver.runs - steps0, asleep: asleepNow(), was: mode0 };
  }
  var as0 = asleepNow();
  var rdSame = await redrawn(function () { rAS.layout(); });
  var rdPal = await redrawn(function () { rAS.setPalette(); });
  var rdBox = await redrawn(function () { rAS.o.cSand = { style: { width: '300px', height: '640px', left: '10px', top: '20px' } }; rAS.layout(); });
  var setsBox = sets;
  var rdBack = await redrawn(function () { rAS.setHidden(true); rAS.setHidden(false); });
  var okRd = function (r) { return r.wake && r.draws === 1 && r.runs === 1 && r.asleep && r.was === 'asleep'; };
  check(as0 && !rdSame.wake && rdSame.draws === 0 && okRd(rdPal) && okRd(rdBox) && setsBox === 2 && okRd(rdBack) && rAS.n.redraws === 3 && cw === 300 && ch === 640,
    'asleep, the GPU sand is drawn again once (one run of no substeps, still asleep) after a new palette (' + rdPal.draws + '), a new size (' + rdBox.draws +
    ', ' + setsBox + ' sets of width and height) and back from hidden (' + rdBack.draws + '); a layout that changes nothing sets nothing and draws nothing (' + rdSame.draws + ')');

  // one shader library a page: a rebuild after a loss compiles the sources the page started with
  // (no fetch); shaders of another build than the modules fail the start with 'stamp'
  var shaderDir = path.join(ROOT, 'realsand', 'shaders'), fetches = [], fetchWas = globalThis.fetch, stampAs = null;
  globalThis.fetch = async function (u) {
    var url = new URL(String(u)), f = path.join(shaderDir, path.basename(url.pathname));
    fetches.push(path.basename(url.pathname));
    var txt = fs.readFileSync(f, 'utf8');
    if (stampAs !== null) txt = txt.replace(/^\/\/ Engine build: \S+/m, '// Engine build: ' + stampAs);
    return { ok: true, status: 200, text: async function () { return txt; } };
  };
  function shaderEngine(env, libs) {
    var eng = makeEngine(env), Ms = eng.Solver;
    // (as the real Solver.create: a library given is used, a base URL makes a new one; the solver loads its shaders)
    eng.Solver = { create: async function (d, shaders) {
      var lib = shaders && typeof shaders.module === 'function' ? shaders : new SOL.ShaderLibrary(shaders);
      libs.push(lib);
      await lib.source('tally'); await lib.source('g2p2g');
      var m = await Ms.create(d); m.shaders = lib; return m;
    } };
    return eng;
  }
  var base = require('url').pathToFileURL(shaderDir + path.sep).href;
  try {
    var SL = makeApp({ ms: 10000, seed: 211 }), libs = [];
    var rSL = await SL.attach({ engine: shaderEngine(SL.env, libs), shaderBase: base + '?page=1' });
    var first = fetches.length;
    SL.calibrate(); SL.T.rem = SL.T.durationMs; SL.start();
    await SL.run(1500);
    SL.env.device.loseIt('unknown', 'reset');
    await SL.run(4000);
    var again = fetches.length - first;
    var SB = makeApp({ ms: 10000, seed: 213 }), errSB = null;
    stampAs = '3';
    try { await SB.attach({ engine: shaderEngine(SB.env, []), shaderBase: base + '?page=2' }); } catch (e) { errSB = e; }
    stampAs = null;
    check(first >= 3 && again === 0 && libs.length === 2 && libs[0] === libs[1] && SL.backs === 1 && SL.sim === rSL,
      'one shader library a page: the start fetched ' + first + ' shader files; the rebuild after a lost device used the same library and fetched ' + again);
    check(errSB && errSB.code === 'stamp' && errSB.capability === false && SB.env.device.destroyed,
      'shaders of another build than the modules ("Engine build: 3" against ' + RS.BUILD + '): start() fails with \'stamp\' (' + (errSB && errSB.message) + ')');
  } finally { globalThis.fetch = fetchWas; }

  /* ------------------------------------------------------------------------------------ *
   *  Every glass shape: the fill from the CPU lattice, and a glass run to its end
   * ------------------------------------------------------------------------------------ */
  /** endOk's test as a value: { ok, text }. */
  function endIs(app, lateMs) {
    var e = app.endMs(), pl = app.env.solver.plant, sub = 1000 / 480 + 0.5;
    return { ok: e >= -sub && e <= (lateMs || 34) && app.stats.zeroEarly === 0 && app.T.state === 'done' && app.sim.nTop === 0 && pl.above === 0 && pl.viol === 0 && pl.startErr === 0 && pl.closedCross === 0,
      text: f1(e) + ' ms' };
  }
  var shapeRuns = [], shapeOk = true, shapeFill = true;
  for (var si = 0; si < P.SHAPE_ORDER.length; si++) {
    var sid = P.SHAPE_ORDER[si];
    for (var mi2 = 0; mi2 < 2; mi2++) {
      var msS = [10000, 300000][mi2];
      var SA = makeApp({ ms: msS, seed: 301 + si, shape: sid });
      var rSA = await SA.attach(), sdS = SA.env.solver.lastUpload.sides;
      if (!(sdS.above === VA.pointsFor(SA.cpu.nTop, rSA.ppg) && sdS.below === VA.pointsFor(SA.cpu.total - SA.cpu.nTop, rSA.ppg) && rSA.glass.geo.shape === SA.cpu.geo.shape)) shapeFill = false;
      SA.calibrate(); SA.T.rem = SA.T.durationMs; SA.start();
      await runGlass(SA, msS, []);
      var eS = endIs(SA);
      if (!eS.ok) shapeOk = false;
      shapeRuns.push(sid + ' ' + (msS / 1000) + ' s ' + eS.text + (eS.ok ? '' : ' (FAILS)'));
      if (SA.restorePace) SA.restorePace();
    }
  }
  check(shapeFill, 'every shape: adopt() fills its own glass from the CPU lattice with exactly Pts(nTop) points above and Pts(nBottom) below');
  // the control: a delta glass handed the classic glass's field is found out
  var XA = makeApp({ ms: 10000, seed: 341, shape: 'delta' });
  var rXA = await XA.attach({ glass: glassFor(P.makeGeometry(1.08)) });
  check(rXA.glass.geo.shape !== XA.cpu.geo.shape, '... and a delta glass given the classic glass\'s field is found out (control)');
  check(shapeOk, 'every shape: a 10 s and a 5-minute glass run to their end, the last point out within a frame or two of 00:00.0, none early: ' + shapeRuns.join('; '));
  // the control: the same delta glass on a neck that passes too little sand for its pace (60 points a
  // second where it needs about 170) must end late, and be found out
  var CD = makeApp({ ms: 10000, seed: 331, shape: 'delta', plant: { q0: 60 } });
  await CD.attach();
  CD.calibrate(); CD.T.rem = CD.T.durationMs; CD.start();
  await runGlass(CD, 10000, []);
  var eCD = endIs(CD);
  check(!eCD.ok, '... and a delta glass whose neck passes too little sand for its pace misses it: the last point out ' + eCD.text + ' after 00:00.0 (control)');

  log('realsand-adapter: ' + (failures ? failures + ' of ' + count + ' checks FAILED' : 'all ' + count + ' checks passed') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
