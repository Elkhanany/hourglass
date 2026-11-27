/*
 * Hourglass sand engine: the grains, drawn on the GPU.
 *
 * Every material point is drawn as one grain (shaders/grains.wgsl): a lit disc
 * from a 256-entry palette by the grain's own colour seed (color.x), or, while
 * it flies, the streak it makes in the exposure. The page that owns the canvas
 * says, each frame, where the grid lies on it and how the grains are drawn
 * (encode's look); nothing here reads a page's state. The app's look adds the
 * neck warp (setWarp), the room's light turned back by the glass's angle on
 * screen, and the Reset's sweep with its thread (design 6.2, 6.5); left out, as
 * the lab leaves them, the grains are drawn as the lab has always drawn them.
 * The app's sunlit sand (encode's look.lit) lights each grain by one key light,
 * as the classic sand is lit (glass/renderer.js, the sunlit sand): its colours
 * are the classic sand's own table (setTones), the body of sand takes the
 * bore's normal (setWarp's half-widths), and the free surface its light from
 * the beds' relief, which two small compute passes (shaders/relief.wgsl) make
 * each frame of the solver's points, read only (per column the top of each bed,
 * then its slope, its soft shadow and its light).
 *
 * Part of the Hourglass project. License: GPL-3.0. The quad-per-particle idea
 * follows Smoosh's density.wgsl (MIT, see LICENSES.md).
 */

/* The motion blur's crowding rule (grains.wgsl): a grain whose crowding (the grid's volume
 * weighted around it, which g2p2g.wgsl writes into color.y every substep) is at or above FLIGHT
 * moves with a bed the eye follows, and is drawn sharp; below half of it, it is in flight and drawn
 * as its full streak; in between, the streak fades. */
export const FLIGHT = 0.6;

