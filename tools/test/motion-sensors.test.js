/*
 * audio-motion acceptance 1–4: motion.js against a rigid-body forward model.
 *
 * motion.js runs in a vm context with a fake window and document. A phone,
 * held as a person would hold it for each screen angle, is shaken with the
 * hand profiles of tools/test/lib/profiles.js; each reading is turned into
 * the DeviceMotionEvent and DeviceOrientationEvent that phone would send, in
 * each browser's sign convention, and m.sample() is read at the app's
 * 120 Hz steps. Checks:
 *
 *   1. sign and units learnt; felt acceleration matches the truth in
 *      direction and size; dead zone; clamp
 *   2. heading equals today's onOrient; twist and flat-spin rates
 *   3. arming: hard shakes arm, everyday motion never does
 *   4. staleness, readings ignored while hidden, the fade-in after reset()
 *
 *   node tools/test/motion-sensors.test.js        exits 0 when every case passes
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var Profiles = require('./lib/profiles.js');

var ROOT = path.resolve(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'motion.js'), 'utf8');
var G0 = 9.80665, RAD = Math.PI / 180, TAU = Math.PI * 2;
var ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Mobile Safari/537.36';

var failures = 0, cases = 0;
function report(ok, name, detail) {
  cases++;
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
}

/* ---- a fake browser around motion.js -------------------------------------- */
function makeEnv(opts) {
  opts = opts || {};
  var env = { t: 0, hidden: false, angle: 0, winOrientation: undefined, listeners: {}, docListeners: {} };
  function add(map) {
    return function (type, fn) { (map[type] = map[type] || []).push(fn); };
  }
  function remove(map) {
    return function (type, fn) {
      var a = map[type] || [], i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    };
  }
  var doc = {
    addEventListener: add(env.docListeners),
    removeEventListener: remove(env.docListeners)
  };
  Object.defineProperty(doc, 'hidden', { get: function () { return env.hidden; } });
  var win = {
    addEventListener: add(env.listeners),
    removeEventListener: remove(env.listeners),
    performance: { now: function () { return env.t; } },
    navigator: { userAgent: opts.ua || ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 },
    screen: { orientation: {} },
    document: doc,
    DeviceMotionEvent: function () {},
    DeviceOrientationEvent: function () {},
    console: console
  };
  Object.defineProperty(win.screen.orientation, 'angle', { get: function () { return env.angle; } });
  Object.defineProperty(win, 'orientation', { get: function () { return env.winOrientation; } });
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'motion.js' });
  env.win = win;
  env.M = win.HourglassMotion;
  env.fire = function (type, ev) {
    ev.type = type;
    if (ev.timeStamp === undefined) ev.timeStamp = env.t;
    var a = (env.listeners[type] || []).slice();
    for (var i = 0; i < a.length; i++) a[i](ev);
  };
  env.setHidden = function (h) {
    env.hidden = h;
    var a = (env.docListeners.visibilitychange || []).slice();
    for (var i = 0; i < a.length; i++) a[i]({ type: 'visibilitychange' });
  };
  return env;
}

/* ---- deterministic noise ---------------------------------------------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { return (r() + r() + r() + r() - 2) * 1.732; }

/*
 * How a person holds the phone for each screen angle so the page is upright,
 * leaning back 15°: (beta, gamma) of deviceorientation.
 */
var HOLD = {
  '0': { beta: 75, gamma: 4 },
  '90': { beta: 3, gamma: -75 },
  '-90': { beta: -3, gamma: 75 },
  '180': { beta: -75, gamma: -4 }
};

/**
 * Run one scenario. sched(t) → {f: felt page-frame g (x, y, z, w), quiet}
 * for t in s. Events at 60 Hz, samples at 120 Hz. Returns the sample log.
 */
