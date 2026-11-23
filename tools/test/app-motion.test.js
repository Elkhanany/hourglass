/*
 * Controller acceptance 8 (MAPPING) and 10 (TILTSWAP), with the motion stub.
 *
 *  8. The phone's felt acceleration, page frame, reaches the sim in the
 *     vessel frame: x = +1 g with the glass held at θ = π/2 gives
 *     (ax, ay) = (0, −G) within 2 % (and (+G, 0) at θ = 0).
 * 10. Turned over and held 300 ms, the glass swaps once; a 120 ms glitch
 *     never swaps it.
 *
 *   node tools/test/app-motion.test.js [--root <dir>] [--port <n>]
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

(async function main() {
  var s = new H.Suite('app-motion');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!only || only === 'mapping') await testMapping(s, env);
    if (!only || only === 'tiltswap') await testTiltSwap(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
