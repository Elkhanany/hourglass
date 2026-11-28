//-----------------------------------------------------------------------------
// Hourglass sand engine: the beds' relief, for the sunlit sand (the app's
// Light: Sunlit). Part of the Hourglass project (GPL-3.0).
//
// Three passes, encoded before the grains are drawn (grains.mjs encode). They
// read the solver's points and write buffers of their own: nothing of the
// simulation is written.
//
// csCount, one thread a point: every point that lies in a bed (crowded, as
// grains.wgsl draws a grain sharp: not the falling stream, not spray; nor a
// point within a cell under the counting line, where the stream leaves the
// neck from rest) is counted in its cell of the grid, and counted again if it
// moves (faster than three times the displacement under which a bed lies
// still).
//
// csScan, one thread a column and bulb: the column's bed, from the bulb's
// floor up: the first run of cells that hold such points (one empty cell in
// it is not its end) and holds at least four of them. Its top is the bed's
// surface in that column: where the bed is, not the highest point (a grain
// stuck high on the wall, a clump in the air, a shelf thrown up the wall over
// air all lie above the run's end, and are counted as sand above the bed).
// And the share of the points in the bed's top six cells that move.
// The floor is the end gravity holds the sand to: with gravity up the grid (a
// glass held turned past the level, or a phone that holds it so) it is the
// bulb's far end, and the bed is scanned from there down, its surface the
// run's lowest cell; "up", "top" and "above" below mean away from that floor.
// The grid's columns stand for a surface only while gravity is near their
// axis: turned toward the level the bed lies against a wall, and its surface
// is no height over the columns, so it is trusted less (grav.w), to nothing.
//
// csMain, one thread a column and bulb: what the grains' vertex stage reads
// for a grain near the top of its bed (grains.wgsl), as the classic sand's
// column pass makes it on the CPU (glass/renderer.js _sunColumns):
//   x  the bed's height in that column (grid y; 0: none): the surfaces of
//      seven columns, a Gaussian over them (sigma 1.5 columns), half the last
//      frame's and half the new;
//   y  the light on its free surface: the ambient, and the key on the
//      surface's normal (from the slope over three spans), less where the bed
//      itself hides the key (a horizon test toward it, soft: the bed is round
//      and the key is not a point);
//   z  that normal against the direction half way between the key and the eye
//      (the glints' term);
//   w  how far the surface is to be trusted, 0 to 1: every term the grains
//      take from the surface (its light, its glints, the darkening with depth
//      under it, a pale sand's deeper top) is weighed by it. It falls with
//      sand above the bed (thrown, in flight, on the wall), with a top layer
//      that moves, with a column's surface far from its neighbours', and with
//      a surface that changes fast; it is the same Gaussian over seven
//      columns, and it falls by at most 0.15 a frame and comes back by at
//      most 0.04 a frame. So the light varies smoothly from column to column
//      and from frame to frame, and where the bed is thrown about the grains
//      keep their own light, which needs no surface.
// A column with no bed this frame takes the height between the nearest columns
// that have one (up to 4 away on each side), or else keeps the last while its
// trust fades. csMain reads the last frame's buffer and writes the other, so
// no thread reads what another writes.
//-----------------------------------------------------------------------------

struct Relief {
    key: vec4f,    // xyz: the key light's direction in the grid's axes (x right, y up, z toward the eye); w: the grid's columns
    half: vec4f,   // xyz: half way between the key and the eye; w: 1: the beds are new (a fill, a turn): nothing is kept from before
    amb: vec4f,    // x: the ambient; y: the key; z: the wrap round the terminator; w: the counting line (grid y): a point above it is of the upper bed
    pts: vec4f,    // x: the points in the glass; y: the crowding at and above which a point lies in a bed;
                   // z: the displacement in a substep under which it lies still (cells); w: the grid's rows
    grav: vec4f,   // xy: the room's up in the grid's axes (against gravity); z: the floor: 1 gravity down the grid, -1 up it;
                   // w: how far the columns stand for the surface, 1 with gravity near their axis, 0 toward the level
};

@group(0) @binding(0) var<uniform> u: Relief;
// the solver's points, 24 words each (solver.mjs PARTICLE_WORDS): [0, 1] the place, [2, 3] the displacement in a
// substep, [15] enabled, [21] the crowding (g2p2g.wgsl writes it into color.y)
@group(0) @binding(1) var<storage, read> particles: array<f32>;
// per cell of the grid (row x columns + column): the bed points in it (low 16 bits) and the moving ones (high 16 bits)
@group(0) @binding(2) var<storage, read_write> cells: array<atomic<u32>>;
// per column and bulb ([x] the upper, [columns + x] the lower): x the bed's surface (grid y; 0: none), y the bed
// points above it, z the share of the points in its top six cells that move, w the points in the bed
@group(0) @binding(3) var<storage, read_write> cols: array<vec4f>;
@group(0) @binding(4) var<storage, read> before: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> relief: array<vec4f>;

