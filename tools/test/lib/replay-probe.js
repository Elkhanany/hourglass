/*
 * Page-side instruments for the replay suites (development only, not
 * shipped). Added as an init script, so it runs before any page script.
 *
 *  - The iOS API surface: DeviceMotionEvent.requestPermission and
 *    DeviceOrientationEvent.requestPermission resolve __probeCfg.permission
 *    ('granted' | 'denied'; null leaves them undefined, as on Android), and
 *    navigator.vibrate does not exist, so the app takes its iPhone haptic
 *    path (a hidden switch flipped inside a gesture).
 *  - window.__phone.play(name, opts): a sensor stream from
 *    lib/replay-streams.js as real DeviceMotionEvent and
 *    DeviceOrientationEvent dispatches, 60 a second, sampled at the true
 *    dispatch time, in WebKit's sign convention.
 *  - window.__probe: a recorder. Per physics step it notes what reached the
 *    sim (felt acceleration, spin, arming, beds in the air, landing speeds,
 *    loads on the glass) and the damage; it timestamps every blow of the
 *    glass (sim.impact), knock, flick dose, creak, crack, chip, tap sound,
 *    catch, toast, haptic tick, timer state and Zen change. reset() starts
 *    a new take; dump() returns it.
 */
(function () {
  'use strict';
  var cfg = window.__probeCfg || {};

  /* ---- the iOS API surface ---------------------------------------------- */
  // granted: an iPhone sends no sensor events at all until the user has allowed them in this
  // launch of the page; the phone driver below holds its events back the same way.
  var perms = { motion: 0, orient: 0, inGesture: [], granted: !cfg.permission, withheld: 0 };
  function stub(Ctor, key) {
    if (!Ctor || !cfg.permission) return;
    try {
      Object.defineProperty(Ctor, 'requestPermission', {
        configurable: true, writable: true,
        value: function () {
          perms[key]++;
          var ua = navigator.userActivation;
          var inGesture = !!(ua && ua.isActive);
          perms.inGesture.push(inGesture);
          if (!inGesture) return Promise.reject(new Error('NotAllowedError: requires a user gesture'));   // as WebKit does
          if (cfg.permission === 'granted') perms.granted = true;
          return Promise.resolve(cfg.permission);
        }
      });
    } catch (e) {}
  }
  stub(window.DeviceMotionEvent, 'motion');
  stub(window.DeviceOrientationEvent, 'orient');
  try { Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: undefined }); } catch (e) {}

  // no GPU here: the app falls back to its 2-D glass and keeps real time (see lib/iphone.js)
  if (!cfg.webgl) {
    var getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') return null;
      return getContext.apply(this, arguments);
    };
  }

  /* ---- the recorder ------------------------------------------------------- */
  var KPX = 0.16e-3 / 9.81;                 // app.js: g per px/s^2 of the glass's on-screen acceleration
  var P = window.__probe = {
    hooked: false, perms: perms, t0: performance.now(),
    reset: function () {
      P.t0 = performance.now();
      P.events = []; P.frameMs = []; P.steps = 0; P.frames = 0; P.lastFrame = 0;
      P.peakFeltG = 0; P.peakSimG = 0; P.sumSim2 = 0; P.peakGz = 0; P.peakW = 0; P.peakSpinG = 0;
      P.peakBodyPx = 0; P.peakBodyAccG = 0; P.peakBodyV = 0; P.peakBodyVDown = 0; P.peakFreeV = 0; P.peakRms = 0; P.armedSteps = 0; P.spinArmedSteps = 0; P.armedAtMs = null;
      P.airSteps = 0; P.peakLandV = 0; P.landings = 0; P.loadsOverTh = 0; P.peakLoadX = 0;
      P.dMaxPeak = 0; P.firstLeakMs = null; P.knocks = []; P.hits = []; P.flicks = []; P.series = []; P.lam = 0; P.landV = [];
      P.state = window.Hourglass ? window.Hourglass.timer.state : '';
      P.zen = document.getElementById('app') ? document.getElementById('app').classList.contains('zen') : false;
    },
    ev: function (k, v) { P.events.push({ t: Math.round(performance.now() - P.t0), k: k, v: v === undefined ? null : v }); },
    dump: function () {
      var H = window.Hourglass, f = P.frameMs.slice().sort(function (a, b) { return a - b; });
      var q = function (p) { return f.length ? +f[Math.min(f.length - 1, Math.floor(p * f.length))].toFixed(1) : 0; };
      return {
        ms: performance.now() - P.t0, events: P.events, frames: P.frames, steps: P.steps,
        frameP50: q(0.5), frameP95: q(0.95),
        peakFeltG: P.peakFeltG, peakSimG: P.peakSimG, rmsSimG: P.steps ? Math.sqrt(P.sumSim2 / P.steps) : 0,
        peakGz: P.peakGz, peakW: P.peakW, peakSpinG: P.peakSpinG, peakBodyPx: P.peakBodyPx, peakBodyAccG: P.peakBodyAccG, peakBodyV: P.peakBodyV, peakBodyVDown: P.peakBodyVDown, peakFreeV: P.peakFreeV,
        peakRms: P.peakRms, armedSteps: P.armedSteps, spinArmedSteps: P.spinArmedSteps, armedAtMs: P.armedAtMs,
        airSteps: P.airSteps, peakLandV: P.peakLandV, landings: P.landings, loadsOverTh: P.loadsOverTh, peakLoadX: P.peakLoadX,
        dMaxPeak: P.dMaxPeak, dMaxEnd: H.sim.dMax, firstLeakMs: P.firstLeakMs, lost: H.sim.lost,
        knocks: P.knocks, hits: P.hits, flicks: P.flicks, series: P.series, lam: P.lam, landV: P.landV,
        cracks: H.sim.cracks.map(function (c) { return { seg: c.seg, bulb: c.bulb, side: c.side, u: +c.u.toFixed(3), L: +c.L.toFixed(1), w: c.w, sealed: c.sealed }; }),
        state: H.timer.state, zen: document.getElementById('app').classList.contains('zen'), perms: perms
      };
    }
  };
  P.reset();

  function hook() {
    var H = window.Hourglass;
    if (!H || P.hooked) return;
    P.hooked = true;
    var sim = H.sim, MOT = sim.constructor.MOTION, G = sim.G, sqG = Math.sqrt(G);
    var step = sim.step, landing = sim._landing, load = sim._load, knock = sim.knock;
    sim.step = function () {
      step.call(sim);
      P.steps++;
      var ax = sim.mAx / G, ay = sim.mAy / G, m = Math.sqrt(ax * ax + ay * ay);
      if (m > P.peakSimG) P.peakSimG = m;
      P.sumSim2 += m * m;
      if (sim.mGz > P.peakGz) P.peakGz = sim.mGz;
      var w = sim.mW < 0 ? -sim.mW : sim.mW;
      if (w > P.peakW) P.peakW = w;
      var gc = sim.mLam * w * w * sim.geo.HB / G;
      if (gc > P.peakSpinG) P.peakSpinG = gc;
      if (sim.mLam > 0) P.lam = sim.mLam;
      var b = H.body, r = Math.sqrt(b.px * b.px + b.py * b.py), ba = KPX * Math.sqrt(b.ax * b.ax + b.ay * b.ay);
      if (r > P.peakBodyPx) P.peakBodyPx = r;
      if (ba > P.peakBodyAccG) P.peakBodyAccG = ba;
      var bv = Math.sqrt(b.vx * b.vx + b.vy * b.vy);       // px/s on screen
      if (bv > P.peakBodyV) P.peakBodyV = bv;
      if (b.vy > P.peakBodyVDown) P.peakBodyVDown = b.vy;
      if (b.mode === 'home' && bv > P.peakFreeV) P.peakFreeV = bv;   // let go: on its way back to its place
      var mo = H.motion;
      if (mo.rms > P.peakRms) P.peakRms = mo.rms;
      if (sim.damageArmed) { P.armedSteps++; if (P.armedAtMs === null) P.armedAtMs = performance.now() - P.t0; }
      if (sim.spinArmed) P.spinArmedSteps++;
      if (sim.slug[0].air || sim.slug[1].air) P.airSteps++;
      if (sim.dMax > P.dMaxPeak) P.dMaxPeak = sim.dMax;
      if (P.firstLeakMs === null && sim.lost > 0) P.firstLeakMs = performance.now() - P.t0;
      if ((P.steps & 3) === 0 && P.series.length < 40000) {
        P.series.push([Math.round(performance.now() - P.t0), +ax.toFixed(3), +ay.toFixed(3), +sim.mGz.toFixed(3),
          +sim.mW.toFixed(3), +sim.dMax.toFixed(4), sim.damageArmed ? 1 : 0, +(mo.rms || 0).toFixed(3), +gc.toFixed(3)]);
      }
    };
    sim._landing = function (b, x, endY, n, v, dir) {
      if (n) {
        P.landings++;
        if (v > P.peakLandV) P.peakLandV = v;
        if (P.landV.length < 4000 && (x & 7) === 0) P.landV.push(Math.round(v));
      }
      return landing.call(sim, b, x, endY, n, v, dir);
    };
    sim._load = function (s, v, n) {
      var x = sim.segKt[s] * v / (sqG * sim.segS[s] * MOT.vc);
      if (x > P.peakLoadX) P.peakLoadX = x;
      if (x > MOT.xTh) P.loadsOverTh++;
      return load.call(sim, s, v, n);
    };
    sim.knock = function (x, y, s) {
      var seg = knock.call(sim, x, y, s);
      P.knocks.push({ t: Math.round(performance.now() - P.t0), x: +x.toFixed(1), y: +y.toFixed(1), s: +s.toFixed(3), seg: seg,
                      d: seg >= 0 ? +sim.segD[seg].toFixed(4) : 0, p: seg >= 0 ? +sim.segP[seg].toFixed(4) : 0 });
      return seg;
    };
    if (typeof sim.impact === 'function') {
      var impact = sim.impact;
      sim.impact = function (nx, ny, v) {
        var gr = impact.call(sim, nx, ny, v);
        P.hits.push({ t: Math.round(performance.now() - P.t0), nx: +nx.toFixed(2), ny: +ny.toFixed(2), v: Math.round(v), grade: gr,
                      py: +H.body.py.toFixed(1), px: +H.body.px.toFixed(1), held: H.body.mode === 'held-move' });
        return gr;
      };
    }
    if (typeof sim.flick === 'function') {
      var flick = sim.flick;
      sim.flick = function (gp) {
        var d = flick.call(sim, gp);
        P.flicks.push({ t: Math.round(performance.now() - P.t0), g: +(+gp).toFixed(3), dose: +d.toFixed(3), w: +H.body.w.toFixed(1), dMax: +sim.dMax.toFixed(3) });
        return d;
      };
    }
    var a = H.audio;
    ['thump', 'clack', 'creak', 'crack', 'chip', 'crackGrow', 'tap', 'catchThud', 'mended'].forEach(function (n) {
      var f = a[n];
      if (typeof f !== 'function') return;
      a[n] = function (v) { P.ev(n, typeof v === 'number' ? +v.toFixed(2) : null); return f.apply(a, arguments); };
    });
    var toast = document.getElementById('toast'), lastToast = '';
    new MutationObserver(function () {
      var on = toast.classList.contains('show');
      if (on && toast.textContent !== lastToast) { lastToast = toast.textContent; P.ev('toast', lastToast); }
      if (!on) lastToast = '';
    }).observe(toast, { attributes: true, childList: true, characterData: true, subtree: true });
    // the iPhone haptic: a hidden <input switch> clicked through its label
    var click = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function () {
      if (this.tagName === 'LABEL' && this.querySelector('input[switch]')) P.ev('haptic');
      return click.apply(this, arguments);
    };
    // ... and the only way since iOS 26.5: the switch under a control's transparent label, flipped by the finger's own tap
    document.addEventListener('change', function (e) {
      if (e.target && e.target.matches && e.target.matches('label.haptic > input[switch]')) P.ev('haptic');
    }, true);
  }
  function tick(now) {
    hook();
    var H = window.Hourglass;
    if (H) {
      P.frames++;
      if (P.lastFrame) P.frameMs.push(now - P.lastFrame);
      P.lastFrame = now;
      if (H.timer.state !== P.state) { P.state = H.timer.state; P.ev('state', P.state); }
      var z = document.getElementById('app').classList.contains('zen');
      if (z !== P.zen) { P.zen = z; P.ev('zen', z ? 1 : 0); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---- the phone ------------------------------------------------------------ */
  var run = null;
  window.__phone = {
    dur: function () { return run ? run.dur : 0; },
    /** name: a lib/streams.js stream or {G, f, axis, dur}; opts {durS, conv, stream: {peak, width, phase}}. */
    play: function (name, opts) {
      window.__phone.stop();
      opts = opts || {};
      var S = window.PhoneStreams, st = S.get(name);
      var r = run = { dur: opts.durS || st.dur, t0: performance.now(), n: 0, s: {}, timer: 0 };
      function fire() {
        if (run !== r) return;
        var t = (performance.now() - r.t0) / 1000;
        if (t > r.dur) { window.__phone.stop(); return; }
        S.sample(name, t, r.s, opts.stream);
        var ev = S.deviceEvents(r.s, opts.conv || 'ios');
        if (perms.granted) {
          try { window.dispatchEvent(new DeviceMotionEvent('devicemotion', ev.motion)); } catch (e) {}
          try { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', ev.orient)); } catch (e) {}
        } else perms.withheld++;
        r.n++;
        var m = Math.sqrt(r.s.ax * r.s.ax + r.s.ay * r.s.ay + r.s.az * r.s.az);
        if (m > P.peakFeltG) P.peakFeltG = m;
        var next = r.t0 + r.n * 1000 / 60;
        r.timer = setTimeout(fire, Math.max(0, next - performance.now()));
      }
      fire();
    },
    stop: function () {
      if (!run) return;
      clearTimeout(run.timer);
      run = null;
    }
  };
})();
