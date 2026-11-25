# Architecture

The files and how they fit together: the layout, the controller, the page
and its look, the offline cache, running and deploying the app, and the
rules every release follows. How the sand, the glass, the motion and the
sound work is in [How it works](engines.md).

## Project structure

```
index.html  styles.css      the page and its look (one screen, two sheets)
app.js                      the controller: clock, gestures, Zen, settings, sessions
app/settings.js             the settings store: a record for every saved key, load and save
glass/                      the hourglass (pieces of HourglassPhysics, below)
  shapes.js                 the glass's geometry and the shapes it can take: makeGeometry, profile, SHAPES
  gl.js                     the glass drawn by WebGL
  renderer.js               the picture: the glass, the classic sand, the Reset's sweep, the frame and caps
  cracks.js                 cracks on the glass, its mends and their glints
  spill.js                  sand that has left the glass, falling and gathering on the desk
sand/                       the classic sand (pieces of HourglassPhysics, below)
  sim.js                    the simulation of every grain on the CPU, and the glass's lattice
  sands.js                  the sands and their colours: THEMES, SANDS, the finishes, customSand
sound/audio.js              the procedural sound engine
motion/motion.js            the phone's motion sensors
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
tools/audio-identity.js     run by hand: shows that a change to sound/audio.js changed no sound
tools/split-physics.js      run by hand: cuts a physics.js of a branch from before the split into the pieces
tools/test/                 development-only tests (not part of the app)
.github/                    the quick checks on every pull request, and the pull request template
```

The app is plain files with no build step: whatever is in the repository is
what the browser runs.

## The classic sand and the glass: seven pieces

Until 1.18.0 the classic sand and the glass were one file, `physics.js`.
They are now seven classic scripts that `index.html` loads in this order,
before the sound engine: `glass/shapes.js`, `sand/sim.js`, `sand/sands.js`,
`glass/gl.js`, `glass/renderer.js`, `glass/cracks.js`, `glass/spill.js`.
Together they make one namespace, `HourglassPhysics`, with the same names
`physics.js` exported (the app's API: `Sim`, `Renderer`, `Spill`, `SANDS`,
`SHAPES`, `addShape` and the rest). Each piece is one or two of the old
file's banner sections, byte for byte, inside a wrapper:

```js
(function (root) {
  'use strict';
  var P = root.HourglassPhysics || (root.HourglassPhysics = {});
  var _ = P._ || (P._ = {});        // names the pieces share that are not the app's
  if (_.loaded !== 'glass/shapes.js') return;   // a piece before this one is missing: define nothing
  var makeGeometry = P.makeGeometry, profile = P.profile;     // what it reads from earlier pieces
  ...the section, as it was...
  P.Sim = Sim; _.WALL_BINS = WALL_BINS;                       // what it gives later pieces and the app
  _.loaded = 'sand/sim.js';
})(typeof window !== 'undefined' ? window : globalThis);
```

- A piece reads what it needs once, at load, from the pieces loaded before
  it. A name the app uses is on `HourglassPhysics`; a name only the pieces
  share is on `HourglassPhysics._`.
- Each piece but the first runs only if the one before it ran. So when a
  piece is missing from an installed copy, none after it defines anything,
  `HourglassPhysics.Spill` is missing, and `app.js`'s pre-flight check says
  the app is updating, as it did when `physics.js` was missing.
- `check-pieces` (the check group) fails a name one piece uses and another
  declares without its import line, an import from a piece loaded later, an
  export of a name the piece does not declare, and a broken chain, by file
  and line ([Tests](testing.md)). An unimported name would otherwise fail
  only when its code runs; where the WebGL glass is built such an error is
  caught and the plainer 2-D glass drawn instead.
- To add to a piece: write the code in its section; if another piece needs
  a new name, add it to the first piece's export line and the second's
  import line, and run `node tools/test/run-all.js check-`. A new piece needs
  its `<script>` tag in `index.html` (in load order), its line in `sw.js`'s
  `SHELL`, and the wrapper above.

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

