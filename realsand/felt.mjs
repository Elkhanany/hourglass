/*
 * Hourglass sand engine: the glass's own acceleration, as the sand feels it.
 *
 * What comes in is the felt: the glass's linear acceleration reversed (the glass accelerating one
 * way pushes its sand the other), in g, page axes, y down. The sand's floor is where its gravity
 * points, on the page at the angle psi (gravity along (sin psi, cos psi): 0 upright, about pi/2
 * with the phone on its side, pi upside down after a turn-over): a push along the floor slides a
 * bed, one against gravity lifts it off the floor, one with gravity presses it in. At real speed
 * the felt is felt as it is, smoothed over ACC_TAU.
 *
 * At app speed the world runs slowed: gravity, and with it every force, is scaled by lambda
 * (about 0.08), so a fall takes 1 / sqrt(lambda) (about 3.5) times longer than real. A push of
 * the glass scaled the same way but lasting its real time T gives a bed sliding on it lambda a T
 * of speed, where a slowed film of the real event gives it sqrt(lambda) a T: felt as it is, a
 * flick barely moves the sand (0.2 cells). How the push is played back is the mode (opt.mode):
 *
 *  live (the default): the sand moves the moment the glass does. Taken in the bed's own frame
 *    (psi), a resting bed slides only on the part of a push along its floor beyond its friction,
 *    tan of its friction angle (opt.knee: 0.60 g for coarse sand, from the material). That part
 *    is multiplied by 1 / sqrt(lambda), so a bed sliding on it gains the film's speed in the
 *    push's real time; everything below it (the hand's jitter, handling, a lean) is felt exactly
 *    as it is, and so is all of a push off the floor or into it (opt.lift and opt.press, the
 *    knees there, are Infinity: see Tried and left). The result is capped at opt.cap (2 g) on
 *    each axis, never below the hand's own acceleration on that axis (a hard shake keeps its own
 *    peaks, as the film did); the impulse beyond the cap is owed in a reservoir (one signed
 *    number an axis) and paid in the next substeps up to the cap. The reservoir never holds more
 *    than the cap pays in opt.hold (0.15 s), so a push held far beyond the cap (a phone swung
 *    round at arm's length, 10 g for seconds) is not felt for seconds after the hand stops.
 *    What it gives up: the film's path for a lone jerk. Real speed (true g, the engine's own
 *    physics) throws the bed against the trailing wall and the stop throws it on to the leading
 *    one, and the film keeps that path, slowed; live gives the bed the film's speed but for the
 *    push's real time, so it slides about a third as far, short of the wall, and the stop, as
 *    prompt as the hand's, ends its slide. Slow motion (below) keeps the film's path for a bump
 *    to a glass held still. Measured on the GPU sand at app speed (coarse sand, lambda 0.075),
 *    against the film: a 2 g flick through motion.js first moves the bed 42 ms after the hand
 *    (the film 108), fastest at 75 ms (175); a 1.5 g shake at 5 Hz along the floor leaves the
 *    sand moving 108 ms after the hand stops (542), and the sliding bed gets the film's own
 *    impulse (the film, held 0.5 s behind, gave it 35 %); a jerk tears a quarter glass's bed
 *    2.6 % at worst (9.0); a shake up and down (1.5 g at 5 Hz) heaps the bed as the film does
 *    (its top 13.7 cells up at most, the film 15.6). Without the cap the live playback splashed
 *    and tore the bed (holes 26 %).
 *  slowmo: a lone jolt as a slowed film (below), so that the sand answers it a moment late, as in
 *    a high-speed film; once the hand keeps moving while the film is SLOWMO.on (0.15 s) behind,
 *    live at once, with what the film had yet to play owed (so the push is not lost, as it was
 *    when the two were cross-faded: a move and stop then gave the sand the stop without most of
 *    the push), until the hand has been quiet SLOWMO.off (0.2 s); back to the film over
 *    SLOWMO.fade. Shaking, jitter and handling are never more than about 0.2 s late. Any motion
 *    over FILM_QUIET counts as moving, so the film is kept for a bump to a glass held still:
 *    through motion.js, a phone only handled is live 80 % of the time, one walking 97 %.
 *  film: the slowed film throughout, as Real sand played every push before it was live. The
 *    glass's acceleration is recorded each substep and played back slowed by sqrt(lambda): a
 *    jolt lasts T / sqrt(lambda), its peak against gravity is the real one, and a flick's push
 *    and its stop come as far apart as in the film, so the bed takes the path it takes at real
 *    speed, slowed. Quiet stretches (under FILM_QUIET) are played fast, so the playback catches
 *    up between jolts, and it never falls more than opt.lag (FILM_LAG, 0.5 s) behind. Its flaw,
 *    and the delay of about 0.5 s seen on a phone: any motion above FILM_QUIET keeps it from catching up,
 *    so under shaking, jitter or handling it plays the hand 0.5 s late, at its own pace and
 *    scaled like gravity, with about a third of the film's impulse; a flick's stop comes 0.25 to
 *    0.45 s after the hand's.
 *  plain: as it is, scaled like gravity (under Reduce Motion: the gentlest, and never late).
 *
 * Tried and left: everything multiplied by 1 / sqrt(lambda) (pushes below the friction too: the
 * jitter fizzed at twice the speed, a shake threw the bed up the walls, and a flick's stop threw
 * the sand back past the middle at once); a steady part split off with a high-pass filter (it
 * pushed the sand back after every jolt); the film held 0.12 s behind (still late, and weaker
 * still); a low-pass after the knee (a third of the impulse lost, 17 ms more lag); one knee on
 * the felt's length (a vertical shake threw the bed up in a column); a knee for lift at 1 g, its
 * excess at the film's speed, pressing as it is (it turned a shake up and down into a net lift
 * at the hand's 5 Hz, and on the GPU threw the bed up in a column, holes 52 %); the same with
 * pressing beyond 1 g played alike, so nothing is turned into a lift (still a column, holes
 * 59 %: the bed, flung at the film's speed five times a second, tears); the knees in page axes
 * (on its side the floor's push was played as lift and the push into it at the film's speed;
 * upside down, lift as pressing).
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */

