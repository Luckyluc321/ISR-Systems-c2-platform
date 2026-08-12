// Mistral Large 2 client for Agent 3 (Narrative) + Agent 7 (Debrief).
// Streaming completion via api.mistral.ai. Falls back silently to the
// caller's already-rendered mock text on any error.
//
// Env var: VITE_MISTRAL_API_TOKEN (baked into the Vite build)
// SECURITY NOTE: key is exposed to the browser in dev/demo builds.
// Post-demo, move behind sovereign backend proxy.

import { subjectFromEvent, renderSubjectDigest } from './detection_subject.js';

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MODEL = 'mistral-large-latest';
const RECO_DELIMITER = '===RECO===';
const DEFAULT_TIMEOUT_MS = 30000;

function getToken() {
  try {
    return import.meta.env?.VITE_MISTRAL_API_TOKEN || '';
  } catch (_) {
    return '';
  }
}

export function isMistralConfigured() {
  return !!getToken();
}

// ─────────────────────────────────────────────────────────────
// Core streaming call. Parses SSE, invokes onDelta(text) per
// content chunk, onDone(fullText), onError(err).
// ─────────────────────────────────────────────────────────────
async function streamCompletion(messages, callbacks, opts = {}) {
  const { onDelta = () => {}, onDone = () => {}, onError = () => {} } = callbacks;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const token = getToken();
  if (!token) {
    onError(new Error('VITE_MISTRAL_API_TOKEN not set'));
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 800,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Mistral HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch (_) {
          // Malformed chunk. Ignore.
        }
      }
    }

    clearTimeout(timeoutId);
    onDone(full);
  } catch (err) {
    clearTimeout(timeoutId);
    onError(err);
  }
}

// ─────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────

const WRITING_RULES = [
  'Write in ENGLISH. Do not write in Danish, even though the operator is Danish. Only use Danish characters (æ ø å) for proper nouns like site names or agency names, never for the body text itself.',
  'Two short paragraphs maximum for the briefing body.',
  'Declarative voice. No hedging phrases like "may" or "could indicate".',
  'No em-dashes. No semicolons. No filler words like "furthermore" or "moreover".',
  'Do not use markdown. No bold, italic, headers, or bullets.',
  'Keep the briefing body under 500 characters.',
  'Recommendation is one sentence starting with an action verb, under 200 characters.',
].join('\n- ');

const OUTPUT_FORMAT = [
  '',
  'Output format (strict, no other text):',
  '<briefing body here>',
  RECO_DELIMITER,
  '<one-sentence recommendation here>',
].join('\n');

