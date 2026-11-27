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
 *   WATER each ambience is played from loops rendered for the stage, within 1 dB of itself
 *         without it, wide, with nothing more in the graph; what a loop's left channel holds
 *         is heard in front on the left and again, later, quieter and darker, from behind; a
 *         rendered loop closes without a click; the fade before the end, the Ambience level and
 *         a change of ambience work as without the stage. Controls: rendered without the
 *         directions behind; rendered from its start, not going round; water sent round its bus.
 *   BOWL  within 1 dB of the bowl without the stage at Bowl 50 and 100 and rung again (Rings);
 *         to the right and steady, second by second and by the quarter second; its place in
 *         the mix only while it rings; stopped by a tap; the switch thrown while it rings
 *         leaves it where it began. Controls: its two channels each to a speaker of its own; a
 *         place that never leaves the mix; a bowl left to ring.
 *   SWITCH on and off under a steady tone, and thrown about, no step louder than -40 dBFS; ten
 *         times thrown, nothing left connected; the Sound volume, the Sand level, a change of
 *         character and Sound in silent mode as without the stage. Controls: no crossfade; a
 *         stage taken down without letting go of its nodes; a Sand level that moves only the
 *         old gain; a correction that stays the first character's; a session left alone.
 *   HIDDEN hold() and no update() for seven seconds keeps the glass sounding with the stage on,
 *         and the switch thrown under the hold does no harm. Control: no hold().
 *   POSE  the phone laid flat for over a second lowers the glass. Control: half way down.
 *   START (where the engine has begin(), the sound coming in gently at a start) the water's
 *         rise and the sand's are the same with the stage on, and the switch thrown in the
 *         middle of a rise does not jump it. Controls: water round its bus; a start with no rise.
 *   COST  ten seconds of a running glass render with the stage on in at most 1.4 times the
 *         time without it, alone and with a brook (medians of five, in turn: run the suite
 *         alone). Control: the water live through four panners, the bowl's place always joined.
 *
 * Headless Chromium now and then never finishes an offline render that has HRTF panners in it:
 * when the render has to wait for the browser to load its HRTF data (about one first render in
 * sixteen; none of 64 that found the data loaded). Each fresh page here makes a panner and
 * gives the load a moment before it renders; each render still has a watchdog and is done once
 * more in a fresh browser if it hangs, and the count is printed.
 *
 *   node tools/test/audio-spatial.test.js [port]      (argv[2], else $PORT, else 8811)
 *   HOURGLASS_SPATIAL_PRINT=1 prints every measure; HOURGLASS_SPATIAL_ONLY=<regexp> runs only
 *   those groups (off, level, place, turn, image, still, water, bowl, switch, hidden, pose, start,
 *   cost); HOURGLASS_SPATIAL_AUDIO=<file> holds another copy of sound/audio.js to them
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
var ENGINE = process.env.HOURGLASS_SPATIAL_AUDIO || '';                    // (another copy of sound/audio.js to hold to these checks: a merge being tried)
var WATCHDOG_MS = +process.env.HOURGLASS_SPATIAL_WATCHDOG_MS || 90000;     // (set small to try the retry: every render then counts as hung)

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
   * volume, seed, flat (compressor and clipper made plain), setup(a), tweak(a) (after the stage),
   * ambience (an id: made at once, seed 1, and chosen), bowlLevel, sandLevel, each(a, t, f) after
   * every frame's update (it may return a promise: the render waits for it), skip(t) (true: no
   * update this frame, as on a hidden page), track (what is connected to what is kept: __edges) }
   * Resolves to { L, R, a (the engine), ms (the render alone), panners (made on its context) }.
   */
  window.__scene = function (o) {
    var E = o.E ? window[o.E] : A;
    Math.random = seeded(o.seed || 4242);
    var off = new OfflineAudioContext(2, Math.round(SR * o.dur), SR);
    Object.defineProperty(off, 'state', { get: function () { return 'running'; } });
    var a = new E(), panners = 0, mk = off.createPanner;
    off.createPanner = function () { panners++; return mk.apply(off, arguments); };
    edges.clear(); tracking = o.track ? off : null;
    a.ctx = off;
    a.volume = o.volume != null ? o.volume : 0.8;
    if (o.character) a.character = o.character;
    if (o.bowlLevel != null) a.bowlLevel = o.bowlLevel;
    if (o.sandLevel != null) a.sandLevel = o.sandLevel;
    if (o.ambience) { a._makeAmbience(o.ambience, 1); a.ambience = o.ambience; }
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
    var NF = Math.floor((o.dur - 0.1) * 60), ms = 0;
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
          if (!o.skip || !o.skip(t)) a.update(f);
          Promise.resolve(o.each ? o.each(a, t, f) : 0).then(function () { off.resume(); });
        });
      })(k);
      ms = performance.now();
      return off.startRendering();
    }).then(function (buf) {
      ms = performance.now() - ms;
      Math.random = realRandom;
      tracking = null;
      return { L: buf.getChannelData(0), R: buf.getChannelData(1), a: a, ms: ms, panners: panners };
    });
  };
  /** Near the frame at t0 (called once per frame: true for exactly one of them). */
  window.__at = function (t, t0) { return Math.abs(t - t0) < 0.5 / 60 - 1e-9; };

  /* ---- what is connected to what in a scene's own context, while it asks for it (track) ---- */
  var ids = new WeakMap(), nextId = 1, edges = new Set(), tracking = null;
  function idOf(n) { var i = ids.get(n); if (!i) { i = nextId++; ids.set(n, i); } return i; }
  var conn = AudioNode.prototype.connect, disc = AudioNode.prototype.disconnect;
  AudioNode.prototype.connect = function (dest, out, inp) {
    if (tracking === this.context && dest instanceof AudioNode) edges.add(idOf(this) + '>' + idOf(dest) + ':' + (out || 0) + ':' + (inp || 0));
    return conn.apply(this, arguments);
  };
  AudioNode.prototype.disconnect = function (dest, out, inp) {
    var r = disc.apply(this, arguments);                      // (it throws before anything is forgotten)
    if (tracking !== this.context) return r;
    var me = idOf(this) + '>', to = dest instanceof AudioNode ? me + idOf(dest) + ':' : me;
    edges.forEach(function (e) {
      if (e.indexOf(to) !== 0) return;
      var q = e.split(':');
      if (typeof dest === 'number' ? q[1] === String(dest) : ((out === undefined || q[1] === String(out)) && (inp === undefined || q[2] === String(inp)))) edges.delete(e);
    });
    return r;
  };
  /** How many connections there are now, and how many go into the engine's bus, its rumble filter, its Sand level, the ambience's bus. */
  window.__edges = function (a) {
    var into = function (n) { var k = '>' + idOf(n) + ':', c = 0; edges.forEach(function (e) { if (e.indexOf(k) > 0) c++; }); return c; };
    return { all: edges.size, bus: into(a.bus), rumble: into(a.rumble), sand: into(a.gSand), amb: into(a.ambBus), conv: into(a.conv) };
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
  /** ITD (µs, + the right ear leads) from the cross-correlation of 300-1500 Hz (or of lo-hi Hz), and its peak. */
  function itd(L, R, a, b, lo, hi) {
    var l = band(L, lo || 300, hi || 1500), r = band(R, lo || 300, hi || 1500), M = 48, best = -1e30, bd = 0, c = [];
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
  /** How far apart two renders are (over [t0, t1) if given): the difference, in dB under the first (-200: the same samples). */
  window.__apart = function (x, y, t0, t1) {
    var e = 0, d = 0, a = t0 ? Math.floor(t0 * SR) : 0, b = t1 ? Math.min(x.L.length, Math.floor(t1 * SR)) : x.L.length;
    for (var i = a; i < b; i++) { var u = x.L[i] - y.L[i], v = x.R[i] - y.R[i]; d += u * u + v * v; e += x.L[i] * x.L[i] + x.R[i] * x.R[i]; }
    return d === 0 ? -200 : r2(10 * Math.log10(d / e));
  };
  /** The peak (dBFS, either ear) of what is left above fc Hz over [t0, t1): a click is all of it, a tone under fc none. */
  window.__click = function (o, fc, t0, t1) {
    var a = Math.floor(t0 * SR), b = Math.min(o.L.length, Math.floor(t1 * SR)), pk = 0;
    [o.L, o.R].forEach(function (x) {
      var y = biquad(biquad(x, 'hp', fc, 0.54), 'hp', fc, 1.31);
      for (var i = a; i < b; i++) if (Math.abs(y[i]) > pk) pk = Math.abs(y[i]);
    });
    return r2(20 * Math.log10(pk + 1e-12));
  };
  /** ITD (µs) and ILD (dB) of each window of w s over [t0, t1), in the band lo-hi Hz. */
  window.__windows = function (o, t0, t1, w, lo, hi) {
    var out = { itd: [], ild: [] }, l = band(o.L, lo, hi), r = band(o.R, lo, hi);
    for (var t = t0; t + w <= t1 + 1e-9; t += w) {
      var a = Math.floor(t * SR), b = Math.floor((t + w) * SR);
      out.itd.push(itd(o.L, o.R, a, b, lo, hi)); out.ild.push(r2(db(pw(r, a, b)) - db(pw(l, a, b))));
    }
    return out;
  };
  /** The level (dB, both ears) over [t0, t1). */
  window.__level = function (o, t0, t1) {
    var a = Math.floor(t0 * SR), b = Math.min(o.L.length, Math.floor(t1 * SR));
    return r2(db(0.5 * (pw(o.L, a, b) + pw(o.R, a, b))));
  };
  /** Switch the stage on from inside a scene's each(): a promise the render waits for. */
  window.__on = function (a) { return a.setSpatial(true); };
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
  /** A fresh page; after a hang, a fresh browser too (one whose render hung may not close a page or open another). */
  async function fresh(hard) {
    var wait = function (p) { return Promise.race([p.catch(function () {}), new Promise(function (r) { setTimeout(r, 10000); })]); };
    if (page) await wait(page.close());
    if (hard) {
      var old = browser;
      await wait(old.close());
      try { if (old.process && old.process()) old.process().kill('SIGKILL'); } catch (e) {}
      browser = await chromium.launch();
    }
    page = await browser.newPage();
    page.on('pageerror', function (e) { console.log('INFO page error  ' + e.message); });
    await page.route(BASE + '/__spatial.html', function (r) {
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="' + AUDIO + '"></script><script src="/__base-audio.js"></script>' });
    });
    await page.route(BASE + '/__base-audio.js', function (r) { r.fulfill({ contentType: 'text/javascript', body: baseSrc }); });
    if (ENGINE) await page.route(BASE + AUDIO, function (r) { r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(ENGINE, 'utf8') }); });
    await page.goto(BASE + '/__spatial.html');
    await page.evaluate(harness);
    // The browser loads its HRTF data when the first HRTF panner is made, on a thread of its own. An
    // offline render that has to wait for that load now and then never ends; one that finds the data
    // loaded has never been seen to hang. So: a panner, kept, and a moment for the load.
    await page.evaluate(function () {
      var c = window.__warm = new OfflineAudioContext(1, 128, 48000), p = window.__warmPanner = c.createPanner();
      p.panningModel = 'HRTF';
      return new Promise(function (r) { setTimeout(r, +(window.__warmMs || 1500)); });
    });
  }
  /** One job in the page, with a watchdog: a render that hangs is done once more on a fresh page. */
  var ONLY = process.env.HOURGLASS_SPATIAL_ONLY ? new RegExp(process.env.HOURGLASS_SPATIAL_ONLY) : null;
  function want(group) { return !ONLY || ONLY.test(group); }       // (HOURGLASS_SPATIAL_ONLY: a regular expression of the groups to run)
  async function job(name, fn, arg, ms) {
    for (var k = 0; k < 2; k++) {
      var timer, hung = false;
      var r = await Promise.race([page.evaluate(fn, arg), new Promise(function (res) { timer = setTimeout(function () { hung = true; res(null); }, ms || WATCHDOG_MS); })]);
      clearTimeout(timer);
      renders++;
      if (!hung) return r;
      hangs++;
      console.log('INFO ' + name + ': a render hung (no end after ' + (ms || WATCHDOG_MS) / 1000 + ' s); once more on a fresh page');
      await fresh(true);
    }
    throw new Error(name + ': hung twice');
  }
  try {
    await fresh();
    if (ENGINE) report(null, 'the engine held to these checks is ' + ENGINE + ', not the tree\'s');
    var lines = [], cal = {};
    var chars = await page.evaluate(function () { return Object.keys(window.HourglassAudio.CHARACTERS); });

    if (want('off')) {
    /* ---- OFF: the switch off is today, to the last bit ---------------------------------- */
    var off = await job('off', async function () {
      var mix = function (E, sp, flat, cross) {
        return window.__scene({ E: E, dur: 5, rate: 190, flow: 290, spatial: sp, seed: 5, flat: flat, frame: function (t) {
          return { bottom: 6000, slides: 30000, agit: 1, fill: 0.5 };
        }, each: function (a, t) {
          if (Math.abs(t - 1.0) < 0.009) { a.thump(1, 0.3, 1); a.clack(1, -0.2); a.tap(); }
          if (Math.abs(t - 2.0) < 0.009) { a.flipEnd(); a.creak(3, 0.4); }
          if (cross && window.__at(t, 0.3)) return window.__on(a);
          if (cross && window.__at(t, 2.4)) a.setSpatial(false);
        } });
      };
      var base = await mix('HourglassAudioBase', false), base2 = await mix('HourglassAudioBase', false), now = await mix('HourglassAudio', false);
      var onoff = await mix('HourglassAudio', 'onoff'), on = await mix('HourglassAudio', true), cross = await mix('HourglassAudio', false, false, true);
      var fa = await mix('HourglassAudioBase', false, true), fb = await mix('HourglassAudioBase', false, true);
      var k99 = { L: base2.L.map(function (v) { return v * 0.99; }), R: base2.R.map(function (v) { return v * 0.99; }) };
      return { flatSelf: window.__apart(fa, fb), self: window.__apart(base, base2), k99: window.__apart(base, k99), now: window.__apart(base, now), onoff: window.__apart(base, onoff), on: window.__apart(base, on), rms: window.__measure(base, 1, 5).rms,
               cross: window.__apart(base, cross, 4, 5), selfEnd: window.__apart(base, base2, 4, 5), k99End: window.__apart(base, k99, 4, 5), crossMid: window.__apart(base, cross, 1, 2) };
    });
    // (a render here is not the same to the last bit as itself: the same engine twice differs by about -92 dB.
    // Today's engine and this one with the switch off differ by no more than that, and the control, a gain
    // of 0.99 on the base engine's output, by far more: -40 dB)
    var tol = Math.max(off.self, -200) + 3;
    report(off.now <= tol && off.now <= -80, 'OFF: with the switch untouched the sand mix (Sand level 100, thumps, a clack, a tap, a creak) is ' + SOUND_BASE + '\'s, to within what a render differs from itself',
           'difference ' + off.now + ' dB under the sound (' + off.rms + ' dBFS); two renders of the base engine differ by ' + off.self + ' dB' + (off.flatSelf != null ? ' (' + off.flatSelf + ' with the compressor made plain)' : ''));
    report(off.onoff <= tol && off.onoff <= -80, 'OFF: switched on and then off before it plays, the same mix is ' + SOUND_BASE + '\'s, to within the same', 'difference ' + off.onoff + ' dB');
    report(off.cross <= Math.max(off.selfEnd, -200) + 6 && off.cross <= -80 && off.crossMid > -60, 'OFF: switched on while it plays (the thumps, the clack and the tap heard through the stage), then off: a second and a half later the mix is ' + SOUND_BASE + '\'s again, to within the same',
           'difference ' + off.cross + ' dB over the last second (two renders of the base engine: ' + off.selfEnd + ' dB there); while the stage was on ' + off.crossMid + ' dB');
    report(off.k99 > tol && off.k99 > -80 && off.k99End > -80, 'CONTROL: the base engine at a gain of 0.99 is not', 'difference ' + off.k99 + ' dB (' + off.k99End + ' dB over the last second)');
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
    if (want('water')) {
    /* ---- WATER: the ambiences placed, at their level, their loops closed, their ways kept -- */
    var ambs = await page.evaluate(function () { return Object.keys(window.HourglassAudio.AMBIENCES).filter(function (k) { return k !== 'none' && k !== 'tone'; }); });
    for (var ai = 0; ai < ambs.length; ai++) {
      var wt = await job('water ' + ambs[ai], async function (id) {
        var sc = function (sp) { return window.__scene({ dur: 16, rate: 0, flow: 0, spatial: sp, seed: 7, ambience: id, frame: function () { return { running: true, ambient: true }; } }); };
        var o0 = await sc(false), o1 = await sc(true);
        return { off: window.__measure(o0, 3, 16), on: window.__measure(o1, 3, 16), placed: !!(o1.a._amb && o1.a._amb.baked), panners: o1.panners,
                 srcs: [o0.a._amb.srcs.length, o1.a._amb.srcs.length], speakers: window.HourglassAudio._stage.STAGE.ring.length + 2 + window.HourglassAudio._stage.STAGE.bowl.at.length };
      }, ambs[ai]);
      var dw = wt.on.rms - wt.off.rms, bw2 = wt.on.bands.map(function (b, i) { return Math.round((b - wt.off.bands[i]) * 10) / 10; });
      var wline = ambs[ai] + ': level ' + (dw >= 0 ? '+' : '') + dw.toFixed(2) + ' dB, octaves 250-8k ' + bw2.join(' ') + ', the ears correlate ' + wt.off.corr + ' -> ' + wt.on.corr;
      lines.push('water ' + wline);
      report(wt.placed && Math.abs(dw) <= 1, 'WATER ' + ambs[ai] + ': played from loops rendered for the stage, within 1 dB of the same water without it', wline);
      report(wt.on.corr > -0.3 && wt.on.corr <= Math.max(0.6, wt.off.corr + 0.05) && wt.panners === wt.speakers && wt.srcs[0] === wt.srcs[1],
             'WATER ' + ambs[ai] + ': wide (the ears correlate under 0.6, or no more than its own two channels do), and nothing more in the graph for it: as many sources as without the stage, no speaker of its own',
             'corr ' + wt.on.corr + '; ' + wt.srcs.join(' and ') + ' sources; ' + wt.panners + ' panners made, the stage\'s ' + wt.speakers);
    }
    var behind = await job('water behind', async function () {
      // one loop rendered for the stage by itself: a second of silence with a click in its left channel
      var A = window.HourglassAudio, st = A._stage, SR = 48000, W = st.STAGE.water;
      var ir = await st.room(SR), ctx = new OfflineAudioContext(2, 128, SR), buf = ctx.createBuffer(2, SR, SR);
      buf.getChannelData(0)[SR / 2] = 1;
      var run = function () { return new Promise(function (res) { st.water(ir.ears, buf, ctx, res); }); };
      var parts = function (b) {
        // by time after the click's first arrival: the 11 ms the front takes, then what comes later; both ears; and the share above 6 kHz
        var o = { L: b.getChannelData(0), R: b.getChannelData(1) }, a = SR / 2, first = a;
        while (first < SR - 1 && Math.abs(o.L[first]) < 1e-4 && Math.abs(o.R[first]) < 1e-4) first++;
        var e = function (x, i0, i1) { var s = 0; for (var i = i0; i < i1; i++) s += x[i] * x[i]; return s; };
        var hp = function (x) { var y = new Float32Array(x.length), p = 0, q = 0, k = Math.exp(-2 * Math.PI * 6000 / SR); for (var i = 0; i < x.length; i++) { q = k * (q + x[i] - p); p = x[i]; y[i] = q; } return y; };
        var cut = first + Math.round(0.011 * SR), end = first + Math.round(0.06 * SR), hl = hp(o.L), hr = hp(o.R);
        var early = e(o.L, first, cut) + e(o.R, first, cut), late = e(o.L, cut, end) + e(o.R, cut, end);
        return { late: 10 * Math.log10(late / early + 1e-12), earlyHi: (e(hl, first, cut) + e(hr, first, cut)) / early, lateHi: (e(hl, cut, end) + e(hr, cut, end)) / (late + 1e-30),
                 ildEarly: 10 * Math.log10(e(o.R, first, cut) / e(o.L, first, cut)), ildLate: 10 * Math.log10((e(o.R, cut, end) + 1e-30) / (e(o.L, cut, end) + 1e-30)), ms: (first - a) / SR * 1000 };
      };
      var both = parts(await run()), keep = W.back;
      W.back = 0;
      var front = parts(await run());
      W.back = keep;
      return { both: both, front: front };
    });
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    report(behind.both.late > -12 && behind.both.late < -2 && behind.both.lateHi < 0.7 * behind.both.earlyHi && behind.both.ildEarly < -3 && behind.both.ildLate < -3,
           'WATER: a click in a loop\'s left channel is heard from the front left, and again from behind on the left: later, quieter and darker',
           'what arrives after the first 11 ms is ' + r1(behind.both.late) + ' dB under what arrives in them; its share above 6 kHz ' + behind.both.lateHi.toFixed(2) + ' against ' + behind.both.earlyHi.toFixed(2) +
           '; right against left ' + r1(behind.both.ildEarly) + ' dB, then ' + r1(behind.both.ildLate) + ' dB');
    report(behind.front.late < -25, 'CONTROL: rendered without the two directions behind, nothing arrives later', r1(behind.front.late) + ' dB');
    var join = await job('water join', async function () {
      var A = window.HourglassAudio, W = A._stage.STAGE.water;
      if (!A.AMBIENCES.tone) A.defineAmbience({ id: 'tone', name: 'Tone', icon: '<path d="M1 1"/>', layers: [{ seconds: 2, sr: 48000, make: function (sr, seconds, ch) {
        var n = Math.floor(sr * seconds), a = new Float32Array(n), f = ch ? 165 : 110;       // (whole cycles in the loop: it closes as it is made)
        for (var i = 0; i < n; i++) a[i] = 0.4 * Math.sin(2 * Math.PI * f * i / sr);
        return a;
      } }] });
      var sc = function (sp) { return window.__scene({ dur: 8, rate: 0, flow: 0, spatial: sp, seed: 7, ambience: 'tone', frame: function () { return { running: true, ambient: true }; } }); };
      var o0 = await sc(false), o1 = await sc(true), lead = W.lead;
      W.lead = 0;
      var cold = await sc(true);
      W.lead = lead;
      return { off: window.__click(o0, 3000, 2.5, 8), on: window.__click(o1, 3000, 2.5, 8), cold: window.__click(cold, 3000, 2.5, 8), level: window.__level(o1, 2.5, 8), placed: !!o1.a._amb.baked };
    });
    report(join.placed && join.on < -60, 'WATER: a loop rendered for the stage closes on itself: two tones played round it for 8 s leave nothing above 3 kHz (no click at the join)',
           'peak above 3 kHz ' + join.on + ' dBFS (the tones ' + join.level + ' dBFS; without the stage ' + join.off + ' dBFS)');
    report(join.cold > -50, 'CONTROL: rendered from its start, not going round, the loop clicks at its join', 'peak above 3 kHz ' + join.cold + ' dBFS');
    var ways = await job('water ways', async function () {
      var run = { running: true, ambient: true }, L = window.__level, out = {};
      var sc = function (sp, o) { return window.__scene(Object.assign({ dur: 9, rate: 0, flow: 0, spatial: sp, seed: 7, ambience: 'brook', frame: function () { return run; } }, o)); };
      var fading = function (t) { return t < 3 ? run : { running: true, ambient: true, ambFade: 0.25 }; };
      var quieter = function (a, t) { if (window.__at(t, 3)) a.setAmbienceLevel(0.25); };
      var toRain = function (a, t) {
        if (!window.__at(t, 3)) return;
        a._makeAmbience('rain', 1); a.setAmbience('rain');
        return new Promise(function (res) { (function look() { if (a._amb && a._amb.id === 'rain') res(); else setTimeout(look, 20); })(); });
      };
      for (var sp of [false, true]) {
        var plain = await sc(sp), fade = await sc(sp, { frame: fading }), lvl = await sc(sp, { each: quieter }), chg = await sc(sp, { each: toRain });
        out[sp ? 'on' : 'off'] = { plain: L(plain, 6, 9), fade: L(fade, 6, 9), lvl: L(lvl, 6, 9), chg: L(chg, 6, 9), placed: !!(chg.a._amb && chg.a._amb.baked), kept: Object.keys(chg.a._ambBake).join(',') };
      }
      // control: the placed water sent round its bus and its fade, straight to the output chain
      var round = function (a) { a._amb.g.disconnect(); a._amb.g.connect(a.comp); };
      var cp = await sc(true, { tweak: round }), cf = await sc(true, { tweak: round, frame: fading }), cl = await sc(true, { tweak: round, each: quieter });
      out.control = { plain: L(cp, 6, 9), fade: L(cf, 6, 9), lvl: L(cl, 6, 9) };
      return out;
    });
    var wd = function (w, k) { return Math.round((w[k] - w.plain) * 100) / 100; };
    var waysOk = function (on) { return Math.abs(wd(on, 'fade') - wd(ways.off, 'fade')) <= 0.5 && Math.abs(wd(on, 'lvl') - wd(ways.off, 'lvl')) <= 0.5; };
    report(waysOk(ways.on) && wd(ways.off, 'fade') < -8 && wd(ways.off, 'lvl') < -6,
           'WATER: with the stage on, the fade before the end (a quarter left) and the Ambience level (50 to 25) take the water down as they do without it, within 0.5 dB',
           'the fade ' + wd(ways.on, 'fade') + ' dB (without the stage ' + wd(ways.off, 'fade') + '), the level ' + wd(ways.on, 'lvl') + ' dB (' + wd(ways.off, 'lvl') + ')');
    report(!waysOk(ways.control), 'CONTROL: placed water that goes round its bus and its fade is taken down by neither', 'the fade ' + wd(ways.control, 'fade') + ' dB, the level ' + wd(ways.control, 'lvl') + ' dB');
    report(ways.on.placed && ways.on.kept === 'rain' && Math.abs(ways.on.chg - ways.off.chg) <= 1,
           'WATER: another ambience chosen with the stage on is rendered for it and played placed, within 1 dB of the same change without the stage; the one before lets its rendered loops go',
           'the rain ' + ways.on.chg + ' dBFS (without the stage ' + ways.off.chg + '); loops rendered for the stage kept: ' + ways.on.kept);

    }
    if (want('bowl')) {
    /* ---- BOWL: out in the room, front right, steady, at its level, there only while it rings -- */
    var bowl = await job('bowl', async function () {
      var L = window.__level, out = { lv: {} };
      var ring = function (sp, lvl, o) {
        return window.__scene(Object.assign({ dur: 11, rate: 0, flow: 0, spatial: sp, seed: 5, bowlLevel: lvl, each: function (a, t) { if (window.__at(t, 0.5)) a.chime(0); } }, o));
      };
      for (var lvl of [1, 2]) {
        var o0 = await ring(false, lvl), o1 = await ring(true, lvl);
        out.lv[lvl] = { off: L(o0, 0.6, 9.5), on: L(o1, 0.6, 9.5), peakOff: window.__measure(o0, 0.6, 9.5).peak, peakOn: window.__measure(o1, 0.6, 9.5).peak };
        if (lvl === 1) { out.win = window.__windows(o1, 1, 7, 1, 300, 420); out.winOff = window.__windows(o0, 1, 7, 1, 300, 420); out.m = window.__measure(o1, 1, 7); out.fine = window.__windows(o1, 1, 5, 0.25, 300, 420); }
      }
      // control: the bowl's two channels each to its own speaker: the beating pairs then beat between two places
      var two = await ring(true, 1, { tweak: function (a) {
        var n = a._stage.bowl.nodes, bsp = n[2], one = n[3], p2 = n[6], g = a.ctx.createGain();
        g.gain.value = one.gain.value; g.channelCount = 1; g.channelCountMode = 'explicit';
        one.disconnect(p2); bsp.connect(g, 1); g.connect(p2);
      } });
      out.two = window.__windows(two, 1, 7, 1, 300, 420); out.twoFine = window.__windows(two, 1, 5, 0.25, 300, 420);
      return out;
    });
    var span = function (x) { return Math.max.apply(null, x) - Math.min.apply(null, x); };
    [1, 2].forEach(function (lvl) {
      var b = bowl.lv[lvl], d = Math.round((b.on - b.off) * 100) / 100;
      lines.push('bowl level ' + lvl * 50 + ': ' + d + ' dB (peak ' + b.peakOff + ' -> ' + b.peakOn + ' dBFS)');
      report(Math.abs(d) <= 1, 'BOWL at Bowl level ' + lvl * 50 + ': within 1 dB of the bowl without the stage', b.on + ' against ' + b.off + ' dBFS; peak ' + b.peakOff + ' -> ' + b.peakOn + ' dBFS');
    });
    // (its place is measured on its fundamental, 300-420 Hz: the partials above it die sooner, and each has its own ITD)
    report(bowl.m.itd > 100 && bowl.m.ild > 1 && span(bowl.win.itd) <= 100 && span(bowl.win.ild) <= 1,
           'BOWL: heard to the right, and steady: from one second to the next its place moves by no more than 100 us and 1 dB',
           'ITD ' + bowl.m.itd + ' us, ILD ' + bowl.m.ild + ' dB; by the second: ITD ' + bowl.win.itd.join(' ') + ' us, ILD ' + bowl.win.ild.join(' ') + ' dB (without the stage: ITD ' + bowl.winOff.itd.join(' ') + ', ILD ' + bowl.winOff.ild.join(' ') + ')');
    report(span(bowl.fine.itd) <= 100, 'BOWL: nor does it beat between two places: by the quarter second its ITD stays within 100 us',
           'ITD ' + bowl.fine.itd.join(' ') + ' us (ILD ' + bowl.fine.ild.join(' ') + ' dB)');
    report(span(bowl.twoFine.itd) > 100, 'CONTROL: its two channels each to a speaker of its own, the beating pairs beat between the two: its ITD swings by over 100 us',
           'ITD ' + bowl.twoFine.itd.join(' ') + ' us; by the second ' + bowl.two.itd.join(' ') + ' us');
    var rings = await job('bowl rings', async function () {
      var A = window.HourglassAudio, L = window.__level, seen = [];
      var sc = function (sp, o) {
        return window.__scene(Object.assign({ dur: 20, rate: 0, flow: 0, spatial: sp, seed: 5, track: true, each: function (a, t) {
          if (window.__at(t, 0.5) || window.__at(t, 8.5)) a.chime(0);
          [0.3, 5, 12, 19].forEach(function (x) { if (window.__at(t, x)) { var e = window.__edges(a); seen.push([x, e.bus, e.rumble, !!(a._stage && a._stage.bowl.on)]); } });
        } }, o));
      };
      var take = function () { var s = seen; seen = []; return s; };
      var o0 = await sc(false), s0 = take(), o1 = await sc(true), s1 = take();
      // control: a place for the bowl that never leaves the mix
      var orig = A.prototype._stageBowl;
      A.prototype._stageBowl = function () { return orig.call(this, 1e9); };
      await sc(true);
      A.prototype._stageBowl = orig;
      var s2 = take();
      // stopped by a tap
      var stop = async function (sp, tap) {
        var o = await window.__scene({ dur: 5, rate: 0, flow: 0, spatial: sp, seed: 5, each: function (a, t) { if (window.__at(t, 0.5)) a.chime(0); if (tap && window.__at(t, 3)) a.stopChime(); } });
        return Math.round((L(o, 3.7, 4.2) - L(o, 2.4, 2.9)) * 10) / 10;
      };
      return { off: [L(o0, 0.6, 8.4), L(o0, 8.6, 17.5)], on: [L(o1, 0.6, 8.4), L(o1, 8.6, 17.5)], s0: s0, s1: s1, s2: s2, stop: [await stop(false, true), await stop(true, true), await stop(true, false)] };
    });
    var rd = [0, 1].map(function (i) { return Math.round((rings.on[i] - rings.off[i]) * 100) / 100; });
    report(Math.abs(rd[0]) <= 1 && Math.abs(rd[1]) <= 1, 'BOWL with Rings: rung again 8 s later, each ring is within 1 dB of the same ring without the stage', rd.join(' and ') + ' dB');
    var joined = function (s) { return s.map(function (r) { return r[0] + ' s: ' + r[1] + ' into the bus, ' + r[2] + ' into the output chain' + (r[3] ? ', joined' : ''); }).join('; '); };
    var partOk = function (s) { return s[0][1] === s[3][1] && s[0][2] === s[3][2] && s[1][1] === s[0][1] && s[1][2] === s[0][2] + 2 && s[2][2] === s[1][2] && !s[0][3] && s[1][3] && s[2][3] && !s[3][3]; };
    report(partOk(rings.s1), 'BOWL: its place joins the mix when a bowl rings, stays through the second ring, and has left it a second after the last has rung out', joined(rings.s1));
    report(!partOk(rings.s2), 'CONTROL: a place for the bowl that never leaves the mix is found out', joined(rings.s2));
    report(rings.stop[0] < -30 && rings.stop[1] < -30, 'BOWL: a bowl stopped (a tap) falls silent with the stage on as without it', 'half a second on: ' + rings.stop[1] + ' dB (without the stage ' + rings.stop[0] + ' dB)');
    report(rings.stop[2] > -10, 'CONTROL: left to ring, it does not', rings.stop[2] + ' dB');
    var btg = await job('bowl toggle', async function () {
      var L = window.__level, seen = [];
      var sc = function (sp, way) {
        return window.__scene({ dur: 12, rate: 0, flow: 0, spatial: sp, seed: 5, track: true, each: function (a, t) {
          if (window.__at(t, 0.5)) a.chime(0);
          if (window.__at(t, 11.5)) seen.push(window.__edges(a).all);
          if (window.__at(t, 2)) { if (way === 'on') return window.__on(a); if (way === 'off') a.setSpatial(false); }
        } });
      };
      var ref0 = await sc(false), tOn = await sc(false, 'on'), ref1 = await sc(true), tOff = await sc(true, 'off');
      var one = function (o, ref) { return { d: Math.round((L(o, 2.5, 8) - L(ref, 2.5, 8)) * 100) / 100, click: window.__click(o, 6000, 1.9, 3), ref: window.__click(ref, 6000, 1.9, 3), itd: window.__measure(o, 3, 7).itd, itdRef: window.__measure(ref, 3, 7).itd }; };
      return { on: one(tOn, ref0), off: one(tOff, ref1), edges: seen, state: [tOn.a._spatial, tOff.a._stage === null] };
    });
    var tgOk = function (v) { return Math.abs(v.d) <= 0.5 && v.click <= Math.max(-40, v.ref + 3) && Math.abs(v.itd - v.itdRef) <= 50; };
    report(tgOk(btg.on) && tgOk(btg.off) && btg.state[0] && btg.state[1] && btg.edges[3] === btg.edges[0],
           'BOWL: the switch thrown while a bowl rings does it no harm: it rings on where it began (level within 0.5 dB, place within 50 us, no click), and its place is let go once it has rung out',
           'switched on at 2 s: ' + JSON.stringify(btg.on) + '; switched off: ' + JSON.stringify(btg.off) + '; connections at the end ' + btg.edges.join(', '));

    }
    if (want('switch')) {
    /* ---- SWITCH: no click, nothing left behind, and everything else as it was -------------- */
    var sw = await job('switch click', async function () {
      var A = window.HourglassAudio, S = A._stage.STAGE, L = window.__level;
      var sc = function (how) {
        return window.__scene({ dur: 4, rate: 0, flow: 0, seed: 3, setup: function (a) {
          // a steady low tone in both channels of the grains' fader: a step in it is a click, and nothing else in it is above 4 kHz
          var ctx = a.ctx, o = ctx.createOscillator(), g = ctx.createGain(), m = ctx.createChannelMerger(2);
          o.frequency.value = 220; g.gain.value = 0.5;
          o.connect(g); g.connect(m, 0, 0); g.connect(m, 0, 1); m.connect(a.gTicks); o.start(0);
        }, each: function (a, t) {
          if (how === 'once') { if (window.__at(t, 1)) return window.__on(a); if (window.__at(t, 2.5)) a.setSpatial(false); }
          if (how === 'about') {
            // thrown about: on, off while it crosses in, on, off, and at last off
            if (window.__at(t, 1)) return window.__on(a);
            if (window.__at(t, 1.1)) a.setSpatial(false);
            if (window.__at(t, 1.15)) a.setSpatial(true);
            if (window.__at(t, 1.2)) a.setSpatial(false);
            if (window.__at(t, 2.2)) { a.setSpatial(true); a.setSpatial(false); return window.__on(a); }
            if (window.__at(t, 2.3)) a.setSpatial(false);
          }
        } });
      };
      var ref = await sc(), once = await sc('once'), about = await sc('about'), xf = S.xf;
      S.xf = 0;
      var hard = await sc('once');
      S.xf = xf;
      var c = function (o) { return window.__click(o, 4000, 0.8, 3.6); };
      return { tone: L(ref, 1, 3), ref: c(ref), once: c(once), about: c(about), hard: c(hard), on: Math.round((L(once, 1.6, 2.4) - L(ref, 1.6, 2.4)) * 100) / 100,
               back: Math.round((L(once, 3.2, 3.9) - L(ref, 3.2, 3.9)) * 100) / 100, backAbout: Math.round((L(about, 3.2, 3.9) - L(ref, 3.2, 3.9)) * 100) / 100,
               ears: [window.__measure(ref, 1.6, 2.4).corr, window.__measure(once, 1.6, 2.4).corr], state: [once.a._stage === null, about.a._stage === null, about.a._spatial] };
    });
    report(sw.once <= -40 && sw.about <= -40 && Math.abs(sw.back) <= 0.1 && Math.abs(sw.backAbout) <= 0.1 && sw.state[0] && sw.state[1] && !sw.state[2],
           'SWITCH: on and off again under a steady tone leaves no step louder than -40 dBFS, nor does the switch thrown about (off while it crosses in, on, off, on, off); afterwards the tone is as it was',
           'peak above 4 kHz ' + sw.once + ' dBFS, thrown about ' + sw.about + ' dBFS (the tone ' + sw.tone + ' dBFS, untouched ' + sw.ref + ' dBFS above 4 kHz); with the stage on the tone is ' + sw.on + ' dB; afterwards ' + sw.back + ' and ' + sw.backAbout + ' dB');
    report(sw.hard > -40, 'CONTROL: switched without a crossfade, it clicks', 'peak above 4 kHz ' + sw.hard + ' dBFS');
    var ten = await job('switch ten', async function () {
      var A = window.HourglassAudio, snap;
      var sc = function () {
        snap = {};
        return window.__scene({ dur: 8.3, rate: 0, flow: 0, seed: 3, ambience: 'brook', track: true, frame: function () { return { running: true, ambient: true }; }, each: function (a, t) {
          if (window.__at(t, 0.4)) snap.before = window.__edges(a);
          if (window.__at(t, 1.0)) { snap.on = window.__edges(a); snap.onState = [a._stage.x, a._amb.baked, a._spatial]; }
          if (window.__at(t, 8)) { snap.after = window.__edges(a); snap.state = { stage: a._stage === null, jobs: a._stageJobs.length, sand: Math.round(a.gSand.gain.value * 1000) / 1000, spatial: a._spatial, rendered: Object.keys(a._ambBake).length, placed: a._amb.baked }; }
          for (var k = 0; k < 10; k++) if (window.__at(t, 0.5 + 0.7 * k)) { if (k % 2) a.setSpatial(false); else return window.__on(a); }
        } }).then(function () { return snap; });
      };
      var s1 = await sc(), orig = A.prototype._stageDown;
      // control: a stage taken down without letting go of its nodes
      A.prototype._stageDown = function (S) { var n = S.nodes; S.nodes = []; var r = orig.call(this, S); S.nodes = n; return r; };
      var s2 = await sc();
      A.prototype._stageDown = orig;
      return { ok: s1, bad: s2 };
    });
    var same = function (s) { return JSON.stringify(s.before) === JSON.stringify(s.after); };
    var st = ten.ok.state;
    report(same(ten.ok) && st.stage && st.jobs === 0 && st.sand === 1 && !st.spatial && st.rendered === 0 && !st.placed && ten.ok.on.sand === 0 && ten.ok.on.bus === ten.ok.before.bus && ten.ok.on.rumble === ten.ok.before.rumble + 2 && ten.ok.onState[0] === 2 && ten.ok.onState[1],
           'SWITCH: ten times thrown, with a brook playing, and nothing is left: as many connections as before, the same number into the bus, the Sand level, the output chain and the ambience\'s bus; no stage, no loops kept for it',
           'before ' + JSON.stringify(ten.ok.before) + ', on ' + JSON.stringify(ten.ok.on) + ', after ' + JSON.stringify(ten.ok.after) + '; ' + JSON.stringify(st));
    report(!same(ten.bad), 'CONTROL: a stage taken down without letting go of its nodes is found out', 'before ' + JSON.stringify(ten.bad.before) + ', after ' + JSON.stringify(ten.bad.after));
    var lev = await job('switch levels', async function () {
      var A = window.HourglassAudio, L = window.__level, out = {}, r = function (v) { return Math.round(v * 100) / 100; };
      var sc = function (sp, o) { return window.__scene(Object.assign({ dur: 7, rate: 60, spatial: sp, seed: 9, frame: function () { return { bottom: 2400, slides: 3000 }; } }, o)); };
      var vol = function (a, t) { if (window.__at(t, 2)) a.setVolume(0.4); }, sand = function (a, t) { if (window.__at(t, 2)) a.setSandLevel(0.5); };
      for (var sp of [false, true]) {
        var plain = await sc(sp), v = await sc(sp, { each: vol }), s = await sc(sp, { each: sand });
        out[sp ? 'on' : 'off'] = { vol: r(L(v, 3, 7) - L(plain, 3, 7)), sand: r(L(s, 3, 7) - L(plain, 3, 7)), plain: L(plain, 3, 7) };
      }
      // the Sand level set with the stage on, then the switch off: the sand keeps it
      var so = await sc(true, { each: function (a, t) { sand(a, t); if (window.__at(t, 3)) a.setSpatial(false); } });
      out.kept = r(L(so, 4.5, 7) - out.off.plain);
      // control: a Sand level that moves only the gain the sand used to pass
      var old = A.prototype.setSandLevel;
      A.prototype.setSandLevel = function (x) { this.sandLevel = Math.max(0, Math.min(1, +x || 0)); this.gSand.gain.setTargetAtTime(this._sandGain(), this.ctx.currentTime, 0.05); };
      var c = await sc(true, { each: sand });
      A.prototype.setSandLevel = old;
      out.control = r(L(c, 3, 7) - out.on.plain);
      // another character chosen with the stage on, against a glass that began with it
      var m = function (o) { return window.__measure(o, 3.5, 7); };
      var toWarm = function (a, t) { if (window.__at(t, 1.5)) a.setCharacter('warm'); };
      var chg = m(await sc(true, { each: toWarm })), warm = m(await sc(true, { character: 'warm' })), tone = A.prototype._stageTone;
      A.prototype._stageTone = function (tau) { if (!tau) tone.call(this, tau); };      // control: the stage's correction stays the first character's
      var stale = m(await sc(true, { each: toWarm }));
      A.prototype._stageTone = tone;
      var far = function (x) { return { level: r(x.rms - warm.rms), octaves: x.bands.map(function (b, i) { return r(b - warm.bands[i]); }) }; };
      out.chr = far(chg); out.stale = far(stale);
      // Sound in silent mode: the page's audio session, stubbed
      var types = [];
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { set type(x) { types.push(x); }, get type() { return types[types.length - 1]; } } });
      var ring = function (a, t) { if (window.__at(t, 2)) a.setSilentRing(false); if (window.__at(t, 3)) a.setSilentRing(true); };
      var q = await sc(true, { each: ring });
      out.silent = { types: types.slice(), level: r(L(q, 3, 7) - out.on.plain) };
      types.length = 0;
      var sess = A.prototype._session;
      A.prototype._session = function () {};
      await sc(true, { each: ring });
      A.prototype._session = sess;
      out.silentControl = types.slice();
      delete navigator.audioSession;
      return out;
    });
    report(Math.abs(lev.on.vol - lev.off.vol) <= 0.5 && Math.abs(lev.on.sand - lev.off.sand) <= 0.5 && lev.off.vol < -8 && lev.off.sand < -7 && Math.abs(lev.kept - lev.off.sand) <= 1,
           'SWITCH: with the stage on, the Sound volume (80 to 40) and the Sand level (100 to 50) take the sand down as they do without it, within 0.5 dB; and the Sand level set with the stage on is the sand\'s when it is switched off',
           'the volume ' + lev.on.vol + ' dB (without the stage ' + lev.off.vol + '), the Sand level ' + lev.on.sand + ' dB (' + lev.off.sand + '); after the switch off ' + lev.kept + ' dB');
    report(Math.abs(lev.control - lev.off.sand) > 0.5, 'CONTROL: a Sand level that moves only the gain the sand used to pass does nothing with the stage on', lev.control + ' dB');
    var chrOk = function (c) { return Math.abs(c.level) <= 1 && c.octaves.every(function (v) { return Math.abs(v) <= 1.5; }); };
    report(chrOk(lev.chr), 'SWITCH: another character chosen with the stage on sounds as a glass that began with it: within 1 dB, each octave 250 Hz-8 kHz within 1.5 dB',
           'level ' + lev.chr.level + ' dB, octaves ' + lev.chr.octaves.join(' '));
    report(!chrOk(lev.stale), 'CONTROL: a stage whose correction stays the first character\'s does not', 'level ' + lev.stale.level + ' dB, octaves ' + lev.stale.octaves.join(' '));
    report(lev.silent.types.join(',') === 'ambient,playback' && Math.abs(lev.silent.level) <= 0.1,
           'SWITCH: Sound in silent mode with the stage on: the page\'s audio session is \'ambient\' when it is switched off and \'playback\' when on, and the sound is not touched',
           'the session: ' + lev.silent.types.join(', ') + '; the level ' + lev.silent.level + ' dB');
    report(lev.silentControl.length === 0, 'CONTROL: an engine that leaves the session alone is found out', 'the session: ' + (lev.silentControl.join(', ') || 'never set'));

    }
    if (want('hidden')) {
    /* ---- HIDDEN: the hold of a hidden page, and the switch thrown under it ------------------ */
    var hid = await job('hidden', async function () {
      var L = window.__level, r = function (v) { return Math.round(v * 100) / 100; };
      var held = function (a, t) { if (window.__at(t, 2)) a.hold(60, 1); };
      var sc = function (sp, each) {
        return window.__scene({ dur: 9, rate: 60, spatial: sp, seed: 9, frame: function () { return { bottom: 2400 }; }, skip: function (t) { return t >= 2; }, each: each });
      };
      var off = await sc(false, held), on = await sc(true, held), none = await sc(true, function () {});
      var tOn = await sc(false, function (a, t) { held(a, t); if (window.__at(t, 3)) return window.__on(a); });
      var tOff = await sc(true, function (a, t) { held(a, t); if (window.__at(t, 3)) a.setSpatial(false); });
      return { off: L(off, 5, 8.8), on: r(L(on, 5, 8.8) - L(off, 5, 8.8)), none: r(L(none, 5, 8.8) - L(off, 5, 8.8)), before: r(L(on, 1, 2) - L(off, 1, 2)),
               tOn: r(L(tOn, 5, 8.8) - L(on, 5, 8.8)), tOff: r(L(tOff, 5, 8.8) - L(off, 5, 8.8)), state: [tOn.a._spatial, tOff.a._spatial],
               corr: [window.__measure(off, 5, 8.8).corr, window.__measure(on, 5, 8.8).corr, window.__measure(tOn, 5, 8.8).corr, window.__measure(tOff, 5, 8.8).corr] };
    });
    report(Math.abs(hid.on) <= 1.5 && hid.off > -60, 'HIDDEN: held (hold(), then no update() for 7 s) the glass keeps sounding with the stage on, within 1.5 dB of the same hold without it',
           hid.on + ' dB against ' + hid.off + ' dBFS without the stage (before the hold ' + hid.before + ' dB)');
    report(hid.none < -10, 'CONTROL: hidden with no hold(), it falls silent', hid.none + ' dB');
    report(Math.abs(hid.tOn) <= 1.5 && Math.abs(hid.tOff) <= 1.5 && hid.state[0] && !hid.state[1],
           'HIDDEN: the switch thrown under the hold does no harm: switched on, the held glass sounds as one that was on (within 1.5 dB), switched off as one that was off',
           'on: ' + hid.tOn + ' dB, off: ' + hid.tOff + ' dB; the ears correlate ' + hid.corr.join(', ') + ' (off, on, switched on, switched off)');

    }
    if (want('pose')) {
    /* ---- POSE: the phone laid flat ------------------------------------------------------- */
    var pose = await job('pose', async function () {
      var L = window.__level, seen = {};
      // the share of the bars' gains that goes to the ring's lower row
      var low = function (a) {
        var S = a._stage, R = window.HourglassAudio._stage.STAGE.ring, lo = 0, all = 0;
        for (var k in S.bars) [S.bars[k].L, S.bars[k].R].forEach(function (e) { e.g.forEach(function (n, j) { var v = n.gain.value; all += v * v; if (j < R.length && R[j][1] < 0) lo += v * v; }); });
        return Math.round(1000 * lo / all) / 1000;
      };
      var sc = function (p) {
        seen[p] = [];
        return window.__scene({ dur: 5, rate: 60, spatial: true, seed: 9, frame: function (t) { return { bottom: 2400, pose: t >= 1 ? p : 0 }; },
                                each: function (a, t) { [0.9, 1.7, 3.5].forEach(function (x) { if (window.__at(t, x)) seen[p].push(low(a)); }); } });
      };
      var flat = await sc(1);
      await sc(-1); await sc(0.5);
      return { seen: seen, level: Math.round((L(flat, 3, 5) - L(flat, 0.4, 1)) * 100) / 100 };
    });
    var lower = function (s) { return Math.abs(s[1] - s[0]) < 0.01 && s[2] > s[0] + 0.15; };
    report(lower(pose.seen['1']) && lower(pose.seen['-1']) && Math.abs(pose.level) <= 1.5,
           'POSE: the phone laid on its back, or on its face, for over a second, the glass lies lower: more of every bar goes to the ring\'s lower row; before the second is up nothing has moved; the level stays within 1.5 dB',
           'the lower row\'s share before, 0.7 s after and 2.5 s after: on its back ' + pose.seen['1'].join(' ') + ', on its face ' + pose.seen['-1'].join(' ') + '; the level ' + pose.level + ' dB');
    report(!lower(pose.seen['0.5']), 'CONTROL: half way down (not flat), nothing moves', pose.seen['0.5'].join(' '));

    }
    if (want('start')) {
    /* ---- START: the sound's coming in at a start (an engine with begin()), with the stage on --- */
    var hasBegin = await page.evaluate(function () { return typeof window.HourglassAudio.prototype.begin === 'function'; });
    if (!hasBegin) report(null, 'START: this engine has no begin() (the sound coming in gently at a start): nothing to hold here until it has one');
    else {
      var stt = await job('start', async function () {
        var L = window.__level, r = function (v) { return Math.round(v * 100) / 100; };
        var W = [[3.2, 4], [5.5, 6.5], [8, 9], [11.5, 12.5]], S = [[0.3, 0.7], [0.8, 1.2], [1.4, 1.8], [2.5, 3.5]];
        var at = function (o, wins) { return wins.map(function (w) { return L(o, w[0], w[1]); }); };
        var began = function (a) { a.begin(600, false); };
        var water = function (sp, o) {
          return window.__scene(Object.assign({ dur: 13, rate: 0, flow: 0, spatial: sp, seed: 7, ambience: 'brook', setup: began, frame: function () { return { running: true, ambient: true }; } }, o));
        };
        var sand = function (sp, o) {
          return window.__scene(Object.assign({ dur: 4, rate: 60, spatial: sp, seed: 9, setup: began, frame: function () { return { bottom: 2400, running: true, ambient: true }; } }, o));
        };
        var fine = function (o) { var x = []; for (var t = 4.5; t < 6.49; t += 0.25) x.push(L(o, t, t + 0.25)); return x; };
        var w0 = await water(false), w1 = await water(true);
        var wt = await water(false, { each: function (a, t) { if (window.__at(t, 5)) return window.__on(a); } });
        var wc = await water(true, { tweak: function (a) { a._amb.g.disconnect(); a._amb.g.connect(a.comp); } });      // control: the placed water round its bus, and its rise
        var s0 = await sand(false), s1 = await sand(true);
        var st = await sand(false, { each: function (a, t) { if (window.__at(t, 0.8)) return window.__on(a); } });
        var sc = await sand(true, { setup: function (a) { a.begin(600, false); a._sandIn = null; } });                   // control: the sand with no rise
        var d = function (x, y) { return x.map(function (v, i) { return r(v - y[i]); }); };
        return { water: { off: at(w0, W), on: d(at(w1, W), at(w0, W)), thrown: d(at(wt, W), at(w0, W)), fine: d(fine(wt), fine(w0)), control: d(at(wc, W), at(w0, W)) },
                 sand: { off: at(s0, S), on: d(at(s1, S), at(s0, S)), thrown: d(at(st, S), at(s0, S)), control: d(at(sc, S), at(s0, S)) } };
      });
      var within = function (x, lim, from) { return x.slice(from || 0).every(function (v) { return Math.abs(v) <= lim; }); };
      report(stt.water.off[0] < stt.water.off[3] - 20 && within(stt.water.on, 1) && within(stt.water.thrown, 1, 1) && within(stt.water.fine, 1.5),
             'START: the water\'s rise after a start is the same with the stage on (within 1 dB at four moments of it), and the switch thrown in the middle of the rise does not jump it (within 1.5 dB by the quarter second round the crossing, within 1 dB after)',
             'the brook without the stage ' + stt.water.off.join(', ') + ' dBFS at 3.6, 6, 8.5 and 12 s; with it ' + stt.water.on.join(', ') + ' dB; switched on at 5 s ' + stt.water.thrown.join(', ') + ' dB, by the quarter second from 4.5 s ' + stt.water.fine.join(' '));
      report(!within(stt.water.control, 1), 'CONTROL: placed water that goes round its bus has no rise', stt.water.control.join(', ') + ' dB');
      report(stt.sand.off[0] < stt.sand.off[3] - 3 && within(stt.sand.on, 1.5) && within(stt.sand.thrown, 1.5, 2),
             'START: the sand\'s rise is the same with the stage on (within 1.5 dB at four moments of it), also with the switch thrown in the middle of it',
             'the sand without the stage ' + stt.sand.off.join(', ') + ' dBFS at 0.5, 1, 1.6 and 3 s; with it ' + stt.sand.on.join(', ') + ' dB; switched on at 0.8 s ' + stt.sand.thrown.join(', ') + ' dB');
      report(!within(stt.sand.control, 1.5), 'CONTROL: a start with no rise for the sand is found out', stt.sand.control.join(', ') + ' dB');
    }

    }
    if (want('cost')) {
    /* ---- COST: a running glass with the stage on, against the same render without it -------- */
    var cost = await job('cost', async function () {
      var A = window.HourglassAudio, W = A._stage.STAGE.water;
      var run = function (sp, amb, o) {
        return window.__scene(Object.assign({ dur: 10, rate: 60, spatial: sp, seed: 9, ambience: amb, frame: function () { return { bottom: 2400, slides: 3000, ambient: !!amb }; } }, o)).then(function (r) { return r.ms; });
      };
      var med = function (x) { return x.slice().sort(function (a, b) { return a - b; })[x.length >> 1]; };
      var pair = async function (amb, o) {
        var off = [], on = [];
        for (var i = 0; i < 5; i++) {
          if (i % 2) { on.push(await run(true, amb, o)); off.push(await run(false, amb)); }
          else { off.push(await run(false, amb)); on.push(await run(true, amb, o)); }
        }
        return { off: Math.round(med(off)), on: Math.round(med(on)), ratio: Math.round(100 * med(on) / med(off)) / 100 };
      };
      await run(true, 'brook');
      var glass = await pair(null), water = await pair('brook');
      // control: the levers taken out again: the water as it was made, live through four speakers of its own (behind: later,
      // darker, turned), and the bowl's place never leaving the mix
      var undone = await pair('brook', { tweak: function (a) {
        var ctx = a.ctx, sp = ctx.createChannelSplitter(2);
        a._ambSwap(false, ctx.currentTime, 0.01);
        a.ambEnd.disconnect(a.comp); a.ambEnd.connect(sp);
        [[W.front[0], 0, 0], [W.front[1], 1, 0], [W.rear[0], 0, 1], [W.rear[1], 1, 1]].forEach(function (d) {
          var p = ctx.createPanner(), r = d[0][0] * Math.PI / 180, at = sp;
          p.panningModel = 'HRTF'; p.rolloffFactor = 0; p.channelCount = 1; p.channelCountMode = 'explicit';
          p.positionX.value = Math.sin(r); p.positionZ.value = -Math.cos(r);
          if (d[2]) {
            var dl = ctx.createDelay(0.1), g = ctx.createGain();
            dl.delayTime.value = W.late[d[1]]; g.gain.value = W.back;
            sp.connect(dl, d[1]); at = dl;
            [['lowpass', W.dark]].concat(W.turn[d[1]].map(function (f) { return ['allpass', f]; })).forEach(function (f) { var b = ctx.createBiquadFilter(); b.type = f[0]; b.frequency.value = f[1]; b.Q.value = 0.7; at.connect(b); at = b; });
            at.connect(g); g.connect(p);
          } else sp.connect(p, d[1]);
          p.connect(a.comp);
        });
        a._stageBowl(1e9);
      } });
      return { glass: glass, water: water, undone: undone };
    }, null, 600000);
    var cl = function (c) { return c.off + ' ms without, ' + c.on + ' ms with: ' + c.ratio + ' times'; };
    report(cost.glass.ratio <= 1.4 && cost.water.ratio <= 1.4, 'COST: 10 s of a running glass (60 grains a second) render with the stage on in at most 1.4 times the time without it, alone and with a brook (medians of five, taken in turn)',
           'the glass: ' + cl(cost.glass) + '; with a brook: ' + cl(cost.water));
    report(cost.undone.ratio > cost.water.ratio + 0.04, 'CONTROL: the water played live through four speakers of its own, and the bowl\'s place never leaving the mix, costs more', cl(cost.undone));

    }
    if (PRINT) lines.forEach(function (l) { console.log('INFO ' + l); });
    if (PRINT && Object.keys(cal).length) console.log('CAL ' + JSON.stringify({ res: cal }));
    report(null, 'renders ' + renders + ', of which hung ' + hangs);
  } catch (e) {
    report(false, 'the suite ran', String(e && e.stack || e).split('\n').slice(0, 4).join(' '));
  } finally {
    await Promise.race([browser.close(), new Promise(function (r) { setTimeout(r, 10000); })]);
    server.close();
  }
  console.log('\n' + (cases - failures) + '/' + cases + ' passed' + (hangs ? ', ' + hangs + ' render(s) hung and were done again' : ''));
  process.exit(failures ? 1 : 0);
}
main();
