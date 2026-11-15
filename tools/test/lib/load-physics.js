/*
 * Load physics.js for the Node tests (development only, not shipped).
 *
 *   var L = require('./lib/load-physics.js');
 *   L.P                     HourglassPhysics from this checkout (also on globalThis)
 *   L.loadIsolated(src)     another copy, from a source string, in its own vm context
 *   L.baseline([rev])       HourglassPhysics as it was at a git revision (f446085,
 *                           the last version before motion), for identity tests
 *
 * HOURGLASS_BASELINE=<file> makes baseline() read that file instead of git.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var childProcess = require('child_process');

var ROOT = path.resolve(__dirname, '..', '..', '..');
var PHYSICS = path.join(ROOT, 'physics.js');
var BASELINE_REV = 'f446085';

// physics.js is a plain script: in Node it exports onto globalThis.
require(PHYSICS);
var P = globalThis.HourglassPhysics;

/**
 * Run a physics.js source string in a fresh vm context and return its
 * HourglassPhysics. Nothing is shared with this process's copy: two
 * versions can run side by side from the same seed.
 */
function loadIsolated(src, filename) {
  var sandbox = { console: console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: filename || 'physics.js' });
  if (!sandbox.HourglassPhysics) throw new Error('loadIsolated: the source did not define HourglassPhysics');
  return sandbox.HourglassPhysics;
}

/** A file as it was at a git revision of this repository. */
function gitShow(rev, file) {
  return childProcess.execFileSync('git', ['show', rev + ':' + file], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
}

/** HourglassPhysics at `rev` (default f446085), isolated from the current one. */
function baseline(rev) {
  var file = process.env.HOURGLASS_BASELINE;
  rev = rev || BASELINE_REV;
  var src = file ? fs.readFileSync(file, 'utf8') : gitShow(rev, 'physics.js');
  return loadIsolated(src, (file || rev + ':physics.js'));
}

module.exports = {
  ROOT: ROOT,
  PHYSICS: PHYSICS,
  BASELINE_REV: BASELINE_REV,
  P: P,
  loadIsolated: loadIsolated,
  gitShow: gitShow,
  baseline: baseline
};
