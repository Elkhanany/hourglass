/*
 * Hourglass sand engine: the valve. The ledger of the sand above the neck, kept in the app's
 * whole grains, and the controller that meters the GPU's neck once a frame. Pure JavaScript:
 * no GPU, no DOM, no timers; everything comes in through the calls below.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 *
 * ==============================================================================================
 *  THE NECK ON THE GPU (what the valve drives; solver.mjs and the shaders build it)
 * ==============================================================================================
 * The counting line is grid y = neckY = cy (tally.wgsl counts a point exactly on it as below).
 * Drain is always toward -y: at a swap the next run re-indexes the points (the flip pass), so
 * "above" on the GPU is always the ledger's top bulb once that run has run.
 *  - throttle (gridUpdate.wgsl): nodes with |x - cx| < rn + 3 and neckY <= y < neckY + 2.5 may
 *    move down no faster than vcap cells/s of simulated time; nodes just below the line may not
 *    move up. It keeps a small queue of points resting on the line.
 *  - membrane (g2p2g.wgsl, last iteration): a point that would cross the line downward takes a
 *    ticket, t = atomicAdd(&counters[2], 1), and may cross only if t < counters[3] + allow;
 *    refused, it gives the ticket back and stays on the line (counters[4] += 1). Upward
 *    crossings are refused (counters[5] += 1).
 *  So in every substep s of a run: above_s = counters[3] + appended - crossings_s >= target_s,
 *  whatever the CPU's latency, provided counters[3] + appended is the true count at the run's
 *  start. The ledger below guarantees that.
 *
 * ==============================================================================================
 *  THE CONTRACT
 * ==============================================================================================
 *  const valve = new Valve({ ppg })     ppg: material points per app grain (4 s^2, s = solver
 *                                       cells per app cell; 1.69 on the phone's classic grain)
 *
 *  CPU events (the count in grains changes at once; the caller does the GPU side):
 *  fill(top, total[, pTop, pBottom]) -> { top, bottom }
 *      A new bed (reset, a new glass, an unseen turn, a handover, a timed-out transfer). Returns
 *      the points to upload above and below the line (default pointsFor(top), pointsFor(total -
 *      top)); pass pTop, pBottom when the data holds other counts. The upload is written in the
 *      ledger's orientation and writes tally[1] = pTop, tally[2] = pBottom (the counts of the
 *      data it uploads). Readbacks of earlier runs are dropped from now on.
 *  pour(n) -> { grains, points, mirrored }
 *      n grains poured. Append `points` points at the far end of the top bulb. When `mirrored`
 *      (a swap is waiting for its flip pass) write them at 2c - p, in the GPU's present
 *      orientation, so the next run's flip pass carries them into the ledger's top. An append
 *      NEVER writes the tally: the points reach the membrane through `allow`.
 *  completeFlip()
 *      The swap (the app's swapEnds, tiltSwap): top = total - top at once. The next run carries
 *      the flip pass (run().flip).
 *  fastForward(n) -> n
 *      The app's catch-up, or the residue (residueDue): the count drops by n at once (taken to
 *      0, it reads 1 until the transfer is done), and a transfer is owed. Hold submits
 *      (no run()) until it is done: transferPlan(above) with the points above the line now, in
 *      the ledger's orientation (from readParticles; mirror them if flipPending), gives m, the
 *      points nearest the line to lay on the lower heap; upload the moved bed in the ledger's
 *      orientation, writing tally[1] and tally[2] from its data; then transferDone(above, below,
 *      target) with its exact counts and the app's targetTop now. A pour made meanwhile is in
 *      the ledger already: put its points into the upload. A timed-out transfer is a fill().
 *
 *  Once a frame, before the frame's run is encoded:
 *  plan(app) -> { closed, top, released }
 *      app = { now (wall ms), target (the app's targetTop, grains), gateOpen, deepRelease,
 *      relCap (grains a 120 Hz step, 0: none), flipping, gy, rem (ms left; 0 once the clock has
 *      reached 00:00.0), tailMs, steps (the app's 120 Hz steps this frame, for relCap) }.
 *      Sets the frame's count (nTop) and the neck's state. Call it every frame, also when the
 *      run is skipped or hidden work is held: the count follows the clock, not the GPU. (The app
 *      reads nTop after each of its 120 Hz steps: RealSand moves it to `top` over them.)
 *  run({ steps, now, simDt }) -> words
 *      The frame's run is being encoded, with `steps` substeps (simDt = steps / hz, simulated
 *      seconds). Not called when the run is skipped (the points appended meanwhile and the wall
 *      time carry to the next run). Returns:
 *        seq      hand it back with the run's readback
 *        flip     begin the encoder with the flip pass; then counters[3] = tally[2] (in a run
 *                 that re-indexes), else counters[3] = tally[1]; then clear counters[2, 4, 5, 6]
 *        vcap     uniform word 36 for every substep and iteration (cells/s of simulated time;
 *                 0 shut, VCAP_OPEN open; a closed run may keep a queue: see the controller)
 *        allow    Float32Array, uniform word 37 of substep s (an exact integer; ALLOW_SHUT when
 *                 the neck is closed)
 *        flags    uniform word 38: NECK_ON (bit 0, throttle bands and membrane)
 *        targets  Int32Array, the membrane's target in points at the end of each substep (for
 *                 the HUD and tests; the GPU does not need it), appended, closed, from, to (the
 *                 wall span the run stands for, ms)
 *  onReadback(seq, words)
 *      The run's readback: { above: tally[1], below: tally[2], queue: tally[8], brim: tally[10],
 *      crossings: counters[2], start: counters[3], refused: counters[4], upward: counters[5] }.
 *      above and below: points on each side of the line; queue: points with line < y < line +
 *      0.1 and |x - cx| < rn + 1 (resting on the line, ready to cross: the throttle band reaches
 *      down to the line, so sand higher up is still throttled; tally.wgsl QueueBand); brim: the
 *      highest y of a point above the line within 3 cells of the axis, grid cells x 16, 0 if
 *      none. above, below and queue are needed; brim feeds pourable(); the rest feed stats()
 *      and a check of the membrane's own arithmetic, start + appended - crossings === above.
 *      Counts are in the run's orientation (after its flip pass). A run with no readback (no
 *      slot, a failed map) needs no call.
 *
 *  Reading: nTop (grains above, what the app reads), total, points (points in the buffer),
 *  parity, flipPending, census(), stats(), audit() (the newest readback against the ledger;
 *  for an open run, what the membrane guarantees: with any crossing, no fewer points above than
 *  the run's lowest substep target; a target that rose above the sand with nothing crossed is
 *  not a fault),
 *  residueDue(now) (points stuck above after the end: move them by a transfer), stalled() (no
 *  readback for 60 runs: the engine has failed), pourable(n,
 *  { maxTotal, room, inlet }) (the grains of n that may be poured now: none at the brim, 4 cells
 *  below the top bulb's far end at grid y `inlet`; no more than maxTotal grains and the
 *  buffer's room in points allow).
 *
 *  A frame, in order (the lab's Timer, later RealSand, with the app's clock math):
 *    the clock ticks; pours (pour(n), then append the points); a swap (completeFlip()); the
 *    app's target and valve fields; a catch-up (fastForward, then hold runs until the transfer
 *    is done); plan(app); unless the run is skipped or held: w = run({ steps, now, simDt }), and
 *    the solver encodes w.flip, then substep s with words 36-38 = w.vcap, w.allow[s], w.flags;
 *    its readback, when it comes: onReadback(w.seq, words).
 *
 * ==============================================================================================
 *  UNITS
 * ==============================================================================================
 * Grains are the authority (the app's own count); points follow. Each epoch (a fill, a
 * transfer, a swap, a settled count) has an exact base: G0 grains are P0 points above the line.
 * A grain target becomes a point target by pT(g) = ceil(g P0 / G0) (0 for g <= 0), so pT(G0) =
 * P0 and pT(0) = 0. Points become grains only for a shortfall: conv(x) = ceil(x G0 / P0) for
 * x > 0, truncated toward 0 for x < 0. So while the neck is supplied the ledger reports the
 * app's own target exactly, at every grain setting. A pour of n grains appends pointsFor(total
 * + n) - pointsFor(total) points and moves the base, anchored at the membrane's present target
 * g_a: (G0, P0) := (g_a + n, pT(g_a) + points).
 *
 * ==============================================================================================
 *  THE LEDGER
 * ==============================================================================================
 *  - Each run keeps a record (seq, gen, epoch, parity, the index of the next CPU event, whether
 *    it offered tickets, its end target in points) until its readback is no longer needed.
 *  - CPU events (pours, swaps) are logged back to the oldest record. A readback is read in
 *    today's terms by replaying them (a pour adds to the bulb that was on top when it was
 *    poured; a swap exchanges the two); it is exact when no later run offered a ticket. One from
 *    before a fill or transfer (another gen) is dropped.
 *  - Closed neck (no tickets: gate shut, flipping, gy <= 0.7, a pending base, a transfer): the
 *    count moves only by CPU events. The first exact readback after the close settles it once:
 *    the bulb on top at the close holds g + conv(P - pT(g)) grains, g the last open target and P
 *    its exact points; then a new epoch starts from (count, P). A swap with no exact readback at
 *    hand makes the base pending: the neck stays shut until one arrives.
 *  - Open neck: nTop = gT + conv(est - pT(gT)), est = min(U, max(min(U, pT(gT)), pT(gT) +
 *    short)), gT the target, short the newest same-epoch readback's above less its run's end
 *    target (all of it for a run that offered no ticket; at the epoch's start, its own
 *    shortfall: 0, or a transfer's leftover), U that readback's above plus the points poured
 *    since. Supplied, nTop is the target; starved, it carries the shortfall. With relCap (after
 *    shaking) the target and the count fall at most ceil(relCap) a 120 Hz step.
 *  - The end: nTop reads 1, not 0, until a readback with no point above (and no pour or swap
 *    since) confirms it, so the app keeps the neck open until the last point is out.
 *  - released = max(0, previous - new): never negative.
 *
 * ==============================================================================================
 *  THE CONTROLLER (in run())
 * ==============================================================================================
 *  - Closed: allow ALLOW_SHUT, vcap 0; but shut with the gate (the settle, paused), upright,
 *    not turning, no swap waiting for its base or its flip pass, no transfer, sand above: the
 *    throttle keeps a queue on the line at the bulk formula's queue term, vcap = 4 (QSTAR -
 *    queue) / (kv r), kv not learnt, the queue from the newest readback of this bulb (the
 *    membrane refuses it all). With the queue empty when the neck opened (vcap 0 while shut),
 *    the first 0.5 s of a run were short by up to 11 points.
 *  - Targets: T_s rises or falls linearly over the run's substeps from the last run's end
 *    target pT(g_{k-1}) to pT(gT), reaching it in the last substep; in the run in which the
 *    clock reached 00:00.0 it reaches 0 in the substep that holds that moment (the run's
 *    substeps stand for its wall span, from the last run to now), so the last point leaves
 *    within one substep of 00:00.0.
 *  - Throttle: open in the tail (rem < tailMs + 0.3 s) and at the end (deepRelease); in the bulk
 *    vcap = max(0, 1.15 ff + 4 (QSTAR - queue) + 6 short) / (kv r), ff the clock's flow in
 *    points per wall second, the queue from the newest readback, short from the newest one of
 *    this epoch whose run offered tickets, r simulated over wall time. kv, the throttle's gain
 *    (points/s per cell/s), starts at KV0 (the estimate always does) and is learnt: x0.97 in a
 *    run whose newest readback was short with an empty queue, x1.01 when the queue is over
 *    2 QSTAR, kept within x4 of KV0. QSTAR is 8 points: at 6 (the first model's), the app's
 *    breathing (the target swings +-68 % of the rate, up to 4.6 Hz) left up to 1.2 % of runs a
 *    point or two short while the throttle, opening with a lag, caught up with a swing.
 *  - Below VCAP_DUTY the throttle is duty-cycled: VCAP_DUTY in a share vcap / VCAP_DUTY of the
 *    runs (an accumulator), shut in the others; the queue absorbs the bursts and the membrane
 *    meters them (the slowest rests need 0.027 cells/s, near float32 resolution a substep).
 */

