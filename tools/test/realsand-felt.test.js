#!/usr/bin/env node
/*
 * Real sand: how the glass's own motion is played to the sand at app speed (realsand/felt.mjs,
 * GlassFelt), in Node. The world there runs slowed by lambda (0.075 here, a phone's glass), and
 * the owner felt the sand answer the phone about half a second late. The playbacks: live (the
 * default), slowmo, film (the slowed film the engine used before: the control) and plain.
 * Steps of 1/120 s, as the app's.
 *
 * Checks:
 *  1. a flick (2 g for 50 ms, then the stop, -2 g for 50 ms): live answers in the substep the
 *     hand moves, its push peaks within 25 ms of the hand's, and 0.1 s after the hand stops
 *     nothing more is felt, nothing of the push's sign after the stop (the film, the control:
 *     its push peaks 60 ms late or more, it plays the push and then the stop after the hand has
 *     stopped, and 0.15 s after it still pushes beyond the bed's friction);
 *  2. the impulse a bed sliding on the push gets (the felt beyond the knee, tan of the friction
 *     angle): without the cap, live gives the film's within 5 % for a lone push and each half of
 *     a flick (the knee's gain is the film's speed); with the 2 g cap, a lone push keeps at least
 *     85 % and each half of a flick at least 60 % (the cap pays at most 1.4 g beyond the knee, and
 *     the stop takes back what the push still owed), and the flick's push and stop cancel within
 *     0.01 g s; a sustained shake (1.5 g at 5 Hz, 2 s) gives at least twice what the film held
 *     0.5 s behind gave, and within 15 % of what the film gives with no limit to its lag;
 *  3. the hand's jitter (0.2, 0.1 and 0.08 g at 9, 12.3 and 6 Hz), below the knee, passes live
 *     exactly as felt (each substep the smoothed input itself), as does a lift of 0.8 g (under
 *     its own knee of 1 g, though over the sideways one) and a 3 g press; the film plays the same
 *     jitter about 0.5 s late (control);
 *  4. the reservoir keeps the impulse: for a push the cap holds back (2.5 g for 40 ms), what is
 *     felt beyond the knee plus what is still owed is exactly the push's excess times the gain;
 *     the cap holds (never over 2 g on an axis, or the hand's own acceleration when higher) on
 *     every input here; a phone swung round (6 g held for 2 s) is felt no more 0.2 s after it
 *     stops, where an unbounded reservoir (control) still pushes 1 s after;
 *  5. lift: a vertical shake (1.5 g at 5 Hz) gives a bed the lift beyond 1 g that the film with
 *     no limit to its lag gives, within 15 %;
 *  6. under a sustained shake the film sits about 0.5 s behind the hand (its play head 0.45 to
 *     0.5 s behind for the shake's last second, and it pushes the bed beyond its friction 0.45 s
 *     or more after the hand stops: the control, the owner's "about 0.5 sec delay"); live: 50 ms
 *     or less, and the jitter 20 ms late or less; slowmo plays a lone flick exactly as the film,
 *     and a shake live within 0.25 s of its start (never more than 0.2 s behind, 50 ms or less
 *     after the hand stops), as it does the jitter;
 *  7. a new mode starts from now: from the film half a second behind a shake (pushing the other
 *     way), live at once (no film behind, with the hand); reset() empties the reservoir;
 *  8. through the real motion.js (the replay streams: picking the phone up and looking, walking,
 *     firm and vigorous shakes): the film is 0.25 s behind or more for over 80 % of the moving
 *     time (the control), live's output best matches its input at a lag of 40 ms or less (the
 *     smoothing, and a hard shake's peaks over the cap paid just after), and while the phone is
 *     only handled (gentle) live is exactly what the phone felt.
 *
 *   node tools/test/realsand-felt.test.js
 */
'use strict';
var path = require('path');
var t0 = Date.now(), count = 0, failures = 0;
function log(s) { console.log(s); }
function check(ok, what) { count++; if (!ok) failures++; log((ok ? 'ok    ' : 'FAIL  ') + what); }
function f2(x) { return (+x).toFixed(2); }
function f3(x) { return (+x).toFixed(3); }
function ms(x) { return x === null || x === undefined ? '-' : (x * 1000).toFixed(0) + ' ms'; }

