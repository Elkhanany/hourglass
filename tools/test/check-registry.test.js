#!/usr/bin/env node
/*
 * The registry check, in Node, in a moment (the check group: node tools/test/run-all.js check-).
 *
 * The sounds and the glass shapes are registries: one record each, in one list, which the engine
 * reads and which Tune's pickers show. So:
 *  - the sound cards of index.html and the registry of audio.js say the same. Tune's cards are
 *    still written by hand (#characters and #ambiences: a button per sound, type="button"
 *    role="radio" aria-checked, its id in data-character or data-ambience, its icon inside its
 *    <svg>, its name in its <span>), and
 *    HourglassAudio.characters() and .ambiences() are what a picker drawn from the registry would
 *    show: the same ids, names and icons, in the same order, and every card's <svg> opens alike;
 *  - CHARACTERS and AMBIENCES, which the engine reads, hold those records and no others;
 *  - a record the engine could not play is refused as the page loads, by name: a character with a
 *    number missing or a table of resonators that is not six rows of four numbers (the graph has
 *    six bands), an ambience with a layer it cannot make or more than 8 MB of PCM, a card without
 *    its id, name or icon, an id that is taken; and so is a record with a field nothing reads,
 *    which is a field misspelt (`mode` for `modes` would be a character with the thin glass,
 *    `layer` for `layers` an ambience that plays nothing, `offerd` a glass that is not offered);
 *  - the shapes of physics.js are whole: SHAPE_ORDER and SHAPES name the same glasses in the same
 *    order, the classic first; each says whether Tune offers it and has the half-turn symmetry
 *    both sand engines need; addShape refuses a record that is not whole; and checkShape finds
 *    nothing wrong with any of them at the phone's size (sim-shape asks at every size, and runs
 *    the sand in each).
 * Each rule has its control: the same check on a copy that breaks it must fail.
 *
 *   node tools/test/check-registry.test.js
 */
'use strict';
var vm = require('vm');
var paths = require('./lib/paths.js');
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}
function thrown(fn) { try { fn(); } catch (e) { return e && e.message ? e.message : String(e); } return ''; }

/* ---- the engine's registry: audio.js run with nothing but a console ---- */
var AUDIO_SRC = paths.piece(paths.script('audio.js'));
function engine(src) {
  var box = { console: console };
  vm.createContext(box);
  vm.runInContext(src, box, { filename: 'audio.js' });
  return box.HourglassAudio;
}
var A = engine(AUDIO_SRC);

/* ---- the cards of index.html ---- */
/** The cards of the group `id` (a button each, its id in data-<attr>): { cards: [{ id, name, icon, svg }], faults: [] }. */
function cardsOf(html, id, attr) {
  var out = { cards: [], faults: [] };
  var g = new RegExp('<div\\b[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</div>').exec(html.replace(/<!--[\s\S]*?-->/g, ''));
  if (!g) { out.faults.push('index.html has no #' + id); return out; }
  var buttons = g[1].match(/<button\b[\s\S]*?<\/button>/g) || [];
  var card = new RegExp('^(<button\\b[^>]*\\bdata-' + attr + '="([^"]*)"[^>]*>)\\s*<svg\\b([^>]*)>([\\s\\S]*?)</svg>\\s*<span>([^<]*)</span>\\s*</button>$');
  buttons.forEach(function (b, k) {
    var m = card.exec(b);
    if (!m) { out.faults.push('card ' + (k + 1) + ' of #' + id + ' is not a button with data-' + attr + ', an <svg> and a <span>'); return; }
    // the group's handler and a screen reader take a card for a choice by these three
    if (!/\stype="button"/.test(m[1]) || !/\srole="radio"/.test(m[1]) || !/\saria-checked="(true|false)"/.test(m[1])) {
      out.faults.push('card ' + (k + 1) + ' of #' + id + ' (' + m[2] + ') is not a type="button" with role="radio" and aria-checked');
    }
    out.cards.push({ id: m[2], svg: m[3].trim(), icon: m[4], name: m[5] });
  });
  if (g[1].replace(/<button\b[\s\S]*?<\/button>/g, '').trim()) out.faults.push('#' + id + ' holds something that is not a card');
  return out;
}
/** Where the cards and the registry's list differ: [] when they say the same. */
function differences(group, list, what) {
  var out = group.faults.slice(), cards = group.cards, n = Math.max(cards.length, list.length), k;
  if (cards.map(function (c) { return c.id; }).join() !== list.map(function (r) { return r.id; }).join()) {
    out.push('the ' + what + ' cards are ' + (cards.map(function (c) { return c.id; }).join(', ') || 'none') + '; the registry has ' + (list.map(function (r) { return r.id; }).join(', ') || 'none'));
  }
  for (k = 0; k < n; k++) {
    var c = cards[k], r = list[k];
    if (!c || !r || c.id !== r.id) continue;
    if (c.name !== r.name) out.push(c.id + ': the card is named "' + c.name + '", the record "' + r.name + '"');
    if (c.icon !== r.icon) out.push(c.id + ': the card\'s icon is not the record\'s (they differ from character ' + firstDiff(c.icon, r.icon) + ')');
    if (c.svg !== cards[0].svg) out.push(c.id + ': its <svg ' + c.svg + '> does not open as the first card\'s does (' + cards[0].svg + ')');
  }
  return out;
}
function firstDiff(a, b) { var i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }

