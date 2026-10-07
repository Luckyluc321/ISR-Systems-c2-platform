// Which agency owns a unit, and which agency owns a routing endpoint.
//
// THE PROBLEM THIS SOLVES
//
// Three files describe agencies and none of them share a key:
//
//   roles.js            agency IDENTITY. One entry per agency. Canonical.
//   response_assets.js  physical UNITS. Many per agency: Copenhagen has
//                       a patrol unit and a counter-drone team.
//   destinations.js     ROUTING ENDPOINTS, scoped per site. Many per
//                       agency: one police destination at each of ten
//                       sites.
//
// The last two are many-to-one with the first, so they CANNOT be made to
// share its ids. Renaming was the obvious fix and it is impossible:
// politi-kbh and politi-kbh-cuas would both have to become politi-kbh.
//
// What was missing is not a common key, it is the join. Without it every
// cross-namespace comparison silently returns nothing or the wrong thing:
//
//   - the national asset request walked id prefixes and landed on
//     whatever role shared the most leading tokens. 28 of 41 resolved to
//     something, 8 of those to the wrong agency: all six mismatched
//     police districts collapsed to the national Politi parent, as did
//     the two Rigspolitiet interceptor teams. The remaining 13 fell
//     through to a kind-based fallback that returned the first role whose
//     dispatch scope contained the kind, so Bornholm's and Oksbøl's army
//     assets requested Slagelse. No error, no toast.
//   - post_incident_report.js reads dest.ownerRoleId, which was never
//     defined on any of the 260 destinations, so the compensation it
//     documents has never once executed.
//   - chapter_composer.js compares escalation.destinationId against a
//     role id, which is true only for the 27 site-independent
//     destinations, so an agency whose only involvement was receiving a
//     site-scoped escalation is absent from the incident report.
//
// HOW OWNERSHIP IS DECIDED
//
// For destinations, from the routing data itself rather than from a
// hand-written table, because roles already declare which destinations
// they answer:
//
//   claimed by exactly one role    that role owns it
//   claimed by several             their nearest common ancestor, and
//                                  failing that the shallowest claimant.
//                                  Seven roles answer each *-t4-forsvar
//                                  endpoint and the one at the root of
//                                  the tree is Forsvarskommandoen.
//   claimed by nobody              the slug table below
//   internal or system             nobody, by design. An operator's own
//                                  security desk is not an agency.
//
// Deriving beats tabulating here: the derivation cannot drift from the
// routing data because it IS the routing data, and a destination added
// later inherits an owner with no edit to this file.
//
// Matching on a prefix would be wrong and the trap is live. Amager
// Koblingsstation's site code is AMK, so its endpoints are amk-t2-politi
// and friends, while amk-hovedstaden is the Akutmedicinsk
// Koordinationscenter. A prefix rule counts a police endpoint as an
// ambulance service. Site scoping is tested with siteId, never a prefix.

import { ACCOUNTS, RECEIVERS } from './roles.js';
import { allDestinations, onDestinationsChange } from './destinations.js';
import { ASSETS } from './response_assets.js';

// ── Agencies that exist in the world and not in roles.js ─────────────
//
// Each of these is a real organisation that can be routed to and has no
// receiver profile, so nobody can open the case it is sent. That is a
// gap in the role tree, not a mapping to invent. Listed rather than
// guessed, so the list can be emptied deliberately.
export const NO_OWNING_ROLE = {
  'stm': 'Statsministeriet. No role models the prime minister\'s office.',
  'nost': 'NOST, the national operational staff. Not modelled.',
  'nap-baltic': 'NATO Air Policing Baltic. Not modelled.',
  'sektorber': 'Sektorberedskab Energi. Not modelled.',
  'entsoe': 'ENTSO-E. Not modelled.',
  'aircom': 'NATO Allied Air Command Ramstein. Not modelled.',
  'coastguard': 'Kystvagten. roles.js models no coast guard at all.',
  'kv-esbjerg': 'Kystvagten Esbjerg. As coastguard.',
};

