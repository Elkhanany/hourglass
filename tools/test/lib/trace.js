/*
 * Traces of what the app does with its settings, for app-boot-trace and app-tune-trace
 * (development only, not shipped): what it reads and saves, what it calls on the Sim, the
 * Renderer, the sound engine and the motion sensors, and when it buzzes, in order.
 *
 * A trace is a list of events, each a small array:
 *   ['get', key] ['remove', key] ['set', key]   storage, for the app's keys ('hourglass.…')
 *   ['save', { key: value, … }]                 the settings saved: the keys that changed
 *   ['buzz', pattern]                           navigator.vibrate
 *   ['Sim.setPace', 1.414214] ['new Sim', { scale, seed }] ['new Renderer'] ['new Audio']
 *   ['sim.setLayers', true] ['renderer.setFrame', false] ['audio.setVolume', 0.3] …
 *   ['audio.volume =', 0.8]                     a write of one of the sound engine's six fields
 * Only what the app itself calls is kept (a call an engine makes inside one of its own is
 * not), so a trace says what app.js does, whatever the engines do with it. Numbers are rounded
 * to six places, the Sim's seed and the browser's user agent are not kept, and the Renderer's
 * layout() is kept without its sizes (they are the window's).
 *
 * The page's side is recorder(), an init script: it wraps storage, navigator.vibrate and the
 * engines' classes as each script has loaded (nothing is added to a file of the app), and
 * keeps the boot's events apart: everything until app.js has run. After that the frame loop
 * calls the engines all the time, and the window lays the page out when it likes, so only the
 * calls a setting causes are kept (LATER), but for a control's own tap, which runs with
 * everything kept.
 *
 *   var trace = require('./lib/trace.js');
 *   trace.STORAGES                       the five saved states of the boot trace
 *   await trace.boot(env, storage)    -> { name, trace: [...], saved: '<json>' }
 *   await trace.tune(env, [only])     -> { controls: [{ name, now: [...], later: [...] }], saved }
 *   trace.CONTROLS                       the controls' names, in order
 *   trace.differ(a, b)                -> what differs: [] when two traces are the same
 *   trace.write(file, data), trace.read(file)
 *   trace.patched(root, edits)        -> a copy of a tree with app.js changed (for the controls)
 */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---- the page's side ------------------------------------------------------------------- */
