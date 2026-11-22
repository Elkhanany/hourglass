/*
 * Hourglass sand lab: the classic glass on the solver's grid.
 *
 * The profile below is the app's own classic teardrop (physics.js,
 * makeGeometry and profile), at the phone scale the app uses (q = 1.08:
 * a bulb 95 cells wide each side of the axis and 222 rows from neck to end,
 * a neck 7 cells across). Here it is written as an exact signed distance on
 * the solver's grid: positive inside the glass, with its gradient (the way
 * back into the glass) beside it, as Smoosh's domain field stores it
 * (nx, ny, distance, inside).
 *
 * Grid units: one solver cell is 1/s of an app grain (s = cells per app
 * cell). Grid y points UP (toward the top bulb); x to the right. Texel (i, j)
 * of the field holds the point (i + 0.5, j + 0.5), which is where the
 * solver's grid node (i, j) sits.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */

export const APP_Q = 1.08;            // the phone glass (app.js: scale 1.08 when not "roomy")

/** The classic glass, as physics.js makeGeometry builds it (app cells). */
export function classicGeometry(q = APP_Q) {
  return {
    q,
    R: Math.round(88 * q),            // largest inner half-width of a bulb
    HB: Math.round(206 * q),          // neck centre to the far end of a bulb
    RN: Math.round(3 * q) + 0.5,      // neck inner half-width (7 cells across)
    equator: 0.66,                    // where the bulb is widest (0 = neck)
    wall: 2.6 * q                     // drawn glass thickness
  };
}

/** Inner half-width at u (0 at the neck, 1 at the far end): physics.js profile(), classic branch. */
export function profile(u, g, RN = g.RN) {
  if (u >= 1) return 0;
  if (u < 0) u = 0;
  const c = g.equator;
  if (u <= c) {
    const v = u / c;
    const e = Math.sin(Math.PI * 0.5 * Math.pow(v, 1.22));
    return RN + (g.R - RN) * e;
  }
  const w = (u - c) / (1 - c);
  return g.R * Math.sqrt(1 - Math.pow(w, 2.3));
}

export const PAD = 6;                 // grid cells between the glass's widest/far points and the grid edge

/**
 * The glass on a grid of s cells per app cell. The neck is widened, if it
 * has to be, to at least neckMin cells across (the solver needs room to
 * flow); the widening fades out by the bulb's widest point.
 *
 * geo, prof: the app's own glass (physics.js makeGeometry(q, shape) and
 * profile(u, geo)), so that the sand fills the glass the app draws, at any
 * scale and in any shape; without them the classic glass at scale q, as the
 * lab has always used it (the same numbers: physics.js's classic branch).
 *
 * Besides the field, the glass carries the drawn glass's half-width
 * (halfDrawn: the neck not widened) and, per grid row, warp = halfDrawn /
 * half (1 where the neck was not widened): drawn at x = cx + (x - cx) warp,
 * a point inside the widened neck lies inside the neck the app draws.
 */
