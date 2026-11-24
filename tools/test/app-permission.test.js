/*
 * Controller acceptance 1: the Real motion permission flow.
 *   (a) the Tune switch asks for both permissions synchronously inside its click
 *   (b) declined → the switch turns off and says so
 *   (c) granted but no data for 2.5 s → off, 'No motion data from this device'
 *   (d) orientation but no motion → stays on; shaking is disabled
 *   (e) reloaded with Real motion on → still on, nothing asked at start-up
 *       or by a tap on the glass; a tilt button waits in the top bar and a
 *       tap on it asks exactly once; where the readings arrive unasked it
 *       never shows
 *
 *   node tools/test/app-permission.test.js [--root <dir>] [--port <n>] [--real]
 *
 * Runs against the motion stub (stubs/motion-stub.js), or with --real against
 * the tree's own motion.js (that is integration scenario E12).
 */
'use strict';
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

var REAL = process.argv.indexOf('--real') >= 0;
var SETTINGS = 'hourglass.settings.v1';

/** Tune open, on the tab that holds Real motion, the switch in view (lib/tune.js). */
async function openTune(t) {
  await tune.show(t, '#opt-tilt');
}
function state(t) {
  return t.eval(function () {
    var H = window.Hourglass, st = window.__motionStub;
    var toast = document.getElementById('toast');
    return {
      checked: document.getElementById('opt-tilt').checked, on: H.grav.on,
      perms: window.__perms, requests: st ? st.requests : -1,
      toast: toast.classList.contains('show') ? toast.textContent : '',
      saved: JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}').tilt
    };
  });
}
/** What the real motion.js sees: device events, or none. */
function feed(t, kind) {
  return t.eval(function (k) {
    if (window.__motionStub) {
      window.__motion.seenOrient = k !== 'none';
      window.__motion.seenMotion = k === 'both';
      return;
    }
    if (k === 'none') return;
    if (k === 'both') { window.__drive({ profile: 'calm', conv: 'spec' }); return; }
    // only orientation events, no devicemotion at all
    window.__orientOnly = setInterval(function () {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 90, gamma: 0, absolute: false }));
    }, 1000 / 60);
  }, kind);
}

async function caseA(s, env) {
  var t = await env.open({ motionStub: !REAL });
  await feed(t, 'both');
  await openTune(t);
  await t.page.tap('#opt-tilt');
  await sleep(400);
  var a = await state(t);
  var p = a.perms;
  s.check('(a) the click asks for both permissions once', p.motion === 1 && p.orient === 1, 'counts ' + p.motion + '/' + p.orient);
  s.check('(a) ... synchronously inside the click', p.motionIn[0] === 'click' && p.orientIn[0] === 'click',
          'dispatching ' + p.motionIn[0] + ' / ' + p.orientIn[0]);
  s.check('(a) ... with user activation', p.motionActive[0] === true && p.orientActive[0] === true,
          'isActive ' + p.motionActive[0] + ' / ' + p.orientActive[0]);
  s.check('(a) granted: Real motion is on', a.checked && a.on && a.saved === true, JSON.stringify({ checked: a.checked, on: a.on, saved: a.saved }));
  await H.invariants(s, t, '(a)');
  await t.close();
}

async function caseB(s, env) {
  var t = await env.open({ motionStub: !REAL });
  await t.eval(function () { window.__perm = 'denied'; window.__motionPerm = 'denied'; });
  await openTune(t);
  await t.page.tap('#opt-tilt');
  await sleep(400);
  var b = await state(t);
  s.check('(b) declined: the switch turns off', !b.checked && !b.on && b.saved === false, JSON.stringify({ checked: b.checked, on: b.on, saved: b.saved }));
  s.check('(b) ... and the toast says so', /declined/.test(b.toast), '"' + b.toast + '"');
  await H.invariants(s, t, '(b)');
  await t.close();
}

async function caseC(s, env) {
  var t = await env.open({ motionStub: !REAL, init: function () { window.__motion = { seenOrient: false, seenMotion: false }; } });
  await feed(t, 'none');
  await openTune(t);
  await t.page.tap('#opt-tilt');
  await sleep(1500);
  var c1 = await state(t);
  await sleep(1400);
  var c2 = await state(t);
  s.check('(c) granted, no data: still on at 1.5 s', c1.checked && c1.on);
  s.check('(c) ... off after 2.5 s', !c2.checked && !c2.on && c2.saved === false, JSON.stringify({ checked: c2.checked, on: c2.on }));
  s.check('(c) ... with "No motion data from this device"', /No motion data from this device/.test(c2.toast), '"' + c2.toast + '"');
  await H.invariants(s, t, '(c)');
  await t.close();
}

