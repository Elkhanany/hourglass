/*
 * Controller acceptance 13 (REGRESSION SMOKE): the existing flow still
 * works, and integration E1/E11 checks of the shell.
 *   - duration pills and a custom duration; start; the Flip button (2.6 s,
 *     swaps the time); no Zen by itself, Zen by the Zen button; the end
 *     leaves Zen as it is; pour adds exactly the time its sand is worth
 *   - the main screen is as lean as before: the same buttons, the same Tune
 *     rows, the switch now reads 'Real motion'
 *   - the service worker caches its current VERSION (sw.js), motion.js included,
 *     and the sand engine (realsand/, for Real sand offline); it leaves the lab
 *     (lab/) to the network and never caches it, and a lab page gets a new
 *     engine at once: the engine's requests from a lab page go to the network
 *     and are never stored, while the app is answered from its cache; a lab
 *     page that meets an engine of another build says so and leaves the app's
 *     cache whole, and the app then starts offline
 *   - no page errors
 *   - the harness serves the tree as it is: every script index.html loads,
 *     byte for byte, but the motion stub when a test asks for it, which is
 *     served at motion.js's own path (nothing is added to app.js)
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
      top: document.querySelectorAll('#hud-top button').length, tiltHidden: document.getElementById('btn-motion').hidden,
      bottom: document.querySelectorAll('#hud-bottom button').length,
      rows: document.querySelectorAll('#sheet-settings .row').length,
      tilt: row.querySelector('b').textContent,
      aria: document.getElementById('stage').getAttribute('aria-label'),
      spill: !!document.querySelector('#zoom > #c-spill')
    };
  });
  s.check('UI: the main screen has the same buttons (5 top, the tilt button hidden, the background\'s moon among them; 12 bottom: six duration pills); Tune has 15 rows (with Layered sand, Grain, Light, Breathing pace, the custom sand\'s colour, the Sound tab\'s Fade out before the end and Sound in silent mode, the Time tab\'s Show when it ends and the Glass tab\'s Background)',
          ui.top === 5 && ui.tiltHidden && ui.bottom === 12 && ui.rows === 15, JSON.stringify(ui));
  s.check('UI: the Tune switch reads "Real motion"', ui.tilt === 'Real motion', '"' + ui.tilt + '"');
  s.check('UI: the stage says how to play with the glass', ui.aria === 'Hourglass. Tap to start or pause. Drag to move or turn it. Spread two fingers for Zen, pinch them to come back.');
  s.check('UI: #c-spill sits in the zoom, outside the glass', ui.spill);

  // duration pills, custom
  await t.page.tap('#durations .pill[data-min="1"]');
  await sleep(1400);
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

  // Zen and the end: only the Zen button and a pinch change the view
  await t.eval(function () { window.Hourglass.setDuration(10000); });
  await sleep(1400);
  var g = await t.glass();
  var zenOn = function () { return t.eval(function () { return document.getElementById('app').classList.contains('zen'); }); };
  await t.touch.tap(g.cx, g.cy, 60);
  await sleep(5000);
  s.check('FLOW: running brings no Zen by itself (5 s after starting)', !(await zenOn()));
  await t.page.tap('#btn-zen');
  await sleep(300);
  s.check('FLOW: the Zen button brings Zen', await zenOn());
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

/** What the page is served: each script index.html loads, as the tree has it, but a stand-in asked for. */
async function testServed(s, env) {
  var fs = require('fs'), path = require('path'), paths = require('./lib/paths.js');
  var scripts = paths.classicScripts(env.root), standIns = env.standIns;
  for (var k = 0; k < 2; k++) {
    var stub = k === 0;
    var t = await env.open({ motionStub: stub });
    var got = await t.eval(function (list) {
      return Promise.all(list.map(function (f) { return fetch(f, { cache: 'no-store' }).then(function (r) { return r.text(); }); }))
        .then(function (txt) { return { txt: txt, stub: !!window.__motionStub }; });
    }, scripts);
    var asIs = [], stoodIn = [], changed = [];
    scripts.forEach(function (f, i) {
      var file = fs.readFileSync(path.join(env.root, f), 'utf8'), standIn = stub && standIns['/' + f];
      if (!standIn) (got.txt[i] === file ? asIs : changed).push(f);
      // (the control: the stand-in's text is not the file's, so a file served otherwise is seen)
      else if (got.txt[i] === fs.readFileSync(standIn, 'utf8') && got.txt[i] !== file) stoodIn.push(f);
      else changed.push(f);
    });
    if (stub) {
      s.check('SERVED: with the motion stub asked for, ' + asIs.join(', ') + ' are served as the tree has them, and motion.js\'s own path answers with the stub (the page runs it)',
              changed.length === 0 && stoodIn.length === 1 && path.posix.basename(stoodIn[0]) === 'motion.js' && asIs.length === scripts.length - 1 && got.stub,
              JSON.stringify({ changed: changed, stoodIn: stoodIn, stub: got.stub }));
    } else {
      s.check('SERVED: without it, every script index.html loads (' + scripts.join(', ') + ') is served as the tree has it',
              changed.length === 0 && asIs.length === scripts.length && !got.stub, JSON.stringify({ changed: changed, stub: got.stub }));
    }
    await t.close();
  }
}

