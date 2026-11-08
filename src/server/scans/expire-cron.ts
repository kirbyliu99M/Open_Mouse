import { isCronAuthorized } from "../cron/auth";
import { log } from "../log";
import type { ErrorPhotoPurgeReport } from "../error-photos/purge";
import type { ScanRepo } from "./repo";

export interface ExpireSessionsDeps {
  repo: ScanRepo;
  /** `undefined` (unset env var) always fails the check — never open by default. */
  cronSecret: string | undefined;
  now?: () => Date;
  /**
   * The error photos' retention (src/server/error-photos/purge.ts, candidate
   * 未拍板). The route passes it only when the Blob store is connected
   * (`BLOB_READ_WRITE_TOKEN`); absent, the response is exactly what it was.
   * It runs whatever the error-photo flag says: a photo sent while the flag
   * was on is still deleted on time after it is switched off.
   */
  purgeErrorPhotos?: () => Promise<ErrorPhotoPurgeReport>;
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
 * Then, when given, the error photos' purge, last and on its own: a failure
 * there is logged (the error's class only) and reported as
 * `errorPhotos: "failed"`, and never undoes or blocks the two sweeps above.
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
  if (!deps.purgeErrorPhotos) return json(200, { deleted, rateLimitsDeleted });
  let errorPhotos: ErrorPhotoPurgeReport | "failed";
  try {
    errorPhotos = await deps.purgeErrorPhotos();
  } catch (error) {
    log.error("error_photo.purge_failed", {
      route: "/api/cron/expire-sessions",
      op: "purge",
      error,
    });
    errorPhotos = "failed";
  }
  return json(200, { deleted, rateLimitsDeleted, errorPhotos });
}
