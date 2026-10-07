// Sentry on the edge runtime (middleware, edge routes): loaded by
// src/instrumentation.ts. Every option is in src/lib/observability/sentry.ts.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_OPTIONS } from "@/lib/observability/sentry";

Sentry.init(SENTRY_OPTIONS);
