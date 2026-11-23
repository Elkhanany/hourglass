# Settings: the design, as built so far

The settings design plans Tune's overhaul in steps, each its own release.
This file holds the part that is built: its section 5, Real sand as the
default (release 1.10.0). Section numbers are the design's own, so that a
code comment can cite "(settings design 5.2)". Later steps (Tune in tabs,
the sands and finishes, sound, time, the glass shapes) add their sections
here as they are built.

---

## 5. Real sand as the default

Real sand (the GPU sand engine, [Real sand: the design](real-sand.md)) is on
by default. Where it cannot run, the classic sand runs as it always has,
and the app says why; the switch is the owner's alone.

### 5.1 The setting and the migrations

- `realSand` defaults to `true`.
- **The settings' version, used for one thing.** The settings carry `v: 2`.
  At load, from the raw saved object: a save without a numeric `v`, or with
  `v` below 2, comes up with `realSand: true`. Every launch before 1.10.0
  saved `realSand: false` (boot saves the whole object), so such a save
  cannot tell "never touched" from "turned off". After loading, `v` is set
  to 2 (the typed copy of the saved keys would otherwise carry an older
  `v` over the default). From then on a saved `realSand: false` is the
  owner's choice and is kept.
- Every later migration is keyed on the absence of its own key in the raw
  saved object, never on `v`, so each step can ship alone in any order.
- **A new engine build gives a device that gave up a fresh try.**
  `realSandBuild` keeps the engine build that `realSandFails`, `realSandWhy`
  and `realSandNa` were found with. At boot, a build other than
  `REALSAND_BUILD` clears the three and stores the new build.

### 5.2 Not available: never greyed for good

- **No WebGPU at all** (`navigator.gpu` missing): the row says *Needs WebGPU
  (iOS 26 or later). Tap to try again*. It costs nothing to find, so it is
  found again at every launch, and nothing is stored: the first launch
  after an iOS update that brings WebGPU has Real sand.
- **WebGPU, but no adapter or only a software one** (`noadapter`,
  `fallback`): this costs a load of the engine's modules to find out. The
  failure stores the browser's user agent in `realSandNa` (and the reason in
  `realSandWhy`). While `navigator.userAgent` is that one, a launch shows
  the row as not available without requesting anything under `realsand/`.
  An iOS update changes the user agent, so the launch after it tries again.
- **A failure in a page that was put away is not believed.** iOS may refuse
  an adapter to a page in the background. A capability failure in a start
  during which the page was hidden at any time is treated as a start cut
  short by hiding: nothing is stored, and it is tried again once the page
  is in view.
- **The switch is never disabled.** In this state the switch shows off and
  the note ends with "Tap to try again"; a tap clears `realSandNa`,
  `realSandWhy` and `realSandFails` and reloads, as the switch always does.
- The app never writes the setting off.
- The row carries its bare state in `data-state` (`on`, `starting`, `off`,
  `na`, `failed`, `gaveup`, `updating`, `lost`, `paused`), so tests read the
  state, not the wording.

### 5.3 The launch

The classic sand shows first and Real sand cross-fades in once the engine
has drawn its first frame (0.6 s in Chrome to 3.4 s in a home-screen web
app opened cold, on an iPhone). The owner chose to hold the dark opening
veil up to 1 s longer for that frame, so that most launches open straight
on Real sand: the veil waits while Real sand is starting, at most 1 s from
the first frame, then fades up as before. A reload that should open at once
(the planned "Use this shape") sets sessionStorage `hourglass.openNow`
before it reloads; the boot takes the key and does not wait.

### 5.4 The hang watchdog

The one failure nothing else covers: the GPU stops answering without losing
the device. Frames in flight are let go by the pace valve after 3 s, the
next run takes the last readback slot, and from then on every frame is
skipped: the picture freezes while the clock runs. The engine's own stall
rule counts runs, and no run is made then, so it never fires.

- **The rule** (in `app.js`, so that no engine file changes): while the GPU
  sand is the app's sim, the page is in view and drawing frames, and the
  engine is awake, the app reads the engine's count of readbacks every
  250 ms. If it has not moved for 4 s of wall-clock time, the GPU is taken
  as lost. An idle, paused or finished glass whose sand is still puts the
  engine to sleep, and a sleeping engine reads nothing back, so its clock
  starts again; so does the page coming back into view, and any second in
  which no frame was drawn.
- **Then** the loss path: the engine's ledger to the CPU Sim (`syncCpu`),
  the CPU sand in this frame with the clock untouched, a toast and the note
  *Real sand paused: the graphics chip stopped answering*, the stopped
  engine destroyed once the canvases have cross-faded, and a new engine
  after 2 s once the page is in view. The third time within ten minutes is
  final: the classic sand for the rest of the session, with its note.

### 5.5 What no longer applies, and what changes with it

| item | with Real sand on |
|---|---|
| Grain | Hidden while the setting is on and the state is `on`, `starting` or `lost`; shown otherwise (the classic sand runs, or will for the session). |
| "Shaking it hard can crack the glass" (Real motion's note) | The same rule: Real sand's glass does not crack. |
| "Uses more battery" | Removed from the row. |
| Crack hints, "spilled" in the colophon | Never fire under Real sand; nothing to change. |

### 5.7 Tests

- **The harness** seeds every page: `{ v: 2, realSand: false }` merged under
  whatever the test seeds in `hourglass.settings.v1` (`tools/test/lib/seed.js`),
  so the suites go on measuring the classic sand; a test seeds
  `realSand: true` to have Real sand, or `rawStorage` for exactly what it
  gives. The suites that open the app outside the harness (`render-app`,
  `audio-api`, `lib/replay-iphone.js`) seed the same.
- **`app-realsand`**: the existing cases read `data-state`; new cases
  DEFAULT-NA (and NA-HIDDEN), DEFAULT-MOCK (with the opening), MIGRATE,
  BUILD and HANG, each with its control.
