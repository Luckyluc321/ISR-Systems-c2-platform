# ISR Systems — C2 Platform

Command and Control platform for the ISR Systems drone detection network. Built on CesiumJS with NASA Black Marble night imagery and CartoDB Dark Matter tile fallback for tactical zoom.

Three login journeys share the same codebase — single-site operator, multi-site operator, state operator. Role determines the initial camera position and default layers.

## Stack

- **CesiumJS** — 3D globe, defense-grade, powers Palantir Foundry Map
- **Vite** — dev server + build
- **NASA Black Marble** — night lights imagery at globe zoom (free, no API key)
- **CartoDB Dark Matter** — road-level tactical view (free, no API key)
- **Cesium Ion** — terrain (free tier)

## Local development

```bash
npm install
cp .env.example .env.local
# Edit .env.local and paste your Cesium Ion token
npm run dev
```

Get a Cesium Ion token at [ion.cesium.com/tokens](https://ion.cesium.com/tokens) (free).

## Deploy

Auto-deploys to Vercel on push to `main`. Set the `VITE_CESIUM_ION_TOKEN` env var in the Vercel project settings.

## Repository layout

```
src/
  main.js       # Cesium bootstrap + tile config + camera state
  style.css     # Dark theme, CSS reset
  assets/       # (empty, ready for icons/images)
index.html      # Root HTML shell
vite.config.js  # Vite + Cesium plugin config
```

## Related

- Product spec and design language in ISR Systems internal docs
- Linear project [C2 Platform](https://linear.app/isr-systems/project/c2-platform-cf1453a7df61)
- v0 mockup [Site View design reference](https://claude.ai/code/artifact/9f748d8c-4b7d-44bd-8d81-d9ff11860612)
