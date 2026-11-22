#!/usr/bin/env node
/*
 * Real sand and the service worker's shell (design 2.2-2.3, 13.1), in Node, in a moment.
 *
 * The worker installs every file of its SHELL with cache.addAll, which fails the whole install
 * if one of them is missing, and the app works offline only with what the shell holds. With
 * Real sand on, the app loads realsand/boot.mjs, the modules it imports and the shaders the
 * solver and the grains fetch. So:
 *  - every path in sw.js's SHELL exists;
 *  - every module the engine loads (the static imports from realsand/boot.mjs, followed) is in
 *    the shell, and so is every shader in realsand/shaders/ (the solver's pipelines, its
 *    includes and the grains', each named by the code checked here too), and LICENSES.md;
 *  - the stamp app.js was written for (REALSAND_BUILD) and the one the lab page expects
 *    (BUILD_EXPECTED) equal the engine's own (realsand/build.mjs), so a release never ships a
 *    mix that the app itself would refuse;
 *  - app.js loads the engine through boot.mjs and has no module syntax of its own (an old
 *    parser would reject the whole classic script).
 *
 *   node tools/test/realsand-shell.test.js
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

// the worker's own globals, read by running it with a stand-in for its scope
var ctx = { self: { addEventListener: function () {}, location: { origin: 'http://x' } }, URL: URL };
vm.runInNewContext(read('sw.js'), ctx);
var SHELL = ctx.SHELL, VERSION = ctx.VERSION;
check(Array.isArray(SHELL) && SHELL.length > 10, 'sw.js has its SHELL', SHELL && SHELL.length + ' paths');
check(/^hourglass-v\d+\.\d+\.\d+$/.test(VERSION), 'sw.js VERSION names a release', VERSION);

// 1. every path exists
function absent(list) {
  return list.filter(function (u) {
    var p = path.join(ROOT, u.replace(/^\.\//, ''));
    if (u === './') return !fs.existsSync(path.join(ROOT, 'index.html'));
    return !fs.existsSync(p) || fs.statSync(p).isDirectory();
  });
}
var missing = absent(SHELL);
check(missing.length === 0, 'every path in SHELL exists (cache.addAll fails the install on one that does not)', missing.join(', '));
// (the control: a shell with a module and a shader that are not there, and a folder, is caught on all three)
var control = absent(SHELL.concat(['./realsand/not-there.mjs', './realsand/shaders/not-there.wgsl', './realsand/shaders']));
check(control.length === 3, '... and that check finds paths that are not files (control)', control.join(', '));
var dup = SHELL.filter(function (u, i) { return SHELL.indexOf(u) !== i; });
check(dup.length === 0, 'no path is in SHELL twice', dup.join(', '));
var inShell = {};
SHELL.forEach(function (u) { inShell[u.replace(/^\.\//, '')] = true; });

// 2. the modules the engine loads: realsand/boot.mjs and its static imports, followed
var seen = {}, queue = ['realsand/boot.mjs'];
while (queue.length) {
  var f = queue.shift();
  if (seen[f]) continue;
  seen[f] = true;
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  var src = read(f), re = /(?:^|\n)\s*(?:import|export)\b[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g, m;
  while ((m = re.exec(src))) {
    var spec = m[1] || m[2];
    if (spec[0] !== '.') continue;
    queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), spec)));
  }
}
var mods = Object.keys(seen).sort();
var modsOut = mods.filter(function (f) { return !inShell[f]; });
check(mods.length >= 13 && modsOut.length === 0, 'every module the app loads for Real sand is in SHELL (' + mods.length + ', from realsand/boot.mjs)', modsOut.join(', '));
var stray = Object.keys(inShell).filter(function (f) { return /^realsand\/[^/]+\.mjs$/.test(f) && !seen[f]; });
check(stray.length === 0, 'and SHELL holds no engine module the app does not load', stray.join(', '));

// 3. the shaders: every file in realsand/shaders/, each pipeline the solver builds and the
//    grains' shader, and every include they name
var shaderDir = path.join(ROOT, 'realsand', 'shaders');
var wgsl = fs.readdirSync(shaderDir).filter(function (f) { return /\.wgsl$/.test(f); }).sort();
var wgslOut = wgsl.filter(function (f) { return !inShell['realsand/shaders/' + f]; });
check(wgsl.length >= 16 && wgslOut.length === 0, 'every shader in realsand/shaders/ is in SHELL (' + wgsl.length + ')', wgslOut.join(', '));
var named = [], sol = read('realsand/solver.mjs'), lay = /const LAYOUTS = \{([\s\S]*?)\};/.exec(sol);
if (lay) lay[1].replace(/(\w+)\s*:/g, function (_, n) { named.push(n); });
mods.forEach(function (f) {
  if (!fs.existsSync(path.join(ROOT, f))) return;
  read(f).replace(/\.module\([^,]+,\s*'(\w+)'\)/g, function (_, n) { named.push(n); });
});
wgsl.forEach(function (f) {
  fs.readFileSync(path.join(shaderDir, f), 'utf8').replace(/\/\/!include\s+([\w.]+)/g, function (_, n) { named.push(n); });
});
var namedOut = named.filter(function (n, i) { return named.indexOf(n) === i && !inShell['realsand/shaders/' + n + '.wgsl']; });
check(named.length >= 15 && namedOut.length === 0, 'every shader the engine names (' + named.length + ': pipelines, the grains, includes) is in SHELL', namedOut.join(', '));
check(!!inShell['realsand/LICENSES.md'], 'the engine\'s licences (realsand/LICENSES.md) go with it');

// 4. one build stamp
var BUILD = (/export const BUILD = '([^']+)'/.exec(read('realsand/build.mjs')) || [])[1];
var APP = (/var REALSAND_BUILD = '([^']+)'/.exec(read('app.js')) || [])[1];
var LAB = (/const BUILD_EXPECTED = '([^']+)'/.exec(read('lab/sand/main.mjs')) || [])[1];
check(!!BUILD && APP === BUILD, 'app.js was written for the engine\'s build (REALSAND_BUILD ' + APP + ', realsand/build.mjs ' + BUILD + ')');
check(LAB === BUILD, 'the lab page expects the engine\'s build too (BUILD_EXPECTED ' + LAB + ')');

// 5. app.js: a classic script that loads the engine as a module script, never by import()
var app = read('app.js');
check(app.indexOf("'./realsand/boot.mjs'") >= 0, 'app.js loads the engine through ./realsand/boot.mjs');
check(!/\bimport\s*\(/.test(app) && !/^\s*(import|export)\s/m.test(app), 'app.js has no import() and no module syntax');
check(/H\.attachRealSand\(RealSand, BUILD\)/.test(read('realsand/boot.mjs')), 'boot.mjs hands app.js the class and the stamp (attachRealSand)');

console.log('realsand-shell: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
