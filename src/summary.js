// Detection Brief generator.
// Renders a Palantir-Foundry / Anduril-Lattice style intelligence brief for
// escalation payloads. Same HTML is used for on-screen preview and for
// print-to-PDF via the browser. Tone: professional, no slang.

import { responseBundle } from './response_assets.js';
import { siteName } from './events.js';

// Bearing helper: converts a heading in degrees to an 8-point compass origin/direction.
// heading is the platform's direction of travel; origin is computed by adding 180°.
// 8-point matches aviation and modern military reporting (16-point is nautical/legacy).
const COMPASS_8 = ['N','NE','E','SE','S','SW','W','NW'];
function compassFromHeading(heading) { return COMPASS_8[Math.round(heading / 45) % 8]; }
function compassFromOrigin(heading) {
  const origin = (heading + 180) % 360;
  return COMPASS_8[Math.round(origin / 45) % 8];
}

function threatColor(cls, threat) {
  if (cls === 'friendly') return { bg: 'rgba(255,184,77,0.10)', border: '#ffb84d', label: 'FRIENDLY' };
  if (cls === 'resolved') return { bg: 'rgba(180,200,220,0.06)', border: '#8892a4', label: 'RESOLVED' };
  if (threat === 'high' || cls === 'hostile') return { bg: 'rgba(255,56,56,0.10)', border: '#ff3838', label: 'HOSTILE' };
  return { bg: 'rgba(255,140,61,0.10)', border: '#ff8c3d', label: 'UNKNOWN' };
}

function threatLevelLabel(cls, threat, platform) {
  if (platform === 'missile') return 'CRITICAL';
  if (cls === 'hostile' && threat === 'high') return 'HIGH';
  if (cls === 'hostile' && threat === 'medium') return 'MEDIUM';
  if (cls === 'friendly') return 'NON THREAT';
  if (cls === 'resolved') return 'DISMISSED';
  return 'PENDING ASSESSMENT';
}

function platformLabel(platform) {
  return {
    'quadcopter': 'Rotary wing UAS',
    'fixed-wing': 'Fixed wing UAS',
    'jet': 'Jet aircraft',
    'missile': 'Cruise missile class',
  }[platform] || 'Unclassified airborne platform';
}

function recommendedAction(event) {
  const cls = event.classification;
  const platform = event.platform || 'quadcopter';
  const threat = event.threat;
  if (cls === 'friendly') return 'No action required. Detection logged to audit record.';
  if (cls === 'resolved') return 'No action required. Signal already dismissed.';
  if (platform === 'missile') return 'Notify all response tiers immediately. Radio silence protocol takes effect on Tier 4 dispatch. Non-recallable.';
  if (cls === 'hostile' && threat === 'high') return 'Dispatch Tier 1 and Tier 2 responders immediately. Escalate to Tier 3 within 60 seconds if unresolved.';
  if (cls === 'hostile' && threat === 'medium') return 'Dispatch Tier 1 and Tier 2 responders.';
  if (platform === 'fixed-wing') return 'Fixed wing platform detected. Include Tier 3 (Rigspolitiet / FE) with local response.';
  if (cls === 'unknown') return 'Dispatch Tier 1 responders. Escalate as classification firms.';
  return 'Dispatch Tier 1 responders. Escalate as required.';
}

// Generate the sha-256-looking hash for the brief (mock, but deterministic per event).
function mockHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `${hex}${hex.slice(0,4)}...${hex.slice(0,6)}`;
}

