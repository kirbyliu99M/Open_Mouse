import type { ZodType } from "zod";
import {
  surveyEditResponseSchema,
  surveyEditSchema,
  surveyMineResponseSchema,
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
import { buildAnswersWrite, buildContributionWrite } from "./profile";
import type { SurveyRepo } from "./repo";

/**
 * Body cap for `POST` and `PUT /api/survey` (a candidate, 未拍板): one limit
 * for both, read by the shared `readJsonBody`. The largest POST body the
 * schema accepts is five ratings with every pain point, one other mouse and a
 * 500-character comment. As JSON, compact:
 *  - about 2.7 KB as our own page sends it (`JSON.stringify`; the comment in
 *    three-byte characters, 1500 bytes);
 *  - about 4.2 KB when every character of the comment is written as a
 *    `\uXXXX` escape (6 bytes each, 3000 for 500) and the slugs are 40
 *    characters; 4.5 KB with the schema's longest slug (100) on all five.
 * 8 KiB leaves room over both and still refuses anything that is not a
 * questionnaire. Only a body that also escapes every key and value (8.5 to
 * 10 KB) passes the schema yet exceeds it; no client sends that, and its 413
 * costs nothing.
 *
 * A PUT can hold up to `MAX_ACCOUNT_MICE` (30) mice, so it is the larger body.
 * With every pain point on each of 30 ratings, the longest real catalogue slug
 * (42 characters) and a 500-character comment in three-byte characters it is
 * about 7 KB, under the cap. The schema would still allow a slug of up to 100
 * characters, and 30 of those is over 8 KiB: that body passes the schema and is
 * refused with a 413 (survey-edit.test.ts measures both). No catalogue slug
 * is that long, so the cap was not raised for it.
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
   * Per-IP limit shared by every method of this path. Required, not defaulted: a route
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
 * Reads the request's body within `MAX_SURVEY_BODY_BYTES` and checks it against
 * `schema`: a 413 for a body over the cap, a 400 for text that is not JSON or
 * does not fit the schema, else the parsed data. Shared by POST and PUT, so the
 * two refuse the same things in the same words; `what` names the body in the
 * 400's sentence.
 */
async function readJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  what: "submission" | "edit",
): Promise<
  { response: Response; data?: never } | { response?: never; data: T }
> {
  let bodyText: string;
  try {
    bodyText = await readLimitedBody(request, MAX_SURVEY_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return { response: json(413, { error: "Request body too large." }) };
    }
    throw error;
  }

  let payload: unknown;
  try {
    payload = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
  } catch {
    return {
      response: json(400, { error: "Request body must be valid JSON." }),
    };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      response: json(400, {
        error: `Invalid survey ${what}.`,
        issues: flattenIssues(parsed.error.issues),
      }),
    };
  }
  return { data: parsed.data };
}

/**
 * What a log line may say about a failure: the route, the operation and the
 * error's class (log.ts reduces an Error to its name and a short code). Never
 * the body, an answer, a brand, a bin or a message: a thrown error can carry
 * any of them. Also the route's answer when it cannot even build its
 * dependencies (a missing or malformed `DATABASE_URL`), so that failure is the
 * same plain 500 and the same log line.
 */
export function logFailure(
  op: "submit" | "withdraw" | "read" | "edit",
  error: unknown,
): Response {
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

    const read = await readJsonBody(
      request,
      surveySubmissionSchema,
      "submission",
    );
    if (read.response) return read.response;
    const body = read.data;

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

/**
 * `GET /api/survey`: a signed-in caller reads back their own answers. Order:
 * per-IP rate limit (429) -> signed in (401) -> read -> 200 with
 * `surveyMineResponseSchema` (empty lists and nulls when nothing is kept).
 * The comment and other mice in the body go to their owner only; no log line
 * carries an answer.
 */
export async function handleSurveyRead(
  request: Request,
  deps: SurveyDeps,
): Promise<Response> {
  try {
    if (await isRateLimited(request, deps.limiter)) {
      return json(429, { error: "Too many requests. Try again shortly." });
    }
    const userId = await deps.getUserId();
    if (userId === null) return json(401, { error: "Sign in required." });

    const stored = await deps.surveyRepo.readAnswers(userId);
    const response = surveyMineResponseSchema.parse({
      mainUse: stored.mainUse,
      ratings: stored.ratings.map((rating) => ({
        slug: rating.slug,
        satisfaction: rating.satisfaction,
        ...(rating.duration === null ? {} : { duration: rating.duration }),
        painPoints: rating.painPoints,
        current: rating.isCurrent,
      })),
      otherMice: stored.otherMice.map((other) => ({
        brand: other.brand,
        sizeFeel: other.sizeFeel,
        current: other.isCurrent,
      })),
      feedback: stored.feedback,
    });
    return json(200, response);
  } catch (error) {
    return logFailure("read", error);
  }
}

/**
 * `PUT /api/survey`: a signed-in caller replaces their answers as a whole.
 * Order: per-IP rate limit (429) -> signed in (401) -> body size (413) -> body
 * schema (400, which also refuses a body that names no mouse) -> unknown mouse
 * slug (400) -> the write, which finds no contribution (404) inside the same
 * all-or-nothing step -> 200.
 *
 * There is no scan, no consent and no hand profile in the body, and none is
 * written. Nothing in any response echoes an answer.
 */
export async function handleSurveyEdit(
  request: Request,
  deps: SurveyDeps,
): Promise<Response> {
  try {
    if (await isRateLimited(request, deps.limiter)) {
      return json(429, { error: "Too many requests. Try again shortly." });
    }
    const userId = await deps.getUserId();
    if (userId === null) return json(401, { error: "Sign in required." });

    const read = await readJsonBody(request, surveyEditSchema, "edit");
    if (read.response) return read.response;
    const body = read.data;

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

    const outcome = await deps.surveyRepo.replaceAnswers(
      userId,
      buildAnswersWrite(body, mouseIdBySlug),
    );
    if (outcome === "no_contribution") {
      log.info("survey.edit_refused", { route: SURVEY_LOG_ROUTE });
      return json(404, { error: "No survey answers to edit." });
    }

    log.info("survey.edited", { route: SURVEY_LOG_ROUTE });
    return json(200, surveyEditResponseSchema.parse({ stored: true }));
  } catch (error) {
    return logFailure("edit", error);
  }
}
