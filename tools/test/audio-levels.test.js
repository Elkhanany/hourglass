/*
 * audio-motion acceptance 8: levels of the new sounds, rendered offline.
 *
 * Each case builds the real HourglassAudio graph on an OfflineAudioContext
 * (as the original level work did), at the default volume and character,
 * calls the API at the right moments through OfflineAudioContext.suspend(),
 * renders, and measures the output:
 *
 *   - 3 s of thumps (E = 1, 5 Hz) over agitation 2: peak ≤ −9 dBFS, RMS ≤ −20 dBFS
 *   - crack() peaks at least 12 dB under the completion bowl
 *   - creak(4) peaks at or below −30 dBFS
 *   - a 40/s leak trickle: RMS ≤ −30 dBFS
 *   - with none of the new fields, the existing mix renders as before
 *     (this audio.js against f446085's, same scenario, RMS and peak)
 *
 * Other new sounds are measured and printed, without limits.
 *
 *   node tools/test/audio-levels.test.js [port]      (default 8803)
 */
'use strict';
var path = require('path');
var childProcess = require('child_process');
var chromium = require('playwright').chromium;
var Server = require('./lib/static-server.js');

var ROOT = path.resolve(__dirname, '..', '..');
var PORT = +(process.argv[2] || process.env.PORT || 8803);
var BASE = 'http://127.0.0.1:' + PORT;

