/*
 * Hourglass sand lab: the page.
 *
 * A test of position-based MPM sand (Smoosh's solver, after EA's PB-MPM) in
 * the app's classic glass, driven by the phone's motion, a finger on the
 * glass, a Flip, and scripted tests. It is not the app and changes nothing
 * in it. Everything it needs is in this folder; nothing is fetched from
 * anywhere else, and there is no service worker.
 *
 * Part of the Hourglass project. License: GPL-3.0. The solver (solver.mjs,
 * shaders/) derives from Smoosh (MIT) and EA's PB-MPM (BSD-3-Clause): see
 * LICENSES.md.
 */
import { buildGlass, sampleField, traceOutline, APP_Q } from './glass.mjs';
import { Solver, ShaderLibrary, createDevice, MATERIALS, PARTICLE_WORDS } from './solver.mjs';
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
const SPEED_DEFAULTS = { app: { hz: 480, iterations: 5, cap: 8 }, real: { hz: 960, iterations: 5, cap: 24 } };
const CYCLE = {
  hz: [240, 360, 480, 720, 960, 1440, 1920],
  iterations: [3, 4, 5, 6, 8],
  cap: [4, 8, 12, 16, 24, 32, 48, 64],
  maxStep: [1, 1.5, 2],
  coriolis: [true, false]
};
const FLIP_S = 1.2;
const GATE_S = 0.5;                                    // the neck stays closed this long after a Reset
const BODY = { fw: 30, fz: 0.85, hw: 7, hz: 0.6 };     // app.js: the finger's hold, and home
const ACC_TAU = 0.012;                                 // s: the glass's acceleration as the sand feels it

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */
const S = {
  res: 'M', amount: 'quarter', material: 'coarse', speed: 'app', input: 'upright', hud: true,
  hz: 480, iterations: 5, cap: 8, maxStep: 1, coriolis: true, neckMin: 5.5
};
let gpu = null, solver = null, renderer = null, glass = null;
const glassCache = new Map();
let simTime = 0, gateUntil = 0, manual = false, busy = false, hidden = document.hidden;
let lastTally = null, lastField = { gravity: [0, -1], omega: 0, alpha: 0 };
let fillCount = 0, flowRec = null, benchRun = null, flowResult = null, benchRows = [];
let scriptInput = null;           // __lab.setInput({ mode: 'manual', ... })
let fingerScript = null;          // __lab.drag(...)
const pose = { x: 0, y: 0, vx: 0, vy: 0, theta: 0, omega: 0, alpha: 0, ax: 0, ay: 0, axLP: 0, ayLP: 0 };
const flip = { active: false, t0: 0, from: 0, to: 0 };
const finger = { down: false, id: -1, x: 0, y: 0, ox: 0, oy: 0 };
const view = { W: 1, H: 1, dpr: 1, hx: 0, hy: 0, k: 1 };
const frames = [];                // { t, dt, work, steps, sim } over the last few seconds
const clampLog = [];              // { t, n }
let behindS = 0;

const set = () => ({ hz: S.hz, iterations: S.iterations, maxStep: S.maxStep, coriolis: S.coriolis,
  material: S.override ? { ...MATERIALS[S.material], ...S.override } : MATERIALS[S.material] });

/** Gravity in solver cells/s²: the app's slow-motion pull, or true g for a glass 11 cm tall. */
function gCells() {
  if (!glass) return 1;
  return (S.gScale || 1) * (S.speed === 'app' ? APP_G * glass.s : 9810 / (REAL_HEIGHT_MM / (2 * glass.HBc)));
}

/* ------------------------------------------------------------------ *
 *  Real motion: DeviceMotion, as the sand would feel it
 *  (sign handling after motion.js: WebKit reports accelerationIncludingGravity
 *  negated; the sign is learnt from deviceorientation, or from the phone
 *  being held upright, with WebKit's as the prior on iOS)
 * ------------------------------------------------------------------ */
