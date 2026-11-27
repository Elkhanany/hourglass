# Real sand: the design

Real sand is the sand of the sand lab (`lab/sand/`) running inside the app:
every grain a material point of a continuum, simulated on the graphics chip
by a position-based MPM solver (EA's PB-MPM, by way of the Smoosh solver) on
WebGPU, in the glass the app draws, keeping the app's exact time. The engine
is `realsand/`; the app runs it by default where WebGPU works, and the
**Real sand** switch in Tune turns it off and on.

This document is the design as it is built (engine build 8), written from the
code. The code cites it by section: a comment that says "(design 7.4)" means
section 7.4 below, and the section numbers are kept so that those citations
stay true. Where this document and the code disagree, the code is right and
this document is to be corrected. What the switch means for someone using the
app is in the [guide](../guide.md#real-sand); how the engine's parts work, in
prose, is in [How it works](../engines.md#real-sand-the-switch-in-tune).

---

## 0. On one page

1. **What changes.** Only the sand, and only while the switch is on and
   WebGPU works. The clock, the glass and its picture, the body and the
   gestures, the sound engine, motion, sessions and Tune run the code they
   always ran.
2. **How the app meets the GPU sand.** `RealSand` (`realsand/app-sand.mjs`)
   has every member of the CPU `Sim` that `app.js` and `audio.js` use, with
   the same types. While Real sand runs, the app points its one variable
   `sim` at it. The CPU Sim stays alive, not stepped: it is the glass's model
   (geometry, capacity, cracks and flaws), the source of every GPU fill (the
   bed's shape and each grain's colour), the owner of the per-frame record the
   app and the sound read, and the fallback in the same frame.
3. **Exact time.** The GPU's neck has a throttle just above the counting
   line and a membrane on it: a point may cross only downward and only with a
   ticket, and a substep's tickets are the points above less the clock's
   target, counted by an atomic on the GPU. So the sand above the neck is
   never less than the clock's target in any substep, whatever the CPU's
   latency, and the last point leaves in the substep in which the clock
   reaches `00:00.0`. The CPU keeps the count in the app's whole grains (the
   ledger); each fill, transfer, swap or settled count starts an epoch with an
   exact pair of counts in grains and in points.
4. **Files.** The engine is its own folder of ES modules and WGSL, shared by
   the lab and the app. The service worker installs it with the app; a build
   stamp, in four places, tells a page that old and new files have met.
5. **Power.** Asleep (no GPU work) whenever nothing needs simulating; full
   rate while the glass is handled, turned or shaken, at a run's start and
   end; calm (30 frames a second at the same substep rate) otherwise; a heat
   guard. There is no economy mode.
6. **Fallback.** A failure gives the CPU sand back in the same frame with the
   clock untouched. The setting is never cleared by the app (from 1.10.0,
   settings design 5.2): a missing capability is remembered by the browser's
   user agent, and any other failure tries again at the next launch, three
   times. A graphics chip lost around a lock or an app switch is rebuilt
   without a word.

---

## 1. What the switch gives

With the switch on, on a device with WebGPU: the same glass and frame, with
the lab's sand inside; the time exact to the substep; every sand, a colour
of your own and every glass shape, and layered sand, in their own colours; Flip, turning and spinning the glass,
**Sand**, **Reset** with its one-second transition, work and rest, Real
motion, sessions across reloads; the sound of the stream, the landings, the
tail and the fill, the bed when the glass is moved (section 8), the bowl,
blows on the desk, mending; every haptic. What it leaves out is in section 12.

---

## 2. Files and modules

### 2.1 Where the engine lives

`realsand/`: plain ES modules and WGSL shaders, no build step. The sand lab
imports the same files. Each file is listed, with what it does, in
[How it works](../engines.md#real-sand-the-engine-the-frame-and-the-valve).
Its solver keeps the MIT notice of Smoosh and the BSD-3-Clause notice of
EA's PB-MPM, file by file, in `realsand/LICENSES.md`.

### 2.2 How the app loads it

`app.js` is a classic script and stays one: an old parser would reject a
whole file that held `import()`. So at boot, only with the switch on and
`'gpu' in navigator`, it appends `<script type="module"
src="./realsand/boot.mjs">` (`loadRealSand`). `boot.mjs` imports the adapter
and calls `Hourglass.attachRealSand(RealSand, BUILD)`. `attachRealSand`
refuses a build other than its own `REALSAND_BUILD` (the note says Real sand
is updating, the CPU sand runs this launch, the setting is kept), and
otherwise starts the engine (`startReal`): `RealSand.create(...)`, `start()`
(section 10.1), `adopt()` (section 7.8). Once the engine is ready the next
quiet frame hands the sand over (`handover`).

- Without `navigator.gpu` the row says *Needs WebGPU*, nothing is loaded and
  nothing stored; the switch is never greyed or cleared (settings design
  5.2). A user agent kept from a launch that found no adapter
  (`realSandNa`) is treated the same while it is this browser's.
- After three launches in a row that failed (`realSandFails`), nothing is
  loaded until the switch is turned off and on.
- A module that fails to load fires the script's `error`; one that loads but
  fails as it runs fires `load` without having called `attachRealSand`.
  Both are a start failure of the kind that tries again (`load`).
- With the switch off nothing under `realsand/` is requested.

### 2.3 Service worker and build stamps

The worker's `SHELL` names every module and shader of the engine and its
`LICENSES.md`, so Real sand is installed with the app and works offline.
`realsand-shell` checks that every module `boot.mjs` loads and every shader
is in `SHELL`, and that every path in `SHELL` exists (one missing path fails
the whole install).

The lab must see a new engine on its next load, while the app keeps its
installed one. So a request under `realsand/` is answered by the network and
never stored when the page that asked is a lab page; the worker tells it by
the request's client (a module imported by another module carries no lab
referrer), and every other request is the app's.

The build stamp lives in four places, raised together whenever the engine's
code changes (a module or a shader under `realsand/`; not for a change in
comments alone): `realsand/build.mjs` (`BUILD`), the line "Engine build" in
`shaders/common.inc.wgsl`, `REALSAND_BUILD` in `app.js` and `BUILD_EXPECTED`
in `lab/sand/main.mjs`. A page fetches its shaders once (one shader library
per base URL), so a rebuild after a lost device, or a retried start, compiles
the sources the page started with, never a newer copy a new release's worker
has put in the cache meanwhile. Shaders of another build than the modules
fail the start with the code `stamp`: the note says Real sand is updating,
and it is not counted as a failure. As belt and braces, the lab, which
holds the stamp it expects, says so in its status line, with both stamps,
should an engine of another build reach it, and its Copy results prints both
stamps. (Until 1.10.0 it also dropped the engine from the app's caches and
loaded once more; since the app's installed copy became a snapshot that only
an install writes, a file taken out of it would come back only online, so
the lab leaves the app's caches alone.)

### 2.4 The seams in app.js, index.html and styles.css

Everything Real sand adds to the app runs only when the engine exists, except
the settings, the Tune row and the loader:

| where | what |
|---|---|
| Settings | `realSand` (on by default from 1.10.0), `realSandFails`, `realSandWhy` (launches in a row that failed, and why the last did), `realSandNa` (the user agent that found no adapter), `realSandBuild` (the engine build those were found with), and `v`, the settings' version (settings design 5.1) |
| `composeField` | `real.feel(tS, fx, fy, air, rho)` before the field is turned into the glass (5.2) |
| `frame` | `real.submit(now)` in place of `renderer.drawSand()`; the handover at the start of a quiet frame |
| the Reset's sweep | `real.setSweep(kind, p)` beside `renderer.setSweep` (6.5) |
| a theme, layered sand | `realEng.setPalette()` after the Renderer has rebuilt its table (6.3) |
| layout | `realEng.layout()` after `renderer.layout()` (6.1) |
| `visibilitychange` | `realEng.setHidden(document.hidden)` (7.7) |
| the colophon | `real.points` in place of `sim.total`: the points are the grains simulated |
| `window.Hourglass` | `sim` read through a getter (the engine in use), `realSand` (the engine or null), `attachRealSand` |

`index.html`: one row in Tune's Material group after Grain
(`#realsand-row`, `#opt-realsand`, `#realsand-note`). The GPU's canvas is
not in the page: RealSand makes `#c-gpu` and inserts it after `#c-sand`.

`styles.css`: `#c-gpu` fades in over 0.42 s as `#c-sand` does; under
`#app.real`, `#c-sand` and `#c-bloom` go to opacity 0, never `display:
none`, since a knock on the glass is placed by `#c-sand`'s box; the
cross-fades `#app.swap` and `#app.pass` cover `#c-gpu` too.

---

## 3. Exact time

### 3.1 What the clock needs

The wall clock is the master. Each frame the app sets `sim.targetTop` from
the time left (with the breathing of the stream), and `gateOpen`,
`deepRelease` and `relCap`; after a gap it calls `fastForward`; and in many
places it reads `nTop` in the same frame to set the time. The engine must
give:

1. an integer `nTop` in grains, current when the app reads it, that never
   goes back to a value from before a turn, a fill, a pour or a transfer;
2. no crossing of the neck in either direction except through the metered
   valve;
3. a release per step of at most `nTop - targetTop`, capped by `relCap`, and
   none while the glass turns or leans past `gy <= 0.7`;
4. `fastForward(n)` and `pour(n)` that return what they moved and change the
   counts at once;
5. `nTop` 0 only when no sand is left above.

### 3.2 The neck on the GPU

The counting line is the grid row `y = cy` through the neck (the tally counts
a point exactly on it as below). Sand always drains toward `-y`: at a swap
the next run turns every point end for end (the flip pass, below), as the
CPU Sim re-indexes its lattice.

- **The throttle** (`gridUpdate.wgsl`): grid nodes within `rn + 3` cells of
  the axis and from the line to 2.5 cells above it may move down no faster
  than `vcap` cells a second of simulated time; nodes just below the line may
  not move up. It keeps a small queue of points resting on the line.
- **The membrane** (`g2p2g.wgsl`, in the last iteration): a point that would
  cross the line downward takes a ticket, `t = atomicAdd(counters[2], 1)`,
  and may cross only if `t < counters[3] + allow`; refused, it gives the
  ticket back and stays on the line (`counters[4]`). Upward crossings are
  refused (`counters[5]`). `spreadShift.wgsl`, which moves points after it,
  keeps a shift from changing a point's side of the line.
- So in every substep `s` of a run, `above_s = counters[3] + appended -
  crossings_s >= target_s`, whatever the CPU's latency, provided `counters[3]
  + appended` is the true count at the run's start. The ledger (3.4) makes
  sure of that: a run starts by copying the tally's count above (or below, in
  a run that re-indexes) into `counters[3]`.
- **The tally** (`tally.wgsl`), read back a few frames later, counts the
  points above and below, the queue on the line, the highest point near the
  axis (for the brim, 7.3), and speeds for the power modes.
- **Appends** (pours) write points and the point count only, never the tally:
  their points reach the membrane through `allow`.
- **The flip pass** (`flip.wgsl`) turns each point half a turn about the
  glass's centre, exact on this point-symmetric glass (a point exactly on the
  line is first moved just below it), so the count below becomes the exact
  count above.

The uniform words: 36 `vcap`, 37 `allow` (an exact integer per substep), 38
the flags (bit 0: the throttle and the membrane on). With the flags at 0, the
lab's default, nothing of the neck runs.

### 3.3 Units: grains and points

The app counts whole grains; the GPU counts material points. Grains are the
authority; points follow.

- `s = 0.702 / q` solver cells per app cell (0.65 on a phone, at scale 1.08),
  so the solver's grid is 137 by 302 cells at every scale and every Grain
  setting, and so are the GPU's cost and memory.
- `ppg = 4 s²` points per app grain (two by two points to a solver cell):
  1.69 on a phone with the classic grain, 1.17 on a tablet, 0.85 and 0.42 on
  a phone with Fine and Finest.
- `pointsFor(g) = ceil(g ppg)`, 0 only for 0 grains.
- **The epoch's base.** Each fill, transfer, swap and settled count records
  an exact pair: `G0` grains are `P0` points above the line. A grain target
  becomes a point target by `pT(g) = ceil(g P0 / G0)` (0 for `g <= 0`), so
  `pT(G0) = P0` and `pT(0) = 0`. Points become grains only for a shortfall,
  `conv(x) = ceil(x G0 / P0)` for `x > 0`. So while the neck is supplied the
  ledger reports the app's own target exactly, at every grain setting.
- **A pour** of `n` grains appends `pointsFor(total + n) - pointsFor(total)`
  points and moves the base, anchored at the membrane's present target.

On a phone a 10-second glass holds 1,155 grains and an hour's 21,917.

### 3.4 The ledger

`realsand/valve.mjs`, pure JavaScript, keeps the count above the neck in the
app's whole grains:

- each run's record (its sequence number, the fill it belongs to, its epoch,
  its parity, whether it offered tickets, its end target) until its readback
  is no longer needed;
- the CPU's events since the oldest record (pours, swaps). A readback is read
  in today's terms by replaying them (a pour adds to the bulb that was on top
  when it was poured, a swap exchanges the two); one from before a fill or a
  transfer is dropped;
- **neck shut** (the gate shut, the glass turning, `gy <= 0.7`, a pending
  base, a transfer): the count moves only by the CPU's events. The first
  exact readback after the close settles it once, and a new epoch begins. A
  swap with no exact readback at hand makes the base pending: the neck stays
  shut until one arrives;
- **neck open**: the count is the app's target, plus any shortfall the
  newest readback of this epoch measured (never more than the sand that is
  there). Supplied, `nTop` is the target; starved, it carries the shortfall.
  With `relCap` (after shaking) the count falls at most `ceil(relCap)` a
  120 Hz step;
- **the end**: `nTop` reads 1, not 0, until a readback with no point above
  confirms it, so the app keeps the neck open until the last point is out;
- `frame.released = max(0, previous - new)`: never negative;
- within a frame the count moves to the frame's count in equal parts at each
  of the app's 120 Hz steps.

`census()` gives the ledger's counts; `audit()`, for the tests, checks the
newest readback against the ledger.

### 3.5 The controller

Once a frame, before the run is encoded (`plan()`, then `run()`):

- **Shut:** `vcap` 0, no tickets.
- **Targets:** the target in points moves linearly over the run's substeps
  from the last run's end target to this one's; in the run in which the clock
  reaches `00:00.0` it reaches 0 in the substep that holds that moment.
- **The throttle:** open in the tail (300 ms before it) and at the end; in
  the bulk, `vcap = max(0, 1.15 ff + 4 (Q* - queue) + 6 short) / (kv r)`,
  with `ff` the clock's flow in points a second, `Q*` 8 points resting on the
  line, `short` the newest shortfall, `r` simulated over real time, and `kv`
  the throttle's gain, started at 20 points a second per cell a second and
  learnt within four times that.
- **Slow throttles** below 0.25 cells a second are duty-cycled: 0.25 in a
  share of the runs, shut in the others (the slowest rests need 0.027, near
  the resolution of a float a substep).
- **The residue:** after the end, points still above, 1.5 s after the end (or
  after a fill or transfer made since) and 0.5 s after the last crossing, are
  moved below by a transfer (7.6).
- **A stall:** no readback for 60 runs is a failure of the engine (7.9).

### 3.6 Each clock site

| in app.js | what RealSand does | exact |
|---|---|---|
| `start` | the glass at rest; `nTop` from the ledger | yes, shut, in grains |
| `swapEnds`, `tiltSwap` | the app reads `nTop` (settled), then `completeFlip()`: the top becomes `total - top` at once; the next run carries the flip pass | yes |
| the turn's readout, the sound, `saveSession` | read `nTop`, which never goes back to a value from before an event | yes |
| `handlePour` | `pour(n)`: grains at once, points appended (3.3); fewer, or none, at the brim, at `maxTotal` or with no room left (7.3) | yes |
| `maybeRetime` | reads `nTop`; "calm" is RealSand's own `motionActive()` (9.1) | as the ledger |
| `beginPhase` | calibrates to the shut count after a turn | yes |
| `turnedUnseen`, `newGlass` | `completeFlip`, `reset(n)`: the CPU Sim made new, the GPU filled from its lattice (7.1), when visible (7.7) | yes |
| sessions | integer grains, as ever; at boot the CPU Sim restores, then hands over (7.8) | yes |
| the catch-up after a gap | `fastForward(n)`: the ledger at once, the GPU by a transfer (7.6) | yes |
| `tickClock` | `gy` is `cos(angle + tilt)` | yes |

---

## 4. RealSand: the adapter

The app's side (the header of `realsand/app-sand.mjs` has every detail):

```
RealSand.create({ P, cpuSim, renderer, rotor, cSand, timer, offscreen, allowFallback, log, onLost, onBack })
start()        the device, the pipelines, the buffers, the self-test (10.1); throws { code, message, capability }
adopt()        the GPU bed from the CPU Sim's lattice and counts, settled 0.4 s with the neck shut (7.8)
ready          adopt()'s bed is drawn and the engine is not lost: only then may the app hand it the sand
takeOver()     the app now uses it as its sim (between two frames); throws if the engine is lost
submit(now)    once an active frame, in place of renderer.drawSand(): the frame's substeps and picture (5.1)
feel(tS, fx, fy, air, rho)    the glass's felt acceleration at the app's step time (5.2)
setHidden, layout, setPalette, setSweep, points, stats(), audit(), destroy(), destroyed
jolts          how a jolt is played to the sand at app speed: 'live', 'slowmo', 'film' or 'plain' (5.2)
syncCpu()      the CPU Sim to the ledger's counts (the loss path's first step; app.js's watchdog calls it too)
onLost({ reason, lifecycle, final, message }), onBack()       (7.9)
```

The Sim's members ([How it works](../engines.md#the-engine-contract) lists
them by group):

| member | RealSand |
|---|---|
| `angle`, `tilt`, `flipping` | its own fields; the field uses `angle + tilt`; turning shuts the neck |
| `gateOpen`, `deepRelease`, `targetTop`, `relCap` | its own fields, read by the valve each frame |
| `topSweeps`, `quiet`, `damageArmed`, `spinArmed`, `quality`, `escN` | accepted, unused |
| `reduced` | accepted (the app already softens the field under Reduce Motion) |
| `nTop`, `total`, `nBottom` | the ledger, in whole grains (3.3, 3.4) |
| `capacity`, `fillMax`, `maxTotal`, `geo`, `G`, `W`, `H` | the CPU Sim's: the same glass |
| `gy` | `cos(angle + tilt)` |
| `bf` | the field each bulb feels, for the sound's pan |
| `frame`, `nev`, `evX`, `evV`, `evK` | the CPU Sim's own record and arrays, filled by RealSand (section 8) |
| `cracks`, `warnSeg`, `segInfo`, `sealCracks`, `serializeDamage`, `restoreDamage`, `forceCrack` | forwarded to the CPU Sim; their events land in the shared record |
| `agit`, `agitation()` | each bed's granular temperature and the hotter one's, from the readbacks (section 8); 0 asleep, hidden or lost |
| `lost`, `dMax`, the escaped grains | 0, or the CPU Sim's (empty) arrays |
| `reset(n)` | the CPU Sim's `reset(n)`, then a GPU fill from its lattice (7.1), deferred while hidden (7.7) |
| `beginFrame()` | the CPU Sim's (it clears the record) |
| `step()` | counts the app's 120 Hz step; moves `nTop` within the frame (3.4) |
| `setMotion(ax, ay, w, al, lam, gz)` | `w`, `al`, `lam` always; `ax`, `ay` only in a step with no `feel()`; `gz` ignored (2-D) |
| `setCarry` | stored, unused |
| `motionActive()` | the power modes' thresholds (9.1), not the CPU's idle ones |
| `isActive()` | false only while asleep with nothing owed or to draw again |
| `fastForward(n)`, `pour(n)`, `completeFlip()` | 3.6 |
| `setLayers(on)` | the CPU Sim's, then every GPU point re-toned (7.4) |
| `inertiaZ()` | each bed's mean r² per grain as at the last fill, times its count |
| `wakeAll()` | wakes a sleeping glass only when its lean has changed by more than 1° since it slept (9.1) |
| `impact(nx, ny, v)` | 1 from 700 px/s (a blow thumps and clacks as a creaking blow does), else 0; no damage |
| `knock()`, `flick()`, `shake()` | -1, 0, -1: no damage (section 12) |
| `census()`, `tones()` | the ledger's counts; each tone's count from the readbacks |

`realsand-adapter`'s first check holds the contract: every name the app and
the sound bind to an engine against its lists, every Sim member on RealSand
with the CPU Sim's type, and the shared objects the CPU Sim's own.

---

## 5. One frame

### 5.1 The order

`frame(now)` in `app.js` runs as it does for the CPU sand:

1. a due handover, in a quiet frame (7.8); `tickClock()`, the wall clock;
2. the Reset's sweep (6.5); a pour (`sim.pour`); `stepGravity`, which may
   swap the bulbs (`tiltSwap`);
3. the target and the valve's fields; `sim.beginFrame()`; the catch-up
   (`sim.fastForward`) when time was missed;
4. the app's 120 Hz steps, at most six: the body, `composeField` (which calls
   `real.feel`, then `sim.setMotion`), `sim.step()`;
5. `real.submit(now)` in place of `renderer.drawSand()`;
6. the glass, its cracks (the CPU Sim's), the sound (from `sim.frame`) and
   the readout, as before.

Inside `submit`: the sound's landings are due (section 8); nothing more while
hidden; a stall of readbacks is a loss; a transfer in flight holds the runs,
and is abandoned after 1 s (7.6); a fill put off while hidden is uploaded; a
transfer, the residue and a re-tone go before any run; then the power mode
(9.1). Asleep, no substep runs; a picture whose look changed (a new palette,
a resized canvas, a page back in view, a new bed) is drawn again by a run of
zero substeps. Calm draws 30 frames a second. A run is skipped when two
frames of work are in flight or every readback slot is taken (and the canvas
is turned by CSS, 6.6). Otherwise the run: the substeps the GPU's budget and
the rate allow (none in the Reset's first phase), the valve's words for each
(3.5), the field of each (5.2), the tally, the tone pass (7.4), the grains
drawn, one submit. The run's readback arrives some frames later and is read
against the ledger.

### 5.2 The field

RealSand keeps the app's 120 Hz samples with their times (half a second of
them) and gives each GPU substep the newest sample at or before its own time.

- `setMotion` carries no time; `feel(tS, ...)`, called by `composeField` just
  before it, does.
- `feel` takes the glass's own acceleration as the sand feels it (`fx`, `fy`
  in g, in the page's frame, before the free-fall term and the rotation) and
  plays it through `GlassFelt` (`realsand/felt.mjs`) in the mode
  `real.jolts`. At app speed the world runs slowed. `live`, the default from
  build 5: the part of a push along the sand's floor beyond the bed's
  friction (0.6 g) is played at once, at the speed a slowed film of it would
  give, capped at 2 g with the rest paid out within 0.15 s; anything gentler,
  and every push off or into the floor, is felt as it is; the floor is where
  the sand's gravity points. `slowmo` plays a lone jolt as a slowed film and
  goes live while the hand keeps moving; `film` is the slowed film throughout
  (the playback until build 5: quiet stretches under 0.04 g skipped, half a
  second late under shaking); `plain`, as it is, under Reduce Motion. Then it
  is turned into the glass by `rho`, the free fall is added as it is, and all
  of it is scaled by the sand's gravity `G`.
- Gravity in the glass's frame comes from `angle + tilt`; the turning
  glass's terms from `w`, `al` and the app's `lam`.

---

## 6. Drawing

### 6.1 The canvas

`#c-gpu`, a WebGPU canvas inside `#rotor` after `#c-sand`, takes `#c-sand`'s
CSS box, so it turns, moves and zooms with the glass, Zen included. Its
backing store is at the device's pixels (at most 3 a CSS pixel), lowered in
steps of a quarter until under 4.2 megapixels, and is set only when it
changes (setting it clears the picture). It is premultiplied, so it
composites over the far wall of the WebGL glass and under its near wall.
With `?offscreen=1` (the tests only) the engine draws into a texture shown on
a 2-D canvas, since a headless browser's WebGPU canvas cannot be read back.

### 6.2 Colours, the neck's warp and the light

- **Colour.** Each point carries its grain's colour seed (`color.x`): bits
  0-7 the palette entry, bit 7 the tone of layered sand. The palette is the
  Renderer's own colour table at its middle light level, 256 entries, mica
  marked (`paletteFromLUT`). So the theme, layered sand's second tone and any
  sand the Renderer can draw are the CPU sand's colours.
- **The neck's warp.** The solver needs a neck a little wider than the drawn
  one to flow, and the glass on its grid is widened there, fading out by the
  bulb's widest point. Each grain is drawn pulled toward the axis by the
  drawn half-width over the simulated one, row by row, so the sand lies
  inside the glass the app draws.
- **The light.** Grains are lit from the room's upper left. The canvas turns
  with the glass, so the light is turned back by the glass's angle on screen.
  Since Tune has Light (Sunlit, Soft), Sunlit lights the bed as the classic
  sand's is lit, by the same key, constants and colour table: each grain's
  light is worked out in the vertex stage (the bore's normal for the body
  against the glass, the beds' relief for the free surface, a bead in
  flight), and two read-only compute passes make the relief from the points
  each frame. Soft is this section's picture, unchanged. How it works is in
  `docs/engines.md`, "Real sand under the same light".
- **Blur.** A grain in flight is drawn as the streak it makes in one display
  frame; a grain with sand crowded around it (a bed moving as a whole) is
  drawn sharp.

### 6.3 Themes and layers

A theme, or the layers switch, rebuilds the Renderer's table and then calls
`setPalette()`. Each `submit` also compares a few of the table's colours with
the ones it was drawn with, so a table rebuilt by anything else is followed
at once. The layers switch also re-tones every point (7.4).

### 6.4 What is not drawn

The CPU Renderer's bloom (`#c-bloom` is hidden with `#c-sand`), rim light,
depth shading and gloss. The grains are lit as in the sand lab.

### 6.5 The Reset transition

The app's sweep drives both renderers (`setSweep(kind, p)`):

- **kind 1, about 0.38 s:** the sand is frozen (runs of no substeps) and each
  grain is drawn pulled into the neck by the CPU sand's own map, every
  grain's squared distance from the neck falling by the same amount; grains
  that reach the neck are swallowed.
- **between:** `reset(n)` makes the new glass: a fill from the CPU Sim's new
  lattice (7.1), with the neck shut (the clock is not running during a sweep).
- **kind 2, about 0.62 s:** the new bed settles while it is shown from the
  neck up under a rising heap, as the CPU sand's is, with a thread falling
  from the top of the bulb drawn as extra grains (at most 1,024).

Under Reduce Motion, or hidden, the app's cross-fade covers `#c-gpu` too.

### 6.6 The swap frame

At a swap the CSS rotor turns back half a turn in that same frame, while the
canvas's picture is turned only by the run that carries the flip pass. A run
can be skipped (5.1). So RealSand keeps the parity of the picture on the
canvas: in a frame whose run is skipped while that parity differs from the
ledger's, `#c-gpu` is turned 180° by CSS about its own centre, which is the
glass's (the box is centred, and the glass is point-symmetric); the run that
draws after the flip pass clears it. What is shown is always the last
picture, the right way up. For that one frame the grains' light comes from
the other side.

---

## 7. Fills, turns, pours, layers, sequences, gaps, handover, loss

### 7.1 Every GPU fill comes from the CPU lattice

`fromLattice` (`realsand/fill.mjs`): two by two jittered points to a solver
cell, kept where the app cell under each point's drawn position holds sand
in its own bulb, each with that grain's colour seed; then each bulb is cut to
its count from its surface down, or made up at its surface. So the GPU bed
starts with the CPU bed's shape and colours (the crater, the heap, the
strata), and settles within about 0.4 s. It is used by `reset` (a new glass,
an unseen turn), the handover, the recovery after a loss, and a transfer
that timed out. The CPU Sim always holds the counts the fill needs: `reset`
lays them itself, and before the other fills RealSand brings it to the
ledger's counts (`syncCpu`, 7.8).

### 7.2 Flip and tilt

The app turns the glass (the Flip, a turn by hand, real motion). The GPU sand
feels the turning field (5.2) and the neck stays shut while it turns; at the
swap the ledger swaps at once and the next run turns the points (3.2); a
skipped run is covered by CSS (6.6).

### 7.3 Pour

As the CPU sand pours: new points at the far end of the top bulb, within 2.75
app cells of the axis, moving toward the neck at 70 to 140 app cells a
second; written turned half a turn while a flip pass is pending, so that pass
carries them into the ledger's top bulb; with layered sand, in layers of
their own tone. While a transfer is on its way they go into its upload
instead. A pour stops at the brim (the highest point near the axis within 4
cells of the top bulb's far end, from the readback), at `maxTotal`, or when
the buffer has no room, and the app says the glass is full.

### 7.4 Layered sand

`realsand/layers.mjs` and `shaders/tone.wgsl`, once a run after the tally:

- **Fills** take the strata from the CPU lattice (7.1).
- **Falling sand** keeps its colour while it falls. A point that crosses the
  line is numbered and marked fresh with the tone the layer schedule gives
  its number, and takes that tone when it first comes to rest below the line.
  The schedule is the CPU sand's: the lower heap grows in layers of a style's
  depth, each laid as two strata, one tone under the other in the shares the
  top bulb holds, the tone below changing from layer to layer. The tones
  given keep pace with the tones that came, within about a stratum's worth,
  so each tone keeps its count.
- **After a turn**, the points that moved take the tone of their bulb's new
  pattern (drawn anew for each bulb and turn, as the CPU sand draws it) as
  they come to rest, trading tones in equal numbers each way, so each bulb
  keeps its count of each tone. This runs for 4 s after the turn.
- **Poured sand** comes in layers of its own, each in the other tone.
- **The switch, on or off:** the CPU Sim is brought to the ledger's counts and
  lays its strata (or forgets them); then every point takes the tone of the
  CPU's grain at its depth in its column, through a transfer that moves
  nothing (a readback, re-toned, uploaded), behind the app's soft
  cross-fade.

Seed bits: 0-7 the palette entry (bit 7 the tone), 8 fresh, 9 the fresh
grain's tone, 10 moved since the turn began.

### 7.5 Sequences

A watched turn between work and rest is a Flip (7.2); `beginPhase`
calibrates to the shut count. An unseen turn is `completeFlip` and
`reset(total)` (7.1); while hidden, the upload waits (7.7).

### 7.6 Back from a gap: the transfer

`fastForward(n)` (the app's catch-up after a gap; the residue, 3.5): the
ledger drops by `n` at once; the runs are held while the points are read
back (after any pending flip pass); the points above the line nearest the
neck, the ones that would have flowed next, are laid on the lower heap under
a jittered 30° cone; the bed is uploaded with its exact counts; a new fill
and epoch begin. The top bed's hole closes by itself over the next frames. A
pour made meanwhile goes into the upload. If the readback has not come back
within 1 s, the transfer is abandoned: the CPU Sim is brought to the ledger's
counts and the GPU is filled from it. The re-tone of layered sand (7.4) takes
the same path.

### 7.7 Hidden

Hidden: no GPU work, while the clock goes on (and can end a phase and turn
the glass unseen). A fill made while hidden changes the ledger only; its
upload waits for the first frame in view (several collapse into the last).
Back in view, the picture is drawn again (iOS may have let it go), and the
app's catch-up moves what is owed by a transfer.

### 7.8 Handover

**CPU to GPU** (at launch with the switch on, and after a rebuild): the CPU
sand keeps running and showing while the engine starts, however long that
takes. `adopt()` fills the GPU from the CPU lattice at the counts of that
moment and lets it settle 0.4 s of simulated time with the neck shut; the
engine is `ready` once that bed is drawn. The app hands over in the next
quiet frame (no Reset's sweep, no turn, no pour, no hand on the glass and
the glass not moving on its own): `takeOver()` takes the CPU Sim's angle,
tilt, turn and valve fields, fills again if the CPU sand was poured, turned
or made new meanwhile, and lets the grains the CPU released meanwhile leave
through the valve (more than the app's catch-up would let flow, by a
transfer); then `sim` becomes the GPU sand and `#app.real` cross-fades the
canvases.

**GPU to CPU** (a loss, a failure while running): `syncCpu()` makes the CPU
Sim new with its damage kept, brings the sand above the neck to the ledger's
count, settles it (at most 240 steps), and copies the angle, tilt, turn and
valve fields; the app makes the CPU Sim its `sim` again in the same frame.
The clock is not touched. The GPU bed's colours are not carried over: the CPU
lays its own strata.

**The switch** saves the session and loads the page again, on or off, as
another grain does; so off is the app with nothing of the engine loaded.

### 7.9 Lost device and lifecycle

A lost device, readbacks that stopped for 60 runs, or an error in a frame:

- **while hidden, or within 1 s of coming into view** (a lock, an app
  switch, iOS taking the graphics chip back): a lifecycle event. The CPU sand
  takes over in the same frame, without a toast; a new device is made as
  soon as the page is in view, the CPU sand adopted again, and the engine
  handed the sand back (`onBack`). It does not count toward the limit below.
- **otherwise:** the CPU sand takes over in the same frame, with the toast
  "Real sand paused: the graphics chip was reset", and the same rebuild after
  2 s. A second such loss within 10 minutes is final: the classic sand for
  the rest of the session, and Tune says so.
- A rebuild that cannot open a device leaves the classic sand until the next
  launch, and says so.

---

## 8. Sounds and haptics

The sound engine takes plain numbers from the app each frame and the CPU
Sim's event list. RealSand fills them from the ledger:

- `frame.released`: the grains the ledger released this frame (exact, never
  negative), for the stream's flow;
- the landings: the same grains, delayed by their fall from the neck to the
  lower heap (from the heap's height for the grains below, at the speed the
  solver allows a falling grain), on glass while the lower bulb holds under
  2 % of its capacity and on sand after; poured grains land in the top bulb;
  up to 48 of them a frame as single grains in the event arrays;
- the tail, the fill, the turn and the spin come from the app's own state, as
  ever.

The bed's sounds come from the readbacks (from build 6; silent before). The
tally of each run sums, for the bulb above the counting line and the one
below, the sand that lies in a bed (points crowded as `grains.mjs` draws a
grain sharp: not the falling stream, not spray): how many points, their
summed velocity and place across the glass, and the number and summed speed
of those that move (faster than 2 % of a free fall over the glass, the sleep
rule's own measure): 12 words (`tally.wgsl`; `solver.mjs` `bedOf` gives
`beds`, two records). Each record also carries the bed's fastest fall
toward the floor since the last readback (`peak`, from build 8: below).
Each run keeps its simulated time, its mean field and
the direction of plain gravity for its readback (`_runSound`); `_hear`
makes the classic sand's record from the two, and `_bedSound` writes it
into the frame's record in `submit`, after the app's `beginFrame` and
before its sound:

- a bed: a bulb's crowded points are heard as a bed once they are 3 % of
  the glass's points, and 40. Fewer are the plug of the stream just under
  the neck, the first grains on the floor, or the last above the neck: on a
  10 s glass just started the lower bulb's crowded points are 3 to 14 for
  the first second, at up to 59 cells/s, and their mean speed is no bed's.
  (Taken for a bed, they landed a thump of 0.0056 and stirred the agitation
  to 0.47, 8 frames after Start, with the phone at rest.) The heap is heard
  from 59 points on a 10 s glass (1.2 s into its run) and 144 on a
  minute's.
- `frame.thump`, `frame.slam`: a landing. A bed that moves with the field
  (within 60° of it), along the glass's axis (within 45°), faster than the
  speed of the quietest thump heard (30 cells/s), as one body (seven in ten
  of its points moving: `SND.BODY`, 0.7) is falling; once falling, a fall
  that speeds up goes on whatever share moves. When it has
  lost half that speed within 0.15 s of simulated time (time, not runs: the
  same landing at 60, 120 and 180 runs a second), and it was the glass that
  took it
  (the speed lost, with what the field added meanwhile, is 0.4 of it or
  more: a bed the field itself slowed has not landed), it has landed with
  the speed `u` it fell at: `E = u² / (2 G HB)`, the classic sand's energy
  for a bed landing at `u`. Toward the side plain gravity holds the sand to
  it is that bulb's thump, at the far end the slam; its place is the bed's
  centre across the bulb. Never while the glass is turned (the Flip, or
  faster than 0.5 rad/s), as the classic sand's bed does not fly then, and
  never for a bed stopped sideways, as the classic sand's slip lands
  nothing. Nor for the slip of a sideways shake: sand shaken up the wall
  slides back down it into the rest of the bed, and the bed's mean may fall
  along the glass as fast as a faint landing, but only about half its points
  move (0.47 to 0.62 of them, where a flicked bed's fall moves 0.75 to 0.94),
  so it is no body falling and lands nothing (before the rule, a sideways
  shake gave such a thump, 0.0016 to 0.0030, in six of ten shakes). The
  speed is the bed's fastest fall, not only what a readback saw (from build
  8; the note below): a fall under way goes at least as fast as the
  engine's `peak` shows; a fall no readback saw starts from the peak, by the
  same tests in that substep's own field (with the field, along the axis,
  seven in ten of its points moving); and a fall that ends before the next
  readback lands then, its time and the field's push counted from the
  peak's substep. The energy is still `u² / (2 G HB)`.
- `frame.slides` (and `frame.moved`): the bed's motion within itself: the
  summed speed of its moving points, less their number times the bed's own
  speed (a bed that flies or slides as one body slides nothing) or the
  speed a point moves from, whichever is more (a bed that only creeps
  slides nothing); in the CPU Sim's grains and cells a second, times 16
  over the square root of the bed's grains (never more than all of it).
  That share is the calibration:
  the classic sand slides at its surface, the GPU bed shears through its
  depth, and a bed of n grains has a surface of about √n (0.47 of the GPU
  bed's motion for the 1,155 grains of a 10 s glass, 0.30 for the 2,830 of
  a minute's). The grains are counted on the lattice of the calibration
  (a phone's classic grain, 1.69 points a grain), so the same GPU motion is
  the same sound at Fine and Finest and on a tablet, once the app has
  divided by its lattice's grains and cells. Only a bed that lies packed
  slides: a thrown bed flies, as the classic sand's bed in the air, which
  slides nothing. Packed is the share of the bulb's points that are
  crowded, against how packed the bed has lately been (a memory of 1 s:
  the heap under a running stream is never all crowded): in full from 0.95
  of it, less below, and once under 0.75 nothing until the bed has packed
  again; and nothing while the bed moves as a body along the glass (within
  26° of its axis) faster than the quietest landing. It is fed as that
  rate times the frame's time in every frame
  until the next readback comes (120 ms at most), so calm's 30 runs a
  second do not flicker.
- `agitation()` (`agit`): each bed's granular temperature follows its own
  acceleration over the glass in g (the change of its mean velocity from
  one readback to the next, while more than 1 % of it moves; not while the
  glass is turned), with the classic sand's memory of 0.25 s, and a landing
  adds the classic's heat, `E HB / 3`. Under 0.02 with the bed at rest it is
  0, and it fades by the clock when no readback comes (a stall): the next
  readback goes on from what is left, not from what was.

Nothing of the bed is heard while the engine is asleep, hidden, lost or not
the app's sand, during the Reset's sweep, or for 0.4 s after a fill or a
transfer (a fresh bed settles). The feeds are read from readbacks that the
frame makes anyway: they ask for no run and do not enter the power modes,
so sound never keeps a glass awake. The clock's state is not looked at:
before the start, running, paused and finished sound alike. The sound comes
with the readback, one to three frames after the sand's own motion; a thump
in the run in which the bed has lost half its speed, about four frames after
its fastest fall, as it comes to rest.

**The fastest fall between readbacks (from build 8).** There is one
readback a run, and a flicked bed falls for about 40 ms, so when the engine
runs less often than every frame (a phone that falls behind, the heat
guard's calm pace of a run every 2 frames) one run can hold a fall's fastest
moment, or the whole fall and its landing. Up to build 7 the landing was
judged from those snapshots alone: on the adapter's mock engine, a toss up
at 60 cells/s and down at 86 landed, at a run every 2 frames, 0.3 or 5.2 dB
under its energy by where the runs fell, and at a run every 4 to 6 frames
none at all in some phases. So the engine keeps each bed's fastest fall:

- while a fall is possible, the end of every second substep of a run (counted
  back from its last, never the last, which the tally has) sums each bulb's
  bed: its crowded points' velocity, how many, how many move (an entry point
  of its own, `csBeds` in `spreadShift.wgsl`, into a slot of sums for that
  substep); after the run one pass of a single workgroup (`csKeep` in
  `prepare.wgsl`) keeps each bed's fastest fall toward the glass's floor
  (along its axis, whatever the field: a flick turns the field round while
  it throws the bed up, and a bed thrown up is not falling) with the
  substep it was at, and clears the sums. The fastest falls live in a small
  buffer of their own (`bedPeak`), copied into the readback and cleared
  only when a readback slot is free, so a fall in a run that got no slot is
  read with the next; a flip clears them (the bulbs have traded places);
- a fall is possible from a substep whose field departs 0.3 g from plain
  gravity, for 0.5 s of simulated time after it (`SND.LIFT_G`, `LIFT_S`; a
  bed thrown up at 100 cells/s is back on its floor within 0.1 s); the
  adapter asks for the sums then alone (`set.beds`), so a glass at rest, held
  in the hand or running pays nothing for them. With the spread pass off (a
  lab option only) nothing is summed and the sound has the readbacks alone,
  as before;
- `bedOf` gives each bed its `peak` (its speed toward the floor, its
  velocity, its points, the share that moves, the substep), and `_hear`
  uses it as the list above says. A motion under way the other way (the bed
  thrown up the glass) is dropped once the peak shows the bed coming down.

On the mock engine, at a run every 2, 4 and 6 frames and every phase of the
toss, each fall now lands one thump 0.2 to 0.3 dB under its energy, at most
a run late; a flick (thrown up by the field turned round, then falling and
landing) lands one thump 0.2 dB under, where the readbacks alone gave 3.6
or 7.8 dB under, or none. On WebGPU in software (realsand-gpu's SOUND case,
a run every 3 frames of 24 substeps against a run a frame, the same flick),
four runs: 0.0039 against 0.0048 (-0.84 dB), 0.0051 against 0.0044 (+0.68),
0.0049 against 0.0059 (-0.75), 0.0044 against 0.0045 (-0.12). At a run a
frame the thump is the fall's energy within 3 %. At that pace the readbacks
alone come as near (0.0045 to 0.0053, logged by the case, not checked): on
this engine a run every 3 frames still catches the fall; the peak's gain is
at a run every 4 to 6 frames and in the phases the mock engine shows.
Before the wake after a jolt was fixed (9.1), the same slow flick, woken
from sleep, was 1.45 to 2.36 dB too loud (six runs). The cost, on the
software GPU, the lab's same-page burst, beds off and on in turn (4 rounds,
ms a substep): nothing at rest (42.62 against 42.65 for the engine before
them), and 2.6 % of a
substep while a fall is possible (43.75); kept at every substep inside
`prepare`'s own pass it had cost 12 to 13 %, and summed in `spreadShift`'s
main entry point every substep 4 to 9 % at rest too, which is why each has
an entry point of its own.

Measured against the classic sand on the same scripted motions (the app's
10 s glass before its start, all the sand above; WebGPU in software, the
phone's motion played through the real `motion.js` to both engines). The
three tables below were made at engine build 6, before the seven-in-ten rule
above, by a probe that is not in the repository; the GPU's figures in them
have not been measured again since the rule and are left out ("not measured
again"), all but the flick along the glass, which the SOUND case below
measures: the rule removes exactly the falls a shaken bed's slip made, so the
landings along the glass and the levels are the ones most likely to have
changed. The classic sand's figures stand: its code has not changed. What
can be measured again here is realsand-gpu's SOUND case (its own motions: a
flick along the glass, a sideways shake of 1.5 g at 5 Hz for 1.5 s, a lean of
30°), whose checks hold the GPU's thump and agitation within a factor of 2 of
the classic sand's. Three whole runs of it at engine build 7, on WebGPU in
software (a 10 s glass before its start; each run passed all its checks),
measured:

- flicked along the glass (2 g for 60 ms, then the stop): one thump in the
  upper bulb in each run, of 0.0039 to 0.0054 (from a fastest fall of 49 to
  58 cells/s), where the classic sand has one of 0.0043; no slam; the
  agitation at its highest 0.54 to 0.67, where the classic's is 0.71. With
  the readbacks unheard (the control) the same flick fed nothing. At
  build 8, four runs of the case: one thump of 0.0044 to 0.0059 at a run a
  frame, and at a run every 3 frames within 0.84 dB of it (the note above).
- shaken sideways at 1.5 g and 5 Hz for 1.5 s: no thump and no slam in any
  of the three runs, as with the classic sand; the agitation at its highest
  1.12 to 1.16, where the classic's is 0.98; the slides 26,600 to 29,400 in
  all and 22,700 to 23,900 a second at their fastest, where the classic's
  are 23,100 and 20,900. (The case does not log the share of points that
  move.)
- leaned 30° and back: the GPU bed did not move, and nothing was heard: no
  landing, no slides, no agitation, where the classic sand's heap runs
  (1,350 slides a second at their fastest).

| motion | thumps: classic (number, summed E, largest) | GPU | agitation: classic (highest, summed over time) | GPU |
|---|---|---|---|---|
| a flick along the glass (2 g, 60 ms) | 1, 0.0043, 0.0043 | 1, 0.0039 to 0.0054 (build 7, three runs) | 0.71, 0.23 | 0.54 to 0.67 (build 7, three runs); summed not measured again |
| a flick sideways | none | not measured again | 0.43, 0.14 | not measured again |
| 1.5 g at 5 Hz sideways, 3 s | none | not measured again | 0.87, 2.20 | not measured again |
| 1.5 g at 5 Hz along the glass, 3 s | 10, 0.072, 0.013 | not measured again | 2.36, 3.61 | not measured again |
| carried at a walk | none | not measured again | 0.72, 2.85 | not measured again |

Nothing is fitted in the thumps and the agitation: they are the classic
sand's own formulas on the GPU bed's own motion. Walking differs on
purpose: the classic sand's temperature follows the phone's motion, the GPU
bed's follows the bed, and walked with, the GPU bed lies still. And a
thump is the energy of the GPU bed's own fall, which is not always the
classic bed's: a flick whose pull is held longer (1.3 g for 83 ms) throws
the classic sand's bed up as one body (a thump of 0.0145), while the GPU
bed loosens as it lifts and comes down slower (0.004 and 0.009 in two
takes: half to four fifths as loud, since `audio.js` plays the square root;
build 6, before the rule, not measured again).

The slides, with their one calibrated share, on the same motions and on a
1 minute glass (2,830 grains; in all, and a second at their fastest as
`app.js` smooths them; the GPU's not measured again since build 6):

| motion | classic | GPU |
|---|---|---|
| 1.5 g at 5 Hz sideways, 10 s glass | 39,200; 21,300 | not measured again |
| the same, 1 minute glass | 68,700; 36,000 | not measured again |
| a flick sideways, 10 s glass | 1,260; 7,000 | not measured again |
| 1.5 g at 5 Hz along the glass, 10 s glass | 4,540; 6,200 | not measured again |
| a flick along the glass, 10 s glass | 0 | not measured again |
| leaned 50°, 1 minute glass | 8,760; 7,770 | not measured again |
| laid on its side (90°) and stood up again, 1 minute glass | 59,700; 23,800 | not measured again |

Thrown along the glass the GPU bed loosens and packs again, which is motion
within it, where the classic sand's bed flies as one body. Counted in full,
that was 6,600 slides a second at their fastest for a flick of the 10 s
glass and 14,400 for the minute's, where the classic sand has none, and in
a glass that stands the rush played it louder than the thump: the flick
sounded 6 and 10 dB over the classic sand's. A thrown bed's motion is
therefore not counted while it flies (the rule above); what is left is the
push and the settling, 1,900 and 4,000 slides a second. Leaned 50° the GPU sand of
these glasses all but stands (its centre creeps three cells in three
seconds), where the classic sand's heap runs: a lean is heard only as far
as the GPU sand answers it (section 12: heaps stand steep). Laid on its
side, the GPU bed goes across from about 60° as one body that shears as it
goes (18,000 to 21,000 slides a second for half a second), and stood up
again it slides back and lands in the funnel: a thump of 0.043 and its
heat, where the classic sand's heap runs back grain by grain and lands
nothing. (The GPU figures of this paragraph are build 6's, before the
rule, and have not been measured again.)

What the ear is given: both engines' feeds for the same motion, as `app.js`
passes them on, played through `audio.js` (a glass before its start, the
default volume; dBFS RMS over the motion and a second after, the mean of
three renders, which differ by about 1 dB among themselves; the GPU's
levels were measured at build 6, before the rule, and not again):

| motion | classic | GPU | GPU over classic |
|---|---|---|---|
| a flick along the glass, 10 s glass | -65.4 | not measured again | |
| the same, 1 minute glass | -64.1 | not measured again | |
| 1.5 g at 5 Hz sideways, 10 s glass | -45.6 | not measured again | |
| the same, 1 minute glass | -43.6 | not measured again | |
| 1.5 g at 5 Hz along the glass, 10 s glass | -44.8 | not measured again | |
| the same, 1 minute glass | -44.5 | not measured again | |
| laid on its side and stood up again, 1 minute glass | -43.7 | not measured again | |

(At build 6, before the rule, the 1 minute glass's flick had two thumps,
0.0022 as the push pressed the bed down and 0.0036 as it landed, where the
classic sand has one of 0.0043; not measured again since.)

A blow of the glass from 700 px/s thumps and clacks (`impact` returns 1).
Mending is forwarded to the CPU Sim, whose event plays the chime. The
landing buzz follows `frame.thump`, as with the classic sand; every other
haptic is the app's own, tied to its own events.

---

## 9. Power

### 9.1 Modes

`realsand/modes.mjs`, shared with the lab's Timer:

| mode | when | GPU work |
|---|---|---|
| asleep | not running and not draining, the sand still (the newest readback shows at most 3 points moving faster than 2 % of a free fall over the glass) for 0.5 s, nothing pending; or hidden | none; the last picture stays |
| full | the glass moved or held, turned or poured, felt motion over the thresholds below, the first 2 s of a run, its tail and end, and 2 s after any of these | every display frame; 480 substeps a second, auto Hz up to 1,440 |
| calm | running, draining or the sand moving, and none of the above | 30 frames a second at the same 480 substeps a second, auto Hz off |

- Felt motion that counts: the glass's acceleration from 0.05 g, turning
  from 0.5 rad/s or 5 rad/s², held for 0.3 s; or a lean that changes by 3°
  within 0.5 s. A phone held still in the hand passes the CPU sand's own idle
  thresholds every frame; these are coarser, so a held phone runs calm.
- A jolt counts at once: 0.3 g at any moment since the last frame wakes a
  sleeping glass in the frame it comes; the hand's jitter (0.28 g and less)
  does not. The first run after such a wake starts from the jolt's first
  sample, so its push is not lost, and covers only the time since the jolt,
  also on a slow display (from build 8). Until build 7 it covered at least
  the whole frame: on a display of 50 ms frames, woken by a flick 16.7 ms
  before the frame, the run was 50 ms of substeps laid over 16.7 ms of
  samples, one field held for 25 ms where it lasts 8.3 ms (the adapter's
  check, with that rule as its control); on the software GPU at a run every
  3 frames, 24 substeps over the flick's first 13 ms, its push held for 15
  substeps (about 6 at a run a frame), the bed thrown about 15 % faster and
  its thump, from build 8's fastest fall, 1.45 to 2.36 dB too loud until
  this was fixed.
- Asleep, the glass also wakes once its lean has changed by more than 1°
  since it fell asleep, however slowly (the app's `wakeAll`).
- Calm is entered only while auto Hz is at the base rate, so a change of mode
  never changes the substep rate.
- **The heat guard:** when the simulated time stays under 0.6 of real time
  for 20 s in a row while full, the glass runs calm until the run ends. Each
  trip is logged in the report.
- The rule's limit: a bed sliding as a whole slower than the stillness speed
  counts as still and could fall asleep mid-slide.

The clock does not depend on how fast the sand runs (3.2); only the stream's
speed does. There is no economy mode.

### 9.2 Cost

A substep is 16 dispatches (14 without the spread pass), with a fixed cost
each on a phone. In the sand lab on an iPhone, the 60-minute glass kept the
graphics chip 85 % busy at the full rate and 79 % calm: its substeps are most
of the work, so calm saves little on a long glass. At most two frames of work
are in flight, and the substeps a frame may run (the GPU's budget) follow the
back-pressure of frames skipped, not a timing (`realsand/pace.mjs`), never
below the base rate's real-time need unless the GPU cannot give even that.
The beds' fastest falls (section 8, from build 8) add no dispatch to a
substep: while a fall is possible, every second substep runs the spread's
shift through its summing entry point instead of its plain one, and the run
ends with one pass of a single workgroup. On the software GPU (the lab's
burst, the same page with them off and on, 4 rounds) that is 2.6 % of a
substep while a fall is possible and nothing at rest (42.62 ms a substep
against 42.65 for the engine before them); the lab's Benchmark, on separate pages, varies
by about 5 % on that machine and cannot settle a figure this small. A
phone's figure is not measured yet.

### 9.3 What the lab measures

The GPU's cost a substep is measured by a burst: with nothing else in flight,
one submit of 24 substeps and one of 96, ten times each; the cost is the
difference of the medians over 72, which takes out a submit's fixed latency
(the lab's Timer before its clock starts, and **GPU cost**). The lab's Timer
runs the sand as the app does (the app's amounts, clock, tail and breathing,
through the valve) and shows the count against the clock's target, the
shortfall, the queue, the throttle's speed and refused crossings; its Copy
results adds the record of each glass's end, the bursts, the time in each
mode and a lifecycle log. See [the sand lab](../testing.md#lab-sand-test-page).

---

## 10. Platform

### 10.1 Start-up, self-test and failures

`start()`:

1. the device (`createDevice`): no `navigator.gpu` (`nogpu`) or no adapter
   (`noadapter`); a software adapter is refused (`fallback`: "This device's
   graphics are too slow for Real sand"), except for the tests;
2. the pipelines and the grains' renderer; a shader that will not load
   (`load`) or compile (`compile`); shaders of another build (`stamp`, 2.3);
3. the buffers;
4. the self-test: 500 points on the shut neck, 24 substeps; the tally must
   show all 500, none not finite, none outside the glass, all still above;
5. the page hidden, or the device lost, during all this (`hidden`, `lost`).

The times of each part and of the first frame drawn are logged for the
report. A slow start is never a failure: the CPU sand runs and shows
meanwhile.

- **A missing capability** (`nogpu`, `noadapter`, `fallback`): the row says
  why, with "Tap to try again"; the setting stays on. `nogpu` is found again
  at every launch for nothing; `noadapter` and `fallback` keep the browser's
  user agent, and while it is the same a launch loads nothing (settings
  design 5.2). One found while the page was put away since the start began
  is treated as hidden, below.
- **Hidden or lost while starting:** started again once the page is in view
  (at most three times a session), since a home-screen app can stay alive
  for days and "the next launch" can be far off.
- **A stamp of another build:** the note says Real sand is updating; not
  counted.
- **Anything else:** the CPU sand this session, the setting kept, the note
  says why, and the next launch tries again; after three launches in a row
  it stops trying until the switch is turned off and on.

### 10.2 Offline and updates

The engine is in `SHELL` (2.3), installed with the app. A load failure is a
start failure that tries again (10.1); the build stamps catch a mix of old
and new files.

---

## 11. Tune

The row: **Real sand**, in the Material group after Grain, with a note under
it that says how it is doing, and the bare state in its `data-state`: *On:
every grain simulated on the graphics chip*, *Starting…*, *Off: the classic
sand*, *Needs WebGPU (iOS 26 or later). Tap to try again* (the switch shown
off, never disabled), *Could not start this time: (why). It will try again
next launch*, *Did not start 3 times: (why). Turn it off and on to try
again*, *Real sand is updating; it will be back at the next launch*, *Real
sand paused: the graphics chip was reset* (or *stopped answering*, the
watchdog of settings design 5.4), and the final pauses (7.9). The
[guide](../guide.md#real-sand) has them all with what each means. Grain,
and the crack sentence of Real motion, are the classic sand's: they are
hidden while the GPU sand runs or is about to (on, starting, lost), since
the GPU's grid is the same at every grain (3.3) and its glass does not
crack (12). With the switch on, the row has **Copy a report**, which copies
the engine's figures and its log, also from a home-screen app, where
`?debug=sand` cannot reach. The switch is on by default from 1.10.0
(settings design 5); it was off until then.

---

## 12. What it leaves out

| left out | with Real sand on |
|---|---|
| Cracks, leaks, spilled sand | the glass does not crack: a blow thumps and clacks, knocks, flicks and shaking do nothing to it; cracks it already has stay drawn (from the CPU Sim), leak nothing and can be mended; Reset makes it whole |
| The classic sand's shimmer under a phone that moves without moving its sand (carried at a walk) | silent: the bed's sounds are made from what the GPU sand did (section 8) |
| The beds sliding on when a carried glass stops (`setCarry`) | none |
| Tilt out of the page's plane | ignored: the sand is 2-D |
| Bloom, rim light, depth shading, gloss | not drawn; the lab's lit grains |
| Fine and Finest | no effect on the GPU sand; they set the CPU sand's grain |
| The lab's known faults | a turned bed slides round the glass as a block before it breaks up, a bed at rest creeps, heaps stand steep |
| Glass shapes other than the classic | the GPU's glass is built from the app's own geometry; every shape Tune offers is filled and run out on time by `realsand-gpu`'s SHAPES case |

---

## 13. Tests

Every suite is described in [Tests](../testing.md); these are Real sand's.

### 13.1 Node (fast)

- `realsand-valve`: the valve against a model of the GPU's neck and of the
  app's clock (`tools/test/lib/realsand-plant.js`): every grain setting,
  pours, Flips, spins, tilt swaps, sleeps and catch-ups, Resets, long glasses,
  the slowest and fastest rests, throttles stronger or weaker than assumed,
  late readbacks. No crossing below the target in any substep, the count the
  clock's own while supplied and never back, the last point within one
  substep of `00:00.0`; the first bookkeeping kept as its control.
- `realsand-fill`: the fills' exact counts, inside the glass; the colour
  seeds; the felt jolts' film against the lab's code.
- `realsand-felt`: the live playback against the film, the cap, the floor's
  frame, and the real `motion.js` on the replay streams.
- `realsand-adapter`: RealSand on a mock solver whose neck is the valve
  test's model, inside a copy of the app's frame: the contract (section 4),
  every clock site (3.6), the start's failures, the heat guard, sleep, losses,
  the swap frame; and the bed's sounds (section 8), the mock solver saying
  what its sand does (`tools/test/lib/realsand-beds.js`).
- `realsand-shell`: the worker's `SHELL` against the engine's files, and the
  four build stamps (2.3); `app.js` holds no module syntax.
- `lab-timer` and `lab-pace`: the lab's Timer and the GPU's pace.

### 13.2 Browser without WebGPU

The app harness has no WebGPU adapter. `app-realsand` covers the switch
there: off, nothing under `realsand/` is requested; on with the real engine,
the row says it needs WebGPU, the setting stays on and the user agent is
kept; on with the real adapter on a mock graphics
chip (`stubs/realsand-mock-boot.mjs`, served as `realsand/boot.mjs`): the
handover, a 10 s glass to its end, Reset, pours, gaps, Flips, the swap frame,
losses in view and hidden, a slow start, the wake lock, the sound's numbers,
the bed heard when the glass is moved (before the start, running, paused and
finished, with the mock engine saying what its sand does; nothing asleep or
hidden, silence when muted),
the glass that does not crack, themes and layers, and the report. The
monitor every suite runs (`stubs/page-init.js`) follows `Hourglass.sim` when
the GPU sand takes over and checks its readbacks (`audit()`).
`app-regression`'s worker check serves a new engine midway: the app keeps
its cached one, a lab page gets the new one.

### 13.3 Browser with WebGPU in software (slow; only when named)

`realsand-gpu`: the app with Real sand on the real engine, on Chromium's
WebGPU in software (SwiftShader), with `?offscreen=1` and the page's clock
made virtual once the engine has started, so the sand runs at real time in
it. Eight cases on 10 s glasses: the start and the handover; the bed's
sounds before the start (asleep nothing; flicked, shaken and leaned, beside
the classic Sim on the same motion); a glass to its
end, its last grain within one frame after `00:00.0` by the chip's own
record, and no sound of a bed from it while it is left alone; Reset; a
Flip; a pour with real motion turning the glass; 30 s
hidden and caught up by one transfer; the chip lost mid-run. `lab-sand` runs
the lab, Timer included, the same way.

---

## 14. How it was built

In two stages, each checked on a phone before the next. Stage 1a moved the
lab's engine into `realsand/`, gave it the metered neck and the lab's Timer,
and changed nothing in the app; its phone check (Gate A) ran the lab in
Safari and as a home-screen web app. Stage 1b added the switch, RealSand and
everything above to the app; its phone check is Gate B. Code comments that
name a gate refer to these.
