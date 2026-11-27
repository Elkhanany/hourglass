/*
 * the look, in Node: the sands (P.SANDS, P.SAND_ORDER, P.customSand) and how
 * the renderer puts a theme together from one (Renderer.prototype.setLook).
 *
 *   the nine sands are there in their order; the first six are the sands of
 *   P.THEMES field for field, P.THEMES is what it was at 4d5e173, and their
 *   colour tables are the ones the renderer always built (7f71786)
 *   the page's colours for the six (ui) are the ones styles.css has
 *   every sand's accent is its own: no two of the nine closer than 10
 *   (CIEDE2000), each a fill with its ink and the light look's text on
 *   the paper; the custom rule gives a black sand no gold (1.20.0's must fail)
 *   every sand, and customSand over a spread of colours, meets what the
 *   colour table needs (whole numbers where it is indexed, every light level
 *   inside it, room for plain grains among the seeds), what layered sand
 *   needs (two tones 40 to 190 apart, each with its own mica) and what the
 *   eye needs (the bed and the lit surface show against the room, few
 *   grains clip, the accent is light and its ink readable on it, the glow
 *   reads against the room)
 *   customSand.clamp keeps a colour where it is good, brings one in that is
 *   not, and changes nothing when it is given its own answer
 *   setLook composes a new theme object every time, the same picture as
 *   setTheme for the six, with the caps of the material; with `live` it
 *   leaves the static layers alone; setTheme still hands out P.THEMES[id]
 *   the Sim does not know of any of it
 *
 *   node tools/test/look-unit.test.js        exits 0 when every case passes
 */
'use strict';
var fs = require('fs');
var path = require('path');
var L = require('./lib/load-physics.js');
var paths = require('./lib/paths.js');
var colour = require('./lib/colour.js');
var P = L.P;
var LUT_REV = '7f71786';               // the renderer before layered sand
var LOOK_REV = '4d5e173';              // the last version before sands and frames came apart
var SIX = ['sahara', 'volcanic', 'moonstone', 'lapis', 'rosequartz', 'seaglass'];
var BG = [11, 12, 14];                 // the room: --bg of styles.css

