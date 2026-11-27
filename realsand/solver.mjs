/*
 * Hourglass sand lab: the position-based MPM solver on the GPU.
 *
 * Derived from Smoosh (src/smoosh.mjs, src/gpu.mjs, src/layout.mjs,
 * src/materials.mjs): Copyright (c) 2024 Alex Birch & Erik Sombroek, MIT
 * License. Its shaders derive from EA's PB-MPM: Copyright (c) 2024
 * Electronic Arts Inc., BSD-3-Clause. Both texts are in LICENSES.md.
 *
 * What changed for the lab (part of the Hourglass project, GPL-3.0):
 * - no Box2D, emitters, drains, renderer or testbed; one material at a time;
 * - the glass is the domain (glass.mjs writes its distance field);
 * - every substep carries its own field: gravity in any direction, less the
 *   glass's acceleration, plus the turning glass's terms (common.inc);
 * - Coulomb friction at the glass wall (gridUpdate.wgsl, g2p2g.wgsl);
 * - the substep rate, iterations, per-frame cap and per-substep clamp are
 *   settings, and the clamp is counted;
 * - a whole frame is one compute pass (bucket clears are dispatches), with
 *   uniforms chosen by dynamic offset; clears are folded into the dispatch
 *   before them where that is exact (gridUpdate zeroes the next grid,
 *   prepare the spread's sub-cell grid): 16 dispatches a substep with the
 *   spread pass, 14 without (21 and 18 before), since on a phone a dispatch
 *   has a fixed cost (dispatchesPerSubstep). How much is not fitted: the cost
 *   model put it at about 16 us (350 points' work), but an iPhone's coarse
 *   1-minute real-speed row (5cc11b3) leaves at most about 4 us a dispatch; the
 *   Benchmark's gpu ms/substep column is to settle it;
 * - a per-frame tally (counts, speeds; each bulb's bed, for the sound) is read back for the HUD,
 *   the tests and the app;
 * - a metered neck, off unless a run is given the valve's words (valve.mjs):
 *   a throttle in a band just above the counting line (gridUpdate.wgsl), a
 *   membrane that lets a point cross the line only downward and only with a
 *   ticket (g2p2g.wgsl, spreadShift.wgsl), the counts it needs (counters,
 *   tally), pours appended without a refill, and the flip pass (flip.wgsl)
 *   that turns the points end for end at a swap;
 * - a page's own pass after the tally (post: the app's tone pass for layered
 *   sand, layers.mjs), its 8 words read back in the readback slot's last 32
 *   bytes.
 */

export const PARTICLE_WORDS = 24;
export const SLOT = 256;               // bytes per uniform slot (dynamic offset alignment)
export const MAX_IT = 8;
const BUCKET = 6;
// counters (atomics the shaders add to): [0] nodes clamped (cumulative), [1] largest node move
// (cells x 1000, cumulative max); the metered neck's, set at each run's start: [2] crossings this
// run (tickets taken), [3] the points above at the run's start, [4] crossings refused this run,
// [5] upward crossings refused this run, [6] the substep of the run's last crossing (its frame
// number + 1; 0: none); [7] unused
const COUNTER_WORDS = 8;
// the tally (tally.wgsl), summed afresh by each run: 16 words of counts and speeds, then 6 for
// each bulb's bed (BED_WORDS: its momentum, count, place across the glass and what of it moves)
const TALLY_WORDS = 28;
const BED_AT = 16, BED_WORDS = 6;
const POST_WORDS = 8;
// a readback slot: the counters, then the tally, then the post pass's 8 words (Solver.post)
const READBACK_BYTES = (COUNTER_WORDS + TALLY_WORDS + POST_WORDS) * 4;

/**
 * One bulb's bed from the tally's words (u unsigned, s signed, at o): its points in a bed (n: not
 * the falling stream, not spray), their mean velocity (vx, vy: cells/s, the grid's frame, y up),
 * their centre across the glass from the neck's (x: cells), and of those that move (faster than
 * 2 % of a free fall over the glass) the number (sliding) and the summed speed (slide, cells/s).
 * What the sound is made from (app-sand.mjs, design 8).
 */
function bedOf(u, s, o) {
  const n = u[o + 2];
  return { n, vx: n ? s[o] / 4 / n : 0, vy: n ? s[o + 1] / 4 / n : 0, x: n ? s[o + 3] / 16 / n : 0, sliding: u[o + 5], slide: u[o + 4] / 4 };
}

export async function createDevice() {
  if (!globalThis.navigator?.gpu) throw Object.assign(new Error('WebGPU is not available'), { code: 'nogpu' });
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw Object.assign(new Error('No WebGPU adapter'), { code: 'noadapter' });
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: Math.min(8, adapter.limits.maxStorageBuffersPerShaderStage) } });
  let info = adapter.info;
  if (!info && adapter.requestAdapterInfo) { try { info = await adapter.requestAdapterInfo(); } catch (e) { info = null; } }
  const i = info || {};
  return {
    adapter, device,
    info: { vendor: i.vendor || '', architecture: i.architecture || '', device: i.device || '', description: i.description || '',
      fallback: !!(adapter.isFallbackAdapter || i.isFallbackAdapter) }
  };
}

