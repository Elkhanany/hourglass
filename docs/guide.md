# Using Hourglass

How to use Hourglass, in full. The [README](../README.md) has the short
version: what it is, how to install it, and the controls.

## Zen

Zen is yours to enter and to leave. Spread two fingers anywhere on the
screen, or tap the moon icon, and the controls fade over about a second and a
half to 12 % (or disappear entirely with *Full Zen*) as the glass grows to
fill the screen; while they are dimmed the tenths rest. Pinch two fingers
together and they come back at once (`Esc` on a keyboard; a trackpad's pinch
works both ways too). Nothing else changes the view. A tap on the glass
starts or pauses it in Zen as it does at home; playing with the glass
(moving, turning, spinning, catching, mending, knocking) leaves the view as
it is; the controls do not fade by themselves however long the sand runs;
and the end of a glass leaves Zen as it is. The fingers must travel a little
(a fifth of the gap between them, and 36 px at least), a glass that is
already being carried or turned is not let go for a second finger, and
turning back within the same pinch undoes it. The first three times, the
moon icon says how to come back. Where the browser allows it, Zen also goes
full screen. With *Reduce Motion* turned on in the system settings, all of this
happens at once instead. With *Reduce Motion* a glass that is let go glides
home instead of falling, nothing flashes and the phone's shaking cannot crack
the glass; what a finger does to it (a slam on the desk, knocks, hard spins)
still counts.

When the sand runs out while the controls are dimmed, the glass stays still
through the last grains and the bowl, then the controls return slowly. A
touch brings them back at once. The app itself opens by fading up from dark,
with the glass already in its place.

## The amount of sand

The amount of sand shows the time. An hour is the full glass, and a shorter
glass holds less by the square root of its time: four times the time is twice
the sand. A minute is a tenth of a bulb, five a good fifth, ten a third,
fifteen two fifths, thirty over half. (Strictly in proportion, a minute would
be a pinch and every glass would run with the thin thread of the hour glass.)

## Tune

**Tune** holds the rest:

- **Material**: Sahara Quartz, Volcanic Black, Moonstone, Lapis Lazuli (gold
  flecks, gold caps), Rose Quartz (copper), Sea Glass (driftwood); **Frame** hides the
  caps and posts so only the glass remains; **Layered sand** gives the sand a
  second tone. A new glass is filled in a pattern drawn for it alone (bands
  fine or bold, level or leaning, arched, waved or folded), what falls
  settles into strata on the heap, and sand added with **Sand** arrives in
  layers of the other tone. It is off by default, and with it off the sand is
  exactly as it was. Turning the glass over tumbles the sand, and within
  about four seconds it settles into a new pattern, drawn afresh for each
  bulb at every turn. **Grain** is Classic, Fine (×2) or Finest (×4): how
  many grains the same glass holds. Another grain is another lattice, so
  choosing one builds the glass afresh behind a short fade; the running time
  is kept, a crack is not. Finer sand is more work for the phone: if the
  glass ever stutters on Finest, Fine has half as many grains for about a
  third of the work. **Real sand** (off by default) runs the sand on the
  phone's graphics chip instead (see "Real sand" below; "[Real sand: the
  switch in Tune](engines.md#real-sand-the-switch-in-tune)" says how it
  works); turning it on or off builds the glass
  afresh, keeping the running time, and its note says how it is doing.
- **Acoustic character** (six voicings) and volume; **Ambience** (None,
  Brook, Rain, Ocean, Waterfall or Drips behind the sand, with its own level;
  the one you tap plays long enough to be heard); **Completion bowl**.
- **Keep screen awake** while the sand is flowing, and for 12 s after it runs
  out (Screen Wake Lock API).
- **Real motion**: the sand feels what the phone feels. Lean it and the piles
  slump, lay it on its side and the flow (and the clock) stop, turn it over
  and the other bulb becomes the top. Walk and the falling thread sways;
  shake it and the sand lifts and lands; twist it and the sand sloshes; spin
  it flat on a table and the sand is pushed to both ends. Shaken hard for
  about three seconds, in any direction, the glass creaks and then cracks.
  An iPhone forgets its permission for this whenever the app is closed, so
  after a fresh launch a small tilt icon waits in the top bar: tap it and
  allow, or leave it and the glass stands still that time.
