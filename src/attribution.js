// ═══════════════════════════════════════════════════════════════════
// Attribution context — what the airframe is, and who flew it
// ───────────────────────────────────────────────────────────────────
// Receiver-tier site intelligence, roadmap §3.6. Intel archetype only.
//
// THE CENTRAL DISTINCTION, and the reason this module is structured the
// way it is:
//
//   PLATFORM    what the airframe is. Supportable from the neural-net
//               classification, because that is exactly what it was
//               trained to answer.
//   ORIGIN      who manufactures that class. A static fact about the
//               platform family, not an observation of this flight.
//   OPERATOR    who actually flew THIS aircraft. Almost never
//               supportable from sensor data alone.
//
// Conflating those three is how a detection product starts asserting
// that a state flew a drone at a Danish airport because the airframe
// was Iranian-made. Identifying a Shahed-class airframe with high
// confidence says nothing about who launched it. This module keeps the
// three claims separate, each with its own confidence and its own
// provenance, so a reader can never inherit confidence from one to
// another.
//
// DETECTION-ONLY: this renders context. It recommends nothing, triggers
// nothing, and makes no accusation the evidence does not carry.
//
// Operator attribution is left to an external intelligence feed a
// customer may provide. The seam is here; nothing is registered, and
// with nothing registered the module says so plainly rather than
// guessing.
// ═══════════════════════════════════════════════════════════════════

import { ARCHETYPES, archetypeFor } from './archetypes.js';
import { familyMetadata, FAMILIES, FAMILY_LIBRARY } from './families.js';

// Roadmap §5 access matrix: attribution is intel-tier only. Narrower
// than the historical pattern panel, which also serves forensic and
// coordination, because an attribution assessment read by someone
// without intelligence training is exactly the thing that turns into a
// claim nobody can support.
const _VISIBLE_ARCHETYPES = new Set([ARCHETYPES.INTEL]);

export function canSeeAttribution(role) {
  if (!role?.id) return false;
  const spec = archetypeFor(role.id);
  if (!spec) return false;
  if (_VISIBLE_ARCHETYPES.has(spec.primary)) return true;
  return (spec.secondary || []).some(a => _VISIBLE_ARCHETYPES.has(a));
}

// Confidence tiers, most to least. 'insufficient' is a real answer and
// the correct one more often than not.
export const CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MODERATE: 'moderate',
  LOW: 'low',
  INSUFFICIENT: 'insufficient',
});

// Where a claim came from. Every claim carries one; a claim with no
// stated provenance is not rendered.
export const PROVENANCE = Object.freeze({
  NN: 'neural-net classification',
  FAMILY: 'platform family library',
  PRECEDENT: 'prior events at this site',
  FEED: 'external intelligence feed',
});

// ── External feed seam ────────────────────────────────────────────
// A customer with an intelligence feed registers it here. It is the
// only thing that can ever produce an OPERATOR claim, because sensors
// observe airframes and not intent.
//
// Contract: (event, { family }) => [{ text, confidence, caveat? }]
// Must be synchronous and must not throw; a throwing source is skipped
// and logged rather than taking down the panel.
let _operatorSource = null;

export function registerAttributionSource(fn) {
  _operatorSource = typeof fn === 'function' ? fn : null;
}

export function hasAttributionSource() {
  return !!_operatorSource;
}

// Map a raw classification confidence to a tier.
//
// Deliberately conservative at the top. A classifier reporting 0.92 is
// not "high confidence" for an attribution claim that may end up in an
// intelligence assessment; it is a good classification. High is
// reserved for 0.95 and above.
export function confidenceTierFor(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return CONFIDENCE.INSUFFICIENT;
  if (score >= 0.95) return CONFIDENCE.HIGH;
  if (score >= 0.80) return CONFIDENCE.MODERATE;
  if (score >= 0.50) return CONFIDENCE.LOW;
  return CONFIDENCE.INSUFFICIENT;
}

