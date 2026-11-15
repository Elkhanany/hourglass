# Hourglass

A sand hourglass timer for the browser. Every grain is simulated, every sound is
synthesised live, and nothing is loaded from anywhere else: no libraries, no CDNs,
no audio files. It installs as a Progressive Web App and runs offline.

Live (once GitHub Pages is enabled): `https://elkhanany.github.io/hourglass/`

## Using it

| Action | Touch | Keyboard |
| --- | --- | --- |
| Start / pause | Tap the glass, or the round button | `Space` |
| Flip (elapsed and remaining swap) | **Flip** | `F` |
| Add sand (extends the timer) | Tap or hold **Sand** | focus + hold `Space` |
| Reset | **Reset** | `R` |
| Mute | Speaker icon | `M` |
| Duration | Pills `1 3 5 10 15 25 45` min, or the `mm:ss` dial (10 s to 99:59) | |
| Material, sound, tilt, Zen | **Tune** | |

After four seconds of running without a touch the controls fade to 12 %
(or disappear entirely with *Full Zen*). The first tap only brings them back.

## How it works

### `physics.js` — simulation and renderer

- **Hybrid granular model.** Packed and sliding sand lives on a lattice of typed
  arrays (one cell = one grain). Grains that leave the neck, are poured in, or
  splash become ballistic particles with sub-pixel position and velocity
  (`v = v0 + g·Δt`), and return to the lattice when they come to rest.
- **Angle of repose.** A static grain holds until the slope over three columns
  exceeds 2:3 (33.7°). A grain already moving keeps running on slopes down to
  1:2, and wakes its neighbours as it goes. Landed grains keep tumbling
  downslope in short hops while the surface is steeper than 2:3. Measured in
  the test harness: 33° at rest, up to about 39° transiently under a very fast
  pour.
- **Drain funnel.** Voids rise from the neck and diffuse sideways, so the upper
  surface dips in the middle instead of sinking flat.
- **Exact timing.** The wall clock (`performance.now()`) is the master. For any
  remaining time the app knows how many grains must still be above the neck,
  and the neck releases exactly the difference on each fixed 120 Hz step. The
  flow therefore self-corrects after dropped frames, and the last grain leaves
  the neck on the frame the readout reaches `00:00.0`. The final grains thin
  out into single drops. If the tab was hidden, the backlog is moved in bulk
  when it returns.
- **Flip and tilt.** Gravity is a vector. During a flip it rotates continuously
  in the vessel's frame, so the sand tumbles along the glass; at 180° the
  lattice is re-indexed (the vessel is exactly point-symmetric) and the
  simulation is upright again. Device tilt adds up to ±16°.
- **Sleep map.** Only rows near something that changed are swept, so a settled
  pile costs almost nothing during long timers.
- **Rendering.** Each grain is a lit 2×2 bead with a persistent colour seed,
  depth-based ambient occlusion and mica glints, written straight into an
  `ImageData` buffer. The glass, caps and lighting are pre-rendered canvas
  layers composited by the browser.

Grain counts: about 17,400 on phones and 25,300 on larger screens, up to
23,000 / 33,400 after adding sand.

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
a soft clipper. Three characters are available: *Close-Miked ASMR*, *Warm Glass*
and *Pure Sand Whisper*.

Levels and spectra were set by offline rendering and measurement (about
−25 dBFS RMS with grain peaks near −9 dBFS at the default volume). They have
not been tuned by ear on real devices, so treat the mix constants at the top of
`audio.js` (`CHARACTERS`, `MODES`) as a starting point.

### `app.js`, `index.html`, `styles.css`

Timer state, controls, Zen HUD, settings (stored in `localStorage`), tilt
permission, screen wake lock, and service-worker registration.

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
- Tilt needs motion permission on iOS 13+; the toggle asks for it.
- Haptics use `navigator.vibrate`, which iOS does not provide.
- The completion sound can only play in a hidden tab if the browser keeps the
  page's audio running; on a locked phone it generally will not.

## License

GPL-3.0. See `LICENSE`.
