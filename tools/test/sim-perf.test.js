/*
 * physics-core acceptance 12: performance (this machine).
 *
 *   every profile, a 5-minute glass mid-run, damage armed: per-frame (two
 *   steps) p95 ≤ 3.0 ms at q 1.08 and ≤ 4.0 ms at q 1.3, and no frame over
 *   6 ms after the first 2 s
 *   a free spin (flicked to 16 rad/s and coasting, a completeFlip at every
 *   half turn, as app.js spins it): per-frame p95 ≤ 3.0 ms at q 1.08, and
 *   no frame that turns the lattice over above 6 ms
 *   the idle path costs what f446085's step() did, within ±10 %
 *   quality 0 cuts lateralVV's mean frame time by ≥ 30 %
 *
 * Timing runs in this one process, one glass at a time, on one Sim per
 * scale that is reset between runs (as the page keeps one), after a
 * warm-up that takes every code path once (cracks, a breach, a leak,
 * spins, the lighter quality levels), so the numbers are the steady state
 * of a page that has been running.
 *
 * Shared machines are noisy. Each frame also records the CPU time the
 * process spent, and a frame over 6 ms counts against the budget only if
 * the process was busy for at least half of it; a frame the OS took away
 * is reported as preempted instead. HOURGLASS_PERF_TRIES=n (default 3)
 * retries a profile that misses its budget and keeps its best run.
 *
 *   node tools/test/sim-perf.test.js        exits 0 when every case passes
 */
'use strict';
var fs = require('fs');
var L = require('./lib/load-physics.js');
var H = require('./lib/harness.js');
var Clock = H.Clock, Pr = H.Profiles;
var DT = H.DT, DT_MS = Clock.DT_MS;
var TRIES = +(process.env.HOURGLASS_PERF_TRIES || 3);
var now = typeof performance !== 'undefined' ? function () { return performance.now(); } : function () { return Date.now(); };

/** One Sim per scale, reset between runs, as the page keeps one. */
var SIMS = {};
/** Frame times (ms, two steps each) of profile `name` on a fresh glass: {wall, cpu}. */
function timeProfile(name, scale, quality, secs) {
  if (!SIMS[scale]) SIMS[scale] = new H.P.Sim({ scale: scale, seed: 4242 });
  var run = H.glassAt({ durMs: 300000, startMs: 150000, seed: 4242, scale: scale, sim: SIMS[scale] });
  var sim = run.sim, T = run.T, prof = Pr.PROFILES[name];
  var n = Math.round((secs || prof.dur) / DT), frames = new Float64Array(n >> 1), cpu = new Float64Array(n >> 1);
  var nf = 0, acc = 0, cacc = 0;
  var f = { x: 0, y: 0, z: 0, w: 0, al: 0 }, inp = {}, lastMotion = -1e9;
  sim.damageArmed = true;
  sim.quality = quality === undefined ? 2 : quality;
  for (var k = 0; k < n; k++) {
    Pr.sample(name, k * DT, f);
    H.felt(sim, f, inp);
    sim.setMotion(inp.ax, inp.ay, inp.w, inp.al, H.LAM, inp.gz);
    T.tick(DT_MS, false);
    T.apply(k * DT_MS, false, true);
    sim.relCap = T.relCap((k - lastMotion) * DT < 2);
    if ((k & 1) === 0) { sim.beginFrame(); acc = 0; cacc = 0; }
    var c0 = process.cpuUsage(), t0 = now();
    sim.step();
    acc += now() - t0;
    var c1 = process.cpuUsage(c0);
    cacc += (c1.user + c1.system) / 1000;
    if (sim.motionActive()) lastMotion = k;
    sim.escN = 0;
    if (k & 1) { cpu[nf] = cacc; frames[nf++] = acc; }
  }
  return { wall: frames.subarray(0, nf), cpu: cpu.subarray(0, nf) };
}
/**
 * A free spin as app.js makes one (H.Turner): flicked to 16 rad/s in a
 * quarter of a second, then coasting under drag, dry friction and the
 * skater effect, with a completeFlip at every half turn, until the detent
 * sets it down. λ 0.08, the clock standing still, as while any turn lasts.
 * Frames (two steps, the body's step included) of the spin, and the
 * frames that contain a completeFlip, apart.
 */
