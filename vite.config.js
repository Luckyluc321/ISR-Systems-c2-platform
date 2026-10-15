import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

// DEV PROXY FOR THE INFERENCE ENDPOINT.
//
// Scaleway's gateway returns access-control-allow-origin on the CORS
// PREFLIGHT but not on the actual response. Verified by hand: OPTIONS
// /v1/chat/completions returns 200 with the header and our origin
// allowed, while a POST returns 403 with no CORS header at all. The
// browser therefore blocks a response it already received, and fetch
// rejects with "Failed to fetch", which hides the real status entirely.
//
// Nothing in the client can fix that, because the header has to come
// from the server. Proxying through the dev server makes the call
// same-origin, so no CORS check happens and the real status code
// reaches the app, including the 403 that was being masked.
//
// Dev only. Production goes through the Azure sovereign proxy, which is
// what VITE_MISTRAL_ENDPOINT points at there. See IDD IF-9.7.
//
// To use it, set this in .env.local:
//   VITE_MISTRAL_ENDPOINT=/scw/v1/chat/completions
// A relative URL is same-origin, so it lands here and gets forwarded.
export default defineConfig({
  plugins: [cesium()],
  server: {
    host: true,
    proxy: {
      '/scw': {
        target: 'https://api.scaleway.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/scw/, ''),
      },
      // DEV PROXY FOR THE COOPERATIVE TRAFFIC FEED.
      //
      // OpenSky answers a browser request with
      // access-control-allow-origin: https://opensky-network.org, which
      // is its own origin and never ours, so every call from localhost
      // was blocked after the response had already arrived. The console
      // filled with a CORS failure and a net::ERR_FAILED on a request
      // that returned 200.
      //
      // Same remedy as the inference endpoint above: same-origin through
      // the dev server, no preflight, and the real status reaches the
      // adapter, which already treats a non-ok response as "feed
      // offline" and returns no tracks.
      //
      // Dev only. Production reads the feed server side, because a
      // browser-held credential is not a credential. See IDD IF-10.1.
      '/osky': {
        target: 'https://opensky-network.org',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/osky/, '/api'),
      },
    },
  },
});
