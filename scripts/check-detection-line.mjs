// ═══════════════════════════════════════════════════════════════════
// check:detection-line — the sentence beside confidence is the model's
// ───────────────────────────────────────────────────────────────────
// Lucas, 2026-10-24: the line beside a detection's confidence "needs to
// come from Mistral ALWAYS". It used to be confidenceTrend, a sentence
// written into each scenario. This gate keeps it the model's: nothing on
// screen reads confidenceTrend, the agent sends only measured facts, it
// asks only when the picture changed, and with no answer there is no line.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectionFacts, changeKey, shouldAsk, cleanLine, maybeRequestDetectionLine,
  detectionLineSuffix, detectionLineTitle, bareType, isDetectionLineParked,
  SYSTEM_PROMPT, LINE_CFG, _resetDetectionLineState,
} from '../src/agents/agent_detection_line.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

console.log('\n[nothing anywhere reads the canned sentence]');
// Every .js under src/. confidenceTrend may still be WRITTEN as an object
// key (templates, historical events, copies onto new events); any other
// mention in code, however it is spelled, is a read and fails.
const ROOT = new URL('../src/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap(n => {
  const f = join(d, n); return statSync(f).isDirectory() ? walk(f) : (f.endsWith('.js') ? [f] : []);
});
const reads = [];
for (const f of walk(ROOT)) {
  if (f.endsWith('agent_detection_line.js')) continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    // A copy onto a new event (confidenceTrend: x.confidenceTrend) is data
    // passing through, not a display; strip it before looking for reads.
    const code = line.replace(/\/\/.*$/, '').replace(/confidenceTrend:\s*[\w.?]+\.confidenceTrend/, '');
    if (/confidenceTrend(?!\s*:)/.test(code)) reads.push(`${f.replace(ROOT, 'src/')}:${i + 1}`);
  });
}
check('no code reads confidenceTrend, in any form', reads.length === 0, reads.join(', '));

console.log('\n[the prompt]');
check('one short sentence', /One sentence, at most 14 words/.test(SYSTEM_PROMPT));
check('measured facts only, nothing invented', /Use only the facts given/.test(SYSTEM_PROMPT));
check('no intent, no recommendation', /Do not state intent/.test(SYSTEM_PROMPT) && /Do not recommend any action/.test(SYSTEM_PROMPT));

console.log('\n[facts are measurements]');
const ev = {
  id: 'DET-1', siteId: 'aarhus_harbour', droneType: 'Fixed-wing loitering munition, unidentified',
  classification: 'hostile', confidence: 0.71, startTime: new Date(1000).toISOString(),
  confidenceTrend: 'Detected low over the bay',
  lastPosition: { lat: 56.15, lon: 10.24, alt: 671, speed: 35.9, heading: 225 },
  contributingSensors: [
    { id: 'AAR-N16', confidence: 0.76 }, { id: 'AAR-N15', confidence: 0.69 },
    { id: 'AAR-N17', confidence: 0.63 }, { id: 'AAR-N06', confidence: 0.42 },
    { id: 'AAR-N02', confidence: 0, offline: true },
  ],
};
const facts = detectionFacts(ev, { siteName: 'DK Harbour', nowMs: 61000, first: { t: 0, c: 0.4 }, history: [{ t: 0, c: 0.4 }, { t: 1, c: 0.71 }], heldSeconds: 60 });
check('counts only sensors actually holding it', facts.sensors_holding === 4);
check('strongest three, by score', facts.strongest_sensors.map(s => s.id).join() === 'AAR-N16,AAR-N15,AAR-N17');
check('carries the confidence movement', facts.confidence_first_seen === 0.4 && facts.confidence_change_since_first === 0.31);
check('seconds held as the caller measured them (sim clock, from detection)', facts.seconds_held === 60);
check('the scenario\'s commentary is stripped from the type', bareType('DJI Matrice 300 (port surveillance suspected)') === 'DJI Matrice 300'
  && bareType('Cruise missile → Copenhagen approach vector') === 'Cruise missile');
const swarmFacts = detectionFacts({ ...ev, confidence: 0.94 }, { confidenceShown: 0.52 });
check('a swarm describes the number on screen, not the template\'s', swarmFacts.confidence_now === 0.52);
check('the canned sentence is never sent to the model', !JSON.stringify(facts).includes('Detected low'));

console.log('\n[asks only when the picture changes]');
const st = { inflight: false, hasLine: false, errored: false, lastKey: null, lastAt: 0 };
check('first time: asks', shouldAsk(st, 'k1', 0));
const held = { ...st, answered: true, lastKey: 'k1', lastAt: 0 };
check('same picture: does not ask again', !shouldAsk(held, 'k1', 999999));
check('changed, but inside 20 s: waits', !shouldAsk(held, 'k2', LINE_CFG.MIN_INTERVAL_MS - 1));
check('changed, after 20 s: asks', shouldAsk(held, 'k2', LINE_CFG.MIN_INTERVAL_MS));
check('never two at once', !shouldAsk({ ...held, inflight: true }, 'k2', 10 ** 9));
check('a sensor gained changes the key', changeKey(ev) !== changeKey({ ...ev, contributingSensors: ev.contributingSensors.slice(0, 3) }));

console.log('\n[the answer is cleaned, and no answer means no line]');
check('strips quotes, markdown, em-dashes and semicolons',
  cleanLine('"**Held by four sensors — firming; steadily**"') === 'Held by four sensors, firming, steadily.');
