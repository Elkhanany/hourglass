//-----------------------------------------------------------------------------
// Hourglass sand lab (GPL-3.0 project): clear the sub-cell density grid
// (spacing half a cell) before the points spread on it. Uses the shared
// include derived from EA pbmpm / Smoosh: see ../LICENSES.md.
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage,read_write> fine: array<i32>;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    let n = (2u * g_simConstants.gridSize.x + 2u) * (2u * g_simConstants.gridSize.y + 2u);
    if (id.x < n) { fine[id.x] = 0; }
}
