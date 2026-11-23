/*
 * Hourglass sand lab: the page.
 *
 * A test of position-based MPM sand (Smoosh's solver, after EA's PB-MPM) in
 * the app's classic glass, driven by the phone's motion, a finger on the
 * glass, a Flip, and scripted tests; the Timer runs an app amount by the
 * app's clock through the engine's metered neck, with the app's power modes
 * (timer.mjs); the Rotor probe (?rotor=1) stacks the canvases as the app
 * will. It is not the app and changes nothing in it. Everything it needs is in this folder and in the engine's,
 * ../../realsand/ (the solver, its shaders, the glass, the palette, the
 * pace, the fills, the grains' drawing, auto Hz and the glass's felt jolts);
 * nothing is fetched from anywhere else. It registers no service
 * worker of its own; the app's service worker (sw.js, scope /hourglass/)
 * leaves lab/ to the network, answers this page's requests for realsand/
 * from the network too, and stores none of them.
 *
 * Part of the Hourglass project. License: GPL-3.0-or-later. The solver
 * (../../realsand/solver.mjs, shaders/) derives from Smoosh (MIT) and EA's
 * PB-MPM (BSD-3-Clause): see ../../realsand/LICENSES.md.
 */
import { buildGlass, sampleField, traceOutline, APP_Q } from '../../realsand/glass.mjs';
import { Solver, ShaderLibrary, createDevice, MATERIALS, PARTICLE_WORDS, dispatchesPerSubstep } from '../../realsand/solver.mjs';
import { palette } from '../../realsand/palette.mjs';
import { newPace, paceReset as paceForget, paceSkip, paceBudget, paceFrame, paceSubmit, paceDone, paceValve, QUEUE_DEFAULT } from '../../realsand/pace.mjs';
import { PPC, makeFill, packParticles } from '../../realsand/fill.mjs';
import { GrainRenderer, FLIGHT, flightOf, exposure } from '../../realsand/grains.mjs';
import * as Rate from '../../realsand/rate.mjs';
import { GlassFelt, JOLT_MODES, kneeOf } from '../../realsand/felt.mjs';
import { Valve, ALLOW_SHUT, NECK_ON } from '../../realsand/valve.mjs';
import { BUILD } from '../../realsand/build.mjs';
import { TIMERS, timerById, grainsFor, makeClock, targetAt, MODES, newModes, modesReset, chooseMode, frameMsFor, median, burstCost, gpuShare } from './timer.mjs';

const $ = id => document.getElementById(id);
const QUERY = new URLSearchParams(location.search);
const OFFSCREEN = QUERY.has('offscreen');
// the Rotor probe (?rotor=1): the grains' canvas in a turning div between two WebGL canvases
const ROTOR = QUERY.get('rotor') === '1';
// the engine's build stamp this page was written for (realsand/build.mjs; Copy results prints both)
const BUILD_EXPECTED = '6';
// the lifecycle log: visibility, device loss, start-up times (ms since the page began)
const lifeLog = [];
let lastVisibleAt = 0;
function life(kind, detail = '') {
  const t = performance.now();
  lifeLog.push({ t, kind, detail });
  if (lifeLog.length > 200) lifeLog.splice(1, 1);        // (the first entry, the start, is kept)
}
life('start', document.hidden ? 'hidden' : 'visible');
// Belt and braces (design 2.3): the service worker answers this page's requests for the engine
// from the network, so the engine here should always be the newest. Should one of another build
// reach it all the same (a stamp other than this page's), the page says so, with both stamps, in
// its status line, and Copy results prints both. It leaves the app's caches alone: the app's
// installed copy is a snapshot that only an install writes (sw.js), and a file taken out of it
// would come back only with a connection.
const STAMP_NOTE = BUILD === BUILD_EXPECTED ? '' :
  `The engine is build ${BUILD}, this page was written for build ${BUILD_EXPECTED}: a mix of old and new files. Reload with a connection.`;
if (STAMP_NOTE) {
  life('stamp', `the engine is build ${BUILD}, this page was written for ${BUILD_EXPECTED}`);
  if ($('status')) $('status').textContent = STAMP_NOTE;
}

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */
const RES = { S: 0.65, M: 0.8, L: 1.0 };              // solver cells per grain of the app's phone glass
const RES_NAME = { S: 'coarse', M: 'medium', L: 'fine' };
const AMOUNTS = { minute: 2800, quarter: 10000, full: 24000 };   // the app's grains (scale 1.08)
const AMOUNT_NAME = { minute: '1-minute', quarter: 'quarter', full: 'full' };
const APP_CAPACITY = 28099;                            // grains one bulb of the app's phone glass holds
const APP_G = 3300;                                    // physics.js: this.G, cells/s² on the app's lattice
const REAL_HEIGHT_MM = 110;                            // the glass, end to end inside, as drawn on a phone
const MM_PER_PX = 0.16;                                // app.js: an iPhone CSS px
const KPX = MM_PER_PX * 1e-3 / 9.81;                   // g per px/s² of the glass's acceleration on screen
// cap: the most substeps one frame may run, three 60 Hz frames' worth, so that a late or
// missed frame, or a 30 Hz display (Low Power Mode), does not slow the sand
const SPEED_DEFAULTS = { app: { hz: 480, iterations: 5, cap: 24 }, real: { hz: 960, iterations: 5, cap: 48 } };
// The substep rate rises while the sand moves fast (auto Hz, realsand/rate.mjs), so that it is
// not held to the clamp of maxStep cells a substep
const CYCLE = {
  hz: [240, 360, 480, 720, 960, 1440, 1920],
  iterations: [3, 4, 5, 6, 8],
  cap: [4, 8, 12, 16, 24, 32, 48, 64],
  maxStep: [1, 1.5, 2],
  coriolis: [true, false],
  auto: [true, false],
  jolts: JOLT_MODES,
  blur: [1, 0.5, 0],
  spread: [true, false],
  yieldIn: [false, true],
  queue: [1, 2, 3],
  budget: [true, false],
  mode: ['full', 'auto', 'calm']
};
// the jolts button's names, and what the report says of each
const JOLT_LABEL = { live: 'live', slowmo: 'slow motion', film: 'film (as before)', plain: 'plain' };
const JOLT_SAYS = { live: 'live (beyond the friction at the film\'s speed, at once)', slowmo: 'a lone jolt played slowed like a film, live while shaken',
  film: 'played slowed like a film (as before: up to 0.5 s late)', plain: 'plain' };
const FLIP_S = 1.2;
const GATE_S = 0.5;                                    // the neck stays closed this long after a Reset
const BODY = { fw: 30, fz: 0.85, hw: 7, hz: 0.6 };     // app.js: the finger's hold, and home
// The GPU's pace in the frame loop (pace.mjs): a frame is submitted only when fewer than S.queue
// frames of GPU work are still in flight, and its substeps (the budget) are cut when frames had
// to be skipped for want of the GPU and raised while it keeps up: when the GPU cannot keep up the
// sand runs slower than real time, rather than the work queueing up and what is on screen
// trailing the phone (an iPhone at 5cc11b3 on medium, quarter: 350 to 730 ms behind, 3 frames of
// work queued). Auto Hz rises only as far as that budget allows (rate.held says when it is held).
// GPU_SHARE: the most of the GPU the first-load setup lets a setup use at its peak rate.
const GPU_SHARE = 0.75;

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */
// The page's default grid and amount. Measured on the owner's iPhone (iOS 26.5, 5cc11b3): medium
// grid, quarter glass ran 8 frames a second at 0.39 of real time, 350 to 730 ms behind; the
// 1-minute amounts (coarse and medium) held real time at app speed, 30 frames a second, 31 ms
// from submit to done; coarse, 1 minute was the only setup that also held real speed (0.97).
// Coarse is the grid the sand's realism is judged on (the scoreboard, the lab test).
const DEFAULT_SETUP = { res: 'S', amount: 'minute' };
const S = {
  res: DEFAULT_SETUP.res, amount: DEFAULT_SETUP.amount, material: 'coarse', speed: 'app', input: 'upright', hud: true,
  hz: 480, iterations: 5, cap: 24, maxStep: 1, coriolis: true, neckMin: 5.5, auto: true,
  // how the glass's motion is played to the sand at app speed (felt.mjs): 'live' (the default),
  // 'slowmo' (a lone jolt as a slowed film), 'film' (the slowed film throughout, as before), 'plain'
  jolts: JOLT_MODES[0],
  // motion blur: a grain is drawn as the streak it makes in this many display frames; 0: off
  blur: 1,
  // true: every grain streaks, a bed moving as a whole too (the drawing before the crowding rule)
  blurAll: false,
  // sand's spread pass (2 dispatches a substep, and its grid's clear folded into prepare): crowded points step apart inside a cell
  spread: true,
  // sand yields inside the solver's iterations (solver.mjs yieldLoop); off by default
  yieldIn: false,
  // frames of GPU work allowed in flight (2; 5cc11b3 allowed 3), and the substeps of a frame held
  // by the GPU's back-pressure (on; pace.mjs); queue 3 with budget off is the old pace (a test's control)
  queue: QUEUE_DEFAULT, budget: true,
  // a fixed ceiling on auto Hz (0: none; the tests set it to step the sand as a phone's budget holds it)
  hzMax: 0,
  // the power mode (timer.mjs): 'full' (every display frame, auto Hz: the lab as it was), 'calm'
  // (30 frames a second at the same substep rate, auto Hz off), 'auto' (the app's rules: full,
  // calm or asleep as the glass needs, with the heat guard). A Timer starts in 'auto' unless the
  // mode was chosen by hand.
  mode: 'full', modeChosen: false
};
// the substep rate in use (S.hz, raised by auto Hz while the sand is fast), and its history (rate.mjs)
const rate = Rate.newRate(480);
// the GPU's pace (pace.mjs): frames in flight, the substeps a frame may run (budget), the last
// frames' substeps and submit-to-done times (for the HUD and the report only)
const pace = newPace();
function paceReset() { paceForget(pace); }
// the glass's linear acceleration as the sand feels it: smoothed, and at app speed played to the
// sand as S.jolts says (felt.mjs; live by default), with the knee of the material
const felt = new GlassFelt();
let gpu = null, solver = null, renderer = null, glass = null;
const glassCache = new Map();
let simTime = 0, gateUntil = 0, manual = false, busy = false, hidden = document.hidden;
let lastTally = null, lastField = { gravity: [0, -1], omega: 0, alpha: 0 };
let fillCount = 0, flowRec = null, benchRun = null, flowResult = null, benchRows = [];
const flowResults = [];           // every flow test of this visit, for the report
let scriptInput = null;           // __lab.setInput({ mode: 'manual', ... })
let fingerScript = null;          // __lab.drag(...)
const pose = { x: 0, y: 0, vx: 0, vy: 0, theta: 0, omega: 0, alpha: 0, ax: 0, ay: 0 };
const flip = { active: false, t0: 0, from: 0, to: 0 };
const finger = { down: false, id: -1, x: 0, y: 0, ox: 0, oy: 0 };
const view = { W: 1, H: 1, dpr: 1, hx: 0, hy: 0, k: 1 };
const frames = [];                // frames drawn (submitted): { t, dt, work, steps, sim, real, capped } over the last few seconds
const skips = [];                 // { t }: animation frames skipped because the GPU was still busy
const gpuLog = [];                // { t, ms }: from a frame's submit until the GPU has finished it (simulation and drawing)
const clampLog = [];              // { t, n }
let behindS = 0;
let startError = '', lostReason = '';
// the live loop's per-frame readbacks (the tally): counted, so a browser where
// they fail says so in the HUD and in Copy results instead of reading "none"
let readbackOk = 0, readbackFails = 0, readbackErr = '', readbackWarned = false;
// the power mode's state (timer.mjs chooseMode), and the glass's felt motion at the last substep
const modes = newModes();
let feltNow = { a: 0, w: 0, alpha: 0, lean: 0 };
// the hardest felt since the power mode was last chosen (a jolt between two frames wakes the glass)
let feltPeak = 0;
let sleptFrames = 0, calmFrames = 0;
// the GPU's cost by a burst (design 9.3), each measured this visit
const bursts = [];
// the last fill's data, for a burst's restore
let lastFill = null;

/** A material's parameters, with the settings' override for the one in use (the tests' hook). */
const matNow = (id = S.material) => S.override && id === S.material ? { ...MATERIALS[id], ...S.override } : MATERIALS[id];
const set = () => {
  let m = matNow();
  if (!S.spread && m.spread) m = { ...m, spread: 0 };
  if (S.yieldIn && m.model === 2) m = { ...m, yieldLoop: 1 };
  return { hz: rate.hz, iterations: S.iterations, maxStep: S.maxStep, coriolis: S.coriolis, material: m };
};

/** True g in solver cells/s², for a glass 11 cm tall (the brief's 10 to 12 cm; a phone draws it smaller, see drawnMM). */
function gReal() { return glass ? 9810 / (REAL_HEIGHT_MM / (2 * glass.HBc)) : 1; }
/** How tall the glass is drawn, inside, mm (app.js: MM_PER_PX). */
function drawnMM() { return glass ? 2 * glass.HBc * view.k * MM_PER_PX : 0; }
/** Gravity in solver cells/s²: the app's slow-motion pull, or true g. */
function gCells() {
  if (!glass) return 1;
  return (S.gScale || 1) * (S.speed === 'app' ? APP_G * glass.s : gReal());
}

/* ------------------------------------------------------------------ *
 *  Real motion: DeviceMotion, as the sand would feel it
 *  (sign handling after motion.js: WebKit reports accelerationIncludingGravity
 *  negated; the sign is learnt from deviceorientation, or from the phone
 *  being held upright, with WebKit's as the prior on iOS)
 * ------------------------------------------------------------------ */
