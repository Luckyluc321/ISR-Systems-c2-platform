#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN STACK · smoke test
// ═══════════════════════════════════════════════════════════════════════════
//
// Curls every Danish endpoint the sovereign profile uses and prints a
// pass/fail table. Reads credentials from ../.env.local so it matches
// what the browser bundle actually uses.
//
// Run:
//   node scripts/smoke-test-sovereign.js
//   node scripts/smoke-test-sovereign.js --json    # machine-readable output
//
// Exit code: 0 if all critical checks pass, 1 otherwise.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Load .env.local ─────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) { console.error(`No .env.local at ${p}`); process.exit(1); }
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}
const ENV = loadEnv();

// ── Runner ──────────────────────────────────────────────────────────────
const results = [];
async function check({ id, group, critical, note, fn }) {
  const t0 = Date.now();
  let status = 'FAIL', detail = '';
  try {
    const r = await fn();
    if (r && r.ok) { status = 'PASS'; detail = r.detail || ''; }
    else { status = r?.skip ? 'SKIP' : 'FAIL'; detail = r?.detail || 'no response'; }
  } catch (err) { status = 'ERROR'; detail = err.message; }
  results.push({ id, group, status, critical, note, detail, ms: Date.now() - t0 });
}

const jsonMode = process.argv.includes('--json');