export const KV0 = 20;              // throttle gain to start from, points/s per cell/s (measured 19-22)
export const QSTAR = 8;             // points the throttle keeps resting on the line
export const VCAP_OPEN = 1e9;       // word 36: open
export const VCAP_DUTY = 0.25;      // below this the throttle is duty-cycled, cells/s
export const ALLOW_SHUT = -1e9;     // word 37: no ticket
export const NECK_ON = 1;           // word 38, bit 0: throttle bands and membrane on
export const TAIL_LEAD_MS = 300;    // the throttle opens this long before the tail
const KEEP_TALLIES = 8;             // readbacks kept (the newest same-epoch one is looked for)
const KEEP_RECORDS = 64;            // records kept at most when readbacks stop coming
const WALL_MAX_MS = 250;            // a run stands for at most this much wall time (as the lab's dtReal)

/** Points for g grains: ceil(g ppg), 0 only for 0 grains. */
export function pointsFor(g, ppg) { return g > 0 ? Math.ceil(g * ppg - 1e-9) : 0; }

export class Valve {
  /** o: { ppg (points per grain, > 0), kv (the throttle gain to start from; KV0), qstar (QSTAR) } */
  constructor(o = {}) {
    if (!(o.ppg > 0)) throw new Error('Valve: ppg (points per grain) must be above 0');
    this.ppg = o.ppg;
    this.kv = o.kv > 0 ? o.kv : KV0;
    this.qstar = o.qstar > 0 ? o.qstar : QSTAR;
    this.gTotal = 0; this.gTop = 0; this.pTotal = 0;
    this.parity = 0;                // the ledger's: swaps mod 2
    this.gpuParity = 0;             // the GPU's orientation, after its last run or upload
    this.gen = 0;                   // fills and transfers
    this.epoch = 0;
    this.base = { G0: 0, P0: 0 };
    this.epochP0 = 0; this.epochPours = 0; this.refShort = 0;
    this.pending = false;           // a swap with no exact count: shut until a readback gives one
    this.xfer = null;               // a transfer owed or in progress
    this.anchor = null;             // the neck's state at its close, until settled
    this.appended = [0, 0];         // points appended since the last run, by the ledger's parity then
    this.recs = []; this.tallies = []; this.events = []; this.evN = 0; this.seq = 0;
    this.lastOpenT = 0;             // the membrane's present target, grains (the last open run's)
    this.endConfirmed = true;
    this.closed = true; this.prime = false; this.gT = 0; this.tail = false;
    this.prevNow = null; this.prevRem = 0; this.zeroAt = null; this.endAt = null;
    this.lastRunNow = null; this.lastCrossAt = -Infinity; this.duty = 0;
    this.unread = 0;                // runs since the last readback came
    this.pendingAt = null;          // when the pending base began (the frame's now)
    this.last = null;               // the last run's words
    this.n = { runs: 0, readbacks: 0, dropped: 0, settled: 0, settleMoves: 0, settleLate: 0, pendings: 0,
      transfers: 0, mismatches: 0, refused: 0, upward: 0 };
  }

