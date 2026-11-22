//-----------------------------------------------------------------------------
// Hourglass sand engine: layered sand's tone pass (design 7.4). Part of the
// Hourglass project (GPL-3.0). The particle layout is EA's (BSD-3-Clause, see
// ../LICENSES.md).
//
// With layered sand, bit 7 of a grain's colour seed (color.x, an integer) is
// its tone: the theme's sand or its companion (physics.js Renderer._buildLUT).
// The app's sand lays its tones where the sand comes to rest (physics.js
// _sift, _develop); this pass does the same for the GPU's points, once a run,
// after the tally, in one dispatch over the points:
//
// - Fresh grains. A point that has crossed the counting line since the last
//   pass (color.z holds the side it was on then, as above XOR parity, so the
//   flip pass's half turn changes nothing) is numbered (the persistent word
//   counts[0]) and marked fresh (bit 8) with the tone the layer schedule gives
//   that number (bit 9: the table seg, from layers.mjs LayerPlan), within a
//   debt: the tone-1 grains given less the tone-1 grains that crossed stay
//   within the slack (q.z) either way, so a stratum ends early when the sand
//   for it runs out, as the app's sifting sorts the grains that came (the
//   tones keep their counts within the slack). It keeps
//   its colour while it falls; when it first comes to rest below the line
//   (slower than 2 cells/s, with at least half the crowding of a grain in a
//   bed: one on the heap's surface has about half the neighbours), it takes
//   that tone and the mark is cleared. So no grain changes colour in the
//   throat, and the lower heap is laid in strata as it grows.
// - After a turn. While the glass turns and for 4 s after the swap, a point
//   that moves (faster than MoveV) is marked (bit 10); once the swap has come
//   (the patterns are drawn then: physics.js _turned), a marked point at rest
//   whose tone is its bulb's new pattern's at its place (physics.js _phase,
//   ported) is laid. Those of the other tone trade: a first pass (countMain)
//   counts them in each bulb, each way; then each takes a rank, and in each
//   bulb the same number go each way (a share of the fewer of the two, q.x,
//   dithered by q.y), so, as the app's sand trades seeds (physics.js
//   _develop), each bulb keeps its count of each tone exactly, and the
//   pattern settles in over a second or two and never snaps. Sand that lay
//   still is left as it is.
// - It counts each bulb's tones for the readback (layers.mjs Toner).
//-----------------------------------------------------------------------------

struct Particle {
    position : vec2f,
    displacement : vec2f,
    deformationGradient : mat2x2f,
    deformationDisplacement : mat2x2f,
    liquidDensity : f32,
    logJp : f32,
    lambda: f32,
    enabled: f32,
    mass: f32,
    volume: f32,
    material: f32,
    padding: f32,
    color: vec3f,
};

struct Tone {
    a: vec4f,       // x: the counting line (grid y); y, z: the neck's centre (grid); w: s, solver cells per app cell
    b: vec4f,       // x: the run's substep (s); y: unused; z, w: the field (grid, cells/s^2)
    c: vec4f,       // x, y: the app lattice's centre (W/2, H/2, app cells); z, w: unused
    q: vec4f,       // x: the share of the possible trades of tone after a turn made this pass; y: a dither (0 to 1);
                    // z: the slack, points: how far the tone-1 grains given may run ahead of, or behind, those that crossed
    flags: vec4u,   // x: bit 0 fresh grains, bit 1 mark moving grains, bit 2 lay the patterns; y: the parity; z: segments in seg; w: the app lattice's width
    salt: vec4u,    // x, y: each bulb's pattern's salt; z: the frame (for the chance); w: unused
    // each bulb's pattern (physics.js _pattern), app cells: [b*4]: y0, cx, hw, P; [b*4+1]: tilt, bend, fold, kx;
    // [b*4+2]: ky, p1, p2, km; [b*4+3]: p3, duty (the share of tone 1), 0, 0
    pat: array<vec4f, 8>,
    // the layer schedule: x: the first crossing number of the segment, y: its tone (in order; the last one runs on)
    seg: array<vec4u, 16>,
};

