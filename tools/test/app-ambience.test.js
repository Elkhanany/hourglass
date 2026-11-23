/*
 * The ambience cards, in the app: Tune → Sound → Ambience.
 *   - six cards in a radio group (None, Brook, Rain, Ocean, Waterfall,
 *     Drips), as a screen reader meets them: a labelled radiogroup, each
 *     card a radio named by its text, exactly one checked, the icons hidden
 *   - one family with the sand's sounds under them: the same hourglass in
 *     every card, the sound drawn beside it; every id is one the engine has,
 *     under the same name
 *   - two rows of three at 320, 360, 390 and 430 px and in landscape: cards
 *     of one size, as tall as the characters' cards, no name clipped, nothing
 *     wider than the sheet
 *   - choosing one checks it alone, saves it, tells the engine and shows the
 *     level slider; None hides the slider; a reload restores the choice; an
 *     id the engine does not know falls back to None
 *
 *   node tools/test/app-ambience.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var tune = require('./lib/tune.js');
var sleep = H.sleep;

var NAMES = ['None', 'Brook', 'Rain', 'Ocean', 'Waterfall', 'Drips'];
var IDS = ['none', 'brook', 'rain', 'ocean', 'waterfall', 'drips'];

/** Tune open on the tab that holds the ambience cards, the cards in view (lib/tune.js finds the tab from the page). */
async function openTune(t) {
  await tune.show(t, '#ambiences');
}
async function closeTune(t) {
  await tune.close(t);
}
function state(t) {
  return t.eval(function () {
    var b = Array.prototype.slice.call(document.querySelectorAll('#ambiences button')), saved = null;
    try { saved = JSON.parse(localStorage.getItem('hourglass.settings.v1') || 'null'); } catch (e) {}
    return { checked: b.filter(function (x) { return x.getAttribute('aria-checked') === 'true'; }).map(function (x) { return x.dataset.ambience; }),
             saved: saved ? saved.ambience : undefined, engine: window.Hourglass.audio.ambience, slider: !document.getElementById('amb-row').hidden };
  });
}