  // ---- reading ------------------------------------------------------------------------------
  get nTop() { return this.gTop; }
  get total() { return this.gTotal; }
  get points() { return this.pTotal; }
  /** A swap is waiting for its flip pass: appends go mirrored. */
  get flipPending() { return this.gpuParity !== this.parity; }
  census() { return { total: this.gTotal, top: this.gTop }; }

  // ---- units ----------------------------------------------------------------------------------
  Pts(g) { return pointsFor(g, this.ppg); }
  pT(g, b = this.base) { return g <= 0 || b.G0 <= 0 ? 0 : Math.ceil(g * b.P0 / b.G0 - 1e-9); }
  conv(x, b = this.base) {
    if (!x || b.P0 <= 0 || b.G0 <= 0) return 0;
    return x > 0 ? Math.ceil(x * b.G0 / b.P0 - 1e-9) : -Math.floor(-x * b.G0 / b.P0 + 1e-9);
  }
  /** A new epoch: P0 points (exact) are G0 grains above; gRef the target the shortfall is from. */
  newEpoch(G0, P0, gRef = G0) {
    this.base = { G0, P0 };
    this.epoch++; this.pending = false;
    this.epochP0 = P0; this.epochPours = 0;
    this.lastOpenT = Math.max(0, Math.min(G0, gRef));
    this.refShort = Math.max(0, P0 - this.pT(this.lastOpenT));
  }
  ev(type, n = 0) { this.events.push({ idx: this.evN++, type, n, parity: this.parity }); }
  rec(seq) { for (let i = this.recs.length - 1; i >= 0; i--) if (this.recs[i].seq === seq) return this.recs[i]; return null; }
  newAnchor() {
    return { parity: this.parity, g: this.lastOpenT, pRef: this.pT(this.lastOpenT), est: this.gTop, base: this.base,
      settled: false, swapped: false };
  }

