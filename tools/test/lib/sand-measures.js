/*
 * Measures of the sand lab's beds (lab-sand.test.js cases 10 to 18), from point positions.
 * Copied from this round's scoreboard (score.js): the same code, so the test's numbers and
 * the scoreboard's agree. Positions are [x0, y0, x1, y1, ...], relative to the neck, in cells,
 * y up (window.__lab.positions()); particles() rows are [x, y, vx, vy, extra].
 */
'use strict';
/* ------------------------------------------------------------------ small maths */
const sorted = a => Float64Array.from(a).sort();
const median = a => { if (!a.length) return NaN; const s = sorted(a), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, q) => { if (!a.length) return NaN; const s = sorted(a), h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); };
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
const fin = v => typeof v === 'number' && isFinite(v);
const r2 = v => fin(v) ? Math.round(v * 100) / 100 : (v === undefined ? null : v);
const r3 = v => fin(v) ? Math.round(v * 1000) / 1000 : (v === undefined ? null : v);
const deg = Math.PI / 180;
/** Screen gravity (x right, y down, g units) leaned right by a degrees: the sand goes right. */
const lean = a => [Math.sin(a * deg), Math.cos(a * deg)];
/** "Up" in the glass's grid frame (x right, y up) for a screen gravity [gx, gy]. */
const upOf = g => { const m = Math.hypot(g[0], g[1]) || 1; return [-g[0] / m, g[1] / m]; };
const maxOf = a => { const b = a.filter(fin); return b.length ? Math.max(...b) : NaN; };
/** heapAngle's steeper flank and mean, NaN when no flank could be fitted (it returns 0 then). */
const steepOf = h => fin(h.left) || fin(h.right) ? h.steepest : NaN;
const meanOf = h => fin(h.left) || fin(h.right) ? h.mean : NaN;
const xy = P => { const n = P.length / 5, p = new Array(2 * n); for (let i = 0; i < n; i++) { p[2 * i] = P[5 * i]; p[2 * i + 1] = P[5 * i + 1]; } return p; };

/* ------------------------------------------------------------------ measures (positions relative to the neck, cells, y up) */
/** The physics reviewer's packing (rp/measure.js): median points per cell² within r = 2 among interior
 *  points (count >= 0.6 x the 90th percentile); area: occupied 1 x 1 cells; top: highest point within 3 cells of the axis. */
