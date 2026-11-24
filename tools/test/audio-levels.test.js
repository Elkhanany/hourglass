/*
 * audio-motion acceptance 8: levels of the new sounds, rendered offline.
 *
 * Each case builds the real HourglassAudio graph on an OfflineAudioContext
 * (as the original level work did), at the default volume and character,
 * calls the API at the right moments through OfflineAudioContext.suspend(),
 * renders, and measures the output:
 *
 *   - 3 s of thumps (E = 1, 5 Hz) over agitation 2: peak ≤ −9 dBFS, RMS ≤ −20 dBFS
 *   - crack() stays at least 12 dB under the completion bowl in loudness
 *     (RMS, each over its own render) and never peaks above −9 dBFS, the
 *     thumps' own limit; and it peaks at least as high as the loudest creak
 *     less 3 dB. (Until creaks and cracks were meant to be heard, this asked
 *     for a crack peaking 12 dB under the bowl, which left it 17 dB under a
 *     thump and 20 dB under a tap: on a phone the glass cracked in silence.)
 *   - creak(1) peaks at or above −24 dBFS and creak(4) at or below −9 dBFS,
 *     and creak(4) is the louder. (This was "creak(4) ≤ −30 dBFS": a tick
 *     30 dB under a tap, which nobody heard. A creak is the glass's warning
 *     before it cracks, so it now sits with the tinks and thumps.)
 *   - a 40/s leak trickle: RMS ≤ −30 dBFS
 *   - with none of the new fields, the sand mix keeps its level: RMS within
 *     1.5 dB of f446085's audio.js in the same scenario, peaks at most 3 dB
 *     above it and under −6 dBFS. (Until the sand was rebuilt from grains this
 *     asked for the same mix, ±0.5 dB RMS and ±1.5 dB peak. The rebuilt sand
 *     has the same loudness but is made of clicks, not hiss: at the same RMS
 *     its crest is higher, so its peaks stand a little taller.)
 *
 * Other new sounds are measured and printed, without limits.
 *
 * The Sound tab's levels (Tune), each render from the same seeded random numbers:
 *
 *   - the Sand level at 100 is the sand as it was, to the last bits: the mix with thumps, clacks,
 *     a tap, a set-down and a creak, against the engine of d16fdcd (the base of the step;
 *     HOURGLASS_SOUND_BASE names another), the difference at least 80 dB under the sound (a
 *     sand gain of 0.99, the control, is not);
 *   - at 50 the law (50/100)^1.5, -9.03 dB: with the compressor and the clipper made plain, the
 *     same sound times 0.354 (the rest 60 dB under it), and through them still lower; a level
 *     heard as its plain value fails that (the control);
 *   - at 0 the sand is silent, while the bowl and Brook play as they do with no sand at all (60
 *     dB); the base engine, and a bowl or an ambience routed through the sand's gain, fail that
 *     (the controls);
 *   - the Bowl level at 50 is the bowl as it was, to the last bits; at 100 with Sound at 100 its
 *     peak is printed and nothing goes into the clipper's end (a bowl 30 dB over the top does: the control);
 *     at 0 it is silent (a copy that ignores the level is not: the control); and stopChime()
 *     fades a ringing bowl away at once.
 *
 * The bed of a glass that is moved while no stream runs (idle before the start,
 * paused, finished), fed what the classic sand gives the app for that motion
 * (measured in the app on a phone-size glass: the numbers are in MOVED below):
 *
 *   - at rest, with nothing fed, the output is digital silence in all three
 *   - a 1.5 g 5 Hz shake (slides 46,000 a second, agitation 1.08; paused, with
 *     sand below, 56,000 and 1.05), 2 g up and down (thumps of E 0.1 at 4.5 Hz,
 *     agitation 3, slides 15,000) and a lean past the slope (slides rising to
 *     13,000 a second and dying away, toward the low side): each within 3 dB of
 *     the level it was built at, the lean's louder in the ear on the low side.
 *     The control: a sand that reported a quarter of the shake's feeds is more
 *     than 3 dB under the shake's level, and so fails that check
 *   - the lean is heard only where no stream runs: the same slides under a
 *     running stream leave the rush at nothing, as they always did (the control)
 *
 * The water ambiences (brook, rain, ocean, waterfall, drips), each through
 * the engine as the app plays it:
 *
 *   - alone at the default level: Ocean and Waterfall within 1 dB of the
 *     brook's RMS; Drips 10 to 15 dB under it (drops are silence most of the
 *     time: its loudest drops peak where the brook peaks, within 3 dB)
 *   - each of the three as loud as it was prototyped (seed 1), within 0.3 dB
 *   - a browser that refuses AudioBuffers below 22.05 kHz (older WebKit): the
 *     loops are drawn out to a whole multiple of their rate and the render is
 *     the same sound (the difference at least 60 dB under it)
 *   - every ambience of the registry that makes a sound is measured: its
 *     level alone and the clipper are held by name (LEN and CLIP), so one
 *     added to the registry and to neither table fails
 *   - nothing clips: with the sand mix at full volume and the ambience at the
 *     top of its slider, in every character of the registry, over the ocean's
 *     and the drips' whole loops, what goes into the soft clipper stays under
 *     the end of its curve
 *   - a first hearing: Ocean's audition (12 s from its cue) holds one whole
 *     wave, Drips' (9 s) at least three drops, for five seeds
 *
 *   node tools/test/audio-levels.test.js [port | --port <n>]      (default $PORT, else 8803)
 */
'use strict';
var childProcess = require('child_process');
var chromium = require('playwright').chromium;
var Server = require('./lib/static-server.js');

