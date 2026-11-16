/*!
 * Hourglass — audio.js
 * ---------------------------------------------------------------------------
 * Procedural, physically-informed ASMR sound of an hourglass.
 * 100 % Web Audio API — every sample is synthesised at start-up or in real
 * time. No audio files, no libraries.
 *
 *   The sand        nothing but tiny impacts. Grains landing on bare glass
 *                   or on their own pile, thousands a second: the soft hush
 *                   of the landing, its fine crackle, and the grains the
 *                   physics drops one by one, each a click of its own
 *   The vessel      the glass's own resonances (rung by the glass in hand;
 *                   in some characters by the sand too) and the hollow body
 *                   of the bulb, whose pitch rises as it fills
 *   Foley           pour, flip thuds, the slide of sand as it turns, the air
 *                   it cuts, the end-of-timer bowl
 *   The glass in    bed landings and slams when shaken, a shaker shimmer,
 *   hand            creaks, a crack, the trickle of a leak, the hum of mending
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
  var MODES_WARM = [                    // thicker, softer glass: rounder, shorter rings
    [520, 9, 1.00, 0.18],
    [1150, 10, 0.80, 0.14],
    [1980, 11, 0.62, 0.10],
    [3150, 10, 0.42, 0.06],
    [4700, 9, 0.26, 0.04],
    [6600, 8, 0.14, 0.02]
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
  // The hollow body of the bulb under the sand: broad and low-Q, so it
  // colours the grains without ringing; the air cavity lowest. It rises as
  // the bulb fills.
  var MODES_BODY = [
    [430, 2.2, 0.70, 0.45],
    [1250, 3.0, 0.45, 0.15],
    [2450, 3.5, 0.25, 0.12],
    [3900, 4.0, 0.20, 0.08],
    [5600, 4.0, 0.18, 0.05],
    [7600, 4.0, 0.10, 0.03]
  ];

  /*
   * Acoustic characters: how loud each layer is, the tone, and how the
   * vessel is voiced.
   *   whisper  the hush of the landing        beds   its fine crackle
   *   shake    the crackle of a shaken glass (as loud as `beds`, if left out)
   *   ticks    every grain struck one by one (the glass in hand's too);
   *            grain is how strongly the stream's own grains land
   *   body     the bulb's hollow body
   *   modal    the vessel's own resonances (`modes`), always rung by the
   *            glass in hand; `send` is how much the hush excites them and
   *            `vessel` how much the crackle, the grains, the pour and the
   *            slide do (0: the sand never rings the glass)
   *   tick     the pitch of every grain       bed    the pitch of the beds
   *   room, low, high, lp                     the room, and the tone
   */
  var CHARACTERS = {
    asmr: {
      name: 'Close-Miked ASMR',
      whisper: 0.034, beds: 0.016, shake: 0.034, ticks: 0.19, grain: 2.1, body: 0.08, modal: 0.15, room: 0.10,
      low: 0, high: 0, lp: 18000, send: 0, vessel: 0
    },
    warm: {
      name: 'Warm Glass',
      whisper: 0.026, beds: 0.011, ticks: 0.12, grain: 2.4, body: 0.10, modal: 0.20, room: 0.30,
      low: 3, high: -6, lp: 8200, modes: MODES_WARM, send: 0.09, vessel: 1
    },
    pure: {
      name: 'Pure Sand Whisper',
      whisper: 0.046, beds: 0.012, ticks: 0.03, grain: 2.0, body: 0.03, modal: 0.045, room: 0.12,
      low: -1, high: 0, lp: 15000, send: 0, vessel: 0
    },
    chime: {
      name: 'Singing Glass',
      whisper: 0.022, beds: 0.009, ticks: 0.17, grain: 2.2, body: 0, modal: 0.30, room: 0.36,
      low: 0, high: 0, lp: 11000,
      modes: MODES_CHIME, send: 0.05, vessel: 1, tick: 1.0, bed: 1
    },
    bamboo: {
      name: 'Bamboo Rainstick',
      whisper: 0.012, beds: 0.011, ticks: 0.20, grain: 2.3, body: 0, modal: 0.38, room: 0.22,
      low: 2, high: -4, lp: 8500,
      modes: MODES_BAMBOO, send: 0.11, vessel: 1, tick: 0.58, bed: 0.8
    },
    dune: {
      name: 'Desert Dune',
      whisper: 0.032, beds: 0.012, ticks: 0.07, grain: 2.0, body: 0, modal: 0.53, room: 0.26,
      low: 5, high: -9, lp: 5200,
      modes: MODES_DUNE, send: 0.25, vessel: 1, tick: 0.5, bed: 0.55
    }
  };

  /*
   * How a glass rings once it has been through something: [mode frequency ×,
   * Q ×] against the character's own table. A crack lets the vessel's modes
   * leak energy, so they ring lower and duller; the gold seam of a mended
   * glass damps them only a little.
   */
  var GLASS_STATES = {
    intact: [1, 1],
    cracked: [0.97, 0.6],
    mended: [0.99, 0.85]
  };
  /*
   * Output levels of the glass's own sounds against their recipes, found by
   * rendering offline through the real chain (whose compressor lets a few
   * milliseconds of transient through and lifts them):
   *   crack  the snap, the ring and the knock of a crack: it peaks about
   *          15 dB under the completion bowl (13.5 at the least), surprising
   *          but never alarming
   *   tick   the tiny ticks of strained glass (creaks, a crack settling or
   *          growing): four creak ticks peak under −32 dBFS, panned or not,
   *          on an intact or a cracked glass
   *   hum    the mend hum; at its recipe's level it rendered at −70 dBFS,
   *          below hearing, and sits near −48 dBFS RMS with this
   */
  var LEVEL = { crack: 0.045, tick: 0.2, hum: 12 };

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
   *  The sand, as it lands
   *
   *  A grain of fine sand is so light that the sound of it landing is over
   *  in a fraction of a millisecond: a click whose colour is set by what it
   *  lands on. On bare glass the wall answers with a few of its own short,
   *  high modes; on sand the grain nudges one or two neighbours, and that is
   *  all. Thousands a second blur into the soft hush of the landing, the
   *  louder few poke out of it as a fine crackle, and now and then one stands
   *  alone. So the sand is made of nothing but such clicks:
   *
   *    banks  a few dozen single impacts per surface, each one different
   *    beds   seconds of thousands of them a second, landing in clumps (the
   *           rate swings log-normally, over tens of milliseconds and over
   *           a few tenths of a second), each with its own loudness (log-
   *           normal: a few grains are bigger), shape, pitch and place in a
   *           narrow cone in front (equal-power pan, the far ear a few
   *           samples late)
   *
   *  The beds are synthesised offline in short slices while the page is
   *  idle, and played without ever repeating (a Shuffler, below).
   * -------------------------------------------------------------------- */

  // The material is the same on every load (it is calibrated); only how it is played is random.
  var SAND_SEED = 20261116;
  // The bulb's own ringing, shared by every tink (Hz): inharmonic, like a thin shell.
  var GLASS_MODES = [2930, 3710, 4580, 5790, 7120, 8460, 9930, 11600];

  /*
   * The beds, one per surface: four channels, the hush (L, R) and the
   * crackle (L, R), drawn from one stream, so a clump is a clump for every
   * size of grain. secs: length; bank: 'mbS' grains on sand, 'mbG' on glass;
   * tilt: how far the louder grains lean to the lower (bigger) shapes;
   * width: σ of the pan; itd: the far ear's delay at |pan| = 1 (s); pitch:
   * ± speed of each grain; clump, swell, colour: [fc Hz, hp Hz] of the
   * curves that swing the rate (tens of ms; a few tenths of a second) and
   * the mix of shapes. Then per population: rate (grains/s); sigma, cap:
   * their loudness, log-normal (σ of the log), eased under `cap` × the
   * median; clump, swell, colour: how hard each curve swings it (σ of the
   * log); bias: how far its shapes lean to the higher ones; floor: the
   * share of the rate that never swings away (a fine stream never quite
   * stops); lim: the rare highest peaks are held to this × its RMS.
   *
   * On sand the hush is fine and dense, as fine sand is: several thousand
   * grains a second, steady, airy, close to a smooth hiss. The crackle over
   * it is the few louder grains, and comes and goes.
   */
  var BEDS = {
    sand: { secs: 7, bank: 'mbS', tilt: 0.5, width: 0.3, itd: 0.00015, pitch: 0.12,
            clump: [40, 4], swell: [6, 0.7], colour: [18, 1],
            hush: { rate: 6500, sigma: 0.4, cap: 4, clump: 0.2, swell: 0.3, colour: 1.6, bias: 1.6, floor: 0.5, lim: 8 },
            crackle: { rate: 600, sigma: 0.5, cap: 3, clump: 0.25, swell: 0.6, colour: 3.0, floor: 0, lim: 7 } },
    glass: { secs: 5, bank: 'mbG', tilt: 0.5, width: 0.24, itd: 0.00006, pitch: 0.05,
             clump: [40, 4], swell: [6, 0.7], colour: [18, 1],
             hush: { rate: 900, sigma: 0.5, cap: 4, clump: 0.6, swell: 0.6, colour: 3.6, floor: 0.35, lim: 8 },
             crackle: { rate: 350, sigma: 0.5, cap: 3, clump: 0.25, swell: 0.6, colour: 3.0, floor: 0, lim: 7 } }
  };

  var now = root.performance && root.performance.now ? function () { return root.performance.now(); } : Date.now;

  /**
   * `nch` channels of `n` samples at `sr`, { buf, ch }: an AudioBuffer when
   * one can be made before there is a context (the sound is then written
   * straight into it, and building the graph copies nothing), else arrays.
   */
  function channels(nch, n, sr) {
    var ch = [], c;
    if (typeof root.AudioBuffer === 'function') {
      try {
        var b = new root.AudioBuffer({ numberOfChannels: nch, length: n, sampleRate: sr });
        for (c = 0; c < nch; c++) ch.push(b.getChannelData(c));
        return { buf: b, ch: ch };
      } catch (e) { ch = []; }
    }
    for (c = 0; c < nch; c++) ch.push(new Float32Array(n));
    return { buf: null, ch: ch };
  }
  /** Material made by channels() (or copied in with fill()), as an AudioBuffer for `ctx`. */
  function asBuffer(ctx, m, sr) { return m.buf || toBuffer(ctx, m.ch, sr); }
  /** Copy arrays (one per channel) into fresh channels(). */
  function fill(arrays, sr) {
    var m = channels(arrays.length, arrays[0].length, sr);
    for (var c = 0; c < arrays.length; c++) m.ch[c].set(arrays[c]);
    return m;
  }

  /** Add a noise burst through an RBJ band-pass (0 dB peak) into `a` from `at`, decaying as exp(−t/tau). */
  function bpBurst(r, a, at, sr, fc, Q, tau, amp, atk) {
    var w0 = TAU * fc / sr, alpha = Math.sin(w0) / (2 * Q), cw = Math.cos(w0);
    var b0 = alpha / (1 + alpha), a1 = -2 * cw / (1 + alpha), a2 = (1 - alpha) / (1 + alpha);
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0, n = a.length - at, len = Math.min(n, Math.ceil(sr * tau * 7));
    var k = Math.exp(-1 / (sr * tau)), env = amp;
    for (var i = 0; i < n; i++) {
      var x = 0;
      if (i < len) {
        x = (r() * 2 - 1) * env * (i < atk ? 0.5 - 0.5 * Math.cos(Math.PI * (i + 1) / (atk + 1)) : 1);
        env *= k;
      }
      var y = b0 * (x - x2) - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      a[at + i] += y;
      if (i > len && (y < 0 ? -y : y) < 1e-6 && (y1 < 0 ? -y1 : y1) < 1e-6) break;
    }
  }
  /** Add a damped sine (one mode) into `a` from `at`. */
  function mode(a, at, sr, f, tau, amp, ph) {
    var n = Math.min(a.length - at, Math.ceil(sr * tau * 7)), k = Math.exp(-1 / (sr * tau)), env = amp, w = TAU * f / sr;
    for (var i = 0; i < n; i++) { a[at + i] += env * Math.sin(w * i + ph) * (i < 3 ? (i + 1) / 4 : 1); env *= k; }
  }
  /** Scale `a` so its energy (sum of squares) is E. */
  function toEnergy(a, E) {
    var s = 0, i;
    for (i = 0; i < a.length; i++) s += a[i] * a[i];
    s = Math.sqrt(E / (s || 1));
    for (i = 0; i < a.length; i++) a[i] *= s;
    return a;
  }
  /** A log-loudness eased under `top` by a soft knee `w` wide: the loud tail stays smooth, never piles up at a cap. */
  function softTop(ln, top, w) {
    var d = ln - top + w;
    return d > 0 ? top - w + d / (1 + d / w) : ln;
  }
  /** Scale `a` down, if need be, so its peak is at most `p` (the sharpest few grains are a little softer). */
  function peakCap(a, p) {
    var m = 0, i;
    for (i = 0; i < a.length; i++) { var v = a[i] < 0 ? -a[i] : a[i]; if (v > m) m = v; }
    if (m > p) { m = p / m; for (i = 0; i < a.length; i++) a[i] *= m; }
    return a;
  }
  /** Fade the last `frac` of `a` to zero. */
  function fadeTail(a, frac) {
    var n = a.length, s = Math.floor(n * (1 - frac));
    for (var i = s; i < n; i++) a[i] *= (n - i) / (n - s);
    return a;
  }

  /**
   * `n` single micro-impacts for the beds, unit energy, ordered from the
   * lowest to the highest. sand: a dry puff, sometimes two or three grains
   * in a cluster (the neighbours it nudges); glass: a hard click with one or
   * two of the bulb's modes, damped at once by the sand around it.
   */
  function microBank(r, sr, surface, n) {
    var bank = [];
    for (var j = 0; j < n; j++) {
      var a, u = r(), fc, us = (j + r()) / n;                        // the pitches spread evenly over the range
      if (surface === 'sand') {
        fc = 2500 * Math.pow(2, 2.2 * us);                             // 2.5 … 11.5 kHz
        var tau = 0.00011 + 0.00034 * r() * (4000 / Math.max(2500, fc));
        a = new Float32Array(Math.ceil(sr * (tau * 8 + 0.0016)));
        bpBurst(r, a, 0, sr, fc, 0.7 + 0.9 * r(), tau, 1, 2);
        var subs = u < 0.45 ? 0 : (u < 0.85 ? 1 : 2);
        for (var s = 0; s < subs; s++) {
          bpBurst(r, a, Math.floor(sr * (0.00015 + 0.0009 * r())), sr, fc * (0.7 + 0.7 * r()), 0.8 + r(),
                  tau * (0.6 + 0.6 * r()), 0.25 + 0.4 * r(), 2);
        }
        mode(a, 0, sr, 420 * Math.pow(2, 1.4 * r()), 0.0008 + 0.0012 * r(), 0.008 + 0.006 * r(), r() * TAU);   // the pile gives a little
      } else {
        fc = 6000 + 5000 * us;
        a = new Float32Array(Math.ceil(sr * 0.007));
        bpBurst(r, a, 0, sr, fc, 0.6, 0.00006 + 0.00008 * r(), 1, 1);        // the contact
        for (var q = 1 + (r() < 0.5 ? 1 : 0); q > 0; q--) {
          var f = GLASS_MODES[2 + ((Math.pow(r(), 0.7) * (GLASS_MODES.length - 2)) | 0)] * (1 + 0.025 * gauss(r));
          mode(a, 0, sr, f, 0.0005 + 0.0011 * r() * (5000 / f), 0.14 + 0.16 * r(), r() * TAU);
        }
      }
      a = toEnergy(fadeTail(a, 0.25), 1);
      a.fc = fc;
      bank.push(a);
    }
    bank.sort(function (x, y) { return x.fc - y.fc; });
    return bank;
  }

  // A grain's energy (sum of squares at 48 kHz), the same as the earlier
  // peak-normalised grains: every caller of _tick (thumps, clacks, chips,
  // the leak) keeps its level.
  var PAT_ENERGY = 10.9, TINK_ENERGY = 11.4;

  /** One grain landing on sand that can be told apart: a dry crackle of 1–3 contacts and a whisper of body. */
  function synthPat(r, sr, us) {
    var a = new Float32Array(Math.ceil(sr * 0.009));
    var fc = 3400 * Math.pow(2, 1.4 * us), tau = 0.00025 + 0.0004 * r();
    bpBurst(r, a, 0, sr, fc, 0.9 + 0.6 * r(), tau, 1, 6);
    for (var s = 1 + ((r() * 2.6) | 0); s > 0; s--) {
      bpBurst(r, a, Math.floor(sr * (0.0004 + 0.0028 * Math.pow(r(), 1.5))), sr, fc * (0.8 + 0.6 * r()), 1 + r(),
              tau * (0.5 + 0.7 * r()), 0.18 + 0.32 * r(), 2);
    }
    mode(a, 0, sr, 380 * Math.pow(2, 1.3 * r()), 0.0015 + 0.0015 * r(), 0.010 + 0.012 * r(), r() * TAU);   // the pile's faint thock
    fadeTail(a, 0.3);
    return peakCap(toEnergy(a, PAT_ENERGY), 1.35);
  }

  /** One grain on bare glass: a crisp contact and two or three of the bulb's modes, short (the sand damps them). */
  function synthTink(r, sr, us) {
    var a = new Float32Array(Math.ceil(sr * 0.03));
    bpBurst(r, a, 0, sr, 7000 + 4500 * us, 0.7, 0.00007 + 0.00006 * r(), 1, 1);
    var used = {};
    for (var q = 0, picks = 2 + (r() < 0.4 ? 1 : 0); q < picks; q++) {
      var k = 1 + ((Math.pow(r(), 0.75) * (GLASS_MODES.length - 2)) | 0);
      if (used[k]) k++;
      used[k] = 1;                                         // 3.7–11.6 kHz: glassy, never shrill on a phone
      var f = GLASS_MODES[k] * (1 + 0.025 * gauss(r));     // where it lands, how much sand touches it
      mode(a, 0, sr, f, (0.001 + 0.002 * r()) * Math.pow(3500 / f, 0.8), (0.25 + 0.3 * r()) / (1 + q * 0.5), r() * TAU);
    }
    if (r() < 0.5) bpBurst(r, a, Math.floor(sr * (0.001 + 0.003 * r())), sr, 7000 + 3000 * r(), 0.7, 0.00006, 0.15 + 0.2 * r(), 1);   // a tiny bounce
    fadeTail(a, 0.2);
    return peakCap(toEnergy(a, TINK_ENERGY), 1.2);
  }

  /**
   * A bed of micro-impacts (see BEDS), made a little at a time: each call
   * does one short stretch of the work (the curves; the grains of the next
   * quarter second; a block of normalising and peak-finding) and returns the
   * function for the next; the last returns its four channels (hush L,
   * hush R, crackle L, crackle R; see channels()), each pair at unit RMS.
   * It wraps round: seamless as a loop.
   */
  function grainBed(r, sr, bank, B) {
    var secs = B.secs, n = Math.floor(sr * secs), cr = 500, nc = Math.round(secs * cr), out, pops;
    var itd = B.itd * sr, nb = bank.length, t = 0, c1, c2, c3;
    function curves() {
      // one stream: its clumps (tens of ms), its swell, and the drift of its shapes, once per 2 ms
      c1 = ctrlCurve(r, nc, B.clump[0], cr, B.clump[1]);
      c2 = ctrlCurve(r, nc, B.swell[0], cr, B.swell[1]);
      c3 = new Float32Array(nc + 1);
      c3.set(ctrlCurve(r, nc, B.colour[0], cr, B.colour[1]));
      c3[nc] = c3[0];
      return streams;
    }
    function streams() {
      pops = [B.hush, B.crackle].map(function (p) {
        // a Poisson stream at the highest rate, thinned to the swinging one (which keeps its floor)
        var sd = Math.sqrt(p.clump * p.clump + p.swell * p.swell), fl = p.floor || 0;
        var M = fl + (1 - fl) * Math.exp(2.5 * sd), keep = new Float32Array(nc + 1), j;
        for (j = 0; j < nc; j++) keep[j] = Math.min(1, (fl + (1 - fl) * Math.exp(p.clump * c1[j] + p.swell * c2[j] - sd * sd / 2)) / M);
        keep[nc] = keep[0];
        var o = { p: p, keep: keep, lam: p.rate * M, t: 0, top: Math.log(p.cap), L: null, R: null };
        return o;
      });
      out = channels(4, n, sr);
      pops[0].L = out.ch[0]; pops[0].R = out.ch[1]; pops[1].L = out.ch[2]; pops[1].R = out.ch[3];
      return chunk;
    }
    function grains(o, end) {
      var p = o.p, L = o.L, R = o.R, keep = o.keep, kc = p.colour;
      for (;;) {
        o.t += -Math.log(1 - r()) / o.lam;
        if (o.t >= end) break;
        var x = o.t * cr, c0 = x | 0;
        if (r() >= keep[c0] + (keep[c0 + 1] - keep[c0]) * (x - c0)) continue;
        var z = gauss(r), amp = Math.exp(softTop(p.sigma * z, o.top, 0.5));
        // its shape, low to high: bigger grains lower, and the mix drifts from clump to clump
        var u = r() * 0.998 + 0.001;
        var q = Math.log(u / (1 - u)) - B.tilt * z + kc * (c3[c0] + (c3[c0 + 1] - c3[c0]) * (x - c0)) + (p.bias || 0);
        var g = bank[Math.min(nb - 1, (nb / (1 + Math.exp(-q))) | 0)];
        var pn = B.width * gauss(r);
        pn = pn > 0.9 ? 0.9 : (pn < -0.9 ? -0.9 : pn);
        var ang = (pn + 1) * Math.PI / 4, gl = amp * Math.cos(ang), gr = amp * Math.sin(ang);
        var dl = pn > 0 ? Math.round(itd * pn) : 0, dr = pn < 0 ? Math.round(-itd * pn) : 0;   // the far ear later
        var step = 1 + B.pitch * (2 * r() - 1), len = Math.floor((g.length - 1) / step), s0 = Math.floor(o.t * sr);
        for (var k = 0; k < len; k++) {
          var pos = k * step, i0 = pos | 0, v = g[i0] + (g[i0 + 1] - g[i0]) * (pos - i0);
          var jl = s0 + k + dl, jr = s0 + k + dr;
          if (jl >= n) jl -= n;
          if (jr >= n) jr -= n;
          L[jl] += v * gl;
          R[jr] += v * gr;
        }
      }
      o.t = end;
    }
    function chunk() {
      var end = Math.min(secs, t + 0.1);
      for (var q = 0; q < pops.length; q++) grains(pops[q], end);
      t = end;
      return t < secs ? chunk : level;
    }
    // then each pair: its energy, block by block; scaled to unit RMS while its
    // peaks over the limit are noted; and the few of those held down
    var BLK = 1 << 16, pq = 0, phase = 0, at = 0, e = 0, P = [], V = [];
    function level() {
      var o = pops[pq], L = o.L, R = o.R, end = at + BLK < n ? at + BLK : n, j, a, b;
      if (phase === 0) {
        for (j = at; j < end; j++) e += L[j] * L[j] + R[j] * R[j];
      } else {
        var k = Math.sqrt(2 * n / (e || 1)), thr = o.p.lim || 1e9;
        for (j = at; j < end; j++) {
          a = L[j] *= k; b = R[j] *= k;
          if (a < 0) a = -a;
          if (b < 0) b = -b;
          if (b > a) a = b;
          if (a > thr) { P.push(j); V.push(thr / a); }
        }
      }
      at = end;
      if (at < n) return level;
      at = 0;
      if (phase === 0) { phase = 1; return level; }
      if (P.length) limitWalk(L, R, P, V, sr);
      phase = 0; e = 0; P = []; V = [];
      return ++pq < pops.length ? level : done;
    }
    function done() { return out; }
    return curves;
  }

  /**
   * Hold the few loudest peaks of a bed to `thr` (both channels, one gain):
   * the gain eases down over the 0.5 ms before each peak and comes back with
   * an 8 ms release. Only the stretches round a peak are walked. The walk
   * starts in the widest gap between peaks, so it is seamless round the loop.
   */
  function limitPeaks(L, R, thr, sr) {
    var P = [], V = [], i, m, v;
    for (i = 0; i < L.length; i++) {
      m = L[i] < 0 ? -L[i] : L[i];
      v = R[i] < 0 ? -R[i] : R[i];
      if (v > m) m = v;
      if (m > thr) { P.push(i); V.push(thr / m); }
    }
    if (P.length) limitWalk(L, R, P, V, sr);
    return P.length;
  }
  /** The walk of limitPeaks: P the samples over the limit (in order), V the gain each needs. */
  function limitWalk(L, R, P, V, sr) {
    var n = L.length, np = P.length, la = Math.max(2, Math.round(sr * 0.0005)), rel = Math.exp(-1 / (sr * 0.008));
    var best = P[0] + n - P[np - 1], k0 = np - 1, k;
    for (k = 1; k < np; k++) if (P[k] - P[k - 1] > best) { best = P[k] - P[k - 1]; k0 = k - 1; }
    var s0 = P[k0] + (best >> 1), D = new Int32Array(np), W = new Float32Array(np);
    for (k = 0; k < np; k++) {
      var kk = (k0 + 1 + k) % np, d = (P[kk] - s0) % n;
      D[k] = d < 0 ? d + n : d;
      W[k] = V[kk];
    }
    var g = 1, j = 0, pos = 0;
    while (pos < n && (j < np || g < 0.9999)) {
      if (g >= 0.9999 && j < np && pos < D[j] - la) pos = D[j] - la;      // nothing near: skip ahead
      var tg = 1;
      for (k = j; k < np && D[k] <= pos + la; k++) {
        var rp = W[k] + (1 - W[k]) * (D[k] - pos) / la;                      // ease down to the peak
        if (rp < tg) tg = rp;
      }
      g = 1 - (1 - g) * rel;
      if (tg < g) g = tg;
      var ii = s0 + pos;
      if (ii >= n) ii -= n;
      L[ii] *= g;
      R[ii] *= g;
      pos++;
      while (j < np && D[j] < pos) j++;
    }
  }

  /* ----------------------------------------------------------------------
   *  No loops: the Shuffler
   * -------------------------------------------------------------------- */
  var XF_IN = new Float32Array(17), XF_OUT = new Float32Array(17);
  for (var xi = 0; xi < 17; xi++) { XF_IN[xi] = Math.sin(Math.PI / 2 * xi / 16); XF_OUT[xi] = Math.cos(Math.PI / 2 * xi / 16); }

  /** An equal-power fade of `param` from 0 up to `g` (or, `out`, from g down to 0) over [t, t + d]. */
  function xfade(param, t, d, g, out) {
    var c = new Float32Array(17), src = out ? XF_OUT : XF_IN;
    for (var i = 0; i < 17; i++) c[i] = src[i] * g;
    try { param.setValueCurveAtTime(c, t, d); } catch (e) {
      param.setValueAtTime(out ? g : 0, t);                  // where curves are not to be had: a straight line
      param.linearRampToValueAtTime(out ? 0 : g, t + d);
    }
  }

  /**
   * Plays a bed as an endless chain of short segments from random places in
   * it, each crossfaded into the next with equal power, each at a slightly
   * different speed and level: the texture never comes round the same way.
   * `pump(t, horizon)` keeps the chain scheduled `horizon` s ahead; without a
   * buffer (still being made) it is silent. `park()` hands over to the whole
   * bed on a loop, which needs no more scheduling (a hidden page may run no
   * script); `pump` takes the chain back. `cut(t)` stops it at t.
   *   o: { min, max: segment length (s); xf: crossfade (s); rate: ± speed;
   *        jit: σ of its level (log); pitch(): the speed it centres on }
   */
  function Shuffler(ctx, dest, o) {
    this.ctx = ctx; this.dest = dest; this.o = o; this.buf = null;
    this.next = 0; this.lastOff = -10; this.segs = []; this.loop = null;
  }
  Shuffler.prototype.pump = function (t, horizon) {
    var o = this.o, buf = this.buf, segs = this.segs;
    if (!buf) return;
    if (this.loop) this._unpark(t);
    if (this.next < t) this.next = t;
    while (segs.length && segs[0].end < t) segs.shift();
    var D = buf.duration, xf = o.xf;
    for (var n = 0; this.next < t + horizon && n < 8; n++) {
      var d = o.min + (o.max - o.min) * rnd(), rate = o.pitch() * (1 + o.rate * (2 * rnd() - 1));
      var need = (d + 2 * xf) * rate + 0.02, off, tries = 0;
      do { off = rnd() * (D - need); } while (Math.abs(off - this.lastOff) < 1.0 && ++tries < 4);
      this.lastOff = off;
      var g = Math.exp(o.jit * (rnd() + rnd() + rnd() - 1.5) * 2), a = this.next;
      var s = this.ctx.createBufferSource(), e = this.ctx.createGain();
      s.buffer = buf;
      s.playbackRate.value = rate;
      e.gain.value = 0;
      xfade(e.gain, a, xf, g, false);
      xfade(e.gain, a + xf + d, xf, g, true);
      s.connect(e); e.connect(this.dest);
      s.start(a, off);
      s.stop(a + d + 2 * xf + 0.02);
      segs.push({ s: s, end: a + d + 2 * xf + 0.02 });
      this.next = a + xf + d;
    }
  };
  Shuffler.prototype.cut = function (t) {
    for (var i = 0; i < this.segs.length; i++) { try { this.segs[i].s.stop(t); } catch (e) {} }
    this.segs.length = 0;
    this.next = 0;
    if (this.loop) { try { this.loop.s.stop(t); } catch (e2) {} this.loop = null; }
  };
  Shuffler.prototype.park = function (t) {
    if (!this.buf || this.loop) return;
    var a = this.next > t ? this.next : t, s = this.ctx.createBufferSource(), e = this.ctx.createGain();
    s.buffer = this.buf; s.loop = true;
    s.playbackRate.value = this.o.pitch();
    e.gain.value = 0;
    xfade(e.gain, a, this.o.xf, 1, false);                   // as the chain's last segment fades out
    s.connect(e); e.connect(this.dest);
    s.start(a, rnd() * this.buf.duration);
    this.loop = { s: s, e: e, at: a };
  };
  Shuffler.prototype._unpark = function (t) {
    var l = this.loop, xf = this.o.xf, a = l.at + xf > t ? l.at + xf : t;
    this.loop = null;
    try { l.e.gain.cancelScheduledValues(a); } catch (e) {}
    xfade(l.e.gain, a, xf, 1, true);
    try { l.s.stop(a + xf + 0.02); } catch (e2) {}
    this.next = a;                                            // the chain comes back in as the loop fades
  };

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
   * glide (real bubbles rise by a few percent, not by octaves) and the
   * random part of each bubble's loudness is capped at three times its
   * median, so nothing stands out enough to be noticed coming round again.
   *
   * Both ears hear the same bubbles: each channel is rendered from the same
   * seed, every event panned and the far ear delayed by up to 0.3 ms. The
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
    var m = Math.min(n, Math.ceil(cr / fc * 2)), raw = new Float32Array(n + m), out = new Float32Array(n), i;
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
    cap: 3,                                   // a bubble's random loudness: at most 3× its median
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

  /**
   * Work in steps: returns a function that runs the next step and returns
   * itself, until the last step returns the result. One step per idle slice.
   */
  function steps(list) {
    var k = 0;
    return function next() {
      var r = list[k++]();
      return k < list.length ? next : r;
    };
  }

  /** One channel of the brook's flow: the current, its body, fizz and babble. */
  function rawBrookFlow(sr, seconds, ch, seed) {
    var n = Math.floor(sr * seconds), nc = Math.round(seconds * WATER.cr);
    var rE = mulberry32(seed * 7919 + 13);                      // shared by both ears
    var rC = mulberry32(seed * 104729 + 31 + ch * 977);         // this ear's own
    var swell = ctrlCurve(rE, nc, 0.5, WATER.cr), out = new Float32Array(n);
    function current(B, salt) {
      var x = waterBed(sr, n, nc, B, swell, mulberry32(seed * 31 + salt), rC);
      for (var i = 0; i < n; i++) out[i] += B.gain * x[i];
    }
    return steps([
      function () { current(WATER.bed, 101); },
      function () { current(WATER.body, 202); },
      function () { waterBubbles(out, sr, seconds, nc, WATER.fizz, swell, rE, ch); },
      function () { waterBubbles(out, sr, seconds, nc, WATER.babble, swell, rE, ch); return level(out, WATER.rmsFlow); }
    ]);
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
    var fine = [], heavy = [], out, i;
    for (i = 0; i < 18; i++) fine.push(synthDrop(sr, 1800 + rnd() * 3400, 1.2 + rnd(), 0.0003 + rnd() * 0.0004));
    for (i = 0; i < 10; i++) heavy.push(synthDrop(sr, 700 + rnd() * 1000, 1.6 + rnd() * 1.4, 0.0015 + rnd() * 0.0025));
    return steps([
      function () { out = level(rawWash(sr, seconds, 900, 5500), 0.022); },
      function () { var a = rawBed(sr, seconds, fine, 520); for (i = 0; i < out.length; i++) out[i] += a[i] * 0.42; },
      function () {
        var b = rawBed(sr, seconds, heavy, 14);
        for (i = 0; i < out.length; i++) out[i] += b[i] * 0.85;
        return level(out, 0.075);
      }
    ]);
  }

  /*
   * Each ambience is one or more seamless loops, played together. `make(sr,
   * seconds, ch, seed)` renders one channel; both channels get the same seed.
   * It may return a function instead: the rest of the work, a step per call.
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
    this._prepK = 0;          // the next PREP step…
    this._job = null;         // …or the rest of the one under way
    this.onstate = null;      // callback(stateString)
    // ---- the sand ----------------------------------------------------------
    this._flowSlow = 0;       // the flow, slowly: its breathing is heard against this
    this._flowOn = false;
    this._evRate = 0;         // impact events / s, smoothed
    this._grain = 1;          // how strongly the stream's grains land (by character)
    this._wander = 0;         // where in front they land, drifting
    this._slF = 0; this._slS = 0;                 // slides, quickly and slowly: a surge is an avalanche
    this._slumpT = -1e9; this._slumpGap = 2;
    this._pourOU = 0; this._pourOU2 = 0;          // the pour's random flutter
    this._tg = {};            // target level of each bed, by shuffler key…
    this._td = {};            // …how long its fade to silence takes (s)…
    this._cutAt = {};         // …and when it was stopped, once silent
    // ---- the glass in hand -----------------------------------------------
    this.cracked = 'intact';  // 'intact' | 'cracked' | 'mended': how the vessel rings
    this._crF = 1;            // mode frequency × for that state
    this._crQ = 1;            // mode Q × for that state
    this._fill = 0;           // last fill seen by update()
    this._agit = 0;           // agitation (0–3) behind the shaker shimmer
    this._leakPan = 0;
    // Poisson streams of grains: leaking out through a chip, landing on the desk.
    // `ring` holds the last `cap` arrivals, so no second ever hears more.
    this._leakS = { kind: 0, next: 0, cap: 40, head: 0, ring: new Float64Array(40) };
    this._spillS = { kind: 1, next: 0, cap: 20, head: 0, ring: new Float64Array(20) };
    // rate limits of the one-shots: the last time each played (context time)
    this._thumpT = new Float64Array(2);           // one per bulb
    this._clackT = new Float64Array(12);          // the last 12 clacks
    this._growT = new Float64Array(4);            // the last 4 crack growths
    this._clackHead = 0; this._growHead = 0;
    this._last1 = { clack: 0, creak: 0, crack: 0, chip: 0, catchThud: 0, mended: 0, newGlass: 0 };   // set below
    this._hum = null;         // the mend hum while a finger holds the glass
    this._resetRates();
  }

  /** Forget every rate limit (a new context starts its clock at 0). */
  HourglassAudio.prototype._resetRates = function () {
    var k;
    for (k = 0; k < 2; k++) this._thumpT[k] = -1e9;
    for (k = 0; k < 12; k++) this._clackT[k] = -1e9;
    for (k = 0; k < 4; k++) this._growT[k] = -1e9;
    for (k = 0; k < 40; k++) this._leakS.ring[k] = -1e9;
    for (k = 0; k < 20; k++) this._spillS.ring[k] = -1e9;
    for (k in this._last1) this._last1[k] = -1e9;
    this._leakS.next = 0; this._spillS.next = 0;
  };

  /* ---------------------------------------------------------------- *
   *  Source material, synthesised in small slices
   *
   *  First what every sound needs (the noises, the single grains: a few
   *  milliseconds), then the beds. A step may return a function: the rest
   *  of its work, a short stretch per call.
   * ---------------------------------------------------------------- */
  var PREP = [
    // brown noise for the thuds and taps
    function (r) { r.brownL = rawNoise(PRE_SR, 4.1, 'brown'); },
    function (r) { r.brown = fill([r.brownL, rawNoise(PRE_SR, 4.1, 'brown')], PRE_SR); delete r.brownL; },
    function (r) { r.rng = mulberry32(SAND_SEED); r.mbS = microBank(r.rng, PRE_SR, 'sand', 48); },
    function (r) { r.mbG = microBank(r.rng, PRE_SR, 'glass', 32); },
    function (r) {
      r.pats = [];
      for (var i = 0; i < 32; i++) r.pats.push(fill([synthPat(r.rng, PRE_SR, (i + r.rng()) / 32)], PRE_SR));
    },
    function (r) {
      r.tinks = [];
      for (var i = 0; i < 24; i++) r.tinks.push(fill([synthTink(r.rng, PRE_SR, (i + r.rng()) / 24)], PRE_SR));
    }
  ];
  var PREP_ESSENTIAL = PREP.length;           // what the graph cannot be built without
  // pink noise for the air a turning glass cuts and the mend's hum (wanted a little later)
  PREP.push(function (r) { r.pinkL = rawNoise(PRE_SR, 3.1, 'pink'); });
  PREP.push(function (r) { r.pink = fill([r.pinkL, rawNoise(PRE_SR, 3.1, 'pink')], PRE_SR); delete r.pinkL; r.fresh = 'pink'; });
  ['sand', 'glass'].forEach(function (key) {
    PREP.push(function (r) {
      var B = BEDS[key], job = grainBed(r.rng, PRE_SR, r[B.bank], B);
      return function next() {
        var res = job();
        if (typeof res === 'function') { job = res; return next; }
        r[key] = res;
        r.fresh = key;                        // for the graph, once there is one
        return null;
      };
    });
  });

  /**
   * Run the preparation for about `budget` ms (at least one stretch of it);
   * true while there is more to do.
   */
  HourglassAudio.prototype._prepSlice = function (budget) {
    var t0 = now(), raw = this._raw;
    for (;;) {
      if (this._job) this._job = this._job() || null;
      else if (this._prepK < PREP.length) {
        var r = PREP[this._prepK++](raw);
        this._job = typeof r === 'function' ? r : null;
      }
      if (raw.fresh) { var k = raw.fresh; raw.fresh = null; if (this.ready) this._bedReady(k); }
      if (!this._job && this._prepK >= PREP.length) {
        delete raw.mbS; delete raw.mbG; delete raw.rng;       // the beds are made: let the grains go
        return false;
      }
      if (now() - t0 >= budget) return true;
    }
  };

  /**
   * Optional: call some time after load. Synthesises the sand a slice at a
   * time (a few milliseconds each) while the page is idle, so the first
   * touch stays instant. If the graph is built first, it goes on by itself.
   */
  HourglassAudio.prototype.prepare = function () {
    var self = this;
    if (!AC || this._prepTimer || (this._prepK >= PREP.length && !this._job)) return;
    (function next() {
      self._prepTimer = 0;
      if (self._prepSlice(5)) { self._prepTimer = setTimeout(next, 20); return; }
      // then the chosen ambience, so a first touch with it saved stays instant too
      if (self.ambience !== 'none') self._synthAmbience(self.ambience);
    })();
  };
  /** Finish the first `upto` steps of the preparation (all, if left out) at once. */
  HourglassAudio.prototype._finishPrep = function (upto) {
    var end = upto == null ? PREP.length : upto;
    // a step under way is number _prepK − 1
    while (this._prepK < end || (this._job && this._prepK <= end)) this._prepSlice(0);
    if (!this._job && this._prepK >= PREP.length && this._prepTimer) { clearTimeout(this._prepTimer); this._prepTimer = 0; }
  };

  HourglassAudio.CHARACTERS = CHARACTERS;
  HourglassAudio.AMBIENCES = AMBIENCES;
  // The synthesis itself, for offline tests and measurement.
  HourglassAudio._synth = { microBank: microBank, grainBed: grainBed, limitPeaks: limitPeaks, synthPat: synthPat,
                            synthTink: synthTink, mulberry32: mulberry32, BEDS: BEDS, PRE_SR: PRE_SR, SEED: SAND_SEED };

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
    var ctx = this.ctx, i, self = this;
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
    this.gModal = G(0); this.gBody = G(0); this.gFoley = G(0.9); this.gChime = G(1);
    this.gWhisper.connect(this.bus); this.gTicks.connect(this.bus);
    this.gBeds.connect(this.bus); this.gModal.connect(this.bus); this.gBody.connect(this.bus);
    this.gFoley.connect(this.bus); this.gChime.connect(this.bus);
    this.chimeWet = G(0.55); this.gChime.connect(this.chimeWet); this.chimeWet.connect(this.conv);

    // ---- source material: what every sound needs now (a few ms if
    //      prepare() has not made it yet); the beds as they are made ------
    this._finishPrep(PREP_ESSENTIAL);
    var raw = this._raw;
    this.pink = null;                       // (with the air, below, as soon as it is made)
    this.brown = asBuffer(ctx, raw.brown, PRE_SR);
    this.tinks = []; this.pats = [];
    for (i = 0; i < raw.tinks.length; i++) this.tinks.push(asBuffer(ctx, raw.tinks[i], PRE_SR));
    for (i = 0; i < raw.pats.length; i++) this.pats.push(asBuffer(ctx, raw.pats[i], PRE_SR));
    delete raw.brown; delete raw.tinks; delete raw.pats;
    // A fifth of a second of white noise, for the glass's own clicks and
    // snaps. Seeded, so the crack's snap (always the same stretch of it) has
    // the same peak every time; the other clicks start anywhere in it.
    var wn = new Float32Array(Math.floor(PRE_SR * 0.2)), wr = mulberry32(0x9e3779b9);
    for (i = 0; i < wn.length; i++) wn[i] = wr() * 2 - 1;
    this.white = toBuffer(ctx, [wn], PRE_SR);

    // ---- the vessel: the glass's own resonances -------------------------
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
    // ---- the hollow body of the bulb under the sand ---------------------
    this.bodyIn = G(1);
    var bodyOut = G(2.6);
    this.bodyModes = [];
    for (i = 0; i < MODES_BODY.length; i++) {
      var bb = BQ('bandpass', MODES_BODY[i][0], MODES_BODY[i][1]), bg = G(MODES_BODY[i][2]);
      this.bodyIn.connect(bb); bb.connect(bg); bg.connect(bodyOut);
      this.bodyModes.push(bb);
    }
    bodyOut.connect(this.gBody);

    // ---- the sand as it lands: its hush, and its crackle -----------------
    // A shelf follows the fall: a little less air as the pile rises.
    this.sandBus = G(1); this.bedShelf = BQ('highshelf', 5200, null, 0);
    this.sandBus.connect(this.bedShelf); this.bedShelf.connect(this.gWhisper);
    this.crkBus = G(1); this.crkShelf = BQ('highshelf', 5200, null, 0);
    this.crkBus.connect(this.crkShelf); this.crkShelf.connect(this.gBeds);
    this.gHushS = G(0); this.gHushG = G(0); this.gCrkS = G(0); this.gCrkG = G(0);
    this.gHushS.connect(this.sandBus); this.gHushG.connect(this.sandBus);
    this.gCrkS.connect(this.crkBus); this.gCrkG.connect(this.crkBus);
    // a bed has four channels: its hush to one level, its crackle to another
    var split = function (hush, crk) {
      var sp = ctx.createChannelSplitter(4), mh = ctx.createChannelMerger(2), mc = ctx.createChannelMerger(2);
      sp.connect(mh, 0, 0); sp.connect(mh, 1, 1); sp.connect(mc, 2, 0); sp.connect(mc, 3, 1);
      mh.connect(hush); mc.connect(crk);
      return sp;
    };
    // …or all four into two: hush and crackle together (the pour), or the hush alone
    // (the slide: thousands of grains rubbing past each other, smooth, no landings)
    var both = function (dest, v, hushOnly) {
      var m = G(v);
      m.channelCount = 2; m.channelCountMode = 'explicit'; m.channelInterpretation = hushOnly ? 'discrete' : 'speakers';
      m.connect(dest);
      return m;
    };
    this.gSlump = G(1); this.gSlump.connect(this.sandBus);          // avalanches down the pile
    // the dense grain textures of old are the crackle now (hush() and the tests read these)
    this.patEnv = this.gCrkS; this.tinkEnv = this.gCrkG;
    // how much of it rings the vessel (by character), and the body
    this.wSend = G(0); this.bedShelf.connect(this.wSend); this.wSend.connect(this.modalIn);
    this.cSend = G(0); this.crkShelf.connect(this.cSend); this.cSend.connect(this.modalIn);
    var bH = G(0.05); this.bedShelf.connect(bH); bH.connect(this.bodyIn);

    // ---- grains you can tell apart -------------------------------------
    this.tickBus = G(1);
    this.tickBus.connect(this.gTicks);
    this.tSend = G(0); this.tickBus.connect(this.tSend); this.tSend.connect(this.modalIn);
    var bT = G(1.3); this.tickBus.connect(bT); bT.connect(this.bodyIn);
    // each grain is panned on its own; off centre, the far ear hears it a hair later
    this.itdBus = [];
    for (i = -1; i <= 1; i++) {
      var ib = G(1);
      if (i && ctx.createStereoPanner && ctx.createChannelSplitter && ctx.createChannelMerger) {
        var spl = ctx.createChannelSplitter(2), mrg = ctx.createChannelMerger(2), dl = ctx.createDelay(0.001);
        dl.delayTime.value = 0.00006;
        ib.connect(spl);
        if (i > 0) { spl.connect(dl, 0); dl.connect(mrg, 0, 0); spl.connect(mrg, 1, 1); }
        else { spl.connect(mrg, 0, 0); spl.connect(dl, 1); dl.connect(mrg, 0, 1); }
        mrg.connect(this.tickBus);
      } else ib.connect(this.tickBus);
      this.itdBus.push(ib);
    }

    // ---- foley ------------------------------------------------------------
    // pour: fresh sand poured in from above, a fuller, cascading rush
    this.pBP = BQ('bandpass', 2600, 0.7);
    this.pEnv = G(0);
    this.pBP.connect(this.pEnv); this.pEnv.connect(this.gFoley);
    this.sP = G(0); this.pEnv.connect(this.sP); this.sP.connect(this.modalIn);
    // rush: thousands of grains sliding over glass (flip, avalanches)
    this.rBP = BQ('bandpass', 1500, 0.8);
    this.rEnv = G(0);
    this.rPan = pan(0);
    this.rBP.connect(this.rEnv);
    this.rEnv.connect(this.rPan); this.rPan.connect(this.gFoley);
    this.sR = G(0); this.rEnv.connect(this.sR); this.sR.connect(this.modalIn);
    // air: the glass cutting the air as it turns or spins, before the sand moves
    this.aBP = BQ('bandpass', 520, 0.9);
    this.aEnv = G(0);
    this.aPan = pan(0);
    this._airLoop = function () { loop(self.pink, 0.47).connect(self.aBP); };
    this.aBP.connect(this.aEnv);
    this.aEnv.connect(this.aPan); this.aPan.connect(this.gFoley);

    // every bed plays through a Shuffler: no loop is ever heard
    var bedRate = function () { return self._bedRate || 1; };
    var at = function (v) { return function () { return v; }; };
    var BED = { min: 0.45, max: 1.4, xf: 0.05, rate: 0.04, jit: 0.08, pitch: bedRate };
    var FOL = { min: 0.3, max: 0.9, xf: 0.04, rate: 0.04, jit: 0.15 };
    var fol = function (v) { var o = {}, k; for (k in FOL) o[k] = FOL[k]; o.pitch = at(v); return o; };
    this.shuf = {
      S: new Shuffler(ctx, split(this.gHushS, this.gCrkS), BED), G: new Shuffler(ctx, split(this.gHushG, this.gCrkG), BED),
      P: new Shuffler(ctx, both(this.pBP, 0.24), fol(0.95)), R: new Shuffler(ctx, both(this.rBP, 0.085, true), fol(0.72))
    };
    this._shufBed = { S: 'sand', G: 'glass', P: 'sand', R: 'sand' };
    this.beds = {};
    this._tg = {}; this._td = {}; this._cutAt = {};

    // ---- outside the glass ----------------------------------------------
    // Spilled grains landing on the desk: no vessel to excite, so this bus
    // bypasses the modal bank. Its level follows the character's grains.
    this.spillBus = G(0);
    this.spillBus.connect(this.gFoley);
    this._resetRates();

    // ---- ambience: an optional layer behind the sand ----------------------
    // It bypasses the character's tone shaping (a dune should not muffle a brook).
    this.ambBus = G(0);
    this.ambBus.connect(this.comp);
    var aW = G(0.12); this.ambBus.connect(aW); aW.connect(this.conv);

    this.ready = true;
    for (var key in BEDS) if (raw[key]) this._bedReady(key);
    if (raw.pink) this._bedReady('pink');
    // the rest still to come, a slice at a time, starting after this tap
    if (this._prepK < PREP.length || this._job) setTimeout(function () { self.prepare(); }, 0);
    if (this.ambience !== 'none') this._loadAmbience(this.ambience);
    this._applyCharacter(0.01);
    this._applyMaster();
  };

  /** Material is made: wrap it for playing and hand it on (a bed to its shufflers, the pink noise to the air). */
  HourglassAudio.prototype._bedReady = function (key) {
    var raw = this._raw[key];
    if (!raw || !this.ready) return;
    var buf = asBuffer(this.ctx, raw, PRE_SR);
    delete this._raw[key];
    if (key === 'pink') { this.pink = buf; this._airLoop(); return; }
    this.beds[key] = buf;
    for (var k in this._shufBed) if (this._shufBed[k] === key) this.shuf[k].buf = buf;
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
    var c = CHARACTERS[this.character] || CHARACTERS.asmr, t = this.ctx.currentTime, i;
    var vs = c.vessel != null ? c.vessel : 1;
    tau = tau || 0.25;
    this.gWhisper.gain.setTargetAtTime(c.whisper, t, tau);
    this.gTicks.gain.setTargetAtTime(c.ticks, t, tau);
    this.gBeds.gain.setTargetAtTime(c.beds, t, tau);
    this.gModal.gain.setTargetAtTime(c.modal, t, tau);
    this.gBody.gain.setTargetAtTime(c.body || 0, t, tau);
    this.wet.gain.setTargetAtTime(c.room, t, tau);
    this.toneLow.gain.setTargetAtTime(c.low, t, tau);
    this.toneHigh.gain.setTargetAtTime(c.high, t, tau);
    this.toneLP.frequency.setTargetAtTime(c.lp, t, tau);
    // re-voice the vessel itself (a cracked or mended glass keeps its state)
    var modes = this._modes = c.modes || MODES;
    for (i = 0; i < this.modes.length; i++) {
      this.modes[i].Q.setTargetAtTime(modes[i][1] * this._crQ, t, tau);
      this.modeGains[i].gain.setTargetAtTime(modes[i][2], t, tau);
    }
    this._last.fill = undefined;                         // retune on the next update
    // what of the sand rings it
    this.wSend.gain.setTargetAtTime(c.send || 0, t, tau);
    this.cSend.gain.setTargetAtTime(0.05 * vs, t, tau);
    this.tSend.gain.setTargetAtTime(1.3 * vs, t, tau);
    this.sP.gain.setTargetAtTime(0.5 * vs, t, tau);
    this.sR.gain.setTargetAtTime(0.45 * vs, t, tau);
    this.spillBus.gain.setTargetAtTime(0.2 * c.ticks, t, tau);   // grains on the desk: very quiet
    this._tickRate = c.tick || 1;
    this._grain = c.grain || 1;
    this._shake = c.shake && c.beds ? c.shake / c.beds : 1;
    this._bedRate = c.bed || 1;
  };

  /**
   * 'intact' | 'cracked' | 'mended': how the vessel rings. May be called
   * before there is a context; the state is applied when the graph is built.
   */
  HourglassAudio.prototype.setCracked = function (state) {
    var v = GLASS_STATES[state];
    if (!v) return;
    this.cracked = state;
    this._crF = v[0];
    this._crQ = v[1];
    if (!this.ready) return;
    var t = this.ctx.currentTime, modes = this._modes, fill = this._fill, i;
    for (i = 0; i < this.modes.length; i++) {
      this.modes[i].Q.setTargetAtTime(modes[i][1] * this._crQ, t, 0.15);
      this.modes[i].frequency.setTargetAtTime(modes[i][0] * (1 + modes[i][3] * fill) * this._crF, t, 0.15);
    }
    for (i = 0; i < this.bodyModes.length; i++) {
      this.bodyModes[i].Q.setTargetAtTime(MODES_BODY[i][1] * this._crQ, t, 0.15);
      this.bodyModes[i].frequency.setTargetAtTime(MODES_BODY[i][0] * (1 + MODES_BODY[i][3] * fill) * this._crF, t, 0.15);
    }
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
  /** Run one channel of a layer to the end, at once. */
  function makeNow(L, ch, seed) {
    var r = L.make(L.sr, L.seconds, ch, seed);
    while (typeof r === 'function') r = r();
    return r;
  }
  /** Synthesise an ambience right now (blocking; for tests). Returns [L, R] per layer. */
  HourglassAudio.prototype._makeAmbience = function (id, seed) {
    var d = AMBIENCES[id], raw = this._ambRaw[id];
    if (!d || !d.layers || this._ambBuf[id]) return null;           // already wrapped for playing
    seed = seed || 1;
    if (!raw || raw.seed !== seed) {
      raw = this._ambRaw[id] = d.layers.map(function (L) { return [makeNow(L, 0, seed), makeNow(L, 1, seed)]; });
      raw.seed = seed;
    }
    return raw;
  };
  /**
   * Synthesise an ambience a step at a time, one short slice each, so the
   * page stays responsive, then call `done`. However often it is asked for,
   * each ambience is synthesised once.
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
      var r = job.step ? job.step() : L.make(L.sr, L.seconds, ch, job.seed);   // both ears: one seed
      job.step = typeof r === 'function' ? r : null;
      if (!job.step) {                                  // this channel is done
        if (!ch) job.out[li] = [];
        job.out[li][ch] = r;
        job.k++;
      }
      if (job.k < d.layers.length * 2) { setTimeout(next, 30); return; }
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
   *
   *    — optional, the glass in hand —
   *    agit      0 … 3 how agitated the sand is (sim.agitation())
   *    rushPan   −1 … 1 where the sliding sand is, as heard (−0.6·f_x/G of
   *              the fuller bulb, page frame); followed while not flipping
   *    thump     Float32Array(4) [E0, x0, E1, x1]: this frame's bed landings
   *              per bulb, energy and pan (sim.frame.thump), or null
   *    slam      Float32Array(2) [E, x]: sand slamming the far end, or null
   *    leak      grains / s escaping through a chip;  leakPan  −1 … 1
   *    spillPats grains / s landing on the desk below
   *  }
   * ---------------------------------------------------------------- */

  HourglassAudio.prototype.update = function (st) {
    if (!this.ready || this.ctx.state !== 'running') return;
    var ctx = this.ctx, t = ctx.currentTime;
    var dt = st.dt > 0 ? Math.min(st.dt, 0.1) : 0.016;
    // ---- ambience: on while the glass runs, even while it is being turned ---
    this._ambience(st.ambient != null ? st.ambient : st.running);

    // ---- the stream, and its breathing -----------------------------------
    // Heard against its own slow mean, the flow's swell lifts the whole sand.
    var flow = st.flow || 0, tail = st.tail >= 0 ? (st.tail < 1 ? st.tail : 1) : 1, on = flow > 0.4;
    if (on && !this._flowOn) this._flowSlow = flow;      // a stream that starts: no surge
    this._flowOn = on;
    this._flowSlow += (flow - this._flowSlow) * Math.min(1, dt / 2.5);
    // A long, slow timer still breathes softly; a short one is fuller.
    var lvl = on ? 0.34 + 0.66 * Math.pow(Math.min(1, flow / 320), 0.45) : 0, pulse = 1;
    if (on && this._flowSlow > 1) {
      pulse = Math.pow(flow / this._flowSlow, 0.9);
      pulse = pulse < 0.6 ? 0.6 : (pulse > 1.6 ? 1.6 : pulse);
    }

    // ---- bare glass ⇄ sand cushion --------------------------------------
    var cushTarget = Math.min(1, Math.pow((st.bottom || 0) / 900, 0.7));
    this._cushion += (cushTarget - this._cushion) * Math.min(1, dt * 3);
    var cushion = this._cushion, cs = Math.sqrt(cushion), cg = Math.sqrt(1 - cushion);

    // ---- the hush of the landing, and its crackle -------------------------
    // (more grains, not louder ones: the hush swells a little, the crackle less;
    // and it is the landing that is heard, so it waits for the first grains down)
    var imp = st.impacts || 0;
    var bed = lvl * Math.pow(pulse, 0.7) * tail * Math.min(1, imp / (0.5 * flow + 2));
    // (a faster stream is mostly a fuller hush: its crackle is denser, not louder;
    // the last few grains a second take it down to nothing)
    var dens = imp > 0 ? (0.5 + 0.5 * Math.sqrt(Math.min(1, imp / 300))) * Math.min(1, imp / 4) * Math.sqrt(pulse) * tail : 0;
    // Shaken, every grain rattles at once: the crackle rises to a floor set by
    // the agitation, a soft shaker shimmer, and settles back when it calms.
    var agit = st.agit > 0 ? (st.agit < 3 ? st.agit : 3) : 0;
    this._agit = agit;
    if (agit > 0) {
      var floor = 0.28 * Math.pow(agit, 1.5);
      floor = (floor < 0.45 ? floor : 0.45) * (this._shake || 1);
      if (floor > dens) dens = floor;
    }
    // (the first grains on bare glass: fewer, each one heard)
    this._beds(bed * cs, 0.55 * bed * cg, dens * cs, 0.5 * dens * cg, 0.12, 0.10);
    // a shorter fall as the pile rises: a little less air
    var fill = st.fill || 0;
    this._set('bri', this.bedShelf.gain, -3.5 * fill, 0.5);
    this._set('bri2', this.crkShelf.gain, -3.5 * fill, 0.5);
    this._set('slump', this.gSlump.gain, 1, 0.1);
    this._pump(t, 1.0, BED_KEYS);

    // ---- avalanches down the pile: when the slides surge, a soft slump --
    var sl0 = st.slides || 0;
    this._slF += (sl0 - this._slF) * Math.min(1, dt / 0.12);
    this._slS += (sl0 - this._slS) * Math.min(1, dt / 1.5);
    if (on && cushion > 0.3 && t - this._slumpT > this._slumpGap) {
      var surge = this._slS > 300 ? this._slF / this._slS - 1.1 : 0;
      if (surge > 0 || rnd() < dt * 0.05) {
        var sv = surge > 0 ? Math.min(1, surge / 0.25) : 0.3 * rnd();
        this._slumpT = t; this._slumpGap = 1.2 + 2.3 * rnd();
        this._slump(t + 0.01, (0.35 + 0.65 * sv) * lvl * tail, (rnd() < 0.5 ? -1 : 1) * (0.18 + 0.25 * rnd()));
      }
    }

    // ---- grains you can tell apart, straight from the physics -----------
    // A slow glass is heard grain by grain; a fast one keeps fewer of them,
    // each a little softer, and lets the hush carry the rest.
    var sim = st.sim, n = sim && sim.nev ? sim.nev : 0;
    this._evRate += (n / dt - this._evRate) * Math.min(1, dt * 3);
    // where they land wanders slowly (a random walk, 4 s memory, σ 0.06 of the pan)
    var kd = dt / 4;
    this._wander += 0.06 * Math.sqrt(2 * kd) * gauss(rnd) - this._wander * kd;
    if (n) {
      var r = this._evRate > 1 ? this._evRate : 1, keep = Math.min(r, 22 + 0.28 * r) / r;
      var soft = this._grain / Math.sqrt(1 + r / 150), take = n < 16 ? n : 16;
      for (var k = 0; k < take; k++) {
        if (rnd() > keep) continue;
        var e = n <= 16 ? k : (rnd() * n) | 0;
        var kind = sim.evK[e], v = sim.evV[e], x = sim.evX[e];
        var top = (kind & 2) !== 0;
        var glass = !top && ((kind & 1) === 0 || rnd() < Math.pow(1 - cushion, 1.5));
        var ln = softTop(0.55 * gauss(rnd), 0.55, 0.5);   // every grain its own size: log-normal
        var amp = (0.19 + 0.26 * Math.pow(v, 1.5)) * Math.exp(ln) * (top ? 0.55 : (glass ? 1.2 : 1)) * soft;
        // spread within the frame: Poisson arrivals, not a 60 Hz buzz
        var when = t + 0.004 + rnd() * dt;
        x = (x === x ? x : 0) + this._wander / 0.45;
        this._tick(when, glass, amp, x);
        if (rnd() < 0.15) this._tick(when + 0.0015 + 0.0045 * rnd(), glass, amp * (0.2 + 0.2 * rnd()), x);   // a rebound
      }
    }

    // ---- Layer 5: shaken, the bed lands and slams the far end -----------
    var th = st.thump;
    if (th) {
      if (th[0] > 0) this.thump(th[0], th[1], 0);
      if (th[2] > 0) this.thump(th[2], th[3], 1);
    }
    var slm = st.slam;
    if (slm && slm[0] > 0) this.clack(slm[0], slm[1]);
    // ---- Layer 5: grains trickling out of a chip, and landing on the desk ---
    var lp = st.leakPan;
    this._leakPan = lp > -1 ? (lp < 1 ? lp : 1) : (lp <= -1 ? -1 : 0);
    this._stream(this._leakS, st.leak > 0 ? (st.leak < 40 ? st.leak : 40) : 0, t + 0.004, dt);
    this._stream(this._spillS, st.spillPats > 0 ? (st.spillPats < 20 ? st.spillPats : 20) : 0, t + 0.004, dt);

    // ---- the air cavity shrinks as the lower bulb fills --------------------
    this._fill = fill;
    if (this._last.fill === undefined || Math.abs(this._last.fill - fill) > 0.004) {
      this._last.fill = fill;
      var md = this._modes, m;
      for (m = 0; m < this.modes.length; m++) {
        this.modes[m].frequency.setTargetAtTime(md[m][0] * (1 + md[m][3] * fill) * this._crF, t, 0.4);
      }
      for (m = 0; m < this.bodyModes.length; m++) {
        this.bodyModes[m].frequency.setTargetAtTime(MODES_BODY[m][0] * (1 + MODES_BODY[m][3] * fill) * this._crF, t, 0.4);
      }
    }

    // ---- Layer 4: pour ---------------------------------------------------
    // Sand poured in from above: the beds again, through a band that wanders
    // on two random (Ornstein–Uhlenbeck) flutters, 80 ms and 0.3 s, never a clock.
    if (st.pouring) {
      var kq = Math.min(1, dt / 0.08), kq2 = Math.min(1, dt / 0.3);
      this._pourOU += Math.sqrt(2 * kq) * gauss(rnd) - this._pourOU * kq;
      this._pourOU2 += Math.sqrt(2 * kq2) * gauss(rnd) - this._pourOU2 * kq2;
      this.pEnv.gain.setTargetAtTime(0.3 * Math.exp(0.25 * this._pourOU), t, 0.03);
      this.pBP.frequency.setTargetAtTime(2700 * Math.exp(0.18 * this._pourOU2), t, 0.08);
      this._last.pour = 1;
      this._tg.P = 1; this._td.P = 0.7;
    } else if (this._last.pour) {
      this._last.pour = 0;
      this.pEnv.gain.setTargetAtTime(0, t, 0.11);
      this._tg.P = 0;
    }
    this._pump(t, 1.0, POUR_KEYS);

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
    } else if (st.rushPan > -2 && st.rushPan < 2) {
      // the slosh moves between the ears with the sand it is made of
      panTo = st.rushPan < -0.65 ? -0.65 : (st.rushPan > 0.65 ? 0.65 : st.rushPan);
    }
    this._set('rush', this.rEnv.gain, rush * 0.5, rush > (this._last.rush || 0) ? 0.06 : 0.22);
    this._tg.R = rush > 0.002 ? 1 : 0; this._td.R = 1.4;
    this._pump(t, 1.0, RUSH_KEYS);

    // ---- air: a soft whoosh the moment the glass turns, two swells a turn ---
    var wv = st.spin || 0, air = wv < 0.35 ? 0 : Math.min(1, Math.pow((wv - 0.35) / 12, 0.75));
    var ang = st.angle || 0, sweep = 0.5 + 0.5 * Math.abs(Math.sin(ang));   // each bulb sweeping by
    this._set('air', this.aEnv.gain, air * sweep * 0.16, 0.035);
    if (air > 0.01) {
      this._set('airf', this.aBP.frequency, 360 + 1100 * air, 0.08);
      if (this.aPan.pan) this._set('airp', this.aPan.pan, Math.sin(ang) * 0.4, 0.05);
    }
    if (rush > 0.01) {
      this._set('rbp', this.rBP.frequency, 1100 + 2300 * rush, 0.12);
      if (this.rPan.pan) this._set('rpan', this.rPan.pan, panTo, 0.12);
    }
  };

  var BED_KEYS = ['S', 'G'], POUR_KEYS = ['P'], RUSH_KEYS = ['R'];

  /**
   * The beds' levels: the hush and the crackle, on sand and on glass, gliding
   * at tau h and c. Each bed's shuffler plays while either of its two does.
   */
  HourglassAudio.prototype._beds = function (hS, hG, cS, cG, h, c) {
    var tg = this._tg, td = this._td;
    tg.S = hS > cS ? hS : cS; tg.G = hG > cG ? hG : cG;
    td.S = td.G = 6 * (h > c ? h : c);                      // silent by then, to −50 dB
    this._set('hS', this.gHushS.gain, hS, h);
    this._set('hG', this.gHushG.gain, hG, h);
    this._set('cS', this.gCrkS.gain, cS, c);
    this._set('cG', this.gCrkG.gain, cG, c);
  };
  /**
   * Keep each shuffler that should sound scheduled `horizon` s ahead; one
   * that has gone quiet is stopped once its fade is over.
   */
  HourglassAudio.prototype._pump = function (t, horizon, keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], s = this.shuf[k];
      if (this._tg[k] > 1e-4) { s.pump(t, horizon); this._cutAt[k] = 0; }
      else if (!this._cutAt[k]) { this._cutAt[k] = t + (this._td[k] || 0.8); s.cut(this._cutAt[k]); }
    }
  };

  /** A soft slump of sand down the side of the pile, to one side. */
  HourglassAudio.prototype._slump = function (when, s, p) {
    var ctx = this.ctx, buf = this.beds.sand;
    if (!buf || !(s > 0)) return;
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), pn = this._panner(p);
    src.buffer = buf;
    src.playbackRate.value = 0.8 + 0.15 * rnd();
    f.type = 'bandpass'; f.frequency.value = 2600 * Math.pow(2, 1.2 * rnd()); f.Q.value = 0.6;
    g.gain.value = 0;
    var rise = 0.06 + 0.08 * rnd();
    g.gain.setTargetAtTime(1.1 * s, when, rise / 2.5);              // (its four channels meet in the panner: half each)
    g.gain.setTargetAtTime(0, when + rise + 0.1 * rnd(), 0.22 + 0.25 * rnd());
    src.connect(f); f.connect(g); g.connect(pn); pn.connect(this.gSlump);
    src.start(when, rnd() * (buf.duration - 2.6));
    src.stop(when + 2.4);
  };

  /**
   * Used while the page is hidden: hold a steady stream without physics.
   * The beds hand over to plain loops of themselves, which need no script
   * to go on (a hidden page may get none); the next update() takes them back.
   */
  HourglassAudio.prototype.hold = function (flow, tail) {
    if (!this.ready || this.ctx.state !== 'running') return;
    var t = this.ctx.currentTime, on = flow > 0.4, i;
    tail = tail >= 0 ? (tail < 1 ? tail : 1) : 1;
    var lvl = on ? (0.34 + 0.66 * Math.pow(Math.min(1, flow / 320), 0.45)) * tail : 0;
    var dens = flow > 0 ? (0.5 + 0.5 * Math.sqrt(Math.min(1, flow / 300))) * Math.min(1, flow / 4) * tail : 0;
    var c = this._cushion, cs = Math.sqrt(c), cg = Math.sqrt(1 - c);
    this._beds(lvl * cs, 0.55 * lvl * cg, dens * cs, 0.5 * dens * cg, 0.3, 0.3);
    for (i = 0; i < BED_KEYS.length; i++) {
      var k = BED_KEYS[i];
      if (this._tg[k] > 1e-4) { this.shuf[k].park(t); this._cutAt[k] = 0; }
      else if (!this._cutAt[k]) { this._cutAt[k] = t + this._td[k]; this.shuf[k].cut(this._cutAt[k]); }
    }
    this._set('rush', this.rEnv.gain, 0, 0.2);
    this._tg.R = 0;
    this._ambience(on);
    if (this._last.pour) { this._last.pour = 0; this.pEnv.gain.setTargetAtTime(0, t, 0.1); }
    this._tg.P = 0;
    this._pump(t, 0, POUR_KEYS);
    this._pump(t, 0, RUSH_KEYS);
    this._quietHand();                 // the textures above already left out the agitation
  };

  /** Glide every sand layer, and the ambience, to silence (pause, reset…). */
  HourglassAudio.prototype.hush = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._ambUntil = 0;
    this._ambience(false);
    this._beds(0, 0, 0, 0, 0.12, 0.1);
    this._set('slump', this.gSlump.gain, 0, 0.1);
    this._set('rush', this.rEnv.gain, 0, 0.2);
    if (this.aEnv) this._set('air', this.aEnv.gain, 0, 0.2);
    this.pEnv.gain.setTargetAtTime(0, t, 0.1);
    this._last.pour = 0;
    this._tg.P = this._tg.R = 0;
    this._pump(t, 0, BED_KEYS);
    this._pump(t, 0, POUR_KEYS);
    this._pump(t, 0, RUSH_KEYS);
    this._quietHand();
  };

  /**
   * The glass-in-hand layers fall silent too: no agitation floor, no more
   * trickle or desk pats scheduled, no mend hum. The next update() brings
   * back whatever the physics is still doing.
   */
  HourglassAudio.prototype._quietHand = function () {
    this._agit = 0;
    this._leakS.next = 0;
    this._spillS.next = 0;
    this.mendHum(0);
  };

  /**
   * A Poisson stream of grains in [t, t + span): arrivals carry over from
   * frame to frame, and the ring caps them at `cap` in any second. Nothing
   * is allocated: one stream object per kind lives for the engine's life.
   */
  HourglassAudio.prototype._stream = function (s, rate, t, span) {
    if (!(rate > 0)) { s.next = 0; return; }
    // (re)start without back-filling a gap (a hidden page, a long frame)
    if (s.next <= 0 || s.next < t - 0.05) s.next = t - Math.log(1 - rnd()) / rate;
    var end = t + span;
    for (var n = 0; s.next < end && n < 8; n++) {
      var when = s.next < t ? t : s.next;
      s.next += -Math.log(1 - rnd()) / rate;
      if (when - s.ring[s.head] < 1) continue;           // already `cap` in the last second
      s.ring[s.head] = when;
      s.head = (s.head + 1) % s.cap;
      if (s.kind === 0) this._leakPat(when);
      else this._spillPat(when);
    }
  };

  /** A grain escaping through the chip: fine sand rattling out past glass. */
  HourglassAudio.prototype._leakPat = function (when) {
    this._tick(when, false, 0.25 + 0.15 * rnd(), this._leakPan, 1.3);
  };

  /** A grain landing on the dune on the desk: outside the glass, very quiet. */
  HourglassAudio.prototype._spillPat = function (when) {
    var s = this.ctx.createBufferSource();
    s.buffer = this.pats[(rnd() * this.pats.length) | 0];
    s.playbackRate.value = 0.75 + rnd() * 0.2;
    s.connect(this.spillBus);
    s.start(when);
  };

  /* ---------------------------------------------------------------- *
   *  One grain hitting something
   * ---------------------------------------------------------------- */
  HourglassAudio.prototype._tick = function (when, glass, amp, x, rate) {
    var bank = glass ? this.tinks : this.pats;
    if (!bank || !bank.length) return;
    var ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = bank[(rnd() * bank.length) | 0];
    s.playbackRate.value = (glass ? (0.96 + rnd() * 0.08) * this._crF : 0.86 + rnd() * 0.28) * (this._tickRate || 1) * (rate || 1);
    g.gain.value = amp * (glass ? 1 : 0.8);
    s.connect(g);
    // where it fell, give or take: each grain its own place in a narrow cone in front
    var p = (x === x && x ? x : 0) * 0.45 + 0.16 * gauss(rnd);
    p = p < -0.6 ? -0.6 : (p > 0.6 ? 0.6 : p);
    if (ctx.createStereoPanner) {
      var pn = ctx.createStereoPanner();
      pn.pan.value = p;
      g.connect(pn); pn.connect(this.itdBus[p < -0.12 ? 0 : (p > 0.12 ? 2 : 1)]);
    } else g.connect(this.itdBus[1]);
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

  /* ---------------------------------------------------------------- *
   *  The glass in hand
   *
   *  Every one-shot plays only for something physical, is a no-op until
   *  the context runs, and limits its own rate. They use the existing
   *  buses and buffers; only short-lived nodes are made.
   * ---------------------------------------------------------------- */

  HourglassAudio.prototype._live = function () {
    return this.ready && this.ctx.state === 'running';
  };
  /** True (and remembered) if `key` last played at least `gap` s ago. */
  HourglassAudio.prototype._spaced = function (key, gap) {
    var t = this.ctx.currentTime;
    if (t - this._last1[key] < gap) return false;
    this._last1[key] = t;
    return true;
  };
  HourglassAudio.prototype._panner = function (p) {
    var ctx = this.ctx;
    if (!ctx.createStereoPanner) return ctx.createGain();
    var n = ctx.createStereoPanner();
    n.pan.value = p < -1 ? -1 : (p > 1 ? 1 : (p === p ? p : 0));
    return n;
  };
  /**
   * A burst of white noise `len` s long, high-passed at `hp` Hz, `gain` at
   * its peak, panned into the foley bus; `send` of it sets the glass ringing.
   * `from`: where in the noise to start (s), anywhere if left out.
   */
  HourglassAudio.prototype._click = function (when, len, hp, gain, pan, send, from) {
    var ctx = this.ctx;
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.white;
    f.type = 'highpass'; f.frequency.value = hp; f.Q.value = 0.7;
    var a = Math.min(0.0002, len * 0.25);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + a);
    g.gain.setValueAtTime(gain, when + len - a);
    g.gain.linearRampToValueAtTime(0, when + len);
    s.connect(f); f.connect(g);
    var p = this._panner(pan);
    g.connect(p); p.connect(this.gFoley);
    if (send) { var sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(this.modalIn); }
    s.start(when, from >= 0 ? from : rnd() * 0.15);
    s.stop(when + len + 0.002);
  };
  /** A short kick of noise straight into the modal bank: the vessel rings. */
  HourglassAudio.prototype._ring = function (when, gain) {
    var ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = this.white;
    g.gain.setValueAtTime(gain, when);
    g.gain.linearRampToValueAtTime(0, when + 0.001);
    s.connect(g); g.connect(this.modalIn);
    s.start(when, rnd() * 0.15);
    s.stop(when + 0.003);
  };

  /**
   * The sand bed lands on its end of the glass: a soft, low thump with a
   * little grain in it, and the vessel answering. E is the landing's
   * dimensionless energy (≈ 0.1 normal, 0.3 vigorous, 1 violent), pan −1 … 1,
   * bulb 0 upper, 1 lower: at most one per bulb every 60 ms.
   */
  HourglassAudio.prototype.thump = function (E, pan, bulb) {
    if (!this._live()) return;
    var s = E > 0 ? 1.3 * Math.sqrt(E) : 0;
    if (s > 1) s = 1;
    if (s < 0.05) return;
    var b = bulb ? 1 : 0, t = this.ctx.currentTime;
    if (t - this._thumpT[b] < 0.06) return;
    this._thumpT[b] = t;
    this._thumpAt(t + 0.004, s, pan === pan && pan ? pan : 0);
  };
  HourglassAudio.prototype._thumpAt = function (when, s, pan) {
    var ctx = this.ctx;
    var dur = 0.025 + 0.035 * s;                       // a bigger bed lands for longer
    var fc = 300 * (1 + 0.6 * (1 - s));                // …and lower
    var n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.brown;
    f.type = 'bandpass'; f.frequency.value = fc < 180 ? 180 : (fc > 700 ? 700 : fc); f.Q.value = 0.9;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.16 * Math.pow(s, 0.8), when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.002, dur / 3);
    var p = this._panner(0.6 * pan), send = ctx.createGain();
    send.gain.value = 0.3 * s;
    n.connect(f); f.connect(g); g.connect(p); p.connect(this.gFoley);
    g.connect(send); send.connect(this.modalIn);       // the vessel answers
    n.start(when, rnd() * 3); n.stop(when + dur + 0.1);
    for (var k = 2 + ((rnd() * 3) | 0); k > 0; k--) {  // and a few grains in it
      this._tick(when + rnd() * 0.012, false, (0.3 + 0.2 * rnd()) * s, pan);
    }
  };

  /**
   * Sand slamming the far end of the glass: glassier than a landing, a
   * cluster of tinks and a hard ring of the vessel. ≤ 12 a second, ≥ 70 ms apart.
   */
  HourglassAudio.prototype.clack = function (E, pan) {
    if (!this._live()) return;
    var s = E > 0 ? 1.3 * Math.sqrt(E) : 0;
    if (s > 1) s = 1;
    if (s < 0.05) return;
    var t = this.ctx.currentTime;
    if (t - this._last1.clack < 0.07 || t - this._clackT[this._clackHead] < 1) return;
    this._last1.clack = t;
    this._clackT[this._clackHead] = t;
    this._clackHead = (this._clackHead + 1) % 12;
    this._clackAt(t + 0.004, s, pan === pan && pan ? pan : 0);
  };
  HourglassAudio.prototype._clackAt = function (when, s, pan) {
    for (var k = 3 + ((rnd() * 4) | 0); k > 0; k--) {
      this._tick(when + rnd() * 0.008, true, (0.4 + 0.3 * rnd()) * s, pan);
    }
    this._ring(when, 3 * s);
  };

  /**
   * The glass under strain: `level` (1–4) tiny ticks, like a cooling glass,
   * each a 1.2 ms high hiss that sets the vessel ringing. One call per 300 ms.
   */
  HourglassAudio.prototype.creak = function (level, pan) {
    if (!this._live() || !this._spaced('creak', 0.3)) return;
    var n = level | 0;
    n = n < 1 ? 1 : (n > 4 ? 4 : n);
    var when = this.ctx.currentTime + 0.004;
    pan = (pan === pan && pan ? pan : 0) * 0.6;          // a site on the glass, not at the ear
    for (var k = 0; k < n; k++) {
      this._creakAt(when, (0.03 + 0.02 * rnd()) * LEVEL.tick, pan);
      when += 0.035 + 0.055 * rnd();
    }
  };
  HourglassAudio.prototype._creakAt = function (when, gain, pan) {
    this._click(when, 0.0012, 5000, gain, pan, 0.8);
  };

  /**
   * The glass cracks: a bright snap, the whole vessel ringing, a faint knock
   * of its body, then the small ticks of the glass settling round the new
   * crack. Surprising, never alarming: well below the bowl.
   */
  HourglassAudio.prototype.crack = function (pan) {
    if (!this._live() || !this._spaced('crack', 0.25)) return;
    var t = this.ctx.currentTime + 0.004;
    pan = (pan === pan && pan ? pan : 0) * 0.6;
    this._click(t, 0.003, 2000, 0.3 * LEVEL.crack, pan, 0, 0.05);   // the snap
    this._ring(t, 3 * LEVEL.crack);                              // the vessel rings, 0.3–0.6 s
    this._thud(t, 0.22 * LEVEL.crack, 1.7);                      // the body of the glass
    var n = 6 + ((rnd() * 3) | 0);                               // and it settles
    for (var k = 0; k < n; k++) {
      var u = k / (n - 1);
      var when = t + 0.12 * Math.pow(15, u) * (0.9 + 0.2 * rnd());   // 0.12 … 1.8 s, spaced exponentially
      this._click(when, 0.0006, 3000, 0.05 * Math.pow(0.3, u) * LEVEL.tick, pan, 0.5);   // 0.05 → 0.015
    }
  };

  /** The crack grows: 2–5 tiny clicks in 40 ms, like ice settling. ≤ 4 a second. */
  HourglassAudio.prototype.crackGrow = function (pan) {
    if (!this._live()) return;
    var t = this.ctx.currentTime;
    if (t - this._growT[this._growHead] < 1) return;
    this._growT[this._growHead] = t;
    this._growHead = (this._growHead + 1) % 4;
    pan = (pan === pan && pan ? pan : 0) * 0.6;
    for (var k = 2 + ((rnd() * 4) | 0); k > 0; k--) {
      this._click(t + 0.004 + rnd() * 0.04, 0.0003 + 0.0005 * rnd(), 3000, (0.02 + 0.02 * rnd()) * LEVEL.tick, pan, 0.4);
    }
  };

  /** A chip breaks out (a breach, or one that widens): a tink and a little rattle. */
  HourglassAudio.prototype.chip = function (pan) {
    if (!this._live() || !this._spaced('chip', 0.08)) return;
    var t = this.ctx.currentTime + 0.004;
    pan = pan === pan && pan ? pan : 0;
    this._tick(t, true, 0.6, pan);
    for (var k = 0; k < 4; k++) this._tick(t + 0.008 + k * 0.013 + rnd() * 0.008, false, 0.3 + 0.15 * rnd(), pan);
  };

  /** A finger stops a spinning glass: a soft felt stop. */
  HourglassAudio.prototype.catchThud = function () {
    if (!this._live() || !this._spaced('catchThud', 0.1)) return;
    this._thud(this.ctx.currentTime + 0.004, 0.3, 1.1);
  };

  /**
   * While a finger holds a cracked glass still and gold flows into the
   * crack, the glass hums under it. p 0 … 1 is the mend's progress; 0 stops.
   */
  HourglassAudio.prototype.mendHum = function (p) {
    if (!this.ready) return;
    var ctx = this.ctx, t = ctx.currentTime, h = this._hum;
    p = p > 0 ? (p < 1 ? p : 1) : 0;
    if (p > 0 && ctx.state === 'running' && this.pink) {      // (the pink noise is made just after the first tap)
      if (!h) {
        h = this._hum = { src: ctx.createBufferSource(), g: ctx.createGain() };
        h.src.buffer = this.pink; h.src.loop = true;
        h.g.gain.value = 0;
        h.src.connect(h.g); h.g.connect(this.modalIn);
        h.src.start(t, rnd() * this.pink.duration * 0.5);
      }
      h.g.gain.setTargetAtTime(0.02 * LEVEL.hum * p, t, 0.1);
    } else if (h) {
      this._hum = null;
      h.g.gain.setTargetAtTime(0, t, 0.1);
      setTimeout(function () {
        try { h.src.stop(); } catch (e) {}
        try { h.g.disconnect(); } catch (e2) {}
      }, 800);
    }
  };

  /** Mended: a small bell. Feedback for an action, so it plays even with the bowl off. */
  HourglassAudio.prototype.mended = function () {
    if (!this._live() || !this._spaced('mended', 0.3)) return;
    this._bell(this.ctx.currentTime + 0.03, 698.46, 0.06, 0.6);     // F5
  };

  /** A fresh glass after a cracked or mended one: one soft, clear ring. */
  HourglassAudio.prototype.newGlass = function () {
    if (!this._live() || !this._spaced('newGlass', 0.3)) return;
    var ctx = this.ctx, t = ctx.currentTime + 0.01;
    var s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = this.tinks[(rnd() * this.tinks.length) | 0];
    s.playbackRate.value = 0.92 + rnd() * 0.1;
    g.gain.value = 0.7;
    s.connect(g); g.connect(this.modalIn);
    s.start(t);
  };

  /**
   * End of timer: a warm singing-bowl bloom. Inharmonic partials, each a
   * slowly beating pair, soft attack (no mallet), ≈5 s natural decay.
   */
  HourglassAudio.prototype.chime = function (delay) {
    if (!this.ready || !this.chimeEnabled || this.ctx.state !== 'running') return;
    this._bell(this.ctx.currentTime + (delay || 0) + 0.03, 349.23, 0.12, 1);   // F4: warm, yet audible on small phone speakers
  };

  /** The bowl's partials at f0, `level` out, each decay × `decay`. */
  HourglassAudio.prototype._bell = function (t0, f0, level, decay) {
    var ctx = this.ctx;
    //            ratio  level  decay τ  attack
    var parts = [[1.00, 1.00, 1.25, 0.16],
                 [2.00, 0.07, 0.95, 0.12],
                 [2.74, 0.40, 0.85, 0.09],
                 [5.18, 0.15, 0.50, 0.05],
                 [8.05, 0.045, 0.30, 0.03]];
    var out = ctx.createGain(), end = t0 + 8.5 * decay;
    out.gain.value = level;
    out.connect(this.gChime);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      for (var side = -1; side <= 1; side += 2) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f0 * p[0] * (1 + side * 0.0013);   // slow beating
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(p[1] * 0.5, t0 + p[3]);
        g.gain.setTargetAtTime(0, t0 + p[3], p[2] * decay);
        o.connect(g);
        if (ctx.createStereoPanner) {
          var pn = ctx.createStereoPanner();
          pn.pan.value = side * 0.32;
          g.connect(pn); pn.connect(out);
        } else g.connect(out);
        o.start(t0); o.stop(end);
      }
    }
    setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (end - ctx.currentTime) * 1000 + 1000);
  };

  root.HourglassAudio = HourglassAudio;
})(typeof window !== 'undefined' ? window : globalThis);
