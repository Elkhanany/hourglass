#!/usr/bin/env node
/*
 * The pieces of HourglassPhysics, in Node, in a moment (the check group: node tools/test/run-all.js
 * check-). No parser, no dependency: Node's vm only.
 *
 * The classic sand and the glass are seven classic scripts (glass/ and sand/) that each add to one
 * namespace, HourglassPhysics (P), and to P._, the names they share that are not the app's. Each
 * reads what it needs from them once, at load, from the pieces loaded before it. A name one piece
 * uses and another declares, without its import line, is a ReferenceError only when that code runs,
 * and where the WebGL glass is built such an error is caught and the plainer 2-D glass is drawn
 * instead, with no page error. So, for each piece, in the order index.html loads them
 * (paths.physicsParts()):
 *   1. its top-level names, exactly: the piece's text without its wrapper is run as a script at
 *      the global scope of a fresh vm context (after the pieces before it), so every `var` and
 *      `function` it declares becomes a property of that global; minus P, _ and its own imports;
 *   2. its imports (`name = P.name` / `name = _.name` before the first banner) and its exports
 *      (`P.name = name;` / `_.name = name;` after the last region);
 *   3. every identifier in its code (comments, strings and regular expressions blanked; a name after
 *      `.` and an object key are not identifiers) that is a top-level name of ANOTHER piece must be
 *      one of its imports. This over-approximates: a local variable named like another piece's
 *      top-level name also needs the import (harmless), so a use is never missed;
 *   4. every import is exported, under the same P or _, by a piece loaded before it; every export
 *      is a name the piece declares;
 *   5. the chain: each piece says it ran (`_.loaded = '<its file>'`, its last line), and each but the
 *      first runs only if the piece just before it did (`if (_.loaded !== '<that file>') return;`).
 *      So when one piece is missing from an installed copy, the pieces after it define nothing and
 *      app.js's pre-flight check finds HourglassPhysics.Spill missing and says the app is updating
 *      (check-shell tests that message with each script missing); this check runs the pieces with
 *      each one left out in turn and sees that none after it adds a name.
 * A failure names the piece, the name and the line.
 * Each rule has its control: a copy of the pieces that breaks it must fail.
 *
 *   node tools/test/check-pieces.test.js
 */
'use strict';
var vm = require('vm');
var paths = require('./lib/paths.js');
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}

