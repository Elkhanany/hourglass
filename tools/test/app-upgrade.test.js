#!/usr/bin/env node
/*
 * The upgrade suite (the snapshot worker, release 1.10.0): what an installed copy of the app
 * does when a release comes,
 * in Chromium with the service worker on, the app served from a scratch copy that is swapped
 * under the same address, and "offline" meaning the server stopped and the page offline.
 *
 *  1. UPGRADE: origin/main (git archive) is served and installed; then this tree in its place:
 *     two launches with a connection (the first, the old page that the new worker takes over,
 *     checked like the others), then one offline. Offline: no page or console error, no
 *     failed or 504 response, Hourglass.sim, one cache (this tree's VERSION), and Tune's last
 *     line "Version X.Y.Z" with nothing after the number. Then a newer release is served and
 *     installed while the page is open: the line says "update ... ready: close and reopen", and
 *     the next launch runs the newer release, under one cache.
 *     OVERTAKEN: this tree installed; a deploy lands while the next release's install is
 *     downloading (from the sixth file on, the server has the release after it): no copy of
 *     the overtaken release is kept, the installed release runs on whole offline, and the next
 *     launches with a connection end on the release after, whole.
 *     VARY: the server sends "Vary: Accept": a launch of the installed copy asks the server for
 *     nothing, and it starts offline.
 *  2. FAILED INSTALL: this tree installed, a next release whose SHELL names a file that is not
 *     there (its scripts, page and style sheet marked) is served: its install fails and leaves
 *     no cache of its own, and a launch with a connection, then one offline, run the installed
 *     release whole (none of the next release's marks).
 *  3. HOLE: one script taken out of the cache. Offline the page says "Hourglass is updating.
 *     Open it again with a connection." and builds nothing, with no page error; a launch with a
 *     connection fills the cache again from the same release, and offline after it the app
 *     starts. A hole while the server has another release is not filled from it. The same
 *     words when app.js itself is the hole, or the style sheet (index.html's own last lines).
 *     An older release (1.10.0, 5911e24) with app.js taken out of its cache, when the server
 *     has this tree: the launch with a connection fills the hole with this tree's app.js, which
 *     needs the settings store the old page never loads. The page then says "Hourglass is
 *     updating. Open it again in a moment." (not "with a connection": it has one), builds
 *     nothing and throws no error, and a later launch runs this tree. Its control: this tree
 *     with the online words taken out of app.js says "... with a connection" online.
 *  4. LAB: a lab page that meets an engine of another build leaves the app's cache whole, and
 *     the app then starts offline.
 *  5. INTERRUPTED: an update that never finishes, over a copy installed before R1 (13a9772,
 *     v1.9.0, whose worker fetches each file it answers into its copy): this tree is served
 *     without its worker, so nothing installs. The launch with a connection runs the old page;
 *     offline after it the copy is mixed: this tree's page and scripts, but not a file the old
 *     page never asked for (the settings store, app/settings.js). The page then says "Hourglass
 *     is updating. Open it again with a connection.", builds nothing and throws no error, and
 *     with a connection again it runs. (From a snapshot worker, R1 and later, a copy is never
 *     mixed: that is UPGRADE and FAILED INSTALL.)
 *  6. OLD SAVES: each of the six materials, saved by release 1.13.0 (d6482bd) and by release
 *     1.10.0 (5911e24) through their own cards, comes through the update to this tree with the
 *     same sand, caps and picture and every other setting as it was, online and offline (the
 *     sand and the frame's finish are chosen apart from 1.14.0 on). Its control: a copy of this
 *     tree whose finish is not made from the old material.
 * The controls, each a check above that must fail: a page with no worker (the version line says
 * more than the number); the offline launch with the hole (a 504, no Hourglass.sim); the failed
 * install under 13a9772's worker, v1.9.0, a release before the snapshot worker (an empty cache of the
 * failed release left behind, and the next release's files on the page, fetched into the
 * installed copy in the background); 13a9772's lab page (it dropped the engine from the app's
 * caches); the interrupted update with a copy of app.js that does not ask for the settings
 * store before it starts (it throws; the words then come from the page's last lines, and with
 * those taken out as well it says nothing). Three are this tree with one thing undone
 * (without()): the worker without its look at the server after the download (it keeps a copy
 * of two releases), the worker without ignoreVary (the page and the style sheet miss, and the
 * shell is downloaded again), and the page without its last lines (no words for a hole in
 * app.js or the style sheet).
 *
 * HOURGLASS_MAIN=<ref> installs another ref than origin/main first. Without that ref, or without
 * 13a9772, d6482bd or 5911e24 (a shallow clone), the suite fails and says how to fetch it.
 *
 *   node tools/test/app-upgrade.test.js [--port <n>] [--only <case>]    (default port: $PORT, else 8711;
 *   cases: upgrade overtaken vary "failed install" hole lab interrupted "old saves")
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
var UPDATING = 'Hourglass is updating. Open it again with a connection.';           // offline
var UPDATING_ONLINE = 'Hourglass is updating. Open it again in a moment.';            // with a connection
// app.js's online words, the thing a control takes out (it then says UPDATING online too)
var ONLINE_WORDS = "navigator.onLine ? '" + UPDATING_ONLINE + "' : ";
// index.html's own last lines: the inline script that says so when app.js never started
var LAST_LINES = /<script>(?:(?!<\/script>)[\s\S])*id = 'updating'(?:(?!<\/script>)[\s\S])*<\/script>/;
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
/** A copy of a tree under another VERSION (and its page's own release with it), nothing else changed. */
function release(src, name, v) {
  var dir = copyTree(src, name);
  write(dir, 'sw.js', read(dir, 'sw.js').replace(/var VERSION = '[^']+'/, "var VERSION = '" + v + "'"));
  write(dir, 'index.html', read(dir, 'index.html').replace(/(<meta\s+name=["']hourglass-version["']\s+content=["'])[^"']+/i, '$1' + v.replace(/^hourglass-v/, '')));
  return { dir: dir, version: v };
}
/**
 * A copy of a tree with one thing undone in file `f` (a control: what that thing answers must
 * fail on it): every `from` (a string or a RegExp) replaced by `to`. .found: how many there were.
 */
function without(src, name, f, from, to) {
  var dir = copyTree(src, name), text = read(dir, f), n = 0;
  var out = typeof from === 'string' ? text.split(from) : null;
  if (out) { n = out.length - 1; text = out.join(to); }
  else text = text.replace(from, function () { n++; return to; });
  write(dir, f, text);
  return { dir: dir, found: n };
}
/** A copy of a tree whose lab page was written for another engine build than the engine's. */
function labOtherBuild(dir) {
  var f = path.join('lab', 'sand', 'main.mjs');
  write(dir, f, read(dir, f).replace(/const BUILD_EXPECTED = '[^']+'/, "const BUILD_EXPECTED = 'upgrade-test-C'"));
  return dir;
}

/* ---- the server --------------------------------------------------------------------------- */
var server = null;
/** Serve another tree from now on (the link is replaced in one step: a request never finds none). */
function serve(dir) {
  var next = LINK + '.next';
  try { fs.unlinkSync(next); } catch (e) {}
  fs.symlinkSync(dir, next);
  fs.renameSync(next, LINK);
}
// A case's own look at every request, before it is answered: it may serve another tree from this
// request on, or set a header of the answer. q: { path, reload (a request made with cache:
// 'reload' or 'no-store': an install's downloads, the worker's look at sw.js), worker (the
// browser's own fetch of the worker's script) }.
var onRequest = null;
function up() {
  return new Promise(function (res, rej) {
    if (server) return res();
    var s = staticServer.start(PORT, LINK, function () { server = s; res(); });
    s.prependListener('request', function (req, answer) {
      if (!onRequest) return;
      onRequest({ path: req.url.split('?')[0], reload: /no-cache/.test(req.headers['cache-control'] || ''),
        worker: req.headers['service-worker'] === 'script' }, answer);
    });
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

/** A launch: the context's pages closed, the app opened afresh, until it is built or says it is updating (or `wait` ms). */
async function launch(ctx, wait) {
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
  var look = function () {
    return page.evaluate(function () {
      var u = document.getElementById('updating');
      return { ok: !!(window.Hourglass && window.Hourglass.sim) || !!u, sim: !!(window.Hourglass && window.Hourglass.sim), updating: u ? u.textContent : null };
    }).catch(function (e) { return { ok: false, error: String(e && e.message) }; });
  };
  var r = await until(look, wait || 20000);
  await sleep(300);                         // (a moment for late requests and errors, and for the page's load event)
  var late = await look();
  L.app = late.error ? r : late;
  return L;
}
/** The words over the page (#updating), waited for up to `ms`; null without them. */
async function updatingNote(page, ms) {
  var r = await until(function () {
    return page.evaluate(function () {
      var u = document.getElementById('updating');
      return { ok: !!u, text: u ? u.textContent : null, sim: !!(window.Hourglass && window.Hourglass.sim) };
    }).catch(function () { return { ok: false, text: null, sim: false }; });
  }, ms, 100);
  return r;
}
/** What is wrong with a launch that should have started the app: [] when nothing. */
function problems(L) {
  var out = [];
  if (L.errors.length) out.push(L.errors.slice(0, 2).join(' | '));
  if (L.bad.length) out.push('responses: ' + L.bad.slice(0, 4).join(', '));
  if (!L.app || !L.app.sim) out.push('no Hourglass.sim' + (L.app && L.app.updating ? ' (the page says: ' + L.app.updating + ')' : ''));
  else if (L.app.updating) out.push('the app runs, and the page says over it: ' + L.app.updating);
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
    var p1 = problems(L);                   // (the old page, under the old worker, then taken over by the new one)
    L = await launch(ctx);
    var p2 = problems(L);
    await offline(ctx);
    L = await launch(ctx);
    var st = await state(L.page), line = await versionLine(L.page), said = await ask(L.page);
    s.check('UPGRADE: offline, after two launches with a connection: the app starts (Hourglass.sim), no page or console error, no failed or 504 response, in any of the three launches',
            problems(L).length === 0 && p1.length === 0 && p2.length === 0, problems(L).concat(p1, p2).join('; '));
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

/* ---- 1b. OVERTAKEN: a deploy lands while the install is downloading ------------------------- */
/** Which of the page's marked files in the cache `name` are the next release's, and which are not. */
function cacheMix(page, name, files) {
  return page.evaluate(function (a) {
    return caches.has(a.name).then(function (has) {
      if (!has) return null;
      return caches.open(a.name).then(function (c) {
        return Promise.all(a.files.map(function (f) {
          return c.match(f).then(function (r) { return r ? r.text() : null; }).then(function (t) {
            return { f: f, next: t === null ? null : /__upgradeNext|upgrade-test/.test(t) };
          });
        }));
      }).then(function (list) {
        return { next: list.filter(function (x) { return x.next === true; }).map(function (x) { return x.f; }),
          own: list.filter(function (x) { return x.next === false; }).map(function (x) { return x.f; }) };
      });
    });
  }, { name: name, files: files });
}
/**
 * This tree installed; then `dir` (the next release, or it with one thing undone) is served, and
 * from the request after the `k`-th of its install's downloads on, the server has the release
 * after it (T.after: this tree again, two patches up, unmarked). `rest`: a tree the server goes
 * back to once the last download is answered (the control's, so that no later look of the
 * browser replaces the copy before it is read). What the checks read.
 */
async function overtaken(browser, T, dir, k, rest) {
  var ctx = await newContext(browser), out = { looks: 0 }, n = 0, done = 0, V = T.next.version, N = T.worker.shell.length;
  var marked = ['./', './index.html', './styles.css'].concat(T.scripts.map(function (f) { return './' + f; }));
  try {
    serve(T.tree);
    await online(ctx);
    var L = await install(ctx, T.worker.version);
    out.installed = L.installed.ok;
    serve(dir);
    onRequest = function (q, answer) {
      if (q.worker) out.looks++;            // (the browser may look once more after the first install: it then finds the release after)
      if (!q.reload || q.path === '/sw.js') return;
      if (++n === k + 1) serve(T.after.dir);
      if (rest) answer.on('finish', function () { if (++done === N) serve(rest); });
    };
    await update(L.page);                   // the install, overtaken on its way
    out.downloads = n;
    out.keys = (await state(L.page)).keys;
    out.mix = await cacheMix(L.page, V, marked);
    await offline(ctx);
    onRequest = null;
    L = await launch(ctx);
    out.keysOffline = (await state(L.page)).keys;
    out.marksOffline = await marks(L.page);
    out.problemsOffline = problems(L);
    out.line = await versionLine(L.page);
    if (rest) return out;
    // with a connection again: the server has the release after, whole
    serve(T.after.dir);
    await online(ctx);
    L = await launch(ctx);
    await update(L.page);
    L = await launch(ctx);
    out.keysAfter = (await state(L.page)).keys;
    out.marksAfter = await marks(L.page);
    out.problemsAfter = problems(L);
    out.lineAfter = await versionLine(L.page);
  } finally {
    onRequest = null;
    await ctx.close();
    await up();
  }
  return out;
}
async function caseOvertaken(s, browser, T) {
  var K = 5, V = T.next.version, afterRel = T.after.version.replace(/^hourglass-v/, ''), nextRel = V.replace(/^hourglass-v/, '');
  var r = await overtaken(browser, T, T.next.dir, K, null);
  // (the browser may have looked again by itself after the install that failed: it then has the release after, whole)
  var ran = r.marksOffline.release === afterRel ? { rel: afterRel, v: T.after.version } : { rel: T.release, v: T.worker.version };
  s.check('OVERTAKEN: the server has the release after from the ' + (K + 1) + 'th file of an install\'s downloads on: no copy of that release (' + V + ') is kept (it would hold files of two)',
          r.installed && r.downloads >= T.worker.shell.length && r.keys.indexOf(V) < 0 && r.mix === null && r.keysOffline.indexOf(V) < 0,
          JSON.stringify({ installed: r.installed, downloads: r.downloads, looks: r.looks, keys: r.keys, mix: r.mix, keysOffline: r.keysOffline }));
  s.check('OVERTAKEN: ... offline, the app runs one release, whole, under one cache: the one that was installed (' + T.release + '), or the release after (' + afterRel +
          ') if the browser has looked again by itself (here ' + r.looks + ' look' + (r.looks === 1 ? '' : 's') + ': ' + ran.rel + ')',
          r.problemsOffline.length === 0 && whole(r.marksOffline, ran.rel) && lineSaysOnly(r.line, ran.rel) && JSON.stringify(r.keysOffline) === JSON.stringify([ran.v]),
          JSON.stringify({ marks: r.marksOffline, problems: r.problemsOffline, line: r.line, keys: r.keysOffline }));
  s.check('OVERTAKEN: ... and with a connection the next launches end on the release after, whole ("Version ' + afterRel + '"), under one cache',
          r.problemsAfter.length === 0 && JSON.stringify(r.keysAfter) === JSON.stringify([T.after.version]) && whole(r.marksAfter, afterRel) && lineSaysOnly(r.lineAfter, afterRel),
          JSON.stringify({ keys: r.keysAfter, marks: r.marksAfter, problems: r.problemsAfter, line: r.lineAfter }));
  // control: the same worker without its look at the server after the download (the server is
  // back at its release once the last file is answered, so that the copy stays to be read)
  var c = await overtaken(browser, T, T.unchecked.dir, K, T.unchecked.dir);
  var m = c.marksOffline, mixed = !!c.mix && c.mix.next.length > 0 && c.mix.own.length > 0;
  var wholeNext = m.release === nextRel && m.scripts.length === T.scripts.length && m.page && m.css === 'next';
  s.check('OVERTAKEN: control: the same worker without its look at the server after the download fails the first two checks: it keeps ' + V +
          ' with files of two releases, and offline runs them under "Version ' + nextRel + '"',
          T.unchecked.found === 1 && c.installed && c.keys.indexOf(V) >= 0 && mixed && JSON.stringify(c.keysOffline) === JSON.stringify([V]) &&
          !whole(m) && !wholeNext && lineSaysOnly(c.line, nextRel),
          JSON.stringify({ undone: T.unchecked.found, looks: c.looks, keys: c.keys, keysOffline: c.keysOffline, mix: c.mix, marks: m, line: c.line }));
}

/* ---- 1c. VARY: the server's Vary header --------------------------------------------------- */
/** `dir` installed from a server that sends "Vary: Accept"; one more launch, then one offline. */
async function varying(browser, dir, version) {
  var ctx = await newContext(browser), out = {}, log = [];
  try {
    serve(dir);
    onRequest = function (q, answer) { answer.setHeader('Vary', 'Accept'); if (!q.worker) log.push(q.path); };
    await online(ctx);
    var L = await install(ctx, version);
    out.installed = L.installed.ok;
    await sleep(500);
    var from = log.length;
    L = await launch(ctx);
    await sleep(1500);                      // (anything the worker does in the background, done)
    out.asked = log.slice(from);
    out.problems = problems(L);
    await offline(ctx);
    L = await launch(ctx);
    out.problemsOffline = problems(L);
  } finally {
    onRequest = null;
    await ctx.close();
    await up();
  }
  return out;
}
async function caseVary(s, browser, T) {
  var r = await varying(browser, T.tree, T.worker.version);
  s.check('VARY: the server sends "Vary: Accept" (the page, the style sheet and the icons are then asked for with other Accept headers than the install\'s): ' +
          'a launch of the installed copy asks the server for nothing, and it starts offline',
          r.installed && r.asked.length === 0 && r.problems.length === 0 && r.problemsOffline.length === 0,
          JSON.stringify({ installed: r.installed, asked: r.asked.length, first: r.asked.slice(0, 4), problems: r.problems, offline: r.problemsOffline }));
  // control: this tree's worker without ignoreVary
  var c = await varying(browser, T.varied.dir, T.worker.version);
  s.check('VARY: control: the same worker without ignoreVary fails the check: the page is asked of the server at every launch, and the whole shell downloaded again',
          T.varied.found === 2 && c.installed && c.asked.indexOf('/') >= 0 && c.asked.length >= T.worker.shell.length,
          JSON.stringify({ undone: T.varied.found, asked: c.asked.length, first: c.asked.slice(0, 4) }));
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

/**
 * Release 1.10.0 installed, app.js taken out of its cache, then `dir` served: the launch with a
 * connection (the old page, with `dir`'s app.js filled into the hole), then launches with a
 * connection until `dir` runs.
 */
async function holeOlder(browser, T, dir) {
  var ctx = await newContext(browser), old = T.olds['1.10.0'], r = {};
  try {
    serve(old.dir);
    await online(ctx);
    var L = await install(ctx, old.version);
    r.installed = L.installed.ok && problems(L).length === 0;
    r.took = await L.page.evaluate(function (v) { return caches.open(v).then(function (c) { return c.delete('./app.js'); }); }, old.version);
    serve(dir);
    L = await launch(ctx);
    r.first = { app: L.app, errors: L.errors.slice(0, 3), release: L.app ? (await marks(L.page)).release : null };
    r.next = await until(async function () {
      var L2 = await launch(ctx), m = L2.app ? await marks(L2.page) : {};
      return { ok: !!L2.app && L2.app.sim && !L2.app.updating && m.release === T.release, app: L2.app, release: m.release, errors: L2.errors.slice(0, 2) };
    }, 40000, 500);
  } finally {
    await ctx.close();
    await up();
  }
  return r;
}
async function caseHoleOlder(s, browser, T) {
  var r = await holeOlder(browser, T, T.tree), f = r.first;
  s.check('HOLE: 1.10.0 installed with app.js taken out of its cache, this tree on the server: the launch with a connection runs the old page with this tree\'s app.js, which says "' + UPDATING_ONLINE + '", builds nothing, and throws no error',
          r.installed && r.took && f.release === '1.10.0' && !!f.app && f.app.updating === UPDATING_ONLINE && !f.app.sim && pageErrors(f).length === 0,
          JSON.stringify({ installed: r.installed, took: r.took, first: f }));
  s.check('HOLE: ... and a later launch with a connection runs this tree (' + T.release + ')', r.next.ok, JSON.stringify(r.next));
  // control: this tree with the online words taken out of app.js
  var c = await holeOlder(browser, T, T.offlineWords.dir), cf = c.first;
  s.check('HOLE: control: this tree with the online words taken out of app.js says "' + UPDATING + '" in the same launch, though it has a connection',
          T.offlineWords.found === 1 && c.installed && c.took && !!cf.app && !cf.app.sim && cf.app.updating === UPDATING && cf.app.updating !== UPDATING_ONLINE,
          JSON.stringify({ undone: T.offlineWords.found, first: cf }));
}

/**
 * `dir` installed; then, one after the other, each of `files` taken out of the cache and the app
 * launched offline (and the cache filled again by a launch with a connection). What the page
 * said each time.
 */
async function holes(browser, dir, V, files, n) {
  var ctx = await newContext(browser), out = {};
  try {
    serve(dir);
    await online(ctx);
    var L = await install(ctx, V);
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var took = await L.page.evaluate(function (a) { return caches.open(a.v).then(function (c) { return c.delete('./' + a.f); }); }, { v: V, f: f });
      await offline(ctx);
      L = await launch(ctx, 3000);
      var note = await updatingNote(L.page, 3000);
      out[f] = { took: took, note: note.text, sim: note.sim, bad: L.bad.slice(0, 3), pageErrors: L.errors.filter(function (e) { return e.indexOf('pageerror') === 0; }).length };
      await online(ctx);
      L = await launch(ctx);
      out[f].filled = (await until(async function () { var list = await cached(L.page, V); return { ok: list.length === n, n: list.length }; }, 10000)).n;
    }
  } finally {
    await ctx.close();
    await up();
  }
  return out;
}
async function caseHoleOwn(s, browser, T) {
  var app = T.scripts[T.scripts.length - 1], css = 'styles.css', n = T.worker.shell.length;
  var r = await holes(browser, T.tree, T.worker.version, [app, css], n);
  s.check('HOLE: ' + app + ' itself taken out of the cache (its pre-flight cannot say so): offline, the page says "' + UPDATING + '", with no page error; a launch with a connection fills the cache again',
          r[app].took && r[app].note === UPDATING && !r[app].sim && r[app].pageErrors === 0 && r[app].filled === n, JSON.stringify(r[app]));
  s.check('HOLE: ' + css + ' taken out of the cache: offline, the page says the same over the unstyled app',
          r[css].took && r[css].note === UPDATING && r[css].pageErrors === 0 && r[css].filled === n, JSON.stringify(r[css]));
  // control: the page without its own last lines
  var c = await holes(browser, T.plain.dir, T.worker.version, [app, css], n);
  s.check('HOLE: control: the page without its last lines fails both checks: no words for a hole in ' + app + ' (a 504, no Hourglass.sim: the page looks ready and is dead) or in ' + css + ' (the app runs unstyled)',
          T.plain.found === 1 && c[app].took && c[app].note === null && !c[app].sim && c[app].bad.indexOf('504 /' + app) >= 0 &&
          c[css].took && c[css].note === null && c[css].sim && c[css].bad.indexOf('504 /' + css) >= 0,
          JSON.stringify({ undone: T.plain.found, app: c[app], css: c[css] }));
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

/* ---- 5. INTERRUPTED ----------------------------------------------------------------------- */
/**
 * The release before R1 installed; then `dir` (a tree without its worker, so that no install
 * happens) served: a launch with a connection, one offline once the old worker has fetched the
 * new page and app.js into its copy (it waits `wait` ms for the app or the words: a page that
 * neither starts nor says anything is waited for to the end), and one with a connection again.
 */
async function interrupted(browser, T, dir, store, wait) {
  var ctx = await newContext(browser);
  try {
    serve(T.old);
    await online(ctx);
    var L = await install(ctx, T.oldWorker.version), r = { installed: L.installed.ok && problems(L).length === 0 };
    serve(dir);
    r.first = await launch(ctx);
    // the old worker answers from its copy and fetches each file it answered behind the answer
    r.mixed = await until(function () {
      return r.first.page.evaluate(function (a) {
        function text(c, u) { return c.match(u).then(function (x) { return x ? x.text() : ''; }); }
        return caches.open(a.v).then(function (c) {
          return Promise.all([text(c, './'), text(c, './index.html'), text(c, './app.js'), c.match('./' + a.store)]);
        }).then(function (t) {
          var page = (t[0] + t[1]).indexOf(a.store) > 0;                 // (the new page asks for the store's file)
          return { ok: page && t[2].indexOf('HourglassSettings') > 0, page: page, store: !!t[3] };
        });
      }, { v: T.oldWorker.version, store: store });
    }, 10000);
    await offline(ctx);
    r.off = await launch(ctx, wait);
    r.release = r.off.app ? (await marks(r.off.page)).release : null;
    await online(ctx);
    r.back = await launch(ctx);
    r.keys = (await state(r.back.page)).keys;
    return r;
  } finally {
    await ctx.close();
    await up();
  }
}
function pageErrors(L) { return L.errors.filter(function (e) { return e.indexOf('pageerror') === 0; }); }
async function caseInterrupted(s, browser, T) {
  var store = paths.script('settings.js', T.tree);
  var dir = copyTree(T.tree, 'no-worker');
  fs.rmSync(path.join(dir, 'sw.js'));
  var r = await interrupted(browser, T, dir, store);
  s.check('INTERRUPTED: ' + BEFORE_R1 + ' (' + T.oldWorker.version + ') installed, this tree served without its worker: the launch with a connection runs, and nothing installs',
          r.installed && !!r.first.app && r.first.app.sim && pageErrors(r.first).length === 0 && JSON.stringify(r.keys) === JSON.stringify([T.oldWorker.version]),
          JSON.stringify({ installed: r.installed, app: r.first.app, errors: r.first.errors.slice(0, 2), keys: r.keys }));
  s.check('INTERRUPTED: offline then, the copy is mixed (this tree\'s page, no ' + store + '): the page says "' + UPDATING + '", builds nothing, and throws no error',
          r.mixed.ok && !r.mixed.store && r.release === T.release && !!r.off.app && r.off.app.updating === UPDATING && !r.off.app.sim && pageErrors(r.off).length === 0 &&
          r.off.bad.some(function (b) { return b === '504 /' + store; }),
          JSON.stringify({ mixed: r.mixed, release: r.release, app: r.off.app, errors: r.off.errors.slice(0, 3), bad: r.off.bad.slice(0, 3) }));
  s.check('INTERRUPTED: with a connection again, the app starts',
          !!r.back.app && r.back.app.sim && !r.back.app.updating && pageErrors(r.back).length === 0 && !r.back.bad.some(function (b) { return /^504 /.test(b); }),
          JSON.stringify({ app: r.back.app, errors: r.back.errors.slice(0, 2), bad: r.back.bad.slice(0, 3) }));
  // control: app.js without the pre-flight's line for the settings store. It throws there. The
  // words come all the same, at the page's load event, from index.html's own last lines (they
  // speak whenever app.js has not started); with those taken out as well, the page says nothing.
  var bare = copyTree(dir, 'no-preflight'), line = "    if (!w.HourglassSettings || typeof w.HourglassSettings.load !== 'function') out.push('HourglassSettings');\n";
  var app = read(bare, 'app.js');
  write(bare, 'app.js', app.replace(line, ''));
  var c = await interrupted(browser, T, bare, store);
  s.check('INTERRUPTED: control: a copy of app.js that does not ask for the settings store before it starts throws there (the words then come from the page\'s own last lines)',
          app.indexOf(line) > 0 && c.mixed.ok && !!c.off.app && !c.off.app.sim && c.off.app.updating === UPDATING && pageErrors(c.off).length > 0,
          JSON.stringify({ line: app.indexOf(line) > 0, mixed: c.mixed, app: c.off.app, errors: c.off.errors.slice(0, 2) }));
  var mute = without(bare, 'no-preflight-plain', 'index.html', LAST_LINES, '');
  var c2 = await interrupted(browser, T, mute.dir, store, 5000);
  s.check('INTERRUPTED: control: ... and with those lines taken out of the page as well, it throws and says nothing',
          mute.found === 1 && c2.mixed.ok && !!c2.off.app && !c2.off.app.sim && c2.off.app.updating !== UPDATING && pageErrors(c2.off).length > 0,
          JSON.stringify({ undone: mute.found, mixed: c2.mixed, app: c2.off.app, errors: c2.off.errors.slice(0, 2) }));
}

/* ---- the run ------------------------------------------------------------------------------ */
/* ---- 6. OLD SAVES: a material saved by 1.13.0 and by 1.10.0, through the update ---------- */
// Release 1.14.0 chooses the sand and the frame's finish apart. A save written by a release before
// it has the material alone (`theme`), and must come through the update looking as it did: the same
// sand in the same colour table, the same caps, the same static picture, and every other setting
// as it was, online and offline. The save is written by the old release itself: its own card for
// the material tapped, with layered sand on, the bowl off and the rain behind the sand.
// (each named by its own commit, never by MAIN: from 1.14.0 on a release has no material cards to tap)
var OLD_RELEASES = [['1.13.0', 'd6482bd'], ['1.10.0', '5911e24']];
var MATERIALS = { sahara: 'walnut', volcanic: 'brass', moonstone: 'silver', lapis: 'gold', rosequartz: 'copper', seaglass: 'driftwood' };
/** What the page shows of the look: the renderer's colour table and static layers (hashes), whose theme it is, the save. */
function lookNow(page) {
  return page.evaluate(function () {
    function hash(a) { var h = 2166136261 >>> 0, i; for (i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }
    function layers() {
      return ['c-back', 'c-front', 'c-light'].map(function (id) {
        var c = document.getElementById(id), x = c.getContext('2d');
        return hash(new Uint32Array(x.getImageData(0, 0, c.width, c.height).data.buffer));
      }).join(' ');
    }
    var Hg = window.Hourglass, R = Hg.renderer, P = window.HourglassPhysics, out = { lut: hash(R.lut), layers: layers(), id: R.theme.id };
    out.bundle = R.theme === P.THEMES[R.theme.id];
    out.cap = JSON.stringify(R.theme.cap);
    out.data = document.documentElement.getAttribute('data-theme');
    out.accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    out.saved = localStorage.getItem('hourglass.settings.v1');
    // the same picture drawn afresh by the renderer's own bundle of that theme (the static layers depend on the page's layout)
    R.setTheme(R.theme.id);
    out.bundleLayers = layers();
    out.bundleLut = hash(R.lut);
    return out;
  });
}
/** One old release installed, one material chosen in it, then this tree: what the old app showed and saved, and the new app online and offline. */
async function oldSave(browser, T, rel, m, tree) {
  var ctx = await newContext(browser), r = { rel: rel, m: m };
  try {
    serve(T.olds[rel].dir);
    await online(ctx);
    var L = await install(ctx, T.olds[rel].version);
    // the person's taps in the old release, each its own control (the old page's sheet need not be open for a click)
    await L.page.evaluate(function (m) {
      document.querySelector('[data-theme-id="' + m + '"]').click();
      document.getElementById('opt-layers').click();
      document.getElementById('opt-chime').click();
      document.querySelector('[data-ambience="rain"]').click();
    }, m);
    await sleep(1600);                         // (the cross-fade, and the layers)
    L = await launch(ctx);                     // the old release again, from its save
    await sleep(600);
    r.old = await lookNow(L.page);
    r.oldProblems = problems(L);
    // this tree in its place: a launch that installs it, then one under it, then one offline
    serve(tree);
    L = await launch(ctx);
    await update(L.page);
    L = await launch(ctx);
    await sleep(600);
    r.online = await lookNow(L.page);
    r.onlineProblems = problems(L);
    r.onlineRelease = (await marks(L.page)).release;
    await offline(ctx);
    L = await launch(ctx);
    await sleep(600);
    r.offline = await lookNow(L.page);
    r.offlineProblems = problems(L);
    r.offlineRelease = (await marks(L.page)).release;
  } finally {
    await ctx.close();
    await up();
  }
  return r;
}
/** What is wrong with one material's way through the update: [] when nothing. */
function oldSaveWrong(r) {
  var out = [], old = r.old, oldSaved = JSON.parse(old.saved || '{}');
  if (r.oldProblems.length) out.push('the old release: ' + r.oldProblems.join('; '));
  if (old.id !== r.m || !old.bundle || oldSaved.theme !== r.m || oldSaved.layers !== true || oldSaved.chime !== false || oldSaved.ambience !== 'rain')
    out.push('the old release did not save the material and the three: ' + JSON.stringify({ id: old.id, saved: oldSaved }));
  ['online', 'offline'].forEach(function (k) {
    var n = r[k], saved = JSON.parse((n && n.saved) || '{}'), why = [];
    if (r[k + 'Problems'].length) why.push(r[k + 'Problems'].join('; '));
    if (r[k + 'Release'] !== T_RELEASE) why.push('the page is ' + r[k + 'Release']);
    if (n.id !== r.m || !n.bundle || n.cap !== old.cap || n.lut !== old.lut || n.layers !== n.bundleLayers || n.lut !== n.bundleLut || n.data !== old.data || n.accent !== old.accent)
      why.push('the look: ' + JSON.stringify({ id: n.id, bundle: n.bundle, cap: n.cap === old.cap, lut: [old.lut, n.lut], layers: n.layers === n.bundleLayers, data: n.data, accent: [old.accent, n.accent] }));
    if (saved.sand !== r.m || saved.finish !== r.MATERIAL_FINISH || saved.sandColor !== '') why.push('saved as ' + [saved.sand, saved.finish, JSON.stringify(saved.sandColor)].join(' / '));
    // (what the app keeps of its Real sand engine, not a setting: a new engine build starts it afresh)
    var lost = Object.keys(oldSaved).filter(function (key) { return !/^realSand(Build|Fails|Why|Na|NaAt)$/.test(key) && JSON.stringify(oldSaved[key]) !== JSON.stringify(saved[key]); });
    if (lost.length) why.push('changed: ' + lost.map(function (key) { return key + ' ' + JSON.stringify(oldSaved[key]) + ' → ' + JSON.stringify(saved[key]); }).join(', '));
    if (why.length) out.push(k + ': ' + why.join('; '));
  });
  return out;
}
var T_RELEASE = null;
async function caseOldSaves(s, browser, T) {
  T_RELEASE = T.release;
  for (var i = 0; i < OLD_RELEASES.length; i++) {
    var rel = OLD_RELEASES[i][0], bad = [], seen = [];
    for (var m in MATERIALS) {
      var r = await oldSave(browser, T, rel, m, T.tree);
      r.MATERIAL_FINISH = MATERIALS[m];
      var w = oldSaveWrong(r);
      if (w.length) bad.push(m + ': ' + w.join(' | '));
      else seen.push(m + ' (' + r.online.lut + ')');
    }
    s.check('OLD SAVES: each of the six materials saved by release ' + rel + ' (' + OLD_RELEASES[i][1] + ', with layered sand on, the bowl off and the rain) comes through the update with the same sand (the colour table), the same caps and the same picture, drawn by the renderer\'s own bundle, saved as that sand over its own finish, and every other setting as it was: online and offline',
            bad.length === 0, bad.length ? bad.slice(0, 2).join(' || ') : seen.join(', '));
  }
  // control: this tree without the finish's migration (an old save comes up with walnut caps, whatever its material)
  var r2 = await oldSave(browser, T, '1.13.0', 'lapis', T.noFinish.dir);
  r2.MATERIAL_FINISH = 'gold';
  var w2 = oldSaveWrong(r2);
  s.check('OLD SAVES: control: a copy of this tree whose finish is not made from the old material shows Lapis Lazuli over walnut after the update, and the check above fails on it',
          T.noFinish.found === 1 && w2.length > 0 && /the look/.test(w2.join()), 'found ' + T.noFinish.found + '; ' + w2.join(' | '));
}

async function main() {
  var s = new H.Suite('app-upgrade'), browser = null, T = null, why = null;
  try {
    try {
      git(['rev-parse', '--verify', '--quiet', MAIN + '^{commit}']);
      git(['rev-parse', '--verify', '--quiet', BEFORE_R1 + '^{commit}']);
      OLD_RELEASES.forEach(function (o) { git(['rev-parse', '--verify', '--quiet', o[1] + '^{commit}']); });
    } catch (e) {
      why = 'needs ' + MAIN + ', ' + OLD_RELEASES.map(function (o) { return o[1]; }).join(', ') + ' and ' + BEFORE_R1 + ' (git fetch origin main; in a shallow clone, git fetch --unshallow)';
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
    // this tree with one thing undone, for three controls
    T.unchecked = without(T.next.dir, 'unchecked', 'sw.js', '.then(fill).then(sameRelease)', '.then(fill)');
    T.after = release(T.tree, 'after', nextVersion(T.next.version));
    T.varied = without(T.tree, 'varied', 'sw.js', ', ignoreVary: true', '');
    T.plain = without(T.tree, 'plain', 'index.html', LAST_LINES, '');
    T.offlineWords = without(T.tree, 'offline-words', 'app.js', ONLINE_WORDS, '');
    T.old = archive(BEFORE_R1, 'old');
    T.oldWorker = worker(T.old);
    T.oldBad = nextRelease(T.old, 'old-bad', true);
    T.lab = labOtherBuild(copyTree(T.tree, 'lab'));
    T.olds = {};
    OLD_RELEASES.forEach(function (o) { var d = o[1] === MAIN ? T.main : archive(o[1], 'old-' + o[0]); T.olds[o[0]] = { dir: d, version: worker(d).version }; });
    T.noFinish = without(T.tree, 'no-finish', 'app/settings.js', 'from: function (saved, reg) { return reg.finishOf(saved.theme); } }', '}');
    T.oldLab = copyTree(T.tree, 'old-lab');
    fs.rmSync(path.join(T.oldLab, 'lab', 'sand'), { recursive: true, force: true });
    fs.cpSync(path.join(T.old, 'lab', 'sand'), path.join(T.oldLab, 'lab', 'sand'), { recursive: true });
    labOtherBuild(T.oldLab);
    console.log('installing ' + MAIN + ' (' + T.mainWorker.version + '), then ' + argRoot + ' (' + T.worker.version + ', page ' + T.release + '); controls from ' +
                BEFORE_R1 + ' (' + T.oldWorker.version + '); served at ' + HOME);
    serve(T.tree);
    await up();
    browser = await require('playwright').chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-webgl'] });
    var cases = [['UPGRADE', caseUpgrade], ['OVERTAKEN', caseOvertaken], ['VARY', caseVary], ['FAILED INSTALL', caseFailedInstall],
      ['HOLE', caseHole], ['HOLE', caseHoleOwn], ['HOLE', caseHoleOlder], ['LAB', caseLab], ['INTERRUPTED', caseInterrupted], ['OLD SAVES', caseOldSaves]];
    var only = process.argv.indexOf('--only') > 0 ? process.argv[process.argv.indexOf('--only') + 1].toUpperCase() : null;
    for (var i = 0; i < cases.length; i++) {
      if (only && cases[i][0] !== only) continue;
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
