/*
 * Hourglass sand engine: the glass's own acceleration, as the sand feels it.
 *
 * At real speed it is the acceleration itself, smoothed over ACC_TAU.
 *
 * At app speed the world runs slowed: gravity, and with it every force, is scaled by lambda
 * (about 0.08), so a fall takes 1 / sqrt(lambda) (about 3.5) times longer than real. A jolt of
 * the glass scaled the same way but lasting its real time T gives the sand only lambda a T of
 * speed, where a slowed film of the real event gives sqrt(lambda) a T: a flick barely moved the
 * sand (0.2 cells). So the glass's acceleration is recorded and played back slowed by
 * sqrt(lambda), as in a slowed film: a jolt lasts T / sqrt(lambda), its peak against gravity is
 * the real one, the sand gets the film's speed, and a flick's push and its stop come as far
 * apart as in the film. (Scaling the jolt up by 1 / sqrt(lambda) instead gave the right speed,
 * but threw the sand back past the middle when the glass stopped; splitting off a steady part
 * with a high-pass filter pushed the sand back after every jolt.) Quiet stretches (under
 * FILM_QUIET) are played fast, so the playback catches up between jolts, and it never falls more
 * than FILM_LAG behind: a steady push ends up played at its own pace, scaled like gravity.
 *
 * Part of the Hourglass project. License: GPL-3.0.
 */

export const ACC_TAU = 0.012;                 // s: the glass's acceleration as the sand feels it
export const FILM_QUIET = 0.04;               // g: a jolt weaker than this is skipped in the slowed playback
export const FILM_LAG = 0.5;                  // s: the slowed playback never falls further behind than this
const FILM_N = 8192;                          // substeps the film holds

export class GlassFelt {
  constructor() {
    // x1, y1: the acceleration smoothed over ACC_TAU; jx, jy: what the sand felt last (g)
    this.x1 = 0; this.y1 = 0; this.jx = 0; this.jy = 0;
    // the film: the smoothed acceleration recorded each substep (time t, x, y), w written, i the
    // sample at or before the play head tp
    this.film = { t: new Float64Array(FILM_N), x: new Float32Array(FILM_N), y: new Float32Array(FILM_N), w: 0, i: 0, tp: 0 };
  }
  /** The glass at rest and the film empty, its play head at simulated time t. */
  reset(t = 0) { this.x1 = 0; this.y1 = 0; this.jx = 0; this.jy = 0; this.filmReset(t); }
  /** The film empty, its play head at simulated time t. */
  filmReset(t) { const film = this.film; film.w = 0; film.i = 0; film.tp = t; }
  /**
   * The glass's linear acceleration (g, page axes) as the sand feels it, for the substep of dt
   * seconds starting at simulated time t, given the glass's acceleration ax, ay (g) now. slowed:
   * the world runs slowed by lam (G / g, the app's lambda; 1 at real speed) and jolts are played
   * back as a slowed film; otherwise the acceleration is felt as it is (smoothed) and the film is
   * cleared. Returns [x, y]; also kept in jx, jy.
   */
  feel(ax, ay, dt, t, slowed, lam) {
    const k1 = 1 - Math.exp(-dt / ACC_TAU);
    this.x1 += (ax - this.x1) * k1; this.y1 += (ay - this.y1) * k1;
    let jx = this.x1, jy = this.y1;
    if (slowed) {
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
      film.tp = Math.min(t, Math.max(t - FILM_LAG, film.tp));
      p = at(film.tp);
      jx = p[0]; jy = p[1];
    } else this.filmReset(t);
    this.jx = jx; this.jy = jy;
    return [jx, jy];
  }
}
