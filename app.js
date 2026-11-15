/*!
 * Hourglass — app.js
 * ---------------------------------------------------------------------------
 * Conducts the physics, renderer and audio engine; owns the wall-clock timer,
 * the controls, the Zen HUD, settings, tilt, wake-lock and PWA registration.
 * License: GPL-3.0.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var P = window.HourglassPhysics;
  var $ = function (id) { return document.getElementById(id); };
  var RAD = Math.PI / 180;

  /* ======================================================================
   *  Elements
   * ==================================================================== */
  var app = $('app'), stage = $('stage'), assembly = $('assembly');
  var rotor = $('rotor'), shadow = $('shadow'), lightCanvas = $('c-light'), zoom = $('zoom');
  var hudTop = $('hud-top'), hudBottom = $('hud-bottom');
  var tMain = $('t-main'), tFrac = $('t-frac'), statusEl = $('status');
  var btnPlay = $('btn-play'), btnFlip = $('btn-flip'), btnSand = $('btn-sand');
  var btnReset = $('btn-reset'), btnSettings = $('btn-settings');
  var btnMute = $('btn-mute'), btnTheme = $('btn-theme'), themeName = $('theme-name');
  var durations = $('durations'), pillCustom = $('pill-custom'), customLabel = $('custom-label');
  var scrim = $('scrim'), sheetSettings = $('sheet-settings'), sheetCustom = $('sheet-custom');
  var toastEl = $('toast'), veil = $('veil'), btnZen = $('btn-zen');

  /* ======================================================================
   *  Settings (persisted)
   * ==================================================================== */
  var KEY = 'hourglass.settings.v1';
  var settings = {
    theme: 'sahara', character: 'asmr', volume: 0.8, muted: false,
    chime: true, tilt: false, zenFull: false, haptics: true,
    keepAwake: true, frame: true,
    ambience: 'none', ambienceLevel: 0.5,
    durationMs: 5 * 60000
  };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) {
      for (var k in settings) {
        if (Object.prototype.hasOwnProperty.call(saved, k) && typeof saved[k] === typeof settings[k]) {
          settings[k] = saved[k];
        }
      }
    }
  } catch (e) { /* private mode: run with defaults */ }
  if (!P.THEMES[settings.theme]) settings.theme = 'sahara';
  // "./?t=300" (seconds) preselects a duration — used by the app shortcuts
  var qt = /[?&]t=(\d{1,5})(?:&|$)/.exec(location.search);
  if (qt) settings.durationMs = +qt[1] * 1000;
  settings.durationMs = Math.max(10000, Math.min(5999000, settings.durationMs));
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }

  /* ======================================================================
   *  Engines
   * ==================================================================== */
  // More grains where there is room (and horsepower) to show them.
  var roomy = Math.min(window.innerWidth, window.innerHeight) >= 700;
  var sim = new P.Sim({ scale: roomy ? 1.3 : 1.08, seed: (Date.now() & 0x7fffffff) | 1 });
  var renderer = new P.Renderer(sim, {
    back: $('c-back'), sand: $('c-sand'), bloom: $('c-bloom'), front: $('c-front'), light: lightCanvas,
    glBack: $('c-glass-back'), glFront: $('c-glass-front')
  });
  renderer.setFrame(settings.frame);
  var audio = new window.HourglassAudio();
  audio.volume = settings.volume;
  audio.muted = settings.muted;
  audio.character = settings.character;
  audio.chimeEnabled = settings.chime;
  if (!window.HourglassAudio.CHARACTERS[settings.character]) settings.character = 'asmr';
  if (!window.HourglassAudio.AMBIENCES[settings.ambience]) settings.ambience = 'none';
  audio.ambience = settings.ambience;
  audio.ambLevel = settings.ambienceLevel;

  var STEP_MS = 1000 / P.STEP_HZ;
  var MAX_STEPS = 6;                 // per frame → real-time down to 20 fps

  /* ======================================================================
   *  The clock
   *
   *  The wall clock is the master; sand follows it. `topAt(rem)` says how
   *  many grains must still be above the neck when `rem` ms remain, so the
   *  flow self-corrects after dropped frames and the last grain leaves the
   *  neck on the very frame the readout hits 00:00.0.
   *
   *    bulk phase:  constant rate  (granular flow is head-independent)
   *    tail phase:  the final grains thin into single drops
   * ==================================================================== */
  var TAIL_P = 1.7;
  var back = false;                  // just woke from a sleep: deliver the backlog quietly
  var T = {
    state: 'idle',                   // idle | running | paused | done
    durationMs: settings.durationMs,
    rem: settings.durationMs,
    mpg: 1,                          // ms per grain in the bulk phase
    rate: 0,                         // grains per second in the bulk phase
    tailMs: 1000,
    tailGrains: 30,
    lastTick: Date.now()
  };

  /**
   * How much sand a glass of this length holds. A longer glass is a fuller
   * one (roughly a third full for a minute, three quarters for 45 minutes);
   * the neck's flow rate makes up the rest.
   */
  function grainsFor(ms) {
    var f = 0.36 + 0.40 * Math.log(ms / 60000) / Math.log(45);
    return Math.round(sim.capacity * Math.max(0.17, Math.min(0.78, f)));
  }

  function calibrate() {
    var N = sim.total, d = T.durationMs;
    T.tailMs = Math.min(2600, Math.max(500, d * 0.04));
    var rate = N / (d / 1000);
    T.tailGrains = Math.max(3, Math.min(30, Math.floor(rate * T.tailMs / 1000 / TAIL_P)));
    T.mpg = (d - T.tailMs) / (N - T.tailGrains);
    T.rate = 1000 / T.mpg;
  }
  /** Grains that should remain above the neck with `rem` ms left. */
  function topAt(rem) {
    if (rem <= 0) return 0;
    if (rem >= T.tailMs) return T.tailGrains + (rem - T.tailMs) / T.mpg;
    return T.tailGrains * Math.pow(rem / T.tailMs, TAIL_P);
  }
  /** Inverse: time left when `top` grains remain above the neck. */
  function remAt(top) {
    if (top <= 0) return 0;
    if (top >= T.tailGrains) return T.tailMs + (top - T.tailGrains) * T.mpg;
    return T.tailMs * Math.pow(top / T.tailGrains, 1 / TAIL_P);
  }

  /**
   * Advance the wall clock. Called from rAF and from a background timer.
   * Uses Date.now(): unlike performance.now() it keeps counting while the
   * phone sleeps, so the glass is right when you come back to it.
   */
  function tickClock() {
    var now = Date.now(), d = now - T.lastTick;
    T.lastTick = now;
    if (d > 1500) back = true;                 // frames and timers stopped: we were asleep
    // on its side (real gravity) the neck cannot flow, so time stands still too
    if (d <= 0 || T.state !== 'running' || flip.active || (grav.on && sim.gy < 0.7)) return;
    T.rem -= d;
    if (T.rem <= 0) { T.rem = 0; finish(); }
  }

  /* ======================================================================
   *  State
   * ==================================================================== */
  var STATUS = {
    idle: 'Tap the glass to begin',
    running: 'Flowing',
    paused: 'Paused',
    done: 'Time · flip to begin again',
    turning: 'Turning'
  };
  var lastInput = performance.now();
  var sheetOpen = null, sheetOpener = null;
  var dirty = true, acc = 0, lastFrame = performance.now();
  var resetting = false;
  var S = { flow: 0, imp: 0, slides: 0 };       // smoothed physics → audio
  // real gravity: where the device says down is, and whether the glass is held the other way up
  var grav = { on: false, target: 0, base: 0, seen: false };
  var L = { width: 0, height: 0 };              // current layout (CSS px)

  function setState(s) {
    T.state = s;
    app.dataset.state = s;
    statusEl.textContent = flip.active ? STATUS.turning : STATUS[s];
    btnPlay.setAttribute('aria-label', s === 'running' ? 'Pause' : (s === 'done' ? 'Flip and start again' : 'Start'));
    if (s === 'running') { T.lastTick = Date.now(); lastInput = performance.now(); }
    syncWakeLock();
    saveSession();
    sim.quiet = 0;
    dirty = true;
  }

  var pendingStart = false;
  function start() {
    if (resetting) { pendingStart = true; return; }     // mid cross-fade: start as soon as it lands
    if (flip.active) return;
    if (T.state === 'done' || T.rem <= 0) {
      if (sim.nTop === 0) { startFlip(true); return; }
      T.rem = remAt(sim.nTop);
    }
    setState('running');
  }
  function pause() {
    if (T.state !== 'running') return;
    setState('paused');
    audio.hush();
  }
  function toggle() {
    if (T.state === 'running') pause(); else start();
    buzz(10);
  }
  function finish() {
    endWall = Date.now();            // before setState: the wake lock covers the ending
    setState('done');
    audio.chime(0.75);               // after the last grain has landed
    audio.end(0.75);                 // the stream flows on to the bowl, then recedes under it
    buzz([16, 110, 16, 110, 42]);
    setTimeout(syncWakeLock, END_AWAKE + 100);
    // Dimmed and watched: hold still through the last grains and the bowl, then rise slowly.
    if (app.classList.contains('zen') && !document.hidden && !back && performance.now() - lastFrame < 250) {
      var bowl = settings.chime && !settings.muted && settings.volume > 0 && audio.isRunning();
      endHoldUntil = performance.now() + (bowl ? END_HOLD : END_HOLD_QUIET);
      zenForced = false;             // the hold keeps them dim; the end releases the moon, as before
    } else wake();
  }

  /* ---- reset / duration -------------------------------------------- */
  function reset(keepRunning) {
    if (resetting) return;
    resetting = true;
    pendingStart = false;
    audio.hush();
    app.classList.add('swap');       // cross-fade the sand
    setTimeout(function () {
      if (flip.active) { flip.active = false; flip.dragging = false; }
      grav.base = 0;
      applyFlip(0);
      sim.reset(grainsFor(T.durationMs));
      sim.tilt = 0;
      calibrate();
      T.rem = T.durationMs;
      S.flow = S.imp = S.slides = 0;
      resetting = false;
      setState(keepRunning || pendingStart ? 'running' : 'idle');
      pendingStart = false;
      app.classList.remove('swap');
    }, 460);
  }

  function setDuration(ms) {
    ms = Math.max(10000, Math.min(5999000, Math.round(ms / 1000) * 1000));
    T.durationMs = ms;
    settings.durationMs = ms;
    save();
    syncPills();
    reset(T.state === 'running');
  }

  /* ======================================================================
   *  Turning the glass — by the Flip button, or by hand
   *
   *  Gravity turns with the vessel the whole way round, so the sand follows
   *  whatever the hand does. Past 180° the glass is simply the other way up:
   *  the lattice is re-indexed and elapsed ⇄ remaining swap.
   * ==================================================================== */
  var flip = {
    active: false, dragging: false, was: 'idle', auto: false, swapped: false,
    from: 0, to: 0, t0: 0, dur: 0, easeOut: false,
    grabAngle: 0, spin: 0, shown: 0
  };

  function beginTurn(autoRun) {
    flip.active = true;
    flip.was = T.state;
    flip.auto = !!autoRun;
    flip.swapped = false;
    flip.spin = 0;
    flip.shown = T.rem;
    sim.flipping = true;
    sim.wakeAll();
    statusEl.textContent = STATUS.turning;
    audio.flipStart();
    buzz(14);
  }

  /** The Flip button: one smooth half turn. */
  function startFlip(autoRun) {
    if (flip.active || resetting) return;
    beginTurn(autoRun);
    flip.dragging = false;
    flip.from = 0; flip.to = Math.PI;
    flip.t0 = performance.now(); flip.dur = 2600; flip.easeOut = false;   // unhurried
  }

  /** Let go: settle on whichever end is nearer (or where it was flung). */
  function releaseTurn() {
    if (!flip.dragging) return;
    flip.dragging = false;
    var a = sim.angle, w = flip.spin, to;
    if (w > 2.2) to = a > 0 ? Math.PI : 0;
    else if (w < -2.2) to = a < 0 ? -Math.PI : 0;
    else to = Math.abs(a) > Math.PI / 2 ? (a > 0 ? Math.PI : -Math.PI) : 0;
    flip.from = a; flip.to = to;
    flip.t0 = performance.now();
    flip.dur = Math.max(420, Math.min(1500, Math.abs(to - a) / Math.PI * 1900));
    flip.easeOut = true;
  }

  /** The vessel has passed 180°: re-index the lattice, swap the clock. */
  function swapEnds() {
    var there = remAt(sim.total - sim.nTop);
    sim.completeFlip();
    sim.flipping = true;               // still turning
    T.rem = there;
    flip.swapped = !flip.swapped;
  }

  function endTurn() {
    flip.active = false; flip.dragging = false; flip.spin = 0;
    sim.flipping = false;
    sim.angle = 0;
    sim.wakeAll();
    applyFlip(0);
    audio.flipEnd();
    buzz(22);
    setState(flip.swapped ? stateAfterSwap(flip.was, flip.auto) : flip.was);
  }
  /** Turning a glass over starts it, unless you had paused it. */
  function stateAfterSwap(was, auto) {
    if (T.rem <= 0) return 'done';
    return (auto || was === 'running' || was === 'done') ? 'running' : 'paused';
  }

  function stepFlip(now, dtMs) {
    var prev = sim.angle, a;
    if (flip.dragging) {
      a = prev + (flip.grabAngle - prev) * (1 - Math.exp(-Math.min(dtMs, 100) / 75));   // follow the finger with some weight
      if (a > Math.PI) { swapEnds(); a -= Math.PI; prev -= Math.PI; flip.grabAngle -= Math.PI; }
      else if (a < -Math.PI) { swapEnds(); a += Math.PI; prev += Math.PI; flip.grabAngle += Math.PI; }
    } else {
      var p = (now - flip.t0) / flip.dur;
      if (p >= 1) {
        if (flip.to !== 0) swapEnds();
        endTurn();
        return;
      }
      var e = flip.easeOut ? 1 - Math.pow(1 - p, 3)
                           : (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
      a = flip.from + (flip.to - flip.from) * e;
    }
    sim.angle = a;
    flip.spin += ((a - prev) / Math.max(dtMs, 1) * 1000 - flip.spin) * 0.35;   // rad/s
    var f = Math.min(1, Math.abs(a) / Math.PI);
    f = f * f * (3 - 2 * f);
    flip.shown = T.rem + (remAt(sim.total - sim.nTop) - T.rem) * f;
    applyFlip(a);
  }

  function applyFlip(theta) {
    var total = theta + grav.base;
    rotor.style.transform = total ? 'rotate(' + total.toFixed(4) + 'rad)' : '';
    if (!theta) {
      assembly.style.transform = '';
      lightCanvas.style.opacity = '';
      shadow.style.opacity = '';
      return;
    }
    // pull back just enough that the turning vessel never clips the screen
    var c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta));
    var bw = c * L.width + s * L.height, bh = s * L.width + c * L.height;
    var kf = Math.min(1, window.innerWidth * 0.97 / bw, window.innerHeight * 0.97 / bh);
    assembly.style.transform = kf < 1 ? 'scale(' + kf.toFixed(4) + ')' : '';
    // room lighting does not turn with the glass: fade it through the move
    var o = Math.max(0, 1 - s * 5).toFixed(3);
    lightCanvas.style.opacity = o;
    shadow.style.opacity = o;
  }

  /* ======================================================================
   *  Pour (+ Sand)
   * ==================================================================== */
  var POUR_RATE = 620;               // grains per second while held
  var pour = { held: false, until: 0, acc: 0, warned: false, active: false };

  function handlePour(now, dtMs) {
    pour.active = false;
    if (!(pour.held || now < pour.until) || flip.active || resetting) return;
    pour.acc += POUR_RATE * Math.min(dtMs, 50) / 1000;
    var n = pour.acc | 0;
    if (!n) { pour.active = true; return; }
    pour.acc -= n;
    var made = sim.pour(n);
    if (made) {
      pour.active = true;
      // more sand above the neck = more time on the clock
      T.rem = remAt(topAt(T.rem) + made);
      if (T.state === 'done') setState('paused');
      sim.quiet = 0;
    } else if (!pour.warned) {
      pour.warned = true;
      toast('The glass is full');
      buzz(30);
    }
  }

  /* ======================================================================
   *  Real gravity (optional)
   *
   *  The sand feels the pull the phone feels. Lean it and the piles slump;
   *  lay it on its side and the flow stops; turn it over and the other bulb
   *  becomes the top — the phone *is* the hourglass.
   * ==================================================================== */
  function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  }

  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    grav.seen = true;
    var b = e.beta * RAD, g = e.gamma * RAD, t;
    // gravity projected onto the screen plane of the device
    // (x → its right edge, y → its bottom edge)
    var gx = Math.cos(b) * Math.sin(g), gy = Math.sin(b);
    // …seen from the page, which the system may have rotated
    var o = typeof window.orientation === 'number' ? window.orientation
          : (screen.orientation ? screen.orientation.angle : 0);
    if (o === 90) { t = gx; gx = gy; gy = -t; }
    else if (o === -90 || o === 270) { t = gx; gx = -gy; gy = t; }
    else if (o === 180) { gx = -gx; gy = -gy; }
    if (gx * gx + gy * gy < 0.05) return;        // lying flat: no pull in the plane, keep the last heading
    grav.target = Math.atan2(gx, gy);
  }

  function setTilt(on, fromUser) {
    var D = window.DeviceOrientationEvent;
    var opt = $('opt-tilt');
    function off(msg) {
      window.removeEventListener('deviceorientation', onOrient);
      grav.on = false; grav.target = 0;
      settings.tilt = false; opt.checked = false; save();
      if (msg) toast(msg);
    }
    if (!on) { off(); return; }
    if (!D) { off(fromUser ? 'Motion is not available on this device' : ''); return; }
    function go() {
      grav.seen = false;
      window.addEventListener('deviceorientation', onOrient);
      grav.on = true;
      settings.tilt = true; opt.checked = true; save();
      // some devices grant access but never report a reading
      setTimeout(function () { if (grav.on && !grav.seen) off(fromUser ? 'No motion data from this device' : ''); }, 2500);
    }
    if (typeof D.requestPermission === 'function') {
      // iOS 13+: must be asked from inside a tap
      if (!fromUser) { opt.checked = false; return; }
      D.requestPermission().then(function (r) {
        if (r === 'granted') go(); else off('Motion access was declined. Allow it in Settings to use this.');
      }).catch(function () { off('Motion access is unavailable'); });
    } else go();
  }

  /** Held the other way up: the lower bulb is the top now. */
  function tiltSwap() {
    var was = T.state, there = remAt(sim.total - sim.nTop);
    sim.completeFlip();
    grav.base = grav.base ? 0 : Math.PI;
    sim.tilt = wrapPi(sim.tilt + Math.PI);
    T.rem = there;
    applyFlip(0);
    buzz(18);
    setState(stateAfterSwap(was, false));
  }

  function stepGravity(dtMs) {
    var want = grav.on ? grav.target : 0;
    if (want > -0.045 && want < 0.045) want = 0;          // standing straight: let the sand sleep
    var d = wrapPi(want + grav.base - sim.tilt);
    if (d > 0.0008 || d < -0.0008) {
      sim.tilt = wrapPi(sim.tilt + d * (1 - Math.exp(-dtMs / 240)));   // gravity eases over, never snaps
      sim.wakeAll();
    } else if (d !== 0) {
      sim.tilt = wrapPi(want + grav.base);
      sim.wakeAll();
    }
    if (!flip.active && !resetting && (sim.tilt > 1.75 || sim.tilt < -1.75)) tiltSwap();
  }

  /* ======================================================================
   *  Frame loop
   * ==================================================================== */
  function frame(now) {
    requestAnimationFrame(frame);
    var dtMs = now - lastFrame;
    lastFrame = now;
    if (dtMs <= 0) return;

    tickClock();
    if (flip.active) stepFlip(now, dtMs);
    handlePour(now, dtMs);

    stepGravity(Math.min(dtMs, 100));

    var running = T.state === 'running' && !flip.active;
    var draining = T.state === 'done' && sim.nTop > 0 && !flip.active;

    // how many grains the clock says should still be above the neck
    var target = sim.nTop;
    if (running) {
      var ideal = topAt(T.rem);
      var fade = (T.rem - T.tailMs - 1200) / 3000;
      if (fade > 0) {
        // Sand does not pour like water. The stream breathes and pulses as
        // air trades places with it through the neck. These swings average
        // to zero and fade out before the end, so the clock stays exact.
        if (fade > 1) fade = 1;
        var ts = now / 1000;
        ideal += T.rate * fade * (
          0.113 * Math.sin(ts * 1.95 + 1.3 * Math.sin(ts * 0.37)) +     // slow breathing, ±22 %
          0.022 * Math.sin(ts * 11.9 + 1.1 * Math.sin(ts * 1.7)) +      // pulses near 2 Hz, ±26 %
          0.007 * Math.sin(ts * 28.9 + 0.5));                           // fine flutter, ±20 %
      }
      target = Math.ceil(ideal - 1e-7);
      if (target < 0) target = 0;
    } else if (draining) {
      target = 0;
    }
    sim.gateOpen = running || draining;
    sim.deepRelease = draining || (running && T.rem <= 0);
    sim.targetTop = target;
    sim.topSweeps = running ? Math.min(6, Math.floor(T.rate / 260)) : 0;

    var active = running || draining || flip.active || pour.active || dirty || sim.isActive();
    if (active) {
      sim.beginFrame();
      if (sim.gateOpen) {
        // the tab was asleep and the clock ran on: catch up without flight
        var owed = sim.nTop - target;
        var cap = back ? Math.max(12, T.rate * 0.4) : Math.max(400, T.rate * 1.2);
        if (owed > cap) sim.fastForward(owed - Math.min(30, Math.ceil(cap * 0.5)));
      }
      acc += Math.min(dtMs, 100);
      var n = 0;
      while (acc >= STEP_MS && n < MAX_STEPS) { sim.step(); acc -= STEP_MS; n++; }
      if (n === MAX_STEPS) acc = 0;
      renderer.drawSand();
      dirty = false;
    }

    back = false;
    renderer.drawGlass(sim.angle + sim.tilt);            // reflections follow the room, not the glass
    feedAudio(dtMs / 1000, active, running);
    if (now - lastSave > 5000) { lastSave = now; if (T.state === 'running') saveSession(); }
    showTime(flip.active ? flip.shown : T.rem);
    updateZen(now);
  }

  function feedAudio(dt, active, running) {
    var f = sim.frame, kf = Math.min(1, dt * 7);
    var rel = active ? f.released / dt : 0;
    var imp = active ? (f.impSand + f.impGlass) / dt : 0;
    var sl = active ? f.slides / dt : 0;
    S.flow += (rel - S.flow) * kf;
    S.imp += (imp - S.imp) * kf;
    S.slides += (sl - S.slides) * Math.min(1, dt * 10);
    var bulk = running && sim.nTop > T.tailGrains;
    audio.update({
      dt: dt,
      flow: bulk ? Math.max(S.flow, T.rate * 0.5) : S.flow,
      impacts: S.imp,
      tail: sim.nTop >= T.tailGrains ? 1 : Math.pow(sim.nTop / T.tailGrains, 1.2),
      fill: sim.nBottom / sim.capacity,
      bottom: sim.nBottom,
      slides: S.slides,
      pouring: pour.active,
      running: running,
      ambient: T.state === 'running',  // a running glass keeps its ambience while being turned
      flipping: flip.active,
      spin: Math.abs(flip.spin),
      angle: sim.angle,
      sim: active ? sim : null
    });
  }

  /* ---- readout ------------------------------------------------------ */
  var shownMain = '', shownFrac = '', shownTitle = '';
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(ms) {
    var tenths = Math.max(0, Math.ceil(ms / 100 - 1e-6));
    return [pad2(Math.floor(tenths / 600)) + ':' + pad2(Math.floor(tenths / 10) % 60), '.' + (tenths % 10)];
  }
  function showTime(ms) {
    var f = fmt(ms);
    if (f[0] !== shownMain) { shownMain = f[0]; tMain.textContent = f[0]; }
    if (f[1] !== shownFrac && !app.classList.contains('zen')) { shownFrac = f[1]; tFrac.textContent = f[1]; }   // tenths rest while dimmed
    var title = T.state === 'running' ? f[0] + ' · Hourglass'
              : (T.state === 'done' ? 'Time · Hourglass' : 'Hourglass');
    if (title !== shownTitle) { shownTitle = title; document.title = title; }
  }

  /* ======================================================================
   *  Zen HUD
   * ==================================================================== */
  var zenForced = false, zenSince = 0;
  var END_HOLD = 3000, END_HOLD_QUIET = 1500, END_AWAKE = 12000;
  var endHoldUntil = 0, endWall = -1e9, slowTimer = 0;
  function wake() {
    lastInput = performance.now();
    zenForced = false;
    endHoldUntil = 0;
    clearTimeout(slowTimer);
    app.classList.remove('slow', 'zen-deep');
    if (app.classList.contains('zen')) { app.classList.remove('zen'); applyZoom(); }
  }
  /** The end of a glass: the controls rise and the glass settles back, slowly. */
  function rise() {
    var dim = app.classList.contains('zen');
    wake();
    if (dim) {
      app.classList.add('slow');
      slowTimer = setTimeout(function () { app.classList.remove('slow'); }, 2600);
    }
  }
  function updateZen(now) {
    var hold = false;
    if (endHoldUntil) {
      if (T.state !== 'done' || flip.active) endHoldUntil = 0;   // turned over: it runs again, like any start
      else if (now < endHoldUntil) hold = true;
      else rise();
    }
    var zen = hold || zenForced || (T.state === 'running' && !sheetOpen && !pour.held && !flip.active &&
              now - lastInput > 4000);
    if (zen !== app.classList.contains('zen')) { app.classList.toggle('zen', zen); applyZoom(); }
    // settled: once fully dim, stop re-blurring the panel and stop taking taps on the controls
    var on = app.classList.contains('zen');          // read the class: the moon button sets it directly
    if (!on) zenSince = 0; else if (!zenSince) zenSince = now;
    var deep = on && now - zenSince > 2900;
    if (deep !== app.classList.contains('zen-deep')) app.classList.toggle('zen-deep', deep);
  }
  /** Dim the controls right away; where the browser allows, hide its chrome too. */
  function zenNow() {
    zoom.style.transition = '';                       // even within the launch's first moments: settle slowly
    zenForced = true;
    app.classList.add('zen');
    applyZoom();
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    var inFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (req && !inFs) {
      try {
        var p = req.call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
  }

  /* ======================================================================
   *  Layout
   * ==================================================================== */
  var layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(function () { layoutQueued = false; layout(); });
  }
  var Z = { normal: '', k0: 1 };                 // how the big view is shrunk to sit between the controls
  function safeInsets() {
    var cs = getComputedStyle($('safe'));
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
             b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    // room between the controls
    var left = 0, right = vw, top, bottom;
    if (vw > vh && vh < 520) {
      // landscape phone: readout left, controls right, glass between them
      top = 6; bottom = vh - 6;
      left = hudTop.getBoundingClientRect().right;
      right = hudBottom.getBoundingClientRect().left;
      if (right - left < 120) { left = 0; right = vw; }
    } else {
      top = hudTop.getBoundingClientRect().bottom + (settings.frame ? 6 : 14);
      bottom = hudBottom.querySelector('.panel').getBoundingClientRect().top - (settings.frame ? 12 : 18);
    }
    // room when the controls are dimmed: the whole screen
    var safe = safeInsets();
    var zl = safe.l + 8, zr = vw - safe.r - 8, zt = safe.t + 12, zb = vh - safe.b - 14;
    var zw = Math.max(60, zr - zl), zh = Math.max(120, zb - zt);
    // never let a grain grow past ~2.3 CSS px: it stops reading as sand
    zh = Math.min(zh, renderer._box().h * 2.3);
    var r = renderer.layout(zw, zh, window.devicePixelRatio || 1);
    var x = zl + (zr - zl - r.width) / 2, y = zt + (zb - zt - r.height) / 2;
    zoom.style.width = r.width + 'px';
    zoom.style.height = r.height + 'px';
    zoom.style.left = Math.round(x) + 'px';
    zoom.style.top = Math.round(y) + 'px';
    assembly.style.width = r.width + 'px';
    assembly.style.height = r.height + 'px';
    var k0 = Math.min(1, Math.max(60, right - left - 20) / r.width, Math.max(120, bottom - top) / r.height);
    var dx = (left + right) / 2 - (x + r.width / 2), dy = (top + bottom) / 2 - (y + r.height / 2);
    Z.k0 = k0;
    Z.normal = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + k0.toFixed(4) + ')';
    L.width = r.width * k0; L.height = r.height * k0;
    applyZoom();
    if (flip.active) applyFlip(sim.angle);
    dirty = true;
  }
  /** Dimmed controls give the glass the whole screen; it grows and settles back slowly. */
  function applyZoom() {
    zoom.style.transform = app.classList.contains('zen') ? '' : Z.normal;
  }

  /* ======================================================================
   *  Feedback helpers
   * ==================================================================== */
  function buzz(pattern) {
    if (!settings.haptics || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  /* ---- keep the screen awake while the sand is flowing --------------- */
  var wakeLock = null, wakePending = false, wakeState = 'idle';   // idle | active | failed | unsupported
  var awakeNote = $('awake-note');
  function wantAwake() {
    return settings.keepAwake && !document.hidden &&
      (T.state === 'running' || (T.state === 'done' && Date.now() - endWall < END_AWAKE));
  }
  function showAwake() {
    awakeNote.textContent =
      wakeState === 'unsupported' ? 'Not supported by this browser' :
      !settings.keepAwake ? 'Off: the screen may dim and lock' :
      wakeState === 'active' ? 'On now' :
      wakeState === 'failed' ? 'Not available right now' :
      'While the sand is flowing';
  }
  function syncWakeLock() {
    if (!('wakeLock' in navigator)) { wakeState = 'unsupported'; showAwake(); return; }
    if (wantAwake()) {
      if (wakeLock || wakePending) return;
      wakePending = true;
      navigator.wakeLock.request('screen').then(function (wl) {
        wakePending = false;
        wakeLock = wl; wakeState = 'active';
        wl.addEventListener('release', function () {
          if (wakeLock === wl) wakeLock = null;
          if (wakeState === 'active') wakeState = 'idle';
          showAwake();
          // the system let go (tab hidden, power saving): take it back when allowed
          setTimeout(syncWakeLock, 500);
        });
        showAwake();
        if (!wantAwake()) syncWakeLock();
      }).catch(function () { wakePending = false; wakeState = 'failed'; showAwake(); });
    } else {
      if (wakeLock) {
        var wl = wakeLock; wakeLock = null;
        try { wl.release().catch(function () {}); } catch (e) {}
      }
      if (wakeState !== 'unsupported') wakeState = 'idle';
      showAwake();
    }
  }

  /* ---- the glass remembers where it was ------------------------------ */
  // A real hourglass keeps running when you look away. If the page is
  // closed or reloaded, the timer is restored from the wall clock.
  var SKEY = 'hourglass.session.v1', lastSave = 0;
  function saveSession() {
    try {
      if (T.state === 'idle') { localStorage.removeItem(SKEY); return; }
      localStorage.setItem(SKEY, JSON.stringify({
        v: 1, at: Date.now(), state: T.state, rem: T.rem, durationMs: T.durationMs,
        scale: sim.geo.q, total: sim.total, top: sim.nTop,
        mpg: T.mpg, tailMs: T.tailMs, tailGrains: T.tailGrains
      }));
    } catch (e) {}
  }
  function restoreSession() {
    var s;
    try { s = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return false; }
    if (!s || s.v !== 1 || qt) return false;
    var away = Date.now() - s.at;
    if (!(away >= 0) || away > 6 * 3600000) return false;
    if (s.durationMs !== T.durationMs || s.scale !== sim.geo.q) return false;   // a different glass
    if (!(s.total > 0) || s.total > sim.maxTotal || !(s.mpg > 0) || !(s.tailMs > 0)) return false;
    var rem = +s.rem || 0, state = s.state;
    if (state === 'running') { rem -= away; if (rem <= 0) { rem = 0; state = 'done'; } }
    if (state !== 'running' && state !== 'paused' && state !== 'done') return false;
    if (state === 'done' && away > 3600000) return false;                       // long finished: start fresh
    sim.reset(s.total);
    T.mpg = s.mpg; T.tailMs = s.tailMs; T.tailGrains = s.tailGrains; T.rate = 1000 / T.mpg;
    T.rem = rem;
    var top = state === 'done' ? 0
            : (state === 'paused' ? Math.min(sim.nTop, s.top | 0) : Math.ceil(topAt(rem)));
    if (sim.nTop > top) sim.fastForward(sim.nTop - top);
    for (var i = 0; i < 240 && sim.isActive(); i++) { sim.beginFrame(); sim.step(); }   // settle
    T.state = state;
    return true;
  }

  /* ======================================================================
   *  Input
   * ==================================================================== */

  // Every gesture: unlock audio (iOS) and wake the HUD.
  var wokeFromZen = false;
  function onGesture() {
    audio.unlock();
    if (wakeState === 'failed') syncWakeLock();       // some browsers want a gesture
  }
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(function (t) {
    window.addEventListener(t, onGesture, { capture: true, passive: true });
  });
  window.addEventListener('pointerdown', function () {
    wokeFromZen = app.classList.contains('zen');
    wake();
  }, { capture: true, passive: true });

  // The glass itself: tap it to pause / resume, or take hold and turn it.
  // (A tap that only woke the HUD does nothing else.)
  var grab = null;
  stage.addEventListener('pointerdown', function (e) {
    if (e.button || grab) return;
    var r = assembly.getBoundingClientRect();
    var padX = r.width * 0.04, padY = r.height * 0.01;
    grab = {
      id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), zen: wokeFromZen,
      inside: !(e.clientX < r.left + padX || e.clientX > r.right - padX ||
                e.clientY < r.top + padY || e.clientY > r.bottom - padY),
      cx: r.left + r.width / 2, cy: r.top + r.height / 2, h: r.height,
      turning: false, arc: false, last: 0, lastX: 0
    };
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  });
  stage.addEventListener('pointermove', function (e) {
    var g = grab;
    if (!g || e.pointerId !== g.id) return;
    if (!g.turning) {
      var dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (dx * dx + dy * dy < 256 || !g.inside || sheetOpen || resetting || flip.active) return;
      beginTurn(false);
      flip.dragging = true;
      flip.grabAngle = 0;
      g.turning = true;
      // far enough from the middle to swing it round; otherwise a sideways push
      var rx = g.x - g.cx, ry = g.y - g.cy;
      g.arc = Math.sqrt(rx * rx + ry * ry) > g.h * 0.15;
      g.last = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
      g.lastX = e.clientX;
      return;
    }
    if (!flip.dragging) return;
    if (g.arc) {
      var ang = Math.atan2(e.clientY - g.cy, e.clientX - g.cx), d = ang - g.last;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      flip.grabAngle += d;
      g.last = ang;
    } else {
      flip.grabAngle += (e.clientX - g.lastX) / Math.max(120, L.width) * Math.PI * 0.9;
      g.lastX = e.clientX;
    }
  });
  function stageRelease(e) {
    var g = grab;
    if (!g || e.pointerId !== g.id) return;
    grab = null;
    if (g.turning) { releaseTurn(); return; }
    if (e.type !== 'pointerup' || g.zen || sheetOpen || !g.inside || flip.active) return;
    var dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (dx * dx + dy * dy > 196 || performance.now() - g.t > 700) return;
    audio.tap();                       // fingertip on glass
    toggle();
  }
  stage.addEventListener('pointerup', stageRelease);
  stage.addEventListener('pointercancel', stageRelease);

  btnPlay.addEventListener('click', toggle);
  btnFlip.addEventListener('click', function () { startFlip(false); });
  btnReset.addEventListener('click', function () { buzz(10); reset(false); });

  // + Sand: tap for a pinch, hold for a pour
  function pourStart(e) {
    if (e.button) return;
    e.preventDefault();
    pour.held = true; pour.warned = false;
    pour.until = performance.now() + 240;
    btnSand.classList.add('held');
    try { btnSand.setPointerCapture(e.pointerId); } catch (err) {}
    buzz(8);
  }
  function pourEnd() {
    if (pour.held) saveSession();
    pour.held = false; btnSand.classList.remove('held');
  }
  btnSand.addEventListener('pointerdown', pourStart);
  btnSand.addEventListener('pointerup', pourEnd);
  btnSand.addEventListener('pointercancel', pourEnd);
  btnSand.addEventListener('lostpointercapture', pourEnd);
  btnSand.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { pour.held = true; pour.warned = false; }
  });
  btnSand.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') pourEnd(); });
  btnSand.addEventListener('blur', pourEnd);

  // mute + material shortcuts in the top bar
  function setMuted(m) {
    settings.muted = m; save();
    audio.setMuted(m);
    btnMute.setAttribute('aria-pressed', m ? 'true' : 'false');
    btnMute.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  }
  btnMute.addEventListener('click', function () { setMuted(!settings.muted); buzz(8); });
  btnZen.addEventListener('click', function () { buzz(8); zenNow(); });

  var THEME_ORDER = ['sahara', 'volcanic', 'moonstone'];
  /** Change something about the instrument behind a slow cross-fade. */
  var softTimer = 0;
  function softSwap(fn) {
    clearTimeout(softTimer);
    assembly.classList.add('fade');
    softTimer = setTimeout(function () {
      fn();
      dirty = true;
      requestAnimationFrame(function () { assembly.classList.remove('fade'); });
    }, 380);
  }
  function setTheme(id, soft) {
    settings.theme = id; save();
    document.documentElement.dataset.theme = id;
    themeName.textContent = P.THEMES[id].short;
    if (soft) softSwap(function () { renderer.setTheme(id); });
    else renderer.setTheme(id);
    dirty = true;
    var cards = document.querySelectorAll('#themes .card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].setAttribute('aria-checked', cards[i].dataset.themeId === id ? 'true' : 'false');
    }
  }
  btnTheme.addEventListener('click', function () {
    setTheme(THEME_ORDER[(THEME_ORDER.indexOf(settings.theme) + 1) % THEME_ORDER.length], true);
    buzz(8);
  });

  /* ---- duration pills ----------------------------------------------- */
  function syncPills() {
    var pills = durations.querySelectorAll('.pill[data-min]'), hit = false;
    for (var i = 0; i < pills.length; i++) {
      var on = +pills[i].dataset.min * 60000 === T.durationMs;
      pills[i].setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) hit = true;
    }
    pillCustom.setAttribute('aria-pressed', hit ? 'false' : 'true');
    customLabel.textContent = hit ? 'Custom' : fmt(T.durationMs)[0];
  }
  durations.addEventListener('click', function (e) {
    var pill = e.target.closest('.pill');
    if (!pill) return;
    buzz(8);
    setDuration(+pill.dataset.min * 60000);
  });
  // any length you like: the Custom button, or simply tap the time
  pillCustom.addEventListener('click', function () { buzz(8); openCustom(pillCustom); });
  $('readout').addEventListener('click', function () { buzz(8); openCustom(null); });

  /* ---- sheets ------------------------------------------------------- */
  function openSheet(el, opener) {
    if (sheetOpen === el) return;
    if (sheetOpen) closeSheet(true);
    sheetOpen = el; sheetOpener = opener || null;
    scrim.hidden = false; el.hidden = false;
    void el.offsetHeight;                              // commit start state
    scrim.classList.add('open'); el.classList.add('open');
    var c = el.querySelector('.sheet-close');
    if (c) setTimeout(function () { try { c.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  function closeSheet(instant) {
    var el = sheetOpen;
    if (!el) return;
    sheetOpen = null;
    el.classList.remove('open'); scrim.classList.remove('open');
    var done = function () { el.hidden = true; if (!sheetOpen) scrim.hidden = true; };
    if (instant) done(); else setTimeout(done, 560);
    if (sheetOpener && !instant) { try { sheetOpener.focus({ preventScroll: true }); } catch (e) {} }
    lastInput = performance.now();
  }
  scrim.addEventListener('click', function () { closeSheet(); });
  var closers = document.querySelectorAll('.sheet-close');
  for (var ci = 0; ci < closers.length; ci++) closers[ci].addEventListener('click', function () { closeSheet(); });
  btnSettings.addEventListener('click', function () {
    $('grain-count').textContent = sim.total.toLocaleString();
    openSheet(sheetSettings, btnSettings);
    buzz(8);
  });

  /* ---- settings controls -------------------------------------------- */
  $('themes').addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (c) { setTheme(c.dataset.themeId, true); buzz(8); }
  });
  function setCharacter(id) {
    settings.character = id; save();
    audio.setCharacter(id);
    var b = document.querySelectorAll('#characters button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-checked', b[i].dataset.character === id ? 'true' : 'false');
  }
  $('characters').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) { setCharacter(b.dataset.character); buzz(8); }
  });
  // ambience: an optional layer behind the sand
  var ambRow = $('amb-row'), ambLevel = $('amb-level'), ambOut = $('amb-out');
  function showAmbience() {
    var b = document.querySelectorAll('#ambiences button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-checked', b[i].dataset.ambience === settings.ambience ? 'true' : 'false');
    ambRow.hidden = settings.ambience === 'none';
    var v = Math.round(settings.ambienceLevel * 100);
    ambLevel.value = v; ambOut.textContent = v;
    ambLevel.style.setProperty('--fill', v + '%');
  }
  $('ambiences').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    settings.ambience = b.dataset.ambience; save();
    audio.setAmbience(settings.ambience, true);          // plays a few seconds so it can be heard
    showAmbience();
    buzz(8);
  });
  ambLevel.addEventListener('input', function () {
    settings.ambienceLevel = ambLevel.value / 100; save();
    audio.setAmbienceLevel(settings.ambienceLevel, true);
    showAmbience();
  });
  var vol = $('volume'), volOut = $('volume-out');
  function showVolume() {
    var v = Math.round(settings.volume * 100);
    vol.value = v; volOut.textContent = v;
    vol.style.setProperty('--fill', v + '%');
  }
  vol.addEventListener('input', function () {
    settings.volume = vol.value / 100;
    audio.setVolume(settings.volume);
    if (settings.muted && settings.volume > 0) setMuted(false);
    showVolume(); save();
  });
  $('opt-chime').addEventListener('change', function (e) {
    settings.chime = e.target.checked; save();
    audio.setChimeEnabled(settings.chime);
    if (settings.chime) audio.chime(0);                // audition it
  });
  $('opt-awake').addEventListener('change', function (e) {
    settings.keepAwake = e.target.checked; save();
    syncWakeLock();
  });
  $('opt-frame').addEventListener('change', function (e) {
    settings.frame = e.target.checked; save();
    softSwap(function () {
      renderer.setFrame(settings.frame);
      layout();                                        // the bare glass can sit larger
    });
  });
  // 'click', not 'change': iOS only shows its motion prompt from a direct tap
  $('opt-tilt').addEventListener('click', function (e) { setTilt(e.target.checked, true); });
  $('opt-zen').addEventListener('change', function (e) {
    settings.zenFull = e.target.checked; save();
    app.classList.toggle('zen-full', settings.zenFull);
  });
  $('opt-haptics').addEventListener('change', function (e) {
    settings.haptics = e.target.checked; save();
    buzz(12);
  });

  /* ---- custom duration dial ----------------------------------------- */
  var wheelMin = $('wheel-min'), wheelSec = $('wheel-sec');
  var ITEM = 46;
  function buildWheel(el, count) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var d = document.createElement('div');
      d.textContent = pad2(i);
      frag.appendChild(d);
    }
    el.appendChild(frag);
  }
  buildWheel(wheelMin, 100);
  buildWheel(wheelSec, 60);
  function wheelValue(el) {
    return Math.max(0, Math.min(el.children.length - 1, Math.round(el.scrollTop / ITEM)));
  }
  function setWheel(el, v, smooth) {
    v = Math.max(0, Math.min(el.children.length - 1, v));
    try { el.scrollTo({ top: v * ITEM, behavior: smooth ? 'smooth' : 'auto' }); }
    catch (e) { el.scrollTop = v * ITEM; }
    el.setAttribute('aria-valuenow', v);
  }
  function customMs() {
    var ms = (wheelValue(wheelMin) * 60 + wheelValue(wheelSec)) * 1000;
    return Math.max(10000, ms);
  }
  var previewQueued = false;
  function previewCustom() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(function () {
      previewQueued = false;
      $('custom-preview').textContent = fmt(customMs())[0];
      wheelMin.setAttribute('aria-valuenow', wheelValue(wheelMin));
      wheelSec.setAttribute('aria-valuenow', wheelValue(wheelSec));
    });
  }
  [wheelMin, wheelSec].forEach(function (w) {
    w.addEventListener('scroll', previewCustom, { passive: true });
    w.addEventListener('click', function (e) {
      var items = Array.prototype.slice.call(w.children), i = items.indexOf(e.target);
      if (i >= 0) setWheel(w, i, true);
    });
    w.addEventListener('keydown', function (e) {
      var dlt = e.key === 'ArrowUp' ? -1 : (e.key === 'ArrowDown' ? 1 : 0);
      if (!dlt) return;
      e.preventDefault();
      setWheel(w, wheelValue(w) + dlt, true);
    });
  });
  sheetCustom.addEventListener('click', function (e) {
    var b = e.target.closest('.step');
    if (!b) return;
    var parts = b.dataset.step.split(':'), w = parts[0] === 'min' ? wheelMin : wheelSec;
    var stepBy = parseInt(parts[1], 10), v = wheelValue(w) + stepBy;
    if (parts[0] === 'sec') {                           // snap to 5 s, wrap
      v = Math.round(v / 5) * 5;
      if (v > 59) v = 0; if (v < 0) v = 55;
    }
    setWheel(w, v, true);
    buzz(6);
  });
  function openCustom(opener) {
    openSheet(sheetCustom, opener);
    var total = Math.round(T.durationMs / 1000);
    setWheel(wheelMin, Math.min(99, Math.floor(total / 60)), false);
    setWheel(wheelSec, total % 60, false);
    previewCustom();
  }
  $('custom-set').addEventListener('click', function () {
    var raw = (wheelValue(wheelMin) * 60 + wheelValue(wheelSec)) * 1000;
    if (raw < 10000) toast('Shortest glass is 10 seconds');
    closeSheet();
    setDuration(customMs());
    buzz(12);
  });

  /* ---- keyboard ----------------------------------------------------- */
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { if (sheetOpen) closeSheet(); return; }
    var tag = e.target && e.target.tagName;
    if (sheetOpen || tag === 'INPUT' || tag === 'BUTTON') return;
    wake();
    var key = e.key.toLowerCase();
    if (key === ' ') { e.preventDefault(); toggle(); }
    else if (key === 'f') startFlip(false);
    else if (key === 'r') reset(false);
    else if (key === 'm') setMuted(!settings.muted);
  });

  // keep the page still: no context menu, no pinch-zoom, no rubber band
  app.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  /* ======================================================================
   *  Page lifecycle
   * ==================================================================== */
  function backgroundHold() {
    if (T.state === 'running') {
      var inTail = T.rem < T.tailMs;
      audio.hold(inTail ? 1 : T.rate, inTail ? T.rem / T.tailMs : 1);
    } else {
      audio.hold(0, 0);                // sand silent; the ambience finishes its own course
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) back = true;   // before tickClock: an end found on return is not held
    tickClock();
    if (document.hidden) {
      if (endHoldUntil) wake();        // away during the ending: the controls are up on return
      backgroundHold();
      pourEnd();
      if (grab && grab.turning) { grab = null; releaseTurn(); }
      saveSession();
    } else {
      lastFrame = performance.now(); acc = 0; dirty = true;
    }
    syncWakeLock();
  });
  window.addEventListener('pagehide', saveSession);
  // rAF sleeps in a hidden tab; the clock (and the completion bowl) must not.
  setInterval(function () {
    if (!document.hidden) return;
    tickClock();
    backgroundHold();
  }, 400);

  // When the screen turns, let the picture dip to dark and return slowly
  // instead of snapping into the new layout.
  var wasLandscape = window.innerWidth > window.innerHeight;
  function onResize() {
    var land = window.innerWidth > window.innerHeight;
    if (land !== wasLandscape) {
      wasLandscape = land;
      veil.classList.add('on');
      layout();
      setTimeout(function () { layout(); veil.classList.remove('on'); }, 260);
    } else {
      queueLayout();
    }
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', function () { setTimeout(onResize, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  window.addEventListener('load', queueLayout);

  /* ======================================================================
   *  Boot
   * ==================================================================== */
  sim.reset(grainsFor(T.durationMs));
  calibrate();
  T.rem = T.durationMs;
  var restored = restoreSession();                     // pick up where the glass was left
  app.classList.toggle('zen-full', settings.zenFull);
  $('opt-chime').checked = settings.chime;
  $('opt-awake').checked = settings.keepAwake;
  $('opt-frame').checked = settings.frame;
  $('opt-zen').checked = settings.zenFull;
  $('opt-haptics').checked = settings.haptics;
  showVolume();
  showAmbience();
  setMuted(settings.muted);
  setCharacter(settings.character);
  syncPills();
  zoom.style.transition = 'none';                     // arrive in place, not shrinking from the Zen size
  layout();
  void zoom.offsetWidth;
  setTheme(settings.theme);
  setState(restored ? T.state : 'idle');
  if (settings.tilt) setTilt(true, false);
  showTime(T.rem);
  requestAnimationFrame(function (t) {
    lastFrame = t; T.lastTick = Date.now(); requestAnimationFrame(frame);
    requestAnimationFrame(function () {               // the first frame is drawn: fade up from dark
      veil.style.opacity = getComputedStyle(veil).opacity;   // (on a slow first visit the CSS failsafe
      veil.classList.remove('boot'); void veil.offsetWidth;  //  may already be lifting it: go on from there)
      veil.classList.add('lift'); veil.style.opacity = '';
      setTimeout(function () { zoom.style.transition = ''; veil.classList.remove('lift'); }, 1500);
    });
  });

  // Synthesise the sound beds while idle so the first touch is instant.
  if (window.requestIdleCallback) window.requestIdleCallback(function () { audio.prepare(); }, { timeout: 2500 });
  else setTimeout(function () { audio.prepare(); }, 900);

  // Offline-first PWA. Relative URL + scope so it works from any sub-path.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
    });
  }

  // A small handle for the curious (and for automated tests).
  window.Hourglass = {
    sim: sim, renderer: renderer, audio: audio, timer: T, flip: flip, stats: S,
    start: start, pause: pause, toggle: toggle, reset: reset,
    flipNow: startFlip, setDuration: setDuration, setTheme: setTheme,
    topAt: topAt, remAt: remAt,
    wakeState: function () { return wakeState; }, grav: grav
  };
})();
