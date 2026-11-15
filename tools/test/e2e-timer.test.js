/*
 * Integration E4 and E5: the timer stays exact under shaking and leaks.
 *
 * E4  A 60 s glass shaken vigorously from 15 to 35 s (real motion.js, iOS
 *     convention): the rate is re-timed exactly once, no fastForward runs
 *     while the shaking is recent, and the last grain leaves within 30 ms of
 *     00:00.0. Variant: a 'normal' shake in the last 8 s: 'done' comes at
 *     00:00.0 within 30 ms of start + 60 s, and the sand still above drains
 *     within 1.5 s after it.
 * E5  A 60 s glass breached in the upper funnel (forceCrack at u ≈ 0.15,
 *     w = 3) at 10 s and shaken ('normal') from 10 to 14 s: sand leaks from
 *     the top, the rate is re-timed at least once, and the end is still on
 *     time (the last grain within 30 ms of 00:00.0, or, if the top ran dry
 *     first, 'done' exactly once at 00:00.0 within 30 ms).
 *
 *   node tools/test/e2e-timer.test.js [--root <dir>] [--port <n>] [--only e4|e4b|e5]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;

var UPPER_FUNNEL = 6;            // upper bulb, left side, u ≈ 0.16

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

/** A glass (60 s unless said) with Real motion on, the phone held still; returns the Date.now() it started at. */
async function startGlass(t, durMs) {
  await t.eval(function (d) { window.Hourglass.setDuration(d); }, durMs || 60000);
  await sleep(900);
  await realMotionOn(t);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); });
  await sleep(1500);
  return t.eval(function () {
    var H = window.Hourglass, w = window.__clk = { mpg: [], dones: 0, startAt: 0, devMax: 0, rate: H.timer.rate };
    __mon.reset();
    H.start();
    w.startAt = Date.now();
    var last = H.timer.mpg, lastState = H.timer.state;
    (function f() {
      if (H.timer.mpg !== last) { w.mpg.push({ t: (Date.now() - w.startAt) / 1000, from: last, to: H.timer.mpg }); last = H.timer.mpg; }
      if (H.timer.state !== lastState) { if (H.timer.state === 'done') w.dones++; lastState = H.timer.state; }
      // how far the sand above the neck strays from what the clock expects (the re-timing threshold is max(3, rate / 2))
      if (H.timer.state === 'running' && H.timer.rem > H.timer.tailMs + 2000) {
        var dev = Math.abs(H.sim.nTop - H.topAt(H.timer.rem));
        if (dev > w.devMax) w.devMax = dev;
      }
      requestAnimationFrame(f);
    })();
    return w.startAt;
  });
}
function shake(t, profile, durS) {
  return t.eval(function (a) {
    window.__drive({ profile: a.p, conv: 'ios', durS: a.d });
    setTimeout(function () { window.__drive({ profile: 'calm', conv: 'ios' }); }, a.d * 1000 + 50);
  }, { p: profile, d: durS });
}
function waitEnd(t) {
  return t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done' && window.Hourglass.sim.nTop === 0; },
                                null, { timeout: 70000, polling: 500 });
}
function result(t) {
  return t.eval(function () {
    var H = window.Hourglass;
    return { clk: window.__clk, ff: __mon.ff, empty: __mon.emptyAt, done: __mon.doneAt, leakedTop: H.sim.leakedTop, lost: H.sim.lost };
  });
}
function fmtMpg(list) {
  return JSON.stringify(list.map(function (c) { return c.t.toFixed(2) + ' s: ' + c.from.toFixed(3) + ' → ' + c.to.toFixed(3); }));
}

async function e4(s, env) {
  var t = await env.open({});
  var start = await startGlass(t);
  await sleep(15000 - (Date.now() - start));
  await shake(t, 'vigorous', 20);
  await waitEnd(t);
  await sleep(500);
  var r = await result(t);
  s.check('E4: mpg changed exactly once (re-timed after the shaking)', r.clk.mpg.length === 1 && r.clk.mpg[0].t > 35, fmtMpg(r.clk.mpg));
  var bad = r.ff.filter(function (c) { return c.motionRecent; });
  s.check('E4: no fastForward while motion was recent', bad.length === 0, r.ff.length + ' calls, ' + bad.length + ' while recent');
  var d = r.empty - r.done;
  s.check('E4: the last grain leaves within 30 ms of 00:00.0', r.empty > 0 && Math.abs(d) <= 30, 'nTop = 0 at ' + d + ' ms from done');
  s.check('E4: 00:00.0 on the wall clock', Math.abs(r.done - start - 60000) <= 30, 'done at start + ' + (r.done - start) + ' ms');
  await H.invariants(s, t, 'E4');
  await t.close();
}

