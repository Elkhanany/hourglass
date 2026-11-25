#!/usr/bin/env node
/*
 * The physics.js split: cuts the one classic file that made HourglassPhysics into the seven pieces
 * the page loads today. A tool run by hand, not part of the app, of package.json or of the test run.
 * It is kept for a branch that still edits physics.js (docs/testing.md has the recipe).
 *
 *   npm install --prefix <tmp> acorn@8.18.0
 *   ACORN=<tmp>/node_modules/acorn node tools/split-physics.js <physics.js> <outRoot>
 *
 * Cuts physics.js at its own banners (found by title) into seven classic pieces that each add to
 * one HourglassPhysics namespace, in this load order:
 *
 *   glass/shapes.js   Vessel geometry               sand/sim.js       Constants, Simulation
 *   sand/sands.js     Themes, Sands                 glass/gl.js       Glass — rendered, not drawn
 *   glass/renderer.js Renderer                      glass/cracks.js   Cracks on the glass
 *   glass/spill.js    Spill
 *
 * No piece's imports or exports are written by hand. They come from an exact scope walk of
 * physics.js (acorn, ES5):
 *   - every identifier that resolves to a top-level name of physics.js is a use, in the piece whose
 *     lines it is on; a use of a name another piece declares is an import of that piece;
 *   - a piece exports what another piece imports, and the names physics.js's own Exports block lists
 *     (those on P, the app's API; the others on P._, shared between pieces only);
 *   - it stops, and writes nothing, if a piece would read a name from a piece loaded after it, if a
 *     name is assigned in another piece than the one that declares it, or if the Exports block lists
 *     something other than `name: name`.
 * Each piece but the first runs only if the piece before it ran (`_.loaded`), so a piece missing
 * from an installed copy leaves HourglassPhysics without Spill at least, and app.js's pre-flight
 * check says the app is updating, as it did when physics.js was missing.
 * physics.js's header paragraphs for the Sim, the Renderer and the Spill are carried into
 * sand/sim.js, glass/renderer.js and glass/spill.js, verbatim.
 *
 * Then it checks what it wrote, read back from disk: each region is in its piece verbatim, and the
 * regions are physics.js's lines from the Constants banner to the line before Exports; loaded in
 * order, the pieces give the namespace physics.js gives (the same public names, of the same kinds);
 * a Sim stepped 400 times has the same lattice. It exits 1 if any of these fails.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
if (!process.env.ACORN) { console.error('set ACORN to the acorn package (npm install --prefix <tmp> acorn@8.18.0)'); process.exit(2); }
var acorn = require(process.env.ACORN);

var srcFile = process.argv[2], out = process.argv[3];
if (!srcFile || !out) { console.error('usage: ACORN=<acorn> node tools/split-physics.js <physics.js> <outRoot>'); process.exit(2); }
var src = fs.readFileSync(srcFile, 'utf8');
var L = src.split('\n');

var TITLES = ['Constants', 'Vessel geometry', 'Simulation', 'Themes', 'Sands', 'Glass — rendered, not drawn',
  'Renderer', 'Cracks on the glass', 'Spill', 'Exports'];
var at = {};                                   // title -> 0-based index of its "/* ====" line
for (var i = 0; i < L.length - 1; i++) {
  if (/^  \/\* =+$/.test(L[i])) {
    var t = L[i + 1].replace(/^\s*\*\s*/, '');
    TITLES.forEach(function (T) { if (t.indexOf(T) === 0 && at[T] === undefined) at[T] = i; });
  }
}
TITLES.forEach(function (T) { if (at[T] === undefined) throw new Error('banner not found: ' + T); });
for (var k = 1; k < TITLES.length; k++) if (at[TITLES[k]] <= at[TITLES[k - 1]]) throw new Error('banners out of order at ' + TITLES[k]);
function region(T) { var n = TITLES.indexOf(T); return L.slice(at[T], at[TITLES[n + 1]]).join('\n'); }

