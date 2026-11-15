# Hourglass

A sand hourglass timer for the browser. Every grain is simulated, every sound is
synthesised live, and nothing is loaded from anywhere else: no libraries, no CDNs,
no audio files. It installs as a Progressive Web App and runs offline.

Live (once GitHub Pages is enabled): `https://elkhanany.github.io/hourglass/`

## Using it

| Action | Touch | Keyboard |
| --- | --- | --- |
| Start / pause | Tap the glass, or the round button | `Space` |
| Move the glass | Drag it by its waist | |
| Turn the glass | Drag a bulb round; flick it to spin; touch it to stop. Or **Flip** | `F` |
| Mend a crack | Hold a finger still on the glass | |
| Add sand (extends the timer) | Tap or hold **Sand** | focus + hold `Space` |
| Reset | **Reset** | `R` |
| Duration | Pills `1 3 5 10 15 25 45` min, **Custom**, or tap the time (10 s to 99:59) | |
| Dim the controls now | Moon icon | |
| Mute | Speaker icon | `M` |
| Material, frame, sound, motion, screen | **Tune** | |

After four seconds of running without a touch the controls fade slowly, over
about three seconds, to 12 % (or disappear entirely with *Full Zen*) as the
glass grows to fill the screen; while they are dimmed the tenths rest. While
they are still visibly fading they answer a tap as usual; once dim, the first
tap only brings them back. Playing with the glass (moving, turning, spinning,
catching or mending it) keeps them dim; only a tap brings them back. The moon
icon starts the same fade at once and,
where the browser allows it, goes full screen. With *Reduce Motion* turned on
in the system settings, all of this happens at once instead.

When the sand runs out while the controls are dimmed, the glass stays still
through the last grains and the bowl, then the controls return slowly. A
touch brings them back at once. The app itself opens by fading up from dark,
with the glass already in its place.

A longer glass holds more sand: about a third full for one minute, half for
five, three quarters for 45.

**Tune** holds the rest:

- **Material**: Sahara Quartz, Volcanic Black, Moonstone; **Frame** hides the
  caps and posts so only the glass remains.
- **Acoustic character** (six voicings) and volume; **Ambience** (a brook or
  rain behind the sand, with its own level); **Completion bowl**.
- **Keep screen awake** while the sand is flowing, and for 12 s after it runs
  out (Screen Wake Lock API).
- **Real motion**: the sand feels what the phone feels. Lean it and the piles
  slump, lay it on its side and the flow (and the clock) stop, turn it over
  and the other bulb becomes the top. Walk and the falling thread sways;
  shake it and the sand lifts and lands; twist it and the sand sloshes; spin
  it flat on a table and the sand is pushed to both ends. Shaken very hard,
  for several seconds, the glass can crack (it creaks first).
- **Full Zen**, **Haptics**.

The glass also remembers where it was: close or reload the page and a running
timer carries on from the wall clock, a paused one comes back as it was left,
cracks and gold seams included.

### Playing with the glass

The glass is an object you can hold. Take it by its waist and it follows the
finger on a soft tether, lifting off its shadow; let go and it springs home
with a small sway. Take it by a bulb and it turns; flick it and it spins on by
itself, slowing as its sand is flung outward, and settles upright or inverted.
Each half turn swaps the time, as the Flip button does. Touch it while it
moves and it stops under your finger. The sand feels all of this at the true
scale of the glass on the screen, so a gentle drag barely stirs it and a hard
spin pins it to both ends.

With Real motion on, very vigorous shaking (big, fast swings kept up for about
five seconds) can crack the glass. Four faint creaks and glints come first.
Then a fine silver hairline appears; keep going and a chip opens, and sand
trickles out onto the desk below. Hold a finger still on a cracked glass and
gold flows into the crack and seals it (kintsugi), without stopping the
timer. Reset, or a new duration, gives a fresh glass. Drops, knocks, walking
and anything done with a finger can never crack it, and with *Reduce Motion*
on it cannot crack at all.

## How it works

### `physics.js` — simulation and renderer

- **Hybrid granular model.** Packed and sliding sand lives on a lattice of typed
  arrays (one cell = one grain). Grains that leave the neck, are poured in, or
  splash become ballistic particles with sub-pixel position and velocity
  (`v = v0 + g·Δt`), and return to the lattice when they come to rest.
- **Stick and slip.** Sand does not creep, it lets go. A static grain holds
  until the slope over four columns passes 3:4 (37°, the angle of maximum
  stability); once moving it keeps running on slopes down to 1:2 and wakes its
  neighbours, so the surface gives way in small avalanches and builds again.
  Landed grains tumble downslope in short hops while the surface is steeper
  than 3:4. Measured in the test harness the slope breathes between about 32°
  and 36° and averages 33° to 34°.
