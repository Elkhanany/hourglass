/*
 * Controller acceptance 8 (MAPPING) and 10 (TILTSWAP), with the motion stub.
 *
 *  8. The phone's felt acceleration, page frame, reaches the sim in the
 *     vessel frame: x = +1 g with the glass held at θ = π/2 gives
 *     (ax, ay) = (0, −G) within 2 % (and (+G, 0) at θ = 0).
 * 10. Turned over and held 300 ms, the glass swaps once; a 120 ms glitch
 *     never swaps it.
 *
 * SLOSH: the classic sand heard when the glass is moved before it is started.
 *     Idle, at rest: nothing is given to the sound for the bed. Leaned past
 *     the slope (the heading to 43 degrees): the sand slides at thousands of
 *     slides a second, far under the 24,000 the rush begins at under a
 *     stream, and is heard all the same, softly, in the ear of the side the
 *     sand runs to (leaned one way and then the other, against where the
 *     sand's centre went); shaken
 *     (1.5 g at 5 Hz): the rush and the shimmer; no stream and no ambience
 *     in either. The control: the same lean while the glass runs leaves the
 *     rush at nothing, as it always did.
 *
 * SIDES: every sound that has a side is heard where the listener sees its sand, the phone held as
 *     it is held (headphones keep the listener's left and right; the picture turns with the phone).
 *     One frame is given sand on the glass's own right (x = +0.8 across the glass: a thump in each
 *     bulb, a slam, a leak, a single grain's landing, and the bulbs' field to the right for the
 *     hiss), and the glass's damage there (a creak, a crack, its growth, a chip); in four cases: the glass upright or turned half round
 *     on the screen by a finger (sim.angle = pi for that frame), with the phone upright or held upside
 *     down with the glass swapped (the motion stub turned over: grav.base = pi). The glass's right is
 *     the listener's right when the glass stands upright before them (the phone upright, or upside
 *     down with the glass swapped and drawn half a turn round on the screen), and the listener's left
 *     when a finger has turned it half round. Controls (by hand, on a copy of the tree): the glass's
 *     sounds not turned (app.js heardSide() returning 1) fail the finger's cases; the hiss not turned
 *     by the phone's roll fails the cases with the phone upside down.
 *
 * START: the phone's motion never starts a glass (app.js stateAfterSwap). Real motion on (the motion
 *     stub turned over and back: its heading to pi, held, and to 0 again), the classic sand.
 *     WAITING: after Reset, the phone turned over and back three times in a row. Upright again the
 *     glass is as after Reset each time: idle, its clock at the whole time, the status line and the
 *     Start button, nothing saved. In between, its sand below, it waits too (idle, 00:00.0, the same
 *     words and button), and nothing of a glass that ran out happens: no bowl, no ending buzz (the
 *     swap's own tick only), no wake lock asked for, no session saved. No grain passes the neck in
 *     any step of it, nor when the phone is laid on its side or shaken (1.5 g at 5 Hz) either way
 *     up. In between, the Flip button turns the glass over and it still waits; Start there turns it
 *     over on the screen and runs it; and a tap starts a waiting glass (grains pass: what the
 *     counts above would have seen).
 *     FINISHED: a 10 s glass run to its end (one bowl), the phone turned over: its sand is above
 *     and it waits as after Reset, with the time it would run and no session; turned back and over
 *     again, the same. A tap runs it, to its end. Turned over by the Flip button, or by a finger,
 *     a finished glass waits the same way (1.20.2: no turn starts a glass); Start runs it.
 *     SEQUENCE: a work and rest sequence run to its end, the phone turned over: it waits at its
 *     first glass, the work time on the clock; a tap begins Work.
 *     RUNNING, in TILTSWAP: turned over by the phone a running glass runs on, its clock swapped.
 *     PAUSED: a paused glass stays paused through two turns, its time swapped and back; so does one
 *     paused before a grain had fallen (all its sand above).
 *     Controls. On the tree before this rule (git archive e375591, --root, --only start) the
 *     WAITING, FINISHED and SEQUENCE checks and the last PAUSED one fail: the glass reads "Time" at
 *     the first turn and runs at the second. By hand, on a copy of the tree: the rule applied to
 *     every turn (stateAfterSwap without `byPhone &&`) fails the Flip button's and the finger's
 *     checks, and Start in between; applied to a running glass too (without `&& was !==
 *     'running'`) it fails RUNNING; a paused glass sent to wait fails both PAUSED checks;
 *     seqSwapped without its `|| next === 'idle'` fails SEQUENCE.
 *
 *   node tools/test/app-motion.test.js [--root <dir>] [--port <n>] [--only mapping|tiltswap|slosh|sides|start]
 */
'use strict';
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

async function realMotionOn(t) {
  await tune.tap(t, '#opt-tilt');                  // (Tune opened, the switch's tab shown: lib/tune.js)
  await sleep(300);
  await tune.close(t);
  await sleep(100);
  return t.eval(function () { return window.Hourglass.grav.on; });
}

/** Mean of the field the sim was given over the next few steps. */
function fieldNow(t) {
  return t.eval(function () {
    return new Promise(function (resolve) {
      var sx = 0, sy = 0, n = 0;
      __rec.start(function (H) { sx += H.sim.mAx; sy += H.sim.mAy; n++; return 0; });
      setTimeout(function () {
        __rec.stop();
        var H = window.Hourglass;
        resolve({ ax: sx / n, ay: sy / n, n: n, G: H.sim.G, angle: H.sim.angle, base: H.grav.base, mode: H.body.mode });
      }, 250);
    });
  });
}

async function testMapping(s, env) {
  var t = await env.open({ motionStub: true });
  var on = await realMotionOn(t);
  s.check('MAPPING: Real motion is on (stub granted)', on);
  await t.eval(function () { window.__motion.x = 1; window.__motion.y = 0; window.__motion.z = 0; });
  await sleep(300);
  var f0 = await fieldNow(t);
  var G = f0.G;
  s.check('MAPPING: x = +1 g at θ = 0 gives (+G, 0)', Math.abs(f0.ax - G) <= 0.02 * G && Math.abs(f0.ay) <= 0.02 * G,
          '(' + f0.ax.toFixed(1) + ', ' + f0.ay.toFixed(1) + ') over ' + f0.n + ' steps, G = ' + G);
  // hold the glass at a quarter turn: take the upper bulb and bring it round to the right
  var g = await t.glass();
  var R = 0.2 * g.h, R1 = R + 22, a0 = -Math.PI / 2;
  await t.touch.down(g.cx + R * Math.cos(a0), g.cy + R * Math.sin(a0));
  await sleep(30);
  await t.touch.move(g.cx + R1 * Math.cos(a0), g.cy + R1 * Math.sin(a0));
  await sleep(50);
  await t.touch.path(function (u) { var a = a0 + Math.PI / 2 * u; return { x: g.cx + R1 * Math.cos(a), y: g.cy + R1 * Math.sin(a) }; }, 500);
  await sleep(700);
  var f1 = await fieldNow(t);
  await t.touch.up();
  s.check('MAPPING: held at θ = π/2 (' + (f1.angle * 180 / Math.PI).toFixed(2) + '°, ' + f1.mode + '), x = +1 g gives (0, −G) within 2 %',
          Math.abs(f1.ax) <= 0.02 * G && Math.abs(f1.ay + G) <= 0.02 * G,
          '(' + f1.ax.toFixed(1) + ', ' + f1.ay.toFixed(1) + ')');
  await sleep(1500);
  await t.eval(function () { window.__motion.x = 0; });
  await H.invariants(s, t, 'MAPPING');
  await t.close();
}

