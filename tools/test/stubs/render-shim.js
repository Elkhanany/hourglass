/*
 * Fills in the renderer's damage and spill API for the browser tests while
 * the renderer's own version has not landed (development only, never
 * shipped). Only what is missing is added, so it is harmless on a merged
 * tree: there the real methods stay.
 *
 *   Renderer: syncDamage, damageEvent, setMend, chipVessel, animating, reduced
 *   HourglassPhysics.Spill: layout, add, step, draw, clear, active, count, landed
 *
 * Every call is counted in window.__renderShim, so a test can see that the
 * app called them.
 */
(function () {
  'use strict';
  var P = window.HourglassPhysics;
  if (!P) return;
  var calls = window.__renderShim = { syncDamage: 0, damageEvent: 0, setMend: 0, chipVessel: 0, spillAdd: 0, mend: 0, shimmed: [] };
  var R = P.Renderer.prototype;
  function fill(obj, name, fn, label) {
    if (typeof obj[name] === 'function') return;
    obj[name] = fn;
    calls.shimmed.push(label || name);
  }
  fill(R, 'syncDamage', function () { calls.syncDamage++; return false; });
  fill(R, 'damageEvent', function () { calls.damageEvent++; });
  fill(R, 'setMend', function (p) { calls.setMend++; calls.mend = +p || 0; });
  fill(R, 'chipVessel', function (k, out) {
    calls.chipVessel++;
    var cr = this.sim.cracks && this.sim.cracks[k];
    if (!cr) return null;
    out = out || {};
    out.x = cr.x + 0.5; out.y = cr.y + 0.5;
    return out;
  });
  if (!('animating' in R)) R.animating = false;
  if (!('reduced' in R)) R.reduced = false;

  if (typeof P.Spill !== 'function') {
    var Spill = function (canvas, renderer) {
      this.canvas = canvas; this.renderer = renderer;
      this.active = false; this.count = 0; this.landed = 0;
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    };
    Spill.prototype.layout = function () {};
    Spill.prototype.add = function () { calls.spillAdd++; };
    Spill.prototype.step = function () { this.landed = 0; this.active = false; };
    Spill.prototype.draw = function () {};
    Spill.prototype.clear = function () { this.count = 0; this.active = false; };
    P.Spill = Spill;
    calls.shimmed.push('Spill');
  }
})();
