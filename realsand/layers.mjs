/*
 * Hourglass sand engine: layered sand on the GPU (design 7.4).
 *
 * With layered sand on, bit 7 of a grain's colour seed is its tone (the theme's sand or its
 * companion, physics.js Renderer._buildLUT). The app's CPU sand lays its tones where its
 * grains come to rest; here the same is done for the GPU's material points:
 *
 *  - Toner, the tone pass (shaders/tone.wgsl), once a run after the tally: a point that has
 *    crossed the counting line is numbered and marked fresh with the tone the layer schedule
 *    gives its number, and takes that tone when it first comes to rest below the line; after
 *    a turn, points that moved take the tone of their bulb's new pattern as they come to rest.
 *    It counts each bulb's tones; its 8 words are read back with the tally (solver.mjs post).
 *  - LayerPlan, the schedule: the lower heap grows in layers of layNeed grains (physics.js
 *    _layer: a style's depth of rows times the heap's width), each laid as two strata, one
 *    tone under the other in the shares the top bulb holds, the tone below changing from
 *    layer to layer (physics.js _sift, _siftAll); poured sand comes in layers of its own
 *    (physics.js _pourLayer).
 *  - The points the page writes (fills, transfers, pours) carry the side of the counting line
 *    they lie on (markSides), so that the tone pass does not take them for crossings; and the
 *    retone of every point when layers are turned on or off (retone).
 *
 * The particle layout is EA's (solver.mjs PARTICLE_WORDS): color.x (word 20) the seed, color.y
 * (word 21) the crowding the solver writes, color.z (word 22) the side the tone pass last saw.
 * Seed bits: 0-7 the palette entry (bit 7 the tone), 8 fresh, 9 the fresh grain's tone, 10 moved
 * since the turn began.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */
import { PARTICLE_WORDS } from './solver.mjs';
import { rand32 } from './fill.mjs';

export const FRESH = 256, FRESH_TONE = 512, MOVED = 1024;
/** The tone pass's flags: number and lay crossed points; mark points that move; lay the turned bulbs' patterns. */
export const TONE_FRESH = 1, TONE_TRACK = 2, TONE_LAY = 4;
/** Segments of the schedule the GPU is given at once (tone.wgsl seg). */
export const SEGMENTS = 16;
const UNIFORM_BYTES = 5 * 16 + 8 * 16 + SEGMENTS * 16;
/** A grain at rest moves slower than this, cells/s (tally.wgsl's surface rule); one faster than MOVE_V has moved. */
export const REST_V = 2, MOVE_V = 6;
/** After a turn, the chance a resting grain that moved is laid in its pattern in a pass is 1 - exp(-dt / LAY_S). */
export const LAY_S = 0.6;

/** The tone pass on the GPU. */
export class Toner {
  constructor(device, shaders) {
    this.device = device; this.shaders = shaders;
    const U = GPUBufferUsage;
    this.uniform = device.createBuffer({ label: 'tone uniform', size: UNIFORM_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.counts = device.createBuffer({ label: 'tone counts', size: 32, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.data = new ArrayBuffer(UNIFORM_BYTES);
    this.f = new Float32Array(this.data); this.u = new Uint32Array(this.data);
  }
  async init() {
    const module = await this.shaders.module(this.device, 'tone');
    this.pipeline = await this.device.createComputePipelineAsync({ label: 'tone', layout: 'auto', compute: { module, entryPoint: 'csMain' } });
  }
  /** The solver's count and particle buffers (after each configure). */
  bind(countBuf, particles) {
    this.group = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: { buffer: countBuf } },
        { binding: 2, resource: { buffer: particles } }, { binding: 3, resource: { buffer: this.counts } }]
    });
  }
  /** After an upload: the crossings are numbered from 0 again. */
  reset() { this.device.queue.writeBuffer(this.counts, 0, new Uint32Array(8)); }
  /**
   * Encode the pass for n points into enc (after the run's substeps and tally). o: { flags, parity,
   * line, cx, cy, s, dt, gravity [x, y], appW, appH (the app lattice's size), layP, frame,
   * pats: [top, bottom] (physics.js _pattern objects with duty) or null, segs: [[start, tone], ...] }.
   */
  encode(enc, n, o) {
    if (!this.group || !n) return;
    const f = this.f, u = this.u;
    f.fill(0);
    f[0] = o.line; f[1] = o.cx; f[2] = o.cy; f[3] = o.s;
    f[4] = o.dt; f[5] = REST_V; f[6] = o.gravity[0]; f[7] = o.gravity[1];
    f[8] = o.appW / 2; f[9] = o.appH / 2; f[10] = MOVE_V; f[11] = o.layP || 0;
    u[12] = o.flags >>> 0; u[13] = o.parity & 1; u[14] = Math.min(SEGMENTS, o.segs ? o.segs.length : 0); u[15] = o.appW | 0;
    const pats = o.pats;
    if (pats) {
      u[16] = pats[0].salt >>> 0; u[17] = pats[1].salt >>> 0;
      for (let b = 0; b < 2; b++) {
        const R = pats[b], k = 20 + b * 16;
        f[k] = R.y0; f[k + 1] = R.cx; f[k + 2] = R.hw; f[k + 3] = R.P;
        f[k + 4] = R.tilt; f[k + 5] = R.bend; f[k + 6] = R.fold; f[k + 7] = R.kx;
        f[k + 8] = R.ky; f[k + 9] = R.p1; f[k + 10] = R.p2; f[k + 11] = R.km;
        f[k + 12] = R.p3; f[k + 13] = R.duty;
      }
    }
    u[18] = o.frame >>> 0;
    const segs = o.segs || [];
    for (let i = 0; i < Math.min(SEGMENTS, segs.length); i++) { u[52 + 4 * i] = segs[i][0] >>> 0; u[53 + 4 * i] = segs[i][1] & 1; }
    this.device.queue.writeBuffer(this.uniform, 0, this.data);
    enc.clearBuffer(this.counts, 4, 28);
    const pass = enc.beginComputePass({ label: 'tone' });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.group); pass.dispatchWorkgroups(Math.ceil(n / 64));
    pass.end();
  }
  destroy() { this.uniform.destroy?.(); this.counts.destroy?.(); }
}