- **Breathing pace**: while the sand is running, the warm light behind the
  glass swells and brightens through the in-breath, holds, and fades through
  the out-breath, slowly and without a sound. Choose *Calm* (in 4 s, out 6 s:
  six breaths a minute), *Box* (in 4, hold 4, out 4, hold 4) or *Deep* (in 4,
  hold 7, out 8). A breath begins with the in-breath when the glass starts,
  and the glow eases back to rest when the glass is paused, finished or
  reset. It works in Zen and Full Zen; with *Reduce Motion* the glow only
  brightens and dims.
- **Full Zen**, **Haptics**.

The glass also remembers where it was: close or reload the page and a running
timer carries on from the wall clock, a paused one comes back as it was left,
cracks and gold seams included.

## Work and rest

The Custom duration sheet has two more rows under the dial. **Then rest** adds
a rest of 1 to 60 minutes after the dial's time (Off by default; hold + or −
to run through the numbers). Once a rest is set, **Rounds** says how often the
pair is repeated, 1 to 12. The Set button and the Custom pill say what is set:
`Set 25:00, rest 5, ×4` and `25·5 ×4`.

A sequence is rounds × (work, then rest). The readout counts down the phase
that is running, and the line under it names it: *Work · 2 of 4*, *Rest · 2 of
4* (just *Work* and *Rest* for a single round). When a phase that is not the
last runs out, a soft bowl sounds as its last grain lands (the completion
bowl, lighter and shorter, and only with *Completion bowl* on), the glass
turns itself over with the Flip button's unhurried half turn, and the next
phase starts as the turn ends. It is the same sand, timed to the new length:
through a 5 minute rest it runs five times as fast as through the 25 minutes
before it. The last phase ends as any glass does. The turn leaves the view
as it is, in Zen or out of it. With *Reduce Motion* the glass does
not turn: the sand fades away below and returns above, in the same time.

Pause and resume work inside a phase; paused between two phases, the turn
waits. **Flip**, or a turn by hand, swaps the time within the phase as on any
glass and skips nothing; **Sand** adds time to the phase. **Reset** goes back
to the start of the sequence, not started. Flipping a finished sequence starts
it again from its first glass. A preset, or a custom time with rest Off, ends
the sequence.

The wall clock stays the master here too. If the page was hidden or the phone
asleep through one or more phase ends, no turn is replayed: on return the
glass is in the right phase with the right time left and its sand in place,
and at most one soft bowl sounds, only if the last phase end was a few seconds
ago. A reload restores a running or paused sequence the same way. On an iPhone
a locked screen stops the page, so the bowl between phases is heard only while
the app is on screen (*Keep screen awake* is on by default while the sand is
flowing).

## Playing with the glass

The glass is an object you can hold. Take it by its waist and it goes where
the finger goes, lifting off its shadow, as far as it still fits on the
screen. It stands on a desk: it cannot be pushed below its resting place or
past the edges of the screen, and pushed against one it stops there. Let go
in the air and it falls, at the sand's own slow-motion gravity, lands with a
small bounce (two at most) and is centred again; let go while moving and it
flies on, and can strike an edge. While it falls its sand falls with it, and
the stream breaks; when it lands the sand jumps and lands too.

Take it by a bulb and it turns; flick it and it spins on by itself, slowing
as its sand is flung outward, and settles upright or inverted. Each half turn
swaps the time, as the Flip button does. Touch it while it moves and it stops
under your finger, and stays where it stopped until the finger moves it on;
but a finger that lands on a bulb of a spinning glass and moves on with the
spin within 80 ms carries it along, so flick on flick builds speed. The sand
feels all of this at the true scale of the glass on the screen, so a gentle
drag barely stirs it and a hard spin pins it to both ends. Its own motion it
keeps: carry the glass off quickly and the sand is left behind for a moment,
the falling thread with it; stop it dead, or let it strike an edge, and the
sand surges on, piles against the glass and runs back to its slope.

## Breaking it

Everything that strikes the glass strikes it at some speed, and the speed
decides what happens (on an iPhone; px are CSS pixels on screen):

| What you do | What happens |
| --- | --- |
| Set it down, or let it go from under about 60 px | The sand jolts, without a sound. Never a mark. |
| Let it go from about 65 to 110 px (it lands at 700 to 920 px/s) | It creaks, keeps about a third of a crack's worth of damage and shows a stress mark. About five such drops in a row crack it. |
| Let it go from the top of the screen, or bang it on the desk or an edge at 920 px/s or more | It cracks at once: 16 to 24 cells long, longer the harder the blow. |
| Bang it down at 1,800 px/s or more, or strike a cracked place again | It breaks through, and sand leaks out and gathers on the desk. Each further blow widens the breach. |
| Eight quick knocks (taps under 0.4 s apart) near one place | Creaks from the fifth, a crack on the eighth, in one and a half to two and a half seconds. |
| Three or four hard flicks in a row | A crack on a dome. Casual flicks do nothing. |
| Stir it round at two turns a second | Creaks after about a second, a crack in about three. |
| Shake the phone hard (3 g, 3 to 5 times a second) with Real motion on | Creaks at about 2 s, a crack at about 3 s, a chip soon after, whichever way it is shaken. |

