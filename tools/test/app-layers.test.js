/*
 * Layered sand, in the app: the Tune switch (Material, after Frame).
 *   - off by default: the sim and the renderer have no layers, the colour
 *     table is the plain one, the main screen has not gained a button
 *   - the row: 'Layered sand' / 'Two tones that settle into strata as they
 *     fall', a labelled switch like the others; it fits at 360 and 430 px
 *   - turned on: behind the cross-fade the sand in the glass is laid in two
 *     tones where it lies (the lattice, the timer and the sand's count are
 *     untouched), the companion tone never most of it; the setting is saved
 *   - it survives a reload; a new glass is filled in bands; running, poured
 *     into and flipped, every grain keeps its tone (the census holds)
 *   - a restored session rebuilds its bands
 *   - turned off: one tone again, and the colour table is the plain one
 *   - Reduce Motion: the same, without errors
 *
 *   node tools/test/app-layers.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var sleep = H.sleep;

/** What the page says about its layers (and enough of the glass to see that nothing else moved). */
function probe(t) {
  return t.eval(function () {
    var Hg = window.Hourglass, sim = Hg.sim, ren = Hg.renderer, el = document.getElementById('opt-layers');
    function fnv(a) { var h = -2128831035; for (var i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); } return h >>> 0; }
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('hourglass.settings.v1') || 'null'); } catch (e) {}
    var c = sim.census();
    return {
      checked: el.checked, sim: sim.layers, ren: ren.layers, tones: sim.tones(), total: sim.total, nTop: sim.nTop,
      census: c.total === sim.total && c.top === sim.nTop,
      saved: saved ? saved.layers : undefined, lut: fnv(new Uint8Array(ren.lut.buffer)), cell: fnv(sim.cell),
      state: Hg.timer.state, rem: Hg.timer.rem
    };
  });
}
async function openTune(t) {
  await t.page.tap('#btn-settings');
  await sleep(700);
  await t.page.$eval('#opt-layers', function (el) { el.scrollIntoView({ block: 'center' }); });
  await sleep(250);
}
async function closeTune(t) {
  await t.page.tap('#sheet-settings .sheet-close');
  await sleep(600);
}

