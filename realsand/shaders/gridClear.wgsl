//-----------------------------------------------------------------------------
// Hourglass sand lab: zero the next grid where this substep's sand can reach
// (the active tiles Smoosh's bukkitAllocate lists), instead of the whole grid.
// Then, with surf.x > 0, the surface pass: from the grid the last substep's
// final P2G wrote, each node of the active tiles gets the push down an
// over-steep free surface that g2p2g.wgsl adds where gravity enters (load.yz,
// cells/s^2), and its memory (load.w, substeps left).
// Uses the shared include derived from EA pbmpm / Smoosh: see ../LICENSES.md.
// Part of the Hourglass project (GPL-3.0).
//-----------------------------------------------------------------------------
//!include common.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage,read_write> grid: array<i32>;
@group(0) @binding(2) var<storage> activeBuckets: array<u32>;
@group(0) @binding(3) var<storage> gridArgs: array<u32>;
// the other grid: the one the last substep's final P2G wrote (momentum x, y, mass, volume)
@group(0) @binding(4) var<storage> srcGrid: array<i32>;
// the glass (domain.inc.wgsl): texel (i, j) is node (i, j); z: signed distance, + inside
@group(0) @binding(5) var<storage> g_domain: array<vec4f>;
// per node, x: load.wgsl's depth (not touched here); y, z: the push, cells/s^2; w: the memory
@group(0) @binding(6) var<storage,read_write> load: array<vec4f>;

// a filled node holds a mass of about 1 (4 points of 1/4); a quarter of that is sand (load.wgsl)
const SurfFilled = 0.25;
// no push while the glass turns faster than this (rad/s): a spin is not a lean
const SurfOmegaMax = 1.0;
// a surface is there where the fill's smoothed gradient is at least this, per cell
const SurfEdge = 0.15;
// the node is at least this far inside the glass, cells
const SurfWall = 3.0;

fn inGrid(q: vec2i) -> bool {
    return all(q >= vec2i(0)) && all(q < vec2i(g_simConstants.gridSize));
}
fn massAt(q: vec2i) -> f32 {
    if (!inGrid(q)) { return 0.0; }
    return decodeFixedPoint(srcGrid[gridVertexIndex(vec2u(q), g_simConstants.gridSize) + 2u], g_simConstants.fixedPointMultiplier);
}
fn wallAt(q: vec2i) -> f32 {
    return g_domain[u32(q.y) * g_simConstants.gridSize.x + u32(q.x)].z;
}
// the fill at q, 0 to 1; the glass (and beyond the grid) is solid, never air: 1
fn fillAt(q: vec2i) -> f32 {
    if (!inGrid(q) || wallAt(q) < 1.5) { return 1.0; }
    return min(massAt(q), 1.0);
}