/** WGSL with //!include, from Smoosh's ShaderLibrary. */
export class ShaderLibrary {
  constructor(base) { this.base = base; this.sources = new Map(); }
  async source(name, seen = new Set()) {
    if (seen.has(name)) return '';
    seen.add(name);
    if (!this.sources.has(name)) this.sources.set(name, fetch(new URL(`${name}.wgsl`, this.base)).then(async r => {
      if (!r.ok) throw new Error(`Could not load ${name}: HTTP ${r.status}`);
      return r.text();
    }));
    const raw = await this.sources.get(name);
    const lines = [];
    for (const line of raw.split('\n')) {
      const include = line.match(/^\s*\/\/!include\s+(.+)$/);
      if (include) lines.push(await this.source(include[1].trim(), seen));
      else lines.push(line);
    }
    return lines.join('\n');
  }
  async module(device, name) {
    const module = device.createShaderModule({ label: `lab ${name}`, code: await this.source(name) });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(`${name}: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n')}`);
    return module;
  }
}

// Binding kinds: u uniform (dynamic offset), r read-only storage, s storage
const LAYOUTS = {
  prepare: 'ussssss',
  bukkitCount: 'urrs',
  bukkitAllocate: 'urssssss',
  bukkitInsert: 'ursrsr',
  gridClear: 'usrrrrs',
  gridUpdate: 'usrrrsss',
  g2p2g: 'usrsrrrs',
  load: 'urrrs',
  rescale: 'urs',
  spreadSplat: 'urrs',
  spreadShift: 'ursrr',
  tally: 'urrrss',
  flip: 'urs'
};

