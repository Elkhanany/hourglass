/*
 * What an iPhone's sensors report while a person handles it, for the replay
 * suites (development only, not shipped). Runs in Node (require) and in a
 * page (init script, window.PhoneStreams).
 *
 * A stream is fn(t, s): at t seconds it fills s with the phone's true state
 *
 *   s.ax, s.ay, s.az    kinematic acceleration of the phone, g, DEVICE axes as
 *                       W3C defines them: x to the right edge, y to the top
 *                       edge, z out of the screen (gravity not included)
 *   s.beta, s.gamma     how it is held, degrees (deviceorientation)
 *   s.ra, s.rb, s.rg    rotation rate about z, x, y, deg/s
 *
 * deviceEvents(s, conv) turns that into the two event inits. conv 'ios':
 * WebKit negates both acceleration vectors; 'spec': W3C/Chromium/Android.
 *
 * Magnitudes (peak g, Hz) are those of hand-held phones. They are models,
 * built from published magnitudes, not recordings:
 *   gentle     picking up, looking, tilting: <= 0.3 g, slow
 *   walking    phone in a swinging hand: 0.6 g at 2 Hz, 1.2 g heel strikes
 *   running    1.6 g at 2.8 Hz, 2.5 g foot strikes
 *   setDown    laid on a table or stood on its edge: one 3 to 12 g spike of 10 to 20 ms
 *   palmTap    tapped against the other palm: 3 to 8 g, 25 ms, 2.5 a second
 *   dropSoft   30 cm onto a sofa: 0.25 s of free fall, then a 4 g, 60 ms stop
 *   firm       a firm shake: 1.5 g at 3 Hz      (+-4.1 cm)
 *   vigorous   a vigorous shake: 3 g at 4.5 Hz  (+-3.7 cm)
 *   hardest    the hardest a hand does: 5.5 g at 5.5 Hz (+-4.5 cm)
 * A shake has an axis: 'y' along the phone's long edge (a spray can), 'x'
 * side to side, 'z' toward and away from the face, or 'wrist' (a rattle
 * about the wrist, most of it along z).
 */
