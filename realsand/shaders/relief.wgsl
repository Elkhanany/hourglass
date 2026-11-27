//-----------------------------------------------------------------------------
// Hourglass sand engine: the beds' relief, for the sunlit sand (the app's
// Light: Sunlit). Part of the Hourglass project (GPL-3.0).
//
// Two passes, encoded before the grains are drawn (grains.mjs encode). They
// read the solver's points and write buffers of their own: nothing of the
// simulation is written.
//
// csTops, one thread a point: per column of the grid and per bulb, the
// highest point that lies in a bed (crowded, as grains.wgsl draws a grain
// sharp, and slow: not the falling stream, not spray; nor a point within a
// cell under the counting line, where the stream leaves the neck from rest).
// (The tally's own surface, tally.wgsl, is the highest point at rest, slower
// than 2 cells/s, for the heap's angle: on a bed that still creeps it lies
// cells under the top, so the light has heights of its own.)
//
// csMain, one thread a column and bulb: what the grains' vertex stage reads
// for a grain near the top of its bed (grains.wgsl), as the classic sand's
// column pass makes it on the CPU (glass/renderer.js _sunColumns):
//   x  the bed's height in that column (grid y; 0: none);
//   y  the light on its free surface: the ambient, and the key on the
//      surface's normal (from the slope over three spans), less where the bed
//      itself hides the key (a horizon test toward it, soft: the bed is round
//      and the key is not a point);
//   z  that normal against the direction half way between the key and the eye
//      (the glints' term);
//   w  the frames since the column's height was last seen.
// A column's height is half the last frame's and half the new (the highest
// point of a column flickers by a grain: the crest would too); a column with
// no bed point this frame keeps its last height for HOLD frames; a gap between
// two columns that have a height takes the height between them for this frame.
// csMain reads the last frame's buffer and writes the other, so no thread
// reads what another writes.
//-----------------------------------------------------------------------------

struct Relief {
    key: vec4f,    // xyz: the key light's direction in the grid's axes (x right, y up, z toward the eye); w: the grid's columns
    half: vec4f,   // xyz: half way between the key and the eye; w: 1: the beds are new (a fill, a turn): nothing is kept from before
    amb: vec4f,    // x: the ambient; y: the key; z: the wrap round the terminator; w: the counting line (grid y): a point above it is of the upper bed
    pts: vec4f,    // x: the points in the glass; y: the crowding at and above which a point lies in a bed;
                   // z: the displacement in a substep under which it does (cells)
};

@group(0) @binding(0) var<uniform> u: Relief;
// the solver's points, 24 words each (solver.mjs PARTICLE_WORDS): [0, 1] the place, [2, 3] the displacement in a
// substep, [15] enabled, [21] the crowding (g2p2g.wgsl writes it into color.y)
@group(0) @binding(1) var<storage, read> particles: array<f32>;
// per column, the highest bed point this frame (grid y x 16, 0: none): [x] above the counting line, [columns + x] on it or below
@group(0) @binding(2) var<storage, read_write> tops: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> before: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> relief: array<vec4f>;

// frames a column's height is kept for while no bed point is seen in it (a third of a second at 60 a second)
const HOLD = 20.0;

@compute @workgroup_size(64)
fn csTops(@builtin(global_invocation_id) id: vec3u) {
    if (f32(id.x) >= u.pts.x) { return; }
    let o = id.x * 24u;
    let x = particles[o]; let y = particles[o + 1u];
    let d = vec2f(particles[o + 2u], particles[o + 3u]);
    // (a point that is not finite fails every comparison)
    if (particles[o + 15u] == 0.0 || !(x >= 0.0 && y >= 0.0 && y < 60000.0)) { return; }
    if (!(particles[o + 21u] >= u.pts.y && dot(d, d) <= u.pts.z * u.pts.z)) { return; }
    let above = y > u.amb.w;
    if (!above && y > u.amb.w - 1.0) { return; }
    let W = u32(u.key.w);
    atomicMax(&tops[select(W, 0u, above) + min(u32(x), W - 1u)], u32(y * 16.0));
}

/** Column x of bed b as this frame keeps it: x: its height (grid y; 0: none), y: the frames since it was seen. */
fn held(b: u32, x: i32) -> vec2f {
    let W = i32(u.key.w);
    if (x < 0 || x >= W) { return vec2f(0.0, HOLD); }
    let i = b * u32(W) + u32(x);
    let raw = f32(atomicLoad(&tops[i])) / 16.0;
    let old = before[i];
    let kept = u.half.w < 0.5 && old.x > 0.0 && old.w < HOLD;
    if (raw > 0.0) { return vec2f(select(raw, mix(old.x, raw, 0.5), kept), 0.0); }
    if (kept) { return vec2f(old.x, old.w + 1.0); }
    return vec2f(0.0, HOLD);
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    let W = u32(u.key.w);
    if (id.x >= 2u * W) { return; }
    let b = id.x / W;
    let x = i32(id.x % W);
    let me = held(b, x);
    var h0 = me.x;
    var age = me.y;
    if (h0 <= 0.0) {
        // a gap: the height between the nearest columns that have one, up to 4 away on each side (never kept)
        var hl = 0.0; var hr = 0.0; var dl = 0.0; var dr = 0.0;
        for (var o = 1; o <= 4; o++) {
            if (hl <= 0.0) { let v = held(b, x - o).x; if (v > 0.0) { hl = v; dl = f32(o); } }
            if (hr <= 0.0) { let v = held(b, x + o).x; if (v > 0.0) { hr = v; dr = f32(o); } }
        }
        if (hl > 0.0 && hr > 0.0) { h0 = (hl * dr + hr * dl) / (dl + dr); }
        age = HOLD;
    }
    if (h0 <= 0.0) { relief[id.x] = vec4f(0.0, 0.0, 0.0, HOLD); return; }
    // the slope, central differences over three spans (the nearer the heavier), and the surface's normal:
    // up, tipped against the slope, and a little toward the eye (a cone's near flank is seen from above)
    var sum = 0.0; var ws = 0.0;
    for (var o = 1; o <= 3; o++) {
        let a = held(b, x + o).x; let c = held(b, x - o).x;
        if (a > 0.0 && c > 0.0) { sum += (a - c) / f32(2 * o * o); ws += 1.0 / f32(o); }
    }
    let m = select(0.0, sum / max(ws, 1e-6), ws > 0.0);
    let nt = normalize(vec3f(-m, 1.0, 0.5));
    // the bed's own soft shadow: how high the bed stands toward the key, against the key's elevation
    let L = u.key.xyz;
    let tanA = L.y / max(abs(L.x), 1e-3);
    let sg = select(1, -1, L.x < 0.0);
    var reach = array<i32, 6>(1, 2, 3, 5, 8, 11);
    var tau = -9.0;
    for (var k = 0; k < 6; k++) {
        let hk = held(b, x + sg * reach[k]).x;
        if (hk > 0.0) { tau = max(tau, (hk - h0) / f32(reach[k])); }
    }
    let vis = select(0.2, 1.0 - 0.8 * smoothstep(tanA - 0.25, tanA + 0.35, tau), L.y > 0.0);
    let D = max(0.0, (dot(nt, L) + u.amb.z) / (1.0 + u.amb.z));
    relief[id.x] = vec4f(h0, u.amb.x * (0.85 + 0.15 * nt.y) + 0.88 * u.amb.y * vis * D, dot(nt, u.half.xyz), age);
}
