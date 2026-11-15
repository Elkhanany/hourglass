/*
 * Shaking the glass in Node, for the sim tests (development only, not shipped).
 *
 *   var H = require('./lib/harness.js');
 *   var run = H.glassAt({ durMs: 300000, startMs: 20000, seed: 11 });   // a running glass
 *   var r = H.drive(run, 'vigSlow60', { armed: true });                  // shake it, collect what happened
 *
 * glassAt() sets a glass up the way the physicist's calibration runs did:
 * the sand for the duration, settled, then fast-forwarded to where the clock
 * says it is startMs into its run, with the clock running. drive() then
 * steps a profile from lib/profiles.js through the same input pipeline the
 * app uses (the felt acceleration of the phone, dead-zoned, clamped and
 * scaled to cells/s², straight into sim.setMotion), with the clock, the
 * valve settings and relCap as app.js sets them, and records every event.
 *
 * pool() runs jobs in parallel child processes for the long suites.
 */
'use strict';
var os = require('os');
var childProcess = require('child_process');
var L = require('./load-physics.js');
var Clock = require('./clock.js');
var Pr = require('./profiles.js');

var P = L.P;
var DT = P.Sim.DT, DT_MS = Clock.DT_MS;
var LAM = 0.08;                       // λ of the glass in Zen on an iPhone 12 (spec: 0.062–0.123)

/**
 * A glass durMs long, startMs into its run, settled, its clock running.
 * o.sim reuses a Sim (reset to a new glass) as a page does, which keeps the
 * JIT's view of it settled between runs (the timing tests use this).
 */
function glassAt(o) {
  var S = (o.P || P).Sim, sim = o.sim;
  if (!sim) sim = new S({ scale: o.scale || 1.08, seed: o.seed || 4242 });
  sim.setMotion(0, 0, 0, 0, 0, 0);
  sim.damageArmed = false; sim.reduced = false; sim.relCap = 0; sim.quality = 2;
  sim.gateOpen = false; sim.deepRelease = false; sim.topSweeps = 0;
  sim.reset(Clock.grainsFor(sim, o.durMs));
  var i;
  for (i = 0; i < 300; i++) { sim.beginFrame(); sim.step(); }
  var T = new Clock(sim, o.durMs);
  T.rem = o.durMs - (o.startMs || 0);
  var want = Math.ceil(T.topAt(T.rem));
  if (sim.nTop > want) sim.fastForward(sim.nTop - want);
  for (i = 0; i < 240; i++) { sim.beginFrame(); sim.step(); }
  T.state = 'running';
  return { sim: sim, T: T, o: o };
}

/** The four fills of the physicist's calibration: [duration min, seconds into the run]. */
var FILLS = [[5, 20], [1, 15], [45, 300], [5, 270]];
function fillName(f) { return f[0] + '-min at ' + f[1] + ' s'; }

/**
 * The app's motion pipeline for one felt sample (g, page frame = vessel
 * frame for an upright glass): a soft 0.06 g dead zone on the in-plane
 * vector, the sensor's 8 g range, and (Reduce Motion) half the felt
 * acceleration, clamped to 0.8 g. Writes {ax, ay (cells/s²), gz (g), w, al}.
 */
function felt(sim, f, out, reduced) {
  var x = f.x || 0, y = f.y || 0, m = Math.sqrt(x * x + y * y);
  if (m > 0) {
    var k = m > 0.06 ? (m - 0.06) / m : 0;
    x *= k; y *= k; m *= k;
    if (m > 8) { x *= 8 / m; y *= 8 / m; m = 8; }
  }
  var z = Math.abs(f.z || 0);
  z = z > 0.06 ? z - 0.06 : 0;
  if (z > 8) z = 8;
  var w = f.w || 0, al = f.al || 0;
  if (reduced) {
    x *= 0.5; y *= 0.5; z *= 0.5; m *= 0.5;
    if (m > 0.8) { x *= 0.8 / m; y *= 0.8 / m; }
    if (w > 6) w = 6; else if (w < -6) w = -6;
  }
  if (al > 300) al = 300; else if (al < -300) al = -300;
  out.ax = sim.G * x; out.ay = sim.G * y; out.gz = z; out.w = w; out.al = al;
  return out;
}

/**
 * Drive profile `name` (or opts.fn(t, out)) for opts.dur seconds (default:
 * the profile's), app-like. Options:
 *   armed      sim.damageArmed (default false)
 *   reduced    sim.reduced, and the app's Reduce Motion input scaling
 *   lam        λ (default 0.08)
 *   quality    sim.quality (default 2)
 *   clock      false: no clock, the gate stays closed
 *   retime     re-time once calm, as the app will
 *   census     check the census every N steps (default 30; 0 off)
 *   pre(run, k, t)         called just before every step (inputs set)
 *   each(run, k, t, rec)   called after every step
 *   frame(run, k, t, rec)  called at the end of every frame (two steps)
 *   flipEvery  completeFlip every N steps (the tumble)
 *   pourAt     seconds: pour pourN (default 200) grains then
 *   timing     record per-frame (2 steps) step() time in ms
 *   stopAfterBreach  seconds after the first breach to stop early
 * Returns a record of what happened (see below).
 */