const motion = {
  on: false, seen: false, sign: 0, votes: 0, voteSum: 0, unit: 0, ubuf: [],
  gx: 0, gy: 1, w: 0, a: 0, wPrev: 0, tPrev: -1, lx: 0, ly: 0, hasLin: false,
  // the in-plane turning rate: which of rotationRate's alpha, beta, gamma carries it, and its sign
  // (the spec puts it in alpha; WebKit on iOS fills alpha, beta, gamma from the x, y, z rates, so
  // there it is gamma), learnt by correlation with the turning of gravity on the screen
  rAxis: '', rSign: 1, rLearnt: false, rStats: null,
  dn: null, dnT: -1, heading: NaN, hT: -1, hRate: 0, lp: false
};
const R_AXES = ['alpha', 'beta', 'gamma'];
function rotationPrior() { return iosLike() ? 'gamma' : 'alpha'; }
const DEAD_G = 0.06;               // g: the dead zone of the pull in the screen's plane
function iosLike() {
  const n = navigator, ua = n.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
}
function screenAngle() {
  const o = window.orientation;
  if (typeof o === 'number') return o;
  const so = screen.orientation;
  return so && typeof so.angle === 'number' ? so.angle : 0;
}
/** Device screen frame (x right, y down) to the page, for screen angle o (motion.js toPage). */
function toPage(x, y, o) {
  if (o === 90) return [y, -x];
  if (o === -90 || o === 270) return [-y, x];
  if (o === 180) return [-x, -y];
  return [x, y];
}
function onOrient(e) {
  if (!Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
  const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
  const cb = Math.cos(b);
  motion.dn = [cb * Math.sin(g), -Math.sin(b), -cb * Math.cos(g)];   // "down", device axes
  motion.dnT = performance.now();
}
function onMotion(e) {
  if (document.hidden) return;
  const IG = e.accelerationIncludingGravity, R = e.rotationRate;
  if (!IG || !Number.isFinite(IG.x) || !Number.isFinite(IG.y) || !Number.isFinite(IG.z)) return;
  const t = performance.now();
  const dt = motion.tPrev > 0 ? Math.min(0.1, Math.max(0.004, (t - motion.tPrev) / 1000)) : 1 / 60;
  motion.tPrev = t;
  motion.seen = true;
  let m = Math.hypot(IG.x, IG.y, IG.z);
  // units: m/s² (|aIG| about 9.8 at rest) or, on a few devices, g
  if (!motion.unit && m > 0.3) {
    motion.ubuf.push(m);
    if (motion.ubuf.length >= 8) { const u = motion.ubuf.slice().sort((p, q) => p - q); motion.unit = (u[3] + u[4]) / 2 < 3 ? 9.80665 : 1; }
  }
  const K = (motion.unit || (m < 3 ? 9.80665 : 1)) / 9.80665;     // to g
  const ax = IG.x * K, ay = IG.y * K, az = IG.z * K;
  m *= K;
  // sign: vote while the phone is still
  if (!motion.locked && Math.abs(m - 1) < 0.12) {
    let vote = 0;
    if (motion.dn && t - motion.dnT < 150) {
      const d = (ax * motion.dn[0] + ay * motion.dn[1] + az * motion.dn[2]) / m;
      vote = d < -0.8 ? 1 : (d > 0.8 ? -1 : 0);              // W3C: aIG points up; WebKit: down
    } else {
      const o = screenAngle();
      const up = o === 90 ? [-1, 0] : (o === -90 || o === 270) ? [1, 0] : o === 180 ? [0, 1] : [0, -1];   // the page's down, device axes
      const pd = ax * up[0] + ay * up[1];
      vote = pd < -0.5 ? 1 : (pd > 0.5 ? -1 : 0);
    }
    if (vote) {
      motion.votes++; motion.voteSum += vote;
      if (motion.votes >= 20 && Math.abs(motion.voteSum) >= 0.6 * motion.votes) { motion.locked = true; motion.sign = motion.voteSum > 0 ? 1 : -1; }
    }
  }
  const s = motion.sign || (iosLike() ? -1 : 1);
  // what the sand feels, device axes (x right, y up), in g: gravity less the phone's acceleration
  const fx = -s * ax, fy = -s * ay;
  let [px, py] = toPage(fx, -fy, screenAngle());           // the page: x right, y down
  // The phone's own acceleration (acceleration, without gravity; same sign convention as
  // accelerationIncludingGravity), when the browser gives it: taken out of the pull here and
  // fed to the sand as the glass's acceleration (felt.mjs), like the finger's. Without it the
  // whole pull counts as gravity.
  const A = e.acceleration;
  if (A && Number.isFinite(A.x) && Number.isFinite(A.y)) {
    [motion.lx, motion.ly] = toPage(s * A.x * K, -s * A.y * K, screenAngle());
    px += motion.lx; py += motion.ly; motion.hasLin = true;
  } else { motion.lx = 0; motion.ly = 0; }
  const mag = Math.hypot(px, py);
  if (mag > 8) { px *= 8 / mag; py *= 8 / mag; }
  // a soft dead zone (motion.js has one too): with the phone lying flat the pull in the screen's
  // plane is near zero, and an accelerometer's bias of a few hundredths of a g would otherwise
  // slide the weightless sand (a real glass on its back is held by friction on its back face)
  else if (mag < DEAD_G) { const k = (mag / DEAD_G) ** 2; px *= k; py *= k; }
  const k = 1 - Math.exp(-dt / 0.006);
  if (!motion.lp) { motion.gx = px; motion.gy = py; motion.lp = true; }
  else { motion.gx += (px - motion.gx) * k; motion.gy += (py - motion.gy) * k; }
  // turning in the screen's plane, rad/s, + clockwise. The rate about the screen's normal is
  // rotationRate.alpha by the spec (counter-clockwise +) but gamma on iOS; which axis, and its sign,
  // are learnt from how fast gravity's heading on the screen turns (hRate), while the phone is
  // upright enough for that heading to mean something.
  const inPlane = Math.hypot(motion.gx, motion.gy);
  const heading = Math.atan2(motion.gx, motion.gy);
  let hRate = 0, hOk = false;
  if (inPlane > 0.5 && Number.isFinite(motion.heading)) {
    let dh = heading - motion.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    hRate = dh / dt; hOk = true;
  }
  motion.heading = inPlane > 0.5 ? heading : NaN;
  motion.hRate = hRate;
  let w = 0;
  const rates = R ? R_AXES.map(k => Number.isFinite(R[k]) ? -R[k] * Math.PI / 180 : NaN) : null;
  if (rates && rates.some(Number.isFinite)) {
    if (!motion.rAxis) motion.rAxis = rotationPrior();
    if (hOk && Math.abs(hRate) > 0.4) {
      // correlation of each axis with the heading rate, over the last second or two of turning
      const st = motion.rStats || (motion.rStats = { xy: [0, 0, 0], xx: [0, 0, 0], yy: 0, n: 0 });
      const f = 0.97;
      st.yy = st.yy * f + hRate * hRate; st.n++;
      rates.forEach((r, i) => { if (Number.isFinite(r)) { st.xy[i] = st.xy[i] * f + r * hRate; st.xx[i] = st.xx[i] * f + r * r; } });
      if (st.n >= 12) {
        const corr = st.xy.map((xy, i) => xy / Math.sqrt(Math.max(1e-9, st.xx[i] * st.yy)));
        let best = 0; for (let i = 1; i < 3; i++) if (Math.abs(corr[i]) > Math.abs(corr[best])) best = i;
        if (Math.abs(corr[best]) > 0.7) { motion.rAxis = R_AXES[best]; motion.rSign = corr[best] > 0 ? 1 : -1; motion.rLearnt = true; }
      }
    }
    const r = rates[R_AXES.indexOf(motion.rAxis)];
    w = Number.isFinite(r) ? r * motion.rSign : (hOk ? hRate : 0);
  } else if (hOk) { w = hRate; motion.rAxis = 'heading'; }
  motion.w += (w - motion.w) * (1 - Math.exp(-dt / 0.04));
  const al = (motion.w - motion.wPrev) / dt; motion.wPrev = motion.w;
  motion.a += (al - motion.a) * (1 - Math.exp(-dt / 0.05));
  motion.a = Math.max(-300, Math.min(300, motion.a));
}
function motionStart() {
  if (motion.on) return;
  motion.on = true;
  window.addEventListener('devicemotion', onMotion);
  window.addEventListener('deviceorientation', onOrient);
}
/** Ask for motion access: must run inside the tap itself (iOS). */
function askMotion() {
  const DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent;
  const reqs = [];
  try { if (DM && typeof DM.requestPermission === 'function') reqs.push(DM.requestPermission()); } catch (e) { return Promise.reject(e); }
  try { if (DO && typeof DO.requestPermission === 'function') reqs.push(DO.requestPermission()); } catch (e) { /* orientation is optional */ }
  if (!reqs.length) return Promise.resolve(DM ? 'granted' : 'unavailable');
  return Promise.all(reqs.map(p => p.catch(() => 'denied'))).then(r => r[0]);
}

/* ------------------------------------------------------------------ *
 *  The glass as a body: the finger, home, the Flip
 * ------------------------------------------------------------------ */
function stepPose(dt) {
  if (rotor.on) {
    // the Rotor probe: the glass's angle is set once a frame, by the wall's time (rotorBefore), as
    // the app's body sets it; the substeps of a frame feel that frame's angle and turning
  } else if (flip.active) {
    const s = (simTime - flip.t0) / FLIP_S, D = flip.to - flip.from;
    if (s >= 1) { pose.theta = flip.to; pose.omega = 0; pose.alpha = 0; flip.active = false; }
    else {
      const ss = Math.max(0, s);
      pose.theta = flip.from + D * (0.5 - 0.5 * Math.cos(Math.PI * ss));
      pose.omega = D * Math.PI / 2 * Math.sin(Math.PI * ss) / FLIP_S;
      pose.alpha = D * Math.PI * Math.PI / 2 * Math.cos(Math.PI * ss) / (FLIP_S * FLIP_S);
    }
  }
  let tx = 0, ty = 0, w = BODY.hw, z = BODY.hz;
  if (fingerScript) {
    const f = fingerScript, u = (simTime - f.t0) / f.dur;
    if (u >= 1) fingerScript = null;
    else { tx = f.dx * Math.min(1, u * 1.0); ty = f.dy * Math.min(1, u * 1.0); w = BODY.fw; z = BODY.fz; }
  } else if (finger.down) {
    tx = finger.x + finger.ox; ty = finger.y + finger.oy; w = BODY.fw; z = BODY.fz;
    const lim = view.W * 0.5;
    tx = Math.max(-lim, Math.min(lim, tx)); ty = Math.max(-view.H * 0.4, Math.min(view.H * 0.4, ty));
  }
  pose.ax = w * w * (tx - pose.x) - 2 * z * w * pose.vx;
  pose.ay = w * w * (ty - pose.y) - 2 * z * w * pose.vy;
  pose.vx += pose.ax * dt; pose.vy += pose.ay * dt;
  pose.x += pose.vx * dt; pose.y += pose.vy * dt;
}

/* ------------------------------------------------------------------ *
 *  Auto Hz: the substep rate follows the sand's speed (realsand/rate.mjs)
 * ------------------------------------------------------------------ */
/** The highest rate auto Hz may use. */
function hzTop() { return Rate.hzTop(S); }
/** The per-frame substep cap at the rate in use (S.cap is set for the base rate). */
function capNow() { return Rate.capNow(S, rate); }
/** Uniform slots to allocate: the cap at the highest rate. */
function capAlloc() { return Rate.capAlloc(S); }
/**
 * Before a frame: the substep rate the sand needs (rate.mjs chooseRate), from the latest
 * readback t, what a jolt of the glass adds over 50 ms, and the GPU's budget (hzCap: substeps a
 * second; now: its clock, ms).
 */
function chooseRate(t, hzCap = Infinity, now = simTime * 1000, fixed = false) {
  const jolt = Math.hypot(felt.jx, felt.jy) * gCells() * 0.05;
  // (fixed: the calm mode, auto Hz off: the base rate)
  Rate.chooseRate(rate, t, { s: fixed ? { ...S, auto: false } : S, jolt, time: simTime, hzCap, now });
}
function resetRate() { Rate.rateReset(rate, S.hz); paceReset(); }

/** G / g: how slowed the world is (1 at real speed); the app's lambda. */
function lamNow() { return Math.min(1, gCells() / gReal()); }
/**
 * The inputs now, without stepping anything: the pull on the screen (x right, y down) in g, the
 * glass's own acceleration in g, and its turning. Sets feltNow, what the power modes read. Called
 * by fieldAt in every substep, and once an animation frame before the mode is chosen, so that a
 * glass asleep (no substeps) still feels the phone move.
 */
function feltSample() {
  // what the sand feels on the screen (x right, y down), in g, and the glass's turning (+ clockwise);
  // bx, by: the pull before a scripted shake or push, which way is down for the bed (felt.mjs psi)
  let gx = 0, gy = 1, w = pose.omega, a = pose.alpha;
  // the glass's own acceleration, g, page axes: the finger's spring, the phone's, a scripted one
  let lax = KPX * pose.ax, lay = KPX * pose.ay;
  const mode = scriptInput ? 'manual' : (benchRun ? 'bench' : S.input);
  let bx = 0, by = 1;
  if (mode === 'motion') {
    if (motion.seen) { gx = bx = motion.gx; gy = by = motion.gy; w += motion.w; a += motion.a; lax += motion.lx; lay += motion.ly; }
  } else if (mode === 'manual') {
    const m = scriptInput, t = simTime - m.t0;
    let g = m.gravity || [0, 1];
    if (m.gravitySpin) { const ph = m.gravitySpin * t, c = Math.cos(ph), s = Math.sin(ph); g = [c * g[0] - s * g[1], s * g[0] + c * g[1]]; }
    gx = g[0]; gy = g[1];
    bx = gx; by = gy;
    if (m.accel) { gx -= m.accel[0]; gy -= m.accel[1]; }
    if (m.shake) {
      const ax = m.shake.axis || [1, 0], amp = m.shake.g * Math.sin(2 * Math.PI * m.shake.hz * t);
      gx -= ax[0] * amp; gy -= ax[1] * amp;
    }
    w += m.omega || 0; a += m.alpha || 0;
    if (m.glass) { lax += m.glass[0]; lay += m.glass[1]; }
  } else if (mode === 'bench') {
    const t = simTime - benchRun.t0;
    gx -= 1.5 * Math.sin(2 * Math.PI * 3 * t);
    gy -= 0.5 * Math.sin(2 * Math.PI * 2.2 * t + 1);
  }
  // (what the power modes read: the glass's own acceleration, its turning, and the lean of the pull)
  feltNow = { a: Math.hypot(lax, lay), w, alpha: a, lean: Math.atan2(gx, gy) };
  if (feltNow.a > feltPeak) feltPeak = feltNow.a;
  return { gx, gy, w, a, lax, lay, bx, by };
}
/** The field for the next substep, in the glass's frame (advances the clock). */
function fieldAt() {
  const dt = 1 / rate.hz;
  stepPose(dt);
  let { gx, gy, w, a, lax, lay, bx, by } = feltSample();
  // the glass's own acceleration as the sand feels it (felt.mjs): reversed (the glass accelerating
  // one way pushes its sand the other), at app speed played as S.jolts says, its knees taken in the
  // frame of the pull (bx, by: down for the bed, however the phone is held)
  felt.opt.mode = S.jolts; felt.opt.knee = kneeOf(MATERIALS[S.material]);
  const [fax, fay] = felt.feel(-lax, -lay, dt, simTime, S.speed === 'app', lamNow(), Math.atan2(bx, by));
  gx += fax; gy += fay;
  const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
  const lx = c * gx + s * gy, ly = -s * gx + c * gy;      // into the glass (still y down)
  const G = gCells();
  // The turning terms at the glass's true size, as the app takes them (app.js lamNow): a
  // centrifugal pull of w² r is (w² r / g) g, so in the slow-motion world it is scaled by
  // G / g like every other force (1 at real speed). Coriolis scales the same way.
  const lam = lamNow(), rl = Math.sqrt(lam);
  simTime += dt;
  lastField = { gravity: [lx * G, -ly * G], omega: -w * rl, alpha: -a * lam, cor: rl, gate: simTime < gateUntil };
  return lastField;
}

/* ------------------------------------------------------------------ *
 *  Filling the glass
 * ------------------------------------------------------------------ */
/** The number of material points for an amount. */
function amountPoints(amount) { return Math.round(AMOUNTS[amount] / APP_CAPACITY * glass.bulbArea * PPC * PPC); }

/** Build (or reuse) the glass for the grid, and the buffers for the sand. */
function getGlass(res) {
  const key = res + ':' + S.neckMin;
  if (!glassCache.has(key)) glassCache.set(key, buildGlass({ s: RES[res], neckMin: S.neckMin }));
  return glassCache.get(key);
}

async function resetSand(opts = {}) {
  // a refill that is not the Timer's own ends a Timer, or the Rotor probe; readbacks still
  // waiting to be delivered (the tests' frames) are of the sand before it
  if (!opts.keepTimer) { timerOff(); rotorOff(); }
  vq.length = 0;
  if (opts.res) S.res = opts.res;
  if (opts.amount) S.amount = opts.amount;
  if (opts.material) S.material = opts.material;
  if (opts.speed && opts.speed !== S.speed) { S.speed = opts.speed; Object.assign(S, SPEED_DEFAULTS[S.speed]); }
  for (const k of ['hz', 'iterations', 'cap', 'maxStep', 'coriolis']) if (opts[k] !== undefined) S[k] = opts[k];
  const g = getGlass(S.res);
  const maxPts = Math.ceil(AMOUNTS.full / APP_CAPACITY * g.bulbArea * PPC * PPC * 1.05) + 1024;
  if (g !== glass || !solver.buffers.particles || solver.maxParticles < maxPts || solver.cap !== capAlloc()) {
    glass = g;
    solver.configure(g, maxPts, capAlloc());
    renderer.bind(solver.buffers.particles);
    layout();
  }
  const kind = opts.fill || 'top';
  // (fill.mjs: 'top' and 'lower' filled to the amount's points; each grain's colour seed in color.x)
  const pts = makeFill(glass, kind, { ...opts, points: opts.points || amountPoints(opts.amount || S.amount) });
  const data = packParticles(pts, matNow(S.material));
  const sides = solver.upload(data, pts.length / 2);
  fillCount = pts.length / 2;
  lastFill = { data, n: fillCount, sides };
  renderer.setPalette(palette(S.material));
  simTime = 0;
  gateUntil = kind === 'top' ? (opts.gate ?? GATE_S) : 0;
  if (!opts.keepPose) {
    Object.assign(pose, { x: 0, y: 0, vx: 0, vy: 0, theta: 0, omega: 0, alpha: 0, ax: 0, ay: 0 });
    flip.active = false;
  }
  lastTally = null; clampLog.length = 0; behindS = 0;
  resetRate();
  felt.reset(0);
  modesReset(modes, clockNow());
  syncUI();
  drawGlass();
  return sides;
}

/** A new material for the sand where it lies. */
async function switchMaterial(id) {
  S.material = id;
  paceReset();
  if (!solver?.count) return;
  busy = true;                                   // the frame loop waits: the sand must not move while it is read back
  let data;
  try { data = await solver.readParticles(); } finally { busy = false; }
  const m = matNow(id);
  for (let i = 0; i < solver.count; i++) {
    const o = i * PARTICLE_WORDS;
    data[o + 4] = 1; data[o + 5] = 0; data[o + 6] = 0; data[o + 7] = 1;
    data[o + 8] = data[o + 9] = data[o + 10] = data[o + 11] = 0;
    data[o + 12] = 1; data[o + 13] = 0;
    data[o + 16] = data[o + 17] * m.density; data[o + 18] = m.model;
  }
  solver.upload(data, solver.count);
  renderer.setPalette(palette(id));
  syncUI();
}

/* ------------------------------------------------------------------ *
 *  The Timer: an app amount, timed by the app's clock through the
 *  metered neck (realsand/valve.mjs), as the app will run it
 * ------------------------------------------------------------------ */
const FRAME_MS = 1000 / 60;
// the fresh bed settles on the shut neck this long (simulated seconds) before the clock starts:
// the app's glass is at rest when its clock starts, and the lattice fill settles in about 0.4 s
const TIMER_SETTLE_S = 0.5;
const timer = { on: false, def: null, gen: 0 };
// The clock the Timer and the modes run on: the wall's (Date.now, which keeps counting while the
// phone sleeps, as the app's clock does), or the tests' virtual one (framesN), once they step it.
let vclock = null;
function clockNow() { return vclock !== null ? vclock : Date.now(); }

/** The Timer ends (a refill, another Timer, the Rotor probe); the lab's own mode comes back unless one was chosen. */
function timerOff() {
  if (timer.on && !S.modeChosen) S.mode = 'full';
  timer.on = false;
}

/**
 * Start a Timer (timer.mjs TIMERS: '10s', '1m', '10m', '60m', '60m-4', '60m-30'): the app's
 * amount for its glass, in coarse sand at app speed on the grid in use, filled in the top bulb
 * on the shut neck; the GPU's cost timed on it by a burst (o.burst; not in the headless tests);
 * then 0.5 s to settle, and the clock starts. o: { ms (time it to this instead), grains, burst,
 * settle (s) }.
 */
async function timerStart(id, o = {}) {
  const def = timerById(id);
  if (!def) throw new Error('No such Timer: ' + id);
  timerOff(); rotorOff();
  const g = getGlass(S.res);
  // material points per app grain: PPC^2 s^2 (1.69 on the coarse grid, the app's phone glass's)
  const ppg = PPC * PPC * g.s * g.s;
  const N = o.grains ?? grainsFor(def.amountMs);
  const ms = o.ms ?? def.ms;
  const valve = new Valve({ ppg });
  const want = valve.fill(N, N);
  const sides = await resetSand({ fill: 'top', points: want.top, gate: 0, material: 'coarse', speed: 'app', keepTimer: true });
  // (the ledger takes the upload's own counts: the fill holds what the bulb holds)
  valve.fill(N, N, sides.above, sides.below);
  if (!S.modeChosen) S.mode = 'auto';
  if (o.burst ?? !OFFSCREEN) { setStatus('Timing the GPU on this bed…'); await burst({ restore: lastFill, label: 'Timer ' + def.label, reps: o.reps }); setStatus(''); }
  // the depth from the counting line to the glass's floor on its axis (the first fall's length)
  let floor = 0;
  while (floor < g.cy - 1 && sampleField(g, g.cx, g.cy - floor - 0.5)[2] > 0) floor += 0.5;
  Object.assign(timer, {
    on: true, def, id, ms, N, ppg, valve, clk: makeClock(ms, N), rem: ms, state: 'settle', settleUntil: simTime + (o.settle ?? TIMER_SETTLE_S),
    gen: timer.gen + 1, failed: null, swapAt: null, lastTick: null, startAt: null, runStart: null, turning: false, swaps: 0, target: N, closed: true, floor,
    fall: { from: null, wallFrom: null, s: NaN, wall: NaN }, end: null, ends: [], refusedLog: [], last: null, began: clockNow(),
    n: { frames: 0, runs: 0, open: 0, closedRuns: 0, viol: 0, closedCross: 0, mismatch: 0, audits: 0, auditFails: 0, supplied: 0, countOff: 0,
      bulk: 0, short: 0, worstShort: 0, cold: 0, coldShort: 0, coldWorst: 0, qSum: 0, vSum: 0, refused: 0, upward: 0, crossings: 0, pointsOff: 0 }
  });
  modesReset(modes, clockNow());
  syncUI();
  return timerState();
}

/**
 * Once an animation frame, drawn or not, before its run: the app's clock (app.js tickClock: it
 * stands still while the glass turns and while it lies on its side), the swap at the end of a
 * Flip (app.js swapEnds), the target with the breathing, and the valve's plan.
 */
function timerBefore(now) {
  const T = timer, v = T.valve;
  const d = T.lastTick === null ? 0 : Math.max(0, now - T.lastTick);
  T.lastTick = now; T.n.frames++;
  if (T.state === 'settle' && simTime >= T.settleUntil) { T.state = 'running'; T.startAt = T.runStart = now; }
  // the glass's lean (the app's sim.gy): on its side the neck cannot flow and the clock stands still
  const gy = Math.cos(pose.theta + feltNow.lean);
  if (flip.active && !T.turning) T.turning = true;
  if (T.turning && !flip.active) {
    const before = v.nTop, there = T.clk.remAt(v.total - before);
    v.completeFlip();
    // the glass is back upright in its own frame: the next run's flip pass turns the points end for end
    pose.theta -= Math.PI;
    T.turning = false; T.swaps++; T.rem = there; T.swapAt = now;
    if (T.state === 'done' && there > 0) { T.state = 'running'; T.runStart = now; T.end = null; }
  }
  if (T.state === 'running' && !T.turning && gy > 0.7) {
    const r0 = T.rem;
    T.rem -= d;
    if (T.rem <= 0) {
      T.rem = 0; T.state = 'done';
      T.end = { zeroAt: now - d + r0, last: null, confirmedAt: null, residueAt: null, residue: 0 };
      T.ends.push(T.end);
    }
  }
  const running = T.state === 'running' && !T.turning, draining = T.state === 'done' && v.nTop > 0 && !T.turning;
  let target = v.nTop;
  if (running) target = targetAt(T.clk, T.rem, now);
  else if (draining) target = 0;
  const pl = v.plan({ now, target, gateOpen: running || draining, deepRelease: draining || (running && T.rem <= 0), relCap: 0,
    flipping: T.turning, gy, rem: T.state === 'settle' ? T.ms : T.rem, tailMs: T.clk.tailMs, steps: Math.max(1, Math.round(d * 0.12)) });
  T.target = target; T.closed = pl.closed;
  if (running && !pl.closed) { T.n.supplied++; if (v.nTop !== target) T.n.countOff++; }
  const E = T.end;
  if (E && E.confirmedAt === null && T.state === 'done' && v.nTop === 0) E.confirmedAt = now;
  if (E && E.residueAt === null && v.residueDue(now)) { E.residueAt = now; E.residue = v.nTop; }
  // no readback for 60 runs (a failing mapAsync): a swap's base would wait for good and the end
  // would never be confirmed; in the app the current sand takes over (design 7.9), here it is said
  if (!T.failed && v.stalled()) {
    T.failed = { at: now, pending: v.pending };
    life('Timer stalled', `no readback for ${v.unread} runs${v.pending ? ', a swap\'s base waiting' : ''}`);
    setStatus('Timer: no readback has come for a second (this browser\'s readbacks are failing), so the neck cannot be metered; in the app the current sand would take over.');
  }
}

/** The valve's words for this frame's run (valve.mjs run), tagged with the Timer they belong to. */
function timerWords(steps, now, hz) {
  const w = timer.valve.run({ steps, now, simDt: steps / hz });
  w.gen = timer.gen; w.state = timer.state;
  return w;
}

/** A run's readback, to the valve and the Timer's record. tSim: the simulated time at the run's end. */
function timerReadback(w, t, tSim) {
  const T = timer;
  if (!T.on || w.gen !== T.gen) return;
  const v = T.valve, N = T.n;
  v.onReadback(w.seq, t);
  N.runs++;
  let pTmin = Infinity;
  for (const x of w.targets) pTmin = Math.min(pTmin, x);
  const pTend = w.targets[w.targets.length - 1];
  if (!w.closed) {
    N.open++;
    // the membrane's promise: a run in which anything crossed ends with no fewer above than its lowest target
    if (t.crossings > 0 && t.above < pTmin) N.viol++;
  } else { N.closedRuns++; N.closedCross += t.crossings; }
  if (t.start + w.appended - t.crossings !== t.above) N.mismatch++;
  if (t.points !== v.points || t.above + t.below !== t.points) N.pointsOff++;
  N.refused += t.refused; N.upward += t.upward; N.crossings += t.crossings;
  T.refusedLog.push({ t: w.to, n: t.refused });
  while (T.refusedLog.length > 2 && w.to - T.refusedLog[0].t > 1000) T.refusedLog.shift();
  if (!w.closed && w.vcap < 1e8 && w.state === 'running') {
    // the bulk, as the valve test's plant counts it: from 2 s after the clock started and 1 s
    // after a swap; before that, the cold start (the queue forming on the line), apart
    const sh = t.above - pTend;
    if (T.startAt !== null && w.to - T.startAt >= 2000 && !(T.swapAt !== null && w.to - T.swapAt < 1000)) {
      N.bulk++; N.qSum += t.queue; N.vSum += w.vcap;
      if (sh > 0) { N.short++; N.worstShort = Math.max(N.worstShort, sh); }
    } else {
      N.cold++;
      if (sh > 0) { N.coldShort++; N.coldWorst = Math.max(N.coldWorst, sh); }
    }
  }
  const a = v.audit();
  if (a) { N.audits++; if (!a.ok) N.auditFails++; }
  // the first fall: from the first run in which sand crossed into the empty lower bulb, until the
  // stream's front has reached the floor (tally: the deepest point below the line)
  const F = T.fall;
  if (F.from === null && !T.swaps && t.crossings > 0 && t.below === t.crossings) { F.from = tSim; F.wallFrom = w.to; }
  else if (F.from !== null && !(F.s >= 0) && t.deepest >= T.floor - 1.5) { F.s = tSim - F.from; F.wall = w.to - F.wallFrom; }
  T.last = { t, w, pTend };
  // the end: the first run read back with no point above after 00:00.0 holds the last crossing
  const E = T.end;
  if (E && !E.last && t.above === 0 && w.to >= E.zeroAt - 1e-6) {
    let z = -1;
    for (let i = 0; i < w.targets.length; i++) if (w.targets[i] === 0) { z = i; break; }
    E.last = { from: w.from, to: w.to, s0: z, S: w.steps, seq: w.seq, k: t.lastCross };
  }
}

/** The Timer's state and record, for the HUD, Copy results and the tests. */
function timerState() {
  const T = timer;
  if (!T.def) return null;
  const v = T.valve, E = T.end, F = T.fall, N = T.n;
  const endOf = e => {
    if (!e) return null;
    let last = null;
    if (e.last) {
      // the substep in which the last point crossed (the GPU's record), as a span of the wall's
      // time: the run's substeps stand for its span, from the run before to its frame
      const L = e.last, sub = (L.to - L.from) / Math.max(1, L.S), k = L.k >= 0 ? L.k : -1;
      last = k >= 0 ? { early: L.from + k * sub - e.zeroAt, late: L.from + (k + 1) * sub - e.zeroAt, substep: sub, k, S: L.S }
        : { early: L.from + Math.max(0, L.s0) * sub - e.zeroAt, late: L.to - e.zeroAt, substep: sub, k: -1, S: L.S };
    }
    return { zeroAt: e.zeroAt, last, confirmed: e.confirmedAt === null ? null : e.confirmedAt - e.zeroAt,
      residue: e.residueAt === null ? 0 : e.residue, residueAt: e.residueAt === null ? null : e.residueAt - e.zeroAt };
  };
  return {
    on: T.on, id: T.id, label: T.def.label, grains: T.N, points: v.points, ppg: T.ppg, ms: T.ms, state: T.turning ? 'turning' : T.state,
    rem: T.rem, nTop: v.nTop, target: T.target, total: v.total, parity: v.parity, closed: T.closed, swaps: T.swaps, failed: T.failed,
    mode: modes.mode, why: modes.why, setting: S.mode, guard: modes.guard, modeMs: { ...modes.ms }, hz: rate.hz,
    fall: F.s, fallWall: F.wall, floor: T.floor, end: endOf(E), ends: T.ends.map(endOf),
    n: { ...N }, queue: N.bulk ? N.qSum / N.bulk : NaN, vcap: N.bulk ? N.vSum / N.bulk : NaN, kv: v.kv, refusedPerS: refusedPerS(),
    valve: v.stats(), clock: { tailMs: T.clk.tailMs, tailGrains: T.clk.tailGrains, rate: T.clk.rate }
  };
}
function refusedPerS() {
  const L = timer.refusedLog;
  if (!L || L.length < 2) return 0;
  const span = (L[L.length - 1].t - L[0].t) / 1000;
  return span > 0 ? L.slice(1).reduce((s, x) => s + x.n, 0) / span : 0;
}
/** m:ss.s for ms. */
function mmss(ms) {
  const t = Math.max(0, ms) / 1000, m = Math.floor(t / 60), s = t - 60 * m;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
function sgn(x) { return (x > 0 ? '+' : '') + x; }
function vcapText(v) { return v >= 1e8 ? 'open' : v === 0 ? 'shut' : v.toFixed(2); }
function endText(e) {
  if (!e) return '';
  const lp = e.last ? `last point ${e.last.early >= 0 ? '+' : ''}${e.last.early.toFixed(1)} to ${e.last.late >= 0 ? '+' : ''}${e.last.late.toFixed(1)} ms after 00:00.0${e.last.k >= 0 ? ' (substep ' + (e.last.k + 1) + ' of ' + e.last.S + ' of its run)' : ''}` : 'last point not yet out';
  return `${lp}; nTop 0 ${e.confirmed === null ? 'not yet' : '+' + e.confirmed.toFixed(0) + ' ms'}; residue ${e.residueAt === null ? 'none' : e.residue + ' grains at +' + e.residueAt.toFixed(0) + ' ms'}`;
}
function timerHud() {
  const T = timer, st = timerState(), k = T.last, L = [];
  const state = st.state === 'settle' ? 'settling' : st.state;
  L.push(`Timer ${st.label}${T.ms !== T.def.ms ? ' in ' + mmss(T.ms) : ''}: ${mmss(st.rem)} ${state}  mode ${st.mode} (${S.mode}${st.guard ? ', HEAT GUARD' : ''})  ${rate.hz} Hz`);
  L.push(`count ${sgn(st.nTop - st.target)} (nTop ${st.nTop}, target ${st.target})  GPU ${k ? sgn(k.t.above - k.pTend) + ' pts' : '-'}  queue ${k ? k.t.queue : '-'}  vcap ${k ? vcapText(k.w.vcap) : '-'}  refused ${Math.round(st.refusedPerS)}/s`);
  L.push(`fall ${Number.isFinite(st.fall) ? st.fall.toFixed(2) + ' s' : '-'}  kv ${st.kv.toFixed(1)}  short ${st.n.short}/${st.n.bulk} (worst ${st.n.worstShort}; start ${st.n.coldShort}/${st.n.cold})  below target ${st.n.viol}  swaps ${st.swaps}`);
  if (st.end) L.push('END ' + endText(st.end));
  if (st.failed) L.push('STALLED: no readback for 60 runs' + (st.failed.pending ? ', a swap\'s base waiting' : ''));
  return L;
}

/* ------------------------------------------------------------------ *
 *  The power modes (timer.mjs): full, calm, asleep
 * ------------------------------------------------------------------ */
/** The mode for this frame, from what the glass and the Timer are doing. now: the Timer's clock; ratio: sim/real over the last second. */
function modeFor(now, ratio) {
  const t = lastTally, T = timer.on ? timer : null;
  // still: at most 3 points faster than 2 % of a free fall over the glass (tally word 7; 23 cells/s
  // on the coarse grid at app speed). The design also asked for the fastest under 3 cells/s, but a
  // substep's speed jitters on a bed at rest: a 1-minute bed 1.5 to 3 s at rest on SwiftShader read
  // 0 points moving, the fastest at 5 to 16 cells/s and the mean at 1.4 to 6.7, so neither the
  // fastest nor the mean tells rest from a slow slide.
  const still = !!t && t.moving <= 3;
  const running = !!T && (T.state === 'running' || T.state === 'settle');
  const draining = !!T && T.state === 'done' && T.valve.nTop > 0;
  let busy = '';
  if (flip.active || (T && T.turning) || rotor.on) busy = 'turning';
  else if (finger.down || fingerScript) busy = 'touched';
  else if (benchRun || flowRec) busy = 'measuring';
  else if (T && T.state === 'settle') busy = 'settling';
  else if (T && T.valve.flipPending) busy = 'swap';
  else if (T && T.state === 'running' && T.runStart !== null && now - T.runStart < MODES.START_MS) busy = 'start';
  else if (T && T.state === 'running' && T.rem < T.clk.tailMs + 300) busy = 'tail';
  else if (T && T.state === 'done' && (draining || (T.end && now - T.end.zeroAt < MODES.HOLD_MS))) busy = 'end';
  const felt = { ...feltNow, peak: feltPeak };
  feltPeak = 0;
  return chooseMode(modes, { now, setting: S.mode, busy, felt, active: running || draining || !still, still,
    pending: !!(T && (T.turning || T.valve.flipPending)), ratio, atBase: rate.hz === S.hz });
}
/** Simulated over real time over the last second of frames drawn (NaN: under half a second of them). */
function ratioLast(now) {
  let sim = 0, real = 0;
  for (let i = frames.length - 1; i >= 0 && now - frames[i].t <= 1000; i--) { sim += frames[i].sim; real += frames[i].real; }
  return real >= 0.5 ? sim / real : NaN;
}
/** The tally auto Hz reads: with a Timer, its fastest crowded point (a falling stream does not ask for a higher rate). */
function rateTally() {
  const t = lastTally;
  if (!t || !timer.on) return t;
  return t.crowd || (t.crowd = { maxSpeed: t.crowdSpeed });
}

/* ------------------------------------------------------------------ *
 *  Frames stepped by the tests, on a virtual clock: as the live loop
 *  runs them (the modes, the Timer, readbacks lag frames late), but
 *  each awaiting the GPU
 * ------------------------------------------------------------------ */
const vq = [];                       // readbacks waiting to be delivered
let vframe = 0, vLastRun = null, vRunN = 0;
const vRuns = [];                    // the runs stepped: { frame, mode, steps, hz }
function deliver(q) {
  if (!q.t) return;
  readbackOk++;
  onTally(q.t, q.tSim);
  if (q.neck && timer.on) timerReadback(q.neck, q.t, q.tSim);
  if (q.neck && rotor.on) rotorReadback(q.neck, q.t);
}
/**
 * n frames of 1/60 s on the virtual clock. o: { lag (readbacks delivered this many frames late; 2),
 * stopAtEnd (stop 0.2 s after the Timer's count reads 0) }. Calm draws every other frame (its
 * substeps then cover both), asleep runs nothing.
 */
async function framesN(n, o = {}) {
  manual = true;
  const lag = o.lag ?? 2;
  if (vclock === null) vclock = Date.now();
  let ran = 0;
  for (let k = 0; k < n; k++) {
    vclock += FRAME_MS; vframe++;
    const wall = vclock;
    while (vq.length && vq[0].due <= vframe) deliver(vq.shift());
    if (timer.on) timerBefore(wall);
    if (rotor.on) rotorBefore(FRAME_MS / 1000);
    feltSample();
    const mode = modeFor(wall, NaN);
    if (mode === 'asleep') { sleptFrames++; vLastRun = null; continue; }
    if (mode === 'calm' && vLastRun !== null && wall - vLastRun < frameMsFor('calm', FRAME_MS) - 0.5 * FRAME_MS) { calmFrames++; if (rotor.on) rotorCss(); continue; }
    if (rotor.on && rotor.skip3 && ++rotor.frameNo % 3 === 0) { rotor.skips++; rotorCss(); continue; }
    chooseRate(rateTally(), Infinity, wall, mode === 'calm');
    const span = vLastRun === null ? FRAME_MS : Math.min(250, wall - vLastRun);
    vLastRun = wall;
    const steps = Math.max(1, Math.min(capNow(), Math.round(span * rate.hz / 1000)));
    const neck = timer.on ? timerWords(steps, wall, rate.hz) : rotor.on ? rotorWords(steps, wall, rate.hz) : null;
    const draw = k === n - 1 || o.draw;
    const p = solver.run(steps, set(), fieldAt, draw ? enc => renderer.encode(enc, solver.count, grainLook()) : null, neck);
    if (rotor.on) rotorDrawn();
    const tSim = simTime;
    ran++;
    vRuns.push({ i: vRunN++, frame: vframe, mode, steps, hz: rate.hz });
    if (vRuns.length > 4000) vRuns.splice(0, 1000);
    const t = p ? await p : null;
    vq.push({ due: vframe + lag, t, tSim, neck });
    if (o.stopAtEnd && timer.on && timer.end && timer.end.confirmedAt !== null && wall - timer.end.confirmedAt > 200) break;
  }
  await renderer.present();
  drawGlass();
  return { ran, frame: vframe, mode: modes.mode, timer: timerState() };
}

/* ------------------------------------------------------------------ *
 *  The GPU's cost by a burst (design 9.3): with nothing else in
 *  flight, a submit of 24 substeps and one of 96, each ten times;
 *  the cost a substep is (median of 96 - median of 24) / 72, which
 *  removes a submit's fixed latency. The sand is put back after.
 * ------------------------------------------------------------------ */
async function burst(o = {}) {
  if (!solver?.count) return null;
  const reps = o.reps ?? 10, small = o.small ?? 24, big = o.big ?? 96;
  const wasBusy = busy;
  busy = true;
  try {
    // nothing else in flight: the live loop's frames done, every readback back
    for (let i = 0; i < 200 && (pace.inflight > 0 || solver.readbacks.some(r => r.pending)); i++) { await gpu.device.queue.onSubmittedWorkDone(); await sleep(5); }
    const snap = o.restore || { data: await solver.readParticles(), n: solver.count };
    const capWas = solver.cap;
    if (solver.cap < big) solver.allocUniforms(big);
    const f = { gravity: lastField.gravity.slice(), omega: 0, alpha: 0, cor: 1, gate: false };
    // (the neck shut, so that nothing crosses while the sand is timed)
    const neck = { flip: false, vcap: 0, allow: new Float32Array([ALLOW_SHUT]), flags: NECK_ON };
    const sv = set();
    const time = async (k, draw) => {
      const t0 = performance.now();
      solver.run(k, sv, () => f, draw ? enc => renderer.encode(enc, solver.count, grainLook()) : null, neck);
      await gpu.device.queue.onSubmittedWorkDone();
      return performance.now() - t0;
    };
    await time(small);
    const a = [], b = [], dr = [];
    for (let i = 0; i < reps; i++) { a.push(await time(small)); b.push(await time(big)); dr.push(await time(0, true)); }
    for (let i = 0; i < 50 && solver.readbacks.some(r => r.pending); i++) await sleep(5);
    solver.upload(snap.data, snap.n);
    if (solver.cap !== capWas) solver.allocUniforms(capWas);
    const msStep = burstCost(a, b, small, big), msDraw = median(dr);
    const row = { label: o.label || 'this bed', points: snap.n, reps, small, big, msStep, msDraw, smallMs: median(a), bigMs: median(b),
      hz: S.hz, iterations: S.iterations, dispatches: dispatchesPerSubstep(S.iterations, sv.material),
      full: gpuShare(msStep, S.hz, msDraw, 60), calm: gpuShare(msStep, S.hz, msDraw, 30) };
    bursts.push(row);
    life('burst', `${row.label}: ${row.points} points, ${msStep.toFixed(3)} ms a substep`);
    return row;
  } finally { busy = wasBusy; lastNow = 0; lastDrawn = 0; acc = 0; }
}
function burstText(r) {
  const n = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '-';
  return `${r.label}, ${r.points} points: ${n(r.msStep, 3)} ms a substep ((median ${n(r.bigMs, 1)} ms for ${r.big} - median ${n(r.smallMs, 1)} ms for ${r.small}) / ${r.big - r.small}, ${r.reps} each), a frame's drawing and tally ${n(r.msDraw, 2)} ms; at ${r.hz} Hz x ${r.iterations} (${r.dispatches} dispatches a substep) the GPU's share: full (60 fps) ${n(100 * r.full, 0)} %, calm (30 fps, same substeps) ${n(100 * r.calm, 0)} %; auto Hz in full adds while it is above ${r.hz} Hz`;
}

/* ------------------------------------------------------------------ *
 *  The Rotor probe (?rotor=1): the grains' canvas inside a div that
 *  CSS turns with the glass, between two WebGL canvases (the glass's
 *  back and its wall), as the app will stack them (design 6.1, 6.6).
 *  The 60-minute bed turns freely at up to 16 rad/s with the neck
 *  shut; at each half turn the ledger swaps and the next run's flip
 *  pass turns the points end for end while the div turns back half a
 *  turn. A frame whose run is skipped while the picture on the canvas
 *  is from before a swap turns the canvas itself half a turn.
 * ------------------------------------------------------------------ */
const rotor = { on: false, w: 16, skip3: false, frameNo: 0, valve: null, drawnParity: 0, gl: [], swaps: 0, skips: 0, cssTurns: 0, runs: 0,
  wrong: 0, checked: 0, ruleBad: 0, marker: -1 };
const ROTOR_SPEEDS = [16, 8, 4, 0];
/** Start (or restart) the probe. o: { amount (a Timer's id; '60m'), w (rad/s; 16), skip3 }. */
async function rotorStart(o = {}) {
  timerOff();
  // (its own parameter, bed=: the lab's amount= names the lab's amounts, not the Timer's glasses)
  const def = timerById(o.amount || QUERY.get('bed') || '60m') || timerById('60m');
  const g = getGlass(S.res), ppg = PPC * PPC * g.s * g.s, N = grainsFor(def.amountMs);
  const valve = new Valve({ ppg });
  const want = valve.fill(N, N);
  rotor.on = false;
  const sides = await resetSand({ fill: 'top', points: want.top, gate: 0, material: 'coarse', speed: 'app', keepTimer: true });
  valve.fill(N, N, sides.above, sides.below);
  Object.assign(rotor, { on: true, def, valve, drawnParity: valve.parity, w: o.w ?? rotor.w, skip3: o.skip3 ?? rotor.skip3, frameNo: 0,
    swaps: 0, skips: 0, cssTurns: 0, runs: 0, wrong: 0, checked: 0, ruleBad: 0, marker: -1, points: sides.above });
  if (o.spun) pose.omega = rotor.w;
  layout();
  rotorCss();
  syncUI();
}
function rotorOff() { rotor.on = false; }
/**
 * Once an animation frame: the glass's turning rate eases toward rotor.w; its angle moves by the
 * wall's time (as the app's body); past a half turn the ledger swaps and the angle goes back by pi.
 */
function rotorBefore(dt) {
  const r = rotor, v = r.valve;
  dt = Math.max(1e-3, Math.min(0.1, dt));
  const w1 = pose.omega + (r.w - pose.omega) * (1 - Math.exp(-dt / 0.8));
  pose.alpha = (w1 - pose.omega) / dt; pose.omega = w1;
  pose.theta += w1 * dt;
  if (pose.theta >= Math.PI) { pose.theta -= Math.PI; v.completeFlip(); r.swaps++; }
  v.plan({ now: clockNow(), target: v.nTop, gateOpen: false, flipping: true, gy: 1, rem: 1e9, tailMs: 0 });
  if (r.marker !== v.parity) glPaint();
}
function rotorWords(steps, now, hz) {
  rotor.runs++;
  const w = rotor.valve.run({ steps, now, simDt: steps / hz });
  w.parity = rotor.valve.parity;
  return w;
}
/** The run just encoded draws the bed as the ledger now has it (its flip pass included). */
function rotorDrawn() { rotor.drawnParity = rotor.valve.parity; rotorCss(); }
/** The CSS turns of this frame: the div by the glass's angle; the grains' canvas half a turn while its picture is from the other parity. */
function rotorCss() {
  const r = rotor, el = $('rotor');
  if (!el) return;
  el.style.transform = `rotate(${pose.theta}rad)`;
  const turn = r.drawnParity !== r.valve.parity;
  $('c-gpu').style.transform = turn ? 'rotate(180deg)' : '';
  if (turn) r.cssTurns++;
}
/**
 * A run's readback: the neck is shut, so all of the sand stays in the bulb it was filled in. That
 * bulb is the grid's top while the ledger's parity is the fill's (0), and its bottom after an odd
 * number of swaps (the flip pass turns the points end for end at each), so every point is on the
 * side of the line the run's parity says, none on the other.
 */
function rotorReadback(w, t) {
  const r = rotor, P = r.valve.points;
  r.checked++;
  r.valve.onReadback(w.seq, t);
  const ok = w.parity === 0 ? t.above === P && t.below === 0 : t.below === P && t.above === 0;
  if (!ok) r.wrong++;
}
/** The two WebGL canvases: the glass's back (a faint fill) and its wall, with a mark at the far end of the bulb that holds the sand. */
function glInit(c) {
  const gl = c.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;
  const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; uniform vec2 k; void main() { gl_Position = vec4(p * k, 0.0, 1.0); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 c; void main() { gl_FragColor = c; }'));
  gl.linkProgram(prog);
  return { gl, prog, buf: gl.createBuffer(), p: gl.getAttribLocation(prog, 'p'), k: gl.getUniformLocation(prog, 'k'), c: gl.getUniformLocation(prog, 'c') };
}
/** The glass's outline (cells about its centre, y down), right side from the top tip to the bottom one. */
function outlineSide(grow) {
  const pts = [], rec = { moveTo(x, y) { pts.push([x, y]); }, lineTo(x, y) { pts.push([x, y]); }, closePath() {} };
  traceOutline(rec, glass, grow);
  return pts.slice(0, pts.length / 2);
}
function glPaint() {
  if (!rotor.gl.length || !glass) return;
  const D = view.D || 1, kk = 2 * view.k / D;
  const inner = outlineSide(0), outer = outlineSide(glass.wallCells);
  const strip = (a, b) => { const o = []; for (let i = 0; i < a.length; i++) o.push(a[i][0], a[i][1], b[i][0], b[i][1]); return new Float32Array(o); };
  const mirror = a => a.map(p => [-p[0], p[1]]);
  const disc = (x, y, r) => { const o = [x, y]; for (let i = 0; i <= 24; i++) o.push(x + r * Math.cos(i / 12 * Math.PI), y + r * Math.sin(i / 12 * Math.PI)); return new Float32Array(o); };
  const sandEnd = (rotor.valve && rotor.valve.parity ? 1 : -1) * glass.HBc * 0.9;
  rotor.marker = rotor.valve ? rotor.valve.parity : -1;
  const layers = [
    [{ tri: strip(inner, mirror(inner)), mode: 'strip', c: [0.05, 0.046, 0.04, 0.05] }],
    [{ tri: strip(outer, inner), mode: 'strip', c: [0.3, 0.274, 0.24, 0.3] }, { tri: strip(mirror(outer), mirror(inner)), mode: 'strip', c: [0.3, 0.274, 0.24, 0.3] },
      { tri: disc(0, sandEnd, 2.2), mode: 'fan', c: [0.73, 0.58, 0.36, 0.8] }]
  ];
  rotor.gl.forEach((g, i) => {
    if (!g) return;
    const gl = g.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(g.prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(g.k, kk, -kk);
    for (const L of layers[i]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buf); gl.bufferData(gl.ARRAY_BUFFER, L.tri, gl.STREAM_DRAW);
      gl.enableVertexAttribArray(g.p); gl.vertexAttribPointer(g.p, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(g.c, ...L.c);
      gl.drawArrays(L.mode === 'fan' ? gl.TRIANGLE_FAN : gl.TRIANGLE_STRIP, 0, L.tri.length / 2);
    }
  });
}
/** Build the rotor's stack: back WebGL canvas, the grains' canvas, front WebGL canvas, in a div that turns. */
function rotorBuild() {
  const div = document.createElement('div');
  div.id = 'rotor';
  const back = document.createElement('canvas'), front = document.createElement('canvas');
  back.id = 'r-back'; front.id = 'r-front';
  div.append(back, $('c-gpu'), front);
  $('stage').appendChild(div);
  $('c-back').hidden = true; $('c-front').hidden = true;
  rotor.gl = [glInit(back), glInit(front)];
  document.body.classList.add('rotor');
}

/* ------------------------------------------------------------------ *
 *  Drawing: grains on the GPU, the glass in 2-D around them
 * ------------------------------------------------------------------ */
/**
 * What the grain renderer (grains.mjs) needs for a frame: the grid on the screen (the glass at
 * its pose, scaled to fit), the grain's size, and the blur. Taken when the frame is drawn, after
 * its substeps have moved the glass.
 */
function grainLook() {
  // (the Rotor probe draws the grains in the glass's own frame, centred on its canvas: the div turns them)
  const g = glass, k = rotor.on ? view.k : kNow(), th = rotor.on ? 0 : pose.theta, c = Math.cos(th), s = Math.sin(th);
  const W = rotor.on ? view.D : view.W, H = rotor.on ? view.D : view.H;
  const hx = rotor.on ? view.D / 2 : view.hx + pose.x, hy = rotor.on ? view.D / 2 : view.hy + pose.y;
  const liquid = matNow().model === 0;
  const rc = liquid ? 0.62 : 0.36;                          // grain radius, cells
  const rpx = Math.max(rc * k, 0.75 / view.dpr);            // CSS px, at least most of a device pixel
  return {
    m: [2 * k * c / W, 2 * k * s / W, -2 * k * s / H, 2 * k * c / H],
    o: [2 / W * (hx - k * c * g.cx - k * s * g.cy) - 1, 1 - 2 / H * (hy - k * s * g.cx + k * c * g.cy)],
    r: [2 * rpx / W, 2 * rpx / H],
    liquid,
    // motion blur: the streak a grain makes in S.blur display frames (of simulated time at the
    // sim/real ratio of 1), per cell of its displacement in a substep; the display's own frame
    // (a 30 Hz display, as in Low Power Mode, shows each frame twice as long; stepped by hand, 1/60 s)
    exposure: exposure(S.blur || 0, manual ? 1000 / 60 : displayMs(), solver.lastHz || rate.hz),
    // only grains in flight streak (grains.mjs FLIGHT, flightOf)
    flight: S.blurAll ? 0 : FLIGHT
  };
}

function layout() {
  const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 3);
  view.W = W; view.H = H; view.dpr = dpr;
  for (const id of ['c-back', 'c-gpu', 'c-front']) {
    const c = $(id);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    c.style.width = W + 'px'; c.style.height = H + 'px';
  }
  if (!glass) return;
  const top = $('top').getBoundingClientRect().bottom + 4;
  const bottom = $('panel').getBoundingClientRect().top - 4;
  const s = glass.s, q = APP_Q;
  const halfH = glass.HBc + (3 + 5 + 11) * q * s + 2;       // to the outside of the caps
  const halfW = glass.Rc + 24 * q * s + 2;
  const availH = Math.max(120, bottom - top), availW = W - 24;
  view.k = Math.min(availH / (2 * halfH), availW / (2 * halfW));
  Object.assign(view, { availW, availH, halfW, halfH });
  view.hx = W / 2; view.hy = top + availH / 2;
  if (ROTOR) {
    // the rotor: a square div as wide as the glass is long, so that it fits at every angle
    view.k = Math.min(availH, availW) / (2 * glass.HBc + 4);
    const D = Math.round(2 * glass.HBc * view.k + 4);
    view.D = D;
    const el = $('rotor');
    Object.assign(el.style, { width: D + 'px', height: D + 'px', left: (view.hx - D / 2) + 'px', top: (view.hy - D / 2) + 'px' });
    for (const id of ['r-back', 'c-gpu', 'r-front']) {
      const c = $(id);
      c.width = Math.round(D * dpr); c.height = Math.round(D * dpr);
      c.style.width = D + 'px'; c.style.height = D + 'px';
    }
    glPaint();
    return;
  }
  drawGlass(true);                                           // (resizing a canvas clears it)
}

/** The drawing scale at the glass's present angle: the whole glass stays on screen as it turns. */
function kNow() {
  if (!view.halfH) return view.k;
  const c = Math.abs(Math.cos(pose.theta)), n = Math.abs(Math.sin(pose.theta));
  const hw = c * view.halfW + n * view.halfH, hh = n * view.halfW + c * view.halfH;
  return Math.min(view.k, view.availH / (2 * hh), view.availW / (2 * hw));
}
function rgba(c, a) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
const TINT = [255, 233, 204];
const WOOD = { hi: [112, 70, 42], mid: [70, 41, 23], lo: [30, 17, 9] };
let drawnKey = '';
/** The glass, back (behind the sand) and front (its wall, rims and wooden caps): physics.js _drawBack/_drawFront, simplified. */
function drawGlass(force) {
  if (!glass || ROTOR) return;
  const kk = kNow();
  const key = [pose.x.toFixed(2), pose.y.toFixed(2), pose.theta.toFixed(4), kk, view.W, view.H, glass.s].join();
  if (key === drawnKey && !force) return;
  drawnKey = key;
  const s = glass.s, q = APP_Q, wall = glass.wallCells, R = glass.Rc, HB = glass.HBc;
  const setT = ctx => {
    const k = kk * view.dpr, c = Math.cos(pose.theta), n = Math.sin(pose.theta);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(k * c, k * n, -k * n, k * c, (view.hx + pose.x) * view.dpr, (view.hy + pose.y) * view.dpr);
  };
  const path = grow => { const p = new Path2D(); traceOutline(p, glass, grow); return p; };
  const outer = path(wall), inner = path(0);

  const b = $('c-back').getContext('2d');
  setT(b);
  b.fillStyle = 'rgba(4,5,7,0.10)'; b.fill(outer);
  const body = b.createLinearGradient(-R - wall, 0, R + wall, 0);
  body.addColorStop(0, rgba(TINT, 0.17)); body.addColorStop(0.16, rgba(TINT, 0.06)); body.addColorStop(0.5, rgba(TINT, 0.018));
  body.addColorStop(0.84, rgba(TINT, 0.06)); body.addColorStop(1, rgba(TINT, 0.17));
  b.fillStyle = body; b.fill(outer);
  b.save(); b.clip(inner);
  b.strokeStyle = rgba(TINT, 0.035); b.lineWidth = 16 * q * s; b.stroke(inner);
  b.strokeStyle = rgba(TINT, 0.045); b.lineWidth = 7 * q * s; b.stroke(inner);
  for (let side = -1; side <= 1; side += 2) {               // a breath of light in each bulb
    const cyB = side * HB * 0.66 * 0.92;
    const gr = b.createRadialGradient(0, cyB, 0, 0, cyB, R * 1.15);
    gr.addColorStop(0, 'rgba(255,176,92,0.04)'); gr.addColorStop(0.55, 'rgba(255,176,92,0.018)'); gr.addColorStop(1, 'rgba(255,176,92,0)');
    b.fillStyle = gr; b.fillRect(-R - 2, cyB - R * 1.2, R * 2 + 4, R * 2.4);
  }
  b.restore();

  const f = $('c-front').getContext('2d');
  setT(f);
  const band = new Path2D(); traceOutline(band, glass, wall); traceOutline(band, glass, 0);
  const wallGr = f.createLinearGradient(-R, 0, R, 0);
  wallGr.addColorStop(0, rgba(TINT, 0.20)); wallGr.addColorStop(0.5, rgba(TINT, 0.09)); wallGr.addColorStop(1, rgba(TINT, 0.20));
  f.fillStyle = wallGr; f.fill(band, 'evenodd');
  f.save(); f.clip(inner);
  f.strokeStyle = rgba(TINT, 0.03); f.lineWidth = 13 * q * s; f.stroke(inner);
  f.strokeStyle = rgba(TINT, 0.04); f.lineWidth = 7 * q * s; f.stroke(inner);
  f.strokeStyle = rgba(TINT, 0.06); f.lineWidth = 3 * q * s; f.stroke(inner);
  f.restore();
  f.strokeStyle = rgba(TINT, 0.42); f.lineWidth = Math.max(0.75 * q * s, 0.9 / (kk * view.dpr)); f.stroke(outer);
  f.strokeStyle = rgba(TINT, 0.22); f.lineWidth = Math.max(0.5 * q * s, 0.7 / (kk * view.dpr)); f.stroke(inner);
  // a soft sheen on the left of each bulb
  for (let side = -1; side <= 1; side += 2) {
    f.save();
    f.clip(inner);
    f.translate(-R * 0.8, side * HB * 0.62);
    f.scale(0.22, 1);
    const r = HB * 0.26, gr = f.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.09)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.035)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    f.fillStyle = gr; f.fillRect(-r, -r, 2 * r, 2 * r);
    f.restore();
  }
  // wooden caps: a collar seating each end and a slab across it
  for (let side = 0; side < 2; side++) {
    f.save();
    if (side) f.rotate(Math.PI);
    const yC = -(HB + 3 * q * s), colW = R * 0.62, collarH = 5 * q * s, slabH = 11 * q * s, sw = R + 24 * q * s;
    const metal = (x0, x1) => {
      const gr = f.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, rgba(WOOD.lo, 1)); gr.addColorStop(0.18, rgba(WOOD.mid, 1));
      gr.addColorStop(0.5, rgba(WOOD.mid.map((v, i) => v + (WOOD.hi[i] - v) * 0.35), 1));
      gr.addColorStop(0.82, rgba(WOOD.mid, 1)); gr.addColorStop(1, rgba(WOOD.lo, 1));
      return gr;
    };
    f.fillStyle = metal(-colW, colW);
    f.fillRect(-colW, yC, colW * 2, collarH + 1.5 * q * s);
    f.fillStyle = metal(-sw, sw);
    const sy = yC - slabH;
    f.beginPath(); f.roundRect ? f.roundRect(-sw, sy, sw * 2, slabH, 2.6 * q * s) : f.rect(-sw, sy, sw * 2, slabH); f.fill();
    const bev = f.createLinearGradient(0, sy, 0, sy + slabH);
    bev.addColorStop(0, 'rgba(0,0,0,0.30)'); bev.addColorStop(0.16, 'rgba(0,0,0,0)'); bev.addColorStop(0.84, 'rgba(0,0,0,0)'); bev.addColorStop(1, 'rgba(0,0,0,0.30)');
    f.fillStyle = bev; f.fillRect(-sw, sy, sw * 2, slabH);
    f.restore();
  }
}

