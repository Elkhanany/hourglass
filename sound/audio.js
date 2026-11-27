/*!
 * Hourglass — sound/audio.js
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
 * License: GPL-3.0-or-later.
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
   * One icon family for the cards of the sounds in Tune: the same small
   * hourglass in every card, and beside it what the sound is. A record's
   * `icon` is what is drawn inside the card's <svg class="ic" viewBox="0 0 24
   * 24">: ICON_GLASS and the sound's own mark (strokes on the 24 × 24 grid).
   */
  var ICON_GLASS = '<path d="M7.2 4.6h9.6M7.2 19.4h9.6M8.6 4.6C7.8 5.2 8.2 5.3 8.2 6.5C8.2 8.5 11.75 9 11.75 12S8.2 15.5 8.2 17.5C8.2 18.7 7.8 18.8 8.6 19.4M15.4 4.6C16.2 5.2 15.8 5.3 15.8 6.5C15.8 8.5 12.25 9 12.25 12S15.8 15.5 15.8 17.5C15.8 18.7 16.2 18.8 15.4 19.4"/>';

  /*
   * Acoustic characters: how loud each layer is, the tone, and how the
   * vessel is voiced. One defineCharacter per character, in the order of
   * Tune's cards:
   *   id, name, icon   what its card shows (and `id` is what the settings keep)
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
   *            (1 if left out)
   *   room, low, high, lp                     the room, and the tone
   *   modes    its resonators: six rows [Hz, Q, gain, upward shift when the
   *            cavity is full], one for each band of the graph; the thin
   *            glass (MODES) if left out
   */
  var CHARACTERS = {}, CHARACTER_ORDER = [];
  var CHARACTER_NUMBERS = ['whisper', 'beds', 'ticks', 'grain', 'body', 'modal', 'room', 'low', 'high', 'lp', 'send', 'vessel'];
  var CHARACTER_OPTIONAL = ['shake', 'tick', 'bed'];
  var CARD_FIELDS = ['id', 'name', 'icon'];
  var CHARACTER_FIELDS = CARD_FIELDS.concat(CHARACTER_NUMBERS, CHARACTER_OPTIONAL, ['modes']);

  function isNumber(v) { return typeof v === 'number' && v - v === 0; }
  /**
   * A record says only what is read: a field nothing knows is a field
   * misspelt (`mode` for `modes` would leave a character the thin glass, and
   * `layer` for `layers` an ambience silent). Throws, naming it.
   */
  function checkFields(what, rec, known) {
    for (var k in rec) {
      if (known.indexOf(k) < 0) throw new Error(what + ': ' + k + ' is no field of its record (' + known.join(', ') + ')');
    }
  }
  /** What every card needs of a record: an id nothing else has, a name and an icon. Throws, naming `what`. */
  function checkCard(what, rec, taken) {
    if (!rec || typeof rec !== 'object') throw new Error(what + ': a record is needed');
    if (typeof rec.id !== 'string' || !rec.id) throw new Error(what + ': the record has no id');
    if (rec.id in taken) throw new Error(what + ' "' + rec.id + '": that id is taken');
    if (typeof rec.name !== 'string' || !rec.name) throw new Error(what + ' "' + rec.id + '": it has no name');
    if (typeof rec.icon !== 'string' || !rec.icon) throw new Error(what + ' "' + rec.id + '": it has no icon');
  }
  /**
   * Register an acoustic character (the record is kept as it is given, and
   * is what the engine reads). A record the graph could not play is refused
   * here, when the page loads, by name: a number missing or not a number, a
   * `modes` table that is not six rows of four numbers, or a field that is
   * none of a character's.
   */
  function defineCharacter(rec) {
    var what = 'defineCharacter', k, i, j, m;
    checkCard(what, rec, CHARACTERS);
    what += ' "' + rec.id + '"';
    checkFields(what, rec, CHARACTER_FIELDS);
    for (k = 0; k < CHARACTER_NUMBERS.length; k++) {
      if (!isNumber(rec[CHARACTER_NUMBERS[k]])) throw new Error(what + ': ' + CHARACTER_NUMBERS[k] + ' is ' + rec[CHARACTER_NUMBERS[k]] + ', not a number');
    }
    for (k = 0; k < CHARACTER_OPTIONAL.length; k++) {
      m = rec[CHARACTER_OPTIONAL[k]];
      if (m !== undefined && !isNumber(m)) throw new Error(what + ': ' + CHARACTER_OPTIONAL[k] + ' is ' + m + ', not a number');
    }
    m = rec.modes;
    if (m !== undefined) {
      if (!m || m.length !== MODES.length) throw new Error(what + ': modes has ' + (m ? m.length : 'no') + ' rows; the graph has ' + MODES.length + ' bands');
      for (i = 0; i < m.length; i++) {
        if (!m[i] || m[i].length !== 4) throw new Error(what + ': row ' + i + ' of modes is not [Hz, Q, gain, shift]');
        for (j = 0; j < 4; j++) if (!isNumber(m[i][j])) throw new Error(what + ': row ' + i + ' of modes holds ' + m[i][j] + ', not a number');
        if (!(m[i][0] > 0 && m[i][1] > 0)) throw new Error(what + ': row ' + i + ' of modes needs a frequency and a Q above 0');
      }
    }
    CHARACTERS[rec.id] = rec;
    CHARACTER_ORDER.push(rec.id);
    return rec;
  }

  defineCharacter({
    id: 'asmr', name: 'Close-Miked ASMR',
    icon: ICON_GLASS + '<path d="M18.9 9.4a3.6 3.6 0 0 1 0 5.2M20.6 8.3a5.6 5.6 0 0 1 0 7.4"/>',
    whisper: 0.034, beds: 0.016, shake: 0.034, ticks: 0.19, grain: 2.1, body: 0.08, modal: 0.15, room: 0.10,
    low: 0, high: 0, lp: 18000, send: 0, vessel: 0
  });
  defineCharacter({
    id: 'warm', name: 'Warm Glass',
    icon: ICON_GLASS + '<path d="M18.7 8.4l1.6-.85M19.6 12h1.8M18.7 15.6l1.6.85M5.3 8.4l-1.6-.85M4.4 12H2.6M5.3 15.6l-1.6.85"/>',
    whisper: 0.026, beds: 0.011, ticks: 0.12, grain: 2.4, body: 0.10, modal: 0.20, room: 0.30,
    low: 3, high: -6, lp: 8200, modes: MODES_WARM, send: 0.09, vessel: 1
  });
  defineCharacter({
    id: 'pure', name: 'Pure Sand Whisper',
    icon: ICON_GLASS + '<path stroke-width="1.45" d="M19.2 9.7h.01M20 12h.01M19.2 14.3h.01M4.8 9.7h.01M4 12h.01M4.8 14.3h.01"/>',
    whisper: 0.046, beds: 0.012, ticks: 0.03, grain: 2.0, body: 0.03, modal: 0.045, room: 0.12,
    low: -1, high: 0, lp: 15000, send: 0, vessel: 0
  });
  defineCharacter({
    id: 'chime', name: 'Singing Glass',
    icon: ICON_GLASS + '<path d="M18.9 9.4a3.6 3.6 0 0 1 0 5.2M5.1 9.4a3.6 3.6 0 0 0 0 5.2"/>',
    whisper: 0.022, beds: 0.009, ticks: 0.17, grain: 2.2, body: 0, modal: 0.30, room: 0.36,
    low: 0, high: 0, lp: 11000,
    modes: MODES_CHIME, send: 0.05, vessel: 1, tick: 1.0, bed: 1
  });
  defineCharacter({
    id: 'bamboo', name: 'Bamboo Rainstick',
    icon: ICON_GLASS + '<path d="M3.8 4.6v14.8M20.2 4.6v14.8M3 9.5h1.6M3 14.5h1.6M19.4 9.5h1.6M19.4 14.5h1.6"/>',
    whisper: 0.012, beds: 0.011, ticks: 0.20, grain: 2.3, body: 0, modal: 0.38, room: 0.22,
    low: 2, high: -4, lp: 8500,
    modes: MODES_BAMBOO, send: 0.11, vessel: 1, tick: 0.58, bed: 0.8
  });
  defineCharacter({
    id: 'dune', name: 'Desert Dune',
    icon: ICON_GLASS + '<circle cx="20.3" cy="6.7" r="1.6"/><path d="M1.6 19.4C2.7 18.1 3.9 17.5 5.4 17.8M18.6 17.8C20.1 17.5 21.3 18.1 22.4 19.4"/>',
    whisper: 0.032, beds: 0.012, ticks: 0.07, grain: 2.0, body: 0, modal: 0.53, room: 0.26,
    low: 5, high: -9, lp: 5200,
    modes: MODES_DUNE, send: 0.25, vessel: 1, tick: 0.5, bed: 0.55
  });

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
   *   crack  the ring and the knock of a crack, surprising but never
   *          alarming: 20 dB under the completion bowl in loudness (RMS)
   *   snap   the crack's first 3 ms. It must top the creaks that warn of
   *          it, so it peaks near −11 dBFS, where the thumps and tinks are
   *   creak0, creak1   the ticks of strained glass, levels 1 and 4. They
   *          are a warning and must be heard on a phone's speaker: they
   *          peak between about −17 and −12 dBFS (they were 25 dB lower, and
   *          nobody ever heard the glass complain before it cracked)
   *   tick   the fainter ticks of a crack settling or growing
   *   hum    the mend hum; at its recipe's level it rendered at −70 dBFS,
   *          below hearing, and sits near −48 dBFS RMS with this
   */
  var LEVEL = { crack: 0.045, tick: 0.2, hum: 12, creak0: 0.10, creak1: 0.15, snap: 0.18 };

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


  // Older WebKit (before iOS 14.5) makes no AudioBuffer below this rate
  var MIN_SR = 22050;
  /**
   * Wrap raw channel data (synthesised at `sr`) into an AudioBuffer. Where the
   * browser refuses so low a rate, each sample is drawn out into the least
   * whole number of them that reaches MIN_SR, on straight lines (and from the
   * last sample on to the first: these are loops). Played, that is the same
   * sound: a source reads between two samples along the same straight line.
   */
  function toBuffer(ctx, channels, sr) {
    var n = channels[0].length, k = 1, b, c, i, j, o, x, d, out, a;
    try { b = ctx.createBuffer(channels.length, n, sr); }
    catch (e) {
      if (sr >= MIN_SR) throw e;
      k = Math.ceil(MIN_SR / sr);
      b = ctx.createBuffer(channels.length, n * k, sr * k);
    }
    for (c = 0; c < channels.length; c++) {
      if (k === 1) { b.getChannelData(c).set(channels[c]); continue; }
      a = channels[c]; out = b.getChannelData(c);
      for (i = 0, o = 0; i < n; i++) {
        x = a[i]; d = (a[i + 1 < n ? i + 1 : 0] - x) / k;
        for (j = 0; j < k; j++) out[o++] = x + d * j;
      }
    }
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

  /* ---- ocean ------------------------------------------------------------
   * Slow surf on a sandy beach, heard from the shore. A wave is not noise
   * faded in and out. The swell comes up dark, out of the rumble; it breaks
   * low first (the soft thud of the plunge, then its roar); the wash opens up
   * as the foam spreads over the sand, the hiss comes last and stays longest;
   * and what draws back is thin and fizzing, bubbles bursting one by one, a
   * different sound from the break.
   *
   * So a wave is several coloured noises, each on its own envelope around the
   * moment of breaking (τ, in seconds, stretched by the wave's own tempo),
   * the low-pass of the wash gliding open with the foam and closing again as
   * the water draws back, and after them the brook's smallest bubbles, as
   * many as there is foam.
   *
   * Two loops play together. In front, six waves in a minute, about 8 to
   * 12 s apart, no two gaps or sizes alike. Behind them, on a shorter loop of its
   * own, the low rumble of distant surf and two softer, duller waves from
   * farther along the beach: each time round they fall elsewhere among the
   * waves in front, now filling a gap, now doubling a wave, so no minute
   * sounds like the last.
   *
   * It is made in many short slices (a minute of sound is a lot of noise):
   * the heavy loops live in functions of their own, compiled once, and the
   * first channel made, while they are still cold, is cut finer.
   * ------------------------------------------------------------------- */

  var SURF = {
    cr: 25,                                   // control rate of its curves, Hz
    bite: 400000,                             // samples of noise made in one slice (2 to 3 ms, once the code is hot)
    ild: 10,                                  // dB between the ears for a wave fully to one side
    // A loop: `n` waves, each gap within ± `jit` of the mean and each size within
    // ± 1.5 `size` (log), one from every slice of that range, in a random order;
    // a bigger wave is slower; `rise` is the swell's time constant (s); `heave`
    // (σ, log) is the slow swell of whatever sounds all the time.
    // A part is noise through a 2-pole low-pass `lp` (gliding up to `lp1` with the
    // foam) and a 2-pole high-pass `hp`; `rho` of it is common to the ears and `pan`
    // of the wave's place is heard in it; it flickers (σ `sig`, band-passed to
    // fhp…fc Hz). Its level, × `gain`: `fl` always; `ap` × the swell coming in; the
    // break, which begins at τ = `on`, rises for `at` s and falls with time constant
    // `de` (a rounded crest: 1/cosh); `bw` × the backwash, a bell around τ = `bc`, `bd` s to either side.
    // `pw`: how its level follows the size of the wave.
    front: { salt: 11, n: 6, jit: 0.22, size: 0.33, rise: 2.4, heave: 0.2, rms: 0.077,
      parts: [
        { lp: 240, hp: 100, rho: 0.9, pan: 0.5, sig: 0.3, fc: 6, fhp: 1.5, gain: 0.55,
          fl: 0.08, pw: 1.4, ap: 0.6, on: -0.45, at: 0.4, de: 0.5, bw: 0, bc: 0, bd: 1 },
        { lp: 750, hp: 190, rho: 0.75, pan: 0.8, sig: 0.26, fc: 8, fhp: 2, gain: 0.85,
          fl: 0.08, pw: 1.2, ap: 0.6, on: -0.4, at: 0.55, de: 0.65, bw: 0.04, bc: 4.0, bd: 1.8 },
        { lp: 1200, lp1: 4500, hp: 450, rho: 0.5, pan: 0.9, sig: 0.16, fc: 10, fhp: 2.5, gain: 1,
          fl: 0.14, pw: 1, ap: 0.3, on: -0.3, at: 0.75, de: 1.0, bw: 0.14, bc: 4.0, bd: 1.8 },
        { lp: 5500, hp: 2000, rho: 0.35, pan: 1, sig: 0.08, fc: 10, fhp: 3, gain: 0.48,
          fl: 0.5, pw: 0.85, ap: 0.12, on: -0.1, at: 0.95, de: 1.6, bw: 0.08, bc: 3.6, bd: 1.8 }
      ],
      // the foam's bubbles bursting: up to `rate` a second where the foam is thickest, dying
      // away with time constant `de`; pitch, loudness and damping as the brook's fizz
      fizz: { rate: 450, de: 2.2, f0: 2600, f1: 5200, amp: 0.46, sigma: 0.7, tilt: -0.3, damp: 3, pan: 0.9 } },
    far: { salt: 23, n: 2, jit: 0.25, size: 0.25, rise: 2.6, heave: 0.25, rms: 0.045,
      parts: [
        { lp: 260, hp: 95, rho: 0.9, pan: 0.2, sig: 0.26, fc: 5, fhp: 0.8, gain: 0.6,
          fl: 0.42, pw: 1.3, ap: 0.5, on: -0.5, at: 0.7, de: 1.0, bw: 0, bc: 0, bd: 1 },
        { lp: 520, lp1: 1500, hp: 200, rho: 0.6, pan: 0.6, sig: 0.2, fc: 8, fhp: 1.5, gain: 0.8,
          fl: 0.15, pw: 1, ap: 0.4, on: -0.3, at: 0.8, de: 1.4, bw: 0.1, bc: 4.4, bd: 1.8 },
        { lp: 2400, hp: 1000, rho: 0.4, pan: 0.9, sig: 0.14, fc: 10, fhp: 2.5, gain: 0.3,
          fl: 0.11, pw: 0.9, ap: 0.2, on: -0.1, at: 1.0, de: 1.8, bw: 0.2, bc: 3.8, bd: 1.6 }
      ] }
  };

  var surfHot = false;                        // a channel has been made: the code is compiled, the next ones take bigger bites

  /** When the waves break and how big they are: one gap and one size from every slice of their range, shuffled. */
  function surfPlan(o) {
    var P = o.P, rE = o.rE, gaps = [], big = [], t = rE() * o.seconds, all = 0, w, c, v;
    for (w = 0; w < P.n; w++) {
      gaps.push(1 + P.jit * ((w + rE()) / P.n * 2 - 1));
      big.push(Math.exp(P.size * 1.5 * ((w + rE()) / P.n * 2 - 1)));
      all += gaps[w];
    }
    for (w = P.n - 1; w > 0; w--) {
      c = (rE() * (w + 1)) | 0; v = gaps[w]; gaps[w] = gaps[c]; gaps[c] = v;
      c = (rE() * (w + 1)) | 0; v = big[w]; big[w] = big[c]; big[c] = v;
    }
    for (w = 0; w < P.n; w++) { o.W.push({ t: t, big: big[w] }); t += gaps[w] / all * o.seconds; }
    for (w = 0; w < P.parts.length; w++) o.E.push(new Float32Array(o.nc));
  }

  /** Waves w0 … w1 of a loop: what each part does around them. */
  function surfLay(o, w0, w1) {
    var P = o.P, parts = P.parts, np = parts.length, F = P.fizz, rE = o.rE, cr = SURF.cr, nc = o.nc, ch = o.ch;
    var E = o.E, open = o.open, foam = o.foam, size = [], w, c, b, v;
    if (!w0) surfPlan(o);
    for (w = w0; w < w1; w++) {
      var t = o.W[w].t, big = o.W[w].big, d = Math.sqrt(big) * (0.9 + 0.2 * rE());   // its tempo: a big wave takes its time
      var rise = P.rise * (0.8 + 0.5 * rE()), steep = 0.75 + 0.6 * rE();
      var tilt = Math.exp(0.16 * gauss(rE)), back = 0.7 + 0.6 * rE();
      var x0 = (rE() * 2 - 1) * 0.8, glide = (rE() < 0.5 ? -1 : 1) * (0.08 + 0.2 * rE());   // where it breaks, which way it runs
      for (b = 0; b < np; b++) size[b] = Math.pow(big, parts[b].pw) * (b * 2 < np ? 1 / tilt : tilt);
      for (c = Math.floor((t - 8 * d) * cr); c < (t + 9 * d) * cr; c++) {
        var x = (c / cr - t) / d, j = ((c % nc) + nc) % nc;          // τ; the loop wraps
        var edge = x < -7 ? x + 8 : x > 8 ? 9 - x : 1;               // in and out over a second, far from the break
        var swell = x < 0 ? Math.exp(x / rise) : Math.exp(-x / 0.4);
        var px = x0 + glide * x; px = px > 1 ? 1 : px < -1 ? -1 : px;
        var ear = (ch ? px : -px) * SURF.ild * 0.0576;               // ± half the level difference, in nepers
        for (b = 0; b < np; b++) {
          var p = parts[b], y = x - p.on, at = p.at * steep, q = (x - p.bc) / p.bd, e = p.ap * swell;
          if (q > -1 && q < 1) e += p.bw * back * (0.5 + 0.5 * Math.cos(Math.PI * q));
          if (y > 0) e += y < at ? 0.5 - 0.5 * Math.cos(Math.PI * y / at) : 2 / (Math.exp((y - at) / p.de) + Math.exp((at - y) / p.de));
          E[b][j] += e * edge * size[b] * (1 + ear * p.pan);
        }
        // how far the wash is open: a little with the swell, wide with the break, closing as the water draws back
        v = (x < -0.4 ? 0.3 * Math.exp((x + 0.4) / rise) : x < 0.8 ? 0.65 - 0.35 * Math.cos(Math.PI * (x + 0.4) / 1.2) : Math.exp(-(x - 0.8) / 3)) * edge;
        if (v > open[j]) open[j] = v;
        // the foam left on the sand: up after the break, longest of all to go
        if (F && x > 0.6) foam[j] += (x < 2.6 ? 0.5 - 0.5 * Math.cos(Math.PI * (x - 0.6) / 2) : Math.exp(-(x - 2.6) / F.de)) * edge * big * back * 0.8;
      }
    }
    if (w1 === P.n) { o.heave = ctrlCurve(rE, nc, 0.3, cr); o.x = (rE() * 4294967296) | 1; }
  }

  /** Parts b0 … b1 of a loop: each one's level through it, and the state of its noise and filters. */
  function surfTune(o, b0, b1) {
    var P = o.P, sr = o.sr, nc = o.nc, cr = SURF.cr, heave = o.heave, open = o.open;
    for (var b = b0, c, kl, a; b < b1; b++) {
      var p = P.parts[b], e = o.E[b], fS = ctrlCurve(o.rE, nc, p.fc, cr, p.fhp), fC = ctrlCurve(o.rC, nc, p.fc, cr, p.fhp);
      var G = new Float32Array(nc + 1), K = p.lp1 ? new Float32Array(nc + 1) : null, lg = K ? Math.log(p.lp1 / p.lp) : 0;
      for (c = 0; c < nc; c++) {
        if (K || !c) {
          kl = 1 - Math.exp(-TAU * p.lp * Math.exp(lg * open[c]) / sr); a = 1 - kl; a = 1 - a * a;
          // what the low-pass lets through of the noise (integers, ± 2³¹), so that `gain` is an RMS
          a = Math.sqrt(kl * kl * kl * kl * (2 - a) / (a * a * a) / 3) * 2147483648;
          if (K) K[c] = kl;
        }
        G[c] = p.gain * (p.fl * Math.exp(P.heave * heave[c]) + e[c]) * Math.exp(p.sig * (0.77 * fS[c] + 0.63 * fC[c])) / a;
      }
      G[nc] = G[0]; if (K) K[nc] = K[0];
      o.S.push({ G: G, K: K, kl: 1 - Math.exp(-TAU * p.lp / sr), kh: 1 - Math.exp(-TAU * p.hp / sr),
                 cs: Math.sqrt(p.rho), cc: Math.sqrt(1 - p.rho), xs: (o.rE() * 4294967296) | 1, xo: (o.rC() * 4294967296) | 1,
                 l1: 0, l2: 0, h1: 0, h2: 0, i: 0 });
    }
  }

  /** Control steps c0 … c1 of one part, added to `raw`: noise, low-pass, high-pass, its level. Returns its energy. */
  function surfPart(raw, s, c0, c1, n, nc) {
    var G = s.G, K = s.K, kl = s.kl, kh = s.kh, cs = s.cs, cc = s.cc, xs = s.xs, xo = s.xo;
    var l1 = s.l1, l2 = s.l2, h1 = s.h1, h2 = s.h2, i = s.i, end = raw.length, e = 0, c, j, i1, v, dv, dk = 0, y;
    for (c = c0; c < c1; c++) {
      j = c % nc;                                                    // past the end: on into the start, for the seam
      i1 = Math.min(end, Math.floor((c + 1) * n / nc));
      v = G[j]; dv = (G[j + 1] - v) / (i1 - i);
      if (K) { kl = K[j]; dk = (K[j + 1] - kl) / (i1 - i); }
      for (; i < i1; i++) {
        xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5;              // xorshift: the noise both ears share,
        xo ^= xo << 13; xo ^= xo >>> 17; xo ^= xo << 5;              // and this ear's own
        l1 += kl * (cs * xs + cc * xo - l1); l2 += kl * (l1 - l2);
        h1 += kh * (l2 - h1); y = l2 - h1; h2 += kh * (y - h2);
        y = (y - h2) * v; raw[i] += y; e += y * y;
        v += dv; kl += dk;
      }
    }
    s.xs = xs; s.xo = xo; s.l1 = l1; s.l2 = l2; s.h1 = h1; s.h2 = h2; s.i = i; s.kl = kl;
    return e;
  }
  /** A stretch of a loop, every part of it; after the last, the seam. */
  function surfNoise(o, c0, c1) {
    var raw = o.raw, n = o.n, fade = raw.length - n, b, i, a;
    for (b = 0; b < o.S.length; b++) o.sum += surfPart(raw, o.S[b], c0, c1, n, o.nc) / raw.length;   // the parts are independent: their powers add
    if (o.S[0].i === raw.length) {
      for (i = 0; i < fade; i++) {                                   // equal-power crossfade → seamless loop
        a = i / fade;
        raw[i] = raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
      }
    }
  }

  /** The next of a loop's random numbers for its bubbles, 0 … 1 (xorshift; alike in both ears). */
  function surfRnd(o) {
    var x = o.x;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o.x = x;
    return (x >>> 0) / 4294967296;
  }
  /** A stretch of a loop's bubbles: shared events, this ear's pan and delay. */
  function surfFizz(o, c0, c1) {
    var F = o.P.fizz, raw = o.raw, ch = o.ch, sr = o.sr, n = o.n, nc = o.nc, foam = o.foam, cr = SURF.cr;
    var lr = Math.log(F.f1 / F.f0), itd = WATER.itd * sr, tab = SINE, ramp = Math.max(2, Math.round(sr * 0.00017)), ft = o.ft;
    if (ft < 0) ft = -Math.log(1 - surfRnd(o)) / F.rate;
    while (ft < c1 / cr) {
      if (surfRnd(o) < foam[Math.min(nc - 1, (ft * cr) | 0)]) {
        var f0 = F.f0 * Math.exp(lr * surfRnd(o)), d = F.damp * (0.043 * f0 + 0.0014 * f0 * Math.sqrt(f0));   // damping, 1/s
        var p = (surfRnd(o) * 2 - 1) * F.pan, ang = (p + (ch ? 1 : 3)) * Math.PI / 4;                          // left: the cosine
        var env = F.amp * Math.min(WATER.cap, Math.exp(F.sigma * 1.732 * (surfRnd(o) + surfRnd(o) + surfRnd(o) + surfRnd(o) - 2))) *
                  Math.pow(f0 / 1000, F.tilt) * 1.414 * Math.sin(ang), dec = Math.exp(-d / sr);
        var j = (Math.floor(ft * sr) + Math.round(itd * Math.max(0, ch ? -p : p))) % n;                        // far ear later
        var ph = surfRnd(o) * 4096, dph = 4096 * f0 / sr, len = Math.min(n, Math.ceil(sr * 4.6 / d));
        o.sum += env * env * 0.5 / (1 - dec * dec) / n;                // what it adds to the loop's power
        for (var q = 0; q < len; q++) {
          raw[j] += env * tab[ph & 4095] * (q < ramp ? q / ramp : 1);
          if (++j === n) j = 0;                                      // wraps → seamless
          ph += dph; env *= dec;
        }
      }
      ft += -Math.log(1 - surfRnd(o)) / F.rate;
    }
    o.ft = ft;
  }

  /**
   * Samples i0 … i1 of a loop, to its RMS (its power was added up on the way). A wave's
   * tallest crests may pass 0.7: those few samples are rounded off towards 0.95, so that
   * the loop is as loud whatever the seed.
   */
  function surfScale(o, i0, i1) {
    var raw = o.raw, g = o.P.rms / Math.sqrt(o.sum), i, v;
    for (i = i0; i < i1; i++) {
      v = raw[i] * g;
      raw[i] = v > 0.7 ? 0.95 - 0.0625 / (v - 0.45) : v < -0.7 ? 0.0625 / (-v - 0.45) - 0.95 : v;
    }
    if (i1 === o.n) { surfHot = true; return raw.subarray(0, o.n); }
  }

  /**
   * One channel of a loop of surf: the parts of `P`, each a noise on its own
   * envelope around the waves, then the fizz. Both ears get the same waves
   * and the same bubbles from one seed.
   */
  function surf(sr, seconds, ch, seed, P) {
    var n = Math.floor(sr * seconds), nc = Math.round(seconds * SURF.cr), end = n + Math.floor(sr * 0.25);
    var np = P.parts.length, list = [];
    var o = { P: P, ch: ch, sr: sr, seconds: seconds, n: n, nc: nc,
              rE: mulberry32(seed * 7919 + P.salt),                  // shared by both ears
              rC: mulberry32(seed * 104729 + P.salt * 31 + ch * 977),   // this ear's own
              raw: new Float32Array(end), W: [], E: [], S: [], open: new Float32Array(nc), foam: new Float32Array(nc),
              heave: null, x: 1, ft: -1, sum: 0 };
    /**
     * Steps that take `work` from 0 to `m`, about `bite` at a time. Unless `plain`, three short
     * ones come first while the code is still cold: it runs many times slower until it is compiled.
     */
    function sweep(work, m, bite, plain) {
      var q = Math.ceil(m / bite), ramp = plain || surfHot ? 0 : 3, k = 0;
      function at() { return Math.min(m, Math.max(k, Math.floor(m * (k > ramp ? k - ramp : Math.pow(k / (ramp + 1), 5)) / q))); }
      function step() { var a = at(); k++; return work(o, a, at()); }
      for (var i = 0; i < q + ramp; i++) list.push(step);
    }
    sweep(surfLay, P.n, surfHot ? P.n : 1, true);
    sweep(surfTune, np, surfHot ? Math.ceil(4000 / nc) : 1, true);
    sweep(surfNoise, Math.ceil(end * nc / n), Math.ceil(SURF.bite / np * nc / n));
    if (P.fizz) sweep(surfFizz, nc, Math.ceil(nc / 4));
    sweep(surfScale, n, SURF.bite);
    return steps(list);
  }

  /** One channel of the waves in front: swell, break, foam, backwash. */
  function rawSurf(sr, seconds, ch, seed) { return surf(sr, seconds, ch, seed, SURF.front); }
  /** One channel of the distant surf: its rumble, and softer, duller waves from farther along the beach. */
  function rawSurfFar(sr, seconds, ch, seed) { return surf(sr, seconds, ch, seed, SURF.far); }

  /* ---- falling water -----------------------------------------------------
   * A small fall heard from a few metres is mostly a rush: so many splashes
   * and bubbles a second that they blur into noise. What makes it water and
   * not hiss is its colour (weight from 160 Hz to 1 kHz, then a steady fall
   * of 3 dB an octave), that both ears hear the same lows but not the same
   * highs, and that from close by it is never still: it spits and splashes
   * (bursts of noise a few to a few tens of milliseconds long, each with a
   * pitch and a place of its own) and the pool below gurgles with low
   * bubbles.
   *
   * Three loops play together: the falling sheet, the wash around its foot,
   * and the plunge pool, low and slow. Each carries a share of the rush, of
   * the splashes and of the bubbles, and breathes on its own, so no band
   * hangs on one loop and what is heard does not come round the same way:
   * the three line up again after six days. The proportions come from
   * recordings of small waterfalls: the colour and the stereo image from
   * three made a few metres away, the splashing and gurgling from two made
   * close to the pool (on the calm side of them).
   *
   * The work is cut into small steps and each call runs on for about
   * FALLS.slice ms, so a slice stays short on any device.
   * ------------------------------------------------------------------- */
  var FALLS = {
    chunk: 6000, slice: 2.5,                  // samples of rush made per step; a slice of work lasts about this many ms
    bfc: 0.3,                                 // each loop breathes below this many Hz (`breath`: log-amplitude σ)
    cap: 2.2,                                 // a splash's random loudness: at most 2.2× its median
    // rush: noise split at `x` Hz into lows, mids and highs; `rho` of each is
    // shared between the ears. The sum is coloured by two one-pole
    // high-passes at `hp`, three one-pole low-passes side by side (`p`,
    // weights `w`) and `lpn` one-pole low-passes at `lp`. `gain`: its RMS
    // beside the amplitudes of the splashes and bubbles.
    // splashes: short bursts of noise. Rate /s, pitch range, how narrow (`q`,
    // widest to narrowest), median RMS at their top at 1 kHz, its log-normal
    // σ and tilt with pitch, attack `ta` s, decay time `tau` (shortest,
    // longest) s, the rhythm of the rate (σ `rsigma` of a log-normal below
    // `rfc` Hz) and how wide they are panned.
    // bubbles: as in WATER.
    // Splashes and bubbles come in `n` batches: spots that splash or bubble when they will (and a step of work each).
    sheet: { salt: 211, rms: 0.0466, breath: 0.050,
      bed: { gain: 0.050, x: [450, 1800], rho: [0.92, 0.62, 0.25],
             hp: 174.9, p: [174.9, 1434, 31420], w: [1, 0.0337, 0.0441], lp: 9000, lpn: 4 },
      splash: [
        { n: 4, rate: 1.6, f0: 3500, f1: 10000, q: [1.2, 3], amp: 0.088, sigma: 0.7, tilt: -0.5, ta: 0.001, tau: [0.003, 0.012],
          rfc: 0.6, rsigma: 0.6, pan: 0.7 },                                                  // spits of spray
        { n: 6, rate: 1.35, f0: 900, f1: 3400, q: [1, 2.5], amp: 0.046, sigma: 0.55, tilt: -0.5, ta: 0.002, tau: [0.006, 0.025],
          rfc: 0.5, rsigma: 0.6, pan: 0.6 },                                                  // splashes
        { n: 4, rate: 0.62, f0: 400, f1: 1200, q: [1, 2.5], amp: 0.048, sigma: 0.45, tilt: -0.5, ta: 0.004, tau: [0.012, 0.045],
          rfc: 0.4, rsigma: 0.8, pan: 0.5 }                                                   // slaps
      ],
      bubbles: [
        { n: 5, rate: 1.4, f0: 500, f1: 1500, skew: 1.0, amp: 0.042, sigma: 0.45, tilt: -0.3,
          damp: 2.0, xi0: -0.01, xi1: 0.07, rfc: 1.5, rhp: 0, rsigma: 1.2, pan: 0.7 },        // plops
        { n: 4, rate: 1.15, f0: 260, f1: 620, skew: 1.0, amp: 0.072, sigma: 0.40, tilt: -0.3,
          damp: 2.4, xi0: -0.01, xi1: 0.07, rfc: 1.5, rhp: 0, rsigma: 1.2, pan: 0.5 },        // gurgles
        { n: 2, rate: 0.45, f0: 140, f1: 270, skew: 1.0, amp: 0.050, sigma: 0.35, tilt: -0.3,
          damp: 2.0, xi0: -0.01, xi1: 0.06, rfc: 1.5, rhp: 0, rsigma: 0.8, pan: 0.4 }         // glugs
      ] },
    pool: { salt: 223, rms: 0.0530, breath: 0.050,
      bed: { gain: 0.050, x: [450, 1800], rho: [0.92, 0.62, 0.25],
             hp: 149.5, p: [149.5, 149.5, 4800], w: [1, 0.1444, 0.1305], lp: 1066, lpn: 4 },
      splash: [],
      bubbles: [
        { n: 5, rate: 0.96, f0: 250, f1: 600, skew: 1.0, amp: 0.072, sigma: 0.40, tilt: -0.3,
          damp: 2.4, xi0: -0.01, xi1: 0.07, rfc: 1.5, rhp: 0, rsigma: 1.2, pan: 0.5 },        // gurgles
        { n: 3, rate: 0.4, f0: 130, f1: 260, skew: 1.0, amp: 0.050, sigma: 0.35, tilt: -0.3,
          damp: 2.0, xi0: -0.01, xi1: 0.06, rfc: 1.5, rhp: 0, rsigma: 0.8, pan: 0.4 }         // glugs
      ] },
    wash: { salt: 227, rms: 0.0466, breath: 0.050,
      bed: { gain: 0.050, x: [450, 1800], rho: [0.92, 0.62, 0.25],
             hp: 174.9, p: [174.9, 1434, 31420], w: [1, 0.0337, 0.0441], lp: 9000, lpn: 4 },
      splash: [
        { n: 4, rate: 1.6, f0: 3200, f1: 9000, q: [1.2, 3], amp: 0.088, sigma: 0.7, tilt: -0.5, ta: 0.001, tau: [0.003, 0.012],
          rfc: 0.6, rsigma: 0.6, pan: 0.7 },                                                  // spits
        { n: 6, rate: 1.35, f0: 700, f1: 3000, q: [1, 2.5], amp: 0.046, sigma: 0.55, tilt: -0.5, ta: 0.002, tau: [0.006, 0.025],
          rfc: 0.5, rsigma: 0.6, pan: 0.6 },                                                  // splashes
        { n: 4, rate: 0.62, f0: 350, f1: 1100, q: [1, 2.5], amp: 0.048, sigma: 0.45, tilt: -0.5, ta: 0.004, tau: [0.012, 0.045],
          rfc: 0.4, rsigma: 0.8, pan: 0.5 }                                                   // slaps
      ],
      bubbles: [
        { n: 5, rate: 1.4, f0: 450, f1: 1400, skew: 1.0, amp: 0.042, sigma: 0.45, tilt: -0.3,
          damp: 2.0, xi0: -0.01, xi1: 0.07, rfc: 1.5, rhp: 0, rsigma: 1.2, pan: 0.7 },        // plops
        { n: 4, rate: 1.15, f0: 240, f1: 580, skew: 1.0, amp: 0.072, sigma: 0.40, tilt: -0.3,
          damp: 2.4, xi0: -0.01, xi1: 0.07, rfc: 1.5, rhp: 0, rsigma: 1.2, pan: 0.5 },        // gurgles
        { n: 2, rate: 0.45, f0: 125, f1: 250, skew: 1.0, amp: 0.050, sigma: 0.35, tilt: -0.3,
          damp: 2.0, xi0: -0.01, xi1: 0.06, rfc: 1.5, rhp: 0, rsigma: 0.8, pan: 0.4 }         // glugs
      ] }
  };

  /**
   * Like steps(), for many small steps: each call runs on for about `ms`
   * milliseconds (at least one step), so a slice of work stays short however
   * fast the device is, and whether or not the code has been compiled yet.
   */
  function stretches(list, ms) {
    var k = 0;
    return function next() {
      var t0 = now(), r;
      do r = list[k++](); while (k < list.length && now() - t0 < ms);
      return k < list.length ? next : r;
    };
  }

  /** A slow ctrlCurve of `nc` steps at WATER.cr: made at an eighth of the rate, then drawn out. */
  function fallsCurve(r, nc, fc) {
    var n = Math.round(nc / 8), c = ctrlCurve(r, n, fc, WATER.cr / 8), out = new Float32Array(nc), i, u, j;
    for (i = 0; i < nc; i++) { u = i * n / nc; j = u | 0; out[i] = c[j] + (c[(j + 1) % n] - c[j]) * (u - j); }
    return out;
  }

  /**
   * Add one class of splashes to a channel: short bursts of noise, each with
   * its own pitch, width and length. Shared events, this ear's pan and delay.
   */
  function fallsSpray(out, sr, seconds, nc, C, swell, rE, ch) {
    var n = out.length, itd = WATER.itd * sr, q = 1 / 2147483648, rate = fallsCurve(rE, nc, C.rfc);
    // a Poisson stream whose rate swings log-normally: thin a faster one
    var mMax = Math.exp(C.rsigma * 2.5), lam = C.rate * mMax, lf = Math.log(C.f1 / C.f0), lt = Math.log(C.tau[1] / C.tau[0]), t = 0;
    for (;;) {
      t += -Math.log(1 - rE()) / lam;
      if (t >= seconds) break;
      var c = Math.min(nc - 1, (t / seconds * nc) | 0);
      var keep = Math.exp(C.rsigma * rate[c] - C.rsigma * C.rsigma * 0.5) / mMax;
      var u = rE(), uf = rE(), ua = gauss(rE), uq = rE(), ud = rE(), up = rE();   // drawn alike in both ears,
      var a = (rE() * 4294967295) | 1;                                            // and so is its noise
      if (u > keep) continue;
      var f0 = C.f0 * Math.exp(lf * uf), Q = C.q[0] + (C.q[1] - C.q[0]) * uq;
      var w0 = TAU * f0 / sr, al = Math.sin(w0) / (2 * Q), b0 = al / (1 + al), a1 = -2 * Math.cos(w0) / (1 + al), a2 = (1 - al) / (1 + al);
      var p = (up * 2 - 1) * C.pan, ang = (p + 1) * Math.PI / 4;
      // noise of ±1 through this band-pass has an RMS of √(π f0 / (3 Q sr)): `amp` is the RMS at the top of the burst
      var env = C.amp * Math.min(FALLS.cap, Math.exp(C.sigma * ua)) * Math.pow(f0 / 1000, C.tilt) * Math.exp(WATER.swell * swell[c]) *
                1.414 * Math.cos(ang - ch * Math.PI / 2) / Math.sqrt(Math.PI * f0 / (3 * Q * sr));
      var tau = C.tau[0] * Math.exp(lt * ud), dec = Math.exp(-1 / (tau * sr)), na = Math.max(8, Math.round(C.ta * sr));
      var len = Math.min(n, na + Math.ceil(tau * sr * 4.6));
      var j = (Math.floor(t * sr) + Math.round(itd * Math.max(0, p * (1 - 2 * ch)))) % n;   // far ear later
      var x, x1 = 0, x2 = 0, y, y1 = 0, y2 = 0;
      for (var k = 0; k < len; k++) {
        a ^= a << 13; a ^= a >>> 17; a ^= a << 5; x = a * q;
        y = b0 * (x - x2) - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        if (k < na) out[j] += y * env * k / na;                         // rises in a straight line,
        else { out[j] += y * env; env *= dec; }                         // dies away
        if (++j === n) j = 0;                                           // wraps → seamless
      }
    }
  }

  /**
   * Samples `from` to `to` of one channel of a fall's rush. White noise is
   * split into lows, mids and highs, each shared between the ears by its own
   * amount; the sum breathes on the gain curve `G` (`step` of it a sample)
   * and is coloured. `st` carries the filters, and the energy so far, from
   * one call to the next.
   */
  function fallsNoise(raw, from, to, sr, B, G, step, st) {
    function k1(f) { return 1 - Math.exp(-TAU * f / sr); }
    var m = G.length - 1, q = 1 / 2147483648;
    var ka = k1(B.x[0]), kb = k1(B.x[1]), kh = k1(B.hp), q0 = k1(B.p[0]), q1 = k1(B.p[1]), q2 = k1(B.p[2]);
    var w0 = B.w[0], w1 = B.w[1], w2 = B.w[2], kl = k1(B.lp), km = B.lpn > 2 ? kl : 1;
    var a0 = Math.sqrt(B.rho[0]), a1 = Math.sqrt(B.rho[1]), a2 = Math.sqrt(B.rho[2]);
    var b0 = Math.sqrt(1 - B.rho[0]), b1 = Math.sqrt(1 - B.rho[1]), b2 = Math.sqrt(1 - B.rho[2]);
    var s1 = st[0], s2 = st[1], c1 = st[2], c2 = st[3], h1 = st[4], h2 = st[5], p0 = st[6], p1 = st[7], p2 = st[8];
    var l1 = st[9], l2 = st[10], l3 = st[11], l4 = st[12], pos = st[13], a = st[14] | 0, c = st[15] | 0;
    var i, ws, wc, j, x, e = st[16];
    for (i = from; i < to; i++) {
      // the noise: an xorshift per stream, inline (a call per sample would cost more than all the filters)
      a ^= a << 13; a ^= a >>> 17; a ^= a << 5; ws = a * q;          // shared by both ears
      c ^= c << 13; c ^= c >>> 17; c ^= c << 5; wc = c * q;          // this ear's own
      s1 += ka * (ws - s1); s2 += kb * (ws - s2);                    // lows, lows + mids
      c1 += ka * (wc - c1); c2 += kb * (wc - c2);
      j = pos | 0;
      x = (a0 * s1 + b0 * c1 + a1 * (s2 - s1) + b1 * (c2 - c1) + a2 * (ws - s2) + b2 * (wc - c2)) *
          (G[j] + (G[j + 1] - G[j]) * (pos - j));
      pos += step; if (pos >= m) pos -= m;
      h1 += kh * (x - h1); x -= h1; h2 += kh * (x - h2); x -= h2;    // no rumble
      p0 += q0 * (x - p0); p1 += q1 * (x - p1); p2 += q2 * (x - p2);
      l1 += kl * (w0 * p0 + w1 * p1 + w2 * p2 - l1); l2 += kl * (l1 - l2);
      l3 += km * (l2 - l3); l4 += km * (l3 - l4);
      raw[i] = l4; e += l4 * l4;
    }
    st[0] = s1; st[1] = s2; st[2] = c1; st[3] = c2; st[4] = h1; st[5] = h2; st[6] = p0; st[7] = p1; st[8] = p2;
    st[9] = l1; st[10] = l2; st[11] = l3; st[12] = l4; st[13] = pos; st[14] = a; st[15] = c; st[16] = e;
  }

  /** One channel of one loop of the falls, in small steps: its share of the rush, its splashes, its bubbles. */
  function fallsLayer(L, sr, seconds, ch, seed) {
    var n = Math.floor(sr * seconds), nc = Math.round(seconds * WATER.cr);
    var rE = mulberry32(seed * 7919 + L.salt);                       // shared by both ears
    var rC = mulberry32(seed * 104729 + L.salt + ch * 977);          // this ear's own
    var B = L.bed, fade = Math.floor(sr * 0.25), len = n + fade, raw, out, swell, G, st = new Float64Array(17);
    var list = [], from = 0, at = 0, sum = 0, peak = 0, g = 0, k, b;
    function rush() { fallsNoise(raw, from, Math.min(len, from + FALLS.chunk), sr, B, G, nc / n, st); from += FALLS.chunk; }
    function splashes(C) { return function () { fallsSpray(out, sr, seconds, nc, C, swell, rE, ch); }; }
    function bubbles(C) { return function () { waterBubbles(out, sr, seconds, nc, C, swell, rE, ch); }; }
    function mix() {                                                 // the rush at its gain, under the splashes and bubbles
      var end = Math.min(n, at + 8 * FALLS.chunk), s = B.gain / (Math.sqrt(st[16] / len) || 1), i, v;
      for (i = at; i < end; i++) {
        v = out[i] += s * raw[i];
        sum += v * v;
        if (v < 0) v = -v;
        if (v > peak) peak = v;
      }
      at = end === n ? 0 : end;
    }
    function scale() {                                               // to its RMS, the peak kept under 0.95 (as level() does)
      var end = Math.min(n, at + 8 * FALLS.chunk), i;
      if (!g) { g = L.rms / (Math.sqrt(sum / n) || 1); if (peak * g > 0.95) g = 0.95 / peak; }
      for (i = at; i < end; i++) out[i] *= g;
      at = end;
      return out;
    }
    list.push(function () {
      swell = fallsCurve(rE, nc, FALLS.bfc);
      G = new Float32Array(nc + 1);
      for (var i = 0; i < nc; i++) {                                 // rush, splashes and bubbles breathe as one
        swell[i] *= L.breath / WATER.swell;
        G[i] = Math.exp(WATER.swell * swell[i]);
      }
      G[nc] = G[0];
      raw = new Float32Array(len); out = new Float32Array(n);
      st[14] = (rE() * 4294967295) | 1; st[15] = (rC() * 4294967295) | 1;   // the two noise streams
    });
    for (k = 0; k < len; k += FALLS.chunk) list.push(rush);
    list.push(function () {
      for (var i = 0; i < fade; i++) {                               // equal-power crossfade → seamless loop
        var a = i / fade;
        raw[i] = raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
      }
    });
    for (b = 0; b < L.splash.length; b++) for (k = 0; k < (L.splash[b].n || 1); k++) list.push(splashes(L.splash[b]));
    for (b = 0; b < L.bubbles.length; b++) for (k = 0; k < (L.bubbles[b].n || 1); k++) list.push(bubbles(L.bubbles[b]));
    for (k = 0; k < n; k += 8 * FALLS.chunk) list.push(mix);
    for (k = 0; k < n; k += 8 * FALLS.chunk) list.push(scale);
    return stretches(list, FALLS.slice);
  }
  /** The falling sheet: rush, spray, splashes. */
  function rawFallsSheet(sr, seconds, ch, seed) { return fallsLayer(FALLS.sheet, sr, seconds, ch, seed); }
  /** The plunge pool: the low end of the rush, gurgles and glugs. */
  function rawFallsPool(sr, seconds, ch, seed) { return fallsLayer(FALLS.pool, sr, seconds, ch, seed); }
  /** The wash around the foot of the fall. */
  function rawFallsWash(sr, seconds, ch, seed) { return fallsLayer(FALLS.wash, sr, seconds, ch, seed); }

  /* ---- drips ------------------------------------------------------------
   * Drops falling, one at a time, into a still pool in a small stone grotto.
   *
   * What is heard when a drop lands is not the splash but the air it drags
   * under: a bubble that rings at its own pitch and dies in a few hundredths
   * of a second. Pinched off just below the surface, it rings higher and
   * higher as it closes, slowly at first and then quickly (f0 / √(1 − t / tc)
   * fits the drops of a cave recording), so each drop is a short tone that
   * curls upward: a plop if the drop was big, a plink if it was small. Often
   * a second, smaller bubble follows a tenth of a second later, and a droplet
   * or two thrown up by the splash fall back, hardly heard.
   *
   * The stone gives every drop back. Each sound is copied eight hundred
   * times a second, a little duller, at random moments and with random
   * signs, fading as the room does (longer for low sounds than for high
   * ones): first a few separate reflections, then too many to tell apart.
   * Both ears hear the same drop, a third of its reflections alike and the
   * rest their own, so the drop has a place and the room has none. Because
   * the copies are of the drop itself, the room rings on at the drop's own
   * pitch, as a real one does, and no two tails are alike. Nothing is tuned:
   * pitches fall anywhere, and glide.
   *
   * Three loops of a few drops each play together, with a faint trickle far
   * off on a fourth. No loop holds two drops close together: the pairs and
   * the long silences happen where the loops meet, and they meet differently
   * every time round. Each loop has a big drop, a small one and one or two
   * between, a loud one and a soft one, some to each side.
   *
   * Levels are set drop by drop, not by the loop's RMS: a loop of drops is
   * silence most of the time. The loudest drops peak where the brook's own
   * peaks are and read, on a sound level meter's fast response, what the
   * brook reads all the time; the long-term RMS is some 13 dB under it.
   *
   * The work is done in steps of a few milliseconds by the clock, whatever
   * the machine: the result does not depend on where the steps fall.
   * ------------------------------------------------------------------- */

  var DRIPS = {
    slice: 4,                                 // ms of work in one step
    amp: 0.56,                                // the loudest drop's amplitude in the loop
    range: 12,                                // dB from the loudest drop of a loop to its softest
    small: 3,                                 // dB by which the smallest drop is softer than the biggest
    f0: 580, f1: 2200, skew: 1.5,             // where a drop's pitch starts, Hz; skew > 1 leans low
    tau: 0.014, tauPow: 0.6, tauSigma: 0.25,  // the ring dies in tau s at 1 kHz; a bigger bubble rings longer
    q0: 0.15, q1: 0.65,                       // the glide: tau / tc (squared draw: every drop curls, a few a lot)
    top0: 1.5, top1: 3.6,                     // the bubble closes when its pitch has risen this many times
    click: 0.4,                               // the tick of the drop touching the water, beside the tone
    second: 0.55,                             // how often a second, smaller bubble follows
    ild: 10, itd: 0.25e-3,                    // a drop fully to one side: dB between the ears, s between them
    gap0: 0.3, gap1: 2.6,                     // the gaps of a loop: these shares of an even one, most of them short
    // the grotto: reverberation time at 1 kHz (× (1 kHz / f)^tilt), the energy it gives back beside
    // the direct sound (more for a drop farther off), the part of it both ears share, reflections
    // per second once they merge, how fast they multiply (per s³: sparse for the first 20 ms),
    // the first one, how dull they are, and how many decay times they are followed for
    room: { t60: 1.6, tilt: 0.3, wet: 0.8, far: 0.6, rho: 0.35, dens: 800, grow: 1.6e6, first: 0.003, lp: 2800, span: 4.6 },
    a: { salt: 1, n: 4 },
    b: { salt: 2, n: 3 },
    c: { salt: 3, n: 3 },
    // the trickle far off, all bubbles: a thin run of them over a murmur of fainter ones.
    // As WATER's bubbles: rate /s, pitch range, median amplitude and its log-normal σ, tilt with
    // pitch, damping × Minnaert's, glide per decay time, how wide they lie; the rate swings
    // (σ of a log-normal) on four slow waves of up to `rfc` Hz that fit the loop.
    // It is far away: little of each bubble comes straight (`direct`), most as `echoes` copies
    // from the stone, within `spread` s or so, each ear its own
    trickle: { direct: 0.5, echoes: 4, spread: 0.07, kinds: [
      { rate: 40, f0: 500, f1: 2300, amp: 0.0094, sigma: 0.7, tilt: -0.3, damp: 1.2, xi: 0.08, rfc: 2, rsigma: 0.6, pan: 0.6 },
      { rate: 200, f0: 400, f1: 1900, amp: 0.0046, sigma: 0.5, tilt: -0.3, damp: 1.6, xi: 0.04, rfc: 1, rsigma: 0.35, pan: 0.8 }
    ] }
  };

  /** 0 … n − 1 in a random order. */
  function shuffled(r, n) {
    var a = [], i, j, t;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { j = (r() * (i + 1)) | 0; t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /** Add `a` × the first `len` samples of `d` to the loop `out` from sample `j` on; what runs past its end wraps. */
  function loopAdd(out, j, d, len, a) {
    var n = out.length, m = len < n - j ? len : n - j, k;
    for (k = 0; k < m; k++) out[j + k] += a * d[k];
    for (j = -m; k < len; k++) out[j + k] += a * d[k];
  }

  /**
   * One ringing bubble, dry, into `d` from its first sample: a tone that starts at
   * `f0` and rises as f0 / √(1 − t / tc) until it has risen `top` times, dying with
   * time constant `tau`, with the tick of its onset. Returns its length in samples.
   */
  function dripTone(d, sr, f0, tau, tc, top, amp, click, r) {
    var len = Math.min(d.length, Math.ceil(sr * Math.min(tc * (1 - 1 / (top * top)), tau * 5.5)));
    var atk = Math.max(2, Math.round(sr * 0.0004)), fade = Math.max(8, Math.round(sr * 0.003));
    var ph0 = r() * TAU, w = TAU * f0 * 2 * tc, dec = Math.exp(-1 / (tau * sr)), e = amp, k;
    for (k = 0; k < len; k++) {
      var g = e, s = Math.sqrt(1 - k / (sr * tc));           // f0 / f
      if (k < atk) g *= k / atk;
      if (k > len - fade) g *= (len - k) / fade;
      d[k] = g / s * Math.sin(ph0 + w * (1 - s));            // a smaller bubble is heard better: × f / f0
      e *= dec;
    }
    var nk = Math.min(len, Math.round(sr * 0.0012));        // the tick: a millisecond of noise
    for (k = 0; k < nk; k++) { var x = 1 - k / nk; d[k] += amp * click * (r() * 2 - 1) * x * x; }
    return len;
  }

  /**
   * More of the reflections of the sound in `dl` (the state `V`: its place in the
   * loop, its length, the room's gain and decay for it, how far it has got), `share`
   * of the room's, their moments and signs drawn from `r`, until the clock reads
   * `until`. True once the room has fallen silent.
   */
  function dripEchoes(out, sr, dl, V, share, r, until) {
    var R = DRIPS.room, n = out.length, t1 = Math.sqrt(R.dens / R.grow), c1 = R.grow * t1 * t1 * t1 / 3, k = 0;
    for (;;) {
      V.c -= Math.log(1 - r()) / share;                      // one more reflection
      var c = V.c, t = c < c1 ? Math.pow(3 * c / R.grow, 1 / 3) : t1 + (c - c1) / R.dens;
      if (t > V.tMax) return true;
      var a = V.G * Math.exp(-t / V.tr) / Math.sqrt(c < c1 ? R.grow * t * t : R.dens);
      loopAdd(out, (V.at + Math.round(t * sr)) % n, dl, V.len, r() < 0.5 ? -a : a);
      if ((++k & 1) === 0 && now() >= until) return false;
    }
  }

  /** The random numbers of a loop's drops, alike in both ears. */
  function dripSeed(seed, L) { return mulberry32(seed * 7919 + 17 + L.salt * 6151); }
  /**
   * The drops of a loop of `n`: one from each part of the range of sizes, of loudness and of
   * places, and when each falls (`when[j]` of `sum`): uneven gaps, none short.
   */
  function dripPlan(rE, n) {
    var P = { size: shuffled(rE, n), loud: shuffled(rE, n), side: shuffled(rE, n), when: [], sum: 0 }, j;
    for (j = 0; j < n; j++) { P.when.push(P.sum); P.sum += DRIPS.gap0 + (DRIPS.gap1 - DRIPS.gap0) * Math.pow(rE(), 2); }
    return P;
  }

  /** One channel of a loop of drops. `L`: its salt and how many drops it holds. */
  function dripLoop(sr, seconds, ch, seed, L) {
    var D = DRIPS, R = D.room, n = Math.floor(sr * seconds), out = new Float32Array(n);
    var rE = dripSeed(seed, L);                                          // the drops: shared by both ears
    var rC = mulberry32(seed * 104729 + 43 + L.salt * 389 + ch * 977);   // this ear's own reflections
    var d = new Float32Array(Math.ceil(sr * 0.26)), dl = new Float32Array(d.length);
    var P = dripPlan(rE, L.n), size = P.size, loud = P.loud, side = P.side, when = P.when, sum = P.sum, j;
    var c0 = R.grow * R.first * R.first * R.first / 3, kl = 1 - Math.exp(-TAU * R.lp / sr);
    var list = [work], sounds = [], V = null, stage = 0;
    j = 0;

    /** The sounds of drop j: the bubble, perhaps a second one, and up to two droplets falling back. */
    function plan(j) {
      var at = Math.floor(when[j] / sum * n), i;
      var x = (size[j] + rE()) / L.n, y = (loud[j] + rE()) / L.n, p = (side[j] + rE()) / L.n * 2 - 1, z = rE();
      var f0 = D.f0 * Math.pow(D.f1 / D.f0, Math.pow(x, D.skew));
      var near = 1 - 0.3 * z, amp = D.amp * near * Math.pow(10, -(D.range * y + D.small * x) / 20);
      var wet = R.wet * (1 + R.far * z) / (near * near);                    // a far drop: less of it, more room
      var tau = D.tau * Math.pow(1000 / f0, D.tauPow) * Math.exp(D.tauSigma * gauss(rE)), u = rE();
      sounds.push({ at: at, f: f0, tau: tau, tc: tau / (D.q0 + (D.q1 - D.q0) * u * u), top: D.top0 + (D.top1 - D.top0) * rE(),
                    amp: amp, click: D.click * (0.6 + 0.8 * rE()), p: p, wet: wet });
      var u2 = rE(), t2 = 0.004 + 0.006 * rE();
      var s2 = { at: at + Math.round((0.045 + 0.13 * rE()) * sr), f: Math.min(3600, f0 * (1.7 + 1.4 * rE())), tau: t2,
                 tc: t2 / (0.1 + 0.3 * rE()), top: 1.6, amp: amp * (0.12 + 0.3 * rE()), click: 0.3 + 0.5 * rE(),
                 p: Math.max(-1, Math.min(1, p + 0.3 * (rE() - 0.5))), wet: wet };
      if (u2 < D.second) sounds.push(s2);
      var nd = (rE() * 3) | 0;
      for (i = 0; i < 2; i++) {
        var s3 = { at: at + Math.round((0.12 + 0.4 * rE()) * sr), f: 2600 + 1600 * rE(), tau: 0.003 + 0.003 * rE(), tc: 0.03, top: 1.4,
                   amp: amp * (0.03 + 0.07 * rE()), click: 0.6, p: Math.max(-1, Math.min(1, p + 0.6 * (rE() - 0.5))), wet: wet };
        if (i < nd) sounds.push(s3);
      }
    }
    /** A sound, dry, into this ear, and the duller copy of it that the stone gives back. */
    function sound(o) {
      var len = dripTone(d, sr, o.f, o.tau, o.tc, o.top, o.amp, o.click, rE), far = ch ? Math.max(0, -o.p) : Math.max(0, o.p), l = 0, k;
      // the far ear hears it later, but never by more than an eighth of its period: the ears stay in step
      var at = o.at + Math.round(sr * Math.min(D.itd * far, 0.125 / o.f)), tr = R.t60 * Math.pow(1000 / o.f, R.tilt) / 6.908;
      var g = Math.pow(10, (ch ? o.p : -o.p) * D.ild / 40);                // this ear's share of it: both together, as much as in the middle
      loopAdd(out, at % n, d, len, g / Math.sqrt((g * g + 1 / (g * g)) / 2));
      for (k = 0; k < len; k++) { l += kl * (d[k] - l); dl[k] = l; }
      return { at: at, len: len, tr: tr, G: Math.sqrt(2 * o.wet / tr), tMax: tr * R.span, c: c0 };
    }
    function work() {
      var until = now() + D.slice;
      for (;;) {
        if (stage === 0) {
          if (!sounds.length) { if (j === L.n) return out; plan(j++); }
          V = sound(sounds.shift());
          stage = 1;
        }
        if (stage === 1) {                                   // the reflections both ears share
          if (!dripEchoes(out, sr, dl, V, R.rho, rE, until)) break;
          V.c = c0; stage = 2;
        }
        if (!dripEchoes(out, sr, dl, V, 1 - R.rho, rC, until)) break;   // and this ear's own
        stage = 0;
        if (now() >= until) break;
      }
      list.push(work);                                       // not done: one more step
      return out;
    }
    return steps(list);
  }

  function rawDripsA(sr, seconds, ch, seed) { return dripLoop(sr, seconds, ch, seed, DRIPS.a); }
  function rawDripsB(sr, seconds, ch, seed) { return dripLoop(sr, seconds, ch, seed, DRIPS.b); }
  function rawDripsC(sr, seconds, ch, seed) { return dripLoop(sr, seconds, ch, seed, DRIPS.c); }

  /** One small bubble into the loop from sample `j`: as waterBubbles' own. */
  function dripBubble(out, j, len, env, dec, ph, dph, rise) {
    var n = out.length, tab = SINE, k;
    for (k = 0; k < 8; k++) {
      out[j] += env * tab[ph & 4095] * k / 8;
      if (++j === n) j = 0;
      ph += dph + rise * k; env *= dec;
    }
    for (; k < len; k++) {
      out[j] += env * tab[ph & 4095];
      if (++j === n) j = 0;                                  // wraps → seamless
      ph += dph + rise * k; env *= dec;
    }
  }

  /**
   * One channel of the trickle far off in the grotto, so that the silence between
   * two drops is never dead. Bubbles only, no noise: the same ones in both ears,
   * each in its place, coming now thicker and now thinner, and each heard mostly
   * as the stone gives it back: a handful of copies, this ear's own.
   */
  function rawDripsTrickle(sr, seconds, ch, seed) {
    var T = DRIPS.trickle, n = Math.floor(sr * seconds), out = new Float32Array(n);
    var rE = mulberry32(seed * 7919 + 9001);                    // the bubbles: shared by both ears
    var rC = mulberry32(seed * 104729 + 71 + ch * 977);         // this ear's own reflections
    var itd = WATER.itd * sr, list = [work], q = 0, C = null, wk = [], wp = [], t, mMax, lam;
    function work() {
      var until = now() + DRIPS.slice, i;
      for (;;) {
        if (!C) {                                            // the next kind of bubble, and the rhythm of its rate
          if (q === T.kinds.length) return out;
          C = T.kinds[q++];
          for (i = 0; i < 4; i++) { wk[i] = TAU * (1 + ((rE() * C.rfc * seconds) | 0)) / seconds; wp[i] = rE() * TAU; }
          mMax = Math.exp(C.rsigma * 2.5); lam = C.rate * mMax; t = 0;
        }
        t += -Math.log(1 - rE()) / lam;                      // a Poisson stream, thinned to its rhythm
        if (t >= seconds) { C = null; continue; }
        var swing = 0.707 * (Math.sin(wk[0] * t + wp[0]) + Math.sin(wk[1] * t + wp[1]) + Math.sin(wk[2] * t + wp[2]) + Math.sin(wk[3] * t + wp[3]));
        var u = rE(), uf = (rE() + rE()) / 2, ua = gauss(rE), ux = rE(), up = rE(), u0 = rE();   // drawn alike in both ears
        if (u * mMax <= Math.exp(C.rsigma * swing - C.rsigma * C.rsigma * 0.5)) {
          var f0 = C.f0 * Math.exp(Math.log(C.f1 / C.f0) * uf);              // most of them mid-range: no edge to the band
          var amp = C.amp * Math.min(WATER.cap, Math.exp(C.sigma * ua)) * Math.pow(f0 / 1000, C.tilt);
          var dmp = C.damp * (0.043 * f0 + 0.0014 * f0 * Math.sqrt(f0));
          var p = (up * 2 - 1) * C.pan, ang = (p + 1) * Math.PI / 4;
          var at = Math.floor(t * sr) + Math.round(itd * (ch ? Math.max(0, -p) : Math.max(0, p)));
          var len = Math.min(n, Math.ceil(sr * 4 / dmp)), dec = Math.exp(-dmp / sr);
          var dph = 4096 * f0 / sr, rise = 4096 * f0 * C.xi * ux * dmp / (sr * sr);
          dripBubble(out, at % n, len, T.direct * amp * 1.414 * (ch ? Math.sin(ang) : Math.cos(ang)), dec, u0 * 4096, dph, rise);
          for (i = 0; i < T.echoes; i++) {
            var te = -Math.log(1 - rC()) * T.spread;
            dripBubble(out, (at + Math.round((0.004 + te) * sr)) % n, len, amp * Math.exp(-te / (2 * T.spread)) * 0.7, dec, rC() * 4096, dph, rise);
          }
        }
        if (now() >= until) break;
      }
      list.push(work);                                       // not done: one more step
      return out;
    }
    return steps(list);
  }

  /* ---- a first hearing ---------------------------------------------------
   * Chosen in the settings, an ambience plays for a few seconds so that it can
   * be heard. A brook can be judged from any five seconds of it; surf and
   * drops cannot. Their loops are not started just anywhere then, but where
   * there is something to hear: these say where (s into the loop), from the
   * seed the loop was made with.
   * ------------------------------------------------------------------- */

  /**
   * The surf in front: 3 s before a wave breaks, as its swell comes up. Of the
   * two waves with the longest wait for the next one, the bigger: it is heard
   * to its end, backwash and all, before another arrives.
   */
  function cueSurf(seconds, seed) {
    var P = SURF.front, o = { P: P, rE: mulberry32(seed * 7919 + P.salt), seconds: seconds, W: [], E: [], nc: 0 }, W, i;
    surfPlan(o);
    W = o.W;                                             // in the order they break; after the last, the first again
    for (i = 0; i < W.length; i++) W[i].gap = (i + 1 < W.length ? W[i + 1].t : W[0].t + seconds) - W[i].t;
    W.sort(function (a, b) { return b.gap - a.gap; });
    return (((W[W[0].big >= W[1].big ? 0 : 1].t - 3) % seconds) + seconds) % seconds;
  }
  /** A loop of drops: `lead` s before its second loudest drop falls. */
  function cueDrip(L, lead) {
    return function (seconds, seed) {
      var P = dripPlan(dripSeed(seed, L), L.n), j = P.loud.indexOf(1);
      return (((P.when[j] / P.sum * seconds - lead) % seconds) + seconds) % seconds;
    };
  }

  /*
   * Each ambience is one or more seamless loops, played together. One
   * defineAmbience per ambience, in the order of Tune's cards: its `id`,
   * `name` and `icon` (what its card shows), and its `layers`. A layer's
   * `make(sr, seconds, ch, seed)` renders one channel; both channels get the
   * same seed. It may return a function instead: the rest of the work, a step
   * per call. `audition`: how long it plays when chosen (5 s if not given),
   * counted from when it is heard; a layer's `cue(seconds, seed)`: where it
   * starts then. An ambience without layers is silence (None).
   *
   * A loop needs no higher rate than its sound: the lower the rate, the longer
   * the loop that fits. At most 8 MB of PCM for an ambience (AMB_BYTES: every
   * layer's two channels of 32-bit samples), and only the chosen one holds any.
   */
  var AMBIENCES = {}, AMBIENCE_ORDER = [];
  var AMB_BYTES = 8e6;
  var AMBIENCE_FIELDS = CARD_FIELDS.concat(['audition', 'layers']), LAYER_FIELDS = ['make', 'seconds', 'sr', 'cue'];

  /** The PCM an ambience holds once it is made, in bytes: two channels of 32-bit samples per layer. */
  function ambienceBytes(d) {
    var n = 0, i;
    for (i = 0; d.layers && i < d.layers.length; i++) n += Math.floor(d.layers[i].sr * d.layers[i].seconds) * 2 * 4;
    return n;
  }
  /**
   * Register an ambience (the record is kept as it is given, and is what the
   * engine reads). One the engine could not make or hold is refused here,
   * when the page loads, by name: a layer without its `make`, its length or
   * its rate, more than 8 MB of PCM in all, or a field that is none of an
   * ambience's or of a layer's.
   */
  function defineAmbience(rec) {
    var what = 'defineAmbience', i, L;
    checkCard(what, rec, AMBIENCES);
    what += ' "' + rec.id + '"';
    checkFields(what, rec, AMBIENCE_FIELDS);
    if (rec.audition !== undefined && !(isNumber(rec.audition) && rec.audition > 0)) throw new Error(what + ': audition is ' + rec.audition + ', not a number of seconds');
    if (rec.layers !== undefined) {
      if (!rec.layers || !(rec.layers.length > 0)) throw new Error(what + ': layers is empty (leave it out for silence)');
      for (i = 0; i < rec.layers.length; i++) {
        L = rec.layers[i];
        if (!L || typeof L.make !== 'function') throw new Error(what + ': layer ' + i + ' has no make(sr, seconds, ch, seed)');
        checkFields(what + ', layer ' + i, L, LAYER_FIELDS);
        if (!(isNumber(L.seconds) && L.seconds > 0)) throw new Error(what + ': layer ' + i + ' is ' + L.seconds + ' seconds long');
        if (!(isNumber(L.sr) && L.sr > 0)) throw new Error(what + ': layer ' + i + ' has the sample rate ' + L.sr);
        if (L.cue !== undefined && typeof L.cue !== 'function') throw new Error(what + ': the cue of layer ' + i + ' is not a function');
      }
      if (ambienceBytes(rec) > AMB_BYTES) {
        throw new Error(what + ': ' + (ambienceBytes(rec) / 1e6).toFixed(2) + ' MB of PCM, more than ' + AMB_BYTES / 1e6 + ' (shorter loops, or lower rates)');
      }
    }
    AMBIENCES[rec.id] = rec;
    AMBIENCE_ORDER.push(rec.id);
    return rec;
  }

  defineAmbience({ id: 'none', name: 'None', icon: ICON_GLASS });
  defineAmbience({
    id: 'brook', name: 'Brook',
    icon: ICON_GLASS + '<path d="M1.6 18.75c.6-.86 1.1-.86 1.7 0s1.1.86 1.7 0M19 18.75c.6-.86 1.1-.86 1.7 0s1.1.86 1.7 0M1.6 16.25c.6-.86 1.1-.86 1.7 0s1.1.86 1.7 0M19 16.25c.6-.86 1.1-.86 1.7 0s1.1.86 1.7 0"/>',
    layers: [
      { make: rawBrookFlow, seconds: 9.3, sr: PRE_SR },
      { make: rawBrookBloops, seconds: 14.3, sr: 24000 }       // ≤ 700 Hz: a lower rate is plenty
    ]
  });
  defineAmbience({
    id: 'rain', name: 'Rain',
    icon: ICON_GLASS + '<path d="M4.2 6.2l-1.1 2.8M4.2 12.2l-1.1 2.8M21 9l-1.1 2.8M21 15l-1.1 2.8"/>',
    layers: [
      { make: rawRain, seconds: 7.9, sr: PRE_SR }
    ]
  });
  // Low-passed as they are, the loops need no more than these rates: 7.9 MB of PCM in all.
  // 61.3 s and 23.3 s: the far loop comes round 0.63 of its length later each time, and
  // the two line up again only after 4 hours. Heard first: one whole wave, swell to backwash.
  defineAmbience({
    id: 'ocean', name: 'Ocean', audition: 12,
    icon: ICON_GLASS + '<path d="M1.6 19.4c.2-2.9 1.4-4.9 3-4.9 1.2 0 1.7 1.2.9 2.1M2.3 12.6h.01M4.7 11.6h.01M22.4 19.4c-.2-2.9-1.4-4.9-3-4.9-1.2 0-1.7 1.2-.9 2.1M21.7 12.6h.01M19.3 11.6h.01"/>',
    layers: [
      { make: rawSurf, seconds: 61.3, sr: 13000, cue: cueSurf },
      { make: rawSurfFar, seconds: 23.3, sr: 8000 }
    ]
  });
  defineAmbience({
    id: 'waterfall', name: 'Waterfall',
    icon: ICON_GLASS + '<path d="M3.4 4.6c-1.3 1.3-1.3 2.3 0 3.6s1.3 2.3 0 3.6-1.3 2.3 0 3.6M1.8 19.4c.5-1.1 1-1.6 1.6-1.6s1.1.5 1.6 1.6M20.6 4.6c-1.3 1.3-1.3 2.3 0 3.6s1.3 2.3 0 3.6-1.3 2.3 0 3.6M19 19.4c.5-1.1 1-1.6 1.6-1.6s1.1.5 1.6 1.6"/>',
    layers: [
      { make: rawFallsSheet, seconds: 12.1, sr: 24000 },       // 121, 313 and 139 tenths share no factor
      { make: rawFallsPool, seconds: 31.3, sr: 12000 },        // all below 1.5 kHz: a low rate buys a long loop
      { make: rawFallsWash, seconds: 13.9, sr: 24000 }
    ]
  });
  // Nothing in a drop rings above 6 kHz and the trickle is duller still: 16 and 12 kHz are plenty,
  // 7.98 MB of PCM in all. 21.7, 18.5 and 15.3 s: the three loops of drops line up again only after 7 days.
  // Heard first: a drop from each loop, 1.2, 3 and 5.2 s in, and whatever else falls meanwhile.
  defineAmbience({
    id: 'drips', name: 'Drips', audition: 9,
    icon: ICON_GLASS + '<path d="M3.5 6c.875 1.16 1.25 1.875 1.25 2.5a1.25 1.25 0 0 1-2.5 0c0-.625.375-1.34 1.25-2.5zM1.8 18.6a1.6 .7 0 1 0 3.2 0a1.6 .7 0 1 0-3.2 0M20.5 9.6c.875 1.16 1.25 1.875 1.25 2.5a1.25 1.25 0 0 1-2.5 0c0-.625.375-1.34 1.25-2.5zM19 18.6a1.6 .7 0 1 0 3.2 0a1.6 .7 0 1 0-3.2 0"/>',
    layers: [
      { make: rawDripsA, seconds: 21.7, sr: 16000, cue: cueDrip(DRIPS.a, 1.2) },
      { make: rawDripsB, seconds: 18.5, sr: 16000, cue: cueDrip(DRIPS.b, 3) },
      { make: rawDripsC, seconds: 15.3, sr: 16000, cue: cueDrip(DRIPS.c, 5.2) },
      { make: rawDripsTrickle, seconds: 9.1, sr: 12000 }
    ]
  });

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
    // Tune's Sound tab: the sand's own level (0..1, heard as its 1.5th power), the bowl's (0..2, 1 as
    // it always was), and whether the page sounds with the ringer switched off (its audio session)
    this.sandLevel = 1;
    this.bowlLevel = 1;
    this.silentRing = true;
    // the stage (headphones, spatial): asked for; carrying the sound; what it is made of; and what it
    // has still to do, each at its time. Off as the app comes.
    this._spatialWant = false;
    this._spatial = false;
    this._stage = null;
    this._stageJobs = [];
    this._bowls = [];         // the completion bowls still ringing: { out, end } (stopChime fades them)
    this._last = {};          // last scheduled value per parameter
    this._cushion = 0;
    this._voices = 0;
    this._silenced = false;
    this.ambience = 'none';   // optional second layer: 'none' | 'brook' | 'rain' | 'ocean' | 'waterfall' | 'drips'
    this.ambLevel = 0.5;
    // Only the chosen ambience holds any sound (and the one before it, while it fades):
    this._ambRaw = {};        // synthesised, by id: [L, R] per layer…
    this._ambBuf = {};        // …wrapped into AudioBuffers once there is a context
    this._ambBake = {};       // …and, while the stage is on, rendered placed for it (as many again)
    this._ambJobs = {};       // being synthesised, by id
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
    this._still = 0;          // how long no stream has flowed: a glass that stands idle, paused or finished (s)
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

  // The registries. CHARACTERS and AMBIENCES are the records by id, as the engine reads
  // them; characters() and ambiences() are what Tune's cards show, in their order.
  HourglassAudio.CHARACTERS = CHARACTERS;
  HourglassAudio.AMBIENCES = AMBIENCES;
  function cards(all, order) {
    var out = [], i;
    for (i = 0; i < order.length; i++) out.push({ id: order[i], name: all[order[i]].name, icon: all[order[i]].icon });
    return out;
  }
  /** The acoustic characters, in the order of their cards: [{ id, name, icon }]. */
  HourglassAudio.characters = function () { return cards(CHARACTERS, CHARACTER_ORDER); };
  /** The ambiences, in the order of their cards: [{ id, name, icon }]. */
  HourglassAudio.ambiences = function () { return cards(AMBIENCES, AMBIENCE_ORDER); };
  HourglassAudio.defineCharacter = defineCharacter;
  HourglassAudio.defineAmbience = defineAmbience;
  // The synthesis itself, for offline tests and measurement.
  HourglassAudio._synth = { microBank: microBank, grainBed: grainBed, limitPeaks: limitPeaks, synthPat: synthPat,
                            synthTink: synthTink, mulberry32: mulberry32, BEDS: BEDS, PRE_SR: PRE_SR, SEED: SAND_SEED,
                            toBuffer: toBuffer, MIN_SR: MIN_SR };

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
      // Let WebKit play through the hardware mute switch like a timer should (unless Tune says not to).
      this._session();
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

  /**
   * The page's audio session, where the browser has one (navigator.audioSession, Safari 16.4 on):
   * 'playback' sounds with the ringer switched off, as a timer should; 'ambient' (Sound in silent
   * mode off) follows the ringer switch and lets other apps' music play on. Never throws.
   */
  HourglassAudio.prototype._session = function () {
    try {
      var s = root.navigator && root.navigator.audioSession;
      if (s) s.type = this.silentRing === false ? 'ambient' : 'playback';
    } catch (e) {}
  };
  /** Sound in silent mode (Tune): on, the page sounds with the ringer off; off, it follows it. At once. */
  HourglassAudio.prototype.setSilentRing = function (on) {
    this.silentRing = !!on;
    this._session();
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
    // the sand's own sounds (the faders above: the stream, its grains, the vessel, the body and
    // the foley, so the thumps, slides, slosh and pours of both sands) pass one more gain on their
    // way to the bus: Tune's Sand level. The bowl and the ambience do not.
    this.gSand = G(this._sandGain());
    this.gSand.connect(this.bus);
    this.gWhisper.connect(this.gSand); this.gTicks.connect(this.gSand);
    this.gBeds.connect(this.gSand); this.gModal.connect(this.gSand); this.gBody.connect(this.gSand);
    this.gFoley.connect(this.gSand); this.gChime.connect(this.bus);
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
    // Then the fade before the end (Tune: 1 while it is off, or while the glass is not in its last stretch).
    this.ambBus = G(0);
    this.ambEnd = G(1);
    this.ambBus.connect(this.ambEnd);
    this.ambEnd.connect(this.comp);
    var aW = this._ambWet = G(0.12); this.ambEnd.connect(aW); aW.connect(this.conv);

    this.ready = true;
    for (var key in BEDS) if (raw[key]) this._bedReady(key);
    if (raw.pink) this._bedReady('pink');
    // the rest still to come, a slice at a time, starting after this tap
    if (this._prepK < PREP.length || this._job) setTimeout(function () { self.prepare(); }, 0);
    if (this.ambience !== 'none') this._loadAmbience(this.ambience);
    this._applyCharacter(0.01);
    this._applyMaster();
    if (this._spatialWant) this._stageBuild();
  };

  /* ----------------------------------------------------------------------
   *  The stage: the glass heard in front of you, on headphones
   *
   *  Off (as the app comes), nothing of this is made and the graph is the
   *  one above, sample for sample. On (setSpatial(true)), the sand's stereo
   *  faders become four bars, each a line across the glass whose two ends
   *  are its left and right channels, and every end is placed between ten
   *  still virtual loudspeakers round the glass: PannerNodes with the
   *  browser's own head-related filters (HRTF), never moved. A lean, a turn
   *  or the phone laid flat changes only the gains into them. A correction
   *  EQ and a trim keep the level and the tone as they were, and a room
   *  computed here (image sources and a noise tail, each image through the
   *  same filters) replaces the desk's small room for the sand. The bowl
   *  rings out in that room, front right, with a small room of its own, and
   *  the water is wide in front and behind: its loops are rendered once
   *  through four more directions and played as they always were.
   *
   *  Frames. The glass's own: x across it (−1 … 1, + its right), y along it
   *  (−1 the far end of the lower bulb, 0 the neck, +1 the top). Seen: the
   *  glass turned by `turn` (its angle with gravity, clockwise as drawn), x
   *  to the listener's right, y up. The speakers: azimuth + to the right,
   *  elevation + up; every elevation on one of the database's 15° rows (it
   *  rounds anything else down to one), and no speaker dead ahead (both
   *  ears the same: inside the head), so the neck is a phantom between two.
   *
   *  The switch never clicks. Nothing that sounds is ever connected or
   *  taken away: the stage is built beside the graph, silent; when its room
   *  is made (which also loads the HRTF's data) and its speakers sound, the
   *  sand crosses over in STAGE.xf seconds (the Sand level's gain falls to
   *  nothing as the stage's rises, both at equal power), and only then,
   *  silent, the faders let go of the old way. Off, the same backwards, and
   *  every node of the stage is let go. One step at a time: a switch thrown
   *  during a crossing is done when the crossing is over.
   * ---------------------------------------------------------------------- */
  var STAGE = {
    //       round the ring from the top, clockwise as seen: [azimuth, elevation]
    ring: [[0, 15], [28, 15], [40, 0], [28, -15], [0, -15], [-28, -15], [-40, 0], [-28, 15]],
    inner: [[-10, 0], [10, 0]],
    gw: 0.8,                      // the glass's half-width, seen, against its half-height
    // the bars: [y along the glass, half-width]; the land's and the rush's y follow the sand. (The
    // pour of a new glass has no bar of its own: it is heard in the neck's.)
    bars: { neck: [-0.25, 0.34], land: [-0.7, 1.0], glass: [0, 0.7], rush: [-0.55, 0.8] },
    // the filters' own colour averaged over the ten speakers, and the low end that two speakers'
    // crosstalk adds to a stereo bus heard by both ears: [type, Hz, Q, dB]
    eq: [['lowshelf', 1800, 0.7, -8], ['peaking', 170, 0.7, -6], ['peaking', 1250, 1.2, 1.5],
         ['peaking', 2400, 1.0, -2.5], ['peaking', 9000, 1.6, 8.5]],
    trim: 1.15,                   // the level, against the sand without the stage
    // and each character's own: how much of it is in which bar, and how alike its two channels
    // are, colours it differently. [trim dB, then six octave bands from 250 Hz to 8 kHz, dB],
    // measured against the same character without the stage (tools/test/audio-spatial.test.js)
    tone: { asmr: [-1.6, -1.5, -0.4, 3.4, 1.1, 1.6, 2.1], warm: [0.6, -4.6, -0.8, 3.3, 1, -0.9, 2.9],
            pure: [-1.4, -2.7, -1.2, 2.2, 0.1, 3.9, 2.5], chime: [0.2, -6.2, -1.9, 2.3, 0, -0.8, 0.4],
            bamboo: [0.4, -1.1, -0.4, 5.7, 3.5, -3.9, -0.9], dune: [-0.9, -3.8, -0.9, 5.1, -0.1, -1.1, 6.1] },
    toneHz: [250, 500, 1000, 2000, 4000, 8000],
    wide: 1.3,                    // the scene, seen, widened across: the generic head hears little of a small angle
    bal: 0.5,                     // dB, + the left ear louder: the filters' own left/right difference
    tau: 0.03,                    // s: how fast a gain glides to a new place
    xf: 0.33,                     // s: the switch's crossfade, either way
    // The bowl, out in the room, front right: its two speakers, how far it stands (m), its level
    // against the bowl without the stage, and its own room: its share, how long it rings (s) and
    // how much of it is tail. One steady signal into both speakers: its place never beats.
    bowl: { at: [[40, -15], [60, -15]], far: 0.8, trim: 0.5, wet: 0.45, rt: 0.36, tail: 1.8 },
    // The water: wide in front, and behind, where it is later (s, left and right), quieter, darker
    // (a low-pass, Hz) and turned by two all-pass sections a side (Hz), so that no two of the four
    // directions say the same. And its tone, against the water without the stage: [type, Hz, Q, dB].
    water: { front: [[-50, 0], [50, 0]], rear: [[-130, 0], [130, 0]], back: 0.6, late: [0.013, 0.019], dark: 6000,
             turn: [[500, 2100], [700, 2900]], lead: 0.1,
             eq: [['peaking', 170, 0.7, -6], ['peaking', 450, 1, -2], ['peaking', 4000, 1.2, -1.5], ['highshelf', 8000, 0.7, 8]] }
  };
  var STAGE_D = Math.PI / 180;

  /** A unit vector (listener facing −z, +x right, +y up) for azimuth and elevation in degrees. */
  function stageDir(az, el) {
    return [Math.sin(az * STAGE_D) * Math.cos(el * STAGE_D), Math.sin(el * STAGE_D), -Math.cos(az * STAGE_D) * Math.cos(el * STAGE_D)];
  }
  /** One still loudspeaker: mono in (a stereo input would be filtered left by left, right by right), distance ours. */
  function stagePanner(ctx, az, el) {
    var p = ctx.createPanner(), v = stageDir(az, el);
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse'; p.refDistance = 1; p.rolloffFactor = 0;
    p.channelCount = 1; p.channelCountMode = 'explicit';
    if (p.positionX) { p.positionX.value = v[0]; p.positionY.value = v[1]; p.positionZ.value = v[2]; }
    else p.setPosition(v[0], v[1], v[2]);
    return p;
  }
  /**
   * The gains of the speakers (the ring's, then the inner pair's) for a point (sx, sy) seen
   * (|(sx, sy)| ≤ 1, beyond it on the ring): constant power between the two ring speakers either
   * side of its angle, between the inner pair by its side, and between the inner pair and the ring
   * by its distance from the neck. Their squares add up to 1; at most four are not 0.
   */
  function stageGains(sx, sy, out) {
    var n = STAGE.ring.length, step = 360 / n, r = Math.sqrt(sx * sx + sy * sy);
    if (r > 1) { sx /= r; sy /= r; r = 1; }
    var phi = Math.atan2(sx, sy) / STAGE_D;
    if (phi < 0) phi += 360;
    var k = Math.floor(phi / step) % n, t = (phi - step * k) / step;
    var ring = Math.sin(r * Math.PI / 2), inner = Math.cos(r * Math.PI / 2);
    var q = sx / 0.5;
    q = q < -1 ? -1 : (q > 1 ? 1 : q);
    for (var i = 0; i < n + 2; i++) out[i] = 0;
    out[k] = ring * Math.cos(t * Math.PI / 2);
    out[(k + 1) % n] = ring * Math.sin(t * Math.PI / 2);
    out[n] = inner * Math.cos((q + 1) * Math.PI / 4);
    out[n + 1] = inner * Math.sin((q + 1) * Math.PI / 4);
    return out;
  }
  /**
   * A filter's taps at the rate `from`, as the same filter at the rate `to`: a windowed sinc, with
   * nothing above half the lower of the two rates. (A loop of water is rendered at its own rate.)
   */
  function stageResample(h, from, to) {
    if (from === to) return h;
    var fc = to < from ? to / from : 1, n = Math.ceil(h.length * to / from), out = new Float32Array(n), half = 16 / fc;
    for (var i = 0; i < n; i++) {
      var x = i * from / to, k0 = Math.ceil(x - half), k1 = Math.floor(x + half), s = 0;
      if (k0 < 0) k0 = 0;
      if (k1 > h.length - 1) k1 = h.length - 1;
      for (var k = k0; k <= k1; k++) {
        var u = x - k, a = Math.PI * fc * u;
        s += h[k] * (u ? Math.sin(a) / a : 1) * (0.5 + 0.5 * Math.cos(Math.PI * u / half));
      }
      out[i] = s * fc * from / to;
    }
    return out;
  }

  /**
   * What the stage needs of the HRTF, computed once for a sample rate, in one offline render:
   *
   *   room   the sand's: a furnished shoebox (3.6 × 2.6 × 4.4 m, the head off centre so the walls
   *          differ), the glass 0.4 m ahead and a little under the eyes, a desk under it. Every
   *          image source up to the second bounce and the desk's, each delayed, scaled and
   *          darkened by its walls and rendered through the HRTF from where it arrives; then a
   *          noise tail whose two ears agree below ~500 Hz and not above, darkening as it dies.
   *          Each ear is then brought to unit energy and its end faded, as makeRoomIR's, so a
   *          character's room level means what it meant.
   *   bowl   the same room heard from where the bowl stands (STAGE.bowl), with more tail.
   *   ears   what each of the water's four directions does to an impulse, at either ear.
   *
   * Rendering it also loads the HRTF's data (an offline context waits for it). Resolves to
   * { room: [L, R], bowl: [L, R], ears: [[L, R] × 4] } (Float32Arrays), or to null where there is
   * no offline context; kept per rate.
   */
  var stageRooms = {};
  function stageRoom(sr) {
    if (stageRooms[sr]) return stageRooms[sr];
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    var W = STAGE.water, Bo = STAGE.bowl, ears = W.front.concat(W.rear);
    var len = Math.floor(sr * 0.42), gap = Math.floor(sr * 0.5), each = Math.ceil(sr * 0.02), tap = Math.ceil(sr * 0.016), off;
    try { off = new OAC(2, 2 * gap + ears.length * each, sr); } catch (e) { return Promise.resolve(null); }
    var L = [3.6, 2.6, 4.4], lis = [1.45, 1.2, 1.7], desk = 0.74, c = 343, B = [[0.78, 0.78], [0.55, 0.8], [0.72, 0.72]];
    var imp = off.createBuffer(1, 1, sr);
    imp.getChannelData(0)[0] = 1;
    /** An impulse at `at` s from (az, el), scaled by g, through a low-pass at `lp` Hz (0: none). */
    var fire = function (at, az, el, g, lp) {
      var s = off.createBufferSource(), gg = off.createGain(), pn = stagePanner(off, az, el < -45 ? -45 : el);
      s.buffer = imp;
      gg.gain.value = g;
      if (lp) {
        var f = off.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.5;
        s.connect(f); f.connect(gg);
      } else s.connect(gg);
      gg.connect(pn); pn.connect(off.destination);
      s.start(at);
    };
    /** Every image of a source at `src`, d0 m from the head, up to the second bounce, and the desk's; from t0 s on. */
    var images = function (src, d0, t0) {
      var add = function (p, g, bounces) {
        var dx = p[0] - lis[0], dy = p[1] - lis[1], dz = p[2] - lis[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        fire(t0 + (d - d0) / c, Math.atan2(dx, -dz) / STAGE_D, Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) / STAGE_D, g * d0 / d, bounces > 1 ? 4500 : 7500);
      };
      for (var nx = -1; nx <= 1; nx++) for (var mx = 0; mx <= 1; mx++)
      for (var ny = -1; ny <= 1; ny++) for (var my = 0; my <= 1; my++)
      for (var nz = -1; nz <= 1; nz++) for (var mz = 0; mz <= 1; mz++) {
        var n = [nx, ny, nz], m = [mx, my, mz], p = [], g = 1, bounces = 0;
        for (var ax = 0; ax < 3; ax++) {
          p.push((1 - 2 * m[ax]) * src[ax] + 2 * n[ax] * L[ax]);
          var lo = Math.abs(n[ax] - m[ax]), hi = Math.abs(n[ax]);      // bounces off the wall at 0 and the one at L
          g *= Math.pow(B[ax][0], lo) * Math.pow(B[ax][1], hi);
          bounces += lo + hi;
        }
        if (bounces > 0 && bounces <= 2) add(p, g, bounces);
      }
      add([src[0], 2 * desk - src[1], src[2]], 0.85, 1);                 // the desk under it
    };
    images([lis[0], lis[1] - 0.05, lis[2] - 0.4], Math.sqrt(0.05 * 0.05 + 0.4 * 0.4), 0);
    var bd = stageDir((Bo.at[0][0] + Bo.at[1][0]) / 2, Bo.at[0][1]);
    images([lis[0] + Bo.far * bd[0], lis[1] + Bo.far * bd[1], lis[2] + Bo.far * bd[2]], Bo.far, gap / sr);
    ears.forEach(function (a, i) { fire((2 * gap + i * each) / sr, a[0], a[1], 1, 0); });
    var done = new Promise(function (res) {
      off.oncomplete = function (e) { res(e.renderedBuffer); };    // (an older WebKit's offline context has no promise)
      var r = off.startRendering();
      if (r && r.then) r.then(res, function () { res(null); });
    });
    /**
     * The images from frame `from` on, and their tail: `share` of their energy, ringing `rt` s. Each
     * ear brought to unit energy; or, `side`, the two together (a source off to one side keeps the
     * louder ear its room gives it).
     */
    var tailed = function (buf, from, seed, rt, share, side) {
      var r = mulberry32(seed), onset = 0.018, kc = 1 - Math.exp(-TAU * 500 / sr);
      var lc = 0, hl = [0, 0], tl = [0, 0], early = 0, et = 0, i, ch, out = [], tail = [new Float32Array(len), new Float32Array(len)];
      for (ch = 0; ch < 2; ch++) {
        var e0 = buf.getChannelData(ch).subarray(from, from + len);
        out.push(new Float32Array(e0));
        for (i = 0; i < len; i++) early += e0[i] * e0[i];
      }
      for (i = 0; i < len; i++) {
        var t = i / sr, env = t < onset ? 0 : Math.exp(-6.9 * (t - onset) / rt) * Math.min(1, (t - onset) / 0.015);
        var k = 1 - Math.exp(-TAU * (1800 + 7000 * Math.exp(-t / 0.08)) / sr);
        lc += kc * ((r() * 2 - 1) - lc);
        for (ch = 0; ch < 2; ch++) {
          var w = r() * 2 - 1;
          hl[ch] += kc * (w - hl[ch]);                        // each ear's own lows, thrown away
          tl[ch] += k * ((w - hl[ch]) + 1.2 * lc - tl[ch]);   // its own highs and the shared lows
          tail[ch][i] = tl[ch] * env;
          et += tail[ch][i] * tail[ch][i];
        }
      }
      var tg = Math.sqrt(share * early / et), en = [0, 0];
      for (ch = 0; ch < 2; ch++) {
        for (i = 0; i < len; i++) { out[ch][i] += tail[ch][i] * tg; en[ch] += out[ch][i] * out[ch][i]; }
      }
      if (side) en[0] = en[1] = (en[0] + en[1]) / 2;
      for (ch = 0; ch < 2; ch++) {
        var dd = out[ch], k1 = 1 / Math.sqrt(en[ch]);
        for (i = 0; i < len; i++) dd[i] *= k1;
        for (i = len - 256; i < len; i++) dd[i] *= (len - i) / 256;
      }
      return out;
    };
    stageRooms[sr] = done.then(function (buf) {
      if (!buf) return null;
      return {
        room: tailed(buf, 0, 0x51ab1e, 0.3, 1.4),
        bowl: tailed(buf, gap, 0xb0771e, Bo.rt, Bo.tail, true),
        ears: ears.map(function (a, i) {
          var at = 2 * gap + i * each;
          return [new Float32Array(buf.getChannelData(0).subarray(at, at + tap)), new Float32Array(buf.getChannelData(1).subarray(at, at + tap))];
        })
      };
    });
    return stageRooms[sr];
  }

  /**
   * A live context's HRTF speakers are silent until the browser has loaded its filters. Resolves
   * true once one is heard to sound (at once for a context rendered offline, which waits for
   * them by itself), false if none has within 5 s of the context running, or the context has
   * stood still for a minute.
   */
  function stageHears(ctx) {
    if (typeof ctx.startRendering === 'function' || !ctx.createAnalyser || !ctx.createOscillator) return Promise.resolve(true);
    return new Promise(function (res) {
      var o = ctx.createOscillator(), p = stagePanner(ctx, 30, 0), an = ctx.createAnalyser(), z = ctx.createGain(), n = 0, idle = 0, buf;
      an.fftSize = 256;
      buf = an.getFloatTimeDomainData ? new Float32Array(256) : new Uint8Array(256);
      z.gain.value = 0;
      o.frequency.value = 1000;
      o.connect(p); p.connect(an); an.connect(z); z.connect(ctx.destination);   // (through a shut gain: nothing of it is heard)
      o.start();
      (function look() {
        var heard = false, i;
        if (ctx.state === 'running') {
          n++;
          if (an.getFloatTimeDomainData) { an.getFloatTimeDomainData(buf); for (i = 0; i < 256; i++) if (buf[i] !== 0) heard = true; }
          else { an.getByteTimeDomainData(buf); for (i = 0; i < 256; i++) if (buf[i] !== 128) heard = true; }
        }
        else idle++;
        if (!heard && n < 100 && idle < 240 && ctx.state !== 'closed') { setTimeout(look, ctx.state === 'running' ? 50 : 250); return; }
        try { o.stop(); } catch (e) {}
        try { o.disconnect(); p.disconnect(); an.disconnect(); z.disconnect(); } catch (e2) {}
        res(heard);
      })();
    });
  }

  /**
   * One loop of water (an AudioBuffer, at its own rate), placed: its left and right from the two
   * directions in front, and again from the two behind, later, quieter, darker and turned
   * (STAGE.water), each through what that direction does at either ear (`ears`, taken at the
   * context's rate and brought to the loop's). Rendered offline, away from the page's thread,
   * going round: the render starts W.lead s before the loop's end, so what is kept
   * begins with everything the end leaves ringing, and the loop closes on itself as it did. Then
   * it is brought to the level it had (its power over both ears and the whole loop). `cb` gets the
   * new AudioBuffer, as long as the old one, or null where it cannot be made.
   */
  function stageWater(ears, buf, ctx, cb) {
    var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext, W = STAGE.water;
    var R = buf.sampleRate, N = buf.length, pre = Math.ceil(R * W.lead), oc, i, once = false;
    try {
      oc = new OAC(2, N + pre, R);
      var src = oc.createBufferSource(), sp = oc.createChannelSplitter(2), mix = oc.createGain(), last = mix;
      src.buffer = buf; src.loop = true;
      src.connect(sp);
      W.eq.forEach(function (e) {
        if (e[1] > 0.45 * R) return;                         // (nothing of the loop is up there)
        var b = oc.createBiquadFilter();
        b.type = e[0]; b.frequency.value = e[1]; b.Q.value = e[2]; b.gain.value = e[3];
        last.connect(b); last = b;
      });
      last.connect(oc.destination);
      var ear = function (k) {
        var cv = oc.createConvolver(), l = stageResample(ears[k][0], ctx.sampleRate, R), r = stageResample(ears[k][1], ctx.sampleRate, R);
        var b = oc.createBuffer(2, l.length, R);
        b.getChannelData(0).set(l); b.getChannelData(1).set(r);
        cv.normalize = false; cv.channelCount = 1; cv.channelCountMode = 'explicit';
        cv.buffer = b;
        cv.connect(mix);
        return cv;
      };
      for (i = 0; i < 2; i++) {
        sp.connect(ear(i), i);
        var at = oc.createDelay(0.1), g = oc.createGain();
        at.delayTime.value = W.late[i];
        g.gain.value = W.back;
        sp.connect(at, i);
        [['lowpass', W.dark]].concat(W.turn[i].map(function (f) { return ['allpass', f]; })).forEach(function (f) {
          if (f[1] > 0.45 * R) return;
          var b = oc.createBiquadFilter();
          b.type = f[0]; b.frequency.value = f[1]; b.Q.value = 0.7;
          at.connect(b); at = b;
        });
        at.connect(g); g.connect(ear(2 + i));
      }
      src.start(0, (N - pre) % N / R);
    } catch (e) { cb(null); return; }
    var got = function (rb) {
      if (once) return;
      once = true;
      if (!rb) { cb(null); return; }
      // (the page's thread again: a stretch for the two powers, a stretch for the copy)
      setTimeout(function () {
        var pr = 0, pb = 0, c, n, out, a, b;
        try { out = ctx.createBuffer(2, N, R); } catch (e) { cb(null); return; }
        for (c = 0; c < 2; c++) {
          a = buf.getChannelData(c < buf.numberOfChannels ? c : 0); b = rb.getChannelData(c);
          for (n = 0; n < N; n++) { pr += a[n] * a[n]; pb += b[pre + n] * b[pre + n]; }
        }
        var k = pb > 0 ? Math.sqrt(pr / pb) : 1;
        setTimeout(function () {
          for (c = 0; c < 2; c++) {
            a = out.getChannelData(c); b = rb.getChannelData(c);
            for (n = 0; n < N; n++) a[n] = k * b[pre + n];
          }
          cb(out);
        }, 0);
      }, 0);
    };
    oc.oncomplete = function (e) { got(e.renderedBuffer); };
    try {
      var p = oc.startRendering();
      if (p && p.then) p.then(got, function () { got(null); });
    } catch (e2) { got(null); }
  }

  // (for the tests: the stage's numbers, its gains, its room, and the water's rendering)
  HourglassAudio._stage = { STAGE: STAGE, gains: stageGains, room: stageRoom, water: stageWater, resample: stageResample, hears: stageHears };

  /**
   * Headphones, spatial (the stage, above): on, the sand is heard as an object in front of the
   * listener, the bowl out in the room and the water all round; off, the graph is the one it
   * always was. May be called before there is a context (the stage is then built with the
   * graph), and at any time: a crossing under way is finished first. Resolves once the stage has
   * begun to carry the sound (true: its room is made, its speakers sound, the crossfade is set),
   * or false: switched off, nothing to build yet, or a browser that cannot do it (the sound then
   * stays as it was).
   */
  HourglassAudio.prototype.setSpatial = function (on) {
    on = !!on;
    this._spatialWant = on;
    var S = this._stage;
    if (!this.ready) return Promise.resolve(false);
    if (on) return (S || this._stageBuild()).ready;       // (one that is leaving comes back once it has left)
    if (S && S.x === 0) this._stageDown(S);
    else if (S && S.x === 2) this._stageOut(S);
    return Promise.resolve(false);
  };

  /**
   * Build the stage beside the graph, silent and fed by nothing (x: 0); when its room is made,
   * the chosen water rendered and its speakers heard, cross over to it (_stageIn).
   */
  HourglassAudio.prototype._stageBuild = function () {
    var ctx = this.ctx, self = this, i, n = STAGE.ring.length + 2;
    var G = function (v) { var g = ctx.createGain(); g.gain.value = v; return g; };
    // x: 0 built, 1 crossing in, 2 on, 3 crossing out, 4 gone
    var S = this._stage = { x: 0, xEnd: 0, s: 1, p: 0, th: NaN, flat: 0, flatAt: 0, at: null, conv: null, ir: null, baking: null,
                            nodes: [], src: [], tmp: new Float32Array(n) };
    var keep = function (nd) { S.nodes.push(nd); return nd; };
    // the still speakers into one sum; its correction, its level and its balance; the crossfade; the Sand level;
    // then the output chain, and from there its own send to its room (the bus, and the desk's room after it,
    // keep what they had: the Sand level's old gain, shut, and a bowl that was ringing when the switch was thrown)
    var sum = keep(G(1)), last = sum;
    S.spk = [];
    for (i = 0; i < n; i++) {
      var a = i < n - 2 ? STAGE.ring[i] : STAGE.inner[i - n + 2], p = keep(stagePanner(ctx, a[0], a[1]));
      p.connect(sum);
      S.spk.push(p);
    }
    STAGE.eq.forEach(function (e) {
      var b = keep(ctx.createBiquadFilter());
      b.type = e[0]; b.frequency.value = e[1]; b.Q.value = e[2]; b.gain.value = e[3];
      last.connect(b); last = b;
    });
    S.tone = STAGE.toneHz.map(function (f) {
      var b = keep(ctx.createBiquadFilter());
      b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.41; b.gain.value = 0;
      last.connect(b); last = b;
      return b;
    });
    var trim = keep(G(STAGE.trim)), sp = keep(ctx.createChannelSplitter(2)), mg = keep(ctx.createChannelMerger(2));
    var gl = keep(G(Math.pow(10, STAGE.bal / 40))), gr = keep(G(Math.pow(10, -STAGE.bal / 40)));
    S.xf = keep(G(0)); S.lvl = keep(G(this._sandGain())); S.wet = keep(G(0));
    last.connect(trim); trim.connect(sp); sp.connect(gl, 0); sp.connect(gr, 1);
    gl.connect(mg, 0, 0); gr.connect(mg, 0, 1); mg.connect(S.xf); S.xf.connect(S.lvl); S.lvl.connect(this.rumble); S.lvl.connect(S.wet);
    S.trim = trim;
    this._stageTone(0);
    // one end of a bar: a mono signal with a gain into each speaker, linked only while it reaches it
    var end = function (split, ch) {
      var e = { inp: keep(G(1)), g: [], on: [], zero: [] };
      e.inp.channelCount = 1; e.inp.channelCountMode = 'explicit';
      split.connect(e.inp, ch);
      for (var j = 0; j < n; j++) { var gj = keep(G(0)); gj.connect(S.spk[j]); e.g.push(gj); e.on.push(false); e.zero.push(0); }
      return e;
    };
    var bar = function (def) {
      var inp = keep(G(1)), s2 = keep(ctx.createChannelSplitter(2));
      inp.channelCount = 2; inp.channelCountMode = 'explicit';
      inp.connect(s2);
      return { y: def[0], w: def[1], inp: inp, L: end(s2, 0), R: end(s2, 1) };
    };
    var B = S.bars = {};
    S.order = [];
    for (var key in STAGE.bars) { B[key] = bar(STAGE.bars[key]); S.order.push(key); }
    // What feeds them, joined on only as the stage comes in (_stageIn), and nothing taken from where
    // it goes: the hush to the neck, the grains and the crackle to the landings, the glass's ring,
    // its body and the foley to the glass. The foley fader also carries the pour, the slide and the
    // air, which have places of their own (the neck, the rush's bar): they are taken out of the
    // glass's bar again by adding them once more, turned over, at the foley's own gain.
    var fol = this.gFoley.gain.value, neg = keep(G(-fol)), rush = keep(G(fol)), pour = keep(G(fol));
    var feed = function (from, to) { S.src.push([from, to]); };
    feed(this.gWhisper, B.neck.inp);
    feed(this.pEnv, pour); pour.connect((B.pour || B.neck).inp);
    feed(this.gTicks, B.land.inp); feed(this.gBeds, B.land.inp);
    feed(this.gModal, B.glass.inp); feed(this.gBody, B.glass.inp); feed(this.gFoley, B.glass.inp);
    feed(this.pEnv, neg); feed(this.rPan, neg); feed(this.aPan, neg); neg.connect(B.glass.inp);
    feed(this.rPan, rush); feed(this.aPan, rush); rush.connect(B.rush.inp);
    // the bowl's place: the left of its beating pairs (each ear of the bowl beats as the whole does),
    // one signal into both its speakers and into its own room; joined to the output chain (past the
    // bus: the desk's room has no part in it) only while a bowl rings
    var Bo = STAGE.bowl, bw = S.bowl = { inp: G(1), out: G(1), conv: null, on: false, end: 0, gone: false, nodes: [] };
    var bsp = ctx.createChannelSplitter(2), one = G(Bo.trim);
    bw.send = G(Bo.wet);
    bw.inp.channelCount = 2; bw.inp.channelCountMode = 'explicit';
    one.channelCount = 1; one.channelCountMode = 'explicit';
    bw.inp.connect(bsp); bsp.connect(one, 0); one.connect(bw.send);
    bw.nodes.push(bw.inp, bw.out, bsp, one, bw.send);
    Bo.at.forEach(function (d) { var bp = stagePanner(ctx, d[0], d[1]); one.connect(bp); bp.connect(bw.out); bw.nodes.push(bp); });
    var room = function (pair) {
      var buf = ctx.createBuffer(2, pair[0].length, ctx.sampleRate), cv = ctx.createConvolver();
      buf.getChannelData(0).set(pair[0]); buf.getChannelData(1).set(pair[1]);
      cv.normalize = false; cv.channelCount = 1; cv.channelCountMode = 'explicit';
      cv.buffer = buf;
      return cv;
    };
    S.ready = new Promise(function (res) {
      var settled = false;
      var settle = function (ok) {
        if (settled) return;
        settled = true;
        if (self._stage !== S || S.x !== 0) { res(false); return; }
        if (!ok || !self._spatialWant) { self._stageDown(S); res(false); return; }
        self._stageIn(S);
        res(true);
      };
      // (its speakers first: by the time they sound the browser has the HRTF's data, and the room's
      // render need not wait for it: a render that has to has been seen never to end)
      stageHears(ctx).then(function (ok) {
        if (!ok || self._stage !== S) return null;
        // (a browser whose render never ends all the same: after 8 s the sound stays as it is, and the next try renders anew)
        if (typeof ctx.startRendering !== 'function') setTimeout(function () { if (!settled) { delete stageRooms[ctx.sampleRate]; settle(false); } }, 8000);
        return stageRoom(ctx.sampleRate);
      }).then(function (ir) {
        if (!ir || self._stage !== S) return false;
        S.ir = ir;
        S.conv = keep(room(ir.room)); S.wet.connect(S.conv); S.conv.connect(self.rumble);
        bw.conv = room(ir.bowl); bw.send.connect(bw.conv); bw.nodes.push(bw.conv);
        var id = self.ambience;
        if (id === 'none' || !(self._ambBuf[id] || self._ambRaw[id])) return true;
        return new Promise(function (r2) { self._stageBake(id, function () { r2(true); }); });
      }).then(settle, function () { settle(false); });
    });
    return S;
  };

  /** The character's own correction (STAGE.tone) and its room level, gliding over tau s (0: at once). */
  HourglassAudio.prototype._stageTone = function (tau) {
    var S = this._stage, c = STAGE.tone[this.character] || [0, 0, 0, 0, 0, 0, 0], t = this.ctx.currentTime;
    var v = STAGE.trim * Math.pow(10, c[0] / 20), room = (CHARACTERS[this.character] || CHARACTERS.asmr).room;
    if (tau) S.trim.gain.setTargetAtTime(v, t, tau); else S.trim.gain.value = v;
    if (tau) S.wet.gain.setTargetAtTime(room, t, tau); else S.wet.gain.value = room;
    for (var i = 0; i < S.tone.length; i++) {
      if (tau) S.tone[i].gain.setTargetAtTime(c[i + 1], t, tau); else S.tone[i].gain.value = c[i + 1];
    }
  };

  /** The six faders that go to the Sand level, in the order _build joined them. */
  HourglassAudio.prototype._stageFaders = function () {
    return [this.gWhisper, this.gTicks, this.gBeds, this.gModal, this.gBody, this.gFoley];
  };

  /** Cross over to the stage (x: 1): its feeds joined on, the Sand level's gain down as the stage's comes up, the rooms' sends and the water with them. */
  HourglassAudio.prototype._stageIn = function (S) {
    var self = this, ctx = this.ctx, t = ctx.currentTime + 0.01, d = STAGE.xf, g = this.gSand.gain, v = g.value, i;
    for (i = 0; i < S.src.length; i++) S.src[i][0].connect(S.src[i][1]);
    this._spatial = true;
    this._stageAt(0, this._fill, 0, -1, 0, 0);
    S.lvl.gain.value = this._sandGain();
    try { g.cancelScheduledValues(t); } catch (e) {}
    xfade(g, t, d, v, true);
    xfade(S.xf.gain, t, d, 1, false);
    // the water's send goes to the computed room (the desk's rings out by itself)
    this._ambWet.disconnect(this.conv); this._ambWet.connect(S.conv);
    this._ambSwap(true, t, d);
    S.x = 1; S.xEnd = t + d;
    this._stageLater(S.xEnd + 0.02, function () { self._stageCrossed(S); });
    this._stageWater();
  };

  /** Cross back (x: 3): the faders join the Sand level's gain again while it is shut, and it comes up as the stage's goes down. */
  HourglassAudio.prototype._stageOut = function (S) {
    var self = this, ctx = this.ctx, t = ctx.currentTime + 0.01, d = STAGE.xf, f = this._stageFaders(), i;
    for (i = 0; i < f.length; i++) f[i].connect(this.gSand);
    this._spatial = false;
    xfade(this.gSand.gain, t, d, this._sandGain(), false);
    xfade(S.xf.gain, t, d, 1, true);
    this._ambWet.disconnect(S.conv); this._ambWet.connect(this.conv);
    this._ambSwap(false, t, d);
    S.x = 3; S.xEnd = t + d;
    this._stageLater(S.xEnd + 0.02, function () { self._stageCrossed(S); });
  };

  /** A crossing is over: in, the faders let go of the Sand level's gain (shut by now); out, the stage is taken down. Then whatever was asked for meanwhile. */
  HourglassAudio.prototype._stageCrossed = function (S) {
    if (this._stage !== S) return;
    if (S.x === 1) {
      var f = this._stageFaders();
      for (var i = 0; i < f.length; i++) f[i].disconnect(this.gSand);
      S.x = 2;
      if (!this._spatialWant) this._stageOut(S);
    } else if (S.x === 3) {
      this._stageDown(S);
      if (this._spatialWant) this._stageBuild();
    }
  };

  /** Take the stage down: silent by now (never built up, or crossed out of), every node of it let go; a bowl still ringing in it rings out first. */
  HourglassAudio.prototype._stageDown = function (S) {
    var t = this.ctx.currentTime, was = S.x, B = S.bowl, i;
    if (was === 4) return;
    S.x = 4;
    if (was) for (i = 0; i < S.src.length; i++) { try { S.src[i][0].disconnect(S.src[i][1]); } catch (e) {} }
    S.nodes.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
    B.gone = true;
    if (!B.on) B.nodes.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
    if (this._stage === S) { this._stage = null; this._spatial = false; }
    this._ambBake = {};
    // (the Sand level may have been set while the stage had the sand)
    if (was) this.gSand.gain.setTargetAtTime(this._sandGain(), t, 0.05);
  };

  /**
   * Do `fn` once the context's time has passed T. Every update() and hold() looks (_stageStep);
   * so does a timer of its own, for a hidden page that runs neither (not for a context rendered
   * offline, whose time is not the clock's).
   */
  HourglassAudio.prototype._stageLater = function (T, fn) {
    var self = this, ctx = this.ctx, job = [T, fn];
    this._stageJobs.push(job);
    if (typeof ctx.startRendering === 'function') return;
    setTimeout(function again() {
      self._stageStep();
      // (not yet: the context stood still meanwhile. Once more while it runs; else the next update() sees to it)
      if (self._stageJobs.indexOf(job) >= 0 && ctx.state === 'running') setTimeout(again, Math.max(50, (T - ctx.currentTime) * 1000 + 30));
    }, Math.max(0, (T - ctx.currentTime) * 1000) + 30);
  };
  HourglassAudio.prototype._stageStep = function (t) {
    var jobs = this._stageJobs, i = 0;
    if (t === undefined) t = this.ctx.currentTime;
    while (i < jobs.length) {
      if (jobs[i][0] <= t) jobs.splice(i, 1)[0][1]();
      else i++;
    }
  };

  /** A bowl rings until `end`: the stage's place for it joins the mix (if it has not), and leaves it a second after the last one has rung out. Returns where the bowl goes in. */
  HourglassAudio.prototype._stageBowl = function (end) {
    var self = this, B = this._stage.bowl;
    if (!B.on) { B.out.connect(this.rumble); B.conv.connect(this.rumble); B.on = true; }
    if (end > B.end) B.end = end;
    this._stageLater(end + 1, function () {
      if (!B.on || self.ctx.currentTime < B.end + 1) return;       // (rung again since: that one's turn)
      B.on = false;
      try { B.out.disconnect(); B.conv.disconnect(); } catch (e) {}
      if (B.gone) B.nodes.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
    });
    return B.inp;
  };

  /**
   * Render the loops of the ambience `id` placed (stageWater, a layer at a time), then `done`:
   * once, when they are made, when they cannot be, or after 3 s (the water then plays on as it
   * is, and crosses over when they are made after all).
   */
  HourglassAudio.prototype._stageBake = function (id, done) {
    var self = this, S = this._stage, bufs = S && S.ir && !this._ambBake[id] ? this._ambWrap(id) : null;
    if (!bufs) { if (done) done(); return; }
    var job = S.baking;
    if (job && job.id === id) { job.wait.push(done); return; }
    job = S.baking = { id: id, wait: [done], late: false };
    var out = [], i = 0;
    var tell = function () { var w = job.wait; job.wait = []; for (var k = 0; k < w.length; k++) if (w[k]) w[k](); };
    var finish = function (ok) {
      if (S.baking === job) S.baking = null;
      if (ok) { out.seed = bufs.seed; self._ambBake[id] = out; }
      tell();
      if (ok && job.late) self._stageWater();
    };
    if (typeof this.ctx.startRendering !== 'function') setTimeout(function () { job.late = true; tell(); }, 3000);
    (function next() {
      if (self._stage !== S || S.x === 4 || self.ambience !== id) { finish(false); return; }
      if (i === bufs.length) { finish(true); return; }
      stageWater(S.ir.ears, bufs[i], self.ctx, function (b) {
        if (!b) { finish(false); return; }
        out.push(b); i++;
        setTimeout(next, 0);
      });
    })();
  };

  /** The water that plays, placed (the stage is in): rendered if it is not yet, then crossed over to. */
  HourglassAudio.prototype._stageWater = function () {
    var self = this, a = this._amb;
    if (!this._spatial || !a || a.baked) return;
    this._stageBake(a.id, function () {
      if (self._spatial) self._ambSwap(true, self.ctx.currentTime + 0.01, STAGE.xf);
    });
  };

  /**
   * Place the bars for a glass turned by `th` (rad, its angle with gravity, clockwise as
   * drawn), its lower bulb `fill` full and its upper `fillTop`, its sliding sand in the bulb
   * `slide` (+1 the upper, −1 the lower, between while it crosses), `flat` 0 or 1 (the phone
   * laid on its back), gliding over `tau` s (0: at once). The bars stay in the glass: across it
   * from −w to w, at their place along it. Where sand falls (the stream's hush, the landings) is
   * the bulb below in the room, so those bars cross through the neck as the glass passes level.
   */
  HourglassAudio.prototype._stageAt = function (th, fill, fillTop, slide, flat, tau) {
    var S = this._stage, B = S.bars, c = Math.cos(th), sn = Math.sin(th), GW = STAGE.gw, n = S.spk.length;
    var lv = 2 * c;
    lv = lv < -1 ? -1 : (lv > 1 ? 1 : lv);                    // +1: the lower bulb below; −1: above; between: crossing
    var y = { neck: B.neck.y * lv, glass: B.glass.y, rush: -B.rush.y * slide,
              land: -lv * (0.95 - 0.6 * (lv >= 0 ? fill : fillTop)) };
    if (B.pour) y.pour = B.pour.y * lv;
    var now = this.ctx.currentTime, g = S.tmp, s = S.s;
    for (var b = 0; b < S.order.length; b++) {
      var key = S.order[b], br = B[key];
      for (var side = 0; side < 2; side++) {
        // the channel's end of the bar, in the glass (s: −1 while the glass's ends are swapped since the stage was built)
        var gx = (side ? br.w : -br.w) * s, gy = y[key];
        var sx = (GW * gx * c + gy * sn) * STAGE.wide, sy = -GW * gx * sn + gy * c;
        if (flat) sy = (1 - flat) * sy + flat * (-0.6 + 0.3 * sy);   // laid on the desk: lower, flatter
        stageGains(sx, sy, g);
        var e = side ? br.R : br.L;
        for (var j = 0; j < n; j++) {
          if (g[j] > 0 && !e.on[j]) { e.g[j].gain.value = 0; e.inp.connect(e.g[j]); e.on[j] = true; }
          if (!e.on[j]) continue;
          if (tau) e.g[j].gain.setTargetAtTime(g[j], now, tau);
          else { e.g[j].gain.cancelScheduledValues(now); e.g[j].gain.value = g[j]; }
          if (g[j] > 0) e.zero[j] = 0;
          else if (!e.zero[j]) e.zero[j] = now + 10 * (tau || 0.01);
          else if (now > e.zero[j]) { e.inp.disconnect(e.g[j]); e.on[j] = false; e.zero[j] = 0; }
        }
      }
    }
    S.at = [th + S.p * Math.PI, fill, fillTop, slide, flat];
  };

  /**
   * update()'s share of the stage: what the app tells it of the glass (st.turn, st.fill,
   * st.fillTop, st.slide, st.pose), and the bars placed again only when that has changed enough
   * to hear: a still glass schedules nothing. The end of a turn snaps the angle back by half a
   * turn as the glass's ends swap; the stage swaps its own with it (s), so nothing jumps.
   */
  HourglassAudio.prototype._stagePlace = function (st, t) {
    var S = this._stage, th = typeof st.turn === 'number' && st.turn === st.turn ? st.turn : (st.angle || 0), d;
    if (S.th === S.th) {
      d = th - S.th;
      d -= TAU * Math.round(d / TAU);
      if (d > 2.2 || d < -2.2) { S.s = -S.s; S.p ^= 1; }
    }
    S.th = th;
    var fill = st.fill > 0 ? (st.fill < 1 ? st.fill : 1) : 0;
    var top = st.fillTop > 0 ? (st.fillTop < 1 ? st.fillTop : 1) : 0;
    var slide = st.slide >= -1 && st.slide <= 1 ? st.slide : -1;
    // the phone laid on its back (or face down) for a second: the glass lies on the desk
    var pz = st.pose > 0 ? st.pose : -(st.pose || 0);
    var want = pz >= 0.85 ? 1 : (pz <= 0.6 ? 0 : S.flat);
    if (want !== S.flat) { if (!S.flatAt) S.flatAt = t; if (t - S.flatAt >= 1) { S.flat = want; S.flatAt = 0; } }
    else S.flatAt = 0;
    var a = S.at;
    d = th + S.p * Math.PI - a[0];
    d -= TAU * Math.round(d / TAU);
    if (d < STAGE_D && d > -STAGE_D && Math.abs(fill - a[1]) < 0.02 && Math.abs(top - a[2]) < 0.02 &&
        Math.abs(slide - a[3]) < 0.05 && S.flat === a[4]) return;
    this._stageAt(th, fill, top, slide, S.flat, STAGE.tau);
  };
  /** A one-shot's place for the stage: `gx`, across the glass in its own frame, if the app gave it, else `pan`. */
  HourglassAudio.prototype._stageX = function (pan, gx) {
    return typeof gx === 'number' && gx === gx ? gx * this._stage.s : pan;
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
    if (this._stage) this._stageTone(tau);
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
  /** The sand's own level, 0..1 (Tune's Sand 0..100 over 100); heard as its 1.5th power, as the ambience's level is. */
  HourglassAudio.prototype._sandGain = function () { return Math.pow(this.sandLevel, 1.5); };
  HourglassAudio.prototype.setSandLevel = function (v) {
    this.sandLevel = Math.max(0, Math.min(1, +v || 0));
    if (!this.ready) return;
    // (while the stage has the sand, its own gain is the Sand level: the other is shut, and gets its level back with the sand)
    var S = this._stage;
    (S && S.x ? S.lvl : this.gSand).gain.setTargetAtTime(this._sandGain(), this.ctx.currentTime, 0.05);
  };
  /** The completion bowl's level, 0..2 (Tune's Bowl 0..100 over 50): 1 is the bowl as it always was, 2 is 6 dB more. */
  HourglassAudio.prototype.setBowlLevel = function (v) {
    this.bowlLevel = Math.max(0, Math.min(2, +v || 0));
  };

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
      if (self._ambJobs[id] !== job) return;            // another one was chosen meanwhile: let it go
      var li = job.k >> 1, ch = job.k & 1, L = d.layers[li];
      var r = job.step ? job.step() : L.make(L.sr, L.seconds, ch, job.seed);   // both ears: one seed
      job.step = typeof r === 'function' ? r : null;
      if (!job.step) {                                  // this channel is done
        if (!ch) job.out[li] = [];
        job.out[li][ch] = r;
        job.k++;
      }
      if (job.k < d.layers.length * 2) { setTimeout(next, 30); return; }
      job.out.seed = job.seed;
      self._ambRaw[id] = job.out;
      delete self._ambJobs[id];
      for (var i = 0; i < job.done.length; i++) job.done[i]();
    }
    setTimeout(next, 30);                                // never inside the tap that asked for it
  };
  /**
   * Synthesise if need be, then play — if it is still the one wanted. `audition`: it was chosen
   * to be heard. (While the stage has the sound, its loops are first rendered placed for it.)
   */
  HourglassAudio.prototype._loadAmbience = function (id, audition) {
    var self = this;
    var play = function () { if (self.ambience === id) self._startAmbience(id, audition); };
    this._synthAmbience(id, function () {
      if (self.ambience !== id) return;
      if (self._spatial && !self._ambBake[id]) self._stageBake(id, play);
      else play();
    });
  };
  /** The loops of an ambience that is made, as AudioBuffers: wrapped once, letting the arrays go layer by layer. */
  HourglassAudio.prototype._ambWrap = function (id) {
    var bufs = this._ambBuf[id], raw = this._ambRaw[id], d = AMBIENCES[id], i;
    if (!bufs) {
      if (!raw) return null;
      bufs = this._ambBuf[id] = [];
      bufs.seed = raw.seed;
      for (i = 0; i < raw.length; i++) { bufs.push(toBuffer(this.ctx, raw[i], d.layers[i].sr)); raw[i] = null; }
      delete this._ambRaw[id];
    }
    return bufs;
  };
  HourglassAudio.prototype._startAmbience = function (id, audition) {
    if (!this.ready) return;
    var ctx = this.ctx, t = ctx.currentTime, d = AMBIENCES[id], i;
    if (this._amb && this._amb.id === id) {
      // Playing already. Chosen to be heard while it is silent: once more, from where there is something to hear
      if (!audition || this._last.amb > 0) {
        if (audition) this._ambPreview = Math.max(this._ambPreview, t + (d.audition || 5));
        return;
      }
    }
    this._stopAmbience();                                // cross-fade out of the previous one
    var bufs = this._ambWrap(id);
    if (!bufs) return;
    // (the stage: the same loops, rendered placed for it, where they are made)
    var placed = this._spatial ? this._ambBake[id] : null, from = [];
    var g = ctx.createGain(), srcs = [];
    g.gain.value = 0;
    g.connect(this.ambBus);
    for (i = 0; i < bufs.length; i++) {                  // the layers loop independently
      var src = ctx.createBufferSource(), L = d.layers[i];
      src.buffer = (placed || bufs)[i];
      src.loop = true;
      src.connect(g);
      // from a whole sample of the layer's own rate: the same sound whatever rate its buffer got
      var at = audition && L.cue ? L.cue(L.seconds, bufs.seed) : rnd() * bufs[i].duration;
      at = Math.round(at * L.sr) % Math.floor(L.sr * L.seconds) / L.sr;
      src.start(0, at);
      srcs.push(src); from.push(at);
    }
    g.gain.setTargetAtTime(1, t, 0.4);
    // (t0, at: when each loop began and where in it, for a change of buffers in mid-flow: _ambSwap)
    this._amb = { id: id, srcs: srcs, g: g, baked: !!placed, t0: t, at: from };
    if (audition) this._ambPreview = t + (d.audition || 5);   // counted from now: making it took a while
  };
  /** Fade out the ambience that is playing, then let it go. */
  HourglassAudio.prototype._stopAmbience = function () {
    var old = this._amb;
    if (!old) return;
    this._amb = null;
    this._ambRelease();
    old.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    setTimeout(function () {
      for (var i = 0; i < old.srcs.length; i++) { try { old.srcs[i].stop(); } catch (e) {} try { old.srcs[i].disconnect(); } catch (e2) {} }
      try { old.g.disconnect(); } catch (e) {}
      old.srcs = [];                                     // and with them its buffers
    }, 1800);
  };
  /**
   * The ambience that plays goes on from other buffers of the same loops, with no break: the ones
   * rendered for the stage (`placed`), or the loops as they were made. New sources start at t
   * where the playing ones will be, and the two cross over d s; then the old ones are let go.
   */
  HourglassAudio.prototype._ambSwap = function (placed, t, d) {
    var old = this._amb, ctx = this.ctx, bufs, i;
    if (!old || old.baked === !!placed) return;
    bufs = placed ? this._ambBake[old.id] : this._ambBuf[old.id];
    if (!bufs) return;
    var g = ctx.createGain(), srcs = [], from = [], og = old.g.gain;
    g.gain.value = 0;
    g.connect(this.ambBus);
    for (i = 0; i < bufs.length; i++) {
      var src = ctx.createBufferSource(), at = (old.at[i] + (t - old.t0)) % bufs[i].duration;
      src.buffer = bufs[i];
      src.loop = true;
      src.connect(g);
      src.start(t, at);
      srcs.push(src); from.push(at);
      try { old.srcs[i].stop(t + d + 0.05); } catch (e) {}
    }
    // (two straight lines each, through 0.71 half way: near enough to equal power. Not curves: a
    // change of ambience during the crossing may still fade these by its own rule)
    var v0 = og.value;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.707, t + d / 2); g.gain.linearRampToValueAtTime(1, t + d);
    try { og.cancelScheduledValues(t); } catch (e2) {}
    og.setValueAtTime(v0, t); og.linearRampToValueAtTime(0.707 * v0, t + d / 2); og.linearRampToValueAtTime(0, t + d);
    this._amb = { id: old.id, srcs: srcs, g: g, baked: !!placed, t0: t, at: from };
    this._stageLater(t + d + 0.1, function () {
      for (var k = 0; k < old.srcs.length; k++) { try { old.srcs[k].disconnect(); } catch (e) {} }
      try { old.g.disconnect(); } catch (e3) {}
      old.srcs = [];
    });
  };
  /**
   * Let go of every ambience's sound but the chosen one's: its buffers (those
   * of the one still playing stay until it has faded), its arrays, and the
   * work on it if it was still being made. Up to 8 MB each (and as much again
   * for the loops rendered for the stage, while it is on).
   */
  HourglassAudio.prototype._ambRelease = function () {
    var keep = this.ambience, live = this._amb ? this._amb.id : keep, k;
    for (k in this._ambBuf) if (k !== keep && k !== live) delete this._ambBuf[k];
    for (k in this._ambBake) if (k !== keep && k !== live) delete this._ambBake[k];
    for (k in this._ambRaw) if (k !== keep) delete this._ambRaw[k];
    for (k in this._ambJobs) if (k !== keep) delete this._ambJobs[k];
  };
  /**
   * 'none' | 'brook' | 'rain' | 'ocean' | 'waterfall' | 'drips'. Plays while the sand runs. With
   * `audition` it also plays now, long enough to be heard (AMBIENCES[id].audition), from the
   * moment it sounds: the first time, it has to be made first (up to 2 s, in short slices).
   */
  HourglassAudio.prototype.setAmbience = function (id, audition) {
    if (!AMBIENCES[id]) return;
    this.ambience = id;
    this._ambRelease();
    if (!this.ready) return;
    if (id === 'none') { this._stopAmbience(); return; }
    this._loadAmbience(id, audition);
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
    // heard at its new level: 3 s of a brook, more of what takes longer to show itself
    var d = AMBIENCES[this.ambience];
    if (audition && this.ready) this._ambPreview = Math.max(this._ambPreview, this.ctx.currentTime + Math.max(3, (d.audition || 5) / 2));
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
   *    slides    surface-slide moves / s (avalanche & tumble activity): the rush, from 24,000;
   *              from 1,000 in a glass with no stream (not a running one, nor pouring)
   *    pouring   true while fresh sand is being added
   *    flipping  true while the vessel is turning
   *    spin      how fast it is turning (rad/s)
   *    angle     current flip angle (rad)
   *    running   true while the timer is running (keeps the ambience on)
   *    ambFade   0 … 1 the ambience's share as the glass's last stretch runs out (Tune's
   *              "Fade out before the end"; app.js works it out); 1, or none, leaves it whole
   *    sim       the Sim (for this frame's impact events), or null
   *
   *    — optional, the glass in hand —
   *    agit      0 … 3 how agitated the sand is (sim.agitation())
   *    rushPan   −1 … 1 where the sliding sand runs to, as heard (0.6·f_x/G of
   *              the fuller bulb, page frame: + is the right ear); followed
   *              while not flipping
   *    thump     Float32Array(4) [E0, x0, E1, x1]: this frame's bed landings
   *              per bulb, energy and pan (sim.frame.thump), or null
   *    slam      Float32Array(2) [E, x]: sand slamming the far end, or null
   *    leak      grains / s escaping through a chip;  leakPan  −1 … 1
   *    spillPats grains / s landing on the desk below
   *
   *    — for the stage (setSpatial), read only while it is on; the values above stay as they
   *      are, places as heard, and the stage reads these instead, in the glass's own frame —
   *    turn      the glass's angle with gravity (sim.angle + sim.tilt), clockwise as drawn
   *    fillTop   0 … 1 how full the upper bulb is
   *    slide     −1 … 1 the bulb the sliding sand is in: +1 the upper, −1 the lower
   *    evG       Float32Array: this frame's single landings across the glass (sim.evX before
   *              they are turned to the ears)
   *    thumpG, slamG, leakG, rushPanG   thump, slam, leakPan and rushPan, in the glass
   *    pose      the phone's down along its screen's normal (motion.pose()): about 0 held
   *              up, ±1 lying on its back or on its face
   *  }
   * ---------------------------------------------------------------- */

  HourglassAudio.prototype.update = function (st) {
    if (!this.ready || this.ctx.state !== 'running') return;
    var ctx = this.ctx, t = ctx.currentTime;
    var dt = st.dt > 0 ? Math.min(st.dt, 0.1) : 0.016;
    // ---- ambience: on while the glass runs, even while it is being turned ---
    var amb = st.ambient != null ? st.ambient : st.running;
    this._ambience(amb);
    // the fade before the end (Tune): 0..1 as the glass's last stretch runs out, 1 without it. A
    // glide, never a step: sand added or the glass turned brings it back up as smoothly.
    var fe = typeof st.ambFade === 'number' && st.ambFade >= 0 && st.ambFade < 1 ? st.ambFade : 1;
    this._set('ambEnd', this.ambEnd.gain, fe, 0.35);

    // ---- the stream, and its breathing -----------------------------------
    // Heard against its own slow mean, the flow's swell lifts the whole sand.
    var flow = st.flow || 0, tail = st.tail >= 0 ? (st.tail < 1 ? st.tail : 1) : 1, on = flow > 0.4;
    if (on && !this._flowOn) this._flowSlow = flow;      // a stream that starts: no surge
    this._flowOn = on;
    // (no stream and no pour for a while, in a glass that is not a running one being turned:
    // whatever sand moves now, a hand set it moving)
    this._still = on || st.running || amb || st.pouring ? 0 : this._still + dt;
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
    // (the stage: places in the glass's own frame, its ends as the stage has them; 0 without it)
    var sg = this._spatial ? this._stage.s : 0, evG = sg ? st.evG : null;
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
        var kind = sim.evK[e], v = sim.evV[e], x = evG ? evG[e] * sg : sim.evX[e];
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
    var th = st.thump, thx = sg && st.thumpG ? st.thumpG : null;
    if (th) {
      if (th[0] > 0) this.thump(th[0], thx ? thx[1] * sg : th[1], 0);
      if (th[2] > 0) this.thump(th[2], thx ? thx[3] * sg : th[3], 1);
    }
    var slm = st.slam;
    if (slm && slm[0] > 0) this.clack(slm[0], sg && st.slamG ? st.slamG[1] * sg : slm[1]);
    // ---- Layer 5: grains trickling out of a chip, and landing on the desk ---
    var lp = sg && st.leakG >= -1 ? st.leakG * sg : st.leakPan;
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
    // Under a stream the heap's own small avalanches stay beneath it, as ever. In a glass that
    // only stands there (idle, paused, finished: no stream for half a second) sliding sand was
    // set sliding by a hand, and is heard from 1,000 slides a second: softly, rising to STILL_TOP
    // by 24,000 (a lean past the slope, a glass carried about), and above that as ever. It holds
    // through a turn of such a glass too (the turn's own rule, just below, is the louder while
    // the hand is fast): the sand set sliding by the turn is heard until it rests, with no gap
    // at the turn's end. A running glass that is turned keeps the turn's rule alone, as ever.
    if (this._still >= STILL_AFTER && sl > STILL_KNEE) {
      var low = STILL_TOP * Math.sqrt(Math.min(1, (sl - STILL_KNEE) / (24000 - STILL_KNEE)));
      if (low > rush) rush = low;
    }
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
    // (the stage: the slide is placed by its bar, in the bulb it runs in; across that bulb, where
    // its field pulls it in the glass, and in the middle while the glass turns)
    if (sg) panTo = st.flipping || !(st.rushPanG > -2 && st.rushPanG < 2) ? 0 : (st.rushPanG < -0.65 ? -0.65 : (st.rushPanG > 0.65 ? 0.65 : st.rushPanG)) * sg;
    this._set('rush', this.rEnv.gain, rush * 0.5, rush > (this._last.rush || 0) ? 0.06 : 0.22);
    this._tg.R = rush > 0.002 ? 1 : 0; this._td.R = 1.4;
    this._pump(t, 1.0, RUSH_KEYS);

    // ---- air: a soft whoosh the moment the glass turns, two swells a turn ---
    var wv = st.spin || 0, air = wv < 0.35 ? 0 : Math.min(1, Math.pow((wv - 0.35) / 12, 0.75));
    var ang = st.angle || 0, sweep = 0.5 + 0.5 * Math.abs(Math.sin(ang));   // each bulb sweeping by
    this._set('air', this.aEnv.gain, air * sweep * 0.16, 0.035);
    if (air > 0.01) {
      this._set('airf', this.aBP.frequency, 360 + 1100 * air, 0.08);
      if (this.aPan.pan) this._set('airp', this.aPan.pan, sg ? 0 : Math.sin(ang) * 0.4, 0.05);
    }
    if (rush > 0.01) {
      this._set('rbp', this.rBP.frequency, 1100 + 2300 * rush, 0.12);
      if (this.rPan.pan) this._set('rpan', this.rPan.pan, panTo, 0.12);
    }
    if (sg) this._stagePlace(st, t);
    if (this._stageJobs.length) this._stageStep(t);
  };

  var BED_KEYS = ['S', 'G'], POUR_KEYS = ['P'], RUSH_KEYS = ['R'];
  // The slide of sand in a glass with no stream (update(), the rush): from STILL_KNEE slides a
  // second, up to STILL_TOP of the rush, once no stream has flowed for STILL_AFTER seconds.
  var STILL_KNEE = 1000, STILL_TOP = 0.3, STILL_AFTER = 0.5;

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
    if (this._stageJobs.length) this._stageStep(t);
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
      // (the stage: one lane, no delay between the ears; it is the speakers' to make)
      g.connect(pn); pn.connect(this.itdBus[this._spatial ? 1 : (p < -0.12 ? 0 : (p > 0.12 ? 2 : 1))]);
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
  HourglassAudio.prototype.thump = function (E, pan, bulb, gx) {
    if (!this._live()) return;
    if (this._spatial) pan = this._stageX(pan, gx);
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
  HourglassAudio.prototype.clack = function (E, pan, gx) {
    if (!this._live()) return;
    if (this._spatial) pan = this._stageX(pan, gx);
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
   * The glass under strain: `level` (1–4) ticks, like a cooling glass, each
   * a 1.5 ms hiss that sets the vessel ringing. They are a warning, so they
   * are meant to be heard: about as loud as a grain on glass, louder and
   * higher with each level (3.2, 4, 5 and 6.3 kHz). One call per 300 ms.
   */
  HourglassAudio.prototype.creak = function (level, pan, gx) {
    if (!this._live() || !this._spaced('creak', 0.3)) return;
    if (this._spatial) pan = this._stageX(pan, gx);
    var n = level | 0;
    n = n < 1 ? 1 : (n > 4 ? 4 : n);
    var when = this.ctx.currentTime + 0.004;
    pan = (pan === pan && pan ? pan : 0) * 0.6;          // a site on the glass, not at the ear
    var gain = LEVEL.creak0 + (LEVEL.creak1 - LEVEL.creak0) * (n - 1) / 3, hp = 3200 * Math.pow(1.25, n - 1);
    for (var k = 0; k < n; k++) {
      this._creakAt(when, gain * (0.9 + 0.2 * rnd()), pan, hp * (0.95 + 0.1 * rnd()));
      when += 0.035 + 0.055 * rnd();
    }
  };
  HourglassAudio.prototype._creakAt = function (when, gain, pan, hp) {
    this._click(when, 0.0015, hp || 5000, gain, pan, 0.8);
  };

  /**
   * The glass cracks: a bright snap, the whole vessel ringing, a faint knock
   * of its body, then the small ticks of the glass settling round the new
   * crack. Surprising, never alarming: well below the bowl.
   */
  HourglassAudio.prototype.crack = function (pan, gx) {
    if (!this._live() || !this._spaced('crack', 0.25)) return;
    if (this._spatial) pan = this._stageX(pan, gx);
    var t = this.ctx.currentTime + 0.004;
    pan = (pan === pan && pan ? pan : 0) * 0.6;
    this._click(t, 0.003, 2000, LEVEL.snap, pan, 0, 0.05);          // the snap: it tops the creaks before it
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
  HourglassAudio.prototype.crackGrow = function (pan, gx) {
    if (!this._live()) return;
    if (this._spatial) pan = this._stageX(pan, gx);
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
  HourglassAudio.prototype.chip = function (pan, gx) {
    if (!this._live() || !this._spaced('chip', 0.08)) return;
    if (this._spatial) pan = this._stageX(pan, gx);
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
  HourglassAudio.prototype.chime = function (delay, soft) {
    if (!this.ready || !this.chimeEnabled || this.ctx.state !== 'running') return;
    // F4: warm, yet audible on small phone speakers (`soft`: lighter and shorter, between two phases of a sequence);
    // at Tune's Bowl level (1: the bowl as it always was)
    var t0 = this.ctx.currentTime + (delay || 0) + 0.03, d = soft ? 0.8 : 1;
    var out = this._bell(t0, 349.23, (soft ? 0.07 : 0.12) * this.bowlLevel, d), now = this.ctx.currentTime;
    this._bowls = this._bowls.filter(function (w) { return w.end > now; });
    this._bowls.push({ out: out, end: t0 + 8.5 * d });
  };
  /** The completion bowls still ringing fade away at once (a tap that stops a bowl that rings again). */
  HourglassAudio.prototype.stopChime = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this._bowls.forEach(function (w) {
      try { w.out.gain.cancelScheduledValues(t); w.out.gain.setValueAtTime(w.out.gain.value, t); w.out.gain.setTargetAtTime(0, t, 0.12); } catch (e) {}
    });
    this._bowls = [];
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
    out.connect(this._spatial ? this._stageBowl(end) : this.gChime);   // (the stage: out in the room, front right)
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
    return out;
  };

  root.HourglassAudio = HourglassAudio;
})(typeof window !== 'undefined' ? window : globalThis);
