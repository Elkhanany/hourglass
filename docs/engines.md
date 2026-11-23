# How it works

How the sand, the glass, its motion and its sound are made: the classic sand
of `physics.js`, which every glass runs on, and Real sand, the sand simulated
on the graphics chip (`realsand/`). The last two sections say what a sand
engine must provide, and how to add a sand, a glass shape, a sound or a
setting. How the files fit together is in [Architecture](architecture.md),
the tests are in [Tests](testing.md), and Real sand's design, section by
section, is in [Real sand: the design](design/real-sand.md).

## `physics.js` — simulation and renderer

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
- **Off the upright.** That rule judges slopes against the lattice, which is
  right for a glass standing straight. Leaned, turned, carried or shaken, the
  sand follows a second set of rules that judge them against gravity itself
  (see [*Sand off the upright*](#sand-off-the-upright)). A glass that stands straight and is left alone
  never reaches them.
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

## Layered sand

- **One bit per grain.** A grain's tone is the top bit of its colour seed,
  the byte that already travels with every grain: through the automaton, the
  falling stream, a bed in flight, spray and hops, a flip, a breach and the
  dune on the desk. No path had to learn about tones and none can lose one.
  The simulation never reads the bit, so with layers on the lattice, the
  grains in the air, the sleep map and the sand's random stream evolve
  exactly as they do without (`sim-tone` runs the two side by side;
  `sim-identity` ties the plain one to f446085). `sim.tones()` counts the
  grains of each tone.
- **Patterns.** A new glass, and a restored one, is filled in a pattern drawn
  for it alone (`_pattern`): one pair of strata 9 to 35 cells thick, more
  often fine than bold; level, or leaning by up to about 32°; in half the
  glasses arched or sagging across the bulb; gently waved, or in three
  glasses out of ten folded; its thickness wandering along the way, its seams
  slightly ragged. All of it comes from a random stream of the layers' own,
  seeded by a read of the sand's stream that does not advance it, so the same
  seed lays the same pattern and no two seeds the same one. The companion
  tone is never more than half the sand, so the glass stays the material it
  is. Turning the switch on part-way lays the sand in its pattern where it
  lies, behind the usual cross-fade; turning it off forgets the tones.
- **Strata.** The crater of the upper bulb cuts across the pattern, so what
  falls is a mixture. A real mixture of two sands poured on a heap sorts
  itself into strata (Makse, Havlin, King and Stanley, *Nature* 386, 1997).
  Here that is a simple sifting rule rather than a simulation of grain sizes.
  In each layer freshly laid on the lower heap, grains of one tone work their
  way down under the other by trading places with the grain below or
  diagonally below, and the two tones take turns from layer to layer. Each
  layer freezes as two strata that follow the slope. How deep a layer is, is
  drawn for each glass and again at each turn: fine (3 to 7 grains), even
  (4 to 12), bold (7 to 19), or mostly fine with a deep one now and then
  (3 to 21). Sifting only trades colour seeds between neighbours, visits
  every eighth column per step, and costs about 1 µs a step, roughly 1 % of a
  flowing step. It rests while the glass is turned or shaken. After a
  fast-forward, the sand that was moved in bulk is sifted in one go.
- **A turn.** Tumbled sand would be an even blend of the two tones. Instead,
  when the glass has been turned over each bulb draws a new pattern for the
  share of each tone it holds, and for the next four seconds sand that comes
  to rest in the wrong tone for its place trades colour seeds with a grain of
  the right tone that is still moving (`_develop`, up to 36 grains a step in
  each bulb, every fourth column per step). Only seeds are traded, so each
  tone keeps its count and the lattice, the sleep map and the sand's random
  stream are untouched. Afterwards 8 % to 29 % of the grains lie on a grain
  of the other tone; in the blend it was about 40 %. It costs up to 0.1 ms a
  step for those four seconds and nothing after.
- **Pouring.** Added sand arrives in layers of 420 to 840 grains, each in the
  other tone from the one beneath: one layer for about a second of holding
  **Sand**, or a few taps.
- **Rendering.** The colour table keeps its size. With layers on, seeds 0–127
  are the sand's own kinds of grain (base, dark, alt, mica) and 128–255 the
  companion's (`THEMES[id].sand2`). Per-grain variation, light, depth, the
  streaks of falling grains, the glow and the spilled dune apply to both
  tones, and drawing costs nothing extra. With layers off the table is the
  one it always was.

## Motion

- **The felt field, at true size.** The sand feels gravity plus whatever the
  glass is doing: the phone's own acceleration and the glass being dragged
  on screen, turned into the glass's frame, and, while it turns, the
  centrifugal, Euler and Coriolis forces. Every effect enters at the strength
  it would have on a real glass of the size this one appears on screen (1 CSS
  px is about 0.16 mm on an iPhone), so the thresholds are real ones: the bed
  lifts off at 1 g, and sand pins to the far ends once ω²r passes g. Each bulb
  feels the field at the centre of its own sand; a grain in the air feels it
  where it is.
- **At rest, nothing changed.** While nothing moves the glass and its sand is
  cool and settled, each physics step is exactly the step the hourglass always
  took, grain for grain (checked against the version before motion over
  20,000 steps).
- **The bed flies as one body.** Shaken harder than gravity, a packed bed does
  not dissolve into loose grains: it lifts off its seat as one body, flies,
  and lands with a thump (a completely inelastic bouncing bed, after Mehta and
  Luck). A column that meets the far glass stops there with a clack, so the
  bed deforms against the dome but never shreds. Flight heights match a
  one-dimensional bouncing-bed model within about 1 %. Landings raise a little
  spray that patters on the glass.
- **Shaken sand runs.** Each bulb has a granular temperature, driven by how
  much its field changes (a steady lean does not count) and by every landing.
  Hot sand loses its friction and flows faster, so a shaken heap flattens
  toward its dynamic slope and freezes flat when the shaking stops. The
  hottest surfaces throw off a few hopping grains.
- **The neck under shaking.** The neck only lets sand through while the upper
  bed sits on it and the field presses sand into it, so the stream stutters
  with each blow of the hand, and a sideways shake bends the thread. Grains in
  flight bounce off the closed neck like glass. The valve stays the only way
  between the bulbs, so both bulbs' counts stay exact.

## Sand off the upright

When the glass leans more than 0.7°, turns, is carried or shaken, and for 3.5
s after, its sand is stepped by a second automaton (`sim.granular`, on unless
the Sim is built with `granular: false`, which is the engine as it was). A
glass that stands straight and has not been touched never reaches it and stays
bit-identical with f446085.

- **Repose against gravity.** A grain falls along the two lattice directions
  the field lies between, in the odds that give the field's own direction. It
  steps sideways only when the slope beyond the step, probed along a true line
  below the field's horizontal, is steeper than sand can hold: 35° for a grain
  at rest, 32° for one already moving, three degrees apart as in dry sand.
  Rows sleep at any lean. Held at 10°, 20°, 30° and 45° the free surface
  settles at 28° to 35° to gravity and the sand is at rest within 1 to 4 s;
  before, it crept flat and never rested. (Held at 5° the upper bed keeps 40°:
  see *Leaving the upright*.)
- **It flows, it does not wait and go.** The automaton moves one layer of
  grains, so the slopes are also read as heights across the field (the thick
  avalanche), and where one falls more steeply than 36° over eight cells its
  top grains are moved down it, on down to 33°. A slope only a little too
  steep creeps: a grain goes two cells down, six more for every cell the
  slope is over, and is left moving, to be carried on at the next call; so
  the sand is seen to flow, a layer at a time, and follows a slow tilt as it
  comes. A cliff (a face eight cells or more too high) still fails in depth,
  its grains carried to where the slope eases. Tilted steadily at 5° a second
  the beds now move in 97 % of the tenths of a second, and the busiest fifth
  of the time carries 30 % of the shift; as first shipped (held to 37°, ran
  to 29°, avalanche from 40° to 36° with every grain taken to the foot at
  once) they stood still 14 % of the time and then went. After the Flip the
  sand is under 40° within about a second and at rest in under 4 s (it stood
  at 68° for more than 20 s).
- **Leaving the upright.** What the glass builds while it stands straight is
  steeper than that: the old automaton drains its upper bed to 40° and pours
  its heap to 34°. Handed over to these rules as they were, a tenth of the
  upper bed let go within half a second, at the first 3° of lean or as the
  phone was picked up: the sand went in bulk at a certain angle. So each bed
  holds that much more to begin with (13° in the upper bulb, 5° in the lower,
  on both angles) and gives it up evenly as the field leans from the glass's
  axis, all of it by 15°. It does not get it back by leaning less, only when
  the glass has stood straight again under its own rules; after a Flip, or
  once leaned past 15°, the sand has its plain angles. The app also brings
  the phone's lean in from nothing (none under 1.7°, caught up with the phone
  by 5°) where it used to begin with a step of 2.6°. A running glass tilted
  from straight at 5° a second: its busiest quarter second moves 1.3 % of the
  upper bed (it was 3.9 %, which was 29 % of all that bed did in the tilt);
  picked up with a hand's tremor of 0.1 g, 1.4 % (it was 4.6 %).
- **Falling sand gathers speed.** Each grain carries a count of the sweeps it
  has kept moving, as it carries its colour; a fall covers more cells the
  longer it lasts. Sand let go (the phone turned over) accelerates and
  stretches instead of sinking as a block.
- **Inertia.** Each bed has a sideways speed over the glass. It starts when
  the level push beats static friction (0.65 of the load), is moved across the
  glass, piles against the wall, and friction (0.5) takes its speed away;
  while it slides its slopes are judged in a field that leans the way it is
  going. The push includes the glass's own motion on the screen, in cells
  (`sim.setCarry`): the sand lives in slow motion and the hand does not, so
  this is what makes a carried glass that stops leave a slosh. A carry at 150
  px/s starts nothing. With Reduce Motion there is none. The field the
  fracture law reads is untouched.
- **Shaken sand levels.** Above a granular temperature of 0.5 the slopes sand
  can hold fall with the temperature, so four seconds of hard shaking level a
  heap (34° to 13°). Walking, a sway or a finger's wiggle stay below it.
- **In the air.** A grain in the air belongs to the room: it feels the whole
  of the glass's on-screen acceleration, so the thread is left behind when the
  glass is carried off. Exactly nothing while the glass keeps its place.
- **The timer comes first.** Leaned far over, sand rightly lies at rest on the
  low side of the funnel. A neck that has run short is therefore fed by sweeps
  of the old automaton, as it always was, so the sand still arrives: leaned
  30°, 11 of 10,116 grains are still above the neck at 00:00 (1,039 without
  that feed).
- **Where it stands back.** Spun faster than 6 rad/s, or below full quality
  (the governor's lighter levels), a moved glass is stepped as before; a slide
  in progress ends there.
- **Sound.** Nothing was added to `audio.js`: the rush of sliding sand follows
  the slide counts, so an avalanche after a lean or a carry is now heard
  softly, and the rush after the Flip ends sooner (2.7 s instead of 4.1 s).
- **Cost** (Node, phone-size glass with the most sand, ms per frame, mean /
  p95, before → after): a held lean of 30° 0.67 / 0.70 → 0.34 / 1.84 and then
  nothing once at rest; the Flip and 3 s after 0.78 / 1.84 → 0.67 / 2.20; all
  the sand let go at once 0.14 / 0.40 → 0.40 / 2.85 for a third of a second; a
  spin at 5 rad/s 1.24 / 2.50 → 1.48 / 3.77; an upright running glass
  unchanged.

## Finer sand

A glass built at p times the scale holds p² times the grains, each 1/p the
size (**Tune › Grain**: Fine is p = √2, Finest p = 2). Left to itself it
would also run in slow motion: a grain moves a cell a sweep, and there are p
times the cells to cross. `Sim.setPace(p)` makes the finer sand behave on
screen as the sand it replaces:

- **Gravity** is p times as many cells a second², so a grain falls from the
  neck to the heap in the same time.
- **The automaton's pattern of sweeps is repeated p times a step** (a
  fractional p by an accumulator), in the upright glass and off the upright
  alike. A kinetic sweep's fall, which is g·t, counts 1/p as much a sweep.
- **The thick avalanche runs p² times as often.** It lowers a face a grain
  at a time, and the automaton's own flow is one grain deep, so on finer
  sand the same slump is p² times the moves. A creeping slope's step is
  shorter in turn, so the flow keeps its speed on screen.
- **What is measured in cells or in grains is scaled**: speeds (spray, hops,
  the thread, the fastest a grain may fly), crack lengths and the width of a
  breach, layer depths and the bands of layered sand, pours, leaks and caps.
  The reference stress of a landing goes as √p, since it is a speed over
  √(G·cell).
- **Time is untouched.** Seconds, rates and every threshold in g stay as
  they are, so the glass cracks, creaks and mends as it did.
- **What belongs to a grain stays a grain's**: the slope probes, the width a
  breach jams at, the raggedness of a seam. A finer thread is denser, a
  finer splash smaller.

The app scales what it counts in grains by the same p²: the pour, the last
grains of the tail, and what the ear and the desk are given (the sound
engine and the spilled dune receive the classic glass's share, so both are
as they were). With pace 1 nothing changes at all: the tables are restored
exactly and the upright glass stays bit-identical with f446085.

Measured against the classic sand (`sim-grain`, a one-minute glass):

| | Classic | Fine | Finest |
|---|---|---|---|
| Grains | 10,116 | 20,290 | 40,536 |
| Share of sand above the neck at 15, 30, 45 s | | within 0.0012 | within 0.0018 |
| Grains left above the neck at 00:00 | 0 | 0 | 0 |
| Sand in the air (the thread) | 0.78 % | 0.80 % | 0.82 % |
| After the Flip: bulk settled / all at rest | 1.7 / 3.6 s | 1.8 / 3.3 s | 2.0 / 3.5 s |
| Leaned 30°: bulk settled / all at rest | 0.9 / 3.9 s | 1.0 / 4.2 s | 1.2 / 5.1 s |
| First crack under the hard, slow shake | 1.52 s | 1.54 s | 1.52 s |

What it costs (Node, this machine, a five-minute glass half run, ms a frame):

| | Classic | Fine | Finest |
|---|---|---|---|
| Running, calm (mean) | 0.21 | 0.56 | 1.52 |
| The Flip and 5 s after (p95) | 1.4 | 4.0 | 10.6 |
| The hardest shake (p95) | 2.1 | 5.1 | 13.1 |
| In the page: physics and drawing, running (mean) | 1.1 | 2.2 | 4.0 |

Fine is about two and a half times the work, Finest about eight times while
the sand is moved (a quarter of a 60 Hz frame while it merely runs). The
governor lightens the physics on a phone that cannot keep up, as it always
did. A session saved in one grain is restored in another by its time; a
crack is kept cell by cell, so there the glass comes back whole.

## Glass and fracture

- **Every glass has its own flaws.** The glass keeps its own record of damage,
  separate from the sand. Its inner wall is divided into 160 short stretches
  (two bulbs, two sides, forty bands from the waist to the far end), and each
  new glass draws its own flaw strengths: a Weibull spread (modulus 20) that
  makes most of it about equally strong and a few places weaker. The flaws
  come from a seed of their own, so a cracked glass comes back as the same
  glass after a reload, and drawing them never disturbs the sand.
- **Stress corrosion with a fatigue limit.** Each column of sand that slams
  into the glass sends a pulse whose stress grows with its impact speed.
  Below a fatigue limit, about 78 % of the glass's strength, a crack does not
  grow at all, which is why a firm shake never cracks it however long it
  lasts. Above it, damage grows as the 16th power of the stress, as stress
  corrosion does in soda-lime glass. A hard sideways shake (from 2.6 g) also
  bends the waist like a beam. So a crack starts where the load and the
  weakness meet: the lower dome under vertical shaking, the funnel shoulder
  under slams, the waist under lateral shaking.
- **Four ways to load it directly.** What a hand does on purpose is written
  to the glass at once, without the sand in between. A blow of the glass
  itself (`Sim.prototype.impact`: the desk, an edge of the screen) lands on
  the weakest stretch within three bands of the place that hit, the lower
  dome for a landing, the flank for a wall, and is graded by its speed. A
  knock (`knock`) covers the stretches within three bands of the fingertip,
  on both sides of the glass when it lands near the axis, so knocks that
  scatter by a few pixels still add up; it obeys the fatigue limit, so the
  first three knocks of a burst add next to nothing and each one after adds
  0.23. A flick (`flick`) leaves one dose at let-go, by the most its spin
  pressed the sand on the domes (and no more than one and a half times what
  it still presses as the finger lifts): nothing under 0.22 g, 0.4 from
  0.40 g. And a hard shake of the phone in any direction (`shake`) loads the
  weakest stretch beside the sand by 0.085 for each swing from the eighth
  on, unless the sand's own landings are already doing the work.
- **Warnings first.** A crack can only run so fast, so the sand's blows
  build damage at a bounded rate (0.9 of a crack a second, and a single blow
  at most 45 %); damage also fades while no crack has formed, with a time
  constant of 8 s. Four creaks come at 35, 60, 80 and 92 % of the way, and
  the stress mark shows from 20 %. Only the hand's own blow, hard enough,
  cracks it without a warning.
- **What cracks it.** Measured with sensor streams of a hand-held phone and
  touch replays on an emulated iPhone: a vigorous shake (3 g at 3 to 5 Hz)
  cracks it in 2.5 to 3.7 s and chips it within 4.3 s whichever way the
  phone is shaken; walking, running, set-downs to 12 g, palm taps to 8 g, a
  soft drop and a firm shake (1.5 g at 3 Hz) leave the damage at exactly 0.
  Only real phone motion can arm the sand's blows and the shake counter
  (see [Sensors](#sensors-motionjs)), and with Reduce Motion they are never armed.
- **Crack, chip, leak.** A crack is born 16 cells long and grows as damage
  goes on, faster the longer it gets. Past 26 cells it breaks through and a
  chip opens, and the chip can widen to three cells. A glass holds at most
  three cracks, never within a few rows of the neck, so the two bulbs are
  never joined. The holes stay glass in the lattice (a separate hole map
  carries the leak), so counting, drawing and resetting never see them. The
  leak is 2-D Beverloo flow with jamming, like a small hole in a bin of sand:
  one grain wide it arches over and holds at rest, two wide it trickles about
  one to three grains a second, three wide up to about ten, and shaking
  breaks the arches. A hole facing down leaks freely, one facing up hardly at
  all, and a grain in flight that meets a hole leaves with its own speed.
  Turning the glass over carries every crack and hole with it, so a leak
  keeps coming from the same place.
- **Kintsugi.** Mending closes every open breach at once (the leak stops
  within a step) and draws the cracks in gold; the mended seam is half as
  strong again. Reset, or a new duration, gives a new glass. The damage is
  saved with the running session in a few hundred bytes.

## Cracks and spilled sand on screen

- **A hairline that catches the light.** A crack is drawn on the glass's front
  layer, after the glass and before the caps: it turns with the glass and
  survives a change of material, frame or layout. Seen edge-on at the
  silhouette the first twenty or thirty cells of a crack hid in the glass's
  bright rim, so away from the waist a crack now starts on the face of the
  glass, a third to a half of the way round from the middle toward the side
  its hole is on, and clear of the collar. It grows along the curved surface
  and is then projected into the picture: one round the shoulder by the waist
  reads as an arc from the edge, one on the dome spreads as a star of three
  to five arms all round, and one in between runs toward the widest part and
  wanders. Each arm draws from its own random seed, so a growing crack only
  ever lengthens and never rearranges itself, and after a flip the same
  crack is simply mirrored back onto the same place. It is a silver hairline
  0.7 cells wide over a soft shadow; every short stretch of it is as bright
  as it faces the room's key light, and the room stays put, so the crack
  sparkles as the glass turns. A breach is a small dark chip where the
  glass's bright edge is broken, with a bright inner rim. No shards, no red.
- **Small moments.** The stress mark, a pale bloom with three craze lines,
  sits where the crack would start and follows the damage; each creak
  brightens it for a third of a second. A new crack flashes for 0.6 s, and a
  breach brightens its rim for a moment; with Reduce Motion there are no
  flashes (the mark itself stays). While a finger mends it, gold runs out
  from where the crack began, along every arm at the same pace, and a mended
  crack stays gold, with a light core and a soft glow.
- **Cheap to draw.** The layer is redrawn only when something has changed,
  never more than 30 times a second while the glass turns, and a glass holds
  at most 512 crack segments. A whole glass costs nothing.
- **Spilled sand.** Grains that escape fall in the room, not with the glass:
  their layer sits outside the moving, turning glass, so the sand stays on the
  desk when the glass is lifted or spun, and it grows and shrinks with the Zen
  view like the shadow. They fall under the same slow-motion gravity as the
  sand inside and gather into a small dune on the desk line, made of 2 px
  columns that give way at the angle of repose (33°), measured against the
  real direction of gravity. Lean the phone and the dune creeps downhill and
  pours off the low end of the desk; turn it over and the sand falls away;
  shake it hard and a few grains hop. It is drawn grain by grain in the sand's
  own colours, lit on top and darker below; only the columns that changed are
  redrawn, and its canvas exists only after the first grain has escaped.
  Reset sweeps it away, and it is not kept across reloads.

## Timer under motion

The wall clock stays the master. Moving, shaking, catching and mending never
stop the clock; only a turn (by hand, by a spin or by the Flip button) and
laying the phone on its side do. A shaken neck falls behind, so while shaking
is recent a backlog drains as a slightly thicker thread instead of a clump,
and the page's sleep catch-up never teleports sand. In a thin stream that
thread often makes up the backlog by itself. If the sand above the neck is
still off the clock once the glass is calm again, the rest of the run is
re-timed so the sand that is there lasts exactly the time that is left: the
last grain still leaves at `00:00.0`. Sand
leaking from the upper bulb thins the stream (the neck lets through less), and
where it leaks faster than the stream can make up, as in a long glass, the
rest of the run is re-timed the same way; sand leaking from the lower bulb
never touches the time.

## Sensors: `motion.js`

With Real motion on, the app reads two sensor events: `devicemotion` (the
phone's acceleration and rotation rate, about 60 times a second on an iPhone)
and `deviceorientation` (how the phone is held). `motion.js` turns them into
what the sand would feel: the phone's acceleration with its sign turned round
(−a/g) in the plane of the page; the part out of that plane, which only stirs
the sand; how fast the phone turns in its own plane (from the heading); and
how fast it spins lying flat on a table (from the size of the rotation rate,
which needs no axis order).

Browsers disagree about these sensors: WebKit reports both acceleration
vectors negated, and a few browsers report them in g rather than m/s². So
nothing is taken on trust. While the phone is held still, the accelerometer
is compared with `deviceorientation`, which every engine reports the same
way; the units and the sign are learnt in about a third of a second, and the
sign is remembered for the next visit.

A small dead zone (0.06 g) keeps a resting hand from stirring the sand.
Readings are taken one reading behind, so each 120 Hz physics step gets its
own value. If they stop arriving everything fades to zero; they are ignored
while the page is hidden, and after the page has been away, motion fades
back in over about a second.

Nothing breaks the glass by accident. The sand's blows and the shake counter
can only load it once a hard shake keeps its acceleration, averaged over a
third of a second, above 1.6 g for 0.6 s; running peaks at 1.4 g on that
measure and a soft drop at 1.45. The shake counter makes a shake count
whichever way it goes: a swing is the phone's acceleration, on all three
axes, passing 1.8 g the opposite way within 230 ms of the last, and from the
eighth swing of a run on each one is handed to the glass as a blow. A
set-down, a palm tap, a heel strike or a drop is one-sided and never gets
past two. On iOS one permission covers motion and orientation together: both
requests go out at once, inside the tap on the switch.

## `audio.js` — procedural sound

Web Audio API only. The sand is made of nothing but tiny impacts, because
that is what sand sounds like: a fine grain lands in a fraction of a
millisecond, the stream through the neck is almost silent, and what you hear
is what the grains land on.

1. **The sand as it lands**: two beds of micro-impacts, grains on bare glass
   and grains on sand, synthesised once from a few dozen single clicks:
   band-passed bursts of 0.1 to 0.5 ms between 2.5 and 11.5 kHz, some with a
   neighbour nudged a moment later and a faint low give of the pile; on glass,
   a hard click and one or two of the bulb's own short, high modes. Each bed
   holds two populations drawn from one stream, a dense **hush** and a sparser
   **crackle** (about 600 grains a second). On sand the hush is fine and
   steady, as fine sand is: about 6,500 grains a second, airy, close to a
   smooth hiss, its rate swinging only a little. The crackle over it is the
   few louder grains, and comes and goes over tens of milliseconds and a few
   tenths of a second. On bare glass both are sparser: the first grains are
   few, and each is heard. The mix of grain sizes drifts, and every grain has
   its own loudness (log-normal: a few are bigger), pitch and place in a
   narrow cone in front, the far ear hearing it a few samples late. The sound crossfades from
   glass to sand as the cushion grows. The hush follows the flow and swells a
   little with its breathing, the crackle follows the impacts, and shaking
   lifts the crackle into a soft shaker shimmer.
2. **No loops**: each bed plays as an endless chain of 0.45 to 1.4 s segments
   from random places in it, each at a slightly different speed and level,
   crossfaded with equal power, so the texture never comes round the same way
   (its waveform self-similarity at any lag from 1 to 12 s stays at 0.01 to
   0.05; the old looped hiss read 0.6 to 0.9). While the page is hidden the chain hands over
   to a plain loop of the bed, which needs no script to go on.
3. **Grains you can tell apart**: the physics' impact events play single
   grains, a dry crackle of one to three contacts on sand, a crisp click with a
   short glassy ring on bare glass, each with its own log-normal loudness, now
   and then a rebound, and its own place in front of you (where they land
   wanders slowly). A slow glass is heard grain by grain; a fast one keeps
   fewer, softer ones and lets the hush carry the rest. As the last grains
   fall the hush and the crackle fade with them, and the final few land one by
   one before the bowl.
4. **The vessel**: a broad, low-Q body under the sand, whose lowest mode (the
   air in the bulb) rises as it fills, and the glass's own six resonators
   (680 Hz to 7.25 kHz). In the default character the sand never rings those:
   only the glass in the hand does (a tap, a creak, a crack, a clack).
5. **Foley**: a pour (the beds again, through a band that wanders on two
   random flutters, never a clock), the slide of sand as the glass turns, the
   air it cuts as it spins, a small avalanche down the pile every
   few seconds (a soft swell to one side), and a singing-bowl bloom at the end
   (optional).
6. **The glass in the hand**: shaking is heard as it happens in the physics.
   Each time a bed lifts and lands there is a soft low thump with a little
   grain in it, and the vessel answers; sand slamming the far end clacks,
   glassier; while the sand is agitated the grain textures rise into a soft
   shaker shimmer, and the sliding rush moves between the ears with the
   slosh. A finger stopping a spinning glass makes a soft felt stop. Before a
   crack the glass creaks: one to four ticks, like a cooling glass, louder and
   higher with each level (3.2 to 6.3 kHz) and as loud as the tinks and
   thumps, because they are a warning and must be heard on a phone's speaker.
   The crack itself is a bright snap that tops them, the whole vessel ringing,
   a faint knock and a few settling ticks, still 20 dB under the completion
   bowl in loudness; a blow of the glass on the desk or an edge is a thump and
   a clack, scaled by its speed; a growing crack clicks like ice settling, and
   a chip opening tinks and rattles. Afterwards the vessel's resonances ring
   3 % lower and die away sooner, as a cracked glass does; mended with gold
   they are nearly whole again. Grains escaping through a chip patter at the
   leak's rate, finer and higher, panned to the chip, and grains landing on
   the desk are very quiet and dry. While a finger holds a cracked glass
   still, the glass hums under it, and a small bell an octave above the bowl
   marks the mend. Each of these sounds plays only for something physical and
   limits its own rate.

Output passes through a generated 0.35 s room impulse response, a compressor and
a soft clipper.

Six characters re-voice the same grains. *Close-Miked ASMR*, the default, is
the sand alone, close and dry. *Warm Glass* is a thicker, softer glass that
the grains ring gently, with more room and a darker tone; *Pure Sand Whisper*
is mostly the hush. Three more change the vessel itself, by retuning the
resonator bank, letting the sand ring it, and changing the pitch of every
grain:

- *Singing Glass*: resonators tuned to a D major pentatonic with long rings, so
  every grain strikes a small bell.
- *Bamboo Rainstick*: broad, quickly damped woody resonances and lower-pitched
  grains.
- *Desert Dune*: low resonances (150 Hz upward) driven hard by the hush, for
  the hum of sliding sand. Much of it sits below what a phone speaker
  reproduces; it is meant for headphones.

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
- *Ocean*: slow surf on a sandy beach, heard from the shore. A wave is four bands of noise, each on its own envelope around the moment of breaking: the swell comes up dark, the break is low first (plunge, then roar), the wash opens as the foam spreads (its low-pass glides from 1.2 to 4.5 kHz and closes again), and the hiss comes last and stays longest. What draws back is thin and fizzing: the brook's smallest bubbles, bursting as the foam thins. Six waves a minute in front, 8 to 13 s apart, no two alike in size, tempo or place. Behind them, on a shorter loop (23.3 s against 61.3 s), a distant rumble and two duller waves that fall elsewhere among the front ones each time round. Measured against four recordings of calm surf.
- *Waterfall*: a small fall from a few metres away. A coloured rush (weight from 160 Hz to 1 kHz, then 3 dB less per octave; the ears share its lows, not its highs) that spits and splashes in short bursts of band-passed noise, over a plunge pool that gurgles with low bubbles. Three loops (12.1, 13.9 and 31.3 s) that line up again after six days.
- *Drips*: drops falling one at a time into a still pool in a small stone grotto. A drop is the bubble it drags under: a short tone that curls upward as it closes, a plop if the drop was big, a plink if small, often with a second, smaller bubble after it. The stone gives every drop back as about 800 dulled copies a second, fading over 1.6 s, so the room rings on at the drop's own pitch. Ten drops on three loops (21.7, 18.5 and 15.3 s) that meet differently every time round, over a faint trickle far off. It is quiet by nature: its loudest drops peak where the brook does, but its level over time is about 13 dB lower.

All are synthesised into seamless loops in short steps, the saved one while the page settles after loading, another the first time it is chosen. The ocean, the waterfall and the drips are made in slices of a few milliseconds (40 to 80 of them, 0.1 to 0.25 s of work spread over one to three seconds); the brook and the rain in a dozen longer ones. Only the chosen ambience holds any sound: at most 8 MB of PCM, kept small by giving each loop no higher a sample rate than its sound needs (8 to 24 kHz for the new ones). Choosing another lets the previous one go once it has faded. Where a browser makes no buffer below 22.05 kHz (WebKit before iOS 14.5), those loops are drawn out to a whole multiple of their rate, which plays as the same sound and costs about twice the memory (a little more for the ocean). Chosen in Tune, an ambience plays long enough to be heard, counted from the moment it sounds: five seconds of brook, rain or waterfall; one whole wave of the ocean (twelve seconds, from where its swell comes up); nine seconds of drips, at least three drops.

The sand was built against recordings of falling sand and grit (a continuous
pour of fine sand, fine sugar poured close to the microphone, a rainstick,
grit and stone trickles, grains on glass) and against the stream the app's
physics actually feeds it, by rendering offline through the real output chain
and measuring: the spectrum, how grainy and how fluttery it is, how its
colour flickers, how its grains are spaced and how loud they are, its stereo
image, and that nothing repeats or rings. The default character is voiced
toward the fine, steady recordings rather than the coarse trickles, because
the stream of an hourglass is fine and steady. In graininess it sits just
above them (kurtosis 5.6, against 3.4 to 3.6 for the fine pour and the
rainstick, 40 and more for the grit trickles, and 4.0 for the looped hiss it
replaces), its flutter is close to theirs, and it is brighter and airier
than the old hiss without being as bright as they are. Nothing repeats and
nothing rings: no resonance stands more than about 1 dB out of the spectrum
(the old hiss had peaks of 6 dB). The material is the same on every load (it
was calibrated); only how it is played is random. It takes about 200 ms of
synthesis on a desktop, done in slices of a few milliseconds while the page is
idle.

Levels were set the same way: the sand keeps the loudness it had, within
about 1 dB at the default volume (near −32 dBFS RMS for a 30-minute glass,
−29 for a 5-minute one and −27 for a one-minute one), so the bowl and the
ambiences keep their balance; being made of grains rather than hiss, its
peaks stand a little taller, near −8 to −9 dBFS. At their default level the brook, the ocean and the waterfall sit near -26 dBFS, the rain near -28 and the drips near -39 (their peaks like the brook's). With the sand at full volume nothing reaches the end of the soft clipper's curve in any character, even with the ambience at the top of its slider (the rain comes nearest, 0.7 dB under). The five other characters were
levelled against the old ones, layer by layer, and the ambiences have not been
tuned by ear (the brook was matched to measurements, not by listening), so
treat the tables at the top of `audio.js` (`CHARACTERS`, `BEDS`, the `MODES_*`
sets, `WATER`, `SURF`, `FALLS`, `DRIPS`, `AMBIENCES`, `LEVEL`) as a starting point.

## Real sand: the switch in Tune

**Real sand**, in Tune's Material group after Grain, is on by default from
1.10.0 (settings design 5). With it off nothing of the GPU engine is
requested and the app runs the classic sand, as it was. On or off, the page
saves the session and loads again, as for another grain, so the running
time is kept. The setting is the owner's alone: the app never writes it off.
The settings carry a version, `v: 2`, read once from the saved object: a
save without it, or of version 1, comes up with Real sand on (every launch
before 1.10.0 saved `realSand: false`, so such a save cannot say "turned
off"); from version 2 on a saved `false` is kept.

`app.js` is a classic script and stays one, so it never imports the engine
itself: with the switch on, and where `navigator.gpu` exists, it appends
`<script type="module" src="./realsand/boot.mjs">`, which imports the
adapter (`realsand/app-sand.mjs`, `RealSand`) and hands its class and the
engine's build stamp to `Hourglass.attachRealSand`. A stamp other than the
one `app.js` was written for (`REALSAND_BUILD`) means a mix of old and new
files in the cache: the current sand this launch, and the note says Real
sand is updating. The shaders carry the stamp too (the line "Engine build"
in `shaders/common.inc.wgsl`), checked against the modules' at the start,
and a page fetches its shaders once: a rebuild after a lost device or a
retried start compiles the sources the page started with, never a newer copy
that a new release's service worker has put in the cache meanwhile.
Otherwise the engine starts (the device, its pipelines and a self-test) and
fills the GPU from the CPU sand. The CPU sand keeps running and showing all
the while, however long the start takes (a cold start in a home-screen web
app took 3.4 s on an iPhone); once the GPU has drawn its first frame, and is
not lost, the sand changes hands between two quiet frames (no Reset's sweep,
turn, pour, or glass in a hand or moving on its own: the GPU's bed settled
upright): `sim` becomes the GPU sand, which has every member of the CPU Sim
the app uses, and `#c-gpu` fades in over `#c-sand` (hidden by opacity, never
`display: none`, since a knock is placed by `#c-sand`'s box). The clock, the
glass, gestures, sound, motion and sessions run through the same code as
before; the frame calls the engine's `submit` instead of `drawSand`, and the
sweep, the theme and layered sand's colours, the layout and the page's
visibility are passed on. The screen wake lock is the app's own, as before,
and after any gap (a lock, another app) the app's catch-up moves what is
owed through the engine's transfer.

Where it cannot run, the CPU sand stays, with the clock untouched, and the
note under the switch says why; the row's `data-state` holds the bare state
(`on`, `starting`, `off`, `na`, `failed`, `gaveup`, `updating`, `lost`,
`paused`). Without `navigator.gpu` the row says *Needs WebGPU*, found at
every launch for nothing, and nothing is stored. With it, but no adapter or
only a software one (found by loading the engine), the same, and the
browser's user agent is kept (`realSandNa`): while it is the same, a launch
says so without loading anything; an iOS update changes it, and the launch
after tries again. Such a failure in a page that was put away since the
start began is not believed (iOS may refuse an adapter to a page in the
background): it is retried once in view. The switch is never disabled: in
that state it shows off, and a tap clears what was kept and reloads. Any
other failure at the start keeps the setting and tries again at the next
launch, and after three launches in a row it stops trying until the switch
is turned off and on; a start cut short by the app being put away tries
again once it is in view. All of this was found with one engine build:
`realSandBuild` keeps it, and another build forgets `realSandFails`,
`realSandWhy` and `realSandNa`. If the graphics chip is reset while the sand
runs, the CPU sand takes over in the same frame at the GPU sand's counts,
with a toast (none around a lock or an app switch), and the GPU sand comes
back when it can; a second reset within ten minutes leaves the current sand
for the rest of the session.

The watchdog (`watchReal` in `app.js`, settings design 5.4). A chip that
stops answering without losing its device leaves every readback slot
waiting: every frame is then skipped and the picture freezes while the clock
runs on, and the engine's own stall rule, which counts runs, never fires,
since no run is made. So while the GPU sand is the sim, the page in view
and drawing, and the engine awake (asleep, an idle, paused or finished glass
reads nothing back), the app reads the engine's count of readbacks
(`stats().ledger.readbacks`) every 250 ms, and when it has not moved for 4 s
of wall-clock time it takes the loss path itself: the engine's ledger to the
CPU Sim (`syncCpu`), the CPU sand in this frame, the toast, the stopped
engine destroyed once the canvases have cross-faded, and a new engine after
2 s. The third such time within ten minutes is final for the session. A page
put away, or frames not drawn for a second, start its clock again.

The dark opening (`holdVeil`, settings design 5.3). While Real sand starts,
the boot veil waits up to 1 s more for the engine's first frame (the
handover), then fades up as before. A reload that should open at once (a
later "Use this shape") sets sessionStorage `hourglass.openNow` first; the
boot takes the key and does not wait.

What the GPU sand looks like. Each simulated point is drawn as one grain in
the colour of the CPU sand's grain at its place (its seed, carried into every
fill), from the Renderer's own colour table, so the theme, the sand presets
and layered sand's second tone are the same as the current sand's and change
with them at once. The solver's neck is a little wider than the drawn one, so
each grain is drawn pulled in toward the axis near the neck (by the drawn
width over the simulated one, row by row) and the sand lies inside the glass
the app draws. The grains are lit from the upper left of the room: the canvas
turns with the glass, so the light is turned back by the glass's angle on
screen. Grains in flight are drawn as their streaks, a bed moving as a whole
sharp (the lab's rule). Reset is drawn as the current sand draws it, in about
a second: the old sand drawn into the neck (every grain's squared distance
from the neck falling by the same amount, the sand frozen), then the new bed
shown from the neck up under a rising heap, with the thread that pours it.

Layered sand on the GPU. A grain keeps its colour while it falls; when it
first comes to rest below the neck it takes the tone the layer schedule
gives it, so the lower heap grows in strata as the current sand's does
(layers of a style's depth across the heap, one tone under the other,
changing from layer to layer, poured sand in layers of its own). The tones
given keep pace with the tones of the grains that came (within about a
stratum's worth: a stratum ends early when the sand for it runs out), so
each tone keeps its count, as the current sand's sifting does. After every
turn (a Flip, a turn by hand or by real motion) the grains that moved take a
fresh pattern as they come to rest, a pattern drawn anew for each bulb and
turn (the current sand's own drawing of it); they trade tones in equal
numbers, so each bulb keeps its count of each tone. Turning layered sand on
or off re-tones every grain from the current sand's strata, by its depth in
its column, behind the usual slow cross-fade.

What it sounds like. The stream is the grains the GPU sand lets through the
neck each frame (the same count the clock reads); each lands after its fall
from the neck to the heap, on glass while the lower bulb is nearly empty,
and poured sand lands in the top bulb; the tail follows the last grains, and
the fill the lower bulb. Blows thump and clack; mending chimes. Knowingly
silent for now: the bed's landing thumps, the avalanche hiss and the bed's
slams, and so the landing buzz (Android); every other buzz is the app's own.

With Real sand on the glass does not crack: a blow thumps and clacks, cracks
the glass already has stay and can be mended, and Reset makes it whole. The
glow, rim light and depth shading of the CPU sand are not drawn. Grain still
sets the current sand's grain; the GPU sand keeps its own. With the switch
on, the row's **Copy a report** copies the engine's figures (its power mode,
rate, counts, the stream's first fall, the start-up times, the heat guard's
trips, its log) for the owner's notes, also from a home-screen web app;
`?debug=sand` shows them on screen too; `?offscreen=1` is for the tests only
(the engine draws offscreen and accepts a software adapter).

## Real sand: the engine, the frame and the valve

The engine is `realsand/`, plain ES modules with no build step; the sand lab
imports the same files.

| File | What it is |
| --- | --- |
| `boot.mjs` | the one module `app.js` appends (switch on, `navigator.gpu` there): it hands `RealSand` and the build stamp to `Hourglass.attachRealSand` |
| `app-sand.mjs` | `RealSand`, the adapter: every member of the CPU `Sim` that `app.js` and `audio.js` use, with the same types; the frame's `submit`, fills, transfers, the swap frame, the Reset's sweep, the sound record, start-up, loss and rebuild, `stats()` and `audit()` |
| `valve.mjs` | the ledger (the sand above the neck in the app's whole grains) and the controller that meters the neck once a frame; pure JavaScript |
| `solver.mjs`, `shaders/` | the PB-MPM solver on WebGPU and its WGSL: the neck's throttle and membrane, the tally, the flip pass, appends, readbacks, the tone pass |
| `glass.mjs` | the glass on the solver's grid, built from the app's own geometry (`makeGeometry`, `profile` of `physics.js`), with the neck's warp |
| `fill.mjs` | fills: the lattice, and `fromLattice`, the GPU bed laid where the CPU sand's grains are, each with its grain's colour seed |
| `grains.mjs` | the grains drawn: the palette from the Renderer's colour table, the warp, the room's light, the sweep |
| `layers.mjs`, `shaders/tone.wgsl` | layered sand on the GPU: the layer schedule, fresh tones as grains come to rest, the pattern after a turn |
| `modes.mjs` | the power modes: asleep, full, calm and the heat guard |
| `rate.mjs`, `pace.mjs` | auto Hz (480 to 1,440 substeps a second), and the GPU's pace (two frames in flight at most, the budget) |
| `felt.mjs` | the glass's motion as the sand feels it (`GlassFelt`): `live` by default (the part of a push along the sand's floor beyond the bed's friction at the film's speed, at once, capped at 2 g; the rest, and every push off or into the floor, as it is; the floor taken from the sand's gravity), `slowmo` (a lone jolt as a slowed film, live while shaken), `film` (the slowed film, half a second late under shaking: before build 5), `plain`; `RealSand.jolts` picks one, plain under Reduce Motion |
| `palette.mjs` | the lab's palettes (the app's come from its Renderer) |
| `build.mjs` | the build stamp |
| `LICENSES.md` | the solver's MIT and BSD-3-Clause notices |

One frame with Real sand on. `frame()` in `app.js` runs as it does for the
CPU sand, and `sim` is `RealSand`:

1. The clock ticks from the wall clock. A pour (`sim.pour`) adds its grains
   to the ledger and appends their points on the GPU at once; a swap
   (`completeFlip`, from the Flip, a turn by hand or real motion) turns the
   ledger at once and the GPU at its next run, by the flip pass.
2. `sim.beginFrame()`, and the catch-up when time was missed
   (`sim.fastForward`: the ledger drops at once, the GPU's points follow by
   a transfer).
3. The app's 120 Hz steps, up to six. `composeField` hands the field to
   `real.feel`, which keeps the samples with their times (each GPU substep
   takes the newest at or before its own time). `sim.step()` moves only the
   count: at the frame's first step the valve plans the frame's count from
   the clock's target, and the count reaches it in equal parts.
4. `real.submit(now)` in place of `renderer.drawSand()`: nothing while
   hidden; a transfer under way holds the runs (abandoned after 1 s, the CPU
   sand then brought to the ledger's counts and the GPU filled from it); a
   fill put off while hidden goes first; then the power mode. Asleep,
   nothing runs, but a picture whose look changed (a palette, a canvas of a
   new size, back from hidden, a new bed) is drawn again by a run of no
   substeps. A run is skipped when two frames are in flight or every
   readback slot is taken (the canvas is then turned half a turn by CSS
   while its picture is from before a swap). Otherwise the run: the valve's
   words for the neck, the substeps at the chosen rate, the tally, the tone
   pass, the grains drawn, one submit. Its readback comes back some frames
   later and is read against the ledger.
5. The glass, its cracks (the CPU Sim's), the sound (from `sim.frame`,
   which RealSand fills from the ledger: the grains through the neck this
   frame, and their landings after the fall) and the readout, as before.

The valve. What the clock and the sound read (`sim.nTop`) is the ledger,
in the app's whole grains; the GPU counts material points (1.69 a grain
of the classic sand on a phone). Each fill, transfer or settled count
starts an epoch with an exact base in both, so the clock's target in
grains is a target in points.
On the GPU, sand just above the counting line may move down no faster than
the valve's speed (the throttle), and a point may cross the line downward
only with a ticket: a substep's tickets are the points above less the
target at that substep, taken with an atomic counter, and crossings upward
are refused (the membrane). So the sand above is never less than the
clock's target in any substep, whatever the CPU's latency, and the last
point leaves in the substep in which the clock reaches `00:00.0`. Once a
frame, on the CPU, the controller sets the throttle's speed from the
readbacks so that a small queue waits on the line. A readback is read in
the present terms by replaying the pours and turns made since its run; one
from before a fill or a transfer is dropped. After the end, grains still
above (the residue) are moved below by a transfer once they have had 1.5 s
to flow (from the end, or from a fill or transfer made after it).

Any change to the engine raises the stamp in `realsand/build.mjs`,
`REALSAND_BUILD` in `app.js` and `BUILD_EXPECTED` in `lab/sand/main.mjs`
together (`realsand-shell` checks that they match), and `VERSION` in
`sw.js`; a new module or shader goes into the worker's `SHELL` too
(`realsand-shell` finds one that is missing). The tests of Real sand:
`realsand-valve`, `-fill`, `-adapter` and `-shell` in Node, in seconds;
`app-realsand` in the browser harness on a mock graphics chip;
`realsand-gpu` on WebGPU in software, only when named; and
`app-regression`'s service worker check (see [Tests](testing.md)).

## The engine contract

The app has two sand engines: the classic sand on the CPU (`P.Sim`, in
`physics.js`) and Real sand on the GPU (`RealSand`, in
`realsand/app-sand.mjs`). It does not ask which one it holds. It keeps the
sand engine in one variable, `sim`: the CPU Sim, or RealSand once Real sand
has taken over. The CPU Sim stays alive as `cpuSim` either way, and the GPU
engine is reached as `real` while it draws, `realEng` from the moment it is
made, and `eng` while it starts. What an engine must provide comes in three
groups.

**The Sim's members**, which both engines have, with the same types. These
are what `app.js` and `audio.js` read and call on `sim`:

- the ledger of the sand: `nTop`, `nBottom`, `total`, `capacity`, `fillMax`,
  `maxTotal`, and `reset`, `pour`, `fastForward`, `completeFlip`, `step`,
  `beginFrame`, `isActive`, `motionActive`;
- the neck's valve, which the app sets each frame from the clock:
  `gateOpen`, `deepRelease`, `targetTop`, `relCap`;
- the pose and the field: `angle`, `tilt`, `flipping`, `gy`, `G`,
  `setMotion`, `setCarry`, `wakeAll`, `inertiaZ`;
- hints the classic sand uses and the GPU sand accepts: `quality`,
  `reduced`, `quiet`, `spinArmed`, `damageArmed`, `topSweeps`;
- what a hand does to the glass: `impact`, `knock`, `flick`, `shake`;
- the frame's record for the sound: `frame`, `nev`, `evX`, `evV`, `evK`,
  `agit`, `agitation`, `bf`;
- the glass and its damage: `geo`, `W`, `H`, `cracks`, `warnSeg`,
  `segInfo`, `sealCracks`, `serializeDamage`, `restoreDamage`, `forceCrack`,
  `dMax`, `lost` and the escaped grains (`escN`, `escX`, `escY`, `escVX`,
  `escVY`, `escS`);
- the look: `setLayers`.

`frame`, `geo`, the event arrays and `cracks` are the CPU Sim's own objects,
shared with RealSand, not copies: the sound, the cracks and the glass read
one record whichever engine runs.

**The GPU engine's own members**, which the app calls only on `real`,
`realEng`, `eng` and the class, each under its guard: `create` (static),
`start`, `adopt`, `ready`, `takeOver`, `destroy`, `destroyed`, `stats`,
`points`, `feel`, `submit`, `setSweep`, `layout`, `setHidden`,
`setPalette` and `syncCpu` (the watchdog's: the engine's ledger to the CPU
Sim). The engine reaches the app through one door:
`realsand/boot.mjs` calls `Hourglass.attachRealSand(Cls, build)`, which
refuses a build stamp other than the one `app.js` was written for
(`REALSAND_BUILD`).

**The classic sand's picture is the Renderer's**, not the Sim's. The app
draws the CPU sand with `renderer.drawSand` and keeps the glass, the frame,
cracks and mends, the Reset's sweep, the theme and layered sand's colours on
the Renderer (`drawGlass`, `setSweep`, `layout`, `setTheme`, `setFrame`,
`setLayers`, `setMend`, `syncDamage`, `damageEvent`). With Real sand on the
frame calls `real.submit` instead of `drawSand`, and RealSand takes its
colours from the Renderer's own table (`renderer.lut`, `renderer.isMica`), so
any sand the Renderer can draw, Real sand draws. The Sim knows nothing of a
Renderer.

The exact lists live in one place, the test that checks them (the first
check of `tools/test/realsand-adapter.test.js`). It reads every name that
`app.js` and `audio.js` bind to an engine (`sim`, `cpuSim`, `real`,
`realEng`, `eng`, the class, and the sound's `sim`) and compares them with
its lists: a member used and not listed, or listed and no longer used,
fails, so a new member joins the contract on purpose. Then the CPU Sim must
have every member of the first group, RealSand each of them with the CPU
Sim's type and every member of the second, and the shared objects must be
the CPU Sim's own. Real sand's side of it, member by member, is in
[Real sand: the design](design/real-sand.md), section 4.

A third sand engine would follow the same checklist: every member of the
first group; the lifecycle members the app calls on the GPU engine; loaded
behind its own switch and its own build stamp; every file it loads in the
service worker's `SHELL`, and in a licence table if it is derived from other
work. The app's Real sand section in `app.js` (the switch, `attachRealSand`,
`startReal`, `handover`, `onRealLost`) is the model, and would be made
general then, with that engine as the test of it.

## Adding a sand, a glass shape, a sound or a setting

Each of these is, today, an entry in a table plus its place in Tune, by
hand. The tables are about to become registries, one record in one list
each: the sound characters and ambiences (with a list Tune can read), the
glass shapes (with a flag for the shapes Tune offers), the stored settings
(one record per key, with its default, what is valid and how an older save
is carried over), and the nine sands of the coming Tune. Until they land,
this is how each is added. Whatever is added, a shipped change also goes
through the release checklist in [Architecture](architecture.md): a new
file needs its `<script>` tag and its line in `SHELL`, and `VERSION` in
`sw.js` goes up.

**A sand (a material).** A record in `THEMES` in `physics.js`: the grain
tables of the sand (`sand`) and of its companion tone for layered sand
(`sand2`), the glints, how the sand takes the light, the glass's tint, the
caps and the glow behind the glass. Its id goes into `THEME_ORDER` in `app.js` (the order the name at
the top steps through), its card into Tune's `#themes` in `index.html` (with
`data-theme-id` and its `orb`), and the page's own colours under
`[data-theme="…"]` and `.orb-…` in `styles.css`. Real sand needs nothing:
its palette comes from the Renderer's table. A saved theme the app does not
know falls back to Sahara.

**A glass shape.** A record in `SHAPES` and its id in `SHAPE_ORDER`, in
`physics.js`: an `id`, a `name`, `kR` and `kH` (the bulb's widest
half-width and its height against the classic glass) and `f(u)`, how far the
wall has opened at `u`, from 0 at the neck to 1 at the widest. A Sim is
built in it with `new P.Sim({ shape: id })`, and refuses, by name and by
rule, a glass the sand cannot use. `sim-shape` and `render-shape` take every
registered shape. The app does not offer shapes yet; with them, both
engines get the glass from the same geometry.

**A sound character.** An entry in `CHARACTERS` in `audio.js` (how loud
each layer of the sand is, the room, the tone, and its resonators: six rows
in a `MODES_*` table, or the thin glass of `MODES` when it names none), and
its card in Tune's character group in `index.html` (`data-character`,
with its icon). A saved character the app does not know falls back to
Close-Miked ASMR.

**An ambience.** A synthesiser and an entry in `AMBIENCES` in `audio.js`
(its name, its layers, each made by a function at a sample rate no higher
than its sound needs, all of them within 8 MB of PCM, and how long a tap in
Tune plays it), and its card in Tune's ambience group (`data-ambience`).
`app-ambience` pins the cards and their order; `audio-levels` holds each
ambience to a level.

**A setting.** Its default in `settings`, in the Settings section of
`app.js` (a saved value is kept only when its type is the default's), any
check of its range beside the others there, its row in Tune in
`index.html`, its handler (it sets `settings.…`, calls `save()` and applies
the change), and its effect at boot, in the Engines section, in the order
the boot applies the rest. Four suites pin Tune's rows at ten
(`app-regression`, `e2e-calm`, `app-breath`, `app-sequence`), so a new row
changes those counts on purpose.
