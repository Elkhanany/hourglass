//-----------------------------------------------------------------------------
// Hourglass sand lab: every material point drawn as one grain, coloured from
// the app's Sahara palette (physics.js THEMES.sahara, _buildLUT), each grain
// its own shade. The quad-per-particle idea follows Smoosh's density.wgsl:
// Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see ../LICENSES.md);
// the particle layout is EA's (BSD-3-Clause, see ../LICENSES.md).
// Part of the Hourglass project (GPL-3.0).
//-----------------------------------------------------------------------------

struct Particle {
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
    padding: f32,
    color: vec3f,
};

struct View {
    m: vec4f,      // clip.x = m.x*gx + m.y*gy + o.x ; clip.y = m.z*gx + m.w*gy + o.y
    o: vec4f,      // o.zw: the grain's radius in clip units
    look: vec4f,   // x: 0 sand, 1 liquid; y: opacity; z: exposure: the streak, cells, per cell of a substep's displacement (exposure s x substeps/s; 0: no blur)
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage> particles: array<Particle>;
@group(0) @binding(2) var<storage> palette: array<vec4f, 256>;

struct VertexOut {
    @builtin(position) position: vec4f,
    // along and across the streak, in grain radii
    @location(0) local: vec2f,
    @location(1) color: vec4f,
    // x, y: the streak's direction on screen; z: its half-length, grain radii
    @location(2) @interpolate(flat) streak: vec3f,
};

fn hash(input: u32) -> u32 {
    let state = input * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

@vertex fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> VertexOut {
    let corners = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1));
    let p = particles[index];
    let h = hash(index * 2654435761u + 17u);
    let local = corners[vertex];
    // grains differ a little in size
    let size = 0.8 + 0.4 * f32((h >> 8u) & 255u) / 255.0;
    let c = vec2f(view.m.x * p.position.x + view.m.y * p.position.y + view.o.x,
                  view.m.z * p.position.x + view.m.w * p.position.y + view.o.y);
    // Motion blur: where the grain went during the exposure (the eye's, or a display frame's),
    // in units of its own radius. A grain falling through the neck at a few hundred cells/s
    // crosses several cells in a frame, so it is seen as a streak, as a real falling grain is.
    let s = p.displacement * view.look.z;
    let sc = vec2f(view.m.x * s.x + view.m.y * s.y, view.m.z * s.x + view.m.w * s.y);
    let u = sc / max(view.o.zw * size, vec2f(1e-9));
    let len = length(u);
    let e = select(vec2f(1.0, 0.0), u / max(len, 1e-9), len > 1e-4);
    let n = vec2f(-e.y, e.x);
    let hl = 0.5 * len;
    // the quad: around the streak from where the grain was to where it is
    let q = -0.5 * u + e * local.x * (1.0 + hl) + n * local.y;
    var out: VertexOut;
    out.position = vec4f(c + q * view.o.zw * size, 0.0, 1.0);
    if (p.enabled == 0.0) { out.position = vec4f(-9.0, -9.0, 0.0, 1.0); }
    out.local = vec2f(local.x * (1.0 + hl), local.y);
    out.streak = vec3f(e, hl);
    var col = palette[h & 255u];
    // a shade of its own: light and dark grains side by side
    let shade = 0.84 + 0.30 * f32((h >> 16u) & 255u) / 255.0;
    out.color = vec4f(col.rgb * shade, col.a);
    return out;
}

@fragment fn fragmentMain(v: VertexOut) -> @location(0) vec4f {
    // a disc, drawn out along the streak (a capsule); without blur (half-length 0) the disc as before
    let hl = v.streak.z;
    let along = sign(v.local.x) * max(abs(v.local.x) - hl, 0.0);
    let ql = vec2f(along, v.local.y);
    let r2 = dot(ql, ql);
    if (r2 > 1.0) { discard; }
    // the same light falls on the grain whatever its streak: back to screen axes
    let d = v.streak.xy * ql.x + vec2f(-v.streak.y, v.streak.x) * ql.y;
    // the grain's light is spread along its streak: a blurred grain is fainter, as on film
    let spread = 1.0 / (1.0 + hl);
    // a rounded grain lit from the upper left; mica (alpha > 1) glints
    let light = normalize(vec2f(-0.55, 0.65));
    let lit = 0.78 + 0.30 * dot(d, light) * (1.0 - 0.3 * r2) + 0.12 * (1.0 - r2);
    var rgb = v.color.rgb * lit;
    if (v.color.a > 1.5) { rgb += vec3f(0.35) * max(0.0, 1.0 - 4.0 * dot(d - vec2f(-0.3, 0.3), d - vec2f(-0.3, 0.3))); }
    if (view.look.x > 0.5) {
        // liquid: soft round drops that run together
        let a = view.look.y * (1.0 - r2 * r2) * spread;
        return vec4f(rgb * a, a);
    }
    let edge = clamp((1.0 - r2) * 4.0, 0.0, 1.0);
    let a = view.look.y * edge * spread;
    return vec4f(rgb * a, a);
}
