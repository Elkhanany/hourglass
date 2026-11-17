/*
 * The app's clock, for the Node tests (development only, not shipped).
 *
 * calibrate, topAt and remAt are exactly app.js's; apply() gives the sim the
 * same valve settings app.js's frame() does; and the re-timing rule and the
 * neck's release cap are the ones the motion spec adds (timer semantics).
 *
 *   var Clock = require('./lib/clock.js');
 *   var sim = new P.Sim({ scale: 1.08, seed: 1 });
 *   sim.reset(Clock.grainsFor(sim, 60000));
 *   var T = new Clock(sim, 60000);         // calibrated, state 'idle'
 *   T.start();
 *   for (...) { T.tick(Clock.DT_MS); T.apply(nowMs); sim.step(); }
 *
 * The wall clock is the master: rem only changes through tick(), the swap of
 * a turn (turnOver), a pour (poured) and start() after the end.
 */
'use strict';

var TAIL_P = 1.7;                    // app.js: the final grains thin into single drops
var DT_MS = 1000 / 120;              // one physics step

/**
 * How much sand a glass of this length holds (app.js grainsFor). A shape
 * that fits less under its neck says so in sim.fillMax; the classic glass,
 * and a build from before there were shapes, take 0.78.
 */
function grainsFor(sim, ms) {
  var f = 0.36 + 0.40 * Math.log(ms / 60000) / Math.log(45);
  return Math.round(sim.capacity * Math.max(0.17, Math.min(sim.fillMax || 0.78, f)));
}

function Clock(sim, durationMs) {
  this.sim = sim;
  this.state = 'idle';               // idle | running | paused | done
  this.durationMs = durationMs;
  this.rem = durationMs;
  this.mpg = 1;                      // ms per grain in the bulk phase
  this.rate = 0;                     // grains per second in the bulk phase
  this.tailMs = 1000;
  this.tailGrains = 30;
  this.mpg0 = 1;                     // calibrate()'s mpg for this glass (the re-time clamp)
  this.lastRetime = -Infinity;       // ms
  this.retimes = 0;
  this.calibrate();
}

/** app.js calibrate(): the bulk rate and the tail, for the sand in the glass now. */
Clock.prototype.calibrate = function () {
  var N = this.sim.total, d = this.durationMs;
  this.tailMs = Math.min(2600, Math.max(500, d * 0.04));
  var rate = N / (d / 1000);
  this.tailGrains = Math.max(3, Math.min(30, Math.floor(rate * this.tailMs / 1000 / TAIL_P)));
  this.mpg = (d - this.tailMs) / (N - this.tailGrains);
  this.rate = 1000 / this.mpg;
  this.mpg0 = this.mpg;
};

/** Grains that should remain above the neck with `rem` ms left. */
Clock.prototype.topAt = function (rem) {
  if (rem <= 0) return 0;
  if (rem >= this.tailMs) return this.tailGrains + (rem - this.tailMs) / this.mpg;
  return this.tailGrains * Math.pow(rem / this.tailMs, TAIL_P);
};

/** Inverse: time left when `top` grains remain above the neck. */
Clock.prototype.remAt = function (top) {
  if (top <= 0) return 0;
  if (top >= this.tailGrains) return this.tailMs + (top - this.tailGrains) * this.mpg;
  return this.tailMs * Math.pow(top / this.tailGrains, 1 / TAIL_P);
};

/** app.js start(): after the end, the time left is what the sand above says. */
Clock.prototype.start = function () {
  if (this.state === 'done' || this.rem <= 0) this.rem = this.remAt(this.sim.nTop);
  this.state = 'running';
};

/**
 * Advance the wall clock by dtMs (app.js tickClock). `stopped` is app.js's
 * flip.active, or the glass lying on its side with real gravity on: time
 * stands still then. Returns true on the step the clock reaches 00:00.0.
 */
Clock.prototype.tick = function (dtMs, stopped) {
  if (dtMs <= 0 || this.state !== 'running' || stopped) return false;
  this.rem -= dtMs;
  if (this.rem > 0) return false;
  this.rem = 0;
  this.state = 'done';
  return true;
};