Tune (`#sheet-settings`) is four tabs, Sand, Glass, Sound and Time, at one
height. Its top edge sits 44 px under the neck of the glass as it is drawn:
`layout()` (and entering or leaving Zen) sets `--tune-top` on the sheet from
the glass's centre at home, `R0.cy + R0.dy`, so the upper bulb, the neck and
the stream stay in view while anything is chosen; the sheet is never less
than 220 px tall, and a phone on its side keeps the old limit (the sheet's
top 28 px under the safe area: the glass is beside it there). The tab row
never moves; what a tab holds changes only how far it scrolls. All four
panels are in `index.html`, one of them shown (the others `hidden`), so
every button is there for the haptic labels at boot (the Glass tab's shape
buttons are made by `app.js` from the shapes registry, before the labels
are put on). Tune opens on the tab
last used (the setting `tuneTab`), each tab from its top; a tap on a tab
saves it and ticks, the arrow keys, Home and End move along the tab row.
The tests find every control through this markup and nothing else, so a
later Tune must keep three things: every control inside one
`[role="tabpanel"]` inside `#sheet-settings`, each panel named by a tab's
`aria-controls`, and a panel that is not shown having the `hidden`
attribute. Behind Tune the scrim is 0.2 dark (0.5 behind the custom
duration), so the colours above the sheet read true.

The look is two choices, from release 1.14.0: the sand (Tune's Sand tab,
`#sands`: the nine of `HourglassPhysics.SANDS` and Custom, a sand made from
one colour by `customSand`, set in the well under the swatches, the colour
input itself) and the frame's finish (the Glass tab, `#finishes`: the caps of
the six themes, `FINISHES`, hidden while the frame is off). `app.js` hands
the renderer one of the six sands over its own caps as the bundle it has
always drawn (`renderer.setTheme`), so the six looks of before are the same
pictures, pixel for pixel; any other pair is put together by
`renderer.setLook({ sand, material })`, and Real sand's palette follows each
change, since it is the renderer's colour table. A colour being dragged in
the well changes the table at most once a frame (`setLook` with `live`) and
draws the glass and frame once it is let go, then saved. The chip at the top
steps through the sands. `Hourglass.setTheme(id)` is still the material of
before (that sand over its own caps), for the tests and for the curious.

The last thing in the Time tab is a quiet link, "Put the look and sound
back as they came". Its first tap asks for a second within three seconds (a
second tap sooner than 0.4 s, half of a double tap, is not an answer); the
second sets the sand (with the material that follows it), the frame's
finish, the frame, layered sand, the volume, the sand's sound, the ambience
and its level and its fade before the end, the completion bowl, its rings
and its level, and the sand's level to their records' defaults (the custom
sand's colour is kept, for its swatch; the six quick durations and Show when
it ends are kept, as the durations are), saves once, and tells the engines only what differed, the look
behind one cross-fade. Everything else is kept, Sound in silent mode among it
(how the phone treats the app: put back on, it could ring in a quiet room),
and nothing is loaded again.