export const ACC_TAU = 0.012;                 // s: the glass's acceleration as the sand feels it
export const FILM_QUIET = 0.04;               // g: a jolt weaker than this is skipped in the slowed playback
export const FILM_LAG = 0.5;                  // s: the slowed playback never falls further behind than this
const FILM_N = 8192;                          // substeps the film holds
/** The playbacks at app speed, the default first. */
export const JOLT_MODES = Object.freeze(['live', 'slowmo', 'film', 'plain']);
/**
 * The live playback: the knee along the floor (g: tan of coarse sand's 31 degrees); the knees off
 * the floor (lift) and into it (press), beyond which the push is played at the film's speed
 * (Infinity: never, the push off and into the floor is played as it is); the cap (g); the
 * reservoir's hold (s).
 */
export const LIVE = Object.freeze({ knee: Math.tan(31 * Math.PI / 180), lift: Infinity, press: Infinity, cap: 2, hold: 0.15 });
/** Slow motion: live once the film is this far behind while the hand moves (s), the film again after this long quiet (s), faded in over (s). */
export const SLOWMO = Object.freeze({ on: 0.15, off: 0.2, fade: 0.06 });

/** v held within -lo and +hi. */
function clamp(v, lo, hi) { return v < -lo ? -lo : (v > hi ? hi : v); }

/** The knee of a material (solver.mjs MATERIALS): tan of its friction angle, g (0 for a liquid). */
export function kneeOf(material) {
  const a = material && Number.isFinite(material.frictionAngle) ? material.frictionAngle : 0;
  return Math.tan(Math.max(0, Math.min(80, a)) * Math.PI / 180);
}

