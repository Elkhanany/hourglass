/*
 * Page-side instruments for the browser tests (development only, never
 * shipped). Added as an init script, so it runs before any page script.
 *
 *  - Permission stubs: DeviceMotionEvent.requestPermission and
 *    DeviceOrientationEvent.requestPermission count their calls, note
 *    navigator.userActivation.isActive at each call, and resolve
 *    window.__perm ('granted' by default).                → window.__perms
 *  - Motion driver: window.__drive({profile, conv, beta, gamma, o, durS})
 *    plays a hand profile (tools/test/lib/profiles.js, which must be
 *    injected first) at 60 Hz as real DeviceMotionEvent and
 *    DeviceOrientationEvent dispatches, and also into window.__motion when
 *    the motion stub is in use. window.__driveStop() ends it.
 *  - Invariant monitor: every 15 frames sim.census() must match sim.total
 *    and sim.nTop; when nTop first reaches 0 and when the timer turns
 *    'done' (Date.now(), noted after every physics step); every
 *    sim.fastForward call with the app's motionRecent at the time.
 *                                                          → window.__mon
 *  - Recorders: window.__rec.start(fn) calls fn(H) after every physics step
 *    (or every frame with {frame: true}) and keeps what it returns.
 */
(function () {
  'use strict';

  /* ---- permission stubs ---------------------------------------------- */
  var perms = window.__perms = { motion: 0, orient: 0, motionActive: [], orientActive: [], motionIn: [], orientIn: [] };
  function active() {
    var ua = navigator.userActivation;
    return !!(ua && ua.isActive);
  }
  function stubPermission(Ctor, key) {
    if (!Ctor) return;
    try {
      Object.defineProperty(Ctor, 'requestPermission', {
        configurable: true, writable: true,
        value: function () {
          perms[key]++;
          perms[key + 'Active'].push(active());
          // the event being dispatched right now, if any: a call made synchronously inside a click says 'click'
          var ev = window.event;
          perms[key + 'In'].push(ev ? ev.type : null);
          return Promise.resolve(window.__perm || 'granted');
        }
      });
    } catch (e) {}
  }
  stubPermission(window.DeviceMotionEvent, 'motion');
  stubPermission(window.DeviceOrientationEvent, 'orient');

  /* ---- motion driver ------------------------------------------------- */
  var drive = null;
  window.__drive = function (o) {
    if (drive) window.__driveStop();
    o = o || {};
    var HP = window.HourglassProfiles;
    var d = drive = {
      name: o.profile || 'calm', conv: o.conv || 'ios', beta: o.beta === undefined ? 90 : o.beta,
      gamma: o.gamma || 0, o: o.o || 0, durS: o.durS || 1e9, t0: performance.now(), n: 0,
      f: { x: 0, y: 0, z: 0, w: 0, al: 0 },
      fn: typeof o.fn === 'function' ? o.fn : null,
      win: [], hi: 0, lo: 0, armed: false
    };
    function tick() {
      if (drive !== d) return;
      var t = (performance.now() - d.t0) / 1000;
      if (t > d.durS) { window.__driveStop(); return; }
      var f = d.f;
      if (d.fn) { f.x = f.y = f.z = f.w = f.al = 0; d.fn(t, f); }
      else HP.sample(d.name, t, f);
      var opts = { conv: d.conv, beta: d.beta, gamma: d.gamma, o: d.o, noAccel: !!o.noAccel };
      var m = HP.deviceEvent(f, opts);
      try { window.dispatchEvent(new DeviceMotionEvent('devicemotion', m)); } catch (e) {}
      try { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', HP.orientationEvent(opts))); } catch (e) {}
      d.n++;
      // the motion stub has no sensors: hand it the same felt sample (and arm it as motion.js would)
      if (window.__motionStub) {
        var M = window.__motion;
        var p = HP.toPage(f.x, f.y, 0);
        M.x = p[0]; M.y = p[1]; M.z = Math.abs(f.z || 0); M.w = f.w || 0; M.wf = 0;
        M.seenMotion = true; M.seenOrient = true; M.live = true;
        var g2 = f.x * f.x + f.y * f.y + (f.z || 0) * (f.z || 0), now = performance.now();
        d.win.push(now, g2);
        while (d.win.length && d.win[0] < now - 340) d.win.splice(0, 2);
        var s = 0;
        for (var i = 1; i < d.win.length; i += 2) s += d.win[i];
        var rms = Math.sqrt(s / Math.max(1, d.win.length / 2));
        M.rms = rms;
        if (rms >= 1.6) { d.hi += 1 / 60; d.lo = 0; } else { d.hi = 0; if (rms < 1.2) d.lo += 1 / 60; else d.lo = 0; }
        if (!d.armed && d.hi >= 0.6) d.armed = true;
        if (d.armed && d.lo >= 0.5) d.armed = false;
        M.armed = d.armed;
      }
    }
    d.timer = setInterval(tick, 1000 / 60);
    tick();
  };
  /** Change how the phone is held (beta, gamma, o) or the profile while it is driven. */
  window.__driveSet = function (o) {
    if (!drive) return;
    for (var k in o) {
      if (k === 'profile') drive.name = o[k];
      else drive[k] = o[k];
    }
  };
  window.__driveStop = function () {
    if (!drive) return;
    clearInterval(drive.timer);
    drive = null;
    if (window.__motionStub) {
      var M = window.__motion;
      M.x = M.y = M.z = M.w = M.wf = 0; M.rms = 0; M.armed = false;
    }
  };

  /* ---- invariant monitor and recorders --------------------------------- */
  var mon = window.__mon = {
    frames: 0, checks: 0, censusFails: [], emptyAt: -1, doneAt: -1, ff: [],
    flips: 0, steps: 0, hooked: false, downAt: -1, upAt: -1,
    reset: function () { mon.emptyAt = -1; mon.doneAt = -1; mon.ff.length = 0; mon.flips = 0; }
  };
  var rec = window.__rec = {
    on: false, frame: false, fn: null, out: [], max: 200000,
    start: function (fn, opts) { rec.fn = fn; rec.out = []; rec.frame = !!(opts && opts.frame); rec.on = true; },
    stop: function () { rec.on = false; return rec.out; }
  };
  function hook() {
    var H = window.Hourglass;
    if (!H || mon.hooked) return;
    mon.hooked = true;
    var sim = H.sim, step = sim.step, ff = sim.fastForward, cf = sim.completeFlip;
    sim.step = function () {
      step.call(sim);
      mon.steps++;
      if (mon.emptyAt < 0 && sim.nTop === 0) mon.emptyAt = Date.now();
      if (mon.doneAt < 0 && H.timer.state === 'done') mon.doneAt = Date.now();
      if (rec.on && !rec.frame && rec.out.length < rec.max) rec.out.push(rec.fn(H));
    };
    sim.fastForward = function (n) {
      mon.ff.push({ t: Date.now(), n: n, motionRecent: !!(H.debug && H.debug.motionRecent) });
      return ff.call(sim, n);
    };
    sim.completeFlip = function () {
      mon.flips++;
      return cf.call(sim);
    };
  }
  function tick() {
    hook();
    var H = window.Hourglass;
    if (H) {
      mon.frames++;
      if (mon.frames % 15 === 0) {
        var c = H.sim.census();
        mon.checks++;
        if (c.total !== H.sim.total || c.top !== H.sim.nTop) {
          if (mon.censusFails.length < 50) {
            mon.censusFails.push({ t: Date.now(), total: H.sim.total, cTotal: c.total, nTop: H.sim.nTop, cTop: c.top });
          }
        }
      }
      if (rec.on && rec.frame && rec.out.length < rec.max) rec.out.push(rec.fn(H));
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.addEventListener('pointerdown', function () { mon.downAt = performance.now(); }, true);
  window.addEventListener('pointerup', function () {
    mon.upAt = performance.now();
    mon.upW = window.Hourglass ? window.Hourglass.body.w : 0;    // how fast the glass turned as it was let go
  }, true);
})();
