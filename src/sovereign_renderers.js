// ═══════════════════════════════════════════════════════════════════════════
// SOVEREIGN RENDERERS — Cesium entity managers for sovereign-mode data
// ═══════════════════════════════════════════════════════════════════════════
//
// Turns sovereign data feeds/services into visible entities on the map:
//   - AIS ship positions (live-feed → billboards + heading arrows)
//   - openAIP airspace polygons (service → PolygonHierarchy overlay)
//   - Vejdirektoratet traffic events (DATEX II XML → color-coded markers)
//
// Design principles (same shape as the other sovereign_* modules):
//   1. ADDITIVE. Each renderer manages its own Cesium DataSource. Doesn't
//      touch the main viewer.entities collection where the app's core
//      sensors/tracks live. Zero risk of collision.
//   2. LIFECYCLE-CLEAN. start(viewer) / stop() — idempotent, fully cleans
//      up entities + data sources on stop.
//   3. FEATURE-PRESERVING. Never touches globe/atmosphere/day-mode.
//   4. STABLE IDS. Entities are keyed by MMSI / airspace-id / situation-id
//      so updates in-place, not create+destroy per tick.
// ═══════════════════════════════════════════════════════════════════════════

// window.Cesium is undefined in Vite ESM builds — import the module
// directly. All renderers below dereference CesiumModule instead of
// falling back to window.Cesium (which returns undefined and makes
// every render() a silent no-op).
import * as CesiumModule from 'cesium';

