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
  // (a target that is not a number would quietly give a nearly empty bed)
  if (kind !== 'column' && !(Number.isFinite(target) && target >= 0)) throw new Error('makeFill: points must be a number of points, not ' + target);
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

/** physics.js: a lattice cell at or above this holds a grain (REST, MOVE). */
const CPU_SAND = 2;

/**
 * Points for a fill of the glass from the app's own sand (design 7.1): the CPU Sim's
 * lattice, at rest, gives the bed's shape and each grain's colour seed. sim: the CPU Sim
 * (W, H, cell, seed, gateY); glass: buildGlass's for the same glass (its warp maps a grid
 * point to where it is drawn, and so to the app's cell under it). o: { top, bottom } the
 * points wanted above and below the counting line; down: the field's direction on the grid
 * ([0, -1], the glass upright), for what is low; seed: the jitter's.
 *
 * Each solver cell holds PPC x PPC jittered points (as lattice()); a point is kept where the
 * app cell under its drawn position holds sand in its own bulb (top above the gate row, the
 * lower bulb below it), and takes that grain's seed. Then each bulb is cut to its count from
 * its surface down (the highest go), or made up at its surface (the lowest free points
 * inside the glass, each with the seed of the nearest grain of its bulb, or a random one
 * when the bulb has none). Points keep 0.6 cell from the counting line, as makeFill's do.
 * Returns { pts (x0, y0, ...: the top bulb's first), seeds, top, bottom }: top and bottom
 * the points made, fewer than asked only when a bulb cannot hold them.
 */
export function fromLattice(sim, glass, o = {}) {
  const g = glass, s = g.s, cx = g.cx, cy = g.cy, warp = g.warp;
  const Wa = sim.W, Ha = sim.H, gate = sim.gateY, cell = sim.cell, sd = sim.seed;
  const ax = Wa / 2, ay = Ha / 2, r = rand32(o.seed || 7);
  const down = o.down || [0, -1];
  const want = [Math.max(0, Math.floor(o.top || 0)), Math.max(0, Math.floor(o.bottom || 0))];
  // per bulb: x, y, the app cell under the point holding sand there (-1: none), height
  const cand = [[], []];
  for (let j = 0; j < g.H; j++) {
    const k = warp ? warp[j] : 1;
    for (let i = 0; i < g.W; i++) for (let b = 0; b < PPC; b++) for (let a = 0; a < PPC; a++) {
      const x = i + (a + 0.5 + (r() - 0.5) * 0.3) / PPC, y = j + (b + 0.5 + (r() - 0.5) * 0.3) / PPC;
      const bulb = y > cy + 0.6 ? 0 : y < cy - 0.6 ? 1 : -1;
      if (bulb < 0 || sampleField(g, x, y)[2] <= 0.45) continue;
      const xa = Math.floor(ax + (x - cx) * k / s), ya = Math.floor(ay - (y - cy) / s);
      let c = -1;
      if (xa >= 0 && xa < Wa && ya >= 0 && ya < Ha && (bulb === 0 ? ya < gate : ya > gate)) {
        const idx = ya * Wa + xa;
        if (cell[idx] >= CPU_SAND) c = idx;
      }
      cand[bulb].push({ x, y, c, h: -(x * down[0] + y * down[1]) });
    }
  }
  const out = [[], []];
  for (let bulb = 0; bulb < 2; bulb++) {
    const n = want[bulb], all = cand[bulb];
    const full = all.filter(p => p.c >= 0).sort((p, q) => p.h - q.h);
    let keep = full.slice(0, n);
    if (keep.length < n) {
      const free = all.filter(p => p.c < 0).sort((p, q) => p.h - q.h).slice(0, n - keep.length);
      for (const p of free) p.c = nearestSand(sim, ax + (p.x - cx) / s, ay - (p.y - cy) / s, bulb);
      keep = keep.concat(free);
    }
    out[bulb] = keep;
  }
  const n = out[0].length + out[1].length, pts = new Array(2 * n), seeds = new Array(n);
  let m = 0;
  for (const list of out) for (const p of list) {
    pts[2 * m] = p.x; pts[2 * m + 1] = p.y;
    seeds[m] = p.c >= 0 ? sd[p.c] : (r() * 256) | 0;
    m++;
  }
  return { pts, seeds, top: out[0].length, bottom: out[1].length };
}

/** The app cell of the nearest grain to (x, y) (app cells) in a bulb (0 top), within 12 cells; -1: none. */
function nearestSand(sim, x, y, bulb) {
  const Wa = sim.W, Ha = sim.H, gate = sim.gateY, cell = sim.cell, x0 = Math.floor(x), y0 = Math.floor(y);
  for (let d = 0; d <= 12; d++) {
    let best = -1, bd = Infinity;
    for (let v = -d; v <= d; v++) for (let u = -d; u <= d; u++) {
      if (Math.max(Math.abs(u), Math.abs(v)) !== d) continue;
      const xi = x0 + u, yi = y0 + v;
      if (xi < 0 || xi >= Wa || yi < 0 || yi >= Ha || (bulb === 0 ? yi >= gate : yi <= gate)) continue;
      const idx = yi * Wa + xi;
      if (cell[idx] < CPU_SAND) continue;
      const e = u * u + v * v;
      if (e < bd) { bd = e; best = idx; }
    }
    if (best >= 0) return best;
  }
  return -1;
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