/**
 * Materials. Smoosh's presets (materials.mjs) with the lab's wall friction:
 * sand on glass grips (mu about 0.45 to 0.5); a liquid slips, held back only
 * by a viscous skin. Sand takes EA's elasticity ratio of 1, not Smoosh's 0.5:
 * at 0.5 the sand was too soft to stand (heaps of 5 to 24 degrees whatever
 * its friction angle, and creeping); at 1 a heap stands. In this 2-D solver
 * a heap stands steeper than the friction angle it is given, and with the
 * packing measure below the step is steep: measured 2.5 s after a column is
 * released on the coarse grid, 26 -> 26.4, 27.5 -> 29.3, 28.5 -> 31.5,
 * 29 -> 35.1, 30 -> 39.3 degrees. So the friction angles below are set for
 * heaps of about 31 to 35 (coarse) and 29 to 31 (fine) degrees. (Heaps keep
 * steepening by 2 to 5 degrees over the next second: an open issue.)
 *
 * Sand also measures how tightly it is packed, from the grid (g2p2g.wgsl):
 * restPacking is the packing it settles back to (1: as filled), and loose
 * sand packs down under load instead of keeping every expansion (without it
 * a bed at rest swelled by half in 3 s, and a shaken heap to 2.5 times its
 * size). Since the packing is the mean over the filled nodes (it was the
 * densest node, which read sand 3 to 5 % looser than its fill as packed, so
 * that it swelled and was stiffer than its looseness allowed), slightly loose
 * sand takes some compression plastically and stands lower: at the old 28.5
 * and 27.5 degrees, heaps of 27.4 and 26.1. The angles are set again for the
 * same heaps as before (measured: coarse 30 -> 29.1, 31 -> 30.6, 32 -> 28.7,
 * a noisy step; fine 29 -> 27.4, 30 -> 29.2), so coarse 31 and fine 30.
 * floorLoose: 0, loose sand packs down only as fast as its load gets
 * through the constraint (1: freely, which made the bed bounce in place).
 *
 * spread: the solver's grid is a cell wide and cannot see how the points sit
 * inside a cell, so in a sheared, dilating flow they crowd into lines with
 * dark gaps between (the combed stripes and voids of a turn or a shake). Each
 * substep a sand point that crowds its neighbours (a density, on a grid half a
 * cell wide, above spreadThr) steps down that density's gradient, by spread
 * times the excess, at most spreadCap cells: a position correction, its
 * velocity untouched. 0 turns it off.
 *
 * compact, packMax: real sand packs tighter when it is tapped or shaken, and
 * stays so. Each sand point keeps its own packing (1: the fill's); each time it
 * is packed down again from a loosened state, it gains compact x the
 * compaction taken x the room left to packMax; plastic shear loosens it back
 * toward 1 (dilate). 0 turns it off.
 *
 * yieldLoop, yieldScale: sand yields inside the solver's iterations, not only
 * at the end of a substep (g2p2g.wgsl). EA's target clamped the trial strain's
 * stretches at 1 from below, which turned every shear into a dilation, so in
 * the solve sand resisted shear only by dilating, about 45 degrees' worth: a
 * bed turned as one block and, once it failed, ran out like a liquid. With
 * yieldLoop the target is the trial strain projected onto the Drucker-Prager
 * cone, yieldScale of the return map's: shear inside the cone is held, shear
 * beyond it flows. The heap's angle follows yieldScale x the cone's slope
 * (measured, coarse: 0.8 at 31 degrees -> a heap of 31.1; 0.7 at 33 -> 27.9;
 * 0.65 at 35 -> 27.4), and so does the turn: at 0.65 a slowly turned bed fails
 * in surface sheets from 55 degrees and stops at 28.5, at 0.8 only from 85. No
 * setting gave both a heap of 30 or more and sheets early in the turn, so 0.8
 * keeps the heaps right; the turn's block slide from 40 to 60 degrees remains.
 * It is OFF by default (More, "yield": in loop / at end): with it the Flip's
 * cone at rest fell to 19.7 degrees (flanks 25.7 / 13.8; 34.6 without it, 29.8
 * at 5cc11b3) and its young cone to 6 to 10, at 0.8 and at 0.85 alike (1.0
 * heaps at 47), and a fast turn still ran out to 16 degrees.
 *
 * yieldStep 2, loadScale (off by default; an experiment): the cone no larger
 * than the load allows, the depth of sand above the point (load.wgsl, one
 * more dispatch a substep) x g x loadScale. Meant to stop a settled bed
 * being stronger than a fresh heap. Measured: it does not stop the block
 * slide (1.5: heap 27.6, the bed still turns as a block from 35 to 60
 * degrees). yieldStep 3 keeps the cone of yieldLoop for compressed sand and
 * gives loosened sand that still carries a load its friction (the same load
 * pass): measured at 2, a heap of 28.6 and a fast turn no less liquid (face
 * 18.9 degrees 0.4 s after, against 21.5 without). (yieldStep 1, this
 * substep's compression alone: no strength, heaps flat.) Also tried and not
 * kept (November 2026): the same load-sized friction for loosened sand in the
 * return map at the end of each substep (its shear strain kept up to the cone
 * of the load, scale 2; one more dispatch): a slowly turned bed no longer ran
 * out (face 43 to 46 degrees after, against 22) but still slid round the glass
 * as a block, now on the wall (wallFriction 0.5), a column fell to a heap of
 * 21.8 and a fast turn ran out to 8 degrees: shear kept without the pressure
 * that goes with it pulls the sand apart.
 *
 * surfPush (sand; from build 8): a leaned bed sheds sheets off its surface
 * instead of standing over-steep until it fails as a block. Each substep the
 * first gridClear (no dispatch of its own) finds the nodes of a free surface
 * steeper than surfStart to gravity (surfStop once a push ran there within
 * surfMem s), in the top surfDepth cells, slower than surfV1 to surfV2 times
 * the tally's moving speed, 3 cells or more inside the glass, not covered by
 * glass along "up", and beyond surfNeck + surfNeckFade neck half-widths of the
 * neck; there the push is surfPush x g x cos(face), ramped in over surfRamp
 * degrees. g2p2g.wgsl sets it as a speed in each sand point's next
 * prediction, 200 cells/s per g of push (at most 120): a point moves down the
 * surface at least that fast. Added as a force (0.3 or 0.6 g) the solve
 * absorbed it; shifting the points after the substep combed the surface (a
 * per-node field read bilinearly); set as a speed, read through the B-spline,
 * it does neither. A node starts a push only once gravity has turned surfTilt
 * degrees from the direction its sand settled under (when it arrived at the
 * node, or last ran faster than surfV2 times the moving speed): a heap poured
 * in a glass held still keeps the solver's own faces, which stand over
 * surfStart here and there as often as a leaned bed's do (with the push on
 * and no such gate, lab case 2's heap lay 3 to 4 degrees low). The figures:
 * docs/design/real-sand.md, 7.2.
 *
 * Syrup wets the glass (wallDrag 1: no slip) and is three times as viscous as
 * before, so it oozes; its viscosity term is at its ceiling (1), so it still
 * drains faster than sand. Fine sand grips the glass as coarse does (0.5):
 * at 0.42 a jerk threw it up the wall in a curling tongue.
 */
export const MATERIALS = {
  coarse: { label: 'Coarse sand', model: 2, frictionAngle: 31, viscosity: 0.015, relaxation: 1.2, elasticity: 1, plasticity: 0, density: 1, stiffness: 1.5, wallFriction: 0.5, wallDrag: 0, spread: 0.3, compact: 0.5, packMax: 1.05, yieldLoop: 0, yieldScale: 0.8, surfPush: 0.3, surfStart: 33, surfStop: 31, surfTilt: 3 },
  fine:   { label: 'Fine sand',   model: 2, frictionAngle: 30, viscosity: 0.015, relaxation: 1.2, elasticity: 1, plasticity: 0, density: 1, stiffness: 1.5, wallFriction: 0.5, wallDrag: 0, spread: 0.3, compact: 0.5, packMax: 1.05, yieldLoop: 0, yieldScale: 0.8, surfPush: 0.3, surfStart: 32, surfStop: 30, surfTilt: 3 },
  water:  { label: 'Water',       model: 0, frictionAngle: 0,  viscosity: 0.01,  relaxation: 1.5, elasticity: 0, plasticity: 0, density: 1, stiffness: 1, wallFriction: 0, wallDrag: 0.002 },
  syrup:  { label: 'Syrup',       model: 0, frictionAngle: 0,  viscosity: 1,     relaxation: 1.5, elasticity: 0, plasticity: 0, density: 1, stiffness: 1, wallFriction: 0, wallDrag: 1 }
};

