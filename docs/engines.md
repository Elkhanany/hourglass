# How it works

How the sand, the glass, its motion and its sound are made: the classic sand
of `sand/` and `glass/`, which every glass runs on, and Real sand, the sand simulated
on the graphics chip (`realsand/`). The last two sections say what a sand
engine must provide, and how to add a sand, a glass shape, a sound or a
setting. How the files fit together is in [Architecture](architecture.md),
the tests are in [Tests](testing.md), and Real sand's design, section by
section, is in [Real sand: the design](design/real-sand.md).

## `sand/` and `glass/` — simulation and renderer

The simulation is `sand/sim.js`, the sands' colours `sand/sands.js`; the
glass's shapes are `glass/shapes.js`, and its picture `glass/gl.js` (the
WebGL glass), `glass/renderer.js`, `glass/cracks.js` and `glass/spill.js`.
They are the seven pieces of one namespace, `HourglassPhysics` (until
1.18.0 one file, `physics.js`; [Architecture](architecture.md) says how
the pieces fit together).

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
  seed, written straight into an `ImageData` buffer. Under Tune's Light: Soft
  (the sand as it was drawn up to 1.20) it has depth-based ambient occlusion,
  a rim-lit surface, glossy facets and mica glints; under Sunlit (as the app
  comes) it is lit by one key light, below. A half-resolution bloom layer adds
  the light scattered around the brightest grains.
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
  In the light look a second program lights it in a white room (dark cards
  behind it, dark flags at its sides) and lays it over the paper as clear
  glass: each layer is premultiplied colour at the strength the glass gives,
  never a film. The near wall covers what lies behind it only by what its outer
  face mirrors and its glass takes, and gives back at least the page's light its
  face takes (the shade where the sand meets the glass is the sand's own); the
  wall behind the sand gives back at least all the page's light it takes; the
  white room is
  mirrored at about the paper's own white (an exposure of 1.15). So an empty
  bulb is the paper seen through glass, a sand behind it keeps its colour, the
  room's highlights lie over both, and the wall seen edge-on, which bends the
  dark cards and flags round into the eye, draws the outline as a dark line all
  round. On top of that, as light added over the page, the key's window and
  the small lamp mirrored in each wall (the near wall's at up to 16 times its
  Fresnel reflectance, the far wall's at less than half that): the only
  things on white that are brighter than the page, and what makes the glass
  read as a curved vessel. Toward the grazing side the near wall greys the
  page by up to 5 %, inside its dark outline, for the wall's thickness. There
  is no veil over the bore in the rendered glass (the drawn glass of a device
  without WebGL keeps its light veil of before). The dark look's program is
  the text it always was.
  The classic teardrop is drawn by the shader's own formula; every other
  shape is drawn by a second program that reads its inner and outer surface
  from a small table made from the shape's curve when the glass is built (a
  device that refuses that program gets the drawn glass of the same shape).
- **Sand stays inside the glass.** The lattice only knows whole cells, so
  grains, motion streaks and the glow are all clipped at half-cell resolution
  to the same smooth inner surface the glass is drawn with.

### The sunlit sand

Tune's **Light: Sunlit** (`settings.sandLight`, `renderer.setSandLight`)
lights the classic sand with one key light; Soft is `drawSand` as it was,
byte for byte in the dark look (in the light look it draws the falling
grains and a pale sand's tops as below, *The light look's falling grains*). The key is `HourglassPhysics.KEY_LIGHT` (`sand/sands.js`), a
unit vector in the screen's axes (x right, y up, z toward the eye) from the
upper left and in front, the quarter of the glass's key softbox in
`glass/gl.js`'s room, so the glass's highlight and the sand's lit flank
agree; Real sand reads the same constant. The light stays in the room: it is
turned back by the glass's angle against the room in the frame being drawn
(`drawSand(rot)`, which the app gives `sim.angle + sim.tilt`; the sand is
drawn before the glass, and in the frame of a swap the angle the glass was
last drawn at is the other way up), so it stays upper left on screen when
the glass leans, is turned over, and in the frame it swaps its ends.

- **The body** of sand pressed against the front glass is a surface of
  revolution like the bore: across a row its normal is (s, 0, √(1 − s²)) with
  s = (x − cx) / r(y), r from the shape's own `profile`, so all nine shapes
  are lit by their own walls. Its light is ambient plus the key through the
  glass (Fresnel transmission at both surfaces, falling toward the grazing
  side), a wrapped Lambert term (sand is rough and a little translucent, so
  its terminator is soft), a thin crescent just past the terminator (light
  that runs inside the wall), all times a contact shade where the sand
  meets the glass.
- **The free surface** (heap, crater): each column's height in each bed is
  the first resting grain the bead writer met in the frame before, smoothed
  over five columns each side (weights exp(−o²/8); a column with no bed
  counts for nothing), so that the lattice's stairs light no stripes. The
  slope of the smoothed heights two columns each side gives the normal, and a
  horizon test toward the light over them (at 1, 2, 4, 8, 16 and 24 columns)
  a soft shadow where the bed hides the light from itself. A grain's light
  goes from the surface's to the body's by its distance under the smoothed
  surface (in quarter cells, e^(−d/1.5), gone by 6 cells), with a gentle
  darkening below. Where the surface faces the key (n·L from 0.45 to 0.75)
  its top grain is up to 6 levels brighter, half that one grain down: the
  crest.
- **Colour.** A 48-level table per seed, as Soft's, but a shadow gains
  chroma as it darkens (light bounced among coloured grains) and a lit grain
  gains chroma as it gains light (`sat`); past white its hue is kept (the
  three channels scaled together, what is over spilling toward the key's warm
  tint), and it rolls toward the tint only above 1.15 of its light. So the
  lit flank is more luminous and more coloured, not paler.
- **Glints.** Each seed has a fixed facet tilt; a grain glints when its facet
  faces the key's mirror direction, so a still bed glints in the same places
  every frame and a tumbling grain (a moving cell) flashes. A glint is the
  whole bead: its facet's pixel the glint's colour, the rest half way to it.
  Only a share of the seeds can glint at all, set per sand. A resting glint
  feeds the bloom 0.12, a tumbling one 0.7, so steady glints make no haze.
- **Grains in flight** are small beads lit by half the key, a facet now and
  then catching it; in the light look, as below.

The two looks have their own constants (`HourglassPhysics.SUNLIT.dark` and
`.paper`: ambient, key, exposure, wrap, crescent, contact, depth, shadow
chroma, the surface's reach, the roll toward the tint). The white room
lights the sand from everywhere, so it has the larger ambient and the larger
key; the dark look's exposure is set so that the mean of its two flanks is
Soft's (it is no dimmer on the whole). Across a symmetric heap the lit flank
is about 2.6 times the shaded one in relative luminance in either look
(render-unit holds both at 2.2 or more), and in the light look Sahara's lit
flank has 1.27 times Soft's chroma (OKLab C; render-unit holds 1.2). While
the looks fade (`_paperMix`) every constant is mixed by the same share, the
look's tables made for the share in sixteenths (about 16 builds in a fade);
at rest each look's constants are exactly its own. The app puts the renderer
at the fade's start look before the fade's first frame (`showLook`), so the
sand is never drawn for a frame in the end look's light. Each sand's
`sun` record says how it takes the light: `key` (the key's gain), `paper`
(the key's gain on paper, and its square on the roll toward white: a pale
sand gets less, or its lit side is lost in the page), `lift` (ambient added
so that a dark sand's shaded flank is not black), `glints` (the share of
seeds that can glint) and `mica` (how near the mirror direction a mica facet
must face: higher is fewer). `customSand` works them out from the colour as
it does the rest of the light (the paper key from the colour's mean
brightness at mid light).

The work is in tables: per shape, 16 bits a cell (the body normal's angle and
the distance to the glass in half cells), made once; per look and sand, the
constants, the colour table and the per-seed glint thresholds; per light (the
glass turned by 0.01 rad or more, the same rule as the glass's redraw), the
body's light and glint by angle and band, and each seed's facet term (3 ×
256 entries and 16 × 256); per frame, the columns. A grain then costs a few
lookups and multiply-adds; nothing is allocated per frame. Measured in Node
on a filled phone-size glass (207 × 453 cells, 24,165 grains), `drawSand`
takes 0.94 ms under Soft and 1.18 ms under Sunlit (median, a desktop JIT at
a load of 2; an earlier, more loaded measure saw +1 to +12 %), and a frame
that builds the look's tables (once per sixteenth of a fade) about 2.3 ms.
It has not been measured on a phone. The timer, the physics and the sound read nothing
of it: the light only reads the bed. The shape's and the look's tables (some
8 ms in a browser) are made as the app boots (`renderer.prepareSun()`, after
the look and the sand are set), so the first frames only draw; the dark
opening that lifts at once ("Use this shape") is not held by them.

#### The light look's falling grains

On the paper a pale grain in the air is white on white, and the clear glass
gives it no veil to stand against. So in the light look, under either light,
`renderer._paperTones()` makes per seed a dark side (its colour at the
falling grain's level taken to × 0.45 of its light, at most 0.20 of white, a
quarter more chroma) and a half tone between, mixed in by the light look's
share while the looks fade. A grain in the air is then a 2 × 2 bead whose
pixel toward the key (the room's, turned back by the glass) is its own
colour, the far one the dark side and the other two the half tone; its
streak is the half tone. A pale sand (mean light at that level over 0.6 of
white: Moonstone, Sea Glass, Rose Quartz, a pale colour of one's own) is
drawn up to 5 levels deeper (Moonstone 4) where it lies against the page:
its beds' top three grains and the grains against the glass. In the dark look
none of this is made (`_paperTones` gives null), so Soft is the picture of
before there, byte for byte; render-unit holds that, the light look's beds of
a sand that is not pale byte for byte, and the falling grains' contrast
against the page (at least 2.5 : 1 for the pale sands, about 4 here, where
19c84db drew 2.0 to 2.2). Real sand does the same in its shader (below).

#### Real sand under the same light

Real sand is lit by the same key, with the same constants and the same
colours, so that with Real sand on or off the heap is lit from the same side
with the same strength (measured in pictures of the app on the same
half-run glass, the upper bed's side toward the light over its other side,
relative luminance, Real sand to the classic sand: Sahara 1.57 to 1.50 in
the light look and 1.29 to 1.21 in the dark; Moonstone 1.29 to 1.33 and 1.48
to 1.33. Volcanic differs more, 1.38 to 1.23, as it does under Soft: the
classic sand has a glow over its dark sands, Real sand none).

- **What it is told.** `real.setLight(light, m)`: `light` 'sunlit' or 'soft',
  `m` how much of the light look is shown (0 the dark, 1 the light, between
  on every frame of a fade). The app calls it (`sandLightTo`) when Real sand
  takes over, on every frame of a fade and at its end, and when the row
  changes; an engine without the method draws on as before, and a `RealSand`
  that was never told is soft (the lab never tells it).
- **Nothing is copied.** The adapter reads the key from
  `HourglassPhysics.KEY_LIGHT` and asks the app's Renderer for the look's
  tables (`renderer.sunTables(m)`: the constants with the sand's `sun` record
  in them, and the 48 × 256 colour table the classic sand itself draws
  with). The table goes to the graphics chip as it is, each seed's kind
  (plain, glossy, mica) in its alpha byte, in one array kept and filled again;
  it is made again when the look, the sand or layered sand's tone changes, and
  in a fade for each sixteenth of it (as the classic sand's).
- **The key's turn.** The canvas turns with the glass, so the key is turned
  back by the glass's angle against the room, `angle + tilt`, read from the
  engine's own fields when the frame is drawn. At a swap the points and the
  angle change in the same call, so the lit side never jumps. (The bead's
  light of the soft picture is turned back by the rotor's CSS angle, which
  the app sets after the sand is drawn: a frame behind, and left as it was
  so that Soft stays the picture of before.)
- **Per grain, in the vertex stage** (`realsand/shaders/grains.wgsl`): the
  body's normal from the drawn bore's half-width at the grain's height (the
  half-widths go to the chip beside the neck's warp, a row each), the light
  through the glass, the contact shade, the depth's darkening; near the top
  of its bed the free surface's light instead; a grain in flight (little sand
  round it) the bead's mean light. That light, times the grain's own shade,
  picks a level of the colour table; the grain carries the colours three
  levels down and three up as well, and the fragment stage keeps its bead:
  the side toward the key the brighter colour, the far side the darker (the
  classic bead has a lit and a dark pixel so). A grain's facet is a tilt
  from a hash of its index (a moving grain's tumbles); it glints, a bright
  spot of the sand's glint colour on a bead taken half way to it, when it
  faces the key's mirror direction,
  mica from further off than a glossy grain, and only a share of the grains
  can (the sand's `glints`).
- **The free surface** (`realsand/shaders/relief.wgsl`, three small compute
  passes encoded before the grains are drawn; from build 10). The first
  counts, per cell of the grid, the points that lie in a bed (crowded; not
  within a cell under the counting line, where the stream leaves the neck
  from rest), and again those that move (over three times the displacement
  under which a bed lies still). The second finds, per column and per bulb,
  the bed: from the bulb's floor up, the first run of cells that hold bed
  points (one empty cell in it is not its end) and holds at least four. Its
  top is the column's surface: where the bed is, not its highest grain. (Up
  to build 9 the surface was the highest bed point of the column, held 20
  frames when none was seen: a few grains stuck high on the wall, or a shelf
  thrown up the wall over air, set a column's surface far too high, every
  grain under it was darkened as deep in the bed and lit as under the shelf's
  shadow, and the next column was not: straight dark bars from the surface
  down and blocks with hard edges, while the sand was thrown about.) Sand
  above the run's end (on the wall, in the air) is counted as sand above the
  bed, and the share of moving points in the bed's top six cells is kept.
  The third makes each column's light as the classic sand's column pass
  does, on the surface evened over seven columns (a Gaussian, sigma 1.5
  columns), half the last frame's and half the new: the slope over three
  spans, a horizon test toward the key at 1, 2, 3, 5, 8 and 11 columns, the
  ambient and the key on the surface's normal. It also says how far the
  surface is to be trusted (0 to 1): less with sand above the bed, with a
  top layer that moves, with a surface far from its neighbours' evened one,
  and with a surface that changes fast; evened over the same seven columns,
  falling by at most 0.15 a frame and coming back by at most 0.04. In the
  grains every term taken from the surface (its light, its glints, the
  darkening with depth under it, a pale sand's deeper top, now taken inside
  the level's floor so that it dithers where the trust fades) is weighed by
  that trust, and a grain more than a cell above its column's surface takes
  none of them: where the bed is thrown about the grains keep the body's
  light, which needs no surface, and the light varies smoothly from column to
  column. A settled bed is trusted whole and lit as before, on a surface
  evened by the Gaussian (a crest rounded by under a cell). After a fill or a
  swap nothing is kept from before. All three passes only read the solver's
  points; they write buffers of their own (the last two read and written in
  turn, so no thread reads what another writes).
  The surface's smoothing and the crest of the classic sand are not drawn
  here; the relief's own easing does the smoothing's work.
  The bulb's floor is the end the field the sand feels holds it to (the
  run's last field, in the grid's axes: gravity turned by the glass's angle
  and tilt, and what a phone adds), once it has held the beds there a
  quarter of a second (a jolt turns nothing): with gravity up the grid (a
  glass held past the level by a finger, or a phone that holds it so) the
  bed is scanned from the bulb's far end, its surface is the run's lowest
  cell, its normal points down the grid, and depth, "above", the horizon
  test and the ambient (from the room's up) are measured from that end; the
  grains read the same floor. The grid's columns stand for a surface only
  while that field is near their axis: the trust is weighed by how near
  (whole within about 45 degrees, none past 65, where a bed lies against a
  wall) and by the field's strength against gravity's. A change of floor
  starts the relief afresh. (Up to build 10 every bed was scanned from its
  bulb's floor up: a glass held turned over took the bed's end against the
  cap for its surface, trusted it and shaded it, and darkened the free face
  as deep in the bed; a glass on its side took the bulb's roof.)
- **The light look, in either light.** The look carries `paper`, the light
  look's share (`view.still.y`): a grain in the air (little sand round it,
  or the sweep's thread) is taken most of the way (0.7) to its colour under
  a third of its light (× 0.35, at most 0.15 of white, a quarter more
  chroma), and its side away from the key all the way: a little deeper than
  the classic sand's falling grains, since a blurred streak lets the page
  through (in pictures of the running app, Moonstone's most visible falling
  pixel against the page goes from 2.5 to about 3); under Sunlit a pale sand's
  bed tops are drawn `deep` levels deeper (`view.still.z`).
- **Soft in the dark look is the picture of before, exactly.** Under Soft the
  look given to the grains has no light, `paper` is 0 in the dark look, the
  shader takes the lines it always took, and no relief pass is encoded.
  `realsand-gpu`'s LIT case holds it: the grain renderer of 19c84db (release
  1.20.0, whose grain renderer is the one before the sunlit sand) draws the
  same points beside the engine's own, and the two pictures are equal byte for
  byte.
- **Cost.** Counted from the shader: the vertex stage adds about 180 scalar
  operations for each corner of a grain's quad, four corners a grain (among
  them four `exp`, one `sqrt` and two integer hashes), and six loads from
  buffers (two half-width rows, one relief entry, three colours); the
  fragment stage about 45 operations a fragment on top of the soft bead's
  15. Per frame: one dispatch over the points (six loads and at most one
  atomic add a point; from build 10 into a cleared count of the grid's
  cells, 165 kB), two of five workgroups over the columns (from build 10: a
  scan of the column's cells, then about 1,300 loads a column for the evened
  surface, its trust and its light), and a
  49 kB table when the look or the sand changes. Measured on this project's
  test machine, WebGPU in software (a 10 s glass, 1,952 points, the engine
  of the commit before beside this one, each twice, alone on the machine): a
  frame of a running glass took 279 and 336 ms before, 294 and 306 ms under
  Soft, 291 and 293 ms under Sunlit; a frame that only draws (the glass
  asleep) 123 and 138 ms before, 127 and 132 ms under Soft, 127 and 134 ms
  under Sunlit. So here Sunlit over Soft is 1.00 to within the run-to-run
  spread of 5 to 10 %: in software a frame is the physics and the copy to
  the test's canvas, and the added shading cannot be told from the noise.
  On a phone it has not been measured: that is the figure that counts, and
  the engine's own report (`?debug=sand`) is where to read it.

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
- **Sound.** The rush of sliding sand follows the slide counts, so the rush
  after the Flip ends sooner (2.7 s instead of 4.1 s). An avalanche after a
  lean or a carry is thousands of slides a second, under the 24,000 the rush
  begins at: under a running stream it is a slump now and then, and in a
  glass with no stream it is heard softly, from 1,000 slides a second (see
  [*`sound/audio.js`*](#soundaudiojs--procedural-sound), 5).
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
  (see [Sensors](#sensors-motionmotionjs)), and with Reduce Motion they are never armed.
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
laying the phone on its side do.

No turn starts the clock (from 1.20.2; the phone's from 1.20.1): the first
start is always Start (`Space`) or a tap on the glass. The phone turns the
glass in one place, `tiltSwap()` in `app.js`: the glass's tilt, which follows
the phone's heading, held past 100° for 200 ms makes the other bulb the top.
What the glass does after any turn is decided in `stateAfterSwap()`. After a
turn by the phone, a finger (dragged or flicked), the Flip button or `F`, the
glass runs only if it was running when the turn began; a paused glass stays paused, also with all
its sand below; a glass that waits (never started since Reset, or since the
app opened with nothing running) or has run out is `idle` afterwards,
whichever bulb its sand is in. Only a turn that is a start runs the glass:
Start pressed on a glass whose sand is all below (it turns the glass over on
the screen), and a work and rest sequence's own turn between two phases.
`idle` with the sand above is the glass as Reset leaves it. `idle` with the
sand below is the state in between two turns: the time left is that of the sand above the neck, none,
so the clock reads `00:00.0` under the same words and Start button; the
neck is shut in both sands (the classic sand's gate, Real sand's valve),
since it opens only for a running glass; nothing of an ended glass happens
(no bowl, no rings, no ending buzz, no wake lock), and no session is saved,
since an `idle` glass saves none. Start there turns the glass over on the
screen and runs it, as Start on an empty upper bulb always did; another turn
sets it back to wait with its sand above. A finished work and rest sequence,
turned over, waits at its first glass.

A shaken neck falls behind, so while shaking
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

## Sensors: `motion/motion.js`

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

## `sound/audio.js` — procedural sound

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
   (optional). The slide, the rush, follows the sand's slide count: silent up
   to 24,000 slides a second, full at 184,000, so that under a running stream
   the heap's own avalanches stay beneath it and only a turned or shaken bed
   rushes. A glass with no stream (idle before the start, paused, finished:
   no stream, pour or run for half a second) has
   nothing to hide a slide under, and there the rush begins at 1,000 slides a
   second and rises to 0.3 of its full level by 24,000 (the old curve passes
   that at 42,000, and is unchanged above): a lean past the slope, 13,000
   slides a second on a five-minute glass, sounds near -45 dBFS, 15 dB under
   the stream, on the side the sand runs to (`rushPan`, + the right ear:
   `app.js` gives 0.6 of the fuller bulb's field across the page, in g). The
   floor holds through a turn of such a glass, under the turn's own rule, so
   the sand a Flip sets sliding is heard until it rests, with no gap at the
   turn's end; a running glass that is turned (the app says so: `ambient`)
   keeps the turn's rule alone, as ever.
6. **The glass in the hand**: shaking is heard as it happens in the physics,
   in every state of the clock: the bed's sounds do not ask whether the glass
   runs, only whether the sand moved (the stream and the ambience are the
   running glass's alone).
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

**Coming in** (release 1.20.1). When a glass is set running the app tells
the engine: `begin(seconds, resumed)`, from `setState` in `app.js` whenever
the state becomes running from another (`soundBegins`: a start from waiting
or from finished by any way, a resume after a pause), and for a new glass
that runs on (another duration picked while it ran). A resume is a glass
that has run and was paused; one that stands paused without having run
(given sand after it ran out, or found paused at a launch) starts. A turn of a running
glass and a sequence's own turn between two phases change no state and
tell it nothing. The times are one record in `sound/audio.js`, `IN`, under
the comment that states the rules:

- at a start the sand's own stream (its hush, its crackle, its grains, the
  slumps down its pile) rises from silence over 1.5 s, on a plain ease in
  and out, and the ambience stays silent for 2 s and then rises over 8 s;
- a short glass: the wait is at most a twentieth of the time the glass has
  to run and no rise longer than a quarter of it (10 s: 0.5 s, then 2.5 s);
- after a pause the sand comes back over 0.6 s and the ambience over 3 s,
  with no wait.

The ambience's rise is the rising half of a bell in decibels: at the share
u of its length it is 54 (1 - u)² dB under its level (30 dB under a quarter
of the way, 13.5 dB halfway, 3.4 dB at three quarters, within 1 dB from
0.86), so it climbs fastest where nothing is heard yet, never more than
1.5 dB in a tenth of a second on the 8 s rise, and ever more slowly as it
arrives. It is scheduled on the audio clock when it begins, as a chain of
short glides of the ambience's bus (one every tenth of a second, each aimed
at the curve a step ahead), so it does not depend on the frames: a page
hidden while it rises still arrives. The engine keeps the bus's course
(`_ambCourse`), so it knows the bus's level at any moment, and a rise is
entered where its curve has that level: from silence at its foot, part of
the way up from a level the ambience still has (a stream still receding
under the bowl when the glass is started again, a pause of a second). So
nothing jumps. A pause stops a rise where it is and the resume goes on with
it; a start's rise that was paused stays the start's slow rise, and the
sand's is then the lower of the start's rise and the resume's, so a quick
pause and resume is no shortcut to the full level. The fade before the end
is a gain of its own after the bus (`ambEnd`), so the two never work
against each other: where the fade begins under a rise the ambience climbs
on until the fade's fall outweighs the rise, turns round once, from the
level it has, and falls with the fade; it is never louder than the rise
alone nor than the fade alone, and a resume in the last stretch comes back
under the fade. An ambience the fade has closed has no level: its bus is
shut behind it, and a glass started again after an end in quiet waits and
rises as any start. An audition is heard at once and whole, and ends a
rise. Only levels change: the same grains and the same beds play as without
a rise (the same random numbers in the same order), and the thumps, the
clacks, a tap, the slosh and its shimmer, a pour and the bowl are not part
of it. Without a `begin()` the engine is what it was: a glass that only
runs sounds as in release 1.20.0, to the last bits.

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
treat the numbers in `audio.js` (the characters' records, `BEDS`, the `MODES_*`
sets, `WATER`, `SURF`, `FALLS`, `DRIPS`, the ambiences' records, `LEVEL`) as a starting point.

## Real sand: the switch in Tune

**Real sand**, in Tune's Material group after Grain, is on by default from
1.10.0 (settings design 5). With it off nothing of the GPU engine is
requested and the app runs the classic sand, as it was. On or off, the page
saves the session and loads again, as for another grain, so the running
time is kept. The setting is the person's alone: the app never writes it off.
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
files in the cache: the classic sand this launch, and the note says Real
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
browser's user agent is kept (`realSandNa`, with the time in
`realSandNaAt`): while it is the same, and for seven days, a launch
says so without loading anything; after that, or once an iOS update has
changed it (whether one does in a home-screen app is not known), the launch
tries again. The same failure from a start made again in a session that saw
the chip reset, lost or not answering (the watchdog's new engine, the retry
of a start the reset cut short) may only be the chip on its way back: it is
neither kept nor counted, the note says *Real sand could not restart; it
will try again next launch*, and the classic sand runs for the session.
Such a failure in a page that was put away since the
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
back when it can; a second reset within ten minutes leaves the classic sand
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
and layered sand's second tone are the same as the classic sand's and change
with them at once. The solver's neck is a little wider than the drawn one, so
each grain is drawn pulled in toward the axis near the neck (by the drawn
width over the simulated one, row by row) and the sand lies inside the glass
the app draws. The grains are lit from the upper left of the room: under
Tune's Sunlit by the classic sand's own key, body, free surface and glints
(see "Real sand under the same light" above); under Soft each grain is a bead
lit from that side and no more, the canvas's turn taken back by the glass's
angle on screen. Grains in flight are drawn as their streaks, a bed moving as
a whole sharp (the lab's rule). Reset is drawn as the classic sand draws it, in about
a second: the old sand drawn into the neck (every grain's squared distance
from the neck falling by the same amount, the sand frozen), then the new bed
shown from the neck up under a rising heap, with the thread that pours it.

Layered sand on the GPU. A grain keeps its colour while it falls; when it
first comes to rest below the neck it takes the tone the layer schedule
gives it, so the lower heap grows in strata as the classic sand's does
(layers of a style's depth across the heap, one tone under the other,
changing from layer to layer, poured sand in layers of its own). The tones
given keep pace with the tones of the grains that came (within about a
stratum's worth: a stratum ends early when the sand for it runs out), so
each tone keeps its count, as the classic sand's sifting does. After every
turn (a Flip, a turn by hand or by real motion) the grains that moved take a
fresh pattern as they come to rest, a pattern drawn anew for each bulb and
turn (the classic sand's own drawing of it); they trade tones in equal
numbers, so each bulb keeps its count of each tone. Turning layered sand on
or off re-tones every grain from the classic sand's strata, by its depth in
its column, behind the usual slow cross-fade.

What it sounds like. The stream is the grains the GPU sand lets through the
neck each frame (the same count the clock reads); each lands after its fall
from the neck to the heap, on glass while the lower bulb is nearly empty,
and poured sand lands in the top bulb; the tail follows the last grains, and
the fill the lower bulb. Blows thump and clack; mending chimes.

The bed is heard as the classic sand's is, in every state of the clock, and
it is made from what the GPU sand itself did. Each frame's readback carries,
for each bulb, the sand that lies in a bed (not the falling stream): how
much, its mean velocity, where it is, and how many of its points move and
how fast. From these `RealSand` fills the classic sand's record, on the
classic sand's scale ([the engine contract](#the-engine-contract)). A bed
is heard once it is 3 % of the glass's points (and 40 of them): the plug of
the stream under the neck of a glass just started, the first grains on its
floor and the last above the neck are no bed, and a glass started and left
alone feeds nothing of a bed. A bed
that falls as one body (seven in ten of its points moving) with the field
along the glass and is then stopped by the glass
(half its speed lost within 0.15 s, whatever the display's rate)
has landed with the speed `u` it fell at: a thump of `u² / (2 G HB)`, the
classic sand's own energy for a bed landing at that speed, or a slam when it
is the far end that stops it; a bed that the field itself slowed has not
landed, and one stopped sideways lands nothing, as the classic sand's slip
does not. Nor does sand shaken up the wall that slides back down it into the
rest of the bed: the bed's mean may fall as fast as a faint landing, but only
about half of it moves (0.47 to 0.62 of its points, where a flicked bed's
fall moves 0.75 to 0.94 of them), and it is a slip, not a landing; before this
rule a sideways shake gave such a thump (0.0016 to 0.0030) as the sand
settled, in six of ten shakes on one machine, where the classic sand gives
none. The slides are the bed's motion within itself: a bed that flies or
slides as one body slides nothing, and one that only creeps next to nothing.
They are counted at a share set against the classic sand, 16 over the square
root of the bed's grains, because the classic sand slides at its surface
while the GPU bed shears through its depth, and only of a bed that lies
packed: thrown, a bed flies (loose, until it has packed again, or moving
along the glass as a body), and the classic sand's bed in the air slides
nothing. The agitation follows each bed's
own acceleration over the glass, with the classic sand's memory (0.25 s) and
a landing's heat. Nothing is fitted in the thumps and the agitation. On the
same scripted motions they agreed with the classic sand's when measured at
engine build 6, before the seven-in-ten rule (a 10 s glass before its start,
WebGPU in software, the classic Sim on the same motion beside it; the probe
that made these figures is not in the repository, and they have not been
measured again since the rule): flicked along the glass, one thump of 0.0048 against 0.0043 and
agitation 0.60 against 0.71; shaken along the glass at 1.5 g and 5 Hz for
3 s, 14 thumps of 0.094 in all (the largest 0.012) against 10 of 0.072
(0.013), agitation 2.1 against 2.4; shaken sideways, no thump in either,
agitation 0.93 against 0.87, and 21,900 slides a second at their fastest
against 21,300 (a 1 minute glass: 39,000 against 36,000). Played through
`audio.js`, the two engines' feeds for these motions sound within 3 dB of
each other (the table in the design, section 8). Measured again at build 7
by realsand-gpu's SOUND case (three whole runs, WebGPU in software, a 10 s
glass before its start): flicked along the glass, one thump of 0.0039 to
0.0054 against the classic's 0.0043, agitation 0.54 to 0.67 against 0.71;
shaken sideways at 1.5 g and 5 Hz for 1.5 s, no thump in any of the three
runs, agitation 1.12 to 1.16 against 0.98; leaned 30°, the GPU bed did not
move and nothing was heard. At build 8 (four runs) the flick's thump at a
run a frame was 0.0044 to 0.0059, and at a run every 3 frames within 0.84
dB of it. Two things differ,
both because the sound is made from what the GPU sand did. A phone that moves
without moving its sand makes no sand sound: carried at a walk the GPU bed
lies still and is silent, where the classic sand shimmers (agitation 0.07
against 0.72). And a lean is heard as far as the GPU sand answers it:
leaned 50°, a 1 minute glass's GPU bed creeps three cells in three seconds
(300 slides a second, under the 1,000 the rush begins at), where the classic
sand's heap runs (7,800); laid on its side it goes across as a body that
shears as it goes (26,000 slides a second at their fastest against the
classic's 24,000) and, stood up again, lands back in the funnel with a
thump (0.043), where the classic sand's heap runs back and lands nothing.

The sound comes one to three frames after the sand's own motion (a
readback's delay), a thump as the bed comes to rest. The bed is read once
a run, and up to build 7 that was all the landing had: when the engine ran
less than once a frame (a phone that falls behind, the heat guard's calm
pace) a landing could sound quieter or be missed (on the adapter's mock
engine, 5.2 dB under its energy at a run every 2 frames in some phases,
none at a run every 4 to 6 frames in some). From build 8 the engine keeps
each bed's fastest fall toward the floor between readbacks, while a fall is
possible (from a field 0.3 g off plain gravity, for 0.5 s after it): the
beds are summed at every second substep's end in an entry point of their
own, and one pass a run keeps the fastest; the readback carries it, and the
landing's energy is that fall's (the design, section 8). On the mock engine,
at a run every 2, 4 and 6 frames and every phase, each fall lands one thump
0.2 to 0.3 dB under its energy, at most a run late. On WebGPU in software
the thump at a run every 3 frames is within 0.84 dB of the one at a run a
frame (before the wake below was fixed, up to 2.4 dB too loud once woken
from sleep). The
cost there (the lab's burst, ms a substep): nothing at rest, 2.6 % of a
substep while a fall is possible. And after a jolt wakes a sleeping glass,
its first run starts at the jolt's first sample and covers only the time
since the jolt, also on a slow display (from build 8; until then at least
the frame's whole time, so at a run every 3 frames 24 substeps were laid
over a flick's first 13 ms and its push held for 15 of them, about 6 at a
run a frame, which threw the bed about 15 % faster). A sleeping glass is
silent and sound never keeps it awake (the feeds are read from readbacks
the frame makes anyway); a fresh bed (a fill, a transfer) settles unheard
for 0.4 s. The landing buzz (Android) follows the thumps, as with the
classic sand; every other buzz is the app's own.

With Real sand on the glass does not crack: a blow thumps and clacks, cracks
the glass already has stay and can be mended, and Reset makes it whole. The
glow, rim light and depth shading of the CPU sand are not drawn. Grain is
the classic sand's and is hidden meanwhile; the GPU sand keeps its own. With the switch
on, the row's **Copy a report** copies the engine's figures (its power mode,
rate, counts, the stream's first fall, the start-up times, the heat guard's
trips, its log) for a report, also from a home-screen web app;
`?debug=sand` shows them on screen too; `?offscreen=1` is for the tests only
(the engine draws offscreen and accepts a software adapter).

## Real sand: the engine, the frame and the valve

The engine is `realsand/`, plain ES modules with no build step; the sand lab
imports the same files.

| File | What it is |
| --- | --- |
| `boot.mjs` | the one module `app.js` appends (switch on, `navigator.gpu` there): it hands `RealSand` and the build stamp to `Hourglass.attachRealSand` |
| `app-sand.mjs` | `RealSand`, the adapter: every member of the CPU `Sim` that `app.js` and `audio.js` use, with the same types; the frame's `submit`, fills, transfers, the swap frame, the Reset's sweep, the sound record (the stream from the ledger, the bed from the readbacks), start-up, loss and rebuild, `stats()` and `audit()` |
| `valve.mjs` | the ledger (the sand above the neck in the app's whole grains) and the controller that meters the neck once a frame; pure JavaScript |
| `solver.mjs`, `shaders/` | the PB-MPM solver on WebGPU and its WGSL: the neck's throttle and membrane, the tally (with each bulb's bed, for the sound), each bed's fastest fall between readbacks while a fall is possible (`spreadShift.wgsl` `csBeds`, `prepare.wgsl` `csKeep`, the `bedPeak` buffer; from build 8), the flip pass, appends, readbacks, the tone pass |
| `glass.mjs` | the glass on the solver's grid, built from the app's own geometry (`makeGeometry`, `profile` of `glass/shapes.js`), with the neck's warp; the neck is widened for the solver only up to the bulb's widest row (from build 7), so that in every shape the bulb's far end, where the sand lies, is the glass the app draws |
| `fill.mjs` | fills: the lattice, and `fromLattice`, the GPU bed laid where the CPU sand's grains are, each with its grain's colour seed |
| `grains.mjs`, `shaders/grains.wgsl`, `shaders/relief.wgsl` | the grains drawn: the palette from the Renderer's colour table, the warp, the room's light, the sweep; under Tune's Sunlit each grain lit by the classic sand's key and colour table, the free surface from the beds' relief (read-only passes over the points: two from build 9, three from build 10, the surface where the bed is and weighed by how far it is trusted) |
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

The stamp goes up whenever the engine's code changes (a module or a shader
under `realsand/`), not for a change in comments alone: in
`realsand/build.mjs`, the line "Engine build" in `shaders/common.inc.wgsl`,
`REALSAND_BUILD` in `app.js` and `BUILD_EXPECTED` in `lab/sand/main.mjs`
together (`realsand-shell` checks that they match), and `VERSION` in
`sw.js`; a new module or shader goes into the worker's `SHELL` too
(`realsand-shell` finds one that is missing). The tests of Real sand:
`realsand-valve`, `-fill`, `-felt`, `-adapter` and `-shell` in Node, in seconds;
`app-realsand` in the browser harness on a mock graphics chip;
`realsand-gpu` on WebGPU in software, only when named; and
`app-regression`'s service worker check (see [Tests](testing.md)).

## The engine contract

The app has two sand engines: the classic sand on the CPU (`P.Sim`, in
`sand/sim.js`) and Real sand on the GPU (`RealSand`, in
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

The bed's part of that record is on the classic sand's scale, because
`audio.js` and the haptics are tuned to it. `app.js` reads it in one place
(`feedAudio`), once a frame, after the frame's steps and the picture, in
every state of the clock (idle, running, paused, done), and never while the
page is hidden (no frames; `audio.hold` keeps the stream alone):

- `frame.thump` `[E0, x0, E1, x1]`: a bed landed on its seat in this frame,
  for the bulb above and the bulb below: `E` the kinetic energy it lost, per
  grain of that bulb, over `G` times the bulb's height (a bed dropped a
  tenth of the bulb's height: 0.1), `x` where, -1 to 1 across the bulb.
  `audio.thump` plays `1.3 * sqrt(E)` (nothing under 0.0015), at most one a
  bulb every 60 ms, so a landing's whole energy belongs in one frame; over
  0.3 the phone buzzes (Android), at most every 250 ms.
- `frame.slam` `[E, x]`: a bed struck the far end; the same scale, a clack,
  at most 12 a second.
- `frame.slides`: surface moves in this frame, in the engine's own grains
  and cells; `app.js` divides by the frame's time and by the cube of the
  grain's fineness and smooths over a tenth of a second. An engine that
  hears of its sand only now and then gives the rate times the frame's
  time in every frame, not a burst.
- `agitation()`: 0 to 3, the hotter bed's granular temperature (1 for sand
  shaken at 1.5 g, 5 Hz), read in every frame, so it is 0 whenever the sand
  is at rest; the shimmer's floor is `0.28 * agit^1.5`, flat out from 1.4.
- `bf`: the field each bed feels, for the rush's place between the ears.

Only frames the app counts active pass the record on (`isActive()` is one
of the reasons a frame is active), and an engine at rest leaves all of it
at 0: sound follows what the sand did, never the phone's motion alone, and
never keeps an engine awake.

**The GPU engine's own members**, which the app calls only on `real`,
`realEng`, `eng` and the class, each under its guard: `create` (static),
`start`, `adopt`, `ready`, `takeOver`, `destroy`, `destroyed`, `stats`,
`points`, `feel`, `submit`, `setSweep`, `layout`, `setHidden`,
`setPalette` and `syncCpu` (the watchdog's: the engine's ledger to the CPU
Sim). The engine reaches the app through one door:
`realsand/boot.mjs` calls `Hourglass.attachRealSand(Cls, build)`, which
refuses a build stamp other than the one `app.js` was written for
(`REALSAND_BUILD`).

**What RealSand reads from the classic sand.** RealSand keeps no copies of
the classic sand's numbers (from build 8). At create it reads them from the
classic sand's namespace (`HourglassPhysics`, handed over as `P`): `P.DT`
and `P.STEP_HZ`, the app's step; `P.Sim.EV_CAP`, the landings a frame the
event arrays hold (48); `P.Sim.IMPACT_V`, the blow's speed from which it
thumps (`MOTION.impV[0]`, 700 px/s); `P.Sim.MOTION`'s `tauT` and `idleT`,
the agitation's memory and its idle level; `P.Sim.LAYERS`, whose `settle`
gives how long after a turn sand coming to rest is laid in its new pattern;
`P.Sim.pace()`; and `P.profile` for the glass. Of the CPU Sim it reads,
beyond the Sim's members above, `glassFlip`, `layers`, `rng` and
`layerState()` (each bulb's pattern and its companion tone's share after the
last turn: the Sim's own arrays, read, not changed), never a private field.
`Sim.EV_CAP`, `Sim.IMPACT_V` and `layerState()` are published by the classic
sand for this; they change nothing in its stepping. Without the namespace,
or with one of these values missing, `create` refuses and names what is
missing (for example "lacks P.Sim.EV_CAP, P.Sim.MOTION.idleT"); no number
has a fallback of its own.

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
the CPU Sim's own. Its third group is what RealSand reads from the classic
sand (read from `realsand/app-sand.mjs` itself): four names on the namespace
(`DT`, `STEP_HZ`, `Sim`, `profile`), five on `P.Sim` (`EV_CAP`, `IMPACT_V`,
`LAYERS`, `MOTION`, `pace`) and four of the CPU Sim beyond the Sim's
(`glassFlip`, `layerState`, `layers`, `rng`); each must exist, a read not
listed fails, and a read of a private member (`_` first) of the CPU Sim
fails; a copy of `app-sand.mjs` that reads `cpu._rec` and `P.Sim.FOO` must
fail (the control). Real sand's side of it, member by member, is in
[Real sand: the design](design/real-sand.md), section 4.

A third sand engine would follow the same checklist: every member of the
first group; the lifecycle members the app calls on the GPU engine; loaded
behind its own switch and its own build stamp; every file it loads in the
service worker's `SHELL`, and in a licence table if it is derived from other
work. The app's Real sand section in `app.js` (the switch, `attachRealSand`,
`startReal`, `handover`, `onRealLost`) is the model, and would be made
general then, with that engine as the test of it.

## Adding a sand, a glass shape, a sound or a setting

The glass shapes, the sound characters, the ambiences and the stored
settings are registries: one record each, in one list, which the engine
reads and which a picker in Tune can show. So each is added in one place,
and a record that cannot work is refused by name: as the page loads where
seeing it costs nothing, by a check where it does. A field nothing reads is
refused too, since it is a field misspelt (`layer` for `layers` would be an
ambience that plays nothing). The sands are `SANDS` (the nine and the
custom colour; their order is `SAND_ORDER`) and the frame's finishes `FINISHES`, both
in `sand/sands.js`; how to add a sand is below. Whatever is added, a shipped change
also goes through the release checklist in [Architecture](architecture.md):
`VERSION` in `sw.js` goes up, and a new file needs its `<script>` tag and
its line in `SHELL`.

A record refused as the page loads stops its script, so the engine it would
have defined is not there, and the page says "Hourglass is updating. Open
it again with a connection." (offline; online it says "Open it again in a
moment.") as it does for a missing file. The reason is
in the console (`defineCharacter "tin": lp is undefined, not a number`), and
`node tools/test/check-registry.test.js` stops with it, without a browser.

**A sand.** A record in `SANDS` in `sand/sands.js`, and its id in `SAND_ORDER`
(the order Tune shows the sands in, and the name at the top steps through):
the grain tables of the sand (`sand`) and of its companion tone for layered
sand (`sand2`), the glints, how the sand takes the light, the glass's tint,
the glow behind the glass, and `ui`, what the page wears with it (the accent,
its ink, the glow and the three stops of its swatch). The first six are the
sands of `THEMES`, the same tables. Its button goes into Tune's `#sands` in
`index.html` (`data-sand` and its `orb`), and the page's own colours under
`[data-theme="…"]` and `.orb-…` in `styles.css`; `look-unit` checks the
record against what the colour table, layered sand and the eye need, and the
style sheet against its `ui`. `customSand(h, s, l)` makes a whole record from
one colour (the custom sand), and `customSand.clamp` is the colour it really
uses. A frame's finish is one of `FINISHES` (the caps of one of the six
`THEMES`); `Renderer.setLook({ sand, material })` puts a sand over the caps
of a theme, and the app hands one of the six over its own caps to
`setTheme`, the renderer's own bundle. Real sand needs nothing: its palette
comes from the Renderer's table. A saved sand or finish the app does not
know falls back to Sahara Quartz and walnut.

**A glass shape.** One `addShape` in `glass/shapes.js`, after the others:
`addShape({ id: 'thimble', name: 'Thimble', kR: 0.8, kH: 0.9, offered:
false, f: function (u) { … } })`. `kR` and `kH` are the bulb's widest
half-width and its height against the classic glass, and `f(u)` is how far
the wall has opened at `u`, from 0 at the neck to 1 at the widest: a
function of `u` alone, written out or drawn with the curve helpers above
the records (`shUnit`, `shFlask`, `shMin` and the others). `offered` says
whether Tune may show the glass, and is false, also when left out, until
the glass has shown that its sand flows and keeps time in both sands (all
nine shapes are offered: the trumpet and the Florence flask, with their
long narrow tubes above the neck, since both sands were run through them
frame by frame). `symmetry` is `'point'`, the half turn
both sand engines turn a glass by, and no other value is taken. The classic
teardrop is the first record and the only one without an `f` (`classic:
true`): its curve stays in `profile()`, so its numbers never move.

- What is checked as the page loads, and refused by name: an id nothing
  else has, a name, `kR` and `kH`, an `f` that is 0 at the neck, the
  symmetry, and a field that is none of a shape's. The curve is not walked
  then: a curve scaled by `shUnit` is asked 20,000 times the first time it
  is used (10 to 25 ms), and a page that shows the classic glass never pays
  for it. For the same reason a record's `equator` (the `u` of its widest
  point) is found the first time it is read, and the record names none
  (only the classic glass, which has no `f`, says its own).
- `P.checkShape(id, q, pace)` says the rest, without building a Sim: `[]`,
  or the reasons in words. First what the curve says at any size (`f`
  between 0 and 1, one bulge), then the lattice's rules at scale `q` for
  sand of the pace `pace` (the neck, one bulge, a funnel that opens by at
  most a cell a row, an end wide enough to pour into, two bulbs that mirror
  each other); the first of those is what `new P.Sim({ shape: id })`
  refuses the shape with at that size. The app builds its glass at scale
  1.08 (a phone) or 1.3 times the pace, at paces 1, √2 and 2 (Grain in
  Tune), so `P.checkShape(id, 1.08 * 2, 2)` asks about a phone with Finest
  sand.
- What picks it up: `P.SHAPES[id]` and `P.SHAPE_ORDER`; `new P.Sim({ shape:
  id })` and the Renderer on it; `P.makeGeometry(q, id)` with `P.profile(u,
  g)` for its outline, the classic's too; Real sand, which takes the glass
  from the same geometry. Tune's Glass tab lists the records with
  `offered`, in `SHAPE_ORDER`, and the setting `shape` (app/settings.js)
  takes only one of those: a save that names another comes up as the
  classic glass. The app builds its Sim in the shape only when
  `checkShape` says the sand can use it at that size and grain; otherwise
  the classic glass. The session saved for the running glass names its
  shape and what the glass holds when full for its time, so that a glass
  restored into another shape keeps its time (the sand counted anew as the
  same share of the new full glass, the pace scaled with it).
- What checks it: `check-registry` (the record is whole, and `checkShape`
  at the phone's size); `sim-shape` and `render-shape`, which take every
  registered shape through every case with no change to either (`node
  tools/test/render-shape.test.js --only thimble` draws one). `sim-shape`
  also holds a registered glass to a size near the classic's (`kR` 0.60 to
  1.15, `kH` 0.60 to 1.10, 0.65 to 1.25 of its capacity), and pins which
  shapes are offered, so offering one is changed there on purpose.
  `app-shape` takes each offered shape through the app (filled to its cap,
  a glass run out on time, the picker, the time kept when the shape
  changes), and `realsand-fill`, `realsand-adapter` and `realsand-gpu` take
  every shape through Real sand (`realsand-gpu --only shapes --shapes <id>`
  runs one shape, offered or not, on the GPU frame by frame).

**A sound character.** One `defineCharacter` in `sound/audio.js`, after the
others, and its card in Tune. The record: `id` (what the settings keep),
`name` and `icon` for the card; how loud each layer of the sand is
(`whisper`, `beds`, `ticks`, `grain`, `body`, `modal`; `shake` if a shaken
glass should crackle louder than `beds`), the room and the tone (`room`,
`low`, `high`, `lp`), what of the sand rings the vessel (`send`, `vessel`),
and, if it has its own glass, its resonators (`modes`: six rows of `[Hz, Q,
gain, shift]` in a `MODES_*` table, with `tick` and `bed` for the pitch of
the grains; the thin glass of `MODES` when it names none). The levels are
gains, set by ear against the six records there are, which are the guide
to their ranges, and then held by `audio-levels`. `low` and `high` are
decibels on a low shelf at 230 Hz and a high shelf at 6.2 kHz (0: flat),
and `lp` is the low-pass in hertz (18000 for Close-Miked ASMR, 5200 for
Desert Dune). The icon is what is drawn inside the card's `<svg>`:
`ICON_GLASS`, the small hourglass every sound card shares, and the sound's
own mark beside it.

- What is checked as the page loads, and refused by name: the id, the name
  and the icon, every number, `modes` (exactly six rows of four numbers:
  the graph has six bands), and a field that is none of a character's.
- What picks it up: `HourglassAudio.CHARACTERS[id]`, which the engine and
  the saved setting read (a saved character the app does not know falls
  back to Close-Miked ASMR), and `HourglassAudio.characters()`, the cards'
  `{ id, name, icon }` in order. Tune's cards are still written by hand in
  `index.html`: a `<button type="button" role="radio" aria-checked="false"
  data-character="…">` in `#characters`, the icon inside its `<svg
  class="ic" viewBox="0 0 24 24" aria-hidden="true">` and the name in its
  `<span>`. The click handler is the group's own, so the card needs nothing
  in `app.js`.
- What checks it: `check-registry` fails until the cards and the registry
  say the same (id, name and icon, in order, each card a choice of its
  group); `audio-levels` renders every character of the registry behind
  every ambience at full volume and holds the mix under the clipper, with
  no change to the suite; the Tune trace drives every card of Tune, so the
  new one gets its line in `DRIVE` (`tools/test/lib/trace.js`) and the kept
  trace is made again (below, under a setting); `settings-unit` lists the
  characters its saved states try, where a new one may be added.

**An ambience.** A synthesiser and one `defineAmbience` in `sound/audio.js`,
after the others, and its card in Tune. The record: `id`, `name`, `icon`,
and its `layers`, each a seamless loop: `make(sr, seconds, ch, seed)`
renders one channel (both ears get the same seed; it may return a function
instead, the rest of its work in steps of a few milliseconds), `seconds` its
length, `sr` its sample rate, no higher than its sound needs, and `cue(seconds,
seed)` where a first hearing should start in it, if not anywhere.
`audition` is how long a tap in Tune plays it (5 s if left out). A record
without `layers` is silence (None).

`make` returns a `Float32Array` of `Math.floor(sr * seconds)` samples that
runs into its own beginning without a seam: the engine plays it as a loop,
and nothing cross-fades the join. What both ears must share (when a wave
breaks, when a drop falls) is drawn from the seed, as the brook, the
ocean, the waterfall and the drips do (`mulberry32(seed * 7919 + 13)` for
both ears, and one more generator with `ch` in it for each ear's own). The
older helpers draw from `rnd()`, which is `Math.random`: the tests and the
audio-identity tool put a seeded generator in its place. What the six are
built from is there to use: `rawWash(sr, seconds, loHz, hiHz)` is looping
band-limited noise with a slow swell (from `rnd()`), `level(out, rms)` sets
a channel to a loudness and keeps its peak under 0.95, and `steps([…])`
turns a list of functions into the work-in-slices form (the last one
returns the samples).

- What is checked as the page loads, and refused by name: the id, the name
  and the icon, every layer's `make`, length and rate, the PCM of all
  layers together, two channels of 32-bit samples each: at most 8 MB (the
  waterfall holds 8.00), and a field that is none of an ambience's or of a
  layer's.
- What picks it up: `HourglassAudio.AMBIENCES[id]` (a saved ambience the app
  does not know falls back to None) and `HourglassAudio.ambiences()`. Its
  card is a button in `#ambiences` with `data-ambience`, written by hand as
  the characters' are.
- What checks it: `check-registry`, as for a character; `app-ambience` pins
  the six cards, their names and their two rows of three, so a seventh
  changes that suite on purpose (8 of its checks fail until then);
  `audio-levels` holds each ambience to a level and to the clipper by name
  (its tables `LEN` and `CLIP`), and fails for one that makes a sound and
  is in neither, so a new one gets its two lines and its level's rule
  there; `audio-api` times the slices of the three that are made in slices;
  the Tune trace, as for a character.

A change to `sound/audio.js` that should change no sound (a table moved, a record
renamed, the engine tidied) is shown to change none with `node
tools/audio-identity.js --base <commit>`: it runs the engine of that commit
and the engine of the checkout from the same random numbers, and compares
the tables, the sand's material and every ambience's loops sample for
sample in Node, and every character and ambience through the real graph in
Chromium, to within what a render there differs from itself. A character or
an ambience the old engine does not have is listed as new, and the rest
must still be what it was.

**A setting.** The store is described in
[Architecture](architecture.md#appsettingsjs); the store loads and saves,
and the rest stays by hand in the controller. In order:

1. Its record, at the end of `RECORDS` in `app/settings.js`, after the
   ones there: `id` (the saved key), `default`, whose type is the setting's
   type, a `valid` where only some values are allowed (false puts the
   default back; it does not clamp, so a level saved outside its range
   comes up as the default), and a `from` where an older save should come
   up with something other than the default (it is handed the save as it
   was read, before any type is checked).
2. Its row in Tune, in `index.html`.
3. Its handler in `app.js`: it sets `settings.…`, calls `save()` and
   applies the change, inside the tap. A plain switch can use
   `Store.bindSwitch(el, 'key', after)` instead, which also shows the
   loaded value; `after(on)` applies the change.
4. Its control set from the value at the boot (`$('opt-…').checked =
   settings.…;` in `app.js`'s Boot section; not needed for a switch bound
   with `bindSwitch`), and its effect at the boot, where the rest of its
   kind is applied (what an engine is built with in the Engines section,
   the rest in the Boot section), in the order the boot applies them. A
   control left as the page's markup has it shows the default whatever was
   saved.
5. Its lines in `DRIVE` in `tools/test/lib/trace.js`, where it stands in
   Tune: two for a switch (on, off), one for each choice of a group.
   `app-tune-trace` fails for a control of Tune that no line drives.
6. Both kept traces made again, in a commit of their own: `node
   tools/test/app-boot-trace.test.js --write` and `node
   tools/test/app-tune-trace.test.js --write` write them from the tree
   just run. Read the diff: the new key in each save, the new control's
   lines and each file's `from` line, and nothing else.
7. The row count: six suites count Tune's rows (`app-regression`,
   `e2e-calm`, `app-breath`, `app-sequence`, `app-realsand`, and `app-tune`'s
   reset place check), so a new row changes those on purpose
   (`check-harness` finds every suite that counts them named here).

`settings-unit` needs no change for a record after the old ones: it holds
the store's first 31 records to the app before the store, and leaves newer
keys out of that comparison. It does fail for a `settings.…` name in
`app.js` that is no record (a name misspelt), for a key bound with
`bindSwitch` that is no switch of the store, for a record `app.js` neither
names nor binds, and for a `from` without its example (`FROM` in the
suite: a saved object, and the value it must come up with, which is not
the default). These steps were tried on a scratch copy with a switch made
from an older key: the three suites passed with its own lines and nothing
else changed.
