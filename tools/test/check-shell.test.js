#!/usr/bin/env node
/*
 * The shell check, in Node, in a moment (the check group: node tools/test/run-all.js check-).
 *
 * The service worker installs every path of its SHELL with cache.addAll, which fails the whole
 * install if one is missing, and the installed app works offline with what the shell holds. The
 * page loads its scripts as classic scripts, before the one door to module code (Real sand,
 * behind the switch and navigator.gpu): a syntax error there stops the whole file on an older
 * WebKit. So:
 *  - every src and href of index.html and every icon of manifest.json is in SHELL; the named
 *    exceptions are the launch screens (icons/splash/: iOS reads them when the app is added to the
 *    home screen) and the manifest's screenshots (docs/images/: for the install sheet);
 *  - every SHELL path is a file that exists, and none is there twice;
 *  - no classic script (the scripts index.html loads, from lib/paths.js, and sw.js, which is
 *    registered as a classic worker) has module syntax, import(), or any of =>, let, const,
 *    template strings, class, ?. and ??, with strings, comments and regular expressions blanked
 *    first, so that a word inside them is not taken for code.
 * Each rule has its control: the same check on a copy that breaks it must fail.
 *
 *   node tools/test/check-shell.test.js
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var paths = require('./lib/paths.js');
var ROOT = paths.ROOT;
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

/* ---- the worker's SHELL, read by running sw.js with a stand-in for its scope ---- */
function shellOf(swSrc) {
  var ctx = { self: { addEventListener: function () {}, location: { origin: 'http://x' } }, URL: URL };
  vm.runInNewContext(swSrc, ctx);
  return ctx.SHELL;
}
function norm(u) { return u === './' ? 'index.html' : u.replace(/^\.\//, '').split(/[?#]/)[0]; }

/* ---- 1. what the page and the manifest name, against SHELL ---- */
var EXCEPT = [
  { why: 'a launch screen (iOS reads it when the app is added to the home screen)', test: function (f) { return /^icons\/splash\/splash-\d+x\d+\.png$/.test(f); } },
  { why: 'a screenshot of the manifest (for the install sheet)', test: function (f, man) { return (man.screenshots || []).some(function (s) { return norm(s.src) === f; }); } }
];
function named(html, man) {
  var out = [], m, re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  while ((m = re.exec(html))) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(m[1])) continue;            // other sites, mail, anchors
    out.push({ f: norm(m[1]), from: 'index.html' });
  }
  (man.icons || []).forEach(function (i) { out.push({ f: norm(i.src), from: 'manifest.json icons' }); });
  (man.shortcuts || []).forEach(function (s) { (s.icons || []).forEach(function (i) { out.push({ f: norm(i.src), from: 'manifest.json shortcuts' }); }); });
  (man.screenshots || []).forEach(function (s) { out.push({ f: norm(s.src), from: 'manifest.json screenshots' }); });
  return out;
}
function notInShell(list, shell, man) {
  var inShell = {};
  shell.forEach(function (u) { inShell[norm(u)] = true; });
  return list.filter(function (n) {
    return !inShell[n.f] && !EXCEPT.some(function (e) { return e.test(n.f, man); });
  }).map(function (n) { return n.f + ' (' + n.from + ')'; });
}
function absent(shell, root) {
  return shell.filter(function (u) {
    var p = path.join(root || ROOT, norm(u));
    return !fs.existsSync(p) || fs.statSync(p).isDirectory();
  });
}

var SHELL = shellOf(read('sw.js')), MAN = JSON.parse(read('manifest.json')), HTML = read('index.html');
var NAMED = named(HTML, MAN);
check(Array.isArray(SHELL) && SHELL.length > 10 && SHELL.indexOf('./') >= 0 && SHELL.indexOf('./index.html') >= 0,
  'sw.js has its SHELL, with the page itself (./ and ./index.html)', SHELL && SHELL.length + ' paths');