function drive(run, name, opts) {
  opts = opts || {};
  var sim = run.sim, T = run.T, prof = name ? Pr.PROFILES[name] : null;
  var dur = opts.dur !== undefined ? opts.dur : prof.dur;
  var nSteps = Math.round(dur / DT);
  var lam = opts.lam !== undefined ? opts.lam : LAM;
  var useClock = opts.clock !== false;
  var every = opts.census !== undefined ? opts.census : 30;
  sim.damageArmed = !!opts.armed;
  sim.reduced = !!opts.reduced;
  sim.quality = opts.quality !== undefined ? opts.quality : 2;
  var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {};
  var DMG = P.Sim.DMG;
  var rec = {
    name: name, steps: 0, crackT: -1, breachT: -1, cracks: 0, warns: [], warnsBeforeCrack: -1,
    warnLevelsBeforeCrack: null, dMax: 0, dMaxSeg: -1, censusErr: 0, censusChecks: 0, overRelease: 0,
    conserveErr: 0, maxAir: 0, maxNp: 0, landings: 0, thumps: 0, slams: 0, sprayed: 0, hops: 0,
    released: 0, leakedTop: 0, leakedBottom: 0, lost: 0, holesNearGate: 0, events: [],
    frameMs: null, retimes: 0, motionSteps: 0, maxLag: 0, poured: 0
  };
  var total0 = sim.total + sim.lost, poured = 0;
  var lastMotion = -1e9, now = opts.t0Ms || 0, frameAcc = 0, hr = process.hrtime;
  if (opts.timing) rec.frameMs = [];
  for (var k = 0; k < nSteps; k++) {
    var t = k * DT;
    if (prof) Pr.sample(name, t, f);
    else { f.x = f.y = f.z = f.w = f.al = 0; opts.fn(t, f); }
    felt(sim, f, inp, opts.reduced);
    sim.setMotion(inp.ax, inp.ay, inp.w, inp.al, lam, inp.gz);
    var motionRecent = (k - lastMotion) * DT < 2;
    // as in app.js frame(): turns and pours first, then the clock sets the valve
    if (opts.flipEvery && k > 0 && k % opts.flipEvery === 0) {
      if (useClock) T.turnOver(); else sim.completeFlip();
    }
    if (opts.pourAt !== undefined && k === Math.round(opts.pourAt / DT)) {
      var made = sim.pour(opts.pourN || 200);
      poured += made; rec.poured += made;
      if (useClock) T.poured(made);
    }
    if (useClock) {
      T.tick(DT_MS, false);
      T.apply(now, false, true);
      sim.relCap = T.relCap(motionRecent);
      if (opts.retime && T.maybeRetime((k - lastMotion) * DT, now)) rec.retimes++;
    }
    if ((k & 1) === 0) { sim.beginFrame(); frameAcc = 0; }
    var nTop0 = sim.nTop, rel0 = sim.frame.released, tgt = sim.targetTop;
    if (opts.pre) opts.pre(run, k, t);
    var t0 = opts.timing ? hr() : null;
    sim.step();
    if (t0) { var dt = hr(t0); frameAcc += dt[0] * 1e3 + dt[1] / 1e6; if (k & 1) rec.frameMs.push(frameAcc); }
    now += DT_MS;
    rec.steps++;
    if (sim.motionActive()) { lastMotion = k; rec.motionSteps++; }
    // the valve never releases past the clock's target (leaks may take nTop below it)
    var rel = sim.frame.released - rel0;
    if (rel > 0 && nTop0 - rel < tgt) rec.overRelease++;
    if (sim.lag > rec.maxLag) rec.maxLag = sim.lag;
    rec.released += rel;
    var fr = sim.frame;
    if ((k & 1) === 1 || k === nSteps - 1) {
      // the end of a frame (two steps): read what it did, as the app will
      for (var e = 0; e < fr.dmgN; e++) {
        var ty = fr.dmgType[e];
        rec.events.push([+(t.toFixed(3)), ty, fr.dmgK[e], fr.dmgLevel[e]]);
        if (ty === DMG.WARN) rec.warns.push([t, fr.dmgLevel[e]]);
        if (ty === DMG.CRACK) {
          rec.cracks++;
          if (rec.crackT < 0) {
            rec.crackT = t;
            rec.warnsBeforeCrack = rec.warns.length;
            rec.warnLevelsBeforeCrack = rec.warns.map(function (w) { return w[1]; });
          }
        }
        if (ty === DMG.BREACH && rec.breachT < 0) rec.breachT = t;
      }
      if (fr.thump[0] > 0 || fr.thump[2] > 0) rec.thumps++;
      if (fr.slam[0] > 0) rec.slams++;
      rec.sprayed += fr.sprayed;
      rec.hops += fr.hops;
      if (opts.frame) opts.frame(run, k, t, rec);
      sim.escN = 0;                                     // the app drains the ring every frame
    }
    var air = sim.nAir[0] + sim.nAir[1];
    if (air > rec.maxAir) rec.maxAir = air;
    if (sim.np > rec.maxNp) rec.maxNp = sim.np;
    if (sim.dMax > rec.dMax) { rec.dMax = sim.dMax; rec.dMaxSeg = sim.warnSeg; }
    if (every && (k % every === every - 1 || k === nSteps - 1)) {
      var c = sim.census();
      rec.censusChecks++;
      var err = Math.abs(c.total - sim.total) + Math.abs(c.top - sim.nTop);
      if (err > rec.censusErr) rec.censusErr = err;
      var ce = Math.abs(sim.total + sim.lost - (total0 + poured));
      if (ce > rec.conserveErr) rec.conserveErr = ce;
    }
    if (opts.each) opts.each(run, k, t, rec);
    if (opts.stopAfterBreach !== undefined && rec.breachT >= 0 && t > rec.breachT + opts.stopAfterBreach) break;
  }
  // every hole at least gateGuard rows from the gate
  for (var q = 0; q < sim.cracks.length; q++) {
    var cr = sim.cracks[q];
    for (var h = 0; h < cr.nh; h++) {
      if (Math.abs(Math.floor(cr.holes[h] / sim.W) - sim.gateY) < P.Sim.MOTION.gateGuard) rec.holesNearGate++;
    }
  }
  rec.leakedTop = sim.leakedTop; rec.leakedBottom = sim.leakedBottom; rec.lost = sim.lost;
  rec.segDmax = 0;
  for (q = 0; q < sim.segD.length; q++) if (sim.segD[q] > rec.segDmax) rec.segDmax = sim.segD[q];
  rec.cracksNow = sim.cracks.length;
  return rec;
}