function recorder() {
  'use strict';
  var KEY = 'hourglass.settings.v1';
  var T = window.__trace = { id: Math.random(), log: [], at: 0, mode: 'all', depth: 0, boot: null, bootSaved: null };
  // once the page runs: the calls a setting causes (everything else is the frame loop's, or,
  // like layout(), the window's: it comes with every resize and load)
  var LATER = { 'renderer.setTheme': 1, 'renderer.setFrame': 1, 'renderer.setLayers': 1, 'sim.setLayers': 1,
    'audio.setVolume': 1, 'audio.setMuted': 1, 'audio.setCharacter': 1, 'audio.setChimeEnabled': 1, 'audio.setAmbience': 1,
    'audio.setAmbienceLevel': 1, 'audio.chime': 1, 'motion.request': 1, 'motion.start': 1, 'motion.stop': 1 };
  var NO_ARGS = { 'renderer.layout': 1 };
  var AUDIO_FIELDS = ['volume', 'muted', 'character', 'chimeEnabled', 'ambience', 'ambLevel'];
  function want(name) { return T.depth === 0 && (T.mode === 'all' || LATER[name] === 1); }
  function put(e) { T.log.push(e); }
  function plain(v) { return v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'; }
  function arg(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 1e6) / 1e6 : String(v);
    if (typeof v === 'string') return v === navigator.userAgent ? '(the user agent)' : v;
    if (typeof v === 'boolean' || v === null) return v;
    if (v === undefined) return '(undefined)';
    if (typeof v === 'function') return '(a function)';
    if (Array.isArray(v)) return v.length <= 8 && v.every(plain) ? v.map(arg) : '(an array)';
    return '(an object)';
  }
  function args(a) { return Array.prototype.map.call(a, arg); }
  /** A constructor's options, by name (the seed is the clock's: not kept). */
  function options(a) {
    var o = a[0], out = {};
    if (!o || typeof o !== 'object') return args(a);
    Object.keys(o).sort().forEach(function (k) { out[k] = k === 'seed' ? '(a seed)' : arg(o[k]); });
    return [out];
  }

  /* storage: the app's keys */
  var SP = Storage.prototype, get0 = SP.getItem, set0 = SP.setItem, del0 = SP.removeItem, last = null;
  try { last = JSON.parse(get0.call(window.localStorage, KEY) || 'null'); } catch (e) {}
  function ours(k) { return typeof k === 'string' && k.indexOf('hourglass.') === 0; }
  /** The keys of a save that differ from the save before it (or from what was there at the start). */
  function changed(text) {
    var now, out = {}, k, was = last && typeof last === 'object' ? last : {};
    try { now = JSON.parse(text); } catch (e) { return '(not JSON)'; }
    for (k in now) if (JSON.stringify(now[k]) !== JSON.stringify(was[k])) out[k] = arg(now[k]);
    for (k in was) if (!(k in now)) out[k] = '(gone)';
    last = now;
    return out;
  }
  SP.getItem = function (k) {
    if (ours(k) && T.mode === 'all') put(['get', k]);
    return get0.apply(this, arguments);
  };
  SP.setItem = function (k, v) {
    if (ours(k)) put(k === KEY ? ['save', changed(String(v))] : ['set', k]);
    return set0.apply(this, arguments);
  };
  SP.removeItem = function (k) {
    if (ours(k)) put(['remove', k]);
    return del0.apply(this, arguments);
  };
  T.saved = function () {
    var s = get0.call(window.localStorage, KEY);
    return s === null ? null : s.split(JSON.stringify(navigator.userAgent)).join('"(the user agent)"');
  };

  /* the buzz */
  try {
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true, value: function (p) { put(['buzz', arg(p)]); return true; } });
  } catch (e) {}

  /* the engines: each call the app makes on an instance, and each write of a field named */
  function instrument(o, tag, fields) {
    var seen = {}, p;
    for (p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      Object.getOwnPropertyNames(p).forEach(function (name) {
        if (seen[name] || name === 'constructor' || name.charAt(0) === '_') return;
        seen[name] = true;
        var d = Object.getOwnPropertyDescriptor(p, name);
        if (!d || typeof d.value !== 'function') return;
        var fn = d.value, full = tag + '.' + name;
        Object.defineProperty(o, name, { configurable: true, writable: true, enumerable: false, value: function () {
          if (want(full)) put([full].concat(NO_ARGS[full] ? [] : args(arguments)));
          T.depth++;
          try { return fn.apply(this, arguments); } finally { T.depth--; }
        } });
      });
    }
    (fields || []).forEach(function (f) {
      var v = o[f], full = tag + '.' + f + ' =';
      Object.defineProperty(o, f, { configurable: true, enumerable: true,
        get: function () { return v; },
        set: function (x) { if (want(full)) put([full, arg(x)]); v = x; } });
    });
  }
  function wrapClass(owner, name, tag, ctor, fields) {
    var Real = owner && owner[name];
    if (typeof Real !== 'function' || Real.__traced) return;
    var Traced = function () {
      var o, full = 'new ' + tag;
      if (want(full)) put([full].concat(ctor ? ctor(arguments) : []));
      T.depth++;
      try { o = Reflect.construct(Real, arguments); } finally { T.depth--; }
      instrument(o, tag.charAt(0).toLowerCase() + tag.slice(1), fields);
      return o;
    };
    Traced.prototype = Real.prototype;
    Object.getOwnPropertyNames(Real).forEach(function (k) {
      if (k === 'prototype' || k === 'length' || k === 'name' || k === 'arguments' || k === 'caller') return;
      var d = Object.getOwnPropertyDescriptor(Real, k), full = tag + '.' + k;
      if (typeof d.value === 'function') {
        Traced[k] = function () {
          if (want(full)) put([full].concat(args(arguments)));
          T.depth++;
          try { return Real[k].apply(Real, arguments); } finally { T.depth--; }
        };
      } else {
        Object.defineProperty(Traced, k, { configurable: true, enumerable: !!d.enumerable,
          get: function () { return Real[k]; }, set: function (v) { Real[k] = v; } });
      }
    });
    Traced.__traced = true;
    owner[name] = Traced;
  }
  function wrapAll() {
    var P = window.HourglassPhysics;
    if (P) { wrapClass(P, 'Sim', 'Sim', options); wrapClass(P, 'Renderer', 'Renderer', null); }
    wrapClass(window, 'HourglassAudio', 'Audio', null, AUDIO_FIELDS);
    wrapClass(window, 'HourglassMotion', 'Motion', options);
  }
  // a script has run (its load event comes in the same task, before anything else can): wrap
  // what it defined; and once the app's own handle is there, app.js has run: the boot is over
  document.addEventListener('load', function (e) {
    if (!e.target || e.target.tagName !== 'SCRIPT') return;
    if (window.Hourglass && T.boot === null) {
      T.boot = T.log.slice(); T.at = T.log.length; T.bootSaved = T.saved(); T.mode = 'later';
      return;
    }
    if (T.boot === null) wrapAll();
  }, true);

  // the page has loaded and laid itself out for it (app.js lays out again in the frame after the
  // window's load): until then a reload is not over
  window.addEventListener('load', function () {
    requestAnimationFrame(function () { requestAnimationFrame(function () { T.loaded = true; }); });
  });

  /** What was logged since the last take. */
  T.take = function () { var out = T.log.slice(T.at); T.at = T.log.length; return out; };
  /** A control's own tap: everything it calls is kept. */
  T.tap = function (fn) {
    T.mode = 'all';
    try { fn(); } finally { T.mode = 'later'; }
  };
}

