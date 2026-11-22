//-----------------------------------------------------------------------------
// Hourglass sand engine: the flip pass (GPL-3.0 project). At a swap the app
// turns its glass's record end for end (physics.js completeFlip), so that the
// sand always drains toward -y; the GPU's points follow in the next run, which
// begins with this pass: each point is turned half a turn about the glass's
// centre, which on this point-symmetric glass is exact. A point exactly on
// the counting line (counted as below, tally.wgsl) is first moved just below
// it, so every point that was below is above after the pass and the tally's
// count below is the exact count above (solver.mjs copies it). The
// deformation gradient and its affine part are unchanged under a half turn;
// the displacement turns with the point.
// (Uses the shared include derived from EA pbmpm / Smoosh: see ../LICENSES.md)
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage,read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= count[0] || particles[id.x].enabled == 0.0) { return; }
    var p = particles[id.x];
    if (p.position.y == g_simConstants.neckY) { p.position.y = g_simConstants.neckY - 0.01; }
    p.position = 2.0 * g_simConstants.center - p.position;
    p.displacement = -p.displacement;
    particles[id.x].position = p.position;
    particles[id.x].displacement = p.displacement;
}