var HTML = paths.piece('index.html');
var GROUPS = [
  { what: 'character', id: 'characters', attr: 'character', list: A.characters(), all: A.CHARACTERS },
  { what: 'ambience', id: 'ambiences', attr: 'ambience', list: A.ambiences(), all: A.AMBIENCES }
];
GROUPS.forEach(function (G) {
  var group = cardsOf(HTML, G.id, G.attr), diff = differences(group, G.list, G.what);
  check(group.cards.length >= 6 && diff.length === 0, 'the ' + group.cards.length + ' ' + G.what + ' cards of index.html are the registry\'s: the same ids, names and icons, in the same order (' +
    G.list.map(function (r) { return r.id; }).join(', ') + ')', diff.join('; '));
  check(group.cards.length > 0 && /^class="ic" viewBox="0 0 24 24" aria-hidden="true"$/.test(group.cards[0].svg),
    '... and each icon is drawn in <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">', group.cards.length ? group.cards[0].svg : '');
  var keys = Object.keys(G.all), ids = G.list.map(function (r) { return r.id; });
  var same = keys.join() === ids.join() && G.list.every(function (r) { return G.all[r.id].id === r.id && G.all[r.id].name === r.name && G.all[r.id].icon === r.icon; });
  check(same, '... and what the engine reads (' + (G.what === 'character' ? 'CHARACTERS' : 'AMBIENCES') + ') holds those records, by id, and no others', keys.join(', '));
});

