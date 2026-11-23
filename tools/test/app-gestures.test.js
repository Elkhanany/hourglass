/*
 * Controller acceptance 2–7 and 12: the glass as a body under a finger.
 * MOVE (drag by the waist), TURN (drag a bulb), FREE / DETENT (flicks),
 * CATCH, MEND (kintsugi), ZEN (only a pinch and the moon button change it) and
 * REDUCE MOTION. iPhone 12 in Chromium, real touch events (CDP).
 *
 *   node tools/test/app-gestures.test.js [--root <dir>] [--port <n>] [--only move|turn|free|catch|mend|zen|reduced]
 *
 * Exits 0 when every check passes. Runs against the motion stub; the sim,
 * renderer and audio are whatever the served tree has (shims where the
 * renderer or audio module has not landed).
 *
 * e2e-gestures.test.js runs the same scenarios against the real modules
 * (integration E6–E8), with the extra checks that need the motion path.
 */
'use strict';
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

var UPPER_SHOULDER = 6;          // upper bulb, left side, u ≈ 0.16 (segment 0·40 + 6)
// stub: drive the motion stub (else the tree's own motion.js); e2e: the integration extras
var CFG = { stub: true, e2e: false };

/** Per-step recording of the body (and what the sim was given). */
function recBody(t) {
  return t.eval(function () {
    __rec.start(function (H) {
      var b = H.body;
      return [performance.now(), b.px, b.py, b.ax, b.ay, H.sim.angle, b.w, H.sim.mAx, H.sim.mAy,
              H.flip.active ? 1 : 0, b.mode, H.timer.state, document.getElementById('status').textContent,
              document.getElementById('app').classList.contains('zen') ? 1 : 0, H.sim.frame.slides,
              b.vx, b.vy, H.flip.grabAngle];
    });
  });
}
var R_T = 0, R_PX = 1, R_PY = 2, R_AX = 3, R_AY = 4, R_TH = 5, R_W = 6, R_MAX = 7, R_MAY = 8, R_FLIP = 9,
    R_MODE = 10, R_STATE = 11, R_STATUS = 12, R_ZEN = 13, R_SLIDES = 14, R_VX = 15, R_VY = 16, R_GRAB = 17;

/**
 * Per frame, how far (mean rows from the neck) the sand of the bulb that was
 * on top when it started lies: that bulb is lattice bulb 0 after an even
 * number of swaps and bulb 1 after an odd one.
 */
function recTopBulb(t) {
  return t.eval(function () {
    var flips0 = __mon.flips;
    window.__topD = [];
    (function f() {
      var H = window.Hourglass, s = H.sim, W = s.W, gate = s.gateY, odd = (__mon.flips - flips0) % 2 === 1;
      var y0 = odd ? gate + 1 : 1, y1 = odd ? s.H - 1 : gate, sum = 0, n = 0;
      for (var y = y0; y < y1; y += 2) {
        for (var x = s.rowMin[y]; x <= s.rowMax[y]; x += 2) if (s.cell[y * W + x] >= 2) { sum += Math.abs(y - gate); n++; }
      }
      window.__topD.push([performance.now(), n ? sum / n : 0, H.body.mode]);
      if (window.__topD.length < 2000 && !window.__topStop) requestAnimationFrame(f);
    })();
  });
}

/** Drag a bulb round the glass: grab at angle a0 (screen, rad), engage radially, sweep `sweep` rad in ms, release. */
async function arc(t, g, sweep, ms, opts) {
  opts = opts || {};
  var R = (opts.r || 0.2) * g.h, a0 = opts.a0 === undefined ? -Math.PI / 2 : opts.a0, R1 = R + 22;
  await t.touch.down(g.cx + R * Math.cos(a0), g.cy + R * Math.sin(a0));
  await sleep(30);
  await t.touch.move(g.cx + R1 * Math.cos(a0), g.cy + R1 * Math.sin(a0));   // 22 px straight out: engages, no turn
  await sleep(50);
  var flick = !opts.holdMs;                        // a flick lets go while the finger still moves
  await t.touch.path(function (u) {
    var a = a0 + sweep * u;
    return { x: g.cx + R1 * Math.cos(a), y: g.cy + R1 * Math.sin(a) };
  }, ms, flick);
  if (!flick) {
    await sleep(opts.holdMs);
    await t.touch.up();
  }
  return t.eval(function () { return { w: __mon.upW, t: __mon.upAt }; });
}

/** Wait until the glass is home and still (or ms pass); returns the page time it happened, or -1. */
async function waitRest(t, ms) {
  try {
    await t.page.waitForFunction(function () {
      var H = window.Hourglass;
      return H.body.mode === 'rest' && H.sim.angle === 0 && !H.flip.active;
    }, null, { timeout: ms, polling: 'raf' });
    return await t.eval(function () { return performance.now(); });
  } catch (e) { return -1; }
}

/** How far the glass can be carried to the right before the screen's edge stops it (px). */
async function lmax(t) {
  return t.eval(function () { return window.Hourglass.room.x1; });
}

