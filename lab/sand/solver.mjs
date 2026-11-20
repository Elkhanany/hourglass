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
 *   uniforms chosen by dynamic offset;
 * - a per-frame tally (counts, speeds) is read back for the HUD and tests.
 */

export const PARTICLE_WORDS = 24;
export const SLOT = 256;               // bytes per uniform slot (dynamic offset alignment)
export const MAX_IT = 8;
const BUCKET = 6;
const TALLY_WORDS = 8;

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
  prepare: 'usssss',
  bukkitCount: 'urrs',
  bukkitAllocate: 'urssssss',
  bukkitInsert: 'ursrsr',
  gridClear: 'usrr',
  gridUpdate: 'usrrrss',
  g2p2g: 'usrsrr',
  rescale: 'urs',
  tally: 'urrrs'
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
 * size). floorLoose: 0, loose sand packs down only as fast as its load gets
 * through the constraint (1: freely, which made the bed bounce in place).
 */
export const MATERIALS = {
  coarse: { label: 'Coarse sand', model: 2, frictionAngle: 28.5, viscosity: 0.015, relaxation: 1.2, elasticity: 1, plasticity: 0, density: 1, stiffness: 1.5, wallFriction: 0.5, wallDrag: 0 },
  fine:   { label: 'Fine sand',   model: 2, frictionAngle: 27.5, viscosity: 0.015, relaxation: 1.2, elasticity: 1, plasticity: 0, density: 1, stiffness: 1.5, wallFriction: 0.42, wallDrag: 0 },
  water:  { label: 'Water',       model: 0, frictionAngle: 0,  viscosity: 0.01,  relaxation: 1.5, elasticity: 0, plasticity: 0, density: 1, stiffness: 1, wallFriction: 0, wallDrag: 0.002 },
  syrup:  { label: 'Syrup',       model: 0, frictionAngle: 0,  viscosity: 0.35,  relaxation: 1.5, elasticity: 0, plasticity: 0, density: 1, stiffness: 1, wallFriction: 0, wallDrag: 0.05 }
};

export class Solver {
  static async create(device, shaderBase) {
    const s = new Solver(device, new ShaderLibrary(shaderBase));
    await s.init();
    return s;
  }

