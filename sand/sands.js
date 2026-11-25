/*!
 * Hourglass — sand/sands.js
 * The sands: the themes, the sands and their finishes, and the colour helpers.
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
  if (_.loaded !== 'sand/sim.js') return;   // a piece before this one is missing: define nothing (app.js says it is updating)

  /* ======================================================================
   *  Themes
   * ==================================================================== */

  var THEMES = {
    sahara: {
      id: 'sahara',
      name: 'Sahara Quartz & Walnut',
      short: 'Sahara Quartz',
      sand: {
        h: 36, s: 0.62, l: 0.61, dh: 6, dl: 0.085,
        dark: { p: 0.045, h: 22, s: 0.50, l: 0.36 },    // iron-stained grains
        alt: { p: 0.11, h: 30, s: 0.70, l: 0.54 },       // amber grains
        mica: { p: 0.05, h: 46, s: 0.40, l: 0.90 }       // mica glints
      },
      // the companion tone of layered sand: a deeper sienna
      sand2: {
        h: 21, s: 0.56, l: 0.42, dh: 6, dl: 0.07,
        dark: { p: 0.05, h: 16, s: 0.50, l: 0.27 },
        alt: { p: 0.11, h: 26, s: 0.62, l: 0.48 },
        mica: { p: 0.04, h: 40, s: 0.45, l: 0.80 }
      },
      glint: [255, 247, 224],
      // how the sand takes the light: surface rim (levels), share of glossy
      // grains and their extra sparkle, highlight tint, soft bloom
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.12, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [255, 214, 150],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.04
      },
      glass: { tint: [255, 233, 204], smoke: 0.10 },
      cap: { kind: 'wood', hi: [112, 70, 42], mid: [70, 41, 23], lo: [30, 17, 9] },
      glow: [255, 176, 92]
    },
    volcanic: {
      id: 'volcanic',
      name: 'Volcanic Black & Brushed Brass',
      short: 'Volcanic Black',
      sand: {
        h: 236, s: 0.11, l: 0.255, dh: 20, dl: 0.06,
        dark: { p: 0.10, h: 240, s: 0.10, l: 0.15 },
        alt: { p: 0.12, h: 262, s: 0.30, l: 0.37 },      // iridescent basalt
        mica: { p: 0.07, h: 44, s: 0.82, l: 0.62 }       // gold flecks
      },
      // layered: pumice, a warm ash grey
      sand2: {
        h: 28, s: 0.13, l: 0.44, dh: 10, dl: 0.06,
        dark: { p: 0.08, h: 22, s: 0.11, l: 0.30 },
        alt: { p: 0.12, h: 34, s: 0.20, l: 0.51 },
        mica: { p: 0.05, h: 44, s: 0.70, l: 0.64 }
      },
      glint: [255, 226, 150],
      // black sand only reads if it is *lit*: a strong rim on the surface,
      // many glassy facets that catch the key light, and a soft bloom
      light: {
        rim: [10, 5], aoMax: 5, gloss: 0.24, glossBoost: 12, hl: 1.15, tint: [238, 234, 240],
        bloom: 0.85, bloomColor: [255, 224, 176],
        emit: { mica: 0.34, gloss: 0.04, rim: 0.18, haze: 0.010 }, backlight: 0.09
      },
      glass: { tint: [214, 206, 196], smoke: 0.30 },
      // satin, slightly aged brass: present, never glaring
      cap: { kind: 'brass', hi: [196, 170, 108], mid: [136, 110, 58], lo: [58, 44, 18] },
      glow: [204, 160, 84]
    },
    moonstone: {
      id: 'moonstone',
      name: 'Moonstone & Frosted Silver',
      short: 'Moonstone',
      sand: {
        h: 44, s: 0.14, l: 0.83, dh: 10, dl: 0.07,
        dark: { p: 0.06, h: 220, s: 0.12, l: 0.62 },
        alt: { p: 0.14, h: 208, s: 0.34, l: 0.82 },      // blue adularescence
        mica: { p: 0.06, h: 200, s: 0.20, l: 0.98 }
      },
      // layered: the stone's blue shadow
      sand2: {
        h: 216, s: 0.22, l: 0.60, dh: 10, dl: 0.06,
        dark: { p: 0.06, h: 224, s: 0.20, l: 0.45 },
        alt: { p: 0.12, h: 204, s: 0.30, l: 0.68 },
        mica: { p: 0.06, h: 200, s: 0.24, l: 0.95 }
      },
      glint: [255, 255, 255],
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.14, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [214, 230, 255],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.045
      },
      glass: { tint: [214, 232, 255], smoke: 0.07 },
      cap: { kind: 'silver', hi: [236, 240, 245], mid: [160, 166, 176], lo: [72, 77, 86] },
      glow: [168, 196, 235]
    },
    lapis: {
      id: 'lapis',
      name: 'Lapis Lazuli & Gold',
      short: 'Lapis Lazuli',
      sand: {
        h: 224, s: 0.62, l: 0.36, dh: 8, dl: 0.07,
        dark: { p: 0.10, h: 230, s: 0.58, l: 0.24 },    // deep ultramarine
        alt: { p: 0.10, h: 214, s: 0.22, l: 0.66 },      // pale calcite veins
        mica: { p: 0.07, h: 45, s: 0.85, l: 0.62 }       // pyrite: flecks of gold
      },
      // layered: seams of old gold
      sand2: {
        h: 38, s: 0.42, l: 0.40, dh: 6, dl: 0.06,
        dark: { p: 0.07, h: 30, s: 0.40, l: 0.28 },
        alt: { p: 0.10, h: 44, s: 0.50, l: 0.48 },
        mica: { p: 0.06, h: 50, s: 0.85, l: 0.72 }
      },
      glint: [255, 226, 150],
      // a dark sand, lit like the volcanic one so it reads against the night
      light: {
        rim: [8, 4], aoMax: 6, gloss: 0.20, glossBoost: 10, hl: 1.1, tint: [236, 240, 255],
        bloom: 0.75, bloomColor: [170, 190, 255],
        emit: { mica: 0.30, gloss: 0.04, rim: 0.14, haze: 0.009 }, backlight: 0.08
      },
      glass: { tint: [222, 230, 255], smoke: 0.16 },
      cap: { kind: 'gold', hi: [236, 204, 128], mid: [178, 140, 60], lo: [84, 60, 20] },
      glow: [104, 136, 230]
    },
    rosequartz: {
      id: 'rosequartz',
      name: 'Rose Quartz & Copper',
      short: 'Rose Quartz',
      sand: {
        h: 352, s: 0.42, l: 0.80, dh: 8, dl: 0.07,
        dark: { p: 0.05, h: 345, s: 0.32, l: 0.60 },
        alt: { p: 0.12, h: 12, s: 0.48, l: 0.83 },       // peach
        mica: { p: 0.05, h: 0, s: 0.10, l: 0.97 }
      },
      // layered: a deeper, dustier rose
      sand2: {
        h: 344, s: 0.30, l: 0.61, dh: 8, dl: 0.06,
        dark: { p: 0.05, h: 338, s: 0.26, l: 0.46 },
        alt: { p: 0.12, h: 356, s: 0.36, l: 0.66 },
        mica: { p: 0.05, h: 0, s: 0.12, l: 0.94 }
      },
      glint: [255, 244, 244],
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.14, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [255, 214, 222],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.045
      },
      glass: { tint: [255, 232, 236], smoke: 0.08 },
      cap: { kind: 'copper', hi: [228, 164, 132], mid: [170, 98, 66], lo: [76, 38, 22] },
      glow: [236, 168, 178]
    },
    seaglass: {
      id: 'seaglass',
      name: 'Sea Glass & Driftwood',
      short: 'Sea Glass',
      sand: {
        h: 166, s: 0.30, l: 0.72, dh: 10, dl: 0.07,
        dark: { p: 0.05, h: 188, s: 0.30, l: 0.50 },     // deeper teal
        alt: { p: 0.12, h: 140, s: 0.28, l: 0.78 },      // pale green
        mica: { p: 0.05, h: 180, s: 0.14, l: 0.96 }
      },
      // layered: deep-water teal
      sand2: {
        h: 188, s: 0.32, l: 0.49, dh: 10, dl: 0.06,
        dark: { p: 0.05, h: 196, s: 0.32, l: 0.35 },
        alt: { p: 0.12, h: 178, s: 0.30, l: 0.56 },
        mica: { p: 0.05, h: 180, s: 0.16, l: 0.94 }
      },
      glint: [236, 255, 250],
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.14, glossBoost: 4, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.5, bloomColor: [200, 245, 232],
        emit: { mica: 0.10, gloss: 0.02, rim: 0.05, haze: 0.006 }, backlight: 0.045
      },
      glass: { tint: [222, 246, 240], smoke: 0.08 },
      cap: { kind: 'wood', hi: [178, 168, 150], mid: [128, 118, 102], lo: [66, 59, 50] },   // bleached driftwood
      glow: [150, 212, 198]
    }
  };

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s < 0) s = 0; if (s > 1) s = 1;
    if (l < 0) l = 0; if (l > 1) l = 1;
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  function hash01(n) {
    n = Math.imul(n ^ 0x9E3779B9, 0x85EBCA6B);
    n ^= n >>> 13; n = Math.imul(n, 0xC2B2AE35); n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /* ======================================================================
   *  Sands
   *
   *  A sand is everything of a theme but its caps: the grains (sand), the
   *  companion tone of layered sand (sand2), the glint, how it takes the
   *  light, and what follows the sand: the tint and smoke of the glass and
   *  the glow of the room. `ui` is what the page wears with it: the accent
   *  and its ink, the glow as "r, g, b" and its strength (the --accent,
   *  --accent-ink, --glow and --glow-a of styles.css), and orb, the three
   *  stops of its swatch (lit, body, shade).
   *
   *  The first six are the sands of THEMES, the very same tables, so they
   *  can never drift from them. Renderer.setLook puts a sand over a frame.
   * ==================================================================== */

  function sandOf(id, ui) {
    var t = THEMES[id];
    return { id: id, name: t.short, sand: t.sand, sand2: t.sand2, glint: t.glint, light: t.light, glass: t.glass, glow: t.glow, ui: ui };
  }
  var SANDS = {
    sahara: sandOf('sahara', { accent: '#e9b872', accentInk: '#1b1206', glow: '255, 176, 92', glowA: 0.20, orb: ['#f0c98a', '#cf9645', '#8f5b23'] }),
    // (the page's glow for the black sand is a shade warmer than the room's, as it has always been)
    volcanic: sandOf('volcanic', { accent: '#d9b061', accentInk: '#171003', glow: '214, 164, 78', glowA: 0.15, orb: ['#4a4658', '#201f29', '#0c0c11'] }),
    moonstone: sandOf('moonstone', { accent: '#c9d6ea', accentInk: '#0d131c', glow: '168, 196, 235', glowA: 0.19, orb: ['#f6f3ec', '#cfd6e2', '#8e99ab'] }),
    lapis: sandOf('lapis', { accent: '#d1ad5e', accentInk: '#0a1022', glow: '104, 136, 230', glowA: 0.16, orb: ['#3c5bb8', '#1e2f72', '#0d1638'] }),
    rosequartz: sandOf('rosequartz', { accent: '#e9b0b2', accentInk: '#1f1012', glow: '236, 168, 178', glowA: 0.17, orb: ['#fbe3e4', '#e8b4ba', '#b97f88'] }),
    seaglass: sandOf('seaglass', { accent: '#a3d6c9', accentInk: '#0b1816', glow: '150, 212, 198', glowA: 0.17, orb: ['#e6f6f1', '#a9d6cb', '#5f9a8e'] }),
    // Almandine garnet: the wine-red heavy sand of Pfeiffer Beach and Emerald Creek.
    garnet: {
      id: 'garnet', name: 'Red Garnet',
      sand: {
        h: 350, s: 0.56, l: 0.36, dh: 7, dl: 0.065,
        dark: { p: 0.10, h: 342, s: 0.52, l: 0.22 },    // pyrope: deep burgundy
        alt: { p: 0.11, h: 4, s: 0.62, l: 0.47 },        // spessartine: a warmer, brighter red
        mica: { p: 0.05, h: 345, s: 0.55, l: 0.74 }      // rhodolite: translucent pink facets
      },
      // layered: the pale quartz beach it lies on in bands
      sand2: {
        h: 18, s: 0.34, l: 0.59, dh: 8, dl: 0.06,
        dark: { p: 0.06, h: 12, s: 0.32, l: 0.43 },
        alt: { p: 0.12, h: 26, s: 0.40, l: 0.66 },
        mica: { p: 0.05, h: 30, s: 0.30, l: 0.90 }
      },
      glint: [255, 226, 230],
      // a dark sand, lit nearly as lapis is
      light: {
        rim: [8, 4], aoMax: 6, gloss: 0.20, glossBoost: 9, hl: 1.05, tint: [255, 238, 241],
        bloom: 0.70, bloomColor: [255, 178, 188],
        emit: { mica: 0.24, gloss: 0.03, rim: 0.12, haze: 0.008 }, backlight: 0.07
      },
      glass: { tint: [255, 226, 230], smoke: 0.13 },
      glow: [226, 110, 122],
      ui: { accent: '#e59aa2', accentInk: '#1c0a0d', glow: '226, 110, 122', glowA: 0.16, orb: ['#c4506a', '#8a2a3f', '#3a0e1a'] }
    },
    // Olivine: the green sand of Papakolea, Hawaii. Glassy peridot crystals weathered out of basalt.
    olivine: {
      id: 'olivine', name: 'Olivine',
      sand: {
        h: 75, s: 0.38, l: 0.40, dh: 9, dl: 0.075,
        dark: { p: 0.07, h: 40, s: 0.16, l: 0.20 },      // basalt
        alt: { p: 0.12, h: 66, s: 0.56, l: 0.52 },       // peridot: clear yellow-green crystals
        mica: { p: 0.05, h: 60, s: 0.50, l: 0.84 }
      },
      // layered: the same sand in deep shade, moss over dark basalt
      sand2: {
        h: 106, s: 0.26, l: 0.28, dh: 10, dl: 0.05,
        dark: { p: 0.07, h: 118, s: 0.24, l: 0.18 },
        alt: { p: 0.12, h: 94, s: 0.32, l: 0.35 },
        mica: { p: 0.05, h: 62, s: 0.46, l: 0.78 }
      },
      glint: [248, 255, 214],
      // a mid tone: a little glassier than the pale sands
      light: {
        rim: [4, 2], aoMax: 7, gloss: 0.18, glossBoost: 6, hl: 0.95, tint: [255, 255, 250],
        bloom: 0.55, bloomColor: [232, 244, 170],
        emit: { mica: 0.14, gloss: 0.025, rim: 0.06, haze: 0.007 }, backlight: 0.05
      },
      glass: { tint: [240, 248, 214], smoke: 0.09 },
      glow: [196, 210, 138],
      ui: { accent: '#c6d28a', accentInk: '#13190a', glow: '196, 210, 138', glowA: 0.17, orb: ['#c3d07c', '#8a9c45', '#46521f'] }
    },
    // Amethyst: violet quartz, banded with white as chevron amethyst is.
    amethyst: {
      id: 'amethyst', name: 'Amethyst',
      sand: {
        h: 270, s: 0.40, l: 0.55, dh: 8, dl: 0.07,
        dark: { p: 0.07, h: 262, s: 0.44, l: 0.36 },    // deep Siberian violet
        alt: { p: 0.13, h: 286, s: 0.34, l: 0.72 },      // pale lilac
        mica: { p: 0.05, h: 280, s: 0.20, l: 0.95 }
      },
      // layered: the milky quartz of a chevron band
      sand2: {
        h: 276, s: 0.12, l: 0.80, dh: 10, dl: 0.06,
        dark: { p: 0.06, h: 268, s: 0.18, l: 0.62 },
        alt: { p: 0.12, h: 290, s: 0.22, l: 0.84 },
        mica: { p: 0.05, h: 280, s: 0.14, l: 0.97 }
      },
      glint: [250, 242, 255],
      light: {
        rim: [3, 1], aoMax: 8, gloss: 0.16, glossBoost: 5, hl: 0.9, tint: [255, 255, 255],
        bloom: 0.55, bloomColor: [226, 204, 255],
        emit: { mica: 0.12, gloss: 0.02, rim: 0.06, haze: 0.006 }, backlight: 0.05
      },
      glass: { tint: [238, 226, 255], smoke: 0.09 },
      glow: [188, 150, 228],
      ui: { accent: '#c9afe6', accentInk: '#140d1e', glow: '188, 150, 228', glowA: 0.17, orb: ['#cdb2ea', '#9670c4', '#4d3273'] }
    }
  };
  var SAND_ORDER = ['sahara', 'volcanic', 'moonstone', 'lapis', 'rosequartz', 'seaglass', 'garnet', 'olivine', 'amethyst'];

  /*
   * The frame's finishes: the caps of the six themes, named by what they are
   * made of, so the frame can be chosen apart from the sand. `theme` is the
   * theme whose caps it is (what Renderer.setLook takes as `material`).
   */
  var FINISHES = {
    walnut: { id: 'walnut', name: 'Walnut', theme: 'sahara' },
    brass: { id: 'brass', name: 'Brass', theme: 'volcanic' },
    silver: { id: 'silver', name: 'Silver', theme: 'moonstone' },
    gold: { id: 'gold', name: 'Gold', theme: 'lapis' },
    copper: { id: 'copper', name: 'Copper', theme: 'rosequartz' },
    driftwood: { id: 'driftwood', name: 'Driftwood', theme: 'seaglass' }
  };
  var FINISH_ORDER = ['walnut', 'brass', 'silver', 'gold', 'copper', 'driftwood'];
  /** The finish a theme's own caps are: finishOf('lapis') is 'gold'. Null for what is no theme. */
  function finishOf(themeId) {
    for (var i = 0; i < FINISH_ORDER.length; i++) if (FINISHES[FINISH_ORDER[i]].theme === themeId) return FINISH_ORDER[i];
    return null;
  }

  /**
   * A sand from one colour: customSand(h, s, l), hue in degrees, saturation
   * and lightness 0..1. It gives a whole record like those of SANDS (id
   * 'custom'), a new one every call. Everything is derived as the nine were
   * made by hand, by blending the three ways they are built: a coloured sand
   * (its own shadow, amber grains, near-white glints), a pale neutral one
   * (moonstone: the shimmer of the opposite temperature) and a dark neutral
   * one (volcanic: iridescence and flecks of gold). The blends are done in
   * RGB, so nothing jumps as the colour is dragged.
   *
   * customSand.clamp(h, s, l) is the colour it really uses, { h, s, l }: a
   * sand must keep its facets (not too pale, not too saturated) and must
   * show against the near-black room (not too dark).
   */
  var customSand = (function () {
    function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
    function wrap(h) { return ((h % 360) + 360) % 360; }
    function r2(x) { return Math.round(x * 100) / 100; }
    function r3(x) { return Math.round(x * 1000) / 1000; }
    function hslOf(c) {
      var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, h = 0, s = 0;
      if (d > 1e-9) {
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (mx === g) h = ((b - r) / d + 2) * 60;
        else h = ((r - g) / d + 4) * 60;
      }
      return { h: h, s: s, l: l };
    }
    function ints(c) { return [Math.round(clamp(c[0], 0, 255)), Math.round(clamp(c[1], 0, 255)), Math.round(clamp(c[2], 0, 255))]; }
    function hex(c) {
      c = ints(c);
      return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
    }
    /** Several colours blended in RGB (the weights need not sum to 1), as { h, s, l }. */
    function blend(cols, ws) {
      var o = [0, 0, 0], W = 0, i;
      for (i = 0; i < cols.length; i++) {
        var c = hsl(cols[i].h, cols[i].s, cols[i].l);
        o[0] += c[0] * ws[i]; o[1] += c[1] * ws[i]; o[2] += c[2] * ws[i]; W += ws[i];
      }
      return hslOf([o[0] / W, o[1] / W, o[2] / W]);
    }
    /** How bright a colour looks, 0..1 (Rec. 709 weights on the display values). */
    function luma(h, s, l) { var c = hsl(h, s, l); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
    /** The shorter way round from hue a to hue b, -180..180. */
    function hueTo(a, b) { return ((b - a + 540) % 360) - 180; }
    /** Relative luminance and contrast as WCAG counts them: for the accent and its ink, and the dark floor. */
    function relLum(c) {
      function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    }
    function contrast(a, b) { var x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    function kind(p, c) { return { p: p, h: Math.round(wrap(c.h)), s: r2(clamp(c.s, 0, 1)), l: r2(clamp(c.l, 0, 1)) }; }

    // the two ways the presets are lit: pale sand, and volcanic black
    var LIGHT = { rim0: 3, rim1: 1, aoMax: 8, gloss: 0.14, glossBoost: 4, hl: 0.9, bloom: 0.5, eMica: 0.10, eGloss: 0.02, eRim: 0.05, eHaze: 0.006, backlight: 0.045 };
    var DARK = { rim0: 10, rim1: 5, aoMax: 5, gloss: 0.24, glossBoost: 12, hl: 1.15, bloom: 0.85, eMica: 0.34, eGloss: 0.04, eRim: 0.18, eHaze: 0.010, backlight: 0.09 };

    /**
     * How much of the dark-sand lighting a sand needs, 0 (pale) to 1 (volcanic
     * black). Lightness alone misjudges it: a deep blue is as dark to the eye
     * as black sand, a yellow of the same lightness is not. Two measures, and
     * the larger counts: half lightness and half luma (dark greens and reds),
     * and relative luminance (blues and violets). Both are fitted so that
     * volcanic gives 1 and lapis 0.70, the share its hand-made lighting has.
     */
    function darkness(h, s, l) {
      var v = 0.5 * l + 0.5 * luma(h, s, l), y = relLum(hsl(h, s, l));
      return clamp(Math.max((0.456 - v) / 0.213, (0.118 - y) / 0.074), 0, 1);
    }

    /*
     * The colour really used.
     *   hue         wrapped into 0..360. A colourless input (saturation under
     *               0.03) has no hue to speak of: a pale grey is given
     *               moonstone's warm 40, a dark one volcanic's cool 236.
     *   saturation  0.06 to 0.70 (above, the highlights clip to a flat colour).
     *   lightness   0.22 to 0.84 (0.80 from saturation 0.30 up). Then a pale
     *               colour's brightest channel is held at 0.885, where rose
     *               quartz has it, by lowering the lightness (to 0.78 at the
     *               least) and then the saturation: every bead keeps its
     *               facets. And a dark colour is lifted until the sand shows
     *               against the room about as well as the darkest presets do
     *               (half lightness and half luma at least 0.235, just under
     *               volcanic's, and relative luminance at least 0.038): a navy
     *               ends near lapis's lightness, a black at volcanic's.
     */
    var VMAX = 0.885, VMIN = 0.235, LMIN = 0.038;
    var ROOM = [11, 12, 14];                           // the near-black the page lies on (--bg of styles.css)
    function clampSand(h, s, l) {
      h = +h; s = +s; l = +l;
      if (!isFinite(h)) h = 36;
      if (!isFinite(s)) s = 0.5;
      if (!isFinite(l)) l = 0.6;
      h = wrap(h);
      if (s < 0.03) h = l < 0.45 ? 236 : 40;
      s = clamp(s, 0.06, 0.70);
      l = clamp(l, 0.22, 0.84 - 0.04 * clamp((s - 0.14) / 0.16, 0, 1));
      if (l > 0.5 && l + s * (1 - l) > VMAX) {
        l = Math.max(Math.min(l, 0.78), Math.min(l, (VMAX - s) / (1 - s)));
        s = Math.min(s, (VMAX - l) / (1 - l));
      }
      var n = 0;
      while ((relLum(hsl(h, s, l)) < LMIN || 0.5 * l + 0.5 * luma(h, s, l) < VMIN) && l < 0.5 && n++ < 200) l += 0.004;
      return { h: Math.round(h * 10) / 10, s: r3(s), l: r3(l) };
    }

    /** A tone's mean colour at mid light, near enough to what the colour table gives, to steer by. */
    function toneMean(sd) {
      var m = 0.34 + 24 * 0.031, parts = [[sd.dark, sd.dark.p], [sd.alt, sd.alt.p], [sd.mica, sd.mica.p], [sd, 1 - sd.dark.p - sd.alt.p - sd.mica.p]];
      var o = [0, 0, 0], i, j;
      for (i = 0; i < parts.length; i++) {
        var c = hsl(parts[i][0].h, parts[i][0].s, parts[i][0].l);
        for (j = 0; j < 3; j++) o[j] += Math.min(255, c[j] * m) * parts[i][1];
      }
      return o;
    }
    function dist(a, b) { return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2) + Math.pow(a[2] - b[2], 2)); }

    function customSand(h, s, l) {
      var c = clampSand(h, s, l);
      h = c.h; s = c.s; l = c.l;

      var k = darkness(h, s, l);                       // 0 pale … 1 black: the lighting it needs
      var n = clamp((0.24 - s) / 0.10, 0, 1);          // 0 coloured … 1 neutral (moonstone 1, volcanic 1, sea glass 0)
      var t = smooth(0.30, 0.65, k);                   // 0 pale sparkle … 1 flecks of gold (lapis 1)
      var wC = 1 - n, wLN = n * (1 - t), wDN = n * t;  // the shares of the three ways a preset is built
      var cool = hueTo(h, 250) >= 0 ? 1 : -1;          // shadows lean toward blue-violet
      var d40 = hueTo(h, 40), warm = d40 >= 0 ? 1 : -1; // lighter grains lean toward amber

      // --- the sand's own grains ---
      var dh = Math.round(lerp(lerp(10, 6, clamp((s - 0.14) / 0.48, 0, 1)), 20, wDN));
      var dl = r3(0.07 - 0.01 * k);

      var dark = blend([
        { h: h + cool * Math.min(14, Math.abs(hueTo(h, 250))), s: s * 0.88, l: l * (0.70 - 0.05 * k) },
        { h: h + 176, s: s * 0.86, l: l * 0.75 },      // a pale neutral sand: its shadow is the other temperature
        { h: h + 4, s: s * 0.9, l: l * 0.59 }
      ], [wC, wLN, wDN]);

      // lighter, livelier grains: 22° toward amber; a sand that is amber already gets deeper amber grains
      var shift = Math.min(22, Math.abs(d40)), f = 1 - shift / 22;
      var alt = blend([
        { h: h + warm * shift * (1 - f) - 8 * f, s: s + 0.07 + 0.01 * f, l: l + 0.04 + 0.08 * k - 0.11 * f * (1 - k) },
        { h: h + 164, s: s + 0.20, l: l - 0.01 },      // moonstone: the shimmer of the opposite temperature
        { h: h + 26, s: s + 0.19, l: l + 0.11 }        // volcanic: iridescent
      ], [wC, wLN, wDN]);

      // glints: near-white on pale sand, flecks of gold on dark sand; on a dark sand that is gold or brown itself,
      // champagne, and no paler than this: under the strong light a dark sand is given, paler flecks burn out to white
      var ml = clamp(0.90 + 0.4 * (l - 0.61), 0.88, 0.98);
      var gd = smooth(25, 50, Math.abs(hueTo(h, 45))), goldish = Math.max(n, gd);
      var mica = blend([
        { h: h + 10, s: clamp(6.5 * s * (1 - ml), 0.08, 0.45), l: ml },
        { h: h + 156, s: 0.20, l: 0.98 },
        { h: 45, s: 0.84, l: 0.62 },
        { h: 47, s: 0.50, l: 0.70 }
      ], [wC * (1 - t), wLN, t * goldish + 1e-6, t * (1 - goldish)]);
      var glint = ints(hsl(mica.h, 1, 0.95 - 0.16 * t * goldish - 0.08 * t * (1 - goldish)));

      var sand = {
        h: Math.round(h), s: r2(s), l: r3(l), dh: dh, dl: dl,
        dark: kind(r3(0.05 + 0.05 * k), dark),
        alt: kind(0.12, alt),
        mica: kind(r3(0.05 + 0.02 * t), mica)
      };

      // --- how it takes the light: between the pale way and the volcanic one ---
      // (rim, aoMax and glossBoost are whole numbers: they index the colour table)
      function L(a) { return lerp(LIGHT[a], DARK[a], k); }
      var tint = k > 0 ? ints(hsl(h, lerp(1, 0.2, n), 1 - 0.06 * k)) : [255, 255, 255];
      var bc = blend([
        { h: h, s: 1, l: 0.80 + 0.12 * (1 - s) },
        { h: alt.h, s: 1, l: 0.90 },
        { h: 36, s: 1, l: 0.845 }
      ], [wC, wLN, wDN]);
      var light = {
        rim: [Math.round(L('rim0')), Math.round(L('rim1'))],
        aoMax: Math.round(L('aoMax')),
        gloss: r2(L('gloss')), glossBoost: Math.round(L('glossBoost')), hl: r2(L('hl')),
        tint: tint, bloom: r2(L('bloom')), bloomColor: ints(hsl(bc.h, bc.s, bc.l)),
        emit: { mica: r2(L('eMica')), gloss: r3(L('eGloss')), rim: r2(L('eRim')), haze: r3(L('eHaze')) },
        backlight: r3(L('backlight'))
      };

      // --- the room and the glass follow the sand ---
      var amber = smooth(60, 20, Math.abs(hueTo(h, 35))) * wC;      // warm sands glow like a candle (sahara)
      var gl = blend([
        { h: h - 5 * amber, s: clamp(0.35 + 0.6 * s, 0.4, 0.8) + 0.2 * amber, l: 0.52 + 0.33 * l - 0.04 * amber },
        { h: h + 171, s: 0.63, l: 0.79 },
        { h: 38, s: 0.54, l: 0.56 }
      ], [wC, wLN, wDN]);
      var glow = ints(hsl(gl.h, gl.s, gl.l)), guard = 0;
      // (the page writes its status line in the glow: a deep blue or violet is lifted until it reads against the room as lapis's does)
      while (contrast(glow, ROOM) < 5.8 && gl.l < 0.9 && guard++ < 60) { gl.l += 0.01; glow = ints(hsl(gl.h, gl.s, gl.l)); }
      var gt = blend([
        { h: h, s: 1, l: 0.93 },
        { h: h + 170, s: 1, l: 0.92 },
        { h: 33, s: 0.18, l: 0.80 }
      ], [wC, wLN, wDN]);
      var glass = { tint: ints(hsl(gt.h, gt.s, gt.l)), smoke: r2(0.08 + 0.22 * k * k * k) };

      // --- the companion tone of layered sand ---
      var s2, mode;
      if (t >= 0.5) {                                  // dark sand: a seam of old gold (lapis), pumice under black,
        s2 = blend([{ h: 38, s: 0.42, l: 0.40 }, { h: 28, s: 0.13, l: 0.44 }, { h: h + 6, s: 0.22, l: 0.60 }],   // pale bone under a dark sand that is gold or brown itself
                   [wC * gd + 1e-6, n, wC * (1 - gd)]);
        mode = 1;
      } else if (l >= 0.60) {                          // pale sand: its own deeper shadow
        s2 = blend([{ h: h + cool * 15, s: s * 0.8, l: l - 0.20 }, { h: h + 172, s: 0.22, l: l - 0.23 }], [wC + 1e-6, n]);
        mode = -1;
      } else {                                         // mid-tone sand: the same sand bleached by the sun
        s2 = blend([{ h: h + warm * Math.min(12, Math.abs(d40)), s: s * 0.6, l: Math.min(0.80, l + 0.22) }, { h: h + 172, s: 0.20, l: Math.min(0.80, l + 0.22) }], [wC + 1e-6, n]);
        mode = 1;
      }
      function companion(b) {
        var c2 = hueTo(b.h, 250) >= 0 ? 1 : -1, w2 = hueTo(b.h, 40) >= 0 ? 1 : -1;
        var gold2 = t >= 0.5 && goldish > 0.5;
        return {
          h: Math.round(wrap(b.h)), s: r2(b.s), l: r3(b.l), dh: Math.min(dh, 10), dl: 0.06,
          dark: kind(Math.min(sand.dark.p, 0.08), { h: b.h + c2 * 6, s: b.s * 0.9, l: b.l - 0.14 }),
          alt: kind(0.12, { h: b.h + w2 * 8, s: b.s + 0.07, l: b.l + 0.07 }),
          mica: gold2 ? kind(0.06, { h: 50, s: 0.85, l: 0.72 })
                      : kind(sand.mica.p, { h: mica.h, s: mica.s * 1.1, l: mica.l - 0.03 - 0.07 * (1 - clamp(b.l / 0.6, 0, 1)) })
        };
      }
      // the two tones are kept clearly apart and never loud
      var sand2 = companion(s2), dd = dist(toneMean(sand), toneMean(sand2));
      guard = 0;
      while ((dd < 56 || dd > 170) && guard++ < 40) {
        s2.l = clamp(s2.l + (dd < 56 ? mode : -mode) * 0.02, 0.20, 0.86);
        if (dd < 56 && (s2.l <= 0.20 || s2.l >= 0.86)) s2.s = clamp(s2.s - 0.03, 0, 1);
        sand2 = companion(s2);
        dd = dist(toneMean(sand), toneMean(sand2));
      }

      // --- what the page wears: a light accent, its ink nearly black, and the ink readable on it ---
      var ac = blend([
        { h: h, s: clamp(s + 0.10, 0.36, 0.72), l: clamp(l + 0.04, 0.64, 0.82) },
        { h: gl.h, s: 0.44, l: 0.85 },
        { h: 40, s: 0.60, l: 0.61 }
      ], [wC, wLN, wDN]);
      var ik = blend([{ h: h, s: 0.5, l: 0.07 }, { h: gl.h, s: 0.37, l: 0.08 }, { h: 39, s: 0.77, l: 0.05 }], [wC, wLN, wDN]);
      var ink = ints(hsl(ik.h, ik.s, ik.l)), accent = ints(hsl(ac.h, ac.s, ac.l));
      guard = 0;
      while (contrast(accent, ink) < 7.5 && ac.l < 0.88 && guard++ < 60) { ac.l += 0.01; accent = ints(hsl(ac.h, ac.s, ac.l)); }

      // the swatch: lit, body, shade (a pale neutral sand shows its shimmer in the body, as moonstone's does)
      var o1 = blend([{ h: h, s: s * 0.9, l: Math.min(0.95, l + 0.13 - 0.07 * k) }], [1]);
      var o2 = blend([{ h: h, s: s, l: l * (0.90 - 0.3 * k) }, { h: alt.h, s: alt.s * 0.6, l: alt.l }], [1 - 0.6 * wLN, 0.6 * wLN]);
      var o3 = blend([{ h: h + cool * 5, s: s * 0.8, l: l * (0.68 - 0.4 * k) }, { h: dark.h, s: dark.s, l: dark.l * 0.95 }], [1 - 0.7 * wLN, 0.7 * wLN]);

      return {
        id: 'custom', name: 'Custom',
        sand: sand, sand2: sand2, glint: glint, light: light, glass: glass, glow: glow,
        ui: {
          accent: hex(accent), accentInk: hex(ink),
          glow: glow.join(', '), glowA: r2(0.18 - 0.03 * k),
          orb: [hex(hsl(o1.h, o1.s, o1.l)), hex(hsl(o2.h, o2.s, o2.l)), hex(hsl(o3.h, o3.s, o3.l))]
        }
      };
    }
    customSand.clamp = clampSand;
    return customSand;
  })();


  _.hash01 = hash01; _.hsl = hsl; _.rgba = rgba; _.mix = mix; P.finishOf = finishOf; P.THEMES = THEMES;
  P.SANDS = SANDS; P.SAND_ORDER = SAND_ORDER; P.FINISHES = FINISHES; P.FINISH_ORDER = FINISH_ORDER;
  P.customSand = customSand;
  _.loaded = 'sand/sands.js';
})(typeof window !== 'undefined' ? window : globalThis);
