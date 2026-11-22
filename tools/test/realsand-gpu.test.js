#!/usr/bin/env node
/*
 * Real sand in the app on a real WebGPU engine (design 13.3, narrow): Chromium's software
 * adapter (SwiftShader), the app loaded with ?offscreen=1 (the engine draws into a texture shown
 * on a 2-D canvas, since this Chromium cannot read back a WebGPU canvas, and accepts the
 * software adapter; tests only). SwiftShader runs a substep of a 10 s glass in tens of
 * milliseconds, so the sand runs at a few hundredths of real time and the neck cannot keep up
 * with the clock: the glass empties through the app's catch-up and the residue transfer at its
 * end, and what is checked is that the app and the engine agree throughout, not the time of the
 * last grain (app-realsand checks that on a mock).
 *
 *  BOOT   the switch on: the engine starts (pipelines, self-test), adopts the CPU sand, and
 *         takes over: Hourglass.sim is the engine, "On", the canvas drawn, the GPU's points the
 *         ledger's, every readback's audit passes, the start-up times logged;
 *  RUN    a 10 s glass to its end: every audit passes, no point lost or outside, the count never
 *         0 while the GPU has a point above, and at the end none above;
 *  RESET  the new glass: its count, and the GPU filled with exactly its points, all above;
 *  FLIP   the full glass turned: the flip pass puts every point below, as the ledger says;
 *  and no page or console errors.
 *
 * It runs only when named (run-all.js realsand-gpu), about a minute; never two at once.
 *   node tools/test/realsand-gpu.test.js [--port 8908]
 */
'use strict';
var playwright = require('playwright');
var staticServer = require('./lib/static-server.js');
var path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var port = +process.env.PORT || 8908;
for (var i = 2; i < process.argv.length; i++) if (process.argv[i] === '--port') port = +process.argv[++i];
var count = 0, failures = 0, t0 = Date.now();
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + what + (detail ? '  — ' + detail : ''));
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** The engine's state as the page sees it. */
function probe(page) {
  return page.evaluate(function () {
    var H = window.Hourglass, rs = H.realSand, st = rs ? rs.stats() : null, a = rs && rs.audit ? rs.audit() : null;
    var c = document.getElementById('c-gpu'), px = -1;
    if (c) {
      try {
        var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        px = 0;
        for (var k = 3; k < d.length; k += 4 * 13) if (d[k] > 0) px++;
      } catch (e) { px = -2; }
    }
    return { live: !!rs && H.sim === rs, note: document.getElementById('realsand-note').textContent, state: H.timer.state,
      rem: H.timer.rem, nTop: H.sim.nTop, total: H.sim.total, want: H.grainsFor(H.timer.durationMs),
      pts: rs ? rs.valve.Pts(H.sim.total) : 0, points: rs ? rs.points : 0, tally: st && st.tally, audit: a, px: px,
      times: st && st.times, n: st && st.n, mode: st && st.mode, ratio: st && st.ratio, gen: rs ? rs._gen : 0 };
  });
}
/** A probe from a readback newer than now: three more runs read back, or the sand asleep (no runs: its last readback stands). */
async function fresh(page) {
  var g = await page.evaluate(function () { return window.Hourglass.realSand.stats().n.runs; });
  await page.waitForFunction(function (g) {
    var st = window.Hourglass.realSand.stats(), w = window.__fresh = window.__fresh || {};
    if (st.mode !== 'asleep') w.awake = performance.now();
    return !!st.tally && (st.n.runs > g + 2 || (st.inflight === 0 && performance.now() - (w.awake || 0) > 1500));
  }, g, { timeout: 90000, polling: 100 });
  await sleep(300);
  return probe(page);
}

