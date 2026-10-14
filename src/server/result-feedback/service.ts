import {
  resultFeedbackStatusResponseSchema,
  resultFeedbackSubmissionSchema,
  resultFeedbackSubmitResponseSchema,
} from "../../lib/contracts/result-feedback";
import { scanSubmitResponseSchema } from "../../lib/contracts/routes";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../analysis/ip";
import type { FitRepo } from "../fit/repo";
import { log } from "../log";
import { BodyTooLargeError, readLimitedBody } from "../scans/body-limit";
import { readSessionCookie } from "../scans/cookies";
import type { RateLimiter } from "../scans/rate-limit-config";
import type { ScanRepo } from "../scans/repo";
import { flattenIssues } from "../scans/submit";
import { startOfUtcDay } from "../survey/profile";
import type { ResultFeedbackRepo } from "./repo";
import { buildSnapshot } from "./snapshot";

/**
 * Body cap for `POST /api/scans/{id}/feedback` (a candidate, 未拍板). The
 * largest body the schema accepts is a 500-character comment, in the worst
 * case written as `\uXXXX` escapes (6 bytes each, 3 KB), plus the notice
 * version, stars and locale: about 3.2 KB. 8 KiB is room over that and still
 * refuses anything that is not a rating.
 */
export const MAX_RESULT_FEEDBACK_BODY_BYTES = 8 * 1024;

/** The route name every feedback log line carries. */
export const RESULT_FEEDBACK_LOG_ROUTE = "/api/scans/[scanId]/feedback";

// Every response from this path, errors included, is `no-store` (routes.ts).
const NO_STORE = { "cache-control": "no-store" } as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

export interface ResultFeedbackDeps {
  scanRepo: Pick<ScanRepo, "findOwnedScan">;
  /** The catalogue as the fit route loads it, for the snapshot's engine run. */
  fitRepo: Pick<FitRepo, "loadCatalogue">;
  feedbackRepo: ResultFeedbackRepo;
  /**
   * Per-IP limit. Required, not defaulted: a route that forgets it must fail
   * to compile rather than ship unlimited.
   */
  limiter: RateLimiter;
  /** The signed-in caller's user id, or null. Wraps `auth()` in the real route. */
  getUserId: () => Promise<string | null>;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * What a log line may say about a failure: the route, the operation and the
 * error's class. Never the body, a comment or a snapshot. Also the route's
 * answer when it cannot build its dependencies (a missing `DATABASE_URL`).
 */
export function logFailure(op: "submit" | "status", error: unknown): Response {
  log.error("result_feedback.failed", {
    route: RESULT_FEEDBACK_LOG_ROUTE,
    op,
    error,
  });
  return json(500, { error: "Something went wrong. Try again in a moment." });
}

async function isRateLimited(
  request: Request,
  limiter: RateLimiter,
): Promise<boolean> {
  const clientIp = resolveClientIp(request.headers);
  if (clientIp === UNKNOWN_IP_KEY) return false;
  return !(await limiter.allow(clientIp));
}

const isScanId = (scanId: string): boolean =>
  scanSubmitResponseSchema.shape.scanId.safeParse(scanId).success;

/**
 * `POST /api/scans/{scanId}/feedback`. Order (routes.ts): per-IP rate limit
 * (429) -> body size (413) -> malformed id or ownership (404, one body for
 * every cause, the repo never asked for a malformed id) -> body not JSON or
 * fails the schema (400) -> the write, which refuses a scan already rated
 * (409) inside the same atomic request as the insert -> 201.
 *
 * The snapshot is computed here, from the scan, never from the body. Nothing
 * in any response or log line echoes the comment.
 */
export async function handleResultFeedbackSubmission(
  request: Request,
  scanId: string,
  deps: ResultFeedbackDeps,
): Promise<Response> {
  try {
    if (await isRateLimited(request, deps.limiter)) {
      return json(429, { error: "Too many requests. Try again shortly." });
    }

    let bodyText: string;
    try {
      bodyText = await readLimitedBody(request, MAX_RESULT_FEEDBACK_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return json(413, { error: "Request body too large." });
      }
      throw error;
    }

    if (!isScanId(scanId)) return json(404, { error: "Scan not found." });
    const now = (deps.now ?? (() => new Date()))();
    const userId = await deps.getUserId();
    const scan = await deps.scanRepo.findOwnedScan(scanId, {
      userId,
      cookieSessionId: readSessionCookie(request.headers.get("cookie")),
      now,
    });
    if (!scan) return json(404, { error: "Scan not found." });

    let payload: unknown;
    try {
      payload = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    } catch {
      return json(400, { error: "Request body must be valid JSON." });
    }
    const parsed = resultFeedbackSubmissionSchema.safeParse(payload);
    if (!parsed.success) {
      return json(400, {
        error: "Invalid feedback.",
        issues: flattenIssues(parsed.error.issues),
      });
    }
    const body = parsed.data;

    const snapshot = buildSnapshot(scan, await deps.fitRepo.loadCatalogue());

    const outcome = await deps.feedbackRepo.recordFeedback({
      scanId,
      userId,
      noticeVersion: body.notice,
      stars: body.stars,
      comment: body.comment ?? null,
      locale: body.locale,
      snapshot,
      createdOn: startOfUtcDay(now),
      markedAt: now,
    });
    if (outcome === "scan_gone") return json(404, { error: "Scan not found." });
    if (outcome === "already_rated") {
      log.info("result_feedback.conflict", {
        route: RESULT_FEEDBACK_LOG_ROUTE,
      });
      return json(409, { error: "This scan has already been rated." });
    }

    const response = resultFeedbackSubmitResponseSchema.parse({
      stored: true,
      withdrawable: userId !== null,
    });
    log.info("result_feedback.stored", {
      route: RESULT_FEEDBACK_LOG_ROUTE,
      withdrawable: response.withdrawable,
    });
    return json(201, response);
  } catch (error) {
    return logFailure("submit", error);
  }
}

/**
 * `GET /api/scans/{scanId}/feedback`. Order: per-IP rate limit (429) ->
 * malformed id or ownership (404) -> 200 `{ answered }`.
 */
export async function handleResultFeedbackStatus(
  request: Request,
  scanId: string,
  deps: ResultFeedbackDeps,
): Promise<Response> {
  try {
    if (await isRateLimited(request, deps.limiter)) {
      return json(429, { error: "Too many requests. Try again shortly." });
    }
    if (!isScanId(scanId)) return json(404, { error: "Scan not found." });

    const scan = await deps.scanRepo.findOwnedScan(scanId, {
      userId: await deps.getUserId(),
      cookieSessionId: readSessionCookie(request.headers.get("cookie")),
      now: (deps.now ?? (() => new Date()))(),
    });
    if (!scan) return json(404, { error: "Scan not found." });

    const rated = await deps.feedbackRepo.isRated(scanId);
    if (rated === null) return json(404, { error: "Scan not found." });
    return json(
      200,
      resultFeedbackStatusResponseSchema.parse({ answered: rated }),
    );
  } catch (error) {
    return logFailure("status", error);
  }
}