@group(0) @binding(0) var<uniform> P: Tone;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;
// read back: [0] crossings numbered (persistent: the next one's number), [1] tone-1 points above, [2] points above,
// [3] tone-1 points below, [4] points below, [5] crossings of points that were of tone 1, [6] crossings given
// tone 1 (both persistent), [7] unused; not read back: [8] the top bulb's points at rest that its pattern wants
// in the other tone: to tone 1 (low 16 bits), to tone 0 (high), [9] the same for the lower bulb (a glass holds
// at most 44,000 points: each half holds its count) (countMain); [10-13] the ranks of those that trade: top to 1,
// top to 0, lower to 1, lower to 0
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>, 16>;

const Words = 8u;
var<workgroup> w_counts: array<atomic<u32>, Words>;
// a grain at rest moves slower than this (cells/s, the tally's surface rule); one faster has moved
const RestV = 2.0;
const MoveV = 6.0;

const Fresh = 256u;
const FreshTone = 512u;
const Moved = 1024u;

fn glassHash(x: u32) -> u32 {
    var h = x;
    h ^= h >> 16u; h *= 0x85EBCA6Bu;
    h ^= h >> 13u; h *= 0xC2B2AE35u;
    h ^= h >> 16u;
    return h;
}

/** The tone the schedule gives crossing number k. */
fn scheduled(k: u32, keep: u32) -> u32 {
    let n = min(P.flags.z, 16u);
    var t = keep;
    for (var i = 0u; i < n; i++) {
        if (P.seg[i].x <= k) { t = P.seg[i].y & 1u; }
    }
    return t;
}

/** Bulb b's pattern's tone at app cell (x, y) (physics.js _phase: under the duty, tone 1). */
fn patternTone(b: u32, x: i32, y: i32) -> u32 {
    let r0 = P.pat[b * 4u]; let r1 = P.pat[b * 4u + 1u]; let r2 = P.pat[b * 4u + 2u]; let r3 = P.pat[b * 4u + 3u];
    let fx = f32(x); let fy = f32(y);
    let dx = fx - r0.y; let q = dx / r0.z;
    let salt = select(P.salt.y, P.salt.x, b == 0u);
    let cellIx = u32(y * i32(P.flags.w) + x);
    let ragged = (f32(glassHash(cellIx ^ salt) >> 8u) / 16777216.0 - 0.5) * 1.6;
    var v = (fy - r0.x) + r1.x * dx + r1.y * r0.w * q * q +
            r1.z * (sin(r1.w * fx + r2.x * fy + r2.y) + 0.4 * sin(2.3 * r1.w * fx - 1.7 * r2.x * fy + r2.z)) + ragged;
    v = v / r0.w + 0.3 * sin(v * r2.w + r3.x);
    let ph = v - floor(v);
    return select(0u, 1u, ph < r3.y);
}

struct Look {
    ok: bool,          // a point to look at
    above: bool,
    side: u32,         // above XOR parity
    resting: bool,
    v: f32,
    bulb: u32,         // 0 the top
    want: u32,         // its pattern's tone (after a turn, at rest and marked)
    trade: bool,       // marked, at rest, not fresh, and of the other tone than its pattern's
};

/** What a point is now, the same in both passes (before this pass changes its seed). */
fn look(p: Particle, sd: u32) -> Look {
    var o: Look;
    let x = p.position; let d = p.displacement;
    o.ok = p.enabled != 0.0 && x.x == x.x && x.y == x.y && d.x == d.x && d.y == d.y && abs(x.y) < 1e9;
    if (!o.ok) { return o; }
    o.above = x.y > P.a.x;
    o.side = select(0u, 1u, o.above) ^ (P.flags.y & 1u);
    let dt = max(P.b.x, 1e-6);
    o.v = length(d / dt - P.b.zw * dt);
    // (grains.mjs FLIGHT is 0.6: a grain in flight has nearly none; one on a surface about half)
    o.resting = o.v < RestV && p.color.y >= 0.3;
    o.bulb = select(1u, 0u, o.above);
    o.trade = false;
    if ((P.flags.x & 4u) != 0u && (sd & Moved) != 0u && (sd & Fresh) == 0u && o.resting) {
        let s = P.a.w;
        let ax = i32(floor(P.c.x + (x.x - P.a.y) / s));
        let ay = i32(floor(P.c.y - (x.y - P.a.z) / s));
        o.want = patternTone(o.bulb, ax, ay);
        o.trade = o.want != ((sd >> 7u) & 1u);
    }
    return o;
}

