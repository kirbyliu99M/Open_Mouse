// Sentry in the browser. Every option, and why each is set, is in
// src/lib/observability/sentry.ts. No Session Replay: it would record the
// camera preview on the scan page.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_OPTIONS } from "@/lib/observability/sentry";

Sentry.init(SENTRY_OPTIONS);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
