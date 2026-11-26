/*
 * Hourglass sand lab (GPL-3.0 project): the GPU's pace in the live frame loop.
 *
 * A frame is submitted only while fewer than S.queue frames of GPU work are in
 * flight (onSubmittedWorkDone counts them back); an animation frame that finds the
 * GPU still busy is skipped. The substeps a frame may run (the budget) follow that
 * back-pressure, not a timing: each frame drawn after a skipped one cuts the budget
 * by 15 %; every second frame drawn with none skipped raises it a tenth while the
 * budget (or the rate it allows) is what holds the sand back, but for 2 s after a cut
 * no nearer than 0.9 of the frame that the GPU could not keep up with. A cut never goes below
 * the base rate's real-time need (its substeps in one display frame) unless frames
 * keep being skipped there (over 15 % of the last 30 or so): a GPU that cannot even
 * give that much then draws more often, each frame with less sand time. The budget is
 * substeps a frame, so when the time between frames drawn changes (calm draws every other
 * frame, a display changes its rate) it is scaled with it (paceFrame): what the back-pressure
 * found is the GPU's substeps a second.
 *
 * Why not the submit-to-done time: on an iPhone measured at 5cc11b3 (30 Hz display) a
 * frame of 48 substeps and one of 47 on a larger bed both reported 31 ms, where the
 * real-speed rows put their work at 17 and 26 ms. A light frame reports about one
 * display frame whatever its work (the GPU's clock drops under light load, or the
 * completion comes at the refresh). A budget set from ms / substeps then shrinks
 * frame after frame, and 9b0a9f1's fell to 1 substep a frame: sim/real 0.03 to 0.08
 * in a model of the phone (tools/test/lab-pace.test.js keeps that rule as its
 * control). Back-pressure needs no timing: it cuts only when the GPU really is
 * behind.
 *
 * Pure functions on a plain state object, so that the Node test runs the very code
 * the page runs.
 */

/** Frames of GPU work in flight by default: 2 (with 1, a browser that reports work
 * done only at the next refresh would skip every other frame). */
export const QUEUE_DEFAULT = 2;
const CUT = 0.85, RAISE = 0.1, RAISE_AFTER = 2, CEIL_MS = 2000, SKIP_AVG = 1 / 30, SKIP_MANY = 0.15;

export function newPace() {
  return { inflight: 0, seq: 0, doneSeq: 0, valveSeq: 0, tSub: 0, log: [], budget: Infinity, msStep: NaN, overran: 0, peakInflight: 0,
    lastSkip: -1e9, skipsSince: 0, clean: 0, lastClean: -1e9, cuts: 0, raises: 0, binding: false, minBudget: Infinity,
    ceil: Infinity, ceilUntil: 0, skipShare: 0, frameT: 0 };
}
/** After a Reset or a change of setup: forget what was learnt (the frames in flight stay counted). */
export function paceReset(p) {
  Object.assign(p, { log: [], budget: Infinity, msStep: NaN, overran: 0, peakInflight: p.inflight, skipsSince: 0, clean: 0,
    lastClean: -1e9, cuts: 0, raises: 0, binding: false, minBudget: Infinity, ceil: Infinity, ceilUntil: 0, skipShare: 0 });
}
/**
 * The time between frames drawn is T ms now (calm: two display frames). The budget and its
 * ceiling are substeps a frame, learnt at the frame time before: scaled by the change. A change
 * under 20 % (the display's own jitter) is ignored. Without this, calm's first frames ran full's
 * budget (9, 10, 10, 11, ... substeps for the 16 calm needs on a phone held near 540 Hz).
 */
export function paceFrame(p, T) {
  if (!(T > 0)) return;
  if (p.frameT > 0 && Math.abs(T / p.frameT - 1) <= 0.2) return;
  if (p.frameT > 0) {
    const k = T / p.frameT;
    if (Number.isFinite(p.budget)) p.budget = Math.max(1, Math.round(p.budget * k));
    if (Number.isFinite(p.ceil)) p.ceil = Math.max(1, Math.round(p.ceil * k));
  }
  p.frameT = T;
}
/** An animation frame was skipped: the GPU had not finished the frames in flight. */
export function paceSkip(p, now) { p.lastSkip = now; p.skipsSince++; p.skipShare += (1 - p.skipShare) * SKIP_AVG; }
/**
 * Before a frame is drawn: set the substeps it may run (p.budget; Infinity: no limit yet).
 * need: the base rate's substeps in one display frame; top: the most a frame could want;
 * last: the substeps of the frame before (the budget's start when it has none).
 */