/* ------------------------------------------------------------------ *
 *  The frame loop
 * ------------------------------------------------------------------ */
let lastNow = 0, lastDrawn = 0, acc = 0, rafOn = false, lastSteps = 0, firstFrameLogged = false;
const bootT0 = performance.now();
const rafLog = [];                // rAF timestamps, for the display's own rate
function loop(now) {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  const dtReal = lastNow ? Math.min((now - lastNow) / 1000, 0.25) : 1 / 60;
  lastNow = now;
  rafLog.push(now); while (rafLog.length && now - rafLog[0] > 2000) rafLog.shift();
  if (!solver || !glass || hidden || busy || manual) { lastDrawn = 0; return; }
  // a promise of work done that never came (a lost device): let the loop go on after 3 s (a late
  // promise from before then is ignored: paceDone)
  paceValve(pace, t0);
  // the Timer's clock ticks with every animation frame, drawn or not (the count follows the clock,
  // not the GPU); the Rotor probe's glass turns with the wall's time
  const wall = clockNow();
  if (timer.on) timerBefore(wall);
  if (rotor.on) rotorBefore(dtReal);
  // the power mode (timer.mjs): asleep runs nothing; calm draws every other frame of a 60 Hz
  // display, at the same substep rate (the time of the frame not drawn goes to the next). The
  // inputs are read first: asleep, no substep reads them
  feltSample();
  const mode = modeFor(wall, ratioLast(now));
  if (mode === 'asleep') { sleptFrames++; lastDrawn = 0; acc = 0; if (rotor.on) rotorCss(); return; }
  const T0 = displayMs(), T = frameMsFor(mode, T0);
  paceFrame(pace, T);                 // (the budget is substeps a frame: scaled when T changes)
  if (mode === 'calm' && lastDrawn && now - lastDrawn < T - 0.5 * T0) {
    calmFrames++;
    acc = Math.min(acc + dtReal, capFrame() / rate.hz);
    if (rotor.on) rotorCss();
    return;
  }
  // the GPU is behind: skip a frame rather than queue more (nothing is drawn: it is not a frame);
  // the Rotor probe can also skip every third run itself
  const forced = rotor.on && rotor.skip3 && ++rotor.frameNo % 3 === 0;
  if (pace.inflight >= S.queue || solver.readbacks.every(r => r.pending) || forced) {
    skips.push({ t: now, forced });
    if (forced) rotor.skips++; else paceSkip(pace, t0);
    const avail = acc + dtReal;                             // the next frame drawn catches up, up to its cap
    acc = Math.min(avail, capFrame() / rate.hz);
    behindS += avail - acc;
    trimFrames(now);
    if (rotor.on) rotorCss();
    return;
  }
  // wall time since the last frame drawn (skipped animation frames included; for the statistics, not capped)
  const since = lastDrawn ? (now - lastDrawn) / 1000 : dtReal;
  lastDrawn = now;
  // the budget from the GPU's back-pressure; never cut below the base rate's need in a frame
  if (S.budget) paceBudget(pace, { now: t0, need: Math.ceil(S.hz * T / 1000), top: capAllocHz(), last: lastSteps });
  chooseRate(rateTally(), S.budget && Number.isFinite(pace.budget) ? pace.budget * 1000 / T : Infinity, t0, mode === 'calm');
  const hz = rate.hz, cap = capFrame();
  const available = acc + dtReal;
  acc = Math.min(available, cap / hz);
  const dropped = available - acc;
  behindS += dropped;
  const steps = Math.min(cap, Math.floor((acc + 1e-9) * hz));
  acc -= steps / hz;
  // the metered neck's words for this run: the Timer's valve, or the Rotor probe's (shut)
  const neck = timer.on ? timerWords(steps, wall, hz) : rotor.on ? rotorWords(steps, wall, hz) : null;
  const p = solver.run(steps, set(), fieldAt, enc => renderer.encode(enc, solver.count, grainLook()), neck);
  if (rotor.on) rotorDrawn();
  const tSim = simTime, tSub = performance.now();
  const seq = paceSubmit(pace, tSub);
  lastSteps = steps;
  gpu.device.queue.onSubmittedWorkDone().then(() => {
    const ms = performance.now() - tSub;
    if (!firstFrameLogged) { firstFrameLogged = true; life('first frame', `done ${(performance.now() - bootT0).toFixed(0)} ms after the page's start (${ms.toFixed(0)} ms on the GPU)`); }
    if (!paceDone(pace, seq, steps, ms, T)) return;
    gpuLog.push({ t: now, ms, steps }); while (gpuLog.length && now - gpuLog[0].t > 10000) gpuLog.shift();
  }, () => { paceDone(pace, seq, 0, 0, T); });   // (a failure shows as a missing gpu lag)
  if (p) p.then(t => { if (t) { readbackOk++; onTally(t, tSim, now); if (neck && timer.on) timerReadback(neck, t, tSim); if (neck && rotor.on) rotorReadback(neck, t); } }, e => {
    if (!readbackFails++) { readbackErr = String(e && e.message || e); console.error(e); }
    if (!readbackWarned && readbackFails >= 30 && readbackFails > 10 * readbackOk) {
      readbackWarned = true;
      setStatus('Live measurements are failing on this browser: the HUD, Flow test and auto Hz need them. Copy results has the error.');
    }
  });
  renderer.present();
  drawGlass();
  const gpuHeld = dropped > 1e-6 && cap < capNow();
  pace.binding = gpuHeld || !!rate.held;            // the budget held this frame back: it may rise
  frames.push({ t: now, dt: since * 1000, work: performance.now() - t0, steps, hz, sim: steps / hz, real: since, capped: dropped > 1e-6 && !gpuHeld, gpuHeld, held: rate.held, T, mode });
  trimFrames(now);
  if (benchRun) benchRun.onFrame?.(now);
}
/** The display's frame, ms: the median time between animation frames over the last second. */
function displayMs() {
  const r = rafLog.slice(-61), d = [];
  for (let i = 1; i < r.length; i++) d.push(r[i] - r[i - 1]);
  if (d.length < 3) return 1000 / 60;
  d.sort((a, b) => a - b);
  return Math.max(4, Math.min(100, d[d.length >> 1]));
}
/** The substeps this frame may run: the cap, and the GPU's budget. */
function capFrame() { return S.budget && Number.isFinite(pace.budget) ? Math.max(1, Math.min(capNow(), pace.budget)) : capNow(); }
/** The most substeps a frame could want: the cap at the highest rate. */
function capAllocHz() { return Rate.capTop(S); }
function trimFrames(now) {
  while (frames.length && now - frames[0].t > 4000) frames.shift();
  while (skips.length && now - skips[0].t > 4000) skips.shift();
}