/** Comments, strings and regular-expression literals replaced by spaces (newlines kept, so lines hold). */
function blank(s) {
  var o = s.split(''), i = 0, n = s.length, prev = '', word = '';
  var REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^', KEYWORDS = /^(return|typeof|case|in|new|delete|void|throw|else|do)$/;
  function sp(a, b) { for (var j = a; j < b; j++) if (o[j] !== '\n') o[j] = ' '; }
  while (i < n) {
    var c = s[i], d = s[i + 1], j;
    if (c === '/' && d === '/') { j = s.indexOf('\n', i); j = j < 0 ? n : j; sp(i, j); i = j; continue; }
    if (c === '/' && d === '*') { j = s.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; sp(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      j = i + 1;
      while (j < n && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
      sp(i + 1, j); i = j + 1; prev = 'x'; word = ''; continue;
    }
    if (c === '/' && (prev === '' || REGEX_AFTER.indexOf(prev) >= 0 || KEYWORDS.test(word))) {
      j = i + 1; var cls = false;
      while (j < n && (cls || s[j] !== '/')) { if (s[j] === '\\') j++; else if (s[j] === '[') cls = true; else if (s[j] === ']') cls = false; j++; }
      j++; while (j < n && /[a-z]/.test(s[j])) j++;
      sp(i, j); i = j; prev = 'x'; word = ''; continue;
    }
    if (/[A-Za-z_$0-9]/.test(c)) {
      j = i; while (j < n && /[\w$]/.test(s[j])) j++;
      word = s.slice(i, j); prev = 'x'; i = j; continue;
    }
    if (!/\s/.test(c)) { prev = c; word = ''; }
    i++;
  }
  return o.join('');
}
/** Identifiers of the code, with their lines: not after a dot, not an object key. */
function identifiers(code) {
  var b = blank(code), out = [], re = /[A-Za-z_$][\w$]*/g, m;
  while ((m = re.exec(b))) {
    var a = m.index, e = a + m[0].length, p = a - 1, q = e;
    if (a > 0 && /[\w$]/.test(b[a - 1])) continue;               // (inside a number such as 1e5)
    while (p >= 0 && /\s/.test(b[p])) p--;
    if (p >= 0 && b[p] === '.') continue;
    while (q < b.length && /[ \t]/.test(b[q])) q++;
    if (b[q] === ':' && p >= 0 && (b[p] === '{' || b[p] === ',')) continue;
    out.push({ name: m[0], line: b.slice(0, a).split('\n').length });
  }
  return out;
}
/** One piece: its wrapper, imports, exports, its text without the wrapper, and its code. */
function parts(text, file) {
  var lines = text.split('\n');
  var open = lines.indexOf('(function (root) {'), close = -1, firstBanner = -1, lastClose;
  for (var i = 0; i < lines.length; i++) {
    if (firstBanner < 0 && /^  \/\* =+$/.test(lines[i])) firstBanner = i;
    if (lines[i].indexOf('})(typeof window') === 0) close = i;
  }
  if (open < 0 || close < 0 || firstBanner < 0) throw new Error(file + ': not a piece (wrapper or banner missing)');
  var imports = {}, exports = {}, m, re, guard = null, loaded = null, guardAt = -1;
  for (i = open + 1; i < firstBanner; i++) {
    m = /^  if \(_\.loaded !== '([^']+)'\) return;/.exec(lines[i]);
    if (m) { guard = m[1]; guardAt = i; }
  }
  m = /^  _\.loaded = '([^']+)';$/.exec(lines[close - 1] || '');
  if (m) { loaded = m[1]; close--; }
  var head = lines.slice(open + 1, firstBanner).join('\n');
  re = /\b([A-Za-z_$][\w$]*) = (P|_)\.([A-Za-z_$][\w$]*)/g;
  while ((m = re.exec(head))) { if (m[1] === '_' && m[3] === '_') continue; if (m[1] !== m[3]) throw new Error(file + ': import ' + m[0] + ' renames'); imports[m[1]] = m[2]; }
  // exports: the lines after the last region's code, before the wrapper's close
  for (lastClose = close - 1; lastClose > firstBanner && /^\s*((P|_)\.[\w$]+ = [\w$]+;\s*)*$/.test(lines[lastClose]); lastClose--);
  var tail = lines.slice(lastClose + 1, close).join('\n');
  re = /\b(P|_)\.([A-Za-z_$][\w$]*) = ([A-Za-z_$][\w$]*);/g;
  while ((m = re.exec(tail))) { if (m[2] !== m[3]) throw new Error(file + ': export ' + m[0] + ' renames'); exports[m[2]] = m[1]; }
  // the text without the wrapper (and its guard: a `return` outside a function)
  var body = lines.slice(0, open).concat(lines.slice(open + 1, close).map(function (l, j) { return open + 1 + j === guardAt ? '' : l; })).join('\n');
  return { imports: imports, exports: exports, guard: guard, loaded: loaded, body: body, code: lines.slice(firstBanner, lastClose + 1).join('\n'), codeLine0: firstBanner };
}

