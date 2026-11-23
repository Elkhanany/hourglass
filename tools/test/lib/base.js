/*
 * The app as it was before the settings store (step A3 of the reorganisation), for the three
 * checks that the store changed nothing. Development only, not shipped.
 *
 * What the app did then is kept as three files in tools/test/base/, so that the default run
 * needs no commit of the past:
 *   app-settings-section.txt   app.js's "Settings (persisted)" section, byte for byte: the
 *                              loader the store is compared with (settings-unit)
 *   boot-trace.json            what the boot called and wrote on the Sim, the Renderer, the
 *                              sound engine and storage, for five saved states (app-boot-trace)
 *   tune-trace.json            what every control of Tune saved, called and buzzed, in order
 *                              (app-tune-trace); the new Tune is compared with this file too
 * Each suite, run with --base <commit> (or HOURGLASS_BASE=<commit>), makes its file again from
 * that commit and fails if it differs from the one kept; with --write as well, it writes it.
 * They were made from BASE.
 *
 *   var base = require('./lib/base.js');
 *   base.BASE                    the commit the kept files were made from
 *   base.asked()                 the commit named by --base or HOURGLASS_BASE, else null
 *   base.writing()               whether --write was given
 *   base.SECTION, .BOOT, .TUNE   the kept files' paths
 *   base.section(src, title)     a banner's section of app.js: from the line that opens its
 *                                banner to the line before the next banner
 *   base.show(rev, file)         a file at a commit
 *   base.tree(rev)               the whole tree of a commit, in a temporary folder
 */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
var paths = require('./paths.js');

var BASE = '5b9bb5ab95752ff2f5fd13e2080b7f9543102b1e';
var DIR = path.join(paths.ROOT, 'tools', 'test', 'base');

function git(args) {
  return cp.execFileSync('git', args, { cwd: paths.ROOT, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}
function show(rev, file) { return git(['show', rev + ':' + file]); }

function flag(name) {
  var i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] || '') : null;
}
function asked() { return flag('--base') || process.env.HOURGLASS_BASE || null; }
function writing() { return process.argv.indexOf('--write') > 0; }

/**
 * The section of app.js under the banner titled `title`: from the line that opens the banner
 * to the line before the next banner opens, as text. Found by the banners, not by line
 * numbers; a title that is not there, or is there twice, throws.
 */
function section(src, title) {
  var lines = src.split('\n'), open = /^\s*\/\* =+\s*$/, at = [];
  lines.forEach(function (l, i) {
    if (/^\s*\*\s+/.test(l) && l.replace(/^\s*\*\s+/, '').trim() === title && i > 0 && open.test(lines[i - 1])) at.push(i - 1);
  });
  if (at.length !== 1) throw new Error('base: ' + (at.length ? at.length + ' banners' : 'no banner') + ' titled "' + title + '"');
  var end = at[0] + 2;
  while (end < lines.length && !open.test(lines[end])) end++;
  if (end >= lines.length) throw new Error('base: no banner after "' + title + '"');
  return lines.slice(at[0], end).join('\n') + '\n';
}

var made = [];
/** The tree of a commit, from git, in a temporary folder (removed when the process ends). */
function tree(rev) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hourglass-base-')), tar = dir + '.tar';
  git(['archive', '--format=tar', '-o', tar, rev]);
  cp.execFileSync('tar', ['-xf', tar, '-C', dir]);
  fs.rmSync(tar);
  made.push(dir);
  return dir;
}
process.on('exit', function () {
  made.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
});

module.exports = {
  BASE: BASE, DIR: DIR,
  SECTION: path.join(DIR, 'app-settings-section.txt'),
  BOOT: path.join(DIR, 'boot-trace.json'),
  TUNE: path.join(DIR, 'tune-trace.json'),
  asked: asked, writing: writing, section: section, show: show, tree: tree, git: git
};