// ── AIS Ship Renderer ──────────────────────────────────────────────────
export class AisShipRenderer {
  constructor() {
    this._viewer = null;
    this._dataSource = null;
    this._byMmsi = new Map();   // mmsi → Cesium.Entity
    this._unsubscribe = null;
    this._Cesium = null;   // resolved lazily on first use (Cesium may load async)
  }
  start(viewer, feedProvider) {
    if (!viewer || !feedProvider) return;
    if (this._viewer) this.stop();
    this._Cesium = this._Cesium || CesiumModule;
    if (!this._Cesium) { console.warn('[AisShipRenderer] Cesium not loaded — start aborted.'); return; }
    this._viewer = viewer;
    this._dataSource = new this._Cesium.CustomDataSource('sovereign-ais-ships');
    viewer.dataSources.add(this._dataSource);
    this._unsubscribe = feedProvider.onUpdate((payload) => {
      if (!payload || payload.type !== 'ship-batch') return;
      for (const ship of payload.ships) this._upsertShip(ship);
      this._sweepStaleShips();   // TTL prune per batch (cheap)
    });
  }
  _upsertShip(s) {
    if (typeof s.lat !== 'number' || typeof s.lon !== 'number') return;
    const C = this._Cesium;
    const pos = C.Cartesian3.fromDegrees(s.lon, s.lat);
    const heading = typeof s.heading === 'number' ? s.heading : (s.cog || 0);
    let ent = this._byMmsi.get(s.mmsi);
    const color = this._colorForType(s.type);
    if (!ent) {
      ent = this._dataSource.entities.add({
        id: `ais-${s.mmsi}`,
        position: pos,
        billboard: {
          image: this._shipIconDataUri(color),
          rotation: -C.Math.toRadians(heading),
          scale: 0.9,
          verticalOrigin: C.VerticalOrigin.CENTER,
          heightReference: C.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: s.name || String(s.mmsi),
          font: '10px "IBM Plex Mono", monospace',
          fillColor: C.Color.fromCssColorString('#e8ecef'),
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: C.VerticalOrigin.TOP,
          pixelOffset: new C.Cartesian2(0, 14),
          scaleByDistance: new C.NearFarScalar(1000, 1.0, 200000, 0.4),
          translucencyByDistance: new C.NearFarScalar(1000, 1.0, 300000, 0.0),
        },
        description: this._buildShipDescription(s),
      });
      this._byMmsi.set(s.mmsi, ent);
    } else {
      ent.position = pos;
      ent.billboard.rotation = -C.Math.toRadians(heading);
      ent.description = this._buildShipDescription(s);
      if (s.name && ent.label) ent.label.text = s.name;
    }
    ent._lastTs = Date.now();   // stamp on both create + update for TTL sweep
  }
  _colorForType(type) {
    // AIS ship types (very rough grouping)
    const t = String(type || '').toUpperCase();
    if (t.includes('CARGO'))     return '#4dd2ff';
    if (t.includes('TANKER'))    return '#ff6b4d';
    if (t.includes('PASSENGER')) return '#4dff9c';
    if (t.includes('GOVERNMENT')) return '#ffb84d';
    if (t.includes('SUPPLY') || t.includes('SAR') || t.includes('PILOT')) return '#c084fc';
    return '#b4c8dc';
  }
  _shipIconDataUri(hex) {
    // 24x24 SVG ship arrow, colored per type. Rotates via billboard.rotation.
    // Wrap btoa in Unicode-safe encoder in case anyone ever adds non-ASCII glyphs.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M12 2 L18 20 L12 17 L6 20 Z" fill="${hex}" stroke="#0a0f14" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    const bytes = new TextEncoder().encode(svg);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:image/svg+xml;base64,${btoa(bin)}`;
  }
  // TTL sweep — drop entities whose last observed batch was > TTL_MS ago.
  _sweepStaleShips() {
    const TTL_MS = 15 * 60 * 1000;   // 15 min matches DMA proxy's own prune
    const now = Date.now();
    if (!this._lastSweep || (now - this._lastSweep) < 30_000) return;   // ≤ every 30s
    this._lastSweep = now;
    for (const [mmsi, ent] of this._byMmsi) {
      const ts = ent._lastTs;
      if (!ts || (now - ts) <= TTL_MS) continue;
      try { this._dataSource.entities.remove(ent); } catch (_) {}
      this._byMmsi.delete(mmsi);
    }
  }
  _buildShipDescription(s) {
    return `
      <div style="font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #e8ecef;">
        <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px;">${s.name || 'UNKNOWN'}</div>
        <table style="width:100%; border-collapse: collapse;">
          <tr><td style="padding: 2px 6px; color:#b4c8dc;">MMSI</td><td style="padding: 2px 6px;">${s.mmsi}</td></tr>
          <tr><td style="padding: 2px 6px; color:#b4c8dc;">Kaldesignal</td><td style="padding: 2px 6px;">${s.callSign || '-'}</td></tr>
          <tr><td style="padding: 2px 6px; color:#b4c8dc;">Type</td><td style="padding: 2px 6px;">${s.type || '-'}</td></tr>
          <tr><td style="padding: 2px 6px; color:#b4c8dc;">Position</td><td style="padding: 2px 6px;">${s.lat?.toFixed(4)}°N, ${s.lon?.toFixed(4)}°E</td></tr>
          <tr><td style="padding: 2px 6px; color:#b4c8dc;">SOG</td><td style="padding: 2px 6px;">${s.sog?.toFixed(1)} kn</td></tr>
          <tr><td style="padding: 2px 6px; color:#b4c8dc;">COG</td><td style="padding: 2px 6px;">${s.cog?.toFixed(0)}°</td></tr>
          <tr><td style="padding: 2px 6px; color:#b4c8dc;">Heading</td><td style="padding: 2px 6px;">${s.heading?.toFixed(0) ?? '-'}°</td></tr>
          ${s.destination ? `<tr><td style="padding: 2px 6px; color:#b4c8dc;">Destination</td><td style="padding: 2px 6px;">${s.destination}</td></tr>` : ''}
          ${s.ts ? `<tr><td style="padding: 2px 6px; color:#b4c8dc;">Sidste opdatering</td><td style="padding: 2px 6px;">${s.ts.slice(11, 19)} Z</td></tr>` : ''}
        </table>
        <div style="margin-top: 8px; font-size: 9px; color:#7a8998; letter-spacing:0.1em; text-transform:uppercase;">Sourced from Søfartsstyrelsen AIS feed</div>
      </div>`;
  }
  stop() {
    if (this._unsubscribe) { try { this._unsubscribe(); } catch (_) {} this._unsubscribe = null; }
    if (this._dataSource && this._viewer) {
      try { this._viewer.dataSources.remove(this._dataSource, true); } catch (_) {}
    }
    this._byMmsi.clear();
    this._dataSource = null; this._viewer = null;
  }
}

