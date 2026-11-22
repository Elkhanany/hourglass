/*!
 * Hourglass — sw.js
 * Offline-first service worker. Every URL is relative to the worker's own
 * location, so the app installs and runs from any sub-path (for example
 * https://<user>.github.io/hourglass/). License: GPL-3.0.
 */
'use strict';

// Bump on every release: a new name retires the previous cache.
var VERSION = 'hourglass-v1.9.0';

var SHELL = [
  './',
  './index.html',
  './styles.css',
  './physics.js',
  './audio.js',
  './motion.js',
  './app.js',
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
  './realsand/shaders/grains.wgsl'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // bypass the HTTP cache so a fresh install never stores stale files
      return cache.addAll(SHELL.map(function (url) {
        return new Request(url, { cache: 'reload' });
      }));
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

/**
 * Stale-while-revalidate: answer instantly from the cache (works offline),
 * refresh the cached copy in the background for next time.
 */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath) !== 0) return;
  // test pages under lab/ are not part of the app: always from the network,
  // never cached, never answered with the app shell
  if (url.pathname.indexOf(scopePath + 'lab/') === 0) return;
  // The sand engine under realsand/ serves both the app (Real sand: cached with
  // the shell, above) and the sand lab under lab/, which must see a new engine
  // on its next load: a lab page's requests go to the network and are never
  // stored. The page that asked is told by its client (a module imported by
  // another module carries no lab referrer, but the lab page's client id).
  if (url.pathname.indexOf(scopePath + 'realsand/') === 0) {
    event.respondWith(fromLab(event, scopePath).then(function (lab) {
      return lab ? fetch(req) : answer(event, req, url);
    }));
    return;
  }
  event.respondWith(answer(event, req, url));
});

/** Whether the request comes from a page under lab/ (one with no client, or whose client is gone, is the app's). */
function fromLab(event, scopePath) {
  var id = event.clientId;
  if (!id || !self.clients || !self.clients.get) return Promise.resolve(false);
  return self.clients.get(id).then(function (c) {
    return !!c && new URL(c.url).pathname.indexOf(scopePath + 'lab/') === 0;
  }, function () { return false; });
}

/** The app's answer: from the cache at once, refreshed in the background; from the network when not cached. */
function answer(event, req, url) {
  return caches.open(VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          // store without the query string so "./?t=300" maps onto "./"
          var key = req.mode === 'navigate' ? new Request(url.origin + url.pathname) : req;
          cache.put(key, res.clone());
        }
        return res;
      });
      if (hit) {
        event.waitUntil(fresh.catch(function () {}));
        return hit;
      }
      return fresh.catch(function () {
        // offline and not cached: fall back to the app shell for navigations
        if (req.mode === 'navigate') return cache.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    });
  });
}
