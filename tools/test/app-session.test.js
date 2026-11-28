/*
 * Controller acceptance 11 (SESSION AND RESET), and integration E9/E10.
 *
 *  - A crack (forced), then a reload: the crack comes back (same segment,
 *    breach and seed) and is drawn; the timer comes back within 100 ms.
 *  - Reset: no cracks, no spilled sand, a full new glass (total = grainsFor,
 *    nothing lost) within 0.8 s, and the crack's pixels are gone.
 *  - The app's shortcut ("./?t=300", manifest.json) over a saved session of
 *    the same glass: the session gives way to it (a new glass, idle, 5:00);
 *    a plain launch before it, the control, picks the running glass up.
 *  - Launched at "./?t=300", the preset is applied once and ?t= leaves the
 *    address: a running glass is kept, with its time, through the browser's
 *    reload and the app's own for "Use this shape" and Grain (Real sand's switch,
 *    whose reload was a third, went in 1.22.0), and
 *    a duration picked after the launch is kept (a pill, then a reload). The
 *    control: a copy of app.js that leaves ?t= in the address loses them.
 *
 *   node tools/test/app-session.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;

var SEG = 156;                       // lower bulb, right side, u ≈ 0.91 (the dome)
var CFG = { stub: true };            // drive the motion stub (e2e-session.test.js runs this on the real modules)

/** Pixels of c-front within `cells` of crack k's chip, as a flat array (canvas px). */
function frontPatch(t, k, cells) {
  return t.eval(function (a) {
    var H = window.Hourglass, sim = H.sim, r = H.renderer, c = document.getElementById('c-front');
    var at = r.chipVessel(a.k, {});
    if (!at) at = a.at;
    if (!at) return null;
    var S = r.scale * r.dpr, x = c.width / 2 + (at.x - sim.geo.cx) * S, y = c.height / 2 + (at.y - sim.geo.cy) * S;
    var R = Math.ceil(a.cells * S), x0 = Math.max(0, Math.round(x - R)), y0 = Math.max(0, Math.round(y - R));
    var w = Math.min(c.width - x0, 2 * R), h = Math.min(c.height - y0, 2 * R);
    var d = c.getContext('2d').getImageData(x0, y0, w, h).data;
    return { at: { x: at.x, y: at.y }, px: Array.prototype.slice.call(d) };
  }, { k: k, cells: cells, at: null });
}
function diffCount(a, b) {
  var n = 0;
  for (var i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]) > 24) n++;
  }
  return n;
}

/**
 * The scenario. opts.seg: where to crack it; opts.leak: before Reset, wait
 * for the breach to leak and the escaped sand to reach the spill (E10).
 */