// ── openAIP Airspace Renderer ──────────────────────────────────────────
export class AirspaceRenderer {
  constructor() {
    this._viewer = null;
    this._dataSource = null;
    this._Cesium = null;   // resolved lazily on first use (Cesium may load async)
  }
  // airspacesPack = envelope from fetchDanishAirspaces()
  render(viewer, airspacesPack) {
    if (this._viewer) this.clear();
    this._Cesium = this._Cesium || CesiumModule;
    if (!this._Cesium) { console.warn('[AirspaceRenderer] Cesium not loaded — render aborted.'); return 0; }
    this._viewer = viewer;
    const C = this._Cesium;
    this._dataSource = new C.CustomDataSource('sovereign-airspaces');
    viewer.dataSources.add(this._dataSource);
    const items = airspacesPack?.data?.items || airspacesPack?.data || [];
    if (!items.length) console.warn('[AirspaceRenderer] no items in pack — provider envelope may have changed');
    for (const a of items) this._addAirspace(a);
    return items.length;
  }
  _addAirspace(a) {
    const C = this._Cesium;
    const g = a.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return;
    const { fill, stroke } = this._colorForClass(a);
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) {
      const ring = p[0];
      if (!ring || ring.length < 3) continue;
      const positions = ring.flatMap(([lon, lat]) => [lon, lat]);
      this._dataSource.entities.add({
        id: `airspace-${a._id || a.id || Math.random().toString(36).slice(2)}`,
        polygon: {
          hierarchy: C.Cartesian3.fromDegreesArray(positions),
          material: C.Color.fromCssColorString(fill).withAlpha(0.15),
          outline: true,
          outlineColor: C.Color.fromCssColorString(stroke).withAlpha(0.7),
          outlineWidth: 1.5,
          height: 0,
          heightReference: C.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          name: a.name || '',
          class: a.icaoClass ?? a.class ?? '?',
          type: a.type ?? '?',
          lowerLimit: a.lowerLimit,
          upperLimit: a.upperLimit,
        },
        description: this._buildAirspaceDescription(a),
      });
    }
  }
  _colorForClass(a) {
    // Rough class → color mapping. ICAO airspace classes A-G.
    const cls = String(a.icaoClass ?? a.class ?? '').toUpperCase();
    if (['A', 'B', 'C'].includes(cls)) return { fill: '#ff6b4d', stroke: '#ff6b4d' };  // controlled
    if (['D', 'E'].includes(cls))      return { fill: '#ffb84d', stroke: '#ffb84d' };  // partial
    if (cls === 'G')                   return { fill: '#4dff9c', stroke: '#4dff9c' };  // uncontrolled
    const type = String(a.type || '').toUpperCase();
    if (type.includes('DANGER') || type.includes('RESTRICTED') || type.includes('PROHIBITED')) return { fill: '#ff4d4d', stroke: '#ff4d4d' };
    if (type.includes('TMA') || type.includes('CTR')) return { fill: '#4dd2ff', stroke: '#4dd2ff' };
    return { fill: '#b4c8dc', stroke: '#b4c8dc' };
  }
  _buildAirspaceDescription(a) {
    return `
      <div style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:#e8ecef;">
        <div style="font-size:13px; font-weight:600; margin-bottom:6px;">${a.name || 'Airspace'}</div>
        <table style="width:100%; border-collapse: collapse;">
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Klasse</td><td style="padding:2px 6px;">${a.icaoClass ?? a.class ?? '-'}</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Type</td><td style="padding:2px 6px;">${a.type ?? '-'}</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Nedre grænse</td><td style="padding:2px 6px;">${JSON.stringify(a.lowerLimit ?? '-')}</td></tr>
          <tr><td style="padding:2px 6px; color:#b4c8dc;">Øvre grænse</td><td style="padding:2px 6px;">${JSON.stringify(a.upperLimit ?? '-')}</td></tr>
        </table>
        <div style="margin-top:8px; font-size:9px; color:#7a8998; letter-spacing:0.1em; text-transform:uppercase;">Sourced from openAIP (Eurocontrol EAD mirror)</div>
      </div>`;
  }
  clear() {
    if (this._dataSource && this._viewer) {
      try { this._viewer.dataSources.remove(this._dataSource, true); } catch (_) {}
    }
    this._dataSource = null; this._viewer = null;
  }
}

