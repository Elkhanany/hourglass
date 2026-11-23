#!/usr/bin/env node
/*
 * The test guards themselves, in Node, in a moment (the check group: node tools/test/run-all.js
 * check-). The suites must test the app as it ships, and fail loudly when the layout changes
 * under them, instead of quietly testing less. So:
 *  - lib/paths.js reads the page's scripts from index.html: the classic ones, in document order
 *    (a module script, a commented-out tag and a query left out), the one named motion.js
 *    wherever it lives, and the parts of HourglassPhysics, which run as one program when joined;
 *  - there is no L.PHYSICS: a suite that still reads it (written for one physics.js) fails at
 *    once, with a message that says what to use;
 *  - the browser harness (stubs/harness.js) refuses a tree that lacks a script index.html loads,
 *    naming it, before it starts a server or a browser; and its one stand-in, the motion stub,
 *    is served at the path index.html gives motion.js, wherever that is.
 * (app-regression checks in the browser that the page gets every script as the tree has it.)
 * Each rule has its control: a tree or a suite that breaks it must fail.
 *
 *   node tools/test/check-harness.test.js
 */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), cp = require('child_process');
var paths = require('./lib/paths.js');
var H = require('./stubs/harness.js');
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hourglass-check-'));
/** A made-up tree: { 'index.html': text, 'a.js': text, ... } written under TMP/name. */
function tree(name, files) {
  var dir = path.join(TMP, name);
  Object.keys(files).forEach(function (f) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), files[f]);
  });
  return dir;
}
function page(tags) { return '<!doctype html><html><head><meta charset="utf-8"></head><body>\n' + tags.join('\n') + '\n</body></html>\n'; }

