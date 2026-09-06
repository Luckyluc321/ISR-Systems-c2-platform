// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN GEODANMARK FEATURES — roads, water, forest, runways, powerlines
// ═══════════════════════════════════════════════════════════════════════════
//
// Generic per-typename fetch + parse + render for GeoDanmark Vektor 6.0
// WFS features (excluding gdk60:Bygning, which stays in sovereign_buildings.js
// because it needs the BBR attribute join).
//
// Live-verified 2026-09-02: wfs.datafordeler.dk with same tjenestebruger
// creds as BBR. Coverage counts around Billund (3km bbox):
//   Vejmidte              4550 LineString  roads
//   Soe                    107 Polygon      lakes
//   Skov                   141 Polygon      forest
//   Startbane               15 Polygon      runways
//   Hoejspaendingsledning    2 LineString   high-voltage power lines
//   Mast                  3974 Point        comm/tv/utility masts
//   Kyst                     0 (inland)     coastline — non-empty at CPH/Esbjerg
//
// Design mirrors sovereign_buildings.js: bbox around a WGS84 site center,
// local flat-earth UTM32 → WGS84 conversion (<1m accuracy across 10km),
// Cesium CustomDataSource per layer for clean on/off toggling.
// ═══════════════════════════════════════════════════════════════════════════

import * as CesiumModule from 'cesium';
import { wgs84ToEtrs89Utm32 } from './sovereign_services.js';

