/*
 * The settings a test page starts from. Development only, never shipped.
 *
 * Real sand is the app's default (settings design 5.1): a page with nothing saved loads the
 * sand engine, and this Chromium has navigator.gpu but no adapter. So every page a suite opens
 * gets { v: 2, realSand: false } merged UNDER whatever the test seeds in
 * 'hourglass.settings.v1', and the suites go on measuring the classic sand, as before. A test
 * that seeds realSand: true itself gets Real sand. o.rawStorage is written exactly as given,
 * with nothing merged ({} writes nothing: a first launch on a new phone).
 *
 *   var seed = require('./lib/seed.js');
 *   await context.addInitScript(seed.seedOnce, seed.storageFor({ storage: {...} }));
 */
'use strict';

var KEY = 'hourglass.settings.v1';
/** What every test page has saved unless it says otherwise: a version-2 save with Real sand off. */
var CLASSIC = { v: 2, realSand: false };

/** The localStorage to seed for a page opened with o ({ storage, rawStorage }): { key: value }. */
function storageFor(o) {
  o = o || {};
  if (o.rawStorage) return o.rawStorage;
  var st = {}, mine = o.storage || {};
  Object.keys(mine).forEach(function (k) { st[k] = mine[k]; });
  var s = st[KEY];
  if (typeof s === 'string') s = JSON.parse(s);
  st[KEY] = Object.assign({}, CLASSIC, s || {});
  return st;
}

/**
 * The init script (in the page, before its scripts): seeds once per test page, so a reload sees
 * what the app saved itself.
 */
function seedOnce(st) {
  if (sessionStorage.getItem('__seeded')) return;
  sessionStorage.setItem('__seeded', '1');
  for (var k in st) localStorage.setItem(k, typeof st[k] === 'string' ? st[k] : JSON.stringify(st[k]));
}

module.exports = { KEY: KEY, CLASSIC: CLASSIC, storageFor: storageFor, seedOnce: seedOnce };