/**
 * Dispatches a substep, as run() encodes them: prepare and the 3 bucket passes; per
 * iteration a G2P2G after the grid's clear (the first) or its update (which clears too);
 * the load pass (yieldStep 2 or 3, with yield in the loop); the spread's splat and shift.
 * With 5 iterations: 16 with the spread, 14 without. (Per frame, a tally; and a rescale
 * when the rate changes.) The surface push's pass is folded into the first gridClear: no
 * dispatch of its own.
 */
export function dispatchesPerSubstep(iterations, m) {
  const sand = m.model === 2;
  return 4 + 2 * iterations + (sand && m.yieldLoop && m.yieldStep >= 2 ? 1 : 0) + (sand && m.spread ? 2 : 0);
}

export class Solver {
  /**
   * shaders: the shaders' base URL, or a ShaderLibrary to reuse (the app keeps one a page, so
   * that a rebuilt solver compiles the very sources the page started with, never a newer copy).
   */
  static async create(device, shaders) {
    const s = new Solver(device, shaders && typeof shaders.module === 'function' ? shaders : new ShaderLibrary(shaders));
    await s.init();
    return s;
  }

  constructor(device, shaders) {
    this.device = device; this.shaders = shaders;
    this.buffers = {}; this.readbacks = [];
    this.frame = 0; this.gridIndex = 0; this.count = 0;
    this.lastHz = null;
    this.uniformData = null;
    this.dispatched = 0;               // dispatches encoded since the page loaded (counted by run)
    // a page's own pass after the tally (the app's tone pass, layers.mjs): post(encoder, count),
    // and postWords, a buffer of 8 words copied into the readback after it (null: none)
    this.post = null; this.postWords = null;
    this.errors = [];
    device.addEventListener?.('uncapturederror', e => { if (this.errors.length < 8) this.errors.push(String(e.error?.message || e.error)); });
  }

  async init() {
    const d = this.device;
    this.layouts = {};
    for (const [name, kinds] of Object.entries(LAYOUTS)) {
      this.layouts[name] = d.createBindGroupLayout({
        label: `lab ${name} layout`,
        entries: [...kinds].map((k, binding) => ({
          binding, visibility: GPUShaderStage.COMPUTE,
          buffer: k === 'u' ? { type: 'uniform', hasDynamicOffset: true, minBindingSize: SLOT }
            : { type: k === 'r' ? 'read-only-storage' : 'storage' }
        }))
      });
    }
    const pipe = async (name, constants) => {
      const module = await this.shaders.module(d, name);
      return d.createComputePipelineAsync({
        label: `lab ${name}`, layout: d.createPipelineLayout({ bindGroupLayouts: [this.layouts[name]] }),
        compute: { module, entryPoint: 'csMain', ...(constants ? { constants } : {}) }
      });
    };
    const names = Object.keys(LAYOUTS);
    const made = await Promise.all(names.map(n => pipe(n)));
    this.pipelines = Object.fromEntries(names.map((n, i) => [n, made[i]]));
    this.pipelines.g2p2gSolid = await pipe('g2p2g', { enableSolidMaterials: true });
  }

  /** Buffers for a glass and a number of material points; uniform slots for `cap` substeps a submit. */
  configure(glass, maxParticles, cap) {
    this.destroyBuffers();
    const d = this.device, U = GPUBufferUsage;
    this.glass = glass;
    this.W = glass.W; this.H = glass.H;
    this.bucketX = Math.ceil(this.W / BUCKET); this.bucketY = Math.ceil(this.H / BUCKET);
    this.bucketCount = this.bucketX * this.bucketY;
    this.maxParticles = maxParticles;
    this.bucketParticleOffset = (Math.ceil(maxParticles / 64) + this.bucketCount) * 4;
    this.cap = cap;
    const nodes = this.W * this.H;
    const mk = (name, bytes, usage, initial) => {
      const b = d.createBuffer({ label: `lab ${name}`, size: Math.max(16, Math.ceil(bytes / 16) * 16), usage });
      if (initial) d.queue.writeBuffer(b, 0, initial);
      this.buffers[name] = b; return b;
    };
    const S = U.STORAGE | U.COPY_DST | U.COPY_SRC;
    mk('particles', maxParticles * PARTICLE_WORDS * 4, S);
    mk('count', 16, S);
    mk('grid0', nodes * 16, S); mk('grid1', nodes * 16, S);
    mk('domain', nodes * 16, S, glass.field);
    mk('wall', nodes * 4, S);
    // per node: the depth of sand above it (load.wgsl), and the surface push and its memory
    // (gridClear.wgsl), 4 floats
    mk('load', nodes * 16, S);
    // the sub-cell density grid (nodes half a cell apart) on which sand points spread
    this.fineCount = (2 * this.W + 2) * (2 * this.H + 2);
    mk('fine', this.fineCount * 4, S);
    mk('bucketCount', this.bucketCount * 4, S);
    mk('bucketInsertCount', this.bucketCount * 4, S);
    mk('bucketStarts', this.bucketCount * 4, S);
    mk('allocator', 16, S);
    mk('bucketData', (this.bucketParticleOffset + maxParticles) * 4, S);
    mk('bucketArgs', 16, S | U.INDIRECT, new Uint32Array([0, 1, 1, 0]));
    mk('gridArgs', 16, S | U.INDIRECT, new Uint32Array([0, 1, 1, 0]));
    mk('gridBuckets', this.bucketCount * 4, S);
    mk('counters', COUNTER_WORDS * 4, S);
    mk('tally', TALLY_WORDS * 4, S);
    // per column and bulb, the highest point at rest (tally.wgsl)
    mk('surface', 2 * this.W * 4, S);
    this.allocUniforms(cap);
    this.readbacks = [];
    for (let i = 0; i < 3; i++) this.readbacks.push({ buffer: d.createBuffer({ label: 'lab readback', size: READBACK_BYTES, usage: U.COPY_DST | U.MAP_READ }), pending: false });
    this.makeGroups();
    this.frame = 0; this.gridIndex = 0; this.lastHz = null;
  }