export function paceBudget(p, { now, need, top, last }) {
  need = Math.max(1, Math.min(top, need));
  p.skipShare *= 1 - SKIP_AVG;               // the share of animation frames skipped, over about 30 of them
  if (p.skipsSince > 0) {
    // back-pressure: cut, but not below the base rate's need unless frames keep being skipped
    // there (over 15 % of the last 30 or so): a GPU that cannot give even that draws more often
    const lo = p.skipShare > SKIP_MANY ? 1 : need;
    const b = Number.isFinite(p.budget) ? p.budget : Math.max(1, last || need);
    p.budget = Math.max(Math.min(lo, b), Math.floor(CUT * b));
    // the level the GPU could not keep up with: no nearer than 0.9 of it for 2 s (fewer skips)
    p.ceil = Math.max(1, last || b); p.ceilUntil = now + CEIL_MS;
    p.skipsSince = 0; p.clean = 0; p.cuts++;
  } else {
    p.lastClean = now;
    if (Number.isFinite(p.budget) && p.binding && ++p.clean >= RAISE_AFTER) {
      const lid = now < p.ceilUntil ? Math.max(p.budget, Math.floor(0.9 * p.ceil)) : top;
      const nb = Math.min(top, lid, p.budget + Math.max(1, Math.ceil(RAISE * p.budget)));
      if (nb > p.budget) p.raises++;
      p.budget = nb; p.clean = 0;
    }
  }
  if (Number.isFinite(p.budget)) { p.budget = Math.max(1, Math.min(top, p.budget)); p.minBudget = Math.min(p.minBudget, p.budget); }
  return p.budget;
}
/** A frame of steps substeps is submitted at now: its sequence number. */
export function paceSubmit(p, now) {
  p.seq++; p.inflight++; p.tSub = now; p.peakInflight = Math.max(p.peakInflight, p.inflight);
  return p.seq;
}
/**
 * The frame seq is done, ms after it was submitted. Returns false for a frame the 3-s valve
 * already let go (its count was cleared then). The statistics: GPU ms a substep over the last
 * 8 frames (submit-to-done over substeps, so an upper bound: it includes the frame's drawing,
 * and with 2 in flight the wait for the frame before), and frames that overran T.
 */
export function paceDone(p, seq, steps, ms, T) {
  if (seq <= p.valveSeq) return false;
  p.inflight = Math.max(0, p.inflight - 1);
  p.doneSeq = Math.max(p.doneSeq, seq);
  if (!steps) return true;
  p.log.push({ steps, ms }); if (p.log.length > 8) p.log.shift();
  p.msStep = p.log.reduce((s, x) => s + x.ms, 0) / p.log.reduce((s, x) => s + x.steps, 0);
  if (ms > 1.2 * T) p.overran++;
  return true;
}
/** No word of the work done for 3 s (a lost device): let the loop go on. */
export function paceValve(p, now) {
  if (p.inflight && now - p.tSub > 3000) { p.valveSeq = p.seq; p.inflight = 0; return true; }
  return false;
}
/**
 * Auto Hz under the budget: the highest of rates (the rungs, rising) at or below want that
 * the GPU allows (hzCap: substeps a second). The rate in use (hz) or a lower rung may be
 * kept up to the cap; rising past hz needs 10 % room under it and no drop forced by the cap
 * in the last 0.3 s (p.capUntil, wall ms), so the rate does not hop between rungs as the
 * budget moves (each rise rescales the sand's stored strain). Returns { want, held }: held is
 * the rung the sand wanted when the cap held it lower (0 otherwise).
 */
export function capRate(p, { rates, want, hz, hzCap, now }) {
  if (!Number.isFinite(hzCap)) return { want, held: 0 };
  const ok = h => h <= hz ? h <= hzCap : h <= 0.9 * hzCap && now >= (p.capUntil || 0);
  if (ok(want)) return { want, held: 0 };
  const w = rates.filter(h => h <= want && ok(h)).pop() ?? rates[0];
  if (w >= want) return { want, held: 0 };
  if (w < hz) p.capUntil = now + 300;
  return { want: w, held: want };
}
