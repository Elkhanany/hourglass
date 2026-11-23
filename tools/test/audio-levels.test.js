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
    await page.route(BASE + '/__levels.html', function (r) {
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="' + AUDIO + '"></script><script src="/__old-audio.js"></script>' });
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