/** The first pass after a turn: each bulb's points that would trade, each way (words 6 and 7). */
@compute @workgroup_size(64)
fn countMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= count[0]) { return; }
    let p = particles[id.x];
    let sd = u32(max(p.color.x, 0.0));
    let o = look(p, sd);
    if (o.ok && o.trade) { atomicAdd(&counts[8u + o.bulb], select(65536u, 1u, o.want == 1u)); }
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32) {
    if (li < Words) { atomicStore(&w_counts[li], 0u); }
    workgroupBarrier();
    // (no return before the last barrier: every invocation of the workgroup must reach it)
    if (id.x < count[0]) { tonePoint(id.x); }
    workgroupBarrier();
    if (li > 0u && li < 6u && li != 5u) {
        let v = atomicLoad(&w_counts[li]);
        if (v != 0u) { atomicAdd(&counts[li], v); }
    }
}

fn tonePoint(i: u32) {
    let p = particles[i];
    var sd = u32(max(p.color.x, 0.0));
    let o = look(p, sd);
    if (!o.ok) { return; }
    let was = select(0u, 1u, p.color.z > 0.5);
    let f = P.flags.x;
    if ((f & 1u) != 0u) {
        if (!o.above && was != o.side) {
            // it has crossed since the last pass: its number, and the tone the schedule gives it
            let own = (sd >> 7u) & 1u;
            let k = atomicAdd(&counts[0], 1u);
            if (own == 1u) { atomicAdd(&counts[5], 1u); }
            var t = scheduled(k, own);
            // within the debt: the tones given keep up with the tones that came
            let slack = u32(max(P.q.z, 0.0));
            let c1 = atomicLoad(&counts[5]);
            if (t == 1u) {
                let g = atomicAdd(&counts[6], 1u);
                if (g >= c1 + slack) { atomicSub(&counts[6], 1u); t = 0u; }
            } else if (c1 >= atomicLoad(&counts[6]) + slack) {
                atomicAdd(&counts[6], 1u); t = 1u;
            }
            sd = (sd & ~(Fresh | FreshTone)) | Fresh | (t << 9u);
        }
        if ((sd & Fresh) != 0u && !o.above && o.resting) {
            sd = (sd & 127u) | (((sd >> 9u) & 1u) << 7u) | (sd & Moved);
        }
    }
    if ((f & 2u) != 0u) {
        if (o.v > MoveV) { sd |= Moved; }
        else if ((f & 4u) != 0u && (sd & Moved) != 0u && o.resting && (sd & Fresh) == 0u && !o.trade) {
            // laid as its bulb's new pattern has it
            sd &= ~Moved;
        }
        if (o.trade) {
            // as many of each way as the fewer, a share a pass: the bulb keeps its counts
            let w = atomicLoad(&counts[8u + o.bulb]);
            let k = u32(floor(f32(min(w & 65535u, w >> 16u)) * P.q.x + P.q.y));
            let r = atomicAdd(&counts[10u + 2u * o.bulb + select(1u, 0u, o.want == 1u)], 1u);
            if (r < k) { sd = (sd & 127u) | (o.want << 7u); }
        }
    } else {
        sd &= ~Moved;
    }
    particles[i].color.x = f32(sd);
    particles[i].color.z = f32(o.side);
    let t1 = (sd >> 7u) & 1u;
    if (o.above) { atomicAdd(&w_counts[2], 1u); if (t1 == 1u) { atomicAdd(&w_counts[1], 1u); } }
    else { atomicAdd(&w_counts[4], 1u); if (t1 == 1u) { atomicAdd(&w_counts[3], 1u); } }
}
