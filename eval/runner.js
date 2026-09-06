#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// ISR Systems · Agentic Eval Runner
//
// Golden-fixture regression net for the Mistral agent surface.
// Runs against whichever endpoint getInferenceConfig() resolves to
// (dev-mode Mistral direct today, Azure sovereign proxy when it
// lands). See docs/agentic-eval-architecture.md.
//
// Usage:
//   node eval/runner.js
//   node eval/runner.js --filter agent_b_debrief
//   node eval/runner.js --fixture cph-transit-mavic-1
//   node eval/runner.js --json > results.json
//
// Order of operations (matters for Node compatibility):
//   1. Install localStorage polyfill (agents use it for LRU cache).
//   2. Load .env.local into globalThis.__isrEnv (mistral_client reads
//      via _readEnv, which prefers __isrEnv over import.meta.env).
//   3. Dynamic-import the assertions, agent adapters, reporter.
//   4. Load fixtures + site contexts.
//   5. For each fixture: resolve digest, invoke agent, run assertions.
//   6. Report.
// ─────────────────────────────────────────────────────────────

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVAL_ROOT = __dirname;
const REPO_ROOT = path.resolve(EVAL_ROOT, '..');

// ── Step 1: localStorage polyfill ────────────────────────────
// Agents use localStorage for LRU caches. In Node there is no such
// thing, so we install a minimal in-memory shim before any src/
// module is imported.
if (typeof globalThis.localStorage === 'undefined') {
  const _mem = new Map();
  globalThis.localStorage = {
    getItem(k) { return _mem.has(k) ? _mem.get(k) : null; },
    setItem(k, v) { _mem.set(k, String(v)); },
    removeItem(k) { _mem.delete(k); },
    clear() { _mem.clear(); },
    get length() { return _mem.size; },
    key(i) { return [..._mem.keys()][i] ?? null; },
  };
}

// ── Step 2: env loader ───────────────────────────────────────
// Read .env.local (best-effort) and expose VITE_* vars via
// globalThis.__isrEnv so mistral_client._readEnv() finds them.
async function _loadEnv() {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!existsSync(envPath)) {
    console.warn('[eval] .env.local not found — using defaults + process.env only');
    globalThis.__isrEnv = { ...process.env };
    return;
  }
  const raw = await readFile(envPath, 'utf-8');
  const env = { ...process.env };
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  globalThis.__isrEnv = env;
}

await _loadEnv();

// ── Step 3: CLI parsing ──────────────────────────────────────
function _parseArgs(argv) {
  const args = { json: false, filter: null, fixture: null, force: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--filter') args.filter = argv[++i];
    else if (a === '--fixture') args.fixture = argv[++i];
    else if (a === '--force') args.force = true;   // ignore cache
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node eval/runner.js [--filter <agent>] [--fixture <id>] [--json] [--force]');
      process.exit(0);
    }
  }
  return args;
}
const args = _parseArgs(process.argv);

// ── Step 4: dynamic imports (after env + polyfill are in place) ──
const { reportHuman, reportJson } = await import('./reporter.js');
const { runAgentA } = await import('./agents/agent_a.spec.js');
const { runAgentB } = await import('./agents/agent_b.spec.js');
const { runAgentCaseFile } = await import('./agents/agent_case_file.spec.js');
const { isMistralConfigured, getInferenceConfig } = await import('../src/mistral_client.js');
const { ensureSiteContextDigest } = await import('../src/agents/agent_a_digest.js');

const AGENT_RUNNERS = {
  agent_a_digest: runAgentA,
  agent_b_debrief: runAgentB,
  agent_case_file: runAgentCaseFile,
};

// Load every assertion module by name so fixtures can opt in by string.
async function _loadAssertions() {
  const dir = path.join(EVAL_ROOT, 'assertions');
  const files = await readdir(dir);
  const map = {};
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const name = f.replace(/\.js$/, '');
    const mod = await import(path.join(dir, f));
    map[name] = mod.default;
  }
  return map;
}
const ASSERTIONS = await _loadAssertions();

async function _loadFixtures() {
  const dir = path.join(EVAL_ROOT, 'fixtures', 'events');
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const fixtures = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const raw = await readFile(path.join(dir, f), 'utf-8');
    try {
      fixtures.push(JSON.parse(raw));
    } catch (err) {
      console.warn(`[eval] skipping malformed fixture ${f}: ${err.message}`);
    }
  }
  return fixtures;
}