const motion = {
  on: false, seen: false, sign: 0, votes: 0, voteSum: 0, unit: 0, ubuf: [],
  gx: 0, gy: 1, w: 0, a: 0, wPrev: 0, tPrev: -1, rSign: 1, rCorr: 0,
  dn: null, dnT: -1, heading: NaN, hT: -1, hRate: 0, lp: false
};
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
  const mag = Math.hypot(px, py);
  if (mag > 8) { px *= 8 / mag; py *= 8 / mag; }
  const k = 1 - Math.exp(-dt / 0.006);
  if (!motion.lp) { motion.gx = px; motion.gy = py; motion.lp = true; }
  else { motion.gx += (px - motion.gx) * k; motion.gy += (py - motion.gy) * k; }
  // turning in the screen's plane, rad/s, + clockwise: rotationRate.alpha is about the screen's normal
  // (counter-clockwise + by the spec); its sign is checked against the heading of gravity on the screen
  const inPlane = Math.hypot(motion.gx, motion.gy);
  const heading = Math.atan2(motion.gx, motion.gy);
  let hRate = 0, hOk = false;
  if (inPlane > 0.5 && Number.isFinite(motion.heading)) {
    let dh = heading - motion.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    hRate = dh / dt; hOk = true;
  }
  motion.heading = inPlane > 0.5 ? heading : NaN;
  let w = 0;
  if (R && Number.isFinite(R.alpha)) {
    const wr = -R.alpha * Math.PI / 180;
    if (hOk && Math.abs(wr) > 0.5 && Math.abs(hRate) > 0.5) motion.rCorr = motion.rCorr * 0.98 + Math.sign(wr * hRate) * 0.02;
    if (motion.rCorr < -0.3) motion.rSign = -1; else if (motion.rCorr > 0.3) motion.rSign = 1;
    w = wr * motion.rSign;
  } else if (hOk) w = hRate;
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
  const k = 1 - Math.exp(-dt / ACC_TAU);
  pose.axLP += (pose.ax - pose.axLP) * k; pose.ayLP += (pose.ay - pose.ayLP) * k;
}

/** The field for the next substep, in the glass's frame (advances the clock). */
function fieldAt() {
  const dt = 1 / S.hz;
  stepPose(dt);
  // what the sand feels on the screen (x right, y down), in g, and the glass's turning (+ clockwise)
  let gx = 0, gy = 1, w = pose.omega, a = pose.alpha;
  const mode = scriptInput ? 'manual' : (benchRun ? 'bench' : S.input);
  if (mode === 'motion') {
    if (motion.seen) { gx = motion.gx; gy = motion.gy; w += motion.w; a += motion.a; }
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
  } else if (mode === 'bench') {
    const t = simTime - benchRun.t0;
    gx -= 1.5 * Math.sin(2 * Math.PI * 3 * t);
    gy -= 0.5 * Math.sin(2 * Math.PI * 2.2 * t + 1);
  }
  gx -= KPX * pose.axLP; gy -= KPX * pose.ayLP;
  const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
  const lx = c * gx + s * gy, ly = -s * gx + c * gy;      // into the glass (still y down)
  const G = gCells();
  simTime += dt;
  lastField = { gravity: [lx * G, -ly * G], omega: -w, alpha: -a, gate: simTime < gateUntil };
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
  const m = MATERIALS[material], n = pts.length / 2, data = new Float32Array(n * PARTICLE_WORDS), r = rand32(99);
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
  if (g !== glass || !solver.buffers.particles || solver.maxParticles < maxPts || solver.cap !== S.cap) {
    glass = g;
    solver.configure(g, maxPts, S.cap);
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
    Object.assign(pose, { x: 0, y: 0, vx: 0, vy: 0, theta: 0, omega: 0, alpha: 0, ax: 0, ay: 0, axLP: 0, ayLP: 0 });
    flip.active = false;
  }
  lastTally = null; clampLog.length = 0; behindS = 0;
  syncUI();
  drawGlass();
}

/** A new material for the sand where it lies. */
async function switchMaterial(id) {
  S.material = id;
  if (!solver?.count) return;
  const data = await solver.readParticles(), m = MATERIALS[id];
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
    const v = this.viewData, g = glass, k = view.k, c = Math.cos(pose.theta), s = Math.sin(pose.theta);
    const W = view.W, H = view.H, hx = view.hx + pose.x, hy = view.hy + pose.y;
    v[0] = 2 * k * c / W; v[1] = 2 * k * s / W; v[2] = -2 * k * s / H; v[3] = 2 * k * c / H;
    v[4] = 2 / W * (hx - k * c * g.cx - k * s * g.cy) - 1;
    v[5] = 1 - 2 / H * (hy - k * s * g.cx + k * c * g.cy);
    const liquid = MATERIALS[S.material].model === 0;
    const rc = liquid ? 0.62 : 0.36;                          // grain radius, cells
    const rpx = Math.max(rc * k, 0.75 / view.dpr);            // CSS px, at least most of a device pixel
    v[6] = 2 * rpx / W; v[7] = 2 * rpx / H;
    v[8] = liquid ? 1 : 0; v[9] = liquid ? 0.75 : 1; v[10] = 0; v[11] = 0;
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
  view.hx = W / 2; view.hy = top + availH / 2;
  drawGlass(true);                                           // (resizing a canvas clears it)
}

