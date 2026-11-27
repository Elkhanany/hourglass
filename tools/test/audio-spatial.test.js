/*
 * The stage (sound/audio.js, setSpatial): the sand heard as an object in front of the listener on
 * headphones. Each case builds the real HourglassAudio graph on an OfflineAudioContext, feeds it
 * frame by frame as app.js does (through OfflineAudioContext.suspend()), renders and measures,
 * as audio-levels does. Every check has a control that must fail.
 *
 *   OFF   the switch untouched, and switched on then off before anything plays: the sand mix at
 *         Sand level 100 is the base engine's to the last bit (HOURGLASS_SPATIAL_BASE, default
 *         73528e7). Control: the stage left on is not.
 *   LEVEL each of the registry's characters at 60 and at 300 grains a second: the power over both
 *         ears within 1 dB of the same render without the stage, each octave from 250 Hz to
 *         8 kHz within 2.5 dB, and at full volume what goes into the soft clipper stays under
 *         its end (tanh(1.5 x) / tanh(1.5) ends at ±1). Control: the stage without its
 *         correction EQ is out of the octaves.
 *   PLACE a lone grain at +0.6 across the glass is heard right (ITD over +20 µs, ILD 2-4 kHz over
 *         +1 dB) and at -0.6 left, the two mirrors within 1 dB; the glass leaned ±0.6 rad moves
 *         the landings by over 80 µs and 4 dB; and THE TURN: where the classic sand's moving
 *         grains are seen in a clockwise and an anticlockwise turn (the Sim, in Node), the
 *         stage puts the slide (app.js slideBulb()), on that side in both. Controls: the grains
 *         without their place in the glass (evG) sit in the middle; the slide put in the other
 *         bulb, or today's rush pan, is heard on the other side.
 *   IMAGE a steady glass's ears correlate between 0.15 and 0.6 (not one point in the head, not a
 *         wash). Control: the stage with one speaker dead ahead for every bar.
 *   MONO  L+R folded to one channel is within 1 dB of the same fold without the stage.
 *   STILL a still glass schedules no gain and sets no panner after the stage is built; and the
 *         end of a turn (the angle from half a turn back to nothing, the ends swapped) makes no
 *         jump in either ear. Controls: placing every frame schedules; a stage that does not
 *         swap its ends with the glass jumps.
 *
 * Headless Chromium now and then never finishes an offline render that has HRTF panners in it
 * and suspends every frame. Each render here has a watchdog and is done once more on a fresh
 * page if it hangs; the count is printed.
 *
 *   node tools/test/audio-spatial.test.js [port]      (argv[2], else $PORT, else 8811)
 *   HOURGLASS_SPATIAL_PRINT=1 prints every measure
 */
'use strict';
var childProcess = require('child_process');
var path = require('path');
var fs = require('fs');
var chromium = require('playwright').chromium;
var Server = require('./lib/static-server.js');
var paths = require('./lib/paths.js');
var ROOT = paths.ROOT, AUDIO = '/' + paths.script('audio.js');
var PORT = +(process.argv[2] || process.env.PORT || 8811);
var BASE = 'http://127.0.0.1:' + PORT;
var SOUND_BASE = process.env.HOURGLASS_SPATIAL_BASE || '73528e7';
var PRINT = !!process.env.HOURGLASS_SPATIAL_PRINT;
var WATCHDOG_MS = 90000;