function onTally(t, tSim, now) {
  t.simTime = tSim;
  lastTally = t;
  clampLog.push({ t: now ?? performance.now(), n: t.clamped });
  while (clampLog.length > 2 && clampLog[clampLog.length - 1].t - clampLog[0].t > 2000) clampLog.shift();
  if (flowRec) flowRec.add(t);
}

/**
 * The frames drawn over the last windowMs: fps drawn, the time between frames drawn (median,
 * p95, worst), the share of animation frames skipped because the GPU was busy, substeps a frame,
 * simulated over real time, and how often the per-frame cap held the simulation back.
 */
function frameStats(windowMs = 2000, list = frames, skipList = skips) {
  // up to the latest frame, drawn or skipped (with every frame skipped, the last drawn may be long ago)
  const now = Math.max(list.length ? list[list.length - 1].t : 0, skipList.length ? skipList[skipList.length - 1].t : 0);
  const f = list.filter(x => now - x.t <= windowMs);
  if (!f.length) return skipList.length ? { n: 0, fps: 0, skipped: 1, capped: 0, gpuHeld: 0, held: 0, display: NaN, median: NaN, p95: NaN, worst: NaN, gpu: NaN, gpu95: NaN, msStep: NaN, lagFrames: NaN, steps: 0, ratio: 0, work: NaN, hzMax: 0, wantMax: 0 } : null;
  const d = f.map(x => x.dt).sort((a, b) => a - b);
  const q = p => d[Math.min(d.length - 1, Math.floor(p * (d.length - 1) + 0.5))];
  const real = f.reduce((s, x) => s + x.real, 0), sim = f.reduce((s, x) => s + x.sim, 0);
  const t0 = f[0].t, gl = gpuLog.filter(x => x.t >= t0 && x.t <= now), g = gl.map(x => x.ms).sort((a, b) => a - b);
  // the GPU's time a substep: submit-to-done over substeps (with 1 frame in flight, the frame's own
  // time; it includes the frame's drawing, so it is an upper bound)
  const glS = gl.reduce((s, x) => s + (x.steps || 0), 0), msStep = glS ? gl.reduce((s, x) => s + (x.steps ? x.ms : 0), 0) / glS : NaN;
  const gq = p => g.length ? g[Math.min(g.length - 1, Math.floor(p * (g.length - 1) + 0.5))] : NaN;
  const skipped = skipList.filter(x => x.t >= t0 - 1 && x.t <= now).length;
  const r = rafLog.filter(x => now - x <= windowMs);
  const out = {
    gpu: gq(0.5), gpu95: gq(0.95), msStep,
    gpuHeld: f.filter(x => x.gpuHeld).length / f.length, held: f.filter(x => x.held).length / f.length,
    hzMax: Math.max(...f.map(x => x.hz)), wantMax: Math.max(...f.map(x => x.held || x.hz)),
    n: f.length, median: q(0.5), p95: q(0.95), worst: d[d.length - 1], fps: f.length / Math.max(real, 1e-6),
    skipped: skipped / (skipped + f.length), capped: f.filter(x => x.capped).length / f.length,
    display: r.length > 1 ? (r.length - 1) / ((r[r.length - 1] - r[0]) / 1000) : NaN,
    steps: f.reduce((s, x) => s + x.steps, 0) / f.length, ratio: sim / Math.max(real, 1e-6),
    work: f.map(x => x.work).sort((a, b) => a - b)[Math.floor(f.length / 2)]
  };
  out.lagFrames = out.gpu / (1000 / (out.display || 60));
  return out;
}
/** Why the simulation runs slower than real time, if it does. */
function behindWhy(f) {
  if (!f || f.ratio >= 0.97) return '';
  if (f.gpuHeld > 0.2) return '  BEHIND (GPU budget)';
  if (f.skipped > 0.05) return '  BEHIND (GPU)';
  if (f.capped > 0.2) return '  BEHIND (cap at ' + Math.round(f.display || 0) + ' Hz)';
  return '  BEHIND';
}
function clampRate() {
  if (clampLog.length < 2) return 0;
  const a = clampLog[0], b = clampLog[clampLog.length - 1];
  return (b.n - a.n) / Math.max(0.001, (b.t - a.t) / 1000);
}