function run(env, m, opts) {
  var dur = opts.dur, conv = opts.conv, o = opts.o, hold = opts.hold || HOLD[String(o)];
  var noise = opts.noise === undefined ? 0.004 : opts.noise;
  var rnd = mulberry32(opts.seed || 7);
  var EV = 1000 / 60, ST = 1000 / 120;
  var log = [], nextEv = 0, f = { x: 0, y: 0, z: 0, w: 0 }, out = {};
  var lockAt = -1, signAt = -1;
  for (var step = 0; step * ST <= dur * 1000; step++) {
    var ts = step * ST;
    while (nextEv <= ts + 1e-9) {
      var te = nextEv + (opts.jitter ? (rnd() - 0.5) * 2 : 0);
      env.t = te;
      opts.felt(te / 1000, f);
      var fe = { x: f.x + noise * gauss(rnd), y: f.y + noise * gauss(rnd), z: (f.z || 0) + noise * gauss(rnd), w: f.w || 0 };
      var ev = Profiles.deviceEvent(fe, { conv: conv === 'spec-noorient' ? 'spec' : conv, o: o, beta: hold.beta, gamma: hold.gamma, noAccel: opts.noAccel });
      if (opts.rotationRate) ev.rotationRate = opts.rotationRate(te / 1000);
      if (conv !== 'spec-noorient' && !opts.noOrient) {
        var oe = opts.orient ? opts.orient(te / 1000) : Profiles.orientationEvent(hold);
        oe.timeStamp = te;
        env.fire('deviceorientation', oe);
      }
      ev.timeStamp = te;
      env.fire('devicemotion', ev);
      if (lockAt < 0 && m.locked) lockAt = te;
      if (signAt < 0 && m.sign) signAt = te;
      nextEv += EV;
    }
    env.t = ts;
    m.sample(ts, out);
    log.push({ t: ts / 1000, x: out.x, y: out.y, z: out.z, w: out.w, wf: out.wf, rms: out.rms, armed: out.armed, live: out.live });
  }
  return { log: log, lockAt: lockAt, signAt: signAt };
}

/**
 * Best normalised cross-correlation of (x, y) with the truth delayed 0–60 ms
 * (the read-back is 17 ms by design). amp: RMS of the output over the RMS
 * of the truth at that lag; ampDz: the same against the truth after the
 * designed 0.06 g soft dead zone, the one deliberate change of size.
 */
function compare(log, truth, t0, t1) {
  var best = { corr: -2, lag: 0, amp: 0, ampDz: 0 }, f = { x: 0, y: 0, z: 0, w: 0 };
  for (var lag = 0; lag <= 60; lag++) {
    var sxy = 0, sxx = 0, syy = 0, szz = 0;
    for (var i = 0; i < log.length; i++) {
      var s = log[i];
      if (s.t < t0 || s.t > t1) continue;
      truth(s.t - lag / 1000, f);
      sxy += s.x * f.x + s.y * f.y;
      sxx += s.x * s.x + s.y * s.y;
      syy += f.x * f.x + f.y * f.y;
      var m = Math.sqrt(f.x * f.x + f.y * f.y), d = m > 0.06 ? m - 0.06 : 0;
      szz += d * d;
    }
    var c = sxy / Math.sqrt(sxx * syy + 1e-30);
    if (c > best.corr) best = { corr: c, lag: lag, amp: Math.sqrt(sxx / (syy + 1e-30)), ampDz: Math.sqrt(sxx / (szz + 1e-30)) };
  }
  return best;
}

/* ======================================================================
 *  1. Forward model: conventions × screen angles × with/without acceleration
 * ==================================================================== */
