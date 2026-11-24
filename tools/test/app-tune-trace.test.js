#!/usr/bin/env node
/*
 * The Tune trace: what every control that changes a setting does, in order (lib/trace.js).
 * Every control of Tune (the four tabs, the reset link's two taps, the ten sands and the
 * custom sand's colour well, Frame and its six finishes, Layered sand, the six characters, the
 * volume, the six ambiences and their level, the completion bowl, Keep screen awake, Real
 * motion, Full Zen, Breathing pace and its three patterns, Haptics, the three grains, Real
 * sand), and the mute button, the sand chip and a duration pill, which save too.
 *
 * For each: what its own tap does before it returns (now: the save, the calls on the sound
 * engine, the Sim, the Renderer and the sensors, the buzz), and what follows (later: what the
 * cross-fade sets, the answer to the motion question, the boot after the reload a grain and
 * Real sand make). It must be as the kept trace has it: tools/test/base/tune-trace.json, the
 * reviewed record of the tree named in its "from" (lib/base.js). It was first made from the
 * last release before the settings store, and made again, each time in a commit of its own
 * that says what changed and nothing else, when a setting or a control was added on purpose.
 * The controls are named for what they set, not for the page's markup, so that a new Tune can
 * be driven by its own selectors and compared with the same file.
 * A control of Tune that the driver has no line for would not be traced at all, so every
 * switch, choice, slider, tab and button of Tune's sheet (but the one that closes it) must be
 * one the driver reaches (lib/trace.js, DRIVE).
 * Tune has tabs, and the driver gets to each control as a person does (lib/tune.js finds its
 * tab from the page): what getting there logs is kept out of the control's entry, and must be
 * what the kept trace has for a tap on that tab (or on the Tune button, after a reload) and
 * nothing more.
 * The controls of this check: a copy of app.js whose completion bowl tells the sound engine
 * before it saves, and whose Haptics switch no longer buzzes, must fail at those two; a copy
 * of the page with one switch more must be found to have a control nothing drives; and a copy
 * whose tabs tell the sound engine something as they are shown must be found out on the way
 * to a control.
 *
 *   node tools/test/app-tune-trace.test.js [--port <n>] [--root <dir>] [--write] [--base <commit>]
 *
 * --write: the kept trace is written from the tree just run, which is how a setting or a
 * control added on purpose gets into it (in a commit of its own: read the diff). --base
 * <commit> (or HOURGLASS_BASE), a report for whoever makes the trace again: that commit's
 * tree, from git, is driven too, and how its controls differ from the kept trace is printed
 * (NOTE lines). It passes and fails nothing: the kept trace holds keys and controls that an
 * older commit cannot have. Ports: <n>, and <n>+1 and <n>+2 for the control's and the
 * commit's trees.
 */
'use strict';
var H = require('./stubs/harness.js');
var base = require('./lib/base.js');
var trace = require('./lib/trace.js');

var WHAT = 'What every control that changes a setting saves, calls on the engines and buzzes, in order: in its own tap (now) and after it (later) (tools/test/lib/trace.js)';
function port() {
  var i = process.argv.indexOf('--port');
  return i > 0 ? +process.argv[i + 1] : (+process.env.PORT || 8804);
}
function names(list) { return (list || []).map(function (e) { return e[0]; }); }
function byName(data, name) { return data.controls.filter(function (c) { return c.name === name; })[0]; }
function first(list, name) { return (list || []).filter(function (e) { return e[0] === name; })[0]; }