/* ---- 2. MOVE ------------------------------------------------------------ */
async function testMove(s, env, opts) {
  opts = opts || {};
  var label = opts.reduced ? 'reduced MOVE' : 'MOVE';
  var t = opts.page || await env.open({ motionStub: CFG.stub, reducedMotion: !!opts.reduced });
  if (!opts.page) { await t.eval(function () { window.Hourglass.start(); }); await sleep(700); }
  var g = await t.glass();
  var L = await lmax(t, opts.reduced);
  await recBody(t);
  var c0 = await t.eval(function () { return { rem: window.Hourglass.timer.rem, now: Date.now() }; });
  await t.touch.down(g.cx, g.cy);
  await t.touch.path(function (u) { return { x: g.cx + 140 * u, y: g.cy }; }, 200);
  await sleep(300);
  await t.touch.up();
  await sleep(1700);
  var r = await t.eval(function () { return { rows: __rec.stop(), upAt: __mon.upAt, rem: window.Hourglass.timer.rem, now: Date.now() }; });
  var rows = r.rows, maxP = 0, flip = false, pRel = 0, maxNeg = 0, lastOut = -1, axBad = 0, axN = 0, maxAx = 0;
  for (var i = 0; i < rows.length; i++) {
    var q = rows[i], p = Math.sqrt(q[R_PX] * q[R_PX] + q[R_PY] * q[R_PY]);
    if (p > maxP) maxP = p;
    if (q[R_FLIP]) flip = true;
    if (q[R_T] <= r.upAt) pRel = q[R_PX];
    else {
      if (-q[R_PX] > maxNeg) maxNeg = -q[R_PX];
      if (p >= 0.5) lastOut = q[R_T];
    }
    if (q[R_AX] > 1000) {                // the glass accelerating right (θ = 0): the sand is pushed left
      axN++;
      if (!(q[R_MAX] < 0)) axBad++;
    }
    if (q[R_AX] > maxAx) maxAx = q[R_AX];
  }
  var over = pRel > 0 ? 100 * maxNeg / pRel : 0;
  var settle = lastOut < 0 ? 0 : lastOut - r.upAt;
  // (until the glass could fall and hit, a rubber band held it within 0.22 × the screen's shorter
  // side, 40 px with Reduce Motion; now it goes where the finger goes until the screen's edge stops it)
  s.check(label + ': it stops at the edge of the screen (max |translate| ≤ the room + 0.5 px)', maxP <= L + 0.5 && maxP > 10,
          'max ' + maxP.toFixed(1) + ' px, room to the right ' + L.toFixed(1) + ' px');
  s.check(label + ': back to |p| < 0.5 px within 1.3 s', lastOut >= 0 ? settle <= 1300 : true, 'settled ' + settle.toFixed(0) + ' ms after release');
  if (opts.reduced) s.check(label + ': no overshoot (≤ 1 px)', maxNeg <= 1, 'overshoot ' + maxNeg.toFixed(2) + ' px');
  else s.check(label + ': overshoot 5–15 %', over >= 5 && over <= 15, over.toFixed(1) + ' % of ' + pRel.toFixed(1) + ' px');
  s.check(label + ': flip.active never true', !flip);
  if (!opts.page && !opts.reduced) {
    var dRem = c0.rem - r.rem, dWall = r.now - c0.now;
    s.check(label + ': the clock ran (T.rem fell by the wall time)', Math.abs(dRem - dWall) <= 60,
            'T.rem −' + dRem.toFixed(0) + ' ms over ' + dWall + ' ms');
    // (the screen's edge now stops the glass after 56 px here, so it has fewer steps to pick up speed in)
    s.check(label + ': sim gets ax < 0 while the glass accelerates right', axN >= 2 && axBad === 0,
            axN + ' steps accelerating right (peak ' + maxAx.toFixed(0) + ' px/s² = ' + (maxAx * 1.631e-5).toFixed(2) + ' g), ' + axBad + ' with ax ≥ 0');
    if (CFG.e2e) {
      var slides = 0;
      rows.forEach(function (q) { if (q[R_T] <= r.upAt + 300 && q[R_SLIDES] > slides) slides = q[R_SLIDES]; });
      s.check(label + ': the sand slid while the glass was dragged (frame.slides > 0)', slides > 0, 'up to ' + slides + ' slides a frame');
    }
  }
  return t;
}