/** The tone pass's words, as read back (solver.mjs post): what each means. */
export function toneWords(w) {
  if (!w) return null;
  return { laid: w[0], above1: w[1], above: w[2], below1: w[3], below: w[4], fresh: w[5], moved: w[6] };
}

/**
 * The layer schedule (physics.js _style, _layer, _siftAll, _pourLayer), in crossing numbers:
 * crossing k (the k-th point to cross since the plan began) is given the tone of the segment
 * holding k. o: { ppg: points per app grain, pace: physics.js Sim.pace(), lay: physics.js
 * Sim.LAYERS (pour: grains in a poured layer), seed }.
 */
export class LayerPlan {
  constructor(o = {}) {
    this.ppg = o.ppg || 1; this.pace = o.pace || 1; this.lay = o.lay || { pour: 420 };
    this.rnd = rand32((o.seed >>> 0) || 0x2545F491);
    this.segs = [];               // [start, tone], absolute crossing numbers, in order
    this.end = 0;                 // where the last layer planned ends
    this.up = this.rnd() < 0.5 ? 1 : 0;
    this.pourTone = this.rnd() < 0.5 ? 1 : 0; this.pourLeft = 0;
    this.style();
  }
  /** How deep the next layers are: fine, even, bold, or fine with a thick one now and then (physics.js _style). */
  style() {
    const k = (this.rnd() * 4) | 0, P = this.pace;
    this.layMin = [3, 4, 7, 3][k] * P; this.laySpan = [4, 8, 12, 18][k] * P; this.layPow = k === 3 ? 2.5 : 1;
  }
  /** Lay out the layers from crossing `from` on: those planned after it are drawn again (a turn, a new style). */
  replan(from) {
    from = Math.max(0, Math.floor(from));
    let i = 0;
    while (i < this.segs.length && this.segs[i][0] <= from) i++;
    // (the segment holding `from` stays, and ends where the next layer begins)
    this.segs.length = i;
    this.end = from;
  }
  /** Plan layers until crossing `to` is covered: share, tone 1's share of the top bulb; wide, the lower heap's width (app cells). */
  ensure(to, share, wide) {
    const q = Math.min(1, Math.max(0, share === share ? share : 0));
    let guard = 0;
    while (this.end <= to && guard++ < 64) {
      const need = (this.layMin + this.laySpan * Math.pow(this.rnd(), this.layPow)) * Math.max(wide || 0, 24 * this.pace);
      const L = Math.max(8, Math.round(need * this.ppg)), n1 = Math.round(q * L), n0 = L - n1;
      const first = this.up, nf = first ? n1 : n0;
      if (nf > 0) this.segs.push([this.end, first]);
      if (L - nf > 0) this.segs.push([this.end + nf, first ^ 1]);
      this.end += L;
      this.up ^= 1;
    }
  }
  /** The tone of crossing k (absolute). */
  toneOf(k) {
    let t = 0;
    for (const s of this.segs) { if (s[0] <= k) t = s[1]; else break; }
    return t;
  }
  /**
   * The GPU's table: up to SEGMENTS segments from the one holding crossing `from`, their starts
   * counted from `base` (the absolute number of the GPU's crossing 0), never below 0.
   */
  table(base, from) {
    let i = 0;
    while (i + 1 < this.segs.length && this.segs[i + 1][0] <= from) i++;
    const out = [];
    for (let k = i; k < this.segs.length && out.length < SEGMENTS; k++) out.push([Math.max(0, this.segs[k][0] - base), this.segs[k][1]]);
    return out;
  }
  /** Forget the segments that end before crossing k (they are behind the GPU). */
  drop(k) {
    let i = 0;
    while (i + 1 < this.segs.length && this.segs[i + 1][0] <= k) i++;
    if (i > 0) this.segs.splice(0, i);
  }
  /** The tone (as bit 7) of the next n grains poured in: layers of pour to 2 pour grains, each in the other tone (physics.js _pourLayer). */
  pourBits(n) {
    if (this.pourLeft <= 0) {
      this.pourTone ^= 1;
      this.pourLeft = this.lay.pour + ((this.rnd() * this.lay.pour) | 0);
    }
    this.pourLeft -= n;
    return this.pourTone << 7;
  }
}

