#!/usr/bin/env node
/*
 * Run every suite in tools/test, one after another, each on its own port,
 * and print a one-line summary per suite. The app itself needs nothing; the
 * tests need Node 22 and Playwright with Chromium (npm install, then
 * npx playwright install chromium).
 *
 *   node tools/test/run-all.js [filter]       e.g. "sim-" runs the physics only;
 *                                             "lab-" runs the lab pages' suites;
 *                                             "realsand-" the sand engine's (Node,
 *                                             seconds: realsand-valve)
 */
'use strict';
var fs = require('fs'), path = require('path'), cp = require('child_process');
var filter = process.argv[2] || '', port = 8810, failed = [], t0 = Date.now();
// lab-* suites test the separate lab pages, not the app; they run about an
// hour and record open problems as failing checks, so they run only when the
// filter names them ("lab")
var files = fs.readdirSync(__dirname).filter(function (f) {
  return /\.test\.js$/.test(f) && f.indexOf(filter) >= 0 &&
    (f.indexOf('lab-') !== 0 || filter.indexOf('lab') >= 0);
}).sort();
files.forEach(function (f) {
  var t = Date.now();
  port++;
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], {
    env: Object.assign({}, process.env, { PORT: String(port) }), encoding: 'utf8', maxBuffer: 64 << 20
  });
  var lines = ((r.stdout || '') + (r.stderr || '')).trim().split('\n'), ok = r.status === 0;
  if (!ok) failed.push(f);
  console.log((ok ? 'ok    ' : 'FAIL  ') + f.replace('.test.js', '').padEnd(20) +
    String(Math.round((Date.now() - t) / 1000)).padStart(4) + ' s   ' + lines[lines.length - 1].slice(0, 100));
  if (!ok) lines.filter(function (l) { return /FAIL/.test(l); }).slice(0, 5).forEach(function (l) { console.log('        ' + l.slice(0, 160)); });
});
console.log('\n' + (files.length - failed.length) + ' of ' + files.length + ' suites passed in ' +
  Math.round((Date.now() - t0) / 1000) + ' s' + (failed.length ? '; failed: ' + failed.join(', ') : ''));
process.exit(failed.length ? 1 : 0);