// the header's numbered paragraphs: " * 1. HourglassPhysics.Sim ..." up to the next number
function headerItem(n) {
  var a = -1, b = -1;
  for (var j = 0; j < 40 && j < L.length; j++) {
    if (a < 0 && L[j].indexOf(' * ' + n + '. ') === 0) a = j;
    else if (a >= 0 && (/^ \* \d+\. /.test(L[j]) || /^ \*\s*$/.test(L[j]) || /^ \* -{5,}/.test(L[j]))) { b = j; break; }
  }
  if (a < 0 || b < 0) throw new Error('header paragraph ' + n + ' not found');
  return L.slice(a, b).join('\n');
}
// the header's licence line, carried into every piece
var LICENCE = (/^ \* Zero dependencies\. License: [^\n]*$/m.exec(L.slice(0, 40).join('\n')) || [])[0];
if (!LICENCE) throw new Error('the header\'s licence line was not found');

var PIECES = [
  { file: 'glass/shapes.js', what: 'The glass: its geometry and the shapes it can take.', regions: ['Vessel geometry'] },
  { file: 'sand/sim.js', what: 'The classic sand: the CPU simulation of every grain.', regions: ['Constants', 'Simulation'], item: 1 },
  { file: 'sand/sands.js', what: 'The sands: the themes, the sands and their finishes, and the colour helpers.', regions: ['Themes', 'Sands'] },
  { file: 'glass/gl.js', what: 'The glass drawn by WebGL.', regions: ['Glass — rendered, not drawn'] },
  { file: 'glass/renderer.js', what: 'The picture: the glass, the classic sand, the frame.', regions: ['Renderer'], item: 2 },
  { file: 'glass/cracks.js', what: 'Cracks on the glass, its mends and their glints (Renderer and Sim methods).', regions: ['Cracks on the glass'] },
  { file: 'glass/spill.js', what: 'Sand that has left the glass.', regions: ['Spill'], item: 3 }
];
var ORDER = PIECES.map(function (p) { return p.file; });
function pieceOfLine(line1) {              // 1-based line -> piece index, -1 outside the regions, -2 the Exports block
  var r = null;
  TITLES.forEach(function (T) { if (line1 - 1 >= at[T]) r = T; });
  if (r === null) return -1;
  if (r === 'Exports') return -2;
  for (var p = 0; p < PIECES.length; p++) if (PIECES[p].regions.indexOf(r) >= 0) return p;
  return -1;
}

/* ---- the scope walk (ES5: var and function scopes, catch parameters) ---- */
var ast = acorn.parse(src, { ecmaVersion: 5, locations: true });
var iife = ast.body[0] && ast.body[0].expression && ast.body[0].expression.callee;
if (!iife || iife.type !== 'FunctionExpression') throw new Error('physics.js is not one IIFE');
var body = iife.body.body;
var decl = {};                              // top-level name -> piece index
body.forEach(function (s) {
  function add(name, line) {
    var p = pieceOfLine(line);
    if (p < 0) throw new Error('top-level ' + name + ' declared outside the regions (line ' + line + ')');
    if (decl[name] !== undefined && decl[name] !== p) throw new Error(name + ' declared in two pieces');
    decl[name] = p;
  }
  if (s.type === 'FunctionDeclaration') add(s.id.name, s.loc.start.line);
  if (s.type === 'VariableDeclaration') s.declarations.forEach(function (d) { add(d.id.name, d.loc.start.line); });
});
function hoist(fnBody, set) {
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclaration') n.declarations.forEach(function (d) { set[d.id.name] = 1; });
    if (n.type === 'FunctionDeclaration') { set[n.id.name] = 1; return; }
    if (n.type === 'FunctionExpression') return;
    for (var key in n) {
      if (key === 'loc') continue;
      var v = n[key];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v);
    }
  })(fnBody);
}
var uses = PIECES.map(function () { return {}; });   // piece -> { name: first line }
var problems = [];
function resolve(id, scopes) {
  for (var s = scopes.length - 1; s >= 0; s--) if (scopes[s][id.name]) return false;
  return decl[id.name] !== undefined;
}
function use(id, scopes, write) {
  if (!resolve(id, scopes)) return;
  var p = pieceOfLine(id.loc.start.line);
  if (p === -2) return;                                         // the Exports block
  if (p < 0) { problems.push(id.name + ' used outside the regions, line ' + id.loc.start.line); return; }
  if (decl[id.name] === p) return;
  if (write) problems.push(id.name + ' (declared in ' + ORDER[decl[id.name]] + ') is assigned in ' + ORDER[p] + ', line ' + id.loc.start.line);
  if (!(id.name in uses[p])) uses[p][id.name] = id.loc.start.line;
}
function visit(n, scopes) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') {
    var s = { arguments: 1 };
    n.params.forEach(function (q) { s[q.name] = 1; });
    if (n.type === 'FunctionExpression' && n.id) s[n.id.name] = 1;
    hoist(n.body, s);
    n.body.body.forEach(function (st) { visit(st, scopes.concat([s])); });
    return;
  }
  if (n.type === 'CatchClause') { var c = {}; c[n.param.name] = 1; visit(n.body, scopes.concat([c])); return; }
  if (n.type === 'MemberExpression') { visit(n.object, scopes); if (n.computed) visit(n.property, scopes); return; }
  if (n.type === 'Property') { if (n.computed) visit(n.key, scopes); visit(n.value, scopes); return; }
  if (n.type === 'LabeledStatement') { visit(n.body, scopes); return; }
  if (n.type === 'BreakStatement' || n.type === 'ContinueStatement') return;
  if (n.type === 'Identifier') { use(n, scopes, false); return; }
  if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') { use(n.left, scopes, true); visit(n.right, scopes); return; }
  if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier') { use(n.argument, scopes, true); return; }
  if (n.type === 'VariableDeclarator') { visit(n.init, scopes); return; }
  for (var key in n) {
    if (key === 'loc') continue;
    var v = n[key];
    if (Array.isArray(v)) v.forEach(function (x) { visit(x, scopes); }); else if (v && typeof v.type === 'string') visit(v, scopes);
  }
}
// the IIFE's own scope: its parameter; the top-level names are resolved through decl
body.forEach(function (st) { visit(st, [{ root: 1, arguments: 1 }]); });

