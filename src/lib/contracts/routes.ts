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

/** The results page for a submitted scan. */
export const resultsPagePath = (scanId: string): string =>
  `/results/${encodeURIComponent(scanId)}`;