(function (root) {
  'use strict';

  var TAU = 2 * Math.PI, G0 = 9.80665, RAD = Math.PI / 180;

  /** A shaking hand is not a sine: harmonics, a wandering frequency, a breathing amplitude (peak ~G). */
  function human(G, f, t, seed) {
    var ph = TAU * f * t + 0.6 * Math.sin(TAU * 0.37 * t + seed);
    var amp = G * (0.9 + 0.1 * Math.sin(TAU * 0.8 * t + 2 * seed));
    return amp * (Math.sin(ph) + 0.22 * Math.sin(2 * ph + 0.7) + 0.08 * Math.sin(3 * ph + 1.3)) / 1.12;
  }
  /** Sensor noise and tremor, deterministic: about 0.01 g rms. */
  function tremor(t, k) {
    return 0.008 * Math.sin(TAU * 9.3 * t + k) + 0.006 * Math.sin(TAU * 13.7 * t + 2.1 * k) + 0.004 * Math.sin(TAU * 31 * t + 0.7 * k);
  }
  /** A half-sine pulse of peak P lasting w seconds from t0. */
  function pulse(t, t0, w, P) {
    var u = (t - t0) / w;
    return u > 0 && u < 1 ? P * Math.sin(Math.PI * u) : 0;
  }
  function still(t, s) {
    s.ax = tremor(t, 1); s.ay = tremor(t, 2); s.az = tremor(t, 3);
    s.beta = 72 + 0.4 * Math.sin(TAU * 0.3 * t); s.gamma = 3 + 0.3 * Math.sin(TAU * 0.23 * t);
    s.ra = s.rb = s.rg = 0;
  }

  /** A shake of peak G g at f Hz along `axis`, ramping in over 0.4 s, lasting dur s. */
  function shake(G, f, axis, dur, seed) {
    seed = seed || 3;
    return {
      dur: dur || 12,
      fn: function (t, s) {
        still(t, s);
        var env = t < 0.4 ? t / 0.4 : 1;
        var a = env * human(G, f, t, seed), c1 = env * 0.2 * human(G, f, t, seed + 4), c2 = env * 0.15 * human(G, f, t, seed + 9);
        if (axis === 'y') { s.ay += a; s.ax += c1; s.az += c2; }
        else if (axis === 'x') { s.ax += a; s.ay += c1; s.az += c2; }
        else if (axis === 'z') { s.az += a; s.ay += c1; s.ax += c2; }
        else {
          // 'wrist': the phone swings about the wrist, 12 cm below its middle, about its x axis:
          // pitch th = Th sin(wt). The tangential acceleration r th'' (peak G g) is along z, the
          // centripetal th'^2 r points to the wrist (-y), and the attitude swings by Th.
          var r = 0.12, w0 = TAU * f, Th = G * G0 / (r * w0 * w0);
          var th = env * Th * Math.sin(w0 * t), om = env * Th * w0 * Math.cos(w0 * t);
          s.az += -r * env * Th * w0 * w0 * Math.sin(w0 * t) / G0;
          s.ay += -om * om * r / G0 + c1; s.ax += c2;
          s.beta += th / RAD;
          s.rb = om / RAD;
        }
        // a hand never holds the attitude dead still while it shakes
        s.gamma += env * 2.5 * Math.sin(TAU * f * t + 0.9);
        if (axis !== 'wrist') s.beta += env * 3 * Math.sin(TAU * f * t + 0.3);
        s.ra = env * 60 * Math.sin(TAU * f * t + 1.7); s.rg = env * 80 * Math.sin(TAU * f * t + 0.4);
        if (axis !== 'wrist') s.rb = env * 110 * Math.cos(TAU * f * t + 0.3);
      }
    };
  }

  var STREAMS = {
    still: { dur: 5, fn: still },
    // picked up, looked at, leaned left and right, put back to upright
    gentle: {
      dur: 12,
      fn: function (t, s) {
        still(t, s);
        s.ax += 0.18 * Math.sin(TAU * 0.6 * t); s.ay += 0.12 * Math.sin(TAU * 0.45 * t + 1); s.az += 0.15 * Math.sin(TAU * 0.5 * t + 2);
        s.gamma += 14 * Math.sin(TAU * 0.25 * t); s.beta += 9 * Math.sin(TAU * 0.18 * t + 0.5);
        s.rg = 14 * TAU * 0.25 * Math.cos(TAU * 0.25 * t); s.rb = 9 * TAU * 0.18 * Math.cos(TAU * 0.18 * t + 0.5);
      }
    },
    // walking briskly, the phone in a swinging hand, screen up and readable
    walking: {
      dur: 15,
      fn: function (t, s) {
        still(t, s);
        var step = 2.0, ph = (t * step) % 1;
        s.ay += 0.6 * Math.sin(TAU * step * t) + 0.2 * Math.sin(TAU * 2 * step * t + 0.6) + pulse(ph, 0.05, 0.07, 1.2);
        s.ax += 0.3 * Math.sin(TAU * 1.0 * t + 0.4);
        s.az += 0.3 * Math.sin(TAU * 1.0 * t + 1.9) + 0.15 * Math.sin(TAU * step * t);
        s.gamma += 6 * Math.sin(TAU * 1.0 * t); s.beta += 5 * Math.sin(TAU * step * t + 0.2);
        s.ra = 25 * Math.sin(TAU * 1.0 * t); s.rb = 60 * Math.cos(TAU * step * t); s.rg = 40 * Math.cos(TAU * 1.0 * t);
      }
    },
    // running with it in the hand: 1.6 g at 2.8 Hz, 2.5 g foot strikes
    running: {
      dur: 12,
      fn: function (t, s) {
        still(t, s);
        var step = 2.8, ph = (t * step) % 1;
        s.ay += human(1.6, step, t, 1) + pulse(ph, 0.05, 0.06, 2.5);
        s.ax += 0.5 * Math.sin(TAU * 1.4 * t); s.az += 0.5 * Math.sin(TAU * 1.4 * t + 1.2);
        s.gamma += 8 * Math.sin(TAU * 1.4 * t); s.beta += 8 * Math.sin(TAU * step * t);
      }
    },
    // laid flat on a table, face up, a little carelessly: one spike along z as the back meets the wood
    setDownFlat: {
      dur: 4,
      fn: function (t, s, o) {
        still(t, s);
        var t1 = 1.2, P = (o && o.peak) || 6, w = (o && o.width) || 0.015, ph = (o && o.phase) || 0;
        var lay = t < 0.5 ? 0 : (t < t1 ? (t - 0.5) / (t1 - 0.5) : 1);      // lowered and laid back over 0.7 s
        s.beta = 72 * (1 - lay) + 1.5 * lay; s.gamma = 3 * (1 - lay);
        s.rb = t > 0.5 && t < t1 ? -72 / (t1 - 0.5) : 0;
        s.ay += t > 0.5 && t < t1 ? -0.25 * Math.sin(Math.PI * (t - 0.5) / (t1 - 0.5)) : 0;
        s.az += pulse(t, t1 + ph, w, P) - pulse(t, t1 + ph + w, 2 * w, 0.25 * P);   // the stop, and a small rebound
      }
    },
    // stood on its bottom edge on a table (or dropped into a dock): one spike along y
    setDownEdge: {
      dur: 4,
      fn: function (t, s, o) {
        still(t, s);
        var t1 = 1.2, P = (o && o.peak) || 6, w = (o && o.width) || 0.015, ph = (o && o.phase) || 0;
        s.beta = 85; s.gamma = 1;
        s.ay += (t > 0.8 && t < t1 ? -0.3 : 0) + pulse(t, t1 + ph, w, P) - pulse(t, t1 + ph + w, 2 * w, 0.25 * P);
      }
    },
    // tapped against the other palm, bottom edge first, 2.5 times a second
    palmTap: {
      dur: 10,
      fn: function (t, s, o) {
        still(t, s);
        var P = (o && o.peak) || 4, w = (o && o.width) || 0.025, T = 0.4, ph = t % T;
        s.beta = 80; s.gamma = 2;
        s.ay += pulse(ph, 0.2, w, P) - 0.6 * Math.sin(TAU * t / T + 2.2);      // the blow, and the hand swinging it
        s.az += 0.2 * Math.sin(TAU * t / T);
      }
    },
    // ... and with its back flat on the palm
    palmTapFlat: {
      dur: 10,
      fn: function (t, s, o) {
        still(t, s);
        var P = (o && o.peak) || 4, w = (o && o.width) || 0.025, T = 0.4, ph = t % T;
        s.beta = 35; s.gamma = 2;
        s.az += pulse(ph, 0.2, w, P) - 0.6 * Math.sin(TAU * t / T + 2.2);
        s.ay += 0.2 * Math.sin(TAU * t / T);
      }
    },
    // dropped 30 cm onto a sofa: 0.25 s of free fall, then a 4 g, 60 ms stop
    dropSoft: {
      dur: 4,
      fn: function (t, s) {
        still(t, s);
        if (t > 1 && t < 1.25) s.ay += -1;
        s.ay += pulse(t, 1.25, 0.06, 4);
      }
    },
    firmY: shake(1.5, 3, 'y', 12, 3),
    firmX: shake(1.5, 3, 'x', 12, 3),
    vigorousY: shake(3, 4.5, 'y', 15, 5),
    vigorousX: shake(3, 4.5, 'x', 15, 5),
    vigorousZ: shake(3, 4.5, 'z', 15, 5),
    vigorousWrist: shake(3, 4.5, 'wrist', 15, 5),
    hardestY: shake(5.5, 5.5, 'y', 15, 6),
    hardestX: shake(5.5, 5.5, 'x', 15, 6),
    hardestZ: shake(5.5, 5.5, 'z', 15, 6),
    hardestWrist: shake(5.5, 5.5, 'wrist', 15, 6)
  };

  /** A shake stream made to measure: {G, f, axis, dur, seed}. */
  function makeShake(o) { return shake(o.G, o.f, o.axis || 'y', o.dur || 15, o.seed || 5); }

  function get(name) {
    if (name && typeof name === 'object') return name.G !== undefined ? makeShake(name) : name;
    var p = STREAMS[name];
    if (!p) throw new Error('unknown stream ' + name);
    return p;
  }

  /** The stream at t seconds, into s. opts go to the stream (peak, width, phase). */
  function sample(name, t, s, opts) {
    s = s || {};
    s.ax = s.ay = s.az = 0; s.beta = 72; s.gamma = 0; s.ra = s.rb = s.rg = 0;
    get(name).fn(t, s, opts);
    return s;
  }

  /**
   * The DeviceMotionEvent and DeviceOrientationEvent inits for state s.
   * W3C: accelerationIncludingGravity = acceleration - g * down, m/s^2;
   * WebKit ('ios') reports both vectors negated.
   */
  function deviceEvents(s, conv) {
    var b = s.beta * RAD, g = s.gamma * RAD;
    var dx = Math.cos(b) * Math.sin(g), dy = -Math.sin(b), dz = -Math.cos(b) * Math.cos(g);
    var ax = s.ax * G0, ay = s.ay * G0, az = s.az * G0, k = conv === 'spec' ? 1 : -1;
    return {
      motion: {
        acceleration: { x: k * ax, y: k * ay, z: k * az },
        accelerationIncludingGravity: { x: k * (ax - G0 * dx), y: k * (ay - G0 * dy), z: k * (az - G0 * dz) },
        rotationRate: { alpha: s.ra, beta: s.rb, gamma: s.rg },
        interval: 1000 / 60
      },
      orient: { alpha: 0, beta: s.beta, gamma: s.gamma, absolute: false }
    };
  }

  var api = { G0: G0, human: human, STREAMS: STREAMS, names: Object.keys(STREAMS), get: get, sample: sample,
              makeShake: makeShake, deviceEvents: deviceEvents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhoneStreams = api;
})(typeof window !== 'undefined' ? window : globalThis);
