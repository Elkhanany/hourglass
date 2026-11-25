#!/usr/bin/env node
/*
 * Did a change to the sound engine (sound/audio.js) change a sound? A tool run by hand for a change that must not
 * (development only, not shipped; not a suite of the default run, because it needs to be told
 * what to compare with):
 *
 *   node tools/audio-identity.js --base <commit> [--port <n>] [--no-browser]
 *   node tools/audio-identity.js --file <an audio.js> ...
 *
 * (HOURGLASS_BASE=<commit> says the same as --base, as for the suites that compare the settings
 * store with a commit.) It loads two engines, audio.js as it was at that commit (or the file) and
 * audio.js as it is in this checkout, gives both the same random numbers, and compares what they
 * make, sample for sample (SHA-256 of the 32-bit samples):
 *
 *  in Node (the synthesis is plain JavaScript; each engine runs in its own vm context, with
 *  Math.random replaced by a seeded generator and the clock by a counter, so that a run can be
 *  repeated):
 *   - the tables: every acoustic character's numbers and resonators, every ambience's layers
 *     (length, rate, audition), apart from what only the cards read (id, icon);
 *   - the sand's own material, as prepare() makes it (the noises, the single grains, the beds);
 *   - every ambience's loops, both ears of every layer, at two seeds, and where a first hearing
 *     starts in them (each layer's cue);
 *
 *  in headless Chromium (a character has no samples of its own: it is how the graph is voiced, so
 *  it is rendered through the real graph on an OfflineAudioContext, 48 kHz, stereo):
 *   - every character: 4 s of running sand with a thump and a clack of the glass in hand, the
 *     character set before the graph is built, as the app does at launch, and the next one
 *     chosen 2.5 s in, as Tune does;
 *   - every ambience through the engine: 6 s from its first hearing, as a tap in Tune plays it.
 *  Chromium's offline render cannot be compared to the last bit: two renders of one engine from
 *  the same random numbers, drawn in the same order, differ in the last bits of their samples
 *  (measured here: about 90 dB under the sound, 87 in the ringing chime), with the room's
 *  convolver taken out too; silence renders alike. So through the graph the rule is: the old
 *  engine's render and the new one's differ by no more than a render differs from itself, at
 *  least 80 dB under the sound. (The tables themselves are compared exactly, in Node.)
 *
 * An ambience or a character the old engine does not have is listed as new and is not a
 * difference; one that is gone is. The tool checks itself each time: what is made twice is the
 * same (the samples in Node, within 80 dB under the sound through the graph: else nothing can be
 * compared here), every render has sound in it (two silences are no proof), and a character
 * with its hush 1 % louder, and a loop made from another seed, are told apart (controls).
 *
 * The page is served from memory through Playwright's routing: nothing listens on the port
 * (default $PORT, else 8803, the audio suites'). Exits 0 when no sound has changed.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), crypto = require('crypto');
var paths = require('./test/lib/paths.js');
var ROOT = paths.ROOT, NOW_FILE = paths.script('audio.js');

var argv = process.argv.slice(2), REV = process.env.HOURGLASS_BASE || '', FILE = '', PORT = +process.env.PORT || 8803, BROWSER = true;
for (var ai = 0; ai < argv.length; ai++) {
  if (argv[ai] === '--port') PORT = +argv[++ai];
  else if (argv[ai] === '--file') FILE = argv[++ai];
  else if (argv[ai] === '--base') REV = argv[++ai];
  else if (argv[ai] === '--no-browser') BROWSER = false;
  else { console.error('audio-identity: what is "' + argv[ai] + '"? (--base <commit>, --file <an audio.js>, --port <n>, --no-browser)'); process.exit(2); }
}
if (!REV && !FILE) {
  console.error('audio-identity: say what to compare with: --base <commit>, or --file <an audio.js>');
  process.exit(2);
}
var SEEDS = [1, 20261123];

var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}
function git(args) {
  return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}
/** audio.js as it was at `rev`: where index.html loads it from today, or at the root (before it moved). */
function atRev(rev) {
  var tries = [NOW_FILE, 'audio.js'], err = null;
  for (var i = 0; i < tries.length; i++) {
    try { return git(['show', rev + ':' + tries[i]]); } catch (e) { err = e; }
  }
  throw new Error('audio-identity: ' + rev + ' has no ' + tries.join(' or ') + ' (' + String(err && err.message).split('\n')[0] + ')');
}
var BASE_SRC = FILE ? fs.readFileSync(FILE, 'utf8') : atRev(REV);
var NOW_SRC = paths.piece(NOW_FILE);
var BASE_NAME = FILE ? path.basename(FILE) : REV;

