import { isCronAuthorized } from "../cron/auth";
import { log } from "../log";
import type { ErrorPhotoPurgeReport } from "../error-photos/purge";
import type { TesterPhotoPurgeReport } from "../tester/purge";
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
  /**
   * The tester photos' retention (src/server/tester/purge.ts, candidate
   * 未拍板): same rule, only with the Blob store connected, whatever
   * `TESTER_CODES` says. Runs after the error photos, on its own: a failure
   * is logged (class only) and reported as `testerPhotos: "failed"`.
   */
  purgeTesterPhotos?: () => Promise<TesterPhotoPurgeReport>;
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
 * The tester photos' purge follows the same way (`testerPhotos`).
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
  const body: Record<string, unknown> = { deleted, rateLimitsDeleted };
  if (deps.purgeErrorPhotos) {
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
    body.errorPhotos = errorPhotos;
  }
  if (deps.purgeTesterPhotos) {
    let testerPhotos: TesterPhotoPurgeReport | "failed";
    try {
      testerPhotos = await deps.purgeTesterPhotos();
    } catch (error) {
      log.error("tester.purge_failed", {
        route: "/api/cron/expire-sessions",
        op: "purge",
        error,
      });
      testerPhotos = "failed";
    }
    body.testerPhotos = testerPhotos;
  }
  return json(200, body);
}