async function testTiltSwap(s, env) {
  var t = await env.open({ motionStub: true });
  var on = await realMotionOn(t);
  s.check('TILTSWAP: Real motion is on', on);
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(4000);                               // (turned over, the time that has run is the time left: enough of it for the checks below)
  // a 120 ms glitch: heading π, then back
  await t.eval(function () {
    __mon.flips = 0;
    window.__motion.heading = Math.PI;
    setTimeout(function () { window.__motion.heading = 0; }, 120);
  });
  await sleep(1200);
  var a = await t.eval(function () { return { flips: __mon.flips, base: window.Hourglass.grav.base, state: window.Hourglass.timer.state }; });
  s.check('TILTSWAP: heading π for 120 ms, released: no swap', a.flips === 0, a.flips + ' swaps');
  // held over for 300 ms (and then kept so): one swap
  var r0 = await t.eval(function () {
    var Hg = window.Hourglass;
    __mon.flips = 0;
    window.__swapAt = -1;
    window.__motion.heading = Math.PI;
    window.__overAt = performance.now();
    // the time left, and what the sand that has fallen is worth: the time left once it is above (app.js swapEnds, tiltSwap)
    return { rem: Hg.timer.rem, below: Hg.remAt(Hg.sim.total - Hg.sim.nTop) };
  });
  await sleep(300);
  var b0 = await t.eval(function () { return __mon.flips; });
  await sleep(1200);
  var b = await t.eval(function () { var T = window.Hourglass.timer; return { flips: __mon.flips, base: window.Hourglass.grav.base, state: T.state, rem: T.rem, ms: T.durationMs }; });
  s.check('TILTSWAP: held over for 300 ms: exactly one swap', b.flips === 1, b.flips + ' swaps (' + b0 + ' by 300 ms), base ' + b.base.toFixed(3));
  s.check('TILTSWAP: ... and the clock carries on', b.state === 'running', b.state);
  // RUNNING (see START): the time of the sand that had fallen is the time now left, less what has run since the swap
  await sleep(400);
  var b2 = await t.eval(function () { var T = window.Hourglass.timer; return { state: T.state, rem: T.rem }; });
  s.check('TILTSWAP (RUNNING): turned over by the phone the running glass runs on, its clock swapped',
          b.state === 'running' && b.rem > 0 && b.rem <= r0.below + 300 && b.rem < r0.rem - 200000 && b2.state === 'running' && b2.rem < b.rem,
          'the time left ' + (r0.rem / 1000).toFixed(2) + ' s of ' + b.ms / 1000 + ' before the turn, the sand below worth ' + (r0.below / 1000).toFixed(2) + ' s; ' +
          (b.rem / 1000).toFixed(2) + ' s left after it, ' + (b2.rem / 1000).toFixed(2) + ' s 0.4 s later (' + b2.state + ')');
  await t.eval(function () { window.__motion.heading = 0; });
  await H.invariants(s, t, 'TILTSWAP');
  await t.close();
}

/** From now on: the bed as audio.update is given it, and the levels the sound engine asks for (window.__sl). */
function sloshWatch(t) {
  return t.eval(function () {
    var A = window.Hourglass.audio;
    if (!A.__sloshHook) {
      A.__sloshHook = true;
      var up = A.update;
      A.update = function (st) {
        var W = window.__sl;
        W.updates++;
        if (st.sim) W.active++;
        if (st.slides > W.slides) W.slides = st.slides;
        if (st.agit > W.agit) W.agit = st.agit;
        if (st.flow > W.flow) W.flow = st.flow;
        if (st.ambient) W.ambient++;
        var r = up.apply(this, arguments);
        if (this.ready && this.ctx.state === 'running') {
          var rush = this._last.rush || 0;
          W.live++;
          if (rush > W.rush) { W.rush = rush; W.pan = this._last.rpan || 0; W.panAsked = st.rushPan; }
          W.shimmer = Math.max(W.shimmer, (this._last.cS || 0) + (this._last.cG || 0));
          W.stream = Math.max(W.stream, (this._last.hS || 0) + (this._last.hG || 0));
        }
        return r;
      };
    }
    window.__sl = { updates: 0, active: 0, live: 0, slides: 0, agit: 0, flow: 0, ambient: 0, rush: 0, pan: 0, panAsked: 0, shimmer: 0, stream: 0 };
  });
}
function sloshRead(t) {
  return t.eval(function () {
    var o = {}, W = window.__sl; for (var k in W) o[k] = W[k]; o.state = window.Hourglass.timer.state;
    // where the upper bulb's sand lies across the glass: its grains' mean place from the axis, cells (+: to the right)
    var sim = window.Hourglass.sim, g = sim.geo, n = 0, sx = 0;
    for (var y = 0; y < g.cy; y++) for (var x = 0; x < sim.W; x++) if (sim.cell[y * sim.W + x] > 0) { n++; sx += x + 0.5 - g.cx; }
    o.sandX = n ? sx / n : 0;
    return o;
  });
}
function sloshShow(w) {
  return JSON.stringify({ state: w.state, updates: w.updates, active: w.active, slides: Math.round(w.slides), agit: +w.agit.toFixed(2), rush: +w.rush.toFixed(3),
    pan: +w.pan.toFixed(2), shimmer: +w.shimmer.toFixed(3), flow: +w.flow.toFixed(1), ambient: w.ambient, stream: +w.stream.toFixed(4) });
}

