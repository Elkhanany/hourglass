/*
 * Controller acceptance 13 (REGRESSION SMOKE): the existing flow still
 * works, and integration E1/E11 checks of the shell.
 *   - duration pills and a custom duration; start; the Flip button (2.6 s,
 *     swaps the time); no Zen by itself, Zen by the moon button; the end
 *     leaves Zen as it is; pour adds exactly the time its sand is worth
 *   - the main screen is as lean as before: the same buttons, the same Tune
 *     rows, the switch now reads 'Real motion'
 *   - the service worker caches its current VERSION (sw.js), motion.js included
 *   - no page errors
 *
 *   node tools/test/app-regression.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;
var CFG = { stub: true };          // drive the motion stub (e2e-calm.test.js runs these on the real modules)

async function testFlow(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  // the lean main screen
  var ui = await t.eval(function () {
    var row = document.getElementById('opt-tilt').closest('.row');
    return {
      top: document.querySelectorAll('#hud-top button').length,
      bottom: document.querySelectorAll('#hud-bottom button').length,
      rows: document.querySelectorAll('#sheet-settings .row').length,
      tilt: row.querySelector('b').textContent,
      aria: document.getElementById('stage').getAttribute('aria-label'),
      spill: !!document.querySelector('#zoom > #c-spill')
    };
  });
  s.check('UI: the main screen has the same buttons (3 top, 12 bottom: six duration pills); Tune has 8 rows (with Layered sand and Breathing pace)',
          ui.top === 3 && ui.bottom === 12 && ui.rows === 8, JSON.stringify(ui));
  s.check('UI: the Tune switch reads "Real motion"', ui.tilt === 'Real motion', '"' + ui.tilt + '"');
  s.check('UI: the stage says how to play with the glass', ui.aria === 'Hourglass. Tap to start or pause. Drag to move or turn it. Spread two fingers for Zen, pinch them to come back.');
  s.check('UI: #c-spill sits in the zoom, outside the glass', ui.spill);

  // duration pills, custom
  await t.page.tap('#durations .pill[data-min="1"]');
  await sleep(700);
  var d1 = await t.eval(function () { return { ms: window.Hourglass.timer.durationMs, rem: window.Hourglass.timer.rem }; });
  s.check('FLOW: the 1 min pill gives a 1 min glass', d1.ms === 60000 && d1.rem === 60000, JSON.stringify(d1));
  await t.page.tap('#pill-custom');
  await sleep(700);
  await t.page.tap('#sheet-custom .step[data-step="sec:+5"]');
  await sleep(500);
  await t.page.tap('#custom-set');
  await sleep(1000);
  var d2 = await t.eval(function () { return window.Hourglass.timer.durationMs; });
  s.check('FLOW: a custom duration (1:05)', d2 === 65000, d2 + ' ms');

  // start, and the Flip button
  await t.page.tap('#btn-play');
  await sleep(1500);
  var st = await t.eval(function () { return window.Hourglass.timer.state; });
  s.check('FLOW: the play button starts it', st === 'running', st);
  var f0 = await t.eval(function () {
    var H = window.Hourglass;
    window.__flip = { t0: performance.now(), t1: -1, want: H.remAt(H.sim.total - H.sim.nTop) };
    __mon.flips = 0;
    (function watch() {
      if (!H.flip.active && window.__flip.seen) { window.__flip.t1 = performance.now(); window.__flip.rem = H.timer.rem; window.__flip.state = H.timer.state; return; }
      if (H.flip.active && !window.__flip.seen) {
        // the neck is shut for the whole turn: the time on the far side is set now
        window.__flip.seen = true;
        window.__flip.want = H.remAt(H.sim.total - H.sim.nTop);
      }
      requestAnimationFrame(watch);
    })();
    return window.__flip.want;
  });
  await t.page.tap('#btn-flip');
  await sleep(3300);
  var f = await t.eval(function () { return { f: window.__flip, flips: __mon.flips }; });
  var dur = f.f.t1 - f.f.t0;
  s.check('FLOW: the Flip button turns it in 2.6 s', f.f.t1 > 0 && dur >= 2550 && dur <= 2850, dur.toFixed(0) + ' ms');
  s.check('FLOW: ... and swaps the time', f.flips === 1 && Math.abs(f.f.rem - f.f.want) < 40 && f.f.state === 'running',
          'rem ' + (f.f.rem / 1000).toFixed(2) + ' s, expected ' + (f.f.want / 1000).toFixed(2) + ' s, ' + f.f.state);

  // pour: more sand, exactly the time it is worth (paused, so the clock stands still)
  await t.eval(function () {
    var H = window.Hourglass, pour = H.sim.pour;
    H.pause();
    window.__pour = { rem0: H.timer.rem, made: [] };
    H.sim.pour = function (n) { var m = pour.call(H.sim, n); window.__pour.made.push(m); return m; };
  });
  var box = await t.page.$eval('#btn-sand', function (el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await t.touch.down(box.x, box.y);
  await sleep(500);
  await t.touch.up();
  await sleep(400);
  var p = await t.eval(function () {
    var H = window.Hourglass, rem = window.__pour.rem0, m = window.__pour.made, made = 0;
    for (var i = 0; i < m.length; i++) { if (m[i]) rem = H.remAt(H.topAt(rem) + m[i]); made += m[i]; }
    return { want: rem, got: H.timer.rem, made: made, rem0: window.__pour.rem0 };
  });
  s.check('FLOW: pour adds time: T.rem → remAt(topAt(rem) + made)', p.made > 50 && Math.abs(p.got - p.want) < 1e-6,
          p.made + ' grains: ' + (p.rem0 / 1000).toFixed(2) + ' → ' + (p.got / 1000).toFixed(2) + ' s (expected ' + (p.want / 1000).toFixed(2) + ')');

  // Zen and the end: only the moon button and a pinch change the view
  await t.eval(function () { window.Hourglass.setDuration(10000); });
  await sleep(900);
  var g = await t.glass();
  var zenOn = function () { return t.eval(function () { return document.getElementById('app').classList.contains('zen'); }); };
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(5000);
  s.check('FLOW: running brings no Zen by itself (5 s after starting)', !(await zenOn()));
  await t.page.tap('#btn-zen');
  await sleep(300);
  s.check('FLOW: the moon button brings Zen', await zenOn());
  await t.page.waitForFunction(function () { return window.Hourglass.timer.state === 'done'; }, null, { timeout: 15000 });
  var e = await t.eval(function () {
    var H = window.Hourglass;
    return { main: document.getElementById('t-main').textContent, zen: document.getElementById('app').classList.contains('zen'),
             t: performance.now(), status: document.getElementById('status').textContent };
  });
  s.check('FLOW: the end: 00:00, "Time"', e.main === '00:00' && /Time/.test(e.status), e.main + ' / ' + e.status);
  await sleep(1200);
  var held = await zenOn();
  await sleep(2600);
  var still = await zenOn();
  s.check('FLOW: the end of a glass leaves Zen as it is', e.zen && held && still,
          'at the end ' + e.zen + ', 1.2 s later ' + held + ', 3.8 s later ' + still);
  await t.touch.pinch(g.cx, g.cy, 230, 90, 260);
  await sleep(300);
  s.check('FLOW: two fingers pinching together bring the controls back', !(await zenOn()));
  var wl = await t.eval(function () { return window.Hourglass.wakeState(); });
  s.check('FLOW: the wake-lock state reports', typeof wl === 'string' && wl.length > 0, wl);
  await H.invariants(s, t, 'FLOW');
  await t.close();
}

async function testServiceWorker(s, root) {
  var env = await H.start({ root: root, needMotionFile: true });
  try {
    var t = await env.open({ motionStub: CFG.stub, serviceWorkers: true });
    var c = await t.eval(function () {
      return navigator.serviceWorker.ready.then(function () {
        return new Promise(function (r) { setTimeout(r, 1500); });
      }).then(function () { return caches.keys(); }).then(function (keys) {
        var key = keys.filter(function (k) { return k.indexOf('hourglass-v') === 0; })[0] || 'none';
        return caches.open(key).then(function (cache) { return cache.keys(); }).then(function (reqs) {
          return { keys: keys, files: reqs.map(function (q) { return new URL(q.url).pathname; }) };
        });
      });
    });
    var SWV = /VERSION = '([^']+)'/.exec(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'sw.js'), 'utf8'))[1];
    s.check('SW: the cache is ' + SWV + ' (sw.js VERSION)', c.keys.indexOf(SWV) >= 0, JSON.stringify(c.keys));
    s.check('SW: ... and it holds ./motion.js', c.files.indexOf('/motion.js') >= 0, c.files.length + ' files');
    s.check('SW: no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
    await t.close();
  } finally {
    await env.close();
  }
}

async function main() {
  var s = new H.Suite('app-regression');
  var env = await H.start();
  var root = env.root;
  try {
    await testFlow(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  try {
    await testServiceWorker(s, root);
  } catch (e) {
    s.check('no exception (service worker)', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  }
  s.done();
}

module.exports = { CFG: CFG, testFlow: testFlow, testServiceWorker: testServiceWorker };
if (require.main === module) main();