function rgba(c, a) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
const TINT = [255, 233, 204];
const WOOD = { hi: [112, 70, 42], mid: [70, 41, 23], lo: [30, 17, 9] };
let drawnKey = '';
/** The glass, back (behind the sand) and front (its wall, rims and wooden caps): physics.js _drawBack/_drawFront, simplified. */
function drawGlass(force) {
  if (!glass) return;
  const key = [pose.x.toFixed(2), pose.y.toFixed(2), pose.theta.toFixed(4), view.k, view.W, view.H, glass.s].join();
  if (key === drawnKey && !force) return;
  drawnKey = key;
  const s = glass.s, q = APP_Q, wall = glass.wallCells, R = glass.Rc, HB = glass.HBc;
  const setT = ctx => {
    const k = view.k * view.dpr, c = Math.cos(pose.theta), n = Math.sin(pose.theta);
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
  f.strokeStyle = rgba(TINT, 0.42); f.lineWidth = Math.max(0.75 * q * s, 0.9 / (view.k * view.dpr)); f.stroke(outer);
  f.strokeStyle = rgba(TINT, 0.22); f.lineWidth = Math.max(0.5 * q * s, 0.7 / (view.k * view.dpr)); f.stroke(inner);
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
let lastNow = 0, acc = 0, rafOn = false;
function loop(now) {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  const dtReal = lastNow ? Math.min((now - lastNow) / 1000, 0.25) : 1 / 60;
  lastNow = now;
  if (!solver || !glass || hidden || busy || manual) return;
  if (solver.readbacks.every(r => r.pending)) {             // the GPU is behind: skip a frame rather than queue more
    frames.push({ t: now, dt: dtReal * 1000, work: 0, steps: 0, sim: 0, real: dtReal });
    behindS += dtReal;
    trimFrames(now);
    return;
  }
  const available = acc + dtReal;
  acc = Math.min(available, S.cap / S.hz);
  const dropped = available - acc;
  behindS += dropped;
  const steps = Math.min(S.cap, Math.floor((acc + 1e-9) * S.hz));
  acc -= steps / S.hz;
  const p = solver.run(steps, set(), fieldAt, enc => renderer.encode(enc, solver.count));
  const tSim = simTime;
  if (p) p.then(t => onTally(t, tSim, now), e => console.error(e));
  renderer.present();
  drawGlass();
  frames.push({ t: now, dt: dtReal * 1000, work: performance.now() - t0, steps, sim: steps / S.hz, real: dtReal });
  trimFrames(now);
  if (benchRun) benchRun.onFrame?.(now);
}
function trimFrames(now) { while (frames.length && now - frames[0].t > 4000) frames.shift(); }

function onTally(t, tSim, now) {
  t.simTime = tSim;
  lastTally = t;
  clampLog.push({ t: now ?? performance.now(), n: t.clamped });
  while (clampLog.length > 2 && clampLog[clampLog.length - 1].t - clampLog[0].t > 2000) clampLog.shift();
  if (flowRec) flowRec.add(t);
}

function frameStats(windowMs = 2000, list = frames) {
  const now = list.length ? list[list.length - 1].t : 0;
  const f = list.filter(x => now - x.t <= windowMs);
  if (!f.length) return null;
  const d = f.map(x => x.dt).sort((a, b) => a - b);
  const q = p => d[Math.min(d.length - 1, Math.floor(p * (d.length - 1) + 0.5))];
  const real = f.reduce((s, x) => s + x.real, 0), sim = f.reduce((s, x) => s + x.sim, 0);
  return {
    n: f.length, median: q(0.5), p95: q(0.95), worst: d[d.length - 1], fps: f.length / Math.max(real, 1e-6),
    steps: f.reduce((s, x) => s + x.steps, 0) / f.length, ratio: sim / Math.max(real, 1e-6),
    work: f.map(x => x.work).sort((a, b) => a - b)[Math.floor(f.length / 2)]
  };
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
  if (f) lines.push(`frame ${f.median.toFixed(1)} ms med  ${f.p95.toFixed(1)} p95  ${f.worst.toFixed(1)} worst  ${f.fps.toFixed(0)} fps`);
  if (f) lines.push(`steps ${f.steps.toFixed(1)}/frame  ${S.hz} Hz x${S.iterations} it  cap ${S.cap}  sim/real ${f.ratio.toFixed(2)}${f.ratio < 0.97 ? '  BEHIND' : ''}`);
  const cr = clampRate();
  lines.push(`points ${solver.count.toLocaleString('en-US')}  clamp ${cr > 0 ? Math.round(cr) + ' nodes/s HIT' : '0'}  fastest ${t ? Math.round(t.maxSpeed) : 0} cells/s`);
  lines.push(`grid ${RES_NAME[S.res]} ${glass.W}x${glass.H}  neck ${glass.neckCells.toFixed(1)}${glass.neckWidened > 0.005 ? ' (+' + Math.round(glass.neckWidened * 100) + '%)' : ''}  g ${Math.round(gCells())}/s²  ${S.speed}`);
  if (S.input === 'motion') lines.push(motion.seen ? `motion g (${motion.gx.toFixed(2)}, ${motion.gy.toFixed(2)})  turn ${motion.w.toFixed(1)} rad/s  sign ${motion.sign || '?'}` : 'motion: no readings yet');
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
 *  Benchmark
 * ------------------------------------------------------------------ */
async function benchmark(opts = {}) {
  const warm = opts.warm ?? 0.7, measure = opts.measure ?? 2.5;
  const keep = { res: S.res, amount: S.amount, speed: S.speed, hz: S.hz, iterations: S.iterations, cap: S.cap, material: S.material };
  const combos = [];
  for (const res of opts.res || ['S', 'M', 'L']) for (const amount of opts.amounts || ['minute', 'quarter', 'full']) for (const speed of opts.speeds || ['app', 'real']) combos.push({ res, amount, speed });
  benchRows = [];
  const btn = $('b-bench'); btn.classList.add('busy');
  try {
    for (const [i, c] of combos.entries()) {
      setStatus(`Benchmark ${i + 1}/${combos.length}: ${RES_NAME[c.res]} grid, ${AMOUNT_NAME[c.amount]}, ${c.speed} speed`);
      await resetSand({ res: c.res, amount: c.amount, speed: c.speed, ...SPEED_DEFAULTS[c.speed], material: keep.material, gate: 0 });
      benchRun = { t0: simTime };
      clampLog.length = 0;
      await sleep(warm * 1000);
      const from = performance.now(), c0 = lastTally?.clamped ?? 0, behind0 = behindS;
      await sleep(measure * 1000);
      const list = frames.filter(f => f.t >= from);
      const st = frameStats(1e9, list) || {};
      const c1 = lastTally?.clamped ?? c0;
      benchRows.push({
        res: RES_NAME[c.res], amount: AMOUNT_NAME[c.amount], speed: c.speed, points: solver.count, hz: S.hz, it: S.iterations, cap: S.cap,
        median: st.median, p95: st.p95, worst: st.worst, fps: st.fps, steps: st.steps, ratio: st.ratio, work: st.work,
        clampPerS: (c1 - c0) / measure, behind: behindS - behind0
      });
      benchRun = null;
    }
  } finally {
    benchRun = null; btn.classList.remove('busy');
    await resetSand({ ...keep, gate: GATE_S });
    setStatus('');
  }
  if (!opts.quiet) showBench();
  return benchRows;
}
function benchTable(rows) {
  const n = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '—';
  return '<table><tr><th>grid</th><th>sand</th><th>speed</th><th>points</th><th>Hz</th><th>med</th><th>p95</th><th>worst</th><th>fps</th><th>steps</th><th>sim/real</th><th>clamp/s</th></tr>' +
    rows.map(r => `<tr><td>${r.res}</td><td>${r.amount}</td><td>${r.speed}</td><td>${r.points}</td><td>${r.hz}</td><td>${n(r.median)}</td><td>${n(r.p95)}</td><td>${n(r.worst)}</td><td>${n(r.fps, 0)}</td><td>${n(r.steps)}</td><td>${n(r.ratio, 2)}</td><td>${n(r.clampPerS, 0)}</td></tr>`).join('') + '</table>';
}
function showBench() {
  const d = document.createElement('div');
  d.innerHTML = '<p>Frame times in ms over a few seconds of shaken sand (median, 95th percentile, worst). sim/real under 1 means the simulation fell behind; clamp/s counts grid nodes held to the one-cell-per-substep limit.</p>' + benchTable(benchRows);
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
  L.push(`Screen: ${screen.width}x${screen.height} CSS px, devicePixelRatio ${window.devicePixelRatio}, standalone ${!!(navigator.standalone || matchMedia('(display-mode: standalone)').matches)}`);
  L.push(`Now: ${MATERIALS[S.material].label}, ${AMOUNT_NAME[S.amount]} glass, ${RES_NAME[S.res]} grid (${glass?.W}x${glass?.H}, neck ${glass?.neckCells.toFixed(1)} cells), ${S.speed} speed, ${S.hz} Hz x ${S.iterations} iterations, cap ${S.cap}/frame, clamp ${S.maxStep} cell`);
  const f = frameStats();
  if (f) L.push(`Last 2 s: frame median ${n(f.median)} ms, p95 ${n(f.p95)}, worst ${n(f.worst)}, ${n(f.fps, 0)} fps, ${n(f.steps)} substeps/frame, sim/real ${n(f.ratio, 2)}`);
  if (benchRows.length) {
    L.push('');
    L.push('Benchmark (frame ms: median / p95 / worst; fps; substeps a frame; sim/real; clamp hits/s)');
    for (const r of benchRows) L.push(`${r.res.padEnd(6)} ${r.amount.padEnd(8)} ${r.speed.padEnd(4)} ${String(r.points).padStart(6)} pts ${r.hz} Hz x${r.it}: ${n(r.median)} / ${n(r.p95)} / ${n(r.worst)} ms, ${n(r.fps, 0)} fps, ${n(r.steps)} steps, sim/real ${n(r.ratio, 2)}, clamp ${n(r.clampPerS, 0)}/s`);
  } else L.push('Benchmark: not run');
  if (flowResult) {
    const r = flowResult;
    L.push('');
    L.push(`Flow test: ${MATERIALS[r.material].label}, ${AMOUNT_NAME[r.amount]} glass, ${RES_NAME[r.res]} grid, ${r.speed} speed, neck ${r.neckCells.toFixed(1)} cells, ${r.start} points`);
    L.push(`  rate at 3/4 full ${n(r.grains75, 0)} grains/s, at 1/4 full ${n(r.grains25, 0)} grains/s, ratio ${n(r.ratio, 2)}; drained in ${n(r.duration)} s simulated`);
    L.push('  fill: ' + r.curve.map(p => `${p.fill}:${n(p.rate / (PPC * PPC) / (glass.s * glass.s), 0)}`).join(' '));
  } else L.push('Flow test: not run');
  return L.join('\n');
}
function copyResults() {
  const text = reportText();
  let ok = false;
  // The write must start inside the tap (iOS)
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => setStatus('Results copied'), () => fallbackCopy(text));
      ok = true;
    }
  } catch (e) { ok = false; }
  if (!ok) fallbackCopy(text);
  const d = document.createElement('div');
  d.innerHTML = '<p>Copied to the clipboard. If not, select the text below and copy it.</p>';
  const ta = document.createElement('textarea'); ta.value = text; ta.readOnly = true; d.appendChild(ta);
  showSheet('Results', d);
  return text;
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); setStatus('Results copied'); } catch (e) { setStatus('Copy the text by hand'); }
  ta.remove();
}

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let statusTimer = 0;
function setStatus(t) {
  $('status').textContent = t;
  clearTimeout(statusTimer);
  if (t && /copied|by hand/.test(t)) statusTimer = setTimeout(() => ($('status').textContent = ''), 2500);
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
    b.textContent = k === 'hz' ? `${v} Hz` : k === 'iterations' ? `${v} iter` : k === 'cap' ? `cap ${v}` : k === 'maxStep' ? `clamp ${v}` : `Coriolis ${v ? 'on' : 'off'}`;
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
            if (r === 'granted' || r === 'unavailable') { motionStart(); S.input = 'motion'; if (r === 'unavailable') setStatus('This browser gives no motion readings'); }
            else { S.input = 'upright'; setStatus('Motion access was not allowed'); }
            syncUI();
          }, () => { S.input = 'upright'; setStatus('Motion access could not be asked for'); syncUI(); });
          return;
        }
        S.input = val; syncUI(); return;
      }
      if (key === 'material') { switchMaterial(val); return; }
      if (key === 'speed') { S.speed = val; Object.assign(S, SPEED_DEFAULTS[val]); solver.allocUniforms(S.cap); syncUI(); return; }
      if (key === 'amount' || key === 'res') { resetSand({ [key]: val }); return; }
    });
  }
  for (const b of document.querySelectorAll('.cyc')) b.addEventListener('click', () => {
    const k = b.dataset.key, list = CYCLE[k], i = list.indexOf(S[k]);
    S[k] = list[(i + 1) % list.length];
    if (k === 'cap') solver.allocUniforms(S.cap);
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
    const lx = (c * dx + s * dy) / view.k, ly = (-s * dx + c * dy) / view.k;
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
    if (!hidden) { lastNow = 0; acc = 0; }
  });
}
function busyUI() { return !!benchRun || !!flowRec || busy; }
function doFlip() {
  if (flip.active) return;
  flip.active = true; flip.t0 = simTime; flip.from = pose.theta; flip.to = pose.theta + Math.PI;
  gateUntil = 0;
}