async function run(s, env, opts) {
  opts = opts || {};
  var t = await env.open({ motionStub: CFG.stub });
  try {
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    var cr = await t.eval(function (seg) {
      var c = window.Hourglass.debug.forceCrack(seg, 40, 2);
      return { seg: c.seg, w: c.w, seed: c.seed, x: c.x, y: c.y };
    }, opts.seg === undefined ? SEG : opts.seg);
    await sleep(1000);
    var before = await t.eval(function () {
      var H = window.Hourglass;
      return { rem: H.timer.rem, state: H.timer.state, now: Date.now(), lost: H.sim.lost, total: H.sim.total };
    });
    var drawnBefore = await frontPatch(t, 0, 6);
    await t.reload();
    await sleep(400);
    var after = await t.eval(function () {
      var H = window.Hourglass, c = H.sim.cracks[0];
      return { n: H.sim.cracks.length, seg: c && c.seg, w: c && c.w, seed: c && c.seed, rem: H.timer.rem, state: H.timer.state,
               now: Date.now(), lost: H.sim.lost };
    });
    s.check('SESSION: one crack restored, same segment, breach and seed', after.n === 1 && after.seg === cr.seg && after.w === cr.w && after.seed === cr.seed,
            JSON.stringify({ was: [cr.seg, cr.w, cr.seed], now: [after.seg, after.w, after.seed], n: after.n }));
    s.check('SESSION: the lost-sand count came back too', after.lost >= before.lost, before.lost + ' → ' + after.lost);
    var expect = before.rem - (after.now - before.now);
    s.check('SESSION: timer state and time restored within 100 ms', after.state === before.state && Math.abs(after.rem - expect) <= 100,
            after.state + ', rem ' + after.rem.toFixed(0) + ' vs ' + expect.toFixed(0) + ' ms');
    var drawnAfter = await frontPatch(t, 0, 6);
    var same = drawnBefore && drawnAfter ? drawnBefore.px.length === drawnAfter.px.length && diffCount(drawnBefore.px, drawnAfter.px) < 30 : false;
    t.__drawn = drawnAfter;
    s.check('SESSION: the restored crack is drawn on c-front as before', same,
            drawnAfter ? diffCount(drawnBefore.px, drawnAfter.px) + ' px differ from before the reload' : 'no patch');

    if (opts.leak) {
      // E10 starts from a glass that has leaked, with sand on the desk
      try {
        await t.page.waitForFunction(function () { var H = window.Hourglass; return H.sim.lost > 0 && H.spill.count > 0; },
                                     null, { timeout: 6000, polling: 100 });
      } catch (e) {}
      var lk = await t.eval(function () { return { lost: window.Hourglass.sim.lost, spill: window.Hourglass.spill.count }; });
      s.check('RESET (E10): the breach leaked and the sand reached the desk first', lk.lost > 0 && lk.spill > 0,
              'lost ' + lk.lost + ', spill.count ' + lk.spill);
    }

    // Reset: a new glass inside the cross-fade
    var pre = drawnAfter;
    await t.page.tap('#btn-reset');
    await sleep(1400);
    var rs = await t.eval(function () {
      var H = window.Hourglass;
      return { n: H.sim.cracks.length, spill: H.spill.count, total: H.sim.total, want: H.grainsFor(H.timer.durationMs), lost: H.sim.lost,
               mode: H.body.mode, state: H.timer.state };
    });
    s.check('RESET: no cracks and no spilled sand after 0.8 s', rs.n === 0 && rs.spill === 0, JSON.stringify({ cracks: rs.n, spill: rs.spill }));
    s.check('RESET: a full new glass, nothing lost', rs.total === rs.want && rs.lost === 0, 'total ' + rs.total + ' / ' + rs.want + ', lost ' + rs.lost);
    await sleep(200);
    var gone = await t.eval(function (a) {
      var H = window.Hourglass, sim = H.sim, r = H.renderer, c = document.getElementById('c-front');
      var S = r.scale * r.dpr, x = c.width / 2 + (a.x - sim.geo.cx) * S, y = c.height / 2 + (a.y - sim.geo.cy) * S;
      var R = Math.ceil(6 * S), x0 = Math.max(0, Math.round(x - R)), y0 = Math.max(0, Math.round(y - R));
      var w = Math.min(c.width - x0, 2 * R), h = Math.min(c.height - y0, 2 * R);
      return Array.prototype.slice.call(c.getContext('2d').getImageData(x0, y0, w, h).data);
    }, pre.at);
    s.check('RESET: the crack\'s pixels are gone from c-front', diffCount(pre.px, gone) > 40,
            diffCount(pre.px, gone) + ' px changed where the crack was');
    await H.invariants(s, t, 'SESSION/RESET');
  } finally {
    await t.close();
  }
}

/**
 * A launch by the app's shortcut over a saved session. The glass is started and left running;
 * a plain launch brings it back (the control: the session is there to be had), and "./?t=300",
 * which asks for the very duration the session has, starts a new glass all the same.
 */