/* ---- the public API: physics.js's Exports block, as written there ---- */
var PUBLIC = [];
body.forEach(function (s) {
  if (s.type !== 'ExpressionStatement' || s.expression.type !== 'AssignmentExpression') return;
  var l = s.expression.left;
  if (l.type === 'MemberExpression' && l.object.name === 'root' && l.property.name === 'HourglassPhysics') {
    s.expression.right.properties.forEach(function (pr) {
      var key = pr.key.name || pr.key.value;
      if (pr.value.type !== 'Identifier' || pr.value.name !== key || decl[key] === undefined) problems.push('Exports: ' + key + ' is not a top-level name of its own');
      else PUBLIC.push(key);
    });
  }
});
if (!PUBLIC.length) problems.push('the Exports block (root.HourglassPhysics = { ... }) was not found');

/* ---- imports and exports of each piece ---- */
var exportsOf = PIECES.map(function () { return []; });
PIECES.forEach(function (p, pi) {
  Object.keys(uses[pi]).forEach(function (name) {
    var d = decl[name];
    if (d > pi) problems.push(p.file + ' reads ' + name + ' (line ' + uses[pi][name] + ') from ' + ORDER[d] + ', which loads after it');
    if (exportsOf[d].indexOf(name) < 0) exportsOf[d].push(name);
  });
});
PUBLIC.forEach(function (name) { if (exportsOf[decl[name]].indexOf(name) < 0) exportsOf[decl[name]].push(name); });
if (problems.length) { console.error('NOT SPLIT:\n  ' + problems.join('\n  ')); process.exit(1); }

function byDecl(a, b) { return src.indexOf(' ' + a + ' ') - src.indexOf(' ' + b + ' '); }   // stable: roughly as declared
function ns(name) { return PUBLIC.indexOf(name) >= 0 ? 'P' : '_'; }
function wrapList(prefix, items, sep, end, cont) {
  var lines = [], cur = prefix;
  items.forEach(function (it, j) {
    var piece = it + (j < items.length - 1 ? sep : end);
    if (cur.length + piece.length > 104 && cur !== prefix) { lines.push(cur.replace(/\s+$/, '')); cur = cont; }
    cur += piece;
  });
  lines.push(cur);
  return lines.join('\n');
}
var OPEN = ["(function (root) {", "  'use strict';",
  "  var P = root.HourglassPhysics || (root.HourglassPhysics = {});",
  "  var _ = P._ || (P._ = {});        // names the pieces share that are not the app's"].join('\n');
