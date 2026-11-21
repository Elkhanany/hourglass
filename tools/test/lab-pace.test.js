#!/usr/bin/env node
/*
 * The sand lab's GPU pace (realsand/pace.mjs) in Node, without a browser: a model of the
 * page's frame loop (main.mjs loop(): skip while S.queue frames are in flight, the budget,
 * auto Hz held under it, the substeps a frame) driving the very functions the page uses,
 * against three models of when a phone's GPU reports a frame done:
 *   prop   when its work is done (a fixed per-frame cost F plus c ms a substep);
 *   floor  never sooner than about 0.93 of a display frame after submit, whatever the work
 *          (the owner's iPhone at 5cc11b3, 30 Hz display: 31 ms for a frame of 48 substeps
 *          and for one of 47 on a larger bed, where its real-speed rows put the work at 17
 *          and 26 ms);
 *   vsync  at the first display refresh after the work is done.
 * c and F: 0.40 ms (the phone's own coarse 1-minute rows) and 0.593 ms (the cost model's
 * prediction for the default), with 1.5 and 3 ms a frame. All predictions from models, not
 * a phone.
 *
 * Checks, at the default (2 frames in flight, budget on), the sand wanting 1440 Hz as in a
 * pour or a fast turn: where the GPU has room (its work fits in a display frame at the base
 * rate), sim/real >= 0.9, frames drawn >= 0.9 of the display rate, the budget never cut
 * below the base rate's need, at most 2 frames in flight and the median lag within 2 display
 * frames plus the frame's own work; on a GPU that cannot keep up (medium, quarter: 1.76 ms a
 * substep), the lag stays within 2 frames of its work and the frames keep coming. Control:
 * 9b0a9f1's rule (the budget from submit-to-done over substeps, 1 frame in flight), kept
 * below, collapses under the floor and vsync models (sim/real < 0.2): the fault these checks
 * would catch. From full to calm the budget, substeps a frame, is scaled with the frame's
 * time, so calm's first frames run the 16 substeps they need (control: unscaled, 9, 10, 10, ...).
 *
 *   node tools/test/lab-pace.test.js
 */
'use strict';
var path = require('path');
var t0 = Date.now(), count = 0, failures = 0;
function log(s) { console.log(s); }
function check(ok, what) { count++; if (!ok) failures++; log((ok ? 'ok    ' : 'FAIL  ') + what); }

var HZ_BOOST = [1, 1.5, 2, 3];

/* 9b0a9f1's paceAfter (main.mjs), the control: the budget from ms / substeps. */
function oldPaceAfter(pace, steps, ms, T, now, top, held) {
  if (!steps) return;
  pace.log.push({ steps: steps, ms: ms }); if (pace.log.length > 8) pace.log.shift();
  var per = pace.log.reduce(function (s, x) { return s + x.ms; }, 0) / pace.log.reduce(function (s, x) { return s + x.steps; }, 0);
  var fit = Math.max(1, Math.floor(0.75 * T / per));
  if (now > pace.ceilUntil) pace.ceil = Infinity;
  var tp = Math.min(top, Math.max(1, Math.floor(0.9 * pace.ceil)));
  if (ms > 1.2 * T) {
    pace.ceil = steps; pace.ceilUntil = now + 2000;
    pace.budget = Math.max(1, Math.min(isFinite(pace.budget) ? pace.budget : steps, fit, Math.floor(0.8 * steps)));
  } else if (ms < 0.9 * T) pace.budget = Math.min(tp, fit);
  else {
    var b = isFinite(pace.budget) ? pace.budget : steps;
    if (now - pace.lastSkip < 500) pace.budget = Math.max(1, b - Math.max(1, Math.ceil(0.1 * b)));
    else if (!isFinite(pace.budget) || steps >= pace.budget || held) pace.budget = Math.min(tp, b + Math.max(1, Math.ceil(0.05 * b)));
  }
}