async function testSlosh(s, env) {
  var t = await env.open({ motionStub: true, storage: { 'hourglass.settings.v1': { tilt: true, durationMs: 300000 } } });
  try {
    await sleep(800);
    await t.page.tap('#btn-mute');       // one touch for the sound, twice: the glass stays idle
    await sleep(250);
    await t.page.tap('#btn-mute');
    await t.page.waitForFunction(function () { var a = window.Hourglass.audio; return a.ready && a.ctx.state === 'running' && !a.muted; }, null, { timeout: 5000 });
    var on = await t.eval(function () { return { grav: window.Hourglass.grav.on, state: window.Hourglass.timer.state, cpu: window.Hourglass.sim instanceof window.HourglassPhysics.Sim }; });
    s.check('SLOSH: the classic sand, Real motion on (the motion stub), a 5 minute glass idle, the sound unlocked', on.grav && on.state === 'idle' && on.cpu, JSON.stringify(on));
    await sleep(700);
    await sloshWatch(t);
    await sleep(1200);
    var rest = await sloshRead(t);
    s.check('SLOSH: at rest before the start nothing is given to the sound for the bed, and nothing sounds',
            rest.updates >= 10 && rest.active === 0 && rest.slides === 0 && rest.agit === 0 && rest.rush === 0 && rest.shimmer === 0 && rest.stream === 0 && rest.ambient === 0, sloshShow(rest));
    // leaned past the slope: the heading to 43 degrees, held 2.5 s
    await sloshWatch(t);
    await t.eval(function () { window.__motion.heading = 0.75; });
    await sleep(2500);
    var lean = await sloshRead(t);
    await t.eval(function () { window.__motion.heading = 0; });
    s.check('SLOSH: leaned past the slope before the start, the sand slides (thousands of slides a second, under the 24,000 of a running glass\'s rush) and is heard: the rush, softly',
            lean.state === 'idle' && lean.slides > 3000 && lean.slides < 24000 && lean.rush > 0.04 && lean.rush <= 0.15, sloshShow(lean));
    await sleep(3500);                   // the sand back at rest, upright
    // ... and leaned the other way: the sand runs back across the glass, and the rush goes with it
    await sloshWatch(t);
    await t.eval(function () { window.__motion.heading = -0.75; });
    await sleep(2500);
    var leanL = await sloshRead(t);
    await t.eval(function () { window.__motion.heading = 0; });
    s.check('SLOSH: ... in the ear of the side the sand runs to: leaned one way the sand lies to the right and the rush was in the right ear, leaned the other way it runs to the left and the rush is in the left; no stream and no ambience',
            lean.sandX - rest.sandX > 1 && lean.panAsked > 0.2 && lean.pan > 0.2 && leanL.sandX - lean.sandX < -1 && leanL.panAsked < -0.2 && leanL.pan < -0.2 && leanL.rush > 0.04 &&
            lean.flow === 0 && lean.stream === 0 && lean.ambient === 0 && leanL.stream === 0 && leanL.ambient === 0,
            'leaned to 0.75 rad: the sand\'s centre from ' + rest.sandX.toFixed(1) + ' to ' + lean.sandX.toFixed(1) + ' cells, the rush asked at ' + lean.panAsked.toFixed(2) + ' and panned ' + lean.pan.toFixed(2) +
            '; to -0.75: to ' + leanL.sandX.toFixed(1) + ' cells, asked ' + leanL.panAsked.toFixed(2) + ', panned ' + leanL.pan.toFixed(2) + ', the rush ' + leanL.rush.toFixed(3));
    await sleep(3500);                   // at rest again, upright
    // shaken: 1.5 g at 5 Hz, side to side
    await sloshWatch(t);
    await t.eval(function () { window.__drive({ whole: true, fn: function (tt, f) { f.x = 1.5 * Math.sin(2 * Math.PI * 5 * tt); } }); });
    await sleep(2500);
    var shake = await sloshRead(t);
    await t.eval(function () { window.__driveStop(); });
    s.check('SLOSH: shaken before the start (1.5 g at 5 Hz): the rush and the shimmer, still no stream and no ambience',
            shake.state === 'idle' && shake.slides > 24000 && shake.agit > 0.5 && shake.rush > 0.1 && shake.shimmer > 0.1 && shake.flow === 0 && shake.stream === 0 && shake.ambient === 0, sloshShow(shake));
    await sleep(3000);
    // the control: the same lean while the glass runs
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(2500);
    await sloshWatch(t);
    await t.eval(function () { window.__motion.heading = 0.75; });
    await sleep(2500);
    var run = await sloshRead(t);
    await t.eval(function () { window.__motion.heading = 0; });
    s.check('SLOSH (control): the same lean while the glass runs: the slides come, under 24,000, and the rush stays at nothing as it always did (the stream and the ambience on)',
            run.state === 'running' && run.slides > 3000 && run.slides < 24000 && run.rush === 0 && run.flow > 5 && run.ambient === run.updates, sloshShow(run));
    await sleep(1500);
    await H.invariants(s, t, 'SLOSH');
  } finally { await t.close(); }
}

/** One frame of sand on the glass's own right, with the glass turned by `angle` on top of how it is held; what the sound is given. */
function sidesFrame(t, angle) {
  return t.eval(function (angle) {
    var H = window.Hourglass;
    if (!H.__sidesHook) {
      H.__sidesHook = true;
      var R = H.renderer, A = H.audio, sync = R.syncDamage, up = A.update;
      // (syncDamage is the last call before the frame's sound: the frame is written there)
      R.syncDamage = function () {
        var J = window.__inj;
        if (J && !J.armed) {
          var sim = H.sim, f = sim.frame, G = sim.G;
          J.armed = true; J.was = [sim.angle, H.grav.base, sim.tilt];
          sim.angle = J.angle;
          f.thump[0] = 0.2; f.thump[1] = 0.8; f.thump[2] = 0.2; f.thump[3] = 0.8;
          f.slam[0] = 0.2; f.slam[1] = 0.8; f.leakX = 0.8;
          sim.bf[0] = sim.bf[2] = 0.8 * G; sim.bf[1] = sim.bf[3] = 0.6 * G;
          sim.nev = 1; sim.evX[0] = 0.8; sim.evV[0] = 0.5; sim.evK[0] = 1;
          J.base = H.grav.base; J.tilt = sim.tilt;
        }
        return sync.apply(this, arguments);
      };
      A.update = function (st) {
        var J = window.__inj;
        if (J && J.armed && !J.got) {
          J.got = { rush: st.rushPan, th0: st.thump ? st.thump[1] : NaN, th1: st.thump ? st.thump[3] : NaN, slam: st.slam ? st.slam[1] : NaN,
            leak: st.leakPan, ev: st.sim && st.sim.nev === 1 ? st.sim.evX[0] : NaN };
          H.sim.angle = J.was[0];
        }
        return up.apply(this, arguments);
      };
      // (the glass's damage, heard: creak(level, pan), crack(pan), crackGrow(pan), chip(pan))
      ['creak', 'crack', 'crackGrow', 'chip'].forEach(function (m) {
        var was = A[m];
        A[m] = function () { if (window.__dmgPan) window.__dmgPan[m] = arguments[m === 'creak' ? 1 : 0]; return was.apply(this, arguments); };
      });
    }
    window.__inj = { angle: angle, armed: false };
    return new Promise(function (resolve) {
      var k = 0;
      (function wait() {
        var J = window.__inj;
        if (J.got || ++k > 120) {
          // and the glass's damage on its right (a creak, a crack, its growth, a chip), heard at once
          // as a forced crack is (debug.forceCrack of no wall: no crack, the frame's events heard),
          // the glass turned the same way for it
          var sim = H.sim, D = window.HourglassPhysics.Sim.DMG, was = sim.angle;
          window.__dmgPan = {}; sim.angle = angle;
          [D.WARN, D.CRACK, D.GROW, D.BREACH].forEach(function (ty) { sim._pushDmg(ty, -1, 1, 0.8); });
          H.debug.forceCrack(-1);
          sim.angle = was;
          resolve({ got: J.got || null, base: J.base, tilt: J.tilt, dmg: window.__dmgPan });
          window.__dmgPan = null;
          return;
        }
        requestAnimationFrame(wait);
      })();
    });
  }, angle);
}