// ── Slug table, for destinations no role claims ──────────────────────
//
// Only reached when the routing data is silent. Each decision is taken
// once per slug and applies at every site, which is why 134 unowned
// endpoints needed 26 decisions rather than 134.
const OWNER_BY_SLUG = {
  'aks': 'politi-aks',
  'hjv': 'hjv',
  'cfcs': 'agency-cfcs',
  'cta': 'pet-cta',
  'nc3': 'rigspoliti-nc3',
  'nordefco': 'nordic-nordefco',
  'europol': 'eu-europol',
  'kontrol': 'op-energinet',
  'enagency': 'agency-ener',
  'pet': 'pet',
  'rigspoliti': 'rigspoliti',
  'fe': 'fe',
  'beredskab': 'beredskab',
  'beredskab-fyn': 'kbr-fyn',
  'trekantbrand': 'kbr-trekantbrand',
  'traf': 'agency-traf',
  'trafikstyr': 'agency-traf',
  'jrcc': 'agency-jrcc-dk',
  'qra': 'flyvevaabnet',
  'qra-skrydstrup': 'flv-skrydstrup',
  'forsvar': 'forsvarskmd',
  'flv-luftfor': 'flyvevaabnet',
  'airforce': 'flyvevaabnet',
  'nato-airc': 'nato-caoc-uedem',
  'caoc': 'nato-caoc-uedem',
  'marcom': 'nato-marcom',
};

// ── Asset table ──────────────────────────────────────────────────────
//
// Written out rather than derived. Asset names are prose and matching
// them against role labels gets two districts wrong: "Københavns
// Vestegns Politi" and "Sydsjællands Politi" both contain a shorter
// agency's name and collapse to the national parent. A table of 40 is
// cheaper than a heuristic that is quietly wrong twice.
const OWNER_BY_ASSET = {
  'politi-kbh': 'politi-kbh',
  'politi-kbh-cuas': 'politi-kbh',
  'politi-vestegn': 'politi-vestegn',
  'politi-nord': 'politi-nordsj',
  'politi-sydsonderjyl': 'politi-sydsonderjyl',
  'politi-syd': 'politi-sydsjaelland',
  'politi-midtvest': 'politi-midtvestjyl',
  'politi-oestjyl': 'politi-ostjyl',
  'politi-nordjyl': 'politi-nordjyl',
  'politi-fyn': 'politi-fyn',
  'politi-sydoest': 'politi-sydostjyl',
  'politi-bornholm': 'politi-bornholm',
  'politi-midtsjael': 'politi-midtvestsjaelland',
  'rigspolitiet': 'rigspoliti',
  'politi-slotsholmen-interceptor': 'rigspoliti',
  'politi-national-cuas': 'rigspoliti',
  'flv-skrydstrup': 'flv-skrydstrup',
  'flv-aalborg': 'flv-aalborg',
  'flv-karup': 'flv-karup',
  'flv-karup-helo-intercept': 'flv-karup',
  'sov-frederikshavn': 'sov-frederikshavn',
  'sov-korsoer': 'sov-korsor',
  'hjv-kbh': 'hjv',
  'hjv-syd': 'hjv',
  'hjv-midt': 'hjv',
  'hjv-nord': 'hjv',
  'brs-hedehusene': 'brs-hedehusene',
  'brs-thisted': 'brs-thisted',
  'brs-haderslev': 'brs-haderslev',
  'forsvarskmd': 'forsvarskmd',
  'army-slagelse-isr': 'haer-slagelse',
  'army-slagelse-cuas': 'haer-slagelse',
  'army-hovelte-ground': 'haer-hovelte',
  'army-varde-isr': 'haer-varde',
  'army-varde-cuas': 'haer-varde',
  'army-varde-interceptor': 'haer-varde',
  'army-bornholm-cuas': 'haer-bornholm',
  'army-oksbol-training': 'haer-oksbol',
  'sof-aalborg-jaeger': 'sok-aalborg',
  'wildlife-cph': 'op-cph-airports',
};

// ── Derivation ───────────────────────────────────────────────────────

const _byId = new Map(ACCOUNTS.map((r) => [r.id, r]));

function _ancestry(id) {
  const out = [];
  let cur = _byId.get(id);
  while (cur) {
    out.push(cur.id);
    cur = cur.parentId ? _byId.get(cur.parentId) : null;
  }
  return out;
}

function _depth(id) {
  let n = 0;
  let cur = _byId.get(id);
  while (cur && cur.parentId) { n += 1; cur = _byId.get(cur.parentId); }
  return n;
}

function _commonAncestor(ids) {
  const chains = ids.map(_ancestry);
  for (const cand of chains[0] || []) {
    if (chains.every((c) => c.includes(cand))) return cand;
  }
  return null;
}

