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
// - the sunlit sand (the app's Light: Sunlit; view.key.w 1): one key light
//   from the room's upper left and in front, as the classic sand's
//   (glass/renderer.js, the sunlit sand: the same key, constants and colour
//   table). The grain's light is worked out here, in the vertex stage: the
//   body of sand against the front glass takes the bore's normal (a lit side,
//   a shaded side, a crescent at the far wall, a contact shade at the glass),
//   the free surface the normal and soft shadow that relief.wgsl made of the
//   beds' heights, a grain in flight is a small bead; a grain whose facet
//   faces the key's mirror direction glints. The fragment stage keeps its
//   bead: the side toward the key three light levels up, the far side three
//   down. With view.key.w 0 every grain is drawn as it always was;
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
    // the sunlit sand (all 0: the grains as they always were). In the grid's axes: x right, y up, z toward the eye.
    key: vec4f,    // xyz: the key light's direction, the room's turned back by the glass's angle; w: 1 sunlit
    half: vec4f,   // xyz: half way between the key and the eye (a facet that faces it glints); w: light levels per unit of light
    amb: vec4f,    // x: the ambient; y: the key; z: the wrap round the terminator; w: the crescent past it
    bed: vec4f,    // x: the contact shade at the glass; y: the darkening with depth; z: how fast the free surface's light
                   // fades into the bed, per app cell; w: grid cells per app cell
    glint: vec4f,  // x: the share of grains that can glint, over pi/6 (only a facet inside the ball is one); y: how near the
                   // mirror direction a mica facet must face; z: the key's direction on the canvas, x; w: the same, y
    spark: vec4f,  // rgb: the glint's colour; w: the frame (a moving grain's facet tumbles)
    still: vec4f,  // x: a grain moves when its displacement in a substep is over this (cells)
};

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage> particles: array<Particle>;
@group(0) @binding(2) var<storage> palette: array<vec4f, 256>;
// per grid row (its centre), the drawn half-width over the simulated one (glass.mjs warp); for the sunlit sand,
// after those rows, the drawn half-width itself (cells), row by row
@group(0) @binding(3) var<storage> warp: array<f32>;
// the sunlit sand: per column, each bed's height, its free surface's light and glint term (relief.wgsl)
@group(0) @binding(4) var<storage> relief: array<vec4f>;
// the sunlit sand's colours, the classic sand's own table (glass/renderer.js sunTables): 48 light levels x 256 seeds,
// rgba8; alpha: 255 a plain grain, 254 a glossy one, 253 mica
@group(0) @binding(5) var<storage> tones: array<u32>;

