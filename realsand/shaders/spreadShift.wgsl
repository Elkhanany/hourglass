//-----------------------------------------------------------------------------
// Hourglass sand lab (GPL-3.0 project): points that crowd closer than the
// grains they stand for move apart. Each sand point reads the sub-cell density
// of the OTHER points around it (its own share taken out) and, where that is
// above what an evenly packed bed gives, steps a little down its gradient. A
// position correction only: the velocity is left alone, so it cannot throw the
// sand; where the sand is thin (a free surface, spray) nothing moves. With the
// metered neck on, no step carries a point across the counting line.
// Its entry point csBeds, at the substeps the solver asks for (while a fall is
// possible, never at a run's last), also sums each bulb's bed at the substep's
// end, for the sound's fastest fall (bedPeak, below; prepare.wgsl keeps the fastest).
// Shared include: see ../LICENSES.md.
//-----------------------------------------------------------------------------
//!include common.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage,read_write> particles: array<Particle>;
@group(0) @binding(3) var<storage> fine: array<i32>;
@group(0) @binding(4) var<storage> g_domain: array<vec4f>;
// the beds at this substep's end, for the sound (solver.mjs PEAK_*), summed only by csBeds (solver.mjs
// run: while the app says a fall is possible, and never at a run's last substep, which the tally
// has) into the substep's slot of 8 words (spread.w): [0-3] the bulb above the counting line, [4-7]
// the one on it or below, each over its points in a bed (crowded, as tally.wgsl counts them): [+0, +1] their summed
// velocity, x and y (each cells/s x 4, a point's speed capped at BedCap; signed, two's
// complement), [+2] how many they are, [+3] how many of them move (as tally.wgsl's [7]). After
// the run prepare.wgsl's csKeep turns them into the beds' fastest falls and clears them; the
// words after the slots are those falls, csKeep's alone.
@group(0) @binding(5) var<storage,read_write> bedPeak: array<atomic<u32>>;

const FineScale = 100000.0;
// as tally.wgsl's
const Crowded = 0.6;
const BedCap = 2000.0;
// in the workgroup's memory, three words a bulb: x, y, and the count with the moving count above
// bit 16 (a workgroup has 64 points), split into the two words when added to bedPeak
var<workgroup> w_bed: array<atomic<u32>, 6>;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x < count[0]) { shiftPoint(id.x); }
}

// the same, with the beds summed first (solver.mjs's spreadShiftBeds pipeline, at the substeps it
// asks for; an entry point of its own, and sumBed reached from it alone, so that csMain has no
// barrier, no workgroup memory and no atomics: a software GPU runs a shader that has them more
// slowly, whether or not they are reached)
@compute @workgroup_size(64)
fn csBeds(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32) {
    if (li < 6u) { atomicStore(&w_bed[li], 0u); }
    workgroupBarrier();
    // (no return before the last barrier: every invocation of the workgroup must reach it)
    if (id.x < count[0]) { sumBed(particles[id.x]); shiftPoint(id.x); }
    workgroupBarrier();
    if (li < 6u) {
        let v = atomicLoad(&w_bed[li]);
        if (v != 0u) {
            // (this substep's slot of sums: spread.w, solver.mjs run)
            let o = u32(g_simConstants.spread.w + 0.5) * 8u + (li / 3u) * 4u; let w = li % 3u;
            if (w < 2u) { atomicAdd(&bedPeak[o + w], v); }
            else {
                atomicAdd(&bedPeak[o + 2u], v & 0xffffu);
                if ((v >> 16u) != 0u) { atomicAdd(&bedPeak[o + 3u], v >> 16u); }
            }
        }
    }
}

// a point in a bed: its velocity at the substep's end (as tally.wgsl takes it, without the
// prediction of the next substep's field) into its bulb's sums
fn sumBed(p: Particle) {
    if (p.enabled == 0.0 || p.material != f32(MaterialSand) || p.color.y < Crowded) { return; }
    let x = p.position; let d = p.displacement;
    if (!(x.x == x.x && x.y == x.y && d.x == d.x && d.y == d.y) || abs(x.x) > 1e9 || abs(d.x) > 1e9 || abs(d.y) > 1e9) { return; }
    let dt = g_simConstants.deltaTime;
    let vel = d / dt - g_simConstants.gravity * dt;
    let v = length(vel);
    let vc = vel * min(1.0, BedCap / max(v, 1e-6));
    let g = length(g_simConstants.gravity);
    let b = select(3u, 0u, x.y > g_simConstants.neckY);
    atomicAdd(&w_bed[b], bitcast<u32>(i32(round(vc.x * 4.0))));
    atomicAdd(&w_bed[b + 1u], bitcast<u32>(i32(round(vc.y * 4.0))));
    let moves = v > 0.02 * sqrt(2.0 * max(g, 1.0) * f32(g_simConstants.gridSize.y));
    atomicAdd(&w_bed[b + 2u], select(1u, 0x10001u, moves));
}

fn shiftPoint(i: u32) {
    var p = particles[i];
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
    particles[i].position = np;
}