/** mulberry32: the same numbers for both engines. */
function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function sha(arrays) {
  var h = crypto.createHash('sha256');
  arrays.forEach(function (a) {
    h.update(String(a.length) + ':');
    h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  });
  return h.digest('hex');
}
function rmsDb(arrays) {
  var s = 0, n = 0;
  arrays.forEach(function (a) { for (var i = 0; i < a.length; i++) s += a[i] * a[i]; n += a.length; });
  return n && s > 0 ? 10 * Math.log10(s / n) : -200;
}

/* ---- in Node ------------------------------------------------------------------------- */

/** An engine in its own vm context: Math.random is seeded by seed(), the clock is a counter. */
function load(src, name) {
  var clock = 0;
  var box = { console: console, performance: { now: function () { return (clock += 0.05); } } };
  vm.createContext(box);
  vm.runInContext(src, box, { filename: name });
  if (typeof box.HourglassAudio !== 'function') throw new Error('audio-identity: ' + name + ' did not define HourglassAudio');
  return {
    A: box.HourglassAudio,
    seed: function (s) { box.__rnd = seeded(s); vm.runInContext('Math.random = __rnd;', box); clock = 0; }
  };
}
/** What the engine reads of its tables, as text: every field but id and icon (the cards' own). */
function tables(A) {
  function plain(rec, skip) {
    var out = {};
    Object.keys(rec).sort().forEach(function (k) {
      if (skip.indexOf(k) >= 0) return;
      var v = rec[k];
      out[k] = typeof v === 'function' ? 'function' : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    });
    return out;
  }
  var t = { characters: {}, ambiences: {} };
  Object.keys(A.CHARACTERS).forEach(function (id) { t.characters[id] = JSON.stringify(plain(A.CHARACTERS[id], ['id', 'icon'])); });
  Object.keys(A.AMBIENCES).forEach(function (id) {
    var d = A.AMBIENCES[id], o = plain(d, ['id', 'icon', 'layers']);
    o.layers = (d.layers || []).map(function (L) { return plain(L, []); });
    t.ambiences[id] = JSON.stringify(o);
  });
  return t;
}
/** The sand's own material as prepare() leaves it: every array, by name. */
function material(E, seed) {
  E.seed(seed);
  var a = new E.A(), out = {}, raw;
  a._finishPrep();
  raw = a._raw;
  function arrays(v) {
    if (!v) return [];
    if (v.ch) return v.ch;                                 // channels(): { buf, ch }
    if (Array.isArray(v)) return [].concat.apply([], Array.prototype.map.call(v, arrays));
    return ArrayBuffer.isView(v) ? [v] : [];               // (the engine's arrays are another context's)
  }
  Object.keys(raw).sort().forEach(function (k) {
    var list = arrays(raw[k]);
    if (list.length) out[k] = { hash: sha(list), db: rmsDb(list), n: list.length };
  });
  return out;
}
/** One ambience at one seed: its loops, and where a first hearing starts in each layer. */
function loops(E, id, seed) {
  E.seed(seed);
  var a = new E.A(), raw = a._makeAmbience(id, seed), d = E.A.AMBIENCES[id];
  if (!raw) return null;
  var list = [].concat.apply([], raw.map(function (lr) { return [lr[0], lr[1]]; }));
  return { hash: sha(list), db: rmsDb(list), samples: list.reduce(function (s, x) { return s + x.length; }, 0),
           cues: d.layers.map(function (L) { return L.cue ? L.cue(L.seconds, seed) : null; }).join() };
}
function sameKeys(what, base, now) {
  var gone = Object.keys(base).filter(function (k) { return !(k in now); });
  var fresh = Object.keys(now).filter(function (k) { return !(k in base); });
  check(gone.length === 0, what + ': every one of ' + BASE_NAME + ' is still there (' + Object.keys(base).join(', ') + ')' +
    (fresh.length ? '; new, and so not compared: ' + fresh.join(', ') : ''), gone.length ? 'gone: ' + gone.join(', ') : '');
  return Object.keys(base).filter(function (k) { return k in now; });
}