function section1() {
  console.log('\n1. Forward model');
  var CONVS = ['spec', 'ios', 'ios-g', 'spec-noorient'];
  var ANGLES = [0, 90, -90, 180];
  var PROFILES = ['normal', 'veryVigSlow', 'lateralVV'];
  // still (calibration) → a 0.03 g wobble (dead zone) → the shake → 12 g (clamp)
  var DZ0 = 1.5, SHAKE0 = 2.6, SHAKE = 4, CLAMP0 = SHAKE0 + SHAKE + 0.5;
  CONVS.forEach(function (conv) {
    ANGLES.forEach(function (o) {
      [false, true].forEach(function (noAccel) {
        PROFILES.forEach(function (pname, pi) {
          var env = makeEnv();
          env.winOrientation = o;
          var m = new env.M({ sign: 0 });
          var signs = [];
          m.onsign = function (s) { signs.push(s); };
          m.start();
          function felt(t, f) {
            f.x = 0; f.y = 0; f.z = 0; f.w = 0;
            if (t >= DZ0 && t < DZ0 + 1) { f.x = 0.03 * Math.sin(TAU * 3 * t); f.y = 0.03 * Math.cos(TAU * 2 * t); }
            else if (t >= SHAKE0 && t < SHAKE0 + SHAKE) Profiles.sample(pname, t - SHAKE0, f);
            else if (t >= CLAMP0 && t < CLAMP0 + 0.6) { f.y = 12 * Math.sin(TAU * 3 * (t - CLAMP0)); }
          }
          var r = run(env, m, { dur: CLAMP0 + 0.8, conv: conv, o: o, noAccel: noAccel, felt: felt, seed: 11 + pi * 7 + o, jitter: true });
          var want = conv === 'ios' || conv === 'ios-g' ? -1 : 1;
          var name = conv + ' o=' + o + (noAccel ? ' no-accel' : ' accel') + ' ' + pname;
          // sign: learnt within 0.5 s of still readings, or via the prior/fallback by 1.5 s
          var signOk = m.sign === want && signs.length <= 1 && (r.lockAt >= 0 ? r.lockAt <= 500 : r.signAt <= 1500 + 17);
          var lockedNote = r.lockAt >= 0 ? 'locked ' + r.lockAt.toFixed(0) + ' ms' : 'prior at ' + r.signAt.toFixed(0) + ' ms';
          var cmp = compare(r.log, function (t, f) { felt(t, f); }, SHAKE0 + 0.4, SHAKE0 + SHAKE - 0.05);
          var deadMax = 0, clampMax = 0;
          r.log.forEach(function (s) {
            var mag = Math.sqrt(s.x * s.x + s.y * s.y);
            if (s.t >= DZ0 + 0.1 && s.t < DZ0 + 1) deadMax = Math.max(deadMax, mag);
            if (s.t >= CLAMP0 && s.t < CLAMP0 + 0.8) clampMax = Math.max(clampMax, mag);
          });
          var ok = signOk && cmp.corr > 0.99 && Math.abs(cmp.ampDz - 1) <= 0.05 && deadMax === 0 && clampMax <= 8 + 1e-9 && clampMax > 7.5;
          report(ok, name, 'sign ' + m.sign + ' (' + lockedNote + ')  corr ' + cmp.corr.toFixed(4) + ' at ' + cmp.lag + ' ms  amp ' +
                 cmp.ampDz.toFixed(3) + ' (raw ' + cmp.amp.toFixed(3) + ')  dead-zone max ' + deadMax.toFixed(4) + ' g  clamp max ' + clampMax.toFixed(3) + ' g');
        });
      });
    });
  });
  // the screen angle read from screen.orientation when window.orientation is absent (270 ≡ −90)
  (function () {
    var env = makeEnv();
    env.angle = 270;
    var m = new env.M({});
    m.start();
    function felt(t, f) { f.x = 0; f.y = 0; f.z = 0; f.w = 0; if (t >= 1.5) Profiles.sample('lateralVV', t - 1.5, f); }
    var r = run(env, m, { dur: 4, conv: 'ios', o: -90, felt: felt, seed: 5 });
    var cmp = compare(r.log, felt, 2.0, 3.95);
    report(cmp.corr > 0.99 && Math.abs(cmp.ampDz - 1) <= 0.05 && m.sign === -1, 'screen.orientation.angle 270 (no window.orientation)',
           'corr ' + cmp.corr.toFixed(4) + '  amp ' + cmp.ampDz.toFixed(3) + ' (raw ' + cmp.amp.toFixed(3) + ')  sign ' + m.sign);
  })();
  // a persisted sign is used at once; the readings still have the last word
  (function () {
    var env = makeEnv();
    var m = new env.M({ sign: 1 });
    var got = [];
    m.onsign = function (s) { got.push(s); };
    var before = m.sign;
    m.start();
    run(env, m, { dur: 1, conv: 'ios', o: 0, felt: function (t, f) { f.x = f.y = f.z = f.w = 0; } });
    report(before === 1 && m.sign === -1 && got.length === 1 && got[0] === -1, 'persisted sign used, then corrected by readings',
           'before ' + before + ', after ' + m.sign + ', onsign ' + JSON.stringify(got));
  })();
}