function hud() {
  if (!S.hud || !glass) return;
  const f = frameStats(), t = lastTally;
  const lines = [];
  // the Timer's and the Rotor probe's lines first (the HUD grows to hold them)
  if (timer.on) lines.push(...timerHud());
  if (rotor.on) lines.push(`Rotor: ${pose.omega.toFixed(1)} rad/s, ${rotor.swaps} half-turn swaps, runs ${rotor.runs}, skipped ${rotor.skips} by hand${rotor.skip3 ? ' (every third)' : ''}, canvas turned in ${rotor.cssTurns} frames; sand in the wrong bulb ${rotor.wrong} of ${rotor.checked} readbacks`);
  if (timer.on || rotor.on || S.mode !== 'full') lines.push(`mode ${modes.mode} (${S.mode}: ${modes.why}${modes.guard ? ', heat guard' : ''})  asleep ${sleptFrames}, calm skips ${calmFrames} frames`);
  $('hud').classList.toggle('tall', lines.length > 0);
  if (f) lines.push(`drawn ${f.fps.toFixed(0)} fps (display ${Number.isFinite(f.display) ? f.display.toFixed(0) : '-'})  skipped ${Math.round(f.skipped * 100)}%${behindWhy(f)}`);
  if (f) lines.push(`frame ms ${f.median.toFixed(1)} med ${f.p95.toFixed(1)} p95 ${f.worst.toFixed(1)} max  lag ${Number.isFinite(f.gpu) ? f.gpu.toFixed(0) + ' (' + f.lagFrames.toFixed(1) + ' fr)' : '-'}`);
  if (f) lines.push(`steps ${f.steps.toFixed(1)}/frame  ${rate.hz} Hz${S.auto ? (rate.held ? ' HELD (wants ' + rate.held + ')' : rate.hz > S.hz ? ' auto↑' : ' auto') : ''} x${S.iterations}  sim/real ${f.ratio.toFixed(2)}`);
  if (f) lines.push(`gpu ${Number.isFinite(f.msStep) ? f.msStep.toFixed(2) + ' ms/step' : '-'}  budget ${S.budget ? (Number.isFinite(pace.budget) ? pace.budget + '/fr' : '-') : 'off'}  ${dispatchesPerSubstep(S.iterations, set().material)} disp  ≤${S.queue} queued`);
  const cr = clampRate();
  lines.push(`points ${solver.count.toLocaleString('en-US')}  clamp ${cr > 0 ? Math.round(cr) + '/s HIT' : '0'}  fastest ${t ? Math.round(t.maxSpeed) : 0} cells/s`);
  lines.push(`grid ${RES_NAME[S.res]} ${glass.W}x${glass.H}  neck ${glass.neckCells.toFixed(1)}${glass.neckWidened > 0.005 ? ' (+' + Math.round(glass.neckWidened * 100) + '%)' : ''}  g ${Math.round(gCells())}/s²${S.speed === 'real' ? ' (11 cm)' : ''}`);
  if (S.speed === 'real' && rate.held && cr > 0) lines.push(`real speed: this GPU gives ${rate.hz} Hz, true g wants ${rate.held}: the fastest grains are held back`);
  if (readbackFails) lines.push(`readbacks FAILING ${readbackFails} (ok ${readbackOk}): live numbers stale`);
  if (S.input === 'motion') lines.push(motion.seen ? `motion (${motion.gx.toFixed(2)}, ${motion.gy.toFixed(2)}) g  turn ${motion.w.toFixed(1)}/s  sign ${motion.sign || '?'}  axis ${motion.rSign < 0 ? '-' : ''}${motion.rAxis || '?'}${motion.rLearnt ? '' : '?'}` : 'motion: no readings yet');
  $('hud').textContent = lines.join('\n');
}

/* ------------------------------------------------------------------ *
 *  Flow test: how fast the sand crosses the neck, against how full the top is
 * ------------------------------------------------------------------ */
function flowRecorder() {
  return {
    samples: [], start: null,
    add(t) {
      if (t.simTime < gateUntil) return;
      if (!this.start) this.start = { t: t.simTime, above: t.above };
      this.samples.push({ t: t.simTime, above: t.above, below: t.below });
    },
    done() { return this.start && (this.samples[this.samples.length - 1].above < 0.03 * this.start.above || this.samples[this.samples.length - 1].t - this.start.t > 90); }
  };
}
/** Rate (points/s) by a straight-line fit over the samples whose fill lies within ±w of f. */
function rateAt(samples, a0, f, w = 0.1) {
  const s = samples.filter(x => Math.abs(x.above / a0 - f) <= w);
  if (s.length < 3) return NaN;
  const n = s.length, mt = s.reduce((p, x) => p + x.t, 0) / n, ma = s.reduce((p, x) => p + x.above, 0) / n;
  let num = 0, den = 0;
  for (const x of s) { num += (x.t - mt) * (x.above - ma); den += (x.t - mt) ** 2; }
  return den > 0 ? -num / den : NaN;
}
function flowSummary(rec) {
  const a0 = rec.start.above, smp = rec.samples;
  const toGrains = r => r / (PPC * PPC) / (glass.s * glass.s);   // points/s -> the app's grains/s
  const r75 = rateAt(smp, a0, 0.75), r25 = rateAt(smp, a0, 0.25);
  const curve = [];
  for (let f = 0.9; f >= 0.1 - 1e-9; f -= 0.05) curve.push({ fill: +f.toFixed(2), rate: rateAt(smp, a0, f, 0.05) });
  const last = smp[smp.length - 1];
  return {
    material: S.material, amount: S.amount, res: S.res, speed: S.speed, hz: S.hz, iterations: S.iterations,
    neckCells: glass.neckCells, start: a0, duration: last.t - rec.start.t,
    rate75: r75, rate25: r25, ratio: r75 / r25, grains75: toGrains(r75), grains25: toGrains(r25), curve,
    // how long the whole top takes, in simulated seconds
    emptied: last.above < 0.03 * a0
  };
}
function drawFlowGraph(canvas, res) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, pad = 34;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '20px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(236,231,223,0.6)';
  const pts = res.curve.filter(p => Number.isFinite(p.rate));
  const ymax = Math.max(1, ...pts.map(p => p.rate)) * 1.15;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad, 8); ctx.lineTo(pad, H - pad); ctx.lineTo(W - 8, H - pad); ctx.stroke();
  ctx.fillText('rate', 4, 22); ctx.fillText('full', pad, H - 8); ctx.fillText('empty', W - 80, H - 8);
  const X = f => pad + (1 - f) * (W - pad - 12), Y = r => H - pad - r / ymax * (H - pad - 12);
  ctx.strokeStyle = '#e9b872'; ctx.lineWidth = 4; ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p.fill), Y(p.rate)) : ctx.moveTo(X(p.fill), Y(p.rate))));
  ctx.stroke();
  ctx.fillStyle = '#e9b872';
  for (const p of pts) { ctx.beginPath(); ctx.arc(X(p.fill), Y(p.rate), 5, 0, 7); ctx.fill(); }
}
async function flowTest(opts = {}) {
  const mat = opts.material || S.material;
  const prevInput = S.input;
  S.input = 'upright';
  await resetSand({ fill: 'top', amount: opts.amount || 'full', points: opts.points, material: mat, gate: opts.gate ?? 0.6 });
  const rec = flowRecorder();
  flowRec = rec;
  setStatus('Flow test: the top bulb is draining…');
  try {
    if (opts.manual) {
      const chunk = opts.chunk || 32, limit = opts.limit ?? 90;
      while (!rec.done() && simTime < limit) {
        const t = await stepN(chunk);
        // (stepN feeds the recorder through onTally)
        if (!t) break;
      }
    } else {
      await new Promise(res => { const iv = setInterval(() => { if (rec.done() || !flowRec) { clearInterval(iv); res(); } }, 200); });
    }
  } finally { flowRec = null; S.input = prevInput; syncUI(); }
  if (!rec.start || rec.samples.length < 5) { setStatus('Flow test: no flow measured'); return null; }
  flowResult = flowSummary(rec);
  flowResults.push(flowResult);
  setStatus('');
  if (!opts.quiet) showFlow(flowResult);
  return flowResult;
}
function showFlow(r) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 300;
  const body = document.createElement('div');
  const f = v => Number.isFinite(v) ? v.toFixed(0) : '—';
  body.innerHTML = `<p>${MATERIALS[r.material].label}, ${AMOUNT_NAME[r.amount]} glass, ${RES_NAME[r.res]} grid, ${r.speed} speed, neck ${r.neckCells.toFixed(1)} cells.</p>
    <p>Rate through the neck, in the app's grains a second: <b>${f(r.grains75)}</b> with the top three-quarters full,
    <b>${f(r.grains25)}</b> with it a quarter full. Ratio <b>${Number.isFinite(r.ratio) ? r.ratio.toFixed(2) : '—'}</b>
    (sand in a real hourglass: about 1; a liquid: well above 1).</p>`;
  body.appendChild(c);
  const p = document.createElement('p'); p.textContent = `Simulated time to drain: ${r.duration.toFixed(1)} s.`; body.appendChild(p);
  drawFlowGraph(c, r);
  showSheet('Flow test', body);
}

/* ------------------------------------------------------------------ *
 *  The setup on first load: the largest amount and grid this device holds in real time
 * ------------------------------------------------------------------ */