The Sound tab holds, under the sand's sound cards, the sand's own level (one
gain in `sound/audio.js`, `gSand`, between the sand's faders and the bus: the bowl
and the ambience do not pass it), and under the completion bowl its rings
and its level. The rings are kept on the wall clock (`rings` in `app.js`:
the first ring's time, the next ring's number and the last's) and rung from
the frame loop, so a hidden page rings nothing and a ring whose time has
passed is dropped, not played late. While the bowl is still to ring, a
listener on the window that sees events first (capturing) takes the first
pointer down or key and the rest of its gesture (its lift, the click, the
touch and mouse events, the key's lift): it stops the bowl and goes no
further. The ambience's fade before the end is worked out by `app.js` from
the time left (`ambFadeShare`) and handed to the sound engine with every
frame, which glides a gain after the ambience's bus (`ambEnd`) to it. Sound in
silent mode is the page's audio session, which `sound/audio.js` sets when the
sound is first unlocked and at once when the switch moves; with it off the
app sets it at the launch too.

The Time tab opens with the six quick durations (the setting `quick`,
"1,5,10,15,30,60" as the app comes), then "The clock": Show when it ends
(`endsAt`) and Keep screen awake. The six pills under the glass are made
from `quick` and nothing else: `index.html` has six empty pills, and
`app.js` (`showQuick`) writes each one's minutes, its `data-min` and its
name, and the six buttons of the Time tab. A button opens the custom
duration's own sheet in a mode of its own (`customMode`: its minutes only,
1 to 99, no seconds and no rest, "Set 10 min"); Set saves `quick` and
redraws the pills at once (`setQuick`), and the sheet closing, set or not,
brings Tune back with the focus on that button. The lit pill is the first
whose minutes are the glass's; the glass itself is never changed by a
pill's number. Show when it ends is a span (`#ends`) put into the state
line while a glass runs (not paused, turning, between two phases or done):
`Date.now()` plus the time left, formatted by `Intl.DateTimeFormat` in the
language's short time (`timeStyle: 'short'`), worked out again only when its minute changes and
written only when its words do (`showEnds`, once a frame). It is hidden
from a screen reader (the state line is a polite live region, and an end
that moves, a glass on its side, would be read out every minute); the
time's own label carries it instead.

At the top of the Glass tab, a tap on a shape only shows it; "Use this
shape" saves the setting `shape` and the session, and loads the page again,
as another grain does. Before it reloads it puts `glass` in
sessionStorage's `hourglass.openNow` (the note that already skips the held
veil), and the next start reads that note once and opens Tune on the Glass
tab at once, with no slide.

A toast said while Tune is open (the breathing hint, a Real motion message)
would lie on the rows it is about, so it sits just above the sheet, its
lower edge 4 px over the sheet's top, placed from where the sheet really is
(at the top of the screen on a phone on its side), and it fades when the
sheet is closed. Said anywhere else, a toast keeps its place above the
controls.

## `app/settings.js`

What the app keeps from one launch to the next is one JSON object in
`localStorage`, under `hourglass.settings.v1`. The settings store holds it as
a table of records, one for every saved key (43 today), in the order the
keys are saved:

- `id`, the key;
- `default`, its value on a new install. Its type is the setting's type: a
  saved value of another type is dropped;
- `valid(value, reg)`, where a value must be checked: false puts the default
  back (the material must be one of `HourglassPhysics.THEMES`, the sand one
  of `SANDS` or `'custom'`, the custom colour "h,s,l" or nothing, the finish
  one of `FINISHES`, the grain 1 or 2, the accelerometer's sign 1 or -1,
  Tune's tab one of the four, the quick durations six whole minute counts
  of 1 to 99, `quickOf`: one bad count and all six are the default). A name is one of a table's only when the
  table has it as its own: a name every object has (`toString`, `valueOf`,
  `__proto__` ...) is none, and gives the default. It does not clamp: a value outside
  its range comes up as the default, not as the nearest end;
- `from(saved, reg)`, where a setting is made from older ones: the value for
  a save that has no such key yet. A migration is keyed on its own key being
  absent, never on a version, so that settings can ship in any order
  ([settings design 5.1](design/settings.md)). It is handed the save as it
  was read, before any type is checked, so it must stand any value under any
  key; one that throws, or gives another type, costs its own key the
  default. Two records have one (release 1.14.0): `sand`, which a save from
  before takes from its material (`theme`), and `finish`, the caps of that
  material (`HourglassPhysics.finishOf`: Sahara Quartz walnut, Volcanic Black
  brass, Moonstone silver, Lapis Lazuli gold, Rose Quartz copper, Sea Glass
  driftwood), so that an old glass looks as it did.