async function testCards(s, env) {
  var t = await env.open({ motionStub: true });
  var a = await t.eval(function () {
    var g = document.getElementById('ambiences'), b = Array.prototype.slice.call(g.querySelectorAll('button'));
    var glass = document.querySelector('#characters button svg path').getAttribute('d'), AMB = window.HourglassAudio.AMBIENCES;
    var panel = g.closest('[role="tabpanel"]'), tab = panel ? document.getElementById(panel.getAttribute('aria-labelledby')) : null;
    return {
      role: g.getAttribute('role'), label: g.getAttribute('aria-label'), kids: g.children.length,
      heading: g.previousElementSibling.tagName + ':' + g.previousElementSibling.textContent,
      tab: tab ? tab.textContent.trim() : null, withSounds: !!panel && panel.contains(document.getElementById('characters')),
      cards: b.map(function (x) {
        var svg = x.querySelector('svg'), paths = svg.querySelectorAll('path'), text = x.textContent.trim();
        return { id: x.dataset.ambience, role: x.getAttribute('role'), type: x.type, checked: x.getAttribute('aria-checked'), name: text,
                 labelled: x.getAttribute('aria-label') || '', hidden: svg.getAttribute('aria-hidden'), glass: paths[0].getAttribute('d') === glass,
                 marks: paths.length - 1, known: !!(AMB[x.dataset.ambience]), engineName: AMB[x.dataset.ambience] ? AMB[x.dataset.ambience].name : null,
                 tab: x.tabIndex };
      }),
      engine: Object.keys(AMB)
    };
  });
  s.check('GROUP: a radiogroup named "Ambience behind the sand" under the Ambience heading, holding six cards and nothing else; in the Sound tab, with the sand\'s sounds',
          a.role === 'radiogroup' && a.label === 'Ambience behind the sand' && a.kids === 6 && a.cards.length === 6 && a.heading === 'H3:Ambience' && a.tab === 'Sound' && a.withSounds,
          JSON.stringify([a.role, a.label, a.kids, a.heading, a.tab, a.withSounds]));
  s.check('CARDS: None, Brook, Rain, Ocean, Waterfall, Drips, in that order', a.cards.map(function (c) { return c.name; }).join() === NAMES.join() &&
          a.cards.map(function (c) { return c.id; }).join() === IDS.join(), a.cards.map(function (c) { return c.id + '=' + c.name; }).join(', '));
  s.check('SCREEN READER: each card is a radio button named by its text alone, reachable, its icon hidden',
          a.cards.every(function (c) { return c.role === 'radio' && c.type === 'button' && !c.labelled && c.hidden === 'true' && c.tab === 0; }), JSON.stringify(a.cards.map(function (c) { return [c.role, c.hidden, c.tab]; })));
  s.check('SCREEN READER: exactly one is checked, None to begin with',
          a.cards.filter(function (c) { return c.checked === 'true'; }).map(function (c) { return c.id; }).join() === 'none' &&
          a.cards.every(function (c) { return c.checked === 'true' || c.checked === 'false'; }), a.cards.map(function (c) { return c.checked; }).join());
  s.check('FAMILY: the same hourglass as the character cards in every card, the sound beside it (nothing beside None)',
          a.cards.every(function (c) { return c.glass && c.marks === (c.id === 'none' ? 0 : 1); }), JSON.stringify(a.cards.map(function (c) { return [c.id, c.glass, c.marks]; })));
  s.check('ENGINE: every card is an ambience the engine has, under the same name, and every ambience has a card',
          a.cards.every(function (c) { return c.known && c.engineName === c.name; }) && a.engine.slice().sort().join() === IDS.slice().sort().join(), a.engine.join());

  // two rows of three, at the widths of small and large phones and lying down
  var SIZES = [[320, 568], [360, 740], [390, 844], [430, 932], [844, 390]];
  for (var i = 0; i < SIZES.length; i++) {
    var w = SIZES[i][0], h = SIZES[i][1];
    await t.page.setViewportSize({ width: w, height: h });
    await sleep(500);
    await openTune(t);
    var f = await t.eval(function () {
      function rects(sel) {
        return Array.prototype.slice.call(document.querySelectorAll(sel)).map(function (b) {
          var r = b.getBoundingClientRect(), sp = b.querySelector('span'), q = sp.getBoundingClientRect(), ic = b.querySelector('svg').getBoundingClientRect();
          return { l: Math.round(r.left * 2) / 2, t: Math.round(r.top * 2) / 2, w: Math.round(r.width * 2) / 2, h: Math.round(r.height * 2) / 2,
                   textIn: q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.bottom <= r.bottom + 0.5 && q.top >= ic.bottom - 0.5,
                   clipped: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1, lines: Math.round(q.height / parseFloat(getComputedStyle(sp).lineHeight || 14)),
                   icon: ic.width, vis: r.top >= 0 && r.bottom <= window.innerHeight };
        });
      }
      var body = window.__tune.scroller('#ambiences'), g = document.getElementById('ambiences').getBoundingClientRect();   // (what scrolls the cards: the sheet's body)
      return { amb: rects('#ambiences button'), chr: rects('#characters button'), over: body.scrollWidth - body.clientWidth, doc: document.documentElement.scrollWidth,
               w: window.innerWidth, group: [g.left, g.right], fs: getComputedStyle(document.querySelector('#ambiences button')).fontSize };
    });
    function uniq(k) { return f.amb.map(function (c) { return c[k]; }).filter(function (v, j, all) { return all.indexOf(v) === j; }); }
    var lefts = uniq('l'), tops = uniq('t'), ws = uniq('w'), hs = uniq('h');
    var grid = lefts.length === 3 && tops.length === 2 && f.amb[0].t === f.amb[2].t && f.amb[3].t === f.amb[5].t && f.amb[0].l === f.amb[3].l && f.amb[2].l === f.amb[5].l;
    var one = Math.max.apply(null, ws) - Math.min.apply(null, ws) <= 0.5 && hs.length === 1;
    var chH = f.chr.map(function (c) { return c.h; }).filter(function (v, j, all) { return all.indexOf(v) === j; });
    s.check('LAYOUT ' + w + '×' + h + ': two rows of three, cards of one size, as tall as the characters\' (and at least 44 px)',
            grid && one && chH.length === 1 && chH[0] === hs[0] && hs[0] >= 44 && Math.abs(f.chr[0].w - f.amb[0].w) <= 0.5,
            'cards ' + ws.join('/') + ' × ' + hs.join('/') + ' px (characters ' + f.chr[0].w + ' × ' + chH.join('/') + '), columns at ' + lefts.join(', ') + ', rows at ' + tops.join(', '));
    s.check('LAYOUT ' + w + '×' + h + ': no name clipped or outside its card, icons 34 px, nothing wider than the sheet',
            f.amb.every(function (c) { return c.textIn && !c.clipped && c.lines === 1 && Math.abs(c.icon - 34) < 0.5; }) && f.over <= 0 && f.doc <= f.w && f.group[0] >= 0 && f.group[1] <= f.w,
            'names ' + f.fs + ', one line each: ' + f.amb.every(function (c) { return c.lines === 1; }) + '; sheet overflow ' + f.over + ' px; group ' + f.group.map(Math.round).join('…') + ' of ' + f.w);
    await closeTune(t);
  }
  await t.page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);

  // choosing
  await openTune(t);
  var s0 = await state(t);
  s.check('NONE: checked, saved as nothing else, no level slider', s0.checked.join() === 'none' && (s0.saved === undefined || s0.saved === 'none') && s0.engine === 'none' && !s0.slider, JSON.stringify(s0));
  var seen = [];
  for (var k = 1; k < IDS.length; k++) {
    await t.page.tap('#ambiences button[data-ambience="' + IDS[k] + '"]');
    await sleep(350);
    var st = await state(t);
    seen.push(st);
    s.check(NAMES[k] + ': checked alone, saved, the engine told, the level slider shown',
            st.checked.join() === IDS[k] && st.saved === IDS[k] && st.engine === IDS[k] && st.slider, JSON.stringify(st));
  }
  // the last one chosen (Drips) survives a reload
  await closeTune(t);
  await t.reload();
  await sleep(600);
  var s1 = await state(t);
  s.check('RELOAD: Drips is still the one checked, and the engine starts with it', s1.checked.join() === 'drips' && s1.engine === 'drips' && s1.slider, JSON.stringify(s1));
  await openTune(t);
  await t.page.tap('#ambiences button[data-ambience="none"]');
  await sleep(350);
  var s2 = await state(t);
  s.check('NONE again: checked alone, saved, the slider hidden', s2.checked.join() === 'none' && s2.saved === 'none' && s2.engine === 'none' && !s2.slider, JSON.stringify(s2));
  s.check('no page or console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
  await t.close();
}

async function testRestore(s, env) {
  for (var k = 3; k < IDS.length; k++) {
    var t = await env.open({ motionStub: true, storage: { 'hourglass.settings.v1': { ambience: IDS[k], muted: true } } });
    await sleep(400);
    var st = await state(t);
    s.check('SAVED ' + IDS[k] + ': restored, checked alone, the engine has it', st.checked.join() === IDS[k] && st.engine === IDS[k] && st.slider && t.errors.length === 0, JSON.stringify(st) + ' ' + t.errors.slice(0, 2).join(' | '));
    await t.close();
  }
  var u = await env.open({ motionStub: true, storage: { 'hourglass.settings.v1': { ambience: 'lagoon', muted: true } } });
  await sleep(400);
  var su = await state(u);
  s.check('SAVED unknown id: falls back to None', su.checked.join() === 'none' && su.engine === 'none' && !su.slider && u.errors.length === 0, JSON.stringify(su));
  await u.close();
}

(async function () {
  var env = await H.start();
  var s = new H.Suite('app-ambience');
  try {
    await testCards(s, env);
    await testRestore(s, env);
  } catch (e) {
    s.check('the suite ran to its end', false, String(e && e.stack || e));
  }
  await env.close();
  s.done();
})();
