/*
 * audio-motion acceptance 6, 7, 9 and 10: the new audio API in Chromium.
 *
 *   6. API smoke, in the real app: every new method is a safe no-op before
 *      the first tap and schedules nodes after it; update() with every new
 *      field, fed through the app's own frame loop at 60 Hz for 5 s, throws
 *      nothing, and the live AudioNode count (Chrome DevTools' WebAudio
 *      domain, after a forced GC) is back to its baseline 2 s later
 *   7. rate limits: thump ≤ 1 per bulb per 60 ms, clack ≤ 12/s and ≥ 70 ms
 *      apart, creak ≤ 1 per 300 ms, crackGrow ≤ 4/s, leak pats ≤ 40/s,
 *      desk pats ≤ 20/s
 *   9. voicing: setCracked() moves the modal bank's frequencies and Q, read
 *      back from the BiquadFilters after 1 s; 'intact' restores them; the
 *      state survives setCharacter() and is applied by _build when set
 *      before the context exists
 *  10. hush() takes the agitation shimmer and the trickle to zero within
 *      0.5 s (on a page with no frame loop of its own, so nothing but hush()
 *      can be what silenced them); hold() drops the agitation floor too
 *
 * The water ambiences (Ocean, Waterfall, Drips):
 *  11. in the real app: each starts when chosen (every layer a looping
 *      source, the bus open, its audition counted from the moment it sounds);
 *      2.6 s after the next is chosen the one before holds nothing (no
 *      buffers, arrays or work under way; its AudioBuffers are collected);
 *      chosen again once silent it plays again from its cue; one chosen while
 *      another is being made abandons that one; None stops it and the live
 *      AudioNode count is back where it was
 *  12. synthesis as the app runs it (_synthAmbience), on fresh pages (cold
 *      code): slices within about 8 ms, at most 8 MB of PCM
 *  13. a browser that refuses AudioBuffers below 22.05 kHz (older WebKit),
 *      live: all three still play, at the least whole multiple of each rate
 *
 *   node tools/test/audio-api.test.js [port]      (default 8803)
 */
'use strict';
var path = require('path');
var chromium = require('playwright').chromium;
var Server = require('./lib/static-server.js');

var ROOT = path.resolve(__dirname, '..', '..');
var PORT = +(process.argv[2] || process.env.PORT || 8803);
var BASE = 'http://127.0.0.1:' + PORT;