/* ======================================================================
 *  2. Heading and rotation
 * ==================================================================== */
function onOrientRef(beta, gamma, o, last) {         // app.js f446085, verbatim maths
  var b = beta * RAD, g = gamma * RAD, t;
  var gx = Math.cos(b) * Math.sin(g), gy = Math.sin(b);
  if (o === 90) { t = gx; gx = gy; gy = -t; }
  else if (o === -90 || o === 270) { t = gx; gx = -gy; gy = t; }
  else if (o === 180) { gx = -gx; gy = -gy; }
  if (gx * gx + gy * gy < 0.05) return last;
  return Math.atan2(gx, gy);
}

function section2() {
  console.log('\n2. Heading and rotation');
  // 50 random holds, every screen angle
  (function () {
    var env = makeEnv(), m = new env.M({}), rnd = mulberry32(99), last = NaN, worst = 0, n = 0, flat = 0;
    m.start();
    var OS = [0, 90, -90, 180, 270];
    for (var i = 0; i < 50; i++) {
      var beta = -180 + 360 * rnd(), gamma = -90 + 180 * rnd(), o = OS[(rnd() * OS.length) | 0];
      if (i % 10 === 9) { beta = 3 * (rnd() - 0.5); gamma = 3 * (rnd() - 0.5); }     // now and then lying flat
      env.t += 16.7;
      env.winOrientation = o;
      env.fire('deviceorientation', { alpha: 0, beta: beta, gamma: gamma, absolute: false });
      var ref = onOrientRef(beta, gamma, o, last);
      if (ref === last) flat++;
      last = ref;
      var err = Math.abs(m.heading - ref);
      if (!(err <= 1e-12)) worst = Infinity; else worst = Math.max(worst, err);
      n++;
    }
    report(worst <= 1e-12, 'heading equals onOrient for 50 random (beta, gamma, o)', 'worst |error| ' + worst + ' rad, ' + flat + ' flat (kept last)');
  })();
  // upright twist, 3 rad/s clockwise, leaning back 15°, at two screen angles
  [0, 90].forEach(function (o) {
    var env = makeEnv(), m = new env.M({}), out = {};
    env.winOrientation = o;
    m.start();
    var phi = 15 * RAD, W = 3, sum = 0, cnt = 0;
    for (var k = 0; k <= 180; k++) {
      var t = k / 60;
      env.t = t * 1000;
      // in the user's hand the page turns clockwise by θ; device-axis "down" for that hold
      var th = W * t, base = o === 90 ? -Math.PI / 2 : 0;     // landscape: the page is upright when the device is turned 90°
      var a = th + base;
      var dx = Math.cos(phi) * Math.sin(a), dy = -Math.cos(phi) * Math.cos(a), dz = -Math.sin(phi);
      var beta = Math.asin(-dy) / RAD, gamma = Math.atan2(dx, -dz) / RAD;
      env.fire('deviceorientation', { alpha: 0, beta: beta, gamma: gamma, absolute: false });
      env.fire('devicemotion', Profiles.deviceEvent({ x: 0, y: 0 }, { conv: 'spec', o: o, beta: beta, gamma: gamma }));
      if (t >= 1) { m.sample(env.t, out); sum += out.w; cnt++; }
    }
    var w = sum / cnt;
    report(Math.abs(w - W) <= 0.05 * W, 'twist 3 rad/s upright, o=' + o, 'w = ' + w.toFixed(3) + ' rad/s');
  });
  // flat on a table spinning at 4 rad/s, with and without orientation, both rate conventions
  [['spec', true], ['ios', true], ['spec', false]].forEach(function (c) {
    var env = makeEnv(), m = new env.M({}), out = {}, sum = 0, cnt = 0, W = 4;
    m.start();
    for (var k = 0; k <= 180; k++) {
      var t = k / 60;
      env.t = t * 1000;
      if (c[1]) env.fire('deviceorientation', { alpha: (W * t / RAD) % 360, beta: 0.5, gamma: -0.3, absolute: false });
      var ev = Profiles.deviceEvent({ x: 0, y: 0 }, { conv: c[0], o: 0, beta: 0.5, gamma: -0.3 });
      var dps = W / RAD;
      // W3C puts the screen-normal rate in alpha; iOS builds (x, y, z) → (alpha, beta, gamma)
      ev.rotationRate = c[0] === 'ios' ? { alpha: 0.4, beta: -0.2, gamma: -dps } : { alpha: dps, beta: 0.3, gamma: -0.1 };
      env.fire('devicemotion', ev);
      if (t >= 1) { m.sample(env.t, out); sum += out.wf; cnt++; }
    }
    var wf = sum / cnt;
    report(Math.abs(wf - W) <= 0.05 * W, 'flat spin 4 rad/s (' + c[0] + (c[1] ? ', with orientation' : ', no orientation') + ')',
           'wf = ' + wf.toFixed(3) + ' rad/s');
  });
  // a gentle wobble while flat is not a spin
  (function () {
    var env = makeEnv(), m = new env.M({}), out = {}, max = 0;
    m.start();
    for (var k = 0; k <= 180; k++) {
      env.t = k * 1000 / 60;
      env.fire('deviceorientation', { alpha: 0, beta: 1, gamma: 0, absolute: false });
      var ev = Profiles.deviceEvent({ x: 0, y: 0 }, { conv: 'spec', o: 0, beta: 1, gamma: 0 });
      ev.rotationRate = { alpha: 20 * Math.sin(k / 9), beta: 30 * Math.cos(k / 7), gamma: 0 };   // ≤ 0.63 rad/s
      env.fire('devicemotion', ev);
      m.sample(env.t, out);
      max = Math.max(max, out.wf);
    }
    report(max === 0, 'flat wobble below 1.5 rad/s reads no spin', 'max wf ' + max);
  })();
}

