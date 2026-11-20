//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
// (BSD-3-Clause, see ../LICENSES.md)
// Smoosh adaptation: Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see ../LICENSES.md)
// Hourglass sand lab changes: one material at a time, a glass-frame body
// force (any gravity, the glass's own acceleration and turning), Coulomb wall
// friction, a neck gate. Part of the Hourglass project (GPL-3.0).
//
// This file gathers what EA's and Smoosh's dispatch.inc, simConstants.inc,
// particle.inc, matrix.inc, bukkit.inc and domain.inc held.
//-----------------------------------------------------------------------------

const ParticleDispatchSize = 64;
const GridDispatchSize = 8;
const BukkitSize = 6;
const BukkitHaloSize = 1;
const GuardianSize = 3;

const MaterialLiquid = 0;
const MaterialElastic = 1;
const MaterialSand = 2;
const MaterialVisco = 3;

struct MaterialParams {
    // x: viscosity, y: liquid relaxation, z: elasticity ratio, w: plasticity
    mechanical: vec4f,
    // x: friction angle (degrees), y: density, z: elastic relaxation, w: model
    physical: vec4f,
};

struct SimConstants {
    gridSize: vec2u,
    deltaTime: f32,
    fixedPointMultiplier: u32,
    bukkitCount: u32,
    bukkitCountX: u32,
    bukkitCountY: u32,
    iteration: u32,
    iterationCount: u32,
    useGridVolumeForLiquid: u32,
    particlesPerCellAxis: u32,
    bucketParticleOffset: u32,
    // the field the sand feels in the glass's own frame, grid cells/s², y up:
    // gravity less the glass's acceleration (uniform part)
    gravity: vec2f,
    // the glass's centre (the neck), grid coordinates: the turning terms act about it
    center: vec2f,
    // the glass's turning in the grid's frame (rad/s, rad/s², counter-clockwise +)
    omega: f32,
    alpha: f32,
    // Coulomb friction of sand on glass (tan of the wall friction angle)
    wallFriction: f32,
    // viscous drag at the wall, per substep (liquids)
    wallDrag: f32,
    // the most a grid node may move in one substep, cells
    maxStep: f32,
    // the Coriolis term's factor (0: left out); with omega scaled by sqrt(lambda)
    // for a slowed world, sqrt(lambda) gives 2 lambda w x v
    coriolis: f32,
    simFrame: u32,
    timeStepRatio: f32,
    previousDeltaTime: f32,
    // the neck's height, grid y
    neckY: f32,
    // x: 1 while the neck is closed, y: the neck's half-width, cells
    gate: vec2f,
    material: MaterialParams,
    // sand: x, y, z: unused; w: how far loose sand may be compressed freely, as a share of its
    // looseness (0: not at all; it packs down at the rate its load gets through the constraint)
    sand: vec4f,
    // the points' spreading (spreadShift.wgsl): x: step, y: crowding threshold, z: longest step
    // (cells); w: unused
    spread: vec4f,
    // sand's packing state (g2p2g.wgsl): x: how fast sand packed down again from a loosened
    // state gains packing (0: never); y: the densest packing it reaches (1: the fill's);
    // z: how fast plastic shear loosens it back toward the fill's packing; w: unused
    compaction: vec4f,
    // sand's yield inside the iterations (g2p2g.wgsl): x: 1 on (0: EA's clamp target); y: the
    // share of the friction cone it uses there (yieldScale); z, w: unused
    yieldp: vec4f,
};

fn divUp(threadCount : u32, divisor : u32) -> u32
{
    return (threadCount + divisor - 1) / divisor;
}

fn gridVertexIndex(gridVertex : vec2u, gridSize : vec2u) -> u32
{
    // 4 components per grid vertex: momentum x, momentum y, mass, volume
    return u32(4*(gridVertex.y * gridSize.x + gridVertex.x));
}

fn decodeFixedPoint(fixedPoint : i32, fixedPointMultiplier : u32) -> f32
{
    return f32(fixedPoint) / f32(fixedPointMultiplier);
}

fn encodeFixedPoint(floatingPoint : f32, fixedPointMultiplier: u32) -> i32
{
    return i32(floatingPoint * f32(fixedPointMultiplier));
}

// ---- particle.inc ---------------------------------------------------------

struct Particle
{
    position : vec2f,
    displacement : vec2f,
    deformationGradient : mat2x2f,
    deformationDisplacement : mat2x2f,

    liquidDensity : f32,
    logJp : f32,
    lambda: f32,
    enabled: f32,

    mass: f32,
    volume: f32,
    material: f32,
    padding: f32,       // sand: the point's own packing (g2p2g.wgsl; 0: not yet set)
    color: vec3f,       // x: the grain's own random number (drawing only)
}; // 24 floats