It is hard to break by accident. Single, double and triple taps, taps up to
two a second, gentle dragging, casual flicks, the Flip button, walking,
running, setting the phone down, tapping it on a palm and a firm shake leave
no damage at all.

Damage is seen, heard and felt before the glass cracks. A pale stress mark
shows where the glass is loaded, from a fifth of the way to a crack; it
grows from about 5 to 20 px and fades as the glass heals (in a few seconds
to a quarter of a minute). The glass creaks, louder and higher each time, at
35, 60, 80 and 92 % of the way; on an iPhone each creak made by a finger
also ticks in the hand. The first time a finger makes it creak, a quiet note
says that the glass can crack. A new crack flashes for a little over half a
second and is 16 cells long or more, on the face of the glass, and for the
first three cracks a note says how to mend it.

Hold a finger still on a cracked glass and gold flows into the crack and
seals it (kintsugi), without stopping the timer; a mended place takes no
more, but the glass can crack again beside it, three times in all. Reset, or
a new duration, gives a fresh glass.

A burst of knocks leaves the timer alone: the first tap of a burst starts or
pauses the glass like any tap, and the second takes that back. Knocks also
reach a glass whose controls are dimmed (the first one brings the controls
back, as any tap does).

## Real sand

**Real sand**, in **Tune** under Material, after Grain, runs the sand on the
phone's graphics chip: the sand of the sand lab, every grain a point of a
simulated continuum, in the same glass. It is off unless you turn it on, and
the sand you know stays the default and the fallback. Turning it on or off
loads the page again, as another grain does, and the running time is kept.

What stays as it was: the clock (the last grain leaves the neck at
`00:00.0`; in the sand lab on an iPhone it left within 5 ms of it in every
run), the glass and its frame, the six sands and layered sand, Flip,
turning and spinning the glass, **Sand**, **Reset** with its one-second
transition, work and rest, Real motion with the phone lying still or in the
hand, the glass carrying on across reloads, the sound of the stream, the
landings, the tail and the fill, the bowl, and every haptic but the landing
buzz.

What it needs: WebGPU, which Safari has from iOS 26, also in a web app on
the home screen. Without it the switch is greyed and says *Needs WebGPU (iOS
26 or later)*; where the only graphics adapter is a software one, it says
the device's graphics are too slow.

Starting. The current sand shows and runs while the graphics chip gets
ready, and the two cross-fade once the new sand has drawn its first
picture: on the owner's iPhone that took 0.6 s in Chrome and 3.4 s in a
home-screen web app opened cold. A slow start is never counted as a
failure.

Battery and heat. Nothing runs on the graphics chip while nothing moves (a
glass paused or finished and at rest, or the page hidden). While the glass
is turned, handled or shaken, as a glass starts and in its last seconds,
and for 2 s after any of these, it runs at the full rate: 480 steps of the
sand a second, more (up to 1,440) while a bed of sand moves fast, drawn
every frame. A glass running calmly, the phone lying still or held still in
the hand, is drawn 30 times a second at the same 480 steps. A glass that
the chip has kept below 0.6 of real time for 20 s drops to that calm rate
(the heat guard). Calm saves little on a long glass, since its steps are
most of the work: the 60-minute glass kept the iPhone's graphics chip 85 %
busy in the sand lab, and 79 % calm. So when the phone is hot the sand may
simply run slower than real time for a while; the clock stays exact, and
the report (below) logs each time the guard trips. There is no economy
mode: it uses more battery than the current sand, most on long glasses.

Keep the screen awake. While the phone is locked or another app is in front,
the new sand stands still and the clock does not; back on screen, the sand
the clock says has run meanwhile is moved below at once. **Keep screen
awake** (on by default) holds the screen on while the sand flows, with Real
sand as without it. (The sand lab has neither, and its 4-minute glass ended
7 minutes late when the phone locked itself.)

What it leaves out for now:

- The glass does not crack. A hard landing or a blow thumps and clacks;
  knocks, flicks and shaking do nothing to it. Cracks the glass already had
  stay, leak nothing and can be mended; Reset makes it whole.
- The bed's landing thumps, the avalanche hiss and the bed's slams are
  silent, and so is the landing buzz (Android).
