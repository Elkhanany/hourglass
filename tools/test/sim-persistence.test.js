/*
 * physics-core acceptance 8: a damaged glass survives a reload.
 *
 * The glass is damaged the way a user would damage it, by shaking it hard
 * until it cracks, breaks through and leaks (and a second stretch carries
 * micro-damage), then turned over. serializeDamage() → JSON → a fresh Sim
 * reset to the same total → restoreDamage() must reproduce segD (±1e-3),
 * every crack, holeMap, the mouths and the counters; the JSON stays under
 * 8 KB; and the restored glass keeps leaking from the same breach.
 *
 *   node tools/test/sim-persistence.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');
var P = H.P, Sim = P.Sim;

var failures = 0, count = 0;
function test(name, fn) {
  var t0 = Date.now(), detail;
  count++;
  try {
    detail = fn();
    console.log('PASS  ' + name + (detail ? ': ' + detail : '') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  } catch (e) {
    failures++;
    console.log('FAIL  ' + name + ': ' + (e && e.message ? e.message : e));
    if (process.env.VERBOSE && e && e.stack) console.log(e.stack);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

[[11, 0], [22, 2], [33, 3]].forEach(function (c) {
  var seed = c[0], fill = c[1];
  test('shaken until it leaks, then saved and restored (seed ' + seed + ', ' + H.fillName(H.FILLS[fill]) + ')', function () {
    var f = H.FILLS[fill];
    var run = H.glassAt({ durMs: f[0] * 60000, startMs: f[1] * 1000, seed: seed });
    var s = run.sim;
    H.drive(run, 'vigSlow60', { armed: true, dur: 11 });
    H.drive(run, 'calm', { dur: 0.5 });
    s.completeFlip();
    ok(s.cracks.length >= 1 && s.cracks[0].nh >= 1 && s.lost > 0, 'setup: ' + s.cracks.length + ' cracks, lost ' + s.lost);
    var json = JSON.stringify(s.serializeDamage());
    ok(json.length < 8192, 'JSON is ' + json.length + ' bytes');
    var t = new Sim({ scale: 1.08, seed: seed + 1000 });
    t.reset(s.total);
    t.beginFrame();
    ok(t.restoreDamage(JSON.parse(json)) === true, 'restoreDamage refused its own output');
    ok(t.frame.dmgN === 0, 'restoring made events');
    var worst = 0, q;
    for (q = 0; q < 160; q++) worst = Math.max(worst, Math.abs(t.segD[q] - s.segD[q]));
    ok(worst <= 1e-3, 'segD differs by ' + worst);
    for (q = 0; q < 160; q++) ok(t.segS[q] === s.segS[q], 'flaw strength of segment ' + q);
    ok(t.cracks.length === s.cracks.length, t.cracks.length + ' cracks vs ' + s.cracks.length);
    s.cracks.forEach(function (x, k) {
      var y = t.cracks[k];
      ['seg', 'bulb', 'side', 'x', 'y', 'seed', 'w', 'nh', 'nm', 'sealed', 'u'].forEach(function (key) {
        ok(x[key] === y[key], 'crack ' + k + '.' + key + ': ' + y[key] + ' vs ' + x[key]);
      });
      ok(Math.abs(x.L - y.L) <= 0.05, 'crack ' + k + '.L');
      for (var h = 0; h < x.nh; h++) ok(x.holes[h] === y.holes[h], 'crack ' + k + ' hole ' + h);
      var mx = Array.prototype.slice.call(x.mouth, 0, x.nm).sort().join(), my = Array.prototype.slice.call(y.mouth, 0, y.nm).sort().join();
      ok(mx === my, 'crack ' + k + ' mouth');
    });
    ok(Buffer.compare(Buffer.from(t.holeMap.buffer), Buffer.from(s.holeMap.buffer)) === 0, 'holeMap');
    ok(t.lost === s.lost && t.leakedTop === s.leakedTop && t.leakedBottom === s.leakedBottom, 'counters');
    // damage is saved to 3 dp, so the worst stretch is the same within that
    ok(Math.abs(t.dMax - s.dMax) <= 1e-3 && (t.warnSeg === s.warnSeg || Math.abs(s.segD[t.warnSeg] - s.dMax) <= 1e-3),
       'dMax ' + t.dMax + ' at ' + t.warnSeg + ' vs ' + s.dMax + ' at ' + s.warnSeg);
    ok(JSON.stringify(t.serializeDamage()) === json, 'a second round trip changed the JSON');
    // the restored glass leaks from the same breach when shaken (the sand is
    // laid down as restoreSession does: fast-forwarded to where it was)
    if (t.nTop > s.nTop) t.fastForward(t.nTop - s.nTop);
    ok(t.nTop === s.nTop, 'fast-forward to the saved split');
    t.completeFlip();                    // the way up it was when it leaked
    var lost0 = t.lost, T = new H.Clock(t, 300000);
    T.state = 'idle';
    var r = H.drive({ sim: t, T: T }, 'vigSlow60', { armed: false, clock: false, dur: 4 });
    ok(t.lost > lost0 && r.censusErr === 0, 'the restored breach did not leak (' + (t.lost - lost0) + ')');
    return json.length + ' bytes; ' + s.cracks.length + ' crack(s), L ' + s.cracks.map(function (x) { return x.L.toFixed(1); }).join('/') +
      ', w ' + s.cracks.map(function (x) { return x.w; }).join('/') + ', lost ' + s.lost + '; restored exactly and leaks again (' + (t.lost - lost0) + ' in 4 s)';
  });
});

console.log(failures ? 'persistence: ' + failures + ' of ' + count + ' cases FAILED' : 'persistence: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
