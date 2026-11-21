/*
 * A model of Real sand's neck on the GPU (the plant), and of the app that drives it, for the
 * valve's Node test (realsand-valve.test.js). Counts only: no grains move, no GPU.
 *
 * The plant (class Plant) stands for the solver with the neck of realsand/valve.mjs:
 *  - substeps at HZ (480 a simulated second); a run is one frame's substeps, its count S from
 *    the wall time it stands for and the simulated over real time (sim/real dips);
 *  - the throttle: flow = kv x vcap points per simulated second (kv the plant's own gain, 20
 *    unless a case says otherwise; the valve always starts its estimate at 20), at most the open
 *    neck Q0 (1000 points/s); it opens with a 60 ms lag and closes at once; +-15 % correlated
 *    noise; the flow fills a queue of points resting on the line, at most QMAX (22, about one
 *    cell of the throat) and at most the points above;
 *  - the membrane with tickets: in substep s, tickets = counters[3] + allow[s] - crossings so
 *    far, exactly the GPU's rule; points cross from the queue while tickets last;
 *  - counters[3] is tally[1] (tally[2] in a run that re-indexes) from the last run's tally or
 *    an upload; an append does not write it (the first version's bookkeeping did: the control);
 *  - the flip pass swaps the bulbs (the GPU's own orientation, `parity`);
 *  - a supply that falls as the bulb empties (`empties`: open flow x min(1, above / 300));
 *  - points stuck above that never reach the queue (`stuck`: a straggler on the funnel wall).
 * It records what the checks need: crossings that left fewer points above than the substep's
 * target (`viol`), runs whose counters[3] + appended was not the true count at their start
 * (`startErr`), crossings in a closed run, and when the last point crossed, with that
 * substep's length.
 *
 * The app (runCase) is app.js's clock as far as the neck sees it: calibrate, topAt, remAt
 * (app.js:157-180), the target with the breathing (1214-1237), the catch-up (1266-1276),
 * maybeRetime (216-228), pour (1001-1020), the Flip's turn, hand spins, a tilt swap with the
 * clock stopped while on its side (1123-1132), a sleep, a Reset, shaking (the neck starved,
 * then relCap while motion is recent). Frames of 1/60 s, now and then 50 ms; runs skipped
 * (o.skip, 3 % unless said); readbacks back in order 1-3 frames later (+ o.lat); a transfer
 * held 1-2 frames, as a readParticles would be.
 *
 *   const { runCase, firstVersion } = require('./lib/realsand-plant.js');
 *   runCase(ValveClass, { d: 60e3, q: 1.08, fine2: 1, events: [...] })
 */
'use strict';
var TAIL_P = 1.7, FULL = 0.78, HZ = 480, QMAX = 22, POUR_RATE = 620;