  // ---- CPU events -----------------------------------------------------------------------------
  fill(top, total, pTop, pBottom) {
    top = Math.max(0, Math.round(top)); total = Math.max(top, Math.round(total));
    if (pTop === undefined) pTop = this.Pts(top);
    if (pBottom === undefined) pBottom = this.Pts(total - top);
    this.gTotal = total; this.gTop = top; this.pTotal = pTop + pBottom;
    this.gen++; this.gpuParity = this.parity; this.appended = [0, 0];
    this.anchor = null; this.xfer = null; this.zeroAt = null; this.endAt = null; this.lastRunNow = null;
    this.tallies = []; this.duty = 0;
    this.newEpoch(top, pTop);
    this.endConfirmed = pTop === 0;
    return { top: pTop, bottom: pBottom };
  }

  pour(n) {
    n = Math.max(0, Math.floor(n));
    if (!n) return { grains: 0, points: 0, mirrored: this.flipPending };
    const nP = this.Pts(this.gTotal + n) - this.Pts(this.gTotal), A = this.anchor;
    if (this.xfer || this.pending) {
      // the transfer's upload, or the readback that ends the pending base, counts these points
    } else if (A && (A.settled || A.parity !== this.parity)) {
      // closed with an exact base for the bulb on top: it stays exact
      this.base = { G0: this.base.G0 + n, P0: this.base.P0 + nP };
    } else {
      // open, or closed with the same bulb on top and not yet settled: anchored at the
      // membrane's present target, so a shortfall is kept
      const ga = this.lastOpenT;
      this.base = { G0: ga + n, P0: this.pT(ga) + nP };
      this.lastOpenT = ga + n;
      if (A) { A.g += n; A.pRef += nP; A.est += n; A.base = this.base; }
    }
    this.epochPours += nP;
    this.gTotal += n; this.gTop += n; this.pTotal += nP;
    this.appended[this.parity] += nP;
    if (nP) this.endConfirmed = false;
    this.ev('pour', nP);
    return { grains: n, points: nP, mirrored: this.flipPending };
  }