var failures = 0, count = 0;
function test(name, fn) {
  var t0 = Date.now(), detail;
  count++;
  try {
    detail = fn();
    console.log('PASS  ' + name + (detail ? ': ' + detail : '') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  } catch (e) {
    failures++;
    console.log('FAIL  ' + name + ': ' + (e && e.message ? e.message : e));
    if (process.env.VERBOSE && e && e.stack) console.log(e.stack);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function js(x) { return JSON.stringify(x); }

function lutOf(Ph, theme, layers) {
  var o = { theme: theme, lut: new Uint32Array(48 * 256), isMica: new Uint8Array(256), hiBoost: new Uint8Array(256),
            emit: new Float32Array(256), aoTab: new Uint8Array(256), layers: !!layers };
  Ph.Renderer.prototype._buildLUT.call(o);
  return o;
}
/** Two tables, entry for entry (and what goes with them). Returns what differs first, or ''. */
function tablesDiffer(a, b) {
  var i;
  for (i = 0; i < a.lut.length; i++) if (a.lut[i] !== b.lut[i]) return 'colour ' + i;
  for (i = 0; i < 256; i++) if (a.isMica[i] !== b.isMica[i] || a.hiBoost[i] !== b.hiBoost[i] || a.emit[i] !== b.emit[i] || a.aoTab[i] !== b.aoTab[i]) return 'seed ' + i;
  if (a.glintColor !== b.glintColor || a.bloomRGB !== b.bloomRGB) return 'glint or bloom';
  return '';
}
/** A sand over walnut caps, as setLook composes it. */
function compose(rec, material) {
  return { id: rec.id, name: rec.name, short: rec.name, sand: rec.sand, sand2: rec.sand2, glint: rec.glint, light: rec.light,
           glass: rec.glass, cap: P.THEMES[material || 'sahara'].cap, glow: rec.glow };
}
function isInt(x) { return typeof x === 'number' && x === Math.round(x); }
function rgbOk(c) { return Array.isArray(c) && c.length === 3 && c.every(function (v) { return isInt(v) && v >= 0 && v <= 255; }); }
function hexRgb(h) { var m = /^#([0-9a-f]{6})$/.exec(h); if (!m) return null; var v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
function hslL(c) { return (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510; }
function relLum(c) { function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
function contrast(a, b) { var x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function meanAt(o, lv, lo, hi) {
  var m = [0, 0, 0], s, v, n = hi - lo;
  for (s = lo; s < hi; s++) { v = o.lut[(lv << 8) | s]; m[0] += (v & 255) / n; m[1] += ((v >>> 8) & 255) / n; m[2] += ((v >>> 16) & 255) / n; }
  return m;
}

/**
 * Everything a sand record must satisfy. Throws at the first thing that does
 * not hold; returns the numbers worth printing.
 *
 * The limits on what the eye needs are set a little past the weakest of the
 * six sands the app has always had: the bed of volcanic black stands 1.67:1
 * against the room (the floor here: 1.5), rose quartz clips 31 grains of 256
 * at the brightest body level (the ceiling: 36), their accents have a
 * lightness of 0.59 to 0.85 and inks of 0.05 to 0.09.
 */
function check(rec, tag) {
  var li = rec.light, i, s, kinds = ['dark', 'alt', 'mica'];
  ['id', 'name', 'sand', 'sand2', 'glint', 'light', 'glass', 'glow', 'ui'].forEach(function (k) { ok(rec[k] !== undefined, tag + ': no ' + k); });
  ok(rec.cap === undefined, tag + ': carries a cap (that is the frame\'s)');
  [rec.sand, rec.sand2].forEach(function (sd, q) {
    var nm = tag + (q ? ' sand2' : ' sand'), tot = 0, tot2 = 0;
    ['h', 's', 'l', 'dh', 'dl'].forEach(function (k) { ok(typeof sd[k] === 'number' && isFinite(sd[k]), nm + '.' + k + ' is ' + sd[k]); });
    ok(sd.s >= 0 && sd.s <= 1 && sd.l >= 0 && sd.l <= 1, nm + ': s or l outside 0..1');
    kinds.forEach(function (k) {
      ok(sd[k] && typeof sd[k].p === 'number' && sd[k].p > 0 && typeof sd[k].h === 'number' && sd[k].s >= 0 && sd[k].s <= 1 && sd[k].l >= 0 && sd[k].l <= 1, nm + '.' + k + ' ' + js(sd[k]));
      tot += Math.round(sd[k].p * 256);
      tot2 += Math.ceil(Math.round(sd[k].p * 256) / 2);
    });
    // the seeds: dark grains from 0 up, alt and mica from the top down; plain grains keep at least half (of the 256, and of a tone's 128)
    ok(tot <= 128, nm + ': dark, alt and mica take ' + tot + ' of 256 seeds');
    ok(tot2 <= 64, nm + ': dark, alt and mica take ' + tot2 + ' of a tone\'s 128 seeds');
  });
  // the light: whole numbers where the tables are bytes, and every level it leads to inside the table
  ok(isInt(li.rim[0]) && isInt(li.rim[1]) && isInt(li.aoMax) && isInt(li.glossBoost), tag + ': rim, aoMax or glossBoost is not a whole number: ' + js([li.rim, li.aoMax, li.glossBoost]));
  ok(li.rim[0] >= 0 && li.rim[0] <= 12 && li.rim[1] >= 0 && li.rim[1] <= 12, tag + ': rim ' + li.rim + ' outside 0..12');
  ok(li.aoMax >= 0 && li.aoMax <= 9, tag + ': aoMax ' + li.aoMax + ' outside 0..9');
  ok(li.glossBoost >= 0 && 3 + li.glossBoost <= 255, tag + ': glossBoost ' + li.glossBoost);
  ok(li.gloss >= 0 && li.gloss <= 1 && li.hl > 0 && li.bloom >= 0 && li.bloom <= 1 && li.backlight >= 0 && li.backlight <= 0.12, tag + ': gloss, hl, bloom or backlight');
  ok(li.emit && ['mica', 'gloss', 'rim', 'haze'].every(function (k) { return typeof li.emit[k] === 'number' && li.emit[k] >= 0 && li.emit[k] < 1; }), tag + ': emit ' + js(li.emit));
  ok(rgbOk(li.tint) && rgbOk(li.bloomColor) && rgbOk(rec.glint) && rgbOk(rec.glow) && rgbOk(rec.glass.tint), tag + ': a colour is not three whole numbers 0..255');
  ok(typeof rec.glass.smoke === 'number' && rec.glass.smoke >= 0 && rec.glass.smoke <= 0.35, tag + ': smoke ' + rec.glass.smoke);

  var th = compose(rec), a = lutOf(P, th, false), c = lutOf(P, th, true);
  var lvMax = 24 + 1 + li.rim[0], lvMin = 12 - li.aoMax;
  ok(lvMax <= 47 && lvMin - 3 >= 0, tag + ': light levels ' + (lvMin - 3) + '..' + lvMax + ' leave the table (0..47)');
  for (i = 0; i < 256; i++) ok(12 - (a.aoTab[i] - 12) - 3 >= 0 && 24 + 1 - (a.aoTab[i] - 12) <= 47, tag + ': aoTab[' + i + '] leaves the table');
  for (i = 0; i < a.lut.length; i++) ok((a.lut[i] >>> 24) === 255 && (c.lut[i] >>> 24) === 255, tag + ': colour ' + i + ' is not opaque');
  // layered sand, as sim-tone asks it of the six: the two tones 40 to 190 apart at mid light, each with its own mica
  var m0 = meanAt(c, 24, 0, 128), m1 = meanAt(c, 24, 128, 256), mica = [0, 0];
  var d = Math.sqrt(Math.pow(m0[0] - m1[0], 2) + Math.pow(m0[1] - m1[1], 2) + Math.pow(m0[2] - m1[2], 2));
  ok(d >= 40 && d <= 190, tag + ': the tones are ' + d.toFixed(0) + ' apart in RGB (too alike below 40, too loud above 190)');
  for (s = 0; s < 256; s++) mica[s >> 7] += c.isMica[s];
  ok(Math.abs(mica[0] - Math.round(rec.sand.mica.p * 128)) <= 1 && Math.abs(mica[1] - Math.round(rec.sand2.mica.p * 128)) <= 1, tag + ': mica seeds ' + mica.join(' / '));
  // what the eye needs, as contrast against the room: the bulk of a bed (level 16), the companion's, the rim-lit surface
  var bulk = contrast(meanAt(a, 16, 0, 256), BG), bulk2 = contrast(meanAt(c, 16, 128, 256), BG);
  var rim = contrast(meanAt(a, Math.min(47, 22 + li.rim[0]), 0, 256), BG);
  ok(bulk >= 1.5, tag + ': the bed is only ' + bulk.toFixed(2) + ':1 against the room');
  ok(bulk2 >= 1.6, tag + ': the companion\'s bed is only ' + bulk2.toFixed(2) + ':1 against the room');
  ok(rim >= 4.5, tag + ': the lit surface is only ' + rim.toFixed(2) + ':1 against the room');
  // facets: at the brightest body level few grains may have a channel at its limit
  var clip = 0, v;
  for (s = 0; s < 256; s++) { v = a.lut[(24 << 8) | s]; if (!a.isMica[s] && ((v & 255) >= 254 || ((v >>> 8) & 255) >= 254 || ((v >>> 16) & 255) >= 254)) clip++; }
  ok(clip <= 36, tag + ': ' + clip + ' of 256 grains clip at level 24');
  // what the page wears
  var ac = hexRgb(rec.ui.accent), ink = hexRgb(rec.ui.accentInk), gm = /^(\d+), (\d+), (\d+)$/.exec(rec.ui.glow);
  ok(ac && ink && gm, tag + ': ui colours are not #rrggbb and "r, g, b": ' + js(rec.ui));
  ok(hslL(ac) >= 0.58 && hslL(ac) <= 0.88, tag + ': accent lightness ' + hslL(ac).toFixed(2));
  ok(hslL(ink) >= 0.04 && hslL(ink) <= 0.10, tag + ': ink lightness ' + hslL(ink).toFixed(2));
  ok(contrast(ac, ink) >= 7, tag + ': ink on accent ' + contrast(ac, ink).toFixed(1) + ':1');
  ok(contrast(ac, BG) >= 7, tag + ': accent on the room ' + contrast(ac, BG).toFixed(1) + ':1');
  // (volcanic's page glow has always been a shade warmer than its room glow)
  if (rec.id !== 'volcanic') ok(+gm[1] === rec.glow[0] && +gm[2] === rec.glow[1] && +gm[3] === rec.glow[2], tag + ': ui.glow ' + rec.ui.glow + ' is not glow ' + rec.glow);
  // the status line is written in the glow: it must read against the room (the weakest of the six, lapis, stands 5.83:1)
  ok(contrast(gm.slice(1).map(Number), BG) >= 5.8, tag + ': the glow ' + rec.ui.glow + ' stands only ' + contrast(gm.slice(1).map(Number), BG).toFixed(2) + ':1 against the room');
  ok(typeof rec.ui.glowA === 'number' && rec.ui.glowA >= 0.14 && rec.ui.glowA <= 0.21, tag + ': glowA ' + rec.ui.glowA);
  ok(Array.isArray(rec.ui.orb) && rec.ui.orb.length === 3 && rec.ui.orb.every(hexRgb), tag + ': ui.orb ' + js(rec.ui.orb));
  return { d: d, bulk: bulk, bulk2: bulk2, rim: rim, clip: clip, ui: contrast(ac, ink) };
}

/* ---- the nine ---- */
test('nine sands in their order; the first six are the sands of THEMES, and THEMES is what it was', function () {
  ok(js(P.SAND_ORDER) === js(SIX.concat(['garnet', 'olivine', 'amethyst'])), 'SAND_ORDER is ' + P.SAND_ORDER);
  ok(js(Object.keys(P.SANDS)) === js(P.SAND_ORDER), 'SANDS has ' + Object.keys(P.SANDS));
  P.SAND_ORDER.forEach(function (id) { ok(P.SANDS[id].id === id && typeof P.SANDS[id].name === 'string' && P.SANDS[id].name.length <= 14, id + ': id or name'); });
  var WAS = L.baseline(LOOK_REV), OLD = L.baseline(LUT_REV), same = 0;
  ok(js(Object.keys(P.THEMES)) === js(SIX), 'THEMES has ' + Object.keys(P.THEMES));
  ok(js(P.THEMES) === js(WAS.THEMES), 'THEMES is not what it was at ' + LOOK_REV);
  SIX.forEach(function (id) {
    var rec = P.SANDS[id], th = P.THEMES[id];
    ['sand', 'sand2', 'glint', 'light', 'glass', 'glow'].forEach(function (k) {
      ok(js(rec[k]) === js(th[k]) && js(rec[k]) === js(WAS.THEMES[id][k]), id + '.' + k + ' is not the theme\'s: ' + js(rec[k]));
    });
    ok(rec.name === th.short, id + ' is named ' + rec.name);
    [false, true].forEach(function (lay) {
      var d = tablesDiffer(lutOf(P, compose(rec, id), lay), lutOf(P, th, lay));
      ok(!d, id + ': the table of the composed theme differs from the theme\'s (' + d + (lay ? ', layers on)' : ')'));
      if (!lay) { d = tablesDiffer(lutOf(P, compose(rec, id), false), lutOf(OLD, OLD.THEMES[id], false)); ok(!d, id + ': the table differs from ' + LUT_REV + ' (' + d + ')'); }
      same++;
    });
  });
  return P.SAND_ORDER.join(', ') + '; ' + same + ' of 12 tables identical (layers off: also to ' + LUT_REV + ')';
});

test('the page\'s colours for the nine are the ones the style sheet has, and each swatch is its sand\'s', function () {
  var css = fs.readFileSync(path.join(paths.ROOT, 'styles.css'), 'utf8'), n = 0;
  P.SAND_ORDER.forEach(function (id) {
    var m = (id === 'sahara' ? /:root\s*\{([^}]*)\}/ : new RegExp('\\[data-theme="' + id + '"\\]\\s*\\{([^}]*)\\}')).exec(css);
    ok(m, 'no rule for ' + id + ' in styles.css');
    function prop(name) { var q = new RegExp('--' + name + ':\\s*([^;]+);').exec(m[1]); ok(q, id + ': no --' + name + ' in styles.css'); return q[1].trim(); }
    var ui = P.SANDS[id].ui;
    ok(prop('accent') === ui.accent, id + ': --accent ' + prop('accent') + ', ui.accent ' + ui.accent);
    ok(prop('accent-ink') === ui.accentInk, id + ': --accent-ink ' + prop('accent-ink') + ', ui.accentInk ' + ui.accentInk);
    ok(prop('glow') === ui.glow, id + ': --glow ' + prop('glow') + ', ui.glow ' + ui.glow);
    ok(+prop('glow-a') === ui.glowA, id + ': --glow-a ' + prop('glow-a') + ', ui.glowA ' + ui.glowA);
    var o = new RegExp('\\.orb-' + id + '\\s*\\{[^}]*linear-gradient\\(160deg, (#[0-9a-f]{6}), (#[0-9a-f]{6}) 55%, (#[0-9a-f]{6})\\)').exec(css);
    ok(o && js([o[1], o[2], o[3]]) === js(ui.orb), id + ': the card\'s swatch is ' + (o ? o.slice(1) : 'missing') + ', ui.orb ' + ui.orb);
    n += 5;
  });
  return n + ' values equal';
});

test('every sand meets what the colour table, layered sand and the eye need', function () {
  var out = [];
  P.SAND_ORDER.forEach(function (id) {
    var r = check(P.SANDS[id], id);
    out.push(id + ' ' + r.d.toFixed(0) + '/' + r.bulk.toFixed(2) + '/' + r.rim.toFixed(1));
  });
  return 'tones apart / bed:room / lit surface:room: ' + out.join(', ');
});

/* ---- a sand from one colour ---- */
var CUSTOM = [
  [8, 0.62, 0.46, 'brick red'], [28, 0.70, 0.58, 'orange'], [52, 0.68, 0.60, 'yellow'], [100, 0.45, 0.45, 'leaf green'],
  [150, 0.50, 0.32, 'dark emerald'], [185, 0.50, 0.50, 'teal'], [205, 0.60, 0.72, 'sky'], [245, 0.50, 0.30, 'indigo'],
  [285, 0.45, 0.55, 'violet'], [325, 0.60, 0.52, 'magenta'], [40, 0.06, 0.50, 'mid grey'], [0, 1, 0.5, 'pure red'],
  [0, 0, 1, 'white'], [0, 0, 0, 'black'], [120, 1, 0.5, 'neon green'], [240, 1, 0.25, 'navy'], [330, 0.5, 0.9, 'pale pink']
];
/* ---- every sand its own accent (1.20.1) ---- */
var lab = colour.lab, de00 = colour.de00;   // (CIEDE2000: about 1 is the least the eye tells apart side by side)
var ACCENT_APART = 10;                   // the least CIEDE2000 between any two sands' accents
var PAPER = [243, 240, 234], SHEET = [250, 248, 244], DEEP = [36, 31, 25];   // the light look: --bg, a sheet, --accent-text's deep brown
/** What is wrong with a set of sands' accents ({id: ui}): [] when each is its own and works in both looks. */
function accentsWrong(uis) {
  var ids = Object.keys(uis), out = [], i, j;
  for (i = 0; i < ids.length; i++) for (j = i + 1; j < ids.length; j++) {
    var d = de00(hexRgb(uis[ids[i]].accent), hexRgb(uis[ids[j]].accent));
    if (d < ACCENT_APART) out.push(ids[i] + ' and ' + ids[j] + ' only ' + d.toFixed(1) + ' apart');
  }
  ids.forEach(function (id) {
    var a = hexRgb(uis[id].accent), ink = hexRgb(uis[id].accentInk);
    // the light look writes it as color-mix(in srgb, accent 36%, #241f19): it must read on the paper and on a sheet,
    // and keep the accent's hue where the accent has one
    var t = a.map(function (v, k) { return Math.round(v * 0.36 + DEEP[k] * 0.64); }), la = lab(a), lt = lab(t);
    var ca = Math.hypot(la[1], la[2]), ha = Math.atan2(la[2], la[1]) * 180 / Math.PI, ht = Math.atan2(lt[2], lt[1]) * 180 / Math.PI;
    var dh = Math.abs(((ht - ha + 540) % 360) - 180);
    if (contrast(a, ink) < 4.5) out.push(id + ': ink on the fill ' + contrast(a, ink).toFixed(1));
    if (contrast(t, PAPER) < 4.5 || contrast(t, SHEET) < 4.5) out.push(id + ': the light look\'s text ' + contrast(t, PAPER).toFixed(1) + ' on the paper');
    if (ca > 15 && dh > 40) out.push(id + ': the light look\'s text turns ' + dh.toFixed(0) + '° from the accent\'s hue');
  });
  return out;
}
test('every sand its own accent: no two of the nine and the custom rule\'s alike, each a fill, a text and a line in both looks', function () {
  var uis = {}, min = 1e9, pair = '';
  P.SAND_ORDER.forEach(function (id) { uis[id] = P.SANDS[id].ui; });
  var bad = accentsWrong(uis);
  ok(!bad.length, bad.join('; '));
  P.SAND_ORDER.forEach(function (a, i) { P.SAND_ORDER.slice(i + 1).forEach(function (b) { var d = de00(hexRgb(uis[a].accent), hexRgb(uis[b].accent)); if (d < min) { min = d; pair = a + '/' + b; } }); });
  ok(de00(hexRgb(uis.volcanic.accent), hexRgb(uis.sahara.accent)) > 20 && de00(hexRgb(uis.lapis.accent), hexRgb(uis.sahara.accent)) > 20, 'black sand or lapis still near sahara\'s gold');
  // the custom rule: a black, a grey, a white, a navy each wears its own (a black is not given sahara's gold)
  var C = { black: [0, 0, 0.1], navy: [230, 0.6, 0.2], 'dark brown': [30, 0.2, 0.2], white: [0, 0, 1] }, cu = {};
  Object.keys(C).forEach(function (k) { cu['custom ' + k] = P.customSand(C[k][0], C[k][1], C[k][2]).ui; });
  ok(de00(hexRgb(cu['custom black'].accent), hexRgb(uis.sahara.accent)) > 20, 'a black custom sand wears ' + cu['custom black'].accent + ', near sahara\'s');
  ok(de00(hexRgb(cu['custom navy'].accent), hexRgb(uis.sahara.accent)) > 20, 'a navy custom sand wears ' + cu['custom navy'].accent + ', near sahara\'s');
  bad = accentsWrong(cu).filter(function (w) { return !/ apart$/.test(w); });   // (a white and a grey may be alike: they are one sand)
  ok(!bad.length, bad.join('; '));
  // the control: 1.20.0's accents and its custom rule must fail
  var OLD = L.loadIsolated(paths.physicsParts().map(function (f) { return L.gitShow('dd713be', f); }).join('\n'), 'dd713be'), old = {};
  OLD.SAND_ORDER.forEach(function (id) { old[id] = OLD.SANDS[id].ui; });
  var ob = accentsWrong(old);
  ok(ob.some(function (w) { return /^sahara and volcanic/.test(w); }) && ob.some(function (w) { return /^sahara and lapis/.test(w); }), 'the control (1.20.0\'s accents) passed: ' + ob.join('; '));
  ok(de00(hexRgb(OLD.customSand(0, 0, 0.1).ui.accent), hexRgb(old.sahara.accent)) <= 20, 'the control (1.20.0\'s custom rule) gave a black sand no gold');
  return 'the closest two ' + pair + ' ' + min.toFixed(1) + ' apart (1.20.0: ' + ob.filter(function (w) { return / apart$/.test(w); }).join(', ') + '); custom: ' +
    Object.keys(cu).map(function (k) { return k.slice(7) + ' ' + cu[k].accent; }).join(', ');
});

test('customSand: a whole sand from one colour, a new record every call, sound for any input', function () {
  var out = [];
  CUSTOM.forEach(function (cc) {
    var rec = P.customSand(cc[0], cc[1], cc[2]), again = P.customSand(cc[0], cc[1], cc[2]), u = P.customSand.clamp(cc[0], cc[1], cc[2]);
    var r = check(rec, 'custom ' + cc[3]);
    ok(rec.id === 'custom' && rec.name === 'Custom', cc[3] + ': id ' + rec.id + ', name ' + rec.name);
    ok(again !== rec && again.sand !== rec.sand && again.light !== rec.light && js(again) === js(rec), cc[3] + ': not a new, equal record each call');
    ok(rec.sand.h === Math.round(u.h) && Math.abs(rec.sand.s - u.s) <= 0.005 && rec.sand.l === u.l, cc[3] + ': the sand ' + js([rec.sand.h, rec.sand.s, rec.sand.l]) + ' is not the clamped colour ' + js(u));
    out.push(cc[3] + ' ' + r.d.toFixed(0) + '/' + r.bulk.toFixed(2));
  });
  [[NaN, 0.5, 0.5], [720, 2, -1], [-30, -1, 9], ['x', null, undefined], [Infinity, Infinity, Infinity]].forEach(function (cc) { check(P.customSand(cc[0], cc[1], cc[2]), 'custom, odd input ' + cc.join(',')); });
  return CUSTOM.length + ' colours (tones apart / bed:room): ' + out.join(', ') + '; 5 odd inputs';
});

test('customSand over a sweep of 6336 colours: every one a sound sand', function () {
  var SS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.45, 0.6, 0.7, 1], LS = [0, 0.22, 0.26, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.59, 0.6, 0.65, 0.72, 0.8, 0.84, 1];
  var n = 0, dMin = 1e9, dMax = 0, bMin = 1e9, b2Min = 1e9, rMin = 1e9, cMax = 0, uMin = 1e9, hh;
  for (hh = 0; hh < 360; hh += 10) SS.forEach(function (ss) { LS.forEach(function (ll) {
    var r = check(P.customSand(hh, ss, ll), 'custom ' + hh + ' ' + ss + ' ' + ll); n++;
    if (r.d < dMin) dMin = r.d; if (r.d > dMax) dMax = r.d; if (r.bulk < bMin) bMin = r.bulk; if (r.bulk2 < b2Min) b2Min = r.bulk2;
    if (r.rim < rMin) rMin = r.rim; if (r.clip > cMax) cMax = r.clip; if (r.ui < uMin) uMin = r.ui;
  }); });
  return n + ' colours: tones ' + dMin.toFixed(0) + '..' + dMax.toFixed(0) + ' apart; bed:room at least ' + bMin.toFixed(2) + ', the companion\'s ' + b2Min.toFixed(2) +
    ', lit surface ' + rMin.toFixed(2) + '; at most ' + cMax + ' grains clip; ink on accent at least ' + uMin.toFixed(1);
});

test('customSand.clamp: a good colour is kept, one that is not is brought in, and its own answer is left alone', function () {
  var C = P.customSand.clamp, n = 0, h, s, l, c, c2;
  function is(inp, want) { var got = C(inp[0], inp[1], inp[2]); ok(js(got) === js(want), 'clamp(' + inp + ') is ' + js(got) + ', want ' + js(want)); }
  is([36, 0.62, 0.61], { h: 36, s: 0.62, l: 0.61 });            // sahara's own colour
  is([224, 0.62, 0.36], { h: 224, s: 0.62, l: 0.36 });          // lapis's
  is([-10, 0.5, 0.5], { h: 350, s: 0.5, l: 0.5 });              // the hue wraps
  is([0, 0, 1], { h: 40, s: 0.06, l: 0.84 });                   // white: a pale warm grey
  is([0, 0, 0], { h: 236, s: 0.06, l: 0.244 });                 // black: lifted to where volcanic is
  is([0, 1, 0.5], { h: 0, s: 0.7, l: 0.5 });                    // pure red: less saturated
  is([60, 0.7, 0.84], { h: 60, s: 0.477, l: 0.78 });            // a pale vivid yellow: darker, then duller, so it keeps its facets
  is([NaN, 'x', undefined], { h: 36, s: 0.5, l: 0.6 });
  c = C(240, 0.7, 0.22);
  ok(c.h === 240 && c.s === 0.7 && c.l > 0.34 && c.l < 0.42, 'a navy is lifted to ' + js(c) + ' (lapis is at 0.36)');
  for (h = 0; h < 360; h += 7) for (s = 0; s <= 1.001; s += 0.07) for (l = 0; l <= 1.001; l += 0.06) {
    c = C(h, s, l); c2 = C(c.h, c.s, c.l); n++;
    ok(c.h >= 0 && c.h < 360 && c.s >= 0.06 && c.s <= 0.70 && c.l >= 0.22 && c.l <= 0.84, 'clamp(' + [h, s, l] + ') is ' + js(c));
    ok(js(c) === js(c2), 'clamp(' + [h, s, l] + ') is ' + js(c) + ', and clamped again ' + js(c2));
  }
  return '9 colours as expected; over ' + n + ' colours the answer is inside the limits and clamps to itself';
});

/* ---- the renderer ---- */
/** What setLook and setTheme touch of a renderer, on a bare object. */
function bareRenderer() {
  return { look: { sand: 'sahara', material: 'sahara' }, theme: P.THEMES.sahara, layers: false, statics: 0,
           lut: new Uint32Array(48 * 256), isMica: new Uint8Array(256), hiBoost: new Uint8Array(256), emit: new Float32Array(256), aoTab: new Uint8Array(256),
           _buildLUT: P.Renderer.prototype._buildLUT, drawStatic: function () { this.statics++; },
           setLook: P.Renderer.prototype.setLook, setTheme: P.Renderer.prototype.setTheme };
}
test('setLook: one of the six over its own caps is the picture setTheme gives, as a new object each time', function () {
  SIX.forEach(function (id) {
    var r = bareRenderer(), th = P.THEMES[id], first;
    r.setLook({ sand: id, material: id });
    first = r.theme;
    ok(first !== th, id + ': setLook handed out THEMES.' + id + ' itself');
    ['sand', 'sand2', 'glint', 'light', 'glass', 'cap', 'glow', 'short', 'id'].forEach(function (k) { ok(js(first[k]) === js(th[k]), id + ': ' + k + ' is ' + js(first[k])); });
    ok(!tablesDiffer(r, lutOf(P, th, false)), id + ': the table differs from the theme\'s');
    ok(r.statics === 1 && js(r.look) === js({ sand: id, material: id }), id + ': drawStatic ' + r.statics + ' times, look ' + js(r.look));
    r.setLook({ sand: id, material: id });
    ok(r.theme !== first && js(r.theme) === js(first) && r.statics === 2, id + ': asked again, not a new equal theme');
    r.layers = true; r.setLook({});
    ok(!tablesDiffer(r, lutOf(P, th, true)), id + ': with layers on the table differs from the theme\'s');
    r.setTheme(id);
    ok(r.theme === th && js(r.look) === js({ sand: id, material: id }), id + ': setTheme does not hand out THEMES.' + id);
  });
  return SIX.join(', ');
});

test('setLook: any sand over any of the six caps; what is left out stays; `live` leaves the static layers alone', function () {
  var r = bareRenderer(), was, n = 0;
  r.setLook({ sand: 'lapis', material: 'lapis' });
  P.SAND_ORDER.forEach(function (id) {
    SIX.forEach(function (m) {
      r.setLook({ sand: id, material: m }); n++;
      ok(r.theme.cap === P.THEMES[m].cap && r.theme.sand === P.SANDS[id].sand && r.theme.sand2 === P.SANDS[id].sand2 && r.theme.light === P.SANDS[id].light &&
         r.theme.glass === P.SANDS[id].glass && r.theme.glow === P.SANDS[id].glow && r.theme.glint === P.SANDS[id].glint && r.theme.short === P.SANDS[id].name,
         id + ' over ' + m + ': ' + js(r.theme));
      ok(!tablesDiffer(r, lutOf(P, compose(P.SANDS[id], m), false)), id + ' over ' + m + ': the table is not the sand\'s');
    });
  });
  r.setLook({ sand: 'lapis', material: 'lapis' });
  r.setLook({ sand: 'garnet' });
  ok(r.theme.cap === P.THEMES.lapis.cap && js(r.look) === js({ sand: 'garnet', material: 'lapis' }), 'garnet alone: the caps did not stay lapis\'s: ' + js(r.look));
  r.setLook({ material: 'moonstone' });
  ok(r.theme.cap === P.THEMES.moonstone.cap && r.theme.sand === P.SANDS.garnet.sand, 'a material alone: the sand did not stay garnet');
  r.setLook({ sand: 'nonesuch', material: 'toString' });
  ok(r.theme.sand === P.SANDS.sahara.sand && r.theme.cap === P.THEMES.moonstone.cap && js(r.look) === js({ sand: 'sahara', material: 'moonstone' }), 'an unknown sand and material: ' + js(r.look));
  // a colour: the asked colour is kept on look, the sand is customSand's
  r.setLook({ sand: { h: 240, s: 1, l: 0.1 } });
  ok(js(r.look) === js({ sand: { h: 240, s: 1, l: 0.1 }, material: 'moonstone' }), 'a colour: look is ' + js(r.look));
  ok(js(r.theme.sand) === js(P.customSand(240, 1, 0.1).sand) && r.theme.id === 'custom' && r.theme.cap === P.THEMES.moonstone.cap, 'a colour: the theme is ' + js(r.theme.sand));
  ok(!tablesDiffer(r, lutOf(P, compose(P.customSand(240, 1, 0.1), 'moonstone'), false)), 'a colour: the table is not customSand\'s');
  // live: the table and the theme change, the static layers are left for the call that ends the drag
  was = { statics: r.statics, theme: r.theme, lut: Array.prototype.slice.call(r.lut, 24 << 8, 25 << 8).join() };
  r.setLook({ sand: { h: 120, s: 0.5, l: 0.5 } }, true);
  ok(r.statics === was.statics, 'live: the static layers were drawn again');
  ok(r.theme !== was.theme && Array.prototype.slice.call(r.lut, 24 << 8, 25 << 8).join() !== was.lut, 'live: the theme or the table did not change');
  r.setLook({ sand: { h: 120, s: 0.5, l: 0.5 } });
  ok(r.statics === was.statics + 1, 'the call that ends the drag did not draw the static layers once');
  return n + ' pairs of sand and caps; a sand alone, a material alone, unknown ids, a colour, a colour live';
});

/* ---- the frame's finishes ---- */
test('the six finishes are the six themes\' caps, named by their material, and finishOf goes back; each swatch is drawn in its caps\' tones', function () {
  var WANT = [['walnut', 'Walnut', 'sahara'], ['brass', 'Brass', 'volcanic'], ['silver', 'Silver', 'moonstone'],
              ['gold', 'Gold', 'lapis'], ['copper', 'Copper', 'rosequartz'], ['driftwood', 'Driftwood', 'seaglass']];
  ok(js(P.FINISH_ORDER) === js(WANT.map(function (w) { return w[0]; })) && js(Object.keys(P.FINISHES)) === js(P.FINISH_ORDER), 'FINISH_ORDER is ' + P.FINISH_ORDER);
  var caps = [];
  WANT.forEach(function (w) {
    var f = P.FINISHES[w[0]];
    ok(f.id === w[0] && f.name === w[1] && f.theme === w[2], w[0] + ': ' + js(f));
    ok(P.finishOf(w[2]) === w[0], 'finishOf(' + w[2] + ') is ' + P.finishOf(w[2]));
    ok(caps.indexOf(P.THEMES[f.theme].cap) < 0, w[0] + ': its caps are another finish\'s');
    caps.push(P.THEMES[f.theme].cap);
    var r = bareRenderer();
    r.setLook({ sand: 'garnet', material: f.theme });
    ok(r.theme.cap === P.THEMES[w[2]].cap && r.theme.sand === P.SANDS.garnet.sand, w[0] + ': Red Garnet over it does not wear its caps');
  });
  ok(P.finishOf('garnet') === null && P.finishOf('toString') === null && P.finishOf(undefined) === null, 'finishOf a sand that is no theme is not null');
  // Tune's swatch of each finish is drawn in its caps' own three tones (styles.css .cap-<id>)
  var css = fs.readFileSync(path.join(paths.ROOT, 'styles.css'), 'utf8');
  WANT.forEach(function (w) {
    var c = P.THEMES[w[2]].cap, m = new RegExp('\\.cap-' + w[0] + '\\s*\\{\\s*background:\\s*linear-gradient\\(180deg, rgb\\(([\\d, ]+)\\), rgb\\(([\\d, ]+)\\) 55%, rgb\\(([\\d, ]+)\\)\\)').exec(css);
    ok(m, w[0] + ': no swatch .cap-' + w[0] + ' in styles.css');
    ok(js([m[1], m[2], m[3]]) === js([c.hi, c.mid, c.lo].map(function (x) { return x.join(', '); })), w[0] + ': the swatch is ' + m.slice(1, 4).join(' / ') + ', the caps ' + js([c.hi, c.mid, c.lo]));
  });
  return WANT.map(function (w) { return w[1] + ' (' + w[2] + ')'; }).join(', ');
});

test('the Sim does not know of sands or looks', function () {
  var src = L.physicsSource(), at = src.indexOf('*  Themes'), hit;
  ok(at > 0, 'the Themes section was not found in the pieces');
  hit = /\b(SANDS|SAND_ORDER|customSand|setLook|THEMES)\b|\.look\b|\.theme\b/.exec(src.slice(0, at));
  ok(!hit, 'the part of the pieces before the themes (the glass\'s shapes and the Sim) names ' + (hit && hit[0]));
  var sim = new P.Sim({ scale: 0.6, seed: 5 });
  ok(!('look' in sim) && !('theme' in sim) && !('sand' in sim), 'a Sim has a look, a theme or a sand');
  return 'nothing before the Themes section (' + src.slice(0, at).split('\n').length + ' lines) names them';
});

console.log(failures ? 'look-unit: ' + failures + ' of ' + count + ' cases FAILED' : 'look-unit: all ' + count + ' cases passed');
process.exit(failures ? 1 : 0);
