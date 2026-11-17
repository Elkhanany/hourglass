/*
 * Controller acceptance 9 (RETIME), with the real Sim and the motion stub.
 * A 60 s glass is shaken vigorously (Γ4 at 5.5 Hz) from 15 to 35 s. The
 * shaken neck stutters and falls behind the clock.
 *
 *   RETIME   the glass held whole (the stub never arms it), so that only
 *            the clock is under test: the neck falls some 700 grains
 *            behind, a quarter of the glass, more than the thicker thread
 *            can make up in the moment after the shake. Once calm, the
 *            rest of the run is re-timed, exactly once.
 *   CRACKED  the shake as the app meets it: hard enough to arm the glass,
 *            crack it and spill sand. What is lost above the neck and what
 *            the neck is behind cancel in part, differently every run, so
 *            the thread alone may catch up. The run is re-timed only where
 *            that is needed, never before the glass is calm, at most once.
 *
 * In both the catch-up never teleports sand while the shaking is recent,
 * the sand above the neck matches the clock once calm, and the last grain
 * leaves the neck within 30 ms of the readout reaching 00:00.0.
 *
 * (Until the amount of sand followed the square root of the time, a
 * one-minute glass held 10,100 grains and fell 2,300 behind, cracked or
 * not: one case was enough. It now holds 2,838, and a cracked glass can
 * lose half of them.)
 *
 *   node tools/test/app-retime.test.js [--root <dir>] [--port <n>] [--only retime|cracked]
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

/**
 * Each frame: every change of the clock's rate (and how far the sand above
 * the neck was from the clock the frame before), the largest lag, and how
 * many calm frames the sand was past the re-timing threshold.
 */
function watchClock(t) {
  return t.eval(function () {
    var H = window.Hourglass, w = window.__clk = {
      mpg: [], lagMax: 0, lagAtEnd: null, shakeEnd: 0, over: 0, calmAt: 0, lagCalm: 0,
      rate: H.timer.rate, thr: Math.max(3, 0.5 * H.timer.rate), startAt: Date.now(), dev: 0
    };
    var last = H.timer.mpg;
    (function f() {
      // (this runs after the app's frame, so a re-timing due this frame has already happened)
      var tt = (Date.now() - w.startAt) / 1000;
      if (H.timer.mpg !== last) { w.mpg.push({ t: tt, from: last, to: H.timer.mpg, devBefore: w.dev }); last = H.timer.mpg; }
      w.dev = 0;
      if (H.timer.state === 'running') {
        var lag = H.sim.nTop - H.topAt(H.timer.rem);
        if (lag > w.lagMax) w.lagMax = lag;
        if (H.timer.rem > H.timer.tailMs + 2000) {
          w.dev = lag < 0 ? -lag : lag;
          if (w.shakeEnd && !H.debug.motionRecent) {
            if (!w.calmAt) { w.calmAt = tt; w.lagCalm = lag; }
            if (w.dev > Math.max(3, 0.5 * H.timer.rate)) w.over++;
          }
        }
      }
      requestAnimationFrame(f);
    })();
  });
}

/**
 * A 60 s glass shaken vigorously from 15 to 35 s (whole: never armed, so it
 * cannot crack), run to its end. Returns what the clock did and what the
 * monitor saw.
 */
async function shaken(env, whole) {
  var t = await env.open({ motionStub: true });
  await t.eval(function () { window.Hourglass.setDuration(60000); });
  await sleep(1400);
  await realMotionOn(t);
  await t.eval(function () { __mon.reset(); window.Hourglass.start(); });
  await watchClock(t);
  await sleep(15000);
  await t.eval(function (w) { window.__drive({ profile: 'vigorous', durS: 20, whole: w }); }, !!whole);
  await sleep(20000);
  await t.eval(function () {
    window.__driveStop();
    var H = window.Hourglass, w = window.__clk;
    w.shakeEnd = (Date.now() - w.startAt) / 1000;
    w.lagAtEnd = H.sim.nTop - H.topAt(H.timer.rem);
  });
  await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; }, null, { timeout: 40000, polling: 500 });
  await sleep(500);
  var r = await t.eval(function () {
    var H = window.Hourglass;
    return { clk: window.__clk, ff: __mon.ff, empty: __mon.emptyAt, done: __mon.doneAt, total: H.sim.total, lost: H.sim.lost, cracks: H.sim.cracks.length };
  });
  r.t = t;
  return r;
}