async function testSides(s, env) {
  var t = await env.open({ motionStub: true });
  try {
    var on = await realMotionOn(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    s.check('SIDES: Real motion is on (the motion stub), the glass running', on);
    var cases = [['the glass upright, the phone upright', 0, false], ['the glass turned half round by a finger, the phone upright', Math.PI, false],
                 ['the glass upright before the listener, the phone upside down with the glass swapped', 0, true],
                 ['the glass turned half round by a finger, the phone upside down with the glass swapped', Math.PI, true]];
    for (var c = 0; c < cases.length; c++) {
      if (cases[c][2] && !(await t.eval(function () { return window.Hourglass.grav.base; }))) {
        await t.eval(function () { window.__motion.heading = Math.PI; });
        await sleep(1800);
      }
      var r = await sidesFrame(t, cases[c][1]);
      var want = Math.cos(cases[c][1]) > 0 ? 1 : -1, g = r.got || {};
      var held = cases[c][2] ? Math.abs(r.base - Math.PI) < 1e-6 && Math.abs(Math.cos(r.tilt) - 1) < 0.02 : r.base === 0 && Math.abs(Math.cos(r.tilt) - 1) < 0.02;
      var near = function (v, x) { return Math.abs(v - x) < 0.05; };
      var where = want > 0 ? 'right' : 'left', text = function (v) { return v === v && v !== null && v !== undefined ? v.toFixed(2) : String(v); };
      s.check('SIDES: ' + cases[c][0] + ': held so (grav.base ' + text(r.base) + ', tilt ' + text(r.tilt) + ') and the frame heard', held && !!r.got, JSON.stringify(r));
      s.check('SIDES: ' + cases[c][0] + ': the hiss of sand running to the glass\'s right is in the ' + where + ' ear', near(g.rush, 0.48 * want), 'rushPan ' + text(g.rush));
      s.check('SIDES: ' + cases[c][0] + ': a thump on the glass\'s right, in either bulb, is in the ' + where + ' ear', near(g.th0, 0.8 * want) && near(g.th1, 0.8 * want), 'thump pans ' + text(g.th0) + ', ' + text(g.th1));
      s.check('SIDES: ' + cases[c][0] + ': a slam there is in the ' + where + ' ear', near(g.slam, 0.8 * want), 'slam pan ' + text(g.slam));
      s.check('SIDES: ' + cases[c][0] + ': a leak there is in the ' + where + ' ear', near(g.leak, 0.8 * want), 'leakPan ' + text(g.leak));
      s.check('SIDES: ' + cases[c][0] + ': a grain landing there is in the ' + where + ' ear', near(g.ev, 0.8 * want), 'evX ' + text(g.ev));
      var d = r.dmg || {};
      s.check('SIDES: ' + cases[c][0] + ': the glass creaking, cracking, its crack growing and a chip breaking out there are in the ' + where + ' ear',
              near(d.creak, 0.8 * want) && near(d.crack, 0.8 * want) && near(d.crackGrow, 0.8 * want) && near(d.chip, 0.8 * want), 'creak ' + text(d.creak) + ', crack ' + text(d.crack) + ', grow ' + text(d.crackGrow) + ', chip ' + text(d.chip));
    }
    await t.eval(function () { window.__motion.heading = 0; });
  } finally { await t.close(); }
}

/* ---- START: the phone's motion never starts a glass ----------------------------------------- */
var SKEY = 'hourglass.session.v1';
/**
 * From now on (window.__sw): what a glass that ran out does (the bowl, the stream's end, its buzz),
 * every buzz, wake locks asked for, sessions saved; and, step by step, grains let through the neck
 * (relSteps: steps with a release; partial: steps whose sand was neither all above nor all below).
 */
function startWatch(t) {
  return t.eval(function (SKEY) {
    var Hg = window.Hourglass, A = Hg.audio;
    if (!window.__swOn) {
      window.__swOn = true;
      ['chime', 'end'].forEach(function (m) { var f = A[m]; A[m] = function () { window.__sw[m]++; return f.apply(A, arguments); }; });
      var vib = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
      navigator.vibrate = function (p) { window.__sw.buzz.push(JSON.stringify(p)); return vib ? vib(p) : true; };
      var set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === SKEY) { try { window.__sw.saves.push(JSON.parse(v).state); } catch (e) { window.__sw.saves.push('?'); } }
        return set.apply(this, arguments);
      };
      if (navigator.wakeLock) {
        var rq = navigator.wakeLock.request.bind(navigator.wakeLock);
        navigator.wakeLock.request = function () { window.__sw.wake++; return rq.apply(null, arguments); };
      }
    }
    window.__sw = { chime: 0, end: 0, buzz: [], wake: 0, saves: [], relSteps: 0, partial: 0, steps: 0, flips0: __mon.flips };
    __rec.start(function (H) {
      var W = window.__sw, sim = H.sim;
      W.steps++;
      if (sim.frame.released > 0) W.relSteps++;
      if (sim.nTop !== 0 && sim.nTop !== sim.total) W.partial++;
      return 0;
    });
  }, SKEY);
}
/** The glass as a person meets it, and what startWatch has counted. */
function startRead(t) {
  return t.eval(function (SKEY) {
    var Hg = window.Hourglass, T = Hg.timer, W = window.__sw || {}, sim = Hg.sim;
    return { state: T.state, rem: T.rem, ms: T.durationMs, top: sim.nTop, total: sim.total, base: Hg.grav.base, gate: !!sim.gateOpen,
      status: document.getElementById('status').textContent, label: document.getElementById('btn-play').getAttribute('aria-label'),
      shown: document.getElementById('readout').textContent.replace(/\s+/g, ''), data: document.getElementById('app').dataset.state, title: document.title,
      saved: localStorage.getItem(SKEY), phase: Hg.seq.phase, turning: Hg.flip.active, below: Hg.remAt(sim.total - sim.nTop),
      chime: W.chime, end: W.end, buzz: (W.buzz || []).slice(), wake: W.wake, saves: (W.saves || []).slice(), relSteps: W.relSteps, partial: W.partial, steps: W.steps,
      flips: __mon.flips - (W.flips0 || 0) };
  }, SKEY);
}
function startShow(r) {
  return JSON.stringify({ state: r.state, rem: Math.round(r.rem), top: r.top + '/' + r.total, status: r.status, button: r.label, shown: r.shown, saved: r.saved ? JSON.parse(r.saved).state : null });
}
/** The phone turned to `heading` (pi: over; 0: upright again) and held. */
async function phoneTo(t, heading, ms) {
  await t.eval(function (h) { window.__motion.heading = h; }, heading);
  await sleep(ms || 1400);
}
/** Waiting as after Reset: idle, the clock at `ms`, all the sand above, the words, the button, nothing saved. */
function waitsFull(r, ms, shown) {
  return r.state === 'idle' && r.data === 'idle' && Math.abs(r.rem - ms) < 0.5 && r.top === r.total && r.total > 0 && !r.gate && r.status === 'Tap the glass to begin' &&
    r.label === 'Start' && r.shown === shown && r.title === 'Hourglass' && r.saved === null;
}
/** Waiting in between, its sand below: idle, 00:00.0, the same words and button, nothing saved. */
function waitsBelow(r) {
  return r.state === 'idle' && r.data === 'idle' && r.rem === 0 && r.top === 0 && !r.gate && r.status === 'Tap the glass to begin' &&
    r.label === 'Start' && r.shown === '00:00.0' && r.title === 'Hourglass' && r.saved === null;
}
/** Nothing of a glass that ran out (the bowl, the stream's end, the ending buzz, a wake lock, a session), and no grain through the neck, since startWatch. */
function nothingEnded(r) {
  return r.chime === 0 && r.end === 0 && r.wake === 0 && r.saves.length === 0 && r.relSteps === 0 && r.partial === 0 && r.steps > 0 &&
    r.buzz.indexOf('[16,110,16,110,42]') < 0;
}
function endedShow(r) {
  return 'bowls ' + r.chime + ', stream ends ' + r.end + ', buzzes ' + JSON.stringify(r.buzz) + ', wake locks asked ' + r.wake + ', sessions saved ' + JSON.stringify(r.saves) +
    '; steps with a grain through the neck ' + r.relSteps + ', with sand in both bulbs ' + r.partial + ', of ' + r.steps;
}
/** A finger takes the upper bulb and brings it round by `sweep` rad in ms, holds, lets go (app-gestures' arc). */
async function fingerTurn(t, sweep, ms) {
  var g = await t.glass(), R = 0.2 * g.h, R1 = R + 22, a0 = -Math.PI / 2;
  await t.touch.down(g.cx + R * Math.cos(a0), g.cy + R * Math.sin(a0));
  await sleep(30);
  await t.touch.move(g.cx + R1 * Math.cos(a0), g.cy + R1 * Math.sin(a0));
  await sleep(50);
  await t.touch.path(function (u) { var a = a0 + sweep * u; return { x: g.cx + R1 * Math.cos(a), y: g.cy + R1 * Math.sin(a) }; }, ms);
  await sleep(250);
  await t.touch.up();
}
function turnOver(t) {
  return t.page.waitForFunction(function () { var H = window.Hourglass; return !H.flip.active && H.body.mode === 'rest' && H.sim.angle === 0; }, null, { timeout: 6000, polling: 'raf' });
}
function ranOut(t, ms) {
  return t.page.waitForFunction(function () { var H = window.Hourglass; return H.timer.state === 'done' && H.sim.nTop === 0; }, null, { timeout: ms, polling: 100 });
}
/** A glass that the step before should have started and did not (on a tree where it fails) is started here, so that the checks after it are still made. */
function runIt(t) {
  return t.eval(function () { if (window.Hourglass.timer.state !== 'running') window.Hourglass.start(); });
}
async function resetGlass(t) {
  await t.page.tap('#btn-reset');
  await t.page.waitForFunction(function () { return !document.getElementById('app').classList.contains('sweep') && !document.getElementById('app').classList.contains('swap'); }, null, { timeout: 5000 });
  await sleep(500);
}