/* ---- 3. TURN -------------------------------------------------------------- */
async function testTurn(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  // a glass that has run a little, then paused: its clock must swap exactly
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(2500);
  await t.eval(function () { window.Hourglass.pause(); });
  await sleep(300);
  var g = await t.glass();
  var f0 = await t.eval(function () { __mon.flips = 0; return true; });
  await recBody(t);
  await arc(t, g, 200 * Math.PI / 180, 1200, { holdMs: 250 });
  var up = await t.eval(function () { return __mon.upAt; });
  var restAt = await waitRest(t, 2500);
  await sleep(100);
  var r = await t.eval(function () {
    var H = window.Hourglass;
    return { rows: __rec.stop(), flips: __mon.flips, rem: H.timer.rem, remAt: H.remAt(H.sim.nTop), state: H.timer.state, angle: H.sim.angle };
  });
  s.check('TURN: a 200° arc gives exactly one swap', r.flips === 1, r.flips + ' swaps');
  // an ordinary turn follows the finger closely: the glass trails where the
  // finger has turned it to by about 2ζ/ω ≈ 65 ms (the catch's brake never
  // applies to it)
  var lags = [], maxErr = 0;
  r.rows.forEach(function (q) {
    if (q[R_MODE] !== 'held-turn') return;
    var e = q[R_GRAB] - q[R_TH];
    if (Math.abs(e) > maxErr) maxErr = Math.abs(e);
    if (Math.abs(q[R_W]) > 1) lags.push(1000 * e / q[R_W]);
  });
  var lag = H.pct(lags, 50);
  s.check('TURN: follows the finger closely (lags it by ≤ 85 ms)', lags.length > 20 && lag > 0 && lag <= 85,
          'median lag ' + (lags.length ? lag.toFixed(0) : '?') + ' ms over ' + lags.length + ' steps; largest gap ' +
          (maxErr * 180 / Math.PI).toFixed(1) + '°');
  s.check('TURN: slow release settles at 0 within 1.5 s', restAt > 0 && restAt - up <= 1500 && r.angle === 0,
          restAt > 0 ? 'settled ' + (restAt - up).toFixed(0) + ' ms after release' : 'never settled');
  s.check('TURN: T.rem === remAt(sim.nTop) after the turn', Math.abs(r.rem - r.remAt) < 1e-6,
          'T.rem ' + r.rem.toFixed(3) + ' vs remAt ' + r.remAt.toFixed(3) + ' (' + r.state + ')');
  var turning = r.rows.some(function (q) { return q[R_STATUS] === 'Turning'; });
  s.check('TURN: showed Turning while turned', turning);

  // a 3° nudge: never a turn, springs back
  await recBody(t);
  var R = 0.2 * g.h, R1 = R + 22, a0 = -Math.PI / 2, a1 = a0 + 3 * Math.PI / 180;
  await t.touch.down(g.cx + R * Math.cos(a0), g.cy + R * Math.sin(a0));
  await sleep(30);
  await t.touch.path(function (u) { var rr = R + 22 * u; return { x: g.cx + rr * Math.cos(a0), y: g.cy + rr * Math.sin(a0) }; }, 60);
  await sleep(40);
  await t.touch.path(function (u) { var a = a0 + (a1 - a0) * u; return { x: g.cx + R1 * Math.cos(a), y: g.cy + R1 * Math.sin(a) }; }, 150);
  await sleep(350);
  await t.touch.up();
  await sleep(900);
  var n = await t.eval(function () { return { rows: __rec.stop(), angle: window.Hourglass.sim.angle, flips: __mon.flips }; });
  var maxTh = 0, flip = false, turn = false;
  n.rows.forEach(function (q) {
    if (Math.abs(q[R_TH]) > maxTh) maxTh = Math.abs(q[R_TH]);
    if (q[R_FLIP]) flip = true;
    if (q[R_STATUS] === 'Turning') turn = true;
  });
  s.check('TURN: a 3° nudge never shows Turning', !turn && !flip && maxTh > 0.02,
          'max ' + (maxTh * 180 / Math.PI).toFixed(1) + '°, flip.active ' + flip);
  s.check('TURN: the nudge springs back to 0', n.angle === 0, 'angle ' + n.angle);
  await H.invariants(s, t, 'TURN');
  await t.close();
}