function packing(p, only) {
  const n = p.length / 2, r = 2, rr = r * r, idx = [];
  for (let i = 0; i < n; i++) if (!only || only(p[2 * i], p[2 * i + 1])) idx.push(i);
  const grid = new Map(), key = (x, y) => x + ',' + y;
  for (const i of idx) { const k = key(Math.floor(p[2 * i] / r), Math.floor(p[2 * i + 1] / r)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const c = [];
  for (const i of idx) {
    const x = p[2 * i], y = p[2 * i + 1], gx = Math.floor(x / r), gy = Math.floor(y / r);
    let cnt = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = grid.get(key(gx + a, gy + b)); if (!L) continue;
      for (const j of L) { const dx = p[2 * j] - x, dy = p[2 * j + 1] - y; if (dx * dx + dy * dy <= rr) cnt++; }
    }
    c.push((cnt - 1) / (Math.PI * rr));
  }
  const hi = pct(c, 0.9), inner = c.filter(v => v >= 0.6 * hi);
  const occ = new Set(); let top = -1e9;
  for (const i of idx) { occ.add(key(Math.floor(p[2 * i]), Math.floor(p[2 * i + 1]))); if (Math.abs(p[2 * i]) < 3) top = Math.max(top, p[2 * i + 1]); }
  return { packing: median(inner), area: occ.size, top, n: idx.length };
}

/** The bed's surface in a frame: bins `binW` wide across "up"; per bin the top, the second-highest
 *  point (top2, the surface: one grain in the air is not it) and the lowest. */
function profile(p, up, binW = 2, sel) {
  const ac = [up[1], -up[0]], n = p.length / 2;
  const u = new Float64Array(n), s = new Float64Array(n), b = new Int32Array(n), keep = new Uint8Array(n), bins = new Map();
  for (let i = 0; i < n; i++) {
    const x = p[2 * i], y = p[2 * i + 1];
    if (sel && !sel(x, y, i)) continue;
    keep[i] = 1;
    u[i] = x * up[0] + y * up[1]; s[i] = x * ac[0] + y * ac[1];
    const k = b[i] = Math.floor(s[i] / binW);
    let e = bins.get(k); if (!e) bins.set(k, e = { n: 0, top: -Infinity, top2: -Infinity, bot: Infinity });
    e.n++;
    if (u[i] > e.top) { e.top2 = e.top; e.top = u[i]; } else if (u[i] > e.top2) e.top2 = u[i];
    if (u[i] < e.bot) e.bot = u[i];
  }
  for (const e of bins.values()) { e.surf = e.top2 > -Infinity ? e.top2 : e.top; e.Z = e.surf - e.bot; }
  return { u, s, b, keep, bins, n, binW };
}
/** Depth of each point below its bin's surface, and as a share of the bin's depth (bins with >= minN points). */
function depths(pr, minN = 6) {
  const z = new Float64Array(pr.n).fill(NaN), rel = new Float64Array(pr.n).fill(NaN);
  for (let i = 0; i < pr.n; i++) if (pr.keep[i]) {
    const e = pr.bins.get(pr.b[i]); if (e.n < minN) continue;
    z[i] = Math.max(0, e.surf - pr.u[i]);
    if (e.Z > 1) rel[i] = Math.min(1, z[i] / e.Z);
  }
  return { z, rel };
}
/** The surface's slope to the frame's horizontal, a line fitted to the middle 70 % of it (bins 1 cell, >= 3 points). */
function faceFit(p, up, sel) {
  const pr = profile(p, up, 1, sel);
  const pts = [...pr.bins.entries()].filter(([, e]) => e.n >= 3).map(([k, e]) => ({ a: k + 0.5, b: e.surf })).sort((p1, p2) => p1.a - p2.a);
  if (pts.length < 8) return NaN;
  const a0 = pts[0].a, a1 = pts[pts.length - 1].a, lo = a0 + 0.15 * (a1 - a0), hi = a0 + 0.85 * (a1 - a0);
  const q = pts.filter(t => t.a >= lo && t.a <= hi);
  const ma = mean(q.map(t => t.a)), mb = mean(q.map(t => t.b));
  let num = 0, den = 0; for (const t of q) { num += (t.a - ma) * (t.b - mb); den += (t.a - ma) ** 2; }
  return den > 0 ? Math.atan(Math.abs(num / den)) / deg : NaN;
}
/** The mean height of the bed's surface (upright frame), over the middle 60 % of its width. */
function meanSurface(p, sel) {
  const pr = profile(p, [0, 1], 1, sel);
  const bins = [...pr.bins.entries()].filter(([, e]) => e.n >= 3).sort((a, b) => a[0] - b[0]);
  if (bins.length < 4) return NaN;
  const k0 = bins[0][0], k1 = bins[bins.length - 1][0], lo = k0 + 0.2 * (k1 - k0), hi = k0 + 0.8 * (k1 - k0);
  return mean(bins.filter(([k]) => k >= lo && k <= hi).map(([, e]) => e.surf));
}

/**
 * Voids and tears: points per 1 x 1 cell over the bed's interior. The bed's outline is the occupied
 * cells closed by a disc of radius 2 (gaps up to about 4 cells are inside it, so a fissure open to
 * the surface counts), with enclosed holes filled; the interior is that outline eroded by 2 cells
 * (so the ragged edge, a thin spray and a falling thread are not judged). Returns the share of
 * interior cells that are empty, that hold at most one point (a quarter of the fill's 4), and the
 * spread of points per cell (coefficient of variation).
 */
function voids(p, sel) {
  const n = p.length / 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = p[2 * i], y = p[2 * i + 1]; if (sel && !sel(x, y)) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!(x1 > x0)) return null;
  const PAD = 6, X0 = Math.floor(x0) - PAD, Y0 = Math.floor(y0) - PAD, W = Math.floor(x1) - X0 + PAD + 1, H = Math.floor(y1) - Y0 + PAD + 1;
  const cnt = new Uint16Array(W * H);
  for (let i = 0; i < n; i++) { const x = p[2 * i], y = p[2 * i + 1]; if (sel && !sel(x, y)) continue; cnt[(Math.floor(y) - Y0) * W + Math.floor(x) - X0]++; }
  const disc = []; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (a * a + b * b <= 5) disc.push([a, b]);
  const morph = (src, dil) => {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = dil ? 0 : 1;
      for (const [a, b] of disc) {
        const xx = x + a, yy = y + b, s = xx >= 0 && yy >= 0 && xx < W && yy < H ? src[yy * W + xx] : 0;
        if (dil ? s : !s) { v = dil ? 1 : 0; break; }
      }
      out[y * W + x] = v;
    }
    return out;
  };
  const occ = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) occ[i] = cnt[i] > 0 ? 1 : 0;
  const closed = morph(morph(occ, true), false);
  // fill enclosed holes: flood the outside from the border
  const outside = new Uint8Array(W * H), stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
  for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(), i = y * W + x;
    if (x < 0 || y < 0 || x >= W || y >= H || outside[i] || closed[i]) continue;
    outside[i] = 1; stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  const region = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) region[i] = outside[i] ? 0 : 1;
  const interior = morph(region, false);
  const vals = []; let empty = 0, low = 0;
  for (let i = 0; i < W * H; i++) if (interior[i]) { const c = cnt[i]; vals.push(c); if (c === 0) empty++; if (c <= 1) low++; }
  if (!vals.length) return null;
  const m = mean(vals), sd = Math.sqrt(mean(vals.map(v => (v - m) ** 2)));
  // what the eye sees: the interior's area not covered by any grain as drawn (a disc of 0.36 cells, main.mjs),
  // on a grid of 1/8 cell
  const S = 8, FW = W * S, cov = new Uint8Array(FW * H * S);
  for (let i = 0; i < n; i++) {
    const x = p[2 * i], y = p[2 * i + 1]; if (sel && !sel(x, y)) continue;
    const fx = (x - X0) * S, fy = (y - Y0) * S, rr = grainR(i) * S, rr2 = rr * rr;
    for (let yy = Math.max(0, Math.floor(fy - rr)); yy <= Math.min(H * S - 1, Math.ceil(fy + rr)); yy++)
      for (let xx = Math.max(0, Math.floor(fx - rr)); xx <= Math.min(FW - 1, Math.ceil(fx + rr)); xx++)
        if ((xx + 0.5 - fx) ** 2 + (yy + 0.5 - fy) ** 2 <= rr2) cov[yy * FW + xx] = 1;
  }
  let fin_ = 0, bare = 0;
  const inI = (xx, yy) => interior[Math.floor(yy / S) * W + Math.floor(xx / S)];
  for (let yy = 0; yy < H * S; yy++) for (let xx = 0; xx < FW; xx++) if (inI(xx, yy)) { fin_++; if (!cov[yy * FW + xx]) bare++; }
  // holes: connected bare areas (4-connected, within the interior) of HOLE_MIN cell² or more; the gaps between
  // neighbouring grains of a packed bed are far smaller, a void, a fissure or a stripe between rows is not
  const seen = new Uint8Array(FW * H * S), q = [];
  let holeArea = 0, holes = 0, biggest = 0;
  for (let st = 0; st < FW * H * S; st++) {
    if (cov[st] || seen[st] || !inI(st % FW, Math.floor(st / FW))) continue;
    let area = 0; q.length = 0; q.push(st); seen[st] = 1;
    while (q.length) {
      const k = q.pop(), xx = k % FW, yy = (k - xx) / FW; area++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x2 = xx + dx, y2 = yy + dy; if (x2 < 0 || y2 < 0 || x2 >= FW || y2 >= H * S) continue;
        const k2 = y2 * FW + x2; if (cov[k2] || seen[k2] || !inI(x2, y2)) continue;
        seen[k2] = 1; q.push(k2);
      }
    }
    const a = area / (S * S);
    if (a >= HOLE_MIN) { holeArea += a; holes++; }
    if (a > biggest) biggest = a;
  }
  return { cells: vals.length, empty: empty / vals.length, low: low / vals.length, mean: m, cv: sd / m, uncovered: fin_ ? bare / fin_ : NaN,
    holes: fin_ ? holeArea / (fin_ / (S * S)) : NaN, holeCount: holes, biggestHole: biggest, outline: [...region].reduce((s, v) => s + v, 0) };
}