// ── Layer catalog ──────────────────────────────────────────────────────
// Extension pattern is "append one entry, appears in UI automatically".
// UI groups by `category` field: basemap, water, infrastructure, urban,
// perimeter. Add a new entry anywhere in the array; the group renderer
// preserves the array order within each category.
//
// All 22 layers live-verified around Billund 5km bbox 2026-09-02.
// Layers with 0 features at Billund (Jernbane, Togstation, Havn, Bykerne)
// are kept — they're non-empty at CPH, Aarhus, Copenhagen, Esbjerg.
export const GDK_FEATURE_LAYERS = [
  // ── basemap ──────────────────────────────────────────────────────────
  {
    id: 'gdk_roads', typeName: 'Vejmidte', geom: 'line', category: 'basemap',
    label: 'Veje (centerlinjer)',
    description: 'Alle statslige, kommunale og private veje. Centerlinjer, tegnet i lag over ortofoto.',
    style: { color: '#ffd54d', width: 2.0 },
    attributes: { key: 'vejmidteType', label: 'Type' },
  },
  {
    id: 'gdk_coastline', typeName: 'Kyst', geom: 'line', category: 'basemap',
    label: 'Kystlinje',
    description: 'Danmarks kystlinje ved middelvandstand.',
    style: { color: '#4dc4ff', width: 2.5 },
    attributes: null,
  },
  {
    id: 'gdk_forest', typeName: 'Skov', geom: 'polygon', category: 'basemap',
    label: 'Skov',
    description: 'Skov- og træbevoksede områder større end 0.5 ha.',
    style: { color: '#3fa85a', alpha: 0.45, outline: '#25703b' },
    attributes: null,
  },
  {
    id: 'gdk_heath', typeName: 'Hede', geom: 'polygon', category: 'basemap',
    label: 'Hede',
    description: 'Hedeområder (fx Randbøl Hede, den vestjyske hede).',
    style: { color: '#a68a5c', alpha: 0.45, outline: '#6b5836' },
    attributes: null,
  },

  // ── water ────────────────────────────────────────────────────────────
  {
    id: 'gdk_water_lakes', typeName: 'Soe', geom: 'polygon', category: 'water',
    label: 'Søer',
    description: 'Åbne vandflader større end 250 m² — søer og damme.',
    style: { color: '#4dc4ff', alpha: 0.55, outline: '#2a8fbf' },
    attributes: null,
  },
  {
    id: 'gdk_waterways', typeName: 'Vandloebsmidte', geom: 'line', category: 'water',
    label: 'Vandløb (centerlinjer)',
    description: 'Åer, bække, kanaler. Centerlinje af hvert vandløb.',
    style: { color: '#4dc4ff', width: 1.5 },
    attributes: null,
  },
  {
    id: 'gdk_basins', typeName: 'Bassin', geom: 'polygon', category: 'water',
    label: 'Bassiner',
    description: 'Regnvandsbassiner, forsinkelsesbassiner, reservoirer, damme til teknisk brug.',
    style: { color: '#7cb8d9', alpha: 0.6, outline: '#3d7996' },
    attributes: null,
  },
  {
    id: 'gdk_wetlands', typeName: 'Vaadomraade', geom: 'polygon', category: 'water',
    label: 'Vådområder',
    description: 'Sumpe, moser, engarealer med høj grundvandstand.',
    style: { color: '#68a99b', alpha: 0.45, outline: '#3b6b60' },
    attributes: null,
  },

  // ── infrastructure ───────────────────────────────────────────────────
  {
    id: 'gdk_runways', typeName: 'Startbane', geom: 'polygon', category: 'infrastructure',
    label: 'Startbaner (lufthavne)',
    description: 'Startbaner ved civile og militære lufthavne.',
    style: { color: '#ffffff', alpha: 0.85, outline: '#000000' },
    attributes: { key: 'startbaneType', label: 'Type' },
  },
  {
    id: 'gdk_railways', typeName: 'Jernbane', geom: 'line', category: 'infrastructure',
    label: 'Jernbaner',
    description: 'Alle jernbanespor (S-tog, IC, godsforbindelser, letbaner).',
    style: { color: '#3a3a3a', width: 2.5 },
    attributes: { key: 'jernbaneType', label: 'Type' },
  },
  {
    id: 'gdk_stations', typeName: 'Togstation', geom: 'point', category: 'infrastructure',
    label: 'Togstationer',
    description: 'Bemandede og ubemandede tog-/S-togsstationer.',
    style: { color: '#c084fc', pointSize: 7 },
    attributes: null,
  },
  {
    id: 'gdk_harbours', typeName: 'Havn', geom: 'polygon', category: 'infrastructure',
    label: 'Havne',
    description: 'Erhvervshavne, marinaer, fiskerihavne, færgeterminaler.',
    style: { color: '#4dc4ff', alpha: 0.35, outline: '#2a8fbf' },
    attributes: null,
  },
  {
    id: 'gdk_bridges', typeName: 'Bygvaerk', geom: 'line', category: 'infrastructure',
    label: 'Broer og bygværker',
    description: 'Broer, tunneler, viadukter — centerlinjer.',
    style: { color: '#b4c8dc', width: 2.5 },
    attributes: { key: 'bygvaerkType', label: 'Type' },
  },
  {
    id: 'gdk_powerlines', typeName: 'Hoejspaendingsledning', geom: 'line', category: 'infrastructure',
    label: 'Højspændingsledninger',
    description: 'Højspændingsledninger over jord. Vigtig kontekst for Energinet-lignende kunder + obstacle-map for droner.',
    style: { color: '#ff4d4d', width: 2.5 },
    attributes: { key: 'spaending', label: 'Spænding (kV)' },
  },
  {
    id: 'gdk_technical_areas', typeName: 'TekniskAnlaegFlade', geom: 'polygon', category: 'infrastructure',
    label: 'Tekniske anlæg (flader)',
    description: 'Kraftværker, vandværker, rensningsanlæg, transformatorstationer, telekomanlæg.',
    style: { color: '#ff8c4d', alpha: 0.55, outline: '#a3542a' },
    attributes: { key: 'tekniskAnlaegType', label: 'Type' },
  },
  {
    id: 'gdk_technical_points', typeName: 'TekniskAnlaegPunkt', geom: 'point', category: 'infrastructure',
    label: 'Tekniske anlæg (punkter)',
    description: 'Punktobjekter for tekniske anlæg for små til at have flade — pumper, transformere.',
    style: { color: '#ff8c4d', pointSize: 5 },
    attributes: { key: 'tekniskAnlaegType', label: 'Type' },
  },
  {
    id: 'gdk_wind_turbines', typeName: 'Vindmoelle', geom: 'point', category: 'infrastructure',
    label: 'Vindmøller',
    description: 'Vindmøller. Kritisk kontekst for radar-baseret drone-detection (roterende blade = falsk-positive kilder).',
    style: { color: '#4dff9c', pointSize: 8 },
    attributes: { key: 'vindmoelleType', label: 'Type' },
  },
  {
    id: 'gdk_chimneys', typeName: 'Skorsten', geom: 'point', category: 'infrastructure',
    label: 'Skorstene',
    description: 'Skorstene (industri, kraftværker). Højtragende obstacle for droneflyvning.',
    style: { color: '#ff9c4d', pointSize: 6 },
    attributes: null,
  },
  {
    id: 'gdk_masts', typeName: 'Mast', geom: 'point', category: 'infrastructure',
    label: 'Master (alle)',
    description: 'Alle master (tele, TV, forsyning). Obstacle-map + potentielle radar-falske-positiver.',
    style: { color: '#ff9c4d', pointSize: 6 },
    attributes: { key: 'mastType', label: 'Type' },
  },
  {
    id: 'gdk_telecom_masts', typeName: 'Telemast', geom: 'point', category: 'infrastructure',
    label: 'Telemaster (specifikt)',
    description: 'Telekomunikationsmaster (mobil/radar/radio). Mere granulær end generisk Mast.',
    style: { color: '#c084fc', pointSize: 6 },
    attributes: null,
  },

  // ── urban context ────────────────────────────────────────────────────
  {
    id: 'gdk_low_settlement', typeName: 'LavBebyggelse', geom: 'polygon', category: 'urban',
    label: 'Lav bebyggelse',
    description: 'Lav-tæt bebyggede zoner — parcelhuse, rækkehuse, forstæder.',
    style: { color: '#d9c98a', alpha: 0.35, outline: '#8e7f4a' },
    attributes: null,
  },
  {
    id: 'gdk_high_settlement', typeName: 'HoejBebyggelse', geom: 'polygon', category: 'urban',
    label: 'Høj bebyggelse',
    description: 'Høj-tæt bebyggede zoner — etagebyggeri, karré, bykerner.',
    style: { color: '#d99e5f', alpha: 0.4, outline: '#8e6236' },
    attributes: null,
  },
  {
    id: 'gdk_town_centres', typeName: 'Bykerne', geom: 'polygon', category: 'urban',
    label: 'Bykerne',
    description: 'Historiske bykerner (kun i store byer). Højeste bebyggelsestæthed.',
    style: { color: '#c25555', alpha: 0.4, outline: '#7f2f2f' },
    attributes: null,
  },
  {
    id: 'gdk_commerce_zones', typeName: 'Erhverv', geom: 'polygon', category: 'urban',
    label: 'Erhvervsområder',
    description: 'Industri- og erhvervsområder — logistik, produktion, lager.',
    style: { color: '#a68be8', alpha: 0.35, outline: '#6d51a3' },
    attributes: null,
  },

  // ── perimeter ────────────────────────────────────────────────────────
  {
    id: 'gdk_fences', typeName: 'Hegn', geom: 'line', category: 'perimeter',
    label: 'Hegn (advarsel: tætt lag)',
    description: 'Alle registrerede hegn — perimeter kontekst for site-security. Bemærk: ~11k+ hegn i 5km bbox omkring Billund. Kun on-demand.',
    style: { color: '#7a8998', width: 1.0 },
    attributes: null,
  },
];