/* ---- the boot trace -------------------------------------------------------------------- */
// Five saved states: nothing; a save from before 1.10.0 (no version) with everything changed;
// a version-2 save with Real motion left on; a damaged save; and "?t=45" over a saved sequence.
var STORAGES = [
  { name: 'a first launch: nothing saved', raw: {} },
  { name: 'a save from before version 2, everything changed', save: {
    theme: 'lapis', character: 'bamboo', volume: 0.35, muted: true, chime: false, tilt: false, zenFull: true, haptics: false, keepAwake: false,
    frame: false, layers: true, ambience: 'rain', ambienceLevel: 0.7, breath: true, breathPattern: 'box', durationMs: 1500000, restMs: 300000, rounds: 4,
    motionSign: -1, mendNotes: 2, hintCrack: true, hintZen: 3, grain: 1, hintMotion: 3, realSand: false, realSandFails: 2, realSandWhy: 'its self-test failed' } },
  { name: 'a version-2 save, Real sand off, Real motion left on', save: {
    v: 2, realSand: false, realSandBuild: '5', tilt: true, theme: 'seaglass', character: 'dune', volume: 1, ambience: 'drips', ambienceLevel: 0.2, motionSign: 1, hintMotion: 3 } },
  { name: 'a damaged save: wrong types, unknown names, values out of range', save: {
    v: 2, realSand: false, theme: 'granite', character: 'tuba', volume: 'loud', muted: 1, chime: null, frame: 'yes', layers: 0, ambience: 'jungle', ambienceLevel: 2.5,
    breath: 1, breathPattern: 'fast', durationMs: 1, restMs: 5, rounds: 99, motionSign: 7, grain: 5, hintZen: 'x', extra: { a: 1 } } },
  { name: '"?t=45" over a saved sequence, the finest grain', query: '?t=45', save: {
    v: 2, realSand: false, realSandBuild: '5', durationMs: 1500000, restMs: 300000, rounds: 4, grain: 2 } }
];

