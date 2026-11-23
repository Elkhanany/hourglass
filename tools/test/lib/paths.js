/*
 * Where the app's files are, for the tests (development only, not shipped).
 *
 * One source for paths: index.html for the page's scripts, this file for
 * everything else. A test never names physics.js (or any other script the
 * page loads) itself: it asks for the scripts index.html loads, so the same
 * test runs when a file moves or is cut into pieces.
 *
 *   var paths = require('./lib/paths.js');
 *   paths.ROOT, .INDEX, .SW, .MANIFEST, .APP     absolute paths in this checkout
 *   paths.classicScripts([root])   the classic scripts index.html loads, in document order,
 *                                  relative to the root ('physics.js', ..., 'app.js'); a src
 *                                  without quotes is read too
 *   paths.attr(attrs, name)        one attribute of a tag's text, quoted or not
 *   paths.script(name, [root])     the one of them whose file name is `name`
 *                                  ('motion.js' → 'motion.js', or wherever it lives)
 *   paths.physicsParts([root])     the classic scripts that make HourglassPhysics
 *                                  (today ['physics.js'])
 *   paths.physicsSource([root])    their texts joined, in order: one program, the same
 *                                  as the page's script tags run one after another
 *   paths.piece(f, [root])         the text of one file of the tree
 *
 * `root` defaults to this checkout; the browser harness passes the tree it
 * serves (--root). A script tag whose file is not in the tree throws, naming it.
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..', '..');

/** The value of one attribute in a tag's text, quoted or not (src=./a.js is valid HTML); null without it. */
function attr(attrs, name) {
  var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(attrs);
  return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
}

/** index.html's script tags without type="module", their src in document order ('./' dropped). */
function classicScripts(root) {
  var html = fs.readFileSync(path.join(root || ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  var out = [], re = /<script\b([^>]*)>/gi, m;
  while ((m = re.exec(html))) {
    var src = attr(m[1], 'src'), type = attr(m[1], 'type');
    if (!src) continue;
    if (type && !/^(text|application)\/(java|ecma)script$/i.test(type)) continue;
    out.push(src.replace(/^\.\//, '').split(/[?#]/)[0]);
  }
  return out;
}

/** The text of one file of the tree (relative path); a missing file throws, naming it. */
function piece(f, root) {
  var p = path.join(root || ROOT, f);
  if (!fs.existsSync(p)) throw new Error('paths: ' + f + ' is not in ' + (root || ROOT));
  return fs.readFileSync(p, 'utf8');
}

/** The classic script index.html loads whose file name is `name`. */
function script(name, root) {
  var hit = classicScripts(root).filter(function (f) { return path.posix.basename(f) === name; });
  if (hit.length !== 1) {
    throw new Error('paths: index.html loads ' + (hit.length ? hit.length + ' scripts' : 'no script') + ' named ' + name);
  }
  return hit[0];
}

/** The classic scripts that make HourglassPhysics: those that assign it. */
function physicsParts(root) {
  var parts = classicScripts(root).filter(function (f) {
    return /\bHourglassPhysics\s*=(?!=)/.test(piece(f, root));
  });
  if (!parts.length) throw new Error('paths: no script index.html loads defines HourglassPhysics');
  return parts;
}

function physicsSource(root) {
  return physicsParts(root).map(function (f) { return piece(f, root); }).join('\n');
}

module.exports = {
  ROOT: ROOT,
  INDEX: path.join(ROOT, 'index.html'),
  SW: path.join(ROOT, 'sw.js'),
  MANIFEST: path.join(ROOT, 'manifest.json'),
  APP: path.join(ROOT, 'app.js'),
  attr: attr,
  classicScripts: classicScripts,
  script: script,
  physicsParts: physicsParts,
  physicsSource: physicsSource,
  piece: piece
};
