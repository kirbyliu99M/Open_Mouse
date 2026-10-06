import {
  surveySubmissionSchema,
  surveySubmitResponseSchema,
} from "../../lib/contracts/survey";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../analysis/ip";
import { log } from "../log";
import { BodyTooLargeError, readLimitedBody } from "../scans/body-limit";
import { readSessionCookie } from "../scans/cookies";
import type { RateLimiter } from "../scans/rate-limit-config";
import type { ScanRepo } from "../scans/repo";
import { flattenIssues } from "../scans/submit";
import { buildContributionWrite } from "./profile";
import type { SurveyRepo } from "./repo";

/**
 * Body cap for `POST /api/survey` (a candidate, 未拍板). The largest valid body
 * is five ratings, one other mouse and 500 characters of comment: under 3 KiB
 * even with every character written as a JSON escape. 8 KiB leaves room and
 * still refuses anything that is not a questionnaire.
 */
export const MAX_SURVEY_BODY_BYTES = 8 * 1024;

/** The route name every survey log line carries. */
export const SURVEY_LOG_ROUTE = "/api/survey";

// Every response from this path, errors included, is `no-store`: the answer
// depends on who is asking (routes.ts, SURVEY_PATH).
const NO_STORE = { "cache-control": "no-store" } as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

export interface SurveyDeps {
  scanRepo: ScanRepo;
  surveyRepo: SurveyRepo;
  /**
   * Per-IP limit shared by POST and DELETE. Required, not defaulted: a route
   * that forgets it must fail to compile rather than ship unlimited.
   */
  limiter: RateLimiter;
  /** The signed-in caller's user id, or null. Wraps `auth()` in the real route. */
  getUserId: () => Promise<string | null>;
  /** Injectable clock; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * Per-IP limit, checked before the body is read. No usable IP (local dev) is
 * never limited, the same carve-out the scan and fit routes make.
 */
async function isRateLimited(
  request: Request,
  limiter: RateLimiter,
): Promise<boolean> {
  const clientIp = resolveClientIp(request.headers);
  if (clientIp === UNKNOWN_IP_KEY) return false;
  return !(await limiter.allow(clientIp));
}

/**
 * What a log line may say about a failure: the route, the operation and the
 * error's class (log.ts reduces an Error to its name and a short code). Never
 * the body, an answer, a brand, a bin or a message: a thrown error can carry
 * any of them.
 */
function logFailure(op: "submit" | "withdraw", error: unknown): Response {
  log.error("survey.failed", { route: SURVEY_LOG_ROUTE, op, error });
  return json(500, { error: "Something went wrong. Try again in a moment." });
}

/**
 * `POST /api/survey`. Order: per-IP rate limit (429) -> body size (413) ->
 * body schema (400) -> scan ownership (404, one body for every cause) ->
 * unknown mouse slug (400) -> the write, which refuses a scan that already
 * contributed (409) inside the same all-or-nothing step -> 201.
 *
 * The hand profile is read from the scan on the server (`buildContributionWrite`)
 * and never taken from the body. Nothing in any response echoes an answer.
 *
 * A malformed `scanId` is a failure of the body schema, so it is a 400 naming
 * `scanId`, and the scan repo is never asked: `scanId` is a field of the body
 * the contract validates (routes.ts, SURVEY_PATH: "400 invalid body"), unlike
 * the id in a path (`/api/scans/{id}/...`), where a malformed id is the same
 * 404 as an unknown one. A well-formed id that is unknown, foreign or expired
 * is the 404.
 */
export async function handleSurveySubmission(
  request: Request,
  deps: SurveyDeps,
): Promise<Response> {
  try {
    if (await isRateLimited(request, deps.limiter)) {
      return json(429, { error: "Too many requests. Try again shortly." });
    }

    let bodyText: string;
    try {
      bodyText = await readLimitedBody(request, MAX_SURVEY_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return json(413, { error: "Request body too large." });
      }
      throw error;
    }

    let payload: unknown;
    try {
      payload = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    } catch {
      return json(400, { error: "Request body must be valid JSON." });
    }
    const parsed = surveySubmissionSchema.safeParse(payload);
    if (!parsed.success) {
      return json(400, {
        error: "Invalid survey submission.",
        issues: flattenIssues(parsed.error.issues),
      });
    }
    const body = parsed.data;

    const now = (deps.now ?? (() => new Date()))();
    const userId = await deps.getUserId();
    const scan = await deps.scanRepo.findOwnedScan(body.scanId, {
      userId,
      cookieSessionId: readSessionCookie(request.headers.get("cookie")),
      now,
    });
    if (!scan) return json(404, { error: "Scan not found." });

    const mouseIdBySlug = await deps.surveyRepo.findMouseIdsBySlug(
      body.ratings.map((rating) => rating.slug),
    );
    const unknown = body.ratings.flatMap((rating, index) =>
      mouseIdBySlug.has(rating.slug)
        ? []
        : [{ path: `ratings.${index}.slug`, message: "unknown mouse" }],
    );
    if (unknown.length > 0) {
      return json(400, { error: "Unknown mouse.", issues: unknown });
    }

    const outcome = await deps.surveyRepo.recordContribution(
      buildContributionWrite({
        body,
        userId,
        scan: {
          gripStyleStated: scan.gripStyleStated ?? null,
          measurements: scan.measurements,
        },
        mouseIdBySlug,
        now,
      }),
    );
    if (outcome === "scan_gone") return json(404, { error: "Scan not found." });
    if (outcome === "already_contributed") {
      log.info("survey.conflict", { route: SURVEY_LOG_ROUTE });
      return json(409, { error: "This scan has already contributed." });
    }

    const response = surveySubmitResponseSchema.parse({
      stored: true,
      withdrawable: userId !== null,
    });
    log.info("survey.stored", {
      route: SURVEY_LOG_ROUTE,
      withdrawable: response.withdrawable,
    });
    return json(201, response);
  } catch (error) {
    return logFailure("submit", error);
  }
}

/**
 * `DELETE /api/survey`: a signed-in caller withdraws everything they
 * contributed. Order: per-IP rate limit (429) -> signed in (401) -> delete ->
 * 204 with no body, also when there was nothing to withdraw. An anonymous
 * contribution is tied to no account and cannot be withdrawn.
 */
export async function handleSurveyWithdrawal(
  request: Request,
  deps: SurveyDeps,
): Promise<Response> {
  try {
    if (await isRateLimited(request, deps.limiter)) {
      return json(429, { error: "Too many requests. Try again shortly." });
    }
    const userId = await deps.getUserId();
    if (userId === null) return json(401, { error: "Sign in required." });

    const removed = await deps.surveyRepo.withdrawContributions(userId);
    log.info("survey.withdrawn", { route: SURVEY_LOG_ROUTE, count: removed });
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return logFailure("withdraw", error);
  }
}
