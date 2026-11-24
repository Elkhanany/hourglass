#!/usr/bin/env node
/*
 * The settings store (app/settings.js), in Node, in a moment.
 *
 *  1. The records: one per saved key, well formed; their ids and defaults are those of the
 *     app's settings before the store, in the same order.
 *  2. The loader, differential: app.js's "Settings (persisted)" section as it was before the
 *     store (kept byte for byte in tools/test/base/app-settings-section.txt) and the store are
 *     run on the same 500 saved states (hand-written edge cases and generated ones: missing
 *     keys, wrong types, values out of range, a save that is not JSON, "?t=" queries, with and
 *     without a version, storage that throws). Each must give the same settings (the same keys
 *     in the same order, the same values), the same saved JSON byte for byte, the same calls on
 *     storage and the same answer to "was a duration asked for"; and again on a second launch
 *     from what was saved. And so must app.js's Settings section of today, the few lines that
 *     call the store, run as they run in app.js (cut by its banners) over the store.
 *     The old section knows the 31 keys the app had before the store. They are the store's
 *     first records, in their order; a record added since comes after them, and is left out of
 *     this comparison (out of the values, and out of the saved JSON where a save was written),
 *     so a new setting needs no change here.
 *  3. The migrations: the version step (Real sand on, once, for a save from before version 2),
 *     and a record's `from` (the value for a save without the key), on a made-up store; every
 *     record of the app with a `from` has its example in FROM below.
 *  4. The names: every settings.<name> in app.js is a record, every key it binds with
 *     bindSwitch is a switch, and every record is named or bound there.
 *  5. save(), a blocked storage, bindSwitch (the loaded value shown; then set, save and the
 *     callback, inside the event), and that the file reads nothing when it loads.
 * Each rule has its control: a store, a table or a copy of app.js that breaks it must fail the
 * same check.
 *
 *   node tools/test/settings-unit.test.js [--base <commit>] [--write]
 *
 * --base <commit> (or HOURGLASS_BASE): the kept section must be that commit's, cut from its
 * app.js by its banners; with --write it is written from it (and its hash below changes).
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
var paths = require('./lib/paths.js');
var base = require('./lib/base.js');
var scan = require('./lib/scan.js');
var ROOT = paths.ROOT;
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/* ---- the store, and the section it replaced -------------------------------------------- */
var STORE_FILE = paths.script('settings.js');
require(path.join(ROOT, STORE_FILE));
var S = globalThis.HourglassSettings;
var PH = require('./lib/load-physics.js').P, THEMES = PH.THEMES;
var REG = { themes: THEMES, sands: PH.SANDS, finishes: PH.FINISHES, finishOf: PH.finishOf };      // (what app.js hands the store)
var KEY = 'hourglass.settings.v1';

// the kept section: pinned, so that a change to it is made on purpose
var SECTION_SHA = '32a9a4e87fed60ebc730bc46aed4185db1569d24c7c155f995596ea5d612dc6d';
var rev = base.asked();
if (rev && base.writing()) fs.writeFileSync(base.SECTION, base.section(base.show(rev, 'app.js'), 'Settings (persisted)'));
var SECTION = fs.readFileSync(base.SECTION, 'utf8');
check(sha(SECTION) === SECTION_SHA && /var KEY = 'hourglass\.settings\.v1';/.test(SECTION) && /function save\(\)/.test(SECTION),
  'the kept section (tools/test/base/app-settings-section.txt, ' + (SECTION.split('\n').length - 1) + ' lines) is the one this test was written against (its SHA-256)',
  sha(SECTION));
check(sha(SECTION + ' ') !== SECTION_SHA, '... and a byte more in it would fail that (control)');
if (rev) {
  var cut = null, why = '';
  try { cut = base.section(base.show(rev, 'app.js'), 'Settings (persisted)'); } catch (e) { why = String(e.stderr || e.message).trim().split('\n')[0]; }
  check(cut === SECTION, 'the kept section is app.js\'s "Settings (persisted)" section at ' + rev + ', byte for byte, cut by its banners', why);
  var moved = null;
  try { moved = base.section(base.show(rev, 'app.js').replace('var KEY = ', 'var KEY2 = '), 'Settings (persisted)'); } catch (e) {}
  check(moved !== null && moved !== SECTION, '... and that commit\'s section with one name changed is not it (control)');
}

/**
 * The old loader: the section run as it ran in app.js (strict, inside a function), in a vm
 * context whose localStorage, location and P are the test's.
 */
var refBox = { P: { THEMES: THEMES }, location: { search: '' }, __storage: null };
Object.defineProperty(refBox, 'localStorage', { get: function () { return refBox.__storage(); }, enumerable: true });
vm.createContext(refBox);
var refScript = new vm.Script('(function () {\n\'use strict\';\n' + SECTION + '\nreturn { settings: settings, save: save, qt: qt };\n})()', { filename: 'app-settings-section.txt' });

/** A localStorage of the test's: what it holds, the calls made on it, and how it fails. */
function Storage(text, mode) {
  var st = { data: {}, ops: [], reached: 0, mode: mode || 'ok' };
  if (text !== null) st.data[KEY] = text;
  st.api = {
    getItem: function (k) {
      st.ops.push('get ' + k);
      if (st.mode === 'noget') throw new Error('SecurityError');
      return Object.prototype.hasOwnProperty.call(st.data, k) ? st.data[k] : null;
    },
    setItem: function (k, v) {
      st.ops.push('set ' + k);
      if (st.mode === 'noset') throw new Error('QuotaExceededError');
      st.data[k] = String(v);
      st.wrote = true;
    }
  };
  /** Reaching the storage itself (window.localStorage): where storage is blocked, this throws. */
  st.reach = function () {
    st.reached++;
    if (st.mode === 'blocked') throw new Error('SecurityError: the operation is insecure');
    return st.api;
  };
  return st;
}
function entries(o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); }
/** One launch of the old loader: load, then save. */
function runRef(text, search, mode) {
  var st = Storage(text, mode);
  refBox.__storage = st.reach;
  refBox.location = { search: search };
  var r = refScript.runInContext(refBox);
  var out = { values: entries(r.settings), asked: r.qt ? +r.qt[1] * 1000 : null };
  r.save();
  out.json = Object.prototype.hasOwnProperty.call(st.data, KEY) ? st.data[KEY] : null;
  out.ops = st.ops; out.reached = st.reached;
  return out;
}
// The keys the app had before the store (31): the old section's, which the store's first records
// must be, in that order. A record added since comes after them.
var OLD = runRef(null, '', 'ok').values.length;
/**
 * A launch over a store, held to the old keys: the keys added since are taken out of the
 * values, and out of the saved JSON where this launch wrote it (the whole save is kept as
 * `full`: the second launch starts from it).
 */
