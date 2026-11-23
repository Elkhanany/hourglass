/*!
 * Hourglass — app/settings.js
 * ---------------------------------------------------------------------------
 * The settings store: what the app keeps from one launch to the next, in
 * localStorage under 'hourglass.settings.v1'.
 *
 * One record per saved key, one load, one save. The controller (app.js)
 * holds the loaded values as `settings`, reads and writes them, and calls
 * save() after a change. The store draws nothing, binds no control of
 * today's Tune and applies no value to an engine: that stays in app.js.
 *
 *   A record:
 *     id        the saved key
 *     default   its value on a new install; its type is the setting's type
 *               (a saved value of another type is dropped)
 *     valid     optional, valid(value, reg): false puts the default back
 *               (the default itself need not pass). It does not clamp: a
 *               level saved outside its range comes up as the default, not
 *               as the nearest end
 *     from      optional, from(saved, reg): the value for a save that has no
 *               such key yet (a setting made from older ones). A migration
 *               is keyed on its own key being absent, never on a version,
 *               so that settings can ship in any order (settings design 5.1).
 *               `saved` is the save as it was read, before any type is
 *               checked: a from must stand any value under any key (one
 *               that throws, or gives another type, costs its own key the
 *               default)
 *
 *   HourglassSettings.load(storage, search, reg) -> values
 *       storage   the Storage, or a function that returns it (it is called
 *                 inside the store's own try: where storage is blocked,
 *                 reaching localStorage itself throws)
 *       search    location.search ("?t=300" preselects a duration)
 *       reg       what the checks need: { themes: HourglassPhysics.THEMES }
 *   HourglassSettings.save(values)      to the storage of the last load
 *   HourglassSettings.preset(search)    "?t=300": { durationMs }, else null
 *   HourglassSettings.bindSwitch(el, key, after)   a plain switch of Tune:
 *       it shows the loaded value from then on (so load comes first), and
 *       when it flips the value is set and saved, then after(value) called
 *   HourglassSettings.KEY, .VERSION, .RECORDS, .KEYS (the ids, in the order
 *       they are saved)
 *
 * Nothing is read when this file loads, so the tests load it in Node too.
 * License: GPL-3.0.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var KEY = 'hourglass.settings.v1';
  var has = Object.prototype.hasOwnProperty;

  /*
   * The version step. The settings carry the version they were saved by
   * (`v`). A save of an older version than a step's, or of none, has that
   * step applied, once: load() leaves the newest version in the values, and
   * the next save() writes it. It is used for one thing, and every later
   * migration is a record's `from` (settings design 5.1).
   */
  var STEPS = [
    // Version 2: Real sand on, once. Every launch before 1.10.0 saved realSand: false, so such a
    // save cannot tell "never touched" from "turned off"; from version 2 on, a saved false is
    // the owner's choice.
    { v: 2, run: function (values) { values.realSand = true; } }
  ];

  /* The records, in the order their keys are saved. */
  var RECORDS = [
    { id: 'theme', default: 'sahara',            // the material: a sand and its frame
      valid: function (v, reg) { return !!reg.themes[v]; } },
    { id: 'character', default: 'asmr' },        // the sound's character (app.js checks the name against the sound engine's)
    { id: 'volume', default: 0.8 },
    { id: 'muted', default: false },
    { id: 'chime', default: true },              // the completion bowl
    { id: 'tilt', default: false },              // Real motion
    { id: 'zenFull', default: false },           // Full Zen: the controls hidden completely
    { id: 'haptics', default: true },
    { id: 'keepAwake', default: true },
    { id: 'frame', default: true },              // the caps and posts around the glass
    { id: 'layers', default: false },            // layered sand: two tones that settle into strata
    { id: 'ambience', default: 'none' },         // (app.js checks the name against the sound engine's)
    { id: 'ambienceLevel', default: 0.5 },
    { id: 'breath', default: false },            // breathing pace, and its pattern (app.js checks the name against its own)
    { id: 'breathPattern', default: 'calm' },
    { id: 'durationMs', default: 5 * 60000 },
    { id: 'restMs', default: 0 },                // a work and rest sequence: the rest after each glass (0: none), and how often
    { id: 'rounds', default: 1 },
    { id: 'motionSign', default: 0,              // the accelerometer's sign, once learned (0: not yet)
      valid: function (v) { return v === 1 || v === -1; } },
    { id: 'mendNotes', default: 0 },             // how often the "hold it still to mend" note was shown (the first three cracks)
    { id: 'hintCrack', default: false },         // the one-time "the glass can crack" note was shown
    { id: 'hintZen', default: 0 },               // how often the way back out of Zen has been said (three times at most)
    { id: 'grain', default: 0,                   // the sand's grain: 0 classic, 1 fine (twice the grains), 2 finest (four times)
      valid: function (v) { return v === 1 || v === 2; } },
    { id: 'hintMotion', default: 0 },            // how often the tilt icon has been pointed out (three times at most)
    { id: 'realSand', default: true },           // Real sand: the sand simulated on the graphics chip (off: the classic sand); on by default from 1.10.0
    { id: 'realSandFails', default: 0 },         // launches in a row at which Real sand did not start (it stops trying at 3)
    { id: 'realSandWhy', default: '' },          // ... and why the last one did not (or why this browser cannot have it)
    { id: 'realSandNa', default: '' },           // the user agent of a browser that could not have it: while it is this one, "Needs WebGPU", nothing loaded
    { id: 'realSandNaAt', default: 0 },          // ... and when that was found (ms since 1970): after seven days it is tried again all the same
    { id: 'realSandBuild', default: '' },        // the engine build those three were found with: another build clears them, and it tries again
    { id: 'v', default: 2 }                      // the settings' version (see STEPS)
  ];

  /** "./?t=300" (seconds) preselects a duration; the app's shortcuts use it. { durationMs }, or null. */
  function preset(search) {
    var m = /[?&]t=(\d{1,5})(?:&|$)/.exec(search);
    return m ? { durationMs: +m[1] * 1000 } : null;
  }

  /**
   * The repairs that read two keys: "?t=300" ends a saved sequence; a rest out of range is no
   * rest; without a rest there is one round.
   */
  function repair(values, search) {
    var p = preset(search);
    if (p) { values.durationMs = p.durationMs; values.restMs = 0; }
    values.durationMs = Math.max(10000, Math.min(5999000, values.durationMs));
    if (!(values.restMs >= 10000 && values.restMs <= 3600000)) values.restMs = 0;
    values.rounds = values.restMs ? Math.max(1, Math.min(12, values.rounds | 0)) : 1;
  }

  /**
   * A store over a list of records, the version steps and the repairs (the app's own is
   * HourglassSettings; the tests make others, to try a record's `from` and a step).
   */
  function make(records, steps, repairs) {
    var version = steps.length ? steps[steps.length - 1].v : 0;
    var where = null;                // the storage of the last load (or the function that returns it)
    var current = null;              // the values of the last load
    var keys = [], i;
    for (i = 0; i < records.length; i++) keys.push(records[i].id);

    function storage() { return typeof where === 'function' ? where() : where; }

    function load(st, search, reg) {
      var values = {}, saved, k, r, got, plain;
      where = st;
      for (k = 0; k < records.length; k++) values[records[k].id] = records[k].default;
      try {
        saved = JSON.parse(storage().getItem(KEY) || 'null');
        if (saved) {
          plain = Object.prototype.toString.call(saved) === '[object Object]';
          for (k = 0; k < records.length; k++) {
            r = records[k];
            if (has.call(saved, r.id)) {
              if (typeof saved[r.id] === typeof r.default) values[r.id] = saved[r.id];
            } else if (r.from && plain) {
              got = undefined;
              try { got = r.from(saved, reg); } catch (e2) { /* (this key keeps its default) */ }
              if (typeof got === typeof r.default) values[r.id] = got;
            }
          }
          for (k = 0; k < steps.length; k++) {
            if (!(typeof saved.v === 'number' && saved.v >= steps[k].v)) steps[k].run(values, saved, reg);
          }
        }
      } catch (e) { /* private mode, or a save that cannot be read: run with the defaults */ }
      if (version) values.v = version;                 // (the typed copy above took a saved 1 over the default)
      for (k = 0; k < records.length; k++) {
        r = records[k];
        if (r.valid && !r.valid(values[r.id], reg)) values[r.id] = r.default;
      }
      if (repairs) repairs(values, search, reg);
      current = values;
      return values;
    }

    function save(values) {
      try { storage().setItem(KEY, JSON.stringify(values || current)); } catch (e) {}
    }

    /**
     * A plain switch of Tune. It is set to the loaded value as it is bound (not left as the
     * page's markup has it), so it needs no line of its own at the boot. When it flips, the value
     * is set and saved, and then after(value) is called, in that order and inside the event, so
     * that what must happen within the tap (the iPhone's tick, a permission question) still does.
     */
    function bindSwitch(el, key, after) {
      var k = keys.indexOf(key);
      if (k < 0 || typeof records[k].default !== 'boolean') throw new Error('settings: ' + key + ' is not a switch');
      if (!current) throw new Error('settings: ' + key + ' is bound before the settings are loaded');
      el.checked = !!current[key];
      el.addEventListener('change', function (e) {
        var on = !!e.target.checked;
        current[key] = on;
        save(current);
        if (after) after(on);
      });
    }

    return { KEY: KEY, VERSION: version, RECORDS: records, KEYS: keys, load: load, save: save, preset: preset, bindSwitch: bindSwitch };
  }

  var store = make(RECORDS, STEPS, repair);
  store.make = make;                 // (for the tests: STEPS, repair and make build other stores)
  store.STEPS = STEPS;
  store.repair = repair;
  root.HourglassSettings = store;
})(typeof window !== 'undefined' ? window : globalThis);
