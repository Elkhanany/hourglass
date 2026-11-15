/*!
 * Hourglass — sw.js
 * Offline-first service worker. Every URL is relative to the worker's own
 * location, so the app installs and runs from any sub-path (for example
 * https://<user>.github.io/hourglass/). License: GPL-3.0.
 */
'use strict';

// Bump on every release: a new name retires the previous cache.
var VERSION = 'hourglass-v1.5.1';

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
  './icons/apple-touch-icon.png'
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

  event.respondWith(
    caches.open(VERSION).then(function (cache) {
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
    })
  );
});
