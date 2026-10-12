// Static parked aircraft.
//
// Billund's buildings come from a height model with a bad vintage, so the
// terminal renders flat and the apron reads as painted texture rather than
// a place. Parked aircraft are the cheapest way to give that foreground
// real geometry, and the imagery already has 2D aircraft baked into it, so
// a model dropped on top of one replaces a flat shape with a solid one.
//
// Data, not code. A stand is a row in PARKED: where it is, which way it
// faces, which model, how big. Adding one is a line.
//
// POSITIONED BY EYE, ON PURPOSE. Placing a model on a texture-painted
// aircraft cannot be computed from a manifest, because the paint is in the
// imagery and the manifest does not know about it. So every row here is
// meant to be dialled in live with window.__isr_parkedSet and then written
// down, which is the only method that has actually worked for placement in
// this codebase.

export const PARKED = [
  {
    id: 'bll-terminal-1',
    site: 'billund',
    label: 'Terminal apron, in front of BLL-N03',
    // Placed on the aircraft painted into the orthophoto, by clicking it
    // on the map and nudging. Not derivable from the manifest: the paint
    // is in the imagery and the manifest does not know it exists.
    lat: 55.737268,
    lon: 9.154616,
    // Metres above the terrain. Aircraft sit ON the apron, so this is
    // the model origin's height above ground, not an altitude.
    heightM: 0,
    // Compass degrees the nose points. 220 puts it nose southwest,
    // matching the painted aircraft's parking angle on this stand.
    headingDeg: 220,
    uri: '/aircraft/airbus_a380.glb',
    // SCALE 1 IS CORRECT, measured rather than assumed. This model is
    // authored in real metres: X spans 79.80, which is the A380's 79.75 m
    // wingspan; Y spans 72.45 against its 72.72 m length; Z spans 24.11
    // against 24.09 m. Wheels sit at Z ~ 0, so terrain clamping puts it
    // on the apron rather than through it.
    //
    // Nose on -Y, tail fin at +Y rising to 23.8 m, wings the 79.8 m
    // slice. Same axis convention as the Seahawk, so the -90 heading
    // offset in this file is already right for it.
    scale: 1,
    // Same rule as every other model in this repo: CC-BY needs an
    // attribution entry, CC0 and Sketchfab Standard do not.
    attribution: null,
  },
];

