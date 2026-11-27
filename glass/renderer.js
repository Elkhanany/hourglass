/*!
 * Hourglass — glass/renderer.js
 * The picture: the glass, the classic sand, the frame.
 *
 * 2. HourglassPhysics.Renderer  Per-grain pixel renderer (ImageData / Uint32)
 *                               and the blown-glass vessel, caps and lighting,
 *                               with its cracks, gold mends and their glints.
 *
 * One piece of HourglassPhysics, loaded in this order: glass/shapes.js, sand/sim.js, sand/sands.js, glass/gl.js,
 * glass/renderer.js, glass/cracks.js, glass/spill.js. Each reads what it needs from the namespace once,
 * at load (cut from physics.js by tools/split-physics.js).
 * Zero dependencies. License: GPL-3.0-or-later.
 */
(function (root) {
  'use strict';
  var P = root.HourglassPhysics || (root.HourglassPhysics = {});
  var _ = P._ || (P._ = {});        // names the pieces share that are not the app's
  if (_.loaded !== 'glass/gl.js') return;   // a piece before this one is missing: define nothing (app.js says it is updating)
  var hash01 = _.hash01, makeGlass = _.makeGlass, hsl = _.hsl, rgba = _.rgba, mix = _.mix,
      WALL = P.WALL, REST = P.REST, MOVE = P.MOVE, THEMES = P.THEMES, SANDS = P.SANDS,
      customSand = P.customSand, profile = P.profile, KEY_LIGHT = P.KEY_LIGHT, SUNLIT = P.SUNLIT;

  /* ======================================================================
   *  Renderer
   * ==================================================================== */

  var LEVELS = 48;      // light levels per grain colour (upper third = highlights)
  var PAPER_INK = [46, 52, 60];   // the drawn glass's lines in the light look (setPaper)
  /** a, b, or m of the way from a to b (exactly a at 0 and b at 1: a look at rest is drawn as it always was) */
  function byMix(a, b, m) { return m <= 0 ? a : (m >= 1 ? b : a + (b - a) * m); }
  var AO_BIAS = 12;
  var SUB = 2;          // each grain is drawn as a lit 2×2 bead

  /**
   * @param sim   Sim
   * @param els   { back, sand, bloom, front, light } canvases
   *              back / sand / bloom / front rotate with the vessel,
   *              light (speculars, caustics) stays fixed in the room.
   */
  function Renderer(sim, els) {
    this.sim = sim;
    this.els = els;
    var W = sim.W, H = sim.H;
    this.BW = W * SUB; this.BH = H * SUB;
    els.sand.width = this.BW; els.sand.height = this.BH;
    this.sctx = els.sand.getContext('2d');
    this.img = this.sctx.createImageData(this.BW, this.BH);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.depth = new Uint8Array(W);
    this.lut = new Uint32Array(LEVELS * 256);
    this.isMica = new Uint8Array(256);
    // Each grain is a tiny faceted bead: which corner catches the light is
    // part of its persistent seed, so packed sand never looks like a grid.
    this.hiOff = new Uint16Array(256);
    this.loOff = new Uint16Array(256);
    for (var sd = 0; sd < 256; sd++) {
      var o = (hash01(sd * 3 + 17) * 4) | 0;           // 0,1 → top-left, 2 → top-right, 3 → bottom-left
      var hiP = o < 2 ? 0 : (o === 2 ? 1 : this.BW);
      this.hiOff[sd] = hiP;
      this.loOff[sd] = this.BW + 1 - hiP;
    }
    this.glintColor = 0xFFFFFFFF;
    this.baseLevel = new Uint8Array(W * H);
    this.aoTab = new Uint8Array(256);
    this.hiBoost = new Uint8Array(256);     // per-seed sparkle of the lit facet
    this.emit = new Float32Array(256);      // per-seed contribution to the bloom
    // Bloom: light scattered around the brightest grains, accumulated at
    // half resolution, blurred, and composited additively over the sand.
    this.bw = (W + 1) >> 1; this.bh = (H + 1) >> 1;
    this.bloomA = new Float32Array(this.bw * this.bh);
    this.bloomB = new Float32Array(this.bw * this.bh);
    this.bctx = null;
    if (els.bloom) {
      els.bloom.width = this.bw; els.bloom.height = this.bh;
      this.bctx = els.bloom.getContext('2d');
      this.bimg = this.bctx.createImageData(this.bw, this.bh);
      this.bbuf = new Uint32Array(this.bimg.data.buffer);
    }
    this.frame = true;    // caps + posts around the glass
    this.paper = false;   // the light look: the glass shaded for a white room (setPaper)
    this.mix = 0;         // how much of the light look is drawn: 0 or 1 at rest, between while the look fades (_paperMix)
    this.layers = false;  // layered sand: two tones (setLayers)
    this.sunlit = false;  // the sand lit by one key light (setSandLight); off, it is drawn as it always was
    this._sun = null;     // the sunlit sand's tables, made when it is first drawn (_drawSunlit)
    this._sunRev = 0;     // counts the colour table's rebuilds: the sunlit tables follow it
    this.lightRot = 0;    // the glass against the room, as drawGlass was last told (the key light stays in the room)
    this.glass = null;    // [far wall, near wall] WebGL layers, or null → drawn glass
    this.glassRot = 0;
    this._initGlass();
    this.frameNo = 0;
    this.sweep = 0;       // one glass of sand giving way to the next: 1 the old goes, 2 the new comes (setSweep)
    this.sweepP = 0;
    this._swNew = false; this._swSrc = null; this._swFar = 0; this._sw = null;
    this.theme = THEMES.sahara;
    this.look = { sand: 'sahara', material: 'sahara' };   // what the theme was put together from (setLook)
    this.scale = 1;       // CSS px per cell
    this.dpr = 1;
    this._buildLightMap();
    this._buildMasks();
    this._buildLUT();
  }

  /**
   * Where the glass really is, finer than the lattice can say. A cell is
   * inside when its centre is, so a grain against the wall would poke its
   * square corner past the smooth inner surface the glass is drawn with.
   *   edgeMask   which of each cell's four drawn sub-pixels lie inside the
   *              curve (bit 0 top-left, 1 top-right, 2 bottom-left,
   *              3 bottom-right); 0 for glass, 15 for the open interior
   *   bloomMask  the share of each half-resolution glow pixel that lies
   *              inside, drawn in a little so light never spills onto the glass
   */
  Renderer.prototype._buildMasks = function () {
    var sim = this.sim, g = sim.geo, W = sim.W, H = sim.H, cell = sim.cell;
    var em = this.edgeMask = new Uint8Array(W * H);
    var x, y, i, rt, rb, dl, dr, m;
    for (y = 0; y < H; y++) {
      rt = profile(Math.abs(y + 0.25 - g.cy) / g.HB, g);
      rb = profile(Math.abs(y + 0.75 - g.cy) / g.HB, g);
      for (x = 0; x < W; x++) {
        i = y * W + x;
        if (cell[i] === WALL) continue;
        dl = Math.abs(x + 0.25 - g.cx); dr = Math.abs(x + 0.75 - g.cx);
        m = 0;
        if (dl < rt) m |= 1;
        if (dr < rt) m |= 2;
        if (dl < rb) m |= 4;
        if (dr < rb) m |= 8;
        em[i] = m;
      }
    }
    var bw = this.bw, bh = this.bh, bm = this.bloomMask = new Float32Array(bw * bh);
    var ry = new Float32Array(4), by, bx, sy, sx, n;
    for (by = 0; by < bh; by++) {
      for (sy = 0; sy < 4; sy++) ry[sy] = profile(Math.abs(by * 2 + sy * 0.5 + 0.25 - g.cy) / g.HB, g) - 2;
      for (bx = 0; bx < bw; bx++) {
        n = 0;
        for (sy = 0; sy < 4; sy++) {
          for (sx = 0; sx < 4; sx++) if (Math.abs(bx * 2 + sx * 0.5 + 0.25 - g.cx) < ry[sy]) n++;
        }
        bm[by * bw + bx] = n / 16;
      }
    }
  };

  /** Set up the rendered glass; fall back to the drawn one if WebGL is missing. */
  Renderer.prototype._initGlass = function () {
    var els = this.els, self = this;
    this.glass = null;
    if (els.glBack && els.glFront) {
      var geo = this.sim.geo, a = makeGlass(els.glBack, 0, geo), b = a && makeGlass(els.glFront, 1, geo);
      if (a && b) {
        this.glass = [a, b];
        this.glass.forEach(function (g) {
          g.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); g.lost = true; });
          g.canvas.addEventListener('webglcontextrestored', function () {
            try { g.build(); g.lost = false; self.drawGlass(self.glassRot, true); }
            catch (err) { self._dropGlass(); }     // it came back and cannot: the drawn glass from here on
          });
        });
      }
    }
    if (els.glBack) els.glBack.style.display = this.glass ? '' : 'none';
    if (els.glFront) els.glFront.style.display = this.glass ? '' : 'none';
  };

  /** Give up the rendered glass for the drawn one, of the same shape. */
  Renderer.prototype._dropGlass = function () {
    var els = this.els;
    this.glass = null;
    els.glBack.style.display = 'none'; els.glFront.style.display = 'none';
    this.drawStatic();
  };

  /**
   * Render the glass. `rot` is how far the vessel is turned against the room
   * (rad, clockwise): the lights stay where they are, the reflections move.
   */
  Renderer.prototype.drawGlass = function (rot, force) {
    var gs = this.glass;
    this.lightRot = rot;                                            // (the sunlit sand's key turns back by it, glass or none)
    if (!gs || !this.cssW) return;
    if (!force && Math.abs(rot - this.glassRot) < 0.01) return;    // under 0.6°: not worth a redraw
    this.glassRot = rot;
    var g = this.sim.geo, th = this.theme, box = this._box(), m = this.mix;
    var tint = th.glass.tint, dens = 0.0035 + th.glass.smoke * 0.02;
    function draw(o, gl, prog, u, paper) {
      gl.useProgram(prog);
      gl.uniform2f(u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(u.uBox, box.w, box.h);
      gl.uniform4f(u.uGeo, g.R, g.HB, g.RN, g.equator);
      gl.uniform1f(u.uWall, g.wall);
      gl.uniform1f(u.uRot, rot);
      gl.uniform1f(u.uPass, o.pass);
      gl.uniform3f(u.uAbs, dens * (0.6 + 2.4 * (1 - tint[0] / 255)),
                           dens * (0.6 + 2.4 * (1 - tint[1] / 255)),
                           dens * (0.6 + 2.4 * (1 - tint[2] / 255)));
      gl.uniform3f(u.uGlow, th.glow[0] / 255, th.glow[1] / 255, th.glow[2] / 255);
      gl.uniform1f(u.uPx, box.w / gl.drawingBufferWidth);
      gl.uniform1f(u.uGain, paper ? 1.15 : 1.1);          // (the white room mirrored at about the page's own white)
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    for (var i = 0; i < gs.length; i++) {
      var o = gs[i], gl = o.gl, a = null, b = null;
      if (o.lost || !o.prog) continue;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // between the looks (_paperMix): the dark room's picture and the white room's, each by its own
      // program, added in at its share, (1 - m) of the one and m of the other: a cross-fade
      if (m > 0 && m < 1) { try { a = o.look(false); b = o.look(true); } catch (e) { a = null; } }
      if (a) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE);
        gl.blendColor(0, 0, 0, 1 - m); draw(o, gl, a.prog, a.u, false);
        gl.blendColor(0, 0, 0, m); draw(o, gl, b.prog, b.u, true);
        gl.disable(gl.BLEND);
      } else draw(o, gl, o.prog, o.u, this.paper);
    }
  };

  /** Assembly box in cells: the framed instrument, or the bare glass. */
  Renderer.prototype._box = function () {
    var g = this.sim.geo;
    if (this.frame) return { w: g.AW, h: g.AH };
    return { w: Math.max(this.sim.W, 2 * g.R + 16 * g.q), h: Math.max(this.sim.H, 2 * g.HB + 12 * g.q) };
  };
  Renderer.prototype.setFrame = function (on) {
    this.frame = !!on;
  };
  /**
   * The light look (paper) or the dark (the app as it has always been). On white a glass is not
   * seen by the light it catches but by the dark it gathers: the rendered glass is lit by a white
   * room with dark cards (glass/gl.js, its paper room), the drawn glass is outlined in a deep
   * line where it is lit with white on the dark, and the cracks are drawn dark. The sand keeps its
   * colours. Nothing of the glass's shape or sand is made again: only what is drawn.
   */
  Renderer.prototype.setPaper = function (on) {
    on = !!on;
    if (on === this.paper) return;
    this.paper = on;
    this.mix = on ? 1 : 0;
    var gs = this.glass;
    if (gs) {
      try { for (var i = 0; i < gs.length; i++) if (!gs[i].lost) gs[i].use(on); }
      catch (e) { this._dropGlass(); return; }        // (a look the device will not compile: the drawn glass, which has both)
    }
    this.drawStatic();
  };
  /**
   * The glass drawn part of the way from the dark look to the light: m = 0 the dark, 1 the light
   * (setPaper's look), between them a cross-fade while the app fades the page from one look to the
   * other. The rendered glass draws both rooms' pictures, each at its share (drawGlass); the drawn
   * glass and the cracks take their colours that share of the way. Only the layers a look changes
   * are drawn again: nothing is built.
   */
  Renderer.prototype._paperMix = function (m) {
    m = m <= 0 ? 0 : (m >= 1 ? 1 : m);
    if (m === this.mix) return;
    this.mix = m;
    if (!this.cssW) return;
    if (!this.glass) this._drawBack();
    this._drawFront();
    this.drawGlass(this.glassRot, true);
  };
  /** Both looks' programs made ahead (at a quiet moment), so that the first change of look compiles nothing. */
  Renderer.prototype._prepareLooks = function () {
    var gs = this.glass;
    if (!gs) return;
    try { for (var i = 0; i < gs.length; i++) if (!gs[i].lost) { gs[i].look(false); gs[i].look(true); } }
    catch (e) { /* (a look the device will not compile: setPaper falls back to the drawn glass when asked for it) */ }
  };

  /** Cylinder shading baked per cell + ambient-occlusion ramp by depth. */
  Renderer.prototype._buildLightMap = function () {
    var sim = this.sim, g = sim.geo, W = sim.W, H = sim.H, x, y;
    for (y = 0; y < H; y++) {
      var u = Math.abs(y + 0.5 - g.cy) / g.HB;
      var r = profile(u, g);
      for (x = 0; x < W; x++) {
        var t = r > 0.5 ? Math.abs(x + 0.5 - g.cx) / r : 0;
        if (t > 1) t = 1;
        // bright core, falling off toward the glass like a lit cylinder
        var lv = 22.5 - 8.5 * t * t * t - 1.5 * t;
        this.baseLevel[y * W + x] = Math.max(12, Math.min(24, Math.round(lv)));
      }
    }
  };

  /**
   * Per-grain colour table: 256 persistent seeds × 48 light levels. With
   * layered sand, bit 7 of a seed is the grain's tone (the theme's sand, or
   * its companion sand2) and the other seven spread over that tone's kinds
   * of grain.
   */
  Renderer.prototype._buildLUT = function () {
    var th = this.theme, sd = th.sand, lut = this.lut, li = th.light;
    var tint = li.tint, em = li.emit, lay = this.layers && th.sand2;
    for (var s = 0; s < 256; s++) {
      var c = s;
      if (lay) { sd = s < 128 ? th.sand : th.sand2; c = (s & 127) << 1; }
      var darkN = Math.round(sd.dark.p * 256);
      var micaN = Math.round(sd.mica.p * 256);
      var altN = Math.round(sd.alt.p * 256);
      var u1 = hash01(s * 7 + 1), u2 = hash01(s * 13 + 5), u3 = hash01(s * 29 + 11);
      var base, mica = 0;
      if (c < darkN) {
        base = hsl(sd.dark.h + (u1 - 0.5) * 10, sd.dark.s, sd.dark.l + (u2 - 0.5) * 0.08);
      } else if (c >= 256 - micaN) {
        base = hsl(sd.mica.h + (u1 - 0.5) * 14, sd.mica.s, sd.mica.l - u2 * 0.08);
        mica = 1;
      } else if (c >= 256 - micaN - altN) {
        base = hsl(sd.alt.h + (u1 - 0.5) * sd.dh * 2.4, sd.alt.s, sd.alt.l + (u2 - 0.5) * sd.dl);
      } else {
        base = hsl(sd.h + (u1 - 0.5) * 2 * sd.dh,
                   sd.s + (u3 - 0.5) * 0.16,
                   sd.l + (u2 - 0.5) * 2 * sd.dl);
      }
      this.isMica[s] = mica;
      var glossy = !mica && hash01(s * 41 + 7) < li.gloss;
      this.hiBoost[s] = 3 + (glossy ? li.glossBoost : 0);
      this.emit[s] = em.haze + (mica ? em.mica : (glossy ? em.gloss : 0));
      for (var lv = 0; lv < LEVELS; lv++) {
        var m = 0.34 + lv * 0.031;                     // 0.34 … 1.80
        var r = base[0] * m, g = base[1] * m, b = base[2] * m;
        if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
        if (m > 1) {                                   // highlights roll off toward the light's own colour
          var w = (m - 1) * li.hl;
          if (w > 0.94) w = 0.94;
          r += (tint[0] - r) * w; g += (tint[1] - g) * w; b += (tint[2] - b) * w;
        }
        lut[(lv << 8) | s] = (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
      }
    }
    // depth 1 = exposed surface grain (rim-lit), deeper = occluded
    for (var d = 0; d < 256; d++) {
      var ao;
      if (d <= 1) ao = -li.rim[0]; else if (d === 2) ao = -li.rim[1];
      else ao = Math.min(li.aoMax, Math.round((d - 2) * 0.55));
      this.aoTab[d] = ao + AO_BIAS;
    }
    var gl = th.glint, bc = li.bloomColor;
    this.glintColor = ((255 << 24) | (gl[2] << 16) | (gl[1] << 8) | gl[0]) >>> 0;
    this.bloomRGB = ((bc[2] << 16) | (bc[1] << 8) | bc[0]) >>> 0;
    this._sunRev++;                                    // (the sunlit sand's colour table is made from this one)
  };

  Renderer.prototype.setTheme = function (id) {
    this.theme = THEMES[id] || THEMES.sahara;
    this.look = { sand: this.theme.id, material: this.theme.id };
    this._buildLUT();
    this.drawStatic();
  };

  /**
   * A sand and a frame, chosen apart: look = { sand, material }.
   *   sand      an id in SANDS, or a colour { h, s, l } (customSand)
   *   material  whose caps the frame wears: an id in THEMES
   * What is left out stays as it was. The theme is put together anew from
   * the two, always as a new object: the spilled sand reads its colours
   * again when the theme is another object. `this.look` keeps what was
   * asked. With `live` only the colour table is rebuilt (a colour being
   * dragged, many times a second); the glass and the frame are drawn again
   * by the call without it.
   */
  Renderer.prototype.setLook = function (look, live) {
    var was = this.look, sand = look && look.sand !== undefined ? look.sand : was.sand, rec;
    var material = look && Object.prototype.hasOwnProperty.call(THEMES, look.material) ? look.material : was.material;
    if (sand && typeof sand === 'object') {
      sand = { h: +sand.h, s: +sand.s, l: +sand.l };
      rec = customSand(sand.h, sand.s, sand.l);
    } else {
      rec = Object.prototype.hasOwnProperty.call(SANDS, sand) ? SANDS[sand] : SANDS.sahara;
      sand = rec.id;
    }
    this.look = { sand: sand, material: material };
    this.theme = {
      id: rec.id, name: rec.name, short: rec.name,
      sand: rec.sand, sand2: rec.sand2, glint: rec.glint, light: rec.light,
      glass: rec.glass, cap: THEMES[material].cap, glow: rec.glow
    };
    this._buildLUT();
    if (!live) this.drawStatic();
  };

  /** Layered sand: draw the two tones (Sim.setLayers lays them). */
  Renderer.prototype.setLayers = function (on) {
    this.layers = !!on;
    this._buildLUT();
  };

  /**
   * Fit the assembly into a box (CSS px) and size every canvas.
   * Returns { width, height, scale } in CSS px.
   */
  Renderer.prototype.layout = function (boxW, boxH, dpr) {
    var els = this.els, box = this._box();
    var s = Math.min(boxW / box.w, boxH / box.h);
    if (!(s > 0)) s = 1;
    var cssW = Math.round(box.w * s), cssH = Math.round(box.h * s);
    dpr = Math.max(1, Math.min(dpr || 1, 3));
    // keep the static layers within a sane memory budget
    while (cssW * dpr * cssH * dpr > 4.2e6 && dpr > 1) dpr -= 0.25;
    this.scale = s; this.dpr = dpr;
    var names = ['back', 'front', 'light'];
    for (var i = 0; i < names.length; i++) {
      var c = els[names[i]];
      c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
      c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    }
    if (this.glass) {
      // the shading is smooth, so the glass can render a little below device
      // resolution on very dense screens
      var gk = Math.min(dpr, Math.sqrt(2.4e6 / (cssW * cssH)));
      for (i = 0; i < this.glass.length; i++) {
        c = this.glass[i].canvas;
        c.width = Math.max(2, Math.round(cssW * gk)); c.height = Math.max(2, Math.round(cssH * gk));
        c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
      }
    }
    // sand: one buffer pixel per half cell; glow: one per 2×2 cells, which can
    // run a cell past the lattice when its size is odd, so size it by its own grid
    var grid = [[els.sand, this.sim.W, this.sim.H], [els.bloom, this.bw * 2, this.bh * 2]];
    for (i = 0; i < grid.length; i++) {
      c = grid[i][0];
      if (!c) continue;
      c.style.width = (grid[i][1] * s) + 'px';
      c.style.height = (grid[i][2] * s) + 'px';
      c.style.left = ((box.w - this.sim.W) / 2 * s) + 'px';
      c.style.top = ((box.h - this.sim.H) / 2 * s) + 'px';
    }
    this.cssW = cssW; this.cssH = cssH;
    this.drawStatic();
    return { width: cssW, height: cssH, scale: s };
  };

  /* ---------------------------------------------------------------- *
   *  Sand: one lit bead per simulated grain
   * ---------------------------------------------------------------- */
  Renderer.prototype.drawSand = function () {
    if (this.sunlit) { this._drawSunlit(); return; }
    var sim = this.sim, W = sim.W, H = sim.H, BW = this.BW;
    var cell = sim.cell, seed = sim.seed, buf = this.buf, lut = this.lut;
    var base = this.baseLevel, ao = this.aoTab, depth = this.depth;
    var isMica = this.isMica, glint = this.glintColor;
    var hiOff = this.hiOff, loOff = this.loOff, hiBoost = this.hiBoost, edge = this.edgeMask;
    var rowMin = sim.rowMin, rowMax = sim.rowMax, gateY = sim.gateY;
    var fr = ++this.frameNo, em;
    var up = sim.gy < 0;                 // vessel currently upside-down?
    var y, x, i, c, s, d, lv, bi, x0, x1, hi, lo, mid, h, hl;
    // bloom is soft and slow: refresh it every third frame
    var glow = this.bctx && fr % 3 === 0 ? this.bloomA : null;
    var emit = this.emit, bw = this.bw, rimE = this.theme.light.emit.rim, gi;

    buf.fill(0);
    depth.fill(0);
    if (glow) glow.fill(0);

    var yS = up ? H - 1 : 0, yE = up ? -1 : H, yD = up ? -1 : 1;
    for (y = yS; y !== yE; y += yD) {
      if (y === gateY) { depth.fill(0); continue; }
      x0 = rowMin[y]; x1 = rowMax[y];
      if (x0 > x1) continue;
      i = y * W + x0;
      bi = (y * SUB) * BW + x0 * SUB;
      for (x = x0; x <= x1; x++, i++, bi += SUB) {
        c = cell[i];
        if (c < REST) { depth[x] = 0; continue; }
        d = depth[x]; if (d < 255) depth[x] = ++d;
        s = seed[i];
        lv = base[i] - ao[d] + AO_BIAS;
        if (c === MOVE) lv++;
        if (glow) {
          gi = (y >> 1) * bw + (x >> 1);
          glow[gi] += d === 1 ? emit[s] + rimE : emit[s];
        }
        if (isMica[s]) {
          // mica flashes when it tumbles and twinkles slowly at the surface
          h = Math.imul(i ^ (c === MOVE ? fr : fr >> 4), 0x9E3779B1) >>> 0;
          if (c === MOVE ? (h >>> 30) === 0 : (d < 3 && (h >>> 27) === 0)) {
            buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = glint;
            if (glow) glow[gi] += 0.7;
            em = edge[i];
            if (em !== 15) {                 // against the glass: keep only what is inside
              if (!(em & 1)) buf[bi] = 0;
              if (!(em & 2)) buf[bi + 1] = 0;
              if (!(em & 4)) buf[bi + BW] = 0;
              if (!(em & 8)) buf[bi + BW + 1] = 0;
            }
            continue;
          }
        }
        hl = lv + hiBoost[s];
        if (hl > 47) hl = 47;
        hi = lut[(hl << 8) | s];
        mid = lut[(lv << 8) | s];
        lo = lut[((lv - 3) << 8) | s];
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = mid;
        if (up) { buf[bi + loOff[s]] = hi; buf[bi + hiOff[s]] = lo; }
        else { buf[bi + hiOff[s]] = hi; buf[bi + loOff[s]] = lo; }
        em = edge[i];
        if (em !== 15) {                     // against the glass: keep only what is inside
          if (!(em & 1)) buf[bi] = 0;
          if (!(em & 2)) buf[bi + 1] = 0;
          if (!(em & 4)) buf[bi + BW] = 0;
          if (!(em & 8)) buf[bi + BW + 1] = 0;
        }
      }
    }

    // Free-falling grains: sub-cell position plus a short velocity streak.
    var np = sim.np, px = sim.px, py = sim.py, pvx = sim.pvx, pvy = sim.pvy, ps = sim.pseed;
    var BH = this.BH, N = BW * BH;
    for (var p = 0; p < np; p++) {
      var fx = px[p] * SUB, fy = py[p] * SUB;
      var ix = fx | 0, iy = fy | 0;
      if (ix < 1 || iy < 1 || ix >= BW - 2 || iy >= BH - 2) continue;
      s = ps[p];
      var col;
      h = Math.imul((p * 31 + fr) ^ s, 0x9E3779B1) >>> 0;
      if (isMica[s] && (h >>> 30) < 2) col = glint;
      else col = lut[((24 + (h >>> 30)) << 8) | s];
      var vx = pvx[p], vy = pvy[p];
      var sp = Math.sqrt(vx * vx + vy * vy);
      var len = sp * SUB / 60 * 0.9;         // streak ≈ one frame of travel
      if (len > 20) len = 20;
      if (len >= 1.5) {
        var ux = -vx / sp, uy = -vy / sp, rgb = col & 0x00FFFFFF;
        for (var k = 1; k <= len; k++) {
          var qx = (fx + ux * (k + 0.5)) | 0, qy = (fy + uy * (k + 0.5)) | 0;
          if (qx < 0 || qy < 0 || qx >= BW - 1 || qy >= BH) continue;
          var qi = qy * BW + qx;
          if (buf[qi] !== 0) continue;
          // a grain that has just bounced trails back the way it came: never through the glass
          if (!((edge[(qy >> 1) * W + (qx >> 1)] >> (((qy & 1) << 1) | (qx & 1))) & 1)) continue;
          var a = (150 * (1 - k / (len + 1)) * (1 - k / (len + 1))) | 0;
          buf[qi] = ((a << 24) | rgb) >>> 0;
          if (k < 3 && ((edge[(qy >> 1) * W + ((qx + 1) >> 1)] >> (((qy & 1) << 1) | ((qx + 1) & 1))) & 1)) buf[qi + 1] = buf[qi];
        }
      }
      // the grain itself: a 2×2 bead at its sub-cell position, clipped the same way
      for (var dy2 = 0; dy2 < 2; dy2++) {
        for (var dx2 = 0; dx2 < 2; dx2++) {
          var gx2 = ix + dx2, gy2 = iy + dy2;
          if ((edge[(gy2 >> 1) * W + (gx2 >> 1)] >> (((gy2 & 1) << 1) | (gx2 & 1))) & 1) buf[gy2 * BW + gx2] = col;
        }
      }
      if (glow) glow[(py[p] >> 1) * bw + (px[p] >> 1)] += 0.3;
    }

    if (this.sweep === 1) this._sweepOut(); else if (this.sweep === 2) this._sweepIn();
    this.sctx.putImageData(this.img, 0, 0);
    if (glow) this._bloomOut();
  };

  /* ---------------------------------------------------------------- *
   *  The sunlit sand (Tune's Light: Sunlit)
   *
   *  One key light (KEY_LIGHT, sand/sands.js) from the upper left and in
   *  front, where the glass's own key softbox is. It stays in the room:
   *  turned back by the glass's angle, it keeps to the screen's upper left
   *  when the glass leans or stands on its head. It lands on three surfaces:
   *    the body of sand pressed against the front glass, a surface of
   *      revolution as the bore is: across a row its normal is
   *      (s, 0, sqrt(1 - s^2)) with s = (x - cx) / r(y), r from the shape's
   *      own profile, so every shape is lit by its own wall. The light that
   *      reaches it passes the glass: less of it toward the grazing side
   *      (Fresnel, twice), a thin crescent past the terminator where rays run
   *      inside the wall, and a contact shade where the sand meets the glass;
   *    the free surface (heap and crater), each column's normal from the
   *      surface heights of the frame before, with a soft shadow where the bed
   *      itself hides the light (a horizon test toward the light);
   *    grains in flight, small beads lit by half the key.
   *  A grain is "surface" near the top of its bed and "body" below. Shadows
   *  gain colour rather than going grey (the colour table). Each grain has a
   *  fixed facet and glints when it faces the key's mirror direction; a
   *  share of the grains, set per sand (its `sun` record), can glint at all.
   *  A grain is the same 2 x 2 bead as ever, its lit and dark pixels where
   *  its seed has them.
   *
   *  Per look (SUNLIT, chosen by setPaper and mixed by _paperMix while the
   *  looks fade, exactly each look's at rest) and per sand: the constants and
   *  a colour table (48 levels x 256 seeds). Per light (the look, the sand,
   *  or the glass turned by 0.01 rad): three small tables. Per cell (the
   *  shape, made once): the body normal's angle and the distance to the
   *  glass, in 16 bits. Per frame: the columns. Per grain: a few lookups.
   * ---------------------------------------------------------------- */
  var SUN_BANDS = 16;               // the contact shade by the distance to the glass, in half cells (15: none)

  /** 'sunlit' or 'soft' (as it has always been drawn). Only the sand's own picture changes. */
  Renderer.prototype.setSandLight = function (mode) {
    this.sunlit = mode === 'sunlit';
  };

  /** The constants of the look `m` of the way from the dark to the light (exactly each look's at 0 and 1), for this sand. */
  Renderer.prototype._sunConsts = function (m) {
    var a = SUNLIT.dark, b = SUNLIT.paper, k = {}, key;
    for (key in a) if (typeof a[key] === 'number') k[key] = byMix(a[key], b[key], m);
    k.tint = [byMix(a.tint[0], b.tint[0], m), byMix(a.tint[1], b.tint[1], m), byMix(a.tint[2], b.tint[2], m)];
    var th = this.theme, sun = th.sun || (Object.prototype.hasOwnProperty.call(SANDS, th.id) && SANDS[th.id].sun) || SANDS.sahara.sun;
    var pk = byMix(1, sun.paper, m);
    k.K *= sun.key * pk; k.A += sun.lift; k.hlK *= pk * pk;
    k.sun = sun;
    return k;
  };

  /** The per-cell bytes: the body normal's angle (low byte) and the band of the contact shade (high byte). Made once per shape. */
  Renderer.prototype._sunCells = function (S) {
    var sim = this.sim, g = sim.geo, W = sim.W, H = sim.H, c16 = S.c16 = new Uint16Array(W * H), x, y;
    for (y = 0; y < H; y++) {
      var rr = profile(Math.abs(y + 0.5 - g.cy) / g.HB, g);
      for (x = sim.rowMin[y]; x <= sim.rowMax[y]; x++) {
        var dx = x + 0.5 - g.cx, sn = rr > 0.5 ? dx / rr : 0, dw = rr - Math.abs(dx);
        if (sn > 1) sn = 1; else if (sn < -1) sn = -1;
        var q = Math.round((Math.asin(sn) / Math.PI + 0.5) * 255);
        var band = dw <= 0 ? 0 : Math.min(SUN_BANDS - 1, Math.round(dw * 2));
        c16[y * W + x] = (band << 8) | q;
      }
    }
    S.geo = g; S.builds.cells++;
  };

  /** The look's tables: its constants, the colour table, the depth ramps and each seed's facet and threshold. */
  Renderer.prototype._sunLook = function (S) {
    var k = S.k = this._sunConsts(this.mix), sun = k.sun, src = this.lut, out = S.lut, s, lv, d;
    var m0 = 0.34 + 21 * 0.031, base = [0, 0, 0], tint = k.tint, ks = k.ks, hl = this.theme.light.hl * k.hlK;
    // the bed's mean colour (its grains but the mica): a mica fleck far brighter than its bed (gold on black)
    // is drawn part of the way toward it, so that it sparkles when it glints and is quiet when it does not
    var mean = [0, 0, 0], nm = 0, v, c3;
    for (s = 0; s < 256; s++) if (!this.isMica[s]) { v = src[(21 << 8) | s] >>> 0; mean[0] += v & 255; mean[1] += (v >>> 8) & 255; mean[2] += (v >>> 16) & 255; nm++; }
    if (nm) { mean[0] /= nm; mean[1] /= nm; mean[2] /= nm; }
    var yMean = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2] + 1;
    for (s = 0; s < 256; s++) {
      v = src[(21 << 8) | s] >>> 0;
      base[0] = v & 255; base[1] = (v >>> 8) & 255; base[2] = (v >>> 16) & 255;
      if (this.isMica[s] && nm) {
        var q0 = ((0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2] + 1) / yMean - 1.5) / 3;
        q0 = q0 < 0 ? 0 : (q0 > 0.55 ? 0.55 : q0);
        for (c3 = 0; c3 < 3; c3++) base[c3] += (mean[c3] - base[c3]) * q0;
      }
      base[0] /= m0; base[1] /= m0; base[2] /= m0;
      for (lv = 0; lv < LEVELS; lv++) {
        var mm = 0.34 + lv * 0.031, r = base[0] * mm, gg = base[1] * mm, b = base[2] * mm;
        if (mm < 1) {                                  // a shadow deepens in colour: light bounced among coloured grains
          var Y = 0.2126 * r + 0.7152 * gg + 0.0722 * b, q = 1 + ks * (1 - mm);
          r = Y + (r - Y) * q; gg = Y + (gg - Y) * q; b = Y + (b - Y) * q;
        }
        r = r > 255 ? 255 : (r < 0 ? 0 : r); gg = gg > 255 ? 255 : (gg < 0 ? 0 : gg); b = b > 255 ? 255 : (b < 0 ? 0 : b);
        if (mm > 1) {                                  // a lit grain rolls toward the light's own tint
          var w = (mm - 1) * hl; if (w > 0.94) w = 0.94;
          r += (tint[0] - r) * w; gg += (tint[1] - gg) * w; b += (tint[2] - b) * w;
        }
        out[(lv << 8) | s] = ((255 << 24) | ((b | 0) << 16) | ((gg | 0) << 8) | (r | 0)) >>> 0;
      }
      // the facet's threshold: mica nearer the mirror direction than glossy grains, glossy than the rest;
      // a grain that is not among the share that may glint never does
      var gs = this.isMica[s] ? sun.mica : (this.hiBoost[s] > 3 ? 0.982 : 0.993);
      var j = S.J, jj = j[3 * s] * j[3 * s] + j[3 * s + 1] * j[3 * s + 1] + j[3 * s + 2] * j[3 * s + 2];
      S.gs[s] = hash01(s * 23 + 9) < sun.glints ? gs * Math.sqrt(1 + jj) : 9;
    }
    var X = k.X / 0.031;
    for (d = 0; d < 256; d++) {
      S.wt[d] = d < 1 ? 1 : (d > 14 ? 0 : Math.exp(-(d - 1) / k.wd));
      S.ao[d] = 1 - k.kd * (1 - Math.exp(-Math.max(d - 1, 0) / 7));
    }
    // a grain in flight: a small bead, its mean light over the half the eye sees
    S.lvFlight = Math.max(3, Math.min(44, Math.round((k.X * (k.A + 0.62 * k.K) - 0.34) / 0.031)));
    S.X = X; S.rev = this._sunRev; S.mix = this.mix; S.builds.look++;
    S.rot = NaN;                                       // (the light's tables follow)
  };

  /** The light's tables, for the glass at `rot` against the room: the body's light and glint by the cell's angle, each seed's facet. */
  Renderer.prototype._sunLight = function (S, rot) {
    var k = S.k, K0 = KEY_LIGHT, c = Math.cos(rot), sn = Math.sin(rot), q, band;
    // the key in the lattice's axes (x right, Y up the glass): the room's turned back by the glass's angle
    var L = [c * K0[0] - sn * K0[1], sn * K0[0] + c * K0[1], K0[2]], hz = L[2] + 1;
    var hl = Math.sqrt(L[0] * L[0] + L[1] * L[1] + hz * hz), Hh = [L[0] / hl, L[1] / hl, hz / hl];
    var aw = S.aw, eb = S.eb, hb = S.hb, X = S.X, f;
    for (band = 0; band < SUN_BANDS; band++) aw[band] = band === SUN_BANDS - 1 ? 1 : 1 - k.kw * Math.exp(-band * 0.5 / 2.2);
    for (q = 0; q < 256; q++) {
      var ph = (q / 255 - 0.5) * Math.PI, bx = Math.sin(ph), bz = Math.cos(ph);
      var nl = bx * L[0] + bz * L[2], mu = nl > 0 ? nl : 0, F = 0.04 + 0.96 * Math.pow(1 - mu, 5), T = (1 - F) * (1 - F);
      var D = (nl + k.wrap) / (1 + k.wrap), cr = (nl + 0.04) / 0.10;
      f = (k.A + k.K * T * (D > 0 ? D : 0) + k.C * Math.exp(-cr * cr)) * X;
      for (band = 0; band < SUN_BANDS; band++) eb[(band << 8) | q] = f * aw[band];
      hb[q] = bx * Hh[0] + bz * Hh[2];
    }
    var J = S.J;
    for (q = 0; q < 256; q++) S.t2[q] = S.gs[q] - (J[3 * q] * Hh[0] + J[3 * q + 1] * Hh[1] + J[3 * q + 2] * Hh[2]);
    S.L = L; S.H = Hh; S.rot = rot; S.builds.light++;
  };

  /** Once a frame, per column of each bed: the free surface's light, its glint term and its soft shadow, from last frame's surface. */
  Renderer.prototype._sunColumns = function (S, up) {
    var W = this.sim.W, L = S.L, Hh = S.H, k = S.k, U = up ? -1 : 1, X = S.X;
    var LU = L[1] * U, ax = L[0] < 0 ? -L[0] : L[0], tanA = LU / (ax > 1e-3 ? ax : 1e-3), sg = L[0] < 0 ? -1 : 1;
    for (var b = 0; b < 2; b++) {
      var sf = S.surf[b], et = S.et[b], th = S.th[b], x, o, kk;
      for (x = 0; x < W; x++) {
        var r0 = sf[x];
        if (r0 < 0) { et[x] = -1; continue; }
        var h0 = up ? r0 : -r0, sum = 0, ws = 0;
        for (o = 1; o <= 3; o++) {
          var ra = x + o < W ? sf[x + o] : -1, rc = x - o >= 0 ? sf[x - o] : -1;
          if (ra >= 0 && rc >= 0) { sum += ((up ? ra : -ra) - (up ? rc : -rc)) / (2 * o * o); ws += 1 / o; }
        }
        var mx = ws ? sum / ws : 0, nx = -mx, ny = U, nz = 0.5, l = Math.sqrt(nx * nx + 1 + 0.25);
        nx /= l; ny /= l; nz /= l;
        var tau = -9;
        for (kk = 1; kk <= 24; kk *= 2) {
          var xk = x + sg * kk, rk = xk >= 0 && xk < W ? sf[xk] : -1;
          if (rk >= 0) { var t = ((up ? rk : -rk) - h0) / kk; if (t > tau) tau = t; }
        }
        var vis = 0.2;
        if (LU > 0) { var e0 = tanA - 0.25, e1 = tanA + 0.35, u = (tau - e0) / (e1 - e0); u = u < 0 ? 0 : (u > 1 ? 1 : u); vis = 1 - 0.8 * u * u * (3 - 2 * u); }
        var nl = nx * L[0] + ny * L[1] + nz * L[2], D = (nl + k.wrap) / (1 + k.wrap);
        et[x] = (k.A * (0.85 + 0.15 * ny * U) + 0.88 * k.K * vis * (D > 0 ? D : 0)) * X;
        th[x] = nx * Hh[0] + ny * Hh[1] + nz * Hh[2];
      }
    }
  };

  Renderer.prototype._drawSunlit = function () {
    var sim = this.sim, W = sim.W, H = sim.H, BW = this.BW, S = this._sun, i, s, d;
    if (!S) {
      S = this._sun = {
        geo: null, c16: null, k: null, lut: new Uint32Array(LEVELS * 256), J: new Float32Array(768), gs: new Float32Array(256),
        t2: new Float32Array(256), wt: new Float32Array(256), ao: new Float32Array(256), aw: new Float32Array(SUN_BANDS),
        eb: new Float32Array(SUN_BANDS * 256), hb: new Float32Array(256),
        surf: [new Int16Array(W).fill(-1), new Int16Array(W).fill(-1)], next: [new Int16Array(W), new Int16Array(W)],
        et: [new Float32Array(W), new Float32Array(W)], th: [new Float32Array(W), new Float32Array(W)],
        rev: -1, mix: -1, rot: NaN, X: 1, lvFlight: 24, L: null, H: null, builds: { cells: 0, look: 0, light: 0 }
      };
      for (s = 0; s < 256; s++) {                      // each seed's facet: a fixed tilt in a ball of radius 0.55
        var a = hash01(s * 5 + 3) * 6.2832, bb = Math.acos(2 * hash01(s * 11 + 7) - 1), mg = 0.55 * Math.cbrt(hash01(s * 17 + 1));
        S.J[3 * s] = mg * Math.sin(bb) * Math.cos(a); S.J[3 * s + 1] = mg * Math.sin(bb) * Math.sin(a); S.J[3 * s + 2] = mg * Math.cos(bb);
      }
    }
    if (S.geo !== sim.geo) this._sunCells(S);
    if (S.rev !== this._sunRev || S.mix !== this.mix) this._sunLook(S);
    var rot = this.lightRot;
    if (!(Math.abs(rot - S.rot) < 0.01)) this._sunLight(S, rot);     // (as the glass is redrawn: under 0.6 degrees is not worth it)
    var up = sim.gy < 0;
    this._sunColumns(S, up);

    var cell = sim.cell, seed = sim.seed, buf = this.buf, lut = S.lut, depth = this.depth, edge = this.edgeMask;
    var c16 = S.c16, eb = S.eb, hb = S.hb, t2 = S.t2, wt = S.wt, ao = S.ao, glint = this.glintColor;
    var hiOff = this.hiOff, loOff = this.loOff, rowMin = sim.rowMin, rowMax = sim.rowMax, gateY = sim.gateY;
    var fr = ++this.frameNo, off = 0.34 / 0.031 - 0.5, tumble = (fr >> 2) * 67;
    var glow = this.bctx && fr % 3 === 0 ? this.bloomA : null, emit = this.emit, bw = this.bw, rimE = this.theme.light.emit.rim, gi = 0;
    var nx0 = S.next[0].fill(-1), nx1 = S.next[1].fill(-1);
    buf.fill(0); depth.fill(0); if (glow) glow.fill(0);
    var yS = up ? H - 1 : 0, yE = up ? -1 : H, yD = up ? -1 : 1, bed = 0;
    var et = S.et[0], th = S.th[0], nxt = nx0;
    var y, x, c, lv, bi, ci, e, w, eL, g, hi, mid, lo, em, x0, x1;
    for (y = yS; y !== yE; y += yD) {
      if (y === gateY) { depth.fill(0); bed = 1; et = S.et[1]; th = S.th[1]; nxt = nx1; continue; }
      x0 = rowMin[y]; x1 = rowMax[y];
      if (x0 > x1) continue;
      i = y * W + x0; bi = (y * SUB) * BW + x0 * SUB;
      for (x = x0; x <= x1; x++, i++, bi += SUB) {
        c = cell[i];
        if (c < REST) { depth[x] = 0; continue; }
        d = depth[x]; if (d < 255) depth[x] = ++d;
        if (nxt[x] < 0 && c !== MOVE) nxt[x] = y;               // this frame's resting surface, for the next frame's light
        s = seed[i]; ci = c16[i];
        e = eb[ci]; eL = et[x];
        w = eL >= 0 ? wt[d] : 0;
        if (w) e += (eL - e) * w;
        lv = (e * ao[d] - off) | 0;
        if (c === MOVE) lv++;
        if (lv < 3) lv = 3; else if (lv > 44) lv = 44;
        g = hb[ci & 255]; if (w) g += (th[x] - g) * w;
        mid = lut[(lv << 8) | s]; lo = lut[((lv - 3) << 8) | s];
        if (g > t2[c === MOVE ? (s + tumble) & 255 : s]) { hi = glint; if (glow) glow[(y >> 1) * bw + (x >> 1)] += 0.7; }
        else hi = lut[((lv + 3) << 8) | s];
        if (glow) { gi = (y >> 1) * bw + (x >> 1); glow[gi] += d === 1 ? emit[s] + rimE : emit[s]; }
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = mid;
        if (up) { buf[bi + loOff[s]] = hi; buf[bi + hiOff[s]] = lo; }
        else { buf[bi + hiOff[s]] = hi; buf[bi + loOff[s]] = lo; }
        em = edge[i];
        if (em !== 15) {                     // against the glass: keep only what is inside
          if (!(em & 1)) buf[bi] = 0;
          if (!(em & 2)) buf[bi + 1] = 0;
          if (!(em & 4)) buf[bi + BW] = 0;
          if (!(em & 8)) buf[bi + BW + 1] = 0;
        }
      }
    }
    var sw = S.surf; S.surf = S.next; S.next = sw;

    // grains in flight: small beads lit by half the key, a tumbling facet now and then catching it
    var np = sim.np, px = sim.px, py = sim.py, pvx = sim.pvx, pvy = sim.pvy, ps = sim.pseed, BH = this.BH, lvF = S.lvFlight;
    var isMica = this.isMica;
    for (var p = 0; p < np; p++) {
      var fx = px[p] * SUB, fy = py[p] * SUB, ix = fx | 0, iy = fy | 0;
      if (ix < 1 || iy < 1 || ix >= BW - 2 || iy >= BH - 2) continue;
      s = ps[p];
      var hh = Math.imul((p * 31 + (fr >> 1)) ^ s, 0x9E3779B1) >>> 0, flash = (hh >>> 24) < (isMica[s] ? 40 : 10);
      var col = lut[(lvF << 8) | s], hc = flash ? glint : lut[((lvF + 4) << 8) | s];
      var vx = pvx[p], vy = pvy[p], sp = Math.sqrt(vx * vx + vy * vy), len = sp * SUB / 60 * 0.9;
      if (len > 20) len = 20;
      if (len >= 1.5) {
        var ux = -vx / sp, uy = -vy / sp, rgb = col & 0x00FFFFFF;
        for (var kq = 1; kq <= len; kq++) {
          var qx = (fx + ux * (kq + 0.5)) | 0, qy = (fy + uy * (kq + 0.5)) | 0;
          if (qx < 0 || qy < 0 || qx >= BW - 1 || qy >= BH) continue;
          var qi = qy * BW + qx;
          if (buf[qi] !== 0) continue;
          if (!((edge[(qy >> 1) * W + (qx >> 1)] >> (((qy & 1) << 1) | (qx & 1))) & 1)) continue;
          var al = (150 * (1 - kq / (len + 1)) * (1 - kq / (len + 1))) | 0;
          buf[qi] = ((al << 24) | rgb) >>> 0;
          if (kq < 3 && ((edge[(qy >> 1) * W + ((qx + 1) >> 1)] >> (((qy & 1) << 1) | ((qx + 1) & 1))) & 1)) buf[qi + 1] = buf[qi];
        }
      }
      for (var dy2 = 0; dy2 < 2; dy2++) {
        for (var dx2 = 0; dx2 < 2; dx2++) {
          var gx2 = ix + dx2, gy2 = iy + dy2;
          if ((edge[(gy2 >> 1) * W + (gx2 >> 1)] >> (((gy2 & 1) << 1) | (gx2 & 1))) & 1) buf[gy2 * BW + gx2] = dx2 === 0 && dy2 === 0 ? hc : col;
        }
      }
      if (glow) glow[(py[p] >> 1) * bw + (px[p] >> 1)] += flash ? 0.8 : 0.3;
    }

    if (this.sweep === 1) this._sweepOut(); else if (this.sweep === 2) this._sweepIn();
    this.sctx.putImageData(this.img, 0, 0);
    if (glow) this._bloomOut();
  };

  /* ---------------------------------------------------------------- *
   *  The sweep: one glass of sand gives way to the next (Reset, another
   *  duration). Only the picture changes; the sand itself is not touched.
   *
   *  1, the old sand goes into the neck, as an incompressible sheet flows
   *  into a point sink: for every grain the square of its distance from
   *  the neck falls by the same amount. So the nearest sand is swallowed
   *  first, a funnel sinks into the upper bed, the heap below is eaten
   *  from its apex, and no grain changes size on its way.
   *
   *  2, the new sand is poured: the bed the reset has laid is shown up to
   *  a surface that rises as a steady pour would raise it, grain for grain
   *  (fast in the narrow of the funnel, slower above), heaped under the
   *  thread that falls from the top of the bulb, and level at the end.
   *
   *  p runs from 0 to 1 in each; 0 for the kind ends it.
   * ---------------------------------------------------------------- */
  Renderer.prototype.setSweep = function (kind, p) {
    if (!kind) { this.sweep = 0; this._sw = null; return; }
    if (kind !== this.sweep) { this.sweep = kind; this._swNew = true; }
    this.sweepP = p > 0 ? (p < 1 ? p : 1) : 0;
  };

  Renderer.prototype._sweepOut = function () {
    var sim = this.sim, W = sim.W, BW = this.BW, BH = this.BH, buf = this.buf, edge = this.edgeMask;
    var nx = sim.geo.cx * SUB, ny = (sim.gateY + 0.5) * SUB;       // the neck, in the picture's own pixels
    var src = this._swSrc || (this._swSrc = new Uint32Array(BW * BH));
    var x, y, dx, dy, r2, k, sx, sy, v, row;
    if (this._swNew) {
      // how far from the neck the farthest sand lies
      this._swNew = false;
      var far = 0;
      for (y = 0; y < BH; y++) {
        dy = y + 0.5 - ny; row = y * BW;
        for (x = 0; x < BW; x++) {
          if (buf[row + x] === 0) continue;
          dx = x + 0.5 - nx; r2 = dx * dx + dy * dy;
          if (r2 > far) far = r2;
        }
      }
      this._swFar = far + 4;
    }
    var S = this._swFar * Math.pow(this.sweepP, 1.5), lim = this._swFar - S;   // what is left lies within √lim of the neck
    src.set(buf);
    buf.fill(0);
    if (lim <= 0) return;
    var R = Math.sqrt(lim);
    var x0 = Math.max(0, Math.floor(nx - R)), x1 = Math.min(BW - 1, Math.ceil(nx + R));
    var y0 = Math.max(0, Math.floor(ny - R)), y1 = Math.min(BH - 1, Math.ceil(ny + R));
    for (y = y0; y <= y1; y++) {
      dy = y + 0.5 - ny; row = y * BW;
      for (x = x0; x <= x1; x++) {
        dx = x + 0.5 - nx;
        r2 = dx * dx + dy * dy;
        if (r2 > lim || r2 < 0.2) continue;
        k = Math.sqrt((r2 + S) / r2);                              // where this grain was: farther out along its ray
        sx = (nx + dx * k) | 0; sy = (ny + dy * k) | 0;
        if (sx < 0 || sy < 0 || sx >= BW || sy >= BH) continue;
        v = src[sy * BW + sx];
        if (v === 0) continue;
        // inside the glass only (a ray from the neck can graze the wall beside it)
        if (!((edge[(y >> 1) * W + (x >> 1)] >> (((y & 1) << 1) | (x & 1))) & 1)) continue;
        buf[row + x] = v;
      }
    }
  };

  Renderer.prototype._sweepIn = function () {
    var sim = this.sim, W = sim.W, BW = this.BW, buf = this.buf, cell = sim.cell, seed = sim.seed, edge = this.edgeMask;
    var rowMin = sim.rowMin, rowMax = sim.rowMax, gate = sim.gateY, cx = sim.geo.cx, cxI = cx | 0;
    var lut = this.lut, base = this.baseLevel, ao = this.aoTab, hiOff = this.hiOff, loOff = this.loOff, hiBoost = this.hiBoost;
    var st = this._sw, x, y, i, bi, k, a, b, c, hw, h, s, d, lv, hl, em;
    if (this._swNew || !st) {
      // the bed as the reset laid it: its rows of sand from the neck up, the top of the bulb on its axis,
      // and a handful of its grains' colours for the thread
      this._swNew = false;
      st = this._sw = { lo: new Int32Array(gate), hi: new Int32Array(gate), cnt: new Int32Array(gate), n: 0, top: gate, cap: 1, pal: new Uint8Array(32) };
      for (y = gate - 1; y >= 1; y--) {
        a = -1; b = -2; c = 0;
        for (x = rowMin[y]; x <= rowMax[y]; x++) if (cell[y * W + x] >= REST) { if (a < 0) a = x; b = x; c++; }
        st.lo[y] = a; st.hi[y] = b; st.cnt[y] = c; st.n += c;
        if (c > 0) st.top = y;
      }
      for (y = 1; y < gate; y++) if (rowMin[y] <= cxI && cxI <= rowMax[y]) { st.cap = y; break; }
      for (k = 0; k < 32; k++) {
        y = st.top + (((gate - st.top) * (k + 0.5) / 32) | 0);
        st.pal[k] = st.cnt[y] > 0 ? seed[y * W + st.lo[y] + ((Math.imul(k, 0x9E3779B1) >>> 8) % st.cnt[y])] : 0;
      }
    }
    if (st.n === 0 || sim.gy <= 0) return;
    var p = this.sweepP, fr = this.frameNo;
    // another glass than the classic may have a long narrow neck or a pointed top, where the thread
    // and its spray run along the wall: there each of their pixels is asked for (_dab)
    var shaped = !!sim.geo.shape;
    var v = (p - 0.08) / 0.78; v = v < 0 ? 0 : (v > 1 ? 1 : v);     // the share of the sand that has come
    var want = v * st.n, slope = 0.62 * Math.sqrt(1 - v);           // heaped under the thread (32°), level at the end
    // the apex row of the heap that holds `want` grains (bisection: a few dozen rows a time)
    var up = st.top - 2 - slope * W, dn = gate, yb = gate, it;
    for (it = 0; it < 14; it++) {
      yb = (up + dn) / 2; c = 0;
      for (y = Math.max(st.top, Math.ceil(yb - 0.5)); y < gate; y++) {
        if (st.cnt[y] === 0) continue;
        hw = slope > 1e-3 ? (y + 0.5 - yb) / slope : 1e9;
        a = Math.max(st.lo[y], Math.ceil(cx - hw - 0.5)); b = Math.min(st.hi[y], Math.floor(cx + hw - 0.5));
        if (b >= a) c += b - a + 1;
      }
      if (c > want) up = yb; else dn = yb;
    }
    if (v >= 1) yb = up;
    // hide what has not come yet, and light the surface of what has
    var deep = 2; while (deep < 40 && ao[deep] !== ao[255]) deep++;
    for (y = st.top; y < gate; y++) {
      if (st.cnt[y] === 0) continue;
      hw = slope > 1e-3 ? (y + 0.5 - yb) / slope : 1e9;
      for (x = st.lo[y]; x <= st.hi[y]; x++) {
        i = y * W + x;
        if (cell[i] < REST) continue;
        d = cx - (x + 0.5); if (d < 0) d = -d;
        bi = (y * SUB) * BW + x * SUB;
        if (hw < d) { buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = 0; continue; }
        // how deep under the heap's surface this grain lies for the moment (in its own column)
        d = ((y + 0.5 - yb - slope * d) | 0) + 1;
        if (d >= deep) continue;                                   // as deep as it will ever look
        s = seed[i];
        lv = base[i] - ao[d] + AO_BIAS;
        hl = lv + hiBoost[s]; if (hl > 47) hl = 47;
        buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = lut[(lv << 8) | s];
        buf[bi + hiOff[s]] = lut[(hl << 8) | s];
        buf[bi + loOff[s]] = lut[((lv - 3) << 8) | s];
        em = edge[i];
        if (em !== 15) {
          if (!(em & 1)) buf[bi] = 0;
          if (!(em & 2)) buf[bi + 1] = 0;
          if (!(em & 4)) buf[bi + BW] = 0;
          if (!(em & 8)) buf[bi + BW + 1] = 0;
        }
      }
    }
    // the thread: its first grains fall, it pours, its last grains fall
    var head = st.cap + (gate - st.cap) * Math.min(1, p / 0.09), tail = st.cap + (gate - st.cap) * Math.max(0, (p - 0.85) / 0.11);
    var end = Math.min(head, yb - 0.5), thick = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.2);
    for (y = Math.ceil(tail); y < end; y++) {
      for (k = -2; k <= 2; k++) {                                  // (a pour, not the glass's own thread: a few grains abreast)
        h = Math.imul((y * 5 + k + 2) ^ Math.imul(fr, 0x85EBCA6B), 0x9E3779B1) >>> 0;
        if ((h & 255) >= (k === 0 ? 225 : (k === 1 || k === -1 ? 150 : 50)) * thick) continue;
        x = cxI + k;
        if (x < rowMin[y] || x > rowMax[y]) continue;
        bi = (y * SUB + ((h >>> 9) & 1)) * BW + x * SUB + ((h >>> 8) & 1);
        c = lut[((22 + ((h >>> 28) & 3)) << 8) | st.pal[(h >>> 16) & 31]];
        if (shaped) this._dab(bi, c); else buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = c;
      }
    }
    // … and a little spray where it lands
    if (head >= yb - 0.5 && tail < yb - 0.5) {
      for (k = 0; k < 14; k++) {
        h = Math.imul((k + 1) ^ Math.imul(fr, 0xC2B2AE35), 0x9E3779B1) >>> 0;
        if ((h & 255) > 140 * thick) continue;
        x = cxI + ((h >>> 8) % 15) - 7;
        d = cx - (x + 0.5); if (d < 0) d = -d;
        y = (yb + slope * d - 1 - ((h >>> 12) % 6)) | 0;
        if (y <= st.cap || y >= gate || x < rowMin[y] || x > rowMax[y]) continue;
        bi = (y * SUB) * BW + x * SUB;
        if (buf[bi] !== 0) continue;
        c = lut[((24 + ((h >>> 28) & 3)) << 8) | st.pal[(h >>> 20) & 31]];
        if (shaped) this._dab(bi, c); else buf[bi] = buf[bi + 1] = buf[bi + BW] = buf[bi + BW + 1] = c;
      }
    }
  };

  /** A grain of the sweep at buffer index bi: of its four pixels, those that lie inside the glass. */
  Renderer.prototype._dab = function (bi, c) {
    var BW = this.BW, W = this.sim.W, edge = this.edgeMask, buf = this.buf, x = bi % BW, y = (bi - x) / BW, k, X, Y;
    for (k = 0; k < 4; k++) {
      X = x + (k & 1); Y = y + (k >> 1);
      if ((edge[(Y >> 1) * W + (X >> 1)] >> (((Y & 1) << 1) | (X & 1))) & 1) buf[Y * BW + X] = c;
    }
  };

  /** Blur the accumulated light and hand it to the compositor. */
  Renderer.prototype._bloomOut = function () {
    var bw = this.bw, bh = this.bh, a = this.bloomA, b = this.bloomB;
    var x, y, i, pass;
    for (pass = 0; pass < 1; pass++) {                 // separable [1 2 1]; the upscale softens the rest
      for (y = 1; y < bh - 1; y++) {
        i = y * bw + 1;
        for (x = 1; x < bw - 1; x++, i++) b[i] = (a[i - 1] + a[i] + a[i] + a[i + 1]) * 0.25;
      }
      for (y = 1; y < bh - 1; y++) {
        i = y * bw + 1;
        for (x = 1; x < bw - 1; x++, i++) a[i] = (b[i - bw] + b[i] + b[i] + b[i + bw]) * 0.25;
      }
    }
    var out = this.bbuf, rgb = this.bloomRGB, k = this.theme.light.bloom * 255, v, n = bw * bh;
    var mask = this.bloomMask;
    for (i = 0; i < n; i++) {
      v = a[i] * k * mask[i];                          // light stays inside the glass
      out[i] = v < 1 ? 0 : (((v > 200 ? 200 : v | 0) << 24) | rgb) >>> 0;
    }
    this.bctx.putImageData(this.bimg, 0, 0);
  };

  /* ---------------------------------------------------------------- *
   *  Static layers
   * ---------------------------------------------------------------- */

  /**
   * What the drawn glass needs to know of a shape that is not the classic
   * one (SHAPES), found once per geometry and kept on it. The teardrop's
   * lights, collar and cracks are placed by fixed numbers (a crescent from
   * u = 0.26 to 0.93, a collar 0.62 R wide ...). On another shape each sits
   * where that shape's own wall is as far out as the teardrop's is there,
   * counted from its own widest point.
   *   us      the u of the outline's points, end to neck: close together
   *           where the wall turns fast, far apart where it runs straight;
   *           rs, nx, ny: the bore's half-width at each, and the way
   *           straight out of the glass there (the wall is as thick all along)
   *   colW    half the collar's width: it covers the end of the glass
   *   lit     per bulb [upper, lower]: the u the sheen and the window
   *           glint sit at
   *   cres, bounce, arc   the u each of those strokes runs between
   *   caus    the caustic on the lower bulb's floor: [u, x, radius]
   *   hoop, star          a crack starting below / above this u is one
   */
  function shapeMarks(g) {
    if (g.marks) return g.marks;
    var N = 2048, k, eq = g.equator, R = g.R, HB = g.HB, q = g.q;
    var r = new Float64Array(N + 1), ke = Math.round(eq * N);
    for (k = 0; k <= N; k++) r[k] = profile(k / N, g);
    // the u where the bore is `share` of R, on the way out of the neck (to < 0) or on toward the end
    function at(share, to) {
      var v = share * R, i;
      if (to < 0) {
        for (i = 1; i <= ke; i++) if (r[i] >= v) return (i - 1 + (v - r[i - 1]) / (r[i] - r[i - 1])) / N;
        return eq;
      }
      for (i = ke + 1; i <= N; i++) if (r[i] < v) return (i - 1 + (r[i - 1] - v) / (r[i - 1] - r[i])) / N;
      return 1;
    }
    // The outline: halve every stretch until the wall leaves its chord by less
    // than a thirtieth of a cell (or the stretch is a twentieth of a row).
    var us = [1];
    function span(ua, ra, ub, rb, depth) {
      var um = (ua + ub) / 2, rm = profile(um, g);
      var dx = rb - ra, dy = (ub - ua) * HB, off = Math.abs((rm - ra) * dy - (um - ua) * HB * dx) / Math.sqrt(dx * dx + dy * dy);
      if (depth < 8 && (off > 0.03 || depth < 1)) { span(ua, ra, um, rm, depth + 1); span(um, rm, ub, rb, depth + 1); }
      else us.push(ub);
    }
    for (k = 64; k > 0; k--) span(k / 64, k === 64 ? 0 : profile(k / 64, g), (k - 1) / 64, profile((k - 1) / 64, g), 0);
    // ... and at each point the bore's half-width and the way straight out of
    // the glass there (x, and y toward the end). The teardrop's outer surface
    // is its bore pushed sideways on a bulb stretched by the wall; on a wall
    // that flares late or ends low and flat that leaves hardly any glass.
    var n = us.length, rs = new Float64Array(n), nx = new Float64Array(n), ny = new Float64Array(n), ua, ub, sl;
    ny[0] = 1;
    for (k = 1; k < n; k++) {
      ua = Math.max(0, us[k] - 0.002); ub = Math.min(1, us[k] + 0.002);
      sl = (profile(ub, g) - profile(ua, g)) / ((ub - ua) * HB);
      rs[k] = profile(us[k], g);
      nx[k] = 1 / Math.sqrt(1 + sl * sl); ny[k] = -sl * nx[k];
    }
    // The end: what the outer wall measures across where the collar begins.
    var endHalf = 0, yc = HB - 3.5 * q, x0 = 0, y0 = HB + g.wall, x1, y1;
    for (k = 1; k < n; k++) {
      x1 = rs[k] + g.wall * nx[k]; y1 = us[k] * HB + g.wall * ny[k];
      if (y1 < yc) { endHalf = Math.max(endHalf, x0 + (x1 - x0) * (y0 - yc) / (y0 - y1)); break; }
      endHalf = Math.max(endHalf, x1);
      x0 = x1; y0 = y1;
    }
    // Sheen and glint: 0.16 and 0.20 of the bulb above its widest point, as on
    // the teardrop, but never nearer the end or the neck than the glass is
    // half open, and the glint (a window, 5 by 14 cells) whole within the bore.
    var lo = at(0.5, -1), hi = at(0.5, 1), lit = [], b, ug;
    function held(u) { return u < lo ? lo : (u > hi ? hi : u); }
    function fits(u) {
      var x = 0.61 * profile(u, g) + 4.5 * q, d = 8 * q / HB;
      return u + d < 1 && profile(u - d, g) >= x && profile(u + d, g) >= x;
    }
    for (b = -1; b <= 1; b += 2) {
      ug = held(eq - b * 0.20);
      for (k = 0; k < 50 && !fits(ug); k++) ug += b * 0.004;    // back toward the widest point
      lit.push({ sheen: held(eq - b * 0.16), glint: ug });
    }
    var uc = Math.min(0.93, at(0.5, 1)), rc = profile(uc, g);
    var a1 = Math.min(0.97, at(0.437, 1));
    g.marks = {
      us: us, rs: rs, nx: nx, ny: ny,
      colW: Math.max(0.40 * R, endHalf + 1.5 * q),
      lit: lit,
      cres: [at(0.502, -1), Math.min(0.93, at(0.641, 1))],
      bounce: [at(0.657, -1), Math.min(0.90, at(0.877, 1))],
      arc: [Math.max(eq, a1 - 0.17), a1],
      caus: [uc, 0.3125 * rc, Math.min(0.75 * R, 1.17 * rc)],
      hoop: eq * 0.3 / 0.66,
      star: eq + (1 - eq) * 0.09 / 0.34
    };
    return g.marks;
  }

  /**
   * Closed outline of the whole vessel, pushed outward by `grow` cells.
   * `path` is a Path2D or a 2D context (call beginPath() first).
   */
  function tracePathTo(path, g, grow) {
    var n = 200, k, u, r, a, pts = [];
    var ky = (g.HB + grow) / g.HB;
    if (g.shape) {
      // another glass: the points lie where its own wall turns, each pushed
      // straight out of the glass by `grow` (shapeMarks)
      var mk = shapeMarks(g), y;
      for (k = 0; k < mk.us.length; k++) {
        r = mk.rs[k] + grow * mk.nx[k]; y = mk.us[k] * g.HB + grow * mk.ny[k];
        if (y < 0) {                                 // beside the waist the two bulbs' walls meet
          a = pts[pts.length - 1];
          pts.push([a[0] + (r - a[0]) * a[1] / (a[1] + y), 0]);
          break;
        }
        pts.push([r, -y]);
      }
      n = pts.length - 1;
    } else {
      for (k = 0; k <= n; k++) {                     // right side, tip → neck
        a = k / n;
        u = 1 - (0.45 * a * (2 - a) + 0.55 * a);     // denser near the dome tip
        r = profile(u, g) + grow;
        pts.push([r, -u * g.HB * ky]);
      }
    }
    for (k = n - 1; k >= 0; k--) pts.push([pts[k][0], -pts[k][1]]);
    path.moveTo(pts[0][0], pts[0][1]);
    for (k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]);
    for (k = pts.length - 1; k >= 0; k--) path.lineTo(-pts[k][0], pts[k][1]);
    path.closePath();
  }
  function tracePath(ctx, g, grow) {
    ctx.beginPath();
    tracePathTo(ctx, g, grow);
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  Renderer.prototype._ctx = function (name) {
    var c = this.els[name], ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    var S = this.scale * this.dpr;
    ctx.setTransform(S, 0, 0, S, c.width / 2, c.height / 2);   // cells, centred
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    return ctx;
  };

  Renderer.prototype.drawStatic = function () {
    if (!this.cssW) return;
    this._drawBack();
    this._drawFront();
    this._drawLight();
    this.drawGlass(this.glassRot, true);
  };

  /** Material ramp across a turned / brushed part (symmetric → flip-safe). */
  function metalGradient(ctx, x0, x1, cap, vertical) {
    var gr = vertical ? ctx.createLinearGradient(0, x0, 0, x1)
                      : ctx.createLinearGradient(x0, 0, x1, 0);
    var lo = cap.lo, mid = cap.mid, hi = cap.hi;
    gr.addColorStop(0, rgba(lo, 1));
    gr.addColorStop(0.18, rgba(mid, 1));
    gr.addColorStop(0.5, rgba(mix(mid, hi, cap.kind === 'wood' ? 0.35 : 0.8), 1));
    gr.addColorStop(0.82, rgba(mid, 1));
    gr.addColorStop(1, rgba(lo, 1));
    return gr;
  }

  /* -- behind the sand: posts, glass body ----------------------------- */
  Renderer.prototype._drawBack = function () {
    var ctx = this._ctx('back'), g = this.sim.geo, th = this.theme, q = g.q;
    var tint = th.glass.tint;

    // Two slender turned posts. Draw one, rotate 180° for the other so the
    // layer is exactly point-symmetric (it rotates with the vessel).
    for (var side = 0; side < 2 && this.frame; side++) {
      ctx.save();
      if (side) ctx.rotate(Math.PI);
      var px = -g.postX, half = 1.7 * q, yT = -(g.HB + 4 * q), yB = g.HB + 4 * q;
      ctx.fillStyle = metalGradient(ctx, px - half, px + half, th.cap, false);
      roundRect(ctx, px - half, yT, half * 2, yB - yT, half);
      ctx.fill();
      // turned details: a swell near each end and a fine ring at the waist
      var swell = 2.9 * q;
      ctx.fillStyle = metalGradient(ctx, px - swell, px + swell, th.cap, false);
      var ends = [yT + 6 * q, yB - 20 * q];
      for (var e = 0; e < 2; e++) {
        roundRect(ctx, px - swell, ends[e], swell * 2, 14 * q, swell);
        ctx.fill();
      }
      roundRect(ctx, px - swell * 0.9, -2.2 * q, swell * 1.8, 4.4 * q, 2 * q);
      ctx.fill();
      ctx.restore();
    }

    // Glass body: almost clear in the middle, denser toward the silhouette
    // where the wall is seen edge-on. (Skipped when the glass is rendered.)
    var drawn = !this.glass;
    tracePath(ctx, g, g.wall);
    var body = ctx.createLinearGradient(-g.R - g.wall, 0, g.R + g.wall, 0);
    body.addColorStop(0, rgba(tint, 0.17));
    body.addColorStop(0.16, rgba(tint, 0.06));
    body.addColorStop(0.5, rgba(tint, 0.018));
    body.addColorStop(0.84, rgba(tint, 0.06));
    body.addColorStop(1, rgba(tint, 0.17));
    if (drawn) {
      // (on paper the smoke is a light grey veil: the bore seen through two walls, a pale sand still distinct in it)
      ctx.fillStyle = 'rgba(4,5,7,' + byMix(th.glass.smoke, 0.05 + th.glass.smoke * 0.3, this.mix) + ')';
      ctx.fill();
      ctx.fillStyle = body;
      ctx.fill();
    }

    // faint reflection of the far wall
    ctx.save();
    tracePath(ctx, g, 0);
    ctx.clip();
    if (drawn) {
      tracePath(ctx, g, 0);
      ctx.strokeStyle = rgba(tint, 0.035);
      ctx.lineWidth = 16 * q; ctx.stroke();
      ctx.strokeStyle = rgba(tint, 0.045);
      ctx.lineWidth = 7 * q; ctx.stroke();
    }
    // a breath of light held inside each bulb, so dark sand has something to
    // stand against (identical in both bulbs: the layer turns with the glass)
    var bl = th.light.backlight;
    if (bl > 0) {
      for (var b = -1; b <= 1; b += 2) {
        var cyB = b * g.HB * g.equator * 0.92;
        var gr = ctx.createRadialGradient(0, cyB, 0, 0, cyB, g.R * 1.15);
        gr.addColorStop(0, rgba(th.glow, bl));
        gr.addColorStop(0.55, rgba(th.glow, bl * 0.45));
        gr.addColorStop(1, rgba(th.glow, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(-g.R - 2, cyB - g.R * 1.2, g.R * 2 + 4, g.R * 2.4);
      }
    }
    ctx.restore();
  };

  /* -- in front of the sand: glass wall, rim light, caps -------------- */
  Renderer.prototype._drawFront = function () {
    var ctx = this._ctx('front'), g = this.sim.geo, th = this.theme, q = g.q;
    var tint = th.glass.tint, cap = th.cap, k, i;

    var drawn = !this.glass;
    // On paper the glass's own light cannot be seen: its wall and its lines are drawn in a deep,
    // cool ink instead, the band between its surfaces a soft grey, its outline a fine dark line.
    var m = this.mix;
    if (drawn && m > 0) tint = m >= 1 ? PAPER_INK : mix(tint, PAPER_INK, m);
    var pk = byMix(1, 0.55, m);
    if (drawn) {
    // double wall: the band between the outer and inner surface
    ctx.save();
    tracePath(ctx, g, g.wall);
    var wallGr = ctx.createLinearGradient(-g.R, 0, g.R, 0);
    wallGr.addColorStop(0, rgba(tint, 0.20 * pk));
    wallGr.addColorStop(0.5, rgba(tint, 0.09 * pk));
    wallGr.addColorStop(1, rgba(tint, 0.20 * pk));
    ctx.fillStyle = wallGr;
    // even-odd: outer minus inner
    var outer = new Path2D(), inner = new Path2D(), band = new Path2D();
    tracePathTo(outer, g, g.wall); tracePathTo(inner, g, 0);
    tracePathTo(band, g, g.wall); tracePathTo(band, g, 0);
    ctx.fill(band, 'evenodd');
    ctx.restore();

    // Fresnel rim: light gathers where the surface turns away from the eye
    ctx.save();
    ctx.clip(inner);
    ctx.strokeStyle = rgba(tint, 0.03 * pk); ctx.lineWidth = 13 * q; ctx.stroke(inner);
    ctx.strokeStyle = rgba(tint, 0.04 * pk); ctx.lineWidth = 7 * q; ctx.stroke(inner);
    ctx.strokeStyle = rgba(tint, 0.06 * pk); ctx.lineWidth = 3 * q; ctx.stroke(inner);
    ctx.restore();

    ctx.strokeStyle = rgba(tint, byMix(0.42, 0.62, m)); ctx.lineWidth = 0.75 * q; ctx.stroke(outer);
    ctx.strokeStyle = rgba(tint, byMix(0.20, 0.30, m)); ctx.lineWidth = 0.5 * q; ctx.stroke(inner);
    }
    this._drawCracks(ctx);                             // cracks lie on the glass, under the caps

    // End caps (collar + slab). Draw the top one, rotate for the bottom.
    for (var side = 0; side < 2 && this.frame; side++) {
      ctx.save();
      if (side) ctx.rotate(Math.PI);
      var yC = -(g.HB + 3 * q);                        // collar top
      var colW = g.shape ? shapeMarks(g).colW : g.R * 0.62;
      // collar seating the dome
      ctx.fillStyle = metalGradient(ctx, -colW, colW, cap, false);
      roundRect(ctx, -colW, yC, colW * 2, g.collarH + 1.5 * q, 1.6 * q);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(-colW, yC + g.collarH, colW * 2, 1.5 * q);
      // slab
      var sy = yC - g.slabH, sw = g.capHalf;
      ctx.fillStyle = metalGradient(ctx, -sw, sw, cap, false);
      roundRect(ctx, -sw, sy, sw * 2, g.slabH, 2.6 * q);
      ctx.fill();
      ctx.save();
      roundRect(ctx, -sw, sy, sw * 2, g.slabH, 2.6 * q);
      ctx.clip();
      if (cap.kind === 'wood') {
        // long, lazy grain lines
        for (k = 0; k < 16; k++) {
          var gy = sy + (hash01(k * 3 + 1) * 0.92 + 0.04) * g.slabH;
          var amp = (hash01(k * 5 + 2) - 0.5) * 2.2 * q;
          var ph = hash01(k * 7 + 3) * 6.28;
          ctx.beginPath();
          for (i = 0; i <= 24; i++) {
            var gx = -sw + (i / 24) * sw * 2;
            var yy = gy + Math.sin(i * 0.5 + ph) * amp * 0.35 + Math.sin(i * 0.17 + ph * 2) * amp;
            if (i) ctx.lineTo(gx, yy); else ctx.moveTo(gx, yy);
          }
          ctx.strokeStyle = hash01(k * 11 + 4) > 0.3
            ? 'rgba(10,5,2,' + (0.16 + hash01(k) * 0.22) + ')'
            : rgba(cap.hi, 0.10 + hash01(k) * 0.10);
          ctx.lineWidth = (0.3 + hash01(k * 13) * 0.55) * q;
          ctx.stroke();
        }
      } else {
        // brushed metal: a dense field of hairlines
        for (k = 0; k < 46; k++) {
          var by = sy + hash01(k * 3 + 9) * g.slabH;
          ctx.fillStyle = hash01(k * 7 + 1) > 0.5
            ? 'rgba(255,255,255,' + (0.03 + hash01(k) * 0.07) + ')'
            : 'rgba(0,0,0,' + (0.04 + hash01(k) * 0.09) + ')';
          var bx = -sw + hash01(k * 17 + 2) * sw * 0.6;
          ctx.fillRect(bx, by, sw * 2 * (0.5 + hash01(k * 5) * 0.5), 0.22 * q);
        }
      }
      // symmetric bevel: darker lips top and bottom
      var bev = ctx.createLinearGradient(0, sy, 0, sy + g.slabH);
      bev.addColorStop(0, 'rgba(0,0,0,0.30)');
      bev.addColorStop(0.16, 'rgba(0,0,0,0)');
      bev.addColorStop(0.84, 'rgba(0,0,0,0)');
      bev.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = bev;
      ctx.fillRect(-sw, sy, sw * 2, g.slabH);
      ctx.restore();
      ctx.restore();
    }
  };

  /* -- room lighting: speculars, caustics (does not rotate) ----------- */
  Renderer.prototype._drawLight = function () {
    var ctx = this._ctx('light'), g = this.sim.geo, th = this.theme, q = g.q;
    var glow = th.glow, k, u;
    var outer = new Path2D(); tracePathTo(outer, g, g.wall);

    var drawn = !this.glass;                          // rendered glass brings its own highlights
    // Another glass than the classic: every light below sits where this
    // shape's wall is (shapeMarks); the classic keeps its own numbers.
    var mk = g.shape ? shapeMarks(g) : null, lit;
    ctx.save();
    ctx.clip(outer);
    for (var b = -1; b <= 1 && drawn; b += 2) {       // -1 upper bulb, +1 lower
      var cyB = b * g.HB * g.equator;
      var shX = -g.R * 0.46, shY = cyB - g.HB * 0.16, shT = cyB - g.HB * 0.7, glX = g.R * 0.52, glY = cyB - g.HB * 0.20;
      if (mk) {
        lit = mk.lit[b < 0 ? 0 : 1];
        shX = -0.51 * profile(lit.sheen, g); shY = b * lit.sheen * g.HB; shT = shY - g.HB * 0.54;
        glX = 0.61 * profile(lit.glint, g); glY = b * lit.glint * g.HB;
      }

      // broad soft sheen from a key light up and to the left
      var sh = ctx.createRadialGradient(shX, shY, 0, shX, shY, g.R * 0.95);
      sh.addColorStop(0, 'rgba(255,255,255,0.105)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0.03)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(-g.R - 8, shT, g.R * 2 + 16, g.HB * 1.3);

      // long specular crescent hugging the left wall
      var uA = 0.26, uB = 0.93, n = 30;
      if (mk) { uA = mk.cres[0]; uB = mk.cres[1]; n = 60; }
      ctx.beginPath();
      for (k = 0; k <= n; k++) {
        u = uA + (uB - uA) * k / n;
        var xo = -profile(u, g) * 0.905;
        if (k) ctx.lineTo(xo, b * u * g.HB); else ctx.moveTo(xo, b * u * g.HB);
      }
      for (k = n; k >= 0; k--) {
        u = uA + (uB - uA) * k / n;
        var taper = Math.sin(Math.PI * k / n);
        ctx.lineTo(-profile(u, g) * (0.905 - 0.085 * taper), b * u * g.HB);
      }
      ctx.closePath();
      var cr = ctx.createLinearGradient(0, b * uA * g.HB, 0, b * uB * g.HB);
      var a0 = b < 0 ? 0.04 : 0.20, a1 = b < 0 ? 0.36 : 0.05;
      cr.addColorStop(0, 'rgba(255,255,255,' + a0 + ')');
      cr.addColorStop(0.55, 'rgba(255,255,255,' + Math.max(a0, a1) * 0.8 + ')');
      cr.addColorStop(1, 'rgba(255,255,255,' + a1 + ')');
      ctx.fillStyle = cr;
      ctx.fill();

      // thin bounce light on the right wall
      ctx.beginPath();
      var uC = mk ? mk.bounce[0] : 0.34, uD = mk ? mk.bounce[1] - mk.bounce[0] : 0.5;
      for (k = 0; k <= n; k++) {
        u = uC + uD * k / n;
        var xr = profile(u, g) * 0.95;
        if (k) ctx.lineTo(xr, b * u * g.HB); else ctx.moveTo(xr, b * u * g.HB);
      }
      ctx.strokeStyle = rgba(glow, 0.20);
      ctx.lineWidth = 0.9 * q;
      ctx.stroke();

      // window glint, upper right
      ctx.save();
      ctx.translate(glX, glY);
      ctx.rotate(0.42);
      var wg = ctx.createLinearGradient(0, -7 * q, 0, 7 * q);
      wg.addColorStop(0, 'rgba(255,255,255,0.26)');
      wg.addColorStop(1, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = wg;
      roundRect(ctx, -2.6 * q, -7 * q, 5.2 * q, 14 * q, 2.2 * q);
      ctx.fill();
      ctx.restore();
    }

    // caustic: light focused through the lower bulb onto its floor
    ctx.globalCompositeOperation = 'lighter';
    var caX = g.R * 0.20, caY = g.HB * 0.93, caR = g.R * 0.75, caT = g.HB * 0.6, caH = g.HB * 0.45;
    if (mk) { caX = mk.caus[1]; caY = mk.caus[0] * g.HB; caR = mk.caus[2]; caT = caY - caR; caH = g.HB * 1.05 - caT; }
    var ca = ctx.createRadialGradient(caX, caY, 0, caX, caY, caR);
    ca.addColorStop(0, rgba(glow, drawn ? 0.20 : 0.13));
    ca.addColorStop(0.4, rgba(glow, drawn ? 0.07 : 0.045));
    ca.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = ca;
    ctx.fillRect(-g.R, caT, g.R * 2, caH);
    if (drawn) {
    // refracted arc following the dome
    var uE = mk ? mk.arc[0] : 0.80, uF = mk ? mk.arc[1] - mk.arc[0] : 0.17;
    ctx.beginPath();
    for (k = 0; k <= 26; k++) {
      u = uE + uF * k / 26;
      var xa = profile(u, g) * 0.93;
      if (k) ctx.lineTo(xa, u * g.HB); else ctx.moveTo(xa, u * g.HB);
    }
    ctx.strokeStyle = rgba(glow, 0.30); ctx.lineWidth = 1.5 * q; ctx.stroke();
    ctx.strokeStyle = rgba(glow, 0.10); ctx.lineWidth = 5 * q; ctx.stroke();
    // sparkle where the neck pinches the light
    var nk = ctx.createRadialGradient(-g.RN - 1, 0, 0, -g.RN - 1, 0, 9 * q);
    nk.addColorStop(0, 'rgba(255,255,255,0.50)');
    nk.addColorStop(0.3, 'rgba(255,255,255,0.12)');
    nk.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = nk;
    ctx.fillRect(-g.RN - 12 * q, -10 * q, 22 * q, 20 * q);
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    if (!this.frame) return;

    // caps: key light rakes the top edges, the base catches the caustic
    var sw = g.capHalf, yC = g.HB + 3 * q, slab = g.slabH;
    for (var t = -1; t <= 1; t += 2) {
      var sy = t < 0 ? -(yC + slab) : yC;
      ctx.save();
      roundRect(ctx, -sw, sy, sw * 2, slab, 2.6 * q);
      ctx.clip();
      var band = ctx.createLinearGradient(-sw, 0, sw, 0);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.22, 'rgba(255,255,255,0.03)');
      band.addColorStop(0.32, 'rgba(255,255,255,' + (th.cap.kind === 'wood' ? 0.10 : 0.17) + ')');
      band.addColorStop(0.44, 'rgba(255,255,255,0.03)');
      band.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = band;
      ctx.fillRect(-sw, sy, sw * 2, slab);
      var edge = ctx.createLinearGradient(0, sy, 0, sy + slab);
      edge.addColorStop(0, 'rgba(255,255,255,' + (th.cap.kind === 'wood' ? 0.20 : 0.26) + ')');
      edge.addColorStop(0.14, 'rgba(255,255,255,0)');
      edge.addColorStop(0.7, 'rgba(0,0,0,0)');
      edge.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = edge;
      ctx.fillRect(-sw, sy, sw * 2, slab);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    var pool = ctx.createRadialGradient(g.R * 0.1, yC, 0, g.R * 0.1, yC, g.R * 0.8);
    pool.addColorStop(0, rgba(glow, 0.16));
    pool.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(-sw, yC - 2 * q, sw * 2, slab * 0.7);
    ctx.globalCompositeOperation = 'source-over';

    // posts: a hairline highlight down the lit side
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      var hl = ctx.createLinearGradient(0, -g.HB, 0, g.HB);
      hl.addColorStop(0, 'rgba(255,255,255,0.34)');
      hl.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      hl.addColorStop(1, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = hl;
      ctx.fillRect(sgn * g.postX - 0.95 * q, -g.HB, 0.5 * q, g.HB * 2);
    }
  };


  _.shapeMarks = shapeMarks; P.Renderer = Renderer; _.tracePath = tracePath;
  _.loaded = 'glass/renderer.js';
})(typeof window !== 'undefined' ? window : globalThis);
