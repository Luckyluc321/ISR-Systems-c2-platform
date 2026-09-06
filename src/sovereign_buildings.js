// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN BUILDINGS — BBR-driven extruded polygons for demo visuals
// ═══════════════════════════════════════════════════════════════════════════
//
// Real Danish state building data (BBR / Bygnings- og Boligregistret)
// rendered as extruded Cesium polygons at demo sites. Fills the visual
// void where Google Photorealistic 3D Tiles don't reach (Billund, Esbjerg,
// Energinet substations, etc), and gives sovereign mode real 3D buildings
// without waiting for the full CityGML → 3D Tiles pipeline.
//
// Data source: BBR public tier (bbox query). Returns per-building:
//   - byg404Koordinat  → POINT(easting northing) in EPSG:25832
//   - byg041BebyggetAreal → footprint area in m²
//   - byg054AntalEtager → floor count
//   - byg021BygningensAnvendelse → usage code (see anvendelse table)
//
// Approach (pragmatic, not perfect):
//   1. BBR does NOT publish footprint polygons — only a centroid point
//      + area. We approximate each building as a SQUARE with side =
//      sqrt(area), centered on the point. Not visually perfect but
//      gives real Danish state building data in the right locations
//      at real heights.
//   2. Height = AntalEtager × storey-height (3.0m residential, 3.5m
//      commercial). Approximate but usable.
//   3. Coord conversion EPSG:25832 → WGS84 uses local flat-earth
//      approximation around the site center. Accurate to <1m at
//      Danish latitudes for bboxes up to 10km. Avoids adding proj4js.
//
// Upgrade (LANDED 2026-09-02): fetchGeoDanmarkFootprintsAroundSite() +
// joinBbrWithFootprints() below pull real polygon rings from GeoDanmark
// Vektor 6.0 WFS (typeName gdk60:Bygning) and join them to BBR records
// via the BBRUUID key. BbrBuildingRenderer prefers the real polygon when
// a footprint is present; falls back to the square approximation for
// buildings that GeoDanmark hasn't mapped (rare but possible for new
// construction not yet in the vector product).
// ═══════════════════════════════════════════════════════════════════════════

import * as CesiumModule from 'cesium';
import { wgs84ToEtrs89Utm32 } from './sovereign_services.js';

// ── Anvendelse code → building type + color ─────────────────────────────
// BBR bygningsanvendelse codes (byg021). Full list at
// bbr.dk/bbr-kodelister. Grouped to a handful of visual categories.
const ANVENDELSE_STYLE = {
  // Residential (110-199)
  '120': { type: 'residential', color: '#4dd2ff', storeyM: 3.0 },   // enfamiliehus
  '121': { type: 'residential', color: '#4dd2ff', storeyM: 3.0 },   // sommerhus
  '130': { type: 'residential', color: '#4dd2ff', storeyM: 3.0 },   // række-/kædehus
  '140': { type: 'residential', color: '#4dd2ff', storeyM: 3.0 },   // etagebolig
  '150': { type: 'residential', color: '#4dd2ff', storeyM: 3.0 },   // kollegium
  '160': { type: 'residential', color: '#4dd2ff', storeyM: 3.0 },   // dobbelthus
  // Commerce + industry (200-399)
  '210': { type: 'commerce',    color: '#ffb84d', storeyM: 3.5 },   // produktion
  '220': { type: 'industry',    color: '#ff6b4d', storeyM: 4.5 },   // energi/vand
  '230': { type: 'industry',    color: '#ff6b4d', storeyM: 4.5 },   // lager
  '310': { type: 'commerce',    color: '#ffb84d', storeyM: 3.5 },   // detailhandel
  '312': { type: 'commerce',    color: '#ffb84d', storeyM: 3.5 },   // butik + parkeringsanlæg
  '315': { type: 'commerce',    color: '#ffb84d', storeyM: 3.5 },   // hotel
  '390': { type: 'commerce',    color: '#ffb84d', storeyM: 3.5 },   // andet transport
  // Institutions (410-499)
  '410': { type: 'institution', color: '#4dff9c', storeyM: 3.5 },   // uddannelse
  '420': { type: 'institution', color: '#4dff9c', storeyM: 3.5 },   // sygehus
  '430': { type: 'institution', color: '#4dff9c', storeyM: 3.5 },   // daginst
  '440': { type: 'institution', color: '#4dff9c', storeyM: 3.5 },   // offentlig admin
  // Sport, kultur (510-599)
  '510': { type: 'culture',     color: '#c084fc', storeyM: 4.0 },   // idræt
  '520': { type: 'culture',     color: '#c084fc', storeyM: 4.0 },   // kultur
  // Fallback
  '_default': { type: 'other',  color: '#b4c8dc', storeyM: 3.0 },
};

