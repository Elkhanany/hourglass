//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts. All rights reserved.
// (BSD-3-Clause, see ../LICENSES.md)
// Smoosh adaptation: Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see ../LICENSES.md)
// Hourglass sand lab changes (GPL-3.0 project): no rigid bodies or shapes;
// the glass wall has slip-stick Coulomb friction (tangential motion is cut
// by mu times the motion into the wall, and stops when that is more); the
// one-cell-per-substep clamp is a setting and is counted; a closed neck; it
// also zeroes the next grid at the same node (gridClear's work, folded in to
// save a dispatch: the two touch different buffers).
//-----------------------------------------------------------------------------
//!include common.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage,read_write> grid: array<i32>;
@group(0) @binding(2) var<storage> g_domain: array<vec4f>;
@group(0) @binding(3) var<storage> activeBuckets: array<u32>;
@group(0) @binding(4) var<storage> gridArgs: array<u32>;
// per node: the most the sand pressed into the wall in this substep's iterations (cells)
@group(0) @binding(5) var<storage,read_write> wallPress: array<f32>;
// [0] nodes clamped (cumulative), [1] largest node move (cells x 1000, cumulative max)
@group(0) @binding(6) var<storage,read_write> counters: array<atomic<u32>>;
// the grid this iteration's G2P2G writes into: zeroed here, node for node as gridClear.wgsl does
@group(0) @binding(7) var<storage,read_write> nextGrid: array<i32>;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) invocation: vec3u) {
    if (invocation.x >= gridArgs[3] * 36u) { return; }
    let bucket = activeBuckets[invocation.x / 36u];
    let node = invocation.x % 36u;
    let id = vec2u(bucket % g_simConstants.bukkitCountX, bucket / g_simConstants.bukkitCountX) * 6u + vec2u(node % 6u, node / 6u);
    if (any(id >= g_simConstants.gridSize)) { return; }
    let nodeIndex = id.y * g_simConstants.gridSize.x + id.x;
    let address = gridVertexIndex(id, g_simConstants.gridSize);
    nextGrid[address] = 0; nextGrid[address+1] = 0; nextGrid[address+2] = 0; nextGrid[address+3] = 0;
    let fpm = g_simConstants.fixedPointMultiplier;
    let mass = decodeFixedPoint(grid[address+2], fpm);
    if (mass < 1e-5) {
        grid[address] = 0; grid[address+1] = 0;
        if (g_simConstants.iteration == 1u) { wallPress[nodeIndex] = 0.0; }
        return;
    }
    var displacement = vec2f(decodeFixedPoint(grid[address], fpm), decodeFixedPoint(grid[address+1], fpm)) / mass;
    let position = vec2f(id) + 0.5;

    let boundary = sampleDomain(position + displacement);
    if (boundary.z < 0.65) {
        let normal = safeNormal(boundary.xy);
        let dn = dot(displacement, normal);
        // The wall's grip this substep: how hard the sand has pressed into it in any iteration so far.
        var press = max(0.0, -dn);
        if (g_simConstants.iteration > 1u) { press = max(press, wallPress[nodeIndex]); }
        wallPress[nodeIndex] = press;
        if (dn < 0.0) { displacement -= dn * normal; }
        // Coulomb: in contact (not lifting off), the tangential move is cut by mu * press; it sticks if that is more.
        if (dn < 0.25 * press + 1e-6) {
            let tangent = displacement - dot(displacement, normal) * normal;
            let tl = length(tangent);
            let limit = g_simConstants.wallFriction * press;
            displacement -= tangent * min(1.0, limit / max(tl, 1e-9));
            displacement -= (displacement - dot(displacement, normal) * normal) * g_simConstants.wallDrag;
        }
    } else if (g_simConstants.iteration == 1u) {
        wallPress[nodeIndex] = 0.0;
    }

    // The closed neck: a floor across it.
    if (g_simConstants.gate.x > 0.5 && abs(position.x - g_simConstants.center.x) < g_simConstants.gate.y + 3.0 &&
        position.y < g_simConstants.neckY + 1.5 && position.y > g_simConstants.neckY - 2.0) {
        displacement.y = max(displacement.y, 0.0);
    }

    // Bound transport BEFORE G2P derives its affine deformation, not afterward.
    let len = length(displacement);
    if (len > g_simConstants.maxStep) {
        displacement *= g_simConstants.maxStep / len;
        if (g_simConstants.iteration + 1u == g_simConstants.iterationCount) { atomicAdd(&counters[0], 1u); }
    }
    if (g_simConstants.iteration + 1u == g_simConstants.iterationCount) {
        atomicMax(&counters[1], u32(min(len, 1000.0) * 1000.0));
    }
    grid[address] = encodeFixedPoint(displacement.x, fpm);
    grid[address+1] = encodeFixedPoint(displacement.y, fpm);
}