var failures = 0, cases = 0;
function report(ok, name, detail) {
  cases++;
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** Largest number of times in any window of `w` seconds. */
function maxInWindow(times, w) {
  var t = times.slice().sort(function (a, b) { return a - b; }), best = 0, j = 0;
  for (var i = 0; i < t.length; i++) {
    while (t[i] - t[j] >= w) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}
function minGap(times) {
  var t = times.slice().sort(function (a, b) { return a - b; }), g = Infinity;
  for (var i = 1; i < t.length; i++) g = Math.min(g, t[i] - t[i - 1]);
  return g;
}

var NEW_CALLS = [
  ['thump', [0.5, 0.2, 1]], ['clack', [0.5, -0.3]], ['creak', [3, 0.4]], ['crack', [-0.5]], ['crackGrow', [0.2]],
  ['chip', [0.6]], ['catchThud', []], ['mendHum', [0.5]], ['mendHum', [0]], ['mended', []], ['newGlass', []],
  ['setCracked', ['mended']], ['setCracked', ['intact']]
];

async function main() {
  var server = await new Promise(function (res, rej) {
    var s = Server.start(PORT, ROOT, function () { res(s); });
    s.on('error', rej);
  });
  var browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    var page = await ctx.newPage();
    var errors = [];
    page.on('pageerror', function (e) { errors.push(e.message); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });

    // live AudioNodes, from DevTools' WebAudio domain (destroyed once collected)
    var cdp = await ctx.newCDPSession(page);
    var created = 0, destroyed = 0;
    cdp.on('WebAudio.audioNodeCreated', function () { created++; });
    cdp.on('WebAudio.audioNodeWillBeDestroyed', function () { destroyed++; });
    await cdp.send('WebAudio.enable');
    await cdp.send('HeapProfiler.enable');
    async function liveNodes() {
      await cdp.send('HeapProfiler.collectGarbage');
      await sleep(300);
      await cdp.send('HeapProfiler.collectGarbage');
      await sleep(300);
      return created - destroyed;
    }

    await page.goto(BASE + '/');
    await page.waitForFunction(function () { return window.Hourglass && window.Hourglass.audio; });
    await sleep(500);

    /* ---- 6a. before the first tap ------------------------------------------ */
    var pre = await page.evaluate(function (calls) {
      var a = window.Hourglass.audio, errs = [];
      calls.forEach(function (c) { try { a[c[0]].apply(a, c[1]); } catch (e) { errs.push(c[0] + ': ' + e.message); } });
      try {
        a.update({ dt: 1 / 60, flow: 0, impacts: 0, tail: 1, fill: 0.2, bottom: 0, slides: 0, agit: 2, rushPan: 0.3,
                   thump: new Float32Array([0.5, 0, 0.4, 0]), slam: new Float32Array([0.5, 0]), leak: 30, leakPan: 0.2, spillPats: 10 });
      } catch (e) { errs.push('update: ' + e.message); }
      try { a.hush(); a.hold(10, 1); } catch (e) { errs.push('hush/hold: ' + e.message); }
      a.setCracked('cracked');                     // kept, and applied once the graph is built
      return { errs: errs, ready: a.ready, ctx: !!a.ctx, state: a.cracked };
    }, NEW_CALLS);
    report(pre.errs.length === 0 && !pre.ready && !pre.ctx && pre.state === 'cracked', 'every new method is a no-op before the first tap',
           (pre.errs.join('; ') || 'no throw') + ', ready ' + pre.ready + ', context ' + pre.ctx + ', state kept: ' + pre.state);

    /* ---- the first tap unlocks the audio (it also starts the glass: pause it) - */
    var box = await page.locator('#stage').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(function () { var a = window.Hourglass.audio; return a.ready && a.ctx.state === 'running'; });
    await page.evaluate(function () { if (window.Hourglass.timer.state === 'running') window.Hourglass.pause(); });
    await sleep(1200);
    var built = await page.evaluate(function () {
      var a = window.Hourglass.audio, worst = 0;
      for (var i = 0; i < a.modes.length; i++) {
        var want = a._modes[i][1] * 0.6;
        worst = Math.max(worst, Math.abs(a.modes[i].Q.value / want - 1));
      }
      return { worst: worst, state: a.cracked };
    });
    report(built.state === 'cracked' && built.worst < 0.005, 'setCracked() before the context exists is applied when the graph is built',
           'Q ×0.6 within ' + (built.worst * 100).toFixed(2) + ' %');
    await page.evaluate(function () { window.Hourglass.audio.setCracked('intact'); });

    /* ---- 6b. after it: each new method schedules nodes, without throwing ------- */
    var smoke = [];
    for (var i = 0; i < NEW_CALLS.length; i++) {
      var c0 = created;
      var err = await page.evaluate(function (c) {
        var a = window.Hourglass.audio;
        try { a[c[0]].apply(a, c[1]); return ''; } catch (e) { return e.message; }
      }, NEW_CALLS[i]);
      await sleep(120);
      smoke.push({ call: NEW_CALLS[i][0] + '(' + NEW_CALLS[i][1].join(', ') + ')', nodes: created - c0, err: err });
    }
    var silent = { 'mendHum(0)': 1, 'setCracked(mended)': 1, 'setCracked(intact)': 1 };
    var smokeOk = smoke.every(function (s) { return !s.err && (silent[s.call] ? true : s.nodes > 0); });
    report(smokeOk, 'after the tap every new method schedules nodes, without throwing',
           smoke.map(function (s) { return s.call + ' +' + s.nodes + (s.err ? ' THREW ' + s.err : ''); }).join(', '));

    /* ---- 6c. update() with every new field, 60 Hz, 5 s, through the app's own loop */
    await sleep(7000);                               // the smoke test's bell rings for 5 s
    var base0 = await liveNodes();
    await page.evaluate(function () {
      var a = window.Hourglass.audio, orig = a.update, zero = new Float32Array(4);
      var inj = window.__inj = { on: true, k: 0, errs: [], frames: 0, thumps: 0, clacks: 0, leaks: 0, spills: 0 };
      var thA = a._thumpAt, clA = a._clackAt, lp = a._leakPat, sp = a._spillPat;
      a._thumpAt = function () { inj.thumps++; return thA.apply(this, arguments); };
      a._clackAt = function () { inj.clacks++; return clA.apply(this, arguments); };
      a._leakPat = function () { inj.leaks++; return lp.apply(this, arguments); };
      a._spillPat = function () { inj.spills++; return sp.apply(this, arguments); };
      a.update = function (st) {
        if (inj.on) {
          var k = inj.k++;
          inj.frames++;
          st.agit = 1.5 + Math.sin(k / 30);
          st.rushPan = 0.8 * Math.sin(k / 25);
          st.slides = 60000;                       // so the rush (and its pan) sounds
          st.thump = k % 6 === 0 ? new Float32Array([0.3, 0.4, 0.2, -0.5]) : zero;
          st.slam = k % 5 === 0 ? new Float32Array([0.4, -0.6]) : null;
          st.leak = 25; st.leakPan = -0.4; st.spillPats = 12;
        }
        try { return orig.call(this, st); } catch (e) { inj.errs.push(e.message); throw e; }
      };
    });
    var peakNodes = 0;
    for (var s5 = 0; s5 < 10; s5++) { await sleep(500); peakNodes = Math.max(peakNodes, created - destroyed); }
    var inj = await page.evaluate(function () {
      var i = window.__inj;
      i.on = false;
      var a = window.Hourglass.audio;
      return { frames: i.frames, errs: i.errs, thumps: i.thumps, clacks: i.clacks, leaks: i.leaks, spills: i.spills, rpan: a.rPan.pan ? a.rPan.pan.value : null };
    });
    await sleep(2000);
    var after = await liveNodes();
    report(inj.errs.length === 0 && inj.frames >= 270 && inj.thumps > 0 && inj.clacks > 0 && inj.leaks > 0 && inj.spills > 0,
           'update() with every new field at 60 Hz for 5 s',
           inj.frames + ' frames, no throw: ' + (inj.errs.length === 0) + '; played ' + inj.thumps + ' thumps, ' + inj.clacks + ' clacks, ' +
           inj.leaks + ' leak pats, ' + inj.spills + ' desk pats');
    report(after <= base0 + 10, 'live AudioNodes back to baseline within 2 s afterwards',
           'baseline ' + base0 + ', during up to ' + peakNodes + ', 2 s after ' + after);

    /* ---- 7. rate limits ------------------------------------------------------------ */
    var rl = await page.evaluate(function () {
      var a = window.Hourglass.audio, orig = a.update, log = { thump: [[], []], clack: [], creak: [], grow: [], leak: [], spill: [] };
      var bulb = 0, th = a.thump, thA = a._thumpAt, clA = a._clackAt, sp1 = a._spaced, lp = a._leakPat, sp = a._spillPat, gr = a._growHead;
      // Log the times the limiters themselves decided on: Chrome's currentTime
      // can move on by a render quantum within one task, so a second read here
      // could be later than the one the limiter used.
      a.thump = function (E, pan, b) { bulb = b ? 1 : 0; return th.apply(this, arguments); };
      a._thumpAt = function (when) { log.thump[bulb].push(when); return thA.apply(this, arguments); };
      a._clackAt = function (when) { log.clack.push(when); return clA.apply(this, arguments); };
      a._spaced = function (key) { var ok = sp1.apply(this, arguments); if (ok && key === 'creak') log.creak.push(a._last1.creak); return ok; };
      a._leakPat = function (when) { log.leak.push(when); return lp.apply(this, arguments); };
      a._spillPat = function (when) { log.spill.push(when); return sp.apply(this, arguments); };
      var full = new Float32Array([0.6, 0.1, 0.6, -0.1]), slam = new Float32Array([0.6, 0]);
      a.update = function (st) {
        st.thump = full; st.slam = slam; st.leak = 400; st.leakPan = 0.3; st.spillPats = 200;
        return orig.call(this, st);
      };
      return new Promise(function (resolve) {
        var n = 0;
        var id = setInterval(function () {
          a.creak(4, 0);                             // every 25 ms
          var h0 = a._growHead;
          a.crackGrow(0);
          if (a._growHead !== h0) log.grow.push(a._growT[h0]);
          if (++n >= 120) {                          // 3 s
            clearInterval(id);
            a.update = orig; a.thump = th; a._thumpAt = thA; a._clackAt = clA; a._spaced = sp1; a._leakPat = lp; a._spillPat = sp;
            resolve(log);
          }
        }, 25);
      });
    });
    var g0 = minGap(rl.thump[0]), g1 = minGap(rl.thump[1]);
    report(rl.thump[0].length > 10 && rl.thump[1].length > 10 && g0 >= 0.06 - 1e-6 && g1 >= 0.06 - 1e-6, 'thump ≤ 1 per bulb per 60 ms',
           'asked every frame for 3 s: ' + rl.thump[0].length + ' / ' + rl.thump[1].length + ' played, closest ' + (g0 * 1000).toFixed(1) + ' / ' + (g1 * 1000).toFixed(1) + ' ms');
    var cw = maxInWindow(rl.clack, 1), cg = minGap(rl.clack);
    report(rl.clack.length > 10 && cw <= 12 && cg >= 0.07 - 1e-6, 'clack ≤ 12/s and ≥ 70 ms apart',
           rl.clack.length + ' played in 3 s, most in any second ' + cw + ', closest ' + (cg * 1000).toFixed(1) + ' ms');
    var kg = minGap(rl.creak);
    report(rl.creak.length >= 8 && kg >= 0.3 - 1e-6, 'creak ≤ 1 per 300 ms', rl.creak.length + ' played of 120 asked, closest ' + (kg * 1000).toFixed(1) + ' ms');
    var gw = maxInWindow(rl.grow, 1);
    report(rl.grow.length >= 8 && gw <= 4, 'crackGrow ≤ 4/s', rl.grow.length + ' played of 120 asked, most in any second ' + gw);
    var lw = maxInWindow(rl.leak, 1), lrate = rl.leak.length / 3;
    report(lw <= 40 && rl.leak.length > 60, 'leak pats ≤ 40/s (asked 400/s)', rl.leak.length + ' in 3 s (' + lrate.toFixed(1) + '/s), most in any second ' + lw);
    var sw = maxInWindow(rl.spill, 1);
    report(sw <= 20 && rl.spill.length > 30, 'desk pats ≤ 20/s (asked 200/s)', rl.spill.length + ' in 3 s, most in any second ' + sw);

    /* ---- 9. voicing ------------------------------------------------------------------ */
    async function voicing(state, wait) {
      if (state) await page.evaluate(function (s) { window.Hourglass.audio.setCracked(s); }, state);
      await sleep(wait);
      return page.evaluate(function () {
        var a = window.Hourglass.audio, worstF = 0, worstQ = 0, fr = [];
        var v = { intact: [1, 1], cracked: [0.97, 0.6], mended: [0.99, 0.85] }[a.cracked];
        for (var i = 0; i < a.modes.length; i++) {
          var m = a._modes[i], f = a.modes[i].frequency.value, q = a.modes[i].Q.value;
          var wantF = m[0] * (1 + m[3] * a._fill) * v[0], wantQ = m[1] * v[1];
          worstF = Math.max(worstF, Math.abs(f / wantF - 1));
          worstQ = Math.max(worstQ, Math.abs(q / wantQ - 1));
          fr.push(+(f / (m[0] * (1 + m[3] * a._fill))).toFixed(4) + '/' + +(q / m[1]).toFixed(3));
        }
        return { state: a.cracked, worstF: worstF, worstQ: worstQ, ratios: fr, first: a._modes[0][0] };
      });
    }
    function vshow(v) { return v.state + ': f×/Q× ' + v.ratios.slice(0, 3).join(' ') + ' …, worst ' + (v.worstF * 100).toFixed(2) + ' % / ' + (v.worstQ * 100).toFixed(2) + ' %'; }
    var v1 = await voicing('cracked', 1000);
    report(v1.worstF < 0.003 && v1.worstQ < 0.003, "setCracked('cracked'): frequencies ×0.97, Q ×0.6 after 1 s", vshow(v1));
    var v2 = await voicing('intact', 1000);
    report(v2.worstF < 0.003 && v2.worstQ < 0.003, "setCracked('intact') restores them", vshow(v2));
    var v3 = await voicing('mended', 1000);
    report(v3.worstF < 0.003 && v3.worstQ < 0.003, "setCracked('mended'): ×0.99 and ×0.85", vshow(v3));
    await page.evaluate(function () { window.Hourglass.audio.setCracked('cracked'); window.Hourglass.audio.setCharacter('chime'); });
    var v4 = await voicing(null, 2500);
    report(v4.first === 587.3 && v4.state === 'cracked' && v4.worstF < 0.005 && v4.worstQ < 0.005, 'the state survives setCharacter()',
           'Singing Glass modes (first ' + v4.first + ' Hz), ' + vshow(v4));
    await page.evaluate(function () { window.Hourglass.audio.setCharacter('asmr'); window.Hourglass.audio.setCracked('intact'); });

    /* ---- 10. hush() and hold(), on a page with no frame loop of its own --------------- */
    var page2 = await ctx.newPage();
    page2.on('pageerror', function (e) { errors.push('hush page: ' + e.message); });
    await page2.route(BASE + '/__hush.html', function (r) {
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
        '<button id="go" style="width:300px;height:200px">go</button><script src="/audio.js"></script>' +
        '<script>window.a = new HourglassAudio(); document.getElementById("go").addEventListener("click", function () { window.a.unlock(); });</script>' });
    });
    await page2.goto(BASE + '/__hush.html');
    await page2.tap('#go');
    await page2.waitForFunction(function () { return window.a.ready && window.a.ctx.state === 'running'; });
    await sleep(600);
    async function hushTrial(how) {
      return page2.evaluate(function (how) {
        var a = window.a, pats = [];
        var lp = a._leakPat, sp = a._spillPat;
        a._leakPat = function (when) { pats.push(when); return lp.apply(this, arguments); };
        a._spillPat = function (when) { pats.push(when); return sp.apply(this, arguments); };
        a._cushion = 0.46;                             // some sand below: both textures
        return new Promise(function (resolve) {
          var n = 0;
          var id = setInterval(function () {
            a.update({ dt: 1 / 60, flow: 0, impacts: 0, tail: 1, fill: 0.3, bottom: 300, slides: 0, agit: 2, leak: 30, leakPan: 0.3, spillPats: 15 });
            if (++n < 120) return;                     // 2 s of shaking and leaking
            clearInterval(id);
            var t0 = a.ctx.currentTime, before = [a.patEnv.gain.value, a.tinkEnv.gain.value], npats = pats.length;
            if (how === 'hush') a.hush();
            else if (how === 'hold') a.hold(0, 0);
            setTimeout(function () {
              var mid = [a.patEnv.gain.value, a.tinkEnv.gain.value];
              setTimeout(function () {
                var late = pats.filter(function (w) { return w > t0 + 0.025; }).length;
                a._leakPat = lp; a._spillPat = sp;
                resolve({ before: before, at05: mid, at15: [a.patEnv.gain.value, a.tinkEnv.gain.value], patsBefore: npats, patsAfter: late });
              }, 1000);
            }, 500);
          }, 1000 / 60);
        });
      }, how);
    }
    var hz = await hushTrial('hush');
    var hzOk = hz.before[0] > 0.1 && hz.before[1] > 0.1 && hz.at05[0] <= 0.02 * hz.before[0] && hz.at05[1] <= 0.02 * hz.before[1] && hz.patsBefore > 40 && hz.patsAfter === 0;
    report(hzOk, 'hush(): agitation shimmer and trickle at 0 within 0.5 s',
           'textures ' + hz.before.map(function (v) { return v.toFixed(3); }).join('/') + ' → ' + hz.at05.map(function (v) { return v.toFixed(4); }).join('/') +
           ' at 0.5 s; ' + hz.patsBefore + ' pats before, ' + hz.patsAfter + ' scheduled after');
    var ctl = await hushTrial('none');
    report(ctl.at05[0] > 0.5 * ctl.before[0], 'control: without hush() the shimmer would have stayed',
           'textures ' + ctl.before.map(function (v) { return v.toFixed(3); }).join('/') + ' → ' + ctl.at05.map(function (v) { return v.toFixed(3); }).join('/') + ' at 0.5 s');
    var hd = await hushTrial('hold');
    report(hd.at15[0] <= 0.02 * hd.before[0] && hd.at15[1] <= 0.02 * hd.before[1] && hd.patsAfter === 0, 'hold(): the agitation floor goes too (page hidden)',
           'textures → ' + hd.at15.map(function (v) { return v.toFixed(4); }).join('/') + ' at 1.5 s; ' + hd.patsAfter + ' pats after');
    var hum = await page2.evaluate(function () {
      var a = window.a;
      a.mendHum(0.8);
      return new Promise(function (resolve) {
        setTimeout(function () {
          var on = a._hum ? a._hum.g.gain.value : -1;
          a.hush();
          setTimeout(function () { resolve({ on: on, after: a._hum }); }, 600);
        }, 600);
      });
    });
    report(hum.on > 0 && hum.after === null, 'hush() also ends a mend hum', 'hum gain ' + hum.on.toFixed(4) + ' → stopped');

    /* ---- 11. the water ambiences, in the real app ------------------------------------- */
    await page.bringToFront();
    var NEW_AMB = ['ocean', 'waterfall', 'drips'];
    var ambBase = await liveNodes();
    /** Choose an ambience as the settings do and wait until it sounds. */
    async function choose(id) {
      await page.evaluate(function (id) {
        var a = window.Hourglass.audio, st = a._startAmbience;
        window.__amb = { asked: performance.now() };
        a._startAmbience = function () {
          var r = st.apply(this, arguments), w = window.__amb;
          if (this._amb && this._amb.id === id && !w.started) { w.started = performance.now(); w.preview = this._ambPreview - this.ctx.currentTime; }
          return r;
        };
        // what it holds now, to see it let go later
        window.__held = []; window.__heldId = a._amb ? a._amb.id : null;
        if (a._amb) a._ambBuf[a._amb.id].forEach(function (b) { window.__held.push(new WeakRef(b)); });
        a.setAmbience(id, true);
        window.__restore = function () { a._startAmbience = st; };
      }, id);
      if (id !== 'none') await page.waitForFunction(function () { return !!window.__amb.started; }, null, { timeout: 15000 });
      await sleep(1500);
      return page.evaluate(function (id) {
        var a = window.Hourglass.audio, d = window.HourglassAudio.AMBIENCES[id], w = window.__amb;
        window.__restore();
        return { playing: a._amb ? a._amb.id : null, wait: (w.started - w.asked) / 1000, preview: w.preview, audition: d.audition || 5,
                 layers: d.layers ? d.layers.length : 0, srcs: a._amb ? a._amb.srcs.length : 0,
                 loops: a._amb ? a._amb.srcs.every(function (s) { return s.loop && s.buffer; }) : false,
                 rates: a._amb ? a._amb.srcs.map(function (s) { return s.buffer.sampleRate; }) : [],
                 bus: a.ambBus.gain.value, gain: a._ambGain() };
      }, id);
    }
    /** 2.6 s later (the one before has faded and been let go): what is held, and what of the earlier one's buffers is still alive. */
    async function held() {
      await sleep(2600);
      var n = await liveNodes();
      var h = await page.evaluate(function () {
        var a = window.Hourglass.audio, bytes = 0, k;
        for (k in a._ambBuf) a._ambBuf[k].forEach(function (b) { bytes += b.length * b.numberOfChannels * 4; });
        return { buf: Object.keys(a._ambBuf), raw: Object.keys(a._ambRaw), jobs: Object.keys(a._ambJobs), bytes: bytes,
                 was: window.__heldId, alive: window.__held.filter(function (r) { return r.deref() !== undefined; }).length, of: window.__held.length };
      });
      h.nodes = n;
      return h;
    }
    var prev = null;
    for (var ai = 0; ai < NEW_AMB.length; ai++) {
      var aid = NEW_AMB[ai], st = await choose(aid);
      report(st.playing === aid && st.srcs === st.layers && st.loops && st.bus > 0.3 * st.gain && Math.abs(st.preview - st.audition) < 0.05,
             aid + ' starts when chosen: every layer looping, heard, its audition counted from then',
             st.srcs + ' of ' + st.layers + ' loops at ' + st.rates.join('/') + ' Hz, ' + st.wait.toFixed(2) + ' s after the tap; audition ' +
             st.preview.toFixed(2) + ' s from then (' + st.audition + '); bus at ' + st.bus.toFixed(3) + ' of ' + st.gain.toFixed(3) + ' after 1.5 s');
      var h = await held();
      report(h.buf.join() === aid && !h.raw.length && !h.jobs.length && h.bytes <= 8e6 && h.alive === 0,
             aid + ' is the only ambience holding sound' + (prev ? ' (' + prev + ' let go)' : ''),
             'buffers: ' + h.buf.join() + ' (' + (h.bytes / 1e6).toFixed(2) + ' MB), arrays: ' + (h.raw.join() || 'none') + ', being made: ' + (h.jobs.join() || 'none') +
             (h.of ? '; ' + h.alive + ' of ' + h.of + ' buffers of ' + h.was + ' still alive after a collection' : ''));
      prev = aid;
    }
    // chosen again while it is silent: once more from its cue, with a whole audition
    await sleep(Math.max(0, 9000 - 4100) + 3500);                    // the drips' audition and its fade are over
    var again = await page.evaluate(function () {
      var a = window.Hourglass.audio, before = a._amb.srcs[0], quiet = a.ambBus.gain.value, t = a.ctx.currentTime;
      a.setAmbience('drips', true);
      return new Promise(function (resolve) {
        setTimeout(function () { resolve({ quiet: quiet, fresh: a._amb.srcs[0] !== before, preview: a._ambPreview - t, id: a._amb.id }); }, 200);
      });
    });
    report(again.quiet < 0.02 && again.fresh && again.id === 'drips' && Math.abs(again.preview - 9) < 0.3, 'chosen again once silent, it is heard again from its cue',
           'bus was at ' + again.quiet.toFixed(4) + '; new sources: ' + again.fresh + '; audition ' + again.preview.toFixed(2) + ' s');
    // another one chosen while the first is still being made: the first is abandoned
    var race = await page.evaluate(function () {
      var a = window.Hourglass.audio;
      a.setAmbience('ocean', true);
      return new Promise(function (resolve) {
        setTimeout(function () {
          var mid = Object.keys(a._ambJobs).join();
          a.setAmbience('waterfall', true);
          var after = Object.keys(a._ambJobs).join();
          (function wait() {
            if (!a._amb || a._amb.id !== 'waterfall') { setTimeout(wait, 50); return; }
            setTimeout(function () {
              resolve({ mid: mid, after: after, playing: a._amb.id, buf: Object.keys(a._ambBuf).join(), raw: Object.keys(a._ambRaw).join(), jobs: Object.keys(a._ambJobs).join() });
            }, 2600);
          })();
        }, 300);
      });
    });
    report(race.mid === 'ocean' && race.after === 'waterfall' && race.playing === 'waterfall' && race.buf === 'waterfall' && !race.raw && !race.jobs,
           'another one chosen while the first is being made: the first is abandoned',
           'being made: ' + race.mid + ' → ' + race.after + '; then playing ' + race.playing + ', holding ' + race.buf + (race.raw ? ', arrays ' + race.raw : ''));
    // None: everything stops and nothing is left behind
    await choose('none');
    var gone = await held();
    var off = await page.evaluate(function () { var a = window.Hourglass.audio; return { amb: a._amb, bus: a.ambBus.gain.value }; });
    report(off.amb === null && !gone.buf.length && !gone.raw.length && !gone.jobs.length && gone.alive === 0 && gone.nodes <= ambBase + 4,
           'None: it stops, lets its sound go and leaves no nodes behind',
           'holding ' + (gone.buf.join() || 'nothing') + '; ' + gone.alive + ' of ' + gone.of + ' buffers alive; live AudioNodes ' + gone.nodes + ' (before the ambiences ' + ambBase + ')');

    /* ---- 12. synthesis slices, as the app runs them, on fresh pages (cold code) -------- */
    await page.route(BASE + '/__amb.html', function (r) {
      r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="/audio.js"></script>' });
    });
    for (var si = 0; si < NEW_AMB.length; si++) {
      var runs = [];
      for (var rep = 0; rep < 3; rep++) {
        await page.goto(BASE + '/__amb.html');
        runs.push(await page.evaluate(function (id) {
          var A = window.HourglassAudio, a = new A(), d = A.AMBIENCES[id], slices = [];
          function timed(f) {
            return function () {
              var t = performance.now(), r = f.apply(this, arguments);
              slices.push(performance.now() - t);
              return typeof r === 'function' ? timed(r) : r;
            };
          }
          d.layers.forEach(function (L) { L.make = timed(L.make); });
          return new Promise(function (resolve) {
            var t0 = performance.now();
            a._synthAmbience(id, function () {
              var s = slices.slice().sort(function (x, y) { return x - y; }), bytes = 0;
              a._ambRaw[id].forEach(function (lr) { bytes += (lr[0].length + lr[1].length) * 4; });
              resolve({ n: s.length, total: s.reduce(function (p, q) { return p + q; }, 0), p50: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)],
                        max: s[s.length - 1], over: s.filter(function (v) { return v > 8; }).length, wall: (performance.now() - t0) / 1000, bytes: bytes });
            });
          });
        }, NEW_AMB[si]));
      }
      // A slice is cut by the clock (or by its size), but a step that is running is not interrupted: on
      // cold code a single one can be held up by the compiler or the collector, and on a shared machine
      // by its neighbours. So: nearly all slices within 8 ms in every run; the longest within 8 ms in the
      // quietest run (what the code itself does) and within one frame at 60 Hz in the median run.
      var mx = runs.map(function (r) { return r.max; }).sort(function (x, y) { return x - y; });
      report(runs.every(function (r) { return r.p95 <= 8 && r.bytes <= 8e6; }) && mx[0] <= 8 && mx[1] <= 16.7,
             NEW_AMB[si] + ' is made in short slices: 95 % within 8 ms in each of 3 cold runs; the longest within 8 ms in the quietest run, within a frame (16.7 ms) in the median one',
             runs.map(function (r) {
               return r.n + ' slices, ' + r.total.toFixed(0) + ' ms in all, median ' + r.p50.toFixed(1) + ', p95 ' + r.p95.toFixed(1) + ', longest ' + r.max.toFixed(1) +
                      ' ms (' + r.over + ' over 8), ready in ' + r.wall.toFixed(2) + ' s';
             }).join(' | ') + '; ' + (runs[0].bytes / 1e6).toFixed(2) + ' MB of PCM');
    }

    /* ---- 13. a browser that refuses low sample rates (older WebKit), live ------------- */
    await page2.bringToFront();
    var low = await page2.evaluate(function () {
      var a = window.a, P = (window.BaseAudioContext || window.AudioContext).prototype, make = P.createBuffer, refused = [];
      P.createBuffer = function (c, n, sr) {
        if (sr < 22050) { refused.push(sr); throw new DOMException('sample rate', 'NotSupportedError'); }
        return make.apply(this, arguments);
      };
      return new Promise(function (resolve) {
        var out = {}, list = ['ocean', 'waterfall', 'drips'], k = 0;
        (function next() {
          var id = list[k], d = window.HourglassAudio.AMBIENCES[id];
          try { a.setAmbience(id, true); } catch (e) { out[id] = { err: e.message }; }
          (function wait(n) {
            if ((!a._amb || a._amb.id !== id) && n < 200) { setTimeout(function () { wait(n + 1); }, 50); return; }
            out[id] = out[id] || {
              playing: a._amb ? a._amb.id : null,
              rates: a._amb ? a._amb.srcs.map(function (s) { return s.buffer.sampleRate; }) : [],
              asked: d.layers.map(function (L) { return L.sr; }),
              secondsOff: a._amb ? Math.max.apply(null, a._amb.srcs.map(function (s, i) { return Math.abs(s.buffer.duration - Math.floor(d.layers[i].sr * d.layers[i].seconds) / d.layers[i].sr); })) : 1
            };
            if (++k < list.length) next();
            else { P.createBuffer = make; a.setAmbience('none'); out.refused = refused.length; resolve(out); }
          })(0);
        })();
      });
    });
    report(NEW_AMB.every(function (id) {
      var l = low[id];
      return l && !l.err && l.playing === id && l.rates.length === l.asked.length && l.secondsOff < 1e-6 &&
             l.rates.every(function (r, i) { return r >= 22050 && r % l.asked[i] === 0 && (l.asked[i] >= 22050 ? r === l.asked[i] : r < 2 * 22050); });
    }) && low.refused > 0, 'a browser that makes no buffer below 22.05 kHz still plays all three (the least whole multiple of each rate)',
           NEW_AMB.map(function (id) { var l = low[id]; return id + ': ' + (l.err || l.asked.join('/') + ' → ' + l.rates.join('/') + ' Hz'); }).join('; ') + '; ' + low.refused + ' buffers refused');

    report(errors.length === 0, 'no page or console errors', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + (cases - failures) + '/' + cases + ' passed');
  process.exit(failures ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(1); });
