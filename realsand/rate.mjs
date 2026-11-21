/*
 * Hourglass sand engine: the substep rate (auto Hz).
 *
 * The solver's clamp holds a grid node to maxStep cells a substep, so a grain
 * faster than maxStep x the rate is held back. Auto Hz raises the rate while the
 * sand moves fast, by rungs of the base rate (HZ_BOOST), up to a ceiling, and
 * lowers it again once the sand is slower, so that a falling stream or a thrown
 * bed is not held to the clamp; the GPU's budget (pace.mjs capRate) may hold it
 * lower.
 *
 * Pure functions of two plain objects, so that any page (or a Node test) runs the
 * same code: s, the settings (hz: the base rate, auto, speed: 'app' or 'real',
 * cap: substeps a frame at the base rate, maxStep: the clamp, cells a substep,
 * hzMax: a fixed ceiling or 0), and rate, the rate's own state (newRate).
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */
import { capRate } from './pace.mjs';

/** The rungs auto Hz may use: the base rate times these, up to HZ_MAX. */
export const HZ_BOOST = [1, 1.5, 2, 3];
/** The highest rate auto Hz may use, at each speed. */
export const HZ_MAX = { app: 1440, real: 2880 };
/** The speed a rate may carry: CFL x maxStep cells a substep. */
export const CFL = 0.7;

/**
 * The rate's state at the base rate hz: hz in use; downAt: the simulated time before which it
 * may not fall; grow: how much the fastest grain sped up between the last two tallies (tPrev the
 * later); peak: the highest since the reset; held: the rate the sand wanted when the GPU's budget
 * or the ceiling held it lower (0: not held); want: the rate it wanted; capUntil: capRate's hold.
 */
export function newRate(hz) { return rateReset({}, hz); }
/** Back to the base rate hz, forgetting the history. */
export function rateReset(rate, hz) { return Object.assign(rate, { hz, downAt: 0, grow: 0, tPrev: null, peak: hz, held: 0, want: hz, capUntil: 0 }); }

/** The highest rate auto Hz may use. */
export function hzTop(s) { return s.auto ? Math.max(s.hz, Math.min(HZ_MAX[s.speed], s.hz * HZ_BOOST[HZ_BOOST.length - 1])) : s.hz; }
/** The per-frame substep cap at the rate in use (s.cap is set for the base rate). */
export function capNow(s, rate) { return Math.max(1, Math.round(s.cap * rate.hz / s.hz)); }
/** Uniform slots to allocate: the cap at the highest rate. */
export function capAlloc(s) { return Math.max(s.cap, Math.ceil(s.cap * hzTop(s) / s.hz)); }
/** The most substeps a frame could want: the cap at the highest rate. */
export function capTop(s) { return Math.max(1, Math.round(s.cap * hzTop(s) / s.hz)); }

/**
 * Before a frame: the substep rate the sand needs, into rate.hz. The rate must carry the fastest
 * grain with room to spare (CFL): its speed from the latest readback t (the tally; null: none
 * yet), plus twice what it grew by since the one before (a fall speeds up), plus o.jolt, what a
 * jolt of the glass (known at once) adds over 50 ms, cells/s. The rate goes up at once, and down
 * only after 0.3 s (simulated; o.time, s) with room at the lower rate. o.hzCap: the substeps a
 * second the GPU's budget allows (Infinity: no limit); o.now: the clock of capRate's hold, ms
 * (default o.time in ms). Returns rate.
 */
export function chooseRate(rate, t, { s, jolt = 0, time = 0, hzCap = Infinity, now = time * 1000 }) {
  rate.held = 0;
  if (!s.auto) { rate.hz = s.hz; return rate; }
  if (t && t !== rate.tPrev) { rate.grow = Math.max(0, t.maxSpeed - (rate.tPrev ? rate.tPrev.maxSpeed : t.maxSpeed)); rate.tPrev = t; }
  const v = t ? t.maxSpeed : 0;
  const need = (v + 2 * (rate.grow || 0) + jolt) / (CFL * s.maxStep);
  const top = hzTop(s);
  const rates = HZ_BOOST.map(b => Math.round(s.hz * b)).filter(h => h <= top);
  let want = rates.find(h => h >= need) ?? rates[rates.length - 1];
  rate.want = want;
  // a fixed ceiling (s.hzMax: the rate a phone's GPU budget is expected to hold, so that
  // the tests can step the sand as the phone runs it; 0: none)
  if (s.hzMax && want > s.hzMax) { const w = rates.filter(h => h <= s.hzMax).pop() ?? rates[0]; if (w < want) { rate.held = want; want = w; } }
  // the live loop's GPU budget (hzCap: the substeps a second it allows): no higher than that
  // (but never below the base rate), with room and a hold against hopping (pace.mjs capRate);
  // the clamp then holds the fastest grains back
  const c = capRate(rate, { rates, want, hz: rate.hz, hzCap, now });
  if (c.held) { rate.held = rate.held || c.held; want = c.want; }
  if (want >= rate.hz) { rate.hz = want; rate.downAt = time + 0.3; }
  else if (time >= rate.downAt || rate.held) { rate.hz = want; rate.downAt = time + 0.3; }
  if (rate.hz > rate.peak) rate.peak = rate.hz;
  return rate;
}