export class GlassFelt {
  /** opt: { mode (JOLT_MODES), knee, lift, press, cap, hold (the live playback), lag (the film's) }; this.opt may be changed later. */
  constructor(opt = {}) {
    this.opt = Object.assign({ mode: JOLT_MODES[0], knee: LIVE.knee, lift: LIVE.lift, press: LIVE.press, cap: LIVE.cap, hold: LIVE.hold, lag: FILM_LAG }, opt);
    // x1, y1: the acceleration smoothed over ACC_TAU; jx, jy: what the sand felt last (g)
    this.x1 = 0; this.y1 = 0; this.jx = 0; this.jy = 0;
    // the film: the smoothed acceleration recorded each substep (time t, x, y), w written, i the
    // sample at or before the play head tp
    this.film = { t: new Float64Array(FILM_N), x: new Float32Array(FILM_N), y: new Float32Array(FILM_N), w: 0, i: 0, tp: 0 };
    // the live playback's reservoir: the impulse beyond the cap still owed (g s, along the floor and
    // into it, in the bed's own frame)
    this.owed = [0, 0];
    // which way is down for the bed: gravity's angle on the page, psi (gravity along (sin psi, cos psi))
    this._c = 1; this._s = 0;
    // slow motion's hand-over: live now, the hand quiet for (s), live's share of what is felt
    this.sm = { live: false, quiet: 0, m: 0 };
    // s: how far behind the hand the sand's playback is (the film's play head; 0 when live)
    this.behind = 0;
    this._mode = null;
  }
  /** The glass at rest, the film empty, nothing owed; its play head at simulated time t. */
  reset(t = 0) {
    this.x1 = 0; this.y1 = 0; this.jx = 0; this.jy = 0;
    this._restart(t);
  }
  /** The film empty, its play head at simulated time t. */
  filmReset(t) { const film = this.film; film.w = 0; film.i = 0; film.tp = t; }
  _restart(t) {
    this.filmReset(t);
    this.owed[0] = 0; this.owed[1] = 0;
    this.sm.live = false; this.sm.quiet = 0; this.sm.m = 0; this.behind = 0;
  }
  /**
   * The felt (g, page axes, y down) as the sand feels it, for the substep of dt seconds starting
   * at simulated time t, given the felt ax, ay (g) now. slowed: the world runs slowed by lam (G / g,
   * the app's lambda; 1 at real speed) and the push is played back by opt.mode; otherwise it is
   * felt as it is (smoothed), and the film is cleared. psi: which way is down for the sand, the
   * angle of its gravity on the page (gravity along (sin psi, cos psi); 0: down the page, pi: the
   * phone upside down, +-pi/2: on its side); live playback takes its knees in that frame, so the
   * floor is the floor however the phone is held. Returns [x, y]; also kept in jx, jy.
   */
  feel(ax, ay, dt, t, slowed, lam, psi = 0) {
    psi = Number.isFinite(psi) ? psi : 0;
    this._c = Math.cos(psi); this._s = Math.sin(psi);
    const k1 = 1 - Math.exp(-dt / ACC_TAU);
    this.x1 += (ax - this.x1) * k1; this.y1 += (ay - this.y1) * k1;
    let jx = this.x1, jy = this.y1;
    const mode = slowed ? this.opt.mode : 'plain';
    // (another playback starts from now: no film behind, nothing owed)
    if (mode !== this._mode) { if (this._mode !== null) this._restart(t); this._mode = mode; }
    if (mode === 'film') {
      [jx, jy] = this._film(jx, jy, dt, t, lam, this.opt.lag);
    } else if (mode === 'live') {
      [jx, jy] = this._live(jx, jy, dt, lam);
      this.filmReset(t); this.behind = 0;
    } else if (mode === 'slowmo') {
      const S = this.sm, moving = Math.hypot(jx, jy) >= FILM_QUIET;
      S.quiet = moving ? 0 : S.quiet + dt;
      // live once the hand keeps moving while the film plays a jolt late; the film again once quiet
      // (going live, what the film has yet to play is owed, so the sand still gets all of the push)
      if (!S.live && moving && this.behind > SLOWMO.on) { S.live = true; this._oweFilm(lam); }
      else if (S.live && S.quiet >= SLOWMO.off) S.live = false;
      const f = this._film(jx, jy, dt, t, lam, S.live ? 0 : this.opt.lag), l = this._live(jx, jy, dt, lam);
      S.m = S.live ? 1 : Math.max(0, S.m - dt / SLOWMO.fade);
      jx = f[0] + (l[0] - f[0]) * S.m; jy = f[1] + (l[1] - f[1]) * S.m;
    } else { this.filmReset(t); this.behind = 0; }
    this.jx = jx; this.jy = jy;
    return [jx, jy];
  }