function styleFor(anvendelseCode) {
  return ANVENDELSE_STYLE[String(anvendelseCode)] || ANVENDELSE_STYLE._default;
}

// Parse "POINT(509388.24 6177829.97)" → { east, north }
function parsePointCoord(pointStr) {
  if (!pointStr || typeof pointStr !== 'string') return null;
  const m = pointStr.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!m) return null;
  return { east: parseFloat(m[1]), north: parseFloat(m[2]) };
}

// Local flat-earth EPSG:25832 → WGS84 conversion around a reference
// point. Accurate to <1m at Danish latitudes for bboxes up to ~10km.
// Avoids the extra dependency of proj4js. For larger areas or higher
// accuracy, use proj4js.
function utm32ToWgs84Local(east, north, refWgs84) {
  const ref = wgs84ToEtrs89Utm32(refWgs84.lon, refWgs84.lat);
  const dEast = east - ref.east;
  const dNorth = north - ref.north;
  // 1° lat ≈ 111000 m; 1° lon ≈ 111000 × cos(lat) m
  const dLat = dNorth / 111000;
  const dLon = dEast / (111000 * Math.cos(refWgs84.lat * Math.PI / 180));
  return { lat: refWgs84.lat + dLat, lon: refWgs84.lon + dLon };
}

// Fetch BBR buildings in a bbox (EPSG:25832) around a WGS84 site center.
// bboxKm = half-side in km (bbox becomes 2×bboxKm on each side).
//
// Widening: inline Krüger-series UTM transform has known ~500-1000m
// northerly drift at Danish latitudes (documented in sovereign_services.js).
// For per-building POSITIONS the drift cancels (both ref + BBR points get
// re-projected consistently) but the FETCH bbox itself inherits the drift.
// We widen the bbox by 1500m on each side to guarantee full coverage of
// the intended area. Downside: fetches ~30% more buildings than strictly
// needed. Not a problem at demo bbox sizes.
//
// Limit: BBR endpoint quietly caps at ~1000 without explicit limit.
// We request limit=1000 and log if the response hits that ceiling.
export async function fetchBuildingsAroundSite(refWgs84, { bboxKm = 3, credsToken, signal, maxPages = 20 } = {}) {
  if (!credsToken) throw new Error('[sovereign_buildings] Datafordeler creds required.');
  const [user, pass] = String(credsToken).split(':');
  if (!user || !pass) throw new Error('[sovereign_buildings] token must be "user:pass".');
  const ref = wgs84ToEtrs89Utm32(refWgs84.lon, refWgs84.lat);
  const H = bboxKm * 1000 + 1500;
  // BBR pagination confirmed live 2026-09-03: PageSize=1000 (max) + page=N.
  // Auto-paginate until page returns < 1000 (last page). Cap at maxPages
  // (default 20 = 20 000 buildings) as safety.
  const bboxParams = {
    Nord: String(ref.north + H), Syd: String(ref.north - H),
    Oest: String(ref.east + H),  Vest: String(ref.east - H),
    username: user, password: pass, Format: 'JSON', PageSize: '1000',
  };
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({ ...bboxParams, page: String(page) });
    const url = `https://services.datafordeler.dk/BBR/BBRPublic/1/rest/bygning?${params.toString()}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`BBR fetch failed on page ${page} ${res.status}: ${res.statusText}`);
    const buildings = await res.json();
    const arr = Array.isArray(buildings) ? buildings : [];
    all.push(...arr);
    if (arr.length < 1000) break; // last page
    if (page === maxPages) console.warn(`[sovereign_buildings] hit ${maxPages}-page cap (${all.length} buildings). Narrow bboxKm to see all.`);
  }
  return all;
}

// ── GeoDanmark Vektor 6.0: real Bygning polygon footprints ─────────────
// Live-verified 2026-09-02: wfs.datafordeler.dk/GeoDanmarkVektor/
// GeoDanmark60_NOHIST_GML3/1.0.0/WFS, typeName gdk60:Bygning. Same
// tjenestebruger creds as BBR. Returns GML 3.2 FeatureCollection with
// <gml:Polygon srsName="...EPSG::25832" srsDimension="3">. We strip
// the height component and keep 2D exterior ring only — extrusion comes
// from BBR AntalEtager, not from GeoDanmark's roof height (which is
// tag-height, not floor-height).
//
// Bbox widening matches BBR fetch: +1500m for UTM drift safety.
export async function fetchGeoDanmarkFootprintsAroundSite(refWgs84, { bboxKm = 3, credsToken, signal } = {}) {
  if (!credsToken) throw new Error('[sovereign_buildings] Datafordeler creds required.');
  const [user, pass] = String(credsToken).split(':');
  if (!user || !pass) throw new Error('[sovereign_buildings] token must be "user:pass".');
  const ref = wgs84ToEtrs89Utm32(refWgs84.lon, refWgs84.lat);
  const H = bboxKm * 1000 + 1500;
  const bbox = `${ref.east - H},${ref.north - H},${ref.east + H},${ref.north + H},urn:ogc:def:crs:EPSG::25832`;
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeNames: 'gdk60:Bygning',
    BBOX: bbox,
    count: '2000',
    username: user, password: pass,
  });
  const url = `https://wfs.datafordeler.dk/GeoDanmarkVektor/GeoDanmark60_NOHIST_GML3/1.0.0/WFS?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GeoDanmark Bygning fetch failed ${res.status}: ${res.statusText}`);
  const xml = await res.text();
  return parseGeoDanmarkBygningGml(xml);
}