function nodePart() {
  var B = load(BASE_SRC, BASE_NAME + ':audio.js'), N = load(NOW_SRC, NOW_FILE);
  var tb = tables(B.A), tn = tables(N.A);

  var chars = sameKeys('characters', tb.characters, tn.characters);
  var diffC = chars.filter(function (id) { return tb.characters[id] !== tn.characters[id]; });
  check(diffC.length === 0, 'the ' + chars.length + ' characters have the numbers and the resonators they had', diffC.map(function (id) {
    return id + ': ' + tb.characters[id] + ' → ' + tn.characters[id];
  }).join(' | ').slice(0, 600));
  check(Object.keys(tb.characters).join() === Object.keys(tn.characters).slice(0, Object.keys(tb.characters).length).join(),
    '... in the order they were in', Object.keys(tn.characters).join(', '));

  var ambs = sameKeys('ambiences', tb.ambiences, tn.ambiences);
  var diffA = ambs.filter(function (id) { return tb.ambiences[id] !== tn.ambiences[id]; });
  check(diffA.length === 0, 'the ' + ambs.length + ' ambiences have the layers (length, rate, cue) and the audition they had', diffA.map(function (id) {
    return id + ': ' + tb.ambiences[id] + ' → ' + tn.ambiences[id];
  }).join(' | ').slice(0, 600));
  check(Object.keys(tb.ambiences).join() === Object.keys(tn.ambiences).slice(0, Object.keys(tb.ambiences).length).join(),
    '... in the order they were in', Object.keys(tn.ambiences).join(', '));

  // the sand's own material
  var mb = material(B, SEEDS[0]), mn = material(N, SEEDS[0]), mn2 = material(N, SEEDS[0]), keys = Object.keys(mb);
  var repeat = Object.keys(mn).every(function (k) { return mn2[k] && mn2[k].hash === mn[k].hash; });
  check(repeat && keys.length >= 6, 'made twice from the same random numbers, the sand\'s material is the same (' + Object.keys(mn).join(', ') + ')',
    repeat ? '' : 'two runs of this checkout differ: nothing can be compared here');
  var diffM = keys.filter(function (k) { return !mn[k] || mn[k].hash !== mb[k].hash; });
  var quiet = keys.filter(function (k) { return !(mb[k].db > -90); });
  check(diffM.length === 0 && quiet.length === 0, 'the sand\'s material (' + keys.length + ' parts: the noises, the grains, the beds) is sample for sample what it was',
    (diffM.length ? 'differ: ' + diffM.join(', ') : '') + (quiet.length ? ' silent: ' + quiet.join(', ') : ''));

  // every ambience's loops
  var withLoops = ambs.filter(function (id) { return B.A.AMBIENCES[id].layers; });
  SEEDS.forEach(function (seed) {
    var out = [], bad = [];
    withLoops.forEach(function (id) {
      var b = loops(B, id, seed), n = loops(N, id, seed);
      if (!n || n.hash !== b.hash || n.cues !== b.cues || !(b.db > -90)) bad.push(id + (n ? (n.hash !== b.hash ? ' (samples)' : n.cues !== b.cues ? ' (cue ' + b.cues + ' → ' + n.cues + ')' : ' (silent)') : ' (not made)'));
      out.push(id + ' ' + b.hash.slice(0, 8) + ' (' + (b.samples * 4 / 1e6).toFixed(2) + ' MB, ' + b.db.toFixed(1) + ' dB)');
    });
    check(bad.length === 0, 'seed ' + seed + ': the loops of ' + withLoops.join(', ') + ' are sample for sample what they were, and a first hearing starts where it did',
      bad.length ? 'differ: ' + bad.join(', ') : out.join('; '));
  });
  // controls: a loop made twice is the same; from another seed it is not
  var first = withLoops[withLoops.length - 1];
  if (first) {
    var l1 = loops(N, first, SEEDS[0]), l2 = loops(N, first, SEEDS[0]), l3 = loops(N, first, SEEDS[0] + 1);
    check(l1.hash === l2.hash, '... made twice from the same seed, ' + first + ' is the same (else nothing can be compared here)');
    check(l1.hash !== l3.hash, '... and from another seed it is told apart (control)', l1.hash.slice(0, 8) + ' against ' + l3.hash.slice(0, 8));
  }
  return { chars: chars, ambs: withLoops };
}

/* ---- in the browser -------------------------------------------------------------------- */