function timeSpin(scale, seed) {
  if (!SIMS[scale]) SIMS[scale] = new H.P.Sim({ scale: scale, seed: 4242 });
  var run = H.glassAt({ durMs: 300000, startMs: 150000, seed: seed, scale: scale, sim: SIMS[scale] });
  var sim = run.sim, tn = new H.Turner(sim, H.LAM), acc = 0, cacc = 0, swapped = false;
  var spin = { wall: [], cpu: [] }, swap = { wall: [], cpu: [] };
  sim.gateOpen = false;
  tn.flick(16, 0.25);
  for (var k = 0; tn.busy() && k < 2400; k++) {
    if ((k & 1) === 0) { sim.beginFrame(); acc = 0; cacc = 0; swapped = false; }
    var c0 = process.cpuUsage(), t0 = now();
    tn.step();
    sim.step();
    acc += now() - t0;
    var c1 = process.cpuUsage(c0);
    cacc += (c1.user + c1.system) / 1000;
    if (tn.swapped) swapped = true;
    sim.escN = 0;
    if (k & 1) { var d = swapped ? swap : spin; d.wall.push(acc); d.cpu.push(cacc); }
  }
  return { spin: spin, swap: swap, swaps: tn.swaps };
}

function stats(fr) {
  var a = Array.prototype.slice.call(fr.wall), s = a.slice().sort(function (x, y) { return x - y; });
  var over6 = 0, preempted = 0, lateMax = 0;
  for (var i = 120; i < a.length; i++) {
    if (a[i] > lateMax) lateMax = a[i];
    if (a[i] > 6) { if (fr.cpu[i] >= 0.5 * a[i]) over6++; else preempted++; }
  }
  return { mean: H.mean(a), p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1], lateMax: lateMax, over6: over6, preempted: preempted };
}

var failures = 0, lines = [];
function report(ok, text) { if (!ok) failures++; console.log((ok ? 'PASS  ' : 'FAIL  ') + text); }
var t00 = Date.now();

// warm-up: every code path once, at both scales
[1.08, 1.3].forEach(function (q) {
  timeProfile('vigSlow60', q, 2, 14);
  timeProfile('lateralVV', q, 2, 10);
  timeProfile('veryVigSlow', q, 2, 10);
  timeProfile('wristTwist', q, 2, 3);
  timeProfile('tableSpin', q, 2, 3);
  timeProfile('drop', q, 1, 4);
  timeProfile('vigorous', q, 1, 3);
  timeProfile('vigorous', q, 0, 3);
});
timeSpin(1.08, 1); timeSpin(1.08, 2);

// a free spin: the spin's frames, and the frames that turn the lattice over
(function () {
  var best = null;
  for (var t = 0; t < TRIES; t++) {
    var r = timeSpin(1.08, 11 + t), sp = r.spin.wall.slice().sort(function (x, y) { return x - y; });
    var p95 = sp[Math.floor(sp.length * 0.95)], swMax = 0, swPre = 0;
    for (var i = 0; i < r.swap.wall.length; i++) {
      var w = r.swap.wall[i];
      if (w > 6 && r.swap.cpu[i] < 0.5 * w) { swPre++; continue; }        // the OS, not the sim
      if (w > swMax) swMax = w;
    }
    var o = { p95: p95, p50: sp[sp.length >> 1], max: sp[sp.length - 1], swMax: swMax, swPre: swPre, swaps: r.swaps, n: sp.length };
    if (!best || o.p95 + o.swMax / 2 < best.p95 + best.swMax / 2) best = o;
    if (best.p95 <= 3.0 && best.swMax <= 6) break;
  }
  report(best.p95 <= 3.0 && best.swMax <= 6, 'free spin at q 1.08 (flicked to 16 rad/s, λ 0.08, ' + best.swaps + ' half turns): per-frame p95 ' +
    best.p95.toFixed(2) + ' ms (≤ 3.0; p50 ' + best.p50.toFixed(2) + ', max ' + best.max.toFixed(2) + ' over ' + best.n + ' frames); ' +
    'frames with a completeFlip at most ' + best.swMax.toFixed(2) + ' ms (≤ 6)' + (best.swPre ? '; ' + best.swPre + ' preempted by the OS' : ''));
})();