function simulate(P, o) {
  var Tdisp = o.Tdisp, base = o.base || 480, capBase = o.cap || 24, queue = o.queue, rule = o.rule || 'new';
  var rnd = o.seed || 1;
  function R() { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; }
  function gauss() { var u = 0; for (var i = 0; i < 6; i++) u += R(); return u - 3; }
  var top = Math.min(1440, base * 3), rates = HZ_BOOST.map(function (b) { return Math.round(base * b); }).filter(function (h) { return h <= top; });
  var want = o.want || 1440;
  var rate = { hz: base, downAt: 0, held: 0, capUntil: 0 };
  var pace = P.newPace(), old = { log: [], budget: Infinity, ceil: Infinity, ceilUntil: 0, lastSkip: -1e9 };
  var capNow = function () { return Math.max(1, Math.round(capBase * rate.hz / base)); };
  var capAllocHz = Math.max(1, Math.round(capBase * top / base));
  var budgetNow = function () { return rule === 'new' ? pace.budget : old.budget; };
  var capFrame = function () { var b = budgetNow(); return isFinite(b) ? Math.max(1, Math.min(capNow(), b)) : capNow(); };
  var simTime = 0, acc = 0, lastNow = 0, lastSteps = 0, gpuFree = 0, events = [];
  var frames = 0, skips = 0, simSum = 0, lags = [], minBudget = Infinity, peak = 0;
  var need = Math.ceil(base * Tdisp / 1000);
  function doneAt(tSub, steps) {
    var start = Math.max(tSub, gpuFree), end = start + o.F + o.c * steps;
    gpuFree = end;
    if (o.model === 'floor') end = Math.max(end, tSub + 0.93 * Tdisp + 1.5 * gauss());
    if (o.model === 'vsync') end = Math.ceil((end + 0.5) / Tdisp) * Tdisp + 0.3 + Math.abs(gauss()) * 0.5;
    return end + 0.3;
  }
  var tEnd = (o.secs || 12) * 1000;
  for (var k = 1; k * Tdisp < tEnd; k++) {
    var now = k * Tdisp + 0.2 * gauss();
    events.sort(function (a, b) { return a.t - b.t; });
    while (events.length && events[0].t <= now) {
      var e = events.shift();
      if (rule === 'new') P.paceDone(pace, e.seq, e.steps, e.t - e.tSub, Tdisp);
      else { pace.inflight = Math.max(0, pace.inflight - 1); oldPaceAfter(old, e.steps, e.t - e.tSub, Tdisp, e.t, capAllocHz, rate.held); }
      if (e.tSub > 4000) lags.push(e.t - e.tSub);
    }
    var dtReal = lastNow ? Math.min((now - lastNow) / 1000, 0.25) : 1 / 60; lastNow = now;
    if (pace.inflight >= queue) {
      skips += now > 4000 ? 1 : 0;
      if (rule === 'new') P.paceSkip(pace, now); else old.lastSkip = now;
      acc = Math.min(acc + dtReal, capFrame() / rate.hz);
      continue;
    }
    if (rule === 'new') P.paceBudget(pace, { now: now, need: need, top: capAllocHz, last: lastSteps });
    // chooseRate's hold under the budget (main.mjs)
    rate.held = 0;
    var b = budgetNow(), hzCap = isFinite(b) ? b * 1000 / Tdisp : Infinity, w = rates.find(function (h) { return h >= want; }) || rates[rates.length - 1];
    if (rule === 'new') { var c = P.capRate(rate, { rates: rates, want: w, hz: rate.hz, hzCap: hzCap, now: now }); if (c.held) { rate.held = c.held; w = c.want; } }
    else if (w > hzCap) { var x = rates.filter(function (h) { return h <= hzCap; }).pop() || rates[0]; if (x < w) { rate.held = w; w = x; } }
    if (w >= rate.hz) { rate.hz = w; rate.downAt = simTime + 0.3; }
    else if (simTime >= rate.downAt || rate.held) { rate.hz = w; rate.downAt = simTime + 0.3; }
    var cap = capFrame(), avail = acc + dtReal;
    acc = Math.min(avail, cap / rate.hz);
    var dropped = avail - acc;
    var steps = Math.min(cap, Math.floor((acc + 1e-9) * rate.hz)); acc -= steps / rate.hz;
    simTime += steps / rate.hz; lastSteps = steps;
    pace.binding = (dropped > 1e-6 && cap < capNow()) || !!rate.held;
    var tSub = now + 1.0, seq = rule === 'new' ? P.paceSubmit(pace, tSub) : (pace.inflight++, 0);
    peak = Math.max(peak, pace.inflight);
    events.push({ t: doneAt(tSub, steps), steps: steps, tSub: tSub, seq: seq });
    if (now > 4000) { frames++; simSum += steps / rate.hz; if (isFinite(budgetNow())) minBudget = Math.min(minBudget, budgetNow()); }
  }
  var wall = (tEnd - 4000) / 1000;
  lags.sort(function (a, b) { return a - b; });
  return { fps: frames / wall, display: 1000 / Tdisp, simReal: simSum / wall, hz: rate.hz, budget: budgetNow(), minBudget: minBudget, need: need,
    lag: lags.length ? lags[lags.length >> 1] : NaN, peak: peak, skipped: skips / Math.max(1, skips + frames) };
}