/** One launch from a saved state: what the boot did, and what was saved when it was over. */
async function boot(env, st) {
  var t = await env.open({ rawStorage: st.raw || { 'hourglass.settings.v1': st.save }, query: st.query || '', motionStub: true, init: recorder });
  try {
    var r = await t.eval(function () { return { boot: window.__trace.boot, saved: window.__trace.bootSaved }; });
    return { name: st.name, trace: r.boot, saved: r.saved, errors: t.errors.slice() };
  } finally {
    await t.close();
  }
}

/* ---- the Tune trace -------------------------------------------------------------------- */
function click(sel) { return { click: sel }; }
function slide(sel, v) { return { slide: sel, value: v }; }
// Every control of Tune, and the three of the top bar and the pills that save too. `wait`:
// what must have happened before the next one (default: the cross-fade, the sweep and a
// reload over). The names are the settings', not the page's: a new Tune is driven by its own
// selectors and compared by these names.
var DRIVE = [
  ['open Tune', click('#btn-settings')],
  ['material: volcanic', click('#themes [data-theme-id="volcanic"]')],
  ['material: moonstone', click('#themes [data-theme-id="moonstone"]')],
  ['material: lapis', click('#themes [data-theme-id="lapis"]')],
  ['material: rosequartz', click('#themes [data-theme-id="rosequartz"]')],
  ['material: seaglass', click('#themes [data-theme-id="seaglass"]')],
  ['material: sahara', click('#themes [data-theme-id="sahara"]')],
  ['frame: off', click('#opt-frame')],
  ['frame: on', click('#opt-frame')],
  ['layered sand: on', click('#opt-layers')],
  ['layered sand: off', click('#opt-layers')],
  ['character: warm', click('#characters [data-character="warm"]')],
  ['character: pure', click('#characters [data-character="pure"]')],
  ['character: chime', click('#characters [data-character="chime"]')],
  ['character: bamboo', click('#characters [data-character="bamboo"]')],
  ['character: dune', click('#characters [data-character="dune"]')],
  ['character: asmr', click('#characters [data-character="asmr"]')],
  ['volume: 30', slide('#volume', 30)],
  ['mute (the top bar)', click('#btn-mute')],
  ['volume: 55, while muted', slide('#volume', 55)],
  ['ambience: brook', click('#ambiences [data-ambience="brook"]')],
  ['ambience: rain', click('#ambiences [data-ambience="rain"]')],
  ['ambience: ocean', click('#ambiences [data-ambience="ocean"]')],
  ['ambience: waterfall', click('#ambiences [data-ambience="waterfall"]')],
  ['ambience: drips', click('#ambiences [data-ambience="drips"]')],
  ['ambience level: 70', slide('#amb-level', 70)],
  ['ambience: none', click('#ambiences [data-ambience="none"]')],
  ['completion bowl: off', click('#opt-chime')],
  ['completion bowl: on', click('#opt-chime')],
  ['keep screen awake: off', click('#opt-awake')],
  ['keep screen awake: on', click('#opt-awake')],
  ['real motion: on', click('#opt-tilt'), 'motion'],
  ['real motion: off', click('#opt-tilt')],
  ['full Zen: on', click('#opt-zen')],
  ['full Zen: off', click('#opt-zen')],
  ['breathing pace: on', click('#opt-breath')],
  ['breathing pattern: box', click('#breaths [data-breath="box"]')],
  ['breathing pattern: deep', click('#breaths [data-breath="deep"]')],
  ['breathing pattern: calm', click('#breaths [data-breath="calm"]')],
  ['breathing pace: off', click('#opt-breath')],
  ['haptics: off', click('#opt-haptics')],
  ['haptics: on', click('#opt-haptics')],
  ['material, by the chip in the top bar: the next one', click('#btn-theme')],
  ['duration: 10 minutes (a pill)', click('#durations .pill[data-min="10"]')],
  ['grain: fine', click('#grains [data-grain="1"]'), 'reload'],
  ['grain: finest', click('#grains [data-grain="2"]'), 'reload'],
  ['grain: classic', click('#grains [data-grain="0"]'), 'reload'],
  ['Real sand: on', click('#opt-realsand'), 'reload']
];
var CONTROLS = DRIVE.map(function (d) { return d[0]; });

