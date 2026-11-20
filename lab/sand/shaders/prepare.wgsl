//-----------------------------------------------------------------------------
// Hourglass sand lab: clear the particle buckets for a substep inside the
// compute pass (Smoosh did this with clearBuffer and copies between passes).
// Uses the shared include derived from EA pbmpm / Smoosh: see ../LICENSES.md.
// Part of the Hourglass project (GPL-3.0).
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage,read_write> bucketCount: array<u32>;
@group(0) @binding(2) var<storage,read_write> bucketInsertCount: array<u32>;
@group(0) @binding(3) var<storage,read_write> allocator: array<u32>;
@group(0) @binding(4) var<storage,read_write> bucketArgs: array<u32>;
@group(0) @binding(5) var<storage,read_write> gridArgs: array<u32>;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < g_simConstants.bukkitCount) {
        bucketCount[id.x] = 0u;
        bucketInsertCount[id.x] = 0u;
    }
    if (id.x == 0u) {
        allocator[0] = 0u;
        bucketArgs[0] = 0u; bucketArgs[1] = 1u; bucketArgs[2] = 1u; bucketArgs[3] = 0u;
        gridArgs[0] = 0u; gridArgs[1] = 1u; gridArgs[2] = 1u; gridArgs[3] = 0u;
    }
}
