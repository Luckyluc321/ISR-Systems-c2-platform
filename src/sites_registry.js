// Sites registry — single source of truth for every configured site.
//
// Reads sites/*.yaml at bundle time via Vite's import.meta.glob, passes
// through the site_loader (validate + normalise), and exposes the merged
// SITES object every consumer imports. No inline hardcoded site definitions
// anywhere in the codebase. New site = drop a YAML into sites/ and rebuild.
//
// Wire contract: docs/integration-contracts.md Section 3 "Site definition"

import { loadSitesFromGlob } from './site_loader.js';

const _yamlManifests = import.meta.glob('/sites/*.yaml', { query: '?raw', import: 'default', eager: true });
const { sites, errors } = loadSitesFromGlob(_yamlManifests);

export const SITES = sites;
export const SITE_LOAD_ERRORS = errors;
