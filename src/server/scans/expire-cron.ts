import { isCronAuthorized } from "../cron/auth";
import type { ScanRepo } from "./repo";

export interface ExpireSessionsDeps {
  repo: ScanRepo;
  /** `undefined` (unset env var) always fails the check — never open by default. */
  cronSecret: string | undefined;
  now?: () => Date;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `GET /api/cron/expire-sessions`. Vercel Cron sends `CRON_SECRET` as a
 * bearer token (vercel.json's schedule); any other caller gets 401. Also
 * sweeps ended `rate_limits` windows (L2 hardening finding) — one extra
 * DELETE alongside the existing session expiry, reported as its own count
 * so the two sweeps stay individually visible in the cron's logs/response.
 */
export async function handleExpireSessions(
  request: Request,
  deps: ExpireSessionsDeps,
): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (!isCronAuthorized(authorization, deps.cronSecret)) {
    return json(401, { error: "Unauthorized" });
  }
  const now = deps.now ?? (() => new Date());
  const deleted = await deps.repo.deleteExpiredAnonymousSessions(now());
  const rateLimitsDeleted = await deps.repo.deleteEndedRateLimitWindows(now());
  return json(200, { deleted, rateLimitsDeleted });
}
