/*
 * A new glass (Reset, another duration): the old sand is drawn into the neck
 * and the new sand is poured in from the top, in about a second.
 *
 *   SWEEP   Reset on a running glass: about a second from the tap; the old
 *           sand leaves the picture (the upper bed first, the heap below it
 *           last), the glass is made new once, in between, and the new sand
 *           rises to the full bed, nothing below the neck; no time passes
 *           meanwhile, and the glass ends idle, full, its census exact
 *   AMOUNT  the sand shows the time: an hour is the full glass, a shorter one
 *           holds less by the square root of its time
 *   KEEP    another duration while the glass runs: it runs on, but only when
 *           the last of the new sand is in (the neck stays shut, the clock
 *           stands at the new time until then)
 *   START   Start, or the glass itself, tapped during the sweep: the glass
 *           starts as the sand is in
 *   AGAIN   another duration chosen while the sand of the last was being
 *           poured: that one's sand and time are what is left
 *   AWAY    the page hidden in the middle: the glass is made at once, and a
 *           glass that is to run runs
 *   REDUCE  with Reduce Motion there is no sweep: the cross-fade, as it was
 *
 * What the picture shows is read from the sand layer itself (#c-sand): its
 * opaque pixels, above and below the neck, frame by frame.
 *
 *   node tools/test/app-reset.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;

/**
 * Watch the page for `ms`, frame by frame, while `act` (a string of page
 * script) does its thing a fifth of a second in. Every frame: the time, the
 * state, the time left, the sand above the neck and in all, the sweep's class,
 * the sand layer's opaque pixels (all, and those above the neck), and how often
 * the glass has been made new.
 */
function watch(t, ms, act, hideAt) {
  return t.eval(function (a) {
    return new Promise(function (done) {
      var H = window.Hourglass, c = document.getElementById('c-sand'), g = c.getContext('2d'), log = [], t0 = performance.now();
      var made = 0, r0 = H.sim.reset;
      H.sim.reset = function () { made++; return r0.apply(this, arguments); };
      var hid = false;
      if (a.hideAt >= 0) {
        Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return hid; } });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return hid ? 'hidden' : 'visible'; } });
        setTimeout(function () { hid = true; document.dispatchEvent(new Event('visibilitychange')); }, a.hideAt);
        setTimeout(function () { hid = false; document.dispatchEvent(new Event('visibilitychange')); }, a.hideAt + 60);
      }
      setTimeout(function () { (new Function('H', a.act))(H); }, 200);
      (function frame() {
        var d = g.getImageData(0, 0, c.width, c.height).data, n = 0, up = 0, bed = 0, half = (c.height >> 1) * c.width * 4, w = c.width, mid = w >> 1, x;
        for (var i = 3; i < d.length; i += 4) if (d[i] > 0) {
          n++;
          if (i < half) { up++; x = ((i - 3) >> 2) % w; if (x < mid - 8 || x > mid + 8) bed++; }   // (bed: clear of the thread on the axis)
        }
        log.push({ t: performance.now() - t0, st: H.timer.state, rem: H.timer.rem, top: H.sim.nTop, tot: H.sim.total,
                   sw: document.getElementById('app').classList.contains('sweep'), swap: document.getElementById('app').classList.contains('swap'),
                   px: n, up: up, bed: bed, made: made });
        if (performance.now() - t0 < a.ms) requestAnimationFrame(frame);
        else { H.sim.reset = r0; done(log); }
      })();
    });
  }, { ms: ms, act: act, hideAt: hideAt === undefined ? -1 : hideAt });
}
function span(log) {
  var a = -1, b = -1, i;
  for (i = 0; i < log.length; i++) if (log[i].sw) { if (a < 0) a = i; b = i; }
  return { from: a, to: b, ms: a < 0 ? 0 : log[Math.min(b + 1, log.length - 1)].t - log[a].t };
}
function censusOk(t) {
  return t.eval(function () { var s = window.Hourglass.sim, c = s.census(); return c.total === s.total && c.top === s.nTop; });
}
async function running(env, opts, secs, ms) {
  var t = await env.open(opts || {});
  await sleep(900);
  await t.eval(function (d) { window.Hourglass.setDuration(d); }, ms || 60000);
  await sleep(2400);
  var g = await t.glass();
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(secs * 1000);
  return t;
}

