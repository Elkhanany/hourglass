#!/usr/bin/env node
/*
 * The licence check, in Node, in a moment (the check group: node tools/test/run-all.js check-).
 *
 * realsand/LICENSES.md says, file by file, what the sand engine and the sand lab are derived
 * from and under which licence (Smoosh's MIT, EA's BSD-3-Clause, or this project's GPL). It
 * stays true only if every file is in it and every file it names is there. So:
 *  - every file under realsand/ and lab/sand/ is named in the table's first column (the
 *    LICENSES.md files themselves are the notices, not rows);
 *  - every file the first column names exists;
 *  - every file of this repository the second column names as a source exists (a file moved or
 *    split, as physics.js was, must be renamed in the table in the same commit); names the
 *    table gives to Smoosh or EA (in a part of the cell that names them) are theirs, not ours.
 * How names are read: a name in backticks with a file's extension (or a folder's /). In the
 * first column a name with a / is under realsand/ unless it begins with lab/, and a bare name
 * is in the folder of the name before it in the cell (realsand/ at first). In the second
 * column a bare name is the app's (the repository's root) or else the lab's (lab/sand/).
 * And the project's own licence is stated one way: GPL-3.0-or-later (package.json, the README).
 * A file of the page or the lab that states it (a header's "License: GPL-3.0...") says
 * GPL-3.0-or-later, not the bare GPL-3.0. The page's files are the root's and the scripts
 * index.html loads, wherever they live (app/settings.js). The engine's files (realsand/)
 * still say GPL-3.0: they change with the next engine build (docs/architecture.md,
 * "Releasing", rule 3), the README says what they mean until then, and this check counts them
 * without failing.
 * Each rule has its control: the same check on a table or a tree that breaks it must fail.
 *
 *   node tools/test/check-licences.test.js
 */
'use strict';
var fs = require('fs'), path = require('path');
var paths = require('./lib/paths.js');
var ROOT = paths.ROOT, TABLE = 'realsand/LICENSES.md', DIRS = ['realsand', 'lab/sand'];
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}