function oldKeysOnly(out, keys, wrote) {
  var newer = keys.slice(OLD), o;
  out.full = out.json;
  if (!newer.length) return out;
  out.values = out.values.filter(function (e) { return newer.indexOf(e[0]) < 0; });
  if (out.json !== null && wrote) {
    o = JSON.parse(out.json);
    newer.forEach(function (k) { delete o[k]; });
    out.json = JSON.stringify(o);
  }
  return out;
}
/**
 * A store as a launch: load, then save. `how`: the storage handed over as the function (as
 * app.js does) or as the object.
 */
function storeRun(store, how) {
  return function (text, search, mode) {
    var st = Storage(text, mode);
    var values = store.load(how === 'object' ? st.api : st.reach, search, REG);
    var p = store.preset(search);
    var out = { values: entries(values), asked: p ? p.durationMs : null };
    store.save(values);
    out.json = Object.prototype.hasOwnProperty.call(st.data, KEY) ? st.data[KEY] : null;
    out.ops = st.ops; out.reached = st.reached;
    return oldKeysOnly(out, store.KEYS, st.wrote);
  };
}
/**
 * A Settings section of app.js over a store, as a launch: the section run as it runs in
 * app.js (strict, inside a function), where window.HourglassSettings is the store and
 * localStorage, location and P are the test's; then its save(). A section that throws is a
 * launch that built nothing.
 */
function sectionRun(text0, store) {
  var box = { P: { THEMES: THEMES }, location: { search: '' }, HourglassSettings: store, __storage: null };
  Object.defineProperty(box, 'localStorage', { get: function () { return box.__storage(); }, enumerable: true });
  box.window = box;
  vm.createContext(box);
  var script = new vm.Script('(function () {\n\'use strict\';\n' + text0 + '\nreturn { settings: settings, save: save, qt: qt };\n})()', { filename: 'app.js, Settings (persisted)' });
  return function (text, search, mode) {
    var st = Storage(text, mode), r, out;
    box.__storage = st.reach;
    box.location = { search: search };
    try { r = script.runInContext(box); } catch (e) {
      return { values: [['(the section threw: ' + e.message + ')', true]], asked: null, json: null, full: null, ops: st.ops, reached: st.reached };
    }
    out = { values: entries(r.settings), asked: r.qt ? r.qt.durationMs : null };
    r.save();
    out.json = Object.prototype.hasOwnProperty.call(st.data, KEY) ? st.data[KEY] : null;
    out.ops = st.ops; out.reached = st.reached;
    return oldKeysOnly(out, store.KEYS, st.wrote);
  };
}
function show(v) { return typeof v === 'number' && 1 / v === -Infinity ? '-0' : typeof v === 'string' ? JSON.stringify(v) : String(v); }
/** How two launches differ: [] when they are the same. */
function differ(a, b) {
  var out = [];
  var ka = a.values.map(function (e) { return e[0]; }).join(), kb = b.values.map(function (e) { return e[0]; }).join();
  if (ka !== kb) out.push('keys ' + kb + ' for ' + ka);
  else a.values.forEach(function (e, i) {
    if (!Object.is(e[1], b.values[i][1])) out.push(e[0] + ' ' + show(b.values[i][1]) + ' for ' + show(e[1]));
  });
  if (a.json !== b.json) out.push('saved ' + b.json + ' for ' + a.json);
  if (a.ops.join() !== b.ops.join()) out.push('storage calls ' + b.ops.join() + ' for ' + a.ops.join());
  if (a.reached !== b.reached) out.push('storage reached ' + b.reached + ' times for ' + a.reached);
  if (a.asked !== b.asked) out.push('duration asked ' + b.asked + ' for ' + a.asked);
  return out;
}
/**
 * A case on the old loader and on a launch over the store (storeRun, sectionRun): the first
 * launch, and a second one from what the first saved. (`handed`: the Storage was handed over
 * itself, so the store never reaches for it, and that count is left out.)
 */
function compare(run, c, handed) {
  var a = runRef(c.text, c.search, c.mode), b = run(c.text, c.search, c.mode);
  if (handed) b.reached = a.reached;
  var out = differ(a, b);
  if (!out.length && a.json !== null) {
    var a2 = runRef(a.json, '', 'ok'), b2 = run(b.full, '', 'ok');
    if (handed) b2.reached = a2.reached;
    out = differ(a2, b2).map(function (d) { return 'second launch: ' + d; });
  }
  return out;
}

/* ---- 1. the records -------------------------------------------------------------------- */
/** What is wrong with a table of records: [] when it is well formed. */
function tableProblems(records) {
  var out = [], seen = {};
  records.forEach(function (r, i) {
    var t = typeof r.default;
    if (typeof r.id !== 'string' || !r.id) { out.push('record ' + i + ' has no id'); return; }
    if (seen[r.id]) out.push(r.id + ' is there twice');
    seen[r.id] = true;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') out.push(r.id + ': its default is ' + (r.default === null ? 'null' : t));
    if (t === 'number' && !isFinite(r.default)) out.push(r.id + ': its default is not finite');
    if ('valid' in r && typeof r.valid !== 'function') out.push(r.id + ': valid is not a function');
    if ('from' in r && typeof r.from !== 'function') out.push(r.id + ': from is not a function');
    Object.keys(r).forEach(function (k) { if (['id', 'default', 'valid', 'from'].indexOf(k) < 0) out.push(r.id + ': an unknown field, ' + k); });
  });
  return out;
}
var fresh = runRef(null, '', 'ok'), table = tableProblems(S.RECORDS);
var ids = S.RECORDS.map(function (r) { return r.id; });
check(S.KEY === KEY && table.length === 0 && S.KEYS.join() === ids.join() && S.RECORDS.length >= 31,
  'the store has ' + S.RECORDS.length + ' records, well formed (an id, a default that is a string, a number or a boolean), under \'' + S.KEY + '\'', table.join('; '));
var bad = tableProblems([{ id: 'a', default: 1 }, { id: 'a', default: null }, { id: 'b', default: 'x', valid: 1, to: 2 }, { default: 2 }, { id: 'c', default: 1 / 0 }]);
check(bad.length === 6, '... and a table with an id twice, a default of null, a valid that is no function, an unknown field, no id and a default that is not finite fails that (control)', bad.join('; '));
function firstRecords(records) { return records.slice(0, OLD).map(function (r) { return r.id + '=' + show(r.default); }).join(' '); }
var was = fresh.values.map(function (e) { return e[0] + '=' + show(e[1]); }).join(' '), now = firstRecords(S.RECORDS);
check(was === now && OLD === 31, 'the first ' + OLD + ' records are the old settings\', ids and defaults, in the same order (theme to v)' +
  (S.RECORDS.length > OLD ? '; ' + (S.RECORDS.length - OLD) + ' added since come after them: ' + S.KEYS.slice(OLD).join(', ') : ''), was === now ? '' : now + '  for  ' + was);
check(S.VERSION === 2 && S.STEPS.length === 1 && S.STEPS[0].v === 2, 'the settings\' version is 2, with one version step');

