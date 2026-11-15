/*!
 * Hourglass — motion.js
 * ---------------------------------------------------------------------------
 * The phone's own motion, as the sand inside it would feel it.
 *
 * Two sensor events come in: devicemotion (acceleration and rotation rate,
 * about 60 a second on an iPhone) and deviceorientation (how the phone is
 * held). What goes out, once per physics step, is a clean sample:
 *
 *   x, y     what the sand feels from the phone's motion, −a/g, in the page
 *            plane (x right, y down), in g; gravity itself is not included
 *   z        the out-of-plane part (it only stirs the sand)
 *   w        how fast the phone turns in its own plane, rad/s, + clockwise
 *   wf       how fast it spins lying flat on a table, rad/s (a magnitude)
 *   armed    shaken hard enough, for long enough, that the glass may suffer
 *
 * Browsers disagree about these sensors: WebKit reports both acceleration
 * vectors negated, and a few report them in g instead of m/s². Nothing here
 * guesses from the user agent what it can measure instead: while the phone
 * is still, the accelerometer is compared with deviceorientation, which
 * every engine reports the same way, and the units and sign are learnt.
 *
 * Nothing on the per-event path allocates: GC pauses mid-shake would show
 * up as stutters in the sand.
 *
 * License: GPL-3.0.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var G0 = 9.80665;
  var RAD = Math.PI / 180;
  var TAU = Math.PI * 2;

  /*
   * Tunables. Times in ms where they compare event times, in s where they
   * are filter constants.
   */
  var CONFIG = {
    unitN: 8,           // first readings whose median |aIG| decides m/s² or g
    votes: 20,          // still readings needed to settle the sign…
    agree: 0.8,         // …of which this share must agree
    still: 1.2,         // still: |aIG| within this of 1 g (m/s²)…
    stillA: 1.5,        // …and |a|₁ below this (m/s²)
    dot: 0.8,           // gravity must line up with "down" at least this well
    orientFresh: 100,   // ms: a deviceorientation reading this recent tells "down"
    priorAfter: 1500,   // ms without a settled sign before guessing one
    biasTau: 2,         // s: the slow drift some Android sensors add…
    biasGate: 0.12,     // g: …is learnt only while the reading is below this
    // s: sensor noise. Short on purpose: at an iPhone's 60 readings a second
    // the sampling already limits the noise, and the dead zone removes what is
    // left at rest, while a 12 ms filter took 5–7 % off a 4–5 Hz shake and more
    // off its harmonics. The glass's fracture law goes as impact speed to the
    // 16th power, so every percent lost here shows up as a slower crack.
    lpTau: 0.004,
    dead: 0.06,         // g: hand tremor; a soft dead zone, no step at its edge
    clamp: 8,           // g: the accelerometer's range
    ramp: 1200,         // ms: fade in after start(), reset() or a return to the page
    latency: 17,        // ms: read one reading behind, so each 120 Hz step gets its own value
    stale: 150,         // ms: with no newer reading, decay…
    fade: 100,          // ms: …to zero over this, so a stale shake never freezes in
    live: 500,          // ms: a reading this recent counts as live
    rmsWin: 0.25,       // s: window of the arming RMS
    armOn: 1.5,         // g: armed after the RMS stays at or above this…
    armFor: 0.6,        // s: …for this long
    armOff: 1.2,        // g: disarmed after it stays below this…
    disarmFor: 0.5,     // s: …for this long
    twistIn: 0.4,       // in-plane gravity above which the heading's rate is trusted
    twistTau: 0.04,     // s: smoothing of that rate
    twistDecay: 0.1,    // s: decay when it cannot be measured
    flatIn: 0.35,       // in-plane gravity below which the phone lies flat
    spinTau: 0.06,      // s: smoothing of the flat spin
    spinDecay: 0.1,     // s: its decay once no longer flat
    spinDead: 1.5,      // rad/s: below this a flat phone is not spinning
    spinMax: 20,        // rad/s
    gravTau: 0.5        // s: gravity estimate when neither acceleration nor orientation is known
  };

  var RING = 8;         // felt samples kept for interpolation
  var WIN = 128;        // arming window entries (250 ms at the 4 ms minimum step)

  function fin(v) { return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity; }
  function now() {
    var p = root.performance;
    return p && p.now ? p.now() : Date.now();
  }
  function wrapPi(a) {
    while (a > Math.PI) a -= TAU;
    while (a <= -Math.PI) a += TAU;
    return a;
  }

  /** The screen's rotation, as today's onOrient reads it. */
  function screenAngle() {
    var o = root.orientation;
    if (typeof o === 'number') return o;
    var so = root.screen && root.screen.orientation;
    return so && typeof so.angle === 'number' ? so.angle : 0;
  }

  // Device screen frame (x right, y down) → page frame, for screen angle o:
  // the remap today's onOrient uses. Written into TP so the event path never
  // allocates; the exported toPage() returns a fresh pair.
  var TP = new Float64Array(2);
  function toPageInto(x, y, o) {
    if (o === 90) { TP[0] = y; TP[1] = -x; }
    else if (o === -90 || o === 270) { TP[0] = -y; TP[1] = x; }
    else if (o === 180) { TP[0] = -x; TP[1] = -y; }
    else { TP[0] = x; TP[1] = y; }
  }

  function permissionFn(C) { return !!C && typeof C.requestPermission === 'function'; }

  /** Before any reading settles it: WebKit (iPhone, iPad) negates both vectors. */
  function priorSign() {
    var n = root.navigator || {}, ua = n.userAgent || '';
    var ios = /iPhone|iPad|iPod/.test(ua) || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
    return ios ? -1 : 1;
  }

  /* ======================================================================
   *  HourglassMotion
   * ==================================================================== */

  /**
   * opts.sign: the sign learnt on an earlier visit (1 W3C, −1 WebKit, 0 not
   * known). It is used until this visit's own readings settle it.
   */
  function HourglassMotion(opts) {
    opts = opts || {};
    var s = +opts.sign;
    this._persisted = s === 1 || s === -1 ? s : 0;

    // ---- public state ------------------------------------------------------
    this.needsPermission = permissionFn(root.DeviceMotionEvent) || permissionFn(root.DeviceOrientationEvent);
    this.sign = this._persisted;   // in use: learnt, persisted or the prior; 0 = none yet
    this.locked = false;           // learnt from this device's own readings
    this.onsign = null;            // callback(sign) when the readings settle it
    this.heading = NaN;            // direction of gravity on the screen, atan2(gx, gy)
    this.inPlane = 0;              // |gravity in the screen plane| / g
    this.headingSeq = 0;           // bumped on every orientation reading
    this.live = false;
    this.seenMotion = false;
    this.seenOrient = false;
    this.armed = false;
    this.rms = 0;                  // g, 3-D, over the last 250 ms
    this.started = false;

    // ---- calibration (kept across reset) ------------------------------------
    this._unit = 0;                // 1: m/s²; G0: readings in g; 0: not yet known
    this._uBuf = new Float64Array(CONFIG.unitN);
    this._uN = 0;
    this._vN = 0; this._vS = 0;    // sign votes: count and sum
    this._t0 = -1;                 // first reading since start(), for the prior
    this._bx = 0; this._by = 0; this._bz = 0;   // sensor drift, g, device axes
    this._base = 0;                // event clock: 1 performance.now(), 2 another (offset)
    this._off = 0; this._offOk = false;

    // ---- latest orientation ---------------------------------------------------
    this._dnX = 0; this._dnY = 0; this._dnZ = 0; this._dT = -1;   // "down", device axes
    this._psi = 0; this._psiOk = false;

    // ---- filters and outputs (cleared by reset) -------------------------------
    this._rt = new Float64Array(RING);
    this._rx = new Float64Array(RING);
    this._ry = new Float64Array(RING);
    this._rz = new Float64Array(RING);
    this._aW = new Float64Array(WIN);   // arming window: g²·s per reading…
    this._aD = new Float64Array(WIN);   // …and its duration
    this._out = { x: 0, y: 0, z: 0, w: 0, wf: 0, rms: 0, armed: false, live: false };
    this.reset();

    var self = this;
    this._hm = function (e) { self._motion(e); };
    this._ho = function (e) { self._orient(e); };
    this._hv = function () {
      var d = root.document;
      if (d && !d.hidden) self.reset();     // back on the page: start the fade-in afresh
    };
  }

  HourglassMotion.CONFIG = CONFIG;
  HourglassMotion.screenAngle = screenAngle;
  /** Device screen frame (x right, y down) → page frame for screen angle o. */
  HourglassMotion.toPage = function (x, y, o) {
    toPageInto(x, y, o);
    return [TP[0], TP[1]];
  };

  var P = HourglassMotion.prototype;

  /* ---------------------------------------------------------------- *
   *  Permission and lifecycle
   * ---------------------------------------------------------------- */

  /**
   * Ask for access. Resolves 'granted', 'denied' or 'unavailable'; rejects
   * if the browser refuses to ask (for instance outside a user gesture).
   * Call it from inside the gesture itself.
   */
  P.request = function () {
    var DM = root.DeviceMotionEvent, DO = root.DeviceOrientationEvent;
    var pm, po, err = null;
    // Both requests go out first, synchronously: WebKit only prompts while it
    // is handling the user's gesture, and an await or a then before either
    // call would lose it. It keeps one decision for both, so one gesture
    // should mean one prompt.
    if (permissionFn(DM)) {
      try { pm = DM.requestPermission(); } catch (e) { err = e; }
    }
    if (permissionFn(DO)) {
      try { po = DO.requestPermission(); } catch (e2) { err = err || e2; }
    }
    if (err) return Promise.reject(err);
    if (!DM && !DO) return Promise.resolve('unavailable');
    return Promise.all([pm, po]).then(function (r) {
      // Nothing to ask counts as granted. Chromium answers 'prompt' while
      // sensors are undecided, which is not access.
      var m = pm === undefined ? 'granted' : r[0];
      var o = po === undefined ? 'granted' : r[1];
      return m === 'granted' && o === 'granted' ? 'granted' : 'denied';
    });
  };

  P.start = function () {
    if (this.started) return;
    this.started = true;
    this.seenMotion = false;
    this.seenOrient = false;
    this.heading = NaN;
    this._t0 = -1;
    this.reset();
    root.addEventListener('devicemotion', this._hm, false);
    root.addEventListener('deviceorientation', this._ho, false);
    if (root.document) root.document.addEventListener('visibilitychange', this._hv, false);
  };

  P.stop = function () {
    if (!this.started) return;
    this.started = false;
    root.removeEventListener('devicemotion', this._hm, false);
    root.removeEventListener('deviceorientation', this._ho, false);
    if (root.document) root.document.removeEventListener('visibilitychange', this._hv, false);
    this.reset();
  };

  /**
   * Forget the recent past: the filters, the readings, the arming window,
   * and fade in again over 1.2 s. The units and sign stay learnt.
   */
  P.reset = function () {
    this._rn = 0; this._rh = 0;
    this._lpOk = false; this._lx = 0; this._ly = 0; this._lz = 0;
    this._rampT = -1;
    this._mT = -1;                 // last motion reading
    this._oT = -1;                 // last orientation reading
    this._w = 0; this._psiOk = false;
    this._wfl = 0; this._wf = 0;
    this._gOk = false; this._gx = 0; this._gy = 0; this._gz = 0;
    this._aH = 0; this._aN = 0; this._aSum = 0; this._aSpan = 0;
    this._over = 0; this._under = 0;
    this.armed = false;
    this.rms = 0;
    this.live = false;
  };

  /* ---------------------------------------------------------------- *
   *  Event time
   * ---------------------------------------------------------------- */

  /**
   * Event time in the performance.now() clock, the clock the app steps in.
   * Today's browsers stamp events in it; older WebKit used epoch ms, which
   * is followed through an offset instead.
   */
  P._clock = function (ts) {
    var t0 = now();
    if (!(ts > 0)) return t0;
    if (!this._base) this._base = Math.abs(t0 - ts) < 3.6e6 ? 1 : 2;
    if (this._base === 1) return ts;
    var t = ts + this._off, lag = t0 - t;
    if (!this._offOk || lag < -5 || lag > 2000) { this._off = t0 - ts; this._offOk = true; t = t0; }
    return t;
  };

  /* ---------------------------------------------------------------- *
   *  deviceorientation: heading, "down", the twist
   * ---------------------------------------------------------------- */
  P._orient = function (e) {
    var doc = root.document;
    if (doc && doc.hidden) return;
    var beta = e.beta, gamma = e.gamma;
    if (!fin(beta) || !fin(gamma)) return;
    var t = this._clock(e.timeStamp);
    var b = beta * RAD, g = gamma * RAD;
    var cb = Math.cos(b), sb = Math.sin(b), sg = Math.sin(g), cg = Math.cos(g);
    // which way is down, in device axes (x right, y up, z out of the screen)
    this._dnX = cb * sg; this._dnY = -sb; this._dnZ = -cb * cg; this._dT = t;
    // gravity projected onto the screen (x → its right edge, y → its bottom
    // edge), seen from the page, which the system may have rotated: exactly
    // today's onOrient
    toPageInto(cb * sg, sb, screenAngle());
    var gx = TP[0], gy = TP[1], ip2 = gx * gx + gy * gy;
    this.inPlane = Math.sqrt(ip2);
    this.seenOrient = true;
    var dt = this._oT >= 0 ? (t - this._oT) / 1000 : 1 / 60;
    dt = dt < 0.004 ? 0.004 : (dt > 0.1 ? 0.1 : dt);
    this._oT = t;
    var measured = false;
    if (ip2 >= 0.05) {                       // lying flat: no pull in the plane, keep the last heading
      var psi = Math.atan2(gx, gy);
      if (this.inPlane > CONFIG.twistIn) {
        // The heading grows as the phone turns clockwise in the user's hand,
        // which is + in the vessel's convention too.
        if (this._psiOk) {
          var rate = wrapPi(psi - this._psi) / dt;
          this._w += (rate - this._w) * (1 - Math.exp(-dt / CONFIG.twistTau));
          measured = true;
        }
        this._psiOk = true;
      } else this._psiOk = false;
      this._psi = psi;
      this.heading = psi;
    } else this._psiOk = false;
    if (!measured) this._w *= Math.exp(-dt / CONFIG.twistDecay);
    this.headingSeq++;
  };

  /* ---------------------------------------------------------------- *
   *  devicemotion: the felt acceleration, the arming RMS, the flat spin
   * ---------------------------------------------------------------- */
  P._motion = function (e) {
    var doc = root.document;
    if (doc && doc.hidden) return;
    var C = CONFIG;
    var IG = e.accelerationIncludingGravity, A = e.acceleration, R = e.rotationRate;
    var hasIG = !!IG && fin(IG.x) && fin(IG.y) && fin(IG.z);
    var hasA = !!A && fin(A.x) && fin(A.y) && fin(A.z);
    if (!hasIG && !hasA) return;             // desktop browsers send empty readings
    this.seenMotion = true;
    this.live = true;
    var t = this._clock(e.timeStamp);
    var dt = this._mT >= 0 ? (t - this._mT) / 1000 : 1 / 60;
    dt = dt < 0.004 ? 0.004 : (dt > 0.1 ? 0.1 : dt);
    this._mT = t;
    if (this._t0 < 0) this._t0 = t;

    // ---- 1. units: |aIG| is 1 g at rest, in m/s² (≈ 9.8) or, rarely, in g --
    var igx = 0, igy = 0, igz = 0, igm = 0;
    if (hasIG) { igx = IG.x; igy = IG.y; igz = IG.z; igm = Math.sqrt(igx * igx + igy * igy + igz * igz); }
    if (!this._unit && (!hasIG || igm > 0.3)) {    // near 0 in either unit means free fall: no clue
      this._uBuf[this._uN++] = hasIG ? igm : G0;
      if (this._uN >= C.unitN) {
        var u = this._uBuf;
        u.sort();
        this._unit = (u[(C.unitN - 1) >> 1] + u[C.unitN >> 1]) / 2 < 3 ? G0 : 1;
      }
    }
    // until the median is in, each reading's own size is a good guess
    var K = this._unit || (hasIG && igm < 3 ? G0 : 1);

    // ---- 2. sign: vote while still, against deviceorientation's "down" ------
    var down = this._dT >= 0 && t - this._dT <= C.orientFresh;
    if (!this.locked && hasIG && igm > 0) {
      var a1 = hasA ? (Math.abs(A.x) + Math.abs(A.y) + Math.abs(A.z)) * K : 0;
      if (Math.abs(igm * K - G0) < C.still && a1 < C.stillA) {
        var vote = 0;
        if (down) {
          // W3C: at rest aIG points up (≈ −1 against down); WebKit: down (≈ +1)
          var d = (igx * this._dnX + igy * this._dnY + igz * this._dnZ) / igm;
          vote = d < -C.dot ? 1 : (d > C.dot ? -1 : 0);
        } else {
          // No orientation: people hold the phone so the page is upright, so
          // the page's "down" is the world's. In device axes it is (sx, −sy)
          // for the screen-frame vector the page's down maps to.
          var o = screenAngle(), ux = 0, uy = -1;     // portrait: device −y
          if (o === 90) { ux = -1; uy = 0; }
          else if (o === -90 || o === 270) { ux = 1; uy = 0; }
          else if (o === 180) { ux = 0; uy = 1; }
          var pd = (igx * ux + igy * uy) * K;
          vote = pd < -0.5 * G0 ? 1 : (pd > 0.5 * G0 ? -1 : 0);
        }
        if (vote) {
          this._vN++; this._vS += vote;
          if (this._vN >= C.votes && Math.abs(this._vS) >= (2 * C.agree - 1) * this._vN) {
            this.locked = true;
            this.sign = this._vS > 0 ? 1 : -1;
            if (typeof this.onsign === 'function') {
              try { this.onsign(this.sign); } catch (err) {}
            }
          }
        }
      }
    }
    if (!this.sign && t - this._t0 >= C.priorAfter) this.sign = priorSign();
    var s = this.sign;

    // gravity estimate for when nothing else knows "down" (raw sign, m/s²)
    if (hasIG) {
      if (!this._gOk) { this._gx = igx * K; this._gy = igy * K; this._gz = igz * K; this._gOk = true; }
      else {
        var kg = 1 - Math.exp(-dt / C.gravTau);
        this._gx += (igx * K - this._gx) * kg;
        this._gy += (igy * K - this._gy) * kg;
        this._gz += (igz * K - this._gz) * kg;
      }
    }

    // ---- 3. kinematic acceleration, W3C sign, device axes, m/s² ---------------
    var kx = 0, ky = 0, kz = 0, ok = false;
    if (s) {
      if (hasA) { kx = s * A.x * K; ky = s * A.y * K; kz = s * A.z * K; ok = true; }
      else if (down) {                       // aIG = a − g·down, so a = aIG + g·down
        kx = s * igx * K + G0 * this._dnX; ky = s * igy * K + G0 * this._dnY; kz = s * igz * K + G0 * this._dnZ; ok = true;
      } else if (this._gOk) {                // last resort: take away a slow average
        kx = s * (igx * K - this._gx); ky = s * (igy * K - this._gy); kz = s * (igz * K - this._gz); ok = true;
      }
    }

    // ---- arming: 3-D RMS of the raw kinematic acceleration (sign-free with a) --
    var m2 = hasA ? (A.x * A.x + A.y * A.y + A.z * A.z) * K * K : (kx * kx + ky * ky + kz * kz);
    this._arm(m2 / (G0 * G0), dt);

    // ---- 4. felt, g, device axes; 5. Android drift, learnt while calm --------
    var fx = 0, fy = 0, fz = 0;
    if (ok) {
      fx = -kx / G0; fy = -ky / G0; fz = -kz / G0;
      var kb = 1 - Math.exp(-dt / C.biasTau);
      if (fx * fx + fy * fy < C.biasGate * C.biasGate) { this._bx += (fx - this._bx) * kb; this._by += (fy - this._by) * kb; }
      if (fz < C.biasGate && fz > -C.biasGate) this._bz += (fz - this._bz) * kb;
      fx -= this._bx; fy -= this._by; fz -= this._bz;
    }

    // ---- 6. into the page: the device's screen frame is (x, −y) -----------------
    toPageInto(fx, -fy, screenAngle());
    var px = TP[0], py = TP[1], pz = fz < 0 ? -fz : fz;

    // ---- 7. sensor noise ------------------------------------------------------
    if (!this._lpOk) { this._lx = px; this._ly = py; this._lz = pz; this._lpOk = true; }
    else {
      var kl = 1 - Math.exp(-dt / C.lpTau);
      this._lx += (px - this._lx) * kl; this._ly += (py - this._ly) * kl; this._lz += (pz - this._lz) * kl;
    }

    // ---- 8. soft dead zone, 9. the sensor's range ------------------------------
    var ox = this._lx, oy = this._ly, om = Math.sqrt(ox * ox + oy * oy);
    var sc = om > C.dead ? Math.min(om - C.dead, C.clamp) / om : 0;
    ox *= sc; oy *= sc;
    var oz = this._lz > C.dead ? Math.min(this._lz - C.dead, C.clamp) : 0;

    // ---- 10. fade in -------------------------------------------------------------
    if (this._rampT < 0) this._rampT = t;
    var gain = ok ? (t - this._rampT) / C.ramp : 0;
    gain = gain < 0 ? 0 : (gain > 1 ? 1 : gain);

    // ---- 11. into the ring -------------------------------------------------------
    var h = this._rn ? (this._rh + 1) % RING : 0;
    this._rt[h] = t; this._rx[h] = ox * gain; this._ry[h] = oy * gain; this._rz[h] = oz * gain;
    this._rh = h;
    if (this._rn < RING) this._rn++;

    // ---- 13. lying flat and spinning: only |rotationRate| is used, so axis order
    // and sign (which differ between engines) do not matter ------------------------
    var ip = 1;
    if (this._oT >= 0 && t - this._oT <= 250) ip = this.inPlane;
    else if (hasIG && hasA) ip = flatness(IG.x - A.x, IG.y - A.y, IG.z - A.z);
    else if (this._gOk) ip = flatness(this._gx, this._gy, this._gz);
    var hasR = !!R && (fin(R.alpha) || fin(R.beta) || fin(R.gamma));
    if (hasR && ip < C.flatIn) {
      var ra = fin(R.alpha) ? R.alpha : 0, rb = fin(R.beta) ? R.beta : 0, rg = fin(R.gamma) ? R.gamma : 0;
      var wr = Math.sqrt(ra * ra + rb * rb + rg * rg) * RAD;       // deg/s, as the W3C spec says
      this._wfl += (wr - this._wfl) * (1 - Math.exp(-dt / C.spinTau));
    } else this._wfl *= Math.exp(-dt / C.spinDecay);
    this._wf = this._wfl < C.spinDead ? 0 : (this._wfl > C.spinMax ? C.spinMax : this._wfl);
  };

  /** |gravity in the screen plane| / |gravity|, from a gravity vector in device axes. */
  function flatness(x, y, z) {
    var m = Math.sqrt(x * x + y * y + z * z);
    return m > 0 ? Math.sqrt(x * x + y * y) / m : 1;
  }

  /**
   * The arming gate: a sliding 250 ms RMS of the whole 3-D acceleration.
   * Only a shake that stays above 1.5 g for 0.6 s arms it; a lone knock or
   * a drop is diluted over the window and never does.
   */
  P._arm = function (m2, dt) {
    var C = CONFIG, W = this._aW, D = this._aD;
    if (this._aN === WIN) {                  // full (never at sane rates): drop the oldest
      this._aSum -= W[this._aH]; this._aSpan -= D[this._aH];
      this._aH = (this._aH + 1) % WIN; this._aN--;
    }
    var i = (this._aH + this._aN) % WIN;
    W[i] = m2 * dt; D[i] = dt;
    this._aN++; this._aSum += m2 * dt; this._aSpan += dt;
    // keep just enough readings to cover the window
    while (this._aN > 1 && this._aSpan - D[this._aH] >= C.rmsWin) {
      this._aSum -= W[this._aH]; this._aSpan -= D[this._aH];
      this._aH = (this._aH + 1) % WIN; this._aN--;
    }
    if (this._aSum < 0) this._aSum = 0;
    var rms = Math.sqrt(this._aSum / (this._aSpan > C.rmsWin ? this._aSpan : C.rmsWin));
    this.rms = rms;
    this._over = rms >= C.armOn ? this._over + dt : 0;
    this._under = rms < C.armOff ? this._under + dt : 0;
    if (!this.armed) { if (this._over >= C.armFor) this.armed = true; }
    else if (this._under >= C.disarmFor) this.armed = false;
  };

  /* ---------------------------------------------------------------- *
   *  Output
   * ---------------------------------------------------------------- */

  /**
   * The phone's motion at time tMs (performance.now() clock), into out
   * {x, y, z, w, wf, rms, armed, live}. x, y: felt, page frame, g. The
   * readings are interpolated 17 ms back, so each 120 Hz step gets its own
   * value; once they stop arriving, everything fades to zero.
   */
  P.sample = function (tMs, out) {
    var C = CONFIG;
    out = out || this._out;
    var x = 0, y = 0, z = 0, w = 0, wf = 0, live = false;
    if (this.started) {
      var n = this._rn;
      if (n) {
        var h = this._rh, age = tMs - this._rt[h];
        live = age < C.live;
        if (age < C.stale + C.fade) {
          var tq = tMs - C.latency, i = h, k = 0;
          while (k < n - 1 && this._rt[i] > tq) { i = (i + RING - 1) % RING; k++; }
          var j = (i + 1) % RING, span = this._rt[j] - this._rt[i];
          if (i === h || this._rt[i] > tq || !(span > 0)) {
            x = this._rx[i]; y = this._ry[i]; z = this._rz[i];   // before the oldest or after the newest: hold
          } else {
            var u = (tq - this._rt[i]) / span;
            x = this._rx[i] + (this._rx[j] - this._rx[i]) * u;
            y = this._ry[i] + (this._ry[j] - this._ry[i]) * u;
            z = this._rz[i] + (this._rz[j] - this._rz[i]) * u;
          }
          var g = age <= C.stale ? 1 : 1 - (age - C.stale) / C.fade;
          x *= g; y *= g; z *= g;
          wf = this._wf * g;
        }
      }
      if (this._oT >= 0) {
        var ao = tMs - this._oT;
        if (ao < C.stale + C.fade) w = this._w * (ao <= C.stale ? 1 : 1 - (ao - C.stale) / C.fade);
      }
    }
    if (!live && this.armed) { this.armed = false; this._over = 0; }   // readings stopped: nothing can arm
    this.live = live;
    out.x = x; out.y = y; out.z = z;
    out.w = w; out.wf = wf;
    out.rms = live ? this.rms : 0;
    out.armed = this.armed;
    out.live = live;
    return out;
  };

  root.HourglassMotion = HourglassMotion;
})(typeof window !== 'undefined' ? window : globalThis);