(async function () {
  try {
    /* ---- lib/paths.js ---- */
    var scripts = paths.classicScripts(), parts = paths.physicsParts();
    var missingHere = scripts.filter(function (f) { return !fs.existsSync(path.join(paths.ROOT, f)); });
    check(scripts.length >= 4 && scripts[scripts.length - 1] === 'app.js' && missingHere.length === 0 && parts.length >= 1 &&
          parts.every(function (f) { return scripts.indexOf(f) >= 0; }),
      'paths.js: index.html loads ' + scripts.join(', ') + '; HourglassPhysics is made by ' + parts.join(', '), missingHere.join(', '));
    var L = require('./lib/load-physics.js');
    check(L.physicsSource() === paths.physicsSource() && typeof L.P.Sim === 'function' && typeof L.P.Renderer === 'function' &&
          typeof L.loadIsolated(L.physicsSource()).Sim === 'function',
      'load-physics.js loads those parts (L.P has Sim and Renderer), and L.physicsSource() is their text, which runs in a vm as one program');

    // a page cut into pieces, as the planned glass/ and sand/ folders would be
    var piece = function (body) { return '(function (root) {\n  var P = root.HourglassPhysics || (root.HourglassPhysics = {});\n  ' + body + '\n})(typeof window !== "undefined" ? window : globalThis);\n'; };
    var cutDir = tree('cut', {
      'index.html': page([
        '<script src="./glass/shapes.js" defer></script>',
        '<!-- <script src="./old.js"></script> -->',
        '<script src="./sand/sim.js?v=2" defer></script>',
        '<script type="text/javascript" src="./sound/audio.js"></script>',
        '<script src="./motion/motion.js" defer></script>',
        '<script type="module" src="./realsand/boot.mjs"></script>',
        '<script src="./app.js" defer></script>']),
      'glass/shapes.js': piece('P.shape = 1;'),
      'sand/sim.js': piece('P.Sim = function () {}; P.Sim.shape = P.shape;'),
      'sound/audio.js': 'window.HourglassAudio = function () {}; var P = window.HourglassPhysics;\n',
      'motion/motion.js': 'window.HourglassMotion = function () {};\n',
      'app.js': 'var P = window.HourglassPhysics;\n'
    });
    var cs = paths.classicScripts(cutDir), pp = paths.physicsParts(cutDir), ctx = {};
    vm.createContext(ctx);
    vm.runInContext(paths.physicsSource(cutDir), ctx);
    check(cs.join() === 'glass/shapes.js,sand/sim.js,sound/audio.js,motion/motion.js,app.js' && pp.join() === 'glass/shapes.js,sand/sim.js' &&
          paths.script('motion.js', cutDir) === 'motion/motion.js' && ctx.HourglassPhysics && ctx.HourglassPhysics.Sim.shape === 1,
      '... on a page cut into pieces: the classic scripts in order (no module, no comment, no query), motion.js found in motion/, the two parts of HourglassPhysics joined into one program (control)',
      JSON.stringify({ classic: cs, parts: pp }));
    var threw = null;
    try { paths.script('motion.js', tree('nomotion', { 'index.html': page(['<script src="./app.js"></script>']), 'app.js': '' })); } catch (e) { threw = e.message; }
    check(threw && /no script named motion\.js/.test(threw), '... and asking for a script index.html does not load fails, naming it (control)', threw);

    /* ---- L.PHYSICS is gone ---- */
    var got = null;
    try { got = L.PHYSICS; } catch (e) { got = e; }
    check(got instanceof Error && /L\.PHYSICS is gone/.test(got.message) && /physicsSource/.test(got.message), 'L.PHYSICS throws, saying what to use instead', String(got && got.message));
    // a suite written for one physics.js (as an older branch's would be), run as the runner runs it
    var suite = path.join(TMP, 'old-style.test.js');
    fs.writeFileSync(suite, "'use strict';\nvar fs = require('fs');\nvar L = require(" + JSON.stringify(path.join(__dirname, 'lib', 'load-physics.js')) +
      ");\nvar SRC = fs.readFileSync(L.PHYSICS, 'utf8');\nconsole.log('read ' + SRC.length);\n");
    var r = cp.spawnSync(process.execPath, [suite], { encoding: 'utf8' });
    check(r.status !== 0 && /L\.PHYSICS is gone/.test(r.stderr) && !/^read /m.test(r.stdout), '... so a suite that reads it fails at once, by name (control)', 'exit ' + r.status + ': ' + (r.stderr.split('\n').filter(function (l) { return /Error: L\.PHYSICS/.test(l); })[0] || '').trim());

    /* ---- the browser harness ---- */
    check(H.treeProblems(paths.ROOT).length === 0, 'the harness finds this checkout whole (every script index.html loads is in it)', H.treeProblems(paths.ROOT).join('; '));
    var whole = {};
    scripts.forEach(function (f) { whole[f] = fs.readFileSync(path.join(paths.ROOT, f), 'utf8'); });
    whole['index.html'] = fs.readFileSync(paths.INDEX, 'utf8');
    var gone = paths.script('motion.js'), noMotion = Object.assign({}, whole);
    delete noMotion[gone];
    var dirA = tree('lacking', noMotion);
    var pA = H.treeProblems(dirA), startErr = null;
    try { await H.start({ root: dirA, port: 1 }); } catch (e) { startErr = e.message; }
    check(pA.length === 1 && pA[0].indexOf('index.html loads ' + gone + ', which is not in') === 0 && startErr && startErr.indexOf(gone) >= 0,
      '... and refuses a copy without ' + gone + ', naming it, before any server or browser starts (control)', startErr);
    var withPiece = Object.assign({}, whole);
    withPiece['index.html'] = whole['index.html'].replace(/(<script src="\.\/app\.js")/, '<script src="./glass/cracks.js" defer></script>\n$1');
    var pB = H.treeProblems(tree('newpiece', withPiece));
    check(pB.length === 1 && /glass\/cracks\.js/.test(pB[0]), '... and one whose index.html names a piece that is not there (control)', pB.join('; '));
    var si = H.standInPaths(paths.ROOT), siCut = H.standInPaths(cutDir), stub = path.join(__dirname, 'stubs', 'motion-stub.js');
    check(Object.keys(si).join() === '/' + gone && si['/' + gone] === stub && Object.keys(siCut).join() === '/motion/motion.js' && siCut['/motion/motion.js'] === stub,
      'the motion stub is served at motion.js\'s own path (/' + gone + '), and follows it when it moves (/motion/motion.js) (control)', JSON.stringify(Object.keys(siCut)));
  } catch (e) {
    check(false, 'no exception', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('check-harness: ' + (count - failures) + '/' + count + ' passed');
  if (failures) process.exitCode = 1;
})();
