#!/usr/bin/env node
/*
 * The upgrade suite (the snapshot worker, release 1.10.0): what an installed copy of the app
 * does when a release comes,
 * in Chromium with the service worker on, the app served from a scratch copy that is swapped
 * under the same address, and "offline" meaning the server stopped and the page offline.
 *
 *  1. UPGRADE: origin/main (git archive) is served and installed; then this tree in its place:
 *     two launches with a connection, then one offline. Offline: no page or console error, no
 *     failed or 504 response, Hourglass.sim, one cache (this tree's VERSION), and Tune's last
 *     line "Version X.Y.Z" with nothing after the number. Then a newer release is served and
 *     installed while the page is open: the line says "update ... ready: close and reopen", and
 *     the next launch runs the newer release, under one cache.
 *  2. FAILED INSTALL: this tree installed, a next release whose SHELL names a file that is not
 *     there (its scripts, page and style sheet marked) is served: its install fails and leaves
 *     no cache of its own, and a launch with a connection, then one offline, run the installed
 *     release whole (none of the next release's marks).
 *  3. HOLE: one script taken out of the cache. Offline the page says "Hourglass is updating.
 *     Open it again with a connection." and builds nothing, with no page error; a launch with a
 *     connection fills the cache again from the same release, and offline after it the app
 *     starts. A hole while the server has another release is not filled from it.
 *  4. LAB: a lab page that meets an engine of another build leaves the app's cache whole, and
 *     the app then starts offline.
 * The controls, each a check above that must fail: a page with no worker (the version line says
 * more than the number); the offline launch with the hole (a 504, no Hourglass.sim); the failed
 * install under 13a9772's worker, v1.9.0, a release before the snapshot worker (an empty cache of the
 * failed release left behind, and the next release's files on the page, fetched into the
 * installed copy in the background); 13a9772's lab page (it dropped the engine from the app's
 * caches).
 *
 * HOURGLASS_MAIN=<ref> installs another ref than origin/main first. Without that ref, or without
 * 13a9772 (a shallow clone), the suite fails and says how to fetch it.
 *
 *   node tools/test/app-upgrade.test.js [--port <n>]       (default: $PORT, else 8711)
 */
'use strict';
var fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), cp = require('child_process');
var H = require('./stubs/harness.js');
var paths = require('./lib/paths.js');
var staticServer = require('./lib/static-server.js');

var ROOT = paths.ROOT, MAIN = process.env.HOURGLASS_MAIN || 'origin/main';
var BEFORE_R1 = '13a9772';                 // v1.9.0: the controls' worker and lab
var PORT = (function () {
  var i = process.argv.indexOf('--port');
  return i > 0 ? +process.argv[i + 1] : (+process.env.PORT || 8711);
})();
var ORIGIN = 'http://127.0.0.1:' + PORT, HOME = ORIGIN + '/';
var UPDATING = 'Hourglass is updating. Open it again with a connection.';
var sleep = H.sleep;

/* ---- the trees ---------------------------------------------------------------------------- */
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hourglass-upgrade-'));
var LINK = path.join(TMP, 'served');      // what the server serves: a link to one of the trees

function git(args) {
  return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}