var LAM = 0.075, DT = 1 / 120, TAU = 2 * Math.PI;
function pulse(t, t0, w, P) { var u = (t - t0) / w; return u > 0 && u < 1 ? P * Math.sin(Math.PI * u) : 0; }
// inputs: what the sand feels from the hand, g, page axes (y down: y < 0 lifts the bed)
var IN = {
  flick: function (t) { return [pulse(t, 0.2, 0.05, 2) - pulse(t, 0.25, 0.05, 2), 0]; },
  tap: function (t) { return [pulse(t, 0.2, 0.06, 2), 0]; },
  shake: function (t) { return [t > 0.2 && t < 2.2 ? 1.5 * Math.sin(TAU * 5 * (t - 0.2)) : 0, 0]; },
  vig: function (t) { return [t > 0.2 && t < 2.2 ? 3 * Math.sin(TAU * 4.5 * (t - 0.2)) : 0, 0]; },
  jitter: function (t) {
    return [t > 0.2 && t < 2.2 ? 0.2 * Math.sin(TAU * 9 * t) + 0.1 * Math.sin(TAU * 12.3 * t + 1) + 0.08 * Math.sin(TAU * 6 * t + 2) : 0, 0];
  },
  sharp: function (t) { return [t >= 0.2 && t < 0.24 ? 2.5 : 0, 0]; },
  swing: function (t) { return [t >= 0.2 && t < 2.2 ? 6 : 0, 0]; },
  vshake: function (t) { return [0, t > 0.2 && t < 2.2 ? 1.5 * Math.sin(TAU * 5 * (t - 0.2)) : 0]; },
  lift08: function (t) { return [0, t >= 0.2 && t < 0.6 ? -0.8 : 0]; },
  press3: function (t) { return [0, t >= 0.2 && t < 0.6 ? 3 : 0]; }
};

