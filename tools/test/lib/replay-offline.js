/*
 * The phone-motion chain in Node, on a virtual clock, for the replay suites
 * (development only, not shipped):
 *
 *   sensor stream (lib/replay-streams.js, 60 events a second, WebKit's signs)
 *     -> the REAL motion.js (in a vm, fake window and clock)
 *     -> the frame loop's part in it as app.js has it (copied below: the
 *        heading, arming, the shake counter's swings, composeField)
 *     -> the REAL Sim (physics.js), its clock running as lib/clock.js
 *
 * It answers, for any stream: what reached the sim, whether damage was
 * armed, how fast the beds landed, and when the glass creaked, cracked and
 * chipped. Deterministic and faster than real time, so a suite can run
 * every stream on several glasses.
 *
 *   var O = require('./lib/replay-offline.js');
 *   var r = O.run('vigorousZ', { seed: 11, startMs: 60000 });
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Streams = require('./replay-streams.js');
var H = require('./harness.js');

var ROOT = path.resolve(__dirname, '..', '..', '..');
var MOTION_SRC = fs.readFileSync(path.join(ROOT, 'motion.js'), 'utf8');
var IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

var P = H.P, MOT = P.Sim.MOTION, DMG = P.Sim.DMG;
var STEP_MS = 1000 / 120, FRAME_MS = 1000 / 60, EVENT_MS = 1000 / 60, DT = 1 / 120;
var ALPHA_K = 1 - Math.exp(-DT / 0.04);              // app.js ALPHA_K

/** motion.js in a fake iPhone browser whose clock is env.t (ms). */
function makeMotion() {
  var env = { t: 0, listeners: {}, docListeners: {} };
  function add(map) { return function (type, fn) { (map[type] = map[type] || []).push(fn); }; }
  function remove(map) {
    return function (type, fn) { var a = map[type] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  }
  var doc = { hidden: false, addEventListener: add(env.docListeners), removeEventListener: remove(env.docListeners) };
  var DM = function () {}, DO = function () {};
  DM.requestPermission = DO.requestPermission = function () { return Promise.resolve('granted'); };
  var win = {
    addEventListener: add(env.listeners), removeEventListener: remove(env.listeners),
    performance: { now: function () { return env.t; } },
    navigator: { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 },
    screen: { orientation: { angle: 0 } }, orientation: 0, document: doc,
    DeviceMotionEvent: DM, DeviceOrientationEvent: DO, console: console
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(MOTION_SRC, win, { filename: 'motion.js' });
  env.M = win.HourglassMotion;
  env.motion = new env.M({ sign: 0 });
  env.fire = function (type, ev) {
    ev.type = type; ev.timeStamp = env.t;
    var a = (env.listeners[type] || []).slice();
    for (var i = 0; i < a.length; i++) a[i](ev);
  };
  return env;
}

function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Play a stream through the whole chain. Options:
 *   seed, durMs (the glass: default 5 min), startMs (how far into its run),
 *   idle (true: never started, all the sand above, the gate shut),
 *   lam (default 0.08: the glass in Zen on an iPhone 12),
 *   pre, post (s of the phone held still before and after; default 2 and 1),
 *   dur (s, default the stream's), stream (options for the stream: peak, width, phase),
 *   reduced (Reduce Motion).
 * Times in the result count from the start of the stream itself.
 */
function run(name, o) {
  o = o || {};
  var st = Streams.get(name), dur = o.dur || st.dur, pre = o.pre === undefined ? 2 : o.pre, post = o.post === undefined ? 1 : o.post;
  var glass = H.glassAt({ durMs: o.durMs || 300000, startMs: o.idle ? 0 : (o.startMs === undefined ? 60000 : o.startMs), seed: o.seed || 11 });
  var sim = glass.sim, T = glass.T, G = sim.G;
  if (o.idle) T.state = 'idle';
  var env = makeMotion(), motion = env.motion;
  motion.start();
  var reduced = !!o.reduced, lam = o.lam === undefined ? 0.08 : o.lam;
  sim.reduced = reduced; sim.quality = 2;

  var rec = {
    name: typeof name === 'string' ? name : name.G + ' g ' + name.f + ' Hz ' + (name.axis || 'y'), dur: dur,
    inPeak: 0,                                           // the phone's true acceleration, g (all three axes)
    outPeakXY: 0, outPeakZ: 0,                           // what the sim was given, g (in the page's plane; out of it)
    peakRms: 0, armedAt: null, swings: 0, blows: 0, loaded: 0,
    landings: 0, peakLandV: 0,
    firstCreak: null, creaks: 0, firstCrack: null, cracks: 0, firstBreach: null, firstLeak: null,
    dMax: 0, dMaxSite: '', lost: 0
  };
  var landing = sim._landing;
  sim._landing = function (b, x, endY, n, v, dir) {
    if (n) { rec.landings++; if (v > rec.peakLandV) rec.peakLandV = v; }
    return landing.call(sim, b, x, endY, n, v, dir);
  };

  var s = {}, mo = { x: 0, y: 0, z: 0, w: 0, wf: 0, rms: 0, armed: false, live: false };
  var total = pre + dur + post, nFrames = Math.round(total * 60);
  var nextEv = 3, now = 0, alLP = 0, wPrev = 0, lastMotion = -1e9, gravTarget = 0;
  for (var fr = 0; fr < nFrames; fr++) {
    now = (fr + 1) * FRAME_MS;
    // sensor events up to this frame, one every 16.67 ms (3 ms out of phase with the frames)
    while (nextEv <= now) {
      env.t = nextEv;
      var ts = nextEv / 1000 - pre;
      if (ts >= 0 && ts <= dur) Streams.sample(name, ts, s, o.stream); else Streams.sample('still', nextEv / 1000, s);
      var ev = Streams.deviceEvents(s, 'ios');
      env.fire('deviceorientation', ev.orient);
      env.fire('devicemotion', ev.motion);
      if (ts >= 0 && ts <= dur) {
        var am = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
        if (am > rec.inPeak) rec.inPeak = am;
      }
      nextEv += EVENT_MS;
    }
    env.t = now;
    // app.js frame(): the clock, the heading, the valve, arming, the shake's swings
    T.tick(FRAME_MS, false);
    var hd = motion.heading;
    if (hd === hd && isFinite(hd)) gravTarget = hd;
    var want = gravTarget;                               // stepGravity (grav.base 0: the phone is the right way up)
    if (want > -0.045 && want < 0.045) want = 0;
    var d = wrapPi(want - sim.tilt);
    if (d > 0.0008 || d < -0.0008) { sim.tilt = wrapPi(sim.tilt + d * (1 - Math.exp(-FRAME_MS / 100))); sim.wakeAll(); }
    else if (d !== 0) { sim.tilt = wrapPi(want); sim.wakeAll(); }
    T.apply(now, false, false);
    sim.relCap = T.relCap(now - lastMotion < 2000);
    sim.damageArmed = motion.armed && !reduced;          // (grav.on is true here: Real motion is on)
    sim.spinArmed = false;                               // no finger on the glass
    var nsw = motion.takeSwings();
    if (nsw) { rec.blows += nsw; if (sim.shake(nsw) >= 0) rec.loaded += nsw; }
    if (motion.swings > rec.swings) rec.swings = motion.swings;
    sim.beginFrame();
    for (var n = 0; n < 2; n++) {
      var tS = now - FRAME_MS + (n + 1) * STEP_MS;
      motion.sample(tS, mo);                             // composeField
      var mx = mo.x, my = mo.y, mz = mo.z, tw = mo.w, wf = mo.wf;
      if (reduced) {
        mx *= 0.5; my *= 0.5;
        var m = Math.sqrt(mx * mx + my * my);
        if (m > 0.8) { mx *= 0.8 / m; my *= 0.8 / m; }
        mz *= 0.5;
        if (tw > 6) tw = 6; else if (tw < -6) tw = -6;
        if (wf > 6) wf = 6;
      }
      var w = tw + wf, c = Math.cos(sim.angle), sn = Math.sin(sim.angle);
      alLP += ((w - wPrev) / DT - alLP) * ALPHA_K; wPrev = w;
      var al = alLP > 300 ? 300 : (alLP < -300 ? -300 : alLP);
      sim.setMotion(G * (mx * c + my * sn), G * (-mx * sn + my * c), w, al, lam, mz);
      sim.step();
      if (sim.motionActive()) lastMotion = now;
      var tt = tS / 1000 - pre;
      if (tt >= 0 && tt <= dur + post) {
        var xy = Math.sqrt(mx * mx + my * my);
        if (xy > rec.outPeakXY) rec.outPeakXY = xy;
        if (mz > rec.outPeakZ) rec.outPeakZ = mz;
        if (motion.rms > rec.peakRms) rec.peakRms = motion.rms;
        if (sim.damageArmed && rec.armedAt === null) rec.armedAt = tt;
        if (sim.dMax > rec.dMax) { rec.dMax = sim.dMax; rec.dMaxSite = H.segName(sim.warnSeg); }
        if (rec.firstLeak === null && sim.lost > 0) rec.firstLeak = tt;
      }
    }
    var f = sim.frame, tf = now / 1000 - pre;
    for (var e = 0; e < f.dmgN; e++) {
      var ty = f.dmgType[e];
      if (ty === DMG.WARN) { rec.creaks++; if (rec.firstCreak === null) rec.firstCreak = tf; }
      else if (ty === DMG.CRACK) { rec.cracks++; if (rec.firstCrack === null) rec.firstCrack = tf; }
      else if (ty === DMG.BREACH && rec.firstBreach === null) rec.firstBreach = tf;
    }
    sim.escN = 0;
    T.maybeRetime((now - lastMotion) / 1000, now);
  }
  rec.lost = sim.lost;
  rec.segDmax = 0;
  for (var q = 0; q < sim.segD.length; q++) if (sim.segD[q] > rec.segDmax) rec.segDmax = sim.segD[q];
  rec.vTh = MOT.xTh * MOT.vc * Math.sqrt(G);             // the landing speed at the fatigue limit, cells/s
  return rec;
}

module.exports = { run: run, makeMotion: makeMotion, Streams: Streams, H: H, ROOT: ROOT, MOT: MOT };
