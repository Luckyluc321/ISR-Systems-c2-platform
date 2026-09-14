// ═══════════════════════════════════════════════════════════════════
// Site loader — reads sites/*.yaml manifests + validates + normalises
// ───────────────────────────────────────────────────────────────────
// Implements the wire format from docs/integration-contracts.md
// Section 3 "Site definition". Every configured customer site lives
// as one YAML manifest under `sites/`. Loader runs at boot, parses
// every manifest, validates against a JSON Schema, normalises into
// the runtime `SITES` shape existing code (main.js, Cesium map,
// destinations.js) already consumes.
//
// Two-source strategy during the migration window:
//   1. Loader-supplied sites (from sites/*.yaml) load first
//   2. Existing inline SITES (src/sites.js) merges on top, taking
//      precedence for any id already present
// Once all seed sites are migrated to manifests, the inline SITES
// definitions in src/sites.js can be deleted; loader becomes the
// sole source. See Section 3 migration callout for the field-name +
// casing translations the normaliser handles.
//
// Detection-only invariant preserved. This module reads YAML files
// and returns a plain data object; no side effects on the platform
// runtime beyond registering the sites.
// ═══════════════════════════════════════════════════════════════════

import * as yaml from 'js-yaml';

// ── Manifest schema (JSON Schema draft-07 shape) ────────────────
//
// Kept as a plain-object literal so the validator is dependency-free
// and readable next to the loader. If we ever add ajv or similar,
// this becomes the ajv schema input verbatim.

// Boundary can be declared as `boundary` (Section 3 spec) or the
// legacy `perimeter` / `siteBoundary` name. Validator's `required`
// check treats any of the three as satisfying the boundary requirement.
const BOUNDARY_ALIASES = ['boundary', 'perimeter', 'siteBoundary'];

const MANIFEST_SCHEMA = {
  type: 'object',
  required: ['site_id', 'label', 'tenant', 'coordinates', 'domain_scope', 'sensors'],
  // Custom validator hook — boundary can be under multiple names.
  customChecks: [
    (obj) => {
      const hasBoundary = BOUNDARY_ALIASES.some(name => Array.isArray(obj[name]) && obj[name].length >= 3);
      return hasBoundary ? null : '$.boundary: required — declare via `boundary`, `perimeter`, or `siteBoundary` with at least 3 vertices';
    },
  ],
  properties: {
    // site_id + tenant patterns allow both `-` and `_` in identifiers.
    // Every existing Energinet site id uses underscores
    // (energinet_amager_koblingsstation etc). Rejecting them silently
    // failed validation for 6 of 9 manifests — root cause of the
    // "Energinet sites missing from map + threat menu + config list"
    // regression discovered 2026-09-14.
    site_id:      { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    label:        { type: 'string', minLength: 1 },
    code:         { type: 'string' },
    tenant:       { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    site_type:    { type: 'string', enum: ['airport', 'port', 'energy', 'government', 'data', 'gov-facility', 'other'] },
    subtitle:     { type: 'string' },
    coordinates: {
      type: 'object',
      required: ['lat', 'lon'],
      properties: {
        lat: { type: 'number', minimum: -90,  maximum: 90 },
        lon: { type: 'number', minimum: -180, maximum: 180 },
      },
    },
    boundary: {
      type: 'array',
      minItems: 3,
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { type: 'number' },  // [lon, lat] per GeoJSON convention
      },
    },
    domain_scope: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: ['aviation', 'maritime', 'ground', 'energy', 'government', 'data'] },
    },
    sensors: {
      type: 'array',
      items: {
        type: 'object',
        // Sensor must declare an id (either sensor_id or legacy id), a
        // modality (either `modality` single-string or `modalities`
        // array), a position (either {lat,lon} object or bare lat/lon),
        // and a coverage radius (either coverage_radius_m or legacy
        // coverageRadius). Custom-check enforces the disjunctions.
        required: [],
        customChecks: [
          (s) => (s.sensor_id || s.id) ? null : 'sensor requires sensor_id or id',
          (s) => (s.modality || (Array.isArray(s.modalities) && s.modalities.length)) ? null : 'sensor requires modality or modalities[]',
          (s) => {
            const hasPos = (s.position && s.position.lat != null && s.position.lon != null)
                        || (s.lat != null && s.lon != null);
            return hasPos ? null : 'sensor requires position {lat, lon} or bare lat/lon';
          },
          (s) => (s.coverage_radius_m != null || s.coverageRadius != null) ? null : 'sensor requires coverage_radius_m or coverageRadius',
        ],
      },
    },
    default_cascade_recipients: { type: 'object' },
    always_observers:           { type: 'array', items: { type: 'string' } },
    mode:                       { type: 'string', enum: ['live', 'sim', 'mixed'] },
    operator_dispatch_scope:    { type: 'array', items: { type: 'string' } },
    regulatory_context:         { type: 'string' },
    escalation_sla_minutes:     { type: 'object' },
    flow_doc:                   { type: 'string' },
  },
};

