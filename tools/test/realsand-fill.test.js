#!/usr/bin/env node
/*
 * Real sand's fill and felt jolts (realsand/fill.mjs, realsand/felt.mjs) in Node, without a GPU.
 *
 * Checks: on each grid of the lab (coarse, medium, fine: 0.65, 0.8 and 1 solver cells per app
 * cell) the fills of the top bulb and the lower bulb hold exactly the points asked for, for each
 * of the lab's amounts (a minute, a quarter, full) and the Timer's glasses on the coarse grid
 * (10 s, 1, 10 and 60 minutes, as pointsFor gives them), and every point lies inside the glass
 * and on its side of the neck; a target that is not a number is refused (it gave a nearly empty
 * bed); the colour seed each record carries is the grain shader's own hash of its index
 * (grains.wgsl hash, computed here in exact 32-bit arithmetic); the glass's felt acceleration
 * (GlassFelt) gives exactly what the lab's own code gave before it moved to realsand/ (73683f7
 * lab/sand/main.mjs glassFelt, copied below) on a recorded flick, a shake and a steady push, at
 * app speed (played back as a slowed film) and at real speed.
 *
 *   node tools/test/realsand-fill.test.js
 */
'use strict';
var path = require('path');
var t0 = Date.now(), count = 0, failures = 0;
function log(s) { console.log(s); }
function check(ok, what) { count++; if (!ok) failures++; log((ok ? 'ok    ' : 'FAIL  ') + what); }

// the lab's amounts (lab/sand/main.mjs AMOUNTS, APP_CAPACITY) and grids (RES)
var AMOUNTS = { minute: 2800, quarter: 10000, full: 24000 }, APP_CAPACITY = 28099, RES = { S: 0.65, M: 0.8, L: 1.0 };

/* 73683f7 lab/sand/main.mjs glassFelt, with the globals it read, as it was before it moved to
 * realsand/felt.mjs: the reference. */
function originalFelt() {
  var ACC_TAU = 0.012, FILM_QUIET = 0.04, FILM_LAG = 0.5, FILM_N = 8192;
  var film = { t: new Float64Array(FILM_N), x: new Float32Array(FILM_N), y: new Float32Array(FILM_N), w: 0, i: 0, tp: 0 };
  var imp = { x1: 0, y1: 0, jx: 0, jy: 0 };
  function filmReset(t) { film.w = 0; film.i = 0; film.tp = t; }
  function feel(ax, ay, dt, t, slowed, lam) {
    var k1 = 1 - Math.exp(-dt / ACC_TAU);
    imp.x1 += (ax - imp.x1) * k1; imp.y1 += (ay - imp.y1) * k1;
    var jx = imp.x1, jy = imp.y1;
    if (slowed) {
      var j = film.w % FILM_N;
      film.t[j] = t; film.x[j] = jx; film.y[j] = jy; film.w++;
      if (film.w - film.i > FILM_N - 2) film.i = film.w - (FILM_N - 2);
      var at = function (tp) {
        while (film.i + 1 < film.w && film.t[(film.i + 1) % FILM_N] <= tp) film.i++;
        var a = film.i % FILM_N, b = (film.i + 1) % FILM_N;
        if (film.i + 1 >= film.w || film.t[b] <= film.t[a]) return [film.x[a], film.y[a]];
        var u = Math.min(1, Math.max(0, (tp - film.t[a]) / (film.t[b] - film.t[a])));
        return [film.x[a] + (film.x[b] - film.x[a]) * u, film.y[a] + (film.y[b] - film.y[a]) * u];
      };
      var p = at(film.tp);
      if (Math.hypot(p[0], p[1]) < FILM_QUIET) {
        while (film.i + 1 < film.w && Math.hypot(film.x[(film.i + 1) % FILM_N], film.y[(film.i + 1) % FILM_N]) < FILM_QUIET) film.i++;
        film.tp = Math.max(film.tp, film.i + 1 < film.w ? film.t[(film.i + 1) % FILM_N] : t);
      } else film.tp += dt * Math.sqrt(lam);
      film.tp = Math.min(t, Math.max(t - FILM_LAG, film.tp));
      p = at(film.tp);
      jx = p[0]; jy = p[1];
    } else filmReset(t);
    imp.jx = jx; imp.jy = jy;
    return [jx, jy];
  }
  return { feel: feel, imp: imp, film: film };
}

/** grains.wgsl hash(index * 2654435761 + 17) & 255, in exact 32-bit arithmetic (BigInt). */
function shaderSeed(i) {
  var M = BigInt(0xffffffff), u = function (x) { return x & M; };
  var input = u(BigInt(i) * 2654435761n + 17n);
  var state = u(input * 747796405n + 2891336453n);
  var word = u(((state >> ((state >> 28n) + 4n)) ^ state) * 277803737n);
  return Number(((word >> 22n) ^ word) & 255n);
}