  allocUniforms(cap) {
    const U = GPUBufferUsage;
    this.buffers.uniforms?.destroy();
    this.cap = cap;
    this.uniformData = new ArrayBuffer(cap * MAX_IT * SLOT);
    this.uf = new Float32Array(this.uniformData); this.uu = new Uint32Array(this.uniformData);
    this.buffers.uniforms = this.device.createBuffer({ label: 'lab uniforms', size: this.uniformData.byteLength, usage: U.UNIFORM | U.COPY_DST });
    if (this.pipelines && this.buffers.particles) this.makeGroups();
  }

  makeGroups() {
    const d = this.device, b = this.buffers;
    const uni = { buffer: b.uniforms, offset: 0, size: SLOT };
    const group = (name, list) => d.createBindGroup({
      label: `lab ${name} group`, layout: this.layouts[name],
      entries: [uni, ...list].map((r, binding) => ({ binding, resource: r.buffer ? r : { buffer: r } }))
    });
    this.groups = {
      prepare: group('prepare', [b.bucketCount, b.bucketInsertCount, b.allocator, b.bucketArgs, b.gridArgs, b.fine]),
      count: group('bukkitCount', [b.count, b.particles, b.bucketCount]),
      allocate: group('bukkitAllocate', [b.bucketCount, b.bucketArgs, b.bucketData, b.allocator, b.bucketStarts, b.gridArgs, b.gridBuckets]),
      insert: group('bukkitInsert', [b.count, b.bucketInsertCount, b.particles, b.bucketData, b.bucketStarts]),
      // clear[i]: zeroes grid i and reads the other, the one the last P2G wrote (the surface pass)
      clear: [b.grid0, b.grid1].map((g, i) => group('gridClear', [g, b.gridBuckets, b.gridArgs, i ? b.grid0 : b.grid1, b.domain, b.load])),
      // update[i]: grid i's update, which also zeroes the other grid (the next iteration's)
      update: [0, 1].map(i => group('gridUpdate', [i ? b.grid1 : b.grid0, b.domain, b.gridBuckets, b.gridArgs, b.wall, b.counters, i ? b.grid0 : b.grid1])),
      solve: [0, 1].map(i => group('g2p2g', [b.particles, i ? b.grid1 : b.grid0, i ? b.grid0 : b.grid1, b.bucketData, b.domain, b.load, b.counters])),
      load: [b.grid0, b.grid1].map(g => group('load', [g, b.gridBuckets, b.gridArgs, b.load])),
      rescale: group('rescale', [b.count, b.particles]),
      spreadSplat: group('spreadSplat', [b.count, b.particles, b.fine]),
      spreadShift: group('spreadShift', [b.count, b.particles, b.fine, b.domain]),
      tally: group('tally', [b.count, b.particles, b.domain, b.tally, b.surface]),
      flip: group('flip', [b.count, b.particles])
    };
  }

  /**
   * Put material points in the glass: a Float32Array of count x 24 floats. The tally is
   * written with the data's own counts, as a tally pass would count it (points, above and below
   * the counting line), so that the next run's count above at its start is exact (the metered
   * neck, valve.mjs). Returns those counts: { points, above, below }.
   */
  upload(data, count) {
    const d = this.device, b = this.buffers;
    this.count = count;
    d.queue.writeBuffer(b.particles, 0, data, 0, count * PARTICLE_WORDS);
    d.queue.writeBuffer(b.count, 0, new Uint32Array([count, this.maxParticles, 0, 0]));
    const e = d.createCommandEncoder();
    for (const k of ['grid0', 'grid1', 'wall', 'load', 'counters', 'surface']) e.clearBuffer(b[k]);
    d.queue.submit([e.finish()]);
    const sides = this.countSides(data, count), t = new Uint32Array(TALLY_WORDS);
    t[0] = sides.points; t[1] = sides.above; t[2] = sides.below;
    d.queue.writeBuffer(b.tally, 0, t);
    this.frame = 0; this.gridIndex = 0; this.lastHz = null;
    return sides;
  }

