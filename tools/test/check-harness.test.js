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
 * And the runs that are meant to run something must:
 *  - the runner (run-all.js) fails when its filter matches no suite, so a mistyped filter or a
 *    renamed file is not a green run of nothing;
 *  - GitHub's workflow (.github/workflows/checks.yml) runs the check group and then a list of
 *    Node suites by name. Every suite that needs no browser (none of the files it requires asks
 *    for Playwright) is either in that list or in LEFT_OUT below, with its reason, and every name
 *    in the two lists is such a suite: a new suite cannot be left out by forgetting it.
 * And the steps for a new setting (docs/engines.md, "The row count") name every suite that
 * counts Tune's rows (`.rows === N`), so one who adds a row changes them all.
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
/**
 * The Node suites GitHub does not run, by name, with the reason. They run by hand with the
 * browser suites (docs/testing.md). A suite that needs no browser and is not here must be in
 * the workflow's SUITES.
 */
var LEFT_OUT_WHY = {
  'replay-phone': '1.5 to 2 minutes', 'sim-conservation': '1.5 to 2 minutes', 'sim-fracture': '1.5 to 2 minutes', 'sim-shape': '1.5 to 2 minutes',
  'sim-grain': '25 to 40 s', 'sim-repose': '25 to 40 s', 'sim-tone': '25 to 40 s',
  'sim-perf': 'timings, which a shared machine cannot judge'
};
var LEFT_OUT = Object.keys(LEFT_OUT_WHY);
/** Does this file, or a file of this folder it requires (however deep), ask for Playwright? */
function loadsBrowser(file, seen) {
  seen = seen || {};
  if (seen[file]) return false;
  seen[file] = true;
  var src = fs.readFileSync(file, 'utf8'), m, re = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = re.exec(src))) {
    if (m[1] === 'playwright' || /^playwright[-/]/.test(m[1])) return true;
    if (m[1][0] !== '.') continue;
    var dep = path.resolve(path.dirname(file), m[1]);
    if (!/\.js$/.test(dep)) dep += '.js';
    if (fs.existsSync(dep) && loadsBrowser(dep, seen)) return true;       // (a path in a comment's example may not be a file)
  }
  return false;
}
/** The names in the workflow's SUITES (a folded YAML scalar: the indented lines after "SUITES: >-"). */
function workflowSuites(yml) {
  var lines = yml.split('\n'), at = -1, out = [];
  lines.forEach(function (l, k) { if (/^\s*SUITES:\s*>-\s*$/.test(l)) at = k; });
  if (at < 0) return out;
  var indent = /^\s*/.exec(lines[at])[0].length;
  for (var k = at + 1; k < lines.length && (/^\s*$/.test(lines[k]) || /^\s*/.exec(lines[k])[0].length > indent); k++) {
    lines[k].trim().split(/\s+/).filter(Boolean).forEach(function (n) { out.push(n); });
  }
  return out;
}
/** kinds: { suite name: 'node' | 'browser' } for every *.test.js; listed: the workflow's; left: LEFT_OUT. */
function workflowProblems(kinds, listed, left) {
  var out = [];
  Object.keys(kinds).sort().forEach(function (n) {
    if (kinds[n] !== 'node' || /^check-/.test(n)) return;                 // the check group is the workflow's first step
    if (listed.indexOf(n) < 0 && left.indexOf(n) < 0) out.push(n + ' needs no browser but is neither in the workflow\'s SUITES nor in LEFT_OUT');
    if (listed.indexOf(n) >= 0 && left.indexOf(n) >= 0) out.push(n + ' is in both lists');
  });
  listed.concat(left).forEach(function (n, k) {
    var where = k < listed.length ? 'the workflow\'s SUITES' : 'LEFT_OUT';
    if (!kinds[n]) out.push(n + ' (' + where + '): no such suite');
    else if (kinds[n] !== 'node') out.push(n + ' (' + where + ') needs a browser, which GitHub\'s run has not');
    else if (/^check-/.test(n)) out.push(n + ' (' + where + ') is in the check group already');
  });
  listed.forEach(function (n, k) { if (listed.indexOf(n) !== k) out.push(n + ' is in the workflow\'s SUITES twice'); });
  return out;
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
    withPiece['index.html'] = whole['index.html'].replace(/(<script src="\.\/app\.js")/, '<script src="./glass/frames.js" defer></script>\n$1');
    var pB = H.treeProblems(tree('newpiece', withPiece));
    check(pB.length === 1 && /glass\/frames\.js/.test(pB[0]), '... and one whose index.html names a piece that is not there (control)', pB.join('; '));
    var si = H.standInPaths(paths.ROOT), siCut = H.standInPaths(cutDir), stub = path.join(__dirname, 'stubs', 'motion-stub.js');
    check(Object.keys(si).join() === '/' + gone && si['/' + gone] === stub && Object.keys(siCut).join() === '/motion/motion.js' && siCut['/motion/motion.js'] === stub,
      'the motion stub is served at motion.js\'s own path (/' + gone + '), and follows it when it moves (/motion/motion.js) (control)', JSON.stringify(Object.keys(siCut)));

    /* ---- the runner and GitHub's list of suites ---- */
    var runner = path.join(__dirname, 'run-all.js');
    var rr = cp.spawnSync(process.execPath, [runner, 'no-such-suite-'], { encoding: 'utf8' });
    check(rr.status === 1 && /no suite matches "no-such-suite-"/.test(rr.stdout),
      'run-all.js fails when its filter matches no suite', 'exit ' + rr.status + ': ' + rr.stdout.trim().split('\n').pop());
    var wf = fs.readFileSync(path.join(paths.ROOT, '.github', 'workflows', 'checks.yml'), 'utf8');
    var listed = workflowSuites(wf), tests = fs.readdirSync(__dirname).filter(function (f) { return /\.test\.js$/.test(f); }).sort();
    var kinds = {};
    tests.forEach(function (f) { kinds[f.replace('.test.js', '')] = loadsBrowser(path.join(__dirname, f)) ? 'browser' : 'node'; });
    var nodeOnes = Object.keys(kinds).filter(function (n) { return kinds[n] === 'node'; });
    check(/run-all\.js check-\s*$/m.test(wf) && listed.length >= 20 && nodeOnes.length >= 30 && kinds['app-regression'] === 'browser' && kinds['e2e-permission'] === 'browser' && kinds['replay-finger'] === 'browser',
      'the workflow runs the check group, then ' + listed.length + ' suites by name; of the ' + tests.length + ' suites here ' + nodeOnes.length +
      ' need no browser (e2e-permission and replay-finger do, through a file they require)');
    var wp = workflowProblems(kinds, listed, LEFT_OUT);
    check(wp.length === 0, 'every suite that needs no browser is in the workflow\'s list or in LEFT_OUT (' + LEFT_OUT.length + ', each with its reason), and every name in them is such a suite', wp.join('; '));
    var kinds2 = Object.assign({}, kinds, { 'sim-madeup': 'node' });
    var w1 = workflowProblems(kinds2, listed, LEFT_OUT), w2 = workflowProblems(kinds, listed.concat(['sim-nofile', 'app-regression']), LEFT_OUT),
        w3 = workflowProblems(kinds, listed.filter(function (n) { return n !== 'realsand-felt'; }), LEFT_OUT), w4 = workflowProblems(kinds, listed.concat(['sim-perf']), LEFT_OUT);
    check(w1.length === wp.length + 1 && /sim-madeup/.test(w1.join()) && w2.length === wp.length + 2 && /sim-nofile.*no such suite/.test(w2.join()) && /app-regression.*browser/.test(w2.join()) &&
          w3.length === wp.length + 1 && /realsand-felt/.test(w3.join()) && w4.length === wp.length + 1 && /sim-perf.*both/.test(w4.join()),
      '... and that check finds a new suite in neither list, realsand-felt left out of the workflow, a listed name with no file, a listed browser suite, and a name in both lists (control)',
      [w1, w2, w3, w4].map(function (w) { return w.join('; '); }).join(' | '));

    /* ---- the suites that count Tune's rows, named in the steps for a new setting ---- */
    var counting = tests.filter(function (f) { return /\.rows === \d+/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')); }).map(function (f) { return f.replace('.test.js', ''); });
    var engines = fs.readFileSync(path.join(paths.ROOT, 'docs', 'engines.md'), 'utf8');
    var step = (/\n7\. The row count:([\s\S]*?)\n\n/.exec(engines) || [])[1] || '';
    var unnamed = function (text) { return counting.filter(function (n) { return text.indexOf('`' + n + '`') < 0; }); };
    check(counting.length >= 6 && step && unnamed(step).length === 0,
      'the steps for a new setting name every suite that counts Tune\'s rows (' + counting.join(', ') + ')', unnamed(step).join(', '));
    var asShipped = " five suites count Tune's rows (`app-regression`,\n   `e2e-calm`, `app-breath`, `app-sequence`, `app-realsand`), so a new row\n   changes those on purpose.";
    check(unnamed(asShipped).length > 0 && unnamed(asShipped).indexOf('app-tune') >= 0,
      '... and that check finds app-tune missing from the step as release 1.21.1 had it (control)', unnamed(asShipped).join(', '));
  } catch (e) {
    check(false, 'no exception', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('check-harness: ' + (count - failures) + '/' + count + ' passed');
  if (failures) process.exitCode = 1;
})();