(async function () {
  var s = new H.Suite('app-tune-trace'), env = null, rev = base.asked(), kept = trace.read(base.TUNE);
  try {
    /* ---- another commit, when asked for: a report, which passes and fails nothing ---- */
    if (rev) {
      var full = base.git(['rev-parse', '--verify', rev + '^{commit}']).trim();
      var envB = await H.start({ root: base.tree(rev), port: port() + 2 }), made;
      try { made = await trace.tune(envB); } finally { await envB.close(); }
      var off = made.controls.map(function (c) { var d = trace.differ(byName(kept || { controls: [] }, c.name), c); return d.length ? c.name + ': ' + d[0] : ''; }).filter(Boolean);
      var absent = kept ? kept.controls.filter(function (k) { return !byName(made, k.name); }).map(function (k) { return k.name; }) : [];
      s.note('BASE: ' + full.slice(0, 7) + '\'s ' + made.controls.length + ' controls against the kept trace: ' + off.length + ' differ, ' + absent.length + ' of the kept ones it has not' +
             (kept && kept.saved !== made.saved ? ', and the settings saved at the end differ' : ''), off.concat(absent.map(function (n) { return n + ': not in that commit'; })).join(' | '));
    }
    var fromHere = base.writing();
    if (!kept && !fromHere) throw new Error('no kept trace (tools/test/base/tune-trace.json): make it with --write');

    /* ---- this tree ---- */
    env = await H.start();
    var mine = await trace.tune(env);
    if (fromHere) {
      trace.write(base.TUNE, { from: base.here(env.root), what: WHAT, controls: mine.controls, saved: mine.saved });
      kept = trace.read(base.TUNE);
      s.note('written', 'tools/test/base/tune-trace.json, from the tree just run: read its diff before it is committed');
    }
    s.check('every switch, choice and slider of Tune\'s sheet is one the driver reaches (' + trace.CONTROLS.length + ' lines in lib/trace.js): none is left untraced',
            mine.undriven.length === 0, mine.undriven.length ? 'no line drives ' + mine.undriven.join(', ') : '');
    s.check('the controls driven are the kept trace\'s, in its order (' + kept.controls.length + ')',
            trace.CONTROLS.join('|') === kept.controls.map(function (c) { return c.name; }).join('|') && mine.controls.length === kept.controls.length);
    kept.controls.forEach(function (k) {
      var m = byName(mine, k.name), d = trace.differ(k, m);
      s.check(k.name + ': saves, calls and buzzes as the kept trace has it (' + k.now.length + ' in its tap, ' + k.later.length + ' after)', d.length === 0, d.join('; '));
    });
    s.check('the settings saved at the end are the kept ones, byte for byte', mine.saved === kept.saved, mine.saved + ' for ' + kept.saved);
    // the way to a control: Tune opened again after a reload, the control's tab shown. Each step is held to the kept entry of the line that drives the same element
    var astray = function (made) {
      return made.reaches.map(function (r) {
        var d = trace.differ(byName(kept, r.did), { now: r.now, later: r.later });
        return d.length ? 'on the way to "' + r.for + '", ' + r.did + ': ' + d[0] : '';
      }).filter(Boolean);
    };
    var lost = astray(mine), did = mine.reaches.map(function (r) { return r.did; });
    s.check('getting to a control does what a tap on its tab does (or on the Tune button, after a reload), and nothing more: each of the ' + mine.reaches.length +
            ' steps the driver took is as the kept trace has that tab or button',
            lost.length === 0 && did.indexOf('open Tune') >= 0 && did.some(function (n) { return /^tab: /.test(n); }),
            lost.slice(0, 3).join(' | ') || did.filter(function (n, i) { return did.indexOf(n) === i; }).map(function (n) { return did.filter(function (m) { return m === n; }).length + ' × ' + n; }).join(', '));
    s.check('no page or console errors', mine.errors.length === 0, mine.errors.slice(0, 3).join(' | '));

    // what the trace sees: the places where the order matters most
    var vol = byName(kept, 'volume: 30'), muted = byName(kept, 'volume: 55, while muted'), hOn = byName(kept, 'haptics: on'), hOff = byName(kept, 'haptics: off');
    var chime = byName(kept, 'completion bowl: on'), tiltOn = byName(kept, 'real motion: on'), mat = byName(kept, 'sand: lapis'), fin = byName(kept, 'finish: gold'), walnut = byName(kept, 'finish: walnut'), well = byName(kept, 'sand: custom, a colour of its own (the well, let go)'), grain = byName(kept, 'grain: fine');
    var real = byName(kept, 'Real sand: on'), lay = byName(kept, 'layered sand: on');
    s.check('the kept trace sees: the volume told to the sound engine before it is saved, and un-muting inside it',
            names(vol.now).join() === 'audio.setVolume,save' && first(vol.now, 'save')[1].volume === 0.3 &&
            names(muted.now).join() === 'audio.setVolume,save,audio.setMuted,save' && muted.now[1][1].muted === false && muted.now[1][1].volume === 0.55,
            JSON.stringify(vol.now) + ' ' + JSON.stringify(muted.now));
    s.check('... a switch: saved, then the engine, then one buzz of the sheet; Haptics its own buzz (12) first, and none when it is turned off',
            names(chime.now).join() === 'audio.unlock,save,audio.setChimeEnabled,audio.chime,buzz' && chime.now[4][1] === 8 &&
            JSON.stringify(hOn.now.slice(-2)) === '[["buzz",12],["buzz",8]]' && names(hOff.now).indexOf('buzz') < 0,
            JSON.stringify(chime.now) + ' ' + JSON.stringify(hOn.now) + ' ' + JSON.stringify(hOff.now));
    s.check('... Real motion asked inside the tap, and saved once it is granted; a sand or a finish saved in the tap and set behind the cross-fade (a sand over another\'s caps put together by setLook, one of the six over its own caps the renderer\'s own bundle); the colour well set at once, as it is let go; layers set on the Sim, then the Renderer',
            names(tiltOn.now).indexOf('motion.request') >= 0 && names(tiltOn.now).indexOf('save') < 0 && names(tiltOn.later).join() === 'motion.start,save' &&
            names(mat.now).join() === 'audio.unlock,save,buzz' && first(mat.now, 'save')[1].sand === 'lapis' && !('finish' in first(mat.now, 'save')[1]) &&
            JSON.stringify(mat.later) === '[["renderer.setLook",{"sand":"lapis","material":"sahara"}]]' &&
            names(fin.now).join() === 'audio.unlock,save,buzz' && first(fin.now, 'save')[1].finish === 'gold' && JSON.stringify(fin.later) === '[["renderer.setLook",{"sand":"sahara","material":"lapis"}]]' &&
            JSON.stringify(walnut.later) === '[["renderer.setTheme","sahara"]]' &&
            names(well.now).join() === 'save,renderer.setLook' && typeof first(well.now, 'renderer.setLook')[1].sand === 'object' && /^\d/.test(first(well.now, 'save')[1].sandColor) &&
            names(lay.later).join() === 'sim.setLayers,renderer.setLayers',
            JSON.stringify(tiltOn) + ' ' + JSON.stringify(mat) + ' ' + JSON.stringify(fin) + ' ' + JSON.stringify(walnut) + ' ' + JSON.stringify(well) + ' ' + JSON.stringify(lay));
    s.check('... a grain and Real sand: saved, the session put away, and the page loaded again with the setting (Sim.setPace before the Sim)',
            names(grain.now).join() === 'audio.unlock,save,buzz,remove' && first(grain.later, 'Sim.setPace') && names(grain.later).indexOf('Sim.setPace') < names(grain.later).indexOf('new Sim') &&
            names(real.now).join() === 'audio.unlock,save,remove,buzz' && first(real.now, 'save')[1].realSand === true && names(real.later).indexOf('new Sim') > 0,
            JSON.stringify(grain.now) + ' ' + JSON.stringify(real.now));

    // the reset link, tapped where the sand, the volume and the ambience level differ from the defaults: one save of what it put back, the engine told, the look behind the cross-fade
    var reset = byName(kept, 'the look and sound put back: the second tap'), resetSave = first(reset && reset.now, 'save');
    s.check('... the reset link\'s second tap, after the look and the sound were changed: one save that puts back the sand, the volume and the ambience level, the sound engine told each, its buzz (12), and the look set behind the cross-fade',
            !!resetSave && JSON.stringify(resetSave[1]) === '{"theme":"sahara","volume":0.8,"ambienceLevel":0.5,"sand":"sahara"}' &&
            names(reset.now).join() === 'audio.unlock,save,audio.setVolume,audio.setAmbienceLevel,buzz' && JSON.stringify(reset.later) === '[["renderer.setTheme","sahara"]]',
            JSON.stringify(reset));

    /* ---- control: a copy that changes the order in two handlers, and has a switch more in Tune ---- */
    var AWAKE = '<input id="opt-awake" class="switch" type="checkbox" role="switch" checked>';
    var dir = trace.patched(env.root, [
      ['    settings.chime = e.target.checked; save();\n    audio.setChimeEnabled(settings.chime);\n', '    settings.chime = e.target.checked;\n    audio.setChimeEnabled(settings.chime); save();\n'],
      ['    settings.haptics = e.target.checked; save();\n    buzz(12);\n', '    settings.haptics = e.target.checked; save();\n'],
      [AWAKE, AWAKE + '<input id="opt-extra" class="switch" type="checkbox" role="switch">', 'index.html']
    ]);
    var envC = await H.start({ root: dir, port: env.port + 1 }), c;
    var ONLY = ['open Tune', 'completion bowl: off', 'completion bowl: on', 'haptics: off', 'haptics: on', 'full Zen: on'];
    try { c = await trace.tune(envC, ONLY); } finally { await envC.close(); }
    var failed = ONLY.filter(function (n) { return trace.differ(byName(kept, n), byName(c, n)).length > 0; });
    s.check('CONTROL: a copy of app.js whose completion bowl tells the sound engine before it saves, and whose Haptics switch has lost its buzz, fails at those (and only there)',
            failed.join() === 'completion bowl: off,completion bowl: on,haptics: on', failed.join());
    s.check('CONTROL: a copy of the page with one switch more in Tune is found to have a control that no line drives',
            c.undriven.indexOf('#opt-extra') >= 0 && c.undriven.length === mine.undriven.length + 1, c.undriven.join(', ') || 'none found');
    s.check('CONTROL: ... and in that copy the way to those controls is still a plain tap on their tabs (' + c.reaches.length + ' steps)',
            c.reaches.length >= 1 && astray(c).length === 0, astray(c).slice(0, 2).join(' | '));
    // a copy whose tabs do more than show their panel: the way to a control is no longer a tab's kept tap
    var dirT = trace.patched(env.root, [[null,
      '\n;(function () {\n  var tabs = document.getElementById(\'tune-tabs\');\n' +
      '  if (tabs) tabs.addEventListener(\'click\', function () { var a = window.Hourglass.audio; a.setVolume(a.volume); });\n})();\n']]);
    var envT = await H.start({ root: dirT, port: env.port + 1 }), ct;
    try { ct = await trace.tune(envT, ONLY); } finally { await envT.close(); }
    var failedT = ONLY.filter(function (n) { return trace.differ(byName(kept, n), byName(ct, n)).length > 0; });
    s.check('CONTROL: a copy whose tabs tell the sound engine its volume as they are shown is found out on the way to a control, and the controls themselves trace as kept',
            astray(ct).length === ct.reaches.length && ct.reaches.length >= 1 && /audio\.setVolume/.test(astray(ct).join()) && failedT.length === 0,
            (astray(ct)[0] || 'nothing found on the way') + (failedT.length ? '; and differs at ' + failedT.join() : ''));
  } catch (e) {
    s.check('the suite ran', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' '));
  } finally {
    if (env) await env.close();
  }
  s.done();
})();
