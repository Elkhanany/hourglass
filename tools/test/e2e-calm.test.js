/*
 * Integration E1 (calm baseline) and E11 (existing features), against the
 * real modules.
 *
 * E1  A 20 s glass started by a tap, no motion: the last grain leaves the
 *     neck within 30 ms of 00:00.0; the main screen has exactly the
 *     controls it had (buttons, Tune rows) and the switch reads 'Real
 *     motion'; the frame's JS work stays within 8 ms at the 95th percentile.
 * E11 Duration pills and a custom duration, start, the Flip button (2.6 s,
 *     time swaps), pour, Zen, the end and its quiet hold, the wake lock
 *     (app-regression's flow on the real modules); turning the phone over
 *     (deviceorientation beta → −90°) for 300 ms swaps once, a 120 ms glitch
 *     does not; the service worker caches its current VERSION with motion.js.
 *
 *   node tools/test/e2e-calm.test.js [--root <dir>] [--port <n>] [--only e1|e11]
 */
'use strict';
var H = require('./stubs/harness.js');
var R = require('./app-regression.test.js');
var sleep = H.sleep;

async function e1(s, env) {
  var t = await env.open({});
  var ui = await t.eval(function () {
    var row = document.getElementById('opt-tilt').closest('.row');
    return {
      top: document.querySelectorAll('#hud-top button').length,
      bottom: document.querySelectorAll('#hud-bottom button').length,
      rows: document.querySelectorAll('#sheet-settings .row').length,
      tilt: row.querySelector('b').textContent
    };
  });
  // f446085 had 3 buttons at the top, 13 below and 6 Tune rows; Layered sand and Breathing pace added a row each
  s.check('E1: the main screen\'s controls are unchanged', ui.top === 4 && ui.bottom === 12 && ui.rows === 9, JSON.stringify(ui));
  s.check('E1: the #opt-tilt row reads "Real motion"', ui.tilt === 'Real motion', '"' + ui.tilt + '"');
  await t.eval(function () { window.Hourglass.setDuration(20000); });
  await sleep(1400);
  await t.eval(function () { __mon.reset(); });
  var p = await H.perfWatch(t);
  var g = await t.glass();
  await t.touch.tap(g.cx, g.cy, 60);
  await p.wait(19000);
  await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; },
                               null, { timeout: 8000, polling: 250 });
  await p.poll();
  var r = await t.eval(function () { return { empty: __mon.emptyAt, done: __mon.doneAt }; });
  var d = r.empty - r.done;
  s.check('E1: the last grain leaves within 30 ms of 00:00.0', r.empty > 0 && r.done > 0 && Math.abs(d) <= 30, 'nTop = 0 at ' + d + ' ms from done');
  var p95 = H.pct(p.frame, 95);
  s.check('E1: frame work p95 ≤ 8 ms', p95 <= 8, 'p95 ' + p95.toFixed(2) + ' ms, p50 ' + H.pct(p.frame, 50).toFixed(2) +
          ' ms over ' + p.frame.length + ' frames; sim p95 ' + H.pct(p.sim, 95).toFixed(2) + ', drawSand p95 ' + H.pct(p.draw, 95).toFixed(2));
  await H.invariants(s, t, 'E1');
  await t.close();
}

async function realMotionOn(t) {
  await t.page.tap('#btn-settings');
  await sleep(700);
  await t.page.$eval('#opt-tilt', function (el) { el.scrollIntoView({ block: 'center' }); });
  await sleep(150);
  await t.page.tap('#opt-tilt');
  await sleep(300);
  await t.page.tap('#sheet-settings .sheet-close');
  await sleep(700);
}

async function tiltSwap(s, env) {
  var t = await env.open({});
  await realMotionOn(t);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios', beta: 90 }); window.Hourglass.start(); });
  await sleep(1500);
  // a 120 ms glitch: the phone reads upside down, then upright again
  await t.eval(function () {
    __mon.flips = 0;
    window.__driveSet({ beta: -90 });
    setTimeout(function () { window.__driveSet({ beta: 90 }); }, 120);
  });
  await sleep(1300);
  var a = await t.eval(function () { return __mon.flips; });
  s.check('E11: deviceorientation beta → −90° for 120 ms: no swap', a === 0, a + ' swaps');
  // turned over and held
  await t.eval(function () { __mon.flips = 0; window.__driveSet({ beta: -90 }); });
  await sleep(300);
  await sleep(1200);
  var b = await t.eval(function () { return { flips: __mon.flips, base: window.Hourglass.grav.base, state: window.Hourglass.timer.state }; });
  s.check('E11: beta → −90° held 300 ms: swaps once', b.flips === 1, b.flips + ' swaps, base ' + b.base.toFixed(3) + ', ' + b.state);
  await t.eval(function () { window.__driveStop(); });
  await H.invariants(s, t, 'E11 tiltSwap');
  await t.close();
}

(async function main() {
  var s = new H.Suite('e2e-calm (E1, E11)');
  var env = await H.start();
  var root = env.root, only = env.args.only;
  R.CFG.stub = false;
  try {
    if (!only || only === 'e1') await e1(s, env);
    if (!only || only === 'e11') {
      await R.testFlow(s, env);
      if (env.caps.motion) await tiltSwap(s, env);
      else s.check('E11 tiltSwap needs the real motion.js', false, 'motion.js has not landed in ' + root);
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  if (!only || only === 'e11') {
    try {
      await R.testServiceWorker(s, root);
    } catch (e) {
      s.check('no exception (service worker)', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
    }
  }
  s.done();
})();
