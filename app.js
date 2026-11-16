/*!
 * Hourglass — app.js
 * ---------------------------------------------------------------------------
 * Conducts the physics, renderer, audio engine and motion sensors; owns the
 * wall-clock timer, the glass as a body you can move, turn and spin, the
 * controls, the Zen HUD, settings, real motion, wake-lock and PWA
 * registration.
 * License: GPL-3.0.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var P = window.HourglassPhysics;
  var $ = function (id) { return document.getElementById(id); };

  /* ======================================================================
   *  Elements
   * ==================================================================== */
  var app = $('app'), stage = $('stage'), assembly = $('assembly');
  var rotor = $('rotor'), shadow = $('shadow'), lightCanvas = $('c-light'), zoom = $('zoom');
  var spillCanvas = $('c-spill');
  var hudTop = $('hud-top'), hudBottom = $('hud-bottom');
  var tMain = $('t-main'), tFrac = $('t-frac'), statusEl = $('status');
  var btnPlay = $('btn-play'), btnFlip = $('btn-flip'), btnSand = $('btn-sand');
  var btnReset = $('btn-reset'), btnSettings = $('btn-settings');
  var btnMute = $('btn-mute'), btnTheme = $('btn-theme'), themeName = $('theme-name');
  var durations = $('durations'), pillCustom = $('pill-custom'), customLabel = $('custom-label');
  var scrim = $('scrim'), sheetSettings = $('sheet-settings'), sheetCustom = $('sheet-custom');
  var toastEl = $('toast'), veil = $('veil'), btnZen = $('btn-zen'), optTilt = $('opt-tilt');

  /* ======================================================================
   *  Settings (persisted)
   * ==================================================================== */
  var KEY = 'hourglass.settings.v1';
  var settings = {
    theme: 'sahara', character: 'asmr', volume: 0.8, muted: false,
    chime: true, tilt: false, zenFull: false, haptics: true,
    keepAwake: true, frame: true,
    ambience: 'none', ambienceLevel: 0.5,
    durationMs: 5 * 60000,
    motionSign: 0,                   // the accelerometer's sign, once learned (0: not yet)
    hintMend: false                  // the one-time "hold it still to mend" note was shown
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
  if (settings.motionSign !== 1 && settings.motionSign !== -1) settings.motionSign = 0;
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
  // sand that got out of the glass, on the desk below it
  var spill = new P.Spill(spillCanvas, renderer);
  var audio = new window.HourglassAudio();
  audio.volume = settings.volume;
  audio.muted = settings.muted;
  audio.character = settings.character;
  audio.chimeEnabled = settings.chime;
  if (!window.HourglassAudio.CHARACTERS[settings.character]) settings.character = 'asmr';
  if (!window.HourglassAudio.AMBIENCES[settings.ambience]) settings.ambience = 'none';
  audio.ambience = settings.ambience;
  audio.ambLevel = settings.ambienceLevel;
  // The phone's own motion: what it feels, how it turns, where down is.
  // Its sign convention differs between engines; once learned it is kept.
  var motion = new window.HourglassMotion({ sign: settings.motionSign });
  motion.onsign = function (s) { settings.motionSign = s; save(); };

  var STEP_MS = 1000 / P.STEP_HZ;
  var DT = 1 / P.STEP_HZ;
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
    mpg0: 1,                         // ... as calibrated for this glass (re-timing stays within ×4)
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
    T.mpg0 = T.mpg;
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
    // on its side (real motion) the neck cannot flow, so time stands still too
    if (d <= 0 || T.state !== 'running' || flip.active || (grav.on && sim.gy < 0.7)) return;
    T.rem -= d;
    if (T.rem <= 0) { T.rem = 0; finish(); }
  }

  /**
   * Re-timing. Shaking stops the neck now and then (sand cannot flow out of
   * a bed in the air), and a breach in the upper bulb lets sand out the
   * wrong way, so the sand above the neck can drift from what the clock
   * expects. Once the glass is calm again, the rest of the run is re-timed
   * so the sand that is there lasts exactly the time that is left: no gulp,
   * the stream just runs a little faster or slower, and the last grain still
   * leaves at 00:00.0. At most twice a second, and only within ×4 of the
   * rate this glass was calibrated for.
   */
  var lastMotionAt = -1e9, lastRetime = -1e9, motionRecentNow = false;
  function maybeRetime(now, forced) {
    if (now - lastMotionAt < 750 || flip.active || body.mode !== 'rest') return false;
    if (T.state !== 'running') return false;
    if (!forced && now - lastRetime < 500) return false;
    if (T.rem <= T.tailMs + 2000 || sim.nTop <= T.tailGrains + 2) return false;
    if (Math.abs(sim.nTop - topAt(T.rem)) <= Math.max(3, 0.5 * T.rate)) return false;
    var mpg = (T.rem - T.tailMs) / (sim.nTop - T.tailGrains);
    if (!(mpg > T.mpg0 / 4 && mpg < 4 * T.mpg0)) return false;
    T.mpg = mpg;
    T.rate = 1000 / mpg;
    lastRetime = now;
    saveSession();
    return true;
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
  // real motion: where the device says down is, and whether the glass is held the other way up
  var grav = { on: false, target: 0, base: 0, seen: false };
  // the instrument's layout box (zoom-local CSS px); its centre on the page with the
  // controls dimmed (cx, cy), and how far the controls' return moves it (dx, dy)
  var R0 = { width: 0, height: 0, scale: 1, cx: 0, cy: 0, dx: 0, dy: 0 };

  /**
   * `quiet`: the glass was turned by hand or by the phone, not started from
   * the controls, so the controls are not given their four seconds again
   * (playing with the glass never brings them back).
   */
  function setState(s, quiet) {
    var was = T.state;
    T.state = s;
    app.dataset.state = s;
    statusEl.textContent = flip.active ? STATUS.turning : STATUS[s];
    btnPlay.setAttribute('aria-label', s === 'running' ? 'Pause' : (s === 'done' ? 'Flip and start again' : 'Start'));
    if (s === 'running') {
      if (was !== 'running') T.lastTick = Date.now();   // (a glass that was running keeps its time)
      if (!quiet) lastInput = performance.now();
    }
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
  // A new glass: Reset and a new duration also sweep away cracks, gold and
  // spilled sand, inside the same cross-fade.
  function reset(keepRunning) {
    if (resetting) return;
    resetting = true;
    pendingStart = false;
    audio.hush();
    app.classList.add('swap');       // cross-fade the sand (and any that spilled)
    setTimeout(function () {
      var was = crackState();
      if (flip.active) { flip.active = false; flip.dragging = false; }
      if (grab) grab.kind = 'none';  // a finger still down no longer holds the glass
      bodyHome();
      grav.base = 0;
      endMend(true);
      spill.clear();
      sim.reset(grainsFor(T.durationMs));
      sim.tilt = 0;
      calibrate();
      T.rem = T.durationMs;
      S.flow = S.imp = S.slides = 0;
      leakRate = 0;
      audio.setCracked('intact');
      if (was !== 'intact') audio.newGlass();
      applyBody(0);
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
    from: 0, to: 0, prog: 0, dur: 0, easeOut: false,
    grabAngle: 0, spin: 0, shown: 0,
    mode: 'rest'                     // the body's mode: 'script' for the Flip button's turn
  };

  function beginTurn(autoRun, byHand) {
    flip.active = true;
    flip.was = T.state;
    flip.auto = !!autoRun;
    flip.swapped = false;
    flip.shown = T.rem;
    sim.flipping = true;
    sim.wakeAll();
    statusEl.textContent = STATUS.turning;
    audio.flipStart();
    if (!byHand) buzz(14);           // a hand has already felt the glass engage
  }

  /** The Flip button: one smooth half turn (not while a hand has the glass or it is still turning). */
  function startFlip(autoRun) {
    if (flip.active || resetting || held || rot !== 'none') return;
    beginTurn(autoRun, false);
    flip.from = 0; flip.to = Math.PI; flip.prog = 0;
    flip.dur = 2600; flip.easeOut = false;   // unhurried
    rot = 'script';
    body.w = 0;
    syncMode();
  }

  /**
   * With Reduce Motion a turned glass never spins on: let go, and it settles
   * on whichever end is nearer (or where it was flung), as it always did.
   */
  function releaseTurn() {
    var a = sim.angle, w = body.w, to;
    if (w > 2.2) to = a > 0 ? Math.PI : 0;
    else if (w < -2.2) to = a < 0 ? -Math.PI : 0;
    else to = Math.abs(a) > Math.PI / 2 ? (a > 0 ? Math.PI : -Math.PI) : 0;
    flip.from = a; flip.to = to; flip.prog = 0;
    flip.dur = Math.max(420, Math.min(1500, Math.abs(to - a) / Math.PI * 1900));
    flip.easeOut = true;
    rot = 'ease';
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
    var byHand = rot !== 'script';
    flip.active = false; flip.dragging = false; flip.spin = 0;
    sim.flipping = false;
    sim.angle = 0;
    rot = 'none';
    body.w = 0; body.theta = 0;
    syncMode();
    sim.wakeAll();
    applyBody(0);
    audio.flipEnd();
    buzz(22);
    setState(flip.swapped ? stateAfterSwap(flip.was, flip.auto) : flip.was, byHand);
  }
  /** Turning a glass over starts it, unless you had paused it. */
  function stateAfterSwap(was, auto) {
    if (T.rem <= 0) return 'done';
    return (auto || was === 'running' || was === 'done') ? 'running' : 'paused';
  }

  /* ======================================================================
   *  The glass as a body
   *
   *  The glass is a real object of the size it appears. Taken by its waist
   *  it follows the finger wherever it still fits on the screen; taken by a
   *  bulb it turns; flicked, it spins on by itself, slowing as its sand is
   *  flung outward, and settles upright or inverted. Touch it while it
   *  moves and it stops under the finger. The sand feels all of it: the
   *  glass's true on-screen acceleration and turning enter the field the
   *  simulation steps in (composeField), so a drag sloshes the sand and a
   *  hard spin pins it to the ends.
   *
   *  It stands on a desk and lives in a room: the desk is a floor at its
   *  resting height, the screen's edges are walls. Let go in the air it
   *  falls under the sand's own slow-motion gravity, lands, bounces a
   *  little and is centred again; thrown, it flies. Whatever it strikes it
   *  strikes at some speed, and that blow reaches the glass (sim.impact),
   *  the sand, the ear and the hand (bodyHit).
   *
   *  One step of this model runs before every physics step (1/120 s).
   *  Offsets are page px from home; angles rad, + = clockwise on screen.
   * ==================================================================== */
  var MM_PER_PX = 0.16;              // an iPhone CSS px is ≈ 0.166 mm
  var KPX = MM_PER_PX * 1e-3 / 9.81; // g per px/s² of the glass's on-screen acceleration
  var K_DRAG = 1.0;                  // the one tuning knob for drags (1–3), set by feel on the device
  var BODY = {
    fw: 30, fz: 0.85,                // the finger holding it by the waist (rad/s, damping ratio)
    hw: 7, hz: 0.6,                  // home: 9 % overshoot, settled to 2 % in 0.84 s
    tw: 26, tz: 0.85,                // the finger turning it by a bulb: lags it by ≈ 65 ms
    tau: 1.6, mu: 1.5,               // a free spin coasts: viscous time (s) and dry friction (rad/s²)
    wFree: 2.2,                      // rad/s: let go faster than this and it spins on
    wMax: 16,                        // rad/s: never faster
    dw: 7, dz: 0.9,                  // the detent that sets it down on an end
    turnAt: 0.07,                    // rad (4°): a smaller nudge is not a turn
    zone: 0.15,                      // grabs this near the centre (× its height) move it; farther out turn it
    bounce: 0.2,                     // what it keeps of its speed off the desk or an edge of the screen
    bounceMin: 70,                   // px/s: a slower rebound is no bounce (so two visible ones at most)
    hitMin: 120,                     // px/s: a slower contact is a touch, not a blow
    joltK: 0.22, joltV0: 170, joltMax: 200,   // a landing throws the bed up at joltK·(v − joltV0), cells/s
    joltSide: 300, joltSideMax: 3,   // a blow from the side pushes the sand at v / joltSide g (cells/s per g), 3 g at most
    catchTau: 0.01,                  // s: a finger stops a moving glass this quickly, where it is
    stopW: 0.02, stopV: 2,           // rad/s, px/s: slow enough to count as stopped under the finger
    pivot: 0.03                      // × its height: this close to the centre a finger's angle does not turn it
  };
  var body = {
    mode: 'rest',                    // rest | held-move | held-turn | free | detent | script | home
    px: 0, py: 0,                    // offset from home, page px
    vx: 0, vy: 0,                    // px/s
    ax: 0, ay: 0,                    // px/s², this step: what the sand feels
    theta: 0,                        // = sim.angle
    w: 0,                            // on-screen rotation rate, rad/s (no jumps at the swaps)
    tx: 0, ty: 0,                    // where the finger pulls it
    td: 0,                           // the end the detent sets it down on
    air: false,                      // let go in the air and not landed yet: it falls freely, and its sand with it
    jx: 0, jy: 0, jn: 0,             // what a blow does to the sand: g, page frame, for jn more steps
    hits: 0, hitV: 0, hitGrade: 0    // blows it has taken; the last one's speed (px/s) and what it did (sim.impact)
  };
  // The room the glass has, as offsets from home (page px): the desk is a
  // floor at 0, the screen's edges are the walls (x0 … x1) and the ceiling
  // (y0). g is the gravity it falls under, px/s²: the sand's own slow-motion
  // gravity at the size the glass is drawn.
  var room = { x0: 0, x1: 0, y0: 0, g: 0, px: 1 };
  var rot = 'none';                  // none | held | free | detent | ease | script
  var held = false;                  // a finger holds it by the waist
  var catching = false;              // a finger has just caught it moving and is stopping it
  var inertia0 = 0;                  // the spinning glass's moment of inertia a step ago
  var passBuzzAt = -1e9;

  /** body.mode (and flip.mode) from what the hand and the turn are doing. */
  function syncMode() {
    var m;
    if (rot === 'held') m = 'held-turn';
    else if (rot === 'free') m = 'free';
    else if (rot === 'detent' || rot === 'ease') m = 'detent';
    else if (rot === 'script') m = 'script';
    else if (held) m = 'held-move';
    else if (body.px || body.py || body.vx || body.vy) m = 'home';
    else m = 'rest';
    body.mode = m;
    flip.mode = m;
    flip.dragging = rot === 'held';
  }

  /** Back home at once (Reset): no offset, no turn, nothing moving. */
  function bodyHome() {
    held = false; rot = 'none'; catching = false;
    body.px = body.py = body.vx = body.vy = body.ax = body.ay = 0;
    body.tx = body.ty = 0;
    body.w = 0; body.theta = 0;
    body.air = false; body.jx = body.jy = 0; body.jn = 0;
    sim.angle = 0;
    syncMode();
  }

  /** Measure the room (see `room`): once a frame, and whenever the layout changes. */
  function measureRoom() {
    var g = sim.geo, zen = app.classList.contains('zen');
    var s = renderer.scale * (zen ? 1 : Z.k0);            // CSS px per cell on screen
    var hw = (renderer.frame ? g.capHalf : g.R + g.wall) * s;
    var hh = (g.HB + (renderer.frame ? 14 : 2) * g.q) * s;
    var cx = R0.cx + (zen ? 0 : R0.dx), cy = R0.cy + (zen ? 0 : R0.dy);
    room.x0 = Math.min(0, hw - cx);
    room.x1 = Math.max(0, window.innerWidth - hw - cx);
    room.y0 = Math.min(0, hh - cy);
    room.g = sim.G * s;
    room.px = s;
  }

  /**
   * The glass has struck the desk or an edge of the screen at v px/s, the
   * speed straight into it; (nx, ny) points from the glass to what it hit
   * (page frame). The glass takes the blow where it hit (sim.impact: a
   * clink, a creak, a crack or a breach, by the speed); the sand feels it
   * through the field it already steps in (a landing throws the bed up, so
   * it jumps and lands; a blow from the side pushes it over), bounded so
   * that a small set-down stays calm; and it is heard and felt, scaled by
   * the speed. With Reduce Motion the sand is left alone.
   */
  function bodyHit(nx, ny, v) {
    var rho = sim.angle + grav.base, c = Math.cos(rho), s = Math.sin(rho);
    var grade = sim.impact(nx * c + ny * s, -nx * s + ny * c, v);
    body.hits++; body.hitV = v; body.hitGrade = grade;
    if (!reduceMotion) {
      var vc = v / room.px, G = sim.G, a;
      if (ny !== 0) {
        // the bed leaves its seat at u cells/s after two steps of this pull
        var u = BODY.joltK * (vc - BODY.joltV0);
        if (u > BODY.joltMax) u = BODY.joltMax;
        if (u > 0) { body.jx = 0; body.jy = -(1.05 + u / (2 * DT * G)); body.jn = 2; }
      } else {
        a = vc / BODY.joltSide;
        if (a > BODY.joltSideMax) a = BODY.joltSideMax;
        if (a > 0.3) { body.jx = nx * a; body.jy = 0; body.jn = 4; }
      }
      sim.wakeAll();
    }
    // the base on the desk (or the frame on the screen's edge), and the glass answering
    var k = v / 1800;
    audio.thump(k * k, 0.8 * nx, sim.nTop >= sim.nBottom ? 0 : 1);
    if (v > 300) { k = (v - 250) / 1700; audio.clack(k * k, 0.8 * nx); }
    if (v > 300) buzz(grade ? 16 : 8);
    lastMotionAt = performance.now();
  }

  /** How far a spin at w rad/s coasts before friction stops it (rad, signed): the exact distance. */
  function coastDistance(w) {
    var a = w < 0 ? -w : w, mt = BODY.mu * BODY.tau;
    var d = BODY.tau * a - mt * BODY.tau * Math.log(1 + a / mt);
    return w < 0 ? -d : d;
  }

  /** The glass's moment of inertia about its centre: its own, plus its sand's (cells², grain masses). */
  function inertia() {
    var r = 0.55 * sim.geo.HB;
    return 0.6 * sim.capacity * r * r + sim.inertiaZ();
  }

  /** Slow enough to settle: latch the end it is heading for (never more than half a turn away). */
  function enterDetent() {
    var k = Math.round((sim.angle + coastDistance(body.w)) / Math.PI);
    if (k > 1) k = 1; else if (k < -1) k = -1;
    body.td = k * Math.PI;
    rot = 'detent';
  }

  /** A soft tick each time a free spin passes the swap, at most eight a second. */
  function passBuzz() {
    if (rot !== 'free') return;
    var now = performance.now();
    if (now - passBuzzAt < 125) return;
    passBuzzAt = now;
    buzz(4);
  }

  /** One step of the glass as a body: where it is, how it is turned. */
  function stepBody(dt) {
    var ax = 0, ay = 0, k, c, v, e, hx = false, hy = false, vx0 = body.vx, vy0 = body.vy;
    var flying = false;
    if (body.jn > 0 && --body.jn === 0) body.jx = body.jy = 0;   // (a blow's push on the sand has been felt)
    if (held && catching) {
      // Caught on its way home: the finger's grip slips over the glass until
      // it has stopped it, so it stops where it is, with nothing to pull it
      // back to where the finger first touched it.
      k = (Math.exp(-dt / BODY.catchTau) - 1) / dt;
      ax = k * body.vx; ay = k * body.vy;
    } else if (held) {
      k = BODY.fw; c = 2 * (reduceMotion ? 1 : BODY.fz) * k;
      ax = k * k * (body.tx - body.px) - c * body.vx;
      ay = k * k * (body.ty - body.py) - c * body.vy;
    } else if (reduceMotion) {
      // Reduce Motion: let go, it glides home as it always did (no fall, no sway)
      if (body.px || body.py || body.vx || body.vy) {
        k = BODY.hw; c = 2 * k;
        ax = -k * k * body.px - c * body.vx;
        ay = -k * k * body.py - c * body.vy;
      }
    } else if (body.py < 0 || body.vy < 0) {
      ay = room.g;                                        // in the air: it falls (and flies on, if it was thrown)
      flying = true;
    } else if (body.px || body.vx) {
      k = BODY.hw; c = 2 * BODY.hz * k;                   // on the desk: the home spring centres it
      ax = -k * k * body.px - c * body.vx;
    }
    if (!flying) body.air = false;
    // Against the desk or an edge, a push into it moves nothing (the finger
    // slides on); only arriving at speed is a blow.
    if (body.py >= 0 && ay > 0 && body.vy >= 0) { ay = 0; body.vy = 0; }
    if (body.py <= room.y0 && ay < 0 && body.vy <= 0) { ay = 0; body.vy = 0; }
    if (body.px >= room.x1 && ax > 0 && body.vx >= 0) { ax = 0; body.vx = 0; }
    if (body.px <= room.x0 && ax < 0 && body.vx <= 0) { ax = 0; body.vx = 0; }
    body.vx += ax * dt; body.vy += ay * dt;
    body.px += body.vx * dt; body.py += body.vy * dt;
    // A hand sets it down dead; let go, it keeps a fifth of its speed, while that is still a bounce.
    e = held || reduceMotion ? 0 : BODY.bounce;
    if (body.py > 0) {
      v = body.vy; body.py = 0;
      body.vy = v * e > BODY.bounceMin ? -v * e : 0;
      body.air = false;
      if (v > BODY.hitMin) { bodyHit(0, 1, v); hy = true; }
    } else if (body.py < room.y0) {
      v = -body.vy; body.py = room.y0;
      body.vy = v * e > BODY.bounceMin ? v * e : 0;
      if (v > BODY.hitMin) { bodyHit(0, -1, v); hy = true; }
    }
    if (body.px > room.x1) {
      v = body.vx; body.px = room.x1;
      body.vx = v * e > BODY.bounceMin ? -v * e : 0;
      if (v > BODY.hitMin) { bodyHit(1, 0, v); hx = true; }
    } else if (body.px < room.x0) {
      v = -body.vx; body.px = room.x0;
      body.vx = v * e > BODY.bounceMin ? v * e : 0;
      if (v > BODY.hitMin) { bodyHit(-1, 0, v); hx = true; }
    }
    // What the sand feels of this at the glass's true size: its acceleration
    // as it really moved (a blow's own share comes through bodyHit instead,
    // and free fall is felt at the sand's scale: see composeField).
    body.ax = hx ? 0 : (body.vx - vx0) / dt;
    body.ay = hy || flying ? 0 : (body.vy - vy0) / dt;
    if (!held && body.px * body.px + body.py * body.py < 0.25 &&
        body.vx * body.vx + body.vy * body.vy < 25) {
      body.px = body.py = body.vx = body.vy = 0;          // home, to within half a pixel
    }
    if (held && catching && body.vx * body.vx + body.vy * body.vy < BODY.stopV * BODY.stopV) regrip();
    if (rot !== 'none') turnStep(dt);
    syncMode();
  }

  /**
   * The finger has stopped the glass it caught. From here it simply holds
   * it, from where the glass and the finger now are, so it stays put under
   * a still finger and follows the finger as soon as it moves.
   */
  function regrip() {
    catching = false;
    flip.grabAngle = sim.angle;
    body.tx = body.px; body.ty = body.py;
    if (grab && grab.kind === 'move') anchorMove(grab);
  }

  function turnStep(dt) {
    var th = sim.angle, prev = th, w = body.w, a, wm = BODY.wMax;
    if (rot === 'script' || rot === 'ease') {
      // The Flip button's unhurried half turn (and, with Reduce Motion, letting go).
      // Its rate comes from the steps themselves, so the sand feels it turn.
      flip.prog += dt * 1000 / flip.dur;
      if (flip.prog >= 1) {
        if (flip.to !== 0) swapEnds();
        if (flip.active) endTurn(); else endNudge();
        return;
      }
      var p = flip.prog;
      var e = flip.easeOut ? 1 - Math.pow(1 - p, 3)
                           : (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
      th = flip.from + (flip.to - flip.from) * e;
      w = (th - prev) / dt;
    } else if (rot === 'held' && catching) {
      // Caught while it turned: the finger's grip slips until the glass has
      // stopped, so it stops where it is and stays there (a spring anchored
      // where the finger first touched would swing it back).
      w *= Math.exp(-dt / BODY.catchTau);
      th += w * dt;
      flip.grabAngle = th;
    } else if (rot === 'held') {
      // follows the finger with some weight
      a = BODY.tw * BODY.tw * (flip.grabAngle - th) - 2 * BODY.tz * BODY.tw * w;
      w += a * dt;
      if (w > wm) w = wm; else if (w < -wm) w = -wm;
      th += w * dt;
    } else if (rot === 'free') {
      // coasting: drag, plus a little dry friction ...
      w += (-w / BODY.tau - (w > 0 ? BODY.mu : -BODY.mu)) * dt;
      if (w > wm) w = wm; else if (w < -wm) w = -wm;
      // ... and the skater effect: as the sand is flung outward the glass slows
      var I = inertia();
      if (inertia0 > 0 && I > 0) w *= inertia0 / I;
      inertia0 = I;
      th += w * dt;
    } else {
      // the detent sets it down on the end it was heading for
      a = BODY.dw * BODY.dw * (body.td - th) - 2 * BODY.dz * BODY.dw * w;
      w += a * dt;
      th += w * dt;
    }
    if (!flip.active && (th > BODY.turnAt || th < -BODY.turnAt)) beginTurn(false, true);
    // past half a turn the glass is simply the other way up
    if (rot === 'held' || rot === 'free') {
      if (th > Math.PI) { swapEnds(); th -= Math.PI; flip.grabAngle -= Math.PI; passBuzz(); }
      else if (th < -Math.PI) { swapEnds(); th += Math.PI; flip.grabAngle += Math.PI; passBuzz(); }
    }
    sim.angle = th; body.theta = th; body.w = w; flip.spin = w;
    if (catching && rot === 'held' && w < BODY.stopW && w > -BODY.stopW) regrip();
    if (rot === 'free') {
      if (w < BODY.wFree && w > -BODY.wFree) enterDetent();
    } else if (rot === 'detent') {
      var d = th - body.td;
      if (d < 0.002 && d > -0.002 && w < 0.05 && w > -0.05) {
        if (body.td > 1 || body.td < -1) swapEnds();
        if (flip.active) endTurn(); else endNudge();
      }
    }
  }
  /** A nudge that never became a turn has sprung back: nothing to undo but the angle. */
  function endNudge() {
    sim.angle = 0; sim.flipping = false;
    body.theta = 0; body.w = 0;
    rot = 'none';
  }

  /** True while the glass is still moving on its own: a touch now catches it. */
  function bodyMoving() {
    if (rot === 'free' || rot === 'detent' || rot === 'ease' || body.w > 0.5 || body.w < -0.5) return true;
    return !held && (body.px * body.px + body.py * body.py > 1 || body.vx * body.vx + body.vy * body.vy > 25);
  }
  /** True while the body needs stepping. */
  function bodyBusy() {
    return rot !== 'none' || held || body.px !== 0 || body.py !== 0 || body.vx !== 0 || body.vy !== 0;
  }

  /* ---- what the sand feels ------------------------------------------ */
  // Every inertial effect enters at the strength it would have on a real
  // glass of the size this one appears on screen: the phone's own motion,
  // the glass's on-screen acceleration, and its turning (centrifugal and
  // Euler × λ, Coriolis × √λ inside the sim).
  var mo = { x: 0, y: 0, z: 0, w: 0, wf: 0, rms: 0, armed: false, live: false };
  var moP = { x: 0, y: 0, z: 0, w: 0, wf: 0, rms: 0, armed: false, live: false };
  var ALPHA_K = 1 - Math.exp(-DT / 0.04);      // the turn's rate of change, smoothed over 40 ms
  var alLP = 0, wPrev = 0, lamNow = 0, kfNow = 1, feltX = 0, feltY = 0;

  /** The felt field for the next physics step at time tS (ms, performance.now()), into the sim. */
  function composeField(tS) {
    var rho = sim.angle + grav.base, c = Math.cos(rho), s = Math.sin(rho);
    var mx = 0, my = 0, mz = 0, mw = 0;
    if (grav.on && motion.seenMotion) {
      motion.sample(tS, mo);
      mx = mo.x; my = mo.y; mz = mo.z;
      var tw = mo.w, wf = mo.wf;
      if (reduceMotion) {
        // gentler: half as strong, and never enough to lift the bed or crack the glass
        mx *= 0.5; my *= 0.5;
        var m = Math.sqrt(mx * mx + my * my);
        if (m > 0.8) { mx *= 0.8 / m; my *= 0.8 / m; }
        mz *= 0.5;
        if (tw > 6) tw = 6; else if (tw < -6) tw = -6;
        if (wf > 6) wf = 6;
      }
      mw = tw + wf;
    }
    // the glass accelerating one way pushes its sand the other (g, page frame);
    // a blow pushes it for a moment more (bodyHit), and while the glass falls
    // freely its sand falls with it, all but weightless
    var fx = mx - K_DRAG * KPX * body.ax + body.jx, fy = my - K_DRAG * KPX * body.ay + body.jy;
    if (body.air) fy -= 0.9;
    var G = sim.G;
    var w = body.w + mw;
    alLP += ((w - wPrev) / DT - alLP) * ALPHA_K;
    wPrev = w;
    var al = alLP > 300 ? 300 : (alLP < -300 ? -300 : alLP);
    sim.setMotion(G * (fx * c + fy * s), G * (-fx * s + fy * c), w, al, lamNow, mz);
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
   *  Real motion (optional)
   *
   *  The sand feels what the phone feels. Lean it and the piles slump; lay
   *  it on its side and the flow stops; turn it over and the other bulb
   *  becomes the top; walk and the thread sways; shake it and the beds lift
   *  and land; twist it and the sand sloshes. One permission covers it all.
   * ==================================================================== */
  function wrapPi(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  }

  var motionWatch = 0, rearmTimer = 0, rearm = null, askSeq = 0;
  var REARM_EVENTS = ['pointerup', 'touchend', 'keydown'];

  function motionOff(msg) {
    askSeq++;                                     // an answer still on its way no longer counts
    clearTimeout(motionWatch); clearTimeout(rearmTimer); disarmRequest();
    motion.stop();
    grav.on = false; grav.target = 0; grav.seen = false;
    settings.tilt = false; optTilt.checked = false; save();
    if (msg) toast(msg);
  }
  function motionGo() {
    motion.start();
    grav.on = true;
    settings.tilt = true; optTilt.checked = true; save();
  }
  /** Some devices grant access but never report a reading. */
  function watchMotion(loud) {
    clearTimeout(motionWatch);
    motionWatch = setTimeout(function () {
      if (grav.on && !motion.seenOrient) motionOff(loud ? 'No motion data from this device' : '');
    }, 2500);
  }
  /** Ask for motion access. Must run inside a tap: the request goes out before anything else. */
  function askMotion() {
    var req, my = ++askSeq;
    try { req = motion.request(); } catch (e) { motionOff('Motion access is unavailable'); return; }
    req.then(function (r) {
      if (my !== askSeq) return;                 // switched off (or asked again) meanwhile
      if (r === 'granted') { motionGo(); watchMotion(true); }
      else if (r === 'denied') motionOff('Motion access was declined. Allow it in Settings to use this.');
      else motionOff('Motion is not available on this device');
    }, function () {
      if (my === askSeq) motionOff('Motion access is unavailable');
    });
  }
  /**
   * Real motion was left on, but this browser asks again after a reload and
   * a prompt needs a tap: ask on the next one (pointerup and touchend count
   * as a tap on a touch screen; pointerdown does not). If the site was
   * already allowed, the answer comes back without a prompt.
   */
  function armRequest() {
    if (rearm) return;
    rearm = function () {
      disarmRequest();
      if (grav.on && !motion.seenOrient && !motion.seenMotion) askMotion();
    };
    for (var i = 0; i < REARM_EVENTS.length; i++) window.addEventListener(REARM_EVENTS[i], rearm, true);
  }
  function disarmRequest() {
    if (!rearm) return;
    for (var i = 0; i < REARM_EVENTS.length; i++) window.removeEventListener(REARM_EVENTS[i], rearm, true);
    rearm = null;
  }

  /** The Real motion switch. fromUser: inside the switch's click, where a prompt may be shown. */
  function setMotion(on, fromUser) {
    askSeq++;
    clearTimeout(motionWatch); clearTimeout(rearmTimer); disarmRequest();
    if (!on) { motionOff(''); return; }
    if (!window.DeviceMotionEvent && !window.DeviceOrientationEvent) {
      motionOff(fromUser ? 'Motion is not available on this device' : '');
      return;
    }
    if (fromUser) {
      if (motion.needsPermission) { optTilt.checked = true; askMotion(); }
      else { motionGo(); watchMotion(true); }
      return;
    }
    // At start-up with the switch left on: listen without asking (and keep the switch on).
    motionGo();
    if (motion.needsPermission) {
      rearmTimer = setTimeout(function () {
        if (grav.on && !motion.seenOrient && !motion.seenMotion) armRequest();
      }, 1000);
    } else watchMotion(false);
  }

  /** Held the other way up: the lower bulb is the top now. */
  function tiltSwap() {
    var was = T.state, there = remAt(sim.total - sim.nTop);
    sim.completeFlip();
    grav.base = grav.base ? 0 : Math.PI;
    sim.tilt = wrapPi(sim.tilt + Math.PI);
    T.rem = there;
    applyBody(0);
    buzz(18);
    setState(stateAfterSwap(was, false), true);       // the phone turned over: not a touch
  }

  var tiltOver = 0;
  function stepGravity(dtMs, now) {
    var want = grav.on ? grav.target : 0;
    if (want > -0.045 && want < 0.045) want = 0;          // standing straight: let the sand sleep
    // follows the sensor briskly while it reports, eases over otherwise; never snaps
    var tau = grav.on && motion.seenOrient ? 100 : 240;
    var d = wrapPi(want + grav.base - sim.tilt);
    if (d > 0.0008 || d < -0.0008) {
      sim.tilt = wrapPi(sim.tilt + d * (1 - Math.exp(-dtMs / tau)));
      sim.wakeAll();
    } else if (d !== 0) {
      sim.tilt = wrapPi(want + grav.base);
      sim.wakeAll();
    }
    // Turned over, and held so for a moment (a shake or a glitch is not a turn):
    // the other bulb becomes the top.
    var over = !flip.active && !resetting && !held && rot !== 'held' &&
               (sim.tilt > 1.75 || sim.tilt < -1.75);
    if (!over) tiltOver = 0;
    else if (!tiltOver) tiltOver = now;
    else if (now - tiltOver >= 200) { tiltOver = 0; tiltSwap(); }
  }

  /* ======================================================================
   *  Frame loop
   * ==================================================================== */
  var PERF_N = 600;
  var perf = {
    frameMs: new Float32Array(PERF_N),      // JS work per frame
    simMs: new Float32Array(PERF_N),        // ... of which physics steps
    drawMs: new Float32Array(PERF_N),       // ... of which drawSand
    intervalMs: new Float32Array(PERF_N),   // time between frames
    i: 0,                                    // next slot
    quality: 2, emaSim: 0
  };
  var gov = { hi: 0, top: 0, low: 0 };

  /**
   * Keep the frame within budget on slower phones: when the physics alone
   * takes too long for a second, lighten it (fewer sweeps, less spray);
   * when it has been cheap for three seconds, give one level back.
   */
  function governor(simMs, dtMs) {
    if (dtMs > 100) dtMs = 100;
    perf.emaSim += (simMs - perf.emaSim) * (1 - Math.exp(-dtMs / 300));
    var e = perf.emaSim, q = sim.quality;
    gov.hi = e > 4.5 ? gov.hi + dtMs : 0;
    gov.top = e > 6 ? gov.top + dtMs : 0;
    gov.low = e < 3 ? gov.low + dtMs : 0;
    if (gov.top >= 1000 && q > 0) q = 0;
    else if (gov.hi >= 1000 && q > 1) q = 1;
    else if (gov.low >= 3000 && q < 2) { q++; gov.low = 0; }
    sim.quality = q;
    perf.quality = q;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var t0 = performance.now();
    var dtMs = now - lastFrame;
    lastFrame = now;
    if (dtMs <= 0) return;

    tickClock();
    if (grav.on) {
      var hd = motion.heading;
      if (hd === hd && hd !== Infinity && hd !== -Infinity) grav.target = hd;   // finite: known
      grav.seen = motion.seenOrient;
    }
    handlePour(now, dtMs);
    stepGravity(Math.min(dtMs, 100), now);
    updateMend(now);

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
    // Shaken, the neck stutters and falls behind. While that is recent, a
    // backlog drains as a slightly thicker thread, never as a clump.
    var motionRecent = motionRecentNow = now - lastMotionAt < 2000;
    sim.relCap = motionRecent ?T.rate * DT * (3 + 20 * Math.max(0, 1 - (T.rem - T.tailMs) / 5000)) : 0;
    // only sustained, very hard real shaking can crack the glass
    sim.damageArmed = grav.on && motion.armed && !reduceMotion;
    sim.spinArmed = !reduceMotion && (rot === 'free' || rot === 'held' || rot === 'detent');   // spun by hand
    sim.reduced = reduceMotion;
    // the rotational terms at the glass's true size on screen
    lamNow = renderer.scale * zoomK() * kfNow * MM_PER_PX * 1e-3 * sim.G / 9.81;

    var felt = false;
    feltX = feltY = 0;
    if (grav.on && motion.seenMotion) {
      motion.sample(now, moP);
      feltX = moP.x; feltY = moP.y;
      felt = moP.x !== 0 || moP.y !== 0 || moP.z !== 0 || moP.w !== 0 || moP.wf !== 0;
    }

    var active = running || draining || flip.active || pour.active || dirty || sim.isActive() ||
                 bodyBusy() || spill.active || renderer.animating || felt;
    var simMs = 0, drawMs = 0;
    if (active) {
      drainDamage(now);                         // events from outside a frame (a forced crack, a mend)
      sim.beginFrame();
      dmgSeen = 0;
      if (sim.gateOpen && (back || !motionRecent)) {
        // the tab was asleep and the clock ran on: catch up without flight
        // (never while the glass was just shaken: that lag is re-timed instead)
        var owed = sim.nTop - target;
        var cap = back ? Math.max(12, T.rate * 0.4) : Math.max(400, T.rate * 1.2);
        if (owed > cap) sim.fastForward(owed - Math.min(30, Math.ceil(cap * 0.5)));
      }
      acc += Math.min(dtMs, 100);
      var n = 0, tS = now - acc, s0 = performance.now();
      while (acc >= STEP_MS && n < MAX_STEPS) {
        tS += STEP_MS;
        stepBody(DT);
        composeField(tS);
        sim.step();
        if (sim.motionActive()) lastMotionAt = now;
        acc -= STEP_MS; n++;
      }
      if (n === MAX_STEPS) acc = 0;
      var s1 = performance.now();
      simMs = s1 - s0;
      renderer.drawSand();
      drawMs = performance.now() - s1;
      dirty = false;
    }

    back = false;
    drainDamage(now);
    drainEscapes();
    var landed = stepSpill(dtMs);
    applyBody(dtMs);
    if (flip.active) {
      var f = Math.min(1, Math.abs(sim.angle) / Math.PI);
      f = f * f * (3 - 2 * f);
      flip.shown = T.rem + (remAt(sim.total - sim.nTop) - T.rem) * f;
    }
    renderer.drawGlass(sim.angle + sim.tilt);            // reflections follow the room, not the glass
    renderer.syncDamage(sim.angle + sim.tilt, now);      // cracks glint as the glass turns
    feedAudio(dtMs / 1000, active, running, landed);
    maybeRetime(now, false);
    governor(simMs, dtMs);
    if (now - lastSave > 5000) { lastSave = now; if (T.state === 'running') saveSession(); }
    showTime(flip.active ? flip.shown : T.rem);
    updateZen(now);
    if (dbg) updateDebug(now, dtMs);

    var pi = perf.i;
    perf.frameMs[pi] = performance.now() - t0;
    perf.simMs[pi] = simMs;
    perf.drawMs[pi] = drawMs;
    perf.intervalMs[pi] = dtMs;
    perf.i = pi + 1 < PERF_N ? pi + 1 : 0;
  }

  /* ---- the body on screen -------------------------------------------- */
  var shownRot = '', shownAsm = '', shownLight = '', shownShadow = '', zkNow = 1, kfHold = 1;
  function zoomK() { return zkNow; }
  /** The smallest the glass ever needs to be to turn within the screen (at its diagonal). */
  function kfMinimum(lw, lh) {
    var dg = Math.sqrt(lw * lw + lh * lh);
    return Math.min(1, window.innerWidth * 0.97 / dg, window.innerHeight * 0.97 / dg);
  }
  /** Place, turn and scale the glass on screen, once a frame. */
  function applyBody(dtMs) {
    zkNow = app.classList.contains('zen') ? 1 : Z.k0;
    measureRoom();
    var th = sim.angle, w = body.w < 0 ? -body.w : body.w, total = th + grav.base;
    var r = total ? 'rotate(' + total.toFixed(4) + 'rad)' : '';
    if (r !== shownRot) { rotor.style.transform = r; shownRot = r; }
    // pull back just enough that the turning vessel never clips the screen;
    // spinning fast, it holds its smallest size so it does not pump at 2ω
    var lw = R0.width * zkNow, lh = R0.height * zkNow, kf = 1;
    if (th) {
      var c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
      var bw = c * lw + s * lh, bh = s * lw + c * lh;
      kf = Math.min(1, window.innerWidth * 0.97 / bw, window.innerHeight * 0.97 / bh);
    }
    if (w > 3) kfHold = kfMinimum(lw, lh);
    else if (kfHold < 1) {
      kfHold += (1 - kfHold) * (1 - Math.exp(-dtMs / 250));
      if (kfHold > 0.9999) kfHold = 1;
    }
    kfNow = kf < kfHold ? kf : kfHold;
    var zx = body.px / zkNow, zy = body.py / zkNow;
    var a = (zx || zy ? 'translate(' + zx.toFixed(2) + 'px,' + zy.toFixed(2) + 'px)' : '') +
            (kfNow < 1 ? (zx || zy ? ' ' : '') + 'scale(' + kfNow.toFixed(4) + ')' : '');
    if (a !== shownAsm) { assembly.style.transform = a; shownAsm = a; }
    // room lighting does not turn with the glass: fade it through the move,
    // and the glass lifts off its shadow as it is drawn away from home
    var o = Math.max(0, 1 - Math.abs(Math.sin(th)) * 5) * (w > 3 ? 0 : 1);
    var lo = th || w > 3 ? o.toFixed(3) : '';
    if (lo !== shownLight) { lightCanvas.style.opacity = lo; shownLight = lo; }
    var pr = Math.sqrt(body.px * body.px + body.py * body.py);
    var so = th || w > 3 || pr ? (o * Math.max(0, 1 - pr / 60)).toFixed(3) : '';
    if (so !== shownShadow) { shadow.style.opacity = so; shownShadow = so; }
  }

  /* ---- the glass breaks, leaks and mends ----------------------------- */
  var DMG = P.Sim.DMG;
  var dmgSeen = 0;
  /** 'cracked' (an open crack), 'mended' (only gold seams) or 'intact'. */
  function crackState() {
    var c = sim.cracks, st = 'intact';
    for (var i = 0; i < c.length; i++) {
      if (!c[i].sealed) return 'cracked';
      st = 'mended';
    }
    return st;
  }
  function hasOpenCrack() { return crackState() === 'cracked'; }

  /**
   * What happened to the glass since the last look: creaks before a crack,
   * the crack itself, its growth, a breach, a seal. Each is heard, drawn and
   * (for the big ones) felt and saved. Events live in sim.frame until the
   * next beginFrame, so this runs before that as well as after the steps.
   */
  function drainDamage(now) {
    var f = sim.frame, n = f.dmgN, keep = false, sealed = false;
    for (var e = dmgSeen; e < n; e++) {
      var type = f.dmgType[e], k = f.dmgK[e], lv = f.dmgLevel[e], x = f.dmgX[e];
      renderer.damageEvent(type, k, lv, now);
      if (type === DMG.WARN) audio.creak(lv, x);
      else if (type === DMG.CRACK) {
        audio.crack(x);
        audio.setCracked('cracked');
        buzz([8, 40, 18]);
        if (!settings.hintMend) {
          settings.hintMend = true; save();
          toast('The glass cracked · hold it still to mend', 4200);
        }
        keep = true;
      } else if (type === DMG.GROW) audio.crackGrow(x);
      else if (type === DMG.BREACH || type === DMG.WIDEN) {
        audio.chip(x);
        if (type === DMG.BREACH) buzz(20);
        keep = true;
      } else if (type === DMG.SEAL) {
        if (!sealed) { audio.mended(); buzz([10, 60, 10]); }
        sealed = true;
        audio.setCracked('mended');
        keep = true;
      }
    }
    dmgSeen = n;
    if (keep) saveSession();
  }

  /**
   * Grains that left the glass fall into the room: from the breach, at the
   * glass's place, turn and speed on screen, onto the desk below it.
   */
  function drainEscapes() {
    var n = sim.escN;
    if (!n) return;
    var g = sim.geo, s = renderer.scale * kfNow, rho = sim.angle + grav.base;
    var c = Math.cos(rho), sn = Math.sin(rho), zk = zoomK(), w = body.w;
    var ox = 0.85 * R0.width + body.px / zk, oy = 0.5 * R0.height + body.py / zk;
    var bvx = body.vx / zk, bvy = body.vy / zk;
    for (var k = 0; k < n; k++) {
      var x0 = (sim.escX[k] - g.cx) * s, y0 = (sim.escY[k] - g.cy) * s;
      var qx = x0 * c - y0 * sn, qy = x0 * sn + y0 * c;
      var vx0 = sim.escVX[k] * s, vy0 = sim.escVY[k] * s;
      var vx = vx0 * c - vy0 * sn + bvx - w * qy;
      var vy = vx0 * sn + vy0 * c + bvy + w * qx;
      spill.add(ox + qx, oy + qy, vx, vy, sim.escS[k]);
    }
    sim.escN = 0;
  }

  /** The spilled sand: falls in the room's gravity, hops when the phone is shaken. */
  function stepSpill(dtMs) {
    if (!spill.count && !spill.active) return 0;
    var gx = 0, gy = 1;
    if (grav.on) {
      var psi = wrapPi(sim.tilt - grav.base);
      gx = Math.sin(psi); gy = Math.cos(psi);
    }
    spill.step(Math.min(dtMs, 50) / 1000, gx, gy, sim.G * renderer.scale, feltX, feltY);
    spill.draw();
    return spill.landed;
  }

  /* ---- kintsugi -------------------------------------------------------- */
  // Hold a finger still on a cracked glass: after a moment gold flows along
  // every open crack from where it started, and seals it. Lift early and
  // the gold recedes. The timer is never touched.
  var MEND_WAIT = 250, MEND_RUN = 1200, MEND_BACK = 400;
  var mend = { on: false, p: 0, p0: 0, t0: 0 };
  function endMend(instant) {
    if (mend.on) audio.mendHum(0);
    mend.on = false;
    if (instant || !(mend.p > 0)) { mend.p = 0; renderer.setMend(0); return; }
    mend.p0 = mend.p; mend.t0 = performance.now();
  }
  function updateMend(now) {
    var g = grab;
    if (g && g.mendable && g.kind === 'press') {
      var t = now - g.t;
      if (t < MEND_WAIT) return;
      if (!hasOpenCrack()) { g.mendable = false; endMend(false); return; }
      var p = (t - MEND_WAIT) / MEND_RUN;
      if (p >= 1) {
        // sealed: the gold has run the whole way
        renderer.setMend(1);
        audio.mendHum(0);
        mend.on = false; mend.p = 0;
        g.mendable = false;
        sim.sealCracks();
        drainDamage(now);
        renderer.setMend(0);
        return;
      }
      mend.on = true; mend.p = p;
      renderer.setMend(p);
      audio.mendHum(p);
    } else if (mend.on) {
      endMend(false);
    } else if (mend.p > 0) {
      mend.p = Math.max(0, mend.p0 * (1 - (now - mend.t0) / MEND_BACK));
      renderer.setMend(mend.p);
    }
  }

  /* ---- sound ----------------------------------------------------------- */
  var AU = {};                       // reused every frame: nothing new for the collector
  var leakRate = 0, landBuzzAt = -1e9;
  function feedAudio(dt, active, running, landed) {
    var f = sim.frame, kf = Math.min(1, dt * 7);
    var rel = active ? f.released / dt : 0;
    var imp = active ? (f.impSand + f.impGlass) / dt : 0;
    var sl = active ? f.slides / dt : 0;
    S.flow += (rel - S.flow) * kf;
    S.imp += (imp - S.imp) * kf;
    S.slides += (sl - S.slides) * Math.min(1, dt * 10);
    leakRate += ((active ? f.leaked / dt : 0) - leakRate) * (1 - Math.exp(-dt / 0.3));
    var bulk = running && sim.nTop > T.tailGrains;
    // the slosh moves between the ears with the fuller bulb's field
    var b = sim.nTop >= sim.nBottom ? 0 : 2, rho = sim.angle + grav.base;
    var fxp = sim.bf[b] * Math.cos(rho) - sim.bf[b + 1] * Math.sin(rho);
    var pan = -0.6 * fxp / sim.G;
    if (pan > 0.65) pan = 0.65; else if (pan < -0.65) pan = -0.65;
    AU.dt = dt;
    AU.flow = bulk ? Math.max(S.flow, T.rate * 0.5) : S.flow;
    AU.impacts = S.imp;
    AU.tail = sim.nTop >= T.tailGrains ? 1 : Math.pow(sim.nTop / T.tailGrains, 1.2);
    AU.fill = sim.nBottom / sim.capacity;
    AU.bottom = sim.nBottom;
    AU.slides = S.slides;
    AU.pouring = pour.active;
    AU.running = running;
    AU.ambient = T.state === 'running';  // a running glass keeps its ambience while being turned
    AU.flipping = flip.active;
    AU.spin = Math.abs(body.w);
    AU.angle = sim.angle;
    AU.sim = active ? sim : null;
    AU.thump = active ? f.thump : null;  // beds landing [E0, x0, E1, x1]
    AU.slam = active ? f.slam : null;    // beds slammed into the far end [E, x]
    AU.agit = sim.agitation();
    AU.rushPan = pan;
    AU.leak = leakRate;
    AU.leakPan = f.leakX;
    AU.spillPats = dt > 0 ? landed / dt : 0;
    audio.update(AU);
    // a hard landing is felt too (Android only), now and then
    if (active && (f.thump[0] > 0.3 || f.thump[2] > 0.3)) {
      var t = performance.now();
      if (t - landBuzzAt >= 250) { landBuzzAt = t; buzz(10); }
    }
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
    // Playing with the glass never brings the controls back; only the Flip
    // button's turn (which a tap on the button started) does.
    var zen = hold || zenForced || (T.state === 'running' && !sheetOpen && !pour.held &&
              !(flip.active && flip.mode === 'script') && now - lastInput > 4000);
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
    R0.width = r.width; R0.height = r.height; R0.scale = r.scale;
    R0.cx = Math.round(x) + r.width / 2; R0.cy = Math.round(y) + r.height / 2; R0.dx = dx; R0.dy = dy;
    // The desk the spilled sand lands on: the base slab's lower edge (or the
    // glass's own tip without the frame). Its canvas lives in the zoom, not
    // in the glass, so the dune stays on the desk however the glass moves.
    var g = sim.geo, q = g.q, frameOn = renderer.frame;
    var deskY = r.height / 2 + (g.HB + (frameOn ? 14 : 2) * q) * r.scale;
    var half = ((frameOn ? g.capHalf : g.R) + 30 * q) * r.scale, mid = 0.85 * r.width;
    spillCanvas.style.left = (-0.35 * r.width).toFixed(1) + 'px';
    spillCanvas.style.top = '0px';
    spill.layout(1.7 * r.width, r.height, window.devicePixelRatio || 1, deskY, mid - half, mid + half);
    applyZoom();
    applyBody(0);
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
    if (!settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} return; }
    // iOS taps only from inside the end of a touch or a click; a tap wanted
    // while the finger was down (a catch, a half turn) plays as it lifts.
    if (performance.now() < gestureUntil) iosTick(); else tickWanted = performance.now();
  }
  var gestureUntil = 0, tickWanted = 0;
  ['touchend', 'pointerup', 'click'].forEach(function (t) {
    window.addEventListener(t, function () {
      var now = performance.now();
      gestureUntil = now + 60;
      if (tickWanted && now - tickWanted < 1500) { tickWanted = 0; iosTick(); }
    }, { capture: true, passive: true });
  });
  /*
   * iPhones have no vibration API, but since iOS 18 a switch control taps the
   * Taptic Engine whenever it flips. A hidden one, flipped from inside a
   * touch, gives a light, real tap: on the catch, the flick, each half turn.
   * (It cannot fire from timers or sensors, so shaking stays silent here.)
   */
  var hapticAt = 0;
  function iosTick() {
    var now = performance.now();
    if (now - hapticAt < 35) return;
    hapticAt = now;
    try {
      var label = document.createElement('label'), input = document.createElement('input');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';
      input.type = 'checkbox'; input.setAttribute('switch', '');
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();                     // the switch flips: iOS 18+ taps the Taptic Engine
      document.head.removeChild(label);
    } catch (e) {}
  }

  var toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
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
  // closed or reloaded, the timer is restored from the wall clock, and so
  // is the glass itself: its cracks, gold seams and lost sand.
  var SKEY = 'hourglass.session.v1', lastSave = 0;
  function saveSession() {
    try {
      if (T.state === 'idle') { localStorage.removeItem(SKEY); return; }
      if (T.state === 'running') tickClock();          // the time as of now, not as of the last frame
      var s = {
        v: 1, at: Date.now(), state: T.state, rem: T.rem, durationMs: T.durationMs,
        scale: sim.geo.q, total: sim.total, top: sim.nTop,
        mpg: T.mpg, mpg0: T.mpg0, tailMs: T.tailMs, tailGrains: T.tailGrains
      };
      var dmg = sim.serializeDamage();
      if (dmg) s.damage = dmg;
      localStorage.setItem(SKEY, JSON.stringify(s));
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
    T.lastTick = Date.now();                           // the clock goes on from this moment
    if (state !== 'running' && state !== 'paused' && state !== 'done') return false;
    if (state === 'done' && away > 3600000) return false;                       // long finished: start fresh
    sim.reset(s.total);
    sim.restoreDamage(s.damage);                         // an older session has none: the glass stays whole
    T.mpg = s.mpg; T.tailMs = s.tailMs; T.tailGrains = s.tailGrains; T.rate = 1000 / T.mpg;
    T.mpg0 = s.mpg0 > 0 ? s.mpg0 : s.mpg;
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
  function onGesture() {
    audio.unlock();
    if (wakeState === 'failed') syncWakeLock();       // some browsers want a gesture
  }
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(function (t) {
    window.addEventListener(t, onGesture, { capture: true, passive: true });
  });

  /** Inside the glass's own box (as today: 4 % in from its sides, 1 % from its ends). */
  function onGlass(x, y) {
    var r = assembly.getBoundingClientRect();
    var padX = r.width * 0.04, padY = r.height * 0.01;
    return !(x < r.left + padX || x > r.right - padX || y < r.top + padY || y > r.bottom - padY);
  }
  // A press on the glass while the controls are dimmed may be play (a drag,
  // a catch, a mend): it brings them back only if it turns out to be a tap.
  // Anywhere else, a press wakes them at once.
  var pressZen = false, pressDefer = false;
  window.addEventListener('pointerdown', function (e) {
    pressZen = app.classList.contains('zen');
    pressDefer = pressZen && stage.contains(e.target) && onGlass(e.clientX, e.clientY);
    if (!pressDefer) wake();
  }, { capture: true, passive: true });

  // The glass itself. Tap it to pause / resume. Take it by the waist and
  // move it, by a bulb and turn it; flick it and it spins on; touch it
  // while it moves and it stops; hold a finger still on a cracked glass to
  // mend it. One finger: a second one is ignored.
  var grab = null;
  stage.addEventListener('pointerdown', function (e) {
    if (e.button || grab) return;
    var r = assembly.getBoundingClientRect();
    var padX = r.width * 0.04, padY = r.height * 0.01;
    var g = grab = {
      id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(),
      zen: pressZen, defer: pressDefer,
      inside: !(e.clientX < r.left + padX || e.clientX > r.right - padX ||
                e.clientY < r.top + padY || e.clientY > r.bottom - padY),
      cx: r.left + r.width / 2, cy: r.top + r.height / 2, h: r.height,   // where it is now, offset included
      kind: 'press',               // press → move | turn; none: only ever a tap
      far: 0,                      // farthest the finger has strayed (px²)
      caught: false, mendable: false,
      lx: e.clientX, ly: e.clientY,                // where the finger is now
      fx: 0, fy: 0, p0x: 0, p0y: 0, last: 0,
      pt: e.pointerType, pm: e.pressure || 0, am: (e.width || 0) * (e.height || 0)   // how hard it pressed
    };
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    if (!g.inside || sheetOpen || resetting || (flip.active && flip.mode === 'script')) { g.kind = 'none'; return; }
    if (bodyMoving()) catchBody(g, e.clientX, e.clientY);
    else g.mendable = hasOpenCrack();
  });
  stage.addEventListener('pointermove', function (e) {
    var g = grab;
    if (!g || e.pointerId !== g.id) return;
    var dx = e.clientX - g.x, dy = e.clientY - g.y, d2 = dx * dx + dy * dy;
    if (d2 > g.far) g.far = d2;
    if (e.pressure > g.pm) g.pm = e.pressure;
    if ((e.width || 0) * (e.height || 0) > g.am) g.am = e.width * e.height;
    g.lx = e.clientX; g.ly = e.clientY;
    if (g.kind === 'move') { tether(g, e.clientX, e.clientY); return; }
    if (g.kind === 'turn') { turnTo(g, e.clientX, e.clientY); return; }
    if (g.kind !== 'press') return;
    if (g.far > 100 && g.mendable) { g.mendable = false; endMend(false); }   // drifted: not a mend
    if (g.far < 256) return;                       // 16 px before the glass moves at all
    if (sheetOpen || resetting || (flip.active && flip.mode === 'script')) { g.kind = 'none'; return; }
    // engaged: the glass picks up from where the finger is now, so it never jumps
    g.mendable = false; endMend(false);
    buzz(6);
    var rx = g.x - g.cx, ry = g.y - g.cy;
    if (Math.sqrt(rx * rx + ry * ry) > g.h * BODY.zone) holdTurn(g, e.clientX, e.clientY);
    else holdMove(g, e.clientX, e.clientY);
  });
  function stageRelease(e) {
    var g = grab;
    if (!g || e.pointerId !== g.id) return;
    grab = null;
    letGo(g, e.type !== 'pointerup');
    if (e.type !== 'pointerup') return;
    // A tap: brief, still, and neither a catch nor (on a cracked glass) a mending hold.
    var dur = performance.now() - g.t;
    if (g.caught || (g.kind !== 'press' && g.kind !== 'none') || g.far > 196 || dur > 700) return;
    if (dur > MEND_WAIT && hasOpenCrack()) return;
    if (g.defer) { wake(); return; }               // dimmed: a tap only brings the controls back
    if (g.zen || g.kind !== 'press' || sheetOpen || !g.inside || flip.active) return;
    audio.tap();                       // fingertip on glass
    if (knock(g)) return;              // one of a quick burst: a knock, not a start or pause
    toggle();
  }
  /*
   * Knocking. Quick taps or clicks on the glass land harder and harder; the
   * first of a burst still starts or pauses it, the rest only knock. Where
   * the device says how hard the finger pressed (a pencil, 3D Touch) or how
   * broad its touch was, that counts too. A burst of hard knocks creaks,
   * then cracks the glass where it is struck.
   */
  var knockAt = 0, knockRun = 0, touchArea = 0;
  function knock(g) {
    var now = performance.now(), quick = now - knockAt < 450;
    knockAt = now;
    knockRun = quick ? knockRun + 1 : 0;
    var s = 0.55 + 0.17 * Math.min(knockRun, 4);
    if (g.pt === 'pen' || (g.pm > 0 && g.pm !== 0.5)) s *= 0.5 + g.pm;
    else if (g.pt === 'touch' && g.am > 1) {
      touchArea = touchArea ? touchArea + (g.am - touchArea) * 0.2 : g.am;
      var k = Math.sqrt(g.am / touchArea);
      s *= k < 0.8 ? 0.8 : (k > 1.4 ? 1.4 : k);
    }
    if (sim.angle === 0) {
      var r = $('c-sand').getBoundingClientRect();     // the lattice, upright on screen
      var lx = (g.x - r.left) / r.width * sim.W, ly = (g.y - r.top) / r.height * sim.H;
      if (grav.base) { lx = sim.W - lx; ly = sim.H - ly; }
      sim.knock(lx, ly, s);
    }
    if (quick) buzz(8);
    return quick;
  }
  stage.addEventListener('pointerup', stageRelease);
  stage.addEventListener('pointercancel', stageRelease);

  /** Take the glass by the waist: it follows the finger from where it is now. */
  function holdMove(g, x, y) {
    g.kind = 'move';
    g.lx = x; g.ly = y;
    anchorMove(g);
    held = true;
    syncMode();
  }
  /**
   * The finger takes hold from where the glass and the finger are now, so
   * the first small move of the finger never makes the glass jump.
   */
  function anchorMove(g) {
    g.fx = g.lx; g.fy = g.ly;
    g.p0x = body.px; g.p0y = body.py;
    body.tx = body.px; body.ty = body.py;
  }
  /** Take the glass by a bulb: it turns after the finger from the angle it is at now. */
  function holdTurn(g, x, y) {
    g.kind = 'turn';
    g.last = Math.atan2(y - g.cy, x - g.cx);
    flip.grabAngle = sim.angle;
    rot = 'held';
    syncMode();
  }
  /**
   * The glass was moving: it stops under the finger, with a soft felt thud.
   * The finger brakes it at once (catching) and then holds it where it
   * stopped (regrip), as a turn or a move.
   */
  function catchBody(g, x, y) {
    var rx = x - g.cx, ry = y - g.cy;
    var turning = rot === 'free' || rot === 'detent' || rot === 'ease' || body.w > 0.5 || body.w < -0.5;
    g.caught = true;
    if (turning || Math.sqrt(rx * rx + ry * ry) > g.h * BODY.zone) holdTurn(g, x, y);
    else holdMove(g, x, y);
    catching = true;
    audio.catchThud();
    buzz(10);
  }
  /**
   * Where the finger pulls the glass: one to one, wherever the finger goes.
   * The desk and the screen's edges stop the glass itself (stepBody); the
   * finger may go on past them, and how fast it drove the glass into them
   * is how hard the blow is.
   */
  function tether(g, x, y) {
    body.tx = g.p0x + x - g.fx; body.ty = g.p0y + y - g.fy;
  }
  /** The finger's angle about the glass, unwrapped, adds to where the glass is turned to. */
  function turnTo(g, x, y) {
    var dx = x - g.cx, dy = y - g.cy, ang = Math.atan2(dy, dx), d = ang - g.last;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    g.last = ang;
    // Close to the centre a finger's angle means little (a pixel of tremor
    // there is many degrees), so it counts in full only a little way out:
    // a glass caught at its waist stays put under a resting finger.
    var r = Math.sqrt(dx * dx + dy * dy), r0 = BODY.pivot * g.h;
    if (r < 2 * r0) d *= r > r0 ? (r - r0) / r0 : 0;
    flip.grabAngle += d;
  }
  /**
   * Let go. A moved glass falls to the desk from where it is (with the
   * speed the hand gave it) and is centred again; with Reduce Motion it
   * glides home. A turned one spins on if it was flung (not with Reduce
   * Motion, which keeps the old eased release), or settles on the end it
   * was heading for. `cancel`: the gesture was cut short (the page hid, the
   * screen turned), so it settles without a spin.
   */
  function letGo(g, cancel) {
    catching = false;                  // (lifted while still braking it: it carries on from here)
    if (g.kind === 'move') {
      held = false;
      body.air = !reduceMotion && (body.py < -1 || body.vy < -BODY.bounceMin);
      syncMode();
    }
    else if (g.kind === 'turn' && rot === 'held') {
      if (reduceMotion) releaseTurn();
      else if (!cancel && (body.w > BODY.wFree || body.w < -BODY.wFree)) { rot = 'free'; inertia0 = inertia(); }
      else enterDetent();
      syncMode();
    }
    if (g.mendable || mend.on) { g.mendable = false; endMend(false); }
  }
  /** A gesture cut short (the page hid, the screen turned): let go of the glass. */
  function cancelGesture() {
    var g = grab;
    if (!g) return;
    grab = null;
    try { stage.releasePointerCapture(g.id); } catch (err) {}
    letGo(g, true);
  }

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

  var THEME_ORDER = ['sahara', 'volcanic', 'moonstone', 'lapis', 'rosequartz', 'seaglass'];
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
    $('spilled').textContent = sim.lost > 0 ? ' · ' + sim.lost.toLocaleString() + ' spilled' : '';
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
  optTilt.addEventListener('click', function (e) { setMotion(e.target.checked, true); });
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
   *  Reduce Motion
   *
   *  The same glass, gentler: a drag glides home without a sway, a turn
   *  never spins on, the phone's shaking is halved and capped below what
   *  lifts the bed, nothing flashes, and the glass cannot crack.
   * ==================================================================== */
  var reduceMotion = false;
  var rmq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function setReduceMotion(on) {
    reduceMotion = !!on;
    sim.reduced = reduceMotion;
    renderer.reduced = reduceMotion;
    if (reduceMotion && rot === 'free') { enterDetent(); syncMode(); }
  }
  if (rmq) {
    var onRm = function (e) { setReduceMotion(e.matches); };
    if (rmq.addEventListener) rmq.addEventListener('change', onRm);
    else if (rmq.addListener) rmq.addListener(onRm);
  }
  setReduceMotion(!!(rmq && rmq.matches));

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
      cancelGesture();                 // a hand on the glass lets go
      saveSession();
    } else {
      lastFrame = performance.now(); acc = 0; dirty = true;
      motion.reset();                  // stale sensor history is not felt on return
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
  window.addEventListener('orientationchange', function () { cancelGesture(); setTimeout(onResize, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  window.addEventListener('load', queueLayout);

  /* ======================================================================
   *  Hidden diagnostics: ?debug=motion
   *
   *  A faint overlay of what the sensors and the sand are doing, for tuning
   *  on the device; &rec=N also records N seconds of raw sensor events and
   *  offers them as a file. Nothing of this exists without the parameter.
   * ==================================================================== */
  var dbg = null;
  if (/[?&]debug=motion(?:&|$)/.test(location.search)) {
    dbg = { el: document.createElement('div'), at: 0, frames: 0, fps: 0, rec: null };
    dbg.el.id = 'debug-motion';
    dbg.el.setAttribute('aria-hidden', 'true');
    dbg.el.style.cssText = 'position:fixed;left:6px;top:calc(env(safe-area-inset-top, 0px) + 4px);z-index:30;' +
      'font:10px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#fff;opacity:0.4;pointer-events:none;white-space:pre';
    dbg.text = document.createElement('div');
    dbg.el.appendChild(dbg.text);
    app.appendChild(dbg.el);
    var recM = /[?&]rec=(\d{1,3})(?:&|$)/.exec(location.search);
    if (recM && +recM[1] > 0) startTrace(+recM[1]);
  }
  /** Record `secs` of raw devicemotion and deviceorientation, from the first sample. */
  function startTrace(secs) {
    var r = dbg.rec = { t0: -1, done: false, motion: [], orient: [] };
    // (one clock for both sensors: event time stamps differ between engines)
    function stamp() {
      var t = performance.now();
      if (r.t0 < 0) r.t0 = t;
      if (t - r.t0 > secs * 1000) { finish(); return -1; }
      return Math.round((t - r.t0) * 10) / 10;
    }
    function v3(o, a, b, c) { return o ? [o[a], o[b], o[c]] : [null, null, null]; }
    function onM(e) {
      if (r.done) return;
      var a = v3(e.acceleration, 'x', 'y', 'z'), g = v3(e.accelerationIncludingGravity, 'x', 'y', 'z');
      if (a[0] == null && g[0] == null) return;           // a browser without sensors says so with an empty reading
      var t = stamp();
      if (t < 0) return;
      var q = v3(e.rotationRate, 'alpha', 'beta', 'gamma');
      r.motion.push([t, a[0], a[1], a[2], g[0], g[1], g[2], q[0], q[1], q[2]]);
    }
    function onO(e) {
      if (r.done || e.beta == null) return;
      var t = stamp();
      if (t >= 0) r.orient.push([t, e.beta, e.gamma]);
    }
    function finish() {
      if (r.done) return;
      r.done = true;
      window.removeEventListener('devicemotion', onM);
      window.removeEventListener('deviceorientation', onO);
      var blob = new Blob([JSON.stringify({ motion: r.motion, orient: r.orient })], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hourglass-motion-' + secs + 's.json';
      a.textContent = 'save the ' + secs + ' s trace (' + r.motion.length + ' + ' + r.orient.length + ' samples)';
      a.style.cssText = 'display:block;pointer-events:auto;color:#fff;text-decoration:underline';
      dbg.el.appendChild(a);
    }
    window.addEventListener('devicemotion', onM, { passive: true });
    window.addEventListener('deviceorientation', onO, { passive: true });
  }
  function updateDebug(now, dtMs) {
    dbg.frames++;
    if (now - dbg.at < 250) return;
    dbg.fps = dbg.frames * 1000 / (now - dbg.at || 1);
    dbg.at = now; dbg.frames = 0;
    var mag = Math.sqrt(feltX * feltX + feltY * feltY);
    dbg.text.textContent =
      'σ ' + (motion.sign > 0 ? '+1' : (motion.sign < 0 ? '−1' : '?')) +
      '  live ' + (motion.live ? 1 : 0) +
      '  |felt| ' + mag.toFixed(2) + ' g' +
      '  rms ' + (+motion.rms || 0).toFixed(2) + (motion.armed ? ' armed' : '') + '\n' +
      'T ' + sim.agit[0].toFixed(2) + ' / ' + sim.agit[1].toFixed(2) +
      '  dMax ' + sim.dMax.toFixed(3) +
      '  q ' + sim.quality +
      '  ' + dbg.fps.toFixed(0) + ' fps';
    if (dbg.rec && !dbg.rec.done && dbg.rec.t0 >= 0) dbg.text.textContent += '\nrecording…';
  }

  /* ======================================================================
   *  Boot
   * ==================================================================== */
  sim.reset(grainsFor(T.durationMs));
  calibrate();
  T.rem = T.durationMs;
  var restored = restoreSession();                     // pick up where the glass was left
  audio.setCracked(crackState());                      // a cracked glass rings dull from the start
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
  if (settings.tilt) setMotion(true, false);
  showTime(T.rem);
  requestAnimationFrame(function (t) {
    // (the clock keeps the time since setState above: a restored glass loses none of it)
    lastFrame = t; requestAnimationFrame(frame);
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
    topAt: topAt, remAt: remAt, grainsFor: grainsFor,
    wakeState: function () { return wakeState; }, grav: grav,
    motion: motion, body: body, room: room, spill: spill, perf: perf,
    retime: function () { return maybeRetime(performance.now(), true); },
    debug: {
      /** Crack the glass at wall segment `seg` (sim.forceCrack), and let the app hear and see it at once. */
      forceCrack: function (seg, L, w) {
        var cr = sim.forceCrack(seg, L, w);
        drainDamage(performance.now());
        dirty = true;
        return cr;
      }
    }
  };
  Object.defineProperty(window.Hourglass, 'reduceMotion', {
    get: function () { return reduceMotion; }, enumerable: true
  });
  Object.defineProperty(window.Hourglass.debug, 'mpg0', {
    get: function () { return T.mpg0; }, enumerable: true
  });
  // whether this frame counts the glass as just shaken (no catch-up teleports then)
  Object.defineProperty(window.Hourglass.debug, 'motionRecent', {
    get: function () { return motionRecentNow; }, enumerable: true
  });
})();