// The push at node id, written with its memory: zero (the memory run down) at the first test
// that fails, so that no node keeps a value from an earlier substep.
fn surfaceNode(id: vec2u) {
    let n = id.y * g_simConstants.gridSize.x + id.x;
    let c = vec2i(id);
    // (w: the memory, whole substeps, + 0.5 on a node of the surface layer with the skin hold, surf.x = 4)
    let mPrev = floor(load[n].w);
    let depthWas = load[n].x;
    let mNew = max(mPrev - 1.0, 0.0);
    load[n] = vec4f(depthWas, 0.0, 0.0, mNew);
    // sand at the node
    let m = massAt(c);
    if (m < SurfFilled) { return; }
    // the field: the sand's own g, not a jolt, a shake or a spin
    let ge = g_simConstants.gravity;
    let gl = length(ge);
    if (gl <= 1e-3) { return; }
    let g0 = g_simConstants.surf3.z;
    if (g0 > 0.0 && abs(gl - g0) > 0.25 * g0) { return; }
    if (abs(g_simConstants.omega) > SurfOmegaMax) { return; }
    // nothing near the neck: its throttle, the shut gate's floor and the membrane see the sand as before
    let rn = g_simConstants.gate.y;
    let k1 = g_simConstants.surf2.z;
    let wN = smoothstep(k1 * rn, (k1 + g_simConstants.surf2.w) * rn, length(vec2f(id) + 0.5 - g_simConstants.center));
    if (wN <= 0.0) { return; }
    // nor at the glass
    if (wallAt(c) < SurfWall) { return; }
    // slow sand only: the push starts sheets and keeps a trickle going, it never drives a flow
    let base = gridVertexIndex(id, g_simConstants.gridSize);
    let fpm = g_simConstants.fixedPointMultiplier;
    let v = length(vec2f(decodeFixedPoint(srcGrid[base], fpm), decodeFixedPoint(srcGrid[base + 1u], fpm)) / m) / g_simConstants.deltaTime;
    let vMove = 0.02 * sqrt(2.0 * gl * f32(g_simConstants.gridSize.y));
    let slow = 1.0 - smoothstep(g_simConstants.surf3.x * vMove, g_simConstants.surf3.y * vMove, v);
    if (slow <= 0.0) { return; }
    // the depth under the free surface along "up"; glass above (a ceiling): covered, never pushed
    let up = -ge / gl;
    let Ds = g_simConstants.surf2.y;
    let K = i32(ceil(Ds)) + 1;
    var k = 1;
    loop {
        if (k > K) { return; }
        let q = vec2i(round(vec2f(id) + up * f32(k)));
        if (!inGrid(q) || wallAt(q) < 0.5) { return; }
        if (massAt(q) < SurfFilled) { break; }
        k++;
    }
    let wD = 1.0 - smoothstep(Ds - 1.0, Ds, f32(k - 1) + 0.5);
    let skin = select(0.0, 0.5, g_simConstants.surf.x > 3.5 && g_simConstants.surf.x < 5.5 && f32(k - 1) + 0.5 <= Ds);
    load[n].w = mNew + skin;
    if (wD <= 0.0) { return; }
    // the free surface's outward normal: the fill's gradient, Gaussian-weighted over 5 x 5 nodes
    var G = vec2f(0.0);
    var S = 0.0;
    for (var j = -2; j <= 2; j++) {
        for (var i = -2; i <= 2; i++) {
            let w = exp(-f32(i * i + j * j) / 4.0);
            G += w * fillAt(c + vec2i(i, j)) * vec2f(f32(i), f32(j));
            S += w * f32(i * i);
        }
    }
    let Gl = length(G);
    if (Gl < SurfEdge * S) { return; }
    let nOut = -G / Gl;
    let cphi = clamp(dot(nOut, up), -1.0, 1.0);
    let phi = degrees(acos(cphi));
    // over-steep: past the start angle at rest, past the lower stop angle while it runs
    let th = select(g_simConstants.surf.z, g_simConstants.surf.w, mPrev > 0.0);
    let s = smoothstep(th, th + g_simConstants.surf2.x, phi);
    if (s <= 0.0) { return; }
    // down the surface
    var t = -up - dot(-up, nOut) * nOut;
    let tl = length(t);
    if (tl < 1e-3) { return; }
    t = t / tl;
    // (the probe, surf.x = 2: the push at 0.3 g, for the readout only; 3: the push and its shift)
    let dmu = select(g_simConstants.surf.y, 0.3, g_simConstants.surf.x > 1.5 && g_simConstants.surf.x < 2.5);
    let a = dmu * gl * max(cphi, 0.3) * s * slow * wD * wN;
    if (a <= 0.0) { return; }
    load[n] = vec4f(depthWas, t * a, g_simConstants.surf3.w + skin);
}

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) invocation: vec3u) {
    if (invocation.x >= gridArgs[3] * 36u) { return; }
    let bucket = activeBuckets[invocation.x / 36u];
    let node = invocation.x % 36u;
    let id = vec2u(bucket % g_simConstants.bukkitCountX, bucket / g_simConstants.bukkitCountX) * 6u + vec2u(node % 6u, node / 6u);
    if (any(id >= g_simConstants.gridSize)) { return; }
    let address = gridVertexIndex(id, g_simConstants.gridSize);
    grid[address] = 0; grid[address+1] = 0; grid[address+2] = 0; grid[address+3] = 0;
    if (g_simConstants.surf.x > 0.5) { surfaceNode(id); }
}
