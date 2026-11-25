/*
 * Hourglass sand lab: grain colours.
 *
 * The sand's are the app's Sahara palette, made exactly as glass/renderer.js
 * Renderer._buildLUT makes its 256 base colours from THEMES.sahara.sand
 * (iron-stained dark grains, amber grains, mica glints, and the quartz body
 * varied in hue, saturation and lightness). The liquids are the lab's own.
 * Each entry: [r, g, b, 1] in 0..1, or [r, g, b, 2] for a mica grain that glints.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */

export const SAHARA = {
  h: 36, s: 0.62, l: 0.61, dh: 6, dl: 0.085,
  dark: { p: 0.045, h: 22, s: 0.50, l: 0.36 },
  alt: { p: 0.11, h: 30, s: 0.70, l: 0.54 },
  mica: { p: 0.05, h: 46, s: 0.40, l: 0.90 }
};

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s < 0) s = 0; if (s > 1) s = 1;
  if (l < 0) l = 0; if (l > 1) l = 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

function hash01(n) {
  n = Math.imul(n ^ 0x9E3779B9, 0x85EBCA6B);
  n ^= n >>> 13; n = Math.imul(n, 0xC2B2AE35); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

/** 256 x vec4 for the grain shader. */
export function palette(kind) {
  const out = new Float32Array(256 * 4);
  for (let s = 0; s < 256; s++) {
    const u1 = hash01(s * 7 + 1), u2 = hash01(s * 13 + 5), u3 = hash01(s * 29 + 11);
    let c, mica = 0;
    if (kind === 'water') {
      c = hsl(203 + (u1 - 0.5) * 14, 0.62 + (u3 - 0.5) * 0.2, 0.52 + (u2 - 0.5) * 0.12);
    } else if (kind === 'syrup') {
      c = hsl(29 + (u1 - 0.5) * 8, 0.86, 0.36 + (u2 - 0.5) * 0.08);
    } else {
      const sd = SAHARA;
      const darkN = Math.round(sd.dark.p * 256), micaN = Math.round(sd.mica.p * 256), altN = Math.round(sd.alt.p * 256);
      if (s < darkN) c = hsl(sd.dark.h + (u1 - 0.5) * 10, sd.dark.s, sd.dark.l + (u2 - 0.5) * 0.08);
      else if (s >= 256 - micaN) { c = hsl(sd.mica.h + (u1 - 0.5) * 14, sd.mica.s, sd.mica.l - u2 * 0.08); mica = 1; }
      else if (s >= 256 - micaN - altN) c = hsl(sd.alt.h + (u1 - 0.5) * sd.dh * 2.4, sd.alt.s, sd.alt.l + (u2 - 0.5) * sd.dl);
      else c = hsl(sd.h + (u1 - 0.5) * 2 * sd.dh, sd.s + (u3 - 0.5) * 0.16, sd.l + (u2 - 0.5) * 2 * sd.dl);
      if (kind === 'fine') { c = c.map(v => v * 0.97 + 0.02); }
    }
    out.set([c[0], c[1], c[2], mica ? 2 : 1], s * 4);
  }
  return out;
}
