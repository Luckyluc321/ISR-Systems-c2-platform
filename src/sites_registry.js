// Sites registry — single source of truth for every configured site.
//
// Reads sites/*.yaml, passes through the site_loader (validate +
// normalise), and exposes the merged SITES object every consumer
// imports. No inline hardcoded site definitions anywhere in the
// codebase. New site = drop a YAML into sites/ and rebuild.
//
// Wire contract: docs/integration-contracts.md Section 3 "Site definition"
//
// ── Two ways in, because this module has two runtimes ──────────────
//
// In the browser, Vite replaces import.meta.glob at build time and the
// manifests are inlined into the bundle.
//
// Under plain Node there is no import.meta.glob, so calling it throws
// and the files are read from disk instead. That fallback is not a
// convenience: this module sits under events.js, which sits under
// almost everything, so a Vite-only API here made the whole graph
// unloadable outside a browser. The agentic eval harness has been dead
// since 2026-09-13 for exactly this reason, and every future Node-side
// test of anything that touches events would have hit the same wall.
//
// The Node branch uses process.getBuiltinModule rather than an import
// or a top-level await, so it stays synchronous, needs no bundler
// exclusion, and is simply absent in the browser.
import { loadSitesFromGlob } from './site_loader.js';

function _readManifests() {
  // Browser / Vite. The call is replaced at build time with an object
  // literal of { path: rawYamlString }.
  try {
    const globbed = import.meta.glob('/sites/*.yaml', { query: '?raw', import: 'default', eager: true });
    if (globbed && Object.keys(globbed).length) return globbed;
  } catch (_) {
    // import.meta.glob does not exist outside Vite. Fall through.
  }

  // Node. getBuiltinModule is undefined in browsers, so this whole
  // branch is unreachable there even if the glob above returned empty.
  const getBuiltin = typeof process !== 'undefined' && process.getBuiltinModule;
  if (!getBuiltin) return {};
  try {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const url = process.getBuiltinModule('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const dir = path.resolve(here, '..', 'sites');
    const out = {};
    for (const file of fs.readdirSync(dir)) {
      if (!/\.ya?ml$/.test(file)) continue;
      // Keyed the same way Vite keys a glob, so loadSitesFromGlob sees
      // one shape and cannot drift between the two runtimes.
      out[`/sites/${file}`] = fs.readFileSync(path.join(dir, file), 'utf8');
    }
    return out;
  } catch (err) {
    console.warn('[sites_registry] Node manifest read failed:', err?.message || err);
    return {};
  }
}

const { sites, errors } = loadSitesFromGlob(_readManifests());

export const SITES = sites;
export const SITE_LOAD_ERRORS = errors;
