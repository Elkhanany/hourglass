# Hourglass

A sand hourglass timer for the browser. Every grain is simulated, every sound is
synthesised live, and nothing is loaded from anywhere else: no libraries, no CDNs,
no audio files. It installs as a Progressive Web App and runs offline.

Live (once GitHub Pages is enabled): `https://elkhanany.github.io/hourglass/`

## Using it

| Action | Touch | Keyboard |
| --- | --- | --- |
| Start / pause | Tap the glass, or the round button | `Space` |
| Turn the glass | Drag it round with a finger, or **Flip** | `F` |
| Add sand (extends the timer) | Tap or hold **Sand** | focus + hold `Space` |
| Reset | **Reset** | `R` |
| Duration | Pills `1 3 5 10 15 25 45` min, **Custom**, or tap the time (10 s to 99:59) | |
| Dim the controls now | Moon icon | |
| Mute | Speaker icon | `M` |
| Material, frame, sound, gravity, screen | **Tune** | |

After four seconds of running without a touch the controls fade slowly, over
about three seconds, to 12 % (or disappear entirely with *Full Zen*) as the
glass grows to fill the screen; while they are dimmed the tenths rest. While
they are still visibly fading they answer a tap as usual; once dim, the first
tap only brings them back. The moon icon starts the same fade at once and,
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
- **Real gravity**: the sand follows how the device is held. Lean it and the
  piles slump, lay it on its side and the flow (and the clock) stop, turn it
  over and the other bulb becomes the top.
- **Full Zen**, **Haptics**.

The glass also remembers where it was: close or reload the page and a running
timer carries on from the wall clock, a paused one comes back as it was left.

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
`localStorage`), motion permission, screen wake lock, and service-worker
registration. The clock uses `Date.now()` so it keeps counting while a phone
sleeps.

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

## Icons

`icons/` holds the SVG source and the PNG sizes the manifest and iOS need.
`tools/icons.html` regenerates all of them in the browser from one SVG
template; it is not part of the installed app.

## Browser notes

- iOS Safari only starts audio from a user gesture. The app creates and resumes
  the audio context on the first touch, and resumes it again after an
  interruption (call, lock screen, tab switch).
- Real gravity needs motion permission on iOS 13+; the switch asks for it.
- Keep screen awake needs the Screen Wake Lock API: Safari 16.4+ on iOS, and
  iOS 18.4+ when installed to the home screen.
- A web app cannot hide the iPhone status bar or silence notifications. On
  Android the installed app runs full screen; in desktop and Android browsers
  the moon icon enters full screen.
- Haptics use `navigator.vibrate`, which iOS does not provide.
- The completion sound can only play in a hidden tab if the browser keeps the
  page's audio running; on a locked phone it generally will not.

## License

GPL-3.0. See `LICENSE`.