// Build the assessment. Pure: no DOM, no storage, no network.
//
// `priors` is the precedent list from historical_pattern.getHistoricalPattern,
// passed IN rather than imported so this module stays testable and does
// not reach into the precedent store itself.
export function getAttributionAssessment(event, { priors = [], family: familyIn = null } = {}) {
  // The family is passed IN by the caller, which already resolves it
  // through the precedent index's extractFeatureFields, the same source
  // the historical pattern panel uses. Falling back to the subject class
  // keeps this module usable standalone and testable without reaching
  // into the precedent store.
  const raw = familyIn || event?.subject?.class || event?.platformFamily || null;

  // A family counts as resolved only if the library actually HAS it.
  //
  // Testing `raw !== FAMILIES.UNKNOWN` was not enough and shipped a
  // live bug: the common case is not the literal string 'unknown', it
  // is a label that is simply off-list, such as a bare platform name
  // like 'quadcopter'. familyMetadata() falls back to the UNKNOWN entry
  // for anything it does not recognise, and that entry carries
  // attribution_elaboration like every other family. So an unresolved
  // detection rendered "Classified as Unknown / unclassified" at
  // MODERATE confidence with 89% beside it, and printed the unknown
  // entry's own do-not-fabricate warning as if it were a finding.
  //
  // Membership in the library is the real question, so ask that.
  const resolved = raw && raw !== FAMILIES.UNKNOWN && FAMILY_LIBRARY[raw] ? raw : null;
  const meta = resolved ? familyMetadata(resolved) : null;
  const family = resolved;

  // The strongest signal the classifier gives us about what this is.
  const classScore = typeof event?.subject?.class_confidence === 'number'
    ? event.subject.class_confidence
    : (typeof event?.confidence === 'number' ? event.confidence : null);

  const claims = [];

  // 1. PLATFORM — what the airframe is.
  if (family) {
    claims.push({
      kind: 'platform',
      label: 'Platform',
      text: meta?.display_name
        ? `Classified as ${meta.display_name}.`
        : `Classified as ${family}.`,
      confidence: confidenceTierFor(classScore),
      provenance: PROVENANCE.NN,
      score: classScore,
    });
  } else {
    // Confidence is INSUFFICIENT regardless of the classifier's score.
    // "Classified as unknown, 97% confident" is a confident statement
    // that we do not know what this is, which is not an attribution.
    claims.push({
      kind: 'platform',
      label: 'Platform',
      text: raw
        ? `Classifier output "${raw}" is not a recognised platform family. No attribution can rest on it.`
        : 'No platform family resolved for this detection.',
      confidence: CONFIDENCE.INSUFFICIENT,
      provenance: PROVENANCE.NN,
      score: null,
    });
  }

  // 2. ORIGIN — what is known about the class itself.
  //
  // Confidence here is NOT the classifier's confidence. It is a
  // reference fact about the platform family, and it is only as good as
  // the platform claim beneath it: if we are not sure what the airframe
  // is, we cannot be sure whose airframe class it belongs to. So it is
  // capped by the platform tier and never exceeds it.
  const originLines = Array.isArray(meta?.attribution_elaboration) ? meta.attribution_elaboration : [];
  if (originLines.length) {
    const platformTier = claims[0].confidence;
    claims.push({
      kind: 'origin',
      label: 'Class origin',
      text: originLines.join(' '),
      confidence: platformTier === CONFIDENCE.HIGH ? CONFIDENCE.MODERATE : platformTier,
      provenance: PROVENANCE.FAMILY,
      score: null,
      caveat: 'Describes the platform class, not this flight.',
    });
  }

  // 3. PATTERN — corroboration from this site's own history.
  //
  // A repeat family at one site is a real intelligence signal, and it
  // is a statement about the PATTERN, never about an actor. Three prior
  // Shahed detections here do not identify who sent them.
  const samefam = priors.filter(p => p?.featureFields?.platform_family === family);
  if (samefam.length) {
    const hostile = samefam.filter(p => p.classification === 'hostile').length;
    claims.push({
      kind: 'pattern',
      label: 'Site pattern',
      text: `${samefam.length} prior detection${samefam.length === 1 ? '' : 's'} of this platform family at this site`
        + (hostile ? `, ${hostile} classified hostile.` : ', none classified hostile.'),
      // Corroboration strengthens with repetition but a pattern is
      // never more than moderate on its own.
      confidence: samefam.length >= 3 ? CONFIDENCE.MODERATE : CONFIDENCE.LOW,
      provenance: PROVENANCE.PRECEDENT,
      score: null,
      caveat: 'Recurrence at a site is not attribution of an actor.',
    });
  }

  // 4. OPERATOR — who flew this one.
  //
  // The whole reason the module exists is to be honest here. With no
  // external feed registered there is no basis for an operator claim,
  // and saying so is the correct output rather than an omission.
  if (_operatorSource) {
    try {
      const rows = _operatorSource(event, { family }) || [];
      for (const r of rows) {
        if (!r?.text) continue;
        claims.push({
          kind: 'operator',
          label: 'Operator',
          text: r.text,
          confidence: r.confidence || CONFIDENCE.LOW,
          provenance: PROVENANCE.FEED,
          score: null,
          caveat: r.caveat || null,
        });
      }
    } catch (err) {
      console.warn('[attribution] external source failed:', err?.message || err);
    }
  }
  if (!claims.some(c => c.kind === 'operator')) {
    claims.push({
      kind: 'operator',
      label: 'Operator',
      text: 'No basis for operator attribution. Sensor data identifies an airframe, not who launched it.',
      confidence: CONFIDENCE.INSUFFICIENT,
      provenance: PROVENANCE.FEED,
      score: null,
      caveat: hasAttributionSource() ? null : 'No external intelligence feed is connected.',
    });
  }

  return {
    family,
    displayName: meta?.display_name || family || null,
    claims,
    // The assessment as a whole is only as strong as its weakest
    // load-bearing claim, which is the platform identification. Nothing
    // above it can be firmer than it.
    overall: claims[0].confidence,
  };
}