async function testServiceWorker(s, root) {
  // a copy of the tree, so that the server can serve a new release of the engine midway
  var fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
  var copy = fs.mkdtempSync(path.join(os.tmpdir(), 'hourglass-sw-'));
  fs.cpSync(root, copy, { recursive: true, filter: function (src) { var b = path.basename(src); return b !== '.git' && b !== 'node_modules'; } });
  var swSrc = fs.readFileSync(path.join(copy, 'sw.js'), 'utf8'), ctx = { self: { addEventListener: function () {} }, URL: URL };
  vm.runInNewContext(swSrc, ctx);
  var engine = ctx.SHELL.filter(function (u) { return u.indexOf('./realsand/') === 0; }).map(function (u) { return u.slice(1); });
  var env = await H.start({ root: copy });
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
    s.check('SW: the cache is ' + ctx.VERSION + ' (sw.js VERSION)', c.keys.indexOf(ctx.VERSION) >= 0, JSON.stringify(c.keys));
    var motionAt = '/' + require('./lib/paths.js').script('motion.js', copy);
    s.check('SW: ... and it holds .' + motionAt, c.files.indexOf(motionAt) >= 0, c.files.length + ' files');
    var notCached = engine.filter(function (p) { return c.files.indexOf(p) < 0; });
    s.check('SW: ... and the sand engine for Real sand offline (' + engine.length + ' files under realsand/: modules, shaders, licences)',
            engine.length >= 30 && notCached.length === 0, notCached.join(', '));
    // A new release of the engine and the lab together: the app keeps its cached engine (it
    // loads one only with Real sand on, from the cache, as the rest of the shell), and a lab
    // page gets the new one at once, from the network, without it being stored.
    var B = 'sw-test-B';
    fs.writeFileSync(path.join(copy, 'realsand', 'build.mjs'), fs.readFileSync(path.join(copy, 'realsand', 'build.mjs'), 'utf8').replace(/export const BUILD = '[^']+'/, "export const BUILD = '" + B + "'"));
    fs.writeFileSync(path.join(copy, 'lab', 'sand', 'main.mjs'), fs.readFileSync(path.join(copy, 'lab', 'sand', 'main.mjs'), 'utf8').replace(/const BUILD_EXPECTED = '[^']+'/, "const BUILD_EXPECTED = '" + B + "'"));
    fs.appendFileSync(path.join(copy, 'realsand', 'shaders', 'grains.wgsl'), '\n// ' + B + '\n');
    var app = await t.eval(function () {
      return fetch('realsand/build.mjs').then(function (r) { return r.text(); }).then(function (txt) {
        return { ctl: !!navigator.serviceWorker.controller, stamp: (/export const BUILD = '([^']+)'/.exec(txt) || [])[1] };
      });
    });
    s.check('SW: the app page is controlled by the worker, and its engine comes from the cache (the stamp it was installed with)',
            app.ctl && !!app.stamp && app.stamp !== B, JSON.stringify(app));
    var lp = await t.context.newPage();
    var labErrors = [];
    lp.on('pageerror', function (e) { labErrors.push(String(e && e.message)); });
    await lp.goto(env.url + 'lab/sand/index.html');
    await lp.waitForFunction(function () { return !!window.__lab; }, null, { timeout: 15000 });
    var lab = await lp.evaluate(function (B) {
      var get = function (u) { return fetch(u).then(function (r) { return r.text().then(function (txt) { return { ok: r.ok, txt: txt }; }); }); };
      return Promise.all([get('index.html'), get('../../realsand/shaders/grains.wgsl')]).then(function (rs) {
        return { ctl: !!navigator.serviceWorker.controller, ok: rs[0].ok, page: rs[0].txt.indexOf('Sand lab') >= 0,
                 build: window.__lab.build(), shaderNew: rs[1].ok && rs[1].txt.indexOf('// ' + B) >= 0 };
      });
    }, B);
    s.check('SW: a lab page (controlled too) gets the new engine at once: its modules and its shaders come from the network',
            lab.ctl && lab.ok && lab.page && lab.build.build === B && lab.build.expected === B && lab.shaderNew, JSON.stringify(lab));
    var after = await t.eval(function (B) {
      return new Promise(function (r) { setTimeout(r, 800); }).then(function () { return caches.keys(); }).then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return caches.open(k).then(function (cache) {
            return cache.keys().then(function (reqs) {
              return Promise.all(reqs.map(function (q) {
                var p = new URL(q.url).pathname;
                if (p.indexOf('/realsand/shaders/grains.wgsl') < 0) return { p: p };
                return cache.match(q).then(function (res) { return res.text(); }).then(function (txt) { return { p: p, fresh: txt.indexOf('// ' + B) >= 0 }; });
              }));
            });
          });
        }));
      }).then(function (lists) {
        var all = [].concat.apply([], lists);
        return { lab: all.filter(function (e) { return e.p.indexOf('/lab/') === 0; }).map(function (e) { return e.p; }),
                 grains: all.filter(function (e) { return e.p.indexOf('/realsand/shaders/grains.wgsl') >= 0; }) };
      });
    }, B);
    s.check('SW: lab/ pages are never cached, and what a lab page fetched of the engine was not stored (the cached shader is the installed one)',
            after.lab.length === 0 && after.grains.length === 1 && after.grains[0].fresh === false, JSON.stringify(after));
    // Should a lab page meet an engine of another build all the same (here: the lab written for
    // build C, the engine at B), it says so, with both stamps, and leaves the app's cache alone:
    // the app's installed copy is a snapshot only an install writes (sw.js), and a file taken out
    // of it would come back only online. (Before the snapshot worker the lab dropped the engine from the app's
    // caches and loaded once more; app-upgrade runs that lab, 13a9772's, as its control.)
    fs.writeFileSync(path.join(copy, 'lab', 'sand', 'main.mjs'), fs.readFileSync(path.join(copy, 'lab', 'sand', 'main.mjs'), 'utf8').replace(/const BUILD_EXPECTED = '[^']+'/, "const BUILD_EXPECTED = 'sw-test-C'"));
    var engineCached = function () {
      return caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('hourglass-') === 0; }).map(function (k) {
          return caches.open(k).then(function (c) { return c.keys(); }).then(function (reqs) {
            return reqs.filter(function (q) { return new URL(q.url).pathname.indexOf('/realsand/') >= 0; }).length;
          });
        }));
      }).then(function (n) { return n.reduce(function (a, b) { return a + b; }, 0); });
    };
    var cached0 = await t.eval(engineCached);
    var loads = 0;
    lp.on('load', function () { loads++; });
    await lp.reload();
    await lp.waitForFunction(function () { return !!window.__lab && window.__lab.build().expected === 'sw-test-C'; }, null, { timeout: 15000 });
    await sleep(2500);
    var mixed = await lp.evaluate(function () {
      return { build: window.__lab.build(), status: document.getElementById('status').textContent, mark: sessionStorage.getItem('hourglass.lab.purged') };
    });
    var cached1 = await t.eval(engineCached);
    s.check('SW: a lab page that meets an engine of another build leaves the app\'s cache whole (its ' + cached0 + ' engine files), says so with both stamps, and loads once only',
            cached0 === engine.length && cached1 === cached0 && loads === 1 && mixed.build.build === B && mixed.mark === null &&
            mixed.status.indexOf('build ' + B) >= 0 && mixed.status.indexOf('build sw-test-C') >= 0 && /reload with a connection/i.test(mixed.status),
            JSON.stringify({ cachedBefore: cached0, cachedAfter: cached1, loads: loads, lab: mixed }));
    s.check('SW: no page or console errors', t.errors.length === 0 && labErrors.length === 0, t.errors.concat(labErrors).slice(0, 3).join(' | '));
    await lp.close();
    // ... and then the app starts offline, from its cache (the server stopped, the page offline)
    await t.context.setOffline(true);
    await new Promise(function (r) { env.server.close(function () { r(); }); if (env.server.closeAllConnections) env.server.closeAllConnections(); });
    var bad = [];
    t.page.on('response', function (r) { if (r.status() >= 400) bad.push(r.status() + ' ' + new URL(r.url()).pathname); });
    t.page.on('requestfailed', function (q) { bad.push('failed ' + new URL(q.url()).pathname); });
    t.errors.length = 0;
    await t.page.reload();
    var off = await t.page.waitForFunction(function () { return !!(window.Hourglass && window.Hourglass.sim); }, null, { timeout: 15000 })
      .then(function () { return t.eval(function () { return { sim: !!window.Hourglass.sim, ctl: !!navigator.serviceWorker.controller }; }); },
            function (e) { return { error: String(e && e.message).split('\n')[0] }; });
    var cached2 = await t.eval(engineCached);
    s.check('SW: ... and the app then starts offline, from its cache (Hourglass.sim, no page errors, no failed or 504 responses), the engine\'s files all still there',
            off.sim === true && off.ctl === true && t.errors.length === 0 && bad.length === 0 && cached2 === cached0,
            JSON.stringify({ off: off, errors: t.errors.slice(0, 3), bad: bad.slice(0, 5), cached: cached2 }));
    // (the control: the count sees one engine file taken out)
    var cached3 = await t.eval(function (f) {
      return caches.keys().then(function (keys) {
        return caches.open(keys.filter(function (k) { return k.indexOf('hourglass-') === 0; })[0]).then(function (c) { return c.delete(f); });
      });
    }, '.' + engine[0]).then(function () { return t.eval(engineCached); });
    s.check('SW: ... and that count sees an engine file taken out of the cache (control)', cached3 === cached0 - 1, cached3 + ' of ' + cached0);
    await t.close();
  } finally {
    await env.close();
    try { fs.rmSync(copy, { recursive: true, force: true }); } catch (e) {}
  }
}

async function main() {
  var s = new H.Suite('app-regression');
  var env = await H.start();
  var root = env.root;
  try {
    await testFlow(s, env);
    await testServed(s, env);
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
