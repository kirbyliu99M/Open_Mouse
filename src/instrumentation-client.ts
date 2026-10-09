// Sentry in the browser. Every option, and why each is set, is in
// src/lib/observability/sentry.ts. No Session Replay: it would record the
// camera preview on the scan page.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_OPTIONS } from "@/lib/observability/sentry";

// Events go to the same-origin /monitoring route handler, which forwards the
// envelope and nothing else (no cookie, no client address).
Sentry.init({ ...SENTRY_OPTIONS, tunnel: "/monitoring" });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