/* ---- 4. FREE / DETENT --------------------------------------------------- */
async function testFree(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  var cases = [[4, 1, 1], [9, 2, 99]];          // finger rad/s, at least / at most half-turns
  for (var c = 0; c < cases.length; c++) {
    var wf = cases[c][0];
    await t.eval(function () { __mon.flips = 0; });
    var was = await t.eval(function () { return window.Hourglass.timer.state; });
    var g = await t.glass();
    await recBody(t);
    if (CFG.e2e) { await t.eval(function () { window.__topStop = false; }); await recTopBulb(t); }
    var rel = await arc(t, g, wf * 0.26, 260, {});
    var restAt = await waitRest(t, 5000);
    var r = await t.eval(function () {
      var H = window.Hourglass;
      window.__topStop = true;
      return { rows: __rec.stop(), flips: __mon.flips, state: H.timer.state, angle: H.sim.angle, top: window.__topD || [] };
    });
    if (CFG.e2e && wf >= 9) {
      // the sand of the bulb that was on top is flung (and falls) toward its own dome while the glass spins
      var d0 = r.top.length ? r.top[0][1] : 0, dMax = d0;
      r.top.forEach(function (q) { if (q[2] === 'free' || q[2] === 'detent' || q[2] === 'held-turn') { if (q[1] > dMax) dMax = q[1]; } });
      s.check('FREE: (' + wf + ' rad/s) the top bulb\'s sand moves toward its dome by ≥ 15 cells during the spin', dMax - d0 >= 15,
              'mean distance from the neck ' + d0.toFixed(1) + ' → up to ' + dMax.toFixed(1) + ' cells');
    }
    var maxW = 0;
    r.rows.forEach(function (q) { if (Math.abs(q[R_W]) > maxW) maxW = Math.abs(q[R_W]); });
    var odd = r.flips % 2 === 1;
    // turning a full glass over leaves its sand below: the readout runs out, so it is 'done'; back again, as it was
    var expect = odd ? (was === 'idle' ? 'done' : (was === 'done' ? 'running' : was)) : was;
    s.check('FREE: flick at ' + wf + ' rad/s gives ' + (cases[c][2] === 1 ? '1' : '≥ ' + cases[c][1]) + ' half-turn' + (cases[c][2] === 1 ? '' : 's'),
            r.flips >= cases[c][1] && r.flips <= cases[c][2], 'released at ' + rel.w.toFixed(2) + ' rad/s → ' + r.flips + ' half-turns');
    s.check('FREE: (' + wf + ' rad/s) settles on a multiple of π within 4 s', restAt > 0 && restAt - rel.t <= 4000 && r.angle === 0,
            restAt > 0 ? 'settled ' + ((restAt - rel.t) / 1000).toFixed(2) + ' s after release' : 'never settled');
    s.check('FREE: (' + wf + ' rad/s) T.state matches the swap parity', r.state === expect, was + ' → ' + r.state + ' after ' + r.flips + ' swaps');
    s.check('FREE: (' + wf + ' rad/s) |ω| ≤ 16 throughout', maxW <= 16 + 1e-9, 'max ' + maxW.toFixed(2) + ' rad/s');
    // back to a full upright idle glass for the next flick
    await t.eval(function () { window.Hourglass.reset(); });
    await sleep(1400);
  }
  await H.invariants(s, t, 'FREE');
  await t.close();
}

/* ---- 5. CATCH ------------------------------------------------------------ */
async function testCatch(s, env, page) {
  var t = page || await env.open({ motionStub: CFG.stub });
  var g = await t.glass();
  var state0 = await t.eval(function () { return window.Hourglass.timer.state; });
  await arc(t, g, 16 * 0.26, 260, {});
  var fast;
  try {
    await t.page.waitForFunction(function () {
      var b = window.Hourglass.body;
      return b.mode === 'free' && Math.abs(b.w) >= 6;
    }, null, { timeout: 1500, polling: 'raf' });
    fast = true;
  } catch (e) { fast = false; }
  var w0 = await t.eval(function () { return window.Hourglass.body.w; });
  await recBody(t);
  var g2 = await t.glass();
  await t.touch.down(g2.cx, g2.cy);
  await sleep(200);
  // a resting finger is never quite still: a pixel of tremor right by the
  // centre (45° as seen from it) must not turn the glass
  await t.touch.move(g2.cx + 1, g2.cy + 1);
  await sleep(50);
  await t.touch.move(g2.cx, g2.cy);
  await sleep(120);
  await t.touch.up();
  await sleep(300);
  var r = await t.eval(function () { return { rows: __rec.stop(), down: __mon.downAt, up: __mon.upAt, state: window.Hourglass.timer.state }; });
  var first = -1, wTouch = 0, after = 0, back = 0, th60 = null, drift = 0, n60 = 0;
  r.rows.forEach(function (q) {
    var dt = q[R_T] - r.down;
    if (q[R_T] < r.down) { wTouch = q[R_W]; return; }
    if (q[R_T] > r.up) return;                           // only while the finger holds it
    if (first < 0 && Math.abs(q[R_W]) < 0.5) first = dt;
    if (wTouch && q[R_W] * wTouch < 0 && Math.abs(q[R_W]) > back) back = Math.abs(q[R_W]);   // turning back
    if (dt < 60) return;
    n60++;
    if (Math.abs(q[R_W]) > after) after = Math.abs(q[R_W]);
    if (th60 === null) th60 = q[R_TH];
    else if (Math.abs(q[R_TH] - th60) > drift) drift = Math.abs(q[R_TH] - th60);
  });
  s.check('CATCH: spinning at ≥ 6 rad/s when touched', fast && Math.abs(w0) >= 6 && Math.abs(wTouch) >= 3,
          'ω ' + w0.toFixed(2) + ' rad/s a moment before, ' + wTouch.toFixed(2) + ' rad/s as the finger came down');
  s.check('CATCH: |ω| below 0.5 within 120 ms of the touch', first >= 0 && first <= 120, 'first below 0.5 at ' + first.toFixed(0) + ' ms');
  s.check('CATCH: held still, it stays put (|ω| < 0.3 rad/s from 60 ms until the lift)', n60 > 10 && after < 0.3,
          'max |ω| ' + after.toFixed(3) + ' rad/s over ' + n60 + ' steps');
  s.check('CATCH: it never swings back (against its spin ≤ 0.3 rad/s; drift < 0.5° after 60 ms, tremor included)',
          back <= 0.3 && drift < 0.5 * Math.PI / 180,
          'back ' + back.toFixed(3) + ' rad/s, drift ' + (drift * 180 / Math.PI).toFixed(3) + '°');
  s.check('CATCH: no toggle', r.state === state0, state0 + ' → ' + r.state);
  if (!page) { await H.invariants(s, t, 'CATCH'); await t.close(); }
}

