#!/usr/bin/env node
/*
 * The shell check, in Node, in a moment (the check group: node tools/test/run-all.js check-).
 *
 * The service worker installs every path of its SHELL with cache.addAll, which fails the whole
 * install if one is missing, and the installed app works offline with what the shell holds. The
 * page loads its scripts as classic scripts, before the one door to module code (Real sand,
 * behind the switch and navigator.gpu): a syntax error there stops the whole file on an older
 * WebKit. So:
 *  - every src and href of index.html (quoted or not), every url() and @import of a stylesheet
 *    it names, and every icon of manifest.json is a file that exists and is in SHELL; the named
 *    exceptions to SHELL are the launch screens (icons/splash/: iOS reads them when the app is
 *    added to the home screen) and the manifest's screenshots (docs/images/: for the install sheet);
 *  - an inline script of index.html (a script tag without src: the page has one, which says
 *    "Hourglass is updating" when app.js itself or the stylesheet is missing from the offline
 *    copy) is read by the same syntax check as the classic files, and none is a module;
 *  - every SHELL path is a file that exists, and none is there twice;
 *  - no classic script (the scripts index.html loads, from lib/paths.js, and sw.js, which is
 *    registered as a classic worker) has any of these kinds of newer syntax: module syntax,
 *    import(), =>, let, const, template strings, class, ?. and ??, async functions, await,
 *    for-of, ... (spread and rest), **, generators, a default or destructured parameter,
 *    var with a pattern, catch without a binding, and a shorthand method; with strings, comments
 *    and regular expressions blanked first, so that a word inside them is not taken for code.
 *    It is a scan by line, not a parser: shorthand properties ({ a, b }), computed keys, a
 *    destructuring assignment and a parameter list over several lines are not seen.
 * Each rule has its control: the same check on a copy that breaks it must fail.
 *
 *   node tools/test/check-shell.test.js
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var paths = require('./lib/paths.js');
var blank = require('./lib/scan.js').blank;
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
function elsewhere(u) { return /^(?:[a-z]+:|#|\/\/)/i.test(u); }       // other sites, data:, mail, anchors
/** What a stylesheet names: its url()s and @imports, relative to its own folder. */
function namedByCss(f, css) {
  var out = [], m, re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((m = re.exec(css))) {
    var u = m[1] || m[2] || m[3] || m[4] || m[5] || '';
    if (!u || elsewhere(u)) continue;
    out.push({ f: path.posix.normalize(path.posix.join(path.posix.dirname(f), u.split(/[?#]/)[0])), from: f });
  }
  return out;
}
/** readCss(f) gives a stylesheet's text (null if it is not there); the real tree's by default. */
function named(html, man, readCss) {
  var out = [], m, re = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  readCss = readCss || function (f) { return fs.existsSync(path.join(ROOT, f)) ? read(f) : null; };
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  while ((m = re.exec(html))) {
    var u = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (!u || elsewhere(u)) continue;
    out.push({ f: norm(u), from: 'index.html' });
  }
  out.filter(function (n) { return /\.css$/.test(n.f); }).forEach(function (n) {
    var css = readCss(n.f);
    if (css !== null) out = out.concat(namedByCss(n.f, css));
  });
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
/** The inline scripts of a page: its script tags that have no src and whose type, if any, is JavaScript: [{ line, code, module }]. */
function inlineScripts(html) {
  var out = [], m, re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, clean = html.replace(/<!--[\s\S]*?-->/g, function (c) { return c.replace(/[^\n]/g, ' '); });
  while ((m = re.exec(clean))) {
    var type = paths.attr(m[1], 'type');
    if (paths.attr(m[1], 'src') || (type && !/^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i.test(type))) continue;   // a file, or data
    out.push({ line: clean.slice(0, m.index).split('\n').length, code: m[2], module: /^module$/i.test(type || '') });
  }
  return out;
}
/** What is wrong with them: a module, or newer syntax, by the same list as the classic files: ['the inline script at line N: ...', ...]. */
function inlineProblems(html) {
  var bad = [];
  inlineScripts(html).forEach(function (sc) {
    if (sc.module) bad.push('the inline script at line ' + sc.line + ': a module');
    newer(sc.code).forEach(function (b) { bad.push('the inline script at line ' + sc.line + ', its ' + b); });
  });
  return bad;
}
function added(list, base) { return list.filter(function (x) { return base.indexOf(x) < 0; }); }
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
check(NAMED.length >= 20 && out.length === 0, 'every src and href of index.html, every url() and @import of its stylesheet and every icon of manifest.json (' + NAMED.length + ') is in SHELL, but the ' +
  excepted.length + ' named exceptions (launch screens, screenshots)', out.join(', '));
// controls, each judged by what it adds to the real tree's own findings: a SHELL without
// motion.js and without the 512 px icon; a page that links a new file, with and without quotes;
// a stylesheet that names a font and imports another sheet
var cut = SHELL.filter(function (u) { return u !== './' + paths.script('motion.js') && u !== './icons/icon-512.png'; });
var c1 = added(notInShell(NAMED, cut, MAN), out);
check(c1.length === 2 && /motion\.js/.test(c1[0] + c1[1]) && /icon-512/.test(c1[0] + c1[1]), '... and that check finds a script and an icon left out of SHELL (control)', c1.join(', '));
var c2 = added(notInShell(named(HTML.replace('</body>', '<script src="./glass/new-piece.js" defer></script></body>'), MAN), SHELL, MAN), out);
check(c2.length === 1 && c2[0].indexOf('glass/new-piece.js') === 0, '... and a script tag whose file SHELL does not name (control)', c2.join(', '));
var c2b = added(notInShell(named(HTML.replace('</body>', '<script src=./control-only/extra.js defer></script><link rel=preload href=control-only/extra.png></body>'), MAN), SHELL, MAN), out);
var tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hourglass-shell-'));
fs.writeFileSync(path.join(tmp, 'index.html'), '<script src=./extra.js defer></script>\n<script type=module src=./m.mjs></script>\n<script src=\'./app.js\'></script>');
var c2c = paths.classicScripts(tmp);
fs.rmSync(tmp, { recursive: true, force: true });
check(c2b.length === 2 && /^control-only\/extra\.js /.test(c2b[0]) && /^control-only\/extra\.png /.test(c2b[1]) && c2c.join() === 'extra.js,app.js',
  '... and a src and an href without quotes, which lib/paths.js reads as scripts too (control)', c2b.join(', ') + '; ' + c2c.join(', '));
var CSS = read('styles.css');
var c2d = added(notInShell(named(HTML, MAN, function () {
  return CSS + '\n@font-face { src: url("./control-only/serif.woff2"), url(data:font/woff2;base64,AAAA); }\n@import \'./control-only/extra.css\';\n.a { background: url(control-only/paper.png) }\n/* url(./commented.png) */\n';
}), SHELL, MAN), out);
check(c2d.length === 3 && /^control-only\/serif\.woff2 \(styles\.css\)/.test(c2d[0]) && /^control-only\/extra\.css /.test(c2d[1]) && /^control-only\/paper\.png /.test(c2d[2]),
  '... and a url() and an @import of the stylesheet that SHELL does not name, but not a data: URL or one in a comment (control)', c2d.join(', '));
// every file the page, its stylesheet and the manifest name exists, the exceptions to SHELL included
function notThere(list) { return list.filter(function (n) { return absent([n.f]).length; }).map(function (n) { return n.f + ' (' + n.from + ')'; }); }
var gone = notThere(NAMED);
check(gone.length === 0, 'every file they name exists, the launch screens and the screenshots included', gone.join(', '));
var c2e = added(notThere(named(HTML.replace('</head>', '<link rel="apple-touch-startup-image" href="./icons/splash/splash-1x9999.png"></head>'), MAN)), gone);
check(c2e.length === 1 && /^icons\/splash\/splash-1x9999\.png/.test(c2e[0]) && EXCEPT[0].test('icons/splash/splash-1x9999.png', MAN),
  '... and that check finds a launch screen the page names that is not in the tree (control)', c2e.join(', '));
/* ---- 2. every SHELL path exists, once ---- */
var missing = absent(SHELL);
check(missing.length === 0, 'every path in SHELL is a file that exists (cache.addAll fails the install on one that is not)', missing.join(', '));
var c3 = absent(SHELL.concat(['./physics2.js', './icons']));
check(c3.length === 2, '... and that check finds a path that is not there and a folder (control)', c3.join(', '));
function twice(shell) { return shell.filter(function (u, i) { return shell.indexOf(u) !== i; }); }
var dup = twice(SHELL);
check(dup.length === 0, 'no path is in SHELL twice', dup.join(', '));
var c3b = added(twice(SHELL.concat([SHELL[SHELL.length - 1], './index.html'])), dup);
check(c3b.length === 2 && c3b[0] === SHELL[SHELL.length - 1] && c3b[1] === './index.html', '... and that check finds a path added a second time (control)', c3b.join(', '));

/* ---- 3. the classic scripts parse on an older WebKit ---- */
var NEWER = [
  { what: 'module syntax (import or export)', re: /(?<![.\w$])(?:import|export)\b(?!\s*[:(])/ },
  { what: 'import()', re: /(?<![.\w$])import\s*\(/ },
  { what: '=>', re: /=>/ },
  { what: 'let', re: /(?<![.\w$])let\b(?!\s*:)/ },
  { what: 'const', re: /(?<![.\w$])const\b(?!\s*:)/ },
  { what: 'class', re: /(?<![.\w$])class\b(?!\s*:)/ },
  { what: '?.', re: /\?\.(?!\d)/ },
  { what: '??', re: /\?\?/ },
  { what: 'an async function', re: /(?<![.\w$])async\s+function\b/ },
  { what: 'await', re: /(?<![.\w$])await\s+[\w$(\[]/ },
  { what: 'for-of', re: /(?<![.\w$])for\s*\(\s*(?:var\s+)?[\w$\[\]{},\s]+\sof\s/ },
  { what: '... (spread or rest)', re: /\.\.\./ },
  { what: '**', re: /\*\*/ },
  { what: 'a generator (function*)', re: /(?<![.\w$])function\s*\*/ },
  { what: 'a default parameter', re: /(?<![.\w$])function\b[^(]*\([^)]*=/ },
  { what: 'a destructured parameter', re: /(?<![.\w$])function\b[^(]*\([^)]*[\[{]/ },
  { what: 'var with a pattern', re: /(?<![.\w$])var\s*[\[{]/ },
  { what: 'catch without a binding', re: /(?<![.\w$])catch\s*\{/ },
  { what: 'a shorthand method', re: /^\s*(?:async\s+|\*\s*)?(?!(?:if|for|while|switch|catch|function|with)\b)[A-Za-z_$][\w$]*\s*\([^()]*\)\s*\{\s*$/ }
];
/** The newer syntax of these kinds in a classic script: ['line N: what', ...]. */
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
  check(bad.length === 0, f + ' is a classic script with none of the ' + (NEWER.length + 1) + ' kinds of newer syntax this check knows (from module syntax and => to shorthand methods: the list is at the top of this file)',
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
  'an async function': ['async function f() {}', 'var f = async function () {};'],
  'await': ['var r = await fetch(u);', 'await (p);'],
  'for-of': ['for (var x of list) {}', 'for (x of list) f(x);'],
  '... (spread or rest)': ['f(...args);', 'function g(a, ...rest) {}', 'var a = [...b];'],
  '**': ['var p = a ** 2;', 'a **= 2;'],
  'a generator (function*)': ['function* g() {}', 'var g = function *() {};'],
  'a default parameter': ['function f(a, b = 2) {}', 'var f = function (a = g()) {};'],
  'a destructured parameter': ['function f({ a, b }) {}', 'function f(x, [a, b]) {}'],
  'var with a pattern': ['var { a, b } = o;', 'var [a, b] = o;'],
  'catch without a binding': ['try { f(); } catch { g(); }'],
  'a shorthand method': ['  start(a, b) {', '  async stop() {'],
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
  'var d = a / b / c, e = (x) / 2;', 'if (/^import\\b/.test(s)) f();', 'return /const/.test(s);',
  'var o2 = { async: 1, await: 2, of: 3 }; var of = o2.of * 2, async = o2.async; f(async, of); o2.await(1);',
  'for (var k in o) {}', 'for (var i = 0, of = 2; i < of; i++) {}', 'function f(a, b) { a = 1; var q = [a, b], w = { a: a }; }',
  'try { f(); } catch (e) { g(); }', 'var m = a * b * c, s2 = "a ** b ... c";', '/** a doc comment ... */ var y2 = 1.5.toFixed(1);',
  '  if (a) {', '  while (f(a)) {', '  f(a, function (x) {', '  } else if (ok(a)) {', '  P.go = function (a, b) {', '  get size() { return 1; },',
  '  switch (a) {', '  for (;;) {', '  return function () {', '    go(a)) {'
].join('\n');
var flagged = newer(clean);
check(flagged.length === 0, '... and finds none where the words are only in strings, comments and regular expressions, a ternary, a division, a property or variable name, or in the ES5 forms beside them (control)', flagged.join('; '));
// and on a real file: a const added to a copy of motion.js, and a template string to app.js
var mot = read(paths.script('motion.js')), app = read('app.js');
var c4 = added(newer(mot + '\nconst EXTRA = 1;\n'), newer(mot)), c5 = added(newer(app.replace(/var REALSAND_BUILD = '([^']+)'/, 'var REALSAND_BUILD = `$1`')), newer(app));
check(c4.length === 1 && /const/.test(c4[0]) && c5.length === 1 && /template/.test(c5[0]), '... and in a copy of motion.js with a const and of app.js with a template string (control)', c4.concat(c5).join('; '));

// the page's inline script, by the same list
var inline = inlineScripts(HTML), inlineBad = inlineProblems(HTML);
check(inlineBad.length === 0, 'index.html\'s inline script' + (inline.length === 1 ? '' : 's') + ' (' + inline.length + ': a script tag with no src) ' + (inline.length === 1 ? 'is' : 'are') + ' read by the same check as the classic files: no module, none of the kinds of newer syntax', inlineBad.slice(0, 6).join('; '));
var c6 = inlineProblems(HTML.replace('</body>', '<!-- <script>const hidden = 1;</script> -->\n<script>const x = 1;</script>\n<script type="module">var y = 2;</script>\n<script type="application/json">{"const": 1}</script></body>'));
check(added(c6, inlineBad).length === 2 && /const/.test(c6.join(';')) && /a module/.test(c6.join(';')),
  '... and that check finds a const in a script tag with no src, and an inline module, but not a script in a comment or a tag that holds data (control)', c6.join('; '));

console.log('check-shell: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