var CLOSE = "})(typeof window !== 'undefined' ? window : globalThis);\n";
// The chain: each piece but the first runs only if the piece loaded just before it ran (_.loaded names
// it), and each says it ran. So when a piece is missing from an installed copy, none after it defines
// anything, HourglassPhysics lacks Spill at least, and app.js's pre-flight check says the app is
// updating, as it did when physics.js itself was missing, instead of failing halfway.
function guard(pi) {
  return pi ? "  if (_.loaded !== '" + ORDER[pi - 1] + "') return;   // a piece before this one is missing: define nothing (app.js says it is updating)\n" : '';
}
function head(p) {
  var h = ['/*!', ' * Hourglass — ' + p.file, ' * ' + p.what];
  if (p.item) h.push(' *', headerItem(p.item));
  h.push(' *', ' * One piece of HourglassPhysics, loaded in this order: ' + ORDER.slice(0, 4).join(', ') + ',',
    ' * ' + ORDER.slice(4).join(', ') + '. Each reads what it needs from the namespace once,',
    ' * at load (cut from physics.js by tools/split-physics.js).', LICENCE, ' */');
  return h.join('\n') + '\n';
}
PIECES.forEach(function (p, pi) {
  var imp = Object.keys(uses[pi]).sort(byDecl).map(function (n) { return n + ' = ' + ns(n) + '.' + n; });
  var exp = exportsOf[pi].sort(byDecl).map(function (n) { return ns(n) + '.' + n + ' = ' + n + ';'; });
  var bodyText = p.regions.map(region).join('\n');
  var text = head(p) + OPEN + '\n' + guard(pi) + (imp.length ? wrapList('  var ', imp, ', ', ';', '      ') + '\n' : '') + '\n' +
    bodyText + '\n\n' + (exp.length ? wrapList('  ', exp, ' ', '', '  ') + '\n' : '') +
    "  _.loaded = '" + p.file + "';\n" + CLOSE;
  var f = path.join(out, p.file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  console.log(p.file + ': ' + text.split('\n').length + ' lines; imports ' + (imp.length ? Object.keys(uses[pi]).sort(byDecl).join(' ') : '-') +
    '; exports ' + (exportsOf[pi].length ? exportsOf[pi].join(' ') : '-'));
});

/* ---- checks, read back from disk ---- */
var texts = PIECES.map(function (p) { return fs.readFileSync(path.join(out, p.file), 'utf8'); });
// 1. each region is in its piece verbatim, and the regions are physics.js's lines from Constants to the line before Exports
var total = 0, verbatim = true;
PIECES.forEach(function (p, pi) {
  p.regions.forEach(function (T) { if (texts[pi].indexOf(region(T)) < 0) verbatim = false; total += region(T).split('\n').length; });
});
var span = at['Exports'] - at['Constants'];
console.log('each region verbatim in its piece: ' + verbatim + '; region lines ' + total + ' = physics.js lines ' +
  (at['Constants'] + 1) + '-' + at['Exports'] + ' (' + span + '): ' + (total === span));
// 2. loaded in order, the pieces give the namespace physics.js gives (the same names, the same kinds), and a
//    Sim steps exactly as physics.js's does (a quick lattice check; sim-identity is the real one)
function load(list, names) {
  var c = vm.createContext({});
  list.forEach(function (text, j) { vm.runInContext(text, c, { filename: names[j] }); });
  return c.HourglassPhysics;
}
var A = load([src], ['physics.js']), B = load(texts, ORDER);
var ka = Object.keys(A).sort(), kb = Object.keys(B).filter(function (x) { return x !== '_'; }).sort();
var same = ka.join() === kb.join() && ka.every(function (x) { return typeof A[x] === typeof B[x]; });
function lattice(Pn) {
  var s = new Pn.Sim({ scale: 0.6, seed: 5 }), h = 2166136261, j, n;
  for (n = 0; n < 400; n++) s.step();
  for (j = 0; j < s.cell.length; j++) h = Math.imul(h ^ s.cell[j], 16777619);
  return (h >>> 0).toString(16) + ' top ' + s.nTop + ' total ' + s.total;
}
var la = lattice(A), lb = lattice(B);
console.log('namespace: ' + ka.length + ' public names, the same and of the same kinds: ' + same + '; 400 steps: ' + la + ' / ' + lb + ': ' + (la === lb));
if (!verbatim || total !== span || !same || la !== lb) process.exit(1);
