/*!
 * Hourglass — glass/cracks.js
 * Cracks on the glass, its mends and their glints (Renderer and Sim methods).
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
  if (_.loaded !== 'glass/renderer.js') return;   // a piece before this one is missing: define nothing (app.js says it is updating)
  var hash01 = _.hash01, shapeMarks = _.shapeMarks, Renderer = P.Renderer, tracePath = _.tracePath,
      Sim = P.Sim, WALL_BINS = _.WALL_BINS, profile = P.profile;

  /* ======================================================================
   *  Cracks on the glass
   *
   *  A crack is drawn into c-front, after the drawn glass and before the
   *  caps, so the caps cover its ends under the collars, it turns with the
   *  glass, and it survives theme changes, Frame on/off and relayout, all
   *  of which redraw c-front. There is no crack canvas of its own: a full-
   *  size layer would cost megabytes and more compositing while the glass
   *  turns.
   *
   *  A crack grows over the front face of the glass in surface coordinates,
   *  u along the axis (0 at the neck, 1 at the far end) and φ round it (0
   *  facing the viewer, ±π/2 at the silhouette), and is projected as
   *  x = r(u)·sin φ, y = u·HB. A crack running round the shoulder therefore
   *  reads as a curved arc, and one across the dome bends with it. Paths are
   *  grown for the lower bulb's right side and mirrored into place. The
   *  vessel is point-symmetric, so after a flip the same mirror, taken from
   *  the crack's new bulb and side, puts it back on exactly the same glass.
   * ==================================================================== */
  var CRACK_SEGS = 170;             // segments per crack; a glass holds three at most (≤ 512)
  var CRACK_MAIN = 128;             // ... of which its main arms take this many at most
  var CRACK_STEP = 1.1;             // cells of arc length per segment
  var CRACK_WANDER = 9 * Math.PI / 180;    // how far the heading wanders per step (σ)
  var CRACK_ST = 7;                 // canonical floats per segment: x0, y0, x1, y1, t0, t1, branch
  var CRACK_LV = 32;                // hairline brightness levels: one stroke per level in use
  var CRACK_REDRAW = 33;            // ms: c-front is redrawn at most 30 times a second
  var CRACK_FLASH = 600;            // ms: a new crack flashes bright for this long
  var MARK_FROM = 0.2;              // damage from which a stretch of glass shows its stress mark
  var HALF_PI = Math.PI / 2;
  var CRACK_SHADOW = 'rgba(0,0,0,0.30)', CHIP_DARK = 'rgba(0,0,0,0.55)';
  var GOLD = 'rgba(214,170,92,0.95)', GOLD_CORE = 'rgba(255,232,180,0.9)';
  var GOLD_GLOW = 'rgba(255,190,90,0.5)', NO_SHADOW = 'rgba(0,0,0,0)';
  // Every colour a redraw needs is made once, here, by brightness level.
  var HAIR = [], RIM = [], GLINT = [];
  for (var lvI = 0; lvI <= CRACK_LV; lvI++) {
    HAIR.push('rgba(255,250,240,' + (lvI / CRACK_LV).toFixed(3) + ')');
    RIM.push('rgba(255,248,235,' + (lvI / CRACK_LV).toFixed(3) + ')');
    GLINT.push('rgba(255,255,255,' + (lvI / CRACK_LV).toFixed(3) + ')');
  }

  // Each arm of a crack draws from its own random stream, so a crack that
  // grows only ever extends: the steps already drawn stay exactly where they
  // were. The generator is mulberry32; its state lives here, one stream at a
  // time, because paths are built in one go and never interleave.
  var crackRng = new Int32Array(1);
  var crackBr = new Float64Array(6 * 6);   // side branches waiting for their walk
  var crackArm = new Float64Array(2 * 6);  // the main arms' headings and lengths
  function crackStream(seed, arm, branch) {
    var h = (seed ^ Math.imul(arm + 1, 0x9E3779B1) ^ Math.imul(branch + 1, 0x85EBCA77)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x7FEB352D);
    h = Math.imul(h ^ (h >>> 15), 0x846CA68B);
    crackRng[0] = h ^ (h >>> 16);
  }
  function crackRand() {
    var t = crackRng[0] = (crackRng[0] + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** About N(0, 1): three uniforms, so a heading never jumps wildly. */
  function crackGauss() {
    return (crackRand() + crackRand() + crackRand() - 1.5) * 2;
  }

  /**
   * Walk one arm across the glass from (u, φ) with heading th (0 toward the
   * far end, −π/2 round toward the viewer), for `len` cells or `cap` steps,
   * whichever ends first, and append its segments to e in the canonical
   * frame, with how far along the crack each one starts and ends (d0 is
   * where this arm starts). Up to `spawn` side branches are noted on the
   * way; they are walked afterwards, each from its own stream. Returns the
   * distance to the arm's tip.
   */
  function crackWalk(e, g, u, phi, th, len, cap, d0, uLo, spawn, arm, branch) {
    var can = e.can, d = d0, steps = Math.floor(len / CRACK_STEP + 1e-6), k, o;
    if (steps > cap) steps = cap;
    var x0 = profile(u, g) * Math.sin(phi), y0 = u * g.HB;
    for (k = 0; k < steps; k++) {
      th += crackGauss() * CRACK_WANDER;
      var r = profile(u, g);
      if (r < 1.5) r = 1.5;
      var u1 = u + CRACK_STEP * Math.cos(th) / g.HB, p1 = phi + CRACK_STEP * Math.sin(th) / r;
      if (g.shape) {
        // another glass may end low and flat: a step is its length along the glass, not along the axis
        var sl = (profile(u + 0.002, g) - profile(u - 0.002, g)) / (0.004 * g.HB);
        u1 = u + CRACK_STEP * Math.cos(th) / (g.HB * Math.sqrt(1 + sl * sl));
      }
      // it runs out of sight round the back, under the far cap, or toward the waist
      if (u1 < uLo || u1 > 0.995 || p1 <= -HALF_PI || p1 >= HALF_PI) break;
      if (spawn > 0 && crackRand() < 0.04) {
        // a branch splits off here, at 25° to 50° either side
        var b = 6 * e.nb++, sg = crackRand() < 0.5 ? -1 : 1;
        crackBr[b] = u; crackBr[b + 1] = phi;
        crackBr[b + 2] = th + sg * (25 + 25 * crackRand()) * Math.PI / 180;
        crackBr[b + 3] = (0.3 + 0.3 * crackRand()) * (len - (d - d0));
        crackBr[b + 4] = d; crackBr[b + 5] = arm;
        spawn--;
      }
      var x1 = profile(u1, g) * Math.sin(p1), y1 = u1 * g.HB;
      o = CRACK_ST * e.n++;
      can[o] = x0; can[o + 1] = y0; can[o + 2] = x1; can[o + 3] = y1;
      can[o + 4] = d; can[o + 5] = d + CRACK_STEP; can[o + 6] = branch ? 1 : 0;
      d += CRACK_STEP; u = u1; phi = p1; x0 = x1; y0 = y1;
    }
    return d;
  }

  /**
   * How far round the glass, from the middle of its face toward the side
   * its wall segment is on, a crack in segment `seg` starts (and its stress
   * mark shows): 0.55 to 0.9 rad, always the same for the same band of glass.
   */
  var FACE_U = 0.95;                // ... and no nearer the far end than this (the collar hides the rest)
  function facePhi(seg) {
    return 0.55 + 0.35 * hash01(11 + 7 * (seg % WALL_BINS));
  }

  /**
   * Grow crack cr's path at length 2·lk cells. Its kind follows where it
   * starts: by the waist a hoop runs round the shoulder (bending pulls along
   * the axis), on the dome a star of 3 to 5 arms spreads from the impact,
   * and in between it runs along the glass toward the equator and wanders.
   * Every length is a fixed share of L, capped so the crack never passes
   * its budget, which keeps the growth smooth right up to the cap.
   */
  function crackBuild(e, cr, g, lk) {
    var L = Math.max(2, 2 * lk), u0 = cr.u > 0.995 ? 0.995 : cr.u, seed = cr.seed | 0, j, k;
    var uLo = Math.max(0.03, 4.5 / g.HB);       // never within four rows of the waist
    if (uLo > u0) uLo = u0;                      // a crack right by it never comes nearer
    var phi0 = HALF_PI - 0.06;                   // just inside the silhouette, where the hole is
    var star = u0 > 0.75, hoop = u0 < 0.3;
    if (g.shape) { star = u0 > shapeMarks(g).star; hoop = u0 < shapeMarks(g).hoop; }   // its own dome and shoulder
    crackStream(seed, -1, -1);
    var nArms = star ? 3 + Math.floor(crackRand() * 3) : 1;
    if (!hoop) {
      // Seen edge-on at the silhouette, the first 20 or 30 cells of a crack
      // hide in the glass's bright rim, so a new crack could not be seen at
      // all. Away from the waist it therefore starts on the face of the
      // glass (facePhi), clear of the collar that seats the dome: just
      // where the stress mark showed before it.
      phi0 = facePhi(cr.seg);
      if (u0 > FACE_U) u0 = FACE_U;
    }
    for (j = 0; j < nArms; j++) {
      if (star) {
        // all round, a little uneven: the star of a blow
        var sp = 360 * (j + 0.5) / nArms + (crackRand() - 0.5) * 180 / nArms;
        crackArm[2 * j] = -HALF_PI + sp * Math.PI / 180;
        crackArm[2 * j + 1] = 0.5 + 0.3 * crackRand();
      } else {
        // a hoop runs round toward the viewer; the rest runs along the glass
        // toward the equator, leaning 30° into the face (straight along it,
        // the crack would hide in the bright edge of the glass)
        crackArm[2 * j] = hoop ? -HALF_PI : (u0 < g.equator ? -0.52 : 0.52 - Math.PI);
        crackArm[2 * j + 1] = 1;
      }
    }
    var armCap = Math.floor(CRACK_MAIN / nArms), slots = nArms === 1 ? 3 : 1;
    var brCap = Math.floor((CRACK_SEGS - CRACK_MAIN) / (nArms * slots));
    var w, q, s, o, can = e.can;
    e.n = 0; e.nb = 0; e.nw = 0; e.arms = nArms;
    for (j = 0; j < nArms; j++) {
      crackStream(seed, j, -1);
      w = e.nw++;
      e.wArm[w] = j; e.wNth[w] = -1; e.ws[w] = e.n; e.wD0[w] = 0;
      e.wEnd[w] = crackWalk(e, g, u0, phi0, crackArm[2 * j],
                            Math.min(crackArm[2 * j + 1] * L, armCap * CRACK_STEP), armCap, 0, uLo, slots, j, false);
    }
    for (k = 0; k < e.nb; k++) {
      var b = 6 * k, arm = crackBr[b + 5], nth = 0;
      for (j = 0; j < k; j++) if (crackBr[6 * j + 5] === arm) nth++;
      crackStream(seed, arm, nth);
      w = e.nw++;
      e.wArm[w] = arm; e.wNth[w] = nth; e.ws[w] = e.n; e.wD0[w] = crackBr[b + 4];
      e.wEnd[w] = crackWalk(e, g, crackBr[b], crackBr[b + 1], crackBr[b + 2], crackBr[b + 3], brCap,
                            crackBr[b + 4], uLo, 0, arm, true);
    }
    e.ws[e.nw] = e.n;
    // A mend fills each segment as a share of the way to the farthest tip it
    // leads to. Every arm then fills in step, and the gold reaches a branch's
    // root before the branch itself begins to fill.
    for (w = 0; w < e.nw; w++) {
      for (s = e.ws[w]; s < e.ws[w + 1]; s++) {
        o = CRACK_ST * s;
        var norm = e.wEnd[w];
        if (e.wNth[w] < 0) {
          for (q = 0; q < e.nw; q++) {
            if (e.wNth[q] >= 0 && e.wArm[q] === e.wArm[w] && e.wEnd[q] > norm &&
                e.wD0[q] >= can[o + 5] - 1e-3) norm = e.wEnd[q];
          }
        }
        can[o + 4] /= norm; can[o + 5] /= norm;
      }
    }
  }

  /** Put crack cr's canonical path where it is on the glass now, with its chip. */
  function crackMirror(e, cr, g) {
    var sx = cr.side < 0 ? -1 : 1, sy = cr.bulb ? 1 : -1, can = e.can, seg = e.seg, k, o, q;
    for (k = 0; k < e.n; k++) {
      o = CRACK_ST * k; q = 4 * k;
      seg[q] = sx * can[o]; seg[q + 1] = sy * can[o + 1];
      seg[q + 2] = sx * can[o + 2]; seg[q + 3] = sy * can[o + 3];
    }
    var u0 = cr.u > 0.995 ? 0.995 : cr.u, ua = Math.max(0, u0 - 0.004), ub = Math.min(0.999, u0 + 0.004);
    var dr = (profile(ub, g) - profile(ua, g)) / (ub - ua);
    // the chip sits in the wall, where the lattice hole is; it lies along the glass
    e.chipX = sx * (profile(u0, g) + 0.3 * g.wall);
    e.chipY = sy * u0 * g.HB;
    e.chipN = Math.atan2(-sy * dr, sx * g.HB);    // the wall's outward normal there
    e.chipT = Math.atan2(sy * g.HB, sx * dr);     // and its run along the glass
    e.bulb = cr.bulb; e.side = cr.side;
  }

  /** The renderer's damage state, made the first time something needs it. */
  function crackState(r) {
    if (r._dmg) return r._dmg;
    r._dmg = {
      paths: [],                  // cached paths, one per crack on the glass
      cur: [],                    // ... and the ones in use in the drawing under way
      rev: -1,                    // sim.crackRev as last drawn
      rot: r.sim.angle + r.sim.tilt,   // the glass against the room, as last drawn
      lastT: -1e9, now: 0,        // when c-front was last redrawn, and the time it drew
      dirty: false,               // the mend has moved since
      mend: 0,                    // gold run along the open cracks, 0 … 1
      animEnd: 0,                 // when the last flash ends; 0 once its clean frame is drawn
      aRec: [null, null, null, null],     // flashes: the crack,
      aKind: new Uint8Array(4),           //   1 cracking, 2 breaking through,
      aT0: new Float64Array(4),           //   and when it began
      aN: 0,
      warnT0: 0, warnT1: 0,                       // a creak: the stress mark brightens for a moment
      markQ: 0,                                   // the stress mark as last drawn (0: none)
      info: { bulb: 0, side: 1, u: 0 },
      lev: new Uint8Array(4 * CRACK_SEGS),        // brightness level per hairline segment
      cnt: new Uint16Array(CRACK_LV + 1)
    };
    return r._dmg;
  }

  /** The cache slot for crack cr (a crack that is gone gives up its slot). */
  function crackEntry(st, cracks, cr) {
    var list = st.paths, k, e;
    for (k = 0; k < list.length; k++) if (list[k].rec === cr) return list[k];
    for (k = 0; k < list.length; k++) {
      e = list[k];
      if (cracks.indexOf(e.rec) < 0) { e.rec = cr; e.lk = -1; return e; }
    }
    e = {
      rec: cr, id: -1, seed: 0, lk: -1, w: -1, bulb: -1, side: 0,
      n: 0, nb: 0, arms: 0,
      // walkers (arms and branches): first segment, arm, branch (−1 main), start and tip distance
      nw: 0, ws: new Int16Array(16), wArm: new Int8Array(16), wNth: new Int8Array(16),
      wD0: new Float32Array(16), wEnd: new Float32Array(16),
      can: new Float32Array(CRACK_ST * CRACK_SEGS), seg: new Float32Array(4 * CRACK_SEGS),
      chipX: 0, chipY: 0, chipN: 0, chipT: 0
    };
    list.push(e);
    return e;
  }

  /** True when crack cr's drawing is out of date: new, longer, wider, or moved by a flip. */
  function crackStale(st, cr) {
    var list = st.paths;
    for (var k = 0; k < list.length; k++) {
      var e = list[k];
      if (e.rec !== cr) continue;
      return e.lk !== Math.floor(cr.L / 2) || e.w !== cr.w || e.bulb !== cr.bulb || e.side !== cr.side || e.seed !== cr.seed;
    }
    return true;
  }

  /**
   * The stress mark to draw, as a whole number that changes whenever the
   * picture of it should: 0 for none (no stretch of uncracked glass holds
   * MARK_FROM of damage), else its place and its strength in 24 steps.
   */
  function markLevel(sim) {
    var D = sim.dMax, s = sim.warnSeg;
    if (!(D >= MARK_FROM) || !(s >= 0)) return 0;
    if (D > 1) D = 1;
    return 1 + Math.floor((D - MARK_FROM) / (1 - MARK_FROM) * 24) + 32 * s;
  }

  /** How far through its flash of `kind` crack cr is: 1 at the start, 0 when done. */
  function crackFlash(st, cr, kind, now) {
    var f = 0;
    for (var a = 0; a < 4; a++) {
      if (st.aRec[a] !== cr || st.aKind[a] !== kind) continue;
      var x = (now - st.aT0[a]) / (kind === 1 ? CRACK_FLASH : 120);
      if (x >= 0 && x < 1) { x = kind === 1 ? (1 - x) * (1 - x) : 1 - x; if (x > f) f = x; }
    }
    return f;
  }

  Renderer.prototype.animating = false;   // a crack, a creak or a breach is flashing
  Renderer.prototype.reduced = false;     // Reduce Motion (set by the app): no flashes

  /**
   * The drawn path of crack record `cr`: {seg, n, chipX, chipY, chipN, chipT}.
   * seg holds the segments' endpoints (x0, y0, x1, y1, …) in vessel-centred
   * cells, which is c-front's _ctx() space, and n says how many there are.
   * It is a fixed function of the crack's seed and length, cached per crack
   * by (id, seed, ⌊L/2⌋, w), and only re-mirrored when a flip moves it.
   */
  Renderer.prototype._crackPath = function (cr) {
    var sim = this.sim, st = crackState(this), e = crackEntry(st, sim.cracks || [], cr);
    var lk = Math.floor(cr.L / 2);
    if (e.id !== cr.id || e.seed !== cr.seed || e.lk !== lk || e.w !== cr.w) {
      crackBuild(e, cr, sim.geo, lk);
      e.id = cr.id; e.seed = cr.seed; e.lk = lk; e.w = cr.w; e.bulb = -1;
    }
    if (e.bulb !== cr.bulb || e.side !== cr.side) crackMirror(e, cr, sim.geo);
    return e;
  };

  /**
   * Draw the glass's cracks in cells (c-front's frame), before the caps.
   * A whole glass draws nothing and leaves the layer exactly as it was.
   * Open cracks are a fine silver hairline over a soft shadow, each segment
   * as bright as it faces the key light: the room stays put while the glass
   * turns, so the crack sparkles as it moves. A breach is a dark chip where
   * the glass's bright edge is broken, with a bright conchoidal rim. Mended
   * cracks are gold, and so is the run of a mend in progress.
   */
  Renderer.prototype._drawCracks = function (ctx) {
    var sim = this.sim, cracks = sim.cracks, n = cracks ? cracks.length : 0, st = this._dmg;
    var mark = markLevel(sim);
    if (!st && !n && !mark) return;
    st = crackState(this);
    st.rev = sim.crackRev;
    st.markQ = mark;
    var now = st.now, warn = st.warnT1 > now;
    if (!n && !mark) return;
    var rot = st.rot, lev = st.lev, cnt = st.cnt, cur = st.cur, k, s, o, e, cr, any, base, lv, sn, f;
    var total = 0;
    for (k = 0; k < n; k++) { cur[k] = this._crackPath(cracks[k]); total += cur[k].n; }
    if (lev.length < total) lev = st.lev = new Uint8Array(total);
    ctx.save();

    // a soft shadow under every open crack (one stroke, so crossings never darken twice)
    ctx.beginPath();
    any = false;
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (cr.sealed) continue;
      for (s = 0; s < e.n; s++) {
        o = 4 * s;
        ctx.moveTo(e.seg[o], e.seg[o + 1]); ctx.lineTo(e.seg[o + 2], e.seg[o + 3]);
        any = true;
      }
    }
    if (any) { ctx.strokeStyle = CRACK_SHADOW; ctx.lineWidth = 1.6; ctx.stroke(); }

    // the hairline: each segment glints as it faces the key light, |sin(a + rot − 0.9)|^6
    cnt.fill(0);
    base = 0;
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (cr.sealed) continue;
      var flash = crackFlash(st, cr, 1, now);   // the moment it cracks it flashes bright
      for (s = 0; s < e.n; s++) {
        o = 4 * s;
        sn = Math.sin(Math.atan2(e.seg[o + 3] - e.seg[o + 1], e.seg[o + 2] - e.seg[o]) + rot - 0.9);
        sn *= sn;
        var al = 0.40 + 0.55 * sn * sn * sn;
        if (e.can[CRACK_ST * s + 6]) al *= 0.8;   // side branches are finer
        if (flash > 0) al += (1 - al) * flash;
        lv = (al * CRACK_LV + 0.5) | 0;
        lev[base + s] = lv; cnt[lv]++;
      }
      base += e.n;
    }
    ctx.lineWidth = 0.7;
    for (lv = 0; lv <= CRACK_LV; lv++) {
      if (!cnt[lv]) continue;
      ctx.beginPath();
      base = 0;
      for (k = 0; k < n; k++) {
        cr = cracks[k]; e = cur[k];
        if (cr.sealed) continue;
        for (s = 0; s < e.n; s++) {
          if (lev[base + s] !== lv) continue;
          o = 4 * s;
          ctx.moveTo(e.seg[o], e.seg[o + 1]); ctx.lineTo(e.seg[o + 2], e.seg[o + 3]);
        }
        base += e.n;
      }
      ctx.strokeStyle = HAIR[lv];
      ctx.stroke();
    }

    // the chip of a breach: dark where the sand gets out, its inner edge bright
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (cr.sealed || !(cr.w > 0)) continue;
      var w = cr.w > 3 ? 3 : cr.w, ra = 0.6 + 0.4 * w, rb = 1.0 + 0.5 * w;
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ra, rb, e.chipN, 0, 2 * Math.PI);
      ctx.fillStyle = CHIP_DARK;
      ctx.fill();
      sn = Math.sin(e.chipT + rot - 0.9);
      sn *= sn;
      var rim = 0.5 + 0.3 * sn * sn * sn;
      f = crackFlash(st, cr, 2, now);          // just broken through: the rim flares
      if (f > 0) rim += (1 - rim) * f;
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ra, rb, e.chipN, HALF_PI, 3 * HALF_PI);
      ctx.strokeStyle = RIM[(rim * CRACK_LV + 0.5) | 0];
      ctx.lineWidth = 0.25;
      ctx.stroke();
    }

    // gold: mended cracks whole, and a mend in progress from the origin out
    // along every arm (the same share of the way to each tip)
    var p = st.mend;
    ctx.beginPath();
    any = false;
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      var lim = cr.sealed ? 2 : p;
      if (!(lim > 0)) continue;
      for (s = 0; s < e.n; s++) {
        var c = CRACK_ST * s, t0 = e.can[c + 4], t1 = e.can[c + 5];
        if (t0 >= lim) continue;
        o = 4 * s;
        var x0 = e.seg[o], y0 = e.seg[o + 1], x1 = e.seg[o + 2], y1 = e.seg[o + 3];
        if (t1 > lim) { f = (lim - t0) / (t1 - t0); x1 = x0 + (x1 - x0) * f; y1 = y0 + (y1 - y0) * f; }
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        any = true;
      }
    }
    if (any) {
      ctx.shadowColor = GOLD_GLOW; ctx.shadowBlur = 4 * this.dpr;    // blur is in canvas px
      ctx.strokeStyle = GOLD; ctx.lineWidth = 0.75; ctx.stroke();
      ctx.shadowBlur = 0; ctx.shadowColor = NO_SHADOW;
      ctx.strokeStyle = GOLD_CORE; ctx.lineWidth = 0.3; ctx.stroke();
    }
    for (k = 0; k < n; k++) {
      cr = cracks[k]; e = cur[k];
      if (!(cr.w > 0)) continue;
      f = cr.sealed ? 1 : Math.min(1, p * 8);     // the gold reaches the chip first
      if (!(f > 0)) continue;
      var wg = cr.w > 3 ? 3 : cr.w, ga = 0.6 + 0.4 * wg, gb = 1.0 + 0.5 * wg;
      ctx.globalAlpha = f;
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ga, gb, e.chipN, 0, 2 * Math.PI);
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(e.chipX, e.chipY, ga, gb, e.chipN, HALF_PI, 3 * HALF_PI);
      ctx.strokeStyle = GOLD_CORE; ctx.lineWidth = 0.25;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The stress mark: where the glass is most loaded and has not cracked, a
    // pale bloom on the glass with three craze lines, growing with the damage
    // (about 5 to 20 px across) and fading as it heals. A creak brightens it
    // for a moment.
    if (mark) {
      var info = sim.segInfo(sim.warnSeg, st.info), D = sim.dMax > 1 ? 1 : sim.dMax;
      var mt = (D - MARK_FROM) / (1 - MARK_FROM), g = sim.geo;
      // it shows where a crack would start: on the face of the glass, or (by the waist) at its edge
      var mu = info.u, mphi = HALF_PI - 0.06;
      if (mu >= 0.3) { mphi = facePhi(sim.warnSeg); if (mu > FACE_U) mu = FACE_U; }
      var mx = info.side * profile(mu, g) * Math.sin(mphi), my = (info.bulb ? 1 : -1) * mu * g.HB;
      var mr = 3 + 6.2 * mt;                                 // cells: its radius
      var ma = (0.55 + 0.40 * mt) * (mt < 0.06 ? mt / 0.06 : 1);
      if (warn) ma += (1 - ma) * 0.7 * (1 - (now - st.warnT0) / 300);
      ctx.save();
      tracePath(ctx, g, g.wall);
      ctx.clip();
      // (a soft shade round it first, so it reads on sand as well as on dark glass)
      var mg = ctx.createRadialGradient(mx, my, 0.5 * mr, mx, my, 1.5 * mr);
      mg.addColorStop(0, 'rgba(0,0,0,' + (0.32 * ma).toFixed(3) + ')');
      mg.addColorStop(1, NO_SHADOW);
      ctx.fillStyle = mg;
      ctx.fillRect(mx - 1.5 * mr, my - 1.5 * mr, 3 * mr, 3 * mr);
      mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
      mg.addColorStop(0, GLINT[(ma * CRACK_LV + 0.5) | 0]);
      mg.addColorStop(0.5, GLINT[(ma * 0.5 * CRACK_LV + 0.5) | 0]);
      mg.addColorStop(1, GLINT[0]);
      ctx.fillStyle = mg;
      ctx.fillRect(mx - mr, my - mr, 2 * mr, 2 * mr);
      // three craze lines from its heart, always the same for the same stretch
      ctx.beginPath();
      for (k = 0; k < 3; k++) {
        var ca = (k + hash01(sim.warnSeg * 7 + k)) * 2.094;
        var cl = mr * (0.5 + 0.4 * hash01(sim.warnSeg * 13 + k));
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + cl * Math.cos(ca), my + cl * Math.sin(ca));
      }
      ctx.strokeStyle = CRACK_SHADOW; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.strokeStyle = GLINT[(ma * CRACK_LV + 0.5) | 0]; ctx.lineWidth = 0.45; ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  };

  /**
   * Keep the cracks on c-front in step with the glass. Called once a frame,
   * after drawSand, with rot = sim.angle + sim.tilt. Returns true when it
   * redrew. A whole glass with nothing flashing costs nothing and never
   * touches the canvas. Otherwise c-front is redrawn at once when
   * sim.crackRev changes (a crack appears, breaks through, is mended, moves
   * with a flip or goes with a reset), and at most 30 times a second when a
   * crack has grown, the glass has turned more than 0.03 rad against the
   * room, the mend has moved, or something flashes; and once more as a
   * flash ends.
   */
  Renderer.prototype.syncDamage = function (rot, nowMs) {
    var sim = this.sim, n = sim.cracks ? sim.cracks.length : 0, st = this._dmg, k;
    var mark = markLevel(sim);
    if (!st) {
      if (!n && !mark) return false;
      st = crackState(this);
    }
    if (!this.cssW) return false;               // not laid out yet: layout() draws everything
    rot = +rot || 0;
    nowMs = +nowMs || 0;
    if (this.reduced && st.animEnd > nowMs) st.animEnd = nowMs;   // Reduce Motion: stop flashing now
    var running = st.animEnd > nowMs, ending = st.animEnd > 0 && !running;
    if (sim.crackRev === st.rev) {
      if (!n && !running && !ending && mark === st.markQ) { this.animating = false; return false; }
      var due = nowMs - st.lastT >= CRACK_REDRAW || nowMs < st.lastT;
      var changed = running || ending || mark !== st.markQ || (n > 0 && (st.dirty || Math.abs(rot - st.rot) > 0.03));
      for (k = 0; k < n && due && !changed; k++) changed = crackStale(st, sim.cracks[k]);
      if (!due || !changed) {
        this.animating = running || ending;
        return false;
      }
    }
    st.rot = rot; st.now = nowMs; st.lastT = nowMs; st.dirty = false;
    if (ending) st.animEnd = 0;                  // this is the clean frame after the flash
    this.animating = running;
    this._drawFront();
    return true;
  };

  /**
   * A damage event from sim.frame (type is a Sim.DMG value; k the crack's
   * index, −1 for WARN; level the creak level 1–4). Starts its flash: the
   * stress mark brightening for 300 ms for WARN, the hairline flaring
   * bright over 600 ms for CRACK, and a 120 ms brighter chip rim for
   * BREACH and WIDEN. Reduce Motion skips them all; the change itself is
   * drawn on the next syncDamage.
   */
  Renderer.prototype.damageEvent = function (type, k, level, nowMs) {
    var sim = this.sim, D = Sim.DMG, st = crackState(this), dur;
    st.dirty = true;
    if (this.reduced) return;
    nowMs = +nowMs || 0;
    if (type === D.WARN) {
      if (!markLevel(sim)) return;
      st.warnT0 = nowMs; st.warnT1 = nowMs + 300;
      dur = 300;
    } else if (type === D.CRACK || type === D.BREACH || type === D.WIDEN) {
      var cr = sim.cracks ? sim.cracks[k] : null;
      if (!cr) return;
      var a = st.aN;
      st.aN = (a + 1) & 3;
      st.aRec[a] = cr;
      st.aKind[a] = type === D.CRACK ? 1 : 2;
      st.aT0[a] = nowMs;
      dur = type === D.CRACK ? CRACK_FLASH : 120;
    } else {
      return;
    }
    if (nowMs + dur > st.animEnd) st.animEnd = nowMs + dur;
    this.animating = true;
  };

  /**
   * How far a mend has run, 0 … 1: gold flows along every open crack from
   * its origin to that share of the way to each tip. Lower it and the gold
   * recedes; 0 clears it. Drawn on the next syncDamage.
   */
  Renderer.prototype.setMend = function (p) {
    p = +p;
    if (!(p > 0)) p = 0; else if (p > 1) p = 1;
    var st = this._dmg;
    if (!st) {
      if (!p) return;
      st = crackState(this);
    }
    if (p === st.mend) return;
    st.mend = p;
    st.dirty = true;
  };

  /**
   * Where crack k's chip (its hole) is, in lattice cells (x right, y down,
   * from the lattice's top-left corner), as the glass stands now: for the
   * app's escape mapping and the sound's pan. Fills `out`; null for no crack.
   */
  Renderer.prototype.chipVessel = function (k, out) {
    var sim = this.sim, cr = sim.cracks ? sim.cracks[k] : null;
    if (!cr) return null;
    var g = sim.geo, u = cr.u > 0.995 ? 0.995 : cr.u;
    out = out || {};
    out.x = g.cx + (cr.side < 0 ? -1 : 1) * (profile(u, g) + 0.3 * g.wall);
    out.y = g.cy + (cr.bulb ? 1 : -1) * u * g.HB;
    return out;
  };


  _.loaded = 'glass/cracks.js';
})(typeof window !== 'undefined' ? window : globalThis);