async function shortcut(s, env) {
  var t = await env.open({ motionStub: CFG.stub });
  async function launch(query) {
    await t.page.goto(env.url + query);
    await t.page.waitForFunction(function () { return window.Hourglass && window.__mon && window.__mon.hooked; }, null, { timeout: 15000 });
    await sleep(300);
    return t.eval(function () {
      var T = window.Hourglass.timer;
      return { state: T.state, rem: Math.round(T.rem), durationMs: T.durationMs, session: localStorage.getItem('hourglass.session.v1') !== null };
    });
  }
  try {
    await t.eval(function () { window.Hourglass.start(); });
    await sleep(1500);
    var plain = await launch(''), asked = await launch('?t=300');
    s.check('SHORTCUT: a plain launch picks the running 5-minute glass up again (control: the session is there)',
            plain.state === 'running' && plain.durationMs === 300000 && plain.rem < 299000 && plain.session, JSON.stringify(plain));
    s.check('SHORTCUT: "./?t=300" over that session is a new glass: idle, 5:00 to run, the session put away',
            asked.state === 'idle' && asked.durationMs === 300000 && asked.rem === 300000 && !asked.session, JSON.stringify(asked));
    s.check('SHORTCUT: no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  } finally {
    await t.close();
  }
}

/**
 * After a launch at "./?t=300": each way the page is loaded again keeps the running glass. `how`
 * is what reloads it; `pick` taps a pill first (a duration chosen after the launch). With
 * opts.leaveT, app.js is served without the line that takes ?t= out of the address (the control).
 */
var KEPT = [
  { name: 'the browser\'s reload', how: function (t) { return t.page.reload(); } },
  { name: '"Use this shape" (Delta)', how: function (t) {
      return t.eval(function () {
        var b = document.querySelector('#shapes [data-shape="delta"]'); b.click();
        document.getElementById('shape-use').click();
      });
    } },
  { name: 'another Grain', how: function (t) {
      return t.eval(function () {
        var bs = document.querySelectorAll('#grains [data-grain]');
        for (var i = 0; i < bs.length; i++) if (bs[i].getAttribute('aria-checked') !== 'true') { bs[i].click(); return; }
      });
    } },
  { name: 'the 15-minute pill after the launch, then the browser\'s reload', pick: 15, how: function (t) { return t.page.reload(); } }
];
async function shortcutKept(s, env, opts) {
  opts = opts || {};
  var out = [];
  var routes = [];
  if (opts.leaveT) {
    var src = require('fs').readFileSync(require('path').join(env.root, 'app.js'), 'utf8');
    var cut = src.replace(/\n *if \(qt\) try \{ history\.replaceState\([^\n]*\n/, '\n');
    if (cut === src) return [{ name: 'the control copy', ok: false, got: 'the line was not found in app.js' }];
    routes.push({ url: '**/app.js', handler: function (route) { route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: cut }); } });
  }
  for (var i = 0; i < KEPT.length; i++) {
    var k = KEPT[i], t = await env.open({ motionStub: CFG.stub, query: '?t=300', routes: routes });
    try {
      if (k.pick) {
        await t.eval(function (min) { document.querySelector('.pill[data-min="' + min + '"]').click(); }, k.pick);
        await sleep(400);
      }
      await t.eval(function () { window.Hourglass.start(); });
      await sleep(1500);
      var before = await t.eval(function () {
        var T = window.Hourglass.timer; window.__before = 1;
        return { search: location.search, state: T.state, durationMs: T.durationMs, rem: T.rem, now: Date.now() };
      });
      await k.how(t);
      await t.page.waitForFunction(function () { return !window.__before && window.Hourglass && window.__mon && window.__mon.hooked; }, null, { timeout: 20000 });
      await sleep(600);
      var after = await t.eval(function () {
        var T = window.Hourglass.timer, saved = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
        return { search: location.search, state: T.state, durationMs: T.durationMs, rem: T.rem, now: Date.now(), saved: saved.durationMs };
      });
      var want = (k.pick ? k.pick * 60000 : 300000), off = after.rem - (before.rem - (after.now - before.now));
      out.push({ name: k.name, ok: before.search === '' && before.state === 'running' && before.durationMs === want &&
                 after.state === 'running' && after.durationMs === want && after.saved === want && Math.abs(off) <= 150 && t.errors.length === 0,
                 got: 'before ' + JSON.stringify({ search: before.search, state: before.state, dur: before.durationMs }) +
                      ', after ' + JSON.stringify({ state: after.state, dur: after.durationMs, saved: after.saved }) + ', time left ' + Math.round(off) + ' ms off' +
                      (t.errors.length ? ', errors ' + t.errors.slice(0, 2).join(' | ') : '') });
    } finally {
      await t.close();
    }
  }
  return out;
}
async function shortcutReloads(s, env) {
  var got = await shortcutKept(s, env, {});
  got.forEach(function (r) {
    s.check('SHORTCUT KEPT: launched at "./?t=300", ?t= gone from the address, a running glass is kept with its time through ' + r.name, r.ok, r.got);
  });
  var ctl = await shortcutKept(s, env, { leaveT: true });
  var lost = ctl.filter(function (r) { return !r.ok; });
  s.check('SHORTCUT KEPT: ... and a copy of app.js that leaves ?t= in the address loses the glass in every one of them (control)',
          lost.length === KEPT.length, ctl.map(function (r) { return r.name + ': ' + r.got; }).join(' || ').slice(0, 900));
}

async function main() {
  var s = new H.Suite('app-session');
  var env = await H.start();
  try {
    await run(s, env, {});
    await shortcut(s, env);
    await shortcutReloads(s, env);
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
}

module.exports = { CFG: CFG, run: run, shortcut: shortcut, shortcutReloads: shortcutReloads };
if (require.main === module) main();
