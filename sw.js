/*!
 * Hourglass — sw.js
 * Offline-first service worker. An installed copy is a snapshot: only an
 * install writes the app's files (SHELL), all of them or none, and keeps them
 * only if the server still has this release when the last one is in. The app
 * is answered from them alone, so an installed copy holds one release. (The
 * one launch that can mix two: a file missing from the copy, answered from a
 * server that has moved on; see answer.)
 * Every URL is relative to the worker's own location, so the app installs and
 * runs from any sub-path (for example https://<user>.github.io/hourglass/).
 * License: GPL-3.0-or-later.
 */
'use strict';

// Bump on every release: a new name retires the previous cache.
var VERSION = 'hourglass-v1.20.1';

// The app's files: what an install caches, whole, and what the app is answered from. index.html's
// <meta name="hourglass-version"> says the same release as VERSION (check-release); every file the
// page or the manifest names is here (check-shell), and so is every file of the engine (realsand-shell).
var SHELL = [
  // the page
  './',
  './index.html',
  './styles.css',
  // its scripts, in index.html's order
  './glass/shapes.js',
  './sand/sim.js',
  './sand/sands.js',
  './glass/gl.js',
  './glass/renderer.js',
  './glass/cracks.js',
  './glass/spill.js',
  './sound/audio.js',
  './motion/motion.js',
  './app/settings.js',
  './app.js',
  // the manifest and the icons
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  // Real sand (Tune): the sand engine the app loads when the switch is on, installed with the
  // rest so that it works offline; a Node test (realsand-shell) checks that every path here
  // exists and that every module and shader the engine loads is here
  './realsand/boot.mjs',
  './realsand/app-sand.mjs',
  './realsand/build.mjs',
  './realsand/felt.mjs',
  './realsand/fill.mjs',
  './realsand/glass.mjs',
  './realsand/grains.mjs',
  './realsand/layers.mjs',
  './realsand/modes.mjs',
  './realsand/pace.mjs',
  './realsand/palette.mjs',
  './realsand/rate.mjs',
  './realsand/solver.mjs',
  './realsand/valve.mjs',
  './realsand/LICENSES.md',
  './realsand/shaders/common.inc.wgsl',
  './realsand/shaders/domain.inc.wgsl',
  './realsand/shaders/prepare.wgsl',
  './realsand/shaders/bukkitCount.wgsl',
  './realsand/shaders/bukkitAllocate.wgsl',
  './realsand/shaders/bukkitInsert.wgsl',
  './realsand/shaders/gridClear.wgsl',
  './realsand/shaders/gridUpdate.wgsl',
  './realsand/shaders/g2p2g.wgsl',
  './realsand/shaders/load.wgsl',
  './realsand/shaders/rescale.wgsl',
  './realsand/shaders/spreadSplat.wgsl',
  './realsand/shaders/spreadShift.wgsl',
  './realsand/shaders/tally.wgsl',
  './realsand/shaders/flip.wgsl',
  './realsand/shaders/grains.wgsl',
  './realsand/shaders/relief.wgsl',
  './realsand/shaders/tone.wgsl'
];

// Folders under the scope with rules of their own (relative to the scope):
// - NETWORK_ONLY: not the app (the sand lab's pages): always from the network, never stored,
//   never answered with the app's page;
// - LAB_SHARED: files of the app that a lab page uses too (the sand engine). The app is answered
//   from its cache, as for every SHELL path; a lab page's requests go to the network and are never
//   stored, so the lab sees a new engine on its next load. The page that asked is told by its
//   client (a module imported by another module carries no lab referrer, but the lab page's
//   client id).
var NETWORK_ONLY = ['lab/'];
var LAB_SHARED = ['realsand/'];

/** Put every file of SHELL in `cache`, from the server, not the HTTP cache: all of them, or none. */
function fill(cache) {
  return cache.addAll(SHELL.map(function (url) {
    return new Request(url, { cache: 'reload' });
  }));
}

/** The release the server has now: the VERSION its sw.js names (null if it names none). */
function served() {
  return fetch(self.location.href, { cache: 'no-store' }).then(function (res) {
    if (!res.ok) throw new Error('sw.js: ' + res.status);
    return res.text();
  }).then(function (text) {
    var m = /\bVERSION\s*=\s*'([^']+)'/.exec(text);
    return m ? m[1] : null;
  });
}

/**
 * The files are in: the server must still have this release. A deploy that came while they
 * were downloaded leaves files of two releases in the cache, and such a copy is not kept: the
 * install fails, and the browser finds the newer release at its next look.
 */
function sameRelease() {
  return served().then(function (v) {
    if (v !== VERSION) throw new Error('the server has ' + v + ' now, not ' + VERSION);
  });
}

