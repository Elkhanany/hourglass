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
 *    with sim.foo and realEng.bar is the control); the CPU Sim has the Sim's members and RealSand
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
 *    ('stamp'); the heat guard's trip is logged.
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
    var k = geo.q.toFixed(4);
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
    var cpu = new P.Sim({ scale: (o.q || 1.08) * fine, seed: o.seed || 11 });
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
          var fx = mi ? mi.fx : 0, fy = mi ? mi.fy : 0, w = (mi ? mi.w : 0) + (app.flip.active ? app.body.w : 0);
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
   *     (b) the GPU engine's own, called on real, realEng, eng and realCls under their guards
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
    real: ['feel', 'points', 'setSweep', 'submit'],
    realEng: ['ready', 'takeOver', 'destroy', 'destroyed', 'stats', 'layout', 'setHidden', 'setPalette'],
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

  // feel(): a 50 ms jolt of 0.5 g reaches the GPU's substeps played back slowed, as a slowed film (5.2)
  var J = makeApp({ ms: 60000, seed: 171 });
  var rJ = await J.attach(); J.calibrate(); J.T.rem = J.T.durationMs; J.start();
  await J.run(3000);
  J.env.recordFields = true; J.env.solver.fields = [];
  var joltUntil = J.V.wall + 50;
  J.motionIn = function (a) { return a.V.wall <= joltUntil ? { fx: 0.5, fy: 0, w: 0 } : null; };
  await J.run(1000);
  J.motionIn = null; J.env.recordFields = false;
  var fs2 = J.env.solver.fields, gx = fs2.map(function (f) { return f.gravity[0] / rJ.Gg; });
  var over = gx.filter(function (x) { return x > 0.1; }).length, peak = Math.max.apply(null, gx);
  check(over > 2 * 24 && peak > 0.35 && peak <= 0.5 && fs2.length > 400,
    'a 50 ms jolt of 0.5 g (24 substeps at 480 Hz) is felt by ' + over + ' substeps, slowed like a film, at up to ' + peak.toFixed(2) + ' g against the glass\'s gravity');

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

  log('realsand-adapter: ' + (failures ? failures + ' of ' + count + ' checks FAILED' : 'all ' + count + ' checks passed') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