var START_SEED = { 'hourglass.settings.v1': { tilt: true, durationMs: 300000 } };

/* WAITING: after Reset, the phone turned over and back, three times in a row */
async function startWaiting(s, env) {
  var t = await env.open({ motionStub: true, storage: START_SEED });
  try {
    await sleep(800);
    await resetGlass(t);
    var on = await startRead(t);
    var cpu = await t.eval(function () { return { grav: window.Hourglass.grav.on, cpu: window.Hourglass.sim instanceof window.HourglassPhysics.Sim }; });
    s.check('START WAITING: Real motion on (the motion stub), the classic sand, a 5-minute glass after Reset: it waits', cpu.grav && cpu.cpu && waitsFull(on, 300000, '05:00.0'), startShow(on));
    await startWatch(t);
    for (var k = 1; k <= 3; k++) {
      await phoneTo(t, Math.PI);
      var mid = await startRead(t);
      s.check('START WAITING: the phone turned over (' + k + ' of 3): in between, its sand below, the glass waits (idle, 00:00.0, "Tap the glass to begin", the Start button), nothing saved',
              waitsBelow(mid) && Math.abs(mid.base - Math.PI) < 1e-6 && mid.flips === 2 * k - 1, startShow(mid) + ', swaps ' + mid.flips);
      await phoneTo(t, 0);
      var up = await startRead(t);
      s.check('START WAITING: ... and brought back (' + k + ' of 3): the glass waits as after Reset: idle, the clock unchanged at 05:00.0, all its sand above, the Start button, nothing saved',
              waitsFull(up, 300000, '05:00.0') && up.base === 0 && up.flips === 2 * k, startShow(up) + ', swaps ' + up.flips);
    }
    var all = await startRead(t);
    s.check('START WAITING: through the three turns and back nothing of a glass that ran out happened (no bowl, no ending buzz, no wake lock asked for, no session saved) and no grain passed the neck',
            nothingEnded(all) && all.buzz.length === 6 && all.buzz.every(function (b) { return b === '18'; }), endedShow(all) + ' (18: the swap\'s own tick)');
    // however the phone is moved: laid on its side, shaken upright, shaken turned over
    await phoneTo(t, Math.PI / 2, 900);
    await phoneTo(t, 0, 900);
    await t.eval(function () { window.__drive({ whole: true, fn: function (tt, f) { f.x = 1.5 * Math.sin(2 * Math.PI * 5 * tt); } }); });
    await sleep(1500);
    await t.eval(function () { window.__motion.heading = Math.PI; });
    await sleep(1800);
    await t.eval(function () { window.__driveStop(); });
    var moved = await startRead(t);
    s.check('START WAITING: laid on its side, shaken upright and shaken turned over (1.5 g at 5 Hz): it waits, and no grain passes the neck',
            waitsBelow(moved) && nothingEnded(moved), startShow(moved) + '; ' + endedShow(moved));
    // in between, the Flip button turns it over: its sand above again, it still waits
    await sleep(1200);
    await t.page.tap('#btn-flip');
    await sleep(300);
    await turnOver(t);
    await sleep(300);
    var flipped = await startRead(t);
    s.check('START WAITING: in between, the Flip button turns the glass over: its sand above again, it still waits, with its whole time',
            waitsFull(flipped, 300000, '05:00.0') && nothingEnded(flipped), startShow(flipped) + '; ' + endedShow(flipped));
    // a tap starts it: the sand runs (and the counts above see it)
    var g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(1500);
    var ran = await startRead(t);
    s.check('START WAITING: a tap on the glass starts it: it runs, grains pass the neck, the session is saved',
            ran.state === 'running' && ran.label === 'Pause' && ran.rem < 300000 && ran.rem > 297000 && ran.relSteps > 0 && ran.top < ran.total && ran.saves.indexOf('running') >= 0 && !!ran.saved,
            startShow(ran) + '; ' + endedShow(ran));
    // in between, Start turns the glass over on the screen and runs it
    await t.eval(function () { window.Hourglass.pause(); });
    await resetGlass(t);
    await phoneTo(t, 0);
    var again = await startRead(t);
    await startWatch(t);
    s.check('START WAITING: after Reset with the phone still turned over, and brought upright: the new glass waits', again.state === 'idle' && Math.abs(again.rem - (again.top ? 300000 : 0)) < 0.5 && again.saved === null, startShow(again));
    if (again.top) await phoneTo(t, Math.PI);
    var below = await startRead(t);
    await t.page.tap('#btn-play');
    await sleep(200);
    var turning = await startRead(t);
    await turnOver(t);
    await sleep(1200);
    var started = await startRead(t);
    s.check('START WAITING: in between, the Start button turns the glass over on the screen and runs it',
            waitsBelow(below) && turning.turning && started.state === 'running' && started.rem > 296000 && started.rem < 300000 && started.top < started.total && started.relSteps > 0,
            'before ' + startShow(below) + '; turning ' + turning.turning + '; after ' + startShow(started));
    await t.eval(function () { window.Hourglass.pause(); window.__motion.heading = 0; });
    await sleep(1500);
    await H.invariants(s, t, 'START WAITING');
  } finally { await t.close(); }
}

