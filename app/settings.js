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
 *       reg       what the checks need: { themes, sands, finishes, finishOf, shapes }
 *                 of HourglassPhysics. A saved name is one of a table's only when the
 *                 table has it as its own (hasOwnProperty): a name every object has
 *                 ('toString', '__proto__', 'valueOf' ...) is none, and gives the default
 *   HourglassSettings.save(values)      to the storage of the last load. When that load
 *       could not read the storage (getItem threw), save() first reads it again: while it
 *       still cannot, nothing is written; once it can, a save that is missing or is not JSON
 *       is written as usual, but a save that is there is left as it is for the rest of this
 *       launch (the next launch reads it), so that one failed read never writes the defaults
 *       over the settings
 *   HourglassSettings.preset(search)    "?t=300": { durationMs }, else null
 *   HourglassSettings.unpreset(search)  the same query without its "t=" items, every other
 *       item kept in its order ("?t=45&debug=motion" -> "?debug=motion", "?t=300" -> "")
 *   HourglassSettings.bindSwitch(el, key, after)   a plain switch of Tune:
 *       it shows the loaded value from then on (so load comes first), and
 *       when it flips the value is set and saved, then after(value) called
 *   HourglassSettings.KEY, .VERSION, .RECORDS, .KEYS (the ids, in the order
 *       they are saved)
 *   HourglassSettings.quickOf(text)     the six quick durations: "1,5,10,15,30,60" ->
 *       [1, 5, 10, 15, 30, 60] (minutes), or null when the text is not six of 1 to 99
 *
 * Nothing is read when this file loads, so the tests load it in Node too.
 * License: GPL-3.0-or-later.
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
    // the person's choice.
    { v: 2, run: function (values) { values.realSand = true; } }
  ];

  /* The records, in the order their keys are saved. */
  var RECORDS = [
    { id: 'theme', default: 'sahara',            // the material: a sand and its frame
      valid: function (v, reg) { return has.call(reg.themes, v); } },     // (its own names only: not 'toString', which every object has)
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
    { id: 'v', default: 2 },                     // the settings' version (see STEPS)
    { id: 'tuneTab', default: 'sand',            // the tab of Tune last shown: Tune opens on it
      valid: function (v) { return v === 'glass' || v === 'sound' || v === 'time'; } },
    // From 1.14.0 the sand and the frame's finish are chosen apart. A save from before has only
    // the material (`theme`): its sand is the sand of that name, and its finish that one's caps.
    { id: 'sand', default: 'sahara',             // an id of the sands, or 'custom' (a sand made from sandColor)
      valid: function (v, reg) { return v === 'custom' || (!!reg.sands && has.call(reg.sands, v)); },
      from: function (saved) { return saved.theme; } },
    { id: 'sandColor', default: '',              // the custom sand's colour as it was asked for, "h,s,l" (degrees, then two shares of 1)
      valid: function (v) { return !!colorOf(v); } },
    { id: 'finish', default: 'walnut',           // the frame's finish: an id of the finishes
      valid: function (v, reg) { return !!reg.finishes && has.call(reg.finishes, v); },
      from: function (saved, reg) { return reg.finishOf(saved.theme); } },
    { id: 'shape', default: 'classic',           // the glass's shape: an id of reg.shapes that Tune offers (a shape held back comes up as the classic)
      valid: function (v, reg) { var s = reg && reg.shapes; return !!s && has.call(s, v) && s[v].offered === true; } },
    // The Sound tab's own (settings design 3.3). Every default is the sound as it was before them.
    { id: 'sandLevel', default: 1,               // the sand's own sounds, 0..1 (Tune's "Sand" 0..100); heard as level^1.5
      valid: function (v) { return v >= 0 && v <= 1; } },
    { id: 'bowlLevel', default: 1,               // the completion bowl, 0..2 (Tune's "Bowl" 0..100, 50 the bowl as it was)
      valid: function (v) { return v >= 0 && v <= 2; } },
    { id: 'bowlRings', default: 'once',          // how often the bowl rings at the end: once, three times, or until a tap
      valid: function (v) { return v === 'three' || v === 'tap'; } },
    { id: 'ambFade', default: 0,                 // the ambience fades out over the glass's last stretch (ms): 0 off, or 1, 5 or 10 minutes
      valid: function (v) { return v === 60000 || v === 300000 || v === 600000; } },
    { id: 'silentRing', default: true },         // sound with the ringer switched off (the page's audio session 'playback'); off: 'ambient'
    // The Time tab: the six durations under the glass, set in the Time tab, and when the running glass ends.
    { id: 'quick', default: '1,5,10,15,30,60',   // the six quick durations, in whole minutes, in the order they were set (one bad: all six the default)
      valid: function (v) { return !!quickOf(v); } },
    { id: 'endsAt', default: false },            // the state line says when the running glass ends: "Flowing · ends 14:35"
    // The background (Tune's Glass tab, and the moon button): 'dark' as the app has always been,
    // 'light' on paper white, 'system' as the device's own light or dark setting, 'hours' light
    // from 7:00 to 19:00 by the device's clock and dark at night. A save from before it is dark.
    { id: 'background', default: 'dark',
      valid: function (v) { return v === 'light' || v === 'system' || v === 'hours'; } },
    // How the sand is lit (Tune's Sand tab, "Light"): 'sunlit', one key light from the upper left, as the
    // app comes from 1.21.0 (a save from before it has none, and is sunlit too); 'soft', the even light of before.
    { id: 'sandLight', default: 'sunlit',
      valid: function (v) { return v === 'soft'; } }
  ];

  /**
   * The six quick durations as they are kept, "1,5,10,15,30,60": [1, 5, 10, 15, 30, 60], or null
   * when the text is not six whole minute counts from 1 to 99 (written plainly: no "05", no "1.0").
   * Two may be the same number.
   */
  function quickOf(text) {
    if (typeof text !== 'string' || !/^[1-9]\d?(,[1-9]\d?){5}$/.test(text)) return null;
    return text.split(',').map(Number);
  }

  /** A custom sand's colour as it is kept, "h,s,l": { h, s, l }, or null when the text is not one. */
  function colorOf(text) {
    var m = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(text);
    return m && +m[1] < 360 && +m[2] <= 1 && +m[3] <= 1 ? { h: +m[1], s: +m[2], l: +m[3] } : null;
  }

  /** "./?t=300" (seconds) preselects a duration; the app's shortcuts use it. { durationMs }, or null. */
  function preset(search) {
    var m = /[?&]t=(\d{1,5})(?:&|$)/.exec(search);
    return m ? { durationMs: +m[1] * 1000 } : null;
  }
  /** The query without the preset: what is left once it has been applied (app.js puts it in the address). */
  function unpreset(search) {
    var re = /([?&])t=\d{1,5}(&|$)/, m;
    while ((m = re.exec(search))) search = search.slice(0, m.index) + (m[2] ? m[1] : '') + search.slice(m.index + m[0].length);
    return search === '?' ? '' : search;
  }

  /**
   * The repairs that read two keys: "?t=300" ends a saved sequence; a rest out of range is no
   * rest; without a rest there is one round. The custom sand without a colour is the material's
   * sand. (The material, `theme`, is kept as it was saved: app.js sets it with the sand while
   * that is one of the six.)
   */
  function repair(values, search, reg) {
    var p = preset(search);
    if (p) { values.durationMs = p.durationMs; values.restMs = 0; }
    values.durationMs = Math.max(10000, Math.min(5999000, values.durationMs));
    if (!(values.restMs >= 10000 && values.restMs <= 3600000)) values.restMs = 0;
    values.rounds = values.restMs ? Math.max(1, Math.min(12, values.rounds | 0)) : 1;
    if (values.sand === 'custom' && !colorOf(values.sandColor)) values.sand = reg && reg.sands && has.call(reg.sands, values.theme) ? values.theme : 'sahara';
  }

  /**
   * A store over a list of records, the version steps and the repairs (the app's own is
   * HourglassSettings; the tests make others, to try a record's `from` and a step).
   */
  function make(records, steps, repairs) {
    var version = steps.length ? steps[steps.length - 1].v : 0;
    var where = null;                // the storage of the last load (or the function that returns it)
    var current = null;              // the values of the last load
    var guard = '';                  // '' as usual; 'unread': the last load could not read the storage; 'kept': a save is there that it could not read, left alone
    var keys = [], i;
    for (i = 0; i < records.length; i++) keys.push(records[i].id);

    function storage() { return typeof where === 'function' ? where() : where; }

    function load(st, search, reg) {
      var values = {}, saved, k, r, got, plain, text;
      where = st;
      guard = 'unread';
      for (k = 0; k < records.length; k++) values[records[k].id] = records[k].default;
      try {
        text = storage().getItem(KEY);
        guard = '';
        saved = JSON.parse(text || 'null');
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
      var st, text, kept;
      try {
        st = storage();
        if (guard === 'unread') {          // the load could not read: read again before anything is written
          text = st.getItem(KEY);
          try { kept = Object.prototype.toString.call(JSON.parse(text)) === '[object Object]'; } catch (e2) { kept = false; }
          guard = kept ? 'kept' : '';
        }
        if (guard === 'kept') return;      // (a save is there: this launch leaves it as it is)
        st.setItem(KEY, JSON.stringify(values || current));
      } catch (e) {}
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
  store.colorOf = colorOf;
  store.quickOf = quickOf;
  store.unpreset = unpreset;
  root.HourglassSettings = store;
})(typeof window !== 'undefined' ? window : globalThis);