var scripts = paths.classicScripts();
check(scripts.length >= 4 && scripts[scripts.length - 1] === 'app.js', 'index.html loads its classic scripts, app.js last', scripts.join(', '));
var out = notInShell(NAMED, SHELL, MAN), excepted = NAMED.filter(function (n) { return EXCEPT.some(function (e) { return e.test(n.f, MAN); }); });
check(NAMED.length >= 20 && out.length === 0, 'every src and href of index.html and every icon of manifest.json (' + NAMED.length + ') is in SHELL, but the ' +
  excepted.length + ' named exceptions (launch screens, screenshots)', out.join(', '));
// controls: a SHELL without motion.js and without the 512 px icon; a page that links a new file
var cut = SHELL.filter(function (u) { return u !== './' + paths.script('motion.js') && u !== './icons/icon-512.png'; });
var c1 = notInShell(NAMED, cut, MAN);
check(c1.length === 2 && /motion\.js/.test(c1[0] + c1[1]) && /icon-512/.test(c1[0] + c1[1]), '... and that check finds a script and an icon left out of SHELL (control)', c1.join(', '));
var c2 = notInShell(named(HTML.replace('</body>', '<script src="./glass/new-piece.js" defer></script></body>'), MAN), SHELL, MAN);
check(c2.length === 1 && c2[0].indexOf('glass/new-piece.js') === 0, '... and a script tag whose file SHELL does not name (control)', c2.join(', '));

/* ---- 2. every SHELL path exists, once ---- */
var missing = absent(SHELL);
check(missing.length === 0, 'every path in SHELL is a file that exists (cache.addAll fails the install on one that is not)', missing.join(', '));
var c3 = absent(SHELL.concat(['./physics2.js', './icons']));
check(c3.length === 2, '... and that check finds a path that is not there and a folder (control)', c3.join(', '));
var dup = SHELL.filter(function (u, i) { return SHELL.indexOf(u) !== i; });
check(dup.length === 0, 'no path is in SHELL twice', dup.join(', '));

/* ---- 3. the classic scripts parse on an older WebKit ---- */
/**
 * src with every string, comment and regular expression literal turned to spaces (newlines
 * kept, so lines still count), and the template strings it met: [{ line }].
 */