// Parse GML 3.2 FeatureCollection into [{lokalId, bbruuid, ring: [[e,n],...], bygningstype, synlig}]
// srsDimension=3 in the source; we drop every 3rd coord to get 2D.
export function parseGeoDanmarkBygningGml(gmlText) {
  if (!gmlText || typeof gmlText !== 'string') return [];
  const doc = new DOMParser().parseFromString(gmlText, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) { console.warn('[sovereign_buildings] GML parse error'); return []; }
  const out = [];
  const buildings = doc.getElementsByTagNameNS('http://data.gov.dk/schemas/geodanmark60/2/gml3', 'Bygning');
  for (const b of buildings) {
    const lokalId = b.getElementsByTagNameNS('http://data.gov.dk/schemas/geodanmark60/2/gml3', 'id.lokalId')[0]?.textContent?.trim() || null;
    const bbruuid = b.getElementsByTagNameNS('http://data.gov.dk/schemas/geodanmark60/2/gml3', 'BBRUUID')[0]?.textContent?.trim() || null;
    const bygningstype = b.getElementsByTagNameNS('http://data.gov.dk/schemas/geodanmark60/2/gml3', 'bygningstype')[0]?.textContent?.trim() || null;
    const synlig = b.getElementsByTagNameNS('http://data.gov.dk/schemas/geodanmark60/2/gml3', 'synligBygning')[0]?.textContent?.trim();
    if (synlig === 'false') continue;   // underground / not visible above ground
    const posLists = b.getElementsByTagNameNS('http://www.opengis.net/gml/3.2', 'posList');
    // First posList inside geometri/Polygon/exterior/LinearRing = outer ring.
    // Ignore holes (rare for buildings and Cesium PolygonHierarchy supports
    // them separately — worth adding later if we hit visual gaps).
    const posText = posLists[0]?.textContent?.trim();
    if (!posText) continue;
    const nums = posText.split(/\s+/).map(Number).filter(Number.isFinite);
    const stride = nums.length % 3 === 0 ? 3 : 2;   // srsDim 3 default; fall back to 2
    const ring = [];
    for (let i = 0; i < nums.length; i += stride) {
      // GML 3.2 posList for EPSG:25832 is [E N (Z)] triplets
      ring.push([nums[i], nums[i + 1]]);
    }
    if (ring.length < 3) continue;
    out.push({ lokalId, bbruuid, bygningstype, ring });
  }
  return out;
}

// Join BBR building records to GeoDanmark footprints. Live-verified
// 2026-09-02: BBR's `id_lokalId` (UUID) is the exact key GeoDanmark's
// `gdk60:BBRUUID` references. ~48% match rate is typical (rest of BBR
// records are sheds, garages, and small structures GDK filters below its
// minimum-size threshold; unmatched records keep the square fallback).
// If multiple GDK polygons share one BBRUUID (main building + attached
// garage under same BBR entry) we keep the largest so the render shows
// the primary structure.
export function joinBbrWithFootprints(bbrArr, footprints) {
  // Flipped iteration 2026-09-03: iterate over GeoDanmark polygons (real
  // geometry, thousands at urban sites), attach BBR attributes when we can.
  // Old approach iterated BBR (default-capped at ~100 records) and fell back
  // to arbitrary squares — visually ugly. This renders every mapped building
  // and enriches with anvendelse/floors/year where BBR joins.
  const bbrByUuid = new Map();
  for (const b of bbrArr) {
    if (b.id_lokalId) bbrByUuid.set(b.id_lokalId, b);
  }
  const out = [];
  let matched = 0;
  for (const fp of footprints) {
    const bbr = fp.bbruuid ? bbrByUuid.get(fp.bbruuid) : null;
    if (bbr) matched++;
    out.push({
      ...(bbr || {}),
      id_lokalId: fp.bbruuid || `gdk-${fp.lokalId}`,
      _footprint: fp,
      _bbr_matched: !!bbr,
    });
  }
  const pct = out.length ? Math.round((matched * 100) / out.length) : 0;
  console.log(`[sovereign_buildings] ${out.length} GeoDanmark polygons rendered; ${matched} enriched with BBR attributes (${pct}%)`);
  return out;
}