/** The problems of a list of pieces (file names and texts, in load order); [] when they are whole. */
function problemsOf(files, texts) {
  var info = texts.map(function (t, k) { return parts(t, files[k]); });
  // 1. exact top-level names
  info.forEach(function (pc, k) {
    var c = vm.createContext({});
    // (a piece run out of order may throw; its declarations are made before any of it runs, so they are counted all the same)
    for (var j = 0; j < k; j++) try { vm.runInContext(texts[j], c, { filename: files[j] }); } catch (e) { /* counted below */ }
    vm.runInContext('var root = this;', c);
    var before = vm.runInContext('Object.getOwnPropertyNames(this)', c);
    try { vm.runInContext(pc.body, c, { filename: files[k] + ' (unwrapped)' }); } catch (e) { pc.threw = e.message; }
    var after = vm.runInContext('Object.getOwnPropertyNames(this)', c);
    pc.top = after.filter(function (x) { return before.indexOf(x) < 0 && x !== 'P' && x !== '_' && !(x in pc.imports); });
  });
  var owner = {};
  info.forEach(function (pc, k) { pc.top.forEach(function (x) { owner[x] = k; }); });
  var problems = [];
  info.forEach(function (pc, k) {
    // 3. uses of other pieces' names
    var seen = {};
    identifiers(pc.code).forEach(function (id) {
      var o = owner[id.name];
      if (o === undefined || o === k || id.name in pc.imports || seen[id.name]) return;
      seen[id.name] = 1;
      problems.push(files[k] + ':' + (pc.codeLine0 + id.line) + ' uses ' + id.name + ' (a top-level name of ' + files[o] + ') without importing it');
    });
    // 4. imports come from an earlier piece's exports, under the same namespace; exports are its own
    Object.keys(pc.imports).forEach(function (x) {
      var from = -1;
      for (var j = 0; j < k; j++) if (info[j].exports[x] === pc.imports[x]) from = j;
      if (from < 0) problems.push(files[k] + ' imports ' + pc.imports[x] + '.' + x + ', which no piece before it exports');
    });
    Object.keys(pc.exports).forEach(function (x) {
      if (pc.top.indexOf(x) < 0) problems.push(files[k] + ' exports ' + x + ', which it does not declare');
    });
    // 5. the chain
    if (pc.loaded !== files[k]) problems.push(files[k] + ' does not end by saying it ran (_.loaded = \'' + files[k] + '\'; before its close)' + (pc.loaded ? ': it says ' + pc.loaded : ''));
    if (k === 0 && pc.guard !== null) problems.push(files[k] + ' is loaded first but waits for ' + pc.guard);
    if (k > 0 && pc.guard !== files[k - 1]) problems.push(files[k] + ' does not wait for ' + files[k - 1] + ', the piece before it' + (pc.guard ? ' (it waits for ' + pc.guard + ')' : ''));
  });
  // 5. ... and it holds when run: with each piece left out, no piece after it adds a name (to P or P._)
  function names(P0) { return Object.keys(P0).filter(function (x) { return x !== '_'; }).concat(Object.keys(P0._ || {}).map(function (x) { return '_.' + x; })); }
  files.forEach(function (f, k) {
    var c = vm.createContext({}), added = [];
    texts.forEach(function (t, j) {
      if (j === k) return;
      var P0 = c.HourglassPhysics || {}, before = names(P0);
      try { vm.runInContext(t, c, { filename: files[j] }); } catch (e) { if (j > k) added.push(files[j] + ' threw ' + e.message); return; }
      var after = names(c.HourglassPhysics || {});
      if (j > k && after.length !== before.length) added.push(files[j] + ' added ' + after.filter(function (x) { return before.indexOf(x) < 0; }).join(' '));
    });
    if (added.length) problems.push('with ' + f + ' left out, ' + added.join('; '));
  });
  return { problems: problems, info: info };
}

var FILES = paths.physicsParts(), TEXTS = FILES.map(function (f) { return paths.piece(f); });
var r = problemsOf(FILES, TEXTS);
check(FILES.length === 7, 'index.html loads HourglassPhysics as seven pieces: ' + FILES.join(', '));
r.info.forEach(function (pc, k) {
  console.log('      ' + FILES[k] + ': ' + pc.top.length + ' top-level names; imports ' + (Object.keys(pc.imports).join(' ') || '-') +
    '; exports ' + (Object.keys(pc.exports).join(' ') || '-'));
});
check(r.problems.length === 0, 'every name used across pieces is imported from a piece loaded before it, under the namespace it is exported on; ' +
  'each piece runs only after the one before it, so with any one left out the pieces after it define nothing', r.problems.join('; '));