After the shape come the Sound tab's five (settings design 3.3), each with
the sound as it was for its default, so a save from before them comes up
sounding the same: `sandLevel` (0 to 1, Tune's Sand over 100, default 1),
`bowlLevel` (0 to 2, Tune's Bowl over 50, default 1), `bowlRings` ('once',
'three' or 'tap'), `ambFade` (0 for off, or 60000, 300000 or 600000 ms) and
`silentRing` (true). A level out of its range, or a choice that is none of
its record's, is the default. The last two are the Time tab's: `quick`
("1,5,10,15,30,60") and `endsAt` (false).

`HourglassSettings.load(storage, search, reg)` gives the values: the
defaults; over them the saved values of the right type; the version step
(the settings carry `v`; a save of no version, or of version 1, comes up with
Real sand on, once, and the values then say version 2); the checks; and the
repairs that read two keys (`?t=300` sets the duration and ends a saved
sequence; a rest out of range is no rest; without a rest there is one
round; a custom sand without a colour is its material's sand). `save(values)` writes them back. Storage that throws, or cannot be
reached at all (private mode, storage blocked), runs with the defaults and
saves nothing. When the load could not read the storage (`getItem` threw)
but writing works, `save()` first reads it again: while that throws too,
nothing is written; once it reads, a save that is missing or is not JSON is
written as usual, and a save that is there is left as it is for the rest of
that launch (the next launch reads it). One failed read never writes the
defaults over the settings. The file reads nothing when it loads, so the tests load it in
Node as it is.

`app.js` keeps the loaded values as `settings`, writes them and calls
`save()`. Everything that applies a setting stays in `app.js`, in its order:
the grain's pace before the Sim is built, layers before the glass is filled,
the sound engine's fields before the saved character and ambience are checked
against the engine's own, and every control's handler, which saves, tells the
engine and buzzes inside its tap (an iPhone ticks, and asks for motion, only
from inside one). The store draws nothing and binds none of today's
controls. For the plain switches of a later Tune it has
`bindSwitch(el, key, after)`: the switch shows the loaded value from when it
is bound, and when it flips, the value is set, saved, and `after(value)`
called, in that order, inside the event.

To add a setting: one record at the end of the table, after the ones there,
with a `from` if an older save should come up with something other than the
default; then its row, its handler, its line at the boot, its lines in the
Tune trace's driver, and the two kept traces made again. The steps are in
[Engines](engines.md#adding-a-sand-a-glass-shape-a-sound-or-a-setting).
`settings-unit` needs no change for it.

Three checks hold the store, and whatever is built on it, each to a file in
`tools/test/base/`. The loader's file is the app before the store: the
Settings section of the last release before it (1.11.0, whose section is
1.10.0's byte for byte; `tools/test/lib/base.js` names its commit). The two
traces are a reviewed record: each holds the tree named in its file's
`from`. They were first made from that release, then made again whenever a
setting or a control was added on purpose, each time in a commit of its own
that says what changed and nothing else; that chain of commits is what ties
them to the app before the store. (A trace suite run with `--base <commit>`
also runs that commit and prints how it differs from the kept trace: a
report for whoever makes a trace again, which passes and fails nothing.)

- the loader (`settings-unit`, in Node): the old Settings section of
  `app.js`, kept byte for byte, and the store are run on the same 500 saved
  states (keys missing, wrong types, values out of range, saves that are not
  JSON, `?t=` queries, with and without a version, storage that throws) and
  must give the same settings in the same order, the same saved JSON byte for
  byte, and the same again on a second launch. So must the Settings section
  `app.js` has today, the few lines that call the store, run as `app.js` runs
  them: the storage handed over as a function (a blocked storage throws when
  it is reached, and the store reaches it inside its own try), and the query
  given to the preset (a shortcut starts a new glass over a saved session).
  The old section knows the 31 keys the app had then: they are the store's
  first records, in their order, and a record added since is left out of
  this comparison. Two differences are made on purpose, and held: a saved
  theme that is a name every object has (`toString`, `valueOf` ...) is the
  default material, where the old section kept it; and where reading the
  storage throws, the store writes nothing, where the old section wrote the
  defaults. The suite also holds the names: every `settings.…` in
  `app.js` is a record, and every record is named there;
- the boot (`app-boot-trace`, in the browser): for six saved states, what
  the app reads and saves and what it calls on the Sim, the Renderer, the
  sound engine and the motion sensors until it has started, in order;
- Tune (`app-tune-trace`, in the browser): for every control that changes a
  setting, what its tap saves, calls and buzzes, and what follows (the
  cross-fade, the answer to the motion question, the reload a grain makes).
  The controls are named for what they set, not for the page's markup, so a
  new Tune is compared with the same file. Every switch, choice and slider
  of Tune's sheet must be one the trace drives.

A setting or a control added on purpose changes the two traces: each suite,
run with `--write`, writes its file from the tree just run, in a commit of
its own that says what changed and nothing else, and whose diff is read.

## `sw.js`, `manifest.json`

Offline first. An installed copy is a snapshot of one release: the app's
files (`SHELL`) come only from the cache named by `VERSION`, and only an
install writes that cache, all of the files or none (`cache.addAll`). When
the last file is in, the install reads the server's `sw.js` once more and
fails unless it still names the same `VERSION`: a deploy that came during
the download would leave files of two releases in the cache, and such a
copy is not kept. So an installed copy holds one release. Lookups ignore
the server's `Vary` header (`ignoreVary`): the entries are this release's
own files, and a lookup that missed would miss at every launch. Nothing
refreshes them in the
background: a new release reaches a phone only as a new `VERSION`, whose
install fills a cache of its own; the old one is deleted when the new
worker takes over. An install that fails (a file that would not download)
deletes the cache it made and leaves the installed release as it was.
Should a file be missing from the cache all the same (a hole), it comes
from the network, and the worker fills its cache again, whole, but only if
the server's `sw.js` still names the same `VERSION`; if it names another,
the worker looks for that release, whose install fills its own cache (that
one launch can run a file of the newer release beside the installed ones:
the one case left in which two releases meet).
Offline, a hole cannot be filled: the page then finds a script missing and
says "Hourglass is updating. Open it again with a connection." instead of
building anything (`app.js`'s pre-flight check, which `check-shell` tries by
running the page's scripts with each one left out; when `app.js` itself or
the style sheet is the hole, the last lines of `index.html` say it), and the
next launch with a connection repairs the copy. Online the same note reads
"Hourglass is updating. Open it again in a moment.": an older copy with a
hole, met by a server that has moved on, fills the hole with the newer
release's file, and that file may need one the old page never loads (the
settings store, from 1.13.0 on); the newer release installs meanwhile and
the next launch runs it. Other paths under the scope
(the launch
screens, the install screenshots) are answered from the cache and refreshed
in the background, as before; offline, a navigation that is not cached gets
the app's page.

The worker answers which release it serves: a message `{ type: 'version' }`
with a port gets `{ version: VERSION }`. `index.html` says the page's own
release in `<meta name="hourglass-version">`, equal to `VERSION`
(`check-release`). The last line of Tune's Sand tab shows both, made by `app.js`:
"Version 1.10.0" when they agree; "· offline copy not installed yet" with
no worker or no answer within a second; "· update 1.11.0 ready: close and
reopen" when a newer release was installed while the page ran; "· offline
copy 1.9.1" when the installed copy is another release than the page and
not a newer one.

Every path is relative (`./`), including `start_url` and `scope`, so the
app works from a sub-directory such as `/hourglass/`. The shell includes
the GPU sand engine the app loads with Real sand on (`realsand/`: its
modules, its shaders and its licences), so Real sand works offline. The
sand lab's pages (`lab/`, `NETWORK_ONLY` in `sw.js`) are not the app: the
worker leaves them to the network, and a lab page's own requests for the
engine (`realsand/`, `LAB_SHARED`) go to the network too and are never
stored (the worker tells them by the request's client), so the lab shows a
new engine on its next load. The lab never touches the app's cache: a lab
page that meets an engine of another build says so, with both stamps.

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

When you change any shipped file, raise `VERSION` in `sw.js` (see Releasing,
below): an installed copy changes only with `VERSION`. An installed app picks
up a new release on its second launch after the deploy: the first launch runs
the release it has and installs the new one meanwhile (Tune's version line then
says the update is ready), and the next one runs the new release.

## Releasing

A release is what the service worker installs on a phone: everything in
`SHELL`, under one `VERSION`. A change that is not a release (the documents,
the tests, the lab) needs none of this. For every change to a shipped file:

1. **`VERSION` goes up.** Any change to `sw.js` or to a file in its `SHELL`
   raises `VERSION` in `sw.js`, as a version number greater than both
   `origin/main`'s and the one the branch started from, and `index.html`'s
   `hourglass-version` meta equal to it. Without it, installed
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
4. **A new, moved or removed file the page loads ships only once the phone
   runs release 1.10.0 or later**, the first with the snapshot worker: Tune's
   version line shows its version with nothing after the number. Before it, an
   update interrupted on its way could leave the installed copy unable to
   start offline until one launch with a connection.
5. **The check group, the suites the change touches, and every `app-*` and
   `e2e-*` suite run**, `app-upgrade` among them (see [Tests](testing.md)).
   Timing checks are judged on a quiet machine: a failure under load is run
   again alone before it counts.
6. **After the merge, on a phone with the app installed:** open it once
   with a connection, close it, and open it again; Tune's version line shows
   the new version and nothing after it. Then, in airplane mode, it opens
   and runs.

## Standing decisions

These hold until a change says otherwise, with its reason.

- **No build step, no framework, no dependency.** What is in the repository
  is what the browser runs. Playwright is a development dependency of the
  tests only.
- **Classic scripts for every file the page loads; ES modules only behind
  the WebGPU switch.** `index.html` loads the seven pieces of `glass/` and
  `sand/`, `sound/audio.js`, `motion/motion.js`, `app/settings.js` and
  `app.js` as classic ES5 scripts. A
  syntax error stops a whole file, and an old parser rejects a file that
  holds `import()`, so
  `app.js` stays classic and appends `realsand/boot.mjs`, the only module
  the app loads, and only with the Real sand switch on where `navigator.gpu`
  exists. `check-shell` checks every classic script for module syntax,
  `import()` and the kinds of syntax newer than ES5 that it lists
  ([Tests](testing.md)). The
  Node suites load the pieces, joined, as one classic script into isolated
  contexts, two versions side by side (an old `physics.js` beside today's
  pieces), which ES modules would not allow without a flag.
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
  ships its new baseline in a commit of its own, reviewed. What the app
  does with its settings is pinned the same way, to files kept in
  `tools/test/base/` (above, under `app/settings.js`): a Tune that changes
  what a control does, on purpose, ships its new trace in a commit of its
  own.
- **Every shipped change raises `VERSION`** (above).
- **The service worker takes over at once** (`skipWaiting`,
  `clients.claim`): an app on an iPhone's home screen is suspended far more
  often than it is closed, and an update would otherwise wait for days.
  So the snapshot holds at load: the files a page loads as it starts come
  from one release, but files it loads later (the engine's modules and
  shaders) can come from a newer one; the build stamps catch that, and the
  page keeps the classic sand until its next launch.
- **Every release is installed whole or not at all** (the snapshot worker,
  1.10.0): no file of the app is refreshed on its own, a failed install
  leaves nothing behind, and a hole is filled only from the same release.
  The cost: a change shipped without a new `VERSION` never reaches a phone,
  which is why `check-release` runs on every pull request.
- **Real sand is the default, and its switch is the owner's alone** (1.10.0,
  [settings design 5](design/settings.md)): the app never writes it off. A
  browser that cannot have it is remembered by its user agent and tried
  again after seven days, an iOS update that changes the user agent, a new
  engine build or a tap; the classic sand
  is always there to run instead. The test harness seeds every page with
  Real sand off (`tools/test/lib/seed.js`) unless the test asks for it.
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
[Real sand: the design](design/real-sand.md). "(settings design N)" means
that section of [Settings: the design](design/settings.md), which holds the
settings design's sections as they are built (so far section 5, Real sand
as the default).