// points a fill makes, per grid and amount (the page's own fills)
const SETUP_POINTS = { S: { minute: 4752, quarter: 16971, full: 40731 }, M: { minute: 7175, quarter: 25626, full: 61502 }, L: { minute: 11211, quarter: 40040, full: 96097 } };
const SETUP_KEY = 'hourglass-lab-sand-setup';
// the rate a setup must hold with room (GPU_SHARE of the GPU): the peak auto Hz at app speed (a pour)
const SETUP_HZ = 1440;
// What the first-load setup may pick: the coarse grid only (the scoreboard and the lab test judged the
// sand's realism on that grid alone), 1 minute or a quarter. GPU time a substep against coarse,
// 1 minute, from the owner's iPhone at 5cc11b3 (its real-speed rows, where the GPU was the limit:
// coarse, 1 minute at most 0.36 ms a substep, coarse, quarter 0.99 ms): x2.74. (The cost model gave
// x2.11 and would have picked setups the phone could not hold.) The spread pass, added since, costs
// about the same share of both. To be refitted from the Benchmark's gpu ms/substep column.
const SETUP_CANDIDATES = [{ res: 'S', amount: 'minute', x: 1 }, { res: 'S', amount: 'quarter', x: 2.74 }];
const setupInfo = { state: 'none', text: '' };
function setupSaved() { try { return JSON.parse(localStorage.getItem(SETUP_KEY) || 'null'); } catch (e) { return null; } }
function setupSave(o) { try { localStorage.setItem(SETUP_KEY, JSON.stringify(o)); } catch (e) { /* the choice is only for this visit */ } }
/**
 * Time the default for a couple of seconds as it pours (the live loop), then pick the larger of
 * SETUP_CANDIDATES whose substeps, scaled from that timing by the phone's own ratios, take under
 * GPU_SHARE of the GPU at SETUP_HZ; say what was picked. The timing is submit-to-done over substeps
 * (an upper bound: it includes the drawing, the wait for the frame before, and a phone's floor of
 * about one display frame for a light frame), so the pick errs toward the default. Frames too light
 * to time (under 8 substeps on average) give no pick. A pick is kept for the next visit; a timing
 * that leaves only the default is not (the next visit times again; ?setup in the address too), and
 * the owner's own choice of amount or grid afterwards is kept.
 */
async function autoSetup() {
  setupInfo.state = 'timing';
  setStatus('Timing this phone for a moment…');
  await sleep(2600);
  const f = frameStats(2000);
  if (!f || !Number.isFinite(f.msStep) || hidden || S.res !== DEFAULT_SETUP.res || S.amount !== DEFAULT_SETUP.amount) {
    setupInfo.state = 'skipped'; setupInfo.text = 'not timed (the page was hidden or changed)'; setStatus(''); return;
  }
  const name = c => `${RES_NAME[c.res]} grid, ${AMOUNT_NAME[c.amount]}`;
  if (!(f.steps >= 8)) {
    setupInfo.state = 'skipped';
    setupInfo.text = `kept ${name(DEFAULT_SETUP)}: the frames were too light to time (${f.steps.toFixed(1)} substeps a frame; ${f.msStep.toFixed(2)} ms a substep, an upper bound)`;
    setStatus(''); return;
  }
  const ms0 = f.msStep;
  const scored = SETUP_CANDIDATES.map(c => ({ ...c, ms: ms0 * c.x, load: ms0 * c.x * SETUP_HZ / 1000 }));
  const fits = scored.filter(c => c.load <= GPU_SHARE);
  const pick = fits.length ? fits[fits.length - 1] : scored[0];
  const moved = pick.res !== DEFAULT_SETUP.res || pick.amount !== DEFAULT_SETUP.amount;
  const next = scored[scored.indexOf(pick) + 1];
  setupInfo.state = 'auto';
  setupInfo.text = `${moved ? 'picked' : 'kept'} ${name(pick)} on first load: the default (${name(DEFAULT_SETUP)}) took at most ${ms0.toFixed(2)} ms of GPU a substep here (${f.steps.toFixed(0)} substeps a frame, display ${Math.round(f.display || 0)} Hz); ` +
    `scaled by the iPhone's own ratios, ${name(pick)} would take ${Math.round(pick.load * 100)}% of the GPU at ${SETUP_HZ} Hz (the most a pick may: ${Math.round(GPU_SHARE * 100)}%)` +
    (next ? `; ${name(next)} ${Math.round(next.load * 100)}%` : '') + '. Realism was judged on the coarse grid only, so the setup never leaves it';
  if (moved) { setupSave({ res: pick.res, amount: pick.amount, by: 'auto', ms: +ms0.toFixed(3) }); await resetSand({ res: pick.res, amount: pick.amount }); }
  setStatus(moved ? `Set up for this phone: ${name(pick)}. The buttons change it.` : '');
}

/* ------------------------------------------------------------------ *
 *  Benchmark
 * ------------------------------------------------------------------ */
// the costly options the Benchmark times at the page's default, against it
const BENCH_OPTIONS = [
  { tag: 'spread off', set: { spread: false } },
  { tag: 'blur off', set: { blur: 0 } },
  { tag: '8 iterations', set: { iterations: 8 } },
  { tag: 'yield in loop', set: { yieldIn: true } }
];
async function benchmark(opts = {}) {
  const warm = opts.warm ?? 0.7, measure = opts.measure ?? 2.5;
  const keep = { res: S.res, amount: S.amount, speed: S.speed, hz: S.hz, iterations: S.iterations, cap: S.cap, material: S.material, spread: S.spread, blur: S.blur, yieldIn: S.yieldIn };
  const combos = [];
  // first the page's default (grid, amount) at both speeds, and the costly options at it (app
  // speed): in the Benchmark from the button, or when asked for
  if (opts.options ?? !opts.res) {
    for (const speed of ['app', 'real']) combos.push({ res: DEFAULT_SETUP.res, amount: DEFAULT_SETUP.amount, speed, tag: 'default' });
    for (const o of BENCH_OPTIONS) combos.push({ res: DEFAULT_SETUP.res, amount: DEFAULT_SETUP.amount, speed: 'app', ...o });
  }
  for (const res of opts.res || ['S', 'M', 'L']) for (const amount of opts.amounts || ['minute', 'quarter', 'full']) for (const speed of opts.speeds || ['app', 'real']) combos.push({ res, amount, speed });
  benchRows = [];
  const btn = $('b-bench'); btn.classList.add('busy');
  try {
    for (const [i, c] of combos.entries()) {
      setStatus(`Benchmark ${i + 1}/${combos.length}: ${RES_NAME[c.res]} grid, ${AMOUNT_NAME[c.amount]}, ${c.speed} speed${c.tag ? ', ' + c.tag : ''}`);
      Object.assign(S, { spread: keep.spread, blur: keep.blur, yieldIn: keep.yieldIn }, c.set || {});
      await resetSand({ res: c.res, amount: c.amount, speed: c.speed, ...SPEED_DEFAULTS[c.speed], ...(c.set?.iterations ? { iterations: c.set.iterations } : {}), material: keep.material, gate: 0 });
      benchRun = { t0: simTime };
      clampLog.length = 0; rate.peak = rate.hz;
      await sleep(warm * 1000);
      const from = performance.now(), c0 = lastTally?.clamped ?? 0, behind0 = behindS, hiddenAt0 = hiddenCount;
      await sleep(measure * 1000);
      const list = frames.filter(f => f.t >= from), skipList = skips.filter(f => f.t >= from);
      // the frames submitted in the window are timed when they are done (on a slow GPU, after it)
      const seqEnd = pace.seq, tWait = performance.now();
      while (pace.doneSeq < seqEnd && pace.valveSeq < seqEnd && performance.now() - tWait < 8000) await sleep(50);
      const st = frameStats(1e9, list, skipList) || {};
      const c1 = lastTally?.clamped ?? c0;
      benchRows.push({
        res: RES_NAME[c.res], amount: AMOUNT_NAME[c.amount], speed: c.speed, tag: c.tag || '', points: solver.count, hz: S.hz, peakHz: rate.peak, it: S.iterations, cap: S.cap,
        median: st.median, p95: st.p95, worst: st.worst, fps: st.fps, skipped: st.skipped, capped: st.capped, display: st.display,
        steps: st.steps, ratio: st.ratio, work: st.work, gpu: st.gpu, gpu95: st.gpu95, lagFrames: st.lagFrames,
        msStep: st.msStep, gpuHeld: st.gpuHeld, held: st.held, hzMax: st.hzMax, wantMax: st.wantMax, dispatches: dispatchesPerSubstep(S.iterations, set().material),
        clampPerS: (c1 - c0) / measure, behind: behindS - behind0, interrupted: hiddenCount !== hiddenAt0
      });
      benchRun = null;
      if (hiddenCount !== hiddenAt0) { setStatus('Benchmark stopped: the page was hidden'); break; }
    }
  } finally {
    benchRun = null; btn.classList.remove('busy');
    Object.assign(S, { spread: keep.spread, blur: keep.blur, yieldIn: keep.yieldIn });
    await resetSand({ ...keep, gate: GATE_S });
    setStatus('');
  }
  if (!opts.quiet) showBench();
  return benchRows;
}
function benchTable(rows) {
  const n = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '—';
  return '<table><tr><th>grid</th><th>sand</th><th>speed</th><th>points</th><th>Hz</th><th>fps</th><th>skip</th><th>med</th><th>p95</th><th>worst</th><th>lag</th><th>steps</th><th>sim/real</th><th>gpu ms/step</th><th>clamp/s</th></tr>' +
    rows.map(r => `<tr><td>${r.res}${r.tag ? ' (' + r.tag + ')' : ''}${r.interrupted ? ' (hidden)' : ''}</td><td>${r.amount}</td><td>${r.speed}</td><td>${r.points}</td><td>${r.hz}${r.peakHz > r.hz ? '–' + r.peakHz : ''}${r.wantMax > r.hzMax ? ' (held; wants ' + r.wantMax + ')' : ''}</td><td>${n(r.fps, 0)}</td><td>${n(100 * r.skipped, 0)}%</td><td>${n(r.median)}</td><td>${n(r.p95)}</td><td>${n(r.worst)}</td><td>${n(r.gpu)}</td><td>${n(r.steps)}</td><td>${n(r.ratio, 2)}</td><td>${n(r.msStep, 2)}</td><td>${n(r.clampPerS, 0)}</td></tr>`).join('') + '</table>';
}
function showBench() {
  const d = document.createElement('div');
  d.innerHTML = '<p>Over a few seconds of sand pouring and shaken: fps, the frames drawn a second; skip, the share of display frames skipped because the GPU was still busy; the time between frames drawn in ms (median, 95th percentile, worst); lag, the median time from a frame\'s submit until the GPU has done it (with one frame in flight, the frame\'s own GPU time); gpu ms/step, that lag over the frame\'s substeps (its drawing included). sim/real under 1 means the simulation fell behind; "held" means auto Hz stayed below the rate the sand wanted because the GPU could not afford it; clamp/s counts grid nodes held to the per-substep speed limit. The first rows are the page\'s default and its costly options.</p>' + benchTable(benchRows);
  showSheet('Benchmark', d);
}

/* ------------------------------------------------------------------ *
 *  Results for the clipboard
 * ------------------------------------------------------------------ */
