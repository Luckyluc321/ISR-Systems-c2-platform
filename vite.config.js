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
    },
  },
});
