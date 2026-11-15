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
  var rotor = $('rotor'), shadow = $('shadow'), lightCanvas = $('c-light');
  var hudTop = $('hud-top'), hudBottom = $('hud-bottom');
  var tMain = $('t-main'), tFrac = $('t-frac'), statusEl = $('status');
  var btnPlay = $('btn-play'), btnFlip = $('btn-flip'), btnSand = $('btn-sand');
  var btnReset = $('btn-reset'), btnSettings = $('btn-settings');
  var btnMute = $('btn-mute'), btnTheme = $('btn-theme'), themeName = $('theme-name');
  var durations = $('durations'), pillCustom = $('pill-custom'), customLabel = $('custom-label');
  var scrim = $('scrim'), sheetSettings = $('sheet-settings'), sheetCustom = $('sheet-custom');
  var toastEl = $('toast');

  /* ======================================================================
   *  Settings (persisted)
   * ==================================================================== */
  var KEY = 'hourglass.settings.v1';
  var settings = {
    theme: 'sahara', character: 'asmr', volume: 0.8, muted: false,
    chime: true, tilt: false, zenFull: false, haptics: true,
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
    back: $('c-back'), sand: $('c-sand'), front: $('c-front'), light: lightCanvas
  });
  var audio = new window.HourglassAudio();
  audio.volume = settings.volume;
  audio.muted = settings.muted;
  audio.character = settings.character;
  audio.chimeEnabled = settings.chime;

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
  var T = {
    state: 'idle',                   // idle | running | paused | done
    durationMs: settings.durationMs,
    rem: settings.durationMs,
    mpg: 1,                          // ms per grain in the bulk phase
    rate: 0,                         // grains per second in the bulk phase
    tailMs: 1000,
    tailGrains: 30,
    lastTick: performance.now()
  };

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

  /** Advance the wall clock. Called from rAF and from a background timer. */
  function tickClock(now) {
    var d = now - T.lastTick;
    T.lastTick = now;
    if (d <= 0 || T.state !== 'running' || flip.active) return;
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
  var L = { width: 0, height: 0 };              // current layout (CSS px)

  function setState(s) {
    T.state = s;
    app.dataset.state = s;
    statusEl.textContent = flip.active ? STATUS.turning : STATUS[s];
    btnPlay.setAttribute('aria-label', s === 'running' ? 'Pause' : (s === 'done' ? 'Flip and start again' : 'Start'));
    if (s === 'running') { T.lastTick = performance.now(); lastInput = T.lastTick; requestWakeLock(); }
    else releaseWakeLock();
    sim.quiet = 0;
    dirty = true;
  }

  function start() {
    if (resetting || flip.active) return;
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
    setState('done');
    audio.chime(0.75);               // after the last grain has landed
    buzz([16, 110, 16, 110, 42]);
    wake();
  }

  /* ---- reset / duration -------------------------------------------- */
  function reset(keepRunning) {
    if (resetting) return;
    resetting = true;
    audio.hush();
    app.classList.add('swap');       // cross-fade the sand
    setTimeout(function () {
      if (flip.active) { flip.active = false; applyFlip(0); }
      sim.reset(sim.defaultGrains);
      calibrate();
      T.rem = T.durationMs;
      S.flow = S.imp = S.slides = 0;
      resetting = false;
      setState(keepRunning ? 'running' : 'idle');
      app.classList.remove('swap');
    }, 180);
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
   *  Flip — the vessel turns 180° and gravity turns with it
   * ==================================================================== */
  var flip = { active: false, t0: 0, dur: 1550, was: 'idle', remFrom: 0, remTo: 0, shown: 0, auto: false };

  function startFlip(autoRun) {
    if (flip.active || resetting) return;
    flip.active = true;
    flip.t0 = performance.now();
    flip.was = T.state;
    flip.auto = !!autoRun;
    flip.remFrom = T.rem;
    // elapsed ⇄ remaining: what was below will be above
    flip.remTo = remAt(sim.total - sim.nTop);
    flip.shown = T.rem;
    sim.flipping = true;
    sim.quiet = 0;
    statusEl.textContent = STATUS.turning;
    audio.flipStart();
    buzz(14);
  }

  function stepFlip(now) {
    var p = (now - flip.t0) / flip.dur;
    if (p >= 1) {
      sim.completeFlip();
      flip.active = false;
      applyFlip(0);
      T.rem = flip.remTo;
      T.lastTick = now;
      audio.flipEnd();
      buzz(22);
      var next;
      if (T.rem <= 0) next = 'done';
      else if (flip.auto || flip.was === 'running' || flip.was === 'done') next = 'running';
      else next = 'paused';
      setState(next);
      return;
    }
    var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // easeInOutCubic
    sim.angle = Math.PI * e;
    flip.shown = flip.remFrom + (flip.remTo - flip.remFrom) * e;
    applyFlip(sim.angle);
  }

  function applyFlip(theta) {
    if (!theta) {
      rotor.style.transform = '';
      assembly.style.transform = '';
      lightCanvas.style.opacity = '';
      shadow.style.opacity = '';
      return;
    }
    rotor.style.transform = 'rotate(' + theta.toFixed(4) + 'rad)';
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
   *  Tilt (optional, subtle)
   * ==================================================================== */
  var MAX_TILT = 16 * RAD, tiltTarget = 0;

  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    var o = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle : (window.orientation || 0);
    if (o) { tiltTarget = 0; return; }                    // portrait only
    var b = e.beta * RAD, g = e.gamma * RAD;
    // gravity projected onto the screen plane (x → right, y → down)
    var gx = Math.cos(b) * Math.sin(g), gy = Math.sin(b);
    var m = Math.sqrt(gx * gx + gy * gy);
    if (m < 0.25 || gy <= 0) { tiltTarget = 0; return; }  // lying flat / inverted
    var phi = Math.atan2(gx, gy) * 0.7 * Math.min(1, (m - 0.25) / 0.25);
    tiltTarget = Math.max(-MAX_TILT, Math.min(MAX_TILT, phi));
  }

  function setTilt(on, fromUser) {
    var D = window.DeviceOrientationEvent;
    var opt = $('opt-tilt');
    function off(msg) {
      window.removeEventListener('deviceorientation', onOrient);
      tiltTarget = 0; settings.tilt = false; opt.checked = false; save();
      if (msg) toast(msg);
    }
    if (!on) { off(); return; }
    if (!D) { off(fromUser ? 'Tilt is not available on this device' : ''); return; }
    function go() {
      window.addEventListener('deviceorientation', onOrient);
      settings.tilt = true; opt.checked = true; save();
    }
    if (typeof D.requestPermission === 'function') {
      // iOS 13+: must be asked from inside a user gesture
      if (!fromUser) { opt.checked = false; return; }
      D.requestPermission().then(function (r) {
        if (r === 'granted') go(); else off('Motion access was declined');
      }).catch(function () { off('Motion access is unavailable'); });
    } else go();
  }

  /* ======================================================================
   *  Frame loop
   * ==================================================================== */
  function frame(now) {
    requestAnimationFrame(frame);
    var dtMs = now - lastFrame;
    lastFrame = now;
    if (dtMs <= 0) return;

    tickClock(now);
    if (flip.active) stepFlip(now);
    handlePour(now, dtMs);

    var dTilt = tiltTarget - sim.tilt;
    if (dTilt > 0.0006 || dTilt < -0.0006) { sim.tilt += dTilt * 0.12; sim.wakeAll(); }
    else if (!tiltTarget && sim.tilt) { sim.tilt = 0; sim.wakeAll(); }

    var running = T.state === 'running' && !flip.active;
    var draining = T.state === 'done' && sim.nTop > 0 && !flip.active;

    // how many grains the clock says should still be above the neck
    var target = sim.nTop;
    if (running) {
      var ideal = topAt(T.rem);
      if (T.rem > T.tailMs + 1200) {
        // organic micro-fluctuation of the flow (zero-mean, vanishes at the end)
        var a = Math.min(5, T.rate * 0.03), ts = now / 1000;
        ideal += a * (0.6 * Math.sin(ts * 5.2) + 0.4 * Math.sin(ts * 14.4 + 1.3));
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
        if (owed > Math.max(400, T.rate * 1.2)) sim.fastForward(owed - 30);
      }
      acc += Math.min(dtMs, 100);
      var n = 0;
      while (acc >= STEP_MS && n < MAX_STEPS) { sim.step(); acc -= STEP_MS; n++; }
      if (n === MAX_STEPS) acc = 0;
      renderer.drawSand();
      dirty = false;
    }

    feedAudio(dtMs / 1000, active, running);
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
      flipping: flip.active,
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
    if (f[1] !== shownFrac) { shownFrac = f[1]; tFrac.textContent = f[1]; }
    var title = T.state === 'running' ? f[0] + ' · Hourglass'
              : (T.state === 'done' ? 'Time · Hourglass' : 'Hourglass');
    if (title !== shownTitle) { shownTitle = title; document.title = title; }
  }

  /* ======================================================================
   *  Zen HUD
   * ==================================================================== */
  function wake() {
    lastInput = performance.now();
    if (app.classList.contains('zen')) app.classList.remove('zen');
  }
  function updateZen(now) {
    var zen = T.state === 'running' && !sheetOpen && !pour.held && !flip.active &&
              now - lastInput > 4000;
    if (zen !== app.classList.contains('zen')) app.classList.toggle('zen', zen);
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
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = 0, right = vw, top, bottom;
    if (vw > vh && vh < 520) {
      // landscape phone: readout left, controls right, glass between them
      top = 6; bottom = vh - 6;
      left = hudTop.getBoundingClientRect().right;
      right = hudBottom.getBoundingClientRect().left;
      if (right - left < 120) { left = 0; right = vw; }
    } else {
      top = hudTop.getBoundingClientRect().bottom + 6;
      bottom = hudBottom.querySelector('.panel').getBoundingClientRect().top - 12;
    }
    var g = sim.geo;
    var availW = Math.max(60, right - left - 20);
    var availH = Math.max(120, bottom - top);
    // never let a grain grow past ~2 CSS px: it stops reading as sand
    availH = Math.min(availH, g.AH * 2.05);
    var r = renderer.layout(availW, availH, window.devicePixelRatio || 1);
    L.width = r.width; L.height = r.height;
    var x = left + (right - left - r.width) / 2;
    var y = top + (bottom - top - r.height) / 2;
    assembly.style.width = r.width + 'px';
    assembly.style.height = r.height + 'px';
    assembly.style.left = Math.round(x) + 'px';
    assembly.style.top = Math.round(y) + 'px';
    shadow.style.left = (x - r.width * 0.06) + 'px';
    shadow.style.width = (r.width * 1.12) + 'px';
    shadow.style.top = (y + r.height * 0.955) + 'px';
    shadow.style.height = (r.height * 0.075) + 'px';
    if (flip.active) applyFlip(sim.angle);
    dirty = true;
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

  var wakeLock = null;
  function requestWakeLock() {
    if (!navigator.wakeLock || wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (wl) {
      wakeLock = wl;
      wl.addEventListener('release', function () { if (wakeLock === wl) wakeLock = null; });
      if (T.state !== 'running') releaseWakeLock();
    }).catch(function () {});
  }
  function releaseWakeLock() {
    if (!wakeLock) return;
    var wl = wakeLock; wakeLock = null;
    try { wl.release().catch(function () {}); } catch (e) {}
  }

  /* ======================================================================
   *  Input
   * ==================================================================== */

  // Every gesture: unlock audio (iOS) and wake the HUD.
  var wokeFromZen = false;
  function onGesture() { audio.unlock(); }
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(function (t) {
    window.addEventListener(t, onGesture, { capture: true, passive: true });
  });
  window.addEventListener('pointerdown', function () {
    wokeFromZen = app.classList.contains('zen');
    wake();
  }, { capture: true, passive: true });

  // Tap the glass: pause / resume. (A tap that only woke the HUD does nothing else.)
  var down = null;
  stage.addEventListener('pointerdown', function (e) {
    if (e.button) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), zen: wokeFromZen };
  });
  stage.addEventListener('pointerup', function (e) {
    var d = down; down = null;
    if (!d || d.zen || sheetOpen) return;
    var dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (dx * dx + dy * dy > 196 || performance.now() - d.t > 700) return;
    var r = assembly.getBoundingClientRect();
    var padX = r.width * 0.04, padY = r.height * 0.01;
    if (e.clientX < r.left + padX || e.clientX > r.right - padX ||
        e.clientY < r.top + padY || e.clientY > r.bottom - padY) return;
    toggle();
  });
  stage.addEventListener('pointercancel', function () { down = null; });

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
  function pourEnd() { pour.held = false; btnSand.classList.remove('held'); }
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

  var THEME_ORDER = ['sahara', 'volcanic', 'moonstone'];
  function setTheme(id) {
    settings.theme = id; save();
    document.documentElement.dataset.theme = id;
    themeName.textContent = P.THEMES[id].short;
    renderer.setTheme(id);
    dirty = true;
    var cards = document.querySelectorAll('#themes .card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].setAttribute('aria-checked', cards[i].dataset.themeId === id ? 'true' : 'false');
    }
  }
  btnTheme.addEventListener('click', function () {
    setTheme(THEME_ORDER[(THEME_ORDER.indexOf(settings.theme) + 1) % THEME_ORDER.length]);
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
    pillCustom.setAttribute('aria-checked', hit ? 'false' : 'true');
    customLabel.textContent = hit ? 'mm:ss' : fmt(T.durationMs)[0];
  }
  durations.addEventListener('click', function (e) {
    var pill = e.target.closest('.pill');
    if (!pill) return;
    buzz(8);
    if (pill === pillCustom) { openCustom(); return; }
    setDuration(+pill.dataset.min * 60000);
  });

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
    if (instant) done(); else setTimeout(done, 430);
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
    if (c) { setTheme(c.dataset.themeId); buzz(8); }
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
  $('opt-tilt').addEventListener('change', function (e) { setTilt(e.target.checked, true); });
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
  function openCustom() {
    openSheet(sheetCustom, pillCustom);
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
      audio.hush();
    }
  }
  document.addEventListener('visibilitychange', function () {
    var now = performance.now();
    tickClock(now);
    if (document.hidden) {
      backgroundHold();
      pourEnd();
    } else {
      lastFrame = now; acc = 0; dirty = true;
      if (T.state === 'running') requestWakeLock();
    }
  });
  // rAF sleeps in a hidden tab; the clock (and the completion bowl) must not.
  setInterval(function () {
    if (!document.hidden) return;
    tickClock(performance.now());
    backgroundHold();
  }, 400);

  window.addEventListener('resize', queueLayout);
  window.addEventListener('orientationchange', function () { setTimeout(queueLayout, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueLayout);
  window.addEventListener('load', queueLayout);

  /* ======================================================================
   *  Boot
   * ==================================================================== */
  calibrate();
  T.rem = T.durationMs;
  app.classList.toggle('zen-full', settings.zenFull);
  $('opt-chime').checked = settings.chime;
  $('opt-zen').checked = settings.zenFull;
  $('opt-haptics').checked = settings.haptics;
  showVolume();
  setMuted(settings.muted);
  setCharacter(settings.character);
  syncPills();
  layout();
  setTheme(settings.theme);
  setState('idle');
  if (settings.tilt) setTilt(true, false);
  showTime(T.rem);
  requestAnimationFrame(function (t) { lastFrame = t; T.lastTick = t; requestAnimationFrame(frame); });

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
    topAt: topAt, remAt: remAt
  };
})();