/* ---- 2. the loader, differential ------------------------------------------------------- */
/** mulberry32: the same cases at every run. */
function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var rand = rng(20261123);
function pick(list) { return list[Math.floor(rand() * list.length)]; }
// values as JSON text, so that a save can hold what JSON.stringify never writes (-0, 1e999)
var GOOD = {
  theme: Object.keys(THEMES).map(function (k) { return JSON.stringify(k); }),
  character: ['"asmr"', '"warm"', '"pure"', '"chime"', '"bamboo"', '"dune"'],
  ambience: ['"none"', '"brook"', '"rain"', '"ocean"', '"waterfall"', '"drips"'],
  breathPattern: ['"calm"', '"box"', '"deep"'],
  volume: ['0', '0.35', '0.8', '1'], ambienceLevel: ['0', '0.5', '0.72', '1'],
  durationMs: ['10000', '60000', '300000', '1500000', '3600000', '5999000'],
  restMs: ['0', '10000', '60000', '300000', '3600000'], rounds: ['1', '2', '4', '12'],
  motionSign: ['0', '1', '-1'], grain: ['0', '1', '2'],
  mendNotes: ['0', '1', '3'], hintZen: ['0', '2', '3'], hintMotion: ['0', '1', '3'],
  realSandFails: ['0', '1', '3'], realSandWhy: ['""', '"Needs WebGPU (iOS 26 or later)"'],
  realSandNa: ['""', '"Mozilla/5.0 (iPhone)"'], realSandNaAt: ['0', '1795400000000'], realSandBuild: ['""', '"4"', '"5"'],
  v: ['1', '2']
};
var ODD = {
  string: ['""', '"x"', '"granite"', '"tuba"', '"toString"', '"constructor"', '"__proto__"', '"hasOwnProperty"', '"SAHARA"', '" sahara"', '"5"', '"null"', '"\\u00fcn\\u00ef"'],
  number: ['-0', '-1', '-5', '0.5', '1.5', '2.5', '3', '5', '7', '13', '99', '9999', '9999.9', '10000.5', '3600001', '5999001', '1e21', '1e-7', '1e999', '-1e999',
           '2147483648', '4294967297', '4294967300', '-4294967295'],
  boolean: ['true', 'false']
};
var WRONG = ['null', '[]', '{}', '[1]', '{"a":1}'];
var QUERIES = ['?t=300', '?t=0', '?t=5', '?t=45', '?t=99999', '?t=100000', '?t=12x', '?x=1&t=45', '?t=45&debug=motion', '?debug=motion&t=7', '?tt=5', '?T=5', '?t=', '?t=5&t=9', '?debug=sand', '?offscreen=1&t=90'];
var tally = { missing: 0, wrongType: 0, odd: 0, query: 0, withV: 0, withoutV: 0, throws: 0, notJson: 0, notObject: 0, extra: 0, shuffled: 0 };
function oneCase() {
  var kind = pick(['sparse', 'full', 'full', 'damaged', 'damaged', 'typical']);
  var present = kind === 'sparse' ? 0.3 : kind === 'full' ? 0.9 : kind === 'damaged' ? 0.7 : 1;
  var pWrong = kind === 'damaged' ? 0.3 : kind === 'typical' ? 0 : 0.06, pOdd = kind === 'damaged' ? 0.4 : kind === 'typical' ? 0 : 0.15;
  var parts = [], c = { missing: false, wrongType: false, odd: false, hasV: false };
  S.RECORDS.slice(0, OLD).forEach(function (r) {         // (the old keys: a record added since changes none of the 500)
    var t = typeof r.default, x;
    if (r.id === 'v' ? rand() < 0.5 : rand() >= present) { c.missing = true; return; }
    if (rand() < pWrong) { x = rand() < 0.5 ? pick(WRONG) : pick(ODD[t === 'string' ? 'number' : t === 'number' ? 'boolean' : 'string']); c.wrongType = true; }
    else if (rand() < pOdd) { x = pick(ODD[t]); c.odd = true; }
    else x = GOOD[r.id] ? pick(GOOD[r.id]) : t === 'boolean' ? pick(ODD.boolean) : JSON.stringify(r.default);
    if (r.id === 'v') c.hasV = true;
    parts.push(JSON.stringify(r.id) + ':' + x);
  });
  if (rand() < 0.2) { parts.push(pick(['"sand":"blue"', '"extra":{"a":1}', '"hasOwnProperty":1', '"__proto__":{"theme":"lapis"}', '"frameStyle":3'])); c.extra = true; }
  if (rand() < 0.3) { parts.sort(function () { return rand() - 0.5; }); c.shuffled = true; }
  var m = rand();
  return { text: '{' + parts.join(',') + '}', search: rand() < 0.3 ? pick(QUERIES) : '',
           mode: m < 0.02 ? 'noget' : m < 0.05 ? 'noset' : m < 0.08 ? 'blocked' : 'ok', tags: c };
}
var CASES = [];
// by hand: nothing saved, saves that are no objects or no JSON, the version, the checks and repairs at their edges
[null, '', 'null', '{', 'undefined', '{"theme":', '5', '0', '"abc"', '"v"', 'true', 'false', '[]', '[1,2]', '{}',
 '{"v":2}', '{"realSand":false}', '{"v":1,"realSand":false}', '{"v":2,"realSand":false}', '{"v":3,"realSand":false}', '{"v":"2","realSand":false}',
 '{"v":1e999,"realSand":false}', '{"v":2.5,"realSand":false}', '{"v":1.9999,"realSand":false}', '{"v":-0,"realSand":false}', '{"v":null,"realSand":false}',
 '{"v":true,"realSand":false}', '{"v":1,"realSand":"no"}',
 '{"theme":"toString"}', '{"theme":"__proto__"}', '{"theme":"constructor"}', '{"theme":"lapis"}', '{"theme":5}', '{"theme":""}',
 '{"motionSign":-0}', '{"motionSign":-1}', '{"motionSign":2}', '{"grain":-0}', '{"grain":2}', '{"grain":1.5}', '{"grain":3}',
 '{"durationMs":1e999}', '{"durationMs":-1e999}', '{"durationMs":0}', '{"durationMs":-0}', '{"durationMs":9999.99}', '{"durationMs":1234567.5}',
 '{"restMs":9999.9,"rounds":5}', '{"restMs":10000,"rounds":4294967300}', '{"restMs":3600000,"rounds":13}', '{"restMs":3600001,"rounds":3}',
 '{"restMs":60000,"rounds":0}', '{"restMs":60000,"rounds":-3}', '{"restMs":60000,"rounds":2.9}', '{"restMs":-0,"rounds":7}', '{"restMs":1e999,"rounds":2}',
 '{"__proto__":{"theme":"lapis"},"character":"dune"}', '{"hasOwnProperty":1,"theme":"lapis"}', '{"volume":7,"ambienceLevel":-3,"hintZen":99}',
 '{"character":"tuba","ambience":"jungle","breathPattern":"fast"}'
].forEach(function (text) { CASES.push({ text: text, search: '', mode: 'ok', tags: {} }); });
QUERIES.forEach(function (q) {
  CASES.push({ text: '{"v":2,"durationMs":1500000,"restMs":300000,"rounds":4}', search: q, mode: 'ok', tags: {} });
});
['noget', 'noset', 'blocked'].forEach(function (mode) {
  CASES.push({ text: '{"v":2,"theme":"lapis","realSand":false}', search: '', mode: mode, tags: {} });
  CASES.push({ text: null, search: '?t=45', mode: mode, tags: {} });
});
var byHand = CASES.length;
while (CASES.length < 500) CASES.push(oneCase());
CASES.forEach(function (c) {
  var parsed, ok = true;
  try { parsed = JSON.parse(c.text || 'null'); } catch (e) { ok = false; }
  if (!ok) tally.notJson++;
  else if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) tally.notObject++;
  else if (Object.prototype.hasOwnProperty.call(parsed, 'v')) tally.withV++; else tally.withoutV++;
  if (c.tags.missing) tally.missing++;
  if (c.tags.wrongType) tally.wrongType++;
  if (c.tags.odd) tally.odd++;
  if (c.tags.extra) tally.extra++;
  if (c.tags.shuffled) tally.shuffled++;
  if (S.preset(c.search)) tally.query++;
  if (c.mode !== 'ok') tally.throws++;
});
check(CASES.length === 500 && tally.missing >= 300 && tally.wrongType >= 150 && tally.odd >= 250 && tally.query >= 80 && tally.withV >= 150 && tally.withoutV >= 150 &&
      tally.throws >= 20 && tally.notJson >= 3 && tally.notObject >= 10,
  'the 500 saved states (' + byHand + ' by hand, ' + (500 - byHand) + ' generated): ' + tally.missing + ' with keys missing, ' + tally.wrongType + ' with a value of the wrong type, ' +
  tally.odd + ' with one out of range, ' + tally.query + ' with "?t=", ' + tally.withV + ' with a version and ' + tally.withoutV + ' without, ' + tally.throws +
  ' on a storage that throws, ' + tally.notJson + ' that are not JSON, ' + tally.notObject + ' that are no object');

