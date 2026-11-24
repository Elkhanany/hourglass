/*
 * The kept files of the three settings checks, in tools/test/base/. Development only, not
 * shipped.
 *
 *   app-settings-section.txt   app.js's "Settings (persisted)" section of BASE (release 1.11.0,
 *                              the last app.js with a Settings section of its own), byte for
 *                              byte: the old loader the store is compared with (settings-unit).
 *                              It is the app before the store, and stays so: a setting added to
 *                              the store is not added to it, and it is not made again
 *   boot-trace.json            what the boot reads, saves and calls on the Sim, the Renderer, the
 *                              sound engine and the sensors, for six saved states (app-boot-trace)
 *   tune-trace.json            what every control of Tune saves, calls and buzzes, in order
 *                              (app-tune-trace)
 *
 * The two traces are a reviewed record, not a recording of BASE: each holds the tree named in
 * its "from", and the suites hold the app to it. They were first made from BASE (and before it
 * from release 1.10.0), then made again (--write, from the tree just run) whenever a setting or
 * a control was added on purpose, each time in a commit of its own that says what changed and
 * nothing else: the engine's build stamp 6 (1.11.0), tuneTab and Tune's tabs (1.13.0), the
 * sands, the colour well and the finishes (1.14.0), the shapes and the build stamp 7 (1.15.0).
 * That chain of commits is what ties them to the app before the store. An older commit cannot
 * give the same trace, so --base <commit> (or HOURGLASS_BASE) only reports, for whoever makes a
 * trace again: that commit's tree is run too, and what differs from the kept trace is printed;
 * it passes and fails nothing. (settings-unit's --base is its own: the kept section must be that
 * commit's, and with --write it is written from it.)
 *
 *   var base = require('./lib/base.js');
 *   base.BASE                    the commit the kept section is from (and the traces first were)
 *   base.asked()                 the commit named by --base or HOURGLASS_BASE, else null
 *   base.writing()               whether --write was given
 *   base.here(root)              what a trace written from the tree just run says it is from
 *   base.SECTION, .BOOT, .TUNE   the kept files' paths
 *   base.section(src, title)     a banner's section of app.js: from the line that opens its
 *                                banner to the line before the next banner
 *   base.show(rev, file)         a file at a commit
 *   base.tree(rev)               the whole tree of a commit, in a temporary folder
 */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
var paths = require('./paths.js');

var BASE = '8a546eea183a61a95970c1b62a77f42360180575';
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
/** Where a trace written from the tree just run is from: the checkout's commit, and whether the tree has more than it. */
function here(root) {
  if (path.resolve(root) !== path.resolve(paths.ROOT)) return 'a tree given with --root';
  try {
    var dirty = git(['status', '--porcelain', '--', '.', ':(exclude)tools/test/base']).trim() !== '';
    return git(['rev-parse', 'HEAD']).trim() + (dirty ? ', with the changes not yet committed' : '');
  } catch (e) {
    return 'a tree that is no git checkout';
  }
}

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
  asked: asked, writing: writing, here: here, section: section, show: show, tree: tree, git: git
};