function fmtMpg(list) {
  return JSON.stringify(list.map(function (c) {
    return [c.t.toFixed(2) + ' s', c.from.toFixed(3) + ' → ' + c.to.toFixed(3) + ' ms/grain', c.devBefore.toFixed(0) + ' grains off'];
  }));
}

/** The checks both glasses share. */
async function common(s, r, tag) {
  var c = r.clk;
  s.check(tag + ': once calm the sand above the neck matches the clock', c.over <= 30,
          c.over + ' calm frames past the threshold of ' + c.thr.toFixed(0) + ' grains; ' + c.lagCalm.toFixed(0) + ' behind when the shaking was no longer recent (' + c.calmAt.toFixed(2) + ' s)');
  var bad = r.ff.filter(function (q) { return q.motionRecent; });
  s.check(tag + ': no fastForward while motion was recent', bad.length === 0, r.ff.length + ' fastForward calls, ' + bad.length + ' while recent');
  var d = r.empty - r.done;
  s.check(tag + ': the last grain left within 30 ms of 00:00.0', r.empty > 0 && r.done > 0 && Math.abs(d) <= 30,
          'nTop = 0 at ' + d + ' ms from done');
  await H.invariants(s, r.t, tag);
  await r.t.close();
}

async function retime(s, env) {
  var r = await shaken(env, true), c = r.clk;
  s.note('RETIME', 'the glass held whole, ' + c.rate.toFixed(0) + ' grains a second: shaken 15–35 s the neck fell behind by up to ' + c.lagMax.toFixed(0) + ' grains, ' +
         c.lagAtEnd.toFixed(0) + ' (' + (c.lagAtEnd / c.rate).toFixed(1) + ' s of sand) as the shaking stopped');
  s.check('RETIME: the glass stayed whole', r.cracks === 0 && r.lost === 0, r.cracks + ' cracks, ' + r.lost + ' grains lost');
  // (the control: with less behind the thread alone could catch up, and the case would say nothing)
  s.check('RETIME: the shake left the neck more than eight seconds of sand behind', c.lagAtEnd > 8 * c.rate,
          c.lagAtEnd.toFixed(0) + ' grains at ' + c.rate.toFixed(1) + ' a second');
  s.check('RETIME: the rate changed exactly once, after the shaking stopped, and it was needed',
          c.mpg.length === 1 && c.mpg[0].t >= c.shakeEnd + 0.7 && c.mpg[0].devBefore > c.thr,
          fmtMpg(c.mpg) + '; the shaking stopped at ' + c.shakeEnd.toFixed(2) + ' s, threshold ' + c.thr.toFixed(0) + ' grains');
  await common(s, r, 'RETIME');
}

async function cracked(s, env) {
  var r = await shaken(env, false), c = r.clk;
  s.note('CRACKED', 'armed as the app arms it, ' + c.rate.toFixed(0) + ' grains a second: shaken 15–35 s the neck fell behind by up to ' + c.lagMax.toFixed(0) + ' grains, ' +
         c.lagAtEnd.toFixed(0) + ' as the shaking stopped; ' + r.lost + ' grains lost through the broken glass');
  // (the controls: this is the shake that breaks the glass, and it did hold the neck back)
  s.check('CRACKED: the shake broke the glass: sand was lost', r.lost > 0, r.lost + ' of ' + (r.total + r.lost) + ' grains lost');
  s.check('CRACKED: the shake held the neck back by more than a second of sand', c.lagMax > c.rate,
          c.lagMax.toFixed(0) + ' grains at ' + c.rate.toFixed(1) + ' a second');
  var early = c.mpg.filter(function (q) { return q.t < c.shakeEnd + 0.7; }), needless = c.mpg.filter(function (q) { return !(q.devBefore > c.thr); });
  s.check('CRACKED: re-timed at most once, only once calm, and only past the threshold',
          c.mpg.length <= 1 && early.length === 0 && needless.length === 0,
          c.mpg.length + ' re-timings ' + fmtMpg(c.mpg) + '; ' + early.length + ' too early, ' + needless.length + ' without need (threshold ' + c.thr.toFixed(0) + ' grains)');
  await common(s, r, 'CRACKED');
}

(async function main() {
  var s = new H.Suite('app-retime');
  var env = await H.start(), only = env.args.only;
  try {
    if (!env.caps.p1) {
      s.check('RETIME needs the motion path (physics-core P1) in physics.js', false, 'the served sim is P0: shaking moves no sand');
    } else {
      if (!only || only === 'retime') await retime(s, env);
      if (!only || only === 'cracked') await cracked(s, env);
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