// An install writes this release's cache, whole, and keeps it only if the server has not moved
// on meanwhile (sameRelease). One that fails leaves nothing of its own behind: it deletes the
// cache only if it made it (a cache that was there already is this release's live copy, when an
// install runs again under the same VERSION), and the release that is installed keeps running,
// whole.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.has(VERSION).then(function (existed) {
      return caches.open(VERSION).then(fill).then(sameRelease).catch(function (err) {
        return (existed ? Promise.resolve() : caches.delete(VERSION)).then(function () { throw err; });
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf('hourglass-') === 0 && key !== VERSION) return caches.delete(key);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// The page asks which release this worker serves (Tune's version line): { type: 'version' }, with
// a port for the answer, { version: VERSION }. (v1.9.0 has no such handler: a page that gets no
// answer says its offline copy is not installed yet.)
self.addEventListener('message', function (event) {
  var d = event.data, port = event.ports && event.ports[0];
  if (d && d.type === 'version' && port) port.postMessage({ version: VERSION });
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath) !== 0) return;
  if (under(NETWORK_ONLY, url, scopePath)) return;
  if (under(LAB_SHARED, url, scopePath)) {
    event.respondWith(fromLab(event, scopePath).then(function (lab) {
      return lab ? fetch(req) : answer(event, req, url);
    }));
    return;
  }
  event.respondWith(answer(event, req, url));
});

/** Whether the URL is under one of the folders of `list` (relative to the scope). */
function under(list, url, scopePath) {
  for (var i = 0; i < list.length; i++) if (url.pathname.indexOf(scopePath + list[i]) === 0) return true;
  return false;
}

var shellPaths = null;               // the pathnames of SHELL, made at the first request
/** Whether the URL is a file of the app (a SHELL path; a navigation to the scope is './'). */
function inShell(url) {
  if (!shellPaths) {
    shellPaths = {};
    SHELL.forEach(function (u) { shellPaths[new URL(u, self.location.href).pathname] = true; });
  }
  return shellPaths.hasOwnProperty(url.pathname);
}

/** Whether the request comes from a page under lab/ (one with no client, or whose client is gone, is the app's). */
function fromLab(event, scopePath) {
  var id = event.clientId;
  if (!id || !self.clients || !self.clients.get) return Promise.resolve(false);
  return self.clients.get(id).then(function (c) {
    return !!c && new URL(c.url).pathname.indexOf(scopePath + 'lab/') === 0;
  }, function () { return false; });
}

/**
 * The app's answer.
 * - A file of the app: from this release's cache only, never refreshed in the background (only an
 *   install writes it). Should it be missing there (a hole), it comes from the network, and the
 *   cache is filled again, whole, but only from this same release (repair). If the server has
 *   another release by then, that one launch runs a file of it beside this release's.
 *   The entries are this release's own files, whatever the server's Vary header says of them
 *   (ignoreVary): a lookup that missed for it would miss again at every launch, since nothing
 *   but an install writes the cache.
 * - Anything else under the scope (the launch screens, the manifest's screenshots): from the
 *   cache at once, refreshed in the background for next time; from the network when not cached.
 * Offline and not cached, a navigation gets the app's page, and anything else a 504.
 */
function answer(event, req, url) {
  return caches.match(req, { cacheName: VERSION, ignoreSearch: true, ignoreVary: true }).then(function (hit) {
    if (inShell(url)) {
      if (hit) return hit;
      event.waitUntil(repair());
      return fetch(req).catch(function () { return offline(req); });
    }
    var fresh = fetch(req).then(function (res) {
      if (!res || !res.ok || res.type !== 'basic') return res;
      // stored without the query string, so that "./?t=300" maps onto "./"
      var key = req.mode === 'navigate' ? new Request(url.origin + url.pathname) : req, copy = res.clone();
      return caches.open(VERSION).then(function (cache) { return cache.put(key, copy); })
        .then(function () { return res; }, function () { return res; });
    });
    if (hit) {
      event.waitUntil(fresh.catch(function () {}));
      return hit;
    }
    return fresh.catch(function () { return offline(req); });
  });
}

/** Offline, and not in the cache: the app's page for a navigation, a 504 for anything else. */
function offline(req) {
  if (req.mode === 'navigate') return caches.match('./index.html', { cacheName: VERSION, ignoreVary: true });
  return new Response('', { status: 504, statusText: 'Offline' });
}

/**
 * Fill this release's cache again, whole, if the server still serves this release (its sw.js
 * names this VERSION). If it serves another, look for that one now: its install fills a cache
 * of its own. One repair at a time; offline, or should a file fail, nothing changes.
 */
var repairing = null;
function repair() {
  if (repairing) return repairing;
  repairing = served().then(function (v) {
    if (v !== VERSION) return self.registration.update();
    return caches.open(VERSION).then(fill);
  }).catch(function () {}).then(function () { repairing = null; });
  return repairing;
}