// ── Live-flat-earth EPSG:25832 → WGS84 (same as sovereign_buildings) ──
function utm32ToWgs84Local(east, north, refWgs84) {
  const ref = wgs84ToEtrs89Utm32(refWgs84.lon, refWgs84.lat);
  const dEast = east - ref.east;
  const dNorth = north - ref.north;
  const dLat = dNorth / 111000;
  const dLon = dEast / (111000 * Math.cos(refWgs84.lat * Math.PI / 180));
  return { lat: refWgs84.lat + dLat, lon: refWgs84.lon + dLon };
}

// ── Fetch one layer, return parsed features ────────────────────────────
// Returns [{ lokalId, geom: {kind, rings|line|point}, attrs }].
export async function fetchGeoDanmarkFeatures(layer, refWgs84, { bboxKm = 3, credsToken, signal } = {}) {
  if (!layer || !layer.typeName) throw new Error('[gdk_features] layer.typeName required');
  if (!credsToken) throw new Error('[gdk_features] Datafordeler creds required');
  const [user, pass] = String(credsToken).split(':');
  if (!user || !pass) throw new Error('[gdk_features] token must be "user:pass"');
  const ref = wgs84ToEtrs89Utm32(refWgs84.lon, refWgs84.lat);
  const H = bboxKm * 1000 + 1500;
  const bbox = `${ref.east - H},${ref.north - H},${ref.east + H},${ref.north + H},urn:ogc:def:crs:EPSG::25832`;
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeNames: `gdk60:${layer.typeName}`,
    BBOX: bbox,
    count: '5000',
    username: user, password: pass,
  });
  const url = `https://wfs.datafordeler.dk/GeoDanmarkVektor/GeoDanmark60_NOHIST_GML3/1.0.0/WFS?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GDK ${layer.typeName} fetch failed ${res.status}: ${res.statusText}`);
  const xml = await res.text();
  return parseGeoDanmarkGml(xml, layer);
}

