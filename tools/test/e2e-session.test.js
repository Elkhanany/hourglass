/*
 * Integration E9 (session) and E10 (reset), against the real modules.
 *
 * E9   forceCrack(·, 40, 2), wait 1 s, reload: one crack, same segment,
 *      breach and seed, drawn on c-front as before; the timer's state and
 *      remaining time within 100 ms.
 * E10  after that crack has leaked and the sand reached the desk, Reset:
 *      within 0.8 s no cracks, no spill, a full new glass, nothing lost, and
 *      the crack's pixels are gone from c-front.
 *
 * The crack sits on the upper funnel's shoulder, where the sand is, so it
 * leaks at rest. Nothing turns, so the real WebGL glass is used: c-front
 * then holds only the caps and the cracks.
 *
 *   node tools/test/e2e-session.test.js [--root <dir>] [--port <n>]
 */
'use strict';
var H = require('./stubs/harness.js');
var S = require('./app-session.test.js');

(async function main() {
  S.CFG.stub = false;
  var s = new H.Suite('e2e-session (E9, E10)');
  var env = await H.start({ webgl: true });
  try {
    if (!env.caps.render) s.check('E9/E10 need the renderer (crack drawing and the spill)', false, 'not in ' + env.root);
    else await S.run(s, env, { seg: 6, leak: true });
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