/** The share of its streak a grain of crowding crowd is drawn with (grains.wgsl's rule); all: every grain streaks. */
export function flightOf(crowd, all = false) {
  if (all) return 1;
  const t = Math.min(1, Math.max(0, (crowd - 0.5 * FLIGHT) / (0.5 * FLIGHT)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The streak a grain is drawn with, in cells per cell of its displacement in a substep: the
 * exposure (frames display frames of frameMs each) times the substeps a second (hz).
 */
export function exposure(frames, frameMs, hz) { return frames * frameMs / 1000 * hz; }

/* The view's uniform (grains.wgsl View): 14 vec4s, the last 7 the sunlit sand's (all 0: the grains as they always were). */
const VIEW_FLOATS = 56;
/* The sunlit sand's colour table: light levels x 256 seeds (glass/renderer.js LEVELS), and what a level is in light. */
export const TONE_LEVELS = 48;
const LEVEL_STEP = 0.031;

/**
 * The sunlit sand's colour table for setTones, from the classic sand's own (glass/renderer.js sunTables().lut: 48
 * levels x 256 seeds, bytes r, g, b, 255): the same colours, each seed's kind in the alpha byte (255 a plain
 * grain, 254 a glossy one, hiBoost over 3, 253 mica), which says how near the key's mirror direction its facet must face
 * to glint.
 */
export function tonesFromLUT(lut, isMica, hiBoost, into = null) {
  const out = into && into.length === TONE_LEVELS * 256 ? into : new Uint32Array(TONE_LEVELS * 256);
  for (let i = 0; i < out.length; i++) {
    const s = i & 255, kind = isMica && isMica[s] ? 253 : (hiBoost && hiBoost[s] > 3 ? 254 : 255);
    out[i] = ((lut[i] & 0x00ffffff) | (kind << 24)) >>> 0;
  }
  return out;
}

export class GrainRenderer {
  /**
   * opts.offscreen: draw into a texture and copy it to a 2-D canvas, for headless browsers whose
   * WebGPU canvas cannot present (the shaders are the same); otherwise the canvas is a WebGPU
   * canvas, configured premultiplied so that it composites over what lies behind it.
   */
  constructor(device, canvas, { offscreen = false } = {}) {
    this.device = device; this.canvas = canvas;
    this.offscreen = !!offscreen;
    if (this.offscreen) { this.format = 'rgba8unorm'; this.ctx2d = canvas.getContext('2d'); }
    else {
      this.context = canvas.getContext('webgpu');
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device, format: this.format, alphaMode: 'premultiplied' });
    }
    this.viewData = new Float32Array(VIEW_FLOATS);
    this.viewBuf = device.createBuffer({ size: VIEW_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.palBuf = device.createBuffer({ size: 256 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    // the neck warp per grid row (setWarp); none until it is given
    this.warpRows = 0; this.warpCx = 0; this.warpCy = 0;
    this.warpBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    // the sunlit sand: its colour table (setTones); the beds' tops per column, found afresh each frame, and their
    // relief made of them (two buffers: each frame reads the one the last frame wrote and writes the other), with
    // those passes' uniform; none of it is used until a frame is drawn with look.lit
    const U = GPUBufferUsage;
    this.tonesBuf = device.createBuffer({ size: TONE_LEVELS * 256 * 4, usage: U.STORAGE | U.COPY_DST });
    this.hasTones = false; this.hasHalf = false;
    this.columns = 0; this.reliefAt = 0; this.wasLit = false;
    this.topsBuf = device.createBuffer({ size: 16, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.reliefBufs = [0, 1].map(() => device.createBuffer({ size: 32, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }));
    this.reliefData = new Float32Array(16);
    this.reliefUni = device.createBuffer({ size: 64, usage: U.UNIFORM | U.COPY_DST });
    this.topsGroup = null; this.reliefGroups = null;
    this.n = { relief: 0 };              // relief passes encoded (the tests count them)
  }
  async init(shaders) {
    const [module, relief] = await Promise.all([shaders.module(this.device, 'grains'), shaders.module(this.device, 'relief')]);
    const blend = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    [this.pipeline, this.topsPipe, this.reliefPipe] = await Promise.all([
      this.device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: this.format, blend: { color: blend, alpha: blend } }] },
        primitive: { topology: 'triangle-strip' }
      }),
      this.device.createComputePipelineAsync({ layout: 'auto', compute: { module: relief, entryPoint: 'csTops' } }),
      this.device.createComputePipelineAsync({ layout: 'auto', compute: { module: relief, entryPoint: 'csMain' } })]);
  }
  /** The solver's particle buffer (after each configure). */
  bind(particles) {
    this.particles = particles;
    const d = this.device, buf = b => ({ buffer: b });
    this.wasLit = false;
    // (group i draws with relief buffer i; relief group i writes buffer i from the other)
    this.groups = this.reliefBufs.map(rb => d.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [this.viewBuf, particles, this.palBuf, this.warpBuf, rb, this.tonesBuf].map((b, binding) => ({ binding, resource: buf(b) }))
    }));
    this.group = this.groups[this.reliefAt];
    this.topsGroup = d.createBindGroup({ layout: this.topsPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: buf(this.reliefUni) }, { binding: 1, resource: buf(particles) }, { binding: 2, resource: buf(this.topsBuf) }] });
    this.reliefGroups = this.reliefBufs.map((rb, i) => d.createBindGroup({
      layout: this.reliefPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: buf(this.reliefUni) }, { binding: 2, resource: buf(this.topsBuf) },
        { binding: 3, resource: buf(this.reliefBufs[1 - i]) }, { binding: 4, resource: buf(rb) }]
    }));
  }
  /**
   * The neck warp (design 6.2): warp[j], per grid row j (its centre), the drawn glass's
   * half-width over the simulated one (glass.mjs buildGlass's warp); each point is drawn at
   * x = cx + (x - cx) warp(y). (cx, cy): the neck's centre, grid. Binds again if bound.
   * For the sunlit sand: half, per grid row, the drawn glass's half-width itself, cells (glass.mjs halfDrawn):
   * the bore the body of sand lies against; columns, the grid's width (the beds' relief is per column). Without
   * them the grains are never drawn sunlit.
   */
  setWarp(warp, cx, cy, half = null, columns = 0) {
    const n = warp ? warp.length : 0, lit = n > 0 && !!half && half.length === n && columns > 0;
    const U = GPUBufferUsage, W = lit ? columns | 0 : 0;
    if (W !== this.columns) {
      this.topsBuf.destroy?.();
      for (const b of this.reliefBufs) b.destroy?.();
      this.topsBuf = this.device.createBuffer({ size: Math.max(16, Math.ceil(2 * W * 4 / 16) * 16), usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
      this.reliefBufs = [0, 1].map(() => this.device.createBuffer({ size: Math.max(32, 2 * W * 16), usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }));
      this.columns = W;
    }
    if (n > 0) {
      const data = new Float32Array(lit ? 2 * n : n);
      data.set(warp);
      if (lit) data.set(half, n);
      this.warpBuf.destroy?.();
      this.warpBuf = this.device.createBuffer({ size: Math.max(16, Math.ceil(data.length * 4 / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(this.warpBuf, 0, data);
    }
    this.hasHalf = lit;
    this.warpRows = n; this.warpCx = +cx || 0; this.warpCy = +cy || 0;
    if (this.particles) this.bind(this.particles);
  }
  /** The sunlit sand's colour table (tonesFromLUT): a Uint32Array of TONE_LEVELS x 256. */
  setTones(t) { this.device.queue.writeBuffer(this.tonesBuf, 0, t, 0, TONE_LEVELS * 256); this.hasTones = true; }
  /** Whether a frame given look.lit is drawn sunlit: the colours, the bore and the grid's width are all here. */
  get canLight() { return this.hasTones && this.hasHalf && this.columns > 0 && !!this.reliefGroups; }
  /** 256 x [r, g, b, a] (a 2: a mica grain that glints), as palette.mjs makes them. */
  setPalette(p) { this.device.queue.writeBuffer(this.palBuf, 0, p); }
  /**
   * Draw count grains into enc. look, for this frame:
   *   m [xx, xy, yx, yy], o [x, y]: the grid (cells, y up) to clip space,
   *     clip.x = xx gx + xy gy + o.x, clip.y = yx gx + yy gy + o.y;
   *   r [x, y]: a grain's radius in clip units (grains differ a little about it);
   *   liquid: soft drops that run together (0.75 opaque) instead of lit grains;
   *   exposure: the streak, cells, per cell of a substep's displacement (exposure(); 0: no blur);
   *   flight: the crowding at and above which a grain is drawn sharp (FLIGHT; 0: every grain streaks).
   * The app's, each optional:
   *   light: the glass's angle on screen, rad (CSS, clockwise): the room's light is turned back by it;
   *   sweep: the Reset's sweep (grid units; design 6.5), null when none:
   *     { kind: 1, S, min }: every grain drawn with its squared distance from the neck less S,
   *       those left with min or less not drawn;
   *     { kind: 2, apex, slope, thread: { lo, hi, spread, share, n, frame } }: the grains of the
   *       upper bulb shown up to the surface y = apex - slope |x - cx|, and the thread's n grains,
   *       between heights lo and hi, within spread cells of the axis, share of them drawn.
   *   lit: the sunlit sand, null (or left out) for the grains as they always were:
   *     { key [x, y, z], half [x, y, z]: the key light's direction and the direction half way between it and
   *       the eye, unit vectors in the grid's axes (x right, y up, z toward the eye);
   *       A, K, X, wrap, C, kw, kd, wd: the look's constants (sand/sands.js SUNLIT, with the sand's own in them);
   *       cells: grid cells per app cell; share: the share of grains that can glint; mica: how near the mirror
   *       direction a mica facet must face; glint [r, g, b] (0 to 1); still: the displacement in a substep
   *       above which a grain moves (cells); slow: the displacement in a substep up to which a crowded point
   *       lies in a bed (cells); frame: counts the frames drawn; fresh: the beds are new (a fill, a turn), so
   *       the relief keeps nothing from before }.
   *     Drawn sunlit only when canLight; the relief's two passes are encoded first.
   */
  encode(enc, count, look) {
    const v = this.viewData;
    v.fill(0);
    v[0] = look.m[0]; v[1] = look.m[1]; v[2] = look.m[2]; v[3] = look.m[3];
    v[4] = look.o[0]; v[5] = look.o[1];
    v[6] = look.r[0]; v[7] = look.r[1];
    v[8] = look.liquid ? 1 : 0; v[9] = look.liquid ? 0.75 : 1; v[10] = look.exposure ?? 0;
    v[11] = look.flight ?? 0;
    v[12] = this.warpCx; v[13] = this.warpCy; v[14] = this.warpRows; v[15] = count;
    const th = look.light || 0;
    v[16] = Math.cos(th); v[17] = Math.sin(th);
    v[53] = look.paper > 0 ? Math.min(1, look.paper) : 0;     // (the light look's share: a grain in the air gets a dark side)
    const sw = look.sweep;
    let extra = 0;
    if (sw && sw.kind === 1) { v[20] = 1; v[21] = sw.S; v[22] = sw.min ?? 0; }
    else if (sw && sw.kind === 2) {
      const t = sw.thread || {};
      v[20] = 2; v[21] = sw.apex; v[22] = sw.slope; v[23] = t.share ?? 0;
      v[24] = t.lo ?? 0; v[25] = t.hi ?? 0; v[26] = t.spread ?? 0; v[27] = t.frame ?? 0;
      extra = count > 0 && (t.share ?? 0) > 0 && t.hi > t.lo ? (t.n | 0) : 0;
    }
    const lit = look.lit && this.canLight ? look.lit : null;
    if (lit) {
      const L = lit.key, H = lit.half, l2 = Math.hypot(L[0], L[1]) || 1, g = lit.glint;
      v[28] = L[0]; v[29] = L[1]; v[30] = L[2]; v[31] = 1;
      v[32] = H[0]; v[33] = H[1]; v[34] = H[2]; v[35] = lit.X / LEVEL_STEP;
      v[36] = lit.A; v[37] = lit.K; v[38] = lit.wrap; v[39] = lit.C;
      v[40] = lit.kw; v[41] = lit.kd; v[42] = 1 / lit.wd; v[43] = lit.cells;
      v[44] = lit.share * 6 / Math.PI; v[45] = lit.mica; v[46] = L[0] / l2; v[47] = L[1] / l2;
      v[48] = g[0]; v[49] = g[1]; v[50] = g[2]; v[51] = lit.frame || 0;
      v[52] = lit.still; v[54] = lit.deep || 0;
      // the beds' relief for this frame: the tops found afresh, then read with the buffer the last frame wrote
      // and written to the other
      const r = this.reliefData, W = this.columns;
      r[0] = L[0]; r[1] = L[1]; r[2] = L[2]; r[3] = W;
      r[4] = H[0]; r[5] = H[1]; r[6] = H[2]; r[7] = lit.fresh || !this.wasLit ? 1 : 0;
      r[8] = lit.A; r[9] = lit.K; r[10] = lit.wrap; r[11] = this.warpCy;
      r[12] = count; r[13] = look.flight || FLIGHT; r[14] = lit.slow; r[15] = 0;
      this.device.queue.writeBuffer(this.reliefUni, 0, r);
      this.reliefAt ^= 1;
      enc.clearBuffer(this.topsBuf);
      const cp = enc.beginComputePass({ label: 'relief' });
      if (count) { cp.setPipeline(this.topsPipe); cp.setBindGroup(0, this.topsGroup); cp.dispatchWorkgroups(Math.ceil(count / 64)); }
      cp.setPipeline(this.reliefPipe); cp.setBindGroup(0, this.reliefGroups[this.reliefAt]);
      cp.dispatchWorkgroups(Math.ceil(2 * W / 64));
      cp.end();
      this.group = this.groups[this.reliefAt];
      this.n.relief++;
    }
    this.wasLit = !!lit;
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
    if (count) { pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.group); pass.draw(4, count + extra); }
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
