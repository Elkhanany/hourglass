/*
 * Integration E6 (hand gestures), E7 (Zen) and E8 (Reduce Motion), against
 * the real modules: the scenarios of app-gestures.test.js without the motion
 * stub, plus the checks that need the motion path:
 *   E6  MOVE: the sand slides while the glass is dragged; FLICK ≈ 9 rad/s:
 *       the top bulb's sand moves toward its dome by ≥ 15 cells; MEND: once
 *       sealed, nothing leaks; TAP still toggles
 *   E8  'veryVigSlow' for 15 s with Reduce Motion: no crack, no flight, no
 *       spray, no hops
 *
 *   node tools/test/e2e-gestures.test.js [--root <dir>] [--port <n>] [--only e6|e7|e8]
 */
'use strict';
var H = require('./stubs/harness.js');
var G = require('./app-gestures.test.js');

(async function main() {
  G.CFG.stub = false;
  G.CFG.e2e = true;
  var s = new H.Suite('e2e-gestures (E6, E7, E8)');
  var env = await H.start();
  var only = env.args.only;
  try {
    if (!env.caps.p1) s.check('E6–E8 need the motion path (physics-core P1)', false, 'the served sim is P0');
    else {
      if (!only || only === 'e6') {
        await G.testMove(s, env);
        await G.testTurn(s, env);
        await G.testFree(s, env);
        await G.testCatch(s, env);
        await G.testCatchMove(s, env);
        await G.testMend(s, env);
        await G.testTap(s, env);
      }
      if (!only || only === 'e7') await G.testZen(s, env);
      if (!only || only === 'e8') await G.testReduced(s, env);
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    await env.close();
  }
  s.done();
})();