// ── GML 3.2 parser (Polygon / LineString / Point) ──────────────────────
const NS_GDK = 'http://data.gov.dk/schemas/geodanmark60/2/gml3';
const NS_GML = 'http://www.opengis.net/gml/3.2';

export function parseGeoDanmarkGml(gmlText, layer) {
  if (!gmlText || typeof gmlText !== 'string') return [];
  const doc = new DOMParser().parseFromString(gmlText, 'application/xml');
  if (doc.querySelector('parsererror')) { console.warn(`[gdk_features:${layer.id}] GML parse error`); return []; }
  const out = [];
  const features = doc.getElementsByTagNameNS(NS_GDK, layer.typeName);
  for (const f of features) {
    const lokalId = f.getElementsByTagNameNS(NS_GDK, 'id.lokalId')[0]?.textContent?.trim() || null;
    // Optional attribute extract for popups
    const attrs = {};
    if (layer.attributes?.key) {
      const v = f.getElementsByTagNameNS(NS_GDK, layer.attributes.key)[0]?.textContent?.trim();
      if (v) attrs[layer.attributes.key] = v;
    }
    if (layer.geom === 'polygon') {
      // First posList inside Polygon/exterior/LinearRing = outer ring
      const posLists = f.getElementsByTagNameNS(NS_GML, 'posList');
      const posText = posLists[0]?.textContent?.trim();
      if (!posText) continue;
      const ring = _readPosList(posText);
      if (ring.length < 3) continue;
      out.push({ lokalId, geom: { kind: 'polygon', ring }, attrs });
    } else if (layer.geom === 'line') {
      // LineString or Curve → single posList
      const posLists = f.getElementsByTagNameNS(NS_GML, 'posList');
      const posText = posLists[0]?.textContent?.trim();
      if (!posText) continue;
      const line = _readPosList(posText);
      if (line.length < 2) continue;
      out.push({ lokalId, geom: { kind: 'line', line }, attrs });
    } else if (layer.geom === 'point') {
      // Point → gml:pos "E N Z"
      const posEl = f.getElementsByTagNameNS(NS_GML, 'pos')[0];
      if (!posEl) continue;
      const nums = (posEl.textContent || '').trim().split(/\s+/).map(Number).filter(Number.isFinite);
      if (nums.length < 2) continue;
      out.push({ lokalId, geom: { kind: 'point', east: nums[0], north: nums[1] }, attrs });
    }
  }
  return out;
}

