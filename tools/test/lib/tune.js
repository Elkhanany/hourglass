/*
 * Reaching a control of Tune, for every suite that taps one or measures one (development
 * only, not shipped).
 *
 * Tune is a sheet of tabs: a control lives in one tab's panel, and one panel shows at a time.
 * A suite names the control; the helper opens Tune if it is closed, shows the tab that holds
 * the control and brings the control into view. Which tab that is is read from the page: the
 * control's own [role="tabpanel"], and the [role="tab"] whose aria-controls names that panel
 * (or that the panel names in aria-labelledby). No suite, and nothing here, lists what is in
 * which tab, so a row moved to another tab, or a tab added, changes no test. A Tune without
 * tabs (the app before them: app-tune-trace --base and app-upgrade run such trees) is driven
 * the same way: the sheet opened, the control scrolled to.
 *
 *   var tune = require('./lib/tune.js');
 *   await tune.show(t, '#opt-tilt')           Tune open, the control's tab shown, the control in view
 *                                             -> { opened, tab } (what it had to do: tab is the tab's name, or null)
 *   await tune.tap(t, '#opt-tilt')            the same, then a finger on it (Playwright's tap)
 *   await tune.open(t), tune.close(t)         the Tune button, the close button; each waits for the sheet
 *   await tune.where(t, '#opt-tilt')          -> { found, inTune, open, panel, tab, name, shown }: nothing is touched
 *   await tune.tabs(t)                        -> the tabs as the page has them, each with its panel
 *   await tune.rest(t)                        the sheet has come to rest (it slides, and a tab may scroll)
 *   tune.pageSide                             the page's side (window.__tune), an init script: the browser
 *                                             harness gives it to every page; any call here adds it where it
 *                                             is missing. A suite's own code in the page may use it:
 *                                               __tune.where(sel)      as above
 *                                               __tune.scroller(el)    the element that scrolls a control of
 *                                                                      Tune (its tab's panel, or the sheet's body)
 *                                               __tune.tabs()          as above
 *
 * `t` is a page of the browser harness (stubs/harness.js) or a Playwright page.
 * opts of show and tap: { block: 'center' | 'start' | 'end' | 'nearest' } where the control is
 * brought to (default 'center'); { find: selector } for tap: the control whose tab is shown,
 * when the element tapped is not it.
 */
'use strict';

var SHEET = 'sheet-settings';

