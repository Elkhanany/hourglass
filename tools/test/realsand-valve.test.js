#!/usr/bin/env node
/*
 * Real sand's valve (realsand/valve.mjs) in Node, without a GPU: the ledger and the controller
 * against a model of the neck on the GPU and of the app's clock (lib/realsand-plant.js: the
 * throttle with its own gain, lag and noise, the ticketed membrane exactly as the shader counts
 * it, the flip pass, late readbacks, skipped runs, appends, transfers).
 *
 * Cases: six grain settings (points per grain 0.29 to 1.69: phone and tablet, classic, Fine and
 * Finest), each with a 10 s glass, a 1-minute glass with a 1.5 s pour, with a Flip, with a hand
 * spin of 8 swaps, with a tilt swap in a pour (poured before and after the swap in its frame) at
 * 30 % skipped runs, a 5-minute glass asleep 40 s (the catch-up by transfer) and a Reset; then
 * 25 minutes and 99:59; throttle gains of 10, 14 and 26 (the valve's estimate always starts at
 * 20); sim/real dips to 0.6; calm (runs at 30 fps); held in the hand with Real motion on (relCap
 * throughout); a supply that falls as the bulb empties (10 s and 60 minutes, classic and Finest);
 * the slowest rest (10 s of sand timed to 60 minutes: the duty cycle) and the fastest (60
 * minutes of sand in one, also with a weak neck at sim/real 0.6); a shaken glass (the neck
 * starved, then relCap), and one laid on its side as the throttle reopens (the settlement); a
 * straggler stuck above (the residue transfer); readbacks 15 frames late (a brisk tilt swap
 * reopens the neck before an exact readback: the pending base).
 *
 * Checks, every case: no point crosses so that fewer are above than the substep's target, and
 * counters[3] + appended is the true count at every run's start; a closed neck issues no ticket;
 * a swap with no exact readback at hand keeps every run closed until one arrives; closed a while,
 * the ledger holds exactly the GPU's count; nTop never goes back to its value from before a swap
 * or a fill, and does not change while closed except by CPU events and the one settlement;
 * after a transfer it never rises above what the transfer left and keeps the leftover the app
 * left to flow; nTop === targetTop while the neck is supplied and the target falls; nTop is 0
 * only with no point above; released is never negative; a pour raises the ledger by exactly n
 * grains and the GPU by exactly the points appended; relCap limits the fall; the throttle is
 * never between 0 and 0.25 cells/s (the duty cycle); every glass empties and the last point
 * leaves within one substep of 00:00.0 (the substep's own length, about 2 ms of wall time), and
 * nTop reads 0 within a few frames after; in the bulk under 0.5 % of runs end short of their
 * target, by at most 3 points (not for the fastest rests, whose breathing asks more than the
 * open neck gives, nor with readbacks 15 frames late). Directly: the units, the closed words,
 * a mirrored pour, pourable (room, maxTotal, the brim). Control: the first version's
 * bookkeeping (an append wrote tally[1] and allow carried the pour: counted twice) must let
 * points cross below the target in every pour into an open neck.
 *
 *   node tools/test/realsand-valve.test.js [--table]
 */
'use strict';
var path = require('path');
var L = require('./lib/realsand-plant.js');
var t0 = Date.now(), count = 0, failures = 0, TABLE = process.argv.indexOf('--table') >= 0;
function log(s) { console.log(s); }
function check(ok, what) { count++; if (!ok) failures++; log((ok ? 'ok    ' : 'FAIL  ') + what); }

var SETTINGS = [
  ['classic phone', 1.08, 1], ['classic tablet', 1.3, 1], ['Fine phone', 1.08 * Math.SQRT2, 2],
  ['Fine tablet', 1.3 * Math.SQRT2, 2], ['Finest phone', 2.16, 4], ['Finest tablet', 2.6, 4]
];