- The current sand's glow, rim light and depth shading are not drawn; the
  grains are lit as in the sand lab.
- **Grain** sets the current sand only; the new sand keeps its own grain.
- The sand lab's known faults: a turned bed slides round the glass as a
  block before it breaks up, a bed at rest creeps, heaps stand steep.

The note under the switch says how it is doing:

| Note | What it means |
| --- | --- |
| *Starting…* | the graphics chip is getting ready (the current sand meanwhile) |
| *On* | the new sand runs |
| *Needs WebGPU (iOS 26 or later)* | not on this device: the switch is greyed and off |
| *Could not start this time: (why). It will try again next launch* | the current sand until then |
| *Did not start 3 times: (why). Turn it off and on to try again* | it stops trying |
| *Real sand is updating; it will be back at the next launch* | old and new files of an update met; the next launch has the new ones |
| *Real sand paused: the graphics chip was reset* | the current sand took over at once, at the same time and with the same sand above; the new sand comes back by itself |
| *Paused after the graphics chip was reset twice; it will try again next launch* | the current sand until the app is opened again |
| *Real sand could not restart after the graphics chip was reset; it will try again next launch* | the same, when the chip could not be opened again |

Around a lock or a switch to another app, a reset graphics chip is
rebuilt without a word.

To report how it does: with the switch on, Tune has **Copy a report** under
it. Tap it and paste the report into your message, with what you did (which
glass, the phone still or in the hand, Real motion on or off) and what you
saw. It holds how long the start took, the stream's first fall from the neck
to the floor, the power mode and rate, each heat guard trip and the engine's
log, from the app as you use it, home-screen web app included. Its `ends`
part says, for each glass that ended, when the last grain crossed the neck
against 00:00.0 (in ms, from the graphics chip's own record), and counts any
run that let sand through ahead of the clock, any crossing while the neck
was shut and any failed check of the count (all three should be 0). To watch the
figures live, open the app in Safari with `?debug=sand` after its address
(`https://elkhanany.github.io/hourglass/?debug=sand`): small white figures
at the bottom left show the power mode, the rate, how fast the sand runs
against real time, the sand above the neck, the first fall and the start,
with the same report under **copy the report**. (A web app on the home
screen keeps its own storage and always opens at its own address, so
`?debug=sand` cannot reach it; those figures are Safari's.) For the battery:
run the same 30-minute glass with Real sand on and then off, at a fixed
brightness (Auto-Brightness off), not charging, and note the battery before
and after each.

## Browser notes

- iOS Safari only starts audio from a user gesture. The app creates and resumes
  the audio context on the first touch, and resumes it again after an
  interruption (call, lock screen, tab switch).
- Real motion needs motion permission on iOS 13+; the switch asks for it, once
  for both sensors. An iPhone keeps that permission only until the app is
  closed, and a web app cannot change that, so with Real motion left on it
  has to be given again at each launch. The app does not spring the question
  on the first tap that comes along: a small tilt icon waits in the top bar
  (the first three times a note points to it) and asks when it is tapped.
  Left alone, the glass simply stands still that time and Real motion stays
  on for the next. Where the site is still allowed (the same session, a
  reload) the readings arrive unasked and the icon never shows.
- Keep screen awake needs the Screen Wake Lock API: Safari 16.4+ on iOS, and
  iOS 18.4+ when installed to the home screen.
- A web app cannot hide the iPhone status bar or silence notifications. On
  Android the installed app runs full screen; in desktop and Android browsers
  the moon icon enters full screen.
- Haptics use `navigator.vibrate` on Android. An iPhone has no vibration
  API. Since iOS 18 a switch control taps the Taptic Engine when it flips,
  and since iOS 26.5 only when a finger really lands on it or on its label.
  So on an iPhone every control, and the glass itself, carries a transparent
  label over a hidden switch, and a tap that the app wants felt lets that
  switch flip: one light tick a tap, on buttons, pills, cards, switches, and
  a tap or a knock on the glass. What happens without a tap cannot tick on
  an iPhone: the end of a glass, a landing, a crack from shaking, a catch or
  a half turn while the finger drags (on iOS 18 to 26.4 those still tick as
  the finger lifts). *System Haptics* must be on in the iPhone's Sounds &
  Haptics settings. This is tested in a browser shaped like an iPhone
  (`app-haptics`), which has no Taptic Engine: whether the phone ticks can
  only be felt on a phone.
- The completion sound can only play in a hidden tab if the browser keeps the
  page's audio running; on a locked phone it generally will not.
