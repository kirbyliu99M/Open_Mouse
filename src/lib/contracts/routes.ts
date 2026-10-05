/**
 * Route contract — the HTTP seam between the browser and the route handlers.
 * Paths and bodies live here so a path or a body shape changes in one place,
 * and the frontend and backend builders cannot drift apart.
 *
 * Ownership rule for every scan-scoped route below. A scan is served when
 * EITHER of these holds, checked independently:
 *   - its session has a `user_id` equal to the signed-in caller's user id —
 *     from any browser; once a session is claimed (`claimSession`),
 *     ownership follows the user, not the cookie that created it; or
 *   - the caller's anonymous session cookie names its session, and that
 *     session has not expired.
 * Anyone else gets 404, never 403, so a scan ID is not an oracle for whether
 * a scan exists. An expired anonymous scan is also 404 — expired means gone.
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

/** One field-level validation problem, as returned on a 400. */
export const validationIssueSchema = z.strictObject({
  /** Dotted path into the request body, e.g. `measurements.palmWidthMm`. */
  path: z.string(),
  message: z.string().min(1),
});

/**
 * Body of every non-2xx response. `error` is a user-facing sentence, never
 * internals. `issues` appears only on a 400 caused by body validation, and
 * matches what `POST /api/scans` already returns.
 */
export const errorResponseSchema = z.strictObject({
  error: z.string().min(1),
  issues: z.array(validationIssueSchema).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * `POST` — body: `scanSubmissionSchema` (measurement.ts).
 * 201 → `scanSubmitResponseSchema`; 400 invalid body; 413 body too large;
 * 429 rate limited per client IP (`errorResponseSchema`; no session, scan or
 * fit result is written — only the limiter's own counter).
 */
export const SCAN_SUBMIT_PATH = "/api/scans";

export const scanSubmitResponseSchema = z.strictObject({
  scanId: z.string().uuid(),
});

export type ScanSubmitResponse = z.infer<typeof scanSubmitResponseSchema>;

/**
 * `POST` — body: `fitPreferencesSchema` (fit.ts); `{}` means no preferences.
 * 200 → `fitResponseSchema` (fit.ts); 400 invalid body; 404 unknown scan;
 * 429 rate limited per client IP (`errorResponseSchema`; no session, scan or
 * fit result is written — only the limiter's own counter).
 */
export const fitPath = (scanId: string): string =>
  `/api/scans/${encodeURIComponent(scanId)}/fit`;

/**
 * `POST` — body: `fitPreferencesSchema`, the SAME preferences the fit request
 * used, so the server analyses exactly the ranking the user is looking at.
 * 200 → `analysisResponseSchema` (analysis.ts); 400; 404; 429 rate limited
 * per client IP. At the site-wide daily model cap the response is still 200,
 * with `source: "fallback"` — never a 429.
 */
export const analysisPath = (scanId: string): string =>
  `/api/scans/${encodeURIComponent(scanId)}/analysis`;

/**
 * `DELETE` — deletes **this one scan**: its `scans` row, which cascades to
 * its `scan_measurements`, `fit_results` and `analysis_cache` rows (the
 * cached model prose, bound to this scan since migration 0005). Nothing else. Other scans
 * in the same session, and the session itself (even if now empty), are
 * untouched: a person who made scans A and B and deletes B still has A.
 * Ownership rule above; anyone else gets 404.
 * 204 → no body; 404 unknown, foreign or already-deleted scan.
 *
 * Throws on anything but a UUID, unlike the other path builders, so a caller
 * holding an unvalidated id (e.g. a `/results/[scanId]` route parameter) must
 * validate it or catch the error first. The static
 * sibling route `/api/scans/session` deletes EVERY scan in a session and
 * takes precedence over a dynamic `[scanId]` segment, so a non-UUID here could
 * turn "delete this scan" into "delete all of them". Refusing to build the
 * path fails safe: nothing is deleted.
 */
export const scanPath = (scanId: string): string => {
  if (!scanSubmitResponseSchema.shape.scanId.safeParse(scanId).success) {
    throw new Error("scanPath requires a scan UUID");
  }
  return `/api/scans/${scanId}`;
};

/**
 * `GET` — the millimetres this scan stored, for the 3D viewer to scale the
 * hand model. 200 → `scanMeasurementsResponseSchema` (measurement.ts); 404
 * unknown, foreign or expired scan (ownership rule above); 429 rate limited
 * per client IP. These are the person's own derived values, the same ones they
 * POSTed: no image and nothing the scan did not already hold. The answer
 * depends on the caller, so it carries `Cache-Control: no-store`.
 */
export const scanMeasurementsPath = (scanId: string): string =>
  `/api/scans/${encodeURIComponent(scanId)}/measurements`;

/** The results page for a submitted scan. */
export const resultsPagePath = (scanId: string): string =>
  `/results/${encodeURIComponent(scanId)}`;

/**
 * `POST` — body: `surveySubmissionSchema` (survey.ts). Needs the consent tick
 * in the body; the scan named by `scanId` follows the ownership rule above
 * (anyone else: 404). The hand profile is read from that scan on the server.
 * 201 → `surveySubmitResponseSchema`; 400 invalid body (including a body that
 * names no mouse, or marks two as current) or unknown mouse slug;
 * 404 unknown, foreign or expired scan; 409 this scan has already contributed
 * (one contribution per scan; nothing is stored or replaced); 413 body too
 * large; 429 rate limited per client IP (`errorResponseSchema`; nothing is
 * stored). A signed-in person's later submission replaces their earlier rating
 * of the same mouse and is still 201. The full repeat rules are in survey.ts.
 *
 * `DELETE` — signed-in callers only: withdraws everything the caller has
 * contributed (ratings, consent record and hand profile). 204 → no body, also
 * when there was nothing to withdraw; 401 when not signed in; 429 rate limited
 * per client IP. An anonymous contribution cannot be withdrawn: it is tied to
 * no account. The account's "Delete everything" must withdraw it too (survey.ts).
 *
 * Every response from this path carries `Cache-Control: no-store`.
 */
export const SURVEY_PATH = "/api/survey";

/**
 * `GET` — 200 → `similarResponseSchema` (recommend.ts), which says
 * `available: false` until enough people stand behind the answer; 404 unknown,
 * foreign or expired scan (ownership rule above); 429 rate limited per client
 * IP. `Cache-Control: no-store`: the answer depends on this person's hand, so a
 * shared cache must never replay it to someone else.
 */
export const similarPath = (scanId: string): string =>
  `/api/scans/${encodeURIComponent(scanId)}/similar`;

/**
 * `GET` — the home page's own best matches, from the caller's live scan.
 * 200 → `homeTopMiceResponseSchema` (home.ts); 404 when the caller has no live
 * scan; 429 rate limited per client IP. The caller is identified the same two
 * ways as the ownership rule above (a signed-in user's latest scan, else the
 * session cookie's latest scan). Names only; see home.ts. The URL is the same
 * for every visitor while the answer is not, so the response carries
 * `Cache-Control: no-store` and no shared cache may keep it.
 */
export const HOME_TOP_MICE_PATH = "/api/home/top-mice";