function pageOf(t) { return t && t.page ? t.page : t; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---- the page's side ------------------------------------------------------------------- */
function pageSide(sheetId) {
  'use strict';
  if (window.__tune) return;
  var T = window.__tune = { sheetId: sheetId || 'sheet-settings' };
  function sheet() { return document.getElementById(T.sheetId); }
  /** An element is drawn: it and everything above it has a box. */
  function drawn(el) { return !!el && el.getClientRects().length > 0; }
  /** A panel is the one shown: not hidden, and not put away by a style either (asked of the panel itself, so a closed sheet does not count against it). */
  function shown(panel) { return !!panel && !panel.hidden && getComputedStyle(panel).display !== 'none'; }
  function panelOf(el) {
    var s = sheet(), p = el && el.closest ? el.closest('[role="tabpanel"]') : null;
    return p && s && s.contains(p) ? p : null;
  }
  /** The tab of a panel: the one whose aria-controls names it, else the one it names in aria-labelledby. */
  function tabOf(panel) {
    var s = sheet(), tabs = s ? s.querySelectorAll('[role="tab"]') : [], i, by;
    for (i = 0; i < tabs.length; i++) if (panel.id && tabs[i].getAttribute('aria-controls') === panel.id) return tabs[i];
    by = panel.getAttribute('aria-labelledby');
    by = by ? document.getElementById(by) : null;
    return by && by.getAttribute('role') === 'tab' ? by : null;
  }
  T.isOpen = function () { var s = sheet(); return !!s && !s.hidden && s.classList.contains('open'); };
  /** Where a control is: in Tune or not, whether Tune is open, its panel, the tab that shows it (a selector) and whether it shows now. */
  T.where = function (sel) {
    var el = typeof sel === 'string' ? document.querySelector(sel) : sel, s = sheet();
    if (!el) return { found: false };
    var o = { found: true, inTune: !!s && s.contains(el), open: T.isOpen(), panel: null, tab: null, name: null, shown: true };
    var panel = o.inTune ? panelOf(el) : null, tab;
    if (!panel) return o;                              // not in Tune, in its head, or in a Tune without tabs
    o.panel = panel.id || '';
    o.shown = shown(panel);
    tab = tabOf(panel);
    if (tab) {
      o.tab = tab.id ? '#' + tab.id : '#' + T.sheetId + ' [role="tab"][aria-controls="' + panel.id + '"]';
      o.name = (tab.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return o;
  };
  /** The element that scrolls a control of Tune: its nearest ancestor that scrolls up and down (null outside one). */
  T.scroller = function (el) {
    if (typeof el === 'string') el = document.querySelector(el);
    for (var p = el ? el.parentElement : null; p && p !== document.documentElement; p = p.parentElement) {
      var oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll') return p;
    }
    return null;
  };
  /** Bring a control into view inside what scrolls it (its row with it, where it is in one). */
  T.intoView = function (sel, block) {
    var el = document.querySelector(sel);
    if (!el) return false;
    var row = el.closest ? el.closest('.row, .slider-row') : null;
    (row && T.scroller(row) === T.scroller(el) ? row : el).scrollIntoView({ block: block || 'center' });
    return true;
  };
  /** The tabs as the page has them, in order, each with its panel. */
  T.tabs = function () {
    var s = sheet(), list = s ? s.querySelector('[role="tablist"]') : null;
    return Array.prototype.map.call(s ? s.querySelectorAll('[role="tab"]') : [], function (tab) {
      var id = tab.getAttribute('aria-controls'), panel = id ? document.getElementById(id) : null, r = tab.getBoundingClientRect();
      return {
        id: tab.id, name: (tab.textContent || '').replace(/\s+/g, ' ').trim(), key: tab.getAttribute('data-tab') || '',
        tag: tab.tagName, type: tab.getAttribute('type'), selected: tab.getAttribute('aria-selected'), tabindex: tab.tabIndex,
        controls: id, inList: !!list && list.contains(tab), drawn: drawn(tab), box: [r.left, r.top, r.right, r.bottom],
        panel: panel ? { id: panel.id, role: panel.getAttribute('role'), labelledby: panel.getAttribute('aria-labelledby'),
                         hidden: panel.hidden, shown: shown(panel), drawn: drawn(panel), inTune: !!s && s.contains(panel) } : null
      };
    });
  };
  /**
   * Resolves once the sheet stands still: its box, the box of the panel shown and how far that
   * panel is scrolled have not changed for 150 ms (the sheet slides up and down, a tab scrolls).
   * Gives up after `ms` (default 3000) and says so: { still, open }.
   */
  T.rest = function (ms) {
    return new Promise(function (resolve) {
      var t0 = performance.now(), since = t0, last = '';
      (function tick() {
        var s = sheet(), now = performance.now(), key = 'none', i;
        if (s) {
          var r = s.getBoundingClientRect(), ps = s.querySelectorAll('[role="tabpanel"], .sheet-body');
          key = [s.hidden, s.className, r.top, r.height].join(' ');
          for (i = 0; i < ps.length; i++) if (drawn(ps[i])) { var q = ps[i].getBoundingClientRect(); key += ' ' + [q.top, q.height, ps[i].scrollTop].join(' '); }
        }
        if (key !== last) { last = key; since = now; }
        if (now - since >= 150) return resolve({ still: true, open: T.isOpen() });
        if (now - t0 > (ms || 3000)) return resolve({ still: false, open: T.isOpen() });
        setTimeout(tick, 30);
      })();
    });
  };
}

/** The page's side, added where a page does not have it yet (a page opened outside the harness, or loaded anew by a test of its own). */
async function ready(t) {
  var page = pageOf(t);
  await page.evaluate(pageSide, SHEET);
  return page;
}

async function where(t, sel) {
  var page = await ready(t);
  return page.evaluate(function (q) { return window.__tune.where(q); }, sel);
}
async function tabs(t) {
  var page = await ready(t);
  return page.evaluate(function () { return window.__tune.tabs(); });
}
async function isOpen(t) {
  var page = await ready(t);
  return page.evaluate(function () { return window.__tune.isOpen(); });
}
async function rest(t, ms) {
  var page = await ready(t);
  return page.evaluate(function (n) { return window.__tune.rest(n); }, ms || 0);
}

/** Tune opened by its button (a finger), unless it is open: resolves with whether it had to, once the sheet has come up. */
async function open(t) {
  var page = await ready(t);
  if (await page.evaluate(function () { return window.__tune.isOpen(); })) return false;
  await page.tap('#btn-settings');
  var r = await rest(t);
  if (!r.open) throw new Error('tune: the Tune button did not open the sheet');
  return true;
}

/** Tune closed by its close button, unless it is closed: resolves with whether it had to, once the sheet is gone. */
async function close(t) {
  var page = await ready(t);
  if (!(await page.evaluate(function () { return window.__tune.isOpen(); }))) return false;
  await page.tap('#' + SHEET + ' .sheet-close');
  await page.waitForFunction(function (id) { var s = document.getElementById(id); return !s || s.hidden; }, SHEET, { timeout: 5000 });
  await sleep(60);
  return true;
}

/**
 * A control of Tune made reachable, as a person makes it: Tune opened if it is closed, the tab
 * that holds the control tapped if another is showing, the control brought into view. For an
 * element that is not in Tune it does nothing. Resolves with what it had to do.
 */
async function show(t, sel, opts) {
  opts = opts || {};
  var page = await ready(t), did = { opened: false, tab: null };
  var w = await page.evaluate(function (q) { return window.__tune.where(q); }, sel);
  if (!w.found) throw new Error('tune: nothing in the page for ' + sel);
  if (!w.inTune) return did;
  if (!w.open) {
    did.opened = await open(t);
    w = await page.evaluate(function (q) { return window.__tune.where(q); }, sel);
  }
  if (!w.shown) {
    if (!w.tab) throw new Error('tune: the panel that holds ' + sel + ' (' + (w.panel || 'no id') + ') is hidden, and no tab shows it');
    await page.tap(w.tab);
    await page.waitForFunction(function (q) { return window.__tune.where(q).shown; }, sel, { timeout: 5000 }).catch(function () {
      throw new Error('tune: a tap on the tab ' + w.tab + ' did not show the panel that holds ' + sel);
    });
    did.tab = w.name;
  }
  await page.evaluate(function (a) { return window.__tune.intoView(a.sel, a.block); }, { sel: sel, block: opts.block || 'center' });
  await rest(t);
  return did;
}

/** show(), then a finger on the element (opts.find: the control whose tab is shown, when the element tapped is not it). */
async function tap(t, sel, opts) {
  opts = opts || {};
  var did = await show(t, opts.find || sel, opts);
  await pageOf(t).tap(sel);
  return did;
}

module.exports = {
  SHEET: SHEET, pageSide: pageSide, ready: ready,
  where: where, tabs: tabs, isOpen: isOpen, rest: rest, open: open, close: close, show: show, tap: tap
};
