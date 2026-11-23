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
 *    split, such as physics.js, must be renamed in the table in the same commit); names the
 *    table gives to Smoosh or EA (in a part of the cell that names them) are theirs, not ours.
 * How names are read: a name in backticks with a file's extension (or a folder's /). In the
 * first column a name with a / is under realsand/ unless it begins with lab/, and a bare name
 * is in the folder of the name before it in the cell (realsand/ at first). In the second
 * column a bare name is the app's (the repository's root) or else the lab's (lab/sand/).
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
var c3 = problems(MD, TREE, function (f) { return f !== 'physics.js' && exists(f); });
c3.sources = added(c3.sources, P.sources);
check(c3.sources.length >= 4 && c3.sources.every(function (s) { return /^physics\.js /.test(s); }),
  '... physics.js gone from the tree (split or moved) is found in each row that names it as a source (control)', c3.sources.join(', '));
var c4 = problems(MD, TREE, function (f) { return f !== 'lab/sand/main.mjs' && exists(f); });
check(c4.sources.some(function (s) { return /^main\.mjs /.test(s); }) && c4.missing.some(function (s) { return /lab\/sand\/main\.mjs/.test(s); }),
  '... a bare name in the second column is looked for in lab/sand/ too (the lab page\'s main.mjs) (control)', c4.sources.concat(c4.missing).join(', '));
var smoosh = P.rows.some(function (r) { return /src\/smoosh\.mjs/.test(r.cells[1]); }) && !P.rows.some(function (r) { return r.sources.indexOf('src/smoosh.mjs') >= 0; });
check(smoosh, '... and Smoosh\'s and EA\'s own files (src/smoosh.mjs, density.wgsl) are not looked for here');

console.log('check-licences: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
