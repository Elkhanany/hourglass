//-----------------------------------------------------------------------------
// Smoosh: Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see ../LICENSES.md)
// Hourglass sand lab: the gravity prediction is the glass-frame field; sand's elastic
// strain is rescaled with the step. (GPL-3.0 project)
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage,read_write> particles: array<Particle>;

// PB-MPM stores dt*v and dt*grad(v), not velocities. Retiming must rescale
// both and replace the next-step gravity prediction; sand's elastic F too (below).
@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= count[0] || particles[id.x].enabled == 0.0) { return; }
    var p = particles[id.x];
    p.displacement *= g_simConstants.timeStepRatio;
    p.deformationDisplacement *= g_simConstants.timeStepRatio;
    let dt = g_simConstants.deltaTime;
    p.displacement += g_simConstants.gravity*dt*(dt-g_simConstants.previousDeltaTime);
    // Sand holds its load with an elastic strain in F that goes as dt^2: each substep the
    // constraint pushes back a strain's worth, against the g dt^2 the load presses in. At a new
    // rate (auto Hz) that strain is (dt_old/dt_new)^2 too big, or too small, for the stiffer (or
    // softer) solver, and the bed springs apart (or sags): 480 -> 720 Hz in a fast turn doubled
    // the voids. So the elastic log strain is rescaled by the square of the step ratio, but only
    // when the rate rises: the elastic energy goes as k eps^2 with k ~ 1/dt^2, so the same rescale
    // on a falling rate would add energy to a moving bed (a jerk settled in 41 cells/s at +1 s,
    // not 30); left alone there, the strain is too small for a few substeps and the bed sags, which
    // only takes energy out.
    if (p.material == 2.0) {
        let r = min(g_simConstants.timeStepRatio, 1.0);
        let s = svd(p.deformationGradient);
        let e = log(max(s.Sigma, vec2f(1e-6))) * (r * r);
        p.deformationGradient = s.U * diag(exp(e)) * s.Vt;
    }
    particles[id.x] = p;
}