/** The cases on which a launch over the store differs from the old loader: [{ i, how, ... }]. */
function differing(run, handed) {
  var out = [];
  CASES.forEach(function (c, i) {
    if (handed && c.mode === 'blocked') return;                 // (a Storage in hand cannot be out of reach)
    var d = compare(run, c, handed);
    if (d.length) out.push({ i: i, how: d[0], text: c.text, search: c.search, mode: c.mode });
  });
  return out;
}
function first(list) { return list.slice(0, 3).map(function (d) { return '#' + d.i + ' ' + JSON.stringify(d.text) + ' ' + d.search + ' (' + d.mode + '): ' + d.how; }).join(' | '); }
var dFn = differing(storeRun(S, 'function')), dObj = differing(storeRun(S, 'object'), true);
check(dFn.length === 0, 'the loader: on all 500, the store gives what the old section gave: the same settings in the same order, the same saved JSON byte for byte, ' +
  'the same calls on storage, the same answer to "?t=", and the same again on a second launch', first(dFn));
check(dObj.length === 0, '... and the same with the Storage handed over itself instead of the function that reaches it', first(dObj));

// app.js's own Settings section: the few lines that call the store, run as app.js runs them
var APP_FILE = paths.script('app.js'), APP_SRC = paths.piece(APP_FILE);
var APP_SECTION = base.section(APP_SRC, 'Settings (persisted)');
var dApp = differing(sectionRun(APP_SECTION, S));
check(dApp.length === 0 && /Store\.load\(/.test(APP_SECTION) && !/getItem|JSON\.parse/.test(APP_SECTION),
  APP_FILE + '\'s own Settings section (' + (APP_SECTION.split('\n').length - 1) + ' lines, cut by its banners: the call to the store), run as ' + APP_FILE +
  ' runs it, gives the same on all 500, the count of times storage is reached too', first(dApp));
// controls: the section with one thing changed in a line that calls the store
var blockedCases = CASES.filter(function (c) { return c.mode === 'blocked'; }).length;
var SECTION_CONTROLS = [
  ['the Storage handed over itself, so that a blocked storage is reached outside the store\'s try', /Store\.load\(function \(\) \{ return localStorage; \}/, 'Store.load(localStorage',
    function (d) { return d.filter(function (x) { return x.mode === 'blocked' && /the section threw/.test(x.how); }).length === blockedCases && blockedCases >= 10; }],
  ['the preset asked without the query', /Store\.preset\(location\.search\)/, 'Store.preset()',
    function (d) { return d.length === tally.query && d.every(function (x) { return /duration asked null/.test(x.how); }); }],
  ['the settings loaded without the query', /(Store\.load\([^\n]*?)location\.search/, '$1\'\'', function (d) { return d.length >= 60 && d.every(function (x) { return !!S.preset(x.search); }); }],
  ['the settings loaded without the themes', /\{ themes: P\.THEMES[^}]*\}/, '{}', function (d) { return d.length === 500; }],      // (whatever else the checks are handed by then)
  ['a save() that saves nothing', /function save\(\) \{ Store\.save\(settings\); \}/, 'function save() {}', function (d) { return d.length >= 400; }]
];
var weakSection = [];
SECTION_CONTROLS.forEach(function (c) {
  var copy = APP_SECTION.replace(c[1], c[2]);
  if (copy === APP_SECTION) { weakSection.push(c[0] + ': the copy is the section itself'); return; }
  var d = differing(sectionRun(copy, S));
  if (!c[3](d)) weakSection.push(c[0] + ': ' + d.length + ' of 500 differ' + (d.length ? ', the first ' + first(d.slice(0, 1)) : ''));
});
check(weakSection.length === 0, '... and that section with one thing changed (' + SECTION_CONTROLS.map(function (c) { return c[0]; }).join('; ') +
  ') is found out, the first on each of the ' + blockedCases + ' launches whose storage cannot be reached (control)', weakSection.join(' | '));

// controls: stores that differ from the old loader in one thing each must be found out
function variant(change) {
  var recs = S.RECORDS.map(function (r) { var q = {}; Object.keys(r).forEach(function (k) { q[k] = r[k]; }); return q; });
  var o = { records: recs, steps: S.STEPS.slice(), repair: S.repair };
  change(o);
  return S.make(o.records, o.steps, o.repair);
}
var plainCopy = variant(function () {});
var dCopy = differing(storeRun(plainCopy, 'function'));
check(dCopy.length === 0, 'a store made again from the same records, steps and repairs gives the same on all 500 (the controls below change one thing each)', first(dCopy));
var CONTROLS = [
  ['two records in another order (volume after muted)', function (o) { var a = o.records[2]; o.records[2] = o.records[3]; o.records[3] = a; }, 500],
  ['a version step that does nothing', function (o) { o.steps[0] = { v: 2, run: function () {} }; }, 20],
  ['no version step at all (v is not set)', function (o) { o.steps.length = 0; }, 100],
  ['a theme checked with hasOwnProperty', function (o) { o.records[0].valid = function (v, reg) { return Object.prototype.hasOwnProperty.call(reg.themes, v); }; }, 3],
  ['a volume held between 0 and 1', function (o) { o.records[2].valid = function (v) { return v >= 0 && v <= 1; }; }, 5],
  ['a motionSign that keeps the zero it was given (-0)', function (o) { o.records[18].valid = function (v) { return v === 0 || v === 1 || v === -1; }; }, 1],
  ['a grain of 3 kept', function (o) { o.records[22].valid = function (v) { return v >= 1 && v <= 3; }; }, 1],
  ['no check of the rest and the rounds', function (o) { o.repair = function (values, search) { var p = S.preset(search); if (p) { values.durationMs = p.durationMs; values.restMs = 0; } values.durationMs = Math.max(10000, Math.min(5999000, values.durationMs)); }; }, 20],
  ['"?t=" not read', function (o) { o.repair = function (values, search, reg) { S.repair(values, '', reg); }; }, 50]
];
var weak = [];
CONTROLS.forEach(function (c) {
  var n = differing(storeRun(variant(c[1]), 'function')).length;
  if (n < c[2]) weak.push(c[0] + ': ' + n + ' of 500 differ, at least ' + c[2] + ' expected');
});
check(weak.length === 0 && S.RECORDS[2].id === 'volume' && S.RECORDS[18].id === 'motionSign' && S.RECORDS[22].id === 'grain',
  '... and each of ' + CONTROLS.length + ' stores that differ in one thing (the records\' order, the version step, the theme\'s check, a range, the zero\'s sign, the repairs, "?t=") is found out by the 500 (control)', weak.join('; '));

// a record added since the store: after the old ones it changes nothing here (this file needs no
// change for a new setting); among them it is found out
var ADDED = { id: 'x-added', default: true, from: function (saved) { return saved.frame; } };       // (a name no record of the app has)
var atEnd = variant(function (o) { o.records.push(ADDED); }), among = variant(function (o) { o.records.splice(10, 0, ADDED); });
var dEnd = differing(storeRun(atEnd, 'function')), dEndApp = differing(sectionRun(APP_SECTION, atEnd)), dAmong = differing(storeRun(among, 'function'));
var endSt = Storage('{"v":2,"frame":false}', 'ok'), endValues = atEnd.load(endSt.reach, '', REG);
atEnd.save(endValues);
check(dEnd.length === 0 && dEndApp.length === 0 && atEnd.KEYS.length === S.KEYS.length + 1 && firstRecords(atEnd.RECORDS) === was &&
      endValues['x-added'] === false && /,"x-added":false\}$/.test(endSt.data[KEY]) && endSt.data[KEY].indexOf('"v":2') > 0,
  'a store with a record added after the old ones (a switch made from an older key) gives the same on all 500, by itself and under ' + APP_FILE +
  '\'s section: its key is left out of the comparison, and is loaded, migrated and saved last', first(dEnd.concat(dEndApp)) + ' ' + endSt.data[KEY]);
check(dAmong.length === 500 && firstRecords(among.RECORDS) !== was, '... and the same record put among the old ones is found out, by the 500 and by the records\' order (control)',
  dAmong.length + ' of 500 differ');

/* ---- 3. the migrations ----------------------------------------------------------------- */
function loadOf(store, saved, search) {
  var st = Storage(saved === null ? null : typeof saved === 'string' ? saved : JSON.stringify(saved), 'ok');
  var values = store.load(st.reach, search || '', REG);
  store.save(values);
  return { values: values, json: st.data[KEY], st: st };
}
var V = [
  [null, true, 'nothing saved'], [{ realSand: false }, true, 'a save without a version'], [{ v: 1, realSand: false }, true, 'version 1'],
  [{ v: 2, realSand: false }, false, 'version 2, off'], [{ v: 2, realSand: true }, true, 'version 2, on'], [{ v: 3, realSand: false }, false, 'a later version, off'],
  [{ v: '2', realSand: false }, true, 'a version that is no number']
];
var vBad = V.filter(function (c) { var r = loadOf(S, c[0]); return r.values.realSand !== c[1] || r.values.v !== 2 || JSON.parse(r.json).v !== 2; }).map(function (c) { return c[2]; });
var again = loadOf(S, loadOf(S, { v: 1, realSand: false }).json);
again.values.realSand = false; S.save(again.values);
var kept = loadOf(S, again.st.data[KEY]);
check(vBad.length === 0 && kept.values.realSand === false,
  'the version step: Real sand comes up on for a save of no version or of version 1, once; the save then says version 2, and turned off after that it stays off', vBad.join(', '));
// a made-up store: a record made from an older one, and one whose `from` throws
var calls = [];
var M = S.make([
  { id: 'theme', default: 'sahara' },
  { id: 'sand', default: 'quartz', from: function (saved, reg) { calls.push(reg === REG); return saved.theme === 'lapis' ? 'blue' : saved.theme === 'volcanic' ? 7 : undefined; } },
  { id: 'finish', default: 'walnut', from: function () { throw new Error('no'); } },
  { id: 'last', default: 1, valid: function (v) { return v < 10; } },
  { id: 'v', default: 3 }
], [{ v: 2, run: function (values) { values.last = 5; } }, { v: 3, run: function (values, saved) { values.theme = saved.theme === 'old' ? 'new' : values.theme; } }]);
var F = [
  [null, 'sahara,quartz,walnut,1,3', 'nothing saved: the defaults, no from'],
  [{ theme: 'lapis', v: 3 }, 'lapis,blue,walnut,1,3', 'the key absent: from the older key'],
  [{ theme: 'lapis', sand: 'red', v: 3 }, 'lapis,red,walnut,1,3', 'the key saved: kept, no from'],
  [{ theme: 'volcanic', v: 3 }, 'volcanic,quartz,walnut,1,3', 'from gives another type: the default'],
  [{ theme: 'lapis', sand: 5, v: 3 }, 'lapis,quartz,walnut,1,3', 'the key saved with the wrong type: the default, no from'],
  [{ theme: 'x', last: 4, v: 3 }, 'x,quartz,walnut,4,3', 'a from that throws costs only its own key'],
  [{ theme: 'old', last: 4 }, 'new,quartz,walnut,5,3', 'no version: both steps, in order'],
  [{ theme: 'old', last: 4, v: 2 }, 'new,quartz,walnut,4,3', 'version 2: the third step only'],
  [{ theme: 'old', last: 40, v: 3 }, 'old,quartz,walnut,1,3', 'version 3: no step; a value out of range is the default'],
  ['[1]', 'sahara,quartz,walnut,5,3', 'an array is no save: no from (the steps run, as they did)']
];
calls.length = 0;
var fBad = F.filter(function (c) { var r = loadOf(M, c[0]); return M.KEYS.map(function (k) { return r.values[k]; }).join() !== c[1]; })
  .map(function (c) { var r = loadOf(M, c[0]); return c[2] + ' (' + M.KEYS.map(function (k) { return r.values[k]; }).join() + ')'; });
check(fBad.length === 0 && M.VERSION === 3 && calls.length > 0 && calls.every(Boolean),
  'a record\'s `from` gives the value for a save without its key (and only then; another type, or a throw, is the default), and the steps run in order for an older save (a made-up store, ' + F.length + ' cases)', fBad.join('; '));

// every record of the app that has a `from` is tried on a save of its own: the saved object (without
// the key), and the value it must come up with, which is not the default (a `from` that reads a
// misspelt older key gives the default without a word). None has one yet.
var FROM = {
  sand: [{ v: 2, theme: 'lapis' }, 'lapis'],
  finish: [{ v: 2, theme: 'lapis' }, 'gold']
};
/** What is wrong between a store's `from` records and their examples: [] when each has one that holds. */
function fromProblems(store, examples) {
  var out = [];
  store.RECORDS.forEach(function (r) {
    var ex = examples[r.id], got;
    if (!r.from) return;
    if (!ex) { out.push(r.id + ' has a from and no example'); return; }
    if (Object.prototype.hasOwnProperty.call(ex[0], r.id)) { out.push(r.id + ': its example holds the key itself, so its from never runs'); return; }
    if (Object.is(ex[1], r.default)) { out.push(r.id + ': its example comes up with the default, which a from that reads nothing gives too'); return; }
    got = loadOf(store, ex[0]).values[r.id];
    if (!Object.is(got, ex[1])) out.push(r.id + ': ' + show(got) + ' for ' + show(ex[1]) + ', from ' + JSON.stringify(ex[0]));
  });
  Object.keys(examples).forEach(function (id) {
    if (!store.RECORDS.some(function (r) { return r.id === id && r.from; })) out.push('an example for ' + id + ', which is no record with a from');
  });
  return out;
}
var withFrom = S.RECORDS.filter(function (r) { return r.from; }).map(function (r) { return r.id; }), fp = fromProblems(S, FROM);
check(fp.length === 0, 'every record with a `from` has its example, which comes up with the value named and not with the default (' +
  (withFrom.length ? withFrom.join(', ') : 'no record has one yet') + ')', fp.join('; '));
var MF = S.make([
  { id: 'frame', default: true },
  { id: 'posts', default: true, from: function (saved) { return saved.frame; } },
  { id: 'caps', default: true, from: function (saved) { return saved.fraem; } }             // (misspelt)
], []);
var f1 = fromProblems(MF, { posts: [{ frame: false }, false] }), f2 = fromProblems(MF, { posts: [{ frame: false }, false], caps: [{ frame: false }, false] });
var f3 = fromProblems(MF, { posts: [{ frame: true }, true], caps: [{ frame: false, caps: false }, false], frame: [{}, false] });
check(f1.join() === 'caps has a from and no example' && f2.length === 1 && /^caps: true for false/.test(f2[0]) &&
      f3.length === 3 && /posts: its example comes up with the default/.test(f3[0]) && /caps: its example holds the key itself/.test(f3[1]) && /an example for frame/.test(f3[2]),
  '... and a `from` without an example, one that reads a misspelt key, an example that proves nothing and one for a record without a `from` are each found (control, a made-up store)',
  [f1.join('; '), f2.join('; '), f3.join('; ')].join(' | '));

// the look (1.14.0): the sand and the frame's finish, chosen apart. A save from before has the
// material alone: each of the six comes up as its own sand over its own caps, every other key as
// it was; a saved sand and finish are kept; a custom sand needs its colour, or it is the material's
// sand; what is no sand, no finish or no colour is the default.
var SIX_CAPS = { sahara: 'walnut', volcanic: 'brass', moonstone: 'silver', lapis: 'gold', rosequartz: 'copper', seaglass: 'driftwood' };
/** What is wrong with a store's look: [] when every case holds. */
function lookProblems(store) {
  var out = [];
  Object.keys(SIX_CAPS).forEach(function (m) {
    [{ theme: m, volume: 0.3, frame: false }, { v: 2, realSand: false, theme: m, volume: 0.3, frame: false, tuneTab: 'glass' }].forEach(function (saved) {
      var r = loadOf(store, saved), back = JSON.parse(r.json);
      if (r.values.sand !== m || r.values.finish !== SIX_CAPS[m] || r.values.sandColor !== '' || r.values.theme !== m || r.values.volume !== 0.3 || r.values.frame !== false)
        out.push('material ' + m + (saved.v ? ' (v2)' : '') + ': ' + [r.values.sand, r.values.finish, r.values.theme, r.values.volume, r.values.frame].join());
      if (back.sand !== m || back.finish !== SIX_CAPS[m]) out.push('material ' + m + ': saved as ' + back.sand + '/' + back.finish);
    });
  });
  [
    [{ v: 2, theme: 'lapis', sand: 'garnet', finish: 'copper' }, 'garnet,copper,,lapis', 'a sand and a finish saved'],
    [{ v: 2, theme: 'lapis', sand: 'custom', sandColor: '185,0.5,0.5', finish: 'silver' }, 'custom,silver,185,0.5,0.5,lapis', 'a custom sand with its colour'],
    [{ v: 2, theme: 'volcanic', sand: 'custom', finish: 'gold' }, 'volcanic,gold,,volcanic', 'a custom sand without a colour: the material\'s sand'],
    [{ v: 2, theme: 'granite', sand: 'custom', sandColor: 'red' }, 'sahara,walnut,,sahara', 'a custom sand with no colour over a theme that is none'],
    [{ v: 2, theme: 'moonstone', sand: 'quartz', finish: 'tin', sandColor: '400,2,1' }, 'sahara,walnut,,moonstone', 'no sand, no finish, no colour: the defaults'],
    [{ v: 2, theme: 'moonstone', sand: 7, finish: null }, 'sahara,walnut,,moonstone', 'the wrong types: the defaults, no migration'],
    [{ v: 2, theme: 'toString' }, 'sahara,walnut,,toString', 'a theme that is a name every object has: no sand, no finish of it']
  ].forEach(function (c) {
    var r = loadOf(store, c[0]), got = [r.values.sand, r.values.finish, r.values.sandColor, r.values.theme].join();
    if (got !== c[1]) out.push(c[2] + ': ' + got);
  });
  return out;
}
var lp = lookProblems(S);
check(lp.length === 0, 'the look: a save of each of the six materials (with and without a version) comes up as that sand over that material\'s caps, saved so, with every other key as it was; a saved sand and finish are kept; a custom sand needs its colour; what is no sand, finish or colour is the default (19 cases)', lp.join('; '));
var lookCtl = [
  ['a finish made as the material\'s name', variant(function (o) { o.records.filter(function (r) { return r.id === 'finish'; })[0].from = function (saved) { return saved.theme; }; })],
  ['no sand made from the material', variant(function (o) { o.records.filter(function (r) { return r.id === 'sand'; })[0].from = undefined; })],
  ['no custom sand fallback', variant(function (o) { o.repair = function (values, search, reg) { var keep = values.sand; S.repair(values, search, reg); values.sand = keep; }; })],
  ['a colour not checked', variant(function (o) { o.records.filter(function (r) { return r.id === 'sandColor'; })[0].valid = undefined; })]
].map(function (c) { return c[0] + ': ' + lookProblems(c[1]).length; });
check(lookCtl.every(function (t) { return !/: 0$/.test(t); }), '... and four stores with one thing wrong in the look are each found out (control)', lookCtl.join('; '));

/* ---- 4. the names app.js uses ----------------------------------------------------------- */
/** The keys a controller binds with bindSwitch(el, 'key', …) in its code: the second argument, a string. */
function boundKeys(src) {
  var code = scan.blank(src).code, re = /\bbindSwitch\s*\(/g, m, k, out = [];     // (blank keeps every character's place)
  while ((m = re.exec(code))) {
    k = /^[^,]*,\s*(['"])([^'"\n]*)\1/.exec(src.slice(m.index + m[0].length));
    out.push(k ? k[2] : '(a key that is no string)');
  }
  return out;
}
/**
 * What is wrong between the settings a controller names and a store's records: [] when every
 * settings.<name> in its code (strings and comments are not code) is a record, every key it
 * binds with bindSwitch is a switch of the store, every record but the version is named or
 * bound there, and no setting is read by a computed name.
 */
function nameProblems(src, records) {
  var used = scan.members(src, 'settings'), bound = boundKeys(src), out = [];
  var keys = records.map(function (r) { return r.id; });
  used.forEach(function (n) { if (keys.indexOf(n) < 0) out.push('settings.' + n + ' is no record of the store'); });
  bound.forEach(function (k) {
    if (keys.indexOf(k) < 0 || typeof records[keys.indexOf(k)].default !== 'boolean') out.push('bindSwitch binds ' + k + ', which is no switch of the store');
  });
  keys.forEach(function (k) { if (k !== 'v' && used.indexOf(k) < 0 && bound.indexOf(k) < 0) out.push('the record ' + k + ' is named nowhere'); });
  if (/(?<![.\w$])settings\s*\[/.test(scan.blank(src).code)) out.push('a setting is read as settings[…], which this check cannot follow');
  return out;
}
var usedNames = scan.members(APP_SRC, 'settings'), np = nameProblems(APP_SRC, S.RECORDS);
check(np.length === 0 && usedNames.length >= 30, 'every settings.<name> in ' + APP_FILE + ' is a record of the store (' + usedNames.length + ' names; ' + boundKeys(APP_SRC).length +
  ' bound with bindSwitch, each a switch), and every record but the version is named there', np.join('; '));
var typo = APP_SRC.replace('settings.chime = e.target.checked;', 'settings.chmie = e.target.checked;');
var MORE = S.RECORDS.concat([{ id: 'zzNeverNamed', default: 0 }, { id: 'zzBound', default: true }]);          // (names no record of the app has)
var n1 = nameProblems(typo, S.RECORDS), n2 = nameProblems(APP_SRC + '\nStore.bindSwitch($("opt-b"), "zzBound", f);', MORE), n3 = nameProblems(APP_SRC + '\nvar k = settings[name];', S.RECORDS);
var n4 = nameProblems(APP_SRC + '\n// settings.inAComment and Store.bindSwitch(el, "inAComment")\nvar t = "settings.inAString";', S.RECORDS);
var n5 = nameProblems(APP_SRC + '\nStore.bindSwitch($("opt-a"), \'chmie\', f);\nStore.bindSwitch(el, "volume");\nStore.bindSwitch(el, key);', S.RECORDS);
check(typo !== APP_SRC && n1.join() === 'settings.chmie is no record of the store' && n2.join() === 'the record zzNeverNamed is named nowhere' && n3.length === 1 && /settings\[/.test(n3[0]) && n4.length === 0 &&
      n5.join() === 'bindSwitch binds chmie, which is no switch of the store,bindSwitch binds volume, which is no switch of the store,bindSwitch binds (a key that is no string), which is no switch of the store',
  '... and a copy of ' + APP_FILE + ' that writes settings.chmie, a record it never names (one it only binds is named), a setting read by a computed name, and a bindSwitch on a misspelt key, on a slider and on a key that is no string ' +
  'are each found; a name in a comment or a string is not one (control)', [n1.join('; '), n2.join('; '), n3.join('; '), n4.join('; '), n5.join('; ')].join(' | '));

/* ---- 4b. the glass's shape (release 1.15.0) ---------------------------------------------- */
// The record `shape`: an id of the shapes Tune offers; anything else, and a save from before it,
// is the classic glass, with every other setting as that save gives it.
// Tune offers every registered shape, so a shape held back is made in this test's own copy of the
// registry, where the trumpet's record says offered: false (physics.js itself is not touched).
var SHAPES = (function (all) {
  var ids = Object.keys(all), copy = {};
  if (ids.some(function (id) { return !all[id].offered; })) return all;
  ids.forEach(function (id) { copy[id] = id === 'trumpet' ? Object.assign({}, all[id], { offered: false }) : all[id]; });
  return copy;
})(require('./lib/load-physics.js').P.SHAPES), REG_SH = { themes: THEMES, shapes: SHAPES };
function shapeLoad(store, saved) {
  var st = Storage(JSON.stringify(saved), 'ok');
  return store.load(st.reach, '', REG_SH);
}
var SAVE_1_13 = { theme: 'lapis', character: 'bamboo', volume: 0.35, muted: true, chime: false, tilt: true, zenFull: true, haptics: false, keepAwake: false, frame: false,
  layers: true, ambience: 'rain', ambienceLevel: 0.7, breath: true, breathPattern: 'box', durationMs: 1500000, restMs: 300000, rounds: 4, motionSign: -1, mendNotes: 2,
  hintCrack: true, hintZen: 3, grain: 1, hintMotion: 3, realSand: false, realSandFails: 1, realSandWhy: 'x', realSandNa: '', realSandNaAt: 0, realSandBuild: '6', v: 2, tuneTab: 'glass' };
var SAVE_1_10 = { theme: 'seaglass', volume: 1, ambience: 'drips', ambienceLevel: 0.2, frame: false, grain: 2, durationMs: 600000, realSand: true, realSandBuild: '5', v: 2 };
/** What is wrong with a store's shape record: [] when it holds. */
function shapeProblems(store) {
  var out = [];
  [[SAVE_1_13, 'a save of 1.13.0'], [SAVE_1_10, 'a save of 1.10.0']].forEach(function (c) {
    var old = shapeLoad(store, c[0]), withShape = shapeLoad(store, Object.assign({}, c[0], { shape: 'delta' }));
    if (old.shape !== 'classic') out.push(c[1] + ' came up as ' + show(old.shape));
    store.KEYS.forEach(function (k) {
      if (k === 'shape') return;
      if (!Object.is(old[k], withShape[k])) out.push(c[1] + ': ' + k + ' ' + show(old[k]) + ' without a shape, ' + show(withShape[k]) + ' with one');
      if (Object.prototype.hasOwnProperty.call(c[0], k) && k !== 'v' && !Object.is(old[k], c[0][k]) && !(k === 'durationMs' || k === 'rounds')) out.push(c[1] + ': ' + k + ' ' + show(old[k]) + ' for the saved ' + show(c[0][k]));
    });
  });
  Object.keys(SHAPES).forEach(function (id) {
    var got = shapeLoad(store, { v: 2, shape: id }).shape, want = SHAPES[id].offered ? id : 'classic';
    if (got !== want) out.push(id + ' (' + (SHAPES[id].offered ? 'offered' : 'held back') + ') came up as ' + show(got));
  });
  [['heart', 'an unknown shape'], [7, 'a number'], ['', 'an empty name'], ['toString', 'a name every object has']].forEach(function (c) {
    var got = shapeLoad(store, { v: 2, shape: c[0] }).shape;
    if (got !== 'classic') out.push(c[1] + ' came up as ' + show(got));
  });
  return out;
}
var offeredIds = Object.keys(SHAPES).filter(function (id) { return SHAPES[id].offered; }), heldIds = Object.keys(SHAPES).filter(function (id) { return !SHAPES[id].offered; });
var sp = shapeProblems(S), lastRec = S.RECORDS[S.RECORDS.length - 1];
check(sp.length === 0 && lastRec.id === 'shape' && lastRec.default === 'classic',
  'the shape: the last record, \'classic\' by default; a save of 1.13.0 and one of 1.10.0 come up as the classic glass, every other setting as they give it; each offered shape (' + offeredIds.join(', ') +
  ') as itself; one held back (' + heldIds.join(', ') + '), an unknown one, a number, an empty name and a name every object has as the classic glass', sp.join('; '));
// controls: a store whose shape takes any name, and one that takes a shape held back
function withShapeRecord(valid) {
  return S.make(S.RECORDS.map(function (r) { return r.id === 'shape' ? { id: 'shape', default: 'classic', valid: valid } : r; }), S.STEPS, S.repair);
}
var spAny = shapeProblems(withShapeRecord(undefined));
var spHeld = shapeProblems(withShapeRecord(function (v, reg) { return Object.prototype.hasOwnProperty.call(reg.shapes, v); }));
check(spAny.length >= 3 && spHeld.length === heldIds.length && heldIds.length > 0,
  '... and a store whose shape takes any name, and one that takes a shape held back, are each found out (control)', spAny.concat(spHeld).join('; '));

/* ---- 5. save, a blocked storage, bindSwitch, loading ------------------------------------ */
var st1 = Storage('{"v":2,"realSand":false,"theme":"lapis"}', 'ok'), v1 = S.load(st1.reach, '', REG);
v1.volume = 0.25; S.save();
var v2 = S.load(st1.reach, '', REG);
check(v2.volume === 0.25 && v2.theme === 'lapis' && v2 !== v1 && st1.ops.join() === 'get ' + KEY + ',set ' + KEY + ',get ' + KEY,
  'save() with no values saves those of the last load; a load reads storage once and writes nothing');
var blocked = Storage('{"v":2,"theme":"lapis"}', 'blocked'), vb = null, threw = '';
try { vb = S.load(blocked.reach, '?t=45', REG); S.save(vb); } catch (e) { threw = e.message; }
check(!threw && vb && vb.theme === 'sahara' && vb.durationMs === 45000 && blocked.reached === 2,
  'a storage that cannot be reached at all (blocked: localStorage itself throws) runs with the defaults, and "?t=" still counts', threw);
// bindSwitch: set, save, then the callback, inside the event
var st2 = Storage('{"v":2,"realSand":false}', 'ok'), v3 = S.load(st2.reach, '', REG), heard = [], order = [];
var el = { addEventListener: function (type, fn) { heard.push([type, fn]); } };
S.bindSwitch(el, 'chime', function (on) { order.push('after ' + on + ' saved ' + JSON.parse(st2.data[KEY]).chime + ' value ' + v3.chime); });
heard[0][1]({ target: { checked: false } });
order.push('returned');
heard[0][1]({ target: { checked: true } });
var notSwitch = [];
['volume', 'nothing'].forEach(function (k) { try { S.bindSwitch(el, k); } catch (e) { notSwitch.push(k); } });
check(heard.length === 1 && heard[0][0] === 'change' && order.join(' | ') === 'after false saved false value false | returned | after true saved true value true' && notSwitch.join() === 'volume,nothing',
  'bindSwitch: on change the value is set, saved, and then the callback is called, in that order and before the event returns; a key that is no switch throws', order.join(' | '));
// ... and it shows the loaded value from the moment it is bound, whatever the page's markup says
/** Whether a store's bindSwitch sets the switch from the loaded value: one the markup has on for a value saved off, and the other way round. */
function showsLoaded(store) {
  var st = Storage('{"v":2,"realSand":false,"chime":true}', 'ok');
  store.load(st.reach, '', REG);
  var off = { checked: true, addEventListener: function () {} }, on = { checked: false, addEventListener: function () {} };
  store.bindSwitch(off, 'realSand'); store.bindSwitch(on, 'chime');
  return off.checked === false && on.checked === true;
}
/** The store a source of app/settings.js defines, in a context of its own. */
function storeOf(source) {
  var b = {};
  b.window = b;
  vm.createContext(b);
  vm.runInContext(source, b, { filename: STORE_FILE });
  return b.HourglassSettings;
}
var STORE_SRC = paths.piece(STORE_FILE), unloaded = '';
try { S.make(S.RECORDS, S.STEPS, S.repair).bindSwitch({ addEventListener: function () {} }, 'chime'); } catch (e) { unloaded = e.message; }
check(showsLoaded(S) && showsLoaded(storeOf(STORE_SRC)) && /bound before the settings are loaded/.test(unloaded),
  'bindSwitch sets the switch to the loaded value as it binds (a switch the page has on comes up off for a value saved off), so a switch needs no line of its own at the boot; bound before a load, it throws', unloaded);
var deaf = STORE_SRC.replace('      el.checked = !!current[key];\n', '');
check(deaf !== STORE_SRC && !showsLoaded(storeOf(deaf)), '... and a copy of ' + STORE_FILE + ' whose bindSwitch only listens leaves the switch as the page has it (control)');
// the file reads nothing when it loads: run where every global it could read is watched
var touched = [], box = {};
['localStorage', 'sessionStorage', 'location', 'document', 'navigator', 'HourglassPhysics'].forEach(function (g) {
  Object.defineProperty(box, g, { get: function () { touched.push(g); return undefined; }, enumerable: true });
});
box.window = box;
vm.createContext(box);
var src = STORE_SRC, loaded = '';
try { vm.runInContext(src, box, { filename: STORE_FILE }); } catch (e) { loaded = e.message; }
check(!loaded && touched.length === 0 && box.HourglassSettings && typeof box.HourglassSettings.load === 'function',
  STORE_FILE + ' reads nothing when it loads (no storage, no location, no document), and defines HourglassSettings', loaded || touched.join());
var early = src.replace("var KEY = 'hourglass.settings.v1';", "var KEY = 'hourglass.settings.v1', early = root.localStorage;");
try { vm.runInContext(early, box); } catch (e) {}
check(early !== src && touched.join() === 'localStorage', '... and a copy that reaches localStorage as it loads is seen to (control)', touched.join());

console.log('settings-unit: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
