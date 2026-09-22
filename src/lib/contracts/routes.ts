/**
 * Route contract — the HTTP seam between the browser and the route handlers.
 * Paths and bodies live here so a path or a body shape changes in one place,
 * and the frontend and backend builders cannot drift apart.
 *
 * Ownership rule for every scan-scoped route below: a scan is served only to
 * the session that created it (anonymous cookie) or the signed-in user who
 * owns it. Anyone else gets 404, never 403, so a scan ID is not an oracle for
 * whether a scan exists. An expired anonymous scan is also 404 — expired
 * means gone. Change this file only in a PR of its own.
 */
import { z } from "zod";

/** Body of every non-2xx response. A user-facing sentence, never internals. */
export const errorResponseSchema = z.strictObject({
  error: z.string().min(1),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * `POST` — body: `scanSubmissionSchema` (measurement.ts).
 * 201 → `scanSubmitResponseSchema`; 400 invalid body; 413 body too large.
 */
export const SCAN_SUBMIT_PATH = "/api/scans";

export const scanSubmitResponseSchema = z.strictObject({
  scanId: z.string().uuid(),
});

export type ScanSubmitResponse = z.infer<typeof scanSubmitResponseSchema>;

/**
 * `POST` — body: `fitPreferencesSchema` (fit.ts); `{}` means no preferences.
 * 200 → `fitResponseSchema` (fit.ts); 400 invalid body; 404 unknown scan.
 */
export const fitPath = (scanId: string): string =>
  `/api/scans/${encodeURIComponent(scanId)}/fit`;

/**
 * `POST` — body: `fitPreferencesSchema`, the SAME preferences the fit request
 * used, so the server analyses exactly the ranking the user is looking at.
 * 200 → `analysisResponseSchema` (analysis.ts); 400; 404; 429 rate limited.
 */
export const analysisPath = (scanId: string): string =>
  `/api/scans/${encodeURIComponent(scanId)}/analysis`;

/** The results page for a submitted scan. */
export const resultsPagePath = (scanId: string): string =>
  `/results/${encodeURIComponent(scanId)}`;