async function testSwitch(s, env) {
  var t = await env.open({ motionStub: true });
  var ui = await t.eval(function () {
    var el = document.getElementById('opt-layers'), row = el.closest('.row'), rows = Array.prototype.slice.call(document.querySelectorAll('#sheet-settings .row'));
    var frame = document.getElementById('opt-frame').closest('.row');
    return {
      title: row.querySelector('b').textContent, note: row.querySelector('small').textContent,
      label: row.tagName === 'LABEL' && row.getAttribute('for') === 'opt-layers', role: el.getAttribute('role'), type: el.type,
      afterFrame: rows.indexOf(row) === rows.indexOf(frame) + 1 && row.parentNode === frame.parentNode,
      material: row.parentNode.previousElementSibling.id === 'themes',
      top: document.querySelectorAll('#hud-top button').length, bottom: document.querySelectorAll('#hud-bottom button').length
    };
  });
  s.check('ROW: "Layered sand", with its note', ui.title === 'Layered sand' && ui.note === 'Two tones that settle into strata as they fall', JSON.stringify([ui.title, ui.note]));
  s.check('ROW: a labelled switch like the others, after Frame in Material', ui.label && ui.role === 'switch' && ui.type === 'checkbox' && ui.afterFrame && ui.material, JSON.stringify(ui));
  s.check('ROW: the main screen has not gained a button (4 top, one of them hidden; 12 bottom)', ui.top === 4 && ui.bottom === 12, ui.top + ' / ' + ui.bottom);
  var p0 = await probe(t);
  s.check('OFF by default: no layers in the sim or the renderer, nothing saved as on', !p0.checked && p0.sim === false && p0.ren === false && !p0.saved, JSON.stringify(p0));

  // the row at the widths of small and large phones
  for (var w of [360, 430]) {
    await t.page.setViewportSize({ width: w, height: 800 });
    await sleep(500);
    await openTune(t);
    var fit = await t.eval(function () {
      var el = document.getElementById('opt-layers'), row = el.closest('.row'), r = row.getBoundingClientRect(), sw = el.getBoundingClientRect();
      var sm = row.querySelector('small').getBoundingClientRect(), body = document.querySelector('#sheet-settings .sheet-body');
      return { w: window.innerWidth, row: [r.left, r.right, r.height], sw: [sw.left, sw.right], smRight: sm.right, over: body.scrollWidth - body.clientWidth, doc: document.documentElement.scrollWidth };
    });
    s.check('ROW: fits at ' + w + ' px (nothing clipped, the note clear of the switch)',
            fit.row[0] >= 0 && fit.row[1] <= fit.w && fit.sw[1] <= fit.row[1] && fit.smRight <= fit.sw[0] - 6 && fit.over <= 0 && fit.doc <= fit.w && fit.row[2] <= 76, JSON.stringify(fit));
    await closeTune(t);
  }
  await t.page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);

  // on
  await openTune(t);
  await t.page.tap('#opt-layers');
  await sleep(1100);                                   // the cross-fade
  var p1 = await probe(t);
  s.check('ON: the switch, the sim and the renderer', p1.checked && p1.sim === true && p1.ren === true, JSON.stringify(p1));
  s.check('ON: saved with the other settings', p1.saved === true, String(p1.saved));
  s.check('ON: two tones, the companion never most of the sand', p1.tones[0] > 0 && p1.tones[1] > 0.2 * p1.total && p1.tones[1] <= p1.tones[0] && p1.tones[0] + p1.tones[1] === p1.total, p1.tones.join(' + '));
  s.check('ON: the sand itself is untouched (lattice, count, timer)', p1.cell === p0.cell && p1.total === p0.total && p1.state === p0.state && p1.rem === p0.rem && p1.census, JSON.stringify({ cell: [p0.cell, p1.cell], total: [p0.total, p1.total] }));
  s.check('ON: the colour table has changed', p1.lut !== p0.lut);
  await closeTune(t);

  // a reload keeps it; a new glass is filled in bands; running, pouring and a flip keep every tone
  await t.reload();
  await sleep(600);
  var p2 = await probe(t);
  s.check('RELOAD: still on, the fill laid in two tones', p2.checked && p2.sim && p2.ren && p2.tones[0] > 0 && p2.tones[1] > 0 && p2.tones[1] <= p2.tones[0], JSON.stringify(p2));
  await t.page.tap('#durations .pill[data-min="1"]');
  await sleep(900);
  var p3 = await probe(t);
  s.check('NEW GLASS: a 1 min glass is filled in two tones', p3.total !== p2.total && p3.tones[0] + p3.tones[1] === p3.total && p3.tones[1] > 0.2 * p3.total && p3.tones[1] <= p3.tones[0], p3.tones.join(' + '));
  await t.page.tap('#btn-play');
  await sleep(2500);
  var p4 = await probe(t);
  s.check('RUNNING: every grain keeps its tone', p4.state === 'running' && p4.nTop < p3.nTop && p4.tones[0] === p3.tones[0] && p4.tones[1] === p3.tones[1] && p4.census, JSON.stringify({ before: p3.tones, after: p4.tones, nTop: p4.nTop }));
  // (the Sand button, held for half a second)
  var b = await t.page.$eval('#btn-sand', function (el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await t.touch.tap(b.x, b.y, 500);
  await sleep(1500);
  var p5 = await probe(t);
  s.check('POUR: the sand poured in is counted, tone by tone', p5.total > p4.total + 100 && p5.tones[0] + p5.tones[1] === p5.total && p5.tones[0] >= p4.tones[0] && p5.tones[1] >= p4.tones[1] && p5.census,
          (p5.total - p4.total) + ' grains: ' + p4.tones.join(' + ') + ' → ' + p5.tones.join(' + '));
  await t.page.tap('#btn-flip');
  await sleep(3600);
  var p6 = await probe(t);
  s.check('FLIP: every grain keeps its tone', p6.tones[0] === p5.tones[0] && p6.tones[1] === p5.tones[1] && p6.census, p6.tones.join(' + '));

  // a restored session rebuilds its bands
  await sleep(1200);
  await t.reload();
  await sleep(800);
  var p7 = await probe(t);
  s.check('SESSION: restored running, with layers, in two tones', p7.state === 'running' && p7.sim && p7.total === p6.total && p7.tones[0] > 0 && p7.tones[1] > 0 && p7.tones[0] + p7.tones[1] === p7.total && p7.census, JSON.stringify(p7));

  // off again
  await t.page.tap('#btn-play');                       // pause: the controls stay
  await sleep(500);
  await openTune(t);
  await t.page.tap('#opt-layers');
  await sleep(1100);
  var p8 = await probe(t);
  s.check('OFF again: the switch, the sim, the renderer and the saved setting', !p8.checked && p8.sim === false && p8.ren === false && p8.saved === false, JSON.stringify(p8));
  s.check('OFF again: the colour table is the plain one', p8.lut === p0.lut, p8.lut + ' vs ' + p0.lut);
  s.check('OFF again: bit 7 of the seeds is noise once more (about half the grains)', Math.abs(p8.tones[1] / p8.total - 0.5) < 0.04, (100 * p8.tones[1] / p8.total).toFixed(1) + ' %');
  await H.invariants(s, t, 'layers');
  await t.close();
}

async function testReduced(s, env) {
  var t = await env.open({ motionStub: true, reducedMotion: true, storage: { 'hourglass.settings.v1': { layers: true, muted: true } } });
  await sleep(600);
  var p = await probe(t);
  s.check('REDUCE MOTION: a saved "on" starts with layers', p.checked && p.sim && p.ren && p.tones[1] > 0 && p.tones[1] <= p.tones[0], JSON.stringify(p));
  await openTune(t);
  await t.page.tap('#opt-layers');
  await sleep(1100);
  var q = await probe(t);
  s.check('REDUCE MOTION: the switch turns it off', !q.checked && q.sim === false && q.ren === false && q.saved === false && q.cell === p.cell);
  s.check('REDUCE MOTION: no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  await t.close();
}

/**
 * Two changes within one cross-fade (it takes 0.38 s to come in): both happen.
 * Before, the second replaced the first: Layered sand tapped and then Frame, or
 * a material, left the switch on and the sand plain.
 */
async function testQuick(s, env) {
  var t = await env.open({ motionStub: true });
  await openTune(t);
  function both(first, second, ms) {
    return t.eval(function (a) {
      return new Promise(function (resolve) {
        var Hg = window.Hourglass, P = window.HourglassPhysics;
        document.querySelector(a.first).click();
        setTimeout(function () {
          document.querySelector(a.second).click();
          setTimeout(function () {
            var saved = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
            resolve({ sw: document.getElementById('opt-layers').checked, sim: Hg.sim.layers, ren: Hg.renderer.layers, tones: Hg.sim.tones(), total: Hg.sim.total,
                      frameSw: document.getElementById('opt-frame').checked, frame: Hg.renderer.frame, saved: [saved.layers, saved.frame, saved.theme],
                      theme: Hg.renderer.theme === P.THEMES[saved.theme], fading: document.getElementById('assembly').classList.contains('fade') });
          }, 1100);
        }, a.ms);
      });
    }, { first: first, second: second, ms: ms });
  }
  var a = await both('#opt-layers', '#opt-frame', 150);
  s.check('QUICK: Layered sand, then Frame 150 ms later: the sand is layered (switch, sim and renderer agree) and the frame is off',
          a.sw && a.sim === true && a.ren === true && a.tones[1] > 0.2 * a.total && a.tones[1] <= a.tones[0] && !a.frameSw && a.frame === false && !a.fading, JSON.stringify(a));
  var b = await both('#opt-layers', '#themes .card[data-theme-id="lapis"]', 250);
  s.check('QUICK: Layered sand off, then a material 250 ms later: one tone again, and the renderer has the new material',
          !b.sw && b.sim === false && b.ren === false && b.saved[2] === 'lapis' && b.theme && !b.fading, JSON.stringify(b));
  var c = await both('#opt-frame', '#opt-layers', 30);
  s.check('QUICK: Frame back on, then Layered sand 30 ms later: both', c.frameSw && c.frame === true && c.sw && c.sim === true && c.ren === true && !c.fading, JSON.stringify(c));
  // and a change after the fade has gone again still takes one of its own
  await sleep(300);
  var d = await both('#opt-layers', '#opt-layers', 700);
  s.check('QUICK: switched off and, 700 ms later, on again: on, in step', d.sw && d.sim === true && d.ren === true && !d.fading, JSON.stringify(d));
  // Of one kind of change only the last happens: the material chip tapped through four
  // materials sets one, not four (each is a heavy change of the renderer's), and a switch
  // tapped on, off and on again is applied once. Another kind asked meanwhile still happens.
  await sleep(300);
  var e = await t.eval(function () {
    return new Promise(function (resolve) {
      var Hg = window.Hourglass, P = window.HourglassPhysics, R = Hg.renderer, n = { theme: 0, frame: 0, layers: 0 };
      var st = R.setTheme, sf = R.setFrame, sl = R.setLayers, chip = document.getElementById('btn-theme'), was = R.theme, frameWas = R.frame;
      R.setTheme = function () { n.theme++; return st.apply(R, arguments); };
      R.setFrame = function () { n.frame++; return sf.apply(R, arguments); };
      R.setLayers = function () { n.layers++; return sl.apply(R, arguments); };
      chip.click(); chip.click();
      document.getElementById('opt-frame').click();
      setTimeout(function () {
        chip.click(); chip.click();
        var l = document.getElementById('opt-layers'); l.click(); l.click(); l.click();
      }, 120);
      setTimeout(function () {
        var saved = JSON.parse(localStorage.getItem('hourglass.settings.v1') || '{}');
        R.setTheme = st; R.setFrame = sf; R.setLayers = sl;
        resolve({ calls: n, saved: saved.theme, theme: R.theme === P.THEMES[saved.theme], moved: R.theme !== was, shown: document.documentElement.dataset.theme,
                  frame: R.frame === !frameWas && R.frame === document.getElementById('opt-frame').checked,
                  layers: Hg.sim.layers === document.getElementById('opt-layers').checked && R.layers === Hg.sim.layers,
                  fading: document.getElementById('assembly').classList.contains('fade') });
      }, 1300);
    });
  });
  s.check('QUICK: the material chip tapped four times, Frame once and Layered sand three times within one fade: one change of each kind, the last asked',
          e.calls.theme === 1 && e.calls.frame === 1 && e.calls.layers === 1 && e.theme && e.moved && e.shown === e.saved && e.frame && e.layers && !e.fading, JSON.stringify(e));
  s.check('QUICK: no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  await t.close();
}

(async function () {
  var env = await H.start();
  var s = new H.Suite('app-layers');
  try {
    await testSwitch(s, env);
    await testQuick(s, env);
    await testReduced(s, env);
  } catch (e) {
    s.check('the suite ran to its end', false, String(e && e.stack || e));
  }
  await env.close();
  s.done();
})();