/** Percentile p (0…1) of a numeric array (sorted copy). */
function pct(a, p) {
  if (!a.length) return 0;
  var s = a.slice().sort(function (x, y) { return x - y; });
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
function mean(a) {
  var t = 0;
  for (var i = 0; i < a.length; i++) t += a[i];
  return a.length ? t / a.length : 0;
}

/** A readable name for wall segment s. */
function segName(s) {
  if (s < 0) return '-';
  return ['top', 'bot'][Math.floor(s / 80)] + '-' + ['L', 'R'][Math.floor(s / 40) % 2] + ' u=' + ((s % 40 + 0.5) / 40).toFixed(2);
}

/**
 * Run jobs in parallel child processes. `script` must call workerMain(fn)
 * when started with HOURGLASS_WORKER=1; fn(job) returns a JSON-able result.
 * done(results) gets the results in job order.
 */
function pool(script, jobs, done, k) {
  k = k || Math.max(1, Math.min(jobs.length, os.cpus().length));
  var results = new Array(jobs.length), next = 0, finished = 0, kids = [];
  if (!jobs.length) { done(results); return; }
  function feed(child) {
    if (next >= jobs.length) { child.kill(); return; }
    var id = next++;
    child.send({ id: id, job: jobs[id] });
  }
  for (var i = 0; i < k; i++) {
    var child = childProcess.fork(script, [], { env: Object.assign({}, process.env, { HOURGLASS_WORKER: '1' }) });
    kids.push(child);
    child.on('message', (function (c) {
      return function (m) {
        results[m.id] = m.result;
        finished++;
        if (finished === jobs.length) {
          kids.forEach(function (kc) { try { kc.kill(); } catch (e) { /* gone */ } });
          done(results);
        } else feed(c);
      };
    })(child));
    child.on('error', function (e) { console.log('worker error: ' + e.message); });
    feed(child);
  }
}

/** In a worker: answer each job with fn(job). */
function workerMain(fn) {
  process.on('message', function (m) {
    var result;
    try { result = fn(m.job); } catch (e) { result = { error: String(e && e.stack || e) }; }
    process.send({ id: m.id, result: result });
  });
}

module.exports = {
  P: P,
  Clock: Clock,
  Profiles: Pr,
  DT: DT,
  LAM: LAM,
  FILLS: FILLS,
  fillName: fillName,
  glassAt: glassAt,
  felt: felt,
  drive: drive,
  pct: pct,
  mean: mean,
  segName: segName,
  pool: pool,
  workerMain: workerMain,
  isWorker: process.env.HOURGLASS_WORKER === '1'
};