function state(page) {
  return page.evaluate(function () {
    var T = window.__trace, app = document.getElementById('app'), as = document.getElementById('assembly');
    return {
      id: T ? T.id : null, booted: !!(T && T.boot && T.loaded) && !!window.Hourglass && !!(window.__mon && window.__mon.hooked),
      calm: !!app && !!as && !as.classList.contains('fade') && !app.classList.contains('sweep') && !app.classList.contains('swap') && !app.classList.contains('regrain'),
      starts: window.__motionStub ? window.__motionStub.starts : 0
    };
  }).catch(function () { return null; });         // (the page is on its way to another document)
}
async function until(page, ok, ms, what) {
  var end = Date.now() + ms, s;
  for (;;) {
    s = await state(page);
    if (s && ok(s)) return s;
    if (Date.now() > end) throw new Error('trace: ' + what + ' did not come in ' + ms + ' ms: ' + JSON.stringify(s));
    await sleep(50);
  }
}

/**
 * Every control in turn (or those named in `only`, in order), from a version-2 save with Real
 * sand off: what its own tap did (now), and what followed until the next one (later: the
 * cross-fade's calls, an answer to the motion question, the boot after a reload).
 */
async function tune(env, only) {
  var t = await env.open({ motionStub: true, init: recorder }), page = t.page, out = [], cur = null;
  try {
    await until(page, function (s) { return s.booted; }, 20000, 'the page, loaded');
    await page.evaluate(function () { window.__trace.take(); });
    for (var i = 0; i < DRIVE.length; i++) {
      var d = DRIVE[i];
      if (only && only.indexOf(d[0]) < 0) continue;
      var before = await state(page);
      var r = await page.evaluate(function (act) {
        var T = window.__trace, el = document.querySelector(act.click || act.slide), earlier = T.take();
        if (!el) return { missing: true };
        T.tap(function () {
          if (act.click) el.click();
          else { el.value = String(act.value); el.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        return { earlier: earlier, now: T.take() };
      }, d[1]);
      if (r.missing) throw new Error('trace: no control for "' + d[0] + '" (' + (d[1].click || d[1].slide) + ')');
      if (cur) cur.later = cur.later.concat(r.earlier);
      cur = { name: d[0], now: r.now, later: [] };
      out.push(cur);
      if (d[2] === 'reload') {
        await until(page, function (s) { return s.id !== before.id && s.booted; }, 20000, 'the reload after "' + d[0] + '"');
        cur.later = cur.later.concat([['(the page is loaded again)']], await page.evaluate(function () { return window.__trace.boot; }));
        if (i === DRIVE.length - 1) break;             // (what Real sand does once it has started is another suite's)
      } else {
        if (d[2] === 'motion') await until(page, function (s) { return s.starts > before.starts; }, 5000, 'the answer to the motion question');
        await until(page, function (s) { return s.id === before.id && s.calm; }, 8000, 'the page at rest after "' + d[0] + '"');
        await sleep(40);
      }
    }
    // what the last control left: after a reload the boot's own save; else what followed it
    var end = await page.evaluate(function (reloaded) {
      var T = window.__trace;
      return { rest: reloaded ? [] : T.take(), saved: reloaded ? T.bootSaved : T.saved() };
    }, !!(cur && DRIVE.filter(function (d) { return d[0] === cur.name; })[0][2] === 'reload'));
    if (cur) cur.later = cur.later.concat(end.rest);
    return { controls: out, saved: end.saved, errors: t.errors.slice() };
  } finally {
    await t.close();
  }
}

/* ---- comparing, keeping --------------------------------------------------------------- */
function line(e) { return JSON.stringify(e); }
/** How two lists of events differ: '' when they are the same. */
function listDiffer(a, b) {
  a = a || []; b = b || [];
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    if (line(a[i]) !== line(b[i])) {
      return 'event ' + (i + 1) + ': ' + (i < b.length ? line(b[i]) : 'nothing') + ' for ' + (i < a.length ? line(a[i]) : 'nothing') +
        (a.length !== b.length ? ' (' + b.length + ' events for ' + a.length + ')' : '');
    }
  }
  return '';
}
/** What differs between a kept entry and one just made (a boot or a control): [] when the same. */
function differ(kept, made) {
  var out = [];
  if (!kept) return ['not in the kept trace'];
  if (!made) return ['not made'];
  ['trace', 'now', 'later'].forEach(function (k) {
    if (!(k in kept) && !(k in made)) return;
    var d = listDiffer(kept[k], made[k]);
    if (d) out.push((k === 'trace' ? '' : k + ', ') + d);
  });
  if ('saved' in kept && kept.saved !== made.saved) out.push('saved ' + made.saved + ' for ' + kept.saved);
  return out;
}

/** A kept trace as text: one event a line, so that a change reads as a change of lines. */
function format(data) {
  function events(list, pad) { return '[' + (list.length ? '\n' + list.map(function (e) { return pad + '  ' + line(e); }).join(',\n') + '\n' + pad : '') + ']'; }
  var out = ['{', '  "from": ' + JSON.stringify(data.from) + ',', '  "what": ' + JSON.stringify(data.what) + ','];
  if (data.boots) {
    out.push('  "boots": [');
    data.boots.forEach(function (b, i) {
      out.push('    {', '      "name": ' + JSON.stringify(b.name) + ',', '      "trace": ' + events(b.trace, '      ') + ',',
        '      "saved": ' + JSON.stringify(b.saved), '    }' + (i < data.boots.length - 1 ? ',' : ''));
    });
    out.push('  ]');
  } else {
    out.push('  "controls": [');
    data.controls.forEach(function (c, i) {
      out.push('    {', '      "name": ' + JSON.stringify(c.name) + ',', '      "now": ' + events(c.now, '      ') + ',',
        '      "later": ' + events(c.later, '      '), '    }' + (i < data.controls.length - 1 ? ',' : ''));
    });
    out.push('  ],', '  "saved": ' + JSON.stringify(data.saved));
  }
  out.push('}');
  return out.join('\n') + '\n';
}
function write(file, data) { fs.writeFileSync(file, format(data)); }
function read(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }

/**
 * A copy of a tree (without git, packages, tests and documents) whose app.js has each of
 * `edits` ([from, to]) made once; an edit that finds nothing to change throws.
 */
function patched(root, edits) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hourglass-trace-'));
  fs.cpSync(root, dir, { recursive: true, filter: function (f) {
    return !/^(\.git|node_modules|tools|docs)(\/|$)/.test(path.relative(root, f));
  } });
  var file = path.join(dir, 'app.js'), src = fs.readFileSync(file, 'utf8');
  edits.forEach(function (e) {
    if (src.split(e[0]).length !== 2) throw new Error('trace: the edit\'s text is in app.js ' + (src.split(e[0]).length - 1) + ' times: ' + e[0].slice(0, 60));
    src = src.replace(e[0], function () { return e[1]; });
  });
  fs.writeFileSync(file, src);
  process.on('exit', function () { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (x) {} });
  return dir;
}

module.exports = {
  recorder: recorder, STORAGES: STORAGES, CONTROLS: CONTROLS, boot: boot, tune: tune,
  differ: differ, format: format, write: write, read: read, patched: patched, sleep: sleep
};
