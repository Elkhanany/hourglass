/*
 * physics-core acceptance 9: determinism.
 *
 * The same seed and the same sequence of inputs give the same glass, bit
 * for bit, through everything the motion path does: flight, spray and hops,
 * the field with rotation, a crack, its breach and leak, a pour, flips, a
 * seal and the return to the idle path. Two runs are compared by a hash of
 * the whole state every 120 steps; a third run with another seed must
 * differ.
 *
 *   node tools/test/sim-determinism.test.js        exits 0 when every case passes
 */
'use strict';
var H = require('./lib/harness.js');

function fnv(h, bytes) {
  for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  return h;
}
function f32(a, n) { return new Uint8Array(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT); }
function hash(s) {
  var h = -2128831035, np = s.np;
  h = fnv(h, s.cell); h = fnv(h, s.seed); h = fnv(h, s.rowAct);
  h = fnv(h, f32(s.px, np)); h = fnv(h, f32(s.py, np)); h = fnv(h, f32(s.pvx, np)); h = fnv(h, f32(s.pvy, np));
  h = fnv(h, f32(s.segD, 160)); h = fnv(h, f32(s.segP, 160)); h = fnv(h, f32(s.agit, 2)); h = fnv(h, f32(s.bf, 4));
  if (s.holeMap) h = fnv(h, s.holeMap);
  var sc = [s.rng, np, s.nTop, s.total, s.lost, s.steps, s.quiet, s.crackRev, s.cracks.length,
    s.slug[0].U, s.slug[0].Z, s.slug[1].U, s.slug[1].Z, s.slug[0].seat, s.slug[1].seat, s.dMax];
  s.cracks.forEach(function (c) { sc.push(c.L, c.w, c.seed, c.x, c.y); });
  return fnv(h, new Uint8Array(new Float64Array(sc).buffer)) >>> 0;
}

function scenario(seed) {
  var run = H.glassAt({ durMs: 300000, startMs: 20000, seed: seed });
  var s = run.sim, marks = [];
  var each = function (r, k) { if (k % 120 === 119) marks.push(hash(r.sim)); };
  H.drive(run, 'vigSlow60', { armed: true, dur: 9, pourAt: 2, pourN: 150, retime: true, each: each });
  s.completeFlip();
  H.drive(run, 'wristTwist', { armed: true, dur: 3, each: each });
  H.drive(run, 'tableSpin', { armed: true, dur: 3, flipEvery: 200, each: each });
  s.beginFrame();
  s.sealCracks();
  H.drive(run, 'calm', { dur: 5, each: each });
  return { marks: marks, final: hash(s), cracks: s.cracks.length, lost: s.lost, idle: !s.motionActive() };
}

var failures = 0;
var t0 = Date.now();
var a = scenario(4242), b = scenario(4242), c = scenario(4243);
var firstDiff = -1;
for (var i = 0; i < a.marks.length; i++) if (a.marks[i] !== b.marks[i]) { firstDiff = i; break; }
var ok1 = firstDiff < 0 && a.final === b.final && a.marks.length === b.marks.length;
if (!ok1) failures++;
console.log((ok1 ? 'PASS  ' : 'FAIL  ') + 'same seed, same inputs: ' + a.marks.length + ' checkpoints ' +
  (ok1 ? 'identical, final hash 0x' + a.final.toString(16) : 'differ first at checkpoint ' + firstDiff) +
  ' (' + a.cracks + ' cracks, ' + a.lost + ' grains lost, back on the idle path: ' + a.idle + ')');
var ok2 = c.final !== a.final;
if (!ok2) failures++;
console.log((ok2 ? 'PASS  ' : 'FAIL  ') + 'another seed gives another glass: 0x' + c.final.toString(16) + ' vs 0x' + a.final.toString(16));
var ok3 = a.idle && a.cracks > 0 && a.lost > 0;
if (!ok3) failures++;
console.log((ok3 ? 'PASS  ' : 'FAIL  ') + 'the scenario exercised a crack, a leak and the way back to the idle path');
console.log((failures ? 'determinism: ' + failures + ' case(s) FAILED' : 'determinism: all 3 cases passed') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
process.exit(failures ? 1 : 0);