export function buildGlass({ s = 0.8, neckMin = 5.5, q = APP_Q, geo = null, profile: prof = null } = {}) {
  const g = geo ? { q: geo.q, R: geo.R, HB: geo.HB, RN: geo.RN, equator: geo.equator, wall: geo.wall, shape: geo.shape || null }
    : classicGeometry(q);
  // the inner half-width at u with a neck of half-width RN (app cells)
  const shapeAt = prof ? (u, RN) => prof(u, Object.assign({}, g, { RN })) : (u, RN) => profile(u, g, RN);
  const neckApp = 2 * g.RN;                         // 7 app cells
  const neckCells0 = neckApp * s;
  const neckCells = Math.max(neckCells0, neckMin);
  const RNapp = neckCells / s / 2;                  // neck half-width used, app cells
  const HBc = g.HB * s, Rc = g.R * s;
  const W = Math.ceil(2 * Rc) + 2 * PAD + 1;
  const H = Math.ceil(2 * HBc) + 2 * PAD + 1;
  const cx = W / 2, cy = H / 2;                     // the neck centre, grid coordinates
  /** Inner half-width in cells at height |dy| cells from the neck centre. */
  const half = ady => (ady >= HBc ? 0 : shapeAt(ady / HBc, RNapp) * s);
  /** The same, of the glass the app draws (its neck not widened). */
  const halfDrawn = ady => (ady >= HBc ? 0 : shapeAt(ady / HBc, g.RN) * s);

  // The outline of one quarter (x >= 0, y >= 0), neck to tip, with points
  // close together where it turns fast (near the tip and through the neck).
  const pts = [];
  const N = 700;
  for (let k = 0; k <= N; k++) {
    const a = k / N;
    const u = 0.5 - 0.5 * Math.cos(Math.PI * a);   // dense at both ends
    pts.push([shapeAt(u, RNapp) * s, u * HBc]);
  }
  pts[N] = [0, HBc];
  const px = new Float64Array(pts.length), py = new Float64Array(pts.length);
  pts.forEach((p, i) => { px[i] = p[0]; py[i] = p[1]; });

  /** Distance to the quarter outline and the nearest point on it. */
  function nearest(ax, ay) {
    let best = Infinity, bx = 0, by = 0;
    for (let i = 0; i < N; i++) {
      const x0 = px[i], y0 = py[i], x1 = px[i + 1], y1 = py[i + 1];
      // skip segments that cannot be closer than the best so far
      const ylo = y0 < y1 ? y0 : y1, yhi = y0 < y1 ? y1 : y0;
      if (best !== Infinity) {
        const r = Math.sqrt(best);
        if (ylo > ay + r || yhi < ay - r) continue;
      }
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((ax - x0) * dx + (ay - y0) * dy) / L2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const qx = x0 + t * dx, qy = y0 + t * dy;
      const d2 = (ax - qx) * (ax - qx) + (ay - qy) * (ay - qy);
      if (d2 < best) { best = d2; bx = qx; by = qy; }
    }
    return [Math.sqrt(best), bx, by];
  }

  /** Signed distance (+ inside) and the inward normal at a grid point. */
  function sdfAt(x, y) {
    const dx = x - cx, dy = y - cy;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const inside = ay < HBc && ax < half(ay);
    const [d, qx, qy] = nearest(ax, ay);
    let nx = ax - qx, ny = ay - qy;
    const l = Math.hypot(nx, ny);
    if (l > 1e-9) { nx /= l; ny /= l; } else { nx = -1; ny = 0; }
    if (!inside) { nx = -nx; ny = -ny; }
    if (dx < 0) nx = -nx;
    if (dy < 0) ny = -ny;
    return [nx, ny, inside ? d : -d, inside ? 1 : 0];
  }

  const field = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const r = sdfAt(i + 0.5, j + 0.5), o = (j * W + i) * 4;
    field[o] = r[0]; field[o + 1] = r[1]; field[o + 2] = r[2]; field[o + 3] = r[3];
  }

  // Area of one bulb (cells²), by rows.
  let bulbArea = 0;
  const rows = 4000;
  for (let k = 0; k < rows; k++) bulbArea += 2 * half((k + 0.5) / rows * HBc) * HBc / rows;

  // per grid row (its centre), the drawn half-width over the simulated one
  const warp = new Float32Array(H);
  for (let j = 0; j < H; j++) {
    const ady = Math.abs(j + 0.5 - cy), h = half(ady);
    warp[j] = h > 0 ? Math.min(1, halfDrawn(ady) / h) : 1;
  }

  return {
    s, q: g.q, geo: g, W, H, cx, cy, HBc, Rc,
    neckCells, neckCells0, neckWidened: neckCells / neckCells0 - 1,
    rn: neckCells / 2, wallCells: g.wall * s,
    half, halfDrawn, warp, sdfAt, field, bulbArea,
    outline: pts                                      // quarter outline, cells, (x, y from the neck)
  };
}

/**
 * Bilinear sample of the field at a grid point, as the shaders do it
 * (domain.inc.wgsl): returns [nx, ny, distance, inside].
 */
export function sampleField(glass, x, y) {
  const { W, H, field } = glass;
  let qx = x - 0.5, qy = y - 0.5;
  qx = Math.min(Math.max(qx, 0), W - 1.001); qy = Math.min(Math.max(qy, 0), H - 1.001);
  const ix = Math.floor(qx), iy = Math.floor(qy), tx = qx - ix, ty = qy - iy;
  const hx = Math.min(ix + 1, W - 1), hy = Math.min(iy + 1, H - 1);
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = field[(iy * W + ix) * 4 + c] * (1 - tx) + field[(iy * W + hx) * 4 + c] * tx;
    const b = field[(hy * W + ix) * 4 + c] * (1 - tx) + field[(hy * W + hx) * 4 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

/**
 * Trace the whole glass outline into a 2-D path, in cells, y DOWN (the
 * screen's way), centred on the neck, pushed outward by `grow` cells.
 */
export function traceOutline(path, glass, grow = 0) {
  const q = glass.outline, n = q.length;
  // outward normal of the quarter outline at each point (x out, y toward the tip)
  const pts = [];
  for (let k = n - 1; k >= 0; k--) {                // tip -> neck, right side, top bulb (y up = screen up)
    const a = q[Math.max(0, k - 1)], b = q[Math.min(n - 1, k + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    // outward: rotate the tangent (neck->tip) clockwise in (x, y-up) => (ty, -tx)
    let nx = ty, ny = -tx;
    if (k === n - 1) { nx = 0; ny = 1; }
    pts.push([q[k][0] + grow * nx, -(q[k][1] + grow * ny)]);
  }
  // waist: where the grown wall crosses y = 0
  const last = pts[pts.length - 1];
  if (last[1] > 0) last[1] = 0;
  pts.push([last[0], 0]);
  const all = pts.slice();
  for (let k = pts.length - 2; k >= 0; k--) all.push([pts[k][0], -pts[k][1]]);
  path.moveTo(all[0][0], all[0][1]);
  for (let k = 1; k < all.length; k++) path.lineTo(all[k][0], all[k][1]);
  for (let k = all.length - 1; k >= 0; k--) path.lineTo(-all[k][0], all[k][1]);
  path.closePath();
}
