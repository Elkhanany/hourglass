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
 *     stream, and is heard all the same, softly, toward the low side; shaken
 *     (1.5 g at 5 Hz): the rush and the shimmer; no stream and no ambience
 *     in either. The control: the same lean while the glass runs leaves the
 *     rush at nothing, as it always did.
 *
 *   node tools/test/app-motion.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;

async function realMotionOn(t) {
  await t.page.tap('#btn-settings');
  await sleep(700);
  await t.page.$eval('#opt-tilt', function (el) { el.scrollIntoView({ block: 'center' }); });
  await sleep(150);
  await t.page.tap('#opt-tilt');
  await sleep(300);
  await t.page.tap('#sheet-settings .sheet-close');
  await sleep(700);
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
  return t.eval(function () { var o = {}, W = window.__sl; for (var k in W) o[k] = W[k]; o.state = window.Hourglass.timer.state; return o; });
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
    s.check('SLOSH: ... toward the low side (the rush panned where the sand runs), with no stream and no ambience',
            Math.abs(lean.pan) > 0.2 && lean.pan * lean.panAsked > 0 && lean.flow === 0 && lean.stream === 0 && lean.ambient === 0, sloshShow(lean) + ' asked ' + lean.panAsked.toFixed(2));
    await sleep(3500);                   // the sand back at rest, upright
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

(async function main() {
  var s = new H.Suite('app-motion');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!only || only === 'mapping') await testMapping(s, env);
    if (!only || only === 'tiltswap') await testTiltSwap(s, env);
    if (!only || only === 'slosh') await testSlosh(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
