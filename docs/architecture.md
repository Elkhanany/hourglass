# Architecture

The files and how they fit together: the layout, the controller, the page
and its look, the offline cache, running and deploying the app, and the
rules every release follows. How the sand, the glass, the motion and the
sound work is in [How it works](engines.md).

## Project structure

```
index.html  styles.css      the page and its look (one screen, two sheets)
app.js                      the controller: clock, gestures, Zen, settings, sessions
physics.js                  the sand simulation, the glass, cracks and spilled sand
audio.js                    the procedural sound engine
motion.js                   the phone's motion sensors
sw.js  manifest.json        offline cache and install metadata
realsand/                   the GPU sand engine: the sand lab's, and the app's with Real sand on
  boot.mjs  app-sand.mjs    what the app loads, and RealSand, the GPU sand as the app's sim
  valve.mjs                 the ledger of the sand above the neck, and the neck's meter
  solver.mjs  shaders/      the solver on WebGPU and its WGSL
  glass.mjs  fill.mjs       the glass on the solver's grid, and its fills from the app's sand
  grains.mjs  layers.mjs    the grains drawn, and layered sand on the GPU
  modes.mjs  rate.mjs  pace.mjs  felt.mjs  palette.mjs  build.mjs  LICENSES.md
lab/sand/                   the sand lab, a test page that is not the app
icons/                      app icons and iPhone launch screens (icons/splash)
docs/                       the guide, how it works, the architecture, the tests, and the designs
docs/images/                the pictures in the README and the install screenshots
tools/icons.html            regenerates the icons from one SVG
tools/test/                 development-only tests (not part of the app)
```

The app is plain files with no build step: whatever is in the repository is
what the browser runs.

## `app.js`, `index.html`, `styles.css`

Timer state, controls, Zen HUD, settings and the running session (stored in
`localStorage`, with the glass's damage), the glass as a body (springs for the
finger, home and the detent, a coasting spin that conserves angular momentum
as the sand moves, and a catch that stops the glass where the finger meets
it), the felt field composed for every physics step, re-timing, the Real
motion permission, screen wake lock, a frame-time governor that lightens the
physics on slow phones, and service-worker registration. The clock uses
`Date.now()` so it keeps counting while a phone sleeps. A hidden
`?debug=motion` overlay shows the sensors and the sand's state, and `&rec=N`
records N seconds of raw sensor events to a file, for tuning on a device.

A new glass (Reset, or another duration) takes about a second. The old sand
is drawn into the neck: the picture of it is carried as an incompressible
sheet flows into a point sink, the square of every grain's distance from the
neck falling by the same amount, so the nearest sand goes first, a funnel
sinks into the upper bed, the heap below is eaten from its apex, and no grain
changes size on its way (0.38 s). Then the glass is made new, once, exactly as
before (`sim.reset`), and its sand is poured: the new bed is shown up to a
surface that rises as a steady pour would raise it, grain for grain, heaped
at 32° under a thread that falls from the top of the bulb and level at the
end, lit as a surface while it is one, with the pour's own sound (0.62 s).
Only the picture is touched (`Renderer.setSweep`); the sand changes at the one
moment in between. The clock stands still meanwhile, and a glass that is to
run (another duration chosen while it ran, or Start tapped during the sweep)
starts as the last of its sand lands. Another duration chosen during the pour
is poured next; a page hidden in the middle has its glass made at once. With
Reduce Motion it is the cross-fade it was.

A work and rest sequence is the rest's length, the number of rounds and the
index of the running phase (even: work, odd: rest); the glass is still sized
for the work time. Each phase is calibrated when it begins, so that the
grains then above the neck last exactly its length. When the clock of a phase
that is not the last reaches zero, `phaseEnd` opens a gap if it is watched:
the bowl at 0.75 s, the scripted turn at 1.2 s (as soon as no hand holds the
glass), and the next phase from the end of that turn. Unwatched (the page
hidden, or back from a sleep), it walks the wall clock through the phases and
turns that have passed, 3.8 s for each turn, lays the sand in the upper bulb
again with the glass's cracks turned as often, and goes on from there. The
session stores the sequence and its phase; a reload walks the clock the same
way.

Breathing pace is more of the ambient light on a layer of its own (`#breath`,
inside `#ambient`, tinted through `--glow` like the rest; it exists only while
the switch is on and is clear at rest). Each part of a breath (in, hold, out,
hold) is one CSS transition of that layer's opacity and scale on a sine ease,
so the compositor does the breathing: nothing is laid out or painted again
and no script runs per frame; a timer only begins the next part. (Chromium
still recomputes the layer's style on each frame it draws while a breath is
moving, a fraction of a millisecond.) The part is worked out from
`Date.now()` every time, and a part begun late is entered that far in (a
negative `transition-delay`), so a slow frame never shifts a breath, and a
page that was hidden or a phone that slept comes back in the breath the clock
says. When the glass is paused, finished or reset, the glow is stopped where
it is and eases back to rest in 2.4 s. On a wide screen the layer's three
pools of light take their width from the height (`--b1` to `--b3`), so the
swell stays a halo round the glass instead of a band across the screen. A
saved pattern this version does not know falls back to Calm.

A toast said while Tune is open (the breathing hint, a Real motion message)
would lie on the rows it is about, so it sits in the sheet's head instead,
between the title and the close button, placed from where the sheet really
is, and it fades there when the sheet is closed. Said anywhere else, a toast
keeps its place above the controls.

## `sw.js`, `manifest.json`

