// What a receiver profile is offered on an event.
//
// Extracted verbatim from main.js. A PURE function over explicit inputs,
// importing only leaf data modules, which is the whole point: before
// this, the only way to ask "what does each of the 386 roles see" was to
// open a browser and click. Now it can be snapshotted and diffed.
//
// Two couplings were removed, both of which made the answer depend on
// ambient state:
//
//   the live counter-dispatch Map is injected as ctx.dispatches. It was
//   the one thing here genuinely tied to main()'s runtime.
//
//   roleId is REQUIRED. It used to fall back to the active role, so the
//   answer depended on who happened to be logged in. The only caller
//   always passed it anyway.
//
// WHAT THIS IS NOT, YET
//
// The body is still a hand-written ladder on agency branch plus exact-id
// tests. Moving it onto the archetype engine is the point of the
// exercise and is deliberately NOT in this change: the extraction has to
// be provably behaviour-neutral first, so that there is a baseline to
// diff the real change against.

import { RECEIVERS, OPERATORS, ADMIN, agencyBranchOf } from './roles.js';
import { assetsForReceiverRole } from './receiver_assets.js';
import { sceneReleaseState } from './scene_lifecycle.js';
import { releasedWreckageIds } from './events.js';
import { contextForSite } from './site_context.js';

// Of the stub actions in main.js's STUB_DISPATCH_ACTIONS, these are the
// ones that claim to put
// physical units on the ground or in the air. They are withheld from any
// profile with no entry in RECEIVER_ASSETS, because offering them tells
// an operator they command something the system has no record of. The
// rest of the stub set is administrative — a NOTAM, an airspace
// restriction, a shelter notification, an intel log — and needs no
// vehicle, so it is offered regardless.
export const PHYSICAL_DISPATCH_ACTIONS = new Set([
  'deploy-patrol', 'set-cordon',
  'brs-standby', 'brs-deploy',
  'army-c-uas', 'army-ground',
  'qra-dispatch',
  'hjv-reinforce',
  'region-ambulance-standby',
]);

// ═══════════════════════════════════════════════════════════════════
// Phase 2 · availableCTAsForReceiver
//
// Role-scoped CTA generation. Given a receiver profile id + an event
// + context, returns the ordered list of CTAs THIS role sees on
// THIS event. Replaces every `if role === X` hardcode in the UI.
//
// Scope logic:
//   - Observers see no action CTAs (only Add note, Loop in another,
//     Promote to actor).
//   - Actors see role-branch-appropriate action CTAs plus universal
//     ones (Acknowledge, Add note, Respond, Cascade, Handoff peer).
//
// Branch → action map:
//   POLITI actors      → Deploy patrol, Perimeter cordon, Request AKS
//   BRS actors         → Standby, Full deployment
//   FORSVARET aviation → Scramble Air Force fighter (missile/hostile air)
//   FORSVARET army     → Deploy army C-UAS, Deploy ground force
//   FORSVARET intel    → Log to intel picture (no active response)
//   AGENCY regulator   → Issue airspace advisory, Restrict airspace
//   MUNICIPAL          → Alert crisis staff, Shelter-in-place
//   HJV                → Reinforce guard, Perimeter patrol
//   REGION             → Ambulance standby, Casualty triage prep
//
// Universal (all actors): Acknowledge, Add note, Respond, Cascade to
// FE/PET (if not self), Cascade to local Politi (if not self),
// Handoff to peer district, Escalate to parent, Loop in observer.
//
// Observers see: Promote to actor, Add note.
// ═══════════════════════════════════════════════════════════════════
// Site-capability filter for branch-specific CTAs.
//
// Reads `response_capabilities: [...]` off the site's context (from
// site_context.js). If the array is DECLARED, only actions listed
// are allowed at that site. If the array is UNDECLARED (missing),
// fallback is PERMISSIVE — every action passes. Matches Q1(a) from
// the founder's greenlight: non-breaking for existing sites.
//
// Combines ADDITIVELY with existing role + threat-type gates (Q2a):
// an action must pass role gate AND threat gate AND site gate to
// render. Removing the site declaration reverts to today's behavior.
//
// Universals (ack, respond, add-note, observer-*, cascade-politi,
// cascade-fe-pet, intel-log, qra-dispatch) are NEVER filtered by
// site — they're either operational primitives or national-level
// capabilities that ignore site.
function _siteAllowsAction(event, action) {
  if (!event?.siteId) return true;
  const siteCtx = contextForSite(event.siteId);
  const caps = siteCtx?.response_capabilities;
  if (!Array.isArray(caps)) return true;   // permissive fallback (Q1a)
  return caps.includes(action);
}