/* ------------------------------------------------------------------ *
 *  Manual stepping and measuring (for the tests)
 * ------------------------------------------------------------------ */
async function stepN(n) {
  manual = true;
  let p = null, last = null;
  while (n > 0) {
    while (solver.readbacks.every(r => r.pending)) await gpu.device.queue.onSubmittedWorkDone();
    const k = Math.min(n, solver.cap);
    n -= k;
    p = solver.run(k, set(), fieldAt, n <= 0 ? enc => renderer.encode(enc, solver.count) : null);
    const tSim = simTime;
    if (p) { p = p.then(t => { onTally(t, tSim); return t; }); last = p; }
    await gpu.device.queue.onSubmittedWorkDone();
  }
  await renderer.present();
  drawGlass();
  return last ? await last : lastTally;
}

/** Everything about the material points, read back. */
async function fullStats() {
  const d = await solver.readParticles(), n = solver.count, dt = 1 / S.hz, gr = lastField.gravity;
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
 * whole surface (signed, + rising to the right).
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
  const dt = 1 / S.hz, gr = lastField.gravity, vFly = Math.sqrt(2 * gCells() * 3);
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
  const keys = [...bins.keys()].filter(k => bins.get(k).n >= 3).sort((p, q) => p - q);
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
    Object.assign(S, SPEED_DEFAULTS[S.speed]);
    await resetSand({});
    layout();
    gpu.device.lost.then(info => { if (info.reason !== 'destroyed') setStatus('The GPU was lost: ' + info.message); });
    setInterval(hud, 250);
    if (!rafOn) { rafOn = true; requestAnimationFrame(loop); }
    readyResolve(info());
  } catch (e) {
    console.error(e);
    setStatus('Could not start: ' + (e.message || e));
    readyReject(e);
  }
}
function info() {
  return {
    adapter: gpu?.info, glass: glass && { W: glass.W, H: glass.H, s: glass.s, neckCells: glass.neckCells, neckWidened: glass.neckWidened, HBc: glass.HBc, Rc: glass.Rc, cx: glass.cx, cy: glass.cy, bulbArea: glass.bulbArea },
    settings: { ...S }, count: solver?.count, g: gCells(), simTime, view: { ...view }, pose: { ...pose }, errors: solver?.errors
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
  motionReset() { Object.assign(motion, { sign: 0, votes: 0, voteSum: 0, locked: false, unit: 0, ubuf: [], lp: false, gx: 0, gy: 1, w: 0, a: 0, wPrev: 0, tPrev: -1, heading: NaN }); },
  settings(o = {}) {
    for (const k of ['hz', 'iterations', 'maxStep', 'coriolis', 'neckMin', 'gScale', 'override']) if (o[k] !== undefined) S[k] = o[k];
    if (o.speed) { S.speed = o.speed; if (o.hz === undefined) Object.assign(S, SPEED_DEFAULTS[o.speed]); }
    if (o.cap !== undefined && o.cap !== S.cap) { S.cap = o.cap; solver.allocUniforms(S.cap); }
    syncUI(); return { ...S };
  },
  manual(on = true) { manual = !!on; if (!on) { lastNow = 0; acc = 0; } },
  step: n => stepN(n),
  /** n substeps worth of simulated seconds */
  steps: sec => Math.round(sec * S.hz),
  stats: () => fullStats(),
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