function _ringArea(ring) {
  // Shoelace, planar (UTM32 metres); we only need magnitude for size comparison
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

// Render BBR buildings as extruded polygons on the Cesium viewer.
// Each building becomes a square footprint sized to its
// byg041BebyggetAreal, extruded to AntalEtager × storey-height, colored
// per anvendelse category.
export class BbrBuildingRenderer {
  constructor() {
    this._viewer = null;
    this._dataSource = null;
    this._Cesium = null;
  }
  render(viewer, buildings, refWgs84) {
    if (this._viewer) this.clear();
    this._Cesium = this._Cesium || CesiumModule;
    if (!this._Cesium) { console.warn('[BbrBuildingRenderer] Cesium not loaded'); return 0; }
    const C = this._Cesium;
    this._viewer = viewer;
    this._dataSource = new C.CustomDataSource('sovereign-bbr-buildings');
    viewer.dataSources.add(this._dataSource);
    let plotted = 0;
    let bbrEnriched = 0;
    for (const b of buildings) {
      // Every entry now has _footprint (flipped iteration in join). If not,
      // skip — no square-approximation fallback anymore.
      if (!b._footprint?.ring?.length || b._footprint.ring.length < 3) continue;
      const floors = Number(b.byg054AntalEtager) || 2;
      const st = styleFor(b.byg021BygningensAnvendelse);
      const height = Math.max(3, floors * st.storeyM);
      // Real GeoDanmark polygon in EPSG:25832. Convert every vertex via
      // local flat-earth. Cesium PolygonHierarchy expects CCW outer ring
      // — recompute signed area and reverse if clockwise.
      const ring = b._footprint.ring;
      let signedArea2 = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        signedArea2 += x1 * y2 - x2 * y1;
      }
      const oriented = signedArea2 < 0 ? [...ring].reverse() : ring;
      const corners = [];
      for (const [east, north] of oriented) {
        const p = utm32ToWgs84Local(east, north, refWgs84);
        corners.push(p.lon, p.lat);
      }
      if (b._bbr_matched) bbrEnriched++;
      const source = b._bbr_matched ? 'geodanmark+bbr' : 'geodanmark';
      // Footprint area (m²) for popup display — computed from BBR if
      // present, else derived from the polygon itself.
      const area = Number(b.byg041BebyggetAreal) || Math.abs(signedArea2 / 2);
      this._dataSource.entities.add({
        id: `bbr-${b.id_lokalId}`,
        polygon: {
          hierarchy: C.Cartesian3.fromDegreesArray(corners),
          extrudedHeight: height,
          material: C.Color.fromCssColorString(st.color).withAlpha(0.85),
          outline: true,
          outlineColor: C.Color.BLACK.withAlpha(0.3),
        },
        description: this._describe(b, st, height, area, source),
      });
      plotted++;
    }
    console.log(`[BbrBuildingRenderer] plotted ${plotted} real polygons (${bbrEnriched} enriched with BBR attributes)`);
    return plotted;
  }
  _describe(b, st, height, area, source = 'geodanmark') {
    const sourceLabel = source === 'geodanmark+bbr'
      ? 'GeoDanmark Vektor 6.0 (real polygon footprint) + BBR (Bygnings- og Boligregistret) · Boligministeriet'
      : 'GeoDanmark Vektor 6.0 (real polygon footprint) · BBR attributes not matched';
    return `
      <div style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:#e8ecef;">
        <div style="font-size:13px; font-weight:600; margin-bottom:6px;">Bygning ${b.byg007Bygningsnummer || ''}</div>
        <table style="width:100%; border-collapse:collapse;">
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Type</td><td style="padding:2px 6px;">${st.type} (kode ${b.byg021BygningensAnvendelse ?? '-'})</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Areal</td><td style="padding:2px 6px;">${area} m² footprint</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Etager</td><td style="padding:2px 6px;">${b.byg054AntalEtager ?? '-'} (~${height.toFixed(1)}m)</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Opført</td><td style="padding:2px 6px;">${b.byg026Opførelsesår ?? '-'}</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Samlet areal</td><td style="padding:2px 6px;">${b.byg038SamletBygningsareal ?? '-'} m²</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">BBR id</td><td style="padding:2px 6px; font-size:9px;">${b.id_lokalId}</td></tr>
        </table>
        <div style="margin-top:8px; font-size:9px; color:#7a8998; letter-spacing:0.1em; text-transform:uppercase;">Sourced from ${sourceLabel}</div>
      </div>`;
  }
  clear() {
    if (this._dataSource && this._viewer) {
      try { this._viewer.dataSources.remove(this._dataSource, true); } catch (_) {}
    }
    this._dataSource = null; this._viewer = null;
  }
}
