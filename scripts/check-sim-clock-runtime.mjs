#!/usr/bin/env node
// Simulation clock behaviour.
//
// check-sim-clock.mjs reads the source and asserts that every timing
// baseline is stamped on the simulation clock. This one runs the clock
// and asserts it actually behaves, because the two properties that
// matter are both invisible in the source:
//
//   1. With nothing ever paused, every value is identical to what the
//      browser clock would have produced. A pause button that changes
//      how an unpaused scenario runs is a regression, not a feature.
//   2. A pause is a freeze and a resume is a continuation, not a
//      catch-up. The whole point is that an integrating loop sees a
//      zero delta rather than the pause duration.
//
// Real sleeps, ~1.3 s total. That is the price of testing a clock.

const CLOCK = new URL('../src/sim_clock.js', import.meta.url);
const {
  monoNow, wallNow, pause, resume, isPaused, pausedMs, after, pendingCount,
} = await import(CLOCK);

// The pause control is loaded the same way, because check 6 below is
// about the clock and its control being able to undo each other.
const { markup } = await import(new URL('../src/sim_pause_control.js', import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function ok(name, cond, detail = '') {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? `  (${detail})` : ''}`);
  }
}

// 1. Untouched, this must be the real clock.
ok('unpaused monoNow tracks performance.now', Math.abs(monoNow() - performance.now()) < 2);
ok('unpaused wallNow tracks Date.now', Math.abs(wallNow() - Date.now()) < 2);
ok('nothing frozen yet', pausedMs() === 0);

// 2. Frozen means frozen, and a delta taken while frozen is zero. This
//    is the property that stops the missile crossing the map.
pause();
const m0 = monoNow();
const w0 = wallNow();
await sleep(300);
ok('monoNow does not advance while frozen', monoNow() === m0);
ok('wallNow does not advance while frozen', wallNow() === w0);
ok('isPaused reports true', isPaused() === true);
ok('a dt computed while frozen is exactly zero', monoNow() - m0 === 0);

// 3. Resume continues rather than catching up.
resume();
await sleep(100);
const drift = monoNow() - m0;
ok('elapsed after resume excludes the frozen time', drift > 80 && drift < 170,
   `${Math.round(drift)}ms, expected ~100`);
ok('the freeze was accounted for', pausedMs() > 280 && pausedMs() < 400,
   `${Math.round(pausedMs())}ms, expected ~300`);
ok('wallNow lags the real clock by exactly the frozen time',
   Math.abs((Date.now() - wallNow()) - pausedMs()) < 6,
   `lag ${Math.round(Date.now() - wallNow())}ms vs frozen ${Math.round(pausedMs())}ms`);

// 4. A deferred transition must hold, then keep its own remainder. This
//    is what stops a drone spawning into a frozen scene.
let fired = false;
after(() => { fired = true; }, 200);
pause();
await sleep(400);
ok('a deferred transition does not fire while frozen', fired === false);
ok('it is still pending', pendingCount() === 1, `pending=${pendingCount()}`);
resume();
await sleep(60);
ok('it does not fire early on resume', fired === false);
await sleep(220);
ok('it fires once its remaining time elapses', fired === true);

// 5. Idempotent, because the spacebar and the button can both fire.
ok('a second pause() reports no change', pause() === true && pause() === false);
ok('a second resume() reports no change', resume() === true && resume() === false);

// 6. THE CONTROL MUST BE ABLE TO UNDO ITSELF.
//
//    The pause control is hidden when nothing is live, because a pause
//    button with nothing to pause reads as broken. That reasoning holds
//    only in one direction. Gated on liveness alone it strands the
//    clock: freeze the sim, cancel the threat, every track ends, the
//    control disappears while still frozen, and nothing on the sim clock
//    ever moves again for the session. Dispatches park mid-air and their
//    removal timers are held rather than cancelled, so they never clear
//    either. A helicopter was found over Billund this way.
ok('the control is offered while something is live',
   markup(false, true) !== '');
ok('it is hidden when nothing is live and the clock is running',
   markup(false, false) === '');
ok('IT IS STILL OFFERED WHEN NOTHING IS LIVE AND THE CLOCK IS FROZEN',
   markup(true, false) !== '',
   'a frozen clock with no live track would be unresumable');
ok('and it offers resume, not pause, in that state',
   /Resume simulation/.test(markup(true, false)));

if (failures) {
  console.error(`\n${failures} simulation-clock behaviour failure(s).\n`);
  process.exit(1);
}
console.log('✓ Simulation clock behaves. Unpaused it is the real clock; '
  + 'frozen it yields zero deltas; resumed it continues rather than catching up.');