async function caseD(s, env) {
  var t = await env.open({ motionStub: !REAL, init: function () { window.__motion = { seenOrient: true, seenMotion: false, heading: 0 }; } });
  await feed(t, 'orient');
  await openTune(t);
  await t.page.tap('#opt-tilt');
  await sleep(3200);
  var d = await state(t);
  s.check('(d) orientation only: the switch stays on', d.checked && d.on, JSON.stringify({ checked: d.checked, on: d.on }));
  await tune.close(t);
  await sleep(100);
  // a hard shake reported without devicemotion is never felt
  await t.eval(function () {
    if (window.__motionStub) { window.__motion.x = 2; window.__motion.y = 1; }
    window.__dMax = 0;
    __rec.start(function (H) { var a = Math.abs(H.sim.mAx) + Math.abs(H.sim.mAy); if (a > window.__dMax) window.__dMax = a; return 0; });
    window.Hourglass.start();
  });
  await sleep(1200);
  var felt = await t.eval(function () { __rec.stop(); return { m: window.__dMax, seen: window.Hourglass.motion.seenMotion }; });
  s.check('(d) ... and shaking is disabled (the sim feels nothing)', felt.m === 0 && felt.seen === false,
          'max |A| ' + felt.m.toFixed(1) + ' cells/s², seenMotion ' + felt.seen);
  await t.eval(function () { if (window.__orientOnly) clearInterval(window.__orientOnly); });
  await H.invariants(s, t, '(d)');
  await t.close();
}

async function caseE(s, env) {
  var stored = {};
  stored[SETTINGS] = { tilt: true };
  var t = await env.open({
    motionStub: !REAL, storage: stored,
    init: function () { window.__motion = { seenOrient: false, seenMotion: false }; }
  });
  await sleep(1600);
  var e1 = await state(t);
  s.check('(e) reloaded with Real motion on: the switch stays checked', e1.checked && e1.on, JSON.stringify({ checked: e1.checked, on: e1.on }));
  s.check('(e) ... nothing is asked at start-up', e1.perms.motion === 0 && e1.perms.orient === 0 && (REAL || e1.requests === 0),
          'counts ' + e1.perms.motion + '/' + e1.perms.orient + (REAL ? '' : ', request() ' + e1.requests));
  var shown = function () { return t.eval(function () { return !document.getElementById('btn-motion').hidden; }); };
  var st0 = await t.eval(function () { return window.Hourglass.timer.state; });
  s.check('(e) ... a tilt button waits in the top bar', await shown());
  var g = await t.glass();
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(400);
  var e2 = await state(t), st1 = await t.eval(function () { return window.Hourglass.timer.state; });
  s.check('(e) a tap on the glass asks nothing: it starts the glass, as a tap does', e2.perms.motion === 0 && e2.perms.orient === 0 && (REAL || e2.requests === 0) &&
          st0 === 'idle' && st1 === 'running' && (await shown()), 'counts ' + e2.perms.motion + '/' + e2.perms.orient + ', ' + st0 + ' → ' + st1);
  var c = await t.eval(function () { var r = document.getElementById('btn-motion').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await t.touch.tap(c.x, c.y, 60);
  await sleep(300);
  await feed(t, 'both');                                   // access granted: the events start
  var e3 = await state(t);
  s.check('(e) a tap on the tilt button asks once', e3.perms.motion === 1 && e3.perms.orient === 1 && (REAL || e3.requests === 1),
          'counts ' + e3.perms.motion + '/' + e3.perms.orient + (REAL ? '' : ', request() ' + e3.requests) +
          ', isActive ' + e3.perms.motionActive[0] + ', in ' + e3.perms.motionIn[0]);
  s.check('(e) ... with user activation', e3.perms.motionActive[0] === true);
  s.check('(e) ... and the button is gone', !(await shown()));
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(300);
  var e3b = await state(t);
  s.check('(e) ... and nothing asks again', e3b.perms.motion === 1 && (REAL || e3b.requests === 1), 'after another tap: ' + e3b.perms.motion);
  await sleep(2600);
  var e4 = await state(t);
  s.check('(e) ... and Real motion stays on once data flows', e4.checked && e4.on);
  await H.invariants(s, t, '(e)');
  await t.close();

  // allowed already (the same session, a reload): the readings arrive unasked, and the button never shows
  t = await env.open({
    motionStub: !REAL, storage: stored,
    init: function () { window.__motion = { seenOrient: false, seenMotion: false }; }
  });
  await sleep(400);
  await feed(t, 'both');
  await sleep(1600);
  var e5 = await state(t), hid = await t.eval(function () { return document.getElementById('btn-motion').hidden; });
  s.check('(e) where the readings arrive unasked, the tilt button never shows and nothing is asked', hid && e5.on && e5.perms.motion === 0 && (REAL || e5.requests === 0),
          'hidden ' + hid + ', counts ' + e5.perms.motion + '/' + e5.perms.orient);
  await t.close();
}

(async function main() {
  var s = new H.Suite(REAL ? 'e2e-permission (E12, real motion.js)' : 'app-permission');
  var env = await H.start();
  try {
    await caseA(s, env);
    await caseB(s, env);
    await caseC(s, env);
    await caseD(s, env);
    await caseE(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