async function main() {
  var Felt = await import(path.join(__dirname, '..', '..', 'realsand', 'felt.mjs'));
  var KNEE = Felt.LIVE.knee, CAP = Felt.LIVE.cap, GAIN = 1 / Math.sqrt(LAM);

  /** Play an input through a GlassFelt of options opt for dur s: the record of each substep. */
  function play(input, opt, dur, o) {
    o = o || {};
    var f = new Felt.GlassFelt(opt), dt = o.dt || DT, r = { t: [], x: [], y: [], ox: [], oy: [], x1: [], y1: [], behind: [], live: [], f: f };
    f.reset(0);
    for (var k = 0, t = 0; t < dur; k++, t = k * dt) {
      var a = input(t), out = f.feel(a[0], a[1], dt, t, true, LAM);
      r.t.push(t); r.x.push(a[0]); r.y.push(a[1]); r.ox.push(out[0]); r.oy.push(out[1]); r.x1.push(f.x1); r.y1.push(f.y1);
      r.behind.push(f.behind); r.live.push(f.sm.live);
      if (o.each) o.each(f, t, k);
    }
    return r;
  }
  /** The impulse beyond the knee k (g s), from tA to tB: [pushes (> 0), stops (< 0)]. */
  function beyond(t, v, k, tA, tB) {
    var p = 0, n = 0;
    for (var i = 0; i < t.length; i++) {
      if (t[i] < tA || t[i] >= tB) continue;
      var e = Math.abs(v[i]) > k ? (Math.abs(v[i]) - k) * Math.sign(v[i]) : 0;
      if (e > 0) p += e * DT; else n -= e * DT;
    }
    return [p, n];
  }
  /** The lag (s, 0 to maxLag) at which the output best matches the input over [tA, tB]. */
  function lagOf(t, inp, out, tA, tB, maxLag) {
    var best = -Infinity, at = 0, dt = t[1] - t[0];
    for (var L = 0; L <= Math.round(maxLag / dt); L++) {
      var s = 0, n = 0;
      for (var i = 0; i < t.length; i++) if (t[i] >= tA && t[i] <= tB && i - L >= 0) { s += inp[i - L] * out[i]; n++; }
      s /= n || 1;
      if (s > best) { best = s; at = L * dt; }
    }
    return at;
  }
  function firstAt(t, v, th, from) { for (var i = 0; i < t.length; i++) if (t[i] >= (from || 0) && Math.abs(v[i]) >= th) return t[i]; return null; }
  function lastAt(t, v, th) { var L = null; for (var i = 0; i < t.length; i++) if (Math.abs(v[i]) > th) L = t[i]; return L; }
  function peakAt(t, v, tA, tB) { var b = -1, bt = null; for (var i = 0; i < t.length; i++) if (t[i] >= tA && t[i] < tB && v[i] > b) { b = v[i]; bt = t[i]; } return bt; }

  // ---- 1. a flick: at once, and nothing late ----
  var live = play(IN.flick, {}, 1.5), film = play(IN.flick, { mode: 'film' }, 1.5);
  var handOn = firstAt(live.t, live.x, 1e-9), handEnd = lastAt(live.t, live.x, 1e-9) + DT;
  var k0 = live.t.indexOf(handOn), same = live.ox[k0] > 0 && live.ox[k0] === live.x1[k0];
  var hPk = peakAt(live.t, live.x, 0, 0.25), lPk = peakAt(live.ox, live.ox, -1, 1) === null ? null : peakAt(live.t, live.ox, 0, 0.3), fPk = peakAt(film.t, film.ox, 0, 0.6);
  var lLast = lastAt(live.t, live.ox, 0.05), fBeyond = beyond(film.t, film.ox, KNEE, handEnd + 0.15, 9);
  var lAfterUp = 0, fSigns = { p: false, n: false };
  for (var i = 0; i < live.t.length; i++) {
    if (live.t[i] < handEnd) continue;
    lAfterUp = Math.max(lAfterUp, live.ox[i]);
    if (film.ox[i] > 0.5) fSigns.p = true; else if (fSigns.p && film.ox[i] < -0.5) fSigns.n = true;
  }
  log('  flick: the hand from ' + ms(handOn) + ' to ' + ms(handEnd) + ', its push peaks at ' + ms(hPk) + '; live peaks at ' + ms(lPk) + ', felt last over 0.05 g at ' + ms(lLast) +
    ', over +0.05 g after the hand stopped ' + f2(lAfterUp) + ' g; the film peaks at ' + ms(fPk) + ', after the hand stopped plays the push ' + (fSigns.p ? 'and then the stop ' + (fSigns.n ? 'too' : 'not') : 'not') +
    ', beyond the knee from 0.15 s after: ' + f3(fBeyond[0] + fBeyond[1]) + ' g s');
  check(same && lPk - hPk <= 0.025 && lLast - handEnd <= 0.1 && lAfterUp <= 0.05,
    'live answers a flick in the substep the hand moves (' + f2(live.ox[k0]) + ' g, the smoothed input itself), its push peaks ' + ms(lPk - hPk) + ' after the hand\'s (<= 25), and ' + ms(lLast - handEnd) + ' after the hand stops nothing more is felt (<= 100), nothing pushing the bed back (' + f2(lAfterUp) + ' g)');
  check(fPk - hPk >= 0.06 && fSigns.p && fSigns.n && fBeyond[0] + fBeyond[1] > 0.01,
    'control: the film plays the flick\'s push ' + ms(fPk - hPk) + ' late (>= 60), plays the push and then the stop after the hand has stopped, and 0.15 s after it still pushes beyond the bed\'s friction (' + f3(fBeyond[0] + fBeyond[1]) + ' g s)');

  // ---- 2. the impulse a sliding bed gets ----
  var tapL = play(IN.tap, {}, 1.5), tapN = play(IN.tap, { cap: Infinity }, 1.5), tapF = play(IN.tap, { mode: 'film' }, 1.5);
  var bL = beyond(tapL.t, tapL.ox, KNEE, 0, 9)[0], bN = beyond(tapN.t, tapN.ox, KNEE, 0, 9)[0], bF = beyond(tapF.t, tapF.ox, KNEE, 0, 9)[0];
  var flN = play(IN.flick, { cap: Infinity }, 1.5);
  var fl = beyond(live.t, live.ox, KNEE, 0, 9), fln = beyond(flN.t, flN.ox, KNEE, 0, 9), flf = beyond(film.t, film.ox, KNEE, 0, 9);
  log('  beyond the knee (' + f2(KNEE) + ' g), g s: a lone push (2 g, 60 ms) live ' + f3(bL) + ', live with no cap ' + f3(bN) + ', the film ' + f3(bF) +
    '; a flick, push / stop: live ' + f3(fl[0]) + ' / ' + f3(fl[1]) + ', no cap ' + f3(fln[0]) + ' / ' + f3(fln[1]) + ', the film ' + f3(flf[0]) + ' / ' + f3(flf[1]));
  check(Math.abs(bN / bF - 1) <= 0.05 && Math.abs(fln[0] / flf[0] - 1) <= 0.05 && Math.abs(fln[1] / flf[1] - 1) <= 0.05,
    'without the cap, live gives a sliding bed the film\'s impulse: a lone push ' + f2(100 * bN / bF) + ' %, a flick\'s push ' + f2(100 * fln[0] / flf[0]) + ' % and stop ' + f2(100 * fln[1] / flf[1]) + ' % (each within 5 %)');
  check(bL / bF >= 0.85 && fl[0] / flf[0] >= 0.6 && fl[1] / flf[1] >= 0.6 && Math.abs(fl[0] - fl[1]) <= 0.01,
    'with the 2 g cap: a lone push keeps ' + f2(100 * bL / bF) + ' % of the film\'s impulse (>= 85), a flick\'s push ' + f2(100 * fl[0] / flf[0]) + ' % and stop ' + f2(100 * fl[1] / flf[1]) + ' % (>= 60), and they cancel within ' + f3(Math.abs(fl[0] - fl[1])) + ' g s (<= 0.01)');
  var shL = play(IN.shake, {}, 3), shF = play(IN.shake, { mode: 'film' }, 3), shU = play(IN.shake, { mode: 'film', lag: Infinity }, 9);
  var sum = function (b) { return b[0] + b[1]; };
  var sL = sum(beyond(shL.t, shL.ox, KNEE, 0, 99)), sF = sum(beyond(shF.t, shF.ox, KNEE, 0, 99)), sU = sum(beyond(shU.t, shU.ox, KNEE, 0, 99));
  log('  a shake, 1.5 g at 5 Hz for 2 s, beyond the knee: live ' + f3(sL) + ' g s, the film held 0.5 s behind ' + f3(sF) + ', the film with no limit to its lag (played over ' + f2(lastAt(shU.t, shU.ox, 0.05)) + ' s) ' + f3(sU));
  check(sL >= 2 * sF && Math.abs(sL / sU - 1) <= 0.15,
    'under a sustained shake live gives a sliding bed ' + f2(sL / sF) + ' times the impulse of the film held 0.5 s behind (>= 2), and ' + f2(100 * sL / sU) + ' % of the film\'s own with no limit to its lag (within 15 %)');

  // ---- 3. below the knee: as felt ----
  var jL = play(IN.jitter, {}, 2.5), jF = play(IN.jitter, { mode: 'film' }, 2.5), jP = play(IN.jitter, { mode: 'plain' }, 2.5);
  var exact = true, jPeak = 0;
  for (i = 0; i < jL.t.length; i++) { if (jL.ox[i] !== jL.x1[i] || jL.oy[i] !== jL.y1[i] || jP.ox[i] !== jL.ox[i]) exact = false; jPeak = Math.max(jPeak, Math.abs(jL.x[i])); }
  var lift = play(IN.lift08, {}, 1), press = play(IN.press3, {}, 1), exact2 = true;
  for (i = 0; i < lift.t.length; i++) if (lift.oy[i] !== lift.y1[i] || press.oy[i] !== press.y1[i]) exact2 = false;
  var jLag = lagOf(jF.t, jF.x, jF.ox, 1.2, 2.2, 0.7);
  log('  jitter peaking at ' + f2(jPeak) + ' g: live ' + (exact ? 'is' : 'is NOT') + ' the smoothed input every substep; the film best matches it ' + ms(jLag) + ' late');
  check(exact && exact2 && jLag >= 0.4,
    'below the knee live is exactly what the hand gives: jitter (peaks ' + f2(jPeak) + ' g, as plain too), a lift of 0.8 g (under its own knee of 1 g) and a 3 g press, every substep; the film (control) plays the jitter ' + ms(jLag) + ' late (>= 400)');

  // ---- 4. the reservoir and the cap ----
  var paid = 0, owedIn = 0, f4 = null;
  var sh = play(IN.sharp, {}, 0.6, { each: function (f) { f4 = f; } });
  for (i = 0; i < sh.t.length; i++) {
    var lx = Math.max(-KNEE, Math.min(KNEE, sh.x1[i]));
    paid += (sh.ox[i] - lx) * DT; owedIn += (sh.x1[i] - lx) * GAIN * DT;
  }
  var owedMax = 0;
  play(IN.sharp, {}, 0.6, { each: function (f) { owedMax = Math.max(owedMax, Math.abs(f.owed[0])); } });
  var capOk = true, capWorst = '';
  [IN.flick, IN.tap, IN.shake, IN.vig, IN.sharp, IN.swing, IN.vshake, IN.press3].forEach(function (inp, n) {
    var r = play(inp, {}, 3);
    for (var j = 0; j < r.t.length; j++) {
      var over = Math.max(Math.abs(r.ox[j]) - Math.max(CAP, Math.abs(r.x1[j])), Math.abs(r.oy[j]) - Math.max(CAP, Math.abs(r.y1[j])));
      if (over > 1e-9) { capOk = false; capWorst = 'input ' + n + ' at ' + f2(r.t[j]) + ' s: ' + f2(r.ox[j]) + ', ' + f2(r.oy[j]) + ' g'; }
    }
  });
  log('  a push of 2.5 g for 40 ms: owed at most ' + f3(owedMax) + ' g s (the bound ' + f2(CAP * Felt.LIVE.hold) + '); felt beyond the knee ' + f3(paid) + ' + still owed ' + f3(f4.owed[0]) + ' against ' + f3(owedIn) + ' g s');
  check(owedMax > 0.05 && owedMax < CAP * Felt.LIVE.hold && Math.abs(paid + f4.owed[0] - owedIn) < 1e-9 && capOk,
    'the reservoir keeps the impulse: what the cap held back (' + f3(owedMax) + ' g s) is all felt later (' + f3(paid) + ' g s beyond the knee, exactly the push\'s excess times ' + f2(GAIN) + '), and the cap holds on every input here (' + (capOk ? 'never over 2 g, or the hand\'s own' : capWorst) + ')');
  var sw = play(IN.swing, {}, 4), swU = play(IN.swing, { hold: Infinity }, 4);
  var swLast = lastAt(sw.t, sw.ox, 0.05) - 2.2, swULast = lastAt(swU.t, swU.ox, 0.05) - 2.2;
  log('  a phone swung round (6 g held 2 s): felt last over 0.05 g ' + ms(swLast) + ' after it stopped; with no bound on the reservoir (control) ' + ms(swULast));
  check(swLast <= 0.2 && swULast >= 1,
    'a push held far beyond the cap is not felt for long after it stops: ' + ms(swLast) + ' (<= 200; with the reservoir unbounded, the control, ' + ms(swULast) + ', >= 1 s)');

  // ---- 5. lift ----
  var vL = play(IN.vshake, {}, 3), vU = play(IN.vshake, { mode: 'film', lag: Infinity }, 9), vF = play(IN.vshake, { mode: 'film' }, 3);
  var negY = function (r) { return r.oy.map(function (v) { return -v; }); };
  var lL = beyond(vL.t, negY(vL), 1, 0, 99)[0], lU = beyond(vU.t, negY(vU), 1, 0, 99)[0], lF = beyond(vF.t, negY(vF), 1, 0, 99)[0];
  log('  a vertical shake, 1.5 g at 5 Hz: lift beyond 1 g live ' + f3(lL) + ' g s, the film with no limit to its lag ' + f3(lU) + ', held 0.5 s behind ' + f3(lF));
  check(Math.abs(lL / lU - 1) <= 0.15, 'lift: a vertical shake lifts a bed live as the film with no limit to its lag does (' + f2(100 * lL / lU) + ' %, within 15 %), the sideways knee not applied to it');

  // ---- 6. lag under a sustained shake; slow motion ----
  // (a 5 Hz shake matches itself every 0.2 s, so the lag is read from the play head, and from how
  // long the sand is still pushed beyond its friction after the hand stops)
  var behindMin = Infinity, behindMax = 0;
  for (i = 0; i < shF.t.length; i++) if (shF.t[i] >= 1.2 && shF.t[i] < 2.2) { behindMin = Math.min(behindMin, shF.behind[i]); behindMax = Math.max(behindMax, shF.behind[i]); }
  var beyondKnee = function (r) { return r.ox.map(function (v) { return Math.abs(v) > KNEE + 0.05 ? v : 0; }); };
  var fDriven = lastAt(shF.t, beyondKnee(shF), 0) - 2.2, lDriven = lastAt(shL.t, beyondKnee(shL), 0) - 2.2;
  var lLag = lagOf(jL.t, jL.x, jL.ox, 1.2, 2.2, 0.7);
  log('  shake, its last second: the film\'s play head ' + ms(behindMin) + ' to ' + ms(behindMax) + ' behind; after the hand stops, beyond the knee for ' + ms(fDriven) + ' (the film) and ' + ms(lDriven) + ' (live)');
  check(behindMin >= 0.45 && behindMax <= 0.5 + 1e-9 && fDriven >= 0.45,
    'control: under a sustained shake the film sits about 0.5 s behind the hand (its play head ' + ms(behindMin) + ' to ' + ms(behindMax) + ' behind), and pushes the bed beyond its friction ' + ms(fDriven) + ' after the hand stops: the owner\'s "about 0.5 sec delay"');
  check(lDriven <= 0.05 && lLag <= 0.02, 'live follows the hand: ' + ms(lDriven) + ' after a shake stops nothing beyond the bed\'s friction is felt (<= 50), and the jitter is felt ' + ms(lLag) + ' late (<= 20, the smoothing)');
  var sFl = play(IN.flick, { mode: 'slowmo' }, 1.5), sameFilm = true;
  for (i = 0; i < sFl.t.length; i++) if (sFl.ox[i] !== film.ox[i] || sFl.oy[i] !== film.oy[i]) sameFilm = false;
  var sSh = play(IN.shake, { mode: 'slowmo' }, 3), sJ = play(IN.jitter, { mode: 'slowmo' }, 2.5);
  var liveAt = null, sBehind = 0, jBehind = 0, jLiveAt = null;
  for (i = 0; i < sSh.t.length; i++) { if (liveAt === null && sSh.live[i]) liveAt = sSh.t[i]; sBehind = Math.max(sBehind, sSh.behind[i]); }
  for (i = 0; i < sJ.t.length; i++) { if (jLiveAt === null && sJ.live[i]) jLiveAt = sJ.t[i]; jBehind = Math.max(jBehind, sJ.behind[i]); }
  var sDriven = lastAt(sSh.t, beyondKnee(sSh), 0) - 2.2;
  log('  slowmo: a lone flick ' + (sameFilm ? 'is' : 'is NOT') + ' the film; a shake live from ' + ms(liveAt) + ' (the hand from 200 ms), at most ' + ms(sBehind) + ' behind, beyond the knee ' + ms(sDriven) + ' after the hand stops; jitter live from ' + ms(jLiveAt) + ', at most ' + ms(jBehind) + ' behind');
  check(sameFilm && liveAt !== null && liveAt - 0.2 <= 0.25 && sBehind <= 0.2 && sDriven <= 0.05 && jLiveAt !== null && jBehind <= 0.2,
    'slowmo plays a lone flick exactly as the film, and a shake live ' + ms(liveAt - 0.2) + ' after it starts (<= 250), never more than ' + ms(sBehind) + ' behind (<= 200), as it does the jitter (' + ms(jBehind) + ')');

  // ---- 7. a new mode starts from now ----
  // (half a second behind a 5 Hz shake, the film plays the hand's motion the other way round)
  var sw7 = new Felt.GlassFelt({ mode: 'film' });
  sw7.reset(0);
  for (var k7 = 0; k7 < 240; k7++) { var a7 = IN.shake(k7 * DT); sw7.feel(a7[0], a7[1], DT, k7 * DT, true, LAM); }
  for (; k7 < 400 && !(Math.abs(sw7.x1) > 0.5 && Math.sign(sw7.jx) === -Math.sign(sw7.x1)); k7++) { a7 = IN.shake(k7 * DT); sw7.feel(a7[0], a7[1], DT, k7 * DT, true, LAM); }
  var behind7 = sw7.behind, was7 = sw7.jx, hand7 = sw7.x1;
  sw7.opt.mode = 'live';
  var a8 = IN.shake(k7 * DT), o8 = sw7.feel(a8[0], a8[1], DT, k7 * DT, true, LAM);
  var live8 = new Felt.GlassFelt();
  live8.reset(0);
  for (k7 = 0; k7 <= 28; k7++) { var a9 = IN.sharp(k7 * DT); live8.feel(a9[0], a9[1], DT, k7 * DT, true, LAM); }
  var owed8 = live8.owed[0];
  live8.reset(0);
  log('  a switch from the film to live at ' + f2(k7 * DT) + ' s of a shake: the film ' + ms(behind7) + ' behind felt ' + f2(was7) + ' g while the hand gave ' + f2(hand7) + '; live at once ' + f2(o8[0]) + ' g, ' + ms(sw7.behind) + ' behind');
  check(behind7 >= 0.45 && sw7.behind === 0 && Math.sign(o8[0]) === Math.sign(sw7.x1) && Math.sign(was7) === -Math.sign(hand7) && owed8 > 0 && live8.owed[0] === 0 && live8.owed[1] === 0,
    'another mode starts from now: from the film, ' + ms(behind7) + ' behind and pushing the other way, to live: at once 0 behind and with the hand; reset() empties the reservoir (it held ' + f3(owed8) + ' g s)');

  // ---- 8. through motion.js: the replay streams ----
  var O = require('./lib/replay-offline.js'), S = O.Streams;
  var FRAME_MS = 1000 / 60, STEP_MS = 1000 / 120, rows = [], filmBehind = true, liveLag = 0, gentleExact = true;
  ['gentle', 'walking', 'firmX', 'vigorousX'].forEach(function (name) {
    var st = S.get(name), env = O.makeMotion(), motion = env.motion;
    motion.start();
    var pre = 2, dur = Math.min(st.dur || 8, 8), s = {}, mo = {}, fL = new Felt.GlassFelt(), fF = new Felt.GlassFelt({ mode: 'film' });
    fL.reset(0); fF.reset(0);
    var r = { t: [], x: [], ox: [], moving: 0, behind: 0 }, ev = 3;
    for (var fr = 0; fr < (pre + dur) * 60; fr++) {
      var now = (fr + 1) * FRAME_MS;
      while (ev <= now) {
        env.t = ev;
        var ts = ev / 1000 - pre;
        if (ts >= 0) st.fn(ts, s); else S.sample('still', ev / 1000, s);
        var e = S.deviceEvents(s, 'ios');
        env.fire('deviceorientation', e.orient); env.fire('devicemotion', e.motion);
        ev += FRAME_MS;
      }
      env.t = now;
      for (var n = 0; n < 2; n++) {
        var tS = now - FRAME_MS + (n + 1) * STEP_MS;
        motion.sample(tS, mo);
        var oL = fL.feel(mo.x, mo.y, STEP_MS / 1000, tS / 1000, true, LAM), oF = fF.feel(mo.x, mo.y, STEP_MS / 1000, tS / 1000, true, LAM);
        if (tS / 1000 <= pre) continue;
        if (name === 'gentle' && (oL[0] !== fL.x1 || oL[1] !== fL.y1)) gentleExact = false;
        r.t.push(tS / 1000 - pre); r.x.push(mo.x); r.ox.push(oL[0]);
        if (Math.hypot(mo.x, mo.y) >= Felt.FILM_QUIET) { r.moving++; if (fF.behind >= 0.25) r.behind++; }
      }
    }
    var lag = lagOf(r.t, r.x, r.ox, 1, dur, 0.6), share = r.behind / Math.max(1, r.moving);
    if (share < 0.8) filmBehind = false;
    liveLag = Math.max(liveLag, lag);
    rows.push(name + ': the film 0.25 s behind or more for ' + Math.round(100 * share) + ' % of the moving time, live ' + ms(lag) + ' late');
  });
  log('  through motion.js: ' + rows.join('; '));
  check(filmBehind && liveLag <= 0.04 && gentleExact,
    'through the real motion.js, the replay streams: the film (control) is 0.25 s behind or more for over 80 % of the moving time on each, live best matches its input at most ' + ms(liveLag) + ' late (<= 40: the smoothing, and a hard shake\'s peaks over the cap paid just after), and handling the phone (gentle) reaches the sand live exactly as felt');
}

main().catch(function (e) { failures++; log('FAIL  ' + (e && e.stack || e)); }).then(function () {
  log((failures ? 'realsand-felt: ' + failures + ' of ' + count + ' checks FAILED' : 'realsand-felt: all ' + count + ' checks passed') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  process.exit(failures ? 1 : 0);
});
