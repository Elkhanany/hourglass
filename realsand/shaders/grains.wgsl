//-----------------------------------------------------------------------------
// Hourglass sand engine: every material point drawn as one grain, its colour
// from a 256-entry palette by the grain's own seed (color.x: the app's seed
// for the grain at that place, or the lab's seed for its index), each grain
// its own size and shade. The quad-per-particle idea follows Smoosh's
// density.wgsl: Copyright (c) 2024 Alex Birch & Erik Sombroek (MIT, see
// ../LICENSES.md); the particle layout is EA's (BSD-3-Clause, see
// ../LICENSES.md). Part of the Hourglass project (GPL-3.0).
//
// For the app (grains.mjs encode's look; the lab leaves them at their defaults,
// which draw as the lab always has):
// - the neck warp: the solver's neck is wider than the drawn glass's, so each
//   point is drawn at x = cx + (x - cx) warp(y), warp the drawn half-width over
//   the simulated one at its height (1 away from the neck): every grain lies
//   inside the neck the app draws;
// - the light: the app's canvas turns with the glass (CSS), so the light is
//   turned back by the glass's angle on screen and stays with the room;
// - the Reset's sweep (glass/renderer.js Renderer._sweepOut, _sweepIn): the old sand
//   drawn into the neck, then the new sand shown from the neck up under a
//   rising surface, with the thread that pours it.
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
    look: vec4f,   // x: 0 sand, 1 liquid; y: opacity; z: exposure: the streak, cells, per cell of a substep's displacement (exposure s x substeps/s; 0: no blur);
                   // w: the crowding at and above which a grain is drawn sharp (main.mjs FLIGHT; 0: every grain streaks)
    neck: vec4f,   // x, y: the neck's centre (grid); z: rows of the warp (0: no warp); w: the grains in the glass (count)
    light: vec4f,  // x, y: cos and sin of the light's turn (the glass's angle on screen; 1, 0: the lab's light)
    // the Reset's sweep (grid units): x: 0 none, 1 the old sand goes, 2 the new comes.
    // 1: y: S, what every grain's squared distance from the neck falls by; z: the least squared distance still drawn
    // 2: y: the apex of the revealed surface (grid y); z: its slope (rise over run); w: the thread's share of grains shown (0 to 1)
    sweep: vec4f,
    // 2, the thread: x: its lower end (grid y); y: its upper end; z: the cells it spreads across each side; w: the frame (its grains change each frame)
    thread: vec4f,
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage> particles: array<Particle>;
@group(0) @binding(2) var<storage> palette: array<vec4f, 256>;
// per grid row (its centre), the drawn half-width over the simulated one (glass.mjs warp)
@group(0) @binding(3) var<storage> warp: array<f32>;

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

/** The drawn half-width over the simulated one at grid height y (1 without a warp). */
fn warpAt(y: f32) -> f32 {
    let rows = view.neck.z;
    if (rows < 1.0) { return 1.0; }
    let q = clamp(y - 0.5, 0.0, rows - 1.0);
    let j = u32(floor(q));
    let j1 = min(j + 1u, u32(rows) - 1u);
    return mix(warp[j], warp[j1], q - floor(q));
}

/** A grain of the thread that pours the new sand in (the sweep's second half): x, y, and 1 if it is drawn. */
fn threadGrain(k: u32) -> vec3f {
    let h = hash((k * 2654435761u) ^ (u32(view.thread.w) * 2246822519u));
    let lo = view.thread.x; let hi = view.thread.y;
    // a few grains abreast, most of them on the axis; a new pick each frame, so it pours
    let u = f32(h & 1023u) / 1024.0;
    let across = f32((h >> 10u) & 255u) / 255.0 * 2.0 - 1.0;
    let x = view.neck.x + across * abs(across) * view.thread.z;
    let y = mix(lo, hi, u);
    let keep = f32((h >> 18u) & 255u) / 256.0 < view.sweep.w;
    return vec3f(x, y, select(0.0, 1.0, keep && hi > lo));
}

