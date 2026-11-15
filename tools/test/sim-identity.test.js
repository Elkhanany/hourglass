/*
 * physics-core acceptance 1: the idle path is bit-identical.
 *
 * With no motion (setMotion never called, or called with only lam set), the
 * sim must evolve exactly as f446085's physics.js did: the same lattice, the
 * same colour seeds, the same sleep map and stamps, the same airborne
 * grains and the same random stream, step for step. Each case runs 20,000
 * steps of the new sim in lockstep with the baseline, loaded in its own vm
 * context, from the same seed and the same app-like driver (clock.js), and
 * compares full-state hashes every 100 steps.
 *
 * The only change allowed is a refused cross-neck answer in _freeNear (a
 * bug fix); if a case differs, the first difference must fall in a window
 * where sim.neckGuards counted one.
 *
 *   node tools/test/sim-identity.test.js        exits 0 when every case passes
 */
'use strict';
var L = require('./lib/load-physics.js');
var Clock = require('./lib/clock.js');

var STEPS = 20000;
var CHECK = 100;                       // compare every CHECK steps
var FLIP_STEPS = 312;                  // the Flip button's 2.6 s at 120 Hz
var DEG = Math.PI / 180;

var NEW = L.P;
var OLD = L.baseline();

var CASES = [
  { name: '1-min glass, gate open (clock.js)', seed: 4242, durMs: 60000 },
  { name: '45-min glass', seed: 1234, durMs: 2700000 },
  { name: 'tilt 20 deg, 5-min glass', seed: 777, durMs: 300000, tilt: 20 * DEG },
  { name: 'completeFlip at step 6000 (scripted flip)', seed: 99, durMs: 60000, flipAt: 6000 },
  { name: 'pour 300 grains at step 3000', seed: 31337, durMs: 60000, pourAt: 3000 },
  { name: 'tablet scale 1.3, 5-min glass', seed: 2024, durMs: 300000, scale: 1.3 }
];
var VARIANTS = ['no setMotion', 'setMotion(0,0,0,0,0.08,0)'];

