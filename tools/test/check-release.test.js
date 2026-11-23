#!/usr/bin/env node
/*
 * The release check, in Node, in a moment (the check group: node tools/test/run-all.js check-).
 *
 * An installed copy of the app updates only when sw.js's VERSION changes. So, the rule for every
 * release: when a shipped file changes (sw.js, or a path of its SHELL; './' is index.html),
 * VERSION goes up. This compares the working tree (committed or not, new files included) with
 * two bases: the merge-base of HEAD and origin/main (what this branch changed) and origin/main
 * itself (a release that landed meanwhile takes its number). If this branch changed a shipped
 * file, VERSION must be greater than the VERSION of both, as semver (1.10.0 is after 1.9.0).
 * index.html's <meta name="hourglass-version" content="X.Y.Z">, the page's own release (Tune's
 * last line reads it), must be there and equal VERSION.
 *
 * HOURGLASS_MAIN=<ref> compares with another ref than origin/main. Without that ref (a clone
 * with no remote, or a shallow one) the check fails and says how to fetch it.
 * Each rule has its control: the same rule on a made-up change that breaks it must fail.
 *
 *   node tools/test/check-release.test.js
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
var paths = require('./lib/paths.js');
var ROOT = paths.ROOT, MAIN = process.env.HOURGLASS_MAIN || 'origin/main';
var count = 0, failures = 0;
function check(ok, what, detail) {
  count++; if (!ok) failures++;
  console.log((ok ? 'ok    ' : 'FAIL  ') + what + (detail ? '  — ' + detail : ''));
}
function git(args) {
  return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** sw.js's VERSION and SHELL, from its text. */