/**
 * CATCH on the way home: pulled out by the waist and let go, the glass is
 * caught as it springs back. It stops where the finger met it and stays
 * there (a pixel of tremor moves it by less than that), then goes home when
 * the finger lifts.
 */
async function testCatchMove(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  var g = await t.glass();
  var state0 = await t.eval(function () { return window.Hourglass.timer.state; });
  await t.touch.down(g.cx, g.cy);
  await t.touch.path(function (u) { return { x: g.cx + 140 * u, y: g.cy }; }, 200);
  await sleep(250);
  await recBody(t);
  await t.touch.up();
  await sleep(80);                                           // on its way home, near its fastest
  var g2 = await t.glass();
  await t.touch.down(g2.cx, g2.cy);
  await sleep(200);
  await t.touch.move(g2.cx + 1, g2.cy);                      // tremor
  await sleep(50);
  await t.touch.move(g2.cx, g2.cy);
  await sleep(150);
  await t.touch.up();
  var restAt = await waitRest(t, 2000);
  var r = await t.eval(function () {
    var b = window.Hourglass.body;
    return { rows: __rec.stop(), down: __mon.downAt, up: __mon.upAt, state: window.Hourglass.timer.state, px: b.px };
  });
  var vTouch = 0, pTouch = 0, first = -1, after = 0, p60 = null, drift = 0, n60 = 0, back = 0, mode = '';
  r.rows.forEach(function (q) {
    var dt = q[R_T] - r.down, v = Math.sqrt(q[R_VX] * q[R_VX] + q[R_VY] * q[R_VY]);
    if (q[R_T] < r.down) { vTouch = q[R_VX]; pTouch = q[R_PX]; return; }
    if (q[R_T] > r.up) return;
    mode = q[R_MODE];
    if (first < 0 && v < 5) first = dt;
    if (dt < 200 && vTouch && q[R_VX] * vTouch < 0 && Math.abs(q[R_VX]) > back) back = Math.abs(q[R_VX]);   // before the tremor
    if (dt < 60) return;
    n60++;
    if (v > after && dt < 200) after = v;                    // before the tremor
    if (p60 === null) p60 = q[R_PX];
    else if (Math.abs(q[R_PX] - p60) > drift) drift = Math.abs(q[R_PX] - p60);
  });
  // (the screen's edge now stops the glass 56 px out, where the rubber band let it go to 86: it is
  // let go nearer home and is nearer still when the finger comes down again, so "> 20 px" is "> 10")
  s.check('CATCH (move): caught on its way home', vTouch < -100 && pTouch > 10,
          'at ' + pTouch.toFixed(1) + ' px from home, moving ' + vTouch.toFixed(0) + ' px/s');
  s.check('CATCH (move): stopped within 120 ms, held as a move', first >= 0 && first <= 120 && mode === 'held-move',
          'below 5 px/s at ' + first.toFixed(0) + ' ms, mode ' + mode);
  s.check('CATCH (move): held still, it stays put (< 3 px/s from 60 ms; never back toward where it was caught)',
          n60 > 10 && after < 3 && back < 3, 'max ' + after.toFixed(2) + ' px/s, back ' + back.toFixed(2) + ' px/s');
  s.check('CATCH (move): a pixel of tremor moves it by less than a pixel', drift < 1, 'drift ' + drift.toFixed(2) + ' px after 60 ms');
  s.check('CATCH (move): let go, it springs home', restAt > 0 && r.px === 0, restAt > 0 ? 'home ' + (restAt - r.up).toFixed(0) + ' ms after the lift' : 'not home');
  s.check('CATCH (move): no toggle', r.state === state0, state0 + ' → ' + r.state);
  await H.invariants(s, t, 'CATCH (move)');
  await t.close();
}