/* ======================================================================
 *  3. Arming
 * ==================================================================== */
function section3() {
  console.log('\n3. Arming');
  var STILL = 1.5;
  function arming(name, felt, dur) {
    var env = makeEnv(), m = new env.M({});
    m.start();
    var r = run(env, m, { dur: STILL + dur, conv: 'ios', o: 0, felt: function (t, f) {
      f.x = 0; f.y = 0; f.z = 0; f.w = 0;
      if (t >= STILL) felt(t - STILL, f);
    }, seed: 3 });
    var first = -1, maxRms = 0;
    r.log.forEach(function (s) {
      if (s.armed && first < 0) first = s.t - STILL;
      if (s.t >= STILL) maxRms = Math.max(maxRms, s.rms);
    });
    return { first: first, maxRms: maxRms };
  }
  var a = arming('vigSlow60', function (t, f) { Profiles.sample('vigSlow60', t, f); }, 3);
  report(a.first >= 0 && a.first <= 0.8, 'Γ4 at 3.5 Hz arms within 0.8 s', 'armed at ' + (a.first >= 0 ? a.first.toFixed(3) + ' s' : 'never') + ', peak RMS ' + a.maxRms.toFixed(2) + ' g');
  var b = arming('veryVigSlow', function (t, f) { Profiles.sample('veryVigSlow', t, f); }, 3);
  report(b.first >= 0 && b.first <= 0.8, 'Γ5.5 at 4 Hz arms within 0.8 s', 'armed at ' + (b.first >= 0 ? b.first.toFixed(3) + ' s' : 'never') + ', peak RMS ' + b.maxRms.toFixed(2) + ' g');
  var never = [
    ['walking', function (t, f) { Profiles.sample('walking', t, f); }, 12],
    ['running', function (t, f) { Profiles.sample('running', t, f); }, 12],
    ['drop: 0.35 s free fall, then a 12 g 35 ms spike', function (t, f) { Profiles.sample('drop', t, f); }, 4],
    ['3 g knocks every 0.5 s', function (t, f) { if (t % 0.5 < 0.034) f.y = -3; }, 8],
    ['normal (Γ2 at 4.5 Hz)', function (t, f) { Profiles.sample('normal', t, f); }, 12]
  ];
  never.forEach(function (c) {
    var r = arming(c[0], c[1], c[2]);
    report(r.first < 0, 'never armed: ' + c[0], 'peak RMS ' + r.maxRms.toFixed(2) + ' g');
  });
  // disarms after 0.5 s below 1.2 g
  (function () {
    var env = makeEnv(), m = new env.M({});
    m.start();
    var r = run(env, m, { dur: 5, conv: 'spec', o: 0, felt: function (t, f) {
      f.x = 0; f.y = 0; f.z = 0; f.w = 0;
      if (t >= 1.5 && t < 3.5) Profiles.sample('vigSlow60', t - 1.5, f);
    } });
    var offAt = -1, wasArmed = false;
    r.log.forEach(function (s) {
      if (s.armed) wasArmed = true;
      if (wasArmed && !s.armed && offAt < 0 && s.t > 3.5) offAt = s.t - 3.5;
    });
    report(wasArmed && offAt > 0.5 && offAt < 1.0, 'disarms 0.5–1 s after the shake stops', 'disarmed ' + (offAt >= 0 ? offAt.toFixed(3) + ' s' : 'never') + ' after');
  })();
}

