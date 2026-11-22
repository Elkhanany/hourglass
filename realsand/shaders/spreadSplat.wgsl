//-----------------------------------------------------------------------------
// Hourglass sand lab (GPL-3.0 project): every sand point adds itself to the
// sub-cell density grid (nodes half a cell apart, bilinear weights), so that
// points crowding together inside a cell, which the solver's grid (one cell)
// cannot see, can be told apart. Shared include: see ../LICENSES.md.
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage> particles: array<Particle>;
@group(0) @binding(3) var<storage,read_write> fine: array<atomic<i32>>;

const FineScale = 100000.0;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= count[0]) { return; }
    let p = particles[id.x];
    if (p.enabled == 0.0 || p.material != f32(MaterialSand)) { return; }
    let fw = 2u * g_simConstants.gridSize.x + 2u;
    let q = clamp(p.position * 2.0, vec2f(0.0), vec2f(2.0 * vec2f(g_simConstants.gridSize)));
    let i0 = vec2u(floor(q));
    let f = q - floor(q);
    let w = array<f32, 4>((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    let o = array<vec2u, 4>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 1u));
    for (var k = 0; k < 4; k++) {
        let c = i0 + o[k];
        atomicAdd(&fine[c.y * fw + c.x], i32(w[k] * FineScale));
    }
}
