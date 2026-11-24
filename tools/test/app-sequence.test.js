/*
 * Work and rest: a custom glass followed by a rest, the pair repeated, with
 * the glass turning itself over between them.
 *
 *  UI      the Custom duration sheet: "Then rest" (Off, 1 to 60 min) and,
 *          once a rest is set, "Rounds" (1 to 12) in the hint's place, so
 *          nothing in the sheet moves; what the Set button and the Custom
 *          pill say, shown and spoken; it fits at 360 px; a preset ends the
 *          sequence; the main screen has no new buttons.
 *  RUN     12 s work, 10 s rest, twice, watched, with Full Zen: every phase
 *          lasts its own length on the wall clock and its last grain leaves
 *          at 00:00.0; between phases a soft bowl (0.75 s on), then the Flip
 *          button's 2.6 s turn (1.2 s on), and the next phase starts as it
 *          ends, timed to its own length; the status line names the phase;
 *          the controls stay dim throughout; the last phase ends as any glass
 *          does; started again, the sequence begins from its first glass;
 *          Reset: not started.
 *  PHASE   pause and resume inside a phase; the Flip button swaps the time
 *          within the phase and skips none; paused during the turn, the next
 *          phase waits at its full time; paused before it, the turn waits;
 *          Reset; a preset ends the sequence.
 *  CLOCK   25 min and 5 min, three times, with the clock moved on: asleep
 *          through two phase ends (the right phase, the right time, the sand
 *          agrees, one bowl at most, no turn drawn); a watched phase end; one
 *          that passes while the page is hidden but alive (a crack turns with
 *          the glass); asleep past the end.
 *  RELOAD  a paused and a running sequence come back after a reload, also
 *          when phases ran out meanwhile, or when it was left paused between
 *          two phases; another sequence's session does not.
 *  CALM    Reduce Motion: no turn, the sand fades across in the same time;
 *          with the Completion bowl off, no bowl.
 *  REVIEW  the page hidden during the gap between two phases: one bowl, not
 *          two; on short screens a sequence's phase line is still there for
 *          a screen reader, and on screen in landscape.
 *
 *   node tools/test/app-sequence.test.js [--root <dir>] [--port <n>] [--only ui|run|phase|clock|reload|calm|review]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;

var BOWL = 750, SETTLE = 1200, TURN = 2600, GAP = SETTLE + TURN;      // app.js: SEQ_BOWL, SEQ_SETTLE, SEQ_TURN
var SKEY = 'hourglass.session.v1', KEY = 'hourglass.settings.v1';

/** Runs before the page's scripts: Date.now() can be moved on (window.__jump), also across a reload (__skewNext). */
function skewInit() {
  var real = Date.now;
  var skew = (+sessionStorage.getItem('__skew') || 0) + (+sessionStorage.getItem('__skewNext') || 0);
  sessionStorage.removeItem('__skewNext');
  sessionStorage.setItem('__skew', String(skew));
  Date.now = function () { return real.call(Date) + skew; };
  window.__jump = function (ms) { skew += ms; sessionStorage.setItem('__skew', String(skew)); };
  // the page as the app sees it when it is not on screen
  window.__hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return window.__hidden; } });
  window.__hide = function (on) { window.__hidden = !!on; document.dispatchEvent(new Event('visibilitychange')); };
}