async function run(s, env) {
  /* ---- SWEEP -------------------------------------------------------------- */
  var t = await running(env, {}, 15);
  try {
    var want = await t.eval(function () { return window.Hourglass.grainsFor(60000); });
    var log = await watch(t, 2400, 'H.reset(false);');
    var sp = span(log), a = log[sp.from], last = log[log.length - 1], i, e;
    s.check('SWEEP: Reset takes about a second, from the tap to the last of the new sand', sp.from >= 0 && sp.ms >= 850 && sp.ms <= 1300,
            sp.from < 0 ? 'no sweep seen' : Math.round(sp.ms) + ' ms, ' + (sp.to - sp.from + 1) + ' frames');
    // the glass is made new once, in between: the frame it happens, and what the picture shows around it
    var turn = -1;
    for (i = sp.from; i <= sp.to; i++) if (log[i].made > 0) { turn = i; break; }
    var madeOnce = last.made === 1 && turn > sp.from && turn < sp.to;
    s.check('SWEEP: the glass is made new once, between the two halves', madeOnce,
            'made ' + last.made + ' time(s), ' + (turn < 0 ? 'not inside the sweep' : Math.round(log[turn].t - a.t) + ' ms into it'));
    var upGone = -1, allGone = -1, least = Infinity;
    for (i = sp.from; i < turn; i++) {
      if (upGone < 0 && log[i].up <= 0.01 * a.up) upGone = i;
      if (allGone < 0 && log[i].px <= 0.01 * a.px) allGone = i;
      if (log[i].px < least) least = log[i].px;
    }
    var fell = true;
    for (i = sp.from + 1; i < turn; i++) if (log[i].px > log[i - 1].px + 0.02 * a.px) fell = false;
    s.check('SWEEP: the old sand leaves the picture: less with every frame, the upper bed gone first, the heap below it last',
            fell && upGone > sp.from && upGone < turn && log[upGone].px - log[upGone].up > 0.02 * a.px && log[turn].px <= 0.01 * a.px,
            a.px + ' px of sand; the upper bed gone ' + (upGone < 0 ? 'never' : Math.round(log[upGone].t - a.t) + ' ms in, with ' + (log[upGone].px - log[upGone].up) + ' px still below') +
            '; ' + log[turn].px + ' px as the glass is made new');
    // (the bed is read clear of the axis: the thread that falls there flickers, and ends before the bed is level)
    var rose = true, below = 0, full = last.px;
    for (i = turn + 1; i <= sp.to; i++) {
      if (log[i].bed < log[i - 1].bed - 0.02 * last.bed) rose = false;
      if (log[i].px - log[i].up > below) below = log[i].px - log[i].up;
    }
    var mid = log[Math.round((turn + sp.to) / 2)];
    s.check('SWEEP: the new sand is poured: it rises with every frame to the full bed, and nothing shows below the neck',
            rose && below === 0 && mid.px > 0.15 * full && mid.px < 0.85 * full && Math.abs(log[sp.to].px - full) <= 0.03 * full,
            'half way ' + mid.px + ' px, at the end ' + log[sp.to].px + ', the full bed ' + full + '; below the neck ' + below);
    var stood = true, shut = true;
    for (i = sp.from + 1; i <= sp.to; i++) {
      e = log[i];
      if (i < turn && e.rem !== log[sp.from].rem) stood = false;
      if (i > turn && e.rem !== 60000) stood = false;
      if (i < turn && (e.top !== log[sp.from].top || e.tot !== log[sp.from].tot)) shut = false;
      if (i >= turn && (e.top !== want || e.tot !== want)) shut = false;
    }
    s.check('SWEEP: no time passes meanwhile, and no sand moves through the neck', stood && shut,
            'the clock at ' + (log[sp.from].rem / 1000).toFixed(2) + ' s until the glass is made new, then at 60.00; ' + log[sp.from].top + ' grains above, then ' + want);
    s.check('SWEEP: the glass ends idle and full, at its whole time, its census exact',
            last.st === 'idle' && last.rem === 60000 && last.top === want && last.tot === want && !last.sw && await censusOk(t),
            last.st + ', ' + (last.rem / 1000).toFixed(1) + ' s, ' + last.top + ' of ' + last.tot + ' grains above the neck');

    /* ---- AMOUNT: the sand shows the time ----------------------------------- */
    var am = await t.eval(function () {
      var H = window.Hourglass, cap = H.sim.capacity, f = function (min) { return H.grainsFor(min * 60000) / cap; };
      return { m1: f(1), m4: f(4), m5: f(5), m10: f(10), m15: f(15), m16: f(16), m30: f(30), m60: f(60), m64: f(64), m99: f(99), s10: f(1 / 6), held: H.sim.total / cap };
    });
    var near = function (a, b) { return Math.abs(a - b) < 0.002; };
    s.check('AMOUNT: an hour is the full glass, and a shorter one holds less by the square root of its time',
            near(am.m60, 0.78) && near(am.m1, 0.78 * Math.sqrt(1 / 60)) && near(am.m5, 0.78 * Math.sqrt(5 / 60)) && near(am.m10, 0.78 * Math.sqrt(10 / 60)) &&
            near(am.m15, 0.39) && near(am.m30, 0.78 * Math.sqrt(0.5)) && near(am.held, am.m1),
            'of a bulb: 1 min ' + am.m1.toFixed(3) + ', 5 min ' + am.m5.toFixed(3) + ', 10 min ' + am.m10.toFixed(3) + ', 15 min ' + am.m15.toFixed(3) +
            ', 30 min ' + am.m30.toFixed(3) + ', 60 min ' + am.m60.toFixed(3) + '; the one-minute glass in hand ' + am.held.toFixed(3));
    s.check('AMOUNT: four times the time is twice the sand; over an hour the glass stays full; ten seconds is still a glass',
            near(am.m4 / am.m1, 2) && near(am.m16 / am.m4, 2) && near(am.m64, 0.78) && near(am.m99, 0.78) && am.s10 > 0.03 && am.s10 < 0.05,
            '4 min / 1 min ' + (am.m4 / am.m1).toFixed(3) + ', 16 / 4 ' + (am.m16 / am.m4).toFixed(3) + ', 64 min ' + am.m64.toFixed(3) + ', 99 min ' + am.m99.toFixed(3) + ', 10 s ' + am.s10.toFixed(3));

    /* ---- KEEP: another duration while it runs ------------------------------ */
    var g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(5000);
    var want2 = await t.eval(function () { return window.Hourglass.grainsFor(120000); });
    log = await watch(t, 2600, 'H.setDuration(120000);');
    sp = span(log); last = log[log.length - 1];
    var held = true, runs = true, endT = log[Math.min(sp.to + 1, log.length - 1)].t;
    turn = -1;
    for (i = sp.from; i <= sp.to; i++) if (log[i].made > 0) { turn = i; break; }
    for (i = turn; i <= sp.to; i++) if (log[i].st !== 'running' || log[i].rem !== 120000 || log[i].top !== want2) held = false;
    for (i = sp.to + 12; i < log.length; i++) if (log[i].st !== 'running' || log[i].rem >= log[i - 1].rem + 1e-6) runs = false;
    s.check('KEEP: another duration while it runs: the neck stays shut and the clock at the new time until the last of the sand is in',
            sp.from >= 0 && turn > sp.from && held && last.made === 1, 'made new ' + (turn < 0 ? 'never' : Math.round(log[turn].t - log[sp.from].t) + ' ms in') +
            ', ' + want2 + ' grains, ' + (log[sp.to].rem / 1000).toFixed(2) + ' s as the sweep ends');
    s.check('KEEP: … and then it runs: by its own clock from that moment', runs && last.st === 'running' && last.top < want2 &&
            Math.abs((120000 - last.rem) - (last.t - endT)) < 120,
            (last.t - endT).toFixed(0) + ' ms after the sweep ' + ((120000 - last.rem)).toFixed(0) + ' ms have run, ' + (want2 - last.top) + ' grains through');

    /* ---- START: tapped during the sweep ------------------------------------- */
    await t.eval(function () { window.Hourglass.pause(); });
    await sleep(400);
    log = await watch(t, 2600, 'H.reset(false); setTimeout(function () { H.start(); }, 450);');
    sp = span(log); last = log[log.length - 1];
    var early = false;
    for (i = sp.from; i <= sp.to; i++) if (log[i].st === 'running' || (log[i].made > 0 && log[i].rem !== 120000)) early = true;
    s.check('START: tapped during the sweep, the glass starts as the sand is in, not before', sp.from >= 0 && !early && last.st === 'running' && last.rem < 120000 && last.rem > 118000,
            'idle through the sweep: ' + !early + '; ' + last.st + ' with ' + (last.rem / 1000).toFixed(2) + ' s left at the end');

    // … and so does a finger's tap on the glass itself
    await t.eval(function () { window.Hourglass.pause(); });
    await sleep(400);
    await t.eval(function () { window.Hourglass.reset(false); });
    await sleep(450);
    g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    var tapMid = await t.eval(function () { return { st: window.Hourglass.timer.state, sw: document.getElementById('app').classList.contains('sweep') }; });
    await sleep(1300);
    var tapEnd = await t.eval(function () { return { st: window.Hourglass.timer.state, rem: window.Hourglass.timer.rem, sw: document.getElementById('app').classList.contains('sweep') }; });
    s.check('START: a finger\'s tap on the glass during the sweep does the same', tapMid.sw && tapMid.st === 'idle' && tapEnd.st === 'running' && !tapEnd.sw && tapEnd.rem < 120000 && tapEnd.rem > 118000,
            'at the tap: ' + tapMid.st + ', sweeping ' + tapMid.sw + '; 1.3 s later ' + tapEnd.st + ' with ' + (tapEnd.rem / 1000).toFixed(2) + ' s left');

    /* ---- AGAIN: another duration during the pour ---------------------------- */
    await t.eval(function () { window.Hourglass.pause(); });
    await sleep(400);
    var want3 = await t.eval(function () { return window.Hourglass.grainsFor(300000); });
    log = await watch(t, 3600, 'H.setDuration(60000); setTimeout(function () { H.setDuration(300000); }, 650);');
    last = log[log.length - 1];
    s.check('AGAIN: another duration chosen while the last one\'s sand was being poured: its sand and its time are what is left',
            last.made === 2 && last.st === 'idle' && last.rem === 300000 && last.top === want3 && last.tot === want3 && !last.sw && await censusOk(t),
            'made new ' + last.made + ' times; ' + (last.rem / 1000).toFixed(0) + ' s, ' + last.top + ' grains (a five-minute glass holds ' + want3 + ')');

    /* ---- AWAY: the page hidden in the middle -------------------------------- */
    await t.eval(function () { window.Hourglass.setDuration(60000); });
    await sleep(2400);
    g = await t.glass();
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(3000);
    log = await watch(t, 1800, 'H.setDuration(120000);', 380);
    last = log[log.length - 1];
    var after = null;
    for (i = 0; i < log.length; i++) if (log[i].t > 380 + 80) { after = log[i]; break; }
    s.check('AWAY: hidden in the middle of a sweep, the glass is made at once; one that is to run runs',
            !!after && !after.sw && after.made === 1 && after.top <= want2 && after.tot === want2 && last.st === 'running' && last.rem < 120000 && last.rem > 118000 && !last.sw,
            after ? 'a moment after: sweep ' + after.sw + ', made ' + after.made + ', ' + after.tot + ' grains; at the end ' + last.st + ', ' + (last.rem / 1000).toFixed(2) + ' s left' : 'no frame after the page was hidden');
    await H.invariants(s, t, 'RESET');
  } finally {
    await t.close();
  }

  /* ---- REDUCE --------------------------------------------------------------- */
  t = await running(env, { reducedMotion: true }, 6);
  try {
    log = await watch(t, 1800, 'H.reset(false);');
    last = log[log.length - 1];
    var swept = false, faded = false;
    for (i = 0; i < log.length; i++) { if (log[i].sw) swept = true; if (log[i].swap) faded = true; }
    s.check('REDUCE: with Reduce Motion there is no sweep: the cross-fade, and the same glass at the end',
            !swept && faded && last.made === 1 && last.st === 'idle' && last.rem === 60000 && last.top === last.tot && await censusOk(t),
            'sweep ' + swept + ', cross-fade ' + faded + '; ' + last.st + ', ' + last.top + ' of ' + last.tot + ' grains above');
    await H.invariants(s, t, 'REDUCE');
  } finally {
    await t.close();
  }
}

async function main() {
  var s = new H.Suite('app-reset');
  var env = await H.start();
  try {
    await run(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
}

module.exports = { run: run };
if (require.main === module) main();