check('cut to the word limit', cleanLine(Array(30).fill('word').join(' ')).split(' ').length === LINE_CFG.MAX_WORDS);
check('empty answer: no line', cleanLine('  ') === null);
check('no line: the panel shows the number alone', detectionLineSuffix({}) === '');
check('a line: separated from the number', detectionLineSuffix({ detectionLine: { text: 'Held by four sensors.' } }) === ' · Held by four sensors.');
check('the tooltip names it a model reading with its model', /^Model reading · test-model/.test(detectionLineTitle({ detectionLine: { text: 'x', model: 'test-model' } })));
check('no line, no tooltip', detectionLineTitle({}) === '');

console.log('\n[end to end with a fake model]');
_resetDetectionLineState();
let writes = [], calls = 0;
const transport = (reply, fail) => ({
  configured: () => true, model: () => 'test-model',
  stream: (msgs, cb) => { calls++; if (fail) cb.onError(new Error(fail)); else cb.onDone(reply); },
});
maybeRequestDetectionLine(ev, { siteName: 'DK Harbour', nowMs: 0, transport: transport('Held by four sensors and firming.'), write: (id, l) => writes.push([id, l]) });
check('writes the model line with its model name', writes.length === 1 && writes[0][1].text === 'Held by four sensors and firming.' && writes[0][1].model === 'test-model');
maybeRequestDetectionLine(ev, { nowMs: 5000, transport: transport('x'), write: (id, l) => writes.push([id, l]) });
check('unchanged picture: no second call', calls === 1);
_resetDetectionLineState(); writes = []; calls = 0;
for (let t = 0; t < 60000; t += 5000) {
  maybeRequestDetectionLine({ ...ev, confidence: 0.4 + t / 1e6 }, { nowMs: t, transport: transport(''), write: (id, l) => writes.push([id, l]) });
}
check('an empty answer still counts: no asking every 5 s', calls <= 3, `${calls} calls in a minute`);
check('an empty answer clears the line', writes.every(([, l]) => l === null));
_resetDetectionLineState(); writes = []; calls = 0;
maybeRequestDetectionLine(ev, { nowMs: 0, transport: transport(null, 'Mistral HTTP 500: boom'), write: (id, l) => writes.push([id, l]) });
check('an error clears the line rather than leaving it stale', writes.length === 1 && writes[0][1] === null);
_resetDetectionLineState(); writes = []; calls = 0;
maybeRequestDetectionLine({ ...ev, id: 'DET-2' }, { nowMs: 0, transport: transport(null, 'Mistral HTTP 401: no'), write: (id, l) => writes.push([id, l]) });
maybeRequestDetectionLine({ ...ev, id: 'DET-3' }, { nowMs: 0, transport: transport('y'), write: (id, l) => writes.push([id, l]) });
check('a 401 parks it for the session: line cleared, no further calls', writes.length === 1 && writes[0][1] === null && calls === 1 && isDetectionLineParked());
_resetDetectionLineState();
check('no key: never calls', maybeRequestDetectionLine(ev, { nowMs: 0, transport: { ...transport('z'), configured: () => false }, write: () => {} }) === false);

console.log('\n[wiring]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('a loop offers active, detected events to the agent', /maybeRequestDetectionLine\(ev, \{/.test(main) && /ev\.detected === false\) continue/.test(main));
check('the loop sits out a paused sim', /setInterval\(\(\) => \{\n\s*if \(simIsPaused\(\)\) return;\n\s*\/\/ Parked \(key rejected\)/.test(main));
check('the line is written through the event mutator', /write: \(id, line\) => mutateEvent\(id, \{ detectionLine: line \}\)/.test(main));
check('panel HTML escapes the model line', (main.match(/escapeHtml\(detectionLineSuffix\(e\)\)/g) || []).length === 2);
check('only active events are offered', /if \(!ev \|\| ev\.status !== 'active' \|\| ev\.detected === false\) continue;/.test(main));
check('one detection-line loop, and it is the paused-sim-guarded one', (main.match(/maybeRequestDetectionLine\(/g) || []).length === 1);
check('the live patch writes text, not HTML', /setTxt = \(sel, val\) => \{ const el = section\.querySelector\(sel\); if \(el\) el\.textContent = val; \}/.test(main));
check('a parked key clears every line', /isDetectionLineParked\(\)\) \{\n\s*for \(const ev of EVENTS\) if \(ev\?\.detectionLine\) mutateEvent\(ev\.id, \{ detectionLine: null \}\);/.test(main));
const summary = readFileSync(new URL('../src/summary.js', import.meta.url), 'utf8');
check('the summary brief escapes the model line', /\$\{_escBrief\(event\.detectionLine\?\.text \|\| ''\)\}/.test(summary));

console.log('\n[single-drone confidence keeps the flow it had]');
check('starts at the template value, so rules fire at detection as before', /if \(state\._fcVal == null\) \{\n\s*state\._fcVal = state\._fcBase;/.test(main));
check('rate-capped', /const _FC_MAX_RATE_PER_S = 0\.03;/.test(main));
check('linked site events inherit the starting value, not a live snapshot', /confidence: TEMPLATES\[primary\.templateKey\]\?\.confidence \?\? primary\.confidence,/.test(main));
const pir = readFileSync(new URL('../src/post_incident_report.js', import.meta.url), 'utf8');
check('the report\'s peak is the peak', /const _pc = event\.peakConfidence \?\? event\.confidence;/.test(pir));

if (failures) {
  console.log(`\ncheck:detection-line FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\ncheck:detection-line passed');
