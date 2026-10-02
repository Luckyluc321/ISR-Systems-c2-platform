// ── Pause control for a running simulation ────────────────────────────
//
// Renders into the sim panel, which is where an operator already drives
// a scenario from. Deliberately not a new floating element: the bottom
// centre of the screen is already occupied by the toast at 40px and the
// replay overlay at 24px, and the top right has a known unresolved
// collision between Map Controls and the account dropdown. Adding a
// fourth floating thing there would be the fifth.
//
// Only shown while something is actually live. A pause button with
// nothing to pause reads as a broken control.
//
// The spacebar is wired separately in main.js, because a key handler
// belongs with the other global key handlers and has to work whether or
// not this panel is on screen.
//
// Contract:
//   markup(paused)         HTML string, or '' when there is nothing live
//   wire(root, onToggle)   attach the click handler to whatever markup()
//                          produced inside `root`
//
// Both are pure of application state: the caller decides whether
// anything is live and what toggling means. That keeps this file
// testable by reading it.

const SEL = '[data-sim-pause]';

/**
 * @param {boolean} paused   current clock state, decides the label
 * @param {boolean} anyLive  whether a track is running at all
 */
export function markup(paused, anyLive) {
  if (!anyLive) return '';
  // aria-pressed rather than a disabled/enabled pair: it is one toggle
  // with two labels, and a screen reader should hear it that way.
  return `
      <button class="cp-btn wide sim-btn sim-pause${paused ? ' is-paused' : ''}"
              data-sim-pause
              aria-pressed="${paused ? 'true' : 'false'}"
              title="${paused ? 'Resume the simulation' : 'Freeze the simulation'} (spacebar)">
        <span class="sim-pause-glyph">${paused ? '▶' : '❙❙'}</span>
        <span>${paused ? 'Resume simulation' : 'Freeze simulation'}</span>
      </button>`;
}

/**
 * @param {ParentNode} root      container that markup() was rendered into
 * @param {() => void} onToggle  called on click
 * @returns {boolean}            whether a button was found and wired
 */
export function wire(root, onToggle) {
  const btn = root && root.querySelector(SEL);
  if (!btn) return false;
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    onToggle();
    // Not re-labelled here. The caller re-renders on the clock's own
    // change event, so the label follows the clock rather than the
    // click, and a pause triggered by the spacebar updates this button
    // too.
  });
  return true;
}