// ── Rendering ─────────────────────────────────────────────────

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const _TIER_COLOR = {
  [CONFIDENCE.HIGH]: '#8fc9a8',
  [CONFIDENCE.MODERATE]: '#d8c37a',
  [CONFIDENCE.LOW]: '#d89a6a',
  [CONFIDENCE.INSUFFICIENT]: '#8a8f98',
};

export function renderAttributionPanel(event, activeRole, opts = {}) {
  if (!canSeeAttribution(activeRole)) return '';
  const { displayName, claims, overall } = getAttributionAssessment(event, opts);

  // Each claim is one row. The basis for it — provenance, score,
  // caveat — lives behind the info toggle on the right rather than as a
  // second grey line under every row. Four claims each carrying two
  // lines turned a reference panel into a wall of text, and the detail
  // is what you consult when you question a line, not what you read
  // every time.
  const rows = claims.map(c => {
    const detail = [
      `via ${_esc(c.provenance)}`,
      c.score != null ? `${Math.round(c.score * 100)}% classifier confidence` : null,
      c.caveat ? _esc(c.caveat) : null,
    ].filter(Boolean).join(' · ');
    return `
    <details class="attr-claim">
      <summary class="attr-claim-row">
        <span class="attr-claim-label">${_esc(c.label)}</span>
        <span class="attr-claim-tier" style="color:${_TIER_COLOR[c.confidence] || 'var(--text-dim)'};">${_esc(c.confidence)}</span>
        <span class="attr-claim-text">${_esc(c.text)}</span>
        <span class="attr-claim-info" title="Show the basis for this line">i</span>
      </summary>
      <div class="attr-claim-detail">${detail}</div>
    </details>`;
  }).join('');

  return `
    <div class="c-panel c-panel-collapsible" style="border-top: 3px solid #9d8ec9;">
      <div class="c-panel-title" style="margin-bottom: var(--space-2); color: #9d8ec9;">Attribution assessment</div>
      <div class="c-panel-body">
        <div class="attr-lede">
          ${displayName ? `Assessed platform: <span style="color:var(--text);">${_esc(displayName)}</span>. ` : ''}Overall confidence <span style="color:${_TIER_COLOR[overall] || 'var(--text-dim)'};">${_esc(overall)}</span>. Confidence is not inherited between lines.
        </div>
        ${rows}
      </div>
    </div>`;
}
