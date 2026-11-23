/*
 * Integration E4 and E5: the timer stays exact under shaking and leaks.
 *
 * E4  A 60 s glass shaken hard from 15 to 35 s (real motion.js, iOS
 *     convention; 'normal', 2 g at 4.5 Hz, the hardest named shake that
 *     leaves the glass whole): the rate is re-timed at most once and only
 *     after the shaking, the sand above the neck is back within the
 *     re-timing threshold once calm, no fastForward runs while the shaking
 *     is recent, and the last grain leaves within 30 ms of 00:00.0.
 *     (Until the crash work this shook it at 4 g and asked for exactly one
 *     re-timing. That shake now cracks the glass within two seconds, by
 *     intent, and at 2 g the neck keeps up well enough to need none: 13
 *     grains behind at the worst, 8 once calm, against a threshold of 24.
 *     "Exactly once after a hard shake" is still held by app-retime, where
 *     the glass is held whole and the neck falls some 700 grains behind.)
 *     Variant: a 'normal' shake in the last 8 s: 'done' comes at
 *     00:00.0 within 30 ms of start + 60 s, and the sand still above drains
 *     within 1.5 s after it.
 * E5  A 60 s glass breached in the upper funnel (forceCrack at u ≈ 0.15,
 *     w = 3) at 10 s and shaken ('normal') from 10 to 14 s: sand leaks from
 *     the top. A 1 min glass's neck flows far faster than the leak, so the
 *     valve absorbs it: the sand above stays within the re-timing threshold
 *     of the clock throughout, it is re-timed exactly where that is needed
 *     (here: never), the last grain leaves within 30 ms of 00:00.0, and
 *     'done' comes once, at start + 60 s.
 * E5b A 45 min glass (~7 grains/s) with the same breach and shake: the leak
 *     outruns the flow, so once calm (and only then) the rest of the run is
 *     re-timed, after which the sand above matches the clock again.
 *
 *   node tools/test/e2e-timer.test.js [--root <dir>] [--port <n>] [--only e4|e4b|e5|e5b]
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
  await sleep(1400);
  await realMotionOn(t);
  await t.eval(function () { window.__drive({ profile: 'calm', conv: 'ios' }); });
  await sleep(1500);
  return t.eval(function () {
    var H = window.Hourglass, w = window.__clk = {
      mpg: [], dones: 0, startAt: 0, rate: H.timer.rate, shakeEnd: 0,
      devMax: 0, devCalm: 0, devCalmAt: 0, overCalm: 0, thr: Math.max(3, 0.5 * H.timer.rate), dev: 0
    };
    __mon.reset();
    H.start();
    w.startAt = Date.now();
    var last = H.timer.mpg, lastState = H.timer.state;
    (function f() {
      // (this runs after the app's frame, so a re-timing due this frame has already happened)
      if (H.timer.mpg !== last) {
        w.mpg.push({ t: (Date.now() - w.startAt) / 1000, from: last, to: H.timer.mpg, devBefore: w.dev });
        last = H.timer.mpg;
      }
      if (H.timer.state !== lastState) { if (H.timer.state === 'done') w.dones++; lastState = H.timer.state; }
      // How far the sand above the neck strays from what the clock expects.
      // Once calm, anything past the re-timing threshold, max(3, rate / 2),
      // must be re-timed away at once (at most every 0.5 s).
      w.dev = 0;
      if (H.timer.state === 'running' && H.timer.rem > H.timer.tailMs + 2000) {
        var dev = Math.abs(H.sim.nTop - H.topAt(H.timer.rem)), thr = Math.max(3, 0.5 * H.timer.rate);
        w.dev = dev;
        if (dev > w.devMax) w.devMax = dev;
        if (!H.debug.motionRecent) {
          if (dev > w.devCalm) { w.devCalm = dev; w.devCalmAt = (Date.now() - w.startAt) / 1000; }
          if (dev > thr) w.overCalm++;
        }
      }
      requestAnimationFrame(f);
    })();
    return w.startAt;
  });
}
function shake(t, profile, durS) {
  return t.eval(function (a) {
    window.__drive({ profile: a.p, conv: 'ios', durS: a.d });
    setTimeout(function () {
      window.__drive({ profile: 'calm', conv: 'ios' });
      if (window.__clk) window.__clk.shakeEnd = (Date.now() - window.__clk.startAt) / 1000;
    }, a.d * 1000 + 50);
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
  // (A hard shake that does not crack the glass: 'normal', 2 g at 4.5 Hz. It was 'vigorous',
  // 4 g at 5.5 Hz, which since the crash work cracks the glass in two seconds, by intent.)
  await shake(t, 'normal', 20);
  await waitEnd(t);
  await sleep(500);
  var r = await result(t);
  s.note('E4', 'the sand above the neck strayed from the clock by up to ' + r.clk.devMax.toFixed(0) + ' grains (re-timed past ' + r.clk.thr.toFixed(0) +
         ' once calm), ' + r.clk.devCalm.toFixed(0) + ' while calm; ' + r.lost + ' grains lost');
  s.check('E4: re-timed at most once, and only after the shaking; once calm the sand matches the clock',
          r.clk.mpg.length <= 1 && (r.clk.mpg.length === 0 || r.clk.mpg[0].t > 35) && r.clk.overCalm <= 30 && r.lost === 0,
          fmtMpg(r.clk.mpg) + '; ' + r.clk.overCalm + ' calm frames past the threshold');
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
  var c = r.clk;
  s.check('E5: an upper-funnel breach (u ≈ 0.15, w = 3)', cr && cr.bulb === 0 && cr.w === 3 && Math.abs(cr.u - 0.15) < 0.05, JSON.stringify(cr));
  s.check('E5: sand leaked from the top', r.leakedTop > 0, 'leakedTop ' + r.leakedTop + ' of ' + r.lost + ' lost');
  // A 1 min glass's neck flows ~49 grains/s, so the valve simply lets
  // through less while the breach leaks (tens a second shaken, a few at
  // rest): the sand above never strays far from the clock, and there is
  // nothing to re-time. (E5b is the glass where the leak does outrun the
  // flow, and must be re-timed.)
  s.check('E5: the sand above the neck stays with the clock (|nTop − topAt(rem)| ≤ max(3, rate/2), shaken or calm)', c.devMax <= c.thr,
          'peak ' + c.devMax.toFixed(1) + ' grains (calm ' + c.devCalm.toFixed(1) + ') against ' + c.thr.toFixed(1) +
          '; the neck flows ' + c.rate.toFixed(0) + ' grains/s');
  var needed = c.devCalm > c.thr;
  s.check('E5: re-timed exactly where needed (once calm past the threshold, else never)',
          needed ? c.mpg.length >= 1 && c.overCalm <= 60 : c.mpg.length === 0,
          (needed ? 'needed' : 'not needed') + ': ' + c.mpg.length + ' retimes ' + fmtMpg(c.mpg.slice(0, 4)) +
          ', ' + c.overCalm + ' calm frames over the threshold');
  var d = r.empty - r.done;
  s.check('E5: the last grain leaves within 30 ms of 00:00.0', r.empty > 0 && r.done > 0 && Math.abs(d) <= 30, 'nTop = 0 at ' + d + ' ms from done');
  s.check('E5: 00:00.0 on the wall clock, once', Math.abs(r.done - start - 60000) <= 30 && c.dones === 1,
          'done at start + ' + (r.done - start) + ' ms, ' + c.dones + ' time(s)');
  var bad = r.ff.filter(function (q) { return q.motionRecent; });
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
  var c = r.clk;
  s.check('E5b (45 min glass): an upper leak faster than the flow is re-timed once calm', r.leakedTop > 0 && c.mpg.length >= 1,
          'leakedTop ' + r.leakedTop + ', ' + c.mpg.length + ' retimes ' + fmtMpg(c.mpg.slice(0, 3)) + ', flow ' + r.rate.toFixed(1) + ' grains/s');
  // only once calm (never while shaken: that lag is the stutter of the neck), and each one needed
  // (devBefore is a frame old, so it may sit a little under the threshold the re-timing saw)
  var early = c.mpg.filter(function (q) { return !(q.t >= c.shakeEnd + 0.75); });
  var idle = c.mpg.filter(function (q) { return !(q.devBefore > 0.8 * Math.max(3, 500 / q.from)); });
  s.check('E5b: every re-timing came once calm, and only past the threshold', c.shakeEnd > 0 && early.length === 0 && idle.length === 0,
          'shaking ended at ' + c.shakeEnd.toFixed(2) + ' s; first retime at ' + (c.mpg.length ? c.mpg[0].t.toFixed(2) : '–') + ' s; ' +
          early.length + ' too early, ' + idle.length + ' without need');
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
    if (!only || only === 'e4') await e4(s, env);
    if (!only || only === 'e4b') await e4b(s, env);
    if (!only || only === 'e5') await e5(s, env);
    if (!only || only === 'e5b') await e5b(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