// ── Tests ───────────────────────────────────────────────────────────────
const TESTS = [
  // -- SDFI --
  {
    id: 'sdfi_ortho_spring', group: 'Imagery', critical: true,
    note: 'SDFI GeoDanmark Ortofoto (WMTS GetCapabilities)',
    fn: async () => {
      const token = ENV.VITE_SDFI_TOKEN;
      if (!token) return { skip: true, detail: 'VITE_SDFI_TOKEN missing' };
      const res = await fetch(`https://api.dataforsyningen.dk/orto_foraar_wmts_DAF?service=WMTS&request=GetCapabilities&token=${token}`);
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    },
  },

  // -- DAWA (no token) --
  {
    id: 'dawa_reverse', group: 'Address', critical: true,
    note: 'DAWA reverse-geocode at Billund terminal (55.7405, 9.1580)',
    fn: async () => {
      const res = await fetch('https://api.dataforsyningen.dk/adgangsadresser/reverse?x=9.1580&y=55.7405&srid=4326');
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      const addr = j?.adressebetegnelse || j?.vejnavn || null;
      return { ok: !!addr, detail: addr || 'no address returned' };
    },
  },

  // -- DMI (public, no token) --
  {
    id: 'dmi_weather', group: 'DMI', critical: true,
    note: 'DMI Meteorological Observations (bbox around Billund)',
    fn: async () => {
      const bbox = '8.9,55.6,9.4,55.9';
      const res = await fetch(`https://opendataapi.dmi.dk/v2/metObs/collections/observation/items?bbox=${bbox}&limit=5`, {
        headers: { 'User-Agent': 'isr-sovereign-smoke/1.0' },
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      const n = j?.features?.length ?? 0;
      return { ok: n > 0, detail: `${n} weather observations` };
    },
  },

  // -- DMI ocean, lightning, radar STAC, forecasts --
  {
    id: 'dmi_oceanobs', group: 'DMI', critical: false,
    note: 'DMI Oceanographic Observations (bbox around Danish coast)',
    fn: async () => {
      const res = await fetch('https://opendataapi.dmi.dk/v2/oceanObs/collections/observation/items?bbox=8,55,13,57&limit=3', {
        headers: { 'User-Agent': 'isr-sovereign-smoke/1.0' },
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      return { ok: (j?.features?.length ?? 0) >= 0, detail: `${j?.features?.length ?? 0} ocean observations` };
    },
  },
  {
    id: 'dmi_lightning', group: 'DMI', critical: false,
    note: 'DMI Lightning Data',
    fn: async () => {
      const res = await fetch('https://opendataapi.dmi.dk/v2/lightningdata/collections/observation/items?bbox=8,55,13,57&limit=5', {
        headers: { 'User-Agent': 'isr-sovereign-smoke/1.0' },
      });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    },
  },
  {
    id: 'dmi_radar_stac', group: 'DMI', critical: false,
    note: 'DMI Radar STAC collections',
    fn: async () => {
      const res = await fetch('https://opendataapi.dmi.dk/v1/radardata/collections', {
        headers: { 'User-Agent': 'isr-sovereign-smoke/1.0' },
      });
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    },
  },

  // -- DAGI direct Datafordeler --
  {
    id: 'dagi_kommuner', group: 'DAGI', critical: true,
    note: 'DAGI kommuneinddeling_current (1 feature)',
    fn: async () => {
      const creds = ENV.VITE_DATAFORDELER_CREDS;
      if (!creds) return { skip: true, detail: 'VITE_DATAFORDELER_CREDS missing' };
      const [u, p] = creds.split(':');
      const url = `https://wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS?service=WFS&version=2.0.0&request=GetFeature&typenames=dagi_v001:kommuneinddeling_current&count=1&outputFormat=application/json&srsname=EPSG:4326&username=${u}&password=${p}`;
      const res = await fetch(url);
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      const navn = j?.features?.[0]?.properties?.navn;
      return { ok: !!navn, detail: navn ? `sample: ${navn}` : 'no kommune in response' };
    },
  },
  {
    id: 'dagi_politikredse', group: 'DAGI', critical: true,
    note: 'DAGI politikreds_current (all 12)',
    fn: async () => {
      const creds = ENV.VITE_DATAFORDELER_CREDS;
      if (!creds) return { skip: true, detail: 'VITE_DATAFORDELER_CREDS missing' };
      const [u, p] = creds.split(':');
      const url = `https://wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS?service=WFS&version=2.0.0&request=GetFeature&typenames=dagi_v001:politikreds_current&outputFormat=application/json&srsname=EPSG:4326&username=${u}&password=${p}`;
      const res = await fetch(url);
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      const n = j?.features?.length ?? 0;
      return { ok: n === 12, detail: `${n}/12 politikredse` };
    },
  },
  {
    id: 'dagi_regioner', group: 'DAGI', critical: true,
    note: 'DAGI regionsinddeling_current (all 5)',
    fn: async () => {
      const creds = ENV.VITE_DATAFORDELER_CREDS;
      if (!creds) return { skip: true, detail: 'VITE_DATAFORDELER_CREDS missing' };
      const [u, p] = creds.split(':');
      const url = `https://wfs.datafordeler.dk/DAGI/DAGI_WFS/1.0.0/WFS?service=WFS&version=2.0.0&request=GetFeature&typenames=dagi_v001:regionsinddeling_current&outputFormat=application/json&srsname=EPSG:4326&username=${u}&password=${p}`;
      const res = await fetch(url);
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      const n = j?.features?.length ?? 0;
      return { ok: n === 5, detail: `${n}/5 regioner` };
    },
  },

  // -- BBRPublic --
  {
    id: 'bbr_public', group: 'BBR', critical: true,
    note: 'BBRPublic bbox around Billund terminal (~500m)',
    fn: async () => {
      const creds = ENV.VITE_DATAFORDELER_CREDS;
      if (!creds) return { skip: true, detail: 'VITE_DATAFORDELER_CREDS missing' };
      const [u, p] = creds.split(':');
      // Approximate EPSG:25832 for Billund terminal (via known landmark)
      const N = 6177200, E = 509800, H = 500;
      const url = `https://services.datafordeler.dk/BBR/BBRPublic/1/rest/bygning?Nord=${N + H}&Syd=${N - H}&Oest=${E + H}&Vest=${E - H}&username=${u}&password=${p}&Format=JSON`;
      const res = await fetch(url);
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      const n = Array.isArray(j) ? j.length : 0;
      return { ok: n > 0, detail: `${n} buildings` };
    },
  },

  // -- CVR (parked, pending Erhvervsstyrelsen approval) --
  {
    id: 'cvr_hentcvrdata', group: 'CVR', critical: false,
    note: 'CVR HentCVRData (expected 401 until Erhvervsstyrelsen approves)',
    fn: async () => {
      const creds = ENV.VITE_DATAFORDELER_CREDS;
      if (!creds) return { skip: true, detail: 'VITE_DATAFORDELER_CREDS missing' };
      const [u, p] = creds.split(':');
      const url = `https://services.datafordeler.dk/CVR/HentCVRData/1/rest/hentVirksomhedMedCVRNummer?ppno=37411018&username=${u}&password=${p}`;
      const res = await fetch(url);
      // 401 = expected pre-approval; 200 = access granted
      if (res.status === 401 || res.status === 403) return { ok: false, detail: `HTTP ${res.status} (expected until Erhvervsstyrelsen approves)` };
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      return { ok: true, detail: 'CVR access GRANTED' };
    },
  },

  // -- openAIP --
  {
    id: 'openaip_airspaces', group: 'Aviation', critical: false,
    note: 'openAIP Danish airspaces (needs VITE_OPENAIP_KEY)',
    fn: async () => {
      const key = ENV.VITE_OPENAIP_KEY;
      if (!key) return { skip: true, detail: 'VITE_OPENAIP_KEY not set (register at openaip.net)' };
      const res = await fetch('https://api.core.openaip.net/api/airspaces?country=DK&limit=10', {
        headers: { 'x-openaip-api-key': key, 'Accept': 'application/json' },
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json();
      const n = j?.items?.length ?? j?.data?.length ?? 0;
      return { ok: n > 0, detail: `${n} DK airspaces` };
    },
  },

  // -- Vejdirektoratet AMQP proxy (health only; real message flow only when
  //    Vejdirektoratet publishes a new Situation) --
  {
    id: 'vd_traffic_proxy', group: 'Road', critical: false,
    note: 'vd-amqp-proxy /health (needs VITE_VD_TRAFFIC_WS_URL + scripts/vd-amqp-proxy/ running)',
    fn: async () => {
      const wsUrl = ENV.VITE_VD_TRAFFIC_WS_URL;
      if (!wsUrl) return { skip: true, detail: 'VITE_VD_TRAFFIC_WS_URL not set — traffic feed disabled' };
      const httpUrl = wsUrl.replace(/^wss?:/, m => m === 'wss:' ? 'https:' : 'http:').replace(/\/[^/]*$/, '/health');
      const res = await fetch(httpUrl);
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
      const j = await res.json().catch(() => null);
      return { ok: j?.status === 'ok', detail: `events=${j?.eventsKnown ?? '?'} clients=${j?.clients ?? '?'}` };
    },
  },

  // ICAO NOTAMs cut 2026-09-02 (retired from API 2.0 free tier).

  // -- AIS proxy (only if VITE_AIS_WS_URL configured, HTTP health check) --
  {
    id: 'ais_proxy_health', group: 'AIS', critical: false,
    note: 'AIS proxy /health (needs VITE_AIS_WS_URL + deployed Scaleway container)',
    fn: async () => {
      const wsUrl = ENV.VITE_AIS_WS_URL;
      if (!wsUrl) return { skip: true, detail: 'VITE_AIS_WS_URL not set — mock provider active' };
      // Convert wss://.../ships → https://.../health
      const httpUrl = wsUrl.replace(/^wss?:/, m => m === 'wss:' ? 'https:' : 'http:').replace(/\/[^/]*$/, '/health');
      const res = await fetch(httpUrl);
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} at ${httpUrl}` };
      const j = await res.json().catch(() => ({}));
      return { ok: j.status === 'ok', detail: `dmaConnected=${j.dmaConnected}, ships=${j.shipsKnown}, clients=${j.clients}` };
    },
  },
];

// ── Run + render ────────────────────────────────────────────────────────
(async () => {
  for (const t of TESTS) await check(t);

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const groups = {};
    for (const r of results) { (groups[r.group] = groups[r.group] || []).push(r); }
    const RESET = '\x1b[0m', DIM = '\x1b[2m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', BOLD = '\x1b[1m';
    console.log('');
    console.log(`${BOLD}ISR Sovereign Stack · smoke test${RESET}`);
    console.log(`${DIM}${new Date().toISOString()}${RESET}\n`);
    for (const [grp, rows] of Object.entries(groups)) {
      console.log(`${BOLD}[${grp}]${RESET}`);
      for (const r of rows) {
        const color = r.status === 'PASS' ? GREEN : r.status === 'FAIL' || r.status === 'ERROR' ? RED : YELLOW;
        const status = `${color}${r.status.padEnd(5)}${RESET}`;
        console.log(`  ${status} ${r.note}`);
        if (r.detail) console.log(`         ${DIM}${r.detail} · ${r.ms}ms${RESET}`);
      }
      console.log('');
    }
    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL' || r.status === 'ERROR').length;
    const skip = results.filter(r => r.status === 'SKIP').length;
    const failCritical = results.filter(r => (r.status === 'FAIL' || r.status === 'ERROR') && r.critical).length;
    console.log(`${BOLD}Summary${RESET}: ${GREEN}${pass} pass${RESET}, ${RED}${fail} fail${RESET}, ${YELLOW}${skip} skip${RESET}   (${failCritical} critical failures)`);
    console.log('');
  }

  const failCritical = results.filter(r => (r.status === 'FAIL' || r.status === 'ERROR') && r.critical).length;
  process.exit(failCritical > 0 ? 1 : 0);
})();
