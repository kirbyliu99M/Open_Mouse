import type { NextConfig } from "next";

/**
 * Security headers for every route (L1 hardening finding). Static, via
 * `headers()` — not per-request middleware — so there is no per-request
 * nonce available; the CSP below is built around that constraint rather
 * than assuming one.
 *
 * `script-src`: `'self'` for every bundled/served script (all same-origin,
 * `public/mediapipe/**` included — verified: `src/client/photo/landmarks.ts`
 * loads `/mediapipe/wasm/*` and `/mediapipe/models/*`, nothing off-origin).
 * `'wasm-unsafe-eval'` is required for `WebAssembly.instantiate` — the
 * MediaPipe WASM runtime needs it, and it is far narrower than `'unsafe-eval'`
 * (it permits only WASM compilation/instantiation, not `eval`/`new
 * Function` on arbitrary strings). `'unsafe-inline'` is required too: Next's
 * App Router server-streams RSC payloads as inline
 * `<script>(self.__next_f=...).push(...)</script>` tags with no `nonce` or
 * hash (confirmed against a real `next build && next start` response body —
 * see the PR description) — CSP has no way to allow those without either a
 * per-request nonce (needs middleware, out of scope for a static
 * `next.config.ts` header) or `'unsafe-inline'`. This is the same trade-off
 * Next's own CSP docs describe for a nonce-less setup; it does not permit
 * cross-origin script loading (still blocked by `'self'`), only inline
 * script *content*.
 *
 * `'unsafe-eval'` is added to `script-src` ONLY when `NODE_ENV !==
 * "production"` (i.e. `next dev`, which is what the e2e suite's webServer
 * runs): webpack's dev-mode Fast Refresh/HMR runtime evaluates code as a
 * string (confirmed directly — without this, Chrome logs "Evaluating a
 * string as JavaScript violates the following Content Security Policy
 * directive… 'unsafe-eval'" and the page never finishes hydrating). A
 * production build has no such runtime and was verified clean without it
 * (`next build && next start` — see the PR description), so production
 * traffic never gets the wider allowance.
 *
 * `worker-src 'self' blob:'`: the vendored MediaPipe runtime
 * (`public/mediapipe/wasm/vision_wasm_internal.js`, checked directly) does
 * not spawn a Web Worker under the CPU delegate this app uses — only
 * `connect-src`/fetch is actually exercised today — but MediaPipe is
 * documented to use a blob-URL worker under other delegates/versions, so
 * this is included defensively; a `blob:` worker still only ever runs
 * same-origin script content, so it costs nothing to allow ahead of need.
 *
 * `connect-src 'self'`: same-origin `fetch` to `/api/**` and to the WASM/
 * model files above (loaded via `fetch`, not `<script src>`, so `script-src`
 * alone would not cover them).
 *
 * `style-src 'self' 'unsafe-inline'`: Next's built-in error page
 * (`/_not-found` and friends) renders an inline `<style>` tag with no nonce
 * (also confirmed against a real build); nothing in this app's own code
 * needs it, but the framework does.
 *
 * `img-src 'self' data: blob:`: `data:`/`blob:` for canvas-derived and
 * captured-photo previews client-side; no image is ever fetched
 * cross-origin.
 *
 * `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`,
 * `object-src 'none'`: no legitimate reason for this app to be framed, have
 * its `<base>` retargeted, submit a form to another origin, or load a
 * plugin/object embed.
 */
const IS_DEV = process.env.NODE_ENV !== "production";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ""}`,
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
