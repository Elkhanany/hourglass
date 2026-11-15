/*
 * Hand and phone motion for the tests (development only, not shipped).
 *
 * A profile says what the sand would feel, moment by moment, from a hand or
 * a phone: x, y the felt acceleration in g in the page frame (x right,
 * y down; gravity itself not included), z the out-of-plane part, w the
 * rotation rate (rad/s, + = clockwise on screen) and al its rate of change
 * (rad/s²). They are the physicist's calibration profiles, so the damage
 * thresholds in the spec refer to exactly these.
 *
 * The same file runs in Node (require) and in a page (as an init script,
 * window.HourglassProfiles), so the sim tests and the browser tests shake
 * the glass the same way. deviceEvent() turns a felt sample into the
 * DeviceMotionEvent a phone would send, in either sign convention.
 */
(function (root) {
  'use strict';

  var TAU = 2 * Math.PI;
  var DT = 1 / 120;                   // the sim's step, which the knocks are timed in
  var G0 = 9.80665;

  /**
   * A shaking hand is not a sine: it has harmonics, its frequency wanders
   * and its amplitude breathes. G peak felt acceleration in g at f Hz.
   */
  function human(G, f, t, seed) {
    var ph = TAU * f * t + 0.6 * Math.sin(TAU * 0.37 * t + seed);
    var amp = G * (0.9 + 0.1 * Math.sin(TAU * 0.8 * t + 2 * seed));
    return amp * (Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.7) + 0.08 * Math.sin(3 * ph + 1.3)) / 1.12;
  }

  function vigorous(t, o) { o.y = human(4.0, 5.5, t, 5); o.x = 0.8 * human(1, 5.5, t, 2); }
  function firm(t, o) { o.y = human(3.0, 5.0, t, 4); o.x = 0.5 * human(1, 5, t, 1); }
  function veryVigorous(t, o) { o.y = human(5.5, 5.5, t, 6); o.x = 1.0 * human(1, 5.5, t, 3); }

  /** name → {dur (s), fn(t, out)}; fn only sets the fields it uses. */
  var PROFILES = {
    calm: { dur: 12, fn: function () {} },
    sway: { dur: 12, fn: function (t, o) { o.x = 0.25 * Math.sin(TAU * 1.2 * t); } },
    walking: { dur: 12, fn: function (t, o) { o.y = 0.35 * Math.sin(TAU * 2 * t); o.x = 0.1 * Math.sin(TAU * t); } },
    running: { dur: 12, fn: function (t, o) { o.y = human(1.6, 2.8, t, 1); o.x = 0.3 * Math.sin(TAU * 1.4 * t); } },
    normal: { dur: 12, fn: function (t, o) { o.y = human(2.0, 4.5, t, 2); o.x = 0.4 * human(1, 4.5, t, 5); } },
    normalSlow: { dur: 12, fn: function (t, o) { o.y = human(2.0, 3.0, t, 3); o.x = 0.3 * human(1, 3, t, 7); } },
    firm: { dur: 12, fn: firm },
    vigorous: { dur: 15, fn: vigorous },
    veryVigorous: { dur: 15, fn: veryVigorous },
    veryVigSlow: { dur: 15, fn: function (t, o) { o.y = human(5.5, 4.0, t, 7); o.x = 1.0 * human(1, 4, t, 4); } },
    extreme: { dur: 10, fn: function (t, o) { o.y = human(7.0, 6.0, t, 8); o.x = 1.2 * human(1, 6, t, 5); } },
    lateralFirm: { dur: 20, fn: function (t, o) { o.x = human(3.5, 5.0, t, 13); o.y = 0.6 * human(1, 5, t, 14); } },
    veryVig30: { dur: 30, fn: veryVigorous },
    lateralVV: { dur: 15, fn: function (t, o) { o.x = human(6.0, 5.0, t, 9); o.y = 0.8 * human(1, 5, t, 6); } },
    // a firm knock every 2 s (Δv ≈ 0.5 m/s) and a violent single jerk (Δv ≈ 2.6 m/s)
    knocks: { dur: 10, fn: function (t, o) { if (t % 2 < 2 * DT) o.y = -3; } },
    hardJerks: { dur: 10, fn: function (t, o) { if (t % 2 < 4 * DT) o.y = -8; } },
    vigorous60: { dur: 60, fn: vigorous },
    firm60: { dur: 60, fn: firm },
    vigSlow60: { dur: 60, fn: function (t, o) { o.y = human(4.0, 3.5, t, 11); o.x = 0.6 * human(1, 3.5, t, 12); } },
    // dropped: weightless for 0.35 s (the sand floats), then caught hard
    drop: {
      dur: 4,
      fn: function (t, o) {
        if (t > 1 && t < 1.35) o.y = -1;
        else if (t >= 1.35 && t < 1.385) o.y = 12;
      }
    },
    // twiddling the glass on screen with a finger, ±0.25 rad at 3 Hz
    fingerWiggle: {
      dur: 10,
      fn: function (t, o) {
        var f = 3, A = 0.25;
        o.w = A * TAU * f * Math.cos(TAU * f * t);
        o.al = -A * TAU * TAU * f * f * Math.sin(TAU * f * t);
      }
    },
    // twisting the phone back and forth in its plane, up to 15 rad/s
    wristTwist: {
      dur: 8,
      fn: function (t, o) {
        var f = 1.5, W0 = 15;
        o.w = W0 * Math.sin(TAU * f * t);
        o.al = W0 * TAU * f * Math.cos(TAU * f * t);
        o.x = 0.4 * Math.sin(TAU * f * t);
      }
    },
    // spun flat on a table at 1.5 turns a second
    tableSpin: { dur: 8, fn: function (t, o) { o.w = t < 5 ? Math.min(1, t) * 9.4 : 0; } }
  };

  /** Profile `name` at t seconds, into out {x, y, z, w, al} (zeros where unset). */
  function sample(name, t, out) {
    var p = PROFILES[name];
    if (!p) throw new Error('unknown profile ' + name);
    out = out || {};
    out.x = 0; out.y = 0; out.z = 0; out.w = 0; out.al = 0;
    p.fn(t, out);
    return out;
  }

  /** Screen orientation o (0, 90, −90/270, 180): device screen frame (x right, y down) → page. */
  function toPage(x, y, o) {
    if (o === 90) return [y, -x];
    if (o === -90 || o === 270) return [-y, x];
    if (o === 180) return [-x, -y];
    return [x, y];
  }
  /** The inverse: page frame → device screen frame. */
  function fromPage(x, y, o) {
    if (o === 90) return [-y, x];
    if (o === -90 || o === 270) return [y, -x];
    if (o === 180) return [-x, -y];
    return [x, y];
  }

  /**
   * The DeviceMotionEvent init a phone would send while the sand feels f
   * ({x, y, z} in g, page frame; w in rad/s). Device axes: x right, y up,
   * z out of the screen, m/s².
   *   opts.conv    'spec' (W3C, Chrome, Android: face up reads aIG.z = +9.81),
   *                'ios' (WebKit/CoreMotion: both vectors negated) or
   *                'ios-g' (negated and in g)
   *   opts.o       screen orientation angle (0, 90, −90, 180)
   *   opts.beta, opts.gamma   how the phone is held, degrees (90, 0: upright portrait)
   *   opts.noAccel acceleration is null (only accelerationIncludingGravity)
   * The rotation rate goes in alpha (deg/s); the app reads only its magnitude.
   */
  function deviceEvent(f, opts) {
    opts = opts || {};
    var o = opts.o || 0, conv = opts.conv || 'spec';
    var beta = (opts.beta === undefined ? 90 : opts.beta) * Math.PI / 180;
    var gamma = (opts.gamma || 0) * Math.PI / 180;
    var s = fromPage(f.x || 0, f.y || 0, o);
    // felt = −(kinematic acceleration)/g, so the device accelerates against it
    var ax = -G0 * s[0], ay = G0 * s[1], az = -G0 * (f.z || 0);
    // spec: accelerationIncludingGravity = acceleration − gravity, gravity = g·down
    var dx = Math.cos(beta) * Math.sin(gamma), dy = -Math.sin(beta), dz = -Math.cos(beta) * Math.cos(gamma);
    var gx = ax - G0 * dx, gy = ay - G0 * dy, gz = az - G0 * dz;
    var k = conv === 'spec' ? 1 : (conv === 'ios-g' ? -1 / G0 : -1);
    return {
      acceleration: opts.noAccel ? null : { x: k * ax, y: k * ay, z: k * az },
      accelerationIncludingGravity: { x: k * gx, y: k * gy, z: k * gz },
      rotationRate: { alpha: (f.w || 0) * 180 / Math.PI, beta: 0, gamma: 0 },
      interval: 16.67
    };
  }

  /** The matching DeviceOrientationEvent init. */
  function orientationEvent(opts) {
    opts = opts || {};
    return { alpha: 0, beta: opts.beta === undefined ? 90 : opts.beta, gamma: opts.gamma || 0, absolute: false };
  }

  var api = {
    G0: G0,
    human: human,
    PROFILES: PROFILES,
    names: Object.keys(PROFILES),
    sample: sample,
    toPage: toPage,
    fromPage: fromPage,
    deviceEvent: deviceEvent,
    orientationEvent: orientationEvent
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HourglassProfiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