async function main() {
  var G = await import(path.join(__dirname, '..', '..', 'realsand', 'glass.mjs'));
  var F = await import(path.join(__dirname, '..', '..', 'realsand', 'fill.mjs'));
  var V = await import(path.join(__dirname, '..', '..', 'realsand', 'valve.mjs'));
  var T = await import(path.join(__dirname, '..', '..', 'lab', 'sand', 'timer.mjs'));
  var Felt = await import(path.join(__dirname, '..', '..', 'realsand', 'felt.mjs'));
  var SOL = await import(path.join(__dirname, '..', '..', 'realsand', 'solver.mjs'));

  // ---- the fills: exact counts, inside the glass, on their side of the neck ----
  var rows = [], exact = true, inside = true;
  function fill(g, kind, want, label) {
    var pts = F.makeFill(g, kind, { points: want }), n = pts.length / 2, out = 0;
    for (var i = 0; i < n; i++) {
      var x = pts[2 * i], y = pts[2 * i + 1];
      if (!(G.sampleField(g, x, y)[2] > 0.45) || (kind === 'top' ? !(y > g.cy) : !(y < g.cy))) out++;
    }
    if (n !== want) exact = false;
    if (out) inside = false;
    rows.push(label + ' ' + kind + ' ' + n + (n === want ? '' : ' (asked ' + want + ')') + (out ? ', ' + out + ' outside' : ''));
    return pts;
  }
  var glasses = {};
  Object.keys(RES).forEach(function (res) {
    var g = glasses[res] = G.buildGlass({ s: RES[res], neckMin: 5.5 });
    Object.keys(AMOUNTS).forEach(function (a) {
      var want = Math.round(AMOUNTS[a] / APP_CAPACITY * g.bulbArea * F.PPC * F.PPC);
      fill(g, 'top', want, res + ' ' + a); fill(g, 'lower', want, res + ' ' + a);
    });
  });
  var gS = glasses.S, ppg = F.PPC * F.PPC * gS.s * gS.s;
  ['10s', '1m', '10m', '60m'].forEach(function (id) {
    var N = T.grainsFor(T.timerById(id).amountMs);
    fill(gS, 'top', V.pointsFor(N, ppg), 'Timer ' + id + ' (' + N + ' grains)');
  });
  check(exact, 'the fills hold exactly the points asked for, each grid and amount, top and lower bulb, and the Timer\'s glasses: ' + rows.filter(function (r) { return /^S |Timer/.test(r); }).join('; '));
  check(inside, 'every point of every fill lies inside the glass and on its side of the neck' + (inside ? '' : ': ' + rows.filter(function (r) { return /outside/.test(r); }).join('; ')));
  var refused = [NaN, undefined, Infinity, -1].map(function (x) { try { F.makeFill(gS, 'top', { points: x }); return false; } catch (e) { return /points/.test(e.message); } });
  check(refused.every(Boolean), 'a target that is not a number of points (NaN, none, Infinity, -1) is refused, not filled as a nearly empty bed');

  // ---- the colour seeds ----
  var pts = F.makeFill(gS, 'top', { points: 2000 }), data = F.packParticles(pts, SOL.MATERIALS.coarse), seedsOk = true, n2 = pts.length / 2;
  for (var i = 0; i < n2; i++) if (data[i * SOL.PARTICLE_WORDS + 20] !== F.indexSeed(i) || F.indexSeed(i) !== shaderSeed(i)) seedsOk = false;
  for (i = 0; i < 1 << 16; i += 7) if (F.indexSeed(i) !== shaderSeed(i)) seedsOk = false;
  var given = F.packParticles(pts.slice(0, 20), SOL.MATERIALS.coarse, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  check(seedsOk && given[20] === 5 && given[9 * SOL.PARTICLE_WORDS + 20] === 14,
    'each record\'s colour seed (word 20) is the grain shader\'s hash of its index (checked in exact 32-bit arithmetic over ' + n2 + ' records and every 7th index below 65,536), or the seed given');

  // ---- the felt jolts: GlassFelt against the lab's original code ----
  // a recorded flick (a push of 1.5 g for 60 ms, then the stop, -1.2 g for 50 ms), a 3 g shake at
  // 9 Hz for 0.6 s, quiet, a steady push of 0.3 g for 1 s; substeps at 480 Hz
  function jolt(t) {
    if (t >= 0.2 && t < 0.26) return [1.5, 0.2];
    if (t >= 0.26 && t < 0.31) return [-1.2, -0.1];
    if (t >= 0.8 && t < 1.4) return [3 * Math.sin(2 * Math.PI * 9 * t), 0.5 * Math.cos(2 * Math.PI * 9 * t)];
    if (t >= 2 && t < 3) return [0, 0.3];
    return [0, t > 3.5 ? 0.01 : 0];
  }
  var feltOk = true, diffs = 0, peak = [0, 0];
  [[true, 0.08], [false, 1]].forEach(function (mode, k) {
    var ref = originalFelt(), now = new Felt.GlassFelt(), dt = 1 / 480;
    now.reset(0);
    for (var s = 0, t = 0; s < 480 * 4; s++, t += dt) {
      var a = jolt(t), r = ref.feel(a[0], a[1], dt, t, mode[0], mode[1]), q = now.feel(a[0], a[1], dt, t, mode[0], mode[1]);
      if (r[0] !== q[0] || r[1] !== q[1]) { feltOk = false; diffs++; }
      peak[k] = Math.max(peak[k], Math.hypot(q[0], q[1]));
    }
    if (ref.film.w !== now.film.w || ref.film.i !== now.film.i || ref.film.tp !== now.film.tp || ref.imp.jx !== now.jx) feltOk = false;
  });
  check(feltOk && peak[0] > 1 && peak[1] > 1, 'the felt jolts: GlassFelt gives exactly what the lab\'s own code gave on a recorded flick, a shake and a steady push, played back as a slowed film at app speed and as felt at real speed (' + diffs + ' substeps differ; peaks ' + peak[0].toFixed(2) + ' and ' + peak[1].toFixed(2) + ' g)');
}

main().catch(function (e) { failures++; log('FAIL  ' + (e && e.stack || e)); }).then(function () {
  log((failures ? 'realsand-fill: ' + failures + ' of ' + count + ' checks FAILED' : 'realsand-fill: all ' + count + ' checks passed') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  process.exit(failures ? 1 : 0);
});
