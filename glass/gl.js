/*!
 * Hourglass — glass/gl.js
 * The glass drawn by WebGL.
 *
 * One piece of HourglassPhysics, loaded in this order: glass/shapes.js, sand/sim.js, sand/sands.js, glass/gl.js,
 * glass/renderer.js, glass/cracks.js, glass/spill.js. Each reads what it needs from the namespace once,
 * at load (cut from physics.js by tools/split-physics.js).
 * Zero dependencies. License: GPL-3.0-or-later.
 */
(function (root) {
  'use strict';
  var P = root.HourglassPhysics || (root.HourglassPhysics = {});
  var _ = P._ || (P._ = {});        // names the pieces share that are not the app's
  if (_.loaded !== 'sand/sands.js') return;   // a piece before this one is missing: define nothing (app.js says it is updating)
  var profile = P.profile;

  /* ======================================================================
   *  Glass — rendered, not drawn
   *
   *  The vessel is a surface of revolution, so every pixel of it has an
   *  exact 3-D normal. A small fragment shader lights that surface the way
   *  a renderer would: Fresnel reflection of a studio (softbox, strip,
   *  kickers behind for the bright rim, one small hard lamp), the mirrored
   *  second highlight of the far wall, absorption along the true path
   *  through the shell, and light bent through the solid rim. The room stays
   *  put while the glass turns, so highlights slide across it.
   * ==================================================================== */
  var GLASS_VS = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
  // The fragment shader, in parts: what it is told, the shape of the glass
  // (the classic teardrop's, or a table for another glass of SHAPES), and the
  // light. The classic glass is lit by exactly the lines it always was; the
  // few another glass needs differently stand beside them as a pair
  // (glassSource).
  var GLASS_FS_HEAD = [
    'precision highp float;',
    'uniform vec2 uRes;',      // drawing buffer, px
    'uniform vec2 uBox;',      // the same rectangle in cells
    'uniform vec4 uGeo;',      // R, HB, RN, equator
    'uniform float uWall;',    // wall thickness, cells
    'uniform float uRot;',     // vessel against the room, rad clockwise
    'uniform float uPass;',    // 0 far wall (behind the sand), 1 near wall
    'uniform vec3 uAbs;',      // absorption per cell of glass
    'uniform vec3 uGlow;',     // warm bounce from the desk
    'uniform float uPx;',      // cells per pixel (edge anti-aliasing)
    'uniform float uGain;'     // exposure
  ];
  var GLASS_FS_TEARDROP = [
    'float prof(float u) {',
    '  if (u >= 1.0) return 0.0;',
    '  float c = uGeo.w;',
    '  if (u <= c) return uGeo.z + (uGeo.x - uGeo.z) * sin(1.5707963 * pow(u / c, 1.22));',
    '  float w = (u - c) / (1.0 - c);',
    '  return uGeo.x * sqrt(max(0.0, 1.0 - pow(w, 2.3)));',
    '}',
    'float rIn(float y) { return prof(abs(y) / uGeo.y); }',
    'float rOut(float y) {',
    '  float u = abs(y) / (uGeo.y + uWall);',
    '  if (u >= 1.0) return 0.0;',
    // heavier at the waist, where blown glass is drawn out; closed at the tip
    '  return prof(u) + uWall * (1.0 + 1.15 * exp(-u * u / 0.0035)) * (1.0 - smoothstep(0.985, 1.0, u));',
    '}'
  ];
  // Another glass than the classic: its two surfaces are read from a table
  // (shapeTable) baked from the same profile() the sand is held by, so the
  // glass seen is the glass the sand is in. The table is a texture of bytes,
  // read one texel at a time and joined here: no phone is asked to blend
  // 16-bit numbers that lie across two bytes.
  var TABLE_N = 1024;
  var GLASS_FS_TABLE = [
    // highp: a sampler is lowp unless it says otherwise, and what is read
    // through it is then lowp too, which need hold no more than 8 bits
    'uniform highp sampler2D uProf;',
    'uniform float uProfK;',   // cells per count of the table
    'float tap(float i, float row) {',
    '  vec4 t = texture2D(uProf, vec2((i + 0.5) / ' + TABLE_N + '.0, row));',
    // each byte back to a whole number first, then the two as one of 16 bits
    '  vec2 b = floor(t.xy * 255.0 + 0.5);',
    '  return (b.x * 256.0 + b.y) * uProfK;',
    '}',
    'float look(float u, float row) {',
    '  float x = u * ' + (TABLE_N - 1) + '.0, i = floor(x);',
    '  return mix(tap(i, row), tap(min(i + 1.0, ' + (TABLE_N - 1) + '.0), row), x - i);',
    '}',
    'float rIn(float y) {',
    '  float u = abs(y) / uGeo.y;',
    '  if (u >= 1.0) return 0.0;',
    '  return look(u, 0.25);',
    '}',
    'float rOut(float y) {',
    '  float u = abs(y) / (uGeo.y + uWall);',
    '  if (u >= 1.0) return 0.0;',
    '  return look(u, 0.75);',
    '}'
  ];
  // The dark room: the app's own look, as it has always been lit.
  var GLASS_FS_ROOM = [
    'vec3 room(vec3 d) {',
    '  vec3 col = vec3(0.028) * (0.7 - 0.5 * d.y);',                                                                     // the dark room
    '  col += vec3(1.0, 0.96, 0.90) * 4.6 * panel(d, normalize(vec3(-0.66, -0.52, 0.54)), vec2(0.20, 0.46), 0.12);',     // key softbox
    '  col += vec3(0.90, 0.94, 1.0) * 1.7 * panel(d, normalize(vec3(0.88, -0.02, 0.36)), vec2(0.05, 0.80), 0.05);',      // fill strip
    '  col += vec3(1.0) * 1.5 * panel(d, normalize(vec3(-0.78, -0.05, -0.62)), vec2(0.07, 1.1), 0.06);',                 // kickers: the long
    '  col += vec3(1.0) * 1.1 * panel(d, normalize(vec3(0.78, -0.05, -0.62)), vec2(0.07, 1.1), 0.06);',                  //   soft side streaks
    // rim strips almost straight behind: they draw the bright line along the
    // glass's own edge, outside the sand, which is what tells the eye where
    // the glass ends
    '  col += vec3(1.0) * 1.7 * panel(d, normalize(vec3(-0.30, -0.04, -0.95)), vec2(0.05, 0.7), 0.08);',
    '  col += vec3(1.0) * 1.3 * panel(d, normalize(vec3(0.30, -0.04, -0.95)), vec2(0.05, 0.7), 0.08);',
    // another glass may end low and wide, where the teardrop comes to a round
    // tip: two more strips behind, lying flat, draw the same line along an
    // end as those two draw down the sides (without them a lid is black on
    // the dark room, and the glass has no end)
    [[], [
      '  col += vec3(1.0) * 1.7 * panel(d, normalize(vec3(0.0, -0.25, -0.97)), vec2(0.7, 0.05), 0.08);',
      '  col += vec3(1.0) * 1.3 * panel(d, normalize(vec3(0.0, 0.25, -0.97)), vec2(0.7, 0.05), 0.08);'
    ]],
    // soft light from the sides, which the thick rim bends round into the eye
    '  col += vec3(0.86, 0.89, 0.94) * 0.55 * panel(d, normalize(vec3(-1.0, -0.06, 0.04)), vec2(0.5, 0.55), 0.3);',
    '  col += vec3(0.86, 0.89, 0.94) * 0.45 * panel(d, normalize(vec3(1.0, -0.06, 0.04)), vec2(0.5, 0.55), 0.3);',
    '  float lamp = dot(d, normalize(vec3(-0.40, -0.50, 0.77)));',
    '  col += vec3(1.0, 0.98, 0.94) * (22.0 * smoothstep(0.99905, 0.99975, lamp) + 1.4 * pow(max(lamp, 0.0), 900.0));', // small hard lamp
    '  col += uGlow * 0.5 * smoothstep(0.25, 1.0, d.y);',                                                                // the desk below
    '  return col;',
    '}'
  ];
  // The light look's room (renderer.setPaper): a white room, a paper sweep all round, in which the
  // glass is seen as glass is on white: by the dark it gathers, not by the light. Two dark cards
  // stand behind it, a little to each side, where the dark room has its rim strips, so that its own
  // edge is drawn by a dark line; dark flags at the sides, which the thick rim bends round into the
  // eye, show the wall's thickness as a soft grey; the desk below is darker than the sweep. The key
  // softbox and the small lamp stay: their sheen is seen over the sand.
  var GLASS_FS_ROOM_PAPER = [
    'vec3 room(vec3 d) {',
    '  vec3 col = vec3(0.90, 0.89, 0.87) * (0.94 - 0.10 * d.y);',                                                         // the white room
    '  col += vec3(1.0, 0.98, 0.95) * 1.6 * panel(d, normalize(vec3(-0.66, -0.52, 0.54)), vec2(0.20, 0.46), 0.12);',     // key softbox
    '  col *= 1.0 - 0.94 * panel(d, normalize(vec3(-0.30, -0.04, -0.95)), vec2(0.11, 0.8), 0.10);',                      // the dark cards behind:
    '  col *= 1.0 - 0.90 * panel(d, normalize(vec3(0.30, -0.04, -0.95)), vec2(0.11, 0.8), 0.10);',                       //   the glass's edge
    [[], [
      '  col *= 1.0 - 0.94 * panel(d, normalize(vec3(0.0, -0.25, -0.97)), vec2(0.8, 0.11), 0.10);',                     // ... and along an end
      '  col *= 1.0 - 0.90 * panel(d, normalize(vec3(0.0, 0.25, -0.97)), vec2(0.8, 0.11), 0.10);'
    ]],
    '  col *= 1.0 - 0.62 * panel(d, normalize(vec3(-1.0, -0.06, 0.04)), vec2(0.5, 0.55), 0.3);',                         // dark flags at the sides
    '  col *= 1.0 - 0.55 * panel(d, normalize(vec3(1.0, -0.06, 0.04)), vec2(0.5, 0.55), 0.3);',
    '  float lamp = dot(d, normalize(vec3(-0.40, -0.50, 0.77)));',
    '  col += vec3(1.0, 0.98, 0.94) * (22.0 * smoothstep(0.99905, 0.99975, lamp) + 1.4 * pow(max(lamp, 0.0), 900.0));', // small hard lamp
    '  col = mix(col, uGlow * 0.22 + vec3(0.16), 0.7 * smoothstep(0.25, 1.0, d.y));',                                    // the desk below
    '  return col;',
    '}'
  ];
  var GLASS_FS_LIGHT = [
    { dark: [], paper: ['const vec3 PAGE = vec3(0.953, 0.941, 0.918);'] },     // the light look's paper, #f3f0ea
    'vec3 rotZ(vec3 v, float a) {',
    '  float c = cos(a), s = sin(a);',
    '  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);',
    '}',
    // a rectangular soft light seen in direction d (x right, y down, z to the eye)
    'float panel(vec3 d, vec3 c, vec2 hs, float soft) {',
    '  float k = dot(d, c);',
    '  if (k <= 0.02) return 0.0;',
    '  vec3 ux = normalize(cross(vec3(0.0, 1.0, 0.0), c));',
    '  vec3 uy = cross(c, ux);',
    '  vec2 q = abs(vec2(dot(d, ux), dot(d, uy)) / k);',
    '  vec2 m = 1.0 - smoothstep(hs - soft, hs + soft, q);',
    '  return m.x * m.y;',
    '}',
  ];
  var GLASS_FS_MAIN = [
    'void main() {',
    '  vec2 p = (gl_FragCoord.xy / uRes - 0.5) * uBox;',
    '  p.y = -p.y;',
    '  float ro = rOut(p.y), ri = rIn(p.y), ax = abs(p.x);',
    // The edge is smoothed over 1.6 px: across, which is right down the
    // teardrop's sides. Another glass has lids that lie nearly flat, so there
    // the gap across is shrunk by the outer surface's slope first (the same
    // slope the near wall is lit by, below).
    ['  float edge = 1.0 - smoothstep(ro - 1.6 * uPx, ro, ax);', [
      '  float so = uPass > 0.5 && ax < ro ? (rOut(p.y + 0.6) - rOut(p.y - 0.6)) / 1.2 : 0.0;',
      '  float edge = 1.0 - smoothstep(-1.6 * uPx, 0.0, (ax - ro) / sqrt(1.0 + so * so));'
    ]],
    '  if (ro <= 0.0 || edge <= 0.0) { gl_FragColor = vec4(0.0); return; }',
    '  const float E = 0.6;',
    // signed distance to the inner surface, positive inside the bore: the
    // horizontal gap shrunk by the wall's slope (it overstates the distance
    // where the surface lies flat, at the domes), and below the dome's tip
    // the vertical gap. Being a distance, not a column test, it has no seam.
    '  float dri = clamp((rIn(p.y + E) - rIn(p.y - E)) / (2.0 * E), -12.0, 12.0);',
    '  float dIn = min((ri - ax) / sqrt(1.0 + dri * dri), uGeo.y - abs(p.y));',
    '  float hlf = sqrt(max(ro * ro - ax * ax, 0.0));',
    '  float path = hlf - sqrt(max(ri * ri - ax * ax, 0.0));',          // glass crossed in one wall
    '  vec3 absorb = exp(-uAbs * path);',
    '  vec3 col; float a;',
    // (the light look: the page's own light, given back by a wall that mirrors the white room)
    { dark: [], paper: ['  vec3 fill = vec3(0.0);'] },
    '  if (uPass > 0.5) {',
    ['    float dro = clamp((rOut(p.y + E) - rOut(p.y - E)) / (2.0 * E), -8.0, 8.0);',
     '    float dro = clamp(so, -8.0, 8.0);'],
    '    float s = clamp(p.x / ro, -0.9995, 0.9995);',
    '    vec3 n = normalize(vec3(s, -dro, sqrt(1.0 - s * s)));',
    // hand-blown glass is never optically perfect
    '    n.xy += 0.010 * vec2(sin(p.y * 0.115 + 1.7 * sin(p.x * 0.06)), sin(p.x * 0.09 + p.y * 0.045));',
    '    n = normalize(n);',
    '    float F = 0.04 + 0.96 * pow(1.0 - max(n.z, 0.0), 5.0);',
    '    col = room(rotZ(vec3(0.0, 0.0, -1.0) + 2.0 * n.z * n, uRot)) * F;',
    // leaving the wall into the bore the inner surface mirrors at a glance,
    // so the sand darkens softly just where it meets the glass
    '    float si = clamp(ax / max(ri, 0.001), 0.0, 0.9995);',
    // (the dome's slope barely counts: the straight-through ray is a poor guide there)
    '    vec3 ni = normalize(vec3(si, -dri * 0.15, sqrt(1.0 - si * si)));',
    '    float Fi = ri > 0.5 ? 0.04 + 0.96 * pow(1.0 - max(ni.z, 0.0), 8.0) : 1.0;',
    '    vec3 tr = absorb * (1.0 - F) * (1.0 - Fi);',
    '    a = 1.0 - (tr.r + tr.g + tr.b) / 3.0;',
    // On white the wall in front is clear: it covers what is behind it by what its outer face
    // mirrors and its glass takes, and its inner face only by what it mirrors at a glance, toward
    // the edge, where the sand meets the glass; what it mirrors is added over the page and the sand
    // at its own strength, not as a film (the light look)
    { dark: [], paper: ['    tr = absorb * (1.0 - F) * (1.0 - (Fi - 0.04) / 0.96);', '    a = 1.0 - (tr.r + tr.g + tr.b) / 3.0;'] },
    // edge-on, the wall is solid glass: it bends light in from the sides
    '    float rim = 1.0 - smoothstep(-0.25, 0.35, dIn);',
    '    if (rim > 0.0) {',
    '      float sr = min(ax / ro, 0.9995);',
    '      float dv = 2.0 * (asin(sr) - asin(sr / 1.5));',
    '      float sx = p.x < 0.0 ? -1.0 : 1.0;',
    '      vec3 o = normalize(vec3(-sx * sin(dv), -dro * 0.5, -cos(dv)));',
    '      col += rim * room(rotZ(o, uRot)) * (1.0 - F) * (1.0 - F) * exp(-uAbs * hlf * 0.5);',
    '      a = mix(a, 0.82, rim);',
    '    }',
    '  } else {',
    '    if (dIn <= -0.3) { gl_FragColor = vec4(0.0); return; }',
    '    float sb = clamp(p.x / max(ri, 0.001), -0.9995, 0.9995);',
    '    vec3 nb = normalize(vec3(-sb, dri, sqrt(1.0 - sb * sb)));',
    // inner surfaces mirror strongly at a glance (total internal reflection)
    '    float Fb = 0.05 + 0.95 * pow(1.0 - max(nb.z, 0.0), 3.5);',
    '    col = room(rotZ(vec3(0.0, 0.0, -1.0) + 2.0 * nb.z * nb, uRot)) * Fb * 0.5;',
    '    vec3 tb = absorb * (1.0 - Fb * 0.7);',
    '    a = 1.0 - (tb.r + tb.g + tb.b) / 3.0;',
    // ... and the wall behind the sand gives back at least the page's light it takes, so the bore
    // is the page seen through clear glass, the room's lights over it, and greys nowhere
    { dark: [], paper: ['    fill = PAGE * Fb * 0.7 * absorb;'] },
    '    edge *= smoothstep(-0.3, 0.3, dIn);',
    '  }',
    '  col = vec3(1.0) - exp(-col * uGain);',                             // film-like roll-off
    { dark: [], paper: ['  col = min(max(col, fill), vec3(1.0));'] },
    '  a = clamp(max(a, max(col.r, max(col.g, col.b))), 0.0, 1.0);',
    '  gl_FragColor = vec4(col, a) * edge;',
    '}'
  ];
  /**
   * The shader's text for the classic glass (0) or for another (1), in the dark room or (paper) in
   * the light look's white one. Of a pair, [the classic's, another glass's], that one; of a
   * { dark, paper }, the look's.
   */
  function glassSource(which, paper) {
    var parts = GLASS_FS_HEAD.concat([[GLASS_FS_TEARDROP, GLASS_FS_TABLE]], GLASS_FS_LIGHT, paper ? GLASS_FS_ROOM_PAPER : GLASS_FS_ROOM, GLASS_FS_MAIN), out = [], i, q;
    for (i = 0; i < parts.length; i++) {
      q = parts[i];
      out = out.concat(typeof q === 'string' ? q : (Array.isArray(q) ? q[which] : (paper ? q.paper : q.dark)));
    }
    return out.join('\n');
  }

  var GLASS_FS = glassSource(0), GLASS_FS_SHAPE = glassSource(1);
  var GLASS_FS_PAPER = glassSource(0, true), GLASS_FS_SHAPE_PAPER = glassSource(1, true);

  /**
   * The two surfaces of a glass that is not the classic one, as its shader
   * reads them: TABLE_N by 2 texels of four bytes, a half-width as 16 bits in
   * the first two (the high byte first), `k` cells to a count.
   *   row 0   the bore: profile at u = i / (TABLE_N - 1), the last just short
   *           of the closed end
   *   row 1   the outer surface, over a bulb longer by the wall: the bore
   *           pushed straight out of the glass by the wall's thickness, as the
   *           drawn glass has it (shapeMarks), and heavier at the waist by as
   *           much as the teardrop is there
   * Found once per geometry and kept on it.
   */
  function shapeTable(g) {
    if (g.table) return g.table;
    var N = TABLE_N, M = 4096, HB = g.HB, wall = g.wall, i, k, u, ua, ub, sl, nx, y, x, t, top = 0;
    var rin = new Float64Array(N), rout = new Float64Array(N);
    for (i = 0; i < N; i++) rin[i] = profile(Math.min(i / (N - 1), 1 - 1e-9), g);
    // the outer surface as points, end to neck (the end itself first)
    var px = new Float64Array(M + 1), py = new Float64Array(M + 1);
    py[0] = HB + wall;
    for (k = 1; k <= M; k++) {
      u = 1 - k / M;
      ua = Math.max(0, u - 0.002); ub = Math.min(1, u + 0.002);
      sl = (profile(ub, g) - profile(ua, g)) / ((ub - ua) * HB);
      nx = 1 / Math.sqrt(1 + sl * sl);
      px[k] = profile(u, g) + wall * nx; py[k] = u * HB - wall * sl * nx;
    }
    // The bead at the waist: the teardrop's, where this bore opens as fast as
    // the teardrop's does by the bead's end; less on a neck drawn out long,
    // where a bead that size would stand on a tube as a lump.
    var ue = Math.sqrt(0.0035), bead = 1.15 * Math.min(1, (profile(ue, g) - g.RN) / ((g.R - g.RN) * Math.sin(Math.PI * 0.5 * Math.pow(ue / 0.66, 1.22))));
    // ... and how far out it reaches at each height (the farthest, where a
    // tight hollow makes the pushed wall cross itself; beside the waist, where
    // the two bulbs' walls meet, what it is at the neck)
    for (i = 0; i < N; i++) {
      u = i / (N - 1); y = u * (HB + wall); x = -1;
      for (k = 0; k < M; k++) {
        if ((py[k] - y) * (py[k + 1] - y) > 0) continue;
        t = py[k] === py[k + 1] ? 0 : (y - py[k]) / (py[k + 1] - py[k]);
        t = px[k] + (px[k + 1] - px[k]) * t;
        if (t > x) x = t;
      }
      if (x < 0) x = px[M];
      rout[i] = x + wall * bead * Math.exp(-u * u / 0.0035);
      top = Math.max(top, rout[i], rin[i]);
    }
    var data = new Uint8Array(N * 2 * 4), kk = top / 65535, v;
    for (i = 0; i < N; i++) {
      v = Math.round(rin[i] / kk); data[4 * i] = v >> 8; data[4 * i + 1] = v & 255; data[4 * i + 3] = 255;
      v = Math.round(rout[i] / kk); data[4 * (N + i)] = v >> 8; data[4 * (N + i) + 1] = v & 255; data[4 * (N + i) + 3] = 255;
    }
    g.table = { data: data, k: kk };
    return g.table;
  }

  /**
   * One WebGL layer of the glass of geometry `geo`. Returns null where WebGL
   * cannot do it: no context, no full float precision, or a shader the
   * device will not take (the glass is then the drawn one, of the same shape).
   */
  function makeGlass(canvas, pass, geo) {
    var opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
                 stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    var gl = null;
    try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) {}
    if (!gl) return null;
    var hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!hp || !hp.precision) return null;                 // needs full float precision
    // paper: the light look's shading (renderer.setPaper). Each look's program is made when first
    // asked for and kept (progs), so that turning between the looks compiles nothing again.
    var g = { gl: gl, canvas: canvas, pass: pass, prog: null, u: {}, lost: false, paper: false, progs: {} };
    function program(paper) {
      function sh(type, src) {
        var o = gl.createShader(type);
        gl.shaderSource(o, src); gl.compileShader(o);
        if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) || 'shader');
        return o;
      }
      var prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, GLASS_VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, geo.shape ? (paper ? GLASS_FS_SHAPE_PAPER : GLASS_FS_SHAPE) : (paper ? GLASS_FS_PAPER : GLASS_FS)));
      gl.bindAttribLocation(prog, 0, 'p');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
      gl.useProgram(prog);
      var u = {}, names = ['uRes', 'uBox', 'uGeo', 'uWall', 'uRot', 'uPass', 'uAbs', 'uGlow', 'uPx', 'uGain'];
      for (var i = 0; i < names.length; i++) u[names[i]] = gl.getUniformLocation(prog, names[i]);
      if (geo.shape) {
        gl.uniform1i(gl.getUniformLocation(prog, 'uProf'), 0);
        gl.uniform1f(gl.getUniformLocation(prog, 'uProfK'), shapeTable(geo).k);
      }
      return { prog: prog, u: u };
    }
    /** The program of the look asked for (made now if it is new), in use from here on. */
    g.use = function (paper) {
      var p = g.look(paper);
      g.paper = !!paper; g.prog = p.prog; g.u = p.u;
    };
    /** A look's program and its uniforms (made now if it is new), not put in use: a change of
        look draws the two looks' pictures one over the other while it fades (renderer._paperMix). */
    g.look = function (paper) {
      paper = !!paper;
      return g.progs[paper] || (g.progs[paper] = program(paper));
    };
    g.build = function () {
      g.progs = {};
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one big triangle
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      if (geo.shape) {
        // the shape's table: made here, so that a context that was lost and
        // came back (a phone does that to a page left in the background)
        // gets it again with its program
        var tb = shapeTable(geo), tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TABLE_N, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, tb.data);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('table');
      }
      g.use(g.paper);
    };
    try { g.build(); } catch (e) { return null; }
    return g;
  }


  _.makeGlass = makeGlass;
  _.loaded = 'glass/gl.js';
})(typeof window !== 'undefined' ? window : globalThis);