/** The tree of a commit, from git, in a folder of its own. */
function archive(ref, name) {
  var dir = path.join(TMP, name), tar = path.join(TMP, name + '.tar');
  fs.mkdirSync(dir);
  git(['archive', '--format=tar', '-o', tar, ref]);
  cp.execFileSync('tar', ['-xf', tar, '-C', dir]);
  fs.rmSync(tar);
  return dir;
}
/** A copy of a tree, without what the app never serves (git, packages, the tests). */
function copyTree(src, name) {
  var dir = path.join(TMP, name);
  fs.cpSync(src, dir, { recursive: true, filter: function (f) {
    var rel = path.relative(src, f);
    return !/^(\.git|node_modules|tools)(\/|$)/.test(rel);
  } });
  return dir;
}
function read(dir, f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }
function write(dir, f, text) { fs.writeFileSync(path.join(dir, f), text); }
/** sw.js's VERSION and SHELL, read by running it with a stand-in for its scope. */
function worker(dir) {
  var ctx = { self: { addEventListener: function () {}, location: { origin: 'http://x' } }, URL: URL };
  vm.runInNewContext(read(dir, 'sw.js'), ctx);
  return { version: ctx.VERSION, shell: ctx.SHELL };
}
/** index.html's own release (its hourglass-version), or null. */
function pageRelease(dir) {
  var m = /<meta\s+name=["']hourglass-version["']\s+content=["']([^"']+)["']/i.exec(read(dir, 'index.html'));
  return m ? m[1] : null;
}
function nextVersion(v) {
  var m = /^hourglass-v(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error('sw.js VERSION "' + v + '" is not hourglass-vX.Y.Z');
  return 'hourglass-v' + m[1] + '.' + m[2] + '.' + (+m[3] + 1);
}
/**
 * The next release of a tree: VERSION one patch up (and the page's own release with it), every
 * script index.html loads, the page and the style sheet marked so that a page that runs any of
 * them shows it; `bad`: its SHELL names a file that is not there, so its install fails.
 */
function nextRelease(src, name, bad) {
  var dir = copyTree(src, name), v = nextVersion(worker(src).version), sw = read(dir, 'sw.js');
  sw = sw.replace(/var VERSION = '[^']+'/, "var VERSION = '" + v + "'");
  if (bad) sw = sw.replace(/var SHELL = \[/, "var SHELL = [\n  './not-in-this-release.js',");
  write(dir, 'sw.js', sw);
  paths.classicScripts(dir).forEach(function (f) {
    fs.appendFileSync(path.join(dir, f), '\n;(window.__upgradeNext = window.__upgradeNext || []).push(' + JSON.stringify(f) + ');\n');
  });
  write(dir, 'index.html', read(dir, 'index.html')
    .replace(/(<meta\s+name=["']hourglass-version["']\s+content=["'])[^"']+/i, '$1' + v.replace(/^hourglass-v/, ''))
    .replace(/<head>/i, '<head>\n  <meta name="upgrade-test" content="next">'));
  fs.appendFileSync(path.join(dir, 'styles.css'), '\n:root { --upgrade-test: next; }\n');
  return { dir: dir, version: v };
}
/** A copy of a tree whose lab page was written for another engine build than the engine's. */
function labOtherBuild(dir) {
  var f = path.join('lab', 'sand', 'main.mjs');
  write(dir, f, read(dir, f).replace(/const BUILD_EXPECTED = '[^']+'/, "const BUILD_EXPECTED = 'upgrade-test-C'"));
  return dir;
}

/* ---- the server --------------------------------------------------------------------------- */
var server = null;
function serve(dir) {
  try { fs.unlinkSync(LINK); } catch (e) {}
  fs.symlinkSync(dir, LINK);
}
function up() {
  return new Promise(function (res, rej) {
    if (server) return res();
    var s = staticServer.start(PORT, LINK, function () { server = s; res(); });
    s.on('error', rej);
  });
}
function down() {
  return new Promise(function (res) {
    if (!server) return res();
    var s = server;
    server = null;
    s.close(function () { res(); });
    if (s.closeAllConnections) s.closeAllConnections();
    setTimeout(res, 1500);
  });
}
async function online(ctx) { await up(); await ctx.setOffline(false); }
async function offline(ctx) { await ctx.setOffline(true); await down(); }

/* ---- the page ----------------------------------------------------------------------------- */
async function until(fn, ms, every) {
  var end = Date.now() + ms, last;
  for (;;) {
    last = await fn();
    if (last.ok || Date.now() > end) return last;
    await sleep(every || 250);
  }
}
function short(u) { return u.indexOf(ORIGIN) === 0 ? u.slice(ORIGIN.length) : u; }

/** A launch: the context's pages closed, the app opened afresh, until it is built or says it is updating. */
async function launch(ctx) {
  var old = ctx.pages();
  for (var i = 0; i < old.length; i++) await old[i].close();
  var page = await ctx.newPage(), L = { page: page, errors: [], bad: [], app: null };
  page.on('pageerror', function (e) { L.errors.push('pageerror: ' + String(e && e.message).split('\n')[0]); });
  page.on('console', function (m) { if (m.type() === 'error') L.errors.push('console: ' + m.text().slice(0, 160)); });
  page.on('response', function (r) { if (r.url().indexOf(ORIGIN) === 0 && r.status() >= 400) L.bad.push(r.status() + ' ' + short(r.url())); });
  page.on('requestfailed', function (q) { if (q.url().indexOf(ORIGIN) === 0) L.bad.push('failed ' + short(q.url())); });
  try {
    await page.goto(HOME, { timeout: 20000 });
  } catch (e) {
    L.errors.push('goto: ' + String(e && e.message).split('\n')[0]);
    return L;
  }
  var r = await until(function () {
    return page.evaluate(function () {
      var u = document.getElementById('updating');
      return { ok: !!(window.Hourglass && window.Hourglass.sim) || !!u, sim: !!(window.Hourglass && window.Hourglass.sim), updating: u ? u.textContent : null };
    }).catch(function (e) { return { ok: false, error: String(e && e.message) }; });
  }, 20000);
  await sleep(300);                         // (a moment for late requests and errors)
  L.app = r;
  return L;
}
/** What is wrong with a launch that should have started the app: [] when nothing. */
function problems(L) {
  var out = [];
  if (L.errors.length) out.push(L.errors.slice(0, 2).join(' | '));
  if (L.bad.length) out.push('responses: ' + L.bad.slice(0, 4).join(', '));
  if (!L.app || !L.app.sim) out.push('no Hourglass.sim' + (L.app && L.app.updating ? ' (the page says: ' + L.app.updating + ')' : ''));
  return out;
}
/** The worker's registration and the caches, as the page sees them. */
function state(page) {
  return page.evaluate(function () {
    var sw = navigator.serviceWorker;
    return sw.getRegistration().then(function (reg) {
      return caches.keys().then(function (keys) {
        return { keys: keys, ctl: !!sw.controller, active: !!(reg && reg.active), installing: !!(reg && reg.installing), waiting: !!(reg && reg.waiting) };
      });
    });
  });
}
/** Ask for an update now, and wait until no worker is installing or waiting. */
async function update(page) {
  await page.evaluate(function () {
    return navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).catch(function () {});
  }).catch(function () {});
  var calm = 0;
  return until(async function () {
    var s = await state(page);
    calm = !s.installing && !s.waiting ? calm + 1 : 0;
    s.ok = calm >= 3;
    return s;
  }, 20000, 300);
}
/** Launch until `version` is installed, alone, and in control (the first launch installs it), then launch once more under it. */
async function install(ctx, version) {
  var L = await launch(ctx);
  var s = await until(async function () {
    var st = await state(L.page);
    st.ok = st.ctl && st.keys.length === 1 && st.keys[0] === version && !st.installing && !st.waiting;
    return st;
  }, 20000);
  L = await launch(ctx);
  L.installed = s;
  return L;
}
/** The worker's answer to { type: 'version' } (the version line's question). */
function ask(page) {
  return page.evaluate(function () {
    return new Promise(function (res) {
      var c = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!c) return res('no controller');
      var ch = new MessageChannel(), t = setTimeout(function () { res('no answer'); }, 1000);
      ch.port1.onmessage = function (e) { clearTimeout(t); res(e.data && e.data.version); };
      c.postMessage({ type: 'version' }, [ch.port2]);
    });
  });
}
/** Tune's version line (once it has its answer): { text, state }, or null without one. */
async function versionLine(page) {
  var end = Date.now() + 3000, v;
  for (;;) {
    v = await page.evaluate(function () {
      var l = document.getElementById('version-line');
      return l ? { text: l.textContent, state: l.getAttribute('data-state') } : null;
    });
    if (!v || v.state !== 'asking' || Date.now() > end) return v;
    await sleep(100);
  }
}
/** Which release's files the page runs: the page's own release, and the next release's marks it shows. */
function marks(page) {
  return page.evaluate(function () {
    var m = document.querySelector('meta[name="hourglass-version"]');
    return {
      release: m ? m.getAttribute('content') : null,
      scripts: (window.__upgradeNext || []).slice(),
      page: !!document.querySelector('meta[name="upgrade-test"]'),
      css: getComputedStyle(document.documentElement).getPropertyValue('--upgrade-test').trim()
    };
  });
}
/** Whether the page runs the release `release` whole: none of the next release's files. */
function whole(m, release) {
  return m.scripts.length === 0 && !m.page && !m.css && (release === undefined || m.release === release);
}
/** The entries of the cache `name` (pathnames). */
function cached(page, name) {
  return page.evaluate(function (name) {
    return caches.has(name).then(function (has) {
      if (!has) return [];
      return caches.open(name).then(function (c) { return c.keys(); }).then(function (r) { return r.map(function (q) { return new URL(q.url).pathname; }); });
    });
  }, name);
}
function lineSaysOnly(line, release) {
  return !!line && line.state === 'same' && line.text === 'Version ' + release;
}
function newContext(browser, sw) {
  return browser.newContext({ serviceWorkers: sw === false ? 'block' : 'allow', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
}

/* ---- 1. UPGRADE --------------------------------------------------------------------------- */
async function caseUpgrade(s, browser, T) {
  var ctx = await newContext(browser);
  try {
    serve(T.main);
    await online(ctx);
    var L = await install(ctx, T.mainWorker.version);
    s.check('UPGRADE: ' + MAIN + ' (' + T.mainWorker.version + ') is installed and runs', L.installed.ok && problems(L).length === 0,
            JSON.stringify(L.installed) + ' ' + problems(L).join('; '));
    // this tree in its place: two launches with a connection, then one offline
    serve(T.tree);
    L = await launch(ctx);
    await update(L.page);
    L = await launch(ctx);
    var p2 = problems(L);
    await offline(ctx);
    L = await launch(ctx);
    var st = await state(L.page), line = await versionLine(L.page), said = await ask(L.page);
    s.check('UPGRADE: offline, after two launches with a connection: the app starts (Hourglass.sim), no page or console error, no failed or 504 response',
            problems(L).length === 0 && p2.length === 0, problems(L).concat(p2).join('; '));
    s.check('UPGRADE: ... one cache, this tree\'s (' + T.worker.version + '), and the worker answers it', JSON.stringify(st.keys) === JSON.stringify([T.worker.version]) && said === T.worker.version,
            JSON.stringify(st.keys) + ', answer ' + said);
    s.check('UPGRADE: ... and Tune\'s last line reads "Version ' + T.release + '", nothing after the number', lineSaysOnly(line, T.release), JSON.stringify(line));
    // a newer release, installed while the page is open: the line says so; the next launch runs it
    await online(ctx);
    serve(T.next.dir);
    await update(L.page);
    var lineNow = await until(async function () { var v = (await versionLine(L.page)) || {}; v.ok = v.state === 'update'; return v; }, 5000);
    var nextRel = T.next.version.replace(/^hourglass-v/, '');
    s.check('UPGRADE: a newer release installed while the page is open: the line reads "Version ' + T.release + ' · update ' + nextRel + ' ready: close and reopen"',
            lineNow.state === 'update' && lineNow.text === 'Version ' + T.release + ' · update ' + nextRel + ' ready: close and reopen', JSON.stringify(lineNow));
    L = await launch(ctx);
    st = await state(L.page);
    var m = await marks(L.page);
    line = await versionLine(L.page);
    s.check('UPGRADE: ... and the next launch runs it (its files, "Version ' + nextRel + '"), under one cache', problems(L).length === 0 &&
            JSON.stringify(st.keys) === JSON.stringify([T.next.version]) && m.release === nextRel && m.scripts.length === T.scripts.length && m.page && m.css === 'next' &&
            lineSaysOnly(line, nextRel),
            JSON.stringify({ keys: st.keys, marks: m, line: line, problems: problems(L) }));
  } finally {
    await ctx.close();
    await up();
  }
  // control: a page with no worker says more than the number
  var c2 = await newContext(browser, false);
  try {
    serve(T.tree);
    var L2 = await launch(c2), line2 = await versionLine(L2.page);
    s.check('UPGRADE: control: on a page with no worker the line reads "· offline copy not installed yet" after the number, and the check above fails on it',
            !!line2 && line2.state === 'none' && line2.text === 'Version ' + T.release + ' · offline copy not installed yet' && !lineSaysOnly(line2, T.release), JSON.stringify(line2));
  } finally {
    await c2.close();
  }
}

/* ---- 2. FAILED INSTALL -------------------------------------------------------------------- */
/** The failed install of `bad` over `base`; what the checks read. */
async function failedInstall(browser, base, bad) {
  var ctx = await newContext(browser), out = {};
  try {
    serve(base.dir);
    await online(ctx);
    var L = await install(ctx, base.version);
    out.installed = L.installed.ok;
    serve(bad.dir);
    out.update = await update(L.page);
    out.keys = (await state(L.page)).keys;
    L = await launch(ctx);                  // with a connection: the browser looks for the update again
    await update(L.page);
    await sleep(1500);                      // (anything a worker does in the background, done)
    out.keysOnline = (await state(L.page)).keys;
    out.marksOnline = await marks(L.page);
    await offline(ctx);
    L = await launch(ctx);
    out.marksOffline = await marks(L.page);
    out.problemsOffline = problems(L);
    out.line = await versionLine(L.page);
  } finally {
    await ctx.close();
    await up();
  }
  return out;
}
async function caseFailedInstall(s, browser, T) {
  var r = await failedInstall(browser, { dir: T.tree, version: T.worker.version }, T.bad);
  var only = JSON.stringify([T.worker.version]);
  s.check('FAILED INSTALL: a release whose SHELL names a file that is not there fails to install and leaves no cache of its own (' + T.bad.version + ')',
          r.installed && JSON.stringify(r.keys) === only && JSON.stringify(r.keysOnline) === only, JSON.stringify({ keys: r.keys, keysOnline: r.keysOnline }));
  s.check('FAILED INSTALL: ... a launch with a connection runs the installed release whole (' + T.release + ', none of the next release\'s files)',
          whole(r.marksOnline, T.release), JSON.stringify(r.marksOnline));
  s.check('FAILED INSTALL: ... and so does a launch offline: the app starts, no error, and the line reads "Version ' + T.release + '"',
          whole(r.marksOffline, T.release) && r.problemsOffline.length === 0 && lineSaysOnly(r.line, T.release),
          JSON.stringify({ marks: r.marksOffline, problems: r.problemsOffline, line: r.line }));
  // control: v1.9.0's worker in the same case
  var c = await failedInstall(browser, { dir: T.old, version: T.oldWorker.version }, T.oldBad);
  var leftover = JSON.stringify(c.keysOnline) !== JSON.stringify([T.oldWorker.version]);
  s.check('FAILED INSTALL: control: ' + BEFORE_R1 + '\'s worker (' + T.oldWorker.version + ') in the same case fails both checks: an empty cache of the failed release left behind, ' +
          'and the next release\'s files on the page, fetched into the installed copy in the background',
          c.installed && leftover && !whole(c.marksOffline),
          JSON.stringify({ keys: c.keysOnline, online: c.marksOnline, offline: c.marksOffline }));
}

/* ---- 3. HOLE ------------------------------------------------------------------------------ */
async function caseHole(s, browser, T) {
  var ctx = await newContext(browser), f = T.scripts[0], V = T.worker.version;
  var take = function (page) {
    return page.evaluate(function (a) { return caches.open(a.v).then(function (c) { return c.delete('./' + a.f); }); }, { v: V, f: f });
  };
  try {
    serve(T.tree);
    await online(ctx);
    var L = await install(ctx, V);
    var had = (await cached(L.page, V)).indexOf('/' + f) >= 0;
    await take(L.page);
    var gone = (await cached(L.page, V)).indexOf('/' + f) < 0;
    // offline, with the hole
    await offline(ctx);
    L = await launch(ctx);
    var holeProblems = problems(L);
    s.check('HOLE: ' + f + ' taken out of the cache; offline, the page says "' + UPDATING + '", builds nothing, and throws no error',
            had && gone && !!L.app && L.app.updating === UPDATING && !L.app.sim && L.errors.filter(function (e) { return e.indexOf('pageerror') === 0; }).length === 0,
            JSON.stringify({ had: had, gone: gone, app: L.app, errors: L.errors.slice(0, 3) }));
    s.check('HOLE: control: the offline launch with the hole fails the offline check (a 504 for ' + f + ', no Hourglass.sim)',
            holeProblems.length > 0 && L.bad.some(function (b) { return b === '504 /' + f; }), holeProblems.join('; '));
    // a launch with a connection fills it again, from the same release
    await online(ctx);
    L = await launch(ctx);
    var online1 = problems(L);
    var back = await until(async function () { var list = await cached(L.page, V); return { ok: list.indexOf('/' + f) >= 0, n: list.length }; }, 10000);
    await offline(ctx);
    L = await launch(ctx);
    s.check('HOLE: a launch with a connection runs, and fills the cache again (the server has the same release); offline after it, the app starts, no 504',
            online1.length === 0 && back.ok && back.n === T.worker.shell.length && problems(L).length === 0 && !L.app.updating,
            JSON.stringify({ online: online1, back: back, offline: problems(L) }));
    // a hole while the server has another release (whose install fails): not filled from it
    await take(L.page);
    await online(ctx);
    serve(T.bad.dir);
    L = await launch(ctx);
    await update(L.page);
    await sleep(1500);
    var list = await cached(L.page, V), st = await state(L.page);
    s.check('HOLE: a hole while the server has another release is not filled from it (' + f + ' still out of ' + V + '; the other release\'s install, which fails, leaves no cache)',
            list.indexOf('/' + f) < 0 && list.length === T.worker.shell.length - 1 && JSON.stringify(st.keys) === JSON.stringify([V]),
            JSON.stringify({ n: list.length, keys: st.keys }));
  } finally {
    await ctx.close();
    await up();
  }
}

/* ---- 4. LAB ------------------------------------------------------------------------------- */
/** The app installed from `dir`, then a lab page; what the checks read. */
async function labVisit(browser, dir, version) {
  var ctx = await newContext(browser), out = {};
  try {
    serve(dir);
    await online(ctx);
    var L = await install(ctx, version);
    out.before = (await cached(L.page, version)).length;
    var lp = await ctx.newPage(), loads = 0, labErrors = [];
    lp.on('load', function () { loads++; });
    lp.on('pageerror', function (e) { labErrors.push(String(e && e.message).split('\n')[0]); });
    await lp.goto(HOME + 'lab/sand/index.html');
    await lp.waitForFunction(function () { return !!window.__lab; }, null, { timeout: 15000 }).catch(function () {});
    await sleep(2500);
    out.status = await lp.evaluate(function () { var e = document.getElementById('status'); return e ? e.textContent : null; }).catch(function () { return null; });
    out.loads = loads;
    out.after = (await cached(L.page, version)).length;
    await lp.close();
    await offline(ctx);
    L = await launch(ctx);
    out.offline = problems(L);
  } finally {
    await ctx.close();
    await up();
  }
  return out;
}
async function caseLab(s, browser, T) {
  var n = T.worker.shell.length;
  var r = await labVisit(browser, T.lab, T.worker.version);
  s.check('LAB: a lab page that meets an engine of another build leaves the app\'s cache whole (' + n + ' files), says so, and loads once',
          r.before === n && r.after === n && r.loads === 1 && /build upgrade-test-C/.test(r.status || '') && /reload with a connection/i.test(r.status || ''),
          JSON.stringify({ before: r.before, after: r.after, loads: r.loads, status: r.status }));
  s.check('LAB: ... and the app then starts offline', r.offline.length === 0, r.offline.join('; '));
  // control: 13a9772's lab page in the same case
  var c = await labVisit(browser, T.oldLab, T.worker.version);
  s.check('LAB: control: ' + BEFORE_R1 + '\'s lab page in the same case fails the check (it drops the engine from the app\'s cache and loads once more)',
          c.before === n && c.after < n && c.loads === 2, JSON.stringify({ before: c.before, after: c.after, loads: c.loads }));
}

/* ---- the run ------------------------------------------------------------------------------ */
async function main() {
  var s = new H.Suite('app-upgrade'), browser = null, T = null, why = null;
  try {
    try {
      git(['rev-parse', '--verify', '--quiet', MAIN + '^{commit}']);
      git(['rev-parse', '--verify', '--quiet', BEFORE_R1 + '^{commit}']);
    } catch (e) {
      why = 'needs ' + MAIN + ' and ' + BEFORE_R1 + ' (git fetch origin main; in a shallow clone, git fetch --unshallow)';
    }
    if (why) { s.check('the upgrade suite ' + why, false); return; }
    var argRoot = process.argv.indexOf('--root') > 0 ? path.resolve(process.argv[process.argv.indexOf('--root') + 1]) : (process.env.HOURGLASS_ROOT || ROOT);
    T = {};
    T.main = archive(MAIN, 'main');
    T.mainWorker = worker(T.main);
    T.tree = copyTree(argRoot, 'tree');
    T.worker = worker(T.tree);
    T.release = pageRelease(T.tree) || 'unknown';
    T.scripts = paths.classicScripts(T.tree);
    T.next = nextRelease(T.tree, 'next', false);
    T.bad = nextRelease(T.tree, 'bad', true);
    T.old = archive(BEFORE_R1, 'old');
    T.oldWorker = worker(T.old);
    T.oldBad = nextRelease(T.old, 'old-bad', true);
    T.lab = labOtherBuild(copyTree(T.tree, 'lab'));
    T.oldLab = copyTree(T.tree, 'old-lab');
    fs.rmSync(path.join(T.oldLab, 'lab', 'sand'), { recursive: true, force: true });
    fs.cpSync(path.join(T.old, 'lab', 'sand'), path.join(T.oldLab, 'lab', 'sand'), { recursive: true });
    labOtherBuild(T.oldLab);
    console.log('installing ' + MAIN + ' (' + T.mainWorker.version + '), then ' + argRoot + ' (' + T.worker.version + ', page ' + T.release + '); controls from ' +
                BEFORE_R1 + ' (' + T.oldWorker.version + '); served at ' + HOME);
    serve(T.tree);
    await up();
    browser = await require('playwright').chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-webgl'] });
    var cases = [['UPGRADE', caseUpgrade], ['FAILED INSTALL', caseFailedInstall], ['HOLE', caseHole], ['LAB', caseLab]];
    for (var i = 0; i < cases.length; i++) {
      try { await cases[i][1](s, browser, T); } catch (e) {
        s.check(cases[i][0] + ': no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
      }
    }
  } catch (e) {
    s.check('no exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
    await down();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    s.done();
  }
}
main();
