# Tests

Development-only tests live in `tools/test` and are not part of the app (the
service worker does not cache them). They need Node 22 and Playwright with
Chromium:

```bash
npm install && npx playwright install chromium
npm test                       # every suite, one line each (about 45 minutes)
npm run test:physics           # the simulation only, in Node (about 3 minutes)
node tools/test/app-gestures.test.js     # any single suite
node tools/test/run-all.js --port 8900   # every suite on one port, one after another
node tools/test/run-all.js realsand-gpu  # Real sand on WebGPU in software (only when named)
node tools/test/run-all.js check-        # the check group, in Node, in seconds
```

- `check-*`: the check group, in Node, in seconds, each rule with a control
  that must fail. `check-shell`: every file `index.html` (a name without
  quotes too), its stylesheet (`url()`, `@import`) and the manifest name
  exists and is in the service worker's `SHELL` (the launch screens and the
  install screenshots excepted from `SHELL`), the page's one inline script (the
  "Hourglass is updating" note) is held to the same syntax rule as the files,
  every `SHELL` path exists, once, and no classic script (the page's and
  `sw.js`) has module syntax, `import()` or any of the kinds of syntax newer
  than ES5 that the check lists (`=>`, `let`, `const`, template strings,
  `class`, `?.`, `??`, `async`, `await`, for-of, `...`, `**`, generators,
  default and destructured parameters, shorthand methods). It scans line by
  line and is not a parser: shorthand properties, computed keys and a
  destructuring assignment are not seen. And whichever of the page's scripts
  is missing from the copy, `app.js` says the page is updating instead of
  throwing (the scripts are run in the page's order, in a bare context, with
  each one left out). `check-licences`: every file under `realsand/`
  and `lab/sand/` is in `realsand/LICENSES.md`, every file the table
  names exists, and a file of the page (the root's, and the scripts
  `index.html` loads wherever they live) or the lab that states the project's
  licence says GPL-3.0-or-later. `check-release`: a branch that changes a shipped file
  (`sw.js` or a path of its `SHELL`) raises `VERSION` above both the
  merge-base's and `origin/main`'s, as a version number, and `index.html`
  has its `hourglass-version` meta, equal to it; and the `VERSION` an
  installed copy reads from the server's `sw.js` (the worker's own
  `served()`, taken from `sw.js` and run on its text) is the one running
  `sw.js` gives (copies with the line in double quotes, with a comment above
  it naming another `VERSION`, or with the value built from parts must
  fail); it needs `origin/main` (`HOURGLASS_MAIN=<ref>` names another). `check-harness`: the test guards
  themselves: `tools/test/lib/paths.js` reads the page's scripts from
  `index.html`, a suite that still reads one `physics.js` fails at once, the
  browser harness refuses a tree that lacks a script the page loads, naming
  it, `run-all.js` fails when its filter matches no suite, and every suite
  that needs no browser is either in GitHub's list or in the check's own
  list of the eight left to a run by hand.
  `check-registry`: the sound cards of `index.html` and the
  registry of `sound/audio.js` say the same (the ids, names and icons of
  `HourglassAudio.characters()` and `.ambiences()`, in order, each card a
  choice of its group); a character, an ambience or a glass shape that is
  not whole is refused by name (`defineCharacter`, `defineAmbience`,
  `addShape`), and so is one with a field nothing reads, which is a field
  misspelt (the fields the records hold are pinned to the fields a record
  may); and the shapes of `glass/shapes.js` are whole records that
  `checkShape` finds nothing wrong with.
  `check-pieces`: the seven pieces of `HourglassPhysics` (`glass/` and
  `sand/`, in the order `index.html` loads them) fit together. Each piece's
  top-level names are found exactly (its text run without its wrapper in a
  fresh context, with Node's `vm`, no parser); every name it uses that
  another piece declares (comments, strings and regular expressions blanked,
  a name after `.` and an object key left out) must be in its import line,
  and every import must be exported, on the same `P` or `_`, by a piece
  loaded before it; every export is a name the piece declares; and each
  piece says it ran and, but the first, waits for the one before it, which
  is also run: with each piece left out in turn, no piece after it adds a
  name. A failure names the piece, the name and the line. Its controls: an
  import line without one name, the pieces in reverse order, an import from
  the wrong namespace, an export of a name not declared, a name read in code
  but only named in a comment or a string, a piece that does not wait and
  one that does not say it ran.
- On GitHub, every pull request and every push to `main` runs the check
  group and the Node suites that take seconds (`.github/workflows/checks.yml`
  lists them; about three minutes, no browser and no `npm install`). The
  browser suites, the longer Node suites (`replay-phone`, `sim-conservation`,
  `sim-fracture`, `sim-shape`, `sim-grain`, `sim-repose`, `sim-tone`,
  `sim-perf`) and `realsand-gpu` are run by hand, as above, and their
  results go in the pull request (`.github/pull_request_template.md`).
- `settings-unit`, `app-boot-trace` and `app-tune-trace` hold the settings
  store (`app/settings.js`), and whatever is built on it, each against a
  file kept in `tools/test/base/` (see
  [the architecture](architecture.md#appsettingsjs)): `settings-unit` to
  the app before the store, the two traces to their reviewed record. `settings-unit`, in
  Node, in a moment: the records are well formed, and the first 31 are the
  old settings' keys and defaults in their order; the old Settings section
  of `app.js`, kept byte for byte, and the store give the same on 500 saved
  states (keys missing, wrong types, values out of range, saves that are not
  JSON, `?t=` queries, with and without a version, storage that throws): the
  same settings in the same order, the same saved JSON byte for byte, the
  same calls on storage, and the same again on a second launch, and nine
  stores that differ in one thing each are found out; but for the
  differences made on purpose, each held as the store must give it: a saved
  theme that is a name every object has (each own name of
  `Object.prototype`, each a case), which the old section kept, is the
  default material (and a store that checks it the old way must fail); where
  `getItem` throws, the old section saved the defaults over the save, and
  the store reads again and writes nothing (one failed read at the launch,
  with writing working, keeps the save through every save of that launch,
  and a copy of the store that writes without reading again must fail);
  each of those names, saved as the theme, the sand, the finish or the
  shape, comes up and is saved as the default (copies that look the theme,
  the sand or the finish up the loose way must fail); the Settings section
  `app.js` has today (the lines that call the store, cut by its banners and
  run as `app.js` runs them) gives the same on the 500 too, and five copies
  of it with one thing changed are found out (the Storage handed over itself,
  which a blocked storage then throws from; the preset asked without the
  query); a record added after the old 31 is left out of the comparison, so
  a new setting changes nothing here, and one put among them is found out;
  the Sound tab's five keys (the five records after the shape, in their
  order, the sound as it was by default; saves of 1.13.0, 1.10.0 and 1.15.1
  come up with them and every other value as saved; each value of their
  range kept, 28 out of it or of the wrong type and a name every object has
  as the rings the default; seven stores with one thing wrong in them found
  out); the version step (Real sand on, once, for a save from before version 2); a
  record's `from` and the steps' order, on a made-up store, and an example
  for every `from` the app has, which must come up with something other
  than the default; the Time tab's two records (`quick` then `endsAt`,
  right after the Sound tab's five, "1,5,10,15,30,60" and
  false by default, followed only by the background and the sand's light): saves of
  1.13.0, 1.10.0 and 1.15.0 come up with both defaults and every other
  setting as they give them, good sets of six (two the same, all 99) are
  kept, and eighteen bad ones (five or seven counts, a nought, 100, a
  fraction, "01", letters, spaces, not a string) are the default six as a
  whole, and are saved so (a store that keeps any string, one that keeps a
  set with bad counts in it, one with the two the other way round, one
  whose switch is on by default and one with the two before the Sound tab's
  five must fail); the sand's light (`sandLight`, the last record, after
  the background, 'sunlit' by default: saves of 1.13.0, 1.10.0 and 1.20.0
  come up sunlit with every other setting as they give them, 'soft' is
  kept, eight other values are sunlit and saved so; a store that keeps any
  value, one that is soft by default and one with it before the background
  must fail); the names (every `settings.…` in `app.js` is a record,
  every record but the version is named there, none is read by a computed
  name); `bindSwitch` (the loaded value shown as it binds; then set, save
  and the callback inside the event); and that the file reads nothing when
  it loads. `app-boot-trace`, in the browser: what the app
  reads, saves and calls on the Sim, the Renderer, the sound engine and the
  sensors as it starts, in order, for six saved states (nothing saved; a
  save from before version 2 with everything changed; Real motion left on; a
  damaged save; `?t=45` over a saved sequence; a glass in the Delta shape); a copy of `app.js` that gives
  the sound engine `muted` before `volume` must fail. `app-tune-trace`: what
  each of the controls that change a setting (the ten sands, the custom
  sand's colour well, the six finishes and the glass shapes among them; the
  suite's check "the controls driven are the kept trace's" says how many)
  saves, calls and buzzes in its own tap, and what follows it (what the cross-fade sets, the answer to
  the motion question, the boot after the reload a grain makes); a copy of
  `app.js` whose completion bowl saves after it has told the sound engine,
  and whose Haptics switch has lost its buzz, must fail at those. Every
  switch, choice and slider of Tune's sheet must be one the trace drives
  (`DRIVE` in `tools/test/lib/trace.js`), so a control added to Tune and not
  to the driver fails instead of going untraced; a copy of the page with one
  switch more must be found out. The two kept traces are the reviewed
  record of the tree named in each file's `from`, not a recording of the
  app before the store: run with `--write`, a trace suite writes its file
  from the tree just run, and that is how a setting or a control added on
  purpose gets its new trace, in a commit of its own that says what changed
  and nothing else (the new key in the saves, the new control's lines),
  whose diff is read. Run with `--base <commit>` (or
  `HOURGLASS_BASE=<commit>`), a trace suite also runs that commit's tree and
  prints how it differs from the kept trace, as a report for whoever makes
  a trace again; it passes and fails nothing, since an older commit cannot
  have the keys and controls added since. `settings-unit --base <commit>`
  is its own: the kept section must be that commit's (with `--write`, it is
  written from it). The kept Settings
  section is the app before the store (release 1.10.0's, with its 31 keys,
  which release 1.11.0 kept byte for byte): a setting added to the store is
  not added to it, and it is not made again. The two traces were first made from
  release 1.11.0, whose new engine build (6) is in their saves, made again
  (`--write`) from the tree that joined it with the new Tune (release
  1.13.0), and made again for release 1.14.0, the sand and the frame's
  finish chosen apart: the keys `sand`, `sandColor` and `finish` at the end
  of every full save, the six material cards' lines replaced by those of the
  ten sands, the custom sand's colour well (a colour let go: `input`, then
  `change`) and the six finishes, and the chip's line by the sand chip's.
  Every other control's entry is as it was but for the boot after a reload
  at the end of the walk, which now draws Volcanic Black over walnut (the
  chip steps the sands alone) with `setLook` where it drew the volcanic
  bundle. The trace's recorder writes a small record of plain values (the
  look handed to `setLook`) as it is, where it wrote "(an object)". They
  were made again (`--write`) from the tree that joined that release with
  the glass shapes (release 1.15.0): against the sands release's files they
  differ only in the key `shape` at the end of every full save, the build
  stamp 7 for 6, the sixth boot (a save in the delta shape) and the lines of
  the nine shape controls; against the shapes' files, only in what the sands
  release brought, as above. The Tune trace was made again for release
  1.15.1, the reset link's two taps moved from the start of the walk (where
  nothing differed from the defaults, and its save was empty) to just before
  Real sand: its entries now save the sand, the volume and the ambience
  level put back and tell the sound engine, and the Real sand boot that
  follows, and the last save, draw and hold Sahara Quartz at the default
  volume and level; no other entry changed. The Tune trace was made again
  for release 1.16.0, which offers Trumpet and Florence: two new entries,
  each shape looked at, between Ampoule and Onion, and nothing else. Both
  traces were made again for release 1.17.0, the Sound tab's and the Time
  tab's settings: seven keys at the end of every full save (`sandLevel`,
  `bowlLevel`, `bowlRings`, `ambFade`, `silentRing`, `quick`, `endsAt`); in
  the Tune trace, 28 new entries (the Sand level, the fade before the end
  and its three lengths, the three Rings, the Bowl level, Sound in silent
  mode; the six quick durations with the dial, Show when it ends), and the
  reset link's second tap, whose save now also puts back the Sand and Bowl
  levels, Rings and the fade, and which tells the sound engine those two
  levels; no other entry changed. Both were made again for release 1.19.0,
  the background: the key `background` ('dark') at the end of every full
  save; in every boot one read of the settings more, first (index.html's
  early script, which puts the light or dark look on the page before its
  first paint); in the Tune trace five new entries (the background Light,
  Device, Daytime and Dark, and the moon button), and the reset link's second
  tap, whose save also puts back the background and which tells the renderer
  the dark look (`setPaper`); and the boots after the five reloads of the
  walk between the moon button and the reset (two shapes used, the three
  grains), which now open in the light look the button left (`setPaper`
  true); no other entry changed. `renderer.setPaper` is one of the calls a
  setting causes (kept after the boot, as `setTheme` is). Both were made
  again for release 1.20.0, engine build 8: the stamp "8" for "7" wherever a
  boot saves it, and in the sixth boot (a save of build 7's stamp, now an
  earlier build's) one save more at its end, the new stamp; no other entry
  changed. Both were made again for release 1.21.0, the sand's light and
  engine build 9: the key `sandLight` ('sunlit') at the end of every full
  save and the stamp "9" for "8"; in every boot `renderer.setSandLight`
  after `setFrame` and `renderer.prepareSun` before `layout` (a boot in the
  light look one `setSandLight` more after `setPaper`); in the Tune trace
  two new entries (Light: Soft and Sunlit), and one `renderer.drawGlass`
  more at each change of look and at the reset link's second tap (the glass
  drawn at the fade's start); no other entry changed. A traced page is at
  noon (the recorder sets the hour of `new Date()`), so Daytime traces the
  same at any hour of the run.
  The two traces use three ports: the suite's own and the next two.
- `sim-*`: the simulation, in Node. `sim-identity` runs it side by side with
  the version before motion (f446085, read from git) and checks that, with
  nothing moving, every grain lands exactly as before. `sim-tone` covers
  layered sand: the fill's pattern, its own for every seed and the same for
  the same one; each tone's count through an idle run, a flip, a spin,
  shaking, a cracking tumble, a leaking breach, pours and a fast-forward; the
  sand falling identically with layers on and off; the heap settling into
  strata; turned sand settling into a new pattern each time, not a blend; the
  colour table with layers off against 7f71786. `sim-repose` covers sand off
  the upright: repose at held leans, a slow steady tilt followed as it
  comes (and waited out, then rushed, by the sand as first shipped), a
  running glass tilted from straight or picked up, which gives nothing up in
  bulk as it leaves the upright (and did), the slump after the Flip, falling sand
  gathering speed, a bed's momentum under a jolt and a finger's carry, the
  thread in the air, shaking against walking, the timer while leaned and to
  its end, the census and each tone's count; every case that can is also run
  with `granular: false`, which must fail it. `sim-identity`'s lean and
  scripted-flip cases pin the engine with `granular: false`; its upright
  cases run with it on. `sim-grain` covers finer sand: Fine and Finest
  against the classic sand in the clock, the thread, the settling after a
  Flip and a lean, and the first crack, and that `setPace(1)` puts every
  constant back. (`HOURGLASS_PACE=2 node tools/test/sim-fracture.test.js`
  runs any `sim-*` suite on finer sand; what a suite counts in cells or in
  grains then comes out larger.) `sim-shape` covers other glass shapes
  (`HourglassPhysics.SHAPES`; Tune offers those whose record says so): for every
  registered shape, the classic teardrop first as the reference, what the
  sand needs of the lattice at every size the app builds, the clock of a
  one-minute glass upright, leaned 12 degrees and on Finest sand, the fullest
  glass fitting under the neck, the Flip, pours that fill it to exactly its
  cap, layered sand, a hard shake that must never write sand into the glass,
  and going quiet after hard jerks; and that glasses the sand cannot use are
  refused by name, each by its own rule. It also holds the registry to its
  rules: the records (the classic first, which shapes Tune may offer),
  `addShape` taking a whole record and refusing one that is not, and
  `checkShape` saying what a Sim would refuse a glass with, without building
  one, at the pace it is asked for.
  (`HOURGLASS_SHAPE=delta node tools/test/sim-clock.test.js` runs any `sim-*`
  suite on another shape; many state what the teardrop does, so some of
  their cases then fail without anything being wrong.) The
  others cover cracks, leaks, mending and saving (`p0`), conservation,
  sanity, flight, fracture, spinning, knocking, leak, flip, persistence,
  determinism, the valve, the clock and performance.
- `render-*`: the crack paths, their redraw and the spilled sand's physics in
  Node; cracks, their glint, kintsugi and the spill in the real app; and,
  with no cracks, the picture against f446085, pixel for pixel (a Renderer
  as it comes draws the sand Soft, so that comparison is Soft's).
  `render-unit` also holds the sunlit sand (Tune's Light), in Node (and its
  frame of a swap: in the app's own order, the sand drawn before the glass,
  the lit flank stays on the screen's left in the frame the lattice is
  turned end for end, when `drawSand` is given the glass's angle of that
  frame; lit by the angle the glass was last drawn at, the control, the
  shaded side is lit for that frame): on a
  still, symmetric heap the left flank (toward the key) has at least 2.2
  times the right's mean relative luminance in either look (measured 2.6), and with the glass turned over the lit flank is the one on
  the screen's left (controls: the same heap drawn Soft, about 1 : 1, and a
  key that does not turn back with the glass); Soft draws the sand's buffer
  and the bloom byte for byte as 19c84db (release 1.20.0) did, three running
  glasses (upright, turned over, leaned), in the dark look; in the light look
  the same with no grain in the air (the beds of a sand that is not pale),
  while the grains in the air are drawn anew and Moonstone's beds are deeper
  in the light look only; hashed against that commit's own pieces
  (`HOURGLASS_SOFT_BASE` names another; control: the same frames drawn
  Sunlit differ); the tables are made once per shape, again on a change of
  look or sand and on each frame of a fade, again for the light on a turn of
  0.01 rad and not below, and never on a still frame (control: a look made
  anew every frame is counted), and `prepareSun` makes the shape's and the
  look's before the first frame, which then draws the same picture (control:
  the first frame without it builds them); and no pixel of sand, sunlit, lies outside
  the glass's edge on any shape, upright, turned over and leaned, in both
  looks (control: a drawing without the edge mask is found out). Five more,
  each against the tree as it was: in the light look the most visible pixel
  of a grain in the air down the middle of the lower bulb, against the page
  seen through clear glass (247, 242, 234), the least of three frames, is at
  least 2.5 : 1 for Moonstone, Sea Glass and a pale colour (45, 0.2, 0.97)
  under both lights, and Sahara's not below 19c84db's (control: 19c84db's
  own grains, 2.0 to 2.2); Sahara's lit flank in the light look has at least
  1.2 times Soft's OKLab chroma and is lighter (control: the sunlit sand as
  first built, d7a050c, 1.13, `HOURGLASS_SUN_FIRST` names another); on a heap
  with a staircase surface and one kind of grain, the column-to-column step
  of the shaded flank's level 4 to 10 cells down is under 4 % (control: as
  first built, 5.2 %); in the dark look a resting bed's brightest bloom under
  Sunlit is within 10 % of Soft's for Volcanic and Garnet (control: as first
  built, every glint feeding 0.7, 1.22 and 1.48); and a custom colour is lit
  by its own `sun` record (control: a theme without it gets Sahara's).
  `render-shape` draws every glass shape as the app would, once with the
  drawn glass and once with the WebGL glass, and reads the layers back: no
  pixel of sand outside the glass, mid-run and through the Reset sweep; the
  glass's wall on the shape's own curve, and as thick all along; the collars
  covering the ends; the layers their own half turn; the lights on the
  glass; cracks on it. For the WebGL glass it also holds that the classic
  teardrop's shader is still the text it always was, that another shape's
  shader reads its table at full precision, that the picture comes back
  after a lost context, and that a device which refuses that shader is
  given the drawn glass of the same shape. On white (the light look) the
  rendered glass of every shape is clear: its two layers read back from WebGL
  and laid over the paper in numbers, an empty bulb within 2.0 (CIELAB) of
  #f3f0ea at the median and 0.95 of its luminance, away from the wall and
  the highlights; a flat patch of Sahara's colour behind the near wall
  keeping 0.93 of its chroma and its L* within 3 %, and no more than 1.04 of
  its L* toward the wall; the rim darker than the paper all round the outline
  (0.40 under its luminance at the palest point, 0.84 at the median; the
  waist, where the walls meet, left out); the room's highlights there. Its
  control is the same glass with the film put back as it was before (the
  alpha lifted to the sheen under the steep exposure, the grey veil over the
  bore), which must fail in every shape.
- `look-unit`: the sands, in Node: the nine of `SANDS` (the first six the
  sands of `THEMES`, field for field, their tables the renderer's own) and
  `customSand` over a sweep of 6336 colours against what the colour table,
  layered sand and the eye need; what `customSand.clamp` makes of a colour;
  the theme `setLook` puts together from a sand and a theme's caps; the
  sunlit sand's `sun` record of each of the nine and of 144 custom colours, in
  range (the paper key 0.55 to 1.4: a pale sand's dimmed, a dark one's
  raised, a dark custom colour's over 1.2), the custom rule near every
  preset's (a bad record is the control); the
  six finishes (each a theme's caps, named by its material, and the swatch
  Tune draws in its tones); and the page's colours and swatch of each sand
  in `styles.css`; and (release 1.20.1) every sand its own accent: no two
  of the nine closer than 10 (CIEDE2000, `lib/colour.js`), each a fill with
  its ink (4.5 to 1) and, mixed with the deep brown as the light look writes
  it, a text on the paper and a sheet that keeps the accent's hue; a black,
  a navy, a dark brown and a white custom sand each its own (a black not
  sahara's gold), with 1.20.0's accents and custom rule as the control that
  must fail. It is in GitHub's list.
- `motion-*` and `audio-*`: the sensor pipeline (against a model of a phone
  being shaken, in each browser's sign convention) and its permission, and
  the sound engine's calls and levels, and the water ambiences: that each
  starts, switches and stops leaving nothing behind, their levels, that
  nothing clips behind the sand, their synthesis slices, and the fallback for
  browsers that refuse low sample rates; and the Sound tab's levels: the
  Sand level at 100 is the sand as it was, to the last bits, against the
  engine of d16fdcd (`HOURGLASS_SOUND_BASE` names another), at 50 the law
  (50/100)^1.5 with the compressor and the clipper made plain, at 0 the sand
  silent while the bowl and an ambience play as they do with no sand; the
  Bowl level at 50 is the bowl as it was, at 100 with Sound at 100 its peak
  printed and nothing into the clipper's end, at 0 silent; each with its
  control (a gain of 0.99, a level heard as its plain value, the base engine,
  a bowl or an ambience routed through the sand's gain, a bowl 30 dB over the top, a
  copy that ignores the bowl's level). `audio-levels` renders every
  character of the registry behind every ambience its tables name, and an
  ambience that makes a sound and is in neither table (its level, the
  clipper) fails there instead of going unmeasured. A change to `audio.js` that should
  change no sound has a tool of its own, run by hand because it must be told
  what to compare with: `node tools/audio-identity.js --base <commit>` runs
  that commit's engine and the checkout's from the same random numbers and
  compares the tables, the sand's material and every ambience's loops sample
  for sample (in Node), and every character and ambience through the graph
  (in Chromium), to within what a render there differs from itself.
  `audio-levels` also holds the bed
  of a glass that is moved while no stream runs (before the start, paused,
  finished), fed what the classic sand gives the app for that motion:
  silence at rest; a 1.5 g 5 Hz shake, 2 g up and down and a lean past the
  slope each within 3 dB of the level it was built at, the lean louder on
  its low side (leaned with the right edge low, in the right ear; a sand
  reporting a quarter of the shake's feeds fails the level's
  check, its control); the lean heard only where no stream runs (the
  same slides under a running stream leave the rush at nothing); and a glass
  that stands, turned over: through the turn and the sand's slide after it
  the rush only falls after its peak, with no gap at the turn's end and no
  second onset, while a running glass turned over keeps the turn's own rush
  alone (its control). `audio-api`
  also checks that one touch is enough, in a Chromium launched with its own
  autoplay policy (sound only after a gesture, as on an iPhone; the page is
  driven by an init script and reports on its console, since a script
  evaluated from outside counts as a gesture): on a fresh page with the
  glass idle the bed's feeds play nothing; after one touch that starts
  nothing (the glass taken, moved and let go) the context runs and the same
  feeds thump, rush and shimmer, with sound at the output; the same events
  made by a script leave the context suspended (the control).
  How the sound comes in when a glass is set running (release 1.20.1,
  docs/engines.md "Coming in") is measured in both. `audio-levels` renders
  the engine with its `begin()` called as the app calls it, Ocean with the
  compressor and the clipper made plain and against the same render with
  its bus open all along, so that the levels read are the envelope alone,
  tenth of a second by tenth: at a start the ambience silent at 1 s (40 dB
  under its settled level), 30.5, 13.5 and 3.5 dB under it at 4, 6 and 8 s,
  within 1 dB from 10 s on, never more than 1.5 dB from one tenth of a
  second to the next once above -50 dB, and nothing heard in the first
  50 ms; the sand's stream against the same stream with no rise (the same
  random numbers: only its level differs): from silence over 1.5 s, its
  first grains struck softly, the same sound as without a rise from 3 s
  on; a short glass's shorter wait and rise, over before its fade before
  the end; a resume (3 s and 0.6 s, no wait); a pause in the middle of the
  start's rise, then a resume (no step, not louder than before the pause,
  never ahead of the start's own rise); the fade before the end beginning
  under a rise (never louder than the rise alone nor than the fade alone,
  one turn, no step); the page hidden while it rises; and what is not changed: an audition and a glass
  that only runs (the bowl, a thump, a clack, a tap, a shake, a turn, mute
  and unmute, the page hidden and back) are the engine of release 1.20.0
  to the last bits (`HOURGLASS_START_BASE` names another commit than
  0693c1f), and a thump, a clack, a tap, a shake and the bowl under a rise
  are what they are without one. Its controls are copies of the engine
  with one thing changed, loaded beside it: `begin()` doing nothing (the
  sound as it was), a rise twice as long, no rule for a short glass, a
  resume that always takes its own short rise, a fade before the end
  written onto the rise's own gain, an audition that waits for the rise, a bus that
  opens more slowly, and a rise put on all of the sand's sounds; each fails
  the check it is the control of. Every render of these cases is a call of
  its own with a watchdog: one that has not ended after 90 s is made once
  more on a fresh page, and the suite prints how many were.
  `node tools/test/audio-levels.test.js --only start` runs these cases
  alone (two minutes). `audio-api` has the same in the real app, by the
  engine's own clock (case 15; `--only start` runs it alone, about three
  minutes): a tap on the glass tells the engine of a start once, with the
  glass's 300 s, and Ocean's bus is still shut a second later, 10 to 18 dB
  under its level at 6 s and within 1 dB at 10.8 s; a pause and a tap tell
  it of a resume; the Flip button on the running glass and a sequence's own
  turn tell it nothing, and the bus holds at its level through them;
  another duration picked while it runs, a finished glass turned over by Start to run
  again, and a finished glass given new sand (paused, but not run since)
  are starts. Its controls are copies of `app.js` handed to a fresh page:
  one that never tells the engine, one that tells it whenever the glass is
  set running, one that takes every start from paused for a resume.
- `app-*`: the app's own acceptance tests (permission, gestures, motion,
  re-timing, session, the existing flow), on the app as it ships
  (`app-motion` also has the classic sand heard before the start: nothing at
  rest; leaned past the slope, thousands of slides a second and the rush,
  softly, in the ear of the side the sand runs to (leaned one way and then
  the other, each against where the sand's centre went); shaken, the rush
  and the shimmer; no stream and
  no ambience in either; and the same lean under a running stream leaving
  the rush at nothing, its control; and SIDES: every sound that has a side
  (the hiss, the thumps, a slam, a leak, a single grain's landing, the
  glass's creak, crack, its growth and a chip) heard where the listener sees
  its sand, the glass upright or turned half round by a finger, the phone
  upright or upside down with the glass swapped; its controls are made by
  hand, app.js's heardSide() returning 1 and the hiss not turned by the
  phone's roll; and START, `--only start`: the phone's motion never starts
  a glass. After Reset the stub's phone is turned over and back three times
  in a row: upright again the glass is as after Reset each time (idle, the
  clock unchanged, the status line, the Start button, nothing saved), in
  between it waits too with its sand below at 00:00.0, nothing of an ended
  glass happens (no bowl, no ending buzz, no wake lock asked for, no session
  saved) and no grain passes the neck in any step, also on its side and
  shaken; there the Flip button turns it back to wait, Start turns it over
  and runs it, and a tap starts a waiting glass. A 10 s glass run out and a
  work and rest sequence run out, turned over by the phone, wait as after
  Reset (the sequence at its first glass); the Flip button and a finger's
  turn leave a finished glass waiting too (from 1.20.2), and Start runs it; a running glass runs on with its
  clock swapped (in TILTSWAP); a paused one stays paused, also one paused
  with all its sand above. Its controls: the tree before the rule, made
  with `git archive e375591` and given as `--root`, fails the waiting, the
  finished, the sequence and the last paused checks; by hand on a copy of
  the tree, `stateAfterSwap()` without `byPhone &&` fails the Flip button's
  and the finger's checks and Start in between, without `&& was !==
  'running'` the running one,
  with a paused glass sent to wait the paused one, and `seqSwapped()`
  without `|| next === 'idle'` the sequence's). TURNS, `--only turns`
  (1.20.2): no turn by hand starts a glass either. A finger's drag-turn, a
  flick, the Flip button and `F`, each on a glass that waits, one that has
  run out, one that is paused and one that runs, over and back: a waiting
  glass waits with its sand below (00:00.0) and then above, a finished one
  with its sand above (its full time) and then below, a paused one stays
  paused with its time swapped and back, a running one runs on; after one
  more turn Start (for the Flip button and `F`) or a tap on the glass (for
  the finger's turns) starts each of the first three. Its control is the
  tree at f7e10b9 (`git archive`, given as `--root`), where a turned
  finished glass runs. Every script `index.html` loads
  script `index.html` loads is served as it is, except that a suite may ask
  for the motion stub (`stubs/motion-stub.js`, driven by the test), which is
  then served at `motion.js`'s path. Real sand is the app's default, and
  this Chromium has `navigator.gpu` but no adapter, so every page a suite
  opens starts from a saved `{ v: 2, realSand: false }` merged under what
  the suite seeds itself (`lib/seed.js`, in the harness and in the suites
  that open the app on their own: `render-app`, `audio-api` and
  `lib/replay-iphone.js`): the suites measure the classic sand, as before. A
  page seeds `realSand: true` to have Real sand, or `rawStorage` for exactly
  what it gives (`{}`: a first launch). `app-upgrade` seeds nothing: it runs
  the app as an iPhone would after the update, Real sand on. `app-session`
  ends with the app's shortcut: `./?t=300` over a saved session of a running
  5-minute glass is a new glass, after a plain launch has picked that glass
  up (the control); then, launched at `./?t=300`, a running glass is kept
  with its time through the browser's reload and the app's own for "Use this
  shape", Grain and Real sand, and so is a duration picked after the launch
  (the control: a copy of `app.js` that leaves `?t=` in the address loses
  all five). `app-breath` covers breathing pace: the Tune row and what is
  saved, the toast's place just above the sheet, the three patterns against
  the wall clock, a blocked main thread, a hidden page and a long sleep,
  easing back to rest, Reduce Motion, Full Zen, the landscape halo, a damaged
  saved pattern, and that only a compositor transition of opacity and scale
  ever runs. `app-sequence` covers work and rest: the Custom sheet's rest and
  rounds, a watched sequence (the length and last grain of every phase, the
  bowls, the turns, Zen), pause, Flip and Reset inside a phase, the clock
  moved on through phase ends (asleep, hidden), reloads, and Reduce Motion.
  `app-realsand` covers the Real sand switch in this harness, which has no
  WebGPU adapter, reading the row's state from its `data-state`: off,
  nothing under `realsand/` is requested, and Grain and Real motion's crack
  sentence are shown; on with the real engine, it finds no adapter, the
  switch shows off but is not disabled ("Needs WebGPU (iOS 26 or later). Tap
  to try again"), the setting stays on and the browser's user agent is kept;
  with nothing saved (a first launch), the engine is loaded once, the next
  launch loads nothing, and another user agent (an iOS update) or a tap
  tries again, while a failure in a page that was hidden meanwhile keeps
  nothing; a save without a version or of version 1 comes up on, once, and a
  version-2 save that is off stays off; a new engine build forgets three
  failed starts and a kept user agent; the dark opening waits for the GPU
  sand's first frame (not on a reload marked `hourglass.openNow`); the
  watchdog: the GPU stopping while the glass runs in view gives the CPU sand
  after 4 s at the engine's counts, the clock untouched, a new engine after
  2 s, and the CPU sand for the session the third time in ten minutes, with
  a glass that still ends on time, and it never fires on an idle, paused or
  finished glass with its readbacks held, a calm running one, or one hidden
  10 s; on with the real adapter on a mock graphics chip whose neck
  is the valve test's model (`stubs/realsand-mock-boot.mjs`, served as
  `realsand/boot.mjs`): the handover, a 10 s glass whose last grain leaves
  within 30 ms of 00:00.0 and whose count reads 0 within 3 frames after and
  never before, Reset, a pour, a hidden gap caught up by a transfer, a Flip,
  the canvas turned by CSS while the chip's runs are held at a swap, and a
  chip lost mid-run (the CPU sand at the same counts in the same frame, the
  clock untouched, the toast, then back), and what audio.js is given (the
  stream's flow from the grains released, landings after their fall, events
  in range, poured sand landing in the top bulb, and of the bed, in a glass
  that is not moved, nothing: no thumps, slams or slides, no landing buzz);
  the bed heard when the glass is moved (`sounds`), with the mock engine
  saying what its sand does (`__mockEnv.feeds`: the frame record as an
  engine fills it, written only in frames in which the engine ran;
  `__mockEnv.tally`: fields merged into the mock chip's readbacks), the
  phone shaken through the motion stub: before the start, running, paused
  and finished, every thump and slam the engine reported is given to
  `audio.update` in that frame and played, the slides at their rate, the
  agitation and the landing buzz, with the stream and the ambience on only
  while the glass runs, and each time the same shake with the engine saying
  nothing gives nothing (the control); its sand still, the engine sleeps
  within 1.5 s although it was reporting sound until then, and nothing more
  is given (sand that moves keeps it awake and heard, the control), and a
  jolt brings the sound back within 3 frames; hidden, no update at all, the
  rush and the shimmer let go (back in view it is heard again); muted, or
  with the volume at 0, the feeds come and the output is silence, read by an
  analyser on the sound engine's last node (unmuted, it is not); and the
  engine's own ears, with nothing said for it: the mock chip's readbacks
  carry each bulb's bed, the upper one sliding within itself, then falling
  as one body and stopped by the glass, and the real adapter's slides, agitation and
  one landing, at the energy of that fall, reach `audio.update` and are
  played (the same bed at rest in the records gives nothing); a start
  that fails keeps the setting and stops after three launches (an engine
  file that cannot be had with no connection is not counted); a start made
  again in the same session that finds no adapter keeps nothing, "Needs
  WebGPU" is believed for seven days, and a start that took over gives the
  retries back; a stale build stamp says it is updating;
  a start held 4 s, as slow as an iPhone's home-screen web app opened cold
  (the CPU sand shown and running meanwhile, the boot veil held 1 s and no longer, the
  canvases cross-faded only once the engine has drawn, the clock's end not
  moved by the handover, nothing counted, the glass on time); the screen
  wake lock held while the GPU sand runs (a stand-in for the browser's,
  which a headless Chromium refuses), let go while hidden and taken back,
  and every gap caught up by a transfer, also one past the end; the
  graphics chip lost while hidden (silent, rebuilt on return), in view (the
  toast, rebuilt after 2 s), and a second time within 10 minutes (the CPU
  sand for the session, nothing counted), lost just after the engine adopted
  the sand or just after a rebuild handed it back (never handed to the lost
  engine), and a rebuild that finds no device; the phone's motion never
  starting a glass (`waits`: on the mock chip with the motion stub, after
  Reset the phone turned over and back three times: the glass waits each
  time, the clock unchanged, every point the chip holds above the neck
  again and all below in between, the valve shut and no point across by the
  plant's count or the adapter's; a glass run out and turned over waits the
  same way and a tap runs it out on time; the control is `app.js` with
  `stateAfterSwap()` as it was, where the same turns end the glass and then
  run it); points stuck above after a
  sequence ended while hidden (moved by the residue rule); the GPU sand
  asleep drawn again after a theme, a turn of the screen and the Frame
  switch; the handover held until a Flip is over; and a glass that does not
  crack: the drop that cracks the CPU sand's glass (its control) only thumps
  and clacks, quick knocks crack
  nothing, a crack from before stays, leaks nothing and mends, Reset makes
  it whole, and a theme or layered sand chosen while the GPU sand runs (the
  new colours at once; a re-tone that moves no grain); and `?debug=sand`
  and the row's "Copy a report", whose report carries the start-up times
  and the stream's first fall to the reports. Its LIGHT case holds that
  Tune's Light and the look reach Real sand, with the real adapter and the
  app's own Renderer on the mock chip: at the handover the engine is told
  the saved light and the look shown, and its frames are drawn with that
  look's constants and the room's key; a change of look is told on the
  frames of the fade, with shares between the looks that never go back, and
  ends on exactly the light look's; the row's Soft takes the light out of
  the engine's frames and the classic sand's, Sunlit puts it back; with a
  slow start, the look and the row changed while the engine is not ready
  break nothing, and the engine takes over with what they are by then. Its
  control is an app that never tells the engine, which stays soft.
  The monitor every suite runs (`stubs/page-init.js`) follows
  `Hourglass.sim` when Real sand takes over, and checks the GPU's readbacks
  against its count (`audit()`). `app-regression`'s service worker check
  serves a new build of the engine midway: the app keeps its cached engine,
  a lab page gets the new one at once, and nothing a lab page fetched is
  stored; a lab page written for yet another build says so, with both
  stamps, loads once and leaves the app's cache whole, and the app then
  starts offline.
  `app-upgrade` covers what an installed copy does when a release comes, in
  Chromium with the service worker on, the app served from a scratch copy
  swapped under the same address, and offline meaning the server stopped:
  `origin/main` installed, then this tree, two launches with a connection
  and one offline (no error, no 504, one cache, and Tune's version line
  "Version X.Y.Z" with nothing after it), then a newer release installed
  while the page is open (the line says the update is ready); a deploy
  that lands while an install is downloading (no copy of two releases is
  kept, and the next launches end on the newer one, whole); a server that
  sends `Vary: Accept` (a launch of the installed copy asks it for
  nothing); `app.js` itself or the style sheet missing from the cache (the
  page still says it is updating); a release
  whose `SHELL` names a missing file (its install fails, leaves no cache,
  and the installed release runs whole, online and offline); a script taken
  out of the cache (offline the page says it is updating; one launch with a
  connection fills the cache again, from the same release only); an older
  release (1.10.0) with `app.js` taken out of its cache, met online by this
  tree (the page says to open it again in a moment, not "with a
  connection", and the next launch runs this tree; its control is this tree
  with the online words taken out); a lab
  page that meets another build (the app's cache stays whole); and an update
  that never finishes over a copy installed before the snapshot worker
  (13a9772's worker fetches each file it answers into its copy, so offline
  the copy is mixed: this tree's page without its settings store, a file the
  old page never asked for; from a release that moves files, without every
  script at its new place too. The page says it is updating and throws
  nothing, and runs again with a connection). Its controls run 13a9772's worker and
  lab (v1.9.0, a release before the snapshot worker), which fail the
  same checks: an empty cache left by the failed install, the next release's
  files on the page, the engine dropped from the cache; and a copy of
  `app.js` that starts without asking whether its parts are there, which
  throws in the mixed copy (the words then come from the page's own last
  lines; with those taken out as well, it says nothing). And old saves
  (`--only "old saves"`): each of the six materials, chosen with its own card
  in release 1.13.0 and in release 1.10.0 (with layered sand on, the bowl
  off and the rain), comes through the update to this tree with the same
  colour table, caps and picture, drawn by the renderer's own bundle, the
  page's accent the sand's own (the same as before but for Volcanic Black's
  and Lapis Lazuli's, new in 1.20.1), saved
  as that sand over its own finish, and every other setting as it was,
  online and offline (what the app keeps of its Real sand engine aside); a
  copy without the finish's migration is found out. It needs
  `origin/main`, d6482bd (release 1.13.0), 5911e24 (release 1.10.0) and
  13a9772 from git (`HOURGLASS_MAIN=<ref>` names another first release;
  the old saves are always made by those two releases).
  `app-tune` covers Tune's four tabs: one panel shown and remembered, the
  Sand tab's Light row (after Grain, Sunlit checked and lit as the app comes,
  a tap or an arrow key saves it and lights or softens the sand at once, a
  reload as saved; control: a copy that shows the choice and does not save
  it; and through a Flip every frame of the classic sand is drawn with the
  glass's angle of that frame, the swap's too, where a copy that draws it
  without is half a turn off: the control), the
  tab row in one place on every tab, the sheet's top 44 px under the neck,
  the tabs as a screen reader meets them, the haptic labels on every button
  at boot, the reset link (what it puts back, the sand and its finish among it,
  the Sand and Bowl levels, the Rings and the fade before the end, each with
  a control that leaves it as it was, and what it keeps, the custom sand's
  colour, Sound in silent mode, the six quick durations and Show when it ends
  among it, with a control that puts silent mode back on and one that puts
  the quick durations and Show when it ends back; its first tap's
  question said to a screen reader through a status drawn nowhere), each
  tab taking a tap 3 px above and below what is drawn of it (`--only
  target`, at 393 x 852 and 320 x 568, its reach clear of the close button,
  the next tab and the rows), the focus kept in an open sheet by Tab and
  Shift+Tab (`--only focus`, Tune and the custom-duration sheet), every
  radio group one Tab stop with the arrows, Home and End choosing in it and
  saving what a tap saves (`--only radios`, with a control for each), and the
  "more below" hint (`--only hint`): at 393 x 852 a tab that can scroll
  shows it at its top and in its middle and not at its end (every tab can, at that size); a
  scrolled tab fades its rows under the tab row; a finger on the hint
  reaches the row under it (the lowest point of the hint over a control
  that does not load the page again); the sheet, the tab row and each tab's
  first row stand where they did before the hint (Sand's first control, a
  sand since 1.14.0, where the first material card stood); Grain appearing or going with Real
  sand keeps it right; and Reduce Motion shows it without a fade. The
  suites reach a control of Tune through `lib/tune.js`, which opens the
  sheet and taps the tab whose panel holds it, read from the page.
  `app-time` covers the Time tab's own rows (settings design 3.4, rows 1
  and 2): its order (Quick durations, then The clock: Show when it ends,
  Keep screen awake, then the rows that were there); the six quick
  durations, each set in turn with the custom duration's dial in its
  minutes-only mode, the pill under the glass changed at once, saved, Tune
  back with the focus on that button, and the six as set after a reload;
  the lit pill (the first of two the same; a pill changed while the glass
  runs leaves it running with its time, the light follows the number,
  none the same lights Custom); the dial closed three ways without Set
  (nothing changes); the keyboard and the names a screen reader meets
  ("Quick duration 3: 10 minutes, change", "Set quick duration 3 to 12
  minutes"); the tab at 393 x 852, 375 x 667 and 320 x 568 (no sideways
  scroll, nothing outside the sheet or cut, buttons of 44 px at least) and
  six "99" pills under the glass at 320 px; and Show when it ends with a
  clock the test sets and a fixed locale and time zone (en-GB in
  Europe/Berlin, en-US in America/New_York): "Flowing · ends 14:34" and
  "2:34 PM", the same over a minute boundary with nothing written to the
  page, later after sand is added, right after a turn, gone while paused
  and later by the pause, gone at the end, across midnight, the phase's end
  in a work and rest sequence, the switch off giving today's words exactly
  at every step, the switch in Tune, Zen and a short screen, and the time
  zone changed while the glass runs (Berlin to New York, the end given in
  the new zone within 10 s). Every check
  has a control (`--only order|quick|lit|cancel|keys|fit|ends`).
  `app-mode` covers light and dark, the Zen button and the double-click
  (release 1.19.0): each of the four backgrounds saved comes up in its look
  (the page's `data-look`, its theme-color, color-scheme and status-bar
  metas, the renderer's shading, the moon button's state and the Tune row's
  choice); the four choices in Tune's Glass tab change the look with
  nothing built again (a look is read once its fade is over); the moon button turns to the other look and back, kept
  over a reload, and turns Device or Daytime into a choice of its own; a save
  of 1.18.0 comes up dark; the reset link puts it back to dark; the first
  frame painted is in the right look for every choice (an init script reads
  the page at its first animation frame; a copy of the page without its early
  script must fail); Device with the browser's colour scheme emulated light and
  dark and changed while open; Daytime with the clock (`new Date()` set by an
  init script, in UTC) on both sides of 7:00 and 19:00, carried across each
  while open and across a return from the background (copies of `app.js`
  without the timer, without the return and without the scheme's listener must
  fail); a running glass keeps its time within 40 ms over four changes of
  look; the contrast of every text of the bars, the state line, all four tabs
  and the dial sheet against its ground, from computed styles, 4.5 to 1 or
  more in the light look at 393 x 852 and 320 x 568 (a paler third ink must
  fail); in the dark look the first two inks likewise, the third measured
  and left as it was; the glass's outline on white, from the screen's
  pixels along a line through the empty lower bulb, for the drawn glass and
  (software WebGL) the rendered one (without the light shading each must
  fail); Moonstone and a very pale custom sand against the paper (the same
  measure on a ground of the sand's own colour must fail); the Background
  row and the dial sheet at 393 x 852 and 320 x 568; the Zen button's name
  and icon; and the double-click of a mouse into and out of Zen and Full Zen,
  not on the glass, a button or a pill, not by a finger, not with a second
  click 0.75 s late, nothing started or turned (copies without it, with a
  finger's taken, with a 2 s wait must fail), and a keyboard alone (Tab,
  Enter, Escape) and a mouse alone (the button, a double-click) in and out.
  Release 1.20.1 added: GROUND, the ground one from the top edge of the
  screen to the bottom, as the home-screen app has it (the insets, 47 px above
  and 34 px below, put in through the page's own variables, and `100dvh`
  served 34 px short of the window), at 390 x 844, 393 x 852, 430 x 932, 375 x
  667 and 320 x 568, in Zen and with Tune open, in both looks: the app's box is
  the window's, and four columns near the sides, scanned from the screen's
  pixels (5 above each point against 5 below), step by no more than 12 levels
  outside a control (the app's box 100dvh tall again must fail); FADE, a
  change of look held half way (its animation paused, `--lk` at 0.5) lies
  between the two looks for the room beside the glass, the bar, the glass's
  drawn layers, the body's colour and the theme-color, with a glass running
  (an app without the fade must fail), and the rendered glass (software
  WebGL, its two canvases read alone on a grey) between its two programs' pictures (one that only switches program
  must fail); each end of a fade exactly the look as the app opens in it, to
  the pixel; LAUNCH, no fade at the launch in either look (a page that put
  its look on after the first frame and faded to it must fail); REDUCE, at
  once with Reduce Motion (an app that fades all the same must fail); TWICE,
  two and three quick changes, each made in a fade held 40 % of its way, end
  exactly dark and light, and each new fade starts from the very point the
  page shows (an app that starts each change again from the look it left must
  fail); PACE, a running glass keeps
  the wall clock's time over three fades and the glass is redrawn in each
  frame in under 16 ms; PILLS, the six pills and Custom whole with no scroll
  at every width from 320 to 2560 px, also with six of 99, a phone's pills as
  they were (without the bar's own measure the last pill is cut at 1280 px).
  Release 1.20.2 added to GROUND a layout viewport shorter than the window,
  as an iPhone's home-screen app in the light look can lay the page out: the
  body and the app's box end 59 px short at the bottom, or begin 59 px down,
  and the canvas (the root's colour) shows there. At 393 x 852 and 375 x 667,
  plain, in Zen and with Tune open, in both looks, and half way through a
  fade either way, the four columns find no step where the room meets the
  canvas; on the ground as it was (`oldGround()`: no flat edge to the room,
  the canvas the page's own colour, the scrim to the edges) they must find
  one in the light look at both ends and sizes, with Tune open at the top in
  both looks and half way through a fade. FIRST reads the canvas as the
  room's edge (`#ece9e2` light, `#090a0c` dark) and the body as the page's
  colour. STANDALONE: the home-screen app's rule (`@media (display-mode:
  standalone)`, which a test browser cannot emulate, so read with its query
  made true, and as a tab) leaves the app's box the window's and Tune at its
  foot at 393 x 852, 1280 x 800 and 412 x 915 in both looks. MEASURES: a tap
  on Tune's version line shows one small line of the page's measures under
  it, exactly what the page reads, for 8 s, and stores nothing.
  The screen's pixels (a screenshot, read back in the page) and the glass's
  drawn layers are kept and measured in the page, and only the measure comes
  to Node: a mean, a scan's result, a distance, or a picture's size, hash
  (FNV-1a) and sum where two pages' pictures must be the same to the pixel.
  Pixels as numbers never cross: each value of an answer costs Playwright's
  protocol about 5 µs and 200 bytes in Node (1.63, measured), and the two
  drawn layers are 19 million of them at 390 x 844, 100 s and over 3 GB a
  picture. In this suite every question to a page ends after 30 s, an answer
  of more than 20,000 values is refused in the page, a case that is stopped
  so fails by name and the next one runs, and the suite stops itself if its
  own process passes 1 GB.
  `HOURGLASS_SHOTS=<folder>` keeps pictures of both looks. It runs alone
  (`--only CHOICES,TUNE,...` for parts).
  `app-look` covers the sand and the frame's finish chosen apart (release
  1.14.0): with nothing saved the glass and the page exactly as they were,
  the renderer's own bundle; each of the nine sands tapped in Tune over the
  caps the frame had, and each of the six finishes under one sand (hidden
  while the frame is off); one of the six over its own caps the bundle,
  picture for picture; Custom with no colour made (a sea green, the well
  shown), a colour let go in the well kept as asked and used clamped, the
  well showing the colour used; a colour dragged (the table once a frame,
  nothing drawn or saved until it is let go); the chip, with and without a
  custom sand; `Hourglass.setTheme` as the material of old; reloads; and at
  320 px four sands and three finishes a row; ACCENT (release 1.20.1): each
  of the nine and a custom sand chosen in Tune, in both looks, puts its own
  accent on the selected pill and the Start button, no two of the ten within
  10 (CIEDE2000; a style sheet with 1.20.0's gold for the black sand must
  fail), with pictures of the bottom bar for each under `HOURGLASS_SHOTS`;
  FADESAND: from the dark look to the light, the first frame of the fade
  draws the sunlit sand at the dark look's share (as the page and the glass
  are) and the last at the light (control: a copy that leaves the renderer
  at the end look until the fade's first step draws its first frame at 1).
  Each check has a control.
  `app-layers` covers layered sand: the Tune switch, its saving, a new glass,
  pour, flip, a restored session and Reduce Motion. `app-sound` covers the
  Sound tab's own rows (`--only layout,levels,rings,tap,twice,quiet,away,rounds,awake,asleep,back,fade,silent`):
  at 393 x 852, 375 x 667 and 320 x 568 the rows in the design's order and
  words, nothing wider than the sheet, no sideways scroll, no word cut off,
  44 px for every new control, each named for a screen reader, the bowl's
  rows gone with the bowl off and the fade's with no ambience; the Sand and
  Bowl sliders saved, told to the sound engine and shown again after a
  reload; on a clock the test moves (Date.now() shifted): the rings of Once,
  Three times (8.5 and 17 s after the first) and Until a tap (every 8.5 s,
  the last within 10 minutes), the first tap on the glass, the first button
  (Tune) and the first key (F) used up by stopping the bowl and the next one
  working, Start tapped twice 0.25 s apart (by a finger, by a mouse) where
  only the first is used up, no rings and no tap taken when the bowl cannot
  be heard (muted, Sound at 0, Bowl at 0) and the rings stopped when it
  becomes so, nothing rung while the page is hidden and nothing late when it is
  back (and nothing after 10 minutes away), a sequence's soft bowl once
  between phases with the next phase not held and the last end ringing as
  Rings says, the wake lock held for the rings only with Keep screen awake,
  a glass found run out 8 s late ringing its rings 8.5 s apart from the late
  bowl and one found 11 minutes late ringing no rings, the clock set back an
  hour after the end ending the rings and letting the screen go;
  the fade's share at given times left for each length, a glass shorter
  than twice the stretch, pause, sand added and a turn (the engine's gain
  gliding, no step), the switch off as before and only a sequence's last
  phase; and with `navigator.audioSession` stubbed, 'playback' or 'ambient'
  at the launch, after the first tap and at once on the switch, and without
  one a row that says the browser decides and nothing thrown. Each check has
  a control, a copy of `app.js`, `audio.js` or the style sheet with that one
  thing undone. About 6 minutes. `app-ambience` covers the six
  ambience cards: the radio group as a screen reader meets it, two rows of
  three from 320 to 430 px and in landscape, choosing, saving and restoring.
  `app-gestures` also covers Zen: none by itself, in by spreading two fingers
  or the moon icon, out by pinching or `Esc`, and unchanged by taps, by
  playing with the glass, by a second finger while it is carried, and by a
  pinch while a sheet is open. `app-haptics` covers the iPhone's taps: a
  label over a hidden switch on every control and on the stage, the switch
  flipping exactly when the app asked for a tap, every control still doing
  its work once, and scrolling, pouring, carrying and pinching unchanged.
  `app-shape` covers the glass's shape (`--only pick,look,use,shapes,sand,full,old`):
  the Glass tab's Shape section above the frame's, the nine offered shapes
  in their order, three a row, drawn at one scale, the one in use drawn
  large, and a shape held back not shown (Trumpet, held on the test's page
  alone, since Tune offers every shape); a tap that only shows a shape (nothing saved, nothing loaded
  again, the glass behind unchanged); "Use this shape" at 40 % of a
  5-minute glass (the page built again in the shape and Tune open again on
  the Glass tab, the time left kept within a frame, the sand the same share
  of the new full glass, the glass out at 00:00.0 on time); every offered
  shape on the classic sand (a 60-minute glass filled to its cap, a 10 s
  glass out on time); in both, the last grain leaves within a frame before
  00:00.0 or two after it, so sand that runs out early fails as late sand
  does (the control: a copy whose valve aims 3 s ahead); the shapes drawn in the sand chosen in the Sand tab
  (not the material's) and repainted when it changes; the Sand button of a
  full glass (Delta's and Trumpet's at 60 minutes); and saves of 1.14.0 (sand, colour and finish, no shape),
  1.13.0 and 1.10.0, and ones naming a held-back shape (held on its page)
  or an unknown one, as the classic glass, every other setting as it was.
  Each check has a control. About 7 minutes.
  `app-grain` covers the Grain choice: the three choices, Finest chosen
  while a glass runs (twice the scale, four times the grains, the time kept),
  the clock kept to the last grain, Sand adding time as fast, Classic again
  while paused, and a cracked glass coming back whole in another grain.
  `app-reset` covers a new glass: Reset taking about a second, the old sand
  leaving the picture (the upper bed first), the glass made new once, in
  between, the new sand rising to the full bed, no time passing and no sand
  moving through the neck meanwhile; another duration while the glass runs,
  Start tapped during the sweep, another duration during the pour, the page
  hidden in the middle, and the plain cross-fade with Reduce Motion.
  `app-retime` covers a neck held back by a hard shake, twice: with the glass
  held whole, where the backlog must be re-timed exactly once, and cracked by
  the shake as the app meets it, where spilled sand and backlog cancel in
  part and the run is re-timed only where that is needed.
- `realsand-*`: the parts of the GPU sand engine (`realsand/`) that need no
  GPU, in Node, in seconds. `realsand-valve` checks the valve
  (`realsand/valve.mjs`), which keeps the count above the neck in the app's
  whole grains and meters the GPU's neck, against a model of that neck and of
  the app's clock (`tools/test/lib/realsand-plant.js`): six grain settings
  with pours, Flips, spins, a tilt swap in a pour with frames skipped, a sleep
  and its catch-up (also with a pour while its transfer is owed), a Reset;
  long glasses, also run again by a Flip after their end, the slowest and
  fastest rests, a throttle stronger or weaker than the valve assumes, calm,
  a phone held in the hand, shaking, a straggler, readbacks 15 frames late, a
  bed that first settles on the shut neck. No point may leave so that fewer
  are above than the clock's target in any substep, the count must be the
  clock's own while the neck keeps up and must never go back, the top bulb
  must never be empty while the clock runs, and the last point must leave
  within one substep of 00:00.0; readbacks that stop must be noticed within
  60 runs; the first version's bookkeeping, kept as its control, lets sand
  through early.
  `realsand-fill` checks the fills (exactly the points asked for on every
  grid and amount, all inside the glass; a target that is not a number is
  refused), every glass shape as Real sand builds it (the same after a half
  turn, the solver's widened neck stopping at the widest row, the fills
  from the app's own sand exact; a copy with the neck widened to the far
  end is its control), the grains' colour seeds against the grain shader's own hash, and
  the felt jolts' film against the lab's code from before they moved to
  `realsand/`.
  `realsand-felt` checks how the glass's motion reaches the sand
  (`GlassFelt`) at a phone's lambda: live answers a flick in the substep the
  hand moves and is over 25 ms after the hand stops, gives a sliding bed the
  film's impulse (a lone push 91 %, a shake 2.6 times what the film held
  half a second behind gave), passes jitter and every push off or into the
  floor exactly (a shake up and down is not turned into a lift), keeps what
  the cap holds back, gives the bed the same push however the phone is held
  (upright, leaning, on its side, upside down), and is not late through the
  real `motion.js` on the replay streams; its control is the film, 0.5 s
  behind under a shake.
  `realsand-adapter` checks `RealSand` (`realsand/app-sand.mjs`), the
  adapter through which the app runs the GPU sand as its `sim`, on a mock
  engine whose neck is the valve test's model, inside a copy of the app's
  frame (also every glass shape: its fill and a 10 s and a 5-minute glass
  out on time, with a control whose neck passes too little): every `sim.` member the app and the audio use, with the CPU Sim's
  type; what RealSand reads from the classic sand (the contract's third
  group: its namespace, `P.Sim` and the CPU Sim beyond the Sim's members,
  each there and none private, with a copy of `app-sand.mjs` that reads
  `cpu._rec` and `P.Sim.FOO` as its control), and its refusal, naming what is
  missing, without the namespace, with one that lacks values, or with a CPU
  Sim without `layerState()`; the fills from the CPU Sim's lattice (exact counts, each grain's
  colour); each place where the sand sets the clock (a start after the end,
  the Flip's swap, a tilt swap, a glass that waits turned over by the phone
  and back three times (it still waits, the valve shut and no point across;
  the copy of the app with its rule as it was is the control), pours, a
  re-time after a starved neck, a
  sequence's next phase turned unseen, also while hidden, a session restored
  at boot, the catch-up after the page was hidden, also across the end, with
  a swap while its transfer is on the way, and with a transfer that never
  comes back, and the finish), every glass ending with its last point out at
  00:00.0 and never reading empty while a point is above; blows that thump
  without damage, mending, the brim, the scales of a phone and a tablet and
  the Fine and Finest grains, the start-up's failures, a phone held still in
  the hand (calm, and no motion for the clock), the heat guard (and its
  log), sleep, a device lost around a lock, and the canvas turned half a
  turn while its picture is from before a swap; and the stage 1b review's
  cases: a lost engine never ready nor taken over, a handover after the CPU
  caught up (by a transfer, the count never back up), a brief lock while the
  device opened, the picture drawn again while asleep, and one shader
  library a page with the shaders' build checked; and the bed's sounds, the
  mock solver saying what its sand does (`tools/test/lib/realsand-beds.js`
  sums a bed from groups of points as the shader does): a bed that falls
  and is stopped by the glass feeds one thump of the classic sand's energy
  for that landing, in the frame its readback comes, before the start,
  running, paused and (the lower bulb's) finished; one stopped at the far
  end a slam; one that the field slowed, or that stopped sideways, nothing;
  sand sliding within a bed the classic's slides at the calibrated share, in
  every frame also when calm draws every other, and a bed moving as one body
  none; a shaken bed's agitation, 0 again at rest; nothing at rest, hidden
  or asleep, and a glass that sleeps as soon with sound in its readbacks as
  without; each with its control (the same scene on an engine that hears
  nothing, or the motion that must not sound). And the rules that keep the
  sound to what a bed did: the plug of the stream under the neck of a glass
  just started (5 points slowing from 59 to 27 cells/s, as the real engine
  gave them) feeds nothing, where the same speeds of a bed land a thump;
  sand sliding within a bed is heard while the bed is packed, not while it
  is thrown loose or packs again, nor while it moves along the glass as a
  body (across the glass it is: the control); sand sliding back down the
  wall into a still bed (half its points moving, the bed's mean falling at
  1.4 times the speed of the faintest landing) lands nothing, where the same
  fall of the whole bed as one body lands a thump (the control); a landing is the same thump
  at 60, 120 and 180 runs a second; at a slow pace (a run every 2, 4 or 6
  frames, every phase) a toss lands one thump a fall within 1.5 dB of its
  energy and at most a run late, and so does a flick (thrown up by the field
  turned round, then falling), from the engine's fastest fall between
  readbacks (`bed.peak`, from build 8; the readbacks alone, the control,
  land none or one far too weak in some phases); the engine is asked for
  those fastest falls only while a fall is possible (never while running or
  held still in the hand; a flick from its first run until 0.5 s after its
  last sample); woken from sleep by a flick within a frame on a slow display
  (frames of 50 ms), the first run covers only the time since the jolt and
  holds no field longer than its own (the control, the time since clamped
  at 0 as before, covers the whole frame); after a second without readbacks the
  agitation that had faded stays faded; and the same motion of the same GPU
  bed is the same sound at the phone's, a tablet's, the Fine and the Finest
  lattice. The sand's light (`setLight`): a `RealSand` is soft until told;
  told Sunlit, the glass asleep is drawn once more with the classic sand's
  key (`KEY_LIGHT`), the look's constants with the sand's own in them as
  the Renderer gives them, and the Renderer's sunlit colour table, each
  seed's kind in its alpha byte (another sand has another key: the
  control); the grains have the drawn bore's half-width per row; the same
  light again draws nothing, and each step of a fade is drawn once with its
  own table and constants, a + (b - a) m; the key is turned back by the
  glass's angle against the room, and in the first frame after a swap it is
  upright again with the points and the relief starts afresh (a key turned
  back by the rotor's CSS angle, a frame old, would point down and to the
  right there: the control); Soft again leaves every other field of the
  look as it was, and `_look()`'s text is the base's with the one field
  added (a grain drawn a little larger is found out); with no Renderer to
  give the tables the sand draws on soft, no error.
  `realsand-shell` checks the service worker's shell for Real sand: every
  path in it exists (one missing would fail the whole install), every module
  `realsand/boot.mjs` loads and every shader of the engine is in it, and
  `app.js`, the lab, the engine and its shaders name the same build stamp.
  The sunlit sand's relief shader (`relief.wgsl`), which the grains load
  beside their own, is named by them, held by the shell and named in the
  engine's licences; its control is a shell without it, found out by the
  check on the shaders the engine names.
  `realsand-gpu` runs only when named (`node tools/test/run-all.js
  realsand-gpu`, about 47 minutes on a shared four-core machine, every core
  busy, when Tune offered seven shapes; SHAPES takes about 5 minutes for
  each shape Tune offers, and it offers nine now): the app with Real sand
  and layered sand on the real engine, on Chromium's WebGPU in software
  (SwiftShader), loaded with `?offscreen=1`. Software runs the sand at a few
  hundredths of real time, so once the engine has started the page's clock
  is made virtual (its time, frames and timers driven by the test, a frame
  at a time, each once the chip has done the last), and the sand runs at
  real time in it. Ten cases, the first nine on 10 s glasses: the start and the handover;
  the bed's sounds before the start (nothing while asleep; flicked along the
  glass as `motion.js` reports a flick, a thump of the energy of the bed's
  fastest fall, fed within 6 frames of that fall and as loud as the classic
  Sim's for the same flick, stepped in Node beside it, within a factor of 2
  of the level `audio.js` plays, the agitation within a factor of 2;
  nothing with the readbacks unheard, its control; thrown, the bed is not
  heard as sliding: the slides fed are well under its motion within itself,
  which was fed in full before; shaken sideways, no thump
  and the agitation and slides within a factor of 2 of the classic's;
  leaned, sound only as far as the sand moved; at a slow pace, a run every
  3 frames of at least 20 substeps (24, the cap), in force from the flick's
  first frame, the same flick lands one or two thumps in the upper bulb, no
  slam, within 1.5 dB of the thump at a run a frame, from build 8; the same
  slow pace from the readbacks alone is logged, not checked);
  a glass to its end, its last grain crossing within one frame after
  00:00.0 by the chip's own record, with no catch-up and no residue, and,
  left alone from Start to the end, no thump or slam and next to no
  agitation, the few crowded points under the neck never heard as a bed
  (taken for one, the same readbacks' plug is heard as a bed: the
  control); Reset;
  a Flip at 4 s; a pour, then real motion turning the glass over while sand
  is poured; 30 s hidden and caught up by one transfer; and the chip lost
  mid-run (the CPU sand at the same counts in the same frame, the clock
  untouched, then back). LIT is the sunlit sand (Tune's Light), measured on
  the engine's own canvas: under Sunlit the sand's side toward the screen's
  left is the brighter by at least 1.2 to 1 in relative luminance, upright
  and at rest, in both looks; and the control, on the very same grains:
  each frame's ratio of the two sides over that of the base's canvas (below)
  in the same frame and the same pixels, a picture of the same grains with
  no light of the engine's, so that the bed's own shape and layers cancel,
  is 1 under Soft (0.9 to 1.1) and at least 1.2 under Sunlit in both looks.
  Soft is the picture of before: the grain renderer of the commit
  before the sunlit sand (`19c84db`, release 1.20.0, its `grains.mjs` and `grains.wgsl`
  taken from git; `HOURGLASS_SOFT_BASE` names another, as for `render-unit`)
  draws the same points with the same look in the same commands on a canvas
  of its own, and the two canvases are equal byte for byte at rest, with
  the stream running, at every fourth frame of a full turn and after it;
  under Sunlit nearly every pixel differs (the control). After that turn,
  with the engine's points turned end for end, a new glass is lit from the
  screen's left as before. Through a second full turn, under Sunlit, the key
  each frame is drawn with, as the screen then shows the canvas, is the
  room's (`KEY_LIGHT`) in every frame, the swap's too, and while the glass
  leans on its way over (17 to 57 degrees) the lit side is the screen's
  left; the key turned back by the rotor's CSS angle as it stood when the
  frame was drawn, which the soft bead goes by, is a frame behind the turn
  (the control). A bed that has turned over lies to one side of the glass,
  so there the new glass is measured, not the bed. LIT takes about four
  minutes with the engine's start (`--only boot,lit`). Then each shape Tune
  offers, the page loaded in
  it: a 60-minute glass filled to its cap with exactly the ledger's points
  on the chip, and a 10 s glass whose last grain crosses within one frame
  after 00:00.0. With `--shots <dir>` it saves pictures of the app with
  Real sand on, each shape mid-run among them. `--only <case>[,<case>...]`
  (BOOT, SOUND, RUN, RESET, FLIP, POUR, HIDDEN, LOSS, LIT, SHAPES, as its log
  names them, any letter case) runs those cases alone, in that order: the
  engine is always started, a case sets up what it needs from the one
  before it, a name that is no case is an error that lists them, and the
  last line names the cases run, so the run is never read as the whole
  suite (`node tools/test/realsand-gpu.test.js --only reset`, about 20 seconds).
  `--shapes <id>[,<id>...]` runs SHAPES in those shapes instead of every
  shape Tune offers, one held back offered on the test's page
  (`--only shapes --shapes trumpet,florence`, about 5 minutes a shape);
  the last line names them.
- `e2e-*`: the integration scenarios on the real modules: calm (E1, E11),
  motion (E2, E3, E14, E15), timer (E4, E5), gestures (E6–E8), session (E9, E10),
  permission (E12) and performance (E13). E15 is the phone's motion never
  starting a glass, through the real `motion.js`: after Reset the phone is
  pitched back from upright through flat to 35° past it and brought forward
  again, three times; the glass waits each time, and a glass that has run
  out waits the same way until a tap (the control: the tree before the
  rule, as for `app-motion`).
- `replay-*`: the glass under a real hand, built from the replay harness in
  `tools/test/lib` (`replay-iphone.js`, `replay-probe.js`, `replay-streams.js`,
  `replay-offline.js`). `replay-phone` runs models of an iPhone's sensor
  streams (walking, running, set-downs, palm taps, a drop, shakes on four
  axes) through the real `motion.js` and `Sim` on a virtual clock, in Node.
  `replay-finger` drives the app on an emulated iPhone with real touch
  events: drops, slams, throws, knocks with a finger's scatter, flicks, and
  the handling that must never mark the glass. Both state what must crack
  and what must never.

Each prints one line per check and exits non-zero on a failure. The browser
tests serve the app themselves: `app-*` and `e2e-*` take `--port <n>` (default
8804) and `--root <dir>` to test another checkout, the `render-*`, `audio-*`
and `motion-permission` tests take the port as their first argument, and all
of them read `PORT`. `run-all.js` gives each suite its own port from 8811
up, or with `--port <n>` that one port to every suite in turn. `lab-sand`
and `realsand-gpu`, the two that need WebGPU in software and take a long
while, run only when their name is given (`run-all.js lab-`,
`run-all.js realsand-gpu`). Shared helpers live in `tools/test/lib`: the app's clock,
the hand and phone motion profiles with a device-event synthesiser for both
accelerometer sign conventions, and a zero-dependency static server
(`node tools/test/lib/static-server.js <port> [root]`).

Without a GPU, Chromium shades the WebGL glass in software and every frame of
a turn takes most of a second, so the app and integration tests use the
app's own 2-D glass unless given `--webgl`. For the same reason the frame-time
budgets are best judged on a device: there the canvases are handed to the
GPU to composite, while here the main thread copies them in software and
another thread composites them. `e2e-perf` with `--trace` notes how each
stretch was spent, telling the app's own work from that.

The earlier versions some suites compare with (the baselines), and what each
pins, are listed under *Standing decisions* in
[Architecture](architecture.md#standing-decisions). They are read from git
as they were (`git show f446085:physics.js`, `f446085:audio.js`), at the
paths those commits had.

### Where the tests find the app's files

`tools/test/lib/paths.js` is the one place a test learns a path from. The
page's scripts come from `index.html` itself: `classicScripts()` lists the
classic scripts in document order, `script('motion.js')` finds the one of
that name wherever it lives (`motion/motion.js`), `physicsParts()` the
scripts that make `HourglassPhysics` (the seven pieces), `physicsSource()`
their texts joined into one program, the same as the page's script tags run
one after another, and `piece(f)` the text of one file. `lib/load-physics.js`
loads that program for the Node suites (`L.P`, `L.loadIsolated(src)`,
`L.baseline()`). There is no `L.PHYSICS`: a suite written for one
`physics.js` fails at once, saying what to use. So a file that moves or is
cut into pieces needs its `<script>` tag and its `SHELL` line, and no suite
changes.

### A branch that still edits physics.js

`tools/split-physics.js` cut `physics.js` into the pieces, and is kept for a
branch made before the cut. It needs the acorn parser, which is not a
dependency of the app or of the tests; put it in a folder of its own:

```bash
npm install --prefix /tmp/acorn acorn@8.18.0
ACORN=/tmp/acorn/node_modules/acorn node tools/split-physics.js <physics.js> <outRoot>
```

It cuts the file at its own banners, takes every import and export from a
scope walk of the code (nobody writes those lines), refuses a cut in which a
piece would read a name from a piece loaded after it, and checks what it
wrote: each section in its piece byte for byte, the same public names, and a
Sim stepped 400 times to the same lattice. The recipe for such a branch:

1. Merge the last `physics.js` before the cut into the branch's
   (`git merge-file`, with the common ancestor as the base), or merge `main`
   into the branch before the cut.
2. Run `tools/split-physics.js` on the result into the branch's tree (the
   root): it writes the seven pieces with the branch's new imports and
   exports; remove `physics.js`.
3. Find the branch's tests that name `physics.js` or read `L.PHYSICS`, and
   port them in the same commit: `L.physicsSource()` where a test serves or
   reads the whole text, `paths.piece('sand/sim.js')` for one piece.
4. Run `node tools/test/run-all.js check-` (`check-pieces` above all) and
   the branch's own suites on the pieces (`render-shape` and
   `render-regression` at least) before calling it done.

## Lab: sand test page

`lab/sand/` is a separate test page, **not the app**: nothing in the app
loads it, and it changes nothing in the app. It tries a different sand
engine, position-based MPM (EA's PB-MPM, by way of the Smoosh solver) on
WebGPU, in the app's classic glass, so the sand can be judged by eye and by
hand on an iPhone before anything in the app changes. The engine itself
(the solver, its shaders, the glass on the solver's grid, the palette, the
GPU's pace, the fills, the grains' drawing, auto Hz and the glass's jolts as
the sand feels them) lives in `realsand/`, which the lab imports, and which
the app loads with Real sand on. The engine also has the metered neck
that is to keep the app's time exact with this sand (`realsand/valve.mjs`
keeps the count; the solver's throttle just above the counting line and its
membrane, which lets a grain cross only downward and only with a ticket,
hold the sand above to the clock's target in every substep; a flip pass
turns the grains end for end when the glass is swapped); it is off unless a
run is given the valve's words, so the lab's sand behaves as before. Open
`https://elkhanany.github.io/hourglass/lab/sand/` in Safari (iOS 26 or
later, which has WebGPU). The phone's motion (**Real motion**), a finger on
the glass, **Flip** and **Reset** move the sand; the buttons choose the
material (coarse and fine sand, water, syrup), the speed (the app's slow
motion, or true gravity for a glass 11 cm tall), the amount and the grid.
It opens on the coarse grid with the 1-minute amount: on an iPhone
(iOS 26.5) the 1-minute amounts held real time at app speed, coarse the only
one that also held real speed, while the medium grid with a quarter glass
ran 8 frames a second at 0.39 of real time, 350 to 730 ms behind. The
sand's realism is judged on the coarse grid only (the scoreboard, the lab
test). On the first visit it times that for a couple of seconds and moves
to a quarter glass, on the same grid, only if the phone has room for it at
the pour's peak rate (scaled from that timing by the phone's own measured
ratio), and says what it did; an amount or grid chosen by hand is kept for
the next visit instead (Copy results says which). At most two frames of
work go to the GPU at a time, and a frame's substeps (the GPU budget) are
cut when frames had to be skipped because the GPU was still busy and raised
while it keeps up, never below what the base rate needs to keep real time
unless the GPU cannot give even that (`realsand/pace.mjs`). Predicted, not
yet measured on a phone: what is on screen follows the phone within about
two frames. Most of the gain over 5cc11b3 is the smaller default: at the
old pace the medium quarter glass trailed the phone by 350 to 730 ms, while
the coarse 1-minute bed took 31 ms from submit to done. When the GPU cannot
keep up the sand runs slower than real time instead, and the HUD says
BEHIND (GPU budget). (More, "N in flight" and "GPU budget", go back toward
the old pace, to compare: up to 3 frames in flight, no budget; a budget
set from the measured time instead, as in 9b0a9f1, would fall to one
substep a frame on a phone whose light frames report about a display frame
whatever their work, as one iPhone's did, and nearly stop the sand:
`tools/test/lab-pace.test.js` keeps that rule as its control.)
**Benchmark** and **Flow test** measure the phone, and **Copy results**
puts a plain-text report on the clipboard to send back: it opens with the
pace and the last two seconds (frames drawn, display rate, lag in display
frames, the GPU's time a substep), and after a Benchmark with the answers:
whether the default holds real time at each speed, and what each costly
option (spread, blur, 8 iterations, yield in the loop) costs against it.
While the sand
moves fast the page runs more substeps a second (auto Hz, shown in the HUD),
so a falling stream or a thrown bed is not held to the solver's one cell a
substep, but only as far as the GPU's budget allows (HELD in the HUD); at
real speed true g wants more substeps than a phone gives, so there the
fastest grains are held to a cell a substep and fall slower than real, and
the HUD says so; at app speed the glass's motion (the finger's, the phone's)
reaches the slowed sand live: the part of a push along the sand's floor
beyond its friction is made as fast as a slowed film of it would make it, at
once, so a jerk moves the bed toward the trailing wall at once (about a third
as far as the slowed film), and a push off or into the floor is felt as it is
(More, "jolts", plays it as slow motion, as the slowed film the lab used
before, or plain). A grain in flight is drawn as the streak it
makes in one display frame, as the eye sees a falling grain, so the stream
through the neck reads as a thread (More, "blur", shortens it or turns it
off); a grain with sand crowded around it is drawn sharp, because the eye
follows a bed that is jerked, shaken or turned as a whole (drawn as
streaks, such a bed looked like brushed hair or straw). Each
grain remembers how tightly it is packed (shaking packs it), and grains
that crowd inside a cell step apart (the spread pass; More, "spread", turns
it off, two fewer dispatches a substep, 14 instead of 16), so a bed at rest no longer
swells and a fast turn or a jerk no longer tears it. More, "yield", lets
sand yield inside the solver's iterations: a slowly turned bed then fails
first at about 35 degrees instead of 40 and stands lower while it moves,
but the Flip's cone spreads to about 20 degrees, so it is off by default.
Still open: a turned bed slides round the glass as a block before it fails
in surface sheets, a fast turn runs out like a heavy liquid, and a bed held
below its angle still creeps. To test: turn on
Portrait Orientation Lock in Control Center (otherwise turning the phone
turns the page, and the page says so), and turn Low Power Mode off (it
halves the display rate). It loads nothing from anywhere else and registers
no service worker of its own; the app's service worker (`sw.js`, whose
scope covers `lab/`) leaves everything under `lab/` to the network and never
caches it, and answers the lab page's requests for the engine (`realsand/`,
which the app caches for Real sand) from the network too, without storing
them, so an update shows on the next load (`app-regression` checks this).
Should an engine of another build reach the lab all the same (a build stamp
other than the page's), the lab says so in its status line, with both
stamps, and asks for a reload with a connection; it leaves the app's caches
alone, since the app's installed copy is a snapshot that only an install
writes (`app-regression` and `app-upgrade` check this too). Its
solver keeps Smoosh's MIT and EA's BSD-3-Clause notices
(`realsand/LICENSES.md`).
The engine, `realsand/`, is its own folder so that the lab and the app
(with Real sand on) load the same files: the solver and its shaders, the glass on the
solver's grid, the fills, the grains' drawing, auto Hz, the felt jolts, the
GPU's pace, and the valve (`valve.mjs`), which keeps the count above the
neck in the app's whole grains and meters the GPU's neck once a frame.
`realsand/build.mjs` holds a build stamp, raised whenever the engine's code
changes (a module or a shader; not for a change in comments alone); Copy
results says which stamp the lab found and which it was written for.
**Timer** (under More) runs the sand as the app will: it fills the
app's amount for a glass (10 s, 1, 10 or 60 minutes, or the 60-minute amount
timed to 4 or 30 minutes; the app's square-root rule on its phone glass, so
1,155 grains for 10 s and 21,917 for an hour, 1.69 points a grain on the
coarse grid) in coarse sand at app speed, lets it settle 0.5 s on the shut
neck, then runs the app's clock, tail and breathing included, through the
valve. The HUD shows the count against the clock's target, the GPU's
shortfall in points, the queue resting on the line, the throttle's speed
(vcap), refused crossings a second and the stream's first fall from the
neck to the floor; at the end, when the last grain left against 00:00.0,
and any grains left above (the residue, which the app will move by a
transfer). Flip turns the glass with the neck shut and the clock stopped,
and swaps the bulbs when the turn ends. Before its clock starts the Timer
times the GPU on its bed by a burst: with nothing else in flight, 24 and 96
substeps ten times each, the cost a substep being the difference of the
medians over 72, which takes out a submit's fixed latency (**GPU cost** does
the same on the bed in the glass). More, **mode**: full (every frame, auto
Hz: the lab as it was, its default), calm (30 frames a second at the same
480 substeps a second, auto Hz off) or auto, the app's rules: full while the
glass is turned, touched or felt to move, at a run's start, in its tail and
for 2 s after; calm otherwise; asleep, with no GPU work at all, once nothing
runs and the sand is still, until it is touched, felt to move or leaned more
than a degree from where it fell asleep (the phone's motion is read every
frame, asleep too); and a heat guard that drops to calm a glass that has run
under 0.6 of real time for 20 s in a row. A Timer starts in auto unless
a mode was chosen by hand. **Rotor probe** (`?rotor=1`; `&bed=10s` or another
Timer glass for a smaller bed) is the app's stack
of canvases: the grains' canvas between two WebGL canvases in a div that CSS
turns, with the 60-minute bed spinning freely at up to 16 rad/s on a shut
neck and the bulbs swapped at every half turn; a frame whose run is skipped
while the canvas still shows the bed from before a swap turns that canvas
half a turn itself (an option skips every third run), and a mark at the far
end of the bulb that holds the sand shows a frame with the sand in the
wrong bulb. Copy results adds the Timer's record and ends, the bursts, the
time spent in each mode, the Rotor probe's counts and a lifecycle log
(visibility changes, a lost device with its reason and the time since the
page was shown, the start-up times).
`node tools/test/lab-sand.test.js [--port <n>] [--only 2,6,9] [--shots <dir>]`
runs it headless in Chromium with WebGPU in software (SwiftShader), on its
coarse grid with little sand and the clock driven by the test; it takes
about an hour and a half, and its speeds say nothing about a phone. Cases 10
to 18 measure the realism found wanting in November 2026 (a bed at rest, a
slow and a fast turn, a jerk, shaking, a press at real speed, the drawn
stream, syrup, creep), with the measures in `tools/test/lib/sand-measures.js`;
case 19 the live loop's pace (at most two frames of work in flight, the lag
within two display frames, or on this software GPU, where a single substep
takes longer than a display frame, two such frames and one display frame;
the old pace is its control); case 20 the Timer (a 10 s glass with a Flip,
and the 1-minute amount timed to 12 s: no grain crosses below the clock's
target, the last one leaves in the substep that holds 00:00.0 or after it,
within a frame, no residue, for the 10 s glass under 0.5 % of the runs
short in the bulk (from 2 s after the start, its first 2 s logged apart),
and the burst puts the
sand back exactly); case 21 the modes on a resting bed (calm and full
alternated ten times move it less than half a cell, and in auto a still bed
sleeps until touched, leaned 5 degrees or turned); case 22 the Rotor probe (the sand always in
the bulb the ledger says, and the canvas turned exactly in the frames whose
run was skipped since a swap); case 23 the glass shaken through its own path,
as the phone's motion comes, live against the slowed film (along the floor
the sand is still 0.15 s after the hand stops, where the film still
sloshes; up and down the bed heaps and is not thrown up in a column). `node tools/test/lab-timer.test.js` checks
the Timer's arithmetic in Node in a second: the amounts, the clock, the
modes (a jolt of 0.3 g wakes a sleeping glass in its own frame) and the
heat guard. Cases 12, 13 and 18 hold the sand to no worse
than 5cc11b3 and say real sand's target beside it: passing them is not
realism. `node tools/test/lab-pace.test.js` checks the pace in Node in a
second, against models of a phone's GPU. The tests step the sand with auto
Hz free to reach 1440 (2880 at real speed); `__lab.settings({ hzMax: 960 })`
steps it as a phone's GPU budget may hold it, which changes how a jerk
settles. The lab test's failing checks
are the sand's open problems, so `run-all.js` runs `lab-sand` only when
asked (`node tools/test/run-all.js lab-`); `lab-timer` and `lab-pace`, in
Node, run with every other suite.