export function availableCTAsForReceiver(roleId, event, ctx = {}) {
  // dispatches defaults to empty rather than throwing. A caller that
  // omits it gets the same answer as a caller on an event with nothing
  // dispatched, which is the honest reading of "I did not tell you".
  const { rec, isAcked, isActive, dispatches = [] } = ctx;
  const ctas = [];
  if (!event) return ctas;
  const role = RECEIVERS.find(r => r.id === roleId)
            || OPERATORS.find(o => o.id === roleId)
            || (roleId === ADMIN.id ? ADMIN : null);
  if (!role) return ctas;

  // Participant mode: default 'actor' if not explicitly observer.
  const participant = event.participants instanceof Map
    ? event.participants.get(roleId)
    : null;
  const mode = participant?.mode || 'actor';
  const isObserver = mode === 'observer';

  // OBSERVER short-circuit — only promotion + note.
  if (isObserver) {
    ctas.push({
      label: 'Promote to actor', sub: 'Take response ownership', icon: '⇧', tone: 'primary',
      action: 'observer-promote',
      category: 'case',
      tooltip: 'Requests actor status on this event. Any current actor can approve.',
    });
    ctas.push({
      label: 'Add note', sub: 'Append to audit trail', icon: '✎', tone: 'neutral',
      action: 'add-note',
      category: 'audit',
      tooltip: 'Appends a note to the event audit trail. Visible to all participants.',
    });
    return ctas;
  }

  // ACTOR path. Universal actor CTAs first (acknowledge > branch-specific > cascade > respond).
  if (rec && !isAcked) {
    ctas.push({
      label: 'Acknowledge receipt', sub: 'Confirm you have the case', icon: '✓', tone: 'primary',
      action: 'ack', esc: rec.id,
      category: 'case',
      tooltip: 'Sends acknowledgement to the operator. Records the acknowledgement in the audit trail.',
    });
  }

  // Branch-specific CTAs
  const branch = agencyBranchOf?.(roleId);
  const isPolitiBranch    = branch === 'politi';
  const isForsvaretBranch = branch === 'forsvaret';
  const isBrsBranch       = branch === 'brs';
  const isHjvBranch       = branch === 'hjv';
  const isRegionBranch    = branch === 'region';
  const isAgencyBranch    = branch === 'agency';
  const isKommune         = roleId.startsWith('kom-');
  const roleScope         = role.scope || '';

  // Receiver asset library injection. Roles defined in
  // receiver_assets.js get REAL dispatch buttons (spawn assets from
  // their home base coordinate, animate to incident, state machine
  // through en_route to engaging to complete) instead of the older
  // stub buttons. Direct assets fire the receiver-dispatch handler.
  // Request-only assets fire receiver-request which routes the
  // request to another profile's inbox. See receiver_assets.js and
  // dispatchReceiverAsset in this file for the full flow.
  // Wreckage on the ground is a live physical scene even though the
  // detection event has closed. The consequence cascade reaches
  // medical, fire and heavy rescue only AFTER the close, so gating
  // their vehicles on the event being active left five agencies
  // holding full asset kits they could never reach.
  //
  // Deliberately the only one of the fourteen isActive reads in this
  // render that is relaxed. The others gate airspace notices, army
  // and air force tasking and intelligence requests, none of which
  // make sense against an airframe already on the ground.
  const _wreckagePhase = Array.isArray(event.wreckages) && event.wreckages.length > 0;
  const _receiverAssetSpec = (isActive || _wreckagePhase) ? assetsForReceiverRole(roleId) : null;
  if (_receiverAssetSpec) {
    // Dispatchable assets: fire from profile's own home base.
    // Descriptive metadata (useCases, deployTime, limitations)
    // surfaces as multi-line tooltip so operators understand
    // capability before clicking. See receiver_assets.js schema
    // and docs/agentic-receiver-asset-plugin-architecture.md.
    _receiverAssetSpec.dispatchable.forEach(a => {
      const countStr = a.count && a.count > 1 ? ` (${a.count} units)` : '';
      const useCasesStr = Array.isArray(a.useCases) && a.useCases.length
        ? `\n\nUse cases:\n- ${a.useCases.join('\n- ')}`
        : '';
      const deployStr = a.deployTime ? `\n\nDeploy time: ${a.deployTime}` : '';
      const limitStr = a.limitations ? `\n\nLimitations: ${a.limitations}` : '';
      ctas.push({
        label: a.name || a.label,
        sub: `${a.count && a.count > 1 ? a.count + ' units available' : 'Single unit'}`,
        icon: a.icon,
        tone: 'accent',
        action: 'receiver-dispatch',
        assetKey: a.assetKey,
        category: 'dispatch',
        tooltip: `${a.name}${countStr}.${useCasesStr}${deployStr}${limitStr}`,
      });
    });
    // Requestable assets: route to another profile that owns the
    // capability. Same metadata surface applies.
    _receiverAssetSpec.requestable.forEach(r => {
      const useCasesStr = Array.isArray(r.useCases) && r.useCases.length
        ? `\n\nUse cases:\n- ${r.useCases.join('\n- ')}`
        : '';
      const expectedStr = r.expectedResponse ? `\n\nExpected response: ${r.expectedResponse}` : '';
      ctas.push({
        label: `Request ${r.name.toLowerCase()}`,
        sub: `Routes to ${r.from}. Priority ${r.priority || 'standard'}`,
        icon: '↗',
        tone: 'neutral',
        action: 'receiver-request',
        requestId: r.requestKey,
        category: 'request',
        tooltip: `Request ${r.name} from ${r.from}. They see the request in their inbox and dispatch their own asset.${useCasesStr}${expectedStr}`,
      });
    });
  }

  // Scene command — release the scene.
  //
  // Deliberately OUTSIDE the !_receiverAssetSpec guard below. This is
  // not an asset dispatch, it is the incident commander recording
  // that the scene is released, so it applies to every police
  // district whether or not it has an asset library yet.
  //
  // Not gated on isActive either. A cordon outlives the detection
  // event: the drone is down and the track is closed long before the
  // perimeter lifts, which is exactly the window in which this
  // control is needed.
  //
  // Whether to offer it is decided in src/scene_lifecycle.js so the
  // predicate lives next to the sweep that consumes it.
  if (isPolitiBranch) {
    const _sceneRelease = sceneReleaseState({
      hasSceneCommand: true,
      releasedWreckageIds: releasedWreckageIds(event),
      // Injected rather than read from the tick loop's own Map. That Map
      // was the one thing here genuinely tied to main()'s runtime state,
      // and it is why this could not be snapshotted before.
      dispatches: dispatches.filter(d => d.eventId === event.id),
    });
    if (_sceneRelease.offered) {
      const _enRoute = _sceneRelease.attachedCount - _sceneRelease.holdingCount;
      // Named by site count when a swarm has put more than one
      // airframe down, because releasing one crash site does not
      // release the others.
      const _sites = _sceneRelease.wreckageIds.length;
      ctas.push({
        label: _sites > 1 ? `Record ${_sites} scenes released` : 'Record scene released',
        sub: _enRoute > 0
          ? `${_sceneRelease.holdingCount} on cordon, ${_enRoute} still en route`
          : `${_sceneRelease.holdingCount} unit${_sceneRelease.holdingCount === 1 ? '' : 's'} on cordon`,
        icon: '⏻', tone: 'neutral',
        action: 'record-scene-release',
        category: 'case',
        tooltip: 'Records that police scene command has released the crash site or sites currently being held. Every unit on those cordons stands down and returns to base, and units still en route stand down on arrival. A crash site that appears later is a separate scene and is released separately. Recorded in the audit trail against this account.',
      });
    }
  }

  // Politi actors — legacy stub buttons. Only rendered when the
  // role does NOT have a defined asset library yet (older Politi
  // districts pending real asset spec). Once assetsForReceiverRole
  // returns a spec for the role, these stubs are skipped.
  if (isActive && isPolitiBranch && !_receiverAssetSpec) {
    if (_siteAllowsAction(event, 'deploy-patrol')) ctas.push({
      label: 'Deploy patrol', sub: 'Local district cars', icon: '▸', tone: 'accent',
      action: 'deploy-patrol',
      category: 'dispatch',
      tooltip: 'Dispatches district patrol cars to the incident site. Confirms via radio when on scene.',
    });
    if (_siteAllowsAction(event, 'set-cordon')) ctas.push({
      label: 'Set up perimeter cordon', sub: 'Afspær området', icon: '⚑', tone: 'accent',
      action: 'set-cordon',
      category: 'dispatch',
      tooltip: 'Establishes a physical perimeter cordon around the affected area. Coordinates with local fire and medical.',
    });
    // Only regional Politi (not HQ, not specialty) requests AKS backup — AND site must declare aks capability
    if (role.parentId === 'politi' && !roleId.startsWith('politi-special') && _siteAllowsAction(event, 'request-aks')) {
      ctas.push({
        label: 'Request tactical intervention', sub: 'Aktionsstyrken, national police tactical unit', icon: '↗', tone: 'neutral',
        action: 'request-aks',
        category: 'request',
        tooltip: 'Requests Aktionsstyrken, the Danish national police tactical unit, for armed or hostage-taking incidents.',
      });
    }
  }

  // Beredskabsstyrelsen (Danish Emergency Management Agency) actors
  if (isActive && isBrsBranch) {
    if (_siteAllowsAction(event, 'brs-standby')) ctas.push({
      label: 'Standby response', sub: 'Beredskabsstyrelsen teams on alert', icon: '◷', tone: 'accent',
      action: 'brs-standby',
      category: 'dispatch',
      tooltip: 'Places Beredskabsstyrelsen, the Danish Emergency Management Agency, response teams on active standby without deploying yet.',
    });
    if (_siteAllowsAction(event, 'brs-deploy')) ctas.push({
      label: 'Full deployment', sub: 'Beredskabsstyrelsen: hazmat, rescue, medical', icon: '≡', tone: 'accent',
      action: 'brs-deploy',
      category: 'dispatch',
      tooltip: 'Full Beredskabsstyrelsen deployment. Chemical, biological, radiological, nuclear, rescue, and medical teams en route.',
    });
  }

  // Forsvaret aviation (Flyvevåbnet) actors
  const isFlyv = roleId.startsWith('flv-') || role.parentId === 'flyvevaabnet';
  if (isActive && isForsvaretBranch && isFlyv && (event.platform === 'missile' || (event.classification === 'hostile' && ['fixed-wing', 'jet', 'quadcopter'].includes(event.platform)))) {
    ctas.push({
      label: 'Scramble Air Force fighter', sub: 'On-call squadron', icon: '↗', tone: 'accent',
      action: 'qra-dispatch',
      category: 'dispatch',
      tooltip: 'Requests fighter intercept from the on-call squadron. Only available while the event is active.',
    });
  }

  // Forsvaret army (Hæren) actors
  const isHaer = roleId.startsWith('haer-') || role.parentId === 'haeren';
  if (isActive && isForsvaretBranch && isHaer) {
    if (_siteAllowsAction(event, 'army-c-uas')) ctas.push({
      label: 'Deploy army counter drone unit', sub: 'Radio frequency and electronic warfare', icon: '↗', tone: 'neutral',
      action: 'army-c-uas',
      category: 'dispatch',
      tooltip: 'Requests army counter drone unit deployment. Radio frequency jamming and electronic warfare capability.',
    });
    if (_siteAllowsAction(event, 'army-ground')) ctas.push({
      label: 'Deploy ground force', sub: 'Rapid reinforcement', icon: '▲', tone: 'neutral',
      action: 'army-ground',
      category: 'dispatch',
      tooltip: 'Requests army ground reinforcement to hold cordon or protect infrastructure.',
    });
  }

  // Forsvaret intel (FE, CFCS) — observer-style, no active response
  const isIntel = roleId === 'fe' || roleId.startsWith('agency-cfcs') || roleId === 'forsvar-intel';
  if (isActive && isForsvaretBranch && isIntel) {
    ctas.push({
      label: 'Log to intel picture', sub: 'Pattern-of-life analysis', icon: '≣', tone: 'neutral',
      action: 'intel-log',
      category: 'dispatch',
      tooltip: 'Adds this event to the intelligence picture for pattern-of-life analysis. No active response.',
    });
  }

  // Agency (Trafikstyrelsen — aviation regulator)
  if (isActive && isAgencyBranch && roleId === 'agency-traf' && ['quadcopter', 'fixed-wing', 'jet', 'missile'].includes(event.platform)) {
    if (_siteAllowsAction(event, 'issue-notam')) ctas.push({
      label: 'Issue airspace advisory', sub: 'NOTAM push', icon: '⇡', tone: 'accent',
      action: 'issue-notam',
      category: 'dispatch',
      tooltip: 'Issues NOTAM airspace advisory for the affected zone. Distributed to Eurocontrol.',
    });
    if (_siteAllowsAction(event, 'restrict-airspace')) ctas.push({
      label: 'Restrict airspace', sub: 'Full closure order', icon: '⊘', tone: 'danger',
      action: 'restrict-airspace',
      category: 'dispatch',
      tooltip: 'Full airspace closure order for the affected zone. Requires ministerial sign-off in production.',
    });
  }

  // Agency (Søfartsstyrelsen — maritime regulator)
  if (isActive && isAgencyBranch && roleId === 'agency-sof' && (roleScope === 'maritime' || event.siteId === 'esbjerg')) {
    if (_siteAllowsAction(event, 'issue-maritime-advisory')) ctas.push({
      label: 'Issue maritime advisory', sub: 'Coast guard notice', icon: '⇡', tone: 'accent',
      action: 'issue-maritime-advisory',
      category: 'dispatch',
      tooltip: 'Issues advisory to coast guard and maritime traffic in affected zone.',
    });
  }

  // Kommune (municipal crisis staff)
  if (isActive && isKommune) {
    if (_siteAllowsAction(event, 'kom-crisis')) ctas.push({
      label: 'Alert kommune crisis staff', sub: 'Municipal war-room', icon: '◆', tone: 'accent',
      action: 'kom-crisis',
      category: 'dispatch',
      tooltip: 'Alerts the municipal crisis staff. Activates local emergency plan.',
    });
    if (event.classification === 'hostile' && event.threat === 'high' && _siteAllowsAction(event, 'kom-shelter')) {
      ctas.push({
        label: 'Shelter-in-place notification', sub: 'Public alert', icon: '⌂', tone: 'danger',
        action: 'kom-shelter',
        category: 'dispatch',
        tooltip: 'Broadcasts shelter-in-place notification to residents in affected zone via SMS + siren.',
      });
    }
  }

  // Hjemmeværnet (Danish Home Guard) actors
  if (isActive && isHjvBranch) {
    if (_siteAllowsAction(event, 'hjv-reinforce')) ctas.push({
      label: 'Reinforce guard', sub: 'Hjemmeværnet volunteer callout', icon: '◈', tone: 'neutral',
      action: 'hjv-reinforce',
      category: 'dispatch',
      tooltip: 'Calls out Hjemmeværnet, the Danish Home Guard, volunteer patrols to reinforce perimeter or hold cordon.',
    });
  }

  // Region (ambulance + hospital coordination)
  if (isActive && isRegionBranch) {
    if (_siteAllowsAction(event, 'region-ambulance-standby')) ctas.push({
      label: 'Ambulance standby', sub: 'Regional 112 alerted', icon: '✚', tone: 'accent',
      action: 'region-ambulance-standby',
      category: 'dispatch',
      tooltip: 'Puts regional ambulance service on active standby for casualty response.',
    });
    if (event.classification === 'hostile' && event.threat === 'high' && _siteAllowsAction(event, 'region-triage-prep')) {
      ctas.push({
        label: 'Casualty triage prep', sub: 'Regional hospitals', icon: '✚', tone: 'danger',
        action: 'region-triage-prep',
        category: 'dispatch',
        tooltip: 'Alerts regional hospitals to prepare mass-casualty triage.',
      });
    }
  }

  // Universal actor CTAs (cascade, handoff, respond, note, loop-in)
  if (isActive && !isPolitiBranch) {
    ctas.push({
      label: 'Cascade to local police', sub: 'Politikreds (local police district) coordination', icon: '⚑', tone: 'neutral',
      action: 'cascade-politi',
      category: 'request',
      tooltip: 'Cascades this event to the local Politikreds (Danish police district) responsible for this site.',
    });
  }
  if (isActive && !isIntel && roleId !== 'fe' && roleId !== 'pet') {
    ctas.push({
      label: 'Cascade to intelligence services', sub: 'Forsvarets Efterretningstjeneste and Politiets Efterretningstjeneste', icon: '⇧', tone: 'neutral',
      action: 'cascade-fe-pet',
      category: 'request',
      tooltip: 'Cascades this event to Forsvarets Efterretningstjeneste, the Danish Defence Intelligence Service, and Politiets Efterretningstjeneste, the Danish Security and Intelligence Service.',
    });
  }
  if (isActive) {
    ctas.push({
      label: 'Cascade to any agency', sub: 'Full picker across all archetypes', icon: '⌖', tone: 'neutral',
      action: 'cascade-any',
      category: 'request',
      tooltip: 'Opens the full archetype-grouped picker. Type-ahead search across every registered receiver plus recommended defaults tailored to this event.',
    });
  }
  ctas.push({
    label: 'Loop in observer', sub: 'Add role to case', icon: '⊕', tone: 'neutral',
    action: 'observer-add',
    category: 'audit',
    tooltip: 'Adds another role to this event as an observer. They receive notifications but no CTAs unless promoted.',
  });
  if (rec) {
    // Sender label: cascade recipients see "Reply to Rigspolitiet",
    // direct-escalation recipients see "Reply to operator". Keeps the
    // action generic while making the target clear in the CTA subline.
    const _senderLabel = rec.assessmentPackage?.requesterRoleId
      ? (RECEIVERS.find(r => r.id === rec.assessmentPackage.requesterRoleId)?.org
         || RECEIVERS.find(r => r.id === rec.assessmentPackage.requesterRoleId)?.label
         || 'sender')
      : 'operator';
    ctas.push({
      label: 'Reply',
      sub: `Send back to ${_senderLabel}`,
      icon: '↩',
      tone: 'neutral',
      action: 'respond-open', esc: rec.id,
      category: 'case',
      tooltip: `Opens the reply composer. Reply lands in ${_senderLabel}'s case-file as a threaded response.`,
    });
    // Explicit status update — freeform advancement of progressStatus
    // + optional blocked-reason. Auto-advance from physical-response
    // CTAs covers the common "in-progress" path; this CTA covers the
    // resolve, blocked, and any freeform re-set path the receiver needs.
    ctas.push({
      label: 'Update status', sub: 'In progress · Resolved · Blocked', icon: '⇄', tone: 'neutral',
      action: 'update-status', esc: rec.id,
      category: 'case',
      tooltip: 'Sets the progress state on this case. Blocked requires a reason. Visible in the operator log.',
    });
    // Reject cascade — receiver declines to act on this cascade
    // (wrong jurisdiction, no capacity, out-of-scope for their
    // role). Requires a reason. Optional backup suggestion.
    // Idempotent per events.js rejectEscalation. Only offered when
    // the cascade isn't already rejected / withdrawn / closed.
    if (rec.status !== 'rejected' && rec.status !== 'withdrawn') {
      ctas.push({
        label: 'Decline cascade', sub: 'Wrong jurisdiction / no capacity / out-of-scope', icon: '⊘', tone: 'warn',
        action: 'cascade-reject', esc: rec.id,
        category: 'case',
        tooltip: `Declines this cascade with a reason visible to ${_senderLabel}. Sender can then route to a suggested backup or another agency.`,
      });
    }
  }
  ctas.push({
    label: 'Add note', sub: 'Append to audit trail', icon: '✎', tone: 'neutral',
    action: 'add-note',
    category: 'audit',
    tooltip: 'Appends a note to the event audit trail. Visible to all participants.',
  });

  // A profile with no declared inventory must not be offered buttons
  // that claim to move physical units.
  //
  // The group these sit in is captioned "Units this profile controls
  // directly", and the politi pair was rendered on the condition
  // `!_receiverAssetSpec` — that is, precisely BECAUSE the system held
  // no record of the profile controlling anything. 18 of 21 police
  // districts land there, and clicking either one fires a mock that
  // moves nothing.
  //
  // Scoped to actions that put people or vehicles somewhere. An agency
  // can legitimately issue a NOTAM, restrict airspace, alert a crisis
  // staff or log to the intel picture without owning a single vehicle,
  // so those stay. Requests to other agencies stay too: asking someone
  // else to send a unit does not require owning one.
  if (!_receiverAssetSpec) {
    return ctas.filter(c => !PHYSICAL_DISPATCH_ACTIONS.has(c.action));
  }
  return ctas;
}