- **A living stream.** The flow rate swings by tens of percent around its mean
  (slow breathing, pulses near 2 Hz, fine flutter) and the stream leaves the
  neck as one thin thread that wanders. The swings average to zero and fade
  out before the end, so timing is unaffected.
- **Drain funnel.** Voids rise from the neck and diffuse sideways, so the upper
  surface dips in the middle instead of sinking flat.
- **Exact timing.** The wall clock (`Date.now()`) is the master. For any
  remaining time the app knows how many grains must still be above the neck,
  and the neck releases exactly the difference on each fixed 120 Hz step. The
  flow therefore self-corrects after dropped frames, and the last grain leaves
  the neck on the frame the readout reaches `00:00.0`. The final grains thin
  out into single drops. If the page was asleep, the sand that should have
  fallen is laid down at once when it returns (grains still in the air land
  first), and the stream carries on as its usual thin thread.
- **Turning and gravity.** Gravity is a vector. While the glass turns (by the
  button, by hand, or because the device itself is turned) it rotates
  continuously in the vessel's frame, so the sand tumbles along the glass.
  Past 180° the lattice is re-indexed (the vessel is exactly point-symmetric)
  and elapsed and remaining time swap.
- **Sleep map.** Only rows near something that changed are swept, so a settled
  pile costs almost nothing during long timers.
- **Sand rendering.** Each grain is a lit 2×2 bead with a persistent colour
  seed, depth-based ambient occlusion, a rim-lit surface, glossy facets and
  mica glints, written straight into an `ImageData` buffer. A half-resolution
  bloom layer adds the light scattered around the brightest grains.
