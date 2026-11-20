//-----------------------------------------------------------------------------
// Hourglass sand lab: zero the next grid where this substep's sand can reach
// (the active tiles Smoosh's bukkitAllocate lists), instead of the whole grid.
// Uses the shared include derived from EA pbmpm / Smoosh: see ../LICENSES.md.
// Part of the Hourglass project (GPL-3.0).
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage,read_write> grid: array<i32>;
@group(0) @binding(2) var<storage> activeBuckets: array<u32>;
@group(0) @binding(3) var<storage> gridArgs: array<u32>;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) invocation: vec3u) {
    if (invocation.x >= gridArgs[3] * 36u) { return; }
    let bucket = activeBuckets[invocation.x / 36u];
    let node = invocation.x % 36u;
    let id = vec2u(bucket % g_simConstants.bukkitCountX, bucket / g_simConstants.bukkitCountX) * 6u + vec2u(node % 6u, node / 6u);
    if (any(id >= g_simConstants.gridSize)) { return; }
    let address = gridVertexIndex(id, g_simConstants.gridSize);
    grid[address] = 0; grid[address+1] = 0; grid[address+2] = 0; grid[address+3] = 0;
}