/* FINISHED: a glass that has run out, turned over by the phone, the Flip button or a finger, waits; a tap or Start runs it */
async function startFinished(s, env) {
  var t = await env.open({ motionStub: true, storage: { 'hourglass.settings.v1': { tilt: true, durationMs: 10000 } } });
  try {
    await sleep(800);
    await startWatch(t);
    await t.eval(function () { window.Hourglass.start(); });
    await ranOut(t, 16000);
    await sleep(1600);
    var done = await startRead(t);
    s.check('START FINISHED: a 10 s glass run to its end: finished, one bowl, "Time · tap to begin again"',
            done.state === 'done' && done.chime === 1 && done.status === 'Time · tap to begin again' && done.label === 'Flip and start again' && !!done.saved, startShow(done) + ', bowls ' + done.chime);
    await startWatch(t);
    await phoneTo(t, Math.PI);
    var f1 = await startRead(t);
    await sleep(1200);
    var f1b = await startRead(t);
    s.check('START FINISHED: the phone turned over: its sand is above and it waits as after Reset, with the time it would run (10 s), no session; the clock does not run and no grain passes',
            waitsFull(f1, 10000, '00:10.0') && waitsFull(f1b, 10000, '00:10.0') && nothingEnded(f1b), startShow(f1) + '; 1.2 s later ' + startShow(f1b) + '; ' + endedShow(f1b));
    await phoneTo(t, 0);
    var f2 = await startRead(t);
    await phoneTo(t, Math.PI);
    var f3 = await startRead(t);
    s.check('START FINISHED: turned back and over again: it waits both times (in between 00:00.0, then 10 s again), nothing of an ended glass, no grain through the neck',
            waitsBelow(f2) && waitsFull(f3, 10000, '00:10.0') && nothingEnded(f3), startShow(f2) + '; ' + startShow(f3) + '; ' + endedShow(f3));
    var g2 = await t.glass();
    await t.touch.tap(g2.cx, g2.cy, 60);
    await sleep(600);
    var f4 = await startRead(t);
    await runIt(t);
    await ranOut(t, 16000);
    await sleep(1600);
    var f5 = await startRead(t);
    s.check('START FINISHED: a tap starts it, and it runs to its end with its bowl', f4.state === 'running' && f4.rem < 10000 && f5.state === 'done' && f5.chime === 1 && f5.relSteps > 0,
            startShow(f4) + '; then ' + startShow(f5) + ', bowls ' + f5.chime);
    // no turn by hand starts it either (1.20.2): the Flip button turns a finished glass over and it waits
    await t.page.tap('#btn-flip');
    await sleep(300);
    await turnOver(t);
    await sleep(500);
    var f6 = await startRead(t);
    await sleep(1200);
    var f6b = await startRead(t);
    s.check('START FINISHED: the Flip button turns a finished glass over and it waits, with the time it would run (10 s); it does not start',
            waitsFull(f6, 10000, '00:10.0') && waitsFull(f6b, 10000, '00:10.0') && f6.label === 'Start', startShow(f6) + '; 1.2 s later ' + startShow(f6b));
    await t.eval(function () { window.Hourglass.start(); });
    await ranOut(t, 16000);
    await sleep(1200);
    // ... and so does a finger that turns it over
    await fingerTurn(t, 200 * Math.PI / 180, 1200);
    await turnOver(t);
    await sleep(500);
    var f7 = await startRead(t);
    await sleep(1200);
    var f7b = await startRead(t);
    s.check('START FINISHED: a finger turning a finished glass over leaves it waiting (10 s): it does not start',
            waitsFull(f7, 10000, '00:10.0') && waitsFull(f7b, 10000, '00:10.0') && f7.label === 'Start', startShow(f7) + '; 1.2 s later ' + startShow(f7b));
    await t.page.tap('#btn-play');
    await sleep(400);
    var f8 = await startRead(t);
    s.check('START FINISHED: ... and Start then runs it', f8.state === 'running' && f8.rem < 10000 && f8.label === 'Pause', startShow(f8));
    await t.eval(function () { window.Hourglass.pause(); window.__motion.heading = 0; });
    await sleep(1500);
    await H.invariants(s, t, 'START FINISHED');
  } finally { await t.close(); }
}