var paths = require('./lib/paths.js');
var ROOT = paths.ROOT, AUDIO = '/' + paths.script('audio.js');
var PORT_AT = process.argv.indexOf('--port');
var PORT = +((PORT_AT > 0 ? process.argv[PORT_AT + 1] : process.argv[2]) || process.env.PORT || 8803);
var BASE = 'http://127.0.0.1:' + PORT;
var SOUND_BASE = process.env.HOURGLASS_SOUND_BASE || 'd16fdcd';     // the engine before the Sound tab's levels (Sand, Bowl, the fade before the end)

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
    // The sand is synthesised in slices by prepare(), which the app runs while
    // the page is idle, long before the first tap; _build() alone makes only
    // what every sound needs and leaves the rest to the slices. Finish it here,
    // at once, as the app would have.
    if (a._finishPrep) a._finishPrep();
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
    // the engine before the Sound tab's levels (the base of this step), and this engine with the bowl's level taken out (a control)
    var baseSrc = childProcess.execFileSync('git', ['show', SOUND_BASE + ':audio.js'], { cwd: ROOT, encoding: 'utf8' })
      .replace('root.HourglassAudio = HourglassAudio;', 'root.HourglassAudioBase = HourglassAudio;');
    var nowSrc = require('fs').readFileSync(require('path').join(ROOT, AUDIO.slice(1)), 'utf8');
    var noBowlSrc = nowSrc.replace("(soft ? 0.07 : 0.12) * this.bowlLevel", "(soft ? 0.07 : 0.12)").replace('root.HourglassAudio = HourglassAudio;', 'root.HourglassAudioNoBowl = HourglassAudio;');
    if (noBowlSrc.indexOf('HourglassAudioNoBowl') < 0 || noBowlSrc.indexOf('* this.bowlLevel') >= 0) throw new Error('audio-levels: the copy without the bowl\'s level could not be made');
    await page.route(BASE + '/__levels.html', function (r) {
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="' + AUDIO + '"></script><script src="/__old-audio.js"></script>' +
                  '<script src="/__base-audio.js"></script><script src="/__nobowl-audio.js"></script>' });
    });
    await page.route(BASE + '/__old-audio.js', function (r) { r.fulfill({ contentType: 'text/javascript', body: oldSrc }); });
    await page.route(BASE + '/__base-audio.js', function (r) { r.fulfill({ contentType: 'text/javascript', body: baseSrc }); });
    await page.route(BASE + '/__nobowl-audio.js', function (r) { r.fulfill({ contentType: 'text/javascript', body: noBowlSrc }); });
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
      out.creak1 = await loudest(2, function (a) { a.creak(1, 0); });
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

      // 6. regression: the sand mix, no new fields, old engine against new
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

    /* ---- the bed of a moved glass with no stream --------------------------------- */
    var bed = await page.evaluate(async function () {
      var A = window.HourglassAudio, R = window.__render, every = window.__every, M = window.__metrics, base = window.__base, out = {};
      var zero = new Float32Array(4);
      /**
       * 5 s of a glass that stands with no stream (below: sand in the lower bulb, as paused or
       * finished; else all above, as before the start), fed feeds(t) from 1 s on; measured from
       * 1.2 to 4.2 s, the mean of n renders. o.running: the same under a running stream.
       */
      async function moved(feeds, o, n) {
        var sum = { rms: 0, peak: 0, left: 0, rush: 0 };
        for (var r = 0; r < n; r++) {
          var rush = 0;
          var buf = await R(A, 5, function (a, off) {
            a._cushion = o.below ? 1 : 0;
            every(off, a, 0.1, 4.6, 1 / 60, function (a2, t) {
              var f = t >= 1 ? feeds(t - 1) : {};
              f.bottom = o.below ? 6000 : 0; f.fill = o.below ? 0.4 : 0;
              if (o.running) { f.running = true; f.flow = 57; f.impacts = 57; }
              base(a2, f);
              if (t >= 1 && (a2._last.rush || 0) > rush) rush = a2._last.rush;
            });
          });
          var m = M(buf, 1.2, 4.2), i0 = Math.floor(1.2 * 48000), i1 = Math.floor(4.2 * 48000), sl = 0, sr = 0;
          for (var i = i0; i < i1; i++) { sl += buf.L[i] * buf.L[i]; sr += buf.R[i] * buf.R[i]; }
          sum.rms += m.rms / n; sum.peak += m.peak / n; sum.rush += rush / n;
          sum.left += 10 * Math.log10((sl + 1e-30) / (sr + 1e-30)) / n;
        }
        return { rms: +sum.rms.toFixed(1), peak: +sum.peak.toFixed(1), left: +sum.left.toFixed(1), rush: +sum.rush.toFixed(3) };
      }
      var none = function () { return {}; };
      out.restIdle = await moved(none, {}, 1);
      out.restBelow = await moved(none, { below: true }, 1);
      // what the classic sand gives the app (a phone-size glass, measured in the app)
      var MOVED = {
        shake: function (t) { return { slides: 46000, agit: 1.08, rushPan: 0.6 * Math.sin(31 * t) }; },
        shakeBelow: function (t) { return { slides: 56000, agit: 1.05, rushPan: 0.6 * Math.sin(31 * t) }; },
        quarter: function (t) { return { slides: 11500, agit: 0.27, rushPan: 0.6 * Math.sin(31 * t) }; }
      };
      var LEAN = [4, 12, 13, 12, 11, 10, 10, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 2, 0];    // thousands of slides a second, each sixth of a second
      // (leaned with the right edge low: the sand runs to the right, and app.js says so: +0.41)
      MOVED.lean = function (t) { return { slides: 1000 * (LEAN[Math.floor(t * 6)] || 0), rushPan: 0.41 }; };
      var k = 0;
      MOVED.upDown = function () { return { slides: 15000, agit: 3, thump: (k++ % 13) === 0 ? new Float32Array([0.1, 0.1, 0, 0]) : zero }; };
      out.shake = await moved(MOVED.shake, {}, 3);
      out.shakeBelow = await moved(MOVED.shakeBelow, { below: true }, 3);
      out.quarter = await moved(MOVED.quarter, {}, 3);
      out.lean = await moved(MOVED.lean, {}, 3);
      out.leanBelow = await moved(MOVED.lean, { below: true }, 3);
      out.upDown = await moved(MOVED.upDown, {}, 3);
      out.leanRunning = await moved(MOVED.lean, { below: true, running: true }, 1);
      /**
       * A half turn of 2.6 s (the Flip button's) from 1 s on, the sand sliding through it and for
       * 2.4 s after, as the classic sand's does: up to 60,000 slides a second mid-turn, 20,000 as
       * the glass comes to rest, then down to nothing. What the rush is asked for, update by
       * update. o.state: the glass's own while it turns ('running': a running glass turned).
       */
      async function turned(o) {
        var asked = [];
        await R(A, 7, function (a, off) {
          a._cushion = 0;
          every(off, a, 0.1, 6.8, 1 / 60, function (a2, t) {
            var u = t - 1, f = { bottom: 0, fill: 0 };
            if (o.running) { f.ambient = true; if (u < 0 || u >= 2.6) { f.running = true; f.flow = 57; f.impacts = 57; } }
            if (u >= 0 && u < 2.6) {
              var p = u / 2.6;
              f.flipping = true; f.angle = Math.PI * p * p * (3 - 2 * p); f.spin = Math.PI * 6 * p * (1 - p) / 2.6;
              f.slides = 1000 * (p < 0.5 ? 120 * p : 60 - 80 * (p - 0.5));
            } else if (u >= 2.6) f.slides = Math.max(0, 20000 * (1 - (u - 2.6) / 2.4));
            base(a2, f);
            if (u >= 0) asked.push({ u: u, rush: a2._last.rush || 0, turning: !!f.flipping });
          });
        });
        var peak = 0, at = 0, i, r = { peak: 0, lowest: 1, rise: 0, end: 0, after: 0, late: 0 };
        for (i = 0; i < asked.length; i++) if (asked[i].rush > peak) { peak = asked[i].rush; at = i; }
        r.peak = +peak.toFixed(3);
        for (i = at; i < asked.length; i++) {
          var x = asked[i];
          // (from the peak until a second after the turn the sand slides at 12,000 a second and more)
          if (x.u <= 3.6 && x.rush < r.lowest) r.lowest = x.rush;
          if (i > at && x.rush - asked[i - 1].rush > r.rise) r.rise = x.rush - asked[i - 1].rush;
          if (x.turning) r.end = x.rush; else if (asked[i - 1].turning) r.after = x.rush;
          if (x.u >= 5.2 && x.rush > r.late) r.late = x.rush;
        }
        r.lowest = +r.lowest.toFixed(3); r.rise = +r.rise.toFixed(3); r.end = +r.end.toFixed(3); r.after = +r.after.toFixed(3);
        return r;
      }
      out.flipIdle = await turned({});
      out.flipRunning = await turned({ running: true });
      return out;
    });
    // the levels these were built at (dBFS RMS at the default volume, the mean of several renders)
    var BUILT = { shake: -37.9, shakeBelow: -34.0, lean: -45.2, leanBelow: -45.5, upDown: -38.5 };
    function near(k) { return Math.abs(bed[k].rms - BUILT[k]) <= 3; }
    function bshow(k) { return k + ' ' + bed[k].rms + ' dBFS RMS (built at ' + BUILT[k] + '), peak ' + bed[k].peak; }
    report(bed.restIdle.rms <= -120 && bed.restBelow.rms <= -120, 'a glass with no stream, at rest, nothing fed: silence (before the start, and with sand below)',
           'RMS ' + bed.restIdle.rms + ' and ' + bed.restBelow.rms + ' dBFS');
    report(near('shake') && near('shakeBelow') && near('upDown'),
           'moved with no stream, fed what the classic sand gives: a 1.5 g 5 Hz shake (before the start, and paused) and 2 g up and down sound within 3 dB of the level they were built at',
           ['shake', 'shakeBelow', 'upDown'].map(bshow).join('; '));
    report(BUILT.shake - bed.quarter.rms > 3, 'control: a sand that reported a quarter of the shake\'s feeds fails that check (more than 3 dB under the level the shake was built at)',
           'a quarter of the feeds ' + bed.quarter.rms + ' dBFS, ' + (BUILT.shake - bed.quarter.rms).toFixed(1) + ' dB under');
    report(near('lean') && near('leanBelow') && bed.lean.left <= -2 && bed.lean.rush > 0.05,
           'a lean past the slope with no stream is heard, softly, toward the low side (within 3 dB of the level it was built at; leaned with the right edge low, louder in the right ear)',
           ['lean', 'leanBelow'].map(bshow).join('; ') + '; right over left ' + (-bed.lean.left).toFixed(1) + ' dB; the rush asked for ' + bed.lean.rush);
    report(bed.leanRunning.rush === 0, 'control: the same slides under a running stream leave the rush at nothing, as they always did',
           'the rush asked for ' + bed.leanRunning.rush + ' (with no stream ' + bed.lean.rush + ')');
    var fI = bed.flipIdle, fR = bed.flipRunning;
    report(fI.peak > 0.2 && fI.lowest >= 0.05 && fI.rise <= 0.004 && fI.after <= fI.end + 0.004 && fI.late <= 0.001,
           'a glass that stands, turned over (the Flip button before the start, or paused): the sand sliding through the turn and after it is heard without a gap: after its peak the rush only falls, it does not drop out at the turn\'s end and come back',
           'the rush asked for: peak ' + fI.peak + ', never under ' + fI.lowest + ' until a second after the turn, ' + fI.end + ' on the turn\'s last frame and ' + fI.after + ' on the next, its largest rise after the peak ' + fI.rise + '; ' + fI.late + ' once the sand rests');
    report(fR.end <= 0.02 && fR.after <= 0.004 && fR.peak > 0.2 && fR.lowest <= 0.004,
           'control: a running glass turned over keeps the turn\'s own rush alone, as it always did: down to nothing as the turn ends, and nothing after under the stream',
           'the rush asked for: peak ' + fR.peak + ', ' + fR.end + ' on the turn\'s last frame, ' + fR.after + ' on the next');

    /* ---- the water ambiences ---------------------------------------------------- */
    var amb = await page.evaluate(async function () {
      var A = window.HourglassAudio, out = { alone: {}, clip: [], cue: {} };
      var R = window.__render, every = window.__every, M = window.__metrics, base = window.__base;
      var AMB = A.AMBIENCES;

      /** An ambience through the engine: started as the app starts it, the glass running. `o.sand`: with the full sand mix. */
      function play(id, dur, o) {
        var info = {};
        return R(A, dur, function (a, off) {
          if (o.refuse) {                              // an old WebKit: no AudioBuffer below 22.05 kHz
            var make = off.createBuffer.bind(off);
            info.refused = 0;
            off.createBuffer = function (c, n, sr) {
              if (sr < 22050) { info.refused++; throw new DOMException('sample rate', 'NotSupportedError'); }
              return make(c, n, sr);
            };
          }
          if (o.volume != null) a.setVolume(o.volume);
          if (o.character) a.setCharacter(o.character);
          a._cushion = 1;
          a._makeAmbience(id, o.seed || 1);
          a.ambience = id; a.ambLevel = o.level != null ? o.level : 0.5;
          a._startAmbience(id);
          info.rates = a._amb.srcs.map(function (s) { return s.buffer.sampleRate; });
          info.seconds = a._amb.srcs.map(function (s) { return s.buffer.duration; });
          var st = o.sand ? { flow: 290, impacts: 290, bottom: 6000, slides: 30000, running: true } : { running: true };
          // the sand mix of the regression case above; its grains are scheduled as the render
          // gets to them, as the app does (thousands waiting in the graph render many times slower)
          var tg = 0.3;
          every(off, a, 0.05, dur - 0.05, o.sand ? 1 / 60 : 0.1, function (a2, t) {
            base(a2, st);
            if (o.sand) while (tg < t + 0.07) { tg += -Math.log(1 - Math.random()) / 190; a2._tick(tg, false, 0.35 + Math.random() * 0.6, Math.random() * 2 - 1); }
          });
        }).then(function (buf) { buf.info = info; return buf; });
      }
      function seeded(s) { return A._synth.mulberry32(s); }

      // 1. alone, at the default level and volume. The loops start at the same places every run:
      // left to chance, the level over these windows moves by up to 0.27 dB for the ocean and the
      // drips (a wave, or a loud drop, in or out of the window), which is the whole tolerance below.
      // The ocean is measured over one whole loop of its waves in front (61.3 s).
      var LEN = { brook: 35, rain: 35, ocean: 66.3, waterfall: 35, drips: 125 }, id;
      var realRandom = Math.random;
      for (id in LEN) {
        Math.random = seeded(7);
        var o1 = await play(id, LEN[id], {});
        Math.random = realRandom;
        out.alone[id] = M(o1, 5, LEN[id]);
        out.alone[id].rates = o1.info.rates;
      }

      // 2. the low-rate fallback: the same render with and without it, from the same random numbers
      out.fallback = {};
      for (id in { ocean: 1, waterfall: 1, drips: 1 }) {
        Math.random = seeded(7);                       // the room, the sand and where the loops start: alike in both
        var fa = await play(id, 12, {});
        Math.random = seeded(7);
        var fb = await play(id, 12, { refuse: true });
        Math.random = realRandom;
        var e = 0, d = 0, i0 = 48000 * 2;
        for (var i = i0; i < fa.L.length; i++) { var x = fa.L[i] - fb.L[i]; d += x * x; e += fa.L[i] * fa.L[i]; }
        out.fallback[id] = { asked: fa.info.rates, got: fb.info.rates, refused: fb.info.refused, seconds: fa.info.seconds, secondsFb: fb.info.seconds,
                             residual: +(10 * Math.log10(d / e + 1e-30)).toFixed(1), a: M(fa, 2, 12), b: M(fb, 2, 12) };
      }

      // 3. behind the sand at full volume, the ambience at the top of its slider, in every character.
      // The master gain comes after the soft clipper, whose curve (tanh(1.5 x) / tanh(1.5)) ends at
      // ±1: from the output's peak, the peak that went into the clipper, in dB under that end.
      var CLIP = { brook: 12, rain: 12, ocean: 64, waterfall: 12, drips: 24 };     // the ocean's and the drips' whole loops
      var master = A.prototype._masterTarget.call({ muted: false, _silenced: false, volume: 1 });
      Math.random = seeded(11);                        // the same sand and the same places in the loops every run
      for (var ch in A.CHARACTERS) {
        for (id in CLIP) {
          var o3 = await play(id, CLIP[id], { sand: true, volume: 1, level: 1, character: ch }), pk = 0;
          for (var j3 = 48000; j3 < o3.L.length; j3++) pk = Math.max(pk, Math.abs(o3.L[j3]), Math.abs(o3.R[j3]));
          var y3 = pk / master;
          out.clip.push({ character: ch, ambience: id, peak: +(20 * Math.log10(pk)).toFixed(2),
                          into: y3 < 1 ? +(20 * Math.log10(Math.atanh(y3 * Math.tanh(1.5)) / 1.5)).toFixed(2) : 99 });
        }
      }
      Math.random = realRandom;
      out.master = master;
      // what the registry holds, against what the two tables above name
      out.characters = Object.keys(A.CHARACTERS);
      out.sounding = A.ambiences().filter(function (r) { return !!AMB[r.id].layers; }).map(function (r) { return r.id; });
      out.tables = { level: Object.keys(LEN), clip: Object.keys(CLIP) };

      // 4. a first hearing: what the audition holds, from the loops themselves
      function env(x, sr, w) {                         // RMS over windows of w seconds
        var n = Math.floor(sr * w), m = Math.floor(x.length / n), o = new Float32Array(m);
        for (var k = 0; k < m; k++) { var s = 0; for (var j = k * n; j < (k + 1) * n; j++) s += x[j] * x[j]; o[k] = Math.sqrt(s / n); }
        return o;
      }
      out.cue.ocean = []; out.cue.drips = [];
      [1, 2, 3, 12345, 2147483646].forEach(function (seed) {
        var a = new A(), raw = a._makeAmbience('ocean', seed), L0 = AMB.ocean.layers[0], w = 0.25;
        var e0 = env(raw[0][0], L0.sr, w), cue = L0.cue(L0.seconds, seed), n = e0.length, all = 0, k, best = 0, at = 0;
        for (k = 0; k < n; k++) all += e0[k] * e0[k];
        all = Math.sqrt(all / n);
        var win = [], len = Math.round(AMB.ocean.audition / w);
        for (k = 0; k < len; k++) win.push(e0[(Math.floor(cue / w) + k) % n]);
        for (k = 0; k + 4 <= len; k++) {               // its loudest second
          var s = Math.sqrt((win[k] * win[k] + win[k + 1] * win[k + 1] + win[k + 2] * win[k + 2] + win[k + 3] * win[k + 3]) / 4);
          if (s > best) { best = s; at = k * w; }
        }
        function db(v) { return +(20 * Math.log10(v / all)).toFixed(1); }
        out.cue.ocean.push({ seed: seed, cue: +cue.toFixed(2), crest: db(best), crestAt: at, first: db(Math.sqrt((win[0] * win[0] + win[1] * win[1]) / 2)),
                             last: db(Math.sqrt((win[len - 1] * win[len - 1] + win[len - 2] * win[len - 2] + win[len - 3] * win[len - 3] + win[len - 4] * win[len - 4]) / 4)) });

        // drops: the three loops from their cues, for the length of the audition
        var b = new A(), rd = b._makeAmbience('drips', seed), sr = 16000, m = Math.round(AMB.drips.audition * sr), mix = new Float32Array(m), top = 0, li, j;
        for (li = 0; li < 3; li++) {
          var Ld = AMB.drips.layers[li], x = rd[li][0], y = rd[li][1], c0 = Math.round(Ld.cue(Ld.seconds, seed) * sr);
          for (j = 0; j < x.length; j++) top = Math.max(top, Math.abs(x[j]), Math.abs(y[j]));
          for (j = 0; j < m; j++) mix[j] = Math.max(mix[j], Math.abs(x[(c0 + j) % x.length]), Math.abs(y[(c0 + j) % y.length]));
        }
        // a drop: the sound rises above 0.07 (the loudest are near 0.5) after a quarter of a second under it
        var drops = [], lastAt = -1e9;
        for (j = 0; j < m; j++) if (mix[j] > 0.07) { if (j - lastAt > 0.25 * sr) drops.push(+(j / sr).toFixed(2)); lastAt = j; }
        out.cue.drips.push({ seed: seed, drops: drops, loudest: +top.toFixed(2) });
      });
      return out;
    });

    /* ---- the Sound tab: the sand's level, the bowl's, and what passes neither ---------- */
    var lv = await page.evaluate(async function () {
      var A = window.HourglassAudio, B = window.HourglassAudioBase, NB = window.HourglassAudioNoBowl, out = {};
      var R = window.__render, every = window.__every, M = window.__metrics, base = window.__base;
      var realRandom = Math.random, seeded = function (s) { return A._synth.mulberry32(s); };
      /** One render from seeded random numbers: `setup(a)` before anything plays, the sand mix if `o.sand`, the bowl at `o.bowl` s, Brook if `o.brook`. */
      function scene(E, dur, o, setup) {
        Math.random = seeded(o.seed || 5);
        var p = R(E, dur, function (a, off) {
          if (o.volume != null) a.setVolume(o.volume);
          if (o.flat) {                                   // the compressor and the clipper made plain: what comes out is what went in, times the master
            a.comp.threshold.value = 0; a.comp.knee.value = 0; a.comp.ratio.value = 1; a.clip.curve = null;
          }
          a._cushion = 1;
          if (o.brook) { a._makeAmbience('brook', 1); a.ambience = 'brook'; a.ambLevel = 0.5; a._startAmbience('brook'); }
          if (setup) setup(a);
          if (o.bowl != null) a.chime(o.bowl);
          var tg = 0.3;
          every(off, a, 0.05, dur - 0.05, 1 / 60, function (a2, t) {
            base(a2, o.sand ? { flow: 290, impacts: 290, bottom: 6000, slides: 30000, running: true, agit: 1 } : { running: true });
            if (o.sand) {
              while (tg < t + 0.07) { tg += -Math.log(1 - Math.random()) / 190; a2._tick(tg, false, 0.35 + Math.random() * 0.6, Math.random() * 2 - 1); }
              if (Math.abs(t - 1.0) < 0.009) { a2.thump(1, 0.3, 1); a2.clack(1, -0.2); a2.tap(); }
              if (Math.abs(t - 2.0) < 0.009) { a2.flipEnd(); a2.creak(3, 0.4); }
            }
          });
        });
        return p.then(function (r) { Math.random = realRandom; return r; });   // (the grains are drawn as the render runs: seeded until it ends)
      }
      /** How far apart two renders are: the difference, in dB under the first (-200: the same samples); `k` scales the second. */
      function apart(x, y, k, t0) {
        var e = 0, d = 0, i0 = Math.floor((t0 || 0) * 48000);
        k = k == null ? 1 : k;
        for (var i = i0; i < x.L.length; i++) {
          var u = x.L[i] - k * y.L[i], v = x.R[i] - k * y.R[i];
          d += u * u + v * v; e += x.L[i] * x.L[i] + x.R[i] * x.R[i];
        }
        return d === 0 ? -200 : +(10 * Math.log10(d / (e + 1e-30))).toFixed(1);
      }
      // 1. the sand at 100 is the sand as it was (the base engine has no level): the mix, its thumps, clacks, a tap, a set-down and a creak
      var b100 = await scene(B, 4, { sand: true }), n100 = await scene(A, 4, { sand: true }, function (a) { a.setSandLevel(1); });
      var n100b = await scene(A, 4, { sand: true });
      out.at100 = { base: M(b100, 0.5, 4), now: M(n100, 0.5, 4), apart: apart(b100, n100, 1, 0.1), self: apart(n100, n100b, 1, 0.1) };
      // control: a sand gain of 0.99 at 100
      var c99 = await scene(A, 4, { sand: true }, function (a) { a.gSand.gain.value = 0.99; });
      out.at100ctl = { apart: apart(b100, c99, 1, 0.1) };
      // 2. at 50, by the law (50/100)^1.5: with the compressor and the clipper plain, the same sound times 0.354; as heard (through them), its level
      var f100 = await scene(A, 4, { sand: true, flat: true }), f50 = await scene(A, 4, { sand: true, flat: true }, function (a) { a.setSandLevel(0.5); });
      var law = Math.pow(0.5, 1.5);
      out.at50 = { law: +(20 * Math.log10(law)).toFixed(2), flat100: M(f100, 0.5, 4), flat50: M(f50, 0.5, 4), apart: apart(f50, f100, law, 0.5) };
      var h50 = await scene(A, 4, { sand: true }, function (a) { a.setSandLevel(0.5); });
      out.at50.heard = M(h50, 0.5, 4); out.at50.heard100 = out.at100.now;
      var lin = await scene(A, 4, { sand: true, flat: true }, function (a) { a._sandGain = function () { return this.sandLevel; }; a.setSandLevel(0.5); });
      out.at50ctl = { apart: apart(lin, f100, law, 0.5), rms: M(lin, 0.5, 4) };
      // 3. at 0 the sand is silent, while the bowl and the ambience play as they do with no sand at all
      var s0 = await scene(A, 4, { sand: true }, function (a) { a.setSandLevel(0); });
      var withAll0 = await scene(A, 8, { sand: true, bowl: 1.5, brook: true }, function (a) { a.setSandLevel(0); });
      var noSand = await scene(A, 8, { bowl: 1.5, brook: true });
      // (measured from 1 s: the level glides to 0 from the moment the graph is built, τ 50 ms, and is 170 dB down by then)
      out.at0 = { sand: M(s0, 1, 4), all: M(withAll0, 1, 8), bowlBrook: M(noSand, 1, 8), apart: apart(noSand, withAll0, 1, 1) };
      // controls: the base engine (the change undone: no level) is heard at "0"; a bowl, or an ambience, routed through the sand's gain is silenced with it
      var bs0 = await scene(B, 4, { sand: true }, function (a) { if (a.setSandLevel) a.setSandLevel(0); });
      var viaB = await scene(A, 8, { sand: true, bowl: 1.5, brook: true }, function (a) { a.gChime.disconnect(); a.gChime.connect(a.gSand); a.gChime.connect(a.chimeWet); a.setSandLevel(0); });
      var viaA = await scene(A, 8, { sand: true, bowl: 1.5, brook: true }, function (a) { a.ambEnd.disconnect(); a.ambEnd.connect(a.gSand); a.setSandLevel(0); });
      out.at0ctl = { base: M(bs0, 1, 4), bowlVia: apart(noSand, viaB, 1, 1), brookVia: apart(noSand, viaA, 1, 1) };
      // 4. the bowl: at 50 the bowl as it was; at 100 (Sound 100) its peak and what goes into the clipper; at 0 silent
      var master = A.prototype._masterTarget.call({ muted: false, _silenced: false, volume: 1 });
      var into = function (m) { var y = Math.pow(10, m.peak / 20) / master; return y < 1 ? +(20 * Math.log10(Math.atanh(y * Math.tanh(1.5)) / 1.5)).toFixed(2) : 99; };
      var bw50b = await scene(B, 9, { bowl: 0.5, volume: 1 }), bw50 = await scene(A, 9, { bowl: 0.5, volume: 1 }, function (a) { a.setBowlLevel(1); });
      var bw100 = await scene(A, 9, { bowl: 0.5, volume: 1 }, function (a) { a.setBowlLevel(2); });
      var bw0 = await scene(A, 9, { bowl: 0.5, volume: 1 }, function (a) { a.setBowlLevel(0); });
      out.bowl = { at50: M(bw50, 0.4, 9), base50: M(bw50b, 0.4, 9), apart50: apart(bw50b, bw50, 1, 0.1), at100: M(bw100, 0.4, 9), at0: M(bw0, 0.4, 9), master: +(20 * Math.log10(master)).toFixed(2) };
      out.bowl.into100 = into(out.bowl.at100);
      // ... and the soft bowl between two phases, at 100
      var soft100 = await R(A, 9, function (a) { a.setVolume(1); a.setBowlLevel(2); a.chime(0.5, true); });
      out.bowl.soft100 = M(soft100, 0.4, 9);
      // controls: a copy that ignores the bowl's level is heard at 0; a bowl 30 dB over the top of the slider goes into the clipper's end
      var nb0 = await scene(NB, 9, { bowl: 0.5, volume: 1 }, function (a) { a.setBowlLevel(0); });
      var bw200 = await scene(A, 9, { bowl: 0.5, volume: 1 }, function (a) { a.bowlLevel = 64; });     // (30 dB over the top of the slider: the compressor holds much of it back)
      out.bowlCtl = { noLevel0: M(nb0, 0.4, 9), at200: M(bw200, 0.4, 9) };
      out.bowlCtl.into200 = into(out.bowlCtl.at200);
      // 5. stopChime: a bowl stopped 1 s in is gone 1 s later (the next 8 s silent), and the bowl left alone is still ringing then
      var stop = await R(A, 6, function (a, off) { a.chime(0.2); every(off, a, 1.2, 1.21, 1, function (a2) { a2.stopChime(); }); });
      var ring = await R(A, 6, function (a) { a.chime(0.2); });
      out.stop = { after: M(stop, 2.6, 6), left: M(ring, 2.6, 6), before: M(stop, 0.3, 1.2) };
      return out;
    });
    report(lv.at100.apart <= lv.at100.self + 3 && lv.at100.apart <= -80 && Math.abs(lv.at100.now.rms - lv.at100.base.rms) <= 0.05 && Math.abs(lv.at100.now.peak - lv.at100.base.peak) <= 0.05,
           'the Sand level at 100 is the sand as it was (' + SOUND_BASE + '\'s engine, the same random numbers): the mix with thumps, clacks, a tap, a set-down and a creak, to the last bits',
           'RMS ' + lv.at100.now.rms + ' / ' + lv.at100.base.rms + ' dBFS, peak ' + lv.at100.now.peak + ' / ' + lv.at100.base.peak + ' dBFS; the difference ' + lv.at100.apart +
           ' dB under the sound (a render against itself: ' + lv.at100.self + ' dB)');
    report(lv.at100ctl.apart > -80, 'control: a sand gain of 0.99 at 100 is told apart', lv.at100ctl.apart + ' dB under the sound');
    report(Math.abs(lv.at50.flat50.rms - lv.at50.flat100.rms - lv.at50.law) <= 0.2 && lv.at50.apart <= -60 && lv.at50.heard.rms < lv.at50.heard100.rms - 3,
           'the Sand level at 50 is the law (50/100)^1.5, ' + lv.at50.law + ' dB: with the compressor and the clipper made plain the same sound times ' + Math.pow(0.5, 1.5).toFixed(3) + ', and heard through them still lower',
           'plain: ' + lv.at50.flat100.rms + ' → ' + lv.at50.flat50.rms + ' dBFS RMS (' + (lv.at50.flat50.rms - lv.at50.flat100.rms).toFixed(2) + ' dB), the rest ' + lv.at50.apart +
           ' dB under the sound; heard: ' + lv.at50.heard100.rms + ' → ' + lv.at50.heard.rms + ' dBFS RMS, peak ' + lv.at50.heard100.peak + ' → ' + lv.at50.heard.peak);
    report(lv.at50ctl.apart > -60, 'control: a sand level heard as its plain value (v, not v^1.5) fails the law', lv.at50ctl.apart + ' dB off the law; RMS ' + lv.at50ctl.rms.rms + ' dBFS');
    report(lv.at0.sand.peak <= -150 && lv.at0.apart <= -60 && lv.at0.all.rms > -60,
           'the Sand level at 0: the sand (the mix, thumps, clacks, a tap, a set-down, a creak) is silent, and the bowl and Brook play as they do with no sand at all',
           'the sand alone ' + lv.at0.sand.peak + ' dBFS peak; the bowl and Brook with the sand at 0: RMS ' + lv.at0.all.rms + ', with no sand ' + lv.at0.bowlBrook.rms + ' dBFS, the difference ' + lv.at0.apart + ' dB under');
    report(lv.at0ctl.base.peak > -60 && lv.at0ctl.bowlVia > -60 && lv.at0ctl.brookVia > -60,
           'control: the base engine (no Sand level) is heard at "0", and a bowl or an ambience routed through the sand\'s gain is silenced with it (each fails that check)',
           'base ' + lv.at0ctl.base.peak + ' dBFS peak; the bowl through it ' + lv.at0ctl.bowlVia + ' dB, Brook through it ' + lv.at0ctl.brookVia + ' dB off the sound with no sand');
    report(lv.bowl.apart50 <= -80 && Math.abs(lv.bowl.at50.peak - lv.bowl.base50.peak) <= 0.05,
           'the Bowl level at 50 is the bowl as it was (' + SOUND_BASE + '\'s engine), to the last bits', 'peak ' + lv.bowl.at50.peak + ' / ' + lv.bowl.base50.peak + ' dBFS at Sound 100, the difference ' + lv.bowl.apart50 + ' dB under');
    report(lv.bowl.into100 <= -0.3 && lv.bowl.at100.peak <= lv.bowl.master && lv.bowl.at100.peak > lv.bowl.at50.peak + 4,
           'the Bowl level at 100 with Sound at 100: louder (+6 dB asked) and nothing clips (the clipper\'s input ≥ 0.3 dB under its end)',
           'peak ' + lv.bowl.at100.peak + ' dBFS (at 50: ' + lv.bowl.at50.peak + '; the soft bowl between phases ' + lv.bowl.soft100.peak + '), RMS ' + lv.bowl.at100.rms + ' dBFS; into the clipper ' +
           lv.bowl.into100 + ' dB under its end; the output can reach ' + lv.bowl.master + ' dBFS');
    report(lv.bowlCtl.into200 > -0.3, 'control: a bowl 30 dB over the top of the slider reaches the clipper\'s end, and fails that check', 'peak ' + lv.bowlCtl.at200.peak + ' dBFS, ' + lv.bowlCtl.into200 + ' dB');
    report(lv.bowl.at0.peak <= -150, 'the Bowl level at 0: the bowl is silent', 'peak ' + lv.bowl.at0.peak + ' dBFS');
    report(lv.bowlCtl.noLevel0.peak > -60, 'control: a copy whose bowl ignores its level is heard at 0', 'peak ' + lv.bowlCtl.noLevel0.peak + ' dBFS');
    report(lv.stop.after.peak <= -60 && lv.stop.left.peak > -40 && lv.stop.before.peak > -40,
           'stopChime(): a ringing bowl fades away at once (from 1.4 s after it is stopped, 60 dB under), where the same bowl left alone still rings (the control)',
           'stopped: ' + lv.stop.before.peak + ' dBFS before, ' + lv.stop.after.peak + ' after; left alone: ' + lv.stop.left.peak + ' dBFS');

    // The levels and the clipper are measured by name (LEN and CLIP above), so an ambience added
    // to the registry and to neither table would be measured by nothing: it must be in both.
    /** The ambiences that make a sound and that a table does not name: [] when each is measured. */
    function unmeasured(sounding, tables) {
      var out = [];
      sounding.forEach(function (id) {
        if (tables.level.indexOf(id) < 0) out.push(id + ' has no level measured (LEN)');
        if (tables.clip.indexOf(id) < 0) out.push(id + ' is not held under the clipper (CLIP)');
      });
      return out;
    }
    var un = unmeasured(amb.sounding, amb.tables), unMore = unmeasured(amb.sounding.concat(['x-new']), amb.tables);
    report(un.length === 0 && amb.sounding.length >= 5 && unMore.join() === 'x-new has no level measured (LEN),x-new is not held under the clipper (CLIP)',
           'every ambience of the registry that makes a sound is measured here, alone and behind the sand (' + amb.sounding.join(', ') +
           '); one more in the registry and in neither table is found (control)', un.join('; ') || 'a new one gets its line in LEN and in CLIP, and its level\'s rule');
    var brook = amb.alone.brook;
    function ambShow(id) { var m = amb.alone[id]; return id + ' ' + m.rms + ' dBFS RMS, peak ' + m.peak + ' (' + m.rates.join('/') + ' Hz)'; }
    report(Math.abs(amb.alone.ocean.rms - brook.rms) <= 1 && Math.abs(amb.alone.waterfall.rms - brook.rms) <= 1,
           'Ocean and Waterfall sit at the brook\'s loudness (RMS within 1 dB)', ['brook', 'ocean', 'waterfall', 'rain'].map(ambShow).join('; '));
    var dU = brook.rms - amb.alone.drips.rms, dP = amb.alone.drips.peak - brook.peak;
    report(dU >= 10 && dU <= 15 && Math.abs(dP) <= 3, 'Drips: 10 to 15 dB under the brook in RMS, its peaks within 3 dB of the brook\'s',
           ambShow('drips') + ': ' + dU.toFixed(1) + ' dB under, peaks ' + (dP >= 0 ? '+' : '') + dP.toFixed(1) + ' dB');
    // as the three were prototyped (seed 1, the same render): ocean −26.07, waterfall −25.57, drips −39.18 dBFS
    var PROTO = { ocean: -26.07, waterfall: -25.57, drips: -39.18 };
    report(Object.keys(PROTO).every(function (id) { return Math.abs(amb.alone[id].rms - PROTO[id]) <= 0.3; }),
           'each new ambience is as loud as its prototype (within 0.3 dB)',
           Object.keys(PROTO).map(function (id) { return id + ' ' + amb.alone[id].rms + ' (prototype ' + PROTO[id] + ')'; }).join(', '));
    var fbOk = Object.keys(amb.fallback).every(function (id) {
      var f = amb.fallback[id];
      return f.refused > 0 && f.got.every(function (r) { return r >= 22050; }) && f.residual <= -60 &&
             f.seconds.every(function (s, i) { return Math.abs(s - f.secondsFb[i]) < 1e-6; });
    });
    report(fbOk, 'where a browser refuses rates below 22.05 kHz the loops are drawn out to a whole multiple, and sound the same',
           Object.keys(amb.fallback).map(function (id) {
             var f = amb.fallback[id];
             return id + ' ' + f.asked.join('/') + ' → ' + f.got.join('/') + ' Hz (' + f.refused + ' refused), difference ' + f.residual + ' dB re the sound';
           }).join('; '));
    // Nothing clips: what goes into the soft clipper never reaches the end of its curve, where it
    // would be cut flat. (The same sand and the same places in the loops every run: seeded.)
    function hottest(id) { return amb.clip.filter(function (c) { return c.ambience === id; }).reduce(function (w, c) { return c.into > w.into ? c : w; }); }
    var worst = amb.clip.reduce(function (w, c) { return c.into > w.into ? c : w; });
    // every character of the registry behind every ambience of CLIP: 30 renders today, and no fewer
    /** What is wrong with the count of renders: '' when it is every character times every ambience, and at least the 30 of six and five. */
    function countProblem(n, characters, ambiences) {
      if (n !== characters * ambiences) return n + ' renders for ' + characters + ' characters times ' + ambiences + ' ambiences';
      return n < 30 ? n + ' renders, fewer than the 30 of six characters and five ambiences' : '';
    }
    var nCh = amb.characters.length, nAm = amb.tables.clip.length, cp = countProblem(amb.clip.length, nCh, nAm);
    report(worst.into <= -0.3 && cp === '' && countProblem(amb.clip.length - nAm, nCh, nAm) !== '' && countProblem(25, 5, 5) !== '',
           'nothing clips: sand at full volume, the ambience at the top of its slider, in all ' + nCh + ' characters of the registry (' + amb.clip.length +
           ' renders; the clipper\'s input stays ≥ 0.3 dB under its end)',
           (cp ? cp + '; ' : '') + 'dB under the end, the nearest of ' + nCh + ' characters: ' + amb.tables.clip.map(function (id) {
             var h = hottest(id);
             return id + ' ' + h.into + ' (' + h.character + ', output peak ' + h.peak + ' dBFS)';
           }).join('; ') + '; output can reach ' + (20 * Math.log10(amb.master)).toFixed(2) + ' dBFS at most');
    var oc = amb.cue.ocean, dr = amb.cue.drips;
    report(oc.every(function (c) { return c.crest >= 3 && c.crestAt >= 1.5 && c.crestAt <= 7 && c.first <= c.crest - 6 && c.last <= c.crest - 6; }),
           'Ocean\'s audition holds one whole wave: a crest ≥ 3 dB over the loop 1.5 to 7 s in, 6 dB less at both ends',
           oc.map(function (c) { return 'seed ' + c.seed + ': ' + c.first + ' → ' + c.crest + ' dB at ' + c.crestAt + ' s → ' + c.last; }).join('; '));
    report(dr.every(function (c) { return c.drops.length >= 3 && c.drops[0] <= 2; }),
           'Drips\' audition holds several drops (≥ 3 in its 9 s, the first within 2 s)',
           dr.map(function (c) { return 'seed ' + c.seed + ': ' + c.drops.join(', ') + ' s'; }).join('; '));

    function show(k) { return k + ' ' + JSON.stringify(res[k]); }
    var TH = [res.thump5Hz_agit2_sand, res.thump5Hz_agit2_glass];
    TH.forEach(function (m, i) {
      report(m.peak <= -9 && m.rms <= -20, '3 s of thumps E=1 at 5 Hz + agitation 2 (' + (i ? 'bare glass' : 'on sand') + ')',
             'peak ' + m.peak + ' dBFS (≤ −9), RMS ' + m.rms + ' dBFS (≤ −20)');
    });
    var unders = res.pairs.map(function (p) { return p.under; });
    var minUnder = Math.min.apply(null, unders), meanUnder = unders.reduce(function (s, x) { return s + x; }, 0) / unders.length;
    var crackPk = Math.max.apply(null, res.pairs.map(function (p) { return p.crack; }).concat([res.crack.peak, res.crackSide.peak]));
    var creakPk = Math.max(res.creak4.peak, res.creak4_side.peak, res.creak4_cracked.peak);
    report(res.chime.rms - res.crack.rms >= 12 && res.chime.rms - res.crackSide.rms >= 12 && crackPk <= -9,
           'crack(): ≥ 12 dB under the bowl in loudness (RMS), peak ≤ −9 dBFS',
           'RMS ' + res.crack.rms + ' (centre), ' + res.crackSide.rms + ' (side) against the bowl\'s ' + res.chime.rms + ' dBFS; loudest peak ' +
           crackPk + ' dBFS (bowl ' + res.pairs.map(function (p) { return p.bowl; }).join(', ') + '; peaks under the bowl: ' + unders.join(', ') +
           ', least ' + minUnder.toFixed(1) + ', mean ' + meanUnder.toFixed(1) + ' dB)');
    report(crackPk >= creakPk - 3, 'crack() peaks at least as high as the loudest creak, less 3 dB', 'crack ' + crackPk + ', creak(4) ' + creakPk + ' dBFS');
    report(res.creak1.peak >= -24 && creakPk <= -9 && res.creak4.peak > res.creak1.peak, 'creaks are heard: creak(1) peak ≥ −24 dBFS, creak(4) ≤ −9 dBFS and the louder',
           'creak(1) ' + res.creak1.peak + '; creak(4) centre ' + res.creak4.peak + ', side ' + res.creak4_side.peak + ', cracked glass ' + res.creak4_cracked.peak + ' dBFS (loudest of 3 each)');
    report(res.leak40.rms <= -30 && res.leak200.rms <= -30, 'leak pats at 40/s: RMS ≤ −30 dBFS',
           '40/s ' + res.leak40.rms + ' dBFS (peak ' + res.leak40.peak + '), asked 200/s ' + res.leak200.rms + ' dBFS');
    function avg(a, k) { return a.reduce(function (s, m) { return s + m[k]; }, 0) / a.length; }
    var dR = avg(res.mixNew, 'rms') - avg(res.mixOld, 'rms'), dP = avg(res.mixNew, 'peak') - avg(res.mixOld, 'peak');
    report(Math.abs(dR) <= 1.5 && dP <= 3 && avg(res.mixNew, 'peak') <= -6, 'the sand mix keeps its level without the new fields (vs f446085 audio.js)',
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
