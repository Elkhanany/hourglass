/*
 * Colours as the eye compares them, for the checks of the sands' accents (look-unit, app-look):
 *
 *   colour.lab([r, g, b])        CIE L*a*b* (D65) of an sRGB colour, 0..255 a channel
 *   colour.de00(c1, c2)          CIEDE2000 between two sRGB colours: about 1 is the least
 *                                the eye tells apart side by side (1.20.0 had the black
 *                                sand's accent 4.3 from sahara's, lapis's 6.0)
 *   colour.rgb('#rrggbb' | 'rgb(r, g, b)')   [r, g, b], or null
 */
'use strict';
function lab(c) {
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  var r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
  var x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function de00(c1, c2) {
  var p = lab(c1), q = lab(c2), rad = Math.PI / 180, P7 = Math.pow(25, 7);
  var C1 = Math.hypot(p[1], p[2]), C2 = Math.hypot(q[1], q[2]), Cb = (C1 + C2) / 2;
  var G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + P7)));
  var a1 = (1 + G) * p[1], a2 = (1 + G) * q[1], C1p = Math.hypot(a1, p[2]), C2p = Math.hypot(a2, q[2]);
  var h1 = (Math.atan2(p[2], a1) / rad + 360) % 360, h2 = (Math.atan2(q[2], a2) / rad + 360) % 360;
  var dL = q[0] - p[0], dC = C2p - C1p, dh = C1p * C2p === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  var dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(dh / 2 * rad), Lb = (p[0] + q[0]) / 2, Cbp = (C1p + C2p) / 2, hb = h1 + h2;
  if (C1p * C2p !== 0) { if (Math.abs(h1 - h2) > 180) hb += hb < 360 ? 360 : -360; hb /= 2; }
  var T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  var RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + P7)), RT = -Math.sin(2 * 30 * Math.exp(-Math.pow((hb - 275) / 25, 2)) * rad) * RC;
  var SL = 1 + 0.015 * Math.pow(Lb - 50, 2) / Math.sqrt(20 + Math.pow(Lb - 50, 2)), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  return Math.sqrt(Math.pow(dL / SL, 2) + Math.pow(dC / SC, 2) + Math.pow(dH / SH, 2) + RT * (dC / SC) * (dH / SH));
}
function rgb(s) {
  var m = /^#([0-9a-f]{6})$/i.exec(String(s).trim()), v;
  if (m) { v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(String(s).trim());
  return m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] : null;
}
module.exports = { lab: lab, de00: de00, rgb: rgb };