// a pour held from 0.3 s before the glass is laid on its side until 0.3 s after its swap; in the
// swap's frame the app pours before the swap (handlePour, then stepGravity), and 10 grains more after it;
// the runs of that frame and the next are skipped (the GPU behind), so the pour waits with the flip pass
function TILT_POUR() { return [{ t: 19.7, type: 'pour', s: 1 }, { t: 20, type: 'tilt', hold: 0.5, pour: 10, skip: 2 }]; }
function f1(x) { return (Math.round(x * 10) / 10).toString(); }
function pct(a, b) { return b ? f1(100 * a / b) + ' %' : '-'; }

async function main() {
  var V = await import(path.join(__dirname, '..', '..', 'realsand', 'valve.mjs'));
  var Valve = V.Valve, Old = L.firstVersion(Valve);

  // ---- units and the contract, directly ----
  var u = new Valve({ ppg: 0.2916 }), uf = u.fill(7, 7);
  check(uf.top === 3 && uf.bottom === 0 && u.pT(7) === 3 && u.pT(0) === 0 && u.pT(1) === 1 && u.conv(1) === 3 && u.conv(-1) === -2,
    'units at 0.29 points a grain: 7 grains are 3 points, pT(G0) = P0, pT(0) = 0, pT(1) = 1, conv(1) = 3 and conv(-1) = -2 (' + [uf.top, u.pT(7), u.pT(1), u.conv(1), u.conv(-1)].join(', ') + ')');
  var mono = true;
  [0.29, 0.42, 0.58, 0.85, 1.17, 1.69].forEach(function (ppg) {
    var w = new Valve({ ppg: ppg }); w.fill(3001, 3001);
    for (var g = 1, p = 0; g <= 3001; g++) { var x = w.pT(g); if (x < p || x < 1) mono = false; p = x; }
    if (w.pT(3001) !== w.points) mono = false;
  });
  check(mono, 'pT never decreases, is at least 1 for a grain and reaches P0 at G0, at every grain setting');
  var c = new Valve({ ppg: 1.69 }); c.fill(100, 100);
  c.plan({ now: 0, target: 100, gateOpen: false, rem: 1e4, tailMs: 500 });
  var cw = c.run({ steps: 8, now: 16.7, simDt: 8 / 480 });
  check(cw.closed && cw.vcap === 0 && cw.allow.every(function (x) { return x === V.ALLOW_SHUT; }) && cw.flags === V.NECK_ON && !cw.flip,
    'closed: vcap 0, every allow ALLOW_SHUT, flags NECK_ON, no flip pass');
  c.completeFlip();
  var pr = c.pour(10);
  check(c.nTop === 10 && c.flipPending && pr.mirrored && pr.points === 17 && c.run({ steps: 8, now: 33.3, simDt: 8 / 480 }).flip && !c.flipPending,
    'a swap waits for its flip pass: a pour then is appended mirrored (17 points for 10 grains), and the next run carries the flip pass');

  // the brim and the room: pourable
  var b = new Valve({ ppg: 1.69 }); b.fill(1000, 1000);
  var room = b.pourable(50, { room: 10 }), cap = b.pourable(50, { maxTotal: 1020 });
  b.plan({ now: 0, target: 1000, gateOpen: true, rem: 1e4, tailMs: 500 });
  b.onReadback(b.run({ steps: 8, now: 16.7, simDt: 8 / 480 }).seq, { above: 1690, below: 0, queue: 0, brim: 16 * 290 });
  var brim = [b.pourable(10, { inlet: 295 }), b.pourable(10, { inlet: 293 })];
  b.completeFlip();
  check(room === 5 && b.Pts(1005) - b.Pts(1000) <= 10 && b.Pts(1006) - b.Pts(1000) > 10 && cap === 20 && brim[0] === 10 && brim[1] === 0 && b.pourable(10, { inlet: 293 }) === 10,
    'pourable: the buffer\'s room (5 grains in 10 points), maxTotal (20), the brim 4 cells below the inlet (10 grains at 5 cells, 0 at 3), not known after a swap (10)');

  // ---- the cases ----
  var cases = [];
  function add(name, o, kind) { cases.push({ name: name, o: o, kind: kind || {} }); }
  SETTINGS.forEach(function (st) {
    var nm = st[0], q = st[1], f2 = st[2];
    add(nm + ', 10 s', { d: 10e3, q: q, fine2: f2 });
    add(nm + ', 1 min, pour 1.5 s at 20 s', { d: 60e3, q: q, fine2: f2, events: [{ t: 20, type: 'pour', s: 1.5 }] }, { pour: true, openPour: true });
    add(nm + ', 1 min, Flip at 30 s', { d: 60e3, q: q, fine2: f2, events: [{ t: 30, type: 'flip' }] });
    add(nm + ', 1 min, spin of 8 swaps at 25 s', { d: 60e3, q: q, fine2: f2, events: [{ t: 25, type: 'spin', n: 8 }] });
    add(nm + ', 1 min, tilt swap in a pour (poured before and after it in the same frame), 30 % of runs skipped', { d: 60e3, q: q, fine2: f2, skip: 0.3, events: TILT_POUR() }, { pour: true });
    add(nm + ', 5 min, asleep 40 s at 60 s', { d: 300e3, q: q, fine2: f2, events: [{ t: 60, type: 'hide', s: 40 }] }, { transfer: true });
    add(nm + ', 1 min, Reset at 15 s', { d: 60e3, q: q, fine2: f2, events: [{ t: 15, type: 'reset' }] });
  });
  add('classic phone, 25 min', { d: 1500e3 });
  add('classic phone, 99:59', { d: 5999e3 });
  [10, 14, 26].forEach(function (kv) { add('classic phone, 10 min, throttle gain ' + kv + ' (estimate starts at 20)', { d: 600e3, kv: kv }); });
  add('classic phone, 5 min, sim/real dips to 0.6', { d: 300e3, dips: true });
  add('classic phone, 5 min, calm: runs at 30 fps', { d: 300e3, fps: 30 });
  add('Finest phone, 1 min, calm: runs at 30 fps, a Flip at 30 s', { d: 60e3, q: 2.16, fine2: 4, fps: 30, events: [{ t: 30, type: 'flip' }] });
  add('classic phone, 5 min, held in the hand with Real motion on (relCap throughout)', { d: 300e3, held: true }, { held: true });
  add('classic phone, 10 s, held in the hand, 30 fps, a tilt swap in a pour', { d: 10e3, held: true, fps: 30, events: TILT_POUR().map(function (e) { return Object.assign({}, e, { t: e.t - 15 }); }) }, { held: true, pour: true });
  add('classic phone, 10 s, supply falls as the bulb empties', { d: 10e3, empties: true });
  add('classic phone, 60 min, supply falls as the bulb empties', { d: 3600e3, empties: true });
  add('Finest phone, 60 min, supply falls as the bulb empties', { d: 3600e3, q: 2.16, fine2: 4, empties: true });
  add('classic phone, slowest rest: 10 s of sand timed to 60 min', { d: 3600e3, grains: L.grainsFor(28099, 10e3) }, { duty: true });
  add('classic phone, fastest rest: 60 min of sand in 1 min', { d: 60e3, grains: L.grainsFor(28099, 3600e3) }, { fast: true });
  add('classic phone, fastest rest, open neck 800 points/s at sim/real 0.6', { d: 60e3, grains: L.grainsFor(28099, 3600e3), q0: 800, ratio: 0.6 }, { fast: true, starved: true });
  add('classic phone, 1 min, shaken 1.5 s at 20 s (starved, then relCap)', { d: 60e3, events: [{ t: 20, type: 'shake', s: 1.5 }] }, { shake: true });
  add('classic phone, 10 s, 3 points stuck above (the residue)', { d: 10e3, stuck: 3 }, { residue: true });
  add('classic phone, 1 min, spin of 8 swaps, readbacks 15 frames late', { d: 60e3, lat: 15, events: [{ t: 25, type: 'spin', n: 8 }] }, { late: true });
  add('Finest tablet, 1 min, tilt swap in a pour, readbacks 15 frames late', { d: 60e3, q: 2.6, fine2: 4, lat: 15, events: TILT_POUR() }, { late: true, pour: true });
  add('classic phone, 1 min, tilt swap in a brisk turn (the neck reopens at once), readbacks 15 frames late', { d: 60e3, lat: 15, events: [{ t: 20, type: 'tilt', hold: 0.21 }] }, { late: true, pending: true });
  add('classic phone, 1 min, shaken 1.5 s at 20 s and laid on its side at 21.6 s (closed as the throttle reopens)', { d: 60e3, events: [{ t: 20, type: 'shake', s: 1.5 }, { t: 21.6, type: 'side', hold: 1 }] }, { shake: true, settle: true });
  add('classic phone, 1 min, the same, readbacks 15 frames late', { d: 60e3, lat: 15, events: [{ t: 20, type: 'shake', s: 1.5 }, { t: 21.6, type: 'side', hold: 1 }] }, { shake: true, settle: true, late: true });

  var rows = [], allSettle = 0, allSettleMoves = 0;
  cases.forEach(function (cs) {
    var r = L.runCase(Valve, cs.o), k = cs.kind;
    rows.push([cs.name, r]);
    var name = cs.name + ' (' + r.N + ' grains, ' + r.points + ' points, ' + r.ppg + ' a grain)';
    var bad = [];
    if (r.viol) bad.push(r.viol + ' substeps with points crossed below the target');
    if (r.startErr) bad.push(r.startErr + ' runs whose counters[3] + appended was not the count above');
    if (r.mismatches) bad.push(r.mismatches + ' readbacks with start + appended - crossings != above');
    if (r.closedCross || r.closedWords) bad.push('a closed neck issued tickets (' + r.closedCross + ' points, ' + r.closedWords + ' runs)');
    if (r.revert) bad.push('nTop went back ' + r.revert + ' times');
    if (r.xferDropped) bad.push('the count dropped the leftover of ' + r.xferDropped + ' transfers');
    if (r.pendingOpen) bad.push(r.pendingOpen + ' runs offered tickets after a swap with no exact readback at hand');
    if (r.closedCount) bad.push('closed and settled, the ledger was not the GPU\'s count in ' + r.closedCount + ' of ' + r.closedChecked + ' frames');
    if (r.drift && !k.late) bad.push('nTop changed while closed ' + r.drift + ' times');
    if (r.supMismatch) bad.push('nTop !== targetTop in ' + r.supMismatch + ' of ' + r.supChecked + ' supplied frames');
    if (r.zeroEarly) bad.push('nTop 0 with points above in ' + r.zeroEarly + ' frames');
    if (r.negRel) bad.push('negative release');
    if (r.pourErr) bad.push(r.pourErr + ' pours not exact');
    if (r.relCapOver) bad.push(r.relCapOver + ' frames released more than relCap');
    if (r.dutyBad) bad.push(r.dutyBad + ' runs with the throttle between 0 and 0.25 cells/s');
    if (!r.ended || r.finalTop !== 0 || r.finalAbove !== 0) bad.push('did not empty (nTop ' + r.finalTop + ', points above ' + r.finalAbove + ')');
    var endMs = k.residue ? r.residueMs : r.endMs;
    // (1e-3 ms: the frames' times are sums of 1/60 s, rounded over up to 360,000 frames)
    var endOk = endMs >= -1e-3 && endMs <= r.endSub + 1e-3;
    if (!endOk && !k.residue) bad.push('the last point left ' + f1(endMs) + ' ms after 00:00.0 (a substep is ' + f1(r.endSub) + ' ms)');
    if (k.residue && !(r.residues === 1 && r.residueMs >= 1500 && r.residueMs <= 1600)) bad.push('the residue was not moved by one transfer 1.5-1.6 s after 00:00.0 (' + r.residues + ', ' + f1(r.residueMs) + ' ms)');
    if (!(r.zeroAfter <= 4 + (cs.o.lat || 0)) && !k.residue) bad.push('nTop read 0 only ' + r.zeroAfter + ' frames after the last point left');
    if (!k.fast && !k.late && r.bulkRuns && (r.shortRuns > 0.005 * r.bulkRuns || r.worstShort > 3)) bad.push(pct(r.shortRuns, r.bulkRuns) + ' of bulk runs short, worst ' + r.worstShort + ' points');
    if (r.settleLate && !k.late) bad.push('a settlement moved the count after a swap (' + r.settleLate + ' grains)');
    if (k.pour && !r.pours) bad.push('no pour');
    if (cs.o.events && cs.o.events.some(function (e) { return e.skip; }) && r.forcedSkips !== 2) bad.push('the runs at the swap were not skipped');
    if (k.transfer && !r.transfers) bad.push('no catch-up transfer');
    if (k.duty && !(r.dutyOn > 0 && r.dutyOff > 0)) bad.push('the throttle was not duty-cycled (' + r.dutyOn + ' runs at 0.25, ' + r.dutyOff + ' shut)');
    if ((k.shake || k.held) && !r.relCapFrames) bad.push('relCap never applied');
    if (k.pending && !(r.pendings && r.pendingSwaps)) bad.push('the pending base was not exercised');
    if (k.settle && !(r.settleMoves && r.closedChecked)) bad.push('the closed count did not settle (' + r.settleMoves + ' moves, ' + r.closedChecked + ' frames checked)');
    if (k.starved && !(r.transfers > 0)) bad.push('the backlog was not caught up by transfers');
    allSettle += r.settleMoves;
    var desc = 'end ' + f1(endMs) + ' ms (substep ' + f1(r.endSub) + '), 0 read ' + r.zeroAfter + ' frames after, ' + pct(r.shortRuns, r.bulkRuns) + ' short (worst ' + r.worstShort + '), ' +
      r.supChecked + ' supplied frames, kv ' + r.kvEnd + (r.transfers ? ', ' + r.transfers + ' transfers' : '') + (r.pendings ? ', ' + r.pendings + ' pending' : '') +
      (r.settleMoves ? ', settled ' + r.settleMoves + 'x' : '') + (r.retimes ? ', ' + r.retimes + ' re-times' : '') + (k.duty ? ', duty ' + r.dutyOn + ' on / ' + r.dutyOff + ' off' : '');
    check(!bad.length, name + ': ' + (bad.length ? bad.join('; ') : desc));
  });

  // ---- the control: the first version's bookkeeping ----
  var crossed = [];
  cases.forEach(function (cs) {
    if (!cs.kind.openPour) return;
    var o = Object.assign({}, cs.o, { firstVersion: true }), r = L.runCase(Old, o);
    crossed.push(r.viol);
  });
  check(crossed.length === SETTINGS.length && crossed.every(function (n) { return n > 0; }),
    'control: the first version\'s bookkeeping lets points cross below the target in every case of a pour into an open neck (' + crossed.length + ' cases: ' + crossed.join(', ') + ' substeps)');

  if (TABLE) {
    log('\ncase | ppg | N | runs | viol | startErr | revert | drift | supMismatch/checked | zeroEarly | endMs | endSub | zeroAfter | short | worst | kv | transfers | pendings | settleMoves | settleLate | rises | retimes');
    rows.forEach(function (x) {
      var r = x[1];
      log([x[0], r.ppg, r.N, r.runs, r.viol, r.startErr, r.revert, r.drift, r.supMismatch + '/' + r.supChecked, r.zeroEarly, f1(r.endMs), f1(r.endSub), r.zeroAfter,
        pct(r.shortRuns, r.bulkRuns), r.worstShort, r.kvEnd, r.transfers, r.pendings, r.settleMoves, r.settleLate, r.rises, r.retimes].join(' | '));
    });
  }
}

main().catch(function (e) { failures++; log('FAIL  ' + (e && e.stack || e)); }).then(function () {
  log((failures ? 'realsand-valve: ' + failures + ' of ' + count + ' checks FAILED' : 'realsand-valve: all ' + count + ' checks passed') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  process.exit(failures ? 1 : 0);
});
