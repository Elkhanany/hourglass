/*
 * Haptics on an iPhone. Since iOS 26.5 the Taptic Engine answers a web
 * page only when a finger really lands on a switch control or its label,
 * so every control and the glass itself carry a transparent label over a
 * hidden switch (app.js: hapticMount, hapticClick). Chromium has no Taptic
 * Engine. What is checked here is the plumbing, in a browser given an
 * iPhone's shape (a touch screen and no navigator.vibrate):
 *
 *   MOUNT   one label on every button (Tune's tabs and its reset link are
 *           buttons too), switch row, the readout and the stage; none in a
 *           browser that can vibrate
 *   TAP     the hidden switch flips exactly when the app asked for a tap
 *           (which is when the phone would tick), and the control does its
 *           work exactly once: Play, Mute, a pill, a card, a switch row,
 *           the readout; a control that asks for none leaves it alone;
 *           with Haptics off nothing flips
 *   GLASS   a tap on the glass starts it once and flips the stage's
 *           switch; a knock flips it again; a tap beside the glass, and
 *           carrying the glass, flip nothing
 *   REST    scrolling a tab of Tune with a finger that starts on a card
 *           still scrolls and chooses nothing; holding Sand still pours; a
 *           pinch still brings and leaves Zen
 *
 * Whether the phone then ticks can only be felt on a phone. (A control of
 * Tune is reached through lib/tune.js, which opens Tune and shows its tab;
 * that the tabs and the reset link tick is app-tune's.)
 *
 *   node tools/test/app-haptics.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

/** An iPhone has no navigator.vibrate. */
function noVibrate() {
  try { delete Navigator.prototype.vibrate; } catch (e) {}
  if (navigator.vibrate) { try { Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true }); } catch (e2) {} }
}
function center(t, sel) {
  return t.eval(function (q) {
    var el = document.querySelector(q), r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
}
/** Is the hidden switch of this control on? (it flips each time the phone would tick) */
function sw(t, sel) {
  return t.eval(function (q) { var el = document.querySelector(q); return el && el._haptic ? el._haptic.querySelector('input').checked : null; }, sel);
}
/** Tap a control with a finger and say whether its switch flipped. */
async function tapOn(t, sel, wait) {
  var c = await center(t, sel), a = await sw(t, sel);
  await t.touch.tap(c.x, c.y, 60);
  await sleep(wait || 350);
  return (await sw(t, sel)) !== a;
}
function state(t) { return t.eval(function () { return window.Hourglass.timer.state; }); }

async function run(s, env) {
  var t = await env.open({ init: noVibrate });
  try {
    await sleep(900);
    /* ---- MOUNT ---------------------------------------------------------- */
    var m = await t.eval(function () {
      var hosts = document.querySelectorAll('button, label.row, #readout'), n = 0, bad = [], i;
      for (i = 0; i < hosts.length; i++) {
        var l = hosts[i]._haptic;
        if (l && l.parentNode === hosts[i] && l.matches('label.haptic[aria-hidden="true"]') && l.querySelectorAll('input[type="checkbox"][switch]').length === 1) n++;
        else bad.push(hosts[i].id || hosts[i].className);
      }
      var st = document.getElementById('stage')._haptic, any = document.querySelector('#btn-play')._haptic;
      var cs = getComputedStyle(any), ci = getComputedStyle(any.querySelector('input')), hr = any.parentNode.getBoundingClientRect(), lr = any.getBoundingClientRect();
      return { hosts: hosts.length, n: n, bad: bad, all: document.querySelectorAll('.haptic').length, stage: !!st && st.parentNode.id === 'stage',
               pos: cs.position, bg: cs.backgroundColor, vis: ci.visibility, covers: Math.abs(hr.width - lr.width) < 1 && Math.abs(hr.height - lr.height) < 1,
               vibrate: typeof navigator.vibrate };
    });
    s.check('MOUNT: no navigator.vibrate here, as on an iPhone', m.vibrate === 'undefined', m.vibrate);
    s.check('MOUNT: every button, switch row and the readout carries one label over one hidden switch', m.n === m.hosts && m.hosts > 40 && m.bad.length === 0,
            m.n + ' of ' + m.hosts + (m.bad.length ? '; without: ' + m.bad.join(', ') : ''));
    s.check('MOUNT: the stage carries one too, and there are no others', m.stage && m.all === m.hosts + 1, m.all + ' labels');
    s.check('MOUNT: the label covers its control, shows nothing, and its switch is never under the finger', m.covers && m.pos === 'absolute' && /rgba\(0, 0, 0, 0\)|transparent/.test(m.bg) && m.vis === 'hidden',
            [m.pos, m.bg, m.vis, m.covers].join(' / '));

    /* ---- TAP ------------------------------------------------------------ */
    var f1 = await tapOn(t, '#btn-play'), s1 = await state(t);
    await sleep(700);
    var f2 = await tapOn(t, '#btn-play'), s2 = await state(t);
    s.check('TAP: Play starts the glass once and its switch flips; again, it pauses and flips back', f1 && s1 === 'running' && f2 && s2 === 'paused', s1 + ' (' + f1 + '), ' + s2 + ' (' + f2 + ')');
    var muted = function () { return t.eval(function () { return document.getElementById('btn-mute').getAttribute('aria-pressed'); }); };
    var mu0 = await muted(), f3 = await tapOn(t, '#btn-mute'), mu1 = await muted(), f4 = await tapOn(t, '#btn-mute'), mu2 = await muted();
    s.check('TAP: Mute toggles once a tap, each with its flip', f3 && f4 && mu0 === 'false' && mu1 === 'true' && mu2 === 'false', [mu0, mu1, mu2].join(' → '));
    await tapOn(t, '#btn-reset', 2600);                      // (a reset takes its time: pills wait for it)
    var f5 = await tapOn(t, '.pill[data-min="1"]');
    await sleep(1800);                                       // (the glass is laid afresh in a cross-fade: the readout follows it)
    var main = await t.eval(function () { return document.getElementById('t-main').textContent; });
    s.check('TAP: a pill sets its time and flips', f5 && main === '01:00', main);
    var f6 = await tapOn(t, '#readout', 800), custom = await t.eval(function () { return !document.getElementById('sheet-custom').hidden; });
    s.check('TAP: the readout opens the custom sheet and flips', f6 && custom);
    var f7 = await tapOn(t, '#sheet-custom .sheet-close', 800), closed = await t.eval(function () { return document.getElementById('sheet-custom').hidden; });
    s.check('TAP: Close asks for no tap: the sheet closes, its switch stays as it was', !f7 && closed, 'flipped ' + f7 + ', closed ' + closed);
    // Tune: a sand, a finish, a switch row
    await tapOn(t, '#btn-settings', 900);
    await tune.show(t, '#sands [data-sand="lapis"]');
    var theme = function () { return t.eval(function () { return document.querySelector('#sands [aria-checked="true"]').dataset.sand; }); };
    var th0 = await theme(), f8 = await tapOn(t, '#sands [data-sand="lapis"]', 600), th1 = await theme();
    s.check('TAP: a sand is chosen by one tap, with its flip', f8 && th0 === 'sahara' && th1 === 'lapis', th0 + ' → ' + th1);
    await tune.show(t, '#finishes [data-finish="gold"]');
    var finish = function () { return t.eval(function () { return document.querySelector('#finishes [aria-checked="true"]').dataset.finish; }); };
    var fi0 = await finish(), f8b = await tapOn(t, '#finishes [data-finish="gold"]', 600), fi1 = await finish();
    s.check('TAP: a finish is chosen by one tap, with its flip', f8b && fi0 === 'walnut' && fi1 === 'gold', fi0 + ' → ' + fi1);
    await tune.show(t, 'label[for="opt-frame"]');
    var checked = function (id) { return t.eval(function (q) { return document.getElementById(q).checked; }, id); };
    var fr0 = await checked('opt-frame'), f9 = await tapOn(t, 'label[for="opt-frame"]', 700), fr1 = await checked('opt-frame');
    var f10 = await tapOn(t, 'label[for="opt-frame"]', 700), fr2 = await checked('opt-frame');
    s.check('TAP: a switch row flips its own switch once a tap, and the hidden one with it', f9 && f10 && fr0 === true && fr1 === false && fr2 === true, [fr0, fr1, fr2].join(' → '));
    // Haptics off: everything still works, nothing flips
    await tune.show(t, 'label[for="opt-haptics"]');
    var f11 = await tapOn(t, 'label[for="opt-haptics"]', 600), hap = await checked('opt-haptics');
    await tune.show(t, 'label[for="opt-awake"]');
    var fr3 = await tapOn(t, 'label[for="opt-awake"]', 600);
    s.check('TAP: Haptics switched off: that tap and the next flip nothing', !f11 && hap === false && !fr3, 'haptics ' + hap + ', flipped ' + f11 + ' / ' + fr3);
    await tapOn(t, 'label[for="opt-awake"]', 600);
    await tune.show(t, 'label[for="opt-haptics"]');
    var f12 = await tapOn(t, 'label[for="opt-haptics"]', 600);
    s.check('TAP: switched on again, it answers at once', f12 && (await checked('opt-haptics')) === true);

    /* ---- REST: scrolling Tune from a card ------------------------------------ */
    // the card at the lower edge of what its tab shows, so that the tab has room to scroll under the finger
    await tune.show(t, '#characters [data-character="warm"]', { block: 'end' });
    var c = await center(t, '#characters [data-character="warm"]');
    var ch0 = await t.eval(function () { return document.querySelector('#characters [aria-checked="true"]').dataset.character; });
    var w0 = await sw(t, '#characters [data-character="warm"]');
    var top0 = await t.eval(function () { return window.__tune.scroller('#characters').scrollTop; });
    await t.touch.down(c.x, c.y);
    await t.touch.path(function (u) { return { x: c.x, y: c.y - 220 * u }; }, 350);
    await t.touch.up();
    await sleep(700);
    var sc = await t.eval(function () {
      return { top: window.__tune.scroller('#characters').scrollTop, ch: document.querySelector('#characters [aria-checked="true"]').dataset.character };
    });
    s.check('REST: a finger that starts on a card and slides scrolls its tab of Tune, chooses nothing and flips nothing',
            sc.top - top0 > 100 && sc.ch === ch0 && (await sw(t, '#characters [data-character="warm"]')) === w0,
            'scrolled ' + Math.round(sc.top - top0) + ' px (from ' + Math.round(top0) + '), character ' + sc.ch);
    await t.page.keyboard.press('Escape');
    await sleep(800);

    /* ---- GLASS ---------------------------------------------------------- */
    var g = await t.glass();
    var st0 = await state(t), a0 = await sw(t, '#stage');
    await t.touch.tap(g.cx, g.cy, 60);
    await sleep(350);
    var st1 = await state(t), a1 = await sw(t, '#stage');
    s.check('GLASS: a tap on the glass starts it once, and the stage\'s switch flips', st0 !== 'running' && st1 === 'running' && a1 !== a0, st0 + ' → ' + st1);
    await t.touch.tap(g.cx, g.cy, 60);                      // a second, quick: a knock (the start is not taken back twice)
    await sleep(350);
    var st2 = await state(t), a2 = await sw(t, '#stage');
    s.check('GLASS: a quick second tap is a knock, felt too', a2 !== a1, st1 + ' → ' + st2);
    await sleep(900);
    var st3 = await state(t);
    await t.touch.tap(6, 430, 60);                          // on the stage, beside the glass
    await sleep(350);
    s.check('GLASS: a tap beside the glass does nothing and flips nothing', (await state(t)) === st3 && (await sw(t, '#stage')) === a2);
    await t.touch.down(g.cx, g.cy);
    await t.touch.path(function (u) { return { x: g.cx + 90 * u, y: g.cy }; }, 220);
    var px = await t.eval(function () { return window.Hourglass.body.px; });
    await sleep(150);
    await t.touch.up();
    await sleep(500);
    s.check('GLASS: carried by its waist it follows the finger, and that is no tap: nothing flips', Math.abs(px) > 5 && (await sw(t, '#stage')) === a2 && (await state(t)) === st3,
            'carried ' + px.toFixed(1) + ' cells');
    await sleep(2500);

    /* ---- REST: Sand, a pinch -------------------------------------------- */
    var total = function () { return t.eval(function () { var q = window.Hourglass.sim; return q.total; }); };
    var n0 = await total(), cs = await center(t, '#btn-sand');
    await t.touch.down(cs.x, cs.y);
    await sleep(900);
    await t.touch.up();
    await sleep(600);
    var n1 = await total();
    s.check('REST: holding Sand still pours', n1 > n0 + 50, n0 + ' → ' + n1 + ' grains');
    var zen = function () { return t.eval(function () { return document.getElementById('app').classList.contains('zen'); }); };
    g = await t.glass();
    await t.touch.pinch(g.cx, g.cy, 80, 220, 260);
    await sleep(200);
    var z1 = await zen(), st4 = await state(t);
    await t.touch.pinch(g.cx, g.cy, 230, 90, 260);
    await sleep(300);
    s.check('REST: two fingers still bring Zen and leave it, and are no tap', z1 && !(await zen()) && st4 === st3 && (await state(t)) === st3 && (await sw(t, '#stage')) === a2);
    await H.invariants(s, t, 'HAPTICS');
  } finally {
    await t.close();
  }

  // a browser that can vibrate needs none of this
  var v = await env.open({ init: function () { window.__vib = []; navigator.vibrate = function (p) { window.__vib.push(p); return true; }; } });
  try {
    await sleep(900);
    var c2 = await center(v, '#btn-mute');
    await v.touch.tap(c2.x, c2.y, 60);
    await sleep(300);
    var q = await v.eval(function () { return { labels: document.querySelectorAll('.haptic').length, vib: window.__vib, muted: document.getElementById('btn-mute').getAttribute('aria-pressed') }; });
    s.check('MOUNT: where the browser can vibrate there are no labels, and a tap vibrates', q.labels === 0 && q.vib.length === 1 && q.muted === 'true', q.labels + ' labels, vibrate(' + JSON.stringify(q.vib) + ')');
  } finally {
    await v.close();
  }
}

async function main() {
  var s = new H.Suite('app-haptics');
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
