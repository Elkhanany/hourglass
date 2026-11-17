/*
 * Controller acceptance 9 (RETIME), with the real Sim and the motion stub.
 * A 60 s glass is shaken vigorously (Γ4 at 5.5 Hz) from 15 to 35 s. The
 * shaken neck falls behind; once calm, the rest of the run is re-timed
 * exactly once; the catch-up never teleports sand while the shaking is
 * recent; and the last grain still leaves the neck within 30 ms of the
 * readout reaching 00:00.0.
 *
 *   node tools/test/app-retime.test.js [--root <dir>] [--port <n>]
 *
 * Needs the motion path (physics-core P1): on the P0 sim shaking moves no
 * sand, so there is nothing to re-time.
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
}

/** Note every change of the clock's rate, and the lag, each frame. */
function watchClock(t) {
  return t.eval(function () {
    var H = window.Hourglass, w = window.__clk = { mpg: [], lagMax: 0, startAt: Date.now(), t0: performance.now() };
    var last = H.timer.mpg;
    (function f() {
      if (H.timer.mpg !== last) { w.mpg.push({ t: (Date.now() - w.startAt) / 1000, from: last, to: H.timer.mpg }); last = H.timer.mpg; }
      if (H.timer.state === 'running') {
        var lag = H.sim.nTop - H.topAt(H.timer.rem);
        if (lag > w.lagMax) w.lagMax = lag;
      }
      requestAnimationFrame(f);
    })();
  });
}

(async function main() {
  var s = new H.Suite('app-retime');
  var env = await H.start();
  try {
    if (!env.caps.p1) {
      s.check('RETIME needs the motion path (physics-core P1) in physics.js', false, 'the served sim is P0: shaking moves no sand');
    } else {
      var t = await env.open({ motionStub: true });
      await t.eval(function () { window.Hourglass.setDuration(60000); });
      await sleep(1400);
      await realMotionOn(t);
      await t.eval(function () { __mon.reset(); window.Hourglass.start(); });
      await watchClock(t);
      await sleep(15000);
      await t.eval(function () { window.__drive({ profile: 'vigorous', durS: 20 }); });
      await sleep(20000);
      await t.eval(function () { window.__driveStop(); });
      var mid = await t.eval(function () { return { lag: window.__clk.lagMax, mpg: window.__clk.mpg.length }; });
      s.note('shaking 15–35 s', 'the neck fell behind by up to ' + mid.lag.toFixed(0) + ' grains; mpg changes so far ' + mid.mpg);
      await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, null, { timeout: 40000, polling: 500 });
      await sleep(500);
      var r = await t.eval(function () {
        return { clk: window.__clk, ff: __mon.ff, empty: __mon.emptyAt, done: __mon.doneAt, mpg0: window.Hourglass.debug.mpg0 };
      });
      var after = r.clk.mpg.filter(function (c) { return c.t >= 35; });
      s.check('RETIME: the rate changed exactly once, after the shaking stopped', r.clk.mpg.length === 1 && after.length === 1,
              JSON.stringify(r.clk.mpg.map(function (c) { return [c.t.toFixed(2) + ' s', (c.from).toFixed(3) + ' → ' + c.to.toFixed(3) + ' ms/grain']; })) +
              ', max lag ' + r.clk.lagMax.toFixed(0) + ' grains');
      var bad = r.ff.filter(function (c) { return c.motionRecent; });
      s.check('RETIME: no fastForward while motion was recent', bad.length === 0, r.ff.length + ' fastForward calls, ' + bad.length + ' while recent');
      var d = r.empty - r.done;
      s.check('RETIME: the last grain left within 30 ms of 00:00.0', r.empty > 0 && r.done > 0 && Math.abs(d) <= 30,
              'nTop = 0 at ' + d + ' ms from done');
      await H.invariants(s, t, 'RETIME');
      await t.close();
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