// controls: a card left out, two cards changed round, a card renamed, one stroke of an icon moved, a card more,
// an <svg> that opens otherwise, a card that is no card; and a record more than there are cards.
// (Each copy of the page is held against what the page itself says, so a control tells of the
// check alone, whatever the page and the registry say of each other today.)
(function () {
  var G = { what: 'character', id: 'characters', attr: 'character' };
  G.list = cardsOf(HTML, G.id, G.attr).cards.map(function (c) { return { id: c.id, name: c.name, icon: c.icon }; });
  var second = G.list[1], third = G.list[2];
  function cardOf(id) { return new RegExp('<button\\b[^>]*\\bdata-' + G.attr + '="' + id + '"[\\s\\S]*?</button>').exec(HTML)[0]; }
  var c2 = cardOf(second.id), c3 = cardOf(third.id);
  var COPIES = [
    ['a card left out', HTML.replace(c2, ''), /cards are .*; the registry has/],
    ['two cards changed round', HTML.replace(c2, '\u0000').replace(c3, c2).replace('\u0000', c3), /cards are .*; the registry has/],
    ['a card renamed', HTML.replace('<span>' + second.name + '</span>', '<span>' + second.name + '!</span>'), new RegExp(second.id + ': the card is named')],
    ['one stroke of an icon moved', HTML.replace(c2, c2.replace(/(\d)"\/><\/svg>/, function (m, d) { return (d === '9' ? '8' : '9') + '"/></svg>'; })), new RegExp(second.id + ': the card\'s icon is not the record\'s')],
    ['a card more', HTML.replace(c2, c2 + c2.replace('data-' + G.attr + '="' + second.id + '"', 'data-' + G.attr + '="extra"')), /cards are .*extra.*; the registry has/],
    ['an <svg> that opens otherwise', HTML.replace(c2, c2.replace('viewBox="0 0 24 24"', 'viewBox="0 0 32 32"')), new RegExp(second.id + ': its <svg')],
    ['a card that is no card', HTML.replace(c2, c2.replace(/<span>[^<]*<\/span>/, '')), /is not a button with data-/],
    ['a card that is no choice (its role left out)', HTML.replace(c2, c2.replace(' role="radio"', '')), new RegExp('\\(' + second.id + '\\) is not a type="button" with role="radio" and aria-checked')],
    ['a heading among the cards', HTML.replace(c2, c2 + '<h4>More</h4>'), /holds something that is not a card/]
  ];
  var missed = [];
  COPIES.forEach(function (c) {
    if (c[1] === HTML) { missed.push(c[0] + ': the copy is the page itself'); return; }
    var d = differences(cardsOf(c[1], G.id, G.attr), G.list, G.what);
    if (!d.some(function (x) { return c[2].test(x); })) missed.push(c[0] + ' → ' + (d.join('; ') || 'nothing'));
  });
  check(missed.length === 0, '... and that check finds ' + COPIES.map(function (c) { return c[0]; }).join(', ') + ' (controls on copies of index.html)', missed.join(' | '));
  // the other way round: an engine with a character more, and with an ambience renamed
  var more = engine(AUDIO_SRC + '\nHourglassAudio.defineCharacter({ id: "extra", name: "Extra", icon: "<path d=\\"M1 1h2\\"/>", whisper: 0.02, beds: 0.01, ticks: 0.1, grain: 2, body: 0, modal: 0.1, room: 0.1, low: 0, high: 0, lp: 9000, send: 0, vessel: 0 });');
  var d1 = differences(cardsOf(HTML, 'characters', 'character'), G.list.concat(more.characters().slice(-1)), 'character');
  var d2 = differences(cardsOf(HTML, 'characters', 'character'), G.list.map(function (r) { return r.id === second.id ? { id: r.id, name: r.name + ' II', icon: r.icon } : r; }), 'character');
  check(more.characters().length === A.characters().length + 1 && d1.length === 1 && /the registry has .*extra/.test(d1[0]) &&
        d2.length === 1 && d2[0] === second.id + ': the card is named "' + second.name + '", the record "' + second.name + ' II"',
    '... and a character the registry has and Tune has no card for, and a record renamed (controls)', d1.concat(d2).join('; '));
})();

/* ---- a record the engine could not play is refused as the page loads ---- */
(function () {
  var E = engine(AUDIO_SRC), n0 = E.characters().length, m0 = E.ambiences().length;
  function ch(over) {
    var r = { id: 'x-new', name: 'A new one', icon: '<path d="M1 1h2"/>', whisper: 0.02, beds: 0.01, ticks: 0.1, grain: 2, body: 0, modal: 0.1, room: 0.1, low: 0, high: 0, lp: 9000, send: 0, vessel: 0 }, k;
    for (k in over) { if (over[k] === undefined) delete r[k]; else r[k] = over[k]; }
    return r;
  }
  var six = [[500, 9, 1, 0.1], [900, 9, 0.8, 0.1], [1500, 9, 0.6, 0.1], [2500, 9, 0.4, 0.05], [4000, 9, 0.3, 0.03], [6000, 9, 0.2, 0.02]];
  var NO = [
    ['no record', null, /a record is needed/],
    ['no id', ch({ id: undefined }), /the record has no id/],
    ['an id that is taken', ch({ id: 'warm' }), /"warm": that id is taken/],
    ['a name every object has', ch({ id: 'constructor' }), /"constructor": that id is taken/],
    ['no name', ch({ name: undefined }), /"x-new": it has no name/],
    ['no icon', ch({ icon: '' }), /"x-new": it has no icon/],
    ['a number missing', ch({ lp: undefined }), /"x-new": lp is undefined, not a number/],
    ['a number that is text', ch({ room: '0.2' }), /"x-new": room is 0\.2, not a number/],
    ['a shake that is not a number', ch({ shake: NaN }), /"x-new": shake is NaN, not a number/],
    ['five rows of resonators', ch({ modes: six.slice(0, 5) }), /"x-new": modes has 5 rows; the graph has 6 bands/],
    ['seven rows of resonators', ch({ modes: six.concat([[8000, 9, 0.1, 0.01]]) }), /"x-new": modes has 7 rows/],
    ['a row of three', ch({ modes: six.slice(0, 5).concat([[6000, 9, 0.2]]) }), /"x-new": row 5 of modes is not \[Hz, Q, gain, shift\]/],
    ['a row that holds text', ch({ modes: six.slice(0, 2).concat([[1500, 'nine', 0.6, 0.1]], six.slice(3)) }), /"x-new": row 2 of modes holds nine, not a number/],
    ['a resonator at 0 Hz', ch({ modes: [[0, 9, 1, 0.1]].concat(six.slice(1)) }), /"x-new": row 0 of modes needs a frequency and a Q above 0/],
    ['its resonators under `mode`', ch({ mode: six }), /"x-new": mode is no field of its record \(id, name, icon, whisper, .*, modes\)/],
    ['a misspelt `shak`', ch({ shak: 0.03 }), /"x-new": shak is no field of its record/],
    ['a field nothing reads', ch({ pitch: 1 }), /"x-new": pitch is no field of its record/]
  ];
  var missed = [];
  NO.forEach(function (c) {
    var msg = thrown(function () { E.defineCharacter(c[1]); });
    if (!/^defineCharacter/.test(msg) || !c[2].test(msg) || E.characters().length !== n0 || E.CHARACTERS['x-new']) missed.push(c[0] + ' → ' + (msg || 'accepted'));
  });
  check(missed.length === 0, 'defineCharacter refuses, by name and by rule, and adds nothing: ' + NO.map(function (c) { return c[0]; }).join(', '), missed.join(' | '));
  // ... and a whole record, with and without its own resonators, is taken: the last card, and what the engine reads
  var r1 = ch({}), r2 = ch({ id: 'x-rings', modes: six, tick: 0.7, bed: 0.9, shake: 0.02 });
  var ok1 = thrown(function () { E.defineCharacter(r1); E.defineCharacter(r2); });
  var list = E.characters();
  check(ok1 === '' && list.length === n0 + 2 && list[n0].id === 'x-new' && list[n0 + 1].id === 'x-rings' && list[n0].name === r1.name && list[n0].icon === r1.icon &&
        E.CHARACTERS['x-new'] === r1 && E.CHARACTERS['x-rings'] === r2 && A.characters().length === n0,
    '... and a whole record is taken, with its own six rows or without: the last of characters(), and CHARACTERS holds the record itself (control)', ok1 || list.map(function (r) { return r.id; }).join(', '));
  list[0].name = 'changed';
  check(E.characters()[0].name === A.characters()[0].name && E.CHARACTERS[list[0].id].name === A.characters()[0].name, '... and characters() hands out its own copies: what a caller writes into one stays there');

  // ambiences
  function mk(sr, seconds) { return new Float32Array(Math.floor(sr * seconds)); }
  function am(over) {
    var r = { id: 'x-amb', name: 'A new one', icon: '<path d="M1 1h2"/>', layers: [{ make: mk, seconds: 10, sr: 24000 }] }, k;
    for (k in over) { if (over[k] === undefined) delete r[k]; else r[k] = over[k]; }
    return r;
  }
  // the waterfall as it is, and one second longer: 8.00 MB against 8.19
  var wf = E.AMBIENCES.waterfall, bytes = 0;
  wf.layers.forEach(function (L) { bytes += Math.floor(L.sr * L.seconds) * 2 * 4; });
  var longer = wf.layers.map(function (L, k) { return { make: L.make, seconds: L.seconds + (k ? 0 : 1), sr: L.sr }; });
  var NOA = [
    ['an id that is taken', am({ id: 'rain' }), /"rain": that id is taken/],
    ['no icon', am({ icon: undefined }), /"x-amb": it has no icon/],
    ['no layers in its list', am({ layers: [] }), /"x-amb": layers is empty/],
    ['a layer without make', am({ layers: [{ seconds: 10, sr: 24000 }] }), /"x-amb": layer 0 has no make/],
    ['a layer without a length', am({ layers: [{ make: mk, sr: 24000 }] }), /"x-amb": layer 0 is undefined seconds long/],
    ['a layer without a rate', am({ layers: [{ make: mk, seconds: 10, sr: 0 }] }), /"x-amb": layer 0 has the sample rate 0/],
    ['a cue that is no function', am({ layers: [{ make: mk, seconds: 10, sr: 24000, cue: 3 }] }), /"x-amb": the cue of layer 0 is not a function/],
    ['an audition of no length', am({ audition: 0 }), /"x-amb": audition is 0/],
    ['the waterfall one second longer', am({ layers: longer }), /"x-amb": 8\.19 MB of PCM, more than 8 /],
    ['42 s at 48 kHz', am({ layers: [{ make: mk, seconds: 42, sr: 48000 }] }), /"x-amb": 16\.13 MB of PCM/],
    ['its loops under `layer`, which would be silence', am({ layers: undefined, layer: [{ make: mk, seconds: 10, sr: 24000 }] }), /"x-amb": layer is no field of its record \(id, name, icon, audition, layers\)/],
    ['a misspelt `audtion`', am({ audtion: 9 }), /"x-amb": audtion is no field of its record/],
    ['a layer\'s cue under `que`', am({ layers: [{ make: mk, seconds: 10, sr: 24000, que: function () { return 1; } }] }), /"x-amb", layer 0: que is no field of its record \(make, seconds, sr, cue\)/]
  ];
  missed = [];
  NOA.forEach(function (c) {
    var msg = thrown(function () { E.defineAmbience(c[1]); });
    if (!/^defineAmbience/.test(msg) || !c[2].test(msg) || E.ambiences().length !== m0 || E.AMBIENCES['x-amb']) missed.push(c[0] + ' → ' + (msg || 'accepted'));
  });
  check(missed.length === 0 && bytes <= 8e6 && bytes > 7.9e6, 'defineAmbience refuses, by name and by rule, and adds nothing: ' + NOA.map(function (c) { return c[0]; }).join(', ') +
    ' (the waterfall itself holds ' + (bytes / 1e6).toFixed(2) + ' MB)', missed.join(' | '));
  // the fields a record may hold are the fields today's records hold, no more: a field added to the
  // list and read by nothing would be the silence this rule is there to end
  function fieldsOf(list) { var seen = {}; list.forEach(function (r) { Object.keys(r).forEach(function (k) { seen[k] = true; }); }); return Object.keys(seen).sort().join(' '); }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  var layersOf = [];
  values(A.AMBIENCES).forEach(function (a) { (a.layers || []).forEach(function (L) { layersOf.push(L); }); });
  var fc = fieldsOf(values(A.CHARACTERS)), fa = fieldsOf(values(A.AMBIENCES)), fl = fieldsOf(layersOf);
  check(fc === 'bed beds body grain high icon id low lp modal modes name room send shake tick ticks vessel whisper' && fa === 'audition icon id layers name' && fl === 'cue make seconds sr',
    '... and the fields the records of audio.js hold are the ones a record may: 19 for a character, 5 for an ambience, 4 for a layer', [fc, fa, fl].join(' | '));
  var a1 = am({}), a2 = am({ id: 'x-still', layers: undefined }), a3 = am({ id: 'x-full', audition: 8, layers: [{ make: mk, seconds: 20.8, sr: 48000, cue: function () { return 1; } }] });
  var ok2 = thrown(function () { E.defineAmbience(a1); E.defineAmbience(a2); E.defineAmbience(a3); });
  var la = E.ambiences(), eng = new E(), raw = eng._makeAmbience('x-amb', 1);
  check(ok2 === '' && la.length === m0 + 3 && la[m0].id === 'x-amb' && la[m0 + 1].id === 'x-still' && la[m0 + 2].id === 'x-full' && E.AMBIENCES['x-amb'] === a1 &&
        raw && raw.length === 1 && raw[0][0].length === 240000 && eng._makeAmbience('x-still', 1) === null,
    '... and whole records are taken: one layer, silence (no layers) and 7.99 MB; the engine makes the first from its record (control)', ok2 || la.map(function (r) { return r.id; }).join(', '));
})();

/* ---- the shapes ---- */
(function () {
  var L = require('./lib/load-physics.js'), P = L.P, IDS = P.SHAPE_ORDER || [];
  /** What is wrong with a registry of shapes: [] when it is whole. */
  function shapeFaults(PP) {
    var out = [], order = PP.SHAPE_ORDER || [], all = PP.SHAPES || {};
    if (Object.keys(all).join() !== order.join()) out.push('SHAPE_ORDER is ' + order.join(', ') + '; SHAPES holds ' + Object.keys(all).join(', '));
    if (order[0] !== 'classic') out.push('the classic glass is not the first');
    order.forEach(function (id) {
      var s = all[id];
      if (!s || s.id !== id || typeof s.name !== 'string' || !s.name) { out.push(id + ': no record with that id and a name'); return; }
      if (typeof s.offered !== 'boolean') out.push(id + ': offered is ' + s.offered);
      if (s.symmetry !== 'point') out.push(id + ': symmetry is ' + s.symmetry);
      if (!(s.kR > 0 && s.kH > 0)) out.push(id + ': kR ' + s.kR + ', kH ' + s.kH);
      if (id === 'classic' ? !(s.classic === true && s.f === undefined) : !(typeof s.f === 'function' && !s.classic)) out.push(id + ': ' + (id === 'classic' ? 'is not the one record that says classic and has no f' : 'has no f, or says classic'));
    });
    return out;
  }
  var faults = shapeFaults(P), offered = IDS.filter(function (id) { return P.SHAPES[id] && P.SHAPES[id].offered; });
  check(IDS.length >= 9 && faults.length === 0, 'the ' + IDS.length + ' glass shapes are whole records, the classic first: ' + IDS.join(', ') + ' (Tune may offer ' + offered.length + ' of them)', faults.join('; '));
  var refused = IDS.map(function (id) { return [id, P.checkShape(id, 1.08, 1)]; }).filter(function (r) { return r[1].length; });
  check(typeof P.checkShape === 'function' && refused.length === 0, 'checkShape finds nothing wrong with any of them at the phone\'s size (sim-shape asks at every size)',
    refused.map(function (r) { return r[0] + ': ' + r[1].join(', '); }).join('; '));

  // controls, on other copies of physics.js: records put in past addShape, and what addShape refuses
  var PP = L.loadIsolated(L.physicsSource(), 'physics.js');
  function f(u) { return u <= 0.6 ? u / 0.6 : Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.6) / 0.4, 2.2))); }
  PP.SHAPES['x-bare'] = { id: 'x-bare', name: 'put in by hand', kR: 1, kH: 1, f: f };
  PP.SHAPE_ORDER.push('x-bare');
  PP.SHAPES['x-lost'] = { id: 'x-lost', name: 'in no order', kR: 1, kH: 1, f: f, offered: true, symmetry: 'point' };
  var cf = shapeFaults(PP);
  check(cf.length === 3 && /SHAPES holds .*x-lost/.test(cf[0]) && /x-bare: offered is undefined/.test(cf[1]) && /x-bare: symmetry is undefined/.test(cf[2]),
    '... and that check finds a record put in past addShape, and one that is in no order (control)', cf.join('; '));
  var P2 = L.loadIsolated(L.physicsSource(), 'physics.js'), n0 = P2.SHAPE_ORDER.length;
  var NO = [
    ['no id', { name: 'x', kR: 1, kH: 1, f: f }, /the record has no id/],
    ['an id that is taken', { id: 'bell', name: 'x', kR: 1, kH: 1, f: f }, /"bell": that id is taken/],
    ['no name', { id: 'x-new', kR: 1, kH: 1, f: f }, /"x-new": it has no name/],
    ['no f', { id: 'x-new', name: 'x', kR: 1, kH: 1 }, /"x-new": it has no f\(u\)/],
    ['an open neck', { id: 'x-new', name: 'x', kR: 1, kH: 1, f: function (u) { return 0.1 + 0.9 * f(u); } }, /"x-new": f\(0\) is 0\.1/],
    ['a glass that is not the same after a half turn', { id: 'x-new', name: 'x', kR: 1, kH: 1, f: f, symmetry: 'none' }, /"x-new": symmetry "none"/],
    ['a misspelt `offerd`', { id: 'x-new', name: 'x', kR: 1, kH: 1, f: f, offerd: true }, /"x-new": offerd is no field of its record \(id, name, kR, kH, f, classic, equator, symmetry, offered\)/],
    ['a misspelt `symetry`', { id: 'x-new', name: 'x', kR: 1, kH: 1, f: f, symetry: 'none' }, /"x-new": symetry is no field of its record/],
    ['an equator of its own, which is read off f', { id: 'x-new', name: 'x', kR: 1, kH: 1, f: f, equator: 0.5 }, /"x-new": its equator is read off f/]
  ];
  var missed = [];
  NO.forEach(function (c) {
    var msg = thrown(function () { P2.addShape(c[1]); });
    if (!/^addShape/.test(msg) || !c[2].test(msg) || P2.SHAPE_ORDER.length !== n0) missed.push(c[0] + ' → ' + (msg || 'accepted'));
  });
  var good = { id: 'x-new', name: 'A new glass', kR: 0.9, kH: 1, f: f }, okMsg = thrown(function () { P2.addShape(good); });
  var after = shapeFaults(P2), why = okMsg ? [] : P2.checkShape('x-new', 1.08, 1);
  check(missed.length === 0 && okMsg === '' && P2.SHAPE_ORDER[n0] === 'x-new' && good.offered === false && after.length === 0 && why.length === 0,
    'addShape refuses, by name and by rule: ' + NO.map(function (c) { return c[0]; }).join(', ') + '; and takes a whole record, as the last, not offered (control)',
    missed.concat(okMsg ? [okMsg] : [], after, why).join(' | '));
  var seenFields = {};
  IDS.forEach(function (id) { Object.keys(P.SHAPES[id]).forEach(function (k) { seenFields[k] = true; }); });
  var fs9 = Object.keys(seenFields).sort().join(' ');
  check(fs9 === 'classic equator f id kH kR name offered symmetry', '... and the fields the records of physics.js hold are the ones a record may: 9 for a shape', fs9);
  // checkShape on a glass the sand cannot use: wider than its R, and two bulges
  P2.SHAPES['x-fat'] = { id: 'x-fat', name: 'too wide', kR: 1, kH: 1, f: function (u) { return 1.05 * f(u); } };
  P2.SHAPES['x-two'] = { id: 'x-two', name: 'two bulges', kR: 1, kH: 1, f: function (u) { return f(u) * (1 - 0.4 * Math.exp(-Math.pow((u - 0.3) / 0.05, 2))); } };
  var w1 = P2.checkShape('x-fat', 1.08, 1), w2 = P2.checkShape('x-two', 1.08, 1), w3 = P2.checkShape('x-none', 1.08, 1);
  check(w1.length >= 2 && /f must stay between 0 and 1/.test(w1[0]) && w1.some(function (r) { return /wider than R = 95 allows/.test(r); }) &&
        w2.length >= 2 && /one bulge only/.test(w2[0]) && w2.some(function (r) { return /it narrows again between the neck and its widest row/.test(r); }) &&
        w3.length === 1 && /there is no glass shape "x-none"/.test(w3[0]),
    '... and checkShape says why of a glass wider than its R, of one with two bulges and of an id nobody registered (control)', [w1.join(', '), w2.join(', '), w3.join(', ')].join(' | '));
})();

console.log('check-registry: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
