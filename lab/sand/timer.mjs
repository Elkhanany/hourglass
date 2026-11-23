/*
 * Hourglass sand lab: the Timer's arithmetic. The app's amounts and clock, and the
 * power modes, as pure functions, so that the page and a Node test run the same code.
 * Nothing here touches the GPU or the page.
 *
 *  - Amounts: the app's square-root rule (app.js grainsFor): an hour or more is the full
 *    glass, FULL of what a bulb holds; a shorter glass holds less by the square root of its
 *    time. The capacity is the app's phone glass's (scale 1.08, classic grain): 28,099 grains.
 *  - The clock: app.js calibrate, topAt, remAt (a straight run to the tail, then the tail's
 *    curve), and the breathing the app adds to the target (app.js frame).
 *  - The modes (design section 9.1, with the owner's answers of 2026-11-21: no economy), in
 *    realsand/modes.mjs since the app runs them too; exported here as before:
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
 *    so these are coarser. Asleep, the glass also wakes once its lean has changed by more than
 *    1 degree since it fell asleep (design 9.1: the app's wakeAll), however slowly.
 *    The heat guard: in mode 'auto', when the simulated time stays under 0.6 of real time for
 *    20 s in a row while full (any other frame starts the count again), the glass runs calm until
 *    the run ends or the mode is set again.
 *
 * Part of the Hourglass project. License: GPL-3.0-or-later.
 */

export const APP_CAPACITY = 28099;   // grains one bulb of the app's phone glass holds (scale 1.08)
export const FULL = 0.78;            // app.js: the share of a bulb an hour's glass holds
export const FULL_MS = 3600000;
export const TAIL_P = 1.7;           // app.js: the tail's curve
export const POUR_RATE = 620;        // app.js: grains a second while + Sand is held

/** The Timer's glasses: an amount (by its glass length) and the time it is run to. */
export const TIMERS = [
  { id: '10s', label: '10 s', amountMs: 10e3, ms: 10e3 },
  { id: '1m', label: '1 min', amountMs: 60e3, ms: 60e3 },
  { id: '10m', label: '10 min', amountMs: 600e3, ms: 600e3 },
  { id: '60m', label: '60 min', amountMs: 3600e3, ms: 3600e3 },
  { id: '60m-4', label: '60 min sand in 4', amountMs: 3600e3, ms: 240e3 },
  { id: '60m-30', label: '60 min sand in 30', amountMs: 3600e3, ms: 1800e3 }
];
export function timerById(id) { return TIMERS.find(t => t.id === id) || null; }

/** The app's amount for a glass of ms: grains (app.js grainsFor). */
export function grainsFor(ms, capacity = APP_CAPACITY, fillMax = FULL) {
  const f = Math.min(FULL, fillMax || FULL) * Math.sqrt(Math.min(1, ms / FULL_MS));
  return Math.round(capacity * Math.max(0.02, f));
}

/**
 * The app's clock for N grains timed to d ms (app.js calibrate, topAt, remAt). fine2: the
 * Grain setting's square (1: classic). Returns { tailMs, tailGrains, mpg, rate, topAt, remAt,
 * calibrate }.
 */
export function makeClock(d, N, fine2 = 1) {
  const c = { d };
  c.calibrate = (dd, n) => {
    n = Math.max(8, n);
    c.tailMs = Math.min(2600, Math.max(500, dd * 0.04));
    const rate = n / (dd / 1000);
    c.tailGrains = Math.max(3, Math.min(Math.round(30 * fine2), Math.floor(rate * c.tailMs / 1000 / TAIL_P)));
    c.mpg = (dd - c.tailMs) / (n - c.tailGrains);
    c.rate = 1000 / c.mpg;
  };
  c.topAt = rem => rem <= 0 ? 0 : rem >= c.tailMs ? c.tailGrains + (rem - c.tailMs) / c.mpg : c.tailGrains * Math.pow(rem / c.tailMs, TAIL_P);
  c.remAt = top => top <= 0 ? 0 : top >= c.tailGrains ? c.tailMs + (top - c.tailGrains) * c.mpg : c.tailMs * Math.pow(top / c.tailGrains, 1 / TAIL_P);
  c.calibrate(d, N);
  return c;
}

/** The breathing the app adds to the ideal count (grains; app.js frame), now in ms. */
export function breathing(clk, rem, now) {
  let fade = (rem - clk.tailMs - 1200) / 3000;
  if (fade <= 0) return 0;
  if (fade > 1) fade = 1;
  const ts = now / 1000;
  return clk.rate * fade * (0.113 * Math.sin(ts * 1.95 + 1.3 * Math.sin(ts * 0.37)) +
    0.022 * Math.sin(ts * 11.9 + 1.1 * Math.sin(ts * 1.7)) + 0.007 * Math.sin(ts * 28.9 + 0.5));
}

/** The app's target: grains that should be above the neck with rem ms left (with the breathing). */
export function targetAt(clk, rem, now) {
  return Math.max(0, Math.ceil(clk.topAt(rem) + breathing(clk, rem, now) - 1e-7));
}

/* ---------------------------------------------------------------------------------------- *
 *  The modes: realsand/modes.mjs (the app runs them too)
 * ---------------------------------------------------------------------------------------- */
export { MODES, newModes, modesReset, chooseMode, frameMsFor } from '../../realsand/modes.mjs';

/* ---------------------------------------------------------------------------------------- *
 *  The GPU's cost by a burst (design 9.3)
 * ---------------------------------------------------------------------------------------- */
/** The median of a list of numbers (NaN for none). */
export function median(a) {
  const s = a.filter(Number.isFinite).sort((p, q) => p - q);
  if (!s.length) return NaN;
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
/**
 * The GPU's time a substep from two bursts timed submit to done: (median of the big one -
 * median of the small one) / (big - small), which removes the fixed latency of a submit.
 */
export function burstCost(smallMs, bigMs, small, big) { return (median(bigMs) - median(smallMs)) / (big - small); }
/** The share of the GPU a mode takes: substeps a second at the burst's cost, and frames a second at a frame's drawing. */
export function gpuShare(msStep, hz, msDraw, fps) { return (msStep * hz + (Number.isFinite(msDraw) ? msDraw * fps : 0)) / 1000; }
