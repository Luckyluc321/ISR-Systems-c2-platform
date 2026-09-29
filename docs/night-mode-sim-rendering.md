# Night mode — Sim-only real building rendering

**Scope:** `applyImageryMode()` in `src/main.js` (night branch only). Governs whether Night mode shows real Google Photorealistic 3D Tiles buildings (dimmed, textured) or the flat OSM Buildings placeholder, and how those buildings are lit once the real sun is below the horizon.

**Status as of 2026-09-21: unverified.** Every fix below is confirmed correct by reading Cesium's own source in `node_modules/@cesium/engine`, not by seeing it render — this session has no browser access. Each fix has removed one confirmed, real defect. Whether the buildings now look right has not been visually confirmed by anyone.

---

## Current mechanism

- Gate: `_isSimMode()` (Config page Real/Sim platform toggle, `src/main.js` ~19240). Real mode is untouched by design — every write below is either skipped or reverted to its pre-existing value when `_isSimMode()` is false.
- Real mode's night look (OSM Buildings only, `googlePhotoreal.show = false`) is byte-for-byte what shipped before this work started. Never touch it without the user's explicit go-ahead.
- Sim + Night: `googlePhotoreal.show = true`, dimmed via a **fixed-angle custom `viewer.scene.light` (`Cesium.DirectionalLight`)** instead of the real sun (which is below the horizon at the pinned night clock, so N·L ≈ 0 everywhere and produces no shading variation — see root causes below). `scene.light` is scene-global, so it's reset to `undefined` (Cesium's real default) unconditionally at the top of `applyImageryMode()` and only overridden inside the Sim+Night branch.
- `osmBuildings` (rural fallback outside Google's coverage) gets the same directional-light treatment in Sim mode so it isn't jarringly black next to the lit photoreal buildings; Real mode keeps its original dim tint.

## Root causes found and fixed this session (in order)

1. **Leftover duplicate write.** A second `googlePhotoreal.show = false` ran unconditionally *after* the new Sim-mode conditional, silently overriding it every time. Left over from a revert-then-reapply edit sequence. → removed.
2. **`imageBasedLightingFactor` is a multiplier, not a floor.** It scales Cesium's default ambient (`luminanceAtZenith ≈ 0.2`), so `factor=0.35` → ~0.07 effective brightness — visually black despite being nonzero. `lightColor` only scales the *direct* (sun) term, which is ~0 at night regardless of its value, so it was doing nothing.
3. **Hard API ceiling.** Tried pushing `imageBasedLightingFactor` to 2.4 to compensate for (2). Cesium's setter throws `DeveloperError` above 1.0 (`ImageBasedLighting.js:123`) — this aborted `applyImageryMode()` partway through on *every single call*, so nothing after that line (osmBuildings, `__isr_sdfiLayer`, `nightBloom`) ever ran either. Confirmed via dev-server log timestamps matching the user's screenshots exactly. → capped at 1.0, pushed `lightColor` (unclamped, plain property) instead.
4. **Ambient-only light has no directional variation.** Even fixed and uncrashing, IBL-only lighting renders as a flat grey wash — it can't reveal real texture/geometry the way directional (N·L-varying) light does. → replaced with a fixed-angle custom `scene.light` (fake moonlight, doesn't track the real sun), same mechanism day mode's real sun uses.

5. **`scene.light` is not a per-tileset setting — it drives the globe too.** An attempt to light night buildings with a fixed-angle `DirectionalLight` set `viewer.scene.light`. Per `UniformState.js:1454-1473`, any light that is not a `SunLight` makes Cesium **discard the sun position and the clock entirely** for the globe surface shader (`GlobeFS.glsl:441`) as well. The chosen vector resolved to a permanent fake sun over the North Atlantic, putting Denmark at full daylight at every clock value. **This is what made night mode render as full daylight.** → removed; `scene.light` is now never written anywhere in `applyImageryMode()`. Light buildings via per-tileset `imageBasedLighting` only.
6. **Google Photorealistic 3D Tiles has global coverage and daytime-baked textures.** Showing it unconditionally in Sim+Night painted a lit photoreal shell over the whole planet at high altitude. It's a scene primitive, so `bingLayer.brightness = 0.15` cannot dim it — the Bing layer wasn't even what was visible. → gated behind a camera-altitude check (`_updateNightPhotoreal`, 50 km), re-evaluated on `camera.moveEnd` since `applyImageryMode()` only runs on mode change.
7. **`lightColor` above 1.0 is a no-op.** `UniformState.js:1488-1494` renormalises `czm_lightColor` to max-component 1.0. Earlier fixes that "boosted" it to 3.5 did nothing. → set to `undefined`; `imageBasedLightingFactor` (max 1.0) is the only real lever.

8. **Lighting cannot darken Google Photorealistic tiles at all.** That asset is daylight photography with the light baked into the texture, and its materials are commonly unlit — so `scene.light`, `lightColor` and `imageBasedLighting` are all ignored. This is why it rendered as full daylight at close zoom regardless of lighting values. → the working lever is `tileset.style` colour: `colorBlendMode` defaults to `HIGHLIGHT`, documented as *"multiplies the source color by the feature color"*, a shader multiply that runs regardless of lighting and preserves photographic detail (unlike a replace, which flattens it).
9. **OSM Buildings rendered as glaring white boxes over the photoreal buildings.** Its default material is near-white, so lighting alone can only pick between black and white. → dark style multiply (same lever as 8), tinted darker than the photoreal tint because it starts from white rather than a photographic mid-tone.

   A first attempt also made the two tilesets mutually exclusive (hide OSM where photoreal renders). **Reverted** — day mode shows both, and day is the target look; hiding one is not day parity and silently removes buildings anywhere Google's coverage lacks building meshes. Night differs from day only in being darker, and that difference is carried entirely by the style multiply.

## Design rule

Night mode = day mode configuration + darkness. Do not hide layers, swap assets, or change materials to achieve night. The only night-specific difference on the building tilesets should be the style-colour multiply. Anything else diverges from the look the day path already gets right.

## Not built

- **City lights at street level.** The only city-light source wired up is `earthAtNightLayer` (VIIRS, ~750 m/px) — usable as glow blobs at regional/global zoom, nothing at close zoom. Lit windows at building scale would need emissive shader work and is not started.

## Testing note

Buildings cannot be evaluated from the default whole-Earth boot camera (18,000 km). At that altitude no building tiles are requested at all. Fly to a site first.

## Known-unverified

- Whether the custom `DirectionalLight` angle/intensity actually looks right (chosen direction is a guess at a plausible moonlight angle, not tuned against a live render).
- Whether `earthAtNightLayer` (Cesium's real VIIRS city-lights imagery) is actually visible now that the altitude-triggered close-up override that used to hide it has been deleted (see git history for the hand-drawn night-lighting system removal, same session).
- The originally-reported "full day sky" symptom — traced every write to sky/clock/atmosphere/imagery brightness and found no code path that explains it; the confirmed crash (root cause 3) is the best available explanation but wasn't proven to be the sole cause.
