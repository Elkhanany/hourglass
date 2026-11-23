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
  that must fail. `check-shell`: every file `index.html` and the manifest
  name is in the service worker's `SHELL` (the launch screens and the
  install screenshots excepted), every `SHELL` path exists, once, and no
  classic script (the page's and `sw.js`) has module syntax, `import()` or
  anything newer than ES5. `check-licences`: every file under `realsand/`
  and `lab/sand/` is in `realsand/LICENSES.md`, and every file the table
  names exists. `check-release`: a branch that changes a shipped file
  (`sw.js` or a path of its `SHELL`) raises `VERSION` above both the
  merge-base's and `origin/main`'s, as a version number, and `index.html`'s
  version, where the page has one, equals it; it needs `origin/main`
  (`HOURGLASS_MAIN=<ref>` names another). `check-harness`: the test guards
  themselves: `tools/test/lib/paths.js` reads the page's scripts from
  `index.html`, a suite that still reads one `physics.js` fails at once, and
  the browser harness refuses a tree that lacks a script the page loads,
  naming it.
- On GitHub, every pull request and every push to `main` runs the check
  group and the Node suites that take seconds (`.github/workflows/checks.yml`
  lists them; about three minutes, no browser and no `npm install`). The
  browser suites, the longer Node suites and `realsand-gpu` are run by hand,
  as above, and their results go in the pull request
  (`.github/pull_request_template.md`).
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
  (`HourglassPhysics.SHAPES`; the app does not offer them yet): for every
  registered shape, the classic teardrop first as the reference, what the
  sand needs of the lattice at every size the app builds, the clock of a
  one-minute glass upright, leaned 12 degrees and on Finest sand, the fullest
  glass fitting under the neck, the Flip, pours that fill it to exactly its
  cap, layered sand, a hard shake that must never write sand into the glass,
  and going quiet after hard jerks; and that glasses the sand cannot use are
  refused by name, each by its own rule.
  (`HOURGLASS_SHAPE=delta node tools/test/sim-clock.test.js` runs any `sim-*`
  suite on another shape; many state what the teardrop does, so some of
  their cases then fail without anything being wrong.) The
  others cover cracks, leaks, mending and saving (`p0`), conservation,
  sanity, flight, fracture, spinning, knocking, leak, flip, persistence,
  determinism, the valve, the clock and performance.
- `render-*`: the crack paths, their redraw and the spilled sand's physics in
  Node; cracks, their glint, kintsugi and the spill in the real app; and,
  with no cracks, the picture against f446085, pixel for pixel.
  `render-shape` draws every glass shape as the app would and reads the
  layers back: no pixel of sand outside the glass, mid-run and through the
  Reset sweep; the drawn glass's wall on the shape's own curve, and as thick
  all along; the collars covering the ends; the layers their own half turn;
  the lights on the glass; cracks on it.
- `motion-*` and `audio-*`: the sensor pipeline (against a model of a phone
  being shaken, in each browser's sign convention) and its permission, and
  the sound engine's calls and levels, and the water ambiences: that each
  starts, switches and stops leaving nothing behind, their levels, that
  nothing clips behind the sand, their synthesis slices, and the fallback for
  browsers that refuse low sample rates. `audio-levels` also holds the bed
  of a glass that is moved while no stream runs (before the start, paused,
  finished), fed what the classic sand gives the app for that motion:
  silence at rest; a 1.5 g 5 Hz shake, 2 g up and down and a lean past the
  slope each within 3 dB of the level it was built at, the lean louder on
  its low side (a sand reporting a quarter of the shake's feeds fails that
  check, its control); and the lean heard only where no stream runs (the
  same slides under a running stream leave the rush at nothing). `audio-api`
  also checks that one touch is enough, in a Chromium launched with its own
  autoplay policy (sound only after a gesture, as on an iPhone; the page is
  driven by an init script and reports on its console, since a script
  evaluated from outside counts as a gesture): on a fresh page with the
  glass idle the bed's feeds play nothing; after one touch that starts
  nothing (the glass taken, moved and let go) the context runs and the same
  feeds thump, rush and shimmer, with sound at the output; the same events
  made by a script leave the context suspended (the control).
- `app-*`: the app's own acceptance tests (permission, gestures, motion,
  re-timing, session, the existing flow), on the app as it ships
  (`app-motion` also has the classic sand heard before the start: nothing at
  rest; leaned past the slope, thousands of slides a second and the rush,
  softly, on the low side; shaken, the rush and the shimmer; no stream and
  no ambience in either; and the same lean under a running stream leaving
  the rush at nothing, its control): every
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
  the app as an iPhone would after the update, Real sand on. `app-breath` covers breathing pace: the Tune row and what is
  saved, the toast's place in the sheet's head, the three patterns against
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
  analyser on the sound engine's last node (unmuted, it is not); a start
  that fails keeps the setting
  and stops after three launches; a stale build stamp says it is updating;
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
  engine), and a rebuild that finds no device; points stuck above after a
  sequence ended while hidden (moved by the residue rule); the GPU sand
  asleep drawn again after a theme, a turn of the screen and the Frame
  switch; the handover held until a Flip is over; and a glass that does not
  crack: the drop that cracks the CPU sand's glass (its control) only thumps
  and clacks, quick knocks crack
  nothing, a crack from before stays, leaks nothing and mends, Reset makes
  it whole, and a theme or layered sand chosen while the GPU sand runs (the
  new colours at once; a re-tone that moves no grain); and `?debug=sand`
  and the row's "Copy a report", whose report carries the start-up times
  and the stream's first fall to the owner's reports. The monitor every suite runs (`stubs/page-init.js`) follows
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
  and one offline (no error, no 504, one cache, and Tune's last line
  "Version X.Y.Z" with nothing after it), then a newer release installed
  while the page is open (the line says the update is ready); a release
  whose `SHELL` names a missing file (its install fails, leaves no cache,
  and the installed release runs whole, online and offline); a script taken
  out of the cache (offline the page says it is updating; one launch with a
  connection fills the cache again, from the same release only); and a lab
  page that meets another build (the app's cache stays whole). Its controls
  run 13a9772's worker and lab (v1.9.0, the last release before the
  snapshot worker), which fail the same checks: an empty cache left by the
  failed install, the next release's files on the page, the engine dropped
  from the cache. It needs `origin/main` and 13a9772 from git
  (`HOURGLASS_MAIN=<ref>` names another first release).
  `app-layers` covers layered sand: the Tune switch, its saving, a new glass,
  pour, flip, a restored session and Reduce Motion. `app-ambience` covers the six
  ambience cards: the radio group as a screen reader meets it, two rows of
  three from 320 to 430 px and in landscape, choosing, saving and restoring.
  `app-gestures` also covers Zen: none by itself, in by spreading two fingers
  or the moon icon, out by pinching or `Esc`, and unchanged by taps, by
  playing with the glass, by a second finger while it is carried, and by a
  pinch while a sheet is open. `app-haptics` covers the iPhone's taps: a
  label over a hidden switch on every control and on the stage, the switch
  flipping exactly when the app asked for a tap, every control still doing
  its work once, and scrolling, pouring, carrying and pinching unchanged.
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
  refused), the grains' colour seeds against the grain shader's own hash, and
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
  frame: every `sim.` member the app and the audio use, with the CPU Sim's
  type; the fills from the CPU Sim's lattice (exact counts, each grain's
  colour); each place where the sand sets the clock (a start after the end,
  the Flip's swap, a tilt swap, pours, a re-time after a starved neck, a
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
  library a page with the shaders' build checked.
  `realsand-shell` checks the service worker's shell for Real sand: every
  path in it exists (one missing would fail the whole install), every module
  `realsand/boot.mjs` loads and every shader of the engine is in it, and
  `app.js`, the lab, the engine and its shaders name the same build stamp.
  `realsand-gpu` runs only when named (`node tools/test/run-all.js
  realsand-gpu`, 10 to 15 minutes, every core busy): the app with Real sand
  and layered sand on the real engine, on Chromium's WebGPU in software
  (SwiftShader), loaded with `?offscreen=1`. Software runs the sand at a few
  hundredths of real time, so once the engine has started the page's clock
  is made virtual (its time, frames and timers driven by the test, a frame
  at a time, each once the chip has done the last), and the sand runs at
  real time in it. Seven cases on 10 s glasses: the start and the handover;
  a glass to its end, its last grain crossing within one frame after
  00:00.0 by the chip's own record, with no catch-up and no residue; Reset;
  a Flip at 4 s; a pour, then real motion turning the glass over while sand
  is poured; 30 s hidden and caught up by one transfer; and the chip lost
  mid-run (the CPU sand at the same counts in the same frame, the clock
  untouched, then back). With `--shots <dir>` it saves pictures of the app
  with Real sand on.
- `e2e-*`: the integration scenarios on the real modules: calm (E1, E11),
  motion (E2, E3, E14), timer (E4, E5), gestures (E6–E8), session (E9, E10),
  permission (E12) and performance (E13).
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
[Architecture](architecture.md#standing-decisions).

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
It opens on the coarse grid with the 1-minute amount: on the owner's iPhone
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
whatever their work, as the owner's did, and nearly stop the sand:
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
`realsand/build.mjs` holds a build stamp, raised with every change to the
engine; Copy results says which stamp the lab found and which it was written
for. **Timer** (under More) runs the sand as the app will: it fills the
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