  /** The points of data (count x 24 floats) above and below the counting line, as tally.wgsl counts them. */
  countSides(data, count) {
    const line = Math.fround(this.glass.cy);
    let points = 0, above = 0, below = 0;
    for (let i = 0; i < count; i++) {
      const o = i * PARTICLE_WORDS;
      if (data[o + 15] === 0) continue;                      // not enabled
      points++;
      const x = data[o], y = data[o + 1], dx = data[o + 2], dy = data[o + 3];
      if (!(x === x && y === y && dx === dx && dy === dy) || Math.abs(x) > 1e9 || Math.abs(dx) > 1e9 || Math.abs(dy) > 1e9) continue;
      if (y > line) above++; else below++;
    }
    return { points, above, below };
  }

  /**
   * Add n material points after those in the glass (a pour), without a refill: a Float32Array
   * of n x 24 floats, every point above the counting line. The tally is not written: the
   * metered neck offers these points to the membrane through its allowance (valve.mjs pour).
   * mirrored: a swap is waiting for the flip pass (valve.mjs flipPending), so the points are
   * written turned half a turn about the centre, as the GPU's points lie now; the next run's
   * flip pass carries them where they belong. Returns n.
   */
  append(data, n, mirrored = false) {
    if (!(n > 0)) return 0;
    if (this.count + n > this.maxParticles) throw new RangeError(`append: no room for ${n} points (${this.count} of ${this.maxParticles} in use)`);
    const src = data.slice(0, n * PARTICLE_WORDS), line = Math.fround(this.glass.cy);
    const cx2 = 2 * this.glass.cx, cy2 = 2 * this.glass.cy;
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_WORDS;
      if (!(src[o + 1] > line)) throw new RangeError('append: every point must lie above the counting line');
      if (mirrored) { src[o] = cx2 - src[o]; src[o + 1] = cy2 - src[o + 1]; src[o + 2] = -src[o + 2]; src[o + 3] = -src[o + 3]; }
    }
    const d = this.device, b = this.buffers;
    d.queue.writeBuffer(b.particles, this.count * PARTICLE_WORDS * 4, src, 0, n * PARTICLE_WORDS);
    this.count += n;
    d.queue.writeBuffer(b.count, 0, new Uint32Array([this.count, this.maxParticles, 0, 0]));
    return n;
  }

  /**
   * Write one uniform slot. f: the substep's field { gravity:[x,y] cells/s²
   * (grid frame), omega, alpha (grid frame), cor (Coriolis factor), gate };
   * neck: the valve's words for the run (run()), or none (the neck off); s the substep.
   */
  writeSlot(slot, set, f, iteration, frame, neck, s = 0) {
    const o = slot * SLOT / 4, F = this.uf, U = this.uu, m = set.material;
    U[o] = this.W; U[o + 1] = this.H;
    F[o + 2] = 1 / set.hz;
    U[o + 3] = 10000000;
    U[o + 4] = this.bucketCount; U[o + 5] = this.bucketX; U[o + 6] = this.bucketY;
    U[o + 7] = iteration; U[o + 8] = set.iterations;
    U[o + 9] = 1; U[o + 10] = 2; U[o + 11] = this.bucketParticleOffset;
    F[o + 12] = f.gravity[0]; F[o + 13] = f.gravity[1];
    F[o + 14] = this.glass.cx; F[o + 15] = this.glass.cy;
    F[o + 16] = f.omega; F[o + 17] = f.alpha;
    F[o + 18] = m.wallFriction; F[o + 19] = m.wallDrag;
    F[o + 20] = set.maxStep; F[o + 21] = set.coriolis ? (f.cor ?? 1) : 0;
    U[o + 22] = frame;
    F[o + 23] = this.lastHz ? this.lastHz / set.hz : 1;
    F[o + 24] = this.lastHz ? 1 / this.lastHz : 1 / set.hz;
    F[o + 25] = this.glass.cy;
    F[o + 26] = f.gate ? 1 : 0; F[o + 27] = this.glass.rn;
    F[o + 28] = m.viscosity; F[o + 29] = m.model === 2 ? (m.restPacking ?? 1) : m.relaxation; F[o + 30] = m.elasticity; F[o + 31] = m.model === 2 ? (m.coneK || 0) : m.plasticity;
    F[o + 32] = m.frictionAngle; F[o + 33] = m.density; F[o + 34] = m.stiffness; F[o + 35] = m.model;
    F[o + 36] = neck ? neck.vcap : 0; F[o + 37] = neck ? neck.allow[Math.min(s, neck.allow.length - 1)] : 0;
    U[o + 38] = neck ? neck.flags : 0; F[o + 39] = m.floorLoose ?? 0;
    const sand = m.model === 2;
    F[o + 40] = m.spread ?? 0; F[o + 41] = m.spreadThr ?? 0.8; F[o + 42] = m.spreadCap ?? 0.05; F[o + 43] = sand ? (m.surfTilt ?? 0) : 0;
    F[o + 44] = m.compact ?? 0; F[o + 45] = m.packMax ?? 1; F[o + 46] = m.dilate ?? 1; F[o + 47] = sand ? (m.surfFace ?? 2) : 2;
    F[o + 48] = m.yieldLoop ?? 0; F[o + 49] = m.yieldScale ?? 1; F[o + 50] = m.yieldStep ?? 0; F[o + 51] = m.yieldStep >= 2 ? (m.loadScale ?? 2) : (m.yieldStepScale ?? 1);
    // the surface push (gridClear.wgsl, g2p2g.wgsl): sand only; surfProbe computes it without applying it
    const sp = sand ? (m.surfPush ?? 0) : 0;
    F[o + 52] = sand && m.surfProbe ? 2 : sp > 0 ? 1 : 0; F[o + 53] = sp; F[o + 54] = m.surfStart ?? 33; F[o + 55] = m.surfStop ?? 31;
    F[o + 56] = m.surfRamp ?? 3; F[o + 57] = m.surfDepth ?? 3; F[o + 58] = m.surfNeck ?? 4; F[o + 59] = m.surfNeckFade ?? 2;
    F[o + 60] = m.surfV1 ?? 1.3; F[o + 61] = m.surfV2 ?? 2.6; F[o + 62] = set.g0 ?? 0; F[o + 63] = Math.max(1, Math.round((m.surfMem ?? 0.05) * set.hz));
  }

  /**
   * Encode `steps` substeps (at most the cap), with fieldAt(k) giving substep
   * k's field, and a tally; then `after(encoder)` (drawing) and submit.
   * Returns a promise of the tally (or null if every readback slot is busy).
   *
   * neck: the metered neck's words for this run, from valve.mjs run() (none: the neck is off,
   * words 36-38 are 0, as in the lab): { flip, vcap, allow (per substep), flags }. Give the valve
   * the same number of substeps (no more than the cap). The run begins with the flip pass when
   * flip is set; then counters[3], the points above at the run's start, is the last tally's
   * count above (below, in a run that flipped: those are now above) and counters[2, 4, 5, 6] are
   * cleared. The readback carries what valve.mjs onReadback takes.
   */
  run(steps, set, fieldAt, after, neck = null) {
    const d = this.device, b = this.buffers, P = this.pipelines, G = this.groups;
    steps = Math.min(steps, this.cap);
    const its = set.iterations;
    for (let s = 0; s < Math.max(steps, 1); s++) {
      const f = fieldAt(s);
      for (let it = 0; it < its; it++) this.writeSlot(s * MAX_IT + it, set, f, it, this.frame + s, neck, s);
    }
    d.queue.writeBuffer(b.uniforms, 0, this.uniformData, 0, Math.max(steps, 1) * MAX_IT * SLOT);
    const enc = d.createCommandEncoder({ label: 'lab frame' });
    const n64 = Math.ceil(this.count / 64);
    const flip = !!(neck && neck.flip);
    if (flip && this.count) {
      // the flip pass, and the grids, the wall's grip and the load cleared as an upload does
      const fp = enc.beginComputePass({ label: 'lab flip' });
      fp.setPipeline(P.flip); fp.setBindGroup(0, G.flip, [0]); fp.dispatchWorkgroups(n64); fp.end();
      this.dispatched++;
      for (const k of ['grid0', 'grid1', 'wall', 'load']) enc.clearBuffer(b[k]);
    }
    enc.copyBufferToBuffer(b.tally, flip ? 8 : 4, b.counters, 12, 4);
    enc.clearBuffer(b.counters, 8, 4);
    enc.clearBuffer(b.counters, 16, 12);
    const frame0 = this.frame;
    enc.clearBuffer(b.tally);
    enc.clearBuffer(b.surface);
    const pass = enc.beginComputePass({ label: 'lab PB-MPM' });
    const go = (pipe, group, slot, size) => {
      pass.setPipeline(pipe); pass.setBindGroup(0, group, [slot * SLOT]); this.dispatched++;
      if (Array.isArray(size)) pass.dispatchWorkgroups(...size); else if (typeof size === 'number') pass.dispatchWorkgroups(size);
      else pass.dispatchWorkgroupsIndirect(size, 0);
    };
    const solid = set.material.model !== 0 ? P.g2p2gSolid : P.g2p2g;
    const useLoad = set.material.model === 2 && set.material.yieldLoop && set.material.yieldStep >= 2;
    if (steps && this.lastHz && this.lastHz !== set.hz && this.count) go(P.rescale, G.rescale, 0, n64);
    const spread = set.material.model === 2 && !!set.material.spread;
    if (this.count) for (let s = 0; s < steps; s++) {
      const base = s * MAX_IT;
      // (with the spread on, prepare also clears the sub-cell grid: one thread a node of it)
      go(P.prepare, G.prepare, base, Math.ceil(Math.max(this.bucketCount, spread ? this.fineCount : 0) / 64));
      go(P.bukkitCount, G.count, base, n64);
      go(P.bukkitAllocate, G.allocate, base, [Math.ceil(this.bucketX / 8), Math.ceil(this.bucketY / 8)]);
      go(P.bukkitInsert, G.insert, base, n64);
      // sand's load: the depth of sand above each node, from the last substep's grid (load.wgsl)
      if (useLoad) go(P.load, G.load[this.gridIndex], base, b.gridArgs);
      for (let it = 0; it < its; it++) {
        const next = 1 - this.gridIndex;
        // the next grid is zeroed where this substep's sand can reach: by gridClear before the
        // first iteration, then by each grid update (which zeroes it node for node as it goes)
        if (it) go(P.gridUpdate, G.update[this.gridIndex], base + it, b.gridArgs);
        else go(P.gridClear, G.clear[next], base + it, b.gridArgs);
        go(solid, G.solve[this.gridIndex], base + it, b.bucketArgs);
        this.gridIndex = next;
      }
      // sand points that crowd together inside a cell move apart (spreadShift.wgsl)
      if (spread) {
        go(P.spreadSplat, G.spreadSplat, base, n64);
        go(P.spreadShift, G.spreadShift, base, n64);
      }
    }
    if (this.count) go(P.tally, G.tally, Math.max(steps - 1, 0) * MAX_IT, n64);
    pass.end();
    if (this.post && this.count) this.post(enc, this.count);
    if (steps) { this.frame += steps; this.lastHz = set.hz; }
    const slot = this.readbacks.find(r => !r.pending), post = this.postWords;
    if (slot) {
      enc.copyBufferToBuffer(b.counters, 0, slot.buffer, 0, COUNTER_WORDS * 4);
      enc.copyBufferToBuffer(b.tally, 0, slot.buffer, COUNTER_WORDS * 4, TALLY_WORDS * 4);
      if (post) enc.copyBufferToBuffer(post, 0, slot.buffer, (COUNTER_WORDS + TALLY_WORDS) * 4, POST_WORDS * 4);
    }
    if (after) after(enc);
    d.queue.submit([enc.finish()]);
    if (!slot) return null;
    slot.pending = true;
    return slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      const u = new Uint32Array(slot.buffer.getMappedRange().slice(0)), t = COUNTER_WORDS, i = new Int32Array(u.buffer);
      slot.buffer.unmap(); slot.pending = false;
      return { clamped: u[0], maxMove: u[1] / 1000, points: u[t], above: u[t + 1], below: u[t + 2], outside: u[t + 3], nan: u[t + 4],
        maxSpeed: u[t + 5] / 4, meanSpeed: u[t] ? u[t + 6] / 4 / u[t] : 0, moving: u[t + 7],
        // the metered neck's (valve.mjs onReadback)
        crossings: u[2], start: u[3], refused: u[4], upward: u[5], queue: u[t + 8], crowdSpeed: u[t + 9] / 4, brim: u[t + 10],
        // the substep of the run (0 first) in which the last point crossed the line; -1: none crossed
        lastCross: u[6] ? u[6] - 1 - frame0 : -1,
        // the depth of the lowest point below the counting line, cells (the lab's Timer times the first fall with it)
        deepest: u[t + 11] / 16,
        // the beds, for the sound: [the bulb above the line, the one on it or below] (bedOf)
        beds: [bedOf(u, i, t + BED_AT), bedOf(u, i, t + BED_AT + BED_WORDS)],
        // the post pass's words (null: none)
        post: post ? Array.from(u.subarray(t + TALLY_WORDS, t + TALLY_WORDS + POST_WORDS)) : null };
    }, e => {
      slot.pending = false;
      if (!this.readbacks.includes(slot)) return null;   // the glass was rebuilt while this was in flight
      throw e;
    });
  }

  /** All material points, read back (for the tests and the heap angle). */
  async readParticles() {
    const d = this.device, size = Math.max(16, this.count * PARTICLE_WORDS * 4);
    const staging = d.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(this.buffers.particles, 0, staging, 0, size);
    d.queue.submit([e.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    return out;
  }

  /** The load buffer, 4 floats a node (x: load.wgsl's depth; y, z: the surface push, cells/s²; w: its memory, substeps). */
  async readLoad() {
    const d = this.device, size = this.W * this.H * 16;
    const staging = d.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(this.buffers.load, 0, staging, 0, size);
    d.queue.submit([e.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    return out;
  }

  /** Per column, the highest point at rest (tally.wgsl; grid y x 16, 0: none): [0, W) above the line, [W, 2W) below. */
  async readSurface() {
    const d = this.device, size = 2 * this.W * 4;
    const staging = d.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(this.buffers.surface, 0, staging, 0, size);
    d.queue.submit([e.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    return out;
  }

  destroyBuffers() {
    for (const b of Object.values(this.buffers)) b.destroy?.();
    for (const r of this.readbacks) r.buffer.destroy?.();
    this.buffers = {}; this.readbacks = [];
  }
}
