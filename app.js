/*!
 * Hourglass — app.js
 * ---------------------------------------------------------------------------
 * Conducts the physics, renderer, audio engine and motion sensors; owns the
 * wall-clock timer, the glass as a body you can move, turn and spin, the
 * controls, the Zen HUD, settings, real motion, wake-lock and PWA
 * registration.
 * License: GPL-3.0-or-later.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ======================================================================
   *  Pre-flight
   *
   *  The page's files come from one release (sw.js: an installed copy is a
   *  snapshot). Should one be missing from the copy all the same, an
   *  offline launch gets an error for it and its engine is not there: then
   *  nothing is built, the page says so, and the next launch with a
   *  connection fills the copy again.
   * ==================================================================== */
  var missing = missingParts();
  if (missing.length) { updating(missing); return; }

  /** The engines and the settings store this script needs from the other scripts, by name: [] when all are there. */
  function missingParts() {
    var w = window, P0 = w.HourglassPhysics || {}, out = [];
    ['Sim', 'Renderer', 'Spill'].forEach(function (k) {
      if (typeof P0[k] !== 'function') out.push('HourglassPhysics.' + k);
    });
    if (typeof w.HourglassAudio !== 'function') out.push('HourglassAudio');
    if (typeof w.HourglassMotion !== 'function') out.push('HourglassMotion');
    if (!w.HourglassSettings || typeof w.HourglassSettings.load !== 'function') out.push('HourglassSettings');
    return out;
  }
  /** Say that the app is updating, over the whole page (it touches nothing of the page's own). */
  function updating(what) {
    try {
      var note = document.createElement('p');
      note.id = 'updating';
      note.setAttribute('role', 'alert');
      note.textContent = 'Hourglass is updating. Open it again with a connection.';
      note.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;margin:0;padding:24px;' +
        'display:flex;align-items:center;justify-content:center;text-align:center;background:#0b0c0e;' +
        'color:#d8d2c8;font:16px/1.5 -apple-system,system-ui,sans-serif';
      (document.body || document.documentElement).appendChild(note);
    } catch (e) { /* nothing more to do */ }
    try { console.warn('Hourglass: not started; missing ' + what.join(', ')); } catch (e) {}
  }

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
   *
   *  The settings store (app/settings.js) has a record for every saved key
   *  and loads them: the saved values, the version step, the checks and the
   *  repairs. This script reads and writes `settings`, and calls save()
   *  after a change.
   * ==================================================================== */
  var Store = window.HourglassSettings;
  // (localStorage is reached inside the store's own try: where storage is blocked, reaching it throws)
  var settings = Store.load(function () { return localStorage; }, location.search, { themes: P.THEMES, shapes: P.SHAPES });
  // "./?t=300" (seconds) preselects a duration — used by the app shortcuts (a saved session gives way to it)
  var qt = Store.preset(location.search);
  function save() { Store.save(settings); }

  /* ======================================================================
   *  Engines
   * ==================================================================== */
  // More grains where there is room (and horsepower) to show them.
  var roomy = Math.min(window.innerWidth, window.innerHeight) >= 700;
  // Finer sand (Tune): the same glass at √2 or 2 times the scale, so twice or
  // four times the grains, each smaller. The simulation keeps pace, so the
  // finer sand moves on screen as the classic sand does (Sim.setPace), and
  // what is counted in grains here is scaled by fine2: the pour, what the
  // ear and the desk are given, the last grains of the tail.
  var fine = P.Sim.setPace ? [1, Math.SQRT2, 2][settings.grain] : 1, fine2 = fine * fine;
  if (fine > 1) P.Sim.setPace(fine);
  var sim = new P.Sim(simOptions((roomy ? 1.3 : 1.08) * fine, (Date.now() & 0x7fffffff) | 1));
  /**
   * The Sim's options: the glass's size and seed, and its shape (Tune's Glass tab). The classic
   * glass is asked for as it always was, with no shape named. A shape the sand cannot use at
   * this size and grain (P.checkShape) is not built: the classic glass is, and the setting is
   * left as it is, so that the shape comes back where it fits.
   */
  function simOptions(scale, seed) {
    var o = { scale: scale, seed: seed }, id = settings.shape;
    if (id !== 'classic' && P.SHAPES && P.SHAPES[id] && !(P.checkShape && P.checkShape(id, scale, fine).length)) o.shape = id;
    return o;
  }
  // Real sand (Tune, on by default; see "Real sand" below): while it runs, `sim` is the GPU sand
  // (`real`), which has the CPU Sim's members; the CPU Sim stays alive as the glass's model and the
  // fallback. With the switch off, or where it cannot run, `real` stays null and the CPU Sim is the
  // classic sand; with the switch off nothing of it is loaded.
  var cpuSim = sim, real = null;
  var renderer = new P.Renderer(sim, {
    back: $('c-back'), sand: $('c-sand'), bloom: $('c-bloom'), front: $('c-front'), light: lightCanvas,
    glBack: $('c-glass-back'), glFront: $('c-glass-front')
  });
  renderer.setFrame(settings.frame);
  sim.setLayers(settings.layers);    // (before the glass is filled: the fill is laid in bands)
  renderer.setLayers(settings.layers);
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
   * How much sand a glass of this length holds: the amount shows the time.
   * An hour (and anything longer) is the full glass, FULL of what a bulb
   * holds; a shorter glass holds less by the square root of its time, so four
   * times the time is twice the sand (a tenth of a bulb for a minute, a good
   * fifth for five, a third for ten, over half for thirty). The neck's flow
   * rate makes up the rest: a short glass still runs with a livelier thread.
   * A shape that fits less than FULL under its neck says so (sim.fillMax),
   * and that is then its full glass.
   */
  var FULL = 0.78, FULL_MS = 3600000;
  function grainsFor(ms) {
    var f = Math.min(FULL, sim.fillMax || FULL) * Math.sqrt(Math.min(1, ms / FULL_MS));
    return Math.round(sim.capacity * Math.max(0.02, f));
  }

  /** The id of the glass's shape ('classic' for the teardrop). */
  function glassShape() { return sim.geo.shape ? sim.geo.shape.id : 'classic'; }

  /** Time the neck so that N grains last d ms (by default: the whole glass, its whole length). */
  function calibrate(d, N) {
    d = d || T.durationMs;
    N = Math.max(8, N === undefined ? sim.total : N);
    T.tailMs = Math.min(2600, Math.max(500, d * 0.04));
    var rate = N / (d / 1000);
    T.tailGrains = Math.max(3, Math.min(Math.round(30 * fine2), Math.floor(rate * T.tailMs / 1000 / TAIL_P)));
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
    if (d <= 0 || T.state !== 'running' || sweep) return;   // (one glass giving way to the next: no time passes)
    // between two phases of a sequence the glass is turning itself over: unwatched (hidden, or back from
    // a sleep with the turn long due), the clock goes on without it
    if (seq.gap) {
      if (document.hidden || (back && now - seq.gap > SEQ_SETTLE + SEQ_TURN + 1500)) phaseEnd(now - seq.gap);
      return;
    }
    // on its side (real motion) the neck cannot flow, so time stands still too
    if (flip.active || (grav.on && sim.gy < 0.7)) return;
    T.rem -= d;
    if (T.rem <= 0) {
      if (seq.rest && seq.phase < 2 * seq.rounds - 1) phaseEnd(-T.rem);
      else { T.rem = 0; finish(); }
    }
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
  var sheetOpen = null, sheetOpener = null;
  var dirty = true, acc = 0, lastFrame = performance.now();
  var resetting = false;
  var S = { flow: 0, imp: 0, slides: 0 };       // smoothed physics → audio
  // real motion: where the device says down is, and whether the glass is held the other way up
  var grav = { on: false, target: 0, base: 0, seen: false };
  // the instrument's layout box (zoom-local CSS px); its centre on the page with the
  // controls dimmed (cx, cy), and how far the controls' return moves it (dx, dy)
  var R0 = { width: 0, height: 0, scale: 1, cx: 0, cy: 0, dx: 0, dy: 0 };

  function setState(s) {
    var was = T.state;
    T.state = s;
    app.dataset.state = s;
    statusEl.textContent = flip.active ? STATUS.turning : statusFor(s);
    btnPlay.setAttribute('aria-label', s === 'running' ? 'Pause' : (s === 'done' ? 'Flip and start again' : 'Start'));
    if (s === 'running') {
      if (was !== 'running') T.lastTick = Date.now();   // (a glass that was running keeps its time)
    }
    syncWakeLock();
    saveSession();
    breathSync();
    sim.quiet = 0;
    dirty = true;
  }

  var pendingStart = false;
  function start() {
    if (resetting) { pendingStart = true; return; }     // mid cross-fade: start as soon as it lands
    if (seq.gap) { seq.gap = Date.now(); setState('running'); return; }   // paused between two phases: on with the turn
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
    if (seq.rest) seq.phase = 2 * seq.rounds;   // a sequence is over: turned again, it starts from its first glass
    endWall = Date.now();            // before setState: the wake lock covers the ending
    setState('done');
    audio.chime(0.75);               // after the last grain has landed
    audio.end(0.75);                 // the stream flows on to the bowl, then recedes under it
    buzz([16, 110, 16, 110, 42]);
    setTimeout(syncWakeLock, END_AWAKE + 100);
  }

  /* ---- reset / duration -------------------------------------------- */
  // A new glass (Reset, another duration). The old sand is drawn into the
  // neck, the glass is made new, and the new sand is poured in from the top:
  // about a second in all (renderer.setSweep draws it; the sand itself changes
  // once, in between). Cracks, gold and spilled sand go with the old sand. The
  // clock stands still meanwhile, and a glass that is to run starts as the
  // last of its sand lands. With Reduce Motion, or unseen, it is a cross-fade.
  var SWEEP_OUT = 380, SWEEP_IN = 620;                  // ms: the old sand goes, the new comes
  var sweep = null;                                     // { phase: 1 | 2, t0, keep }
  function reset(keepRunning) {
    if (resetting) {
      // another duration, chosen while the sand of the last was being poured: that one next
      if (sweep && sweep.phase === 2 && T.durationMs !== sweep.ms) { sweep.redo = true; sweep.keep = !!keepRunning; }
      return;
    }
    resetting = true;
    pendingStart = false;
    audio.hush();
    if (reduceMotion || document.hidden) {
      app.classList.add('swap');     // cross-fade the sand (and any that spilled)
      setTimeout(function () {
        newGlass();
        resetting = false;
        setState(keepRunning || pendingStart ? 'running' : 'idle');
        pendingStart = false;
        app.classList.remove('swap');
      }, 460);
      return;
    }
    app.classList.add('sweep');      // (what spilled fades with the old sand; the glow steps aside)
    sweep = { phase: 1, t0: performance.now(), keep: !!keepRunning };
    dirty = true;
  }
  /** The glass made new, for the duration that is set: whole, upright, full, its clock wound. */
  function newGlass() {
    var was = crackState();
    if (flip.active) { flip.active = false; flip.dragging = false; }
    if (grab) grab.kind = 'none';    // a finger still down no longer holds the glass
    bodyHome();
    grav.base = 0;
    endMend(true);
    spill.clear();
    sim.reset(grainsFor(T.durationMs));
    sim.tilt = 0;
    seq.phase = 0; seq.gap = 0;      // a sequence starts over, from its first glass
    app.classList.remove('pass');
    calibrate();
    T.rem = T.durationMs;
    S.flow = S.imp = S.slides = 0;
    leakRate = 0;
    audio.setCracked('intact');
    if (was !== 'intact') audio.newGlass();
    applyBody(0);
  }
  /** One frame of the sweep (from frame()). */
  function stepSweep(now) {
    var p = (now - sweep.t0) / (sweep.phase === 1 ? SWEEP_OUT : SWEEP_IN);
    dirty = true;
    if (sweep.phase === 1) {
      if (p < 1) { renderer.setSweep(1, p); if (real) real.setSweep(1, p); return; }
      sweepTurn();
      sweep.t0 = now; p = 0;
    }
    if (p < 1) { renderer.setSweep(2, p); if (real) real.setSweep(2, p); sweep.pour = p > 0.06 && p < 0.84; return; }
    sweepDone();
  }
  /** Between the two halves: the glass is made new. */
  function sweepTurn() {
    newGlass();
    setState(sweep.keep ? 'running' : 'idle');          // (it does not run yet: see frame() and tickClock())
    sweep.phase = 2; sweep.ms = T.durationMs; sweep.redo = false;
  }
  function sweepDone() {
    var redo = sweep.redo, keep = sweep.keep;
    renderer.setSweep(0, 0);
    if (real) real.setSweep(0, 0);
    sweep = null;
    app.classList.remove('sweep');
    resetting = false;
    dirty = true;
    if (redo) { reset(keep || pendingStart); return; }
    if (pendingStart && T.state !== 'running') setState('running');
    pendingStart = false;
    T.lastTick = Date.now();                            // the clock starts as the last of the sand lands
  }
  /** The page is hidden: nobody sees a sweep, and the clock must go on. Finish it at once. */
  function endSweep() {
    if (!sweep) return;
    if (sweep.phase === 1 || sweep.redo) sweepTurn();
    sweepDone();
  }

  /** A new glass of `ms`. Followed by a rest (ms) it is a sequence of `rounds`; a plain duration ends one. */
  function setDuration(ms, rest, rounds) {
    ms = Math.max(10000, Math.min(5999000, Math.round(ms / 1000) * 1000));
    T.durationMs = ms;
    settings.durationMs = ms;
    seq.rest = settings.restMs = rest > 0 ? Math.max(10000, Math.min(3600000, Math.round(rest / 1000) * 1000)) : 0;
    seq.rounds = settings.rounds = seq.rest ? Math.max(1, Math.min(12, rounds | 0)) : 1;
    save();
    syncPills();
    reset(T.state === 'running');
  }

  /* ======================================================================
   *  Work and rest
   *
   *  A custom glass may be followed by a rest, and the pair repeated: a
   *  sequence of rounds × (work, then rest). Every phase is the same sand,
   *  timed to its own length. When one runs out a soft bowl sounds, the
   *  glass turns itself over with the Flip button's unhurried half turn,
   *  and the next begins as the turn ends; the last ends as any glass does.
   *  The wall clock stays the master: with nobody watching (the page hidden,
   *  the phone asleep) no turn is drawn, and the sequence is simply put
   *  where the clock says it is, each turn that passed counted at its length.
   * ==================================================================== */
  var SEQ_BOWL = 750;                // ms after a phase ran out: its last grain has landed, the soft bowl sounds
  var SEQ_SETTLE = 1200;             // ms: ... and as it blooms the glass begins to turn
  var SEQ_TURN = 2600;               // ms: the turn itself (the Flip button's)
  var seq = {
    rest: settings.restMs,           // ms of rest after each glass (0: no sequence)
    rounds: settings.rounds,
    phase: 0,                        // 0 work, 1 rest, 2 work, …; 2 × rounds once the last has ended
    gap: 0                           // between two phases: when (Date.now()) the one before ran out
  };

  /** How long phase i lasts: work on the even ones, rest on the odd. */
  function phaseMs(i) { return (i & 1) ? seq.rest : T.durationMs; }
  /** "Work" or "Rest", and which round when there is more than one. */
  function phaseName() {
    var i = Math.min(seq.phase, 2 * seq.rounds - 1);
    return ((i & 1) ? 'Rest' : 'Work') + (seq.rounds > 1 ? ' · ' + ((i >> 1) + 1) + ' of ' + seq.rounds : '');
  }
  /** The status line: in a sequence it names the phase, quietly. */
  function statusFor(s) {
    if (!seq.rest || (s !== 'running' && s !== 'paused')) return STATUS[s];
    return phaseName() + (s === 'paused' ? ' · paused' : '');
  }
  /** Phase i begins: the sand above the neck is timed to last exactly its length. */
  function beginPhase(i) {
    seq.phase = i; seq.gap = 0;
    app.classList.remove('pass');
    calibrate(phaseMs(i), sim.nTop);
    T.rem = phaseMs(i);
    T.lastTick = Date.now();         // its time runs from this moment
  }

  /**
   * A phase that is not the last ran out, `over` ms ago. Watched: a soft bowl
   * as the last grain lands, then the glass turns itself over (seqTurn).
   * Unwatched: straight to where the clock says the sequence is by now, with
   * at most one bowl, for a turn that has only just passed.
   */
  function phaseEnd(over) {
    T.rem = 0;
    if (!seq.gap && !back && !document.hidden) {
      seq.gap = Date.now() - over;
      audio.chime(Math.max(0, SEQ_BOWL - over) / 1000, true);
      saveSession();
      return;
    }
    var rung = seq.gap > 0;          // this phase end was seen as it happened: its bowl has been asked for
    var at = seqAt(seq.phase, over);
    if (flip.active) { flip.active = false; flip.dragging = false; }   // a turn under way is dropped, as Reset drops one
    if (grab) grab.kind = 'none';
    bodyHome();
    turnedUnseen(at[2]);
    beginPhase(at[0]);
    T.rem -= at[1];
    applyBody(0);
    if (T.rem <= 0) { T.rem = 0; finish(); return; }
    if (at[1] < 10000 && !(rung && at[2] === 1)) audio.chime(0, true);
    setState('running');
  }
  /**
   * Where the wall clock puts a sequence `over` ms after phase i ran out with
   * nobody watching: [the phase, ms into it, turns made]. Each turn takes its
   * usual time (one it would still be in the middle of is cut short). Past the
   * end of the last phase, the ms run on beyond it.
   */
  function seqAt(i, over) {
    var last = 2 * seq.rounds - 1, turns = 0, d;
    for (;;) {
      over = Math.max(0, over - SEQ_SETTLE - SEQ_TURN);
      d = phaseMs(++i); turns++;
      if (over < d || i === last) return [i, over, turns];
      over -= d;
    }
  }
  /**
   * The glass was turned over `turns` times unseen, all its sand run through
   * each time: the sand rests in the upper bulb again, and whatever belongs
   * to the glass (its cracks and gold) has turned with it.
   */
  function turnedUnseen(turns) {
    if (turns & 1) sim.completeFlip();
    var dmg = sim.serializeDamage();
    sim.reset(sim.total);
    sim.restoreDamage(dmg);
  }
  /** Between two phases, once a frame: the last grain lands, the bowl sounds, then the glass turns itself over. */
  function seqTurn() {
    if (flip.active || resetting) return;
    var t = T.state === 'running' ? Date.now() - seq.gap - SEQ_SETTLE : -1;     // (paused, it waits)
    if (!reduceMotion) { if (t >= 0) startFlip(true); return; }                 // (as soon as no hand holds the glass)
    // Reduce Motion: no turn. In the same time the sand fades away below, and returns above.
    app.classList.toggle('pass', t > SEQ_TURN - 1300);
    if (t < SEQ_TURN) return;
    turnedUnseen(1);
    beginPhase(seq.phase + 1);
    setState('running');
  }
  /**
   * The glass has been turned over: by the sequence itself, a hand, the Flip
   * button or the phone. Between two phases that begins the next one; after
   * the end of the last, the sequence starts again from its first glass.
   */
  function seqSwapped(next) {
    if (seq.gap) { beginPhase(seq.phase + 1); return T.state === 'paused' ? 'paused' : 'running'; }
    if (seq.rest && seq.phase >= 2 * seq.rounds && next === 'running') beginPhase(0);
    return next;
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
    var byHand = rot !== 'script' || seq.gap > 0;      // (a sequence's own turn is no touch either)
    flip.active = false; flip.dragging = false; flip.spin = 0;
    sim.flipping = false;
    sim.angle = 0;
    rot = 'none';
    body.w = 0; body.theta = 0;
    syncMode();
    sim.wakeAll();
    applyBody(0);
    buzz(22);
    setState(flip.swapped ? seqSwapped(stateAfterSwap(flip.was, flip.auto)) : flip.was);
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
    rideMs: 80,                      // ms: a finger on a spinning bulb may be the next flick: this long to move on with the spin
    rideAt: 0.03,                    // rad: ... by at least this much; then the glass is carried along, not stopped
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
  var flickPeak = 0;                 // the hardest the sand pressed on the domes during this turn by hand, g
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
    // the base on the desk (or the frame on the screen's edge), and the glass answering:
    // heard only when the blow is hard enough to mark the glass. Handling it is silent
    // (taking it, turning it, setting it down); the one sound a finger makes is its tap.
    if (grade) {
      var k = v / 1800;
      audio.thump(k * k, 0.8 * nx, sim.nTop >= sim.nBottom ? 0 : 1);
      k = (v - 250) / 1700; audio.clack(k * k, 0.8 * nx);
    }
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
    if (grab && grab.ride && performance.now() > grab.ride) stopRide(grab);     // it was no flick: the finger stops it
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
      a = lamNow * w * w * sim.geo.HB / sim.G;        // how hard this presses the sand on the domes, g
      if (a > flickPeak) flickPeak = a;
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
    // (Real sand plays the glass's motion to its sand itself, as the lab does (realsand/felt.mjs:
    // live by default): it takes it before the free fall, unturned, with the turn rho)
    if (real) real.feel(tS, fx, fy, body.air, rho);
    if (body.air) fy -= 0.9;
    var G = sim.G;
    var w = body.w + mw;
    alLP += ((w - wPrev) / DT - alLP) * ALPHA_K;
    wPrev = w;
    var al = alLP > 300 ? 300 : (alLP < -300 ? -300 : alLP);
    sim.setMotion(G * (fx * c + fy * s), G * (-fx * s + fy * c), w, al, lamNow, mz);
    // The sand was moving across the screen with the glass and keeps that speed when the
    // glass is stopped or snatched away: its beds slide on (physics.js setCarry). In the
    // glass's own cells, not as a g-ratio: the sand lives in slow motion, the hand does not.
    // (while it falls freely its sand is weightless already, above: not twice)
    var kx = reduceMotion ? 0 : -body.ax / room.px, ky = reduceMotion || body.air ? 0 : -body.ay / room.px;
    sim.setCarry(kx * c + ky * s, -kx * s + ky * c);
  }

  /* ======================================================================
   *  Pour (+ Sand)
   * ==================================================================== */
  var POUR_RATE = 620 * fine2;       // grains per second while held
  var pour = { held: false, until: 0, acc: 0, warned: false, active: false };

  function handlePour(now, dtMs) {
    pour.active = false;
    if (!(pour.held || now < pour.until) || flip.active || resetting || seq.gap) return;
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

  var motionWatch = 0, waitTimer = 0, askSeq = 0, btnMotion = $('btn-motion');

  function motionOff(msg) {
    askSeq++;                                     // an answer still on its way no longer counts
    clearTimeout(motionWatch); clearTimeout(waitTimer); btnMotion.hidden = true;
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
      if (r === 'granted') { btnMotion.hidden = true; motionGo(); watchMotion(true); }
      else if (r === 'denied') motionOff('Motion access was declined. Allow it in Settings to use this.');
      else motionOff('Motion is not available on this device');
    }, function () {
      if (my === askSeq) motionOff('Motion access is unavailable');
    });
  }
  /**
   * Real motion was left on. An iPhone forgets the permission whenever the
   * app is closed, and only a tap may ask for it again. The app does not
   * spring that question on the first tap that comes along: a small tilt
   * button waits in the top bar and asks when it is tapped. Left alone, the
   * glass simply stands still this time, and Real motion stays switched on
   * for the next. Where the site is still allowed (the same session, a
   * reload) the readings arrive unasked and the button never shows.
   */
  function awaitMotion() {
    if (!grav.on || motion.seenOrient || motion.seenMotion) return;
    btnMotion.hidden = false;
    if ((settings.hintMotion | 0) < 3) {
      settings.hintMotion = (settings.hintMotion | 0) + 1; save();
      toast('Real motion: tap the tilt icon to allow it', 4200);
    }
  }
  // The question must go out from inside a real tap. The button's click may reach it by way
  // of its haptic label, so the lifting finger is listened for as well (once a tap).
  var motionTapAt = 0;
  function motionTap(e) {
    if (btnMotion.hidden || !e.target || !btnMotion.contains(e.target)) return;
    var now = performance.now();
    if (now - motionTapAt < 700) return;
    motionTapAt = now;
    askMotion();
    buzz(8);
  }
  ['pointerup', 'touchend', 'click'].forEach(function (t) { window.addEventListener(t, motionTap, true); });

  /** The Real motion switch. fromUser: inside the switch's click, where a prompt may be shown. */
  function setMotion(on, fromUser) {
    askSeq++;
    clearTimeout(motionWatch); clearTimeout(waitTimer); btnMotion.hidden = true;
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
      waitTimer = setTimeout(awaitMotion, 1000);
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
    setState(seqSwapped(stateAfterSwap(was, false)));
  }

  var tiltOver = 0;
  function stepGravity(dtMs, now) {
    if (!btnMotion.hidden && (motion.seenOrient || motion.seenMotion)) btnMotion.hidden = true;   // allowed already: nothing to ask
    var want = grav.on ? grav.target : 0;
    // Standing straight: let the sand sleep. Past that the lean comes in from nothing (it does not
    // begin with a step, which the sand would answer with a start) and has caught up with the phone by 5°.
    var aw = want < 0 ? -want : want;
    if (aw < 0.03) want = 0;
    else if (aw < 0.09) want = (want < 0 ? -1.5 : 1.5) * (aw - 0.03);
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
    // Real sand has drawn its first frame: it takes over between two frames, in a quiet one (not
    // inside a Reset's sweep, a turn, a pour, or while a hand has the glass or it moves on its own:
    // the engine's bed settled upright, and the cross-fade must not join a bed that has slid)
    if (realDue && !sweep && !resetting && !flip.active && !pour.active && !bodyBusy() && (!realEng || realEng.ready)) handover('gpu');

    tickClock();
    if (sweep) stepSweep(now);
    if (seq.gap) seqTurn();
    if (grav.on) {
      var hd = motion.heading;
      if (hd === hd && hd !== Infinity && hd !== -Infinity) grav.target = hd;   // finite: known
      grav.seen = motion.seenOrient;
    }
    handlePour(now, dtMs);
    stepGravity(Math.min(dtMs, 100), now);
    updateMend(now);

    var running = T.state === 'running' && !flip.active && !sweep;
    var draining = T.state === 'done' && sim.nTop > 0 && !flip.active && !sweep;

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
    sim.topSweeps = running ? Math.min(6, Math.floor(T.rate / fine2 / 260)) : 0;
    // Shaken, the neck stutters and falls behind. While that is recent, a
    // backlog drains as a slightly thicker thread, never as a clump.
    var motionRecent = motionRecentNow = now - lastMotionAt < 2000;
    sim.relCap = motionRecent ?T.rate * DT * (3 + 20 * Math.max(0, 1 - (T.rem - T.tailMs) / 5000)) : 0;
    // only sustained, hard real shaking of the phone can crack the glass; its swings count
    // whichever way it is shaken (motion.js counts them from all three axes)
    sim.damageArmed = grav.on && motion.armed && !reduceMotion;
    if (grav.on) sim.shake(motion.takeSwings());
    sim.spinArmed = rot === 'free' || rot === 'held' || rot === 'detent';   // spun by hand
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
                 bodyBusy() || spill.active || renderer.animating || felt || sweep;
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
      if (real) real.submit(now);               // Real sand: this frame's substeps and its picture, on the GPU
      else renderer.drawSand();
      drawMs = performance.now() - s1;
      dirty = false;
    }
    if (real) watchReal(dtMs);                  // Real sand: a graphics chip that no longer answers (the watchdog)

    back = false;
    drainDamage(now);
    drainEscapes();
    var landed = stepSpill(dtMs);
    applyBody(dtMs);
    if (flip.active) {
      var f = Math.min(1, Math.abs(sim.angle) / Math.PI);
      f = f * f * (3 - 2 * f);
      flip.shown = T.rem + ((seq.gap ? phaseMs(seq.phase + 1) : remAt(sim.total - sim.nTop)) - T.rem) * f;
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
    if (dbgSand) updateSandDebug(now);

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
  /** True when lattice bulb `b` (0 above the neck) is the lower one on screen as the glass stands. */
  function lowOnScreen(b) { return (b === 1) !== (grav.base !== 0); }

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
      if (type === DMG.WARN) {
        audio.creak(lv, x); buzz(6);
        // the first creak a finger causes: say once what it means (a shaken phone is told in Tune)
        if (!settings.hintCrack && !sim.damageArmed) {
          settings.hintCrack = true; save();
          var ws = sim.segInfo(sim.warnSeg);
          toast('Careful: the glass can crack', 3200, lowOnScreen(ws ? ws.bulb : 0));
        }
      }
      else if (type === DMG.CRACK) {
        audio.crack(x);
        audio.setCracked('cracked');
        buzz([8, 40, 18]);
        if (settings.mendNotes < 3) {
          settings.mendNotes++; save();
          toast('The glass cracked · hold it still to mend', 4200, lowOnScreen(sim.cracks[k] ? sim.cracks[k].bulb : 0));
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
  var escShare = 0;
  function drainEscapes() {
    var n = sim.escN;
    if (!n) return;
    var g = sim.geo, s = renderer.scale * kfNow, rho = sim.angle + grav.base;
    var c = Math.cos(rho), sn = Math.sin(rho), zk = zoomK(), w = body.w;
    var ox = 0.85 * R0.width + body.px / zk, oy = 0.5 * R0.height + body.py / zk;
    var bvx = body.vx / zk, bvy = body.vy / zk;
    for (var k = 0; k < n; k++) {
      // (finer sand: the desk is given the classic glass's share, so the dune is the dune it was)
      if (fine2 > 1) { escShare += 1 / fine2; if (escShare < 1) continue; escShare -= 1; }
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
    // (finer sand: the ear is given the classic glass's counts: grains by fine2, their slides by fine³)
    var rel = active ? f.released / dt / fine2 : 0;
    var imp = active ? (f.impSand + f.impGlass) / dt / fine2 : 0;
    var sl = active ? f.slides / dt / (fine2 * fine) : 0;
    S.flow += (rel - S.flow) * kf;
    S.imp += (imp - S.imp) * kf;
    S.slides += (sl - S.slides) * Math.min(1, dt * 10);
    leakRate += ((active ? f.leaked / dt / fine2 : 0) - leakRate) * (1 - Math.exp(-dt / 0.3));
    var bulk = running && sim.nTop > T.tailGrains;
    // the slosh moves between the ears with the fuller bulb's field: to the side its sand runs to
    // (a lean with the right edge low, the hiss in the right ear, where the landings there are too)
    var b = sim.nTop >= sim.nBottom ? 0 : 2, rho = sim.angle + grav.base;
    var fxp = sim.bf[b] * Math.cos(rho) - sim.bf[b + 1] * Math.sin(rho);
    var pan = 0.6 * fxp / sim.G;
    if (pan > 0.65) pan = 0.65; else if (pan < -0.65) pan = -0.65;
    AU.dt = dt;
    AU.flow = bulk ? Math.max(S.flow, T.rate * 0.5 / fine2) : S.flow;
    AU.impacts = S.imp;
    AU.tail = sim.nTop >= T.tailGrains ? 1 : Math.pow(sim.nTop / T.tailGrains, 1.2);
    AU.fill = sim.nBottom / sim.capacity;
    AU.bottom = sim.nBottom / fine2;
    AU.slides = S.slides;
    AU.pouring = pour.active || (sweep !== null && sweep.pour === true);   // (a new glass is poured, too)
    AU.running = running;
    AU.ambient = T.state === 'running';  // a running glass keeps its ambience while being turned
    AU.flipping = flip.active;
    AU.spin = Math.abs(body.w);
    AU.angle = sim.angle;
    if (fine2 > 1 && active && sim.nev) {
      // … and of the single landings it hears, one in fine2
      var keep = 0;
      for (var ev = 0; ev < sim.nev; ev++) {
        if (Math.random() * fine2 < 1) { sim.evX[keep] = sim.evX[ev]; sim.evV[keep] = sim.evV[ev]; sim.evK[keep] = sim.evK[ev]; keep++; }
      }
      sim.nev = keep;
    }
    // The bed is heard wherever its sand moved: this asks only whether the frame was stepped,
    // never whether the glass runs, so an idle, paused or finished glass that is leaned, carried
    // or shaken sounds as a running one does (the stream and the ambience are the running
    // glass's: AU.flow, AU.ambient). Real sand fills the same record from what its sand did
    // (inside real.submit, before this), and leaves it empty, its agitation 0, while it sleeps.
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
   *  Zen
   *
   *  The controls dim and the glass takes the whole screen. Only three
   *  things change that. Two fingers spreading on the screen bring it, and
   *  so does the moon button; two fingers pinching together leave it, as
   *  Escape does for a keyboard. Nothing else: not a tap, not playing with
   *  the glass, not the passing of time, not the end of a glass.
   * ==================================================================== */
  var ZEN_SETTLE = 1500;             // ms: the fade into Zen (styles.css), after which the dim controls take no taps
  var END_AWAKE = 12000, endWall = -1e9;
  var zenSince = 0, zenFs = false;
  /** Enter or leave Zen. True if that changed anything. */
  function setZen(on) {
    if (on === app.classList.contains('zen')) return false;
    zoom.style.transition = '';                       // even within the launch's first moments: settle softly
    app.classList.toggle('zen', on);
    if (!on) app.classList.remove('zen-deep');
    applyZoom();
    var inFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (on) {
      // where the browser allows, hide its chrome too
      var el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req && !inFs) {
        try {
          var p = req.call(el, { navigationUI: 'hide' });
          zenFs = true;
          if (p && p.catch) p.catch(function () { zenFs = false; });
        } catch (e) { zenFs = false; }
      }
    } else if (zenFs) {
      zenFs = false;
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit && inFs) {
        try { var q = exit.call(document); if (q && q.catch) q.catch(function () {}); } catch (e2) {}
      }
    }
    return true;
  }
  // the browser's own way out of full screen (Escape, a swipe) leaves Zen too
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (t) {
    document.addEventListener(t, function () {
      if (zenFs && !(document.fullscreenElement || document.webkitFullscreenElement)) { zenFs = false; setZen(false); }
    });
  });
  function updateZen(now) {
    // settled: once fully dim, stop re-blurring the panel and stop taking taps on the controls
    var on = app.classList.contains('zen');
    if (!on) zenSince = 0; else if (!zenSince) zenSince = now;
    var deep = on && now - zenSince > ZEN_SETTLE;
    if (deep !== app.classList.contains('zen-deep')) app.classList.toggle('zen-deep', deep);
  }
  /** The moon button leads where no control shows the way back: say it, the first three times. */
  function zenHint() {
    var n = settings.hintZen | 0;
    if (n >= 3) return;
    settings.hintZen = n + 1; save();
    toast(window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'Pinch in to come back' : 'Esc to come back', 3600);
  }

  /* ======================================================================
   *  Breathing pace
   *
   *  While the sand runs, the light behind the glass swells through the
   *  in-breath, holds, and fades through the out-breath. Each part of a
   *  breath is one transition of the layer's opacity and scale (styles.css,
   *  #breath), so the compositor does the breathing and no script runs
   *  between the parts: a timer only begins the next one. Which part it is
   *  comes from the wall clock every time, never from counting, so a late
   *  timer, a slow frame or a sleeping phone cannot shift a breath.
   * ==================================================================== */
  var BREATHS = {                    // ms: in, hold, out, hold
    calm: [4000, 0, 6000, 0],        // six breaths a minute
    box: [4000, 4000, 4000, 4000],
    deep: [4000, 7000, 8000, 0]
  };
  // (a damaged setting may name anything: "constructor" is not a pattern)
  if (!Object.prototype.hasOwnProperty.call(BREATHS, settings.breathPattern)) settings.breathPattern = 'calm';
  var breathEl = $('breath');
  var breath = { on: false, t0: 0, n: NaN, timer: 0 };   // t0: when this run of breaths began (Date.now())

  /**
   * Begin the part of the breath the clock says it is in, and wait for the
   * next. `back`: the page was away, so the glow is put exactly where the
   * clock says, whatever its transitions did meanwhile.
   */
  function breathStep(back) {
    clearTimeout(breath.timer);
    if (!breath.on || document.hidden) return;         // (no timers while away)
    var p = BREATHS[settings.breathPattern], cycle = p[0] + p[1] + p[2] + p[3];
    var e = Date.now() - breath.t0, c = Math.floor(e / cycle), i = 0;
    e -= c * cycle;
    while (e >= p[i]) { e -= p[i]; i++; }              // 0 in, 1 held full, 2 out, 3 held at rest
    if (back === true || 4 * c + i !== breath.n) {
      breath.n = 4 * c + i;
      var cl = breathEl.classList, st = breathEl.style, from = i === 1 || i === 2, to = i < 2;
      if (back === true || e > 300 || cl.contains('in') !== from) {
        // not straight from the part before: start from where this part starts
        st.transition = 'none';
        cl.toggle('in', from);
        void getComputedStyle(breathEl).opacity;       // (styles only, no layout)
      }
      st.transition = '';
      if (to !== from) {
        // late by e ms: the transition is entered that far in, and still ends on time
        st.transitionDuration = p[i] + 'ms';
        st.transitionDelay = -e + 'ms';
        cl.toggle('in', to);
      }
    }
    breath.timer = setTimeout(breathStep, p[i] - e);
  }
  /**
   * Stop the glow where it is, so that what comes next starts from there and
   * takes its own full time (a transition turned round in mid-air would
   * otherwise be cut short by the browser).
   */
  function breathHold() {
    var st = breathEl.style, cs = getComputedStyle(breathEl), o = cs.opacity, tf = cs.transform;
    st.transition = 'none'; st.opacity = o; st.transform = tf;
    void cs.opacity;
    st.transition = st.opacity = st.transform = '';
  }
  /** From rest a breath begins by swelling; a new pattern chosen mid-breath goes on from where the glow is. */
  function breathBegin() {
    var p = BREATHS[settings.breathPattern];
    breathHold();
    breath.t0 = Date.now() - (breathEl.classList.contains('in') ? p[0] + p[1] : 0);
    breath.n = NaN;
    breathStep();
  }
  /** Breathing only while the sand is running; otherwise the glow eases back to rest. */
  function breathSync() {
    var want = settings.breath && T.state === 'running';
    if (want === breath.on) return;
    breath.on = want;
    if (want) breathBegin();
    else {
      clearTimeout(breath.timer);
      breathHold();
      breathEl.classList.remove('in');                 // the stylesheet's own transition: slowly back
    }
  }
  /** The layer exists only while the switch is on (at rest it is clear). */
  function breathLayer(on) {
    breathEl.hidden = !on;
    if (on) void getComputedStyle(breathEl).opacity;   // its resting style, before it first swells
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
    if (realEng) realEng.layout();                     // Real sand's canvas takes the sand canvas's box
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
    placeTune();
  }
  /**
   * Tune's sheet has one height on all four tabs: its top edge sits TUNE_GAP px under the neck
   * of the glass as it is drawn (settings design 2.2), so the upper bulb, the neck and the
   * stream stay in view while anything is chosen. The neck is the glass's centre at home: with
   * the controls in place, where the zoom's transform puts it. styles.css reads --tune-top (and
   * keeps the sheet's old limit on a phone on its side); the sheet is never made shorter than
   * TUNE_MIN. Called with every layout (a resize, a rotation, the frame put on or taken off) and
   * with Zen.
   */
  var TUNE_GAP = 44, TUNE_MIN = 220;
  function placeTune() {
    var neck = R0.cy + (app.classList.contains('zen') ? 0 : R0.dy);
    var top = Math.min(Math.round(neck + TUNE_GAP), window.innerHeight - TUNE_MIN);
    sheetSettings.style.setProperty('--tune-top', top + 'px');
  }

  /* ======================================================================
   *  Feedback helpers
   * ==================================================================== */
  /*
   * Haptics. Android vibrates (navigator.vibrate). An iPhone has no such
   * call, but since iOS 18 a switch control taps the Taptic Engine when it
   * flips. Until iOS 26.4 a hidden switch could be flipped from script;
   * since 26.5 only a finger that really lands on a switch, or on its
   * label, is answered. So on an iPhone every control, and the glass
   * itself, carries a transparent label over a hidden switch (hapticMount).
   * The finger lands on that label; the tap is passed on to the control as
   * before; and if the control asked for a tap (buzz), the switch is left
   * to flip and the phone ticks. One tick a tap. What happens without a
   * tap cannot tick there: the end of a glass, a landing, a crack from
   * shaking, anything while a finger drags (on iOS 18 to 26.4 the hidden
   * switch still answers as that finger lifts).
   */
  var HAPTIC_TAPS = !navigator.vibrate && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  var gestureUntil = 0, tickWanted = 0;
  var tapOn = null, tapX = 0, tapY = 0, tapAt = 0;   // the label under the finger of a tap in the making
  function buzz(pattern) {
    if (!settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} return; }
    var now = performance.now();
    if (tapOn && now - tapAt < 1000) { tickWanted = now; return; }   // the tap's own switch answers, at its click
    // otherwise: only from inside the end of a touch; a tap wanted while
    // the finger was down (a catch, a half turn) plays as it lifts
    if (now < gestureUntil) iosTick(); else tickWanted = now;
  }
  window.addEventListener('pointerdown', function (e) {
    tapOn = e.target && e.target.closest ? e.target.closest('.haptic') : null;
    tapX = e.clientX; tapY = e.clientY; tapAt = performance.now();
  }, { capture: true, passive: true });
  window.addEventListener('pointermove', function (e) {
    if (!tapOn) return;
    var dx = e.clientX - tapX, dy = e.clientY - tapY;
    if (dx * dx + dy * dy > 144) tapOn = null;       // it has strayed: no click comes of it
  }, { capture: true, passive: true });
  window.addEventListener('pointercancel', function () { tapOn = null; }, { capture: true, passive: true });
  ['touchend', 'pointerup', 'click'].forEach(function (t) {
    window.addEventListener(t, function (e) {
      if (tapOn || (t === 'click' && e.target && e.target.closest && e.target.closest('.haptic'))) return;   // (see hapticClick)
      var now = performance.now();
      gestureUntil = now + 60;
      if (tickWanted && now - tickWanted < 1500) { tickWanted = 0; iosTick(); }
    }, { capture: true, passive: true });
  });
  /** iOS 18 to 26.4: a hidden switch, flipped from inside a touch, gives a light, real tap. */
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
      label.click();
      document.head.removeChild(label);
    } catch (e) {}
  }
  /** Lay the transparent label and its hidden switch over a control (or over the stage, for taps on the glass). */
  function hapticMount(host) {
    if (host._haptic) return;
    var label = document.createElement('label'), input = document.createElement('input');
    label.className = 'haptic';
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'all:unset;position:absolute;inset:0;border-radius:inherit;';
    input.type = 'checkbox'; input.setAttribute('switch', ''); input.setAttribute('form', '');
    input.tabIndex = -1;
    input.style.cssText = 'position:absolute;width:1px;height:1px;margin:0;visibility:hidden;';   // never under the finger itself
    label.appendChild(input);
    label.addEventListener('click', hapticClick);
    label.addEventListener('input', hapticMute);
    label.addEventListener('change', hapticMute);
    host._haptic = label; label._host = host;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(label);
  }
  function hapticMute(e) { e.stopPropagation(); }
  function hapticClick(e) {
    var label = e.currentTarget, host = label._host;
    e.stopPropagation();
    if (e.target !== label) return;                  // the switch's own click, on its way back up
    if (host.disabled) { tapOn = null; e.preventDefault(); return; }
    tapOn = label; tapAt = performance.now();        // while the control hears it, a buzz belongs to this tap
    // the control hears the tap as it always did (the glass has heard it already, as the finger lifted)
    if (host !== stage) {
      host.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, composed: true, view: window, detail: e.detail,
        screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY
      }));
    }
    // asked for a tap: the switch is left to flip, and the phone ticks. Not asked: it stays as it is.
    if (tickWanted && performance.now() - tickWanted < 1000) tickWanted = 0; else e.preventDefault();
    tapOn = null;
  }
  function hapticMountAll() {
    if (!HAPTIC_TAPS) return;
    var hosts = document.querySelectorAll('button, label.row, #readout');
    for (var i = 0; i < hosts.length; i++) hapticMount(hosts[i]);
    hapticMount(stage);
  }

  var toastTimer = 0;
  /** `high`: show it up under the readout (a note about the glass must not cover the spot it is about). */
  function toast(msg, ms, high) {
    toastEl.textContent = msg;
    // Said while Tune is open, it would lie on the rows it is about: there it sits just above
    // the sheet, its lower edge 4 px over the sheet's top, in the gap under the glass's neck (and
    // goes when the sheet goes). Where the sheet leaves no room above it (a phone on its side),
    // at the top of the screen.
    var y = sheetOpen === sheetSettings ? sheetSettings.offsetTop - 4 : 0, st = toastEl.style;
    toastEl.classList.toggle('high', y > 0);
    toastEl.classList.toggle('up', !!high && !(y > 0));
    st.top = st.bottom = '';
    if (y > 0) {
      var room = safeInsets().t + 4;
      if (y - toastEl.offsetHeight < room) { st.top = room + 'px'; st.bottom = 'auto'; }
      else st.bottom = 'calc(100% - ' + y + 'px)';
    }
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
        mpg: T.mpg, mpg0: T.mpg0, tailMs: T.tailMs, tailGrains: T.tailGrains,
        shape: glassShape(), full: grainsFor(T.durationMs)   // the glass, and what it holds when full for this time
      };
      var dmg = sim.serializeDamage();
      if (dmg) s.damage = dmg;
      if (seq.rest) s.seq = [seq.rest, seq.rounds, seq.phase];
      localStorage.setItem(SKEY, JSON.stringify(s));
    } catch (e) {}
  }
  function restoreSession() {
    var s;
    try { s = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return false; }
    if (!s || s.v !== 1 || qt) return false;
    var away = Date.now() - s.at;
    if (!(away >= 0) || away > 6 * 3600000 + (seq.rest ? seq.rounds * (T.durationMs + seq.rest) : 0)) return false;   // (a sequence may run long)
    if (s.durationMs !== T.durationMs) return false;   // a different glass
    var was = typeof s.shape === 'string' ? s.shape : 'classic';   // (a session saved before the shapes: the classic glass)
    if (was !== glassShape()) {
      // The same time in another shape (Tune's "Use this shape"): the sand is counted anew, as a
      // share of what each glass holds when full for this time, so that sand added with + Sand
      // keeps its share; the pace is scaled with it, so the time left is what it was. A crack
      // belongs to the other glass.
      if (!(s.full > 0) || !(s.total > 0)) return false;
      var n2 = Math.min(sim.maxTotal, Math.round(s.total * grainsFor(T.durationMs) / s.full)), r3 = n2 / s.total;
      if (!(r3 > 0.05 && r3 < 20)) return false;
      s.total = n2;
      s.top = Math.round(s.top * r3);
      s.mpg /= r3; s.mpg0 /= r3;
      s.tailGrains = Math.max(3, Math.round(s.tailGrains * r3));
      s.scale = sim.geo.q;
      delete s.damage;
    } else if (s.scale !== sim.geo.q) {
      // The same glass in another grain (Tune), or on a screen that has changed its size class:
      // its sand is counted anew. A crack is kept cell by cell, so this glass comes back whole.
      var r2 = sim.geo.q / s.scale;
      r2 *= r2;
      if (!(r2 > 0.05 && r2 < 20)) return false;
      s.total = Math.min(sim.maxTotal, Math.round(s.total * r2));
      s.top = Math.round(s.top * r2);
      s.mpg /= r2; s.mpg0 /= r2;
      s.tailGrains = Math.max(3, Math.round(s.tailGrains * r2));
      delete s.damage;
    }
    if (!(s.total > 0) || s.total > sim.maxTotal || !(s.mpg > 0) || !(s.tailMs > 0)) return false;
    var q = Array.isArray(s.seq) ? s.seq : [0, 1, 0];
    if (q[0] !== seq.rest || q[1] !== seq.rounds) return false;                  // a different sequence
    var rem = +s.rem || 0, state = s.state, ph = Math.max(0, Math.min(2 * seq.rounds, q[2] | 0)), at = null, ago = away;
    if (state === 'running') {
      rem -= away;
      if (rem <= 0 && seq.rest) {
        if (ph < 2 * seq.rounds - 1) {
          at = seqAt(ph, -rem);                        // phases ran out while away: on to where the clock is now
          ph = at[0]; rem = phaseMs(ph) - at[1];
        }
        ago = -rem;                                    // (a sequence runs for hours: how long ago it ended, if it has)
      }
      if (rem <= 0) { rem = 0; state = 'done'; if (seq.rest) ph = 2 * seq.rounds; }
    }
    T.lastTick = Date.now();                           // the clock goes on from this moment
    if (state !== 'running' && state !== 'paused' && state !== 'done') return false;
    if (state === 'done' && ago > 3600000) return false;                        // long finished: start fresh
    sim.reset(s.total);
    sim.restoreDamage(s.damage);                         // an older session has none: the glass stays whole
    T.mpg = s.mpg; T.tailMs = s.tailMs; T.tailGrains = s.tailGrains; T.rate = 1000 / T.mpg;
    T.mpg0 = s.mpg0 > 0 ? s.mpg0 : s.mpg;
    seq.phase = ph;
    if (at) { turnedUnseen(at[2]); calibrate(phaseMs(at[0]), sim.nTop); }
    else if (state === 'paused' && rem <= 0 && seq.rest && ph < 2 * seq.rounds - 1) seq.gap = Date.now();   // left between two phases
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

  /*
   * Two fingers. Spreading them brings Zen and pinching them together
   * leaves it, from anywhere on the screen. A finger that was only resting
   * on the glass gives it up to the pinch; a glass already being carried or
   * turned is not let go for one (there the second finger is ignored, as it
   * always was). The fingers must travel: a fifth of the gap between them,
   * and 36 px at least. Turning back within the same pinch undoes it.
   */
  var pinch = { on: false, pts: {}, n: 0, ref: 0, dir: 0 };
  function pinchGap() {
    var k = Object.keys(pinch.pts), a = pinch.pts[k[0]], b = pinch.pts[k[1]];
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  window.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    if (!pinch.pts[e.pointerId]) pinch.n++;
    pinch.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch.n !== 2) return;
    if (!pinch.on) {
      if (sheetOpen || (grab && (grab.kind === 'move' || grab.kind === 'turn'))) return;
      pinch.on = true;
      cancelGesture();                 // the first finger was no tap, catch or mend after all
    }
    pinch.ref = pinchGap(); pinch.dir = 0;
  }, { capture: true, passive: true });
  window.addEventListener('pointermove', function (e) {
    var p = pinch.pts[e.pointerId];
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!pinch.on || pinch.n !== 2) return;
    var d = pinchGap(), r = pinch.ref, dir = pinch.dir;
    var out = d > r * 1.2 && d - r > 36, inn = d < r / 1.2 && r - d > 36;
    if (dir >= 0 && inn) { pinch.dir = -1; pinch.ref = d; setZen(false); }
    else if (dir <= 0 && out) { pinch.dir = 1; pinch.ref = d; setZen(true); }
    else if ((dir > 0 && d > r) || (dir < 0 && d < r)) pinch.ref = d;   // the farthest it went: turning back is measured from there
  }, { capture: true, passive: true });
  function pinchEnd(e) {
    if (!pinch.pts[e.pointerId]) return;
    delete pinch.pts[e.pointerId];
    if (--pinch.n <= 0) { pinch.n = 0; pinch.on = false; }
  }
  window.addEventListener('pointerup', pinchEnd, { capture: true, passive: true });
  window.addEventListener('pointercancel', pinchEnd, { capture: true, passive: true });
  // A trackpad's pinch: a wheel with ctrl held in most browsers, Safari's own gesture on a Mac.
  var wheelSum = 0, wheelAt = 0;
  window.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();                // not the page's own zoom
    if (sheetOpen) return;
    var now = performance.now();
    if (now - wheelAt > 400) wheelSum = 0;
    wheelAt = now;
    wheelSum -= e.deltaY;              // spreading the fingers turns the wheel "up"
    if (wheelSum > 40) { wheelSum = 0; setZen(true); } else if (wheelSum < -40) { wheelSum = 0; setZen(false); }
  }, { passive: false });
  document.addEventListener('gesturechange', function (e) {
    if (pinch.n || sheetOpen || typeof e.scale !== 'number') return;      // (a phone's fingers are followed above)
    if (e.scale > 1.2) setZen(true); else if (e.scale < 1 / 1.2) setZen(false);
  });

  // The glass itself. Tap it to pause / resume. Take it by the waist and
  // move it, by a bulb and turn it; flick it and it spins on; touch it
  // while it moves and it stops; hold a finger still on a cracked glass to
  // mend it. One finger: a second one is a pinch, or is ignored.
  var grab = null;
  stage.addEventListener('pointerdown', function (e) {
    if (e.button || grab || pinch.on) return;
    var r = assembly.getBoundingClientRect();
    var padX = r.width * 0.04, padY = r.height * 0.01;
    var g = grab = {
      id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(),
      inside: !(e.clientX < r.left + padX || e.clientX > r.right - padX ||
                e.clientY < r.top + padY || e.clientY > r.bottom - padY),
      cx: r.left + r.width / 2, cy: r.top + r.height / 2, h: r.height,   // where it is now, offset included
      kind: 'press',               // press → move | turn; none: only ever a tap
      far: 0,                      // farthest the finger has strayed (px²)
      caught: false, mendable: false,
      ride: 0, rideD: 0,           // riding a spin that may be flicked on: until when, and how far the finger has turned
      lx: e.clientX, ly: e.clientY,                // where the finger is now
      fx: 0, fy: 0, p0x: 0, p0y: 0, last: 0
    };
    // (a finger is held by what it touched anyway; capturing it here could take its click from the haptic label)
    if (e.pointerType !== 'touch') { try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
    if (!g.inside || sheetOpen || resetting || (flip.active && flip.mode === 'script')) {
      // (while a new glass is being made, a tap is still a tap: for that glass, when its sand is in)
      g.kind = sweep && g.inside && !sheetOpen ? 'tap' : 'none';
      return;
    }
    if (bodyMoving()) catchBody(g, e.clientX, e.clientY);
    else g.mendable = hasOpenCrack();
  });
  stage.addEventListener('pointermove', function (e) {
    var g = grab;
    if (!g || e.pointerId !== g.id) return;
    var dx = e.clientX - g.x, dy = e.clientY - g.y, d2 = dx * dx + dy * dy;
    if (d2 > g.far) g.far = d2;
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
    if (g.caught || (g.kind !== 'press' && g.kind !== 'none' && g.kind !== 'tap') || g.far > 196 || dur > 700) return;
    if (g.kind === 'tap') { if (!sheetOpen && !flip.active) { audio.tap(); toggle(); } return; }
    if (dur > MEND_WAIT && hasOpenCrack()) return;
    if (g.kind !== 'press' || sheetOpen || !g.inside || flip.active) return;
    audio.tap();                       // fingertip on glass
    if (knock(g)) return;              // one of a quick burst: a knock, not a start or pause
    knockUndo = T.state;
    toggle();
  }
  /*
   * Knocking. Taps or clicks on the glass less than 0.6 s apart are a burst
   * of knocks. The first of a burst starts or pauses the glass like any
   * tap, and the second takes that back (it was a knock all along); the
   * rest only knock. Knocks that come fast, less than 0.4 s apart, land
   * harder and harder: 0.6, 0.8, 1.0, then 1.2 each; at two a second or
   * slower they stay ordinary taps however long they go on. A few hard
   * knocks near one place creak, then crack the glass where it is struck
   * (sim.knock). How hard or how broadly the finger pressed is not asked:
   * what a phone reports for it differs too much to tell a hard tap from a
   * soft one.
   */
  var KNOCK = { gap: 600, fast: 400 };           // ms
  var knockAt = -1e9, knockRun = 0, knockUndo = null;     // (never "quick" for the first tap after the page opens)
  function knock(g) {
    var now = performance.now(), gap = now - knockAt, quick = gap < KNOCK.gap;
    knockAt = now;
    knockRun = !quick ? 0 : (gap < KNOCK.fast ? knockRun + 1 : knockRun);
    if (quick && knockUndo !== null) untoggle(knockUndo);
    knockUndo = null;
    var s = 0.6 + 0.2 * Math.min(knockRun, 3);
    if (sim.angle === 0) {
      var r = $('c-sand').getBoundingClientRect();     // the lattice, upright on screen
      var lx = (g.x - r.left) / r.width * sim.W, ly = (g.y - r.top) / r.height * sim.H;
      if (grav.base) { lx = sim.W - lx; ly = sim.H - ly; }
      sim.knock(lx, ly, s);
      drainDamage(now);                // its creak or crack is heard and felt now, inside the tap
    }
    if (quick) buzz(8);
    return quick;
  }
  /** The tap that began a burst of knocks started or paused the glass: quietly take that back. */
  function untoggle(was) {
    if (flip.active || resetting || T.state === was) return;
    if (was === 'running' && T.state === 'paused') setState('running');
    else if ((was === 'paused' || was === 'idle') && T.state === 'running') { setState(was); audio.hush(); }
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
    flickPeak = 0;
    rot = 'held';
    syncMode();
  }
  /**
   * The glass was moving: it stops under the finger, with a soft felt thud.
   * The finger brakes it at once (catching) and then holds it where it
   * stopped (regrip), as a turn or a move.
   */
  function catchBody(g, x, y) {
    var rx = x - g.cx, ry = y - g.cy, out = Math.sqrt(rx * rx + ry * ry) > g.h * BODY.zone;
    var turning = rot === 'free' || rot === 'detent' || rot === 'ease' || body.w > 0.5 || body.w < -0.5;
    g.caught = true;
    if (rot === 'free' && out && !reduceMotion) {
      // A finger on a bulb of a spinning glass may be the next flick. The
      // glass spins on for a moment: if the finger moves on with the spin it
      // is carried along (rideOn), so flick on flick builds speed; if not,
      // the finger stops it as it always did (stopRide).
      g.kind = 'turn';
      g.last = Math.atan2(ry, rx);
      g.ride = performance.now() + BODY.rideMs; g.rideD = 0;
      return;
    }
    if (turning || out) holdTurn(g, x, y);
    else holdMove(g, x, y);
    catching = true;
    buzz(10);
  }
  /** The finger moved on with the spin: it takes the glass at the speed it has (no brake). */
  function rideOn(g) {
    g.ride = 0;
    flickPeak = 0;
    // a hand that turns the glass leads it by 2ζ/ω of its speed: start from there, so nothing jerks
    flip.grabAngle = sim.angle + body.w * 2 * BODY.tz / BODY.tw;
    rot = 'held';
    syncMode();
    buzz(6);
  }
  /** It was no flick (the finger stayed, went the other way or left): the finger stops the glass where it is. */
  function stopRide(g) {
    g.ride = 0;
    if (rot !== 'free' && rot !== 'detent') return;
    flip.grabAngle = sim.angle;
    flickPeak = 0;
    rot = 'held';
    catching = true;
    syncMode();
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
    if (g.ride) {
      // still spinning free under the finger: is this the next flick?
      g.rideD += d;
      if (g.rideD * body.w > BODY.rideAt * (body.w < 0 ? -body.w : body.w)) rideOn(g);
      else if (g.rideD * body.w < -BODY.rideAt * (body.w < 0 ? -body.w : body.w)) stopRide(g);
      return;
    }
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
    if (g.ride) { stopRide(g); body.w = 0; catching = false; }   // a touch too brief to tell: it stopped the glass
    if (g.kind === 'turn' && rot === 'held') {
      // A flick presses the sand on the domes: the harder it was, the more
      // the glass keeps of it. (Its peak counts, but no more than half again
      // what it was let go at: a jerk in the middle of a slow turn is no flick.)
      var gOut = 1.5 * lamNow * body.w * body.w * sim.geo.HB / sim.G;
      if (!cancel && sim.flick(flickPeak < gOut ? flickPeak : gOut) > 0) drainDamage(performance.now());
      flickPeak = 0;
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
  btnZen.addEventListener('click', function () { buzz(8); if (setZen(true)) zenHint(); });

  var THEME_ORDER = ['sahara', 'volcanic', 'moonstone', 'lapis', 'rosequartz', 'seaglass'];
  /**
   * Change something about the instrument behind a slow cross-fade. What is
   * asked for while the fade comes in waits with it and happens once the
   * instrument is out of sight: every `kind` of change asked for (the
   * material, the frame, the layers), and of one kind only the last, so the
   * chip tapped quickly through four materials sets one, not four (each
   * rebuilds the renderer's picture of the sand and the glass).
   */
  var softTimer = 0, softQueue = [];
  function softSwap(kind, fn) {
    var k = 0;
    while (k < softQueue.length && softQueue[k].kind !== kind) k++;
    softQueue[k] = { kind: kind, fn: fn };                // a newer one of its kind takes the older one's place
    if (softTimer) return;
    assembly.classList.add('fade');
    softTimer = setTimeout(function () {
      var q = softQueue;
      softTimer = 0; softQueue = [];
      for (var i = 0; i < q.length; i++) q[i].fn();
      dirty = true;
      requestAnimationFrame(function () { if (!softTimer) assembly.classList.remove('fade'); });   // (unless the next one has begun)
    }, 380);
  }
  function setTheme(id, soft) {
    settings.theme = id; save();
    showTheme(id, soft);
  }
  /** The material shown: the page's colours, the chip's name, the glass (behind the cross-fade if `soft`), the cards. */
  function showTheme(id, soft) {
    document.documentElement.dataset.theme = id;
    themeName.textContent = P.THEMES[id].short;
    if (soft) softSwap('theme', function () { renderer.setTheme(id); if (realEng) realEng.setPalette(); });
    else { renderer.setTheme(id); if (realEng) realEng.setPalette(); }
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
      var on = !seq.rest && +pills[i].dataset.min * 60000 === T.durationMs;
      pills[i].setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) hit = true;
    }
    pillCustom.setAttribute('aria-pressed', hit ? 'false' : 'true');
    customLabel.textContent = hit ? 'Custom' : (seq.rest ? seqBrief(T.durationMs, seq.rest, seq.rounds) : fmt(T.durationMs)[0]);
    pillCustom.setAttribute('aria-label', 'Custom duration' + (seq.rest ? ': ' + seqSpoken(T.durationMs, seq.rest, seq.rounds) : ''));
    pillCustom.classList.toggle('seq', seq.rest > 0);
    app.classList.toggle('seq', seq.rest > 0);
    pillCustom.classList.toggle('long', customLabel.textContent.length > 9);
  }
  /** A sequence in a few characters, for the Custom pill: "25·5 ×4" (minutes; with seconds, "1:30·5"). */
  function seqBrief(work, rest, rounds) {
    function brief(ms) { return ms % 60000 ? Math.floor(ms / 60000) + ':' + pad2(Math.round(ms / 1000) % 60) : '' + ms / 60000; }
    return brief(work) + '·' + brief(rest) + (rounds > 1 ? ' ×' + rounds : '');
  }
  /** ... and in words, for screen readers: "25 minutes, then rest 5 minutes, 4 rounds". */
  function seqSpoken(work, rest, rounds) {
    function say(ms) {
      var sec = Math.round(ms / 1000), m = Math.floor(sec / 60), out = [];
      sec %= 60;
      if (m) out.push(m + (m === 1 ? ' minute' : ' minutes'));
      if (sec || !m) out.push(sec + (sec === 1 ? ' second' : ' seconds'));
      return out.join(' ');
    }
    return say(work) + ', then rest ' + say(rest) + (rounds > 1 ? ', ' + rounds + ' rounds' : '');
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
    scrim.classList.toggle('light', el === sheetSettings);   // behind Tune the glass stays in view, in its true colours
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
    if (toastEl.classList.contains('high')) toastEl.classList.remove('show');   // a toast said above Tune fades with it
    if (el === sheetSettings) resetDisarm();
    var done = function () { el.hidden = true; if (!sheetOpen) scrim.hidden = true; };
    if (instant) done(); else setTimeout(done, 560);
    if (sheetOpener && !instant) { try { sheetOpener.focus({ preventScroll: true }); } catch (e) {} }
  }
  scrim.addEventListener('click', function () { closeSheet(); });
  var closers = document.querySelectorAll('.sheet-close');
  for (var ci = 0; ci < closers.length; ci++) closers[ci].addEventListener('click', function () { closeSheet(); });
  btnSettings.addEventListener('click', function () {
    // (Real sand: the material points the graphics chip simulates)
    $('grain-count').textContent = (real ? real.points : sim.total).toLocaleString();
    $('sim-where').textContent = real ? ' on the graphics chip' : '';
    $('spilled').textContent = sim.lost > 0 ? ' · ' + sim.lost.toLocaleString() + ' spilled' : '';
    openSheet(sheetSettings, btnSettings);
    if (tuneBody) tuneBody.scrollTop = 0;              // on the tab last used, from its top
    tuneEdges();
    buzz(8);
  });

  /* ---- Tune's tabs ---------------------------------------------------- */
  // Tune is four tabs at one height (settings design 2): Sand, Glass, Sound, Time. All four
  // panels are in the page from the start and one shows; the sheet opens on the tab last used
  // (settings.tuneTab), each tab from its top. Arrow keys move along the tab row. A page
  // without the tab row is left as it is: nothing here needs it.
  var tuneTabs = $('tune-tabs'), tuneBody = sheetSettings.querySelector('.sheet-body');
  var tabBtns = tuneTabs ? tuneTabs.querySelectorAll('[role="tab"]') : [];
  /** Show a tab's panel, and no other, from its top. A name the page has no tab for shows the first. */
  function showTab(id) {
    var i, on, panel, found = false;
    for (i = 0; i < tabBtns.length; i++) if (tabBtns[i].dataset.tab === id) found = true;
    if (!found && tabBtns.length) id = tabBtns[0].dataset.tab;
    for (i = 0; i < tabBtns.length; i++) {
      on = tabBtns[i].dataset.tab === id;
      tabBtns[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabBtns[i].tabIndex = on ? 0 : -1;
      panel = $(tabBtns[i].getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    }
    if (tuneBody) tuneBody.scrollTop = 0;
    tuneEdges();
    resetDisarm();
    return id;
  }
  /**
   * Tune's edges (index.html: .edge-top, .edge-more). While the tab shown can still scroll down,
   * its rows fade into the sheet's lower edge and a small chevron points down ('more-below' on
   * the sheet); once it is scrolled from its top, its rows fade out under the tab row
   * ('scrolled'). Within EDGE_SLACK px of either end counts as the end. Read again on a scroll, a
   * tab shown and an opening; and, through a ResizeObserver, whenever the scroller changes size
   * (a resize, a rotation) or a panel does (rows that appear or go: Grain with Real sand, "Copy a
   * report", the breathing choice), which moves no scroll. A closed sheet has nothing to scroll
   * and shows neither.
   */
  var EDGE_SLACK = 2;
  function tuneEdges() {
    if (!tuneBody) return;
    var top = tuneBody.scrollTop, left = tuneBody.scrollHeight - tuneBody.clientHeight - top;
    sheetSettings.classList.toggle('more-below', left > EDGE_SLACK);
    sheetSettings.classList.toggle('scrolled', top > EDGE_SLACK);
  }
  if (tuneBody) {
    tuneBody.addEventListener('scroll', tuneEdges, { passive: true });
    if (window.ResizeObserver) {
      var edgeWatch = new ResizeObserver(function () { tuneEdges(); });
      edgeWatch.observe(tuneBody);
      for (var ei = 0; ei < tuneBody.children.length; ei++) edgeWatch.observe(tuneBody.children[ei]);
    }
  }
  /** A tab chosen (a tap, or a key on the tab row): shown, and remembered for the next opening. */
  function chooseTab(id) {
    id = showTab(id);
    if (id !== settings.tuneTab) { settings.tuneTab = id; save(); }
  }
  if (tuneTabs) {
    tuneTabs.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[role="tab"]') : null;
      if (!b) return;
      chooseTab(b.dataset.tab);
      buzz(8);
    });
    tuneTabs.addEventListener('keydown', function (e) {
      var n = tabBtns.length, i = Array.prototype.indexOf.call(tabBtns, e.target), j;
      if (i < 0 || e.metaKey || e.ctrlKey || e.altKey) return;
      j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i + n - 1) % n :
          e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      chooseTab(tabBtns[j].dataset.tab);
      try { tabBtns[j].focus({ preventScroll: true }); } catch (err) {}
    });
  }

  /* ---- settings controls -------------------------------------------- */
  $('themes').addEventListener('click', function (e) {
    var c = e.target.closest('.card');
    if (c) { setTheme(c.dataset.themeId, true); buzz(8); }
  });
  function setCharacter(id) {
    settings.character = id; save();
    audio.setCharacter(id);
    showCharacter();
  }
  function showCharacter() {
    var b = document.querySelectorAll('#characters button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-checked', b[i].dataset.character === settings.character ? 'true' : 'false');
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
  function swapFrame() {
    softSwap('frame', function () {
      renderer.setFrame(settings.frame);
      layout();                                        // the bare glass can sit larger
    });
  }
  $('opt-frame').addEventListener('change', function (e) {
    settings.frame = e.target.checked; save();
    swapFrame();
  });
  // Layered sand: the sand in the glass is laid in strata where it lies (or
  // goes back to one tone), behind the same slow cross-fade as a new material.
  function swapLayers() {
    softSwap('layers', function () {
      sim.setLayers(settings.layers);
      renderer.setLayers(settings.layers);
      if (realEng) realEng.setPalette();               // (Real sand's colours come from the renderer's table)
    });
  }
  $('opt-layers').addEventListener('change', function (e) {
    settings.layers = e.target.checked; save();
    swapLayers();
  });
  // 'click', not 'change': iOS only shows its motion prompt from a direct tap
  optTilt.addEventListener('click', function (e) { setMotion(e.target.checked, true); });
  $('opt-zen').addEventListener('change', function (e) {
    settings.zenFull = e.target.checked; save();
    app.classList.toggle('zen-full', settings.zenFull);
  });
  /*
   * Grain: the same glass in finer sand. Another grain is another lattice,
   * so the page builds the glass afresh; the running time is kept (the
   * session is saved, and restored by its time), a crack is not.
   */
  function syncGrains() {
    var bs = $('grains').querySelectorAll('[data-grain]');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-checked', +bs[i].dataset.grain === settings.grain ? 'true' : 'false');
  }
  $('grains').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-grain]') : null;
    if (!b) return;
    var g = +b.dataset.grain;
    if (g === settings.grain) return;
    settings.grain = g; save(); syncGrains();
    buzz(8);
    saveSession();
    app.classList.add('regrain');                    // the glass fades, and comes back made anew
    setTimeout(function () { location.reload(); }, 320);
  });
  $('opt-haptics').addEventListener('change', function (e) {
    settings.haptics = e.target.checked; save();
    buzz(12);
  });
  // every switch in Tune is felt as it flips (where its own handler asks too, it is still one tap)
  sheetSettings.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('switch')) buzz(8);
  });
  // breathing pace: the switch, and under it the pattern (hidden while it is off)
  var optBreath = $('opt-breath'), breathRow = $('breath-row'), breathHide = 0;
  function showBreath() {
    optBreath.checked = settings.breath;
    breathRow.hidden = !settings.breath;
    var b = document.querySelectorAll('#breaths button');
    for (var i = 0; i < b.length; i++) b[i].setAttribute('aria-checked', b[i].dataset.breath === settings.breathPattern ? 'true' : 'false');
  }
  optBreath.addEventListener('change', function (e) {
    settings.breath = e.target.checked; save();
    showBreath();
    clearTimeout(breathHide);
    if (settings.breath) {
      breathLayer(true);
      toast('Breathe in as the glow swells, out as it fades', 3600);   // (wrapped, "out as it fades" stays whole)
      // the choice has appeared under the switch: bring it into view if the sheet cuts it off
      var sb = sheetSettings.querySelector('.sheet-body');
      var over = breathRow.getBoundingClientRect().bottom - sb.getBoundingClientRect().bottom;
      if (over > 0) {
        try { sb.scrollBy({ top: over, behavior: reduceMotion ? 'auto' : 'smooth' }); } catch (err) { sb.scrollTop += over; }
      }
    } else {
      breathHide = setTimeout(function () { breathLayer(false); }, 2600);   // once it has eased back to rest
    }
    breathSync();
  });
  $('breaths').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.dataset.breath === settings.breathPattern) return;
    settings.breathPattern = b.dataset.breath; save();
    showBreath();
    if (breath.on) breathBegin();
    buzz(8);
  });

  /* ---- the look and the sound as they came ---------------------------- */
  // The quiet link at the end of the Time tab (settings design 3.4). A first tap asks for a
  // second one within three seconds; the second puts the look and the sound back as a new
  // install has them: the material, the frame, layered sand, the volume, the sand's sound, the
  // ambience and its level, the bowl. Everything else is kept: Real sand and the grain, the
  // durations and a sequence, breathing, Zen, the screen kept awake, haptics, Real motion, the
  // mute button, what the app has learned and hinted. Nothing is loaded again, and the running
  // time is not touched.
  var RESET_ASK = 'Put the look and sound back as they came', RESET_SURE = 'Tap again to put them back';
  var RESET_MS = 3000, RESET_DOUBLE_MS = 400;        // how long it waits for the second tap; a double tap is one tap
  var tuneReset = $('tune-reset'), resetText = $('tune-reset-text'), resetTimer = 0, resetArmedAt = 0;
  function resetDisarm() {
    clearTimeout(resetTimer);
    if (!tuneReset || !resetText || tuneReset.getAttribute('data-state') === 'idle') return;
    tuneReset.setAttribute('data-state', 'idle');
    resetText.textContent = RESET_ASK;
  }
  /** What a new install has for a setting (its record's default). */
  function settingDefault(key) {
    for (var i = 0; i < Store.RECORDS.length; i++) if (Store.RECORDS[i].id === key) return Store.RECORDS[i].default;
  }
  /** The look and the sound back as they came: saved once, then each one that differed shown and told to its engine. */
  function resetLook() {
    var was = {
      theme: settings.theme, frame: settings.frame, layers: settings.layers, volume: settings.volume,
      character: settings.character, ambience: settings.ambience, ambienceLevel: settings.ambienceLevel, chime: settings.chime
    };
    // (each by its name: the settings store's check follows every settings.<name> in this file)
    settings.theme = settingDefault('theme'); settings.frame = settingDefault('frame'); settings.layers = settingDefault('layers');
    settings.volume = settingDefault('volume'); settings.character = settingDefault('character');
    settings.ambience = settingDefault('ambience'); settings.ambienceLevel = settingDefault('ambienceLevel');
    settings.chime = settingDefault('chime');
    save();
    // the look, behind one cross-fade
    if (was.theme !== settings.theme) showTheme(settings.theme, true);
    if (was.frame !== settings.frame) { $('opt-frame').checked = settings.frame; swapFrame(); }
    if (was.layers !== settings.layers) { $('opt-layers').checked = settings.layers; swapLayers(); }
    // the sound (nothing is auditioned, and the bowl is not rung)
    if (was.volume !== settings.volume) { audio.setVolume(settings.volume); showVolume(); }
    if (was.character !== settings.character) { audio.setCharacter(settings.character); showCharacter(); }
    if (was.ambience !== settings.ambience) { audio.setAmbience(settings.ambience, false); showAmbience(); }
    if (was.ambienceLevel !== settings.ambienceLevel) { audio.setAmbienceLevel(settings.ambienceLevel, false); showAmbience(); }
    if (was.chime !== settings.chime) { audio.setChimeEnabled(settings.chime); $('opt-chime').checked = settings.chime; }
  }
  if (tuneReset && resetText) {
    tuneReset.addEventListener('click', function () {
      var now = performance.now();
      if (tuneReset.getAttribute('data-state') !== 'armed') {
        tuneReset.setAttribute('data-state', 'armed');
        resetText.textContent = RESET_SURE;
        resetArmedAt = now;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(resetDisarm, RESET_MS);
        buzz(8);
        return;
      }
      if (now - resetArmedAt < RESET_DOUBLE_MS) return;   // the second half of a double tap: not an answer
      resetLook();
      buzz(12);
      resetDisarm();
      toast('Look and sound put back');
    });
  }

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
      var ms = customMs(), set = $('custom-set');
      $('custom-preview').textContent = fmt(ms)[0] +
        (draft.rest ? ', rest ' + draft.rest + (draft.rounds > 1 ? ', ×' + draft.rounds : '') : '');
      // (read aloud: "Set 25 minutes, then rest 5 minutes, 4 rounds")
      if (draft.rest) set.setAttribute('aria-label', 'Set ' + seqSpoken(ms, draft.rest * 60000, draft.rounds));
      else set.removeAttribute('aria-label');
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
  // then rest: the dial's time, a rest after it, and the pair repeated (see "Work and rest")
  var draft = { rest: 0, rounds: 1 };                   // as set in the sheet: minutes of rest (0: off), rounds
  var DRAFT_LIM = { rest: [0, 60], rounds: [1, 12] };
  function showDraft() {
    $('rest-out').textContent = draft.rest ? draft.rest + ' min' : 'Off';
    $('rest-out').classList.toggle('off', !draft.rest);
    $('rounds-out').textContent = draft.rounds;
    $('seq-hint').hidden = draft.rest > 0;              // Rounds takes the hint's place: nothing in the sheet moves
    $('rounds-row').hidden = !draft.rest;
    var b = document.querySelectorAll('#seq button');
    for (var i = 0; i < b.length; i++) {
      var p = b[i].dataset.seq.split(':');
      b[i].setAttribute('aria-disabled', draft[p[0]] === DRAFT_LIM[p[0]][+p[1] < 0 ? 0 : 1] ? 'true' : 'false');
    }
    previewCustom();
  }
  function stepDraft(b) {
    var p = b.dataset.seq.split(':'), lim = DRAFT_LIM[p[0]];
    draft[p[0]] = Math.max(lim[0], Math.min(lim[1], draft[p[0]] + +p[1]));
    showDraft();
  }
  // a tap steps once; held, a stepper runs on
  var stepTimer = 0, stepRan = false;
  $('seq').addEventListener('pointerdown', function (e) {
    var b = e.target.closest('button');
    clearTimeout(stepTimer);
    stepRan = false;
    if (!b || e.button) return;
    stepTimer = setTimeout(function run() { stepRan = true; stepDraft(b); stepTimer = setTimeout(run, 110); }, 450);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    $('seq').addEventListener(t, function () { clearTimeout(stepTimer); });
  });
  $('seq').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || stepRan) { stepRan = false; return; }     // (the click that ends a hold steps no further)
    stepDraft(b);
    buzz(6);
  });
  function openCustom(opener) {
    openSheet(sheetCustom, opener);
    var total = Math.round(T.durationMs / 1000);
    setWheel(wheelMin, Math.min(99, Math.floor(total / 60)), false);
    setWheel(wheelSec, total % 60, false);
    draft.rest = Math.round(seq.rest / 60000);
    draft.rounds = seq.rounds;
    showDraft();
  }
  $('custom-set').addEventListener('click', function () {
    var raw = (wheelValue(wheelMin) * 60 + wheelValue(wheelSec)) * 1000;
    if (raw < 10000) toast('Shortest glass is 10 seconds');
    closeSheet();
    setDuration(customMs(), draft.rest * 60000, draft.rounds);
    buzz(12);
  });

  /* ---- keyboard ----------------------------------------------------- */
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { if (sheetOpen) closeSheet(); else setZen(false); return; }
    var tag = e.target && e.target.tagName;
    if (sheetOpen || tag === 'INPUT' || tag === 'BUTTON') return;
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
    if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault();   // (a scroll already under way cannot be stopped: let it be)
  }, { passive: false });

  /* ======================================================================
   *  Reduce Motion
   *
   *  The same glass, gentler: let go, it glides home without a fall or a
   *  sway, a turn never spins on, the phone's shaking is halved and capped
   *  below what lifts the bed (and cannot crack the glass), and nothing
   *  flashes. What a finger does to the glass still counts: knocked, spun
   *  hard or banged on the desk it creaks and cracks as ever.
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
    if (realEng) realEng.setHidden(document.hidden);   // Real sand: no GPU work while hidden (catch-up on return)
    if (document.hidden) realAway = true;              // (a start that fails meanwhile is tried again in view)
    else realWatchFrom(performance.now());             // (the watchdog counts only time in view)
    if (document.hidden) endSweep();     // (a glass being made new is made at once)
    if (!document.hidden) back = true;   // before tickClock: an end found on return is not held
    tickClock();
    if (document.hidden) {
      backgroundHold();
      pourEnd();
      cancelGesture();                 // a hand on the glass lets go
      saveSession();
    } else {
      lastFrame = performance.now(); acc = 0; dirty = true;
      motion.reset();                  // stale sensor history is not felt on return
    }
    breathStep(true);                  // away: no timers; back: the breath the clock says it is
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
   *  Real sand (Tune: on by default)
   *
   *  The sand simulated on the graphics chip, the sand lab's engine
   *  (realsand/), with an exact neck. It is the default from 1.10.0
   *  (settings design 5); with the switch off nothing of it is loaded and
   *  the app runs the classic sand, as it was. With it on, and where WebGPU
   *  exists, the page loads realsand/boot.mjs, which hands this script the
   *  engine's class and build stamp (attachRealSand). The CPU sand runs,
   *  and shows, while the engine starts (a cold start in a home-screen web
   *  app took 3.4 s on the owner's iPhone), and a slow start is never a
   *  failure; the dark opening waits up to 1 s for the engine's first frame
   *  (holdVeil, at Boot). Once the engine has drawn its first frame it
   *  takes over between two frames (handover): `sim` becomes the GPU sand,
   *  which has every member of the CPU Sim this script uses, and the two
   *  canvases cross-fade. Any failure gives the CPU sand back in the same
   *  frame, the clock untouched. The switch is the owner's alone: this
   *  script never turns it off, and never disables it.
   *    - no WebGPU at all: "Needs WebGPU", found at every launch for
   *      nothing; nothing is stored;
   *    - WebGPU, but no adapter or only a software one (found by loading
   *      the engine): "Needs WebGPU" (or too slow), and this browser's user
   *      agent is kept (realSandNa); while it is the same, a launch says so
   *      without loading anything. Another user agent (an iOS update, if it
   *      changes it), seven days gone by, or a tap on the row: tried again.
   *      One that came while the page was put away is not believed: it is
   *      tried again once the page is in view. One that comes after the
   *      chip was reset, lost or stopped answering in this session is not
   *      kept either (the chip may only be on its way back): the CPU sand
   *      for the session, and the next launch tries again;
   *    - anything else at start: the CPU sand this session, the setting
   *      kept, the note says why; the next launch tries again, and after
   *      three launches in a row that failed it stops trying;
   *    - hidden, or the graphics chip reset, while it started: again once
   *      the page is in view (iOS keeps a home-screen app alive for days,
   *      so "the next launch" can be far off);
   *    - an engine build other than the one these were found with
   *      (realSandBuild): they are forgotten, and it tries again;
   *    - a build stamp other than this script's: a mix of old and new
   *      files in the cache, the CPU sand until the next launch;
   *    - the graphics chip lost while running: the engine has brought the
   *      CPU Sim to its counts; the CPU sand takes over in this frame, and
   *      the engine comes back on its own (onBack) unless it was the second
   *      such loss within ten minutes;
   *    - the graphics chip no longer answering while the sand runs in view
   *      (the watchdog, below): the same, done by this script, with a new
   *      engine after 2 s, and a third time within ten minutes is final.
   *  ?offscreen=1 is for the tests only: the engine draws into a texture
   *  shown on a 2-D canvas and takes a software adapter (a headless
   *  browser's WebGPU canvas cannot be read back). ?debug=sand shows the
   *  engine's figures for the owner's reports.
   * ==================================================================== */
  var REALSAND_BUILD = '7';          // the engine's stamp this script was written for (realsand/build.mjs)
  var REAL_TEST = /[?&]offscreen=1(?:&|$)/.test(location.search);
  var realEng = null;                // the engine: starting, live (then real === realEng), lost or rebuilding
  var realCls = null, realAttached = false, realDue = false, realRetries = 0, realState = 'off';
  var realAway = false;              // the page was put away since this start began
  var realShaky = false;             // this session saw the chip reset, lost or not answering: "no adapter" may then be the chip on its way back
  var realStopped = null;            // the engine the watchdog stopped, kept 600 ms for the cross-fade: nothing it still says is heard
  var REAL_NA_MS = 7 * 86400000;     // how long "this browser cannot have it" is believed without another try
  var realLogLines = [];
  var optReal = $('opt-realsand'), realNote = $('realsand-note'), realRow = $('realsand-row');
  var grainRow = $('grain-row'), grainChoice = $('grains') && $('grains').parentNode, tiltCrack = $('tilt-crack');
  var REAL_WHY = {
    nogpu: 'Needs WebGPU (iOS 26 or later)', noadapter: 'Needs WebGPU (iOS 26 or later)',
    fallback: 'This device\'s graphics are too slow for Real sand',
    device: 'the graphics chip could not be opened', load: 'the sand engine could not be loaded',
    compile: 'the sand engine could not be built on this device', selftest: 'its self-test failed',
    lost: 'the graphics chip was reset', hidden: 'the app was put away as it started',
    hang: 'the graphics chip stopped answering'
  };
  function realLog(s) {
    realLogLines.push(Math.round(performance.now()) + ' ' + s);
    if (realLogLines.length > 200) realLogLines.splice(0, realLogLines.length - 200);
    if (dbgSand) try { console.info(s); } catch (e) {}
  }
  function realReason(e) {
    return REAL_WHY[e && e.code] || 'an error (' + String(e && e.message || e).slice(0, 80) + ')';
  }
  /**
   * The switch, its note and the row's state (design 11; settings design 5.2, 5.5). The row's
   * data-state is the bare state ('on', 'starting', 'off', 'na', 'failed', 'gaveup', 'updating',
   * 'lost', 'paused'). In 'na' the switch shows off and stays live: a tap tries again. Grain and
   * the crack sentence of Real motion are the classic sand's: shown only while it is the sand
   * that runs, or will run for the session.
   */
  function showReal(state, why) {
    realState = state;
    var na = state === 'na';
    optReal.checked = !na && settings.realSand;
    realRow.setAttribute('data-state', state);
    realNote.textContent =
      na ? why + '. Tap to try again' :
      state === 'starting' ? 'Starting…' :
      state === 'on' ? 'On: every grain simulated on the graphics chip' :
      state === 'failed' ? 'Could not start this time: ' + why + '. It will try again next launch' :
      state === 'gaveup' ? 'Did not start 3 times: ' + why + '. Turn it off and on to try again' :
      state === 'updating' ? 'Real sand is updating; it will be back at the next launch' :
      state === 'lost' ? 'Real sand paused: ' + (why || REAL_WHY.lost) :
      state === 'paused' ? why :
      'Off: the classic sand';
    var gpu = settings.realSand && (state === 'on' || state === 'starting' || state === 'lost');
    if (grainRow) grainRow.hidden = gpu;
    if (grainChoice) grainChoice.hidden = gpu;
    if (tiltCrack) tiltCrack.hidden = gpu;
    showReportLink(settings.realSand && !na);
  }
  /**
   * With the switch on, the row has a link that copies the report (realReport). A web app on the
   * home screen keeps its own storage and opens at its own address, so ?debug=sand never reaches
   * it, and that is where the owner uses the app (and where Gate A found the slow start).
   */
  var realReportEl = null;
  function showReportLink(on) {
    if (!on) { if (realReportEl) realReportEl.hidden = true; return; }
    if (!realReportEl) {
      realReportEl = document.createElement('a');
      realReportEl.id = 'realsand-report';
      realReportEl.href = '#';
      realReportEl.textContent = 'Copy a report';
      // (inside the switch's label: the link copies, it does not turn the switch)
      realReportEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); copyReport(); });
      realNote.parentNode.insertBefore(realReportEl, realNote.nextSibling);
    }
    realReportEl.hidden = false;
  }
  /** The report to the clipboard, and a toast that says whether it went. */
  function copyReport() {
    var txt = realReport();
    var done = function () { toast('Copied'); };
    var byHand = function () {
      // (no Clipboard API, or it refused: the old way, from a selected text field)
      var ok = false, ta = document.createElement('textarea');
      ta.value = txt; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      try { ta.select(); ta.setSelectionRange(0, txt.length); ok = document.execCommand('copy'); } catch (x) {}
      document.body.removeChild(ta);
      toast(ok ? 'Copied' : 'Could not copy');
    };
    try { navigator.clipboard.writeText(txt).then(done, byHand); } catch (x) { byHand(); }
  }
  /** At boot: whether to load the engine (only then is anything under realsand/ requested). */
  function loadRealSand() {
    // another engine build: what this device was found unable to do with the last one is
    // forgotten, and it tries again (settings design 5.1)
    if (settings.realSandBuild !== REALSAND_BUILD) {
      settings.realSandFails = 0; settings.realSandWhy = ''; settings.realSandNa = ''; settings.realSandNaAt = 0;
      settings.realSandBuild = REALSAND_BUILD;
      save();
    }
    if (!('gpu' in navigator)) { showReal('na', REAL_WHY.nogpu); return; }   // (nothing stored: found again at no cost)
    if (!settings.realSand) { showReal('off'); return; }
    if (settings.realSandNa) {
      var naAge = Date.now() - settings.realSandNaAt;
      if (settings.realSandNa === navigator.userAgent && naAge >= 0 && naAge < REAL_NA_MS) {
        showReal('na', settings.realSandWhy || REAL_WHY.noadapter);
        return;
      }
      // another browser than the one that could not have it (an iOS update, if it changes the
      // user agent), or found seven days ago or more: tried again
      settings.realSandNa = ''; settings.realSandNaAt = 0; settings.realSandWhy = ''; save();
    }
    if ((settings.realSandFails | 0) >= 3) { showReal('gaveup', settings.realSandWhy || REAL_WHY.load); return; }
    showReal('starting');
    realAway = document.hidden;
    var el = document.createElement('script');
    el.type = 'module';
    el.src = './realsand/boot.mjs';
    var failed = function (msg) {
      if (realAttached) return;
      realAttached = true;
      var e = new Error(msg); e.code = 'load';
      realFail(e);
    };
    el.addEventListener('error', function () { failed('The sand engine could not be loaded'); });
    // (a module that loaded but failed as it ran fires 'load' without having called attachRealSand)
    el.addEventListener('load', function () { failed('The sand engine did not start'); });
    document.head.appendChild(el);
  }
  /** boot.mjs: the engine's class and its build stamp. */
  function attachRealSand(Cls, build) {
    if (realAttached || !settings.realSand || typeof Cls !== 'function') return false;
    realAttached = true;
    if (String(build) !== REALSAND_BUILD) {
      realLog('Real sand: the engine is build ' + build + ', this page was written for ' + REALSAND_BUILD + ': a mix of old and new files');
      showReal('updating');
      return false;
    }
    realCls = Cls;
    startReal();
    return true;
  }
  /** The engine made, started (device, pipelines, self-test) and given the CPU sand; then handed over. */
  function startReal() {
    var eng = null;
    showReal('starting');
    Promise.resolve().then(function () {
      return realCls.create({
        P: P, cpuSim: cpuSim, renderer: renderer, rotor: rotor, cSand: $('c-sand'), timer: T,
        offscreen: REAL_TEST, allowFallback: REAL_TEST, log: realLog,
        // (heard only from the engine in use: one the watchdog stopped still lives, to itself, until
        // it is destroyed, and may lose its device meanwhile)
        onLost: function (info) { if (eng && eng === realEng && eng !== realStopped) onRealLost(info); },
        onBack: function () { if (eng && eng === realEng && eng !== realStopped) onRealBack(); }
      });
    }).then(function (e) {
      eng = realEng = e;
      return eng.start();
    }).then(function () {
      return eng.adopt();
    }).then(function () {
      if (eng !== realEng) return;
      realDue = true;                // the next frame hands the sand over (once a Reset's sweep is done)
      dirty = true;
    }).catch(function (e) {
      if (!eng || eng === realEng) realFail(e);
    });
  }
  /** A start again (after a start cut short, or the watchdog), once nothing of the last one is left. */
  function startAgain() {
    if (realEng || real || !settings.realSand || !realCls) return;
    realAway = document.hidden;
    startReal();
  }
  function whenVisible(fn) {
    if (!document.hidden) { fn(); return; }
    var on = function () {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', on);
      fn();
    };
    document.addEventListener('visibilitychange', on);
  }
  /** The engine did not start (design 10.1). */
  function realFail(e) {
    var code = (e && e.code) || 'error', why = realReason(e);
    realLog('Real sand did not start (' + code + '): ' + (e && e.message || e));
    if (code === 'lost') realShaky = true;
    if (realEng) { try { realEng.destroy(); } catch (x) {} realEng = null; }
    realDue = false;
    // the engine's shaders are of another build than its modules: an update is on its way (not counted)
    if (code === 'stamp') { showReal('updating'); return; }
    // a file of the engine that could not be had with no connection (a hole in the offline copy)
    // is not counted: three such launches would end the tries, and an app that no longer asks for
    // the engine never lets the worker see the hole and fill it
    if (code === 'load' && navigator.onLine === false) { showReal('failed', why); return; }
    // (a capability found missing while the page was put away is not believed: iOS may refuse an
    // adapter to a page in the background; it is tried again in view, as a start cut short)
    if (e && e.capability && realAway && realCls && realRetries < 3) code = 'hidden';
    else if (e && e.capability && (realShaky || realAway)) {
      // (found after the chip was reset, lost or stopped answering in this session, or in a page
      // put away with its retries used up: the chip may only be on its way back, so it is neither
      // remembered nor counted; the CPU sand for the session, and the next launch tries again)
      showReal('paused', 'Real sand could not restart; it will try again next launch');
      return;
    }
    else if (e && e.capability) {
      // this browser cannot have it: remembered by its user agent, the switch left on (settings design 5.2)
      settings.realSandNa = navigator.userAgent; settings.realSandNaAt = Date.now();
      settings.realSandWhy = why; settings.realSandFails = 0;
      save();
      showReal('na', why);
      return;
    }
    if ((code === 'hidden' || code === 'lost') && realCls && realRetries < 3) {
      realRetries++;
      showReal('starting');
      whenVisible(function () { setTimeout(startAgain, 1000); });
      return;
    }
    settings.realSandFails = (settings.realSandFails | 0) + 1;
    settings.realSandWhy = why;
    save();
    showReal(settings.realSandFails >= 3 ? 'gaveup' : 'failed', why);
  }
  /**
   * Between two frames, the sand changes hands (design 7.8). To the GPU: the engine takes the
   * CPU Sim's angle, tilt and turn (and fills again if the CPU sand was poured, turned or made
   * new while it settled); grains the CPU let through meanwhile leave through the valve. To the
   * CPU: the engine has brought the CPU Sim to its counts already, the clock is not touched.
   */
  function handover(to) {
    if (to === 'gpu') {
      realDue = false;
      // (ready: drawn and not lost; a loss since adopt() or onBack() leaves it to the rebuild's onBack)
      if (!realEng || real || realEng.destroyed || !realEng.ready) return;
      try { realEng.takeOver(); } catch (e) {
        var x = new Error('The sand could not be handed over: ' + (e && e.message || e)); x.code = 'error';
        realFail(x);
        return;
      }
      real = sim = realEng;
      app.classList.add('real');     // #c-gpu fades in over the CPU sand's canvas (styles.css)
      if (settings.realSandFails || settings.realSandWhy) { settings.realSandFails = 0; settings.realSandWhy = ''; save(); }
      realRetries = 0;               // (the retries are a start's own: a session can have many starts, days apart)
      realWatchFrom(performance.now());
      showReal('on');
    } else {
      if (!real) return;
      real = null;
      sim = cpuSim;
      app.classList.remove('real');
    }
    dirty = true;
  }
  /** The graphics chip is gone (design 7.9), or no longer answers (the watchdog: info.why). */
  function onRealLost(info) {
    info = info || {};
    var was = !!real;
    realShaky = true;
    realDue = false;                 // (an adopt or a rebuild that finished before the loss hands nothing over)
    handover('cpu');
    if (info.final) showReal('paused', info.message || REAL_WHY.lost);
    else if (info.lifecycle) showReal('starting');
    else showReal('lost', info.why);
    if (was && !info.lifecycle && info.message && !document.hidden) toast(info.message, 3200);
  }
  function onRealBack() { realDue = true; dirty = true; }

  /*
   * The watchdog (settings design 5.4, kept in this script: the engine's files are not changed).
   * A graphics chip that stops answering without losing its device leaves every readback slot
   * waiting: every frame is then skipped and the picture freezes while the clock runs on, and
   * nothing in the engine sees it (its own rule counts runs, and none is made then). So, while
   * the GPU sand is the sim, the page in view and drawing, and the engine awake (an idle, paused
   * or finished glass whose sand is still sleeps and reads nothing back), no readback for 4 s of
   * wall-clock time is taken as the chip being lost: the engine's ledger to the CPU Sim, the CPU
   * sand in this frame with the clock untouched, the toast, and a new engine after 2 s. A third
   * time within ten minutes, the CPU sand for the rest of the session.
   */
  var REAL_HANG_MS = 4000, REAL_HANG_FINAL = 3, REAL_HANG_WINDOW_MS = 600000;
  var realWatch = { at: 0, reads: -1, since: 0 }, realHangs = [];
  /** The watchdog's clock from now (a handover, the page back in view, frames not drawn). */
  function realWatchFrom(now) { realWatch.at = now; realWatch.since = now; realWatch.reads = -1; }
  /** Every frame while the GPU sand is the sim (dtMs: since the frame before). */
  function watchReal(dtMs) {
    var now = performance.now(), W = realWatch;
    if (!real || real !== realEng) return;
    if (document.hidden || dtMs > 1000 || now - W.at > 1000) { realWatchFrom(now); return; }
    if (now - W.at < 250) return;
    W.at = now;
    var st = null;
    try { st = realEng.stats(); } catch (e) { realWatchFrom(now); return; }
    var reads = st && st.ledger ? st.ledger.readbacks : null;
    // (a count of readbacks it cannot read: nothing to judge by)
    if (typeof reads !== 'number' || reads !== W.reads || st.mode === 'asleep') { W.reads = reads; W.since = now; return; }
    if (now - W.since >= REAL_HANG_MS) realHang(now);
  }
  /** The GPU sand no longer answers: the CPU sand now, a new engine after 2 s (or not, a third time). */
  function realHang(now) {
    realHangs = realHangs.filter(function (t) { return now - t < REAL_HANG_WINDOW_MS; });
    realHangs.push(now);
    var final = realHangs.length >= REAL_HANG_FINAL;
    realLog('Real sand: no readback for ' + REAL_HANG_MS / 1000 + ' s while it ran in view: the watchdog gives the sand to the CPU' +
      (final ? ' (the third time in ten minutes: final)' : ''));
    try { realEng.syncCpu(); } catch (e) { realLog('Real sand: ' + (e && e.message || e)); }   // the CPU Sim at the ledger's counts
    var stopped = realStopped = realEng;
    onRealLost({ reason: 'watchdog', lifecycle: false, final: final, why: REAL_WHY.hang,
      message: final ? 'Real sand paused: the graphics chip stopped answering three times; it will try again next launch'
        : 'Real sand paused: the graphics chip stopped answering' });
    // the stopped engine goes once the CPU sand's canvas has faded in over its picture
    setTimeout(function () {
      if (realEng === stopped) { try { stopped.destroy(); } catch (e) {} realEng = null; }
      if (realStopped === stopped) realStopped = null;
    }, 600);
    if (!final) setTimeout(function () { whenVisible(startAgain); }, 2000);
  }
  optReal.addEventListener('change', function (e) {
    // on or off, the page is built afresh, as for another grain; the running time is kept. Not
    // available ('na', the switch shown off): a tap is a try again, what was remembered forgotten.
    settings.realSand = e.target.checked;
    settings.realSandFails = 0; settings.realSandWhy = ''; settings.realSandNa = ''; settings.realSandNaAt = 0;
    save();
    saveSession();
    app.classList.add('regrain');
    setTimeout(function () { location.reload(); }, 320);
  });
  /* ---- ?debug=sand: the engine's figures, for the owner's reports ------ */
  var dbgSand = /[?&]debug=sand(?:&|$)/.test(location.search) ? { el: null, text: null, at: 0 } : null;
  if (dbgSand) {
    dbgSand.el = document.createElement('div');
    dbgSand.el.id = 'debug-sand';
    dbgSand.el.setAttribute('aria-hidden', 'true');
    dbgSand.el.style.cssText = 'position:fixed;left:6px;bottom:calc(env(safe-area-inset-bottom, 0px) + 4px);z-index:30;' +
      'font:10px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#fff;opacity:0.55;pointer-events:none;white-space:pre';
    dbgSand.text = document.createElement('div');
    var copy = document.createElement('a');
    copy.textContent = 'copy the report';
    copy.style.cssText = 'display:inline-block;pointer-events:auto;color:#fff;text-decoration:underline;padding:4px 0';
    copy.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      copyReport();
    });
    dbgSand.el.appendChild(dbgSand.text);
    dbgSand.el.appendChild(copy);
    app.appendChild(dbgSand.el);
  }
  /** Everything the owner's report needs: the device, the switch, the engine's figures and its log. */
  function realReport() {
    var st = null;
    try { st = realEng ? realEng.stats() : null; } catch (e) { st = String(e); }
    return JSON.stringify({
      at: new Date().toISOString(), ua: navigator.userAgent, standalone: !!navigator.standalone ||
        !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
      build: REALSAND_BUILD, setting: settings.realSand, state: realState, note: realNote.textContent, live: !!real,
      watchdog: realHangs.length, na: !!settings.realSandNa,
      timer: { state: T.state, rem: Math.round(T.rem), durationMs: T.durationMs, total: sim.total, top: sim.nTop },
      stats: st, log: realLogLines
    }, null, 1);
  }
  function updateSandDebug(now) {
    if (now - dbgSand.at < 500) return;
    dbgSand.at = now;
    var st = null;
    try { st = realEng ? realEng.stats() : null; } catch (e) { st = null; }
    if (!st) { dbgSand.text.textContent = 'Real sand: ' + realState + (real ? '' : ' (CPU sand)'); return; }
    var L = st.ledger || {}, t = st.tally || {}, F = st.fall || {}, tm = st.times || {};
    var r = function (x, d) { return x === x && x !== null && x !== undefined ? (+x).toFixed(d || 0) : '-'; };
    dbgSand.text.textContent =
      'Real sand ' + realState + (real ? '' : ' (CPU sand)') + '  build ' + st.build + '  ' + st.mode + (st.why ? ' (' + st.why + ')' : '') +
        (st.guard ? '  heat guard' : '') + '\n' +
      st.hz + ' Hz  ' + st.steps + ' steps  sim/real ' + r(st.ratio, 2) + '  display ' + r(st.display, 1) + ' ms  in flight ' + st.inflight + '\n' +
      'grains ' + L.top + ' / ' + L.total + '  points ' + st.points + '  above ' + r(t.above) + '  queue ' + r(t.queue) +
        '  refused ' + r(t.refused) + '  kv ' + r(L.kv, 1) + '\n' +
      'first fall ' + r(F.s, 2) + ' s sim, ' + r(F.wall / 1000, 2) + ' s wall' + '\n' +
      'start: device ' + r(tm.device) + ', pipelines ' + r(tm.pipelines) + ', self-test ' + r(tm.selfTest) +
        ', first frame ' + r(tm.firstFrame) + ' ms after the page began' + '\n' +
      'losses ' + st.n.losses + '  rebuilds ' + st.n.rebuilds + '  transfers ' + st.n.transfers + '  skips ' + st.n.skips;
  }

  /* ======================================================================
   *  The version line
   *
   *  The last line of Tune: the release this page is (index.html's
   *  hourglass-version) and the one installed for offline use, which the
   *  service worker answers by message. "Version 1.10.0" when the two are
   *  the same; "· offline copy not installed yet" with no worker or no
   *  answer within a second; "· update 1.11.0 ready: close and reopen" when
   *  a newer release is installed. Made by script (no markup of its own),
   *  and only where Tune's sheet is; its state is in data-state.
   * ==================================================================== */
  function versionLine() {
    var body = $('panel-sand') || (sheetSettings && sheetSettings.querySelector('.sheet-body'));
    if (!body) return;
    var meta = document.querySelector('meta[name="hourglass-version"]');
    var mine = (meta && meta.getAttribute('content')) || 'unknown';
    var line = document.createElement('p');
    line.id = 'version-line';
    line.className = 'colophon version';
    line.textContent = 'Version ' + mine;
    line.setAttribute('data-state', 'asking');
    body.appendChild(line);
    var sw = null, asked = 0;
    try { sw = navigator.serviceWorker || null; } catch (e) { /* (a browser that forbids it here) */ }
    /** [major, minor, patch] of '1.10.0', or null. */
    function parts(v) {
      var m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
      return m ? [+m[1], +m[2], +m[3]] : null;
    }
    function newer(a, b) {
      var x = parts(a), y = parts(b);
      if (!x || !y) return false;
      for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
      return false;
    }
    function show(theirs) {
      var state, text = 'Version ' + mine;
      if (!theirs) { state = 'none'; text += ' · offline copy not installed yet'; }
      else if (theirs === mine) state = 'same';
      else if (newer(theirs, mine)) { state = 'update'; text += ' · update ' + theirs + ' ready: close and reopen'; }
      else { state = 'other'; text += ' · offline copy ' + theirs; }
      line.textContent = text;
      line.setAttribute('data-state', state);
    }
    function ask() {
      var ctl = sw && sw.controller, n = ++asked;
      if (!ctl || typeof MessageChannel !== 'function') { show(null); return; }
      var ch = new MessageChannel();
      var timer = setTimeout(function () { if (n === asked) show(null); }, 1000);
      ch.port1.onmessage = function (e) {
        clearTimeout(timer);
        var v = e.data && e.data.version;
        if (n === asked) show(typeof v === 'string' ? v.replace(/^hourglass-v/, '') : null);
      };
      try { ctl.postMessage({ type: 'version' }, [ch.port2]); } catch (err) { clearTimeout(timer); show(null); }
    }
    ask();
    // a worker that takes over meanwhile (the first install, or an update) is asked again, and so
    // is the worker each time Tune is opened
    if (sw && sw.addEventListener) sw.addEventListener('controllerchange', ask);
    if (btnSettings) btnSettings.addEventListener('click', ask);
  }

  /* ======================================================================
   *  Boot
   * ==================================================================== */
  var VEIL_HOLD_MS = 1000;           // the dark opening waits this long at most for Real sand's first frame
  var veilHold = true;
  try {
    if (sessionStorage.getItem('hourglass.openNow')) { sessionStorage.removeItem('hourglass.openNow'); veilHold = false; }
  } catch (e) { /* (no session storage: held as ever) */ }
  sim.reset(grainsFor(T.durationMs));
  calibrate();
  T.rem = T.durationMs;
  var restored = restoreSession();                     // pick up where the glass was left
  audio.setCracked(crackState());                      // a cracked glass rings dull from the start
  app.classList.toggle('zen-full', settings.zenFull);
  $('opt-chime').checked = settings.chime;
  $('opt-awake').checked = settings.keepAwake;
  $('opt-frame').checked = settings.frame;
  $('opt-layers').checked = settings.layers;
  $('opt-zen').checked = settings.zenFull;
  $('opt-haptics').checked = settings.haptics;
  syncGrains();
  showVolume();
  showAmbience();
  showBreath();
  showTab(settings.tuneTab);                           // Tune will open on the tab last used
  breathLayer(settings.breath);
  setMuted(settings.muted);
  setCharacter(settings.character);
  syncPills();
  hapticMountAll();
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
    requestAnimationFrame(function () { holdVeil(performance.now()); });   // the first frame is drawn
  });
  /*
   * The dark opening (settings design 5.3, the owner's answer): while Real sand starts, the veil
   * waits up to 1 s more for the engine's first frame, so that most launches open on Real sand;
   * then, or at once if the engine is slower (the classic sand shows meanwhile), it fades up as
   * ever. A reload that should open at once (a later "Use this shape") sets sessionStorage
   * 'hourglass.openNow' before it reloads, and is not held.
   */
  function holdVeil(t0) {
    if (veilHold && realState === 'starting' && performance.now() - t0 < VEIL_HOLD_MS) {
      requestAnimationFrame(function () { holdVeil(t0); });
      return;
    }
    veil.style.opacity = getComputedStyle(veil).opacity;   // (on a slow first visit the CSS failsafe
    veil.classList.remove('boot'); void veil.offsetWidth;  //  may already be lifting it: go on from there)
    veil.classList.add('lift'); veil.style.opacity = '';
    setTimeout(function () { zoom.style.transition = ''; veil.classList.remove('lift'); }, 1500);
  }

  // Synthesise the sound beds while idle so the first touch is instant.
  if (window.requestIdleCallback) window.requestIdleCallback(function () { audio.prepare(); }, { timeout: 2500 });
  else setTimeout(function () { audio.prepare(); }, 900);

  // Offline-first PWA. Relative URL + scope so it works from any sub-path.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
    });
  }
  versionLine();

  // A small handle for the curious (and for automated tests).
  window.Hourglass = {
    renderer: renderer, audio: audio, timer: T, flip: flip, stats: S, seq: seq,
    start: start, pause: pause, toggle: toggle, reset: reset,
    flipNow: startFlip, setDuration: setDuration, setTheme: setTheme,
    topAt: topAt, remAt: remAt, grainsFor: grainsFor,
    wakeState: function () { return wakeState; }, grav: grav,
    motion: motion, body: body, room: room, spill: spill, perf: perf, breath: breath,
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
  // the sand the app runs now: the CPU Sim, or the GPU sand while Real sand runs
  Object.defineProperty(window.Hourglass, 'sim', {
    get: function () { return sim; }, enumerable: true
  });
  // Real sand: its engine (starting, live, lost; null with the switch off), and the hook boot.mjs calls
  Object.defineProperty(window.Hourglass, 'realSand', {
    get: function () { return realEng; }, enumerable: true
  });
  window.Hourglass.attachRealSand = attachRealSand;
  window.Hourglass.realSandReport = realReport;
  loadRealSand();
  Object.defineProperty(window.Hourglass.debug, 'mpg0', {
    get: function () { return T.mpg0; }, enumerable: true
  });
  // whether this frame counts the glass as just shaken (no catch-up teleports then)
  Object.defineProperty(window.Hourglass.debug, 'motionRecent', {
    get: function () { return motionRecentNow; }, enumerable: true
  });
})();