[[1.08, 3.0], [1.3, 4.0]].forEach(function (c) {
  var worstP95 = 0, worstName = '', bad = [], notes = [], preempted = 0;
  Pr.names.forEach(function (name) {
    var best = null;
    for (var t = 0; t < TRIES; t++) {
      var st = stats(timeProfile(name, c[0]));
      if (!best || st.p95 + st.over6 * 10 < best.p95 + best.over6 * 10) best = st;
      if (best.p95 <= c[1] && best.over6 === 0) break;
    }
    if (best.p95 > worstP95) { worstP95 = best.p95; worstName = name; }
    preempted += best.preempted;
    if (best.p95 > c[1] || best.over6 > 0) bad.push(name + ' p95 ' + best.p95.toFixed(2) + ', max after 2 s ' + best.lateMax.toFixed(2));
    notes.push(name + ' ' + best.mean.toFixed(2) + '/' + best.p95.toFixed(2) + '/' + best.lateMax.toFixed(1));
  });
  report(bad.length === 0, 'q ' + c[0] + ': per-frame p95 ≤ ' + c[1] + ' ms and no frame > 6 ms after 2 s, all ' + Pr.names.length +
    ' profiles; worst p95 ' + worstP95.toFixed(2) + ' ms (' + worstName + ')' +
    (preempted ? '; ' + preempted + ' frame(s) over 6 ms were the OS, not the sim (CPU < half the wall time)' : '') +
    (bad.length ? '; over budget: ' + bad.join('; ') : ''));
  console.log('      mean/p95/late-max ms: ' + notes.join(', '));
});

// the idle path against f446085, both loaded the same way, alternating
(function () {
  var NEW = L.loadIsolated(fs.readFileSync(L.PHYSICS, 'utf8'), 'physics.js');
  var OLD = L.baseline();
  function idleCost(Pk, reps) {
    var sim = new Pk.Sim({ scale: 1.08, seed: 99 });
    sim.reset(Clock.grainsFor(sim, 300000));
    for (var i = 0; i < 400; i++) { sim.beginFrame(); sim.step(); }
    var T = new Clock(sim, 300000);
    T.start();
    var t0 = now();
    for (var k = 0; k < reps; k++) {
      T.tick(DT_MS); T.apply(k * DT_MS, false, true);
      if ((k & 1) === 0) sim.beginFrame();
      sim.step();
    }
    return (now() - t0) / reps;
  }
  idleCost(NEW, 6000); idleCost(OLD, 6000);
  var a = [], b = [];
  for (var r = 0; r < 7; r++) { a.push(idleCost(OLD, 7200)); b.push(idleCost(NEW, 7200)); }
  a.sort(); b.sort();
  var mo = a[3], mn = b[3], d = mn / mo - 1;
  report(Math.abs(d) <= 0.10, 'idle path (5-min glass running, calm): ' + (mn * 1000).toFixed(2) + ' µs/step vs f446085 ' +
    (mo * 1000).toFixed(2) + ' µs/step (' + (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + ' %, medians of 7 alternating runs)');
})();

// the governor's lightest level
(function () {
  var full = [], light = [];
  for (var r = 0; r < 3; r++) {
    full.push(stats(timeProfile('lateralVV', 1.08, 2)).mean);
    light.push(stats(timeProfile('lateralVV', 1.08, 0)).mean);
  }
  full.sort(); light.sort();
  var cut = 1 - light[1] / full[1];
  report(cut >= 0.30, 'quality 0 cuts lateralVV\'s mean frame from ' + full[1].toFixed(2) + ' to ' + light[1].toFixed(2) +
    ' ms (' + (cut * 100).toFixed(0) + ' %, want ≥ 30 %)');
})();

console.log((failures ? 'perf: ' + failures + ' case(s) FAILED' : 'perf: all cases passed') + ' (' + ((Date.now() - t00) / 1000).toFixed(0) + ' s, load ' +
  require('os').loadavg().map(function (x) { return x.toFixed(2); }).join(' ') + ')');
process.exit(failures ? 1 : 0);
