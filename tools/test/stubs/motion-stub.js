/*
 * A stand-in for motion.js in the browser tests (development only, never
 * shipped). It has HourglassMotion's whole API, but no sensors: the test
 * drives it through window.__motion, and reads what the app did with it
 * through window.__motionStub.
 *
 *   window.__motion = {
 *     x, y, z      felt acceleration, g, page frame (z: out of the screen)
 *     w, wf        the phone's own turn and a flat spin's rate, rad/s
 *     rms, armed   the arming RMS (g) and the arming gate itself
 *     live         a sample within the last 500 ms
 *     heading      page gravity angle, rad (undefined: not known yet)
 *     inPlane      how much of gravity lies in the screen plane
 *     seenOrient, seenMotion, needsPermission, sign
 *   }
 *   window.__motionPerm   what request() resolves to (default 'granted')
 *
 * Like the real one, request() calls DeviceMotionEvent.requestPermission()
 * and DeviceOrientationEvent.requestPermission() synchronously, first, so
 * the page's permission stubs see the user activation of the tap.
 *
 * Injected ahead of app.js by tools/test/stubs/harness.js; it replaces any
 * HourglassMotion that motion.js may have defined.
 */
(function () {
  'use strict';
  var D = window.__motion = window.__motion || {};
  var defaults = {
    x: 0, y: 0, z: 0, w: 0, wf: 0, rms: 0, armed: false, live: true,
    heading: 0, inPlane: 1, seenOrient: true, seenMotion: true, needsPermission: true, sign: 0
  };
  for (var k in defaults) if (!(k in D)) D[k] = defaults[k];
  var stats = window.__motionStub = { created: 0, starts: 0, stops: 0, resets: 0, requests: 0, samples: 0, instance: null };

  function HourglassMotion(opts) {
    this._sign = opts && (opts.sign === 1 || opts.sign === -1) ? opts.sign : 0;
    this.onsign = null;
    this.headingSeq = 0;
    this.running = false;
    stats.created++;
    stats.instance = this;
  }
  var proto = HourglassMotion.prototype;
  function on(m) { return m.running; }
  Object.defineProperty(proto, 'needsPermission', { get: function () { return !!D.needsPermission; } });
  Object.defineProperty(proto, 'heading', {
    get: function () { return on(this) && D.seenOrient && D.heading !== undefined ? +D.heading : NaN; }
  });
  Object.defineProperty(proto, 'inPlane', { get: function () { return on(this) ? +D.inPlane : 0; } });
  Object.defineProperty(proto, 'live', { get: function () { return on(this) && !!D.live && !!D.seenMotion; } });
  Object.defineProperty(proto, 'seenMotion', { get: function () { return on(this) && !!D.seenMotion; } });
  Object.defineProperty(proto, 'seenOrient', { get: function () { return on(this) && !!D.seenOrient; } });
  Object.defineProperty(proto, 'armed', { get: function () { return on(this) && !!D.armed; } });
  Object.defineProperty(proto, 'rms', { get: function () { return on(this) ? +D.rms || 0 : 0; } });
  Object.defineProperty(proto, 'sign', {
    get: function () { return D.sign === 1 || D.sign === -1 ? D.sign : this._sign; },
    set: function (v) { this._sign = v; }
  });

  proto.request = function () {
    stats.requests++;
    // the same order as the real one: both prompts before anything asynchronous
    var M = window.DeviceMotionEvent, O = window.DeviceOrientationEvent;
    var pm = M && typeof M.requestPermission === 'function' ? M.requestPermission() : null;
    var po = O && typeof O.requestPermission === 'function' ? O.requestPermission() : null;
    var answer = window.__motionPerm || 'granted';
    return Promise.all([pm, po]).then(function () { return answer; }, function () { return answer; });
  };
  proto.start = function () { this.running = true; stats.starts++; };
  proto.stop = function () { this.running = false; stats.stops++; };
  proto.reset = function () { stats.resets++; };
  proto.sample = function (tMs, out) {
    out = out || {};
    stats.samples++;
    var live = on(this) && D.seenMotion;
    out.x = live ? +D.x || 0 : 0;
    out.y = live ? +D.y || 0 : 0;
    out.z = live ? +D.z || 0 : 0;
    out.w = live ? +D.w || 0 : 0;
    out.wf = live ? +D.wf || 0 : 0;
    out.rms = live ? +D.rms || 0 : 0;
    out.armed = live && !!D.armed;
    out.live = live && !!D.live;
    return out;
  };

  /** Screen orientation o: device screen frame (x right, y down) → page (as the app always did). */
  HourglassMotion.toPage = function (x, y, o) {
    if (o === 90) return [y, -x];
    if (o === -90 || o === 270) return [-y, x];
    if (o === 180) return [-x, -y];
    return [x, y];
  };
  HourglassMotion.screenAngle = function () {
    return typeof window.orientation === 'number' ? window.orientation
         : (screen.orientation ? screen.orientation.angle : 0);
  };

  window.HourglassMotion = HourglassMotion;
})();