/**
 * Grains the clock wants above the neck now, as app.js frame() computes it:
 * topAt(rem), with the stream's breathing unless `smooth` (the swings
 * average to zero and fade out before the end, so the timing is unchanged).
 */
Clock.prototype.target = function (nowMs, smooth) {
  var ideal = this.topAt(this.rem);
  var fade = (this.rem - this.tailMs - 1200) / 3000;
  if (!smooth && fade > 0) {
    if (fade > 1) fade = 1;
    var ts = nowMs / 1000;
    ideal += this.rate * fade * (
      0.113 * Math.sin(ts * 1.95 + 1.3 * Math.sin(ts * 0.37)) +
      0.022 * Math.sin(ts * 11.9 + 1.1 * Math.sin(ts * 1.7)) +
      0.007 * Math.sin(ts * 28.9 + 0.5));
  }
  var t = Math.ceil(ideal - 1e-7);
  return t < 0 ? 0 : t;
};

/**
 * Give the sim this frame's valve settings, exactly as app.js frame() does.
 * Returns true while the sand is running or draining.
 */
Clock.prototype.apply = function (nowMs, flipActive, smooth) {
  var sim = this.sim;
  var running = this.state === 'running' && !flipActive;
  var draining = this.state === 'done' && sim.nTop > 0 && !flipActive;
  var target = sim.nTop;
  if (running) target = this.target(nowMs, smooth);
  else if (draining) target = 0;
  sim.gateOpen = running || draining;
  sim.deepRelease = draining || (running && this.rem <= 0);
  sim.targetTop = target;
  sim.topSweeps = running ? Math.min(6, Math.floor(this.rate / 260)) : 0;
  return running || draining;
};

/**
 * The glass has turned past 180° (app.js swapEnds and tiltSwap): the
 * lattice is re-indexed and elapsed and remaining time swap.
 */
Clock.prototype.turnOver = function () {
  var there = this.remAt(this.sim.total - this.sim.nTop);
  this.sim.completeFlip();
  this.rem = there;
};

/** `made` grains were poured in (app.js handlePour): more sand, more time. */
Clock.prototype.poured = function (made) {
  if (made > 0) this.rem = this.remAt(this.topAt(this.rem) + made);
};

/**
 * The neck's release cap (grains per step) while motion is recent: a
 * backlog drains as a thread up to 3× (23× in the last seconds) thicker,
 * never as a clump. 0 means no cap.
 */
Clock.prototype.relCap = function (motionRecent, dt) {
  if (!motionRecent) return 0;
  return this.rate * (dt || DT_MS / 1000) * (3 + 20 * Math.max(0, 1 - (this.rem - this.tailMs) / 5000));
};

/**
 * Re-timing (timer semantics): once calm, if the sand above the neck no
 * longer matches the clock (it was shaken or it leaked), the rest of the run
 * is re-timed so the sand that is there lasts exactly the time that is left,
 * and the last grain still leaves at 00:00.0. `calmS` is the time since the
 * last motion-path step; the caller folds in !flip.active and a body at
 * rest. At most once per 0.5 s, and only within ×4 of the calibrated rate.
 * Returns true when it re-timed.
 */
Clock.prototype.maybeRetime = function (calmS, nowMs) {
  var sim = this.sim;
  if (!(calmS >= 0.75) || this.state !== 'running') return false;
  if (nowMs - this.lastRetime < 500) return false;
  if (this.rem <= this.tailMs + 2000 || sim.nTop <= this.tailGrains + 2) return false;
  if (Math.abs(sim.nTop - this.topAt(this.rem)) <= Math.max(3, 0.5 * this.rate)) return false;
  var mpg = (this.rem - this.tailMs) / (sim.nTop - this.tailGrains);
  if (!(mpg > this.mpg0 / 4 && mpg < 4 * this.mpg0)) return false;
  this.mpg = mpg;
  this.rate = 1000 / mpg;
  this.lastRetime = nowMs;
  this.retimes++;
  return true;
};

Clock.TAIL_P = TAIL_P;
Clock.DT_MS = DT_MS;
Clock.grainsFor = grainsFor;
module.exports = Clock;
