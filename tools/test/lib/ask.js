/*
 * A question to a page, with an end and a small answer. Development only, never shipped.
 *
 * A question to a page (page.evaluate) has no time limit of its own: a frame that is never drawn,
 * a picture that is never read back, would hang the run. Here each one ends after ASK_MS with an
 * error that says which question it was.
 *
 * And every value of an answer costs Playwright's protocol about 5 µs and 200 bytes of this
 * process's memory while it crosses (measured with 1.63: an array of a million numbers takes
 * 5.6 s and 190 MB). So an answer of more than ANSWER_MAX values is refused in the page, before it
 * crosses, with an error that says which question gave it: measure in the page, and send the
 * measure. (app-mode found both, in the test repair of 26 November; the harness's t.eval has
 * them for every suite.)
 *
 *   var ask = require('./lib/ask.js');
 *   ask.ask(page.evaluate.bind(page), fn, arg, { max, ms })
 *       fn(arg) in the page, awaited. o.max raises the count of values for this one question
 *       (where a suite truly needs it); o.ms the time.
 *   ask.within(ms, what, promise), ask.smallAnswer(fn, arg, max)   the two parts
 */
'use strict';

var ASK_MS = 30000, ANSWER_MAX = 20000;

/** What `p` gives or, after `ms`, an error that says what did not come. */
function within(ms, what, p) {
  var timer, late = new Promise(function (_, fail) { timer = setTimeout(function () { fail(new Error(what + ': nothing after ' + ms / 1000 + ' s')); }, ms); });
  return Promise.race([p, late]).finally(function () { clearTimeout(timer); });
}

/**
 * In the page: fn(arg), awaited, and its answer counted there (every number, string, array and
 * object of it; a typed array is one, since it crosses as one string): over `max` values it is
 * not sent.
 */
function smallAnswer(fn, arg, max) {
  return Promise.resolve(fn(arg)).then(function (v) {
    var n = 0, todo = [v], seen = new Set(), x, k;
    while (todo.length && n + todo.length <= max) {
      x = todo.pop(); n++;
      if (!x || typeof x !== 'object' || ArrayBuffer.isView(x) || seen.has(x)) continue;
      seen.add(x);
      if (Array.isArray(x)) { if (n + todo.length + x.length > max) { n += x.length; break; } for (k = 0; k < x.length; k++) todo.push(x[k]); }
      else for (k in x) todo.push(x[k]);
    }
    if (n + todo.length > max) throw new Error('the answer holds more than ' + max + ' values (' + (n + todo.length) + ' at the least): measure in the page and send the measure');
    return v;
  });
}

/** The question's name in an error: the start of its function. */
function named(fn) { return 'a page was asked (' + String(fn).replace(/\s+/g, ' ').slice(0, 72) + ' ...)'; }

/**
 * fn(arg) in the page through `evaluate` (a page's own page.evaluate, bound), within o.ms (ASK_MS)
 * and with an answer of at most o.max values (ANSWER_MAX). A function goes as the text of one that
 * calls it through smallAnswer, and its argument as Playwright sends any (handles too); a string
 * is asked as it is, with the time limit only. An error from the page is passed on as it came,
 * but for the refused answer, which is named.
 */
function ask(evaluate, fn, arg, o) {
  o = o || {};
  var what = named(fn), ms = o.ms || ASK_MS, max = o.max || ANSWER_MAX;
  var q = typeof fn !== 'function' ? evaluate(fn, arg) :
    evaluate(new Function('a', 'return (' + String(smallAnswer) + ')((' + String(fn) + '), a, ' + max + ');'), arg);
  return within(ms, what, q).catch(function (e) {
    var said = String(e && e.message || e);
    if (said.indexOf('the answer holds more than') >= 0 && said.indexOf(what) < 0) throw new Error(what + ': ' + said.split('\n')[0]);
    throw e;
  });
}

module.exports = { ASK_MS: ASK_MS, ANSWER_MAX: ANSWER_MAX, within: within, smallAnswer: smallAnswer, ask: ask, named: named };