// Live placement. Mirrors window.__isr_muzzleSet, which is the only
// workflow that has reliably landed a model in the right place here:
//
//   __isr_parkedSet('bll-terminal-1', { headingDeg: 135 })
//   __isr_parkedSet('bll-terminal-1', { lat: 55.7371, lon: 9.1503 })
//   __isr_parkedSet('bll-terminal-1', {})        // read the current row
//
// It returns the row, so the values can be pasted straight back into
// PARKED above once it looks right.
export function createParkedAircraft(viewer, Cesium, { rows = PARKED } = {}) {
  const live = new Map();

  function build(row) {
    const old = live.get(row.id);
    if (old) viewer.entities.remove(old);
    const ent = viewer.entities.add({
      id: `parked-${row.id}`,
      position: new Cesium.CallbackProperty(
        () => Cesium.Cartesian3.fromDegrees(row.lon, row.lat, row.heightM || 0), false),
      orientation: new Cesium.CallbackProperty(() => {
        const cart = Cesium.Cartesian3.fromDegrees(row.lon, row.lat, row.heightM || 0);
        // -90 for the same reason every other model in this file's
        // sibling needs it: Cesium's heading 0 puts a model's +X along
        // EAST in the local east-north-up frame, so a nose authored on
        // +X points east until it is turned a quarter circle back to
        // north.
        const hpr = new Cesium.HeadingPitchRoll(
          ((row.headingDeg || 0) - 90) * Math.PI / 180, 0, 0);
        return Cesium.Transforms.headingPitchRollQuaternion(cart, hpr);
      }, false),
      model: {
        uri: row.uri,
        scale: row.scale ?? 1,
        minimumPixelSize: 0,
        // Clamped to the terrain, so it sits on the apron rather than
        // at an absolute altitude that would float or sink with the
        // height model.
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        // No clips are driven anywhere in this app: the Cesium clock is
        // pinned so the sun holds still, so animations never advance.
        // Parked aircraft do not need any, but say so rather than leave
        // the next person to discover it.
        runAnimations: false,
        shadows: Cesium.ShadowMode.DISABLED,
      },
      properties: { type: 'parked-aircraft', siteId: row.site, stand: row.id },
    });
    live.set(row.id, ent);
    return ent;
  }

  rows.forEach(build);

  if (typeof window !== 'undefined') {
    window.__isr_parkedSet = (id, patch = {}) => {
      const row = rows.find(r => r.id === id);
      if (!row) {
        console.warn('[parked] no such stand:', id, '- have:', rows.map(r => r.id));
        return null;
      }
      Object.assign(row, patch);
      // Rebuilt rather than mutated, because `uri` and `scale` are read
      // once when the model graphic is created and will not update in
      // place.
      build(row);
      const { id: _i, site: _s, label: _l, attribution: _a, ...vals } = row;
      console.log(`[parked ${id}]`, vals);
      return row;
    };
    // CLICK TO PLACE. Absolute lat/lon is the wrong interface for lining
    // something up against a feature you can see: you would have to know
    // the coordinate first, which is the whole problem. Arm this, click
    // the spot on the map, done.
    //
    //   __isr_parkedPick('bll-terminal-1')
    //
    // One click only, then it disarms, so it cannot hijack normal
    // interaction with the map.
    window.__isr_parkedPick = (id) => {
      const row = rows.find(r => r.id === id);
      if (!row) { console.warn('[parked] no such stand:', id); return; }
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      console.log(`[parked ${id}] armed - click the spot on the map`);
      handler.setInputAction((click) => {
        const ray = viewer.camera.getPickRay(click.position);
        const cart = ray && viewer.scene.globe.pick(ray, viewer.scene);
        handler.destroy();
        if (!cart) { console.warn('[parked] click missed the globe, try again'); return; }
        const c = Cesium.Cartographic.fromCartesian(cart);
        row.lat = Number(Cesium.Math.toDegrees(c.latitude).toFixed(6));
        row.lon = Number(Cesium.Math.toDegrees(c.longitude).toFixed(6));
        build(row);
        console.log(`[parked ${id}] placed`, { lat: row.lat, lon: row.lon });
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    };

    // RELATIVE NUDGE, in metres and degrees, so it can be walked into
    // place without knowing a single coordinate:
    //
    //   __isr_parkedNudge('bll-terminal-1', { north: 10 })
    //   __isr_parkedNudge('bll-terminal-1', { east: -5, headingDeg: 15 })
    //
    // north/east are metres and signed. headingDeg and scale are added
    // to what is there, not set.
    window.__isr_parkedNudge = (id, { north = 0, east = 0, headingDeg = 0, scale = 0 } = {}) => {
      const row = rows.find(r => r.id === id);
      if (!row) { console.warn('[parked] no such stand:', id); return null; }
      row.lat = Number((row.lat + north / 111320).toFixed(6));
      row.lon = Number((row.lon + east
        / (111320 * Math.cos(row.lat * Math.PI / 180))).toFixed(6));
      if (headingDeg) row.headingDeg = (((row.headingDeg || 0) + headingDeg) % 360 + 360) % 360;
      if (scale) row.scale = Number(((row.scale ?? 1) + scale).toFixed(4));
      build(row);
      console.log(`[parked ${id}]`,
        { lat: row.lat, lon: row.lon, headingDeg: row.headingDeg, scale: row.scale });
      return row;
    };

    window.__isr_parkedList = () => {
      console.table(rows.map(r => ({ id: r.id, lat: r.lat, lon: r.lon,
        headingDeg: r.headingDeg, scale: r.scale, uri: r.uri })));
      return rows;
    };
  }

  return {
    entities: live,
    show(on) { for (const e of live.values()) e.show = !!on; },
    destroy() { for (const e of live.values()) viewer.entities.remove(e); live.clear(); },
  };
}
