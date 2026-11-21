/*
 * Hourglass sand engine: the grains, drawn on the GPU.
 *
 * Every material point is drawn as one grain (shaders/grains.wgsl): a lit disc
 * from a 256-entry palette, or, while it flies, the streak it makes in the
 * exposure. The page that owns the canvas says, each frame, where the grid lies
 * on it and how the grains are drawn (encode's look); nothing here reads a
 * page's state.
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
   */
  encode(enc, count, look) {
    const v = this.viewData;
    v[0] = look.m[0]; v[1] = look.m[1]; v[2] = look.m[2]; v[3] = look.m[3];
    v[4] = look.o[0]; v[5] = look.o[1];
    v[6] = look.r[0]; v[7] = look.r[1];
    v[8] = look.liquid ? 1 : 0; v[9] = look.liquid ? 0.75 : 1; v[10] = look.exposure ?? 0;
    v[11] = look.flight ?? 0;
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