/* SEQUENCE: a finished sequence turned over by the phone waits at its first glass */
async function startSequence(s, env) {
  var t = await env.open({ motionStub: true, storage: { 'hourglass.settings.v1': { tilt: true, durationMs: 10000, restMs: 10000, rounds: 1 } } });
  try {
    await sleep(800);
    var q0 = await startRead(t);
    await t.eval(function () { window.Hourglass.start(); });
    await ranOut(t, 40000);
    await sleep(1600);
    var q1 = await startRead(t);
    await startWatch(t);
    await phoneTo(t, Math.PI);
    var q2 = await startRead(t);
    await sleep(1200);
    var q3 = await startRead(t);
    s.check('START SEQUENCE: work 10 s and rest 10 s run to the end, the phone turned over: the sequence waits at its first glass (idle, the work time on the clock, phase 0), and stays so',
            q0.state === 'idle' && q1.state === 'done' && q1.phase === 2 && waitsFull(q2, 10000, '00:10.0') && q2.phase === 0 && waitsFull(q3, 10000, '00:10.0') && nothingEnded(q3),
            'ended in phase ' + q1.phase + ' (' + q1.state + '); turned over ' + startShow(q2) + ', phase ' + q2.phase + '; ' + endedShow(q3));
    var g3 = await t.glass();
    await t.touch.tap(g3.cx, g3.cy, 60);
    await sleep(700);
    var q4 = await startRead(t);
    s.check('START SEQUENCE: a tap begins Work', q4.state === 'running' && /^Work/.test(q4.status) && q4.phase === 0 && q4.rem < 10000, startShow(q4) + ', phase ' + q4.phase);
    await t.eval(function () { window.Hourglass.pause(); window.__motion.heading = 0; });
    await sleep(1500);
    await H.invariants(s, t, 'START SEQUENCE');
  } finally { await t.close(); }
}

/* PAUSED: a paused glass stays paused, turned over by the phone and back */
async function startPaused(s, env) {
  var t = await env.open({ motionStub: true, storage: START_SEED });
  try {
    await sleep(800);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(3000);
    await t.eval(function () { window.Hourglass.pause(); });
    await sleep(400);
    var p0 = await startRead(t);
    await phoneTo(t, Math.PI);
    var p1 = await startRead(t);
    await sleep(600);
    var p1b = await startRead(t);
    await phoneTo(t, 0);
    var p2 = await startRead(t);
    // (the time swapped is the time of the sand that had fallen: app.js remAt of it, a little over the 3 s, since a glass's last grains thin out)
    s.check('START PAUSED: a glass paused 3 s into its run, the phone turned over and back: paused both times, its time swapped (the time of the sand that had fallen) and back, the clock still',
            p0.state === 'paused' && p1.state === 'paused' && p1.status === 'Paused' && Math.abs(p1.rem - p0.below) < 1e-6 && p1.rem > 2000 && p1.rem < 6000 && p1b.rem === p1.rem &&
            p1.top === p0.total - p0.top && p2.state === 'paused' && Math.abs(p2.rem - p1.below) < 1e-6 && Math.abs(p2.rem - p0.rem) < 1000 && p2.top === p0.top,
            'paused at ' + (p0.rem / 1000).toFixed(2) + ' s, the sand below worth ' + (p0.below / 1000).toFixed(2) + ' s; turned over ' + (p1.rem / 1000).toFixed(2) + ' s (' + p1.state +
            '); back ' + (p2.rem / 1000).toFixed(2) + ' s (' + p2.state + ')');
    // paused before a grain had fallen: all its sand above
    await resetGlass(t);
    await t.eval(function () { window.Hourglass.start(); window.Hourglass.pause(); });
    await sleep(500);
    var e0 = await startRead(t);
    await startWatch(t);
    await phoneTo(t, Math.PI);
    var e1 = await startRead(t);
    await phoneTo(t, 0);
    var e2 = await startRead(t);
    await sleep(800);
    var e3 = await startRead(t);
    s.check('START PAUSED: paused before a grain had fallen (all its sand above), the phone turned over and back: paused both times (00:00.0 in between), never finished, never running, no grain through the neck',
            e0.state === 'paused' && e0.top === e0.total && e1.state === 'paused' && e1.rem === 0 && e1.top === 0 && e1.status === 'Paused' &&
            e2.state === 'paused' && Math.abs(e2.rem - 300000) < 0.5 && e2.top === e2.total && e3.state === 'paused' && e3.rem === e2.rem && e3.relSteps === 0 && e3.chime === 0 && e3.end === 0,
            'paused ' + startShow(e0) + '; turned over ' + startShow(e1) + '; back ' + startShow(e2) + '; ' + endedShow(e3));
    await H.invariants(s, t, 'START PAUSED');
  } finally { await t.close(); }
}

