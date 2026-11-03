// ═══════════════════════════════════════════════════════════════════
// check:signatures: the signed-in account signs what it does
// ───────────────────────────────────────────────────────────────────
// Audit of 2026-10-30: every manual escalation, operator note and
// reclassification fell back to a fixed "L. Flindt", reclassifications
// were stamped 2026-07-24 14:32:41Z, and 369 of 386 receivers replied as
// "undefined (their agency)". src/actor_signature.js is the one rule.
// This gate holds it over every real account and every call site.
// ═══════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { UNKNOWN_SIGNER, displayNameFor, signatureFor } from '../src/actor_signature.js';
import { ADMIN, OPERATORS, RECEIVERS } from '../src/roles.js';

let failures = 0;
const check = (label, ok, why) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++; console.log(`  FAIL ${label}`); if (why) console.log(`       ${why}`);
};

console.log('\n[the rule]');
check('a named person signs as "Name (Organisation)"', signatureFor({ person: 'M. Sørensen', org: 'DK Airport' }) === 'M. Sørensen (DK Airport)');
check('an account with no person signs as itself, never as a person',
  signatureFor({ label: 'Sydøstjyllands Politi', org: 'Politi' }) === 'Sydøstjyllands Politi');
check('no account at all is "Unknown account"', signatureFor(null) === UNKNOWN_SIGNER && signatureFor(undefined) === UNKNOWN_SIGNER);
check('the account chip shows the person, or the account', displayNameFor({ label: 'FE', person: 'A. Sørensen' }) === 'A. Sørensen'
  && displayNameFor({ label: 'Sydøstjyllands Politi' }) === 'Sydøstjyllands Politi');

console.log('\n[every real account]');
const all = [ADMIN, ...OPERATORS, ...RECEIVERS];
const bad = all.filter((r) => /undefined|null/.test(signatureFor(r)) || /undefined|null/.test(displayNameFor(r)) || signatureFor(r) === UNKNOWN_SIGNER);
check(`all ${all.length} accounts sign with a real name, none "undefined"`, bad.length === 0, bad.slice(0, 5).map((r) => r.id).join(', '));
const flindt = all.filter((r) => r.id !== ADMIN.id && /Flindt/.test(signatureFor(r)));
check('only the admin account signs as L. Flindt', flindt.length === 0, flindt.map((r) => r.id).join(', '));

console.log('\n[events.js]');
const ev = readFileSync(new URL('../src/events.js', import.meta.url), 'utf8');
check('an escalation with no sender records "Unknown account", not a person', /export function escalateEvent\(id, \{[^}]*operator = 'Unknown account'/.test(ev));
check('a note with no author records "Unknown account", not a person', /export function addNote\(id, text, author = 'Unknown account'\)/.test(ev));
check('a reclassification is signed by its caller and stamped now',
  /export function reclassifyEvent\(id, \{[^}]*author = 'Unknown account' \}\)/.test(ev)
  && /timestamp: new Date\(\)\.toISOString\(\),\s*author,\s*text: `Reclassified from/.test(ev)
  && !/new Date\('2026-07-24T14:32:41Z'\)/.test(ev));

console.log('\n[main.js call sites]');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
check('no fixed "L. Flindt" anywhere in main.js', !/L\. Flindt/.test(main));
check('no signature built from a possibly missing person', !/\.person\} \(/.test(main));
check('the escalate modal signs both of its sends with the account',
  (main.match(/escalateEvent\(eventId, \{ destinationIds: activeDests, payload, message, operator: signatureFor\(getActiveRole\(\)\),/g) || []).length === 2);
check('operator notes, the advisory dismissal and both reclassifications are signed by the account',
  /addNote\(eventId, txt, signatureFor\(getActiveRole\(\)\)\)/.test(main)
  && /Triggers surfaced: \$\{adv\.rules\.join\('; '\)\}\.`, signatureFor\(getActiveRole\(\)\)\)/.test(main)
  && (main.match(/reclassifyEvent\([^)]*author: signatureFor\(getActiveRole\(\)\) \}\)/g) || []).length === 2);
check('a receiver\'s reply and note are signed by the account',
  /respondToEscalation\(evtId, escId, txt, signatureFor\(getActiveRole\(\)\),/.test(main)
  && /addNote\(eventId, text, signatureFor\(getActiveRole\(\)\)\)/.test(main));
check('the account chip never reads "undefined"', /opNameEl\.textContent = displayNameFor\(r\);/.test(main));

const pipe = readFileSync(new URL('../src/classification_pipeline.js', import.meta.url), 'utf8');
check('an automatic reclassification is signed by the pipeline, not "Unknown account"', /author: 'Classification pipeline'/.test(pipe));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
