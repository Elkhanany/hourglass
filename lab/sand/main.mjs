/*
 * Hourglass sand lab: the page.
 *
 * A test of position-based MPM sand (Smoosh's solver, after EA's PB-MPM) in
 * the app's classic glass, driven by the phone's motion, a finger on the
 * glass, a Flip, and scripted tests. It is not the app and changes nothing
 * in it. Everything it needs is in this folder; nothing is fetched from
 * anywhere else. It registers no service worker of its own, but on the
 * site the app's service worker (sw.js, scope /hourglass/) also answers for
 * this folder, from its cache first, so a new version shows one visit late.
 *
 * Part of the Hourglass project. License: GPL-3.0. The solver (solver.mjs,
 * shaders/) derives from Smoosh (MIT) and EA's PB-MPM (BSD-3-Clause): see
 * LICENSES.md.
 */
import { buildGlass, sampleField, traceOutline, APP_Q } from './glass.mjs';
import { Solver, ShaderLibrary, createDevice, MATERIALS, PARTICLE_WORDS, dispatchesPerSubstep } from './solver.mjs';
import { palette } from './palette.mjs';

const $ = id => document.getElementById(id);

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */
const RES = { S: 0.65, M: 0.8, L: 1.0 };              // solver cells per grain of the app's phone glass
const RES_NAME = { S: 'coarse', M: 'medium', L: 'fine' };
const AMOUNTS = { minute: 2800, quarter: 10000, full: 24000 };   // the app's grains (scale 1.08)
const AMOUNT_NAME = { minute: '1-minute', quarter: 'quarter', full: 'full' };
const APP_CAPACITY = 28099;                            // grains one bulb of the app's phone glass holds
const PPC = 2;                                         // material points per cell, each axis
const APP_G = 3300;                                    // physics.js: this.G, cells/s² on the app's lattice
const REAL_HEIGHT_MM = 110;                            // the glass, end to end inside, as drawn on a phone
const MM_PER_PX = 0.16;                                // app.js: an iPhone CSS px
const KPX = MM_PER_PX * 1e-3 / 9.81;                   // g per px/s² of the glass's acceleration on screen
// cap: the most substeps one frame may run, three 60 Hz frames' worth, so that a late or
// missed frame, or a 30 Hz display (Low Power Mode), does not slow the sand
const SPEED_DEFAULTS = { app: { hz: 480, iterations: 5, cap: 24 }, real: { hz: 960, iterations: 5, cap: 48 } };
// The substep rate rises while the sand moves fast (auto Hz), so that it is not held to the
// clamp of maxStep cells a substep: the base rate times one of these, up to HZ_MAX
const HZ_BOOST = [1, 1.5, 2, 3];
const HZ_MAX = { app: 1440, real: 2880 };
const CFL = 0.7;                                       // the speed a rate may carry: CFL x maxStep cells a substep
const CYCLE = {
  hz: [240, 360, 480, 720, 960, 1440, 1920],
  iterations: [3, 4, 5, 6, 8],
  cap: [4, 8, 12, 16, 24, 32, 48, 64],
  maxStep: [1, 1.5, 2],
  coriolis: [true, false],
  auto: [true, false],
  impulse: [true, false],
  blur: [1, 0.5, 0],
  spread: [true, false],
  yieldIn: [false, true]
};
const FLIP_S = 1.2;
const GATE_S = 0.5;                                    // the neck stays closed this long after a Reset
const BODY = { fw: 30, fz: 0.85, hw: 7, hz: 0.6 };     // app.js: the finger's hold, and home
const ACC_TAU = 0.012;                                 // s: the glass's acceleration as the sand feels it
const FILM_QUIET = 0.04;                               // g: a jolt weaker than this is skipped in the slowed playback
const FILM_LAG = 0.5;                                  // s: the slowed playback never falls further behind than this
// The GPU's pace in the frame loop. A frame is submitted only when fewer than S.queue frames of
// GPU work are still in flight (1: the one before is done), and its substeps are held to what
// the GPU does in GPU_SHARE of a display frame, from the measured submit-to-done time: when the
// GPU cannot keep up the sand runs slower than real time, rather than the work queueing up and
// what is on screen trailing the phone (an iPhone at 5cc11b3: 350 to 730 ms behind, 3 frames of
// work queued). Auto Hz rises only as far as that budget allows (rate.held says when it is held).
const GPU_SHARE = 0.75;

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */
// The page's default grid and amount: the most an iPhone holds in real time. Measured on the
// owner's (iOS 26.5, 5cc11b3): medium grid, quarter glass ran 8 frames a second at 0.39 of real
// time, 350 to 730 ms behind; only the 1-minute amounts ran in real time. Predicted from the
// cost fitted to those rows (about 16 us a dispatch, 47 us per 1000 points a substep), with the
// spread pass: coarse, 1 minute about 0.6 ms a substep, real time with auto Hz up to 960 at
// 30 and 60 Hz displays (1440, the pour's peak, would take about 90 % of the GPU); medium,
// 1 minute up to 720 Hz; coarse or medium quarter not even at 480 Hz with room to spare.
const DEFAULT_SETUP = { res: 'S', amount: 'minute' };
const S = {
  res: DEFAULT_SETUP.res, amount: DEFAULT_SETUP.amount, material: 'coarse', speed: 'app', input: 'upright', hud: true,
  hz: 480, iterations: 5, cap: 24, maxStep: 1, coriolis: true, neckMin: 5.5, auto: true, impulse: true,
  // motion blur: a grain is drawn as the streak it makes in this many display frames (60 Hz); 0: off
  blur: 1,
  // sand's spread pass (3 dispatches a substep): crowded points step apart inside a cell
  spread: true,
  // sand yields inside the solver's iterations (solver.mjs yieldLoop); off by default
  yieldIn: false,
  // frames of GPU work allowed in flight (1; 5cc11b3 allowed 3), and the substeps of a frame held
  // to the GPU's measured time (on); queue 3 with budget off is the old pace (a test's control)
  queue: 1, budget: true
};
// the substep rate in use (S.hz, raised by auto Hz while the sand is fast), and its history
const rate = { hz: 480, downAt: 0, grow: 0, tPrev: null, peak: 480, held: 0, want: 480 };
// the GPU's pace (see GPU_SHARE): frames in flight, the last frames' substeps and submit-to-done
// times, the substeps a frame may run (budget), and a ceiling learnt when a frame overran
const pace = { inflight: 0, tSub: 0, log: [], budget: Infinity, ceil: Infinity, ceilUntil: 0, msStep: NaN, overran: 0, peakInflight: 0, lastSkip: -1e9 };
function paceReset() { Object.assign(pace, { log: [], budget: Infinity, ceil: Infinity, ceilUntil: 0, msStep: NaN, overran: 0, peakInflight: 0 }); }
// the glass's linear acceleration, filtered as the sand feels it (see glassFelt)
const imp = { x1: 0, y1: 0, jx: 0, jy: 0 };
// app speed: the glass's jolts, recorded each substep and played back slowed (see glassFelt)
const FILM_N = 8192;
const film = { t: new Float64Array(FILM_N), x: new Float32Array(FILM_N), y: new Float32Array(FILM_N), w: 0, i: 0, tp: 0 };
function filmReset(t) { film.w = 0; film.i = 0; film.tp = t; }
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
  // fed to the sand as the glass's acceleration (glassFelt), like the finger's. Without it the
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
  if (flip.active) {
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
 *  Auto Hz: the substep rate follows the sand's speed
 * ------------------------------------------------------------------ */
/** The highest rate auto Hz may use. */
function hzTop() { return S.auto ? Math.max(S.hz, Math.min(HZ_MAX[S.speed], S.hz * HZ_BOOST[HZ_BOOST.length - 1])) : S.hz; }
/** The per-frame substep cap at the rate in use (S.cap is set for the base rate). */
function capNow() { return Math.max(1, Math.round(S.cap * rate.hz / S.hz)); }
/** Uniform slots to allocate: the cap at the highest rate. */
function capAlloc() { return Math.max(S.cap, Math.ceil(S.cap * hzTop() / S.hz)); }
/**
 * Before a frame: the substep rate the sand needs. The clamp holds a grid node to maxStep cells
 * a substep, so the rate must carry the fastest grain with room to spare (CFL): its speed from
 * the latest readback, plus twice what it grew by since the one before (a fall speeds up), plus
 * what a jolt of the glass (known here at once) adds over 50 ms. The rate goes up at once, and
 * down only after 0.3 s (simulated) with room at the lower rate.
 */
function chooseRate(t, hzCap = Infinity) {
  rate.held = 0;
  if (!S.auto) { rate.hz = S.hz; return; }
  if (t && t !== rate.tPrev) { rate.grow = Math.max(0, t.maxSpeed - (rate.tPrev ? rate.tPrev.maxSpeed : t.maxSpeed)); rate.tPrev = t; }
  const v = t ? t.maxSpeed : 0;
  const jolt = Math.hypot(imp.jx, imp.jy) * gCells() * 0.05;
  const need = (v + 2 * (rate.grow || 0) + jolt) / (CFL * S.maxStep);
  const top = hzTop();
  const rates = HZ_BOOST.map(b => Math.round(S.hz * b)).filter(h => h <= top);
  let want = rates.find(h => h >= need) ?? rates[rates.length - 1];
  rate.want = want;
  // the live loop's GPU budget (hzCap: the substeps a second it allows): no higher than that
  // (but never below the base rate); the clamp then holds the fastest grains back
  if (want > hzCap) { const w = rates.filter(h => h <= hzCap).pop() ?? rates[0]; if (w < want) { rate.held = want; want = w; } }
  if (want >= rate.hz) { rate.hz = want; rate.downAt = simTime + 0.3; }
  else if (simTime >= rate.downAt || rate.held) { rate.hz = want; rate.downAt = simTime + 0.3; }
  if (rate.hz > rate.peak) rate.peak = rate.hz;
}
function resetRate() { Object.assign(rate, { hz: S.hz, downAt: 0, grow: 0, tPrev: null, peak: S.hz, held: 0, want: S.hz }); paceReset(); }

/** G / g: how slowed the world is (1 at real speed); the app's lambda. */
function lamNow() { return Math.min(1, gCells() / gReal()); }
/**
 * The glass's own linear acceleration (g, page axes) as the sand feels it, for the substep
 * starting at simulated time t.
 *
 * At real speed it is the acceleration itself, smoothed over ACC_TAU.
 *
 * At app speed the world runs slowed: gravity, and with it every force, is scaled by lambda
 * (about 0.08), so a fall takes 1 / sqrt(lambda) (about 3.5) times longer than real. A jolt of
 * the glass scaled the same way but lasting its real time T gives the sand only lambda a T of
 * speed, where a slowed film of the real event gives sqrt(lambda) a T: a flick barely moved the
 * sand (0.2 cells). So the glass's acceleration is recorded and played back slowed by
 * sqrt(lambda), as in a slowed film: a jolt lasts T / sqrt(lambda), its peak against gravity is
 * the real one, the sand gets the film's speed, and a flick's push and its stop come as far
 * apart as in the film. (Scaling the jolt up by 1 / sqrt(lambda) instead gave the right speed,
 * but threw the sand back past the middle when the glass stopped; splitting off a steady part
 * with a high-pass filter pushed the sand back after every jolt.) Quiet stretches (under
 * FILM_QUIET) are played fast, so the playback catches up between jolts, and it never falls more
 * than FILM_LAG behind: a steady push ends up played at its own pace, scaled like gravity.
 */
function glassFelt(ax, ay, dt, t) {
  const k1 = 1 - Math.exp(-dt / ACC_TAU);
  imp.x1 += (ax - imp.x1) * k1; imp.y1 += (ay - imp.y1) * k1;
  let jx = imp.x1, jy = imp.y1;
  if (S.speed === 'app' && S.impulse) {
    const j = film.w % FILM_N;
    film.t[j] = t; film.x[j] = jx; film.y[j] = jy; film.w++;
    if (film.w - film.i > FILM_N - 2) film.i = film.w - (FILM_N - 2);
    // the play head: slowed while it plays a jolt, fast over quiet stretches
    const at = tp => {
      while (film.i + 1 < film.w && film.t[(film.i + 1) % FILM_N] <= tp) film.i++;
      const a = film.i % FILM_N, b = (film.i + 1) % FILM_N;
      if (film.i + 1 >= film.w || film.t[b] <= film.t[a]) return [film.x[a], film.y[a]];
      const u = Math.min(1, Math.max(0, (tp - film.t[a]) / (film.t[b] - film.t[a])));
      return [film.x[a] + (film.x[b] - film.x[a]) * u, film.y[a] + (film.y[b] - film.y[a]) * u];
    };
    let p = at(film.tp);
    if (Math.hypot(p[0], p[1]) < FILM_QUIET) {
      // quiet: skip ahead to the next sample that is not (never over one: a jolt that changes
      // sign passes through zero, and its second half must still be played)
      while (film.i + 1 < film.w && Math.hypot(film.x[(film.i + 1) % FILM_N], film.y[(film.i + 1) % FILM_N]) < FILM_QUIET) film.i++;
      film.tp = Math.max(film.tp, film.i + 1 < film.w ? film.t[(film.i + 1) % FILM_N] : t);
    } else film.tp += dt * Math.sqrt(lamNow());
    film.tp = Math.min(t, Math.max(t - FILM_LAG, film.tp));
    p = at(film.tp);
    jx = p[0]; jy = p[1];
  } else filmReset(t);
  imp.jx = jx; imp.jy = jy;
  return [jx, jy];
}

/** The field for the next substep, in the glass's frame (advances the clock). */
function fieldAt() {
  const dt = 1 / rate.hz;
  stepPose(dt);
  // what the sand feels on the screen (x right, y down), in g, and the glass's turning (+ clockwise)
  let gx = 0, gy = 1, w = pose.omega, a = pose.alpha;
  // the glass's own acceleration, g, page axes: the finger's spring, the phone's, a scripted one
  let lax = KPX * pose.ax, lay = KPX * pose.ay;
  const mode = scriptInput ? 'manual' : (benchRun ? 'bench' : S.input);
  if (mode === 'motion') {
    if (motion.seen) { gx = motion.gx; gy = motion.gy; w += motion.w; a += motion.a; lax += motion.lx; lay += motion.ly; }
  } else if (mode === 'manual') {
    const m = scriptInput, t = simTime - m.t0;
    let g = m.gravity || [0, 1];
    if (m.gravitySpin) { const ph = m.gravitySpin * t, c = Math.cos(ph), s = Math.sin(ph); g = [c * g[0] - s * g[1], s * g[0] + c * g[1]]; }
    gx = g[0]; gy = g[1];
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
  const [fax, fay] = glassFelt(lax, lay, dt, simTime);
  gx -= fax; gy -= fay;
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
function rand32(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/** Material points on a jittered lattice wherever inside(x, y) holds. */
function lattice(inside, box, seed = 7) {
  const r = rand32(seed), out = [];
  const [x0, y0, x1, y1] = box;
  for (let j = Math.floor(y0); j < Math.ceil(y1); j++) for (let i = Math.floor(x0); i < Math.ceil(x1); i++) {
    for (let b = 0; b < PPC; b++) for (let a = 0; a < PPC; a++) {
      const x = i + (a + 0.5 + (r() - 0.5) * 0.3) / PPC, y = j + (b + 0.5 + (r() - 0.5) * 0.3) / PPC;
      if (inside(x, y) && sampleField(glass, x, y)[2] > 0.45) out.push(x, y);
    }
  }
  return out;
}
/** The number of material points for an amount. */
function amountPoints(amount) { return Math.round(AMOUNTS[amount] / APP_CAPACITY * glass.bulbArea * PPC * PPC); }
/**
 * Points for a fill: 'top' (the upper bulb, heaped, on the closed neck),
 * 'lower' (settled flat in the lower bulb), 'column' (a column standing in
 * the lower bulb: column = { width, height } in cells).
 */
function makeFill(kind, opts = {}) {
  const g = glass, target = opts.points || amountPoints(opts.amount || S.amount);
  let pts;
  if (kind === 'column') {
    const w = opts.width ?? 0.6 * g.Rc, h = opts.height ?? 0.4 * g.Rc, yb = g.cy - g.HBc;
    pts = lattice((x, y) => Math.abs(x - g.cx) < w / 2 && y < yb + h && y < g.cy - 1, [g.cx - w / 2, yb, g.cx + w / 2, yb + h]);
  } else {
    const top = kind !== 'lower';
    // heaped: a low cone (22 degrees) on the level L above the neck
    const heap = L => x => Math.max(0, g.half(L) - Math.abs(x - g.cx)) * Math.tan(22 * Math.PI / 180);
    const build = L => top
      ? lattice((x, y) => y > g.cy + 0.6 && y < g.cy + L + heap(L)(x), [g.cx - g.Rc, g.cy, g.cx + g.Rc, Math.min(g.cy + L + 0.5 * g.Rc, g.cy + g.HBc)])
      : lattice((x, y) => y < g.cy - 0.6 && y < g.cy - g.HBc + L, [g.cx - g.Rc, g.cy - g.HBc, g.cx + g.Rc, Math.min(g.cy - g.HBc + L, g.cy)]);
    let lo = 0, hi = g.HBc, best = null;
    for (let k = 0; k < 22; k++) {
      const L = (lo + hi) / 2, p = build(L);
      if (p.length / 2 < target) lo = L; else { hi = L; best = p; }
    }
    pts = best || build(hi);
    // trim to the target from the top down, so the surface stays smooth
    if (pts.length / 2 > target) {
      const idx = [...Array(pts.length / 2).keys()].sort((p, q) => top ? pts[2 * p + 1] - pts[2 * q + 1] : pts[2 * p + 1] - pts[2 * q + 1]);
      const keep = idx.slice(0, target);
      pts = keep.flatMap(i => [pts[2 * i], pts[2 * i + 1]]);
    }
  }
  return pts;
}
function packParticles(pts, material) {
  const m = matNow(material), n = pts.length / 2, data = new Float32Array(n * PARTICLE_WORDS), r = rand32(99);
  for (let i = 0; i < n; i++) {
    const o = i * PARTICLE_WORDS;
    data[o] = pts[2 * i]; data[o + 1] = pts[2 * i + 1];
    data[o + 4] = 1; data[o + 7] = 1;                         // F = I
    data[o + 12] = 1;                                          // liquid density
    data[o + 15] = 1;                                          // enabled
    data[o + 17] = 1 / (PPC * PPC); data[o + 16] = data[o + 17] * m.density;
    data[o + 18] = m.model;
    data[o + 20] = r();
  }
  return data;
}

/** Build (or reuse) the glass for the grid, and the buffers for the sand. */
function getGlass(res) {
  const key = res + ':' + S.neckMin;
  if (!glassCache.has(key)) glassCache.set(key, buildGlass({ s: RES[res], neckMin: S.neckMin }));
  return glassCache.get(key);
}

async function resetSand(opts = {}) {
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
  const pts = makeFill(kind, opts);
  const data = packParticles(pts, S.material);
  solver.upload(data, pts.length / 2);
  fillCount = pts.length / 2;
  renderer.setPalette(palette(S.material));
  simTime = 0;
  gateUntil = kind === 'top' ? (opts.gate ?? GATE_S) : 0;
  if (!opts.keepPose) {
    Object.assign(pose, { x: 0, y: 0, vx: 0, vy: 0, theta: 0, omega: 0, alpha: 0, ax: 0, ay: 0 });
    flip.active = false;
  }
  lastTally = null; clampLog.length = 0; behindS = 0;
  resetRate();
  Object.assign(imp, { x1: 0, y1: 0, jx: 0, jy: 0 }); filmReset(0);
  syncUI();
  drawGlass();
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
 *  Drawing: grains on the GPU, the glass in 2-D around them
 * ------------------------------------------------------------------ */
class GrainRenderer {
  constructor(device, canvas, offscreen) {
    this.device = device; this.canvas = canvas;
    // offscreen: draw into a texture and copy it to a 2-D canvas (for headless
    // browsers whose WebGPU canvas cannot present; the shaders are the same)
    this.offscreen = !!offscreen;
    if (this.offscreen) { this.format = 'rgba8unorm'; this.ctx2d = canvas.getContext('2d'); }
    else {
      this.context = canvas.getContext('webgpu');
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device, format: this.format, alphaMode: 'premultiplied' });
    }
    this.viewData = new Float32Array(12);
    this.viewBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.palBuf = device.createBuffer({ size: 256 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }
  async init(shaders) {
    const module = await shaders.module(this.device, 'grains');
    const blend = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.pipeline = await this.device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: this.format, blend: { color: blend, alpha: blend } }] },
      primitive: { topology: 'triangle-strip' }
    });
  }
  bind(particles) {
    this.group = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.viewBuf } }, { binding: 1, resource: { buffer: particles } }, { binding: 2, resource: { buffer: this.palBuf } }]
    });
  }
  setPalette(p) { this.device.queue.writeBuffer(this.palBuf, 0, p); }
  encode(enc, count) {
    const v = this.viewData, g = glass, k = kNow(), c = Math.cos(pose.theta), s = Math.sin(pose.theta);
    const W = view.W, H = view.H, hx = view.hx + pose.x, hy = view.hy + pose.y;
    v[0] = 2 * k * c / W; v[1] = 2 * k * s / W; v[2] = -2 * k * s / H; v[3] = 2 * k * c / H;
    v[4] = 2 / W * (hx - k * c * g.cx - k * s * g.cy) - 1;
    v[5] = 1 - 2 / H * (hy - k * s * g.cx + k * c * g.cy);
    const liquid = matNow().model === 0;
    const rc = liquid ? 0.62 : 0.36;                          // grain radius, cells
    const rpx = Math.max(rc * k, 0.75 / view.dpr);            // CSS px, at least most of a device pixel
    v[6] = 2 * rpx / W; v[7] = 2 * rpx / H;
    // motion blur: the streak a grain makes in S.blur display frames (of simulated time at the
    // sim/real ratio of 1), per cell of its displacement in a substep
    v[8] = liquid ? 1 : 0; v[9] = liquid ? 0.75 : 1; v[10] = (S.blur || 0) / 60 * (solver.lastHz || rate.hz); v[11] = 0;
    this.device.queue.writeBuffer(this.viewBuf, 0, v);
    let target;
    if (this.offscreen) {
      const w = this.canvas.width, h = this.canvas.height;
      if (!this.tex || this.tex.width !== w || this.tex.height !== h) {
        this.tex?.destroy(); this.readBuf?.destroy();
        this.tex = this.device.createTexture({ size: [w, h], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        this.bpr = Math.ceil(w * 4 / 256) * 256;
        this.readBuf = this.device.createBuffer({ size: this.bpr * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        this.copyPending = false;
      }
      target = this.tex.createView();
    } else target = this.context.getCurrentTexture().createView();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    if (count) { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.group); pass.draw(4, count); }
    pass.end();
    if (this.offscreen && !this.copyPending) {
      enc.copyTextureToBuffer({ texture: this.tex }, { buffer: this.readBuf, bytesPerRow: this.bpr }, [this.tex.width, this.tex.height]);
      this.copyQueued = true;
    }
  }
  /** Offscreen only: after the submit, show what was drawn. */
  present() {
    if (!this.offscreen || !this.copyQueued || this.copyPending) return Promise.resolve();
    this.copyQueued = false; this.copyPending = true;
    const buf = this.readBuf, w = this.tex.width, h = this.tex.height, bpr = this.bpr;
    return buf.mapAsync(GPUMapMode.READ).then(() => {
      const src = new Uint8Array(buf.getMappedRange()), img = this.ctx2d.createImageData(w, h), dst = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * bpr + x * 4, o = (y * w + x) * 4, a = src[i + 3];
        if (a) { const k = 255 / a; dst[o] = src[i] * k; dst[o + 1] = src[i + 1] * k; dst[o + 2] = src[i + 2] * k; dst[o + 3] = a; }
      }
      buf.unmap(); this.copyPending = false;
      this.ctx2d.putImageData(img, 0, 0);
    }, () => { this.copyPending = false; });
  }
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
  if (!glass) return;
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
let lastNow = 0, lastDrawn = 0, acc = 0, rafOn = false;
const rafLog = [];                // rAF timestamps, for the display's own rate
function loop(now) {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  const dtReal = lastNow ? Math.min((now - lastNow) / 1000, 0.25) : 1 / 60;
  lastNow = now;
  rafLog.push(now); while (rafLog.length && now - rafLog[0] > 2000) rafLog.shift();
  if (!solver || !glass || hidden || busy || manual) { lastDrawn = 0; return; }
  // a promise of work done that never came (a lost device): let the loop go on after 3 s
  if (pace.inflight && t0 - pace.tSub > 3000) pace.inflight = 0;
  // the GPU is behind: skip a frame rather than queue more (nothing is drawn: it is not a frame)
  if (pace.inflight >= S.queue || solver.readbacks.every(r => r.pending)) {
    skips.push({ t: now }); pace.lastSkip = t0;
    const avail = acc + dtReal;                             // the next frame drawn catches up, up to its cap
    acc = Math.min(avail, capFrame() / rate.hz);
    behindS += avail - acc;
    trimFrames(now);
    return;
  }
  // wall time since the last frame drawn (skipped animation frames included; for the statistics, not capped)
  const since = lastDrawn ? (now - lastDrawn) / 1000 : dtReal;
  lastDrawn = now;
  const T = displayMs();
  chooseRate(lastTally, S.budget && Number.isFinite(pace.budget) ? pace.budget * 1000 / T : Infinity);
  const hz = rate.hz, cap = capFrame();
  const available = acc + dtReal;
  acc = Math.min(available, cap / hz);
  const dropped = available - acc;
  behindS += dropped;
  const steps = Math.min(cap, Math.floor((acc + 1e-9) * hz));
  acc -= steps / hz;
  const p = solver.run(steps, set(), fieldAt, enc => renderer.encode(enc, solver.count));
  const tSim = simTime, tSub = performance.now();
  pace.inflight++; pace.tSub = tSub; pace.peakInflight = Math.max(pace.peakInflight, pace.inflight);
  gpu.device.queue.onSubmittedWorkDone().then(() => {
    pace.inflight = Math.max(0, pace.inflight - 1);
    const ms = performance.now() - tSub;
    gpuLog.push({ t: now, ms, steps }); while (gpuLog.length && now - gpuLog[0].t > 4000) gpuLog.shift();
    paceAfter(steps, ms, T);
  }, () => { pace.inflight = Math.max(0, pace.inflight - 1); });   // (a failure shows as a missing gpu lag)
  if (p) p.then(t => { if (t) { readbackOk++; onTally(t, tSim, now); } }, e => {
    if (!readbackFails++) { readbackErr = String(e && e.message || e); console.error(e); }
    if (!readbackWarned && readbackFails >= 30 && readbackFails > 10 * readbackOk) {
      readbackWarned = true;
      setStatus('Live measurements are failing on this browser: the HUD, Flow test and auto Hz need them. Copy results has the error.');
    }
  });
  renderer.present();
  drawGlass();
  const gpuHeld = dropped > 1e-6 && cap < capNow();
  frames.push({ t: now, dt: since * 1000, work: performance.now() - t0, steps, hz, sim: steps / hz, real: since, capped: dropped > 1e-6 && !gpuHeld, gpuHeld, held: rate.held, T });
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
/**
 * A frame's work is done: steps substeps took ms from submit (with 1 frame in flight the queue
 * was empty, so that is the frame's own GPU time). The budget: the substeps the GPU does in
 * GPU_SHARE of a display frame (T ms), per substep from the last frames (their per-frame costs
 * shared out, so an upper bound). Done in under 0.9 T: the budget is that measure. Over 1.2 T (it
 * overran): less, and no more than 0.9 of that for 2 s. In between, where a browser that reports
 * the work done only at the next display frame would put every frame: up 5 % a frame while the
 * budget or auto Hz is what holds the sand back, and down 10 % a frame while frames are being
 * skipped for want of the GPU (the last 0.5 s).
 */
function paceAfter(steps, ms, T) {
  if (!steps) return;
  pace.log.push({ steps, ms }); if (pace.log.length > 8) pace.log.shift();
  const per = pace.log.reduce((s, x) => s + x.ms, 0) / pace.log.reduce((s, x) => s + x.steps, 0);
  pace.msStep = per;
  if (!S.budget) return;
  const now = performance.now(), fit = Math.max(1, Math.floor(GPU_SHARE * T / per));
  if (now > pace.ceilUntil) pace.ceil = Infinity;
  const top = Math.min(capAllocHz(), Math.max(1, Math.floor(0.9 * pace.ceil)));
  if (ms > 1.2 * T) {                                     // it overran a display frame: less
    pace.overran++; pace.ceil = steps; pace.ceilUntil = now + 2000;
    pace.budget = Math.max(1, Math.min(Number.isFinite(pace.budget) ? pace.budget : steps, fit, Math.floor(0.8 * steps)));
  } else if (ms < 0.9 * T) pace.budget = Math.min(top, fit); // done with time to spare: the measure holds
  else {
    const b = Number.isFinite(pace.budget) ? pace.budget : steps;
    if (now - pace.lastSkip < 500) pace.budget = Math.max(1, b - Math.max(1, Math.ceil(0.1 * b)));
    else if (!Number.isFinite(pace.budget) || steps >= pace.budget || rate.held) pace.budget = Math.min(top, b + Math.max(1, Math.ceil(0.05 * b)));
  }
}
/** The most substeps a frame could want: the cap at the highest rate. */
function capAllocHz() { return Math.max(1, Math.round(S.cap * hzTop() / S.hz)); }
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
  if (f) lines.push(`drawn ${f.fps.toFixed(0)} fps (display ${Number.isFinite(f.display) ? f.display.toFixed(0) : '-'})  skipped ${Math.round(f.skipped * 100)}%${behindWhy(f)}`);
  if (f) lines.push(`frame ms ${f.median.toFixed(1)} med ${f.p95.toFixed(1)} p95 ${f.worst.toFixed(1)} max  lag ${Number.isFinite(f.gpu) ? f.gpu.toFixed(0) + ' ms (' + f.lagFrames.toFixed(1) + ' fr)' : '-'}`);
  if (f) lines.push(`steps ${f.steps.toFixed(1)}/frame  ${rate.hz} Hz${S.auto ? (rate.held ? ' HELD (wants ' + rate.held + ')' : rate.hz > S.hz ? ' auto↑' : ' auto') : ''} x${S.iterations}  sim/real ${f.ratio.toFixed(2)}`);
  if (f) lines.push(`gpu ${Number.isFinite(f.msStep) ? f.msStep.toFixed(2) + ' ms/step' : '-'}  budget ${S.budget ? (Number.isFinite(pace.budget) ? pace.budget + '/frame' : '-') : 'off'}  ${dispatchesPerSubstep(S.iterations, set().material)} disp/step  in flight ≤${S.queue}`);
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
// points a fill makes and grid nodes, per grid and amount (the page's own fills)
const SETUP_POINTS = { S: { minute: 4752, quarter: 16971, full: 40731 }, M: { minute: 7175, quarter: 25626, full: 61502 }, L: { minute: 11211, quarter: 40040, full: 96097 } };
const SETUP_NODES = { S: 137 * 302, M: 165 * 369, L: 203 * 457 };
const SETUP_KEY = 'hourglass-lab-sand-setup';
const SETUP_HZ = 960;            // app speed: the rate a fast turn needs (its peak was 720 Hz here) with room
/**
 * GPU time a substep (us), as fitted to the owner's iPhone at 5cc11b3 (18 dispatches, no spread):
 * about 16 us a dispatch, 47 us per 1000 points (5 iterations), 1.5 us per 1000 grid nodes; the
 * spread's two point passes and its sub-cell clear a guess (7 us per 1000 points, 0.1 per 1000
 * sub-cell nodes). Only its ratios between setups are used here, against a timing of this device.
 */
function costModelUs(res, amount, iterations = S.iterations) {
  const m = { ...matNow('coarse'), spread: S.spread ? matNow('coarse').spread : 0 };
  const n = SETUP_POINTS[res][amount] / 1000, nodes = SETUP_NODES[res] / 1000, fine = 4 * nodes;
  const pointUs = 47 * (0.3 + 0.17 * iterations) / (0.3 + 0.17 * 5);
  return 290 / 18 * dispatchesPerSubstep(iterations, m) + pointUs * n + 1.5 * nodes + (m.spread ? 7 * n + 0.1 * fine : 0);
}
const setupInfo = { state: 'none', text: '' };
function setupSaved() { try { return JSON.parse(localStorage.getItem(SETUP_KEY) || 'null'); } catch (e) { return null; } }
function setupSave(o) { try { localStorage.setItem(SETUP_KEY, JSON.stringify(o)); } catch (e) { /* the choice is only for this visit */ } }
/**
 * Time the default for a couple of seconds as it pours (the live loop, GPU budget on), then pick
 * the largest amount and grid whose substeps, scaled from that timing by the cost model, take
 * under GPU_SHARE of the GPU at SETUP_HZ; say what was picked. Runs once: the pick, or the
 * owner's own choice of amount or grid afterwards, is kept for the next visit.
 */
async function autoSetup() {
  setupInfo.state = 'timing';
  setStatus('Timing this phone for a moment…');
  await sleep(2600);
  const f = frameStats(2000);
  if (!f || !Number.isFinite(f.msStep) || hidden || S.res !== DEFAULT_SETUP.res || S.amount !== DEFAULT_SETUP.amount) {
    setupInfo.state = 'skipped'; setupInfo.text = 'not timed (the page was hidden or changed)'; setStatus(''); return;
  }
  const ms0 = f.msStep, us0 = costModelUs(S.res, S.amount);
  const order = [];
  for (const amount of ['minute', 'quarter', 'full']) for (const res of ['S', 'M', 'L']) order.push({ res, amount });
  const scored = order.map(c => ({ ...c, ms: ms0 * costModelUs(c.res, c.amount) / us0 })).map(c => ({ ...c, load: c.ms * SETUP_HZ / 1000 }));
  const fits = scored.filter(c => c.load <= GPU_SHARE);
  const pick = fits.length ? fits[fits.length - 1] : { res: DEFAULT_SETUP.res, amount: DEFAULT_SETUP.amount, ms: ms0, load: ms0 * SETUP_HZ / 1000 };
  const name = c => `${RES_NAME[c.res]} grid, ${AMOUNT_NAME[c.amount]}`;
  setupInfo.state = 'auto';
  setupInfo.text = `picked ${name(pick)} on first load: the default (${name(DEFAULT_SETUP)}) took ${ms0.toFixed(2)} ms of GPU a substep here (display ${Math.round(f.display || 0)} Hz); scaled by the cost model, ${name(pick)} takes ${Math.round(pick.load * 100)}% of the GPU at ${SETUP_HZ} Hz (the most it may: ${Math.round(GPU_SHARE * 100)}%)` +
    (scored.length > fits.length ? `; the next, ${name(scored[fits.length] || scored[scored.length - 1])}, ${Math.round((scored[fits.length] || scored[scored.length - 1]).load * 100)}%` : '');
  setupSave({ res: pick.res, amount: pick.amount, by: 'auto', ms: +ms0.toFixed(3) });
  if (pick.res !== S.res || pick.amount !== S.amount) await resetSand({ res: pick.res, amount: pick.amount });
  setStatus(fits.length ? `Set up for this phone: ${name(pick)} (it keeps up in real time). The buttons change it.` : `This device is slow for the sand: even ${name(pick)} runs slower than real time. The buttons change it.`);
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
  L.push(`Now: ${MATERIALS[S.material].label}, ${AMOUNT_NAME[S.amount]} glass, ${RES_NAME[S.res]} grid (${glass?.W}x${glass?.H}, neck ${glass?.neckCells.toFixed(1)} cells), ${S.speed} speed (g ${Math.round(gCells())} cells/s²${S.speed === 'real' ? ', true g for an 11 cm glass' : ''}; the glass is drawn ${n(drawnMM() / 10)} cm tall), ${S.hz} Hz x ${S.iterations} iterations (auto Hz ${S.auto ? 'on, up to ' + hzTop() + ' Hz; highest since reset ' + rate.peak : 'off'}), cap ${S.cap}/frame at the base rate, clamp ${S.maxStep} cell; jolts at app speed ${S.impulse ? 'played slowed like a film (x' + (1 / Math.sqrt(lamNow())).toFixed(1) + ' longer)' : 'plain'}; spread ${S.spread ? 'on' : 'off'}; yield ${S.yieldIn ? 'in loop' : 'at end'}; blur ${S.blur ? S.blur + ' frame' : 'off'}`);
  L.push(`Motion: input ${S.input}, readings ${motion.seen ? 'yes' : 'no'}, sign ${motion.sign || 'not learnt'}, units ${motion.unit ? (motion.unit > 1 ? 'g' : 'm/s²') : '?'}, turn axis ${motion.rAxis || '?'} sign ${motion.rSign} (${motion.rLearnt ? 'learnt' : 'assumed'})`);
  const f = frameStats();
  L.push(`Setup: ${setupInfo.text || (setupInfo.state === 'none' ? 'from the address (no timing)' : setupInfo.state)}`);
  L.push(`Pace: at most ${S.queue} frame${S.queue > 1 ? 's' : ''} of GPU work in flight; GPU budget ${S.budget ? 'on (' + Math.round(GPU_SHARE * 100) + '% of a display frame' + (Number.isFinite(pace.budget) ? ', now ' + pace.budget + ' substeps a frame' : '') + ')' : 'off'}; ${dispatchesPerSubstep(S.iterations, set().material)} dispatches a substep; frames that overran a display frame since reset: ${pace.overran}`);
  if (f) L.push(`Last 2 s: ${n(f.fps, 0)} frames drawn a second, display ${n(f.display, 0)} Hz, ${n(100 * f.skipped, 0)}% skipped (GPU busy), ${n(100 * f.capped, 0)}% held by the cap, ${n(100 * f.gpuHeld, 0)}% held by the GPU budget, auto Hz held back in ${n(100 * f.held, 0)}% (rate ${f.hzMax}${f.wantMax > f.hzMax ? ', wanted ' + f.wantMax : ''}); between frames median ${n(f.median)} ms, p95 ${n(f.p95)}, worst ${n(f.worst)}; submit-to-done lag median ${n(f.gpu)} ms (${n(f.lagFrames)} display frames), p95 ${n(f.gpu95)}; GPU ${n(f.msStep, 2)} ms a substep; ${n(f.steps)} substeps/frame, sim/real ${n(f.ratio, 2)}`);
  const def = benchRows.filter(r => r.tag === 'default'), opt = benchRows.filter(r => r.tag && r.tag !== 'default');
  if (def.length) {
    L.push('');
    L.push('Answers (from the Benchmark: sand pouring and shaken, a few seconds a row)');
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
  $('status').textContent = t;
  clearTimeout(statusTimer);
  if (t && /copied|by hand|Real motion on/.test(t)) statusTimer = setTimeout(() => ($('status').textContent = ''), /Real motion/.test(t) ? 6000 : 2500);
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
    b.textContent = k === 'hz' ? `${v} Hz` : k === 'iterations' ? `${v} iter` : k === 'cap' ? `cap ${v}` : k === 'maxStep' ? `clamp ${v}` : k === 'auto' ? `auto Hz ${v ? 'on' : 'off'}` : k === 'impulse' ? `jolts ${v ? 'slowed' : 'plain'}` : k === 'blur' ? `blur ${v === 0 ? 'off' : v === 1 ? '1 frame' : v + ' frame'}` : k === 'spread' ? `spread ${v ? 'on' : 'off'}` : k === 'yieldIn' ? `yield ${v ? 'in loop' : 'at end'}` : `Coriolis ${v ? 'on' : 'off'}`;
  }
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
    if (solver.cap !== capAlloc()) solver.allocUniforms(capAlloc());
    resetRate();
    syncUI();
  });
  $('b-more').addEventListener('click', () => { $('more').hidden = !$('more').hidden; $('b-more').classList.toggle('on', !$('more').hidden); requestAnimationFrame(layout); });
  $('b-flip').addEventListener('click', () => doFlip());
  $('b-reset').addEventListener('click', () => { if (!busyUI()) resetSand({}); });
  $('b-hud').addEventListener('click', () => { S.hud = !S.hud; syncUI(); requestAnimationFrame(layout); });
  $('b-bench').addEventListener('click', () => { if (!busyUI()) benchmark(); });
  $('b-flow').addEventListener('click', () => { if (!busyUI()) flowTest(); });
  $('b-copy').addEventListener('click', () => copyResults());
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
    if (!hidden) { lastNow = 0; lastDrawn = 0; acc = 0; }
  });
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
function doFlip() {
  if (flip.active) return;
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
    p = solver.run(k, set(), fieldAt, lastChunk ? enc => renderer.encode(enc, solver.count) : null);
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
  bindUI(); syncUI(); layout();
  try {
    gpu = await createDevice();
  } catch (e) { noGPU(e); readyReject(e); return; }
  try {
    const base = new URL('./shaders/', import.meta.url);
    solver = await Solver.create(gpu.device, base);
    renderer = new GrainRenderer(gpu.device, $('c-gpu'), new URLSearchParams(location.search).has('offscreen'));
    await renderer.init(solver.shaders);
    const q = new URLSearchParams(location.search);
    for (const k of ['res', 'amount', 'material', 'speed']) if (q.get(k)) S[k] = q.get(k);
    // the amount and grid: from the address, or as picked (or chosen) on an earlier visit, or timed now
    // (?setup times it again whatever was kept; tests load with offscreen or a grid and amount: no timing)
    const saved = q.has('setup') ? null : setupSaved(), fromUrl = !q.has('setup') && (q.has('res') || q.has('amount') || q.has('offscreen') || q.has('nosetup'));
    if (!fromUrl && saved && SETUP_POINTS[saved.res]?.[saved.amount]) {
      S.res = saved.res; S.amount = saved.amount;
      setupInfo.state = saved.by === 'owner' ? 'owner' : 'saved';
      setupInfo.text = saved.by === 'owner' ? `chosen by hand on an earlier visit: ${RES_NAME[S.res]} grid, ${AMOUNT_NAME[S.amount]}` : `picked on an earlier visit (${saved.ms} ms a substep at the default): ${RES_NAME[S.res]} grid, ${AMOUNT_NAME[S.amount]}`;
    }
    Object.assign(S, SPEED_DEFAULTS[S.speed]);
    await resetSand({});
    layout();
    gpu.device.lost.then(info => { if (info.reason !== 'destroyed') { lostReason = `${info.reason}: ${info.message}`; setStatus('The GPU was lost. Reload the page.'); } });
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
  loopState: () => ({ hidden, busy, manual, pending: solver?.readbacks.map(r => r.pending), frames: frames.length, skips: skips.length, inflight: pace.inflight, peakInflight: pace.peakInflight, budget: pace.budget, msStep: pace.msStep, overran: pace.overran, held: rate.held, hz: rate.hz, displayMs: displayMs(), dispatched: solver?.dispatched }),
  /** The live loop's submit-to-done log over the last 4 s: { t, ms, steps }. */
  gpuLog: () => gpuLog.map(x => ({ ...x })),
  landscape: () => !$('turn').hidden,
  settings(o = {}) {
    // a speed brings its defaults first; hz, iterations and cap given with it then override them
    const capWas = S.cap;
    if (o.speed) { S.speed = o.speed; Object.assign(S, SPEED_DEFAULTS[o.speed]); }
    for (const k of ['hz', 'iterations', 'cap', 'maxStep', 'coriolis', 'auto', 'impulse', 'neckMin', 'gScale', 'override', 'blur', 'spread', 'yieldIn', 'queue', 'budget']) if (o[k] !== undefined) S[k] = o[k];
    if (solver.cap !== capAlloc()) solver.allocUniforms(capAlloc());
    resetRate();
    syncUI(); return { ...S };
  },
  manual(on = true) { manual = !!on; if (!on) { lastNow = 0; acc = 0; } },
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
   *  blur 1 (cells; grains.wgsl: its displacement x substeps/s / 60): [x0, y0, sx0, sy0, ...]. */
  async streaks() {
    const d = await solver.readParticles(), n = solver.count, k = (solver.lastHz || rate.hz) / 60, out = new Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_WORDS;
      out[4 * i] = d[o] - glass.cx; out[4 * i + 1] = d[o + 1] - glass.cy; out[4 * i + 2] = d[o + 2] * k; out[4 * i + 3] = d[o + 3] * k;
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
  tally: () => lastTally
};

boot();
