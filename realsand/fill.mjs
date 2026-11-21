/*
 * Hourglass sand engine: filling the glass with material points.
 *
 * Points on a jittered lattice, PPC x PPC to a solver cell, wherever a shape
 * and the glass both hold; the lab's fills (a heaped top bulb on the closed
 * neck, a bed settled flat in the lower bulb, a column standing in it); and the
 * particle records the solver takes, each with its grain's colour seed in
 * color.x. No module state: the glass and the material come in as arguments.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */
import { sampleField } from './glass.mjs';
import { PARTICLE_WORDS } from './solver.mjs';

/** Material points per solver cell, each axis. */
export const PPC = 2;

/** A small fast generator of numbers in [0, 1) (xorshift32), the same sequence for the same seed. */
export function rand32(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Material points (x0, y0, x1, y1, ...) on a jittered lattice wherever inside(x, y) holds in box [x0, y0, x1, y1], inside the glass. */
export function lattice(glass, inside, box, seed = 7) {
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

/**
 * Points for a fill of the glass: 'top' (the upper bulb, heaped, on the closed
 * neck), 'lower' (settled flat in the lower bulb), 'column' (a column standing in
 * the lower bulb). opts.points: the number of points ('top' and 'lower' are
 * filled to it exactly when the bulb holds that many, trimmed from the top down
 * so that the surface stays smooth); opts.width, opts.height: the column's, in
 * cells (default 0.6 and 0.4 of the bulb's half-width).
 */
export function makeFill(glass, kind, opts = {}) {
  const g = glass, target = opts.points;
  let pts;
  if (kind === 'column') {
    const w = opts.width ?? 0.6 * g.Rc, h = opts.height ?? 0.4 * g.Rc, yb = g.cy - g.HBc;
    pts = lattice(g, (x, y) => Math.abs(x - g.cx) < w / 2 && y < yb + h && y < g.cy - 1, [g.cx - w / 2, yb, g.cx + w / 2, yb + h]);
  } else {
    const top = kind !== 'lower';
    // heaped: a low cone (22 degrees) on the level L above the neck
    const heap = L => x => Math.max(0, g.half(L) - Math.abs(x - g.cx)) * Math.tan(22 * Math.PI / 180);
    const build = L => top
      ? lattice(g, (x, y) => y > g.cy + 0.6 && y < g.cy + L + heap(L)(x), [g.cx - g.Rc, g.cy, g.cx + g.Rc, Math.min(g.cy + L + 0.5 * g.Rc, g.cy + g.HBc)])
      : lattice(g, (x, y) => y < g.cy - 0.6 && y < g.cy - g.HBc + L, [g.cx - g.Rc, g.cy - g.HBc, g.cx + g.Rc, Math.min(g.cy - g.HBc + L, g.cy)]);
    let lo = 0, hi = g.HBc, best = null;
    for (let k = 0; k < 22; k++) {
      const L = (lo + hi) / 2, p = build(L);
      if (p.length / 2 < target) lo = L; else { hi = L; best = p; }
    }
    pts = best || build(hi);
    // trim to the target from the top down, so the surface stays smooth
    if (pts.length / 2 > target) {
      const idx = [...Array(pts.length / 2).keys()].sort((p, q) => pts[2 * p + 1] - pts[2 * q + 1]);
      const keep = idx.slice(0, target);
      pts = keep.flatMap(i => [pts[2 * i], pts[2 * i + 1]]);
    }
  }
  return pts;
}

/**
 * The lab's colour seed for the point at index i: the palette entry the grain
 * shader picks for that instance (grains.wgsl: hash(i * 2654435761 + 17) & 255),
 * so that a shader reading the seed from color.x draws the lab's bed exactly as
 * the one that hashes the index.
 */
export function indexSeed(i) {
  let x = (Math.imul(i, 2654435761) + 17) >>> 0;
  x = (Math.imul(x, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) & 255;
}

/**
 * The particle records (PARTICLE_WORDS floats each) for points pts (x0, y0, x1,
 * y1, ...) of a material m (its parameters: MATERIALS[id], with any override):
 * at rest, undeformed, a PPC x PPC share of a cell each. color.x (word 20) holds
 * the grain's colour seed, an integer (exact in a float below 2^24): seeds[i]
 * when given (the app's seed for the grain at that place), else indexSeed(i).
 * Nothing in the solver reads it; only the drawing may.
 */
export function packParticles(pts, m, seeds) {
  const n = pts.length / 2, data = new Float32Array(n * PARTICLE_WORDS);
  for (let i = 0; i < n; i++) {
    const o = i * PARTICLE_WORDS;
    data[o] = pts[2 * i]; data[o + 1] = pts[2 * i + 1];
    data[o + 4] = 1; data[o + 7] = 1;                         // F = I
    data[o + 12] = 1;                                          // liquid density
    data[o + 15] = 1;                                          // enabled
    data[o + 17] = 1 / (PPC * PPC); data[o + 16] = data[o + 17] * m.density;
    data[o + 18] = m.model;
    data[o + 20] = seeds ? seeds[i] : indexSeed(i);
  }
  return data;
}