/* ---- hashing: FNV-1a over the whole state that drives the next step ---- */
function fnv(h, bytes, n) {
  for (var i = 0; i < n; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
  return h;
}
function floatBytes(a, n) {
  return new Uint8Array(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT);
}
function hashLattice(s) {
  var h = fnv(-2128831035, s.cell, s.cell.length);
  return fnv(h, s.seed, s.seed.length) >>> 0;
}
function hashFull(s) {
  var h = hashLattice(s), np = s.np;
  h = fnv(h, s.stamp, s.stamp.length);
  h = fnv(h, s.rowAct, s.rowAct.length);
  h = fnv(h, floatBytes(s.px, np), np * 4);
  h = fnv(h, floatBytes(s.py, np), np * 4);
  h = fnv(h, floatBytes(s.pvx, np), np * 4);
  h = fnv(h, floatBytes(s.pvy, np), np * 4);
  h = fnv(h, s.pseed, np);
  h = fnv(h, s.pinfo, np);
  var sc = new Float64Array([s.rng, np, s.nTop, s.total, s.steps, s.quiet, s.tick,
                             s.angle, s.tilt, s.gx, s.gy, s.lag, s.targetTop]);
  return fnv(h, floatBytes(sc, sc.length), sc.length * 8) >>> 0;
}

/* ---- an app-like driver, identical for both versions ---- */
function Runner(P, c, variant) {
  var sim = this.sim = new P.Sim({ scale: c.scale || 1.08, seed: c.seed });
  sim.reset(Clock.grainsFor(sim, c.durMs));
  if (c.tilt) { sim.tilt = c.tilt; sim.wakeAll(); }
  this.T = new Clock(sim, c.durMs);
  this.T.start();
  this.c = c;
  this.lam = variant === 1;
  this.flip = -1;                      // steps into a scripted flip, −1 when none
}
Runner.prototype.step = function (k) {
  var sim = this.sim, T = this.T, c = this.c;
  if (c.flipAt && k === c.flipAt - FLIP_STEPS) {
    sim.flipping = true;               // app.js beginTurn()
    sim.wakeAll();
    this.flip = 0;
  }
  if (this.flip >= 0) {
    var p = ++this.flip / FLIP_STEPS;
    if (p >= 1) {                      // app.js swapEnds() then endTurn()
      T.turnOver();
      sim.flipping = false;
      sim.angle = 0;
      sim.wakeAll();
      this.flip = -1;
    } else {
      sim.angle = Math.PI * (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
    }
  }
  if (c.pourAt && k === c.pourAt) T.poured(sim.pour(300));
  var turning = this.flip >= 0;
  T.tick(Clock.DT_MS, turning);
  T.apply(k * Clock.DT_MS, turning);
  // (the baseline has no setMotion: lam alone must change nothing)
  if (this.lam && typeof sim.setMotion === 'function') sim.setMotion(0, 0, 0, 0, 0.08, 0);
  if ((k & 1) === 0) sim.beginFrame();
  sim.step();
};

function runCase(c, variant) {
  var t0 = Date.now();
  var a = new Runner(OLD, c, variant), b = new Runner(NEW, c, variant);
  var firstDiff = -1, diffPart = '', lastGuards = 0, guardWindow = false, firstGuard = -1;
  for (var k = 0; k < STEPS; k++) {
    a.step(k);
    b.step(k);
    if (firstGuard < 0 && b.sim.neckGuards > 0) firstGuard = k;
    if ((k + 1) % CHECK === 0 || k === STEPS - 1) {
      if (firstDiff < 0) {
        var la = hashLattice(a.sim), lb = hashLattice(b.sim);
        var fa = hashFull(a.sim), fb = hashFull(b.sim);
        if (la !== lb || fa !== fb) {
          firstDiff = k + 1;
          diffPart = la !== lb ? 'cell/seed' : 'particles, stamps or scalars';
          guardWindow = b.sim.neckGuards > lastGuards;
        }
      }
      lastGuards = b.sim.neckGuards;
    }
  }
  var s = b.sim, c2 = s.census();
  return {
    same: firstDiff < 0,
    explained: firstDiff >= 0 && guardWindow,
    firstDiff: firstDiff, diffPart: diffPart, firstGuard: firstGuard,
    guards: s.neckGuards,
    hash: hashFull(s), lattice: hashLattice(s),
    np: s.np, nTop: s.nTop, total: s.total,
    censusOk: c2.total === s.total && c2.top === s.nTop,
    secs: (Date.now() - t0) / 1000
  };
}

function hex(h) { return '0x' + ('00000000' + h.toString(16)).slice(-8); }

var failures = 0;
console.log('identity: ' + STEPS + ' steps per case against ' + L.BASELINE_REV + ':physics.js (isolated vm context)');
CASES.forEach(function (c) {
  VARIANTS.forEach(function (vname, variant) {
    var r = runCase(c, variant);
    var ok = (r.same || r.explained) && r.censusOk;
    if (!ok) failures++;
    var what = r.same
      ? 'identical, lattice ' + hex(r.lattice) + ' full ' + hex(r.hash)
      : 'first difference by step ' + r.firstDiff + ' (' + r.diffPart + ')' +
        (r.explained ? ', after a refused cross-neck answer at step ' + r.firstGuard
                     : ', NOT explained by a neck-guard event');
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + c.name + ' [' + vname + ']: ' + what +
      '; nTop ' + r.nTop + '/' + r.total + ', np ' + r.np + ', neck guards ' + r.guards +
      (r.censusOk ? '' : ', CENSUS MISMATCH') + ' (' + r.secs.toFixed(1) + ' s)');
  });
});
console.log(failures ? 'identity: ' + failures + ' case(s) FAILED' : 'identity: all ' + CASES.length * VARIANTS.length + ' cases passed');
process.exit(failures ? 1 : 0);