struct VertexOut {
    @builtin(position) position: vec4f,
    // along and across the streak, in grain radii
    @location(0) local: vec2f,
    @location(1) color: vec4f,
    // x, y: the streak's direction on screen; z: its half-length, grain radii
    @location(2) @interpolate(flat) streak: vec3f,
    // the sunlit sand: the grain's colour three light levels down (a: 1 if it glints) and three up (a: 1 if sunlit)
    @location(3) @interpolate(flat) lo: vec4f,
    @location(4) @interpolate(flat) hi: vec4f,
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

/** The drawn glass's half-width at grid height y, cells (the sunlit sand: the bore the body of sand lies against). */
fn halfAt(y: f32) -> f32 {
    let rows = view.neck.z;
    let q = clamp(y - 0.5, 0.0, rows - 1.0);
    let j = u32(floor(q));
    let j1 = min(j + 1u, u32(rows) - 1u);
    let o = u32(rows);
    return mix(warp[o + j], warp[o + j1], q - floor(q));
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
    // (the sunlit sand: where the point is in the solver's glass, where it is drawn before the sweep, and how it moves)
    var at = vec2f(0.0);
    var lp = vec2f(0.0);
    var moved = vec2f(0.0);
    let h = hash(index * 2654435761u + 17u);
    if (index >= count) {
        // the sweep's thread: grains falling from the top of the bulb onto the rising sand,
        // in the new bed's colours (each the seed of a grain picked from it)
        let g = threadGrain(index - count);
        pos = g.xy; shown = g.z > 0.5;
        at = pos; lp = pos;
        seed = u32(particles[hash(index ^ (u32(view.thread.w) * 40503u)) % max(count, 1u)].color.x) & 255u;
        lift = 1.06;
    } else {
        let p = particles[index];
        pos = p.position; disp = p.displacement; crowd = p.color.y;
        at = pos; moved = disp;
        // the grain's seed (bits 8 and up mark layered sand's fresh grains: tone.wgsl)
        seed = u32(p.color.x) & 255u;
        if (p.enabled == 0.0) { shown = false; }
        // drawn inside the neck the app draws
        let k = warpAt(pos.y);
        pos.x = view.neck.x + (pos.x - view.neck.x) * k;
        disp.x = disp.x * k;
        lp = pos;
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
    out.lo = vec4f(0.0);
    out.hi = vec4f(0.0);
    if (view.key.w > 0.5) {
        // The sunlit sand (glass/renderer.js, the sunlit sand: the same light, here per grain).
        let L = view.key.xyz;
        let Hv = view.half.xyz;
        let cells = view.bed.w;
        // in flight (the thread's grains too): a small bead, no bed round it
        let air = select(flight, 1.0, index >= count);
        // the body of sand against the front glass: the bore's normal across the row, (sn, 0, cz)
        let hw = max(halfAt(lp.y), 0.5);
        let dx = lp.x - view.neck.x;
        let sn = clamp(dx / hw, -1.0, 1.0);
        let cz = sqrt(1.0 - sn * sn);
        let nl = sn * L.x + cz * L.z;
        // through the glass: less toward the grazing side (Fresnel, twice), a crescent past the terminator
        let g1 = 1.0 - max(nl, 0.0);
        let g2 = g1 * g1;
        let tr = 1.0 - (0.04 + 0.96 * g2 * g2 * g1);
        let cr = (nl + 0.04) * 10.0;
        let body = (view.amb.x + view.amb.y * tr * tr * max(0.0, (nl + view.amb.z) / (1.0 + view.amb.z)) + view.amb.w * exp(-cr * cr))
            * (1.0 - view.bed.x * exp(-max(hw - abs(dx), 0.0) / (2.2 * cells)));
        // the free surface: its light where the grain lies near the top of its bed, the body's below
        let W = arrayLength(&relief) / 2u;
        let rl = relief[select(W, 0u, at.y > view.neck.y) + min(u32(max(at.x, 0.0)), W - 1u)];
        let dep = max(rl.x - at.y, 0.0) / cells;
        let top = select(0.0, exp(-dep * view.bed.z), rl.x > 0.0);
        let bedLight = mix(body, rl.y, top) * (1.0 - view.bed.y * (1.0 - exp(-dep / 7.0)));
        let moving = dot(moved, moved) > view.still.x * view.still.x;
        // the light level (a level every 0.031 of light from 0.34, as the classic sand's table), the grain's own shade in it
        let lv = clamp(floor(mix(bedLight, view.amb.x + 0.62 * view.amb.y, air) * shade * view.half.w - 10.467742)
            + select(0.0, 1.0, moving && air < 0.5), 3.0, 44.0);
        let ti = (u32(lv) << 8u) | seed;
        let mid = unpack4x8unorm(tones[ti]);
        let kind = u32(round((1.0 - mid.a) * 255.0));            // 0 plain, 1 glossy, 2 mica
        // the grain's facet, a fixed tilt in a ball of radius 0.55 (a moving grain's tumbles): it glints when it
        // faces half way between the key and the eye, mica from further off than a glossy grain, that than the rest
        let fh = hash((index * 2246822519u + 101u) ^ select(0u, (u32(view.spark.w) >> 2u) * 668265263u, moving));
        let J = vec3f(f32(fh & 1023u), f32((fh >> 10u) & 1023u), f32((fh >> 20u) & 1023u)) * (1.1 / 1023.0) - 0.55;
        let jj = dot(J, J);
        let gs = select(select(0.993, 0.982, kind == 1u), view.glint.y, kind == 2u);
        let hb = sn * Hv.x + cz * Hv.z;
        let gl = hb + (rl.z - hb) * top + dot(J, Hv);
        var glints = jj <= 0.3025 && f32(h >> 24u) < view.glint.x * 256.0 && gl > 0.0 && gl * gl > gs * gs * (1.0 + jj);
        // in flight the bead tumbles and flashes now and then
        if (air > 0.5) { glints = (hash(index ^ ((u32(view.spark.w) >> 1u) * 2654435761u)) & 255u) < select(10u, 40u, kind == 2u); }
        out.color = vec4f(mid.rgb, col.a);
        out.lo = vec4f(unpack4x8unorm(tones[ti - 768u]).rgb, select(0.0, 1.0, glints));
        out.hi = vec4f(unpack4x8unorm(tones[ti + 768u]).rgb, 1.0);
    }
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
    if (v.hi.a > 0.5) {
        // the sunlit sand: the bead's side toward the key is its colour three light levels up, the far side three
        // down (the classic sand's bead has a lit and a dark pixel so); a facet that catches the key is a small
        // spot of the glint's colour on the lit side
        let key2 = view.glint.zw;
        let t = dot(d, key2) * (1.0 - 0.3 * r2);
        rgb = min(mix(v.color.rgb, select(v.lo.rgb, v.hi.rgb, t > 0.0), min(abs(t), 1.0)) * (0.94 + 0.12 * (1.0 - r2)), vec3f(1.0));
        let gq = d - 0.35 * key2;
        rgb = mix(rgb, view.spark.rgb, v.lo.a * clamp((0.22 - dot(gq, gq)) * 10.0, 0.0, 1.0));
    }
    if (view.look.x > 0.5) {
        // liquid: soft round drops that run together
        let a = view.look.y * (1.0 - r2 * r2) * spread;
        return vec4f(rgb * a, a);
    }
    let edge = clamp((1.0 - r2) * 4.0, 0.0, 1.0);
    let a = view.look.y * edge * spread;
    return vec4f(rgb * a, a);
}