function f2(x) { return (Math.round(x * 100) / 100).toString(); }
function desc(r) { return 'fps ' + f2(r.fps) + ' of ' + f2(r.display) + ', sim/real ' + f2(r.simReal) + ', rate ' + r.hz + ', budget ' + r.budget + ' (lowest ' + r.minBudget + ', base need ' + r.need + '), lag ' + f2(r.lag) + ' ms, ' + r.peak + ' in flight, ' + Math.round(100 * r.skipped) + '% skipped'; }

async function main() {
  var P = await import(path.join(__dirname, '..', '..', 'realsand', 'pace.mjs'));
  var Q = P.QUEUE_DEFAULT;
  check(Q === 2, 'the page allows 2 frames of GPU work in flight by default (' + Q + ')');
  log('Models of a phone (predictions, not measurements); the sand wants 1440 Hz throughout:');
  [30, 60].forEach(function (hzDisp) {
    var T = 1000 / hzDisp;
    ['prop', 'floor', 'vsync'].forEach(function (model) {
      [[0.40, 1.5], [0.593, 3]].forEach(function (cf) {
        var name = hzDisp + ' Hz ' + model + ' c=' + cf[0] + ' F=' + cf[1];
        var r = simulate(P, { Tdisp: T, model: model, c: cf[0], F: cf[1], queue: Q });
        log('  ' + name + ': ' + desc(r));
        check(r.simReal >= 0.9 && r.fps >= 0.9 * r.display && r.minBudget >= r.need && r.peak <= Q && r.lag <= 2 * T + cf[1] + cf[0] * r.budget + 1,
          name + ': real time (sim/real ' + f2(r.simReal) + '), frames at the display rate (' + f2(r.fps) + '), the budget never below the base need (' + r.minBudget + ' >= ' + r.need + '), ' + r.peak + ' in flight, lag ' + f2(r.lag) + ' ms');
        if (model !== 'prop') {
          var c = simulate(P, { Tdisp: T, model: model, c: cf[0], F: cf[1], queue: 1, rule: 'old' });
          check(c.simReal < 0.2, 'control, 9b0a9f1\'s rule (1 in flight, budget from ms / substeps), ' + name + ': collapses (' + desc(c) + ')');
        }
      });
    });
    // a GPU that cannot keep up: medium, quarter (the model's 1.76 ms a substep), the sand wanting
    // 1440 Hz; what it can give: (T - F) / c substeps a display frame, against the base need
    ['prop', 'floor', 'vsync'].forEach(function (model) {
      var h = simulate(P, { Tdisp: T, model: model, c: 1.76, F: 3, queue: Q });
      // (reported at the refresh, a frame's work must end inside one refresh: whole substeps in T - 1.5 ms)
      var can = Math.min(1, (model === 'vsync' ? Math.floor((T - 1.5 - 3) / 1.76) : (T - 3) / 1.76) / (480 * T / 1000));
      log('  ' + hzDisp + ' Hz ' + model + ', a GPU that cannot keep up (1.76 ms a substep; it can give ' + f2(can) + ' of the base rate): ' + desc(h));
      check(h.peak <= Q && h.lag <= 2 * (3 + 1.76 * Math.max(h.budget, h.need)) + T && h.fps >= 0.6 * h.display && h.simReal >= 0.75 * can,
        hzDisp + ' Hz ' + model + ', a GPU that cannot keep up: frames keep coming (' + f2(h.fps) + ' fps), lag within 2 frames of its work and one display frame (' + f2(h.lag) + ' ms), sim/real ' + f2(h.simReal) + ' (it can give ' + f2(can) + ')');
    });
  });
  // capRate: the rate does not hop between rungs as the budget moves
  var rt = { capUntil: 0 }, rates = [480, 720, 960, 1440];
  var a = P.capRate(rt, { rates: rates, want: 1440, hz: 960, hzCap: 900, now: 1000 });
  var b2 = P.capRate(rt, { rates: rates, want: 1440, hz: a.want, hzCap: 2000, now: 1100 });
  var c2 = P.capRate(rt, { rates: rates, want: 1440, hz: a.want, hzCap: 2000, now: 1400 });
  var d2 = P.capRate({ capUntil: 0 }, { rates: rates, want: 960, hz: 720, hzCap: 1000, now: 0 });
  check(a.want === 720 && a.held === 1440 && b2.want === 720 && c2.want === 1440 && d2.want === 720,
    'auto Hz under the budget: down at once (' + a.want + '), not up again for 0.3 s (' + b2.want + ', then ' + c2.want + '), and up only with 10 % room (960 under 1000: ' + d2.want + ')');
  // the valve: a promise from before a 3-s valve does not take a newer frame off the count
  var p = P.newPace(), s1 = P.paceSubmit(p, 0);
  P.paceValve(p, 3500);
  var s2 = P.paceSubmit(p, 3600);
  var late = P.paceDone(p, s1, 10, 4000, 16);
  check(!late && p.inflight === 1 && P.paceDone(p, s2, 10, 20, 16) && p.inflight === 0, 'a late promise from before the 3-s valve is ignored; the newer frame stays counted until its own');
  // full to calm (the page's loop: calm draws every other display frame, at the same substep
  // rate): a budget learnt in full (9 substeps a frame, a phone held near 540 Hz) is scaled with the
  // frame's time, so calm's frames run their 16 at once; a GPU that keeps up (no skips)
  var calm = function (scale) {
    var q = P.newPace(), hz = 480, cap = 24, T0 = 1000 / 60, acc = 0, last = 0, out = [];
    q.budget = 9; q.binding = true;
    for (var f = 0; f < 60; f++) {
      var now = f * T0, mode = f < 20 || f >= 40 ? 'full' : 'calm', T = mode === 'calm' ? 1000 / 30 : T0;
      if (scale) P.paceFrame(q, T);
      if (mode === 'calm' && last && now - last < T - 0.5 * T0) { acc = Math.min(acc + T0 / 1000, Math.min(cap, q.budget) / hz); continue; }
      last = now;
      P.paceBudget(q, { now: now, need: Math.ceil(hz * T / 1000), top: 72, last: 0 });
      var capF = isFinite(q.budget) ? Math.max(1, Math.min(cap, q.budget)) : cap, avail = acc + T0 / 1000;
      acc = Math.min(avail, capF / hz);
      var dropped = avail - acc, steps = Math.min(capF, Math.floor((acc + 1e-9) * hz));
      acc -= steps / hz; q.binding = dropped > 1e-6 && capF < cap;
      P.paceDone(q, P.paceSubmit(q, now), steps, 5, T);
      out.push({ f: f, mode: mode, steps: steps, budget: q.budget });
    }
    return out;
  };
  var cs = calm(true), co = calm(false);
  var firstCalm = function (o) { return o.filter(function (x) { return x.mode === 'calm'; }).slice(0, 4).map(function (x) { return x.steps; }); };
  var backFull = cs.filter(function (x) { return x.f >= 40; })[0];
  check(firstCalm(cs).every(function (k) { return k >= 16; }) && backFull.budget === 9 && firstCalm(co)[0] < 16,
    'from full to calm the budget is scaled with the frame\'s time: calm\'s first frames run ' + firstCalm(cs).join(', ') + ' substeps (16 needed), and back in full ' + backFull.budget + ' a frame; control, unscaled: ' + firstCalm(co).join(', '));
}

main().catch(function (e) { failures++; log('FAIL  ' + (e && e.stack || e)); }).then(function () {
  log((failures ? 'lab-pace: ' + failures + ' of ' + count + ' checks FAILED' : 'lab-pace: all ' + count + ' checks passed') + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  process.exit(failures ? 1 : 0);
});