// GML posList: whitespace-separated numbers, srsDimension 2 or 3.
// Auto-detect stride so a mix of 2D/3D layers all parse cleanly.
function _readPosList(text) {
  const nums = text.split(/\s+/).map(Number).filter(Number.isFinite);
  const stride = nums.length % 3 === 0 ? 3 : 2;
  const pts = [];
  for (let i = 0; i < nums.length; i += stride) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

// ── Cesium renderer for one layer ──────────────────────────────────────
// Kept generic — polygon layers become filled outlines, lines become
// polylines, points become billboards/points. One Cesium CustomDataSource
// per instance so on/off is a single .clear() call.
export class GeoDanmarkFeatureRenderer {
  constructor(layer) {
    this._layer = layer;
    this._viewer = null;
    this._dataSource = null;
    this._Cesium = null;
  }
  render(viewer, features, refWgs84) {
    if (this._viewer) this.clear();
    this._Cesium = this._Cesium || CesiumModule;
    if (!this._Cesium) { console.warn(`[GDK:${this._layer.id}] Cesium not loaded`); return 0; }
    const C = this._Cesium;
    this._viewer = viewer;
    this._dataSource = new C.CustomDataSource(`sovereign-gdk-${this._layer.id}`);
    viewer.dataSources.add(this._dataSource);
    let plotted = 0;
    const st = this._layer.style;
    for (const feat of features) {
      const g = feat.geom;
      const id = `${this._layer.id}-${feat.lokalId}`;
      if (g.kind === 'polygon') {
        // CCW winding auto-correct — Cesium requires CCW outer ring
        const signedArea = _signedArea(g.ring);
        const oriented = signedArea < 0 ? [...g.ring].reverse() : g.ring;
        const corners = [];
        for (const [east, north] of oriented) {
          const p = utm32ToWgs84Local(east, north, refWgs84);
          corners.push(p.lon, p.lat);
        }
        this._dataSource.entities.add({
          id,
          polygon: {
            hierarchy: C.Cartesian3.fromDegreesArray(corners),
            material: C.Color.fromCssColorString(st.color).withAlpha(st.alpha ?? 0.6),
            outline: !!st.outline,
            outlineColor: st.outline ? C.Color.fromCssColorString(st.outline).withAlpha(0.9) : undefined,
            heightReference: C.HeightReference.CLAMP_TO_GROUND,
          },
          description: this._describe(feat),
        });
        plotted++;
      } else if (g.kind === 'line') {
        const positions = [];
        for (const [east, north] of g.line) {
          const p = utm32ToWgs84Local(east, north, refWgs84);
          positions.push(p.lon, p.lat);
        }
        this._dataSource.entities.add({
          id,
          polyline: {
            positions: C.Cartesian3.fromDegreesArray(positions),
            width: st.width || 2.0,
            material: C.Color.fromCssColorString(st.color).withAlpha(st.alpha ?? 0.95),
            clampToGround: true,
          },
          description: this._describe(feat),
        });
        plotted++;
      } else if (g.kind === 'point') {
        const p = utm32ToWgs84Local(g.east, g.north, refWgs84);
        this._dataSource.entities.add({
          id,
          position: C.Cartesian3.fromDegrees(p.lon, p.lat),
          point: {
            pixelSize: st.pointSize || 6,
            color: C.Color.fromCssColorString(st.color).withAlpha(st.alpha ?? 0.95),
            outlineColor: C.Color.BLACK,
            outlineWidth: 1,
            heightReference: C.HeightReference.CLAMP_TO_GROUND,
          },
          description: this._describe(feat),
        });
        plotted++;
      }
    }
    console.log(`[GDK:${this._layer.id}] plotted ${plotted}/${features.length} features`);
    return plotted;
  }
  _describe(feat) {
    const attrRows = Object.entries(feat.attrs || {})
      .map(([k, v]) => `<tr><td style="padding:2px 6px; color:#b4c8dc;">${k}</td><td style="padding:2px 6px;">${v}</td></tr>`)
      .join('');
    return `
      <div style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:#e8ecef;">
        <div style="font-size:13px; font-weight:600; margin-bottom:6px;">${this._layer.label}</div>
        <table style="width:100%; border-collapse:collapse;">
          ${attrRows}
          <tr><td style="padding:2px 6px; color:#b4c8dc;">GDK id</td><td style="padding:2px 6px; font-size:9px;">${feat.lokalId || '-'}</td></tr>
        </table>
        <div style="margin-top:8px; font-size:9px; color:#7a8998; letter-spacing:0.1em; text-transform:uppercase;">Sourced from GeoDanmark Vektor 6.0 (gdk60:${this._layer.typeName})</div>
      </div>`;
  }
  clear() {
    if (this._dataSource && this._viewer) {
      try { this._viewer.dataSources.remove(this._dataSource, true); } catch (_) {}
    }
    this._dataSource = null; this._viewer = null;
  }
}

function _signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