/* ---- 6. MEND ------------------------------------------------------------- */
function spyMend(t) {
  return t.eval(function () {
    var R = window.Hourglass.renderer;
    if (!R.__mendSpy) {
      var f = R.setMend;
      R.__mendSpy = { max: 0, log: [] };
      R.setMend = function (p) {
        R.__mendSpy.log.push([performance.now(), +p]);
        if (+p > R.__mendSpy.max) R.__mendSpy.max = +p;
        return f.apply(this, arguments);
      };
    }
    R.__mendSpy.max = 0; R.__mendSpy.log = [];
  });
}
async function freshGlass(t) {
  await t.eval(function () { window.Hourglass.reset(); });
  await sleep(1400);
}
async function testMend(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  await spyMend(t);
  var g = await t.glass();
  // a still press of 1.6 s seals it
  await t.eval(function (seg) { window.Hourglass.debug.forceCrack(seg, 40, 2); }, UPPER_SHOULDER);
  var st0 = await t.eval(function () { return window.Hourglass.timer.state; });
  await t.touch.down(g.cx, g.cy);
  await sleep(1600);
  await t.touch.up();
  await sleep(200);
  var a = await t.eval(function () {
    var H = window.Hourglass;
    return { sealed: H.sim.cracks.length === 1 && H.sim.cracks[0].sealed, max: H.renderer.__mendSpy.max, state: H.timer.state,
             open: H.sim.nOpen };
  });
  s.check('MEND: a still press of 1.6 s seals the crack', a.sealed && a.open === 0, 'sealed ' + a.sealed);
  s.check('MEND: setMend reached 1', a.max === 1, 'max ' + a.max);
  s.check('MEND: the long press did not toggle', a.state === st0, st0 + ' → ' + a.state);
  if (CFG.e2e) {
    // sealed: nothing leaks any more, from either bulb (the timer may run meanwhile)
    var k0 = await t.eval(function () { var S = window.Hourglass.sim; window.Hourglass.start(); return [S.leakedBottom, S.leakedTop, S.lost]; });
    await sleep(2000);
    var k1 = await t.eval(function () { var S = window.Hourglass.sim; window.Hourglass.pause(); return [S.leakedBottom, S.leakedTop, S.lost]; });
    s.check('MEND: once sealed, sim.leakedBottom (and leakedTop) stay constant for 2 s', k0[0] === k1[0] && k0[1] === k1[1] && k0[2] === k1[2],
            JSON.stringify({ before: k0, after: k1 }));
  }

  // released at 0.8 s: not sealed, and the gold recedes to 0 within 0.5 s
  await freshGlass(t);
  await t.eval(function (seg) { window.Hourglass.debug.forceCrack(seg, 40, 2); }, UPPER_SHOULDER);
  await spyMend(t);
  await t.touch.down(g.cx, g.cy);
  await sleep(800);
  await t.touch.up();
  await sleep(700);
  var b = await t.eval(function () {
    var H = window.Hourglass, log = H.renderer.__mendSpy.log, up = __mon.upAt, zeroAt = -1, peak = 0;
    for (var i = 0; i < log.length; i++) {
      if (log[i][0] <= up && log[i][1] > peak) peak = log[i][1];
      if (log[i][0] > up && log[i][1] === 0 && zeroAt < 0) zeroAt = log[i][0] - up;
    }
    return { sealed: H.sim.cracks[0].sealed, zeroAt: zeroAt, peak: peak };
  });
  s.check('MEND: released at 0.8 s it is not sealed', !b.sealed && b.peak > 0.3, 'gold had run ' + (b.peak * 100).toFixed(0) + ' %');
  s.check('MEND: the gold is back to 0 within 0.5 s', b.zeroAt >= 0 && b.zeroAt <= 500, 'zero at ' + b.zeroAt.toFixed(0) + ' ms after lifting');

  // a 500 ms press on a cracked glass does not toggle; on an intact one it does
  var c0 = await t.eval(function () { return window.Hourglass.timer.state; });
  await t.touch.tap(g.cx, g.cy, 500);
  await sleep(300);
  var c1 = await t.eval(function () { return window.Hourglass.timer.state; });
  s.check('MEND: a 500 ms press on a cracked glass does not toggle', c1 === c0, c0 + ' → ' + c1);
  await freshGlass(t);
  var d0 = await t.eval(function () { return window.Hourglass.timer.state; });
  await t.touch.tap(g.cx, g.cy, 500);
  await sleep(300);
  var d1 = await t.eval(function () { return window.Hourglass.timer.state; });
  s.check('MEND: a 500 ms press on an intact glass toggles', d0 !== d1 && (d1 === 'running' || d1 === 'paused'), d0 + ' → ' + d1);
  await H.invariants(s, t, 'MEND');
  await t.close();
}