fn projectInsideGuardian(p : vec2f, gridSize : vec2u, guardianSize : f32) -> vec2f
{
    let clampMin = vec2f(guardianSize);
    let clampMax = vec2f(gridSize) - vec2f(guardianSize,guardianSize) - vec2f(1,1);
    return clamp(p, vec2f(clampMin), vec2f(clampMax));
}

struct QuadraticWeightInfo
{
    weights: array<vec2f, 3>,
    cellIndex: vec2f,
}

fn pow2(x: vec2f) -> vec2f
{
    return x*x;
}

fn quadraticWeightInit(position: vec2f) -> QuadraticWeightInfo
{
    let roundDownPosition = floor(position);
    let offset = (position - roundDownPosition) - 0.5;
    return QuadraticWeightInfo(
        array(
        0.5 * pow2(0.5 - offset),
        0.75 - pow2(offset),
        0.5 * pow2(0.5 + offset)
        ),
        roundDownPosition - 1,
    );
}

// ---- matrix.inc -----------------------------------------------------------

struct SVDResult
{
    U: mat2x2f,
    Sigma: vec2f,
    Vt: mat2x2f,
};

fn svd(m: mat2x2f) -> SVDResult
{
    // Pedro Gimeno (https://scicomp.stackexchange.com/users/9673/pedro-gimeno),
    // Robust algorithm for 2x2 SVD, URL (version: 2019-10-22): https://scicomp.stackexchange.com/q/14103
    let E = (m[0][0] + m[1][1])*0.5;
    let F = (m[0][0] - m[1][1])*0.5;
    let G = (m[0][1] + m[1][0])*0.5;
    let H = (m[0][1] - m[1][0])*0.5;

    let Q = sqrt(E*E + H*H);
    let R = sqrt(F*F + G*G);
    let sx = Q + R;
    let sy = Q - R;

    let a1 = select(atan2(G, F), 0.0, F == 0.0 && G == 0.0);
    let a2 = select(atan2(H, E), 0.0, E == 0.0 && H == 0.0);

    let theta = (a2 - a1)*0.5;
    let phi = (a2 + a1)*0.5;

    let U = rot(phi);
    let Sigma = vec2f(sx, sy);
    let Vt = rot(theta);

    return SVDResult(U, Sigma, Vt);
}

fn det(m: mat2x2f) -> f32
{
    return m[0][0]*m[1][1] - m[0][1]*m[1][0];
}

fn tr(m: mat2x2f) -> f32
{
    return m[0][0] + m[1][1];
}

fn rot(theta: f32) -> mat2x2f
{
    let ct = cos(theta);
    let st = sin(theta);
    return mat2x2f(ct, st, -st, ct);
}

fn inverse(m: mat2x2f) -> mat2x2f
{
    // invertible: its singular values were clamped at integration
    let a = m[0][0];
    let b = m[1][0];
    let c = m[0][1];
    let d = m[1][1];
    return (1.0 / det(m))*mat2x2f(d, -c, -b, a);
}

fn outerProduct(x: vec2f, y: vec2f) -> mat2x2f
{
    return mat2x2f(x*y.x, x*y.y);
}

fn diag(d: vec2f) -> mat2x2f
{
    return mat2x2f(d.x, 0, 0, d.y);
}

const Identity = mat2x2f(1,0,0,1);
const ZeroMatrix = mat2x2f(0,0,0,0);

// ---- bukkit.inc -----------------------------------------------------------

fn bukkitAddressToIndex(address: vec2u, bukkitCountX: u32) -> u32
{
    return address.y*bukkitCountX + address.x;
}

fn positionToBukkitId(position: vec2f) -> vec2i
{
    return vec2i((position) / f32(BukkitSize));
}

struct BukkitThreadData
{
    rangeStart: u32,
    rangeCount: u32,
    bukkitX: u32,
    bukkitY: u32,
};

// ---- domain.inc (the glass) ---------------------------------------------------

fn safeNormal(n: vec2f) -> vec2f {
    return n / max(length(n), 0.00001);
}

// The body force on sand at p moving at v (cells/s), in the glass's frame:
// gravity less the glass's acceleration, then the turning glass's Euler and
// centrifugal terms about its centre, and (optionally) Coriolis.
fn bodyForce(p: vec2f, v: vec2f) -> vec2f {
    let r = p - g_simConstants.center;
    let w = g_simConstants.omega;
    let a = g_simConstants.alpha;
    var f = g_simConstants.gravity + w*w*r - a*vec2f(-r.y, r.x);
    f -= g_simConstants.coriolis * 2.0 * w * vec2f(-v.y, v.x);
    return f;
}
