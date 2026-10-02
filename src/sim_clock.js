// ── The simulation clock ──────────────────────────────────────────────
//
// One clock the whole simulation reads, so that stopping it freezes
// everything at once.
//
// WHY THIS EXISTS
//
// Before this module there was no clock to stop. Every loop called
// `performance.now()` or `Date.now()` directly, so there was no single
// thing a pause button could act on. Stopping the loops instead of the
// clock does not work, because the loops fall into two kinds:
//
//   DERIVED    position is a formula of elapsed time. The hostile track
//              is this: `interpolate(waypoints, (now - startTime)/1000)`.
//              Freezing the clock freezes it exactly, and resuming
//              continues from the same point. Nothing accumulates.
//
//   INTEGRATED position advances by `speed * (now - lastFrame)`. The
//              interceptors, the F-35 and the missile are this. Stop
//              calling them for 30 seconds, call them again, and the
//              first frame asks the real clock how long it has been and
//              is told 30 seconds. One frame, one 30-second step:
//              the missile moves 45 km, which is further than any
//              distance on the map, so it snaps onto its target and
//              lands inside the kill radius. A pause that decides the
//              engagement is worse than no pause.
//
// Both kinds are fixed by the same thing. If an integrating loop reads a
// frozen clock it is told that zero time has passed and takes a
// zero-sized step. So there is no re-stamping of baselines, no
// per-loop special case, and no catching up on resume. One clock, read
// by everyone, stopped in one place.
//
// TWO EPOCHS, DELIBERATELY
//
// The codebase already uses both `performance.now()` and `Date.now()`
// for simulation state, and the two are not interchangeable. main.js
// documents the collision itself, at the jam-fall site: a start stamp
// taken from `Date.now()` compared against a tick's `performance.now()`
// is a different scale. Collapsing them here would silently change
// which epoch stored values live in, and some of those values are
// persisted into event records. So this module exposes one reader per
// epoch over one shared frozen-time accumulator. Swap like for like:
// `performance.now()` becomes `monoNow()`, `Date.now()` becomes
// `wallNow()`, and nothing changes scale.
//
// WHAT MUST NOT READ THIS CLOCK
//
//   The clock in the corner. An operations surface that shows a frozen
//   UTC time is lying about something an operator checks against
//   external systems. `tickClocks` keeps the real clock.
//
//   Anything that stamps a record a human or an auditor will read. An
//   event's start time, a dispatch's initiatedAt, a report timestamp,
//   a filename suffix. Those are real moments in the real world and are
//   stamped with the real clock. This clock is for deriving and
//   comparing simulation state, not for saying when something happened.
//
//   A live vehicle. `isTelemetryStale` compares now against a timestamp
//   that arrived from a real feed, and its whole purpose is to notice
//   when a real unit's feed has gone quiet so a stalled vehicle does
//   not read as still driving to the scene. A frozen clock there makes
//   the age go negative and the guard can never fire. Pausing the
//   screen does not pause a car. That check keeps `Date.now()`.
//
//   Animation. Pulses, flashes, fades, tracer cadence. A frozen scene
//   that still breathes reads as paused rather than as broken, which is
//   what you want in front of a customer.
//
// CONTRACT
//
//   monoNow()        frozen `performance.now()`
//   wallNow()        frozen `Date.now()`
//   isPaused()
//   pause()          -> true if this call changed the state
//   resume()         -> true if this call changed the state
//   toggle()         -> the new paused state
//   pausedMs()       total frozen milliseconds since load
//   onChange(fn)     subscribe; returns an unsubscribe function
//   after(fn, ms)    pause-aware setTimeout, same argument order
//
// Not a singleton by accident: a module-level clock is correct here
// because there is exactly one simulation per page.

let _paused = false;

// The instant of the pause, one per epoch, read back by the readers so
// that time does not advance while frozen.
let _atMono = 0;
let _atWall = 0;

// Total frozen milliseconds, one per epoch. Subtracted by the readers,
// which is what makes resume seamless rather than a catch-up.
let _lostMono = 0;
let _lostWall = 0;

const _subs = new Set();

function _notify() {
  // Copied before iterating: a subscriber is allowed to unsubscribe
  // itself from inside its own callback.
  for (const fn of [..._subs]) {
    try { fn(_paused); } catch (err) { console.warn('[sim_clock] subscriber threw:', err); }
  }
}

export function isPaused() { return _paused; }