@compute @workgroup_size(64)
fn csCount(@builtin(global_invocation_id) id: vec3u) {
    if (f32(id.x) >= u.pts.x) { return; }
    let o = id.x * 24u;
    let x = particles[o]; let y = particles[o + 1u];
    let d = vec2f(particles[o + 2u], particles[o + 3u]);
    // (a point that is not finite fails every comparison)
    if (particles[o + 15u] == 0.0 || !(x >= 0.0 && y >= 0.0 && y < u.pts.w)) { return; }
    if (!(particles[o + 21u] >= u.pts.y)) { return; }
    // (the cell the stream leaves the neck into: under the line, or over it with gravity up the grid)
    if (select(y >= u.amb.w && y < u.amb.w + 1.0, y <= u.amb.w && y > u.amb.w - 1.0, u.grav.z > 0.0)) { return; }
    let W = u32(u.key.w);
    let moving = dot(d, d) > 9.0 * u.pts.z * u.pts.z;
    atomicAdd(&cells[min(u32(y), u32(u.pts.w) - 1u) * W + min(u32(x), W - 1u)], select(1u, 65537u, moving));
}

@compute @workgroup_size(64)
fn csScan(@builtin(global_invocation_id) id: vec3u) {
    let W = u32(u.key.w);
    if (id.x >= 2u * W) { return; }
    let upper = id.x < W;
    let x = id.x % W;
    // the bulb's rows: the upper from the counting line's (which holds only its points) up, the lower under it
    let cl = u32(max(floor(u.amb.w), 0.0));
    let r0 = select(0u, cl, upper);
    let r1 = select(cl, u32(u.pts.w), upper);
    let down = u.grav.z > 0.0;
    var start = -1; var top = -1; var gap = 0; var n = 0u; var topN = 0u; var ended = false; var above = 0u;
    for (var i = 0u; i < r1 - r0; i++) {
        let r = select(r1 - 1u - i, r0 + i, down);           // (from the floor gravity holds the sand to)
        let k = atomicLoad(&cells[r * W + x]) & 0xffffu;
        if (ended) { above += k; continue; }
        if (k > 0u) {
            if (start < 0) { start = i32(r); n = 0u; }
            top = i32(r); topN = k; gap = 0; n += k;
        } else if (start >= 0) {
            gap++;
            if (gap > 1) {
                // a run of fewer than four points is no bed: sand above whatever bed comes
                if (n >= 4u) { ended = true; } else { above += n; start = -1; top = -1; n = 0u; gap = 0; }
            }
        }
    }
    if (!ended && start >= 0 && n < 4u) { above += n; top = -1; }
    if (top < 0) { cols[id.x] = vec4f(0.0, f32(above), 0.0, 0.0); return; }
    // the share of the top six cells' points that move
    var mv = 0u; var t = 0u;
    for (var r = select(top, max(top - 5, start), down); r <= select(min(top + 5, start), top, down); r++) {
        let c = atomicLoad(&cells[u32(r) * W + x]);
        t += c & 0xffffu; mv += c >> 16u;
    }
    let f = clamp(0.25 + 0.25 * f32(topN), 0.5, 1.0);         // (how far into its top cell the surface lies)
    let h = select(max(f32(top) + 1.0 - f, 1e-3), f32(top) + f, down);
    cols[id.x] = vec4f(h, f32(above), f32(mv) / f32(max(t, 1u)), f32(n));
}

/** Column x of bed b as this frame's scan found it (x: its surface, 0: none; the rest as cols). */
fn col(b: u32, x: i32) -> vec4f {
    let W = i32(u.key.w);
    if (x < 0 || x >= W) { return vec4f(0.0); }
    return cols[b * u32(W) + u32(x)];
}

/** The surface of column x of bed b this frame: its own, or in a gap the height between the nearest columns that have one, up to 4 away. */
fn surf(b: u32, x: i32) -> f32 {
    let h = col(b, x).x;
    if (h > 0.0) { return h; }
    var hl = 0.0; var hr = 0.0; var dl = 0.0; var dr = 0.0;
    for (var o = 1; o <= 4; o++) {
        if (hl <= 0.0) { let v = col(b, x - o).x; if (v > 0.0) { hl = v; dl = f32(o); } }
        if (hr <= 0.0) { let v = col(b, x + o).x; if (v > 0.0) { hr = v; dr = f32(o); } }
    }
    if (hl > 0.0 && hr > 0.0) { return (hl * dr + hr * dl) / (dl + dr); }
    return 0.0;
}

