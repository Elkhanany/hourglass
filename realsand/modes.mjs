/*
 * Hourglass sand engine: the power modes. What the GPU does in a frame, from what the glass and
 * its clock are doing: asleep (nothing), full or calm. Pure functions on a plain state object,
 * so that the lab's Timer, the app (app-sand.mjs) and a Node test run the same code. Moved here
 * from the lab's timer.mjs, which still exports them.
 *
 *  The modes (design section 9.1, as decided on 2026-11-21: no economy mode):
 *      asleep: no GPU work. Not running and not draining, the sand still (the newest readback
 *              has at most 3 points moving faster than 2 % of a free fall over the glass) for 0.5 s, and
 *              nothing pending (a turn, a swap waiting for its flip pass). The rule's limit: a bed
 *              sliding as a whole slower than that (23 cells/s on the coarse grid at app speed)
 *              counts as still and would sleep, and stop, mid-slide; the design's second test
 *              (the fastest under 3 cells/s) cannot tell rest from such a slide, since a substep's
 *              speed jitters on a bed at rest (main.mjs modeFor). A test of the surfaces (the
 *              tally's per-column surface unchanged over 0.5 s) would; it is for Gate A;
 *      full:   60 frames a second, auto Hz on. While the glass is moved or held, turned,
 *              poured, felt motion is over the thresholds below, in the first 2 s of a run, in
 *              the tail and at the end, and for 2 s after any of these;
 *      calm:   running (or draining, or the sand still moving), none of the above: 30 frames a
 *              second at the same substep rate (480 Hz), auto Hz off. Calm is entered only
 *              while auto Hz is at the base rate, so a change of mode never changes the
 *              substep rate.
 *    Felt motion that counts (design 9.1): the glass's acceleration |a| >= 0.05 g, turning
 *    |w| >= 0.5 rad/s or |alpha| >= 5 rad/s^2, held for 0.3 s; or a change of lean of 3 degrees
 *    within 0.5 s. A phone held in the hand passes the app's own idle thresholds every frame,
 *    so these are coarser. A jolt counts at once: |a| >= JOLT_G (0.3 g) at any moment since the
 *    last frame (felt.peak, else felt.a), so that a flick wakes a glass asleep in the frame it
 *    comes (it never did: it is over before 0.3 s) and a shake within a frame or two (it took
 *    0.25 to 0.45 s), while the hand's jitter (0.28 g and less) and handling do not. Asleep, the glass also wakes once its lean has changed by more than
 *    1 degree since it fell asleep (design 9.1: the app's wakeAll), however slowly.
 *    The heat guard: in mode 'auto', when the simulated time stays under 0.6 of real time for
 *    20 s in a row while full (any other frame starts the count again), the glass runs calm until
 *    the run ends or the mode is set again.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */

export const MODES = {
  HOLD_MS: 2000,        // full for this long after anything that asks for it
  START_MS: 2000,       // the first 2 s of a run are full
  FELT_MS: 300,         // felt motion counts once held this long
  LEAN_MS: 500, LEAN_DEG: 3,
  WAKE_DEG: 1,          // asleep: a change of lean since it fell asleep that wakes it
  ACC_G: 0.05, W: 0.5, ALPHA: 5,
  JOLT_G: 0.3,          // a jolt: felt motion this strong counts at once, not held
  STILL_MS: 500,        // asleep once still this long
  CALM_FPS: 30,
  GUARD_RATIO: 0.6, GUARD_MS: 20000
};

/** A mode chooser's state. */
export function newModes() {
  return { mode: 'full', busyUntil: -Infinity, feltSince: null, leans: [], stillSince: null, slowSince: null, sleepLean: null,
    guard: false, guardAt: null, ms: { full: 0, calm: 0, asleep: 0 }, last: null, why: '', changes: 0 };
}
/**
 * Forget the history: a new bed (full for hold ms, HOLD_MS by default, while it settles), or a new
 * setting (hold 0: the rules apply at once).
 */
export function modesReset(m, now = 0, hold = MODES.HOLD_MS) {
  Object.assign(m, { busyUntil: now + hold, feltSince: null, leans: [], stillSince: null, slowSince: null, sleepLean: null, guard: false, guardAt: null });
  return m;
}

