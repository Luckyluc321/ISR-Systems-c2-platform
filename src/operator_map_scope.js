// ═══════════════════════════════════════════════════════════════════
// An operator account's live map: only what its own sites saw
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-11-04, in the DK Airport operator account: a recon swarm
// left the airport's range and its coordinates kept showing, and an
// ENTRY pin appeared at Amager Koblingsstation. In an operator account
// for a given site, that must never happen.
//
// An operator owns its sites and nothing else. On the live map it sees
// a drone, its trail, its crossing pins and the toasts about it only
// where its own sites' sensors saw it. Admin and every receiver are not
// fenced: every function here hands their unfenced answer straight
// back, so what they see is exactly what they saw before.
//
// DISPLAY ONLY. Nothing here may feed a coverage flag that drives data:
// the case flow, the recording, the confidence and the pursuit keep
// reading the any-site answers in main.js, whoever is signed in.
//
// Pure: the account, the sites and the sensor test are passed in, so
// check:operator-map-scope runs these without a browser.
// ═══════════════════════════════════════════════════════════════════

// A pin whose site cannot be worked out. No operator owns it, so no
// operator sees it; admin and receivers still do.
export const UNKNOWN_SITE = 'unknown-site';

/** The site ids an account is fenced to, or null when it is not fenced. */
export function fencedSiteIds(role) {
  if (!role || role.kind !== 'operator') return null;
  return Array.isArray(role.siteIds) ? role.siteIds : [];
}

/**
 * Whether the account's own sites' sensors see a point. null when the
 * account is not fenced, so the caller keeps its own any-site answer and
 * pays nothing extra.
 */
export function ownSitesSeePoint(role, sites, sensorSees, lat, lon, altM) {
  const own = fencedSiteIds(role);
  if (!own) return null;
  for (const sid of own) {
    for (const s of sites?.[sid]?.sensors || []) {
      if (sensorSees(s, lat, lon, altM)) return true;
    }
  }
  return false;
}

/**
 * The trail points an account may see. seenBy[i] lists the sites whose
 * sensors saw positions[i], or is null when it was not recorded. Not
 * fenced: the same array, untouched. Fenced: only the points one of its
 * own sites saw; an unrecorded point is left out.
 */
export function trailForRole(role, positions, seenBy) {
  const own = fencedSiteIds(role);
  if (!own) return positions;
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    const tag = seenBy?.[i];
    if (tag && own.some((sid) => tag.includes(sid))) out.push(positions[i]);
  }
  return out;
}

/**
 * The site a crossing pin belongs to, read from its label, for pins
 * saved before they carried their site: "ENTRY 09:39:44Z · CPH",
 * "OUT OF RANGE #2 09:40:01Z · AMK signal lost", "EXIT 09:41:10Z · CPH ·
 * DRONE-3". The label names the site by its code, else its name, else
 * its id. UNKNOWN_SITE when none matches.
 */
export function siteOfPinLabel(label, sites) {
  const parts = String(label || '').split(' · ');
  if (parts.length < 2) return UNKNOWN_SITE;
  const named = parts[1].replace(/\s+signal (lost|returned)$/, '').trim();
  for (const [sid, site] of Object.entries(sites || {})) {
    if (named === (site?.code || site?.name || sid) || named === site?.name || named === sid) return sid;
  }
  return UNKNOWN_SITE;
}