function pageCode() {
  var SR = 48000, realRandom = Math.random;
  function seeded(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  /** Render `dur` s of `Engine` from the random numbers of `seed`; `script(a, off, at)` sets the scene. Resolves to [L, R]. */
  function render(Engine, dur, seed, before, script) {
    var clock = 0;
    Math.random = seeded(seed);
    // The engine cuts its synthesis into slices by the clock, and sums a slice's work as it comes:
    // the same sound, but not the same last bit of every sample. A counter cuts alike every time.
    performance.now = function () { return (clock += 0.05); };
    function restore() { Math.random = realRandom; delete performance.now; }
    var off = new OfflineAudioContext(2, Math.round(SR * dur), SR);
    // the engine plays only while its context runs; an offline one reads 'suspended' between renders
    Object.defineProperty(off, 'state', { get: function () { return 'running'; } });
    var a = new Engine();
    a.ctx = off;
    a.volume = 0.8;
    if (before) before(a);
    a._finishPrep();                 // the sand's material, as prepare() would have made it by now
    a._build();
    var seen = {};
    function at(t, fn) {             // at a whole render quantum
      var q = Math.round(t * SR / 128);
      if (seen[q]) throw new Error('two events in one quantum at ' + t);
      seen[q] = 1;
      off.suspend(q * 128 / SR).then(function () { fn(a, q * 128 / SR); off.resume(); });
    }
    script(a, off, at);
    return off.startRendering().then(function (buf) {
      restore();
      return [buf.getChannelData(0), buf.getChannelData(1)];
    }, function (e) { restore(); throw e; });
  }
  /**
   * Two renders against each other: how loud the first is (dBFS, RMS), how far the second is from
   * it (the difference's RMS under the first's, in dB; −200: the same samples), and the largest
   * difference of one sample.
   */
  function against(x, y) {
    var s = 0, d = 0, mx = 0, n = 0, c, i, e;
    for (c = 0; c < 2; c++) {
      for (i = 0; i < x[c].length; i++) {
        e = x[c][i] - y[c][i];
        s += x[c][i] * x[c][i]; d += e * e; n++;
        if (e < 0) e = -e;
        if (e > mx) mx = e;
      }
    }
    return { db: s > 0 ? +(10 * Math.log10(s / n)).toFixed(1) : -200, under: d > 0 && s > 0 ? +(10 * Math.log10(d / s)).toFixed(1) : (d > 0 ? 0 : -200), max: mx };
  }
  var ST = { dt: 1 / 60, flow: 290, impacts: 290, tail: 1, fill: 0.4, bottom: 6000, slides: 30000, pouring: false,
             running: true, flipping: false, spin: 0, angle: 0, sim: null };
  /** Running sand in character `ch`, a thump and a clack of the glass in hand, then `next` chosen 2.5 s in. */
  function sand(name, ch, next, seed) {
    return render(window[name], 4, seed, function (a) { a.character = ch; }, function (a, off, at) {
      a._cushion = 1;
      var tg = 0.3, k;
      for (k = 12; k < 234; k++) {
        if (k === 60 || k === 90 || k === 150) continue;
        at(k / 60, function (a2, t) {
          a2.update(ST);
          while (tg < t + 0.07) { tg += -Math.log(1 - Math.random()) / 190; a2._tick(tg, false, 0.35 + Math.random() * 0.6, Math.random() * 2 - 1); }
        });
      }
      at(1.0, function (a2) { a2.thump(1, 0, 1); });
      at(1.5, function (a2) { a2.clack(1, 0); });
      at(2.5, function (a2) { a2.setCharacter(next); });
    });
  }
  /** An ambience as a tap in Tune plays it: made from `seed`, started at its first hearing, the glass still. */
  function amb(name, id, seed) {
    return render(window[name], 6, seed, null, function (a, off, at) {
      a._makeAmbience(id, seed);
      a.ambience = id; a.ambLevel = 0.5;
      a._startAmbience(id, true);
      for (var k = 1; k < 59; k++) at(k / 10, function (a2) { a2.update({ dt: 0.1, flow: 0, impacts: 0, tail: 1, fill: 0.4, bottom: 6000, slides: 0, pouring: false,
                                                                      running: false, flipping: false, spin: 0, angle: 0, sim: null }); });
    });
  }
  /** The sand of engine `x` against that of engine `y` (global names), from the same random numbers. */
  window.__sand = function (x, y, ch, next, seed) {
    return sand(x, ch, next, seed).then(function (p) { return sand(y, ch, next, seed).then(function (q) { return against(p, q); }); });
  };
  window.__amb = function (x, y, id, seed) {
    return amb(x, id, seed).then(function (p) { return amb(y, id, seed).then(function (q) { return against(p, q); }); });
  };
  /** The control: the sand in `ch` against itself with the hush 1 % louder. */
  window.__hush = function (ch, next, seed) {
    var rec = window.HourglassAudio.CHARACTERS[ch], was = rec.whisper;
    return sand('HourglassAudio', ch, next, seed).then(function (p) {
      rec.whisper = was * 1.01;
      return sand('HourglassAudio', ch, next, seed).then(function (q) { rec.whisper = was; return against(p, q); }, function (e) { rec.whisper = was; throw e; });
    });
  };
}

async function browserPart(ids) {
  var chromium = require('playwright').chromium;
  var ORIGIN = 'http://localhost:' + PORT + '/';
  var browser = await chromium.launch();
  try {
    var page = await browser.newPage(), errors = [];
    page.on('pageerror', function (e) { errors.push(e.message); });
    var renamed = BASE_SRC.replace('root.HourglassAudio = HourglassAudio;', 'root.HourglassAudioBase = HourglassAudio;');
    if (renamed === BASE_SRC) throw new Error('audio-identity: ' + BASE_NAME + ' does not end by setting root.HourglassAudio');
    await page.route(ORIGIN + '**', function (r) {
      var u = r.request().url().slice(ORIGIN.length);
      if (u === '') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="/now.js"></script><script src="/base.js"></script>' });
      if (u === 'now.js') return r.fulfill({ contentType: 'text/javascript', body: NOW_SRC });
      if (u === 'base.js') return r.fulfill({ contentType: 'text/javascript', body: renamed });
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto(ORIGIN);
    await page.evaluate(pageCode);

    // the tool's own checks first: a render against itself, and a changed number is seen
    var NEAR = -80, FAR = -70;       // dB under the sound: the same within NEAR; told apart above FAR
    function say(r) { return r.under <= -200 ? 'the same samples' : r.under + ' dB under it (' + r.max.toExponential(1) + ' at most)'; }
    var c0 = ids.chars[0], c1 = ids.chars[1 % ids.chars.length];
    var self = await page.evaluate(function (a) { return window.__sand('HourglassAudio', 'HourglassAudio', a[0], a[1], a[2]); }, [c0, c1, SEEDS[0]]);
    check(self.under <= NEAR && self.db > -60, 'rendered twice through the graph from the same random numbers, ' + c0 + ' (' + self.db + ' dBFS) differs from itself by no more than the last bits',
      say(self) + (self.under <= NEAR ? '' : ': more than ' + NEAR + ' dB: nothing can be compared here'));
    var hush = await page.evaluate(function (a) { return window.__hush(a[0], a[1], a[2]); }, [c0, c1, SEEDS[0]]);
    check(hush.under > FAR, '... and with its hush 1 % louder it is told apart (control)', say(hush));

    var bad = [], out = [], levels = [];
    for (var i = 0; i < ids.chars.length; i++) {
      var ch = ids.chars[i], next = ids.chars[(i + 1) % ids.chars.length];
      var r = await page.evaluate(function (a) { return window.__sand('HourglassAudioBase', 'HourglassAudio', a[0], a[1], a[2]); }, [ch, next, SEEDS[0]]);
      if (!(r.under <= NEAR) || !(r.db > -60)) bad.push(ch + ': ' + r.db + ' dBFS, ' + say(r));
      out.push(ch + ' ' + r.db + ' dBFS, ' + say(r));
      levels.push(r.db);
    }
    var distinct = levels.filter(function (v, k, all) { return all.indexOf(v) === k; }).length;
    check(bad.length === 0, 'through the graph, 4 s of running sand in each of the ' + ids.chars.length +
      ' characters (set at launch, the next chosen 2.5 s in) is what it was, to the last bits',
      bad.length ? 'differ: ' + bad.join('; ') : out.join('; '));
    check(distinct >= Math.min(ids.chars.length, 3), '... and the characters are not one sound (' + distinct + ' levels among ' + ids.chars.length + ')', levels.join(', '));

    bad = []; out = [];
    for (var k = 0; k < ids.ambs.length; k++) {
      var id = ids.ambs[k];
      var ar = await page.evaluate(function (a) { return window.__amb('HourglassAudioBase', 'HourglassAudio', a[0], a[1]); }, [id, SEEDS[0]]);
      if (!(ar.under <= NEAR) || !(ar.db > -75)) bad.push(id + ': ' + ar.db + ' dBFS, ' + say(ar));
      out.push(id + ' ' + ar.db + ' dBFS, ' + say(ar));
    }
    check(bad.length === 0, 'through the graph, the first 6 s of each of the ' + ids.ambs.length + ' ambiences as a tap in Tune plays it is what it was, to the last bits',
      bad.length ? 'differ: ' + bad.join('; ') : out.join('; '));
    check(errors.length === 0, 'no page errors', errors.join(' | '));
  } finally {
    await browser.close();
  }
}

(async function () {
  console.log('audio-identity: ' + NOW_FILE + ' of this checkout against ' + (FILE ? FILE : 'audio.js at ' + REV));
  var ids = nodePart();
  if (BROWSER) await browserPart(ids);
  else console.log('      (the graph was not rendered: --no-browser)');
  console.log('audio-identity: ' + (count - failures) + '/' + count + ' passed' + (failures ? '' : ': no sound has changed'));
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