/**
 * Overhangs and tears: in the gravity frame, per column (1 cell across "up"), the material is followed
 * up from its lowest occupied cell until a gap of 2 or more empty cells; the points above such a gap
 * sit over air (an overhanging face, a curling tongue, a fissure or a void under them). Counted are
 * those in cells holding 2 or more points (dense: sand, not a sparse spray), as a share of all points.
 */
function detached(p, up = [0, 1], sel) {
  const ac = [up[1], -up[0]], n = p.length / 2, cols = new Map();
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const x = p[2 * i], y = p[2 * i + 1]; if (sel && !sel(x, y)) continue;
    tot++;
    const u = Math.floor(x * up[0] + y * up[1]), s = Math.floor(x * ac[0] + y * ac[1]);
    let c = cols.get(s); if (!c) cols.set(s, c = new Map());
    c.set(u, (c.get(u) || 0) + 1);
  }
  let det = 0;
  for (const c of cols.values()) {
    const us = [...c.keys()].sort((a, b) => a - b);
    let gapAt = Infinity;
    for (let k = 1; k < us.length; k++) if (us[k] - us[k - 1] >= 3) { gapAt = us[k]; break; }
    if (gapAt === Infinity) continue;
    for (const u of us) if (u >= gapAt && c.get(u) >= 2) det += c.get(u);
  }
  return tot ? det / tot : 0;
}