// ── Minimal JSON Schema validator ──────────────────────────────
// Purpose-built for the manifest shape. Not a full JSON Schema
// implementation — covers only the subset the manifest schema
// declares. Returns a list of errors (empty = valid).

function validateManifest(obj, schema = MANIFEST_SCHEMA, path = '$') {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    errors.push(`${path}: expected object, got ${typeof obj}`);
    return errors;
  }
  if (schema.required) {
    for (const key of schema.required) {
      if (obj[key] === undefined || obj[key] === null) {
        errors.push(`${path}.${key}: required field missing`);
      }
    }
  }
  if (Array.isArray(schema.customChecks)) {
    for (const check of schema.customChecks) {
      const err = check(obj);
      if (err) errors.push(err);
    }
  }
  if (!schema.properties) return errors;
  for (const [key, subSchema] of Object.entries(schema.properties)) {
    if (obj[key] === undefined || obj[key] === null) continue;
    const value = obj[key];
    const subPath = `${path}.${key}`;
    errors.push(..._validateValue(value, subSchema, subPath));
  }
  return errors;
}

function _validateValue(value, schema, path) {
  const errors = [];
  const declaredTypes = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  if (declaredTypes.length) {
    const actual = Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value);
    if (!declaredTypes.includes(actual)) {
      errors.push(`${path}: expected ${declaredTypes.join(' | ')}, got ${actual}`);
      return errors;   // don't cascade type errors down the tree
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: expected one of [${schema.enum.join(', ')}], got ${JSON.stringify(value)}`);
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: does not match pattern ${schema.pattern}`);
  }
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${path}: below minimum ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && typeof value === 'number' && value > schema.maximum) {
    errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(`${path}: shorter than minLength ${schema.minLength}`);
  }
  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${path}: fewer than minItems ${schema.minItems}`);
  }
  if (schema.maxItems !== undefined && Array.isArray(value) && value.length > schema.maxItems) {
    errors.push(`${path}: more than maxItems ${schema.maxItems}`);
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    value.forEach((item, i) => errors.push(..._validateValue(item, schema.items, `${path}[${i}]`)));
  }
  // Recurse into objects when the sub-schema declares ANY child
  // constraint (properties, required, or customChecks). Previously
  // only properties triggered recursion, so array-item schemas that
  // only used customChecks (like sensors[]) silently no-op'd. Audit
  // 2026-09-13 pass 1.
  if (schema.type === 'object'
      && (schema.properties || schema.required || schema.customChecks)
      && typeof value === 'object' && value !== null) {
    errors.push(...validateManifest(value, schema, path));
  }
  return errors;
}

// ── Normaliser ─────────────────────────────────────────────────
//
// Translates the new manifest shape into the runtime SITES shape
// existing code (main.js, Cesium map, destinations.js) already
// consumes. Also handles legacy shape inputs so mid-migration
// callers pass either form.

export function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;

  // Sensors — the new manifest allows either the Section-3 shape
  // (sensor_id / modality / position: {lat,lon,alt_m} / coverage_radius_m)
  // OR the legacy inline sites.js shape (id / modalities: [array] /
  // lat + lon / coverageRadius + status / hardware / etc). Preserves
  // every extra property untouched so full-fidelity migration doesn't
  // drop data.
  const sensors = Array.isArray(manifest.sensors)
    ? manifest.sensors.map(s => {
        const pos = s.position || {};
        const lat = pos.lat != null ? pos.lat : (Array.isArray(pos) ? pos[0] : s.lat);
        const lon = pos.lon != null ? pos.lon : (Array.isArray(pos) ? pos[1] : s.lon);
        const modality = s.modality || (Array.isArray(s.modalities) && s.modalities[0]?.toLowerCase()) || 'unknown';
        const coverage = s.coverage_radius_m != null ? s.coverage_radius_m : s.coverageRadius;
        // Base fields the map + destination layer read.
        const base = {
          id: s.sensor_id || s.id,
          modality,
          modalities: Array.isArray(s.modalities) ? s.modalities : [modality],
          lat, lon,
          altM: pos.alt_m != null ? pos.alt_m : null,
          coverageRadius: coverage,
          label: s.label || '',
        };
        // Passthrough of any extra sensor properties (status, hardware,
        // detectionsLast24h, isCore, issues, etc). Extra fields from
        // the manifest survive normalisation unchanged.
        const extras = {};
        for (const [k, v] of Object.entries(s)) {
          if (!(k in base) && k !== 'sensor_id' && k !== 'position'
              && k !== 'coverage_radius_m' && k !== 'modalities' && k !== 'coverageRadius') {
            extras[k] = v;
          }
        }
        return { ...base, ...extras };
      })
    : [];

  // Boundary — accepts `boundary` (Section 3 spec name) or the
  // legacy `perimeter` / `siteBoundary` names. All three use the
  // same [lon, lat] pair convention.
  const boundary = Array.isArray(manifest.boundary) ? manifest.boundary
                 : Array.isArray(manifest.perimeter) ? manifest.perimeter
                 : Array.isArray(manifest.siteBoundary) ? manifest.siteBoundary
                 : [];

  // Stats — manifest can either declare `sensorsOnline` + `sensorsTotal`
  // explicitly OR pack them under `stats: {}` (legacy inline shape).
  const explicitOnline = manifest.sensorsOnline ?? manifest.stats?.sensorsOnline;
  const explicitTotal  = manifest.sensorsTotal  ?? manifest.stats?.sensorsTotal;

  return {
    id: manifest.site_id,
    name: manifest.label,
    code: manifest.code || '',
    subtitle: manifest.subtitle || '',
    coordinates: {
      lat: manifest.coordinates?.lat,
      lon: manifest.coordinates?.lon,
    },
    siteBoundary: boundary,
    // Legacy alias preserved so consumers reading `.perimeter` still work.
    perimeter: boundary,
    sensors,
    sensorsOnline: explicitOnline != null ? explicitOnline : sensors.length,
    sensorsTotal:  explicitTotal  != null ? explicitTotal  : sensors.length,
    // main.js:13194+ reads site.stats.sensorsOnline / site.stats.hostileEvents24h
    // etc for the site overview card. Preserve the stats wrapper so the
    // moment an inline entry is deleted (per migration plan) the card
    // doesn't crash. Sources: manifest.stats.* or top-level fallbacks.
    stats: {
      sensorsOnline:      explicitOnline != null ? explicitOnline : sensors.length,
      sensorsTotal:       explicitTotal  != null ? explicitTotal  : sensors.length,
      flaggedEvents24h:   manifest.stats?.flaggedEvents24h  ?? 0,
      hostileEvents24h:   manifest.stats?.hostileEvents24h  ?? 0,
      falseAlarms24h:     manifest.stats?.falseAlarms24h    ?? 0,
    },
    // Runtime tenant assignment mirrors the manifest field.
    operatorAccountId: manifest.tenant,
    // Domain scope drives events.js registerSiteDomains at boot.
    domainScope: Array.isArray(manifest.domain_scope) ? manifest.domain_scope : [],
    // Optional runtime hints preserved on the loaded site record so
    // downstream code can read them if it cares.
    siteType: manifest.site_type || null,
    mode:     manifest.mode      || 'live',
    operatorDispatchScope:    manifest.operator_dispatch_scope || [],
    defaultCascadeRecipients: manifest.default_cascade_recipients || {},
    alwaysObservers:          manifest.always_observers || [],
    escalationSlaMinutes:     manifest.escalation_sla_minutes || {},
    regulatoryContext:        manifest.regulatory_context || '',
    flowDoc:                  manifest.flow_doc || null,
    // Receivers list — the inline SITES entries carry a receivers[]
    // array that destinations.js reads. Passthrough for full fidelity.
    receivers: Array.isArray(manifest.receivers) ? manifest.receivers : [],
    // Interior lines (runway centrelines, taxi lines, etc) — legacy
    // inline field. Passthrough.
    subLines: Array.isArray(manifest.subLines) ? manifest.subLines : [],
    // Preserve the raw manifest so callers can access anything the
    // normaliser didn't map explicitly (forward-compat).
    _manifest: manifest,
  };
}

// ── Public loader ──────────────────────────────────────────────
//
// Vite's import.meta.glob(pattern, { as: 'raw' }) pulls the file
// contents at bundle time. This is the browser-friendly way to
// enumerate a folder without filesystem APIs.

export function loadSitesFromGlob(rawModules) {
  const out = {};
  const errors = [];
  for (const [filePath, rawContent] of Object.entries(rawModules)) {
    const shortName = filePath.split('/').pop().replace(/\.ya?ml$/, '');
    let manifest;
    try {
      manifest = yaml.load(rawContent);
    } catch (err) {
      errors.push({ file: filePath, error: `YAML parse failed: ${err.message}` });
      continue;
    }
    if (!manifest || typeof manifest !== 'object') {
      errors.push({ file: filePath, error: 'YAML produced non-object' });
      continue;
    }
    const validationErrors = validateManifest(manifest);
    if (validationErrors.length) {
      errors.push({ file: filePath, error: `Schema validation failed:\n  ${validationErrors.join('\n  ')}` });
      continue;
    }
    const normalized = normalizeManifest(manifest);
    if (!normalized || !normalized.id) {
      errors.push({ file: filePath, error: 'Normalisation produced no site id' });
      continue;
    }
    if (out[normalized.id]) {
      errors.push({ file: filePath, error: `Duplicate site_id ${normalized.id} (already loaded from another manifest)` });
      continue;
    }
    out[normalized.id] = normalized;
  }
  return { sites: out, errors };
}

// ── Merge helper ───────────────────────────────────────────────
//
// Merges loader-supplied sites with an existing inline SITES object.
// Manifest sites load first; inline SITES entries overlay on top,
// taking precedence for any id already present. This is the
// transition strategy — inline SITES keeps working during the
// gradual migration; once all sites are manifests, callers can stop
// passing inlineSites and the loader becomes the sole source.

export function mergeSites(manifestSites, inlineSites) {
  const merged = { ...manifestSites };
  for (const [id, site] of Object.entries(inlineSites || {})) {
    merged[id] = site;   // inline wins during transition
  }
  return merged;
}

// ── Console dev handle ────────────────────────────────────────
// Wired in main.js: window.__isr_sites.loaded() → per-manifest report

export function siteLoaderCoverage(manifestSites, inlineSites) {
  const manifestIds = Object.keys(manifestSites);
  const inlineIds   = Object.keys(inlineSites || {});
  const overlap     = manifestIds.filter(id => inlineIds.includes(id));
  return {
    manifestCount:      manifestIds.length,
    manifestIds,
    inlineCount:        inlineIds.length,
    inlineIds,
    overlapDuringMigration: overlap,
    totalRegistered:    new Set([...manifestIds, ...inlineIds]).size,
  };
}