/**
 * Write the side of the counting line each point lies on (color.z: above XOR parity), as the
 * tone pass keeps it, so that points the page writes are not taken for crossings. Returns the
 * tone-1 count of the points above and below: { above1, above, below1, below }.
 */
export function markSides(data, n, line, parity) {
  const W = PARTICLE_WORDS, out = { above1: 0, above: 0, below1: 0, below: 0 };
  line = Math.fround(line);
  for (let i = 0; i < n; i++) {
    const o = i * W, up = data[o + 1] > line;
    data[o + 22] = (up ? 1 : 0) ^ (parity & 1);
    const t = ((data[o + 20] | 0) >> 7) & 1;
    if (up) { out.above++; out.above1 += t; } else { out.below++; out.below1 += t; }
  }
  return out;
}

/** Clear the fresh and moved marks of the seeds, keeping the palette entry (and its tone). */
export function clearMarks(data, n) {
  for (let i = 0; i < n; i++) { const o = i * PARTICLE_WORDS + 20; data[o] = (data[o] | 0) & 255; }
}

/**
 * Every point's tone afresh (the layers switch, design 7.4). on: the tone of the CPU lattice's
 * grain at the same depth below the surface in the same app column, in the same bulb (the CPU
 * Sim has just laid its strata, at the ledger's counts); off: a random tone (bit 7 is noise
 * again, as in a glass that never had them). map(x, y): a grid point's app cell [x, y].
 * cpu: { W, H, gateY, cell, seed } (physics.js Sim; a cell holds sand from 2). line: the
 * counting line, grid y.
 */
export function retone(data, n, on, { cpu, map, line, seed = 1 }) {
  const W = PARTICLE_WORDS, r = rand32(seed);
  clearMarks(data, n);
  if (!on || !cpu) {
    for (let i = 0; i < n; i++) { const o = i * W + 20; data[o] = ((data[o] | 0) & 127) | (r() < 0.5 ? 128 : 0); }
    return;
  }
  const Wa = cpu.W, Ha = cpu.H, gate = cpu.gateY, cell = cpu.cell, sd = cpu.seed;
  // each bulb's surface per app column: the CPU's (its first sand from the far side down) and the GPU's
  const cpuTop = [new Int32Array(Wa).fill(-1), new Int32Array(Wa).fill(-1)];
  for (let x = 0; x < Wa; x++) {
    for (let y = 0; y < gate; y++) if (cell[y * Wa + x] >= 2) { cpuTop[0][x] = y; break; }
    for (let y = gate + 1; y < Ha; y++) if (cell[y * Wa + x] >= 2) { cpuTop[1][x] = y; break; }
  }
  const gpuTop = [new Float64Array(Wa).fill(Infinity), new Float64Array(Wa).fill(Infinity)];
  const at = new Array(n);
  line = Math.fround(line);
  for (let i = 0; i < n; i++) {
    const o = i * W;
    if (data[o + 15] === 0) { at[i] = null; continue; }
    const a = map(data[o], data[o + 1]), b = data[o + 1] > line ? 0 : 1, x = Math.min(Wa - 1, Math.max(0, Math.floor(a[0])));
    at[i] = [b, x, a[1]];
    if (a[1] < gpuTop[b][x]) gpuTop[b][x] = a[1];
  }
  for (let i = 0; i < n; i++) {
    const p = at[i];
    if (!p) continue;
    const [b, x, ya] = p, depth = Math.max(0, ya - gpuTop[b][x]);
    // the nearest column with sand on the CPU's side
    let c = x;
    for (let d = 0; d < Wa && cpuTop[b][c] < 0; d++) { c = x + (d % 2 ? (d + 1) / 2 : -d / 2); c = Math.min(Wa - 1, Math.max(0, c)); }
    let t = r() < 0.5 ? 1 : 0;
    if (cpuTop[b][c] >= 0) {
      const lim = b === 0 ? gate - 1 : Ha - 1;
      let y = Math.min(lim, cpuTop[b][c] + Math.round(depth));
      while (y > cpuTop[b][c] && cell[y * Wa + c] < 2) y--;
      if (cell[y * Wa + c] >= 2) t = (sd[y * Wa + c] >> 7) & 1;
    }
    const o = i * W + 20;
    data[o] = ((data[o] | 0) & 127) | (t << 7);
  }
}