/** Watch a sequence from inside the page: bowls, phases, the gaps between them, Zen. → window.__seq */
function watch(t) {
  return t.eval(function () {
    var H = window.Hourglass, app = document.getElementById('app'), st = document.getElementById('status');
    var hud = document.getElementById('hud-top');
    var w = window.__seq = {
      chimes: [], bells: [], phases: [], gaps: [], status: [], empty: {}, doneAt: -1,
      zenAt: -1, zenLost: 0, scriptTurns: 0, audio: false
    };
    var chime = H.audio.chime, bell = H.audio._bell;
    H.audio.chime = function (delay, soft) {
      w.chimes.push({ t: Date.now(), delay: delay || 0, soft: !!soft, hidden: document.hidden, phase: H.seq.phase });
      return chime.apply(H.audio, arguments);
    };
    H.audio._bell = function (t0, f0, level, decay) {
      w.bells.push({ t: Date.now(), f0: f0, level: level, decay: decay });
      return bell.apply(H.audio, arguments);
    };
    // when the upper bulb first stood empty in each phase, noted after the physics step that emptied it (as __mon does)
    var step = H.sim.step;
    H.sim.step = function () {
      step.call(H.sim);
      var k = Math.min(H.seq.phase, 2 * H.seq.rounds - 1);
      if (H.sim.nTop === 0 && w.empty[k] === undefined && H.timer.state !== 'idle') w.empty[k] = Date.now();
    };
    var last = { phase: H.seq.phase, gap: 0, flip: false, status: '', state: H.timer.state }, g = null;
    (function f() {
      // (after the app's own frame)
      var now = Date.now(), ph = H.seq.phase, gap = H.seq.gap, fl = H.flip.active, s = H.timer.state, zen = app.classList.contains('zen');
      if (H.audio.isRunning()) w.audio = true;
      if (st.textContent !== last.status) { last.status = st.textContent; w.status.push(last.status); }
      if (gap && !last.gap) {
        g = { phase: ph, at: gap, seen: now, turn0: -1, turn1: -1, end: -1, pass: false, mode: '', hud: -1, zen: true,
              dur: 0, to: 0, s0: 0, p0: 0, s1: 0, p1: 0 };
        w.gaps.push(g);
      }
      if (g && g.end < 0) {
        if (fl && g.turn0 < 0) {
          g.turn0 = now; g.mode = H.flip.mode; g.dur = H.flip.dur; g.to = H.flip.to;
          g.s0 = __mon.steps; g.p0 = H.flip.prog;
        }
        if (fl) { g.s1 = __mon.steps; g.p1 = H.flip.prog; }       // (the turn advances with the physics steps)
        if (!fl && last.flip && g.turn1 < 0) { g.turn1 = now; g.hud = +getComputedStyle(hud).opacity; }
        if (app.classList.contains('pass')) g.pass = true;
        if (!zen) g.zen = false;
        if (!gap) g.end = now;
      }
      if (fl && !last.flip && H.flip.mode === 'script') w.scriptTurns++;
      if (ph !== last.phase) {
        var len = (ph & 1) ? H.seq.rest : H.timer.durationMs;
        w.phases.push({ t: now, from: last.phase, phase: ph, rem: H.timer.rem, state: s, top: H.sim.nTop, total: H.sim.total,
                        began: H.timer.lastTick - (len - H.timer.rem), want: H.topAt(len), rate: H.timer.rate,
                        status: st.textContent, flips: __mon.flips, flip: fl });
      }
      if (s === 'done' && last.state !== 'done') w.doneAt = now;
      if (zen && w.zenAt < 0) w.zenAt = now;
      if (w.zenAt >= 0 && s === 'running' && !zen) w.zenLost++;
      last.phase = ph; last.gap = gap; last.flip = fl; last.state = s;
      requestAnimationFrame(f);
    })();
  });
}
function seen(t) { return t.eval(function () { return window.__seq; }); }
function snap(t) {
  return t.eval(function () {
    var H = window.Hourglass, T = H.timer;
    return {
      now: Date.now(), tick: T.lastTick, state: T.state, rem: T.rem, durationMs: T.durationMs, rate: T.rate,
      phase: H.seq.phase, gap: H.seq.gap, rest: H.seq.rest, rounds: H.seq.rounds,
      top: H.sim.nTop, total: H.sim.total, want: H.topAt(T.rem), full: H.grainsFor(T.durationMs),
      flip: H.flip.active, flips: __mon.flips,
      status: document.getElementById('status').textContent, main: document.getElementById('t-main').textContent,
      label: document.getElementById('custom-label').textContent,
      zen: document.getElementById('app').classList.contains('zen'),
      cracks: H.sim.cracks.map(function (c) { return c.bulb; })
    };
  });
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
/**
 * How long the turn seen in gap record q is, at the pace it kept: it advances with the physics steps (120 a second),
 * so steps × 8.33 ms over the progress they made. On the wall clock it is as long wherever frames keep up; software
 * rendering, at the full Zen size or on a busy machine, does not always.
 */
function paced(q) { return Math.round((q.s1 - q.s0) * (1000 / 120) / (q.p1 - q.p0)); }
function waitFor(t, fn, ms, arg) { return t.page.waitForFunction(fn, arg, { timeout: ms || 15000, polling: 50 }); }

/* ---------------------------------------------------------------------- */

async function testUi(s, env) {
  var t = await env.open({});
  await t.page.tap('#pill-custom');
  await sleep(800);
  function sheet() {
    return t.eval(function () {
      function box(el) { var r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }
      var set = document.getElementById('custom-set');
      var b = {};
      Array.prototype.forEach.call(document.querySelectorAll('#seq button'), function (el) {
        b[el.dataset.seq] = { label: el.getAttribute('aria-label'), off: el.getAttribute('aria-disabled') === 'true', shown: el.offsetParent !== null };
      });
      return {
        rest: document.getElementById('rest-out').textContent, rounds: document.getElementById('rounds-out').textContent,
        hint: !document.getElementById('seq-hint').hidden, roundsRow: !document.getElementById('rounds-row').hidden,
        set: set.textContent, aria: set.getAttribute('aria-label'), b: b,
        sheet: box(document.getElementById('sheet-custom')), plus: box(document.querySelector('#seq [data-seq="rest:1"]')),
        setBox: box(set), dial: box(document.querySelector('#sheet-custom .dial')),
        groups: Array.prototype.map.call(document.querySelectorAll('#seq [role="group"]'), function (el) {
          return document.getElementById(el.getAttribute('aria-labelledby')).textContent;
        }),
        live: [document.getElementById('rest-out').getAttribute('aria-live'), document.getElementById('rounds-out').getAttribute('aria-live')]
      };
    });
  }
  var a = await sheet();
  s.check('UI: rest is Off by default, no Rounds, a hint in its place', a.rest === 'Off' && a.hint && !a.roundsRow && !a.b['rounds:1'].shown,
          JSON.stringify({ rest: a.rest, hint: a.hint, rounds: a.roundsRow }));
  s.check('UI: with rest Off the Set button reads as it did', a.set === 'Set 05:00' && a.aria === null, '"' + a.set + '", aria-label ' + a.aria);
  s.check('UI: the steppers are named groups with labelled buttons and live values',
          a.groups.join('|') === 'Then rest|Rounds' && a.b['rest:-1'].label === 'One minute less rest' && a.b['rest:1'].label === 'One minute more rest' &&
          a.b['rounds:-1'].label === 'One round fewer' && a.b['rounds:1'].label === 'One round more' && a.live.join() === 'polite,polite',
          JSON.stringify(a.groups) + ' ' + JSON.stringify(a.live));
  s.check('UI: at Off, "less rest" is marked unavailable', a.b['rest:-1'].off && !a.b['rest:1'].off);
  for (var i = 0; i < 3; i++) { await t.page.tap('#seq [data-seq="rest:1"]'); await sleep(90); }
  await sleep(250);
  var b = await sheet();
  s.check('UI: three taps on + give a 3 min rest, and Rounds (1) appears', b.rest === '3 min' && b.roundsRow && !b.hint && b.rounds === '1' && b.b['rounds:-1'].off,
          JSON.stringify({ rest: b.rest, rounds: b.rounds, row: b.roundsRow, hint: b.hint }));
  s.check('UI: nothing in the sheet moved when Rounds appeared', a.sheet.join() === b.sheet.join() && a.plus.join() === b.plus.join() &&
          a.setBox.join() === b.setBox.join() && a.dial.join() === b.dial.join(), JSON.stringify({ sheet: [a.sheet, b.sheet], plus: [a.plus, b.plus] }));
  s.check('UI: Set says the rest, shown and spoken', b.set === 'Set 05:00, rest 3' && b.aria === 'Set 5 minutes, then rest 3 minutes', '"' + b.set + '" / "' + b.aria + '"');
  await t.page.tap('#seq [data-seq="rounds:1"]');
  await sleep(300);
  var c = await sheet();
  s.check('UI: ... and the rounds', c.rounds === '2' && c.set === 'Set 05:00, rest 3, ×2' && c.aria === 'Set 5 minutes, then rest 3 minutes, 2 rounds',
          '"' + c.set + '" / "' + c.aria + '"');
  // the ends of both steppers
  var lim = await t.eval(function () {
    function tap(sel, n) { var el = document.querySelector('#seq [data-seq="' + sel + '"]'); for (var i = 0; i < n; i++) el.click(); }
    function v() { return [document.getElementById('rest-out').textContent, document.getElementById('rounds-out').textContent]; }
    function off(sel) { return document.querySelector('#seq [data-seq="' + sel + '"]').getAttribute('aria-disabled') === 'true'; }
    var out = {};
    tap('rest:1', 70); tap('rounds:1', 20);
    out.max = v(); out.maxOff = off('rest:1') && off('rounds:1');
    tap('rounds:-1', 20); out.one = v()[1]; out.oneOff = off('rounds:-1');
    tap('rest:-1', 70); out.min = v()[0]; out.hidden = document.getElementById('rounds-row').hidden;
    tap('rest:1', 3); tap('rounds:1', 1);
    out.back = v();
    return out;
  });
  s.check('UI: rest stops at 60 min and Off, rounds at 12 and 1', lim.max.join() === '60 min,12' && lim.maxOff && lim.one === '1' && lim.oneOff &&
          lim.min === 'Off' && lim.hidden && lim.back.join() === '3 min,2', JSON.stringify(lim));
  // held, a stepper runs on; the lift adds no step, and a tap after it is one step again
  var plus = await t.page.$eval('#seq [data-seq="rest:1"]', function (el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await t.touch.down(plus.x, plus.y);
  await sleep(1150);
  var h0 = parseInt((await sheet()).rest, 10);
  await t.touch.up();
  await sleep(450);
  var h1 = parseInt((await sheet()).rest, 10);
  await t.page.tap('#seq [data-seq="rest:-1"]');
  await sleep(200);
  var h2 = parseInt((await sheet()).rest, 10);
  s.check('UI: held, a stepper runs on (about nine a second after a moment); a tap is one step', h0 >= 6 && h0 <= 13 && h1 >= h0 && h1 <= h0 + 1 && h2 === h1 - 1,
          '3 → ' + h0 + ' min while held, ' + h1 + ' after the lift, ' + h2 + ' after a tap on −');
  await t.eval(function (n) { var el = document.querySelector('#seq [data-seq="rest:-1"]'); for (var i = 0; i < n; i++) el.click(); }, h2 - 3);
  await sleep(200);
  await t.page.tap('#custom-set');
  await sleep(1100);
  var m = await t.eval(function (key) {
    var H = window.Hourglass, p = document.getElementById('pill-custom'), st = JSON.parse(localStorage.getItem(key));
    return {
      rest: H.seq.rest, rounds: H.seq.rounds, phase: H.seq.phase, ms: H.timer.durationMs, rem: H.timer.rem, state: H.timer.state,
      label: document.getElementById('custom-label').textContent, aria: p.getAttribute('aria-label'), pressed: p.getAttribute('aria-pressed'),
      checked: document.querySelectorAll('#durations .pill[aria-checked="true"]').length,
      status: document.getElementById('status').textContent, saved: [st.durationMs, st.restMs, st.rounds],
      top: document.querySelectorAll('#hud-top button').length, bottom: document.querySelectorAll('#hud-bottom button').length,
      rows: document.querySelectorAll('#sheet-settings .row').length
    };
  }, KEY);
  s.check('UI: Set makes the sequence (5 min, rest 3 min, twice), not started', m.ms === 300000 && m.rest === 180000 && m.rounds === 2 && m.phase === 0 &&
          m.state === 'idle' && m.rem === 300000 && m.status === 'Tap the glass to begin', JSON.stringify(m));
  s.check('UI: the Custom pill says it, shown and spoken; no preset is selected', m.label === '5·3 ×2' && m.pressed === 'true' && m.checked === 0 &&
          m.aria === 'Custom duration: 5 minutes, then rest 3 minutes, 2 rounds', '"' + m.label + '" / "' + m.aria + '"');
  s.check('UI: the sequence is kept in the settings', m.saved.join() === '300000,180000,2', m.saved.join());
  s.check('UI: no new buttons on the main screen (4 top, one of them hidden; 12 bottom), and no Tune row of its own (11, with Layered sand, Grain, Real sand, Breathing pace and the custom sand\'s colour)', m.top === 4 && m.bottom === 12 && m.rows === 11,
          JSON.stringify({ top: m.top, bottom: m.bottom, rows: m.rows }));

  // it fits at 360 px: the usual sequence and the longest one
  await t.page.setViewportSize({ width: 360, height: 740 });
  var fits = [];
  var cases = [[1500000, 300000, 4, '25·5 ×4'], [3000000, 600000, 4, '50·10 ×4'], [90000, 300000, 1, '1:30·5'], [5999000, 3600000, 12, '99:59·60 ×12']];
  for (i = 0; i < cases.length; i++) {
    await t.eval(function (q) { window.Hourglass.setDuration(q[0], q[1], q[2]); }, cases[i]);
    await sleep(1400);
    var f = await t.eval(function () {
      var p = document.getElementById('pill-custom').getBoundingClientRect(), d = document.getElementById('durations').getBoundingClientRect();
      var panel = document.querySelector('#hud-bottom .panel').getBoundingClientRect();
      var pills = document.querySelectorAll('#durations .pill'), lastPill = pills[pills.length - 1].getBoundingClientRect();
      var lab = document.getElementById('custom-label');
      return { label: lab.textContent, pillIn: p.right <= panel.right - 8 && p.left >= d.right - 1, presets: lastPill.right <= d.right + 0.5,
               whole: lab.scrollWidth <= lab.clientWidth + 1 || lab.getBoundingClientRect().right <= p.right };
    });
    fits.push(f);
  }
  s.check('UI: at 360 px the pill shows "25·5 ×4", "50·10 ×4", "1:30·5" and the longest whole, all six presets still in view',
          fits.every(function (q, k) { return q.label === cases[k][3] && q.pillIn && q.presets && q.whole; }), JSON.stringify(fits));
  await t.page.tap('#pill-custom');
  await sleep(800);
  var w = await t.eval(function () {
    var set = document.getElementById('custom-set').getBoundingClientRect(), tx = document.getElementById('custom-preview').getBoundingClientRect();
    var seq = document.getElementById('seq').getBoundingClientRect(), sheet = document.getElementById('sheet-custom').getBoundingClientRect();
    var body = document.querySelector('#sheet-custom .sheet-body');
    return { text: document.getElementById('custom-set').textContent, inside: tx.left >= set.left + 12 && tx.right <= set.right - 12,
             seqIn: seq.left >= 0 && seq.right <= 360, sheetTop: sheet.top, scrolls: body.scrollHeight > body.clientHeight + 1,
             rest: document.getElementById('rest-out').textContent, rounds: document.getElementById('rounds-out').textContent };
  });
  s.check('UI: at 360 px the longest Set label fits its button, and the sheet shows what is set', w.text === 'Set 99:59, rest 60, ×12' && w.inside && w.seqIn &&
          w.sheetTop > 0 && !w.scrolls && w.rest === '60 min' && w.rounds === '12', JSON.stringify(w));
  await t.page.tap('#sheet-custom .sheet-close');
  await sleep(700);
  await t.page.setViewportSize({ width: 390, height: 844 });
  await sleep(300);

  // a preset ends the sequence
  await t.page.tap('#durations .pill[data-min="5"]');
  await sleep(1400);
  var p = await t.eval(function (key) {
    var H = window.Hourglass, pc = document.getElementById('pill-custom'), st = JSON.parse(localStorage.getItem(key));
    return { rest: H.seq.rest, rounds: H.seq.rounds, ms: H.timer.durationMs, label: document.getElementById('custom-label').textContent,
             aria: pc.getAttribute('aria-label'), pressed: pc.getAttribute('aria-pressed'), cls: pc.className,
             five: document.querySelector('#durations .pill[data-min="5"]').getAttribute('aria-checked'), saved: [st.restMs, st.rounds] };
  }, KEY);
  s.check('UI: choosing a preset ends the sequence', p.rest === 0 && p.rounds === 1 && p.ms === 300000 && p.label === 'Custom' && p.aria === 'Custom duration' &&
          p.pressed === 'false' && p.five === 'true' && p.saved.join() === '0,1' && !/seq|long/.test(p.cls), JSON.stringify(p));
  await t.page.tap('#pill-custom');
  await sleep(800);
  var o = await sheet();
  s.check('UI: ... and the sheet is back at Off', o.rest === 'Off' && o.hint && !o.roundsRow && o.set === 'Set 05:00' && o.aria === null, JSON.stringify({ rest: o.rest, set: o.set }));
  // a custom time with rest Off is a plain glass, as it always was
  await t.page.tap('#sheet-custom .step[data-step="min:+1"]');
  await sleep(500);
  await t.page.tap('#custom-set');
  await sleep(1000);
  var q = await t.eval(function () { var H = window.Hourglass; return { ms: H.timer.durationMs, rest: H.seq.rest, label: document.getElementById('custom-label').textContent,
                                                                      aria: document.getElementById('pill-custom').getAttribute('aria-label') }; });
  s.check('UI: a custom time with rest Off is a plain glass', q.ms === 360000 && q.rest === 0 && q.label === '06:00' && q.aria === 'Custom duration', JSON.stringify(q));
  await H.invariants(s, t, 'UI');
  await t.close();
}

/* ---------------------------------------------------------------------- */

async function testRun(s, env) {
  var storage = {};
  storage[KEY] = { zenFull: true };
  var t = await env.open({ storage: storage });
  var WORK = 12000, REST = 10000;
  await t.eval(function (a) { window.Hourglass.setDuration(a[0], a[1], 2); }, [WORK, REST]);
  await sleep(1400);
  await watch(t);
  var g = await t.glass();
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(600);
  var first = await snap(t);
  s.check('RUN: a tap starts the first glass: "Work · 1 of 2"', first.state === 'running' && first.phase === 0 && first.status === 'Work · 1 of 2', first.state + ' / ' + first.status);
  await t.page.tap('#btn-zen');                              // (Zen comes by the moon button or a pinch, never by itself)
  await waitFor(t, function () { return window.Hourglass.timer.state === 'done'; }, 70000);
  await sleep(400);
  var w = await seen(t), end = await snap(t);
  var len = [WORK, REST, WORK, REST];

  s.check('RUN: three phase ends, each followed by the next phase (0 → 1 → 2 → 3)', w.gaps.length === 3 && w.phases.length >= 3 &&
          w.phases.slice(0, 3).map(function (p) { return p.phase; }).join() === '1,2,3',
          w.gaps.length + ' gaps, phases ' + w.phases.map(function (p) { return p.phase; }).join());
  var soft = w.chimes.filter(function (c) { return c.soft; }), full = w.chimes.filter(function (c) { return !c.soft; });
  s.check('RUN: a soft bowl at each of them, as the last grain lands; the full bowl once, at the end',
          soft.length === 3 && full.length === 1 && soft.every(function (c, i) { return near(c.t + c.delay * 1000, w.gaps[i].at + BOWL, 5); }) &&
          full[0].t >= w.doneAt - 100, JSON.stringify(w.chimes.map(function (c) { return (c.soft ? 'soft' : 'full') + '@' + c.phase; })));
  if (w.audio) {
    var bells = w.bells.filter(function (b) { return near(b.f0, 349.23, 0.01); });
    s.check('RUN: the soft bowl is the same bowl, lighter and shorter', bells.length === 4 &&
            bells.slice(0, 3).every(function (b) { return b.level < 0.12 && b.level >= 0.05 && b.decay < 1; }) && bells[3].level === 0.12 && bells[3].decay === 1,
            JSON.stringify(bells.map(function (b) { return [b.level, b.decay]; })));
  } else s.skip('RUN: the soft bowl is the same bowl, lighter and shorter', 'the audio context is not running here');
  var turns = w.gaps.map(function (q) {
    return { wait: q.turn0 - q.at, wall: q.turn1 - q.turn0, mode: q.mode, dur: q.dur, half: near(q.to, Math.PI, 1e-9), paced: paced(q) };
  });
  s.check('RUN: then the glass turns itself over: the Flip button\'s 2.6 s half turn, 1.2 s after the phase ran out',
          turns.every(function (q) { return q.mode === 'script' && q.half && q.dur === TURN && near(q.paced, TURN, 30) &&
                                            q.wait >= SETTLE - 10 && q.wait <= SETTLE + 250 && q.wall >= TURN - 60 && q.wall <= TURN + 1500; }) &&
          w.scriptTurns === 3, JSON.stringify(turns));
  s.check('RUN: the next phase starts as the turn ends', w.gaps.every(function (q, i) { return near(q.end, q.turn1, 5) && near(w.phases[i].t, q.turn1, 5); }) &&
          w.phases.slice(0, 3).every(function (p) { return p.state === 'running' && near(p.rem, len[p.phase], 40); }),
          JSON.stringify(w.phases.slice(0, 3).map(function (p) { return [p.phase, p.state, Math.round(p.rem)]; })));
  s.check('RUN: ... with all the sand above the neck, timed to last the phase exactly (topAt(length) = nTop)',
          w.phases.slice(0, 3).every(function (p) { return p.top === p.total && Math.abs(p.want - p.top) <= 0.01 && p.flips === p.phase; }),
          JSON.stringify(w.phases.slice(0, 3).map(function (p) { return [p.top, p.total, +p.want.toFixed(1), p.flips]; })));
  var r0 = first.rate, rates = w.phases.slice(0, 3).map(function (p) { return p.rate / r0; });
  s.check('RUN: the same sand runs faster through the shorter rest (× 1.2), and as before in the next work',
          near(rates[0], WORK / REST, 0.03) && near(rates[1], 1, 0.03) && near(rates[2], WORK / REST, 0.03), rates.map(function (r) { return r.toFixed(3); }).join(', '));
  // every phase lasts its own length on the wall clock, and its last grain leaves at 00:00.0
  // (a phase begins as its turn ends and runs out at gap.at, both on the app's own clock; the end of the last one is
  //  the frame that found it at 00:00.0, so that one may come a frame or two late)
  var begin = [first.tick - (WORK - first.rem)].concat(w.phases.slice(0, 3).map(function (p) { return p.began; }));
  var over = [w.gaps[0].at, w.gaps[1].at, w.gaps[2].at, full.length ? full[0].t : NaN];
  var spans = len.map(function (d, i) { return over[i] - begin[i] - d; });
  s.check('RUN: every phase lasts its own length on the wall clock (to 5 ms; the last as soon as a frame finds it over)',
          spans.every(function (d, i) { return d >= -5 && d <= (i < 3 ? 5 : 120); }),
          spans.map(function (d) { return (d >= 0 ? '+' : '') + Math.round(d) + ' ms'; }).join(', '));
  // (as in E1: against the frame that found the phase at 00:00.0, which is when the bowl is asked for)
  var grain = len.map(function (d, i) { return w.empty[i] === undefined ? NaN : w.empty[i] - w.chimes[i].t; });
  s.check('RUN: the last grain of every phase leaves within 30 ms of its 00:00.0', grain.every(function (d) { return Math.abs(d) <= 30; }),
          grain.map(function (d) { return Math.round(d) + ' ms'; }).join(', '));
  var want = ['Work · 1 of 2', 'Turning', 'Rest · 1 of 2', 'Turning', 'Work · 2 of 2', 'Turning', 'Rest · 2 of 2', 'Time · flip to begin again'];
  var said = w.status.slice(w.status.indexOf('Work · 1 of 2'));
  s.check('RUN: the status line names each phase, quietly', said.join('|') === want.join('|'), said.join(' | '));
  var live = await t.eval(function () { return document.getElementById('status').getAttribute('aria-live'); });
  s.check('RUN: ... in the polite live region screen readers already follow', live === 'polite', live);
  s.check('RUN: in Zen (the moon button) the controls stay dim through every turn (Full Zen: gone)',
          w.zenAt > 0 && w.zenLost === 0 && w.gaps.every(function (q) { return q.zen && q.hud >= 0 && q.hud < 0.02; }),
          'zen lost on ' + w.zenLost + ' frames; controls\' opacity after each turn ' + w.gaps.map(function (q) { return q.hud; }).join(', '));
  s.check('RUN: the last phase ends as any glass does: 00:00, "Time", done', end.state === 'done' && end.main === '00:00' && /^Time/.test(end.status) &&
          end.top === 0 && end.phase === 4, JSON.stringify({ state: end.state, main: end.main, status: end.status, top: end.top, phase: end.phase }));

  // started again, it begins from its first glass
  await sleep(1200);
  var gz = await t.glass();
  await t.touch.pinch(gz.cx, gz.cy, 230, 90, 260);   // (the end leaves Zen as it is: two fingers bring the controls back)
  await sleep(700);
  await t.page.tap('#btn-play');
  await waitFor(t, function () { return window.Hourglass.timer.state === 'running' && !window.Hourglass.flip.active; }, 9000);
  await sleep(300);
  var again = await snap(t);
  s.check('RUN: started again, the glass turns and the sequence begins from its first glass', again.state === 'running' && again.phase === 0 &&
          again.status === 'Work · 1 of 2' && again.rem > WORK - 900 && again.rem < WORK && Math.abs(again.top - again.want) <= Math.max(3, 0.5 * again.rate) &&
          near(again.rate, r0, 0.03 * r0), JSON.stringify({ state: again.state, phase: again.phase, status: again.status, rem: Math.round(again.rem) }));
  await t.page.tap('#btn-reset');
  await sleep(1400);
  var rs = await snap(t);
  s.check('RUN: Reset goes back to the start of the sequence, not started', rs.state === 'idle' && rs.phase === 0 && rs.rem === WORK && rs.gap === 0 &&
          rs.top === rs.total && rs.total === rs.full && rs.status === 'Tap the glass to begin' && rs.rest === REST && rs.rounds === 2,
          JSON.stringify({ state: rs.state, phase: rs.phase, rem: rs.rem, top: rs.top, total: rs.total, status: rs.status }));
  await H.invariants(s, t, 'RUN');
  await t.close();
}

/* ---------------------------------------------------------------------- */

async function testPhase(s, env) {
  var t = await env.open({});
  var WORK = 20000, REST = 10000;
  await t.eval(function (a) { window.Hourglass.setDuration(a[0], a[1], 2); }, [WORK, REST]);
  await sleep(1400);
  await watch(t);
  await t.page.tap('#btn-play');
  await sleep(3000);
  await t.page.tap('#btn-play');
  await sleep(300);
  var p0 = await snap(t);
  await sleep(1200);
  var p1 = await snap(t);
  s.check('PHASE: pause holds the phase: "Work · 1 of 2 · paused", the time stands', p0.state === 'paused' && p0.status === 'Work · 1 of 2 · paused' &&
          p1.rem === p0.rem && p1.phase === 0, p0.status + ', rem ' + Math.round(p0.rem) + ' → ' + Math.round(p1.rem));
  await t.page.tap('#btn-play');
  await sleep(1500);
  var p2 = await snap(t);
  s.check('PHASE: resume goes on inside it', p2.state === 'running' && p2.phase === 0 && p2.status === 'Work · 1 of 2' && p2.rem < p1.rem - 1000 && p2.rem > p1.rem - 2000,
          p2.status + ', rem ' + Math.round(p2.rem));

  // the Flip button: as it always was, inside the phase
  await t.eval(function () {
    var H = window.Hourglass;
    window.__flip = { want: -1, seen: false, rem: -1 };
    (function f() {
      if (H.flip.active && !window.__flip.seen) { window.__flip.seen = true; window.__flip.want = H.remAt(H.sim.total - H.sim.nTop); }
      if (!H.flip.active && window.__flip.seen) { window.__flip.rem = H.timer.rem; window.__flip.phase = H.seq.phase; window.__flip.state = H.timer.state; return; }
      requestAnimationFrame(f);
    })();
  });
  await t.page.tap('#btn-flip');
  await waitFor(t, function () { return window.__flip.rem >= 0; }, 9000);
  var fl = await t.eval(function () { return window.__flip; });
  s.check('PHASE: the Flip button swaps the time within the phase, as it does on any glass', fl.phase === 0 && fl.state === 'running' && near(fl.rem, fl.want, 40) &&
          fl.want > 3000 && fl.want < 6500, 'phase ' + fl.phase + ', rem ' + (fl.rem / 1000).toFixed(2) + ' s, expected ' + (fl.want / 1000).toFixed(2) + ' s');
  // ... and skips none: the work runs out, the glass turns itself, the rest follows. Paused during that turn:
  await waitFor(t, function () { return window.Hourglass.seq.gap > 0 && window.Hourglass.flip.active; }, 12000);
  var g1 = await snap(t);
  await t.eval(function () { window.Hourglass.pause(); });
  await waitFor(t, function () { return !window.Hourglass.flip.active; }, 6000);
  await sleep(250);
  var a = await snap(t);
  await sleep(600);
  var a2 = await snap(t);
  s.check('PHASE: after a Flip no phase is skipped: the work still ends in the turn to the rest', g1.phase === 0 && a.phase === 1, 'phase ' + g1.phase + ' → ' + a.phase);
  s.check('PHASE: paused during the turn, the rest waits at its full time ("Rest · 1 of 2 · paused")', a.state === 'paused' && a.rem === REST && a2.rem === REST &&
          a.status === 'Rest · 1 of 2 · paused' && a.gap === 0 && a.top === a.total, JSON.stringify({ state: a.state, rem: a.rem, status: a.status, top: a.top, total: a.total }));
  await t.page.tap('#btn-play');
  await sleep(400);
  var b = await snap(t);
  s.check('PHASE: ... and runs when resumed', b.state === 'running' && b.phase === 1 && b.status === 'Rest · 1 of 2' && b.rem < REST && b.rem > REST - 900, b.status + ', rem ' + Math.round(b.rem));

  // paused the moment the rest runs out, before the turn: the turn waits
  var at = await t.eval(function () {
    var H = window.Hourglass;
    return new Promise(function (resolve) {
      (function f() {
        if (H.seq.gap) { H.pause(); resolve({ flip: H.flip.active, phase: H.seq.phase, rem: H.timer.rem }); return; }
        requestAnimationFrame(f);
      })();
    });
  });
  await sleep(1600);
  var c = await snap(t);
  s.check('PHASE: paused as a phase runs out, the turn waits', at.phase === 1 && !at.flip && c.state === 'paused' && c.phase === 1 && !c.flip && c.gap > 0 && c.rem === 0 &&
          c.status === 'Rest · 1 of 2 · paused', JSON.stringify({ state: c.state, phase: c.phase, flip: c.flip, rem: c.rem, status: c.status }));
  await t.page.tap('#btn-play');
  await waitFor(t, function () { return window.Hourglass.seq.phase === 2 && !window.Hourglass.flip.active; }, 12000);
  await sleep(300);
  var d = await snap(t);
  s.check('PHASE: ... and resumed, the glass turns and the next work begins', d.state === 'running' && d.phase === 2 && d.status === 'Work · 2 of 2' &&
          d.rem > WORK - 900 && d.rem < WORK, JSON.stringify({ state: d.state, phase: d.phase, status: d.status, rem: Math.round(d.rem) }));
  var w = await seen(t);
  s.check('PHASE: one soft bowl for each phase end, none for the pauses or the Flip', w.chimes.length === 2 && w.chimes.every(function (q) { return q.soft; }),
          JSON.stringify(w.chimes.map(function (q) { return (q.soft ? 'soft' : 'full') + '@' + q.phase; })));

  // Reset
  await t.page.tap('#btn-reset');
  await sleep(1400);
  var r = await snap(t);
  var sess = await t.eval(function (k) { return localStorage.getItem(k); }, SKEY);
  s.check('PHASE: Reset goes back to the start of the sequence, not started', r.state === 'idle' && r.phase === 0 && r.rem === WORK && r.gap === 0 && r.top === r.total &&
          r.total === r.full && r.status === 'Tap the glass to begin' && sess === null, JSON.stringify({ state: r.state, phase: r.phase, rem: r.rem, status: r.status, session: sess }));
  // a preset while it runs ends the sequence (and, as before, the new glass runs on)
  await t.page.tap('#btn-play');
  await sleep(600);
  await t.page.tap('#durations .pill[data-min="1"]');
  await sleep(1400);
  var e = await snap(t);
  s.check('PHASE: a preset ends the sequence: a plain 1 min glass, "Flowing"', e.rest === 0 && e.rounds === 1 && e.durationMs === 60000 && e.state === 'running' &&
          e.status === 'Flowing' && e.label === 'Custom', JSON.stringify({ rest: e.rest, ms: e.durationMs, state: e.state, status: e.status, label: e.label }));
  await H.invariants(s, t, 'PHASE');
  await t.close();
}

/* ---------------------------------------------------------------------- */

async function testClock(s, env) {
  var t = await env.open({ init: skewInit });
  var WORK = 25 * 60000, REST = 5 * 60000;
  await t.eval(function (a) { window.Hourglass.setDuration(a[0], a[1], 3); }, [WORK, REST]);
  await sleep(1400);
  await watch(t);
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(1500);
  var r0 = (await snap(t)).rate;

  // asleep through two phase ends: 1.3 s into the second work
  var j = await t.eval(function (a) {
    var H = window.Hourglass, rem = (window.__hide(true), H.timer.rem), n0 = window.__seq.chimes.length, f0 = __mon.flips;
    window.__jump(rem + a.gap + a.rest + a.gap + 1300);
    window.__hide(false);
    return { rem: H.timer.rem, phase: H.seq.phase, state: H.timer.state, flip: H.flip.active, flips: __mon.flips - f0,
             chimes: window.__seq.chimes.slice(n0), status: document.getElementById('status').textContent, top: H.sim.nTop, total: H.sim.total };
  }, { gap: GAP, rest: REST });
  s.check('CLOCK: asleep through two phase ends: on return the right phase and the right time left', j.phase === 2 && j.state === 'running' && near(j.rem, WORK - 1300, 60) &&
          j.status === 'Work · 2 of 3', 'phase ' + j.phase + ', ' + j.state + ', rem ' + Math.round(j.rem) + ' (expected ' + (WORK - 1300) + '), "' + j.status + '"');
  s.check('CLOCK: ... no turn is drawn, and of the two bowls only the last one sounds (it passed a moment ago)', !j.flip && j.chimes.length === 1 && j.chimes[0].soft &&
          j.chimes[0].delay === 0, JSON.stringify(j.chimes.map(function (c) { return c.soft ? 'soft' : 'full'; })) + ', flip.active ' + j.flip);
  s.check('CLOCK: ... turned twice unseen, the glass stands as it did, all its sand above the neck', j.flips === 0 && j.top === j.total, j.flips + ' flips, top ' + j.top + ' / ' + j.total);
  await sleep(700);
  var a = await snap(t);
  s.check('CLOCK: ... and the sand agrees with the clock', Math.abs(a.top - a.want) <= Math.max(3, 0.5 * a.rate) + 1 && near(a.rate, r0, 0.02 * r0),
          'nTop − topAt(rem) = ' + (a.top - a.want).toFixed(1) + ' grains, rate ' + a.rate.toFixed(2) + ' (work: ' + r0.toFixed(2) + ')');

  // the clock moved on to 2 s before the end of this work: that phase end is watched
  var n1 = (await seen(t)).gaps.length;
  await t.eval(function () { window.__jump(window.Hourglass.timer.rem - 2000); });
  await sleep(400);
  var b = await snap(t);
  await waitFor(t, function () { return window.Hourglass.seq.phase === 3 && !window.Hourglass.flip.active; }, 14000);
  await sleep(300);
  var c = await snap(t), w = await seen(t);
  var gp = w.gaps[w.gaps.length - 1];
  s.check('CLOCK: asleep within a phase: no phase end, no bowl, the sand moved on', b.phase === 2 && b.rem < 2000 && b.rem > 1000 && w.gaps.length === n1 + 1 &&
          Math.abs(b.top - b.want) <= 45, 'phase ' + b.phase + ', rem ' + Math.round(b.rem) + ', nTop − topAt(rem) = ' + (b.top - b.want).toFixed(1));
  s.check('CLOCK: a watched phase end after it: soft bowl, the 2.6 s turn, "Rest · 2 of 3" at its full 05:00', c.phase === 3 && c.state === 'running' &&
          c.status === 'Rest · 2 of 3' && c.rem > REST - 800 && c.rem <= REST && gp.mode === 'script' && near(paced(gp), TURN, 30) &&
          gp.turn1 - gp.turn0 >= TURN - 60 && w.chimes[w.chimes.length - 1].soft && w.chimes[w.chimes.length - 1].delay > 0.6,
          JSON.stringify({ phase: c.phase, status: c.status, rem: Math.round(c.rem), turn: paced(gp), wall: gp.turn1 - gp.turn0 }));
  s.check('CLOCK: the rest runs the same sand five times as fast', near(c.rate / r0, WORK / REST, 0.1) && Math.abs(c.top - c.want) <= Math.max(3, 0.5 * c.rate) + 1,
          'rate × ' + (c.rate / r0).toFixed(3) + ', nTop − topAt(rem) = ' + (c.top - c.want).toFixed(1));

  // hidden, but alive: the rest runs out while the page is not on screen. A hairline crack turns with the glass.
  var before = await t.eval(function () {
    var H = window.Hourglass, cr = H.debug.forceCrack(6, 40, 0);
    window.__hide(true);
    window.__jump(H.timer.rem - 1500);
    return { bulb: cr ? cr.bulb : -1, chimes: window.__seq.chimes.length, gaps: window.__seq.gaps.length, flips: __mon.flips, turns: window.__seq.scriptTurns };
  });
  await sleep(3200);
  var hid = await t.eval(function () {
    var H = window.Hourglass, q = { phase: H.seq.phase, rem: H.timer.rem, tick: H.timer.lastTick, state: H.timer.state, hidden: document.hidden };
    window.__hide(false);
    return q;
  });
  await sleep(500);
  var d = await snap(t);
  w = await seen(t);
  var bowl = w.chimes.slice(before.chimes);
  s.check('CLOCK: hidden, a phase runs out: the next begins by the clock ("Work · 3 of 3"), with one soft bowl at once', hid.hidden && hid.phase === 4 &&
          hid.state === 'running' && bowl.length === 1 && bowl[0].soft && bowl[0].hidden && bowl[0].delay === 0 && near(hid.rem, WORK - (hid.tick - bowl[0].t), 30) &&
          d.status === 'Work · 3 of 3', JSON.stringify({ phase: hid.phase, rem: Math.round(hid.rem), bowls: bowl.length, status: d.status }));
  s.check('CLOCK: ... no turn was drawn for it, the sand lies above the neck again and agrees with the clock', w.gaps.length === before.gaps && w.scriptTurns === before.turns &&
          d.flips === before.flips + 1 && Math.abs(d.top - d.want) <= Math.max(3, 0.5 * d.rate) + 1 && d.top > 0.99 * d.total,
          'flips +' + (d.flips - before.flips) + ', nTop − topAt(rem) = ' + (d.top - d.want).toFixed(1));
  s.check('CLOCK: ... and the crack turned over with the glass (upper bulb → lower)', before.bulb === 0 && d.cracks.length === 1 && d.cracks[0] === 1, before.bulb + ' → ' + d.cracks.join());

  // asleep past the end of the last phase
  var e0 = (await seen(t)).chimes.length;
  await t.eval(function () { window.__jump(2 * 3600000); });
  await sleep(900);
  var e = await snap(t);
  w = await seen(t);
  var last = w.chimes.slice(e0);
  s.check('CLOCK: asleep past the end: done, 00:00, "Time", the sand run through, the full bowl once and no other', e.state === 'done' && e.phase === 6 && e.main === '00:00' &&
          /^Time/.test(e.status) && e.top === 0 && last.length === 1 && !last[0].soft && e.cracks.length === 1 && e.cracks[0] === 0,
          JSON.stringify({ state: e.state, phase: e.phase, main: e.main, top: e.top, bowls: last.map(function (q) { return q.soft ? 'soft' : 'full'; }), crack: e.cracks }));
  await t.eval(function () { window.Hourglass.start(); });
  await waitFor(t, function () { return window.Hourglass.timer.state === 'running' && !window.Hourglass.flip.active; }, 9000);
  await sleep(300);
  var f = await snap(t);
  s.check('CLOCK: started again, it begins from its first glass ("Work · 1 of 3")', f.state === 'running' && f.phase === 0 && f.status === 'Work · 1 of 3' &&
          f.rem > WORK - 900 && f.rem < WORK, JSON.stringify({ state: f.state, phase: f.phase, status: f.status, rem: Math.round(f.rem) }));
  await H.invariants(s, t, 'CLOCK');
  await t.close();
}

/* ---------------------------------------------------------------------- */

async function testReload(s, env) {
  var t = await env.open({ init: skewInit });
  var WORK = 25 * 60000, REST = 5 * 60000;
  await t.eval(function (a) { window.Hourglass.setDuration(a[0], a[1], 2); }, [WORK, REST]);
  await sleep(1400);
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(1200);
  await t.eval(function () { window.Hourglass.pause(); });
  var a = await snap(t);
  await t.reload();
  await sleep(400);
  var b = await snap(t);
  s.check('RELOAD: a paused sequence comes back as it was left', b.state === 'paused' && b.phase === 0 && b.rest === REST && b.rounds === 2 && near(b.rem, a.rem, 1) &&
          b.status === 'Work · 1 of 2 · paused' && b.label === '25·5 ×2' && b.top === a.top,
          JSON.stringify({ state: b.state, phase: b.phase, rem: [Math.round(a.rem), Math.round(b.rem)], status: b.status, label: b.label }));

  // running, and the work ran out while the page was closed: 2 min into the rest. A hairline crack turns with the glass.
  await t.eval(function () { window.Hourglass.start(); });
  await sleep(600);
  var c = await t.eval(function (q) {
    var H = window.Hourglass, cr = H.debug.forceCrack(6, 40, 0);
    sessionStorage.setItem('__skewNext', String(Math.round(H.timer.rem) + q + 120000));
    return { tick: H.timer.lastTick, rem: H.timer.rem, bulb: cr ? cr.bulb : -1, total: H.sim.total };
  }, GAP);
  await t.reload();
  await sleep(400);
  var d = await snap(t);
  var want = REST - (d.tick - c.tick - c.rem - GAP);        // (rem is as of the app's last tick, on both sides)
  s.check('RELOAD: a running sequence whose work ran out meanwhile comes back in its rest, at the right time', d.state === 'running' && d.phase === 1 &&
          near(d.rem, want, 30) && d.status === 'Rest · 1 of 2', JSON.stringify({ state: d.state, phase: d.phase, rem: Math.round(d.rem), expected: Math.round(want), status: d.status }));
  s.check('RELOAD: ... the sand agrees, timed for the rest (topAt(05:00) = all of it)', d.total === c.total && Math.abs(d.top - d.want) <= Math.max(3, 0.5 * d.rate) + 1 &&
          Math.abs((await t.eval(function (r) { return window.Hourglass.topAt(r); }, REST)) - d.total) <= 1.5,
          'nTop − topAt(rem) = ' + (d.top - d.want).toFixed(1) + ' of ' + d.total + ' grains');
  s.check('RELOAD: ... and the crack has turned over with the glass', c.bulb === 0 && d.cracks.length === 1 && d.cracks[0] === 1, c.bulb + ' → ' + d.cracks.join());

  // a running sequence in the same phase
  await sleep(500);
  var e = await snap(t);
  await t.reload();
  await sleep(400);
  var f = await snap(t);
  s.check('RELOAD: ... and again, within the rest', f.state === 'running' && f.phase === 1 && near(f.rem, e.rem - (f.tick - e.tick), 30) && f.cracks.join() === '1',
          JSON.stringify({ phase: f.phase, rem: Math.round(f.rem), expected: Math.round(e.rem - (f.tick - e.tick)) }));

  // closed past the end of the whole sequence: 75 min, of which the rest of the rest, a work and a rest took 33
  // (a sequence runs longer than the hour after which a finished glass is forgotten: what counts is when it ended)
  await t.eval(function () { sessionStorage.setItem('__skewNext', String(75 * 60000)); });
  await t.reload();
  await sleep(500);
  var g = await snap(t);
  s.check('RELOAD: closed 75 min, past the end of the sequence 40 min ago: done, 00:00, the sand run through', g.state === 'done' && g.phase === 4 && g.main === '00:00' &&
          g.top === 0 && /^Time/.test(g.status), JSON.stringify({ state: g.state, phase: g.phase, main: g.main, top: g.top, status: g.status }));
  await t.eval(function () { window.Hourglass.start(); });
  await waitFor(t, function () { return window.Hourglass.timer.state === 'running' && !window.Hourglass.flip.active; }, 9000);
  await sleep(300);
  var h = await snap(t);
  s.check('RELOAD: ... and started again from its first glass', h.state === 'running' && h.phase === 0 && h.status === 'Work · 1 of 2' && h.rem > WORK - 900,
          JSON.stringify({ state: h.state, phase: h.phase, status: h.status, rem: Math.round(h.rem) }));

  // a session saved for another sequence is not this glass
  await t.eval(function (key) {
    window.Hourglass.pause();
    window.addEventListener('pagehide', function () {
      var st = JSON.parse(localStorage.getItem(key));
      st.rounds = 3;
      localStorage.setItem(key, JSON.stringify(st));
    });
  }, KEY);
  await t.reload();
  await sleep(400);
  var k = await snap(t);
  s.check('RELOAD: a session saved for another sequence is not restored', k.state === 'idle' && k.rounds === 3 && k.phase === 0 && k.rem === WORK,
          JSON.stringify({ state: k.state, rounds: k.rounds, phase: k.phase, rem: k.rem }));

  // left paused between two phases (the work has run out, the glass has not turned yet): it comes back waiting there
  await t.eval(function () { var H = window.Hourglass; H.start(); window.__jump(H.timer.rem - 1500); });
  await t.eval(function () {
    var H = window.Hourglass;
    return new Promise(function (resolve) {
      (function f() { if (H.seq.gap) { H.pause(); resolve(); } else requestAnimationFrame(f); })();
    });
  });
  await t.reload();
  await sleep(400);
  var m = await snap(t);
  s.check('RELOAD: left paused between two phases, it comes back there: 00:00, "Work · 1 of 3 · paused", the sand run through', m.state === 'paused' &&
          m.phase === 0 && m.rem === 0 && m.gap > 0 && m.top === 0 && m.status === 'Work · 1 of 3 · paused',
          JSON.stringify({ state: m.state, phase: m.phase, rem: m.rem, top: m.top, status: m.status }));
  await t.eval(function () { window.Hourglass.start(); });
  await waitFor(t, function () { return window.Hourglass.seq.phase === 1 && !window.Hourglass.flip.active; }, 12000);
  await sleep(300);
  var n = await snap(t);
  s.check('RELOAD: ... and resumed, the glass turns and the rest begins', n.state === 'running' && n.status === 'Rest · 1 of 3' && n.rem > REST - 900 && n.rem <= REST &&
          n.flips === 1, JSON.stringify({ state: n.state, phase: n.phase, status: n.status, rem: Math.round(n.rem) }));
  await waitFor(t, function () { return window.__mon.checks >= 2; }, 8000);       // (the census counts from the last reload)
  await H.invariants(s, t, 'RELOAD');
  await t.close();
}

/* ---------------------------------------------------------------------- */

async function testCalm(s, env) {
  var storage = {};
  storage[KEY] = { chime: false };
  var t = await env.open({ reducedMotion: true, storage: storage });
  var WORK = 10000, REST = 10000;
  await t.eval(function (a) { window.Hourglass.setDuration(a[0], a[1], 1); }, [WORK, REST]);
  await sleep(1400);
  await watch(t);
  var g = await t.glass();
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(500);
  await t.page.tap('#btn-zen');                              // (Zen comes by the moon button or a pinch, never by itself)
  var a = await snap(t);
  var rm = await t.eval(function () { return window.Hourglass.reduceMotion; });
  s.check('CALM: Reduce Motion is on; one round reads "Work", without a count', rm === true && a.status === 'Work' && a.state === 'running', rm + ' / ' + a.status);
  // watch the sand's canvas fade while the phases change over
  await t.eval(function () {
    var H = window.Hourglass, c = document.getElementById('c-sand');
    window.__fade = { min: 1, atSwap: -1, angle: 0 };
    var ph = H.seq.phase;
    (function f() {
      var o = +getComputedStyle(c).opacity;
      if (H.seq.gap && o < window.__fade.min) window.__fade.min = o;
      if (Math.abs(H.sim.angle) > window.__fade.angle) window.__fade.angle = Math.abs(H.sim.angle);
      if (H.seq.phase !== ph) { ph = H.seq.phase; if (window.__fade.atSwap < 0) window.__fade.atSwap = o; }
      requestAnimationFrame(f);
    })();
  });
  await waitFor(t, function () { return window.Hourglass.timer.state === 'done'; }, 40000);
  await sleep(400);
  var w = await seen(t), e = await snap(t), fd = await t.eval(function () { return window.__fade; });
  var gp = w.gaps[0] || {}, p = w.phases[0] || {};
  s.check('CALM: no turn: the glass stays as it is', w.gaps.length === 1 && w.scriptTurns === 0 && gp.turn0 === -1 && fd.angle === 0,
          w.scriptTurns + ' turns, largest angle ' + fd.angle);
  // (the rest begins before that frame's physics, so a frame's worth of its sand may already have left)
  s.check('CALM: instead the sand fades away below and returns above', gp.pass === true && fd.min < 0.05 && fd.atSwap >= 0 && fd.atSwap < 0.05 &&
          p.top > 0.98 * p.total && p.top <= p.total && near(p.want, p.total, 0.01) && p.flips === 1,
          'faded to ' + fd.min.toFixed(2) + ', ' + fd.atSwap.toFixed(2) + ' when the sand was laid above; top ' + p.top + ' / ' + p.total);
  s.check('CALM: ... in the same time as a turn, and the rest then runs its full length', near(gp.end - gp.at, GAP, 120) && p.phase === 1 && near(p.rem, REST, 40) &&
          p.status === 'Rest' && near(w.doneAt - p.t, REST, 60), 'gap ' + (gp.end - gp.at) + ' ms, rest ' + (w.doneAt - p.t) + ' ms, "' + p.status + '"');
  s.check('CALM: in Zen the controls stay dim through it', w.zenAt > 0 && w.zenLost === 0 && gp.zen === true, 'zen lost on ' + w.zenLost + ' frames');
  var bells = w.bells.filter(function (b) { return near(b.f0, 349.23, 0.01); });
  s.check('CALM: with the Completion bowl off there is no bowl, between the phases or at the end', bells.length === 0 && e.state === 'done',
          bells.length + ' bowls sounded (' + w.chimes.length + ' asked for; audio ' + (w.audio ? 'running' : 'not running') + ')');
  await H.invariants(s, t, 'CALM');
  await t.close();
}

/* ---------------------------------------------------------------------- */

/**
 * Two things found in review. The page hidden during the gap between two
 * phases (after the phase end was seen, and its bowl asked for): no second
 * bowl. And on short screens, where the status line is not shown, a sequence
 * still says which phase it is in: to a screen reader always, on screen in
 * landscape, where there is room beside the glass.
 */
async function testReview(s, env) {
  var WORK = 25 * 60000, REST = 5 * 60000;
  // hidden 300 ms into the gap (before the bowl has sounded) and 2.5 s into it (during the turn)
  var delays = [300, 2500];
  for (var i = 0; i < delays.length; i++) {
    var t = await env.open({ init: skewInit });
    await t.eval(function (a) { window.Hourglass.setDuration(a[0], a[1], 3); }, [WORK, REST]);
    await sleep(1400);
    await watch(t);
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1200);
    await t.eval(function () { window.__jump(window.Hourglass.timer.rem - 1500); });
    await waitFor(t, function () { return window.Hourglass.seq.gap > 0; }, 12000);
    await sleep(delays[i]);
    await t.eval(function () { window.__hide(true); });
    await sleep(1500);
    await t.eval(function () { window.__hide(false); });
    await sleep(1500);
    var w = await seen(t), c = await snap(t);
    s.check('REVIEW: the page hidden ' + delays[i] + ' ms into the gap between two phases: still one soft bowl for that phase end',
            w.chimes.length === 1 && w.chimes[0].soft && c.phase === 1 && c.state === 'running' && c.status === 'Rest · 1 of 3',
            JSON.stringify(w.chimes.map(function (q) { return (q.soft ? 'soft' : 'full') + (q.hidden ? ' (hidden)' : ''); })) + ', then "' + c.status + '", ' + c.state);
    s.check('REVIEW: ... no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
    await t.close();
  }

  // the phase line on short screens
  function line(t) {
    return t.eval(function () {
      var st = document.getElementById('status'), cs = getComputedStyle(st), r = st.getBoundingClientRect(), ro = document.getElementById('readout').getBoundingClientRect();
      return { text: st.textContent, live: st.getAttribute('aria-live'), display: cs.display, visibility: cs.visibility, clip: cs.clipPath, w: Math.round(r.width), h: Math.round(r.height),
               position: cs.position, overflow: cs.overflow,
               inView: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, underReadout: r.top >= ro.bottom - 1,
               seq: document.getElementById('app').classList.contains('seq') };
    });
  }
  var SHORT = [[320, 568, false], [844, 390, true]];
  for (var k = 0; k < SHORT.length; k++) {
    var u = await env.open({ init: skewInit });
    await u.page.setViewportSize({ width: SHORT[k][0], height: SHORT[k][1] });
    await sleep(500);
    var plain = await line(u);
    await u.eval(function (a) { window.Hourglass.setDuration(a[0], a[1], 4); }, [WORK, REST]);
    await sleep(1400);
    await u.eval(function () { window.Hourglass.start(); });
    await sleep(1200);
    var q = await line(u), name = SHORT[k][0] + '×' + SHORT[k][1];
    s.check('REVIEW ' + name + ': a plain glass shows no status line there, as before', plain.display === 'none' && !plain.seq, JSON.stringify(plain));
    s.check('REVIEW ' + name + ': a sequence\'s phase line is there for a screen reader ("Work · 1 of 4", a polite live region, not display: none)',
            q.seq && q.text === 'Work · 1 of 4' && q.live === 'polite' && q.display !== 'none' && q.visibility !== 'hidden', JSON.stringify(q));
    if (SHORT[k][2]) {
      s.check('REVIEW ' + name + ': ... and on screen, under the readout, beside the glass', q.clip === 'none' && q.w > 40 && q.h >= 10 && q.inView && q.underReadout, JSON.stringify(q));
    } else {
      // (its own min-height keeps the box 14 px tall: out of the flow and clipped away, that takes no room and shows nothing)
      s.check('REVIEW ' + name + ': ... and takes no room on screen (out of the flow, 1 px wide, all of it clipped away)',
              q.position === 'absolute' && q.w <= 1 && q.clip === 'inset(50%)' && q.overflow === 'hidden', JSON.stringify(q));
    }
    await u.eval(function () { window.Hourglass.setDuration(5 * 60000); });
    await sleep(1400);
    var back = await line(u);
    s.check('REVIEW ' + name + ': a plain glass again: no status line', back.display === 'none' && !back.seq, JSON.stringify(back));
    s.check('REVIEW ' + name + ': no page or console errors', u.errors.length === 0, u.errors.slice(0, 3).join(' | '));
    await u.close();
  }
}

/* ---------------------------------------------------------------------- */

(async function main() {
  var s = new H.Suite('app-sequence');
  var env = await H.start();
  var only = env.args.only;
  var tests = [['ui', testUi], ['run', testRun], ['phase', testPhase], ['clock', testClock], ['reload', testReload], ['calm', testCalm], ['review', testReview]];
  for (var i = 0; i < tests.length; i++) {
    if (only && only !== tests[i][0]) continue;
    try {
      await tests[i][1](s, env);
    } catch (e) {
      s.check('no exception (' + tests[i][0] + ')', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
    }
  }
  await env.close();
  s.done();
})();