/** Frozen `performance.now()`. Monotonic, no epoch meaning. */
export function monoNow() {
  return (_paused ? _atMono : performance.now()) - _lostMono;
}

/** Frozen `Date.now()`. Still milliseconds since 1970, shifted back by
 *  however long the simulation has been frozen. Safe to difference
 *  against another `wallNow()` value. NOT a real timestamp: do not
 *  persist it as the moment something happened. */
export function wallNow() {
  return (_paused ? _atWall : Date.now()) - _lostWall;
}

export function pause() {
  if (_paused) return false;
  _atMono = performance.now();
  _atWall = Date.now();
  _paused = true;
  _holdTimers();
  _notify();
  return true;
}

export function resume() {
  if (!_paused) return false;
  _lostMono += performance.now() - _atMono;
  _lostWall += Date.now() - _atWall;
  _paused = false;
  _releaseTimers();
  _notify();
  return true;
}

export function toggle() {
  if (_paused) { resume(); } else { pause(); }
  return _paused;
}

export function pausedMs() { return _lostMono; }

export function onChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

// ── Why nothing stops a loop ──────────────────────────────────────────
//
// There is deliberately no helper here for pausing an animation frame
// loop or an interval, because freezing the clock means none of them has
// to stop. Every loop keeps spinning, asks the frozen clock how much
// time has passed, is told none, and advances by nothing. The scene
// stands still while the machinery keeps turning.
//
// That is not just simpler, it avoids a trap. Three of the four
// simulation loops re-arm only conditionally: the drone engine and the
// dispatch tick re-arm while their collection is non-empty and are
// otherwise restarted only when something is added to it, and the F-35
// and missile loops return early without re-arming when not airborne. A
// pause written as `if (paused) return;` inside any of them would stop
// it for the rest of the session. Nothing here invites that.
//
// The periodic sweeps need nothing either. The one that closes an
// unobserved event compares the clock against a detection stamp, and
// the one that tears a track down compares it against a close stamp.
// Both sides of both comparisons are now on this clock, so the
// differences hold steady and neither sweep fires while frozen.
//
// Deferred transitions are the exception, below, because a `setTimeout`
// has no clock to freeze — it is already counting.

// ── Deferred transitions ──────────────────────────────────────────────
//
// A plain `setTimeout` keeps firing while the screen is frozen, which is
// how a paused simulation can mint a crash scene, delete a dispatch, or
// spawn a new drone. `after` holds the remaining time instead.
//
// Exact rather than polled: on pause each pending timer is cancelled and
// its remaining time kept; on resume it is re-armed with exactly that
// remainder. No ticker, no granularity loss.
const _pending = new Set();

function _arm(rec) {
  rec.id = setTimeout(() => {
    _pending.delete(rec);
    rec.fn();
  }, rec.remaining);
  rec.armedAt = performance.now();
}

function _holdTimers() {
  for (const rec of _pending) {
    clearTimeout(rec.id);
    rec.id = null;
    rec.remaining = Math.max(0, rec.remaining - (performance.now() - rec.armedAt));
  }
}

function _releaseTimers() {
  for (const rec of _pending) _arm(rec);
}

/** Pause-aware `setTimeout`. Argument order matches `setTimeout` on
 *  purpose — `(fn, ms)`, not `(ms, fn)` — so converting a call site is a
 *  pure rename and cannot silently swap the two. Returns a cancel
 *  function rather than a numeric id; `clearTimeout` would not work. */
export function after(fn, ms) {
  const rec = { remaining: Math.max(0, ms), fn, id: null, armedAt: 0 };
  _pending.add(rec);
  if (!_paused) _arm(rec);
  return function cancel() {
    if (rec.id) clearTimeout(rec.id);
    _pending.delete(rec);
  };
}

/** How many deferred transitions are waiting. Diagnostic only. */
export function pendingCount() { return _pending.size; }

// ── DevTools ──────────────────────────────────────────────────────────
//
// Reading and driving the clock by hand is how you check a freeze
// without sitting through a scenario.
if (typeof window !== 'undefined') {
  window.__isr_simClock = {
    isPaused, pause, resume, toggle, pausedMs, pendingCount,
    monoNow, wallNow,
    status: () => ({
      paused: _paused,
      frozenMs: Math.round(_lostMono),
      pendingTransitions: _pending.size,
      subscribers: _subs.size,
    }),
  };
}
