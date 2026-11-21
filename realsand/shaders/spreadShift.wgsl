//-----------------------------------------------------------------------------
// Hourglass sand lab (GPL-3.0 project): points that crowd closer than the
// grains they stand for move apart. Each sand point reads the sub-cell density
// of the OTHER points around it (its own share taken out) and, where that is
// above what an evenly packed bed gives, steps a little down its gradient. A
// position correction only: the velocity is left alone, so it cannot throw the
// sand; where the sand is thin (a free surface, spray) nothing moves. With the
// metered neck on, no step carries a point across the counting line.
// Shared include: see ../LICENSES.md.
//-----------------------------------------------------------------------------
//!include common.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage,read_write> particles: array<Particle>;
@group(0) @binding(3) var<storage> fine: array<i32>;
@group(0) @binding(4) var<storage> g_domain: array<vec4f>;

const FineScale = 100000.0;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= count[0]) { return; }
    var p = particles[id.x];
    if (p.enabled == 0.0 || p.material != f32(MaterialSand)) { return; }
    // spread.x: how far a crowded point steps (per unit of excess density times its gradient)
    let k = g_simConstants.spread.x;
    // spread.y: the others' density above which a point is crowded (an even 2 x 2 bed gives about 0.75)
    let thr = g_simConstants.spread.y;
    // spread.z: the longest step a substep, cells
    let cap = g_simConstants.spread.z;
    let fw = 2u * g_simConstants.gridSize.x + 2u;
    let q = clamp(p.position * 2.0, vec2f(0.0), vec2f(2.0 * vec2f(g_simConstants.gridSize)));
    let i0 = vec2u(floor(q));
    let f = q - floor(q);
    let w00 = (1.0 - f.x) * (1.0 - f.y);
    let w10 = f.x * (1.0 - f.y);
    let w01 = (1.0 - f.x) * f.y;
    let w11 = f.x * f.y;
    // the others' density at the four nodes (this point's own share removed)
    let o00 = f32(fine[i0.y * fw + i0.x]) / FineScale - w00;
    let o10 = f32(fine[i0.y * fw + i0.x + 1u]) / FineScale - w10;
    let o01 = f32(fine[(i0.y + 1u) * fw + i0.x]) / FineScale - w01;
    let o11 = f32(fine[(i0.y + 1u) * fw + i0.x + 1u]) / FineScale - w11;
    let rho = w00 * o00 + w10 * o10 + w01 * o01 + w11 * o11;
    if (rho <= thr) { return; }
    let grad = vec2f((1.0 - f.y) * (o10 - o00) + f.y * (o11 - o01), (1.0 - f.x) * (o01 - o00) + f.x * (o11 - o10));
    var step = -k * (rho - thr) * grad;
    let len = length(step);
    if (len > cap) { step *= cap / len; }
    var np = p.position + step;
    // with the metered neck on (valve.mjs), never across the counting line: only the membrane
    // (g2p2g.wgsl) lets a point cross, so a shift that would change its side keeps its x part only
    if (neckOn() && ((np.y > g_simConstants.neckY) != (p.position.y > g_simConstants.neckY))) {
        np.y = p.position.y;
    }
    // never into the wall
    if (sampleDomain(np).z < 0.3) { return; }
    particles[id.x].position = np;
}
