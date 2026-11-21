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
// less than 0.75 cell, within a cell of the neck's width); [9] the fastest crowded point (cells/s
// x 4; crowded as grains.mjs draws a grain sharp); [10] the brim, the highest point above the
// line within 3 cells of the axis (grid y x 16; 0: none); [11-15] unused
@group(0) @binding(4) var<storage,read_write> tally: array<atomic<u32>>;
// per column, the highest point at rest (slower than 2 cells/s and crowded; grid y x 16, 0: none):
// [x] above the counting line, [gridSize.x + x] on it or below (the surfaces of the two beds)
@group(0) @binding(5) var<storage,read_write> surface: array<atomic<u32>>;

// grains.mjs FLIGHT: a point at least this crowded is in a bed, not in flight
const Crowded = 0.6;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= count[0]) { return; }
    let p = particles[id.x];
    if (p.enabled == 0.0) { return; }
    atomicAdd(&tally[0], 1u);
    let x = p.position; let d = p.displacement;
    if (!(x.x == x.x && x.y == x.y && d.x == d.x && d.y == d.y) || abs(x.x) > 1e9 || abs(d.x) > 1e9 || abs(d.y) > 1e9) {
        atomicAdd(&tally[4], 1u);
        return;
    }
    let line = g_simConstants.neckY;
    let above = x.y > line;
    if (above) { atomicAdd(&tally[1], 1u); } else { atomicAdd(&tally[2], 1u); }
    if (sampleDomain(x).z < -0.5) { atomicAdd(&tally[3], 1u); }
    let dt = g_simConstants.deltaTime;
    // the velocity, without the prediction of the next substep's field
    let v = length(d / dt - g_simConstants.gravity * dt);
    let vq = u32(min(v, 4000.0) * 4.0);
    atomicMax(&tally[5], vq);
    atomicAdd(&tally[6], vq);
    let g = length(g_simConstants.gravity);
    if (v > 0.02 * sqrt(2.0 * max(g, 1.0) * f32(g_simConstants.gridSize.y))) { atomicAdd(&tally[7], 1u); }
    // the metered neck's measures
    let ax = abs(x.x - g_simConstants.center.x);
    if (above && x.y < line + 0.75 && ax < g_simConstants.gate.y + 1.0) { atomicAdd(&tally[8], 1u); }
    let crowded = p.color.y >= Crowded;
    if (crowded) { atomicMax(&tally[9], vq); }
    let yq = u32(clamp(x.y, 0.0, f32(g_simConstants.gridSize.y)) * 16.0);
    if (above && ax < 3.0) { atomicMax(&tally[10], yq); }
    if (crowded && v < 2.0) {
        let col = min(u32(max(x.x, 0.0)), g_simConstants.gridSize.x - 1u);
        atomicMax(&surface[select(g_simConstants.gridSize.x, 0u, above) + col], yq);
    }
}