/** The Timer's lines for Copy results. */
function timerReport(n) {
  const st = timerState();
  if (!st) return ['Timer: not run'];
  const L = [''];
  const N = st.n;
  L.push(`Timer: ${st.label} (${st.grains} grains = ${st.points} points at ${st.ppg.toFixed(3)} points a grain, timed to ${mmss(st.ms)}), ${st.on ? st.state : 'stopped'}; ${mmss(st.rem)} left; nTop ${st.nTop}, target ${st.target}; ${st.swaps} swaps; mode setting ${st.setting}, heat guard ${st.guard ? 'engaged' : 'not engaged'}`);
  L.push(`  clock: tail ${st.clock.tailMs.toFixed(0)} ms, ${st.clock.tailGrains} grains in the tail, ${n(st.clock.rate)} grains/s in the bulk`);
  L.push(`  the neck: ${N.runs} runs read back (${N.open} open, ${N.closedRuns} shut); runs whose crossings left fewer above than their lowest target ${N.viol}; crossings while shut ${N.closedCross}; start + appended - crossings != above in ${N.mismatch}; point counts off ${N.pointsOff}; the valve's audit failed ${N.auditFails} of ${N.audits}`);
  L.push(`  the count: nTop off the app's target in ${N.countOff} of ${N.supplied} open running frames; bulk runs (from 2 s after the start and 1 s after a swap) short ${N.short} of ${N.bulk} (worst ${N.worstShort} points), before that ${N.coldShort} of ${N.cold} (worst ${N.coldWorst}); mean queue ${n(st.queue)} points, mean vcap ${n(st.vcap, 2)} cells/s, gain kv ${n(st.kv)}; refused ${N.refused} crossings (now ${n(st.refusedPerS, 0)}/s), upward ${N.upward}`);
  L.push(`  the stream's first fall, neck to floor (${n(st.floor)} cells): ${Number.isFinite(st.fall) ? n(st.fall, 3) + ' s simulated, ' + n(st.fallWall / 1000, 3) + ' s wall' : 'not measured'}`);
  if (st.ends.length) st.ends.forEach((e, i) => L.push(`  end ${i + 1}: ${endText(e)}${e.last ? ' (a substep is ' + n(e.last.substep, 2) + ' ms)' : ''}`));
  else L.push('  end: not reached');
  if (st.failed) L.push(`  STALLED: no readback for 60 runs ${n((st.failed.at - timer.began) / 1000)} s after the Timer began${st.failed.pending ? ', a swap\'s base waiting' : ''} (in the app the current sand would take over)`);
  return L;
}
function reportText() {
  const L = [];
  const n = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '-';
  L.push('Hourglass sand lab results');
  L.push('Date: ' + new Date().toISOString());
  L.push('Device: ' + navigator.userAgent);
  const i = gpu?.info || {};
  L.push(`WebGPU adapter: vendor=${i.vendor || '?'} architecture=${i.architecture || '?'} device=${i.device || '?'} description=${i.description || '?'}${i.fallback ? ' (fallback)' : ''}`);
  L.push(`Screen: ${screen.width}x${screen.height} CSS px, devicePixelRatio ${window.devicePixelRatio}, window ${innerWidth}x${innerHeight}, screen angle ${screenAngle()}, standalone ${!!(navigator.standalone || matchMedia('(display-mode: standalone)').matches)}`);
  L.push(`Errors: start ${startError || 'none'}; GPU lost ${lostReason || 'no'}; WebGPU ${solver?.errors?.length ? solver.errors.join(' | ') : 'none'}; live readbacks ${readbackOk} ok, ${readbackFails} failed${readbackErr ? ' (' + readbackErr + ')' : ''}`);
  L.push(`Engine build: ${BUILD} (realsand/build.mjs); this page was written for ${BUILD_EXPECTED}${BUILD === BUILD_EXPECTED ? '' : ': A MIX OF OLD AND NEW FILES'}`);
  L.push(`Now: ${MATERIALS[S.material].label}, ${AMOUNT_NAME[S.amount]} glass, ${RES_NAME[S.res]} grid (${glass?.W}x${glass?.H}, neck ${glass?.neckCells.toFixed(1)} cells), ${S.speed} speed (g ${Math.round(gCells())} cells/s²${S.speed === 'real' ? ', true g for an 11 cm glass' : ''}; the glass is drawn ${n(drawnMM() / 10)} cm tall), ${S.hz} Hz x ${S.iterations} iterations (auto Hz ${S.auto ? 'on, up to ' + hzTop() + ' Hz; highest since reset ' + rate.peak : 'off'}), cap ${S.cap}/frame at the base rate, clamp ${S.maxStep} cell; jolts at app speed ${JOLT_SAYS[S.jolts] || S.jolts}${S.jolts === 'slowmo' || S.jolts === 'film' ? ' (x' + (1 / Math.sqrt(lamNow())).toFixed(1) + ' longer)' : ''}; spread ${S.spread ? 'on' : 'off'}; yield ${S.yieldIn ? 'in loop' : 'at end'}; blur ${S.blur ? S.blur + ' frame' : 'off'}`);
  L.push(`Motion: input ${S.input}, readings ${motion.seen ? 'yes' : 'no'}, sign ${motion.sign || 'not learnt'}, units ${motion.unit ? (motion.unit > 1 ? 'g' : 'm/s²') : '?'}, turn axis ${motion.rAxis || '?'} sign ${motion.rSign} (${motion.rLearnt ? 'learnt' : 'assumed'})`);
  const f = frameStats();
  L.push(`Setup: ${setupInfo.text || (setupInfo.state === 'none' ? 'from the address (no timing)' : setupInfo.state)}`);
  L.push(`Pace: at most ${S.queue} frame${S.queue > 1 ? 's' : ''} of GPU work in flight; GPU budget ${S.budget ? 'on (cut when frames are skipped for want of the GPU, raised while it keeps up, not below the base rate\'s need unless that fails for 1 s' + (Number.isFinite(pace.budget) ? '; now ' + pace.budget + ' substeps a frame, lowest ' + pace.minBudget + ', ' + pace.cuts + ' cuts, ' + pace.raises + ' raises' : '; not needed yet') + ')' : 'off'}; ${dispatchesPerSubstep(S.iterations, set().material)} dispatches a substep; frames whose submit-to-done took over 1.2 display frames since reset: ${pace.overran}${S.hzMax ? '; auto Hz capped at ' + S.hzMax : ''}`);
  if (f) L.push(`Last 2 s: ${n(f.fps, 0)} frames drawn a second, display ${n(f.display, 0)} Hz, ${n(100 * f.skipped, 0)}% skipped (GPU busy), ${n(100 * f.capped, 0)}% held by the cap, ${n(100 * f.gpuHeld, 0)}% held by the GPU budget, auto Hz held back in ${n(100 * f.held, 0)}% (rate ${f.hzMax}${f.wantMax > f.hzMax ? ', wanted ' + f.wantMax : ''}); between frames median ${n(f.median)} ms, p95 ${n(f.p95)}, worst ${n(f.worst)}; submit-to-done lag median ${n(f.gpu)} ms (${n(f.lagFrames)} display frames), p95 ${n(f.gpu95)}; GPU ${n(f.msStep, 2)} ms a substep; ${n(f.steps)} substeps/frame, sim/real ${n(f.ratio, 2)}`);
  const ms = modes.ms, msAll = ms.full + ms.calm + ms.asleep;
  L.push(`Mode: ${S.mode}${S.mode === 'auto' ? ' (the app\'s rules: full, calm at 30 frames a second and the same substep rate, asleep)' : ' (set by hand)'}; now ${modes.mode} (${modes.why}); time in each: full ${n(ms.full / 1000)} s, calm ${n(ms.calm / 1000)} s, asleep ${n(ms.asleep / 1000)} s${msAll ? '' : ' (not tracked yet)'}; heat guard ${modes.guard ? 'ENGAGED (full under 0.6 of real time for 20 s)' : 'not engaged'}`);
  for (const line of timerReport(n)) L.push(line);
  if (bursts.length) {
    L.push('');
    L.push('GPU cost by a burst (design 9.3: with nothing else in flight; the slope removes a submit\'s latency)');
    for (const r of bursts) L.push('  ' + burstText(r));
  } else L.push('GPU cost by a burst: not measured (a Timer measures it on its bed before its clock starts; More, "GPU cost", on the bed in the glass)');
  if (rotor.on || ROTOR) L.push(`Rotor probe: ${rotor.def ? rotor.def.label + ' bed, ' + rotor.points + ' points' : 'not started'}; turning ${pose.omega.toFixed(1)} rad/s (aim ${rotor.w}); ${rotor.swaps} half-turn swaps; ${rotor.runs} runs, ${rotor.skips} skipped by hand${rotor.skip3 ? ' (every third)' : ''}; the grains' canvas turned half a turn in ${rotor.cssTurns} frames (a run skipped since a swap); readbacks with sand in the wrong bulb ${rotor.wrong} of ${rotor.checked}`);
  L.push('');
  L.push('Lifecycle (ms since the page began): ' + lifeLog.map(e => `${e.t.toFixed(0)} ${e.kind}${e.detail ? ' (' + e.detail + ')' : ''}`).join('; '));
  const def = benchRows.filter(r => r.tag === 'default'), opt = benchRows.filter(r => r.tag && r.tag !== 'default');
  if (def.length) {
    L.push('');
    L.push('Answers (from the Benchmark: sand pouring and shaken, a few seconds a row)');
    if (S.res !== DEFAULT_SETUP.res || S.amount !== DEFAULT_SETUP.amount) L.push(`(These judge the default, ${RES_NAME[DEFAULT_SETUP.res]} grid, ${AMOUNT_NAME[DEFAULT_SETUP.amount]}. The page is now on ${RES_NAME[S.res]} grid, ${AMOUNT_NAME[S.amount]}: its own rows are in the table below, if the Benchmark ran them.)`);
    for (const r of def) {
      const holds = r.ratio >= 0.95;
      L.push(`Default, ${r.res} grid, ${r.amount}, ${r.speed} speed: ${holds ? 'HOLDS real time' : 'does NOT hold real time'} (sim/real ${n(r.ratio, 2)}, ${n(r.fps, 0)} frames a second on a ${n(r.display, 0)} Hz display, ${n(100 * r.skipped, 0)}% skipped); substep rate ${r.hz}${r.peakHz > r.hz ? ' to ' + r.peakHz : ''} Hz${r.wantMax > r.hzMax ? ', held below the ' + r.wantMax + ' Hz the sand wanted in ' + n(100 * r.held, 0) + '% of frames' : ', never held back'}; lag ${n(r.gpu, 0)} ms = ${n(r.lagFrames)} display frames (p95 ${n(r.gpu95, 0)} ms); GPU ${n(r.msStep, 2)} ms a substep, so the sand's peak rate of ${r.wantMax} Hz would take ${n(r.msStep * r.wantMax / 10, 0)}% of the GPU; clamp ${n(r.clampPerS, 0)}/s${r.speed === 'real' && r.clampPerS > 0 ? ' (true g needs more substeps than this phone gives: the fastest grains are held to ' + S.maxStep + ' cell a substep and fall slower than real)' : ''}`);
    }
    const base = def.find(r => r.speed === 'app');
    if (base && opt.length) L.push('Costly options at the default (app speed), GPU time a substep against the default: ' + opt.map(r => `${r.tag} ${n(r.msStep, 2)} ms (x${n(r.msStep / base.msStep, 2)}), sim/real ${n(r.ratio, 2)}, rate ${r.hzMax}${r.wantMax > r.hzMax ? ' held' : ''}`).join('; '));
  }
  if (benchRows.length) {
    L.push('');
    L.push('Benchmark (frames drawn a second; % skipped, GPU busy; ms between frames drawn: median / p95 / worst; submit-to-done lag ms: median / p95; substeps a frame; sim/real; GPU ms a substep (lag over substeps, drawing included); clamp hits/s)');
    for (const r of benchRows) L.push(`${r.res.padEnd(6)} ${r.amount.padEnd(8)} ${r.speed.padEnd(4)} ${String(r.points).padStart(6)} pts ${r.hz}${r.peakHz > r.hz ? '-' + r.peakHz : ''} Hz${r.wantMax > r.hzMax ? ' (held; wanted ' + r.wantMax + ')' : ''} x${r.it} cap ${r.cap}${r.tag ? ' [' + r.tag + ']' : ''}: ${n(r.fps, 0)} fps, ${n(100 * r.skipped, 0)}% skipped, ${n(r.median)} / ${n(r.p95)} / ${n(r.worst)} ms, lag ${n(r.gpu)} / ${n(r.gpu95)} ms, ${n(r.steps)} steps, sim/real ${n(r.ratio, 2)}, gpu ${n(r.msStep, 3)} ms/substep (${r.dispatches} dispatches), clamp ${n(r.clampPerS, 0)}/s${r.interrupted ? ' (page hidden: not valid)' : ''}`);
  } else L.push('Benchmark: not run');
  if (flowResults.length) for (const r of flowResults) {
    const k = 1 / (PPC * PPC) / (RES[r.res] * RES[r.res]);
    L.push('');
    L.push(`Flow test: ${MATERIALS[r.material].label}, ${AMOUNT_NAME[r.amount]} glass, ${RES_NAME[r.res]} grid, ${r.speed} speed, ${r.hz} Hz x ${r.iterations}, neck ${r.neckCells.toFixed(1)} cells, ${r.start} points`);
    L.push(`  rate at 3/4 full ${n(r.grains75, 0)} grains/s, at 1/4 full ${n(r.grains25, 0)} grains/s, ratio ${n(r.ratio, 2)} (sand in a real hourglass: about 1); drained in ${n(r.duration)} s simulated`);
    L.push('  rate (app grains/s) against fill: ' + r.curve.map(p => `${p.fill}:${n(p.rate * k, 0)}`).join(' '));
  } else L.push('Flow test: not run');
  return L.join('\n');
}
function copyResults() {
  const text = reportText();
  const d = document.createElement('div');
  const note = document.createElement('p'); note.textContent = 'Copying…'; d.appendChild(note);
  const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true; d.appendChild(ta);
  showSheet('Results', d);
  const byHand = () => {
    note.textContent = 'Not copied: select the text below and copy it.';
    setStatus('Copy the text by hand');
    try { ta.focus(); ta.setSelectionRange(0, text.length); } catch (e) { /* selection is optional */ }
  };
  const copied = () => { note.textContent = 'Copied to the clipboard. The text is below too.'; setStatus('Results copied'); };
  // The write must start inside the tap (iOS); success is reported only once it has happened
  let started = false;
  try {
    if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text).then(copied, () => fallbackCopy(ta) ? copied() : byHand()); started = true; }
  } catch (e) { started = false; }
  if (!started) { if (fallbackCopy(ta)) copied(); else byHand(); }
  return text;
}
/** The old way, from the visible text box: true only if the browser says it copied. */
function fallbackCopy(ta) {
  try { ta.focus(); ta.setSelectionRange(0, ta.value.length); return document.execCommand('copy') === true; } catch (e) { return false; }
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let statusTimer = 0;
function setStatus(t) {
  // (with nothing else to say, the line says that the engine is of another build, if it is)
  $('status').textContent = t || STAMP_NOTE;
  clearTimeout(statusTimer);
  if (t && /copied|by hand|Real motion on/.test(t)) statusTimer = setTimeout(() => ($('status').textContent = STAMP_NOTE), /Real motion/.test(t) ? 6000 : 2500);
}
function showSheet(title, node) {
  $('sheet-title').textContent = title;
  const b = $('sheet-body'); b.innerHTML = ''; b.appendChild(node);
  $('sheet').hidden = false;
}
function syncUI() {
  for (const seg of document.querySelectorAll('.seg')) {
    const key = seg.dataset.key;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', String(S[key]) === b.dataset.val);
  }
  for (const b of document.querySelectorAll('.cyc')) {
    const k = b.dataset.key, v = S[k];
    b.textContent = k === 'hz' ? `${v} Hz` : k === 'iterations' ? `${v} iter` : k === 'cap' ? `cap ${v}` : k === 'maxStep' ? `clamp ${v}` : k === 'auto' ? `auto Hz ${v ? 'on' : 'off'}` : k === 'jolts' ? `jolts ${JOLT_LABEL[v] || v}` : k === 'blur' ? `blur ${v === 0 ? 'off' : v === 1 ? '1 frame' : v + ' frame'}` : k === 'spread' ? `spread ${v ? 'on' : 'off'}` : k === 'yieldIn' ? `yield ${v ? 'in loop' : 'at end'}` : k === 'queue' ? `${v} in flight` : k === 'budget' ? `GPU budget ${v ? 'on' : 'off'}` : k === 'mode' ? `mode ${v}` : `Coriolis ${v ? 'on' : 'off'}`;
  }
  if ($('b-spin')) $('b-spin').textContent = `spin ${rotor.w} rad/s`;
  if ($('b-skip3')) $('b-skip3').textContent = `skip every 3rd run: ${rotor.skip3 ? 'on' : 'off'}`;
  if ($('b-timer')) $('b-timer').classList.toggle('on', timer.on);
  $('b-hud').classList.toggle('on', S.hud);
  $('hud').classList.toggle('off', !S.hud);
}
function bindUI() {
  for (const seg of document.querySelectorAll('.seg')) {
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || busyUI()) return;
      const key = seg.dataset.key, val = b.dataset.val;
      if (key === 'input') {
        if (val === 'motion') {
          // the permission request must go out inside this tap
          askMotion().then(r => {
            if (r === 'granted' || r === 'unavailable') { motionStart(); S.input = 'motion'; setStatus(r === 'unavailable' ? 'This browser gives no motion readings' : 'Real motion on. Keep Portrait Orientation Lock on (Control Center).'); }
            else { S.input = 'upright'; setStatus('Motion access was not allowed'); }
            syncUI();
          }, () => { S.input = 'upright'; setStatus('Motion access could not be asked for'); syncUI(); });
          return;
        }
        S.input = val; syncUI(); return;
      }
      if (key === 'material') { switchMaterial(val); return; }
      if (key === 'speed') { S.speed = val; Object.assign(S, SPEED_DEFAULTS[val]); solver.allocUniforms(capAlloc()); resetRate(); syncUI(); return; }
      if (key === 'amount' || key === 'res') {
        resetSand({ [key]: val }).then(() => { setupSave({ res: S.res, amount: S.amount, by: 'owner' }); setupInfo.state = 'owner'; setupInfo.text = `chosen by hand: ${RES_NAME[S.res]} grid, ${AMOUNT_NAME[S.amount]}`; });
        return;
      }
    });
  }
  for (const b of document.querySelectorAll('.cyc')) b.addEventListener('click', () => {
    const k = b.dataset.key, list = CYCLE[k], i = list.indexOf(S[k]);
    S[k] = list[(i + 1) % list.length];
    if (k === 'mode') { S.modeChosen = true; modesReset(modes, clockNow(), 0); }
    if (solver.cap !== capAlloc()) solver.allocUniforms(capAlloc());
    resetRate();
    syncUI();
  });
  $('b-more').addEventListener('click', () => { $('more').hidden = !$('more').hidden; $('b-more').classList.toggle('on', !$('more').hidden); requestAnimationFrame(layout); });
  $('b-flip').addEventListener('click', () => doFlip());
  $('b-reset').addEventListener('click', () => { if (!busyUI()) { if (ROTOR) rotorStart(); else resetSand({}); } });
  $('b-hud').addEventListener('click', () => { S.hud = !S.hud; syncUI(); requestAnimationFrame(layout); });
  $('b-bench').addEventListener('click', () => { if (!busyUI()) benchmark(); });
  $('b-flow').addEventListener('click', () => { if (!busyUI()) flowTest(); });
  $('b-copy').addEventListener('click', () => copyResults());
  $('b-timer').addEventListener('click', () => { if (!busyUI()) showTimers(); });
  $('b-cost').addEventListener('click', () => {
    if (busyUI()) return;
    if (timer.on && timer.state !== 'done') { setStatus('The GPU cost is timed before a Timer starts, or after it ends'); return; }
    setStatus('Timing the GPU…');
    burst({ label: timer.on ? `the Timer's ${timer.def.label} bed` : `the ${AMOUNT_NAME[S.amount] || 'present'} bed` }).then(r => { setStatus(''); if (r) { const d = document.createElement('p'); d.textContent = burstText(r); showSheet('GPU cost', d); } }, e => setStatus('GPU cost failed: ' + (e && e.message || e)));
  });
  $('b-rotor').addEventListener('click', () => { location.href = ROTOR ? location.pathname : location.pathname + '?rotor=1'; });
  if (ROTOR) {
    for (const k of ['input', 'material', 'speed', 'amount', 'res']) document.querySelector(`.seg[data-key="${k}"]`).style.display = 'none';
    for (const id of ['b-flip', 'b-timer', 'b-bench', 'b-flow']) $(id).style.display = 'none';
    $('b-rotor').textContent = 'Back to the lab';
    $('rotor-row').hidden = false;
    $('b-spin').addEventListener('click', () => { rotor.w = ROTOR_SPEEDS[(ROTOR_SPEEDS.indexOf(rotor.w) + 1) % ROTOR_SPEEDS.length]; syncUI(); });
    $('b-skip3').addEventListener('click', () => { rotor.skip3 = !rotor.skip3; syncUI(); });
  }
  $('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });
  const stage = $('stage');
  stage.addEventListener('pointerdown', e => {
    if (!glass || finger.down) return;
    // in the glass's frame: is the touch on the glass?
    const dx = e.clientX - (view.hx + pose.x), dy = e.clientY - (view.hy + pose.y);
    const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
    const lx = (c * dx + s * dy) / kNow(), ly = (-s * dx + c * dy) / kNow();
    if (Math.abs(ly) > glass.HBc + 20 || Math.abs(lx) > glass.Rc + 30) return;
    finger.down = true; finger.id = e.pointerId; finger.x = e.clientX; finger.y = e.clientY;
    finger.ox = pose.x - e.clientX; finger.oy = pose.y - e.clientY;
    stage.setPointerCapture?.(e.pointerId);
  });
  stage.addEventListener('pointermove', e => { if (finger.down && e.pointerId === finger.id) { finger.x = e.clientX; finger.y = e.clientY; } });
  const up = e => { if (e.pointerId === finger.id) { finger.down = false; finger.id = -1; } };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  window.addEventListener('resize', () => requestAnimationFrame(layout));
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) hiddenCount++;
    if (!hidden) { lastNow = 0; lastDrawn = 0; acc = 0; lastVisibleAt = performance.now(); }
    life(hidden ? 'hidden' : 'visible');
  });
  // the lifecycle log: what iOS does to the page on a lock or an app switch
  for (const k of ['pagehide', 'pageshow', 'freeze', 'resume']) (k === 'freeze' || k === 'resume' ? document : window).addEventListener(k, e => life(k, e.persisted ? 'persisted' : ''));
  // turning the phone sideways turns the page too, unless Portrait Orientation Lock is on
  const land = matchMedia('(orientation: landscape)');
  const onLand = () => landscapeNotice(land.matches || screenAngle() !== 0);
  land.addEventListener?.('change', onLand);
  window.addEventListener('orientationchange', onLand);
  onLand();
}
function busyUI() { return !!benchRun || !!flowRec || busy; }
let hiddenCount = 0;
/** The page has turned to landscape: the glass would shrink and gravity would jump. Say how to stop it. */
function landscapeNotice(on) {
  const n = $('turn');
  if (!n) return;
  n.hidden = !on;
  if (on) n.innerHTML = `<h2>Turn on Portrait Orientation Lock</h2>
    <p>The phone turned the page sideways, so the glass shrank and the sand's "down" jumped with it.</p>
    <p>Open Control Center (swipe down from the top-right corner), tap the lock with the circular arrow, then turn the phone back upright.</p>
    <p>With the lock on, turn the phone as far as you like: the sand follows, and the page stays put.</p>`;
}
/** The Timer's sheet: its glasses, and Stop. */
function showTimers() {
  const d = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = 'The app\'s amount of sand for a glass (coarse grid, coarse sand, app speed), timed by the app\'s clock through the metered neck. The HUD shows the count against the clock, the queue on the line, the throttle (vcap), refused crossings and the stream\'s first fall; at the end, when the last grain left against 00:00.0. More, "mode", sets full, calm or auto (the app\'s rules, with the heat guard). Copy results has it all.';
  d.appendChild(p);
  const row = document.createElement('div'); row.id = 'timers';
  for (const t of TIMERS) {
    const b = document.createElement('button'); b.className = 'act small'; b.textContent = t.label;
    b.addEventListener('click', () => { $('sheet').hidden = true; timerStart(t.id).catch(e => setStatus('Timer failed: ' + (e && e.message || e))); });
    row.appendChild(b);
  }
  const stop = document.createElement('button'); stop.className = 'act small'; stop.textContent = 'Stop';
  stop.addEventListener('click', () => { $('sheet').hidden = true; timerOff(); if (!S.modeChosen) S.mode = 'full'; syncUI(); });
  row.appendChild(stop);
  d.appendChild(row);
  if (timer.def) { const q = document.createElement('pre'); q.textContent = timerReport((v, k = 1) => Number.isFinite(v) ? v.toFixed(k) : '-').join('\n'); q.style.whiteSpace = 'pre-wrap'; q.style.fontSize = '11px'; d.appendChild(q); }
  showSheet('Timer', d);
}
function doFlip() {
  if (flip.active || rotor.on) return;
  flip.active = true; flip.t0 = simTime; flip.from = pose.theta; flip.to = pose.theta + Math.PI;
  gateUntil = 0;
}

/* ------------------------------------------------------------------ *
 *  Manual stepping and measuring (for the tests)
 * ------------------------------------------------------------------ */
/**
 * Advance the simulation, as the frame loop would, but awaiting the GPU: n substeps, or (until
 * given) up to the simulated time until. With auto Hz, a 60 Hz frame's worth of substeps at a
 * time, the rate chosen before each from the readback of the one before (deterministic).
 */
async function stepN(n, until) {
  manual = true;
  let p = null, last = null;
  const more = () => until !== undefined ? simTime < until - 0.25 / rate.hz : n > 0;
  while (more()) {
    while (solver.readbacks.every(r => r.pending)) await gpu.device.queue.onSubmittedWorkDone();
    chooseRate(lastTally);
    let k = S.auto ? Math.max(1, Math.round(rate.hz / 60)) : capNow();
    k = Math.min(k, capNow(), until !== undefined ? Math.max(1, Math.round((until - simTime) * rate.hz)) : n);
    n -= k;
    // (the last chunk draws; simTime advances inside run, so this is decided before it)
    const lastChunk = until !== undefined ? simTime + k / rate.hz >= until - 0.25 / rate.hz : n <= 0;
    p = solver.run(k, set(), fieldAt, lastChunk ? enc => renderer.encode(enc, solver.count, grainLook()) : null);
    const tSim = simTime;
    if (p) { p = p.then(t => { if (t) onTally(t, tSim); return t; }); last = p; }
    await gpu.device.queue.onSubmittedWorkDone();
    if (S.auto && p) await p;
  }
  await renderer.present();
  drawGlass();
  return last ? await last : lastTally;
}

/** Everything about the material points, read back. */
async function fullStats() {
  const d = await solver.readParticles(), n = solver.count, dt = 1 / (solver.lastHz || rate.hz), gr = lastField.gravity;
  let outside = 0, nan = 0, above = 0, below = 0, maxSpeed = 0, sumSpeed = 0, cx = 0, cy = 0, minDist = Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * PARTICLE_WORDS, x = d[o], y = d[o + 1], vx = d[o + 2] / dt - gr[0] * dt, vy = d[o + 3] / dt - gr[1] * dt;
    if (![x, y, d[o + 2], d[o + 3], d[o + 4], d[o + 7]].every(Number.isFinite)) { nan++; continue; }
    const sd = sampleField(glass, x, y)[2];
    if (sd < minDist) minDist = sd;
    if (sd < -0.5) outside++;
    if (y > glass.cy) above++; else below++;
    const v = Math.hypot(vx, vy); if (v > maxSpeed) maxSpeed = v; sumSpeed += v;
    cx += x; cy += y;
  }
  const ok = n - nan;
  return {
    count: n, filled: fillCount, outside, nan, above, below, maxSpeed, meanSpeed: ok ? sumSpeed / ok : 0,
    com: ok ? [cx / ok - glass.cx, cy / ok - glass.cy] : [0, 0], minDist,
    clamped: lastTally?.clamped ?? 0, simTime, g: gCells(), cellsPerFall: Math.sqrt(2 * gCells() * 2 * glass.HBc)
  };
}