Offline-first, stale-while-revalidate cache of the app shell. Every path is
relative (`./`), including `start_url` and `scope`, so the app works from a
sub-directory such as `/hourglass/`. The shell includes the GPU sand engine
the app loads with Real sand on (`realsand/`: its modules, its shaders and
its licences), so Real sand works offline. The sand lab's pages (`lab/`) are
not the app: the worker leaves them to the network, and a lab page's own
requests for the engine go to the network too and are never stored (the
worker tells them by the request's client), so the lab shows a new engine
on its next load.

## Icons and launch screens

`icons/` holds the SVG source and the PNG sizes the manifest and iOS need.
`tools/icons.html` regenerates all of them in the browser from one SVG
template; it is not part of the installed app. `icons/splash/` holds dark
launch screens for current iPhone sizes, so an app opened from the home screen
never flashes white before its first frame.

## Running locally

Any static file server works. The page must be served over `http://localhost`
or HTTPS for the service worker to register.

```bash
npm start                      # or: python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Deploying to GitHub Pages

1. Merge to `main`.
2. Repository **Settings → Pages → Build and deployment**: *Deploy from a
   branch*, branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/hourglass/`.

The empty `.nojekyll` file in the repository root tells Pages to serve the files
as they are, without running Jekyll.

When you change any shipped file, bump `VERSION` in `sw.js` so installed copies
drop the old cache. An installed app picks up a new version on its second
launch after the change (the first launch fetches it in the background).

## Releasing

A release is what the service worker installs on a phone: everything in
`SHELL`, under one `VERSION`. A change that is not a release (the documents,
the tests, the lab) needs none of this. For every change to a shipped file:

1. **`VERSION` goes up.** Any change to `sw.js` or to a file in its `SHELL`
   raises `VERSION` in `sw.js`, as a version number greater than both
   `origin/main`'s and the one the branch started from, and `index.html`'s
   version, where the page has one, equal to it. Without it, installed
   copies never see the change. `check-release` holds a branch to this.
2. **A new, moved or removed file** has its `<script>` tag in `index.html`
   (if the page loads it), its line in `SHELL` (one path that does not exist
   fails the whole install), and its row in `realsand/LICENSES.md` if it is
   under `realsand/` or `lab/sand/`. `check-shell` and `check-licences` find
   what is missing.
3. **A change under `realsand/`** raises the engine's build stamp in all four
   places together: `realsand/build.mjs`, the line "Engine build" in
   `realsand/shaders/common.inc.wgsl`, `REALSAND_BUILD` in `app.js` and
   `BUILD_EXPECTED` in `lab/sand/main.mjs`. `realsand-shell` checks that they
   match, and that every module and shader the engine loads is in `SHELL`.
4. **The check group, the suites the change touches, and every `app-*` and
   `e2e-*` suite run** (see [Tests](testing.md)). Timing checks are judged
   on a quiet machine: a failure under load is run again alone before it
   counts.
5. **After the merge, on a phone with the app installed:** open it once
   with a connection, close it, and open it again; Tune shows the new
   version. Then, in airplane mode, it opens and runs.

## Standing decisions

These hold until a change says otherwise, with its reason.

- **No build step, no framework, no dependency.** What is in the repository
  is what the browser runs. Playwright is a development dependency of the
  tests only.
- **Classic scripts for every file the page loads; ES modules only behind
  the WebGPU switch.** `index.html` loads `physics.js`, `audio.js`,
  `motion.js` and `app.js` as classic ES5 scripts. A syntax error stops a
  whole file, and an old parser rejects a file that holds `import()`, so
  `app.js` stays classic and appends `realsand/boot.mjs`, the only module
  the app loads, and only with the Real sand switch on where `navigator.gpu`
  exists. `check-shell` checks every classic script for module syntax,
  `import()` and anything newer than ES5. The
  Node suites load `physics.js` as a classic script into isolated contexts,
  two versions side by side, which ES modules would not allow without a
  flag.
- **The classic sand is always built.** It is the glass's model under Real
  sand too (its geometry, capacity, cracks and flaws), the source of every
  fill of the GPU sand (each grain's place and colour), the record the sound
  reads, and the fallback in the same frame when the GPU sand fails.
- **The baselines.** The sand and its picture are pinned to earlier
  versions read from git: f446085's `physics.js` (`sim-identity`: with
  nothing moving, every grain lands as it did; `sim-flip`;
  `render-regression`: with no cracks, the picture pixel for pixel, and
  `drawSand`'s time within 5 %), f446085's `audio.js` (`audio-levels`: the
  sand's level), and 7f71786's colour table (`sim-tone`: layered sand off is
  the table it always was). A change that only moves code passes them with
  no change of baseline; a change to the drawing that must change pixels
  ships its new baseline in a commit of its own, reviewed.
- **Every shipped change raises `VERSION`** (above).
- **The service worker takes over at once** (`skipWaiting`,
  `clients.claim`): an app on an iPhone's home screen is suspended far more
  often than it is closed, and an update would otherwise wait for days.
  Files a page loads later (the engine's modules and shaders) can then come
  from a newer release; the build stamps catch that, and the page keeps the
  classic sand until its next launch.
- **What an iPhone allows a web app** decides a good deal: motion
  permission is forgotten when the app is closed, so it is asked for by a
  tap at each launch; there is no vibration API, so a tap is felt through a
  switch control under the finger; a locked phone stops the page, so the
  bowl is heard only while the app is on screen; WebGPU needs iOS 26; the screen wake lock needs iOS 18.4
  in a home-screen app; a home-screen app keeps its own storage and opens at
  its own address. The [guide's browser notes](guide.md#browser-notes) say
  what each means for the person using it.

## Design documents

`docs/design/` holds the designs the code was built from. A code comment
that cites "(design N)" or "(design N.M)" means that section of
[Real sand: the design](design/real-sand.md). If the settings design is
committed, it will be `docs/design/settings.md`, cited as "(settings design
N)".
