//-----------------------------------------------------------------------------
// Hourglass sand lab: what the HUD, the flow test, the tests and the metered
// neck read each frame, summed on the GPU. Part of the Hourglass project (GPL-3.0).
// (Uses the shared include derived from EA pbmpm / Smoosh: see ../LICENSES.md)
//-----------------------------------------------------------------------------
//!include common.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage> particles: array<Particle>;
@group(0) @binding(3) var<storage> g_domain: array<vec4f>;
// [0] points, [1] above the neck, [2] below, [3] outside the glass, [4] not finite,
// [5] fastest (cells/s x 4), [6] summed speed (cells/s x 4, each capped at 4000), [7] moving faster than 2 % of free-fall over the glass,
// the metered neck (valve.mjs): [8] the queue, points resting on the counting line (above it by
// less than QueueBand, within a cell of the neck's width); [9] the fastest crowded point (cells/s
// x 4; crowded as grains.mjs draws a grain sharp); [10] the brim, the highest point above the
// line within 3 cells of the axis (grid y x 16; 0: none); [11] the depth of the lowest point below
// the line (cells x 16; in an empty lower bulb, how far the stream's front has fallen: the lab's
// Timer times the first fall with it); [12-15] unused;
// the beds, for the sound (app-sand.mjs, design 8): [16-21] the bulb above the line, [22-27] the
// one on it or below, each over its points in a bed (crowded, as grains.mjs draws a grain sharp:
// not the falling stream, not spray): [+0, +1] their summed velocity, x and y (cells/s x 4, each
// point's speed capped at BedCap; signed, two's complement), [+2] how many they are, [+3] their
// summed place across the glass from the neck's centre (cells x 16; signed), [+4] the summed
// speed (cells/s x 4) and [+5] the number of those that move (faster than 2 % of a free fall
// over the glass, as [7])
@group(0) @binding(4) var<storage,read_write> tally: array<atomic<u32>>;
// per column, the highest point at rest (slower than 2 cells/s and crowded; grid y x 16, 0: none):
// [x] above the counting line, [gridSize.x + x] on it or below (the surfaces of the two beds)
@group(0) @binding(5) var<storage,read_write> surface: array<atomic<u32>>;

// grains.mjs FLIGHT: a point at least this crowded is in a bed, not in flight
const Crowded = 0.6;
// The queue the valve's throttle keeps is the points ready to cross: those the membrane holds just
// above the line (g2p2g.wgsl: 0.02 above it) and those about to reach it. The throttle band
// (gridUpdate.wgsl) reaches down to the line, so sand further up is still throttled, not ready:
// counted to 0.75 cell above the line (the design's first band), the queue read 10 to 17 points
// while the neck ran short, and the valve's throttle starved it (a 10 s glass on SwiftShader: 362
// of 460 runs short, up to 17 points; its gain learnt from 20 up to 31). Counted to 0.1 cell:
// 3 runs short, at most 6 points, and the gain stayed at 20.
const QueueBand = 0.1;

// The words are summed first in the workgroup's own memory, then added to the tally once per
// workgroup and word: one contended atomic on a word for every 64 points, not one for every point
// (sums and maxima do not depend on the order, so the tally is the same).
const Words = 28u;
var<workgroup> w_tally: array<atomic<u32>, Words>;
// a bed point's speed counts up to this (cells/s; a free fall over a bulb is under half of it),
// so that the sums of 60,000 points stay inside 32 bits
const BedCap = 2000.0;
// words taken by their maximum; the others are sums
fn isMax(k: u32) -> bool { return k == 5u || k == 9u || k == 10u || k == 11u; }

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32) {
    if (li < Words) { atomicStore(&w_tally[li], 0u); }
    workgroupBarrier();
    // (no return before the last barrier: every invocation of the workgroup must reach it)
    if (id.x < count[0]) { countPoint(particles[id.x]); }
    workgroupBarrier();
    if (li < Words) {
        let v = atomicLoad(&w_tally[li]);
        if (v != 0u) {
            if (isMax(li)) { atomicMax(&tally[li], v); } else { atomicAdd(&tally[li], v); }
        }
    }
}

fn countPoint(p: Particle) {
    if (p.enabled == 0.0) { return; }
    atomicAdd(&w_tally[0], 1u);
    let x = p.position; let d = p.displacement;
    if (!(x.x == x.x && x.y == x.y && d.x == d.x && d.y == d.y) || abs(x.x) > 1e9 || abs(d.x) > 1e9 || abs(d.y) > 1e9) {
        atomicAdd(&w_tally[4], 1u);
        return;
    }
    let line = g_simConstants.neckY;
    let above = x.y > line;
    if (above) { atomicAdd(&w_tally[1], 1u); } else { atomicAdd(&w_tally[2], 1u); }
    if (sampleDomain(x).z < -0.5) { atomicAdd(&w_tally[3], 1u); }
    let dt = g_simConstants.deltaTime;
    // the velocity, without the prediction of the next substep's field
    let vel = d / dt - g_simConstants.gravity * dt;
    let v = length(vel);
    let vq = u32(min(v, 4000.0) * 4.0);
    atomicMax(&w_tally[5], vq);
    atomicAdd(&w_tally[6], vq);
    let g = length(g_simConstants.gravity);
    let moves = v > 0.02 * sqrt(2.0 * max(g, 1.0) * f32(g_simConstants.gridSize.y));
    if (moves) { atomicAdd(&w_tally[7], 1u); }
    // the metered neck's measures
    let ax = abs(x.x - g_simConstants.center.x);
    if (above && x.y < line + QueueBand && ax < g_simConstants.gate.y + 1.0) { atomicAdd(&w_tally[8], 1u); }
    let crowded = p.color.y >= Crowded;
    if (crowded) { atomicMax(&w_tally[9], vq); }
    // the beds: each bulb's momentum, count, place across the glass, and what of it moves
    if (crowded) {
        let b = select(22u, 16u, above);
        let vc = vel * min(1.0, BedCap / max(v, 1e-6));
        atomicAdd(&w_tally[b], bitcast<u32>(i32(round(vc.x * 4.0))));
        atomicAdd(&w_tally[b + 1u], bitcast<u32>(i32(round(vc.y * 4.0))));
        atomicAdd(&w_tally[b + 2u], 1u);
        atomicAdd(&w_tally[b + 3u], bitcast<u32>(i32(round(clamp(x.x - g_simConstants.center.x, -4096.0, 4096.0) * 16.0))));
        if (moves) {
            atomicAdd(&w_tally[b + 4u], u32(min(v, BedCap) * 4.0));
            atomicAdd(&w_tally[b + 5u], 1u);
        }
    }
    let yq = u32(clamp(x.y, 0.0, f32(g_simConstants.gridSize.y)) * 16.0);
    if (above && ax < 3.0) { atomicMax(&w_tally[10], yq); }
    if (!above) { atomicMax(&w_tally[11], u32(clamp(line - x.y, 0.0, f32(g_simConstants.gridSize.y)) * 16.0)); }
    if (crowded && v < 2.0) {
        let col = min(u32(max(x.x, 0.0)), g_simConstants.gridSize.x - 1u);
        atomicMax(&surface[select(g_simConstants.gridSize.x, 0u, above) + col], yq);
    }
}
