/*
 * Load the classic sand and the glass (HourglassPhysics) for the Node tests
 * (development only, not shipped).
 *
 *   var L = require('./lib/load-physics.js');
 *   L.P                     HourglassPhysics from this checkout (also on globalThis)
 *   L.physicsSource()       its source: the scripts index.html loads for it, joined
 *                           (lib/paths.js; today physics.js alone)
 *   L.loadIsolated(src)     another copy, from a source string, in its own vm context
 *   L.baseline([rev])       HourglassPhysics as it was at a git revision (f446085,
 *                           the last version before motion), for identity tests
 *
 * HOURGLASS_BASELINE=<file> makes baseline() read that file instead of git.
 * There is no L.PHYSICS: reading it throws, so a test written for one
 * physics.js fails at once instead of reading a file that may not be there.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var childProcess = require('child_process');

var paths = require('./paths.js');

var ROOT = paths.ROOT;
var BASELINE_REV = 'f446085';

// The parts are plain scripts: in Node they export onto globalThis, in the page's order.
paths.physicsParts().forEach(function (f) { require(path.join(ROOT, f)); });
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

/*
 * HOURGLASS_PACE=p (1.414, 2, …) runs a suite on finer sand: every Sim it
 * builds is p times the scale it asked for, with Sim.setPace(p) in force.
 * The suite then states, in the same terms, what the finer sand must still
 * do. (What a suite counts in cells or in grains comes out p or p² larger.)
 */
var FINE = +(process.env.HOURGLASS_PACE || 1);
if (FINE > 1 && P.Sim.setPace) {
  P.Sim.setPace(FINE);
  var Sim0 = P.Sim;
  var Fine = function (o) {
    var q = {}, k;
    for (k in o) q[k] = o[k];
    q.scale = (q.scale || 1) * FINE;
    return new Sim0(q);
  };
  Fine.prototype = Sim0.prototype;
  for (var key in Sim0) Fine[key] = Sim0[key];
  P.Sim = Fine;
}

/*
 * HOURGLASS_SHAPE=id (an id of P.SHAPES) runs a suite on another glass:
 * every Sim it builds has that shape, unless the suite asks for one itself.
 * Unset, nothing changes. (Many suites state what the classic teardrop
 * does; on another shape they say how far that glass is from it.)
 */
var SHAPE = process.env.HOURGLASS_SHAPE || '';
if (SHAPE) {
  if (!P.SHAPES || !Object.prototype.hasOwnProperty.call(P.SHAPES, SHAPE)) {
    throw new Error('HOURGLASS_SHAPE: there is no glass shape "' + SHAPE + '"');
  }
  var Sim1 = P.Sim;
  var Shaped = function (o) {
    var q = {}, k;
    for (k in o) q[k] = o[k];
    if (q.shape === undefined) q.shape = SHAPE;
    return new Sim1(q);
  };
  Shaped.prototype = Sim1.prototype;
  for (var key1 in Sim1) Shaped[key1] = Sim1[key1];
  P.Sim = Shaped;
}

module.exports = {
  ROOT: ROOT,
  BASELINE_REV: BASELINE_REV,
  P: P,
  physicsSource: function () { return paths.physicsSource(); },
  loadIsolated: loadIsolated,
  gitShow: gitShow,
  baseline: baseline
};
Object.defineProperty(module.exports, 'PHYSICS', {
  enumerable: false,
  get: function () {
    throw new Error('L.PHYSICS is gone: the page may load HourglassPhysics from several files. ' +
                    'Use L.physicsSource() for its text, or lib/paths.js for a file.');
  }
});