async function e4b(s, env) {
  var t = await env.open({});
  var start = await startGlass(t);
  await sleep(52000 - (Date.now() - start));
  await shake(t, 'normal', 8);
  await waitEnd(t);
  await sleep(500);
  var r = await result(t);
  s.check('E4 variant (normal shake, last 8 s): done at 00:00.0 within 30 ms of start + 60 s', Math.abs(r.done - start - 60000) <= 30 && r.clk.dones === 1,
          'done at start + ' + (r.done - start) + ' ms, ' + r.clk.dones + ' time(s)');
  s.check('E4 variant: the rest of the sand has left within 1.5 s after it', r.empty > 0 && r.empty - r.done <= 1500,
          'nTop = 0 at ' + (r.empty - r.done) + ' ms after done; mpg ' + fmtMpg(r.clk.mpg));
  var bad = r.ff.filter(function (c) { return c.motionRecent; });
  s.check('E4 variant: no fastForward while motion was recent', bad.length === 0, r.ff.length + ' calls, ' + bad.length + ' while recent');
  await H.invariants(s, t, 'E4 variant');
  await t.close();
}

async function e5(s, env) {
  var t = await env.open({});
  var start = await startGlass(t);
  await sleep(10000 - (Date.now() - start));
  var cr = await t.eval(function (seg) {
    var c = window.Hourglass.debug.forceCrack(seg, 40, 3);
    return c ? { bulb: c.bulb, u: c.u, w: c.w } : null;
  }, UPPER_FUNNEL);
  await shake(t, 'normal', 4);
  await waitEnd(t);
  await sleep(500);
  var r = await result(t);
  s.check('E5: an upper-funnel breach (u ≈ 0.15, w = 3)', cr && cr.bulb === 0 && cr.w === 3 && Math.abs(cr.u - 0.15) < 0.05, JSON.stringify(cr));
  s.check('E5: sand leaked from the top', r.leakedTop > 0, 'leakedTop ' + r.leakedTop + ' of ' + r.lost + ' lost');
  s.check('E5: re-timed at least once', r.clk.mpg.length >= 1, r.clk.mpg.length + ' retimes ' + fmtMpg(r.clk.mpg.slice(0, 4)) +
          '; |nTop − topAt(rem)| peaked at ' + r.clk.devMax.toFixed(0) + ' grains against a threshold of ' +
          Math.max(3, 0.5 * r.clk.rate).toFixed(0) + ' (the neck flows ' + r.clk.rate.toFixed(0) + ' grains/s)');
  var d = r.empty - r.done, early = r.empty > 0 && r.empty < r.done - 30;
  var onTime = Math.abs(r.done - start - 60000) <= 30 && r.clk.dones === 1;
  s.check('E5: the end is exact (last grain within 30 ms of 00:00.0, or the top ran dry first and done fired once at 00:00.0)',
          early ? onTime : (Math.abs(d) <= 30 && onTime),
          'nTop = 0 at ' + d + ' ms from done; done at start + ' + (r.done - start) + ' ms, ' + r.clk.dones + ' time(s)');
  var bad = r.ff.filter(function (c) { return c.motionRecent; });
  s.check('E5: no fastForward while motion was recent', bad.length === 0, r.ff.length + ' calls, ' + bad.length + ' while recent');
  await H.invariants(s, t, 'E5');
  await t.close();
}

/**
 * E5b (beyond the spec's list): where a leak does need re-timing. A 45 min
 * glass flows ~8 grains/s, slower than a shaken breach leaks, so the valve
 * cannot absorb it: the sand above falls behind the clock, and once calm
 * the rest of the run is re-timed so the sand that is left lasts the time
 * that is left.
 */
async function e5b(s, env) {
  var t = await env.open({});
  var start = await startGlass(t, 45 * 60000);
  await sleep(3000);
  await t.eval(function (seg) { window.Hourglass.debug.forceCrack(seg, 40, 3); }, UPPER_FUNNEL);
  await shake(t, 'normal', 4);
  await sleep(9000);
  var r = await t.eval(function () {
    var H = window.Hourglass;
    return { clk: window.__clk, leakedTop: H.sim.leakedTop, dev: H.sim.nTop - H.topAt(H.timer.rem), rate: H.timer.rate };
  });
  s.check('E5b (45 min glass): an upper leak faster than the flow is re-timed once calm', r.leakedTop > 0 && r.clk.mpg.length >= 1,
          'leakedTop ' + r.leakedTop + ', ' + r.clk.mpg.length + ' retimes ' + fmtMpg(r.clk.mpg.slice(0, 3)) + ', flow ' + r.rate.toFixed(1) + ' grains/s');
  s.check('E5b: afterwards the sand above matches the clock', Math.abs(r.dev) <= Math.max(3, 0.5 * r.rate) + 1,
          'nTop − topAt(rem) = ' + r.dev.toFixed(1) + ' grains');
  await H.invariants(s, t, 'E5b');
  await t.close();
}

(async function main() {
  var s = new H.Suite('e2e-timer (E4, E5)');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!env.caps.p1) s.check('E4/E5 need the motion path (physics-core P1)', false, 'the served sim is P0');
    else {
      if (!only || only === 'e4') await e4(s, env);
      if (!only || only === 'e4b') await e4b(s, env);
      if (!only || only === 'e5') await e5(s, env);
      if (!only || only === 'e5b') await e5b(s, env);
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