/**
 * The mode for this frame. o: {
 *   now (ms), setting ('auto' | 'full' | 'calm'),
 *   busy: something asks for full now (a turn, a finger on the glass, a pour, the run's start,
 *         its tail and end, a swap waiting for its flip pass) - a reason string or '';
 *   felt: { a (g), w (rad/s), alpha (rad/s^2), lean (rad) } the glass's felt motion now, and
 *         peak (g): the largest a since the last frame (a jolt between two frames);
 *   active: the glass is running or draining, or the sand is not still;
 *   still: the newest readback shows the sand still; pending: a swap or a transfer is owed;
 *   ratio: simulated over real time over the last second (NaN: not known);
 *   atBase: auto Hz is at the base rate
 * }. Returns the mode, with m.why the reason.
 */
export function chooseMode(m, o) {
  const now = o.now, M = MODES;
  // felt motion: over the thresholds and held for 0.3 s; or a change of lean of 3 degrees in 0.5 s
  const f = o.felt || { a: 0, w: 0, alpha: 0, lean: 0 };
  const over = f.a >= M.ACC_G || Math.abs(f.w) >= M.W || Math.abs(f.alpha) >= M.ALPHA;
  if (over) { if (m.feltSince === null) m.feltSince = now; } else m.feltSince = null;
  let why = o.busy || '';
  if (!why && m.feltSince !== null && now - m.feltSince >= M.FELT_MS) why = 'felt motion';
  if (!why && Math.max(f.a || 0, f.peak || 0) >= M.JOLT_G) why = 'jolt';
  m.leans.push({ t: now, v: f.lean || 0 });
  while (m.leans.length > 2 && now - m.leans[0].t > M.LEAN_MS) m.leans.shift();
  if (!why) {
    let lo = Infinity, hi = -Infinity;
    for (const l of m.leans) { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); }
    if ((hi - lo) * 180 / Math.PI >= M.LEAN_DEG) why = 'lean';
  }
  // asleep: a change of lean of more than 1 degree since it fell asleep wakes it, however slow
  if (!why && m.mode === 'asleep' && m.sleepLean !== null) {
    const d = (f.lean || 0) - m.sleepLean;
    if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI > M.WAKE_DEG) why = 'lean since asleep';
  }
  if (why) m.busyUntil = now + M.HOLD_MS;
  // stillness, for sleep
  if (o.still && !o.active && !o.pending) { if (m.stillSince === null) m.stillSince = now; } else m.stillSince = null;
  let mode;
  if (o.setting === 'full') { mode = 'full'; m.why = 'set'; }
  else if (o.setting === 'calm') { mode = 'calm'; m.why = 'set'; }
  else if (!o.active && !why && now >= m.busyUntil && m.stillSince !== null && now - m.stillSince >= M.STILL_MS) { mode = 'asleep'; m.why = 'still'; }
  else if (m.guard && o.active) { mode = 'calm'; m.why = 'heat guard'; }
  else if (why || now < m.busyUntil) { mode = 'full'; m.why = why || 'just now'; }
  else if (!o.atBase) { mode = 'full'; m.why = 'auto Hz above the base'; }
  else { mode = 'calm'; m.why = 'calm'; }
  // the heat guard (auto only): full and slower than 0.6 of real time for 20 s in a row; any
  // other frame (calm, asleep, a ratio not known or at 0.6 and above) starts the count again
  if (o.setting === 'auto' && mode === 'full' && Number.isFinite(o.ratio) && o.ratio < M.GUARD_RATIO) {
    if (m.slowSince === null) m.slowSince = now;
    if (!m.guard && now - m.slowSince >= M.GUARD_MS && o.active) { m.guard = true; m.guardAt = now; mode = 'calm'; m.why = 'heat guard'; }
  } else m.slowSince = null;
  // the lean at the moment it fell asleep
  if (mode !== 'asleep') m.sleepLean = null;
  else if (m.mode !== 'asleep' || m.sleepLean === null) m.sleepLean = f.lean || 0;
  if (m.last !== null) m.ms[m.mode] += Math.max(0, Math.min(250, now - m.last));
  if (mode !== m.mode) m.changes++;
  m.last = now; m.mode = mode;
  return mode;
}

/** The time between frames drawn in a mode: calm draws every other frame of a 60 Hz display. */
export function frameMsFor(mode, displayMs) {
  return mode === 'calm' ? Math.max(displayMs, 1000 / MODES.CALM_FPS) : displayMs;
}