function blank(src) {
  var out = src.split(''), n = src.length, i = 0, prev = '', templates = [];
  function line(at) { return src.slice(0, at).split('\n').length; }
  function wipe(a, b) { for (var k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; }
  var KW = /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  while (i < n) {
    var c = src[i], d = src[i + 1], j;
    if (c === '/' && d === '/') { j = src.indexOf('\n', i); if (j < 0) j = n; wipe(i, j); i = j; continue; }
    if (c === '/' && d === '*') { j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      if (c === '`') templates.push({ line: line(i) });
      for (j = i + 1; j < n && src[j] !== c; j++) { if (src[j] === '\\') j++; else if (src[j] === '\n' && c !== '`') break; }
      wipe(i, j + 1); i = j + 1; prev = 'v'; continue;
    }
    if (c === '/') {
      // a regular expression where an expression can begin; else division
      var expr = prev === '' || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || KW.test(prev);
      if (expr) {
        var cls = false;
        for (j = i + 1; j < n; j++) {
          if (src[j] === '\\') { j++; continue; }
          if (src[j] === '\n') break;
          if (cls) { if (src[j] === ']') cls = false; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === '/') break;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        wipe(i, j); i = j; prev = 'v'; continue;
      }
      prev = '/'; i++; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      for (j = i; j < n && /[\w$]/.test(src[j]); j++);
      prev = src.slice(i, j); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      for (j = i; j < n && /[\w.]/.test(src[j]); j++);
      prev = 'v'; i = j; continue;
    }
    if (!/\s/.test(c)) prev = c === ')' || c === ']' || c === '}' ? 'v' : c;
    i++;
  }
  return { code: out.join(''), templates: templates };
}
var NEWER = [
  { what: 'module syntax (import or export)', re: /(?<![.\w$])(?:import|export)\b(?!\s*[:(])/ },
  { what: 'import()', re: /(?<![.\w$])import\s*\(/ },
  { what: '=>', re: /=>/ },
  { what: 'let', re: /(?<![.\w$])let\b(?!\s*:)/ },
  { what: 'const', re: /(?<![.\w$])const\b(?!\s*:)/ },
  { what: 'class', re: /(?<![.\w$])class\b(?!\s*:)/ },
  { what: '?.', re: /\?\.(?!\d)/ },
  { what: '??', re: /\?\?/ }
];
/** The tokens newer than ES5 in a classic script: ['line N: what', ...]. */
function newer(src) {
  var b = blank(src), found = b.templates.map(function (t) { return 'line ' + t.line + ': a template string'; });
  b.code.split('\n').forEach(function (l, k) {
    NEWER.forEach(function (t) { if (t.re.test(l)) found.push('line ' + (k + 1) + ': ' + t.what); });
  });
  return found;
}
var CLASSIC = scripts.concat(['sw.js']);
CLASSIC.forEach(function (f) {
  var bad = newer(read(f));
  check(bad.length === 0, f + ' is a classic script with nothing newer than ES5 (no module syntax, import(), =>, let, const, template strings, class, ?. or ??)',
    bad.slice(0, 6).join('; '));
});
// controls: each token in code is found; the same words in strings, comments and regular
// expressions, a ternary before a decimal and property names that are keywords are not
var SAMPLES = {
  'module syntax (import or export)': ['import x from "./x.js";', 'export default 1;', 'export function f() {}', 'import "./side.js";'],
  'import()': ['var p = import("./realsand/boot.mjs");'],
  '=>': ['var f = (a) => a + 1;'],
  'let': ['let a = 1;', 'for (let i = 0; i < 2; i++) {}'],
  'const': ['const a = 1;'],
  'class': ['class A { }'],
  '?.': ['var y = a?.b;', 'f?.(1);'],
  '??': ['var y = a ?? 1;'],
  'a template string': ['var s = `a ${b}`;']
};
var missed = [];
Object.keys(SAMPLES).forEach(function (what) {
  SAMPLES[what].forEach(function (code) {
    var got = newer('var z = 1;\n' + code + '\n');
    if (!got.some(function (g) { return g === 'line 2: ' + what; })) missed.push(code + ' → ' + (got.join('; ') || 'nothing'));
  });
});
check(missed.length === 0, '... and that check finds each of them in code (control: ' + Object.keys(SAMPLES).length + ' kinds)', missed.join(' | '));
var clean = [
  'var s = "const x = () => y ?? z?.w; `t`";', "var t = 'let a; class B {} import(\\'x\\')';", '// let x = 1; export default 2; a => b',
  '/* const y = `z`; ?? ?. */', 'var r = /=>|\\?\\?|`/g, q = /[/]let/.test(s);', 'var h = a ? .5 : 1, k = a ? b : c;',
  'var o = { class: 1, let: 2, const: 3, import: 4, export: 5 }; o.class = o.let + o.const + o.import + o.export;',
  'var d = a / b / c, e = (x) / 2;', 'if (/^import\\b/.test(s)) f();', 'return /const/.test(s);'
].join('\n');
var flagged = newer(clean);
check(flagged.length === 0, '... and finds none where the words are only in strings, comments and regular expressions, a ternary, a division or a property name (control)', flagged.join('; '));
// and on a real file: a const added to a copy of motion.js, and a template string to app.js
var mot = read(paths.script('motion.js')), app = read('app.js');
var c4 = newer(mot + '\nconst EXTRA = 1;\n'), c5 = newer(app.replace(/var REALSAND_BUILD = '([^']+)'/, 'var REALSAND_BUILD = `$1`'));
check(c4.length === 1 && /const/.test(c4[0]) && c5.length === 1 && /template/.test(c5[0]), '... and in a copy of motion.js with a const and of app.js with a template string (control)', c4.concat(c5).join('; '));

console.log('check-shell: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
