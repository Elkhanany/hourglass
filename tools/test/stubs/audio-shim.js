/*
 * Fills in the new sound API for the browser tests while audio.js's own
 * version has not landed (development only, never shipped). Only what is
 * missing is added, so it is harmless on a merged tree.
 *
 * Every call is recorded in window.__audioShim (counts, and the last
 * arguments), so a test can see that the app called them.
 */
(function () {
  'use strict';
  var A = window.HourglassAudio;
  if (!A) return;
  var rec = window.__audioShim = { counts: {}, last: {}, shimmed: [] };
  var names = ['thump', 'clack', 'creak', 'crack', 'crackGrow', 'chip', 'catchThud',
               'mendHum', 'mended', 'newGlass', 'setCracked'];
  names.forEach(function (name) {
    if (typeof A.prototype[name] === 'function') return;
    rec.counts[name] = 0;
    rec.shimmed.push(name);
    A.prototype[name] = function () {
      rec.counts[name]++;
      rec.last[name] = Array.prototype.slice.call(arguments);
    };
  });
})();
