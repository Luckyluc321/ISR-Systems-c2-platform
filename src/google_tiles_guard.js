// ═══════════════════════════════════════════════════════════════════
// Google tiles are opt-in during development
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-28: the Google bill. Google charges a 3D session every
// time the photorealistic tileset's root is requested, and the 2D
// satellite layer per tile as the map pans. Both were created at every
// page load, unconditionally, so every development reload (and every
// automated test run) paid for 3D nobody looked at.
//
// THE RULE
//   production build (import.meta.env.DEV false)   Google loads, as before
//   development, no ?google=1 in the address        Google is not touched:
//                                                    no 3D tileset, and the
//                                                    2D base map is Cesium's
//                                                    bundled offline imagery
//   development, ?google=1 in the address           Google loads, as before
//
// The switch is per page load and survives a reload, because a reload
// keeps the address: open localhost:1574/?google=1 to record or demo.
//
// It only ever changes anything where a Google key is configured. A
// development server with no key (1573) takes the ion path it always
// took, exactly as before.
//
// Pure, so check:google-guard can test it without a browser.
// ═══════════════════════════════════════════════════════════════════

/** Whether this page load may request Google's tiles. */
export function googleTilesAllowed({ isDev, search }) {
  if (!isDev) return true;
  try {
    return new URLSearchParams(search || '').get('google') === '1';
  } catch (_) {
    return false;
  }
}