// ── Vejdirektoratet Traffic Renderer + DATEX II parser ─────────────────
// DATEX II XML: SituationRecord elements carry location + severity + type.
// Parser extracts a lean structured form; renderer plots color-coded
// point markers on the map.
export function parseDatexIISituations(xmlText) {
  if (!xmlText) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    console.warn('[datex_ii] XML parse error');
    return [];
  }
  const results = [];
  // Situation records: many DATEX II variants — accept a few known tag names
  const situationEls = [
    ...doc.querySelectorAll('situationRecord, SituationRecord, situation'),
  ];
  for (const s of situationEls) {
    const id = s.getAttribute('id') || s.querySelector('situationRecordVersion')?.textContent || null;
    const severity = _txt(s, 'severity, severityValue, impactOnDrivingConditions') || 'unknown';
    const type = s.getAttribute('xsi:type') || _txt(s, 'situationRecordType') || 'unknown';
    const comment = _txt(s, 'generalPublicComment > values > value, comment, description') || '';
    // Location: try point coord first, then linear
    let lat = null, lon = null;
    const latEl = s.querySelector('latitude, Latitude');
    const lonEl = s.querySelector('longitude, Longitude');
    if (latEl && lonEl) {
      lat = parseFloat(latEl.textContent);
      lon = parseFloat(lonEl.textContent);
    }
    results.push({ id, severity, type, comment, lat, lon });
  }
  return results;
}
function _txt(root, sel) {
  const el = root.querySelector(sel);
  return el ? el.textContent.trim() : null;
}