  constructor(device, shaders) {
    this.device = device; this.shaders = shaders;
    this.buffers = {}; this.readbacks = [];
    this.frame = 0; this.gridIndex = 0; this.count = 0;
    this.lastHz = null;
    this.uniformData = null;
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
    mk('bucketCount', this.bucketCount * 4, S);
    mk('bucketInsertCount', this.bucketCount * 4, S);
    mk('bucketStarts', this.bucketCount * 4, S);
    mk('allocator', 16, S);
    mk('bucketData', (this.bucketParticleOffset + maxParticles) * 4, S);
    mk('bucketArgs', 16, S | U.INDIRECT, new Uint32Array([0, 1, 1, 0]));
    mk('gridArgs', 16, S | U.INDIRECT, new Uint32Array([0, 1, 1, 0]));
    mk('gridBuckets', this.bucketCount * 4, S);
    mk('counters', 16, S);
    mk('tally', TALLY_WORDS * 4, S);
    this.allocUniforms(cap);
    this.readbacks = [];
    for (let i = 0; i < 3; i++) this.readbacks.push({ buffer: d.createBuffer({ label: 'lab readback', size: 64, usage: U.COPY_DST | U.MAP_READ }), pending: false });
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
      prepare: group('prepare', [b.bucketCount, b.bucketInsertCount, b.allocator, b.bucketArgs, b.gridArgs]),
      count: group('bukkitCount', [b.count, b.particles, b.bucketCount]),
      allocate: group('bukkitAllocate', [b.bucketCount, b.bucketArgs, b.bucketData, b.allocator, b.bucketStarts, b.gridArgs, b.gridBuckets]),
      insert: group('bukkitInsert', [b.count, b.bucketInsertCount, b.particles, b.bucketData, b.bucketStarts]),
      clear: [b.grid0, b.grid1].map(g => group('gridClear', [g, b.gridBuckets, b.gridArgs])),
      update: [b.grid0, b.grid1].map(g => group('gridUpdate', [g, b.domain, b.gridBuckets, b.gridArgs, b.wall, b.counters])),
      solve: [0, 1].map(i => group('g2p2g', [b.particles, i ? b.grid1 : b.grid0, i ? b.grid0 : b.grid1, b.bucketData, b.domain])),
      rescale: group('rescale', [b.count, b.particles]),
      tally: group('tally', [b.count, b.particles, b.domain, b.tally])
    };
  }

  /** Put material points in the glass: a Float32Array of count x 24 floats. */
  upload(data, count) {
    const d = this.device, b = this.buffers;
    this.count = count;
    d.queue.writeBuffer(b.particles, 0, data, 0, count * PARTICLE_WORDS);
    d.queue.writeBuffer(b.count, 0, new Uint32Array([count, this.maxParticles, 0, 0]));
    const e = d.createCommandEncoder();
    for (const k of ['grid0', 'grid1', 'wall', 'counters', 'tally']) e.clearBuffer(b[k]);
    d.queue.submit([e.finish()]);
    this.frame = 0; this.gridIndex = 0; this.lastHz = null;
  }

  /**
   * Write one uniform slot. f: the substep's field { gravity:[x,y] cells/s²
   * (grid frame), omega, alpha (grid frame), cor (Coriolis factor), gate }.
   */
  writeSlot(slot, set, f, iteration, frame) {
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
    F[o + 36] = 0; F[o + 37] = 0; F[o + 38] = 0; F[o + 39] = m.floorLoose ?? 0;
  }

  /**
   * Encode `steps` substeps (at most the cap), with fieldAt(k) giving substep
   * k's field, and a tally; then `after(encoder)` (drawing) and submit.
   * Returns a promise of the tally (or null if every readback slot is busy).
   */
  run(steps, set, fieldAt, after) {
    const d = this.device, b = this.buffers, P = this.pipelines, G = this.groups;
    steps = Math.min(steps, this.cap);
    const its = set.iterations;
    for (let s = 0; s < Math.max(steps, 1); s++) {
      const f = fieldAt(s);
      for (let it = 0; it < its; it++) this.writeSlot(s * MAX_IT + it, set, f, it, this.frame + s);
    }
    d.queue.writeBuffer(b.uniforms, 0, this.uniformData, 0, Math.max(steps, 1) * MAX_IT * SLOT);
    const enc = d.createCommandEncoder({ label: 'lab frame' });
    enc.clearBuffer(b.tally);
    const pass = enc.beginComputePass({ label: 'lab PB-MPM' });
    const n64 = Math.ceil(this.count / 64);
    const go = (pipe, group, slot, size) => {
      pass.setPipeline(pipe); pass.setBindGroup(0, group, [slot * SLOT]);
      if (Array.isArray(size)) pass.dispatchWorkgroups(...size); else if (typeof size === 'number') pass.dispatchWorkgroups(size);
      else pass.dispatchWorkgroupsIndirect(size, 0);
    };
    const solid = set.material.model !== 0 ? P.g2p2gSolid : P.g2p2g;
    if (steps && this.lastHz && this.lastHz !== set.hz && this.count) go(P.rescale, G.rescale, 0, n64);
    if (this.count) for (let s = 0; s < steps; s++) {
      const base = s * MAX_IT;
      go(P.prepare, G.prepare, base, Math.ceil(this.bucketCount / 64));
      go(P.bukkitCount, G.count, base, n64);
      go(P.bukkitAllocate, G.allocate, base, [Math.ceil(this.bucketX / 8), Math.ceil(this.bucketY / 8)]);
      go(P.bukkitInsert, G.insert, base, n64);
      for (let it = 0; it < its; it++) {
        const next = 1 - this.gridIndex;
        go(P.gridClear, G.clear[next], base + it, b.gridArgs);
        if (it) go(P.gridUpdate, G.update[this.gridIndex], base + it, b.gridArgs);
        go(solid, G.solve[this.gridIndex], base + it, b.bucketArgs);
        this.gridIndex = next;
      }
    }
    if (this.count) go(P.tally, G.tally, Math.max(steps - 1, 0) * MAX_IT, n64);
    pass.end();
    if (steps) { this.frame += steps; this.lastHz = set.hz; }
    const slot = this.readbacks.find(r => !r.pending);
    if (slot) {
      enc.copyBufferToBuffer(b.counters, 0, slot.buffer, 0, 16);
      enc.copyBufferToBuffer(b.tally, 0, slot.buffer, 16, TALLY_WORDS * 4);
    }
    if (after) after(enc);
    d.queue.submit([enc.finish()]);
    if (!slot) return null;
    slot.pending = true;
    return slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      const u = new Uint32Array(slot.buffer.getMappedRange().slice(0));
      slot.buffer.unmap(); slot.pending = false;
      return { clamped: u[0], maxMove: u[1] / 1000, points: u[4], above: u[5], below: u[6], outside: u[7], nan: u[8],
        maxSpeed: u[9] / 4, meanSpeed: u[4] ? u[10] / 4 / u[4] : 0, moving: u[11] };
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

  destroyBuffers() {
    for (const b of Object.values(this.buffers)) b.destroy?.();
    for (const r of this.readbacks) r.buffer.destroy?.();
    this.buffers = {}; this.readbacks = [];
  }
}