  completeFlip() {
    if (!this.anchor && !this.xfer) this.anchor = this.newAnchor();
    this.gTop = this.gTotal - this.gTop; this.parity ^= 1;
    if (this.anchor && !this.anchor.settled) this.anchor.swapped = true;
    this.ev('swap');
    const ex = this.xfer ? null : this.exactNow();
    if (ex) { this.newEpoch(this.gTop, ex[0]); this.endConfirmed = ex[0] === 0; }
    else { if (!this.pending) this.pendingAt = this.prevNow; this.pending = true; this.epoch++; this.n.pendings++; this.endConfirmed = false; }
  }

  fastForward(n) {
    const held = this.xfer ? this.xfer.hold : 0;     // a transfer already owed takes this one too
    n = Math.max(0, Math.min(Math.floor(n), this.gTop - held));
    if (!n) return 0;
    this.gTop -= n + held; this.gen++; this.tallies = [];
    // taken to 0 (the residue), the count reads 1 until the transfer has moved the last points
    this.xfer = { n: n + (this.xfer ? this.xfer.n : 0), hold: this.gTop === 0 ? 1 : 0 }; this.gTop += this.xfer.hold;
    this.anchor = null; this.endConfirmed = false;
    return n;
  }
  /** The transfer: points to move from the top bulb (nearest the line) to the lower heap. */
  transferPlan(above) {
    return Math.max(0, Math.min(above, above - this.pT(this.gTop - (this.xfer ? this.xfer.hold : 0))));
  }
  /** The moved bed is uploaded: its exact counts (the ledger's orientation) and the app's target. */
  transferDone(above, below, target) {
    if (this.xfer) this.gTop -= this.xfer.hold;
    this.pTotal = above + below; this.gpuParity = this.parity; this.appended = [0, 0];
    this.gen++; this.tallies = []; this.xfer = null; this.anchor = null; this.lastRunNow = null;
    this.newEpoch(this.gTop, above, target === undefined ? this.gTop : Math.max(0, Math.floor(target)));
    this.endConfirmed = above === 0;
    this.n.transfers++;
  }

  // ---- readbacks ------------------------------------------------------------------------------
  /** A readback in today's terms, [above, below] in the ledger's parity; null when not exact. */
  exactFrom(k) {
    const r = this.rec(k.seq);
    if (!r || r.gen !== this.gen) return null;
    for (const x of this.recs) if (x.seq > k.seq && x.open) return null;
    return this.replay(k, r);
  }
  replay(k, r) {
    let a = k.above, b = k.below, o = r.parity;
    for (const e of this.events) {
      if (e.idx < r.evN) continue;
      if (e.type === 'pour') { if (e.parity === o) a += e.n; else b += e.n; }
      else if (e.type === 'swap') { const t = a; a = b; b = t; o ^= 1; }
    }
    return [a, b];
  }
  exactNow() { const k = this.tallies[this.tallies.length - 1]; return k ? this.exactFrom(k) : null; }