/**
 * The slope of the bed's free surface, fitted. frame 'gravity': measured
 * against the horizontal of the present field (the angle of repose);
 * 'glass': against the glass's own horizontal. Returns the flanks either
 * side of the peak, their mean, and the tilt of one line fitted across the
 * whole surface (signed, + rising to the right). opts: bulb, frame, vMax (grains faster than
 * this, cells/s, are in the air), skipAxis (cells either side of the axis left out), surface.
 */
async function heapAngle(opts = {}) {
  const d = await solver.readParticles(), n = solver.count;
  const bulb = opts.bulb || 'lower';
  let up = [0, 1];
  if ((opts.frame || 'gravity') === 'gravity') {
    const g = lastField.gravity, m = Math.hypot(g[0], g[1]) || 1;
    up = [-g[0] / m, -g[1] / m];
  }
  const h = [up[1], -up[0]];                                // "to the right" across the field
  const bins = new Map();
  let count = 0;
  // grains in the air (the falling thread, spray) are not the bed: faster than a fall of 3 cells
  const dt = 1 / (solver.lastHz || rate.hz), gr = lastField.gravity, vFly = opts.vMax ?? Math.sqrt(2 * gCells() * 3);
  for (let i = 0; i < n; i++) {
    const o = i * PARTICLE_WORDS, x = d[o] - glass.cx, y = d[o + 1] - glass.cy;
    if (bulb === 'lower' ? y > 0 : y < 0) continue;
    if (Math.hypot(d[o + 2] / dt - gr[0] * dt, d[o + 3] / dt - gr[1] * dt) > vFly) continue;
    const a = x * h[0] + y * h[1], b = x * up[0] + y * up[1];
    const k = Math.floor(a);
    const e = bins.get(k);
    if (!e) bins.set(k, { n: 1, top: b, top2: -Infinity });
    else { e.n++; if (b > e.top) { e.top2 = e.top; e.top = b; } else if (b > e.top2) e.top2 = b; }
    count++;
  }
  // opts.skipAxis: leave out the surface within this many cells of the glass's axis (where a
  // stream from the neck lands on a cone: its grains slow there, but they are not the cone)
  const keys = [...bins.keys()].filter(k => bins.get(k).n >= 3 && !(opts.skipAxis && Math.abs(k + 0.5) < opts.skipAxis)).sort((p, q) => p - q);
  if (keys.length < 6) return { left: NaN, right: NaN, mean: NaN, tilt: NaN, n: count };
  const surf = keys.map(k => ({ a: k + 0.5, b: bins.get(k).top2 }));
  // fit helpers
  const fit = pts => {
    const m = pts.length; if (m < 3) return NaN;
    const ma = pts.reduce((s, p) => s + p.a, 0) / m, mb = pts.reduce((s, p) => s + p.b, 0) / m;
    let num = 0, den = 0; for (const p of pts) { num += (p.a - ma) * (p.b - mb); den += (p.a - ma) ** 2; }
    return den > 0 ? num / den : NaN;
  };
  // smooth a little, then find the peak
  const sm = surf.map((p, i) => ({ a: p.a, b: surf.slice(Math.max(0, i - 2), i + 3).reduce((s, q) => s + q.b, 0) / Math.min(surf.length, i + 3) - 0 }));
  for (let i = 0; i < sm.length; i++) { const w = surf.slice(Math.max(0, i - 2), i + 3); sm[i].b = w.reduce((s, q) => s + q.b, 0) / w.length; }
  let ip = 0; for (let i = 1; i < sm.length; i++) if (sm[i].b > sm[ip].b) ip = i;
  const peak = sm[ip].b;
  const flank = (from, to, step) => {
    const edge = sm[to].b, span = peak - edge;
    const pts = [];
    for (let i = from; i !== to + step; i += step) {
      const z = (sm[i].b - edge) / (span || 1);
      if (z > 0.15 && z < 0.85) pts.push(surf[i]);
    }
    return { slope: fit(pts), n: pts.length, span };
  };
  const L = ip > 2 ? flank(ip, 0, -1) : { slope: NaN, n: 0, span: 0 };
  const R = ip < sm.length - 3 ? flank(ip, sm.length - 1, 1) : { slope: NaN, n: 0, span: 0 };
  const deg = s => Math.atan(Math.abs(s)) * 180 / Math.PI;
  const left = L.n >= 3 && L.span > 2 ? deg(L.slope) : NaN, right = R.n >= 3 && R.span > 2 ? deg(R.slope) : NaN;
  const both = [left, right].filter(Number.isFinite);
  const tilt = Math.atan(fit(surf)) * 180 / Math.PI;
  return {
    left, right, mean: both.length ? both.reduce((s, v) => s + v, 0) / both.length : 0,
    steepest: both.length ? Math.max(...both) : 0, tilt, n: count, peak, width: surf[surf.length - 1].a - surf[0].a,
    surface: opts.surface ? surf : undefined
  };
}

/* ------------------------------------------------------------------ *
 *  Start
 * ------------------------------------------------------------------ */
function noGPU(e) {
  startError = String(e && e.message || e);
  const n = $('notice');
  n.innerHTML = `<h2>This test needs WebGPU</h2>
    <p>On an iPhone that means iOS 26 or later, in Safari. To see your version: Settings, General, About.</p>
    <p>On a computer, a current Chrome, Edge or Safari will do.</p>
    <p style="font-size:12px;color:rgba(236,231,223,0.4)">${String(e && e.message || e).replace(/[<>&]/g, '')}</p>`;
  n.hidden = false;
  $('panel').hidden = true;
}

let readyResolve, readyReject;
const ready = new Promise((r, j) => { readyResolve = r; readyReject = j; });
ready.catch(() => {});

async function boot() {
  if (ROTOR) rotorBuild();
  bindUI(); syncUI(); layout();
  let tb = performance.now();
  try {
    gpu = await createDevice();
    life('device', `${(performance.now() - tb).toFixed(0)} ms${gpu.info.fallback ? ', a fallback adapter' : ''}`);
  } catch (e) { life('no device', String(e && e.message || e)); noGPU(e); readyReject(e); return; }
  try {
    const base = new URL('../../realsand/shaders/', import.meta.url);
    tb = performance.now();
    solver = await Solver.create(gpu.device, base);
    life('pipelines', `${(performance.now() - tb).toFixed(0)} ms for the solver's`);
    renderer = new GrainRenderer(gpu.device, $('c-gpu'), { offscreen: OFFSCREEN });
    tb = performance.now();
    await renderer.init(solver.shaders);
    life('grain pipeline', `${(performance.now() - tb).toFixed(0)} ms`);
    const q = new URLSearchParams(location.search);
    for (const k of ['res', 'amount', 'material', 'speed']) if (q.get(k) && (k !== 'amount' || q.get(k) in AMOUNTS)) S[k] = q.get(k);
    // the amount and grid: from the address, or as picked (or chosen) on an earlier visit, or timed now
    // (?setup times it again whatever was kept; tests load with offscreen or a grid and amount: no timing)
    const saved = q.has('setup') ? null : setupSaved(), fromUrl = !q.has('setup') && (q.has('res') || q.has('amount') || q.has('offscreen') || q.has('nosetup') || ROTOR);
    // (an automatic pick only from the setups it may make now: SETUP_CANDIDATES)
    if (!fromUrl && saved && SETUP_POINTS[saved.res]?.[saved.amount] && (saved.by === 'owner' || SETUP_CANDIDATES.some(c => c.res === saved.res && c.amount === saved.amount))) {
      S.res = saved.res; S.amount = saved.amount;
      setupInfo.state = saved.by === 'owner' ? 'owner' : 'saved';
      setupInfo.text = saved.by === 'owner' ? `chosen by hand on an earlier visit: ${RES_NAME[S.res]} grid, ${AMOUNT_NAME[S.amount]}` : `picked on an earlier visit (${saved.ms} ms a substep at the default): ${RES_NAME[S.res]} grid, ${AMOUNT_NAME[S.amount]}`;
    }
    Object.assign(S, SPEED_DEFAULTS[S.speed]);
    await resetSand({});
    layout();
    if (ROTOR) await rotorStart({ skip3: q.get('skip3') === '1' });
    gpu.device.lost.then(info => {
      life('device lost', `${info.reason}: ${info.message}; ${document.hidden ? 'hidden' : (performance.now() - lastVisibleAt).toFixed(0) + ' ms after the page was last shown'}`);
      if (info.reason !== 'destroyed') { lostReason = `${info.reason}: ${info.message}`; setStatus('The GPU was lost. Reload the page.'); }
    });
    setInterval(hud, 250);
    if (!rafOn) { rafOn = true; requestAnimationFrame(loop); }
    readyResolve(info());
    if (setupInfo.state === 'none' && !fromUrl) autoSetup().catch(e => { setupInfo.state = 'failed'; setupInfo.text = String(e && e.message || e); });
  } catch (e) {
    console.error(e);
    startError = String(e && e.message || e);
    setStatus('Could not start: ' + startError + ' (Copy results has the details)');
    readyReject(e);
  }
}
function info() {
  return {
    adapter: gpu?.info, glass: glass && { W: glass.W, H: glass.H, s: glass.s, neckCells: glass.neckCells, neckWidened: glass.neckWidened, HBc: glass.HBc, Rc: glass.Rc, cx: glass.cx, cy: glass.cy, bulbArea: glass.bulbArea },
    settings: { ...S }, count: solver?.count, g: gCells(), gReal: gReal(), rate: { ...rate, tPrev: undefined }, simTime, view: { ...view }, pose: { ...pose }, errors: solver?.errors
  };
}

/* ------------------------------------------------------------------ *
 *  The test hook
 * ------------------------------------------------------------------ */
window.__lab = {
  ready,
  info,
  /** Refill: { res, amount, material, speed, fill: 'top' | 'lower' | 'column', width, height, gate, points }. */
  async reset(opts = {}) { await ready; await resetSand(opts); return info(); },
  async setMaterial(id) { await switchMaterial(id); },
  /** { mode: 'manual' | 'upright' | 'motion', gravity: [x, y] g (screen: x right, y down), accel: [x, y] g (the glass's), omega, alpha (rad/s, + clockwise), gravitySpin (rad/s), shake: { g, hz, axis } } */
  setInput(o = {}) {
    if (!o.mode || o.mode === 'manual') scriptInput = { ...o, t0: simTime };
    else { scriptInput = null; S.input = o.mode; if (o.mode === 'motion') motionStart(); syncUI(); }
  },
  /** Forget what the motion readings taught (sign, units, filters). */
  motionReset() { Object.assign(motion, { sign: 0, votes: 0, voteSum: 0, locked: false, unit: 0, ubuf: [], lp: false, gx: 0, gy: 1, w: 0, a: 0, wPrev: 0, tPrev: -1, heading: NaN, rAxis: '', rSign: 1, rLearnt: false, rStats: null }); },
  /** The live loop's frame statistics over the last windowMs (frames drawn, skipped, cap). */
  frameStats: (ms = 2000) => frameStats(ms),
  /** Why the live loop might not draw: hidden, busy, manual, readbacks in flight. */
  loopState: () => ({ hidden, busy, manual, pending: solver?.readbacks.map(r => r.pending), frames: frames.length, skips: skips.length, inflight: pace.inflight, peakInflight: pace.peakInflight, budget: pace.budget, minBudget: pace.minBudget, cuts: pace.cuts, raises: pace.raises, msStep: pace.msStep, overran: pace.overran, held: rate.held, hz: rate.hz, displayMs: displayMs(), dispatched: solver?.dispatched }),
  /** The live loop's submit-to-done log over the last 4 s: { t, ms, steps }. */
  gpuLog: () => gpuLog.map(x => ({ ...x })),
  landscape: () => !$('turn').hidden,
  settings(o = {}) {
    // a speed brings its defaults first; hz, iterations and cap given with it then override them
    const capWas = S.cap;
    if (o.speed) { S.speed = o.speed; Object.assign(S, SPEED_DEFAULTS[o.speed]); }
    for (const k of ['hz', 'iterations', 'cap', 'maxStep', 'coriolis', 'auto', 'neckMin', 'gScale', 'override', 'blur', 'blurAll', 'spread', 'yieldIn', 'queue', 'budget', 'hzMax']) if (o[k] !== undefined) S[k] = o[k];
    // jolts: 'live', 'slowmo', 'film' or 'plain' (the old impulse: true, slowed, is slow motion now; false, plain)
    if (o.impulse !== undefined) S.jolts = o.impulse ? 'slowmo' : 'plain';
    if (JOLT_MODES.includes(o.jolts)) S.jolts = o.jolts;
    if (solver.cap !== capAlloc()) solver.allocUniforms(capAlloc());
    resetRate();
    syncUI(); return { ...S };
  },
  manual(on = true) { manual = !!on; if (!on) { lastNow = 0; acc = 0; vclock = null; vq.length = 0; vLastRun = null; } },
  step: n => stepN(n),
  /** Advance sec simulated seconds (the substep rate may change on the way: auto Hz). */
  advance: sec => stepN(0, simTime + sec),
  /** n substeps worth of simulated seconds, at the rate in use */
  steps: sec => Math.round(sec * rate.hz),
  /** The substep rate in use, the highest since the last reset, and the base. */
  rate: () => ({ hz: rate.hz, peak: rate.peak, base: S.hz, auto: S.auto }),
  stats: () => fullStats(),
  /** The material points' positions, relative to the neck (cells, y up): [x0, y0, x1, y1, ...]. */
  async positions() {
    const d = await solver.readParticles(), out = new Array(solver.count * 2);
    for (let i = 0; i < solver.count; i++) { out[2 * i] = d[i * PARTICLE_WORDS] - glass.cx; out[2 * i + 1] = d[i * PARTICLE_WORDS + 1] - glass.cy; }
    return out;
  },
  /** Per material point: x, y (relative to the neck, cells, y up) and the streak it is drawn with at
   *  blur 1 (cells; grains.wgsl: its displacement x substeps/s / 60, and none for a grain the crowding
   *  rule draws sharp): [x0, y0, sx0, sy0, ...]. { all: true }: every grain's streak, as if the rule
   *  were off (S.blurAll), without changing the settings. */
  async streaks(opt = {}) {
    const d = await solver.readParticles(), n = solver.count, k0 = (solver.lastHz || rate.hz) / 60, out = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_WORDS, k = k0 * (opt.all ? 1 : flightOf(d[o + 21], S.blurAll));
      out[4 * i] = d[o] - glass.cx; out[4 * i + 1] = d[o + 1] - glass.cy; out[4 * i + 2] = d[o + 2] * k; out[4 * i + 3] = d[o + 3] * k;
    }
    return out;
  },
  /** Per material point: x, y (relative to the neck, cells, y up), how crowded it is (g2p2g.wgsl:
   *  the grid's volume weighted around it), and its speed (cells/s): [x0, y0, c0, v0, ...]. */
  async crowds() {
    const d = await solver.readParticles(), n = solver.count, hz = solver.lastHz || rate.hz, out = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_WORDS;
      out[4 * i] = d[o] - glass.cx; out[4 * i + 1] = d[o + 1] - glass.cy; out[4 * i + 2] = d[o + 21]; out[4 * i + 3] = Math.hypot(d[o + 2], d[o + 3]) * hz;
    }
    return out;
  },
  /** Per material point: x, y (relative to the neck, cells, y up), vx, vy (cells/s), looseness (sand: log of volume over rest volume). */
  async particles() {
    const d = await solver.readParticles(), n = solver.count, dt = 1 / (solver.lastHz || rate.hz), gr = lastField.gravity, out = new Array(n * 5);
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_WORDS;
      out[5 * i] = d[o] - glass.cx; out[5 * i + 1] = d[o + 1] - glass.cy;
      out[5 * i + 2] = d[o + 2] / dt - gr[0] * dt; out[5 * i + 3] = d[o + 3] / dt - gr[1] * dt; out[5 * i + 4] = d[o + 13];
    }
    return out;
  },
  heapAngle: o => heapAngle(o),
  flip() { doFlip(); },
  flipping: () => flip.active,
  /** A scripted finger: carry the glass by (dx, dy) CSS px over ms (simulated), then let go. */
  drag(o) { fingerScript = { dx: o.dx || 0, dy: o.dy || 0, dur: (o.ms || 120) / 1000, t0: simTime }; },
  pose: () => ({ ...pose }),
  flowTest: o => flowTest({ manual: true, quiet: true, ...o }),
  benchmark: o => benchmark({ quiet: true, ...o }),
  report: () => reportText(),
  motion: () => ({ ...motion, dn: undefined }),
  time: () => simTime,
  tally: () => lastTally,
  /** Start a Timer (timer.mjs TIMERS ids): { ms, grains, burst, settle }. */
  async timer(id, o = {}) { await ready; return timerStart(id, o); },
  timerState: () => timerState(),
  timerStop() { timerOff(); },
  /** n frames of 1/60 s on a virtual clock, as the live loop runs them: { lag, stopAtEnd, draw }. */
  frames: (n, o) => framesN(n, o),
  /** The power mode: 'full', 'calm' or 'auto'. */
  mode(m) { S.mode = m; S.modeChosen = true; modesReset(modes, clockNow(), 0); syncUI(); return S.mode; },
  /** The mode's state; runs: the frames stepped by frames() since run number `since` (each { i, frame, mode, steps, hz }; the last 4000 kept). */
  modes: (since = 0) => ({ mode: modes.mode, why: modes.why, setting: S.mode, guard: modes.guard, ms: { ...modes.ms }, changes: modes.changes, slept: sleptFrames, calmSkips: calmFrames, ran: vRunN, runs: vRuns.filter(r => r.i >= since) }),
  /** The GPU's cost by a burst: { reps, small, big }; the sand is put back after. */
  burst: o => burst(o),
  lifecycle: () => lifeLog.map(e => ({ ...e })),
  /** The Rotor probe (on a page loaded with ?rotor=1): { amount, w, skip3, spun }. */
  async rotor(o = {}) { await ready; await rotorStart(o); return this.rotorState(); },
  rotorState: () => ({ on: rotor.on, w: rotor.w, omega: pose.omega, theta: pose.theta, swaps: rotor.swaps, runs: rotor.runs, skips: rotor.skips, cssTurns: rotor.cssTurns, wrong: rotor.wrong, checked: rotor.checked,
    parity: rotor.valve ? rotor.valve.parity : 0, drawnParity: rotor.drawnParity, canvasTurned: $('c-gpu').style.transform === 'rotate(180deg)', rotorTransform: $('rotor') ? $('rotor').style.transform : '', points: solver?.count, gl: rotor.gl.map(g => !!g) }),
  build: () => ({ build: BUILD, expected: BUILD_EXPECTED })
};

boot();