async function _loadSiteContext(ref) {
  if (!ref) return null;
  const p = path.join(EVAL_ROOT, 'fixtures', 'site_contexts', `${ref}.json`);
  if (!existsSync(p)) return null;
  const raw = await readFile(p, 'utf-8');
  return JSON.parse(raw);
}

// ── Step 5: main loop ────────────────────────────────────────
async function main() {
  if (!args.json) {
    const cfg = getInferenceConfig();
    console.log(`[eval] endpoint: ${cfg.endpoint}`);
    console.log(`[eval] model:    ${cfg.model}`);
    console.log(`[eval] provider: ${cfg.provider}`);
    console.log(`[eval] token:    ${cfg.token ? '(set)' : '(MISSING — set VITE_MISTRAL_API_TOKEN in .env.local)'}`);
  }

  if (!isMistralConfigured()) {
    console.error('[eval] FATAL: Mistral not configured. Set VITE_MISTRAL_API_TOKEN in .env.local.');
    process.exit(1);
  }

  const fixtures = await _loadFixtures();
  if (fixtures.length === 0) {
    console.error('[eval] no fixtures found in eval/fixtures/events/');
    process.exit(1);
  }

  const filtered = fixtures.filter(f => {
    if (args.fixture && f.fixtureId !== args.fixture) return false;
    if (args.filter && f.agent !== args.filter) return false;
    return true;
  });

  if (filtered.length === 0) {
    console.error(`[eval] no fixtures matched filter (agent=${args.filter}, fixture=${args.fixture})`);
    process.exit(1);
  }

  const digestCache = new Map();   // siteId → resolved digest (dedup within run)
  const results = [];

  for (const fixture of filtered) {
    const runner = AGENT_RUNNERS[fixture.agent];
    if (!runner) {
      results.push({
        fixtureId: fixture.fixtureId,
        agent: fixture.agent,
        expectedTier: fixture.expectedTier,
        error: `unknown agent: ${fixture.agent}`,
        assertions: [],
      });
      continue;
    }

    const siteContext = await _loadSiteContext(fixture.siteContextRef);

    // Resolve Agent A digest once per site per run.
    let digest = null;
    if (siteContext) {
      const cacheKey = fixture.siteContextRef;
      if (digestCache.has(cacheKey)) {
        digest = digestCache.get(cacheKey);
      } else {
        try {
          digest = await ensureSiteContextDigest(siteContext.site_id || cacheKey, siteContext);
          digestCache.set(cacheKey, digest);
        } catch (err) {
          console.warn(`[eval] Agent A digest failed for ${cacheKey}: ${err.message}`);
        }
      }
    }

    const site = siteContext ? { name: siteContext.name || fixture.siteContextRef, ...siteContext } : { name: 'unknown' };

    // Invoke the agent + time it.
    const t0 = Date.now();
    let output = null;
    let error = null;
    try {
      output = await runner(fixture, { site, siteContext, digest });
    } catch (err) {
      error = err.message || String(err);
    }
    const durationMs = Date.now() - t0;

    if (error) {
      results.push({
        fixtureId: fixture.fixtureId,
        agent: fixture.agent,
        expectedTier: fixture.expectedTier,
        durationMs,
        error,
        assertions: [],
      });
      continue;
    }

    // Run assertions.
    const assertionResults = [];
    const wanted = fixture.assertions || Object.keys(ASSERTIONS);
    for (const name of wanted) {
      const fn = ASSERTIONS[name];
      if (!fn) {
        assertionResults.push({ name, pass: false, message: `unknown assertion: ${name}` });
        continue;
      }
      try {
        const r = fn(output, fixture, { site, siteContext, digest });
        assertionResults.push({ name, pass: !!r.pass, message: r.message || '' });
      } catch (err) {
        assertionResults.push({ name, pass: false, message: `assertion threw: ${err.message}` });
      }
    }

    results.push({
      fixtureId: fixture.fixtureId,
      agent: fixture.agent,
      expectedTier: fixture.expectedTier,
      durationMs,
      output: args.json ? output : undefined,   // include output only in JSON mode
      assertions: assertionResults,
    });
  }

  const ok = args.json ? reportJson(results) : reportHuman(results);
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error('[eval] runner crashed:', err);
  process.exit(2);
});