// destinationId -> [roleId, ...], straight from what roles declare.
const _claims = new Map();
for (const r of RECEIVERS) {
  for (const did of r.destinationIds || []) {
    if (!_claims.has(did)) _claims.set(did, []);
    _claims.get(did).push(r.id);
  }
}

function _slugOf(dest) {
  // Site-scoped ids are <site>-t<tier>-<slug>. Keyed off siteId rather
  // than a prefix, for the AMK reason in the header.
  if (!dest.siteId) return dest.id;
  const m = /^[a-z0-9]+-t\d+-(.+)$/.exec(dest.id);
  return m ? m[1] : dest.id;
}

const _destOwner = new Map();

function _deriveOwners() {
  _destOwner.clear();
  for (const d of allDestinations()) {
    if (!d?.id) continue;
    if (d.type === 'internal' || d.type === 'system') { _destOwner.set(d.id, null); continue; }
    const claimed = _claims.get(d.id) || [];
    let owner = null;
    if (claimed.length === 1) {
      owner = claimed[0];
    } else if (claimed.length > 1) {
      owner = _commonAncestor(claimed)
        || claimed.slice().sort((a, b) => _depth(a) - _depth(b))[0];
    } else {
      const slug = _slugOf(d);
      owner = OWNER_BY_SLUG[slug] || (_byId.has(d.id) ? d.id : null);
    }
    _destOwner.set(d.id, owner && _byId.has(owner) ? owner : null);
  }
}

_deriveOwners();

// Destinations are editable from the config view at runtime, and the map
// above was a load-time snapshot, so an added or removed endpoint left
// ownership wrong for the rest of the session. It only self-corrected on
// reload, because the edit is persisted and re-derived from storage.
onDestinationsChange(_deriveOwners);

// ── Public ───────────────────────────────────────────────────────────

/** The role that owns a routing endpoint, or null when none does. */
export function ownerRoleIdForDestination(destinationId) {
  if (!destinationId) return null;
  if (_destOwner.has(destinationId)) return _destOwner.get(destinationId);
  // Unknown id: a role-equal destination is its own owner.
  return _byId.has(destinationId) ? destinationId : null;
}

/** The role that owns a national-pool unit, or null when none does. */
export function ownerRoleIdForAsset(assetId) {
  if (!assetId) return null;
  const owner = OWNER_BY_ASSET[assetId];
  return owner && _byId.has(owner) ? owner : null;
}

/**
 * Whether an escalation to this endpoint reaches this role.
 *
 * A UNION of three things, and all three are needed.
 *
 *   the endpoint IS the role     the 27 site-independent destinations
 *   the role CLAIMS the endpoint it lists it in destinationIds, so the
 *                                escalation lands in its inbox
 *   the role OWNS the endpoint   derived above, for endpoints nobody
 *                                claims
 *
 * The claim arm is not redundant and leaving it out was a real defect.
 * Ownership is single-valued and some endpoints are genuinely shared:
 * both Skrydstrup and Karup answer every *-t4-qra, and the derived owner
 * is their parent, Flyvevåbnet, which claims none of them. Without the
 * claim arm, Skrydstrup has the escalation in its inbox and is still
 * absent from the incident report, which is the exact bug this module
 * was written to fix. It cost 58 pairs across ten defence roles.
 *
 * Inbox membership is the authority on who was reached. Ownership only
 * answers the different question of who the endpoint belongs to.
 */
export function roleOwnsDestination(roleId, destinationId) {
  if (!roleId || !destinationId) return false;
  if (destinationId === roleId) return true;
  if ((_claims.get(destinationId) || []).includes(roleId)) return true;
  return ownerRoleIdForDestination(destinationId) === roleId;
}

/** Every destination this role owns. */
export function destinationsOwnedBy(roleId) {
  const out = [];
  for (const [did, owner] of _destOwner) if (owner === roleId) out.push(did);
  return out;
}

/** Diagnostics for the id-namespace gate. */
export function ownershipCoverage() {
  let owned = 0; let unowned = 0; let internal = 0;
  for (const [, owner] of _destOwner) {
    if (owner) owned += 1; else internal += 1;
  }
  for (const a of ASSETS) {
    if (!a?.id) continue;
    if (ownerRoleIdForAsset(a.id)) owned += 1; else unowned += 1;
  }
  return { owned, unowned, internal, destinations: _destOwner.size, assets: ASSETS.length };
}
