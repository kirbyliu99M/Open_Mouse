// Sentry on the Node server: loaded by src/instrumentation.ts. Every option,
// and why each is set, is in src/lib/observability/sentry.ts.
import * as Sentry from "@sentry/nextjs";
import { SENTRY_OPTIONS } from "@/lib/observability/sentry";

Sentry.init(SENTRY_OPTIONS);