@vertex fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> VertexOut {
    let corners = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1));
    let local = corners[vertex];
    let count = u32(view.neck.w);
    var pos: vec2f;
    var disp = vec2f(0.0);
    var seed: u32;
    var crowd = 1.0;
    var shown = true;
    var lift = 1.0;
    let h = hash(index * 2654435761u + 17u);
    if (index >= count) {
        // the sweep's thread: grains falling from the top of the bulb onto the rising sand,
        // in the new bed's colours (each the seed of a grain picked from it)
        let g = threadGrain(index - count);
        pos = g.xy; shown = g.z > 0.5;
        seed = u32(particles[hash(index ^ (u32(view.thread.w) * 40503u)) % max(count, 1u)].color.x) & 255u;
        lift = 1.06;
    } else {
        let p = particles[index];
        pos = p.position; disp = p.displacement; crowd = p.color.y;
        // the grain's seed (bits 8 and up mark layered sand's fresh grains: tone.wgsl)
        seed = u32(p.color.x) & 255u;
        if (p.enabled == 0.0) { shown = false; }
        // drawn inside the neck the app draws
        let k = warpAt(pos.y);
        pos.x = view.neck.x + (pos.x - view.neck.x) * k;
        disp.x = disp.x * k;
        if (view.sweep.x == 1.0) {
            // the old sand drawn into the neck, as a sheet flows into a point sink: r'^2 = r^2 - S
            let d = pos - view.neck.xy;
            let r2 = dot(d, d);
            let q2 = r2 - view.sweep.y;
            if (q2 <= view.sweep.z) { shown = false; }
            else { pos = view.neck.xy + d * sqrt(q2 / r2); }
            disp = vec2f(0.0);
        } else if (view.sweep.x == 2.0 && pos.y > view.neck.y) {
            // the new sand shown up to the surface the pour has reached, heaped under the thread
            if (pos.y > view.sweep.y - view.sweep.z * abs(pos.x - view.neck.x)) { shown = false; }
        }
    }
    // grains differ a little in size
    let size = 0.8 + 0.4 * f32((h >> 8u) & 255u) / 255.0;
    let c = vec2f(view.m.x * pos.x + view.m.y * pos.y + view.o.x,
                  view.m.z * pos.x + view.m.w * pos.y + view.o.y);
    // Motion blur: where the grain went during the exposure (the eye's, or a display frame's),
    // in units of its own radius. A grain falling through the neck at a few hundred cells/s
    // crosses several cells in a frame, so it is seen as a streak, as a real falling grain is.
    // The eye follows a bed that moves as a whole (a jerk, a shake, a turn) and sees it sharp; it
    // cannot follow the grains of a stream or a spray, whose pattern stands still while they fly
    // through it. So only a grain with little sand around it is drawn as its streak: how crowded it
    // is comes from the grid (g2p2g.wgsl, color.y), and the streak fades out from half the
    // threshold to the threshold (main.mjs flightOf() is the same rule).
    let hi = view.look.w;
    let flight = select(1.0, 1.0 - smoothstep(0.5 * hi, hi, crowd), hi > 0.0);
    let s = disp * view.look.z * flight;
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
    if (!shown) { out.position = vec4f(-9.0, -9.0, 0.0, 1.0); }
    out.local = vec2f(local.x * (1.0 + hl), local.y);
    out.streak = vec3f(e, hl);
    let col = palette[seed];
    // a shade of its own: light and dark grains side by side
    let shade = (0.84 + 0.30 * f32((h >> 16u) & 255u) / 255.0) * lift;
    out.color = vec4f(col.rgb * shade, col.a);
    return out;
}

/** v turned by the light's turn (view.light: cos, sin). */
fn turned(v: vec2f) -> vec2f {
    let cs = view.light.xy;
    return vec2f(cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y);
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
    // the grain's light is spread along its streak: a blurred grain is fainter, as on film, but
    // no fainter than 0.6: a point here stands for many grains, and a stream of them is a bright
    // thread to the eye, not the faint dashes that the full dimming drew
    let spread = max(0.6, 1.0 / (1.0 + hl));
    // a rounded grain lit from the upper left of the room (in the app, turned back by the glass's
    // angle on screen); mica (alpha > 1) glints on its lit side
    let light = turned(normalize(vec2f(-0.55, 0.65)));
    let lit = 0.78 + 0.30 * dot(d, light) * (1.0 - 0.3 * r2) + 0.12 * (1.0 - r2);
    var rgb = v.color.rgb * lit;
    let gp = d - turned(vec2f(-0.3, 0.3));
    if (v.color.a > 1.5) { rgb += vec3f(0.35) * max(0.0, 1.0 - 4.0 * dot(gp, gp)); }
    if (view.look.x > 0.5) {
        // liquid: soft round drops that run together
        let a = view.look.y * (1.0 - r2 * r2) * spread;
        return vec4f(rgb * a, a);
    }
    let edge = clamp((1.0 - r2) * 4.0, 0.0, 1.0);
    let a = view.look.y * edge * spread;
    return vec4f(rgb * a, a);
}
