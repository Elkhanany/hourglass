//-----------------------------------------------------------------------------
// Smoosh: Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see ../LICENSES.md)
// Hourglass sand lab: the gravity prediction is the glass-frame field. (GPL-3.0 project)
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage,read_write> particles: array<Particle>;

// PB-MPM stores dt*v and dt*grad(v), not velocities. Retiming must rescale
// both and replace the next-step gravity prediction; F itself is unchanged.
@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= count[0] || particles[id.x].enabled == 0.0) { return; }
    var p = particles[id.x];
    p.displacement *= g_simConstants.timeStepRatio;
    p.deformationDisplacement *= g_simConstants.timeStepRatio;
    let dt = g_simConstants.deltaTime;
    p.displacement += g_simConstants.gravity*dt*(dt-g_simConstants.previousDeltaTime);
    particles[id.x] = p;
}