/* ======================================================================
 *  4. Staleness, visibility, fade-in
 * ==================================================================== */
function section4() {
  console.log('\n4. Staleness, visibility, fade-in');
  // a steady 1 g push, then the readings stop
  (function () {
    var env = makeEnv(), m = new env.M({}), out = {};
    m.start();
    var last = 0;
    for (var k = 0; k <= 150; k++) {                    // 2.5 s of readings
      env.t = k * 1000 / 60;
      env.fire('deviceorientation', Profiles.orientationEvent({}));
      env.fire('devicemotion', Profiles.deviceEvent({ x: 1, y: 0 }, { conv: 'spec' }));
      last = env.t;
    }
    function at(dtMs) { env.t = last + dtMs; return m.sample(env.t, out).x; }
    var v100 = at(100), v150 = at(150), v200 = at(200), v250 = at(250), v400 = at(400);
    var ok = Math.abs(v100 - 0.94) < 0.02 && Math.abs(v150 - 0.94) < 0.02 && Math.abs(v200 - 0.47) < 0.02 && v250 === 0 && v400 === 0;
    report(ok, 'no reading for 150 ms: x decays to 0 by 250 ms',
           'x at +100/150/200/250/400 ms: ' + [v100, v150, v200, v250, v400].map(function (v) { return v.toFixed(3); }).join(' / '));
  })();
  // hidden: readings ignored; back on the page: a fresh fade-in
  (function () {
    var env = makeEnv(), m = new env.M({}), out = {};
    m.start();
    var k;
    for (k = 0; k <= 150; k++) {
      env.t = k * 1000 / 60;
      env.fire('deviceorientation', Profiles.orientationEvent({}));
      env.fire('devicemotion', Profiles.deviceEvent({ x: 0.5, y: 0 }, { conv: 'spec' }));
    }
    var before = m.sample(env.t, out).x;
    env.setHidden(true);
    var t0 = env.t, maxHidden = 0;
    for (k = 1; k <= 120; k++) {                        // 2 s of hard shaking while hidden
      env.t = t0 + k * 1000 / 60;
      env.fire('deviceorientation', Profiles.orientationEvent({}));
      env.fire('devicemotion', Profiles.deviceEvent({ x: 0, y: 4 * Math.sin(k) }, { conv: 'spec' }));
      maxHidden = Math.max(maxHidden, Math.abs(m.sample(env.t, out).y));
    }
    var armedHidden = m.armed;
    env.setHidden(false);
    var t1 = env.t, xs = [];
    for (k = 1; k <= 90; k++) {                         // 1.5 s back on the page
      env.t = t1 + k * 1000 / 60;
      env.fire('deviceorientation', Profiles.orientationEvent({}));
      env.fire('devicemotion', Profiles.deviceEvent({ x: 0.5, y: 0 }, { conv: 'spec' }));
      xs.push(m.sample(env.t, out).x);
    }
    var ok = Math.abs(before - 0.44) < 0.02 && maxHidden === 0 && !armedHidden && xs[0] < 0.02 && Math.abs(xs[35] - 0.44 * 36 / 72) < 0.04 && Math.abs(xs[89] - 0.44) < 0.02;
    report(ok, 'readings ignored while hidden; fade-in again on return',
           'before ' + before.toFixed(3) + ', max |y| while hidden ' + maxHidden + ', after return x[0] ' + xs[0].toFixed(3) + ' x[0.6 s] ' + xs[35].toFixed(3) + ' x[1.5 s] ' + xs[89].toFixed(3));
  })();
  // reset(): a linear fade-in from 0 over 1.2 s
  (function () {
    var env = makeEnv(), m = new env.M({}), out = {};
    m.start();
    var k;
    for (k = 0; k <= 150; k++) {                        // still (the sign is learnt), then a steady push
      env.t = k * 1000 / 60;
      env.fire('deviceorientation', Profiles.orientationEvent({}));
      env.fire('devicemotion', Profiles.deviceEvent({ x: 0, y: k < 40 ? 0 : -0.5 }, { conv: 'ios' }));
    }
    var signBefore = m.sign;
    m.reset();
    var t0 = env.t, pts = [];
    for (k = 1; k <= 100; k++) {
      env.t = t0 + k * 1000 / 60;
      env.fire('deviceorientation', Profiles.orientationEvent({}));
      env.fire('devicemotion', Profiles.deviceEvent({ x: 0, y: -0.5 }, { conv: 'ios' }));
      var y = m.sample(env.t, out).y;
      pts.push([(env.t - t0 - 1000 / 60) / 1000, y]);     // time since the first reading after reset
    }
    // after the 17 ms read-back, y should follow −0.44·min(1, t/1.2)
    var worst = 0;
    pts.forEach(function (p) {
      var tt = p[0] - 0.017;
      if (tt < 0.02) return;
      var want = -0.44 * Math.min(1, tt / 1.2);
      worst = Math.max(worst, Math.abs(p[1] - want));
    });
    report(worst < 0.02 && Math.abs(pts[0][1]) < 1e-9 && signBefore === -1 && m.sign === -1, 'reset() fades in from 0 over 1.2 s (sign kept)',
           'worst deviation from the ramp ' + worst.toFixed(4) + ' g, sign ' + signBefore + ' → ' + m.sign);
  })();
  // stop(): silence, and listeners gone
  (function () {
    var env = makeEnv(), m = new env.M({}), out = {};
    m.start();
    for (var k = 0; k <= 60; k++) {
      env.t = k * 1000 / 60;
      env.fire('devicemotion', Profiles.deviceEvent({ x: 1, y: 0 }, { conv: 'spec' }));
    }
    m.stop();
    var n = (env.listeners.devicemotion || []).length + (env.listeners.deviceorientation || []).length + (env.docListeners.visibilitychange || []).length;
    var s = m.sample(env.t, out);
    report(n === 0 && s.x === 0 && !s.live, 'stop() removes the listeners and reads zero', n + ' listeners left');
  })();
  // desktop browsers send empty readings: they must not count as motion
  (function () {
    var env = makeEnv(), m = new env.M({});
    m.start();
    env.fire('devicemotion', { acceleration: null, accelerationIncludingGravity: { x: null, y: null, z: null }, rotationRate: null, interval: 0 });
    env.fire('deviceorientation', { alpha: null, beta: null, gamma: null, absolute: false });
    report(!m.seenMotion && !m.seenOrient && isNaN(m.heading), 'empty readings are not motion', 'seenMotion ' + m.seenMotion + ', seenOrient ' + m.seenOrient);
  })();
  // statics
  (function () {
    var M = makeEnv().M, ok = true;
    [[0, [1, 2]], [90, [2, -1]], [-90, [-2, 1]], [270, [-2, 1]], [180, [-1, -2]]].forEach(function (c) {
      var r = M.toPage(1, 2, c[0]);
      if (r[0] !== c[1][0] || r[1] !== c[1][1]) ok = false;
    });
    report(ok, 'HourglassMotion.toPage matches onOrient\'s remap');
  })();
}

section1();
section2();
section3();
section4();
console.log('\n' + (cases - failures) + '/' + cases + ' passed');
process.exit(failures ? 1 : 0);