function worker(src) {
  var ctx = { self: { addEventListener: function () {}, location: { origin: 'http://x' } }, URL: URL };
  vm.runInNewContext(src, ctx);
  return { version: ctx.VERSION, shell: ctx.SHELL || [] };
}
/** 'hourglass-v1.10.0' or '1.10.0' → [1, 10, 0]; null if it is not one. */
function semver(v) {
  var m = /^(?:hourglass-v)?(\d+)\.(\d+)\.(\d+)$/.exec(v || '');
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmp(a, b) { for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }
function meta(html) {
  var m = /<meta\s+name=["']hourglass-version["']\s+content=["']([^"']+)["']/i.exec(html || '');
  return m ? m[1] : null;
}
function shipped(shell) {
  var out = { 'sw.js': true };
  shell.forEach(function (u) { out[u === './' ? 'index.html' : u.replace(/^\.\//, '')] = true; });
  return out;
}

/**
 * The rule. now: { version, shell, meta }; bases: [{ name, version, shell, meta, changed: [files
 * changed from it] }]; the first base is the merge-base (what this branch changed).
 * Returns the problems: [] when the release is in order.
 */
function releaseProblems(now, bases) {
  var out = [], v = semver(now.version);
  if (!v) return ['sw.js VERSION "' + now.version + '" is not hourglass-vX.Y.Z'];
  var ship = shipped(now.shell);
  bases.forEach(function (b) { b.shell.forEach(function (u) { ship[u === './' ? 'index.html' : u.replace(/^\.\//, '')] = true; }); });
  var mine = bases[0].changed.filter(function (f) { return ship[f]; });
  if (mine.length) {
    bases.forEach(function (b) {
      var bv = semver(b.version);
      if (bv && cmp(v, bv) <= 0) {
        out.push('shipped files changed (' + mine.slice(0, 4).join(', ') + (mine.length > 4 ? ', ...' : '') + ') but VERSION ' +
                 now.version + ' is not after ' + b.name + '\'s ' + b.version);
      }
    });
  }
  var nowMeta = now.meta;
  if (nowMeta === null) {
    out.push('index.html has no hourglass-version meta (<meta name="hourglass-version" content="' + now.version.replace(/^hourglass-v/, '') + '">)');
  } else if (nowMeta !== now.version.replace(/^hourglass-v/, '')) {
    out.push('index.html says hourglass-version ' + nowMeta + ', sw.js says ' + now.version);
  }
  return out;
}

/* ---- the real tree against its bases ---- */
var now = worker(fs.readFileSync(paths.SW, 'utf8'));
now.meta = meta(fs.readFileSync(paths.INDEX, 'utf8'));
var bases = [], why = null;
try {
  git(['rev-parse', '--verify', '--quiet', MAIN + '^{commit}']);
  var mb = git(['merge-base', 'HEAD', MAIN]).trim();
  var untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  [{ name: 'the merge-base (' + mb.slice(0, 7) + ')', ref: mb }, { name: MAIN, ref: MAIN }].forEach(function (b) {
    var w = worker(git(['show', b.ref + ':sw.js']));
    var html = '';
    try { html = git(['show', b.ref + ':index.html']); } catch (e) {}
    bases.push({ name: b.name, version: w.version, shell: w.shell, meta: meta(html),
                 changed: git(['diff', '--name-only', b.ref, '--']).split('\n').filter(Boolean).concat(untracked) });
  });
} catch (e) {
  why = String(e.stderr || e.message || e).trim().split('\n')[0];
}
if (why !== null) {
  check(false, 'the release check needs ' + MAIN + ' (git fetch origin main; in a shallow clone, git fetch --unshallow)', why);
} else {
  var p = releaseProblems(now, bases), mine = bases[0].changed.filter(function (f) { return shipped(now.shell)[f]; });
  check(p.length === 0, 'the release is in order: VERSION ' + now.version + '; ' + bases.map(function (b) { return b.name + ' ' + b.version; }).join(', ') +
    '; shipped files changed on this branch: ' + (mine.length ? mine.length + ' (' + mine.slice(0, 5).join(', ') + (mine.length > 5 ? ', ...' : '') + ')' : 'none') +
    '; index.html\'s hourglass-version ' + now.meta, p.join(' | '));
}

/* ---- controls: the rule on made-up trees ---- */
// Each tree's meta is its VERSION's number unless the case gives another (null: no meta). A case
// that must fail must fail with its own one problem, named by `why`; one that must pass has none.
var SH = ['./', './index.html', './app.js', './realsand/boot.mjs'];
function T(version, metaV) { return { version: version, shell: SH, meta: metaV === undefined ? version.replace(/^hourglass-v/, '') : metaV }; }
function B(name, version, changed) { return { name: name, version: version, shell: SH, changed: changed, meta: version.replace(/^hourglass-v/, '') }; }
var cases = [
  ['app.js changed, VERSION the same as the merge-base\'s', /app\.js.*not after (?:mb|main)/, T('hourglass-v1.9.0'), [B('mb', 'hourglass-v1.9.0', ['app.js']), B('main', 'hourglass-v1.9.0', [])], 2],
  ['index.html changed (as ./), VERSION the same', /index\.html.*not after (?:mb|main)/, T('hourglass-v1.9.0'), [B('mb', 'hourglass-v1.9.0', ['index.html']), B('main', 'hourglass-v1.9.0', ['index.html'])], 2],
  ['an engine module changed, VERSION the same', /realsand\/boot\.mjs.*not after (?:mb|main)/, T('hourglass-v1.9.0'), [B('mb', 'hourglass-v1.9.0', ['realsand/boot.mjs']), B('main', 'hourglass-v1.9.0', [])], 2],
  ['sw.js changed, VERSION lower', /sw\.js.*1\.8\.9 is not after (?:mb|main)/, T('hourglass-v1.8.9'), [B('mb', 'hourglass-v1.9.0', ['sw.js']), B('main', 'hourglass-v1.9.0', ['sw.js'])], 2],
  ['app.js changed and VERSION up, but origin/main took that number meanwhile', /not after main's hourglass-v1\.10\.0/, T('hourglass-v1.10.0'), [B('mb', 'hourglass-v1.9.0', ['app.js', 'sw.js']), B('main', 'hourglass-v1.10.0', ['app.js'])], 1],
  ['VERSION up, but index.html\'s meta says another release', /says hourglass-version 1\.9\.0, sw\.js says hourglass-v1\.10\.0/, T('hourglass-v1.10.0', '1.9.0'), [B('mb', 'hourglass-v1.9.0', ['app.js', 'sw.js']), B('main', 'hourglass-v1.9.0', ['app.js', 'sw.js'])], 1],
  ['index.html without the meta, on a release', /no hourglass-version meta/, T('hourglass-v1.10.0', null), [B('mb', 'hourglass-v1.9.0', ['index.html', 'sw.js']), B('main', 'hourglass-v1.9.0', ['index.html', 'sw.js'])], 1],
  ['index.html without the meta, and nothing shipped changed', /no hourglass-version meta/, T('hourglass-v1.9.0', null), [B('mb', 'hourglass-v1.9.0', ['README.md']), B('main', 'hourglass-v1.9.0', [])], 1],
  ['a VERSION that is not hourglass-vX.Y.Z', /is not hourglass-vX\.Y\.Z/, T('hourglass-1.10', '1.10.0'), [B('mb', 'hourglass-v1.9.0', ['sw.js']), B('main', 'hourglass-v1.9.0', ['sw.js'])], 1],
  ['app.js changed, VERSION 1.9.0 to 1.10.0 (after it as semver, not as text), meta equal', null, T('hourglass-v1.10.0'), [B('mb', 'hourglass-v1.9.0', ['app.js', 'sw.js', 'index.html']), B('main', 'hourglass-v1.9.0', ['app.js', 'sw.js', 'index.html'])], 0],
  ['only tests, docs and the lab changed, VERSION the same', null, T('hourglass-v1.9.0'), [B('mb', 'hourglass-v1.9.0', ['tools/test/run-all.js', 'docs/testing.md', 'lab/sand/main.mjs', 'README.md']), B('main', 'hourglass-v1.9.0', ['README.md'])], 0],
  ['nothing of this branch shipped, though origin/main has moved on to a new release', null, T('hourglass-v1.9.0'), [B('mb', 'hourglass-v1.9.0', ['README.md']), B('main', 'hourglass-v1.10.0', ['app.js', 'sw.js'])], 0]
];
var wrong = cases.filter(function (c) {
  var got = releaseProblems(c[2], c[3]);
  return got.length !== c[4] || (c[1] && !got.every(function (g) { return c[1].test(g); }));
}).map(function (c) { return c[0] + ' → ' + (releaseProblems(c[2], c[3]).join(' / ') || 'no problem'); });
check(wrong.length === 0, 'the rule on ' + cases.length + ' made-up trees (control): ' + cases.filter(function (c) { return c[1]; }).length + ' must fail, each with its own problem only, ' +
  cases.filter(function (c) { return !c[1]; }).length + ' must pass', wrong.length ? 'wrong: ' + wrong.join(' | ') : '');

console.log('check-release: ' + (count - failures) + '/' + count + ' passed');
if (failures) process.exitCode = 1;
