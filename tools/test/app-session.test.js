/*
 * Controller acceptance 11 (SESSION AND RESET), and integration E9/E10.
 *
 *  - A crack (forced), then a reload: the crack comes back (same segment,
 *    breach and seed) and is drawn; the timer comes back within 100 ms.
 *  - Reset: no cracks, no spilled sand, a full new glass (total = grainsFor,
 *    nothing lost) within 0.8 s, and the crack's pixels are gone.
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

async function main() {
  var s = new H.Suite('app-session');
  var env = await H.start();
  try {
    await run(s, env, {});
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
}

module.exports = { CFG: CFG, run: run };
if (require.main === module) main();