function buildCaseFileMessages(event, site) {
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

  const userPrompt = [
    `Event ID: ${event.id}`,
    `Site: ${siteName}`,
    `Operator threat assessment: ${threat}`,
    `Operator classification bucket: ${classification}`,
    `First detected: ${startedAt}`,
    `Correlated events at other sites: ${linked}`,
    '',
    subjectDigest,
    '',
    'Produce the operator briefing using the rules and format above. Lead the body with what the sensor mesh actually saw (class, cardinality, formation, behavior). Do not restate the site name in the recommendation.',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildDebriefMessages(event, samples, analysis) {
  const siteName = event.siteName || event.siteId || 'unknown site';
  const dur = samples.length ? Math.round(samples[samples.length - 1].t_sec_from_event - samples[0].t_sec_from_event) : 0;
  const primaryDwell = analysis.dwellZones.filter(d => d.pctOfFlight >= 40).slice(0, 2);
  const notableDwell = analysis.dwellZones.filter(d => d.pctOfFlight >= 20 && d.pctOfFlight < 40).slice(0, 2);
  const closest = analysis.touched[0];
  const linked = event.linkedEventIds?.length || 0;

  // Canonical detection subject (attached by events.js). Defensive
  // fallback for events created outside addEvent().
  const subject = event.subject || subjectFromEvent(event);
  const subjectDigest = renderSubjectDigest(subject);

  // Class-change log surfacing. If the NN reclassified mid-event
  // (e.g. quadcopter → loitering_munition once payload signature
  // clarified), that transition is analyst-relevant.
  const classChanges = (subject.class_change_log || []).slice(0, 3);
  const classChangeLines = classChanges.length
    ? classChanges.map(c => `  ${c.from} → ${c.to} (${c.reason})`)
    : ['  Classification held throughout.'];

  const systemPrompt = [
    'You are an intelligence analyst producing a post-event debrief narrative for a Danish critical-infrastructure operator. The event has closed. Write a retrospective analyst summary of what happened and what it likely means.',
    '',
    'The DETECTION SUBJECT block below is the fused NN output at close of event. TRAJECTORY ANALYSIS is the post-event geospatial analysis from the recorded track. CLASSIFICATION LOG shows whether the NN revised its class during the event.',
    '',
    'Writing rules:',
    '- ' + WRITING_RULES,
    OUTPUT_FORMAT,
  ].join('\n');

  const dwellLines = [];
  primaryDwell.forEach(d => dwellLines.push(`  Primary dwell: ${d.name} (${d.durationSec}s, ${d.pctOfFlight}% of flight)`));
  notableDwell.forEach(d => dwellLines.push(`  Notable dwell: ${d.name} (${d.durationSec}s, ${d.pctOfFlight}% of flight)`));
  if (!dwellLines.length) dwellLines.push('  No significant dwell. Track read as transit.');

  const userPrompt = [
    `Event ID: ${event.id}`,
    `Site: ${siteName}`,
    `Total duration: ${dur} seconds`,
    `Outcome: ${event.outcome || 'no dispatch'}`,
    `Correlated events at other sites: ${linked}`,
    '',
    subjectDigest,
    '',
    'TRAJECTORY ANALYSIS',
    '─────────────────',
    'Dwell profile:',
    ...dwellLines,
    closest ? `Closest asset approach: ${closest.name} at ${closest.minDistM}m` : 'No close asset approach recorded.',
    '',
    'CLASSIFICATION LOG',
    '─────────────────',
    ...classChangeLines,
    '',
    'Produce the debrief narrative using the rules and format above. Focus on behavioral interpretation (reconnaissance, transit, deliberate loiter, indecisive path) rather than restating raw numbers. If the classification log shows a mid-event revision, address why that matters.',
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

// ─────────────────────────────────────────────────────────────
// Public streaming APIs. Callbacks:
//   onBodyDelta(text)  — text appended to body area
//   onRecoDelta(text)  — text appended to recommendation area
//   onDone({body, recommendation, model_version})
//   onError(err)       — caller keeps mock in place
// ─────────────────────────────────────────────────────────────

function makeDelimitedStreamHandler(callbacks) {
  const { onBodyDelta = () => {}, onRecoDelta = () => {}, onDone = () => {}, onError = () => {} } = callbacks;
  let phase = 'body';
  let bodyBuf = '';
  let recoBuf = '';
  return {
    onDelta(delta) {
      if (phase === 'body') {
        bodyBuf += delta;
        const idx = bodyBuf.indexOf(RECO_DELIMITER);
        if (idx >= 0) {
          const cleanBody = bodyBuf.slice(0, idx);
          const afterDelim = bodyBuf.slice(idx + RECO_DELIMITER.length);
          onBodyDelta(cleanBody, /* replace */ true);
          recoBuf = afterDelim;
          if (recoBuf) onRecoDelta(recoBuf, /* replace */ true);
          phase = 'reco';
        } else {
          onBodyDelta(bodyBuf, /* replace */ true);
        }
      } else {
        recoBuf += delta;
        onRecoDelta(recoBuf, /* replace */ true);
      }
    },
    onDone() {
      onDone({
        body: bodyBuf.split(RECO_DELIMITER)[0].trim(),
        recommendation: recoBuf.trim(),
        model_version: MODEL,
      });
    },
    onError,
  };
}

export function streamCaseFileNarrative(event, site, callbacks) {
  if (!isMistralConfigured()) {
    callbacks.onError?.(new Error('Mistral not configured'));
    return;
  }
  const messages = buildCaseFileMessages(event, site);
  const handler = makeDelimitedStreamHandler(callbacks);
  streamCompletion(messages, handler);
}

export function streamDebriefNarrative(event, samples, analysis, callbacks) {
  if (!isMistralConfigured()) {
    callbacks.onError?.(new Error('Mistral not configured'));
    return;
  }
  const messages = buildDebriefMessages(event, samples, analysis);
  const handler = makeDelimitedStreamHandler(callbacks);
  streamCompletion(messages, handler);
}
