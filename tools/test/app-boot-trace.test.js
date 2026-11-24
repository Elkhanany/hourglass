#!/usr/bin/env node
/*
 * The boot trace: what the app does with its settings as it starts, in order, for five saved
 * states (lib/trace.js: nothing saved; a save from before version 2 with everything changed; a
 * version-2 save with Real motion left on; a damaged save; "?t=45" over a saved sequence).
 *
 * For each, everything app.js reads and writes in storage and calls on the Sim (Sim.setPace,
 * the constructor, setLayers, reset, ...), the Renderer (setFrame, setLayers, setTheme, ...),
 * the sound engine (its six fields, then setMuted, setCharacter, ...) and the motion sensors
 * until it has run, and the settings as they are saved then, must be what the app did before
 * the settings store: tools/test/base/boot-trace.json, made from the commit before it
 * (lib/base.js). So the store, and whatever comes after it, changes nothing of the order in
 * which the settings reach the engines.
 * The control: a copy of app.js that gives the sound engine `muted` before `volume` must fail.
 *
 *   node tools/test/app-boot-trace.test.js [--port <n>] [--root <dir>] [--base <commit>] [--write]
 *
 * --base <commit> (or HOURGLASS_BASE): the kept trace must be that commit's (its tree, from
 * git, is run too); with --write it is written from it. --write alone: the kept trace is
 * written from the tree just run, which is how a setting added on purpose gets into it (in a
 * commit of its own: read the diff). Ports: <n>, and <n>+1 and <n>+2 for the control's and
 * the commit's trees.
 */
'use strict';
var H = require('./stubs/harness.js');
var base = require('./lib/base.js');
var trace = require('./lib/trace.js');

var WHAT = 'What the app reads, saves and calls on its engines as it starts, in order, for five saved states (tools/test/lib/trace.js)';
function names(list) { return (list || []).map(function (e) { return e[0]; }); }
/** Whether the names come in this order in a trace (each after the one before). */
function inOrder(list, wanted) {
  var at = -1, all = names(list);
  return wanted.every(function (w) { at = all.indexOf(w, at + 1); return at >= 0; });
}

(async function () {
  var s = new H.Suite('app-boot-trace'), env = null, rev = base.asked(), kept = trace.read(base.BOOT);
  try {
    /* ---- the commit before the store, when asked for ---- */
    if (rev) {
      var full = base.git(['rev-parse', '--verify', rev + '^{commit}']).trim();
      var envB = await H.start({ root: base.tree(rev), port: port() + 2 }), made = [];
      try { for (var b = 0; b < trace.STORAGES.length; b++) made.push(await trace.boot(envB, trace.STORAGES[b])); } finally { await envB.close(); }
      made.forEach(function (m) { delete m.errors; });
      if (base.writing()) {
        trace.write(base.BOOT, { from: full, what: WHAT, boots: made });
        kept = trace.read(base.BOOT);
        s.note('written', 'tools/test/base/boot-trace.json, from ' + full);
      }
      made.forEach(function (m, i) {
        var d = trace.differ(kept && kept.boots[i], m);
        s.check('BASE ' + m.name + ': the kept trace is ' + rev + '\'s (' + m.trace.length + ' events)', d.length === 0 && kept.boots[i].name === m.name, d.join('; '));
      });
    }
    var fromHere = base.writing() && !rev;
    if (!kept && !fromHere) throw new Error('no kept trace (tools/test/base/boot-trace.json): make it with --write');

    /* ---- this tree ---- */
    env = await H.start();
    var mine = [];
    for (var i = 0; i < trace.STORAGES.length; i++) mine.push(await trace.boot(env, trace.STORAGES[i]));
    if (fromHere) {
      trace.write(base.BOOT, { from: base.here(env.root), what: WHAT, boots: mine.map(function (m) { return { name: m.name, trace: m.trace, saved: m.saved }; }) });
      kept = trace.read(base.BOOT);
      s.note('written', 'tools/test/base/boot-trace.json, from the tree just run: read its diff before it is committed');
    }
    mine.forEach(function (m, i) {
      var d = trace.differ(kept.boots[i], m);
      s.check('BOOT ' + m.name + ': the boot reads, saves and calls its engines as before the store (' + (m.trace || []).length + ' events, and the save)',
              d.length === 0 && kept.boots[i].name === m.name, d.join('; '));
      s.check('BOOT ' + m.name + ': no page or console errors', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));
    });
    // what the trace sees: the order the plan names, in the state that sets everything
    var all = kept.boots[1].trace, ORDER = ['get', 'Sim.setPace', 'new Sim', 'new Renderer', 'renderer.setFrame', 'sim.setLayers', 'renderer.setLayers', 'new Audio',
      'audio.volume =', 'audio.muted =', 'audio.character =', 'audio.chimeEnabled =', 'audio.ambience =', 'audio.ambLevel =', 'new Motion', 'sim.reset', 'save'];
    var paced = all.filter(function (e) { return e[0] === 'Sim.setPace'; })[0], built = all.filter(function (e) { return e[0] === 'new Sim'; })[0];
    s.check('the kept trace sees the boot: the settings read; Sim.setPace(√2) before the Sim is built at that scale; setFrame, then setLayers on the Sim and the Renderer; ' +
            'the sound engine\'s volume, muted, character, chimeEnabled, ambience and ambLevel in that order; the sensors; the fill; a save',
            inOrder(all, ORDER) && paced && Math.abs(paced[1] - Math.SQRT2) < 1e-5 && built && Math.abs(built[1].scale - 1.08 * Math.SQRT2) < 1e-5 && built[1].seed === '(a seed)' &&
            kept.boots.every(function (k) { return k.trace.length > 20 && typeof k.saved === 'string' && /"v":2[,}]/.test(k.saved); }) &&        // (a setting added since is saved after the version)
            kept.boots[3].trace.some(function (e) { return e[0] === 'audio.character =' && e[1] === 'tuba'; }) &&
            kept.boots[4].saved.indexOf('"durationMs":45000,"restMs":0,"rounds":1') > 0,
            names(all).slice(0, 24).join(' '));

    /* ---- control: a copy that changes the order ---- */
    var dir = trace.patched(env.root, [['  audio.volume = settings.volume;\n  audio.muted = settings.muted;\n', '  audio.muted = settings.muted;\n  audio.volume = settings.volume;\n']]);
    var envC = await H.start({ root: dir, port: env.port + 1 }), c;
    try { c = await trace.boot(envC, trace.STORAGES[1]); } finally { await envC.close(); }
    var dc = trace.differ(kept.boots[1], c);
    s.check('CONTROL: a copy of app.js that gives the sound engine `muted` before `volume` fails the check', dc.length > 0 && /audio\.(muted|volume) =/.test(dc.join()), dc.join('; '));
  } catch (e) {
    s.check('the suite ran', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' '));
  } finally {
    if (env) await env.close();
  }
  s.done();
})();

function port() {
  var i = process.argv.indexOf('--port');
  return i > 0 ? +process.argv[i + 1] : (+process.env.PORT || 8804);
}