// controls: copies of the pieces that break one rule each
function find(re) {
  for (var k = 0; k < FILES.length; k++) {
    var m = re.exec(TEXTS[k]);
    if (m) return { k: k, m: m };
  }
  return null;
}
function edited(k, from, to) {
  var t = TEXTS.slice();
  if (t[k].indexOf(from) < 0) throw new Error('control: ' + JSON.stringify(from) + ' is not in ' + FILES[k]);
  t[k] = t[k].replace(from, to);
  return t;
}
// (rule 3) an import line without one name: the use of that name is found, by file and line
var imp = find(/^  var (\w+) = (P|_)\.(\w+), /m);
if (!imp) check(false, 'control: a piece with an import line of two or more names');
else {
  var c1 = problemsOf(FILES, edited(imp.k, imp.m[0], '  var '));
  var want1 = new RegExp('^' + FILES[imp.k].replace(/[.\/]/g, '\\$&') + ':\\d+ uses ' + imp.m[1] + ' ');
  check(c1.problems.some(function (p) { return want1.test(p); }), '... a copy of ' + FILES[imp.k] + ' without its import of ' + imp.m[1] + ' fails, naming the line that uses it (control)', c1.problems.join('; '));
}
// (rule 4) the pieces in another order: a piece then imports what no piece before it exports
var swapped = FILES.slice(), swappedT = TEXTS.slice();
swapped.reverse(); swappedT.reverse();
var c2 = problemsOf(swapped, swappedT);
check(c2.problems.some(function (p) { return /imports (P|_)\.\w+, which no piece before it exports$/.test(p); }), '... the same pieces loaded in reverse order fail: an import from a piece loaded after it (control)', c2.problems.slice(0, 2).join('; '));
// (rule 4) an import that names the other namespace
var pub = find(/^  var (\w+) = P\.(\w+)[,;]/m);
if (!pub) check(false, 'control: a piece that imports a name of P');
else {
  var c3 = problemsOf(FILES, edited(pub.k, pub.m[1] + ' = P.' + pub.m[1], pub.m[1] + ' = _.' + pub.m[1]));
  check(c3.problems.some(function (p) { return p === FILES[pub.k] + ' imports _.' + pub.m[1] + ', which no piece before it exports'; }), '... a copy of ' + FILES[pub.k] + ' that imports ' + pub.m[1] + ' from _ instead of P fails (control)', c3.problems.join('; '));
}
// (rule 4) an export of a name the piece does not declare
var exp = find(/^  (P|_)\.(\w+) = (\w+);/m);
if (!exp) check(false, 'control: a piece with an export line');
else {
  var c4 = problemsOf(FILES, edited(exp.k, exp.m[0], exp.m[0] + ' ' + exp.m[1] + '.notDeclaredHere = notDeclaredHere;'));
  check(c4.problems.some(function (p) { return p === FILES[exp.k] + ' exports notDeclaredHere, which it does not declare'; }), '... a copy of ' + FILES[exp.k] + ' that exports a name it does not declare fails (control)', c4.problems.join('; '));
}
// (rule 3, through rule 1) a use in a comment, a string or after a dot is not a use; in code it is
var last = FILES.length - 1, firstName = r.info[0].top[0];
var probe = '  /* ' + firstName + ' */ var probeA = "' + firstName + '", probeB = {}.' + firstName + ';\n';
var banner = /\n   \* =+ \*\/\n/.exec(TEXTS[last]);       // the end of its first banner: the probe goes in its code
var c5 = banner ? problemsOf(FILES, edited(last, banner[0], banner[0] + probe)) : { problems: ['no banner'] };
var c6 = banner ? problemsOf(FILES, edited(last, banner[0], banner[0] + probe + '  var probeC = ' + firstName + ';\n')) : { problems: [] };
check(firstName && c5.problems.length === 0 && c6.problems.length === 1 && c6.problems[0].indexOf(FILES[last] + ':') === 0 && c6.problems[0].indexOf(' uses ' + firstName + ' ') > 0,
  '... ' + firstName + ' (of ' + FILES[0] + ') named in a comment, a string and after a dot in ' + FILES[last] + ' is no use; read in its code, it fails (control)', JSON.stringify({ comment: c5.problems, code: c6.problems }));

// (rule 5) a piece that does not wait for the one before it, and one that does not say it ran
var mid = 3, g = "  if (_.loaded !== '" + FILES[mid - 1] + "') return;";
var c7 = problemsOf(FILES, edited(mid, g + '   ', '  // ' + g.trim() + '   '));
check(c7.problems.some(function (p) { return p.indexOf(FILES[mid] + ' does not wait for ' + FILES[mid - 1]) === 0; }) &&
      c7.problems.some(function (p) { return p.indexOf('with ' + FILES[mid - 1] + ' left out, ' + FILES[mid] + ' ') === 0; }),
  '... a copy of ' + FILES[mid] + ' without its wait for ' + FILES[mid - 1] + ' fails, and with that piece left out it is seen to run (control)', c7.problems.join('; '));
var c8 = problemsOf(FILES, edited(mid, "  _.loaded = '" + FILES[mid] + "';\n", ''));
check(c8.problems.some(function (p) { return p.indexOf(FILES[mid] + ' does not end by saying it ran') === 0; }),
  '... and a copy of ' + FILES[mid] + ' that does not say it ran fails (control)', c8.problems.slice(0, 3).join('; '));

console.log('check-pieces: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
