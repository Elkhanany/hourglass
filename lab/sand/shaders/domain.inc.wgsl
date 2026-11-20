//-----------------------------------------------------------------------------
// Smoosh: Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see ../LICENSES.md)
// Hourglass sand lab: texel (i, j) holds the glass at (i + 0.5, j + 0.5),
// where grid node (i, j) sits. Part of the Hourglass project (GPL-3.0).
//-----------------------------------------------------------------------------

// g_domain: (inward normal x, y, signed distance (+ inside), inside)
fn sampleDomain(p: vec2f) -> vec4f {
    let q = clamp(p - 0.5, vec2f(0), vec2f(g_simConstants.gridSize) - 1.001);
    let lo = vec2u(q);
    let hi = min(lo + 1u, g_simConstants.gridSize - 1u);
    let t = fract(q);
    let a = mix(g_domain[lo.y * g_simConstants.gridSize.x + lo.x], g_domain[lo.y * g_simConstants.gridSize.x + hi.x], t.x);
    let b = mix(g_domain[hi.y * g_simConstants.gridSize.x + lo.x], g_domain[hi.y * g_simConstants.gridSize.x + hi.x], t.x);
    return mix(a, b, t.y);
}