// Main: return HTML for the Detection Brief for a given event.
export function renderDetectionBrief(event) {
  const platform = event.platform || 'quadcopter';
  const clsColor = threatColor(event.classification, event.threat);
  const threatLabel = threatLevelLabel(event.classification, event.threat, platform);
  const pos = event.lastPosition || (event.entry ? { lat: event.entry.lat, lon: event.entry.lon, alt: event.entry.alt || 0, speed: 0, heading: event.entry.heading || 0, rangeToPerim: null } : null);
  const respBundle = pos ? responseBundle(pos.lat, pos.lon) : { tactical: [], ground: [], consequence: [] };
  const originCompass = pos ? compassFromOrigin(pos.heading) : '-';
  const headingCompass = pos ? compassFromHeading(pos.heading) : '-';
  const genTs = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const hash = mockHash(event.id + genTs);
  const evidenceLink = `isr.link/e/${event.id.toLowerCase()}`;
  const evidenceExpiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const contribList = (event.contributingSensors || []).filter(s => !s.offline).map(s => s.id).join(', ');

  return `
    <article class="brief">
      <header class="brief-hdr">
        <div class="brief-brand">
          <img src="/isr-logo.png" alt="ISR Systems" class="brief-brand-logo" />
          <div class="brief-brand-doc">DETECTION BRIEF</div>
        </div>
        <div class="brief-hdr-meta">
          <div class="brief-hdr-line"><span class="k">Event</span><span class="v">${event.id}</span></div>
          <div class="brief-hdr-line"><span class="k">Site</span><span class="v">${siteName(event.siteId)}</span></div>
          <div class="brief-hdr-line"><span class="k">Generated</span><span class="v">${genTs}</span></div>
        </div>
        <div class="brief-cls" style="border-color:${clsColor.border};background:${clsColor.bg};color:${clsColor.border};">
          ${clsColor.label}
        </div>
      </header>

      <section class="brief-hero">
        <div class="brief-cell">
          <div class="brief-cell-k">Platform</div>
          <div class="brief-cell-v">${platformLabel(platform)}</div>
          <div class="brief-cell-sub">${event.droneType}</div>
        </div>
        <div class="brief-cell">
          <div class="brief-cell-k">Threat Level</div>
          <div class="brief-cell-v" style="color:${clsColor.border};">${threatLabel}</div>
          <div class="brief-cell-sub">${event.classification.toUpperCase()}</div>
        </div>
        <div class="brief-cell">
          <div class="brief-cell-k">Confidence</div>
          <div class="brief-cell-v">${Math.round(event.confidence * 100)}<span class="brief-unit">%</span></div>
          <div class="brief-cell-sub">${event.confidenceTrend || 'Trend unavailable'}</div>
        </div>
        <div class="brief-cell">
          <div class="brief-cell-k">Kinematic</div>
          <div class="brief-cell-v">${pos ? Math.round(pos.alt) : '-'}<span class="brief-unit">m AGL</span></div>
          <div class="brief-cell-sub">${pos ? pos.speed + ' m/s · heading ' + Math.round(pos.heading) + '° (' + headingCompass + ')' : '-'}</div>
        </div>
        <div class="brief-cell">
          <div class="brief-cell-k">Origin</div>
          <div class="brief-cell-v">${originCompass}</div>
          <div class="brief-cell-sub">${pos && pos.rangeToPerim != null ? Math.round(pos.rangeToPerim) + ' m from perimeter' : 'range unknown'}</div>
        </div>
      </section>

      <section class="brief-section">
        <div class="brief-section-hdr">Detection Summary</div>
        <p class="brief-prose">
          A ${clsColor.label.toLowerCase()} ${platformLabel(platform).toLowerCase()}, identified as
          <b>${event.droneType}</b>, was detected over <b>${siteName(event.siteId)}</b>
          at <b>${event.startTime.slice(11, 19)}Z</b> on ${event.startTime.slice(0, 10)}.
          ${event.evidence?.rfMatch ? `Radio-frequency signature matched <b>${event.evidence.rfMatch}</b>.` : ''}
          ${contribList ? `Corroborated by <b>${event.contributingSensors.filter(s => !s.offline).length} sensor nodes</b> (${contribList}).` : ''}
        </p>
        ${pos ? `
        <p class="brief-prose">
          The platform is currently positioned at <b>${pos.lat.toFixed(4)}°N, ${pos.lon.toFixed(4)}°E</b>,
          heading <b>${Math.round(pos.heading)}° (${headingCompass})</b> at <b>${pos.speed} m/s</b>,
          ${pos.rangeToPerim != null ? `<b>${Math.round(pos.rangeToPerim)} metres</b> ${pos.rangeToPerim > 0 ? 'from' : 'inside'} the site perimeter.` : ''}
          Origin vector indicates entry from <b>${originCompass}</b>.
        </p>` : ''}
      </section>

      ${respBundle.tactical.length ? `
      <section class="brief-section">
        <div class="brief-section-hdr">Tactical Response Assets</div>
        <div class="brief-section-note">Airborne intercept and maritime response. Only these assets can act on the threat in flight.</div>
        <table class="brief-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Capability</th>
              <th style="text-align:right;">Distance</th>
              <th style="text-align:right;">Estimated arrival</th>
            </tr>
          </thead>
          <tbody>
            ${respBundle.tactical.map(r => `
              <tr>
                <td><b>${r.name}</b></td>
                <td>${r.response}</td>
                <td style="text-align:right;">${r.distanceKm} km</td>
                <td style="text-align:right;"><b>${r.etaLabel}</b></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>` : ''}

      ${respBundle.ground.length ? `
      <section class="brief-section">
        <div class="brief-section-hdr">Ground Coordination + Investigation</div>
        <div class="brief-section-note">Perimeter cordon, evidence collection, operator location trace, arrest when found. Not response.</div>
        <table class="brief-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Function</th>
              <th style="text-align:right;">Distance</th>
              <th style="text-align:right;">On-site ETA</th>
            </tr>
          </thead>
          <tbody>
            ${respBundle.ground.map(r => `
              <tr>
                <td><b>${r.name}</b></td>
                <td>${r.response}</td>
                <td style="text-align:right;">${r.distanceKm} km</td>
                <td style="text-align:right;"><b>${r.etaLabel}</b></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>` : ''}

      ${respBundle.consequence.length ? `
      <section class="brief-section">
        <div class="brief-section-hdr">Consequence + Reinforcement</div>
        <div class="brief-section-note">Civil emergency staging, mass alert, ground reinforcement.</div>
        <table class="brief-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Function</th>
              <th style="text-align:right;">Distance</th>
              <th style="text-align:right;">Estimated arrival</th>
            </tr>
          </thead>
          <tbody>
            ${respBundle.consequence.map(r => `
              <tr>
                <td><b>${r.name}</b></td>
                <td>${r.response}</td>
                <td style="text-align:right;">${r.distanceKm} km</td>
                <td style="text-align:right;"><b>${r.etaLabel}</b></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>` : ''}

      <section class="brief-section">
        <div class="brief-section-hdr">Recommended Action</div>
        <p class="brief-prose brief-action">${recommendedAction(event)}</p>
      </section>

      <section class="brief-section">
        <div class="brief-section-hdr">Signal Attribution</div>
        <div class="brief-kv">
          ${event.evidence?.modality  ? `<div><span class="k">Modality</span><span class="v">${event.evidence.modality}</span></div>` : ''}
          ${event.evidence?.rfCarrier ? `<div><span class="k">RF Carrier</span><span class="v">${event.evidence.rfCarrier}</span></div>` : ''}
          ${event.evidence?.rfBandwidth ? `<div><span class="k">Bandwidth</span><span class="v">${event.evidence.rfBandwidth}</span></div>` : ''}
          ${event.evidence?.rfMatch   ? `<div><span class="k">Signature Match</span><span class="v">${event.evidence.rfMatch}</span></div>` : ''}
          ${contribList               ? `<div><span class="k">Contributing Nodes</span><span class="v">${contribList}</span></div>` : ''}
        </div>
      </section>

      <footer class="brief-footer">
        <div class="brief-footer-row">
          <span class="brief-footer-k">SHA-256</span>
          <span class="brief-footer-v mono">${hash}</span>
        </div>
        <div class="brief-footer-row">
          <span class="brief-footer-k">Full Evidence</span>
          <span class="brief-footer-v mono">${evidenceLink} · expires ${evidenceExpiry}</span>
        </div>
        <div class="brief-footer-brand">ISR SYSTEMS APS · CONFIDENTIAL · UNAUTHORISED DISCLOSURE PROHIBITED</div>
      </footer>
    </article>
  `;
}