function rng(seed) {
  var s = (seed >>> 0) || 1;
  return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** The app's clock math for a glass of d ms and N grains (app.js calibrate, topAt, remAt). */
function makeClock(d, N, fine2) {
  var c = { d: d };
  c.calibrate = function (dd, n) {
    c.tailMs = Math.min(2600, Math.max(500, dd * 0.04));
    var rate = n / (dd / 1000);
    c.tailGrains = Math.max(3, Math.min(Math.round(30 * fine2), Math.floor(rate * c.tailMs / 1000 / TAIL_P)));
    c.mpg = (dd - c.tailMs) / (n - c.tailGrains); c.mpg0 = c.mpg; c.rate = 1000 / c.mpg;
  };
  c.topAt = function (rem) { return rem <= 0 ? 0 : rem >= c.tailMs ? c.tailGrains + (rem - c.tailMs) / c.mpg : c.tailGrains * Math.pow(rem / c.tailMs, TAIL_P); };
  c.remAt = function (top) { return top <= 0 ? 0 : top >= c.tailGrains ? c.tailMs + (top - c.tailGrains) * c.mpg : c.tailMs * Math.pow(top / c.tailGrains, 1 / TAIL_P); };
  c.calibrate(d, N);
  return c;
}

/** Points per app grain and the glass's capacity for a lattice scale q and a Grain setting. */
function glassFor(q, fine2) {
  var s = 0.702 / q;
  return { ppg: 4 * s * s, capacity: Math.round(28099 * fine2 * Math.pow(q / 1.08 / Math.sqrt(fine2), 2)) };
}
/** The app's amount for a glass of ms (grainsFor, app.js:151-155). */
function grainsFor(capacity, ms) { return Math.round(capacity * Math.max(0.02, FULL * Math.sqrt(Math.min(1, ms / 3600000)))); }

function Plant(o, rnd) {
  this.rnd = rnd; this.kv = o.kv || 20; this.Q0 = o.q0 || 1000; this.empties = !!o.empties;
  this.stuck = o.stuck || 0; this.firstVersion = !!o.firstVersion;
  this.above = 0; this.below = 0; this.queue = 0; this.flow = 0; this.noise = 1; this.parity = 0;
  this.t1 = 0; this.t2 = 0; this.starve = false;
  this.viol = 0; this.startErr = 0; this.closedCross = 0; this.lastCrossT = NaN; this.lastCrossSub = NaN; this.lastFreeT = NaN;
}
/** An upload (a fill or a transfer): its data's counts go into tally[1] and tally[2]. */
Plant.prototype.upload = function (top, bot, parity) {
  this.above = top; this.below = bot; this.queue = 0; this.flow = 0; this.parity = parity;
  this.t1 = top; this.t2 = bot; this.stuck = Math.min(this.stuck, top);
};
/** An append: into the GPU's top, or mirrored into its bottom while a flip pass is pending. */
Plant.prototype.append = function (n, mirrored) {
  if (mirrored) this.below += n; else this.above += n;
  if (this.firstVersion) this.t1 = this.above;            // the first version: setAbove on append
};
Plant.prototype.topFor = function (ledgerParity) { return ledgerParity === this.parity ? this.above : this.below; };
/** One run: the valve's words; t0 and span (s) the wall time it stands for; ratio sim/real. */
Plant.prototype.run = function (w, t0, span) {
  if (w.flip) { var a = this.above; this.above = this.below; this.below = a; this.queue = 0; this.flow = 0; this.parity ^= 1; }
  var c3 = w.flip ? this.t2 : this.t1, c2 = 0, refused = 0, S = w.steps;
  if (c3 + w.appended !== this.above) this.startErr++;
  this.noise += (1 + 0.15 * (2 * this.rnd() - 1) - this.noise) * Math.min(1, S / HZ / 0.2);
  for (var s = 0; s < S; s++) {
    var free = this.above - this.stuck;
    var supply = this.starve ? 0 : this.empties ? Math.min(1, free / 300) : 1;
    var qCmd = w.vcap >= 1e8 ? this.Q0 * supply : Math.min(this.Q0 * supply, this.kv * w.vcap);
    var qn = qCmd * this.noise;
    this.flow = qn > this.flow ? this.flow + (qn - this.flow) * (1 / HZ) / 0.06 : qn;
    this.queue = Math.min(QMAX, free, this.queue + Math.max(0, this.flow) / HZ);
    var tickets = c3 + w.allow[s] - c2, ready = Math.floor(this.queue);
    var cross = Math.max(0, Math.min(ready, tickets, free));
    refused += Math.max(0, ready - cross);
    if (cross) {
      this.above -= cross; this.below += cross; this.queue -= cross; c2 += cross;
      if (w.closed) this.closedCross += cross;
      if (w.targets[s] >= 0 && this.above < w.targets[s]) this.viol++;
      if (this.above - this.stuck === 0) { this.lastFreeT = t0 + (s + 1) / S * span; this.lastCrossSub = span / S; }
      if (this.above === 0) this.lastCrossT = t0 + (s + 1) / S * span;
    }
  }
  this.t1 = this.above; this.t2 = this.below;
  return { above: this.above, below: this.below, queue: Math.floor(this.queue), crossings: c2, start: c3, refused: refused, upward: 0 };
};

/**
 * The first version's bookkeeping (design revision 1), the control: `allow` carried the points
 * appended in both bulbs, and an append wrote tally[1] (Plant firstVersion), so a pour was
 * counted twice. Built on the real Valve so that only those two differ.
 */
function firstVersion(Valve) {
  return class FirstVersionValve extends Valve {
    run(o) {
      var extra = this.appended[this.parity ^ 1], w = super.run(o);
      if (!w.closed) for (var s = 0; s < w.allow.length; s++) w.allow[s] += extra;
      w.appended += extra;
      return w;
    }
  };
}

/**
 * One glass, frame by frame. o: { d (ms), q, fine2, grains, kv, q0, empties, stuck, skip, lat,
 * ratio, dips, fps (60; 30 is calm), held (motion always recent: relCap on, no catch-up), seed, events: [{ t (s), type: 'pour' (s) | 'flip' | 'spin' (n) | 'tilt' (hold,
 * pour, skip: runs skipped from the swap's frame on) | 'side' (hold) | 'hide' (s) | 'reset' | 'shake' (s) }] }.
 */
function runCase(Valve, o) {
  var rnd = rng(o.seed || 7), fine2 = o.fine2 || 1, gl = glassFor(o.q || 1.08, fine2);
  var N = o.grains || grainsFor(gl.capacity, o.d);
  var clk = makeClock(o.d, N, fine2);
  var plant = new Plant(o, rnd), v = new Valve({ ppg: gl.ppg });
  var f0 = v.fill(N, N); plant.upload(f0.top, f0.bottom, v.parity);
  var events = (o.events || []).map(function (e) { return Object.assign({}, e); });
  var rem = o.d, state = 'running', t = 0, doneT = NaN, back = false, hidden = null, pouring = null, pourAcc = 0;
  var flip = { active: false, until: 0, swapAt: [] }, tilt = { until: 0, swapAt: -1, pour: 0 };
  var lastMotionAt = -1e9, lastRetime = -1e9, shake = null, xfer = null, lastRunT = null;
  var lat = [], lastArr = 0, frameNo = 0, tHist = [], supRun = 0, watch = null, quietUntil = 0;
  var res = {
    ppg: +gl.ppg.toFixed(3), N: N, points: f0.top, frames: 0, runs: 0, viol: 0, startErr: 0, closedCross: 0, closedWords: 0,
    revert: 0, drift: 0, supMismatch: 0, supChecked: 0, zeroEarly: 0, negRel: 0, rises: 0, pourErr: 0, pours: 0,
    relCapFrames: 0, relCapOver: 0, bulkRuns: 0, shortRuns: 0, worstShort: 0, dutyOn: 0, dutyOff: 0, dutyBad: 0,
    transfers: 0, xferDropped: 0, forcedSkips: 0, residues: 0, residueMs: NaN, retimes: 0, pendingSwaps: 0, pendingOpen: 0, closedChecked: 0, closedCount: 0, endMs: NaN, endSub: NaN, freeEndMs: NaN, zeroAfter: NaN, finalTop: -1, finalAbove: -1,
    settleMoves: 0, settleLate: 0, pendings: 0, kvEnd: 0, mismatches: 0, ended: false
  };
  var lastCrossFrame = -1, zeroFrame = -1, prevTop = v.nTop, eventThisFrame = false, residue = false, retimed = false, sinceXfer = 1e9, xferLeft = 0, skipRuns = 0;
  // the pending rule, checked from outside: a readback is exact when no run after it offered a
  // ticket; a swap with none at hand keeps every run closed until one arrives
  var genSeq = 0, lastOpenSeq = 0, maxRead = 0, pendingExpected = false, closedFor = 0;
  function exactAvailable() { return maxRead > genSeq && maxRead >= lastOpenSeq; }
  function newGen() { genSeq = v.seq; maxRead = 0; pendingExpected = false; }
  function topTrue() { return plant.topFor(v.parity); }
  function arm(n, top, kind, pre) { watch = { n: n, top: top, kind: kind, pre: pre, settle: v.n.settleMoves }; quietUntil = t + 1; }

  while (t < o.d / 1000 + 90) {
    var dtw = rnd() < 0.02 ? 0.05 : 1 / (o.fps || 60); t += dtw; frameNo++;
    var now = t * 1000;
    eventThisFrame = retimed; retimed = false;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.done || t < e.t) continue;
      e.done = true; eventThisFrame = true;
      if (e.type === 'flip') { flip.active = true; flip.until = t + 2.6; flip.swapAt = [t + 2.6]; }
      else if (e.type === 'spin') { flip.active = true; flip.swapAt = []; for (var j = 1; j <= e.n; j++) flip.swapAt.push(t + j * 12 / 60); flip.until = flip.swapAt[flip.swapAt.length - 1] + 0.4; }
      else if (e.type === 'tilt') { tilt.until = t + e.hold; tilt.swapAt = t + 0.2; tilt.pour = e.pour || 0; tilt.skip = e.skip || 0; }
      else if (e.type === 'side') { tilt.until = t + e.hold; tilt.swapAt = -1; }
      else if (e.type === 'hide') hidden = { until: t + e.s };
      else if (e.type === 'reset') {
        var pre = v.nTop, fr = v.fill(N, N); plant.upload(fr.top, fr.bottom, v.parity); lastRunT = null; newGen();
        clk.calibrate(o.d, N); rem = o.d; state = 'running'; arm(6, N, 'fill', pre); eventThisFrame = true;
      } else if (e.type === 'pour') pouring = { until: t + e.s };
      else if (e.type === 'shake') shake = { until: t + e.s };
    }
    if (hidden && t < hidden.until) { if (state === 'running') { rem -= dtw * 1000; if (rem <= 0) { rem = 0; state = 'done'; doneT = t; } } continue; }
    if (hidden) { hidden = null; back = true; }
    plant.starve = !!(shake && t < shake.until);
    if (plant.starve || o.held) lastMotionAt = now;     // shaken, or held in the hand with Real motion on
    var motionRecent = now - lastMotionAt < 2000;
    if (!o.held && now - lastMotionAt < 3000) quietUntil = Math.max(quietUntil, t);   // after a shake: its backlog
    // tickClock: the clock stands still while turning and on its side
    var tilted = t < tilt.until;
    if (state === 'running' && !flip.active && !tilted) {
      var r0 = rem; rem -= dtw * 1000;
      if (rem <= 0) { rem = 0; state = 'done'; doneT = t - dtw + r0 / 1000; }
    }
    // pour (app.js:1001-1020)
    if (pouring && t < pouring.until && !flip.active) {
      pourAcc += POUR_RATE * fine2 * Math.min(dtw, 0.05);
      var pn = pourAcc | 0; pourAcc -= pn;
      if (pn) pourNow(pn);
    }
    // a tilt swap (app.js:1123-1132), and a pour in the same frame after it
    if (tilt.swapAt > 0 && t >= tilt.swapAt) {
      var tb = v.nTop, there = clk.remAt(v.total - tb);
      tilt.swapAt = -1; v.completeFlip(); rem = there; arm(12, v.total - tb, 'swap', tb); eventThisFrame = true; skipRuns = tilt.skip;
      if (!exactAvailable()) { pendingExpected = true; res.pendingSwaps++; }
      if (tilt.pour) { pourNow(tilt.pour); }
    }
    // the Flip button's turn and hand spins (swapEnds, app.js:572-578)
    if (flip.active) {
      while (flip.swapAt.length && t >= flip.swapAt[0]) {
        flip.swapAt.shift();
        var fb = v.nTop, there2 = clk.remAt(v.total - fb);
        v.completeFlip(); rem = there2; arm(10, v.total - fb, 'swap', fb); eventThisFrame = true;
        if (!exactAvailable()) { pendingExpected = true; res.pendingSwaps++; }
      }
      if (t >= flip.until) flip.active = false;
    }
    var running = state === 'running' && !flip.active;
    var draining = state === 'done' && v.nTop > 0 && !flip.active;
    var target = v.nTop;
    if (running) {
      var ideal = clk.topAt(rem), fade = (rem - clk.tailMs - 1200) / 3000;
      if (fade > 0) {
        if (fade > 1) fade = 1;
        var ts = now / 1000 + 1;
        ideal += clk.rate * fade * (0.113 * Math.sin(ts * 1.95 + 1.3 * Math.sin(ts * 0.37)) + 0.022 * Math.sin(ts * 11.9 + 1.1 * Math.sin(ts * 1.7)) + 0.007 * Math.sin(ts * 28.9 + 0.5));
      }
      target = Math.max(0, Math.ceil(ideal - 1e-7));
    } else if (draining) target = 0;
    var steps120 = Math.min(6, Math.round(dtw * 120));
    var relCap = motionRecent ? clk.rate / 120 * (3 + 20 * Math.max(0, 1 - (rem - clk.tailMs) / 5000)) : 0;
    var app = { now: now, target: target, gateOpen: running || draining, deepRelease: draining || (running && rem <= 0),
      relCap: relCap, flipping: flip.active, gy: tilted ? 0 : 1, rem: rem, tailMs: clk.tailMs, steps: steps120 };
    // the catch-up (app.js:1266-1276): after a sleep, or a large backlog while calm
    if (app.gateOpen && (back || !motionRecent) && !xfer) {
      var owed = v.nTop - target, cap = back ? Math.max(12, clk.rate * 0.4) : Math.max(400, clk.rate * 1.2);
      if (owed > cap) {
        var before = v.nTop, n = v.fastForward(owed - Math.min(30, Math.ceil(cap * 0.5)));
        xfer = { frames: 1 + Math.floor(rnd() * 2) }; res.transfers++; arm(8, before - n, 'transfer', before); eventThisFrame = true;
      }
    }
    back = false;
    var prevPlanTop = v.nTop, pl = v.plan(app);
    if (pl.released < 0) res.negRel++;
    var ran = false, words = null, out = null;
    if (!xfer && v.residueDue(now)) { v.fastForward(v.nTop); xfer = { frames: 1 + Math.floor(rnd() * 2) }; res.residues++; residue = true; }
    if (xfer) {
      if (--xfer.frames <= 0) {          // readParticles came back: move, upload, done
        var above = topTrue(), below = plant.above + plant.below - above, m = v.transferPlan(above);
        plant.upload(above - m, below + m, v.parity); lastRunT = null;
        v.transferDone(above - m, below + m, target); xfer = null; newGen(); sinceXfer = -1; xferLeft = v.nTop - target;
        if (residue) { res.residueMs = (t - doneT) * 1000; residue = false; }
      }
    } else if (skipRuns > 0) { skipRuns--; res.forcedSkips++; }
    else if (rnd() >= (o.skip === undefined ? 0.03 : o.skip)) {
      var ratio = o.dips && Math.floor(t / 20) % 3 === 2 ? 0.6 : (o.ratio || 1);
      var span = lastRunT === null ? 1 / 60 : Math.min(0.25, t - lastRunT);
      var S = Math.max(1, Math.round(span * ratio * HZ));
      words = v.run({ steps: S, now: now, simDt: S / HZ });
      if (words.closed && (words.vcap !== 0 || words.allow.some(function (x) { return x > -1e8; }))) res.closedWords++;
      if (!words.closed && words.vcap > 0 && words.vcap < 0.25) res.dutyBad++;
      if (pendingExpected && !words.closed) res.pendingOpen++;
      if (!words.closed) lastOpenSeq = words.seq;
      out = plant.run(words, words.from / 1000, (words.to - words.from) / 1000);
      lastRunT = t; ran = true; res.runs++;
      lastArr = Math.max(lastArr, frameNo + 1 + Math.floor(rnd() * 3) + (o.lat || 0));
      lat.push([lastArr, words.seq, out]);
      if (out.crossings) lastCrossFrame = frameNo;
    }
    while (lat.length && lat[0][0] <= frameNo) {
      var x = lat.shift(); v.onReadback(x[1], x[2]);
      if (x[1] > genSeq) maxRead = Math.max(maxRead, x[1]);
      if (pendingExpected && exactAvailable()) pendingExpected = false;
    }

    // ---- checks -------------------------------------------------------------------------------
    res.frames++; sinceXfer++;
    var nTop = v.nTop, closedNow = !app.gateOpen || app.flipping || tilted;
    // the count rises only by CPU events (and a re-time); after a transfer it carries the leftover
    if (nTop > prevTop && !eventThisFrame && !closedNow) res.rises++;
    // after a transfer the count carries the leftover the app left to flow (the first version dropped it)
    if (sinceXfer === 1 && xferLeft > 0 && app.gateOpen && nTop - target < xferLeft - 2) res.xferDropped++;
    prevTop = nTop;
    if (watch) {
      // back to the count from before the event (a swap's only while closed: open, the count falls through it)
      if (watch.pre >= 0 && nTop === watch.pre && watch.pre !== watch.top && (closedNow || watch.kind === 'fill')) res.revert++;
      if (watch.kind === 'transfer') { if (nTop > watch.top) res.revert++; }
      else if (closedNow && nTop !== watch.top && v.n.settleMoves === watch.settle) res.drift++;
      if (--watch.n <= 0) watch = null;
    }
    if (nTop === 0 && topTrue() > 0) res.zeroEarly++;
    // closed a while, settled: the ledger holds exactly the GPU's count (its own base's points)
    closedFor = closedNow && !eventThisFrame && !xfer && !pendingExpected ? closedFor + 1 : 0;
    if (closedFor >= 6 + (o.lat || 0)) { res.closedChecked++; if (v.pT(nTop) !== topTrue()) res.closedCount++; }
    if (relCap > 0 && pl.released > Math.ceil(relCap) * steps120) res.relCapOver++;
    if (relCap > 0 && !closedNow) res.relCapFrames++;
    var supplied = ran && !words.closed && plant.above === words.targets[words.steps - 1];
    supRun = supplied ? supRun + 1 : (ran ? 0 : supRun);
    tHist.push(target); if (tHist.length > 6) tHist.shift();
    var falling = tHist.length === 6;
    for (var h = 1; h < tHist.length; h++) if (tHist[h] > tHist[h - 1]) falling = false;
    // (not while relCap holds the count above a falling target: a backlog leaving as a thread)
    if (supRun >= 5 + (o.lat || 0) && falling && running && target > 0 && !watch && !xfer && !(relCap > 0 && target < prevPlanTop - Math.ceil(relCap) * steps120)) {
      res.supChecked++;
      if (nTop !== target) res.supMismatch++;
    }
    // frames short in the bulk: the GPU above its run's end target
    if (ran && !words.closed && running && rem > clk.tailMs && t > 2 && t > quietUntil && (o.held || !motionRecent) && !watch) {
      res.bulkRuns++;
      var sh = plant.above - words.targets[words.steps - 1];
      if (sh > 0) { res.shortRuns++; if (sh > res.worstShort) res.worstShort = sh; }
      if (words.vcap === 0) res.dutyOff++; else if (words.vcap <= 0.25 + 1e-9) res.dutyOn++;
    }
    // maybeRetime (app.js:216-228), after the frame
    if (state === 'running' && !flip.active && !tilted && now - lastMotionAt >= 750 && now - lastRetime >= 500 &&
        rem > clk.tailMs + 2000 && nTop > clk.tailGrains + 2 && Math.abs(nTop - clk.topAt(rem)) > Math.max(3, 0.5 * clk.rate)) {
      var mpg = (rem - clk.tailMs) / (nTop - clk.tailGrains);
      if (mpg > clk.mpg0 / 4 && mpg < 4 * clk.mpg0) { clk.mpg = mpg; clk.rate = 1000 / mpg; lastRetime = now; res.retimes++; retimed = true; }
    }
    if (state === 'done' && nTop === 0 && zeroFrame < 0) zeroFrame = frameNo;
    if (state !== 'running' && !flip.active && !pouring_active() && topTrue() === 0 && !xfer && t > doneT + 0.3 && nTop === 0) { res.ended = true; break; }
  }
  res.viol = plant.viol; res.startErr = plant.startErr; res.closedCross = plant.closedCross;
  res.endMs = (plant.lastCrossT - doneT) * 1000; res.freeEndMs = (plant.lastFreeT - doneT) * 1000; res.endSub = plant.lastCrossSub * 1000;
  res.zeroAfter = zeroFrame >= 0 && lastCrossFrame >= 0 ? zeroFrame - lastCrossFrame : NaN;
  res.finalTop = v.nTop; res.finalAbove = topTrue();
  res.settleMoves = v.n.settleMoves; res.settleLate = v.n.settleLate; res.pendings = v.n.pendings; res.mismatches = v.n.mismatches;
  res.kvEnd = +v.kv.toFixed(1); res.dropped = v.n.dropped;
  return res;

  function pouring_active() { return !!(pouring && t < pouring.until); }
  function pourNow(n) {
    var g0 = v.nTop, tot0 = v.total, p0 = plant.above + plant.below;
    var r = v.pour(n);
    plant.append(r.points, r.mirrored);
    res.pours++;
    if (r.grains !== n || v.nTop !== g0 + n || v.total !== tot0 + n || plant.above + plant.below !== p0 + r.points || v.points !== p0 + r.points) res.pourErr++;
    rem = clk.remAt(clk.topAt(rem) + r.grains);
    if (state === 'done') state = 'paused';
    if (watch) { watch.top += n; if (watch.pre >= 0) watch.pre += n; }
    quietUntil = t + 1; eventThisFrame = true;
  }
}

module.exports = { rng: rng, makeClock: makeClock, glassFor: glassFor, grainsFor: grainsFor, Plant: Plant, runCase: runCase,
  firstVersion: firstVersion, HZ: HZ, QMAX: QMAX };