var failures = 0, cases = 0;
function report(ok, name, detail) {
  if (ok === null) { console.log('INFO ' + name + (detail ? '  ' + detail : '')); return; }
  cases++;
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

// Runs in the page: renders a scenario and measures it.
function harness() {
  var SR = 48000;
  window.__render = function (Engine, dur, script) {
    var off = new OfflineAudioContext(2, Math.round(SR * dur), SR);
    // The engine plays only while its context runs; an offline one reads
    // 'suspended' between renders, so let it through.
    Object.defineProperty(off, 'state', { get: function () { return 'running'; } });
    var a = new Engine();
    a.ctx = off;
    a.volume = 0.8;                  // the default
    a._build();
    script(a, off);
    return off.startRendering().then(function (buf) { return { L: buf.getChannelData(0), R: buf.getChannelData(1) }; });
  };
  /** Call fn(a, t) at t = t0, t0 + step, … < t1 (render quanta), in order. */
  window.__every = function (off, a, t0, t1, step, fn) {
    var k = 0, seen = {};
    for (var t = t0; t < t1; t = t0 + (++k) * step) {
      var q = Math.round(t * SR / 128);
      if (seen[q]) continue;
      seen[q] = 1;
      (function (tt) {
        off.suspend(q * 128 / SR).then(function () { fn(a, tt); off.resume(); });
      })(t);
    }
  };
  window.__metrics = function (o, t0, t1) {
    var i0 = Math.floor(t0 * SR), i1 = Math.min(o.L.length, Math.floor(t1 * SR)), s = 0, pk = 0;
    for (var i = i0; i < i1; i++) {
      var l = o.L[i], r = o.R[i];
      s += (l * l + r * r) / 2;
      var m = Math.max(Math.abs(l), Math.abs(r));
      if (m > pk) pk = m;
    }
    function db(x) { return x > 0 ? 20 * Math.log10(x) : -200; }
    return { rms: +db(Math.sqrt(s / (i1 - i0))).toFixed(1), peak: +db(pk).toFixed(1) };
  };
  window.__base = function (a, extra) {
    var st = { dt: 1 / 60, flow: 0, impacts: 0, tail: 1, fill: 0.4, bottom: 6000, slides: 0, pouring: false,
               running: false, flipping: false, spin: 0, angle: 0, sim: null };
    for (var k in extra) st[k] = extra[k];
    a.update(st);
  };
}

async function main() {
  var server = await new Promise(function (res, rej) {
    var s = Server.start(PORT, ROOT, function () { res(s); });
    s.on('error', rej);
  });
  var browser = await chromium.launch();
  try {
    var page = await browser.newPage();
    var errors = [];
    page.on('pageerror', function (e) { errors.push(e.message); });
    var oldSrc = childProcess.execFileSync('git', ['show', 'f446085:audio.js'], { cwd: ROOT, encoding: 'utf8' })
      .replace('root.HourglassAudio = HourglassAudio;', 'root.HourglassAudioOld = HourglassAudio;');
    await page.route(BASE + '/__levels.html', function (r) {
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="/audio.js"></script><script src="/__old-audio.js"></script>' });
    });
    await page.route(BASE + '/__old-audio.js', function (r) { r.fulfill({ contentType: 'text/javascript', body: oldSrc }); });
    await page.goto(BASE + '/__levels.html');
    await page.evaluate(harness);

    var res = await page.evaluate(async function () {
      var A = window.HourglassAudio, OLD = window.HourglassAudioOld, out = {};
      var R = window.__render, every = window.__every, M = window.__metrics, base = window.__base;

      // 1. thumps E = 1 at 5 Hz over agitation 2, on sand and on bare glass
      var zero = new Float32Array(4), hit = new Float32Array([1, 0.1, 0, 0]);
      for (var c = 0; c < 2; c++) {
        var bottom = c ? 0 : 6000;
        var o1 = await R(A, 4, function (a, off) {
          a._cushion = c ? 0 : 1;
          var k = 0;
          every(off, a, 0.3, 3.6, 1 / 60, function (a2) {
            base(a2, { bottom: bottom, agit: 2, thump: (k++ % 12) === 0 ? hit : zero });
          });
        });
        out['thump5Hz_agit2_' + (c ? 'glass' : 'sand')] = M(o1, 0.5, 3.6);
      }
      // thumps alone, and agitation alone
      out.thump5Hz_alone = M(await R(A, 4, function (a, off) {
        a._cushion = 1; var k = 0;
        every(off, a, 0.3, 3.6, 1 / 60, function (a2) { base(a2, { thump: (k++ % 12) === 0 ? hit : zero }); });
      }), 0.5, 3.6);
      out.agit2_alone = M(await R(A, 4, function (a, off) {
        a._cushion = 1;
        every(off, a, 0.3, 3.6, 1 / 60, function (a2) { base(a2, { agit: 2 }); });
      }), 0.5, 3.6);

      // 2. the bowl, and the crack: the loudest of three renders (the noise is
      // random), centred and at the far left/right
      out.chime = M(await R(A, 6, function (a) { a.chime(0.5); }), 0.4, 6);
      async function loudest(dur, fn) {
        var worst = null;
        for (var r = 0; r < 3; r++) {
          var m = M(await R(A, dur, function (a, off) { every(off, a, 0.5, 0.51, 1, function (a2) { fn(a2); }); }), 0.4, dur);
          if (!worst || m.peak > worst.peak) worst = m;
        }
        return worst;
      }
      out.crack = await loudest(4, function (a) { a.crack(0); });
      out.crackSide = await loudest(4, function (a) { a.crack(Math.random() < 0.5 ? -1 : 1); });
      // the fair comparison: crack and bowl in one context (one room), six times
      out.pairs = [];
      for (var pr = 0; pr < 6; pr++) {
        var pan = [0, 1, -1][pr % 3];
        var o2 = await R(A, 10, function (a, off) {
          every(off, a, 0.5, 0.51, 1, function (a2) { a2.crack(pan); });
          a.chime(3.0);
        });
        var cm = M(o2, 0.4, 2.95), bm = M(o2, 2.95, 10);
        out.pairs.push({ pan: pan, crack: cm.peak, bowl: bm.peak, under: +(bm.peak - cm.peak).toFixed(1) });
      }

      // 3. creak(4), centred, at the side, and on a cracked glass
      out.creak4 = await loudest(2, function (a) { a.creak(4, 0); });
      out.creak4_side = await loudest(2, function (a) { a.creak(4, 1); });
      out.creak4_cracked = await loudest(2, function (a) { a.setCracked('cracked'); a.creak(4, -1); });

      // 4. a 40/s trickle out of a chip (and the cap: asking 200/s)
      out.leak40 = M(await R(A, 4, function (a, off) {
        every(off, a, 0.3, 3.6, 1 / 60, function (a2) { base(a2, { leak: 40, leakPan: 0.6 }); });
      }), 0.5, 3.6);
      out.leak200 = M(await R(A, 4, function (a, off) {
        every(off, a, 0.3, 3.6, 1 / 60, function (a2) { base(a2, { leak: 200, leakPan: -0.6 }); });
      }), 0.5, 3.6);

      // 5. the rest, for the record
      var one = function (fn) {
        return R(A, 3, function (a, off) { every(off, a, 0.5, 0.51, 1, function (a2) { fn(a2); }); });
      };
      out.clack1 = M(await one(function (a) { a.clack(1, 0); }), 0.4, 3);
      out.thump1 = M(await one(function (a) { a.thump(1, 0, 1); }), 0.4, 3);
      out.crackGrow = M(await one(function (a) { a.crackGrow(0); }), 0.4, 3);
      out.chip = M(await one(function (a) { a.chip(0); }), 0.4, 3);
      out.catchThud = M(await one(function (a) { a.catchThud(); }), 0.4, 3);
      out.mended = M(await R(A, 6, function (a, off) { every(off, a, 0.5, 0.51, 1, function (a2) { a2.mended(); }); }), 0.4, 6);
      out.newGlass = M(await one(function (a) { a.newGlass(); }), 0.4, 3);
      out.spill20 = M(await R(A, 4, function (a, off) {
        every(off, a, 0.3, 3.6, 1 / 60, function (a2) { base(a2, { spillPats: 20 }); });
      }), 0.5, 3.6);
      out.mendHum = M(await R(A, 3, function (a, off) {
        every(off, a, 0.3, 2.6, 1 / 60, function (a2, t) { a2.mendHum(Math.min(1, (t - 0.3) / 1.2)); });
      }), 1.5, 2.6);
      out.flipEnd = M(await one(function (a) { a.flipEnd(); }), 0.4, 3);

      // 6. regression: the existing mix, no new fields, old engine against new
      function mix(E) {
        return R(E, 5, function (a, off) {
          a._cushion = 1;
          every(off, a, 0.2, 4.9, 1 / 60, function (a2, t) {
            base(a2, { flow: 290, impacts: 290, bottom: 6000, slides: 30000, running: true });
          });
          var t = 0.3;                 // grains, as the existing harness scheduled them
          while (t < 5) { t += -Math.log(1 - Math.random()) / 190; a._tick(t, false, 0.35 + Math.random() * 0.6, Math.random() * 2 - 1); }
        });
      }
      var rn = [], ro = [];
      for (var rep = 0; rep < 3; rep++) { rn.push(M(await mix(A), 2, 5)); ro.push(M(await mix(OLD), 2, 5)); }
      out.mixNew = rn; out.mixOld = ro;
      return out;
    });

    function show(k) { return k + ' ' + JSON.stringify(res[k]); }
    var TH = [res.thump5Hz_agit2_sand, res.thump5Hz_agit2_glass];
    TH.forEach(function (m, i) {
      report(m.peak <= -9 && m.rms <= -20, '3 s of thumps E=1 at 5 Hz + agitation 2 (' + (i ? 'bare glass' : 'on sand') + ')',
             'peak ' + m.peak + ' dBFS (≤ −9), RMS ' + m.rms + ' dBFS (≤ −20)');
    });
    var unders = res.pairs.map(function (p) { return p.under; });
    var minUnder = Math.min.apply(null, unders), meanUnder = unders.reduce(function (s, x) { return s + x; }, 0) / unders.length;
    report(minUnder >= 12, 'crack() peak ≥ 12 dB under the bowl (same room, 6 renders, centre and either side)',
           'dB under: ' + unders.join(', ') + ' (least ' + minUnder.toFixed(1) + ', mean ' + meanUnder.toFixed(1) + '); crack peaks ' +
           res.pairs.map(function (p) { return p.crack; }).join(', ') + ' dBFS, bowl ' + res.pairs.map(function (p) { return p.bowl; }).join(', '));
    report(res.creak4.peak <= -30 && res.creak4_side.peak <= -30 && res.creak4_cracked.peak <= -30, 'creak(4) peak ≤ −30 dBFS',
           'centre ' + res.creak4.peak + ', side ' + res.creak4_side.peak + ', cracked glass ' + res.creak4_cracked.peak + ' dBFS (loudest of 3 each)');
    report(res.leak40.rms <= -30 && res.leak200.rms <= -30, 'leak pats at 40/s: RMS ≤ −30 dBFS',
           '40/s ' + res.leak40.rms + ' dBFS (peak ' + res.leak40.peak + '), asked 200/s ' + res.leak200.rms + ' dBFS');
    function avg(a, k) { return a.reduce(function (s, m) { return s + m[k]; }, 0) / a.length; }
    var dR = avg(res.mixNew, 'rms') - avg(res.mixOld, 'rms'), dP = avg(res.mixNew, 'peak') - avg(res.mixOld, 'peak');
    report(Math.abs(dR) <= 0.5 && Math.abs(dP) <= 1.5, 'existing mix unchanged without the new fields (vs f446085 audio.js)',
           'RMS new ' + avg(res.mixNew, 'rms').toFixed(1) + ' / old ' + avg(res.mixOld, 'rms').toFixed(1) + ' dBFS, peak new ' +
           avg(res.mixNew, 'peak').toFixed(1) + ' / old ' + avg(res.mixOld, 'peak').toFixed(1) + ' dBFS (3 renders each)');
    ['thump5Hz_alone', 'agit2_alone', 'thump1', 'clack1', 'crackGrow', 'chip', 'catchThud', 'mended', 'newGlass', 'spill20', 'mendHum', 'flipEnd', 'chime', 'crack']
      .forEach(function (k) { report(null, show(k)); });
    report(errors.length === 0, 'no page errors', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (cases - failures) + ' checks, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