/* ---- 7. ZEN --------------------------------------------------------------- */
async function zenOn(t) {
  return t.eval(function () { return document.getElementById('app').classList.contains('zen'); });
}
async function testZen(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  var g0 = await t.glass(), i;
  var state = function () { return t.eval(function () { return window.Hourglass.timer.state; }); };
  await sleep(500);                                         // apart from any earlier tap: not a knock
  await t.touch.tap(g0.cx, g0.cy, 60);                      // start, by a tap on the glass
  await sleep(6000);
  s.check('ZEN: six seconds of running bring no Zen by themselves', !(await zenOn(t)) && (await state()) === 'running');
  await t.touch.pinch(g0.cx, g0.cy, 80, 108, 200);
  await sleep(150);
  s.check('ZEN: two fingers that barely move bring none', !(await zenOn(t)));
  // a glass that is being carried is not let go for a second finger, wherever that one goes
  await t.touch.down(g0.cx, g0.cy);
  await t.touch.path(function (u) { return { x: g0.cx + 60 * u, y: g0.cy }; }, 150);
  await t.touch.fingers('touchStart', [[g0.cx + 60, g0.cy], [g0.cx + 60, g0.cy + 70]]);
  for (i = 1; i <= 12; i++) { await t.touch.fingers('touchMove', [[g0.cx + 60, g0.cy], [g0.cx + 60, g0.cy + 70 + 15 * i]]); await sleep(10); }
  var carried = await t.eval(function () { return window.Hourglass.body.px; });
  await t.touch.up();
  s.check('ZEN: a second finger spreading while the glass is carried brings none', !(await zenOn(t)) && Math.abs(carried) > 5, 'carried ' + carried.toFixed(1) + ' cells');
  await waitRest(t, 5000);
  await sleep(700);
  g0 = await t.glass();
  var st0 = await state();
  await t.touch.pinch(g0.cx, g0.cy, 80, 220, 260);
  await sleep(150);
  s.check('ZEN: two fingers spreading bring it', await zenOn(t));
  s.check('ZEN: ... and are no tap: the glass runs on', st0 === 'running' && (await state()) === 'running', st0 + ' → ' + (await state()));
  await sleep(1800);                                        // the glass grows to its Zen size
  var deep = await t.eval(function () { return document.getElementById('app').classList.contains('zen-deep'); });
  s.check('ZEN: settled, the dim controls take no taps', deep);
  var g = await t.glass();
  var st = await state();
  // MOVE
  await t.touch.down(g.cx, g.cy);
  await t.touch.path(function (u) { return { x: g.cx + 100 * u, y: g.cy }; }, 200);
  await sleep(200);
  await t.touch.up();
  await sleep(1400);
  s.check('ZEN: a MOVE keeps the class', await zenOn(t));
  // a flick, and a catch
  await testCatch(s, env, t);
  await waitRest(t, 5000);
  s.check('ZEN: a flick and a catch keep the class', await zenOn(t));
  // a mend hold
  await t.eval(function (seg) { window.Hourglass.debug.forceCrack(seg, 40, 2); }, UPPER_SHOULDER);
  g = await t.glass();
  await t.touch.down(g.cx, g.cy);
  await sleep(1600);
  await t.touch.up();
  await sleep(300);
  var sealed = await t.eval(function () { return window.Hourglass.sim.cracks[0].sealed; });
  s.check('ZEN: a mend hold keeps the class (and mends)', (await zenOn(t)) && sealed, 'sealed ' + sealed);
  var st1 = await state();
  // a tap is a tap, here as at home: the glass pauses, and Zen stays
  await sleep(700);
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(400);
  var st2 = await state();
  s.check('ZEN: a tap keeps the class', await zenOn(t));
  s.check('ZEN: ... and pauses the glass, as it does at home', st === 'running' && st1 === 'running' && st2 === 'paused', st + ' → ' + st1 + ' → ' + st2);
  await t.touch.tap(4, 4, 60);
  await sleep(400);
  s.check('ZEN: a tap beside the glass does nothing at all', (await zenOn(t)) && (await state()) === 'paused');
  // carried, with a second finger closing in: still not let go, still Zen
  await sleep(700);
  g = await t.glass();
  await t.touch.down(g.cx, g.cy);
  await t.touch.path(function (u) { return { x: g.cx + 40 * u, y: g.cy }; }, 150);
  await t.touch.fingers('touchStart', [[g.cx + 40, g.cy], [g.cx + 40, g.cy + 260]]);
  for (i = 1; i <= 12; i++) { await t.touch.fingers('touchMove', [[g.cx + 40, g.cy], [g.cx + 40, g.cy + 260 - 15 * i]]); await sleep(10); }
  await t.touch.up();
  s.check('ZEN: a second finger closing in while the glass is carried keeps the class', await zenOn(t));
  await waitRest(t, 5000);
  await sleep(500);
  g = await t.glass();
  await t.touch.pinch(g.cx, g.cy, 230, 90, 260);
  await sleep(150);
  s.check('ZEN: two fingers pinching together leave it', !(await zenOn(t)) && (await state()) === 'paused', await state());
  // there and back within one pinch
  await t.touch.pinch(g.cx, g.cy, 90, 230, 220, true);
  var mid = await zenOn(t);
  for (i = 1; i <= 14; i++) { await t.touch.fingers('touchMove', [[g.cx - (230 - 10 * i) / 2, g.cy], [g.cx + (230 - 10 * i) / 2, g.cy]]); await sleep(10); }
  await t.touch.up();
  s.check('ZEN: spread and turned back within one pinch: there and back', mid && !(await zenOn(t)));
  // the moon button, and Escape
  await sleep(700);
  await t.page.tap('#btn-zen');
  await sleep(300);
  var hint = await t.eval(function () { var q = document.getElementById('toast'); return q.classList.contains('show') ? q.textContent : ''; });
  s.check('ZEN: the moon button brings it, and says the way back', (await zenOn(t)) && /Pinch in/.test(hint), JSON.stringify(hint));
  await t.page.keyboard.press('Escape');
  await sleep(150);
  s.check('ZEN: Escape leaves it', !(await zenOn(t)));
  // not while a sheet is open
  await tune.open(t);
  await t.touch.pinch(g.cx, 300, 80, 240, 220);
  await sleep(150);
  s.check('ZEN: a pinch while Tune is open does nothing', !(await zenOn(t)));
  await t.page.keyboard.press('Escape');
  await sleep(700);
  await H.invariants(s, t, 'ZEN');
  await t.close();
}