  /** The slowed film of the smoothed felt (jx, jy), its play head at most lag behind t: what the sand feels. */
  _film(jx, jy, dt, t, lam, lag) {
    const film = this.film, N = FILM_N;
    const j = film.w % N;
    film.t[j] = t; film.x[j] = jx; film.y[j] = jy; film.w++;
    if (film.w - film.i > N - 2) film.i = film.w - (N - 2);
    // the play head: slowed while it plays a jolt, fast over quiet stretches
    const at = tp => {
      while (film.i + 1 < film.w && film.t[(film.i + 1) % N] <= tp) film.i++;
      const a = film.i % N, b = (film.i + 1) % N;
      if (film.i + 1 >= film.w || film.t[b] <= film.t[a]) return [film.x[a], film.y[a]];
      const u = Math.min(1, Math.max(0, (tp - film.t[a]) / (film.t[b] - film.t[a])));
      return [film.x[a] + (film.x[b] - film.x[a]) * u, film.y[a] + (film.y[b] - film.y[a]) * u];
    };
    let p = at(film.tp);
    if (Math.hypot(p[0], p[1]) < FILM_QUIET) {
      // quiet: skip ahead to the next sample that is not (never over one: a jolt that changes
      // sign passes through zero, and its second half must still be played)
      while (film.i + 1 < film.w && Math.hypot(film.x[(film.i + 1) % N], film.y[(film.i + 1) % N]) < FILM_QUIET) film.i++;
      film.tp = Math.max(film.tp, film.i + 1 < film.w ? film.t[(film.i + 1) % N] : t);
    } else film.tp += dt * Math.sqrt(lam);
    film.tp = Math.min(t, Math.max(t - lag, film.tp));
    this.behind = t - film.tp;
    p = at(film.tp);
    return p;
  }

  /** Owed to the live playback: what the film has yet to play, from its play head to now, beyond the knees (g s, the bed's frame). */
  _oweFilm(lam) {
    const film = this.film, N = FILM_N, O = this.opt, gain = 1 / Math.sqrt(lam > 0 ? lam : 1), h = O.cap * O.hold, c = this._c, s = this._s;
    let ou = 0, ov = 0;
    for (let k = film.i; k + 1 < film.w; k++) {
      const a = k % N, d = film.t[(k + 1) % N] - Math.max(film.t[a], film.tp);
      if (!(d > 0)) continue;
      const u = film.x[a] * c - film.y[a] * s, v = film.x[a] * s + film.y[a] * c;
      ou += (u - clamp(u, O.knee, O.knee)) * gain * d;
      ov += (v - clamp(v, O.lift, O.press)) * gain * d;
    }
    this.owed[0] = Math.max(-h, Math.min(h, ou)); this.owed[1] = Math.max(-h, Math.min(h, ov));
  }

  /** The live playback of the smoothed felt (x, y, page axes) for a substep of dt: the knees, the cap and what is owed. */
  _live(x, y, dt, lam) {
    const O = this.opt, gain = 1 / Math.sqrt(lam > 0 ? lam : 1), R = this.owed, c = this._c, s = this._s;
    // into the bed's own frame (psi): u along its floor, v into it (v < 0 lifts the bed)
    const u = x * c - y * s, v = x * s + y * c;
    // up to the knees as it is: along the floor the bed's friction; off the floor and into it
    // opt.lift and opt.press (by default all of it: see the header)
    const lu = clamp(u, O.knee, O.knee), lv = clamp(v, O.lift, O.press);
    // beyond them, the film's speed in the push's real time: owed, then paid up to the cap (never
    // under the hand's own acceleration on that axis), the rest kept for the next substeps
    R[0] += (u - lu) * gain * dt; R[1] += (v - lv) * gain * dt;
    const cu = Math.max(0, Math.max(O.cap, Math.abs(u)) - Math.abs(lu)), cv = Math.max(0, Math.max(O.cap, Math.abs(v)) - Math.abs(lv));
    const pu = Math.max(-cu, Math.min(cu, R[0] / dt)), pv = Math.max(-cv, Math.min(cv, R[1] / dt));
    R[0] -= pu * dt; R[1] -= pv * dt;
    // (never more owed than the cap pays in opt.hold)
    const h = O.cap * O.hold;
    R[0] = Math.max(-h, Math.min(h, R[0])); R[1] = Math.max(-h, Math.min(h, R[1]));
    // and back to the page
    const ou = lu + pu, ov = lv + pv;
    return [ou * c + ov * s, ov * c - ou * s];
  }
}