var failures = 0, cases = 0, hangs = 0, renders = 0;
function report(ok, name, detail) {
  if (ok === null) { console.log('INFO ' + name + (detail ? '  ' + detail : '')); return; }
  cases++;
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

/* ---- the page's side ------------------------------------------------------------------- */
function harness() {
  var SR = 48000;
  var A = window.HourglassAudio;
  function seeded(s) { return A._synth.mulberry32(s); }
  var realRandom = Math.random;

  /**
   * One render. o: { E (engine), dur, character, rate (single landings a second), flow (the
   * stream, grains a second; rate if left out), spatial (true: on before it plays; 'onoff': on,
   * then off), frame(t) -> fields over the base ones, evFix (every landing at this x), evShift,
   * volume, seed, flat (compressor and clipper made plain), setup(a), tweak(a) (after the stage) }
   */
  window.__scene = function (o) {
    var E = o.E ? window[o.E] : A;
    Math.random = seeded(o.seed || 4242);
    var off = new OfflineAudioContext(2, Math.round(SR * o.dur), SR);
    Object.defineProperty(off, 'state', { get: function () { return 'running'; } });
    var a = new E();
    a.ctx = off;
    a.volume = o.volume != null ? o.volume : 0.8;
    if (o.character) a.character = o.character;
    if (a._finishPrep) a._finishPrep();
    a._build();
    if (o.flat) { a.comp.threshold.value = 0; a.comp.knee.value = 0; a.comp.ratio.value = 1; a.clip.curve = null; }
    a._cushion = 1;
    var room = Promise.resolve(false);
    if (o.spatial) {
      room = a.setSpatial(true);
      if (o.spatial === 'onoff') room = a.setSpatial(false);
    }
    window.__last = a;
    if (o.setup) o.setup(a);
    var S = { nev: 0, evX: new Float32Array(64), evV: new Float32Array(64), evK: new Uint8Array(64) };
    var evG = new Float32Array(64), acc = 0, rate = o.rate || 0, flow = o.flow != null ? o.flow : rate;
    var NF = Math.floor((o.dur - 0.1) * 60), places = 0;
    return room.then(function () {
      if (o.tweak) o.tweak(a);
      for (var k = 0; k < NF; k++) (function (k) {
        var t = k / 60, q = Math.round(t * SR / 128) * 128 / SR;
        off.suspend(q).then(function () {
          var f = { dt: 1 / 60, flow: flow, impacts: flow, tail: 1, fill: 0.4, fillTop: 0.5, bottom: 2400, slides: 0, pouring: false,
                    running: flow > 0, ambient: false, flipping: false, spin: 0, angle: 0, tilt: 0, rushPan: 0, rushPanG: 0, slide: -1, pose: 0 };
          if (o.frame) { var x0 = o.frame(t); for (var kk in x0) f[kk] = x0[kk]; }
          var turn = f.turn != null ? f.turn : f.angle + f.tilt, heard = Math.cos(turn);
          f.turn = turn;
          var r = f.rate != null ? f.rate : rate;
          acc += r / 60;
          var n = 0;
          while (acc >= 1 && n < 64) { acc -= 1; n++; }
          S.nev = n;
          for (var e = 0; e < n; e++) {
            var x = f.evFix != null ? f.evFix : Math.random() - 0.5 + (f.evShift || 0);
            x = x < -1 ? -1 : (x > 1 ? 1 : x);
            evG[e] = x; S.evX[e] = x * heard;                // as app.js: the places as heard, and in the glass
            S.evV[e] = 0.5 + 0.5 * Math.random(); S.evK[e] = 1;
          }
          f.sim = S; f.evG = o.noEvG ? null : evG;
          a.update(f);
          if (o.each) o.each(a, t, f);
          off.resume();
        });
      })(k);
      return off.startRendering();
    }).then(function (buf) {
      Math.random = realRandom;
      return { L: buf.getChannelData(0), R: buf.getChannelData(1), a: a };
    });
  };

  /* ---- measures ---- */
  function biquad(x, type, f, q) {
    var w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), b0, b1, b2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    var y = new Float64Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) { var v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  function band(x, lo, hi) { return biquad(biquad(biquad(biquad(x, 'hp', lo, 0.707), 'hp', lo, 0.707), 'lp', hi, 0.707), 'lp', hi, 0.707); }
  function pw(x, a, b) { var s = 0; for (var i = a; i < b; i++) s += x[i] * x[i]; return s / Math.max(1, b - a); }
  function db(p) { return 10 * Math.log10(p + 1e-30); }
  function r2(v) { return Math.round(v * 100) / 100; }
  /** ITD (µs, + the right ear leads) from the cross-correlation of 300-1500 Hz, and its peak. */
  function itd(L, R, a, b) {
    var l = band(L, 300, 1500), r = band(R, 300, 1500), M = 48, best = -1e30, bd = 0, c = [];
    for (var d = -M; d <= M; d++) { var s = 0; for (var i = a + M; i < b - M; i++) s += l[i] * r[i + d]; c.push(s); if (s > best) { best = s; bd = d; } }
    var k = bd + M, frac = 0;
    if (k > 0 && k < c.length - 1) { var y0 = c[k - 1], y1 = c[k], y2 = c[k + 1], den = y0 - 2 * y1 + y2; if (den < 0) frac = 0.5 * (y0 - y2) / den; }
    return Math.round(-(bd + frac) / SR * 1e6);
  }
  window.__measure = function (o, t0, t1) {
    var a = Math.floor(t0 * SR), b = Math.min(o.L.length, Math.floor(t1 * SR)), L = o.L, R = o.R;
    var pl = pw(L, a, b), pr = pw(R, a, b), slr = 0, pm = 0, pk = 0;
    for (var i = a; i < b; i++) { slr += L[i] * R[i]; var m = 0.5 * (L[i] + R[i]); pm += m * m; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    var n = b - a;
    var bands = [250, 500, 1000, 2000, 4000, 8000].map(function (fc) {
      return r2(db(0.5 * (pw(band(L, fc / Math.SQRT2, fc * Math.SQRT2), a, b) + pw(band(R, fc / Math.SQRT2, fc * Math.SQRT2), a, b))));
    });
    var hl = band(L, 2000, 4000), hr = band(R, 2000, 4000);
    return { rms: r2(db(0.5 * (pl + pr))), peak: r2(20 * Math.log10(pk + 1e-30)), pk: pk, corr: r2(slr / n / Math.sqrt(pl * pr + 1e-30)),
             mono: r2(db(pm / n)), ild: r2(db(pr) - db(pl)), ildHi: r2(db(pw(hr, a, b)) - db(pw(hl, a, b))), itd: itd(L, R, a, b), bands: bands };
  };
  /** The largest step of the level in either ear, dB per ms, from 10 ms windows over [t0, t1). */
  window.__jump = function (o, t0, t1) {
    var W = SR / 100, a = Math.floor(t0 * SR), b = Math.floor(t1 * SR), worst = 0, at = 0;
    [o.L, o.R].forEach(function (x) {
      var prev = null;
      for (var s = a; s + W <= b; s += W) {
        var p = 0; for (var i = s; i < s + W; i++) p += x[i] * x[i];
        var l = 10 * Math.log10(p / W + 1e-12);
        if (prev !== null && l > -60 && prev > -60 && Math.abs(l - prev) / 10 > worst) { worst = Math.abs(l - prev) / 10; at = s / SR; }
        prev = l;
      }
    });
    return { worst: r2(worst), at: r2(at) };
  };
  /** How far apart two renders are: the difference, in dB under the first (-200: the same samples). */
  window.__apart = function (x, y) {
    var e = 0, d = 0;
    for (var i = 0; i < x.L.length; i++) { var u = x.L[i] - y.L[i], v = x.R[i] - y.R[i]; d += u * u + v * v; e += x.L[i] * x.L[i] + x.R[i] * x.R[i]; }
    return d === 0 ? -200 : r2(10 * Math.log10(d / e));
  };
}

/* ---- the turn, in Node: where the classic sand's moving grains are seen ------------------- */
function slideBulbFromApp() {
  var src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  var at = src.indexOf('function slideBulb(');
  if (at < 0) throw new Error('app.js has no slideBulb()');
  var depth = 0, i = src.indexOf('{', at);
  for (var j = i; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return new Function('return ' + src.slice(at, j + 1))();
}
/**
 * A turn of the classic Sim (as app.js turns it: the angle eased over 1.4 s, the spin fed to the
 * sand), its sand `below` share in the lower bulb; every 6 steps the room x of the centroid of the
 * moving grains (cells that move and grains in the air), and what slideBulb() says.
 */
function simTurn(dir, below) {
  var H = require('./lib/harness.js'), P = H.P;
  var s = new P.Sim({ scale: 1, seed: 5 });
  s.reset(Math.round(s.maxTotal * 0.8));
  if (below > 0) s.fastForward(Math.round(s.nTop * below));
  for (var k = 0; k < 300; k++) { if (!(k & 1)) s.beginFrame(); s.step(); }
  var g = s.geo, N = Math.round(1.4 * P.STEP_HZ), out = [];
  s.flipping = true;
  for (k = 0; k < N; k++) {
    var u = k / N, th = dir * Math.PI * u * u * (3 - 2 * u);
    s.angle = th; s.setMotion(0, 0, dir * Math.PI / 1.4 * 6 * u * (1 - u), 0, H.LAM, 0);
    if (!(k & 1)) s.beginFrame();
    s.step();
    if (k % 6) continue;
    var c = Math.cos(th), sn = Math.sin(th), sx = 0, n = 0;
    for (var y = 0; y < s.H; y++) for (var x = 0; x < s.W; x++) if (s.cell[y * s.W + x] === P.MOVE) { sx += (x + 0.5 - g.cx) * c - (y + 0.5 - g.cy) * sn; n++; }
    for (var i = 0; i < s.np; i++) { sx += (s.px[i] - g.cx) * c - (s.py[i] - g.cy) * sn; n++; }
    out.push({ th: th, n: n, x: n ? sx / n / g.HB : 0, nT: s.nTop, nB: s.total - s.nTop });
  }
  return out;
}

async function main() {
  var server = await new Promise(function (res, rej) { var s = Server.start(PORT, ROOT, function () { res(s); }); s.on('error', rej); });
  var browser = await chromium.launch();
  var baseSrc = childProcess.execFileSync('git', ['show', SOUND_BASE + ':' + AUDIO.slice(1)], { cwd: ROOT, encoding: 'utf8' })
    .replace('root.HourglassAudio = HourglassAudio;', 'root.HourglassAudioBase = HourglassAudio;');
  var page = null;
  async function fresh() {
    if (page) await page.close().catch(function () {});
    page = await browser.newPage();
    page.on('pageerror', function (e) { console.log('INFO page error  ' + e.message); });
    await page.route(BASE + '/__spatial.html', function (r) {
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="' + AUDIO + '"></script><script src="/__base-audio.js"></script>' });
    });
    await page.route(BASE + '/__base-audio.js', function (r) { r.fulfill({ contentType: 'text/javascript', body: baseSrc }); });
    await page.goto(BASE + '/__spatial.html');
    await page.evaluate(harness);
  }
  /** One job in the page, with a watchdog: a render that hangs is done once more on a fresh page. */
  var ONLY = process.env.HOURGLASS_SPATIAL_ONLY ? new RegExp(process.env.HOURGLASS_SPATIAL_ONLY) : null;
  function want(group) { return !ONLY || ONLY.test(group); }       // (HOURGLASS_SPATIAL_ONLY: a regular expression of the groups to run)
  async function job(name, fn, arg) {
    for (var k = 0; k < 2; k++) {
      var timer, hung = false;
      var r = await Promise.race([page.evaluate(fn, arg), new Promise(function (res) { timer = setTimeout(function () { hung = true; res(null); }, WATCHDOG_MS); })]);
      clearTimeout(timer);
      renders++;
      if (!hung) return r;
      hangs++;
      console.log('INFO ' + name + ': a render hung (no end after ' + WATCHDOG_MS / 1000 + ' s); once more on a fresh page');
      await fresh();
    }
    throw new Error(name + ': hung twice');
  }
  try {
    await fresh();
    var lines = [], cal = {};
    var chars = await page.evaluate(function () { return Object.keys(window.HourglassAudio.CHARACTERS); });

    if (want('off')) {
    /* ---- OFF: the switch off is today, to the last bit ---------------------------------- */
    var off = await job('off', async function () {
      var mix = function (E, sp, flat) {
        return window.__scene({ E: E, dur: 5, rate: 190, flow: 290, spatial: sp, seed: 5, flat: flat, frame: function (t) {
          return { bottom: 6000, slides: 30000, agit: 1, fill: 0.5 };
        }, each: function (a, t) {
          if (Math.abs(t - 1.0) < 0.009) { a.thump(1, 0.3, 1); a.clack(1, -0.2); a.tap(); }
          if (Math.abs(t - 2.0) < 0.009) { a.flipEnd(); a.creak(3, 0.4); }
        } });
      };
      var base = await mix('HourglassAudioBase', false), base2 = await mix('HourglassAudioBase', false), now = await mix('HourglassAudio', false);
      var onoff = await mix('HourglassAudio', 'onoff'), on = await mix('HourglassAudio', true);
      var fa = await mix('HourglassAudioBase', false, true), fb = await mix('HourglassAudioBase', false, true);
      var k99 = { L: base2.L.map(function (v) { return v * 0.99; }), R: base2.R.map(function (v) { return v * 0.99; }) };
      return { flatSelf: window.__apart(fa, fb), self: window.__apart(base, base2), k99: window.__apart(base, k99), now: window.__apart(base, now), onoff: window.__apart(base, onoff), on: window.__apart(base, on), rms: window.__measure(base, 1, 5).rms };
    });
    // (a render here is not the same to the last bit as itself: the same engine twice differs by about -92 dB.
    // Today's engine and this one with the switch off differ by no more than that, and the control, a gain
    // of 0.99 on the base engine's output, by far more: -40 dB)
    var tol = Math.max(off.self, -200) + 3;
    report(off.now <= tol && off.now <= -80, 'OFF: with the switch untouched the sand mix (Sand level 100, thumps, a clack, a tap, a creak) is ' + SOUND_BASE + '\'s, to within what a render differs from itself',
           'difference ' + off.now + ' dB under the sound (' + off.rms + ' dBFS); two renders of the base engine differ by ' + off.self + ' dB' + (off.flatSelf != null ? ' (' + off.flatSelf + ' with the compressor made plain)' : ''));
    report(off.onoff <= tol && off.onoff <= -80, 'OFF: switched on and then off before it plays, the same mix is ' + SOUND_BASE + '\'s, to within the same', 'difference ' + off.onoff + ' dB');
    report(off.k99 > tol && off.k99 > -80, 'CONTROL: the base engine at a gain of 0.99 is not', 'difference ' + off.k99 + ' dB');
    report(off.on > -60, 'CONTROL: with the stage left on, the mix is not ' + SOUND_BASE + '\'s', 'difference ' + off.on + ' dB');

    }
    if (want('level')) {
    /* ---- LEVEL: each character at 60 and 300 grains a second ---------------------------- */
    var worst = { rms: 0, band: 0, mono: 0, into: -99 };
    for (var ci = 0; ci < chars.length; ci++) {
      for (var rate of [60, 300]) {
        var lv = await job('level ' + chars[ci] + ' ' + rate, async function (arg) {
          var sc = function (sp, vol) {
            return window.__scene({ dur: 7, rate: arg.rate, character: arg.ch, spatial: sp, volume: vol, seed: 9, frame: function () { return { bottom: 2400, slides: 3000 }; } });
          };
          var o0 = await sc(false), o1 = await sc(true), f0 = await sc(false, 1), f1 = await sc(true, 1);
          var A = window.HourglassAudio, master = A.prototype._masterTarget.call({ muted: false, _silenced: false, volume: 1 });
          var into = function (o) { var pk = 0; for (var i = 48000; i < o.L.length; i++) pk = Math.max(pk, Math.abs(o.L[i]), Math.abs(o.R[i])); var y = pk / master;
            return y < 1 ? Math.round(2000 * Math.log10(Math.atanh(y * Math.tanh(1.5)) / 1.5)) / 100 : 99; };
          return { off: window.__measure(o0, 1, 7), on: window.__measure(o1, 1, 7), intoOff: into(f0), intoOn: into(f1) };
        }, { ch: chars[ci], rate: rate });
        var dr = lv.on.rms - lv.off.rms, db = lv.on.bands.map(function (b, i) { return Math.round((b - lv.off.bands[i]) * 10) / 10; });
        var dm = (lv.on.mono - lv.on.rms) - (lv.off.mono - lv.off.rms), bw = db.reduce(function (m, v) { return Math.abs(v) > Math.abs(m) ? v : m; }, 0);
        if (Math.abs(dr) > Math.abs(worst.rms)) worst.rms = dr;
        if (Math.abs(bw) > Math.abs(worst.band)) worst.band = bw;
        if (Math.abs(dm) > Math.abs(worst.mono)) worst.mono = dm;
        if (lv.intoOn > worst.into) worst.into = lv.intoOn;
        var line = chars[ci] + ' ' + rate + '/s: level ' + (dr >= 0 ? '+' : '') + dr.toFixed(2) + ' dB, octaves 250-8k ' + db.join(' ') +
                   ', mono fold ' + (dm >= 0 ? '+' : '') + dm.toFixed(2) + ' dB, corr ' + lv.off.corr + ' -> ' + lv.on.corr + ', into the clipper ' + lv.intoOff + ' -> ' + lv.intoOn + ' dB';
        lines.push(line);
        var cc = cal[chars[ci]] = cal[chars[ci]] || { bands: [0, 0, 0, 0, 0, 0], off: [0, 0, 0, 0, 0, 0], level: 0 };
        db.forEach(function (v, i) { cc.bands[i] += v / 2; cc.off[i] += lv.off.bands[i] / 2; });
        cc.level += dr / 2;
        report(Math.abs(dr) <= 1 && db.every(function (v) { return Math.abs(v) <= 2.5; }), 'LEVEL ' + chars[ci] + ' at ' + rate + ' grains/s: within 1 dB, every octave 250 Hz-8 kHz within 2.5 dB of no stage', line);
        report(Math.abs(dm) <= 1, 'MONO ' + chars[ci] + ' at ' + rate + ' grains/s: L+R folded to one is within 1 dB of the fold without the stage', 'fold ' + (lv.on.mono - lv.on.rms).toFixed(2) + ' against ' + (lv.off.mono - lv.off.rms).toFixed(2) + ' dB');
        report(lv.intoOn < 0, 'CLIP ' + chars[ci] + ' at ' + rate + ' grains/s, full volume: what goes into the soft clipper stays under its end', lv.intoOff + ' -> ' + lv.intoOn + ' dB under it');
        // (the steady glass as the app comes: its first character; the others are printed with their levels)
        if (ci === 0) report(lv.on.corr >= 0.15 && lv.on.corr <= 0.6, 'IMAGE ' + chars[ci] + ' at ' + rate + ' grains/s: the ears correlate between 0.15 and 0.6', 'corr ' + lv.on.corr + ' (no stage ' + lv.off.corr + ')');
      }
    }
    report(null, 'level worst ' + worst.rms.toFixed(2) + ' dB, octave worst ' + worst.band + ' dB, mono worst ' + worst.mono.toFixed(2) + ' dB, clipper nearest ' + worst.into + ' dB');
    var noEq = await job('control eq', async function () {
      var sc = function (sp, tw) { return window.__scene({ dur: 7, rate: 60, spatial: sp, seed: 9, tweak: tw, frame: function () { return { bottom: 2400, slides: 3000 }; } }); };
      var A = window.HourglassAudio._stage.STAGE, keep = A.eq;
      A.eq = [];
      var o1 = await sc(true);
      A.eq = keep;
      var o0 = await sc(false);
      return { off: window.__measure(o0, 1, 7), on: window.__measure(o1, 1, 7) };
    });
    var dbn = noEq.on.bands.map(function (b, i) { return Math.round((b - noEq.off.bands[i]) * 10) / 10; });
    report(!dbn.every(function (v) { return Math.abs(v) <= 2.5; }), 'CONTROL: the stage without its correction EQ is out of the octaves', dbn.join(' '));

    }
    if (want('place')) {
    /* ---- PLACE: lone grains, the lean ------------------------------------------------- */
    var lone = await job('lone', async function () {
      var one = function (x, th, noG) { return window.__scene({ dur: 6, rate: 40, flow: 0, spatial: true, seed: 3, noEvG: noG, frame: function () { return { evFix: x, turn: th, angle: th }; } }); };
      var p = await one(0.6, 0), m = await one(-0.6, 0), h = await one(0.6, 3.0), c = await one(0.6, 3.0, true);
      return { p: window.__measure(p, 0.5, 6), m: window.__measure(m, 0.5, 6), h: window.__measure(h, 0.5, 6), c: window.__measure(c, 0.5, 6) };
    });
    report(lone.p.itd > 20 && lone.p.ildHi > 1 && lone.m.itd < -20 && lone.m.ildHi < -1 && Math.abs(lone.p.ildHi + lone.m.ildHi) <= 1 && Math.abs(lone.p.ild + lone.m.ild) <= 1,
           'PLACE: a lone grain at +0.6 is right and at -0.6 left, mirrors within 1 dB',
           '+0.6: ITD ' + lone.p.itd + ' us, ILD ' + lone.p.ild + ' dB, 2-4 kHz ' + lone.p.ildHi + ' dB; -0.6: ' + lone.m.itd + ' us, ' + lone.m.ild + ', ' + lone.m.ildHi +
           ' dB; imbalance ' + (lone.p.ild + lone.m.ild).toFixed(2) + ' / ' + (lone.p.ildHi + lone.m.ildHi).toFixed(2) + ' dB');
    report(lone.h.itd < -20 && lone.h.ildHi < -1, 'PLACE: the same grain with the glass turned (almost) half round is heard left, where it is seen',
           'ITD ' + lone.h.itd + ' us, ILD 2-4 kHz ' + lone.h.ildHi + ' dB');
    report(lone.c.itd > 20 && lone.c.ildHi > 1, 'CONTROL: fed its place as heard instead of its place in the glass (evG), the grain is turned twice and heard right',
           'ITD ' + lone.c.itd + ' us, ILD 2-4 kHz ' + lone.c.ildHi + ' dB');
    var lean = await job('lean', async function () {
      var one = function (tilt) { return window.__scene({ dur: 4, rate: 60, spatial: true, seed: 3, frame: function () { return { tilt: tilt, bottom: 2400 }; } }); };
      var l = await one(-0.6), r = await one(0.6);
      return { l: window.__measure(l, 1, 4), r: window.__measure(r, 1, 4) };
    });
    report(lean.l.itd - lean.r.itd > 80 && lean.l.ildHi - lean.r.ildHi > 4, 'PLACE: the glass leaned -0.6 and +0.6 rad (its angle with gravity, clockwise +) moves the landings clearly, to the side its lower bulb is seen on',
           'ITD ' + lean.l.itd + ' -> ' + lean.r.itd + ' us, ILD 2-4 kHz ' + lean.l.ildHi + ' -> ' + lean.r.ildHi + ' dB');

    }
    if (want('turn')) {
    /* ---- THE TURN: the sign, pinned to where the sliding sand is seen ------------------- */
    var slideBulb = slideBulbFromApp(), seen = {};
    for (var dir of [1, -1]) for (var below of [0.9, 0.1]) {
      var tr = simTurn(dir, below), wx = 0, wn = 0, sx = 0, agree = 0, tot = 0;
      tr.forEach(function (r) {
        wx += r.x * r.n; wn += r.n;
        var at = 0.55 * slideBulb(r.th, r.nT, r.nB) * Math.sin(r.th);     // where the stage's rush bar is seen across (its y along the glass, turned)
        sx += at * r.n;
        if (Math.abs(r.x) > 0.05) { tot += r.n; if (at * r.x > 0) agree += r.n; }
      });
      seen[dir + '/' + below] = { sand: wx / wn, stage: sx / wn, agree: agree / tot };
    }
    var keys = Object.keys(seen);
    report(keys.every(function (k) { var v = seen[k]; return v.sand * v.stage > 0 && v.agree > 0.9; }) && seen['1/0.9'].sand < 0 && seen['-1/0.9'].sand > 0,
           'TURN: the moving grains of a clockwise turn (sand below) are seen on the left, of an anticlockwise one on the right, and slideBulb() puts the slide on their side in each',
           keys.map(function (k) { var v = seen[k]; return (k[0] === '1' ? 'cw' : 'ccw') + ' below ' + k.split('/')[1] + ': sand ' + v.sand.toFixed(2) + ', stage ' + v.stage.toFixed(2) + ', ' + Math.round(100 * v.agree) + '%'; }).join('; '));
    var other = keys.filter(function (k) { var v = seen[k]; return Math.sin(k[0] === '1' ? 1 : -1) * 0.55 * (+k.split('/')[1] > 0.5 ? 1 : -1) * v.sand > 0; });
    report(other.length === 0, 'CONTROL: today\'s rush pan, sin(angle), is on the other side of the sand where the sand is below or above',
           keys.map(function (k) { return k + ': sin(angle) ' + (k[0] === '1' ? '+' : '-') + ', sand ' + seen[k].sand.toFixed(2); }).join('; '));
    var turn = await job('turn', async function () {
      // the slide alone, mid-turn (a quarter turn each way), in the lower bulb as slideBulb() puts it, and in the upper (the control)
      var one = function (th, slide) {
        return window.__scene({ dur: 3, rate: 0, flow: 0, spatial: true, seed: 3, frame: function () {
          return { turn: th, angle: th, flipping: true, spin: 2.5, slides: 120000, slide: slide, fill: 0.5 };
        } });
      };
      var cw = await one(Math.PI / 2, -1), ccw = await one(-Math.PI / 2, -1), up = await one(Math.PI / 2, 1);
      return { cw: window.__measure(cw, 0.8, 3), ccw: window.__measure(ccw, 0.8, 3), up: window.__measure(up, 0.8, 3) };
    });
    report(turn.cw.itd < -40 && turn.cw.ild < -1 && turn.ccw.itd > 40 && turn.ccw.ild > 1, 'TURN: the slide in the lower bulb a quarter turn clockwise is heard left, anticlockwise right',
           'cw ITD ' + turn.cw.itd + ' us, ILD ' + turn.cw.ild + ' dB; ccw ' + turn.ccw.itd + ' us, ' + turn.ccw.ild + ' dB');
    report(turn.up.itd > 40, 'CONTROL: the slide put in the other bulb is heard on the other side', 'cw, upper bulb: ITD ' + turn.up.itd + ' us, ILD ' + turn.up.ild + ' dB');

    }
    if (want('image')) {
    /* ---- IMAGE control: one speaker dead ahead ----------------------------------------- */
    var mono1 = await job('image control', async function () {
      var S = window.HourglassAudio._stage.STAGE, ring = S.ring, inner = S.inner;
      S.ring = ring.map(function () { return [0, 0]; }); S.inner = [[0, 0], [0, 0]];
      var o = await window.__scene({ dur: 5, rate: 60, spatial: true, seed: 9, frame: function () { return { bottom: 2400 }; } });
      S.ring = ring; S.inner = inner;
      return window.__measure(o, 1, 5);
    });
    report(mono1.corr > 0.6, 'CONTROL: every bar into one speaker dead ahead is a point in the head (the ears correlate over 0.6)', 'corr ' + mono1.corr);

    }
    if (want('still')) {
    /* ---- STILL: nothing scheduled, no panner set; the end of a turn -------------------- */
    var still = await job('still', async function () {
      var count = { gains: 0, pans: 0 }, nodes = null;
      var proto = AudioParam.prototype, sta = proto.setTargetAtTime;
      var o = await window.__scene({ dur: 10.5, rate: 60, spatial: true, seed: 3, setup: function (a) {
        var S = a._stage, g = [];
        for (var k in S.bars) [S.bars[k].L, S.bars[k].R].forEach(function (e) { e.g.forEach(function (n) { g.push(n.gain); }); });
        nodes = g;
        S.spk.forEach(function (p) {
          ['positionX', 'positionY', 'positionZ', 'orientationX'].forEach(function (k) {
            var prm = p[k];
            Object.defineProperty(prm, 'value', { set: function () { count.pans++; }, get: function () { return 0; } });
            prm.setValueAtTime = prm.setTargetAtTime = prm.linearRampToValueAtTime = function () { count.pans++; return this; };
          });
          p.setPosition = p.setOrientation = function () { count.pans++; };
        });
      }, each: function (a, t) {
        if (t > 0.5 && !proto.__counted) {
          proto.__counted = true;
          proto.setTargetAtTime = function () { if (nodes.indexOf(this) >= 0) count.gains++; return sta.apply(this, arguments); };
        }
      }, frame: function () { return { bottom: 2400, fill: 0.4 }; } });
      proto.setTargetAtTime = sta; delete proto.__counted;
      // control: the same, placed every frame
      var c2 = 0, o2;
      var S0 = window.HourglassAudio.prototype._stagePlace;
      window.HourglassAudio.prototype._stagePlace = function (st, t) { this._stage.at[0] += 1; return S0.call(this, st, t); };
      proto.setTargetAtTime = function () { c2++; return sta.apply(this, arguments); };
      o2 = await window.__scene({ dur: 2, rate: 0, flow: 0, spatial: true, seed: 3 });
      proto.setTargetAtTime = sta;
      window.HourglassAudio.prototype._stagePlace = S0;
      return { gains: count.gains, pans: count.pans, control: c2 };
    });
    report(still.gains === 0 && still.pans === 0, 'STILL: 10 s of a steady glass schedule no gain of the stage and set no panner after it is built', still.gains + ' gains, ' + still.pans + ' panner settings');
    report(still.control > 100, 'CONTROL: a stage that places its bars every frame schedules', still.control + ' schedules in 2 s');
    var snap = await job('snap', async function () {
      // a turn ends: the angle eases to half a turn, then snaps to 0 as the glass's ends swap (and the
      // bulbs' fills with them). A steady noise in the left channel of the grains' fader only, so the
      // land bar's left end is heard alone: where it is seen must not move.
      var one = function () {
        return window.__scene({ dur: 3.4, rate: 0, flow: 0, spatial: true, seed: 3, tweak: function (a) {
          var ctx = a.ctx, n = ctx.createBufferSource(), m = ctx.createChannelMerger(2);
          n.buffer = a.white; n.loop = true; n.connect(m, 0, 0); m.connect(a.gTicks); n.start(0);
        }, frame: function (t) {
          var u = Math.min(1, Math.max(0, (t - 0.3) / 1.4)), th = Math.PI * u * u * (3 - 2 * u);
          return t >= 2.0 ? { turn: 0, angle: 0, fill: 0.3, fillTop: 0.6, slide: 1 } : { turn: th, angle: th, fill: 0.6, fillTop: 0.3, slide: -1 };
        } });
      };
      var ears = function (o, t0, t1) {
        var a = Math.floor(t0 * 48000), b = Math.floor(t1 * 48000), l = 0, r = 0;
        for (var i = a; i < b; i++) { l += o.L[i] * o.L[i]; r += o.R[i] * o.R[i]; }
        return [Math.round(1000 * Math.log10(l / (b - a))) / 100, Math.round(1000 * Math.log10(r / (b - a))) / 100];
      };
      var o = await one();
      var S0 = window.HourglassAudio.prototype._stagePlace;
      window.HourglassAudio.prototype._stagePlace = function (st, t) { this._stage.th = NaN; return S0.call(this, st, t); };     // a stage that never swaps its ends
      var c = await one();
      window.HourglassAudio.prototype._stagePlace = S0;
      return { before: ears(o, 1.8, 1.98), after: ears(o, 2.2, 2.4), cBefore: ears(c, 1.8, 1.98), cAfter: ears(c, 2.2, 2.4), j: window.__jump(o, 1.9, 2.3), jc: window.__jump(c, 1.9, 2.3) };
    });
    var dl = Math.max(Math.abs(snap.after[0] - snap.before[0]), Math.abs(snap.after[1] - snap.before[1]));
    var dc = Math.max(Math.abs(snap.cAfter[0] - snap.cBefore[0]), Math.abs(snap.cAfter[1] - snap.cBefore[1]));
    report(dl <= 1 && snap.j.worst <= 1, 'STILL: the end of a turn (half a turn back to nothing, the ends swapped) makes no jump in either ear',
           'left/right ' + snap.before.join('/') + ' -> ' + snap.after.join('/') + ' dB; the largest step ' + snap.j.worst + ' dB per ms');
    report(dc > 3, 'CONTROL: a stage that does not swap its ends with the glass swaps the sides at the end of a turn',
           'left/right ' + snap.cBefore.join('/') + ' -> ' + snap.cAfter.join('/') + ' dB');

    }
    if (PRINT) lines.forEach(function (l) { console.log('INFO ' + l); });
    if (PRINT && Object.keys(cal).length) console.log('CAL ' + JSON.stringify({ res: cal }));
    report(null, 'renders ' + renders + ', of which hung ' + hangs);
  } catch (e) {
    report(false, 'the suite ran', String(e && e.stack || e).split('\n').slice(0, 4).join(' '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (cases - failures) + '/' + cases + ' passed' + (hangs ? ', ' + hangs + ' render(s) hung and were done again' : ''));
  process.exit(failures ? 1 : 0);
}
main();