  onReadback(seq, w) {
    this.n.readbacks++; this.unread = 0;
    const r = this.rec(seq);
    if (!r || r.gen !== this.gen || r.read) { this.n.dropped++; return false; }
    r.read = true;
    const k = { seq, above: w.above, below: w.below, queue: w.queue || 0, brim: w.brim || 0, crossings: w.crossings, refused: w.refused || 0 };
    if (w.start !== undefined && w.crossings !== undefined && w.start + r.appended - w.crossings !== w.above) this.n.mismatches++;
    this.n.refused += w.refused || 0; this.n.upward += w.upward || 0;
    if (w.crossings > 0) this.lastCrossAt = r.to;
    this.tallies.push(k);
    if (this.tallies.length > 1 && seq < this.tallies[this.tallies.length - 2].seq) this.tallies.sort((a, b) => a.seq - b.seq);
    if (this.tallies.length > KEEP_TALLIES) this.tallies.shift();
    while (this.recs.length && this.recs[0].seq < this.tallies[0].seq) this.recs.shift();
    const keep = this.recs.length ? this.recs[0].evN : this.evN;
    while (this.events.length && this.events[0].idx < keep) this.events.shift();
    // the end: no point above, and nothing poured or turned since (upward crossings are refused)
    if (k.above === 0 && !this.events.some(e => e.idx >= r.evN)) this.endConfirmed = true;
    // a closed neck settles once, from the first exact readback after the close
    const A = this.anchor;
    if (A && !A.settled) {
      const ex = this.exactFrom(k);
      if (ex) {
        const same = this.parity === A.parity, pX = same ? ex[0] : ex[1];
        const gX = Math.max(0, A.g + this.conv(pX - A.pRef, A.base)), d = gX - A.est;
        if (d) {
          this.gTop = Math.max(0, Math.min(this.gTotal, this.gTop + (same ? d : -d)));
          this.n.settleMoves++;
          if (A.swapped) this.n.settleLate += Math.abs(d);
        }
        A.settled = true; this.n.settled++;
        this.newEpoch(this.gTop, ex[0]);
        this.endConfirmed = ex[0] === 0;
      }
    }
    if (this.pending) { const ex = this.exactFrom(k); if (ex) { this.newEpoch(this.gTop, ex[0]); this.endConfirmed = ex[0] === 0; } }
    return true;
  }

  // ---- once a frame -------------------------------------------------------------------------
  /** The open count for target gT (grains): the target, plus the newest shortfall. */
  openTop(gT) {
    let short = this.refShort, upper = this.epochP0 + this.epochPours;
    for (let i = this.tallies.length - 1; i >= 0; i--) {
      const k = this.tallies[i], r = this.rec(k.seq);
      if (!r || r.gen !== this.gen || r.epoch !== this.epoch) continue;
      short = r.pTend >= 0 ? Math.max(0, k.above - r.pTend) : Infinity;
      let a = k.above;
      for (const e of this.events) if (e.idx >= r.evN && e.type === 'pour') a += e.n;
      upper = a; break;
    }
    const pt = this.pT(gT), est = Math.min(upper, Math.max(Math.min(upper, pt), pt + short));
    let g = gT + this.conv(est - pt);
    if (g <= 0 && !this.endConfirmed) g = 1;
    return Math.max(0, Math.min(this.gTotal, g));
  }

  plan(app) {
    const now = +app.now || 0, rem = app.rem === undefined ? Infinity : app.rem;
    // the moment the clock reached 00:00.0, for the run that stands for it
    if (this.prevNow !== null && this.prevRem > 0 && rem <= 0) this.zeroAt = this.endAt = Math.min(now, this.prevNow + this.prevRem);
    // the clock has time again (a Flip or a start after the end, a pour, the next phase of a
    // sequence): the old end and its crossings say nothing of this run's end
    if (rem > 0) { this.zeroAt = null; this.endAt = null; this.lastCrossAt = -Infinity; }
    this.prevNow = now; this.prevRem = rem;
    const before = this.gTop, gy = app.gy === undefined ? 1 : app.gy;
    const closed = !app.gateOpen || !!app.flipping || !(gy > 0.7) || this.pending || !!this.xfer;
    if (this.xfer) {
      // the count waits for the transfer
    } else if (closed) {
      if (!this.anchor) this.anchor = this.newAnchor();
    } else {
      if (this.anchor) { if (this.anchor.settled) this.lastOpenT = this.gTop; this.anchor = null; }
      // relCap (after shaking): the target, and the count, fall at most relCap a 120 Hz step, so a
      // backlog leaves as a thicker thread (a readback showing less sand is reported over frames)
      let gT = Math.max(0, Math.floor(app.target)), floor = 0;
      if (app.relCap > 0) floor = Math.max(0, this.gTop - Math.ceil(app.relCap) * Math.max(1, app.steps === undefined ? 2 : app.steps));
      this.gT = Math.min(Math.max(gT, floor), this.gTotal);
      this.gTop = Math.max(this.openTop(this.gT), floor);
    }
    this.closed = closed;
    // shut with nothing pending, upright and not turning (the settle, paused): the throttle may
    // keep a queue on the line, refused by the membrane, so the stream starts on time
    this.prime = closed && !app.gateOpen && !app.flipping && gy > 0.7 && !this.pending && !this.xfer && this.gTop > 0;
    this.tail = !!app.deepRelease || rem < (app.tailMs || 0) + TAIL_LEAD_MS;
    return { closed, top: this.gTop, released: Math.max(0, before - this.gTop) };
  }