/** The Gaussian over seven columns (sigma 1.5), at k columns off. */
fn gauss(k: i32) -> f32 { return exp(-f32(k * k) / 4.5); }

/** The surface of column x of bed b evened over seven columns (0: no bed there). */
fn even(b: u32, x: i32) -> f32 {
    if (surf(b, x) <= 0.0) { return 0.0; }
    var s = 0.0; var w = 0.0;
    for (var k = -3; k <= 3; k++) {
        let v = surf(b, x + k);
        if (v > 0.0) { let g = gauss(k); s += g * v; w += g; }
    }
    return s / w;
}

/** The surface the light is made of: the evened one, half the last frame's and half the new (the last kept while none is seen and it is trusted). */
fn height(b: u32, x: i32) -> f32 {
    let W = i32(u.key.w);
    if (x < 0 || x >= W) { return 0.0; }
    let old = before[b * u32(W) + u32(x)];
    let kept = u.half.w < 0.5 && old.x > 0.0 && old.w > 0.0;
    let h = even(b, x);
    if (h > 0.0) { return select(h, mix(old.x, h, 0.5), kept); }
    return select(0.0, old.x, kept);
}

/** How far this frame's scan of column x of bed b is to be trusted, 0 to 1, before it is evened over the columns. */
fn trust(b: u32, x: i32) -> f32 {
    let c = col(b, x);
    if (c.x <= 0.0) { return 0.0; }
    let air = 1.0 - smoothstep(0.5, 6.0, c.y);                       // sand above the bed (thrown, in flight, on the wall)
    let still = 1.0 - smoothstep(0.1, 0.4, c.z);                     // a top layer that moves
    let near = 1.0 - smoothstep(1.5, 5.0, abs(c.x - even(b, x)));    // a surface far from its neighbours'
    return air * still * near * u.grav.w;                            // (gravity toward the level: the columns stand for no surface)
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    let W = u32(u.key.w);
    if (id.x >= 2u * W) { return; }
    let b = id.x / W;
    let x = i32(id.x % W);
    let h0 = height(b, x);
    let old = before[id.x];
    let fresh = u.half.w > 0.5;
    // the trust: evened over seven columns (those with a bed), less where the surface changes fast; eased in time
    var ts = 0.0; var tw = 0.0;
    for (var k = -3; k <= 3; k++) {
        if (col(b, x + k).x > 0.0) { let g = gauss(k); ts += g * trust(b, x + k); tw += g; }
    }
    var c = select(0.0, ts / max(tw, 1e-6), tw > 0.0 && col(b, x).x > 0.0);
    if (!fresh && old.x > 0.0 && h0 > 0.0) { c *= 1.0 - smoothstep(0.4, 1.5, abs(h0 - old.x)); }
    if (!fresh) { c = clamp(c, old.w - 0.15, old.w + 0.04); }
    c = clamp(c, 0.0, 1.0);
    if (h0 <= 0.0 || c <= 0.001) { relief[id.x] = vec4f(0.0); return; }
    // the slope, central differences over three spans (the nearer the heavier), and the surface's normal:
    // away from the floor (up), tipped against the slope, and a little toward the eye (a cone's near flank is
    // seen from above)
    let up = u.grav.z;
    var sum = 0.0; var ws = 0.0;
    for (var o = 1; o <= 3; o++) {
        let a = height(b, x + o); let e = height(b, x - o);
        if (a > 0.0 && e > 0.0) { sum += (a - e) / f32(2 * o * o); ws += 1.0 / f32(o); }
    }
    let m = select(0.0, sum / max(ws, 1e-6), ws > 0.0);
    let nt = normalize(vec3f(-m * up, up, 0.5));
    // the bed's own soft shadow: how high the bed stands toward the key, against the key's elevation (both
    // measured away from the floor)
    let L = u.key.xyz;
    let tanA = up * L.y / max(abs(L.x), 1e-3);
    let sg = select(1, -1, L.x < 0.0);
    var reach = array<i32, 6>(1, 2, 3, 5, 8, 11);
    var tau = -9.0;
    for (var k = 0; k < 6; k++) {
        let hk = height(b, x + sg * reach[k]);
        if (hk > 0.0) { tau = max(tau, up * (hk - h0) / f32(reach[k])); }
    }
    let vis = select(0.2, 1.0 - 0.8 * smoothstep(tanA - 0.25, tanA + 0.35, tau), up * L.y > 0.0);
    let D = max(0.0, (dot(nt, L) + u.amb.z) / (1.0 + u.amb.z));
    relief[id.x] = vec4f(h0, u.amb.x * (0.85 + 0.15 * dot(nt.xy, u.grav.xy)) + 0.88 * u.amb.y * vis * D, dot(nt, u.half.xyz), c);
}
