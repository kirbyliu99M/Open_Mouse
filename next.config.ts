import { withSentryConfig } from "@sentry/nextjs/config";
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
 * `connect-src 'self'`: same-origin `fetch` to `/api/**`, `/ingest/**` (the
 * PostHog reverse proxy, a route handler), `/monitoring` (the Sentry tunnel,
 * also a route handler) and to the WASM/
 * model files above (loaded via `fetch`, not `<script src>`, so `script-src`
 * alone would not cover them).
 *
 * WARNING: do not widen `connect-src`. MediaPipe's bundle tries to POST usage
 * metrics to https://odml.pa.googleapis.com/v1/log every 60 seconds, and this
 * directive is the only thing that stops that request. Adding any origin (or
 * `*`) would let the metrics leave the browser. The source list is pinned to
 * exactly `'self'` by `tests/unit/next-config-headers.test.ts`; changing it
 * means deciding what to do about the metrics first (see
 * `public/mediapipe/README.md`).
 *
 * `style-src 'self' 'unsafe-inline'`: Next's built-in error page
 * (`/_not-found` and friends) renders an inline `<style>` tag with no nonce
 * (also confirmed against a real build); nothing in this app's own code
 * needs it, but the framework does.
 *
 * `img-src 'self' data: blob:`: `data:`/`blob:` for canvas-derived and
 * captured-photo previews client-side. The one cross-origin image is the
 * signed-in user's own Google avatar (`https://lh3.googleusercontent.com`),
 * loaded without a referrer for the nav.
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
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * `public/mediapipe/**` (the ~11 MB WASM runtime, its JS glue and the 7.8 MB
 * hand model) is served with Vercel's default for static files,
 * `public, max-age=0, must-revalidate`: every page load sends a conditional
 * request per file even though the bytes almost never change.
 *
 * The file names carry no hash, so `immutable` would be wrong: it would pin a
 * replaced file in browsers for as long as the header says. A bounded
 * `max-age` plus `stale-while-revalidate` is the safe middle: repeat visits
 * within a day use the cached copy with no request; after that the stale copy
 * is used once while the browser refreshes it in the background.
 *
 * The one hazard is replacing these files in place (a MediaPipe upgrade): the
 * JS glue and the WASM binary must come from the same version, and caches
 * expire per file. `public/mediapipe/README.md` says an upgrade goes in a new,
 * versioned directory (with the two paths in
 * `src/client/photo/landmarks.ts` updated) — which also makes `immutable`
 * safe — rather than over the existing names.
 */
const MEDIAPIPE_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev-mode indicator badge has no place in a design screenshot — off
  // in every environment, not just for captures (item 7).
  devIndicators: false,
  // Events go through the same-origin route handler at /ingest (issue #138;
  // src/app/ingest/[...path]/route.ts), so the CSP's `connect-src 'self'` is
  // unchanged and needs no PostHog origin. It is a handler and not a
  // `rewrites()` rule because a rewrite to an external host forwards the
  // browser's Cookie header (scan_session, the Auth.js session) and its
  // X-Forwarded-For to PostHog.
  //
  // posthog-js posts to `/ingest/e/` with a trailing slash. Next's canonical
  // 308 from `/x/` to `/x` would redirect that POST, which `sendBeacon` does
  // not follow reliably, so the redirect is skipped globally and `redirects()`
  // below restores it for every path except /ingest.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      {
        source: "/:path((?!ingest(?:/|$)).+)/",
        destination: "/:path",
        permanent: true,
      },
    ];
  },
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
      // After the catch-all rule on purpose: it sets no Cache-Control, but if
      // two matching rules ever set the same header, the later one wins.
      {
        source: "/mediapipe/:path*",
        headers: [{ key: "Cache-Control", value: MEDIAPIPE_CACHE_CONTROL }],
      },
    ];
  },
};

/**
 * Sentry's build wrapper. Runtime options are in
 * src/lib/observability/sentry.ts.
 *
 * No `tunnelRoute`: it is a `rewrites()` rule to Sentry's ingest host, which
 * would forward the browser's cookies and address. The browser sends events
 * to the /monitoring route handler instead (src/app/monitoring/route.ts),
 * which keeps the CSP's `connect-src 'self'` as it is (see the WARNING above).
 *
 * Source maps upload only when SENTRY_AUTH_TOKEN is set (the Vercel build);
 * without it the build still succeeds and stack traces stay minified.
 */
export default withSentryConfig(nextConfig, {
  org: "bowen-zo",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});