  run(o = {}) {
    const S = Math.max(0, Math.floor(o.steps || 0)), n = Math.max(1, S);
    const now = o.now === undefined ? (this.prevNow || 0) : +o.now;
    const w0 = this.lastRunNow === null ? now - 1000 / 60 : Math.max(this.lastRunNow, now - WALL_MAX_MS);
    const span = Math.max(1e-3, now - w0);
    const flip = this.flipPending, closed = this.closed || this.pending || !!this.xfer;
    const appended = this.appended[this.parity];
    const allow = new Float32Array(n), targets = new Int32Array(n);
    let vcap = 0, pTend = -1, pTmin = -1, offered = false;
    if (closed) {
      allow.fill(ALLOW_SHUT); targets.fill(-1);
      if (this.prime && !flip && S) vcap = this.primeVcap(span, o.simDt === undefined ? span / 1000 : o.simDt);
    }
    else {
      const t0 = this.pT(this.lastOpenT), t1 = this.pT(this.gT);
      if (!S) { pTend = pTmin = t0; targets[0] = t0; allow[0] = appended - t0; }
      else {
        const z = this.zeroAt !== null && this.zeroAt <= now ? this.zeroAt : null;
        for (let s = 0; s < S; s++) {
          let T;
          if (z !== null) {
            const ws = w0 + span * (s + 1) / S;
            T = ws >= z ? t1 : Math.ceil(t1 + (t0 - t1) * (z - ws) / Math.max(1e-6, z - w0) - 1e-9);
          } else T = Math.ceil(t0 + (t1 - t0) * (s + 1) / S - 1e-9);
          targets[s] = T; allow[s] = appended - T;
        }
        pTend = targets[S - 1]; pTmin = Math.min(...targets); offered = true;
        vcap = this.throttle(t0, t1, span, o.simDt === undefined ? span / 1000 : o.simDt);
        this.lastOpenT = this.gT;
      }
    }
    // (a run of 0 substeps stands for no time: its span, and the moment of 00:00.0 if it holds
    // it, carry to the next run, as the lab's loop carries the time to the next frame)
    if (S && this.zeroAt !== null && this.zeroAt <= now) this.zeroAt = null;
    const r = { seq: ++this.seq, gen: this.gen, epoch: this.epoch, parity: this.parity, evN: this.evN, open: offered,
      pTend, pTmin, appended, vcap, to: now, read: false };
    this.recs.push(r);
    if (this.recs.length > KEEP_RECORDS) {
      // (readbacks have stopped: a record dropped, its events too, so neither grows without bound)
      this.recs.shift();
      while (this.events.length && this.events[0].idx < this.recs[0].evN) this.events.shift();
    }
    this.gpuParity = this.parity; this.appended = [0, 0];
    if (S) this.lastRunNow = now;
    this.n.runs++; this.unread++;
    return this.last = { seq: r.seq, flip, vcap, allow, flags: NECK_ON, targets, appended, steps: S, closed, from: w0, to: now };
  }

  /** vcap for an open run in the bulk; t0, t1 its start and end targets in points. */
  throttle(t0, t1, spanMs, simDt) {
    if (this.tail) { this.duty = 0; return VCAP_OPEN; }
    // the queue from the newest readback; the shortfall from the newest one of this epoch whose
    // run offered tickets (one that offered none says nothing of the throttle), else the epoch's own
    let short = this.refShort, queue = -1;
    for (let i = this.tallies.length - 1; i >= 0; i--) {
      const k = this.tallies[i], r = this.rec(k.seq);
      if (!r || r.gen !== this.gen) continue;
      if (queue < 0) queue = k.queue;
      if (r.epoch !== this.epoch) break;
      if (!r.open) continue;
      short = Math.max(0, k.above - r.pTend); break;
    }
    if (queue < 0) queue = 0;
    const wall = spanMs / 1000, ff = Math.max(0, t0 - t1) / wall, ratio = simDt > 0 ? simDt / wall : 1;
    let v = Math.max(0, 1.15 * ff + 4 * (this.qstar - queue) + 6 * short) / (this.kv * ratio);
    if (short > 0 && queue === 0) this.kv = Math.max(KV0 / 4, this.kv * 0.97);
    else if (queue > 2 * this.qstar) this.kv = Math.min(KV0 * 4, this.kv * 1.01);
    if (v < VCAP_DUTY) {
      this.duty += v / VCAP_DUTY;
      if (this.duty >= 1) { this.duty -= 1; v = VCAP_DUTY; } else v = 0;
    } else this.duty = 0;
    return v;
  }