- **Glass rendering.** The vessel is a surface of revolution, so every pixel
  has an exact 3-D normal. A WebGL fragment shader lights it like a renderer
  would: Fresnel reflection of a small studio (softbox, strip, kickers, a
  pair of rim strips almost straight behind that draw a fine bright line
  along the glass's own edge, one hard lamp), the mirrored second highlight
  of the far wall behind the sand, absorption along the true path through the
  shell, light bent through the solid rim, and the inner surface turning
  mirror-like at a glance, so the sand darkens softly where it meets the
  glass. The room stays put while the glass turns, so highlights slide across
  it. Without WebGL the app falls back to a drawn glass on 2-D canvas.
- **Sand stays inside the glass.** The lattice only knows whole cells, so
  grains, motion streaks and the glow are all clipped at half-cell resolution
  to the same smooth inner surface the glass is drawn with.

Grain counts depend on the duration: on phones from about 10,000 (one minute)
to 21,000 (45 minutes), up to 24,000 after adding sand; roughly 45 % more on
larger screens.

### Motion

- **The felt field.** Every inertial effect enters at the strength it would
  have on a real glass of the size this one appears on screen (1 CSS px is
  about 0.16 mm on an iPhone). The phone's felt acceleration and the glass's
  own on-screen acceleration are added to gravity in the vessel's frame; its
  turning adds centrifugal and Euler terms at the sand's centroid in each
  bulb, and Coriolis on grains in flight. So the thresholds are real ones:
  the bed lifts off at 1 g, and sand pins to the far ends once ω²r passes g.
- **The bouncing bed.** A shaken, packed bed lifts as one body and lands with
  a thump (a completely inelastic bouncing bed). Columns ride it until they
  meet glass; landings spray grains against the wall, and an agitated surface
  boils with hopping grains.
- **Agitation.** Each bulb has a granular temperature driven by how much its
  field changes (not by a steady lean). Hot sand loses friction and sweeps
  faster, so shaken heaps flatten toward their dynamic slope and freeze flat
  when the shaking stops.
- **The neck under shaking.** The neck only lets sand through while the upper
  bed sits on it and the field presses sand into it, so the stream stutters
  with the hand. The gate row stays glass: no grain ever crosses it except
  through the valve.
- **At rest, nothing changed.** While nothing moves, each physics step is
  exactly the step the hourglass always took, grain for grain.

### Glass and fracture

- **Stress corrosion with a fatigue limit.** Each column of sand that slams
  into the glass sends a pulse whose stress goes with its impact speed; below
  a threshold (the fatigue limit) a crack never grows at all, which is why
  firm shaking, however long, never cracks it. Above it, damage grows as the
  speed to the 16th power (soda-lime glass), absorbed at a bounded rate.
  Lateral shaking also bends the waist like a beam.
- **Weibull flaws.** Every glass gets its own flaw strengths along its wall
  (a Weibull distribution of modulus 20), drawn from a seed, so a crack
  starts where the load and the weakness meet: the lower dome under vertical
  shaking, the funnel shoulder under slams, the waist under lateral shaking.
- **Warnings.** Damage on a stretch of glass that has not cracked slowly
  heals; four rising levels each creak and glint before any crack, and damage
  rises slowly enough that the creaks come at least two seconds before it.
- **Breach and leak.** A long enough crack breaks through: a chip opens in the
  wall and grains leave through it. The leak is 2-D Beverloo flow with
  jamming: a one-grain breach arches over and stops at rest, and shaking
  breaks the arches. Escaped grains fall in the room and gather in a small
  dune on the desk line, which stays put while the glass moves and slides
  when the phone is tilted.
- **Kintsugi.** Mending closes every open breach at once and draws the cracks
  in gold; the mended seam is half as strong again.
- **Drawn calmly.** Cracks are fine silver hairlines that glint as the glass
  turns against the room's light; a breach is a small dark chip in the
  glass's bright edge. No shards, no red.

### Timer under motion

The wall clock stays the master. Moving, shaking, catching and mending never
stop the clock; only a turn (by hand, by a spin or by the Flip button) and
laying the phone on its side do. A shaken neck falls behind, so while shaking
is recent a backlog drains as a slightly thicker thread instead of a clump,
and the page's sleep catch-up never teleports sand. Once the glass is calm
again, the rest of the run is re-timed so the sand that is there lasts
exactly the time that is left: the last grain still leaves at `00:00.0`. Sand
leaking from the upper bulb is absorbed the same way; sand leaking from the
lower bulb never touches the time.

### Sensors

`motion.js` turns `devicemotion` and `deviceorientation` into what the sand
feels: the felt acceleration in the page plane, its out-of-plane part, the
phone's twist rate (from the heading) and a flat spin's rate (from the size of
the rotation rate, which needs no axis order). Engines disagree about the
accelerometer's sign and units, so they are learnt while the phone is still,
against `deviceorientation`, and the sign is remembered. Readings are read one
sample behind so each physics step gets its own, fade when they stop, and are
ignored while the page is hidden. Only sustained, very hard shaking (a 3-D
RMS of 1.5 g kept for 0.6 s) arms the glass for damage. One permission covers
it all.

### `audio.js` — procedural sound

Web Audio API only.

1. **Glass cavity**: six narrow band-pass resonators (680 Hz to 7.25 kHz) fed by
   the other layers; their pitch rises as the lower bulb fills.
2. **Neck whisper**: looped pink noise shaped into a 2.5 to 9 kHz band over a
   little band-passed brown noise, driven by the flow rate and slow LFOs.
3. **Grain impacts**: 0.8 to 3 ms impulses triggered by physics impact events,
   crisp on bare glass and softer once sand cushions the floor, plus Poisson
   textures for dense flow.
4. **Foley**: pour rush, flip thud and stereo sweep, and a singing-bowl bloom at
   the end (optional).
5. **The glass in the hand**: soft thumps as a shaken bed lands, glassier
   clacks when it slams the far end, a shaker shimmer while the sand is
   agitated, the slosh panned between the ears, a felt stop when you catch a
   spinning glass. A strained glass creaks; a crack snaps and rings, then the
   vessel sounds a little dull until it is mended with a small bell. Leaking
   sand patters on the desk.

Output passes through a generated 0.35 s room impulse response, a compressor and
a soft clipper.

Six characters re-voice the same engine. *Close-Miked ASMR*, *Warm Glass* and
*Pure Sand Whisper* differ in balance and tone. Three more change the vessel
itself, by retuning the resonator bank and the pitch of each grain:

- *Singing Glass*: resonators tuned to a D major pentatonic with long rings, so
  every grain strikes a small bell.
- *Bamboo Rainstick*: broad, quickly damped woody resonances and lower-pitched
  impacts.
- *Desert Dune*: low resonances (150 Hz upward) driven hard by the whisper and
  the avalanches, for the hum of sliding sand. Much of it sits below what a
  phone speaker reproduces; it is meant for headphones.

An optional **ambience** plays behind the sand while it runs, bypassing the
character's tone shaping. It keeps flowing through the last grain, then
recedes under the bowl.

- *Brook*: running water, built from the air it traps. Each bubble rings at a
  pitch set by its size (Minnaert) and dies within milliseconds: about 280 a
  second of tiny ones (the fizz above 2.4 kHz), 170 middling ones (the
  babble) and a dozen big, low ones, over the flickering rush of the current.
  Its spectrum, burstiness, tonality, flicker and stereo image were matched
  band by band to six field recordings of small streams; it lands inside the
  range of 53 to 54 of the 54 measures, where the previous brook missed 34.
  Both ears hear the same bubbles, panned and slightly delayed. The flow loops
  every 9.3 s and the big bubbles every 14.3 s, so the two only line up again
  after about 22 minutes.
- *Rain*: a dense patter of fine filtered clicks, a few heavier drops and a
  distant hiss.

Both are synthesised into seamless loops in short steps, one per slice of
main-thread time (each a few to a few tens of milliseconds, so the sand keeps
falling smoothly): the saved one while the page settles after loading, another
the first time it is chosen.

Levels and spectra were set by offline rendering and measurement (about
−25 dBFS RMS with grain peaks near −9 dBFS at the default volume; the brook
and rain sit near −26 and −28 dBFS at their default level). The three newer
characters and the ambiences have not been tuned by ear (the brook was matched
to measurements, not by listening), so treat the tables at the top of
`audio.js` (`CHARACTERS`, the `MODES_*` sets, `WATER`, `AMBIENCES`) as a
starting point.

### `app.js`, `index.html`, `styles.css`

Timer state, controls, Zen HUD, settings and the running session (stored in
`localStorage`, with the glass's damage), the glass as a body (springs for the
finger, home and the detent, a coasting spin that conserves angular momentum
as the sand moves), the felt field composed for every physics step, re-timing,
the Real motion permission, screen wake lock, a frame-time governor that
lightens the physics on slow phones, and service-worker registration. The
clock uses `Date.now()` so it keeps counting while a phone sleeps. A hidden
`?debug=motion` overlay shows the sensors and the sand's state, and
`&rec=N` records N seconds of raw sensor events to a file, for tuning on a
device.

### `sw.js`, `manifest.json`

Offline-first, stale-while-revalidate cache of the app shell. Every path is
relative (`./`), including `start_url` and `scope`, so the app works from a
sub-directory such as `/hourglass/`.

## Deploying to GitHub Pages

1. Merge to `main`.
2. Repository **Settings → Pages → Build and deployment**: *Deploy from a
   branch*, branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/hourglass/`.

The empty `.nojekyll` file in the repository root tells Pages to serve the files
as they are, without running Jekyll.

When you change any shipped file, bump `VERSION` in `sw.js` so installed copies
drop the old cache.

## Running locally

Any static file server works. The page must be served over `http://localhost`
or HTTPS for the service worker to register.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Tests

Development-only tests live in `tools/test` and are not part of the app (the
service worker does not cache them). They need Node 22 and a global
Playwright with Chromium:

```bash
node tools/test/sim-identity.test.js           # physics, in Node
node tools/test/app-gestures.test.js           # the app, in an iPhone 12 Chromium
node tools/test/e2e-calm.test.js               # integration scenarios E1–E14
```

Each prints one line per check and exits non-zero on a failure. The browser
tests start their own server (`--port`, default 8804) and can be pointed at
another checkout with `--root`. Without a GPU, Chromium shades the WebGL glass
in software and every frame of a turn takes most of a second, so the browser
tests use the app's own 2-D glass unless given `--webgl`.

## Icons

`icons/` holds the SVG source and the PNG sizes the manifest and iOS need.
`tools/icons.html` regenerates all of them in the browser from one SVG
template; it is not part of the installed app.

## Browser notes

- iOS Safari only starts audio from a user gesture. The app creates and resumes
  the audio context on the first touch, and resumes it again after an
  interruption (call, lock screen, tab switch).
- Real motion needs motion permission on iOS 13+; the switch asks for it, once
  for both sensors. If the browser asks again after a reload, the switch stays
  on and the next tap on the screen asks (where the site was already allowed,
  that answer comes back without a prompt).
- Keep screen awake needs the Screen Wake Lock API: Safari 16.4+ on iOS, and
  iOS 18.4+ when installed to the home screen.
- A web app cannot hide the iPhone status bar or silence notifications. On
  Android the installed app runs full screen; in desktop and Android browsers
  the moon icon enters full screen.
- Haptics use `navigator.vibrate`, which iOS does not provide (iOS has no web
  haptics).
- The completion sound can only play in a hidden tab if the browser keeps the
  page's audio running; on a locked phone it generally will not.

## License

GPL-3.0. See `LICENSE`.
