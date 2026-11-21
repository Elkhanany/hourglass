//-----------------------------------------------------------------------------
// Hourglass sand lab (GPL-3.0 project): how deep each grid node lies under the
// sand above it, along the field the sand feels (gravity less the glass's
// acceleration). Sand's strength is friction, in proportion to the load it
// carries, and the load at a point is the weight of the sand above it: its
// depth along "up" times g. Measured afresh every substep from the grid's mass
// (the previous substep's), so the strength does not depend on how long the
// sand has lain (g2p2g.wgsl, yieldp.z = 2). One dispatch a substep, over the
// tiles the sand can reach. Uses the shared include derived from EA pbmpm /
// Smoosh: see ../LICENSES.md.
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> grid: array<i32>;
@group(0) @binding(2) var<storage> activeBuckets: array<u32>;
@group(0) @binding(3) var<storage> gridArgs: array<u32>;
// per node: the depth of sand above it along "up", cells (0: no sand at the node)
@group(0) @binding(4) var<storage,read_write> load: array<f32>;

const MaxDepth = 64;

fn massAt(c: vec2i) -> f32 {
    if (any(c < vec2i(0)) || any(c >= vec2i(g_simConstants.gridSize))) { return 0.0; }
    return decodeFixedPoint(grid[gridVertexIndex(vec2u(c), g_simConstants.gridSize) + 2u], g_simConstants.fixedPointMultiplier);
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) invocation: vec3u) {
    if (invocation.x >= gridArgs[3] * 36u) { return; }
    let bucket = activeBuckets[invocation.x / 36u];
    let node = invocation.x % 36u;
    let id = vec2u(bucket % g_simConstants.bukkitCountX, bucket / g_simConstants.bukkitCountX) * 6u + vec2u(node % 6u, node / 6u);
    if (any(id >= g_simConstants.gridSize)) { return; }
    let nodeIndex = id.y * g_simConstants.gridSize.x + id.x;
    // a filled node holds a mass of about 1 (4 points of 1/4); a quarter of that is sand
    let filled = 0.25;
    let g = g_simConstants.gravity;
    let gl = length(g);
    var depth = 0.0;
    if (gl > 1e-3 && massAt(vec2i(id)) >= filled) {
        let up = -g / gl;
        let p = vec2f(id);
        var k = 1;
        loop {
            if (k > MaxDepth) { break; }
            let q = vec2i(round(p + up * f32(k)));
            if (massAt(q) < filled) { break; }
            k++;
        }
        depth = f32(k - 1) + 0.5;
    }
    load[nodeIndex] = depth;
}