  /**
   * vcap for a shut neck that is primed: the bulk formula's queue term only (no flow, no
   * shortfall, kv not learnt), from the newest readback of this bulb (none: an empty queue).
   */
  primeVcap(spanMs, simDt) {
    let queue = 0;
    for (let i = this.tallies.length - 1; i >= 0; i--) {
      const k = this.tallies[i], r = this.rec(k.seq);
      if (!r || r.gen !== this.gen) continue;
      if (r.parity === this.parity) queue = k.queue;
      break;
    }
    const ratio = simDt > 0 ? simDt / (spanMs / 1000) : 1;
    let v = Math.max(0, 4 * (this.qstar - queue)) / (this.kv * ratio);
    if (v < VCAP_DUTY) {
      this.duty += v / VCAP_DUTY;
      if (this.duty >= 1) { this.duty -= 1; v = VCAP_DUTY; } else v = 0;
    } else this.duty = 0;
    return v;
  }

  /**
   * Points stuck above after the end (on the funnel's wall): done and draining with the count
   * above 0, the clock still at 00:00.0, no crossing for 0.5 s and 1.5 s after it (the end is
   * forgotten once the clock has time again). Move them by a transfer:
   * fastForward(nTop), then transferPlan / transferDone as for the catch-up.
   */
  residueDue(now) {
    return this.endAt !== null && this.prevRem <= 0 && !this.xfer && !this.closed && this.tail && this.gTop > 0 &&
      now - this.endAt >= 1500 && now - Math.max(this.lastCrossAt, this.endAt) >= 500;
  }

  /**
   * The top bulb is at its brim: the newest readback of this bulb (none since a swap: not known
   * yet) has a point near the axis within `margin` cells of its far end, grid y `inlet`. A pour
   * raises the bed about 2 rows a second and a readback is 1-3 frames old, so 4 cells is ample.
   */
  atBrim(inlet, margin = 4) {
    for (let i = this.tallies.length - 1; i >= 0; i--) {
      const k = this.tallies[i], r = this.rec(k.seq);
      if (!r || r.gen !== this.gen) continue;
      return r.parity === this.parity && k.brim > 0 && k.brim / 16 >= inlet - margin;
    }
    return false;
  }
  /** Grains of n that may be poured now (see the contract). */
  pourable(n, o = {}) {
    if (o.inlet !== undefined && this.atBrim(o.inlet, o.margin)) return 0;
    n = Math.max(0, Math.min(Math.floor(n), (o.maxTotal === undefined ? Infinity : o.maxTotal) - this.gTotal));
    if (o.room !== undefined) {
      const p0 = this.Pts(this.gTotal);
      n = Math.min(n, Math.max(0, Math.floor((o.room + p0) / this.ppg) - this.gTotal + 1));
      while (n > 0 && this.Pts(this.gTotal + n) - p0 > o.room) n--;
    }
    return n;
  }

  /**
   * No readback has come for `runs` runs in a row (60: about a second of frames): a failing
   * mapAsync, a lost device. Without readbacks a swap's base stays pending (the neck shut for
   * good) and the end is never confirmed, so the driver treats this as the engine failing (design
   * 7.9: the current sand takes over; the lab's Timer says so).
   */
  stalled(runs = 60) { return this.unread >= runs; }

  /** The newest readback against the ledger (tests, the HUD): totals, and the count when closed. */
  audit() {
    const k = this.tallies[this.tallies.length - 1];
    if (!k) return null;
    const r = this.rec(k.seq);
    if (!r || r.gen !== this.gen) return null;
    const now = this.replay(k, r), total = now[0] + now[1], ex = this.exactFrom(k);
    let above = null, expect = null, ok = total === this.pTotal;
    if (ex && this.anchor && this.anchor.settled && !this.pending && !this.xfer) { above = ex[0]; expect = this.pT(this.gTop); ok = ok && above === expect; }
    else if (r.open) {
      // the membrane: the last point that crossed left at least that substep's target above, so
      // with any crossing the run ends with no fewer than its lowest target; with none (a target
      // that rose above the sand: the breathing, a re-time) there is nothing to check
      above = k.above; expect = r.pTend;
      ok = ok && (k.crossings === 0 || above >= r.pTmin);
    }
    return { ok, seq: k.seq, epoch: this.epoch, total, points: this.pTotal, above, expect };
  }

  stats() {
    const k = this.tallies[this.tallies.length - 1], r = k && this.rec(k.seq);
    return Object.assign({
      top: this.gTop, total: this.gTotal, points: this.pTotal, epoch: this.epoch, gen: this.gen, parity: this.parity,
      closed: this.closed, pending: this.pending, transfer: !!this.xfer, kv: this.kv, vcap: this.last ? this.last.vcap : 0,
      queue: k ? k.queue : 0, short: k && r && r.open ? k.above - r.pTend : 0, records: this.recs.length, events: this.events.length,
      unread: this.unread, pendingMs: this.pending && this.pendingAt !== null && this.prevNow !== null ? this.prevNow - this.pendingAt : 0
    }, this.n);
  }
}