export class TrafficEventRenderer {
  constructor() {
    this._viewer = null;
    this._dataSource = null;
    this._Cesium = null;   // resolved lazily on first use (Cesium may load async)
  }
  render(viewer, trafficPack) {
    if (this._viewer) this.clear();
    this._Cesium = this._Cesium || CesiumModule;
    if (!this._Cesium) { console.warn('[TrafficEventRenderer] Cesium not loaded — render aborted.'); return { situations: 0, plotted: 0 }; }
    this._viewer = viewer;
    const C = this._Cesium;
    this._dataSource = new C.CustomDataSource('sovereign-traffic');
    viewer.dataSources.add(this._dataSource);
    // Vejdirektoratet Dataudveksleren SHOULD return DATEX II XML; a few
    // endpoints occasionally serve JSON. Warn loudly if xml is missing.
    const xml = trafficPack?.data?.xml || '';
    if (!xml) console.warn('[TrafficEventRenderer] no XML in trafficPack.data.xml — endpoint may have returned JSON. Check Content-Type:', trafficPack?.data?.contentType);
    const situations = parseDatexIISituations(xml);
    let plotted = 0;
    for (const ev of situations) {
      if (typeof ev.lat !== 'number' || typeof ev.lon !== 'number') continue;
      this._dataSource.entities.add({
        id: `traffic-${ev.id}`,
        position: C.Cartesian3.fromDegrees(ev.lon, ev.lat),
        point: {
          pixelSize: 12,
          color: this._severityColor(ev.severity),
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          heightReference: C.HeightReference.CLAMP_TO_GROUND,
        },
        description: `
          <div style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:#e8ecef;">
            <div style="font-size:13px; font-weight:600; margin-bottom:6px;">${ev.type}</div>
            <div style="margin-bottom:8px; font-family:'IBM Plex Sans',sans-serif;">${ev.comment}</div>
            <table style="width:100%; border-collapse:collapse;">
              <tr><td style="padding:2px 6px; color:#b4c8dc;">Alvorlighed</td><td style="padding:2px 6px;">${ev.severity}</td></tr>
              <tr><td style="padding:2px 6px; color:#b4c8dc;">Position</td><td style="padding:2px 6px;">${ev.lat.toFixed(4)}°N, ${ev.lon.toFixed(4)}°E</td></tr>
            </table>
            <div style="margin-top:8px; font-size:9px; color:#7a8998; letter-spacing:0.1em; text-transform:uppercase;">Sourced from Vejdirektoratet Dataudveksleren (DATEX II)</div>
          </div>`,
      });
      plotted++;
    }
    return { situations: situations.length, plotted };
  }
  _severityColor(sev) {
    const C = this._Cesium;
    const s = String(sev || '').toLowerCase();
    if (s.includes('high') || s.includes('serious') || s.includes('major')) return C.Color.fromCssColorString('#ff4d4d');
    if (s.includes('medium') || s.includes('significant'))                  return C.Color.fromCssColorString('#ffb84d');
    if (s.includes('low') || s.includes('minor'))                            return C.Color.fromCssColorString('#4dff9c');
    return C.Color.fromCssColorString('#b4c8dc');
  }
  // Ensure a dataSource exists on the given viewer without wiping it.
  // Used by upsertFromXml so live-fed events can trickle in over time
  // without clearing the map between messages.
  _ensureDataSource(viewer) {
    if (this._viewer === viewer && this._dataSource) return this._dataSource;
    this._Cesium = this._Cesium || CesiumModule;
    if (!this._Cesium) return null;
    this._viewer = viewer;
    this._dataSource = new this._Cesium.CustomDataSource('sovereign-traffic');
    viewer.dataSources.add(this._dataSource);
    return this._dataSource;
  }
  // Merge one or more Situations (from a PayloadPublication XML blob) into
  // the live traffic layer. Called per WS push from vd-amqp-proxy. Existing
  // entities with the same id are replaced (dedup on situation id).
  upsertFromXml(viewer, situationXml) {
    const ds = this._ensureDataSource(viewer);
    if (!ds) { console.warn('[TrafficEventRenderer] Cesium not loaded — upsert aborted.'); return { situations: 0, plotted: 0 }; }
    const C = this._Cesium;
    const situations = parseDatexIISituations(situationXml || '');
    let plotted = 0;
    for (const ev of situations) {
      if (typeof ev.lat !== 'number' || typeof ev.lon !== 'number') continue;
      const id = `traffic-${ev.id}`;
      const existing = ds.entities.getById(id);
      if (existing) ds.entities.remove(existing);
      ds.entities.add({
        id,
        position: C.Cartesian3.fromDegrees(ev.lon, ev.lat),
        point: {
          pixelSize: 12,
          color: this._severityColor(ev.severity),
          outlineColor: C.Color.BLACK,
          outlineWidth: 2,
          heightReference: C.HeightReference.CLAMP_TO_GROUND,
        },
        description: `
          <div style="font-family:'IBM Plex Mono',monospace; font-size:11px; color:#e8ecef;">
            <div style="font-size:13px; font-weight:600; margin-bottom:6px;">${ev.type}</div>
            <div style="margin-bottom:8px; font-family:'IBM Plex Sans',sans-serif;">${ev.comment}</div>
            <table style="width:100%; border-collapse:collapse;">
              <tr><td style="padding:2px 6px; color:#b4c8dc;">Alvorlighed</td><td style="padding:2px 6px;">${ev.severity}</td></tr>
              <tr><td style="padding:2px 6px; color:#b4c8dc;">Position</td><td style="padding:2px 6px;">${ev.lat.toFixed(4)}°N, ${ev.lon.toFixed(4)}°E</td></tr>
            </table>
            <div style="margin-top:8px; font-size:9px; color:#7a8998; letter-spacing:0.1em; text-transform:uppercase;">Sourced from Vejdirektoratet Dataudveksleren (DATEX II) via vd-amqp-proxy</div>
          </div>`,
      });
      plotted++;
    }
    return { situations: situations.length, plotted };
  }
  clear() {
    if (this._dataSource && this._viewer) {
      try { this._viewer.dataSources.remove(this._dataSource, true); } catch (_) {}
    }
    this._dataSource = null; this._viewer = null;
  }
}