(async function main() {
  var server = await new Promise(function (res, rej) { var s = staticServer.start(port, ROOT, function () { res(s); }); s.on('error', rej); });
  var browser = null, errors = [];
  try {
    browser = await playwright.chromium.launch({ channel: 'chromium',
      args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--disable-webgl', '--autoplay-policy=no-user-gesture-required'] });
    var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(function () {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('hourglass.settings.v1', JSON.stringify({ realSand: true, durationMs: 10000 }));
    });
    var page = await ctx.newPage();
    page.on('pageerror', function (e) { errors.push('pageerror: ' + (e && e.message)); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/?offscreen=1');

    /* ---- BOOT ------------------------------------------------------------ */
    await page.waitForFunction(function () {
      var H = window.Hourglass;
      return !!H && ((!!H.realSand && H.sim === H.realSand) || /Could not|Needs|Did not|updating/.test(document.getElementById('realsand-note').textContent));
    }, null, { timeout: 180000, polling: 200 });
    var b = await fresh(page);
    check(b.live && b.note === 'On', 'BOOT: the engine starts on WebGPU, adopts the CPU sand and takes over (Hourglass.sim is it, "On")', b.note);
    check(b.px > 100, 'BOOT: its canvas holds the drawn sand', b.px + ' sampled pixels drawn');
    check(!!b.tally && b.tally.points === b.points && b.points === b.pts && b.tally.nan === 0 && b.tally.outside === 0 && b.total === b.want,
          'BOOT: the GPU holds exactly the ledger\'s points for the glass, none lost or outside', JSON.stringify({ tally: b.tally, points: b.points, total: b.total }));
    check(!!b.audit && b.audit.ok, 'BOOT: the newest readback agrees with the ledger (audit)', JSON.stringify(b.audit));
    check(b.times && b.times.pipelines > 0 && b.times.selfTest > 0 && b.times.firstFrame > 0,
          'BOOT: the start-up times are logged (device, pipelines, self-test, first frame)', JSON.stringify(b.times));

    /* ---- RUN --------------------------------------------------------------- */
    await page.evaluate(function () { window.Hourglass.start(); });
    var bad = [], zeroAbove = 0, samples = 0, tStart = Date.now(), last = null;
    for (;;) {
      await sleep(400);
      var p = await probe(page);
      samples++;
      if (p.audit && !p.audit.ok && bad.length < 5) bad.push({ audit: p.audit, state: p.state });
      if (p.tally && (p.tally.nan || p.tally.outside) && bad.length < 5) bad.push({ tally: p.tally });
      if (p.nTop === 0 && p.tally && p.tally.above > 0 && p.audit) zeroAbove++;
      last = p;
      if ((p.state === 'done' && p.nTop === 0) || Date.now() - tStart > 120000) break;
    }
    check(last.state === 'done' && last.nTop === 0 && last.live, 'RUN: a 10 s glass runs to its end on the GPU sand',
          JSON.stringify({ state: last.state, nTop: last.nTop, s: (Date.now() - tStart) / 1000, ratio: last.ratio, transfers: last.n.transfers, residues: last.n.residues }));
    check(bad.length === 0 && zeroAbove === 0, 'RUN: every readback agreed with the ledger, no point lost or outside, never 0 with a point above',
          samples + ' samples; ' + JSON.stringify(bad).slice(0, 400));
    var e = await fresh(page);
    check(!!e.tally && e.tally.above === 0 && e.tally.points === e.pts, 'RUN: at the end the GPU holds no point above the line, and all its points',
          JSON.stringify(e.tally));

    /* ---- RESET ------------------------------------------------------------- */
    await page.evaluate(function () { window.Hourglass.reset(); });
    await page.waitForFunction(function () { return !document.getElementById('app').classList.contains('sweep'); }, null, { timeout: 20000 });
    var r = await fresh(page);
    check(r.total === r.want && r.nTop === r.total && r.tally && r.tally.points === r.pts && r.tally.above === r.pts && r.audit && r.audit.ok,
          'RESET: the new glass: its count, and the GPU filled with exactly its points, all above', JSON.stringify({ total: r.total, nTop: r.nTop, pts: r.pts, tally: r.tally }));

    /* ---- FLIP -------------------------------------------------------------- */
    await page.evaluate(function () { window.Hourglass.flipNow(); });
    await page.waitForFunction(function () { return !window.Hourglass.flip.active; }, null, { timeout: 30000 });
    var f = await fresh(page);
    check(f.nTop === 0 && f.tally && f.tally.above === 0 && f.tally.below === f.pts && f.audit && f.audit.ok,
          'FLIP: the full glass turned over: the ledger and the GPU\'s flip pass put every point below', JSON.stringify({ nTop: f.nTop, tally: f.tally, n: f.n && f.n.swaps }));

    check(errors.length === 0, 'no page or console errors', errors.slice(0, 3).join(' | '));
  } catch (e) {
    check(false, 'no exception', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    if (browser) await browser.close();
    await new Promise(function (r) { server.close(function () { r(); }); setTimeout(r, 500); });
  }
  console.log('realsand-gpu: ' + (count - failures) + '/' + count + ' passed in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  if (failures) process.exitCode = 1;
})();