var FILE = /^[\w.\-/]+(?:\.(?:mjs|js|wgsl|css|html|md|json)|\/)$/;
function names(cell) {
  var out = [], m, re = /`([^`]+)`/g;
  while ((m = re.exec(cell))) if (FILE.test(m[1])) out.push(m[1]);
  return out;
}

/** The table's rows: [{ line, files: [repo paths], sources: [repo paths], cells }]. */
function rows(md) {
  var out = [];
  md.split('\n').forEach(function (l, k) {
    if (!/^\|/.test(l) || /^\|\s*-/.test(l) || /^\|\s*File\s*\|/.test(l)) return;
    var cells = l.split('|').slice(1, -1);
    if (cells.length < 3) return;
    var dir = 'realsand/', files = [];
    names(cells[0]).forEach(function (n) {
      var p = n.indexOf('/') < 0 ? dir + n : /^lab\//.test(n) ? n : 'realsand/' + n;
      dir = /\/$/.test(p) ? p : p.slice(0, p.lastIndexOf('/') + 1);
      files.push(p);
    });
    var sources = [];
    cells[1].split(';').forEach(function (part) {
      if (/\b(?:Smoosh|EA)\b/.test(part)) return;               // their files, not ours
      names(part).forEach(function (n) { sources.push(n); });
    });
    out.push({ line: k + 1, files: files, sources: sources, cells: cells });
  });
  return out;
}

/** What is wrong: { unnamed, missing, sources } given the table, the tree's files and exists(). */
function problems(md, tree, exists) {
  var rs = rows(md), namedSet = {};
  rs.forEach(function (r) { r.files.forEach(function (f) { namedSet[f] = r.line; }); });
  var unnamed = tree.filter(function (f) { return !namedSet[f] && path.posix.basename(f) !== 'LICENSES.md'; });
  var missing = [], sources = [];
  rs.forEach(function (r) {
    r.files.forEach(function (f) { if (!exists(f.replace(/\/$/, ''))) missing.push(f + ' (line ' + r.line + ')'); });
    r.sources.forEach(function (n) {
      var at = n.indexOf('/') >= 0 ? [n] : [n, 'lab/sand/' + n];
      if (!at.some(exists)) sources.push(n + ' (line ' + r.line + ')');
    });
  });
  return { rows: rs, unnamed: unnamed, missing: missing, sources: sources };
}

function walk(dir) {
  var out = [];
  fs.readdirSync(path.join(ROOT, dir)).forEach(function (f) {
    var p = dir + '/' + f;
    if (fs.statSync(path.join(ROOT, p)).isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  });
  return out;
}
function exists(f) { return fs.existsSync(path.join(ROOT, f)); }

var MD = fs.readFileSync(path.join(ROOT, TABLE), 'utf8');
var TREE = [].concat.apply([], DIRS.map(walk)).sort();
var P = problems(MD, TREE, exists);
var nNamed = P.rows.reduce(function (a, r) { return a + r.files.length; }, 0), nSrc = P.rows.reduce(function (a, r) { return a + r.sources.length; }, 0);
check(P.rows.length >= 15 && nNamed >= 30, TREE.length + ' files under ' + DIRS.join('/ and ') + '/; the table has ' + P.rows.length + ' rows naming ' + nNamed + ' files and ' + nSrc + ' sources of ours');
check(P.unnamed.length === 0, 'every file under realsand/ and lab/sand/ is named in ' + TABLE, P.unnamed.join(', '));
check(P.missing.length === 0, 'every file the table names exists', P.missing.join(', '));
check(P.sources.length === 0, 'every file of this repository the table names as a source exists', P.sources.join(', '));

// controls
// (each control is judged by what it adds to the real tree's own findings)
function added(list, base) { return list.filter(function (x) { return base.indexOf(x) < 0; }); }
var c1 = problems(MD, TREE.concat(['realsand/extra.mjs', 'lab/sand/extra.css', 'realsand/shaders/extra.wgsl']), exists);
c1.unnamed = added(c1.unnamed, P.unnamed);
check(c1.unnamed.length === 3, '... a new file under realsand/, realsand/shaders/ or lab/sand/ that the table does not name is found (control)', c1.unnamed.join(', '));
var c2 = problems(MD.replace('`rate.mjs`', '`rates.mjs`').replace('`lab.css`', '`lab2.css`'), TREE, exists);
c2.missing = added(c2.missing, P.missing); c2.unnamed = added(c2.unnamed, P.unnamed);
check(c2.missing.length === 2 && c2.unnamed.length === 2 && /rates\.mjs/.test(c2.missing.join()) && /lab\/sand\/lab2\.css/.test(c2.missing.join()),
  '... a name in the table with no file, and the file it should have named, are found (control)', c2.missing.concat(c2.unnamed).join(', '));
var GONE = 'sand/sim.js', nGone = P.rows.filter(function (r) { return r.sources.indexOf(GONE) >= 0; }).length;
var c3 = problems(MD, TREE, function (f) { return f !== GONE && exists(f); });
c3.sources = added(c3.sources, P.sources);
check(nGone >= 3 && c3.sources.length === nGone && c3.sources.every(function (s) { return s.indexOf(GONE + ' ') === 0; }),
  '... ' + GONE + ' gone from the tree (split or moved) is found in each of the ' + nGone + ' rows that name it as a source (control)', c3.sources.join(', '));
var c4 = problems(MD, TREE, function (f) { return f !== 'lab/sand/main.mjs' && exists(f); });
check(c4.sources.some(function (s) { return /^main\.mjs /.test(s); }) && c4.missing.some(function (s) { return /lab\/sand\/main\.mjs/.test(s); }),
  '... a bare name in the second column is looked for in lab/sand/ too (the lab page\'s main.mjs) (control)', c4.sources.concat(c4.missing).join(', '));
var smoosh = P.rows.some(function (r) { return /src\/smoosh\.mjs/.test(r.cells[1]); }) && !P.rows.some(function (r) { return r.sources.indexOf('src/smoosh.mjs') >= 0; });
check(smoosh, '... and Smoosh\'s and EA\'s own files (src/smoosh.mjs, density.wgsl) are not looked for here');

/* ---- the project's own licence, stated one way ---- */
var OURS = 'GPL-3.0-or-later';
/** The lines of a text that state the GPL-3.0 without "-or-later": ['line N: ...', ...]. */
function bare(text) {
  var out = [];
  text.split('\n').forEach(function (l, k) { if (/GPL-3\.0(?!-or-later)/.test(l)) out.push('line ' + (k + 1) + ': ' + l.trim().slice(0, 70)); });
  return out;
}
var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')), readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
/** The files of the page and the lab: the root's, the scripts index.html loads wherever they live (`scripts`), and lab/sand/. */
function ownFiles(scripts) {
  var list = fs.readdirSync(ROOT).filter(function (f) { return /\.(?:js|mjs|css|html|json)$/.test(f); }).concat(walk('lab/sand'));
  scripts.forEach(function (f) { if (list.indexOf(f) < 0) list.push(f); });
  return list.sort();
}
/** Which of these files state the licence, and the lines that state it bare: { stated, bare }. text(f) gives a file's text. */
function licenceIn(files, text) {
  var out = { stated: [], bare: [] };
  files.forEach(function (f) {
    var t = text(f);
    if (/GPL-3\.0/.test(t)) out.stated.push(f);
    bare(t).forEach(function (b) { out.bare.push(f + ' ' + b); });
  });
  return out;
}
function textOf(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var PAGE = paths.classicScripts(), OWN = ownFiles(PAGE), lic = licenceIn(OWN, textOf), stated = lic.stated, bareOnes = lic.bare;
var engineBare = walk('realsand').filter(function (f) { return bare(fs.readFileSync(path.join(ROOT, f), 'utf8')).length; });
check(pkg.license === OURS && /^## License\n+GPL-3\.0-or-later\./m.test(readme) && stated.length >= 10 && bareOnes.length === 0 &&
      (engineBare.length === 0 || /Where a file's header says GPL-3\.0, it\s+means this licence/.test(readme)),
  'the licence is ' + OURS + ' in package.json, the README and each of the ' + stated.length + ' files of the page and the lab that state it (' +
  engineBare.length + ' files under realsand/ say GPL-3.0 until the next engine build; the README says what that means)', bareOnes.join('; '));
var c5 = bare(' * Zero dependencies. License: GPL-3.0.\n * second line\n  Part of the Hourglass project (GPL-3.0); the solver\n'),
    c6 = bare(' * License: GPL-3.0-or-later.\n  (GPL-3.0-or-later); "license": "GPL-3.0-or-later"\n');
check(c5.length === 2 && /^line 1: /.test(c5[0]) && /^line 3: /.test(c5[1]) && c6.length === 0,
  '... and that check finds a header with the bare GPL-3.0, and none in one that says ' + OURS + ' (control)', c5.join('; '));
// a script the page loads from a folder of its own is one of its files
var inFolder = PAGE.filter(function (f) { return f.indexOf('/') >= 0; });
var c7 = licenceIn(ownFiles(PAGE.concat(['control-only/piece.js'])), function (f) { return f === 'control-only/piece.js' ? '/*\n * License: GPL-3.0.\n */\n' : textOf(f); });
check(PAGE.every(function (f) { return OWN.indexOf(f) >= 0; }) && added(c7.bare, bareOnes).length === 1 && /^control-only\/piece\.js line 2: /.test(added(c7.bare, bareOnes)[0]) &&
      inFolder.every(function (f) { return ownFiles([]).indexOf(f) < 0; }),            // (the root's files and the lab's alone would leave them unread)
  '... the scripts index.html loads are among those files wherever they live (' + (inFolder.join(', ') || 'none in a folder now') +
  '), and one in a folder whose header has the bare GPL-3.0 is found (control)', added(c7.bare, bareOnes).join('; '));

console.log('check-licences: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
