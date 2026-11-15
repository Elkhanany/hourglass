/*!
 * Hourglass — audio.js
 * ---------------------------------------------------------------------------
 * Procedural, physically-informed ASMR sound of an hourglass.
 * 100 % Web Audio API — every sample is synthesised at start-up or in real
 * time. No audio files, no libraries.
 *
 *   Layer 1  Glass cavity      parallel bank of narrow resonators whose pitch
 *                              rises as the lower bulb fills with sand
 *   Layer 2  Neck whisper      shaped pink/brown noise, flow-rate + LFO driven
 *   Layer 3  Grain impacts     0.8–3 ms micro-impulses fired by physics events
 *                              (bare-glass "tink" ⇄ sand-on-sand "patter")
 *   Layer 4  Foley             pour rush, flip thud + sweep, end-of-timer bowl
 *
 *   → micro-room convolution → compressor → soft clipper → master
 *
 * License: GPL-3.0.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var AC = root.AudioContext || root.webkitAudioContext;
  var TAU = Math.PI * 2;

  /* ======================================================================
   *  Acoustic characters
   * ==================================================================== */
  // Vessel modes: [Hz, Q, gain, upward shift when the cavity is full]
  var MODES = [                         // thin blown glass
    [680, 24, 1.00, 0.16],
    [1420, 28, 0.85, 0.13],
    [2350, 32, 0.70, 0.09],
    [3800, 30, 0.52, 0.05],
    [5450, 26, 0.34, 0.03],
    [7250, 22, 0.20, 0.02]
  ];
  var MODES_CHIME = [                   // D major pentatonic: every grain rings a small bell
    [587.3, 70, 1.00, 0.004],
    [880.0, 78, 0.95, 0.004],
    [1174.7, 84, 0.85, 0.004],
    [1480.0, 88, 0.70, 0.004],
    [1760.0, 90, 0.60, 0.004],
    [2637.0, 90, 0.36, 0.004]
  ];
  var MODES_BAMBOO = [                  // a hollow cane: broad, woody, quickly damped
    [430, 9, 1.00, 0.05],
    [770, 10, 0.90, 0.05],
    [1190, 11, 0.70, 0.04],
    [1680, 9, 0.50, 0.03],
    [2350, 8, 0.32, 0.02],
    [3150, 6, 0.18, 0.02]
  ];
  var MODES_DUNE = [                    // the low hum of sand sliding down a dune
    [150, 14, 1.00, 0.03],
    [225, 16, 0.85, 0.03],
    [338, 16, 0.65, 0.03],
    [505, 14, 0.45, 0.02],
    [760, 12, 0.30, 0.02],
    [1140, 10, 0.18, 0.02]
  ];

  /*
   * Acoustic characters. Layer levels, tone, and how the vessel itself is
   * voiced: `modes` its resonances, `send` how much of the whisper excites
   * them, `tick` the pitch of each grain impact, `band` the centre of the
   * whisper, `body` the weight underneath it.
   */
  var CHARACTERS = {
    asmr: {
      name: 'Close-Miked ASMR',
      whisper: 0.135, ticks: 0.19, beds: 0.21, modal: 0.15, room: 0.16,
      low: 0, high: 2, lp: 13500
    },
    warm: {
      name: 'Warm Glass',
      whisper: 0.125, ticks: 0.12, beds: 0.16, modal: 0.22, room: 0.30,
      low: 3, high: -6, lp: 8200
    },
    pure: {
      name: 'Pure Sand Whisper',
      whisper: 0.21, ticks: 0.03, beds: 0.085, modal: 0.045, room: 0.12,
      low: -1, high: 0, lp: 11500
    },
    chime: {
      name: 'Singing Glass',
      whisper: 0.10, ticks: 0.17, beds: 0.12, modal: 0.30, room: 0.36,
      low: 0, high: 0, lp: 11000,
      modes: MODES_CHIME, send: 0.10, tick: 1.0, band: 1.0, body: 0.30
    },
    bamboo: {
      name: 'Bamboo Rainstick',
      whisper: 0.06, ticks: 0.20, beds: 0.21, modal: 0.34, room: 0.22,
      low: 2, high: -4, lp: 8500,
      modes: MODES_BAMBOO, send: 0.30, tick: 0.58, band: 0.8, body: 0.55
    },
    dune: {
      name: 'Desert Dune',
      whisper: 0.15, ticks: 0.07, beds: 0.14, modal: 0.46, room: 0.26,
      low: 5, high: -9, lp: 5200,
      modes: MODES_DUNE, send: 0.9, tick: 0.5, band: 0.52, body: 1.0
    }
  };

  /* ======================================================================
   *  Buffer synthesis
   * ==================================================================== */

  function rnd() { return Math.random(); }

  // The heavy source material is synthesised at a fixed rate *before* any
  // AudioContext exists (in idle slices after page load), so the first tap
  // only has to wrap arrays into AudioBuffers. The context resamples them.
  var PRE_SR = 48000;

  /** One channel of seamlessly looping noise. kind: 'pink' | 'brown'. */
  function rawNoise(sr, seconds, kind) {
    var n = Math.floor(sr * seconds), fade = Math.floor(sr * 0.08);
    var raw = new Float32Array(n + fade), out = new Float32Array(n), i, w;
    if (kind === 'pink') {
      // Paul Kellet's refined pink filter (−3 dB / octave)
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (i = 0; i < raw.length; i++) {
        w = rnd() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      // brown: leaky integrator (−6 dB / octave)
      var last = 0;
      for (i = 0; i < raw.length; i++) {
        w = rnd() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last * 3.5;
      }
    }
    // equal-power crossfade of the tail into the head → click-free loop
    for (i = 0; i < n; i++) out[i] = raw[i];
    for (i = 0; i < fade; i++) {
      var a = i / fade;
      out[i] = raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
    }
    return out;
  }

  function normalize(a, peak) {
    var m = 0, i;
    for (i = 0; i < a.length; i++) { var v = a[i] < 0 ? -a[i] : a[i]; if (v > m) m = v; }
    if (m > 0) { m = peak / m; for (i = 0; i < a.length; i++) a[i] *= m; }
    return a;
  }

  /** Grain on bare glass: a crisp, crystalline damped partial pair. */
  function synthTink(sr) {
    var f = 4500 + rnd() * 2500;
    var f2 = f * (1.45 + rnd() * 0.5);
    var tau = 0.00055 + rnd() * 0.0009;
    var n = Math.ceil(sr * tau * 7);
    var a = new Float32Array(n), ph = rnd() * TAU;
    var atk = Math.max(2, Math.round(sr * 0.00012));
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      var env = Math.exp(-t / tau) * (i < atk ? 0.5 - 0.5 * Math.cos(Math.PI * i / atk) : 1);
      a[i] = env * (Math.sin(TAU * f * t + ph) +
                    0.38 * Math.sin(TAU * f2 * t + ph * 1.7) +
                    0.5 * (rnd() * 2 - 1) * Math.exp(-t / 0.00025));
    }
    return normalize(a, 1);
  }

  /** Grain on sand: a dry, band-limited puff (no ring). */
  function synthPat(sr) {
    var fc = 1800 + rnd() * 1700, Q = 1.1 + rnd() * 0.8;
    var tau = 0.00045 + rnd() * 0.0007;
    var n = Math.ceil(sr * (tau * 6 + 0.0008));
    var a = new Float32Array(n);
    var w0 = TAU * fc / sr, alpha = Math.sin(w0) / (2 * Q);
    var b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    var atk = Math.max(3, Math.round(sr * 0.00016));
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      var env = Math.exp(-t / tau) * (i < atk ? 0.5 - 0.5 * Math.cos(Math.PI * i / atk) : 1);
      var x = (rnd() * 2 - 1) * env;
      var y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      a[i] = y;
    }
    // close the tail
    for (i = Math.floor(n * 0.7); i < n; i++) a[i] *= (n - i) / (n * 0.3);
    return normalize(a, 1);
  }

  /** Wrap raw channel data (synthesised at `sr`) into an AudioBuffer. */
  function toBuffer(ctx, channels, sr) {
    var b = ctx.createBuffer(channels.length, channels[0].length, sr);
    for (var c = 0; c < channels.length; c++) b.getChannelData(c).set(channels[c]);
    return b;
  }

  /**
   * One channel of a looping Poisson texture of micro-impacts: what
   * thousands of grains per minute sound like once they are too dense to
   * schedule one by one.
   */
  function rawBed(sr, seconds, bank, rate) {
    var n = Math.floor(sr * seconds), out = new Float32Array(n), t = 0;
    for (;;) {
      t += -Math.log(1 - rnd()) / rate;                   // exponential gaps
      if (t >= seconds) break;
      var g = bank[(rnd() * bank.length) | 0];
      var amp = Math.min(1, -Math.log(1 - rnd()) * 0.36) * 0.5;
      var step = 0.8 + rnd() * 0.45;                      // pitch scatter
      var start = Math.floor(t * sr);
      var len = Math.floor(g.length / step);
      for (var i = 0; i < len; i++) {
        out[(start + i) % n] += g[(i * step) | 0] * amp;  // wraps → seamless
      }
    }
    return out;
  }

  /**
   * 0.35 s "wooden desk" micro-room: a handful of early reflections and a
   * short diffuse tail that darkens as it decays. Generated, not sampled.
   */
  function makeRoomIR(ctx) {
    var sr = ctx.sampleRate, n = Math.floor(sr * 0.35);
    var buf = ctx.createBuffer(2, n, sr);
    var taps = [0.0031, 0.0057, 0.0089, 0.0133, 0.0179, 0.0235, 0.0302];
    var gains = [0.62, -0.46, 0.40, -0.31, 0.26, 0.20, -0.15];
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0, i, e = 0;
      for (i = 0; i < n; i++) {
        var t = i / sr;
        var env = Math.exp(-t / 0.052) * Math.min(1, t / 0.004);
        // one-pole low-pass whose corner slides from ~9 kHz to ~1.4 kHz
        var fc = 1400 + 7600 * Math.exp(-t / 0.07);
        var k = 1 - Math.exp(-TAU * fc / sr);
        lp += k * ((rnd() * 2 - 1) - lp);
        d[i] = lp * env * 0.6;
      }
      for (var j = 0; j < taps.length; j++) {
        var pos = Math.floor((taps[j] * (ch ? 1.07 : 1) + (ch ? 0.0004 : 0)) * sr);
        for (i = 0; i < 6 && pos + i < n; i++) d[pos + i] += gains[j] * (1 - i / 6);
      }
      for (i = 0; i < n; i++) e += d[i] * d[i];
      e = 1 / Math.sqrt(e);
      for (i = 0; i < n; i++) d[i] *= e;
      for (i = n - 256; i < n; i++) d[i] *= (n - i) / 256;
    }
    return buf;
  }

  /* ----------------------------------------------------------------------
   *  Ambiences — an optional second layer behind the sand
   * -------------------------------------------------------------------- */

  var SINE = new Float32Array(4096);
  for (var si = 0; si < 4096; si++) SINE[si] = Math.sin(si / 4096 * TAU);

  /** Scale a channel to a target RMS, keeping the peak under 0.95. */
  function level(out, rms) {
    var s = 0, pk = 0, i, v;
    for (i = 0; i < out.length; i++) { v = out[i]; s += v * v; if (v < 0) v = -v; if (v > pk) pk = v; }
    s = Math.sqrt(s / out.length);
    var g = s > 0 ? rms / s : 1;
    if (pk * g > 0.95) g = 0.95 / pk;
    for (i = 0; i < out.length; i++) out[i] *= g;
    return out;
  }

  /** Looping band-limited noise with a slow swell (one channel). */
  function rawWash(sr, seconds, loHz, hiHz) {
    var n = Math.floor(sr * seconds), fade = Math.floor(sr * 0.3);
    var raw = new Float32Array(n + fade), out = new Float32Array(n), i;
    var kl = 1 - Math.exp(-TAU * hiHz / sr), kh = 1 - Math.exp(-TAU * loHz / sr);
    var l1 = 0, l2 = 0, h = 0, p1 = rnd() * TAU, p2 = rnd() * TAU;
    for (i = 0; i < raw.length; i++) {
      var t = i / sr;
      l1 += kl * ((rnd() * 2 - 1) - l1); l2 += kl * (l1 - l2);     // two-pole low-pass
      h += kh * (l2 - h);                                          // …minus its own lows
      raw[i] = (l2 - h) * (0.66 + 0.2 * Math.sin(t * 1.3 + p1 + 2 * Math.sin(t * 0.31)) + 0.12 * Math.sin(t * 3.7 + p2));
    }
    for (i = 0; i < n; i++) out[i] = raw[i];
    for (i = 0; i < fade; i++) {
      var a = i / fade;
      out[i] = raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
    }
    return out;
  }

  /* ---- running water ---------------------------------------------------
   * A brook is mostly the sound of air. Every bubble the current traps rings
   * at a pitch set by its size (Minnaert: ≈ 3.3 kHz·mm / radius) and dies in
   * a few milliseconds, so thousands a second blur into the sound of
   * running water: the fizz of tiny bubbles and splashes above 2.4 kHz, the
   * babble of middling ones, now and then a big, low bloop, all over the
   * diffuse rush of the current itself.
   *
   * The proportions come from six field recordings of small streams,
   * measured band by band: spectrum, how bursty and how tonal each band is,
   * how it flickers and swells, how alike the two ears are. Pitches barely
   * glide (real bubbles rise by a few percent, not by octaves) and no event
   * is louder than three times the median, so nothing stands out enough to
   * be noticed coming round again.
   *
   * Both ears hear the same bubbles: each channel is rendered from the same
   * seed, every event panned and the far ear delayed by up to 0.35 ms. The
   * current is part shared, part independent, for a wide but whole image.
   * ------------------------------------------------------------------- */

  /** Seeded PRNG (mulberry32), so both channels draw the same bubbles. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Roughly N(0, 1), cheaply. */
  function gauss(r) { return (r() + r() + r() + r() - 2) * 1.732; }

  /**
   * A smooth random curve of `n` control steps that loops seamlessly: zero
   * mean, unit deviation, low-passed at `fc` Hz (control rate `cr`). With
   * `hp`, its own `hp` Hz low-pass is taken away, so a quick flicker does not
   * leak into the slow swell.
   */
  function ctrlCurve(r, n, fc, cr, hp) {
    var m = Math.ceil(cr / fc * 2), raw = new Float32Array(n + m), out = new Float32Array(n), i;
    var k = 1 - Math.exp(-TAU * fc / cr), a = 0, b = 0, warm = Math.ceil(cr / Math.min(fc, hp || fc) * 4);
    var kh = hp ? 1 - Math.exp(-TAU * hp / cr) : 0, c = 0, e = 0;
    for (i = -warm; i < n + m; i++) {
      a += k * (gauss(r) - a); b += k * (a - b);
      if (hp) { c += kh * (b - c); e += kh * (c - e); }
      if (i >= 0) raw[i] = b - e;
    }
    for (i = 0; i < n; i++) out[i] = raw[i];
    for (i = 0; i < m; i++) { var x = i / m; out[i] = raw[i] * Math.sqrt(x) + raw[n + i] * Math.sqrt(1 - x); }
    var mu = 0, s = 0;
    for (i = 0; i < n; i++) mu += out[i];
    mu /= n;
    for (i = 0; i < n; i++) { out[i] -= mu; s += out[i] * out[i]; }
    s = Math.sqrt(s / n) || 1;
    for (i = 0; i < n; i++) out[i] /= s;
    return out;
  }

  var WATER = {
    cr: 200,                                  // control rate of the curves, Hz
    swell: 0.06,                              // slow swell of the whole flow (log-amplitude σ, ≈ ±0.5 dB)
    itd: 0.35e-3,                             // the far ear hears a hard-panned bubble this much later
    cap: 3,                                   // no bubble louder than 3× the median
    // the current: noise band-passed and flickering (σ of a log-normal gain
    // band-passed to fhp…fc Hz); `rho` of the noise and `rhoEnv` of the flicker
    // are shared between the ears; `gain` is its RMS beside the bubbles' amplitudes
    bed: { gain: 0.081, lp: 2400, hp: 300, fc: 18, fhp: 3, sigma: 0.28, rho: 0.35, rhoEnv: 0.5 },
    body: { gain: 0.031, lp: 500, hp: 110, fc: 8, fhp: 2, sigma: 0.40, rho: 0.5, rhoEnv: 0.6 },
    // bubbles: rate /s, pitch range (skew < 1 leans high), median amplitude,
    // its log-normal σ and tilt with pitch, damping × Minnaert's, pitch glide
    // ξ0…ξ1 per decay time, the rhythm of the rate (σ of a log-normal
    // band-passed to rhp…rfc Hz), and how wide they are panned
    fizz: { rate: 280, f0: 2400, f1: 9000, skew: 1.0, amp: 0.16, sigma: 1.3, tilt: -0.35,
            damp: 3.0, xi0: 0, xi1: 0.08, rfc: 14, rhp: 3, rsigma: 0.6, pan: 0.9 },
    babble: { rate: 170, f0: 750, f1: 3000, skew: 0.8, amp: 0.07, sigma: 0.8, tilt: -0.4,
              damp: 1.3, xi0: -0.02, xi1: 0.08, rfc: 5, rhp: 1.5, rsigma: 0.6, pan: 0.8 },
    bloop: { rate: 12, f0: 300, f1: 700, skew: 1.0, amp: 0.06, sigma: 0.45, tilt: -0.3,
             damp: 1.15, xi0: -0.03, xi1: 0.09, rfc: 3, rhp: 1, rsigma: 0.4, pan: 0.7 },
    // per-channel RMS of the two loops (0.080 together; the bloops carry ≈ 6 % of the power)
    rmsFlow: 0.0774, rmsBloops: 0.0202
  };

  /**
   * One channel of the current: noise into a 2-pole low-pass and a 1-pole
   * high-pass, its gain flickering on the control curves. Unit RMS.
   */
  function waterBed(sr, n, nc, B, swell, rS, rC) {
    var fade = Math.floor(sr * 0.25), raw = new Float32Array(n + fade), out = new Float32Array(n);
    var cr = WATER.cr, i;
    var kl = 1 - Math.exp(-TAU * B.lp / sr), kh = 1 - Math.exp(-TAU * B.hp / sr);
    var fS = ctrlCurve(rS, nc, B.fc, cr, B.fhp), fC = ctrlCurve(rC, nc, B.fc, cr, B.fhp);
    var cs = Math.sqrt(B.rho), cc = Math.sqrt(1 - B.rho), es = Math.sqrt(B.rhoEnv), ec = Math.sqrt(1 - B.rhoEnv);
    // the gain curve once per control step (exp per sample is costly), then interpolated
    var G = new Float32Array(nc + 1);
    for (i = 0; i < nc; i++) G[i] = Math.exp(B.sigma * (es * fS[i] + ec * fC[i]) + WATER.swell * swell[i]);
    G[nc] = G[0];
    var l1 = 0, l2 = 0, h = 0, pos = 0, step = nc / n;
    for (i = 0; i < raw.length; i++) {
      var w = cs * (rS() * 2 - 1) + cc * (rC() * 2 - 1);
      l1 += kl * (w - l1); l2 += kl * (l1 - l2);
      h += kh * (l2 - h);
      var c0 = pos | 0;
      raw[i] = (l2 - h) * (G[c0] + (G[c0 + 1] - G[c0]) * (pos - c0));
      pos += step; if (pos >= nc) pos -= nc;
    }
    for (i = 0; i < n; i++) out[i] = raw[i];
    for (i = 0; i < fade; i++) {                     // equal-power crossfade → seamless loop
      var a = i / fade;
      out[i] = raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
    }
    var s = 0;
    for (i = 0; i < n; i++) s += out[i] * out[i];
    s = Math.sqrt(s / n) || 1;
    for (i = 0; i < n; i++) out[i] /= s;
    return out;
  }

  /** Add one class of bubbles to a channel: shared events, this ear's pan and delay. */
  function waterBubbles(out, sr, seconds, nc, C, swell, rE, ch) {
    var n = out.length, cr = WATER.cr, tab = SINE, itd = WATER.itd * sr;
    var rate = ctrlCurve(rE, nc, C.rfc, cr, C.rhp);
    // a Poisson stream whose rate swings log-normally: thin a faster one
    var mMax = Math.exp(C.rsigma * 2.5), lam = C.rate * mMax, lr = Math.log(C.f1 / C.f0), t = 0;
    for (;;) {
      t += -Math.log(1 - rE()) / lam;
      if (t >= seconds) break;
      var c = Math.min(nc - 1, (t / seconds * nc) | 0);
      var keep = Math.exp(C.rsigma * rate[c] - C.rsigma * C.rsigma * 0.5) / mMax;
      var u = rE(), uf = rE(), ua = gauss(rE), ux = rE(), up = rE();   // drawn alike in both ears
      if (u > keep) continue;
      var f0 = C.f0 * Math.exp(lr * Math.pow(uf, C.skew));
      var amp = C.amp * Math.min(WATER.cap, Math.exp(C.sigma * ua)) * Math.pow(f0 / 1000, C.tilt) *
                Math.exp(WATER.swell * swell[c]);
      var d = C.damp * (0.043 * f0 + 0.0014 * f0 * Math.sqrt(f0));      // damping, 1/s
      var xi = C.xi0 + (C.xi1 - C.xi0) * ux;
      var p = (up * 2 - 1) * C.pan, ang = (p + 1) * Math.PI / 4;
      var env = amp * 1.414 * (ch ? Math.sin(ang) : Math.cos(ang)), dec = Math.exp(-d / sr);
      var delay = Math.round(itd * (ch ? Math.max(0, -p) : Math.max(0, p)));   // far ear later
      // phase in table steps; the pitch glides by ξ per decay time
      var ph = rE() * 4096, dph = 4096 * f0 / sr, rise = 4096 * f0 * xi * d / (sr * sr);
      var len = Math.min(n, Math.ceil(sr * 4.6 / d)), j = (Math.floor(t * sr) + delay) % n;
      for (var k = 0; k < len; k++) {
        out[j] += env * tab[ph & 4095] * (k < 8 ? k / 8 : 1);
        if (++j === n) j = 0;                                         // wraps → seamless
        ph += dph + rise * k; env *= dec;
      }
    }
  }

  /** One channel of the brook's flow: the current, fizz and babble. */
  function rawBrookFlow(sr, seconds, ch, seed) {
    var n = Math.floor(sr * seconds), nc = Math.round(seconds * WATER.cr), i;
    var rE = mulberry32(seed * 7919 + 13);                      // shared by both ears
    var rC = mulberry32(seed * 104729 + 31 + ch * 977);         // this ear's own
    var swell = ctrlCurve(rE, nc, 0.5, WATER.cr);
    var bed = waterBed(sr, n, nc, WATER.bed, swell, mulberry32(seed * 31 + 101), rC);
    var body = waterBed(sr, n, nc, WATER.body, swell, mulberry32(seed * 31 + 202), rC);
    var out = new Float32Array(n);
    for (i = 0; i < n; i++) out[i] = WATER.bed.gain * bed[i] + WATER.body.gain * body[i];
    waterBubbles(out, sr, seconds, nc, WATER.fizz, swell, rE, ch);
    waterBubbles(out, sr, seconds, nc, WATER.babble, swell, rE, ch);
    return level(out, WATER.rmsFlow);
  }

  /**
   * One channel of the brook's big, low bubbles. They loop on their own,
   * co-prime with the flow, so the two line up again only every ~22 min.
   */
  function rawBrookBloops(sr, seconds, ch, seed) {
    var n = Math.floor(sr * seconds), nc = Math.round(seconds * WATER.cr);
    var rE = mulberry32(seed * 7919 + 4099);
    var swell = ctrlCurve(rE, nc, 0.5, WATER.cr);
    var out = new Float32Array(n);
    waterBubbles(out, sr, seconds, nc, WATER.bloop, swell, rE, ch);
    return level(out, WATER.rmsBloops);
  }

  /** One raindrop: a tiny filtered click. */
  function synthDrop(sr, fc, Q, tau) {
    var n = Math.ceil(sr * (tau * 6 + 0.0008)), a = new Float32Array(n);
    var w0 = TAU * fc / sr, alpha = Math.sin(w0) / (2 * Q);
    var b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0, atk = Math.max(3, Math.round(sr * 0.00015));
    for (var i = 0; i < n; i++) {
      var env = Math.exp(-(i / sr) / tau) * (i < atk ? i / atk : 1);
      var x = (rnd() * 2 - 1) * env;
      var y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      a[i] = y;
    }
    for (i = Math.floor(n * 0.7); i < n; i++) a[i] *= (n - i) / (n * 0.3);
    return normalize(a, 1);
  }

  /** Soft rain: a dense patter of fine drops, a few heavy ones, a distant hiss. */
  function rawRain(sr, seconds) {
    var fine = [], heavy = [], i;
    for (i = 0; i < 18; i++) fine.push(synthDrop(sr, 1800 + rnd() * 3400, 1.2 + rnd(), 0.0003 + rnd() * 0.0004));
    for (i = 0; i < 10; i++) heavy.push(synthDrop(sr, 700 + rnd() * 1000, 1.6 + rnd() * 1.4, 0.0015 + rnd() * 0.0025));
    var out = level(rawWash(sr, seconds, 900, 5500), 0.022);
    var a = rawBed(sr, seconds, fine, 520), b = rawBed(sr, seconds, heavy, 14);
    for (i = 0; i < out.length; i++) out[i] += a[i] * 0.42 + b[i] * 0.85;
    return level(out, 0.075);
  }

  /*
   * Each ambience is one or more seamless loops, played together. `make(sr,
   * seconds, ch, seed)` renders one channel; both channels get the same seed.
   */
  var AMBIENCES = {
    none: { name: 'None' },
    brook: { name: 'Brook', layers: [
      { make: rawBrookFlow, seconds: 9.3, sr: PRE_SR },
      { make: rawBrookBloops, seconds: 14.3, sr: 24000 }       // ≤ 700 Hz: a lower rate is plenty
    ] },
    rain: { name: 'Rain', layers: [
      { make: rawRain, seconds: 7.9, sr: PRE_SR }
    ] }
  };

  function softClipCurve() {
    var n = 2048, c = new Float32Array(n), k = 1.5, norm = Math.tanh(k);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    return c;
  }

  /* ======================================================================
   *  Engine
   * ==================================================================== */

  function HourglassAudio() {
    this.ctx = null;
    this.ready = false;
    this.supported = !!AC;
    this.volume = 0.8;
    this.muted = false;
    this.character = 'asmr';
    this.chimeEnabled = true;
    this._last = {};          // last scheduled value per parameter
    this._cushion = 0;
    this._drift = 0;
    this._flutter = 0;
    this._voices = 0;
    this._silenced = false;
    this.ambience = 'none';   // optional second layer: 'none' | 'brook' | 'rain'
    this.ambLevel = 0.5;
    this._ambRaw = {};        // synthesised ambiences, by id: [L, R] per layer…
    this._ambBuf = {};        // …wrapped into AudioBuffers once there is a context
    this._ambJobs = {};       // ambiences being synthesised, by id
    this._amb = null;         // the one playing
    this._ambPreview = 0;     // audition until this context time
    this._ambUntil = 0;       // after a glass ends: flows on until this context time
    this._raw = {};           // pre-synthesised source material
    this._prepStep = 0;
    this.onstate = null;      // callback(stateString)
  }

  /* ---------------------------------------------------------------- *
   *  Source material, synthesised in small slices
   * ---------------------------------------------------------------- */
  var PREP_STEPS = [
    function (r) { r.pinkL = rawNoise(PRE_SR, 5.3, 'pink'); },
    function (r) { r.pinkR = rawNoise(PRE_SR, 5.3, 'pink'); },
    function (r) { r.brownL = rawNoise(PRE_SR, 4.1, 'brown'); r.brownR = rawNoise(PRE_SR, 4.1, 'brown'); },
    function (r) {
      r.tinks = []; r.pats = [];
      for (var i = 0; i < 14; i++) { r.tinks.push(synthTink(PRE_SR)); r.pats.push(synthPat(PRE_SR)); }
    },
    function (r) { r.patL = rawBed(PRE_SR, 3.7, r.pats, 380); r.patR = rawBed(PRE_SR, 3.7, r.pats, 380); },
    function (r) { r.tinkL = rawBed(PRE_SR, 3.1, r.tinks, 120); r.tinkR = rawBed(PRE_SR, 3.1, r.tinks, 120); }
  ];

  /**
   * Optional: call some time after load. Synthesises the noise beds a slice
   * at a time while the page is idle, so the first touch stays instant.
   */
  HourglassAudio.prototype.prepare = function () {
    var self = this;
    if (!AC || this._prepTimer || this._prepStep >= PREP_STEPS.length) return;
    (function next() {
      if (self._prepStep < PREP_STEPS.length) {
        PREP_STEPS[self._prepStep++](self._raw);
        self._prepTimer = setTimeout(next, 30);
        return;
      }
      self._prepTimer = 0;
      // then the chosen ambience, so a first touch with it saved stays instant too
      if (self.ambience !== 'none') self._synthAmbience(self.ambience);
    })();
  };
  /** Finish whatever `prepare()` has not done yet (synchronously). */
  HourglassAudio.prototype._finishPrep = function () {
    if (this._prepTimer) { clearTimeout(this._prepTimer); this._prepTimer = 0; }
    while (this._prepStep < PREP_STEPS.length) PREP_STEPS[this._prepStep++](this._raw);
  };

  HourglassAudio.CHARACTERS = CHARACTERS;
  HourglassAudio.AMBIENCES = AMBIENCES;

  /* ---------------------------------------------------------------- *
   *  Unlocking / lifecycle (iOS Safari is strict about all of this)
   * ---------------------------------------------------------------- */

  /**
   * Call from inside *every* user gesture until `isRunning()`.
   * Creates the context on first use, resumes it, and plays a silent
   * buffer — the only reliable way to unlock audio on iOS.
   */
  HourglassAudio.prototype.unlock = function () {
    if (!AC) return;
    var self = this;
    if (!this.ctx) {
      try { this.ctx = new AC({ latencyHint: 'interactive' }); }
      catch (e) { this.ctx = new AC(); }
      // Let WebKit play through the hardware mute switch like a timer should.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e2) {}
      this._build();
      this.ctx.onstatechange = function () { self._onState(); };
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) self._recover();
      });
      root.addEventListener('pageshow', function () { self._recover(); });
      root.addEventListener('focus', function () { self._recover(); });
    }
    var ctx = this.ctx;
    if (ctx.state !== 'running') {
      try {
        var p = ctx.resume();
        if (p && p.then) p.then(function () { self._onState(); }, function () {});
      } catch (e3) {}
      // one silent sample, started inside the gesture
      try {
        var s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
      } catch (e4) {}
    }
  };

  HourglassAudio.prototype.isRunning = function () {
    return !!this.ctx && this.ctx.state === 'running';
  };

  /** Try to come back after a phone call, lock screen or tab switch. */
  HourglassAudio.prototype._recover = function () {
    var ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      var p = ctx.resume();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  };

  HourglassAudio.prototype._onState = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') {
      // fade in from silence so a resume never pops
      var t = ctx.currentTime, g = this.out.gain;
      try { g.cancelScheduledValues(t); } catch (e) {}
      g.setValueAtTime(0, t);
      g.setTargetAtTime(this._masterTarget(), t + 0.01, 0.09);
      // the stream comes back with the glass, never as a leftover from before the pause
      var ab = this.ambBus.gain;
      try { ab.cancelScheduledValues(t); } catch (e1) {}
      ab.setValueAtTime(0, t);
      this._ambUntil = 0;
      this._last = {};                 // force every parameter to re-sync
    } else if (!document.hidden) {
      this._recover();                 // 'interrupted' / 'suspended'
    }
    if (this.onstate) this.onstate(ctx.state);
  };

  /* ---------------------------------------------------------------- *
   *  Graph
   * ---------------------------------------------------------------- */
  HourglassAudio.prototype._build = function () {
    var ctx = this.ctx, i;
    var G = function (v) { var g = ctx.createGain(); g.gain.value = v; return g; };
    var BQ = function (type, f, q, gain) {
      var b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f;
      if (q != null) b.Q.value = q;
      if (gain != null) b.gain.value = gain;
      return b;
    };
    var loop = function (buf, rate) {
      var s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true;
      if (rate) s.playbackRate.value = rate;
      s.start(0, rnd() * buf.duration * 0.5);
      return s;
    };
    var pan = function (p) {
      if (ctx.createStereoPanner) { var n = ctx.createStereoPanner(); n.pan.value = p; return n; }
      return G(1);
    };

    // ---- output chain ---------------------------------------------------
    this.out = G(0);
    this.clip = ctx.createWaveShaper();
    this.clip.curve = softClipCurve();
    try { this.clip.oversample = '2x'; } catch (e) {}
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -22; this.comp.knee.value = 18;
    this.comp.ratio.value = 3.5; this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.toneLow = BQ('lowshelf', 230, null, 0);
    this.toneHigh = BQ('highshelf', 6200, null, 0);
    this.toneLP = BQ('lowpass', 15000, 0.5);
    this.rumble = BQ('highpass', 55, 0.7);
    this.bus = G(1);
    this.wet = G(0.16);
    this.conv = ctx.createConvolver();
    this.conv.buffer = makeRoomIR(ctx);

    this.bus.connect(this.rumble);
    this.bus.connect(this.wet); this.wet.connect(this.conv); this.conv.connect(this.rumble);
    this.rumble.connect(this.toneLow); this.toneLow.connect(this.toneHigh);
    this.toneHigh.connect(this.toneLP); this.toneLP.connect(this.comp);
    this.comp.connect(this.clip); this.clip.connect(this.out);
    this.out.connect(ctx.destination);

    // layer faders (set by the acoustic character)
    this.gWhisper = G(0); this.gTicks = G(0); this.gBeds = G(0);
    this.gModal = G(0); this.gFoley = G(0.9); this.gChime = G(1);
    this.gWhisper.connect(this.bus); this.gTicks.connect(this.bus);
    this.gBeds.connect(this.bus); this.gModal.connect(this.bus);
    this.gFoley.connect(this.bus); this.gChime.connect(this.bus);
    this.chimeWet = G(0.55); this.gChime.connect(this.chimeWet); this.chimeWet.connect(this.conv);

    // ---- source material ------------------------------------------------
    this._finishPrep();
    var raw = this._raw;
    var pink = toBuffer(ctx, [raw.pinkL, raw.pinkR], PRE_SR);
    var brown = toBuffer(ctx, [raw.brownL, raw.brownR], PRE_SR);
    this.tinks = []; this.pats = [];
    for (i = 0; i < raw.tinks.length; i++) {
      this.tinks.push(toBuffer(ctx, [raw.tinks[i]], PRE_SR));
      this.pats.push(toBuffer(ctx, [raw.pats[i]], PRE_SR));
    }
    this.brown = brown;

    // ---- Layer 1: glass cavity (modal bank) ----------------------------
    this.modalIn = G(1);
    this.modalOut = G(2.6);
    this.modes = [];
    this.modeGains = [];
    for (i = 0; i < MODES.length; i++) {
      var bp = BQ('bandpass', MODES[i][0], MODES[i][1]);
      var mg = G(MODES[i][2]);
      this.modeGains.push(mg);
      this.modalIn.connect(bp); bp.connect(mg); mg.connect(this.modalOut);
      this.modes.push(bp);
    }
    this.modalOut.connect(this.gModal);

    // ---- Layer 2: neck whisper (silica on glass) -----------------------
    this.wHP = BQ('highpass', 1500, 0.5);
    this.wBand = BQ('peaking', 4300, 0.7, 6);
    this.wAir = BQ('highshelf', 7500, null, 1);
    this.wLP = BQ('lowpass', 9500, 0.6);
    this.wEnv = G(0);                       // follows the flow rate
    this.wLfo = G(1);                       // slow organic breathing
    loop(pink).connect(this.wHP);
    this.wHP.connect(this.wBand); this.wBand.connect(this.wAir);
    this.wAir.connect(this.wLP); this.wLP.connect(this.wEnv);
    // a little velvet underneath the hiss
    this.wBody = BQ('bandpass', 950, 0.8);
    var body = this.wBodyGain = G(0.42);
    loop(brown).connect(this.wBody); this.wBody.connect(body); body.connect(this.wEnv);
    this.wEnv.connect(this.wLfo); this.wLfo.connect(this.gWhisper);
    var sW = this.wSend = G(0.55); this.wLfo.connect(sW); sW.connect(this.modalIn);
    var lf = [[0.19, 0.085], [0.47, 0.05], [1.3, 0.02]];
    for (i = 0; i < lf.length; i++) {
      var o = ctx.createOscillator(), og = G(lf[i][1]);
      o.frequency.value = lf[i][0];
      o.connect(og); og.connect(this.wLfo.gain); o.start();
    }

    // ---- Layer 3: grain impacts -----------------------------------------
    this.tickBus = G(1);
    this.tickBus.connect(this.gTicks);
    var sT = G(1.3); this.tickBus.connect(sT); sT.connect(this.modalIn);
    // 3 pan positions × 3 loudness tiers: one node per voice, nothing else
    this.tiers = [];
    var pans = [-0.5, 0, 0.5], amps = [0.3, 0.56, 1];
    for (i = 0; i < 3; i++) {
      var pn = pan(pans[i]); pn.connect(this.tickBus);
      var row = [];
      for (var j = 0; j < 3; j++) { var tg = G(amps[j]); tg.connect(pn); row.push(tg); }
      this.tiers.push(row);
    }
    // dense-flow textures
    this.patEnv = G(0); this.tinkEnv = G(0);
    loop(toBuffer(ctx, [raw.patL, raw.patR], PRE_SR)).connect(this.patEnv);
    loop(toBuffer(ctx, [raw.tinkL, raw.tinkR], PRE_SR)).connect(this.tinkEnv);
    this.patEnv.connect(this.gBeds); this.tinkEnv.connect(this.gBeds);
    var sB = G(0.9); this.gBeds.connect(sB); sB.connect(this.modalIn);

    // ---- Layer 4: foley -------------------------------------------------
    // pour: a fuller, cascading rush
    this.pBP = BQ('bandpass', 2300, 0.7);
    this.pEnv = G(0);
    loop(pink, 0.87).connect(this.pBP); this.pBP.connect(this.pEnv);
    this.pEnv.connect(this.gFoley);
    var sP = G(0.5); this.pEnv.connect(sP); sP.connect(this.modalIn);
    // rush: thousands of grains sliding over glass (flip, avalanches)
    this.rBP = BQ('bandpass', 1500, 0.8);
    this.rEnv = G(0);
    this.rPan = pan(0);
    loop(pink, 0.62).connect(this.rBP); this.rBP.connect(this.rEnv);
    this.rEnv.connect(this.rPan); this.rPan.connect(this.gFoley);
    var sR = G(0.45); this.rEnv.connect(sR); sR.connect(this.modalIn);

    this._raw = {};                         // wrapped into AudioBuffers: free the originals
    // ---- ambience: an optional layer behind the sand ----------------------
    // It bypasses the character's tone shaping (a dune should not muffle a brook).
    this.ambBus = G(0);
    this.ambBus.connect(this.comp);
    var aW = G(0.12); this.ambBus.connect(aW); aW.connect(this.conv);

    this.ready = true;
    if (this.ambience !== 'none') this._loadAmbience(this.ambience);
    this._applyCharacter(0.01);
    this._applyMaster();
  };

  /* ---------------------------------------------------------------- *
   *  Parameter helpers — always exponential glides, never steps
   * ---------------------------------------------------------------- */
  HourglassAudio.prototype._set = function (key, param, value, tau) {
    var last = this._last[key];
    if (last !== undefined && Math.abs(last - value) <= Math.abs(value) * 0.004 + 1e-4) return;
    this._last[key] = value;
    param.setTargetAtTime(value, this.ctx.currentTime, tau);
  };

  HourglassAudio.prototype._masterTarget = function () {
    if (this.muted || this._silenced) return 0;
    return Math.pow(this.volume, 1.7) * 0.8;
  };

  HourglassAudio.prototype._applyMaster = function () {
    if (!this.ready) return;
    this.out.gain.setTargetAtTime(this._masterTarget(), this.ctx.currentTime, 0.05);
  };

  HourglassAudio.prototype._applyCharacter = function (tau) {
    if (!this.ready) return;
    var c = CHARACTERS[this.character] || CHARACTERS.asmr, t = this.ctx.currentTime;
    tau = tau || 0.25;
    this.gWhisper.gain.setTargetAtTime(c.whisper, t, tau);
    this.gTicks.gain.setTargetAtTime(c.ticks, t, tau);
    this.gBeds.gain.setTargetAtTime(c.beds, t, tau);
    this.gModal.gain.setTargetAtTime(c.modal, t, tau);
    this.wet.gain.setTargetAtTime(c.room, t, tau);
    this.toneLow.gain.setTargetAtTime(c.low, t, tau);
    this.toneHigh.gain.setTargetAtTime(c.high, t, tau);
    this.toneLP.frequency.setTargetAtTime(c.lp, t, tau);
    // re-voice the vessel itself
    var modes = this._modes = c.modes || MODES;
    for (var i = 0; i < this.modes.length; i++) {
      this.modes[i].Q.setTargetAtTime(modes[i][1], t, tau);
      this.modeGains[i].gain.setTargetAtTime(modes[i][2], t, tau);
    }
    this._last.fill = undefined;                         // retune on the next update
    this.wSend.gain.setTargetAtTime(c.send != null ? c.send : 0.55, t, tau);
    this.wBodyGain.gain.setTargetAtTime(c.body != null ? c.body : 0.42, t, tau);
    this._tickRate = c.tick || 1;
    this._band = c.band || 1;
  };

  HourglassAudio.prototype.setVolume = function (v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._applyMaster();
  };
  HourglassAudio.prototype.setMuted = function (m) {
    this.muted = !!m;
    this._applyMaster();
  };
  HourglassAudio.prototype.setCharacter = function (id) {
    if (!CHARACTERS[id]) return;
    this.character = id;
    this._applyCharacter(0.3);
  };
  HourglassAudio.prototype.setChimeEnabled = function (on) { this.chimeEnabled = !!on; };

  /* ---------------------------------------------------------------- *
   *  Ambience
   * ---------------------------------------------------------------- */
  HourglassAudio.prototype._ambGain = function () {
    return Math.pow(this.ambLevel, 1.5) * 1.1;
  };
  /** Synthesise an ambience right now (blocking; for tests). Returns [L, R] per layer. */
  HourglassAudio.prototype._makeAmbience = function (id, seed) {
    var d = AMBIENCES[id];
    if (!d || !d.layers) return null;
    seed = seed || 1;
    if (!this._ambRaw[id]) {
      this._ambRaw[id] = d.layers.map(function (L) {
        return [L.make(L.sr, L.seconds, 0, seed), L.make(L.sr, L.seconds, 1, seed)];
      });
    }
    return this._ambRaw[id];
  };
  /**
   * Synthesise an ambience one channel of one layer per slice, so the page
   * stays responsive, then call `done`. However often it is asked for, each
   * ambience is synthesised once.
   */
  HourglassAudio.prototype._synthAmbience = function (id, done) {
    var self = this, d = AMBIENCES[id];
    if (!d || !d.layers) return;
    if (this._ambRaw[id] || this._ambBuf[id]) { if (done) done(); return; }
    var job = this._ambJobs[id];
    if (job) { if (done) job.done.push(done); return; }               // already on its way
    job = this._ambJobs[id] = { seed: 1 + ((rnd() * 2147483646) | 0), k: 0, out: [], done: done ? [done] : [] };
    function next() {
      var li = job.k >> 1, ch = job.k & 1, L = d.layers[li];
      if (!ch) job.out[li] = [];
      job.out[li][ch] = L.make(L.sr, L.seconds, ch, job.seed);          // both ears: one seed
      if (++job.k < d.layers.length * 2) { setTimeout(next, 30); return; }
      self._ambRaw[id] = job.out;
      delete self._ambJobs[id];
      for (var i = 0; i < job.done.length; i++) job.done[i]();
    }
    setTimeout(next, 30);                                // never inside the tap that asked for it
  };
  /** Synthesise if need be, then play — if it is still the one wanted. */
  HourglassAudio.prototype._loadAmbience = function (id) {
    var self = this;
    this._synthAmbience(id, function () { if (self.ambience === id) self._startAmbience(id); });
  };
  HourglassAudio.prototype._startAmbience = function (id) {
    if (!this.ready) return;
    var ctx = this.ctx, t = ctx.currentTime, d = AMBIENCES[id], i;
    if (this._amb && this._amb.id === id) return;
    this._stopAmbience();                                // cross-fade out of the previous one
    var bufs = this._ambBuf[id], raw = this._ambRaw[id];
    if (!bufs) {
      if (!raw) return;
      bufs = this._ambBuf[id] = [];                      // wrap once, then let the arrays go
      for (i = 0; i < raw.length; i++) bufs.push(toBuffer(ctx, raw[i], d.layers[i].sr));
      delete this._ambRaw[id];
    }
    var g = ctx.createGain(), srcs = [];
    g.gain.value = 0;
    g.connect(this.ambBus);
    for (i = 0; i < bufs.length; i++) {                  // the layers loop independently
      var src = ctx.createBufferSource();
      src.buffer = bufs[i];
      src.loop = true;
      src.connect(g);
      src.start(0, rnd() * bufs[i].duration);
      srcs.push(src);
    }
    g.gain.setTargetAtTime(1, t, 0.4);
    this._amb = { id: id, srcs: srcs, g: g };
  };
  /** Fade out the ambience that is playing, then let it go. */
  HourglassAudio.prototype._stopAmbience = function () {
    var old = this._amb;
    if (!old) return;
    this._amb = null;
    old.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(function () {
      for (var i = 0; i < old.srcs.length; i++) { try { old.srcs[i].stop(); } catch (e) {} }
      try { old.g.disconnect(); } catch (e) {}
    }, 1800);
  };
  /** 'none' | 'brook' | 'rain'. Plays while the sand runs; auditions briefly when chosen. */
  HourglassAudio.prototype.setAmbience = function (id, audition) {
    if (!AMBIENCES[id]) return;
    this.ambience = id;
    if (!this.ready) return;
    if (id === 'none') { this._stopAmbience(); return; }
    if (audition) this._ambPreview = this.ctx.currentTime + 5;
    this._loadAmbience(id);
  };
  /**
   * Glide the ambience bus. On while `on` (the glass is running), while it is
   * auditioned, and until the bowl after a glass ends. Then it recedes: slowly
   * after a glass (τ 2 s, −4.3 dB/s: −20 dB 5 s after the bowl, −40 dB at 10 s),
   * gently (τ 0.9 s) on pause or reset.
   */
  HourglassAudio.prototype._ambience = function (on) {
    var t = this.ctx.currentTime;
    on = !!this._amb && this.ambience !== 'none' && (on || t < this._ambPreview || t < this._ambUntil);
    this._set('amb', this.ambBus.gain, on ? this._ambGain() : 0,
              on ? 0.5 : (this._ambUntil && t < this._ambUntil + 1 ? 2.0 : 0.9));
  };
  /** The glass has run out: the stream flows on until the bowl sounds (`delay` s), then recedes under it. */
  HourglassAudio.prototype.end = function (delay) {
    if (this.ready && this.ctx.state === 'running') this._ambUntil = this.ctx.currentTime + (delay || 0);
  };
  HourglassAudio.prototype.setAmbienceLevel = function (v, audition) {
    this.ambLevel = Math.max(0, Math.min(1, v));
    this._last.amb = undefined;
    if (audition && this.ready) this._ambPreview = this.ctx.currentTime + 3;
  };

  /* ---------------------------------------------------------------- *
   *  Per-frame update from the physics
   *
   *  st = {
   *    dt        seconds since the last update
   *    flow      grains / s through the neck (smoothed)
   *    impacts   grains / s landing in the lower bulb (smoothed)
   *    tail      1 … 0 across the final handful of grains
   *    fill      0 … 1 how full the lower bulb is
   *    bottom    grains resting in the lower bulb
   *    slides    surface-slide moves / s (avalanche & tumble activity)
   *    pouring   true while fresh sand is being added
   *    flipping  true while the vessel is turning
   *    spin      how fast it is turning (rad/s)
   *    angle     current flip angle (rad)
   *    running   true while the timer is running (keeps the ambience on)
   *    sim       the Sim (for this frame's impact events), or null
   *  }
   * ---------------------------------------------------------------- */
  HourglassAudio.prototype.update = function (st) {
    if (!this.ready || this.ctx.state !== 'running') return;
    var ctx = this.ctx, t = ctx.currentTime;
    var dt = st.dt > 0 ? Math.min(st.dt, 0.1) : 0.016;
    // ---- ambience: on while the glass runs, even while it is being turned ---
    this._ambience(st.ambient != null ? st.ambient : st.running);

    // ---- Layer 2: whisper follows the flow ------------------------------
    var flow = st.flow || 0;
    var f01 = flow <= 0 ? 0 : Math.min(1, Math.pow(flow / 320, 0.45));
    // A long, slow timer still breathes softly; a short one is fuller.
    var whisper = flow > 0.4 ? (0.34 + 0.66 * f01) * st.tail : 0;
    this._set('w', this.wEnv.gain, whisper, whisper > (this._last.w || 0) ? 0.10 : 0.16);
    // slow random drift of the "air" band keeps the hiss from sounding static
    this._drift += dt;
    if (this._drift > 0.27) {
      this._drift = 0;
      var centre = (4700 - 900 * f01) * (this._band || 1);   // heavier flow = slightly darker
      this.wBand.frequency.setTargetAtTime(centre * (0.9 + rnd() * 0.22), t, 0.45);
      this.wBody.frequency.setTargetAtTime(850 + rnd() * 260, t, 0.6);
    }

    // ---- bare glass ⇄ sand cushion --------------------------------------
    var cushTarget = Math.min(1, Math.pow((st.bottom || 0) / 900, 0.7));
    this._cushion += (cushTarget - this._cushion) * Math.min(1, dt * 3);
    var cushion = this._cushion;

    // ---- Layer 3a: dense textures ---------------------------------------
    var imp = st.impacts || 0;
    var dens = imp <= 0 ? 0 : Math.min(1, Math.pow(imp / 300, 0.5));
    this._set('pat', this.patEnv.gain, dens * cushion * 0.9, 0.12);
    this._set('tnk', this.tinkEnv.gain, dens * (1 - cushion) * 0.8, 0.10);

    // ---- Layer 3b: individual grains, straight from the physics ---------
    var sim = st.sim;
    if (sim && sim.nev) {
      var max = this.character === 'asmr' ? 4 : 3;
      var n = sim.nev, take = n < max ? n : max;
      for (var k = 0; k < take; k++) {
        var e = n <= max ? k : (rnd() * n) | 0;
        var kind = sim.evK[e], v = sim.evV[e], x = sim.evX[e];
        var top = (kind & 2) !== 0;
        var glass = !top && ((kind & 1) === 0 || rnd() < Math.pow(1 - cushion, 1.5));
        var amp = (0.32 + 0.68 * Math.pow(v, 1.2)) * (0.55 + 0.45 * rnd());
        if (top) amp *= 0.55;
        // spread within the frame: Poisson arrivals, not a 60 Hz buzz
        this._tick(t + 0.004 + rnd() * dt, glass, amp, x);
      }
    }

    // ---- Layer 1: the air cavity shrinks as the lower bulb fills --------
    var fill = st.fill || 0;
    if (this._last.fill === undefined || Math.abs(this._last.fill - fill) > 0.004) {
      this._last.fill = fill;
      for (var m = 0; m < this.modes.length; m++) {
        this.modes[m].frequency.setTargetAtTime(this._modes[m][0] * (1 + this._modes[m][3] * fill), t, 0.4);
      }
    }

    // ---- Layer 4: pour ---------------------------------------------------
    if (st.pouring) {
      this._flutter += dt;
      if (this._flutter > 0.07) {
        this._flutter = 0;
        this.pEnv.gain.setTargetAtTime(0.28 + rnd() * 0.14, t, 0.05);
        this.pBP.frequency.setTargetAtTime(1900 + rnd() * 900, t, 0.08);
        this._last.pour = 1;
      }
    } else if (this._last.pour) {
      this._last.pour = 0;
      this.pEnv.gain.setTargetAtTime(0, t, 0.11);
    }

    // ---- Layer 4: rush of sliding sand (flip / avalanches) --------------
    var sl = st.slides || 0;
    var rush = sl <= 24000 ? 0 : Math.min(1, Math.pow((sl - 24000) / 160000, 0.55));
    var panTo = 0;
    if (st.flipping) {
      // the turn itself: the faster the hand, the louder the slide; it
      // brightens as the glass passes level and leans toward the raised bulb
      var turn = Math.abs(Math.sin(st.angle || 0));
      var spin = Math.min(1, (st.spin || 0) / 3);
      rush = Math.max(rush, Math.pow(spin, 0.8) * (0.3 + 0.55 * turn));
      panTo = Math.sin(st.angle || 0) * 0.65;
    }
    this._set('rush', this.rEnv.gain, rush * 0.5, rush > (this._last.rush || 0) ? 0.06 : 0.22);
    if (rush > 0.01) {
      this._set('rbp', this.rBP.frequency, 1100 + 2300 * rush, 0.12);
      if (this.rPan.pan) this._set('rpan', this.rPan.pan, panTo, 0.12);
    }
  };

  /** Used while the page is hidden: hold a steady whisper without physics. */
  HourglassAudio.prototype.hold = function (flow, tail) {
    if (!this.ready || this.ctx.state !== 'running') return;
    var f01 = flow <= 0 ? 0 : Math.min(1, Math.pow(flow / 320, 0.45));
    var w = flow > 0.4 ? (0.34 + 0.66 * f01) * tail : 0;
    var dens = flow <= 0 ? 0 : Math.min(1, Math.pow(flow / 300, 0.5)) * tail;
    this._set('w', this.wEnv.gain, w, 0.3);
    this._set('pat', this.patEnv.gain, dens * this._cushion * 0.9, 0.3);
    this._set('tnk', this.tinkEnv.gain, dens * (1 - this._cushion) * 0.8, 0.3);
    this._set('rush', this.rEnv.gain, 0, 0.2);
    this._ambience(flow > 0.4);
    if (this._last.pour) { this._last.pour = 0; this.pEnv.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); }
  };

  /** Glide every sand layer, and the ambience, to silence (pause, reset…). */
  HourglassAudio.prototype.hush = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._ambUntil = 0;
    this._ambience(false);
    this._set('w', this.wEnv.gain, 0, 0.12);
    this._set('pat', this.patEnv.gain, 0, 0.12);
    this._set('tnk', this.tinkEnv.gain, 0, 0.1);
    this._set('rush', this.rEnv.gain, 0, 0.2);
    this.pEnv.gain.setTargetAtTime(0, t, 0.1);
    this._last.pour = 0;
  };

  /* ---------------------------------------------------------------- *
   *  One grain hitting something
   * ---------------------------------------------------------------- */
  HourglassAudio.prototype._tick = function (when, glass, amp, x) {
    var ctx = this.ctx;
    var bank = glass ? this.tinks : this.pats;
    var s = ctx.createBufferSource();
    s.buffer = bank[(rnd() * bank.length) | 0];
    s.playbackRate.value = (glass ? 0.88 + rnd() * 0.3 : 0.8 + rnd() * 0.45) * (this._tickRate || 1);
    var p = x < -0.22 ? 0 : (x > 0.22 ? 2 : 1);
    if (rnd() < 0.3) p = (rnd() * 3) | 0;           // a little air between grains
    if (!glass) amp *= 0.8;
    var tier = amp < 0.45 ? 0 : (amp < 0.76 ? 1 : 2);
    s.connect(this.tiers[p][tier]);
    s.start(when);
  };

  /* ---------------------------------------------------------------- *
   *  Foley one-shots
   * ---------------------------------------------------------------- */

  /** Soft, low wood/velvet thud. strength 0…1 */
  HourglassAudio.prototype._thud = function (when, strength, pitch) {
    var ctx = this.ctx;
    pitch = pitch || 1;
    // body: a sine that drops in pitch as it dies
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(126 * pitch, when);
    o.frequency.exponentialRampToValueAtTime(50 * pitch, when + 0.17);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5 * strength, when + 0.007);
    g.gain.setTargetAtTime(0, when + 0.012, 0.07);
    o.connect(g); g.connect(this.gFoley);
    o.start(when); o.stop(when + 0.7);
    // knock: a short felted noise burst gives it the "wood on desk" contact
    var n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = this.brown;
    f.type = 'bandpass'; f.frequency.value = 270 * pitch; f.Q.value = 1.1;
    ng.gain.setValueAtTime(0.0001, when);
    ng.gain.exponentialRampToValueAtTime(0.9 * strength, when + 0.004);
    ng.gain.setTargetAtTime(0, when + 0.008, 0.028);
    n.connect(f); f.connect(ng); ng.connect(this.gFoley);
    n.start(when, rnd() * 2); n.stop(when + 0.35);
  };

  /** A fingertip on the glass: soft pad, a hint of nail, the vessel answers. */
  HourglassAudio.prototype.tap = function () {
    if (!this.ready || this.ctx.state !== 'running') return;
    var ctx = this.ctx, t = ctx.currentTime + 0.004;
    var n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), ring = ctx.createGain();
    n.buffer = this.brown;
    f.type = 'bandpass'; f.frequency.value = 540; f.Q.value = 0.9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.006, 0.016);
    ring.gain.value = 2.2;
    n.connect(f); f.connect(g); g.connect(this.gFoley);
    g.connect(ring); ring.connect(this.modalIn);         // sets the glass ringing for an instant
    n.start(t, rnd() * 2); n.stop(t + 0.25);
    this._tick(t + 0.001, true, 0.5, 0);
  };

  HourglassAudio.prototype.flipStart = function () {
    if (!this.ready || this.ctx.state !== 'running') return;
    this._thud(this.ctx.currentTime + 0.01, 0.24, 1.25);     // lift
  };
  HourglassAudio.prototype.flipEnd = function () {
    if (!this.ready || this.ctx.state !== 'running') return;
    this._thud(this.ctx.currentTime + 0.005, 0.48, 1);       // set down
  };

  /**
   * End of timer: a warm singing-bowl bloom. Inharmonic partials, each a
   * slowly beating pair, soft attack (no mallet), ≈5 s natural decay.
   */
  HourglassAudio.prototype.chime = function (delay) {
    if (!this.ready || !this.chimeEnabled || this.ctx.state !== 'running') return;
    var ctx = this.ctx, t0 = ctx.currentTime + (delay || 0) + 0.03;
    var f0 = 349.23;            // F4: warm, yet audible on small phone speakers
    //            ratio  level  decay τ  attack
    var parts = [[1.00, 1.00, 1.25, 0.16],
                 [2.00, 0.07, 0.95, 0.12],
                 [2.74, 0.40, 0.85, 0.09],
                 [5.18, 0.15, 0.50, 0.05],
                 [8.05, 0.045, 0.30, 0.03]];
    var out = ctx.createGain();
    out.gain.value = 0.12;
    out.connect(this.gChime);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      for (var side = -1; side <= 1; side += 2) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f0 * p[0] * (1 + side * 0.0013);   // slow beating
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(p[1] * 0.5, t0 + p[3]);
        g.gain.setTargetAtTime(0, t0 + p[3], p[2]);
        o.connect(g);
        if (ctx.createStereoPanner) {
          var pn = ctx.createStereoPanner();
          pn.pan.value = side * 0.32;
          g.connect(pn); pn.connect(out);
        } else g.connect(out);
        o.start(t0); o.stop(t0 + 8.5);
      }
    }
    setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (delay || 0) * 1000 + 9500);
  };

  root.HourglassAudio = HourglassAudio;
})(typeof window !== 'undefined' ? window : globalThis);