/* ---- 12. REDUCE MOTION -------------------------------------------------- */
async function testReduced(s, env) {
  var t = await env.open({ motionStub: CFG.stub, reducedMotion: true });
  var red = await t.eval(function () { return { sim: window.Hourglass.sim.reduced, app: window.Hourglass.reduceMotion }; });
  s.check('REDUCED: sim.reduced is true', red.sim === true && red.app === true, JSON.stringify(red));
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(500);
  await testMove(s, env, { reduced: true, page: t });
  await t.eval(function () { __mon.flips = 0; });
  var g = await t.glass();
  var rel = await arc(t, g, 9 * 0.26, 260, {});
  await waitRest(t, 4000);
  var n = await t.eval(function () { return __mon.flips; });
  s.check('REDUCED: a flick gives ≤ 1 half-turn', n <= 1, 'released at ' + rel.w.toFixed(2) + ' rad/s → ' + n);
  if (CFG.e2e) {
    // shaken very hard with Real motion on: gentler sand, and a glass that cannot crack
    await tune.tap(t, '#opt-tilt');                // (Tune opened, the switch's tab shown: lib/tune.js)
    await sleep(300);
    await tune.close(t);
    await sleep(100);
    await t.eval(function () {
      window.__drive({ profile: 'calm', conv: 'ios' });
      window.__rm = { air: 0, spray: 0, hops: 0, steps: 0, d0: window.Hourglass.sim.dMax };
      __rec.start(function (H) {
        var f = H.sim.frame, m = window.__rm;
        m.steps++;
        if (H.sim.airborne()) m.air++;
        if (f.sprayed) m.spray++;
        if (f.hops) m.hops++;
        return 0;
      });
    });
    await sleep(1500);
    await t.eval(function () { window.__drive({ profile: 'veryVigSlow', conv: 'ios', durS: 15 }); });
    await sleep(15500);
    var rm = await t.eval(function () {
      __rec.stop();
      window.__driveStop();
      var H = window.Hourglass;
      return { m: window.__rm, cracks: H.sim.cracks.length, dMax: H.sim.dMax, on: H.grav.on };
    });
    // (The finger's own blows now count with Reduce Motion too, and this page was flicked a
    // moment ago: what is asked here is that the phone's shaking adds nothing to the glass.)
    s.check('REDUCED: veryVigSlow 15 s never cracks it and adds no damage', rm.on && rm.cracks === 0 && rm.dMax <= rm.m.d0,
            'cracks ' + rm.cracks + ', dMax ' + rm.m.d0 + ' before the shake, ' + rm.dMax + ' after');
    s.check('REDUCED: ... the bed never flies, nothing sprays or hops', rm.m.air === 0 && rm.m.spray === 0 && rm.m.hops === 0 && rm.m.steps > 1000,
            JSON.stringify(rm.m));
  }
  await H.invariants(s, t, 'REDUCED');
  await t.close();
}

/** A plain tap on the glass still starts and pauses it. */
async function testTap(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  var g = await t.glass();
  await t.touch.tap(g.cx, g.cy, 80);
  await sleep(600);                                         // taps closer than 0.45 s are knocks
  var a = await t.eval(function () { return window.Hourglass.timer.state; });
  await t.touch.tap(g.cx, g.cy, 80);
  await sleep(600);
  var b = await t.eval(function () { return window.Hourglass.timer.state; });
  s.check('TAP: a tap starts the glass, another pauses it', a === 'running' && b === 'paused', 'idle → ' + a + ' → ' + b);
  await H.invariants(s, t, 'TAP');
  await t.close();
}

async function testMoveAlone(s, env) {
  var t = await testMove(s, env, {});
  await H.invariants(s, t, 'MOVE');
  await t.close();
}

async function main() {
  var s = new H.Suite('app-gestures');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!only || only === 'move') await testMoveAlone(s, env);
    if (!only || only === 'turn') await testTurn(s, env);
    if (!only || only === 'free') await testFree(s, env);
    if (!only || only === 'catch') { await testCatch(s, env); await testCatchMove(s, env); }
    if (!only || only === 'mend') await testMend(s, env);
    if (!only || only === 'zen') await testZen(s, env);
    if (!only || only === 'reduced') await testReduced(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
}

module.exports = {
  CFG: CFG, testMove: testMoveAlone, testTurn: testTurn, testFree: testFree, testCatch: testCatch,
  testCatchMove: testCatchMove, testMend: testMend, testZen: testZen, testReduced: testReduced, testTap: testTap
};
if (require.main === module) main();
