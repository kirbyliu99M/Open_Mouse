import { SENTRY_DSN } from "@/lib/observability/sentry";
import { proxyEnvelope } from "@/server/observability/tunnel";

export const dynamic = "force-dynamic";

/**
 * Same-origin tunnel for browser Sentry events: keeps the CSP's
 * `connect-src 'self'` and, unlike the SDK's `tunnelRoute` rewrite, forwards
 * no cookie and no client address (src/server/observability/tunnel.ts).
 */
export async function POST(request: Request): Promise<Response> {
  return proxyEnvelope(request, { dsn: SENTRY_DSN, fetchImpl: fetch });
}