/**
 * The flowing layer: points faster than vth. Per surface bin (2 cells across "up"), 1-cell slabs of
 * depth from the surface; the layer's thickness is the run of slabs from the top in which at least
 * half the points flow (slabs of under 3 points are passed over). A bin flows if its top slab does.
 */
function flowLayer(P, up, vth, sel) {
  const p = xy(P), pr = profile(p, up, 2, sel), { z } = depths(pr);
  const per = new Map();
  let nf = 0, nk = 0;
  for (let i = 0; i < pr.n; i++) {
    if (!pr.keep[i] || isNaN(z[i])) continue;
    const v = Math.hypot(P[5 * i + 2], P[5 * i + 3]), k = Math.floor(z[i]);
    let e = per.get(pr.b[i]); if (!e) per.set(pr.b[i], e = { tot: [], fl: [] });
    e.tot[k] = (e.tot[k] || 0) + 1; if (v > vth) { e.fl[k] = (e.fl[k] || 0) + 1; nf++; }
    nk++;
  }
  const thick = [], rels = [], Zs = [];
  for (const [b, e] of per) {
    const Z = pr.bins.get(b).Z; Zs.push(Z);
    let t = 0, started = false;
    for (let k = 0; k < e.tot.length; k++) {
      const tot = e.tot[k] || 0, fl = e.fl[k] || 0;
      if (tot < 3) { if (started) t = k + 1; continue; }
      if (fl / tot >= 0.5) { t = k + 1; started = true; } else break;
    }
    if (t > 0) { thick.push(t); rels.push(Math.min(1, t / Math.max(1, Z))); }
  }
  const D = pct(Zs, 0.95);
  return { bins: per.size, flowing: thick.length, h: median(thick), hMax: thick.length ? Math.max(...thick) : 0, D, frac: thick.length ? median(thick) / D : 0, relLocal: median(rels), pointsFlowing: nk ? nf / nk : 0 };
}

/** One step of a slow turn: how the bed moved, by depth, between two snapshots (positions of the same points). */
function stepMove(p0, p1, up, dt) {
  const sel = (x, y) => y < -1;
  const pr = profile(p1, up, 2, sel), { z, rel } = depths(pr);
  const top = [], low = [], ZB = [[0, 2], [2, 4], [4, 6], [6, 9], [9, 13], [13, 20], [20, 40], [40, 1e9]], byZ = ZB.map(() => []);
  let mob = 0, cnt = 0;
  for (let i = 0; i < pr.n; i++) {
    if (!pr.keep[i] || isNaN(rel[i])) continue;
    const d = Math.hypot(p1[2 * i] - p0[2 * i], p1[2 * i + 1] - p0[2 * i + 1]);
    cnt++; if (d > 1) mob++;
    if (rel[i] < 0.25) top.push(d); else if (rel[i] >= 0.5) low.push(d);
    for (let k = 0; k < ZB.length; k++) if (z[i] >= ZB[k][0] && z[i] < ZB[k][1]) { byZ[k].push(d); break; }
  }
  const topMove = median(top), lowMove = median(low);
  return {
    topMove, lowMove, ratio: topMove > 0 ? lowMove / topMove : NaN, mobilised: cnt ? mob / cnt : NaN,
    fails: topMove >= 1,                              // the top quarter moved a cell or more in the step: a failure (the solver's jitter moves points about 0.3)
    byDepth: ZB.map((r, k) => ({ z: r[0] + '-' + (r[1] > 1e8 ? 'inf' : r[1]), n: byZ[k].length, med: r2(median(byZ[k])) })).filter(t => t.n >= 5)
  };
}


