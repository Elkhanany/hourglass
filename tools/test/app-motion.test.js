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
 *   node tools/test/app-motion.test.js [--root <dir>] [--port <n>] [--only mapping|tiltswap|slosh|sides]
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
  await sleep(1500);
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
  await t.eval(function () {
    __mon.flips = 0;
    window.__swapAt = -1;
    window.__motion.heading = Math.PI;
    window.__overAt = performance.now();
  });
  await sleep(300);
  var b0 = await t.eval(function () { return __mon.flips; });
  await sleep(1200);
  var b = await t.eval(function () { return { flips: __mon.flips, base: window.Hourglass.grav.base, state: window.Hourglass.timer.state }; });
  s.check('TILTSWAP: held over for 300 ms: exactly one swap', b.flips === 1, b.flips + ' swaps (' + b0 + ' by 300 ms), base ' + b.base.toFixed(3));
  s.check('TILTSWAP: ... and the clock carries on', b.state === 'running', b.state);
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

(async function main() {
  var s = new H.Suite('app-motion');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!only || only === 'mapping') await testMapping(s, env);
    if (!only || only === 'tiltswap') await testTiltSwap(s, env);
    if (!only || only === 'slosh') await testSlosh(s, env);
    if (!only || only === 'sides') await testSides(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
