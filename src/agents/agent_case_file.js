// Agent 3 (Case File) — Live-Event Narrative
//
// Real-time briefing for an active event. Fires from the receiver
// inbox and detail panel when an operator is actively working an
// incident. Different from Agent B (Debrief) because the event is
// live, telemetry is incomplete, and the recommendation is about
// what to do NEXT, not what happened. Same transport, same writing
// rules, same delimited body/reco output shape.
//
// See docs/agentic-architecture.md §Agent 3 for the full spec.

import {
  isMistralConfigured,
  streamCompletionValidated,
  WRITING_RULES,
  OUTPUT_FORMAT,
} from '../mistral_client.js';
import { subjectFromEvent, renderSubjectDigest } from '../detection_subject.js';

// Base contract caps for the live case-file (IDD IF-9.3). Agent 3
// always uses these — no tier variation, unlike Agent B debrief.
const _CASE_FILE_CAPS = { body: 500, reco: 200 };

// Deterministic fallback. Substitutes if two consecutive Mistral
// attempts fail validation. model_version gets suffixed '-fallback'
// so the substitution is visible in downstream audits.
function _caseFileFallback(event) {
  const droneType = event.droneType || event.platform || 'unknown platform';
  const cls = event.classification || 'unknown';
  return {
    body: `Case-file substituted from deterministic template after model validation failed. ${droneType} tracked, classification ${cls}. See event details for full context.`,
    recommendation: 'Review the raw trajectory + sensor evidence manually. Model output did not meet writing-rule constraints.',
  };
}

function buildCaseFileMessages(event, site, siteDigest, cooperativeCheckBlock) {
  const siteName = site?.name || event.siteId || 'unknown site';
  const threat = event.threat || 'unassessed';
  const classification = event.classification || 'unknown';
  const startedAt = event.startTime || new Date().toISOString();
  const linked = event.linkedEventIds?.length || 0;

  // Rich structured detection subject — canonical shape attached to
  // event.subject by events.js. Fall back to on-demand derivation for
  // events created outside addEvent() (defensive guard, should not
  // fire once every consumer goes through addEvent). See
  // detection_subject.js for the full schema.
  const subject = event.subject || subjectFromEvent(event);
  const subjectDigest = renderSubjectDigest(subject);

  const systemPrompt = [
    'You are an intelligence analyst producing a concise live-event briefing for a Danish critical-infrastructure operator.',
    '',
    'The DETECTION SUBJECT block below is the fused output of the sensor mesh neural network. Every field is a distinct NN output head — trust the labeled values, do not confabulate around missing ones. Ground your briefing in the specific class, cardinality, formation, behavior, and sensor evidence provided.',
    '',
    'Writing rules:',
    '- ' + WRITING_RULES,
    OUTPUT_FORMAT,
  ].join('\n');

  // Explicit platform count from droneType label (e.g. "5x DJI Matrice
  // formation (recon swarm)" → count = 5). Subject-digest cardinality
  // defaults to 1 when event.droneCount isn't set, so the model
  // otherwise describes a swarm as a single drone. Give it the count
  // directly.
  const droneTypeStr = event.droneType || 'unknown platform';
  const _countMatch = droneTypeStr.match(/^\s*(\d+)\s*x/i);
  const parsedCount = _countMatch ? parseInt(_countMatch[1], 10) : null;
  const platformLabelLine = `Platform label (as classified by operator): ${droneTypeStr}`;
  const platformCountLine = parsedCount && parsedCount > 1
    ? `Platform count: ${parsedCount} distinct drones in this event. This is a MULTI-DRONE FORMATION — describe it as a formation / swarm, not a single drone.`
    : `Platform count: as indicated by platform label above.`;

  // Cooperative traffic cross-check block — preformatted by
  // cooperative_traffic_reconciler.js. Included when the site has
  // cooperative_traffic config AND the feed responded. See
  // docs/agentic-cooperative-traffic-fusion-architecture.md.
  const cooperativeSection = cooperativeCheckBlock ? ['', cooperativeCheckBlock] : [];

  const userPrompt = [
    `Event ID: ${event.id}`,
    `Site: ${siteName}`,
    `Operator threat assessment: ${threat}`,
    `Operator classification bucket: ${classification}`,
    `First detected: ${startedAt}`,
    `Correlated events at other sites: ${linked}`,
    platformLabelLine,
    platformCountLine,
    '',
    subjectDigest,
    ...cooperativeSection,
    '',
    'Produce the operator briefing using the rules and format above. Lead the body with what the sensor mesh actually saw (class, cardinality, formation, behavior). Match the platform count exactly. When a COOPERATIVE TRAFFIC CROSS-CHECK block is present, ground your classification narrative in it — matched tracks imply friendly, absence at expected-traffic sites strengthens the non-cooperative hypothesis. Do not restate the site name in the recommendation.',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    // Persistent site intelligence brief from Agent A. Same shape and
    // wording rationale as agent_b_debrief.js:279-288 — separate system
    // message so the model treats it as background context rather than
    // event-specific data. Optional: omitted when the caller doesn't
    // pass a digest (back-compat) or when Agent A hasn't produced one
    // yet for this site.
    ...(siteDigest ? [{
      role: 'system',
      content: [
        'PERSISTENT SITE INTELLIGENCE BRIEF (Agent A)',
        '─────────────────────────────────────────────',
        siteDigest,
        '',
        'Use this brief as background context when interpreting the live event. Reference specific assets and doctrine from the brief when explaining what the observed activity likely means at this site.',
      ].join('\n'),
    }] : []),
    { role: 'user', content: userPrompt },
  ];
}

// Public streaming API. Same callback shape as Agent B.
//
// siteDigest is optional. When provided, Agent A's persistent site
// intelligence brief is injected as a second system message so the
// live-event narrative is grounded in the same doctrine + asset context
// as the post-event debrief. Callers that don't pass it get the legacy
// behaviour (no digest, thinner grounding).
//
// cooperativeCheckBlock is optional. When provided, the pre-formatted
// COOPERATIVE TRAFFIC CROSS-CHECK block from cooperative_traffic_reconciler
// gets injected into the user prompt so the model classifies the event
// against real cooperative-track evidence. Callers should resolve via
// checkCooperativeTraffic(event, siteContext) before invoking. See
// docs/agentic-cooperative-traffic-fusion-architecture.md.
//
// See docs/agentic-architecture.md §Agent 3 and IDD IF-9.3.
export function streamCaseFileNarrative(event, site, callbacks, siteDigest, cooperativeCheckBlock) {
  if (!isMistralConfigured()) {
    callbacks.onError?.(new Error('Mistral not configured'));
    return;
  }
  const messages = buildCaseFileMessages(event, site, siteDigest, cooperativeCheckBlock);
  // Route through validate + auto-retry + fallback wrapper. Base
  // contract caps (500 char body, 200 char reco). If two consecutive
  // Mistral attempts violate the writing rules, deterministic fallback
  // substitutes with '-fallback' suffix on model_version.
  streamCompletionValidated(messages, callbacks, {
    validationRules: {
      maxBodyChars: _CASE_FILE_CAPS.body,
      maxRecoChars: _CASE_FILE_CAPS.reco,
      requireDelimiter: true,
      bannedFillerWords: true,
      bannedEmDash: true,
      bannedSemicolon: true,
    },
    fallback: _caseFileFallback(event),
  });
}