/** The four parts, each on its own pages: one that throws (on a tree where the glass does something else) does not hide the others. */
async function testStart(s, env) {
  var parts = [['WAITING', startWaiting], ['FINISHED', startFinished], ['SEQUENCE', startSequence], ['PAUSED', startPaused]];
  for (var i = 0; i < parts.length; i++) {
    try { await parts[i][1](s, env); } catch (e) {
      s.check('START ' + parts[i][0] + ': no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
    }
  }
}

/* ---- TURNS: no turn of the glass by hand starts it (1.20.2) ---------------------------------- */
// A finger's drag-turn, a flick, the Flip button and F, each on a glass that waits, one that has
// run out, one that is paused and one that runs (the classic sand), twice over and back: only a
// glass that was running runs after a turn. Then Start, or a tap on the glass, starts it from
// there. The phone's turn is START's.
var TURN_MS = 10000;
/** The glass brought to `state` (idle: as after Reset; done: run out; paused: 1.5 s in; running) with its sand upright. */
async function turnsTo(t, state) {
  await t.eval(function () { var H = window.Hourglass; if (H.timer.state === 'running') H.pause(); });
  await resetGlass(t);
  if (state === 'idle') return;
  await t.eval(function () { window.Hourglass.start(); });
  if (state === 'done') { await ranOut(t, TURN_MS + 8000); await sleep(1400); return; }
  await sleep(1500);
  if (state === 'paused') { await t.eval(function () { window.Hourglass.pause(); }); await sleep(300); }
}
/** One turn over by `way`, and the glass at rest again. */
async function turnBy(t, way) {
  if (way === 'drag') await fingerTurn(t, 200 * Math.PI / 180, 1100);
  else if (way === 'flick') {
    var g = await t.glass(), R = 0.2 * g.h, R1 = R + 22, a0 = -Math.PI / 2, sweep = 4 * 0.26;
    await t.touch.down(g.cx + R * Math.cos(a0), g.cy + R * Math.sin(a0));
    await sleep(30);
    await t.touch.move(g.cx + R1 * Math.cos(a0), g.cy + R1 * Math.sin(a0));
    await sleep(50);
    await t.touch.path(function (u) { var a = a0 + sweep * u; return { x: g.cx + R1 * Math.cos(a), y: g.cy + R1 * Math.sin(a) }; }, 260, true);
  }
  else if (way === 'flip') await t.page.tap('#btn-flip');
  else { await t.eval(function () { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }); await t.page.keyboard.press('f'); }   // (as on the page, not on a button)
  await sleep(300);
  await turnOver(t);
  await sleep(400);
}
function turnShow(r) { return r.state + ' ' + r.shown + ' ' + r.top + '/' + r.total + ' "' + r.status + '" [' + r.label + '] turns ' + r.flips; }
async function testTurns(s, env) {
  var t = await env.open({ motionStub: true, storage: { 'hourglass.settings.v1': { tilt: true, durationMs: TURN_MS } } });
  try {
    await sleep(800);
    for (var state of ['idle', 'done', 'paused', 'running']) {
      for (var way of ['drag', 'flick', 'flip', 'key']) {
        await turnsTo(t, state);
        await startWatch(t);
        var r0 = await startRead(t);
        await turnBy(t, way);
        var r1 = await startRead(t);
        await sleep(900);
        var r1b = await startRead(t);
        await turnBy(t, way);
        var r2 = await startRead(t);
        await sleep(900);
        var r2b = await startRead(t);
        var odd = r1.flips % 2 === 1, even = r2.flips % 2 === 0, ok;
        if (state === 'running') ok = r1.state === 'running' && r2b.state === 'running' && r1b.rem < r1.rem && r2b.rem < r2.rem;
        else if (state === 'paused') ok = r1.state === 'paused' && r1b.rem === r1.rem && r2.state === 'paused' && r2b.rem === r2.rem && Math.abs(r2.rem - r0.rem) < 1000;
        else if (state === 'idle') ok = waitsBelow(r1) && waitsBelow(r1b) && waitsFull(r2, TURN_MS, '00:10.0') && waitsFull(r2b, TURN_MS, '00:10.0') && nothingEnded(r2b);
        else ok = waitsFull(r1, TURN_MS, '00:10.0') && waitsFull(r1b, TURN_MS, '00:10.0') && waitsBelow(r2) && waitsBelow(r2b) && r2b.chime === 0 && r2b.relSteps === 0;
        s.check('TURNS: ' + ({ drag: 'a finger\'s drag-turn', flick: 'a flick', flip: 'the Flip button', key: 'F' })[way] + ' on a glass that ' +
                ({ idle: 'waits', done: 'has run out', paused: 'is paused', running: 'runs' })[state] + ', over and back: ' +
                ({ idle: 'it waits, its sand below (00:00.0), then above', done: 'it waits, its sand above (its full time), then below', paused: 'it stays paused, its time swapped and back', running: 'it runs on' })[state],
                ok && odd && even && r1.flips === 1 && r2.flips === 2, turnShow(r0) + ' → ' + turnShow(r1) + ' → ' + turnShow(r1b) + ' → ' + turnShow(r2) + ' → ' + turnShow(r2b));
        if (state === 'running') continue;
        // from there, after one more turn (the sand below for a glass that waited, above for one that had run out): a press of Start or a tap starts it
        await turnBy(t, way);
        var how = way === 'drag' || way === 'flick' ? 'tap' : 'start';
        if (how === 'tap') { var g = await t.glass(); await t.touch.tap(g.cx, g.cy, 60); } else await t.page.tap('#btn-play');
        await sleep(400);
        try { await turnOver(t); } catch (e) { /* (no turn) */ }
        await sleep(500);
        var r3 = await startRead(t);
        s.check('TURNS: ... and then ' + (how === 'tap' ? 'a tap on the glass' : 'Start') + ' starts it' + (state === 'idle' ? ' (its sand below: turned over on the screen, then running)' : ''),
                r3.state === 'running' && r3.label === 'Pause' && r3.rem < TURN_MS && r3.rem > 0, turnShow(r3));
      }
    }
    await t.eval(function () { var H = window.Hourglass; if (H.timer.state === 'running') H.pause(); });
    await sleep(600);
    await H.invariants(s, t, 'TURNS');
  } finally { await t.close(); }

  // a work and rest sequence, end to end: its own turns run it; turned over by the Flip button
  // once it has ended, it waits at its first glass; a tap begins Work
  t = await env.open({ motionStub: true, storage: { 'hourglass.settings.v1': { tilt: true, durationMs: 10000, restMs: 10000, rounds: 1 } } });
  try {
    await sleep(800);
    await t.eval(function () { window.Hourglass.start(); });
    await t.page.waitForFunction(function () { var H = window.Hourglass; return H.seq.phase === 1 && H.timer.state === 'running' && !H.flip.active; }, null, { timeout: 25000, polling: 100 });
    await sleep(500);
    var q1 = await startRead(t);
    await ranOut(t, 40000);
    await sleep(1600);
    var q2 = await startRead(t);
    await startWatch(t);
    await turnBy(t, 'flip');
    var q3 = await startRead(t);
    await sleep(1200);
    var q4 = await startRead(t);
    var g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(700);
    var q5 = await startRead(t);
    s.check('TURNS: a sequence (work 10 s, rest 10 s) runs through its own turn into Rest and ends; the Flip button then turns it to wait at its first glass (the work time, phase 0) and it stays so; a tap begins Work',
            q1.state === 'running' && /^Rest/.test(q1.status) && q1.phase === 1 && q2.state === 'done' && q2.phase === 2 && waitsFull(q3, 10000, '00:10.0') && q3.phase === 0 &&
            waitsFull(q4, 10000, '00:10.0') && nothingEnded(q4) && q5.state === 'running' && /^Work/.test(q5.status) && q5.phase === 0,
            [q1, q2, q3, q4, q5].map(function (q) { return turnShow(q) + ' phase ' + q.phase; }).join(' → '));
    await t.eval(function () { window.Hourglass.pause(); });
    await sleep(600);
  } finally { await t.close(); }
}

(async function main() {
  var s = new H.Suite('app-motion');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!only || only === 'mapping') await testMapping(s, env);
    if (!only || only === 'tiltswap') await testTiltSwap(s, env);
    if (!only || only === 'slosh') await testSlosh(s, env);
    if (!only || only === 'sides') await testSides(s, env);
    if (!only || only === 'start') await testStart(s, env);
    if (!only || only === 'turns') await testTurns(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