/** Grain i's radius as drawn (grains.wgsl): GRAIN_R x its size (0.8 to 1.2, from a hash of its index) x 0.935,
 *  where its edge falls to half opacity. */
const HOLE_MIN = 0.25;               // cell²: a bare patch this big is a hole a grain or more across
const GRAIN_R = 0.36;                // a sand grain's drawn radius, cells (main.mjs GrainRenderer)
function grainR(i) {
  let st = (Math.imul((Math.imul(i, 2654435761) + 17) >>> 0, 747796405) + 2891336453) >>> 0;
  let word = Math.imul(((st >>> ((st >>> 28) + 4)) ^ st) >>> 0, 277803737) >>> 0;
  const h = ((word >>> 22) ^ word) >>> 0;
  return GRAIN_R * (0.8 + 0.4 * ((h >>> 8) & 255) / 255) * 0.935;
}

/**
 * The drawn stream (lab-sand case 16): how much of the axis below the neck the grains cover as
 * drawn, with their motion blur. Each grain is a capsule from where it was one exposure ago to
 * where it is (grains.wgsl: displacement x look.z, look.z = blur / 60 x substeps/s), of its drawn
 * radius. rows: 1-cell rows from 2 cells below the neck down to the young cone's top (the slow
 * points near the axis followed up from the bottom, as the scoreboard's streamFrame); a row is
 * covered if some grain within the neck's half-width (+0.5) of the axis covers its centre line.
 * S: rows [x, y, sx, sy] per point (the streak, cells, at the blur asked: window.__lab.streaks).
 * Returns { rows, covered, gap } (gap: the longest run of uncovered rows), or null (no room).
 */
function drawnStream(S, rn, vSlowY, blurScale) {
  const n = S.length / 4, slow = [];
  for (let i = 0; i < n; i++) {
    const x = S[4 * i], y = S[4 * i + 1], sy = S[4 * i + 3];
    if (Math.abs(x) < 2 && y < -2 && Math.abs(sy) < vSlowY) slow.push(y);
  }
  slow.sort((a, b) => a - b);
  let cone = slow.length ? slow[0] : -Infinity;
  for (let k = 1; k < slow.length && slow[k] - cone < 3; k++) cone = slow[k];
  if (!isFinite(cone)) return null;
  const k0 = Math.ceil(cone + 1), k1 = -2;
  if (!(k1 - k0 >= 5)) return null;
  const cov = new Uint8Array(k1 - k0);
  for (let i = 0; i < n; i++) {
    const x = S[4 * i], y = S[4 * i + 1];
    if (Math.abs(x) > rn + 0.5) continue;
    const r = grainR(i), sy = S[4 * i + 3] * blurScale;
    const lo = Math.min(y, y - sy) - r, hi = Math.max(y, y - sy) + r;
    for (let k = Math.max(k0, Math.ceil(lo - 0.5)); k < k1 && k + 0.5 <= hi; k++) cov[k - k0] = 1;
  }
  let gap = 0, run = 0;
  for (const c of cov) { run = c ? 0 : run + 1; gap = Math.max(gap, run); }
  return { rows: cov.length, covered: cov.reduce((s, v) => s + v, 0) / cov.length, gap };
}

module.exports = { median, pct, mean, fin, r2, r3, deg, lean, upOf, maxOf, xy, packing, profile, depths, faceFit, meanSurface, voids, detached, flowLayer, stepMove, grainR, drawnStream };
